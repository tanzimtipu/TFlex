# Phase 78 focused-verification findings and defect evidence (TFL-258)

QA focused verification of the frontend-dev TFL-252 working tree. Launch ONCE at
2048x1392 via the canonical `launchApp`. New spec:
`e2e/phase78_notice_in_canvas.spec.cjs`.

## Defect candidate (product) — expanded notices overlap at the same top-right anchor

Severity: MEDIUM. Degrades a supported workflow (reading/collapsing the notice
family when a document produces two notices); the overlap self-resolves after the
~10 s auto-collapse, and there is no data loss.

Reproduction (from application launch):
1. Launch TFlex; open a password-protected PDF that also carries one /Subtype /3D
   annotation (the `buildEncrypted3dPdf` fixture in
   `e2e/phase67_notice_geometry.spec.cjs` / `e2e/phase78_notice_in_canvas.spec.cjs`).
2. Enter the password. The protection notice AND the 3D notice both mount
   expanded.
3. Observe: both expanded boxes render at the SAME top-right position (both
   anchor `top: calc(100% + var(--sp-2)); right: 0` inside the shared
   `.canvas-top-right` cluster). Their text overlaps; the 3D box (later in DOM)
   paints over the protection box.

Expected: each expanded notice is independently readable and its
`[data-protection-collapse]` / `[data-pdf3d-collapse]` control is clickable.
Actual: the boxes overlap exactly; the 3D box intercepts pointer events for the
protection collapse control.

Evidence:
- Screenshot `screenshots/phase78-protection-expanded.png` shows the two texts
  jumbled at the top-right (protection "copy, modify, comment..." under the 3D
  "Page 2 contains 3D content...").
- `e2e/phase67_notice_geometry.spec.cjs` test 3 fails deterministically:
  `locator.click: Timeout 30000ms exceeded ... <div ... data-pdf3d-notice ...>
  subtree intercepts pointer events` on `[data-protection-collapse]` (line ~331).
- Measured boxes (new spec): protection box `left 1332, top 104, right 1772,
  bottom 212.95`; 3D box `left 1332, top 104, right 1772, bottom 155.59` — same
  anchor, fully overlapping.

Origin: not from an adversarial finding; observed during the assigned focused
verification (repointed Phase 67 oracle run).

## Criterion verdicts (TFL-258)

- Criterion 1 (inside canvas, per notice): PASS. Protection `insideCanvas:true,
  hitInBox:true`; 3D `insideCanvas:true, hitInBox:true`; conversion
  `insideCanvas:true, hitInBox:true`. All rounded (`border-radius 8px`) with
  `--bg-elevated` + `backdrop-filter: blur(20px) saturate(1.2)`, entirely inside
  `[data-canvas-overlay]` (box right 1772 <= overlay right 1784).
- Criterion 2 (top-right + tight gaps): PASS. Book View `left 1560, top 56`;
  page-layout `right 1772` (overlay right 1784, 12px inset); gap page-layout ->
  Book View = 8px; gap rightmost "i" -> Book View = 8px; single conversion "i" ->
  Book View = 8px; icon pitch = 36px. Neither icon overlaps Book View or the
  page-layout control.
- Criterion 3 (enter morph — the "i" shows then morphs into the box): FAIL.
  The rAF enter timeline records `iconFrames: 0` across the whole entry for
  protection, conversion AND 3D: the collapsed "i" glyph is NEVER rendered at any
  frame of the entry. The only thing that animates is the expanded box scaling
  `matrix(0.95...)` -> `matrix(1...)` opacity 0 -> 1 over 250 ms from the
  top-right origin (`transform-origin: 440px 0px` = right/top). Observed entry =
  "the box scales in at the icon corner", NOT "the 'i' icon is shown and
  immediately expands/morphs into the box". Source agrees: `useNoticeCollapse`
  starts at `phase='expanded'`, so `[data-*-icon]` only mounts after a collapse.
- Criterion 4 (10s collapse + instant path): PASS. Measured dwell 8913 ms (within
  8-14 s); box unmounted, region state `collapsed`, `[data-protection-icon]`
  present. Under `reducedMotion:'reduce'` the enter animation duration computes
  to `1e-05s` (instant) and the collapse unmounts the box immediately.
- Criterion 5 (no Phase 67 regression / animation rules): FAIL. The Phase 67
  multi-collapsed-icon oracle repointed (test 3) fails as above: the expanded
  protection + 3D boxes now overlap at one anchor and the 3D box intercepts the
  protection collapse control. The collapsed multi-icon geometry itself is
  unregressed (measured: non-overlapping, pitch 36px, each icon centre
  hit-resolves, neither overlaps Book View / page-layout).

## Repointed oracles (qa owns e2e/)

- `e2e/phase59_protection_notice.spec.cjs` — top-left assertions replaced with
  top-right overlay-anchored assertions + icon-left-of-Book-View gap.
- `e2e/tfl46_protection_probe.spec.cjs` — probe now measures the canvas overlay
  right edge + top-right cluster and asserts the tight gap.
- `e2e/phase67_notice_geometry.spec.cjs` — `scrollerLeft` -> `canvasRight`;
  `relLeft` -> `relRight`; 72px slot pitch assertion -> measured 36px; comments.

## Run counts

- `npm.cmd run verify` -> exit 0 (conventions clean, tsc clean).
- Focused unit batch (8 files) -> 91 passed / 91.
- Blast radius `bookView` + `bookViewSpread` -> 11 passed / 11.
- New `e2e/phase78_notice_in_canvas.spec.cjs` -> 2 passed / 2.
- Repointed: `phase59_protection_notice` 1/1, `tfl46_protection_probe` 1/1,
  `phase67_notice_geometry` 2/3 (test 3 fails on the product overlap above).
