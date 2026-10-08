// Phase 35 - the shared print surface markup.
//
// Extracted verbatim from `PrintDialog` so the in-app modal and the
// standalone print window render ONE set of controls, one preview and one
// set of result states. Every `data-print-*` selector the suites pin lives
// here; the only difference between the two hosts is the chrome they wrap it
// in (modal backdrop + draggable header vs. a plain window layout).
//
// Phase 120 B - the same surface is now grouped into semantic sections
// (Destination / Pages / Layout / Appearance) inside the Output Studio window.
// Grouping is presentation only: every control keeps its exact `data-print-*`
// selector, default value and `usePrintControls` handler, and the preview
// still renders the REAL `layout` / `sheetCount` / `gridStyle` / `bookletSides`
// / `posterTiles` geometry. The wide two-column layout and the compact stacked
// layout are the SAME surface switched by one declared logical-pixel breakpoint
// (no per-call-site media query).

import { useEffect, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { PrintPageImage } from "../pdf/printRaster";
import {
  clampPosterGrid,
  PRINT_ALLOWED_NUP,
  type PrintOrientation,
} from "../pdf/printSettings";
import type { PrintOddEven } from "../pdf/printSelection";
import type {
  BookletSubset,
  PrintDuplex,
  PrintLayoutMode,
  PrintPageOrder,
} from "../../shared/types";
import type { PrintControls } from "./usePrintControls";

/** Phase 120 B - the ONE declared logical-pixel threshold for the Output
 *  Studio layout. At or above this window width the settings column and the
 *  preview stage sit side by side; below it the surface stacks (settings
 *  above a small preview). This is the single source of the breakpoint - the
 *  CSS switches on the resulting `data-print-layout-mode` attribute, so no
 *  per-call-site media query is ever needed. Mirrors the shared
 *  `--tf-break-compact` token (720px) in styles.css. */
export const PRINT_OUTPUT_BREAKPOINT_PX = 720;

/** True when the window is narrower than the one declared breakpoint. Reads
 *  the logical viewport width and re-evaluates on resize; no media query. */
function useCompactOutput(): boolean {
  const read = (): boolean =>
    typeof window === "undefined"
      ? false
      : window.innerWidth < PRINT_OUTPUT_BREAKPOINT_PX;
  const [compact, setCompact] = useState<boolean>(read);
  useEffect((): (() => void) => {
    const onResize = (): void => setCompact(read());
    window.addEventListener("resize", onResize);
    onResize();
    return (): void => window.removeEventListener("resize", onResize);
  }, []);
  return compact;
}

interface PrintGroupProps {
  id: string;
  heading: string;
  compact: boolean;
  /** Advanced groups collapse in the compact layout but stay fully reachable. */
  collapsible?: boolean;
  children: ReactNode;
}

/** One semantic settings group. Required groups render an always-visible
 *  native `<fieldset>` + `<legend>`; advanced groups render a `<details>` that
 *  opens by default on the wide layout and collapses on the compact layout,
 *  with its body exposed as a labelled `role="group"`. Either way every control
 *  stays in the DOM and keeps its handler. */
function PrintGroup({
  id,
  heading,
  compact,
  collapsible = false,
  children,
}: PrintGroupProps): ReactElement {
  if (collapsible) {
    return (
      <details
        className="print-group print-group-advanced"
        data-print-group={id}
        data-print-group-advanced
        open={!compact}
      >
        <summary className="print-group-heading">{heading}</summary>
        <div className="print-group-body" role="group" aria-label={heading}>
          {children}
        </div>
      </details>
    );
  }
  return (
    <fieldset className="print-group" data-print-group={id}>
      <legend className="print-group-heading">{heading}</legend>
      <div className="print-group-body">{children}</div>
    </fieldset>
  );
}

/** Build a lookup from page number to its cached preview raster. */
function previewFor(
  images: Record<number, PrintPageImage>,
  page: number,
): string | null {
  return images[page]?.dataUrl ?? null;
}

/** Phase 120 C - a concise "1-3, 5" rendering of the resolved page set, so the
 *  consequence summary names the real selection instead of dumping the array.
 *  The shared `parsePageRanges` normalises a typed range to a sorted,
 *  de-duplicated page set; this helper only formats that normalised set. */
export function formatPageSet(pages: number[]): string {
  const first = pages[0];
  if (first === undefined) return "";
  const sorted = [...pages].sort((a, b) => a - b);
  const runs: string[] = [];
  let start = sorted[0] ?? first;
  let prev = start;
  for (let i = 1; i <= sorted.length; i += 1) {
    const current = sorted[i];
    if (current !== undefined && current === prev + 1) {
      prev = current;
      continue;
    }
    runs.push(start === prev ? `${start}` : `${start}-${prev}`);
    if (current !== undefined) {
      start = current;
      prev = current;
    }
  }
  return runs.join(", ");
}

/** DEF-650 - true when the raw custom-range text names the same page number
 *  more than once, so the consequence summary can disclose the merge that the
 *  shared `parsePageRanges` performs. Scans only the literal numbers the user
 *  typed (a range contributes its two endpoints); it never re-parses or
 *  re-normalises the range. */
function hasRepeatedPageNumber(input: string): boolean {
  const seen = new Set<number>();
  for (const raw of input.split(",")) {
    const token = raw.trim();
    if (token === "") continue;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(token);
    const numbers = range !== null
      ? [Number(range[1]), Number(range[2])]
      : /^\d+$/.test(token)
        ? [Number(token)]
        : [];
    for (const n of numbers) {
      if (seen.has(n)) return true;
      seen.add(n);
    }
  }
  return false;
}

/** Phase 120 C - true when `deviceName` is a virtual-PDF destination. Mirrors
 *  the print service's own `isVirtualPdfPrinter` rule (a device name containing
 *  "pdf" is a produce-inside-TFlex destination) so the consequence summary can
 *  name "PDF file" before execution without reaching into the main process. */
export function isVirtualPdfDestination(deviceName: string | null): boolean {
  return typeof deviceName === "string" && deviceName.toLowerCase().includes("pdf");
}

export interface PrintPanelProps {
  print: PrintControls;
}

export function PrintPanel({ print }: PrintPanelProps): ReactElement {
  const {
    printers,
    printersLoading,
    printersError,
    deviceName,
    setDeviceName,
    printerNotice,
    printer,
    copies,
    setCopies,
    collate,
    setCollate,
    scope,
    setScope,
    customInput,
    setCustomInput,
    scaling,
    setScaling,
    scalePercent,
    setScalePercent,
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
    onConfirmPrint,
    onCancelClick,
    totalPages,
    currentPage,
    presets,
    selectedPreset,
    presetName,
    setPresetName,
    presetError,
    presetNotice,
    applyPreset,
    savePreset,
    deletePreset,
    layoutMode,
    setLayoutMode,
    bookletGutterPt,
    setBookletGutterPt,
    bookletCreepPt,
    setBookletCreepPt,
    bookletSubset,
    setBookletSubset,
    posterRows,
    setPosterRows,
    posterCols,
    setPosterCols,
    posterOverlapPt,
    setPosterOverlapPt,
    posterScalePercent,
    setPosterScalePercent,
    posterCutMarks,
    setPosterCutMarks,
    layoutError,
    bookletSides,
    posterTiles,
  } = print;

  // Phase 83 - switching to Booklet or Poster disables the Phase-30 ordering
  // controls (page order, odd/even, reverse, N-up) rather than silently
  // ignoring them; 'single' restores them.
  const orderingLocked = layoutMode !== "single";
  const nupDisabled = running || orderingLocked;
  const orderDisabled = running || orderingLocked || pagesPerSheet <= 1;
  const oddEvenDisabled = running || orderingLocked;
  const reverseDisabled = running || orderingLocked;
  const posterRowsShown = clampPosterGrid(posterRows);
  const posterColsShown = clampPosterGrid(posterCols);
  const posterGridStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${posterColsShown}, 1fr)`,
    gridTemplateRows: `repeat(${posterRowsShown}, 1fr)`,
  };
  const compact = useCompactOutput();

  // Phase 120 C - the pre-execution consequence summary, derived ONLY from the
  // real hook state. The destination names the real display name (or "PDF
  // file" for a virtual-PDF destination) and the format states what the run
  // actually produces, never a physical-print claim.
  const virtualDestination = isVirtualPdfDestination(deviceName);
  const destinationLabel = virtualDestination
    ? "PDF file"
    : printer?.displayName ?? deviceName ?? "No destination";
  const formatLabel = virtualDestination ? "PDF" : "Print job";
  const duplicateMergeDisclosure =
    scope === "custom" && hasRepeatedPageNumber(customInput)
      ? " (duplicate page numbers merged)"
      : "";
  const pagesSummary = selection.ok
    ? `${formatPageSet(selectionPages)} of ${totalPages}${duplicateMergeDisclosure}`
    : selection.error;

  // Phase 120 C - Escape closes only this surface (or aborts a run in flight).
  // `onCancelClick` is the hook's ONE cancel path, so the document the job
  // came from is never closed or mutated here. A native `<select>` owns its
  // own Escape, so the surface does not steal it while a dropdown is open.
  useEffect((): (() => void) => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.target instanceof HTMLSelectElement) return;
      onCancelClick();
    };
    window.addEventListener("keydown", onKeyDown);
    return (): void => window.removeEventListener("keydown", onKeyDown);
  }, [onCancelClick]);

  return (
    <>
      <div
        className="modal-body print-body"
        data-print-layout-mode={compact ? "compact" : "wide"}
      >
        <div className="print-controls">
          {/* Phase 81/120 B - Destination: where the job goes. Named presets,
              the real printer list and the DEF-301 routing notice. */}
          <PrintGroup id="destination" heading="Destination" compact={compact}>
            <div className="print-row print-row-selects print-preset-row">
              <label className="modal-field">
                <span>Preset</span>
                <select
                  className="modal-input"
                  value={selectedPreset}
                  onChange={(e): void => applyPreset(e.target.value)}
                  disabled={running}
                  data-print-preset
                  aria-label="Print preset"
                >
                  <option value="">Custom</option>
                  {presets.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="modal-field">
                <span>Preset name</span>
                <input
                  type="text"
                  className="modal-input"
                  maxLength={40}
                  placeholder="e.g. Duplex greyscale"
                  value={presetName}
                  onChange={(e): void => setPresetName(e.target.value)}
                  disabled={running}
                  data-print-preset-name
                  aria-label="Preset name"
                />
              </label>
            </div>
            <div className="print-row print-preset-actions">
              <button
                type="button"
                className="btn btn-secondary"
                data-print-preset-save
                onClick={(): void => {
                  void savePreset();
                }}
                disabled={running}
              >
                Save preset
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                data-print-preset-delete
                onClick={(): void => {
                  void deletePreset();
                }}
                disabled={running || selectedPreset === ""}
              >
                Delete
              </button>
              {presetError !== null && (
                <span className="modal-hint" role="alert" data-print-preset-error>
                  {presetError}
                </span>
              )}
              {presetNotice !== null && (
                <span className="modal-help" role="status" data-print-preset-notice>
                  {presetNotice}
                </span>
              )}
            </div>

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

            {/* DEF-301 - a live selection whose device vanished from the
                fresh list falls back deterministically; surface the routing
                change instead of silently redirecting the job. */}
            {printerNotice !== null && (
              <p
                className="modal-help print-printer-notice"
                role="status"
                data-print-printer-notice
              >
                {printerNotice}
              </p>
            )}
          </PrintGroup>
          {/* Phase 120 B - Pages: which pages, how many copies, how they sit
              on the sheet and their order. */}
          <PrintGroup id="pages" heading="Pages" compact={compact}>
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

            <div className="print-row">
              <label className="modal-field print-copies">
                <span>Copies</span>
                <input
                  type="number"
                  className="modal-input"
                  min={1}
                  max={99}
                  value={copies}
                  onChange={(e): void => setCopies(Number.parseInt(e.target.value, 10))}
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
                    onChange={(): void => setOrientation(value as PrintOrientation)}
                    disabled={running}
                    {...{ [attr]: "" }}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>

            <div className="print-row print-row-selects">
              <label className="modal-field">
                <span>Pages</span>
                <select
                  className="modal-input"
                  value={oddEven}
                  onChange={(e): void => setOddEven(e.target.value as PrintOddEven)}
                  disabled={oddEvenDisabled}
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
                  disabled={reverseDisabled}
                  data-print-reverse
                />
                <span>Reverse order</span>
              </label>
            </div>
          </PrintGroup>
          {/* Phase 83/120 B - Layout: the imposition mode plus its ordering
              controls. Booklet and Poster options are advanced groups that may
              collapse in the compact layout but stay fully reachable. */}
          <PrintGroup id="layout" heading="Layout" compact={compact}>
            <label className="modal-field">
              <span>Layout</span>
              <select
                className="modal-input"
                value={layoutMode}
                onChange={(e): void => setLayoutMode(e.target.value as PrintLayoutMode)}
                disabled={running}
                data-print-layout
                aria-label="Print layout"
              >
                <option value="single">Single / N-up</option>
                <option value="booklet">Booklet</option>
                <option value="poster">Poster</option>
              </select>
            </label>

            {layoutError !== null && (
              <p className="modal-hint print-range-error" role="alert" data-print-layout-error>
                {layoutError}
              </p>
            )}

            <div className="print-row print-row-selects">
              <label className="modal-field">
                <span>Pages per sheet</span>
                <select
                  className="modal-input"
                  value={pagesPerSheet}
                  onChange={(e): void => setPagesPerSheet(Number.parseInt(e.target.value, 10))}
                  disabled={nupDisabled}
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
                  disabled={orderDisabled}
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

            {layoutMode === "booklet" && (
              <PrintGroup id="booklet" heading="Booklet options" compact={compact} collapsible>
                <div className="print-row print-row-selects">
                  <label className="modal-field">
                    <span>Gutter (pt)</span>
                    <input
                      type="number"
                      className="modal-input"
                      min={0}
                      max={72}
                      value={bookletGutterPt}
                      onChange={(e): void => setBookletGutterPt(Number.parseFloat(e.target.value))}
                      disabled={running}
                      data-print-booklet-gutter
                      aria-label="Booklet gutter points"
                    />
                  </label>
                  <label className="modal-field">
                    <span>Creep (pt)</span>
                    <input
                      type="number"
                      className="modal-input"
                      min={0}
                      max={36}
                      value={bookletCreepPt}
                      onChange={(e): void => setBookletCreepPt(Number.parseFloat(e.target.value))}
                      disabled={running}
                      data-print-booklet-creep
                      aria-label="Booklet creep points"
                    />
                  </label>
                </div>
                <label className="modal-field">
                  <span>Sides</span>
                  <select
                    className="modal-input"
                    value={bookletSubset}
                    onChange={(e): void => setBookletSubset(e.target.value as BookletSubset)}
                    disabled={running}
                    data-print-booklet-subset
                    aria-label="Booklet sides"
                  >
                    <option value="both">Both sides</option>
                    <option value="front">Front side only</option>
                    <option value="back">Back side only</option>
                  </select>
                </label>
              </PrintGroup>
            )}

            {layoutMode === "poster" && (
              <PrintGroup id="poster" heading="Poster options" compact={compact} collapsible>
                <div className="print-row print-row-selects">
                  <label className="modal-field">
                    <span>Rows</span>
                    <select
                      className="modal-input"
                      value={posterRowsShown}
                      onChange={(e): void => setPosterRows(Number.parseInt(e.target.value, 10))}
                      disabled={running}
                      data-print-poster-rows
                      aria-label="Poster rows"
                    >
                      {Array.from({ length: 10 }, (_v, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="modal-field">
                    <span>Columns</span>
                    <select
                      className="modal-input"
                      value={posterColsShown}
                      onChange={(e): void => setPosterCols(Number.parseInt(e.target.value, 10))}
                      disabled={running}
                      data-print-poster-cols
                      aria-label="Poster columns"
                    >
                      {Array.from({ length: 10 }, (_v, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="print-row print-row-selects">
                  <label className="modal-field">
                    <span>Overlap (pt)</span>
                    <input
                      type="number"
                      className="modal-input"
                      min={0}
                      max={72}
                      value={posterOverlapPt}
                      onChange={(e): void => setPosterOverlapPt(Number.parseFloat(e.target.value))}
                      disabled={running}
                      data-print-poster-overlap
                      aria-label="Poster overlap points"
                    />
                  </label>
                  <label className="modal-field">
                    <span>Scale (%)</span>
                    <input
                      type="number"
                      className="modal-input"
                      min={10}
                      max={500}
                      value={posterScalePercent}
                      onChange={(e): void => setPosterScalePercent(Number.parseFloat(e.target.value))}
                      disabled={running}
                      data-print-poster-scale
                      aria-label="Poster scale percent"
                    />
                  </label>
                </div>
                <label className="print-check">
                  <input
                    type="checkbox"
                    checked={posterCutMarks}
                    onChange={(e): void => setPosterCutMarks(e.target.checked)}
                    disabled={running}
                    data-print-poster-cut-marks
                  />
                  <span>Cut marks</span>
                </label>
              </PrintGroup>
            )}
          </PrintGroup>
          {/* Phase 120 B - Appearance: how the page is scaled and inked.
              Duplex / colour is an advanced group that may collapse compact. */}
          <PrintGroup id="appearance" heading="Appearance" compact={compact}>
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
                onChange={(e): void => setScalePercent(Number.parseInt(e.target.value, 10))}
                disabled={running || scaling !== "custom"}
                data-print-scale-percent
                aria-label="Custom scale percent"
              />
            </label>

            <PrintGroup id="quality" heading="Duplex and colour" compact={compact} collapsible>
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
            </PrintGroup>

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
          </PrintGroup>

          {running && (
            <div className="modal-status print-progress print-status" aria-live="polite" data-print-progress>
              <div className="ocr-progress-header">
                <span className="print-status-text">
                  Rendering for print…
                  {progress.currentPage !== null && (
                    <> page {progress.currentPage} of {progress.total}</>
                  )}
                </span>
                <span className="ocr-progress-percent">{progressPercent}%</span>
              </div>
              <div
                className="ocr-progress-track"
                role="progressbar"
                aria-label="Page preparation progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPercent}
              >
                <div
                  className="ocr-progress-fill"
                  style={{ width: `${progressPercent}%` }}
                  data-print-progress-fill
                />
              </div>
            </div>
          )}

          {error !== null && (
            <div className="modal-status optimize-error print-status print-status-error" role="alert" data-print-error>
              <span className="print-status-text">{error}</span>
              <span className="print-status-hint" data-print-retry-hint>
                {virtualDestination
                  ? "Your settings are unchanged. Choose Print to try again, or pick another destination above to save a different copy."
                  : "Your settings are unchanged. Choose Print to try again."}
              </span>
            </div>
          )}
          {success !== null && (
            <div className="modal-status print-status print-status-success" role="status" data-print-success>
              <span className="print-status-text">{success}</span>
            </div>
          )}
        </div>
        {/* Phase 120 B - the preview is a neutral stage: a grey surface with
            the white paper centred. The sheet / cell / meta hooks are exact and
            driven by the SAME real geometry `usePrintControls` already derives. */}
        <div className="print-preview" data-print-preview>
          <div className="print-preview-title">Preview</div>
          <div className="print-preview-stage">
            {layoutMode === "booklet" ? (
              bookletSides.length === 0 ? (
                <div
                  className="print-preview-sheet"
                  data-print-preview-sheet
                  data-landscape="true"
                  style={{ gridTemplateColumns: "repeat(2, 1fr)", gridTemplateRows: "repeat(1, 1fr)" }}
                />
              ) : (
                bookletSides.map((side) => (
                  <div
                    key={side.index}
                    className="print-preview-sheet"
                    data-print-preview-sheet
                    data-print-preview-side={side.index}
                    data-landscape="true"
                    style={{ gridTemplateColumns: "repeat(2, 1fr)", gridTemplateRows: "repeat(1, 1fr)" }}
                  >
                    {side.cells.map((cell, cellIndex) => {
                      const cellStyle: CSSProperties = {
                        paddingLeft: `${cell.leftPt}pt`,
                        paddingRight: `${cell.rightPt}pt`,
                      };
                      if (cell.page === null) {
                        return (
                          <div
                            key={cellIndex}
                            className="print-preview-cell print-preview-blank"
                            data-print-preview-cell={cellIndex}
                            style={cellStyle}
                          />
                        );
                      }
                      const src = previewFor(previewImages, cell.page);
                      return (
                        <div
                          key={cellIndex}
                          className="print-preview-cell"
                          data-print-preview-cell={cellIndex}
                          data-print-preview-page={cell.page}
                          style={cellStyle}
                        >
                          {src !== null ? (
                            <img src={src} alt={`Page ${cell.page}`} />
                          ) : (
                            <span className="print-preview-placeholder" aria-hidden />
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))
              )
            ) : layoutMode === "poster" ? (
              <div
                className="print-preview-sheet"
                data-print-preview-sheet
                data-landscape={effectiveLandscape}
                style={posterGridStyle}
              >
                {posterTiles.map((tile, cellIndex) => {
                  const page = selectionPages[0];
                  const src = page === undefined ? null : previewFor(previewImages, page);
                  const cellStyle: CSSProperties = {
                    position: "relative",
                  };
                  if (src !== null && tile.sourceW > 0 && tile.sourceH > 0) {
                    cellStyle.backgroundImage = `url(${src})`;
                    cellStyle.backgroundSize = `${(1 / tile.sourceW) * 100}% ${(1 / tile.sourceH) * 100}%`;
                    cellStyle.backgroundPosition = `${
                      tile.sourceW < 1 ? (tile.sourceX / (1 - tile.sourceW)) * 100 : 0
                    }% ${
                      tile.sourceH < 1 ? (tile.sourceY / (1 - tile.sourceH)) * 100 : 0
                    }%`;
                    cellStyle.backgroundRepeat = "no-repeat";
                  }
                  return (
                    <div
                      key={cellIndex}
                      className="print-preview-cell"
                      data-print-preview-cell={cellIndex}
                      data-print-preview-tile={cellIndex}
                      style={cellStyle}
                    >
                      {src === null && <span className="print-preview-placeholder" aria-hidden />}
                      {posterCutMarks && (
                        <>
                          <span
                            className="print-preview-cut-mark"
                            data-print-cut-mark
                            style={{ position: "absolute", top: 0, left: 0, width: 8, height: 1, background: "var(--accent)" }}
                            aria-hidden
                          />
                          <span
                            className="print-preview-cut-mark"
                            data-print-cut-mark
                            style={{ position: "absolute", top: 0, left: 0, width: 1, height: 8, background: "var(--accent)" }}
                            aria-hidden
                          />
                          <span
                            className="print-preview-cut-mark"
                            data-print-cut-mark
                            style={{ position: "absolute", bottom: 0, right: 0, width: 8, height: 1, background: "var(--accent)" }}
                            aria-hidden
                          />
                          <span
                            className="print-preview-cut-mark"
                            data-print-cut-mark
                            style={{ position: "absolute", bottom: 0, right: 0, width: 1, height: 8, background: "var(--accent)" }}
                            aria-hidden
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
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
            )}
          </div>
          <div className="print-preview-meta" data-print-preview-meta>
            {selection.ok
              ? layoutMode === "booklet"
                ? `${selectionPages.length} page${selectionPages.length === 1 ? "" : "s"} · ${bookletSides.length} side${bookletSides.length === 1 ? "" : "s"}`
                : layoutMode === "poster"
                  ? `1 page · ${sheetCount} tile${sheetCount === 1 ? "" : "s"}`
                  : `${selectionPages.length} page${selectionPages.length === 1 ? "" : "s"} · ${sheetCount} sheet${sheetCount === 1 ? "" : "s"}`
              : selection.error}
          </div>
        </div>
      </div>
      <div className="modal-footer print-footer">
        {/* Phase 120 C - the consequence summary sits with the actions: the
            selected pages (or the selection error), the real destination and
            the output format, before the job runs. */}
        <div
          className="print-summary"
          data-print-summary
          role="group"
          aria-label="Output summary"
        >
          <span className="print-summary-item" data-print-summary-pages>
            <span className="print-summary-key">Pages</span>
            <span className="print-summary-value" title={pagesSummary}>
              {pagesSummary}
            </span>
          </span>
          <span className="print-summary-item" data-print-summary-destination>
            <span className="print-summary-key">Destination</span>
            <span className="print-summary-value" title={destinationLabel}>
              {destinationLabel}
            </span>
          </span>
          <span className="print-summary-item" data-print-summary-format>
            <span className="print-summary-key">Format</span>
            <span className="print-summary-value" title={formatLabel}>
              {formatLabel}
            </span>
          </span>
          {virtualDestination && (
            <span className="print-summary-note" data-print-summary-note>
              A Save-As dialog will appear to choose where the PDF is saved.
            </span>
          )}
        </div>
        <div className="print-footer-actions">
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
      </div>
    </>
  );
}
