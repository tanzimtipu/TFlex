import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PDFDocument } from '@cantoo/pdf-lib';

const h = vi.hoisted(() => ({
  browserWindowOptions: [] as unknown[],
  sessionFactory: vi.fn(),
  fakeSession: {
    webRequest: { onBeforeRequest: vi.fn() },
    setPermissionRequestHandler: vi.fn(),
  },
  defaultSession: { kind: 'default' },
  appGetPath: vi.fn(() => 'C:/tmp'),
}));

vi.mock('electron', () => {
  class FakeBrowserWindow {
    readonly options: unknown;
    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      once: vi.fn(),
      printToPDF: vi.fn(),
    };
    isDestroyed = vi.fn(() => false);
    destroy = vi.fn();
    constructor(options: unknown) {
      this.options = options;
      h.browserWindowOptions.push(options);
    }
  }
  return {
    app: { getPath: h.appGetPath },
    session: { fromPartition: h.sessionFactory, defaultSession: h.defaultSession },
    BrowserWindow: FakeBrowserWindow,
  };
});

import {
  CONVERT_BLOCKED_URL_PATTERNS,
  CONVERT_SESSION_PARTITION,
  blockedResourceWarnings,
  createBlockedRequestHandler,
  defaultHtmlPrintDeps,
  printHtmlToPdf,
  type HiddenConvertWindow,
  type HtmlPrintDeps,
  type HtmlPrintOptions,
} from '../../../src/main/services/convert/html-print';

/**
 * Phase 53 chunk B — the offscreen print engine. Electron is mocked at module
 * level exactly as `print.test.ts` does; no Electron process is started.
 */

const OPTIONS: HtmlPrintOptions = { pageSize: 'a4', marginMm: 20, printBackground: true };

async function twoPagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.addPage();
  return doc.save();
}

function makeWin(): {
  win: HiddenConvertWindow;
  destroy: ReturnType<typeof vi.fn>;
  fireLoad: () => void;
} {
  const destroy = vi.fn();
  let loadListener: (() => void) | undefined;
  const win: HiddenConvertWindow = {
    webContents: {
      once: (_event, listener) => {
        loadListener = listener;
      },
      printToPDF: async () => new Uint8Array(),
    },
    loadFile: async () => undefined,
    isDestroyed: () => false,
    destroy,
  };
  return { win, destroy, fireLoad: () => loadListener?.() };
}

interface Harness {
  deps: HtmlPrintDeps;
  unlink: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

function harness(
  overrides: Partial<HtmlPrintDeps> & Pick<HtmlPrintDeps, 'printToPdf'>,
): Harness {
  const { win, destroy, fireLoad } = makeWin();
  const unlink = vi.fn(async () => undefined);
  const deps: HtmlPrintDeps = {
    createWindow: () => win,
    // Mirrors Electron: `did-finish-load` fires only after a successful load.
    loadFile: async () => {
      fireLoad();
    },
    tempDir: () => 'C:/tmp',
    writeFile: async () => undefined,
    unlink,
    collectBlockedUrls: () => [],
    timeoutMs: 50,
    ...overrides,
    printToPdf: overrides.printToPdf,
  };
  return { deps, unlink, destroy };
}

describe('phase53 html print: dedicated session', () => {
  beforeEach(() => {
    h.browserWindowOptions.length = 0;
    h.sessionFactory.mockClear();
    h.sessionFactory.mockReturnValue(h.fakeSession);
    h.fakeSession.webRequest.onBeforeRequest.mockClear();
    h.fakeSession.setPermissionRequestHandler.mockClear();
  });

  it('creates a hidden, JS-off window on the dedicated partition, never the default session', () => {
    defaultHtmlPrintDeps.createWindow();
    const options = h.browserWindowOptions[0] as {
      show: boolean;
      webPreferences: { javascript: boolean; session: unknown };
    };
    expect(options.show).toBe(false);
    expect(options.webPreferences.javascript).toBe(false);
    expect(h.sessionFactory).toHaveBeenCalledWith(CONVERT_SESSION_PARTITION);
    expect(options.webPreferences.session).toBe(h.fakeSession);
    expect(options.webPreferences.session).not.toBe(h.defaultSession);
    expect(h.fakeSession.webRequest.onBeforeRequest).toHaveBeenCalledWith(
      { urls: [...CONVERT_BLOCKED_URL_PATTERNS] },
      expect.any(Function),
    );
    expect(h.fakeSession.setPermissionRequestHandler).toHaveBeenCalledWith(
      expect.any(Function),
    );
  });

  it('blocks http, https, ws, wss and ftp and cancels the request', () => {
    for (const scheme of ['http:', 'https:', 'ws:', 'wss:', 'ftp:']) {
      expect(
        CONVERT_BLOCKED_URL_PATTERNS.some((pattern) => pattern.startsWith(scheme)),
      ).toBe(true);
    }
    const record = vi.fn();
    const callback = vi.fn();
    createBlockedRequestHandler(record)({ url: 'https://evil.test/x.png' }, callback);
    expect(record).toHaveBeenCalledWith('https://evil.test/x.png');
    expect(callback).toHaveBeenCalledWith({ cancel: true });
  });

  it('caps resource warnings at 5 names and carries the total in detail', () => {
    const urls = Array.from({ length: 7 }, (_, i) => `https://evil.test/${i}.png`);
    const warnings = blockedResourceWarnings(urls);
    expect(warnings).toHaveLength(5);
    expect(warnings.every((warning) => warning.code === 'resource-blocked')).toBe(true);
    expect(warnings[0]?.detail).toContain('7');
    expect(blockedResourceWarnings([])).toEqual([]);
  });
});
describe('phase53 html print: engine', () => {
  it('returns bytes, page count and blocked urls, and cleans up', async () => {
    const bytes = await twoPagePdf();
    const { deps, unlink, destroy } = harness({
      printToPdf: async () => bytes,
      collectBlockedUrls: () => ['https://evil.test/a.png'],
    });
    const result = await printHtmlToPdf('<html></html>', OPTIONS, deps);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pageCount).toBe(2);
      expect(result.value.blockedUrls).toEqual(['https://evil.test/a.png']);
      expect(result.value.bytes.length).toBeGreaterThan(0);
    }
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('maps a stalled printToPDF to err(timeout), also cleaning up', async () => {
    const { deps, unlink, destroy } = harness({
      printToPdf: () => new Promise<Uint8Array>(() => undefined),
      timeoutMs: 10,
    });
    const result = await printHtmlToPdf('<html></html>', OPTIONS, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('timeout');
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('maps non-%PDF- bytes to err(decode-failed) and never returns them', async () => {
    const { deps, unlink, destroy } = harness({
      printToPdf: async () => new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]),
    });
    const result = await printHtmlToPdf('<html></html>', OPTIONS, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('decode-failed');
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('maps a thrown load failure to err(internal) and cleans up', async () => {
    const { deps, unlink, destroy } = harness({
      printToPdf: async () => new Uint8Array(),
      loadFile: async () => {
        throw new Error('load exploded');
      },
    });
    const result = await printHtmlToPdf('<html></html>', OPTIONS, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('internal');
      expect(result.error.message).toContain('load exploded');
    }
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the window exactly once even when destroy is called twice', async () => {
    const bytes = await twoPagePdf();
    const { deps, destroy } = harness({ printToPdf: async () => bytes });
    const result = await printHtmlToPdf('<html></html>', OPTIONS, deps);
    expect(result.ok).toBe(true);
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
