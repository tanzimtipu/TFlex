import { describe, it, expect, vi, beforeEach } from 'vitest';

const { _app, _buildFromTemplate } = vi.hoisted(() => ({
  _app: { getPath: vi.fn(() => 'C:/tmp'), quit: vi.fn() },
  _buildFromTemplate: vi.fn(),
}));

vi.mock('electron', () => ({
  app: _app,
  // Only the default deps construct a BrowserWindow; every print-job test
  // injects its own fake window, so this class is never instantiated.
  BrowserWindow: class {},
  Menu: {
    setApplicationMenu: vi.fn(),
    getApplicationMenu: () => null,
    buildFromTemplate: (template: unknown) => {
      _buildFromTemplate(template);
      return template;
    },
  },
}));

import {
  ALLOWED_PAGES_PER_SHEET,
  composePrintHtml,
  isVirtualPdfPrinter,
  listPrinters,
  mapPrintSettings,
  printJob,
  validatePrintPayload,
  type HiddenPrintWindow,
  type PrintJobDeps,
} from '../../../src/main/services/print';
import { buildAppMenu } from '../../../src/main/menu';
import type { PrintJobPayload, PrintSettings } from '../../../src/shared/types';

// DEF-270 — a real 1x1 PNG; the old placeholder `data:image/png;base64,AAAA`
// decodes to three zero bytes and is now correctly rejected by bad-image.
const IMG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const DEVICE = 'HP LaserJet Pro M404';

/** Build a data URL from raw magic bytes (for the JPEG / WEBP accept cases). */
function dataUrl(mime: string, bytes: number[]): string {
  return `data:image/${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

const JPEG = dataUrl('jpeg', [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const JPG = dataUrl('jpg', [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP = dataUrl('webp', [0x52, 0x49, 0x46, 0x46, 0x08, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

function payload(images: string[], settings: PrintSettings = {}): PrintJobPayload {
  // DEF-269 — deviceName is mandatory at the IPC boundary; default it here so
  // the existing cases exercise their own field rather than the device check.
  return { images, settings: { deviceName: DEVICE, ...settings } };
}

// ---------------------------------------------------------------------------
// Validation matrix
// ---------------------------------------------------------------------------

describe('Phase 30: validatePrintPayload', () => {
  it('accepts a minimal valid payload', () => {
    expect(validatePrintPayload(payload([IMG]))).toEqual({ ok: true });
  });

  it('accepts a fully populated valid payload', () => {
    const result = validatePrintPayload(
      payload([IMG, IMG], {
        copies: 99,
        collate: true,
        pageRanges: [{ from: 0, to: 2 }],
        pagesPerSheet: 16,
        scalePercent: 500,
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it('rejects an empty images array with empty-images', () => {
    const result = validatePrintPayload(payload([]));
    expect(result).toEqual({ ok: false, reason: 'empty-images' });
  });

  it('rejects a missing images array with empty-images', () => {
    const result = validatePrintPayload({ images: undefined as unknown as string[], settings: {} });
    expect(result).toEqual({ ok: false, reason: 'empty-images' });
  });

  it('rejects a non-string image with bad-image', () => {
    const result = validatePrintPayload(payload([IMG, 42 as unknown as string]));
    expect(result).toEqual({ ok: false, reason: 'bad-image' });
  });

  // DEF-270 — bad-image now checks the real data-URL shape + image signature.
  it('accepts well-formed png / jpeg / jpg / webp data URLs', () => {
    for (const image of [IMG, JPEG, JPG, WEBP]) {
      expect(validatePrintPayload(payload([image]))).toEqual({ ok: true });
    }
  });

  it('rejects a non-data-URL string with bad-image', () => {
    expect(validatePrintPayload(payload(['not-a-data-url']))).toEqual({
      ok: false,
      reason: 'bad-image',
    });
  });

  it('rejects a valid-looking but undecodable payload with bad-image', () => {
    expect(validatePrintPayload(payload(['data:image/png;base64,AAAA']))).toEqual({
      ok: false,
      reason: 'bad-image',
    });
  });

  it('rejects a non-image or malformed data URL with bad-image', () => {
    for (const image of [
      'data:text/plain;base64,SGVsbG8=',
      'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      'data:image/png,notbase64',
      'data:image/png;base64,',
      '',
    ]) {
      expect(validatePrintPayload(payload([image]))).toEqual({ ok: false, reason: 'bad-image' });
    }
  });

  // DEF-269 — deviceName is mandatory at the IPC boundary.
  it('rejects a missing deviceName with bad-device-name', () => {
    expect(validatePrintPayload({ images: [IMG], settings: {} })).toEqual({
      ok: false,
      reason: 'bad-device-name',
    });
  });

  it('rejects an empty / non-string / null deviceName with bad-device-name', () => {
    for (const deviceName of ['', '   ', 12345, null, undefined]) {
      expect(
        validatePrintPayload({
          images: [IMG],
          settings: { deviceName: deviceName as unknown as string },
        }),
      ).toEqual({ ok: false, reason: 'bad-device-name' });
    }
  });

  it('accepts a normal deviceName string', () => {
    expect(validatePrintPayload(payload([IMG], { deviceName: 'HP123' }))).toEqual({ ok: true });
  });

  it('rejects copies 0 / 100 / fractional with bad-copies', () => {
    expect(validatePrintPayload(payload([IMG], { copies: 0 }))).toEqual({ ok: false, reason: 'bad-copies' });
    expect(validatePrintPayload(payload([IMG], { copies: 100 }))).toEqual({ ok: false, reason: 'bad-copies' });
    expect(validatePrintPayload(payload([IMG], { copies: 1.5 }))).toEqual({ ok: false, reason: 'bad-copies' });
  });

  it('accepts copies 1 and 99', () => {
    expect(validatePrintPayload(payload([IMG], { copies: 1 }))).toEqual({ ok: true });
    expect(validatePrintPayload(payload([IMG], { copies: 99 }))).toEqual({ ok: true });
  });

  it('rejects malformed page ranges with bad-page-range', () => {
    expect(validatePrintPayload(payload([IMG], { pageRanges: [{ from: 5, to: 2 }] }))).toEqual({
      ok: false,
      reason: 'bad-page-range',
    });
    expect(validatePrintPayload(payload([IMG], { pageRanges: [{ from: -1, to: 2 }] }))).toEqual({
      ok: false,
      reason: 'bad-page-range',
    });
    expect(validatePrintPayload(payload([IMG], { pageRanges: [{ from: 1.5, to: 3 }] }))).toEqual({
      ok: false,
      reason: 'bad-page-range',
    });
    expect(validatePrintPayload(payload([IMG], { pageRanges: 'nope' as unknown as [] }))).toEqual({
      ok: false,
      reason: 'bad-page-range',
    });
  });

  it('accepts a well-formed 0-based page range', () => {
    expect(validatePrintPayload(payload([IMG], { pageRanges: [{ from: 0, to: 0 }] }))).toEqual({ ok: true });
  });

  it('rejects an unlisted pagesPerSheet with bad-pages-per-sheet', () => {
    expect(validatePrintPayload(payload([IMG], { pagesPerSheet: 3 }))).toEqual({
      ok: false,
      reason: 'bad-pages-per-sheet',
    });
    expect(validatePrintPayload(payload([IMG], { pagesPerSheet: 5 }))).toEqual({
      ok: false,
      reason: 'bad-pages-per-sheet',
    });
  });

  it('accepts every allowlisted pagesPerSheet', () => {
    for (const value of ALLOWED_PAGES_PER_SHEET) {
      expect(validatePrintPayload(payload([IMG], { pagesPerSheet: value }))).toEqual({ ok: true });
    }
  });

  it('rejects scalePercent outside 1..500 with bad-scale-percent', () => {
    expect(validatePrintPayload(payload([IMG], { scalePercent: 0 }))).toEqual({
      ok: false,
      reason: 'bad-scale-percent',
    });
    expect(validatePrintPayload(payload([IMG], { scalePercent: 501 }))).toEqual({
      ok: false,
      reason: 'bad-scale-percent',
    });
    expect(validatePrintPayload(payload([IMG], { scalePercent: Number.NaN }))).toEqual({
      ok: false,
      reason: 'bad-scale-percent',
    });
  });
});

// ---------------------------------------------------------------------------
// Settings -> Electron option mapping
// ---------------------------------------------------------------------------

describe('Phase 30: mapPrintSettings', () => {
  it('sets silent + printBackground and Electron defaults for an empty object', () => {
    expect(mapPrintSettings({})).toEqual({
      silent: true,
      printBackground: true,
      copies: 1,
      collate: false,
      landscape: false,
      color: true,
      duplexMode: 'simplex',
      pagesPerSheet: 1,
    });
  });

  it('maps custom scaling to scaleFactor = percent / 100', () => {
    const options = mapPrintSettings({ scaling: 'custom', scalePercent: 150 });
    expect(options.scaleFactor).toBe(1.5);
    expect(options.silent).toBe(true);
    expect(options.printBackground).toBe(true);
  });

  it('maps landscape orientation', () => {
    expect(mapPrintSettings({ landscape: true }).landscape).toBe(true);
  });

  it('maps duplex long edge', () => {
    expect(mapPrintSettings({ duplex: 'longEdge' }).duplexMode).toBe('longEdge');
    expect(mapPrintSettings({ duplex: 'shortEdge' }).duplexMode).toBe('shortEdge');
  });

  it('maps N-up pagesPerSheet', () => {
    expect(mapPrintSettings({ pagesPerSheet: 4 }).pagesPerSheet).toBe(4);
  });

  it('maps greyscale (color: false)', () => {
    expect(mapPrintSettings({ color: false }).color).toBe(false);
  });

  it('maps deviceName and copies/collate', () => {
    const options = mapPrintSettings({ deviceName: 'HP123', copies: 3, collate: true });
    expect(options.deviceName).toBe('HP123');
    expect(options.copies).toBe(3);
    expect(options.collate).toBe(true);
  });

  it('passes pageRanges through as 0-based {from,to} objects', () => {
    const options = mapPrintSettings({ pageRanges: [{ from: 0, to: 2 }, { from: 5, to: 5 }] });
    expect(options.pageRanges).toEqual([{ from: 0, to: 2 }, { from: 5, to: 5 }]);
  });

  it('omits deviceName / pageRanges / scaleFactor when absent', () => {
    const options = mapPrintSettings({});
    expect('deviceName' in options).toBe(false);
    expect('pageRanges' in options).toBe(false);
    expect('scaleFactor' in options).toBe(false);
  });

  it('does not emit scaleFactor for non-custom scaling', () => {
    expect('scaleFactor' in mapPrintSettings({ scaling: 'fit' })).toBe(false);
    expect('scaleFactor' in mapPrintSettings({ scaling: 'actual' })).toBe(false);
    expect('scaleFactor' in mapPrintSettings({ scaling: 'shrink' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Virtual PDF printer rule (Electron has no output-path option)
// ---------------------------------------------------------------------------

describe('Phase 30: virtual PDF printer mapping', () => {
  it('emits silent: false for "Microsoft Print to PDF" and keeps every other option', () => {
    const options = mapPrintSettings({
      deviceName: 'Microsoft Print to PDF',
      copies: 3,
      collate: true,
      landscape: true,
      color: false,
      duplex: 'longEdge',
      pagesPerSheet: 4,
      pageRanges: [{ from: 0, to: 2 }],
      scaling: 'custom',
      scalePercent: 150,
    });
    expect(options).toEqual({
      silent: false,
      printBackground: true,
      deviceName: 'Microsoft Print to PDF',
      copies: 3,
      collate: true,
      landscape: true,
      color: false,
      duplexMode: 'longEdge',
      pagesPerSheet: 4,
      pageRanges: [{ from: 0, to: 2 }],
      scaleFactor: 1.5,
    });
  });

  it('keeps silent: true for a real printer name', () => {
    const options = mapPrintSettings({ deviceName: 'HP LaserJet Pro M404', copies: 2 });
    expect(options.silent).toBe(true);
    expect(options.deviceName).toBe('HP LaserJet Pro M404');
    expect(options.copies).toBe(2);
  });

  it('keeps silent: true when no deviceName is chosen', () => {
    expect(mapPrintSettings({}).silent).toBe(true);
    expect(mapPrintSettings({ deviceName: '' }).silent).toBe(true);
  });

  it('detects virtual PDF names case-insensitively', () => {
    for (const name of [
      'Microsoft Print to PDF',
      'microsoft print to pdf',
      'PDFCreator',
      'CutePDF Writer',
      'Adobe PDF',
    ]) {
      expect(isVirtualPdfPrinter(name)).toBe(true);
    }
  });

  it('treats "pdf" inside another word as virtual (substring, no word boundary)', () => {
    // Decision: substring match. A false positive costs one extra OS dialog;
    // a false negative means a silent job that can never succeed.
    expect(isVirtualPdfPrinter('MyPDFPrinter 3000')).toBe(true);
    expect(isVirtualPdfPrinter('PdfPrinter')).toBe(true);
  });

  it('does not flag real printers or missing names', () => {
    for (const name of ['HP123', 'Canon TS3100 series', 'Brother HL-L2350DW', 'PDQ Label']) {
      expect(isVirtualPdfPrinter(name)).toBe(false);
    }
    expect(isVirtualPdfPrinter(undefined)).toBe(false);
    expect(isVirtualPdfPrinter('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HTML composition
// ---------------------------------------------------------------------------

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe('Phase 30: composePrintHtml', () => {
  it('emits one image per data URL', () => {
    const html = composePrintHtml(payload([IMG, IMG, IMG]));
    expect(count(html, '<img ')).toBe(3);
    expect(count(html, 'class="sheet"')).toBe(3);
  });

  it('separates sheets with page-break-after: always', () => {
    const html = composePrintHtml(payload([IMG, IMG]));
    expect(html).toContain('page-break-after: always');
  });

  it('composes 9 images at 4-up into 3 grid sheets', () => {
    const html = composePrintHtml(payload(Array(9).fill(IMG), { pagesPerSheet: 4 }));
    expect(count(html, '<img ')).toBe(9);
    expect(count(html, 'class="sheet"')).toBe(3);
    expect(html).toContain('grid-template-columns: repeat(2, 1fr)');
    expect(html).toContain('grid-template-rows: repeat(2, 1fr)');
  });

  it('composes 2-up as a 2-column, 1-row grid', () => {
    const html = composePrintHtml(payload([IMG, IMG], { pagesPerSheet: 2 }));
    expect(count(html, 'class="sheet"')).toBe(1);
    expect(html).toContain('grid-template-columns: repeat(2, 1fr)');
    expect(html).toContain('grid-template-rows: repeat(1, 1fr)');
  });

  it('emits no grid CSS at 1-up', () => {
    const html = composePrintHtml(payload([IMG]));
    expect(html).not.toContain('display: grid');
  });

  it('sizes the image per the fit scaling rule (contain)', () => {
    const html = composePrintHtml(payload([IMG], { scaling: 'fit' }));
    expect(html).toContain('object-fit: contain');
  });

  it('sizes the image per the actual scaling rule (no up/down scale)', () => {
    const html = composePrintHtml(payload([IMG], { scaling: 'actual' }));
    expect(html).toContain('max-width: none');
    expect(html).toContain('width: auto');
  });

  it('sizes the image per the shrink rule (downscale only)', () => {
    const html = composePrintHtml(payload([IMG], { scaling: 'shrink' }));
    expect(html).toContain('max-width: 100%');
    expect(html).toContain('max-height: 100%');
  });

  it('sizes the image per the custom percentage', () => {
    const html = composePrintHtml(payload([IMG], { scaling: 'custom', scalePercent: 150 }));
    expect(html).toContain('width: 150%');
  });

  it('sets the @page orientation from the landscape flag', () => {
    expect(composePrintHtml(payload([IMG], { landscape: true }))).toContain('@page { size: landscape;');
    expect(composePrintHtml(payload([IMG], { landscape: false }))).toContain('@page { size: portrait;');
  });

  it('reflects the N-up page order in the grid flow', () => {
    expect(composePrintHtml(payload([IMG], { pagesPerSheet: 4 }))).toContain('grid-auto-flow: row;');
    expect(
      composePrintHtml(payload([IMG], { pagesPerSheet: 4, pageOrder: 'vertical' })),
    ).toContain('grid-auto-flow: column;');
    expect(
      composePrintHtml(payload([IMG], { pagesPerSheet: 4, pageOrder: 'horizontalReversed' })),
    ).toContain('direction: rtl;');
  });
});

// ---------------------------------------------------------------------------
// printJob orchestration (with an injected fake hidden window)
// ---------------------------------------------------------------------------

interface FakeDeps {
  deps: PrintJobDeps;
  createWindow: ReturnType<typeof vi.fn>;
  printOptions: () => unknown;
  destroyed: () => boolean;
  destroyCount: () => number;
}

function fakeDeps(
  result: { success: boolean; failureReason?: string },
  options: { neverCallback?: boolean; timeoutMs?: number } = {},
): FakeDeps {
  const listeners: Array<() => void> = [];
  let destroyed = false;
  let destroyCalls = 0;
  let captured: unknown = null;
  const createWindow = vi.fn(
    (): HiddenPrintWindow => ({
      webContents: {
        once: (_event, listener) => {
          listeners.push(listener);
        },
        print: (printOptions, callback) => {
          captured = printOptions;
          if (options.neverCallback === true) return; // DEF-269: driver never calls back
          callback(result.success, result.failureReason ?? '');
        },
      },
      isDestroyed: () => destroyed,
      destroy: () => {
        destroyed = true;
        destroyCalls += 1;
      },
    }),
  );
  const deps: PrintJobDeps = {
    createWindow,
    loadHtml: async () => {
      for (const listener of listeners) listener();
    },
  };
  if (options.timeoutMs !== undefined) deps.timeoutMs = options.timeoutMs;
  return {
    deps,
    createWindow,
    printOptions: () => captured,
    destroyed: () => destroyed,
    destroyCount: () => destroyCalls,
  };
}

describe('Phase 30: printJob', () => {
  it('rejects an invalid payload without opening a window', async () => {
    const fake = fakeDeps({ success: true });
    const result = await printJob(payload([]), fake.deps);
    expect(result).toEqual({ ok: false, reason: 'empty-images' });
    expect(fake.createWindow).not.toHaveBeenCalled();
  });

  it('resolves ok and destroys the hidden window exactly once on success', async () => {
    const fake = fakeDeps({ success: true });
    const result = await printJob(payload([IMG]), fake.deps);
    expect(result).toEqual({ ok: true });
    expect(fake.destroyed()).toBe(true);
    expect(fake.destroyCount()).toBe(1);
  });

  it('surfaces the OS failureReason and destroys the window exactly once', async () => {
    const fake = fakeDeps({ success: false, failureReason: 'Invalid printer name' });
    const result = await printJob(payload([IMG]), fake.deps);
    expect(result).toEqual({ ok: false, reason: 'Invalid printer name' });
    expect(fake.destroyed()).toBe(true);
    expect(fake.destroyCount()).toBe(1);
  });

  // DEF-269 — a driver that never invokes its callback must not hang or leak.
  it('resolves print-timeout and destroys the window exactly once when the driver never calls back', async () => {
    const fake = fakeDeps({ success: true }, { neverCallback: true, timeoutMs: 10 });
    const result = await printJob(payload([IMG]), fake.deps);
    expect(result).toEqual({ ok: false, reason: 'print-timeout' });
    expect(fake.destroyed()).toBe(true);
    expect(fake.destroyCount()).toBe(1);
  });

  it('rejects a missing deviceName before opening a window', async () => {
    const fake = fakeDeps({ success: true });
    const result = await printJob({ images: [IMG], settings: {} }, fake.deps);
    expect(result).toEqual({ ok: false, reason: 'bad-device-name' });
    expect(fake.createWindow).not.toHaveBeenCalled();
  });

  it('falls back to print-failed when the callback has no reason', async () => {
    const fake = fakeDeps({ success: false });
    const result = await printJob(payload([IMG]), fake.deps);
    expect(result).toEqual({ ok: false, reason: 'print-failed' });
  });

  it('forwards the mapped options to webContents.print', async () => {
    const fake = fakeDeps({ success: true });
    await printJob(payload([IMG], { scaling: 'custom', scalePercent: 150, landscape: true }), fake.deps);
    expect(fake.printOptions()).toMatchObject({
      silent: true,
      printBackground: true,
      scaleFactor: 1.5,
      landscape: true,
    });
  });

  it('resolves a typed failure and destroys the window once when mounting throws', async () => {
    let destroyCalls = 0;
    const deps: PrintJobDeps = {
      createWindow: () => ({
        webContents: { once: () => undefined, print: () => undefined },
        isDestroyed: () => false,
        destroy: () => {
          destroyCalls += 1;
        },
      }),
      loadHtml: async () => {
        throw new Error('mount failed');
      },
    };
    const result = await printJob(payload([IMG]), deps);
    expect(result).toEqual({ ok: false, reason: 'mount failed' });
    expect(destroyCalls).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// listPrinters mapping
// ---------------------------------------------------------------------------

describe('Phase 30: listPrinters', () => {
  it('maps system name / friendly name / default flag / status', async () => {
    const contents = {
      getPrintersAsync: async () => [
        { name: 'HP123', displayName: 'HP LaserJet', isDefault: true, status: 0 },
        { name: 'MS-PDF', displayName: '', isDefault: false },
      ],
    } as unknown as Parameters<typeof listPrinters>[0];

    const printers = await listPrinters(contents, {
      getSystemDefaultName: async () => undefined,
    });
    expect(printers).toEqual([
      { name: 'HP123', displayName: 'HP LaserJet', isDefault: true, status: 0 },
      { name: 'MS-PDF', displayName: 'MS-PDF', isDefault: false },
    ]);
  });

  it('flags the registry system default when the raw list omits isDefault', async () => {
    // Electron 44 returns only name/displayName/description/options.
    const contents = {
      getPrintersAsync: async () => [
        { name: 'Microsoft Print to PDF', displayName: 'Microsoft Print to PDF' },
        { name: 'Canon TS3100 series', displayName: 'Canon TS3100 series' },
      ],
    } as unknown as Parameters<typeof listPrinters>[0];

    const printers = await listPrinters(contents, {
      getSystemDefaultName: async () => 'Microsoft Print to PDF',
    });
    expect(printers.map((printer) => printer.isDefault)).toEqual([true, false]);
  });
});

// ---------------------------------------------------------------------------
// File > Print menu entry
// ---------------------------------------------------------------------------

describe('Phase 30: File > Print menu item', () => {
  beforeEach(() => {
    _buildFromTemplate.mockClear();
  });

  it('adds Print with CmdOrCtrl+P after Save As and before Close', () => {
    buildAppMenu({ sendToFocused: vi.fn(), sendPrintRequest: vi.fn() });

    const template = _buildFromTemplate.mock.calls[0][0] as Array<{
      label?: string;
      submenu?: Array<{ label?: string; accelerator?: string }>;
    }>;
    const file = template.find((item) => item.label === 'File');
    expect(file).toBeDefined();
    const labels = (file!.submenu ?? []).map((item) => item.label);
    const printIndex = labels.indexOf('Print...');
    expect(printIndex).toBeGreaterThan(labels.indexOf('Save As...'));
    expect(printIndex).toBeLessThan(labels.indexOf('Close Tab'));

    const printItem = file!.submenu!.find((item) => item.label === 'Print...');
    expect(printItem!.accelerator).toBe('CmdOrCtrl+P');
  });

  it('fires the print request on click, not a menu:action', () => {
    const send = vi.fn();
    const sendPrintRequest = vi.fn();
    buildAppMenu({ sendToFocused: send, sendPrintRequest });

    const template = _buildFromTemplate.mock.calls[0][0] as Array<{
      label?: string;
      submenu?: Array<{ label?: string; click?: () => void }>;
    }>;
    const file = template.find((item) => item.label === 'File');
    const printItem = file!.submenu!.find((item) => item.label === 'Print...');
    printItem!.click!();

    expect(sendPrintRequest).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });
});