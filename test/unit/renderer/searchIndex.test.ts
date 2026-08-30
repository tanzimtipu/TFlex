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

  // DEF-050 — search indexer handling of OCR-injected text.
  //
  // The engine writes OCR words onto each page with
  // `TextRenderingMode.Invisible` (PDF `Tr=3`). From pdf.js's
  // perspective the resulting TextItems are identical in shape to
  // visible-text items — `getTextContent()` returns the same
  // `{ str, transform, width, height }` objects regardless of render
  // mode. The index builder must therefore index them with no
  // special-casing: a word concatenated from many per-word OCR items
  // is searchable the same way a visible-text phrase is.
  it("indexes OCR-style per-word items (one item per word) as a searchable phrase", () => {
    // Simulate the post-OCR invisible text layer: a long stream of
    // one-word items, exactly the shape pdf.js produces after OCR
    // injects `drawText` calls for every recognised word.
    const ocrItems = [
      "The", " ", "quick", " ", "brown", " ", "fox", " ", "jumps", " ",
      "over", " ", "the", " ", "lazy", " ", "dog", ".",
    ];
    const idx = buildPageIndex(ocrItems);
    const hits = findPageHits(idx, 1, "quick brown fox");
    expect(hits.length).toBe(1);
    const hit = hits[0];
    // Round-trip the hit boundaries to confirm they cover the
    // searched phrase exactly across the per-word items.
    const startItem = hit.start.item;
    const startOff = hit.start.offset;
    const endItem = hit.end.item;
    const endOff = hit.end.offset;
    const head = ocrItems[startItem].slice(startOff);
    const tail = ocrItems[endItem].slice(0, endOff);
    const middle = ocrItems.slice(startItem + 1, endItem).join("");
    expect((head + middle + tail).toLowerCase()).toBe("quick brown fox");
  });

  it("finds a word that spans across OCR items joined without spaces", () => {
    // OCR sometimes produces adjacent words with no whitespace
    // between them when tesseract's tokeniser is aggressive. The
    // index builder concatenates items with no separator, so the
    // resulting text is searchable without the user knowing about
    // the item boundaries.
    const ocrItems = ["S", "ir ", "Walter", " Raleigh"];
    const idx = buildPageIndex(ocrItems);
    const hits = findPageHits(idx, 3, "sir walter");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    // Round-trip the first hit back to its source text. start.offset
    // is local to start.item; end.offset is local to end.item. The
    // hit covers items [start.item..end.item] inclusive with
    // start.offset from start.item and end.offset+1 from end.item.
    const hit = hits[0];
    const head = ocrItems[hit.start.item].slice(hit.start.offset);
    const middle = ocrItems.slice(hit.start.item + 1, hit.end.item).join("");
    const tail = ocrItems[hit.end.item].slice(0, hit.end.offset);
    const flat = (head + middle + tail).toLowerCase();
    expect(flat).toBe("sir walter");
  });

  it("does not infinite-loop when the query is a substring of an OCR item", () => {
    // Regression guard for the user-reported "hangs indefinitely"
    // symptom. The current implementation uses `String.prototype.indexOf`
    // with a strictly advancing `from` cursor (from = at + needle.length),
    // so even pathological inputs (long OCR pages, repeated words, queries
    // that are themselves items) terminate. This test pins that behaviour:
    // a 200-item page with a 1-char query resolves in finite time and
    // returns the expected hit count.
    const items: string[] = [];
    for (let i = 0; i < 200; i += 1) {
      items.push(i % 7 === 0 ? "alpha" : "beta");
    }
    const idx = buildPageIndex(items);
    const hits = findPageHits(idx, 1, "a");
    // 29 alpha items (each contributing 2 'a' chars) + 171 beta items
    // (each contributing 1 'a' char) = 58 + 171 = 229 hits.
    expect(hits.length).toBe(229);
  });

  // DEF-050 — search index invalidation after OCR. The host
  // (App.tsx -> DocumentView) clears the cached `PageTextIndex` map
  // when OCR completes and re-runs the search effect, so the rebuild
  // path calls `pdf.js`'s `getTextContent()` afresh and produces an
  // index built from post-OCR text items. This test pins that
  // contract at the index-builder layer: a fresh `buildPageIndex`
  // over the post-OCR items must find OCR words that the original
  // (pre-OCR) index did not have.
  it("rebuild after invalidation finds OCR words that the stale index missed", () => {
    // Pre-OCR: scanned image, no text layer.
    const preOcrItems: string[] = [];
    const preOcrIndex = buildPageIndex(preOcrItems);
    const preOcrHits = findPageHits(preOcrIndex, 1, "Sir");
    expect(preOcrHits.length).toBe(0);

    // The host calls the imperative invalidator, which clears
    // `indexesRef` and bumps the search effect's tick so the loop
    // re-runs. On the re-run, `getTextContent()` returns the
    // post-OCR items (invisible Tr=3 text layer). The new index
    // is built from those items.
    const postOcrItems = [
      "Sir",
      " ",
      "Walter",
      " ",
      "Raleigh",
      " ",
      "was",
      " ",
      "beheaded",
      ".",
    ];
    const postOcrIndex = buildPageIndex(postOcrItems);
    const postOcrHits = findPageHits(postOcrIndex, 1, "Sir");
    expect(postOcrHits.length).toBe(1);
    // And a longer phrase that spans multiple OCR items.
    const phraseHits = findPageHits(postOcrIndex, 1, "Walter Raleigh");
    expect(phraseHits.length).toBe(1);
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