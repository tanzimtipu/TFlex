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
};
