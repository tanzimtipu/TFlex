// PHASE 14 QA — Liquid Glass theme verification against the reference
// checklist (desktop-wallpaper-through-glass, Tools panel structure,
// rounded corners 16-20px, subtle blur, spring animations).
//
// Drives the REAL dev build through the canonical launcher (launchApp).
// Evidence model, per the qa brief: never trust the save dialog / DOM
// alone — measure computed styles in the running app, sample the actual
// animation frames, and capture screenshots to screenshots/phase14-qa-*.png.
// The desktop-composite check (does the OS wallpaper really composite
// through the window, or does the app's own aurora stand in?) compares a
// desktopCapturer screen grab against the renderer's own screenshot of the
// same window region with pngjs.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { PNG } = require('pngjs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, openSample } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

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
  console.log(`[P14QA] ${label}: ${JSON.stringify(obj)}`);
}

/** Computed material facts for one selector (color alpha, blur, radius, transform). */
async function materialOf(selector) {
  return win.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const rgba = (str) => {
      const m = /rgba?\(([^)]+)\)/.exec(str || '');
      if (!m) return { a: null };
      const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
      return { a: parts.length > 3 ? parts[3] : 1 };
    };
    return {
      bg: cs.backgroundColor,
      alpha: rgba(cs.backgroundColor).a,
      backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
      borderRadius: cs.borderRadius,
      transition: cs.transition,
      textTransform: cs.textTransform,
    };
  }, selector);
}

/** Truncation audit: every element matching sel must render its text fully
 *  (no horizontal clip, no vertical clip) — wrap is allowed, clipping is not. */
async function truncationAudit(selector) {
  return win.evaluate((sel) => {
    const els = Array.from(document.querySelectorAll(sel));
    return els.map((el) => {
      const cs = getComputedStyle(el);
      return {
        text: (el.textContent || '').trim().slice(0, 48),
        clippedX: el.scrollWidth > el.clientWidth + 1,
        clippedY: el.scrollHeight > el.clientHeight + 2,
        whiteSpace: cs.whiteSpace,
        textOverflow: cs.textOverflow,
        overflowX: cs.overflowX,
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
      };
    });
  }, selector);
}

/** Sample the animated transform of the palette over ~900ms via rAF. */
async function samplePaletteMotion(ms = 900) {
  await win.evaluate((msArg) => {
    window.__p14samples = [];
    const t0 = performance.now();
    const cb = () => {
      const el = document.querySelector('[data-tools-palette]');
      const m = el ? getComputedStyle(el).transform : 'detached';
      window.__p14samples.push({ t: Math.round(performance.now() - t0), m });
      if (performance.now() - t0 < msArg) requestAnimationFrame(cb);
    };
    requestAnimationFrame(cb);
  }, ms);
}

/** Sample the animated transform of one entry during a hover spring. */
async function sampleEntryTransform(selector, ms = 500) {
  return win.evaluate(({ sel, msArg }) => {
    return new Promise((resolve) => {
      const out = [];
      const t0 = performance.now();
      const cb = () => {
        const el = document.querySelector(sel);
        if (el) out.push({ t: Math.round(performance.now() - t0), m: getComputedStyle(el).transform });
        if (performance.now() - t0 < msArg) requestAnimationFrame(cb);
        else resolve(out);
      };
      requestAnimationFrame(cb);
    });
  }, { sel: selector, msArg: ms });
}

function parseMatrixScale(m) {
  const match = /matrix\(([^)]+)\)/.exec(m || '');
  if (!match) return null;
  const parts = match[1].split(',').map((s) => parseFloat(s.trim()));
  return { a: parts[0], tx: parts[4], ty: parts[5] };
}

test.describe.serial('phase 14 liquid glass qa verification', () => {
  test.afterEach(async () => {
    if (rendererErrors.length > 0) {
      console.log(`[P14QA] renderer errors: ${JSON.stringify(rendererErrors.slice(0, 10))}`);
    }
    await hardClose(electronApp);
    electronApp = null;
    win = null;
    rendererErrors = [];
  });

  test('P14-A welcome: aurora ambient behind translucent frosted chrome', async () => {
    test.setTimeout(180000);
    electronApp = await launchApp();
    win = await electronApp.firstWindow();
    attachErrorCollectors(win);
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(900);

    const theme = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBe('frosted');

    const ambient = await win.evaluate(() => {
      const el = document.querySelector('.tf-ambient');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        gradients: (cs.backgroundImage.match(/radial-gradient\(/g) || []).length,
        backgroundImage: cs.backgroundImage.slice(0, 220),
        backgroundColor: cs.backgroundColor,
        pointerEvents: cs.pointerEvents,
        transform: cs.transform,
        parallaxX: el.style.getPropertyValue('--tf-parallax-x') || '(unset)',
        parallaxY: el.style.getPropertyValue('--tf-parallax-y') || '(unset)',
      };
    });
    facts('ambient', ambient);
    expect(ambient).not.toBeNull();
    expect(ambient.gradients).toBe(4);
    expect(ambient.pointerEvents).toBe('none');

    const titlebar = await materialOf('.titlebar');
    facts('titlebar', { bg: titlebar.bg, backdropFilter: titlebar.backdropFilter, radius: titlebar.borderRadius });
    expect(titlebar.alpha).not.toBeNull();
    expect(titlebar.alpha).toBeLessThan(0.9); // translucent, not solid
    // Phase 14.1 — the neutral glass drops the blur 22px -> 20px and the
    // saturation boost 1.3 -> 1.2 (restrained saturation is a 14.1 goal).
    expect(titlebar.backdropFilter).toContain('blur(20px)');
    // Computed style serializes saturate(120%) as saturate(1.2).
    expect(titlebar.backdropFilter).toMatch(/saturate\((?:1\.2|120%)\)/);

    const appAndBody = await win.evaluate(() => ({
      htmlBg: getComputedStyle(document.documentElement).backgroundColor,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      appBg: getComputedStyle(document.querySelector('.app')).backgroundColor,
      appPosition: getComputedStyle(document.querySelector('.app')).position,
    }));
    facts('frames', appAndBody);
    expect(appAndBody.appBg).toBe('rgba(0, 0, 0, 0)'); // frosted .app steps aside for the ambient

    await snap('phase14-qa-01-welcome-frosted.png');
  });

  test('P14-B workspace: glass chrome around a crisp PDF canvas + desktop-composite check', async () => {
    test.setTimeout(240000);
    electronApp = await launchApp();
    win = await electronApp.firstWindow();
    attachErrorCollectors(win);
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSample(win, electronApp, 'report.pdf');
    await win.waitForTimeout(2200);

    // PDF canvas purity (DEF-099): no glass on the page itself.
    const pageFacts = await win.evaluate(() => {
      const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
      const page = pane && pane.querySelector('.pdf-page[data-page="1"]');
      const canvas = page && page.querySelector('canvas');
      if (!page || !canvas) return null;
      const cs = getComputedStyle(page);
      const ccs = getComputedStyle(canvas);
      return {
        pageBackdrop: cs.backdropFilter || 'none',
        pageBg: cs.backgroundColor,
        canvasBackdrop: ccs.backdropFilter || 'none',
        canvasOpacity: ccs.opacity,
      };
    });
    facts('pdfPage', pageFacts);
    expect(pageFacts).not.toBeNull();
    expect(pageFacts.pageBackdrop).toBe('none');
    expect(pageFacts.canvasBackdrop).toBe('none');
    expect(pageFacts.canvasOpacity).toBe('1');

    const rail = await materialOf('.side-rail');
    facts('sideRail', { bg: rail.bg, alpha: rail.alpha, backdropFilter: rail.backdropFilter, radius: rail.borderRadius });
    expect(rail.alpha).toBeLessThan(0.9);
    expect(rail.backdropFilter).toContain('blur(20px)');
    // Floating card: ALL four corners rounded at the 16px panel radius.
    expect(rail.borderRadius.replace(/0px/g, '0')).toContain('16px');

    await snap('phase14-qa-02-workspace-frosted.png');

    // Desktop-composite check: what the OS actually shows vs what the
    // renderer thinks it painted. Move the pointer somewhere inert first.
    await win.mouse.move(2, 2);
    await win.waitForTimeout(400);
    const pagePngPath = path.join(SHOTS, 'phase14-qa-08-page-render-frosted.png');
    await win.screenshot({ path: pagePngPath });

    const grab = await electronApp.evaluate(async ({ desktopCapturer, screen }) => {
      const prim = screen.getPrimaryDisplay();
      const size = prim.size;
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: size.width, height: size.height },
      });
      const winBounds = null; // bounds are fetched separately below
      void winBounds;
      return { png: sources[0].thumbnail.toPNG().toString('base64'), scaleFactor: prim.scaleFactor };
    });

    const bounds = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getContentBounds());
    facts('windowBounds', bounds);

    const desktopPath = path.join(SHOTS, 'phase14-qa-07-desktop-behind-window.png');
    fs.writeFileSync(desktopPath, Buffer.from(grab.png, 'base64'));

    // Numeric diff of the window region between the desktop grab and the
    // page screenshot (12x8 grid mean abs delta, 0-255 scale).
    const pagePng = PNG.sync.read(fs.readFileSync(pagePngPath));
    const deskPng = PNG.sync.read(fs.readFileSync(desktopPath));
    // Desktop grab covers the primary display at DIP resolution; the window
    // sits at its DIP bounds inside it. Sample a 12x8 grid INSIDE the window
    // region on both images.
    const dw = deskPng.width, dh = deskPng.height;
    const gridW = 12, gridH = 8;
    const samples = [];
    for (let gy = 0; gy < gridH; gy += 1) {
      for (let gx = 0; gx < gridW; gx += 1) {
        const px = bounds.x + Math.round(((gx + 0.5) / gridW) * bounds.width);
        const py = bounds.y + Math.round(((gy + 0.5) / gridH) * bounds.height);
        if (px >= dw || py >= dh) continue;
        // desktop grab pixel (DIP-mapped capture)
        const di = (py * dw + px) * 4;
        // page screenshot pixel (same fractions of the window rect)
        const qx = Math.min(pagePng.width - 1, Math.round(((px - bounds.x) / bounds.width) * pagePng.width));
        const qy = Math.min(pagePng.height - 1, Math.round(((py - bounds.y) / bounds.height) * pagePng.height));
        const qi = (qy * pagePng.width + qx) * 4;
        const dr = Math.abs(deskPng.data[di] - pagePng.data[qi]);
        const dg = Math.abs(deskPng.data[di + 1] - pagePng.data[qi + 1]);
        const db = Math.abs(deskPng.data[di + 2] - pagePng.data[qi + 2]);
        samples.push((dr + dg + db) / 3);
      }
    }
    const meanDiff = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
    const maxDiff = samples.reduce((a, b) => Math.max(a, b), 0);
    facts('desktopCompositeDiff', {
      note: 'mean/max 0-255 over 12x8 grid inside window; ~0 means window is self-composited (no wallpaper through), large means the OS shows something the renderer did not paint',
      meanDiff: Number(meanDiff.toFixed(2)),
      maxDiff: Number(maxDiff.toFixed(2)),
      samples: samples.length,
      grabSize: [dw, dh],
      pageShotSize: [pagePng.width, pagePng.height],
    });
  });

  test('P14-C tools panel (list): structure, full descriptions, width, 16px radius', async () => {
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

    const structure = await win.evaluate(() => {
      const palette = document.querySelector('[data-tools-palette]');
      // Phase 14.1: the palette header is the shared GlassSidebarHeader,
      // so the title span is .glass-sidebar-title (the old
      // .tools-palette-title span is gone with the legacy header).
      const title = palette.querySelector('.glass-sidebar-title');
      const toggles = Array.from(palette.querySelectorAll('[data-tools-layout]')).map((b) => ({
        layout: b.getAttribute('data-tools-layout'),
        pressed: b.getAttribute('aria-pressed'),
        visible: !!(b.offsetWidth || b.offsetHeight),
      }));
      const groups = Array.from(palette.querySelectorAll('[data-tools-group]')).map((g) => {
        const label = g.querySelector('.tools-palette-group-label');
        const entries = Array.from(g.querySelectorAll('.tools-palette-entry'));
        return {
          id: g.getAttribute('data-tools-group'),
          labelText: (label.textContent || '').trim(),
          textTransform: getComputedStyle(label).textTransform,
          entries: entries.length,
        };
      });
      const entries = Array.from(palette.querySelectorAll('.tools-palette-entry')).map((e) => {
        const iconSvg = e.querySelector('.tools-palette-entry-icon svg');
        const label = e.querySelector('.tools-palette-entry-label');
        const desc = e.querySelector('.tools-palette-entry-desc');
        const lcs = label ? getComputedStyle(label) : null;
        const dcs = desc ? getComputedStyle(desc) : null;
        return {
          id: e.getAttribute('data-tool-id'),
          disabled: e.disabled,
          hasIcon: !!iconSvg,
          label: (label && label.textContent || '').trim(),
          desc: (desc && desc.textContent || '').trim(),
          labelWeight: lcs ? lcs.fontWeight : null,
          descWhite: dcs ? dcs.whiteSpace : null,
          descOverflowX: dcs ? dcs.overflowX : null,
          descClipX: desc ? desc.scrollWidth > desc.clientWidth + 1 : null,
          descClipY: desc ? desc.scrollHeight > desc.clientHeight + 2 : null,
          labelClipX: label ? label.scrollWidth > label.clientWidth + 1 : null,
        };
      });
      const cs = getComputedStyle(palette);
      return {
        layout: palette.getAttribute('data-layout'),
        title: (title.textContent || '').trim(),
        toggles,
        groups,
        entries,
        panelWidth: palette.offsetWidth,
        panelMinWidth: cs.minWidth,
        panelMaxWidth: cs.maxWidth,
        paletteBg: cs.backgroundColor,
        paletteRadius: cs.borderRadius,
        backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
      };
    });

    facts('paletteList', {
      layout: structure.layout,
      title: structure.title,
      toggles: structure.toggles,
      groups: structure.groups,
      panelWidth: structure.panelWidth,
      paletteBg: structure.paletteBg,
      paletteRadius: structure.paletteRadius,
      backdropFilter: structure.backdropFilter,
      entryCount: structure.entries.length,
    });

    // Checklist: title "Tools" with grid/list toggle.
    expect(structure.title).toBe('Tools');
    expect(structure.toggles).toHaveLength(2);
    expect(structure.toggles.map((t) => t.layout).sort()).toEqual(['grid', 'list']);
    expect(structure.toggles.every((t) => t.visible)).toBe(true);
    expect(structure.toggles.find((t) => t.layout === 'list').pressed).toBe('true');

    // Sections present, uppercase display.
    const groupIds = structure.groups.map((g) => g.id);
    expect(groupIds).toContain('organize');
    expect(groupIds).toContain('document');
    for (const g of structure.groups) {
      expect(g.textTransform || 'none').toBe('uppercase');
      expect(g.entries).toBeGreaterThan(0);
    }
    facts('groupDisplayLabels', structure.groups.map((g) => g.labelText));

    // Every entry: icon + bold title + description; nothing clipped.
    const labelWeights = new Set();
    expect(structure.entries.length).toBeGreaterThanOrEqual(14);
    for (const e of structure.entries) {
      expect(e.hasIcon, `icon missing on ${e.label}`).toBe(true);
      expect(e.label.length, `label missing on ${e.label}`).toBeGreaterThan(0);
      expect(e.desc.length, `description missing on ${e.label}`).toBeGreaterThan(0);
      // Checklist says "bold title" — asserted since the DEF-180 fix
      // (weight 600 in BOTH layouts; the grid override only retunes the
      // font-size, so the shared 600 weight reaches the grid cards too).
      labelWeights.add(Number(e.labelWeight));
      expect(Number(e.labelWeight), `title not bold on ${e.label}`).toBeGreaterThanOrEqual(600);
      expect(e.descClipX, `desc horizontally clipped on ${e.label}`).toBe(false);
      expect(e.descClipY, `desc vertically clipped on ${e.label}`).toBe(false);
      expect(e.labelClipX, `label clipped on ${e.label}`).toBe(false);
      expect(e.descOverflowX).not.toBe('hidden');
    }
    const clipped = structure.entries.filter((e) => e.descClipX || e.descClipY || e.labelClipX);
    facts('truncationAudit', { clippedCount: clipped.length, clipped: clipped.map((e) => e.label) });
    facts('labelWeights', {
      distinct: [...labelWeights],
      note: 'checklist promises a bold title (>=600); see DEF-180',
    });

    // Dynamic width: inside bounds, wide enough to hold the wrapped text.
    expect(structure.panelWidth).toBeGreaterThanOrEqual(320);
    expect(structure.paletteRadius.replace(/0px/g, '0')).toContain('16px');
    expect(structure.paletteBg.startsWith('rgba')).toBe(true);
    const palAlpha = Number(/rgba?\([^)]*,\s*([\d.]+)\)/.exec(structure.paletteBg)[1]);
    facts('paletteAlpha', palAlpha);
    expect(palAlpha).toBeLessThan(0.9);
    expect(structure.backdropFilter).toContain('blur(20px)');

    await snap('phase14-qa-03-palette-list-frosted.png');
  });

  test('P14-D tools panel (grid): cards keep icon+title+description, never icon-only', async () => {
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
    await win.click('[data-tools-layout="grid"]');
    await win.waitForTimeout(500);

    const grid = await win.evaluate(() => {
      const palette = document.querySelector('[data-tools-palette]');
      const cards = Array.from(palette.querySelectorAll('.tools-palette-entry-grid')).map((e) => {
        const iconSvg = e.querySelector('.tools-palette-entry-icon svg');
        const label = e.querySelector('.tools-palette-entry-label');
        const desc = e.querySelector('.tools-palette-entry-desc');
        const dcs = desc ? getComputedStyle(desc) : null;
        return {
          label: (label && label.textContent || '').trim(),
          desc: (desc && desc.textContent || '').trim(),
          hasIcon: !!iconSvg,
          descPresent: !!desc && desc.textContent.trim().length > 0,
          descClipX: desc ? desc.scrollWidth > desc.clientWidth + 1 : null,
          descWhite: dcs ? dcs.whiteSpace : null,
          labelClipX: label ? label.scrollWidth > label.clientWidth + 1 : null,
        };
      });
      const groupGrid = palette.querySelector('.tools-palette-group-grid');
      const cols = groupGrid ? getComputedStyle(groupGrid).gridTemplateColumns.split(' ').length : 0;
      const card0 = palette.querySelector('.tools-palette-entry-grid');
      const card0cs = card0 ? getComputedStyle(card0) : null;
      return {
        layout: palette.getAttribute('data-layout'),
        panelWidth: palette.offsetWidth,
        cols,
        cardRadius: card0cs ? card0cs.borderRadius : null,
        cardBg: card0cs ? card0cs.backgroundColor : null,
        cards,
      };
    });
    facts('paletteGrid', {
      layout: grid.layout,
      panelWidth: grid.panelWidth,
      cols: grid.cols,
      cardRadius: grid.cardRadius,
      cardBg: grid.cardBg,
      cardCount: grid.cards.length,
      sample: grid.cards.slice(0, 3),
    });
    expect(grid.layout).toBe('grid');
    expect(grid.cols).toBe(2);
    expect(grid.cards.length).toBeGreaterThanOrEqual(14);
    for (const c of grid.cards) {
      expect(c.hasIcon, `icon missing on grid card ${c.label}`).toBe(true);
      expect(c.descPresent, `description missing on grid card ${c.label}`).toBe(true);
      expect(c.descClipX, `desc clipped on grid card ${c.label}`).toBe(false);
      expect(c.labelClipX, `label clipped on grid card ${c.label}`).toBe(false);
      expect(c.descWhite).toBe('normal');
    }
    expect(grid.cardRadius).toBe('12px');

    await snap('phase14-qa-04-palette-grid-frosted.png');
  });

  test('P14-E spring motion: hover overshoot curve, panel open spring, 60fps probe, parallax', async () => {
    test.setTimeout(240000);
    electronApp = await launchApp();
    win = await electronApp.firstWindow();
    attachErrorCollectors(win);
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSample(win, electronApp, 'report.pdf');
    await win.waitForTimeout(1500);

    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
    await win.waitForTimeout(500);

    // 1) Spring curve on the hover transition (computed). NOTE: do NOT
    //    split the transition shorthand on commas — cubic-bezier()
    //    contains commas. Assert with regexes over the whole string.
    const hoverTransition = await win.evaluate(() =>
      getComputedStyle(document.querySelector('.tools-palette-entry:not([disabled])')).transition);
    facts('hoverTransition', { transition: hoverTransition });
    expect(hoverTransition).toMatch(/transform 0\.22s cubic-bezier\(0\.34, 1\.56, 0\.64, 1\)/);
    expect(hoverTransition).toMatch(/box-shadow 0\.22s cubic-bezier\(0\.34, 1\.56, 0\.64, 1\)/);

    // 2) Hover an entry, sample the spring: expect scale ~1.02 and an
    //    overshoot above 1.02 somewhere in the curve (y2=1.56 bezier).
    const entryBox = await win.locator('.tools-palette-entry:not([disabled])').first().boundingBox();
    await win.mouse.move(entryBox.x + entryBox.width / 2, entryBox.y + entryBox.height / 2, { steps: 4 });
    const hoverSamples = await sampleEntryTransform('.tools-palette-entry:not([disabled]):hover', 480);
    const scales = hoverSamples
      .map((s) => parseMatrixScale(s.m))
      .filter((p) => p && p.a)
      .map((p) => p.a);
    const maxScale = scales.length ? Math.max(...scales) : null;
    const settledScale = scales.length ? scales[scales.length - 1] : null;
    facts('hoverSpring', {
      samples: hoverSamples.length,
      firstScale: scales[0] ?? null,
      maxScale: maxScale === null ? null : Number(maxScale.toFixed(5)),
      finalScale: settledScale === null ? null : Number(settledScale.toFixed(5)),
      overshoot: maxScale !== null && maxScale > 1.0201,
    });
    expect(settledScale).toBeCloseTo(1.02, 2);
    await snap('phase14-qa-05-palette-hover.png');

    // 3) Panel open spring: close, then reopen while sampling x.
    await win.click('[data-tools-toggle]');
    await win.waitForTimeout(500);
    const closed = await win.evaluate(() => !document.querySelector('[data-tools-palette]'));
    facts('paletteClosedOnToggle', closed);
    await samplePaletteMotion(900);
    await win.click('[data-tools-toggle]');
    await win.waitForTimeout(1000);
    const openSamples = await win.evaluate(() => window.__p14samples);
    const txs = openSamples
      .filter((s) => s.m && s.m !== 'detached' && s.m !== 'none')
      .map((s) => ({ t: s.t, tx: parseMatrixScale(s.m)?.tx }));
    facts('openSpring', {
      sampleCount: txs.length,
      first: txs[0] ?? null,
      last: txs[txs.length - 1] ?? null,
      spanMs: txs.length ? txs[txs.length - 1].t - txs[0].t : 0,
      path: txs.slice(0, 14).map((s) => s.tx),
    });
    // Spring, not a snap: multiple samples while the panel travels, and the
    // final x settles at 0.
    expect(txs.length).toBeGreaterThanOrEqual(8);
    expect(Math.abs(txs[txs.length - 1].tx)).toBeLessThan(0.5);
    const big = txs.filter((s) => Math.abs(s.tx) > 1).length;
    expect(big, 'open must travel through intermediate positions').toBeGreaterThanOrEqual(4);

    // 4) Frame-rate probe across the palette (hover springs + parallax).
    const entryCount = await win.locator('.tools-palette-entry:not([disabled])').count();
    await win.evaluate(() => {
      window.__frames = [];
      window.__framesDone = false;
      const cb = (t) => {
        window.__frames.push(t);
        if (t > window.__framesEnd) { window.__framesDone = true; return; }
        requestAnimationFrame(cb);
      };
      window.__framesEnd = performance.now() + 2200;
      requestAnimationFrame(cb);
    });
    for (let i = 0; i < entryCount; i += 1) {
      const box = await win.locator('.tools-palette-entry:not([disabled])').nth(i).boundingBox();
      if (!box) continue;
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
      await win.waitForTimeout(90);
    }
    const frames = await win.evaluate(() => window.__frames);
    const deltas = frames.slice(1).map((t, i) => t - frames[i]);
    const longFrames = deltas.filter((d) => d > 100);
    const avgFps = deltas.length ? 1000 / (deltas.reduce((a, b) => a + b, 0) / deltas.length) : 0;
    facts('frameProbe', {
      frameCount: frames.length,
      avgFps: Number(avgFps.toFixed(1)),
      p95Gap: Number((deltas.sort((a, b) => a - b)[Math.floor(deltas.length * 0.95)] || 0).toFixed(1)),
      maxGapMs: Number(Math.max(...deltas).toFixed(1)),
      gapsOver100ms: deltas.filter((d) => d > 100).length,
    });
    expect(avgFps).toBeGreaterThanOrEqual(55);
    expect(deltas.filter((d) => d > 100).length).toBe(0);

    // 5) Parallax: the ambient layer must have followed the pointer.
    const parallax = await win.evaluate(() => {
      const el = document.querySelector('.tf-ambient');
      return {
        x: el.style.getPropertyValue('--tf-parallax-x'),
        y: el.style.getPropertyValue('--tf-parallax-y'),
        transform: getComputedStyle(el).transform,
      };
    });
    facts('parallax', parallax);
    expect(Math.abs(parseFloat(parallax.x))).toBeGreaterThan(0.2);
    expect(Math.abs(parseFloat(parallax.y))).toBeGreaterThan(0);
  });

  test('P14-F focus/defocus blur intensity change (20px <-> 12px)', async () => {
    test.setTimeout(180000);
    electronApp = await launchApp();
    win = await electronApp.firstWindow();
    attachErrorCollectors(win);
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSample(win, electronApp, 'report.pdf');
    await win.waitForTimeout(1500);
    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
    await win.waitForTimeout(600);

    const focusedBlur = await win.evaluate(() => ({
      focus: document.documentElement.getAttribute('data-window-focus'),
      paletteBackdrop: getComputedStyle(document.querySelector('[data-tools-palette]')).backdropFilter,
    }));
    facts('focusState', focusedBlur);
    expect(focusedBlur.focus).toBe('focused');
    expect(focusedBlur.paletteBackdrop).toContain('blur(20px)');

    // Real defocus first: blur the native window. NOTE: Playwright keeps
    // focus emulation on for its targets, so the DOM blur may never fire
    // even though the native window blurred — recorded as a fact below.
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].blur();
    });
    await win.waitForTimeout(300);
    const nativeBlurProbe = await win.evaluate(() => ({
      hasFocus: document.hasFocus(),
      attr: document.documentElement.getAttribute('data-window-focus'),
    }));
    facts('nativeBlurProbe', nativeBlurProbe);

    // Deliver the same event the OS blur would deliver, through the same
    // window listener the ambient controller registered (harness boundary:
    // CDP focus emulation suppresses real blur inside Playwright).
    await win.evaluate(() => window.dispatchEvent(new Event('blur')));
    await win.waitForFunction(
      () => document.documentElement.getAttribute('data-window-focus') === 'blurred',
      null,
      { timeout: 5000 },
    );
    await win.waitForTimeout(400); // let the 180ms blur tween settle
    const blurredBlur = await win.evaluate(() => ({
      paletteBackdrop: getComputedStyle(document.querySelector('[data-tools-palette]')).backdropFilter,
    }));
    facts('blurredState', blurredBlur);
    expect(blurredBlur.paletteBackdrop).toContain('blur(12px)');
    await snap('phase14-qa-06-defocused.png');

    // Refocus restores 20px (same harness boundary: the native focus()
    // alone may not reach the renderer; deliver the event too).
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].focus();
    });
    await win.evaluate(() => window.dispatchEvent(new Event('focus')));
    await win.waitForFunction(
      () => document.documentElement.getAttribute('data-window-focus') === 'focused',
      null,
      { timeout: 5000 },
    );
    await win.waitForTimeout(400);
    const refocused = await win.evaluate(() =>
      getComputedStyle(document.querySelector('[data-tools-palette]')).backdropFilter);
    facts('refocusedBlur', refocused);
    expect(refocused).toContain('blur(20px)');
  });
});