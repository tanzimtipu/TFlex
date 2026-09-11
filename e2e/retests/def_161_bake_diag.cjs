// One-off diagnostic: parse the saved callout PDF and dump every text item
// on the callout's page (page 4) with its PDF-space position, so the baked
// callout text position can be compared against the annotation geometry
// (engine rects[0] top-left = 495.42, 348.73 pt top-down; page = 612x792).
const path = require('node:path');
const fs = require('node:fs');

async function main() {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) throw new Error(`usage: node def_161_bake_diag.cjs <saved.pdf>`);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  process.stdout.write(`pages=${doc.numPages}\n`);
  const page = await doc.getPage(4);
  const vp = page.getViewport({ scale: 1 });
  process.stdout.write(`page4 viewport=${vp.width}x${vp.height}\n`);
  const tc = await page.getTextContent();
  for (const item of tc.items) {
    const s = (item.str || '').trim();
    if (!s) continue;
    const t = item.transform;
    // pdf.js transform: [a, b, c, d, e, f]; e,f = position in PDF space (y up from bottom)
    process.stdout.write(`${JSON.stringify({ str: s.slice(0, 60), x: +t[4].toFixed(2), y: +t[5].toFixed(2), font: item.fontName })}\n`);
  }
  const anns = await page.getAnnotations();
  process.stdout.write(`page4 annotations=${anns.length}\n`);
  for (const a of anns) {
    process.stdout.write(`${JSON.stringify({ type: a.subtype || a.type, rect: a.rect, contents: (a.contents || '').slice(0, 80), appearance: !!a.appearance })}\n`);
  }
}
main().catch((e) => { process.stderr.write(`${e && e.stack || e}\n`); process.exit(1); });