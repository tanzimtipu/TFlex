import { vi, describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Phase 35 - standalone print window (backend half).
//
// Mirrors window.test.ts: electron is mocked with a real BrowserWindow class
// so `new` records every constructed window, and the module's singleton
// lifecycle (create / focus / refresh / close / gone-notification) is driven
// through the recorded instances.
// ---------------------------------------------------------------------------

const { _windows } = vi.hoisted(() => ({
  _windows: [] as Array<Record<string, unknown>>,
}));

vi.mock('electron', () => {
  class MockBrowserWindow {
    _opts: Record<string, unknown>;
    _listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    on: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    loadURL: ReturnType<typeof vi.fn>;
    loadFile: ReturnType<typeof vi.fn>;
    isDestroyed: ReturnType<typeof vi.fn>;
    isMinimized: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
    webContents: { send: ReturnType<typeof vi.fn> };

    constructor(opts: Record<string, unknown>) {
      this._opts = opts;
      this.on = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        (this._listeners[event] ??= []).push(cb);
      });
      this.once = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        (this._listeners[event] ??= []).push(cb);
      });
      this.loadURL = vi.fn().mockResolvedValue(undefined);
      this.loadFile = vi.fn().mockResolvedValue(undefined);
      this.isDestroyed = vi.fn().mockReturnValue(false);
      this.isMinimized = vi.fn().mockReturnValue(false);
      this.close = vi.fn();
      this.focus = vi.fn();
      this.restore = vi.fn();
      this.show = vi.fn();
      this.webContents = { send: vi.fn() };
      _windows.push(this as unknown as Record<string, unknown>);
    }

    _emit(event: string, ...args: unknown[]): void {
      for (const cb of this._listeners[event] ?? []) {
        cb(...args);
      }
    }
  }

  return {
    app: { getAppPath: () => process.cwd() },
    BrowserWindow: MockBrowserWindow,
    screen: { getAllDisplays: () => [] },
  };
});

import {
  buildPrintWindowLoad,
  closePrintWindow,
  hasPrintWindow,
  notifyPrintDocumentGone,
  openPrintWindow,
  parsePrintWindowContext,
  printWindowQuery,
  PRINT_WINDOW_HEIGHT,
  PRINT_WINDOW_MAX_PAGES,
  PRINT_WINDOW_TITLE,
  PRINT_WINDOW_WIDTH,
} from '../../../src/main/print-window';
import type { PrintWindowContext } from '../../../src/shared/types';
import { IPC } from '../../../src/shared/ipc';

function last(): Record<string, unknown> {
  return _windows[_windows.length - 1] as Record<string, unknown>;
}

const CONTEXT: PrintWindowContext = {
  docId: 'doc-1',
  documentName: 'Report.pdf',
  pageCount: 3,
  settings: { copies: 2, landscape: true },
};

const DEV_SOURCE = { rendererHtml: '/app/renderer/index.html', rendererDevUrl: 'http://localhost:5173' };
const PACKAGED_SOURCE = { rendererHtml: '/app/renderer/index.html' };

beforeEach(() => {
  // The print window is a module-level singleton; reset it between tests so
  // each case starts with no live window, then drop the recorded instances.
  closePrintWindow();
  _windows.length = 0;
});

// ---------------------------------------------------------------------------
// Context parse + validation
// ---------------------------------------------------------------------------

describe('Phase 35 - parsePrintWindowContext', () => {
  it('accepts a valid context and carries it through', () => {
    const result = parsePrintWindowContext(CONTEXT);
    expect(result).toEqual({ ok: true, value: CONTEXT });
  });

  it('accepts an empty settings object', () => {
    const result = parsePrintWindowContext({ ...CONTEXT, settings: {} });
    expect(result.ok).toBe(true);
  });

  it('rejects a non-object (malformed) context', () => {
    expect(parsePrintWindowContext(null)).toEqual({
      ok: false,
      error: { code: 'invalid-context', message: 'print window context must be an object' },
    });
    expect(parsePrintWindowContext('nope').ok).toBe(false);
    expect(parsePrintWindowContext([CONTEXT]).ok).toBe(false);
  });

  it('rejects a missing docId', () => {
    const { docId: _docId, ...rest } = CONTEXT;
    expect(parsePrintWindowContext(rest)).toEqual({
      ok: false,
      error: { code: 'invalid-context', message: 'docId must be a non-empty string' },
    });
    expect(parsePrintWindowContext({ ...CONTEXT, docId: '   ' }).ok).toBe(false);
  });

  it('rejects a missing documentName', () => {
    const { documentName: _documentName, ...rest } = CONTEXT;
    expect(parsePrintWindowContext(rest)).toEqual({
      ok: false,
      error: { code: 'invalid-context', message: 'documentName must be a string' },
    });
  });

  it('rejects a missing pageCount', () => {
    const { pageCount: _pageCount, ...rest } = CONTEXT;
    expect(parsePrintWindowContext(rest)).toEqual({
      ok: false,
      error: { code: 'invalid-context', message: 'pageCount must be a non-negative integer' },
    });
  });

  it('rejects a missing settings object', () => {
    const { settings: _settings, ...rest } = CONTEXT;
    expect(parsePrintWindowContext(rest)).toEqual({
      ok: false,
      error: { code: 'invalid-context', message: 'settings must be an object' },
    });
  });

  it('rejects an absurd page count', () => {
    expect(parsePrintWindowContext({ ...CONTEXT, pageCount: -1 }).ok).toBe(false);
    expect(parsePrintWindowContext({ ...CONTEXT, pageCount: 1.5 }).ok).toBe(false);
    expect(parsePrintWindowContext({ ...CONTEXT, pageCount: Number.NaN }).ok).toBe(false);
    expect(parsePrintWindowContext({ ...CONTEXT, pageCount: PRINT_WINDOW_MAX_PAGES + 1 })).toEqual({
      ok: false,
      error: {
        code: 'invalid-context',
        message: `pageCount must not exceed ${PRINT_WINDOW_MAX_PAGES}`,
      },
    });
    expect(parsePrintWindowContext({ ...CONTEXT, pageCount: PRINT_WINDOW_MAX_PAGES }).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dev / packaged URL construction (pure)
// ---------------------------------------------------------------------------

describe('Phase 35 - buildPrintWindowLoad', () => {
  it('builds a dev-server URL with the tfWindow=print entry flag and encoded context', () => {
    const load = buildPrintWindowLoad(DEV_SOURCE, CONTEXT);
    expect(load.kind).toBe('url');
    const url = new URL(load.target);
    expect(url.origin + url.pathname).toBe('http://localhost:5173/');
    expect(url.searchParams.get('tfWindow')).toBe('print');
    expect(JSON.parse(url.searchParams.get('context') ?? 'null')).toEqual(CONTEXT);
  });

  it('builds a packaged loadFile target with the same query', () => {
    const load = buildPrintWindowLoad(PACKAGED_SOURCE, CONTEXT);
    expect(load).toEqual({
      kind: 'file',
      target: '/app/renderer/index.html',
      query: printWindowQuery(CONTEXT),
    });
  });

  it('preserves an existing query string on the dev URL', () => {
    const load = buildPrintWindowLoad(
      { rendererHtml: '/app/index.html', rendererDevUrl: 'http://localhost:5173/?hot=1' },
      CONTEXT,
    );
    const url = new URL(load.target);
    expect(url.searchParams.get('hot')).toBe('1');
    expect(url.searchParams.get('tfWindow')).toBe('print');
  });
});

// ---------------------------------------------------------------------------
// Window creation / focus / refresh
// ---------------------------------------------------------------------------

describe('Phase 35 - openPrintWindow', () => {
  it('creates exactly one top-level, resizable, preloaded OS window', () => {
    const result = openPrintWindow(CONTEXT, DEV_SOURCE);
    expect(result).toEqual({ ok: true, created: true });
    expect(_windows).toHaveLength(1);

    const opts = last()._opts as Record<string, unknown>;
    expect(opts).toMatchObject({
      width: PRINT_WINDOW_WIDTH,
      height: PRINT_WINDOW_HEIGHT,
      title: PRINT_WINDOW_TITLE,
      frame: true,
      resizable: true,
    });
    // Its OWN window: no parent/modal link to the app window.
    expect(opts.parent).toBeUndefined();
    expect(opts.modal ?? false).toBe(false);
    // The app's normal preload, so listPrinters/printJob work here too.
    const prefs = opts.webPreferences as Record<string, unknown>;
    expect(prefs.preload).toMatch(/preload\.cjs$/);
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.sandbox).toBe(true);
  });

  it('sets the shipped Jovrel app icon on the print window', () => {
    openPrintWindow(CONTEXT, DEV_SOURCE);
    const opts = last()._opts as Record<string, unknown>;
    expect(opts.icon).toBe(join(process.cwd(), 'assets', 'brand', 'jovrel.ico'));
  });

  it('loads the dev URL including the context query', () => {
    openPrintWindow(CONTEXT, DEV_SOURCE);
    const win = last();
    expect(win.loadFile).not.toHaveBeenCalled();
    const target = (win.loadURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const url = new URL(target);
    expect(url.searchParams.get('tfWindow')).toBe('print');
    expect(JSON.parse(url.searchParams.get('context') ?? 'null')).toEqual(CONTEXT);
  });

  it('loads the built index.html with the query when packaged', () => {
    openPrintWindow(CONTEXT, PACKAGED_SOURCE);
    const win = last();
    expect(win.loadURL).not.toHaveBeenCalled();
    expect(win.loadFile).toHaveBeenCalledWith('/app/renderer/index.html', {
      query: printWindowQuery(CONTEXT),
    });
  });

  it('shows the window on ready-to-show', () => {
    openPrintWindow(CONTEXT, DEV_SOURCE);
    (last() as any)._emit('ready-to-show');
    expect(last().show).toHaveBeenCalled();
  });

  it('focuses the existing window on a repeat request instead of stacking', () => {
    openPrintWindow(CONTEXT, DEV_SOURCE);
    const result = openPrintWindow(CONTEXT, DEV_SOURCE);
    expect(result).toEqual({ ok: true, created: false });
    expect(_windows).toHaveLength(1);
    expect(last().focus).toHaveBeenCalled();
    expect(last().loadURL).toHaveBeenCalledTimes(1);
  });

  it('restores a minimized print window before focusing it', () => {
    openPrintWindow(CONTEXT, DEV_SOURCE);
    (last().isMinimized as ReturnType<typeof vi.fn>).mockReturnValue(true);
    openPrintWindow(CONTEXT, DEV_SOURCE);
    expect(last().restore).toHaveBeenCalled();
    expect(last().focus).toHaveBeenCalled();
  });

  it('refreshes the window when the document changed', () => {
    openPrintWindow(CONTEXT, DEV_SOURCE);
    const result = openPrintWindow({ ...CONTEXT, docId: 'doc-2' }, DEV_SOURCE);
    expect(result).toEqual({ ok: true, created: false });
    expect(_windows).toHaveLength(1);
    expect(last().loadURL).toHaveBeenCalledTimes(2);
    const target = (last().loadURL as ReturnType<typeof vi.fn>).mock.calls[1][0] as string;
    const parsed = JSON.parse(new URL(target).searchParams.get('context') ?? 'null') as {
      docId: string;
    };
    expect(parsed.docId).toBe('doc-2');
  });

  it('fails loud on a malformed context without creating a window', () => {
    const result = openPrintWindow({ docId: 'x' }, DEV_SOURCE);
    expect(result.ok).toBe(false);
    expect(_windows).toHaveLength(0);
    expect(hasPrintWindow()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Lifecycle: close / quit / document gone
// ---------------------------------------------------------------------------

describe('Phase 35 - print window lifecycle', () => {
  it('clears the singleton when the user closes the print window', () => {
    openPrintWindow(CONTEXT, DEV_SOURCE);
    (last() as any)._emit('closed');
    expect(hasPrintWindow()).toBe(false);
    // The app is untouched and a later request opens a fresh window.
    expect(closePrintWindow).not.toThrow();
    openPrintWindow(CONTEXT, DEV_SOURCE);
    expect(_windows).toHaveLength(2);
  });

  it('closes the print window on app quit (closePrintWindow) and is a no-op when none is open', () => {
    expect(() => closePrintWindow()).not.toThrow();
    openPrintWindow(CONTEXT, DEV_SOURCE);
    const win = last();
    closePrintWindow();
    expect(win.close).toHaveBeenCalled();
    expect(hasPrintWindow()).toBe(false);
  });

  it('notifies the print window when its document is gone', () => {
    openPrintWindow(CONTEXT, DEV_SOURCE);
    expect(notifyPrintDocumentGone('doc-1')).toBe(true);
    const send = (last().webContents as { send: ReturnType<typeof vi.fn> }).send;
    expect(send).toHaveBeenCalledWith(IPC.printDocumentGoneEvent, 'doc-1');
  });

  it('does not notify a print window opened for a different document', () => {
    openPrintWindow(CONTEXT, DEV_SOURCE);
    expect(notifyPrintDocumentGone('other-doc')).toBe(false);
    const send = (last().webContents as { send: ReturnType<typeof vi.fn> }).send;
    expect(send).not.toHaveBeenCalled();
  });

  it('does not notify when no print window is open', () => {
    expect(notifyPrintDocumentGone('doc-1')).toBe(false);
  });
});