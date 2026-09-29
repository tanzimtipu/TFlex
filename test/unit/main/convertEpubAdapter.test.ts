import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { ok } from '../../../src/shared/result';
import type { ConvertResult } from '../../../src/shared/convert';
import { isPdfBytes } from '../../../src/main/services/print';
import { ConvertFailure } from '../../../src/main/services/convert/errors';
import { openZip } from '../../../src/main/services/convert/convert-zip';
import {
  chapterFragment,
  inlineEpubImages,
  parseEpub,
  resolveEpubHref,
} from '../../../src/main/services/convert/epub-parse';
import {
  composeEpubBody,
  createEpubAdapter,
  looksLikeEpub,
  type HtmlPrintFn,
} from '../../../src/main/services/convert/adapters/epub';
import {
  createDefaultRegistry,
  readSniffHead,
} from '../../../src/main/services/convert/registry';
import { resolveConvertOptions, CONVERT_LIMITS } from '../../../src/main/services/convert/limits';
import { DocumentConversionService } from '../../../src/main/services/convert';

/**
 * Phase 56 feature A — the pure EPUB parser and the `.epub` adapter, driven by
 * a REAL EPUB built in-test with fflate. The print engine is injected, so no
 * Electron is needed.
 */

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => 'C:/tmp') },
  session: {
    fromPartition: vi.fn(() => ({
      webRequest: { onBeforeRequest: vi.fn() },
      setPermissionRequestHandler: vi.fn(),
    })),
    defaultSession: {},
  },
  BrowserWindow: class {},
}));

const CONTAINER_XML = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>`;

const OPF_XML = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>Test Book</dc:title>
<meta name="cover" content="cover-img"/>
</metadata>
<manifest>
<item id="ch1" href="text/b.xhtml" media-type="application/xhtml+xml"/>
<item id="ch2" href="text/a.xhtml" media-type="application/xhtml+xml"/>
<item id="cover-img" href="images/cover.png" media-type="image/png" properties="cover-image"/>
<item id="pic" href="images/pic.png" media-type="image/png"/>
</manifest>
<spine>
<itemref idref="ch1"/>
<itemref idref="ch2"/>
</spine>
</package>`;

/** The cover-only OPF: no `cover-image` property, so the EPUB2 metadata
 *  fallback has to find the cover. */
const OPF_META_COVER = OPF_XML.replace(
  ' properties="cover-image"',
  '',
);

/** A spine entry pointing at a manifest item that does not exist. */
const OPF_MISSING_SPINE_ITEM = OPF_XML.replace('idref="ch2"', 'idref="ghost"');

/** A non-XHTML (SVG) spine item: genuinely unrenderable, so it is skipped. */
const OPF_NON_XHTML_SPINE = OPF_XML.replace(
  'idref="ch2"',
  'idref="plate"',
).replace(
  '<item id="pic" href="images/pic.png" media-type="image/png"/>',
  '<item id="pic" href="images/pic.png" media-type="image/png"/><item id="plate" href="images/plate.svg" media-type="image/svg+xml"/>',
);

const CH_ONE_XHTML = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter One</title></head>
<body>
<h1>Chapter One</h1>
<p>First chapter content</p>
<img src="../images/pic.png" alt=""/>
</body>
</html>`;

const CH_TWO_XHTML = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter Two</title></head>
<body><h1>Chapter Two</h1><p>Second chapter content</p></body>
</html>`;

const PNG_COVER = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
    '0000000d4944415478da63f8cfc0f01f0005000100ffa6b1a60000000049454e44ae426082',
  'hex',
);
const PNG_PIC = Buffer.concat([PNG_COVER, Buffer.from([0])]);
const COVER_DATA = `data:image/png;base64,${PNG_COVER.toString('base64')}`;
const PIC_DATA = `data:image/png;base64,${PNG_PIC.toString('base64')}`;

function buildEpubWithOpf(opf: string): Uint8Array {
  return zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(CONTAINER_XML),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/text/b.xhtml': strToU8(CH_ONE_XHTML),
    'OEBPS/text/a.xhtml': strToU8(CH_TWO_XHTML),
    'OEBPS/images/cover.png': new Uint8Array(PNG_COVER),
    'OEBPS/images/pic.png': new Uint8Array(PNG_PIC),
  });
}

function buildEpub(): Uint8Array {
  return buildEpubWithOpf(OPF_XML);
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-epub-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function mkFile(name: string, bytes: Uint8Array | string): Promise<string> {
  const path = join(dir, name);
  await writeFile(path, bytes);
  return path;
}

interface PrintSpy {
  fn: HtmlPrintFn;
  htmls: string[];
  calls: number;
}

function fakePrint(blockedUrls: string[] = []): PrintSpy {
  const spy: PrintSpy = {
    htmls: [],
    calls: 0,
    fn: async (html: string) => {
      spy.calls += 1;
      spy.htmls.push(html);
      return ok({
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
        pageCount: 2,
        blockedUrls,
      });
    },
  };
  return spy;
}

async function convertEpub(
  path: string,
  print: PrintSpy,
  maxBytes?: number,
): Promise<ConvertResult> {
  const head = await readSniffHead(path);
  const adapter =
    maxBytes === undefined
      ? createEpubAdapter(print.fn)
      : createEpubAdapter(print.fn, maxBytes);
  return adapter.convert({ path, options: resolveConvertOptions(), head });
}

async function failureOf(run: () => Promise<ConvertResult>): Promise<ConvertFailure> {
  try {
    await run();
  } catch (thrown) {
    if (thrown instanceof ConvertFailure) return thrown;
    throw thrown;
  }
  throw new Error('expected a ConvertFailure');
}

describe('phase56 epub parser', () => {
  it('reads the OPF spine in spine order, not filename order', () => {
    const doc = parseEpub(openZip(buildEpub()));
    expect(doc.spine.map((item) => item.id)).toEqual(['ch1', 'ch2']);
    expect(doc.spine.map((item) => item.href)).toEqual([
      'OEBPS/text/b.xhtml',
      'OEBPS/text/a.xhtml',
    ]);
    expect(doc.spine[0].xhtml).toContain('First chapter content');
    expect(doc.spine[1].xhtml).toContain('Second chapter content');
    expect(doc.title).toBe('Test Book');
    expect(doc.coverHref).toBe('OEBPS/images/cover.png');
    expect(doc.degraded).toBe(false);
    expect([...doc.images.keys()]).toEqual([
      'OEBPS/images/cover.png',
      'OEBPS/images/pic.png',
    ]);
    expect(doc.images.get('OEBPS/images/cover.png')).toBe(COVER_DATA);
    expect(doc.images.get('OEBPS/images/pic.png')).toBe(PIC_DATA);
  });

  it('falls back to <meta name="cover"> when no cover-image property exists', () => {
    const doc = parseEpub(openZip(buildEpubWithOpf(OPF_META_COVER)));
    expect(doc.coverHref).toBe('OEBPS/images/cover.png');
  });

  it('reports a typed corrupt failure for a spine item with no manifest entry', () => {
    let thrown: unknown;
    try {
      parseEpub(openZip(buildEpubWithOpf(OPF_MISSING_SPINE_ITEM)));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConvertFailure);
    expect((thrown as ConvertFailure).code).toBe('corrupt');
    expect((thrown as Error).message.length).toBeGreaterThan(0);
  });

  it('skips a non-XHTML spine item and flags the package as degraded', () => {
    const doc = parseEpub(openZip(buildEpubWithOpf(OPF_NON_XHTML_SPINE)));
    expect(doc.degraded).toBe(true);
    expect(doc.spine.map((item) => item.id)).toEqual(['ch1']);
  });

  it('strips the XHTML shell and inlines chapter images relative to the chapter', () => {
    const doc = parseEpub(openZip(buildEpub()));
    const fragment = chapterFragment(doc.spine[0].xhtml);
    expect(fragment).not.toContain('<html');
    expect(fragment).not.toContain('<body');
    expect(fragment).toContain('First chapter content');
    const inlined = inlineEpubImages(fragment, doc.spine[0].href, doc.images);
    expect(inlined).toContain(PIC_DATA);
    expect(inlined).not.toContain('../images/pic.png');
  });

  it('resolves hrefs against the declaring part and ignores remote URLs', () => {
    expect(resolveEpubHref('text', '../images/pic.png')).toBe('images/pic.png');
    expect(resolveEpubHref('OEBPS', 'images/pic.png')).toBe('OEBPS/images/pic.png');
    expect(resolveEpubHref('', 'https://example.com/a.png')).toBeNull();
    expect(resolveEpubHref('', 'data:image/png;base64,AAAA')).toBeNull();
  });
});

describe('phase56 epub adapter', () => {
  it('converts an EPUB to PDF with the cover first and chapters in spine order', async () => {
    const path = await mkFile('book.epub', buildEpub());
    const print = fakePrint();
    const result = await convertEpub(path, print);
    expect(isPdfBytes(result.bytes)).toBe(true);
    expect(result.sourceFormat).toBe('epub');
    expect(result.fidelity).toBe('layout');
    expect(result.pageCount).toBe(2);
    expect(result.title).toBe('Test Book');
    expect(print.calls).toBe(1);

    const html = print.htmls[0] ?? '';
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain(COVER_DATA);
    expect(html).toContain(PIC_DATA);
    expect(html).toContain('First chapter content');
    expect(html).toContain('Second chapter content');
    expect(html.indexOf(COVER_DATA)).toBeLessThan(html.indexOf('First chapter content'));
    expect(html.indexOf('First chapter content')).toBeLessThan(
      html.indexOf('Second chapter content'),
    );
    expect(result.warnings.some((w) => w.code === 'legacy-format-degraded')).toBe(false);
  });

  it('composes the cover block before the chapter sections', () => {
    const body = composeEpubBody(parseEpub(openZip(buildEpub())));
    expect(body.indexOf(COVER_DATA)).toBeLessThan(body.indexOf('First chapter content'));
  });

  it('returns a typed too-large failure above the byte ceiling', async () => {
    const path = await mkFile('big.epub', buildEpub());
    const failure = await failureOf(() => convertEpub(path, fakePrint(), 8));
    expect(failure.code).toBe('too-large');
  });

  it('returns a typed corrupt failure for a non-ZIP .epub and never throws', async () => {
    const path = await mkFile('broken.epub', 'this is not a zip at all');
    const failure = await failureOf(() => convertEpub(path, fakePrint()));
    expect(failure.code).toBe('corrupt');
    expect(failure.message.length).toBeGreaterThan(0);
  });

  it('returns a typed corrupt failure when container.xml is absent, without printing', async () => {
    const noContainer = zipSync({
      mimetype: [strToU8('application/epub+zip'), { level: 0 }],
      'OEBPS/content.opf': strToU8(OPF_XML),
    });
    const path = await mkFile('nocontainer.epub', noContainer);
    const print = fakePrint();
    const failure = await failureOf(() => convertEpub(path, print));
    expect(failure.code).toBe('corrupt');
    expect(failure.message.length).toBeGreaterThan(0);
    expect(print.calls).toBe(0);
  });

  it('warns legacy-format-degraded only when a spine item is truly skipped', async () => {
    const path = await mkFile('degraded.epub', buildEpubWithOpf(OPF_NON_XHTML_SPINE));
    const result = await convertEpub(path, fakePrint());
    const degraded = result.warnings.filter((w) => w.code === 'legacy-format-degraded');
    expect(degraded).toHaveLength(1);
    expect(degraded[0]?.message.length).toBeGreaterThan(0);
  });

  it('leaves a remote chapter image blocked and reports it', async () => {
    const remote = CH_ONE_XHTML.replace(
      '../images/pic.png',
      'https://example.com/pic.png',
    );
    const epub = zipSync({
      mimetype: [strToU8('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': strToU8(CONTAINER_XML),
      'OEBPS/content.opf': strToU8(OPF_XML),
      'OEBPS/text/b.xhtml': strToU8(remote),
      'OEBPS/text/a.xhtml': strToU8(CH_TWO_XHTML),
      'OEBPS/images/cover.png': new Uint8Array(PNG_COVER),
      'OEBPS/images/pic.png': new Uint8Array(PNG_PIC),
    });
    const path = await mkFile('remote.epub', epub);
    const result = await convertEpub(path, fakePrint());
    expect(result.warnings.some((w) => w.code === 'resource-blocked')).toBe(true);
  });
});

/** A minimal EPUB with one chapter and one image, for the inline-budget cases. */
function buildBudgetEpub(chapterXhtml: string, imageBytes: Uint8Array): Uint8Array {
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Budget Book</dc:title></metadata>
<manifest>
<item id="ch1" href="text/ch.xhtml" media-type="application/xhtml+xml"/>
<item id="pic" href="images/pic.png" media-type="image/png"/>
</manifest>
<spine><itemref idref="ch1"/></spine>
</package>`;
  return zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(CONTAINER_XML),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/text/ch.xhtml': strToU8(chapterXhtml),
    'OEBPS/images/pic.png': imageBytes,
  });
}

describe('phase56 epub inline budget', () => {
  it('refuses a chapter that references one image past the reference ceiling (DEF-396)', async () => {
    const refs = CONVERT_LIMITS.inlinedImageRefs + 1;
    const chapter = `<html><body><p>x</p>${'<img src="../images/pic.png" alt=""/>'.repeat(refs)}</body></html>`;
    const path = await mkFile(
      'refs.epub',
      buildBudgetEpub(chapter, new Uint8Array(PNG_PIC)),
    );
    const print = fakePrint();
    const started = Date.now();
    const failure = await failureOf(() => convertEpub(path, print));
    const elapsed = Date.now() - started;
    expect(failure.code).toBe('too-large');
    expect(failure.message).toContain(String(refs));
    expect(failure.message).toContain('inlining ceiling');
    expect(print.calls).toBe(0);
    expect(elapsed).toBeLessThan(1000);
  });

  it('refuses a chapter whose projected inlined total passes the byte ceiling', async () => {
    const refs = 49;
    // A 1 MiB image referenced 49 times projects to ~68 MB of data URIs, above
    // the 64 MiB ceiling, while staying under the reference ceiling.
    const image = Buffer.concat([PNG_PIC, Buffer.alloc(1024 * 1024 - PNG_PIC.length)]);
    const chapter = `<html><body>${'<img src="../images/pic.png" alt=""/>'.repeat(refs)}</body></html>`;
    const path = await mkFile(
      'bytes.epub',
      buildBudgetEpub(chapter, new Uint8Array(image)),
    );
    const print = fakePrint();
    const failure = await failureOf(() => convertEpub(path, print));
    expect(failure.code).toBe('too-large');
    expect(failure.message).toContain('64 MB');
    expect(print.calls).toBe(0);
  });

  it('still converts a normal multi-image chapter under the budgets', async () => {
    const path = await mkFile('normal.epub', buildEpub());
    const print = fakePrint();
    const result = await convertEpub(path, print);
    expect(isPdfBytes(result.bytes)).toBe(true);
    expect(print.calls).toBe(1);
    expect(print.htmls[0]).toContain(PIC_DATA);
  });
});

describe('phase56 epub sniff and resolution', () => {
  it('recognises an EPUB head by its mimetype marker', () => {
    expect(looksLikeEpub(Buffer.from(buildEpub().subarray(0, 4096)))).toBe(true);
    const docx = zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8('<w:document/>'),
    });
    expect(looksLikeEpub(Buffer.from(docx.subarray(0, 4096)))).toBe(false);
  });

  it('resolves an .epub to the epub adapter through createDefaultRegistry', async () => {
    const path = await mkFile('book.epub', buildEpub());
    const registry = createDefaultRegistry();
    const resolved = await registry.resolve(path, await readSniffHead(path));
    expect(resolved?.adapter.id).toBe('epub');
    expect(resolved?.byExtension).toBe(true);
  });
});

describe('phase56 epub reading document', () => {
  function service(): DocumentConversionService {
    return new DocumentConversionService({
      engine: {
        async loadDocumentBytes() {
          return ok(new ArrayBuffer(0));
        },
      },
    });
  }

  /** An EPUB whose first spine chapter is `chapterXhtml`. */
  function buildEpubWithChapter(chapterXhtml: string): Uint8Array {
    return zipSync({
      mimetype: [strToU8('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': strToU8(CONTAINER_XML),
      'OEBPS/content.opf': strToU8(OPF_XML),
      'OEBPS/text/b.xhtml': strToU8(chapterXhtml),
      'OEBPS/text/a.xhtml': strToU8(CH_TWO_XHTML),
      'OEBPS/images/cover.png': new Uint8Array(PNG_COVER),
      'OEBPS/images/pic.png': new Uint8Array(PNG_PIC),
    });
  }

  it('returns chapters in spine order with their titles and inlined images', async () => {
    const path = await mkFile('book.epub', buildEpub());
    const result = await service().readingDocument(path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe('Test Book');
    // b.xhtml precedes a.xhtml in the spine, so it must come first.
    expect(result.value.chapters.map((chapter) => chapter.id)).toEqual(['ch1', 'ch2']);
    expect(result.value.chapters.map((chapter) => chapter.href)).toEqual([
      'OEBPS/text/b.xhtml',
      'OEBPS/text/a.xhtml',
    ]);
    expect(result.value.chapters.map((chapter) => chapter.title)).toEqual([
      'Chapter One',
      'Chapter Two',
    ]);
    expect(result.value.chapters[0]?.xhtml).toContain('First chapter content');
    expect(result.value.chapters[0]?.xhtml).toContain(PIC_DATA);
    expect(result.value.chapters[1]?.xhtml).toContain('Second chapter content');
  });

  it('sanitizes a hostile chapter so no script, handler or javascript URL survives', async () => {
    const hostile = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Hostile</title></head>
<body>
<script>alert(1)</script>
<img src="x" onerror="alert(2)"/>
<a href="javascript:alert(3)" title="ok">x</a>
<a href="java&#115;cript:alert(5)">y</a>
<a href="java&#9;script:alert(6)">z</a>
<p onclick="alert(4)">safe text</p>
</body>
</html>`;
    const path = await mkFile('hostile.epub', buildEpubWithChapter(hostile));
    const result = await service().readingDocument(path);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const xhtml = result.value.chapters[0]?.xhtml ?? '';
    expect(xhtml.toLowerCase()).not.toContain('script');
    expect(xhtml.toLowerCase()).not.toContain('onerror');
    expect(xhtml.toLowerCase()).not.toContain('onclick');
    expect(xhtml.toLowerCase()).not.toContain('javascript:');
    // Neither the entity- nor the tab-obfuscated scheme survives.
    expect(xhtml).not.toContain('alert(5)');
    expect(xhtml).not.toContain('alert(6)');
    // The safe content and harmless attributes survive.
    expect(xhtml).toContain('safe text');
    expect(xhtml).toContain('title="ok"');
  });

  it('returns a typed corrupt failure for a ZIP with no container.xml, without throwing', async () => {
    const noContainer = zipSync({
      mimetype: [strToU8('application/epub+zip'), { level: 0 }],
      'OEBPS/content.opf': strToU8(OPF_XML),
    });
    const path = await mkFile('nocontainer.epub', noContainer);
    const result = await service().readingDocument(path);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('corrupt');
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  });

  it('returns a typed corrupt failure for a non-ZIP input, never a throw', async () => {
    const path = await mkFile('broken.epub', 'this is not a zip at all');
    const result = await service().readingDocument(path);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('corrupt');
  });
});
