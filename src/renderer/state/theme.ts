import type { AppSettings } from '../../shared/types';

export type Theme = AppSettings['theme'];

/** Apply the theme to <html> so CSS variables flip app-wide. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

export function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}
