// OPL scanner validation for DEF-165 (qa): dump pdf.js operator-list entries
// around the annotation-blue fills of a saved file, with paint-time ca
// attribution (modeling save/restore), so the spec's scanner can be fixed to
// measure the ca at PAINT time, not at the rg token.
// usage: node def_165_1728_opl_diag.cjs <file.pdf> [page=4]
const fs = require('node:fs');
const path = require('node:path');
const napi = require('@napi-rs/canvas');

const ROOT = path.resolve(__dirname, '..', '..');
const FONTS = path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep;

globalThis.DOMMatrix = globalThis.DOMMatrix || napi.DOMMatrix;
globalThis.Path2D = globalThis.Path2D || napi.Path2D;
globalThis.ImageData = globalThis.ImageData || napi.ImageData;

class CanvasFactory {
  create(w, h) {
    const c = napi.createCanvas(Math.max(w, 1), Math.max(h, 1));
    return { canvas: c, context: c.getContext('2d') };
  }
  reset(cc, w, h) { cc.canvas.width = w; cc.canvas.height = h; }
  destroy(cc) { cc.canvas = null; cc.context = null; }
}

function isBlue(r, g, b) {
  return Math.abs(r - 37) < 14 && Math.abs(g - 99) < 14 && Math.abs(b - 235) < 14;
}

async function main() {
  const [file, pageArg] = process.argv.slice(2);
  const pageNum = Number(pageArg || 4);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, standardFontDataUrl: FONTS, canvasFactory: new CanvasFactory() }).promise;
  const page = await doc.getPage(pageNum);
  const opList = await page.getOperatorList();
  const OPS = pdfjs.OPS;
  const NAME = Object.fromEntries(Object.entries(OPS).map(([k, v]) => [v, k]));
  const PAINT_OPS = new Set(['fill', 'eoFill', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke', 'stroke', 'closeStroke']);

  // paint-time model: stack for q/Q, ca from setGState, fill color from setFillRGBColor
  let ca = 1, fill = null;
  const stack = [];
  const events = [];
  for (let i = 0; i < opList.fnArray.length; i++) {
    const name = NAME[opList.fnArray[i]];
    const args = opList.argsArray[i];
    if (name === 'setGState' && Array.isArray(args[0])) {
      for (const pair of args[0]) {
        if (Array.isArray(pair) && pair[0] === 'ca' && typeof pair[1] === 'number') ca = pair[1];
      }
    } else if (name === 'setFillRGBColor') {
      const r = args[0] <= 1 ? args[0] * 255 : args[0];
      const g = args[1] <= 1 ? args[1] * 255 : args[1];
      const b = args[2] <= 1 ? args[2] * 255 : args[2];
      fill = { r, g, b };
      if (isBlue(r, g, b)) events.push({ seq: i, kind: 'setFillRGBColor(blue)', ca, op: name });
    } else if (name === 'save') {
      stack.push({ ca, fill });
    } else if (name === 'restore') {
      const s = stack.pop();
      if (s) { ca = s.ca; fill = s.fill; }
    } else if (PAINT_OPS.has(name)) {
      const blue = fill && isBlue(fill.r, fill.g, fill.b);
      events.push({ seq: i, kind: `paint:${name}`, ca, fillBlue: !!(fill && isBlue(fill.r, fill.g, fill.b)), fill });
    }
  }
  const n = opList.fnArray.length;
  process.stdout.write(`[OPL] total ops=${n}; events:\n`);
  for (const e of events) {
    process.stdout.write(`  seq=${e.seq} ${e.kind} ca=${e.ca}${e.fill ? ` fill=${JSON.stringify(e.fill)}` : ''}\n`);
  }
  // context window around the first blue event
  const firstBlue = events.find((e) => e.kind.includes('blue'));
  if (firstBlue) {
    process.stdout.write(`[OPL] context around seq=${firstBlue.seq}:\n`);
    for (let i = Math.max(0, firstBlue.seq - 12); i < Math.min(n, firstBlue.seq + 12); i++) {
      process.stdout.write(`  [${i}] ${NAME[opList.fnArray[i]]} ${JSON.stringify(opList.argsArray[i]).slice(0, 90)}\n`);
    }
  }
}

main().catch((e) => { process.stderr.write(`${e && e.stack || e}\n`); process.exit(1); });