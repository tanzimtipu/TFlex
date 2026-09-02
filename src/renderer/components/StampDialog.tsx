// Phase 12 — Stamp tool dialog.
//
// Pick a built-in stamp id, see a preview at the dialog's native
// size, then click "Place on page" to enter placement mode. In
// placement mode the user clicks on a page in the document area
// to drop the stamp at the click location (default rect width
// derived from the stamp's aspect ratio).
//
// The dialog owns the canvas-rendered preview but NOT the
// placement — it sets a local "armed" flag the host reads to
// know whether the next page click should drop the stamp or
// behave as a normal viewer click. Once the user clicks, the
// dialog renders the stamp to PNG via `renderStampToPng`, hands
// the bytes to the host, which calls `engine.addStamp(...)`.
//
// The user's pick of default stamp id persists in
// `AppSettings.defaultStampId` so the Stamp tool opens with the
// same id on next launch (same pattern as Optimize / OCR).

import { useEffect, useRef, useState, type ReactElement } from "react";
import { X, Stamp } from "lucide-react";
import { useBackdropClose } from "./modalBackdrop";
import type { StampId } from "../../shared/types";
import {
  DEFAULT_STAMP_ID,
  STAMP_CANVAS_H,
  STAMP_CANVAS_W,
  STAMP_IDS,
  STAMP_STYLES,
  drawStamp,
  renderStampToPng,
} from "../annotations/stampRender";

export interface StampConfirm {
  stampId: StampId;
  pngBytes: Uint8Array;
  pngWidth: number;
  pngHeight: number;
  /** 1-based visible page the stamp lands on. The host centers the
   *  stamp on this page at the on-page center. */
  page: number;
}

interface StampDialogProps {
  open: boolean;
  /** Total pages on the active doc. Drives the "Place on page"
   *  picker so the user can choose which page the stamp lands on. */
  totalPages: number;
  /** 1-based visible page the user is currently looking at. Used
   *  to seed the picker so the natural action is "stamp the page
   *  I'm on". */
  currentPage: number;
  /** Mirrors AppSettings.defaultStampId. Re-seeds on open. */
  initialStampId: StampId;
  /** Fires whenever the user picks a different stamp id. The host
   *  persists the choice through the preferences reducer. */
  onStampIdChange?: (id: StampId) => void;
  /** Fires when the user confirms "Place on page". The host places
   *  the stamp centered on the picked page. */
  onConfirm: (choice: StampConfirm) => void;
  onClose: () => void;
}

export function StampDialog(
  props: StampDialogProps,
): ReactElement | null {
  const {
    open,
    totalPages,
    currentPage,
    initialStampId,
    onStampIdChange,
    onConfirm,
    onClose,
  } = props;
  const [stampId, setStampId] = useState<StampId>(initialStampId);
  const [page, setPage] = useState<number>(currentPage);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Reset on open / initialStampId change. Re-seed `page` from
  // currentPage so the user lands on their natural pick.
  useEffect(() => {
    if (!open) return;
    setStampId(initialStampId);
    setPage(currentPage);
    setError(null);
  }, [open, initialStampId, currentPage]);

  // B13 — focus the first interactive control ONLY on the rising
  // edge of `open`. The previous effect also fired on every
  // `onClose` identity change, which can shift focus to the
  // language / page-number `<select>` and dismiss the popup the
  // user is actively hovering. Same microtask deferral as the
  // OCR dialog so the focus lands cleanly after React's commit
  // phase.
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

  // B3/B6 — backdrop close only when the interaction started on the
  // backdrop (a drag from the stamp picker must not dismiss).
  const backdrop = useBackdropClose(onClose);

  if (!open) return null;

  const onConfirmClick = (): void => {
    setError(null);
    try {
      const { pngBytes, width, height } = renderStampToPng(stampId);
      // The canvas may not exist in jsdom without a polyfilled
      // 2D backend (we still returned a placeholder 1x1 PNG). Guard
      // against that case so the engine doesn't embed a no-op
      // stamp and the user gets a clear error. We also check the
      // byte length and PNG magic because the canvas may be
      // present but fail to encode to data:URL — `canvas.toDataURL`
      // can return `"data:image/png;base64,"` (empty base64) when
      // the canvas is zero-area or the encoding backend is broken,
      // and the previous check (`width <= 1`) wouldn't catch that
      // because the function returns the requested STAMP_CANVAS_W/H
      // regardless of how many bytes the encode actually produced.
      // The engine would then receive a `pngBytes: []` stamp and
      // bake a blank rectangle into the page (DEF-063).
      const pngMagic = pngBytes.byteLength >= 4
        && pngBytes[0] === 0x89
        && pngBytes[1] === 0x50
        && pngBytes[2] === 0x4e
        && pngBytes[3] === 0x47;
      if (width <= 1 || height <= 1 || pngBytes.byteLength === 0 || !pngMagic) {
        setError(
          "Could not render the stamp raster — the browser canvas backend is unavailable or the encode produced empty bytes. Try a different stamp or restart the app.",
        );
        return;
      }
      onConfirm({ stampId, pngBytes, pngWidth: width, pngHeight: height, page });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Could not render stamp: ${msg}`);
    }
  };

  return (
    <div className="modal-backdrop" {...backdrop} data-stamp-dialog>
      <div
        className="modal-dialog dialog"
        ref={dialogRef}
        onClick={(e): void => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stamp-dialog-title"
      >
        <div className="modal-header">
          <h2 id="stamp-dialog-title" className="modal-title">
            Stamp
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
            Pick a built-in stamp. After confirming, the next click on a
            page drops the stamp at that location. Stamps are baked into
            the page content on save.
          </p>

          <fieldset className="modal-position">
            <legend>Stamp</legend>
            {STAMP_IDS.map((id) => (
              <label key={id} className="stamp-option">
                <input
                  type="radio"
                  name="stamp-id"
                  value={id}
                  checked={stampId === id}
                  onChange={(): void => {
                    setStampId(id);
                    onStampIdChange?.(id);
                  }}
                  data-stamp-id={id}
                />
                <span className="stamp-option-text">
                  <span className="stamp-option-label">{STAMP_STYLES[id].label}</span>
                  <span className="stamp-option-desc">
                    {describeStamp(id)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <section className="stamp-preview-wrap" aria-label="Stamp preview">
            <header className="stamp-preview-header">
              <span className="stamp-preview-title">Preview</span>
              <span className="stamp-preview-meta">
                {STAMP_CANVAS_W} × {STAMP_CANVAS_H} px
              </span>
            </header>
            <StampPreview stampId={stampId} />
          </section>

          <label className="modal-field">
            <span>Place on page</span>
            <select
              className="modal-input"
              value={page}
              onChange={(e): void => setPage(Number(e.target.value))}
              data-stamp-page-select
            >
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <option key={p} value={p}>
                  Page {p}
                </option>
              ))}
            </select>
            <span className="modal-hint">
              The stamp is centered on the picked page at a default
              size (60 pt tall, width derived from the stamp's aspect
              ratio).
            </span>
          </label>

          {error !== null && (
            <div className="modal-status optimize-error" role="alert">
              <span>{error}</span>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirmClick}
            data-stamp-confirm
          >
            <Stamp size={14} aria-hidden />
            Place on page
          </button>
        </div>
      </div>
    </div>
  );
}

function describeStamp(id: StampId): string {
  switch (id) {
    case "APPROVED":
      return "Green, for marking approved documents.";
    case "DRAFT":
      return "Gray, for marking work-in-progress drafts.";
    case "CONFIDENTIAL":
      return "Red, for marking sensitive / restricted documents.";
    case "FINAL":
      return "Blue, for marking final / released documents.";
  }
}

/** Live preview of the selected stamp. Re-renders when `stampId`
 *  changes; uses the same `drawStamp` helper the embed pipeline
 *  uses so the preview matches the embedded raster exactly. */
function StampPreview({ stampId }: { stampId: StampId }): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (c === null) return;
    const ctx = c.getContext("2d");
    if (ctx === null) return;
    drawStamp(ctx, stampId, STAMP_CANVAS_W, STAMP_CANVAS_H);
  }, [stampId]);

  return (
    <div className="stamp-preview-frame">
      <canvas
        ref={canvasRef}
        className="stamp-preview-canvas"
        width={STAMP_CANVAS_W}
        height={STAMP_CANVAS_H}
        data-stamp-preview={stampId}
        aria-label={`Preview of ${stampId} stamp`}
      />
    </div>
  );
}

export { DEFAULT_STAMP_ID, STAMP_IDS };