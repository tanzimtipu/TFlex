// Frame-time graph PNG generator (qa-owned). Takes an array of rAF frame
// timestamps (ms) and renders a bar chart of frame DELTAS against the 60fps
// budget (16.7ms) and the 30fps line (33.3ms). Uses pngjs (already a
// devDependency) - no new dependency, no network, no canvas.
//
// Bars: green <= 16.7ms (budget held), amber <= 33.3ms (one dropped frame),
// red > 33.3ms (jank). The 16.7ms budget line is drawn white/bold so the
// "frame time < 16.7ms" claim is directly visible.

const fs = require('node:fs');
const { PNG } = require('pngjs');

function renderFrameGraph(frameTimestamps, outPath, opts = {}) {
  const W = opts.width || 960;
  const H = opts.height || 340;
  const maxMs = opts.maxMs || 70;
  const deltas = [];
  for (let i = 1; i < frameTimestamps.length; i++) {
    deltas.push(frameTimestamps[i] - frameTimestamps[i - 1]);
  }
  if (deltas.length < 2) throw new Error(`framegraph: need >= 3 frames, got ${frameTimestamps.length}`);

  const png = new PNG({ width: W, height: H });
  const set = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const idx = (W * y + x) << 2;
    png.data[idx] = r;
    png.data[idx + 1] = g;
    png.data[idx + 2] = b;
    png.data[idx + 3] = 255;
  };

  // Background.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) set(x, y, 16, 20, 28);
  }

  const yFor = (ms) => Math.round(H - 24 - (Math.min(Math.max(ms, 0), maxMs) / maxMs) * (H - 48));

  // Grid: 8.3 / 16.7 / 33.3 / 50 / 66.7 ms. Budget line thicker + bright.
  const grid = [
    [8.3, 60, 76, 96],
    [33.3, 120, 52, 52],
    [50, 90, 60, 60],
    [66.7, 90, 60, 60],
  ];
  for (const [ms, r, g, b] of grid) {
    const y = yFor(ms);
    for (let x = 8; x < W - 8; x++) {
      set(x, y, r, g, b);
    }
  }
  const yBudget = yFor(16.7);
  for (let x = 8; x < W - 8; x++) {
    set(x, yBudget, 226, 232, 240);
    set(x, yBudget + 1, 226, 232, 240);
  }
  // Zero baseline.
  const y0 = yFor(0);
  for (let x = 8; x < W - 8; x++) set(x, y0, 90, 100, 116);

  // Bars: one column per frame delta.
  const n = deltas.length;
  const plotW = W - 24;
  const step = plotW / n;
  const barW = Math.max(1, Math.floor(step) - 1);
  for (let i = 0; i < n; i++) {
    const d = deltas[i];
    const x = 12 + Math.floor(i * step);
    const color = d <= 16.7 ? [74, 200, 118] : d <= 33.4 ? [232, 178, 58] : [226, 72, 72];
    const yTop = yFor(d);
    for (let y = y0 - 1; y >= yTop; y--) {
      for (let dx = 0; dx < barW; dx++) set(x + dx, y, color[0], color[1], color[2]);
    }
  }

  // Compute stats for the caller to log (fps, avg, max).
  let sum = 0;
  let max = 0;
  for (const d of deltas) {
    sum += d;
    if (d > max) max = d;
  }
  const avg = sum / deltas.length;
  const fps = Math.round(((deltas.length) / (frameTimestamps[frameTimestamps.length - 1] - frameTimestamps[0])) * 1000);

  return new Promise((resolve, reject) => {
    png
      .pack()
      .pipe(fs.createWriteStream(outPath))
      .on('finish', () => resolve({ frames: n, fps, avgDelta: Math.round(avg * 10) / 10, maxDelta: Math.round(max * 10) / 10, path: outPath }))
      .on('error', reject);
  });
}

module.exports = { renderFrameGraph };