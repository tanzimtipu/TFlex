// Phase 37 (chunk 5, item 19) — the shared thumbnail RIGHT-CLICK MENU.
//
// The single-mode PAGES ContextPanel and the Multi Mode per-pane strips must
// offer the SAME page options. This module is the ONE home for the menu's
// data (the six verbs), the viewport clamp and the anchored popover, so the
// multi-mode strips re-parent the single-mode machinery instead of forking
// it. The menu markup/classes are byte-identical to the pre-chunk-5 menu:
// every existing CSS/e2e selector (`[data-context-menu]`, `[data-menu-item]`)
// keeps resolving on both surfaces.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ThumbContextMenuHandler } from './SideRail';

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
 * The shared menu controller. Callers supply their page verbs; the hook owns
 * the menu's own state, dismissal (Esc / outside pointerdown / scroll, never
 * swallowing the event) and the viewport clamp.
 */
export function usePageThumbMenu(handlers: PageMenuHandlers): PageThumbMenuController {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const openMenu = useCallback((page: number, x: number, y: number): void => {
    setMenu({ page, x, y });
  }, []);

  // Dismissal: Esc, a pointerdown outside the menu, and any scroll. None of
  // these swallow the event (no preventDefault / stopPropagation): an
  // outside press still reaches its own target, so dismissing the menu can
  // never eat a thumbnail click or a panel control (AGENTS cross-bubbling).
  useEffect((): (() => void) | undefined => {
    if (menu === null) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenu(null);
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target) === true) return;
      setMenu(null);
    };
    const onScroll = (): void => setMenu(null);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('scroll', onScroll, true);
    return (): void => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [menu]);

  // Clamp the menu into the viewport once it is measured. The fallback box
  // keeps the clamp meaningful before layout (or in jsdom).
  useEffect((): void => {
    if (menu === null) {
      setMenuPos(null);
      return;
    }
    const el = menuRef.current;
    const w = el === null || el.offsetWidth === 0 ? MENU_W : el.offsetWidth;
    const h = el === null || el.offsetHeight === 0 ? MENU_H : el.offsetHeight;
    setMenuPos(
      clampMenuPosition(menu.x, menu.y, w, h, window.innerWidth, window.innerHeight),
    );
  }, [menu]);

  const menuNode =
    menu === null || menuPos === null ? null : (
      <div
        ref={menuRef}
        className="context-menu anim-menu-pop"
        role="menu"
        aria-label={`Page ${menu.page} actions`}
        data-context-menu
        data-page={menu.page}
        style={{ left: menuPos.left, top: menuPos.top }}
      >
        <div className="context-menu-title">Page {menu.page}</div>
        {buildPageMenuItems(menu.page, handlers).map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={item.danger === true ? 'context-menu-item context-menu-item-danger' : 'context-menu-item'}
            data-menu-item={item.id}
            onClick={(): void => {
              setMenu(null);
              item.run();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    );

  return { openMenu, menuNode };
}