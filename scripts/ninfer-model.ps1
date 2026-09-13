# ninfer-model.ps1 - load, offload and inspect the local NInfer model server.
#
# The local Qwen3.8-27B server holds essentially the whole RTX 4090: 16.95 GiB of
# weights plus a 5.09 GiB KV pool for a 264000-token context. TFlex's e2e suite
# drives Electron and Playwright on that same GPU, and at this context length the
# two no longer fit together, so the model must be OFFLOADED before an e2e run and
# reloaded afterwards. This script is the orchestrator's handle on that lifecycle.
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

# Serving profile. Measured on this machine, not guessed.
#
# THE MEMORY BUDGET, AND WHY SLOTS ARE EXPENSIVE. Weights are 16.95 GiB and the
# Windows desktop already holds ~2.2 GiB, so everything the runtime needs has to fit
# in the ~5.55 GiB that is left. The engine states its own reservation and REFUSES TO
# START when it does not fit, so every number below is a measured start-or-refuse.
#
# The KV pool is allocated PER DECODE SLOT, not shared: the engine reported
# pages=4125 at concurrency 1, 8250 at 2 and 12375 at 3. That is why each extra
# slot costs real memory and why the context had to be traded against them.
# Measured at --max-context 264000, rk2v4-e8, --vision:
#     slots 2, --vision-max-tokens 8192  -> needs 5.09 GiB, fits, 476 MiB slack
#     slots 3, --vision-max-tokens 8192  -> needs 5.63 GiB, REFUSED (81 MiB short)
#     slots 3, --vision-max-tokens 2048  -> needs 5.26 GiB, fits, 304 MiB slack  (chosen)
#     slots 4, at any of the above       -> needs ~5.8 GiB, cannot fit
# So THREE is the ceiling at 264000 tokens, and reaching it means giving up most of
# the vision scratchpad.
#
#   --max-concurrency 3  three decode slots, so the orchestrator can have three local
#                        agents in flight: measured with three concurrent requests,
#                        avg_decode_batch=3.00 and all three completed.
#                        Cost, measured under that full load: ~16 tok/s per stream
#                        (a lone request gets 45-103 tok/s), and speculative acceptance
#                        falls from ~60% to ~31%. Anything queued behind the slots waits
#                        rather than fails - --pending-timeout-ms 300000 is what makes
#                        that safe, and is the fix for the old "expired while waiting
#                        for admission" failure that surfaced in DSH as a dispatch error
#                        with zero content.
#
#   --vision-max-tokens 2048
#                        the vision scratchpad, cut from the 8192 default because it is
#                        the only lever that fits slot 3. It does NOT fail on a large
#                        image: the encoder downsamples to the budget. Measured - a
#                        1280x800 and a 2560x1440 screenshot both came back with exactly
#                        2049 prompt tokens, and both were transcribed correctly. The cost
#                        is fine detail, so treat a very small UI label as unverified.
#                        ALTERNATIVE if that detail is ever needed: 3 slots at
#                        --max-context 250048 with --vision-max-tokens 8192 also starts,
#                        but with only 107 MiB slack, so one more desktop allocation could
#                        stop the server from starting at all.
#
#   --kv-dtype rk2v4-e8  2-bit E8 lattice Keys, 4-bit Values. Against rk4v4-e8 (6.71 GiB
#                        at 2 slots, refused) it removes ~1.07 GiB of pool, which is what
#                        buys the context. The cost is K-side precision, so long-context
#                        retrieval is less reliable than at 4-bit (rk4v4-e8 measures 98.7%
#                        cosine vs FP32).
#
#   --prefill-chunk 512  halves the prefill workspace. Worth ~5 MiB - measured, not
#   --max-pending-requests 16
#                        assumed - so these are tidiness, not the reason anything fits.
#
#   --vision             five roles read screenshots now: frontend-dev, qa, adversary.
#   --spec mtp ...       speculative decoding; worth roughly 4x on decode.
#
# DO NOT ADD --wddm-evictable-budget. It raises the engine's budget from 5.55 GiB to
# 6.54 GiB, which makes almost anything "fit" - and it is a trap. The flag budgets
# against TOTAL VRAM while ignoring the desktop's ~2.2 GiB, so the engine over-commits
# and WDDM evicts the pool to system RAM. Measured with it: decode fell to 0.7 tok/s,
# ttft 2986 ms, 164 s for 120 tokens.
#
# VERIFIED after this profile: 103.6 tok/s single-stream decode, 114 ms ttft, ~1830 tok/s
# prefill (a 14458-token prompt in 7.9 s), 3 concurrent streams at batch 3, and correct
# vision on 1280x800 and 2560x1440 test images. /v1/models reports context_window=264000
# and modalities.vision=true.
#
# Free VRAM after startup is ~250 MiB. qa RUNS ON THIS MODEL, so do NOT stop the server
# before an e2e run - that would kill the agent running the suite. Measured with the model
# resident at this size: the packaged app still starts, gets its gpu-process and comes up
# with a titled window alongside it.
$ServeArgs = @(
    $Model
    '--host', '127.0.0.1'
    '--port', "$Port"
    '--max-context', '264000'
    '--kv-capacity', '264000'
    '--max-concurrency', '3'
    '--max-pending-requests', '16'
    '--pending-timeout-ms', '300000'
    '--prefill-chunk', '512'
    '--kv-dtype', 'rk2v4-e8'
    '--vision'
    '--vision-max-tokens', '2048'
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
