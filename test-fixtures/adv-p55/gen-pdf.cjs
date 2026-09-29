// Build a 1-page PDF whose text layer is a single long line (>32767 chars with
// no newline or double space) to drive the xlsx export writer's cell ceiling.
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const { PDFDocument, StandardFonts, rgb } = require('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([612, 792]);
  const line = 'L'.repeat(40000); // no newline, no two consecutive spaces
  page.drawText(line, { x: 4, y: 700, size: 6, font, color: rgb(0, 0, 0) });
  const bytes = await doc.save();
  fs.writeFileSync(path.join(__dirname, 'pdf-long-line-40000.pdf'), Buffer.from(bytes));
  console.log(`pdf-long-line-40000.pdf written: ${bytes.length} bytes`);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
