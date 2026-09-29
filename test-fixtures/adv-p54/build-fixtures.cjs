// Phase 54 adversary fixture builder. Generates every hostile input under
// test-fixtures/adv-p54/. Run: node test-fixtures/adv-p54/build-fixtures.cjs
// Nothing here touches product code; only new specimen files are written.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const DIR = __dirname;
fs.mkdirSync(DIR, { recursive: true });
const P = (name) => path.join(DIR, name);
const log = (m) => process.stdout.write(m + '\n');

// ---------------------------------------------------------------------------
// PNG writer
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
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tb, Buffer.from(data)])), 0);
  return Buffer.concat([len, tb, Buffer.from(data), crc]);
}

/**
 * Build a valid PNG. colorType 0 = grayscale, 6 = RGBA, bitDepth 8 or 1.
 * phys = {ppuX, ppuY, unit} or null.
 */
function makePng(width, height, colorType, bitDepth, phys) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const chunks = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr)];
  if (phys) {
    const ph = Buffer.alloc(9);
    ph.writeUInt32BE(phys.ppuX >>> 0, 0);
    ph.writeUInt32BE(phys.ppuY >>> 0, 4);
    ph[8] = phys.unit;
    chunks.push(pngChunk('pHYs', ph));
  }
  // Raw scanlines: filter byte 0 + pixels.
  let rowBytes;
  if (bitDepth === 1) rowBytes = Math.ceil(width / 8);
  else if (colorType === 6) rowBytes = width * 4;
  else rowBytes = width;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) raw[y * (rowBytes + 1)] = 0;
  chunks.push(pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })));
  chunks.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

// Valid RGBA 100x100 variants for the pHYs probes.
const rgba100 = (phys) => makePng(100, 100, 6, 8, phys);
fs.writeFileSync(P('png-phys-zero.png'), rgba100({ ppuX: 0, ppuY: 0, unit: 1 }));
fs.writeFileSync(P('png-phys-max.png'), rgba100({ ppuX: 0xffffffff, ppuY: 0xffffffff, unit: 1 }));
fs.writeFileSync(P('png-phys-unit0.png'), rgba100({ ppuX: 11811, ppuY: 11811, unit: 0 }));
fs.writeFileSync(P('png-1x1-100000dpi.png'), makePng(1, 1, 6, 8, { ppuX: 3937008, ppuY: 3937008, unit: 1 }));
// 2000x2000 grayscale at pHYs 40 px/m (~1.016 DPI) -> page ~141732 pt.
fs.writeFileSync(P('png-2000-1dpi.png'), makePng(2000, 2000, 0, 8, { ppuX: 40, ppuY: 40, unit: 1 }));
// The literal attack: 20000x20000 1-bit at pHYs 40. ~50MB raw, deflates small.
log('building png-20000-1dpi.png (20000x20000 1-bit)...');
fs.writeFileSync(P('png-20000-1dpi.png'), makePng(20000, 20000, 0, 1, { ppuX: 40, ppuY: 40, unit: 1 }));

// ---------------------------------------------------------------------------
// JPEG JFIF patches (reuse the valid Phase 54 300-DPI JPEG)
// ---------------------------------------------------------------------------
const jpgBase = fs.readFileSync(path.join(DIR, '..', 'phase54', 'dpi-300.jpg'));
const unit0 = Buffer.from(jpgBase);
unit0[13] = 0; // density unit 0 = aspect-ratio only
fs.writeFileSync(P('jpg-jfif-unit0.jpg'), unit0);
const dens0 = Buffer.from(jpgBase);
dens0[14] = 0;
dens0[15] = 0; // Xdensity 0, unit 1
fs.writeFileSync(P('jpg-jfif-density0.jpg'), dens0);

// ---------------------------------------------------------------------------
// TIFF crafters (little-endian)
// ---------------------------------------------------------------------------
function tiffHeaderLe(ifdOffset) {
  const b = Buffer.alloc(8);
  b.write('II', 0, 'ascii');
  b.writeUInt16LE(42, 2);
  b.writeUInt32LE(ifdOffset, 4);
  return b;
}
/** One IFD, all entries inline (<=4 byte values). entries=[{tag,type,count,value}] */
function ifdLe(entries, nextOffset) {
  const b = Buffer.alloc(2 + entries.length * 12 + 4);
  b.writeUInt16LE(entries.length, 0);
  entries.forEach((e, i) => {
    const o = 2 + i * 12;
    b.writeUInt16LE(e.tag, o);
    b.writeUInt16LE(e.type, o + 2);
    b.writeUInt32LE(e.count, o + 4);
    b.writeUInt32LE(e.value >>> 0, o + 8);
  });
  b.writeUInt32LE(nextOffset >>> 0, 2 + entries.length * 12);
  return b;
}

// (5) cyclic IFD: IFD0 at 8, 0 entries, next-IFD offset points back to 8.
fs.writeFileSync(P('tiff-cyclic-ifd.tiff'), Buffer.concat([tiffHeaderLe(8), ifdLe([], 8)]));

// (7a) no valid IFD: offset points far past EOF.
fs.writeFileSync(P('tiff-no-ifd.tiff'), tiffHeaderLe(0xfffff000));

// (6/7) a normal-ish TIFF whose frame dims are absurd and whose strip array is
// empty: decodeImage allocates height*rowbytes then toRGBA8 allocates w*h*4.
fs.writeFileSync(
  P('tiff-absurd-dims.tiff'),
  Buffer.concat([
    tiffHeaderLe(8),
    ifdLe(
      [
        { tag: 256, type: 4, count: 1, value: 20000 }, // width
        { tag: 257, type: 4, count: 1, value: 20000 }, // height
        { tag: 273, type: 4, count: 0, value: 0 }, // StripOffsets = []
        { tag: 277, type: 3, count: 1, value: 1 }, // SamplesPerPixel
      ],
      0,
    ),
  ]),
);

// (7b) resolution tags of 0 + a valid tiny 1x1 image body.
fs.writeFileSync(
  P('tiff-res-zero.tiff'),
  Buffer.concat([
    tiffHeaderLe(8),
    ifdLe(
      [
        { tag: 256, type: 3, count: 1, value: 1 },
        { tag: 257, type: 3, count: 1, value: 1 },
        { tag: 258, type: 3, count: 1, value: 8 },
        { tag: 259, type: 3, count: 1, value: 1 },
        { tag: 262, type: 3, count: 1, value: 1 },
        { tag: 273, type: 4, count: 1, value: 158 },
        { tag: 277, type: 3, count: 1, value: 1 },
        { tag: 278, type: 3, count: 1, value: 1 },
        { tag: 279, type: 3, count: 1, value: 1 },
        { tag: 282, type: 3, count: 1, value: 0 },
        { tag: 283, type: 3, count: 1, value: 0 },
        { tag: 296, type: 3, count: 1, value: 2 },
      ],
      0,
    ),
    Buffer.from([0x80]), // one pixel at offset 158
  ]),
);

// (8) zero-byte TIFF and a valid-looking header with no body.
fs.writeFileSync(P('tiff-empty.tiff'), Buffer.alloc(0));
fs.writeFileSync(P('tiff-header-only.tiff'), tiffHeaderLe(8));

// (6) many frames: chain N empty IFDs (no t256/t257) -> placeholder pages.
function manyFrames(n) {
  const parts = [tiffHeaderLe(8)];
  let off = 8;
  for (let i = 0; i < n; i += 1) {
    const next = i === n - 1 ? 0 : off + 6;
    parts.push(ifdLe([], next));
    off += 6;
  }
  return Buffer.concat(parts);
}
fs.writeFileSync(P('tiff-frames-1200.tiff'), manyFrames(1200));
fs.writeFileSync(P('tiff-frames-3000.tiff'), manyFrames(3000));

// (7c) truncated copies of a real 3-frame TIFF at several cut points.
const real = fs.readFileSync(path.join(DIR, '..', 'phase54', 'frames-3.tiff'));
[0.2, 0.5, 0.8, 0.95].forEach((frac) => {
  const n = Math.floor(real.length * frac);
  fs.writeFileSync(P(`tiff-truncated-${Math.round(frac * 100)}.tiff`), real.subarray(0, n));
});

// ---------------------------------------------------------------------------
// (9)/(10) mislabelled containers
// ---------------------------------------------------------------------------
const pdfBytes = fs.readFileSync(path.join(DIR, '..', 'phase54', 'pdfa-1b-ok.pdf'));
fs.writeFileSync(P('pdf-as-png.png'), pdfBytes); // PDF bytes, .png extension
fs.writeFileSync(P('png-as-tiff.tiff'), rgba100(null));
fs.writeFileSync(P('tiff-as-png.png'), fs.readFileSync(P('tiff-res-zero.tiff')));
fs.writeFileSync(P('text-as-png.png'), Buffer.from('this is definitely not an image\n', 'utf8'));
fs.writeFileSync(P('random-bin-as-jpg.jpg'), Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 37) & 0xff)));

// ---------------------------------------------------------------------------
// SVG fixtures
// ---------------------------------------------------------------------------
const svg = (body, head = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">') =>
  `<?xml version="1.0"?>\n${head}\n${body}\n</svg>\n`;

// (11a) billion laughs
const billion = `<?xml version="1.0"?>
<!DOCTYPE lolz [
 <!ENTITY lol "lol">
 <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
 <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
 <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
 <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
 <!ENTITY lol5 "&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;">
 <!ENTITY lol6 "&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;">
 <!ENTITY lol7 "&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;">
 <!ENTITY lol8 "&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;">
]>
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
 <rect width="100" height="100" fill="blue"/>
 <text x="1" y="10">&lol8;</text>
</svg>
`;
fs.writeFileSync(P('svg-billion-laughs.svg'), billion);

// (11b) external entity pointing at a real local file
const ext = `<?xml version="1.0"?>
<!DOCTYPE foo [
 <!ENTITY xxe SYSTEM "file:///C:/Windows/win.ini">
 <!ENTITY winfile SYSTEM "file:///C:/Windows/win.ini">
]>
<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
 <rect width="100" height="100" fill="red"/>
 <text x="1" y="10">&winfile;</text>
</svg>
`;
fs.writeFileSync(P('svg-external-entity.svg'), ext);

// (12) 2000-deep nested <g>
const deep = 2000;
fs.writeFileSync(
  P('svg-deep-nest.svg'),
  svg(`${'<g>'.repeat(deep)}<rect x="1" y="1" width="10" height="10" fill="green"/>${'</g>'.repeat(deep)}`),
);
// also 100000 deep to test the recursive walk
const deeper = 100000;
fs.writeFileSync(
  P('svg-deep-nest-100k.svg'),
  svg(`${'<g>'.repeat(deeper)}<rect x="1" y="1" width="10" height="10" fill="green"/>${'</g>'.repeat(deeper)}`),
);

// (13) path d with 200000 segments
const segs = 200000;
let d = 'M 0,0';
for (let i = 0; i < segs; i += 1) d += ` L ${i % 100},${(i * 7) % 100}`;
fs.writeFileSync(P('svg-huge-path.svg'), svg(`<path d="${d}" fill="none" stroke="black" stroke-width="0.5"/>`));

// (14) hostile numbers
fs.writeFileSync(
  P('svg-numeric-hostile.svg'),
  svg(
    [
      '<g transform="translate(NaN,Infinity) scale(1e999) rotate(-1e999)">',
      '<rect x="NaN" y="Infinity" width="1e999" height="-5" rx="NaN" ry="-Infinity" fill="blue"/>',
      '<circle cx="NaN" cy="1e999" r="-5" fill="red"/>',
      '<ellipse cx="0" cy="0" rx="-1" ry="NaN" fill="green"/>',
      '<path d="M NaN,Infinity L 1e999,-1e999" stroke-width="1e999" stroke="black"/>',
      '</g>',
    ].join('\n'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="Infinity" height="NaN" viewBox="NaN NaN 1e999 -5">',
  ),
);
// a variant with a valid outer size but hostile inner numbers
fs.writeFileSync(
  P('svg-numeric-hostile2.svg'),
  svg(
    '<g transform="translate(NaN,Infinity) scale(1e999) rotate(-1e999)"><rect x="NaN" y="Infinity" width="1e999" height="-5" rx="NaN" ry="-Infinity" fill="blue"/><circle cx="NaN" cy="1e999" r="-5" fill="red"/></g>',
  ),
);

// (15) zero/negative viewBox and zero size
fs.writeFileSync(P('svg-zero-viewbox.svg'), svg('<rect width="10" height="10"/>', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 0">'));
fs.writeFileSync(P('svg-negative-viewbox.svg'), svg('<rect width="10" height="10"/>', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 -100 -100">'));
fs.writeFileSync(P('svg-zero-size.svg'), svg('<rect width="10" height="10"/>', '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0">'));
fs.writeFileSync(P('svg-zero-size-vb.svg'), svg('<rect width="10" height="10"/>', '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" viewBox="0 0 100 100">'));

// (16) use loops
fs.writeFileSync(
  P('svg-use-loop.svg'),
  svg('<defs><g id="a"><use href="#b"/></g><g id="b"><use href="#a"/></g></defs><use href="#a"/>'),
);
let chain = '<defs>';
for (let i = 0; i < 500; i += 1) chain += `<g id="u${i}"><use href="#u${i + 1}"/></g>`;
chain += '<g id="u500"><rect width="10" height="10" fill="purple"/></g></defs><use href="#u0"/>';
fs.writeFileSync(P('svg-use-500.svg'), svg(chain));

// (17) remote resources
fs.writeFileSync(
  P('svg-remote.svg'),
  `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="200">
 <image href="https://example.invalid/track.png" x="0" y="0" width="200" height="200"/>
 <image xlink:href="http://example.invalid/x.png" x="0" y="0" width="10" height="10"/>
 <rect width="200" height="200" fill="white"/>
</svg>
`,
);
fs.writeFileSync(
  P('svg-remote-styles.svg'),
  `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
 <style>@import url("https://example.invalid/evil.css"); body { background: url(https://example.invalid/bg.png); }</style>
 <filter id="f"><feGaussianBlur stdDeviation="2"/></filter>
 <rect width="200" height="200" fill="url(https://example.invalid/bg.png)" filter="url(#f)"/>
</svg>
`,
);

// (18) filter + mask at a 20000x20000 viewBox (engine fallback, huge page)
fs.writeFileSync(
  P('svg-filter-mask-20000.svg'),
  `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20000 20000" width="20000" height="20000">
 <defs>
  <filter id="blur"><feGaussianBlur stdDeviation="50"/></filter>
  <mask id="m"><rect width="20000" height="20000" fill="white"/></mask>
 </defs>
 <rect width="20000" height="20000" fill="red" filter="url(#blur)" mask="url(#m)"/>
</svg>
`,
);

// (19) truncated valid SVGs at several cut points
const nativeSvg = fs.readFileSync(path.join(DIR, '..', 'phase54', 'native.svg'));
[0.25, 0.5, 0.75, 0.9].forEach((frac) => {
  fs.writeFileSync(P(`svg-truncated-${Math.round(frac * 100)}.svg`), nativeSvg.subarray(0, Math.floor(nativeSvg.length * frac)));
});

log('image + svg + container fixtures written');

// ---------------------------------------------------------------------------
// Validation PDFs
// ---------------------------------------------------------------------------
const { PDFDocument, PDFName, PDFDict, PDFNumber, PDFNull, PDFArray } = require('@cantoo/pdf-lib');

const XMP = (inner) =>
  `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n` +
  `<x:xmpmeta xmlns:x="adobe:ns:meta/">\n<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n` +
  inner +
  `\n</rdf:RDF>\n</x:xmpmeta>\n<?xpacket end="w"?>\n`;

const pdfaId = (part, conf) =>
  `<rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>${part}</pdfaid:part><pdfaid:conformance>${conf}</pdfaid:conformance></rdf:Description>`;
const pdfxId = (version) =>
  `<rdf:Description rdf:about="" xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/"><pdfxid:GTS_PDFXVersion>${version}</pdfxid:GTS_PDFXVersion></rdf:Description>`;

async function makePdf({ xmp, outputIntents, encrypt, contentText, addPage = true }) {
  const doc = await PDFDocument.create();
  if (addPage) {
    const page = doc.addPage([200, 200]);
    if (contentText !== undefined) {
      const stream = doc.context.flateStream(contentText);
      page.node.set(PDFName.of('Contents'), doc.context.register(stream));
    }
  }
  if (xmp !== undefined) {
    const meta = doc.context.stream(xmp, { Type: 'Metadata', Subtype: 'XML' });
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(meta));
  }
  if (outputIntents !== undefined) {
    doc.catalog.set(PDFName.of('OutputIntents'), outputIntents);
  }
  if (encrypt) {
    // A syntactically present /Encrypt the loader will not decrypt (no password,
    // ignoreEncryption=true in the validator) but will report as encrypted.
    const enc = doc.context.obj({ Filter: 'Standard', V: 2, R: 3, Length: 128, P: -1 });
    doc.context.trailerInfo.Encrypt = doc.context.register(enc);
  }
  return Buffer.from(await doc.save());
}

(async () => {
  const out = {};
  out['val-pdfa-part9.pdf'] = await makePdf({ xmp: XMP(pdfaId(9, 'Z')) });
  out['val-pdfa-unknown-conf.pdf'] = await makePdf({ xmp: XMP(pdfaId(1, 'X')) });
  out['val-pdfa-1b-no-oi.pdf'] = await makePdf({ xmp: XMP(pdfaId(1, 'B')) });
  out['val-pdfa-ok-oifull.pdf'] = await makePdf({
    xmp: XMP(pdfaId(1, 'B')),
    outputIntents: (() => undefined)(),
  });
  // truncated mid-packet: keep the pdfaid part but cut before conformance closes
  out['val-pdfa-truncated-xmp.pdf'] = await makePdf({
    xmp: '<?xpacket begin="\uFEFF"?><x:xmpmeta><rdf:RDF><rdf:Description xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>1</pdfaid:part><pdfaid:confo',
  });
  out['val-encrypt-pdfaid.pdf'] = await makePdf({ xmp: XMP(pdfaId(1, 'B')), encrypt: true });
  out['val-pdfx-part9.pdf'] = await makePdf({ xmp: XMP(pdfxId('PDF/X-99:2099')) });

  // (24) /OutputIntents wrong types
  for (const [name, value] of [
    ['val-oi-number.pdf', PDFNumber.of(42)],
    ['val-oi-null.pdf', PDFNull],
  ]) {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.catalog.set(PDFName.of('OutputIntents'), value);
    out[name] = Buffer.from(await doc.save());
  }
  {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const nested = doc.context.obj([[1, 2], [3, 4]]);
    doc.catalog.set(PDFName.of('OutputIntents'), nested);
    out['val-oi-nested.pdf'] = Buffer.from(await doc.save());
  }
  {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const arr = doc.context.obj([PDFNumber.of(1)]);
    doc.catalog.set(PDFName.of('OutputIntents'), arr);
    out['val-oi-array-of-numbers.pdf'] = Buffer.from(await doc.save());
  }

  for (const [name, bytes] of Object.entries(out)) fs.writeFileSync(P(name), bytes);
  log('validation PDFs written: ' + Object.keys(out).length);

  // (23) very large decoded content stream: ~200MB of CMYK operators.
  // The file stays small (Flate), but the validator decodes and splits it.
  const pattern = '0 0 0 0 k\n';
  const target = 200 * 1024 * 1024;
  const reps = Math.ceil(target / pattern.length);
  log(`building val-bigcontent.pdf (decoded ~${(reps * pattern.length / 1048576).toFixed(0)}MB)...`);
  const big = await makePdf({ contentText: pattern.repeat(reps) });
  fs.writeFileSync(P('val-bigcontent.pdf'), big);
  log('val-bigcontent.pdf size=' + big.length);

  log('ALL FIXTURES DONE');
})().catch((e) => {
  process.stderr.write('FIXTURE BUILD FAILED: ' + (e && e.stack) + '\n');
  process.exit(1);
});
