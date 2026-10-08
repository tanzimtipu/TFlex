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
//   - `ContentActionBar` — the shared action bar (per-family verb set:
//     annotate = Confirm / [colour] / Cancel / Delete; edit text
//     (Phase 37) = Confirm / Delete / Cancel). Buttons reuse
//     `.toolbox-action-btn`; per-family class names remain on the
//     buttons purely as stable selectors for tests).
//   - `SelectionChrome` — the shared 1 px violet selection boundary
//     plus four 8x8 visual corner handles with large invisible hit
//     targets (Phase 117, chunk B). Hover / focus / selected / draft
//     are separate states.
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

import { useEffect, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  PointerEventHandler,
  ReactElement,
  ReactNode,
} from "react";
import { Icon } from "../icons/Icon";
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
  /** Phase 117 (chunk B) — release the pointer capture owned by the
   *  current drag. Call on `pointercancel` / capture loss so a
   *  cancelled gesture ends cleanly WITHOUT a commit. */
  releaseCapture: () => void;
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
  // Phase 117 (chunk B) — a drag OWNS its pointer. The gesture surface
  // is the DOM element whose id is the drag's `id` (the same stable id
  // the caller selects by); the pointer that started the gesture is the
  // last pointerdown. `beginDrag` records both so the hook can capture
  // the pointer and release it on cancellation.
  const captureRef = useRef<{ element: Element | null; pointerId: number | null } | null>(null);
  const lastPointerRef = useRef<number | null>(null);

  useEffect((): (() => void) => {
    const onPointerDown = (e: PointerEvent): void => {
      lastPointerRef.current = e.pointerId;
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return (): void => window.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  const releaseCapture = (): void => {
    const capture = captureRef.current;
    captureRef.current = null;
    if (capture === null) return;
    const { element, pointerId } = capture;
    if (element === null || pointerId === null) return;
    try {
      element.releasePointerCapture?.(pointerId);
    } catch {
      // The pointer is already gone (cancelled); capture is released.
    }
  };

  const endDrag = (): void => {
    releaseCapture();
    setDrag(null);
  };

  const beginDrag = (d: SelectableDragState): void => {
    const element = typeof document === "undefined" ? null : document.getElementById(d.id);
    const pointerId = lastPointerRef.current;
    captureRef.current = { element, pointerId };
    if (element !== null && pointerId !== null) {
      try {
        element.setPointerCapture?.(pointerId);
      } catch {
        // jsdom / a detached node cannot capture; the gesture still
        // tracks through the controller's rect / delta maths.
      }
    }
    setDrag(d);
  };

  // A cancelled pointer (OS gesture interruption / capture loss) ends
  // the drag cleanly: the hook only drops its gesture state, so the
  // caller's commit path (driven by a real pointerup) never runs.
  useEffect((): (() => void) | undefined => {
    if (drag === null) return undefined;
    const onCancel = (): void => {
      releaseCapture();
      setDrag(null);
    };
    window.addEventListener("pointercancel", onCancel);
    return (): void => window.removeEventListener("pointercancel", onCancel);
  }, [drag]);

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
  return { drag, beginDrag, endDrag, releaseCapture, rectFor, deltaFor };
}

// ---------------------------------------------------------------------------
// SelectionChrome — the ONE shared selection boundary + handles
//
// Phase 117 (chunk B). Every selectable kind (annotation, stamp, text
// box, image, text run, crop region, form widget) draws the SAME chrome:
// a 1 px violet boundary (`--btn-selected-border` — the interactive
// violet token in both themes, never a new hex) and four 8x8 px visual
// corner handles whose invisible hit targets are the authoritative
// geometry tokens (32 px fine pointer / 44 px coarse pointer, which
// supersede the retired "approximately 24 px" wording). Hover / focus /
// selected / draft are SEPARATE states (see the `is-*` classes in the
// selection section of styles.css): hover is a neutral hairline, selected
// is the violet boundary, focus adds a distinct ring, draft is dashed.
// Never a full-width glow and never an opaque fill over the content.

export type SelectionChromeState = "hover" | "focus" | "selected" | "draft";

/** One of the four corner handles, in the shared order. */
export type SelectionHandleCorner = "nw" | "ne" | "sw" | "se";

export interface SelectionChromeProps {
  /** Page-pixel bounds of the selection rectangle. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** The selectable kind ("annotation" | "textBox" | "image" | ...). */
  kind: string;
  state: SelectionChromeState;
  /** Phase 117 (chunk C) — render the four corner handles. Default
   *  true; a non-resizable kind passes false to draw the boundary
   *  alone (no handle spans). */
  handles?: boolean;
  /** Phase 117 (chunk C) — render the boundary rect. Default true;
   *  a kind that carries its OWN frame (annotation textbox / callout)
   *  passes false so only the handles render. */
  boundary?: boolean;
  /** Phase 117 (chunk C) — when set, each handle ADDITIONALLY carries
   *  `{ [handleDataAttr]: corner }`, so the legacy
   *  `data-annotation-resize-handle` / `data-stamp-resize-handle`
   *  selectors survive on top of `data-selection-handle`. */
  handleDataAttr?: string;
  /** Phase 117 (chunk C) — the kind's real handle-drag entry point. */
  onHandlePointerDown?: (e: ReactPointerEvent<HTMLSpanElement>, corner: SelectionHandleCorner) => void;
  /** Phase 117 (chunk C) — extra attributes forwarded verbatim to the
   *  root (e.g. `data-content-selection-frame`). */
  dataAttributes?: Record<string, string | undefined>;
  /** Phase 117 (chunk C) — the stamp chrome owns move/up on the frame
   *  (its handles capture the pointer, so the follow-up move/up land
   *  on an ancestor of the handles). Forwarded to the root. */
  onPointerMove?: PointerEventHandler<HTMLDivElement>;
  onPointerUp?: PointerEventHandler<HTMLDivElement>;
}

const SELECTION_CORNERS: readonly SelectionHandleCorner[] = ["nw", "ne", "sw", "se"];

export function SelectionChrome(props: SelectionChromeProps): ReactElement {
  const {
    left,
    top,
    width,
    height,
    kind,
    state,
    handles = true,
    boundary = true,
    handleDataAttr,
    onHandlePointerDown,
    dataAttributes,
    onPointerMove,
    onPointerUp,
  } = props;
  return (
    <div
      className={`selection-chrome is-${state}`}
      data-selection-boundary
      data-selection-kind={kind}
      {...(boundary ? { "data-content-selection-bounds": "" } : {})}
      {...(dataAttributes ?? {})}
      {...(onPointerMove !== undefined ? { onPointerMove } : {})}
      {...(onPointerUp !== undefined ? { onPointerUp } : {})}
      style={{ left, top, width, height }}
    >
      {handles &&
        SELECTION_CORNERS.map((corner) => (
          <span
            key={corner}
            className={`selection-handle selection-handle-${corner}`}
            data-selection-handle={corner}
            {...(handleDataAttr !== undefined ? { [handleDataAttr]: corner } : {})}
            {...(onHandlePointerDown !== undefined
              ? {
                  onPointerDown: (e: ReactPointerEvent<HTMLSpanElement>): void =>
                    onHandlePointerDown(e, corner),
                }
              : {})}
            aria-hidden
          />
        ))}
    </div>
  );
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
      <Icon name="dragPage" size="sm" />
      <span className="content-grip-label" data-drag-grip-label={label}>
        {label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ContentActionBar — the shared action bar
//
// Rendered under a selected (movable) item. Every kind gets the SAME
// chrome; per-family class names ride along as stable selectors for
// the existing tests (`.edit-box-toolbar-btn`, `.ann-content-action`).
// `cancelAfterDelete` sets the verb order per flow (Phase 37 item 11).
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
  /** Phase 28 — an optional Cancel verb, rendered in the PRIMARY row
   *  beside Confirm (Phase 117, chunk B: the primary row is Confirm /
   *  Apply + Cancel only, so this is no longer ordered against Delete).
   *  Retained on the interface so existing callers keep compiling; the
   *  phase-117 layout always places Cancel in the primary row. */
  onCancel?: () => void;
  cancelLabel?: string;
  cancelTitle?: string;
  cancelAria?: string;
  /** Deprecated (Phase 117, chunk B). Cancel is always in the primary
   *  row now, so the "Cancel after Delete" ordering no longer applies.
   *  Kept so existing callers compile. */
  cancelAfterDelete?: boolean;
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
  /** Phase 28 — a control rendered BETWEEN the Confirm button and the
   *  primary-row Cancel. The annotation bar uses it for the colour box
   *  (a control, not a verb, so it stays in the primary row). */
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
  const [moreOpen, setMoreOpen] = useState(false);
  const hasEdit = showEdit && onEdit !== undefined;
  const hasDelete = showDelete && onDelete !== undefined;
  const cancelButton = onCancel !== undefined && (
    <button
      type="button"
      className="btn btn-secondary toolbox-action-btn toolbox-action-btn--cancel content-action-btn"
      onClick={onCancel}
      data-content-action={`${prefix}-cancel`}
      aria-label={cancelAria ?? cancelLabel}
      title={cancelTitle}
    >
      {cancelLabel}
    </button>
  );
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
          className="btn btn-primary toolbox-action-btn toolbox-action-btn--confirm content-action-btn"
          onClick={onConfirm}
          data-content-action={`${prefix}-confirm`}
          {...(dataActions?.confirm !== undefined ? { "data-edit-box-action": dataActions.confirm } : {})}
          aria-label={confirmAria ?? confirmLabel}
          title={confirmTitle}
        >
          {confirmLabel}
        </button>
      )}
      {middle}
      {cancelButton}
      {(hasEdit || hasDelete) && (
        // Phase 117 (chunk B) — destructive and secondary verbs are no
        // longer siblings of Confirm: ONE separated More control opens
        // the existing menu surface. The Delete control keeps its
        // `data-content-action="<prefix>-delete"` hook inside.
        <div className="content-action-more" data-content-action-more-host>
          <span className="content-action-more-sep" aria-hidden />
          <button
            type="button"
            className="btn btn-secondary toolbox-action-btn content-action-btn content-action-more-btn"
            onClick={(): void => setMoreOpen((v) => !v)}
            data-content-action={`${prefix}-more`}
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            title="More actions"
          >
            <Icon name="dockOverflow" size="sm" aria-hidden />
            <span className="content-action-more-label">More</span>
          </button>
          {moreOpen && (
            <div
              className="content-action-more-menu anim-menu-pop"
              role="menu"
              aria-label="More actions"
              data-content-action-more-menu
            >
              {hasEdit && onEdit !== undefined && (
                <button
                  type="button"
                  role="menuitem"
                  className="btn btn-secondary toolbox-action-btn content-action-btn"
                  onClick={(): void => {
                    setMoreOpen(false);
                    onEdit();
                  }}
                  data-content-action={`${prefix}-edit`}
                  {...(dataActions?.edit !== undefined ? { "data-edit-box-action": dataActions.edit } : {})}
                  aria-label={editAria ?? editLabel}
                  title={editTitle}
                >
                  {editLabel}
                </button>
              )}
              {hasDelete && onDelete !== undefined && (
                <button
                  type="button"
                  role="menuitem"
                  className="btn btn-danger toolbox-action-btn toolbox-action-btn--delete content-action-btn"
                  onClick={(): void => {
                    setMoreOpen(false);
                    onDelete();
                  }}
                  data-content-action={`${prefix}-delete`}
                  {...(dataActions?.delete !== undefined ? { "data-edit-box-action": dataActions.delete } : {})}
                  aria-label={deleteAria ?? deleteLabel}
                  title={deleteTitle}
                >
                  {deleteLabel}
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {children}
    </TfBar>
  );
}