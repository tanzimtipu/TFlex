// ADV phase-35: verify the produced PDF's page ORDER / N-up / orientation by
// rendering it with pdfjs + @napi-rs/canvas and matching cells to source pages.
// Usage: node verify_order.mjs <sourcePdf> <producedPdf> <pagesPerSheet> <reverse:0|1> <rangeSpec>
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { pathToFileURL } from 'node:url';

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const standardFontDataUrl = path.resolve('node_modules/pdfjs-dist/standard_fonts') + path.sep;
const [, , srcPath, prodPath, perSheetArg, reverseArg] = process.argv;
const perSheet = Number(perSheetArg || 1);
const reverse = reverseArg === '1';

async function renderPdf(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false, standardFontDataUrl }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    pages.push({ canvas, w: canvas.width, h: canvas.height });
  }
  await doc.destroy();
  return pages;
}

// grayscale signature, downsampled to 48x64
function sig(canvas) {
  const W = 48, H = 64;
  const tmp = createCanvas(W, H);
  const tctx = tmp.getContext('2d');
  tctx.fillStyle = '#fff';
  tctx.fillRect(0, 0, W, H);
  tctx.drawImage(canvas, 0, 0, W, H);
  const d = tctx.getImageData(0, 0, W, H).data;
  const out = new Float64Array(W * H);
  for (let i = 0, p = 0; i < d.length; i += 4, p += 1) out[p] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
  return out;
}

// Draw a source page into a WxH canvas with object-fit: contain (mirrors the
// composed print CSS `.page img { width:100%; height:100%; object-fit:contain }`).
function compositeContain(page, W, H) {
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  const scale = Math.min(W / page.w, H / page.h);
  const dw = page.w * scale, dh = page.h * scale;
  ctx.drawImage(page.canvas, (W - dw) / 2, (H - dh) / 2, dw, dh);
  return c;
}

function mad(a, b) { let s = 0; for (let i = 0; i < a.length; i += 1) s += Math.abs(a[i] - b[i]); return s / a.length; }

const src = await renderPdf(srcPath);
const prod = await renderPdf(prodPath);
console.log(`sourcePages=${src.length} producedPages=${prod.length} perSheet=${perSheet} reverse=${reverse}`);
console.log(`sourceSizes=${JSON.stringify(src.map((p) => [p.w, p.h]))}`);
console.log(`producedSizes=${JSON.stringify(prod.map((p) => [p.w, p.h]))}`);

// selection order (matches resolveSelectedPages: range then reverse)
const range = src.map((_, i) => i + 1);
const order = reverse ? [...range].reverse() : range;
// chunk into sheets
const sheets = [];
for (let i = 0; i < order.length; i += perSheet) sheets.push(order.slice(i, i + perSheet));

let allOk = true;
for (let s = 0; s < prod.length; s += 1) {
  const sheet = prod[s];
  const expected = sheets[s] || [];
  const cols = perSheet === 1 ? 1 : perSheet === 2 ? 2 : 2;
  const rows = perSheet === 1 ? 1 : perSheet === 2 ? 1 : Math.ceil(perSheet / cols);
  const cellW = Math.floor(sheet.w / cols), cellH = Math.floor(sheet.h / rows);
  const cellSigs = [];
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) {
    const cell = createCanvas(cellW, cellH);
    const cc = cell.getContext('2d');
    cc.drawImage(sheet.canvas, c * cellW, r * cellH, cellW, cellH, 0, 0, cellW, cellH);
    cellSigs.push(sig(cell));
  }
  // match each cell to the best source page
  const matches = cellSigs.map((cs) => {
    let best = null;
    for (let p = 0; p < src.length; p += 1) {
      const expectedCanvas = compositeContain(src[p], cellW, cellH);
      const d = mad(cs, sig(expectedCanvas));
      if (best === null || d < best.d) best = { page: p + 1, d };
    }
    return best;
  });
  const got = matches.map((m) => m.page);
  const exp = expected;
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  allOk = allOk && ok;
  console.log(`sheet${s + 1}: size=${sheet.w}x${sheet.h} expected=${JSON.stringify(exp)} matched=${JSON.stringify(got)} dists=${JSON.stringify(matches.map((m) => Number(m.d.toFixed(4))))} ok=${ok}`);
}
console.log(`ORDER_OK=${allOk}`);

