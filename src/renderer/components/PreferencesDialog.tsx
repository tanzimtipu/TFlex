// Phase 6 — Preferences Sheet.
//
// Phase 59 (item 8) — the sheet is now an Adobe-style two-pane window: a
// vertical CATEGORY rail on the left, one category visible at a time in a
// scrolling content pane. The five legacy sections are grouped into four
// categories (General / Documents / Import & conversion / Storage) and
// every historical control, label and `data-prefs-*` hook is preserved
// EXACTLY — the category rail only decides which panel is visible, never
// which controls exist (all panels stay mounted, hidden via `hidden`).
//
// Three settings live here today:
//   - theme default (the theme the app starts in)
//   - recents cap (how many entries in the recent files list)
//   - storage locations (informational: links into the OS file browser,
//     backed by the same `app.openPath` IPC the About dialog uses).
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

import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  FileType2,
  FolderOpen,
  Import,
  MonitorCog,
  SlidersHorizontal,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '../icons/Icon';
import type { OpenDefaultAppsSettingsResult } from '../../shared/ipc';
import type { AppInfo } from '../../shared/types';
import type { TabStyle } from '../../shared/types';
import { DEFAULT_CONVERT_DEFAULTS } from '../../shared/convert';
import type { ConvertDefaults } from '../../shared/convert';
import type { ThemeDefault } from '../state/preferences';
import { DialogShell } from './DialogShell';
import { Button } from './Button';
import { TfResize } from './motion/TfResize';

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
  /** Phase 23 — the app-wide Animations switch. Reflects the stored
   *  value and applies immediately when toggled; OFF collapses every
   *  animation in the app to the instant path. */
  animationsEnabled: boolean;
  onSetAnimationsEnabled: (next: boolean) => void;
  /** Phase 53 — the import/conversion defaults (Settings `convertDefaults`).
   *  The controls persist each change through the host's settings path.
   *  Optional so older mounts keep rendering; absent means the documented
   *  defaults and no persist. */
  convertDefaults?: ConvertDefaults;
  onSetConvertDefaults?: (next: ConvertDefaults) => void;
  /** Phase 58 — the tab-strip style. Reflects the stored value and
   *  persists each change through the host's settings path. Optional so
   *  older mounts keep rendering; absent means the row is not rendered
   *  (never a silent no-op). */
  tabStyle?: TabStyle;
  onSetTabStyle?: (next: TabStyle) => void;
}

/** Phase 53 — the font families the settings validator accepts for
 *  `convertDefaults.textFontFamily`. Mirrors `CONVERT_FONT_FAMILIES` in
 *  `src/main/services/settings.ts` (the bundled EditFont allowlist plus
 *  `Inter`). The select may only offer values main would accept. */
export const CONVERT_FONT_FAMILIES: readonly string[] = [
  'Helvetica',
  'Times',
  'Courier',
  'Liberation Sans',
  'DejaVu Serif',
  'DejaVu Sans Mono',
  'Inter',
];

/** The validator's documented bounds for the two numeric defaults. */
export const CONVERT_MARGIN_MIN_MM = 5;
export const CONVERT_MARGIN_MAX_MM = 50;
export const CONVERT_FONT_SIZE_MIN_PT = 6;
export const CONVERT_FONT_SIZE_MAX_PT = 48;

/** Clamp a margin in mm to the validator's accepted range. */
export function clampMarginMm(value: number): number {
  return Math.max(
    CONVERT_MARGIN_MIN_MM,
    Math.min(CONVERT_MARGIN_MAX_MM, Math.round(value)),
  );
}

/** Clamp a text font size in pt to the validator's accepted range. */
export function clampFontSizePt(value: number): number {
  return Math.max(
    CONVERT_FONT_SIZE_MIN_PT,
    Math.min(CONVERT_FONT_SIZE_MAX_PT, Math.round(value)),
  );
}

const FALLBACK_PATHS: AppInfo['storagePaths'] = {
  userData: 'unavailable',
  settings: 'unavailable',
  signatures: 'unavailable',
  cache: 'unavailable',
};

/** Phase 59 (item 8) — the vertical category rail. The five legacy
 *  sections are grouped into four categories. Every panel stays mounted
 *  (hidden, not unmounted), so every `data-prefs-*` hook exists from the
 *  moment the sheet opens — switching a category only toggles visibility. */
type PrefsCategoryId = 'general' | 'documents' | 'import' | 'storage';

interface PrefsCategoryDef {
  id: PrefsCategoryId;
  label: string;
  icon: LucideIcon;
}

// Phase 59 (item 8) — each category carries its OWN glyph, distinct from every
// other named icon surface app-wide (Phase 43 invariant). The registry owns the
// document-command glyphs (FileText / FileInput), so the rail uses FileType2 for
// the file-association category and Import for the import/conversion category.
const PREFS_CATEGORIES: readonly PrefsCategoryDef[] = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'documents', label: 'Documents', icon: FileType2 },
  { id: 'import', label: 'Import & conversion', icon: Import },
  { id: 'storage', label: 'Storage', icon: FolderOpen },
];

export function PreferencesDialog(props: PreferencesDialogProps): ReactElement | null {
  const {
    open,
    onClose,
    themeDefault,
    recentsCap,
    onSetThemeDefault,
    onThemeChange,
    onSetRecentsCap,
    animationsEnabled,
    onSetAnimationsEnabled,
    convertDefaults = DEFAULT_CONVERT_DEFAULTS,
    onSetConvertDefaults,
    tabStyle = 'colorful',
    onSetTabStyle,
  } = props;
  const [capDraft, setCapDraft] = useState(String(recentsCap));
  // Phase 53 — the two numeric conversion controls are drafts committed on
  // blur/Enter, so a half-typed value is never persisted; the clamps below
  // guarantee the committed value is one the settings validator accepts.
  const [marginDraft, setMarginDraft] = useState(String(convertDefaults.marginMm));
  const [fontSizeDraft, setFontSizeDraft] = useState(String(convertDefaults.textFontSizePt));
  const [paths, setPaths] = useState<AppInfo['storagePaths']>(FALLBACK_PATHS);
  // Phase 50 - the honest outcome line for the "default PDF app" action. Null
  // until the user clicks; the app never claims IT changed the default, only
  // that Windows' settings were opened (or could not be).
  const [defaultAppsNotice, setDefaultAppsNotice] = useState<string | null>(null);
  // Phase 59 (item 8) — the active category. Roving tabindex: only the
  // active category button is tabbable; arrow keys move between them.
  const [category, setCategory] = useState<PrefsCategoryId>('general');
  const categoryRefs = useRef<Partial<Record<PrefsCategoryId, HTMLButtonElement | null>>>({});

  const selectCategory = (next: PrefsCategoryId): void => {
    setCategory(next);
    categoryRefs.current[next]?.focus();
  };

  const handleRailKeyDown = (e: ReactKeyboardEvent<HTMLElement>): void => {
    const ids = PREFS_CATEGORIES.map((c): PrefsCategoryId => c.id);
    const current = ids.indexOf(category);
    let next: PrefsCategoryId | null = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      next = ids[(current + 1) % ids.length] ?? null;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      next = ids[(current - 1 + ids.length) % ids.length] ?? null;
    } else if (e.key === 'Home') {
      next = ids[0] ?? null;
    } else if (e.key === 'End') {
      next = ids[ids.length - 1] ?? null;
    }
    if (next === null) return;
    e.preventDefault();
    selectCategory(next);
  };

  useEffect(() => {
    setCapDraft(String(recentsCap));
  }, [recentsCap]);

  useEffect(() => {
    setMarginDraft(String(convertDefaults.marginMm));
  }, [convertDefaults.marginMm]);

  useEffect(() => {
    setFontSizeDraft(String(convertDefaults.textFontSizePt));
  }, [convertDefaults.textFontSizePt]);

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

  const commitMargin = (): void => {
    const n = Number(marginDraft);
    if (Number.isFinite(n)) {
      const clamped = clampMarginMm(n);
      if (clamped !== convertDefaults.marginMm) {
        onSetConvertDefaults?.({ ...convertDefaults, marginMm: clamped });
      } else {
        setMarginDraft(String(clamped));
      }
    } else {
      setMarginDraft(String(convertDefaults.marginMm));
    }
  };

  const commitFontSize = (): void => {
    const n = Number(fontSizeDraft);
    if (Number.isFinite(n)) {
      const clamped = clampFontSizePt(n);
      if (clamped !== convertDefaults.textFontSizePt) {
        onSetConvertDefaults?.({ ...convertDefaults, textFontSizePt: clamped });
      } else {
        setFontSizeDraft(String(clamped));
      }
    } else {
      setFontSizeDraft(String(convertDefaults.textFontSizePt));
    }
  };

  const setConvert = <K extends keyof ConvertDefaults>(
    key: K,
    value: ConvertDefaults[K],
  ): void => {
    onSetConvertDefaults?.({ ...convertDefaults, [key]: value });
  };

  const handleOpenPath = (path: string): void => {
    if (path === 'unavailable') return;
    const tflex = (window as unknown as { tflex?: { app?: { openPath?: (p: string) => Promise<void> } } }).tflex;
    if (tflex?.app?.openPath === undefined) return;
    void tflex.app.openPath(path).catch(() => undefined);
  };

  /** Phase 50 - open Windows' Default-apps settings so the user can make
   *  Jovrel the default PDF handler. Windows does not let an installer set
   *  the default silently, which is why the app opens the settings instead of
   *  changing anything itself. */
  const openDefaultApps = (): void => {
    const app = (window as unknown as {
      tflex?: { app?: { openDefaultAppsSettings?: () => Promise<OpenDefaultAppsSettingsResult> } };
    }).tflex?.app;
    if (app?.openDefaultAppsSettings === undefined) {
      setDefaultAppsNotice(
        "This build cannot open Windows' Default-apps settings. Open Settings > Apps > Default apps yourself.",
      );
      return;
    }
    void app
      .openDefaultAppsSettings()
      .then((res) => {
        setDefaultAppsNotice(
          res.ok
            ? "Windows' Default-apps settings are open. Choose Jovrel there."
            : "Windows' settings could not be opened. Open Settings > Apps > Default apps yourself.",
        );
      })
      .catch(() => {
        setDefaultAppsNotice(
          "Windows' settings could not be opened. Open Settings > Apps > Default apps yourself.",
        );
      });
  };

  return (
    <DialogShell
      surface="sheet"
      open={open}
      title="Preferences"
      titleId="prefs-title"
      onClose={onClose}
      closeAriaLabel="Close preferences"
      className="sheet-prefs"
      data-prefs-dialog
      bodyClassName="sheet-body-prefs"
    >
      <div className="prefs-layout">
            <nav
              className="prefs-rail"
              role="tablist"
              aria-orientation="vertical"
              aria-label="Preferences categories"
              onKeyDown={handleRailKeyDown}
            >
              {PREFS_CATEGORIES.map((cat) => {
                const isActive = category === cat.id;
                const CategoryIcon = cat.icon;
                return (
                  <Button
                    key={cat.id}
                    type="button"
                    role="tab"
                    id={`prefs-cat-${cat.id}`}
                    intent="secondary"
                    kind="exclusive-selection"
                    density="compact"
                    className="prefs-cat"
                    aria-selected={isActive}
                    aria-controls={`prefs-panel-${cat.id}`}
                    tabIndex={isActive ? 0 : -1}
                    data-prefs-category={cat.id}
                    ref={(el): void => {
                      categoryRefs.current[cat.id] = el;
                    }}
                    onClick={(): void => selectCategory(cat.id)}
                  >
                    <Icon className="prefs-cat-icon" icon={CategoryIcon} size="sm" />
                    <span className="prefs-cat-label">{cat.label}</span>
                  </Button>
                );
              })}
            </nav>
            <div className="prefs-content">
              <TfResize axes="height">
              {PREFS_CATEGORIES.map((cat) => {
                const isActive = category === cat.id;
                return (
                  <div
                    key={cat.id}
                    id={`prefs-panel-${cat.id}`}
                    role="tabpanel"
                    aria-labelledby={`prefs-cat-${cat.id}`}
                    className={isActive ? 'prefs-panel anim-tab-in' : 'prefs-panel'}
                    data-prefs-panel={cat.id}
                    data-active={isActive ? 'true' : 'false'}
                    hidden={!isActive}
                  >
                    {cat.id === 'general' && (
                      <>
                        <section className="prefs-section">
                          <h3 className="prefs-section-title">Appearance</h3>
                          <div className="prefs-row">
                            <div className="prefs-row-text">
                              <label className="prefs-row-label" htmlFor="prefs-theme-default">Theme default</label>
                              <p className="prefs-hint">Applies immediately, and is the theme the app starts in on the next launch.</p>
                            </div>
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
                          <div className="prefs-row">
                            <div className="prefs-row-text">
                              <label className="prefs-row-label" htmlFor="prefs-animations">Animations</label>
                              <p className="prefs-hint">
                                Turns off every animation in the app - menus, panels and dialogs appear instantly.
                              </p>
                            </div>
                            <input
                              id="prefs-animations"
                              type="checkbox"
                              className="prefs-check"
                              checked={animationsEnabled}
                              onChange={(e): void => onSetAnimationsEnabled(e.target.checked)}
                              data-prefs-animations
                            />
                          </div>
                          {onSetTabStyle !== undefined && (
                            <>
                              <div className="prefs-row">
                                <div className="prefs-row-text">
                                  <label className="prefs-row-label" htmlFor="prefs-tab-style">Tab style</label>
                                  <p className="prefs-hint">Colorful gives each tab its own flat colour; Standard keeps the classic tab look.</p>
                                </div>
                                <select
                                  id="prefs-tab-style"
                                  className="prefs-select"
                                  value={tabStyle}
                                  onChange={(e): void => onSetTabStyle(e.target.value as TabStyle)}
                                  data-prefs-tab-style
                                >
                                  <option value="colorful">Colorful</option>
                                  <option value="standard">Standard</option>
                                </select>
                              </div>
                            </>
                          )}
                        </section>

                        <section className="prefs-section">
                          <h3 className="prefs-section-title">Recent files</h3>
                          <div className="prefs-row">
                            <div className="prefs-row-text">
                              <label className="prefs-row-label" htmlFor="prefs-recents-cap">Maximum entries</label>
                              <p className="prefs-hint">Older entries roll off when this cap is reached. Takes effect on next launch.</p>
                            </div>
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
                        </section>
                      </>
                    )}

                    {cat.id === 'documents' && (
                      <section className="prefs-section" data-prefs-default-pdf-section>
                        <h3 className="prefs-section-title">Default PDF app</h3>
                        <div className="prefs-row">
                          <div className="prefs-row-text">
                            <p className="prefs-hint">
                              Windows does not let an installer change the default PDF handler silently. Choose Jovrel
                              in the settings that open, and Explorer will show the Jovrel icon and type name for PDFs.
                            </p>
                          </div>
                          <button
                            type="button"
                            className="btn btn-secondary prefs-action"
                            onClick={openDefaultApps}
                            data-prefs-default-pdf
                          >
                            <Icon icon={MonitorCog} size="sm" />
                            Make Jovrel the default PDF app
                          </button>
                        </div>
                        {defaultAppsNotice !== null && (
                          <p className="prefs-hint prefs-action-status" role="status" data-prefs-default-pdf-status>
                            {defaultAppsNotice}
                          </p>
                        )}
                      </section>
                    )}

                    {cat.id === 'import' && (
                      <section className="prefs-section" data-prefs-convert-section>
                        <h3 className="prefs-section-title">Import and conversion</h3>
                        <div className="prefs-row">
                          <div className="prefs-row-text">
                            <label className="prefs-row-label" htmlFor="prefs-convert-page-size">Page size</label>
                          </div>
                          <select
                            id="prefs-convert-page-size"
                            className="prefs-select"
                            value={convertDefaults.pageSize}
                            onChange={(e): void => setConvert('pageSize', e.target.value as ConvertDefaults['pageSize'])}
                            data-prefs-convert-page-size
                          >
                            <option value="a4">A4</option>
                            <option value="letter">Letter</option>
                          </select>
                        </div>
                        <div className="prefs-row">
                          <div className="prefs-row-text">
                            <label className="prefs-row-label" htmlFor="prefs-convert-margin">Margin (mm)</label>
                          </div>
                          <input
                            id="prefs-convert-margin"
                            type="number"
                            min={CONVERT_MARGIN_MIN_MM}
                            max={CONVERT_MARGIN_MAX_MM}
                            step={1}
                            className="prefs-input"
                            value={marginDraft}
                            onChange={(e): void => setMarginDraft(e.target.value)}
                            onBlur={commitMargin}
                            onKeyDown={(e): void => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitMargin();
                              }
                            }}
                            data-prefs-convert-margin
                          />
                        </div>
                        <div className="prefs-row">
                          <div className="prefs-row-text">
                            <label className="prefs-row-label" htmlFor="prefs-convert-font">Text font</label>
                          </div>
                          <select
                            id="prefs-convert-font"
                            className="prefs-select"
                            value={convertDefaults.textFontFamily}
                            onChange={(e): void => setConvert('textFontFamily', e.target.value)}
                            data-prefs-convert-font
                          >
                            {CONVERT_FONT_FAMILIES.map((family) => (
                              <option key={family} value={family}>{family}</option>
                            ))}
                          </select>
                        </div>
                        <div className="prefs-row">
                          <div className="prefs-row-text">
                            <label className="prefs-row-label" htmlFor="prefs-convert-font-size">Text font size (pt)</label>
                          </div>
                          <input
                            id="prefs-convert-font-size"
                            type="number"
                            min={CONVERT_FONT_SIZE_MIN_PT}
                            max={CONVERT_FONT_SIZE_MAX_PT}
                            step={1}
                            className="prefs-input"
                            value={fontSizeDraft}
                            onChange={(e): void => setFontSizeDraft(e.target.value)}
                            onBlur={commitFontSize}
                            onKeyDown={(e): void => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitFontSize();
                              }
                            }}
                            data-prefs-convert-font-size
                          />
                        </div>
                        <div className="prefs-row">
                          <div className="prefs-row-text">
                            <label className="prefs-row-label" htmlFor="prefs-convert-delimiter">CSV delimiter</label>
                          </div>
                          <select
                            id="prefs-convert-delimiter"
                            className="prefs-select"
                            value={convertDefaults.csvDelimiter}
                            onChange={(e): void => setConvert('csvDelimiter', e.target.value as ConvertDefaults['csvDelimiter'])}
                            data-prefs-convert-delimiter
                          >
                            <option value="auto">Auto-detect</option>
                            <option value=",">Comma (,)</option>
                            <option value=";">Semicolon (;)</option>
                            <option value={'\t'}>Tab</option>
                          </select>
                        </div>
                        <div className="prefs-row">
                          <div className="prefs-row-text">
                            <label className="prefs-row-label" htmlFor="prefs-convert-csv-mapping">Map CSV columns to form fields</label>
                          </div>
                          <input
                            id="prefs-convert-csv-mapping"
                            type="checkbox"
                            className="prefs-check"
                            checked={convertDefaults.csvFormMapping}
                            onChange={(e): void => setConvert('csvFormMapping', e.target.checked)}
                            data-prefs-convert-csv-mapping
                          />
                        </div>
                        <div className="prefs-row">
                          <div className="prefs-row-text">
                            <label className="prefs-row-label" htmlFor="prefs-convert-html-backgrounds">Print HTML backgrounds</label>
                          </div>
                          <input
                            id="prefs-convert-html-backgrounds"
                            type="checkbox"
                            className="prefs-check"
                            checked={convertDefaults.htmlPrintBackgrounds}
                            onChange={(e): void => setConvert('htmlPrintBackgrounds', e.target.checked)}
                            data-prefs-convert-html-backgrounds
                          />
                        </div>
                        <div className="prefs-row">
                          <div className="prefs-row-text">
                            <p className="prefs-hint">
                              Used by every file import that produces a new PDF, and by Fill form fields from CSV. Applies to the next import.
                            </p>
                          </div>
                        </div>
                      </section>
                    )}

                    {cat.id === 'storage' && (
                      <section className="prefs-section">
                        <h3 className="prefs-section-title">Storage locations</h3>
                        <div className="prefs-paths">
                          <Button
                            type="button"
                            intent="secondary"
                            kind="action"
                            density="compact"
                            className="prefs-path"
                            onClick={(): void => handleOpenPath(paths.userData)}
                            title={paths.userData}
                          >
                            <span className="prefs-path-label">User data</span>
                            <span className="prefs-path-value">{paths.userData}</span>
                          </Button>
                          <Button
                            type="button"
                            intent="secondary"
                            kind="action"
                            density="compact"
                            className="prefs-path"
                            onClick={(): void => handleOpenPath(paths.settings)}
                            title={paths.settings}
                          >
                            <span className="prefs-path-label">Settings file</span>
                            <span className="prefs-path-value">{paths.settings}</span>
                          </Button>
                          <Button
                            type="button"
                            intent="secondary"
                            kind="action"
                            density="compact"
                            className="prefs-path"
                            onClick={(): void => handleOpenPath(paths.signatures)}
                            title={paths.signatures}
                          >
                            <span className="prefs-path-label">Saved signatures</span>
                            <span className="prefs-path-value">{paths.signatures}</span>
                          </Button>
                        </div>
                      </section>
                    )}
                  </div>
                );
              })}
              </TfResize>
            </div>
          </div>
    </DialogShell>
  );
}
