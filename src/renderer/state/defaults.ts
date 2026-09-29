import type { AppSettings } from '../../shared/types';

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
  // Phase 58 — the tab-strip style. Matches the backend's settings.ts
  // default ('colorful') so a failed loadSettings boots with the
  // operator's reference tab look.
  tabStyle: 'colorful',
  // Phase 58 (chunk 4) — the welcome screen's editable tool row, minus the
  // fixed Open tile. Mirrors the backend's shipped home row so a failed
  // loadSettings boots with the same three-action welcome the UI shipped.
  homeTools: ['createFromImages', 'merge'],
};
