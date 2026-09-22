// Phase 30 — print dialog (preview-first).
//
// Entry points: the title-bar Print icon (immediately left of the
// preferences gear), File > Print and Ctrl+P — all funnel here through the
// same `open` prop.
//
// Phase 35 — this component is now the MODAL CHROME only: the backdrop, the
// draggable header, the detach control and the close/backdrop wiring. The
// whole control surface (printer list, options, live preview, print run and
// result states) lives in the shared `usePrintControls` hook + `PrintPanel`
// markup, which the standalone print window renders too — so the two paths
// cannot drift.
//
// `paperSource`/tray is intentionally absent: Electron's print API has no
// tray option, so offering it would be a silent no-op (the limitation is
// recorded in the print service).

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import { ExternalLink, GripHorizontal, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { TfBackdrop, TfDialog } from "./motion/TfMotion";
import { useBackdropClose } from "./modalBackdrop";
import { PrintPanel } from "./PrintPanel";
import { usePrintControls } from "./usePrintControls";
import {
  clampDragOffset,
  nextDragOffset,
  type DragAnchor,
  type DragOffset,
} from "./printDialogDrag";
import { buildPrintSettings } from "../pdf/printSettings";
import type {
  PrintJobPayload,
  PrintJobResult,
  PrinterInfo,
  PrintWindowContext,
} from "../../shared/types";

/** Interactive elements that own their own press — a pointerdown on one of
 *  these never starts a header drag (mirrors the shared useDragWindow hook). */
const DRAG_CONTROL_SELECTOR = "button, input, select, textarea, a, [role='button']";

/** Phase 35 — what the detach control needs to build a `PrintWindowContext`. */
export interface PrintDetachInfo {
  docId: string;
  documentName: string;
  pageCount: number;
}

export interface PrintDialogProps {
  open: boolean;
  totalPages: number;
  currentPage: number;
  resolveActiveDoc: () => PDFDocumentProxy | null;
  listPrinters: () => Promise<PrinterInfo[]>;
  printJob: (payload: PrintJobPayload) => Promise<PrintJobResult>;
  onClose: () => void;
  /** Phase 35 — the active document, so the detach control can open the
   *  print UI in its own window. Null hides the control (no document). */
  detach?: PrintDetachInfo | null;
  /** Phase 35 — receives the context to open. The host performs the open so
   *  a refusal surfaces through the host's own toast. */
  onDetach?: (context: PrintWindowContext) => void;
}

export function PrintDialog(props: PrintDialogProps): ReactElement | null {
  const {
    open,
    totalPages,
    currentPage,
    resolveActiveDoc,
    listPrinters,
    printJob,
    onClose,
    detach = null,
    onDetach,
  } = props;

  const print = usePrintControls({
    active: open,
    totalPages,
    currentPage,
    resolveActiveDoc,
    listPrinters,
    printJob,
    onClose,
  });
  const running = print.running;

  const dialogRef = useRef<HTMLDivElement | null>(null);

  // ---- movable dialog (Phase 33 item 1) ---------------------------------
  // The dialog panel is repositioned by dragging its header. The move is a
  // `translate3d` on the `.modal-drag-shell` wrapper (its own transform, so
  // the dialog surface's enter/exit motion transform is untouched and no
  // layout property changes). `dragOffsetRef` mirrors the state so a press
  // that lands before React commits still anchors from the live position.
  const [dragOffset, setDragOffset] = useState<DragOffset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragOffsetRef = useRef<DragOffset>({ x: 0, y: 0 });
  const dragAnchorRef = useRef<DragAnchor | null>(null);

  const applyDragOffset = useCallback((next: DragOffset): void => {
    dragOffsetRef.current = next;
    setDragOffset(next);
  }, []);

  // A press that lands on a control (the close button, a select, …) belongs
  // to that control and never starts a move — the same control-selector rule
  // as the shared window drag hook. The handler is attached to the HEADER
  // only (not the whole dialog), so it is never a catch-all: it never calls
  // `stopPropagation`, and `preventDefault` only suppresses the text
  // selection the drag would otherwise start.
  const onHeaderPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const target = e.target as Element | null;
    if (
      target !== null &&
      typeof target.closest === "function" &&
      target.closest(DRAG_CONTROL_SELECTOR) !== null
    ) {
      return;
    }
    const el = dialogRef.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    dragAnchorRef.current = {
      offset: dragOffsetRef.current,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      pointer: { x: e.clientX, y: e.clientY },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };

  const onHeaderPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const anchor = dragAnchorRef.current;
    if (anchor === null) return;
    applyDragOffset(nextDragOffset(anchor, e.clientX, e.clientY));
  };

  const onHeaderPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragAnchorRef.current === null) return;
    dragAnchorRef.current = null;
    setDragging(false);
    const el = e.currentTarget as HTMLElement;
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };

  // The dialog position is session-only: a freshly opened dialog returns to
  // its default centred position (the wrapper transform is cleared).
  useEffect(() => {
    if (!open) return;
    dragAnchorRef.current = null;
    applyDragOffset({ x: 0, y: 0 });
    setDragging(false);
  }, [open, applyDragOffset]);

  // ---- DEF-283: re-clamp on window resize --------------------------------
  // The drag clamp only runs while the pointer moves, anchored at drag start,
  // so a stored `translate3d` offset survives a WINDOW shrink and pushes the
  // panel (and its Print/Close controls) off-screen. Re-apply the same clamp
  // to the CURRENT offset against the LIVE viewport whenever the window
  // resizes. A frameless Electron window still fires `window.resize`, so that
  // is the robust hook here.
  useEffect(() => {
    if (!open) return;
    const reclamp = (): void => {
      const el = dialogRef.current;
      if (el === null) return;
      const rect = el.getBoundingClientRect();
      applyDragOffset(
        clampDragOffset(
          dragOffsetRef.current,
          { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, [open, applyDragOffset]);

  // Esc closes (or cancels an in-flight raster); focus the first control
  // once on open. The cancel action is read through a ref so the listener is
  // not torn down on every render (the hook returns a fresh object each
  // render).
  const cancelClickRef = useRef(print.onCancelClick);
  cancelClickRef.current = print.onCancelClick;
  const focusedOnceRef = useRef(false);
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
        if (running) cancelClickRef.current();
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    queueMicrotask((): void => {
      dialogRef.current?.querySelector<HTMLElement>("input, select, button, [tabindex]")?.focus();
    });
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, running]);

  const backdrop = useBackdropClose(onClose, running);

  // Phase 35 item 8 — hand the host the context to open the print UI in its
  // own window. The host performs the open (and its refusal toast).
  const onDetachClick = (): void => {
    if (detach === null || onDetach === undefined) return;
    onDetach({
      docId: detach.docId,
      documentName: detach.documentName,
      pageCount: detach.pageCount,
      settings: buildPrintSettings(print.dialogState),
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <TfBackdrop className="modal-backdrop" {...backdrop}>
          <div
            className="modal-drag-shell"
            data-print-dialog-shell
            data-drag-x={dragOffset.x}
            data-drag-y={dragOffset.y}
            style={{
              transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)`,
            }}
          >
          <TfDialog
            className="modal-dialog modal-dialog-wide dialog print-dialog"
            ref={dialogRef}
            onClick={(e): void => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="print-dialog-title"
          >
            <div
              className={
                dragging
                  ? "modal-header modal-header-draggable print-dialog-dragging"
                  : "modal-header modal-header-draggable"
              }
              data-print-drag-handle
              onPointerDown={onHeaderPointerDown}
              onPointerMove={onHeaderPointerMove}
              onPointerUp={onHeaderPointerUp}
              onPointerCancel={onHeaderPointerUp}
            >
              <div className="modal-header-title">
                <span className="print-drag-grip" aria-hidden>
                  <GripHorizontal size={16} />
                </span>
                <h2 id="print-dialog-title" className="modal-title">
                  Print
                </h2>
              </div>
              <div className="modal-header-actions">
                {detach !== null && onDetach !== undefined && (
                  <button
                    type="button"
                    className="modal-header-action"
                    onClick={onDetachClick}
                    title="Open these print settings in their own window"
                    aria-label="Open in a separate window"
                    data-print-detach
                  >
                    <ExternalLink size={14} aria-hidden />
                    <span>Separate window</span>
                  </button>
                )}
                <button
                  type="button"
                  className="modal-close"
                  onClick={print.onCancelClick}
                  aria-label={running ? "Cancel print" : "Close dialog"}
                  title={running ? "Cancel print" : "Close"}
                >
                  <X size={16} aria-hidden />
                </button>
              </div>
            </div>
            <PrintPanel print={print} />
          </TfDialog>
          </div>
        </TfBackdrop>
      )}
    </AnimatePresence>
  );
}
