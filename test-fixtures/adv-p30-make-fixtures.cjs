// Generate hostile page-size fixtures for the P30 raster-bound attack.
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts, rgb } = require('@cantoo/pdf-lib');

const OUT = __dirname;

async function main() {
  const info = {};
  // 6000x6000pt page (100x100in): exceeds MAX_PRINT_PIXELS at both 200 and 48 dpi.
  {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([6000, 6000]);
    page.drawText('GIANT 6000x6000', { x: 200, y: 3000, size: 300, font, color: rgb(0, 0, 0) });
    const bytes = await doc.save();
    fs.writeFileSync(path.join(OUT, 'adv-giant-page.pdf'), bytes);
    info.giant = bytes.length;
  }
  // Rotated 90 page, 300x500pt.
  {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([300, 500]);
    page.setRotation({ type: 'degrees', angle: 90 });
    page.drawText('ROTATED 90', { x: 30, y: 250, size: 24, font, color: rgb(0, 0, 0) });
    const bytes = await doc.save();
    fs.writeFileSync(path.join(OUT, 'adv-rotated-90.pdf'), bytes);
    info.rotated = bytes.length;
  }
  // Degenerate zero-size page.
  {
    const doc = await PDFDocument.create();
    doc.addPage([0, 0]);
    const bytes = await doc.save();
    fs.writeFileSync(path.join(OUT, 'adv-zero-size-page.pdf'), bytes);
    info.zero = bytes.length;
  }
  console.log('GENERATED', JSON.stringify(info));
}

main().catch((e) => { console.error('GEN_FATAL', e); process.exit(1); });