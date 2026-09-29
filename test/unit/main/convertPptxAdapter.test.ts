import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { ok } from '../../../src/shared/result';
import type { ConvertResult } from '../../../src/shared/convert';
import { isPdfBytes } from '../../../src/main/services/print';
import { ConvertFailure } from '../../../src/main/services/convert/errors';
import {
  createPptAdapter,
  createPptxAdapter,
  looksLikePpt,
  looksLikePptx,
  recoverPptText,
  type HtmlPrintFn,
} from '../../../src/main/services/convert/adapters/pptx';
import { looksLikeDocx } from '../../../src/main/services/convert/adapters/docx';
import {
  createDefaultRegistry,
  readSniffHead,
} from '../../../src/main/services/convert/registry';
import { resolveConvertOptions } from '../../../src/main/services/convert/limits';

/**
 * Phase 55 feature C — the PPTX adapter, driven by REAL ZIP packages written
 * in-test with fflate and a REAL OLE/CFB container for the legacy `.ppt` path.
 * The print engine is injected, so no Electron is needed.
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

const WIDE_EMU = 12_192_000; // 960pt, 16:9
const WIDE_CY_EMU = 6_858_000; // 540pt
const STANDARD_EMU = 9_144_000; // 720pt, 4:3

function slideXml(body: string): string {
  return (
    '<?xml version="1.0"?>' +
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`
  );
}

function textSp(text: string, sz = 1800): string {
  return (
    '<p:sp><p:spPr><a:xfrm><a:off x="1270000" y="635000"/>' +
    '<a:ext cx="2540000" cy="1016000"/></a:xfrm></p:spPr>' +
    '<p:txBody><a:p><a:r><a:rPr lang="en-US" sz="' +
    sz +
    '"/><a:t>' +
    text +
    '</a:t></a:r></a:p></p:txBody></p:sp>'
  );
}

const SHAPE_SP =
  '<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/>' +
  '<a:ext cx="127000" cy="127000"/></a:xfrm>' +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
  '<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></p:spPr></p:sp>';

const IMAGE_PIC =
  '<p:pic><p:nvPicPr><p:cNvPr id="2" name="Picture"/></p:nvPicPr>' +
  '<p:blipFill><a:blip r:embed="rId1"/></p:blipFill>' +
  '<p:spPr><a:xfrm><a:off x="0" y="0"/>' +
  '<a:ext cx="1270000" cy="1270000"/></a:xfrm></p:spPr></p:pic>';

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);

const CONTENT_TYPES =
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Override PartName="/ppt/presentation.xml" ' +
  'ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>';

const ROOT_RELS =
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>';

interface DeckOptions {
  cx?: number;
  cy?: number;
  /** Make slide1.xml malformed (truncated). */
  malformedSlide1?: boolean;
  /** Omit ppt/media/image1.png while slide2 still references it. */
  omitMedia?: boolean;
  /** Omit the notes slide part. */
  omitNotes?: boolean;
}

/**
 * A minimal but valid PPTX package with the slide ids deliberately OUT OF
 * ORDER: `<p:sldIdLst>` lists rId4 (slide2.xml) BEFORE rId2 (slide1.xml), so a
 * mapper that trusted the file names would emit slide1 first.
 */
function buildPptx(options: DeckOptions = {}): Buffer {
  const cx = options.cx ?? WIDE_EMU;
  const cy = options.cy ?? WIDE_CY_EMU;
  const presentation =
    '<?xml version="1.0"?>' +
    '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<p:sldIdLst><p:sldId id="256" r:id="rId4"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst>' +
    `<p:sldSz cx="${cx}" cy="${cy}" type="screen16x9"/></p:presentation>`;
  const presentationRels =
    '<?xml version="1.0"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>' +
    '</Relationships>';
  const slide1 = options.malformedSlide1
    ? '<p:sld><p:cSld>'
    : slideXml(textSp('FIRST SLIDE') + SHAPE_SP);
  const slide2 = slideXml(textSp('SECOND SLIDE') + IMAGE_PIC);
  const slide2Rels =
    '<?xml version="1.0"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>' +
    (options.omitNotes
      ? ''
      : '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>') +
    '</Relationships>';
  const notes = slideXml(textSp('Speaker notes here', 1200));

  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'ppt/presentation.xml': strToU8(presentation),
    'ppt/_rels/presentation.xml.rels': strToU8(presentationRels),
    'ppt/slides/slide1.xml': strToU8(slide1),
    'ppt/slides/slide2.xml': strToU8(slide2),
    'ppt/slides/_rels/slide2.xml.rels': strToU8(slide2Rels),
    'ppt/notesSlides/notesSlide1.xml': strToU8(notes),
  };
  if (options.omitMedia !== true) entries['ppt/media/image1.png'] = PNG_BYTES;
  return Buffer.from(zipSync(entries));
}

/** A minimal OLE/CFB container holding one named stream (FAT-read, > cutoff). */
function buildCfb(streamName: string, streamBytes: Buffer): Buffer {
  const SECTOR = 512;
  const streamLen = 4096;
  const streamData = Buffer.alloc(streamLen);
  streamBytes.copy(streamData, 0, 0, Math.min(streamBytes.length, streamLen));
  const streamSectors = streamLen / SECTOR;

  const header = Buffer.alloc(SECTOR);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(9, 0x1e);
  header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(1, 0x2c);
  header.writeUInt32LE(1, 0x30);
  header.writeUInt32LE(4096, 0x38);
  header.writeUInt32LE(0xfffffffe, 0x3c);
  header.writeUInt32LE(0, 0x40);
  header.writeUInt32LE(0xfffffffe, 0x44);
  header.writeUInt32LE(0, 0x48);
  header.writeUInt32LE(0, 0x4c);
  for (let i = 1; i < 109; i += 1) header.writeUInt32LE(0xffffffff, 0x4c + i * 4);

  const fat = Buffer.alloc(SECTOR, 0xff);
  fat.writeUInt32LE(0xfffffffd, 0);
  fat.writeUInt32LE(0xfffffffe, 4);
  for (let i = 0; i < streamSectors; i += 1) {
    const next = i === streamSectors - 1 ? 0xfffffffe : 2 + i + 1;
    fat.writeUInt32LE(next, (2 + i) * 4);
  }

  const dir = Buffer.alloc(SECTOR);
  const writeEntry = (
    offset: number,
    name: string,
    type: number,
    start: number,
    size: number,
  ): void => {
    Buffer.from(name, 'utf16le').copy(dir, offset);
    dir.writeUInt16LE((name.length + 1) * 2, offset + 64);
    dir[offset + 66] = type;
    dir.writeUInt32LE(start, offset + 116);
    dir.writeUInt32LE(size, offset + 120);
  };
  writeEntry(0, 'Root Entry', 5, 0xfffffffe, 0);
  writeEntry(128, streamName, 2, 2, streamLen);

  return Buffer.concat([header, fat, dir, streamData]);
}

/** A `PowerPoint Document` stream: an RT_Document container holding one
 *  TextBytesAtom payload. */
function buildPptStream(text: string): Buffer {
  const payload = Buffer.from(text, 'latin1');
  const child = Buffer.alloc(8 + payload.length);
  child.writeUInt16LE(0x0000, 0);
  child.writeUInt16LE(0x0fa8, 2);
  child.writeUInt32LE(payload.length, 4);
  payload.copy(child, 8);
  const container = Buffer.alloc(8);
  container.writeUInt16LE(0x000f, 0);
  container.writeUInt16LE(0x03e8, 2);
  container.writeUInt32LE(child.length, 4);
  return Buffer.concat([container, child]);
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-pptx-'));
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
  options: Array<Record<string, unknown>>;
  calls: number;
}

function fakePrint(): PrintSpy {
  const spy: PrintSpy = {
    htmls: [],
    options: [],
    calls: 0,
    fn: async (html, options) => {
      spy.calls += 1;
      spy.htmls.push(html);
      spy.options.push(options as unknown as Record<string, unknown>);
      const pages = (html.match(/<section class="slide/g) ?? []).length;
      return ok({
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
        pageCount: pages,
        blockedUrls: [],
      });
    },
  };
  return spy;
}

async function convert(
  path: string,
  print: PrintSpy,
  adapter = createPptxAdapter(print.fn),
  options = resolveConvertOptions(),
): Promise<ConvertResult> {
  const head = await readSniffHead(path);
  return adapter.convert({ path, options, head });
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

describe('phase55 pptx adapter', () => {
  it('declares layout fidelity, specific resolution and both ids', () => {
    const pptx = createPptxAdapter();
    const ppt = createPptAdapter();
    expect(pptx.fidelity).toBe('layout');
    expect(pptx.specificity).toBe('specific');
    expect(pptx.maxBytes).toBeGreaterThan(0);
    expect(ppt.fidelity).toBe('degraded');
    expect([pptx.id, ppt.id]).toEqual(['pptx', 'ppt']);
    expect([pptx.extensions, ppt.extensions]).toEqual([['.pptx'], ['.ppt']]);
  });

  it('imports one page per slide in sldIdLst order, at the slide size', async () => {
    const path = await mkFile('deck.pptx', buildPptx());
    const print = fakePrint();
    const result = await convert(path, print);
    expect(isPdfBytes(result.bytes)).toBe(true);
    expect(result.sourceFormat).toBe('pptx');
    expect(result.fidelity).toBe('layout');
    expect(print.calls).toBe(1);
    const html = print.htmls[0] ?? '';
    // The order comes from sldIdLst: rId4 (slide2) precedes rId2 (slide1).
    const second = html.indexOf('SECOND SLIDE');
    const first = html.indexOf('FIRST SLIDE');
    expect(second).toBeGreaterThanOrEqual(0);
    expect(first).toBeGreaterThan(second);
    expect(html.match(/<section class="slide/g)).toHaveLength(2);
    expect(html).toContain('@page { size: 960pt 540pt; margin: 0; }');
    expect(print.options[0]?.preferCSSPageSize).toBe(true);
  });

  it('composes the 4:3 slide size exactly too', async () => {
    const path = await mkFile('four-three.pptx', buildPptx({ cx: STANDARD_EMU }));
    const print = fakePrint();
    await convert(path, print);
    expect(print.htmls[0]).toContain('@page { size: 720pt 540pt; margin: 0; }');
  });

  it('embeds slide images as data URIs', async () => {
    const path = await mkFile('image.pptx', buildPptx());
    const print = fakePrint();
    await convert(path, print);
    expect(print.htmls[0]).toContain('src="data:image/png;base64,');
  });

  it('always warns that animations and transitions are not rendered', async () => {
    const path = await mkFile('anim.pptx', buildPptx());
    const print = fakePrint();
    const result = await convert(path, print);
    const warning = result.warnings.find((entry) => entry.code === 'approx-render');
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('animations and transitions are not rendered');
  });

  it('appends the notes page only when the setting is on', async () => {
    const path = await mkFile('notes.pptx', buildPptx());

    const off = fakePrint();
    const offResult = await convert(path, off);
    expect(offResult.pageCount).toBe(2);
    expect(off.htmls[0]).not.toContain('Speaker notes here');

    const on = fakePrint();
    const onResult = await convert(
      path,
      on,
      createPptxAdapter(on.fn),
      resolveConvertOptions({ presentationIncludeNotes: true }),
    );
    expect(onResult.pageCount).toBe(3);
    expect(on.htmls[0]).toContain('Speaker notes here');
  });

  it('adds no empty notes page when the setting is on but the deck has no notes', async () => {
    const path = await mkFile('no-notes.pptx', buildPptx({ omitNotes: true }));
    const print = fakePrint();
    const result = await convert(
      path,
      print,
      createPptxAdapter(print.fn),
      resolveConvertOptions({ presentationIncludeNotes: true }),
    );
    expect(result.pageCount).toBe(2);
    expect(print.htmls[0]?.match(/<section class="slide/g)).toHaveLength(2);
  });

  it('degrades a malformed slide to a placeholder while others still render', async () => {
    const path = await mkFile('broken-slide.pptx', buildPptx({ malformedSlide1: true }));
    const print = fakePrint();
    const result = await convert(path, print);
    const html = print.htmls[0] ?? '';
    expect(html).toContain('SECOND SLIDE');
    expect(html).not.toContain('FIRST SLIDE');
    expect(html).toContain('Slide 2 could not be rendered');
    const warning = result.warnings.find((entry) => entry.message.includes('Slide 2'));
    expect(warning).toBeDefined();
    expect(warning?.code).toBe('generic-fallback');
  });

  it('degrades a slide whose referenced media is missing', async () => {
    const path = await mkFile('missing-media.pptx', buildPptx({ omitMedia: true }));
    const print = fakePrint();
    const result = await convert(path, print);
    expect(print.htmls[0]).toContain('Slide 1 could not be rendered');
    expect(print.htmls[0]).toContain('FIRST SLIDE');
    const warning = result.warnings.find((entry) => entry.message.includes('Slide 1'));
    expect(warning).toBeDefined();
  });
});

describe('phase55 pptx failure paths', () => {
  it('returns a typed too-large failure above the byte ceiling', async () => {
    const path = await mkFile('big.pptx', buildPptx());
    const failure = await failureOf(() =>
      convert(path, fakePrint(), createPptxAdapter(fakePrint().fn, 8)),
    );
    expect(failure.code).toBe('too-large');
  });

  it('returns a typed corrupt failure for a non-ZIP .pptx', async () => {
    const path = await mkFile('not-a-zip.pptx', 'this is not a zip at all');
    const failure = await failureOf(() => convert(path, fakePrint()));
    expect(failure.code).toBe('corrupt');
    expect(failure.message.length).toBeGreaterThan(0);
  });

  it('returns a typed corrupt failure for a package with no presentation part', async () => {
    const path = await mkFile(
      'content-types-only.pptx',
      zipSync({ '[Content_Types].xml': strToU8(CONTENT_TYPES) }),
    );
    const failure = await failureOf(() => convert(path, fakePrint()));
    expect(failure.code).toBe('corrupt');
    expect(failure.message).toContain('ppt/presentation.xml');
  });

  it('returns a typed corrupt failure for a truncated package', async () => {
    const path = await mkFile('truncated.pptx', buildPptx().subarray(0, 300));
    const failure = await failureOf(() => convert(path, fakePrint()));
    expect(failure.code).toBe('corrupt');
  });

  it('routes a zip-bombed .pptx through the shared ZIP ceiling', async () => {
    const bomb = zipSync({
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      'ppt/presentation.xml': new Uint8Array(200_000),
    });
    const path = await mkFile('bomb.pptx', bomb);
    const adapter = createPptxAdapter(fakePrint().fn, undefined, {
      maxEntries: 8,
      maxTotalUncompressedBytes: 1024,
      maxEntryUncompressedBytes: 1024,
    });
    const failure = await failureOf(() => convert(path, fakePrint(), adapter));
    expect(failure.code).toBe('too-large');
  });
});

describe('phase55 legacy .ppt recovery', () => {
  it('recovers text and names exactly what was lost', async () => {
    const path = await mkFile(
      'legacy.ppt',
      buildCfb(
        'PowerPoint Document',
        buildPptStream('Hello from legacy PowerPoint\rSecond line'),
      ),
    );
    const print = fakePrint();
    const head = await readSniffHead(path);
    const result = await createPptAdapter(print.fn).convert({
      path,
      options: resolveConvertOptions(),
      head,
    });
    expect(isPdfBytes(result.bytes)).toBe(true);
    expect(result.fidelity).toBe('degraded');
    expect(result.sourceFormat).toBe('ppt');
    const warning = result.warnings.find((entry) => entry.code === 'legacy-format-degraded');
    expect(warning).toBeDefined();
    expect(warning?.message).toContain(
      'Layout, shapes, images, notes, transitions and animations',
    );
    expect(warning?.message).toContain('could not be recovered');
    expect(print.htmls[0]).toContain('Hello from legacy PowerPoint');
    expect(print.htmls[0]).toContain('Second line');
  });

  it('returns a typed error rather than an empty document when no text survives', async () => {
    const path = await mkFile('empty.ppt', buildCfb('PowerPoint Document', Buffer.alloc(0)));
    const print = fakePrint();
    const head = await readSniffHead(path);
    const failure = await failureOf(() =>
      createPptAdapter(print.fn).convert({
        path,
        options: resolveConvertOptions(),
        head,
      }),
    );
    expect(failure.code).toBe('decode-failed');
    expect(failure.message.length).toBeGreaterThan(0);
    expect(print.calls).toBe(0);
  });

  it('reads a TextCharsAtom (UTF-16LE) from the record stream', () => {
    const buf = Buffer.alloc(8 + 4);
    buf.writeUInt16LE(0x0000, 0);
    buf.writeUInt16LE(0x0fa0, 2);
    buf.writeUInt32LE(4, 4);
    Buffer.from('Hi', 'utf16le').copy(buf, 8);
    expect(recoverPptText(buf)?.text).toBe('Hi');
    expect(recoverPptText(Buffer.alloc(16))).toBeNull();
  });
});

describe('phase55 pptx/ppt sniff discrimination', () => {
  it('separates pptx from the other OOXML ZIPs by the presentation marker', () => {
    const pptxHead = Buffer.from(buildPptx().subarray(0, 4096));
    const docxZip = Buffer.from(
      zipSync({
        '[Content_Types].xml': strToU8('<Types/>'),
        'word/document.xml': strToU8('<w:document/>'),
      }).subarray(0, 4096),
    );
    const xlsxZip = Buffer.from(
      zipSync({
        '[Content_Types].xml': strToU8('<Types/>'),
        'xl/workbook.xml': strToU8('<workbook/>'),
      }).subarray(0, 4096),
    );
    expect(looksLikePptx(pptxHead)).toBe(true);
    expect(looksLikePptx(docxZip)).toBe(false);
    expect(looksLikePptx(xlsxZip)).toBe(false);
    expect(looksLikePptx(Buffer.from('plain text'))).toBe(false);
    expect(looksLikeDocx(pptxHead)).toBe(true); // the broad OOXML sniff is unchanged
  });

  it('sniffs a legacy .ppt by extension, signature and stream name', () => {
    const head = Buffer.from(
      buildCfb('PowerPoint Document', buildPptStream('x')).subarray(0, 4096),
    );
    expect(head.subarray(0, 8).toString('hex')).toBe('d0cf11e0a1b11ae1');
    expect(looksLikePpt('legacy.ppt', head)).toBe(true);
    expect(looksLikePpt('mislabelled.bin', head)).toBe(true);
    expect(looksLikePpt('legacy.ppt', Buffer.from('not a cfb container'))).toBe(false);
  });

  it('resolves .pptx and .ppt through the shipped registry', async () => {
    const registry = createDefaultRegistry();
    const pptxPath = await mkFile('r.pptx', buildPptx());
    const pptPath = await mkFile(
      'r.ppt',
      buildCfb('PowerPoint Document', buildPptStream('legacy')),
    );
    expect((await registry.resolve(pptxPath, await readSniffHead(pptxPath)))?.adapter.id).toBe(
      'pptx',
    );
    expect((await registry.resolve(pptPath, await readSniffHead(pptPath)))?.adapter.id).toBe(
      'ppt',
    );
    // An unknown extension whose bytes are a PPTX resolves by content.
    const misnamed = await mkFile('misnamed.bin', buildPptx());
    const resolved = await registry.resolve(misnamed, await readSniffHead(misnamed));
    expect(resolved?.adapter.id).toBe('pptx');
    expect(resolved?.byExtension).toBe(false);
  });
});