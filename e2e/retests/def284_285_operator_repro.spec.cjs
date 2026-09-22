// Focused verification (qa) - two operator-reported Phase 33 defects.
//
// DEFECT A ("Don't keep see-through for single mode."): Phase 33 criterion 4
//   requires the PDF canvas area (pane surface + scroller) to be an OPAQUE
//   surface colour of the active theme in BOTH single mode and Multi Mode, in
//   every theme including frosted. This spec opens ONE document in single mode,
//   zooms out so the canvas gutters beside the page are exposed, and reports the
//   computed background-color of html/body/.tf-ambient/.app/.tab-pane/
//   .workspace-main/.document-scroller plus a real gutter PIXEL alpha (1x1 clip
//   with omitBackground, alpha-preserving) in frosted, light and dark.
//
// DEFECT B ("All Tools badge shouldn't render twice."): Phase 33 criterion 4b
//   requires the All Tools affordance to render EXACTLY ONCE in Multi Mode.
//   This spec fills both panes, counts [data-tools-badge], reports each rect,
//   checks a real click still opens the palette, and reports what lies beneath
//   the stacked badges via elementsFromPoint.
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
  if (app) await hardClose(app, 'def284-285');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function bgOf(sel) {
  return win.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    return getComputedStyle(el).backgroundColor;
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

test('DEFECT A - single-mode canvas background (opaque in every theme)', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'def284-single.pdf'));
  await win.waitForSelector('.document-scroller', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(800);

  const mode = await win.evaluate(() => ({
    multi: document.querySelector('.tab-stage')?.getAttribute('data-multi-mode') ?? null,
    tabs: document.querySelectorAll('.tab[data-tab-id]').length,
    panes: document.querySelectorAll('.tab-pane[data-pane]').length,
  }));
  console.log(`[def284] single-mode check: ${JSON.stringify(mode)}`);
  expect(mode.tabs, 'exactly one document open').toBe(1);
  expect(mode.panes, 'no Multi Mode panes (single mode)').toBe(0);

  // Zoom out hard so the gutters beside the page are exposed.
  const zoomOut = win.locator('button[aria-label="Zoom out"]').first();
  for (let i = 0; i < 20; i += 1) await zoomOut.click({ timeout: 5000 }).catch(() => {});
  await win.waitForTimeout(800);
  const zoom = await win.locator('.zoom-percent').first().innerText().catch(() => '?');
  console.log(`[def284] zoom after zoom-out clicks: ${zoom}`);

  const SELS = ['html', 'body', '.tf-ambient', '.app', '.tab-stage', '.tab-pane', '.workspace-main', '.document-scroller'];
  const results = {};
  for (const theme of ['frosted', 'light', 'dark']) {
    await switchTheme(win, theme);
    await win.waitForTimeout(700);
    const colors = {};
    for (const s of SELS) colors[s] = await bgOf(s);
    const px = await gutterPixel();
    results[theme] = { colors, px };
    console.log(`[def284] theme=${theme} colors=${JSON.stringify(colors)} gutterPixel=${JSON.stringify(px)}`);
  }

  // Visual record: the FROSTED single-mode canvas with the gutters exposed.
  await switchTheme(win, 'frosted');
  await win.waitForTimeout(700);
  await win.screenshot({ path: path.join(SHOTS, 'def-single-bg.png') });
  console.log('[def284] captured screenshots/def-single-bg.png');

  // Report-only: this spec RECORDS the measurements; the defect is filed iff the
  // frosted canvas (the operator's report) samples see-through.
  const fr = results.frosted;
  console.log(`[def284] SUMMARY frosted scroller=${fr.colors['.document-scroller']} main=${fr.colors['.workspace-main']} pane=${fr.colors['.tab-pane']} pixelAlpha=${fr.px ? fr.px.a : 'no-pixel'} rootAlpha=${fr.colors['html']}`);
});

test('DEFECT B - All Tools badge count and rects in Multi Mode', async () => {
  await twoPaneSetup(app, win);
  await win.waitForTimeout(900);

  const probe = await win.evaluate(() => {
    const badges = [...document.querySelectorAll('[data-tools-badge]')];
    const rect = (b) => {
      const r = b.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const pane = (b) => {
      const host = b.closest('.tab-pane[data-pane]');
      return host ? host.getAttribute('data-pane') : null;
    };
    const info = badges.map((b, i) => {
      const r = b.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const stack = document.elementsFromPoint(cx, cy).map((el) => {
        const closest = el.closest('[data-tools-badge]');
        return closest ? `[data-tools-badge#${badges.indexOf(closest)}]` : `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0]}`;
      });
      return { i, pane: pane(b), rect: rect(b), stackAtCentre: stack.slice(0, 8) };
    });
    const cover = document.elementFromPoint(...(() => {
      const r = badges[0].getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    })());
    const coverIsBadge = badges.indexOf(cover && cover.closest ? cover.closest('[data-tools-badge]') : null);
    return {
      count: badges.length,
      badges: info,
      identicalRects: badges.length === 2 && JSON.stringify(rect(badges[0])) === JSON.stringify(rect(badges[1])),
      topmostAtCentre: coverIsBadge,
    };
  });
  console.log(`[def285] badge probe: ${JSON.stringify(probe)}`);

  // Visual record of the default Multi Mode state (palette closed).
  await win.screenshot({ path: path.join(SHOTS, 'def-badge-twice.png') });
  console.log('[def285] captured screenshots/def-badge-twice.png');

  // A real click on the badge that the pointer actually reaches (topmost).
  const top = probe.topmostAtCentre;
  const clickTarget = top >= 0 ? win.locator('[data-tools-badge]').nth(top) : win.locator('[data-tools-badge]').first();
  let clickOk = true;
  let clickErr = null;
  try {
    await clickTarget.click({ timeout: 5000 });
  } catch (e) {
    clickOk = false;
    clickErr = e.message.split('\n')[0];
  }
  await win.waitForTimeout(600);
  const palette = await win.evaluate(() => {
    const p = document.querySelector('[data-tools-palette]');
    const badges = [...document.querySelectorAll('[data-tools-badge]')];
    return {
      palettePresent: !!p,
      palettePane: p ? (p.closest('.tab-pane[data-pane]') || {}).dataset?.pane ?? null : null,
      pressed: badges.map((b) => b.getAttribute('aria-pressed')),
    };
  });
  console.log(`[def285] click topmost(#${top}) ok=${clickOk} err=${clickErr} palette=${JSON.stringify(palette)}`);

  // Strict click on the COVERED duplicate (no force) - intercepted if covered.
  let coveredClickOk = true;
  let coveredErr = null;
  if (probe.count >= 2) {
    const covered = top === 0 ? 1 : 0;
    try {
      await win.locator('[data-tools-badge]').nth(covered).click({ timeout: 4000 });
    } catch (e) {
      coveredClickOk = false;
      const lines = e.message.split('\n');
      const intercept = lines.find((l) => /intercepts pointer events/.test(l));
      coveredErr = intercept ? intercept.trim() : lines.slice(0, 3).join(' | ');
    }
    console.log(`[def285] strict click on covered #${covered}: ok=${coveredClickOk} err=${coveredErr}`);
  }

  // Does a badge shadow any real pane control? Hit-test the centre of each
  // control and report whether a [data-tools-badge] is in the pointer stack.
  const controlHit = await win.evaluate(() => {
    const out = {};
    for (const sel of ['[data-pane-strip-pane="A"] [data-pane-strip-header]', '[data-pane-strip-pane="B"] [data-pane-strip-header]', '.tab-pane[data-pane="A"] [data-pane-clear]', '.tab-pane[data-pane="B"] [data-pane-clear]', '[data-shared-toolbar] button']) {
      const el = document.querySelector(sel);
      if (!el) { out[sel] = null; continue; }
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const stack = document.elementsFromPoint(cx, cy);
      out[sel] = { cx: Math.round(cx), cy: Math.round(cy), badgeInStack: stack.some((n) => n.closest && n.closest('[data-tools-badge]') !== null) };
    }
    return out;
  });
  console.log(`[def285] pane-control hit-test: ${JSON.stringify(controlHit)}`);
});
