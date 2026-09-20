// Shared "selectable movable content" interaction set (DEF-152..155,
// DEF-153 unified model).
//
// The operator's Acrobat-style model applies to EVERY placeable kind
// (add box, edit text, textbox, callout, sticky note, rect, ellipse,
// arrow, ink): hover -> palm/grab cursor; single click -> select and
// make MOVABLE (a Confirm / Edit / Delete action bar + resize handles
// where applicable); double click -> the full edit toolbox; while
// selected/movable a cursor-attached "Double click to edit" hint.
//
// This module is the ONE shared implementation:
//   - `useSelectableDrag` — the move/resize gesture tracker (pure
//     rect math, reused by the annotation overlay, the edit overlay
//     and the text-run selection; identical drag semantics
//     everywhere).
//   - `ContentActionBar` — the shared Confirm / Edit / Delete bar
//     (buttons reuse `.toolbox-action-btn`; per-family class names
//     remain on the buttons purely as stable selectors for tests).
//   - `ContentGrip` — the shared "Drag to move" grip strip every
//     floating editor shows (note editor, textbox / callout editors,
//     the edit inline editor — DEF-153(d) previously had THREE
//     different drag affordances for four editors).
//   - `MoveHint` — the shared "Double click to edit" cursor chip.
//
// AGENTS.md cross-bubbling guards: the action bar stops pointerdown
// so a button press never starts a page-canvas drag behind it, but
// never calls `preventDefault`/`stopPropagation` on the CLICK path —
// clicks on the bar's buttons complete normally.

import { useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactElement, ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { TfBar } from "./motion/TfMotion";
import {
  moveImageRect,
  resizeImageRect,
  type ImageResizeHandle,
  type ImageRect,
} from "../edit/geometry";

// ---------------------------------------------------------------------------
// useSelectableDrag — shared move/resize gesture tracker
//
// The hook ONLY tracks the gesture + computes candidate rects; the
// caller decides what to apply (annotation geometry, box registry
// rect, text-run selection). Same source of truth for every kind.

export interface SelectableDragState {
  id: string;
  /** "move" shifts the whole annotation, "resize" scales via a corner
   *  handle, "anchor" (DEF-161) drags the callout's arrow anchor only
   *  — the caller applies the gesture with the delta/rect helpers. */
  kind: "move" | "resize" | "anchor";
  /** Corner handle for resize drags. */
  handle?: ImageResizeHandle;
  originClient: { x: number; y: number };
  startRect: ImageRect;
  pageWidthPt: number;
  pageHeightPt: number;
}

export interface SelectableDragController {
  /** Active drag, or null. */
  drag: SelectableDragState | null;
  /** Start a move/resize drag. Call from the surface's pointerdown. */
  beginDrag: (d: SelectableDragState) => void;
  /** End the drag (pointerup / pointercancel). */
  endDrag: () => void;
  /** The candidate rect for the current pointer position (CSS px),
   *  or null when no drag is active. Applies the same
   *  move/resize/clamp math every overlay used before, now shared. */
  rectFor: (clientX: number, clientY: number, cssScale: number) => ImageRect | null;
  /** The pointer delta (page points) for the current pointer
   *  position, or null when no drag is active. Used for geometry
   *  that is not a plain rect (ink point maps, arrow endpoints, note
   *  anchors). */
  deltaFor: (clientX: number, clientY: number, cssScale: number) => { x: number; y: number } | null;
}

export function useSelectableDrag(): SelectableDragController {
  const [drag, setDrag] = useState<SelectableDragState | null>(null);
  const beginDrag = (d: SelectableDragState): void => setDrag(d);
  const endDrag = (): void => setDrag(null);
  const rectFor = (clientX: number, clientY: number, cssScale: number): ImageRect | null => {
    if (drag === null) return null;
    const dx = (clientX - drag.originClient.x) / cssScale;
    const dy = (clientY - drag.originClient.y) / cssScale;
    if (drag.kind === "move") {
      return moveImageRect(drag.startRect, { x: dx, y: dy }, drag.pageWidthPt, drag.pageHeightPt);
    }
    if (drag.handle === undefined) return null;
    return resizeImageRect(drag.startRect, drag.handle, { x: dx, y: dy }, drag.pageWidthPt, drag.pageHeightPt);
  };
  const deltaFor = (clientX: number, clientY: number, cssScale: number): { x: number; y: number } | null => {
    if (drag === null) return null;
    return {
      x: (clientX - drag.originClient.x) / cssScale,
      y: (clientY - drag.originClient.y) / cssScale,
    };
  };
  return { drag, beginDrag, endDrag, rectFor, deltaFor };
}

// ---------------------------------------------------------------------------
// ContentGrip — the shared "Drag to move" strip
//
// Rendered at the top of EVERY floating editor window that is
// draggable (DEF-147 already gave the textbox/callout editors a grip;
// DEF-153(d) requires the SAME labelled grip on the note editor and
// the Edit-mode inline editor so one affordance covers all four).

export function ContentGrip(props: {
  /** Stable data attribute value for the handle (tests / e2e). */
  handleName: string;
  label?: string;
  /** Extra class names (e.g. a compact inline variant). */
  className?: string;
}): ReactElement {
  const { handleName, label = "Drag to move", className } = props;
  const cls = className === undefined ? "content-grip" : `content-grip ${className}`;
  return (
    <div className={cls} data-drag-grip={handleName} aria-hidden>
      <GripVertical size={16} aria-hidden />
      <span className="content-grip-label" data-drag-grip-label={label}>
        {label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContentActionBar — the shared Confirm / Edit / Delete bar
//
// Rendered under a selected (movable) item. Every kind gets the SAME
// chrome; per-family class names ride along as stable selectors for
// the existing tests (`.edit-box-toolbar-btn`, `.ann-content-action`).
// The bar stops the POINTERDOWN so a press on a button never starts a
// page-canvas drag behind it; click events on the buttons flow
// untouched (AGENTS.md cross-bubbling rule).

export interface ContentActionBarProps {
  /** CSS left/top of the bar (page px). */
  left: number;
  top: number;
  /** Per-family container classes (keep the old selectors stable) —
   *  e.g. `"edit-box-toolbar content-action-bar"`. */
  className?: string;
  dataBar?: string;
  onConfirm?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /** Phase 28 — an optional Cancel verb, rendered after the middle slot
   *  and before Delete. The annotation bar uses it to undo the live
   *  edit session. */
  onCancel?: () => void;
  cancelLabel?: string;
  cancelTitle?: string;
  cancelAria?: string;
  /** Modal verbs — Edit is shown only when a real edit toolbox
   *  exists; Delete only when an engine delete path exists. */
  showEdit?: boolean;
  showDelete?: boolean;
  confirmLabel?: string;
  editLabel?: string;
  deleteLabel?: string;
  confirmTitle?: string;
  editTitle?: string;
  deleteTitle?: string;
  confirmAria?: string;
  editAria?: string;
  deleteAria?: string;
  dataActionPrefix: string;
  /** Legacy per-family data attributes kept as stable selectors for
   *  existing tests (e.g. `data-edit-box-action="edit"`). Keyed by
   *  the action verb; when present the button carries BOTH
   *  `data-content-action` and this attribute. */
  dataActions?: { confirm?: string; edit?: string; delete?: string };
  /** Phase 28 — a control rendered BETWEEN the (optional) Edit button
   *  and the Delete button. The annotation bar uses it for the colour
   *  box, which replaces the old Edit text: Confirm | [colour box] |
   *  Delete. */
  middle?: ReactNode;
  /** Extra content rendered after the buttons (e.g. a label). */
  children?: ReactNode;
}

export function ContentActionBar(props: ContentActionBarProps): ReactElement {
  const {
    left,
    top,
    className = "content-action-bar",
    dataBar,
    onConfirm,
    onEdit,
    onDelete,
    onCancel,
    cancelLabel = "Cancel",
    cancelTitle = "Cancel",
    cancelAria,
    showEdit = true,
    showDelete = true,
    confirmLabel = "Confirm",
    editLabel = "Edit",
    deleteLabel = "Delete",
    confirmTitle = "Confirm",
    editTitle = "Edit",
    deleteTitle = "Delete",
    confirmAria,
    editAria,
    deleteAria,
    dataActionPrefix,
    dataActions,
    middle,
    children,
  } = props;
  const prefix = dataActionPrefix;
  return (
    <TfBar
      className={className}
      data-content-action-bar={dataBar}
      style={{ left, top }}
      // The bar stops the pointerdown so the press never reaches the
      // page-canvas layer beneath (no accidental drag-to-create /
      // deselection). The CLICK event is never prevented or stopped,
      // so the buttons stay fully clickable.
      onPointerDown={(e: ReactPointerEvent<HTMLDivElement>): void => e.stopPropagation()}
    >
      {onConfirm !== undefined && (
        <button
          type="button"
          className="toolbox-action-btn toolbox-action-btn--confirm content-action-btn"
          onClick={onConfirm}
          data-content-action={`${prefix}-confirm`}
          {...(dataActions?.confirm !== undefined ? { "data-edit-box-action": dataActions.confirm } : {})}
          aria-label={confirmAria ?? confirmLabel}
          title={confirmTitle}
        >
          {confirmLabel}
        </button>
      )}
      {showEdit && onEdit !== undefined && (
        <button
          type="button"
          className="toolbox-action-btn content-action-btn"
          onClick={onEdit}
          data-content-action={`${prefix}-edit`}
          {...(dataActions?.edit !== undefined ? { "data-edit-box-action": dataActions.edit } : {})}
          aria-label={editAria ?? editLabel}
          title={editTitle}
        >
          {editLabel}
        </button>
      )}
      {middle}
      {onCancel !== undefined && (
        <button
          type="button"
          className="toolbox-action-btn toolbox-action-btn--cancel content-action-btn"
          onClick={onCancel}
          data-content-action={`${prefix}-cancel`}
          aria-label={cancelAria ?? cancelLabel}
          title={cancelTitle}
        >
          {cancelLabel}
        </button>
      )}
      {showDelete && onDelete !== undefined && (
        <button
          type="button"
          className="toolbox-action-btn toolbox-action-btn--delete content-action-btn"
          onClick={onDelete}
          data-content-action={`${prefix}-delete`}
          {...(dataActions?.delete !== undefined ? { "data-edit-box-action": dataActions.delete } : {})}
          aria-label={deleteAria ?? deleteLabel}
          title={deleteTitle}
        >
          {deleteLabel}
        </button>
      )}
      {children}
    </TfBar>
  );
}