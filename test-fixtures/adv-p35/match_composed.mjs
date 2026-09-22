// ADV phase-35: match the captured composed print images to the preview page images
// (no pdfjs needed - both are PNG data URLs from the app's own rasteriser).
import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const OUT = path.join(process.env.TEMP, 'adv-p35');
const data = JSON.parse(fs.readFileSync(path.join(OUT, 'order_data.json'), 'utf8'));

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
function mad(a, b) { let s = 0; for (let i = 0; i < a.length; i += 1) s += Math.abs(a[i] - b[i]); return s / a.length; }
async function sigOfDataUrl(src) {
  const img = await loadImage(Buffer.from(src.split(',')[1], 'base64'));
  return sigFromCanvas(img);
}

const previewSig = {};
for (const [page, src] of Object.entries(data.allPageSrc)) previewSig[page] = await sigOfDataUrl(src);

console.log(`previewCells(order)=${JSON.stringify(data.previewCells)} previewPages=${Object.keys(previewSig).join(',')}`);
for (let s = 0; s < data.composed.length; s += 1) {
  const sheet = data.composed[s];
  const matched = [];
  for (let i = 0; i < sheet.length; i += 1) {
    const cs = await sigOfDataUrl(sheet[i]);
    const dists = {};
    for (const [p, ps] of Object.entries(previewSig)) dists[p] = Number(mad(cs, ps).toFixed(4));
    const best = Object.entries(dists).sort((a, b) => a[1] - b[1])[0];
    matched.push({ cell: i, bestPage: best[0], dists });
  }
  console.log(`composedSheet${s + 1}: ${JSON.stringify(matched)}`);
}

