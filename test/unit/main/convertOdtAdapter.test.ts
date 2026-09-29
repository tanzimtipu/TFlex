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
  ConvertZipError,
  inspectZip,
  openZip,
} from '../../../src/main/services/convert/convert-zip';
import {
  OdfParseError,
  OdfRenderLimitError,
  odfToHtml,
  parseOfficeStyles,
  type OdfImageMap,
} from '../../../src/main/services/convert/odf-to-html';
import {
  collectOdtImages,
  createOdtAdapter,
  looksLikeOdt,
  type HtmlPrintFn,
} from '../../../src/main/services/convert/adapters/odt';
import { looksLikeDocx } from '../../../src/main/services/convert/adapters/docx';
import {
  createDefaultRegistry,
  readSniffHead,
} from '../../../src/main/services/convert/registry';
import { resolveConvertOptions } from '../../../src/main/services/convert/limits';

/**
 * Phase 55 feature A — the ODF mapper, the ODT adapter and the bounded ZIP
 * reader. The print engine is injected, so no Electron is needed.
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

const CONTENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink">
<office:body><office:text>
<text:h text:outline-level="1">Heading One</text:h>
<text:h text:outline-level="2">Heading Two</text:h>
<text:p>plain <text:span text:style-name="Bold">bold</text:span> and <text:span text:style-name="Italic">italic</text:span> and <text:span text:style-name="BoldItalic">both</text:span></text:p>
<text:p>spaces<text:s text:c="3"/>after<text:tab/>tab<text:line-break/>break</text:p>
<text:list text:style-name="L1">
<text:list-item><text:p>Bullet A</text:p>
<text:list text:style-name="L1"><text:list-item><text:p>Nested A1</text:p></text:list-item></text:list>
</text:list-item>
<text:list-item><text:p>Bullet B</text:p></text:list-item>
</text:list>
<text:list text:style-name="L2"><text:list-item><text:p>First</text:p></text:list-item><text:list-item><text:p>Second</text:p></text:list-item></text:list>
<table:table>
<table:table-row><table:table-cell><text:p>A1</text:p></table:table-cell><table:table-cell><text:p>B1</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell><text:p>A2</text:p></table:table-cell><table:table-cell><text:p>B2</text:p></table:table-cell></table:table-row>
</table:table>
<text:p><draw:frame><draw:image xlink:href="Pictures/img.png"/></draw:frame></text:p>
</office:text></office:body></office:document-content>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
<office:styles>
<style:style style:name="Bold" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="Italic" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
<style:style style:name="BoldItalic" style:family="text" style:parent-style-name="Bold"><style:text-properties fo:font-style="italic"/></style:style>
<text:list-style style:name="L1"><text:list-level-style-bullet text:level="1"/></text:list-style>
<text:list-style style:name="L2"><text:list-level-style-number text:level="1"/></text:list-style>
</office:styles>
</office:document-styles>`;

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
    '0000000d4944415478da63f8cfc0f01f0005000100ffa6b1a60000000049454e44ae426082',
  'hex',
);

function buildOdt(): Uint8Array {
  return zipSync({
    mimetype: [
      strToU8('application/vnd.oasis.opendocument.text'),
      { level: 0 },
    ],
    'content.xml': strToU8(CONTENT_XML),
    'styles.xml': strToU8(STYLES_XML),
    'Pictures/img.png': new Uint8Array(PNG_BYTES),
  });
}

function buildMisnamedDocx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8('<w:document/>'),
  });
}

/**
 * DEF-393 — a depth-`depth` nest of tables where every one of the 1000 repeated
 * cells holds the next table. The parsed node count is tiny, but a per-cell
 * repeat cap alone still expands to 1000^depth cells; the aggregate render
 * budget must stop it.
 */
function bombTable(depth: number): string {
  let body = '<text:p>x</text:p>';
  for (let level = 0; level < depth; level += 1) {
    body =
      '<table:table><table:table-row>' +
      '<table:table-cell table:number-columns-repeated="1000">' +
      body +
      '</table:table-cell></table:table-row></table:table>';
  }
  return body;
}

function buildBombContent(depth: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0">
<office:body><office:text>${bombTable(depth)}</office:text></office:body></office:document-content>`;
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-odt-'));
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
}

function fakePrint(blockedUrls: string[] = []): PrintSpy {
  const htmls: string[] = [];
  return {
    htmls,
    fn: async (html: string) => {
      htmls.push(html);
      return ok({
        bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]),
        pageCount: 2,
        blockedUrls,
      });
    },
  };
}

async function convertOdt(
  path: string,
  print: PrintSpy,
  maxBytes?: number,
): Promise<ConvertResult> {
  const head = await readSniffHead(path);
  const adapter = maxBytes === undefined ? createOdtAdapter(print.fn) : createOdtAdapter(print.fn, maxBytes);
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

describe('DEF-393 — the ODF render budget bounds nested repeats', () => {
  it('throws OdfRenderLimitError on a d=3 repeated-cell bomb in bounded time', () => {
    const styles = parseOfficeStyles(STYLES_XML);
    const started = Date.now();
    let thrown: unknown;
    try {
      odfToHtml(buildBombContent(3), styles, new Map());
    } catch (error) {
      thrown = error;
    }
    const elapsedMs = Date.now() - started;
    expect(thrown).toBeInstanceOf(OdfRenderLimitError);
    expect(thrown).toBeInstanceOf(OdfParseError);
    expect((thrown as Error).message.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(5_000);
    // eslint-disable-next-line no-console
    process.stdout.write(`[DEF-393] d=3 odt render-bomb stop wall clock: ${elapsedMs} ms\n`);
  });
});

describe('phase55 odf-to-html mapping', () => {
  const styles = parseOfficeStyles(STYLES_XML);
  const images: OdfImageMap = new Map([['Pictures/img.png', 'data:image/png;base64,AAAA']]);
  const html = odfToHtml(CONTENT_XML, styles, images);

  it('maps text:h outline levels to h1..h6', () => {
    expect(html).toContain('<h1>Heading One</h1>');
    expect(html).toContain('<h2>Heading Two</h2>');
  });

  it('maps styled spans to strong/em with parent inheritance', () => {
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<em><strong>both</strong></em>');
  });

  it('keeps text:s, text:tab and text:line-break', () => {
    expect(html).toContain('spaces&nbsp;&nbsp;&nbsp;after');
    expect(html).toContain('odf-tab');
    expect(html).toContain('tab<br>break');
  });

  it('nests a list inside a list item and honours the ordered style', () => {
    expect(html).toContain('<ul>');
    expect(html).toMatch(/Bullet A<br><ul>/);
    expect(html).toContain('Nested A1');
    expect(html).toContain('<ol><li>First</li>');
  });

  it('maps a table to the right row and cell counts', () => {
    expect(html.match(/<tr>/g)).toHaveLength(2);
    expect(html.match(/<td>/g)).toHaveLength(4);
    expect(html).toContain('<td>A1</td>');
    expect(html).toContain('<td>B2</td>');
  });

  it('embeds a Pictures image as a data URI and drops unknown hrefs', () => {
    expect(html).toContain('<img src="data:image/png;base64,AAAA"');
    const none = odfToHtml(CONTENT_XML, styles, new Map());
    expect(none).not.toContain('<img');
  });
});

describe('phase55 odt adapter', () => {
  it('converts a real ODT package to PDF through the injected engine', async () => {
    const path = await mkFile('sample.odt', buildOdt());
    const print = fakePrint();
    const result = await convertOdt(path, print);
    expect(isPdfBytes(result.bytes)).toBe(true);
    expect(result.fidelity).toBe('layout');
    expect(result.sourceFormat).toBe('odt');
    expect(result.pageCount).toBe(2);
    expect(result.title).toBe('sample');
    const html = print.htmls[0] ?? '';
    expect(html).toContain('<h1>Heading One</h1>');
    expect(html).toContain('<p>');
    expect(html).toContain('<strong>');
    expect(html).toContain('<em>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<ol>');
    expect(html).toContain('<table>');
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('Content-Security-Policy');
  });

  it('collects only Pictures entries and base64-embeds them', () => {
    const images = collectOdtImages(openZip(buildOdt()));
    expect([...images.keys()]).toEqual(['Pictures/img.png']);
    expect(images.get('Pictures/img.png')).toMatch(/^data:image\/png;base64,/);
  });

  it('returns a typed too-large failure above the byte ceiling', async () => {
    const path = await mkFile('big.odt', buildOdt());
    const failure = await failureOf(() => convertOdt(path, fakePrint(), 8));
    expect(failure.code).toBe('too-large');
  });

  it('returns a typed corrupt failure for a non-package .odt', async () => {
    const path = await mkFile('broken.odt', 'this is not a zip at all');
    const failure = await failureOf(() => convertOdt(path, fakePrint()));
    expect(failure.code).toBe('corrupt');
    expect(failure.message.length).toBeGreaterThan(0);
  });

  it('returns a typed corrupt failure when content.xml is absent', async () => {
    const noContent = zipSync({
      mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
      'styles.xml': strToU8(STYLES_XML),
    });
    const path = await mkFile('nocontent.odt', noContent);
    const failure = await failureOf(() => convertOdt(path, fakePrint()));
    expect(failure.code).toBe('corrupt');
  });
});

describe('phase55 zip ceilings', () => {
  const tight = {
    maxEntries: 8,
    maxTotalUncompressedBytes: 1024,
    maxEntryUncompressedBytes: 1024,
  };

  it('refuses a zip bomb entry rather than expanding it', () => {
    const bomb = zipSync({ 'big.bin': new Uint8Array(200_000) });
    let thrown: unknown;
    try {
      openZip(bomb, tight);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConvertZipError);
    expect((thrown as ConvertZipError).code).toBe('too-large');
    // The header pre-scan refuses it too, before mammoth could unzip it.
    expect(() => inspectZip(bomb, tight)).toThrow(ConvertZipError);
  });

  it('refuses an archive above the entry-count ceiling', () => {
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i < 12; i += 1) many[`f${i}.txt`] = strToU8('x');
    let thrown: unknown;
    try {
      openZip(zipSync(many), tight);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConvertZipError);
    expect((thrown as ConvertZipError).code).toBe('too-large');
  });

  it('reports corrupt bytes as a typed corrupt failure', () => {
    expect(() => openZip(strToU8('not a zip'))).toThrow(ConvertZipError);
    try {
      openZip(strToU8('not a zip'));
    } catch (error) {
      expect((error as ConvertZipError).code).toBe('corrupt');
    }
  });
});

describe('phase55 sniff discrimination', () => {
  it('never lets the ODT and DOCX sniffs both claim the same head', () => {
    const odtHead = Buffer.from(buildOdt().subarray(0, 4096));
    const docxHead = Buffer.from(buildMisnamedDocx().subarray(0, 4096));
    expect(looksLikeOdt(odtHead)).toBe(true);
    expect(looksLikeDocx(odtHead)).toBe(false);
    expect(looksLikeDocx(docxHead)).toBe(true);
    expect(looksLikeOdt(docxHead)).toBe(false);
  });

  it('routes a .docx-named ODT to the ODT adapter by content', async () => {
    const path = await mkFile('misnamed.docx', buildOdt());
    const registry = createDefaultRegistry();
    const resolved = await registry.resolve(path, await readSniffHead(path));
    expect(resolved?.adapter.id).toBe('odt');
    expect(resolved?.byExtension).toBe(false);
  });

  it('routes an .odt-named DOCX package to the DOCX adapter by content', async () => {
    const path = await mkFile('misnamed.odt', buildMisnamedDocx());
    const registry = createDefaultRegistry();
    const resolved = await registry.resolve(path, await readSniffHead(path));
    expect(resolved?.adapter.id).toBe('docx');
    expect(resolved?.byExtension).toBe(false);
  });
});
