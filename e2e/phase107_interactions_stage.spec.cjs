// Phase 107 (chunk F3, phase-close QA) — targeted resolution of criterion 5
// (interactions preserved) plus the DEF-582 computed-shadow retest.
//
// Criterion 5 was left INCONCLUSIVE in chunk D. The Paper Stage frame is a
// box-shadow only (no border/margin), so page geometry, hit testing and
// selection/overlay coordinates must be byte-identical. This spec proves that
// live in the real app:
//   * .pdf-page has no border/margin and its box equals its canvas bitmap;
//   * a hit test at a page-relative point resolves INSIDE the same .pdf-page;
//   * a programmatic text selection produces a range rect contained in the
//     page box (selection/overlay coordinate space unaffected by the frame).
// It also confirms DEF-582: .print-preview-sheet computed box-shadow equals the
// --elevation-1 value (not the canvas ring), while .pdf-page still resolves the
// canvas frame.
//
// Launches ONLY through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, openStandalonePrintWindow, closeStandalonePrintWindow } = require('./lib/helpers.cjs');

const OUT = path.resolve(__dirname, '..', 'screenshots', 'phase107-canvas');
fs.mkdirSync(OUT, { recursive: true });
test.setTimeout(300000);

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p107-f3');
  app = null;
  win = null;
});

async function openSample(name) {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas.pdf-page-canvas', { timeout: 30000 });
  await win.waitForTimeout(900);
}

test('Criterion 5 — frame is chrome only: page box == bitmap, hit test and selection stay in page coordinates', async () => {
  await openSample('report.pdf');
  await win.screenshot({ path: path.join(OUT, 'f3-01-interaction-light.png') });

  const geom = await win.evaluate(() => {
    const page = document.querySelector('.pdf-page');
    const cs = getComputedStyle(page);
    const c = page.querySelector('canvas.pdf-page-canvas');
    const pr = page.getBoundingClientRect();
    const cr = c ? c.getBoundingClientRect() : null;
    return {
      border: cs.borderTopWidth,
      margin: cs.marginTop,
      page: { x: pr.x, y: pr.y, w: pr.width, h: pr.height },
      canvas: cr ? { x: cr.x, y: cr.y, w: cr.width, h: cr.height } : null,
    };
  });
  expect(geom.border, '.pdf-page border width').toBe('0px');
  expect(geom.margin, '.pdf-page margin').toBe('0px');
  expect(geom.canvas, 'page canvas present').not.toBeNull();
  expect(Math.abs(geom.canvas.x - geom.page.x), 'canvas x == page x').toBeLessThanOrEqual(2);
  expect(Math.abs(geom.canvas.y - geom.page.y), 'canvas y == page y').toBeLessThanOrEqual(2);
  expect(Math.abs(geom.canvas.w - geom.page.w), 'canvas w == page w').toBeLessThanOrEqual(2);
  expect(Math.abs(geom.canvas.h - geom.page.h), 'canvas h == page h').toBeLessThanOrEqual(2);

  const hit = await win.evaluate(() => {
    const page = document.querySelector('.pdf-page');
    const r = page.getBoundingClientRect();
    const x = r.x + r.width * 0.5;
    const y = r.y + r.height * 0.35;
    const el = document.elementFromPoint(x, y);
    return { inside: !!(el && page.contains(el)), tag: el ? el.tagName : null };
  });
  console.log(`[p107-f3] hit-test ${JSON.stringify(hit)}`);
  expect(hit.inside, 'hit test at a page-relative point resolves inside the same .pdf-page').toBe(true);

  const sel = await win.evaluate(() => {
    const page = document.querySelector('.pdf-page');
    const spans = [...page.querySelectorAll('.textLayer span')].filter(
      (s) => s.firstChild && s.textContent.trim().length > 0,
    );
    if (spans.length < 2) return { ok: false, spans: spans.length };
    const range = document.createRange();
    range.setStart(spans[0].firstChild, 0);
    const lastSpan = spans[Math.min(spans.length - 1, 3)];
    range.setEnd(lastSpan.firstChild, lastSpan.firstChild.length);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
    const r = range.getBoundingClientRect();
    const pr = page.getBoundingClientRect();
    return {
      ok: true,
      text: s.toString().slice(0, 24),
      sel: { x: r.x, y: r.y, w: r.width, h: r.height },
      page: { x: pr.x, y: pr.y, w: pr.width, h: pr.height },
    };
  });
  console.log(`[p107-f3] selection ${JSON.stringify(sel)}`);
  expect(sel.ok, 'text layer has selectable spans').toBe(true);
  expect(sel.text.length, 'a non-empty text selection is produced').toBeGreaterThan(0);
  expect(sel.sel.x, 'selection left within page box').toBeGreaterThanOrEqual(sel.page.x - 2);
  expect(sel.sel.x + sel.sel.w, 'selection right within page box').toBeLessThanOrEqual(sel.page.x + sel.page.w + 2);
  expect(sel.sel.y, 'selection top within page box').toBeGreaterThanOrEqual(sel.page.y - 2);
  expect(sel.sel.y + sel.sel.h, 'selection bottom within page box').toBeLessThanOrEqual(sel.page.y + sel.page.h + 2);
});

test('DEF-582 — .print-preview-sheet keeps the elevation-1 frame; .pdf-page keeps the canvas frame', async () => {
  await openSample('report.pdf');

  const pageShadow = await win.evaluate(() => {
    const page = document.querySelector('.pdf-page');
    const probe = document.createElement('div');
    probe.style.boxShadow = 'var(--shadow-page-canvas)';
    document.body.appendChild(probe);
    const v = { page: getComputedStyle(page).boxShadow, canvas: getComputedStyle(probe).boxShadow };
    probe.remove();
    return v;
  });
  console.log(`[p107-f3] page shadow ${JSON.stringify(pageShadow)}`);
  expect(pageShadow.page, '.pdf-page uses the --shadow-page-canvas frame').toBe(pageShadow.canvas);

  const printPage = await openStandalonePrintWindow(app, win);
  const shadows = await printPage.evaluate(() => {
    const sheet = document.querySelector('[data-print-preview-sheet]');
    const probeE1 = document.createElement('div');
    probeE1.style.boxShadow = 'var(--elevation-1)';
    document.body.appendChild(probeE1);
    const probeRing = document.createElement('div');
    probeRing.style.boxShadow = 'var(--shadow-page-canvas)';
    document.body.appendChild(probeRing);
    const r = {
      sheet: sheet ? getComputedStyle(sheet).boxShadow : null,
      elevation1: getComputedStyle(probeE1).boxShadow,
      canvas: getComputedStyle(probeRing).boxShadow,
    };
    probeE1.remove();
    probeRing.remove();
    return r;
  });
  console.log(`[p107-f3] print sheet shadow ${JSON.stringify(shadows)}`);
  await printPage.screenshot({ path: path.join(OUT, 'f3-02-print-preview-sheet.png') });
  expect(shadows.sheet, '.print-preview-sheet computes the --elevation-1 shadow').toBe(shadows.elevation1);
  expect(shadows.sheet, '.print-preview-sheet does NOT use the canvas ring').not.toBe(shadows.canvas);
  expect(shadows.sheet, '.print-preview-sheet has no 1px canvas ring layer').not.toContain('0px 0px 0px 1px');
  await closeStandalonePrintWindow(app, printPage);
});
