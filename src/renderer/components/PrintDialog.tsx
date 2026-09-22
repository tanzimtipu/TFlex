// Phase 30 — print dialog (preview-first).
//
// Entry points: the title-bar Print icon (immediately left of the
// preferences gear), File > Print and Ctrl+P — all funnel here through the
// same `open` prop. The dialog:
//
//   1. lists the OS printers (system device name + friendly name);
//   2. lets the user choose page scope/range, scaling, orientation,
//      duplex, colour, N-up + page order, odd/even, reverse, copies and
//      the annotations toggle;
//   3. renders a LIVE preview of the first sheet from the rastered first
//      page(s) — settings that change the layout re-lay-out the preview
//      without re-rastering the whole document;
//   4. on Print, rasterises the selected pages (one image per PDF page,
//      ordered) and hands them to the main process, which composes the
//      sheets. A cancel from the OS dialog is surfaced quietly.
//
// `paperSource`/tray is intentionally absent: Electron's print API has no
// tray option, so offering it would be a silent no-op (the limitation is
// recorded in the print service).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import { GripHorizontal, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { TfBackdrop, TfDialog } from "./motion/TfMotion";
import { useBackdropClose } from "./modalBackdrop";
import {
  clampDragOffset,
  nextDragOffset,
  type DragAnchor,
  type DragOffset,
} from "./printDialogDrag";
import { printSheetLayout } from "../../shared/printLayout";
import { rasterizePagesForPrint, type PrintPageImage } from "../pdf/printRaster";
import {
  resolveSelectedPages,
  type PrintOddEven,
  type PrintScope,
} from "../pdf/printSelection";
import {
  PRINT_ALLOWED_NUP,
  buildPrintSettings,
  clampCopies,
  clampScalePercent,
  isCancelReason,
  type PrintDialogState,
  type PrintOrientation,
} from "../pdf/printSettings";
import type {
  PrintDuplex,
  PrintJobPayload,
  PrintJobResult,
  PrintPageOrder,
  PrintScaling,
  PrinterInfo,
} from "../../shared/types";

/** Preview raster resolution — deliberately low; the preview is a live
 *  layout sketch, not a proof print. */
const PREVIEW_DPI = 48;

/** Interactive elements that own their own press — a pointerdown on one of
 *  these never starts a header drag (mirrors the shared useDragWindow hook). */
const DRAG_CONTROL_SELECTOR = "button, input, select, textarea, a, [role='button']";

export interface PrintDialogProps {
  open: boolean;
  totalPages: number;
  currentPage: number;
  resolveActiveDoc: () => PDFDocumentProxy | null;
  listPrinters: () => Promise<PrinterInfo[]>;
  printJob: (payload: PrintJobPayload) => Promise<PrintJobResult>;
  onClose: () => void;
}

interface PrintProgress {
  total: number;
  done: number;
  currentPage: number | null;
}

/** Build a lookup from page number to its cached preview raster. */
function previewFor(
  images: Record<number, PrintPageImage>,
  page: number,
): string | null {
  return images[page]?.dataUrl ?? null;
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
  } = props;

  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [printersLoading, setPrintersLoading] = useState(false);
  const [printersError, setPrintersError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);

  const [copies, setCopies] = useState(1);
  const [collate, setCollate] = useState(false);
  const [scope, setScope] = useState<PrintScope>("all");
  const [customInput, setCustomInput] = useState("");
  const [scaling, setScaling] = useState<PrintScaling>("fit");
  const [scalePercent, setScalePercent] = useState(100);
  const [orientation, setOrientation] = useState<PrintOrientation>("auto");
  const [duplex, setDuplex] = useState<PrintDuplex>("simplex");
  const [color, setColor] = useState(true);
  const [pagesPerSheet, setPagesPerSheet] = useState(1);
  const [pageOrder, setPageOrder] = useState<PrintPageOrder>("horizontal");
  const [oddEven, setOddEven] = useState<PrintOddEven>("all");
  const [reverse, setReverse] = useState(false);
  const [printAnnotations, setPrintAnnotations] = useState(true);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<PrintProgress>({
    total: 0,
    done: 0,
    currentPage: null,
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [previewImages, setPreviewImages] = useState<Record<number, PrintPageImage>>({});
  const previewImagesRef = useRef<Record<number, PrintPageImage>>({});

const dialogRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  // DEF-272 — synchronous in-flight guard. The render-state `running`
  // flag only flips on the next React commit, so two activations that
  // land in the SAME task (e.g. two programmatic .click() calls inside
  // one page.evaluate) would both pass the render-state check and start
  // two print jobs. This ref is set before the first await and cleared
  // in the finally block, so the second same-task activation returns
  // immediately.
  const inFlightRef = useRef<boolean>(false);

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

  // ---- derived selection -------------------------------------------------
  const selection = useMemo(
    () =>
      resolveSelectedPages({
        scope,
        totalPages,
        currentPage,
        customInput,
        oddEven,
        reverse,
      }),
    [scope, totalPages, currentPage, customInput, oddEven, reverse],
  );
  const selectionPages = selection.ok ? selection.pages : [];

  const previewPages = useMemo(
    () => selectionPages.slice(0, Math.max(1, pagesPerSheet)),
    [selectionPages, pagesPerSheet],
  );
  const previewKey = previewPages.join(",");

  const printer = useMemo(
    () => printers.find((p) => p.name === deviceName) ?? null,
    [printers, deviceName],
  );
  const autoLandscape = useMemo(() => {
    const first = previewImages[previewPages[0] ?? -1];
    if (first === undefined) return false;
    return first.widthPx > first.heightPx;
  }, [previewImages, previewPages]);

  const valid =
    open &&
    !running &&
    printers.length > 0 &&
    deviceName !== null &&
    selection.ok === true;

  // ---- lifecycle ---------------------------------------------------------
  // Re-seed on every open. Print options are per-print (never persisted),
  // and the active document may have changed since the last open.
  useEffect(() => {
    if (!open) return;
    setCopies(1);
    setCollate(false);
    setScope("all");
    setCustomInput("");
    setScaling("fit");
    setScalePercent(100);
    setOrientation("auto");
    setDuplex("simplex");
    setColor(true);
    setPagesPerSheet(1);
    setPageOrder("horizontal");
    setOddEven("all");
    setReverse(false);
    setPrintAnnotations(true);
    setRunning(false);
    setProgress({ total: 0, done: 0, currentPage: null });
    setError(null);
    setSuccess(null);
previewImagesRef.current = {};
    setPreviewImages({});
    abortRef.current?.abort();
    abortRef.current = null;
    // The dialog position is session-only: a freshly opened dialog returns
    // to its default centred position (the wrapper transform is cleared).
    dragAnchorRef.current = null;
    applyDragOffset({ x: 0, y: 0 });
    setDragging(false);
  }, [open]);

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

  // Load the printer list on open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPrintersLoading(true);
    setPrintersError(null);
    void listPrinters()
      .then((list) => {
        if (cancelled) return;
        setPrinters(list);
        const preferred = list.find((p) => p.isDefault) ?? list[0];
        setDeviceName(preferred?.name ?? null);
        setPrintersLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPrintersError(e instanceof Error ? e.message : String(e));
        setPrinters([]);
        setPrintersLoading(false);
      });
    return (): void => {
      cancelled = true;
    };
  }, [open, listPrinters]);

  // Invalidate cached preview rasters when the annotations toggle changes
  // (the same pages raster differently with/without the overlay).
  useEffect(() => {
    previewImagesRef.current = {};
    setPreviewImages({});
  }, [printAnnotations]);

  // Rasterise only the pages the preview actually shows, sequentially and
  // cancellably. Layout-only settings (scaling, duplex, colour, copies)
  // never touch this effect, so they do not re-raster anything.
  useEffect(() => {
    if (!open || previewPages.length === 0) return undefined;
    const missing = previewPages.filter((p) => previewImagesRef.current[p] === undefined);
    if (missing.length === 0) return undefined;
    const doc = resolveActiveDoc();
    if (doc === null) return undefined;
    const ac = new AbortController();
    previewAbortRef.current?.abort();
    previewAbortRef.current = ac;
    let cancelled = false;
    void (async (): Promise<void> => {
      try {
        const imgs = await rasterizePagesForPrint({
          doc,
          pages: missing,
          includeAnnotations: printAnnotations,
          dpi: PREVIEW_DPI,
          signal: ac.signal,
        });
        if (cancelled || ac.signal.aborted) return;
        const next = { ...previewImagesRef.current };
        for (const img of imgs) next[img.page] = img;
        previewImagesRef.current = next;
        setPreviewImages(next);
      } catch {
        // Aborts and unavailable raster paths leave the placeholder in
        // place; the Print action surfaces any real failure.
      }
    })();
    return (): void => {
      cancelled = true;
      ac.abort();
    };
  }, [open, previewKey, printAnnotations, resolveActiveDoc]);

  // Esc closes (or cancels an in-flight raster); focus the first control
  // once on open.
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
        if (running) abortRef.current?.abort();
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

  const dialogState: PrintDialogState = {
    deviceName,
    copies,
    collate,
    scaling,
    scalePercent,
    orientation,
    autoLandscape,
    duplex,
    color,
    pagesPerSheet,
    pageOrder,
    oddEven,
    reverse,
    printAnnotations,
  };

  const onConfirmPrint = async (): Promise<void> => {
    if (!valid || !selection.ok) return;
    // DEF-272 — synchronous same-task guard, set before any await so a
    // second activation in the same task cannot start a second job. The
    // render-state `running` flag still drives the disabled UI.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setRunning(true);
    setError(null);
    setSuccess(null);
    const pages = selection.pages;
    const ac = new AbortController();
    abortRef.current = ac;
    setProgress({ total: pages.length, done: 0, currentPage: pages[0] ?? null });
    try {
      const doc = resolveActiveDoc();
      if (doc === null) {
        setError("No active document.");
        setRunning(false);
        return;
      }
      const images = await rasterizePagesForPrint({
        doc,
        pages,
        includeAnnotations: printAnnotations,
        onProgress: (page): void => {
          setProgress((prev) => ({
            ...prev,
            currentPage: page,
            done: Math.min(prev.done + 1, prev.total),
          }));
        },
        signal: ac.signal,
      });
      if (ac.signal.aborted) {
        setRunning(false);
        return;
      }
      const result = await printJob({
        images: images.map((img) => img.dataUrl),
        settings: buildPrintSettings(dialogState),
      });
      if (ac.signal.aborted) {
        setRunning(false);
        return;
      }
      if (result.ok) {
        const label = printer?.displayName ?? deviceName ?? "the printer";
        setSuccess(`Sent ${images.length} page${images.length === 1 ? "" : "s"} to ${label}.`);
      } else if (isCancelReason(result.reason)) {
        // User cancellation (e.g. the OS dialog for a PDF destination) is
        // not an error — stay quiet.
        setSuccess(null);
      } else {
        setError(result.reason);
      }
    } catch (e) {
      if (!ac.signal.aborted) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      inFlightRef.current = false;
      setRunning(false);
    }
  };

  const onCancelClick = (): void => {
    if (running) {
      abortRef.current?.abort();
      return;
    }
    onClose();
  };

  // Phase 33 / DEF-280 — the preview grid comes from the SHARED
  // `printSheetLayout` rule the main process composes the printed sheets
  // with, so preview and print can never disagree. `layout.slots[cellIndex]`
  // is the IMAGE index that belongs in that row-major DOM cell; the order
  // now changes BOTH the grid dimensions (2-up Horizontal 2x1 vs Vertical
  // 1x2; 6-up 3x2 vs 2x3) and the fill flow, instead of a CSS direction /
  // grid-auto-flow trick that left the dimensions fixed.
  const layout = printSheetLayout(pagesPerSheet, pageOrder);
  const effectiveLandscape =
    orientation === "landscape" || (orientation === "auto" && autoLandscape);
  const sheetCount =
    selection.ok && selectionPages.length > 0
      ? Math.ceil(selectionPages.length / pagesPerSheet)
      : 0;
  const gridStyle = {
    gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
    gridTemplateRows: `repeat(${layout.rows}, 1fr)`,
  };
  const progressPercent =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

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
              <button
                type="button"
                className="modal-close"
                onClick={onCancelClick}
                aria-label={running ? "Cancel print" : "Close dialog"}
                title={running ? "Cancel print" : "Close"}
              >
                <X size={16} aria-hidden />
              </button>
            </div>
            <div className="modal-body print-body">
              <div className="print-controls">
                {printersLoading && (
                  <p className="modal-help">Loading printers…</p>
                )}
                {printersError !== null && (
                  <p className="modal-help print-empty" data-print-printers-error>
                    Could not list printers: {printersError}
                  </p>
                )}
                {!printersLoading && printersError === null && printers.length === 0 && (
                  <p className="modal-help print-empty" data-print-empty>
                    No printers were found. Install a printer to print this document.
                  </p>
                )}

                <label className="modal-field">
                  <span>Printer</span>
                  <select
                    className="modal-input"
                    value={deviceName ?? ""}
                    onChange={(e): void => setDeviceName(e.target.value || null)}
                    disabled={running || printers.length === 0}
                    data-print-printer
                    aria-label="Printer"
                  >
                    {printers.length === 0 && <option value="">No printers available</option>}
                    {printers.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.displayName}
                        {p.isDefault ? " (default)" : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="print-row">
                  <label className="modal-field print-copies">
                    <span>Copies</span>
                    <input
                      type="number"
                      className="modal-input"
                      min={1}
                      max={99}
                      value={copies}
                      onChange={(e): void => setCopies(clampCopies(Number.parseInt(e.target.value, 10)))}
                      disabled={running}
                      data-print-copies
                      aria-label="Copies"
                    />
                  </label>
                  <label className="print-check">
                    <input
                      type="checkbox"
                      checked={collate}
                      onChange={(e): void => setCollate(e.target.checked)}
                      disabled={running || copies <= 1}
                      data-print-collate
                    />
                    <span>Collate</span>
                  </label>
                </div>

                <fieldset className="modal-position print-radio-group">
                  <legend>Page range</legend>
                  <label>
                    <input
                      type="radio"
                      name="print-range"
                      checked={scope === "all"}
                      onChange={(): void => setScope("all")}
                      disabled={running}
                      data-print-range-all
                    />
                    <span>All pages ({totalPages})</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="print-range"
                      checked={scope === "current"}
                      onChange={(): void => setScope("current")}
                      disabled={running}
                      data-print-range-current
                    />
                    <span>Current page ({currentPage})</span>
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="print-range"
                      checked={scope === "custom"}
                      onChange={(): void => setScope("custom")}
                      disabled={running}
                      data-print-range-custom
                    />
                    <span>Custom</span>
                  </label>
                </fieldset>
                <label className="modal-field">
                  <input
                    type="text"
                    className="modal-input"
                    placeholder="1-5, 8, 11-13"
                    value={customInput}
                    onChange={(e): void => setCustomInput(e.target.value)}
                    disabled={running || scope !== "custom"}
                    data-print-range-input
                    aria-label="Custom page range"
                    aria-invalid={scope === "custom" && !selection.ok}
                  />
                  {scope === "custom" && !selection.ok && (
                    <span className="modal-hint print-range-error" role="alert" data-print-range-error>
                      {selection.error}
                    </span>
                  )}
                </label>

                <fieldset className="modal-position print-radio-group">
                  <legend>Scaling</legend>
                  {(
                    [
                      ["fit", "Fit to page", "data-print-scale-fit"],
                      ["actual", "Actual size", "data-print-scale-actual"],
                      ["shrink", "Shrink oversized pages", "data-print-scale-shrink"],
                      ["custom", "Custom", "data-print-scale-custom"],
                    ] as const
                  ).map(([value, label, attr]) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name="print-scale"
                        checked={scaling === value}
                        onChange={(): void => setScaling(value)}
                        disabled={running}
                        {...{ [attr]: "" }}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </fieldset>
                <label className="modal-field">
                  <span>Scale percent</span>
                  <input
                    type="number"
                    className="modal-input"
                    min={1}
                    max={500}
                    value={scalePercent}
                    onChange={(e): void => setScalePercent(clampScalePercent(Number.parseInt(e.target.value, 10)))}
                    disabled={running || scaling !== "custom"}
                    data-print-scale-percent
                    aria-label="Custom scale percent"
                  />
                </label>

                <fieldset className="modal-position print-radio-group">
                  <legend>Orientation</legend>
                  {(
                    [
                      ["auto", "Auto", "data-print-orientation-auto"],
                      ["portrait", "Portrait", "data-print-orientation-portrait"],
                      ["landscape", "Landscape", "data-print-orientation-landscape"],
                    ] as const
                  ).map(([value, label, attr]) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name="print-orientation"
                        checked={orientation === value}
                        onChange={(): void => setOrientation(value)}
                        disabled={running}
                        {...{ [attr]: "" }}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </fieldset>

                <div className="print-row print-row-selects">
                  <label className="modal-field">
                    <span>Duplex</span>
                    <select
                      className="modal-input"
                      value={duplex}
                      onChange={(e): void => setDuplex(e.target.value as PrintDuplex)}
                      disabled={running}
                      data-print-duplex
                      aria-label="Duplex"
                    >
                      <option value="simplex">Simplex</option>
                      <option value="longEdge">Long edge</option>
                      <option value="shortEdge">Short edge</option>
                    </select>
                  </label>
                  <label className="modal-field">
                    <span>Colour</span>
                    <select
                      className="modal-input"
                      value={color ? "color" : "grey"}
                      onChange={(e): void => setColor(e.target.value === "color")}
                      disabled={running}
                      data-print-color
                      aria-label="Colour mode"
                    >
                      <option value="color">Colour</option>
                      <option value="grey">Greyscale</option>
                    </select>
                  </label>
                </div>

                <div className="print-row print-row-selects">
                  <label className="modal-field">
                    <span>Pages per sheet</span>
                    <select
                      className="modal-input"
                      value={pagesPerSheet}
                      onChange={(e): void => setPagesPerSheet(Number.parseInt(e.target.value, 10))}
                      disabled={running}
                      data-print-nup
                      aria-label="Pages per sheet"
                    >
                      {PRINT_ALLOWED_NUP.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="modal-field">
                    <span>Page order</span>
                    <select
                      className="modal-input"
                      value={pageOrder}
                      onChange={(e): void => setPageOrder(e.target.value as PrintPageOrder)}
                      disabled={running || pagesPerSheet <= 1}
                      data-print-page-order
                      aria-label="Page order"
                    >
                      <option value="horizontal">Horizontal</option>
                      <option value="horizontalReversed">Horizontal reversed</option>
                      <option value="vertical">Vertical</option>
                      <option value="verticalReversed">Vertical reversed</option>
                    </select>
                  </label>
                </div>

                <div className="print-row print-row-selects">
                  <label className="modal-field">
                    <span>Pages</span>
                    <select
                      className="modal-input"
                      value={oddEven}
                      onChange={(e): void => setOddEven(e.target.value as PrintOddEven)}
                      disabled={running}
                      data-print-odd-even
                      aria-label="Odd or even pages"
                    >
                      <option value="all">All</option>
                      <option value="odd">Odd only</option>
                      <option value="even">Even only</option>
                    </select>
                  </label>
                  <label className="print-check">
                    <input
                      type="checkbox"
                      checked={reverse}
                      onChange={(e): void => setReverse(e.target.checked)}
                      disabled={running}
                      data-print-reverse
                    />
                    <span>Reverse order</span>
                  </label>
                </div>

                <label className="print-check">
                  <input
                    type="checkbox"
                    checked={printAnnotations}
                    onChange={(e): void => setPrintAnnotations(e.target.checked)}
                    disabled={running}
                    data-print-annotations
                  />
                  <span>Include annotations</span>
                </label>

                {running && (
                  <div className="modal-status print-progress" aria-live="polite" data-print-progress>
                    <div className="ocr-progress-header">
                      <span>
                        Rendering for print…
                        {progress.currentPage !== null && (
                          <> page {progress.currentPage} of {progress.total}</>
                        )}
                      </span>
                      <span className="ocr-progress-percent">{progressPercent}%</span>
                    </div>
                    <div className="ocr-progress-track" aria-hidden>
                      <div
                        className="ocr-progress-fill"
                        style={{ width: `${progressPercent}%` }}
                        data-print-progress-fill
                      />
                    </div>
                  </div>
                )}

                {error !== null && (
                  <div className="modal-status optimize-error" role="alert" data-print-error>
                    <span>{error}</span>
                  </div>
                )}
                {success !== null && (
                  <div className="modal-status" role="status" data-print-success>
                    <span>{success}</span>
                  </div>
                )}
              </div>

              <div className="print-preview" data-print-preview>
                <div className="print-preview-title">Preview</div>
                <div
                  className="print-preview-sheet"
                  data-print-preview-sheet
                  data-landscape={effectiveLandscape}
                  style={gridStyle}
                >
                  {layout.slots.map((imageIndex, cellIndex) => {
                    const page = previewPages[imageIndex];
                    if (page === undefined) {
                      return (
                        <div
                          key={cellIndex}
                          className="print-preview-cell print-preview-blank"
                          data-print-preview-cell={cellIndex}
                        />
                      );
                    }
                    const src = previewFor(previewImages, page);
                    return (
                      <div
                        key={cellIndex}
                        className="print-preview-cell"
                        data-print-preview-cell={cellIndex}
                        data-print-preview-page={page}
                      >
                        {src !== null ? (
                          <img src={src} alt={`Page ${page}`} />
                        ) : (
                          <span className="print-preview-placeholder" aria-hidden />
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="print-preview-meta" data-print-preview-meta>
                  {selection.ok
                    ? `${selectionPages.length} page${selectionPages.length === 1 ? "" : "s"} · ${sheetCount} sheet${sheetCount === 1 ? "" : "s"}`
                    : selection.error}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onCancelClick}
                data-print-cancel
              >
                {running ? "Cancel" : "Close"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!valid}
                onClick={(): void => {
                  void onConfirmPrint();
                }}
                data-print-confirm
              >
                {running ? "Printing…" : "Print"}
              </button>
            </div>
          </TfDialog>
          </div>
        </TfBackdrop>
      )}
    </AnimatePresence>
  );
}
