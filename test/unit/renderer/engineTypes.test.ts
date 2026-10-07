// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  classifyPageRange,
  defaultInsertPosition,
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

describe("classifyPageRange — out-of-bounds names the token (AR-07)", () => {
  it("names the offending token AND the 1-34 bound", () => {
    expect(classifyPageRange("999", 34).message).toBe(
      "Page 999 is outside the document's 1-34 pages.",
    );
    expect(classifyPageRange("0", 34).message).toBe(
      "Page 0 is outside the document's 1-34 pages.",
    );
    expect(classifyPageRange("1-999", 34).message).toBe(
      "Page 999 is outside the document's 1-34 pages.",
    );
    expect(classifyPageRange("1-3,999", 34).message).toBe(
      "Page 999 is outside the document's 1-34 pages.",
    );
  });

  it("keeps state out-of-bounds and pages null so the disabled gating is unchanged", () => {
    const check = classifyPageRange("999", 34);
    expect(check.state).toBe("out-of-bounds");
    expect(check.pages).toBeNull();
    expect(check.invalidTokens).toEqual([999]);
  });

  it("names several invalid tokens in input order", () => {
    expect(classifyPageRange("999,0", 34).message).toBe(
      "Pages 999, 0 are outside the document's 1-34 pages.",
    );
  });

  it("leaves the empty and malformed wording untouched", () => {
    expect(classifyPageRange("", 34).message).toBe("Enter at least one page (e.g. 1-3).");
    expect(classifyPageRange("abc", 34).message).toBe("Enter pages like 1-3 or 2,4.");
  });
});

describe("DEF-629 — trailing garbage is a syntax error (AR-07)", () => {
  const malformedTokens = ["1abc", "2-3x", "1.9", "12px"];

  for (const token of malformedTokens) {
    it(`"${token}" classifies as malformed with pages null on 34 pages`, () => {
      const check = classifyPageRange(token, 34);
      expect(check.state).toBe("malformed");
      expect(check.pages).toBeNull();
      expect(check.message).toBe("Enter pages like 1-3 or 2,4.");
    });
  }

  it("keeps strict valid inputs valid (leading zeros stay acceptable)", () => {
    expect(classifyPageRange("10-20", 34).state).toBe("valid");
    expect(classifyPageRange("1,3,5-7", 34).state).toBe("valid");
    expect(classifyPageRange(" 10 - 12 ", 34).state).toBe("valid");
    expect(classifyPageRange("007", 34)).toMatchObject({
      state: "valid",
      pages: [7],
    });
  });
});

describe("DEF-630 — a wholly-above-range span names every endpoint (AR-07)", () => {
  it("names both ends of 50-60 on 34 pages", () => {
    const check = classifyPageRange("50-60", 34);
    expect(check.state).toBe("out-of-bounds");
    expect(check.pages).toBeNull();
    expect(check.invalidTokens).toEqual([50, 60]);
    expect(check.message).toBe(
      "Pages 50, 60 are outside the document's 1-34 pages.",
    );
  });

  it("names both ends of 35-40 on 34 pages", () => {
    const check = classifyPageRange("35-40", 34);
    expect(check.invalidTokens).toEqual([35, 40]);
    expect(check.message).toBe(
      "Pages 35, 40 are outside the document's 1-34 pages.",
    );
  });

  it("still names only the offending end when the other end is in bounds", () => {
    expect(classifyPageRange("1-999", 34).invalidTokens).toEqual([999]);
    expect(classifyPageRange("0-5", 34).invalidTokens).toEqual([0]);
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

describe("defaultInsertPosition", () => {
  // Phase 9 InsertPagesDialog re-seeds its position field from this
  // helper. Empty docs return "1" so the user can land the new
  // insert at the beginning; non-empty docs return N+1 so the
  // natural action is "append".
  it("returns 1 for empty docs", () => {
    expect(defaultInsertPosition(0)).toBe("1");
  });
  it("returns N+1 for non-empty docs (append-at-end default)", () => {
    expect(defaultInsertPosition(1)).toBe("2");
    expect(defaultInsertPosition(4)).toBe("5");
    expect(defaultInsertPosition(34)).toBe("35");
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
      "same-document",
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

  it("describes the Phase 32 same-document error", () => {
    const text = describeEngineError("same-document");
    expect(text).toBe("Source and target must be different documents.");
  });
});