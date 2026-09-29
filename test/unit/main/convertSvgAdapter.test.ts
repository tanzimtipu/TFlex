import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, type PDFPage } from '@cantoo/pdf-lib';
import { isPdfBytes } from '../../../src/main/services/print';
import { ok } from '../../../src/shared/result';
import type { ConvertOptions } from '../../../src/shared/convert';
import type {
  HtmlPrintFn,
  HtmlPrintOptions,
} from '../../../src/main/services/convert/html-print';
import {
  createSvgAdapter,
  computeSvgRootMatrix,
} from '../../../src/main/services/convert/adapters/svg';
import { resolveConvertOptions } from '../../../src/main/services/convert/limits';
import { readSniffHead, createDefaultRegistry } from '../../../src/main/services/convert/registry';
import {
  applyPaintOps,
  generatePaintOps,
  type PathOp,
} from '../../../src/main/services/convert/svg/svg-paint';
import { parseSvg } from '../../../src/main/services/convert/svg/svg-parse';

/**
 * Phase 54 feature C — the `.svg` adapter. The static subset converts natively;
 * a fallback fixture uses an INJECTED print function (no Chromium is started).
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-svg-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function mkSvg(name: string, source: string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, source, 'utf8');
  return path;
}

async function runAdapter(
  adapter: ReturnType<typeof createSvgAdapter>,
  path: string,
  options: ConvertOptions = {},
) {
  const head = await readSniffHead(path);
  return adapter.convert({ path, options: resolveConvertOptions(options), head });
}

async function onePagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage();
  return doc.save();
}

/** A fixture that exercises the whole static subset and nothing else. */
const STATIC_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120" viewBox="0 0 200 120">' +
  '<g transform="translate(5,5)">' +
  '<path d="M0 0 L40 0 C 50 10 60 10 70 0 Z" fill="#ff0000" stroke="#000000" stroke-width="2"/>' +
  '<path d="M0 20 Q 20 40 40 20" fill="none" stroke="blue"/>' +
  '<rect x="80" y="0" width="20" height="10" rx="2" fill="green"/>' +
  '<circle cx="120" cy="10" r="8" fill="#123456" opacity="0.5"/>' +
  '<ellipse cx="150" cy="10" rx="10" ry="5" fill="none" stroke="#888"/>' +
  '<line x1="0" y1="40" x2="40" y2="40" stroke="black" stroke-width="1"/>' +
  '<polyline points="0,50 10,60 20,50" fill="none" stroke="red"/>' +
  '<polygon points="30,50 40,60 50,50" fill="navy"/>' +
  '</g></svg>';

describe('phase54 svg adapter: native static subset (criterion 4a)', () => {
  it('translates the static subset with no untranslated constructs', async () => {
    const path = await mkSvg('static.svg', STATIC_SVG);
    const paint = generatePaintOps(parseSvg(STATIC_SVG));
    expect(paint.untranslated).toEqual([]);

    const adapter = createSvgAdapter();
    const out = await runAdapter(adapter, path);
    expect(out.fidelity).toBe('native');
    expect(out.pageCount).toBe(1);
    expect(isPdfBytes(out.bytes)).toBe(true);
    expect(out.warnings.some((w) => w.code === 'engine-rendered')).toBe(false);
  });

  it('is one page from a real re-parse and carries the svg source format', async () => {
    const path = await mkSvg('static2.svg', STATIC_SVG);
    const out = await runAdapter(createSvgAdapter(), path);
    const reparsed = await PDFDocument.load(out.bytes);
    expect(reparsed.getPageCount()).toBe(1);
    expect(out.sourceFormat).toBe('svg');
  });
});

describe('phase54 svg adapter: engine fallback (criterion 4b)', () => {
  const fallbackSvg =
    '<svg width="200" height="200"><defs><filter id="f"></filter><mask id="m"></mask></defs>' +
    '<rect width="100" height="100" filter="url(#f)" mask="url(#m)"/></svg>';

  it('names exactly filter and mask, warns once, and calls the engine', async () => {
    const bytes = await onePagePdf();
    const print = vi.fn(async () =>
      ok({ bytes, pageCount: 1, blockedUrls: [] }),
    );
    const path = await mkSvg('fallback.svg', fallbackSvg);

    const paint = generatePaintOps(parseSvg(fallbackSvg));
    expect(paint.untranslated).toEqual(['filter', 'mask']);

    const out = await runAdapter(createSvgAdapter(print), path);
    expect(print).toHaveBeenCalledTimes(1);
    expect(out.fidelity).toBe('layout');
    const warnings = out.warnings.filter((w) => w.code === 'engine-rendered');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('filter');
    expect(warnings[0].message).toContain('mask');
    expect(out.bytes).toBe(bytes);
  });

  it('reports text through the engine and names it', async () => {
    const bytes = await onePagePdf();
    const print = vi.fn(async () => ok({ bytes, pageCount: 1, blockedUrls: [] }));
    const path = await mkSvg('text.svg', '<svg width="100" height="100"><text x="10" y="20">Hi</text></svg>');
    const out = await runAdapter(createSvgAdapter(print), path);
    expect(out.fidelity).toBe('layout');
    const warning = out.warnings.find((w) => w.code === 'engine-rendered');
    expect(warning?.message).toContain('text');
    expect(print).toHaveBeenCalledTimes(1);
  });
});

describe('phase54 svg adapter: engine-fallback page size (item 0)', () => {
  // A 300x150pt SVG that must fall back (a filter is not translated natively).
  const ptSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="300pt" height="150pt" viewBox="0 0 300 150">' +
    '<defs><filter id="f"></filter></defs>' +
    '<rect width="120" height="80" filter="url(#f)"/></svg>';

  it('composes an @page rule from the intrinsic size and opts into it', async () => {
    const bytes = await onePagePdf();
    const seen: Array<{ html: string; options: HtmlPrintOptions }> = [];
    const print: HtmlPrintFn = async (html, options) => {
      seen.push({ html, options });
      return ok({ bytes, pageCount: 1, blockedUrls: [] });
    };
    const path = await mkSvg('pt.svg', ptSvg);
    const out = await runAdapter(createSvgAdapter(print), path);

    expect(out.fidelity).toBe('layout');
    expect(seen).toHaveLength(1);
    expect(seen[0].html).toContain('@page { size: 300pt 150pt; margin: 0; }');
    // The fallback page is now the SVG's own size, not the A4 Settings paper.
    expect(seen[0].options.preferCSSPageSize).toBe(true);
    expect(seen[0].options.marginMm).toBe(0);
  });

  it('keeps the Settings paper size (and no @page opt-in) in fixed mode', async () => {
    const bytes = await onePagePdf();
    const seen: Array<{ html: string; options: HtmlPrintOptions }> = [];
    const print: HtmlPrintFn = async (html, options) => {
      seen.push({ html, options });
      return ok({ bytes, pageCount: 1, blockedUrls: [] });
    };
    const path = await mkSvg('pt-fixed.svg', ptSvg);
    await runAdapter(createSvgAdapter(print), path, {
      imagePageSizeMode: 'fixed',
      imageFixedPageSize: 'letter',
    });
    expect(seen[0].options.pageSize).toBe('letter');
    expect(seen[0].options.preferCSSPageSize).toBe(false);
    expect(seen[0].html).not.toContain('@page');
  });
});

describe('phase54 svg adapter: gradients (approximated natively)', () => {
  const gradientSvg =
    '<svg width="100" height="100"><defs><linearGradient id="g">' +
    '<stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/>' +
    '</linearGradient></defs><rect width="100" height="100" fill="url(#g)"/></svg>';

  it('warns gradient-approx and still translates natively', async () => {
    const paint = generatePaintOps(parseSvg(gradientSvg));
    expect(paint.gradientCount).toBe(1);
    expect(paint.untranslated).toEqual([]);

    const path = await mkSvg('grad.svg', gradientSvg);
    const out = await runAdapter(createSvgAdapter(), path);
    expect(out.fidelity).toBe('native');
    expect(out.warnings.filter((w) => w.code === 'gradient-approx')).toHaveLength(1);
    expect(out.warnings.some((w) => w.code === 'engine-rendered')).toBe(false);
  });
});

describe('phase54 svg adapter: paint op details', () => {
  it('passes the untouched path d through applyPaintOps', () => {
    const d = 'M10 10 C 20 20, 40 20, 50 10 S 70 0 80 10 Q 90 20 100 10 T 110 10 A 5 5 0 1 0 115 15 l 5 5 z';
    const ops = generatePaintOps(
      parseSvg(`<svg width="200" height="200"><path d="${d}" fill="none" stroke="black"/></svg>`),
    ).ops;
    const calls: Array<{ d: string }> = [];
    const page = {
      drawSvgPath: (path: string) => calls.push({ d: path }),
    } as unknown as PDFPage;
    applyPaintOps(page, ops, computeSvgRootMatrix(null, 150, 150, resolveConvertOptions({})));
    expect(calls).toHaveLength(1);
    expect(calls[0].d).toBe(d);
  });

  it('produces no fill for fill:none and no stroke for an absent stroke', () => {
    const ops = generatePaintOps(
      parseSvg('<svg width="10" height="10"><path d="M0 0 L1 1" fill="none"/></svg>'),
    ).ops;
    expect((ops[0] as PathOp).fill).toBeNull();
    expect((ops[0] as PathOp).stroke).toBeNull();
  });

  it('defaults a missing stroke-width to 1, not 0', () => {
    const ops = generatePaintOps(
      parseSvg('<svg width="10" height="10"><path d="M0 0 L1 1" fill="none" stroke="red"/></svg>'),
    ).ops;
    expect((ops[0] as PathOp).stroke).toBe('#ff0000');
    expect((ops[0] as PathOp).strokeWidth).toBe(1);
  });
});

describe('phase54 svg adapter: sizing and errors', () => {
  it('sizes a unitless SVG at CSS px (96 DPI) in image mode', async () => {
    const path = await mkSvg('size.svg', '<svg width="96" height="48"><rect width="96" height="48"/></svg>');
    const out = await runAdapter(createSvgAdapter(), path);
    const doc = await PDFDocument.load(out.bytes);
    const size = doc.getPage(0).getSize();
    expect(size.width).toBeCloseTo(72, 4);
    expect(size.height).toBeCloseTo(36, 4);
  });

  it('errors with decode-failed when there is no size and no viewBox', async () => {
    const path = await mkSvg('nosize.svg', '<svg><rect width="10" height="10"/></svg>');
    const adapter = createSvgAdapter();
    await expect(runAdapter(adapter, path)).rejects.toMatchObject({
      code: 'decode-failed',
    });
    try {
      await runAdapter(adapter, path);
    } catch (error) {
      expect((error as Error).message.length).toBeGreaterThan(0);
    }
  });
});

describe('phase54 svg hostile specimens (adversary adv-p54, DEF-384/DEF-387)', () => {
  const advPath = (name: string): string => resolve('test-fixtures/adv-p54', name);

  async function runWithPrint(path: string, print: HtmlPrintFn) {
    const head = await readSniffHead(path);
    return createSvgAdapter(print).convert({
      path,
      options: resolveConvertOptions({}),
      head,
    });
  }

  it('DEF-384: a truncated SVG warns partial-content naming the unclosed element', async () => {
    const out = await runAdapter(createSvgAdapter(), advPath('svg-truncated-25.svg'));
    expect(out.fidelity).toBe('native');
    const warning = out.warnings.find((w) => w.code === 'partial-content');
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('malformed or truncated');
    expect(warning?.message).toContain('Unclosed');
  });

  it('DEF-384: an all-NaN SVG takes the engine fallback instead of a blank native page', async () => {
    const bytes = await onePagePdf();
    const print = vi.fn(async () => ok({ bytes, pageCount: 1, blockedUrls: [] }));
    const out = await runWithPrint(advPath('svg-numeric-hostile2.svg'), print);
    expect(print).toHaveBeenCalledTimes(1);
    expect(out.fidelity).toBe('layout');
    const engine = out.warnings.find((w) => w.code === 'engine-rendered');
    expect(engine?.message).toContain('none of their numeric geometry');
    const dropped = out.warnings.find(
      (w) => w.code === 'partial-content' && w.message.includes('invalid'),
    );
    expect(dropped?.message).toContain('2 shape(s)');
  });

  it('DEF-387: a remote-resource SVG surfaces resource-blocked warnings naming each URL', async () => {
    const bytes = await onePagePdf();
    const print = vi.fn(async () => ok({ bytes, pageCount: 1, blockedUrls: [] }));
    const out = await runWithPrint(advPath('svg-remote.svg'), print);
    const blocked = out.warnings.filter((w) => w.code === 'resource-blocked');
    expect(blocked.map((w) => w.message)).toEqual([
      'Blocked network resource: https://example.invalid/track.png',
      'Blocked network resource: http://example.invalid/x.png',
    ]);
  });

  it('DEF-387: remote @import and url(...) references in SVG styles are reported', async () => {
    const bytes = await onePagePdf();
    const print = vi.fn(async () => ok({ bytes, pageCount: 1, blockedUrls: [] }));
    const out = await runWithPrint(advPath('svg-remote-styles.svg'), print);
    const blocked = out.warnings.filter((w) => w.code === 'resource-blocked');
    expect(blocked).toHaveLength(2);
    expect(blocked.every((w) => w.detail === '2 network resource(s) blocked')).toBe(true);
    const messages = blocked.map((w) => w.message).join(' ');
    expect(messages).toContain('https://example.invalid/evil.css');
    expect(messages).toContain('https://example.invalid/bg.png');
  });
});

describe('phase54 svg registry routing', () => {
  it('routes a .svg by content and by extension', async () => {
    const path = await mkSvg('route.svg', STATIC_SVG);
    const head = await readSniffHead(path);
    const resolved = await createDefaultRegistry().resolve(path, head);
    expect(resolved?.adapter.id).toBe('svg');
  });

  it('does not capture a mislabelled raster named .svg', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const path = join(dir, 'fake.svg');
    await writeFile(path, png);
    const head = await readSniffHead(path);
    expect(createSvgAdapter().sniff(path, head)).toBe(false);
  });
});
