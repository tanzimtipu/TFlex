// Third-party witness for DEF-165 (qa, v1.7.27): render the SAVED file's page 4
// with plain pdfjs-dist (the same engine Chrome/Firefox use) in a Node process,
// completely outside TFlex, and measure pixels inside the rect/ellipse interiors:
//   - opaqueBlueFrac: fraction of pixels near the annotation blue #2563eb.
//       Solid /IC interior paint -> ~1.0. Translucent (ca 0.1) fill -> ~0.
//   - textKeptFrac: of the pristine page's dark text pixels under the shape,
//       how many stay dark in the saved render. Opaque paint -> ~0. Alpha fill -> ~1.
//   - ring delta: near-blue pixels on the shape border band (saved - pristine)
//       proves the third-party pipeline actually painted the annotations.
// Also dumps the raw Square/Circle dicts (/IC, /AP /N, ExtGState /ca, content ops)
// and pdf.js's own operator-list fill ops with their ExtGState /ca.
// Writes full-page + interior crop PNGs, then prints one JSON line "[TP-JSON] {...}".
//
// usage: node def_165_166_thirdparty.cjs <saved.pdf> <baseline.pdf> <shotsDir> [page]

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const napi = require('@napi-rs/canvas');
const { PDFDocument, PDFName, PDFArray, PDFRawStream, decodePDFRawStream } = require('pdf-lib');

const ROOT = path.resolve(__dirname, '..', '..');
const FONTS = path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep;
const SCALE = 2;

// pdf.js in Node needs these DOM globals; @napi-rs/canvas provides them.
globalThis.DOMMatrix = globalThis.DOMMatrix || napi.DOMMatrix;
globalThis.Path2D = globalThis.Path2D || napi.Path2D;
globalThis.ImageData = globalThis.ImageData || napi.ImageData;

class CanvasFactory {
  create(w, h) {
    const c = napi.createCanvas(Math.max(w, 1), Math.max(h, 1));
    return { canvas: c, context: c.getContext('2d') };
  }
  reset(cc, w, h) {
    cc.canvas.width = w;
    cc.canvas.height = h;
  }
  destroy(cc) {
    cc.canvas = null;
    cc.context = null;
  }
}

function isNearBlue(r, g, b) {
  return Math.abs(r - 37) < 50 && Math.abs(g - 99) < 50 && Math.abs(b - 235) < 50;
}
function lum(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function loadPdfjsDoc(file) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    standardFontDataUrl: FONTS,
    canvasFactory: new CanvasFactory(),
  }).promise;
  return { pdfjs, doc };
}

async function renderPage(doc, pageNum, scale) {
  const page = await doc.getPage(pageNum);
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: SCALE });
  const f = new CanvasFactory();
  const cc = f.create(Math.ceil(vp.width), Math.ceil(vp.height));
  await page.render({ canvasContext: cc.context, viewport: vp, canvasFactory: f }).promise;
  const img = cc.context.getImageData(0, 0, cc.canvas.width, cc.canvas.height);
  return {
    canvas: cc.canvas,
    w: cc.canvas.width,
    h: cc.canvas.height,
    data: img.data,
    scale: SCALE,
    pageW: vp1.width,
    pageH: vp1.height,
  };
}

// ---------------------------------------------------------------------------
// raw dict dump (pdf-lib) of the saved file's Square/Circle annotations
// ---------------------------------------------------------------------------
function dictName(a, key) {
  const v = a.get(PDFName.of(key));
  if (!v) return null;
  try { return v.asString ? v.asString() : String(v); } catch (_) { return String(v); }
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

async function dumpShapeAnnots(file, pageNum) {
  const doc = await PDFDocument.load(fs.readFileSync(file), { ignoreEncryption: true });
  const ctx = doc.context;
  const page = doc.getPages()[pageNum - 1];
  const annotsRef = page.node.get(PDFName.of('Annots'));
  if (!annotsRef) return [];
  const annots = ctx.lookup(annotsRef);
  const out = [];
  for (let i = 0; i < annots.size(); i++) {
    const a = ctx.lookup(annots.get(i));
    const subtype = dictName(a, 'Subtype') || '?';
    if (subtype !== '/Square' && subtype !== '/Circle') continue;
    const rect = nums(a.get(PDFName.of('Rect')));
    const ic = nums(a.get(PDFName.of('IC')));
    let apN = null;
    const ap = a.get(PDFName.of('AP'));
    if (ap) {
      const apDict = ctx.lookup(ap);
      const nRef = apDict && apDict.get(PDFName.of('N'));
      if (nRef) {
        const n = ctx.lookup(nRef);
        if (n instanceof PDFRawStream) {
          const resources = n.dict.lookup ? n.dict.lookup(PDFName.of('Resources')) : null;
          const gsDict = resources && resources.lookup ? resources.lookup(PDFName.of('ExtGState')) : null;
          const gsEntries = [];
          if (gsDict && typeof gsDict.entries === 'function') {
            for (const [k, v] of gsDict.entries()) {
              const gs = ctx.lookup(v);
              const ca = gs && gs.lookup ? gs.lookup(PDFName.of('ca')) : null;
              const CA = gs && gs.lookup ? gs.lookup(PDFName.of('CA')) : null;
              gsEntries.push({
                name: String(k),
                ca: ca && typeof ca.asNumber === 'function' ? ca.asNumber() : null,
                CA: CA && typeof CA.asNumber === 'function' ? CA.asNumber() : null,
              });
            }
          }
          let content = '';
          try {
            content = decodePDFRawStream(n).decode().toString('latin1');
          } catch (e1) {
            try { content = zlib.inflateSync(Buffer.from(n.getContents())).toString('latin1'); }
            catch (e2) { content = '<decode failed>'; }
          }
          apN = {
            stream: true,
            bytes: content.length,
            gsInvoked: (content.match(/\/(\w+)\s+gs/g) || []).map((s) => s.trim()),
            fillOps: (content.match(/[\d.]+\s+[\d.]+\s+[\d.]+\s+(?:rg|sc|scn)/g) || []),
            strokeOps: (content.match(/[\d.]+\s+[\d.]+\s+[\d.]+\s+(?:RG|SC|SCN)/g) || []),
            head: content.replace(/\s+/g, ' ').slice(0, 300),
          };
          apN.gsEntries = gsEntries;
        } else {
          apN = { stream: false, note: 'AP /N present but not a raw stream' };
        }
      }
    }
    out.push({ subtype, rect, ic, apN });
  }
  return out;
}

// ---------------------------------------------------------------------------
// pixel analysis
// ---------------------------------------------------------------------------
function pixelBox(render, win) {
  const H = render.pageH;
  return {
    x0: Math.max(0, Math.floor(win.x0 * render.scale)),
    x1: Math.min(render.w, Math.ceil(win.x1 * render.scale)),
    y0: Math.max(0, Math.floor((H - win.y1) * render.scale)),
    y1: Math.min(render.h, Math.ceil((H - win.y0) * render.scale)),
  };
}

function countNearBlue(render, win) {
  const b = pixelBox(render, win);
  let n = 0;
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const i = (y * render.w + x) * 4;
      if (isNearBlue(render.data[i], render.data[i + 1], render.data[i + 2])) n++;
    }
  }
  return n;
}

function interiorMetrics(base, saved, win) {
  const b = pixelBox(saved, win);
  let n = 0, baseDark = 0, kept = 0, opaqueBlue = 0, diff = 0;
  for (let y = b.y0; y < b.y1; y++) {
    for (let x = b.x0; x < b.x1; x++) {
      const si = (y * saved.w + x) * 4;
      const bi = (y * base.w + x) * 4;
      const sr = saved.data[si], sg = saved.data[si + 1], sb = saved.data[si + 2];
      const br = base.data[bi], bg = base.data[bi + 1], bb2 = base.data[bi + 2];
      n += 1;
      if (isNearBlue(sr, sg, sb)) opaqueBlue += 1;
      const baseIsDark = !isNearBlue(br, bg, bb2) && lum(br, bg, bb2) < 140;
      if (baseIsDark) {
        baseDark += 1;
        if (!isNearBlue(sr, sg, sb) && lum(sr, sg, sb) < 170) kept += 1;
      }
      diff += Math.abs(sr - br) + Math.abs(sg - bg) + Math.abs(sb - bb2);
    }
  }
  return {
    n,
    baseDarkFrac: +(baseDark / n).toFixed(4),
    opaqueBlueFrac: +(opaqueBlue / n).toFixed(4),
    textKeptFrac: baseDark ? +(kept / baseDark).toFixed(4) : null,
    meanAbsDiff: +(diff / (3 * n)).toFixed(2),
  };
}

function cropPng(render, win, file) {
  const b = pixelBox(render, win);
  const w = Math.max(2, b.x1 - b.x0), h = Math.max(2, b.y1 - b.y0);
  const c = napi.createCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.drawImage(render.canvas, b.x0, b.y0, w, h, 0, 0, w, h);
  fs.writeFileSync(file, c.toBuffer('image/png'));
}

// geometry windows from a raw /Rect [llx, lly, urx, ury]
function rectInterior(rect) {
  return { x0: rect[0] + 3, y0: rect[1] + 3, x1: rect[2] - 3, y1: rect[3] - 3 };
}
function ellipseInterior(rect) {
  const cx = (rect[0] + rect[2]) / 2, cy = (rect[1] + rect[3]) / 2;
  const rx = (rect[2] - rect[0]) / 2, ry = (rect[3] - rect[1]) / 2;
  const k = 0.66; // inscribed rectangle fully inside the ellipse
  return { x0: cx - k * rx, y0: cy - k * ry, x1: cx + k * rx, y1: cy + k * ry };
}
function rectRing(rect) {
  return {
    outer: { x0: rect[0] - 2.5, y0: rect[1] - 2.5, x1: rect[2] + 2.5, y1: rect[3] + 2.5 },
    inner: { x0: rect[0] + 0.5, y0: rect[1] + 0.5, x1: rect[2] - 0.5, y1: rect[3] - 0.5 },
  };
}

async function oplShapeFills(pdfjs, doc, pageNum) {
  const page = await doc.getPage(pageNum);
  const opList = await page.getOperatorList();
  const OPS = pdfjs.OPS;
  let ca = 1;
  const fills = [];
  for (let i = 0; i < opList.fnArray.length; i++) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    if (fn === OPS.setGState && Array.isArray(args[0])) {
      for (const pair of args[0]) {
        if (Array.isArray(pair) && pair[0] === 'ca' && typeof pair[1] === 'number') ca = pair[1];
      }
    } else if (fn === OPS.setFillRGBColor) {
      // pdf.js 4.x stores these already as 0-255 ints
      const r = args[0] <= 1 ? args[0] * 255 : args[0];
      const g = args[1] <= 1 ? args[1] * 255 : args[1];
      const b = args[2] <= 1 ? args[2] * 255 : args[2];
      if (Math.abs(r - 37) < 14 && Math.abs(g - 99) < 14 && Math.abs(b - 235) < 14) {
        fills.push({ ca: +ca.toFixed(3), seq: i });
      }
    }
  }
  return fills;
}

async function main() {
  const [savedFile, baselineFile, shotsDir, pageArg] = process.argv.slice(2);
  if (!savedFile || !baselineFile || !shotsDir) {
    throw new Error('usage: node def_165_166_thirdparty.cjs <saved.pdf> <baseline.pdf> <shotsDir> [page]');
  }
  const pageNum = Number(pageArg || 4);
  fs.mkdirSync(shotsDir, { recursive: true });

  // 1) raw dicts of the saved file
  const shapes = await dumpShapeAnnots(savedFile, pageNum);

  // 2) render saved + baseline with pdf.js
  const savedL = await loadPdfjsDoc(savedFile);
  const baseL = await loadPdfjsDoc(baselineFile);
  const saved = await renderPage(savedL.doc, pageNum, SCALE);
  const base = await renderPage(baseL.doc, pageNum, SCALE);

  const pageH = saved.pageH;
  const json = { pageH, renderW: saved.w, renderH: saved.h, shapes: {} };

  const counts = {};
  for (const s of shapes) {
    const tag = s.subtype === '/Circle' ? 'Circle' : 'Square';
    const idx = counts[tag] || 0;
    counts[tag] = idx + 1;
    json.shapes[`${tag}${idx || ''}`] = { rect: s.rect, ic: s.ic, apN: s.apN };
  }

  // 3) interior metrics per shape
  for (const s of shapes) {
    const tag = s.subtype === '/Circle' ? 'ellipse' : 'rect';
    const win = s.subtype === '/Circle' ? ellipseInterior(s.rect) : rectInterior(s.rect);
    json[tag] = {
      pdfRect: s.rect,
      interior: win,
      metrics: interiorMetrics(base, saved, win),
    };
    json[`${tag}Ring`] = (() => {
      const r = rectRing(s.rect);
      const sv = countNearBlue(saved, r.outer) - countNearBlue(saved, r.inner);
      const bv = countNearBlue(base, r.outer) - countNearBlue(base, r.inner);
      return { saved: sv, baseline: bv, delta: sv - bv };
    })();
    cropPng(saved, win, path.join(shotsDir, `def-165-thirdparty-saved-${tag}-interior.png`));
    cropPng(base, win, path.join(shotsDir, `def-165-thirdparty-baseline-${tag}-interior.png`));
  }

  // 4) operator-list witness: fill ops of the annotation color and their /ca
  json.oplShapeFills = await oplShapeFills(savedL.pdfjs, savedL.doc, pageNum);

  // 5) evidence PNGs
  fs.writeFileSync(path.join(shotsDir, 'def-165-thirdparty-saved-p4.png'), saved.canvas.toBuffer('image/png'));
  fs.writeFileSync(path.join(shotsDir, 'def-165-thirdparty-baseline-p4.png'), base.canvas.toBuffer('image/png'));

  process.stdout.write(`[TP-JSON] ${JSON.stringify(json)}\n`);
}

main().catch((e) => { process.stderr.write(`${e && e.stack || e}\n`); process.exit(1); });