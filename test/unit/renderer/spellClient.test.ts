// @vitest-environment jsdom
//
// Phase 82 — the renderer dictionary loader. The IPC bridge is stubbed; the
// tests pin the cache (one IPC call per module lifetime), the ok -> Set
// compilation, and the never-rejects error path.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadSpellDictionary,
  resetSpellDictionaryCache,
} from "../../../src/renderer/spell/spellClient";

type Loader = (language: string) => Promise<unknown>;

function setBridge(loadDictionary: Loader): void {
  (window as unknown as { tflex: { loadDictionary: Loader } }).tflex = { loadDictionary };
}

describe("spellClient", () => {
  beforeEach(() => {
    resetSpellDictionaryCache();
  });

  afterEach(() => {
    resetSpellDictionaryCache();
    delete (window as unknown as { tflex?: unknown }).tflex;
  });

  it("compiles the ok payload into a Set and caches it", async () => {
    const loadDictionary = vi.fn(async () => ({
      ok: true as const,
      value: { language: "en-US", words: "the\n# a comment\nworld\n" },
    }));
    setBridge(loadDictionary);

    const first = await loadSpellDictionary();
    expect(first.error).toBeNull();
    expect(first.dictionary).toBeInstanceOf(Set);
    expect(first.dictionary?.has("the")).toBe(true);
    expect(first.dictionary?.has("world")).toBe(true);
    expect(first.dictionary?.has("# a comment")).toBe(false);

    const second = await loadSpellDictionary();
    expect(second.dictionary).toBe(first.dictionary);
    expect(loadDictionary).toHaveBeenCalledTimes(1);
  });

  it("returns the error code on the error path and never rejects", async () => {
    setBridge(
      vi.fn(async () => ({
        ok: false as const,
        error: { code: "not-found", message: "missing" },
      })),
    );
    await expect(loadSpellDictionary()).resolves.toEqual({
      dictionary: null,
      error: "not-found",
    });
  });

  it("reports read-failed when the bridge is absent and never rejects", async () => {
    delete (window as unknown as { tflex?: unknown }).tflex;
    await expect(loadSpellDictionary()).resolves.toEqual({
      dictionary: null,
      error: "read-failed",
    });
  });
});