# TFL-524 chunk C — Adversary diff-pass report (DEF-534)

Session label: `diff-pass`
Scope: the TFL-524 colorful tab TOP-EDGE alignment change in
`src/renderer/styles.css` (3 declarations) plus its repointed/new oracles.
Model: `openrouter/deepseek/deepseek-v4.1-flash`. Working tree left uncommitted.

## Verdict

No TFL-524-confirmed break. Every mandatory probe held. One dangerous behavior
was found at the 640px minimum (clicking the "+" centre closes the active tab),
but it reproduces identically on the PRE-FIX CSS, so it is a PRE-EXISTING defect,
not a TFL-524 regression — reported out of scope below.

## Commands run

1. Existing high-risk specs (required):
   `npm.cmd run test:e2e -- e2e/phase60_tab_drag.spec.cjs e2e/phase61_tab_tearout.spec.cjs`
   -> **5 passed (48.7s)**, 0 failed. (P61 floated active box top=70.01 bottom=113.01
   => height 43 = resting active height 43; no collapse.)
2. Own probe:
   `node test-fixtures/tfl524-adversary/probe.cjs`
   -> **49/49 checks PASS, 0 FAIL**. Results: `probe-results.json`.
3. Occlusion probe (out-of-scope evidence):
   `node test-fixtures/tfl524-adversary/probe-plus-occlusion.cjs`
   `node test-fixtures/tfl524-adversary/probe-plus-prefix-click.cjs`

## Attack surface results

### S1 Drag / tear-out geometry — HELD
- Resting: inactive 26px, active 43px (full strip), every top = 0, active foot flush (mainTop 44 vs bottom 43).
- Grabbing a background tab (DEF-034 mousedown activation) keeps its TOP edge fixed at 0 while it grows 26 -> 43px: no pre-fix-style top jump (pre-fix would jump ~4.5px).
- Armed drag box stays 43px, top 0.
- Tear-out float: `position:absolute`, floated box 180x43 == resting active box; reserve `<li>` 182x43 (full strip height); `align-self:stretch`. No collapse/jump/clip.
- Release back inside the strip: all tops realign to one edge.
- Dragging the already-active tab: height 43, top 0, stable.

### S2 "+" control + welcome state — HELD (with a premise correction)
- Welcome (zero tabs): the "+" is NOT rendered. `AppHeader.tsx:1140` gates it on
  `tabs.length >= 1` (DEF-055), so the task's "welcome screen - only the +" state
  is unreachable by design. Confirmed count=0.
- Multi-tab (normal width): "+" <li> 28x34, button 24x34, fully inside the strip
  (0..34 inside 0..43), hit-testable at centre, clicking it opens a tab (3 -> 4),
  tops stay aligned.

### S3 Overflow / minimum window (14 tabs) — geometry HELD
- @1280 and @640: every top = 0, active foot flush (mainTop 44 vs bottom 43),
  active not clipped (290..296 inside list 182..330), "+" inside the strip.
- Mid-state resize 640 -> 900: tops stay equal.
- See the out-of-scope observation for the "+" hit-test at 640.

### S4 Multi-mode composite tab — HELD
- Multi Mode shows ONE composite tab `tf-multi-workspace` (DEF-288); it is active,
  43px full strip height, top 0, foot flush, not clipped.

### S5 Oracle integrity — HOLDS (discriminates the regression)
- Repointed `e2e/phase58_tab_style.spec.cjs`: asserts inactive 26px, `active.height > inactive.height`,
  and the NEW `Math.abs(active.top - inactive.top) <= 0.5`.
- New `e2e/tfl524_tab_alignment.spec.cjs`: `assertAligned` asserts top equality <= 0.5,
  recess > 0 (so `active.bottom >= inactive.bottom` is not always-true), and gap in [-1, 1].
- New `e2e/tfl676_standard_style.spec.cjs`: standard 34px, equal tops.
- `test/unit/renderer/phase62TabRestyle.test.tsx`: string-asserts `align-items: flex-start`
  and `not toContain align-items: center`; `align-self: stretch` and `not flex-end`;
  `height: 100%` and `not height: 30px`.
- Discrimination proof: injecting the three PRE-FIX declarations in-page
  (`.tab-list align-items:center`, active `<li> align-self:flex-end`, `.tab-active height:30px`)
  yields `topDelta = 4.5px` (active top 13 vs inactive 8.5), so the top-equality
  oracle FAILS on the pre-fix CSS and PASSES on the fix. No `>=`/always-true where
  equality is required was found.
- Weak-assertion note (not a defect): `expect(active.height).toBeGreaterThan(inactive.height)`
  passes both pre-fix (30 > 26) and post-fix (43 > 26), so it alone does not certify
  the fix; the top-equality assertion is the discriminating one.

### S6 Standard style + close button — HELD
- Standard: style=standard, tabs 34px, equal tops, active not taller than inactive
  (unchanged contract).
- Colorful full-height active tab: close button 18x18 vertically centred inside the
  43px tab (12.5..30.5), hit-testable at centre, clicking it closes the tab (2 -> 1).

## Out-of-scope observation (PRE-EXISTING, NOT a TFL-524 finding)

At the 640px minimum with 11 or 14 tabs added at a wide window and then narrowed,
the `.tab-new` ("+") button is overlapped by a squeezed tab's `.tab-close` button:
- n=11: "+" centre (313.9, 17.0) hits `.tab-close`; raw click -> CLOSES a tab (11 -> 10, active changes).
- n=14: "+" centre (314.0, 17.0) hits `.tab-close`; raw click -> CLOSES a tab (14 -> 13).
- Injecting the PRE-FIX CSS gives the SAME result (centre hits `.tab-close`; raw click 14 -> 13).
  Fixed vs pre-fix "+" hit coverage over the 16 sampled points: n=11 6/16 vs 7/16, n=14 2/16 vs 4/16.
So TFL-524 did not introduce this; the horizontal squeeze that detaches each
`.tab-close` (18px, `margin-left:auto`) from its 6-8px tab box predates it. It is a
real wrong-target/data-affecting click (closes the active document tab) and deserves
its own ticket, but it is outside this diff-pass scope.

## Fixtures

- `test-fixtures/tfl524-adversary/probe.cjs` — 49-check diff-pass probe (S1-S6).
- `test-fixtures/tfl524-adversary/probe-results.json` — machine-readable results.
- `test-fixtures/tfl524-adversary/probe-plus-occlusion.cjs`,
  `probe-plus-prefix-click.cjs` — the pre-existing occlusion evidence.
- `test-fixtures/tfl524-adversary/occlusion-11.png`, `occlusion-14.png`,
  `s1-tearout-float.png`, `s2-plus-strip.png`, `s3-overflow-640.png`,
  `s4-multimode.png`, `s6-standard.png` — screenshots.

## Design critique (design-critique skill) - colorful tab strip, TFL-524 surface

User: a PDF reader switching between open documents. Job: pick/keep track of the
active document; open or close tabs. Success: the active document is unambiguous
and tabs read as one stable rail.

### Must-fix (blocks ship)
- None attributable to TFL-524.

### Should-fix (before broader rollout)
- **Affordance / edge case (OUT OF SCOPE, pre-existing):** at the 640px minimum the
   new-tab control is overlapped by the active tab's close button; a raw click at
  its centre closes the active document tab. Same on pre-fix CSS - file separately.

### Nice-to-fix
- **Consistency:** the  control stays 34px while the active tab now fills the 43px
  strip, so the  is top-aligned with a 9px band beneath it. Minor; the shared top
  edge is the dominant reading.

### Strengths to keep
- One aligned top edge across active and inactive tabs reads as a single stable rail.
- The active fill runs flush onto the canvas without the old foot-pinned 30px hack.
- Drag and tear-out geometry is preserved exactly: grabbing a chip keeps its top
  edge, the floated box equals the resting active box, and the reserve <li> keeps
  the strip from reflowing.
