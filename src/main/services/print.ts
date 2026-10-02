import { app, BrowserWindow } from 'electron';
import type { WebContents } from 'electron';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type {
  PrinterInfo,
  PrintDuplex,
  PrintJobPayload,
  PrintJobResult,
  PrintSettings,
} from '../../shared/types';
import { printSheetLayout } from '../../shared/printLayout';
import { bookletSideOffset } from '../../shared/printImposition';
import { savePdfDialog } from './dialog';

/**
 * Phase 30 — print service.
 *
 * The renderer composes one image per selected page (ranges, odd/even,
 * reverse and N-up order already applied there — see `PrintJobPayload`) and
 * hands the data URLs plus the dialog settings to `printJob`. This module
 * mounts them in a HIDDEN BrowserWindow (no preload) as one `<img>` per
 * printed page and calls `webContents.print` with the mapped Electron
 * options. The visible app window is never the print source.
 *
* Platform note (reported honestly): Electron's documented print option set
 * has no tray / paper-source key, so `settings.paperSource` is carried in the
 * contract but cannot reach the driver — the UI must surface it as
 * unsupported rather than silently dropping it. `oddEven`, `reverse` and
 * `pageOrder` are applied by the renderer to the image array; `pageOrder`
 * additionally selects the N-up grid and slot assignment below via the shared
 * `printSheetLayout` rule (Phase 33 / DEF-280).
 *
 * Phase 35 — a virtual-PDF destination no longer falls through to a visible
 * OS/Chromium print dialog. The SAME composed document is mounted and
 * converted with `webContents.printToPDF`; the app's own Save-As dialog
 * collects the path and the bytes are written there (`outcome: 'saved'`). A
 * real printer keeps the `webContents.print` behaviour exactly.
 */

/** Electron's `pagesPerSheet` allowlist. */
export const ALLOWED_PAGES_PER_SHEET = [1, 2, 4, 6, 9, 16] as const;

const execFileAsync = promisify(execFile);

/** Typed rejection reasons. The returned `reason` is a string per the shared
 *  contract; validation returns one of these literals (never a silent no-op). */
export type PrintErrorReason =
  | 'empty-images'
  | 'bad-image'
  | 'bad-device-name'
  | 'bad-copies'
  | 'bad-page-range'
  | 'bad-pages-per-sheet'
  | 'bad-scale-percent'
  // Phase 83 — imposition layout keys.
  | 'bad-layout-mode'
  | 'bad-booklet-option'
  | 'bad-poster-option'
  | 'print-timeout'
  | 'print-failed'
  // Phase 35 — the virtual-PDF (produce-inside-TFlex) path.
  | 'print-to-pdf-failed'
  | 'save-write-failed'
  // Phase 35 — the app's own Save-As dialog was dismissed. Matches the
  // renderer's `/cancel/i` quiet-no-op rule (never an error banner).
  | 'save-cancelled';

/** The subset of Electron's `webContents.print` options this service sets. */
export interface ElectronPrintOptions {
  silent: boolean;
  printBackground: boolean;
  deviceName?: string;
  copies?: number;
  collate?: boolean;
  pageRanges?: { from: number; to: number }[];
  landscape?: boolean;
  color?: boolean;
  duplexMode?: PrintDuplex;
  pagesPerSheet?: number;
  scaleFactor?: number;
}

/** Phase 35 — the subset of Electron's `webContents.printToPDF` options the
 *  virtual-PDF path sets, derived from the SAME `mapPrintSettings` output the
 *  direct-print path uses so the two cannot diverge. The N-up grid, scaling
 *  CSS and `@page` orientation are already baked into the composed HTML
 *  (`composePrintHtml`), so the PDF is a straight conversion of the same
 *  document the real-printer path sends to the driver. */
export interface ElectronPrintToPdfOptions {
  landscape: boolean;
  printBackground: boolean;
  /** Honour the composed `@page` size/margins (portrait/landscape, margin 0)
   *  rather than Chromium's default paper, so the sheet fills the page. */
  preferCSSPageSize: boolean;
  pageRanges?: string;
  scale?: number;
}

/**
 * DEF-269 — how long `webContents.print` may go without invoking its
 * callback before the job is abandoned. Generous on purpose: printing a large
 * real document to a physical printer can legitimately take a while, so this
 * only fires when the driver never calls back at all (e.g. a silent job that
 * fell through to a virtual system default). 120 s is long enough for any
 * real spooling job and short enough that a dead driver cannot hang the UI.
 */
export const PRINT_TIMEOUT_MS = 120_000;

/** DEF-270 — a page image must be a well-formed base64 image data URL whose
 *  payload decodes to a recognised image signature. Checking only
 *  `typeof === 'string'` let `'not-a-data-url'` through to a broken `<img>`. */
const IMAGE_DATA_URL_PATTERN = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

/** Known magic bytes: PNG 89 50 4E 47, JPEG FF D8 FF, WEBP RIFF....WEBP. */
function hasImageSignature(bytes: Uint8Array): boolean {
  const png =
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  const jpeg =
    bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp =
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;
  return png || jpeg || webp;
}

/** DEF-270 — true only for a decodable image data URL with a known signature. */
export function isValidPageImage(image: unknown): image is string {
  if (typeof image !== 'string') return false;
  const match = IMAGE_DATA_URL_PATTERN.exec(image);
  if (match === null) return false;
  const bytes = Buffer.from(match[2], 'base64');
  return hasImageSignature(bytes);
}

/**
 * Validate a print payload. Returns a typed reason for the dialog to show;
 * the caller never proceeds to the printer on a rejection.
 */
export function validatePrintPayload(
  payload: PrintJobPayload,
): { ok: true } | { ok: false; reason: PrintErrorReason } {
  const images = payload?.images;
  if (!Array.isArray(images) || images.length === 0) {
    return { ok: false, reason: 'empty-images' };
  }
  for (const image of images) {
    // Phase 83 — '' is an explicit BLANK page slot (booklet padding, single
    // sided subsets), not an image. Any other value must still be a valid
    // decodable image data URL.
    if (image === '') continue;
    if (!isValidPageImage(image)) {
      return { ok: false, reason: 'bad-image' };
    }
  }
  const settings = payload.settings ?? {};
  // DEF-269 — the print dialog always selects a device, and a silent job with
  // no device silently falls back to the system default (which may be a
  // virtual driver that never calls back). That is exactly the fail-loud
  // violation this rejects; `PrintSettings.deviceName` stays optional in the
  // type but is mandatory at the IPC boundary.
  if (typeof settings.deviceName !== 'string' || settings.deviceName.trim() === '') {
    return { ok: false, reason: 'bad-device-name' };
  }
  if (
    settings.copies !== undefined &&
    (!Number.isInteger(settings.copies) || settings.copies < 1 || settings.copies > 99)
  ) {
    return { ok: false, reason: 'bad-copies' };
  }
  if (settings.pageRanges !== undefined) {
    if (!Array.isArray(settings.pageRanges)) {
      return { ok: false, reason: 'bad-page-range' };
    }
    for (const range of settings.pageRanges) {
      if (
        typeof range !== 'object' ||
        range === null ||
        !Number.isInteger(range.from) ||
        !Number.isInteger(range.to) ||
        range.from < 0 ||
        range.to < range.from
      ) {
        return { ok: false, reason: 'bad-page-range' };
      }
    }
  }
  if (
    settings.pagesPerSheet !== undefined &&
    !(ALLOWED_PAGES_PER_SHEET as readonly number[]).includes(settings.pagesPerSheet)
  ) {
    return { ok: false, reason: 'bad-pages-per-sheet' };
  }
  if (
    settings.scalePercent !== undefined &&
    (typeof settings.scalePercent !== 'number' ||
      !Number.isFinite(settings.scalePercent) ||
      settings.scalePercent < 1 ||
      settings.scalePercent > 500)
  ) {
    return { ok: false, reason: 'bad-scale-percent' };
  }
  // Phase 83 — imposition options. Every key is optional and only validated
  // when present; an omitted key keeps today's behaviour.
  if (
    settings.layoutMode !== undefined &&
    !['single', 'booklet', 'poster'].includes(settings.layoutMode)
  ) {
    return { ok: false, reason: 'bad-layout-mode' };
  }
  if (
    settings.bookletSubset !== undefined &&
    !['both', 'front', 'back'].includes(settings.bookletSubset)
  ) {
    return { ok: false, reason: 'bad-booklet-option' };
  }
  if (
    settings.bookletGutterPt !== undefined &&
    (typeof settings.bookletGutterPt !== 'number' ||
      !Number.isFinite(settings.bookletGutterPt) ||
      settings.bookletGutterPt < 0 ||
      settings.bookletGutterPt > 72)
  ) {
    return { ok: false, reason: 'bad-booklet-option' };
  }
  if (
    settings.bookletCreepPt !== undefined &&
    (typeof settings.bookletCreepPt !== 'number' ||
      !Number.isFinite(settings.bookletCreepPt) ||
      settings.bookletCreepPt < 0 ||
      settings.bookletCreepPt > 36)
  ) {
    return { ok: false, reason: 'bad-booklet-option' };
  }
  const badPosterInt = (value: number | undefined): boolean =>
    value !== undefined && (!Number.isInteger(value) || value < 1 || value > 10);
  if (badPosterInt(settings.posterRows) || badPosterInt(settings.posterCols)) {
    return { ok: false, reason: 'bad-poster-option' };
  }
  if (
    settings.posterOverlapPt !== undefined &&
    (typeof settings.posterOverlapPt !== 'number' ||
      !Number.isFinite(settings.posterOverlapPt) ||
      settings.posterOverlapPt < 0 ||
      settings.posterOverlapPt > 72)
  ) {
    return { ok: false, reason: 'bad-poster-option' };
  }
  if (
    settings.posterScalePercent !== undefined &&
    (typeof settings.posterScalePercent !== 'number' ||
      !Number.isFinite(settings.posterScalePercent) ||
      settings.posterScalePercent < 10 ||
      settings.posterScalePercent > 500)
  ) {
    return { ok: false, reason: 'bad-poster-option' };
  }
  if (
    settings.posterCutMarks !== undefined &&
    typeof settings.posterCutMarks !== 'boolean'
  ) {
    return { ok: false, reason: 'bad-poster-option' };
  }
  return { ok: true };
}
/**
 * Virtual-PDF-printer heuristic. Electron's `webContents.print` has NO
 * output-path option: a silent job aimed at a virtual PDF driver
 * ("Microsoft Print to PDF", Adobe PDF, PDFCreator, ...) is rejected by the
 * driver with `{ success: false, failureReason: 'Print job canceled' }` because
 * it needs a filename, while a real printer works silently. So a destination
 * whose device name contains "pdf" (case-insensitive) is treated as virtual and
 * printed with `silent: false` — the OS/Chromium dialog appears so it can
 * collect the output path — with every other option unchanged.
 *
 * The match is a plain substring, not a word boundary: a name like
 * "MyPDFPrinter" is virtual too. A false positive only means one extra OS
 * dialog for a printer whose name happens to contain "pdf"; a false negative
 * means a silent job that can never succeed, which is strictly worse.
 */
export function isVirtualPdfPrinter(deviceName: string | undefined): boolean {
  return typeof deviceName === 'string' && deviceName.toLowerCase().includes('pdf');
}

/**
 * Map the dialog settings to Electron's `webContents.print` options. Pure and
 * exported so the mapping is unit-tested without spinning up Electron.
 *
 * Sets `silent: true` (TFlex's own dialog IS the print dialog, so the OS dialog
 * must not appear) and `printBackground: true` — except for a virtual PDF
 * destination, which needs the OS dialog to collect its output path (see
 * `isVirtualPdfPrinter`). Absent optional fields resolve to Electron's
 * documented defaults: copies 1, collate false, landscape false, color true,
 * duplexMode 'simplex', pagesPerSheet 1. `scaleFactor` is only emitted for
 * custom scaling (percent / 100).
 */
export function mapPrintSettings(settings: PrintSettings): ElectronPrintOptions {
  const options: ElectronPrintOptions = {
    silent: !isVirtualPdfPrinter(settings.deviceName),
    printBackground: true,
    copies: settings.copies ?? 1,
    collate: settings.collate ?? false,
    landscape: settings.landscape ?? false,
    color: settings.color ?? true,
    duplexMode: settings.duplex ?? 'simplex',
    pagesPerSheet: settings.pagesPerSheet ?? 1,
  };
  if (settings.deviceName !== undefined && settings.deviceName !== '') {
    options.deviceName = settings.deviceName;
  }
  if (settings.pageRanges !== undefined && settings.pageRanges.length > 0) {
    options.pageRanges = settings.pageRanges.map((range) => ({
      from: range.from,
      to: range.to,
    }));
  }
if (settings.scaling === 'custom') {
    options.scaleFactor = (settings.scalePercent ?? 100) / 100;
  }
  return options;
}

/**
 * Phase 35 — map the dialog settings to Electron's `webContents.printToPDF`
 * options for the virtual-PDF destination. Pure and exported so the mapping is
 * unit-tested without Electron.
 *
 * It derives from `mapPrintSettings` (the direct-print mapping) so the PDF and
 * the real-print path share one option source: `printBackground` and
 * `landscape` are copied verbatim, and a custom `scaleFactor` becomes
 * `scale` (matching the driver's `scaleFactor` so both paths scale alike).
 * `preferCSSPageSize` makes Chromium honour the composed `@page` rule
 * (`size: portrait|landscape; margin: 0`) instead of its default paper, so the
 * N-up sheet fills the page exactly as the direct-print path lays it out.
 *
 * `pageRanges` is the one shape difference: `printToPDF` takes a 1-based
 * string ("1-3"), while `print` takes 0-based `{from,to}` objects. NOTE the
 * renderer deliberately leaves `pageRanges` unset (the selected pages already
 * travel as the image list); this conversion only serves a caller that does
 * set it.
 */
export function mapPrintToPdfOptions(settings: PrintSettings): ElectronPrintToPdfOptions {
  const mapped = mapPrintSettings(settings);
  const options: ElectronPrintToPdfOptions = {
    landscape: mapped.landscape === true,
    printBackground: mapped.printBackground,
    preferCSSPageSize: true,
  };
  if (mapped.pageRanges !== undefined && mapped.pageRanges.length > 0) {
    options.pageRanges = mapped.pageRanges
      .map((range) => (range.from === range.to ? `${range.from + 1}` : `${range.from + 1}-${range.to + 1}`))
      .join(',');
  }
  if (mapped.scaleFactor !== undefined) {
    options.scale = mapped.scaleFactor;
  }
  return options;
}

/** Phase 35 — the `%PDF-` file signature. A `printToPDF` result that does not
 *  carry it is a failed conversion, not a document: reject rather than write a
 *  non-PDF file to the user's chosen path. */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

/** True for a non-empty buffer starting with `%PDF-`. */
export function isPdfBytes(bytes: Uint8Array): boolean {
  return bytes.length >= PDF_MAGIC.length && PDF_MAGIC.every((byte, i) => bytes[i] === byte);
}

/** Scaling rule per mode. 'fit' fills the page (may upscale), 'actual' is
 *  100%, 'shrink' only downscales oversized pages, 'custom' uses the percent. */
function scalingCss(settings: PrintSettings): string {
  switch (settings.scaling) {
    case 'actual':
      return '.page img { width: auto; height: auto; max-width: none; max-height: none; }';
    case 'shrink':
      return '.page img { max-width: 100%; max-height: 100%; width: auto; height: auto; }';
    case 'custom':
      return `.page img { width: ${settings.scalePercent ?? 100}%; height: auto; }`;
    case 'fit':
    default:
      return '.page img { width: 100%; height: 100%; object-fit: contain; }';
  }
}

/** Phase 83 — poster trim marks: one corner mark (`class="cut-mark"`) per
 *  sheet corner, positioned by the poster-only CSS that `composePrintHtml`
 *  emits when `posterCutMarks` is on. */
const POSTER_CUT_MARKS =
  '<span class="cut-mark cut-mark-tl"></span>' +
  '<span class="cut-mark cut-mark-tr"></span>' +
  '<span class="cut-mark cut-mark-bl"></span>' +
  '<span class="cut-mark cut-mark-br"></span>';

/**
 * Compose the print document. One sheet per printed page (`page-break-after:
 * always`), each sheet holding `pagesPerSheet` images in a CSS grid when N-up
 * is active. Pure and exported for unit tests.
 *
 * Phase 33 / DEF-280 — the sheet GRID and the slot assignment both come from
 * the shared `printSheetLayout` rule (the same one the renderer preview uses),
 * so the two can never diverge. Cells are emitted in DOM order (row-major) with
 * image `slots[cellIndex]` in each cell; a trailing partially-filled sheet keeps
 * its empty cells so every image stays in its intended position.
 */
export function composePrintHtml(payload: PrintJobPayload): string {
  const settings = payload.settings ?? {};
  const mode = settings.layoutMode ?? 'single';
  // Phase 83 — booklet forces 2-up (saddle-stitch sides), poster forces 1-up
  // (one tile per sheet); `single` keeps the Phase-30 pagesPerSheet behaviour.
  const perSheet = mode === 'booklet' ? 2 : mode === 'poster' ? 1 : (settings.pagesPerSheet ?? 1);
  // Booklet is a landscape 2-up layout by definition.
  const landscape = mode === 'booklet' ? true : settings.landscape === true;

  const sheets: string[][] = [];
  for (let i = 0; i < payload.images.length; i += perSheet) {
    sheets.push(payload.images.slice(i, i + perSheet));
  }

  // ADV-159 / DEF-485 — booklet is a FIXED 2-column landscape imposition; a
  // stale `pageOrder` from a Single/N-up surface must not rotate or mirror it.
  // Every other mode keeps the shared `printSheetLayout` rule.
  const layout =
    mode === 'booklet'
      ? { cols: 2, rows: 1, slots: [0, 1] }
      : printSheetLayout(perSheet, settings.pageOrder);
  const sheetsHtml = sheets
    .map((images, sheetIndex) => {
      if (mode === 'booklet') {
        // The images already arrive in saddle-stitch order (with '' blanks);
        // pair them into sheets and inset each side by the shared gutter/creep
        // offset for this PHYSICAL sheet. ADV-158 / DEF-484 — the renderer
        // preview offsets by physical sheet (bookletPageCount / 4), so subset
        // `both` (the default) must halve the side count/index, while
        // front/back already carry one side per physical sheet.
        const subset = settings.bookletSubset ?? 'both';
        const offset = bookletSideOffset(
          subset === 'both' ? Math.floor(sheetIndex / 2) : sheetIndex,
          subset === 'both' ? sheets.length / 2 : sheets.length,
          settings.bookletGutterPt ?? 0,
          settings.bookletCreepPt ?? 0,
        );
        const pad = `padding-left:${offset.leftPt}pt; padding-right:${offset.rightPt}pt;`;
        const cells = layout.slots
          .map((slot) => {
            const src = images[slot];
            return src === undefined || src === ''
              ? `<div class="page" style="${pad}"></div>`
              : `<div class="page" style="${pad}"><img src="${src}" alt=""></div>`;
          })
          .join('');
        return `<div class="sheet">${cells}</div>`;
      }
      if (mode === 'poster') {
        // One already-cropped tile per sheet; optional trim marks on the sheet.
        const src = images[0];
        const cell =
          src === undefined || src === ''
            ? '<div class="page"></div>'
            : `<div class="page"><img src="${src}" alt=""></div>`;
        return settings.posterCutMarks === true
          ? `<div class="sheet poster-cut-marks">${POSTER_CUT_MARKS}${cell}</div>`
          : `<div class="sheet">${cell}</div>`;
      }
      // Emit one cell per grid slot in DOM order; empty cells keep the grid shape.
      const cells =
        perSheet > 1
          ? layout.slots
              .map((slot) => {
                const src = images[slot];
                return src === undefined || src === ''
                  ? '<div class="page"></div>'
                  : `<div class="page"><img src="${src}" alt=""></div>`;
              })
              .join('')
          : images[0] === undefined || images[0] === ''
            ? '<div class="page"></div>'
            : `<div class="page"><img src="${images[0]}" alt=""></div>`;
      return `<div class="sheet">${cells}</div>`;
    })
    .join('\n');

  let gridCss =
    perSheet > 1
      ? `.sheet { display: grid; grid-template-columns: repeat(${layout.cols}, 1fr);` +
        ` grid-template-rows: repeat(${layout.rows}, 1fr); }`
      : '';
  // Phase 83 — booklet cells are inset by padding, so keep them inside their
  // grid track; poster trim marks are absolutely positioned on the sheet.
  if (mode === 'booklet') {
    gridCss += '.page { box-sizing: border-box; }';
  }
  if (mode === 'poster' && settings.posterCutMarks === true) {
    gridCss +=
      '.sheet { position: relative; }' +
      '.cut-mark { position: absolute; width: 14pt; height: 14pt; }' +
      '.cut-mark-tl { top: 0; left: 0; border-top: 1pt solid #000; border-left: 1pt solid #000; }' +
      '.cut-mark-tr { top: 0; right: 0; border-top: 1pt solid #000; border-right: 1pt solid #000; }' +
      '.cut-mark-bl { bottom: 0; left: 0; border-bottom: 1pt solid #000; border-left: 1pt solid #000; }' +
      '.cut-mark-br { bottom: 0; right: 0; border-bottom: 1pt solid #000; border-right: 1pt solid #000; }';
  }

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Jovrel Print</title>
<style>
@page { size: ${landscape ? 'landscape' : 'portrait'}; margin: 0; }
html, body { margin: 0; padding: 0; }
.sheet { width: 100vw; height: 100vh; box-sizing: border-box; overflow: hidden; page-break-after: always; }
.sheet:last-child { page-break-after: auto; }
.page { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.page img { display: block; }
${scalingCss(settings)}
${gridCss}
</style>
</head>
<body>
${sheetsHtml}
</body>
</html>`;
}

/** The minimal window surface the print pipeline needs (satisfied by a real
 *  hidden `BrowserWindow`; stubbed in unit tests). */
export interface HiddenPrintWindow {
  webContents: {
    once(event: 'did-finish-load', listener: () => void): void;
    print(
      options: ElectronPrintOptions,
      callback: (success: boolean, failureReason: string) => void,
    ): void;
    /** Phase 35 — convert the mounted document to PDF bytes (virtual-PDF path). */
    printToPDF(options: ElectronPrintToPdfOptions): Promise<Buffer>;
  };
  isDestroyed(): boolean;
  destroy(): void;
}

/** Injection seam so `printJob` is unit-testable without Electron. */
export interface PrintJobDeps {
  createWindow(): HiddenPrintWindow;
  loadHtml(win: HiddenPrintWindow, html: string): Promise<void>;
  /** DEF-269 — override the driver-callback timeout (tests use a tiny value). */
  timeoutMs?: number;
  /** Phase 35 — the app's Save-As picker for the virtual-PDF path. Resolves to
   *  the chosen path, or `null` when the user dismissed it. */
  chooseSavePath?(): Promise<string | null>;
  /** Phase 35 — write the produced PDF bytes to the chosen path. */
  writePdfFile?(path: string, bytes: Uint8Array): Promise<void>;
}

/**
 * The fields Electron ACTUALLY serializes for `getPrintersAsync`. Electron 44
 * on Windows returns only name / displayName / description / options — no
 * `isDefault`, no `status` — so both are optional here and the default is
 * resolved separately (see `PrinterListDeps`).
 */
interface RawPrinterInfo {
  name: string;
  displayName?: string;
  isDefault?: boolean;
  status?: number;
}

/** Injection seam for the system-default lookup (unit-testable). */
export interface PrinterListDeps {
  getSystemDefaultName(): Promise<string | undefined>;
}

/**
 * Best-effort system default printer name. Electron 44 does not report it, so
 * on Windows we read the per-user default from the registry
 * (`HKCU\...\CurrentVersion\Windows` -> `Device` = `<name>,<driver>,<port>`).
 * Offline and out-of-process; any failure resolves undefined (the renderer
 * then falls back to the first printer).
 */
export async function getWindowsDefaultPrinterName(): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined;
  try {
    const { stdout } = await execFileAsync('reg', [
      'query',
      'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows',
      '/v',
      'Device',
    ]);
    const match = /Device\s+REG_SZ\s+([^,\r\n]+)/.exec(stdout);
    if (match === null) return undefined;
    const name = match[1].trim();
    return name === '' ? undefined : name;
  } catch {
    return undefined;
  }
}

export const defaultPrinterListDeps: PrinterListDeps = {
  getSystemDefaultName: getWindowsDefaultPrinterName,
};

/**
 * List the OS printers. `name` is the SYSTEM device name (what Electron's
 * `deviceName` expects); the friendly `displayName` is shown in the picker.
 * A webContents is required because `getPrintersAsync` lives on it. The
 * system default is flagged `isDefault` from the raw field when the platform
 * reports it, otherwise from the registry lookup.
 */
export async function listPrinters(
  contents: WebContents,
  deps: PrinterListDeps = defaultPrinterListDeps,
): Promise<PrinterInfo[]> {
  const printers = (await contents.getPrintersAsync()) as unknown as RawPrinterInfo[];
  const systemDefault = await deps.getSystemDefaultName();
  return printers.map((printer) => {
    const info: PrinterInfo = {
      name: printer.name,
      displayName:
        printer.displayName !== undefined && printer.displayName !== ''
          ? printer.displayName
          : printer.name,
      isDefault: printer.isDefault === true || printer.name === systemDefault,
    };
    if (typeof printer.status === 'number') {
      info.status = printer.status;
    }
    return info;
  });
}

export const defaultPrintJobDeps: PrintJobDeps = {
  createWindow(): HiddenPrintWindow {
    // Hidden, no preload: the document is a plain HTML page built in-memory.
    return new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
  },
  async loadHtml(win: HiddenPrintWindow, html: string): Promise<void> {
    // A data: URL is size-limited; compose to a temp file so a 34-page
    // document's embedded images are never truncated. Deleted after load.
    const file = join(app.getPath('temp'), `tflex-print-${randomUUID()}.html`);
    await writeFile(file, html, 'utf8');
    try {
      await (win as unknown as { loadFile(path: string): Promise<void> }).loadFile(file);
    } finally {
      await unlink(file).catch(() => undefined);
    }
  },
  // Phase 35 — the app's own Save-As picker (the same one Save As uses).
  chooseSavePath: savePdfDialog,
  writePdfFile: async (path, bytes): Promise<void> => {
    await writeFile(path, bytes);
  },
};

/** Sentinel rejection used by `withTimeout` so the virtual-PDF branch can
 *  tell a stalled conversion from a real `printToPDF` failure. */
const PRINT_TIMEOUT_SENTINEL = Symbol('tflex-print-timeout');

/** Bound a promise with the same 120 s deadline as the driver callback
 *  (DEF-269). A stalled `printToPDF` is abandoned, never left hanging. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(PRINT_TIMEOUT_SENTINEL), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Phase 35 — produce the PDF inside TFlex for a virtual-PDF destination:
 * convert the ALREADY-MOUNTED composed sheet document with `printToPDF`, then
 * write the bytes to the path the app's Save-As dialog returned. No
 * Windows/Chromium print window is used at any point (the caller never calls
 * `webContents.print` on this path). Every failure is a typed reason.
 */
async function produceVirtualPdf(
  win: HiddenPrintWindow,
  settings: PrintSettings,
  destination: string,
  deps: PrintJobDeps,
): Promise<PrintJobResult> {
  let bytes: Buffer;
  try {
    bytes = await withTimeout(
      win.webContents.printToPDF(mapPrintToPdfOptions(settings)),
      deps.timeoutMs ?? PRINT_TIMEOUT_MS,
    );
  } catch (error) {
    return {
      ok: false,
      reason: error === PRINT_TIMEOUT_SENTINEL ? 'print-timeout' : 'print-to-pdf-failed',
    };
  }
  // Refuse to write a non-PDF to the user's chosen path (a conversion that
  // produced no `%PDF-` header failed).
  if (!isPdfBytes(bytes)) {
    return { ok: false, reason: 'print-to-pdf-failed' };
  }
  try {
    if (deps.writePdfFile === undefined) {
      await writeFile(destination, bytes);
    } else {
      await deps.writePdfFile(destination, bytes);
    }
  } catch {
    return { ok: false, reason: 'save-write-failed' };
  }
  return { ok: true, outcome: 'saved', path: destination };
}

/**
 * Print the composed pages to the chosen device. Validates first, mounts the
 * document in a hidden window, waits for `did-finish-load`, then either:
 *
 *  - a REAL printer: calls `webContents.print` with the mapped options and
 *    resolves `{ ok: true, outcome: 'printed' }`; or
 *  - a virtual PDF printer (Phase 35): collects a destination from the app's
 *    own Save-As dialog and converts the SAME composed document with
 *    `webContents.printToPDF`, writing the bytes there and resolving
 *    `{ ok: true, outcome: 'saved', path }`. No OS/Chromium print window is
 *    ever opened. A dismissed save dialog resolves `{ ok: false,
 *    reason: 'save-cancelled' }` (a quiet no-op for the dialog).
 *
 * Never rejects: a failure resolves `{ ok: false, reason }` so the dialog can
 * surface it.
 *
 * DEF-269 — `webContents.print`'s callback is the ONLY completion signal, and
 * some drivers (a silent job whose device fell back to a virtual system
 * default) never invoke it. A timer bounds that wait; for `printToPDF` the
 * same bound is applied in `produceVirtualPdf`. The `finally` block is the
 * single destruction point for the window, so success, driver failure,
 * timeout and any thrown error all clean up exactly once.
 */
export async function printJob(
  payload: PrintJobPayload,
  deps: PrintJobDeps = defaultPrintJobDeps,
): Promise<PrintJobResult> {
  const validation = validatePrintPayload(payload);
  if (!validation.ok) {
    return { ok: false, reason: validation.reason };
  }
  const settings = payload.settings ?? {};

  // Phase 35 — a virtual-PDF destination collects its output path FIRST. A
  // dismissed dialog is a quiet cancel: no hidden window, nothing written.
  const virtual = isVirtualPdfPrinter(settings.deviceName);
  let savePath: string | null = null;
  if (virtual) {
    savePath = deps.chooseSavePath === undefined ? await savePdfDialog() : await deps.chooseSavePath();
    if (savePath === null) {
      return { ok: false, reason: 'save-cancelled' };
    }
  }

  const win = deps.createWindow();
  let destroyed = false;
  const destroyOnce = (): void => {
    if (destroyed) return;
    destroyed = true;
    if (!win.isDestroyed()) {
      win.destroy();
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const html = composePrintHtml(payload);
    await new Promise<void>((resolve, reject) => {
      win.webContents.once('did-finish-load', () => resolve());
      deps.loadHtml(win, html).catch(reject);
    });

    if (virtual) {
      return await produceVirtualPdf(win, settings, savePath as string, deps);
    }

    const options = mapPrintSettings(settings);
    return await new Promise<PrintJobResult>((resolve) => {
      let settled = false;
      const settle = (result: PrintJobResult): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        resolve(result);
      };
      timer = setTimeout(() => {
        settle({ ok: false, reason: 'print-timeout' });
      }, deps.timeoutMs ?? PRINT_TIMEOUT_MS);
      win.webContents.print(options, (success, failureReason) => {
        settle(
          success
            ? { ok: true, outcome: 'printed' }
            : { ok: false, reason: failureReason || 'print-failed' },
        );
      });
    });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'print-failed' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    destroyOnce();
  }
}
