// @vitest-environment jsdom
//
// DEF-302 — the page zoom reads as ONE motion.
//
// Diagnosis (qa): the `.page-slot` flow box resized INSTANTLY in the frame the
// transform animation started (zoom-in slotH 1568->1584, zoom-out
// 1584->1386) while only the `.pdf-page` transform animated over 250ms
// (scale 0.9902->1 / 1.143->1). With the old centre-origin scale the content
// rubber-banded inside an already-resized box; on a 25% step the default
// `transform-origin: 50% 50%` started the content ~198px from where the new
// layout had already put it.
//
// The fix is a real FLIP about the TOP-LEFT:
//   sx = first.width / last.width      sy = first.height / last.height
//   dx = first.left - last.left        dy = first.top - last.top
//   transform = translate(dx, dy) scale(sx, sy)   (transform-origin: 0 0)
// animated to identity over the motion token, plus a scroll-anchor correction
// so a scrolled-down document does not jump.
//
// REOPENED: the FLIP covered only the content wrapper while the sheet's paper
// (the `.page-slot` background) reflowed instantly, so the sheet outline
// teleported in the first painted frame. The animated unit is therefore the
// PAPER-OWNING element (`.page-slot`, which contains `.pdf-page`), so paper
// and content move as one. These tests fail if the paper layer is excluded.
//
// These tests pin the pure maths, the CSS origin, the per-unit (paper +
// content) application, the scroll anchor on a scrolled document, the unit
// end-event filter, and the instant (reduced motion / Animations off)
// suppression.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyZoomFlip,
  clearZoomFlip,
  isZoomFlipEnd,
  runZoomFlip,
  scrollAnchorDelta,
  zoomAnchorPage,
  zoomFlipInvert,
  ZOOM_FLIP_ANIMATION,
  ZOOM_FLIP_CLASS,
  ZOOM_FLIP_DX_VAR,
  ZOOM_FLIP_DY_VAR,
  ZOOM_FLIP_FROM_VAR,
  ZOOM_FLIP_UNIT_SELECTOR,
  type ZoomFlipPending,
  type ZoomFlipPageEl,
  type ZoomFlipRect,
} from "../../../src/renderer/components/zoomFlip";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function stripCssComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Body of the FIRST rule whose selector starts with `selector`. */
function findRuleBody(s: string, selector: string): string | null {
  const stripped = stripCssComments(s);
  const idx = stripped.indexOf(selector);
  if (idx === -1) return null;
  const braceOpen = stripped.indexOf("{", idx);
  if (braceOpen === -1) return null;
  let depth = 0;
  for (let i = braceOpen; i < stripped.length; i += 1) {
    const ch = stripped[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return stripped.slice(braceOpen + 1, i);
    }
  }
  return null;
}

function withRect(el: HTMLElement, rect: ZoomFlipRect): HTMLElement {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ ...rect }),
  });
  return el;
}

// ---------------------------------------------------------------------------
// The pure invert maths
// ---------------------------------------------------------------------------

describe("DEF-302 — zoomFlipInvert", () => {
  const inRect: ZoomFlipRect = { left: 100, top: 50, width: 1212, height: 1568 };

  it("a zoom-IN (shrink) step scales down about the top-left; no move", () => {
    const grown: ZoomFlipRect = { left: 100, top: 50, width: 1224, height: 1584 };
    const inv = zoomFlipInvert(inRect, grown);
    expect(inv).not.toBeNull();
    expect(inv?.sx).toBeCloseTo(1212 / 1224, 6); // 0.9902
    expect(inv?.sy).toBeCloseTo(1568 / 1584, 6); // 0.9899
    expect(inv?.dx).toBeCloseTo(0, 6);
    expect(inv?.dy).toBeCloseTo(0, 6);
  });

  it("a zoom-OUT (grow) step starts larger than the new box", () => {
    const shrunk: ZoomFlipRect = { left: 100, top: 50, width: 1071, height: 1386 };
    const first: ZoomFlipRect = { left: 100, top: 50, width: 1224, height: 1584 };
    const inv = zoomFlipInvert(first, shrunk);
    expect(inv).not.toBeNull();
    expect(inv?.sx).toBeCloseTo(1224 / 1071, 6); // 1.1428
    expect(inv?.sy).toBeCloseTo(1584 / 1386, 6); // 1.1428
  });

  it("a size change that MOVES the element captures the top-left delta", () => {
    const inv = zoomFlipInvert(
      { left: 100, top: 50, width: 200, height: 300 },
      { left: 130, top: 90, width: 200, height: 300 },
    );
    expect(inv).not.toBeNull();
    expect(inv?.dx).toBeCloseTo(-30, 6);
    expect(inv?.dy).toBeCloseTo(-40, 6);
    expect(inv?.sx).toBeCloseTo(1, 6);
    expect(inv?.sy).toBeCloseTo(1, 6);
  });

  it("is a no-op when the rects are equal (returns null)", () => {
    expect(zoomFlipInvert(inRect, { ...inRect })).toBeNull();
    expect(
      zoomFlipInvert(inRect, { ...inRect, left: inRect.left + 0.001, top: inRect.top - 0.001 }),
    ).toBeNull();
  });

  it("rejects zero / negative / non-finite measurements", () => {
    expect(zoomFlipInvert({ ...inRect, width: 0 }, inRect)).toBeNull();
    expect(zoomFlipInvert(inRect, { ...inRect, height: -5 })).toBeNull();
    expect(zoomFlipInvert({ ...inRect, left: Number.NaN }, inRect)).toBeNull();
    expect(zoomFlipInvert(inRect, { ...inRect, top: Number.POSITIVE_INFINITY })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The applier — one animation per wrapper, the exact start vars
// ---------------------------------------------------------------------------

describe("DEF-302 — applyZoomFlip", () => {
  it("writes the numeric from-scale + the px translate and adds the class", () => {
    const el = withRect(document.createElement("div"), {
      left: 130,
      top: 90,
      width: 1224,
      height: 1584,
    });
    const ok = applyZoomFlip(el, { left: 100, top: 50, width: 1212, height: 1568 });
    expect(ok).toBe(true);
    expect(el.classList.contains(ZOOM_FLIP_CLASS)).toBe(true);
    // The e2e contract asserts Number(--tf-zoom-flip-from) > 0.
    const from = Number(el.style.getPropertyValue(ZOOM_FLIP_FROM_VAR));
    expect(from).toBeGreaterThan(0);
    expect(from).toBeCloseTo(1212 / 1224, 6);
    expect(el.style.getPropertyValue(ZOOM_FLIP_DX_VAR)).toBe("-30px");
    expect(el.style.getPropertyValue(ZOOM_FLIP_DY_VAR)).toBe("-40px");
  });

  it("applies nothing when the wrapper did not move or resize", () => {
    const el = withRect(document.createElement("div"), {
      left: 100,
      top: 50,
      width: 1212,
      height: 1568,
    });
    expect(applyZoomFlip(el, { left: 100, top: 50, width: 1212, height: 1568 })).toBe(false);
    expect(el.classList.contains(ZOOM_FLIP_CLASS)).toBe(false);
    expect(el.style.getPropertyValue(ZOOM_FLIP_FROM_VAR)).toBe("");
  });

  it("clearZoomFlip erases the class and every start var", () => {
    const el = withRect(document.createElement("div"), {
      left: 100,
      top: 50,
      width: 1224,
      height: 1584,
    });
    applyZoomFlip(el, { left: 100, top: 50, width: 1212, height: 1568 });
    clearZoomFlip(el);
    expect(el.classList.contains(ZOOM_FLIP_CLASS)).toBe(false);
    expect(el.style.getPropertyValue(ZOOM_FLIP_FROM_VAR)).toBe("");
    expect(el.style.getPropertyValue(ZOOM_FLIP_DX_VAR)).toBe("");
    expect(el.style.getPropertyValue(ZOOM_FLIP_DY_VAR)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// A tiny scrolled-document simulator: a page's viewport top is its content
// top minus the scroller's scrollTop, so setting scrollTop really moves it.
// ---------------------------------------------------------------------------

interface Sim {
  scroller: { scrollTop: number; getBoundingClientRect: () => ZoomFlipRect };
  page: (n: number, contentTop: number, w: number, h: number) => ZoomFlipPageEl;
  setContentTop: (n: number, v: number) => void;
  setSize: (n: number, w: number, h: number) => void;
  scrollTop: () => number;
}

function makeSim(): Sim {
  let scrollTop = 0;
  const contentTops = new Map<number, number>();
  const dims = new Map<number, { w: number; h: number }>();
  const scroller = {
    get scrollTop(): number {
      return scrollTop;
    },
    set scrollTop(v: number) {
      scrollTop = v;
    },
    getBoundingClientRect: (): ZoomFlipRect => ({ left: 0, top: 0, width: 1200, height: 800 }),
  };
  const page = (n: number, contentTop: number, w: number, h: number): ZoomFlipPageEl => {
    const el = document.createElement("div");
    contentTops.set(n, contentTop);
    dims.set(n, { w, h });
    Object.defineProperty(el, "getBoundingClientRect", {
      configurable: true,
      value: (): ZoomFlipRect => ({
        left: 100,
        top: (contentTops.get(n) ?? 0) - scrollTop,
        width: dims.get(n)?.w ?? 0,
        height: dims.get(n)?.h ?? 0,
      }),
    });
    return { page: n, el };
  };
  return {
    scroller,
    page,
    setContentTop: (n, v) => contentTops.set(n, v),
    setSize: (n, w, h) => dims.set(n, { w, h }),
    scrollTop: () => scrollTop,
  };
}

// ---------------------------------------------------------------------------
// One animation per mounted page
// ---------------------------------------------------------------------------

describe("DEF-302 — runZoomFlip animates every mounted page", () => {
  it("plays the FLIP on each page with that page's own inverse", () => {
    const sim = makeSim();
    const p1 = sim.page(1, 0, 1224, 1584);
    const p2 = sim.page(2, 1602, 1224, 1584);
    const firstRects = new Map<number, ZoomFlipRect>([
      [1, { left: 100, top: 0, width: 1224, height: 1584 }],
      [2, { left: 100, top: 1602, width: 1224, height: 1584 }],
    ]);
    // Layout: both pages grow to 1280x1656; page 2 keeps 18px gap.
    sim.setContentTop(1, 0);
    sim.setContentTop(2, 1698);
    sim.setSize(1, 1280, 1656);
    sim.setSize(2, 1280, 1656);
    const pending: ZoomFlipPending = { firstRects, anchorPage: 1, anchorOffsetBefore: 0 };
    const animated = runZoomFlip(sim.scroller, [p1, p2], pending, false);
    expect(animated).toBe(2);
    expect(p1.el.classList.contains(ZOOM_FLIP_CLASS)).toBe(true);
    expect(p2.el.classList.contains(ZOOM_FLIP_CLASS)).toBe(true);
    expect(Number(p1.el.style.getPropertyValue(ZOOM_FLIP_FROM_VAR))).toBeCloseTo(1224 / 1280, 6);
    // Page 2's content top moved down 96px (page 1 grew above it), so its
    // inverse carries that translate alongside its own scale.
    expect(p2.el.style.getPropertyValue(ZOOM_FLIP_DY_VAR)).toBe("-96px");
    expect(Number(p2.el.style.getPropertyValue(ZOOM_FLIP_FROM_VAR))).toBeCloseTo(1224 / 1280, 6);
  });

  it("skips a page with no captured First rect", () => {
    const sim = makeSim();
    const p1 = sim.page(1, 0, 1280, 1656);
    const firstRects = new Map<number, ZoomFlipRect>();
    const pending: ZoomFlipPending = { firstRects, anchorPage: null, anchorOffsetBefore: 0 };
    expect(runZoomFlip(sim.scroller, [p1], pending, false)).toBe(0);
    expect(p1.el.classList.contains(ZOOM_FLIP_CLASS)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The scroll anchor — scrolled-down document must not jump
// ---------------------------------------------------------------------------

describe("DEF-302 — the scroll anchor is preserved on a scrolled document", () => {
  it("picks the page occupying the viewport top; first page at the very top", () => {
    const sim = makeSim();
    const above = sim.page(10, 1400, 1224, 1584);
    const below = sim.page(11, 3002, 1224, 1584);
    sim.scroller.scrollTop = 1450; // page 10's top sits 50px above the viewport
    expect(zoomAnchorPage([above, below], 0)?.page).toBe(10);
    sim.scroller.scrollTop = 0; // page 10 now starts below the top edge
    expect(zoomAnchorPage([above, below], 0)?.page).toBe(10);
    expect(zoomAnchorPage([], 0)).toBeNull();
  });

  it("re-anchors the scroller so the anchor page's top does not move", () => {
    const sim = makeSim();
    const p10 = sim.page(10, 1400, 1224, 1584);
    const p11 = sim.page(11, 3002, 1224, 1584);
    sim.scroller.scrollTop = 1450; // anchor viewport top = -50
    const firstRects = new Map<number, ZoomFlipRect>([
      [10, { left: 100, top: -50, width: 1224, height: 1584 }],
      [11, { left: 100, top: 1552, width: 1224, height: 1584 }],
    ]);
    const pending: ZoomFlipPending = { firstRects, anchorPage: 10, anchorOffsetBefore: -50 };

    // Zoom in: pages 1..9 above grew, so page 10's content top moves DOWN
    // 170px and both pages are re-laid-out larger.
    sim.setContentTop(10, 1570);
    sim.setContentTop(11, 3304);
    sim.setSize(10, 1280, 1656);
    sim.setSize(11, 1280, 1656);

    const animated = runZoomFlip(sim.scroller, [p10, p11], pending, false);

    expect(animated).toBe(2);
    // The correction scrolled down by the 170px the layout shifted.
    expect(sim.scrollTop()).toBe(1620);
    // The anchor page's top is exactly where it was before the zoom.
    expect(p10.el.getBoundingClientRect().top).toBe(pending.anchorOffsetBefore);
    // The page below eased from its old viewport top to the corrected one.
    expect(p11.el.style.getPropertyValue(ZOOM_FLIP_DY_VAR)).toBe("-132px");
  });

  it("scrollAnchorDelta is after - before, and safe on non-finite input", () => {
    expect(scrollAnchorDelta(-50, 120)).toBe(170);
    expect(scrollAnchorDelta(10, 10)).toBe(0);
    expect(scrollAnchorDelta(Number.NaN, 5)).toBe(0);
    expect(scrollAnchorDelta(5, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Instant motion (reduced motion / Animations off)
// ---------------------------------------------------------------------------

describe("DEF-302 — instant motion suppresses the animation, keeps the anchor", () => {
  it("applies no class/vars but still restores the scroll anchor", () => {
    const sim = makeSim();
    const p10 = sim.page(10, 1400, 1224, 1584);
    sim.scroller.scrollTop = 1450; // anchor viewport top = -50
    const firstRects = new Map<number, ZoomFlipRect>([
      [10, { left: 100, top: -50, width: 1224, height: 1584 }],
    ]);
    const pending: ZoomFlipPending = { firstRects, anchorPage: 10, anchorOffsetBefore: -50 };
    sim.setContentTop(10, 1570);

    const animated = runZoomFlip(sim.scroller, [p10], pending, true);

    expect(animated).toBe(0);
    expect(p10.el.classList.contains(ZOOM_FLIP_CLASS)).toBe(false);
    expect(p10.el.style.getPropertyValue(ZOOM_FLIP_FROM_VAR)).toBe("");
    expect(sim.scrollTop()).toBe(1620);
    expect(p10.el.getBoundingClientRect().top).toBe(-50);
  });
});

// ---------------------------------------------------------------------------
// DEF-302 (reopened) — the FLIP unit is the PAPER-OWNING page unit.
//
// qa's frame evidence pinned the residual: the FLIP animated only `.pdf-page`
// while the sheet's PAPER (the `.page-slot` background) reflowed instantly to
// the new size, so the first painted frame already showed the new sheet
// outline and the content animated into it. These tests FAIL if the paper
// layer is excluded from the animated unit.
// ---------------------------------------------------------------------------

describe("DEF-302 (reopened) — the animated unit carries the paper AND the content", () => {
  /** slot > .pdf-page > (.pdf-page-canvas + .textLayer): the app's shape. */
  function buildPageUnit(): {
    slot: HTMLDivElement;
    page: HTMLDivElement;
    canvas: HTMLCanvasElement;
  } {
    const slot = document.createElement("div");
    slot.className = "page-slot";
    const page = document.createElement("div");
    page.className = "pdf-page";
    const canvas = document.createElement("canvas");
    canvas.className = "pdf-page-canvas";
    const text = document.createElement("div");
    text.className = "textLayer";
    page.append(canvas, text);
    slot.appendChild(page);
    return { slot, page, canvas };
  }

  it("the unit owns the sheet paper and contains the content in one element", () => {
    const { slot, page, canvas } = buildPageUnit();
    // The unit selector matches the PAPER-OWNING element (its white background
    // is asserted against styles.css in the next test) ...
    expect(slot.matches(ZOOM_FLIP_UNIT_SELECTOR)).toBe(true);
    // ... and the content wrapper is INSIDE it, so one transform moves both.
    expect(slot.contains(page)).toBe(true);
    expect(slot.contains(canvas)).toBe(true);
    // The content wrapper alone is NOT the unit — animating it alone is the
    // reopened defect (paper excluded).
    expect(page.matches(ZOOM_FLIP_UNIT_SELECTOR)).toBe(false);
  });

  it("applies the invert to the paper unit, not the content-only wrapper, with the same maths", () => {
    const { slot, page } = buildPageUnit();
    const first: ZoomFlipRect = { left: 260, top: 0, width: 304, height: 394 };
    const last: ZoomFlipRect = { left: 244, top: 0, width: 335, height: 434 };
    withRect(slot, last);

    const ok = applyZoomFlip(slot, first);
    const inv = zoomFlipInvert(first, last);
    expect(inv).not.toBeNull();
    expect(ok).toBe(true);
    // The PAPER element carries the class + the same invert values ...
    expect(slot.classList.contains(ZOOM_FLIP_CLASS)).toBe(true);
    expect(Number(slot.style.getPropertyValue(ZOOM_FLIP_FROM_VAR))).toBeCloseTo(inv?.sx ?? 0, 6);
    expect(slot.style.getPropertyValue(ZOOM_FLIP_DX_VAR)).toBe(`${Number(inv?.dx.toFixed(4))}px`);
    expect(slot.style.getPropertyValue(ZOOM_FLIP_DY_VAR)).toBe(`${Number(inv?.dy.toFixed(4))}px`);
    // ... and the content wrapper does NOT animate on its own (no double
    // transform: paper and content stay one rigid unit).
    expect(page.classList.contains(ZOOM_FLIP_CLASS)).toBe(false);
    expect(page.style.getPropertyValue(ZOOM_FLIP_FROM_VAR)).toBe("");
  });

  it("the unit is the element styles.css paints paper-white", () => {
    const css = readFileSync(STYLES_PATH, "utf8");
    const slotBody = findRuleBody(css, ZOOM_FLIP_UNIT_SELECTOR);
    expect(slotBody).not.toBeNull();
    // The unit paints the sheet paper (DEF-099) — this is WHY the FLIP must
    // animate it: the paper is the instantly-reflowing layer.
    expect(slotBody ?? "").toMatch(/background:\s*#ffffff/);
    // The content wrapper is a CHILD of the unit, so it rides the same frame.
    const pageBody = findRuleBody(css, ".pdf-page {");
    expect(pageBody).not.toBeNull();
    expect(pageBody ?? "").toMatch(/background:\s*#ffffff/);
    expect(pageBody ?? "").toMatch(/box-shadow:\s*var\(--shadow-page\)/);
  });
});

describe("DEF-302 (reopened) — isZoomFlipEnd clears only the unit's own animation", () => {
  it("accepts the unit's own tf-page-zoom-flip end", () => {
    const el = document.createElement("div");
    expect(isZoomFlipEnd({ animationName: ZOOM_FLIP_ANIMATION, target: el }, el)).toBe(true);
  });

  it("ignores a descendant's bubbling animationend (target is not the unit)", () => {
    const unit = document.createElement("div");
    const child = document.createElement("div");
    unit.appendChild(child);
    expect(isZoomFlipEnd({ animationName: ZOOM_FLIP_ANIMATION, target: child }, unit)).toBe(false);
  });

  it("ignores a different animation name on the unit", () => {
    const el = document.createElement("div");
    expect(isZoomFlipEnd({ animationName: "some-other-anim", target: el }, el)).toBe(false);
  });
});

