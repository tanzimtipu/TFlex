# AGENTS_NOTES.md — archived operational history

## 2026-10-09: Phase-close commit must gate on the QA verdict, not a sibling's completion (TFL-1430 Phase 127)

Phase 127 chained A (dev) -> B (qa) -> C (adversary) -> D (git-agent commit). D was
`blockedBy` C only, so when C completed (adversary PASS) D auto-ran and committed
`4d51942` even though B had returned a **FAIL** phase-close verdict (DEF-666/DEF-667
OPEN). Same class as the 1.52.0 release lesson above: `blockedByIssueIds` tracks
whether an issue is DONE, not whether its verdict is GREEN. Rule: the phase-close
commit child must be `blockedBy` the phase-close QA child, and the CTO moves it only
after reading a GREEN verdict; an adversary PASS is not a phase approval.

Separately, git-agent's report flagged a commit-hygiene defect: the earlier TFL-1415
phase-close commit `c353821` staged `src/renderer/App.tsx` WHOLESALE, capturing Phase
127 header wiring (`onOpenPreferences`, `themeDefault`, `onThemeChange`, `onOpenFind`,
`findEnabled`) before the matching `AppHeader` props existed, so HEAD `d54235d` did not
build until `4d51942`. Rule: a phase-close commit stages explicit pathspecs and, for a
file carrying mixed-phase hunks (`App.tsx`, `styles.css`), stages only the phase's hunks
(`git add -p` or a scoped `git apply`); never `git add` a whole mixed-phase file.

## 2026-10-09: Filing a child issue with a multi-line brief on Windows (paperclipai CLI quirks)

Two traps cost repeated attempts while filing the TFL-1393 children. (1)
`paperclipai issue create --description "<text>"` truncates at the first newline: the
`paperclipai.cmd` shim cannot survive a multi-line argument, so only line one lands. (2)
`issue child:create --payload-json` parses the payload with plain `JSON.parse` - the
helper named `parseJson5` is literally `JSON.parse` - and that same `.cmd` shim strips
double quotes, so an inline JSON payload either loses its quotes ("Expected property
name") or, when the arg splits on spaces, is read as unknown `-` options. Rule: write the
CreateChildIssue JSON to a file and spawn the CLI without a shell, e.g.
`execFileSync(process.execPath, [<...>/paperclipai/dist/index.js, 'issue', 'child:create',
parent, '--payload-json', readFileSync(file, 'utf8'), '--json'])`; execFileSync passes
argv directly, so quotes and `\n` survive. Use the same spawn-without-shell pattern for
any long or structured CLI payload. The disposition helper
(`scripts/paperclip-disposition.mjs`) is called as `node` directly, so its multi-line
comment arg is fine. (3) Follow-up trap (TFL-1468): `paperclipai issue create` also
SILENTLY IGNORES `--parent-id`, `--assignee-agent-id` and `--status`, producing a
parentless backlog issue - a direct violation of "never file a parentless issue". And
the `.cmd` shim truncates `issue update --description` and `issue comment --body` the
same way as `issue create`. Rule: create the issue, then `paperclipai issue update
<id> --parent-id ... --assignee-agent-id ... --status todo`, and deliver any
multi-line brief as a comment via `scripts/paperclip-disposition.mjs comment`
(with `PAPERCLIP_TASK_ID` overridden to the child id when the target is not the
current issue).

## 2026-10-09: A release publish chunk must NOT be blockedBy the gate chunk (completion != PASS)

TFL-1380 (Release OTA 1.52.0): K3 (TFL-1383, qa) reported the release gate RED - 18 unit
tests across 12 renderer files fail `verify:full` - but the qa issue still completed, which
auto-unblocked the publish chunk K4 (TFL-1384), and K4 went on to commit, tag `v1.52.0`,
push origin master + tag and publish the GitHub Release. So a broken-suite build shipped
because `blockedByIssueIds` tracks whether the BLOCKER ISSUE is done, not the verdict inside
its report. Rule: never express "publish only after the gate passes" as `blockedByIssueIds`
on the gate issue. Block the publish chunk on the CTO instead - leave it UNCREATED, or file
it in `todo` with NO blockers but do not let the watchdog own it, and create/activate it only
after the CTO has READ a GREEN verdict. A publish brief's "push-gate evidence already
satisfied" line must be grounded in that GREEN report, never assumed.

## 2026-10-09: git-agent skipped an appended brief section and claimed the brief lacked it

K4 (TFL-1384) was PATCHed to prepend an explicit "HYGIENE CLEANUP" step (delete 11 throwaway
scratch paths via `git rm`); the child description verifiably carried it (4825 chars at run
time), yet K4 reported "the K4 brief has no such step/list; no files deleted" and published
without it. Cost: the scratch files stay tracked, the operator's "clean tree fully" item is
unmet, and a corrective commit is still owed. Rule for git-agent (and every role): read the
FULL child description including any appended sections; if the description contains a step
that contradicts your expectation of the brief, EXECUTE it or STOP and report - never silently
skip it and claim the brief lacked it.

## 2026-10-09: A phase-close commit can omit a phase-owned hunk in a file outside the CTO's named set

Phase 119 (TFL-1231): the chunk K commit (5a6d418, TFL-1373) omitted two unmistakable Phase 119
changes because they sat in files the CTO stage list missed - `src/renderer/design/index.ts` (the
barrel export `export * from "./layout";`) and `PERFORMANCE.md` (the Phase 119 latency section qa
added). git-agent correctly left them untouched for a CTO decision, forcing a completion commit
(K2, TFL-1374). The same phase also showed the shared-tree hazard: four named files (DocumentView.tsx,
styles.css, REQUIREMENTS.md, ADVERSARIAL_REVIEW.md) had NO diff at commit time because their Phase 119
content had already been swept into earlier Phase 115/117 commits (f3350c3 / 2afb587). Rule: a
phase-close commit brief must (a) name the phase file set exactly, and (b) instruct git-agent to scan
the whole worktree for any hunk unmistakably owned by the phase (new symbol / new module / phase
test-name) and commit it, reporting ambiguous hunks rather than guessing.

## 2026-10-09: A deferred doc task sequenced after the phase-close commit leaves the tree dirty

Phase 115 (TFL-1227): a LOW doc-reconciliation deferred finding (TFL-1368) ran AFTER the phase-close
commit K (TFL-1367) and left `REQUIREMENTS.md` + the regenerated `docs/phase-specs/phase-115.md`
uncommitted, forcing a second commit (K2, TFL-1372) and breaking the phase's "ONE local commit" rule.
Rule: a deferred task whose output belongs in the phase-close commit must be dispatched and COMPLETED
BEFORE the commit, never in the same batch or after it. Also: the board janitor auto-assigns an
UNASSIGNED todo to its creator (the CTO), so filing a deferred finding UNASSIGNED can route
implementation work back to the CTO - assign deferred findings to the owning role (or the operator)
instead.

## 2026-10-08: A phase-close commit can silently carry a ledger truncation

The Phase 118 phase-close commit (3a29cfd) swept in a worktree `DEFECTS.md` truncated to
746 lines / 78 KB from its parent's 11030 lines / 1.88 MB — ~443 defect entries deleted with
no authorising record (the only documented prune is v1.2.0's DEF-001..071; the sibling
`ADVERSARIAL_REVIEW.md` kept full history). It reached the commit because git-agent stages
ledgers whole by convention and no one diff-checked the ledger size. Rule: any commit that
stages a ledger (`DEFECTS.md` / `ADVERSARIAL_REVIEW.md` / `REQUIREMENTS.md` / `CONTROL-INDEX.md`)
must report that file's line-count delta vs HEAD, and a net deletion of ledger entries is a
stop-and-confirm item for the CTO, never a silent stage. Filed TFL-1350 to restore `DEFECTS.md`.

## 2026-10-08: CTO timer heartbeat — unassigned run is contained; chain-heal deferred to an assigned run

Wake: `heartbeat_timer`, `PAPERCLIP_TASK_ID` empty, run `9caf93fd-e24c-4d6f-81c0-f26bfcb36ecf`
(`invocationSource=timer`, `contextSnapshot` has no `issueId`), scratch dir
`paperclip-run-unassigned-9caf93fd`. Every issue mutation (comment / update, including issues
assigned to the CTO) returned 403 `cross_issue_influence_run_context_required`: an unassigned timer
run has no source issue, so `observeCrossIssueInfluence` fails closed. Read-only calls work
(`health`, `issue get/list`, `issue runs`, `heartbeat-context`). This is the same containment class
as the 2026-10-07 write-outage entry.

Triage result (read-only). Two blocked phase drivers showed `blockerAttention.state=needs_attention`
with `blockingTreeLive:false`:
- TFL-1233 (Print / Output Studio) -> TFL-1301 (DEF-650 fix): lost wake. Its only blocker TFL-1297 is
  `done`, TFL-1301 is still `blocked` with no `unblockDescriptor` and no recovery action.
- TFL-1227 (Forms / Guided Fill) -> TFL-1331 (chunk E): idle queued `todo` assigned to frontend-dev
  with no link to live work, so its tree dead-ends.
Root cause: four frontend-dev chunks are queued behind the single writer (TFL-1330 active, TFL-1329
/ TFL-1331 / TFL-1332 todo), but only the chain through TFL-1332->TFL-1330 is live.

Prepared chain-heal (apply on the next ASSIGNED run, after re-verifying: serialize the queued
frontend-dev chunks behind the active TFL-1330, finishing the near-done Print phase first):
PATCH `blockedByIssueIds` — TFL-1301=[TFL-1330]; TFL-1331=[TFL-1301]; TFL-1329=[TFL-1331];
TFL-1332=[TFL-1329]. Each keeps a CTO-owned `unblockDescriptor`. No code change is involved.

Rule: on an unassigned timer heartbeat do read-only triage only; do not burn budget on issue
mutations, they are contained by design. Blocker-tree heals need an assigned run (or the janitor).

## 2026-10-08: CTO brief anti-pattern — a contract change must name every dependent oracle

Activity Shelf C4a (TFL-1265) changed `availableCompletionActions` in
`src/renderer/state/activity.ts` to return only a per-operation declared set. The
C4a brief named the two test files the developer wrote in C1/C3 but NOT the
dependent C2 component oracle `test/unit/renderer/activityShelf.test.tsx`, whose
mtime predates the change; qa's blast-radius check caught it red and filed DEF-640
(OPEN, MEDIUM), costing a fix cycle and a defect. Rule: before any brief that
changes a shared helper/type contract, grep the repo for every test that pins that
symbol and NAME each dependent oracle in the brief's scope and test list; a
contract change is not done while any dependent test is unaccounted for.

## 2026-10-08: CTO brief anti-pattern — vitest has no `--grep`

Two Activity Shelf briefs (C1 TFL-1220, C1 QA TFL-1235) told children to run
`npm.cmd run test:unit -- --grep "<pattern>"`. vitest 4.1.11 rejects `--grep`
(CACError, exit 1); qa substituted a file-scoped run and flagged the brief as a
task-instruction defect. Cost: one wasted verification command plus a defect note
in the QA report. Rule for every brief: name the targeted test by FILE PATH
(`npm.cmd run test:unit -- test/unit/renderer/<file>`) or vitest's `-t <name>`;
never `--grep`.

## 2026-10-07: CONTROL-PLANE WRITE OUTAGE during a CTO timer heartbeat

Every control-plane mutation failed this heartbeat. `issue create`, `issue comment`,
`issue update`, `issue checkout`, `issue read` and `openapi` all returned HTTP 500; a raw
HTTP POST with the `x-paperclip-run-id` header returned 403
`cross_issue_influence_run_context_required` ("this request arrived without a valid run").
The wake was `heartbeat_timer` with `PAPERCLIP_TASK_ID` empty and the scratch dir
`paperclip-run-unassigned-48628059` — i.e. a timer run with no registered server-side run
context. Read-only endpoints worked (`health`, `issue list`, `issue get`). Consequence: no
delegation, comment, or disposition was possible this heartbeat; the server must re-issue
the CTO heartbeat with a valid task/run context.

State when the outage hit: Phase 111 (TFL-865) mid-flight — chunk A (TFL-1060,
navigator view chrome) had just completed with its evidence artifact, and TFL-865 was
`dependencyReady`. Prepared but UNFILED (blocked on the outage):
- chunk B -> frontend-dev: page card footer (checkbox + More) + current/"Viewing" marker,
  remove the inline `data-thumb-verbs` cluster, "N selected" + Clear, card More
  (Rotate CW / Extract / Delete), panel More (Combine + Remove blank), two-column at
  >=360px. Anchors: `SideRail.tsx:1221` Thumb, `:1439-1456` classes, `:1589-1638` verb
  cluster, `ContextPanel.tsx:547-690` renderPages, `:1043-1057` header Combine.
- chunk E -> backend-dev: add `navigatorLayout?: 'stacked'|'split'` and
  `navigatorSplitRatio?: number` (0.1-0.9) to `AppSettings` (`types.ts:196-212`), widen
  `PANEL_LEFT_WIDTH_MIN/MAX` to 240/420 (`settings.ts:49-50`), normalise preserve-if-valid
  in the `settings.ts:1296-1320` block. Mirror `normalizeTabStyle` (`:489`) and
  `normalizeBoundedWidth` (`:510`).
- focused QA of chunk A -> qa (Focused verification).
Outstanding debt to fold in: migrate the 10 e2e specs off the retired
`data-outline-toggle` / `data-outline-open` hooks (into chunk F), and classify the 10 red
unit-suite files chunk A reported as pre-existing vs chunk-A-caused.


## Current runtime discipline

Paperclip owns scheduling and session recovery. Model pins are live agent settings.
Use the shared execution contract in AGENTS.md for workspace, commands, locks,
artifacts, and issue dispositions. Older harness notes are retired.
