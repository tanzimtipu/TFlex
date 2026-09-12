// Phase 6 — Preferences Sheet.
//
// Three settings live here today:
//   - theme default (the theme the app starts in)
//   - recents cap (how many entries in the recent files list)
//   - storage locations (informational: links into the OS file browser,
//     backed by the same `app.openPath` IPC the About dialog uses).
//
// The theme default takes effect immediately on next launch — the
// current session's theme is owned by the existing toggle in the
// header (changing the default doesn't visually flip the active
// theme, so a user reading preferences doesn't get surprised by a
// colour swap they didn't ask for).
//
// The recents cap is also informational on the current session: the
// list is built once at boot from the saved settings.json, so the
// change applies on the next launch. (Changing the cap live would
// require a separate "trim" pass over the in-memory list — the
// current cap is owned by the backend settings service, which would
// have to honour it on the next `addRecentFile`.)

import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import type { AppInfo } from '../../shared/types';
import type { ThemeDefault } from '../state/preferences';
import { TfBackdrop, TfSheet } from './motion/TfMotion';

interface PreferencesDialogProps {
  open: boolean;
  onClose: () => void;
  themeDefault: ThemeDefault;
  recentsCap: number;
  onSetThemeDefault: (next: ThemeDefault) => void;
  onSetRecentsCap: (next: number) => void;
}

const FALLBACK_PATHS: AppInfo['storagePaths'] = {
  userData: 'unavailable',
  settings: 'unavailable',
  signatures: 'unavailable',
  cache: 'unavailable',
};

export function PreferencesDialog(props: PreferencesDialogProps): ReactElement | null {
  const {
    open,
    onClose,
    themeDefault,
    recentsCap,
    onSetThemeDefault,
    onSetRecentsCap,
  } = props;
  const [capDraft, setCapDraft] = useState(String(recentsCap));
  const [paths, setPaths] = useState<AppInfo['storagePaths']>(FALLBACK_PATHS);

  useEffect(() => {
    setCapDraft(String(recentsCap));
  }, [recentsCap]);

  // DEF-201 — close the sheet on Escape. Every other dialog in the app
  // (DeletePageDialog, MergeDialog, OptimizeDialog, ...) installs a
  // window-level keydown listener while open; the preferences sheet was
  // the odd one out, so Escape only closed it via the X button or a
  // backdrop click. The listener is installed only while `open` so it
  // is gone as soon as the sheet closes.
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return (): void => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const tflex = (window as unknown as { tflex?: { app?: { getInfo?: () => Promise<AppInfo> } } }).tflex;
    if (tflex?.app?.getInfo === undefined) return (): void => { cancelled = true; };
    void tflex.app.getInfo().then((info) => {
      if (cancelled) return;
      setPaths(info.storagePaths);
    }).catch(() => undefined);
    return (): void => {
      cancelled = true;
    };
  }, [open]);

  const commitCap = (): void => {
    const n = Number.parseInt(capDraft, 10);
    if (Number.isFinite(n)) {
      onSetRecentsCap(n);
    } else {
      setCapDraft(String(recentsCap));
    }
  };

  const handleOpenPath = (path: string): void => {
    if (path === 'unavailable') return;
    const tflex = (window as unknown as { tflex?: { app?: { openPath?: (p: string) => Promise<void> } } }).tflex;
    if (tflex?.app?.openPath === undefined) return;
    void tflex.app.openPath(path).catch(() => undefined);
  };

  return (
    <AnimatePresence>
      {open && (
        <TfBackdrop
          className="sheet-backdrop"
          role="presentation"
          onClick={(e): void => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <TfSheet
            className="sheet sheet-prefs"
            role="dialog"
            aria-labelledby="prefs-title"
            aria-modal="true"
            data-prefs-dialog
          >
        <header className="sheet-header">
          <h2 id="prefs-title" className="sheet-title">Preferences</h2>
          <button
            type="button"
            className="sheet-close"
            onClick={onClose}
            aria-label="Close preferences"
          >
            <X size={16} aria-hidden />
          </button>
        </header>
        <div className="sheet-body sheet-body-prefs">
          <section className="prefs-section">
            <h3 className="prefs-section-title">Appearance</h3>
            <div className="prefs-row">
              <label className="prefs-row-label" htmlFor="prefs-theme-default">Theme default</label>
              <select
                id="prefs-theme-default"
                className="prefs-select"
                value={themeDefault}
                onChange={(e): void => onSetThemeDefault(e.target.value as ThemeDefault)}
                data-prefs-theme-default
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">Match system</option>
              </select>
            </div>
            <p className="prefs-hint">Applies on next launch. Toggle the theme any time from the header.</p>
          </section>

          <section className="prefs-section">
            <h3 className="prefs-section-title">Recent files</h3>
            <div className="prefs-row">
              <label className="prefs-row-label" htmlFor="prefs-recents-cap">Maximum entries</label>
              <input
                id="prefs-recents-cap"
                type="number"
                min={1}
                max={50}
                step={1}
                className="prefs-input"
                value={capDraft}
                onChange={(e): void => setCapDraft(e.target.value)}
                onBlur={commitCap}
                onKeyDown={(e): void => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitCap();
                  }
                }}
                data-prefs-recents-cap
              />
            </div>
            <p className="prefs-hint">Older entries roll off when this cap is reached. Takes effect on next launch.</p>
          </section>

          <section className="prefs-section">
            <h3 className="prefs-section-title">Storage locations</h3>
            <div className="prefs-paths">
              <button
                type="button"
                className="prefs-path"
                onClick={(): void => handleOpenPath(paths.userData)}
                title={paths.userData}
              >
                <span className="prefs-path-label">User data</span>
                <span className="prefs-path-value">{paths.userData}</span>
              </button>
              <button
                type="button"
                className="prefs-path"
                onClick={(): void => handleOpenPath(paths.settings)}
                title={paths.settings}
              >
                <span className="prefs-path-label">Settings file</span>
                <span className="prefs-path-value">{paths.settings}</span>
              </button>
              <button
                type="button"
                className="prefs-path"
                onClick={(): void => handleOpenPath(paths.signatures)}
                title={paths.signatures}
              >
                <span className="prefs-path-label">Saved signatures</span>
                <span className="prefs-path-value">{paths.signatures}</span>
              </button>
            </div>
          </section>
</div>
        </TfSheet>
        </TfBackdrop>
      )}
    </AnimatePresence>
  );
}