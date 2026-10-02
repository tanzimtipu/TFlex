import { BrowserWindow } from 'electron';
import type {
  PrintSettings,
  PrintWindowContext,
  PrintWindowOpenResult,
} from '../shared/types';
import type { Result } from '../shared/result';
import { err } from '../shared/result';
import { IPC } from '../shared/ipc';
import { resolveAppIconPath, resolvePreloadPath } from './window';

/**
 * Phase 35 - the standalone print window.
 *
 * The in-app print dialog is an HTML modal inside the main window, so the OS
 * clamps any drag to the app window's bounds. This module creates the print UI
 * as its OWN top-level BrowserWindow (not a child/modal), so Windows lets the
 * user move it anywhere on the desktop, including beyond the app window.
 *
 * Main validates the context BEFORE creating anything (a malformed context
 * fails loud, never renders a broken UI) and seeds it through the renderer
 * entry flag `?tfWindow=print&context=<json>` using the app's existing
 * dev/prod URL handling (dev server URL vs the built index.html).
 *
 * One print window, ever: a repeat request focuses it and reloads it only when
 * the document changed (never stacks duplicates). Closing it leaves the app
 * untouched; closing the app closes it (index.ts wires the main window's
 * 'closed' event and app 'before-quit' to closePrintWindow), so no orphan
 * window or zombie process survives. When the document it was opened for is
 * gone, notifyPrintDocumentGone pushes an IPC event instead of leaving stale
 * data on screen.
 */

/** "Standard OS window" sizing: fits the settings + preview panes and still
 *  opens comfortably on a 1366x768 laptop (work area ~728px tall). */
export const PRINT_WINDOW_WIDTH = 820;
export const PRINT_WINDOW_HEIGHT = 860;
export const PRINT_WINDOW_MIN_WIDTH = 480;
export const PRINT_WINDOW_MIN_HEIGHT = 520;
/** Reject an absurd page count before it reaches the print UI. */
export const PRINT_WINDOW_MAX_PAGES = 50_000;
/** The renderer entry flag that selects the print-only UI. */
export const PRINT_WINDOW_ENTRY_FLAG = 'print';
export const PRINT_WINDOW_TITLE = 'Print - Jovrel';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate the context payload. Pure and exported so the unit tests pin the
 * valid / malformed / missing-field / absurd-page-count cases.
 */
export function parsePrintWindowContext(
  raw: unknown,
): Result<PrintWindowContext, 'invalid-context'> {
  if (!isPlainObject(raw)) {
    return err('invalid-context', 'print window context must be an object');
  }
  const { docId, documentName, pageCount, settings } = raw;
  if (typeof docId !== 'string' || docId.trim() === '') {
    return err('invalid-context', 'docId must be a non-empty string');
  }
  if (typeof documentName !== 'string') {
    return err('invalid-context', 'documentName must be a string');
  }
  if (typeof pageCount !== 'number' || !Number.isInteger(pageCount) || pageCount < 0) {
    return err('invalid-context', 'pageCount must be a non-negative integer');
  }
  if (pageCount > PRINT_WINDOW_MAX_PAGES) {
    return err('invalid-context', `pageCount must not exceed ${PRINT_WINDOW_MAX_PAGES}`);
  }
  if (!isPlainObject(settings)) {
    return err('invalid-context', 'settings must be an object');
  }
  return {
    ok: true,
    value: { docId, documentName, pageCount, settings: settings as PrintSettings },
  };
}

/** Where the print window loads the renderer from (the same dev/prod pair
 *  `createMainWindow` uses). */
export interface PrintWindowLoadSource {
  rendererHtml: string;
  rendererDevUrl?: string;
}

export interface PrintWindowLoad {
  kind: 'url' | 'file';
  /** dev: the full dev-server URL including query; packaged: the html path. */
  target: string;
  /** The entry flag + context query, applied via loadURL / loadFile. */
  query: Record<string, string>;
}

export function printWindowQuery(context: PrintWindowContext): Record<string, string> {
  return {
    tfWindow: PRINT_WINDOW_ENTRY_FLAG,
    context: JSON.stringify(context),
  };
}

/**
 * Pure dev/packaged load decision. Exported so the URL construction is
 * unit-testable without Electron: dev uses the dev-server URL (with the
 * tfWindow/context query appended), packaged uses the built index.html with
 * the same query passed to `loadFile`.
 */
export function buildPrintWindowLoad(
  source: PrintWindowLoadSource,
  context: PrintWindowContext,
): PrintWindowLoad {
  const query = printWindowQuery(context);
  if (source.rendererDevUrl !== undefined) {
    const url = new URL(source.rendererDevUrl);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    return { kind: 'url', target: url.toString(), query };
  }
  return { kind: 'file', target: source.rendererHtml, query };
}

/** The single live print window (null when none is open). */
let printWindow: BrowserWindow | null = null;
/** The document id the live window was last loaded for. */
let printWindowDocId: string | null = null;

function loadInto(
  win: BrowserWindow,
  source: PrintWindowLoadSource,
  context: PrintWindowContext,
): void {
  const target = buildPrintWindowLoad(source, context);
  if (target.kind === 'url') {
    void win.loadURL(target.target);
  } else {
    void win.loadFile(target.target, { query: target.query });
  }
}

function createPrintWindow(
  source: PrintWindowLoadSource,
  context: PrintWindowContext,
): BrowserWindow {
  const win = new BrowserWindow({
    width: PRINT_WINDOW_WIDTH,
    height: PRINT_WINDOW_HEIGHT,
    minWidth: PRINT_WINDOW_MIN_WIDTH,
    minHeight: PRINT_WINDOW_MIN_HEIGHT,
    title: PRINT_WINDOW_TITLE,
    icon: resolveAppIconPath(),
    // A standard, fully framed top-level window: the native title bar is what
    // lets the user drag it anywhere on the desktop, including clear of the
    // app window. Not a child/modal, so no parent clamps its bounds.
    frame: true,
    resizable: true,
    minimizable: true,
    maximizable: true,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#eef1f5',
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });
  win.on('closed', () => {
    // Only clear the singleton if it still points at this window (a reopened
    // window may already have replaced it).
    if (printWindow === win) {
      printWindow = null;
      printWindowDocId = null;
    }
  });

  loadInto(win, source, context);
  printWindowDocId = context.docId;
  return win;
}

/**
 * Open the print window, or focus (and refresh) the existing one. Validation
 * failures resolve `{ ok: false, reason }` without creating a window.
 */
export function openPrintWindow(
  rawContext: unknown,
  source: PrintWindowLoadSource,
): PrintWindowOpenResult {
  const parsed = parsePrintWindowContext(rawContext);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.error.message };
  }
  const context = parsed.value;

  if (printWindow !== null && !printWindow.isDestroyed()) {
    if (printWindow.isMinimized()) {
      printWindow.restore();
    }
    printWindow.focus();
    // Refresh only when the document changed; a same-document repeat is a
    // plain focus so an in-progress settings edit is not thrown away.
    if (printWindowDocId !== context.docId) {
      loadInto(printWindow, source, context);
      printWindowDocId = context.docId;
    }
    return { ok: true, created: false };
  }

  printWindow = createPrintWindow(source, context);
  return { ok: true, created: true };
}

/** Close the print window, if open. Safe to call when none exists. */
export function closePrintWindow(): void {
  const win = printWindow;
  printWindow = null;
  printWindowDocId = null;
  if (win !== null && !win.isDestroyed()) {
    win.close();
  }
}

/**
 * Tell the print window its document is gone. No-op (returns false) when no
 * print window is open or it belongs to a different document, so the event can
 * never target stale content.
 */
export function notifyPrintDocumentGone(docId: string): boolean {
  if (printWindow === null || printWindow.isDestroyed()) return false;
  if (printWindowDocId !== docId) return false;
  printWindow.webContents.send(IPC.printDocumentGoneEvent, docId);
  return true;
}

/** True while a live print window exists. */
export function hasPrintWindow(): boolean {
  return printWindow !== null && !printWindow.isDestroyed();
}