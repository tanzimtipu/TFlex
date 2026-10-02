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
  isPdfBytes,
  isVirtualPdfPrinter,
  listPrinters,
  mapPrintSettings,
  mapPrintToPdfOptions,
  printJob,
  validatePrintPayload,
  type HiddenPrintWindow,
  type PrintJobDeps,
} from '../../../src/main/services/print';
import { buildAppMenu } from '../../../src/main/menu';
import { printSheetLayout } from '../../../src/shared/printLayout';
import { bookletSideOffset } from '../../../src/shared/printImposition';
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

  // Phase 83 — '' is an explicit blank slot, not an invalid image.
  it('accepts payloads whose images include blank slots', () => {
    expect(validatePrintPayload(payload([IMG, '', IMG]))).toEqual({ ok: true });
    expect(validatePrintPayload(payload(['', '']))).toEqual({ ok: true });
  });

  it('still rejects a non-empty invalid image next to a blank slot', () => {
    expect(validatePrintPayload(payload([IMG, '', 'not-a-data-url']))).toEqual({
      ok: false,
      reason: 'bad-image',
    });
  });

  it('accepts every valid Phase 83 imposition option', () => {
    expect(
      validatePrintPayload(
        payload([IMG], {
          layoutMode: 'booklet',
          bookletSubset: 'front',
          bookletGutterPt: 72,
          bookletCreepPt: 36,
          posterRows: 10,
          posterCols: 1,
          posterOverlapPt: 72,
          posterScalePercent: 500,
          posterCutMarks: true,
        }),
      ),
    ).toEqual({ ok: true });
  });

  it('rejects an unknown layoutMode with bad-layout-mode', () => {
    expect(
      validatePrintPayload(payload([IMG], { layoutMode: 'zigzag' as unknown as 'single' })),
    ).toEqual({ ok: false, reason: 'bad-layout-mode' });
  });

  it('rejects an invalid bookletSubset with bad-booklet-option', () => {
    expect(
      validatePrintPayload(payload([IMG], { bookletSubset: 'middle' as unknown as 'both' })),
    ).toEqual({ ok: false, reason: 'bad-booklet-option' });
  });

  it('rejects bookletGutterPt outside 0..72 / non-finite with bad-booklet-option', () => {
    for (const value of [-1, 73, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validatePrintPayload(payload([IMG], { bookletGutterPt: value }))).toEqual({
        ok: false,
        reason: 'bad-booklet-option',
      });
    }
  });

  it('rejects bookletCreepPt outside 0..36 with bad-booklet-option', () => {
    expect(validatePrintPayload(payload([IMG], { bookletCreepPt: -1 }))).toEqual({
      ok: false,
      reason: 'bad-booklet-option',
    });
    expect(validatePrintPayload(payload([IMG], { bookletCreepPt: 37 }))).toEqual({
      ok: false,
      reason: 'bad-booklet-option',
    });
  });

  it('rejects a non-integer / out-of-range poster grid with bad-poster-option', () => {
    for (const value of [0, 11, 2.5, Number.NaN]) {
      expect(validatePrintPayload(payload([IMG], { posterRows: value }))).toEqual({
        ok: false,
        reason: 'bad-poster-option',
      });
      expect(validatePrintPayload(payload([IMG], { posterCols: value }))).toEqual({
        ok: false,
        reason: 'bad-poster-option',
      });
    }
  });

  it('rejects posterOverlapPt outside 0..72 with bad-poster-option', () => {
    for (const value of [-1, 73, Number.NaN]) {
      expect(validatePrintPayload(payload([IMG], { posterOverlapPt: value }))).toEqual({
        ok: false,
        reason: 'bad-poster-option',
      });
    }
  });

  it('rejects posterScalePercent outside 10..500 with bad-poster-option', () => {
    for (const value of [9, 501, Number.NaN]) {
      expect(validatePrintPayload(payload([IMG], { posterScalePercent: value }))).toEqual({
        ok: false,
        reason: 'bad-poster-option',
      });
    }
  });

  it('rejects a non-boolean posterCutMarks with bad-poster-option', () => {
    expect(
      validatePrintPayload(payload([IMG], { posterCutMarks: 'yes' as unknown as boolean })),
    ).toEqual({ ok: false, reason: 'bad-poster-option' });
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

  it('swaps the sheet grid for the vertical order at 2-up (2x1 vs 1x2)', () => {
    const horizontal = composePrintHtml(payload([IMG, IMG], { pagesPerSheet: 2 }));
    expect(horizontal).toContain('grid-template-columns: repeat(2, 1fr)');
    expect(horizontal).toContain('grid-template-rows: repeat(1, 1fr)');

    const vertical = composePrintHtml(
      payload([IMG, IMG], { pagesPerSheet: 2, pageOrder: 'vertical' }),
    );
    expect(vertical).toContain('grid-template-columns: repeat(1, 1fr)');
    expect(vertical).toContain('grid-template-rows: repeat(2, 1fr)');
  });

  it('swaps the sheet grid for the vertical order at 6-up (3x2 vs 2x3)', () => {
    const horizontal = composePrintHtml(
      payload(Array(6).fill(IMG), { pagesPerSheet: 6 }),
    );
    expect(horizontal).toContain('grid-template-columns: repeat(3, 1fr)');
    expect(horizontal).toContain('grid-template-rows: repeat(2, 1fr)');

    const vertical = composePrintHtml(
      payload(Array(6).fill(IMG), { pagesPerSheet: 6, pageOrder: 'vertical' }),
    );
    expect(vertical).toContain('grid-template-columns: repeat(2, 1fr)');
    expect(vertical).toContain('grid-template-rows: repeat(3, 1fr)');
  });

  it('places the images in the page-order slots (2-up)', () => {
    const imgs = ['A', 'B'];
    // Horizontal: image 0 in cell 0, image 1 in cell 1.
    expect(orderOf(composePrintHtml(payload(imgs, { pagesPerSheet: 2 })))).toEqual(['A', 'B']);
    // Vertical 1x2: same visual reading order for two images.
    expect(
      orderOf(composePrintHtml(payload(imgs, { pagesPerSheet: 2, pageOrder: 'vertical' }))),
    ).toEqual(['A', 'B']);
    // Horizontal Reversed: this row is filled right to left -> [1, 0].
    expect(
      orderOf(
        composePrintHtml(payload(imgs, { pagesPerSheet: 2, pageOrder: 'horizontalReversed' })),
      ),
    ).toEqual(['B', 'A']);
  });

  it('places the images in the page-order slots (4-up, 2x2)', () => {
    const imgs = ['A', 'B', 'C', 'D'];
    expect(orderOf(composePrintHtml(payload(imgs, { pagesPerSheet: 4 })))).toEqual([
      'A', 'B', 'C', 'D',
    ]);
    expect(
      orderOf(composePrintHtml(payload(imgs, { pagesPerSheet: 4, pageOrder: 'vertical' }))),
    ).toEqual(['A', 'C', 'B', 'D']);
    expect(
      orderOf(
        composePrintHtml(payload(imgs, { pagesPerSheet: 4, pageOrder: 'horizontalReversed' })),
      ),
    ).toEqual(['B', 'A', 'D', 'C']);
    expect(
      orderOf(
        composePrintHtml(payload(imgs, { pagesPerSheet: 4, pageOrder: 'verticalReversed' })),
      ),
    ).toEqual(['B', 'D', 'A', 'C']);
  });

  it('keeps empty cells on a partially filled sheet without moving earlier images', () => {
    // 3 images at 4-up vertical: slots [0,2,1,3] -> A, C, B, then an empty cell.
    const html = composePrintHtml(
      payload(['A', 'B', 'C'], { pagesPerSheet: 4, pageOrder: 'vertical' }),
    );
    expect(orderOf(html)).toEqual(['A', 'C', 'B']);
    expect(html.split('<div class="page"></div>').length - 1).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 83: booklet / poster composition + single-path regression guard
// ---------------------------------------------------------------------------

/** The exact 1-up single output (scaling fit, portrait). A guard that Phase 83
 *  left the historical path byte-identical. */
const SINGLE_1UP_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Jovrel Print</title>
<style>
@page { size: portrait; margin: 0; }
html, body { margin: 0; padding: 0; }
.sheet { width: 100vw; height: 100vh; box-sizing: border-box; overflow: hidden; page-break-after: always; }
.sheet:last-child { page-break-after: auto; }
.page { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.page img { display: block; }
.page img { width: 100%; height: 100%; object-fit: contain; }

</style>
</head>
<body>
<div class="sheet"><div class="page"><img src="${IMG}" alt=""></div></div>
</body>
</html>`;

describe('Phase 83: composePrintHtml single regression guard', () => {
  it('keeps an absent layoutMode byte-identical to the explicit single output', () => {
    expect(composePrintHtml(payload([IMG]))).toBe(SINGLE_1UP_HTML);
    expect(composePrintHtml(payload([IMG], { layoutMode: 'single' }))).toBe(SINGLE_1UP_HTML);
  });
});

describe('Phase 83: composePrintHtml booklet', () => {
  // N=8 saddle-stitch order with '#2' replaced by a blank slot.
  const BOOKLET_IMAGES = ['#8', '#1', '', '#7', '#6', '#3', '#4', '#5'];
  const BOOKLET_SETTINGS: PrintSettings = {
    layoutMode: 'booklet',
    pagesPerSheet: 2,
    bookletGutterPt: 10,
    bookletCreepPt: 6,
  };

  it('pairs the saddle-stitch order into 4 landscape sheets with the blank cell', () => {
    const html = composePrintHtml(payload(BOOKLET_IMAGES, BOOKLET_SETTINGS));
    // 8 slots / 2-up = 4 sheets, ignoring the passed pagesPerSheet value.
    expect(count(html, '<div class="sheet">')).toBe(4);
    // The blank slot renders an empty, padded page cell (and no <img>).
    expect(html).toContain('<div class="page" style="padding-left:5pt; padding-right:5pt;"></div>');
    expect(count(html, '<img ')).toBe(7);
    expect(orderOf(html)).toEqual(['#8', '#1', '#7', '#6', '#3', '#4', '#5']);
    // Booklet forces landscape regardless of the settings flag.
    expect(html).toContain('@page { size: landscape;');
    // 2-up grid from the shared printSheetLayout rule.
    expect(html).toContain('grid-template-columns: repeat(2, 1fr)');
    expect(html).toContain('grid-template-rows: repeat(1, 1fr)');
  });

  it('applies the shared bookletSideOffset by physical sheet for the both subset', () => {
    const html = composePrintHtml(payload(BOOKLET_IMAGES, BOOKLET_SETTINGS));
    // 8 sides = 4 physical sheets; the default subset is 'both', so the two
    // sides 2k / 2k+1 share physical sheet k's offset. With only 2 physical
    // sheets there is no creep distance, so every margin is gutter / 2.
    const offsets = Array.from({ length: 4 }, (_v, i) =>
      bookletSideOffset(Math.floor(i / 2), 2, 10, 6),
    );
    expect(offsets.map((offset) => offset.leftPt)).toEqual([5, 5, 5, 5]);
    for (const offset of offsets) {
      expect(offset.leftPt).toBe(offset.rightPt);
      expect(html).toContain(`padding-left:${offset.leftPt}pt; padding-right:${offset.rightPt}pt;`);
    }
  });

  // ADV-158 / DEF-484 — subset `both` must offset by PHYSICAL sheet, exactly
  // as the renderer `bookletSides` preview does.
  it('matches the renderer preview creep for subset both', () => {
    const images = Array.from({ length: 16 }, (_v, i) => `#${i + 1}`);
    const html = composePrintHtml(
      payload(images, {
        layoutMode: 'booklet',
        pagesPerSheet: 2,
        bookletSubset: 'both',
        bookletGutterPt: 0,
        bookletCreepPt: 10,
      }),
    );
    const perCell = [...html.matchAll(/padding-left:([0-9.]+)pt/g)].map((m) => Number(m[1]));
    // 16 cells = 8 sides; both cells of a side share the margin.
    const perSide = perCell.filter((_v, i) => i % 2 === 0);
    expect(perSide).toEqual([0, 0, 10, 10, 10, 10, 0, 0]);
  });

  // The front/back subsets carry one side per physical sheet, so their offset
  // is already physical-sheet based (the adversary's creep-front/creep-back).
  it('keeps front/back creep on the physical-sheet offset', () => {
    const images = Array.from({ length: 8 }, (_v, i) => `#${i + 1}`);
    for (const subset of ['front', 'back'] as const) {
      const html = composePrintHtml(
        payload(images, {
          layoutMode: 'booklet',
          pagesPerSheet: 2,
          bookletSubset: subset,
          bookletGutterPt: 0,
          bookletCreepPt: 10,
        }),
      );
      const perCell = [...html.matchAll(/padding-left:([0-9.]+)pt/g)].map((m) => Number(m[1]));
      const perSide = perCell.filter((_v, i) => i % 2 === 0);
      expect(perSide).toEqual([0, 10, 10, 0]);
    }
  });

  // ADV-159 / DEF-485 — booklet is a fixed horizontal 2-up; a stale pageOrder
  // from a Single/N-up surface must not rotate or mirror the imposition.
  it('ignores a stale pageOrder and stays a fixed 2-column 2-up', () => {
    for (const pageOrder of ['vertical', 'verticalReversed', 'horizontalReversed'] as const) {
      const html = composePrintHtml(
        payload(['A', 'B'], { layoutMode: 'booklet', pagesPerSheet: 2, pageOrder }),
      );
      expect(html).toContain('grid-template-columns: repeat(2, 1fr)');
      expect(html).toContain('grid-template-rows: repeat(1, 1fr)');
      expect(html).not.toContain('grid-template-columns: repeat(1, 1fr)');
      expect(orderOf(html)).toEqual(['A', 'B']);
    }
  });

  it('adds no padding and no marks when gutter/creep are omitted', () => {
    const html = composePrintHtml(
      payload(BOOKLET_IMAGES, { layoutMode: 'booklet', pagesPerSheet: 2 }),
    );
    expect(html).toContain('padding-left:0pt; padding-right:0pt;');
    expect(html).not.toContain('cut-mark');
  });
});

describe('Phase 83: composePrintHtml poster', () => {
  const TILES = ['tile0', 'tile1', 'tile2', 'tile3'];

  it('emits one sheet per tile and no tile grid', () => {
    const html = composePrintHtml(payload(TILES, { layoutMode: 'poster' }));
    expect(count(html, '<div class="sheet')).toBe(4);
    expect(orderOf(html)).toEqual(TILES);
  });

  it('adds cut marks and the poster-cut-marks class iff posterCutMarks is true', () => {
    const on = composePrintHtml(payload(TILES, { layoutMode: 'poster', posterCutMarks: true }));
    const off = composePrintHtml(payload(TILES, { layoutMode: 'poster', posterCutMarks: false }));
    expect(count(on, 'class="sheet')).toBe(4);
    expect(on).toContain('poster-cut-marks');
    // Four corner marks on each of the four tile sheets.
    expect(count(on, 'class="cut-mark')).toBe(16);
    expect(on).toContain('.cut-mark {');
    expect(off).not.toContain('cut-mark');
  });

  it('forces 1-up even when pagesPerSheet is passed', () => {
    const html = composePrintHtml(
      payload(TILES, { layoutMode: 'poster', pagesPerSheet: 4 }),
    );
    expect(count(html, '<div class="sheet')).toBe(4);
    expect(html).not.toContain('grid-template-columns');
  });
});

// ADV-160 / DEF-486 — '' is a blank slot in EVERY mode, not only booklet/poster.
describe('Phase 83: composePrintHtml blank slots outside booklet/poster', () => {
  it('renders an empty .page and no <img src=""> for a single blank slot', () => {
    const html = composePrintHtml(payload(['', IMG]));
    expect(html).toContain('<div class="page"></div>');
    expect(html).not.toContain('<img src=""');
    expect(count(html, '<img ')).toBe(1);
  });

  it('renders an empty cell for a blank slot in an N-up sheet', () => {
    const html = composePrintHtml(payload(['', IMG], { pagesPerSheet: 4 }));
    expect(html).toContain('<div class="page"></div>');
    expect(html).not.toContain('<img src=""');
    expect(count(html, '<img ')).toBe(1);
  });
});

/** Extract per-cell images in DOM order; empty cells are omitted. */
function orderOf(html: string): string[] {
  return [...html.matchAll(/<img src="([^"]*)"/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// printJob orchestration (with an injected fake hidden window)
// ---------------------------------------------------------------------------

interface FakeDeps {
  deps: PrintJobDeps;
  createWindow: ReturnType<typeof vi.fn>;
  printOptions: () => unknown;
  /** Phase 35 — captured `printToPDF` options (virtual-PDF path). */
  pdfOptions: () => unknown;
  /** Phase 35 — the composed HTML the hidden window was asked to mount. */
  mountedHtml: () => string;
  /** Phase 35 — (path, bytes) pairs written by the virtual-PDF path. */
  written: () => Array<{ path: string; bytes: Uint8Array }>;
  destroyed: () => boolean;
  destroyCount: () => number;
}

interface FakeOptions {
  neverCallback?: boolean;
  timeoutMs?: number;
  /** Phase 35 — destination the injected Save-As picker returns. */
  savePath?: string | null;
  /** Phase 35 — bytes `printToPDF` resolves with (default a valid `%PDF-`). */
  pdf?: Buffer | Error;
  /** Phase 35 — a `printToPDF` that never settles (tests the 120 s bound). */
  neverPdf?: boolean;
  /** Phase 35 — make the injected write seam reject. */
  writeError?: Error;
}

function fakeDeps(
  result: { success: boolean; failureReason?: string },
  options: FakeOptions = {},
): FakeDeps {
  const listeners: Array<() => void> = [];
  let destroyed = false;
  let destroyCalls = 0;
  let capturedPrint: unknown = null;
  let capturedPdf: unknown = null;
  let mounted = '';
  const written: Array<{ path: string; bytes: Uint8Array }> = [];
  const createWindow = vi.fn(
    (): HiddenPrintWindow => ({
      webContents: {
        once: (_event, listener) => {
          listeners.push(listener);
        },
        print: (printOptions, callback) => {
          capturedPrint = printOptions;
          if (options.neverCallback === true) return; // DEF-269: driver never calls back
          callback(result.success, result.failureReason ?? '');
        },
        printToPDF: (pdfOptions) => {
          capturedPdf = pdfOptions;
          if (options.neverPdf === true) return new Promise<Buffer>(() => undefined);
          if (options.pdf instanceof Error) return Promise.reject(options.pdf);
          return Promise.resolve(options.pdf ?? Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x0a]));
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
    loadHtml: async (_win, html) => {
      mounted = html;
      for (const listener of listeners) listener();
    },
    writePdfFile: async (path, bytes) => {
      if (options.writeError !== undefined) throw options.writeError;
      written.push({ path, bytes });
    },
  };
  if (options.timeoutMs !== undefined) deps.timeoutMs = options.timeoutMs;
  if ('savePath' in options) {
    deps.chooseSavePath = async () => options.savePath ?? null;
  }
  return {
    deps,
    createWindow,
    printOptions: () => capturedPrint,
    pdfOptions: () => capturedPdf,
    mountedHtml: () => mounted,
    written: () => written,
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
    expect(result).toEqual({ ok: true, outcome: 'printed' });
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
        webContents: {
          once: () => undefined,
          print: () => undefined,
          printToPDF: () => Promise.resolve(Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d])),
        },
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
// Phase 35: virtual-PDF output produced inside TFlex
// ---------------------------------------------------------------------------

const PDF_DEVICE = 'Microsoft Print to PDF';
const SAVE_PATH = 'C:/Users/test/Documents/out.pdf';

describe('Phase 35: mapPrintToPdfOptions', () => {
  it('copies the direct-print mapping and honours the CSS page size', () => {
    const options = mapPrintToPdfOptions({
      deviceName: PDF_DEVICE,
      landscape: true,
      scaling: 'custom',
      scalePercent: 150,
    });
    expect(options).toEqual({
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      scale: 1.5,
    });
  });

  it('omits scale / pageRanges when absent', () => {
    const options = mapPrintToPdfOptions({ deviceName: PDF_DEVICE });
    expect('scale' in options).toBe(false);
    expect('pageRanges' in options).toBe(false);
    expect(options.landscape).toBe(false);
  });

  it('converts 0-based print pageRanges to the 1-based printToPDF string', () => {
    expect(mapPrintToPdfOptions({ pageRanges: [{ from: 0, to: 2 }] }).pageRanges).toBe('1-3');
    expect(mapPrintToPdfOptions({ pageRanges: [{ from: 4, to: 4 }] }).pageRanges).toBe('5');
    expect(
      mapPrintToPdfOptions({ pageRanges: [{ from: 0, to: 1 }, { from: 4, to: 4 }] }).pageRanges,
    ).toBe('1-2,5');
  });
});

describe('Phase 35: isPdfBytes', () => {
  it('accepts a %PDF- header and rejects everything else', () => {
    expect(isPdfBytes(Buffer.from('%PDF-1.7\n'))).toBe(true);
    expect(isPdfBytes(Buffer.from('not a pdf'))).toBe(false);
    expect(isPdfBytes(Buffer.alloc(0))).toBe(false);
    expect(isPdfBytes(Buffer.from('%PD'))).toBe(false);
  });
});

describe('Phase 35: printJob virtual-PDF path', () => {
  it('produces PDF bytes and writes them to the chosen path', async () => {
    const fake = fakeDeps(
      { success: true },
      { savePath: SAVE_PATH, pdf: Buffer.from('%PDF-1.7 bytes') },
    );
    const result = await printJob(payload([IMG], { deviceName: PDF_DEVICE }), fake.deps);
    expect(result).toEqual({ ok: true, outcome: 'saved', path: SAVE_PATH });
    expect(fake.written()).toHaveLength(1);
    expect(fake.written()[0].path).toBe(SAVE_PATH);
    expect(Buffer.from(fake.written()[0].bytes).toString()).toBe('%PDF-1.7 bytes');
    // No driver print call is made on the virtual path.
    expect(fake.printOptions()).toBeNull();
    expect(fake.destroyed()).toBe(true);
    expect(fake.destroyCount()).toBe(1);
  });

  it('treats a dismissed save dialog as a quiet cancel with no window and no write', async () => {
    const fake = fakeDeps({ success: true }, { savePath: null, pdf: Buffer.from('%PDF-1.7') });
    const result = await printJob(payload([IMG], { deviceName: PDF_DEVICE }), fake.deps);
    expect(result).toEqual({ ok: false, reason: 'save-cancelled' });
    expect(fake.createWindow).not.toHaveBeenCalled();
    expect(fake.written()).toHaveLength(0);
  });

  it('mounts the SAME composed document and maps landscape + page range (parity)', async () => {
    const images = [IMG, IMG, IMG];
    const settings: PrintSettings = {
      deviceName: PDF_DEVICE,
      pagesPerSheet: 2,
      pageOrder: 'horizontal',
      landscape: true,
      // 0-based {from,to} -> 1-based "1-3" for printToPDF.
      pageRanges: [{ from: 0, to: 2 }],
    };
    const fake = fakeDeps({ success: true }, { savePath: SAVE_PATH, pdf: Buffer.from('%PDF-1.7') });
    const result = await printJob(payload(images, settings), fake.deps);
    expect(result.ok).toBe(true);

    // The mounted document is byte-identical to the direct-print composition.
    expect(fake.mountedHtml()).toBe(composePrintHtml(payload(images, settings)));

    // Page count follows the composition: 3 images at 2-up is 2 sheets, and
    // the grid comes straight from the SHARED printSheetLayout rule.
    const layout = printSheetLayout(2, 'horizontal');
    expect(fake.mountedHtml().split('class="sheet"').length - 1).toBe(Math.ceil(images.length / 2));
    expect(fake.mountedHtml()).toContain(`grid-template-columns: repeat(${layout.cols}, 1fr)`);
    expect(fake.mountedHtml()).toContain(`grid-template-rows: repeat(${layout.rows}, 1fr)`);

    expect(fake.pdfOptions()).toMatchObject({
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      pageRanges: '1-3',
    });
  });

  it('maps a vertical 2-up order to the shared 1x2 grid (parity)', async () => {
    const images = [IMG, IMG];
    const settings: PrintSettings = {
      deviceName: PDF_DEVICE,
      pagesPerSheet: 2,
      pageOrder: 'vertical',
    };
    const fake = fakeDeps({ success: true }, { savePath: SAVE_PATH, pdf: Buffer.from('%PDF-1.7') });
    await printJob(payload(images, settings), fake.deps);
    const layout = printSheetLayout(2, 'vertical');
    expect(layout).toEqual({ cols: 1, rows: 2, slots: [0, 1] });
    expect(fake.mountedHtml()).toContain('grid-template-columns: repeat(1, 1fr)');
    expect(fake.mountedHtml()).toContain('grid-template-rows: repeat(2, 1fr)');
  });

  it('fails loud with print-to-pdf-failed when printToPDF rejects', async () => {
    const fake = fakeDeps({ success: true }, { savePath: SAVE_PATH, pdf: new Error('boom') });
    const result = await printJob(payload([IMG], { deviceName: PDF_DEVICE }), fake.deps);
    expect(result).toEqual({ ok: false, reason: 'print-to-pdf-failed' });
    expect(fake.written()).toHaveLength(0);
    expect(fake.destroyCount()).toBe(1);
  });

  it('fails loud when printToPDF returns non-PDF bytes', async () => {
    const fake = fakeDeps({ success: true }, { savePath: SAVE_PATH, pdf: Buffer.from('garbage') });
    const result = await printJob(payload([IMG], { deviceName: PDF_DEVICE }), fake.deps);
    expect(result).toEqual({ ok: false, reason: 'print-to-pdf-failed' });
    expect(fake.written()).toHaveLength(0);
  });

  it('fails loud with save-write-failed when the write throws', async () => {
    const fake = fakeDeps(
      { success: true },
      { savePath: SAVE_PATH, pdf: Buffer.from('%PDF-1.7'), writeError: new Error('disk full') },
    );
    const result = await printJob(payload([IMG], { deviceName: PDF_DEVICE }), fake.deps);
    expect(result).toEqual({ ok: false, reason: 'save-write-failed' });
    expect(fake.destroyCount()).toBe(1);
  });

  it('bounds a stalled printToPDF with print-timeout and destroys once', async () => {
    const fake = fakeDeps(
      { success: true },
      { savePath: SAVE_PATH, neverPdf: true, timeoutMs: 10 },
    );
    const result = await printJob(payload([IMG], { deviceName: PDF_DEVICE }), fake.deps);
    expect(result).toEqual({ ok: false, reason: 'print-timeout' });
    expect(fake.destroyCount()).toBe(1);
  });

  it('keeps a real printer on the silent webContents.print path (unchanged)', async () => {
    const fake = fakeDeps(
      { success: true },
      { savePath: SAVE_PATH, pdf: Buffer.from('%PDF-1.7') },
    );
    const result = await printJob(
      payload([IMG], { deviceName: 'HP LaserJet Pro M404', copies: 2 }),
      fake.deps,
    );
    expect(result).toEqual({ ok: true, outcome: 'printed' });
    expect(fake.printOptions()).toMatchObject({
      silent: true,
      printBackground: true,
      deviceName: 'HP LaserJet Pro M404',
      copies: 2,
    });
    expect(fake.written()).toHaveLength(0);
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