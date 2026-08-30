import type { AppSettings } from '../../shared/types';

/**
 * Renderer-side fallback defaults. Used when loadSettings fails ('io' or
 * 'corrupt-settings'): the app must still boot with sane values.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false },
  recentFiles: [],
  // Phase 11 — OCR defaults. Matches the backend's settings.ts
  // defaults so a fresh install gets a usable first-launch value
  // before any user interaction.
  ocrLanguage: 'eng',
  ocrDownsample: 300,
};
