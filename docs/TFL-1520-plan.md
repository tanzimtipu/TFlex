# TFL-1520 — Plan: Home intake tray as one box with subtle separators

## Context reviewed
- `src/renderer/intake/IntakeTray.tsx` — the Intake Tray surface primitive
- `src/renderer/components/Welcome.tsx:532-542` — Home call site (`data-home-intake`)
- `src/renderer/styles.css:24587-24831` — all `.intake-*` CSS rules
- `Visual overhaul/Drag Drop and Import/Specifications/design-decisions.md` — Quiet Precision semantic tokens (boundary #E1E4EB / #3B414E, 4 px spacing grid)
- Existing e2e: `e2e/phase118_intake.spec.cjs`, `e2e/tfl1396_home_spacing.spec.cjs`, `e2e/tfl1399_canvas_drop_hint.spec.cjs`
- Existing unit: `test/unit/renderer/phase118_intakeModel.test.tsx`, `test/unit/renderer/phase118_homeIntake.test.tsx`, `test/unit/renderer/tfl1399_canvasDropHint.test.tsx`

## Constraints and non-goals
- Presentation only — no change to the intake model (`src/renderer/intake/model.ts`), drag/drop routing, or file-handling semantics.
- No change to the canvas persistent intake panel (`.intake-persistent`) — that stays a separate floating surface.
- The `data-intake-*` hooks used by existing tests and CONTROL-INDEX must all survive unchanged.
- No new ad hoc colour values; reuse boundary token from Quiet Precision.
- No emojis; English UI strings only.
- Must not regress Phase 121 Home spacing or Phase 122 canvas drop-zone retirement.

## Approach
Restructure `IntakeTray.tsx` so the drop zone and the file list (or empty hint) always render inside a single shared container with one boundary. Insert a separator element between the drop zone and the first row, and between each pair of adjacent rows. When the queue is empty, only the drop zone renders (no list chrome, no stray separators). The shared container replaces the current separate borders on `.intake-dropzone` and `.intake-list`.

## Work breakdown

### Chunk A — frontend-dev: refactor `IntakeTray` into a single shared box with separators
- **Owner:** frontend-dev
- **Deliverables:**
  1. Updated `src/renderer/intake/IntakeTray.tsx` — single shared container, drop zone + rows inside it, separator elements rendered conditionally.
  2. Updated `src/renderer/styles.css` — new `.intake-tray*`, `.intake-sep*` rules; adjusted `.intake-dropzone`, `.intake-list`, `.intake-row` rules so they sit inside the shared box.
  3. Unit test `test/unit/renderer/tfl1520_intakeTrayBox.test.tsx` — jsdom-based: empty state renders exactly one `[data-intake-dropzone]` and no `.intake-sep`; one-file state renders drop zone + one row + zero separators; multi-file state renders drop zone + N rows + (N) separators; all `data-intake-*` hooks are present; default Home configuration still renders drop zone.
  4. Run `npm.cmd run verify` and targeted unit tests; report pass/fail.
- **Acceptance criteria:**
  - Empty state: `document.querySelectorAll('[data-intake-dropzone]').length === 1` and `document.querySelectorAll('.intake-sep').length === 0`.
  - Populated state (items.length > 0): exactly one `[data-intake-tray]` boundary, separators count === items.length (one after drop zone + one between each adjacent row pair), last row has no trailing separator.
  - Separator colour uses `var(--border-subtle)` (resolves to light `#e4e9f0` / dark `#222932` via existing token chain, which is the established hairline boundary).
  - Existing unit tests `phase118_intakeModel.test.tsx`, `phase118_homeIntake.test.tsx`, `tfl1399_canvasDropHint.test.tsx` still pass.
- **Blockers:** none.

### Chunk B — qa: focused verification (geometric e2e + screenshots + CONTROL-INDEX sweep)
- **Owner:** qa
- **Task type:** Phase validation
- **Deliverables:**
  1. Write/run `e2e/tfl1520_intake_box.spec.cjs` (through `e2e/lib/launch.cjs`): empty Home screenshot at default and minimum sizes; multi-file (2+ files) Home screenshot at default and minimum sizes; assert exactly one visible bounding box and separators between rows.
  2. Re-run blast-radius intake suites: `e2e/phase118_intake.spec.cjs`, `e2e/tfl1396_home_spacing.spec.cjs`, `e2e/tfl1399_canvas_drop_hint.spec.cjs` — report pass/fail.
  3. Capture before/after screenshots of empty state and multi-file state in light and dark themes at default and minimum window sizes.
  4. Report verdict per item: PASS / FAIL / INCONCLUSIVE.
- **Acceptance criteria:**
  - All blast-radius e2e suites pass without regression.
  - Screenshots show the single-box structure and separator lines as specified.
- **Blockers:** Chunk A (frontend-dev fix must be in the tree first).

### Chunk C — git-agent: phase-close commit
- **Owner:** git-agent
- **Deliverables:** Stage and commit all tracked changes from chunks A and B with an imperative message referencing TFL-1520 and any touched DEF/ADV numbers.
- **Blockers:** Chunk B (qa verification green).

## Acceptance
All success criteria from the parent issue (TFL-1520) are demonstrably met:
1. Empty state shows exactly one box with drop-zone content, no separate list region, no stray dividers.
2. Populated state shows drop zone + file rows inside one shared box with subtle separators.
3. Separator style is hairline, low-contrast, consistent.
4. All existing intake behaviour preserved (drop indication, controls, data-* hooks).
5. Light/dark themes and default/minimum window sizes verified with screenshots.
6. Focused unit/e2e tests pass.

## Risks and mitigations
- Risk: `e2e/tfl1396_home_spacing.spec.cjs` asserts geometry against the old two-box layout; may need selector update. Mitigation: qa adjusts the spec in chunk B, not frontend-dev in A.
- Risk: `.intake-persistent` (canvas floating panel) may pick up unintended shared-box styling if CSS is too broad. Mitigation: scope all new rules to `.intake-tray` (not `.intake-persistent`) and test canvas panel unchanged.

## Deferrals
- None; this is a focused visual refinement that completes in A + B + C.
