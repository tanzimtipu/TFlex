// qa analysis helper: PNG pixel probing for the reference-vs-actual glass
// comparison. CommonJS so .cjs specs can require it. Uses pngjs (dev dep).
const fs = require('node:fs');
const PNG = require('pngjs').PNG;

function loadPng(p) {
  return PNG.sync.read(fs.readFileSync(p));
}

/** Mean RGB over a rectangular patch (clamped). */
function patchMean(png, x, y, w, h) {
  let r = 0, g = 0, b = 0, n = 0;
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(png.width, Math.round(x + w)), y1 = Math.min(png.height, Math.round(y + h));
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const i = (py * png.width + px) * 4;
      r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2];
      n += 1;
    }
  }
  if (!n) return null;
  return { r: r / n, g: g / n, b: b / n, n };
}

/** Stddev of luminance over a patch (spatial variance = see-through signal). */
function patchLumaStd(png, x, y, w, h) {
  const vals = [];
  const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(png.width, Math.round(x + w)), y1 = Math.min(png.height, Math.round(y + h));
  for (let py = y0; py < y1; py += 1) {
    for (let px = x0; px < x1; px += 1) {
      const i = (py * png.width + px) * 4;
      vals.push(0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2]);
    }
  }
  const mean = vals.reduce((a, v) => a + v, 0) / Math.max(1, vals.length);
  const variance = vals.reduce((a, v) => a + (v - mean) * (v - mean), 0) / Math.max(1, vals.length);
  return Math.sqrt(variance);
}

/** Mean RGB of a 1px-wide horizontal strip scan: returns array of [x, r, g, b]. */
function rowStrip(png, y, x0, x1, step) {
  const out = [];
  for (let x = x0; x <= x1; x += (step || 1)) {
    const i = (y * png.width + x) * 4;
    out.push([x, png.data[i], png.data[i + 1], png.data[i + 2]]);
  }
  return out;
}

/** Mean RGB of a 1px-wide vertical strip: array of [y, r, g, b]. */
function colStrip(png, x, y0, y1, step) {
  const out = [];
  for (let y = y0; y <= y1; y += (step || 1)) {
    const i = (y * png.width + x) * 4;
    out.push([y, png.data[i], png.data[i + 1], png.data[i + 2]]);
  }
  return out;
}

/** Compact print of a strip: groups consecutive pixels into color runs. */
function runs(strip, tol) {
  const out = [];
  let cur = null;
  for (const [pos, r, g, b] of strip) {
    const key = `${Math.round(r / (tol || 12))},${Math.round(g / (tol || 12))},${Math.round(b / (tol || 12))}`;
    if (cur && cur.key === key) { cur.end = pos; cur.n += 1; cur.r += r; cur.g += g; cur.b += b; }
    else {
      if (cur) out.push(cur);
      cur = { start: pos, end: pos, n: 1, r, g, b, key };
    }
  }
  if (cur) out.push(cur);
  return out.map((c) => ({
    from: c.start, to: c.end, n: c.n,
    rgb: [Math.round(c.r / c.n), Math.round(c.g / c.n), Math.round(c.b / c.n)],
  }));
}

module.exports = { loadPng, patchMean, patchLumaStd, rowStrip, colStrip, runs };