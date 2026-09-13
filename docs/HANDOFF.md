# Handoff brief — resume TFlex here

Paste the section below as the first message of a new session running the **TFlex Orchestrator**
preset. Snapshot taken 2026-09-13 at `master` / `5936b1a` (version 1.14.3).

---

You are resuming work on TFlex. Read `AGENTS.md` and `REQUIREMENTS.md` first, then this.

## Where your rules come from — read this before anything else

Your rules are **already in your context** and you do not need to be told them here. They live in
`.dsh/ORCHESTRATOR-CHARTER.md`, which is injected as your persona and **re-read every turn**. This
brief is the task situation, not the rulebook; where the two seem to differ, the charter wins.
`AGENTS.md` (team boundaries, ledgers, conventions) is likewise already loaded.

Two consequences worth knowing:

- **I can change your rules mid-run without restarting you.** If I edit the charter, it reaches you
  on your next turn. You never need to be told to "start a new session" for a rules change, and you
  should not ask me to.
- **A change to a dispatch ROW** — a route, `backgroundMode`, `toolFilter`, a role's persona, which
  tools exist — is the one thing that needs a new session, because that becomes your composition
  when you are composed. If you ever believe a row is wrong, say so and stop; do not work around it.

## What is already configured — do not re-derive or re-verify

- **Five of the six roles run on the local RTX 4090** through `local-ninfer` / `qwen3.8-27b`:
  backend-dev, frontend-dev, qa, adversary, git-agent. Only `feature-scout` is on a cloud route.
  Pass **only the task spec** — each role's route and brief are baked into its dispatch tool.
- **The local model serves a 264000-token context with vision.** It is **already loaded and warm
  right now**, so do not spend a turn starting it.
- **Three decode slots.** Up to three local agents may work at once. **backend-dev and frontend-dev
  are never in flight together** — they share one working tree.
- **When the slots are full, a dispatch queues; that is not a failure.** Four or five concurrent
  local dispatches have been measured completing on three slots, with the excess simply waiting.
  Never re-dispatch something that is merely slow, and never report a slot limit to me.
- **Every local role is continuable, and a child that hits its context limit is RESUMED, not
  killed.** Your dispatch returns a durable subagent id; when a child runs out of room or stops
  short, continue that same session with `send_message(agent_id, "continue ...")`. Never restart the
  task from scratch and never take it over yourself.
- **Do not poll.** `list_agents` is refused by your preset. A continuable dispatch notifies you when
  its run settles; end your turn and wait for that notice.
- **Your writes are restricted by the harness, not just by the brief.** `write`/`edit` are refused
  anywhere but DEFECTS.md, ADVERSARIAL_REVIEW.md, REQUIREMENTS.md, docs/FEATURE-BACKLOG.md and
  AGENTS_NOTES.md. A bare full-suite command is refused too. Both refusals name the right move —
  dispatch the owning role — and neither is a reason to reach the same file another way.
- **qa drives the real Electron app, and it runs on the local model.** The model is deliberately
  left loaded during an e2e run; offloading it would kill the agent running the suite. Do not stop
  it for that.
- **Pushing to origin needs my explicit permission in this session.** Report "ready to push" and wait.
- **Test discipline:** targeted checks (`npm run typecheck`, filtered unit tests), not the full suite.

## Project state at handoff

- `master` at `5936b1a` — "version: 1.14.3, fix OCR progress bar stuck at 100%".
- **The ledgers are clean, and the three items the last brief asked for are done:** DEFECTS.md has
  **no OPEN defects** (136 CLOSED, 1 REJECTED, highest DEF-210), and ADVERSARIAL_REVIEW.md has **no
  PENDING dispositions** (27 ACCEPTED, 5 REJECTED, highest ADV-040).
- **There is a large uncommitted working set.** 27 tracked files are modified — including
  `src/main/services/annotations.ts`, `src/main/services/settings.ts`, `src/renderer/App.tsx`,
  several motion/sidebar components, the e2e helpers and installed-app specs, 8 unit tests, and the
  docs/ledgers. Roughly 60 further entries are untracked.
- **Most untracked entries look like scratch, not work:** root-level `*_out.txt`, `sweep_*.txt`,
  `*_snap.cjs`, `probe-*.cjs`, `scratch_*`, `test_file.txt`, `clean_output.txt`, and a `TFlex Setup/`
  directory. **Three untracked files are this run's orchestration and must be kept, not swept:**
  `.dsh/ORCHESTRATOR-CHARTER.md`, `.dsh/roster-check.mjs` and `.dsh/guard.selftest.mjs`.
  A third group looks like real work from a phase the contract does not describe:
  `src/renderer/state/pagesPanel.ts`, `test/unit/renderer/phase16PagesPanel.test.tsx`,
  `e2e/phase16_*.spec.cjs`, `e2e/retests/def_2*_retest.spec.cjs`, `test-fixtures/tools/*`.
  Some other `e2e/*.cjs` files (flicker diagnostics, probes) are probably scratch — confirm before
  deleting anything.
- **The contract has fallen behind the code.** `REQUIREMENTS.md` ends at **Phase 14.2**, but
  `AGENTS.md` documents an "Animation System (Phase 15)" and the tree contains work named
  `phase16`. So Phases 15 and 16 exist in code and documentation but have **no headings in the
  contract**, which is exactly the disagreement `AGENTS.md` says you must resolve.
- `docs/FEATURE-BACKLOG.md` holds **one entry**, still `PROPOSED`.

## Do this first, in order, and report before starting any feature work

1. **Establish what Phase 15 and Phase 16 actually are** — from the code, the ledgers and
   `AGENTS.md`, not from guesswork — then reconcile `REQUIREMENTS.md`: append the missing phases in
   the original template, each with its feature list, demonstrable success criteria, and the
   mandatory **Settings impact** line. If either does not belong in the contract, say why instead.
2. **Account for the uncommitted working set.** Tell me what those 27 modified files serve — which
   phase or defect — and give me a commit plan. Separate the scratch from the work and list what you
   would delete. **Do not commit anything yet**, and when the time comes, stage explicit paths;
   never `git add .`.
3. **Show me the `PROPOSED` entry in `docs/FEATURE-BACKLOG.md`** and get a disposition from me.
4. **Report status and ask me what to work on next.** Do not open a new phase on your own.

## Local model lifecycle — for reference only

The model is up now; you should not need these until the end of a run, when you unload it.

```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ninfer-model.ps1 status
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ninfer-model.ps1 start
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ninfer-model.ps1 stop
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ninfer-model.ps1 restart
```

`-ExecutionPolicy Bypass` is required on this machine. The preset starts the model for you at the
start of a task and, per the charter, you unload it once the whole run is complete — every child
settled and nothing left to dispatch.

## Verifying the orchestration itself

Two checks live in `.dsh/` and neither is part of `npm run verify`:

```
node .dsh/roster-check.mjs     # the charter's announced routes vs the routes baked into the preset
node .dsh/guard.selftest.mjs   # 44 cases over the guard's decisions
```

Run them if you touch `.dsh/ORCHESTRATOR-CHARTER.md` or the preset. Both exit non-zero on failure.
