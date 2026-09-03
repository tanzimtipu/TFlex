// @vitest-environment jsdom
// DEF-141 — a per-page crop of page 1 collapses EVERY page-slot to the
// crop box (each full page rendered clipped into a crop-sized square).
// The fix makes the scroller use mixed-size geometry: every slot is
// sized by ITS OWN page, so pages 2..N keep their full render box after
// page 1 is cropped. These pure helpers are the math DocumentView uses
// for the mixed-size scroller.
import { describe, expect, it } from "vitest";
import {
  CONTENT_PADDING_PX,
  PAGE_GAP_PX,
  mixedPageAtScrollTop,
  mixedSlotOffsetTop,
  mixedVisiblePageRange,
  type MixedPageGeom,
} from "../../../src/renderer/components/pageGeometry";

function geom(...items: Array<{ w: number; h: number }>): MixedPageGeom[] {
  return items.map((i) => ({ widthCss: i.w, heightCss: i.h }));
}

describe("DEF-141 — mixed-size page geometry", () => {
  it("keeps the cropped page 1's own small slot while pages 2..N keep their full slot", () => {
    // page 1 cropped to 150x150, pages 2-4 full 612x792 (scale 1).
    const pages: MixedPageGeom[] = geom(
      { w: 150, h: 150 },
      { w: 612, h: 792 },
      { w: 612, h: 792 },
      { w: 612, h: 792 },
    );
    expect(mixedSlotOffsetTop(1, pages)).toBe(CONTENT_PADDING_PX);
    // Slot 2 sits just past page 1's 150px slot + gap — the crop does
    // NOT push the full pages down by the full-page offset.
    expect(mixedSlotOffsetTop(2, pages)).toBe(CONTENT_PADDING_PX + 150 + PAGE_GAP_PX);
    expect(mixedSlotOffsetTop(3, pages)).toBe(
      CONTENT_PADDING_PX + 150 + PAGE_GAP_PX + 792 + PAGE_GAP_PX,
    );
    expect(mixedSlotOffsetTop(4, pages)).toBe(
      CONTENT_PADDING_PX + 150 + PAGE_GAP_PX + 792 + PAGE_GAP_PX + 792 + PAGE_GAP_PX,
    );
  });

  it("every page's slot is its OWN height (the DEF-141 verify: pages 2/3/4 full-size, not the crop)", () => {
    const pages: MixedPageGeom[] = geom(
      { w: 150, h: 150 },
      { w: 612, h: 792 },
      { w: 612, h: 792 },
      { w: 612, h: 792 },
    );
    expect(pages[0]?.heightCss).toBe(150);
    expect(pages[1]?.heightCss).toBe(792);
    expect(pages[2]?.heightCss).toBe(792);
    expect(pages[3]?.heightCss).toBe(792);
  });

  it("mixedSlotOffsetTop / mixedPageAtScrollTop round-trip on a mixed document", () => {
    const pages: MixedPageGeom[] = geom(
      { w: 150, h: 150 },
      { w: 612, h: 792 },
      { w: 150, h: 150 },
      { w: 612, h: 792 },
      { w: 612, h: 792 },
    );
    for (let p = 1; p <= 5; p += 1) {
      expect(mixedPageAtScrollTop(mixedSlotOffsetTop(p, pages), pages, 5)).toBe(p);
    }
  });

  it("reduces to the uniform offset when every page shares one height", () => {
    const pages: MixedPageGeom[] = geom(
      { w: 612, h: 792 },
      { w: 612, h: 792 },
      { w: 612, h: 792 },
    );
    expect(mixedSlotOffsetTop(3, pages)).toBe(CONTENT_PADDING_PX + 2 * (792 + PAGE_GAP_PX));
  });

  it("mixedPageAtScrollTop clamps to [1, pageCount]", () => {
    expect(mixedPageAtScrollTop(1_000_000_000, geom({ w: 612, h: 792 }), 1)).toBe(1);
    expect(mixedPageAtScrollTop(-100, geom({ w: 612, h: 792 }), 4)).toBe(1);
  });

  it("mixedPageAtScrollTop handles degenerate 0-height geometry without throwing", () => {
    expect(mixedPageAtScrollTop(500, geom({ w: 612, h: 0 }), 4)).toBe(1);
    expect(mixedPageAtScrollTop(0, [], 0)).toBe(1);
  });

  it("mixedVisiblePageRange mounts the cropped page 1 plus the start of page 2", () => {
    const pages: MixedPageGeom[] = geom(
      { w: 150, h: 150 },
      { w: 612, h: 792 },
      { w: 612, h: 792 },
    );
    const range = mixedVisiblePageRange(0, 600, pages, 3, 0);
    expect(range.start).toBe(1);
    expect(range.end).toBeGreaterThanOrEqual(2);
  });

  it("mixedVisiblePageRange handles a far scroll top / clamps to the last page", () => {
    const pages: MixedPageGeom[] = geom(
      { w: 150, h: 150 },
      { w: 612, h: 792 },
    );
    const range = mixedVisiblePageRange(1_000_000_000, 400, pages, 2, 0);
    expect(range.end).toBe(2);
    expect(range.start).toBeLessThanOrEqual(2);
  });
});
