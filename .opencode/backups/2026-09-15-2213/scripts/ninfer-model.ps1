# ninfer-model.ps1 - load, offload and inspect the local NInfer model server.
#
# Active, measured profile: Qwen3.8-27B on RTX 4090, 220000 context tokens, one
# decode slot, rk4v4-e8 KV, and full 8192-token vision. This is the sole active
# profile. It leaves enough headroom for the packaged Electron app while QA runs;
# do not offload the model between local agent dispatches or before QA's e2e run.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ninfer-model.ps1 status
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ninfer-model.ps1 start
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ninfer-model.ps1 stop
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ninfer-model.ps1 restart
#
# `-ExecutionPolicy Bypass` is required: this machine's execution policy is
# Undefined at every scope, which means Restricted, so a .ps1 cannot be invoked
# directly - the same reason `npm.ps1` fails here and AGENTS.md mandates npm.cmd.
#
# Machine-specific by design: override the paths with NINFER_ROOT / NINFER_PORT.

param(
    [Parameter(Position = 0)]
    [ValidateSet('status', 'start', 'stop', 'restart')]
    [string]$Action = 'status'
)

$ErrorActionPreference = 'Stop'

$Root  = if ($env:NINFER_ROOT) { $env:NINFER_ROOT } else { 'C:\Users\tanzi\Documents\NInfer-4090' }
$Port  = if ($env:NINFER_PORT) { [int]$env:NINFER_PORT } else { 8080 }

$Exe    = Join-Path $Root 'build-ninja\apps\ninfer-serve.exe'
$Model  = Join-Path $Root 'models\qwen3_8_27b.ninfer'
$OutLog = Join-Path $Root 'ninfer-server.out.log'
$ErrLog = Join-Path $Root 'ninfer-server.err.log'
$Base   = "http://127.0.0.1:$Port"
$ExpectedModelId = 'qwen3.8-27b'

# Serving profile. Measured on this machine, not guessed. The KV pool is allocated
# per decode slot; one slot is deliberate so visual QA receives full-resolution vision
# and the renderer keeps usable GPU headroom. Measured at this profile: ~183 tok/s
# decode and ~115 ms TTFT. Do not add --wddm-evictable-budget: it overcommits WDDM
# memory and causes severe eviction stalls.
$ServeArgs = @(
    $Model
    '--host', '127.0.0.1'
    '--port', "$Port"
    '--max-context', '220000'
    '--kv-capacity', '220000'
    '--max-concurrency', '1'
    '--max-pending-requests', '16'
    '--pending-timeout-ms', '300000'
    '--prefill-chunk', '512'
    '--kv-dtype', 'rk4v4-e8'
    '--vision'
    '--vision-max-tokens', '8192'
    '--spec', 'mtp'
    '--draft-tokens', '4'
    '--lm-head-draft'
    '--default-max-tokens', '8192'
    '--no-cuda-graph'
    '--no-ui'
)

function Get-NinferProcess {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -eq 'ninfer-serve.exe' -and
            $_.CommandLine -match ("--port\\s+" + [regex]::Escape("$Port"))
        }
}

function Test-Endpoint {
    try {
        $r = Invoke-RestMethod -Uri "$Base/v1/models" -TimeoutSec 5
        return @($r.data | ForEach-Object { $_.id })
    } catch {
        return @()
    }
}

function Stop-Ninfer {
    $procs = @(Get-NinferProcess)
    if ($procs.Count -eq 0) {
        Write-Output 'ninfer: already stopped (no ninfer-serve.exe running)'
        return
    }
    foreach ($p in $procs) {
        try { Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop } catch {
            Write-Output ("ninfer: could not stop pid {0}: {1}" -f $p.ProcessId, $_.Exception.Message)
        }
    }
    # Wait for the port to actually release so a following start cannot collide.
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 500
        if (@(Get-NinferProcess).Count -eq 0) { break }
    }
    Write-Output ("ninfer: stopped {0} process(es); GPU freed" -f $procs.Count)
}

function Invoke-Warmup {
    # The HTTP listener answers several seconds before the engine finishes warming:
    # the first request after a start measured 8.0 tok/s against 45-63 tok/s once
    # warm. Burn one one-token completion so `start` returns only when the model can
    # actually decode at speed - the orchestrator's first developer dispatch would
    # otherwise pay that cold path.
    param([string[]]$Models)
    $id = if ($Models.Count -gt 0) { $Models[0] } else { 'qwen3.8-27b' }
    $warm = @{
        model       = $id
        messages    = @(@{ role = 'user'; content = 'ok' })
        max_tokens  = 1
        temperature = 0
    } | ConvertTo-Json -Depth 5
    try {
        $null = Invoke-WebRequest "$Base/v1/chat/completions" -Method POST -Body $warm `
            -ContentType 'application/json' -UseBasicParsing -TimeoutSec 600
        Write-Output 'ninfer: warm (first request served)'
    } catch {
        Write-Output ("ninfer: warmup request failed ({0}) - the server is up but the first dispatch may be slow" -f $_.Exception.Message)
    }
}

function Start-Ninfer {
    if (-not (Test-Path $Exe))   { throw "ninfer: server binary not found at $Exe" }
    if (-not (Test-Path $Model)) { throw "ninfer: model artifact not found at $Model" }

    $up = @(Test-Endpoint)
    if ($up.Count -gt 0) {
        if ($up -notcontains $ExpectedModelId) {
            throw ("ninfer: port {0} is occupied by an unexpected model ({1}); expected {2}" -f $Port, ($up -join ', '), $ExpectedModelId)
        }
        Write-Output ("ninfer: already up on port {0} (models: {1})" -f $Port, ($up -join ', '))
        return
    }

    Write-Output "ninfer: loading $Model (expect ~5s load, then warmup)..."
    Start-Process -FilePath $Exe -ArgumentList $ServeArgs -WindowStyle Hidden `
        -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog | Out-Null

    # Model load is ~5s; allow generous headroom for the KV pool and vision allocations.
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 2
        $up = @(Test-Endpoint)
        if ($up.Count -gt 0) {
            Write-Output ("ninfer: UP on {0} after ~{1}s (models: {2})" -f $Base, (2 * ($i + 1)), ($up -join ', '))
            Invoke-Warmup -Models $up
            return
        }
    }
    Write-Output "ninfer: FAILED to come up within 120s. Last lines of ${ErrLog}:"
    if (Test-Path $ErrLog) { Get-Content $ErrLog -Tail 15 }
    exit 1
}

switch ($Action) {
    'status' {
        $up = @(Test-Endpoint)
        if ($up.Count -gt 0) {
            $pids = @(Get-NinferProcess | ForEach-Object { $_.ProcessId })
            $profile = if ($up -contains $ExpectedModelId) { 'expected profile' } else { 'UNEXPECTED MODEL' }
            Write-Output ("ninfer: UP on {0} models={1} pid={2} ({3}; 220000 context, 1 slot, vision 8192)" -f $Base, ($up -join ','), ($pids -join ','), $profile)
        } else {
            $pids = @(Get-NinferProcess | ForEach-Object { $_.ProcessId })
            if ($pids.Count -gt 0) {
                Write-Output ("ninfer: DOWN but process alive (pid={0}) - still loading or wedged" -f ($pids -join ','))
            } else {
                Write-Output 'ninfer: DOWN (not running, GPU free)'
            }
        }
    }
    'start'   { Start-Ninfer }
    'stop'    { Stop-Ninfer }
    'restart' { Stop-Ninfer; Start-Ninfer }
}
