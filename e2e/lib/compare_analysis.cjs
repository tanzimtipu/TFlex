// qa analysis: reference-vs-actual glass comparison metrics.
// Run AFTER e2e/qa_reference_compare.spec.cjs (+ optional -dark run):
//   node e2e/lib/compare_analysis.cjs
// Reads screenshots/qa-reference-source.png, qa-comparison-actual-desktop{,-dark}.png,
// qa-comparison-actual-window.png, qa-comparison-facts.json, qa-comparison-grabmeta.json.
// Writes screenshots/qa-comparison-metrics.json + zoomed corner crops.
const path = require('node:path');
const fs = require('node:fs');
const { loadPng, patchMean, patchLumaStd } = require('./glass_probe.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const out = {};

// ---------------------------------------------------------------- reference
// Hand-pinned from probes (e2e/lib/probe_reference_edges*.cjs):
// window x 55..1626, y 19..~933 (bottom slightly cropped in the image)
const REF = loadPng(path.join(SHOTS, 'qa-reference-source.png'));
const ref = {
  window: { x0: 55, y0: 19, x1: 1626, y1: 934 },
  titlebar: { y0: 20, y1: 66 },
  toolbar: { y0: 68, y1: 122 },
  pagesPanel: { x0: 71, y0: 137, x1: 243, y1: 922 },
  toolsPanel: { x0: 1378, y0: 138, x1: 1610, y1: 926 },
  // free-glass sample columns (between controls), verified from crops
  titlebarCols: [490, 560, 630, 700, 770, 840, 910, 980, 1050, 1120],
  toolbarCols: [350, 460, 550, 640, 745, 1115, 1160, 1580, 1600],
  railStrips: [{ x: 72, w: 24, y: 210, h: 600 }, { x: 212, w: 26, y: 210, h: 600 }],
  paletteStrip: { x: 1588, y: 180, w: 18, h: 700 },
  canvas: { x: 700, y: 400, w: 200, h: 200 },
  wallpaper: [[15, 470], [35, 200], [1660, 300], [1670, 700], [400, 6], [800, 6], [300, 924], [900, 924]],
};

function stats(png, x, y, w, h) {
  const m = patchMean(png, x, y, w, h);
  const std = patchLumaStd(png, x, y, w, h);
  return {
    mean: [Number(m.r.toFixed(1)), Number(m.g.toFixed(1)), Number(m.b.toFixed(1))],
    blueNess: Number((m.b - m.r).toFixed(1)),
    lumaStd: Number(std.toFixed(2)),
    n: m.n,
  };
}

out.reference = {
  image: [REF.width, REF.height],
  window: ref.window,
  titlebarColumns: ref.titlebarCols.map((x) => ({ x, ...stats(REF, x - 6, 30, 12, 28) })),
  toolbarColumns: ref.toolbarCols.map((x) => ({ x, ...stats(REF, x - 6, 78, 12, 36) })),
  titlebarOverall: stats(REF, 480, 30, 650, 28),
  railLeftStrip: stats(REF, 72, 210, 24, 600),
  railRightStrip: stats(REF, 212, 210, 26, 600),
  paletteStrip: stats(REF, 1588, 180, 18, 700),
  canvas: stats(REF, 700, 400, 200, 200),
  wallpaper: ref.wallpaper.map(([x, y]) => ({ x, y, ...stats(REF, x - 6, y - 6, 12, 12) })),
  // page-panel corner radius probe: for x in 71..115 find top edge y
  pagesPanelTopEdge: (() => {
    const prof = [];
    for (let x = 71; x <= 115; x += 4) {
      let edge = null;
      for (let y = 130; y < 190; y += 1) {
        const i = (y * REF.width + x) * 4;
        const lum = REF.data[i] + REF.data[i + 1] + REF.data[i + 2];
        // panel glass is lighter than the above-panel gutter glass
        if (lum > 640) { edge = y; break; }
      }
      prof.push([x, edge]);
    }
    return prof;
  })(),
};

// ---------------------------------------------------------------- actual
function analyzeGrab(name) {
  const metaPath = path.join(SHOTS, `qa-comparison-grabmeta${name}.json`);
  const factsPath = path.join(SHOTS, `qa-comparison-facts${name}.json`);
  if (!fs.existsSync(metaPath)) return null;
  const grab = loadPng(path.join(SHOTS, `qa-comparison-actual-desktop${name}.png`));
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const facts = JSON.parse(fs.readFileSync(factsPath, 'utf8'));
  const b = meta.bounds; // DIP == grab px (thumbnailSize = prim.size)
  const R = (fx0, fy0, fx1, fy1) => ({
    x: b.x + Math.round(fx0 * b.width),
    y: b.y + Math.round(fy0 * b.height),
    w: Math.max(2, Math.round((fx1 - fx0) * b.width)),
    h: Math.max(2, Math.round((fy1 - fy0) * b.height)),
  });
  // Free-glass DIP zones measured from the renderer shot (controls excluded):
  // titlebar x 350..910 (between tab and Retry chip), toolbar row1 x 490..780
  // (between save and zoom), annotation row y 79..125 DIP.
  const rects = facts.rects;
  const titlebar = rects.titlebar, toolbar = rects.toolbar, rail = rects.sideRail, pal = rects.palette;
  const res = {
    windowBounds: b,
    titlebarColumns: [360, 410, 460, 510, 560, 610, 660, 710, 760, 810, 860, 900].map((xDip) => {
      const ax = b.x + xDip;
      return { xDip, ...stats(grab, ax - 8, b.y + 3, 16, titlebar.px.h - 6) };
    }),
    titlebarOverall: stats(grab, b.x + 360, b.y + 3, 550, titlebar.px.h - 6),
    toolbarColumns: [500, 540, 580, 620, 660, 700, 740].map((xDip) => {
      const ax = b.x + xDip;
      return { xDip, ...stats(grab, ax - 8, b.y + toolbar.px.y + 4, 12, toolbar.px.h - 8) };
    }),
    toolbarOverall: stats(grab, b.x + 490, b.y + toolbar.px.y + 4, 280, toolbar.px.h - 8),
    annotBarFree: stats(grab, b.x + 600, b.y + 84, 200, 30),
    railLeftStrip: stats(grab, b.x + 6, b.y + 140, 14, 700),
    railRightStrip: stats(grab, b.x + 178, b.y + 140, 26, 700),
    railBottomOverMagenta: stats(grab, b.x + 6, b.y + 660, 208, 160),
    paletteLeftStrip: stats(grab, b.x + pal.px.x + 4, b.y + pal.px.y + 50, 10, 650),
    paletteRightStrip: stats(grab, b.x + pal.px.x + pal.px.w - 62, b.y + pal.px.y + 50, 16, 650),
    // workspace gutter band above the page (transparent step-aside region)
    workspaceGutter: stats(grab, b.x + 260, b.y + 122, 850, 24),
    canvas: stats(grab, b.x + 340, b.y + 240, 600, 500),
    margins: {
      left: stats(grab, 60, b.y + 100, 300, 800),
      right: stats(grab, b.x + b.width + 60, b.y + 100, 300, 800),
      top: stats(grab, b.x + 100, 30, 1200, 180),
      bottom: stats(grab, b.x + 100, b.y + b.height + 40, 800, 200),
    },
  };
  return res;
}

out.aurora = analyzeGrab('');
out.dark = analyzeGrab('-dark');

// See-through: per-region aurora-vs-dark delta (same window position both runs)
if (out.aurora && out.dark) {
  const diff = {};
  for (const key of ['titlebarOverall', 'toolbarOverall', 'railLeftStrip', 'paletteLeftStrip', 'workspaceGutter', 'canvas']) {
    const a = out.aurora[key].mean, d = out.dark[key].mean;
    diff[key] = {
      aurora: a, dark: d,
      absDelta: Number((Math.abs(a[0] - d[0]) + Math.abs(a[1] - d[1]) + Math.abs(a[2] - d[2])).toFixed(1)),
    };
  }
  out.seeThroughDiff = diff;
}

// Renderer alpha audit (chrome translucent, canvas opaque) - retest-style.
{
  const win = loadPng(path.join(SHOTS, 'qa-comparison-actual-window.png'));
  const facts = JSON.parse(fs.readFileSync(path.join(SHOTS, 'qa-comparison-facts.json'), 'utf8'));
  const audit = (r) => {
    let t = 0, n = 0;
    const gx = 16, gy = 12;
    for (let iy = 0; iy < gy; iy += 1) {
      for (let ix = 0; ix < gx; ix += 1) {
        const px = Math.min(win.width - 1, Math.round(((ix + 0.5) / gx) * (r.px.w) + r.px.x * (win.width / 1440)));
        const py = Math.min(win.height - 1, Math.round(((iy + 0.5) / gy) * (r.px.h) + r.px.y * (win.height / 860)));
        const a = win.data[(py * win.width + px) * 4 + 3];
        n += 1;
        if (a < 250) t += 1;
      }
    }
    return { transparentFrac: Number((t / n).toFixed(3)), samples: n };
  };
  out.rendererAlphaAudit = {
    note: 'fraction of renderer-surface pixels with alpha<250; chrome should be translucent (<1.0), canvas opaque (0)',
    // renderer shot is 2160x1290 for a 1440x860 DIP window (1.5x) - map DOM px *1.5
    titlebar: audit(scale(facts.rects.titlebar, 1.5, 1.5)),
    sideRail: audit(scale(facts.rects.sideRail, 1.5, 1.5)),
    palette: audit(scale(facts.rects.palette, 1.5, 1.5)),
  };
  function scale(r, sx, sy) {
    return { px: { x: r.px.x * sx, y: r.px.y * sy, w: r.px.w * sx, h: r.px.h * sy } };
  }
}

fs.writeFileSync(path.join(SHOTS, 'qa-comparison-metrics.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1).slice(0, 7000));
console.log('\nfull metrics -> screenshots/qa-comparison-metrics.json');

