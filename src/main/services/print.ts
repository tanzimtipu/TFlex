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
  PrintPageOrder,
  PrintSettings,
} from '../../shared/types';

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
 * additionally drives the N-up grid flow below.
 */

/** Electron's `pagesPerSheet` allowlist. */
export const ALLOWED_PAGES_PER_SHEET = [1, 2, 4, 6, 9, 16] as const;

const execFileAsync = promisify(execFile);

/** Columns/rows for each N-up value; a sheet holds `cols * rows` pages. */
export const NUP_GRID: Record<number, { cols: number; rows: number }> = {
  1: { cols: 1, rows: 1 },
  2: { cols: 2, rows: 1 },
  4: { cols: 2, rows: 2 },
  6: { cols: 3, rows: 2 },
  9: { cols: 3, rows: 3 },
  16: { cols: 4, rows: 4 },
};

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
  | 'print-timeout'
  | 'print-failed';

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

/** N-up flow direction within a sheet. The renderer already applies the
 *  definitive page order to `images`; this mirrors it for layout direction. */
function gridFlowCss(order: PrintPageOrder | undefined): string {
  const vertical = order === 'vertical' || order === 'verticalReversed';
  const reversed = order === 'horizontalReversed' || order === 'verticalReversed';
  const flow = vertical ? 'grid-auto-flow: column;' : 'grid-auto-flow: row;';
  return reversed ? `${flow} direction: rtl;` : flow;
}

/**
 * Compose the print document. One sheet per printed page (`page-break-after:
 * always`), each sheet holding `pagesPerSheet` images in a CSS grid when N-up
 * is active. Pure and exported for unit tests.
 */
export function composePrintHtml(payload: PrintJobPayload): string {
  const settings = payload.settings ?? {};
  const perSheet = settings.pagesPerSheet ?? 1;
  const grid = NUP_GRID[perSheet] ?? NUP_GRID[1];
  const landscape = settings.landscape === true;

  const sheets: string[][] = [];
  for (let i = 0; i < payload.images.length; i += perSheet) {
    sheets.push(payload.images.slice(i, i + perSheet));
  }
  const sheetsHtml = sheets
    .map((images) => {
      const imgs = images
        .map((src) => `<div class="page"><img src="${src}" alt=""></div>`)
        .join('');
      return `<div class="sheet">${imgs}</div>`;
    })
    .join('\n');

  const gridCss =
    perSheet > 1
      ? `.sheet { display: grid; grid-template-columns: repeat(${grid.cols}, 1fr);` +
        ` grid-template-rows: repeat(${grid.rows}, 1fr); ${gridFlowCss(settings.pageOrder)} }`
      : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>TFlex Print</title>
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
};

/**
 * Print the composed pages to the chosen device. Validates first, mounts the
 * document in a hidden window, waits for `did-finish-load`, calls
 * `webContents.print` with the mapped options, then destroys the window.
 * Never rejects: a failure resolves `{ ok: false, reason }` so the dialog can
 * surface it.
 *
 * DEF-269 — `webContents.print`'s callback is the ONLY completion signal, and
 * some drivers (a silent job whose device fell back to a virtual system
 * default) never invoke it. A timer bounds that wait; the `finally` block is
 * the single destruction point for the window, so success, driver failure,
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
    const options = mapPrintSettings(payload.settings ?? {});
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
        settle(success ? { ok: true } : { ok: false, reason: failureReason || 'print-failed' });
      });
    });
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'print-failed' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    destroyOnce();
  }
}
