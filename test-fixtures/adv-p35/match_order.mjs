// ADV phase-35: match produced PDF sheet-1 cells to the preview page images.
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const OUT = path.join(process.env.TEMP, 'adv-p35');
const data = JSON.parse(fs.readFileSync(path.join(OUT, 'order_data.json'), 'utf8'));
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');

function sigFromCanvas(c) {
  const W = 64, H = 80;
  const t = createCanvas(W, H);
  const x = t.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.drawImage(c, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data;
  const o = new Float64Array(W * H);
  for (let i = 0, p = 0; i < d.length; i += 4, p += 1) o[p] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
  return o;
}
function contain(page, W, H) {
  const c = createCanvas(W, H);
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  const s = Math.min(W / page.width, H / page.height);
  const dw = page.width * s, dh = page.height * s;
  x.drawImage(page, (W - dw) / 2, (H - dh) / 2, dw, dh);
  return c;
}
function mad(a, b) { let s = 0; for (let i = 0; i < a.length; i += 1) s += Math.abs(a[i] - b[i]); return s / a.length; }

// decode preview page images
const previewImg = {};
for (const [page, src] of Object.entries(data.previewSrc)) {
  const b64 = src.split(',')[1];
  previewImg[page] = await loadImage(Buffer.from(b64, 'base64'));
}
console.log('previewPagesAvailable=', Object.keys(previewImg).join(','));

// render produced pdf sheet 1
const bytes = new Uint8Array(fs.readFileSync(data.outPath));
const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
console.log('producedPages=', doc.numPages);
try {
console.log('step: getPage');
const page = await doc.getPage(1);
console.log('step: got page');
const vp = page.getViewport({ scale: 0.35 });
const full = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
const fctx = full.getContext('2d');
fctx.fillStyle = '#fff'; fctx.fillRect(0, 0, full.width, full.height);
console.log('step: render start', vp.width, vp.height);
await page.render({ canvasContext: fctx, viewport: vp }).promise;
console.log('step: render done');
const halfW = Math.floor(full.width / 2);
const cells = [0, 1].map((i) => {
  const c = createCanvas(halfW, full.height);
  c.getContext('2d').drawImage(full, i * halfW, 0, halfW, full.height, 0, 0, halfW, full.height);
  return c;
});
for (let i = 0; i < cells.length; i += 1) {
  const cs = sigFromCanvas(cells[i]);
  const dists = {};
  for (const [p, img] of Object.entries(previewImg)) dists[p] = Number(mad(cs, sigFromCanvas(contain(img, halfW, full.height))).toFixed(4));
  const best = Object.entries(dists).sort((a, b) => a[1] - b[1])[0];
  console.log(`producedSheet1 cell${i} bestPage=${best[0]} dists=${JSON.stringify(dists)}`);
}
await doc.destroy();
} catch (e) { console.error('MATCH ERROR', e && e.stack ? e.stack : e); }

