# TFlex — Build Rules

These rules apply to every agent working on this project.

## The job

Build TFlex exactly as specified in REQUIREMENTS.md. That document is the contract: its
phases, success criteria and final criteria decide when work is done. When in doubt,
REQUIREMENTS.md wins.

For post-v1 feature work: the orchestrator promotes human feature requests into
REQUIREMENTS.md itself — appended numbered phases (Phase 6, 7, ...) with feature lists
and demonstrable success criteria, in the original format and phase template. The
original v1 text stays frozen; extensions are appended, never rewritten. Ledgers
(DEF-NNN, ADV-NNN numbering) continue across all phases and extend forever.

Every phase plan also carries a **Settings impact** line: either "none" or the new
AppSettings fields it introduces (name, default, validation/normalization rule, and
which IPC transports it). The developer implements the field's validation in
`src/main/services/settings.ts` (mirroring the Phase-6 pattern: preserve-if-valid,
reject-if-invalid) before any renderer code reads it. This rule came from the
Phase-7+ backlog — new feature buckets like Optimize/Create/Export/OCR each carry
their own settings (per-tool defaults, export formats, OCR language, etc.) and must
never grow the settings shape ad-hoc.

## The team

- **orchestrator** (primary) — plans, delegates, reviews, gates phases. Does not write code.
- **frontend-dev** — all renderer code (React UI, PDF.js display, interactions) and
  renderer unit tests.
- **backend-dev** — all main-process code: the PDF engine (pdf-lib), file I/O, persistence,
  IPC services, packaging — and backend unit tests.
- **qa** — end-to-end tests, test runs, screenshots, DEFECTS.md. Does not fix code.
- **adversary** — tries to break the running app and its PDF handling; records findings in
  ADVERSARIAL_REVIEW.md.
- **git-agent** — local git operations: initial commits, remote setup, tagging, pushes to
  origin, and verifying the OTA update release pipeline. Never edits product code,
  tests, or ledgers.

Role boundaries are enforced by permissions and are absolute. Do not work around them with
shell commands: if the edit tool would deny a file, do not modify that file any other way.

Shared contracts live in `src/shared/` (typed IPC and domain types). Both developers may
read them; only the orchestrator may approve changes to them mid-phase (a developer
proposes, the orchestrator amends the task spec).

## Repository conventions

- Distribution layout — two zones, never mixed. `release/` (electron-builder output)
  is the ONLY folder for user-sharable application files: the NSIS installer, the
  portable build, and `latest.yml`. Everything else is dev-only: source (`src/`),
  tests (`e2e/`, `test/`), fixtures, screenshots, ledgers, orchestration
  (`.opencode/`, `AGENTS*.md`), build intermediates (`dist/`), and tooling configs.
  No dev file may be placed under `release/`, and no packaging step may emit user
  artifacts anywhere else. Sample PDFs bundled INTO the installer are assets
  (`assets/`), referenced by the builder — they are not copies dropped into
  `release/` by hand.
- Fail loud: no silent no-ops. Every control introduced in a phase must implement its
  promised behavior; a click that does nothing is a defect, not polish. Developers
  return a CONTROL-INDEX with each phase — a list of every control it introduces with
  promised action and the e2e test that proves it; qa verifies it (see the qa
  definition, "no-op sweep").
- End-to-end tests, and their configuration, live under `e2e/`. Only qa writes there.
  Electron launches in e2e all go through the canonical helper `e2e/lib/launch.cjs`
  (import `launchApp`) — no ad-hoc launchers. Paths with spaces (this repo) are passed
  as separate argv array elements, never through shell shims (`*.cmd`) or concatenated
  `file://` strings. `npm run test:e2e` (i.e. `playwright test`) is the only runner
  command — use `npm.cmd` per machine policy.
- Screenshots live under `screenshots/`.
- Test fixture PDFs live under `test-fixtures/`. Only qa and adversary add files there.
- Permission patterns in agent definitions list both `dir/*` and `dir/**` forms for every
  allowed directory — some glob matchers treat `dir/**` as nested-paths-only and deny
  direct children. Do not "simplify" these to the `**` form alone.
- No emojis in code, comments, print statements, logging, or UI. Use the project's icon set.
- Keep it simple: small modules, clear names, no defensive programming, no overengineering.
  Prefer popular, well-supported libraries over custom code.
- No network calls in product code. v1 is fully offline.

## DEFECTS.md — the defect ledger

All defects live in `DEFECTS.md` at the repo root, one entry per defect, newest first.
Writers: **qa** (create, close, reopen) and **orchestrator** (record developer responses,
reject). Nobody else edits it, ever.

Format, exactly:

```
## DEF-001: Short title

- Status: OPEN
- Severity: HIGH | MEDIUM | LOW
- Found by: qa | adversary (ADV-003)
- Phase: 3

Steps to reproduce:
1. Numbered, specific, starting from app launch.

Expected: What should happen.
Actual: What happens instead.
Screenshot: screenshots/def-001.png (optional)

History:
- qa: opened

```

Statuses and who may set them:

| Status| Meaning| Set by|
| ---| ---| ---|
| OPEN| Filed, or reopened after a failed retest or a bounced dispute| qa|
| FIX-READY| A developer reports a fix is in| orchestrator, relaying the developer|
| DISPUTED| A developer reports CANNOT REPRODUCE or WORKING AS INTENDED, with a reason| orchestrator, relaying the developer verbatim|
| CLOSED| qa retested and confirmed the fix, or accepted the dispute| qa only|
| REJECTED| Will not fix, with a written reason| orchestrator only|

Every status change appends a History line saying who, what and why. A defect is never done
because a developer says so — it is done when qa closes it.

## ADVERSARIAL_REVIEW.md — the adversary's findings

All adversary findings live in `ADVERSARIAL_REVIEW.md` at the repo root.
Writers: **adversary** (create entries) and **orchestrator** (fill Disposition). Nobody else.

Format, exactly:

```
## ADV-001: Short title

- Session: phase-3 gate | final
- Suggested severity: HIGH | MEDIUM | LOW

What I did: ...
Expected: ...
Actual: ...
Screenshot: screenshots/adv-001.png (optional)

Disposition: PENDING

```

The orchestrator replaces PENDING with either `ACCEPTED -> DEF-NNN` or
`REJECTED - reason`. Accepted findings are reproduced and filed in DEFECTS.md by qa.
No entry may remain PENDING when the final phase completes.

## Model integrity — hard stop rule

Every agent runs only on the model pinned in its `.opencode/agents/*.md` definition.
The orchestrator's model, `openrouter/moonshotai/kimi-k3`, is reserved for the
orchestrator alone — a sub-agent starting on it is a silent fallback, exactly like any
other wrong model. If a sub-agent cannot load its pinned model (provider error, account
data-policy rejection, invalid ID) or starts on any other model, the build **stops** —
no planning, no real task dispatch, no work on the fallback model. The orchestrator
reports the failure to the human operator and waits. The orchestrator's startup probe
gate (see its definition, "Model verification gate") enforces this. Only the human may
resolve a model failure (fix the account setting, or swap the `model:` field per the
fallback table below) and restart the build.

## Model fallbacks

Each agent's model is pinned in its definition in `.opencode/agents/`. If a model
repeatedly fails at its role (tool-call errors, ignoring formats, incoherent output),
the human operator may swap that agent's `model:` field to the documented fallback:

- backend-dev: z-ai/glm-5.2 -> deepseek/deepseek-v4-pro
- frontend-dev: minimax/minimax-m3:free -> minimax/minimax-m3 (paid route — use when the
  free route is rate-limited or unavailable; the free route was previously blocked by the
  operator account's data policy and re-enabled 2026-08-30 after a policy change)
- qa: google/gemini-3-flash-preview -> deepseek/deepseek-v4-flash-vision-exp (note: the
  vision-exp model is served by a single provider, DeepSeek; if your account's data policy
  blocks it, stay on gemini-3-flash-preview)
- adversary: deepseek/deepseek-v4-flash -> google/gemini-3-flash-preview
- git-agent: z-ai/glm-5.3-flash -> google/gemini-3-flash-preview
- orchestrator: no fallback — stop and ask the human.

Fallback to the orchestrator's model (`openrouter/moonshotai/kimi-k3`) is never
permitted for any sub-agent. The table above is the only valid fallback source.

2026-08-30 (third swap): frontend-dev re-pinned from minimax/minimax-m3 back to
minimax/minimax-m3:free. The operator updated the OpenRouter account data policy to allow
the free-route providers, unblocking the route that failed the earlier probe gate.
Paid route remains the fallback for rate-limit outages.

2026-08-30 (second swap): frontend-dev reverted from minimax/minimax-m3:free back to
minimax/minimax-m3. The free route failed the probe gate with an account-level provider
rejection ("No endpoints available matching your guardrail restrictions and data policy")
— same class as the 2026-08-27 qa vision-exp rejection. Fallback applied per this table;
backend-dev stays on z-ai/glm-5.2 (probed READY).

2026-08-30: backend-dev primary changed from deepseek/deepseek-v4-pro to z-ai/glm-5.2
($0.33/M in vs $0.57/M in, 77% discount, 1M context; the old primary becomes the fallback),
and frontend-dev primary changed from minimax/minimax-m3 to minimax/minimax-m3:free
(identical weights, free route; the paid route becomes the fallback for rate-limit
outages). New primary selections by the human operator after a discounted/free-model cost
analysis — not emergency fallbacks. Recorded here per this section's rule.

2026-08-27: qa model changed from deepseek/deepseek-v4-flash-vision-exp to
google/gemini-3-flash-preview before first run — vision-exp is single-provider (DeepSeek)
and was rejected by the operator account's data policy ("No endpoints available matching
your guardrail restrictions"). Recorded here per this section's rule.

After any swap, note it in `AGENTS_NOTES.md` (create it if needed) with the date and reason.

## Escalation after three failed attempts

If a sub-agent has failed to fix the same issue after three attempts, it must stop —
looping on a fourth attempt burns tokens without progress. It reports back to the
orchestrator with all the logs:

- The exact failing command and its full output (test run, build error, defect retest).
- What each of the three attempts changed, and what each returned.

The orchestrator analyzes the logs and replies with a written suggestion — a hypothesis
about the root cause, a different approach to try, or an amended task spec or shared
contract if the spec is the problem — then re-dispatches the same sub-agent to
continue. The orchestrator never takes over the fix and never writes code; the same
agent keeps doing its own work.
