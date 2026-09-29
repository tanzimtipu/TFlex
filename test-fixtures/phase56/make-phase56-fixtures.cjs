// Phase 56 (QA) — builds the phase-gate fixtures for criteria 3-7:
//   * phase56-book.mobi      — unprotected PalmDB, PalmDOC-compressed text,
//                              one image record referenced by recindex
//   * phase56-drm.mobi       — encryptionType=1 AND EXTH type 504=1
//   * phase56-comic.cbz      — 12 images p1..p12, ZIP insertion order scrambled
//   * phase56-comic.cbt      — the same 12 images as a ustar TAR
//   * phase56-comic-corrupt.cbz — p1..p12 with p7.png a non-image
//   * phase56-truncated.cbt  — the comic TAR cut mid-record (criterion 7)
// Owned by qa. Run: node test-fixtures/phase56/make-phase56-fixtures.cjs
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { zipSync } = require('fflate');

const OUT = __dirname;

// --- Minimal solid-colour PNG encoder (valid CRC32, no external deps) --------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function solidPng(width, height, [r, g, b]) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const off = y * (1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      raw[off + 1 + x * 3] = r;
      raw[off + 2 + x * 3] = g;
      raw[off + 3 + x * 3] = b;
    }
  }
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// One distinct page image: a solid-colour PNG with a trailing tag byte so every
// page's bytes are unique (isValidComicImage reads IHDR, so the tail is inert).
function pageBytes(n) {
  const hue = (n * 21) % 256;
  return Buffer.concat([solidPng(48, 64, [hue, (hue * 3) % 256, 255 - hue]), Buffer.from([n & 0xff])]);
}

const PAGE_NAMES = [
  'p3.png', 'p1.png', 'p12.png', 'p10.png', 'p2.png', 'p11.png',
  'p4.png', 'p9.png', 'p5.png', 'p8.png', 'p6.png', 'p7.png',
];

// --- ustar TAR writer -------------------------------------------------------
function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}
function writeAscii(buf, at, text, length) {
  for (let i = 0; i < length; i += 1) buf[at + i] = i < text.length ? text.charCodeAt(i) : 0;
}
function writeOctal(buf, at, value, length) {
  writeAscii(buf, at, value.toString(8).padStart(length - 1, '0'), length - 1);
  buf[at + length - 1] = 0;
}
function tarHeader(name, size) {
  const header = new Uint8Array(512);
  writeAscii(header, 0, name, 100);
  writeOctal(header, 100, 0o644, 8);
  writeOctal(header, 108, 0, 8);
  writeOctal(header, 116, 0, 8);
  writeOctal(header, 124, size, 12);
  writeOctal(header, 136, 0, 12);
  header[156] = 0x30; // regular file
  writeAscii(header, 257, 'ustar\0', 6);
  writeAscii(header, 263, '00', 2);
  for (let i = 148; i < 156; i += 1) header[i] = 0x20;
  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += header[i];
  writeAscii(header, 148, sum.toString(8).padStart(6, '0'), 6);
  header[154] = 0;
  header[155] = 0x20;
  return header;
}
function buildTar(names) {
  const blocks = [];
  for (const name of names) {
    const bytes = pageBytes(Number(name.replace(/[^0-9]/g, '')));
    blocks.push(tarHeader(name, bytes.length));
    const padded = new Uint8Array(Math.ceil(bytes.length / 512) * 512);
    padded.set(bytes, 0);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(512), new Uint8Array(512));
  return Buffer.from(concatBytes(blocks));
}

// --- PalmDB / MOBI ----------------------------------------------------------
const RECORD0_HEADER_BYTES = 116;
const IMAGE_INDEX_OFFSET = 0x5c;

function buildExth(records) {
  const body = Buffer.concat(records.map((record) => {
    const buffer = Buffer.alloc(8 + record.data.length);
    buffer.writeUInt32BE(record.type, 0);
    buffer.writeUInt32BE(8 + record.data.length, 4);
    record.data.copy(buffer, 8);
    return buffer;
  }));
  const head = Buffer.alloc(12);
  head.write('EXTH', 0, 'latin1');
  head.writeUInt32BE(12 + body.length, 4);
  head.writeUInt32BE(records.length, 8);
  return Buffer.concat([head, body]);
}

function buildRecord0(options = {}) {
  const palm = Buffer.alloc(16);
  palm.writeUInt16BE(options.compression ?? 2, 0);
  palm.writeUInt32BE(options.textLength ?? 0, 4);
  palm.writeUInt16BE(options.recordCount ?? 1, 8);
  palm.writeUInt16BE(4096, 10);
  palm.writeUInt16BE(options.encryptionType ?? 0, 12);
  const mobi = Buffer.alloc(RECORD0_HEADER_BYTES);
  mobi.write('MOBI', 0, 'latin1');
  mobi.writeUInt32BE(RECORD0_HEADER_BYTES, 4);
  mobi.writeUInt32BE(65001, 12);
  mobi.writeUInt32BE(options.firstImageRecord ?? 0, IMAGE_INDEX_OFFSET);
  return Buffer.concat([palm, mobi, options.exth ?? Buffer.alloc(0)]);
}

function buildPalmDb(records, name = 'Mobi Fixture') {
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
    table.writeUInt32BE(0, i * 8 + 4);
    offset += records[i].length;
  }
  return Buffer.concat([header, table, ...records]);
}

// PalmDOC LZ77 encode using only literal-run opcodes (unit 1..8 = run length).
function palmDocCompressLiteral(bytes) {
  const parts = [];
  for (let i = 0; i < bytes.length; i += 8) {
    const chunk = bytes.subarray(i, Math.min(i + 8, bytes.length));
    parts.push(Buffer.from([0x00, chunk.length]));
    parts.push(Buffer.from(chunk));
  }
  return Buffer.concat(parts);
}

const MOBI_MARKUP = '<h1>Mobi Heading</h1><p>Mobi body text after the heading.</p><img recindex="1">';
const MOBI_IMAGE = solidPng(48, 64, [20, 160, 60]);

function mobiFixture(encrypted) {
  const text = palmDocCompressLiteral(Buffer.from(MOBI_MARKUP, 'utf8'));
  const record0 = buildRecord0({
    compression: 2,
    textLength: MOBI_MARKUP.length,
    recordCount: 1,
    firstImageRecord: 2,
    encryptionType: encrypted ? 1 : 0,
    exth: encrypted ? buildExth([{ type: 504, data: Buffer.from([0, 0, 0, 1]) }]) : null,
  });
  return buildPalmDb([record0, text, MOBI_IMAGE]);
}

// --- Write everything -------------------------------------------------------
function write(name, bytes) {
  const out = path.join(OUT, name);
  fs.writeFileSync(out, Buffer.from(bytes));
  console.log(`wrote ${name} (${bytes.length} bytes)`);
}

write('phase56-book.mobi', mobiFixture(false));
write('phase56-drm.mobi', mobiFixture(true));

const cbzFiles = {};
for (const name of PAGE_NAMES) cbzFiles[name] = pageBytes(Number(name.replace(/[^0-9]/g, '')));
write('phase56-comic.cbz', zipSync(cbzFiles));

const corruptFiles = {};
for (const name of PAGE_NAMES) {
  corruptFiles[name] = name === 'p7.png'
    ? Buffer.from('this is not an image at all')
    : pageBytes(Number(name.replace(/[^0-9]/g, '')));
}
write('phase56-comic-corrupt.cbz', zipSync(corruptFiles));

const tar = buildTar(PAGE_NAMES);
write('phase56-comic.cbt', tar);
write('phase56-truncated.cbt', tar.subarray(0, tar.length - 1800));
