// @vitest-environment jsdom
//
// DEF-209 (ADV-030) — a synthetic 5000-annotation PDF rendered zero
// pages. The annotation overlay and the annotations panel both render
// the full per-page list, so a page carrying thousands of annotations
// either froze the UI or died mid-open with no feedback.
//
// The fix: a hard renderer-side per-page annotation limit
// (`MAX_ANNOTATIONS_PER_PAGE`) and a pure counter helper
// (`firstPageOverAnnotationLimit`) that the open path uses to refuse
// the document with a clear toast instead of opening a broken tab.
// These tests pin the limit, the boundaries, and the helper's
// page-selection semantics.

import { describe, expect, it } from "vitest";
import {
  MAX_ANNOTATIONS_PER_PAGE,
  firstPageOverAnnotationLimit,
} from "../../../src/renderer/annotations/model";

const pageEntries = (page: number, count: number): { page: number }[] =>
  Array.from({ length: count }, () => ({ page }));

describe("DEF-209 — the per-page annotation limit", () => {
  it("is 1000 annotations per page", () => {
    expect(MAX_ANNOTATIONS_PER_PAGE).toBe(1000);
  });
});

describe("firstPageOverAnnotationLimit — boundary semantics", () => {
  it("returns null for an empty annotation list", () => {
    expect(firstPageOverAnnotationLimit([])).toBeNull();
  });

  it("returns null when a page holds exactly the limit (at-limit is allowed)", () => {
    expect(firstPageOverAnnotationLimit(pageEntries(2, MAX_ANNOTATIONS_PER_PAGE))).toBeNull();
  });

  it("returns the page number when a page holds limit + 1", () => {
    expect(firstPageOverAnnotationLimit(pageEntries(2, MAX_ANNOTATIONS_PER_PAGE + 1))).toBe(2);
  });

  it("returns null when annotations are spread across pages under the limit", () => {
    // 5000 annotations over 5 pages, 1000 each — the per-page mirror
    // is fine; the document is accepted.
    const anns = [
      ...pageEntries(1, 1000),
      ...pageEntries(2, 1000),
      ...pageEntries(3, 1000),
      ...pageEntries(4, 1000),
      ...pageEntries(5, 1000),
    ];
    expect(firstPageOverAnnotationLimit(anns)).toBeNull();
  });

  it("flags the FIRST page over the limit, not the first page with annotations", () => {
    // Page 1 is at the limit (allowed); page 3 crosses it. The helper
    // must report page 3 — the open-path toast names that page.
    const anns = [
      ...pageEntries(1, 1000),
      ...pageEntries(2, 3),
      ...pageEntries(3, 1001),
    ];
    expect(firstPageOverAnnotationLimit(anns)).toBe(3);
  });

  it("returns null when every page is just under the limit", () => {
    const anns = [
      ...pageEntries(1, 999),
      ...pageEntries(2, 999),
      ...pageEntries(3, 999),
    ];
    expect(firstPageOverAnnotationLimit(anns)).toBeNull();
  });

  it("accepts the raw wire shape (anything with a `page` field)", () => {
    // The open path runs the check on the normalized engine state, but
    // the helper deliberately takes any `{ page }` list so the same
    // guard can be reused on wire payloads without conversion.
    const wireLike = Array.from({ length: 1001 }, (_, i) => ({ page: 7, extra: i }));
    expect(firstPageOverAnnotationLimit(wireLike)).toBe(7);
  });

  it("is a linear scan (5000 annotations checked without blowing up)", () => {
    // The ADV-030 adversarial volume — 5000 annotations — but spread
    // at exactly the per-page limit so the document itself is legal.
    const anns = [
      ...pageEntries(1, 1000),
      ...pageEntries(2, 1000),
      ...pageEntries(3, 1000),
      ...pageEntries(4, 1000),
      ...pageEntries(5, 1000),
    ];
    expect(firstPageOverAnnotationLimit(anns)).toBeNull();
  });
});
