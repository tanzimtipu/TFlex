import type { AppSettings } from '../../shared/types';

/**
 * Renderer-side fallback defaults. Used when loadSettings fails ('io' or
 * 'corrupt-settings'): the app must still boot with sane values.
 */
export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false },
  recentFiles: [],
};
