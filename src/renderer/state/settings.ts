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
