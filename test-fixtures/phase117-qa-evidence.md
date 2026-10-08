# Phase 117 (chunk G) focused QA — raw evidence (TFL-1337, 2026-10-08)

Model: openrouter/google/gemini-2.5-flash. All commands run from the app root with the
atomic build lock held (`scripts/paperclip-build-lock.mjs`, owner qa).

## 1. verify

`npm.cmd run verify`
- conventions: clean (412 source file(s) scanned)
- tsc --noEmit: clean

## 2. Phase 117 unit specs

`npm.cmd run test:unit -- test/unit/renderer/phase117_selectionPrimitives.test.tsx
test/unit/renderer/phase117_annotationSelection.test.tsx
test/unit/renderer/phase117_editSelection.test.tsx
test/unit/renderer/phase117_geometryWiring.test.tsx
test/unit/renderer/phase117_formCropTransfer.test.tsx
test/unit/renderer/phase117_anchoring.test.tsx
test/unit/renderer/phase117_a11y.test.tsx`
- Test Files 7 passed (7)
- Tests 34 passed (34)
- Duration 3.39s
- (non-fatal jsdom notice: HTMLCanvasElement.getContext() not implemented — no canvas package; does not fail any test.)

## 3. Blast-radius neighbours

`npm.cmd run test:unit -- <21 neighbour specs listed in the task>`
- Test Files 1 failed | 20 passed (21)
- Tests 1 failed | 213 passed (214)
- The single failure is `phase37EditText.test.tsx` — the stale primary-order assertion.
  Filed as DEF-659 (OPEN). It is the deliberate Phase 117 Delete-behind-More change
  (ruling 6) meeting an un-updated Phase 37 unit test; the product behaviour is correct
  (proven by the e2e).

## 4. Focused e2e

`npm.cmd run test:e2e -- e2e/phase117_selection.spec.cjs`
- 4 passed (29.7s)
- Raw snapshots observed:
  - crop-chrome {"hasBoundary":true,"corners":["move","ne","nw","se","sw"]}
  - ann-chrome {"hasBoundary":true,"kind":"annotation","handleCount":4,"handleCorners":["ne","nw","se","sw"]}
  - ann-bar-overlap {"found":true,"overlap":false,"bar":{"x":1079,"y":572,"w":248,"h":46}}
  - textbox-chrome {"hasBoundary":true,"kind":"textBox","handleCount":4}
  - textbox-primary ["Confirm","Cancel","More"]
  - image-chrome {"hasBoundary":true,"kind":"image","handleCount":4}
  - form-chrome {"fields":10,"boundaries":0,"chrome":0,"modified":false}
- Assertions covered: annotation shared boundary + 4 handles + separated More/Delete;
  text box + image shared chrome with Confirm/Cancel primary and Delete behind More;
  crop-region shared handles in CropPagesDialog; form widget renders NO
  `[data-selection-boundary]` / `.selection-chrome`; context control clear of the dock /
  viewing footer; selecting does not change the dirty flag.

## 5. CONTROL-INDEX verdicts (docs/phase-specs/phase-117.md)

1. shared selection boundary / handles — PASS (phase117_selectionPrimitives 2/2; e2e ann/textbox/image)
2. separated More / Delete — PASS (phase117_selectionPrimitives 2/2; e2e More→Delete on ann/editbox/image)
3. annotation + stamp selection — PASS (phase117_annotationSelection + bootstrap; e2e annotation; stamp neighbours pass)
4. text box / image / text run selection + numeric geometry — PASS for phase117 specs + e2e; the named "existing Phase 37" suite is RED → DEF-659
5. form-widget selection — PASS (phase117_formCropTransfer; e2e form boundaries=0)
6. crop-region selection — PASS (phase117_formCropTransfer; e2e crop boundary + 4 corners)
7. page-transfer affordance — PASS (phase117_formCropTransfer page-drag grip, no boundary)
8. anchored collision / capture loss — PASS (phase117_anchoring; e2e bar overlap=false)
9. adaptation — PASS for phase117_a11y unit + captured adaptation screenshots; full fixture matrix NOT exhaustively run (see INCONCLUSIVE)

## 6. Screenshots (screenshots/)

phase117-annotation-selection.png, phase117-crop-selection.png,
phase117-textbox-selection.png, phase117-image-selection.png,
phase117-form-no-boundary.png, phase117-full-light.png, phase117-full-dark.png,
phase117-compact-light.png, phase117-highcontrast.png,
phase117-reduced-motion.png, phase117-zoom200.png

Inspected directly: annotation (violet boundary + 4 handles + Confirm/[colour]/Cancel/More
with Delete inside More), text box (boundary + handles + Confirm/Cancel/More + Inspector
GEOMETRY X/Y/Width/Height), crop (shared violet boundary + corner handles in CropPagesDialog),
high-contrast (chrome survives forced-colors). Form screenshot shows the guided-fill overlay
with no selection chrome.

## 7. INCONCLUSIVE items

- Full fixture matrix (rotated / cropped / mixed-size pages; zoom extremes; spreads; scroll;
  selection at every viewport edge; tiny / large objects; multiple selections; pointer
  capture loss; Apply / Cancel / undo; native font issues; unsupported text; permissions;
  tab switch) was NOT exhaustively driven in this focused pass. Ceiling/anchor/capture-loss
  and keyboard/numeric behaviour are covered by the phase117_anchoring and
  phase117_editSelection unit specs (all green). Reason: focused-verification scope plus
  per-run budget; remaining matrix rows are not independently reproduced.
- No PDF-pixel/content mutation from selection was measured by pixel sampling; the dirty
  flag (EngineState.modified) was verified unchanged by crop selection and by annotation
  re-selection, and the form document opens non-dirty.
