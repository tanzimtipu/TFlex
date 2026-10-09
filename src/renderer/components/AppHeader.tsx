import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Check,
  ChevronDown,
  Command,
  Monitor,
  Moon,
  PanelsLeftRight,
  Printer,
  Save,
  SaveAll,
  Search,
  Settings,
  Snowflake,
  Sun,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { Icon } from "../icons/Icon";
import type { ThemeDefault } from "../state/preferences";
import { TfMorph } from "./motion/TfMotion";
import { useMorphPreset } from "./motion/useMorphPreset";
import { Button, IconButton } from "./Button";
import type { CommandSurface } from "../state/commandCapability";
import type { DocumentRailTab } from "./DocumentRail";

// Phase 105 (chunk C) — the tab strip (and its pure planner) moved to the
// document rail. These are re-exported here so every existing importer and
// unit test that read them from AppHeader keeps resolving unchanged.
export {
  NEW_TAB_MULTI_MODE_REASON,
  TAB_GAP,
  MIN_TAB_WIDTH,
  HARD_MIN_TAB_WIDTH,
  planTabOverflow,
  tabFitAvailableWidth,
  TAB_OVERFLOW_METRICS,
  shouldRestoreActiveOnReorder,
  tearOutDecision,
} from "./DocumentRail";
export type { TabOverflowPlan } from "./DocumentRail";

/** The tab projection AppHeader used to render. Kept as an alias of the rail's
 *  tab type so legacy importers still compile. */
export type AppHeaderTab = DocumentRailTab;

/** Phase 40 (item 8) — the Multi Mode toggle's accessible name. */
export const MULTI_MODE_ACCESSIBLE_NAME =
  "Multi Mode: view/edit two documents side by side";

/** Phase 40 (item 5) — the Ctrl+K tool-search icon's accessible name. It
 *  names the shortcut AND the surface (the Command Palette), so the icon
 *  can never be confused with the Ctrl+F find icon beside it. */
export const TOOL_SEARCH_ACCESSIBLE_NAME = "Search tools and commands (Ctrl+K)";

/** Phase 40 (item 5) — the Ctrl+F find icon's accessible name. */
export const FIND_IN_DOCUMENT_ACCESSIBLE_NAME = "Find in document (Ctrl+F)";

/** The header's migrated glyphs. Declared with an `icon:` property so the
 *  Phase 43 icon-identity guard still attributes each glyph to this surface.
 *  Phase 103 renders the utilities through `name=`; this table stays as the
 *  source oracle the guard reads (the multi-mode pin in particular). */
export const APP_HEADER_GLYPHS = {
  chevronDown: { icon: ChevronDown },
  command: { icon: Command },
  monitor: { icon: Monitor },
  moon: { icon: Moon },
  multiMode: { icon: PanelsLeftRight },
  printer: { icon: Printer },
  save: { icon: Save },
  saveAll: { icon: SaveAll },
  search: { icon: Search },
  settings: { icon: Settings },
  snowflake: { icon: Snowflake },
  sun: { icon: Sun },
} as const satisfies Record<string, { icon: LucideIcon }>;

/** Phase 127 (v1.50.0 restore) — the four theme options the picker offers, in
 *  display order (frosted leads: it is the default). The 'system' meta-option
 *  follows the concrete themes: it is a preference (which theme to follow),
 *  not a theme itself, so it resolves to light/dark at pick time. */
const THEME_OPTIONS: ReadonlyArray<{ value: ThemeDefault; label: string }> = [
  { value: "frosted", label: "Frosted Glass" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System default" },
];

function themeIcon(value: ThemeDefault): LucideIcon {
  if (value === "dark") return APP_HEADER_GLYPHS.moon.icon;
  if (value === "light") return APP_HEADER_GLYPHS.sun.icon;
  if (value === "system") return APP_HEADER_GLYPHS.monitor.icon;
  return APP_HEADER_GLYPHS.snowflake.icon;
}

function themeLabel(value: ThemeDefault): string {
  return THEME_OPTIONS.find((o) => o.value === value)?.label ?? "Frosted Glass";
}

interface AppHeaderProps {
  activeId: string | null;
  /** Phase 22 — the relocated Open / Save / Save As actions owned by the
   *  title row. */
  onOpenFile?: () => void;
  onSave?: () => void;
  onSaveAs?: () => void;
  /** True when the active tab has unsaved engine changes. Drives the
   *  Save control's enabled state + modified dot. */
  saveModified?: boolean;
  /** False for read-only sources (samples): in-place Save is gated to
   *  Save-As only. Defaults to true. */
  saveInPlaceEnabled?: boolean;
  /** Phase 30 — the Print affordance. */
  onPrint?: () => void;
  /** DEF-336 — whether the ACTIVE tab holds a printable document. */
  printEnabled?: boolean;
  /** Phase 40 (item 5) — the Ctrl+K tool-search icon (Command Palette). */
  onOpenToolSearch?: () => void;
  /** Phase 127 (v1.50.0 restore) — the settings gear opens Preferences. */
  onOpenPreferences: () => void;
  /** DEF-077 — optional slot for the OTA update indicator. */
  updateIndicator?: ReactNode;
  /** Phase 44 — the account section, built by the host. */
  accountSlot?: ReactNode;
  /** Phase 36 (chunk 6) — the Multi Mode toggle. Omitted means the control is
   *  not rendered. */
  onMultiModeToggle?: () => void;
  /** Whether Multi Mode is on: the toggle reflects it via aria-pressed. */
  multiModeEnabled?: boolean;
  /** Phase 40 (item 5) — Find in document. Omitted means the control is not
   *  rendered. */
  onOpenFind?: () => void;
  /** Whether a document is open to search: the Find control disables (with a
   *  reason in its tooltip) when false. */
  findEnabled?: boolean;
  /** Phase 127 (v1.50.0 restore) — the saved theme preference the dropdown
   *  marks as selected (falls back to the concrete theme when unset). */
  themeDefault?: ThemeDefault;
  /** Phase 127 (v1.50.0 restore) — the theme dropdown's selection handler. */
  onThemeChange: (next: ThemeDefault) => void;
  /** TFL-1116 C4 (R05) — the ACTIVE surface. On `"home"` the document-only
   *  toolbar controls (Save / Save As / Print) and the Find control are
   *  ABSENT. Defaults to `"document"` so existing callers/tests are unchanged. */
  commandSurface?: CommandSurface;
}

export function AppHeader(props: AppHeaderProps): ReactElement {
  const {
    activeId,
    onOpenFile,
    onSave,
    onSaveAs,
    saveModified = false,
    saveInPlaceEnabled = true,
    onPrint,
    printEnabled = true,
    onOpenToolSearch,
    onOpenPreferences,
    updateIndicator = null,
    accountSlot = null,
    onMultiModeToggle,
    multiModeEnabled = false,
    onOpenFind,
    findEnabled = false,
    themeDefault,
    onThemeChange,
    commandSurface = "document",
  } = props;

  // Phase 127 (v1.50.0 restore) — the embedded theme dropdown. All hooks stay
  // at the top of the component (DEF-117 hook-order contract): no early
  // returns. The picker's selection is the SAVED preference (`themeDefault`)
  // when set; otherwise it falls back to the concrete theme so the control
  // mirrors the applied look on first run.
  const selected: ThemeDefault = themeDefault ?? "frosted";
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const themeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const themePopoverRef = useRef<HTMLDivElement | null>(null);
  const themeOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const themeMorph = useMorphPreset({
    open: themeMenuOpen,
    triggerRef: themeTriggerRef,
    surfaceRef: themePopoverRef,
    anchorCorner: "top-right",
  });

  // When the menu opens, land focus on the currently-selected option (the
  // first one when the persisted value is somehow outside the list).
  useEffect(() => {
    if (!themeMenuOpen) return;
    const idx = THEME_OPTIONS.findIndex((o) => o.value === selected);
    const target = themeOptionRefs.current[idx >= 0 ? idx : 0];
    target?.focus();
  }, [themeMenuOpen, selected]);

  // Close on outside click / Escape / Tab (same pattern as the TitleBar's menu
  // popover). The pointerdown listener only closes — it never preventDefaults
  // or stops propagation, so interactive elements under the pointer keep their
  // normal click (cross-bubbling guard, DEF-087/088/090).
  useEffect(() => {
    if (!themeMenuOpen) return;
    const onPointer = (e: PointerEvent): void => {
      const t = e.target as Node | null;
      if (t === null) return;
      if (themeTriggerRef.current?.contains(t)) return;
      if (themePopoverRef.current?.contains(t)) return;
      setThemeMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setThemeMenuOpen(false);
        themeTriggerRef.current?.focus();
      } else if (e.key === "Tab") {
        setThemeMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return (): void => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [themeMenuOpen]);

  const focusThemeOption = useCallback((index: number): void => {
    const count = THEME_OPTIONS.length;
    if (count === 0) return;
    const clamped = ((index % count) + count) % count;
    themeOptionRefs.current[clamped]?.focus();
  }, []);

  const onThemeTriggerClick = useCallback((): void => {
    setThemeMenuOpen((v) => !v);
  }, []);

  const onThemeTriggerKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setThemeMenuOpen((v) => !v);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setThemeMenuOpen(true);
      }
    },
    [],
  );

  const onThemeSelect = useCallback(
    (next: ThemeDefault): void => {
      setThemeMenuOpen(false);
      if (next !== selected) onThemeChange(next);
      themeTriggerRef.current?.focus();
    },
    [onThemeChange, selected],
  );

  // Roving focus on the option list: arrows move, Home/End jump, and
  // Enter/Space activate the focused option.
  const onThemePopoverKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const focused = themeOptionRefs.current.findIndex((el) => el === document.activeElement);
        const base = focused >= 0 ? focused : THEME_OPTIONS.findIndex((o) => o.value === selected);
        const dir = e.key === "ArrowDown" ? 1 : -1;
        focusThemeOption(base + dir);
      } else if (e.key === "Home") {
        e.preventDefault();
        focusThemeOption(0);
      } else if (e.key === "End") {
        e.preventDefault();
        focusThemeOption(THEME_OPTIONS.length - 1);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const idx = themeOptionRefs.current.findIndex((el) => el === document.activeElement);
        const opt = THEME_OPTIONS[idx];
        if (opt !== undefined) onThemeSelect(opt.value);
      }
    },
    [selected, focusThemeOption, onThemeSelect],
  );

  const currentThemeLabel = themeLabel(selected);

  // Phase 22 — the relocated Save control's state ladder. Identical semantics
  // to the CommandBar Save button it replaces: warning tint + dot mark unsaved
  // changes, success marks clean, and a read-only source keeps the warning tint
  // but stays disabled (Save-As is the escape hatch).
  const saveTitle = !saveModified
    ? "Saved — no changes to save"
    : saveInPlaceEnabled
      ? "Unsaved changes — Save now (Ctrl+S)"
      : "Read-only document — use Save As to save a copy";
  const saveStateClass = !saveModified
    ? "titlebar-file-btn-clean"
    : saveInPlaceEnabled
      ? "titlebar-file-btn-modified"
      : "titlebar-file-btn-modified titlebar-file-btn-readonly";

  return (
    <header className="app-header">
      {/* Phase 22 — the FILE-ACTION group. Open + Save + Save As, immediately
       *  right of the File menu and left of the flexible drag region. The
       *  stable e2e hooks move with the controls. */}
      <div className="titlebar-file" role="group" aria-label="File actions">
        <Button
          intent="secondary"
          kind="action"
          density="compact"
          className="titlebar-file-btn titlebar-file-open"
          onClick={onOpenFile}
          aria-label="Open PDF document"
          title="Open PDF (Ctrl+O)"
          data-toolbar-open
          icon={<Icon name="open" size="md" aria-hidden />}
        >
          <span className="titlebar-file-label">Open</span>
        </Button>
        {commandSurface !== "home" && (
        <span className="titlebar-file-sep" aria-hidden />
        )}
        {commandSurface !== "home" && (
        <Button
          intent="secondary"
          kind="action"
          density="compact"
          className={`titlebar-file-btn ${saveStateClass}`}
          onClick={onSave}
          disabled={!saveModified || !saveInPlaceEnabled}
          title={saveTitle}
          aria-label="Save"
          data-toolbar-save
          icon={<Icon name="save" size="md" aria-hidden />}
        >
          <span
            className={saveModified ? "titlebar-file-dot" : "titlebar-file-dot titlebar-file-dot-hidden"}
            aria-hidden
          />
        </Button>
        )}
        {commandSurface !== "home" && (
        <Button
          intent="secondary"
          kind="action"
          density="compact"
          className="titlebar-file-btn"
          onClick={onSaveAs}
          disabled={activeId === null}
          title="Save a copy (Ctrl+Shift+S)"
          aria-label="Save a copy"
          data-toolbar-save-as
          icon={<Icon name="saveAs" size="md" aria-hidden />}
        />
        )}
      </div>
      {/* Phase 105 (chunk C) — the genuine flexible drag region between the
          document-action cluster and the trailing utilities. Interactive
          descendants (the buttons either side) are `no-drag` through the
          stylesheet contract. */}
      <div className="titlebar-drag" aria-hidden />
      <div className="header-actions">
        {/* DEF-077 — OTA update indicator, leading the trailing chrome. */}
        {updateIndicator}
        {/* Phase 40 (item 5) — Search tools (Ctrl+K) opens the Command Palette. */}
        {onOpenToolSearch !== undefined && (
          <IconButton
            label={TOOL_SEARCH_ACCESSIBLE_NAME}
            intent="tertiary"
            kind="action"
            density="compact"
            className="header-tool-search"
            onClick={onOpenToolSearch}
            aria-haspopup="dialog"
            data-header-tool-search
            icon={<Icon name="headerCommand" size="md" aria-hidden />}
          />
        )}
        {/* Phase 40 (item 5) — Find in document (Ctrl+F). Disabled (with a
            reason) when no document is open to search. */}
        {onOpenFind !== undefined && commandSurface !== "home" && (
          <button
            type="button"
            className="btn btn-ghost btn-icon header-find"
            onClick={onOpenFind}
            disabled={!findEnabled}
            aria-label={FIND_IN_DOCUMENT_ACCESSIBLE_NAME}
            title={findEnabled ? "Find in document (Ctrl+F)" : "Open a document to search it"}
            data-header-find
          >
            <Icon icon={APP_HEADER_GLYPHS.search.icon} size="md" aria-hidden />
          </button>
        )}
        {/* Phase 36 (chunk 6) — the Multi Mode toggle. */}
        {onMultiModeToggle !== undefined && (
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-toggle header-multi-mode"
            onClick={onMultiModeToggle}
            aria-pressed={multiModeEnabled}
            aria-label={MULTI_MODE_ACCESSIBLE_NAME}
            title={
              multiModeEnabled
                ? "Multi Mode on — view/edit two documents side by side. Click to return to one document."
                : "Multi Mode: view/edit two documents side by side in one workspace"
            }
            data-header-multi-mode
            data-multi-mode-active={multiModeEnabled ? "true" : "false"}
          >
            <Icon icon={APP_HEADER_GLYPHS.multiMode.icon} size="md" aria-hidden />
          </button>
        )}
        {/* Phase 30 — Print. Same surface as File > Print and Ctrl+P. */}
        {commandSurface !== "home" && (
        <Button
          intent="tertiary"
          kind="action"
          density="compact"
          className="btn-icon header-print"
          onClick={onPrint}
          disabled={activeId === null || !printEnabled}
          aria-haspopup="dialog"
          aria-label="Print"
          title={printEnabled ? "Print (Ctrl+P)" : "Open a document to print"}
          data-print
          icon={<Icon name="print" size="md" aria-hidden />}
        />
        )}
        {/* Phase 127 (v1.50.0 restore) — Settings gear opens Preferences. */}
        <button
          type="button"
          className="btn btn-ghost btn-icon header-gear"
          onClick={onOpenPreferences}
          aria-haspopup="dialog"
          aria-label="Open preferences"
          title="Preferences (Ctrl+,)"
          data-open-preferences
        >
          <Icon icon={APP_HEADER_GLYPHS.settings.icon} size="md" aria-hidden />
        </button>
        {/* Phase 127 (v1.50.0 restore) — embedded borderless theme picker: a
            labelled pill that opens an attached option list. */}
        <div className="theme-toggle-wrap">
          <button
            ref={themeTriggerRef}
            type="button"
            className="btn btn-ghost theme-toggle theme-toggle-trigger"
            data-theme-toggle
            onClick={onThemeTriggerClick}
            onKeyDown={onThemeTriggerKeyDown}
            aria-haspopup="menu"
            aria-expanded={themeMenuOpen}
            aria-label="Change theme"
            title={`Change theme (current: ${currentThemeLabel})`}
          >
            <Icon icon={themeIcon(selected)} size="md" aria-hidden />
            <span className="theme-toggle-label">{currentThemeLabel}</span>
            <Icon icon={APP_HEADER_GLYPHS.chevronDown.icon} size="md" aria-hidden />
          </button>
          <AnimatePresence>
            {themeMenuOpen && (
              <TfMorph
                morph={themeMorph}
                ref={themePopoverRef}
                className="theme-toggle-popover"
                role="menu"
                aria-label="Change theme"
                onKeyDown={onThemePopoverKeyDown}
              >
                {THEME_OPTIONS.map((opt, i) => {
                  const isSelected = opt.value === selected;
                  return (
                    <button
                      key={opt.value}
                      ref={(el): void => {
                        themeOptionRefs.current[i] = el;
                      }}
                      type="button"
                      role="menuitem"
                      aria-checked={isSelected}
                      className={isSelected ? "theme-toggle-option theme-toggle-option-selected" : "theme-toggle-option"}
                      data-theme-option={opt.value}
                      onClick={(): void => onThemeSelect(opt.value)}
                    >
                      <span className="theme-toggle-option-mark" aria-hidden>
                        {isSelected && <Icon icon={Check} size="md" />}
                      </span>
                      <span className="theme-toggle-option-label">{opt.label}</span>
                    </button>
                  );
                })}
              </TfMorph>
            )}
          </AnimatePresence>
        </div>
        {/* Phase 44 — the account section, at the trailing edge. */}
        {accountSlot}
      </div>
    </header>
  );
}
