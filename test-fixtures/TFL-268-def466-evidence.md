# TFL-268 / DEF-466 evidence — bound the expanded notice box to the canvas

## Change
- `src/renderer/styles.css`
  - `.canvas-overlay` is now a SIZE query container (`container-type: size`); the single-mode rule keeps its `canvas-pills` name.
  - The expanded notice rule (`.canvas-top-right .protection-notice, .conversion-notice, .pdf3d-notice`) gains
    `align-items: flex-start; max-height: calc(100cqh - var(--tf-chrome-y, 0px) - 200px); overflow: auto;`
- `test/unit/renderer/phase78NoticeInCanvas.test.tsx` — new CSS-contract test asserting `container-type: size` on the overlay and `max-height: calc(100cqh...` + `overflow: auto` + `align-items: flex-start` on all three boxes.

## Why not the `100cqh - 48px` candidate
Baseline measurement (before the fix) showed the 3D box's TOP is already ~177px below the overlay
top when the protection box is also expanded (control row 40px + 12px cluster offset + two 8px gaps
+ protection box 109px). `100cqh - 48px` would still overflow by ~113px at 1024x768. The 200px
reserve covers that stack with margin.

## Adversarial probe (read-only), after `npm.cmd run build:renderer`
`node test-fixtures/adv-p78/probe.cjs multi 30 <W> <H>`

| size | prot insideCanvas | three insideCanvas | three escapeBottomPx | three height (capped) |
|------|-------------------|--------------------|----------------------|-----------------------|
| 1024x768 | true | true | -23 | 524 (was 841) |
| 900x600  | true | true | -23 | 356 (was 841) |
| 640x1392 | true | true | -330 | 841 (canvas tall enough; no clip) |

All three report `insideCanvas:true` for both boxes; `overlap:false`; no console/page errors.

## Scrollability self-check (separate run, scratch script)
| size | clientHeight | scrollHeight | canScroll | scrolledBy | overflowY | align |
|------|--------------|--------------|-----------|------------|-----------|-------|
| 1024x768 | 522 | 856 | true | 334 | auto | flex-start |
| 900x600  | 354 | 856 | true | 502 | auto | flex-start |

## Commands
- `npm.cmd run build:renderer` -> exit 0 (vite built in 867ms).
- `npm.cmd run verify` -> `conventions: clean (319 source file(s) scanned)` + `tsc --noEmit` exit 0.
- `npm.cmd run test:unit -- <6 files>` -> Test Files 6 passed (6), Tests 84 passed (84).

## Screenshots (probe-captured, fixed build)
- screenshots/adv-p78-multi-1024x768.png
- screenshots/adv-p78-multi-900x600.png
- screenshots/adv-p78-multi-640x1392.png
