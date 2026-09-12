# ninfer-model.ps1 - load, offload and inspect the local NInfer model server.
#
# The local Qwen3.8-27B server holds ~17 GiB of the RTX 4090, which is most of the
# card. TFlex's e2e suite drives Electron and Playwright on that same GPU, so the
# model must be OFFLOADED before an e2e run and reloaded afterwards. This script is
# the orchestrator's handle on that lifecycle.
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
$OutLog = Join-Path $Root 'dsh-server.out.log'
$ErrLog = Join-Path $Root 'dsh-server.err.log'
$Base   = "http://127.0.0.1:$Port"

# Serving profile. Measured on this machine, not guessed. The engine allocates the
# KV pool you ask for and will consume the whole card given the chance, so the real
# question is how much to leave the desktop. Measured free-after-startup:
#     65536 -> 2.35 GiB        131072 -> 1.06 GiB  (chosen)
#    196608 -> 124 MiB        229376 -> 0         253952 -> 0
# Above roughly 190k the card is full and the desktop starts contending.
#
#   --vision            frontend-dev judges its own screenshots
#   --kv-dtype rk4v4-e8 4-bit E8 lattice KV: 98.7% cosine vs FP32. Text-only reaches
#                       ~433k theoretical; enabling vision costs about a third of that.
#   --spec mtp ...      speculative decoding; worth roughly 4x on decode
#
#   --max-concurrency 3   the orchestrator probes and can run three local roles at once.
#                         With 1 slot the queue wait climbed past 30s and the server rejected
#                         queued work - "expired while waiting for admission" - which surfaced
#                         in DSH as a dispatch error with zero content.
#   --pending-timeout-ms 300000
#                         a queued request must outlive a slow one ahead of it, not be killed.
$ServeArgs = @(
    $Model
    '--host', '127.0.0.1'
    '--port', "$Port"
    '--max-context', '131072'
    '--kv-capacity', '131072'
    '--max-concurrency', '3'
    '--max-pending-requests', '32'
    '--pending-timeout-ms', '300000'
    '--prefill-chunk', '1024'
    '--kv-dtype', 'rk4v4-e8'
    '--vision'
    '--spec', 'mtp'
    '--draft-tokens', '4'
    '--lm-head-draft'
    '--default-max-tokens', '8192'
    '--no-ui'
)

function Get-NinferProcess {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq 'ninfer-serve.exe' }
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

function Start-Ninfer {
    if (-not (Test-Path $Exe))   { throw "ninfer: server binary not found at $Exe" }
    if (-not (Test-Path $Model)) { throw "ninfer: model artifact not found at $Model" }

    $up = @(Test-Endpoint)
    if ($up.Count -gt 0) {
        Write-Output ("ninfer: already up on port {0} (models: {1})" -f $Port, ($up -join ', '))
        return
    }

    Write-Output "ninfer: loading $Model (expect ~5s load, then warmup)..."
    Start-Process -FilePath $Exe -ArgumentList $ServeArgs -WindowStyle Hidden `
        -RedirectStandardOutput $OutLog -RedirectStandardError $ErrLog | Out-Null

    # Model load is ~5s; allow generous headroom for vision allocations and warmup.
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 2
        $up = @(Test-Endpoint)
        if ($up.Count -gt 0) {
            Write-Output ("ninfer: UP on {0} after ~{1}s (models: {2})" -f $Base, (2 * ($i + 1)), ($up -join ', '))
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
            Write-Output ("ninfer: UP on {0} models={1} pid={2}" -f $Base, ($up -join ','), ($pids -join ','))
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
