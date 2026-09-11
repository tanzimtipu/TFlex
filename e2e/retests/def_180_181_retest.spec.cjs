// DEF-180 / DEF-181 retest (qa). Drives the REAL dev build through the
// canonical launcher (launchApp) with a dist freshly built from the fix
// source (see build note in DEFECTS.md history).
//
// DEF-180 — Tools panel titles bold: the Phase-14 checklist promises
// "icon + bold title + description". Measure the computed font-weight of
// EVERY tool title (.tools-palette-entry-label) in BOTH layouts and the
// descriptions' weight, and capture visual evidence.
//
// DEF-181 — Desktop wallpaper show-through: the main process opens the
// window with transparent:true + backgroundMaterial:'acrylic'; the frosted
// renderer must paint NO opaque base (html/body/.app/.tf-ambient all step
// aside) so the OS acrylic composites the REAL desktop wallpaper through
// the glass. Evidence model, same as the original P14-B: compare a
// desktopCapturer screen grab against the renderer's own screenshot over
// a grid inside the window region (pngjs), plus per-region diffs (title
// bar / left rail / tools panel / document canvas) and an alpha audit of
// the renderer surface. Screenshots: def-180-retest*.png, def-181-retest*.png.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { PNG } = require('pngjs');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose, openSample } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

let electronApp = null;
let win = null;
let rendererErrors = [];

function snap(name) {
  return win.screenshot({ path: path.join(SHOTS, name) });
}

function attachErrorCollectors(window) {
  window.on('pageerror', (err) => rendererErrors.push(`pageerror: ${err.message}`));
  window.on('console', (msg) => {
    if (msg.type() === 'error') rendererErrors.push(`console.error: ${msg.text()}`);
  });
}

function facts(label, obj) {
  console.log(`[DEF180-181] ${label}: ${JSON.stringify(obj)}`);
}

/** Computed weight facts for every tools-palette entry in the current layout. */
async function entryWeights() {
  return win.evaluate(() => {
    const palette = document.querySelector('[data-tools-palette]');
    if (!palette) return null;
    const entries = Array.from(palette.querySelectorAll('.tools-palette-entry, .tools-palette-entry-grid'))
      .map((e) => {
        const label = e.querySelector('.tools-palette-entry-label');
        const desc = e.querySelector('.tools-palette-entry-desc');
        return {
          id: e.getAttribute('data-tool-id'),
          label: (label && label.textContent || '').trim(),
          labelWeight: label ? getComputedStyle(label).fontWeight : null,
          descWeight: desc ? getComputedStyle(desc).fontWeight : null,
        };
      });
    return {
      layout: palette.getAttribute('data-layout'),
      count: entries.length,
      entries,
    };
  });
}

test.describe.serial('DEF-180 / DEF-181 retest', () => {
  test.afterEach(async () => {
    if (rendererErrors.length > 0) {
      console.log(`[DEF180-181] renderer errors: ${JSON.stringify(rendererErrors.slice(0, 10))}`);
    }
    await hardClose(electronApp);
    electronApp = null;
    win = null;
    rendererErrors = [];
  });

  test('D180: tool titles bold (>=600) in list AND grid; descriptions stay 400', async () => {
    test.setTimeout(180000);
    electronApp = await launchApp();
    win = await electronApp.firstWindow();
    attachErrorCollectors(win);
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSample(win, electronApp, 'report.pdf');
    await win.waitForTimeout(1500);

    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
    await win.waitForTimeout(500);

    // LIST layout.
    const list = await entryWeights();
    facts('listWeights', {
      layout: list.layout,
      count: list.count,
      distinctLabelWeights: [...new Set(list.entries.map((e) => e.labelWeight))],
      distinctDescWeights: [...new Set(list.entries.map((e) => e.descWeight))],
      sample: list.entries.slice(0, 6),
    });
    expect(list.count).toBeGreaterThanOrEqual(14);
    for (const e of list.entries) {
      expect(e.labelWeight, `label not bold on ${e.label}`).toBe('600');
      expect(e.descWeight, `description weight changed on ${e.label}`).toBe('400');
    }

    await win.mouse.move(2, 2);
    await win.waitForTimeout(300);
    await win.screenshot({ path: path.join(SHOTS, 'def-180-retest.png') });

    // GRID layout.
    await win.click('[data-tools-layout="grid"]');
    await win.waitForTimeout(600);
    const grid = await entryWeights();
    facts('gridWeights', {
      layout: grid.layout,
      count: grid.count,
      distinctLabelWeights: [...new Set(grid.entries.map((e) => e.labelWeight))],
      distinctDescWeights: [...new Set(grid.entries.map((e) => e.descWeight))],
      sample: grid.entries.slice(0, 6),
    });
    expect(grid.layout).toBe('grid');
    expect(grid.count).toBeGreaterThanOrEqual(14);
    for (const e of grid.entries) {
      expect(e.labelWeight, `grid label not bold on ${e.label}`).toBe('600');
      expect(e.descWeight, `grid description weight changed on ${e.label}`).toBe('400');
    }

    await win.mouse.move(2, 2);
    await win.waitForTimeout(300);
    await win.screenshot({ path: path.join(SHOTS, 'def-180-retest-grid.png') });
  });

  test('D181: frosted renderer paints no opaque base; wallpaper composites through the glass', async () => {
    test.setTimeout(240000);
    electronApp = await launchApp();
    win = await electronApp.firstWindow();
    attachErrorCollectors(win);
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSample(win, electronApp, 'report.pdf');
    await win.waitForTimeout(2200);

    const theme = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBe('frosted');

    // Open the tools palette so the right panel is part of the glass check.
    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
    await win.waitForTimeout(500);
    await win.mouse.move(2, 2);
    await win.waitForTimeout(400);

    // 1) Deterministic transparency contract: NOTHING under the glass
    //    panels may paint an opaque base in frosted.
    const layers = await win.evaluate(() => {
      const rgba = (str) => {
        const m = /rgba?\(([^)]+)\)/.exec(str || '');
        if (!m) return { a: null };
        const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
        return { str: str || 'transparent', a: parts.length > 3 ? parts[3] : 1 };
      };
      const pick = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          bg: cs.backgroundColor,
          alpha: rgba(cs.backgroundColor).a,
          backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
        };
      };
      const canvas = document.querySelector('.tab-pane[aria-hidden="false"] .pdf-page[data-page="1"] canvas');
      const page = document.querySelector('.tab-pane[aria-hidden="false"] .pdf-page[data-page="1"]');
      return {
        html: pick(':root'),
        body: pick('body'),
        app: pick('.app'),
        ambient: pick('.tf-ambient'),
        titlebar: pick('.titlebar'),
        sideRail: pick('.side-rail'),
        palette: pick('[data-tools-palette]'),
        pageBackdrop: page ? (getComputedStyle(page).backdropFilter || 'none') : null,
        canvasOpacity: canvas ? getComputedStyle(canvas).opacity : null,
      };
    });
    facts('layers', layers);
    expect(layers.html.alpha).toBeLessThan(0.05);
    expect(layers.body.alpha).toBeLessThan(0.05);
    expect(layers.app.alpha).toBeLessThan(0.05);
    expect(layers.ambient.alpha).toBeLessThan(0.05); // the old bug: opaque rgb(238,241,246) base here
    // Glass contract intact on the three chrome sheets the checklist names.
    for (const key of ['titlebar', 'sideRail', 'palette']) {
      expect(layers[key].alpha, `${key} must stay translucent`).toBeLessThan(0.9);
      expect(layers[key].backdropFilter, `${key} must keep its blur`).toContain('blur(22px)');
    }
    // DEF-099 regression: the document canvas stays solid paper.
    expect(layers.pageBackdrop).toBe('none');
    expect(layers.canvasOpacity).toBe('1');

    // 2) Renderer screenshot + OS screen grab. The renderer surface should
    //    now be mostly TRANSPARENT outside the panels/page (alpha audit),
    //    and the OS grab should show the wallpaper through the glass.
    const pagePngPath = path.join(SHOTS, 'def-181-retest-renderer.png');
    await win.screenshot({ path: pagePngPath });

    const grab = await electronApp.evaluate(async ({ desktopCapturer, screen }) => {
      const prim = screen.getPrimaryDisplay();
      const size = prim.size;
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: size.width, height: size.height },
      });
      return { png: sources[0].thumbnail.toPNG().toString('base64'), scaleFactor: prim.scaleFactor };
    });
    const bounds = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getContentBounds());
    facts('windowBounds', bounds);

    const desktopPath = path.join(SHOTS, 'def-181-retest.png');
    fs.writeFileSync(desktopPath, Buffer.from(grab.png, 'base64'));

    const pagePng = PNG.sync.read(fs.readFileSync(pagePngPath));
    const deskPng = PNG.sync.read(fs.readFileSync(desktopPath));

    // Alpha audit of the renderer surface: fraction of sampled pixels with
    // alpha < 250, per region. With the fix the renderer paints NO base, so
    // chrome regions must be largely transparent; the PDF canvas stays opaque.
    const alphaAudit = (x0f, x1f, y0f, y1f) => {
      let transparent = 0, total = 0;
      const gx = 24, gy = 16;
      for (let iy = 0; iy < gy; iy += 1) {
        for (let ix = 0; ix < gx; ix += 1) {
          const fx = x0f + ((ix + 0.5) / gx) * (x1f - x0f);
          const fy = y0f + ((iy + 0.5) / gy) * (y1f - y0f);
          const px = Math.min(pagePng.width - 1, Math.round(fx * pagePng.width));
          const py = Math.min(pagePng.height - 1, Math.round(fy * pagePng.height));
          const a = pagePng.data[(py * pagePng.width + px) * 4 + 3];
          total += 1;
          if (a < 250) transparent += 1;
        }
      }
      return { transparentFrac: Number((transparent / Math.max(1, total)).toFixed(3)), samples: total };
    };
    const titlebarAlpha = alphaAudit(0, 1, 0, 48 / bounds.height);
    const railAlpha = alphaAudit(0, 64 / bounds.width, 48 / bounds.height, 1);
    const paletteAlphaAudit = alphaAudit(1 - 360 / bounds.width, 1, 48 / bounds.height, 1);
    const canvasAlphaRect = await win.evaluate(() => {
      // The active page slot's own rect, mapped into window fractions.
      const page = document.querySelector('.tab-pane[aria-hidden="false"] .pdf-page[data-page="1"]');
      if (!page) return null;
      const r = page.getBoundingClientRect();
      return {
        x0: r.left / window.innerWidth, x1: r.right / window.innerWidth,
        y0: r.top / window.innerHeight, y1: r.bottom / window.innerHeight,
      };
    });
    const canvasAlphaStats = canvasAlphaRect
      ? alphaAudit(canvasAlphaRect.x0, canvasAlphaRect.x1, canvasAlphaRect.y0, canvasAlphaRect.y1)
      : null;
    facts('rendererAlphaAudit', {
      note: 'transparentFrac = fraction of sampled pixels with alpha<250 in the renderer screenshot; renderer no longer paints an opaque base means chrome regions are transparent, canvas opaque',
      titlebar: titlebarAlpha,
      sideRail: railAlpha,
      toolsPalette: paletteAlphaAudit,
      canvas: canvasAlphaStats,
    });

    // Desktop-composite diff (same model as P14-B): 12x8 grid inside the
    // window region, mean/max abs RGB delta 0-255, plus per-region splits.
    const dw = deskPng.width, dh = deskPng.height;
    const gridW = 12, gridH = 8;
    const regionOf = (fx, fy) => {
      if (fy < 48 / bounds.height) return 'titlebar';
      if (fx < 64 / bounds.width) return 'sideRail';
      if (fx > 1 - 360 / bounds.width) return 'toolsPalette';
      return 'canvas';
    };
    const samplesByRegion = { titlebar: [], sideRail: [], toolsPalette: [], canvas: [] };
    for (let gy = 0; gy < gridH; gy += 1) {
      for (let gx = 0; gx < gridW; gx += 1) {
        const fx = (gx + 0.5) / gridW, fy = (gy + 0.5) / gridH;
        const px = bounds.x + Math.round(fx * bounds.width);
        const py = bounds.y + Math.round(fy * bounds.height);
        if (px >= dw || py >= dh) continue;
        const di = (py * dw + px) * 4;
        const qx = Math.min(pagePng.width - 1, Math.round(fx * pagePng.width));
        const qy = Math.min(pagePng.height - 1, Math.round(fy * pagePng.height));
        const qi = (qy * pagePng.width + qx) * 4;
        const d = (Math.abs(deskPng.data[di] - pagePng.data[qi])
          + Math.abs(deskPng.data[di + 1] - pagePng.data[qi + 1])
          + Math.abs(deskPng.data[di + 2] - pagePng.data[qi + 2])) / 3;
        samplesByRegion[regionOf(fx, fy)].push(Number(d.toFixed(2)));
      }
    }
    const regionStats = {};
    for (const [region, arr] of Object.entries(samplesByRegion)) {
      const mean = arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
      const max = arr.reduce((a, b) => Math.max(a, b), 0);
      regionStats[region] = { mean: Number(mean.toFixed(2)), max, n: arr.length };
    }
    const all = Object.values(samplesByRegion).flat();
    const meanDiff = all.reduce((a, b) => a + b, 0) / Math.max(1, all.length);
    const maxDiff = all.reduce((a, b) => Math.max(a, b), 0);
    facts('desktopCompositeDiff', {
      note: 'mean/max 0-255 over 12x8 grid inside window; old self-composited baseline was mean 2.39/max 20.3 (DEF-181 original); regions show WHERE the OS now shows something the renderer did not paint',
      meanDiff: Number(meanDiff.toFixed(2)),
      maxDiff,
      regions: regionStats,
      grabSize: [dw, dh],
      pageShotSize: [pagePng.width, pagePng.height],
    });

    // Dedicated TITLE-BAR strip diff: the coarse 12x8 grid produced no
    // titlebar samples (its first row center sits below the 48px band), so
    // scan the top band explicitly (24x4 grid inside y 0..48).
    const tbStats = (() => {
      const arr = [];
      const gx = 24, gy = 4;
      for (let iy = 0; iy < gy; iy += 1) {
        for (let ix = 0; ix < gx; ix += 1) {
          const fx = (ix + 0.5) / gx;
          const fy = ((iy + 0.5) / gy) * (48 / bounds.height);
          const px = bounds.x + Math.round(fx * bounds.width);
          const py = bounds.y + Math.round(fy * bounds.height);
          if (px >= dw || py >= dh) continue;
          const di = (py * dw + px) * 4;
          const qx = Math.min(pagePng.width - 1, Math.round(fx * pagePng.width));
          const qy = Math.min(pagePng.height - 1, Math.round(fy * pagePng.height));
          const qi = (qy * pagePng.width + qx) * 4;
          arr.push((Math.abs(deskPng.data[di] - pagePng.data[qi])
            + Math.abs(deskPng.data[di + 1] - pagePng.data[qi + 1])
            + Math.abs(deskPng.data[di + 2] - pagePng.data[qi + 2])) / 3);
        }
      }
      const mean = arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
      const max = arr.reduce((a, b) => Math.max(a, b), 0);
      return { mean: Number(mean.toFixed(2)), max, n: arr.length };
    })();
    facts('titlebarStripDiff', {
      note: 'OS grab vs renderer paint over the title-bar band only (y 0..48)',
      ...tbStats,
    });

    // Wallpaper context: what the desktop looks like OUTSIDE the window
    // (a 16px strip right of the window and one below, clamped to screen).
    const outside = [];
    for (let y = 0; y < dh; y += Math.max(1, Math.floor(dh / 24))) {
      for (let x = bounds.x + bounds.width + 4; x < Math.min(dw, bounds.x + bounds.width + 40); x += 8) {
        if (x >= dw) continue;
        const i = (y * dw + x) * 4;
        outside.push([deskPng.data[i], deskPng.data[i + 1], deskPng.data[i + 2]]);
      }
    }
    if (outside.length) {
      const avg = [0, 1, 2].map((c) => Math.round(outside.reduce((a, p) => a + p[c], 0) / outside.length));
      facts('desktopOutsideWindow', { sampleCount: outside.length, avgRGB: avg });
    }
  });
});