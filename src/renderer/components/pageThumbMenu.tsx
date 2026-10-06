// Phase 37 (chunk 5, item 19) — the shared thumbnail RIGHT-CLICK MENU.
//
// The single-mode PAGES ContextPanel and the Multi Mode per-pane strips must
// offer the SAME page options. This module is the ONE home for the menu's
// data (the six verbs) and the pointer anchor, so the multi-mode strips
// re-parent the single-mode machinery instead of forking it.
//
// TFL-855 chunk C8 — the menu node is now the shared `CommandMenu` primitive
// (mirroring the C5 File menu and C7 application menu). CommandMenu owns
// dismissal, focus and the row keyboard model; this module keeps the legacy
// hooks alive through its additive props: the root carries `[data-context-menu]`
// / `[data-page]` (`popoverDataAttrs` + `position`), and every row carries
// `[data-menu-item]` plus the `.context-menu-item[-danger]` classes
// (`rowDataAttrs` + `rowClassName` + `variant`). Every existing CSS/e2e selector
// keeps resolving on both surfaces.

import { useCallback, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { ThumbContextMenuHandler } from './SideRail';
import { CommandMenu } from './CommandMenu';
import type { CommandMenuGroup, CommandMenuItem } from './CommandMenu';

/** Fallback menu box used when the platform reports no layout (jsdom, or the
 *  first frame before the menu is measured). Only affects the clamp. */
export const MENU_W = 184;
export const MENU_H = 212;

/** Keep a pointer-anchored menu inside the viewport with an 8px gutter. */
export function clampMenuPosition(
  x: number,
  y: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
  margin = 8,
): { left: number; top: number } {
  const maxLeft = Math.max(margin, vw - w - margin);
  const maxTop = Math.max(margin, vh - h - margin);
  return {
    left: Math.min(Math.max(margin, x), maxLeft),
    top: Math.min(Math.max(margin, y), maxTop),
  };
}

export interface PageMenuHandlers {
  onRotateCw: (page: number) => void;
  onRotateCcw: (page: number) => void;
  onExtract: (page: number) => void;
  onInsertBlank: (page: number) => void;
  onReplace: (page: number) => void;
  /** Opens the delete-pages dialog with the clicked page (NOT an immediate
   *  delete — the label's ellipsis promises a dialog). */
  onDeletePage: (page: number) => void;
}

export interface PageMenuItem {
  id: string;
  label: string;
  danger?: boolean;
  run: () => void;
}

/** The right-click menu's SIX items, as data: the component renders them
 *  and the tests assert both the list and the handler each one calls.
 *
 *  Section 3A ruling 2: Renumber… is REMOVED here — the Inspector's
 *  `Label · renumber…` is its only affordance. The menu stays the page-verb
 *  shortcut for rotate / extract / insert / replace / delete. */
export function buildPageMenuItems(page: number, h: PageMenuHandlers): PageMenuItem[] {
  return [
    { id: 'rotate-cw', label: 'Rotate CW', run: (): void => h.onRotateCw(page) },
    { id: 'rotate-ccw', label: 'Rotate CCW', run: (): void => h.onRotateCcw(page) },
    { id: 'extract', label: 'Extract…', run: (): void => h.onExtract(page) },
    { id: 'insert-blank', label: 'Insert blank after', run: (): void => h.onInsertBlank(page) },
    { id: 'replace', label: 'Replace…', run: (): void => h.onReplace(page) },
    { id: 'delete', label: 'Delete…', danger: true, run: (): void => h.onDeletePage(page) },
  ];
}

interface MenuState {
  page: number;
  x: number;
  y: number;
}

export interface PageThumbMenuController {
  /** Hand this to `ThumbnailRail`'s `onThumbContextMenu`. */
  openMenu: ThumbContextMenuHandler;
  /** Render this inside the surface's positioned body (fixed-position menu,
   *  so anywhere in the owning surface is fine). */
  menuNode: ReactElement | null;
}

/**
 * The shared menu controller. Callers supply their page verbs; the menu node is
 * the shared `CommandMenu` primitive (TFL-855 chunk C8), which owns dismissal
 * (Escape / outside pointerdown / scroll), focus capture/return and the row
 * keyboard model. This hook keeps only the page-menu DATA and the pointer
 * anchor: the six verbs converted to `CommandMenuItem`s, and the clamped fixed
 * position (`clampMenuPosition`). The root keeps the legacy `[data-context-menu]`
 * / `[data-page]` hooks and every row keeps `[data-menu-item]` plus the
 * `.context-menu-item[-danger]` classes, so every existing CSS/e2e selector
 * still resolves on both the single-mode panel and the Multi Mode strips.
 */
export function usePageThumbMenu(handlers: PageMenuHandlers): PageThumbMenuController {
  const [menu, setMenu] = useState<MenuState | null>(null);

  const openMenu = useCallback((page: number, x: number, y: number): void => {
    setMenu({ page, x, y });
  }, []);

  const closeMenu = useCallback((): void => {
    setMenu(null);
  }, []);

  const groups = useMemo<CommandMenuGroup[]>(() => {
    if (menu === null) return [];
    const entries: CommandMenuItem[] = buildPageMenuItems(menu.page, handlers).map(
      (item): CommandMenuItem => ({
        id: item.id,
        label: item.label,
        // CommandMenu's `onSelect` runs this, then closes the menu.
        onSelect: (): void => item.run(),
        // Phase 113 (wave E2) — the six context rows on the canonical axes:
        // secondary for the five page verbs, destructive for Delete.
        intent: item.danger === true ? 'destructive' : 'secondary',
        density: 'compact',
        // Keep the per-row `[data-menu-item]` hook and the legacy row classes
        // while the primitive owns the row's behavior and motion.
        rowDataAttrs: { 'data-menu-item': item.id },
        rowClassName:
          item.danger === true
            ? 'context-menu-item context-menu-item-danger'
            : 'context-menu-item',
        ...(item.danger === true ? { variant: 'danger' as const } : {}),
      }),
    );
    return [{ id: 'page', label: `Page ${menu.page}`, entries }];
  }, [menu, handlers]);

  // Clamp the pointer anchor into the viewport. MENU_W/H is the same fallback
  // box the bespoke menu used (it was measured only after first paint, so the
  // fallback always drove the clamp), keeping the math unchanged.
  const menuPos =
    menu === null
      ? null
      : clampMenuPosition(menu.x, menu.y, MENU_W, MENU_H, window.innerWidth, window.innerHeight);

  const menuNode =
    menu === null ? null : (
      <CommandMenu
        open
        groups={groups}
        ariaLabel={`Page ${menu.page} actions`}
        onClose={closeMenu}
        position={menuPos ?? undefined}
        dismissOnScroll
        popoverDataAttrs={{
          'data-context-menu': 'true',
          'data-page': String(menu.page),
        }}
      />
    );

  return { openMenu, menuNode };
}