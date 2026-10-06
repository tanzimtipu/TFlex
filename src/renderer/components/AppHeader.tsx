import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import {
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
import { TfMorph } from "./motion/TfMotion";
import { useMorphPreset } from "./motion/useMorphPreset";
import { dispatchMenuAction, type MenuActionContext } from "../state/menuActions";
import {
  flattenMenuGroups,
  type MenuEntry,
  type MenuGroup,
} from "./TitleBar";
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

/** Phase 40 (item 8) — the Multi Mode toggle's accessible name. Also the
 *  label the application menu's relocated Multi Mode row reuses verbatim, so
 *  the control and its menu entry can never drift apart. */
export const MULTI_MODE_ACCESSIBLE_NAME =
  "Multi Mode: view/edit two documents side by side";

/** Phase 40 (item 5) — the Ctrl+K tool-search icon's accessible name. It
 *  names the shortcut AND the surface (the Command Palette), so the icon
 *  can never be confused with the Ctrl+F find icon beside it. */
export const TOOL_SEARCH_ACCESSIBLE_NAME = "Search tools and commands (Ctrl+K)";

/** Phase 40 (item 5) — the Ctrl+F find icon's accessible name. Reused
 *  verbatim as the relocated Find row's label. */
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
  /** DEF-077 — optional slot for the OTA update indicator. */
  updateIndicator?: ReactNode;
  /** Phase 44 — the account section, built by the host. */
  accountSlot?: ReactNode;
  /** Phase 105 (chunk C) — the application menu's groups (Edit / View /
   *  Tools / Help). Omitted means the trigger is not rendered. */
  appMenuGroups?: MenuGroup[];
  /** The context `dispatchMenuAction` receives for the application menu's
   *  id-backed rows. */
  menuContext?: MenuActionContext;
  /** Phase 36 (chunk 6) — the Multi Mode toggle. Relocated into the
   *  application menu in chunk C. Omitted means the row is not rendered. */
  onMultiModeToggle?: () => void;
  /** Whether Multi Mode is on: the relocated row reflects it. */
  multiModeEnabled?: boolean;
  /** Phase 40 (item 5) — Find in document. Relocated into the application
   *  menu in chunk C. Omitted means the row is not rendered. */
  onOpenFind?: () => void;
  /** Whether a document is open to search: the relocated Find row disables
   *  (with a reason in its tooltip) when false, mirroring the old icon. */
  findEnabled?: boolean;
}

/** Phase 105 (chunk C) — build the application menu's groups: the host's
 *  NON-File groups (Edit / View / Tools / Help) plus the relocated icon
 *  commands that have no menu action id (Multi Mode, Find). The relocated rows
 *  splice into the existing View group so no menu group id or label is
 *  invented. Pure: used by the popover and pinned by tests. */
export function buildAppMenuGroups(
  appMenuGroups: MenuGroup[] | undefined,
  relocated: readonly MenuEntry[],
): MenuGroup[] {
  const groups = appMenuGroups ?? [];
  if (relocated.length === 0) return groups;
  let spliced = false;
  const out = groups.map((g) => {
    if (!spliced && g.id === "view") {
      spliced = true;
      return { ...g, entries: [...g.entries, ...relocated] };
    }
    return g;
  });
  if (!spliced) {
    out.push({ id: "view", label: "View", entries: [...relocated] });
  }
  return out;
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
    updateIndicator = null,
    accountSlot = null,
    appMenuGroups,
    menuContext,
    onMultiModeToggle,
    onOpenFind,
    findEnabled = false,
  } = props;

  // Phase 105 (chunk C) — the application menu popover mirrors the TitleBar
  // File popover machinery: `useMorphPreset` + `TfMorph`, outside-click and
  // Escape close (Escape returns focus to the trigger), and arrow-key roving
  // across the actionable rows. Hooks stay above any return (DEF-117).
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const appMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const appMenuPopoverRef = useRef<HTMLDivElement | null>(null);
  const appMenuRowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const appMenuMorph = useMorphPreset({
    open: appMenuOpen,
    triggerRef: appMenuButtonRef,
    surfaceRef: appMenuPopoverRef,
    anchorCorner: "top-right",
  });

  // The groups the popover lists: the host's NON-File groups plus the
  // relocated icon commands that carry their own handler (Multi Mode, Find).
  const groups = useMemo<MenuGroup[]>(() => {
    const relocated: MenuEntry[] = [];
    if (onMultiModeToggle !== undefined) {
      relocated.push({
        id: "multiMode",
        label: MULTI_MODE_ACCESSIBLE_NAME,
        icon: "multi-mode",
        onSelect: onMultiModeToggle,
      });
    }
    if (onOpenFind !== undefined) {
      relocated.push({
        id: "find",
        label: FIND_IN_DOCUMENT_ACCESSIBLE_NAME,
        icon: "find",
        onSelect: onOpenFind,
        disabled: !findEnabled,
      });
    }
    return buildAppMenuGroups(appMenuGroups, relocated);
  }, [appMenuGroups, onMultiModeToggle, onOpenFind, findEnabled]);

  const flattened = useMemo(() => flattenMenuGroups(groups), [groups]);

  useEffect(() => {
    if (!appMenuOpen) return;
    const onPointer = (e: PointerEvent): void => {
      const t = e.target as Node | null;
      if (t === null) return;
      if (appMenuButtonRef.current?.contains(t)) return;
      if (appMenuPopoverRef.current?.contains(t)) return;
      setAppMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setAppMenuOpen(false);
        appMenuButtonRef.current?.focus();
      } else if (e.key === "Tab") {
        setAppMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return (): void => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [appMenuOpen]);

  const onAppMenuToggle = useCallback((): void => {
    setAppMenuOpen((v) => !v);
  }, []);

  const onAppMenuEntry = useCallback(
    (entry: MenuEntry): void => {
      if (entry.disabled === true) return;
      if (entry.onSelect !== undefined) {
        entry.onSelect();
      } else if (entry.action !== undefined && menuContext !== undefined) {
        dispatchMenuAction(entry.action, menuContext);
      }
      setAppMenuOpen(false);
    },
    [menuContext],
  );

  // Roving focus across the actionable rows (the ARIA menu pattern). The
  // disabled rows are skipped so focus never stalls on an inert entry.
  const onAppMenuKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const els = appMenuRowRefs.current.filter(
      (el): el is HTMLButtonElement => el !== null && !el.disabled,
    );
    if (els.length === 0) return;
    const focused = els.findIndex((el) => el === document.activeElement);
    const dir = e.key === "ArrowDown" ? 1 : -1;
    const base = focused >= 0 ? focused : -dir;
    const next = ((base + dir) % els.length + els.length) % els.length;
    els[next]?.focus();
  }, []);

  // Phase 22 — the relocated Save control's state ladder. Identical semantics
  // to the CommandBar Save button it replaces: warning tint + dot mark unsaved
  // changes, success marks clean, and a read-only source keeps the warning tint
  // but stays disabled (Save-As is the escape hatch).
  const saveTitle = !saveModified
    ? "Saved — no changes to save"
    : saveInPlaceEnabled
      ? "Unsaved changes — Save now (Ctrl+S)"
      : "Read-only document — use Save As to save a copy";
  const saveClass = !saveModified
    ? "btn btn-secondary titlebar-file-btn titlebar-file-btn-clean"
    : saveInPlaceEnabled
      ? "btn btn-secondary titlebar-file-btn titlebar-file-btn-modified"
      : "btn btn-secondary titlebar-file-btn titlebar-file-btn-modified titlebar-file-btn-readonly";

  let rowIndex = 0;
  appMenuRowRefs.current = [];

  return (
    <header className="app-header">
      {/* Phase 22 — the FILE-ACTION group. Open + Save + Save As, immediately
       *  right of the File menu and left of the flexible drag region. The
       *  stable e2e hooks move with the controls. */}
      <div className="titlebar-file" role="group" aria-label="File actions">
        <button
          type="button"
          className="btn btn-secondary titlebar-file-btn titlebar-file-open"
          onClick={onOpenFile}
          aria-label="Open PDF document"
          title="Open PDF (Ctrl+O)"
          data-toolbar-open
        >
          <Icon name="open" size="md" aria-hidden />
          <span className="titlebar-file-label">Open</span>
        </button>
        <span className="titlebar-file-sep" aria-hidden />
        <button
          type="button"
          className={saveClass}
          onClick={onSave}
          disabled={!saveModified || !saveInPlaceEnabled}
          title={saveTitle}
          aria-label="Save"
          data-toolbar-save
        >
          <Icon name="save" size="md" aria-hidden />
          <span
            className={saveModified ? "titlebar-file-dot" : "titlebar-file-dot titlebar-file-dot-hidden"}
            aria-hidden
          />
        </button>
        <button
          type="button"
          className="btn btn-secondary titlebar-file-btn"
          onClick={onSaveAs}
          disabled={activeId === null}
          title="Save a copy (Ctrl+Shift+S)"
          aria-label="Save a copy"
          data-toolbar-save-as
        >
          <Icon name="saveAs" size="md" aria-hidden />
        </button>
      </div>
      {/* Phase 105 (chunk C) — the genuine flexible drag region between the
          document-action cluster and the trailing utilities. Interactive
          descendants (the buttons either side) are `no-drag` through the
          stylesheet contract. */}
      <div className="titlebar-drag" aria-hidden />
      <div className="header-actions">
        {/* Phase 40 (item 5) — Search tools (Ctrl+K) opens the Command Palette. */}
        {onOpenToolSearch !== undefined && (
          <button
            type="button"
            className="btn btn-ghost btn-icon header-tool-search"
            onClick={onOpenToolSearch}
            aria-haspopup="dialog"
            aria-label={TOOL_SEARCH_ACCESSIBLE_NAME}
            title="Search tools and commands (Ctrl+K)"
            data-header-tool-search
          >
            <Icon name="headerCommand" size="md" aria-hidden />
          </button>
        )}
        {/* Phase 30 — Print. Same surface as File > Print and Ctrl+P. */}
        <button
          type="button"
          className="btn btn-ghost btn-icon header-print"
          onClick={onPrint}
          disabled={activeId === null || !printEnabled}
          aria-haspopup="dialog"
          aria-label="Print"
          title={printEnabled ? "Print (Ctrl+P)" : "Open a document to print"}
          data-print
        >
          <Icon name="print" size="md" aria-hidden />
        </button>
        {/* Phase 105 (chunk C) — the ONE application menu. Lists the Edit /
            View / Tools / Help groups plus the relocated Multi Mode and Find
            commands. */}
        {appMenuGroups !== undefined && appMenuGroups.length > 0 && (
          <div className="app-menu">
            <button
              ref={appMenuButtonRef}
              type="button"
              className={appMenuOpen ? "btn btn-ghost btn-icon app-menu-trigger app-menu-trigger-active" : "btn btn-ghost btn-icon app-menu-trigger"}
              onClick={onAppMenuToggle}
              aria-haspopup="menu"
              aria-expanded={appMenuOpen}
              aria-label="Application menu"
              title="Application menu"
              data-app-menu
            >
              <Icon name="appMenu" size="md" aria-hidden />
            </button>
            <AnimatePresence>
              {appMenuOpen && (
                <TfMorph
                  morph={appMenuMorph}
                  ref={appMenuPopoverRef}
                  className="app-menu-popover"
                  role="menu"
                  aria-label="Application menu"
                  data-app-menu-popover
                  onKeyDown={onAppMenuKeyDown}
                >
                  {flattened.map((item) => {
                    if (item.kind === "heading") {
                      return (
                        <div key={item.key} className="titlebar-menu-heading" role="presentation">
                          {item.label}
                        </div>
                      );
                    }
                    if (item.kind === "sep") {
                      return (
                        <div key={item.key} className="titlebar-menu-sep" role="separator" aria-hidden />
                      );
                    }
                    const entry = item.entry;
                    const glyph = entry.icon;
                    const refIndex = rowIndex;
                    rowIndex += 1;
                    return (
                      <button
                        key={item.key}
                        ref={(el): void => {
                          appMenuRowRefs.current[refIndex] = el;
                        }}
                        type="button"
                        className="btn btn-ghost titlebar-menu-row"
                        role="menuitem"
                        onClick={(): void => onAppMenuEntry(entry)}
                        disabled={entry.disabled === true}
                        title={entry.disabled === true ? "Open a document to search it" : undefined}
                        data-menu-action={entry.action ?? entry.id}
                      >
                        <span className="titlebar-menu-row-label">
                          {glyph !== undefined && (
                            <Icon name={glyph} size="md" aria-hidden className="titlebar-menu-row-icon" />
                          )}
                          <span>{entry.label}</span>
                        </span>
                        {entry.accelerator !== undefined && (
                          <span className="kbd titlebar-menu-row-kbd">{entry.accelerator}</span>
                        )}
                      </button>
                    );
                  })}
                </TfMorph>
              )}
            </AnimatePresence>
          </div>
        )}
        {/* DEF-077 — the OTA update indicator, then the account slot, at the
            trailing edge of the title row. */}
        {updateIndicator}
        {accountSlot}
      </div>
    </header>
  );
}
