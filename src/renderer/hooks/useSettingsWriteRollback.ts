// Phase 114 (TFL-1239, chunk C) — settings write-failure rollback.
//
// DEF-230 rolls the backend's in-memory settings back to the last persisted
// value when a write fails, then pushes `settings:writeError`. The renderer
// already surfaces that as an error toast; this hook adds the missing half:
// re-read the authoritative settings and hand them back so the UI can drop the
// optimistic value it showed. `onError` reports the failure (the toast), then
// `loadSettings()` resolves the rolled-back settings and `onRestore` applies
// them.
//
// ADV-247 — the re-read itself can fail (io / corrupt read). Previously that
// left the never-persisted value on screen with only the toast. When
// `loadSettings()` resolves `ok:false` or rejects, fall back to the last value
// the app actually confirmed (`getLastConfirmed`) so the UI still drops the
// optimistic value. The error toast still fires either way.

import { useEffect } from "react";
import type { AppSettings } from "../../shared/types";

export interface SettingsWriteRollbackOptions {
  /** Apply the settings re-read after a failed write (the rolled-back value). */
  onRestore: (settings: AppSettings) => void;
  /** Report the write failure (message text from the backend). */
  onError: (message: string) => void;
  /** ADV-247 — the last settings value the app confirmed (boot / applied
   *  echo), used as the restore fallback when the authoritative re-read
   *  fails. `null` before anything is confirmed; nothing is restored then. */
  getLastConfirmed: () => AppSettings | null;
}

/** ADV-246 — bookkeeping for a write-failure restore. The disk snapshot becomes
 *  the last-persisted value AND the local-write sequence resets to 0, so the
 *  DEF-037 echo filter treats disk as the source of truth again: a newer
 *  legitimate `settings.changed` echo (a write issued before the failure that
 *  still reached disk) is applied instead of being discarded against the stale
 *  restore snapshot. Restore-only — never used on the normal echo path. */
export function noteSettingsRestore(
  seqRef: { current: number },
  persistedRef: { current: AppSettings | null },
  restored: AppSettings,
): void {
  persistedRef.current = restored;
  seqRef.current = 0;
}

export function useSettingsWriteRollback(opts: SettingsWriteRollbackOptions): void {
  const { onRestore, onError, getLastConfirmed } = opts;
  useEffect(() => {
    const settingsApi = window.tflex?.settings;
    if (settingsApi === undefined || typeof settingsApi.writeError !== "function") {
      return undefined;
    }
    // ADV-247 — the re-read failed; drop to the last confirmed value instead of
    // leaving the unpersisted one on screen. `null` means nothing confirmed yet.
    const restoreFallback = (): void => {
      const lastConfirmed = getLastConfirmed();
      if (lastConfirmed !== null) onRestore(lastConfirmed);
    };
    return settingsApi.writeError((message): void => {
      onError(message);
      void window.tflex
        .loadSettings()
        .then((result): void => {
          if (result.ok) {
            onRestore(result.value);
            return;
          }
          restoreFallback();
        })
        .catch(restoreFallback);
    });
  }, [onRestore, onError, getLastConfirmed]);
}
