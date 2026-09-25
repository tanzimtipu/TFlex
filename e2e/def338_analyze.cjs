// DEF-338 frame analyzer (QA diagnostic). Reads the CDP screencast PNGs and
// reports, per frame, the pane-B region's ink/blank statistics so the paint
// sequence can be quantified. Temporary; removed after the investigation.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const dir = process.argv[2];
const prefix = process.argv[3];
const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix + '-') && f.endsWith('.png')).sort();

function stats(file) {
  const png = PNG.sync.read(fs.readFileSync(path.join(dir, file)));
  const { width, height, data } = png;
  // Pane B is the middle-right pane; the Inspector sits to its right.
  // Window ~1280 CSS px -> frame 720 px: pane B x 615..1178 -> 346..663.
  const x0 = Math.floor(width * 0.48);
  const x1 = Math.floor(width * 0.92);
  let dark = 0, white = 0, grey = 0, total = 0;
  let sum = 0;
  const colors = {};
  for (let y = 0; y < height; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      total += 1;
      sum += (r + g + b) / 3;
      if (r < 128 && g < 128 && b < 128) dark += 1;
      else if (r > 250 && g > 250 && b > 250) white += 1;
      else if (Math.abs(r - g) < 6 && Math.abs(g - b) < 6 && r > 200 && r < 252) grey += 1;
      const key = `${r >> 4},${g >> 4},${b >> 4}`;
      colors[key] = (colors[key] || 0) + 1;
    }
  }
  const top = Object.entries(colors).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, n]) => `${k}:${(100 * n / total).toFixed(0)}%`);
  return {
    file, w: width, h: height,
    mean: (sum / total).toFixed(1),
    darkPct: (100 * dark / total).toFixed(2),
    whitePct: (100 * white / total).toFixed(1),
    greyPct: (100 * grey / total).toFixed(1),
    top: top.join(' '),
  };
}

console.log(`prefix=${prefix} frames=${files.length}`);
for (const f of files) {
  const s = stats(f);
  console.log(`${s.file} mean=${s.mean} dark%=${s.darkPct} white%=${s.whitePct} grey%=${s.greyPct} top=[${s.top}]`);
}
