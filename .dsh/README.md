# TFlex on the DeepSeek Harness

The DeepSeek Harness port of the OpenCode orchestration in `.opencode/`. The OpenCode setup is
untouched and still works; this layer is additive and independently revertible.

## What changed on disk

| Location | Change |
| --- | --- |
| `~/.dsh/.agent-presets/tflex-orchestrator/` | The preset. Orchestrator charter as the persona, plus five role dispatch tools. **Single source of truth for every role's persona and route.** |
| `~/.dsh/settings.yaml` | `input: ['text', 'image']` declared on five multimodal catalogue entries that were silently text-only. |
| `~/.dsh/settings.yaml` | A `subagent-model-selection` allow-list, kept in sync as a second line of defence. |
| `TFlex/.dsh/` | This README and the ported model-selector skill. |
| `TFlex/scripts/check-conventions.mjs`, `package.json` | The missing verification gate, and a `verify` script. |
| `TFlex/.github/workflows/verify.yml` | CI running that gate on push and pull request. |

Nothing under the shipped preset install
(`C:\Windows\System32\deepseek-harness\packages\preset\agent-presets\presets`) was modified.

Note: the running DSH app also rewrites `settings.yaml` (it owns `ui-chat` and `permission`).
If you edit the provider's model list in the DSH UI, it may rewrite
`llm-pi-ai.providers.openrouter-custom.models` and drop the `input:` declarations — re-check them
after any provider edit.

## Starting a build

Start a **new** DSH session on the **TFlex Orchestrator** preset. It must be new: the harness
snapshots delegation tool definitions when a session is composed.

## The roster

Six roles, one dispatch tool each. Two run locally; the rest use `openrouter-custom`.

| Role | Tool | Route | Sees images |
| --- | --- | --- | --- |
| backend-dev | `dispatch_backend_dev` | **local** `local-ninfer` / `qwen3.8-27b` | yes |
| frontend-dev | `dispatch_frontend_dev` | **local** `local-ninfer` / `qwen3.8-27b` | yes |
| qa | `dispatch_qa` | `z-ai/glm-5.3-flash` | **yes** |
| adversary | `dispatch_adversary` | `deepseek/deepseek-v4-flash` | no |
| git-agent | `dispatch_git_agent` | `z-ai/glm-5.3-flash` | yes |
| feature-scout | `dispatch_feature_scout` | `z-ai/glm-5.3-flash` | yes — **read-only, no write/edit/pwsh** |

The orchestrator runs on `moonshotai/kimi-k2.5` and is deliberately absent from the allow-list,
so no child can be pinned to it.

## The local model

`backend-dev` and `frontend-dev` run on Qwen3.8-27B served locally by NInfer on the RTX 4090, at
`http://127.0.0.1:8080/v1`. The checks that cleared it for agent use:

- `finish_reason: tool_calls` with a correctly named function and well-formed JSON arguments;
- a tool result fed back producing a correct final answer - both halves of the agent loop;
- reasoning returned in a separate `reasoning_content` field, ~148 tok/s decode with MTP.

**Context is 128k, not the engine's maximum.** The engine will take the whole card if asked:
measured free-after-startup is 2.35 GiB at 64k, 1.06 GiB at 128k, 124 MiB at 192k, and zero at
224k and above. 128k is the largest value that still leaves the desktop room. If you change it,
change `--max-context`/`--kv-capacity` in `scripts/ninfer-model.ps1` **and** `contextWindow` in
`settings.yaml` together - they must agree, or DSH compacts far too early (declared too low) or
overruns the server (declared too high).

Two constraints shape the whole arrangement.

**The model owns the GPU.** Loaded, it holds about 23 GiB of the 24.5 GiB card. That is why the
orchestrator loads it before dispatching a local role and offloads it when that work is finished,
and why it must be offloaded before any e2e run.

**qa does not run locally, on purpose.** qa drives the real Electron app under Playwright, and
that needs the GPU the model occupies. A local qa would ask one card to hold both the model and
the app under test, leaving the app about a gigabyte. So qa stays on a cloud route: it is the one
role whose duty is in direct conflict with the model.

Control it with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ninfer-model.ps1 status
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ninfer-model.ps1 start
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ninfer-model.ps1 stop
```

`-ExecutionPolicy Bypass` is mandatory here: the machine's execution policy is Undefined at every
scope, which means Restricted, so a `.ps1` cannot be invoked directly. `start` is idempotent and
blocks until the endpoint answers. Server logs land in `dsh-server.out.log` and
`dsh-server.err.log` beside the model.

Cloud fallbacks for the two local roles, one edit away: `z-ai/glm-5.2` (backend-dev) and
`z-ai/glm-5.3-flash` (frontend-dev). Only the human repins them.
Documented fallbacks, held in the allow-list for repinning: `deepseek/deepseek-v4-pro`
(backend-dev), `minimax/minimax-m3` (frontend-dev, vision-capable),
`google/gemini-3-flash-preview` (qa, vision-capable), `deepseek/deepseek-v4-flash` (adversary,
and feature-scout).

## How dispatch works

**Routes are baked into the tools.** Each dispatch row sets `agentOptions` with its role's
provider and model. A role's route is therefore a property of the tool, not a choice made per
call. This closes the inheritance hole in the model-selection policy: when a call selects
nothing, the engine returns the configured options, so an omitted route lands on the baked route
and never on the *caller's* model. It also means there is no `provider`/`model` parameter to get
wrong, and no model-selection schema in the tool's prompt.

**Personas are injected by the harness.** Each row carries a `persona`, applied by the spawn
provider in the child's creation window. The orchestrator passes only a task spec. Role briefs
cost the orchestrator nothing, cannot be mis-pasted, and cannot be truncated on the way down.

**Roles do not fan out.** Each row's `toolFilter.deny` removes the five sibling dispatch tools,
`subagent_fork` and `workflow` from the child, with the filter applied in that child's creation
window. The orchestrator is the single fan-out point, which keeps the token graph bounded.

**A dispatch blocks and returns its result.** Every delegation row is `backgroundMode: one-shot`,
so an omitted `run_in_background` waits for the child and returns its answer as the call's own
result. This is a deliberate correction: the earlier `continuable` mode made calls return a child
id immediately, and the orchestrator — which has no blocking primitive at that point and a
`list_agents` tool that always answers — filled the gap by polling it in a loop.

Three things were removed rather than documented around:

- **`tool-subagent-control` is gone.** `list_agents`, `send_message` and `interrupt_agent` only
  address *continuable* children. With none in the composition they were three permanently
  callable tools that always answer and never advance the work — the attractor itself. Removing
  them takes `list_agents` out of the tool catalog entirely, so the loop is not merely discouraged,
  it is unavailable. `interrupt` capability is retained through `job_kill`.
- **`continuable` mode is gone**, which also removes the harness-injected prompt section that told
  the orchestrator to "continue useful work while they run" and wait for a settlement notice.
- **`subagent_fork` is now one-shot too**, so a fork child is something you get an answer from, not
  something to wait on.

Concurrency is preserved for the case that needs it. `subagent` is classified *exclusive* by the
harness, so two dispatches in one message run sequentially — but issuing both in one message with
`run_in_background: true` starts both children immediately, and each is then collected with a
single `job_output(wait: true)` (a wait blocks, capped at 10 minutes). That is the documented
parallel pattern in the orchestrator charter, and it needs no polling.

## Feature scouting

`feature-scout` finds capabilities that peer PDF products have and TFlex does not. Ask the
orchestrator for more features and it dispatches the scout, which returns a batch (default 10,
adapting down when the sources are exhausted); the orchestrator shows you the list and records it.

Three things about it are deliberate:

- **It is the one role with no write access.** Its `toolFilter` denies `write`, `edit` and
  `pwsh` outright. It reads untrusted web pages, so the injection-to-write path is closed by
  composition rather than by instruction. The orchestrator persists everything it returns.
- **It establishes "already implemented" from three sources** — `REQUIREMENTS.md` (the claim),
  `CONTROL-INDEX.md`, and the shipped UI itself via `grep` over the toolbar, menu and IPC
  registrations (the evidence). Where those disagree, it reports the disagreement.
- **It filters out network features.** v1 is fully offline, so cloud import, share links,
  online e-sign and subscription tiers are marked OUT-OF-SCOPE and excluded from the count
  rather than padded in.

`docs/FEATURE-SOURCES.md` is the hand-maintained page list it fetches — `web_search` is not
configured on this deployment, so that list is the only discovery surface.
`docs/FEATURE-BACKLOG.md` is the FEA-NNN ledger of what has been proposed and how you disposed
of it; the scout reads it so later batches do not repeat earlier ones.

## Token decisions

- **`ralph` is removed from the preset.** Ralph runs its rounds through the workflow engine using
  a fixed script whose args carry only `{objective, maxRounds, maxHandoffChars}`. There is no
  route parameter on the tool, and the engine attaches `agentOptions` only when a call names
  provider/model — so every round would inherit the *caller's* route, i.e. the orchestrator's
  `kimi-k2.5`, for up to 64 rounds. It is the most expensive construct available here and it
  cannot be pinned, so it is not offered. Re-add it only alongside a subagent provider that can
  be given a default route.
- **`workflow` is kept, with a hard rule.** Every `agent()` call must pass an explicit `provider`
  and `model`, for the same reason. An unnamed call inherits the orchestrator's model. The
  engine is capped at 6 concurrent, 64 total agents and 512 items per call.
- **Sibling dispatch tools are filtered out of every child**, which removes seven tool schemas
  from each child's prompt on top of preventing nested fan-out.
- **The no-op sweep and the silence attack are no longer duplicated.** qa owns the *current*
  phase's CONTROL-INDEX sweep; the adversary owns the *retroactive* silence attack across prior
  phases at the gate. Previously both clicked every control.
- **The gate is risk-based.** A full sweep only when the phase touched shared contracts,
  overlays, pointer/event handling, persistence or packaging — plus one every third phase. A
  uniform full sweep over all phases at every gate is superlinear and was becoming the dominant
  cost.
- **Batch dispatches.** Independent dispatches go out in one message rather than one per turn.

## The verification gate

The orchestration previously had no mechanical gate at all: `typecheck`, `test:unit` and
`test:e2e` existed as scripts but nothing ran them, and there was no lint config, no CI and no
git hooks. "Green" meant an agent's claim plus a log file that same agent wrote.

`scripts/check-conventions.mjs` (dependency-free) enforces the three conventions that were pure
prose before:

- no emoji in `src/`;
- no network calls in product code (`fetch`, `axios`, `http(s)://`, `net.`, `dns.`,
  `XMLHttpRequest`);
- no dev files under `release/`.

Two scripts, because `AGENTS_NOTES.md` (2026-09-07) directs that *agents* do not run the full
suite automatically — that is what costs agent turns and tokens:

- `npm run verify` — conventions plus `typecheck`. Cheap. This is what a developer or qa runs
  after a change.
- `npm run verify:full` — the above plus `test:unit`. For pre-release gates and CI.

`.github/workflows/verify.yml` runs `verify:full` on push and pull request. CI is not an agent, so
it pays no agent-turn cost, and a push is exactly the pre-release point that the 2026-09-07
directive reserves the full suite for. The workflow is inert if Actions is not enabled for the
repo, and the e2e suite stays out of it: it drives a real Electron app and needs a display, which
makes it a poor fit for every push. qa owns running it.

## Known limits

- **No per-path role ACL.** DSH confines by `(mode, workspace root)` per session and filters by
  tool *name*, not tool *path*. There is no equivalent of OpenCode's per-file `edit` deny-list,
  so "backend-dev may write `src/main` but not `src/renderer`" is enforced by the persona text
  only. This is the one axis on which the port is weaker than OpenCode, and it is fixed only by
  Tier 2 (see below) or by a host-plane fs policy.
- **The sandbox mode is not the preset's to control.** If a session runs read-only, every child
  is read-only and a build cannot run. Start TFlex sessions with a writable preset.
- **`subagent_fork` children run on the orchestrator's route.** Fork deliberately keeps
  provider/model equal to the parent so the inherited prefix stays eligible for KV-cache reuse.
  It is for judgement passes over current context, never for implementation.
- **Tier 2 is not installed.** `@deepseek-ai/dsh-subagent-dsh-sdk`, which would run each role as
  a separate DSH process with its own profile and its own sandbox posture, is not available at
  this deployment's version: npm publishes the `@deepseek-ai` family at `0.0.1-rc.1` while this
  deployment runs `0.1.5-rc.2`, and the matching build's dependency closure is a pnpm link farm
  the standalone `web` profile does not inherit.

## Reverting

Everything is reversible from `C:\Users\tanzi\.dsh\backups\pre-tflex-integration\`:

- `settings.yaml` — the pre-integration original.
- `profiles-web\` — the original profile directory.
- `MANIFEST.txt` — what was recorded, including that `.agent-presets` did not exist.
- `revert.ps1` — restores `settings.yaml`, deletes the authored preset (and `.agent-presets` if
  it is then empty), and removes `TFlex/.dsh`.

`revert.ps1` does not touch the verification gate added to the product repo; remove
`scripts/check-conventions.mjs`, the `verify` script, and `.github/workflows/verify.yml` by hand
if you want those gone too.
