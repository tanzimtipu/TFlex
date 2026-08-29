// Phase 6 — preferences reducer.
//
// The Preferences sheet writes to a stable slice of `AppSettings`. Most
// of these are "set a value" operations on optional fields; the reducer
// returns a new AppSettings object only when the requested change actually
// moves the value, so `saveSettings()` doesn't churn on every keystroke.
//
// The renderer treats these fields as authoritative — the backend's
// settings service normalises them on the way in (e.g. clamping the recents
// cap to [1, 50]), so the renderer doesn't re-validate at write time.

import type { AppSettings, OptimizePreset } from '../../shared/types';

export const MIN_RECENTS_CAP = 1;
export const MAX_RECENTS_CAP = 50;
export const DEFAULT_RECENTS_CAP = 10;

export type ThemeDefault = 'light' | 'dark' | 'system';

export type PreferencesAction =
  | { type: 'set-theme-default'; value: ThemeDefault }
  | { type: 'set-recents-cap'; value: number }
  | { type: 'set-tools-palette-layout'; value: 'list' | 'grid' }
  | { type: 'set-optimize-preset'; value: OptimizePreset };

/** Default compression preset used by the Optimize dialog when the
 *  user hasn't picked one yet. Matches the backend settings.ts default
 *  ('none' = linearized, no compression — the safest baseline so a
 *  first-time Optimize pass never accidentally downsamples images).
 *  The user's choice lives in AppSettings.optimizePreset and survives
 *  restarts via the settings.json preserve-if-valid pipeline. */
export const DEFAULT_OPTIMIZE_PRESET: OptimizePreset = 'none';

/** Render-side allowlist for OptimizePreset. Mirrors the shared type
 *  and the backend's settings.ts validation. Keeping the allowlist in
 *  one place lets the dialog pre-validate user input without importing
 *  the shared type's underlying Zod-style union machinery. */
export const OPTIMIZE_PRESETS: readonly OptimizePreset[] = ['none', 'compact', 'max'];

export function preferencesReducer(
  state: AppSettings,
  action: PreferencesAction,
): AppSettings {
  switch (action.type) {
    case 'set-theme-default': {
      const current: ThemeDefault = state.themeDefault ?? 'dark';
      if (current === action.value) return state;
      return { ...state, themeDefault: action.value };
    }
    case 'set-recents-cap': {
      const clamped = Math.max(
        MIN_RECENTS_CAP,
        Math.min(MAX_RECENTS_CAP, Math.floor(action.value)),
      );
      const current = state.recentsCap ?? DEFAULT_RECENTS_CAP;
      if (current === clamped) return state;
      return { ...state, recentsCap: clamped };
    }
    case 'set-tools-palette-layout': {
      const current = state.toolsPaletteLayout ?? 'list';
      if (current === action.value) return state;
      return { ...state, toolsPaletteLayout: action.value };
    }
    case 'set-optimize-preset': {
      const current: OptimizePreset = state.optimizePreset ?? DEFAULT_OPTIMIZE_PRESET;
      if (current === action.value) return state;
      return { ...state, optimizePreset: action.value };
    }
  }
}

/** Clamp a recents-cap candidate to the supported range. Public so the
 *  Preferences sheet can pre-validate the input before dispatch. */
export function clampRecentsCap(value: number): number {
  return Math.max(
    MIN_RECENTS_CAP,
    Math.min(MAX_RECENTS_CAP, Math.floor(value)),
  );
}