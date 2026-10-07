// @vitest-environment node
//
// TFL-1146 (AR-01 / AR-04) — the scroll anchor survives every layout change.
//
// AR-01: on resize / dock reflow / fit recompute the reader must keep the same
// document location. The pre-TFL-1146 restore only pinned the anchor page's TOP
// EDGE, which drifts when the anchor page's HEIGHT changes (mixed page sizes,
// rotation, a fit scale step). TFL-1146 records the NORMALIZED in-page fraction
// the viewport top was cutting and lands that same point at the same viewport
// offset after the reflow.
//
// AR-04: a capture that belongs to an older layout/document generation must be
// discarded instead of restored against the current layout.
//
// These are pure maths checks; the mocks are plain objects, no DOM.

import { describe, expect, it } from "vitest";
import {
  anchorOffsetAfter,
  normalizedAnchorFraction,
  runZoomFlip,
  zoomFlipIsStale,
  type ZoomFlipPageEl,
  type ZoomFlipPending,
  type ZoomFlipRect,
} from "../../../src/renderer/components/zoomFlip";

function rect(top: number, height: number): ZoomFlipRect {
  return { left: 0, top, width: 800, height };
}

describe("TFL-1146 — normalized anchor fraction", () => {
  it("reads the in-page fraction the viewport top cuts, clamped 0..1", () => {
    // 200px scrolled into a 1000px page -> fraction 0.2.
    expect(normalizedAnchorFraction(-200, 1000)).toBeCloseTo(0.2, 9);
    // Anchor top below the viewport top (scrolled to the very start) -> 0.
    expect(normalizedAnchorFraction(40, 1000)).toBe(0);
    // Scrolled past the bottom of the page -> clamped to 1.
    expect(normalizedAnchorFraction(-1400, 1000)).toBe(1);
    // Degenerate input never throws / drifts.
    expect(normalizedAnchorFraction(Number.NaN, 1000)).toBe(0);
    expect(normalizedAnchorFraction(-200, 0)).toBe(0);
  });
});

describe("TFL-1146 — anchorOffsetAfter keeps the in-page point fixed", () => {
  it("restores the same fraction across a SCALE change (page height shrinks)", () => {
    const fraction = 0.2;
    const before = -200; // anchor top offset BEFORE
    const target = anchorOffsetAfter(before, fraction, 1000, 500);
    expect(target).toBeCloseTo(-100, 9);
    // The recorded point (fraction 0.2 into the page) stays at the same
    // viewport offset: -100 + 0.2 * 500 === -200 + 0.2 * 1000.
    expect(target + fraction * 500).toBeCloseTo(before + fraction * 1000, 9);
  });

  it("restores the same fraction across a PAGE-HEIGHT change (page grows)", () => {
    const fraction = 0.2;
    const before = -200;
    const target = anchorOffsetAfter(before, fraction, 1000, 1200);
    expect(target).toBeCloseTo(-240, 9);
    expect(target + fraction * 1200).toBeCloseTo(before + fraction * 1000, 9);
  });

  it("fraction 0 reduces to the old top-edge rule; non-finite input falls back", () => {
    expect(anchorOffsetAfter(-50, 0, 1000, 500)).toBe(-50);
    expect(anchorOffsetAfter(-50, Number.NaN, 1000, 500)).toBe(-50);
    expect(anchorOffsetAfter(Number.NaN, 0.2, 1000, 500)).toBe(Number.NaN);
  });
});

describe("TFL-1146 — generation staleness", () => {
  const pending = (generation?: number): ZoomFlipPending => ({
    firstRects: new Map(),
    anchorPage: null,
    anchorOffsetBefore: 0,
    generation,
  });

  it("marks only a mismatched generation as stale", () => {
    expect(zoomFlipIsStale(pending(4), 4)).toBe(false);
    expect(zoomFlipIsStale(pending(4), 5)).toBe(true);
    // A pending with no generation is never stale (pre-TFL-1146 shape).
    expect(zoomFlipIsStale(pending(undefined), 9)).toBe(false);
  });
});

describe("TFL-1146 — runZoomFlip restores the fraction and drops a stale capture", () => {
  function makeSim(): {
    scroller: { scrollTop: number; getBoundingClientRect: () => ZoomFlipRect };
    page: ZoomFlipPageEl;
    layout: (contentTop: number, height: number) => void;
    scrollTop: () => number;
  } {
    let scrollTop = 0;
    let contentTop = 0;
    let height = 1;
    const scroller = {
      get scrollTop(): number {
        return scrollTop;
      },
      set scrollTop(v: number) {
        scrollTop = v;
      },
      getBoundingClientRect: (): ZoomFlipRect => ({ left: 0, top: 0, width: 1200, height: 800 }),
    };
    const el = {
      getBoundingClientRect: (): ZoomFlipRect => rect(contentTop - scrollTop, height),
    };
    return {
      scroller,
      page: { page: 10, el: el as unknown as HTMLElement },
      layout: (nextTop, nextHeight) => {
        contentTop = nextTop;
        height = nextHeight;
      },
      scrollTop: () => scrollTop,
    };
  }

  it("lands the same in-page point after a scale change", () => {
    const sim = makeSim();
    sim.layout(1400, 1000);
    sim.scroller.scrollTop = 1600; // anchor top offset = -200, fraction 0.2
    const pending: ZoomFlipPending = {
      firstRects: new Map(),
      anchorPage: 10,
      anchorOffsetBefore: -200,
      anchorFraction: 0.2,
      anchorHeightBefore: 1000,
      generation: 1,
    };
    sim.layout(1200, 500); // reflow: page shrinks
    runZoomFlip(sim.scroller, [sim.page], pending, true, "zoom", 1);
    const after = sim.page.el.getBoundingClientRect().top; // scroller top = 0
    expect(after).toBeCloseTo(-100, 9);
    expect(after + 0.2 * 500).toBeCloseTo(0, 9);
    expect(sim.scrollTop()).toBe(1300);
  });

  it("discards a stale generation: no scroll restore, no animation", () => {
    const sim = makeSim();
    sim.layout(1400, 1000);
    sim.scroller.scrollTop = 1600;
    const pending: ZoomFlipPending = {
      firstRects: new Map([[10, rect(-200, 1000)]]),
      anchorPage: 10,
      anchorOffsetBefore: -200,
      anchorFraction: 0.2,
      anchorHeightBefore: 1000,
      generation: 1,
    };
    sim.layout(1200, 500);
    const animated = runZoomFlip(sim.scroller, [sim.page], pending, false, "zoom", 2);
    expect(animated).toBe(0);
    expect(sim.scrollTop()).toBe(1600);
  });
});
