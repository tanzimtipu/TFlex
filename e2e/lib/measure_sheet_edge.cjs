// QA measurement helper (DEF-302 retest): measure the WHITE SHEET EDGE width
// in a saved CDP screencast frame. The sheet is pure white (#ffffff) on the
// light `--bg-canvas`; the longest near-white run on a scan row is the sheet.
// Usage: node e2e/lib/measure_sheet_edge.cjs <shotsDir> <prefix> [row]
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

const SHOTS = process.argv[2];
const prefix = process.argv[3] || 'diag-zoom-frame-in';
const row = Number(process.argv[4] || 250);

// The sheet's OUTER edge (the `.pdf-page` shadow gradient included) is the
// leftmost / rightmost near-white pixel on the scan row, right of the
// thumbnail rail (x >= 150). Width = right - left, matching the pre-fix
// diagnosis (frame 00 = 304, post-click = 335).
const X_MIN = 150;
function measure(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const { width, height, data } = png;
  const y = Math.min(row, height - 1);
  let left = -1;
  let right = -1;
  for (let x = X_MIN; x < width; x += 1) {
    const i = (y * width + x) * 4;
    const white = data[i] >= 250 && data[i + 1] >= 250 && data[i + 2] >= 250;
    if (white) {
      if (left < 0) left = x;
      right = x;
    }
  }
  return { w: width, h: height, start: left, end: right, len: right - left };
}

for (let i = 0; i < 20; i += 1) {
  const f = path.join(SHOTS, `${prefix}-${String(i).padStart(2, '0')}.png`);
  if (!fs.existsSync(f)) continue;
  const m = measure(f);
  console.log(`${prefix}-${String(i).padStart(2, '0')}  img=${m.w}x${m.h}  row=${row}  whiteRun=[${m.start}..${m.end}] width=${m.len}`);
}
