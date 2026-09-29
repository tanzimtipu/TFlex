// Phase 55 QA fixture builder. Writes real office-format inputs under
// test-fixtures/phase55/ so the e2e spec imports genuine files (not in-test
// bytes). Run: node test-fixtures/phase55/build-fixtures.cjs
//
// Formats:
//   sample.docx        docx library (2 heading levels, styled runs, list, table, image)
//   sample.odt         fflate ZIP (equivalent content)
//   legacy.doc         hand-built OLE/CFB with a WordDocument stream
//   legacy.ppt         hand-built OLE/CFB with a PowerPoint Document stream
//   sample.xlsx        SheetJS (3 sheets, formula+cached value, date, wide table)
//   rows20000.xlsx     SheetJS (single sheet, 20,000 body rows)
//   rows_over_ceiling.xlsx  SheetJS (single sheet, 100,001 body rows)
//   sample.pptx        pptxgenjs (2 slides, image on slide 1, notes)
//   image-only.pdf     pdf-lib (page 1 empty, page 2 image-only)
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT = __dirname;

// ---------------------------------------------------------------------------
// Minimal PNG encoder (solid colour) so fixtures need no binary asset.
// ---------------------------------------------------------------------------
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function makePng(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      raw[row + 1 + x * 3] = rgb[0];
      raw[row + 2 + x * 3] = rgb[1];
      raw[row + 3 + x * 3] = rgb[2];
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const RED_PNG = makePng(120, 60, [200, 40, 40]);
fs.writeFileSync(path.join(OUT, 'red.png'), RED_PNG);

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------
async function buildDocx() {
  const docx = require('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, ImageRun, AlignmentType } = docx;
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: 'Quarterly Report', heading: HeadingLevel.HEADING_1 }),
        new Paragraph({ text: 'Financial Summary', heading: HeadingLevel.HEADING_2 }),
        new Paragraph({
          children: [
            new TextRun({ text: 'Revenue', bold: true }),
            new TextRun({ text: ' grew by ' }),
            new TextRun({ text: '12 percent', italics: true }),
            new TextRun({ text: ' this quarter.' }),
          ],
        }),
        new Paragraph({ text: 'North region', bullet: { level: 0 } }),
        new Paragraph({ text: 'South region', bullet: { level: 0 } }),
        new Paragraph({ text: 'East region', bullet: { level: 0 } }),
        new Table({
          rows: [
            new TableRow({ children: [new TableCell({ children: [new Paragraph('Region')] }), new TableCell({ children: [new Paragraph('Sales')] })] }),
            new TableRow({ children: [new TableCell({ children: [new Paragraph('North')] }), new TableCell({ children: [new Paragraph('1200')] })] }),
            new TableRow({ children: [new TableCell({ children: [new Paragraph('South')] }), new TableCell({ children: [new Paragraph('980')] })] }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({ type: 'png', data: RED_PNG, transformation: { width: 120, height: 60 } })],
        }),
      ],
    }],
  });
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(path.join(OUT, 'sample.docx'), buf);
  return buf.length;
}

// ---------------------------------------------------------------------------
// ODT (fflate ZIP)
// ---------------------------------------------------------------------------
function buildOdt() {
  const { zipSync, strToU8 } = require('fflate');
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" office:version="1.2">
<office:body><office:text>
<text:h text:outline-level="1">Quarterly Report</text:h>
<text:h text:outline-level="2">Financial Summary</text:h>
<text:p>Revenue grew by <text:span text:style-name="Italic">12 percent</text:span> this quarter.</text:p>
<text:list><text:list-item><text:p>North region</text:p></text:list-item><text:list-item><text:p>South region</text:p></text:list-item><text:list-item><text:p>East region</text:p></text:list-item></text:list>
<table:table>
<table:table-row><table:table-cell><text:p>Region</text:p></table:table-cell><table:table-cell><text:p>Sales</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell><text:p>North</text:p></table:table-cell><table:table-cell><text:p>1200</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell><text:p>South</text:p></table:table-cell><table:table-cell><text:p>980</text:p></table:table-cell></table:table-row>
</table:table>
<text:p><draw:frame><draw:image xlink:href="Pictures/red.png"/></draw:frame></text:p>
</office:text></office:body></office:document-content>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2">
<office:styles>
<style:style style:name="Bold" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="Italic" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
</office:styles></office:document-styles>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="Pictures/red.png" manifest:media-type="image/png"/>
</manifest:manifest>`;
  const zip = zipSync({
    mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
    'META-INF/manifest.xml': strToU8(manifest),
    'content.xml': strToU8(content),
    'styles.xml': strToU8(styles),
    'Pictures/red.png': new Uint8Array(RED_PNG),
  });
  fs.writeFileSync(path.join(OUT, 'sample.odt'), Buffer.from(zip));
  return zip.length;
}

// ---------------------------------------------------------------------------
// Minimal OLE/CFB writer: one stream, 512-byte sectors, stream >= 4096 bytes
// so it lives on the regular FAT (no mini-stream needed).
// ---------------------------------------------------------------------------
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const FATSECT = 0xfffffffd;

function buildCfb(streamName, streamBytes) {
  const SECTOR = 512;
  const padded = Buffer.alloc(Math.max(4096, Math.ceil(streamBytes.length / SECTOR) * SECTOR));
  Buffer.from(streamBytes).copy(padded);
  const streamSectors = padded.length / SECTOR;

  // Layout: sector 0 = FAT, sector 1 = directory, sectors 2.. = stream.
  const firstStreamSector = 2;
  const totalSectors = firstStreamSector + streamSectors;
  const file = Buffer.alloc((totalSectors + 1) * SECTOR);

  // Header.
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(file, 0);
  file.writeUInt16LE(0x003e, 0x18); // minor version
  file.writeUInt16LE(0x0003, 0x1a); // major version
  file.writeUInt16LE(0xfffe, 0x1c); // byte order
  file.writeUInt16LE(9, 0x1e); // sector shift -> 512
  file.writeUInt16LE(6, 0x20); // mini sector shift -> 64
  file.writeUInt32LE(1, 0x2c); // number of FAT sectors
  file.writeUInt32LE(1, 0x30); // first directory sector
  file.writeUInt32LE(4096, 0x38); // mini stream cutoff
  file.writeUInt32LE(ENDOFCHAIN, 0x3c); // first mini FAT sector
  file.writeUInt32LE(0, 0x40); // number of mini FAT sectors
  file.writeUInt32LE(ENDOFCHAIN, 0x44); // first DIFAT sector
  file.writeUInt32LE(0, 0x48); // number of DIFAT sectors
  for (let i = 0; i < 109; i += 1) file.writeUInt32LE(FREESECT, 0x4c + i * 4);
  file.writeUInt32LE(0, 0x4c); // DIFAT[0] = FAT sector 0

  // FAT (sector 0).
  const fatOff = SECTOR;
  for (let i = 0; i < SECTOR / 4; i += 1) file.writeUInt32LE(FREESECT, fatOff + i * 4);
  file.writeUInt32LE(FATSECT, fatOff + 0 * 4);
  file.writeUInt32LE(ENDOFCHAIN, fatOff + 1 * 4);
  for (let s = 0; s < streamSectors; s += 1) {
    const sector = firstStreamSector + s;
    const next = s === streamSectors - 1 ? ENDOFCHAIN : sector + 1;
    file.writeUInt32LE(next, fatOff + sector * 4);
  }

  // Directory (sector 1): root entry + one stream entry.
  const dirOff = 2 * SECTOR;
  function writeDirEntry(offset, name, type, startSector, size) {
    const nameBuf = Buffer.from(name, 'utf16le');
    nameBuf.copy(file, offset);
    file.writeUInt16LE(nameBuf.length + 2, offset + 64);
    file[offset + 66] = type;
    file[offset + 67] = 1; // black
    file.writeUInt32LE(FREESECT, offset + 68);
    file.writeUInt32LE(FREESECT, offset + 72);
    file.writeUInt32LE(FREESECT, offset + 76);
    file.writeUInt32LE(startSector, offset + 116);
    file.writeUInt32LE(size, offset + 120);
    file.writeUInt32LE(0, offset + 124);
  }
  writeDirEntry(dirOff, 'Root Entry', 5, ENDOFCHAIN, 0);
  writeDirEntry(dirOff + 128, streamName, 2, firstStreamSector, padded.length);

  // Stream sectors.
  padded.copy(file, (firstStreamSector + 1) * SECTOR);
  return file;
}

// A minimal Word FIB: magic 0xa5ec, fExtChar (UTF-16 text), fcMin/fcMac.
function buildLegacyDoc() {
  const text = 'Legacy Word Document\nThis is a recovered paragraph.\nSecond line of text.';
  const textBytes = Buffer.from(text, 'utf16le');
  const stream = Buffer.alloc(4096);
  stream.writeUInt16LE(0xa5ec, 0); // FIB magic
  stream.writeUInt16LE(0x1000, 0x0a); // flags: fExtChar (UTF-16)
  stream.writeUInt32LE(512, 0x18); // fcMin
  stream.writeUInt32LE(512 + textBytes.length, 0x1c); // fcMac
  textBytes.copy(stream, 512);
  const cfb = buildCfb('WordDocument', stream);
  fs.writeFileSync(path.join(OUT, 'legacy.doc'), cfb);
  return cfb.length;
}

// A minimal PowerPoint Document stream: one TextCharsAtom (0x0fa0, UTF-16LE).
function buildLegacyPpt() {
  const text = 'Legacy PowerPoint Slide Title\nBullet one\nBullet two';
  const textBytes = Buffer.from(text, 'utf16le');
  const record = Buffer.alloc(8 + textBytes.length);
  record.writeUInt16LE(0x0000, 0); // recVer 0 (not a container)
  record.writeUInt16LE(0x0fa0, 2); // TextCharsAtom
  record.writeUInt32LE(textBytes.length, 4);
  textBytes.copy(record, 8);
  const stream = Buffer.alloc(4096);
  record.copy(stream, 0);
  const cfb = buildCfb('PowerPoint Document', stream);
  fs.writeFileSync(path.join(OUT, 'legacy.ppt'), cfb);
  return cfb.length;
}

// ---------------------------------------------------------------------------
// XLSX fixtures (SheetJS)
// ---------------------------------------------------------------------------
function buildXlsx() {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();

  // Sheet 1: Sales — header, a formula with a cached value, a date, a wide
  // table long enough to span more than one printed page (header repetition).
  const sales = [
    ['Region', 'Q1', 'Q2', 'Q3', 'Q4', 'Total', 'Growth', 'Owner', 'Code', 'Notes'],
    ['North', 100, 110, 120, 130, null, 0.12, 'Ada', 'N-01', 'steady'],
    ['South', 90, 95, 100, 105, null, 0.08, 'Grace', 'S-02', 'rising'],
    ['East', 80, 85, 90, 95, null, 0.05, 'Alan', 'E-03', 'flat'],
  ];
  for (let i = 0; i < 60; i += 1) {
    sales.push([`R${i}`, i, i + 1, i + 2, i + 3, null, 0.01, `Owner ${i}`, `C-${i}`, `note ${i}`]);
  }
  const ws = XLSX.utils.aoa_to_sheet(sales);
  // Formula cell F2 with a CACHED result (never the formula string in output).
  ws.F2 = { t: 'n', v: 460, f: 'SUM(B2:E2)' };
  ws.F3 = { t: 'n', v: 390, f: 'SUM(B3:E3)' };
  ws.F4 = { t: 'n', v: 350, f: 'SUM(B4:E4)' };
  // A date cell with its own number format.
  ws.H2 = { t: 'n', v: 46234, z: 'yyyy-mm-dd' }; // 2026-08-01
  ws['!ref'] = `A1:J${sales.length}`;
  XLSX.utils.book_append_sheet(wb, ws, 'Sales');

  const inv = [['Item', 'Qty'], ['Widget', 12], ['Gadget', 7], ['Gizmo', 3]];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(inv), 'Inventory');

  const notes = [['Note'], ['First note'], ['Second note']];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(notes), 'Notes');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  fs.writeFileSync(path.join(OUT, 'sample.xlsx'), buf);
  return buf.length;
}

function buildRowsXlsx(filename, bodyRows) {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  const rows = [['id', 'name', 'value']];
  for (let i = 0; i < bodyRows; i += 1) rows.push([i, `name ${i}`, i * 3]);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Big');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  fs.writeFileSync(path.join(OUT, filename), buf);
  return buf.length;
}

// ---------------------------------------------------------------------------
// PPTX fixture (pptxgenjs): 2 slides, image on slide 1, notes on both.
// ---------------------------------------------------------------------------
async function buildPptx() {
  const PptxGenJS = require('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'WIDE', width: 10, height: 5.625 });
  pptx.layout = 'WIDE';
  const s1 = pptx.addSlide();
  s1.addText('Slide One Title', { x: 0.5, y: 0.5, w: 9, h: 1, fontSize: 28 });
  s1.addImage({ data: `image/png;base64,${RED_PNG.toString('base64')}`, x: 0.5, y: 1.8, w: 3, h: 1.5 });
  s1.addNotes('Speaker notes for slide one.');
  const s2 = pptx.addSlide();
  s2.addText('Slide Two Title', { x: 0.5, y: 0.5, w: 9, h: 1, fontSize: 28 });
  s2.addText('Second slide body text.', { x: 0.5, y: 1.8, w: 9, h: 1, fontSize: 18 });
  s2.addNotes('Speaker notes for slide two.');
  const buf = await pptx.write({ outputType: 'nodebuffer' });
  fs.writeFileSync(path.join(OUT, 'sample.pptx'), Buffer.from(buf));
  return buf.length;
}

// ---------------------------------------------------------------------------
// image-only.pdf: page 1 empty, page 2 image-only (for criterion 8).
// ---------------------------------------------------------------------------
async function buildImageOnlyPdf() {
  const { PDFDocument } = require('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]); // page 1: empty
  const page2 = doc.addPage([595, 842]);
  const img = await doc.embedPng(RED_PNG);
  page2.drawImage(img, { x: 100, y: 300, width: 300, height: 150 });
  const bytes = await doc.save();
  fs.writeFileSync(path.join(OUT, 'image-only.pdf'), Buffer.from(bytes));
  return bytes.length;
}

// ---------------------------------------------------------------------------
// Extra spreadsheets: a real BIFF8 .xls and a hand-built ODF .ods.
// ---------------------------------------------------------------------------
function buildExtraSpreadsheets() {
  const XLSX = require('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Item', 'Qty'], ['Widget', 12], ['Gadget', 7]]), 'Sheet1');
  const xls = XLSX.write(wb, { type: 'buffer', bookType: 'xls' });
  fs.writeFileSync(path.join(OUT, 'sample.xls'), xls);

  const { zipSync, strToU8 } = require('fflate');
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" office:version="1.2">
<office:body><office:spreadsheet>
<table:table table:name="Sheet1">
<table:table-row><table:table-cell office:value-type="string"><text:p>Item</text:p></table:table-cell><table:table-cell office:value-type="string"><text:p>Qty</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell office:value-type="string"><text:p>Widget</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="12"><text:p>12</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell office:value-type="string"><text:p>Gadget</text:p></table:table-cell><table:table-cell office:value-type="float" office:value="7"><text:p>7</text:p></table:table-cell></table:table-row>
</table:table>
</office:spreadsheet></office:body></office:document-content>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.2"><office:styles/></office:document-styles>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.spreadsheet"/>
<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`;
  const zip = zipSync({
    mimetype: [strToU8('application/vnd.oasis.opendocument.spreadsheet'), { level: 0 }],
    'META-INF/manifest.xml': strToU8(manifest),
    'content.xml': strToU8(content),
    'styles.xml': strToU8(styles),
  });
  fs.writeFileSync(path.join(OUT, 'sample.ods'), Buffer.from(zip));
  return { 'sample.xls': xls.length, 'sample.ods': zip.length };
}

// ---------------------------------------------------------------------------
// Hostile inputs: zip bombs, truncated archives, misnamed containers, a
// truncated slide XML.
// ---------------------------------------------------------------------------
function buildHostile() {
  const { zipSync, strToU8, unzipSync } = require('fflate');
  const out = {};
  const HUGE = new Uint8Array(130 * 1024 * 1024); // 130 MiB of zeros
  HUGE.fill(0x41);

  const bombOdt = zipSync({
    mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
    'content.xml': HUGE,
    'styles.xml': strToU8('<x/>'),
  });
  fs.writeFileSync(path.join(OUT, 'bomb.odt'), Buffer.from(bombOdt));
  out['bomb.odt'] = bombOdt.length;

  const bombOds = zipSync({
    mimetype: [strToU8('application/vnd.oasis.opendocument.spreadsheet'), { level: 0 }],
    'content.xml': HUGE,
    'styles.xml': strToU8('<x/>'),
  });
  fs.writeFileSync(path.join(OUT, 'bomb.ods'), Buffer.from(bombOds));
  out['bomb.ods'] = bombOds.length;

  const bombPptx = zipSync({
    'ppt/presentation.xml': strToU8('<p:presentation/>'),
    'ppt/slides/slide1.xml': HUGE,
  });
  fs.writeFileSync(path.join(OUT, 'bomb.pptx'), Buffer.from(bombPptx));
  out['bomb.pptx'] = bombPptx.length;

  // Truncated archives (half the bytes).
  for (const [src, dst] of [['sample.odt', 'truncated.odt'], ['sample.ods', 'truncated.ods'], ['sample.pptx', 'truncated.pptx']]) {
    const bytes = fs.readFileSync(path.join(OUT, src));
    const half = bytes.subarray(0, Math.floor(bytes.length / 2));
    fs.writeFileSync(path.join(OUT, dst), half);
    out[dst] = half.length;
  }

  // Misnamed containers: content decides, not the extension.
  fs.copyFileSync(path.join(OUT, 'sample.odt'), path.join(OUT, 'misnamed.docx'));
  fs.copyFileSync(path.join(OUT, 'sample.docx'), path.join(OUT, 'misnamed.odt'));
  out['misnamed.docx'] = fs.statSync(path.join(OUT, 'misnamed.docx')).size;
  out['misnamed.odt'] = fs.statSync(path.join(OUT, 'misnamed.odt')).size;

  // A PPTX whose second slide XML is truncated.
  const zip = unzipSync(new Uint8Array(fs.readFileSync(path.join(OUT, 'sample.pptx'))));
  const slide2 = zip['ppt/slides/slide2.xml'];
  if (slide2) zip['ppt/slides/slide2.xml'] = slide2.subarray(0, Math.floor(slide2.length / 2));
  const rebuilt = zipSync(zip, { level: 0 });
  fs.writeFileSync(path.join(OUT, 'truncated-slide.pptx'), Buffer.from(rebuilt));
  out['truncated-slide.pptx'] = rebuilt.length;
  return out;
}

async function main() {
  const results = {};
  results['sample.docx'] = await buildDocx();
  results['legacy.doc'] = buildLegacyDoc();
  results['legacy.ppt'] = buildLegacyPpt();
  results['sample.xlsx'] = buildXlsx();
  results['rows20000.xlsx'] = buildRowsXlsx('rows20000.xlsx', 20000);
  results['rows_over_ceiling.xlsx'] = buildRowsXlsx('rows_over_ceiling.xlsx', 100001);
  results['sample.pptx'] = await buildPptx();
  results['image-only.pdf'] = await buildImageOnlyPdf();
  Object.assign(results, buildExtraSpreadsheets());
  Object.assign(results, buildHostile());
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
