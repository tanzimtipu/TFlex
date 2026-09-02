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
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { CropEntry } from "../../shared/types";
import { useBackdropClose } from "./modalBackdrop";

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
  /** B16 — the active document's pdf.js proxy. The CropEditor
   *  uses this to render an actual page preview (via pdf.js
   *  `getPage().render()`) at the current dialog scale so the
   *  user sees the page they're cropping, not a black canvas.
   *  Optional: when no doc is open (e.g. empty placeholder tab)
   *  the editor falls back to the dashed-rect-only surface. */
  doc?: PDFDocumentProxy | null;
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
  const { open, totalPages, pageSizes, doc = null, onConfirm, onClose } = props;
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

  // B13 — focus the first interactive control ONLY on the rising
  // edge of `open`. The previous implementation re-ran the focus
  // call on every `onClose` identity change; for a dialog with a
  // `<select>` (per-page crop mode picker) that stole focus from
  // the dropdown the user was actively hovering. Same microtask
  // deferral as the OCR / Stamp dialog so the focus lands cleanly
  // after React's commit phase.
  const focusedOnceRef = useRef<boolean>(false);
  useEffect(() => {
    if (!open) {
      focusedOnceRef.current = false;
      return;
    }
    if (focusedOnceRef.current) return;
    focusedOnceRef.current = true;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    queueMicrotask((): void => {
      const first = dialogRef.current?.querySelector<HTMLElement>(
        "button, input, [tabindex]",
      );
      first?.focus();
    });
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

  // B3/B6 — backdrop close only when the interaction STARTED on the
  // backdrop (a text-selection drag that begins in the per-page
  // select/inputs and releases over the backdrop must not dismiss
  // the dialog).
  const backdrop = useBackdropClose(onClose);

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
      // B8b — per-page mode crops ONLY the pages the user actually
      // adjusted. `perPageBoxes` only ever holds entries after a
      // committed drag on that page; the previous loop iterated
      // 1..totalPages and filled unset pages with the centred
      // default box, silently cropping the whole document the
      // moment the user dragged on a single page.
      const adjustedPages = Object.keys(perPageBoxes)
        .map(Number)
        .sort((a, b) => a - b);
      for (const p of adjustedPages) {
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
    <div className="modal-backdrop" {...backdrop} data-crop-pages-dialog>
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
            {/* DEF-115 — the key must NOT embed the box coordinates.
                The old key (`...currentBox.x-y-width-height`) remounted
                CropEditor on every committed box change, recreating the
                canvas (previewReady -> opacity 0) and briefly leaving it
                at its intrinsic unscaled CSS size — a visible flash /
                "larger crop window" artifact.
                B8a — the key must not be mode+page either. Mode/page
                changes flow through the CropEditor's props: the `page`
                effect re-renders the canvas (cancelling the in-flight
                task, then painting the new page) and the `initial`
                effect syncs the local box, so the canvas NODE stays
                stable across mode/page switches. A remount on mode/page
                would recreate the canvas node, flashing it to opacity 0
                at its intrinsic 612x792 frame before the render effect
                sizes it again. No key at all keeps the node stable for
                the dialog's whole lifetime; the page/mode props drive
                the re-render. */}
            <CropEditor
              widthPt={editorPageSize.widthPt}
              heightPt={editorPageSize.heightPt}
              initial={currentBox}
              onCommit={onCommitBox}
              label={mode === "allPages" ? "All pages" : `Page ${editorPage ?? 1}`}
              // B16 — render the actual page behind the dashed
              // crop box so the user sees what they're cropping.
              // `page` uses the visible 1-based slot; the host's
              // `doc.getPage(page)` returns the underlying pdf.js
              // page object (post-reorder mapping happens at
              // `getState` time — the engine state mirrors the
              // active document's visible order).
              doc={doc}
              page={editorPage ?? 1}
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
 *  user sees is what the engine receives.
 *
 *  B16 — when `doc` is supplied, the editor renders the actual
 * page behind the dashed crop box (via pdf.js
 * `getPage().render()` at the current dialog scale). Without
 * this, the editor surface is whatever the parent's background
 * happens to be — operators reported a "black canvas" on
 * systems where the dialog's wrap background is dark, leaving
 * the crop rect floating without any visual reference. With a
 * doc, the user sees the page they're about to crop and can
 * visually verify the chosen rect against the page content. */
interface CropEditorProps {
  widthPt: number;
  heightPt: number;
  initial: BoxState;
  onCommit: (next: BoxState) => void;
  label: string;
  /** pdf.js proxy for the active document. Optional: when null
   *  the editor renders the dashed crop rect without a page
   *  preview (matches the pre-fix behaviour; same fall-back for
   *  empty / placeholder tabs that don't have a doc). */
  doc: PDFDocumentProxy | null;
  /** 1-based visible page to render in the preview. The editor
   *  only renders when this matches the `page` prop's last value
   *  the user saw; switching `page` cancels the in-flight render
   *  and starts a fresh one. */
  page: number;
}

function CropEditor(props: CropEditorProps): ReactElement {
  const { widthPt, heightPt, initial, onCommit, label, doc, page } = props;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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
  const [previewReady, setPreviewReady] = useState<boolean>(false);

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

  // B16 — render the actual page via pdf.js at the dialog scale.
  // We re-render whenever `doc`, `page`, or `scale` changes
  // (i.e. on dialog resize / mode switch / page select). The
  // canvas's internal viewport comes from
  // `pdfPage.getViewport({ scale: renderScale })` where
  // `renderScale = cssScale * dpr` so the bitmap is
  // device-pixel-aware (no blur on HiDPI). The canvas's CSS size
  // is `widthPt * cssScale` (so it scales with the dialog); the
  // bitmap backing-store is `widthPt * renderScale` (so it stays
  // crisp at the device pixel ratio). Cancellation: when `page`
  // changes mid-render, the next effect tears down the in-flight
  // `pdfPage.render()` task via `RenderTask.cancel()`.
  useEffect(() => {
    if (doc === null) {
      setPreviewReady(false);
      return;
    }
    let disposed = false;
    let renderTask: { cancel: () => void } | null = null;
    setPreviewReady(false);
    void (async (): Promise<void> => {
      const pdfPage = await doc.getPage(page);
      if (disposed) return;
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = widthPt * scale;
      const cssHeight = heightPt * scale;
      const renderScale = (cssWidth / widthPt) * dpr;
      const renderViewport = pdfPage.getViewport({ scale: renderScale });
      const canvas = canvasRef.current;
      if (canvas === null) return;
      canvas.width = renderViewport.width;
      canvas.height = renderViewport.height;
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      const ctx = canvas.getContext("2d");
      if (ctx === null) return;
      const task = pdfPage.render({ canvasContext: ctx, viewport: renderViewport });
      renderTask = task;
      try {
        await task.promise;
      } catch (error) {
        if ((error as { name?: string }).name !== "RenderingCancelledException") {
          // unexpected render failure: leave the canvas blank
        }
        return;
      }
      if (!disposed) setPreviewReady(true);
    })();
    return (): void => {
      disposed = true;
      try {
        renderTask?.cancel();
      } catch {
        // ignore: cancel can throw if the task already finished
      }
    };
  }, [doc, page, scale, widthPt, heightPt]);

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
        {/* B16 — page preview. When a doc is supplied, the canvas
            underneath paints the actual page so the user can
            visually verify the crop rect. When the canvas is
            still rendering (previewReady=false) we paint a soft
            placeholder so the surface doesn't blink to the
            parent's background colour. The canvas sits BELOW
            the dashed crop mask (z-order via DOM order) so the
            mask stays interactive. */}
        {doc !== null && (
          <canvas
            ref={canvasRef}
            className="crop-editor-canvas"
            data-crop-canvas
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              opacity: previewReady ? 1 : 0,
              transition: "opacity 120ms ease-out",
              pointerEvents: "none",
            }}
          />
        )}
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