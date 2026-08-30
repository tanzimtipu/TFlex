// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  CONTENT_PADDING_PX,
  PAGE_GAP_PX,
  documentScrollHeight,
  pageAtScrollTop,
  pageSlotHeight,
  slotOffsetTop,
  visiblePageRange,
  visibleToSourcePage,
} from "../../../src/renderer/components/pageGeometry";

describe("page geometry", () => {
  it("pageSlotHeight adds the inter-slot gap to the CSS-scaled page height", () => {
    const h = pageSlotHeight(792, 1);
    expect(h).toBe(792 + PAGE_GAP_PX);
  });

  it("pageSlotHeight scales with cssScale", () => {
    expect(pageSlotHeight(612, 2)).toBe(612 * 2 + PAGE_GAP_PX);
    expect(pageSlotHeight(612, 0.5)).toBe(612 * 0.5 + PAGE_GAP_PX);
  });

  it("pageSlotHeight is zero for degenerate inputs", () => {
    expect(pageSlotHeight(0, 1)).toBe(0);
    expect(pageSlotHeight(792, 0)).toBe(0);
    expect(pageSlotHeight(-1, 1)).toBe(0);
  });

  it("slotOffsetTop starts at the container's top padding", () => {
    expect(slotOffsetTop(1, 792, 1)).toBe(CONTENT_PADDING_PX);
  });

  it("slotOffsetTop advances by pageSlotHeight per page", () => {
    const pageHeightPt = 792;
    const cssScale = 1;
    expect(slotOffsetTop(2, pageHeightPt, cssScale)).toBe(CONTENT_PADDING_PX + pageSlotHeight(pageHeightPt, cssScale));
    expect(slotOffsetTop(3, pageHeightPt, cssScale)).toBe(CONTENT_PADDING_PX + 2 * pageSlotHeight(pageHeightPt, cssScale));
    expect(slotOffsetTop(100, pageHeightPt, cssScale)).toBe(CONTENT_PADDING_PX + 99 * pageSlotHeight(pageHeightPt, cssScale));
  });

  it("slotOffsetTop(page) and pageAtScrollTop(slotOffsetTop(page)) round-trip", () => {
    const pageHeightPt = 612;
    const cssScale = 1.5;
    for (let page = 1; page <= 20; page += 1) {
      const top = slotOffsetTop(page, pageHeightPt, cssScale);
      expect(pageAtScrollTop(top, pageHeightPt, cssScale, 520)).toBe(page);
    }
  });

  it("pageAtScrollTop clamps to [1, pageCount]", () => {
    expect(pageAtScrollTop(-1000, 792, 1, 10)).toBe(1);
    expect(pageAtScrollTop(1_000_000, 792, 1, 10)).toBe(10);
  });

  it("pageAtScrollTop returns 1 for degenerate geometry", () => {
    expect(pageAtScrollTop(500, 0, 1, 10)).toBe(1);
    expect(pageAtScrollTop(500, 792, 0, 10)).toBe(1);
    expect(pageAtScrollTop(500, 792, 1, 0)).toBe(1);
  });

  it("documentScrollHeight accounts for every page slot plus top + bottom padding", () => {
    const pageHeightPt = 612;
    const cssScale = 1.5;
    const pageCount = 520;
    const expected =
      CONTENT_PADDING_PX * 2 + pageCount * pageSlotHeight(pageHeightPt, cssScale);
    expect(documentScrollHeight(pageCount, pageHeightPt, cssScale)).toBe(expected);
  });

  it("visiblePageRange returns [1, visibleCount] at the top of the doc", () => {
    const pageHeightPt = 792;
    const cssScale = 1;
    const slotHeight = pageSlotHeight(pageHeightPt, cssScale);
    const viewportHeight = slotHeight * 3; // 3 pages fit
    const range = visiblePageRange(0, viewportHeight, pageHeightPt, cssScale, 10, 1);
    expect(range.start).toBe(1);
    expect(range.end).toBeGreaterThanOrEqual(3);
    // 3 pages visible + 1-page buffer below = end 4 (or 5 if ceil rounds up)
    expect(range.end).toBeLessThanOrEqual(5);
  });

  it("visiblePageRange covers the right range as the user scrolls", () => {
    const pageHeightPt = 612;
    const cssScale = 1;
    const slotHeight = pageSlotHeight(pageHeightPt, cssScale);
    const viewportHeight = slotHeight * 2;
    // scrollTop in the middle of page 10
    const targetPage = 10;
    const scrollTop = slotOffsetTop(targetPage, pageHeightPt, cssScale) + 10;
    const range = visiblePageRange(scrollTop, viewportHeight, pageHeightPt, cssScale, 520, 1);
    expect(range.start).toBeLessThanOrEqual(targetPage);
    expect(range.end).toBeGreaterThanOrEqual(targetPage + 1);
  });

  it("visiblePageRange adds a buffer of bufferPages on each side", () => {
    const pageHeightPt = 792;
    const cssScale = 1;
    const slotHeight = pageSlotHeight(pageHeightPt, cssScale);
    const viewportHeight = slotHeight * 2;
    const scrollTop = slotOffsetTop(50, pageHeightPt, cssScale);
    const tight = visiblePageRange(scrollTop, viewportHeight, pageHeightPt, cssScale, 520, 0);
    const buffered = visiblePageRange(scrollTop, viewportHeight, pageHeightPt, cssScale, 520, 4);
    expect(buffered.start).toBeLessThanOrEqual(tight.start);
    expect(buffered.end).toBeGreaterThanOrEqual(tight.end);
    expect(buffered.start).toBeLessThanOrEqual(46);
    expect(buffered.end).toBeGreaterThanOrEqual(54);
  });

  it("visiblePageRange clamps to [1, pageCount]", () => {
    const pageHeightPt = 792;
    const cssScale = 1;
    const slotHeight = pageSlotHeight(pageHeightPt, cssScale);
    const range = visiblePageRange(-1_000_000, slotHeight * 2, pageHeightPt, cssScale, 10, 1);
    expect(range.start).toBe(1);
    const farRange = visiblePageRange(1_000_000_000, slotHeight * 2, pageHeightPt, cssScale, 10, 1);
    expect(farRange.end).toBe(10);
  });

  it("visiblePageRange returns [1, 1] for degenerate geometry", () => {
    expect(visiblePageRange(0, 500, 0, 1, 10)).toEqual({ start: 1, end: 1 });
    expect(visiblePageRange(0, 500, 792, 0, 10)).toEqual({ start: 1, end: 1 });
    expect(visiblePageRange(0, 500, 792, 1, 0)).toEqual({ start: 1, end: 1 });
  });
});

describe("visibleToSourcePage — DEF-064 (post-delete / reorder mapping)", () => {
  it("is the identity mapping for an unreordered doc", () => {
    // Initial state: pageOrder = [0, 1, 2, ...]. Each visible
    // position maps to the same source page. The visual scroller
    // and the rail agree on every page, so the mapping is
    // trivial.
    const order = [0, 1, 2, 3, 4];
    for (let v = 1; v <= 5; v += 1) {
      expect(visibleToSourcePage(v, order)).toBe(v);
    }
  });

  it("maps visible position 3 to source 4 after deleting visible page 2 (the DEF-064 repro)", () => {
    // The exact reproduction: a 5-page doc with the user deleting
    // visible page 2 leaves pageOrder = [0, 2, 3, 4] (engine drops
    // the source index of the deleted page) and pageCount = 4. The
    // visual scroller now has 4 slots; the slot at visible position
    // 3 must render the source page that was at original position 3
    // (1-based: source 3), not the slot at original position 3
    // (which is now visible 3 -> source 3). The previous bug
    // passed `pageNumber = visiblePage` to PageView, so
    // `doc.getPage(3)` always returned the same source page and
    // the document appeared unchanged.
    const orderAfterDelete = [0, 2, 3, 4];
    expect(visibleToSourcePage(1, orderAfterDelete)).toBe(1);
    expect(visibleToSourcePage(2, orderAfterDelete)).toBe(3);
    expect(visibleToSourcePage(3, orderAfterDelete)).toBe(4);
    expect(visibleToSourcePage(4, orderAfterDelete)).toBe(5);
  });

  it("maps visible -> source correctly after a reorder (swap pages 1 and 2)", () => {
    // After a reorder the pageOrder changes even though pageCount
    // does not. swap(1, 2) on a 3-page doc -> pageOrder = [1, 0, 2].
    // Visible position 1 must show the original source page 2.
    const order = [1, 0, 2];
    expect(visibleToSourcePage(1, order)).toBe(2);
    expect(visibleToSourcePage(2, order)).toBe(1);
    expect(visibleToSourcePage(3, order)).toBe(3);
  });

  it("returns 1 for visible page 0 (defensive — never expected)", () => {
    // Negative or zero visible pages are not real inputs; the
    // helper clamps to 1 so the scroller doesn't render a phantom
    // source page 0 (which pdf.js would reject as 1-based).
    expect(visibleToSourcePage(0, [0, 1, 2])).toBe(1);
    expect(visibleToSourcePage(-3, [0, 1, 2])).toBe(1);
  });

  it("falls back to identity when pageOrder is shorter than the visible count", () => {
    // Defensive: if the engine state and the visible count
    // disagree (shouldn't happen in production, but the helper
    // shouldn't throw), the scroller still renders *something*.
    // Visible 3 with a 2-element pageOrder returns 3 (identity)
    // rather than undefined.
    expect(visibleToSourcePage(3, [0, 1])).toBe(3);
  });
});
