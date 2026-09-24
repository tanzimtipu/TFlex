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

    // Phase 36 (chunk 6) — the retired floating rail card is replaced by the live
    // frosted title bar (same --glass-blur token).
    const rail = await materialOf('.titlebar');
    facts('titlebarGlass', { bg: rail && rail.bg, alpha: rail && rail.alpha, backdropFilter: rail && rail.backdropFilter, radius: rail && rail.borderRadius });
    expect(rail).not.toBeNull();
    expect(rail.alpha).toBeLessThan(0.9);
    expect(rail.backdropFilter).toContain('blur(20px)');

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

  // P14-C (tools panel list) and P14-D (tools panel grid) REMOVED with their
  // subject (Phase 36 chunk 5): the All-tools palette, its list/grid layout
  // toggle, its groups and its frosted backdrop are retired. The replacement
  // surfaces (the Inspector, the Command Palette) carry their own Phase-36
  // gate coverage.

  test('P14-E spring motion: 60fps probe + parallax', async () => {
    test.setTimeout(240000);
    electronApp = await launchApp();
    win = await electronApp.firstWindow();
    attachErrorCollectors(win);
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSample(win, electronApp, 'report.pdf');
    await win.waitForTimeout(1500);

    // Frame-rate probe across the LIVE workspace chrome (the ContextPanel's
    // thumbnails + the Action Dock's verbs), replacing the retired palette
    // hover span.
    const thumbCount = Math.min(8, await win.locator('[data-context-panel] .thumb-item').count());
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
    for (let i = 0; i < thumbCount; i += 1) {
      const box = await win.locator('[data-context-panel] .thumb-item').nth(i).boundingBox();
      if (!box) continue;
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
      await win.waitForTimeout(90);
    }
    const frames = await win.evaluate(() => window.__frames);
    const deltas = frames.slice(1).map((t, i) => t - frames[i]);
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

    // Parallax: the ambient layer must have followed the pointer.
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

    // Phase 36 (chunk 5) — the All-tools palette is retired; the same
    // --glass-blur token is probed on the live frosted title bar.
    const focusedBlur = await win.evaluate(() => ({
      focus: document.documentElement.getAttribute('data-window-focus'),
      paletteBackdrop: getComputedStyle(document.querySelector('.titlebar')).backdropFilter,
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
      paletteBackdrop: getComputedStyle(document.querySelector('.titlebar')).backdropFilter,
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
      getComputedStyle(document.querySelector('.titlebar')).backdropFilter);
    facts('refocusedBlur', refocused);
    expect(refocused).toContain('blur(20px)');
  });
});