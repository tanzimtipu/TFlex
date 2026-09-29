// Phase 54 QA fixture generator. Deterministic, dependency-light: PNG is
// hand-rolled, JPEG is a minimal baseline encoder (constant 8x8 blocks), TIFF
// is hand-built (baseline + CCITT G4), SVG is text, and the PDF/A + PDF/X
// fixtures are built with the app's own @cantoo/pdf-lib. Run once:
//   node test-fixtures/phase54/build-fixtures.cjs
// The produced files are the committed inputs the e2e spec reads.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const UTIF = require('utif');
const { PDFDocument, PDFArray, PDFDict, PDFName, rgb, cmyk, StandardFonts } = require('@cantoo/pdf-lib');

const OUT = __dirname;
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// PNG (hand-rolled, RGB8, optional pHYs)
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(...parts) {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i += 1) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(t, data), 0);
  return Buffer.concat([len, t, Buffer.from(data), crc]);
}
function makePng(width, height, rgbFn, phys) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = rgbFn(x, y);
      const o = y * (stride + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr)];
  if (phys) {
    const p = Buffer.alloc(9);
    p.writeUInt32BE(phys.x, 0);
    p.writeUInt32BE(phys.y, 4);
    p[8] = 1; // unit = metre
    parts.push(pngChunk('pHYs', p));
  }
  parts.push(pngChunk('IDAT', zlib.deflateSync(raw)));
  parts.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// Minimal baseline JPEG encoder (4:4:4, constant 8x8 blocks, standard tables)
// ---------------------------------------------------------------------------
const DC_LUM_NR = [0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_LUM_VAL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_LUM_NR = [0, 0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 125];
const AC_LUM_VAL = [
  1, 2, 3, 0, 4, 17, 5, 18, 33, 49, 65, 6, 19, 81, 97, 7, 34, 113, 20, 50, 129, 145, 161, 8,
  35, 66, 177, 193, 21, 82, 209, 240, 36, 51, 98, 114, 130, 9, 10, 22, 23, 24, 25, 26, 37, 38,
  39, 40, 41, 42, 52, 53, 54, 55, 56, 57, 58, 67, 68, 69, 70, 71, 72, 73, 74, 83, 84, 85, 86,
  87, 88, 89, 90, 99, 100, 101, 102, 103, 104, 105, 106, 115, 116, 117, 118, 119, 120, 121, 122,
  131, 132, 133, 134, 135, 136, 137, 138, 146, 147, 148, 149, 150, 151, 152, 153, 154, 162, 163,
  164, 165, 166, 167, 168, 169, 170, 178, 179, 180, 181, 182, 183, 184, 185, 186, 194, 195, 196,
  197, 198, 199, 200, 201, 202, 210, 211, 212, 213, 214, 215, 216, 217, 218, 225, 226, 227, 228,
  229, 230, 231, 232, 233, 234, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250,
];
function buildHuff(nr, val) {
  const map = new Map();
  let code = 0, k = 0;
  for (let len = 1; len <= 16; len += 1) {
    for (let i = 0; i < nr[len]; i += 1) { map.set(val[k], { code, len }); k += 1; code += 1; }
    code <<= 1;
  }
  return map;
}
const DC_HT = buildHuff(DC_LUM_NR, DC_LUM_VAL);
const AC_HT = buildHuff(AC_LUM_NR, AC_LUM_VAL);
class BitWriter {
  constructor() { this.bytes = []; this.acc = 0; this.n = 0; }
  bit(b) {
    this.acc = (this.acc << 1) | (b & 1); this.n += 1;
    if (this.n === 8) { this.push(this.acc & 0xff); this.acc = 0; this.n = 0; }
  }
  push(byte) { this.bytes.push(byte); if (byte === 0xff) this.bytes.push(0x00); }
  write(code, len) { for (let i = len - 1; i >= 0; i -= 1) this.bit((code >> i) & 1); }
  flush() { if (this.n > 0) { this.acc <<= 8 - this.n; this.push(this.acc & 0xff); this.acc = 0; this.n = 0; } }
}
function category(v) { let a = Math.abs(v), c = 0; while (a > 0) { a >>= 1; c += 1; } return c; }
function writeDC(bw, diff) {
  const cat = category(diff);
  const e = DC_HT.get(cat);
  bw.write(e.code, e.len);
  if (cat > 0) bw.write(diff > 0 ? diff : diff + (1 << cat) - 1, cat);
}
function writeEOB(bw) { const e = AC_HT.get(0); bw.write(e.code, e.len); }
function seg(marker, payload) {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2, 0);
  return Buffer.concat([Buffer.from([0xff, marker]), len, Buffer.from(payload)]);
}
function encodeJpeg(width, height, rgbFn, dpi) {
  const bw = new BitWriter();
  const prev = [0, 0, 0];
  for (let by = 0; by < height; by += 8) {
    for (let bx = 0; bx < width; bx += 8) {
      const [r, g, b] = rgbFn(bx, by);
      const Y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      const Cb = Math.round(128 - 0.168736 * r - 0.331264 * g + 0.5 * b);
      const Cr = Math.round(128 + 0.5 * r - 0.418688 * g - 0.081312 * b);
      const comps = [Y, Cb, Cr];
      for (let c = 0; c < 3; c += 1) {
        const dc = 8 * (comps[c] - 128);
        writeDC(bw, dc - prev[c]);
        prev[c] = dc;
        writeEOB(bw);
      }
    }
  }
  bw.flush();
  const app0 = Buffer.concat([
    Buffer.from('JFIF\0', 'ascii'), Buffer.from([1, 1, 1]),
    Buffer.from([(dpi >> 8) & 0xff, dpi & 0xff, (dpi >> 8) & 0xff, dpi & 0xff]),
    Buffer.from([0, 0]),
  ]);
  const dqt = Buffer.concat([Buffer.from([0x00]), Buffer.alloc(64, 1)]);
  const sof = Buffer.concat([
    Buffer.from([8, (height >> 8) & 0xff, height & 0xff, (width >> 8) & 0xff, width & 0xff, 3]),
    Buffer.from([1, 0x11, 0]), Buffer.from([2, 0x11, 0]), Buffer.from([3, 0x11, 0]),
  ]);
  const dhtDC = Buffer.concat([Buffer.from([0x00]), Buffer.from(DC_LUM_NR.slice(1)), Buffer.from(DC_LUM_VAL)]);
  const dhtAC = Buffer.concat([Buffer.from([0x10]), Buffer.from(AC_LUM_NR.slice(1)), Buffer.from(AC_LUM_VAL)]);
  const sos = Buffer.concat([
    Buffer.from([3]), Buffer.from([1, 0x00]), Buffer.from([2, 0x00]), Buffer.from([3, 0x00]),
    Buffer.from([0, 63, 0]),
  ]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, app0), seg(0xdb, dqt), seg(0xc0, sof),
    seg(0xc4, dhtDC), seg(0xc4, dhtAC), seg(0xda, sos),
    Buffer.from(bw.bytes), Buffer.from([0xff, 0xd9]),
  ]);
}

module.exports = { makePng, encodeJpeg };

// ---------------------------------------------------------------------------
// TIFF builders
// ---------------------------------------------------------------------------
// Baseline little-endian TIFF, one 12-entry IFD per frame (mirrors the unit
// test's builder). A corrupt frame carries ImageWidth 0 so UTIF cannot decode
// it and the adapter inserts its placeholder page.
function buildBaselineTiff(frames) {
  const n = frames.length;
  const entriesPer = 12;
  const block = 2 + entriesPer * 12 + 4;
  const ifdOffset = (i) => 8 + i * block;
  const valuesStart = 8 + n * block;
  const rationalBase = (i) => valuesStart + i * 16;
  let cursor = valuesStart + n * 16;
  const stripOffset = frames.map((f) => {
    const off = cursor;
    cursor += f.corrupt ? 0 : f.width * f.height;
    return off;
  });
  const buf = Buffer.alloc(cursor);
  buf.write('II', 0, 'ascii');
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(8, 4);
  frames.forEach((f, i) => {
    const base = ifdOffset(i);
    buf.writeUInt16LE(entriesPer, base);
    let e = base + 2;
    const entry = (tag, type, count, value) => {
      buf.writeUInt16LE(tag, e);
      buf.writeUInt16LE(type, e + 2);
      buf.writeUInt32LE(count, e + 4);
      buf.writeUInt32LE(value, e + 8);
      e += 12;
    };
    const w = f.corrupt ? 0 : f.width;
    entry(256, 3, 1, w);
    entry(257, 3, 1, f.height);
    entry(258, 3, 1, 8);
    entry(259, 3, 1, 1);
    entry(262, 3, 1, 1);
    entry(273, 4, 1, stripOffset[i]);
    entry(277, 3, 1, 1);
    entry(278, 3, 1, f.height);
    entry(279, 4, 1, w * f.height);
    entry(282, 5, 1, rationalBase(i));
    entry(283, 5, 1, rationalBase(i) + 8);
    entry(296, 3, 1, 2);
    buf.writeUInt32LE(i < n - 1 ? ifdOffset(i + 1) : 0, e);
    const dpi = f.dpi ?? 72;
    buf.writeUInt32LE(Math.round(dpi), rationalBase(i));
    buf.writeUInt32LE(1, rationalBase(i) + 4);
    buf.writeUInt32LE(Math.round(dpi), rationalBase(i) + 8);
    buf.writeUInt32LE(1, rationalBase(i) + 12);
    if (!f.corrupt) buf.fill(0x80, stripOffset[i], stripOffset[i] + w * f.height);
  });
  return buf;
}

// --- CCITT Group 4 (T.6) encoder for a bilevel image -----------------------
const LENS_W = UTIF.decode._lens[0];
const LENS_B = UTIF.decode._lens[1];
const INV_W = {}; const INV_B = {};
for (const [code, len] of Object.entries(LENS_W)) INV_W[len] = code;
for (const [code, len] of Object.entries(LENS_B)) INV_B[len] = code;
const VCODE = { 0: '1', 1: '011', 2: '000011', 3: '0000011', '-1': '010', '-2': '000010', '-3': '0000010' };
class StrBitWriter {
  constructor() { this.bits = ''; }
  write(s) { this.bits += s; }
  toBytes() {
    const out = Buffer.alloc(Math.ceil(this.bits.length / 8));
    for (let i = 0; i < this.bits.length; i += 1) if (this.bits[i] === '1') out[i >> 3] |= 1 << (7 - (i & 7));
    return out;
  }
}
function makeDiff(line) {
  const out = [];
  if (line[0] === 1) out.push(0, 1);
  for (let i = 1; i < line.length; i += 1) if (line[i - 1] !== line[i]) out.push(i, line[i]);
  out.push(line.length, 0, line.length, 1);
  return out;
}
function findDiff(diff, x, clr) {
  for (let i = 0; i < diff.length; i += 2) if (diff[i] >= x && diff[i + 1] === clr) return diff[i];
  return undefined;
}
function writeRun(bw, len, clr) {
  const inv = clr === 0 ? INV_W : INV_B;
  while (len >= 1792) {
    const k = Math.min(12, Math.floor((len - 1792) / 64));
    bw.write(inv[1792 + k * 64]);
    len -= 1792 + k * 64;
  }
  if (len >= 64) {
    const k = Math.floor(len / 64);
    bw.write(inv[k * 64]);
    len -= k * 64;
  }
  bw.write(inv[len]);
}
function encodeG4(rows) {
  const bw = new StrBitWriter();
  const w = rows[0].length;
  let ref = new Array(w).fill(0);
  for (const cur of rows) {
    const pline = makeDiff(ref);
    let a0 = 0, clr = 0;
    while (a0 < w) {
      const b1 = findDiff(pline, a0 + (a0 === 0 ? 0 : 1), 1 - clr);
      const b2 = findDiff(pline, b1, clr);
      let a1 = a0;
      while (a1 < w && cur[a1] === clr) a1 += 1;
      if (b2 < a1) {
        bw.write('0001');
        a0 = b2;
      } else if (Math.abs(a1 - b1) <= 3) {
        bw.write(VCODE[a1 - b1]);
        a0 = a1;
        clr = 1 - clr;
      } else {
        bw.write('001');
        let a2 = a1;
        while (a2 < w && cur[a2] === 1 - clr) a2 += 1;
        writeRun(bw, a1 - a0, clr);
        writeRun(bw, a2 - a1, 1 - clr);
        a0 = a2;
      }
    }
    ref = cur;
  }
  return bw.toBytes();
}
// A single-frame G4 TIFF (photometric 0 = WhiteIsZero, so bit 1 renders black).
function buildG4Tiff(width, height, rows, dpi) {
  const strip = encodeG4(rows);
  const entries = [
    [256, 3, 1, width], [257, 3, 1, height], [258, 3, 1, 1], [259, 3, 1, 4],
    [262, 3, 1, 0], [266, 3, 1, 1], [273, 4, 1, 0], [277, 3, 1, 1],
    [278, 3, 1, height], [279, 4, 1, strip.length], [282, 5, 1, 0], [283, 5, 1, 0],
    [296, 3, 1, 2],
  ];
  const ifdStart = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  const rationalStart = ifdStart + ifdSize;
  const stripStart = rationalStart + 16;
  const buf = Buffer.alloc(stripStart + strip.length);
  buf.write('II', 0, 'ascii');
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(ifdStart, 4);
  buf.writeUInt16LE(entries.length, ifdStart);
  let e = ifdStart + 2;
  for (const [tag, type, count, value] of entries) {
    let v = value;
    if (tag === 273) v = stripStart;
    if (tag === 282) v = rationalStart;
    if (tag === 283) v = rationalStart + 8;
    buf.writeUInt16LE(tag, e);
    buf.writeUInt16LE(type, e + 2);
    buf.writeUInt32LE(count, e + 4);
    buf.writeUInt32LE(v, e + 8);
    e += 12;
  }
  buf.writeUInt32LE(0, e);
  buf.writeUInt32LE(dpi, rationalStart);
  buf.writeUInt32LE(1, rationalStart + 4);
  buf.writeUInt32LE(dpi, rationalStart + 8);
  buf.writeUInt32LE(1, rationalStart + 12);
  strip.copy(buf, stripStart);
  return buf;
}

// ---------------------------------------------------------------------------
// SVG fixtures
// ---------------------------------------------------------------------------
const NATIVE_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">',
  '  <rect x="10" y="10" width="220" height="140" fill="#eef2ff" stroke="#1e3a8a" stroke-width="4"/>',
  '  <g transform="translate(40 40) rotate(15)">',
  '    <path d="M0 0 C 30 -40, 70 40, 100 0 L 100 60 Z" fill="#2563eb" opacity="0.8"/>',
  '    <circle cx="130" cy="30" r="24" fill="#f59e0b" stroke="#7c2d12" stroke-width="3"/>',
  '    <ellipse cx="60" cy="90" rx="40" ry="18" fill="#10b981" opacity="0.6"/>',
  '    <line x1="0" y1="120" x2="180" y2="120" stroke="#111827" stroke-width="5"/>',
  '    <polyline points="0,140 40,110 80,140 120,110" fill="none" stroke="#db2777" stroke-width="4"/>',
  '    <polygon points="150,140 180,100 210,140" fill="#8b5cf6" opacity="0.7"/>',
  '  </g>',
  '</svg>',
].join('\n');

const FALLBACK_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">',
  '  <defs>',
  '    <filter id="blur"><feGaussianBlur stdDeviation="4"/></filter>',
  '    <mask id="m"><rect x="0" y="0" width="120" height="160" fill="white"/></mask>',
  '  </defs>',
  '  <rect x="10" y="10" width="220" height="140" fill="#eef2ff" stroke="#1e3a8a" stroke-width="4"/>',
  '  <circle cx="80" cy="80" r="40" fill="#2563eb" filter="url(#blur)"/>',
  '  <rect x="120" y="40" width="80" height="80" fill="#f59e0b" mask="url(#m)"/>',
  '</svg>',
].join('\n');

const TEXT_SVG = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160">',
  '  <rect x="10" y="10" width="220" height="140" fill="#ffffff" stroke="#111827" stroke-width="2"/>',
  '  <text x="30" y="90" font-family="sans-serif" font-size="36" fill="#111827">Hello SVG</text>',
  '</svg>',
].join('\n');

// ---------------------------------------------------------------------------
// PDF/A + PDF/X fixtures (mirror test/unit/main/validationFixtures.ts)
// ---------------------------------------------------------------------------
const PDFA1B_XMP = [
  '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
  '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
  ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
  '  <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">',
  '   <pdfaid:part>1</pdfaid:part>',
  '   <pdfaid:conformance>B</pdfaid:conformance>',
  '  </rdf:Description>',
  ' </rdf:RDF>',
  '</x:xmpmeta>',
  '<?xpacket end="w"?>',
].join('\n');
const PDFX1A_XMP = [
  '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
  '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
  ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
  '  <rdf:Description rdf:about="" xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/" pdfxid:GTS_PDFXVersion="PDF/X-1:2001"/>',
  ' </rdf:RDF>',
  '</x:xmpmeta>',
  '<?xpacket end="w"?>',
].join('\n');

function addMetadata(doc, packet) {
  const stream = doc.context.stream(Buffer.from(packet, 'utf8'), { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
}
function addOutputIntent(doc) {
  const dict = doc.context.obj({ Type: 'OutputIntent', S: 'GTS_PDFA1' });
  const icc = doc.context.stream(new Uint8Array([0, 0, 0, 2, 0x49, 0x43, 0x43]), { N: 3 });
  dict.set(PDFName.of('DestOutputProfile'), doc.context.register(icc));
  doc.catalog.set(PDFName.of('OutputIntents'), doc.context.obj([dict]));
}
function addEmbeddedFont(doc, page) {
  const font = doc.context.obj({ Type: 'Font', Subtype: 'TrueType', BaseFont: 'TFlexFixture' });
  const file = doc.context.stream(new Uint8Array([1, 2, 3, 4, 5]), { Length1: 5 });
  const descriptor = doc.context.obj({
    Type: 'FontDescriptor', FontName: 'TFlexFixture', Flags: 4,
    FontFile2: doc.context.register(file),
  });
  font.set(PDFName.of('FontDescriptor'), doc.context.register(descriptor));
  const resources = page.node.Resources() ?? doc.context.obj({});
  page.node.set(PDFName.of('Resources'), resources);
  resources.set(PDFName.of('Font'), doc.context.obj({ F1: doc.context.register(font) }));
}
async function buildPdfAOk() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([200, 200]);
  addMetadata(doc, PDFA1B_XMP);
  addOutputIntent(doc);
  addEmbeddedFont(doc, page);
  return doc.save();
}
async function buildPdfABad() {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([200, 200]);
  addMetadata(doc, PDFA1B_XMP);
  // A real base-14 font: pdf-lib's StandardFonts font has no FontDescriptor,
  // so the validator reports it as non-embedded.
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('Not embedded', { x: 20, y: 100, size: 18, font: helv });
  return doc.save();
}
async function buildPdfX(deviceRgb) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const page = doc.addPage([200, 200]);
  addMetadata(doc, PDFX1A_XMP);
  addOutputIntent(doc);
  addEmbeddedFont(doc, page);
  if (deviceRgb) page.drawRectangle({ x: 20, y: 20, width: 80, height: 80, color: rgb(0.9, 0.1, 0.1) });
  else page.drawRectangle({ x: 20, y: 20, width: 80, height: 80, color: cmyk(0, 1, 1, 0) });
  return doc.save();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function write(name, buf) {
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(`wrote ${name} (${buf.length} bytes)`);
}
function gradient(x, y) { return [(x * 3) % 256, (y * 5) % 256, 160]; }

// PNGs: identical 720x360 pixels, different pHYs.
write('dpi-72.png', makePng(720, 360, gradient, { x: 2835, y: 2835 }));
write('dpi-300.png', makePng(720, 360, gradient, { x: 11811, y: 11811 }));
write('no-dpi.png', makePng(720, 360, gradient, null));
// JPEG: 720x360, JFIF density 300 DPI.
write('dpi-300.jpg', encodeJpeg(720, 360, (x, y) => [(x * 3) % 256, (y * 5) % 256, 160], 300));

// TIFFs.
write('frames-3.tiff', buildBaselineTiff([
  { width: 300, height: 150, dpi: 72 },
  { width: 100, height: 200, dpi: 100 },
  { width: 50, height: 50, dpi: 50 },
]));
write('frames-corrupt.tiff', buildBaselineTiff([
  { width: 300, height: 150, dpi: 72 },
  { width: 100, height: 200, dpi: 100, corrupt: true },
  { width: 50, height: 50, dpi: 50 },
]));
// A 200-frame stack (10x10 px each) for the criterion-2 memory measurement.
write('frames-200.tiff', buildBaselineTiff(
  Array.from({ length: 200 }, () => ({ width: 10, height: 10, dpi: 72 })),
));

// G4: draw "G4" with a 5x7 bitmap font, scaled 12x, on a 144x96 canvas.
const FONT = {
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
};
const GW = 144, GH = 96, SCALE = 12;
const rows = Array.from({ length: GH }, () => new Array(GW).fill(0));
function stamp(ch, ox, oy) {
  const glyph = FONT[ch];
  for (let gy = 0; gy < glyph.length; gy += 1) {
    for (let gx = 0; gx < glyph[gy].length; gx += 1) {
      if (glyph[gy][gx] !== '1') continue;
      for (let sy = 0; sy < SCALE; sy += 1) {
        for (let sx = 0; sx < SCALE; sx += 1) {
          const px = ox + gx * SCALE + sx;
          const py = oy + gy * SCALE + sy;
          if (px >= 0 && px < GW && py >= 0 && py < GH) rows[py][px] = 1;
        }
      }
    }
  }
}
stamp('G', 12, 6);
stamp('4', 84, 6);
write('frames-g4.tiff', buildG4Tiff(GW, GH, rows, 72));

// SVGs.
write('native.svg', Buffer.from(NATIVE_SVG, 'utf8'));
write('fallback.svg', Buffer.from(FALLBACK_SVG, 'utf8'));
write('text.svg', Buffer.from(TEXT_SVG, 'utf8'));

// PDFs.
(async () => {
  write('pdfa-1b-ok.pdf', Buffer.from(await buildPdfAOk()));
  write('pdfa-1b-bad.pdf', Buffer.from(await buildPdfABad()));
  write('pdfx-1a-cmyk.pdf', Buffer.from(await buildPdfX(false)));
  write('pdfx-1a-rgb.pdf', Buffer.from(await buildPdfX(true)));
  console.log('done');
})();
