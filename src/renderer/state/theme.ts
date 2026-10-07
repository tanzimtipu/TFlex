import type { AppSettings, AppTheme } from '../../shared/types';
import { preferencesReducer, type ThemeDefault } from './preferences';

export type Theme = AppSettings['theme'];

/** Apply the theme to <html> so CSS variables flip app-wide. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/** Resolve a theme default (the Preferences dropdown value) to the
 *  concrete theme to apply RIGHT NOW. The concrete values
 *  ('light' | 'dark' | 'frosted') pass through unchanged; 'system'
 *  resolves to dark or light from the OS colour preference
 *  (`prefersDark` — the caller reads
 *  `matchMedia('(prefers-color-scheme: dark)')` at decision time, so
 *  a mid-session OS flip is picked up on the next explicit choice).
 *  Pure so it is unit-testable without a media query; the App's
 *  preferences-sheet `onThemeChange` routes through it so even a
 *  'system' pick flips the live theme immediately (the boot path
 *  keeps applying the persisted concrete `theme`). */
export function resolveThemeDefault(
  themeDefault: ThemeDefault,
  prefersDark: boolean,
): AppTheme {
  if (themeDefault === 'system') {
    return prefersDark ? 'dark' : 'light';
  }
  return themeDefault;
}

/** AR-08 — resolve a Preferences dropdown pick into ONE coherent settings
 *  object: the chosen `themeDefault` AND the concrete `theme` it implies,
 *  written together so the on-disk record can never disagree (the residue
 *  was `theme=light, themeDefault=dark` after a Dark pick). The concrete
 *  theme is `resolveThemeDefault` at decision time, so boot — which applies
 *  `settings.theme` — shows the same look the pick applied live. */
export function applyThemeDefault(
  settings: AppSettings,
  next: ThemeDefault,
  prefersDark: boolean,
): AppSettings {
  return {
    ...preferencesReducer(settings, { type: 'set-theme-default', value: next }),
    theme: resolveThemeDefault(next, prefersDark),
  };
}

/** Cycle the View->Toggle Theme command through ALL three themes
 *  (frosted -> dark -> light -> frosted) so the default theme stays
 *  reachable from the keyboard. The cycle follows the theme-dropdown
 *  order (frosted leads the list). */
export function nextTheme(theme: Theme): Theme {
  switch (theme) {
    case 'frosted':
      return 'dark';
    case 'dark':
      return 'light';
    case 'light':
      return 'frosted';
  }
}

/** DEF-628 (AR-08) — resolve a View > Toggle Theme command into ONE coherent
 *  settings object: the cycled concrete `theme` AND the matching
 *  `themeDefault`, written together so the on-disk record can never disagree
 *  (the residue was `theme=light, themeDefault=dark` after Toggle Theme wrote
 *  only `theme`, leaving Preferences reading a stale default). The concrete
 *  theme is `nextTheme(theme)`, so boot — which applies `settings.theme` —
 *  shows the same look the toggle applied live. Mirrors `applyThemeDefault`
 *  for the dropdown path. */
export function applyToggleTheme(settings: AppSettings): AppSettings {
  const theme = nextTheme(settings.theme);
  return { ...settings, theme, themeDefault: theme };
}
