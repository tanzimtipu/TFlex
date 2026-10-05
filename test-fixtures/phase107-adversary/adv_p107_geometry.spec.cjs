// Phase 107 adversary probe (TFL-904 chunk E) - live geometry / anchor / containment.
//
// Launches ONLY through the canonical e2e/lib/launch.cjs helper. Never touches
// e2e/**. Covers the live surfaces the mandated phase107 e2e does not:
//   A. frame containment: .pdf-page box == its canvas, no border/margin (ring is
//      box-shadow chrome only);
//   B. page jump to a middle and the last page lands exactly under PAGE_GAP 24;
//   C. zoom keeps the active view anchor stable;
//   D. Inspector open/close keeps the active view anchor stable.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');

const OUT = path.resolve(__dirname, '..', '..', 'screenshots', 'phase107-adversary');
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
  if (app) await hardClose(app, 'p107-adv');
  app = null;
  win = null;
});

async function openSample(name) {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.document-scroller', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas.pdf-page-canvas', { timeout: 30000 });
  await win.waitForTimeout(900);
}

async function collapseInspector() {
  const el = win.locator('[data-inspector]').first();
  const cur = await el.getAttribute('data-inspector-collapsed');
  if (cur !== 'true') {
    await win.locator('[data-inspector-collapse]').first().click();
    await win.waitForTimeout(900);
  }
}

async function toggleInspector() {
  await win.locator('[data-inspector-collapse]').first().click();
  await win.waitForTimeout(900);
}

async function jumpTo(n) {
  const input = win.locator('.page-input').first();
  await input.click();
  await input.fill(String(n));
  await input.press('Enter');
  await win.waitForTimeout(1500);
}

async function pageCount() {
  return win.evaluate(() => {
    const t = document.querySelector('.page-total');
    return t ? parseInt(t.textContent.replace(/[^0-9]/g, ''), 10) : 0;
  });
}

async function readGeom() {
  return win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const slots = Array.from(document.querySelectorAll('.page-slot[data-page]'));
    const page = document.querySelector('.pdf-page');
    const canvas = page ? page.querySelector('canvas.pdf-page-canvas') : null;
    const input = document.querySelector('.page-input');
    const pageCs = page ? getComputedStyle(page) : null;
    const sr = sc ? sc.getBoundingClientRect() : null;
    return {
      scrollTop: sc ? Math.round(sc.scrollTop) : null,
      clientHeight: sc ? sc.clientHeight : null,
      scrollHeight: sc ? sc.scrollHeight : null,
      slotHeights: slots.map((s) => Math.round(s.getBoundingClientRect().height)),
      slotPages: slots.map((s) => Number(s.getAttribute('data-page'))),
      pageRect: page ? { x: page.getBoundingClientRect().x, y: page.getBoundingClientRect().y, w: page.getBoundingClientRect().width, h: page.getBoundingClientRect().height } : null,
      canvasRect: canvas ? { x: canvas.getBoundingClientRect().x, y: canvas.getBoundingClientRect().y, w: canvas.getBoundingClientRect().width, h: canvas.getBoundingClientRect().height } : null,
      borderWidth: pageCs ? pageCs.borderTopWidth : null,
      marginTop: pageCs ? pageCs.marginTop : null,
      pageInputValue: input ? input.value : null,
      scrollerTop: sr ? sr.top : null,
    };
  });
}

// Top of the slot for page `n` relative to the scroller viewport top (px).
async function anchorRel(n) {
  return win.evaluate((page) => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector(`.page-slot[data-page="${page}"]`);
    if (!sc || !slot) return null;
    return Math.round(slot.getBoundingClientRect().top - sc.getBoundingClientRect().top);
  }, n);
}

test('ADV-A frame is chrome only: .pdf-page box equals its canvas, no border/margin', async () => {
  await openSample('report.pdf');
  const g = await readGeom();
  expect(g.borderWidth, '.pdf-page border width').toBe('0px');
  expect(g.marginTop, '.pdf-page margin').toBe('0px');
  expect(g.canvasRect, 'page canvas present').not.toBeNull();
  // Sub-pixel tolerance: PageView sizes the canvas from an integer renderW/H
  // (PageView.tsx:642-645, untouched by Phase 107) while the .pdf-page box is
  // fractional, so a <1px device-pixel delta is pre-existing, not the frame.
  expect(Math.abs(g.canvasRect.w - g.pageRect.w), 'canvas width == page width (sub-pixel)').toBeLessThanOrEqual(2);
  expect(Math.abs(g.canvasRect.h - g.pageRect.h), 'canvas height == page height (sub-pixel)').toBeLessThanOrEqual(2);
  expect(Math.abs(g.canvasRect.x - g.pageRect.x), 'canvas x == page x (sub-pixel)').toBeLessThanOrEqual(2);
  expect(Math.abs(g.canvasRect.y - g.pageRect.y), 'canvas y == page y (sub-pixel)').toBeLessThanOrEqual(2);
  console.log('[p107-adv] A containment ' + JSON.stringify({ border: g.borderWidth, margin: g.marginTop, page: g.pageRect, canvas: g.canvasRect }));
});

test('ADV-B page jump to a middle and the last page lands exactly (PAGE_GAP 24)', async () => {
  await openSample('report.pdf');
  const first = await readGeom();
  const uniform = first.slotHeights.length >= 2
    ? Math.max(...first.slotHeights) - Math.min(...first.slotHeights) <= 1
    : true;
  const slotStep = first.slotHeights[0] + 24;
  const count = await pageCount();
  expect(count, 'document has several pages').toBeGreaterThan(3);
  console.log(`[p107-adv] B model uniform=${uniform} slotH=${first.slotHeights[0]} step=${slotStep} count=${count}`);

  const mid = Math.max(2, Math.floor(count / 2));
  await jumpTo(mid);
  const gm = await readGeom();
  const expMid = (mid - 1) * slotStep;
  console.log(`[p107-adv] B mid page=${mid} readout=${gm.pageInputValue} scrollTop=${gm.scrollTop} expected=${expMid.toFixed(1)}`);
  expect(gm.pageInputValue, `readout is page ${mid}`).toBe(String(mid));
  if (uniform) expect(Math.abs(gm.scrollTop - expMid), `landing exact at page ${mid}`).toBeLessThanOrEqual(4);

  await jumpTo(count);
  const gl = await readGeom();
  const rawLast = (count - 1) * slotStep;
  const maxScroll = gl.scrollHeight - gl.clientHeight;
  const expLast = Math.min(rawLast, maxScroll);
  console.log(`[p107-adv] B last page=${count} readout=${gl.pageInputValue} scrollTop=${gl.scrollTop} expected=${expLast.toFixed(1)} (raw ${rawLast.toFixed(1)} max ${maxScroll})`);
  expect(gl.pageInputValue, `readout is page ${count}`).toBe(String(count));
  if (uniform) expect(Math.abs(gl.scrollTop - expLast), `landing exact at last page`).toBeLessThanOrEqual(4);
  await win.screenshot({ path: path.join(OUT, 'adv-b-last-page.png') });
});

test('ADV-C zoom keeps the active view anchor stable', async () => {
  await openSample('report.pdf');
  await collapseInspector();
  const count = await pageCount();
  const mid = Math.max(2, Math.floor(count / 2));
  await jumpTo(mid);
  const before = await readGeom();
  const relBefore = await anchorRel(mid);
  for (let i = 0; i < 3; i += 1) {
    await win.locator('.view-strip [aria-label="Zoom in"]').first().click();
    await win.waitForTimeout(700);
  }
  const after = await readGeom();
  const relAfter = await anchorRel(mid);
  console.log(`[p107-adv] C zoom anchor page=${mid} readout ${before.pageInputValue}->${after.pageInputValue} relTop ${relBefore}->${relAfter} scrollTop ${before.scrollTop}->${after.scrollTop}`);
  expect(after.pageInputValue, 'active page readout stable across zoom').toBe(String(mid));
  expect(Math.abs(relAfter), 'anchored page top stays near the viewport top').toBeLessThanOrEqual(60);
  await win.screenshot({ path: path.join(OUT, 'adv-c-zoom-anchor.png') });
});

test('ADV-D Inspector open/close keeps the active view anchor stable', async () => {
  await openSample('report.pdf');
  await collapseInspector();
  const count = await pageCount();
  const mid = Math.max(2, Math.floor(count / 2));
  await jumpTo(mid);
  const relClosed = await anchorRel(mid);
  await toggleInspector(); // open
  const gOpen = await readGeom();
  const relOpen = await anchorRel(mid);
  await toggleInspector(); // close
  const gClosed = await readGeom();
  const relReclosed = await anchorRel(mid);
  console.log(`[p107-adv] D inspector anchor page=${mid} readout closed=${gClosed.pageInputValue} open=${gOpen.pageInputValue} relTop ${relClosed}->${relOpen}->${relReclosed}`);
  expect(gOpen.pageInputValue, 'readout stable with Inspector open').toBe(String(mid));
  expect(gClosed.pageInputValue, 'readout stable after Inspector close').toBe(String(mid));
  expect(Math.abs(relOpen), 'anchored page top near viewport top with Inspector open').toBeLessThanOrEqual(80);
  expect(Math.abs(relReclosed), 'anchored page top near viewport top after re-close').toBeLessThanOrEqual(80);
  await win.screenshot({ path: path.join(OUT, 'adv-d-inspector-anchor.png') });
});
