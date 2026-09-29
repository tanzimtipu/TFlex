// Phase 56 (QA) — tiny real EPUB 3 generator for the reading-view IPC
// reachability check. Owned by qa; run with:
//   node test-fixtures/phase56/make-epub.cjs
// Produces phase56-book.epub beside this file: mimetype, container.xml, an OPF
// with a 2-chapter spine (b.xhtml THEN a.xhtml, deliberately not filename
// order) plus a cover image, and two XHTML chapters. Chapter one references the
// cover image so the reading payload's inlined `data:` URI is literally the
// cover; chapter two references a second image.
const fs = require('node:fs');
const path = require('node:path');
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
<p>First chapter content</p>
<img src="../images/cover.png" alt="cover"/>
</body>
</html>`;

const CH_TWO_XHTML = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter Two</title></head>
<body>
<h1>Chapter Two</h1>
<p>Second chapter content</p>
<img src="../images/pic.png" alt="pic"/>
</body>
</html>`;

// Smallest valid 1x1 RGBA PNG (same bytes the unit suite uses).
const PNG_COVER = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
    '0000000d4944415478da63f8cfc0f01f0005000100ffa6b1a60000000049454e44ae426082',
  'hex',
);
const PNG_PIC = Buffer.concat([PNG_COVER, Buffer.from([0])]);

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
