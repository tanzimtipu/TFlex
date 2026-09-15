// Phase 6 — Preferences sheet.
//
// Layout: category sidebar (General, Appearance, Documents, Export,
// Edit, OCR, Signatures, Storage) + a detail panel. Only the General
// panel carries settings for now; the other seven categories render a
// quiet placeholder until their panels land in a later task.
//
// General panel sections:
//   - Startup: show the Welcome screen on launch
//   - Confirmations: confirm before closing multiple tabs / deleting
//     pages
//   - Appearance: theme default — kept in the General panel for now
//     (the e2e contract reads the select from the sheet's default
//     view); it moves to the Appearance panel when that panel gets
//     its own content
//   - Recent files: cap
//   - Storage locations (informational: links into the OS file
//     browser, backed by the same `app.openPath` IPC the About
//     dialog uses)
//   - Default handler: register TFlex as the OS default PDF app
//
// The theme default applies IMMEDIATELY on change (no Save click, the
// dialog stays open): the host's `onThemeChange` flips the live theme
// through the same crossfade + persist path as the header toggle, and
// persists the resolved concrete `theme` so the same look boots on the
// next launch. 'system' resolves to the OS's current colour preference
// at choice time (see resolveThemeDefault in state/theme.ts).
//
// The recents cap is also informational on the current session: the
// list is built once at boot from the saved settings.json, so the
// change applies on the next launch. (Changing the cap live would
// require a separate "trim" pass over the in-memory list — the
// current cap is owned by the backend settings service, which would
// have to honour it on the next `addRecentFile`.)
//
// The three General toggles and the default-handler action are
// OPTIONAL props: until App.tsx wires them to the settings service,
// the controls run on in-dialog draft state (they stay interactive
// instead of rendering dead) and the callbacks simply go uncalled.
// Once the host supplies a value it becomes the source of truth and
// the draft is ignored.

import type { ReactElement } from 'react';
import { useEffect, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import type { AppInfo } from '../../shared/types';
import type { ThemeDefault } from '../state/preferences';
import { TfBackdrop, TfSheet } from './motion/TfMotion';

type PrefsCategoryId =
  | 'general'
  | 'appearance'
  | 'documents'
  | 'export'
  | 'edit'
  | 'ocr'
  | 'signatures'
  | 'storage';

/** Sidebar categories in display order. Only `general` has a panel
 *  implemented so far; the rest are navigation placeholders. */
const PREFERENCES_CATEGORIES: ReadonlyArray<{ id: PrefsCategoryId; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'documents', label: 'Documents' },
  { id: 'export', label: 'Export' },
  { id: 'edit', label: 'Edit' },
  { id: 'ocr', label: 'OCR' },
  { id: 'signatures', label: 'Signatures' },
  { id: 'storage', label: 'Storage' },
];

interface PreferencesDialogProps {
  open: boolean;
  onClose: () => void;
  themeDefault: ThemeDefault;
  recentsCap: number;
  onSetThemeDefault: (next: ThemeDefault) => void;
  /** Immediate apply: the host flips the LIVE theme (and persists the
   *  resolved concrete theme) as soon as the dropdown changes — the
   *  user should never need a Save click for a theme change. */
  onThemeChange: (theme: ThemeDefault) => void;
  onSetRecentsCap: (next: number) => void;
  // --- General panel (optional during the transition — see the file
  // --- header: the host does not wire these to settings yet).
  showWelcomeOnStartup?: boolean;
  confirmCloseMultipleTabs?: boolean;
  confirmDeletePages?: boolean;
  onSetShowWelcomeOnStartup?: (next: boolean) => void;
  onSetConfirmCloseMultipleTabs?: (next: boolean) => void;
  onSetConfirmDeletePages?: (next: boolean) => void;
  onSetDefaultPdfHandler?: () => void;
}

/** A checkbox setting the host may not wire yet: when `value` is
 *  provided the control is parent-controlled; when it is not (the
 *  transition before App.tsx wires the setting) the control toggles a
 *  local draft so it never renders as a dead control. */
function useOptionalCheckbox(
  value: boolean | undefined,
  onChange: ((next: boolean) => void) | undefined,
): [boolean, (next: boolean) => void] {
  const [draft, setDraft] = useState<boolean>(value ?? false);
  return [
    value ?? draft,
    (next: boolean): void => {
      setDraft(next);
      if (onChange !== undefined) onChange(next);
    },
  ];
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
    onThemeChange,
    onSetRecentsCap,
    onSetDefaultPdfHandler,
  } = props;
  const [activeCategory, setActiveCategory] = useState<PrefsCategoryId>('general');
  const [capDraft, setCapDraft] = useState(String(recentsCap));
  const [paths, setPaths] = useState<AppInfo['storagePaths']>(FALLBACK_PATHS);

  const [showWelcome, setShowWelcome] = useOptionalCheckbox(
    props.showWelcomeOnStartup,
    props.onSetShowWelcomeOnStartup,
  );
  const [confirmCloseTabs, setConfirmCloseTabs] = useOptionalCheckbox(
    props.confirmCloseMultipleTabs,
    props.onSetConfirmCloseMultipleTabs,
  );
  const [confirmDeletePages, setConfirmDeletePages] = useOptionalCheckbox(
    props.confirmDeletePages,
    props.onSetConfirmDeletePages,
  );

  useEffect(() => {
    setCapDraft(String(recentsCap));
  }, [recentsCap]);

  // Every open starts on General: the sheet is a reference surface,
  // and resuming a mid-list category would put a panel the user never
  // asked for in front of them.
  useEffect(() => {
    if (open) setActiveCategory('general');
  }, [open]);

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
          <div className="preferences-dialog">
            <nav className="preferences-sidebar" aria-label="Preference categories">
              {PREFERENCES_CATEGORIES.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={activeCategory === category.id ? 'active' : undefined}
                  aria-current={activeCategory === category.id ? 'true' : undefined}
                  onClick={(): void => {
                    setActiveCategory(category.id);
                  }}
                  data-prefs-category={category.id}
                >
                  {category.label}
                </button>
              ))}
            </nav>
            <div className="preferences-panel" data-prefs-panel={activeCategory}>
              {activeCategory === 'general' ? (
                <>
                  <section className="preference-section">
                    <h3>Startup</h3>
                    <label className="preference-row">
                      <input
                        type="checkbox"
                        checked={showWelcome}
                        onChange={(e): void => {
                          setShowWelcome(e.target.checked);
                        }}
                        data-prefs-show-welcome
                      />
                      Show Welcome screen on launch
                    </label>
                  </section>

                  <section className="preference-section">
                    <h3>Confirmations</h3>
                    <label className="preference-row">
                      <input
                        type="checkbox"
                        checked={confirmCloseTabs}
                        onChange={(e): void => {
                          setConfirmCloseTabs(e.target.checked);
                        }}
                        data-prefs-confirm-close-tabs
                      />
                      Confirm before closing multiple tabs
                    </label>
                    <label className="preference-row">
                      <input
                        type="checkbox"
                        checked={confirmDeletePages}
                        onChange={(e): void => {
                          setConfirmDeletePages(e.target.checked);
                        }}
                        data-prefs-confirm-delete-pages
                      />
                      Confirm before deleting pages
                    </label>
                  </section>

                  <section className="preference-section">
                    <h3>Appearance</h3>
                    <div className="prefs-row">
                      <label className="prefs-row-label" htmlFor="prefs-theme-default">Theme default</label>
                      <select
                        id="prefs-theme-default"
                        className="prefs-select"
                        value={themeDefault}
                        onChange={(e): void => {
                          const next = e.target.value as ThemeDefault;
                          // Persist the default (next launch), then apply the
                          // choice to the LIVE theme immediately — no Save
                          // click, the dialog stays open.
                          onSetThemeDefault(next);
                          onThemeChange(next);
                        }}
                        data-prefs-theme-default
                      >
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                        <option value="frosted">Frosted</option>
                        <option value="system">System default</option>
                      </select>
                    </div>
                    <p className="prefs-hint">Applies immediately, and is the theme the app starts in on the next launch.</p>
                  </section>

                  <section className="preference-section">
                    <h3>Recent files</h3>
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

                  <section className="preference-section">
                    <h3>Storage locations</h3>
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

                  <section className="preference-section">
                    <h3>Default handler</h3>
                    <div className="preference-row">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={(): void => {
                          if (onSetDefaultPdfHandler !== undefined) onSetDefaultPdfHandler();
                        }}
                        data-prefs-default-pdf-handler
                      >
                        Set TFlex as default PDF application
                      </button>
                    </div>
                  </section>
                </>
              ) : (
                <p className="preferences-panel-empty">
                  Nothing to configure in this category yet.
                </p>
              )}
            </div>
          </div>
        </div>
        </TfSheet>
        </TfBackdrop>
      )}
    </AnimatePresence>
  );
}