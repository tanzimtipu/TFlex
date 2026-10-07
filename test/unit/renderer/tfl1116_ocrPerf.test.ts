// TFL-1116 C12 (R19) — pure profile of the OCR suspects grouping + bounded
// windowing. No DOM, no React: it measures the SAME functions the shipped
// panel uses (`ocrSuspectsModel.ts`), so a performance claim is tied to the
// real code path. A claim without a number is forbidden by the brief, so every
// run logs the measured milliseconds it asserts on.
import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import type { OcrSuspect } from "../../../src/shared/types";
import {
  WINDOW_OVERSCAN,
  computeWindowRange,
  flattenSuspectItems,
  groupByPage,
  windowMountCount,
} from "../../../src/renderer/components/ocrSuspectsModel";

/** A dense noisy-scan fixture: `pages` pages, each carrying the words that land
 *  on it, all low-confidence. */
function makeFixture(total: number, pages: number): OcrSuspect[] {
  const perPage = Math.ceil(total / pages);
  const list: OcrSuspect[] = [];
  for (let i = 0; i < total; i += 1) {
    list.push({
      word: `w${i}`,
      page: 1 + Math.floor(i / perPage),
      confidence: 20 + (i % 40),
      rect: { x: (i % 500), y: (i % 700), width: 24, height: 9 },
    });
  }
  return list;
}

interface Profile {
  total: number;
  pages: number;
  groupMs: number;
  flattenMs: number;
  windowMs: number;
  items: number;
  mounted: number;
}

function profile(total: number, pages: number, viewportH: number): Profile {
  const fixture = makeFixture(total, pages);
  const g0 = performance.now();
  const grouped = groupByPage(fixture);
  const g1 = performance.now();
  const items = flattenSuspectItems(grouped);
  const g2 = performance.now();
  const range = computeWindowRange(0, viewportH, items.length);
  const g3 = performance.now();
  return {
    total,
    pages: grouped.length,
    groupMs: g1 - g0,
    flattenMs: g2 - g1,
    windowMs: g3 - g2,
    items: items.length,
    mounted: range.end - range.start,
  };
}

const VIEWPORT_H = 360;

describe("TFL-1116 R19 — OCR suspects profile (grouping + windowing)", () => {
  it("profiles 3708 entries and bounds the mount count", () => {
    const p = profile(3708, 6, VIEWPORT_H);
    console.log(
      `[tfl1116 perf] n=3708 pages=${p.pages} group=${p.groupMs.toFixed(2)}ms ` +
        `flatten=${p.flattenMs.toFixed(2)}ms window=${p.windowMs.toFixed(3)}ms ` +
        `items=${p.items} mounted=${p.mounted}`,
    );
    expect(p.pages).toBe(6);
    expect(p.items).toBe(3708 + 6);
    expect(p.mounted).toBeGreaterThan(0);
    expect(p.mounted).toBeLessThan(60);
    // Bounded regardless of total: well under the 3708 rows.
    expect(p.mounted).toBeLessThan(p.items);
    expect(p.groupMs).toBeLessThan(200);
    expect(p.flattenMs).toBeLessThan(200);
  });

  it("profiles 10000 entries and keeps the SAME bounded mount count", () => {
    const p = profile(10000, 20, VIEWPORT_H);
    console.log(
      `[tfl1116 perf] n=10000 pages=${p.pages} group=${p.groupMs.toFixed(2)}ms ` +
        `flatten=${p.flattenMs.toFixed(2)}ms window=${p.windowMs.toFixed(3)}ms ` +
        `items=${p.items} mounted=${p.mounted}`,
    );
    expect(p.pages).toBe(20);
    expect(p.items).toBe(10000 + 20);
    expect(p.mounted).toBeGreaterThan(0);
    expect(p.mounted).toBeLessThan(60);
    expect(p.groupMs).toBeLessThan(200);
    expect(p.flattenMs).toBeLessThan(200);
  });

  it("the mount count is independent of the list length", () => {
    const short = windowMountCount(3708, VIEWPORT_H);
    const long = windowMountCount(10000, VIEWPORT_H);
    expect(long).toBe(short);
    const { start, end } = computeWindowRange(0, VIEWPORT_H, 10000);
    expect(start).toBe(0);
    // The bound is the visible slice + overscan, never the total.
    const visible = Math.ceil(VIEWPORT_H / 30) + 1;
    expect(end).toBeLessThanOrEqual(visible + WINDOW_OVERSCAN);
  });

  it("stays bounded while scrolling deep into the list", () => {
    const items = 10000 + 20;
    const { start, end } = computeWindowRange(30 * 9000, VIEWPORT_H, items);
    expect(end - start).toBeLessThan(60);
    expect(start).toBeGreaterThan(8000);
  });
});
