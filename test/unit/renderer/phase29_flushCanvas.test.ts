// @vitest-environment node
// Phase 29 — FLUSH CANVAS. The page view has no empty space around it:
// the `.document-content` top/bottom padding and the `.document-scroller`
// right padding are 0 in every theme (including the frosted duplicate),
// and the scroll / annotation math still tracks the flush DOM exactly.
//
// Textual scan of styles.css for the geometry contracts a jsdom run
// cannot resolve (the established formsCssStacking / phase142Layout
// pattern), plus the pure pageGeometry + annotation helpers.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONTENT_PADDING_PX,
  PAGE_GAP_PX,
  mixedPageAtScrollTop,
  mixedSlotOffsetTop,
  pageAtScrollTop,
  slotOffsetTop,
  type MixedPageGeom,
} from "../../../src/renderer/components/pageGeometry";
import {
  clientToPagePoint,
  overlayPointToCss,
} from "../../../src/renderer/annotations/geometry";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function readStyles(): string {
  return readFileSync(STYLES_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

function firstBody(css: string, selector: string): string {
  const m = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css);
  return m?.[1] ?? "";
}

function lastBody(css: string, selector: string): string {
  const ms = [...css.matchAll(new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\}`, "g"))];
  return ms.at(-1)?.[1] ?? "";
}

describe("Phase 29 — flush canvas geometry", () => {
  it("CONTENT_PADDING_PX is 0 — no top/bottom gutter around the page view", () => {
    expect(CONTENT_PADDING_PX).toBe(0);
  });

  it("base .document-content has zero padding and keeps the inter-page gap", () => {
    const css = readStyles();
    const body = firstBody(css, "\\.document-content");
    expect(body).toMatch(/padding:\s*0\b/);
    expect(body).not.toMatch(/padding:\s*28px/);
    // The gap between consecutive sheets is NOT "space around the
    // canvas" — it stays so pages read as separate sheets.
    expect(body).toMatch(/gap:\s*18px/);
  });

  it("base .document-scroller has no right padding", () => {
    const css = readStyles();
    const body = firstBody(css, "\\.document-scroller");
    expect(body).toMatch(/padding-right:\s*0\b/);
    expect(body).not.toMatch(/padding-right:\s*8px/);
  });

  it("the frosted duplicates are flush too (every theme)", () => {
    const css = readStyles();
    const content = lastBody(css, ':root\\[data-theme="frosted"\\]\\s+\\.document-content');
    expect(content).toMatch(/padding:\s*0\b/);
    expect(content).not.toMatch(/padding:\s*28px/);
    const scroller = lastBody(css, ':root\\[data-theme="frosted"\\]\\s+\\.document-scroller');
    expect(scroller).toMatch(/padding-right:\s*0\b/);
  });

  it("slot offsets start at 0 and a page jump lands exactly on the page top", () => {
    // slotOffsetTop is what jumpToPage scrolls to (minus the top pad,
    // which is now 0). Page 5 of a 792pt page at scale 1:
    expect(slotOffsetTop(1, 792, 1)).toBe(0);
    expect(slotOffsetTop(5, 792, 1)).toBe(4 * (792 + PAGE_GAP_PX));
    // The landed page reads as itself (DEF-098 contract) with no pad drift.
    for (const page of [1, 5, 20]) {
      const landing = slotOffsetTop(page, 792, 1) - CONTENT_PADDING_PX;
      expect(landing).toBe(slotOffsetTop(page, 792, 1));
      expect(pageAtScrollTop(landing, 792, 1, 30)).toBe(page);
    }
  });

  it("mixed slot geometry starts at 0 and the jump target lands on the page", () => {
    const geom: MixedPageGeom[] = [
      { widthCss: 612, heightCss: 792 },
      { widthCss: 612, heightCss: 792 },
      { widthCss: 612, heightCss: 792 },
    ];
    expect(mixedSlotOffsetTop(1, geom)).toBe(0);
    for (const page of [1, 2, 3]) {
      const landing = mixedSlotOffsetTop(page, geom) - CONTENT_PADDING_PX;
      expect(mixedPageAtScrollTop(landing, geom, 3)).toBe(page);
    }
  });

  it("a jump that settles a sub-pixel short of the slot top still reads the landed page", () => {
    // Phase 29 — the flush layout removed the 28px top pad that used to
    // absorb sub-pixel landing error (the pad was not part of the
    // accumulated heights). A smooth scroll that settles 0.67px above
    // the computed slot top must still report the landed page.
    const geom20: MixedPageGeom[] = Array.from({ length: 20 }, () => ({
      widthCss: 612,
      heightCss: 792,
    }));
    const slot5Mixed = mixedSlotOffsetTop(5, geom20);
    expect(mixedPageAtScrollTop(slot5Mixed - 0.67, geom20, 20)).toBe(5);
    const slot5Uniform = slotOffsetTop(5, 792, 1);
    expect(pageAtScrollTop(slot5Uniform - 0.67, 792, 1, 20)).toBe(5);
  });

  it("annotation mapping is page-relative — a flush page introduces no offset drift", () => {
    // A pointer at a fixed client point must land on the same page
    // point and render back under the cursor, whatever the page
    // wrapper's absolute position (flush top=0 or an old 28px gutter).
    const scale = 1.5;
    const client = { x: 400, y: 300 };
    for (const wrapperTop of [0, 28]) {
      const wrapper = { left: 60, top: wrapperTop };
      const pagePoint = clientToPagePoint(client.x, client.y, wrapper, scale);
      const css = overlayPointToCss(pagePoint, scale);
      expect(css.left + wrapper.left).toBeCloseTo(client.x, 5);
      expect(css.top + wrapper.top).toBeCloseTo(client.y, 5);
    }
  });
});
