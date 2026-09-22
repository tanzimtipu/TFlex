// ADV phase-33 fixture: 16 pages, each visually unique (big page number +
// unique background colour), so a produced sheet's embedded page images are
// distinguishable by hash for print parity checks.
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= 16; i += 1) {
    const page = doc.addPage([612, 792]);
    const h = ((i * 37) % 360) / 360;
    const s = 0.55;
    const l = 0.85;
    const c = (n) => {
      const k = (n + h) * 6;
      const x = s * (1 - Math.abs((k % 2) - 1)) * l;
      const m = k % 1;
      const r = x * (1 - m) + l * m;
      const g = x * (1 - m);
      const b = x * (1 - m) + x * m;
      return rgb(Math.min(1, r), Math.min(1, g), Math.min(1, b));
    };
    page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: c(0) });
    page.drawRectangle({ x: 40, y: 40, width: 532, height: 712, color: rgb(1, 1, 1) });
    page.drawText(`PAGE ${String(i).padStart(2, '0')}`, {
      x: 90,
      y: 400,
      size: 120,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText(`unique-${i}-token`, { x: 90, y: 300, size: 36, font, color: rgb(0.2, 0, 0.6) });
  }
  const bytes = await doc.save();
  const out = path.join(__dirname, 'pages16.pdf');
  fs.writeFileSync(out, bytes);
  console.log(`wrote ${out} bytes=${bytes.length}`);
})();