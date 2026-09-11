// qa analysis for the DEF-182..DEF-187 retest (Phase 14 glass).
// Run AFTER the two capture runs:
//   powershell aurora_backdrop.ps1  -> npm run test:e2e -- e2e/qa_reference_compare.spec.cjs
//   powershell dark_backdrop.ps1    -> QA_COMP_SUFFIX=-dark same spec
// Reads screenshots/qa-reference-source.png, qa-comparison-actual-desktop{,-dark}.png,
// qa-comparison-grabmeta{,-dark}.json.
// Window bounds are DIP == grab px (desktopCapturer thumbnail at prim.size).
// Every glass reading is a CLASSIFIED patch median: 8x8 patches with lumaStd < 7
// (flat) and luma < 225 (not the white page/thumbnail) only, so text, thumbs and
// canvas never contaminate a glass surface reading.
const path = require('node:path');
const fs = require('node:fs');
const PNG = require('pngjs').PNG;
const { loadPng } = require('./glass_probe.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const WIN = { x: 560, y: 266, w: 1440, h: 860 };

const ref = loadPng(path.join(SHOTS, 'qa-reference-source.png'));
const aurora = loadPng(path.join(SHOTS, 'qa-comparison-actual-desktop.png'));
const dark = loadPng(path.join(SHOTS, 'qa-comparison-actual-desktop-dark.png'));
const metaA = JSON.parse(fs.readFileSync(path.join(SHOTS, 'qa-comparison-grabmeta.json'), 'utf8'));
const metaD = JSON.parse(fs.readFileSync(path.join(SHOTS, 'qa-comparison-grabmeta-dark.json'), 'utf8'));
if (metaA.bounds.x !== WIN.x || metaA.bounds.y !== WIN.y || metaA.bounds.width !== WIN.w) {
  throw new Error(`aurora bounds moved: ${JSON.stringify(metaA.bounds)}`);
}
if (metaD.bounds.x !== WIN.x || metaD.bounds.y !== WIN.y || metaD.bounds.width !== WIN.w) {
  throw new Error(`dark bounds moved: ${JSON.stringify(metaD.bounds)}`);
}

function patchStats(png, x, y, w, h) {
  let r = 0, g = 0, b = 0, n = 0;
  const lumas = [];
  for (let py = y; py < y + h; py += 1) {
    for (let px = x; px < x + w; px += 1) {
      const i = (py * png.width + px) * 4;
      r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2];
      lumas.push(0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2]);
      n += 1;
    }
  }
  const mean = lumas.reduce((a, v) => a + v, 0) / n;
  const vari = lumas.reduce((a, v) => a + (v - mean) * (v - mean), 0) / n;
  return { r: r / n, g: g / n, b: b / n, luma: mean, std: Math.sqrt(vari), n };
}

/** Grid of 8x8 patches over a region, glass-classified; report the patch whose
 *  luma is the median of the glass set (a single representative patch, never a
 *  channel-wise mix), the glass fraction, and the raw overall mean. */
function glassRegion(png, x, y, w, h) {
  const st = 8;
  const patches = [];
  for (let py = y; py + st <= y + h; py += st) {
    for (let px = x; px + st <= x + w; px += st) {
      patches.push(patchStats(png, px, py, st, st));
    }
  }
  const glass = patches.filter((p) => p.std < 7 && p.luma < 225);
  let medianPatch = null;
  if (glass.length) {
    const ls = glass.map((p) => p.luma).sort((a, b) => a - b);
    const target = ls[Math.floor(ls.length / 2)];
    medianPatch = glass.reduce((best, p) => (Math.abs(p.luma - target) < Math.abs(best.luma - target) ? p : best));
  }
  const rgb = (p) => [Number(p.r.toFixed(1)), Number(p.g.toFixed(1)), Number(p.b.toFixed(1))];
  const o = patchStats(png, x, y, w, h);
  return {
    patchN: patches.length,
    glassFrac: Number((glass.length / Math.max(1, patches.length)).toFixed(3)),
    glass: medianPatch ? rgb(medianPatch) : null,
    glassLumaStd: medianPatch ? Number(medianPatch.std.toFixed(2)) : null,
    overall: rgb(o),
  };
}

const delta = (a, d) => (a && d
  ? Number((Math.abs(a[0] - d[0]) + Math.abs(a[1] - d[1]) + Math.abs(a[2] - d[2])).toFixed(1))
  : null);
const bMinusR = (m) => (m ? Number((m[2] - m[0]).toFixed(1)) : null);
const round1 = (v) => Number(v.toFixed(1));

const out = { win: WIN, note: 'grab px == DIP; window bounds identical in both runs (grabmeta-verified)' };

// ---- 1. reference surface numbers (same zones as the original filing) ------
{
  const t = patchStats(ref, 480, 30, 650, 28);
  const rl = patchStats(ref, 72, 210, 24, 600);
  const rr = patchStats(ref, 212, 210, 26, 600);
  const pal = patchStats(ref, 1588, 180, 18, 700);
  out.reference = {
    titlebarFree: { mean: [t.r, t.g, t.b].map(round1), bMinusR: round1(t.b - t.r) },
    railLeftStrip: { mean: [rl.r, rl.g, rl.b].map(round1), bMinusR: round1(rl.b - rl.r) },
    railRightStrip: { mean: [rr.r, rr.g, rr.b].map(round1), bMinusR: round1(rr.b - rr.r) },
    paletteStrip: { mean: [pal.r, pal.g, pal.b].map(round1), bMinusR: round1(pal.b - pal.r) },
  };
}

// ---- 2. actual glass surfaces, aurora vs dark, CLEAN classified patches ----
const pair = (fx, fy, fw, fh) => {
  const a = glassRegion(aurora, WIN.x + fx, WIN.y + fy, fw, fh);
  const d = glassRegion(dark, WIN.x + fx, WIN.y + fy, fw, fh);
  return {
    region: { x: fx, y: fy, w: fw, h: fh },
    aurora: a,
    dark: d,
    seeThroughDelta: delta(a.glass, d.glass),
    auroraBminusR: bMinusR(a.glass),
    darkBminusR: bMinusR(d.glass),
  };
};

out.surfaces = {
  // titlebar free glass: tab ends ~win-x 345, Retry chip starts ~945
  titlebar: pair(400, 4, 500, 26),
  // toolbar free band between the icon clusters and the zoom pill
  toolbar: pair(340, 40, 420, 34),
  // rail interior (inside the 16px gutters + 1px hairline)
  rail: pair(20, 120, 212, 716),
  // rail lower-left quadrant sits over the magenta bloom (DEF-182 pink check)
  railOverMagenta: pair(20, 600, 120, 230),
  // tools panel interior right of the entry text, left of the scrollbar
  palette: pair(1382, 250, 22, 560),
  // gutters (raw wallpaper zones, no glass paint)
  gutterLeft: pair(3, 200, 11, 600),
  gutterRight: pair(1429, 200, 9, 600),
  gutterBottom: pair(300, 851, 700, 7),
  // canvas interior (must stay paper white, opaque)
  canvas: pair(400, 300, 400, 400),
};

out.tintComparison = {
  referenceTitlebar: out.reference.titlebarFree,
  actualTitlebarAurora: { mean: out.surfaces.titlebar.aurora.glass, bMinusR: out.surfaces.titlebar.auroraBminusR },
  actualTitlebarDark: { mean: out.surfaces.titlebar.dark.glass, bMinusR: out.surfaces.titlebar.darkBminusR },
};

// ---- 3. corner rounding profiles (DEF-187 window, DEF-184/186 panels) ------
function edgeProfile(png, opt) {
  const { fromX, toX, fromY, toY, threshold, scanRight } = opt;
  const prof = [];
  for (let y = fromY; y <= toY; y += 1) {
    let edge = null;
    if (scanRight) {
      for (let x = fromX; x <= toX; x += 1) {
        const i = (y * png.width + x) * 4;
        const l = 0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2];
        if (l > threshold) { edge = x; break; }
      }
    } else {
      for (let x = fromX; x >= toX; x -= 1) {
        const i = (y * png.width + x) * 4;
        const l = 0.299 * png.data[i] + 0.587 * png.data[i + 1] + 0.114 * png.data[i + 2];
        if (l > threshold) { edge = x; break; }
      }
    }
    prof.push([y, edge]);
  }
  return prof;
}
/** Summarize a top-corner profile: per-row inset (px) of the detected edge from
 *  the straight edge; a rounded corner shows insets shrinking to 0 downward. */
function cornerSummary(prof, straightEdge) {
  const insets = prof
    .filter(([, e]) => e !== null)
    .map(([y, e]) => ({ y, inset: Math.abs(e - straightEdge) }));
  const maxInset = insets.length ? Math.max(...insets.map((r) => r.inset)) : null;
  const rowsRounded = insets.filter((r) => r.inset >= 3).length;
  return { straightEdge, maxInset, rowsRounded, insets };
}

const wl = WIN.x, wt = WIN.y, wr = WIN.x + WIN.w, wb = WIN.y + WIN.h;
out.corners = {
  windowTLdark: cornerSummary(
    edgeProfile(dark, { fromX: wl - 6, toX: wl + 40, fromY: wt, toY: wt + 24, threshold: 80, scanRight: true }),
    wl,
  ),
  windowTRdark: cornerSummary(
    edgeProfile(dark, { fromX: wr + 6, toX: wr - 40, fromY: wt, toY: wt + 24, threshold: 80, scanRight: false }),
    wr - 1,
  ),
  windowBLaurora: cornerSummary(
    edgeProfile(aurora, { fromX: wl - 6, toX: wl + 40, fromY: wb - 25, toY: wb - 1, threshold: 46, scanRight: true }),
    wl,
  ),
  windowBRaurora: cornerSummary(
    edgeProfile(aurora, { fromX: wr + 6, toX: wr - 40, fromY: wb - 25, toY: wb - 1, threshold: 46, scanRight: false }),
    wr - 1,
  ),
  railTLdark: cornerSummary(
    edgeProfile(dark, { fromX: wl + 12, toX: wl + 56, fromY: wt + 100, toY: wt + 124, threshold: 55, scanRight: true }),
    wl + 17,
  ),
  paletteTRdark: cornerSummary(
    edgeProfile(dark, { fromX: wr - 12, toX: wr - 56, fromY: wt + 100, toY: wt + 124, threshold: 55, scanRight: false }),
    wr - 18,
  ),
};

// ---- 4. evidence crops (nearest-neighbor zoom for the composites) ---------
function cropScale(src, outName, cx, cy, cw, ch, scale) {
  const dw = Math.max(1, Math.round(cw * scale));
  const dh = Math.max(1, Math.round(ch * scale));
  const dst = new PNG({ width: dw, height: dh });
  for (let y = 0; y < dh; y += 1) {
    for (let x = 0; x < dw; x += 1) {
      const sx = Math.min(src.width - 1, cx + Math.floor(x / scale));
      const sy = Math.min(src.height - 1, cy + Math.floor(y / scale));
      const si = (sy * src.width + sx) * 4;
      const di = (y * dw + x) * 4;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = 255;
    }
  }
  fs.writeFileSync(path.join(SHOTS, outName), PNG.sync.write(dst));
}

const CROPS = [
  // window corners (8x)
  ['retest-corner-window-tl.png', dark, wl - 10, wt - 10, 64, 64, 8],
  ['retest-corner-window-tr.png', dark, wr - 54, wt - 10, 64, 64, 8],
  ['retest-corner-window-bl.png', aurora, wl - 10, wb - 54, 64, 64, 8],
  ['retest-corner-window-br.png', aurora, wr - 54, wb - 54, 64, 64, 8],
  // panel corners + gutters (6x)
  ['retest-rail-topleft-gutter.png', dark, wl - 6, wt + 96, 120, 90, 6],
  ['retest-palette-topright-gutter.png', dark, wr - 114, wt + 96, 120, 90, 6],
  ['retest-rail-bottomleft-gutter.png', aurora, wl - 6, wb - 108, 120, 100, 6],
  ['retest-palette-bottomright-gutter.png', aurora, wr - 114, wb - 108, 120, 100, 6],
  // titlebar strips for the tint comparison (2x)
  ['retest-titlebar-strip-ref.png', ref, 480, 20, 650, 46, 2],
  ['retest-titlebar-strip-aurora.png', aurora, WIN.x + 380, WIN.y + 1, 560, 34, 2],
  ['retest-titlebar-strip-dark.png', dark, WIN.x + 380, WIN.y + 1, 560, 34, 2],
  // rail top (Pages header) (3x)
  ['retest-rail-top-ref.png', ref, 58, 128, 200, 56, 3],
  ['retest-rail-top-aurora.png', aurora, WIN.x + 8, WIN.y + 98, 240, 66, 3],
  // panels full (for side-by-side)
  ['retest-panel-rail-aurora.png', aurora, WIN.x + 8, WIN.y + 96, 240, 760, 1],
  ['retest-panel-rail-dark.png', dark, WIN.x + 8, WIN.y + 96, 240, 760, 1],
  ['retest-panel-palette-aurora.png', aurora, WIN.x + 1072, WIN.y + 96, 360, 760, 1],
  ['retest-panel-palette-dark.png', dark, WIN.x + 1072, WIN.y + 96, 360, 760, 1],
  // reference panels
  ['retest-panel-rail-ref.png', ref, 55, 128, 205, 800, 1],
  ['retest-panel-tools-ref.png', ref, 1370, 128, 262, 806, 1],
  // left gutter close-up over aurora (6x)
  ['retest-gutter-left-aurora.png', aurora, wl - 2, WIN.y + 200, 60, 300, 6],
];
for (const [name, src, cx, cy, cw, ch, scale] of CROPS) {
  cropScale(src, name, Math.max(0, cx), Math.max(0, cy), cw, ch, scale);
}

fs.writeFileSync(path.join(SHOTS, 'def182-187-metrics.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
