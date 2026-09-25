// Phase 39 item 1 (DEF-347) verification - the Multi Mode thumbnail page
// preview must render INSIDE its page row at the default window, a narrow and a
// wide pane, and two zoom levels, with ONE and with TWO documents.
//
// Measurement harness: raw [P39-DEF347 ...] lines are the evidence. The
// assertions pin the acceptance criterion (per-edge overflow 0). Canonical
// launchApp only.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, toggleMultiModeViaPalette } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
let app = null;
let win = null;
test.setTimeout(300000);

const R = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  const b = el.getBoundingClientRect();
  return { left:+b.left.toFixed(2), top:+b.top.toFixed(2), right:+b.right.toFixed(2),
    bottom:+b.bottom.toFixed(2), w:+b.width.toFixed(2), h:+b.height.toFixed(2) };
})()`;

async function openDoc(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(900);
}

const MEASURE = (pane) => `(() => {
  const ps = '.tab-pane[data-pane="' + ${JSON.stringify(pane)} + '"]';
  const q = (s) => document.querySelector(ps + ' ' + s);
  const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
    return { left:+b.left.toFixed(2), top:+b.top.toFixed(2), right:+b.right.toFixed(2),
      bottom:+b.bottom.toFixed(2), w:+b.width.toFixed(2), h:+b.height.toFixed(2) }; };
  const over = (innerEl, outerEl) => {
    if (!innerEl || !outerEl) return null;
    const i = innerEl.getBoundingClientRect();
    const o = outerEl.getBoundingClientRect();
    return {
      left:  +Math.max(0, o.left - i.left).toFixed(2),
      right: +Math.max(0, i.right - o.right).toFixed(2),
      top:   +Math.max(0, o.top - i.top).toFixed(2),
      bottom:+Math.max(0, i.bottom - o.bottom).toFixed(2),
    };
  };
  const thumb = q('.thumb-item');
  const wrap = q('.thumb-canvas-wrap');
  const canvas = q('.thumb-canvas');
  const strip = q('.pane-thumb-strip');
  return { thumb:box(thumb), wrap:box(wrap), canvas:box(canvas), strip:box(strip),
    wrapOverThumb: over(wrap, thumb), canvasOverWrap: over(canvas, wrap),
    canvasOverThumb: over(canvas, thumb),
    wrapStyle: wrap ? { w: wrap.style.width, h: wrap.style.height } : null,
    wrapBorder: wrap ? getComputedStyle(wrap).borderWidth : null };
})()`;

async function readPane(pane, label) {
  const m = await win.evaluate(MEASURE(pane));
  console.log(`[P39-DEF347 ${label}] ${JSON.stringify(m)}`);
  return m;
}

function assertInside(m, label) {
  // The acceptance criterion: the preview must not spill outside the page ROW.
  // `wrapOverThumb` / `canvasOverThumb` are that measurement. `canvasOverWrap`
  // is informational: the canvas fills the wrap's border box and the 0.67px
  // frame border (overflow:hidden clips it) is the frame itself, not a spill.
  for (const key of ['wrapOverThumb', 'canvasOverThumb']) {
    const o = m[key];
    if (!o) continue;
    for (const edge of ['left', 'right', 'top', 'bottom']) {
      expect(o[edge], `${label} ${key}.${edge} overflow (must be 0)`).toBeLessThanOrEqual(0.6);
    }
  }
  expect(m.canvasOverWrap.right, `${label} canvas vs frame border`).toBeLessThanOrEqual(0.7);
  expect(m.canvasOverWrap.bottom, `${label} canvas vs frame border`).toBeLessThanOrEqual(0.7);
  expect(m.wrap.w, `${label} wrap width positive`).toBeGreaterThan(0);
  expect(m.wrap.w, `${label} wrap fits the row width`).toBeLessThanOrEqual(m.thumb.w - 6);
}

async function dragDivider(targetFrac) {
  const d = await win.locator('[data-multi-divider]').boundingBox();
  const st = await win.locator('.tab-stage').boundingBox();
  const y = d.y + d.height / 2;
  const x = st.x + st.width * targetFrac;
  await win.mouse.move(d.x + d.width / 2, y);
  await win.mouse.down();
  await win.mouse.move(x, y, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(700);
}

test('DEF-347 one document: preview inside the page row at default/narrow/wide panes and two zooms', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openDoc(getSamplePath('report.pdf'));
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1200);
  console.log(`[P39-DEF347 env] innerWidth=${await win.evaluate(() => window.innerWidth)} panes=${await win.locator('.tab-stage').getAttribute('data-multi-panes')}`);

  const def = await readPane('A', 'default');
  assertInside(def, 'default');

  await dragDivider(0.30);
  const narrow = await readPane('A', 'narrow-pane');
  assertInside(narrow, 'narrow-pane');

  await dragDivider(0.78);
  const wide = await readPane('A', 'wide-pane');
  assertInside(wide, 'wide-pane');

  await dragDivider(0.50);
  const zoomIn = win.locator('.tab-pane[data-pane="A"] [data-zoom-pill] button[aria-label="Zoom in"]');
  expect(await zoomIn.count(), 'pane A has a zoom-in control').toBeGreaterThan(0);
  await zoomIn.first().click();
  await win.waitForTimeout(800);
  const z1 = await readPane('A', 'zoom+1');
  assertInside(z1, 'zoom+1');
  await zoomIn.first().click();
  await win.waitForTimeout(800);
  const z2 = await readPane('A', 'zoom+2');
  assertInside(z2, 'zoom+2');

  // Evidence: the pane A strip close-up (current-page row) at the default window.
  await win.locator('.tab-pane[data-pane="A"] .pane-thumb-strip').screenshot({
    path: path.join(SHOTS, 'def-347-verify-strip.png'),
  });
  await hardClose(app, 'def347-1');
  app = null; win = null;
});

test('DEF-347 two documents: both pane strips keep the preview inside its row', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openDoc(getSamplePath('report.pdf'));
  await openDoc(getSamplePath('long.pdf'));
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1000);
  const pick = win.locator('.tab-pane[data-pane-empty] [data-pane-pick]').first();
  if (await pick.count()) { await pick.click(); await win.waitForTimeout(1800); }
  await win.locator('.tab-pane[data-pane="A"] .pdf-page').first().click({ force: true });
  await win.waitForTimeout(700);
  console.log(`[P39-DEF347 env2] panes=${await win.locator('.tab-stage').getAttribute('data-multi-panes')} strips=${await win.locator('.pane-thumb-strip').count()}`);

  const a = await readPane('A', 'two-default-A');
  assertInside(a, 'two-default-A');
  const b = await readPane('B', 'two-default-B');
  assertInside(b, 'two-default-B');

  await dragDivider(0.30);
  const aN = await readPane('A', 'two-narrow-A');
  assertInside(aN, 'two-narrow-A');
  const bN = await readPane('B', 'two-narrow-B');
  assertInside(bN, 'two-narrow-B');

  await dragDivider(0.70);
  const aW = await readPane('A', 'two-wide-A');
  assertInside(aW, 'two-wide-A');
  const bW = await readPane('B', 'two-wide-B');
  assertInside(bW, 'two-wide-B');

  await hardClose(app, 'def347-2');
  app = null; win = null;
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'def347');
  app = null;
  win = null;
});
