import type { AppSettings } from '../../shared/types';
import { DEFAULT_CONVERT_DEFAULTS } from '../../shared/convert';
import { DEFAULT_TAB_STYLE } from './preferences';

/**
 * Renderer-side fallback defaults. Used when loadSettings fails ('io' or
 * 'corrupt-settings'): the app must still boot with sane values.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  // Phase-15 — frosted is the operator-set default theme (matches the
  // backend's DEFAULT_SETTINGS.theme). Used when loadSettings fails
  // ('io' or 'corrupt-settings'); the backend also resolves invalid
  // saved themes to 'frosted'.
  theme: 'frosted',
  geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false },
  recentFiles: [],
  // Phase 11 — OCR defaults. Matches the backend's settings.ts
  // defaults so a fresh install gets a usable first-launch value
  // before any user interaction.
  ocrLanguage: 'eng',
  ocrDownsample: 300,
  // Phase 44 (operator amendment) — accounts ship ENABLED by default in the
  // main process (DEFAULT_SETTINGS.accountsEnabled === true). This field is
  // now an INTERNAL escape hatch only (there is no Preferences row): mirror
  // the main-process default here so a failed loadSettings behaves like a
  // fresh install instead of silently hiding the account section.
  accountsEnabled: true,
  // Phase 58 — the tab-strip style. Phase 123 makes 'chrome' the
  // default; this mirrors the backend's settings.ts default so a failed
  // loadSettings boots with the operator's reference Chrome tab look.
  tabStyle: 'chrome',
  // Phase 58 (chunk 4) — the welcome screen's editable tool row, minus the
  // fixed Open tile. Mirrors the backend's shipped home row so a failed
  // loadSettings boots with the same three-action welcome the UI shipped.
  homeTools: ['createFromImages', 'merge'],
};

/**
 * Phase 114 (chunk E) — the "Restore defaults" reset, scoped to the settings
 * the Settings Studio surfaces. Spreads `current` first so every field the
 * Studio does NOT own survives untouched (documents, `recentFiles` history,
 * `geometry`, saved signatures, annotation colours, ...), then sets ONLY the
 * Studio-surfaced appearance / tab / import fields back to their documented
 * defaults. Pure: returns a new object and never mutates its argument.
 *
 * DEF-643 / TFL-1282 — `recentsCap` is deliberately NOT reset. The backend
 * trims `recentFiles` down to the cap on every save (settings.ts:1182-1190,
 * :427-428), so lowering the cap here silently truncates the user's recent-
 * files history even though the scope text promises it is kept. Leaving the
 * cap untouched preserves both the cap and the whole history list.
 */
export function restoreDefaultSettings(current: AppSettings): AppSettings {
  return {
    ...current,
    theme: 'frosted',
    themeDefault: 'frosted',
    animationsEnabled: true,
    tabStyle: DEFAULT_TAB_STYLE,
    convertDefaults: { ...DEFAULT_CONVERT_DEFAULTS },
  };
}

/**
 * DEF-644 (TFL-1282) — the confirmed-snapshot rule for the one settings-apply
 * path. Only an AUTHORITATIVE apply (a persisted `settings.changed` echo or an
 * authoritative write-failure restore) may advance the "last confirmed"
 * snapshot the rollback hook falls back to. The optimistic Restore-defaults
 * apply must NOT: otherwise a write failure plus a failed authoritative re-read
 * would "restore" the reset that never reached disk instead of the last
 * settings that did. Pure: returns the next snapshot, never mutates.
 */
export function confirmedSnapshotAfterApply(
  previous: AppSettings | null,
  applied: AppSettings,
  confirmed: boolean,
): AppSettings | null {
  return confirmed ? applied : previous;
}
