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

import type { ReactElement, ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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
import { clampRecentsCap } from '../state/preferences';
import { DialogShell } from './DialogShell';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import {
  SettingsRow,
  SettingsSection,
  SettingsStudio,
  SettingsSupport,
} from './SettingsStudio';
import type { SettingsSectionDef } from './SettingsStudio';

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
  /** Phase 114 (chunk E) — the "Restore defaults" action. Optional so older
   *  mounts keep rendering; absent means the Reset group is not rendered
   *  (never a silent no-op). */
  onRestoreDefaults?: () => void;
  /** DEF-641 / Phase 114 criterion 4 — the persistence-feedback line shown in
   *  the Studio body whenever the sheet is open. The host swaps in the honest
   *  failure sentence after a failed settings write and clears it back once the
   *  write is confirmed. Absent means the at-rest success text. */
  persistStatus?: ReactNode;
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

/** Phase 114 (chunk E) — the exact scope sentence for the "Restore defaults"
 *  reset. Shared verbatim by the Settings Studio support text and the confirm
 *  dialog so the promise the user reads is the promise that runs. */
export const RESTORE_DEFAULTS_SCOPE =
  'Restores the appearance, tab and import settings to their defaults. Your documents, recent files, window layout and saved signatures are kept.';

/** DEF-641 / Phase 114 criterion 4 — the at-rest persistence-feedback line.
 *  Shown whenever the Settings Studio is open and every loaded setting is
 *  persisted. The host replaces it with the honest failure sentence after a
 *  failed write instead of ever claiming "saved". */
export const PERSIST_STATUS_SAVED = 'All changes saved.';

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

/** Phase 114 (chunk C) — the category registry mapped onto the Studio's
 *  section defs. The legacy `prefs-cat-*` / `prefs-panel-*` ids and the
 *  `data-prefs-category` hook ride through as explicit pass-throughs, so the
 *  migrated shell keeps every shipped anchor. */
const PREFS_SECTIONS: readonly SettingsSectionDef[] = PREFS_CATEGORIES.map(
  (cat): SettingsSectionDef => ({
    id: cat.id,
    label: cat.label,
    icon: cat.icon,
    navId: `prefs-cat-${cat.id}`,
    panelId: `prefs-panel-${cat.id}`,
    navDataAttrs: { 'data-prefs-category': cat.id },
  }),
);

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
    tabStyle = 'chrome',
    onSetTabStyle,
    onRestoreDefaults,
    persistStatus = PERSIST_STATUS_SAVED,
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
  // Phase 114 (chunk E) — the "Restore defaults" confirm dialog. Local to the
  // sheet: the sheet owns the open state, the host owns the reset side-effect.
  const [restoreOpen, setRestoreOpen] = useState(false);

  // DEF-611 — return focus to the application-menu trigger on close. The sheet
  // opens from that menu row; DialogShell lands initial focus inside the sheet
  // and (by design) never restores it, so the return-focus is scoped to
  // Preferences here rather than changing the shared shell for every dialog.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const focusSeededRef = useRef(false);
  useLayoutEffect((): void => {
    if (!open) {
      focusSeededRef.current = false;
      const target = returnFocusRef.current;
      if (target !== null && document.contains(target)) target.focus();
      return;
    }
    if (focusSeededRef.current) return;
    focusSeededRef.current = true;
    returnFocusRef.current = document.querySelector<HTMLElement>('[data-app-menu]');
  }, [open]);

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
      const clamped = clampRecentsCap(n);
      if (clamped !== recentsCap) {
        onSetRecentsCap(clamped);
      } else {
        setCapDraft(String(clamped));
      }
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
    <>
    <DialogShell
      surface="sheet"
      open={open}
      title="Settings Studio"
      titleId="prefs-title"
      onClose={onClose}
      closeAriaLabel="Close preferences"
      className="sheet-prefs"
      data-prefs-dialog
      bodyClassName="sheet-body-prefs"
    >
      <div className="settings-studio-shell">
      <SettingsStudio
      sections={PREFS_SECTIONS}
      activeId={category}
      onSelect={(id): void => setCategory(id as PrefsCategoryId)}
      ariaLabel="Preferences categories"
      resizeAxis="height"
    >
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
                        <SettingsSection title="Appearance">
                          <SettingsRow
                            id="theme-default"
                            label="Theme default"
                            htmlFor="prefs-theme-default"
                            hint="Applies immediately; the app starts in this theme on the next launch."
                            control={
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
                            }
                          />
                          <SettingsRow
                            id="animations"
                            label="Enable animations"
                            htmlFor="prefs-animations"
                            hint="Applies immediately; when off, menus, panels, dialogs and page changes run without transition animations."
                            control={
                              <input
                                id="prefs-animations"
                                type="checkbox"
                                className="prefs-check"
                                checked={animationsEnabled}
                                onChange={(e): void => onSetAnimationsEnabled(e.target.checked)}
                                data-prefs-animations
                              />
                            }
                          />
                          {onSetTabStyle !== undefined && (
                            <SettingsRow
                              id="tab-style"
                              label="Tab style"
                              htmlFor="prefs-tab-style"
                              hint="Applies immediately."
                              control={
                                <select
                                  id="prefs-tab-style"
                                  className="prefs-select"
                                  value={tabStyle}
                                  onChange={(e): void => onSetTabStyle(e.target.value as TabStyle)}
                                  data-prefs-tab-style
                                >
                                  <option value="chrome">Chrome</option>
                                  <option value="colorful">Colorful</option>
                                  <option value="standard">Standard</option>
                                </select>
                              }
                            />
                          )}
                        </SettingsSection>

                        <SettingsSection title="Recent files">
                          <SettingsRow
                            id="recents-cap"
                            label="Maximum entries"
                            htmlFor="prefs-recents-cap"
                            hint="Takes effect on next launch."
                            control={
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
                            }
                          />
                        </SettingsSection>

                        {onRestoreDefaults !== undefined && (
                          <SettingsSection title="Reset">
                            <SettingsRow
                              id="restore-defaults"
                              label="Restore defaults"
                              hint={RESTORE_DEFAULTS_SCOPE}
                              control={
                                <Button
                                  type="button"
                                  intent="secondary"
                                  kind="action"
                                  density="compact"
                                  onClick={(): void => setRestoreOpen(true)}
                                  data-prefs-restore-defaults
                                >
                                  Restore defaults
                                </Button>
                              }
                            />
                          </SettingsSection>
                        )}
                      </>
                    )}

                    {cat.id === 'documents' && (
                      <SettingsSection
                        title="Default PDF app"
                        dataAttrs={{ 'data-prefs-default-pdf-section': '' }}
                      >
                        <SettingsRow
                          id="default-pdf-app"
                          label="Windows default PDF app"
                          hint="Windows does not let an installer change the default PDF handler silently. Choose Jovrel in the settings that open, and Explorer will show the Jovrel icon and type name for PDFs."
                          control={
                            <button
                              type="button"
                              className="btn btn-secondary prefs-action"
                              onClick={openDefaultApps}
                              data-prefs-default-pdf
                            >
                              <Icon icon={MonitorCog} size="sm" />
                              Make Jovrel the default PDF app
                            </button>
                          }
                        />
                        {defaultAppsNotice !== null && (
                          <p className="prefs-hint prefs-action-status" role="status" data-prefs-default-pdf-status>
                            {defaultAppsNotice}
                          </p>
                        )}
                      </SettingsSection>
                    )}

                    {cat.id === 'import' && (
                      <SettingsSection
                        title="Import and conversion"
                        description="Applies to the next import."
                        dataAttrs={{ 'data-prefs-convert-section': '' }}
                      >
                        <SettingsRow
                          id="convert-page-size"
                          label="Page size"
                          htmlFor="prefs-convert-page-size"
                          control={
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
                          }
                        />
                        <SettingsRow
                          id="convert-margin"
                          label="Margin (mm)"
                          htmlFor="prefs-convert-margin"
                          control={
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
                          }
                        />
                        <SettingsRow
                          id="convert-font"
                          label="Text font"
                          htmlFor="prefs-convert-font"
                          control={
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
                          }
                        />
                        <SettingsRow
                          id="convert-font-size"
                          label="Text font size (pt)"
                          htmlFor="prefs-convert-font-size"
                          control={
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
                          }
                        />
                        <SettingsRow
                          id="convert-delimiter"
                          label="CSV delimiter"
                          htmlFor="prefs-convert-delimiter"
                          control={
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
                          }
                        />
                        <SettingsRow
                          id="convert-csv-mapping"
                          label="Map CSV columns to form fields"
                          htmlFor="prefs-convert-csv-mapping"
                          control={
                            <input
                              id="prefs-convert-csv-mapping"
                              type="checkbox"
                              className="prefs-check"
                              checked={convertDefaults.csvFormMapping}
                              onChange={(e): void => setConvert('csvFormMapping', e.target.checked)}
                              data-prefs-convert-csv-mapping
                            />
                          }
                        />
                        <SettingsRow
                          id="convert-html-backgrounds"
                          label="Print HTML backgrounds"
                          htmlFor="prefs-convert-html-backgrounds"
                          control={
                            <input
                              id="prefs-convert-html-backgrounds"
                              type="checkbox"
                              className="prefs-check"
                              checked={convertDefaults.htmlPrintBackgrounds}
                              onChange={(e): void => setConvert('htmlPrintBackgrounds', e.target.checked)}
                              data-prefs-convert-html-backgrounds
                            />
                          }
                        />
                        <SettingsSupport>
                          Used by every file import that produces a new PDF, and by Fill form fields from CSV.
                        </SettingsSupport>
                      </SettingsSection>
                    )}

                    {cat.id === 'storage' && (
                      <SettingsSection title="Storage locations">
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
                      </SettingsSection>
                    )}
                  </div>
                );
              })}
      </SettingsStudio>
      {/* DEF-641 / Phase 114 criterion 4 — honest persistence feedback, present
          whenever the Studio is open. At rest it shows "All changes saved.";
          the host swaps in the failure + rollback sentence on a failed write.
          TFL-1282 (adversary should-fix) — this line is pinned OUTSIDE the
          scrolling `.settings-studio-body` (a non-scrolling footer row of the
          shell) so the honest failure sentence stays visible on the long
          General / Import panels instead of scrolling below the fold. */}
      <p className="settings-support settings-persist-status prefs-persist-status" role="status" data-prefs-persist-status>
        {persistStatus}
      </p>
      </div>
  </DialogShell>
      <ConfirmDialog
        open={open && restoreOpen}
        title="Restore default settings?"
        message={RESTORE_DEFAULTS_SCOPE}
        confirmLabel="Restore defaults"
        cancelLabel="Cancel"
        onConfirm={(): void => {
          onRestoreDefaults?.();
          setRestoreOpen(false);
        }}
        onCancel={(): void => setRestoreOpen(false)}
      />
    </>
  );
}
