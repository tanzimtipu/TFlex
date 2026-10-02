// Phase 82 — the renderer-side spell dictionary loader.
//
// The dictionary bytes are produced by the main process (offline, bundled)
// and handed over the frozen `window.tflex.loadDictionary` IPC contract. This
// module owns the ONE module-level cache so both the Inspector text field and
// the on-canvas run editor share a single load: the promise is memoised, so a
// second caller never re-invokes the IPC, and the promise NEVER rejects — a
// failed load resolves to `{ dictionary: null, error }` so the UI can render
// an honest "unavailable" state instead of an unhandled rejection.

import { buildSpellDictionary } from "../../shared/spell";
import type { DictionaryLoadError } from "../../shared/ipc";
import type { SpellCheckLanguage } from "../../shared/types";

export interface SpellDictionaryResult {
  /** The compiled lookup set, or null when the load failed. */
  dictionary: Set<string> | null;
  /** The IPC error code, or null on success. */
  error: DictionaryLoadError | null;
}

let cached: Promise<SpellDictionaryResult> | null = null;

/**
 * Load (once) and compile the bundled dictionary for `language` (default
 * `en-US`). Subsequent calls return the cached promise/result. Never rejects.
 */
export function loadSpellDictionary(
  language?: SpellCheckLanguage,
): Promise<SpellDictionaryResult> {
  if (cached !== null) return cached;
  const lang: SpellCheckLanguage = language ?? "en-US";
  cached = (async (): Promise<SpellDictionaryResult> => {
    try {
      const result = await window.tflex.loadDictionary(lang);
      if (result.ok) {
        return { dictionary: buildSpellDictionary(result.value.words), error: null };
      }
      return { dictionary: null, error: result.error.code };
    } catch {
      // A missing bridge (jsdom / older builds) or a thrown IPC must not
      // surface as an unhandled rejection: report a read failure instead.
      return { dictionary: null, error: "read-failed" };
    }
  })();
  return cached;
}

/** Test-only — drop the module-level cache so the next call reloads. */
export function resetSpellDictionaryCache(): void {
  cached = null;
}