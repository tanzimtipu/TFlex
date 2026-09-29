// Phase-56 adversary fixture generator. Builds hostile EPUB / MOBI / CBT / CBZ
// specimens under test-fixtures/adv-p56/. Pure Node (fflate for ZIPs); no
// product code modified. Run: node test-fixtures/adv-p56/gen-p56.cjs
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { zipSync } = require('fflate');

const OUT = __dirname;
const u8 = (x) => (x instanceof Uint8Array ? x : new Uint8Array(x));

// ---------------------------------------------------------------- zip helper
function writeZip(name, entries, opts = {}) {
  // entries: [{ name, data, store }] — first entry may be mimetype (stored).
  const obj = {};
  for (const e of entries) {
    obj[e.name] = e.store ? [u8(e.data), { level: 0 }] : [u8(e.data), { level: 6 }];
  }
  const zip = zipSync(obj, { level: 6 });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(zip));
  return Buffer.from(zip).length;
}

// ---------------------------------------------------------------- palmdb
function buildPalm(name, records, opts = {}) {
  const n = records.length;
  const tableEnd = 78 + n * 8;
  let off = tableEnd;
  const infos = [];
  for (let i = 0; i < n; i += 1) {
    infos.push({ offset: off, uid: opts.uids ? opts.uids[i] >>> 0 : i >>> 0 });
    off += records[i].length;
  }
  const buf = Buffer.alloc(off);
  buf.write(name.slice(0, 31), 0, 'latin1');
  buf.write('BOOK', 60, 'latin1');
  buf.write('MOBI', 64, 'latin1');
  buf.writeUInt16BE(n, 76);
  infos.forEach((info, i) => {
    buf.writeUInt32BE(info.offset, 78 + i * 8);
    buf.writeUInt32BE(info.uid, 82 + i * 8);
  });
  let p = tableEnd;
  for (const rec of records) { Buffer.from(u8(rec)).copy(buf, p); p += rec.length; }
  return buf;
}

function palmDocHeader({ compression = 2, textLength = 0, recordCount = 1, recordSize = 4096, encryptionType = 0 }) {
  const b = Buffer.alloc(16);
  b.writeUInt16BE(compression, 0);
  b.writeUInt32BE(textLength >>> 0, 4);
  b.writeUInt16BE(recordCount, 8);
  b.writeUInt16BE(recordSize, 10);
  b.writeUInt16BE(encryptionType, 12);
  return b;
}

function exthBlock(records) {
  // records: [{ type, data }]
  const parts = [Buffer.from('EXTH', 'latin1')];
  const body = [];
  for (const r of records) {
    const d = Buffer.from(u8(r.data));
    const rec = Buffer.alloc(8 + d.length);
    rec.writeUInt32BE(r.type >>> 0, 0);
    rec.writeUInt32BE(8 + d.length, 4);
    d.copy(rec, 8);
    body.push(rec);
  }
  const bodyLen = body.reduce((s, b) => s + b.length, 0);
  const len = Buffer.alloc(8);
  len.writeUInt32BE(12 + bodyLen, 0); // total EXTH block length incl. 12-byte prefix
  len.writeUInt32BE(records.length, 4);
  return Buffer.concat([parts[0], len, ...body]);
}

// A PalmDOC stream that expands to > output cap: seed 4 literal bytes then
// repeat unit 0x009F (length 34, distance 4) ~987k times.
function palmDocBombRecord() {
  const k = 987000;
  const b = Buffer.alloc(6 + k * 2);
  b[0] = 0x00; b[1] = 0x04; b[2] = 65; b[3] = 66; b[4] = 67; b[5] = 68;
  for (let i = 0; i < k; i += 1) { b[6 + i * 2] = 0x00; b[6 + i * 2 + 1] = 0x9f; }
  return b;
}

// ---------------------------------------------------------------- tar
function tarHeader({ name, size, typeflag = 0x30, magic = 'ustar' }) {
  const h = Buffer.alloc(512);
  Buffer.from(String(name).slice(0, 100), 'latin1').copy(h, 0);
  const mode = Buffer.from('0000644\0', 'latin1'); mode.copy(h, 100);
  const uid = Buffer.from('0000000\0', 'latin1'); uid.copy(h, 108);
  const gid = Buffer.from('0000000\0', 'latin1'); gid.copy(h, 116);
  if (typeof size === 'string') {
    Buffer.from(size, 'latin1').copy(h, 124, 0, Math.min(size.length, 12));
  } else {
    const oct = size.toString(8).padStart(11, '0') + '\0';
    Buffer.from(oct, 'latin1').copy(h, 124);
  }
  Buffer.from('00000000000\0', 'latin1').copy(h, 136); // mtime
  h[156] = typeflag;
  Buffer.from(magic, 'latin1').copy(h, 257);
  Buffer.from('00', 'latin1').copy(h, 263);
  // checksum: fill spaces, sum bytes, write octal
  Buffer.from('        ', 'latin1').copy(h, 148);
  let sum = 0; for (let i = 0; i < 512; i += 1) sum += h[i];
  const ck = sum.toString(8).padStart(6, '0') + '\0 ';
  Buffer.from(ck, 'latin1').copy(h, 148);
  return h;
}
function tarRecord(name, payload, opts = {}) {
  const data = Buffer.from(u8(payload));
  const h = tarHeader({ name, size: opts.sizeOverride !== undefined ? opts.sizeOverride : data.length, typeflag: opts.typeflag || 0x30, magic: opts.magic });
  const pad = (512 - (data.length % 512)) % 512;
  return Buffer.concat([h, data, Buffer.alloc(pad)]);
}
function writeTar(name, parts) { fs.writeFileSync(path.join(OUT, name), Buffer.concat(parts)); }

// ---------------------------------------------------------------- PNG
function minimalPng(w = 1, h = 1) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(4 + 4 + 13 + 4);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'latin1');
  ihdr.writeUInt32BE(w, 8);
  ihdr.writeUInt32BE(h, 12);
  ihdr[16] = 8; ihdr[17] = 6; ihdr[18] = 0; ihdr[19] = 0; ihdr[20] = 0;
  // CRC left zero: readPngMeta does not validate it.
  return Buffer.concat([sig, ihdr]);
}
function bigPng(bytes) {
  // IHDR first (valid dims), then one huge chunk whose declared length runs past
  // the end so the reader stops cleanly.
  return Buffer.concat([minimalPng(1000, 1000), Buffer.alloc(bytes, 0x41)]);
}

// ================================================================ EPUB
function epub(entries) {
  const list = [{ name: 'mimetype', data: Buffer.from('application/epub+zip'), store: true }, ...entries];
  return list;
}
function opfWithSpine(count, itemHref = 'c1.xhtml') {
  const manifest = `<item id="c1" href="${itemHref}" media-type="application/xhtml+xml"/>`;
  let spine = '';
  const chunk = [];
  for (let i = 0; i < count; i += 1) chunk.push('<itemref idref="c1"/>');
  spine = chunk.join('');
  return `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Hostile</dc:title></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`;
}
function container(opfPath = 'OEBPS/content.opf') {
  return `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/></rootfiles></container>`;
}
const CH_XHTML = (body) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c</title></head><body>${body}</body></html>`;

const made = [];
function log(n, b) { made.push(`${n} (${b} bytes)`); }

log('epub-spine-50000.epub', writeZip('epub-spine-50000.epub', epub([
  { name: 'META-INF/container.xml', data: Buffer.from(container()) },
  { name: 'OEBPS/content.opf', data: Buffer.from(opfWithSpine(50000)) },
  { name: 'OEBPS/c1.xhtml', data: Buffer.from(CH_XHTML('<p>Hello hostile</p>')) },
])));
log('epub-spine-1000000.epub', writeZip('epub-spine-1000000.epub', epub([
  { name: 'META-INF/container.xml', data: Buffer.from(container()) },
  { name: 'OEBPS/content.opf', data: Buffer.from(opfWithSpine(1000000)) },
  { name: 'OEBPS/c1.xhtml', data: Buffer.from(CH_XHTML('<p>Hello hostile</p>')) },
])));

// 10,000 <img> tags all pointing at ONE 64 KB image -> base64 amplification.
(function () {
  const pic = Buffer.alloc(64 * 1024);
  for (let i = 0; i < pic.length; i += 1) pic[i] = (i * 2654435761) & 0xff;
  const imgs = '<img src="pic.bin" alt=""/>'.repeat(10000);
  const body = CH_XHTML(imgs + '<p>tail</p>');
  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Amp</dc:title></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="img1" href="pic.bin" media-type="image/png"/></manifest><spine><itemref idref="c1"/></spine></package>`;
  log('epub-img-amp-10000.epub', writeZip('epub-img-amp-10000.epub', epub([
    { name: 'META-INF/container.xml', data: Buffer.from(container()) },
    { name: 'OEBPS/content.opf', data: Buffer.from(opf) },
    { name: 'OEBPS/c1.xhtml', data: Buffer.from(body) },
    { name: 'OEBPS/pic.bin', data: pic },
  ])));
})();

// 10,000,000-character chapter.
(function () {
  const text = 'A'.repeat(10 * 1000 * 1000);
  log('epub-chapter-10m.epub', writeZip('epub-chapter-10m.epub', epub([
    { name: 'META-INF/container.xml', data: Buffer.from(container()) },
    { name: 'OEBPS/content.opf', data: Buffer.from(opfWithSpine(1)) },
    { name: 'OEBPS/c1.xhtml', data: Buffer.from(CH_XHTML(`<p>${text}</p>`)) },
  ])));
})();

// 10,000-deep nesting.
(function () {
  const deep = '<div>'.repeat(10000) + 'x' + '</div>'.repeat(10000);
  log('epub-deep-nest-10k.epub', writeZip('epub-deep-nest-10k.epub', epub([
    { name: 'META-INF/container.xml', data: Buffer.from(container()) },
    { name: 'OEBPS/content.opf', data: Buffer.from(opfWithSpine(1)) },
    { name: 'OEBPS/c1.xhtml', data: Buffer.from(CH_XHTML(deep)) },
  ])));
})();

// href traversal / absolute / percent-encoded.
(function () {
  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><manifest>` +
    `<item id="t1" href="../evil.xhtml" media-type="application/xhtml+xml"/>` +
    `<item id="t2" href="http://evil.example/x.xhtml" media-type="application/xhtml+xml"/>` +
    `<item id="t3" href="file:///C:/Windows/win.ini" media-type="application/xhtml+xml"/>` +
    `<item id="t4" href="%2e%2e%2f%2e%2e%2fevil.xhtml" media-type="application/xhtml+xml"/>` +
    `<item id="t5" href="/abs.xhtml" media-type="application/xhtml+xml"/>` +
    `<item id="t6" href="data:text/html,<b>x</b>" media-type="application/xhtml+xml"/>` +
    `<item id="ok" href="ok.xhtml" media-type="application/xhtml+xml"/>` +
    `</manifest><spine><itemref idref="ok"/></spine></package>`;
  log('epub-href-traversal.epub', writeZip('epub-href-traversal.epub', epub([
    { name: 'META-INF/container.xml', data: Buffer.from(container()) },
    { name: 'OEBPS/content.opf', data: Buffer.from(opf) },
    { name: 'OEBPS/ok.xhtml', data: Buffer.from(CH_XHTML('<p>ok</p>')) },
  ])));
})();

// billion laughs in the OPF.
(function () {
  const lol = `<?xml version="1.0"?><!DOCTYPE test [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;"><!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;"><!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;"><!ENTITY e "&d;&d;&d;&d;&d;&d;&d;&d;&d;&d;"><!ENTITY f "&e;&e;&e;&e;&e;&e;&e;&e;&e;&e;">]><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>&f;</dc:title></metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`;
  log('epub-billion-laughs.epub', writeZip('epub-billion-laughs.epub', epub([
    { name: 'META-INF/container.xml', data: Buffer.from(container()) },
    { name: 'OEBPS/content.opf', data: Buffer.from(lol) },
    { name: 'OEBPS/c1.xhtml', data: Buffer.from(CH_XHTML('<p>lol</p>')) },
  ])));
})();

// no container.xml.
log('epub-no-container.epub', writeZip('epub-no-container.epub', epub([
  { name: 'OEBPS/content.opf', data: Buffer.from(opfWithSpine(1)) },
  { name: 'OEBPS/c1.xhtml', data: Buffer.from(CH_XHTML('<p>x</p>')) },
])));

// ================================================================ MOBI
function writeMobi(name, record0, records, opts = {}) { fs.writeFileSync(path.join(OUT, name), buildPalm(name, [record0, ...records], opts)); }

// DRM encryptionType=2 + a decompression bomb text record (must refuse before decompress).
writeMobi('mobi-drm-bomb.mobi', palmDocHeader({ compression: 2, encryptionType: 2, recordCount: 1 }), [palmDocBombRecord()], { uids: [0, 0] });
// EXTH 504 DRM flag, encryptionType 0.
(function () {
  const r0 = Buffer.concat([palmDocHeader({ compression: 2, encryptionType: 0, recordCount: 1 }), exthBlock([{ type: 504, data: Buffer.from([0, 0, 0, 1]) }])]);
  writeMobi('mobi-drm-exth504.mobi', r0, [palmDocBombRecord()], { uids: [0, 0] });
})();
// HUFF/CDIC, no DRM.
writeMobi('mobi-huffcdic.mobi', palmDocHeader({ compression: 17480, encryptionType: 0, recordCount: 1 }), [Buffer.from('<p>not decompressed</p>')], { uids: [0, 0] });
// HUFF/CDIC AND DRM: DRM must win.
writeMobi('mobi-huffcdic-drm.mobi', palmDocHeader({ compression: 17480, encryptionType: 2, recordCount: 1 }), [Buffer.from('<p>not decompressed</p>')], { uids: [0, 0] });
// out-of-order record offsets (build then patch record 1 offset before record 0).
(function () {
  const r0 = palmDocHeader({ compression: 1, encryptionType: 0, recordCount: 1 });
  const r1 = Buffer.from('<p>x</p>');
  const buf = buildPalm('bad', [r0, r1], { uids: [0, 0] });
  // record 0 offset currently 94; set record 1 offset (at 78+8) below record 0.
  buf.writeUInt32BE(20, 86);
  fs.writeFileSync(path.join(OUT, 'mobi-bad-offsets.mobi'), buf);
})();
// numRecords 65535 in a 200-byte file.
(function () {
  const buf = Buffer.alloc(200);
  buf.write('small', 0, 'latin1'); buf.write('BOOK', 60); buf.write('MOBI', 64);
  buf.writeUInt16BE(65535, 76);
  fs.writeFileSync(path.join(OUT, 'mobi-numrecords-65535.mobi'), buf);
})();
// record 0 shorter than 16 bytes.
(function () {
  const r0 = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  fs.writeFileSync(path.join(OUT, 'mobi-record0-short.mobi'), buildPalm('short', [r0], { uids: [0] }));
})();
// KF8 BOUNDARY uid on record 0 (must be ignored).
(function () {
  const r0 = palmDocHeader({ compression: 1, encryptionType: 0, recordCount: 1 });
  const r1 = Buffer.from('<p>legacy</p>');
  fs.writeFileSync(path.join(OUT, 'mobi-boundary0.mobi'), buildPalm('b0', [r0, r1], { uids: [0xffffffff, 0] }));
})();
// truncated literal run: unit 0x0008 (copy 8) but only 2 bytes follow.
writeMobi('mobi-truncated-literal.mobi', palmDocHeader({ compression: 2, encryptionType: 0, recordCount: 1 }), [Buffer.from([0x00, 0x08, 0x41, 0x42])], { uids: [0, 0] });
// copy before output start: unit 0x00C0 -> length 3, distance 6, out empty.
writeMobi('mobi-copy-before-start.mobi', palmDocHeader({ compression: 2, encryptionType: 0, recordCount: 1 }), [Buffer.from([0x00, 0xc0])], { uids: [0, 0] });
// LZ77 bomb, no DRM (bounded by the 32 MB cap).
writeMobi('mobi-lz77-bomb.mobi', palmDocHeader({ compression: 2, encryptionType: 0, recordCount: 1 }), [palmDocBombRecord()], { uids: [0, 0] });
// huge EXTH count with zero-length records.
(function () {
  const r0 = Buffer.concat([palmDocHeader({ compression: 1, encryptionType: 0, recordCount: 1 }), exthBlock([{ type: 100, data: Buffer.from([1]) }])]);
  // patch count to 0xFFFFFFFF (count field at 16 + 'EXTH'(4) + length(4))
  r0.writeUInt32BE(0xffffffff, 16 + 8);
  const r1 = Buffer.from('<p>x</p>');
  fs.writeFileSync(path.join(OUT, 'mobi-huge-exth.mobi'), buildPalm('exth', [r0, r1], { uids: [0, 0] }));
})();

// ================================================================ TAR / CBT
writeTar('cbt-only-zero.cbt', [Buffer.alloc(1024)]);
writeTar('cbt-octal-overflow.cbt', [tarRecord('p1.png', Buffer.from('x'), { sizeOverride: '77777777777' })]);
writeTar('cbt-nonoctal.cbt', [tarRecord('p1.png', Buffer.from('x'), { sizeOverride: 'abcdefghij' })]);
fs.writeFileSync(path.join(OUT, 'cbt-511.cbt'), Buffer.alloc(511));
const onePng = minimalPng();
writeTar('cbt-no-zero.cbt', [tarRecord('p1.png', onePng)]);
(function () {
  const parts = [];
  for (let i = 0; i < 10000; i += 1) parts.push(tarRecord(`p${i}.png`, Buffer.alloc(0)));
  writeTar('cbt-10000-records.cbt', parts);
})();
writeTar('cbt-traversal-name.cbt', [tarRecord('../../evil.png', onePng), Buffer.alloc(1024)]);
writeTar('cbt-payload-past-end.cbt', [tarRecord('p1.png', Buffer.alloc(0), { sizeOverride: 100000 }), Buffer.alloc(1024)]);
writeTar('cbt-nested-tar.cbt', [tarRecord('p1.png', Buffer.concat([tarRecord('inner.png', onePng)])), tarRecord('p2.png', onePng), Buffer.alloc(1024)]);

// ================================================================ CBZ
(function () {
  const entries = [];
  for (let i = 0; i < 10000; i += 1) entries.push({ name: `p${i}.png`, data: onePng });
  log('cbz-10000-entries.cbz', writeZip('cbz-10000-entries.cbz', entries));
})();
(function () {
  // PNG signature then nothing.
  const trunc = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  log('cbz-png-truncated.cbz', writeZip('cbz-png-truncated.cbz', [
    { name: 'p1.png', data: trunc },
    { name: 'p2.png', data: onePng },
  ]));
})();
log('cbz-zero-image.cbz', writeZip('cbz-zero-image.cbz', [
  { name: 'p1.png', data: Buffer.alloc(0) },
  { name: 'p2.png', data: onePng },
]));
log('cbz-big-image.cbz', writeZip('cbz-big-image.cbz', [
  { name: 'p1.png', data: bigPng(100 * 1024 * 1024) },
]));

// MOBI image-record amplification: markup references ONE image many times.
(function () {
  const tags = '<img recindex="1"/>'.repeat(300000);
  const textRec = Buffer.from(tags, 'latin1');
  const img = Buffer.alloc(2 * 1024 * 1024);
  for (let i = 0; i < img.length; i += 1) img[i] = (i * 1103515245 + 12345) & 0xff;
  // valid PNG signature + IHDR so the image validates
  minimalPng(1000, 1000).copy(img, 0);
  const r0 = Buffer.alloc(232);
  palmDocHeader({ compression: 1, encryptionType: 0, recordCount: 1 }).copy(r0, 0);
  r0.write('MOBI', 16, 'latin1');
  r0.writeUInt32BE(120, 20);   // headerLength
  r0.writeUInt32BE(65001, 28); // textEncoding UTF-8
  r0.writeUInt32BE(2, 108);    // firstImageRecord (absolute index)
  writeMobi('mobi-img-amp-300k.mobi', r0, [textRec, img], { uids: [0, 0, 0] });
  log('mobi-img-amp-300k.mobi', fs.statSync(path.join(OUT, 'mobi-img-amp-300k.mobi')).size);
})();

// 10,000-deep OPF nesting.
(function () {
  const deep = '<a>'.repeat(10000) + '<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>' + '</a>'.repeat(10000);
  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><manifest>${deep}</manifest><spine><itemref idref="c1"/></spine></package>`;
  log('epub-opf-deep-10k.epub', writeZip('epub-opf-deep-10k.epub', epub([
    { name: 'META-INF/container.xml', data: Buffer.from(container()) },
    { name: 'OEBPS/content.opf', data: Buffer.from(opf) },
    { name: 'OEBPS/c1.xhtml', data: Buffer.from(CH_XHTML('<p>x</p>')) },
  ])));
})();

console.log('generated:\n' + made.join('\n'));
