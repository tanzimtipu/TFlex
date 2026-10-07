// DEF-338 — Multi Mode: opening a document into a pane must fit from the
// PANE-constrained width, never from the un-split stage width.
//
// qa's repro (e2e/def338_repro.spec.cjs) proved the root cause: a freshly
// opened tab renders while it is still unassigned to a pane (hidden, but laid
// out at the full stage width), so the first fit computed
// `(1214 - 0) / 595 = 2.04` (the 204% readout plus a full-pane grey slab)
// before converging to `413 / 595 = 0.69`. The fix defers a Multi Mode pane's
// first fit until the pane's own scroller box is the measured one
// (`paneFitDeferred`) and re-measures it before paint on pane assignment.
//
// These tests assert the COMPUTED SCALE (not the DOM) plus the source guard
// that wires the deferral into DocumentView.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ZoomState } from "../../../src/renderer/state/zoom";
import {
  computeEffectiveScale,
  paneBoxSettled,
  paneFitDeferred,
  paneInsetSettled,
} from "../../../src/renderer/components/paneFit";

const FIT_WIDTH: ZoomState = { mode: "fit-width", manualScale: 1 };
const FIT_PAGE: ZoomState = { mode: "fit-page", manualScale: 1 };
const MANUAL: ZoomState = { mode: "manual", manualScale: 1.5 };

/** The payslip page 1 (A4) and the two widths qa measured. */
const PAYSLIP = { w: 595, h: 842 };
const PANE_W = 413; // the converged half-pane scroller
const STAGE_W = 1214; // the un-split stage width of the first pass

describe("DEF-338 — the fit scale of a pane-constrained view", () => {
  it("uses the pane's width: 413/595 = 69%, the converged fit", () => {
    const scale = computeEffectiveScale({ w: PANE_W, h: 900 }, PAYSLIP, FIT_WIDTH, 0);
    expect(scale).toBeCloseTo(413 / 595, 6);
    expect(scale).toBeCloseTo(0.694, 3);
  });

  it("the stage-width pass (1214/595 = 204%) is the wrong value the fix removes", () => {
    // Documents the bug the fix prevents: the same formula on the un-split
    // stage width is ~3x the pane fit. The pane value must not be it.
    const stageScale = computeEffectiveScale({ w: STAGE_W, h: 900 }, PAYSLIP, FIT_WIDTH, 0);
    expect(stageScale).toBeCloseTo(2.04, 2);
    const paneScale = computeEffectiveScale({ w: PANE_W, h: 900 }, PAYSLIP, FIT_WIDTH, 0);
    expect(paneScale).not.toBeCloseTo(stageScale, 2);
  });

  it("fit-page also clamps to the pane width", () => {
    const scale = computeEffectiveScale({ w: PANE_W, h: 500 }, PAYSLIP, FIT_PAGE, 0);
    // min(413/595, 500/842) = min(0.694, 0.594) = 0.594
    expect(scale).toBeCloseTo(500 / 842, 6);
  });

  it("manual zoom is unaffected by the viewport", () => {
    expect(computeEffectiveScale({ w: 0, h: 0 }, PAYSLIP, MANUAL, 0)).toBe(1.5);
  });
});

describe("DEF-338 — the stage-width first pass cannot leak into a pane's scale", () => {
  it("an unassigned pane tab (hidden, full-stage width) is never fitted", () => {
    // Even with the fit anchor already resolved, an unassigned tab defers:
    // 1214 can never become a committed pane scale.
    expect(paneFitDeferred(true, null, "fit-width", PAYSLIP)).toBe(true);
    expect(paneFitDeferred(true, null, "fit-width", null)).toBe(true);
  });

  it("an assigned pane defers until its first fit anchor resolves", () => {
    expect(paneFitDeferred(true, "B", "fit-width", null)).toBe(true);
    expect(paneFitDeferred(true, "A", "fit-page", null)).toBe(true);
  });

  it("an assigned pane with its anchor resolved fits (the converged case)", () => {
    expect(paneFitDeferred(true, "B", "fit-width", PAYSLIP)).toBe(false);
  });

  it("single mode, manual zoom and pane A transitions are unchanged", () => {
    // Single mode: never deferred, exactly as before the fix.
    expect(paneFitDeferred(false, null, "fit-width", null)).toBe(false);
    // Manual zoom in a pane needs no viewport / anchor.
    expect(paneFitDeferred(true, "B", "manual", null)).toBe(false);
    // Pane A already painted before Multi Mode turned on: its anchor is set,
    // so its content is never held back (qa: placeholder 0 frames).
    expect(paneFitDeferred(true, "A", "fit-width", PAYSLIP)).toBe(false);
  });
});

describe("DEF-338 — DocumentView wires the pane-constrained first fit", () => {
  const source = readFileSync(
    resolve(__dirname, "../../../src/renderer/components/DocumentView.tsx"),
    "utf8",
  );

  it("derives the pane-pending flag from the pure guard", () => {
    expect(source).toMatch(/paneFitDeferred\(\s*multiModeEnabled === true,\s*multiPane,/);
    expect(source).toMatch(/const paneFitPending = paneFitDeferred/);
  });

  it("holds the page content back while a pane's first fit is pending", () => {
    expect(source).toMatch(/!paneFitPending && Array\.from\(\{ length: pageCount \}/);
  });

  it("re-measures the scroller on pane assignment, before paint", () => {
    // A useLayoutEffect keyed on the pane assignment is the pre-paint
    // guarantee: the first visible frame is already the pane width.
    expect(source).toMatch(
      /useLayoutEffect\(\(\) => \{[\s\S]{0,900}?\}, \[multiModeEnabled, multiPane\]\);/,
    );
    expect(source).toMatch(/if \(multiModeEnabled !== true \|\| multiPane === null\)/);
  });

  it("computes the fit through the pure helper", () => {
    expect(source).toMatch(/computeEffectiveScale\(viewportBox, fitAnchor, zoom, FIT_MARGIN_PX\)/);
  });
});

// ---------------------------------------------------------------------------
// DEF-338 (residual) — the pane's first fit waits for a SETTLED scroller box.
//
// qa's payslip repro still showed the fit stepping 88% -> 78% -> 69% -> 68%
// with placeholders wider than the settled fit. The measured cause is NOT the
// 150px strip (the strip is present at 150px from the first frame): opening a
// document into a pane briefly makes the new tab an empty placeholder, which
// collapses the Inspector's inset and re-opens it, so the registered
// `--tf-tools-inset` transition shrinks the pane over ~200ms. A fit measured
// mid-transition is wider than the settled fit. The gate holds the first fit
// until the scroller box has stopped moving.
// ---------------------------------------------------------------------------

describe("DEF-338 residual — the pane's first fit waits for a settled box", () => {
  it("settles only after TWO identical rAF gaps (three identical samples)", () => {
    const box = { w: 403, h: 900 };
    // First samples: no history yet -> never settled.
    expect(paneBoxSettled(null, null, box)).toBe(false);
    expect(paneBoxSettled(null, box, box)).toBe(false);
    // Two identical gaps -> settled.
    expect(paneBoxSettled(box, box, box)).toBe(true);
  });

  it("a box that is still moving (the inset transition) never settles", () => {
    // The payslip's real scroller sequence while the pane shrinks: 525 -> 465
    // -> 405 -> 403. Only the final three-frame window may settle.
    expect(paneBoxSettled({ w: 525, h: 900 }, { w: 465, h: 900 }, { w: 405, h: 900 })).toBe(false);
    expect(paneBoxSettled({ w: 465, h: 900 }, { w: 405, h: 900 }, { w: 403, h: 900 })).toBe(false);
    expect(paneBoxSettled({ w: 405, h: 900 }, { w: 403, h: 900 }, { w: 403, h: 900 })).toBe(false);
    expect(paneBoxSettled({ w: 403, h: 900 }, { w: 403, h: 900 }, { w: 403, h: 900 })).toBe(true);
  });

  it("a height-only change also blocks the settle", () => {
    expect(paneBoxSettled({ w: 403, h: 901 }, { w: 403, h: 900 }, { w: 403, h: 900 })).toBe(false);
  });

  it("a zero box is never 'settled' (jsdom / a not-yet-laid-out pane)", () => {
    const zero = { w: 0, h: 0 };
    expect(paneBoxSettled(zero, zero, zero)).toBe(false);
  });

  it("the deferred guard consumes the settle verdict", () => {
    // Never-painted pane, anchor resolved, box still moving -> held.
    expect(paneFitDeferred(true, "B", "fit-width", PAYSLIP, false)).toBe(true);
    // Box settled -> the pane's first fit commits.
    expect(paneFitDeferred(true, "B", "fit-width", PAYSLIP, true)).toBe(false);
    // Single mode and manual zoom ignore the gate entirely.
    expect(paneFitDeferred(false, null, "fit-width", null, false)).toBe(false);
    expect(paneFitDeferred(true, "B", "manual", null, false)).toBe(false);
  });
});

describe("DEF-338 residual — DocumentView samples the pane box to settle it", () => {
  const source = readFileSync(
    resolve(__dirname, "../../../src/renderer/components/DocumentView.tsx"),
    "utf8",
  );

  it("gates the first fit on the settled box, not the first measurement", () => {
    expect(source).toMatch(/paneGateActive\s*=\s*[\s\S]{0,120}?multiPane !== null && !firstFitCommittedRef\.current/);
    expect(source).toMatch(/paneGateActive \? paneBoxReady : true/);
    expect(source).toMatch(/paneBoxSettled\(prev2, prev1, next, paneInsetTarget\)/);
    expect(source).toMatch(/requestAnimationFrame\(tick\)/);
  });

  it("latches a view that has already painted, so a mode toggle never re-gates", () => {
    expect(source).toMatch(/firstFitCommittedRef\.current = true/);
    expect(source).toMatch(/if \(!paneFitPending && pageCount > 0\)/);
    expect(source).toMatch(/if \(firstFitCommittedRef\.current\) return undefined;/);
  });

  it("holds the pane's own footer while the first fit is held", () => {
    // Phase 109 (chunk B) — the per-pane CanvasPills are retired; the unified
    // View Strip footer is the pane's view-control surface and is held on the
    // same first-fit flag (`paneFitPending`) until the pane's box has settled.
    expect(source).toMatch(/!paneFitPending &&[\s\S]{0,80}?inMultiPane \|\|/);
  });
});

// ---------------------------------------------------------------------------
// DEF-343 — the settle signature carries the Inspector inset.
//
// The DEF-338 gate sampled ONLY the scroller box. On a repeated open/clear/open
// the pane was briefly an empty placeholder with `--tf-tools-inset` 0; the gate
// took three identical wide samples and released, and the panel slide began
// only afterwards, narrowing the pane by half the inset (pane B 555 -> 423 on a
// 1378px stage) and painting a ~34% oversized first frame (slot 525 at 86%
// then 393 at 64%). The gate now signs on the measured inset AND requires it to
// match the host's requested target before it can settle.
// ---------------------------------------------------------------------------
describe("DEF-343 — the settle window is inset-aware", () => {
  const source = readFileSync(
    resolve(__dirname, "../../../src/renderer/components/DocumentView.tsx"),
    "utf8",
  );

  it("never settles a stable wide box whose inset is still below target", () => {
    const wide = { w: 525, h: 900, inset: 0 };
    // Three identical samples, but the Inspector slide has not started/ended:
    // exactly the overshoot frame the adversary recorded (inset 0px).
    expect(paneBoxSettled(wide, wide, wide, 264)).toBe(false);
  });

  it("settles once the inset reaches the target and the box is stable", () => {
    const settled = { w: 393, h: 900, inset: 264 };
    expect(paneBoxSettled(settled, settled, settled, 264)).toBe(true);
  });

  it("an inset mid-slide blocks the settle even when the box is static", () => {
    const a = { w: 465, h: 900, inset: 132 };
    const b = { w: 465, h: 900, inset: 200 };
    expect(paneBoxSettled(a, a, b, 264)).toBe(false);
  });

  it("a null target (no host target / single mode) keeps box-only behaviour", () => {
    const box = { w: 393, h: 900 };
    expect(paneBoxSettled(box, box, box, null)).toBe(true);
    expect(paneBoxSettled(box, box, box)).toBe(true);
  });

  it("paneInsetSettled is endpoint-aware with a half-pixel tolerance", () => {
    expect(paneInsetSettled(0, 0)).toBe(true);
    expect(paneInsetSettled(0, 264)).toBe(false);
    expect(paneInsetSettled(200, 264)).toBe(false);
    expect(paneInsetSettled(263.6, 264)).toBe(true);
    expect(paneInsetSettled(12, null)).toBe(true);
  });

  it("DocumentView re-runs the gate when the target, readiness or pageCount changes", () => {
    expect(source).toMatch(/\[multiModeEnabled, multiPane, pageCount, paneInsetTarget, paneContentReady\]/);
    expect(source).toMatch(/stageEl\s*=\s*node\.closest\("\.tab-stage"\)/);
    expect(source).toMatch(/getPropertyValue\("--tf-tools-inset"\)/);
    expect(source).toMatch(/if \(!paneContentReady \|\| pageCount <= 0\) \{/);
  });

  it("App supplies the requested Inspector inset AND the pane's document readiness", () => {
    const app = readFileSync(resolve(__dirname, "../../../src/renderer/App.tsx"), "utf8");
    // Phase 112 (chunk H) replaced the boolean `inspectorOpen` target with the
    // resolved `toolsInsetPx` from `resolvePanelComposition` (the same inset the
    // CSS consumes and the panes are fed); `paneContentReady` is unchanged.
    expect(app).toMatch(/paneInsetTarget=\{\s*toolsInsetPx/);
    expect(app).toMatch(/paneContentReady=\{meta\.kind !== "empty"\}/);
    expect(app).toMatch(/resolvePanelComposition/);
  });

  it("re-arms the first-fit gate when a CLEARED pane is re-opened (Multi Mode stays on)", () => {
    // The adversary's reopen path is the SAME view instance: pane "B" -> null
    // (clear) -> "B" (re-open). The pre-existing latch would skip the gate and
    // paint the stale wide fit. The reopen must drop the latch during render.
    expect(source).toMatch(/const reopenedPane =/);
    expect(source).toMatch(/prevMultiPaneRef\.current === null/);
    expect(source).toMatch(/prevMultiModeRef\.current === true/);
    expect(source).toMatch(/if \(reopenedPane && firstFitCommittedRef\.current\)/);
    expect(source).toMatch(/firstFitCommittedRef\.current = false;/);
    // And a plain Multi Mode toggle ON (prevMultiMode false) is excluded.
    expect(source).not.toMatch(/if \(multiPane !== null\) \{\s*firstFitCommittedRef\.current = false/);
  });
});
