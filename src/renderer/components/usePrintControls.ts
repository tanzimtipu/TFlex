// Phase 35 - the print control surface, factored out of `PrintDialog` so the
// in-app modal and the standalone print window drive ONE implementation.
//
// The hook owns the whole print surface: the printer list, every option, the
// live preview raster, the print run and its result states. The markup lives
// in `PrintPanel` (also shared). Each host supplies only its own chrome
// (modal backdrop + drag header vs. a plain window layout) and the document
// source, which is why the two paths cannot drift.
//
// `resolveActiveDoc` is the one adapter seam: the in-app dialog returns its
// live pdf.js proxy, the standalone window returns a proxy it parsed from the
// engine's bytes for the context `docId`. Neither host rasterises anything
// itself - both go through the existing `rasterizePagesForPrint`.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { rasterizePagesForPrint, type PrintPageImage } from "../pdf/printRaster";
import {
  resolveSelectedPages,
  type PrintOddEven,
  type PrintScope,
} from "../pdf/printSelection";
import {
  buildPrintSettings,
  clampCopies,
  clampScalePercent,
  isCancelReason,
  seedPrintDialogState,
  type PrintDialogState,
  type PrintOrientation,
} from "../pdf/printSettings";
import { printSheetLayout } from "../../shared/printLayout";
import type {
  PrintDuplex,
  PrintJobPayload,
  PrintJobResult,
  PrintPageOrder,
  PrintPreset,
  PrintScaling,
  PrinterInfo,
  PrintSettings,
} from "../../shared/types";

/** Preview raster resolution - deliberately low; the preview is a live
 *  layout sketch, not a proof print. */
export const PREVIEW_DPI = 48;

/** Phase 81 - mirror of `PRINT_PRESETS_CAP` in the main settings service. */
const PRINT_PRESETS_CAP = 30;

/** Phase 35 - human copy for the typed print-failure reasons the print
 *  service reports. An unknown reason (e.g. an OS `failureReason` string)
 *  passes through verbatim, matching pre-Phase-35 behaviour. */
const PRINT_FAILURE_MESSAGES: Record<string, string> = {
  "print-to-pdf-failed": "Could not create the PDF. Try again or choose another destination.",
  "save-write-failed": "Could not write the PDF to the selected location.",
  "print-timeout": "The print job timed out before the printer responded.",
};

export function printFailureMessage(reason: string): string {
  return PRINT_FAILURE_MESSAGES[reason] ?? reason;
}

export interface PrintProgress {
  total: number;
  done: number;
  currentPage: number | null;
}

export interface UsePrintControlsArgs {
  /** Dialog: `open`. Standalone window: always true. */
  active: boolean;
  totalPages: number;
  currentPage: number;
  resolveActiveDoc: () => PDFDocumentProxy | null;
  listPrinters: () => Promise<PrinterInfo[]>;
  printJob: (payload: PrintJobPayload) => Promise<PrintJobResult>;
  onClose: () => void;
  /** Standalone window: the settings carried by its context. */
  seed?: PrintSettings | null;
  /** Standalone window: a human message while the document is gone. */
  blockedReason?: string | null;
  /** Phase 81 - read the persisted named print presets. */
  loadPresets: () => Promise<PrintPreset[]>;
  /** Phase 81 - persist the named print presets (read-modify-write host). */
  savePresets: (presets: PrintPreset[]) => Promise<void>;
}

export interface PrintControls {
  // document shape (echoed for the shared panel's labels)
  totalPages: number;
  currentPage: number;
  // printer list
  printers: PrinterInfo[];
  printersLoading: boolean;
  printersError: string | null;
  deviceName: string | null;
  setDeviceName: (name: string | null) => void;
  /** DEF-301 - observable notice when a selected printer disappeared and
   *  the routing silently changed to another device. Null when none. */
  printerNotice: string | null;
  printer: PrinterInfo | null;
  // options
  copies: number;
  setCopies: (n: number) => void;
  collate: boolean;
  setCollate: (v: boolean) => void;
  scope: PrintScope;
  setScope: (s: PrintScope) => void;
  customInput: string;
  setCustomInput: (v: string) => void;
  scaling: PrintScaling;
  setScaling: (s: PrintScaling) => void;
  scalePercent: number;
  setScalePercent: (n: number) => void;
  orientation: PrintOrientation;
  setOrientation: (o: PrintOrientation) => void;
  duplex: PrintDuplex;
  setDuplex: (d: PrintDuplex) => void;
  color: boolean;
  setColor: (v: boolean) => void;
  pagesPerSheet: number;
  setPagesPerSheet: (n: number) => void;
  pageOrder: PrintPageOrder;
  setPageOrder: (o: PrintPageOrder) => void;
  oddEven: PrintOddEven;
  setOddEven: (o: PrintOddEven) => void;
  reverse: boolean;
  setReverse: (v: boolean) => void;
  printAnnotations: boolean;
  setPrintAnnotations: (v: boolean) => void;
  // Phase 81 - named print presets
  presets: PrintPreset[];
  selectedPreset: string;
  presetName: string;
  setPresetName: (n: string) => void;
  presetError: string | null;
  presetNotice: string | null;
  applyPreset: (name: string) => void;
  savePreset: () => Promise<void>;
  deletePreset: () => Promise<void>;
  // run state
  running: boolean;
  progress: PrintProgress;
  progressPercent: number;
  error: string | null;
  success: string | null;
  // selection + preview
  selection: ReturnType<typeof resolveSelectedPages>;
  selectionPages: number[];
  previewPages: number[];
  previewImages: Record<number, PrintPageImage>;
  layout: ReturnType<typeof printSheetLayout>;
  effectiveLandscape: boolean;
  sheetCount: number;
  gridStyle: { gridTemplateColumns: string; gridTemplateRows: string };
  // actions
  valid: boolean;
  dialogState: PrintDialogState;
  onConfirmPrint: () => Promise<void>;
  onCancelClick: () => void;
}

export function usePrintControls(args: UsePrintControlsArgs): PrintControls {
  const {
    active,
    totalPages,
    currentPage,
    resolveActiveDoc,
    listPrinters,
    printJob,
    onClose,
    seed,
    blockedReason,
    loadPresets,
    savePresets,
  } = args;

  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [printersLoading, setPrintersLoading] = useState(false);
  const [printersError, setPrintersError] = useState<string | null>(null);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  // DEF-301 - the printer-list resolution reads the CURRENT selection
  // synchronously (a `setDeviceName` that lands in the same task must be
  // visible to the resolve), so the ref - not the render-state value - is
  // the source of truth for the "never clobber a live selection" rule.
  const deviceNameRef = useRef<string | null>(null);
  // DEF-301 - surfaced when a selected printer disappears from the fresh
  // list and TFlex falls back to another device: the routing changed, so it
  // must be visible rather than silent.
  const [printerNotice, setPrinterNotice] = useState<string | null>(null);

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

  // Phase 81 - named print presets loaded from settings on activation.
  const [presets, setPresets] = useState<PrintPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [presetName, setPresetName] = useState("");
  const [presetError, setPresetError] = useState<string | null>(null);
  const [presetNotice, setPresetNotice] = useState<string | null>(null);

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

  const abortRef = useRef<AbortController | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  // DEF-272 - synchronous in-flight guard. The render-state `running` flag
  // only flips on the next React commit, so two activations that land in the
  // SAME task (e.g. two programmatic .click() calls inside one
  // page.evaluate) would both pass the render-state check and start two print
  // jobs. This ref is set before the first await and cleared in the finally
  // block, so the second same-task activation returns immediately.
  const inFlightRef = useRef<boolean>(false);

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

  const blocked = blockedReason ?? null;
  const valid =
    active &&
    !running &&
    blocked === null &&
    printers.length > 0 &&
    deviceName !== null &&
    selection.ok === true;

  // ---- lifecycle ---------------------------------------------------------
  /** Apply a device without clearing the notice - the resolve path uses
   *  this so a fallback notice survives the state commit. */
  const applyDevice = useCallback((name: string | null): void => {
    deviceNameRef.current = name;
    setDeviceName(name);
  }, []);

  /** The public setter: a user pick clears any stale fallback notice. The
   *  ref updates synchronously so a resolve landing in the same task sees
   *  the pick (DEF-301). */
  const selectDevice = useCallback(
    (name: string | null): void => {
      applyDevice(name);
      setPrinterNotice(null);
    },
    [applyDevice],
  );

  // Re-seed on every activation. Print options are per-print (never
  // persisted), and the active document may have changed since the last open.
  // The standalone window seeds from its context settings instead of the
  // dialog defaults.
  useEffect(() => {
    if (!active) return;
    const s = seed ? seedPrintDialogState(seed) : null;
    setCopies(s?.copies ?? 1);
    setCollate(s?.collate ?? false);
    setScope("all");
    setCustomInput("");
    setScaling(s?.scaling ?? "fit");
    setScalePercent(s?.scalePercent ?? 100);
    setOrientation(s?.orientation ?? "auto");
    setDuplex(s?.duplex ?? "simplex");
    setColor(s?.color ?? true);
    setPagesPerSheet(s?.pagesPerSheet ?? 1);
    setPageOrder(s?.pageOrder ?? "horizontal");
    setOddEven(s?.oddEven ?? "all");
    setReverse(s?.reverse ?? false);
    setPrintAnnotations(s?.printAnnotations ?? true);
    setRunning(false);
    setProgress({ total: 0, done: 0, currentPage: null });
    setError(null);
    setSuccess(null);
    setPrinterNotice(null);
    previewImagesRef.current = {};
    setPreviewImages({});
    abortRef.current?.abort();
    abortRef.current = null;
  }, [active, seed]);

  // Phase 81 - load the persisted named presets on every activation and
  // reset the preset editing state. Never load while inactive.
  useEffect(() => {
    if (!active) return;
    setPresetName("");
    setSelectedPreset("");
    setPresetError(null);
    setPresetNotice(null);
    void loadPresets()
      .then((list) => setPresets(list))
      .catch(() => setPresets([]));
  }, [active, loadPresets]);

  // Load the printer list on activation. DEF-301 - the resolution must
  // NEVER clobber a live selection. A re-resolve (reopen while this hook's
  // `printers` state persists) used to call `setDeviceName(preferred)` and
  // silently overwrite the user's pick with the system default, so a
  // "Microsoft Print to PDF" job could route to the physical device.
  // Rule: apply a device only when nothing is selected yet (a fresh dialog
  // preselects the seeded / system-default printer), or when the previously
  // selected device is no longer in the returned list - then fall back to
  // the seeded / default device and say so, because the routing changed.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setPrintersLoading(true);
    setPrintersError(null);
    void listPrinters()
      .then((list) => {
        if (cancelled) return;
        setPrinters(list);
        const current = deviceNameRef.current;
        if (current !== null && list.some((p) => p.name === current)) {
          // A valid selection exists and is still offered - leave it alone.
          setPrintersLoading(false);
          return;
        }
        // Fresh open (nothing selected): the seed wins, else the system
        // default, else the first device. A disappeared selection falls
        // back through the same chain.
        const fallback =
          (seed?.deviceName !== undefined
            ? list.find((p) => p.name === seed.deviceName)
            : undefined) ??
          list.find((p) => p.isDefault) ??
          list[0];
        if (current !== null) {
          setPrinterNotice(
            fallback !== undefined
              ? `"${current}" is no longer available. Switched to "${fallback.displayName}".`
              : `"${current}" is no longer available. Choose a printer.`,
          );
        }
        applyDevice(fallback?.name ?? null);
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
  }, [active, listPrinters, seed, applyDevice]);

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
    if (!active || previewPages.length === 0) return undefined;
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
  }, [active, previewKey, printAnnotations, resolveActiveDoc]);

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

  // Phase 81 - apply a named preset to the visible controls. The printer
  // (deviceName), page scope and custom range are deliberately untouched:
  // a preset is an option snapshot, not a routing or page-selection choice.
  const applyPreset = (name: string): void => {
    setSelectedPreset(name);
    if (name === "") return;
    const preset = presets.find((p) => p.name === name);
    if (preset === undefined) return;
    const s = seedPrintDialogState(preset.settings);
    setCopies(s.copies);
    setCollate(s.collate);
    setScaling(s.scaling);
    setScalePercent(s.scalePercent);
    setOrientation(s.orientation);
    setDuplex(s.duplex);
    setColor(s.color);
    setPagesPerSheet(s.pagesPerSheet);
    setPageOrder(s.pageOrder);
    setOddEven(s.oddEven);
    setReverse(s.reverse);
    setPrintAnnotations(s.printAnnotations);
    setPresetNotice(`Applied preset "${name}".`);
    setPresetError(null);
  };

  // Phase 81 - snapshot the current options under a trimmed name. The
  // device is NOT stored (a preset must never silently re-route a job); the
  // snapshot comes from the same mapper the print run uses.
  const savePreset = async (): Promise<void> => {
    const name = presetName.trim();
    if (name === "") {
      setPresetError("Enter a preset name.");
      setPresetNotice(null);
      return;
    }
    if (!presets.some((p) => p.name === name) && presets.length >= PRINT_PRESETS_CAP) {
      setPresetError("Preset limit reached (30). Delete one to save a new preset.");
      setPresetNotice(null);
      return;
    }
    const settings = { ...buildPrintSettings(dialogState) };
    delete settings.deviceName;
    const next = presets.some((p) => p.name === name)
      ? presets.map((p) => (p.name === name ? { name, settings } : p))
      : [...presets, { name, settings }];
    try {
      await savePresets(next);
      setPresets(next);
      setSelectedPreset(name);
      setPresetName("");
      setPresetError(null);
      setPresetNotice(`Preset "${name}" saved.`);
    } catch {
      setPresetError("Could not save the preset.");
    }
  };

  // Phase 81 - delete the selected preset.
  const deletePreset = async (): Promise<void> => {
    if (selectedPreset === "") return;
    const name = selectedPreset;
    const next = presets.filter((p) => p.name !== name);
    try {
      await savePresets(next);
      setPresets(next);
      setSelectedPreset("");
      setPresetError(null);
      setPresetNotice(`Deleted preset "${name}".`);
    } catch {
      setPresetError("Could not delete the preset.");
    }
  };

  const onConfirmPrint = async (): Promise<void> => {
    if (!valid || !selection.ok) return;
    // DEF-272 - synchronous same-task guard, set before any await so a
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
        if (result.outcome === "saved") {
          // Phase 35 - the virtual-PDF destination: TFlex wrote the file
          // itself (no OS print window). Name the path in the existing
          // success region.
          setSuccess(`Saved to ${result.path}`);
        } else {
          // Printed (explicit `outcome: 'printed'` or absent) - unchanged.
          const label = printer?.displayName ?? deviceName ?? "the printer";
          setSuccess(`Sent ${images.length} page${images.length === 1 ? "" : "s"} to ${label}.`);
        }
      } else if (isCancelReason(result.reason)) {
        // User cancellation (the OS dialog for a real printer, or the
        // Save-As dialog for the virtual-PDF destination - `save-cancelled`)
        // is not an error - stay quiet, no banner of either kind.
        setSuccess(null);
      } else {
        setError(printFailureMessage(result.reason));
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

  const onCancelClick = useCallback((): void => {
    if (running) {
      abortRef.current?.abort();
      return;
    }
    onClose();
  }, [running, onClose]);

  // Phase 33 / DEF-280 - the preview grid comes from the SHARED
  // `printSheetLayout` rule the main process composes the printed sheets
  // with, so preview and print can never disagree.
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

  return {
    totalPages,
    currentPage,
    printers,
    printersLoading,
    printersError,
    deviceName,
    setDeviceName: selectDevice,
    printerNotice,
    printer,
    copies,
    setCopies: (n: number): void => setCopies(clampCopies(n)),
    collate,
    setCollate,
    scope,
    setScope,
    customInput,
    setCustomInput,
    scaling,
    setScaling,
    scalePercent,
    setScalePercent: (n: number): void => setScalePercent(clampScalePercent(n)),
    orientation,
    setOrientation,
    duplex,
    setDuplex,
    color,
    setColor,
    pagesPerSheet,
    setPagesPerSheet,
    pageOrder,
    setPageOrder,
    oddEven,
    setOddEven,
    reverse,
    setReverse,
    printAnnotations,
    setPrintAnnotations,
    presets,
    selectedPreset,
    presetName,
    setPresetName,
    presetError,
    presetNotice,
    applyPreset,
    savePreset,
    deletePreset,
    running,
    progress,
    progressPercent,
    error,
    success,
    selection,
    selectionPages,
    previewPages,
    previewImages,
    layout,
    effectiveLandscape,
    sheetCount,
    gridStyle,
    valid,
    dialogState,
    onConfirmPrint,
    onCancelClick,
  };
}
