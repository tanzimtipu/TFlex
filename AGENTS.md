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
other wrong model. A pin may be hosted (`openrouter/<id>`) or local (`local/<id>` served
via `llama-server` on `http://127.0.0.1:8080`); both are valid. If a sub-agent cannot load
its pinned model (provider error, account data-policy rejection, local server not running,
invalid ID) or starts on any other model, the build **stops** —
no planning, no real task dispatch, no work on the fallback model. For local-pinned
agents, the orchestrator's model-loading rules in its definition ("Local sub-agent model
lifecycle") decide which `.cmd` script must start/stop `llama-server`; a missing or
unhealthy local server is a hard stop. The orchestrator's startup probe gate (see its
definition, "Model verification gate") enforces this. Only the human may resolve a model
failure (fix the account setting, start the local server, or swap the `model:` field per
the fallback table below) and restart the build.

## Model fallbacks

Each agent's model is pinned in its definition in `.opencode/agents/`. If a model
repeatedly fails at its role (tool-call errors, ignoring formats, incoherent output),
the human operator may swap that agent's `model:` field to the documented fallback:

- backend-dev: local/qwen3-coder-30b -> no fallback
- frontend-dev: local/qwen3-coder-30b -> no fallback
- qa: google/gemini-3-flash-preview -> deepseek/deepseek-v4-flash-vision-exp (note: the
  vision-exp model is single-provider; if the account data policy blocks it, stay on
  gemini-3-flash-preview) — reverted from the local Qwen2.5-VL-32B pin after it failed
  the probe gate (hung on vision probe)
- adversary: openrouter/deepseek/deepseek-v4-flash -> no fallback
- git-agent: local/qwen3-4b -> no fallback
- orchestrator: no fallback — stop and ask the human.

"local/…" pins are served by `llama-server` on `http://127.0.0.1:8080` (scripts
`start-*.cmd` / `stop-llama-server.cmd` under the temp llama.cpp folder). If a local
server cannot start or stays unhealthy, stop — do not dispatch on any other model.
Historical OpenRouter pins for these roles are preserved in the
`.opencode/backups/2026-08-30-pre-local-models/` snapshot (also tagged
`backup-pre-local-models` in git).

Fallback to the orchestrator's model (`openrouter/moonshotai/kimi-k3`) is never
permitted for any sub-agent. The table above is the only valid fallback source.

2026-08-30 (local migration): backend-dev/frontend-dev/qa/git-agent moved to local
`local/…` GGUF models (Qwen3-Coder-30B, Qwen2.5-VL-32B, Qwen3-4B) served via `llama-server`
on the operator's RTX 4090; adversary stays hosted on `openrouter/deepseek/deepseek-v4-flash`.
No fallbacks declared at this time. Prior hosted pins remain in the
`.opencode/backups/2026-08-30-pre-local-models/` snapshot (and are tagged
`backup-pre-local-models` in git). Recorded here per this section's rule.

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
