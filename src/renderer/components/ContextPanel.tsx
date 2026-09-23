// Phase 36 (chunk 2) — the PAGES stage's ContextPanel.
//
// The STAGES information architecture replaces the rail's tab strip with one
// stage-owned panel per stage. This chunk builds ONLY the PAGES panel, and it
// is built ALONGSIDE the existing SideRail (behind the temporary dev flag
// documented in `state/devFlags.ts`) so the two surfaces can be compared
// side by side before the rail is retired in a later chunk. Nothing here
// retires, rewrites or alters the rail: the thumbnail stack, the outline
// tree, the drag system, the selection and every engine op are the SAME
// components/code paths the rail already uses.
//
// RE-PARENTING (not reimplementation):
//   - ThumbnailRail (SideRail.tsx) owns the live-rendered previews, the
//     buffered-slot virtualization, the offscreen atomic swap (DEF-222/274),
//     the drag-reorder/drop indicators, the current-page highlight, the
//     scroll sync and the selection action bar. The panel only supplies the
//     same props the rail supplies, plus two OPTIONAL additions (the hover
//     verbs and the right-click hook) that render only when provided.
//   - OutlinePanel (SideRail.tsx) is the same tree, re-parented below the
//     thumbnails in a collapsible section.
//
// The panel owns exactly one piece of state of its own: which page's
// right-click menu is open and where. Page state, selection and engine ops
// all belong to the host (DocumentView/App) and are threaded through.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { OutlinePanel, ThumbnailRail } from './SideRail';
import type { ThumbContextMenuHandler, ThumbVerbs } from './SideRail';
import { GlassSidebarBody, GlassSidebarHeader } from './GlassSidebar';
import { buildPageLabelMap } from './pageGeometry';
import type { EngineState } from '../engine/types';
import type { OutlineNode } from '../pdf/pdfjs';
import type { PageDropOp } from '../state/pageDrag';

export interface ContextPanelProps {
  doc: PDFDocumentProxy;
  /** The 1-based VISIBLE page the canvas is showing (scroll sync). The LIVE
   *  page count comes from `engineState.pageCount` — one source of truth, so
   *  the header's `Pages · N` can never drift from the thumbnails. */
  currentPage: number;
  defaultWidthPt: number;
  defaultHeightPt: number;
  /** DEF-148 — per-visible-page sizes reported by the mounted PageViews. */
  pageSizes?: Map<number, { w: number; h: number }> | null;
  /** Live engine state: pageCount, pageOrder (reorder), rotations,
   *  deleted, pageLabels. The panel and the rail read the SAME object. */
  engineState: EngineState;
  /** DEF-139 — the proxy is in visible file order after a bytes refresh. */
  proxyVisibleOrder?: boolean;
  canUndo: boolean;
  /** The rail's engine callbacks: the panel adds no op of its own. */
  onOp?: (op: { kind: 'rotate'; page: number; dir: 'cw' | 'ccw' }) => void;
  onDelete?: (pages: number[]) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  onUndo?: () => void;
  onJump: (page: number) => void;
  outline: OutlineNode[] | null;
  onError?: (message: string) => void;
  /** Header — the EXISTING merge entry (the CommandBar's handler). */
  onMerge?: () => void;
/** Right-click menu verbs — the host's EXISTING surfaces for each. Each
   *  receives the VISIBLE 1-based page the gesture landed on. */
  onExtractPages?: (page: number) => void;
  /** "Insert blank after" — an IMMEDIATE action: the host inserts a blank
   *  page directly after the clicked visible page (engine `insertBlankPage`
   *  with afterIndex = page - 1). No dialog. */
  onInsertBlank?: (page: number) => void;
  onReplacePages?: (page: number) => void;
  onRenumberPages?: (page: number) => void;
  /** "Delete…" — the ellipsis promises a dialog, so this opens the host's
   *  EXISTING delete-pages dialog seeded with the clicked page. The thumbnail
   *  hover trash verb is a DIFFERENT path: it stays an immediate per-page
   *  delete through `onDelete([page])`. */
  onDeletePage?: (page: number) => void;
  /** Phase 32's cross-document drag wiring, threaded exactly as the Multi
   *  Mode strips thread it. `null` in single mode, where ThumbnailRail keeps
   *  its pre-Phase-32 intra-document drag semantics byte-for-byte. */
  crossDoc?: { tabId: string; onDrop: (op: PageDropOp) => void } | null;
  /** Dev-mount marker: renders the unmistakable DEV badge on the header.
   *  Only the `?tfStagePanel=1` scaffolding sets it. */
  dev?: boolean;
}

/** Fallback menu box used when the platform reports no layout (jsdom, or the
 *  first frame before the menu is measured). Only affects the clamp. */
const MENU_W = 184;
const MENU_H = 212;

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
  onRenumber: (page: number) => void;
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

/** The right-click menu's seven items, as data: the component renders them
 *  and the tests assert both the list and the handler each one calls. */
export function buildPageMenuItems(page: number, h: PageMenuHandlers): PageMenuItem[] {
  return [
    { id: 'rotate-cw', label: 'Rotate CW', run: (): void => h.onRotateCw(page) },
    { id: 'rotate-ccw', label: 'Rotate CCW', run: (): void => h.onRotateCcw(page) },
    { id: 'extract', label: 'Extract…', run: (): void => h.onExtract(page) },
    { id: 'insert-blank', label: 'Insert blank after', run: (): void => h.onInsertBlank(page) },
    { id: 'replace', label: 'Replace…', run: (): void => h.onReplace(page) },
    { id: 'renumber', label: 'Renumber…', run: (): void => h.onRenumber(page) },
    { id: 'delete', label: 'Delete…', danger: true, run: (): void => h.onDeletePage(page) },
  ];
}

interface MenuState {
  page: number;
  x: number;
  y: number;
}

/**
 * The PAGES stage panel. Header (`Pages · N` + Combine), then the SAME live
 * thumbnail stack the rail renders, then the collapsible outline section.
 * All document state is owned by the host; this component only routes it.
 */
export function ContextPanel(props: ContextPanelProps): ReactElement {
  const {
    doc,
    currentPage,
    defaultWidthPt,
    defaultHeightPt,
    pageSizes = null,
    engineState,
    proxyVisibleOrder = false,
    canUndo,
    onOp,
    onDelete,
    onReorder,
    onUndo,
    onJump,
    outline,
    onError,
    onMerge,
onExtractPages,
    onInsertBlank,
    onReplacePages,
    onRenumberPages,
    onDeletePage,
    crossDoc = null,
    dev = false,
  } = props;

  const pageCount = engineState.pageCount;
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // The same visible -> source mapping and label map the rail builds, so a
  // reordered or renumbered document renders identically here.
  const visibleToSource = useMemo((): Map<number, number> => {
    const m = new Map<number, number>();
    const order = engineState.pageOrder;
    for (let i = 0; i < order.length; i += 1) {
      m.set(i + 1, order[i] + 1);
    }
    return m;
  }, [engineState.pageOrder]);

  const pageLabelMap = useMemo(
    () => buildPageLabelMap(engineState.pageLabels),
    [engineState.pageLabels],
  );

  // The three inline hover verbs: the EXISTING per-page rotate / extract /
  // delete handlers, called with this thumbnail's visible 1-based page.
  const verbs = useMemo<ThumbVerbs>(
    () => ({
      onRotateCw: (page: number): void => {
        onOp?.({ kind: 'rotate', page, dir: 'cw' });
      },
      onExtract: (page: number): void => {
        onExtractPages?.(page);
      },
      onDelete: (page: number): void => {
        onDelete?.([page]);
      },
    }),
    [onOp, onExtractPages, onDelete],
  );

  const menuItems = useMemo(
    () =>
      menu === null
        ? []
        : buildPageMenuItems(menu.page, {
            onRotateCw: (page: number): void => onOp?.({ kind: 'rotate', page, dir: 'cw' }),
            onRotateCcw: (page: number): void => onOp?.({ kind: 'rotate', page, dir: 'ccw' }),
            onExtract: (page: number): void => onExtractPages?.(page),
            onInsertBlank: (page: number): void => onInsertBlank?.(page),
            onReplace: (page: number): void => onReplacePages?.(page),
onRenumber: (page: number): void => onRenumberPages?.(page),
            onDeletePage: (page: number): void => onDeletePage?.(page),
          }),
    [menu, onOp, onExtractPages, onInsertBlank, onReplacePages, onRenumberPages, onDeletePage],
  );

  const openMenu: ThumbContextMenuHandler = (page, x, y): void => {
    setMenu({ page, x, y });
  };

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

  return (
    <div
      className={dev ? 'context-panel context-panel-dev' : 'context-panel'}
      data-context-panel="pages"
      data-context-panel-stage="pages"
      data-context-panel-dev={dev ? 'true' : undefined}
    >
      <GlassSidebarHeader
        className="context-panel-header"
        title={`Pages · ${pageCount}`}
        actions={
          <div className="context-panel-actions">
            {dev && (
              <span className="context-panel-dev-badge" data-context-panel-dev-badge>
                DEV
              </span>
            )}
            <button
              type="button"
              className="context-panel-combine"
              onClick={(): void => onMerge?.()}
              title="Combine with another PDF"
              aria-label="Combine with another PDF"
              data-context-panel-combine
            >
              <Plus size={12} aria-hidden />
              <span>Combine…</span>
            </button>
          </div>
        }
      />
      <GlassSidebarBody className="context-panel-body">
        {/* The thumbnail stack: the rail's OWN ThumbnailRail, same props,
            same geometry (thumbWidth defaults to THUMB_WIDTH — the chunk
            keeps the current rail width) and the same virtualization. */}
        <div className="context-panel-thumbs" data-context-panel-thumbs>
          <ThumbnailRail
            doc={doc}
            pageCount={pageCount}
            currentPage={currentPage}
            aspectRatio={defaultHeightPt / defaultWidthPt}
            pageSizes={pageSizes}
            rotations={engineState.rotations}
            visibleToSource={visibleToSource}
            proxyVisibleOrder={proxyVisibleOrder}
            pageLabelMap={pageLabelMap}
            canUndo={canUndo}
            onOp={onOp}
            onDelete={onDelete}
            onReorder={onReorder}
            onUndo={onUndo}
            onJump={onJump}
            crossDoc={crossDoc}
            thumbVerbs={verbs}
            onThumbContextMenu={openMenu}
          />
        </div>
        {outline !== null && (
          <section className="context-panel-outline" data-context-panel-outline aria-label="Outline">
            <button
              type="button"
              className="context-panel-section-toggle"
              onClick={(): void => setOutlineOpen((v) => !v)}
              aria-expanded={outlineOpen}
              aria-controls="context-panel-outline-body"
              data-outline-toggle
            >
              {outlineOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
              <span>Outline</span>
            </button>
            {outlineOpen && (
              <div className="context-panel-outline-body" id="context-panel-outline-body" data-context-panel-outline-body>
                <OutlinePanel doc={doc} outline={outline} onJump={onJump} onError={onError} />
              </div>
            )}
          </section>
        )}
        {menu !== null && menuPos !== null && (
          <div
            ref={menuRef}
            className="context-menu"
            role="menu"
            aria-label={`Page ${menu.page} actions`}
            data-context-menu
            data-page={menu.page}
            style={{ left: menuPos.left, top: menuPos.top }}
          >
            <div className="context-menu-title">Page {menu.page}</div>
            {menuItems.map((item) => (
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
        )}
      </GlassSidebarBody>
    </div>
  );
}
