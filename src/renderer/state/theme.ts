import type { AppSettings } from '../../shared/types';

export type Theme = AppSettings['theme'];

/** Apply the theme to <html> so CSS variables flip app-wide. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
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
