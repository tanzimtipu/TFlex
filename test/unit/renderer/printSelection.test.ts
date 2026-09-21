import { describe, expect, it } from "vitest";
import {
  applyOddEvenAndReverse,
  parsePageRanges,
  resolveSelectedPages,
} from "../../../src/renderer/pdf/printSelection";

/**
 * Phase 30 — print page selection. Pins the industry range syntax, the
 * scope resolution and the odd/even + reverse ordering: malformed,
 * reversed, out-of-range and empty entries are rejected with a message,
 * never silently dropped.
 */

describe("printSelection — parsePageRanges", () => {
  it("expands the industry syntax 1-5, 8, 11-13", () => {
    const result = parsePageRanges("1-5, 8, 11-13", 20);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pages).toEqual([1, 2, 3, 4, 5, 8, 11, 12, 13]);
  });

  it("sorts and de-duplicates overlapping entries", () => {
    const result = parsePageRanges("3, 1, 2-3", 5);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pages).toEqual([1, 2, 3]);
  });

  it("tolerates whitespace around commas and dashes", () => {
    const result = parsePageRanges(" 1 - 3 , 5 ", 5);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pages).toEqual([1, 2, 3, 5]);
  });

  it("rejects an empty string", () => {
    const result = parsePageRanges("   ", 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Enter a page range/);
  });

  it("rejects an empty entry caused by a trailing comma", () => {
    const result = parsePageRanges("1-5,", 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Empty entry/);
  });

  it("rejects a non-numeric token", () => {
    const result = parsePageRanges("abc", 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not a valid page or range/);
  });

  it("rejects a reversed range", () => {
    const result = parsePageRanges("5-2", 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/reversed/);
  });

  it("rejects a page below range", () => {
    const result = parsePageRanges("0", 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/out of range/);
  });

  it("rejects a page above range (single and range endpoint)", () => {
    expect(parsePageRanges("11", 10).ok).toBe(false);
    const range = parsePageRanges("8-12", 10);
    expect(range.ok).toBe(false);
    if (!range.ok) expect(range.error).toMatch(/12 is out of range/);
  });

  it("rejects a half-open range", () => {
    expect(parsePageRanges("1-", 10).ok).toBe(false);
  });

  it("rejects an overflowing digit token with the generic message (DEF-273)", () => {
    // 50 000 nines overflow parseInt to Infinity. The message must not
    // leak the overflow value.
    const huge = "9".repeat(50_000);
    const result = parsePageRanges(huge, 34);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not a valid page or range/);
      expect(result.error).not.toContain("Infinity");
    }
  });

  it("still names the real number for a normal out-of-range page (DEF-273)", () => {
    const result = parsePageRanges("999", 34);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("999");
      expect(result.error).toMatch(/out of range \(1-34\)/);
    }
  });
});

describe("printSelection — applyOddEvenAndReverse", () => {
  const base = [1, 2, 3, 4, 5, 6];

  it("filters odd pages then reverses", () => {
    expect(applyOddEvenAndReverse(base, "odd", true)).toEqual([5, 3, 1]);
  });

  it("filters even pages then reverses", () => {
    expect(applyOddEvenAndReverse(base, "even", true)).toEqual([6, 4, 2]);
  });

  it("reverses the full list when odd/even is all", () => {
    expect(applyOddEvenAndReverse(base, "all", true)).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it("returns a fresh array (does not mutate input)", () => {
    const input = [1, 2, 3];
    const out = applyOddEvenAndReverse(input, "all", true);
    expect(input).toEqual([1, 2, 3]);
    expect(out).not.toBe(input);
  });
});

describe("printSelection — resolveSelectedPages", () => {
  const base = { oddEven: "all" as const, reverse: false };

  it("resolves the all-pages scope", () => {
    const result = resolveSelectedPages({
      ...base,
      scope: "all",
      totalPages: 4,
      currentPage: 2,
      customInput: "",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pages).toEqual([1, 2, 3, 4]);
  });

  it("resolves the current-page scope", () => {
    const result = resolveSelectedPages({
      ...base,
      scope: "current",
      totalPages: 4,
      currentPage: 3,
      customInput: "",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pages).toEqual([3]);
  });

  it("rejects an out-of-range current page", () => {
    const result = resolveSelectedPages({
      ...base,
      scope: "current",
      totalPages: 4,
      currentPage: 9,
      customInput: "",
    });
    expect(result.ok).toBe(false);
  });

  it("resolves the custom scope through the parser", () => {
    const result = resolveSelectedPages({
      ...base,
      scope: "custom",
      totalPages: 20,
      currentPage: 1,
      customInput: "2, 4-5",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pages).toEqual([2, 4, 5]);
  });

  it("propagates a custom-range parse error", () => {
    const result = resolveSelectedPages({
      ...base,
      scope: "custom",
      totalPages: 20,
      currentPage: 1,
      customInput: "9-3",
    });
    expect(result.ok).toBe(false);
  });

  it("applies odd/even and reverse across the scope", () => {
    const result = resolveSelectedPages({
      ...base,
      scope: "all",
      totalPages: 6,
      currentPage: 1,
      customInput: "",
      oddEven: "even",
      reverse: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pages).toEqual([6, 4, 2]);
  });

  it("rejects a scope that filters down to zero pages", () => {
    const result = resolveSelectedPages({
      ...base,
      scope: "custom",
      totalPages: 1,
      currentPage: 1,
      customInput: "1",
      oddEven: "even",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/No even pages/);
  });

  it("rejects a document with no pages", () => {
    const result = resolveSelectedPages({
      ...base,
      scope: "all",
      totalPages: 0,
      currentPage: 1,
      customInput: "",
    });
    expect(result.ok).toBe(false);
  });
});