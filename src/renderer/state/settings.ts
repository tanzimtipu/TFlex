import type { AppSettings, LoadSettingsResult } from '../../shared/types';
import { DEFAULT_SETTINGS } from './defaults';

/**
 * Resolve the settings to boot the app with. Any failure (missing file,
 * corrupt JSON, io error) falls back to defaults so the app always starts.
 */
export function resolveInitialSettings(result: LoadSettingsResult): {
  settings: AppSettings;
  recovered: boolean;
} {
  if (result.ok) {
    return { settings: result.value, recovered: false };
  }
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    recovered: true,
  };
}

/**
 * DEF-207 (ADV-028) — user-facing feedback for a RECOVERED boot.
 *
 * When the backend cannot parse settings.json (or read it), the
 * renderer boots on defaults. That recovery used to be silent — the
 * user's theme / recents cap / palette choices vanished with no
 * explanation. The boot wiring (App.tsx `runBoot`) surfaces this
 * notice as a toast + console warning whenever
 * `resolveInitialSettings(...).recovered` is true.
 *
 * Scope note: this covers whole-file recovery. Per-field
 * normalization (one invalid value dropped on an otherwise-valid
 * file) happens inside the backend's `normalizeSettings` and the
 * fixed wire contract carries no "corrected fields" signal, so the
 * renderer cannot see it — that half belongs to the settings service
 * in `src/main/services/settings.ts`.
 */
export function settingsRecoveryNotice(): { toast: string; log: string } {
  return {
    toast: 'Settings file could not be read — default settings were restored.',
    log: '[settings] settings.json could not be read; default settings were restored.',
  };
}
