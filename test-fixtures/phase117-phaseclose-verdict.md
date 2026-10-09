# Phase 117 (chunk I) phase-close QA verdict — TFL-1364

Model: openrouter/deepseek/deepseek-v4.1-flash. Atomic build lock held by qa (acquired exit 0; no stale lock present).

## Raw command summaries

1. `npm.cmd run verify` -> `conventions: clean (412 source file(s) scanned)`; `tsc --noEmit -p tsconfig.json` exit 0.
2. 7 `phase117_*` unit specs -> `Test Files 7 passed (7)` / `Tests 34 passed (34)` (3.23s).
3. DEF oracle: `phase37EditText.test.tsx` + `bugDEF135_textBoxPlacementToolbar.test.tsx` -> `Test Files 2 passed (2)` / `Tests 18 passed (18)`.
4. Blast radius (20 neighbour suites) -> `Test Files 20 passed (20)` / `Tests 202 passed (202)`. (The chunk-G "21-suite" run = these 20 + `phase37EditText`, which is green in #3; the prior single red suite is now green.)
5. `npm.cmd run test:e2e -- e2e/phase117_selection.spec.cjs` -> `4 passed (30.1s)`.
   Raw snapshots: `crop-chrome {"hasBoundary":true,"corners":["move","ne","nw","se","sw"]}`; `ann-chrome {"hasBoundary":true,"kind":"annotation","kindMatches":true,"handleCount":4}`; `ann-bar-overlap {"found":true,"overlap":false,"bar":{"x":1079,"y":572,"w":248,"h":46}}`; `textbox-chrome {"kind":"textBox","handleCount":4}`; `textbox-primary ["Confirm","Cancel","More"]`; `image-chrome {"kind":"image","handleCount":4}`; `form-chrome {"fields":10,"boundaries":0,"chrome":0,"modified":false}`.

## Success criteria (whole phase diff)

1. One controller — PASS (cmd 2 specs + cmd 5 e2e: annotation/textbox/image on the shared `selectableContent` chrome; form `boundaries:0`).
2. Geometry and states — PASS (cmd 2 `phase117_selectionPrimitives`; e2e `hasBoundary`+`handleCount:4`; inspected `phase117-annotation/textbox/crop-selection.png` = 1px violet boundary + 4 corner handles).
3. Delete separation — PASS (cmd 2; e2e primary row `["Confirm","Cancel","More"]`, `delete` count 0 until More opens, then 1).
4. Inspector First — PASS (cmd 2 `phase117_editSelection`/`geometryWiring`; `phase117-textbox-selection.png` shows Inspector GEOMETRY X/Y/Width/Height + truthful "Edit font").
5. Anchoring and collision — PASS (cmd 2 `phase117_anchoring`; e2e `ann-bar-overlap overlap:false`).
6. Draft / undo honesty — PASS (cmd 2 `phase117_anchoring` "selection is not a document change"; e2e form `modified:false`; `phase37EditText` "Cancel reverts the pending move").
7. Transforms — PASS (cmd 2 numeric + keyboard nudge; e2e geometry `X=171.35870361328125` — page-points not rounded).
8. Text truth — PASS (`phase117-textbox-selection.png`: "Edit font" label + substitution note; no rotate handle; cmd 2).
9. Pixels and content — PASS (e2e form `modified:false`, `boundaries:0`; cmd 2 `phase117_anchoring`). Note: no direct PDF-pixel diff sampling was run (same limitation the chunk-G pass recorded); selection routes to no engine op.
10. Accessibility and adaptation — PASS (cmd 2 `phase117_a11y`; e2e test 4 passed; `phase117-highcontrast.png` inspected — chrome survives forced-colors).
11. Seams — PASS (e2e form has no boundary; annotation inspector reuses Thread Stream REVIEW ELEMENTS; crop = `cropPages`; `phase117_formCropTransfer` green).
12. Evidence and flow — PASS (verify clean; all named unit specs green; e2e 4/4; screenshot set present; CONTROL-INDEX swept; rotation recorded as unsupported/none; flow G->H(adversary clean pass)->I(this verdict); J commit pending git-agent).

## CONTROL-INDEX sweep (docs/phase-specs/phase-117.md)

1. shared boundary + handles — PASS (cmd 2; e2e ann/textbox/image).
2. separated More / Delete — PASS (cmd 2; e2e).
3. annotation + stamp — PASS (cmd 2 `phase117_annotationSelection` + `bugB10`/`defDEF153_154` neighbours; e2e annotation).
4. text box / image / text run + numeric geometry — PASS (cmd 2 `phase117_editSelection`/`geometryWiring`; `phase37EditText`/`bugDEF135` now green).
5. form-widget — PASS (cmd 2 `phase117_formCropTransfer`; e2e `boundaries:0`).
6. crop-region — PASS (cmd 2; e2e crop boundary + 4 corners).
7. page-transfer — PASS (cmd 2 `phase117_formCropTransfer`; `pageDrag*`/`pageDragCrossDoc` neighbours green).
8. anchoring / collision / capture-loss — PASS (cmd 2 `phase117_anchoring`; e2e `overlap:false`).
9. adaptation — PASS (cmd 2 `phase117_a11y`; e2e adaptation screenshots; `phase117-highcontrast.png` inspected).

## DEF ledger

- Ledger `DEF-659` = "The Inspector REVIEW scope never populated for a selected annotation" (Phase 116), status CLOSED since qa TFL-1352. It is unrelated to this task and remains CLOSED/unchanged.
- The task's "DEF-659" (the Phase 117 `phase37EditText` stale primary-order oracle) never had its own ledger entry — the chunk-G evidence reused the taken number. Recorded here as the next free `DEF-663`, status CLOSED, with the raw output quoted. Numbering collision flagged for the CTO.
- Definition-of-done oracle green: cmd 3 `2 passed (2)` / `18 passed (18)`; e2e `4 passed`.

## Notes

- `phase117-image-selection.png` shows the deselected state because `e2e/phase117_selection.spec.cjs:222-223` presses Escape before the screenshot; the image-chrome assertion at `:215-217` ran while selected and passed. Test-evidence timing only, not a product defect.
