import {
  useCallback,
  useMemo,
  useRef,
  useState,
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
import { Icon } from "../icons/Icon";
import { CommandMenu, type CommandMenuGroup, type CommandMenuItem } from "./CommandMenu";
import { Button, IconButton } from "./Button";
import { dispatchMenuAction, type MenuActionContext } from "../state/menuActions";
import {
  toCommandGroups,
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

/** Phase 105 (chunk C7) — the relocated Find row's accessible reason when no
 *  document is open. Rendered by `CommandMenu` via the row's `title` +
 *  `aria-describedby`, replacing the bespoke hard-coded title the inline
 *  popover carried. */
export const FIND_DISABLED_REASON = "Open a document to search it";

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

  // Phase 105 (chunk C7) — the application menu is the shared `CommandMenu`
  // primitive, mirroring the TitleBar File menu migration (C5). CommandMenu
  // owns outside-click dismiss, Escape/Tab close, focus capture/return and the
  // row keyboard model, so this component keeps no bespoke menu plumbing.
  // Hooks stay above any return (DEF-117).
  const [appMenuOpen, setAppMenuOpen] = useState(false);
  const appMenuButtonRef = useRef<HTMLButtonElement | null>(null);

  // The groups the menu lists: the host's NON-File groups plus the relocated
  // icon commands that carry their own handler (Multi Mode, Find).
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

  // Adapt to the shared model via C5's `toCommandGroups` (no duplicated
  // conversion), then attach the disabled Find row's accessible reason. The
  // shipped `MenuEntry` carries no `disabledReason`, so the reason is injected
  // on the already-converted row; every other field passes through verbatim.
  const commandGroups = useMemo<CommandMenuGroup[]>(() => {
    const converted = toCommandGroups(groups);
    return converted.map((group) => ({
      ...group,
      entries: group.entries.map((entry) =>
        entry.id === "find" && entry.disabled === true
          ? { ...entry, disabledReason: FIND_DISABLED_REASON }
          : entry,
      ),
    }));
  }, [groups]);

  const onAppMenuToggle = useCallback((): void => {
    setAppMenuOpen((v) => !v);
  }, []);

  const onAppMenuEntry = useCallback(
    (entry: CommandMenuItem): void => {
      if (entry.disabled === true) return;
      if (entry.onSelect !== undefined) {
        entry.onSelect(entry);
      } else if (entry.action !== undefined && menuContext !== undefined) {
        dispatchMenuAction(entry.action, menuContext);
      }
      setAppMenuOpen(false);
    },
    [menuContext],
  );

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
        <span className="titlebar-file-sep" aria-hidden />
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
      </div>
      {/* Phase 105 (chunk C) — the genuine flexible drag region between the
          document-action cluster and the trailing utilities. Interactive
          descendants (the buttons either side) are `no-drag` through the
          stylesheet contract. */}
      <div className="titlebar-drag" aria-hidden />
      <div className="header-actions">
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
        {/* Phase 30 — Print. Same surface as File > Print and Ctrl+P. */}
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
        {/* Phase 105 (chunk C) — the ONE application menu. Lists the Edit /
            View / Tools / Help groups plus the relocated Multi Mode and Find
            commands. */}
        {appMenuGroups !== undefined && appMenuGroups.length > 0 && (
          <div className="app-menu">
            <IconButton
              ref={appMenuButtonRef}
              label="Application menu"
              intent="secondary"
              kind="disclosure"
              density="compact"
              expanded={appMenuOpen}
              className={appMenuOpen ? "app-menu-trigger app-menu-trigger-active" : "app-menu-trigger"}
              onClick={onAppMenuToggle}
              aria-haspopup="menu"
              data-app-menu
              icon={<Icon name="appMenu" size="md" aria-hidden />}
            />
            {/* Phase 105 (chunk C7) — the shared `CommandMenu`. It emits the
                shipped `.titlebar-menu-*` DOM contract verbatim (headings,
                separators, `data-menu-action` rows with their `.kbd`
                accelerator) and owns outside-click / Escape / Tab dismiss,
                first-focus and focus-return-to-opener. The `app-menu-popover`
                class and `data-app-menu-popover` hook survive via
                `className` + `popoverDataAttrs` so existing selectors keep
                resolving. Enters with the shared `TfMenu` motion in place of
                the retired bespoke FLIP morph. */}
            <CommandMenu
              open={appMenuOpen}
              groups={commandGroups}
              ariaLabel="Application menu"
              onClose={(): void => setAppMenuOpen(false)}
              onSelect={onAppMenuEntry}
              openerRef={appMenuButtonRef}
              className="app-menu-popover"
              popoverDataAttrs={{ "data-app-menu-popover": "true" }}
            />
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
