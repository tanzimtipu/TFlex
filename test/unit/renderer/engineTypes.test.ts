// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  defaultPageRange,
  describeEngineError,
  parsePageRange,
} from "../../../src/renderer/engine/types";
import type { EngineError } from "../../../src/shared/types";

describe("parsePageRange", () => {
  it("parses a single page", () => {
    expect(parsePageRange("3", 10)).toEqual([3]);
  });

  it("parses a contiguous range", () => {
    expect(parsePageRange("10-20", 25)).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);
  });

  it("parses comma-separated pages and ranges, deduping", () => {
    expect(parsePageRange("1,3,5-7,5", 20)).toEqual([1, 3, 5, 6, 7]);
  });

  it("returns a sorted array", () => {
    expect(parsePageRange("7-10,2,5", 20)).toEqual([2, 5, 7, 8, 9, 10]);
  });

  it("accepts whitespace around tokens", () => {
    expect(parsePageRange(" 10 - 12 , 14 ", 20)).toEqual([10, 11, 12, 14]);
  });

  it("out-of-bounds page returns null", () => {
    expect(parsePageRange("11", 10)).toBeNull();
    expect(parsePageRange("1-11", 10)).toBeNull();
    expect(parsePageRange("0", 10)).toBeNull();
    expect(parsePageRange("-1", 10)).toBeNull();
  });

  it("rejects descending ranges", () => {
    expect(parsePageRange("20-10", 25)).toBeNull();
  });

  it("rejects empty / whitespace input", () => {
    expect(parsePageRange("", 10)).toBeNull();
    expect(parsePageRange("   ", 10)).toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(parsePageRange("1,,2", 10)).toBeNull();
    expect(parsePageRange("abc", 10)).toBeNull();
    expect(parsePageRange("1-2-3", 10)).toBeNull();
    expect(parsePageRange("-", 10)).toBeNull();
  });

  it("returns null when totalPages is zero or negative", () => {
    expect(parsePageRange("1", 0)).toBeNull();
    expect(parsePageRange("1", -5)).toBeNull();
  });

  it("returns null for non-finite parsed numbers", () => {
    expect(parsePageRange("Infinity", 10)).toBeNull();
    expect(parsePageRange("NaN", 10)).toBeNull();
  });

  it("page 1-N boundary works", () => {
    expect(parsePageRange("1-1", 1)).toEqual([1]);
    expect(parsePageRange("1-2", 2)).toEqual([1, 2]);
  });
});

describe("defaultPageRange", () => {
  it("returns 1-N for positive total", () => {
    expect(defaultPageRange(0)).toBe("");
    expect(defaultPageRange(1)).toBe("1-1");
    expect(defaultPageRange(34)).toBe("1-34");
    expect(defaultPageRange(520)).toBe("1-520");
  });
});

describe("describeEngineError", () => {
  it("covers every error code with a non-empty message", () => {
    const codes: EngineError[] = [
      "engine-error",
      "nothing-to-undo",
      "nothing-to-redo",
      "cancelled",
      "open-error",
      "out-of-range",
      "empty-range",
      "no-op",
    ];
    for (const code of codes) {
      const text = describeEngineError(code);
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it("interpolates the context when provided", () => {
    const text = describeEngineError("engine-error", "report.pdf");
    expect(text).toContain("report.pdf");
  });
});