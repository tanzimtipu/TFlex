// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  buildPageIndex,
  findPageHits,
  nextHitIndex,
  prevHitIndex,
} from "../../../src/renderer/search/searchIndex";

describe("search index", () => {
  it("finds hits across items and records correct boundaries", () => {
    // Items chosen so "the report" starts at item 0 and ends at the end of item 1.
    // Items:
    //   0: "Th"      (offset 0,  len 2)
    //   1: "e report" (offset 2,  len 8)  -> end of "report" sits at pos 10,
    //                                       which is the boundary between items.
    //   2: " concludes." (offset 10)
    // For an end-exclusive hit at pos 10 (end of "report"), locate returns
    // the LAST item that contains pos-1=9; that is item 1.
    const items = ["Th", "e report", " concludes."];
    const idx = buildPageIndex(items);
    const hits = findPageHits(idx, 7, "the report");
    expect(hits.length).toBe(1);
    const hit = hits[0];
    expect(hit.page).toBe(7);
    expect(hit.start.item).toBe(0);
    expect(hit.start.offset).toBe(0);
    // end.item depends on the locate boundary rules: pos=10 lands on item 2
    // (since endExclusive-1=9 is in item 1), so end.item is item 1.
    expect(hit.end.item).toBe(1);
    // round-trip: rendering start..end over items, clamped by endExclusive.
    const startOff = hit.start.offset;
    const item0 = items[hit.start.item].slice(startOff);
    const middle = items.slice(hit.start.item + 1, hit.end.item).join("");
    const itemN = items[hit.end.item].slice(0, hit.end.offset + 1);
    const flat = (item0 + middle + itemN).toLowerCase();
    expect(flat).toBe("the report");
  });

  it("is case-insensitive", () => {
    const idx = buildPageIndex(["Hello", " WORLD"]);
    const hits = findPageHits(idx, 1, "hello world");
    expect(hits.length).toBe(1);
  });

  it("returns no hits for empty query or empty page text", () => {
    const idx = buildPageIndex(["abc", "def"]);
    expect(findPageHits(idx, 1, "").length).toBe(0);
    expect(findPageHits(idx, 1, "   ").length).toBe(0);
    const empty = buildPageIndex([]);
    expect(findPageHits(empty, 1, "anything").length).toBe(0);
  });

  it("matches single character", () => {
    const idx = buildPageIndex(["alpha", " beta ", "gamma"]);
    const hits = findPageHits(idx, 2, "a");
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });

  it("locates non-ASCII correctly", () => {
    const idx = buildPageIndex(["café", " résumé"]);
    const hits = findPageHits(idx, 1, "café");
    expect(hits.length).toBe(1);
  });
});

describe("search hit cycling", () => {
  it("nextHitIndex wraps from last to first", () => {
    expect(nextHitIndex(0, 3)).toBe(1);
    expect(nextHitIndex(2, 3)).toBe(0);
    expect(nextHitIndex(2, 0)).toBe(-1);
  });

  it("prevHitIndex wraps from first to last", () => {
    expect(prevHitIndex(2, 3)).toBe(1);
    expect(prevHitIndex(0, 3)).toBe(2);
    expect(prevHitIndex(0, 0)).toBe(-1);
  });
});