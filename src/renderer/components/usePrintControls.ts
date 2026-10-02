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
  clampPosterGrid,
  clampPosterOverlapPt,
  clampPosterScalePercent,
  clampScalePercent,
  isCancelReason,
  posterTileCanvasBox,
  posterTileRects,
  seedPrintDialogState,
  type PrintDialogState,
  type PrintOrientation,
} from "../pdf/printSettings";
import { printSheetLayout } from "../../shared/printLayout";
import {
  bookletPageCount,
  bookletSideOffset,
  saddleStitchSequence,
  type PosterTile,
} from "../../shared/printImposition";
import type {
  BookletSubset,
  PrintDuplex,
  PrintJobPayload,
  PrintJobResult,
  PrintLayoutMode,
  PrintPageOrder,
  PrintPreset,
  PrintScaling,
  PrinterInfo,
  PrintSettings,
} from "../../shared/types";

/** Preview raster resolution - deliberately low; the preview is a live
 *  layout sketch, not a proof print. */
export const PREVIEW_DPI = 48;

/** Phase 83 - one page cell of a booklet preview side (`null` page = blank). */
export interface BookletPreviewCell {
  page: number | null;
  leftPt: number;
  rightPt: number;
}

/** Phase 83 - one saddle-stitch side (two page cells) of the booklet preview. */
export interface BookletPreviewSide {
  index: number;
  cells: BookletPreviewCell[];
}

/** Phase 83 - fallback page width (US Letter, points) used only to turn
 *  `posterOverlapPt` into a fraction before the preview raster is available.
 *  Once the page raster arrives the real point width replaces it, so preview
 *  and crop use the same normalised geometry. */
const POSTER_FALLBACK_PAGE_WIDTH_PT = 612;

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

/** Phase 83 - decode a raster data URL into an image element (no network). */
function loadPrintImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = (): void => resolve(img);
    img.onerror = (): void =>
      reject(new Error("Could not decode the page for the poster tiles."));
    img.src = dataUrl;
  });
}

/** Phase 83 - a canvas for one poster tile (OffscreenCanvas when available). */
function createTileCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Phase 83 - encode a tile canvas to a PNG data URL. */
async function tileToDataUrl(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<string> {
  const offscreen = canvas as OffscreenCanvas;
  if (typeof offscreen.convertToBlob === "function") {
    const blob = await offscreen.convertToBlob({ type: "image/png" });
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (): void => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("poster-tile-crop-failed"));
      };
      reader.onerror = (): void => reject(new Error("poster-tile-crop-failed"));
      reader.readAsDataURL(blob);
    });
  }
  return (canvas as HTMLCanvasElement).toDataURL("image/png");
}

/**
 * Phase 83 - crop one rasterised page into the shared poster tile grid,
 * row-major, one PNG data URL per tile. The tiles are the SAME normalised
 * rectangles the preview renders, scaled to the raster's pixel box, so the
 * preview and the printed tiles cannot disagree. Sequential by design: the
 * renderer must never block on a burst of canvas work.
 *
 * DEF-483 - `scale` (1 = 100%) magnifies the tile content: the source rect is
 * the ORIGINAL-page region the tile samples (already divided by the scale in
 * `posterTileRects`) and the draw target is enlarged so the composed sheet
 * shows S-times-magnified content. At `scale = 1` this is byte-identical to
 * the pre-fix crop.
 */
async function cropPosterTiles(
  image: PrintPageImage,
  tiles: PosterTile[],
  scale: number,
): Promise<string[]> {
  if (tiles.length === 0) return [];
  const source = await loadPrintImage(image.dataUrl);
  const out: string[] = [];
  for (const tile of tiles) {
    const box = posterTileCanvasBox(tile, image.widthPx, image.heightPx, scale);
    const canvas = createTileCanvas(box.dw, box.dh);
    const ctx = canvas.getContext("2d", { alpha: false }) as {
      fillStyle: string;
      fillRect: (x: number, y: number, w: number, h: number) => void;
      drawImage: (
        image: CanvasImageSource,
        sx: number,
        sy: number,
        sw: number,
        sh: number,
        dx: number,
        dy: number,
        dw: number,
        dh: number,
      ) => void;
    } | null;
    if (ctx === null) throw new Error("poster-tile-crop-failed");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, box.dw, box.dh);
    ctx.drawImage(source, box.sx, box.sy, box.sw, box.sh, 0, 0, box.dw, box.dh);
    out.push(await tileToDataUrl(canvas));
  }
  return out;
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
  // Phase 83 - imposition layout state
  layoutMode: PrintLayoutMode;
  setLayoutMode: (m: PrintLayoutMode) => void;
  bookletGutterPt: number;
  setBookletGutterPt: (n: number) => void;
  bookletCreepPt: number;
  setBookletCreepPt: (n: number) => void;
  bookletSubset: BookletSubset;
  setBookletSubset: (s: BookletSubset) => void;
  posterRows: number;
  setPosterRows: (n: number) => void;
  posterCols: number;
  setPosterCols: (n: number) => void;
  posterOverlapPt: number;
  setPosterOverlapPt: (n: number) => void;
  posterScalePercent: number;
  setPosterScalePercent: (n: number) => void;
  posterCutMarks: boolean;
  setPosterCutMarks: (v: boolean) => void;
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
  // Phase 83 - layout-derived preview data
  layoutError: string | null;
  bookletSides: BookletPreviewSide[];
  posterTiles: PosterTile[];
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

  // Phase 83 - imposition layout. Values are stored as typed (not clamped on
  // entry) so an out-of-range poster value can fail loud through
  // `layoutError`; the clamps are applied when settings are built or seeded.
  const [layoutMode, setLayoutMode] = useState<PrintLayoutMode>("single");
  const [bookletGutterPt, setBookletGutterPt] = useState(0);
  const [bookletCreepPt, setBookletCreepPt] = useState(0);
  const [bookletSubset, setBookletSubset] = useState<BookletSubset>("both");
  const [posterRows, setPosterRows] = useState(2);
  const [posterCols, setPosterCols] = useState(2);
  const [posterOverlapPt, setPosterOverlapPt] = useState(0);
  const [posterScalePercent, setPosterScalePercent] = useState(100);
  const [posterCutMarks, setPosterCutMarks] = useState(false);

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

  // Phase 83 - the poster grid/ovelap/scale/subset validity. Non-null only
  // for an actually-invalid combination; the Print action is blocked while set.
  const layoutError = useMemo((): string | null => {
    if (layoutMode === "poster") {
      const badGrid = (v: number): boolean =>
        !Number.isInteger(v) || v < 1 || v > 10;
      if (badGrid(posterRows) || badGrid(posterCols)) {
        return "Poster grid must be 1 to 10 rows and columns.";
      }
      if (!Number.isFinite(posterOverlapPt) || posterOverlapPt < 0 || posterOverlapPt > 72) {
        return "Poster overlap must be between 0 and 72 pt.";
      }
      if (
        !Number.isFinite(posterScalePercent) ||
        posterScalePercent < 10 ||
        posterScalePercent > 500
      ) {
        return "Poster scale must be between 10 and 500 percent.";
      }
    }
    if (layoutMode === "booklet" && !["both", "front", "back"].includes(bookletSubset)) {
      return "Booklet side selection is invalid.";
    }
    return null;
  }, [layoutMode, posterRows, posterCols, posterOverlapPt, posterScalePercent, bookletSubset]);

  // Phase 83 - booklet preview: the saddle-stitch sides, each a pair of page
  // cells (`null` = blank padding) with the shared `bookletSideOffset` margin.
  const bookletSides = useMemo((): BookletPreviewSide[] => {
    if (layoutMode !== "booklet" || selectionPages.length === 0) return [];
    const seq = saddleStitchSequence(selectionPages.length, bookletSubset);
    if (seq.length === 0) return [];
    const sheetCount = Math.max(1, bookletPageCount(selectionPages.length) / 4);
    const sides: BookletPreviewSide[] = [];
    for (let offset = 0; offset < seq.length; offset += 2) {
      const sideIndex = offset / 2;
      // `both` interleaves front/back per sheet; front/back emit one side per
      // physical sheet, so the side index IS the sheet index there.
      const sheetIndex = bookletSubset === "both" ? Math.floor(sideIndex / 2) : sideIndex;
      const margins = bookletSideOffset(sheetIndex, sheetCount, bookletGutterPt, bookletCreepPt);
      const cell = (entry: number | null): BookletPreviewCell => ({
        page: entry === null ? null : selectionPages[entry - 1] ?? null,
        leftPt: margins.leftPt,
        rightPt: margins.rightPt,
      });
      sides.push({ index: sideIndex, cells: [cell(seq[offset]), cell(seq[offset + 1] ?? null)] });
    }
    return sides;
  }, [layoutMode, selectionPages, bookletSubset, bookletGutterPt, bookletCreepPt]);

  // Phase 83 / DEF-483 - poster preview grid: the page normalised to a unit
  // square with the overlap expressed as a fraction of the page width. The
  // tile rects are divided by the poster scale (S = percent / 100), so the
  // preview zooms with the SAME `S` the print crop uses - the composed sheet
  // and the preview cannot disagree.
  const posterTiles = useMemo((): PosterTile[] => {
    if (layoutMode !== "poster") return [];
    const first = selectionPages[0];
    const raster = first === undefined ? undefined : previewImages[first];
    const pageWidthPt =
      raster === undefined ? POSTER_FALLBACK_PAGE_WIDTH_PT : (raster.widthPx * 72) / PREVIEW_DPI;
    const overlapFraction = pageWidthPt > 0 ? clampPosterOverlapPt(posterOverlapPt) / pageWidthPt : 0;
    return posterTileRects(
      clampPosterScalePercent(posterScalePercent) / 100,
      clampPosterGrid(posterRows),
      clampPosterGrid(posterCols),
      overlapFraction,
    );
  }, [
    layoutMode,
    selectionPages,
    previewImages,
    posterRows,
    posterCols,
    posterOverlapPt,
    posterScalePercent,
  ]);

  const previewPages = useMemo((): number[] => {
    if (layoutMode === "booklet") {
      const seen = new Set<number>();
      for (const side of bookletSides) {
        for (const cell of side.cells) {
          if (cell.page !== null) seen.add(cell.page);
        }
      }
      return Array.from(seen);
    }
    if (layoutMode === "poster") return selectionPages.slice(0, 1);
    return selectionPages.slice(0, Math.max(1, pagesPerSheet));
  }, [layoutMode, bookletSides, selectionPages, pagesPerSheet]);
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
    selection.ok === true &&
    layoutError === null;

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
    setLayoutMode(s?.layoutMode ?? "single");
    setBookletGutterPt(s?.bookletGutterPt ?? 0);
    setBookletCreepPt(s?.bookletCreepPt ?? 0);
    setBookletSubset(s?.bookletSubset ?? "both");
    setPosterRows(s?.posterRows ?? 2);
    setPosterCols(s?.posterCols ?? 2);
    setPosterOverlapPt(s?.posterOverlapPt ?? 0);
    setPosterScalePercent(s?.posterScalePercent ?? 100);
    setPosterCutMarks(s?.posterCutMarks ?? false);
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
    layoutMode,
    bookletGutterPt,
    bookletCreepPt,
    bookletSubset,
    posterRows,
    posterCols,
    posterOverlapPt,
    posterScalePercent,
    posterCutMarks,
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
    setLayoutMode(s.layoutMode);
    setBookletGutterPt(s.bookletGutterPt);
    setBookletCreepPt(s.bookletCreepPt);
    setBookletSubset(s.bookletSubset);
    setPosterRows(s.posterRows);
    setPosterCols(s.posterCols);
    setPosterOverlapPt(s.posterOverlapPt);
    setPosterScalePercent(s.posterScalePercent);
    setPosterCutMarks(s.posterCutMarks);
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
    if (!valid || !selection.ok || layoutError !== null) return;
    // DEF-272 - synchronous same-task guard, set before any await so a
    // second activation in the same task cannot start a second job. The
    // render-state `running` flag still drives the disabled UI.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setRunning(true);
    setError(null);
    setSuccess(null);
    const pages = selection.pages;
    // The pages that will actually be rasterised (booklet resends the padded
    // slot order; poster only the first page). Drives the progress counter so
    // it never lies about a run.
    const plannedPages =
      layoutMode === "booklet"
        ? saddleStitchSequence(pages.length, bookletSubset).filter(
            (entry): entry is number => entry !== null,
          )
        : layoutMode === "poster"
          ? pages.slice(0, 1)
          : pages;
    const ac = new AbortController();
    abortRef.current = ac;
    setProgress({ total: plannedPages.length, done: 0, currentPage: plannedPages[0] ?? null });
    const onProgress = (page: number): void => {
      setProgress((prev) => ({
        ...prev,
        currentPage: page,
        done: Math.min(prev.done + 1, prev.total),
      }));
    };
    try {
      const doc = resolveActiveDoc();
      if (doc === null) {
        setError("No active document.");
        setRunning(false);
        return;
      }
      let images: string[];
      let sentCount: number;
      if (layoutMode === "booklet") {
        // Phase 83 - saddle stitch. Rasterise only the real pages, then
        // assemble the payload in EXACT slot order with '' for blanks.
        const seq = saddleStitchSequence(pages.length, bookletSubset);
        const realPages = Array.from(
          new Set(seq.filter((entry): entry is number => entry !== null).map((e) => pages[e - 1])),
        );
        const rasters = await rasterizePagesForPrint({
          doc,
          pages: realPages,
          includeAnnotations: printAnnotations,
          onProgress,
          signal: ac.signal,
        });
        if (ac.signal.aborted) {
          setRunning(false);
          return;
        }
        const byPage = new Map(rasters.map((r) => [r.page, r.dataUrl]));
        images = seq.map((entry) =>
          entry === null ? "" : byPage.get(pages[entry - 1]) ?? "",
        );
        sentCount = images.filter((image) => image !== "").length;
      } else if (layoutMode === "poster") {
        // Phase 83 - rasterise the selected page once at print DPI, then crop
        // it into the shared tile grid (row-major), one image per tile.
        const rasters = await rasterizePagesForPrint({
          doc,
          pages: pages.slice(0, 1),
          includeAnnotations: printAnnotations,
          onProgress,
          signal: ac.signal,
        });
        if (ac.signal.aborted) {
          setRunning(false);
          return;
        }
        images = await cropPosterTiles(
          rasters[0],
          posterTiles,
          clampPosterScalePercent(posterScalePercent) / 100,
        );
        if (ac.signal.aborted) {
          setRunning(false);
          return;
        }
        sentCount = images.length;
      } else {
        const rasters = await rasterizePagesForPrint({
          doc,
          pages,
          includeAnnotations: printAnnotations,
          onProgress,
          signal: ac.signal,
        });
        if (ac.signal.aborted) {
          setRunning(false);
          return;
        }
        images = rasters.map((img) => img.dataUrl);
        sentCount = images.length;
      }
      const result = await printJob({
        images,
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
          setSuccess(`Sent ${sentCount} page${sentCount === 1 ? "" : "s"} to ${label}.`);
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
    layoutMode === "booklet"
      ? true
      : orientation === "landscape" || (orientation === "auto" && autoLandscape);
  const sheetCount =
    layoutMode === "booklet"
      ? bookletSides.length
      : layoutMode === "poster"
        ? clampPosterGrid(posterRows) * clampPosterGrid(posterCols)
        : selection.ok && selectionPages.length > 0
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
    // Phase 83 - imposition state. Booklet numeric fields coerce a non-finite
    // entry to their default; poster fields keep an out-of-range/NaN value so
    // `layoutError` can fail loud rather than silently clamping it away.
    layoutMode,
    setLayoutMode,
    bookletGutterPt,
    setBookletGutterPt: (n: number): void =>
      setBookletGutterPt(Number.isFinite(n) ? n : 0),
    bookletCreepPt,
    setBookletCreepPt: (n: number): void =>
      setBookletCreepPt(Number.isFinite(n) ? n : 0),
    bookletSubset,
    setBookletSubset,
    posterRows,
    setPosterRows,
    posterCols,
    setPosterCols,
    posterOverlapPt,
    setPosterOverlapPt: (n: number): void =>
      setPosterOverlapPt(Number.isFinite(n) ? n : 0),
    posterScalePercent,
    setPosterScalePercent: (n: number): void =>
      setPosterScalePercent(Number.isFinite(n) ? n : 100),
    posterCutMarks,
    setPosterCutMarks,
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
    layoutError,
    bookletSides,
    posterTiles,
  };
}
