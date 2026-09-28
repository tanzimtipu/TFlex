// Third-party witness for DEF-165 (qa, v1.7.28 retest). Same evidence pipeline as
// def_165_166_thirdparty.cjs (v1.7.27): render the SAVED file's page with plain
// pdfjs-dist in a Node process, outside TFlex, and measure the shape interiors.
// v1.7.28 additions: longer /AP /N content-stream head dump and an explicit
// inline-ca-token detection (the v1.7.27 bug signature: "0.1 ca" written as an
// invalid inline operator instead of an ExtGState /gs call).
//
// usage: node def_165_166_thirdparty_1728.cjs <saved.pdf> <baseline.pdf> <shotsDir> [page]

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const napi = require('@napi-rs/canvas');
const { PDFDocument, PDFName, PDFArray, PDFRawStream, decodePDFRawStream } = require('@cantoo/pdf-lib');

const ROOT = path.resolve(__dirname, '..', '..');
const FONTS = path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep;
const SCALE = 2;

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
            // v1.7.27 bug signature: fill alpha written as an inline "0.1 ca"
            // operator instead of (or without) an ExtGState /gs invocation.
            inlineCaToken: /(^|\s)[\d.]+\s+ca(\s|$)/.test(content),
            head: content.replace(/\s+/g, ' ').slice(0, 600),
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
  // PAINT-TIME attribution: the blue rg TOKEN may legally appear before the
  // ExtGState gs call inside the same q..Q block - what matters is the ca
  // under which the fill actually PAINTS (f/B operators). Validated against
  // the 1.7.27 fixture (paints at ca=1, the bug) and 1.7.28 (ca=0.1).
  const page = await doc.getPage(pageNum);
  const opList = await page.getOperatorList();
  const OPS = pdfjs.OPS;
  const NAME = Object.fromEntries(Object.entries(OPS).map(([k, v]) => [v, k]));
  const PAINT_OPS = new Set(['fill', 'eoFill', 'fillStroke', 'eoFillStroke', 'closeFillStroke', 'closeEOFillStroke', 'stroke', 'closeStroke']);
  let ca = 1;
  let fill = null;
  const stack = [];
  const fills = [];
  for (let i = 0; i < opList.fnArray.length; i++) {
    const name = NAME[opList.fnArray[i]];
    const args = opList.argsArray[i];
    if (name === 'setGState' && Array.isArray(args[0])) {
      for (const pair of args[0]) {
        if (Array.isArray(pair) && pair[0] === 'ca' && typeof pair[1] === 'number') ca = pair[1];
      }
    } else if (name === 'setFillRGBColor') {
      // pdf.js 4.x args may be an array-like {0: r, 1: g, 2: b} in 0-255
      const r = args[0] <= 1 ? args[0] * 255 : args[0];
      const g = args[1] <= 1 ? args[1] * 255 : args[1];
      const b = args[2] <= 1 ? args[2] * 255 : args[2];
      fill = { r, g, b };
    } else if (name === 'save') {
      stack.push({ ca, fill });
    } else if (name === 'restore') {
      const s = stack.pop();
      if (s) { ca = s.ca; fill = s.fill; }
    } else if (PAINT_OPS.has(name)) {
      if (fill && Math.abs(fill.r - 37) < 14 && Math.abs(fill.g - 99) < 14 && Math.abs(fill.b - 235) < 14) {
        fills.push({ ca: +ca.toFixed(3), seq: i, op: name });
      }
    }
  }
  return fills;
}

async function main() {
  const [savedFile, baselineFile, shotsDir, pageArg] = process.argv.slice(2);
  if (!savedFile || !baselineFile || !shotsDir) {
    throw new Error('usage: node def_165_166_thirdparty_1728.cjs <saved.pdf> <baseline.pdf> <shotsDir> [page]');
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
    json[`${tag}Ink`] = (() => {
      // full-bbox near-blue pixel count: the 1.5pt border stroke straddles the
      // /Rect path, so a painted shape leaves hundreds of near-blue px in the
      // bbox (rect ~560, ellipse ~400) while an unpainted one leaves ~0.
      // Works for both the Square (edges) and the Circle (curve) - the old
      // rectangular "ring" annulus missed most of the elliptical border.
      const win = { x0: s.rect[0], y0: s.rect[1], x1: s.rect[2], y1: s.rect[3] };
      const sv = countNearBlue(saved, win);
      const bv = countNearBlue(base, win);
      return { saved: sv, baseline: bv, delta: sv - bv };
    })();
    cropPng(saved, win, path.join(shotsDir, `def-165-1728-thirdparty-saved-${tag}-interior.png`));
    cropPng(base, win, path.join(shotsDir, `def-165-1728-thirdparty-baseline-${tag}-interior.png`));
  }

  // 4) operator-list witness: fill ops of the annotation color and their /ca
  json.oplShapeFills = await oplShapeFills(savedL.pdfjs, savedL.doc, pageNum);

  // 5) evidence PNGs
  fs.writeFileSync(path.join(shotsDir, 'def-165-1728-thirdparty-saved-p4.png'), saved.canvas.toBuffer('image/png'));
  fs.writeFileSync(path.join(shotsDir, 'def-165-1728-thirdparty-baseline-p4.png'), base.canvas.toBuffer('image/png'));

  process.stdout.write(`[TP-JSON] ${JSON.stringify(json)}\n`);
}

main().catch((e) => { process.stderr.write(`${e && e.stack || e}\n`); process.exit(1); });
