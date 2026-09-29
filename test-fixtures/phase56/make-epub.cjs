// Phase 56 (QA) — tiny real EPUB 3 generator for the reading-view IPC
// reachability check AND the Phase 56 phase-gate criterion 1/2 fixtures.
// Owned by qa; run with:
//   node test-fixtures/phase56/make-epub.cjs
// Produces phase56-book.epub beside this file: mimetype, container.xml, an OPF
// with a 2-chapter spine (b.xhtml THEN a.xhtml, deliberately not filename
// order) plus a cover image, and two XHTML chapters.
//
// Criterion 1 requires "multi-chapter, images, a heading hierarchy": each
// chapter carries an h1/h2/h3 hierarchy. The cover is a VISIBLE solid-colour
// PNG so the first printed page is unmistakably the cover in the screenshot.
// Chapter one references the cover image so the reading payload's inlined
// `data:` URI is literally the cover; chapter two references a second image.
// All strings/id/href assertions in e2e/phase56_reading_ipc.spec.cjs are kept.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { zipSync, strToU8 } = require('fflate');

const CONTAINER_XML = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>`;

const OPF_XML = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>Phase 56 Reachability Book</dc:title>
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

const CH_ONE_XHTML = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter One</title></head>
<body>
<h1>Chapter One</h1>
<h2>Section One A</h2>
<h3>Subsection One A i</h3>
<p>First chapter content</p>
<p>The first paragraph body repeats enough words to fill a printed page and let
the reader paginate the chapter across more than one screen when the font size
is enlarged in the reading view.</p>
<p>A second paragraph keeps the chapter substantial and gives the pagination
logic real content to lay out between the heading levels.</p>
<h3>Subsection One A ii</h3>
<p>Another subsection body paragraph under the same level-three heading.</p>
<h2>Section One B</h2>
<p>Content under the second level-two heading of the first chapter.</p>
<img src="../images/cover.png" alt="cover"/>
</body>
</html>`;

const CH_TWO_XHTML = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter Two</title></head>
<body>
<h1>Chapter Two</h1>
<h2>Section Two A</h2>
<h3>Subsection Two A i</h3>
<p>Second chapter content</p>
<p>The second chapter also carries a full heading hierarchy so the reading view
can be checked against a real structure rather than a flat list of paragraphs.</p>
<h3>Subsection Two A ii</h3>
<p>Closing subsection body of the second chapter.</p>
<img src="../images/pic.png" alt="pic"/>
</body>
</html>`;

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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const off = y * (1 + width * 3);
    raw[off] = 0; // filter: none
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

// The cover is a solid red block and the inline picture a solid blue block, so
// a screenshot of page 1 shows the cover unambiguously.
const PNG_COVER = solidPng(160, 220, [210, 40, 40]);
const PNG_PIC = solidPng(80, 80, [30, 90, 200]);

const bytes = zipSync({
  mimetype: [strToU8('application/epub+zip'), { level: 0 }],
  'META-INF/container.xml': strToU8(CONTAINER_XML),
  'OEBPS/content.opf': strToU8(OPF_XML),
  'OEBPS/text/b.xhtml': strToU8(CH_ONE_XHTML),
  'OEBPS/text/a.xhtml': strToU8(CH_TWO_XHTML),
  'OEBPS/images/cover.png': new Uint8Array(PNG_COVER),
  'OEBPS/images/pic.png': new Uint8Array(PNG_PIC),
});

const out = path.join(__dirname, 'phase56-book.epub');
fs.writeFileSync(out, Buffer.from(bytes));
console.log(`wrote ${out} (${bytes.length} bytes)`);
