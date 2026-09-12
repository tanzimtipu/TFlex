# Handoff brief — resume TFlex here

Paste the section below as the first message of a new session running the **TFlex Orchestrator**
preset. Snapshot taken 2026-09-13 at `master` / `94cb07a`.

---

You are resuming work on TFlex. Read `AGENTS.md` and `REQUIREMENTS.md` first, then this.

## Harness changes since your last run — already configured, do not re-derive

- Six roles, each with its route and its persona baked into a single dispatch tool:
  `dispatch_backend_dev`, `dispatch_frontend_dev`, `dispatch_qa`, `dispatch_adversary`,
  `dispatch_git_agent`, `dispatch_feature_scout`. Pass **only the task spec** — the harness
  injects each role's brief, and there is no model parameter to set.
- **`backend-dev` and `frontend-dev` now run on a local Qwen3.8-27B** (`local-ninfer`, 128k
  context) served from the RTX 4090. It is *not always running*: start it before dispatching
  either of them, stop it once their work is finished. `qa`, `adversary`, `git-agent` and
  `feature-scout` stay on cloud routes.
- **qa is deliberately not local.** It drives the real Electron app under Playwright, and the
  model holds ~23 GiB of the 24.5 GiB card. Keep the model stopped around any e2e run or the
  app is left about a gigabyte of VRAM.
- **Dispatch blocks and returns its result.** There is no status tool and nothing to poll —
  never repeat a call to check on work in flight. To run two roles at once, send both calls in
  one message with `run_in_background: true`, then collect each exactly once with
  `job_output(wait: true)`.
- The two local roles are instructed to grep-then-read ~150 lines and never read a file whole:
  several files here are 3,000–6,800 lines, and tool results over 8 KB are trimmed to their
  first 4 KB and last 1 KB before the agent sees them.
- **`feature-scout`** finds features peer PDF products have and TFlex does not. It is read-only;
  you record its output in `docs/FEATURE-BACKLOG.md` (FEA-NNN) and show the batch to me before
  any disposition.

## Project state at handoff

- `master` at `94cb07a` — "version: 1.13.1, bug fix release: 9 defects closed (DEF-201–DEF-209)".
- **4 OPEN defects, all LOW**: DEF-200 (pressed `.btn` stays at the hover lift — cascade order),
  DEF-199 (theme echo starts a second, skipped View Transition), DEF-198 (mid-session
  `prefers-reduced-motion` changes not picked up), DEF-172 (e2e sweeps against the *installed*
  app fail once a newer version is published).
- **7 adversary entries are still `Disposition: PENDING`** — ADV-024 through ADV-030. They were
  accepted and already closed out as DEF-203–DEF-209 in 1.13.1; the dispositions were simply
  never updated. AGENTS.md forbids leaving an entry PENDING.
- **Phase 15 (cross-theme animation) is committed and documented in AGENTS.md, but
  REQUIREMENTS.md has no Phase 15 heading** — its last phase is 14.2. The contract and the code
  disagree.
- **40 files are untracked**, including this run's orchestration: `.dsh/`,
  `docs/FEATURE-BACKLOG.md`, `docs/FEATURE-SOURCES.md`, `scripts/ninfer-model.ps1`.

## Do this first, in order, and report before starting any feature work

1. **Reconcile the contract.** Add the missing Phase 15 to `REQUIREMENTS.md` in the original
   template — feature list, demonstrable success criteria, and the mandatory Settings impact
   line — or tell me why it does not belong there.
2. **Close the books.** Fill in the seven PENDING dispositions as `ACCEPTED -> DEF-203` through
   `ACCEPTED -> DEF-209`.
3. **Triage the 4 OPEN defects** and dispatch the ones worth fixing, highest severity first.
4. **Commit the untracked orchestration files** through git-agent — explicitly, never with
   `git add .`.
5. **Report status and ask me what to work on next.** Do not open a new phase on your own.

## Local model lifecycle

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ninfer-model.ps1 status
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ninfer-model.ps1 start
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ninfer-model.ps1 stop
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ninfer-model.ps1 restart
```

`-ExecutionPolicy Bypass` is required on this machine. Run `status` before dispatching a local
role rather than assuming it is up.
