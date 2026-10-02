// Phase 35 - the shared print surface markup.
//
// Extracted verbatim from `PrintDialog` so the in-app modal and the
// standalone print window render ONE set of controls, one preview and one
// set of result states. Every `data-print-*` selector the suites pin lives
// here; the only difference between the two hosts is the chrome they wrap it
// in (modal backdrop + draggable header vs. a plain window layout).

import type { ReactElement } from "react";
import type { PrintPageImage } from "../pdf/printRaster";
import { PRINT_ALLOWED_NUP, type PrintOrientation } from "../pdf/printSettings";
import type { PrintOddEven } from "../pdf/printSelection";
import type { PrintDuplex, PrintPageOrder } from "../../shared/types";
import type { PrintControls } from "./usePrintControls";

/** Build a lookup from page number to its cached preview raster. */
function previewFor(
  images: Record<number, PrintPageImage>,
  page: number,
): string | null {
  return images[page]?.dataUrl ?? null;
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
  } = print;

  return (
    <>
      <div className="modal-body print-body">
        <div className="print-controls">
          {/* Phase 81 - named print presets. The first block in the surface:
              pick a saved option snapshot, or save the current one. */}
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
              onChange={(e): void => setScalePercent(Number.parseInt(e.target.value, 10))}
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
    </>
  );
}
