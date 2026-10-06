// TFL-901 (TFL-855 chunk C2c) — CommandMenu primitive.
//
// The ONE shared command-menu surface. It renders the SHIPPED title-bar menu
// DOM contract verbatim where it applies (the `titlebar-menu-popover` shell,
// `titlebar-menu-heading`, `titlebar-menu-sep`, and the `btn btn-ghost
// titlebar-menu-row` action row with its `.kbd` accelerator and
// `data-menu-action` hook) so an adopter can swap in without losing a single
// e2e selector, then adds the capabilities the spec needs: toggle rows
// (`menuitemcheckbox` + `aria-checked`), nested submenus, accessible disabled
// reasons, and a real menu keyboard model. Built on the shared `TfMenu`
// motion wrapper so reduced-motion / exit-inert stay centrally driven.
//
// NONMODAL: no backdrop, no focus trap. An outside pointerdown dismisses
// without swallowing the underlying gesture; Escape closes; focus returns to
// the opener. Navigation is scoped to the focused row list, and nested levels
// own their own keys.
//
// The model is a SUPERSET of the shipped `MenuEntry` / `MenuGroup` in
// TitleBar.tsx with the SAME field names (`id` / `label` / `accelerator` /
// `action` / `icon` / `onSelect` / `disabled`) plus `checked`, `submenu` and
// `disabledReason`. This file does NOT touch TitleBar; the pilot owns adoption.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  ReactElement,
  RefObject,
} from "react";
import { AnimatePresence } from "motion/react";
import { Icon } from "../icons/Icon";
import type { QuietIconId } from "../icons/quietPrecision";
import { TfMenu } from "./motion/TfMotion";

/** A command-menu entry. Superset of the shipped `MenuEntry`. */
export interface CommandMenuItem {
  /** Stable id; React key + the fallback `data-menu-action`. */
  id: string;
  /** Visible label, e.g. "Save". */
  label: string;
  /** Shortcut text rendered as a `.kbd` chip, e.g. "Ctrl+S". */
  accelerator?: string;
  /** The action string the adopter's dispatcher understands. */
  action?: string;
  /** Quiet Precision glyph id, rendered left of the label. */
  icon?: QuietIconId;
  /** Direct handler fallback, used when the menu-level `onSelect` is absent. */
  onSelect?: (item: CommandMenuItem) => void;
  /** Renders the row unavailable. */
  disabled?: boolean;
  /** Toggle row: renders `menuitemcheckbox` + `aria-checked`. */
  checked?: boolean;
  /** Nested menu opened on Right/Enter/click. */
  submenu?: CommandMenuItem[];
  /** Human reason the row is unavailable; exposed via `title` + `aria-describedby`. */
  disabledReason?: string;
  /** Row emphasis. `"danger"` adds the generic `command-menu-row-danger` class
   *  and `data-menu-variant="danger"`; adopters that own a legacy red-ink class
   *  add it via `rowClassName` so the primitive stays surface-agnostic. */
  variant?: "danger";
  /** Extra class names appended to the row button. Lets an adopter keep a
   *  legacy row selector/class (e.g. `context-menu-item`) across a migration
   *  without CommandMenu knowing the surface. Additive; default none. */
  rowClassName?: string;
  /** Extra `data-*` attributes spread onto the row button. Lets an adopter
   *  keep a legacy per-row hook (e.g. `data-menu-item`) alive. Additive. */
  rowDataAttrs?: Record<string, string>;
}

/** A labelled section of the menu. Superset of the shipped `MenuGroup`. */
export interface CommandMenuGroup {
  /** Stable id; React key. */
  id: string;
  /** Section heading (e.g. "File"). Non-interactive. */
  label: string;
  /** Rows inside this group. */
  entries: CommandMenuItem[];
}

export interface CommandMenuProps {
  /** True while the surface is mounted. */
  open: boolean;
  /** The menu content. */
  groups: CommandMenuGroup[];
  /** Accessible name for the root `role="menu"`. */
  ariaLabel: string;
  /** Dismiss request (Escape, outside click, row activation). */
  onClose?: () => void;
  /** Activation handler; falls back to `item.onSelect`. */
  onSelect?: (item: CommandMenuItem) => void;
  /** Which edge the surface is anchored to. */
  align?: "start" | "end";
  /** Optional fixed width in CSS px; otherwise the token width is used. */
  width?: number;
  /** Extra class names on the root surface. */
  className?: string;
  /** Emitted as `data-testid`. */
  testId?: string;
  /** Optional opener (trigger) element. A pointerdown whose target is inside
   *  it is exempt from the outside-dismiss, so the trigger's own click toggle
   *  can collapse the open menu instead of a dismiss-then-reopen race. */
  openerRef?: RefObject<HTMLElement | null>;
  /** Optional root-surface ref. An adopter that keeps its own outside-dismiss
   *  or measurement wiring across a migration can observe the rendered surface
   *  (e.g. `ref.current.contains(target)`). Additive; default none, and the
   *  primitive's own dismissal / placement is unaffected. */
  popoverRef?: RefObject<HTMLDivElement | null>;
  /** Optional extra `data-*` attributes spread onto the root surface. Lets an
   *  adopter keep a legacy selector hook (e.g. `data-app-menu-popover`) alive
   *  across a migration without altering the shipped DOM contract. */
  popoverDataAttrs?: Record<string, string>;
  /** Optional fixed pointer anchor in CSS px. When set, the surface is
   *  `position: fixed` at these coordinates (pre-clamped by the caller)
   *  instead of the default flow/anchored placement. Additive; default
   *  `undefined` keeps today's flow positioning. */
  position?: { left: number; top: number };
  /** Dismiss when any scroll happens (capture phase, never swallowing the
   *  event). Additive; default `false` keeps today's scroll-agnostic menus. */
  dismissOnScroll?: boolean;
}

/** One rendered line of a menu level: a heading, a separator, or an action row. */
type FlatRow =
  | { kind: "heading"; key: string; label: string }
  | { kind: "sep"; key: string }
  | { kind: "row"; key: string; item: CommandMenuItem };

/** A visual rule, not an action: no action, no handler, no submenu. */
function isSeparator(item: CommandMenuItem): boolean {
  return (
    item.action === undefined &&
    item.onSelect === undefined &&
    item.submenu === undefined
  );
}

/** Flatten a nested item list (used for submenus). */
function flattenItems(items: readonly CommandMenuItem[], baseKey: string): FlatRow[] {
  const out: FlatRow[] = [];
  items.forEach((item, index) => {
    const key = `${baseKey}-${index}`;
    if (isSeparator(item)) {
      out.push({ kind: "sep", key });
      return;
    }
    out.push({ kind: "row", key, item });
  });
  return out;
}

/** Flatten groups into headings, separators and rows. Pure; testable alone. */
export function flattenCommandGroups(groups: readonly CommandMenuGroup[]): FlatRow[] {
  const out: FlatRow[] = [];
  for (const group of groups) {
    out.push({ kind: "heading", key: `${group.id}-h`, label: group.label });
    for (const item of group.entries) {
      const key = `${group.id}-${item.id}`;
      if (isSeparator(item)) {
        out.push({ kind: "sep", key });
        continue;
      }
      out.push({ kind: "row", key, item });
    }
  }
  return out;
}

/** The focusable, non-disabled rows of ONE menu level. Reads only the level's
 *  own direct `.command-menu-row-wrap` children so a nested submenu's rows
 *  never leak into the parent's arrow traversal. */
function enabledRows(list: HTMLElement | null): HTMLButtonElement[] {
  if (list === null) return [];
  const out: HTMLButtonElement[] = [];
  for (const child of Array.from(list.children)) {
    if (!child.classList.contains("command-menu-row-wrap")) continue;
    const button = child.querySelector<HTMLButtonElement>(".titlebar-menu-row");
    if (button !== null && button.disabled !== true) out.push(button);
  }
  return out;
}

/** A DOM-id-safe description id for a row's `aria-describedby`. */
function descIdFor(baseKey: string, index: number): string {
  return `command-menu-desc-${baseKey}-${index}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

interface MenuListProps {
  rows: FlatRow[];
  /** Stable prefix for this level's row keys + description ids. */
  baseKey: string;
  isRoot: boolean;
  /** Root supplies the outer list ref used for first-focus + height clamping. */
  listRef?: RefObject<HTMLDivElement | null>;
  onActivate: (item: CommandMenuItem, key: string) => void;
  /** Escape / Left at this level: root closes the menu, nested closes itself. */
  onDismiss: () => void;
}

/** One menu level. Owns its nested-submenu state and its own keyboard model.
 *  Rendered recursively; every non-root level stops key propagation so the
 *  parent level never double-handles the same event. */
function MenuList(props: MenuListProps): ReactElement {
  const { rows, baseKey, isRoot, listRef, onActivate, onDismiss } = props;
  const localRef = useRef<HTMLDivElement | null>(null);
  const listEl = listRef ?? localRef;
  const [openChildKey, setOpenChildKey] = useState<string | null>(null);

  // A freshly mounted nested submenu takes focus on its first row.
  useEffect(() => {
    if (isRoot) return;
    enabledRows(listEl.current)[0]?.focus();
  }, [isRoot, listEl]);

  const move = (delta: number): void => {
    const rowsEl = enabledRows(listEl.current);
    if (rowsEl.length === 0) return;
    const index = rowsEl.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      index === -1
        ? delta > 0
          ? 0
          : rowsEl.length - 1
        : (index + delta + rowsEl.length) % rowsEl.length;
    rowsEl[next].focus();
  };

  const dismissChild = (): void => {
    const key = openChildKey;
    setOpenChildKey(null);
    if (key === null) return;
    listEl.current
      ?.querySelector<HTMLButtonElement>(`[data-menu-key="${key}"]`)
      ?.focus();
  };

  const itemFor = (key: string | null): CommandMenuItem | undefined => {
    if (key === null) return undefined;
    for (const row of rows) {
      if (row.kind === "row" && row.key === key) return row.item;
    }
    return undefined;
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    // A nested level owns its keys; never let them reach the parent list.
    if (!isRoot) event.stopPropagation();
    const active = document.activeElement;
    const currentKey =
      active instanceof HTMLElement ? active.getAttribute("data-menu-key") : null;
    const currentItem = itemFor(currentKey);

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        return;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        return;
      case "Home": {
        event.preventDefault();
        enabledRows(listEl.current)[0]?.focus();
        return;
      }
      case "End": {
        event.preventDefault();
        const enabled = enabledRows(listEl.current);
        enabled[enabled.length - 1]?.focus();
        return;
      }
      case "ArrowRight":
        if (currentItem?.submenu !== undefined && currentKey !== null) {
          event.preventDefault();
          setOpenChildKey(currentKey);
        }
        return;
      case "ArrowLeft":
        if (openChildKey !== null) {
          event.preventDefault();
          dismissChild();
        } else if (!isRoot) {
          event.preventDefault();
          onDismiss();
        }
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        if (currentItem !== undefined && currentKey !== null) {
          if (currentItem.submenu !== undefined) setOpenChildKey(currentKey);
          else onActivate(currentItem, currentKey);
        }
        return;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        if (openChildKey !== null) dismissChild();
        else onDismiss();
        return;
      case "Tab":
        // Tab-close parity: letting focus walk out of an open menu would
        // orphan it (the application menu closed on Tab before adopting this
        // primitive). Dismissing here routes through the level's onDismiss,
        // so the root closes and focus returns to the opener.
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
        return;
      default:
        return;
    }
  };

  return (
    <>
      <div
        ref={listEl}
        className="command-menu-list"
        onKeyDown={onKeyDown}
        data-menu-level={isRoot ? "root" : "submenu"}
      >
        {rows.map((row, index) => {
          if (row.kind === "heading") {
            return (
              <div key={row.key} className="titlebar-menu-heading" role="presentation">
                {row.label}
              </div>
            );
          }
          if (row.kind === "sep") {
            return (
              <div
                key={row.key}
                className="titlebar-menu-sep"
                role="separator"
                aria-hidden
              />
            );
          }
          const item = row.item;
          const glyph = item.icon;
          const isChecked = item.checked !== undefined;
          const hasSubmenu = item.submenu !== undefined;
          const descId = item.disabledReason === undefined
            ? undefined
            : descIdFor(baseKey, index);
          return (
            <div key={row.key} className="command-menu-row-wrap">
              <button
                type="button"
                className={[
                  "btn",
                  "btn-ghost",
                  "titlebar-menu-row",
                  item.variant === "danger" ? "command-menu-row-danger" : undefined,
                  item.rowClassName,
                ]
                  .filter((part): part is string => part !== undefined && part !== "")
                  .join(" ")}
                role={isChecked ? "menuitemcheckbox" : "menuitem"}
                aria-checked={isChecked ? item.checked === true : undefined}
                onClick={(): void => {
                  if (item.disabled === true) return;
                  if (hasSubmenu) {
                    setOpenChildKey(row.key);
                    return;
                  }
                  onActivate(item, row.key);
                }}
                disabled={item.disabled === true}
                data-menu-action={item.action ?? item.id}
                data-menu-key={row.key}
                data-menu-variant={item.variant}
                title={item.disabledReason}
                aria-describedby={descId}
                {...item.rowDataAttrs}
              >
                <span className="titlebar-menu-row-label">
                  {glyph !== undefined && (
                    <Icon
                      name={glyph}
                      size="md"
                      aria-hidden
                      className="titlebar-menu-row-icon"
                    />
                  )}
                  {isChecked === true && item.checked === true && (
                    <Icon
                      name="menuCheck"
                      size="md"
                      aria-hidden
                      className="titlebar-menu-row-icon command-menu-row-check"
                    />
                  )}
                  <span>{item.label}</span>
                </span>
                {item.accelerator !== undefined && (
                  <span className="kbd titlebar-menu-row-kbd">{item.accelerator}</span>
                )}
                {hasSubmenu && (
                  <Icon
                    name="headerMenuDisclosure"
                    size="md"
                    aria-hidden
                    className="command-menu-row-chevron"
                  />
                )}
                {descId !== undefined && (
                  <span id={descId} className="command-menu-row-desc">
                    {item.disabledReason}
                  </span>
                )}
              </button>
              {hasSubmenu && openChildKey === row.key && item.submenu !== undefined && (
                <div
                  className="command-menu-submenu"
                  role="menu"
                  aria-label={item.label}
                  data-menu-submenu
                >
                  <MenuList
                    rows={flattenItems(item.submenu, row.key)}
                    baseKey={row.key}
                    isRoot={false}
                    onActivate={onActivate}
                    onDismiss={dismissChild}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

export function CommandMenu(props: CommandMenuProps): ReactElement {
  const {
    open,
    groups,
    ariaLabel,
    onClose,
    onSelect,
    align = "start",
    width,
    className,
    testId,
    openerRef,
    popoverRef,
    popoverDataAttrs,
    position,
    dismissOnScroll = false,
  } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const rootListRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const focusSeededRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // The root surface is surfaced to the primitive's own logic through `rootRef`
  // and to an optional adopter ref through `popoverRef` via one callback ref,
  // so an adopter can keep its own outside-dismiss / measurement wiring across
  // a migration without forking the primitive.
  const setRootRef = useCallback(
    (node: HTMLDivElement | null): void => {
      rootRef.current = node;
      if (popoverRef !== undefined) popoverRef.current = node;
    },
    [popoverRef],
  );

  const dismiss = useCallback((): void => {
    onCloseRef.current?.();
  }, []);

  const activate = useCallback((item: CommandMenuItem): void => {
    if (item.disabled === true) return;
    if (onSelectRef.current !== undefined) onSelectRef.current(item);
    else item.onSelect?.(item);
    onCloseRef.current?.();
  }, []);

  // First focus + focus restore. The opener is whatever held focus when the
  // surface opened; it is captured BEFORE the first row is focused and
  // refocused on close when it still exists. `focusSeededRef` keeps a re-run
  // (or a re-mount while already open) from stealing focus back to row one
  // after a close restored it to the opener.
  useLayoutEffect(() => {
    if (!open) {
      focusSeededRef.current = false;
      const target = returnFocusRef.current;
      if (target !== null && document.contains(target)) target.focus();
      return undefined;
    }
    if (focusSeededRef.current) return undefined;
    focusSeededRef.current = true;
    // Prefer the declared opener as the focus-return target: a menu opened from
    // a trigger must hand focus back to that trigger even when the trigger was
    // not the active element at open time (a synthetic click, or a host that
    // opens the menu programmatically). Falls back to the captured active
    // element when no opener is wired.
    const active = document.activeElement;
    const opener = openerRef?.current ?? null;
    returnFocusRef.current =
      opener !== null && document.contains(opener)
        ? opener
        : active instanceof HTMLElement
          ? active
          : null;
    enabledRows(rootListRef.current)[0]?.focus();
    return undefined;
  }, [open, openerRef]);

  // Outside pointerdown dismisses WITHOUT swallowing the gesture underneath.
  // The opener (trigger) is exempt: a real click on it fires pointerdown (here)
  // then click (the trigger's own toggle), so treating the trigger as outside
  // would close the menu and the following click would reopen it — net still
  // open. Exempting the opener lets the trigger's toggle collapse the menu.
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node) {
        if (rootRef.current?.contains(target) === true) return;
        if (openerRef?.current?.contains(target) === true) return;
      }
      onCloseRef.current?.();
    };
    window.addEventListener("pointerdown", onPointer);
    return (): void => window.removeEventListener("pointerdown", onPointer);
  }, [open, openerRef]);

  // Optional scroll dismissal (pointer-anchored menus that must not detach
  // from their trigger when the surface scrolls). A capture-phase scroll
  // listener catches scrolls on descendants without swallowing anything:
  // it never preventDefaults, so the scrolling gesture proceeds untouched.
  useEffect(() => {
    if (!open || dismissOnScroll !== true) return undefined;
    const onScroll = (): void => onCloseRef.current?.();
    document.addEventListener("scroll", onScroll, true);
    return (): void => document.removeEventListener("scroll", onScroll, true);
  }, [open, dismissOnScroll]);

  // Escape while focus is OFF the row list (e.g. after clicking the heading or
  // padding, focus lands on `document.body`) never reaches the list's React
  // handler, so bind a window-level fallback. Anything inside the surface is
  // left to the list handler — its `stopPropagation` keeps nested submenus
  // routing to their parent row and this guard prevents a double-dismiss.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target) === true) return;
      event.preventDefault();
      onCloseRef.current?.();
    };
    window.addEventListener("keydown", onKey);
    return (): void => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Clamp the ROW LIST to the available space (never the whole surface) so the
  // bottom command is scrollable rather than silently clipped; flip the
  // placement hint near the bottom edge.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const list = rootListRef.current;
    const root = rootRef.current;
    if (list === null || root === null) return undefined;
    const clamp = (): void => {
      const rect = root.getBoundingClientRect();
      const margin = 16;
      const below = window.innerHeight - rect.top - margin;
      const above = rect.bottom - margin;
      const placement = above > below ? "above" : "below";
      const ceiling = placement === "above" ? above : below;
      const max = Math.max(160, Math.min(560, ceiling));
      list.style.maxHeight = `${max}px`;
      root.dataset.placement = placement;
    };
    clamp();
    window.addEventListener("resize", clamp);
    return (): void => window.removeEventListener("resize", clamp);
  }, [open]);

  const groupRows = flattenCommandGroups(groups);
  const classes = [
    "titlebar-menu-popover",
    "command-menu",
    align === "end" ? "command-menu-align-end" : undefined,
    className,
  ]
    .filter((part): part is string => part !== undefined && part !== "")
    .join(" ");
  const style: CSSProperties = {
    ...(width === undefined ? {} : { width: `${width}px` }),
    ...(position === undefined
      ? {}
      : {
          position: "fixed",
          left: position.left,
          top: position.top,
        }),
  };

  return (
    <AnimatePresence>
      {open ? (
        <TfMenu
          ref={setRootRef}
          className={classes}
          role="menu"
          aria-label={ariaLabel}
          data-menu-popover
          data-testid={testId}
          style={style}
          {...popoverDataAttrs}
        >
          <MenuList
            rows={groupRows}
            baseKey="root"
            isRoot
            listRef={rootListRef}
            onActivate={activate}
            onDismiss={dismiss}
          />
        </TfMenu>
      ) : null}
    </AnimatePresence>
  );
}
