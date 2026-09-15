# flash-model.ps1 - load, offload and inspect the local Qwen3.8-Flash-Next server.
#
# Companion to ninfer-model.ps1, exposing the SAME lifecycle contract
# (status / start / stop / restart) so a future model controller can treat
# both backends identically. Serves the 177B Qwen3.8-Flash-Next (UD-IQ3_XXS,
# ~82 GB mmap'd GGUF) via llama.cpp's llama-server on port 8081.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/flash-model.ps1 status
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/flash-model.ps1 start
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/flash-model.ps1 stop
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/flash-model.ps1 restart
#
# GPU CO-EXISTENCE RULE: NInfer (port 8080) owns the 4090 when it is running.
# This script defaults to CPU-only offload (-ngl 0) so Flash can stay resident
# in RAM/SSD alongside NInfer. For full-speed solo mode, stop NInfer first and
# set FLASH_MODE=turbo to let --fit push layers onto the GPU.
#
#   $env:FLASH_MODE = 'turbo'   # requires NInfer stopped
#   $env:FLASH_MODE = 'coexist' # default, safe alongside NInfer
#
# Memory notes (verified against llama-server b10964 --help):
#   - mmap is ON by default (--load-mode auto): the 82 GB file streams from
#     SSD, only touched pages enter the 64 GB RAM. Do NOT enable mlock.
#   - --fit-target stays 256 MiB; lower risks OOM in 6144-token prefill batches.
#
# Machine-specific by design: override paths with FLASH_ROOT / FLASH_PORT.

param(
    [Parameter(Position = 0)]
    [ValidateSet('status', 'start', 'stop', 'restart')]
    [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'

$LlamaDir = if ($env:LLAMA_DIR)  { $env:LLAMA_DIR }  else { 'C:\Users\tanzi\llama.cpp' }
$ModelDir = if ($env:FLASH_ROOT) { $env:FLASH_ROOT } else { 'C:\Users\tanzi\Models\Qwen3.8-Flash-Next' }
$Port     = if ($env:FLASH_PORT) { [int]$env:FLASH_PORT } else { 8081 }
$Mode     = if ($env:FLASH_MODE) { $env:FLASH_MODE } else { 'coexist' }

$Exe    = Join-Path $LlamaDir 'llama-server.exe'
$Model  = Join-Path $ModelDir 'Qwen3.8-Flash-Next-UD-IQ3_XXS-00001-of-00003.gguf'
$Mmproj = Join-Path $ModelDir 'mmproj-F16.gguf'
$OutLog = Join-Path $LlamaDir 'flash-server.out.log'
$ErrLog = Join-Path $LlamaDir 'flash-server.err.log'
$Base   = "http://127.0.0.1:$Port"

# Serving profile.
#
# Shared flags (both modes): 120K context, q8_0 KV with flash-attn, 6144-token
# prefill batches, 20/24 threads on the 5950X (leaving cores for the system),
# unsloth-recommended sampling for thinking mode, reasoning budget 4000 so the
# planner does not burn minutes on xhigh-effort self-doubt loops, single slot.
$ServeArgs = @(
    '--model', $Model
    '--mmproj', $Mmproj
    '--host', '127.0.0.1'
    '--port', "$Port"
    '--alias', 'qwen3.8-flash-next'
    '--ctx-size', '120000'
    '-t', '20', '-tb', '24'
    '-b', '6144', '-ub', '6144'
    '--temp', '1.0', '--top-p', '0.95', '--top-k', '20', '--min-p', '0.0', '--presence-penalty', '0.0'
    '--flash-attn', 'on', '--cache-type-k', 'q8_0', '--cache-type-v', 'q8_0'
    '--reasoning-budget', '4000'
    '--reasoning-preserve'
    '--image-max-tokens', '4000', '--image-min-tokens', '1024'
    '--cont-batching', '--metrics', '-np', '1'
)

if ($Mode -eq 'turbo') {
    # Solo mode: NInfer must be stopped. Let llama.cpp auto-fit layers onto the
    # 4090 with a 256 MiB safety margin. Expected ~25-35 tok/s decode.
    $ServeArgs += @('--fit', 'on', '--fit-target', '256')
} else {
    # Coexist mode (default): NInfer holds the GPU. Pure CPU/RAM/SSD inference;
    # the phrase-book architecture is built for exactly this. Expected ~10-18
    # tok/s decode - acceptable for orchestrator planning/review turns.
    $ServeArgs += @('-ngl', '0')
}

function Get-FlashProcess {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq 'llama-server.exe' }
}

function Test-Endpoint {
    try {
        $r = Invoke-RestMethod -Uri "$Base/v1/models" -TimeoutSec 5
        return @($r.data | ForEach-Object { $_.id })
    } catch {
        return @()
    }
}

function Stop-Flash {
    $procs = @(Get-FlashProcess)
    if ($procs.Count -eq 0) {
        Write-Output 'flash: already stopped (no llama-server.exe running)'
        return
    }
    foreach ($p in $procs) {
        try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch {
            Write-Output ("flash: could not stop pid {0}: {1}" -f $p.ProcessId, $_.Exception.Message)
        }
    }
    # Wait for the port to actually release so a following start cannot collide.
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 500
        if (@(Get-FlashProcess).Count -eq 0) { break }
    }
    Write-Output ("flash: stopped {0} process(es); RAM/GPU freed" -f $procs.Count)
}

function Invoke-Warmup {
    # mmap means the HTTP listener answers while the weights are still cold on
    # SSD: the first real request would stall on page-in. Burn one one-token
    # completion so `start` returns only when the model can actually decode.
    param([string[]]$Models)
    $id = if ($Models.Count -gt 0) { $Models[0] } else { 'qwen3.8-flash-next' }
    $warm = @{
        model       = $id
        messages    = @(@{ role = 'user'; content = 'ok' })
        max_tokens  = 1
        temperature = 0
    } | ConvertTo-Json -Depth 5
    try {
        $null = Invoke-WebRequest "$Base/v1/chat/completions" -Method POST -Body $warm `
            -ContentType 'application/json' -UseBasicParsing -TimeoutSec 600
        Write-Output 'flash: warm (first request served)'
    } catch {
        Write-Output ("flash: warmup request failed ({0}) - the server is up but the first dispatch may be slow" -f $_.Exception.Message)
    }
}

function Start-Flash {
    if (-not (Test-Path $Exe))   { throw "flash: server binary not found at $Exe" }
    if (-not (Test-Path $Model)) { throw "flash: model artifact not found at $Model" }

    if ($Mode -eq 'turbo') {
        # Refuse to contest NInfer for the GPU.
        $ninfer = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -eq 'ninfer-serve.exe' }
        if ($ninfer) {
            throw "flash: turbo mode requested but NInfer is running (pid $($ninfer[0].ProcessId)). Stop it first: ninfer-model.ps1 stop"
        }
    }

    $up = @(Test-Endpoint)
    if ($up.Count -gt 0) {
        Write-Output ("flash: already up on port {0} (models: {1})" -f $Port, ($up -join ', '))
        return
    }

    Write-Output "flash: loading $Model in $Mode mode (mmap; expect fast listen, slow first decode)..."
    Start-Process -FilePath $Exe -ArgumentList $ServeArgs -WindowStyle Hidden `
        -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog | Out-Null

    # mmap load is quick to listen; allow generous headroom for page-in.
    for ($i = 0; $i -lt 90; $i++) {
        Start-Sleep -Seconds 2
        $up = @(Test-Endpoint)
        if ($up.Count -gt 0) {
            Write-Output ("flash: UP on {0} after ~{1}s (models: {2})" -f $Base, (2 * ($i + 1)), ($up -join ', '))
            Invoke-Warmup -Models $up
            return
        }
    }
    Write-Output "flash: FAILED to come up within 180s. Last lines of ${ErrLog}:"
    if (Test-Path $ErrLog) { Get-Content $ErrLog -Tail 15 }
    exit 1
}

switch ($Action) {
    'status' {
        $up = @(Test-Endpoint)
        if ($up.Count -gt 0) {
            $pids = @(Get-FlashProcess | ForEach-Object { $_.ProcessId })
            Write-Output ("flash: UP on {0} models={1} pid={2} mode={3}" -f $Base, ($up -join ','), ($pids -join ','), $Mode)
        } else {
            $pids = @(Get-FlashProcess | ForEach-Object { $_.ProcessId })
            if ($pids.Count -gt 0) {
                Write-Output ("flash: DOWN but process alive (pid={0}) - still loading or wedged" -f ($pids -join ','))
            } else {
                Write-Output 'flash: DOWN (not running, resources free)'
            }
        }
    }
    'start'   { Start-Flash }
    'stop'    { Stop-Flash }
    'restart' { Stop-Flash; Start-Flash }
}
