// Phase 12 — Stamp tool dialog.
//
// Pick a built-in stamp, see a preview at the dialog's native
// size, then click "Start placement" to enter placement mode. In
// placement mode the user clicks on a page in the document area
// to drop the stamp at the click location (default rect width
// derived from the stamp's aspect ratio). The dialog copy states
// this click-to-place flow exactly; there is no page picker.
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
import { Icon } from "../icons/Icon";
import { PreviewTaskDialog } from "./PreviewTaskDialog";
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
  /** The page the user was viewing when they opened the dialog. The
   *  click-to-place flow lets the next page click choose the real page,
   *  so this is informational only. */
  page: number;
}

interface StampDialogProps {
  open: boolean;
  /** Total pages on the active doc. Kept for host compatibility; the
   *  click-to-place flow needs no page picker, so it is not rendered. */
  totalPages: number;
  /** 1-based visible page the user is currently looking at. Sent with the
   *  confirm as an informational default; the real placement page is the
   *  one the user clicks. */
  currentPage: number;
  /** Mirrors AppSettings.defaultStampId. Re-seeds on open. */
  initialStampId: StampId;
  /** Fires whenever the user picks a different stamp id. The host
   *  persists the choice through the preferences reducer. */
  onStampIdChange?: (id: StampId) => void;
  /** Fires when the user confirms placement. The host then arms the
   *  stamp; the next page click drops it at the clicked point. */
  onConfirm: (choice: StampConfirm) => void;
  onClose: () => void;
}

export function StampDialog(
  props: StampDialogProps,
): ReactElement | null {
  const {
    open,
    currentPage,
    initialStampId,
    onStampIdChange,
    onConfirm,
    onClose,
  } = props;
  const [stampId, setStampId] = useState<StampId>(initialStampId);
  const [error, setError] = useState<string | null>(null);
  // Reset on open / initialStampId change.
  useEffect(() => {
    if (!open) return;
    setStampId(initialStampId);
    setError(null);
  }, [open, initialStampId]);

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
      onConfirm({ stampId, pngBytes, pngWidth: width, pngHeight: height, page: currentPage });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Could not render stamp: ${msg}`);
    }
  };

  return (
    <PreviewTaskDialog
      open={open}
      title="Stamp"
      titleId="stamp-dialog-title"
      onClose={onClose}
      className="stamp-dialog-preview"
      data-stamp-dialog
      draggable={{ controlsSelector: "button, input, select, textarea, [role='button']" }}
      actions={[
        { key: "cancel", label: "Cancel", variant: "secondary", onClick: onClose },
        Object.assign(
          {
            key: "confirm",
            label: "Start placement",
            variant: "primary" as const,
            icon: <Icon name="stamp" size="sm" />,
            onClick: onConfirmClick,
            default: true,
          },
          { "data-stamp-confirm": true },
        ),
      ]}
    >
          <p className="modal-help">
            Pick a built-in stamp, then choose Start placement. The next click on
            a page drops the stamp at that location; the stamp is baked into the
            page content when you place it. Press Escape to cancel.
          </p>

          <fieldset className="modal-position">
            <legend>Stamp</legend>
            <div className="stamp-option-grid">
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
            </div>
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

          {error !== null && (
            <div className="modal-status optimize-error" role="alert">
              <span>{error}</span>
            </div>
          )}
    </PreviewTaskDialog>
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