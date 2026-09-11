// qa probe: text contrast on the frosted glass panels (readability check for
// the Phase-14 criterion "pleasant and readable"). Crops the Tools palette
// first entry and the rail "Undo last change" row from the aurora grab and the
// reference, and measures the luma spread inside each text region (text min vs
// glass median). High spread = readable; low = text drowns in the glass.
const path = require('node:path');
const fs = require('node:fs');
const PNG = require('pngjs').PNG;
const { loadPng } = require('./glass_probe.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const ref = loadPng(path.join(SHOTS, 'qa-reference-source.png'));
const aurora = loadPng(path.join(SHOTS, 'qa-comparison-actual-desktop.png'));
const WIN = { x: 560, y: 266 };

function lumaHist(png, x, y, w, h) {
  const lumas = [];
  for (let py = y; py < y + h; py += 1) {
    for (let px = x; px < x + w; px += 1) {
      const i = (py * png.width + px) * 4;
      lumas.push(0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2]);
    }
  }
  lumas.sort((a, b) => a - b);
  const q = (p) => lumas[Math.floor((lumas.length - 1) * p)];
  return {
    min: Math.round(lumas[0]),
    p5: Math.round(q(0.05)),
    median: Math.round(q(0.5)),
    p95: Math.round(q(0.95)),
    max: Math.round(lumas[lumas.length - 1]),
    textVsGlass: Math.round(q(0.5) - q(0.05)),
  };
}

const out = {
  refMergeTitle: lumaHist(ref, 1434, 216, 130, 16), // "Merge PDFs" title in the mock
  refMergeDesc: lumaHist(ref, 1434, 236, 170, 14), // "Combine multiple PDFs..."
  refRailThumb: lumaHist(ref, 90, 400, 130, 300), // rail glass around thumbnails
  actMergeTitle: lumaHist(aurora, WIN.x + 1120, WIN.y + 172, 150, 18), // "Merge PDFs"
  actMergeDesc: lumaHist(aurora, WIN.x + 1120, WIN.y + 192, 200, 28), // description lines
  actUndoRow: lumaHist(aurora, WIN.x + 30, WIN.y + 148, 170, 18), // "Undo last change"
  actRailGlass: lumaHist(aurora, WIN.x + 30, WIN.y + 400, 180, 300),
};
fs.writeFileSync(path.join(SHOTS, 'def182-187-contrast.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
