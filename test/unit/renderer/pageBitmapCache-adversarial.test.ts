// @vitest-environment jsdom
//
// Phase 128 (TFL-1571) — adversarial probes for bitmap cache race conditions.
// These tests probe use-after-close, stale bitmap, and race conditions.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTabCache,
  getCachedBitmap,
  pruneTabCache,
  setCachedBitmap,
} from "../../../src/renderer/pdf/pageBitmapCache";

function makeBitmap(tag: string, closed = false): ImageBitmap {
  const bitmap = {
    tag,
    width: 100,
    height: 200,
    closed,
    close: vi.fn(function (this: any) {
      this.closed = true;
    }),
  } as unknown as ImageBitmap & { closed: boolean };
  return bitmap;
}

describe("pageBitmapCache — adversarial probes", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
  });

  afterEach(() => {
    clearTabCache("tab-a");
    clearTabCache("tab-b");
    vi.restoreAllMocks();
  });

  it("ADV-001: use-after-close — bitmap can be drawn after close() is called", () => {
    // Scenario: clearTabCache closes bitmaps while PageView still holds a reference.
    const bitmap = makeBitmap("page1");
    setCachedBitmap("tab-a", 1, 1, 0, bitmap);

    // Simulate clearTabCache being called (tab close) while render still has the bitmap.
    clearTabCache("tab-a");

    // The bitmap reference still exists in PageView's closure.
    // After close(), the bitmap is unusable — drawImage would throw.
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    expect((bitmap as any).closed).toBe(true);

    // Finding: If PageView tries to drawImage(this bitmap) after clearTabCache,
    // it will throw "ImageBitmap is closed" or similar. The cache does NOT
    // track in-flight renders or defer closure.
    console.log("ADV-001: Bitmap closed while reference still held — drawImage would throw");
  });

  it("ADV-002: race — eager pre-render and real render can collide", async () => {
    // Scenario: Both the eager IIFE (App.tsx:2506) and the real render
    // call setCachedBitmap for the same key concurrently.
    const bitmap1 = makeBitmap("eager");
    const bitmap2 = makeBitmap("real");

    // Simulate eager pre-render storing first.
    setCachedBitmap("tab-a", 1, 1, 0, bitmap1);

    // Real render completes and stores, replacing the eager bitmap.
    setCachedBitmap("tab-a", 1, 1, 0, bitmap2);

    // The eager bitmap is closed (setCachedBitmap calls disposeEntry).
    expect(bitmap1.close).toHaveBeenCalledTimes(1);
    expect(bitmap2.close).toHaveBeenCalledTimes(0);

    // Finding: If the eager bitmap was already being drawn, closing it mid-draw
    // could cause issues. However, the current implementation safely replaces.
    console.log("ADV-002: Eager bitmap safely replaced by real render");
  });

  it("ADV-003: stale bitmap after invalidateProxyCache — cache is cleared before read", () => {
    // Scenario: Document edit triggers invalidateProxyCache.
    const bitmap = makeBitmap("pre-edit");
    setCachedBitmap("tab-a", 1, 1, 0, bitmap);

    // Edit triggers invalidateProxyCache (alias of clearTabCache).
    clearTabCache("tab-a");

    // Any subsequent getCachedBitmap returns null — forces re-render.
    expect(getCachedBitmap("tab-a", 1, 1, 0)).toBeNull();

    // Finding: The invalidate runs BEFORE the new doc.getPage render, so
    // stale bitmaps are never returned. This is SAFE by design.
    console.log("ADV-003: Stale bitmap correctly invalidated");
  });

  it("ADV-004: float drift in cssScale key — 1.5 vs 1.5000000001", () => {
    // Scenario: cssScale computed at store time differs slightly from lookup time.
    const bitmap = makeBitmap("scale-1.5");
    const storedScale = 1.5;
    const lookupScale = 1.5000000001; // Float drift from repeated multiplication.

    setCachedBitmap("tab-a", 1, storedScale, 0, bitmap);

    // Lookup with drifted scale — cache MISS.
    const got = getCachedBitmap("tab-a", 1, lookupScale, 0);
    expect(got).toBeNull();

    // Finding: Float comparison in cache key is exact (string interpolation).
    // Any drift causes a miss, which is SAFE (re-renders correctly) but
    // defeats the cache optimization. Not a correctness bug, just inefficiency.
    console.log("ADV-004: Float drift causes cache miss (safe but inefficient)");
  });

  it("ADV-005: eviction closes bitmap that may still be referenced", () => {
    // Scenario: pruneTabCache evicts oldest entry while PageView still renders it.
    const bitmap1 = makeBitmap("page1");
    const bitmap2 = makeBitmap("page2");
    const bitmap3 = makeBitmap("page3");

    // Set up cache with 3 entries at different timestamps.
    vi.spyOn(Date, "now").mockReturnValue(1000);
    setCachedBitmap("tab-a", 1, 1, 0, bitmap1);
    vi.spyOn(Date, "now").mockReturnValue(2000);
    setCachedBitmap("tab-a", 2, 1, 0, bitmap2);
    vi.spyOn(Date, "now").mockReturnValue(3000);
    setCachedBitmap("tab-a", 3, 1, 0, bitmap3);

    // Prune to 2 entries — evicts page1 (oldest).
    pruneTabCache("tab-a", 2);

    expect(bitmap1.close).toHaveBeenCalledTimes(1);
    expect(getCachedBitmap("tab-a", 1, 1, 0)).toBeNull();

    // Finding: If PageView was mid-render of page1 when eviction happened,
    // the bitmap would be closed prematurely. The prune is synchronous and
    // called AFTER render completes (PageView:852), so this is SAFE.
    console.log("ADV-005: Eviction closes oldest bitmap — safe if prune runs after render");
  });

  it("ADV-006: rapid churn — 30 pages in one tab, verify eviction", () => {
    // Scenario: User scrolls through 30 pages rapidly.
    const bitmaps: ImageBitmap[] = [];
    for (let i = 1; i <= 30; i++) {
      bitmaps.push(makeBitmap(`page${i}`));
      vi.spyOn(Date, "now").mockReturnValue(1000 + i);
      setCachedBitmap("tab-a", i, 1, 0, bitmaps[i - 1]);
    }

    // Cache should have 30 entries before prune.
    // After prune (default limit 24), oldest 6 are evicted.
    pruneTabCache("tab-a");

    // Pages 1-6 evicted, pages 7-30 remain.
    expect(getCachedBitmap("tab-a", 1, 1, 0)).toBeNull();
    expect(getCachedBitmap("tab-a", 6, 1, 0)).toBeNull();
    expect(getCachedBitmap("tab-a", 7, 1, 0)).toBe(bitmaps[6]);
    expect(getCachedBitmap("tab-a", 30, 1, 0)).toBe(bitmaps[29]);

    // Count closed bitmaps.
    const closedCount = bitmaps.filter((b) => (b as any).closed).length;
    expect(closedCount).toBe(6);

    console.log("ADV-006: Rapid churn — 6 bitmaps closed, 24 retained");
  });

  it("ADV-007: multiple tabs isolated — close tab-a does not affect tab-b", () => {
    const bitmapA = makeBitmap("tab-a-page1");
    const bitmapB = makeBitmap("tab-b-page1");

    setCachedBitmap("tab-a", 1, 1, 0, bitmapA);
    setCachedBitmap("tab-b", 1, 1, 0, bitmapB);

    clearTabCache("tab-a");

    expect(bitmapA.close).toHaveBeenCalledTimes(1);
    expect(bitmapB.close).toHaveBeenCalledTimes(0);
    expect(getCachedBitmap("tab-a", 1, 1, 0)).toBeNull();
    expect(getCachedBitmap("tab-b", 1, 1, 0)).toBe(bitmapB);

    console.log("ADV-007: Tab isolation correct — closing one tab does not affect others");
  });
});
