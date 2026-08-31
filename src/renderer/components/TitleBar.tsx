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
// next to the brand) exposes every File / Edit / View / Tools /
// Window / Help menu action as a labelled row with its accelerator.
// Native menu accelerators still own the shortcuts — the popover is a
// discoverability surface, not an alternate input path. The popover
// is keyboard-accessible (Escape closes, Enter activates, Tab walks
// rows), and clicking outside closes it (same click-outside pattern
// the annotation palette uses).
//
// Three render-tree rules baked into this component that you must
// preserve:
//
//   1. Hooks are always at the TOP of the component, above any early
//      return. We have no early returns here, but a future feature
//      that gates on `disabled` will trip React's hook-order check if
//      a hook moves below such a branch.
//
//   2. NO emojis anywhere — the brand mark stays a text "TF" glyph in
//      a 4x4 rounded square so it reads as a deliberate logotype
//      instead of a pictogram.
//
//   3. The `-webkit-app-region` CSS contract: this component sets
//      `drag` on its outer container (CSS rule on `.app-header`),
//      and `no-drag` on every interactive child (CSS rule on
//      `.app-header > *`). No JS toggles this — it is a stylesheet
//      contract that survives React re-renders.

import {
  Maximize2,
  Menu,
  Minimize2,
  type LucideIcon,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { dispatchMenuAction, type MenuActionContext } from "../state/menuActions";

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
  /** Rendered as a Lucide icon to the left of the label. Optional —
   *  the popover stays text-only when omitted. */
  icon?: LucideIcon;
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
      if (entry.action === undefined) {
        out.push({ kind: "sep", key: `${g.id}-${entry.id}` });
        continue;
      }
      out.push({ kind: "row", key: `${g.id}-${entry.id}`, entry });
    }
  }
  return out;
}

export function TitleBar(props: TitleBarProps): ReactElement {
  // Hooks above any conditional. We don't have an early return; this
  // rule is pinned by the mistakes-notes for future-proofing.
  const { menuGroups, menuContext, maximized = false, children } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuPopoverRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape. Mirrors the annotation palette's
  // click-outside contract: a global pointerdown listener that
  // checks both the trigger button and the popover for hits.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: PointerEvent): void => {
      const t = e.target as Node | null;
      if (t === null) return;
      if (menuButtonRef.current?.contains(t)) return;
      if (menuPopoverRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return (): void => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

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
    (entry: MenuEntry): void => {
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

  const flattened = menuGroups !== undefined ? flattenMenuGroups(menuGroups) : [];

  const MaximizeIcon = maximized ? Minimize2 : Maximize2;
  const maximizeLabel = maximized ? "Restore window" : "Maximize window";

  return (
    <div className="titlebar" data-titlebar>
      {/* Menu button — leading edge, hidden when no groups are wired. */}
      {menuGroups !== undefined && menuGroups.length > 0 && (
        <div className="titlebar-menu">
          <button
            ref={menuButtonRef}
            type="button"
            className={menuOpen ? "titlebar-menu-button titlebar-menu-button-active" : "titlebar-menu-button"}
            onClick={(): void => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Application menu"
            title="Application menu"
            data-menu-button
          >
            <Menu size={15} aria-hidden />
          </button>
          {menuOpen && (
            <div
              ref={menuPopoverRef}
              className="titlebar-menu-popover"
              role="menu"
              aria-label="Application menu"
              data-menu-popover
            >
              {flattened.map((item) => {
                if (item.kind === "heading") {
                  return (
                    <div
                      key={item.key}
                      className="titlebar-menu-heading"
                      role="presentation"
                    >
                      {item.label}
                    </div>
                  );
                }
                if (item.kind === "sep") {
                  return (
                    <div
                      key={item.key}
                      className="titlebar-menu-sep"
                      role="separator"
                      aria-hidden
                    />
                  );
                }
                const entry = item.entry;
                const Icon = entry.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    className="titlebar-menu-row"
                    role="menuitem"
                    onClick={(): void => onMenuEntry(entry)}
                    data-menu-action={entry.action ?? entry.id}
                  >
                    <span className="titlebar-menu-row-label">
                      {Icon !== undefined && (
                        <Icon size={14} aria-hidden className="titlebar-menu-row-icon" />
                      )}
                      <span>{entry.label}</span>
                    </span>
                    {entry.accelerator !== undefined && (
                      <span className="kbd titlebar-menu-row-kbd">{entry.accelerator}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Host slot — the AppHeader (brand + tabs + actions) lives here. */}
      <div className="titlebar-slot">{children}</div>

      {/* Window controls — trailing edge. */}
      <div className="titlebar-controls" data-titlebar-controls>
        <button
          type="button"
          className="titlebar-control titlebar-control-min"
          onClick={onMinimize}
          aria-label="Minimize window"
          title="Minimize"
          data-window-minimize
        >
          <Minimize2 size={12} aria-hidden />
        </button>
        <button
          type="button"
          className="titlebar-control titlebar-control-max"
          onClick={onMaximize}
          aria-label={maximizeLabel}
          title={maximizeLabel}
          data-window-maximize
        >
          <MaximizeIcon size={12} aria-hidden />
        </button>
        <button
          type="button"
          className="titlebar-control titlebar-control-close"
          onClick={onClose}
          aria-label="Close window"
          title="Close"
          data-window-close
        >
          <X size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}