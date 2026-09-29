import { app, BrowserWindow, session, type Session } from 'electron';
import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument } from '@cantoo/pdf-lib';
import { err, ok, type Result } from '../../../shared/result';
import type { ConvertErrorCode, ConvertWarning } from '../../../shared/convert';
import { CONVERT_ERROR_MESSAGES, mapAdapterThrow } from './errors';
import { injectSecurityMeta } from './templates';
import { isPdfBytes, PRINT_TIMEOUT_MS } from '../print';

/**
 * Phase 53 — the offscreen print engine (ruling 5, feature H).
 *
 * Converts an already-composed HTML document to multi-page PDF bytes through a
 * REAL Chromium layout pass: a hidden, session-isolated `BrowserWindow` loads a
 * temporary file and `webContents.printToPDF` serialises it. This is the only
 * true CSS layout engine available offline, and no new dependency.
 *
 * Isolation is the important part, and the dangerous part:
 *  - the window runs on a DEDICATED session partition (`convert:offscreen`),
 *    never `session.defaultSession`. The default session carries the app's own
 *    Phase 44/50 Neon sign-in network path; cancelling requests there would
 *    break sign-in. The dedicated partition cannot affect it.
 *  - on that partition only, every http/https/ws/wss/ftp request is cancelled
 *    and its URL recorded for `resource-blocked` warnings.
 *  - JavaScript is disabled, so the document cannot script its way out.
 *  - a CSP meta denies everything by default (see `templates.ts`).
 * Capability removal, not pattern matching: there is no regex sanitiser here.
 *
 * Everything is dependency-injected (`HtmlPrintDeps`) so this module unit-tests
 * with no Electron instance, mirroring `src/main/services/print.ts`.
 */

export const CONVERT_SESSION_PARTITION = 'convert:offscreen';

/** The exact request-block filter list. Every non-`file:` scheme the document
 *  could reach is listed, so the session rule (not the CSP) is the backstop. */
export const CONVERT_BLOCKED_URL_PATTERNS = [
  'http://*/*',
  'https://*/*',
  'ws://*/*',
  'wss://*/*',
  'ftp://*/*',
] as const;

/** At most this many blocked URLs are named in warnings; the total travels in
 *  `detail` so a page with fifty images does not flood the conversion card. */
export const RESOURCE_WARNING_CAP = 5;

/** Pure record-and-cancel handler; exported so the block behaviour is asserted
 *  without Electron. */
export function createBlockedRequestHandler(
  record: (url: string) => void,
): (details: { url: string }, callback: (response: { cancel: boolean }) => void) => void {
  return (details, callback) => {
    record(details.url);
    callback({ cancel: true });
  };
}

/** Map collected blocked URLs to `resource-blocked` warnings, capped at
 *  `RESOURCE_WARNING_CAP` names with the true total in `detail`. */
export function blockedResourceWarnings(urls: string[]): ConvertWarning[] {
  if (urls.length === 0) return [];
  const total = urls.length;
  return urls.slice(0, RESOURCE_WARNING_CAP).map((url) => ({
    code: 'resource-blocked' as const,
    message: `Blocked network resource: ${url}`,
    detail: `${total} network resource(s) blocked`,
  }));
}

/** The page/margin mapping the Settings defaults drive. Electron's
 *  `printToPDF` margins are INCHES, so `marginMm` is divided by 25.4. */
export interface HtmlPrintOptions {
  pageSize: 'a4' | 'letter';
  marginMm: number;
  printBackground: boolean;
  /** Phase 54 item 0 — honour the document's own `@page` `size`/`margin`
   *  instead of the Settings paper size (the SVG engine fallback composes an
   *  `@page` rule from the SVG's intrinsic page size). Optional and defaults
   *  to false, so every pre-existing caller keeps the current behaviour. */
  preferCSSPageSize?: boolean;
}

/** The `printToPDF` option subset this engine sets. `preferCSSPageSize` is
 *  false by default (the Settings page size and margins win over any `@page`
 *  rule); a caller that composes its own `@page` size (the Phase 54 SVG engine
 *  fallback) opts in via `HtmlPrintOptions.preferCSSPageSize`. */
export interface ElectronConvertPrintToPdfOptions {
  pageSize: 'A4' | 'Letter';
  margins: { top: number; bottom: number; left: number; right: number };
  printBackground: boolean;
  preferCSSPageSize: boolean;
}

const PAGE_SIZE_NAMES: Record<'a4' | 'letter', 'A4' | 'Letter'> = {
  a4: 'A4',
  letter: 'Letter',
};

export function mapHtmlPrintOptions(
  options: HtmlPrintOptions,
): ElectronConvertPrintToPdfOptions {
  const inches = options.marginMm / 25.4;
  return {
    pageSize: PAGE_SIZE_NAMES[options.pageSize],
    margins: { top: inches, bottom: inches, left: inches, right: inches },
    printBackground: options.printBackground,
    preferCSSPageSize: options.preferCSSPageSize ?? false,
  };
}

/** The minimal window surface the engine needs (stubbed in unit tests). */
export interface HiddenConvertWindow {
  webContents: {
    once(event: 'did-finish-load', listener: () => void): void;
    printToPDF(options: ElectronConvertPrintToPdfOptions): Promise<Uint8Array>;
  };
  loadFile(path: string): Promise<void>;
  isDestroyed(): boolean;
  destroy(): void;
}

/** Injection seam so the engine is unit-testable without Electron. */
export interface HtmlPrintDeps {
  createWindow(): HiddenConvertWindow;
  loadFile(win: HiddenConvertWindow, path: string): Promise<void>;
  printToPdf(
    win: HiddenConvertWindow,
    options: ElectronConvertPrintToPdfOptions,
  ): Promise<Uint8Array>;
  tempDir(): string;
  writeFile(path: string, data: string): Promise<void>;
  unlink(path: string): Promise<void>;
  collectBlockedUrls(): string[];
  /** Override the print deadline (tests use a tiny value). */
  timeoutMs?: number;
}
/** Recorded blocked URLs for the current conversion. Reset when a window is
 *  created, so one conversion never sees another's warnings. */
let blockedUrls: string[] = [];

/** The dedicated session. `session.fromPartition` returns the same Session for
 *  the same partition, so calling it per window is cheap and never touches the
 *  default session. */
function prepareConvertSession(): Session {
  blockedUrls = [];
  const ses = session.fromPartition(CONVERT_SESSION_PARTITION);
  ses.webRequest.onBeforeRequest(
    { urls: [...CONVERT_BLOCKED_URL_PATTERNS] },
    createBlockedRequestHandler((url) => {
      blockedUrls.push(url);
    }),
  );
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  return ses;
}

export const defaultHtmlPrintDeps: HtmlPrintDeps = {
  createWindow(): HiddenConvertWindow {
    const ses = prepareConvertSession();
    const win = new BrowserWindow({
      show: false,
      width: 800,
      height: 600,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // The document is untrusted markup: no scripting at all.
        javascript: false,
        // DEDICATED partition, never defaultSession (Phase 44/50 sign-in).
        session: ses,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith('file:')) event.preventDefault();
    });
    win.webContents.on('will-attach-webview', (event) => event.preventDefault());
    return win as unknown as HiddenConvertWindow;
  },
  async loadFile(win, path): Promise<void> {
    await win.loadFile(path);
  },
  async printToPdf(win, options): Promise<Uint8Array> {
    return win.webContents.printToPDF(options);
  },
  tempDir(): string {
    return app.getPath('temp');
  },
  async writeFile(path, data): Promise<void> {
    await writeFile(path, data, 'utf8');
  },
  async unlink(path): Promise<void> {
    await unlink(path).catch(() => undefined);
  },
  collectBlockedUrls(): string[] {
    return [...blockedUrls];
  },
};

/** Timeout sentinel. NOTE: `print.ts`'s `withTimeout`/`PRINT_TIMEOUT_SENTINEL`
 *  are module-private (not exported), and this chunk must not edit `print.ts`
 *  to widen its scope, so the same 120 s bound is re-expressed locally while
 *  `PRINT_TIMEOUT_MS` itself is imported from `print.ts` (single source). */
const CONVERT_TIMEOUT_SENTINEL = Symbol('tflex-convert-timeout');

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(CONVERT_TIMEOUT_SENTINEL), ms);
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

export interface HtmlPrintResult {
  bytes: Uint8Array;
  pageCount: number;
  blockedUrls: string[];
}

/** The injected print seam adapters accept; defaults to `printHtmlToPdf`,
 *  faked in unit tests so no Electron is needed. */
export type HtmlPrintFn = (
  html: string,
  options: HtmlPrintOptions,
) => Promise<Result<HtmlPrintResult, ConvertErrorCode>>;

/** Count pages by re-parsing the bytes we are about to return (never trust a
 *  page count we did not read back). */
async function countPdfPages(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

/**
 * Render `html` to PDF bytes through the isolated offscreen window. Every
 * failure is a typed `Result`, never a rejection:
 *  - the temp file is unlinked and the window destroyed exactly once in the
 *    `finally`, on success, timeout, throw and cancel alike;
 *  - a stalled `printToPDF` is bounded by `timeoutMs` (default 120 s) and maps
 *    to `err('timeout')`;
 *  - bytes without the `%PDF-` signature map to `err('decode-failed')` and are
 *    never returned (a non-PDF must not reach the engine).
 */
export async function printHtmlToPdf(
  html: string,
  options: HtmlPrintOptions,
  deps: HtmlPrintDeps = defaultHtmlPrintDeps,
): Promise<Result<HtmlPrintResult, ConvertErrorCode>> {
  const tempPath = join(deps.tempDir(), `tflex-convert-${randomUUID()}.html`);
  let win: HiddenConvertWindow | undefined;
  let destroyed = false;
  const destroyOnce = (): void => {
    if (win === undefined || destroyed) return;
    destroyed = true;
    if (!win.isDestroyed()) win.destroy();
  };
  try {
    // Belt-and-braces: the engine guarantees the CSP exists even if a caller
    // forgets. `injectSecurityMeta` is idempotent, so adapter-injected
    // documents keep exactly one meta.
    await deps.writeFile(tempPath, injectSecurityMeta(html));
    win = deps.createWindow();
    const active = win;
    await new Promise<void>((resolve, reject) => {
      active.webContents.once('did-finish-load', () => resolve());
      deps.loadFile(active, tempPath).catch(reject);
    });

    let bytes: Uint8Array;
    try {
      bytes = await withTimeout(
        deps.printToPdf(active, mapHtmlPrintOptions(options)),
        deps.timeoutMs ?? PRINT_TIMEOUT_MS,
      );
    } catch (thrown) {
      if (thrown === CONVERT_TIMEOUT_SENTINEL) {
        return err('timeout', CONVERT_ERROR_MESSAGES.timeout);
      }
      throw thrown;
    }

    if (!isPdfBytes(bytes)) {
      return err('decode-failed', CONVERT_ERROR_MESSAGES['decode-failed']);
    }

    let pageCount: number;
    try {
      pageCount = await countPdfPages(bytes);
    } catch {
      return err('corrupt', CONVERT_ERROR_MESSAGES.corrupt);
    }
    return ok({ bytes, pageCount, blockedUrls: deps.collectBlockedUrls() });
  } catch (thrown) {
    return mapAdapterThrow(thrown);
  } finally {
    destroyOnce();
    await deps.unlink(tempPath);
  }
}
