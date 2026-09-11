// B10 / DEF-101 + Bug 6 — placed-stamp DOM surfaces.
//
// The engine's `addStamp` op bakes the stamp PNG into the page
// content, so the placed stamp is part of the page bitmap after a
// proxy refresh. That baked representation has no DOM node, so the
// runtime could not demonstrate/verify a placement (and QA's e2e
// couldn't either: its `.stamp-annotation` locator timed out even
// though the pixels were on the page).
//
// This component renders a per-placement DOM annotation at the exact
// rect the engine embeds: a positioned div carrying the placed
// stamp's PNG (the same raster the engine bakes, so the overlay
// pixel-matches the bitmap and reads as a single stamp).
//
// Bug 6 — stamps are now full citizens of the selectable-movable
// model, exactly like annotations: single click SELECTS
// (Confirm/Edit/Delete bar + corner resize handles), drag moves /
// resizes (a local draft rect follows the pointer, a PENDING move is
// parked on release), the bar's Confirm commits the move through
// `onMove` (the engine's editImage mask+redraw lever), Delete
// removes the stamp (`onDelete`), and Edit opens a compact stamp-type
// picker (retype: APPROVED / DRAFT / CONFIDENTIAL / FINAL). While a
// stamp is selected the original surface stays at the baked position
// until Confirm — the engine has no stamp registry, so the first
// commit is what moves the pixels; the transient duplicate during
// the drag is the inherent tradeoff of the bake-only surface.
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement } from "react";
import type { StampId } from "../../shared/types";
import {
  ContentActionBar,
  useSelectableDrag,
} from "../components/selectableContent";
import { rectsClose } from "../edit/geometry";
import type { ImageResizeHandle } from "../edit/geometry";
import { clamp } from "../edit/model";
import { STAMP_IDS } from "./stampRender";

export interface PlacedStamp {
  id: string;
  stampId: StampId;
  page: number;
  rect: { x: number; y: number; width: number; height: number };
  pngBytes: Uint8Array;
  pngWidth: number;
  pngHeight: number;
}

interface StampRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface StampAnnotationsProps {
  cssScale: number;
  items: PlacedStamp[];
  /** Page rectangle in PDF points — clamps stamp moves/resizes to
   *  the page bounds (same contract as the annotation overlay). */
  pageWidthPt?: number;
  pageHeightPt?: number;
  /** Bug 6 — confirm a move / resize: the host re-bakes the stamp at
   *  `rect` via the engine's editImage mask+redraw lever. */
  onMove?: (stamp: PlacedStamp, rect: StampRect) => void;
  /** Bug 6 — delete the stamp (masks the rect with white). */
  onDelete?: (stamp: PlacedStamp) => void;
  /** Bug 6 — retype the stamp (Edit verb: change the stamp id, the
   *  only content a stamp owns beyond geometry). */
  onRetype?: (stamp: PlacedStamp, stampId: StampId) => void;
  /** DEF-190 — reports whether this page currently shows stamp
   *  selection chrome (action bar or stamp-type editor). The host
   *  page mirrors it into `data-stamp-editor-open`; the stylesheet
   *  lifts that page above its sibling pages so chrome anchored
   *  under a bottom-edge stamp paints — and hit-tests — above the
   *  NEXT page instead of being covered by it. */
  onSelectionChange?: (selected: boolean) => void;
}

const RESIZE_HANDLES: readonly ImageResizeHandle[] = ["nw", "ne", "sw", "se"];

/** DEF-176 — aspect-locked corner resize for a placed stamp.
 *
 *  A stamp is a raster with a FIXED aspect (png width / png height);
 *  letting width and height move independently on a corner drag would
 *  squash the glyphs, so the resize scales BOTH axes by ONE factor
 *  (the shared `resizeImageRect` the rectangle / ellipse kinds use is
 *  freeform — fine for shapes, wrong for a raster). The factor rides
 *  the axis the user dragged FURTHEST relative to its start size; the
 *  other axis is derived from the stamp's `aspect`, so the ratio is
 *  exact by construction. The corner opposite the dragged handle (the
 *  anchor) stays pinned; the result is clamped to the page and to the
 *  same 4 pt minimum the shared rect math enforces. Pure + DOM-free so
 *  the unit tests exercise the math directly. */
export function resizeStampRect(
  startRect: StampRect,
  handle: ImageResizeHandle,
  delta: { x: number; y: number },
  pageWidthPt: number,
  pageHeightPt: number,
  aspect: number,
): StampRect {
  const { x, y, width, height } = startRect;
  if (width <= 0 || height <= 0 || !Number.isFinite(aspect) || aspect <= 0) {
    return { ...startRect };
  }
  // Freeform scale per axis, per handle (which edges the pointer
  // drags). Dragging a handle outward (nw/sw: delta.x negative,
  // nw/ne: delta.y negative) GROWS the rect, so the sign flips per
  // corner exactly like the shared rect math.
  const ws = handle === "nw" || handle === "sw" ? 1 - delta.x / width : 1 + delta.x / width;
  const hs = handle === "nw" || handle === "ne" ? 1 - delta.y / height : 1 + delta.y / height;
  // Ride the axis with the larger RELATIVE drag; the other axis is
  // derived from `aspect`, so width / height never changes.
  const relX = Math.abs(delta.x) / width;
  const relY = Math.abs(delta.y) / height;
  const scale = relY > relX ? hs : ws;
  // The anchor corner — the corner OPPOSITE the dragged handle.
  const ax = handle === "nw" || handle === "sw" ? x + width : x;
  const ay = handle === "nw" || handle === "ne" ? y + height : y;
  const minSize = 4; // pt — the same floor the shared rect math uses
  const minScale = minSize / Math.min(width, height);
  let maxScale;
  switch (handle) {
    case "se":
      maxScale = Math.min((pageWidthPt - ax) / width, (pageHeightPt - ay) / height);
      break;
    case "nw":
      maxScale = Math.min(ax / width, ay / height);
      break;
    case "ne":
      maxScale = Math.min((pageWidthPt - ax) / width, ay / height);
      break;
    default:
      maxScale = Math.min(ax / width, (pageHeightPt - ay) / height);
      break;
  }
  if (!Number.isFinite(maxScale)) maxScale = 1;
  const s = clamp(scale, minScale, Math.max(minScale, maxScale));
  const newW = width * s;
  const newH = height * s;
  return {
    x: handle === "nw" || handle === "sw" ? ax - newW : ax,
    y: handle === "nw" || handle === "ne" ? ay - newH : ay,
    width: newW,
    height: newH,
  };
}

export function StampAnnotations(props: StampAnnotationsProps): ReactElement | null {
  const {
    cssScale,
    items,
    pageWidthPt = 612,
    pageHeightPt = 792,
    onMove,
    onDelete,
    onRetype,
    onSelectionChange,
  } = props;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Draft rect override while dragging. */
  const [draft, setDraft] = useState<{ id: string; rect: StampRect } | null>(null);
  /** A move/resize parked by a real drag, awaiting the bar's Confirm. */
  const [pending, setPending] = useState<{ stamp: PlacedStamp; rect: StampRect } | null>(null);
  /** The stamp-type picker (the Edit toolbox). */
  const [editId, setEditId] = useState<string | null>(null);
  /** True when the last pointerup was a real drag (suppresses the
   *  follow-up click from re-opening the picker / re-selecting). */
  const movedRef = useRef(false);
  const selDrag = useSelectableDrag();

  // Drop selection / picker when the stamps list changes underneath
  // (a delete-echo removed the selected stamp). Bug 2-style echo-wait:
  // after Confirm, the pending move stays visible until the host's
  // mirror echo (items) carries the stamp at the committed rect — the
  // surface must not snap back to the old rect while the engine
  // re-bake round-trips.
  useEffect(() => {
    if (selectedId !== null && !items.some((s) => s.id === selectedId)) {
      setSelectedId(null);
      setPending(null);
      setDraft(null);
      setEditId(null);
      return;
    }
    if (pending !== null) {
      const echoed = items.find((s) => s.id === pending.stamp.id);
      if (echoed !== undefined && rectsClose(echoed.rect, pending.rect, 1)) {
        setPending(null);
        setDraft(null);
        setSelectedId(null);
      }
    }
  }, [items, selectedId, pending]);

  const selectedStamp =
    selectedId === null ? null : items.find((s) => s.id === selectedId) ?? null;

  // DEF-190 — publish the selection-chrome state to the host page.
  // The effect (not a render-time call) keeps the host's setState out
  // of the render path; the cleanup reports "closed" so a page that
  // unmounts (virtualized off-screen) never leaves the attribute set.
  const selectionActive = selectedStamp !== null;
  useEffect(() => {
    onSelectionChange?.(selectionActive);
    return (): void => onSelectionChange?.(false);
  }, [selectionActive, onSelectionChange]);

  const rectFor = (s: PlacedStamp): StampRect =>
    draft !== null && draft.id === s.id ? draft.rect : s.rect;

  /** DEF-176 — the drag candidate rect for the current pointer
   *  position. Moves use the shared controller's freeform rect
   *  (identical to every other movable kind); RESIZE drags run the
   *  stamp-specific aspect-locked math (`resizeStampRect`) so the
   *  raster never squashes. */
  const dragRectFor = useCallback(
    (clientX: number, clientY: number): StampRect | null => {
      const drag = selDrag.drag;
      if (drag === null) return null;
      const r = selDrag.rectFor(clientX, clientY, cssScale);
      if (r === null) return null;
      if (drag.kind !== "resize" || drag.handle === undefined) return r;
      const stamp = items.find((s) => s.id === drag.id);
      if (stamp === undefined) return r;
      const delta = selDrag.deltaFor(clientX, clientY, cssScale);
      if (delta === null) return r;
      const pngAspect = stamp.pngWidth / Math.max(1, stamp.pngHeight);
      const aspect =
        Number.isFinite(pngAspect) && pngAspect > 0
          ? pngAspect
          : drag.startRect.width / Math.max(1, drag.startRect.height);
      return resizeStampRect(drag.startRect, drag.handle, delta, pageWidthPt, pageHeightPt, aspect);
    },
    [selDrag, cssScale, items, pageWidthPt, pageHeightPt],
  );

  const beginSurfaceDrag = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>, stamp: PlacedStamp, handle?: ImageResizeHandle): void => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (editId === stamp.id) return;
      movedRef.current = false;
      const startRect = rectFor(stamp);
      setSelectedId(stamp.id);
      setEditId(null);
      setPending((prev) => (prev?.stamp.id === stamp.id ? prev : null));
      selDrag.beginDrag({
        id: stamp.id,
        kind: handle !== undefined ? "resize" : "move",
        handle,
        originClient: { x: e.clientX, y: e.clientY },
        startRect,
        pageWidthPt,
        pageHeightPt,
      });
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    [editId, rectFor, selDrag, pageWidthPt, pageHeightPt],
  );

  const onSurfaceMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (selDrag.drag === null) return;
      const r = dragRectFor(e.clientX, e.clientY);
      if (r === null) return;
      setDraft({ id: selDrag.drag.id, rect: { ...r } });
    },
    [selDrag, dragRectFor],
  );

  const onSurfaceUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (selDrag.drag === null) return;
      const drag = selDrag.drag;
      const stamp = items.find((s) => s.id === drag.id);
      const delta = selDrag.deltaFor(e.clientX, e.clientY, cssScale);
      const newRect = dragRectFor(e.clientX, e.clientY);
      selDrag.endDrag();
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      if (stamp === undefined || delta === null || newRect === null) {
        movedRef.current = false;
        return;
      }
      // A real drag (more than a click's worth of movement) parks a
      // PENDING move; a click just keeps the selection.
      const moved = Math.abs(delta.x) > 0.75 || Math.abs(delta.y) > 0.75;
      if (moved) {
        movedRef.current = true;
        setPending({ stamp, rect: { ...newRect } });
        setDraft({ id: drag.id, rect: { ...newRect } });
      } else {
        movedRef.current = false;
      }
    },
    [cssScale, items, selDrag, dragRectFor],
  );

  const onSurfaceClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, stamp: PlacedStamp): void => {
      e.stopPropagation();
      if (movedRef.current) {
        movedRef.current = false;
        return;
      }
      selDrag.endDrag();
      setSelectedId(stamp.id);
      setEditId(null);
      // Clicking another stamp reverts any unconfirmed move.
      setPending((prev) => (prev !== null && prev.stamp.id !== stamp.id ? null : prev));
      setDraft((prev) => (prev !== null && prev.id !== stamp.id ? null : prev));
    },
    [selDrag],
  );

  const onSurfaceDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, stamp: PlacedStamp): void => {
      e.stopPropagation();
      movedRef.current = false;
      setSelectedId(stamp.id);
      setEditId(stamp.id);
    },
    [],
  );

  const confirmPending = useCallback((): void => {
    if (pending === null) return;
    onMove?.(pending.stamp, pending.rect);
    // Bug 2-style echo-wait: KEEP the draft + pending until the
    // mirror echo lands (rectsClose above) so the surface does not
    // snap back to the old rect during the re-bake round-trip. The
    // safety timer force-clears both if the host's editImage failed
    // (the host toasts the error).
    window.setTimeout(() => {
      setPending((prev) =>
        prev !== null && prev.stamp.id === pending.stamp.id ? null : prev,
      );
      setDraft((prev) =>
        prev !== null && prev.id === pending.stamp.id ? null : prev,
      );
    }, 500);
    setEditId(null);
  }, [pending, onMove]);

  const deleteSelected = useCallback((): void => {
    if (selectedStamp === null) return;
    setPending(null);
    setDraft(null);
    setEditId(null);
    onDelete?.(selectedStamp);
    setSelectedId(null);
  }, [selectedStamp, onDelete]);

  const retypeSelected = useCallback(
    (stampId: StampId): void => {
      if (selectedStamp === null || selectedStamp.stampId === stampId) return;
      onRetype?.(selectedStamp, stampId);
      setEditId(null);
      setSelectedId(null);
    },
    [selectedStamp, onRetype],
  );

  /** DEF-190 — stable close for the stamp-type editor. Referenced by
   *  the editor's Escape effect (a fresh closure every render would
   *  re-subscribe the window listener on every parent render) and by
   *  the Cancel button. */
  const closeEditor = useCallback((): void => {
    setEditId(null);
  }, []);

  if (items.length === 0) return null;

  const selectedBounds = selectedStamp !== null ? { ...rectFor(selectedStamp) } : null;
  const barPos =
    selectedBounds !== null
      ? {
          left: Math.max(0, Math.min(selectedBounds.x * cssScale, pageWidthPt * cssScale - 240)),
          top: (selectedBounds.y + selectedBounds.height) * cssScale + 4,
        }
      : null;

  return (
    <>
      {items.map((s) => {
        const r = rectFor(s);
        const isSelected = selectedId === s.id;
        const style: CSSProperties = {
          position: "absolute",
          left: r.x * cssScale,
          top: r.y * cssScale,
          width: r.width * cssScale,
          height: r.height * cssScale,
          // Bug 6 — the interactive surface paints above the
          // textLayer (z: auto) but below the annotation layer
          // (z: 2), so armed creation tools and open editors keep
          // swallowing page clicks (the annotation layer is
          // pointer-active then); in plain select view the stamp is
          // the topmost interactive surface at its rect.
          zIndex: 1,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        };
        return (
          <div
            key={s.id}
            className={
              selDrag.drag?.id === s.id
                ? "stamp-annotation stamp-annotation-dragging"
                : "stamp-annotation"
            }
            data-stamp-annotation={s.id}
            data-stamp-id={s.stampId}
            data-stamp-selected={isSelected ? "true" : "false"}
            data-page={s.page}
            style={{
              ...style,
              pointerEvents: editId === s.id ? "none" : "auto",
            }}
            onPointerDown={(e): void => beginSurfaceDrag(e, s)}
            onPointerMove={onSurfaceMove}
            onPointerUp={onSurfaceUp}
            onClick={(e): void => onSurfaceClick(e, s)}
            onDoubleClick={(e): void => onSurfaceDoubleClick(e, s)}
          >
            <StampPngImage bytes={s.pngBytes} />
          </div>
        );
      })}
      {selectedStamp !== null && barPos !== null && (
        <>
          {/* Selection ring + corner resize handles (shared chrome).
              DEF-176 — the pointermove / pointerup handlers live
              HERE (the handles' ancestor), not on the stamp surface:
              a handle's pointerdown calls setPointerCapture on the
              HANDLE, so every follow-up move/up is retargeted to the
              handle and bubbles through this frame — the sibling
              `.stamp-annotation` surface never sees them (the
              annotation overlay avoids this by keeping its move/up
              on the layer root, an ancestor of the handles; this
              frame plays that role for the stamp chrome). */}
          <div
            className="content-selection-frame"
            data-content-selection-frame
            style={{
              left: selectedBounds !== null ? selectedBounds.x * cssScale - 2 : -2,
              top: selectedBounds !== null ? selectedBounds.y * cssScale - 2 : -2,
              width:
                selectedBounds !== null ? selectedBounds.width * cssScale + 4 : 0,
              height:
                selectedBounds !== null ? selectedBounds.height * cssScale + 4 : 0,
            }}
            aria-hidden
            onPointerMove={onSurfaceMove}
            onPointerUp={onSurfaceUp}
          >
            <div className="content-selection-bounds" aria-hidden />
            {RESIZE_HANDLES.map((h) => (
              <div
                key={h}
                className={`content-resize-handle content-resize-handle-${h}`}
                data-stamp-resize-handle={h}
                aria-hidden
                onPointerDown={(e): void => {
                  e.stopPropagation();
                  beginSurfaceDrag(e, selectedStamp, h);
                }}
              />
            ))}
          </div>
          {editId === selectedStamp.id ? (
            <StampTypeEditor
              left={barPos.left}
              top={barPos.top}
              active={selectedStamp.stampId}
              onPick={retypeSelected}
              onClose={closeEditor}
            />
          ) : (
            <ContentActionBar
              className="content-action-bar stamp-action-bar"
              dataBar="stamp"
              left={barPos.left}
              top={barPos.top}
              onConfirm={pending !== null ? confirmPending : (): void => setSelectedId(null)}
              onEdit={(): void => setEditId(selectedStamp.id)}
              onDelete={deleteSelected}
              confirmLabel="Confirm"
              editLabel="Edit"
              deleteLabel="Delete"
              confirmTitle={pending !== null ? "Confirm the move" : "Clear selection"}
              editTitle="Change stamp type"
              deleteTitle="Delete stamp"
              confirmAria="Confirm stamp move"
              editAria="Edit stamp"
              deleteAria="Delete stamp"
              dataActionPrefix="stamp"
            />
          )}
        </>
      )}
    </>
  );
}

/** The stamp-type picker (the Edit toolbox for a placed stamp).
 *  Lists the four built-in stamp ids; picking one applies instantly
 *  (retype) and closes — the same instant-apply pattern the
 *  annotation color picker uses.
 *
 *  DEF-190 — the editor previously had NO keyboard exit: Escape did
 *  nothing, and because the editor straddles into the next page when
 *  the stamp sits near the page's bottom edge, the Cancel button
 *  could even be unclickable. Escape now closes the editor through a
 *  window-level keydown listener (focus-independent, the same pattern
 *  the TitleBar menu popover uses). The listener only closes — it
 *  never preventDefaults or stops propagation, so any other Escape
 *  handler in the app still sees the event (cross-bubbling guard,
 *  DEF-087/088/090). */
function StampTypeEditor(props: {
  left: number;
  top: number;
  active: StampId;
  onPick: (stampId: StampId) => void;
  onClose: () => void;
}): ReactElement {
  const { left, top, active, onPick, onClose } = props;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return (): void => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="ann-textbox-wrap stamp-type-editor-wrap"
      data-stamp-type-editor
      style={{ position: "absolute", left, top, zIndex: 60 }}
      onPointerDown={(e): void => e.stopPropagation()}
    >
      <div className="committed-color-label" aria-hidden>
        Stamp type
      </div>
      <div className="stamp-type-row" role="group" aria-label="Stamp type">
        {STAMP_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={
              id === active
                ? "toolbox-action-btn stamp-type-btn stamp-type-btn-active"
                : "toolbox-action-btn stamp-type-btn"
            }
            onClick={(): void => onPick(id)}
            data-stamp-type-btn={id}
            aria-pressed={id === active}
            aria-label={`Set stamp to ${id}`}
          >
            {id}
          </button>
        ))}
      </div>
      <div
        className="ann-textbox-actions"
        data-annotation-action-bar="stamp-type"
        style={{ pointerEvents: "auto", position: "relative", zIndex: 5 }}
      >
        <button
          type="button"
          className="toolbox-action-btn toolbox-action-btn--cancel ann-textbox-action-btn"
          onClick={onClose}
          data-stamp-type-cancel
          aria-label="Cancel stamp edit"
          title="Cancel (Esc)"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function StampPngImage({ bytes }: { bytes: Uint8Array }): ReactElement | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (typeof URL === "undefined" || typeof Blob === "undefined") return;
    const buf: ArrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([buf], { type: "image/png" });
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return (): void => URL.revokeObjectURL(u);
  }, [bytes]);
  if (url === null) return null;
  return (
    <img
      src={url}
      alt="Placed stamp"
      draggable={false}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "contain",
        pointerEvents: "none",
        userSelect: "none",
      }}
    />
  );
}