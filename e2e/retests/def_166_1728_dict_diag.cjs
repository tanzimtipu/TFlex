// DEF-166 diag (v1.7.28): what does the SAVED round-trip file actually carry,
// and what does a third-party pdf.js render of it show at the annotation spots?
// 1) raw pdf-lib dump of the page-4 /FreeText dicts (/Rect /DA /AP presence +
//    decoded /AP /N stream head),
// 2) pdf.js render at scale 2, crops at both annotation regions (pt space,
//    derived from /Rect), PNG evidence.
// usage: node def_166_1728_dict_diag.cjs <saved.pdf> <tag>
const fs = require('node:fs');
const path = require('node:path');
const napi = require('@napi-rs/canvas');
const { PDFDocument, PDFName, PDFArray, PDFRawStream, decodePDFRawStream } = require('pdf-lib');

const ROOT = path.resolve(__dirname, '..', '..');
const FONTS = path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep;
const SHOTS = path.join(ROOT, 'screenshots');

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

function dictName(a, key) {
  const v = a.get(PDFName.of(key));
  if (!v) return null;
  try { return typeof v.asString === 'function' ? v.asString() : String(v); } catch (_) { return String(v); }
}
function nums(v) {
  if (!(v instanceof PDFArray)) return null;
  const out = [];
  for (let i = 0; i < v.size(); i++) {
    const e = v.get(i);
    out.push(typeof e.asNumber === 'function' ? e.asNumber() : e);
  }
  return out;
}

async function main() {
  const [file, tag] = process.argv.slice(2);
  const bytes = fs.readFileSync(file);

  // 1) raw dicts
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const ctx = doc.context;
  const page = doc.getPages()[3];
  const annotsRef = page.node.get(PDFName.of('Annots'));
  const annots = ctx.lookup(annotsRef);
  const regions = [];
  for (let i = 0; i < annots.size(); i++) {
    const a = ctx.lookup(annots.get(i));
    const subtype = dictName(a, 'Subtype') || '?';
    const rect = nums(a.get(PDFName.of('Rect')));
    const da = dictName(a, 'DA');
    const contents = (dictName(a, 'Contents') || '').slice(0, 50);
    let apInfo = null;
    const ap = a.get(PDFName.of('AP'));
    if (ap) {
      const apDict = ctx.lookup(ap);
      const nRef = apDict && apDict.get(PDFName.of('N'));
      if (nRef) {
        const n = ctx.lookup(nRef);
        if (n instanceof PDFRawStream) {
          let content = '';
          try { content = decodePDFRawStream(n).decode().toString('latin1'); }
          catch (_) { content = '<decode failed>'; }
          apInfo = { stream: true, bytes: content.length, head: content.replace(/\s+/g, ' ').slice(0, 700) };
        } else {
          apInfo = { stream: false, note: String(n) };
        }
      }
    }
    process.stdout.write(`[DICT] ${tag} ann[${i}] /Subtype ${subtype} /Rect [${(rect || []).map((n) => +n.toFixed(2)).join(', ')}]`
      + ` /DA=${JSON.stringify(da)} /Contents=${JSON.stringify(contents)} /AP=${JSON.stringify(apInfo)}\n`);
    if (rect) {
      const pageH = 792;
      regions.push({
        name: `${subtype.replace('/', '')}-${i}`,
        // PDF rect -> top-down pt (y down from page top)
        x: rect[0], y: pageH - rect[3], w: rect[2] - rect[0], h: rect[3] - rect[1],
      });
    }
  }

  // 2) pdf.js render at scale 2 + crops (pad 6pt around each rect)
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(bytes);
  const pdf = await pdfjs.getDocument({ data, isEvalSupported: false, standardFontDataUrl: FONTS, canvasFactory: new CanvasFactory() }).promise;
  const pg = await pdf.getPage(4);
  const SCALE = 2;
  const vp = pg.getViewport({ scale: SCALE });
  const f = new CanvasFactory();
  const cc = f.create(Math.ceil(vp.width), Math.ceil(vp.height));
  await pg.render({ canvasContext: cc.context, viewport: vp, canvasFactory: f }).promise;
  fs.writeFileSync(path.join(SHOTS, `def-166-1728-diag-${tag}-p4-scale2.png`), cc.canvas.toBuffer('image/png'));
  for (const r of regions) {
    const x0 = Math.max(0, Math.floor((r.x - 6) * SCALE));
    const y0 = Math.max(0, Math.floor((r.y - 6) * SCALE));
    const w = Math.min(cc.canvas.width - x0, Math.ceil((r.w + 12) * SCALE));
    const h = Math.min(cc.canvas.height - y0, Math.ceil((r.h + 12) * SCALE));
    const crop = napi.createCanvas(w, h);
    crop.getContext('2d').drawImage(cc.canvas, x0, y0, w, h, 0, 0, w, h);
    fs.writeFileSync(path.join(SHOTS, `def-166-1728-diag-${tag}-${r.name}-scale2.png`), crop.toBuffer('image/png'));
    process.stdout.write(`[CROP] ${r.name} at (${x0},${y0}) ${w}x${h}\n`);
  }
  process.stdout.write(`[TP-JSON] ${JSON.stringify({ regions })}\n`);
}

main().catch((e) => { process.stderr.write(`${e && e.stack || e}\n`); process.exit(1); });