# TFL-906 Phase 109 chunk C - focused qa verification (View Strip footer)

Model: openrouter/deepseek/deepseek-v4.1-flash (correct tier).

## Verdicts

| Item | Verdict | Evidence |
| --- | --- | --- |
| A verify (`npm.cmd run verify`) | PASS | conventions clean (375 files); tsc clean |
| A unit (9 named specs) | PASS | 9 files / 110 tests passed |
| A build (`npm.cmd run build:renderer`) | PASS | vite build ok (823ms) |
| B1 footer exact names + layout group | PASS | 8 buttons count=1 each; `Current page` is the input; 3 layout options |
| B2 `[data-canvas-pills]` absent (single + multi) | PASS | panes=2 canvasPills=0 |
| B3 prev/next disable + typed jump | PASS | pageCount=34; prev disabled at 1, next disabled at 34, typed 34->2 lands 2 |
| B4 zoom/fit/pan states | PASS | 152%->175%->150%; fit aria-pressed toggles; pan data-hand-active=true |
| B5 layout one/two/four + Book View | PASS | data-page-layout=two/four/one; book opens, closes via Close |
| B6 no overlap, one 48px row, no clip | PASS | see geometry below |
| B7 per-pane footer, no layout/Book, pane A acts on A | PASS | 1 footer per pane; paneA 135%->150%, paneB 134%->134% |
| B8 Tab order + names + visible focus | PASS | 11 controls in DOM order; focus ring via outline/box-shadow |
| B9 screenshots + visual judgement | PASS | 4 screenshots inspected; footer matches the View Strip spec |
| C blast radius | FAIL | 23/24 failures foreign; 1 obsolete pill spec (DEF-580) |

## B6 geometry (dock vs footer, no overlap >=16px)

- single 1440x900: dockBottom=836 footerTop=852 gap=16
- single 640x480: dockBottom=416 footerTop=432 gap=16
- multi 1440x900: pane0 footerBottom=744 dockTop=814 gap=70; pane1 same gap=70
- footer row height = 48px, clipped controls = [] at both sizes, panel open and collapsed

Note: in SINGLE mode the dock floats ABOVE the footer (styles.css:5068-5071, 17167+), so the
clearance is `footer.top - dock.bottom`; the task's "dock top BELOW footer bottom" wording is
inverted. In MULTI mode the dock is below the pane footers (`dock.top - footer.bottom`). Both
>=16px, so the no-overlap contract holds.

## Commands

- `npm.cmd run verify` -> exit 0
- `npm.cmd run test:unit -- <9 specs>` -> 9 files / 110 tests passed
- `npm.cmd run build:renderer` -> built in 823ms
- `npm.cmd run test:e2e -- e2e/phase109_viewstrip.spec.cjs` -> 9 passed (1.0m)
- `npm.cmd run test:unit -- phase40_pageLayoutControl phase78NoticeInCanvas phase36ToolbarRetirement` -> 3 files / 43 tests passed
- `npm.cmd run test:e2e -- phase36_chunk3_dock_gate phase36_layout_retest phase32_multi_mode` -> 3 passed / 24 failed (foreign + DEF-580)

## Defects

- DEF-580 (LOW, filed): Phase 109 retires CanvasPills but P36-C3-G still asserts `[data-page-pill]`/`[data-zoom-pill]`.
- DEF-577 (pre-existing, MEDIUM): open Inspector overlays the footer's layout / Book View controls. Worked around by collapsing the Inspector in the spec (documented, not re-filed).

## Screenshots

- screenshots/phase109-light-single.png, phase109-dark-single.png, phase109-multi.png, phase109-640x480.png

## Logs

- test-fixtures/phase109-qa/{verify,unit,build,e2e-phase109,blastunit,blaste2e}.log
