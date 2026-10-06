// Phase 13 — custom title bar.
//
// Renders the window caption region when the BrowserWindow is created
// with `frame: false`. The whole bar carries `-webkit-app-region:
// drag` (declared in styles.css) so the OS treats it as the window
// caption; every interactive child inside it carries `-webkit-app-
// region: no-drag` so clicks land on the right element instead of
// starting a drag. Window-controls (minimize / maximize / close) sit
// at the trailing edge and fire the IPC channels the preload bridge
// exposes (`tflex.minimizeWindow` / `tflex.maximizeWindow` /
// `tflex.closeWindow`). The brand mark + tabs + header actions slot
// into the same bar so the user gets one continuous caption strip
// rather than two stacked surfaces.
//
// The optional menu popover (the "menu" button at the leading edge,
// next to the brand) exposes the File menu actions as labelled rows
// with their accelerators. As of TFL-975 (TFL-855 chunk C5) it is the
// shared `CommandMenu` primitive: CommandMenu owns the shipped
// `.titlebar-menu-*` DOM contract, outside-click dismiss, Escape and
// focus-return-to-opener, so this component keeps no bespoke menu
// plumbing. Native menu accelerators still own the shortcuts — the
// popover is a discoverability surface, not an alternate input path.
//
// Three render-tree rules baked into this component that you must
// preserve:
//
//   1. Hooks are always at the TOP of the component, above any early
//      return. We have no early returns here, but a future feature
//      that gates on `disabled` will trip React's hook-order check if
//      a hook moves below such a branch.
//
//   2. NO emojis anywhere — the brand mark is the inline JOVREL SVG
//      (BrandMark) rather than a text glyph or a pictogram.
//
//   3. The `-webkit-app-region` CSS contract: this component's outer
//      `.titlebar` carries `drag` (declared in styles.css); the
//      `.titlebar-slot` / `.app-header` inside it inherit that drag
//      region, and ONLY interactive children (window controls, menu
//      button + popover, tab surfaces, buttons, inputs) carry
//      `no-drag` (DEF-132). No JS toggles this — it is a stylesheet
//      contract that survives React re-renders.

import {
  useCallback,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { AnimatePresence } from "motion/react";
import { Icon } from "../icons/Icon";
import type { QuietIconId } from "../icons/quietPrecision";
import { dispatchMenuAction, type MenuActionContext } from "../state/menuActions";
import {
  CommandMenu,
  type CommandMenuGroup,
  type CommandMenuItem,
} from "./CommandMenu";
import { GlassChromeBar } from "./GlassChrome";
import { BrandMark } from "./BrandMark";
import { BrandWordmark } from "./BrandWordmark";
import { Button } from "./Button";

/** The shape of a menu entry. Two kinds: a top-level group heading
 *  (rendered as a non-interactive row) or an action row. The
 *  component is menu-shape-agnostic — it does NOT know about File /
 *  Edit / View specifics; the caller passes the labels, the
 *  accelerators, and the action names. This keeps the menu popover
 *  testable in isolation without booting the menu IPC channel. */
export interface MenuEntry {
  /** Stable id; used by React's key + as the menu action name when
   *  `action` is not provided. */
  id: string;
  /** Visible label, e.g. "Save". */
  label: string;
  /** Shortcut text, e.g. "Ctrl+S". Rendered as a `.kbd` chip on the
   *  right edge of the row. May be omitted for actions without a
   *  keyboard shortcut. */
  accelerator?: string;
  /** The action string the existing dispatcher understands. When
   *  omitted, the entry renders as a non-interactive group heading
   *  (label-only, no shortcut, no hover state). */
  action?: string;
  /** Rendered through the Quiet Precision registry as a command/chrome id to
   *  the left of the label. Optional — the popover stays text-only when
   *  omitted. */
  icon?: QuietIconId;
  /** Phase 105 (chunk C) — an action that runs a handler DIRECTLY rather than
   *  through `dispatchMenuAction`. Used by the application menu for the
   *  relocated icon commands that have no menu action id (Multi Mode, Find).
   *  When present, `action` is ignored. */
  onSelect?: () => void;
  /** Phase 105 (chunk C) — render the row disabled (unavailable right now).
   *  Keeps the relocated Find row honest when no document is open. */
  disabled?: boolean;
}

export interface MenuGroup {
  /** Stable id; React key. */
  id: string;
  /** Group label (e.g. "File"). Renders as a non-interactive
   *  section heading at the top of the group. */
  label: string;
  /** Menu entries inside this group. An entry whose `action` is
   *  undefined renders as a non-interactive separator / heading
   *  (visual rule). */
  entries: MenuEntry[];
}

export interface TitleBarProps {
  /** Optional pre-built menu groups. When provided, the menu button
   *  opens a popover listing every entry; clicking an entry routes
   *  through the menu action dispatcher (same path the native menu
   *  uses). When omitted, the menu button is hidden entirely —
   *  native menu shortcuts remain the only entry path. */
  menuGroups?: MenuGroup[];
  /** Context passed straight to `dispatchMenuAction`. Identical to
   *  the shape `App.tsx` hands the native-menu listener. We do NOT
   *  validate the entries here; a missing handler is the renderer's
   *  problem to surface (the existing dispatcher already returns
   *  `false` on unknown actions). */
  menuContext?: MenuActionContext;
  /** True when the window is maximized. Used to flip the maximize /
   *  restore icon and the tooltip. The renderer doesn't track this
   *  directly — the host App reads the geometry echo and forwards
   *  the boolean through this prop. Defaults to false (assume
   *  restored). */
  maximized?: boolean;
  /** Optional slot the host uses to inject the existing AppHeader
   *  content (brand mark, tab strip, header actions) between the
   *  menu button and the window controls. The slot's children MUST
   *  inherit `.app-header > *`'s `no-drag` rule — the title bar's
   *  CSS scopes the rule to its immediate children only. Callers
   *  that want their slot children to receive the same rule should
   *  keep them as direct children of the TitleBar (the wrapping
   *  fragment is transparent to the stylesheet). */
  children?: ReactNode;
}

/** Pure helper: flatten a list of menu groups into the row list the
 *  popover renders. Extracted so tests can pin the layout without
 *  rendering. */
export function flattenMenuGroups(
  groups: readonly MenuGroup[],
): Array<{ kind: "heading"; key: string; label: string } | { kind: "row"; key: string; entry: MenuEntry } | { kind: "sep"; key: string }> {
  const out: Array<
    { kind: "heading"; key: string; label: string } |
    { kind: "row"; key: string; entry: MenuEntry } |
    { kind: "sep"; key: string }
  > = [];
  for (const g of groups) {
    out.push({ kind: "heading", key: `${g.id}-h`, label: g.label });
    for (const entry of g.entries) {
      if (entry.action === undefined && entry.onSelect === undefined) {
        out.push({ kind: "sep", key: `${g.id}-${entry.id}` });
        continue;
      }
      out.push({ kind: "row", key: `${g.id}-${entry.id}`, entry });
    }
  }
  return out;
}

/** TFL-975 (TFL-855 chunk C5) — adapt the host's {@link MenuGroup} list to the
 *  shared {@link CommandMenuGroup} model. `CommandMenuItem` is a SUPERSET of
 *  `MenuEntry` with the SAME field names, so this is a pure pass-through that
 *  preserves `id` / `label` / `accelerator` / `action` / `icon` / `onSelect` /
 *  `disabled` verbatim. No command is added, removed or renamed. */
export function toCommandGroups(groups: readonly MenuGroup[]): CommandMenuGroup[] {
  return groups.map((group) => ({
    id: group.id,
    label: group.label,
    entries: group.entries.map((entry) => ({
      id: entry.id,
      label: entry.label,
      accelerator: entry.accelerator,
      action: entry.action,
      icon: entry.icon,
      onSelect: entry.onSelect,
      disabled: entry.disabled,
    })),
  }));
}

export function TitleBar(props: TitleBarProps): ReactElement {
  // Hooks above any conditional. We don't have an early return; this
  // rule is pinned by the mistakes-notes for future-proofing.
  const { menuGroups, menuContext, maximized = false, children } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  const onMinimize = useCallback((): void => {
    window.tflex.minimizeWindow();
  }, []);

  const onMaximize = useCallback((): void => {
    // The backend's IPC handler (src/main/index.ts) toggles: if
    // already maximized it calls win.unmaximize(), else win.maximize().
    // We don't need to flip our `maximized` state here — the host
    // App.tsx reads the geometry echo from main and forwards the
    // new boolean back through this prop. That's the same
    // immediate-persist pattern the rest of the App uses.
    window.tflex.maximizeWindow();
  }, []);

  const onClose = useCallback((): void => {
    window.tflex.closeWindow();
  }, []);

  const onMenuEntry = useCallback(
    (entry: CommandMenuItem): void => {
      if (entry.disabled === true) return;
      // Phase 105 (chunk C) — a relocated command with its own handler runs it
      // directly; the menu-action dispatcher only sees id-backed rows.
      if (entry.onSelect !== undefined) {
        entry.onSelect(entry);
        setMenuOpen(false);
        return;
      }
      if (entry.action === undefined || menuContext === undefined) return;
      // The dispatcher's return value is intentionally discarded:
      // a `false` return means the action is unknown (a stale entry
      // in our group list, or a typo). The native menu's listener
      // does the same — see App.tsx `useEffect(() => unsubscribe =
      // window.tflex.menu.onAction(...))`.
      dispatchMenuAction(entry.action, menuContext);
      setMenuOpen(false);
    },
    [menuContext],
  );

  // B10 + Phase 13 — the caption glyphs follow the Windows/VS Code
  // convention every desktop user already knows:
  //   minimize  -> a horizontal line (Minus)
  //   maximize  -> a single square (Square)
  //   restore   -> two overlapping squares (Copy)
  //   close     -> an X (X)
  // The previous diagonal-arrow pair (Minimize2/Maximize2) read as
  // "collapse/expand" rather than caption controls, and the restore
  // state reused the minimize glyph when maximized. `Copy` stays the
  // distinct restore glyph (two overlapping squares) so minimize and
  // restore can never look identical.
  const maximizeLabel = maximized ? "Restore window" : "Maximize window";

  return (
    // Phase 14.1 — the caption strip is a GlassChromeBar at the
    // standardized title-bar height (--chrome-titlebar-h, 44px). The
    // `.titlebar` class stays on the element (it IS the window-drag
    // region + the frosted caption glass) and GlassChromeBar adds the
    // shared glass-chrome height/centering contract.
    <GlassChromeBar variant="titleBar" className="titlebar" data-titlebar>
      {/* Phase 105 (chunk C) — the brand leads the 48px title row, before the
          File menu, so the row reads brand, File, document actions, drag
          region, utilities, caption controls. */}
      <div className="brand">
        <BrandMark size={18} className="brand-mark" />
        <BrandWordmark className="brand-name" />
      </div>
      {/* Menu button — leading edge, hidden when no groups are wired. */}
      {menuGroups !== undefined && menuGroups.length > 0 && (
        <div className="titlebar-menu">
          <Button
            ref={menuButtonRef}
            intent="secondary"
            kind="disclosure"
            density="compact"
            // Phase 91 — canonical control; the legacy classes stay as
            // layout/e2e aliases. `titlebar-menu-button-active` remains the
            // joined-corner open alias.
            className={menuOpen ? "titlebar-menu-button titlebar-menu-file titlebar-menu-button-active" : "titlebar-menu-button titlebar-menu-file"}
            onClick={(): void => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="File menu"
            title="File menu"
            data-menu-button
          >
            {/* Phase 36 (chunk 6) — the hamburger becomes an explicit "File"
                label. The popover, its groups and every entry are unchanged;
                only the trigger's face changed. `data-menu-button` stays so
                the existing selectors keep resolving. */}
            <span className="titlebar-menu-label">File</span>
            <Icon name="headerMenuDisclosure" size="md" aria-hidden />
          </Button>
          {/* TFL-975 (TFL-855 chunk C5) — the File menu is the shared
              `CommandMenu` primitive. It emits the SHIPPED `.titlebar-menu-*`
              DOM contract verbatim (popover shell, headings, separators,
              `data-menu-action` rows with their `.kbd` accelerator) and owns
              outside-click dismiss, Escape, first-focus and
              focus-return-to-opener, so TitleBar keeps no bespoke menu
              plumbing. The popover enters with the shared `TfMenu` motion
              (standard menu enter + reduced-motion) in place of the retired
              FLIP morph. */}
          <AnimatePresence>
            <CommandMenu
              open={menuOpen}
              groups={menuGroups !== undefined ? toCommandGroups(menuGroups) : []}
              ariaLabel="Application menu"
              onClose={(): void => setMenuOpen(false)}
              onSelect={onMenuEntry}
              openerRef={menuButtonRef}
            />
          </AnimatePresence>
        </div>
      )}

      {/* Host slot — the AppHeader (brand + tabs + actions) lives here. */}
      <div className="titlebar-slot">{children}</div>

      {/* Window controls — trailing edge. */}
      <div className="titlebar-controls" data-titlebar-controls>
        <button
          type="button"
          className="btn btn-ghost btn-icon titlebar-control titlebar-control-min"
          onClick={onMinimize}
          aria-label="Minimize window"
          title="Minimize"
          data-window-minimize
        >
          <Icon name="windowMinimize" size="md" aria-hidden />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon titlebar-control titlebar-control-max"
          onClick={onMaximize}
          aria-label={maximizeLabel}
          title={maximizeLabel}
          data-window-maximize
        >
          <Icon name={maximized ? "windowRestore" : "windowMaximize"} size="md" aria-hidden />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-icon titlebar-control titlebar-control-close"
          onClick={onClose}
          aria-label="Close window"
          title="Close"
          data-window-close
        >
          <Icon name="windowClose" size="md" aria-hidden />
        </button>
      </div>
    </GlassChromeBar>
  );
}