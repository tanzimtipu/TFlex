# TFlex on the DeepSeek Harness

The DeepSeek Harness port of the OpenCode orchestration in `.opencode/`. The OpenCode setup is
untouched and still works; this layer is additive and independently revertible.

## What changed on disk

| Location | Change |
| --- | --- |
| `~/.dsh/.agent-presets/tflex-orchestrator/agent.cordis.yml` | The preset: six role dispatch tools, the guard row, and the persona. **Single source of truth for every role's persona and route.** |
| `~/.dsh/.agent-presets/tflex-orchestrator/orchestrator-guard.vN.js` | Preset-local enforcement (ledgers, full suite, polling, resumability, model pre-flight). Bump `.vN` to change it. |
| `~/.dsh/.agent-presets/tflex-orchestrator/orchestrator-charter.js` | Makes the orchestrator's rules a file-backed prompt variable, so charter edits are live. |
| `TFlex/.dsh/ORCHESTRATOR-CHARTER.md` | The orchestrator's rules. Edit this freely — it takes effect on the next turn, no new session. |
| `~/.dsh/settings.yaml` | `input: ['text', 'image']` declared on five multimodal catalogue entries that were silently text-only. |
| `~/.dsh/settings.yaml` | A `subagent-model-selection` allow-list, kept in sync as a second line of defence. |
| `TFlex/.dsh/` | This README, the charter, `roster-check.mjs` (charter roster vs baked routes) and `guard.selftest.mjs`, plus the ported model-selector skill. |
| `TFlex/scripts/ninfer-model.ps1` | The local model's serving profile and lifecycle, with every measured number recorded. |
| `TFlex/scripts/check-conventions.mjs`, `package.json` | The missing verification gate, and a `verify` script. |
| `TFlex/.github/workflows/verify.yml` | CI running that gate on push and pull request. |

Nothing under the shipped preset install
(`C:\Windows\System32\deepseek-harness\packages\preset\agent-presets\presets`) was modified.

Note: the running DSH app also rewrites `settings.yaml` (it owns `ui-chat` and `permission`).
If you edit the provider's model list in the DSH UI, it may rewrite
`llm-pi-ai.providers.openrouter-custom.models` and drop the `input:` declarations — re-check them
after any provider edit.

## Changing the orchestration — what is live and what needs a new session

**The orchestrator's rules are a FILE, and editing it is live.** `~/.dsh/.agent-presets/
tflex-orchestrator/orchestrator-charter.js` registers a prompt *variable* that reads
`.dsh/ORCHESTRATOR-CHARTER.md`. Prompt variables are evaluated on every assembly, and assembly
runs before every model step — so a charter edit reaches a session that is **already open**, on its
next turn. No new session, no process restart, no `.vN` bump.

Verified, not assumed: appending a marker line to the charter changed the assembled variable from
15,891 to 15,913 characters and moved the tail to the marker, in a running process, with no new
session.

Everything else, by what it changes:

| What you edit | Reaches an open session? | Why |
| --- | --- | --- |
| `.dsh/ORCHESTRATOR-CHARTER.md` | **yes, next turn** | file-backed prompt variable, re-read per assembly |
| `AGENTS.md` | **yes, next turn** | `agent-instructions` re-reads workspace instruction files |
| Host composition, `settings.yaml` | **yes** | host rows hot-reload; the model route is read per request |
| `agent.cordis.yml` **rows** — routes, `backgroundMode`, `toolFilter`, a role's persona, which tools exist | **no — new session** | these become the agent's composition when it is composed |
| `orchestrator-guard.vN.js` logic | **no — bump `.vN`** | the Loader imports it by URL and Node caches an ESM module for the process lifetime |

The row case is a harness invariant, not a limitation of this preset: `dsh-scope` keys are
**identity-compared** (`WeakMap`, and `ensureStanding` builds a fresh `{ agentPreset }` literal per
generation), so an agent already bound to one standing generation never sees a later one. Prompt
text is live; the tool table is not.

So: **start a new session only when you change a ROW.** Starting one per rules tweak was never
necessary, and the charter is where rules belong. Nothing here ever needs killing the `dsh web`
server — if a change looks inert, the cause is an open session or a stale `.vN`, not the process.

## The roster

Six roles, one dispatch tool each. Five run locally; `feature-scout` alone uses `openrouter-custom`.

| Role | Tool | Route | Sees images |
| --- | --- | --- | --- |
| backend-dev | `dispatch_backend_dev` | **local** `local-ninfer` / `qwen3.8-27b` | yes |
| frontend-dev | `dispatch_frontend_dev` | **local** `local-ninfer` / `qwen3.8-27b` | yes |
| adversary | `dispatch_adversary` | **local** `local-ninfer` / `qwen3.8-27b` | yes |
| git-agent | `dispatch_git_agent` | **local** `local-ninfer` / `qwen3.8-27b` | yes |
| qa | `dispatch_qa` | **local** `local-ninfer` / `qwen3.8-27b` | yes |
| feature-scout | `dispatch_feature_scout` | `openrouter-custom` / `z-ai/glm-5.3-flash` | yes — **read-only, no write/edit/pwsh** |

The orchestrator runs on `moonshotai/kimi-k2.5` and is deliberately absent from the allow-list,
so no child can be pinned to it.

## The local model

`backend-dev`, `frontend-dev`, `qa`, `adversary` and `git-agent` run on Qwen3.8-27B served locally
by NInfer on the RTX 4090, at `http://127.0.0.1:8080/v1`. The checks that cleared it for agent use:

- `finish_reason: tool_calls` with a correctly named function and well-formed JSON arguments;
- a tool result fed back producing a correct final answer - both halves of the agent loop;
- reasoning returned in a separate `reasoning_content` field;
- vision: an image sent through the OpenAI chat shape is described correctly (measured 1.4 s for
  a solid-colour test image, answered "Red").

**Context is 264000 tokens, and the KV dtype is what makes that fit.** Weights are 16.95 GiB and
the Windows desktop already holds ~2.2 GiB of the 24.0 GiB card, so the pool has to fit in what
is left. Measured engine reservations at 264000 tokens, vision on, **at 2 slots** (the dtype
choice; the slot count is a separate trade in the table further down):

| KV dtype | Engine needs | Fits in 5.55 GiB? |
| --- | --- | --- |
| `rk4v4-e8` (4-bit K/V) | 6.71 GiB | no |
| `rk2v4-e8` (2-bit K, 4-bit V) | 5.09 GiB | yes, 476 MiB slack |

`rk2v4-e8` is therefore the only layout that reaches 264k with vision at all. The cost is K-side
precision, so very long retrieval is less reliable than at 4-bit (`rk4v4-e8` measures 98.7% cosine
against FP32). Short and mid context verified accurate; retrieval beyond ~100k is unverified.

**Do not add `--wddm-evictable-budget` at this context length.** It raises the engine's budget
from 5.55 GiB to 6.54 GiB, which makes the 4-bit layout "fit" - and it is a trap. The flag budgets
against *total* VRAM while ignoring the desktop's 2.2 GiB, so the engine over-commits and WDDM
evicts the pool to system RAM. Measured with it: decode fell to 0.7 tok/s, ttft 2986 ms, 164 s for
120 tokens. Without it, at `rk2v4-e8`: **103.6 tok/s** single-stream decode, 114 ms ttft, ~1830
tok/s prefill (a 14458-token prompt in 7.9 s) on a fresh server, settling to 45-63 tok/s on warm
sequential requests.

If you change the context, change `--max-context`/`--kv-capacity` in `scripts/ninfer-model.ps1`
**and** `contextWindow` in `settings.yaml` together - they must agree, or DSH compacts far too
early (declared too low) or overruns the server (declared too high). `/v1/models` reports the
server's own `context_window` and `max_model_len`, so the two can be diffed directly.

One constraint shapes the whole arrangement.

**The model owns the GPU.** Loaded, it holds about 23.8 GiB of the 24.5 GiB card, leaving ~250
MiB free. That is why the orchestrator loads it before dispatching a local role and offloads it
when that work is finished.

**feature-scout alone is off the local model.** It stays on `openrouter-custom` /
`z-ai/glm-5.3-flash`.

**qa runs ON the local model, and the e2e suite shares the card with it.** This replaces the
earlier "stop the model before an e2e run" rule, which was written when qa was cloud and the
context was 131072 tokens. qa now *is* a local child, so offloading the model to free the GPU
would kill the agent running the suite. Measured on this machine at the 264000-token profile with
only ~240 MiB free: the packaged app still starts, spawns its `gpu-process` and renderer, and
comes up with a titled window, while `ninfer-serve.exe` stays resident and keeps serving. Both
appear simultaneously in `nvidia-smi` as GPU clients. So the model is left loaded for qa.

The honest limit on that measurement: it proves a **launch and a window**, not a full Playwright
run. PDF canvas rendering, screenshots and long renderer sessions are heavier than the idle window
I measured. If an e2e run does misbehave on the GPU, treat it as a finding and report it with the
evidence - do not work around it by offloading the model mid-suite, because that kills qa's own
inference. The pressure valve, if it comes to that, is the context length: it scales every slot's
pool proportionally, so it is the one lever that buys back real memory.

**Concurrency is 3, and slots are expensive because the KV pool is per slot.** The engine reported
`pages=4125` at concurrency 1, `8250` at 2 and `12375` at 3 - each decode slot gets its own
full-capacity pool, which is why the third slot had to be bought from the vision scratchpad.
Measured at `--max-context 264000`, `rk2v4-e8`, `--vision`:

| Slots | `--vision-max-tokens` | Engine needs | Result |
| --- | --- | --- | --- |
| 2 | 8192 | 5.09 GiB | fits, 476 MiB slack |
| 3 | 8192 | 5.63 GiB | **refused, 81 MiB short** |
| 3 | 2048 | 5.26 GiB | fits, 304 MiB slack (current) |
| 4 | any | ~5.8 GiB | cannot fit |

Three is therefore the ceiling at 264000 tokens. Verified with three concurrent requests:
`avg_decode_batch=3.00` and all three completed. The cost of using all three is throughput - each
stream falls to ~16 tok/s (a lone request gets 45-103 tok/s) and speculative acceptance drops from
~60% to ~31%. Three slower streams still beat three strictly sequential ones, which is the point.

`--vision-max-tokens 2048` is the price of the third slot, and it does **not** fail on a large
image: the encoder downsamples to the budget. A 1280x800 and a 2560x1440 screenshot both came back
at exactly 2049 prompt tokens, and both were transcribed correctly. What it costs is fine detail -
treat a very small UI label as unreadable. The alternative, if that detail is ever needed, is 3
slots at `--max-context 250048` with the full 8192 scratchpad; that also starts, but with only
107 MiB of slack, so one more desktop allocation could stop the server from starting at all.

`--pending-timeout-ms 300000` is what makes queueing safe. With the default 30-second pending
timeout, work queued behind the slots was rejected ("expired while waiting for admission"), which
arrives in DSH as a dispatch error with zero content. A five-minute timeout means a queued request
waits instead of failing.
Control it with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ninfer-model.ps1 status
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ninfer-model.ps1 start
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ninfer-model.ps1 stop
```

`-ExecutionPolicy Bypass` is mandatory here: the machine's execution policy is Undefined at every
scope, which means Restricted, so a `.ps1` cannot be invoked directly. `start` is idempotent,
blocks until the endpoint answers, and then serves one throwaway request, because the HTTP
listener answers several seconds before the engine finishes warming (a first request measured 8.0
tok/s against 45-63 tok/s once warm). Server logs land in `dsh-server.out.log` and
`dsh-server.err.log` beside the model.

**The provider needs an `apiKeyEnv`.** A custom (non-catalogue) provider always demands a
credential even when the server ignores auth, so `local-ninfer` declares
`apiKeyEnv: NINFER_API_KEY` and the credential store holds a dummy value. Omit it and every call
fails with `No API key for provider` *before* any HTTP request is made - the server log stays
empty, and that empty log is the tell for this particular fault.
Cloud fallbacks for the five local roles, one edit away: `z-ai/glm-5.2` (backend-dev),
`~deepseek/deepseek-v4-flash-latest` (frontend-dev), `z-ai/glm-5.3-flash` (qa and git-agent)
and `deepseek/deepseek-v4-flash` (adversary). Only the human repins them.
Documented fallbacks, held in the allow-list for repinning: `deepseek/deepseek-v4-pro`
(backend-dev), `minimax/minimax-m3` (frontend-dev, vision-capable),
`google/gemini-3-flash-preview` (qa, vision-capable), `deepseek/deepseek-v4-flash` (feature-scout).

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

**Every dispatch is announced.** The orchestrator prints the role and its route before each
dispatch (`-> backend-dev  [local-ninfer / qwen3.8-27b]  fix DEF-200 cascade order`) and names the
role again when it reports the result. This has to come from the charter rather than the tool: a
role's route is baked into its row and is not readable from the tool schema. The roster is therefore
a second copy of the truth, and nothing in the harness compares it — so `.dsh/roster-check.mjs`
does: it parses the roster out of the charter and the `agentOptions` out of every dispatch row and
fails on any difference. Run it after touching either file. It matters because the two are edited
differently (the charter is live, the rows need a new session), so they can drift silently — and a
wrong route in an announcement is a lie about which model did the work.
**Roles do not fan out.** Each row's `toolFilter.deny` removes the five sibling dispatch tools,
`subagent_fork`, `workflow` and the three child-control tools from the child, with the filter
applied in that child's creation window. The orchestrator is the single fan-out point, which
keeps the token graph bounded.

**How a dispatch returns depends on the role.** `feature-scout` is `backgroundMode: one-shot`, so
an omitted `run_in_background` waits for the child and returns its answer as the call's own result.
**Every local role - backend-dev, frontend-dev, qa, adversary, git-agent - is `continuable`**: the
call returns a durable subagent id at once and the runtime sends the orchestrator a notice when that
run settles. Two things follow, and they are the reason for the split:

1. **A child that runs out of room can be resumed.** Its session is durable, so a context or token
   exhaustion is recoverable with `send_message(id, "continue ...")` instead of throwing away
   everything the child had read. That matters most for the source-reading roles, whose context is
   the most expensive on the team to lose, and for qa, which loses a whole e2e run.
2. **`list_agents` does not exist here, so nothing can poll.** The polling loop that forced the
   earlier rollback came from that tool always answering. `tool-subagent-control` registers only
   `send_message` and `interrupt_agent` — its `list-agents.ts` module is a separate plugin that no
   row names. So there is no status tool to poll *at all*, which is stronger than denying one. The
   guard still refuses the name if it ever appears (a future row could mount that plugin), but today
   the check is dormant insurance rather than the thing keeping the loop away.

**Which roles can actually be resumed.** Every local role. `send_message` addresses *continuable*
children and nothing else, so a dispatch to `feature-scout` - the one remaining one-shot row - ends
that child's run with no durable id to continue, and recovering there means a fresh dispatch with a
hand-off spec. Resuming does not restart or kill anything either: `send_message` steers a working
child at its nearest step boundary, and on an idle child it appends a turn. `interrupt_agent` is the
only tool that stops a turn, and the persona reserves it for a child that has genuinely gone off the
rails.

**Up to three local agents run at once.** The server has three decode slots, and the persona now
says so explicitly (the harness injects a "these run in the background by default, start independent
delegations together" section for every continuable row, which for these rows is now accurate rather
than something to override). Two rules bound it:

- **backend-dev and frontend-dev are never in flight together.** They share one working tree, so two
  of them editing at once can overwrite each other or collide in `src/shared/`. One developer at a
  time; the other slots go to other roles. This is the operator's standing rule and it is
  deliberately advisory in the brief rather than enforced by the guard - the guard cannot see which
  children are still in flight.
- **One task per role.** Three things to do means three dispatches to three different roles, sent
  together in one message if you like; never a queue behind one role.

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

## Enforcement — what the harness refuses on the orchestrator's behalf

Five of the orchestrator's rules are not prose any more: the preset itself refuses the call. The
row is `orchestrator-guard` → `orchestrator-guard.v8.js` in the preset directory (a
preset-relative module, so the preset ships its own policy code, not a package). It registers a
`tools/pre-execute` listener and checks `ctx.agents.roots()` first, so **every rule applies to
the orchestrator only** — backend-dev, frontend-dev, qa, adversary, git-agent and feature-scout
are sub-agents, are not roots, and are untouched.

| Rule | What is refused |
| --- | --- |
| Ledgers only | `write`/`edit` on anything but DEFECTS.md, ADVERSARIAL_REVIEW.md, REQUIREMENTS.md, docs/FEATURE-BACKLOG.md, AGENTS_NOTES.md |
| No full suite | a bare `npm run test:unit`, `verify:full`, `test:e2e` or `playwright test`. A filtered run (`-- --grep`, a spec path) is allowed |
| No polling | `list_agents` — **dormant**: that tool is not registered in this deployment at all (`tool-subagent-control` registers only `send_message` and `interrupt_agent`), so there is nothing to poll. The refusal is insurance in case a future row mounts the `list-agents` plugin |
| Resumable roles | `run_in_background: false` on any local dispatch (backend-dev, frontend-dev, qa, adversary, git-agent) — the foreground path is a one-shot run, so the child gets no durable id and `send_message` could never resume it. Omit the parameter instead |
| Model before dispatch | a backend-dev, frontend-dev, qa, adversary or git-agent dispatch while nothing answers on `http://127.0.0.1:8080/v1/models`. The guard runs `scripts/ninfer-model.ps1 start` first, and this is the ONE check that **fails closed**: if it still cannot confirm the endpoint, the dispatch is refused with the cause, because a dispatch into a stopped server otherwise dies as an opaque "Connection error" after burning a child run |

The guard also does one thing that is **not** a denial: on the first tool call of each new TURN it
ensures the local model is loaded, so a cold server warms while the orchestrator plans instead of
stalling its first dispatch. Turn-scoped, not per-call — per-call would fight the orchestrator's own
`stop` at the end of a run (the stop call would load the model, and the next call would undo the
unload). A load failure there is only logged; the per-dispatch pre-flight is the gate that actually
protects a dispatch, and a `ninfer-model.ps1` lifecycle command never triggers a load at all.

The **drift** checks fail open: if the caller cannot be identified or the `agents` service is
missing, the call proceeds, so a fault there can never wedge the build. The **model pre-flight is the
deliberate exception and fails closed** — it guards an outcome rather than a policy, and an
unverifiable local dispatch is refused with its cause instead of being allowed to die as a transport
error. Setting `TFLEX_GUARD=off` in the harness process environment disables all five checks.
Each decision is appended to `guard.log` beside the preset, which is the only way to see them
from outside a session. `.dsh/guard.selftest.mjs` drives the real module with a fake context and
asserts all 44 decisions — run `node .dsh/guard.selftest.mjs` after editing the guard. Its fake
context supplies a stub shell that reports a successful start, so the local-dispatch cases stay
deterministic whether or not the real server happens to be running.

**A `toolFilter` name must be a REGISTERED global tool, and no mount check will tell you.**
`tools.restrict()` rejects a deny/allow name it does not know — but that call happens in the child's
creation window, so a bad name fails at the first dispatch, not at session start or mount. This bit
us: seven rows denied `list_agents`, which is not registered, and the first dispatch died with
`tools.restrict() names unknown global tool "list_agents"`. Mount validation had passed, because it
never composes a child.

Before changing a `toolFilter`, confirm every name appears in the tool list the runtime reports (an
unknown name produces exactly that error, and the error helpfully lists the valid ones), or in the
preset's own rows for the `dispatch_*` names. The `dispatch_*` tools are registered by this preset,
so they are valid; anything from a package must actually be registered by a row you mount.

**A full slot set queues; it does not fail.** With three slots and a 16-deep pending queue
(`--pending-timeout-ms 300000`), a fourth and fifth local dispatch wait for a slot rather than being
rejected. Measured: five requests onto three slots all completed, the excess simply showing a longer
time to first token (12–18s while three agents were mid-turn). So a local dispatch that takes a
while is the system working; a real failure announces itself explicitly.

Note what a guard can and cannot do. It cannot make the orchestrator *triage well* — only the
brief and the model do that. It removes the five drift modes that cost the most: editing source
instead of dispatching, burning a turn on a full suite, dispatching into a stopped server, and
polling a child that will report itself.

**Editing the guard needs the `.vN` suffix bumped.** The row names the file by URL, Node caches
an ESM module for the process lifetime, and the roster's change stamp covers only
`agent.cordis.yml`. Bump the suffix, update the row, update the URL in `.dsh/guard.selftest.mjs`,
and the next session picks it up with no process restart.

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
