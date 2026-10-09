// TFL-1298 — generator for the rotated / cropped / mixed-media geometry
// fixture used by e2e/tfl1298_preview_geometry.spec.cjs.
//
// Produces test-fixtures/tfl1298-geometry.pdf with four pages whose DISPLAYED
// geometry (CropBox plus /Rotate, exactly what pdf.js renders) differs:
//   1  Letter portrait  612x792, no rotation            -> portrait
//   2  Letter landscape 792x612, no rotation            -> landscape
//   3  Letter portrait  612x792, /Rotate 90             -> landscape (rotation)
//   4  A4 with a reduced CropBox 515x762                -> portrait (crop)
//
// Run: node test-fixtures/tfl1298_make_geometry.cjs
const path = require('node:path');
const fs = require('node:fs');
const { PDFDocument, StandardFonts, degrees } = require('@cantoo/pdf-lib');

async function main() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const label = (page, size, text) => {
    const [w, h] = size;
    page.drawText(text, { x: 24, y: h - 40, size: 20, font });
    page.drawRectangle({ x: 24, y: 40, width: w - 48, height: h - 120, borderWidth: 2, borderColor: undefined });
  };

  const p1 = doc.addPage([612, 792]);
  label(p1, [612, 792], 'Page 1 portrait Letter');

  const p2 = doc.addPage([792, 612]);
  label(p2, [792, 612], 'Page 2 landscape Letter');

  const p3 = doc.addPage([612, 792]);
  label(p3, [612, 792], 'Page 3 rotated 90');
  p3.setRotation(degrees(90));

  const p4 = doc.addPage([595.28, 841.89]);
  label(p4, [595.28, 841.89], 'Page 4 cropped A4');
  p4.setCropBox(40, 40, 515, 762);

  const bytes = await doc.save();
  const out = path.join(__dirname, 'tfl1298-geometry.pdf');
  fs.writeFileSync(out, bytes);
  console.log(`wrote ${out} (${bytes.length} bytes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
