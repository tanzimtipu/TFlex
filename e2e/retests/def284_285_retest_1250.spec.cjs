// Gate 2 retest (qa) - DEF-284 and DEF-285 on the 1.25.0 build.
//
// DEF-284 (FIX-READY): Multi Mode must render EXACTLY ONE [data-tools-badge];
//   elementsFromPoint at its centre must not return a second badge; no badge
//   may cover a pane control; clicking it must toggle [data-tools-palette];
//   single mode must still show exactly one badge.
//
// DEF-285 (FIX-READY): in SINGLE mode with the frosted theme at a zoom where
//   the gutters show, .workspace-main/.document-scroller must compute an
//   OPAQUE colour and a real gutter pixel must be alpha 255; light and dark
//   must remain alpha 255 and visually unchanged; the frosted chrome
//   (toolbar/rail) must still be glassy.
//
// Launches only through the canonical e2e/lib/launch.cjs launchApp.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { PNG } = require('pngjs');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const { SHOTS, REPORT, tmpCopy, openFile, twoPaneSetup, switchTheme } = require('../lib/p33_common.cjs');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'def284-285-retest');
  app = null;
  win = null;
});
test.setTimeout(300000);

function parseColor(c) {
  const m = String(c).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((s) => Number(s.trim()));
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}

async function bgOf(sel) {
  return win.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    return getComputedStyle(el).backgroundColor;
  }, sel);
}

async function backdropOf(sel) {
  return win.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return cs.backdropFilter || cs.webkitBackdropFilter || 'none';
  }, sel);
}

// A gutter point inside the scroller that is NOT over a page slot, sampled
// through an alpha-preserving 1x1 clip (omitBackground keeps transparency).
async function gutterPixel() {
  const point = await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    if (!sc) return null;
    const r = sc.getBoundingClientRect();
    for (let dy = 30; dy < r.height - 8; dy += 6) {
      for (let dx = 6; dx < r.width - 6; dx += 6) {
        const x = r.left + dx;
        const y = r.top + dy;
        const el = document.elementFromPoint(x, y);
        if (el && el.closest('.page-slot') === null && el.closest('.pdf-page') === null) {
          return { x: Math.round(x), y: Math.round(y), hit: `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0]}` };
        }
      }
    }
    return null;
  });
  if (point === null) return null;
  const buf = await win.screenshot({ omitBackground: true, clip: { x: point.x, y: point.y, width: 1, height: 1 } });
  const png = PNG.sync.read(buf);
  return { point, r: png.data[0], g: png.data[1], b: png.data[2], a: png.data[3] };
}

test('DEF-285 - single-mode canvas is opaque in every theme; frosted chrome stays glassy', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'def285-single.pdf'));
  await win.waitForSelector('.document-scroller', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(800);

  const mode = await win.evaluate(() => ({
    multi: document.querySelector('.tab-stage')?.getAttribute('data-multi-mode') ?? null,
    tabs: document.querySelectorAll('.tab[data-tab-id]').length,
    panes: document.querySelectorAll('.tab-pane[data-pane]').length,
  }));
  console.log(`[def285-retest] single-mode: ${JSON.stringify(mode)}`);
  expect(mode.multi, 'single mode').toBe('false');
  expect(mode.tabs, 'one document').toBe(1);
  expect(mode.panes, 'no panes').toBe(0);

  const zoomOut = win.locator('button[aria-label="Zoom out"]').first();
  for (let i = 0; i < 20; i += 1) await zoomOut.click({ timeout: 5000 }).catch(() => {});
  await win.waitForTimeout(800);
  const zoom = await win.locator('.zoom-percent').first().innerText().catch(() => '?');
  console.log(`[def285-retest] zoom: ${zoom}`);

  const EXPECTED = {
    light: { main: 'rgb(241, 245, 249)', scroller: 'rgb(241, 245, 249)' },
    dark: { main: 'rgb(11, 13, 15)', scroller: 'rgb(11, 13, 15)' },
  };

  for (const theme of ['frosted', 'light', 'dark']) {
    await switchTheme(win, theme);
    await win.waitForTimeout(700);
    const main = await bgOf('.workspace-main');
    const scroller = await bgOf('.document-scroller');
    const px = await gutterPixel();
    console.log(`[def285-retest] theme=${theme} main=${main} scroller=${scroller} gutterPixel=${JSON.stringify(px)}`);

    const mainC = parseColor(main);
    const scC = parseColor(scroller);
    expect(mainC, `${theme} .workspace-main computed colour`).not.toBeNull();
    expect(scC, `${theme} .document-scroller computed colour`).not.toBeNull();
    expect(mainC.a, `${theme} .workspace-main opaque (alpha 1)`).toBe(1);
    expect(scC.a, `${theme} .document-scroller opaque (alpha 1)`).toBe(1);
    expect(px, `${theme} gutter pixel sampled`).not.toBeNull();
    expect(px.a, `${theme} gutter pixel alpha 255`).toBe(255);

    if (EXPECTED[theme]) {
      expect(main, `${theme} .workspace-main unchanged`).toBe(EXPECTED[theme].main);
      expect(scroller, `${theme} .document-scroller unchanged`).toBe(EXPECTED[theme].scroller);
    }
  }

  // Frosted chrome must still be glassy (backdrop-filter present on toolbar/rail).
  await switchTheme(win, 'frosted');
  await win.waitForTimeout(700);
  const toolbarBd = await backdropOf('.toolbar');
  const railBd = await backdropOf('.side-rail');
  console.log(`[def285-retest] frosted chrome backdrop-filter toolbar=${toolbarBd} rail=${railBd}`);
  expect(toolbarBd, 'frosted toolbar still glassy').not.toBe('none');
  expect(railBd, 'frosted rail still glassy').not.toBe('none');

  await win.screenshot({ path: path.join(SHOTS, 'def285-retest-frosted.png') });
  console.log('[def285-retest] captured screenshots/def285-retest-frosted.png');
});

test('DEF-284 - exactly one All Tools badge in Multi Mode; toggles; single mode one badge', async () => {
  await twoPaneSetup(app, win);
  await win.waitForTimeout(900);

  const probe = await win.evaluate(() => {
    const badges = [...document.querySelectorAll('[data-tools-badge]')];
    const rect = (b) => {
      const r = b.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };
    };
    const info = badges.map((b, i) => {
      const r = b.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const stack = document.elementsFromPoint(cx, cy);
      // Count DISTINCT badge elements: the stack also contains the badge's own
      // child spans, which all map to the same badge via closest().
      const distinct = new Set(
        stack.map((el) => (el.closest ? el.closest('[data-tools-badge]') : null)).filter(Boolean),
      );
      const host = b.closest('.tab-pane[data-pane]');
      return { i, pane: host ? host.getAttribute('data-pane') : null, rect: rect(b), badgesInStack: distinct.size };
    });
    return { count: badges.length, badges: info };
  });
  console.log(`[def284-retest] badge probe: ${JSON.stringify(probe)}`);

  expect(probe.count, 'exactly ONE [data-tools-badge] in Multi Mode').toBe(1);
  expect(probe.badges[0].pane, 'badge is workspace chrome, not inside a pane').toBeNull();
  expect(probe.badges[0].badgesInStack, 'elementsFromPoint at badge centre returns no second badge').toBe(1);

  // No badge may cover a pane control.
  const controlHit = await win.evaluate(() => {
    const out = {};
    for (const sel of ['[data-pane-strip-pane="A"] [data-pane-strip-header]', '[data-pane-strip-pane="B"] [data-pane-strip-header]', '.tab-pane[data-pane="A"] [data-pane-clear]', '.tab-pane[data-pane="B"] [data-pane-clear]', '[data-shared-toolbar] button']) {
      const el = document.querySelector(sel);
      if (!el) { out[sel] = null; continue; }
      const r = el.getBoundingClientRect();
      const stack = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      out[sel] = stack.some((n) => n.closest && n.closest('[data-tools-badge]') !== null);
    }
    return out;
  });
  console.log(`[def284-retest] pane-control hit-test: ${JSON.stringify(controlHit)}`);
  for (const [sel, covered] of Object.entries(controlHit)) {
    if (covered !== null) expect(covered, `no badge covers ${sel}`).toBe(false);
  }

  // Clicking the single badge toggles [data-tools-palette].
  const badge = win.locator('[data-tools-badge]').first();
  await badge.click({ timeout: 5000 });
  await win.waitForTimeout(600);
  const openState = await win.evaluate(() => ({
    palette: !!document.querySelector('[data-tools-palette]'),
    pressed: document.querySelector('[data-tools-badge]')?.getAttribute('aria-pressed'),
  }));
  console.log(`[def284-retest] after click 1: ${JSON.stringify(openState)}`);
  expect(openState.palette, 'click opens [data-tools-palette]').toBe(true);
  expect(openState.pressed, 'badge aria-pressed true when open').toBe('true');

  await badge.click({ timeout: 5000 });
  await win.waitForTimeout(600);
  const closedState = await win.evaluate(() => ({
    palette: !!document.querySelector('[data-tools-palette]'),
    pressed: document.querySelector('[data-tools-badge]')?.getAttribute('aria-pressed'),
  }));
  console.log(`[def284-retest] after click 2: ${JSON.stringify(closedState)}`);
  expect(closedState.palette, 'second click closes [data-tools-palette]').toBe(false);
  expect(closedState.pressed, 'badge aria-pressed false when closed').toBe('false');

  await win.screenshot({ path: path.join(SHOTS, 'def284-retest-multi.png') });
  console.log('[def284-retest] captured screenshots/def284-retest-multi.png');
});

test('DEF-284 - single mode still shows exactly one All Tools badge', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'def284-single.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(800);
  const count = await win.locator('[data-tools-badge]').count();
  const multi = await win.evaluate(() => document.querySelector('.tab-stage')?.getAttribute('data-multi-mode'));
  console.log(`[def284-retest] single mode badge count=${count} multi=${multi}`);
  expect(multi, 'single mode').toBe('false');
  expect(count, 'exactly one badge in single mode').toBe(1);
});