// Phase 12 — Crop pages dialog.
//
// Set each listed page's CropBox AND TrimBox to a user-chosen rect.
// The dialog accepts an "Apply to all pages" mode (one box, every
// page) and a per-page mode (one box per page, each row independent).
// Both modes share the same box-drawing surface: a fixed-aspect
// preview of the page with a draggable rect handle.
//
// The dialog is purely a UI shell — it owns no engine state. The
// host wires the result through the standard `noteOpApplied` path
// so the engine state's modified flag + pageCount refresh.
//
// The dialog emits rects in PAGE POINTS with a TOP-LEFT origin,
// matching the renderer's `CropEntry.box` wire convention; the
// engine converts to bottom-left when serializing.

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { X, Crop } from "lucide-react";
import type { CropEntry } from "../../shared/types";

export type CropMode = "allPages" | "perPage";

export interface CropPagesConfirm {
  /** Crop entries in 1-based visible page order. */
  entries: CropEntry[];
}

interface CropPagesDialogProps {
  open: boolean;
  totalPages: number;
  /** Page dimensions for the active doc — typically US Letter
   *  (612 × 792 pt) for the placeholder sample docs. We accept a
   *  Map<page, {widthPt, heightPt}> so multi-size docs (common in
   *  imported PDFs) get accurate previews per page. The host can
   *  pre-fill this from pdf.js's `getPage().getViewport({scale:1})`
   *  after the active doc loads. */
  pageSizes: Record<number, { widthPt: number; heightPt: number }>;
  onConfirm: (choice: CropPagesConfirm) => void;
  onClose: () => void;
}

interface BoxState {
  /** Top-left x in PDF points (0..widthPt). */
  x: number;
  /** Top-left y in PDF points (0..heightPt). */
  y: number;
  /** Width in PDF points (> 0, <= widthPt - x). */
  width: number;
  /** Height in PDF points (> 0, <= heightPt - y). */
  height: number;
}

/** Normalize a candidate rect into a valid BoxState (positive
 *  width/height, inside the page). Out-of-bounds values are
 *  clamped; a fully-empty candidate collapses to a centered 60%
 *  inset default so the user always sees a meaningful starting
 *  box. */
function normalizeBox(
  candidate: BoxState | null,
  widthPt: number,
  heightPt: number,
): BoxState {
  if (candidate === null) {
    return {
      x: widthPt * 0.1,
      y: heightPt * 0.1,
      width: widthPt * 0.8,
      height: heightPt * 0.8,
    };
  }
  const x = Math.max(0, Math.min(candidate.x, widthPt - 1));
  const y = Math.max(0, Math.min(candidate.y, heightPt - 1));
  const width = Math.max(1, Math.min(candidate.width, widthPt - x));
  const height = Math.max(1, Math.min(candidate.height, heightPt - y));
  return { x, y, width, height };
}

export function CropPagesDialog(
  props: CropPagesDialogProps,
): ReactElement | null {
  const { open, totalPages, pageSizes, onConfirm, onClose } = props;
  const [mode, setMode] = useState<CropMode>("allPages");
  const [sharedBox, setSharedBox] = useState<BoxState | null>(null);
  const [perPageBoxes, setPerPageBoxes] = useState<Record<number, BoxState>>({});
  const [editorPage, setEditorPage] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Reset on open / totalPages change.
  useEffect(() => {
    if (!open) return;
    setMode("allPages");
    setSharedBox(null);
    setPerPageBoxes({});
    setEditorPage(null);
  }, [open, totalPages]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const first = dialogRef.current?.querySelector<HTMLElement>(
      "button, input, [tabindex]",
    );
    first?.focus();
    return (): void => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const editorPageSize = useMemo(() => {
    const p = editorPage ?? 1;
    return pageSizes[p] ?? { widthPt: 612, heightPt: 792 };
  }, [editorPage, pageSizes]);

  const currentBox = useMemo<BoxState>(() => {
    const size = editorPageSize;
    if (mode === "allPages") {
      return normalizeBox(sharedBox, size.widthPt, size.heightPt);
    }
    if (editorPage === null) {
      return normalizeBox(null, size.widthPt, size.heightPt);
    }
    return normalizeBox(
      perPageBoxes[editorPage] ?? null,
      size.widthPt,
      size.heightPt,
    );
  }, [editorPageSize, mode, sharedBox, editorPage, perPageBoxes]);

  const onCommitBox = (next: BoxState): void => {
    const size = editorPageSize;
    const normalized = normalizeBox(next, size.widthPt, size.heightPt);
    if (mode === "allPages") {
      setSharedBox(normalized);
    } else {
      if (editorPage === null) return;
      setPerPageBoxes((prev) => ({ ...prev, [editorPage]: normalized }));
    }
  };

  if (!open) return null;

  const onConfirmClick = (): void => {
    const entries: CropEntry[] = [];
    if (mode === "allPages") {
      const size = pageSizes[1] ?? { widthPt: 612, heightPt: 792 };
      const box = normalizeBox(sharedBox, size.widthPt, size.heightPt);
      for (let p = 1; p <= totalPages; p += 1) {
        entries.push({ page: p, box: { ...box } });
      }
    } else {
      for (let p = 1; p <= totalPages; p += 1) {
        const size = pageSizes[p] ?? { widthPt: 612, heightPt: 792 };
        const box = normalizeBox(
          perPageBoxes[p] ?? null,
          size.widthPt,
          size.heightPt,
        );
        entries.push({ page: p, box: { ...box } });
      }
    }
    onConfirm({ entries });
  };

  return (
    <div className="modal-backdrop" onClick={onClose} data-crop-pages-dialog>
      <div
        className="modal-dialog modal-dialog-wide dialog"
        ref={dialogRef}
        onClick={(e): void => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="crop-pages-dialog-title"
      >
        <div className="modal-header">
          <h2 id="crop-pages-dialog-title" className="modal-title">
            Crop pages
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-help">
            Drag the dashed rectangle to choose the crop area for each page.
            The CropBox and TrimBox of every listed page are updated to the
            chosen rect (top-left origin, PDF points).
          </p>

          <fieldset className="modal-position">
            <legend>Apply to</legend>
            <label>
              <input
                type="radio"
                name="crop-mode"
                checked={mode === "allPages"}
                onChange={(): void => setMode("allPages")}
                data-crop-mode="allPages"
              />
              <span>All pages (one box, every page)</span>
            </label>
            <label>
              <input
                type="radio"
                name="crop-mode"
                checked={mode === "perPage"}
                onChange={(): void => {
                  setMode("perPage");
                  setEditorPage((prev) => prev ?? 1);
                }}
                data-crop-mode="perPage"
              />
              <span>Per page (each row independent)</span>
            </label>
          </fieldset>

          {mode === "perPage" && (
            <label className="modal-field">
              <span>Editing page</span>
              <select
                className="modal-input"
                value={editorPage ?? 1}
                onChange={(e): void => setEditorPage(Number(e.target.value))}
                data-crop-page-select
              >
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <option key={p} value={p}>
                    Page {p}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="crop-editor-wrap">
            <CropEditor
              key={`${mode}-${editorPage ?? 1}-${currentBox.x}-${currentBox.y}-${currentBox.width}-${currentBox.height}`}
              widthPt={editorPageSize.widthPt}
              heightPt={editorPageSize.heightPt}
              initial={currentBox}
              onCommit={onCommitBox}
              label={mode === "allPages" ? "All pages" : `Page ${editorPage ?? 1}`}
            />
          </div>

          <section className="crop-summary" aria-label="Crop summary">
            <header className="crop-summary-header">
              <span className="crop-summary-title">Crop rect</span>
            </header>
            <div className="crop-summary-rows">
              <div className="crop-summary-row">
                <span className="crop-summary-label">x</span>
                <span className="crop-summary-value">{currentBox.x.toFixed(1)} pt</span>
              </div>
              <div className="crop-summary-row">
                <span className="crop-summary-label">y</span>
                <span className="crop-summary-value">{currentBox.y.toFixed(1)} pt</span>
              </div>
              <div className="crop-summary-row">
                <span className="crop-summary-label">width</span>
                <span className="crop-summary-value">{currentBox.width.toFixed(1)} pt</span>
              </div>
              <div className="crop-summary-row">
                <span className="crop-summary-label">height</span>
                <span className="crop-summary-value">{currentBox.height.toFixed(1)} pt</span>
              </div>
            </div>
          </section>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirmClick}
            data-crop-confirm
          >
            <Crop size={14} aria-hidden />
            Apply crop
          </button>
        </div>
      </div>
    </div>
  );
}

/** Inline crop-editor: a fixed-aspect preview of the page with a
 *  draggable rect handle. The preview scales to fit the dialog's
 *  available width; the handle's page-point coordinates are kept
 *  in sync with the displayed pixel coordinates so the value the
 *  user sees is what the engine receives. */
interface CropEditorProps {
  widthPt: number;
  heightPt: number;
  initial: BoxState;
  onCommit: (next: BoxState) => void;
  label: string;
}

function CropEditor(props: CropEditorProps): ReactElement {
  const { widthPt, heightPt, initial, onCommit, label } = props;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState<number>(1);
  const [box, setBox] = useState<BoxState>(initial);
  const [drag, setDrag] = useState<
    | {
        mode: "move" | "resize";
        // Pointer position at drag start, in PIXEL space.
        startX: number;
        startY: number;
        // Box position at drag start, in PDF points.
        boxStart: BoxState;
        // Resize handle (NW / NE / SW / SE) for resize drags.
        handle?: "nw" | "ne" | "sw" | "se";
      }
    | null
  >(null);

  // Recompute the displayed scale whenever the wrap changes size.
  // We use a ResizeObserver so the editor responds to dialog
  // resize / open animations without an explicit setter.
  useEffect(() => {
    if (wrapRef.current === null) return;
    const wrap = wrapRef.current;
    const update = (): void => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width <= 0 || widthPt <= 0) return;
      setScale(rect.width / widthPt);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrap);
    return (): void => ro.disconnect();
  }, [widthPt]);

  // Sync the editor's local `box` whenever `initial` changes (i.e.
  // the host flipped modes / pages). We deliberately use `initial`
  // as the seed and ignore subsequent onCommit-driven changes so
  // the user's pointer drag doesn't snap back to a stale value.
  useEffect(() => {
    setBox(initial);
  }, [initial]);

  // Pointermove + pointerup handlers, attached at window level so
  // the user can drag outside the editor surface without losing
  // the drag.
  useEffect(() => {
    if (drag === null) return;
    const onMove = (e: PointerEvent): void => {
      if (wrapRef.current === null) return;
      const dxPx = e.clientX - drag.startX;
      const dyPx = e.clientY - drag.startY;
      const dxPt = dxPx / scale;
      const dyPt = dyPx / scale;
      let next: BoxState;
      if (drag.mode === "move") {
        next = {
          x: Math.max(0, Math.min(widthPt - drag.boxStart.width, drag.boxStart.x + dxPt)),
          y: Math.max(0, Math.min(heightPt - drag.boxStart.height, drag.boxStart.y + dyPt)),
          width: drag.boxStart.width,
          height: drag.boxStart.height,
        };
      } else {
        const handle = drag.handle ?? "se";
        const start = drag.boxStart;
        let x = start.x;
        let y = start.y;
        let w = start.width;
        let h = start.height;
        if (handle === "nw") {
          x = Math.max(0, Math.min(start.x + start.width - 1, start.x + dxPt));
          y = Math.max(0, Math.min(start.y + start.height - 1, start.y + dyPt));
          w = start.width - (x - start.x);
          h = start.height - (y - start.y);
        } else if (handle === "ne") {
          y = Math.max(0, Math.min(start.y + start.height - 1, start.y + dyPt));
          w = Math.max(1, Math.min(widthPt - start.x, start.width + dxPt));
          h = start.height - (y - start.y);
        } else if (handle === "sw") {
          x = Math.max(0, Math.min(start.x + start.width - 1, start.x + dxPt));
          w = start.width - (x - start.x);
          h = Math.max(1, Math.min(heightPt - start.y, start.height + dyPt));
        } else {
          w = Math.max(1, Math.min(widthPt - start.x, start.width + dxPt));
          h = Math.max(1, Math.min(heightPt - start.y, start.height + dyPt));
        }
        next = { x, y, width: w, height: h };
      }
      setBox(next);
    };
    const onUp = (): void => {
      setDrag(null);
      onCommit(box);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    // We intentionally depend on `box` so onUp sees the latest value.
    // The setDrag(null) above clears the drag on commit, so this
    // effect tears down immediately after the first commit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, scale, widthPt, heightPt, box, onCommit]);

  const startMoveDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (wrapRef.current === null) return;
    setDrag({
      mode: "move",
      startX: e.clientX,
      startY: e.clientY,
      boxStart: box,
    });
  };

  const startResizeDrag = (
    e: React.PointerEvent<HTMLDivElement>,
    handle: "nw" | "ne" | "sw" | "se",
  ): void => {
    e.stopPropagation();
    setDrag({
      mode: "resize",
      startX: e.clientX,
      startY: e.clientY,
      boxStart: box,
      handle,
    });
  };

  const left = box.x * scale;
  const top = box.y * scale;
  const width = box.width * scale;
  const height = box.height * scale;
  const handleSize = 10;

  return (
    <div
      className="crop-editor"
      data-crop-editor
      ref={wrapRef}
      role="application"
      aria-label={`Crop editor for ${label}`}
    >
      <div
        className="crop-editor-page"
        style={{
          width: widthPt * scale,
          height: heightPt * scale,
        }}
      >
        <div
          className="crop-editor-mask"
          style={{
            left,
            top,
            width,
            height,
          }}
          onPointerDown={startMoveDrag}
          data-crop-handle="move"
          role="button"
          aria-label="Drag to position the crop box"
        >
          <span className="crop-editor-label">{label}</span>
        </div>
        {/* Corner handles */}
        <div
          className="crop-editor-handle crop-editor-handle-nw"
          style={{
            left: left - handleSize / 2,
            top: top - handleSize / 2,
            width: handleSize,
            height: handleSize,
          }}
          onPointerDown={(e): void => startResizeDrag(e, "nw")}
          data-crop-handle="nw"
        />
        <div
          className="crop-editor-handle crop-editor-handle-ne"
          style={{
            left: left + width - handleSize / 2,
            top: top - handleSize / 2,
            width: handleSize,
            height: handleSize,
          }}
          onPointerDown={(e): void => startResizeDrag(e, "ne")}
          data-crop-handle="ne"
        />
        <div
          className="crop-editor-handle crop-editor-handle-sw"
          style={{
            left: left - handleSize / 2,
            top: top + height - handleSize / 2,
            width: handleSize,
            height: handleSize,
          }}
          onPointerDown={(e): void => startResizeDrag(e, "sw")}
          data-crop-handle="sw"
        />
        <div
          className="crop-editor-handle crop-editor-handle-se"
          style={{
            left: left + width - handleSize / 2,
            top: top + height - handleSize / 2,
            width: handleSize,
            height: handleSize,
          }}
          onPointerDown={(e): void => startResizeDrag(e, "se")}
          data-crop-handle="se"
        />
      </div>
    </div>
  );
}