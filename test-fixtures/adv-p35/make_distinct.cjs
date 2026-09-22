// ADV phase-35 fixture: 6 pages with a huge distinct number so page order is
// pixel-verifiable. Also a 3-page variant.
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

(async () => {
  const dir = __dirname;
  for (const [name, n, landscape] of [['distinct6.pdf', 6, false], ['distinct3.pdf', 3, false]]) {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    for (let i = 1; i <= n; i += 1) {
      const page = doc.addPage([612, 792]);
      // Unique barcode-like block: a big number plus a filled bar whose position
      // and width encode the page, so even pages of similar darkness differ.
      page.drawText(String(i), { x: 60, y: 560, size: 180, font, color: rgb(0, 0, 0) });
      page.drawText(`PAGE-${i}`, { x: 60, y: 500, size: 28, font, color: rgb(0.2, 0.2, 0.2) });
      for (let b = 0; b < i; b += 1) {
        page.drawRectangle({ x: 60 + b * 80, y: 120, width: 60, height: 240, color: rgb(0, 0, 0) });
      }
    }
    const bytes = await doc.save();
    fs.writeFileSync(path.join(dir, name), bytes);
    console.log(`wrote ${name} (${n} pages, ${bytes.length} bytes)`);
  }
})();
