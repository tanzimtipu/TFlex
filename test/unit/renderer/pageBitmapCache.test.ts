// @vitest-environment jsdom
//
// Phase 128 (TFL-1571) — page bitmap cache unit coverage.
//
// The cache is a pure module-level helper; these tests pin the key
// identity (each axis must be a separate slot), hit/miss behavior,
// set/get round-trip, LRU prune order, clearTab, and the
// `createImageBitmap` handoff the PageView integration relies on.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PAGE_BITMAP_CACHE_LIMIT,
  clearTabCache,
  getCachedBitmap,
  invalidateProxyCache,
  pruneTabCache,
  setCachedBitmap,
} from "../../../src/renderer/pdf/pageBitmapCache";

function makeBitmap(tag: string): ImageBitmap {
  return {
    tag,
    width: 100,
    height: 200,
    close: vi.fn(),
  } as unknown as ImageBitmap;
}

describe("pageBitmapCache", () => {
  beforeEach(() => {
    // Deterministic LRU ordering without real wall-clock resolution.
    vi.spyOn(Date, "now").mockReturnValue(1000);
  });

  afterEach(() => {
    clearTabCache("tab-a");
    clearTabCache("tab-b");
    vi.restoreAllMocks();
  });

  it("generates a distinct key for every cache axis", () => {
    const bitmap = makeBitmap("a");
    setCachedBitmap("tab-a", 1, 1, 0, bitmap);

    // Exact same tuple is a hit.
    expect(getCachedBitmap("tab-a", 1, 1, 0)).toBe(bitmap);
    // Each axis mutation must miss.
    expect(getCachedBitmap("tab-a", 2, 1, 0)).toBeNull();
    expect(getCachedBitmap("tab-a", 1, 2, 0)).toBeNull();
    expect(getCachedBitmap("tab-a", 1, 1, 1)).toBeNull();
    expect(getCachedBitmap("tab-b", 1, 1, 0)).toBeNull();
  });

  it("reports a hit after a set and a miss before any set", () => {
    expect(getCachedBitmap("tab-a", 5, 1.25, 2)).toBeNull();
    const bitmap = makeBitmap("b");
    setCachedBitmap("tab-a", 5, 1.25, 2, bitmap);
    expect(getCachedBitmap("tab-a", 5, 1.25, 2)).toBe(bitmap);
  });

  it("round-trips the exact bitmap instance through set/get", () => {
    const bitmap = makeBitmap("c");
    setCachedBitmap("tab-a", 3, 1, 0, bitmap);
    const got = getCachedBitmap("tab-a", 3, 1, 0);
    expect(got).toBe(bitmap);
    expect(got?.width).toBe(100);
    expect(got?.height).toBe(200);
  });

  it("prunes the least-recently-used entries beyond the limit", () => {
    let clock = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);

    const bitmaps: ImageBitmap[] = [];
    for (let page = 1; page <= 3; page += 1) {
      const bitmap = makeBitmap(`p${page}`);
      bitmaps.push(bitmap);
      clock += 10;
      setCachedBitmap("tab-a", page, 1, 0, bitmap);
    }

    // Touch page 1 so page 2 becomes the least-recently-used.
    clock += 10;
    getCachedBitmap("tab-a", 1, 1, 0);

    // Cap at 2: the LRU entry (page 2) is evicted and closed.
    pruneTabCache("tab-a", 2);
    expect(getCachedBitmap("tab-a", 1, 1, 0)).toBe(bitmaps[0]);
    expect(getCachedBitmap("tab-a", 2, 1, 0)).toBeNull();
    expect(getCachedBitmap("tab-a", 3, 1, 0)).toBe(bitmaps[2]);
    expect(bitmaps[1].close).toHaveBeenCalledTimes(1);
  });

  it("defaults the prune limit to 24 entries", () => {
    expect(PAGE_BITMAP_CACHE_LIMIT).toBe(24);
    let clock = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    for (let page = 1; page <= 30; page += 1) {
      clock += 1;
      setCachedBitmap("tab-a", page, 1, 0, makeBitmap(`p${page}`));
    }
    pruneTabCache("tab-a");
    // Pages 1..6 (oldest) evicted; page 7 onward remain.
    expect(getCachedBitmap("tab-a", 6, 1, 0)).toBeNull();
    expect(getCachedBitmap("tab-a", 7, 1, 0)).not.toBeNull();
  });

  it("clearTabCache drops and closes every bitmap for the tab", () => {
    const bitmap = makeBitmap("d");
    setCachedBitmap("tab-a", 1, 1, 0, bitmap);
    setCachedBitmap("tab-b", 1, 1, 0, makeBitmap("e"));

    clearTabCache("tab-a");
    expect(getCachedBitmap("tab-a", 1, 1, 0)).toBeNull();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    // Sibling tab is untouched.
    expect(getCachedBitmap("tab-b", 1, 1, 0)).not.toBeNull();
  });

  it("invalidateProxyCache is an alias of clearTabCache", () => {
    const bitmap = makeBitmap("f");
    setCachedBitmap("tab-a", 1, 1, 0, bitmap);
    invalidateProxyCache("tab-a");
    expect(getCachedBitmap("tab-a", 1, 1, 0)).toBeNull();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("stores a bitmap produced by createImageBitmap", async () => {
    const fakeBitmap = makeBitmap("from-canvas");
    const createSpy = vi
      .fn()
      .mockResolvedValue(fakeBitmap) as unknown as typeof createImageBitmap;
    vi.stubGlobal("createImageBitmap", createSpy);

    const scratch = document.createElement("canvas");
    scratch.width = 64;
    scratch.height = 88;
    const bitmap = await createImageBitmap(scratch);
    setCachedBitmap("tab-a", 9, 1.5, 3, bitmap);

    expect(createSpy).toHaveBeenCalledWith(scratch);
    expect(getCachedBitmap("tab-a", 9, 1.5, 3)).toBe(fakeBitmap);
    vi.unstubAllGlobals();
  });
});
