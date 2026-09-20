// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  CONTENT_PADDING_PX,
  PAGE_GAP_PX,
  documentScrollHeight,
  mixedPageAtScrollTop,
  mixedSlotOffsetTop,
  mixedVisiblePageRange,
  pageAtScrollTop,
  pageSlotHeight,
  slotOffsetTop,
  visiblePageRange,
  visibleToSourcePage,
  visibleToSourcePageForProxy,
  type MixedPageGeom,
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

describe("mixed scroller geometry — DEF-141 + content top-pad parameter", () => {
  // The mixed helpers take the REAL content top padding (`topPad`).
  // Phase 29 made the canvas flush: CONTENT_PADDING_PX is 0, so the
  // default topPad is 0 in every theme and DocumentView passes exactly
  // that. The parameter is still exercised here with a chrome-shifted
  // value to prove the per-slot deltas stay flat under any top pad.
  const chromeY = 96;
  const shiftedTopPad = CONTENT_PADDING_PX + chromeY;
  // Three 792px-tall pages (post-rotation CSS height), 18px gap.
  const geom: MixedPageGeom[] = [
    { widthCss: 612, heightCss: 792 },
    { widthCss: 612, heightCss: 792 },
    { widthCss: 612, heightCss: 792 },
  ];
  const acc1 = 792 + PAGE_GAP_PX; // 810 — page-2 slot top minus padding
  const acc2 = acc1 + 792 + PAGE_GAP_PX; // 1620 — page-3 slot top minus padding

  it("mixedSlotOffsetTop defaults to the in-flow content padding and advances by slot heights + gap", () => {
    expect(mixedSlotOffsetTop(1, geom)).toBe(CONTENT_PADDING_PX);
    expect(mixedSlotOffsetTop(2, geom)).toBe(CONTENT_PADDING_PX + acc1);
    expect(mixedSlotOffsetTop(3, geom)).toBe(CONTENT_PADDING_PX + acc2);
  });

  it("mixedSlotOffsetTop starts at the REAL top padding when a shifted topPad is passed (chrome-shifted slots)", () => {
    expect(mixedSlotOffsetTop(1, geom, shiftedTopPad)).toBe(shiftedTopPad);
    expect(mixedSlotOffsetTop(2, geom, shiftedTopPad)).toBe(shiftedTopPad + acc1);
    expect(mixedSlotOffsetTop(3, geom, shiftedTopPad)).toBe(shiftedTopPad + acc2);
    // The per-slot deltas are untouched — the chrome shift is a flat
    // offset on every slot.
    expect(mixedSlotOffsetTop(3, geom, shiftedTopPad) - mixedSlotOffsetTop(2, geom, shiftedTopPad)).toBe(
      mixedSlotOffsetTop(3, geom) - mixedSlotOffsetTop(2, geom),
    );
  });

  it("mixedPageAtScrollTop (default, flush) keeps the DEF-098 landing contract: the landed page reads as itself", () => {
    // Flush landing for page 2: scrollTop = slotTop(2) - 0 = acc1.
    expect(mixedPageAtScrollTop(acc1, geom, 3)).toBe(2);
    expect(mixedPageAtScrollTop(acc2, geom, 3)).toBe(3);
    expect(mixedPageAtScrollTop(0, geom, 3)).toBe(1);
  });

  it("mixedPageAtScrollTop with a shifted topPad reports the landed page at the chrome-shifted landing (no 1-page offset)", () => {
    // Shifted landing for page N: the page top sits `chromeY` below
    // the viewport top edge, i.e. scrollTop = acc + chromeY.
    expect(mixedPageAtScrollTop(acc1 + chromeY, geom, 3, shiftedTopPad)).toBe(2);
    expect(mixedPageAtScrollTop(acc2 + chromeY, geom, 3, shiftedTopPad)).toBe(3);
    expect(mixedPageAtScrollTop(0, geom, 3, shiftedTopPad)).toBe(1);
  });

  it("mixedVisiblePageRange (shifted topPad) keeps a page mounted while its tail is still on screen", () => {
    // Page 1's slot spans [shiftedTopPad, shiftedTopPad + 792] =
    // [96, 888] in content coordinates; its gap-inclusive block ends
    // at shiftedTopPad + acc1 = 906 (acc1 = 810). At scrollTop 838
    // page 1's bottom is still 888-838 = 50px inside the viewport, so
    // the range must still START at page 1.
    const rangeStillMounted = mixedVisiblePageRange(838, 900, geom, 3, 0, shiftedTopPad);
    expect(rangeStillMounted.start, "page 1 must stay mounted while its tail is visible").toBe(1);
    // Only once the viewport top passes the slot's gap-inclusive REAL
    // bottom (topPad + acc1 = 906) may page 1 leave the mounted set.
    const rangeAfterClear = mixedVisiblePageRange(907, 900, geom, 3, 0, shiftedTopPad);
    expect(rangeAfterClear.start, "page 1 unmounts only after its block clears the viewport").toBe(2);
  });

  it("mixedVisiblePageRange with the default (flush) padding unmounts a page once its block clears the viewport top", () => {
    // Phase 29 flush: page 1's slot spans [0, 792]; its gap-inclusive
    // block ends at acc1 = 810. While the viewport top is still inside
    // that block page 1 stays mounted.
    expect(mixedVisiblePageRange(809, 900, geom, 3, 0).start).toBe(1);
    // At scrollTop 810 the viewport top sits exactly on page 2's slot
    // top, so page 1 leaves the mounted set.
    expect(mixedVisiblePageRange(810, 900, geom, 3, 0).start).toBe(2);
  });
});

describe("visibleToSourcePageForProxy — DEF-139 (post-refresh proxy vs original bytes)", () => {
  // The engine's pageOrder entries are pdf-lib ORIGINAL page indices.
  // A proxy built from the ORIGINAL open bytes is in identity file
  // order, so the pageOrder translation addresses it. A proxy rebuilt
  // from `engine.getDocumentBytes` (serializeDoc) is written in the
  // engine's VISIBLE order, so slot N is file page N (identity) and
  // the pageOrder translation is WRONG. `proxyVisibleOrder` carries
  // which family the renderer currently holds.

  it("delegates to the pageOrder translation for the original proxy (proxyVisibleOrder=false)", () => {
    // Insert-blank at position 2 of a 34-page doc (the DEF-139 repro).
    // pageOrder = [0, 34, 1, 2, ...]: the new blank is pdf-lib page 35.
    // Against the ORIGINAL 34-page bytes this slot renders the new
    // blank's pdf-lib page 35 — but that request is out of range on the
    // still-old proxy and DEF-121 drops it (placeholder). Slots that DO
    // resolve keep the original-file translation:
    const order = [0, 34, 1, 2, 3, 4];
    expect(visibleToSourcePageForProxy(1, order, false)).toBe(1);
    expect(visibleToSourcePageForProxy(2, order, false)).toBe(35);
    expect(visibleToSourcePageForProxy(3, order, false)).toBe(2);
    expect(visibleToSourcePageForProxy(4, order, false)).toBe(3);
  });

  it("maps every visible slot to itself once the proxy is a getDocumentBytes rebuild (proxyVisibleOrder=true)", () => {
    // After refreshDocProxyFor the file pages ARE the visible pages
    // (serializeDoc iterates doc.order). Slot 2 renders file page 2
    // (the new blank), slot 3 file page 3 (Chapter 1) — regardless of
    // the pdf-lib indices in pageOrder. This is exactly the DEF-139
    // "everything renders correctly without save+reopen" requirement.
    const order = [0, 34, 1, 2, 3, 4];
    expect(visibleToSourcePageForProxy(1, order, true)).toBe(1);
    expect(visibleToSourcePageForProxy(2, order, true)).toBe(2);
    expect(visibleToSourcePageForProxy(3, order, true)).toBe(3);
    expect(visibleToSourcePageForProxy(4, order, true)).toBe(4);
  });

  it("is identity for an unreordered doc in BOTH proxy families", () => {
    // At open pageOrder is identity, so the original-bytes translation
    // and the refreshed identity agree on every slot.
    const order = [0, 1, 2, 3, 4];
    for (let v = 1; v <= 5; v += 1) {
      expect(visibleToSourcePageForProxy(v, order, false)).toBe(v);
      expect(visibleToSourcePageForProxy(v, order, true)).toBe(v);
    }
  });

  it("maps delete-compacted docs by identity on the refreshed proxy (the DEF-139 delete class)", () => {
    // Delete visible page 2 from a 5-page doc: pageOrder = [0, 2, 3, 4]
    // (pdf-lib indices), and serializeDoc writes file pages [P1, P3, P4,
    // P5]. On the refreshed proxy slot 2 is file page 2 (old page 3),
    // slot 3 is file page 3 (old page 4) — identity, NOT the pdf-lib
    // indices 3 / 4 which would land on the wrong pages.
    const orderAfterDelete = [0, 2, 3, 4];
    expect(visibleToSourcePageForProxy(2, orderAfterDelete, true)).toBe(2);
    expect(visibleToSourcePageForProxy(3, orderAfterDelete, true)).toBe(3);
    expect(visibleToSourcePageForProxy(4, orderAfterDelete, true)).toBe(4);
  });
});
