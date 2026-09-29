import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from '../../../src/shared/result';
import type { ConvertResult } from '../../../src/shared/convert';
import { isPdfBytes } from '../../../src/main/services/print';
import {
  ConvertCancelledError,
  ConvertFailure,
  CONVERT_ERROR_MESSAGES,
} from '../../../src/main/services/convert/errors';
import {
  MAX_MOBI_TEXT_BYTES,
  MOBI_COMPRESSION_HUFFCDIC,
  MOBI_COMPRESSION_NONE,
  MOBI_COMPRESSION_PALMDOC,
  decompressPalmDoc,
  hasDrmEvidence,
  parseMobi,
} from '../../../src/main/services/convert/mobi-parse';
import {
  createMobiAdapter,
  looksLikeMobi,
  type HtmlPrintFn,
} from '../../../src/main/services/convert/adapters/mobi';
import {
  createDefaultRegistry,
  readSniffHead,
} from '../../../src/main/services/convert/registry';
import { resolveConvertOptions, CONVERT_LIMITS } from '../../../src/main/services/convert/limits';

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

/**
 * Phase 56 feature B — the pure Mobipocket parser and the `.mobi`/`.azw`/
 * `.azw3` adapter, driven by minimal PalmDBs built in-test. The print engine is
 * injected, so no Electron is needed.
 */

const RECORD0_HEADER_BYTES = 116;
const IMAGE_INDEX_OFFSET = 0x5c;
const BOUNDARY_UID = 0xffffffff;

/** Hand-encoded PalmDOC LZ77 exercising every opcode branch. */
const LZ77_PAYLOAD = Buffer.from([
  0x00, 0x03, 0x41, 0x42, 0x43, // literal run "ABC"
  0x00, 0x44, // single byte 'D'
  0x00, 0x81, // copy length 4, distance 4 -> "ABCD"
  0xc0, 0x5a, // space + 'Z'
  0x00, 0x00, // padding
  0x00, 0x01, 0x21, // literal run "!"
  0x00, 0x41, // single byte 'A'
]);
const LZ77_EXPECTED = 'ABCDABCD Z!A';

const PNG_IMAGE = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
    '0000000d4944415478da63f8cfc0f01f0005000100ffa6b1a60000000049454e44ae426082',
  'hex',
);

interface Record0Options {
  compression?: number;
  textLength?: number;
  recordCount?: number;
  encryptionType?: number;
  textEncoding?: number;
  firstImageRecord?: number;
  exth?: Buffer | null;
  exthAt16?: boolean;
}

function buildExth(records: { type: number; data: Buffer }[]): Buffer {
  const body = Buffer.concat(
    records.map((record) => {
      const buffer = Buffer.alloc(8 + record.data.length);
      buffer.writeUInt32BE(record.type, 0);
      buffer.writeUInt32BE(8 + record.data.length, 4);
      record.data.copy(buffer, 8);
      return buffer;
    }),
  );
  const head = Buffer.alloc(12);
  head.write('EXTH', 0, 'latin1');
  head.writeUInt32BE(12 + body.length, 4);
  head.writeUInt32BE(records.length, 8);
  return Buffer.concat([head, body]);
}

function buildRecord0(options: Record0Options = {}): Buffer {
  const palm = Buffer.alloc(16);
  palm.writeUInt16BE(options.compression ?? MOBI_COMPRESSION_PALMDOC, 0);
  palm.writeUInt32BE(options.textLength ?? 0, 4);
  palm.writeUInt16BE(options.recordCount ?? 1, 8);
  palm.writeUInt16BE(4096, 10);
  palm.writeUInt16BE(options.encryptionType ?? 0, 12);

  const mobi = Buffer.alloc(RECORD0_HEADER_BYTES);
  mobi.write('MOBI', 0, 'latin1');
  mobi.writeUInt32BE(RECORD0_HEADER_BYTES, 4);
  mobi.writeUInt32BE(options.textEncoding ?? 65001, 12);
  mobi.writeUInt32BE(options.firstImageRecord ?? 0, IMAGE_INDEX_OFFSET);

  const exth = options.exth ?? null;
  if (exth !== null && options.exthAt16 === true) {
    return Buffer.concat([palm, exth, mobi]);
  }
  return Buffer.concat([palm, mobi, exth ?? Buffer.alloc(0)]);
}

/** Assemble a PalmDB: 78-byte header, record table, then the records. */
function buildPalmDb(
  records: Buffer[],
  name = 'Mobi Fixture',
  uids?: number[],
): Buffer {
  const header = Buffer.alloc(78);
  Buffer.from(name, 'latin1').copy(header, 0, 0, 31);
  header.write('BOOK', 60, 'latin1');
  header.write('MOBI', 64, 'latin1');
  header.writeUInt16BE(records.length, 76);

  const tableSize = records.length * 8;
  const table = Buffer.alloc(tableSize);
  let offset = 78 + tableSize;
  for (let i = 0; i < records.length; i += 1) {
    table.writeUInt32BE(offset, i * 8);
    table.writeUInt32BE(uids?.[i] ?? 0, i * 8 + 4);
    offset += records[i].length;
  }
  return Buffer.concat([header, table, ...records]);
}

function lzFixture(): Buffer {
  return buildPalmDb([
    buildRecord0({
      compression: MOBI_COMPRESSION_PALMDOC,
      textLength: LZ77_EXPECTED.length,
      recordCount: 1,
    }),
    LZ77_PAYLOAD,
  ]);
}

function drmEncryptionFixture(): Buffer {
  return buildPalmDb([
    buildRecord0({
      compression: MOBI_COMPRESSION_PALMDOC,
      textLength: LZ77_EXPECTED.length,
      recordCount: 1,
      encryptionType: 1,
    }),
    LZ77_PAYLOAD,
  ]);
}

function drmExthFixture(exthAt16: boolean): Buffer {
  return buildPalmDb([
    buildRecord0({
      compression: MOBI_COMPRESSION_PALMDOC,
      textLength: LZ77_EXPECTED.length,
      recordCount: 1,
      exth: buildExth([{ type: 504, data: Buffer.from([0, 0, 0, 1]) }]),
      exthAt16,
    }),
    LZ77_PAYLOAD,
  ]);
}

function huffFixture(): Buffer {
  return buildPalmDb([
    buildRecord0({
      compression: MOBI_COMPRESSION_HUFFCDIC,
      textLength: 0,
      recordCount: 1,
    }),
    Buffer.from([0x00]),
  ]);
}

const HTML_TEXT = '<h1>Heading</h1><p>Body text</p><img recindex="1">';

function htmlFixture(): Buffer {
  return buildPalmDb([
    buildRecord0({
      compression: MOBI_COMPRESSION_NONE,
      textLength: HTML_TEXT.length,
      recordCount: 1,
      firstImageRecord: 2,
    }),
    Buffer.from(HTML_TEXT, 'utf8'),
    PNG_IMAGE,
  ]);
}

function kf8Fixture(kf8Compression: number): Buffer {
  const legacyText = Buffer.from('<p>Legacy text</p>', 'utf8');
  const kf8Text = Buffer.from('<h1>KF8 Heading</h1><p>KF8 text</p>', 'utf8');
  return buildPalmDb(
    [
      buildRecord0({
        compression: MOBI_COMPRESSION_NONE,
        textLength: legacyText.length,
        recordCount: 1,
      }),
      legacyText,
      Buffer.from('BOUNDARY'),
      buildRecord0({
        compression: kf8Compression,
        textLength: kf8Text.length,
        recordCount: 1,
      }),
      kf8Text,
    ],
    'Split Fixture',
    [0, 0, BOUNDARY_UID, 0, 0],
  );
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-mobi-'));
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

async function convertMobi(
  path: string,
  print: PrintSpy,
  maxBytes?: number,
): Promise<ConvertResult> {
  const head = await readSniffHead(path);
  const adapter =
    maxBytes === undefined
      ? createMobiAdapter(print.fn)
      : createMobiAdapter(print.fn, maxBytes);
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

describe('phase56 mobi parser', () => {
  it('decodes a PalmDOC LZ77 record through all five opcode branches', () => {
    const document = parseMobi(new Uint8Array(lzFixture()));
    expect(document.markup).toBe(LZ77_EXPECTED);
    expect(document.title).toBe('Mobi Fixture');
    expect(document.usedKf8).toBe(false);
    expect(document.hasKf8Part).toBe(false);
  });

  it('prefers the KF8 part when a BOUNDARY record is present', () => {
    const document = parseMobi(new Uint8Array(kf8Fixture(MOBI_COMPRESSION_NONE)));
    expect(document.usedKf8).toBe(true);
    expect(document.hasKf8Part).toBe(true);
    expect(document.markup).toContain('KF8 text');
    expect(document.markup).not.toContain('Legacy text');
    expect(document.notes).toHaveLength(0);
  });

  it('degrades to the legacy part when the KF8 compression is unsupported', () => {
    const document = parseMobi(new Uint8Array(kf8Fixture(MOBI_COMPRESSION_HUFFCDIC)));
    expect(document.usedKf8).toBe(false);
    expect(document.hasKf8Part).toBe(true);
    expect(document.markup).toContain('Legacy text');
    expect(document.notes.length).toBeGreaterThan(0);
  });

  it('flags DRM evidence from EXTH type 504', () => {
    expect(hasDrmEvidence([{ type: 504, data: new Uint8Array([0, 0, 0, 1]) }])).toBe(true);
    expect(hasDrmEvidence([{ type: 504, data: new Uint8Array([0, 0, 0, 0]) }])).toBe(false);
    expect(hasDrmEvidence([{ type: 501, data: new Uint8Array([0, 0, 0, 9]) }])).toBe(true);
  });
});

describe('phase56 mobi adapter', () => {
  it('converts a PalmDOC .mobi to PDF with the degraded warning', async () => {
    const path = await mkFile('book.mobi', lzFixture());
    const print = fakePrint();
    const result = await convertMobi(path, print);

    expect(isPdfBytes(result.bytes)).toBe(true);
    expect(result.sourceFormat).toBe('mobi');
    expect(result.fidelity).toBe('degraded');
    expect(result.pageCount).toBe(2);
    expect(result.title).toBe('Mobi Fixture');
    expect(print.calls).toBe(1);
    expect(print.htmls[0]).toContain(LZ77_EXPECTED);

    const degraded = result.warnings.filter((w) => w.code === 'legacy-format-degraded');
    expect(degraded).toHaveLength(1);
    expect(degraded[0]?.message).toContain('CSS fidelity');
    expect(degraded[0]?.message).toContain('positioned layout');
  });

  it('inlines a referenced image as a data URI after the text, in order', async () => {
    const path = await mkFile('book.azw', htmlFixture());
    const print = fakePrint();
    const result = await convertMobi(path, print);

    const html = print.htmls[0] ?? '';
    expect(html).toContain('Heading');
    expect(html).toContain('Body text');
    expect(html).toContain('data:image/png;base64,');
    expect(html.indexOf('Heading')).toBeLessThan(html.indexOf('data:image/png;base64,'));
    expect(result.warnings.some((w) => w.code === 'frame-decode-failed')).toBe(false);
  });

  it('warns frame-decode-failed for a recindex with no image record', async () => {
    const markup = '<p>Text</p><img recindex="7">';
    const fixture = buildPalmDb([
      buildRecord0({
        compression: MOBI_COMPRESSION_NONE,
        textLength: markup.length,
        recordCount: 1,
        firstImageRecord: 2,
      }),
      Buffer.from(markup, 'utf8'),
    ]);
    const path = await mkFile('missing.azw3', fixture);
    const result = await convertMobi(path, fakePrint());
    const failed = result.warnings.filter((w) => w.code === 'frame-decode-failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]?.detail).toContain('recindex=7');
  });

  it('returns a typed too-large failure above the byte ceiling', async () => {
    const path = await mkFile('big.mobi', lzFixture());
    const failure = await failureOf(() => convertMobi(path, fakePrint(), 8));
    expect(failure.code).toBe('too-large');
  });
});

/** A PalmDB whose one compression-NONE text record is `text`, plus one image. */
function imageRefsFixture(text: string, image: Buffer): Buffer {
  return buildPalmDb([
    buildRecord0({
      compression: MOBI_COMPRESSION_NONE,
      textLength: Buffer.byteLength(text),
      recordCount: 1,
      firstImageRecord: 2,
    }),
    Buffer.from(text, 'utf8'),
    image,
  ]);
}

describe('phase56 mobi inline budget', () => {
  it('refuses markup that references one image past the reference ceiling (DEF-397)', async () => {
    const refs = CONVERT_LIMITS.inlinedImageRefs + 1;
    const text = `<p>Text</p>${'<img recindex="1">'.repeat(refs)}`;
    const path = await mkFile('refs.mobi', imageRefsFixture(text, PNG_IMAGE));
    const print = fakePrint();
    const started = Date.now();
    const failure = await failureOf(() => convertMobi(path, print));
    expect(failure.code).toBe('too-large');
    expect(failure.message).toContain(String(refs));
    expect(failure.message).toContain('inlining ceiling');
    expect(print.calls).toBe(0);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('refuses markup whose projected inlined total passes the byte ceiling', async () => {
    const refs = 49;
    // A 1 MiB image referenced 49 times projects to ~68 MB of data URIs, above
    // the 64 MiB ceiling, while staying under the reference ceiling.
    const image = Buffer.concat([PNG_IMAGE, Buffer.alloc(1024 * 1024 - PNG_IMAGE.length)]);
    const text = `<p>Text</p>${'<img recindex="1">'.repeat(refs)}`;
    const path = await mkFile('bytes.mobi', imageRefsFixture(text, image));
    const print = fakePrint();
    const failure = await failureOf(() => convertMobi(path, print));
    expect(failure.code).toBe('too-large');
    expect(failure.message).toContain('64 MB');
    expect(print.calls).toBe(0);
  });

  it('still converts a normal one-image markup under the budgets', async () => {
    const path = await mkFile('normal.azw', htmlFixture());
    const print = fakePrint();
    const result = await convertMobi(path, print);
    expect(isPdfBytes(result.bytes)).toBe(true);
    expect(print.calls).toBe(1);
    expect(print.htmls[0]).toContain('data:image/png;base64,');
  });
});

/**
 * A PalmDOC record that expands to `targetBytes` of 'A': a 4-byte literal run
 * then repeated copy-length-34 distance-4 opcodes (~1.9 MB in -> 32 MB out).
 */
function lz77ExpandingRecord(targetBytes: number): Buffer {
  const bytes: number[] = [0x00, 0x04, 0x41, 0x41, 0x41, 0x41];
  let produced = 4;
  while (produced < targetBytes) {
    const chunk = Math.min(34, targetBytes - produced);
    const code = (4 << 5) | (chunk - 3); // length = chunk, distance = 4
    bytes.push((code >> 8) & 0xff, code & 0xff);
    produced += chunk;
  }
  return Buffer.from(bytes);
}

describe('phase56 mobi LZ77 decompression (DEF-398)', () => {
  it('decompresses a ceiling-sized record with a bounded buffer', () => {
    const target = MAX_MOBI_TEXT_BYTES;
    const input = lz77ExpandingRecord(target);
    const before = process.memoryUsage().heapUsed;
    const output = decompressPalmDoc(new Uint8Array(input), MAX_MOBI_TEXT_BYTES);
    const after = process.memoryUsage().heapUsed;
    const deltaMb = Math.round(((after - before) / (1024 * 1024)) * 10) / 10;
    console.log(
      `[DEF-398] LZ77 ${(input.length / (1024 * 1024)).toFixed(2)} MB input -> ` +
        `${output.length} bytes output, heap delta ${deltaMb} MB`,
    );
    expect(output.length).toBe(target);
    expect(output[0]).toBe(0x41);
    expect(output[target - 1]).toBe(0x41);
    // The old `number[]` + `Uint8Array.from` path peaked near 1 GB; the growing
    // buffer must stay well under this bound.
    expect(after - before).toBeLessThan(200 * 1024 * 1024);
  });

  it('still returns a typed too-large for a record that expands past the cap', () => {
    const input = lz77ExpandingRecord(2 * 1024 * 1024);
    let thrown: unknown;
    try {
      decompressPalmDoc(new Uint8Array(input), 1024 * 1024);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ConvertFailure);
    expect((thrown as ConvertFailure).code).toBe('too-large');
  });

  it('throws ConvertCancelledError when the signal is already aborted', () => {
    const controller = new AbortController();
    controller.abort();
    const input = lz77ExpandingRecord(1024 * 1024);
    expect(() =>
      decompressPalmDoc(new Uint8Array(input), MAX_MOBI_TEXT_BYTES, controller.signal),
    ).toThrow(ConvertCancelledError);
  });
});

describe('phase56 mobi DRM refusal', () => {
  it('refuses an encrypted header and never prints', async () => {
    const path = await mkFile('drm.mobi', drmEncryptionFixture());
    const print = fakePrint();
    const failure = await failureOf(() => convertMobi(path, print));
    expect(failure.code).toBe('drm-protected');
    expect(failure.message).toContain('DRM');
    expect(print.calls).toBe(0);
  });

  it('refuses an EXTH 504 DRM record and never prints', async () => {
    const path = await mkFile('drm-exth.mobi', drmExthFixture(false));
    const print = fakePrint();
    const failure = await failureOf(() => convertMobi(path, print));
    expect(failure.code).toBe('drm-protected');
    expect(failure.message).toContain('DRM');
    expect(print.calls).toBe(0);
  });

  it('refuses an EXTH block at offset 16 and never prints', async () => {
    const path = await mkFile('drm-exth16.mobi', drmExthFixture(true));
    const print = fakePrint();
    const failure = await failureOf(() => convertMobi(path, print));
    expect(failure.code).toBe('drm-protected');
    expect(print.calls).toBe(0);
  });
});

describe('phase56 mobi unsupported and corrupt', () => {
  it('returns a typed unsupported-format failure for HUFF/CDIC without printing', async () => {
    const path = await mkFile('huff.mobi', huffFixture());
    const print = fakePrint();
    const failure = await failureOf(() => convertMobi(path, print));
    expect(failure.code).toBe('unsupported-format');
    expect(failure.message).toContain('HUFF/CDIC');
    expect(print.calls).toBe(0);
  });

  it('returns a typed corrupt failure for a truncated PalmDB without printing', async () => {
    const broken = lzFixture();
    broken.writeUInt32BE(0xffffff, 78 + 8); // record 1 offset is past the file
    const path = await mkFile('broken.mobi', broken);
    const print = fakePrint();
    const failure = await failureOf(() => convertMobi(path, print));
    expect(failure.code).toBe('corrupt');
    expect(failure.message.length).toBeGreaterThan(0);
    expect(print.calls).toBe(0);
  });

  it('returns a typed failure when a declared text record is absent', async () => {
    const truncated = buildPalmDb([
      buildRecord0({
        compression: MOBI_COMPRESSION_PALMDOC,
        textLength: 10,
        recordCount: 4,
      }),
      LZ77_PAYLOAD,
    ]);
    const path = await mkFile('truncated.mobi', truncated);
    const failure = await failureOf(() => convertMobi(path, fakePrint()));
    expect(failure.code).toBe('corrupt');
  });
});

describe('phase56 mobi resolution', () => {
  it('resolves .mobi, .azw and .azw3 to the mobi adapter', async () => {
    const registry = createDefaultRegistry();
    for (const name of ['a.mobi', 'b.azw', 'c.azw3']) {
      const path = await mkFile(name, lzFixture());
      const resolved = await registry.resolve(path, await readSniffHead(path));
      expect(resolved?.adapter.id).toBe('mobi');
      expect(resolved?.byExtension).toBe(true);
    }
  });

  it('still resolves .epub, .cbz and .docx to their own adapters', async () => {
    const registry = createDefaultRegistry();
    const epub = Buffer.concat([
      Buffer.from('PK\x03\x04', 'latin1'),
      Buffer.from('mimetypeapplication/epub+zip', 'latin1'),
    ]);
    const docx = Buffer.concat([
      Buffer.from('PK\x03\x04', 'latin1'),
      Buffer.from('[Content_Types].xml', 'latin1'),
    ]);
    const cbz = Buffer.concat([
      Buffer.from('PK\x03\x04', 'latin1'),
      Buffer.from('page.png', 'latin1'),
    ]);
    const cases: Array<[string, Buffer, string]> = [
      ['a.epub', epub, 'epub'],
      ['a.docx', docx, 'docx'],
      ['a.cbz', cbz, 'cbz'],
    ];
    for (const [name, bytes, id] of cases) {
      const path = await mkFile(name, bytes);
      const resolved = await registry.resolve(path, await readSniffHead(path));
      expect(resolved?.adapter.id).toBe(id);
    }
  });

  it('recognises the PalmDB BOOK/MOBI header', () => {
    const head = lzFixture().subarray(0, 4096);
    expect(looksLikeMobi('unknown.bin', head)).toBe(true);
    expect(looksLikeMobi('unknown.bin', Buffer.from('not a book'))).toBe(false);
  });
});

describe('phase56 mobi error contract', () => {
  it('has a non-empty human message for drm-protected', () => {
    expect(CONVERT_ERROR_MESSAGES['drm-protected'].length).toBeGreaterThan(0);
    expect(CONVERT_ERROR_MESSAGES['drm-protected']).toContain('DRM');
  });
});
