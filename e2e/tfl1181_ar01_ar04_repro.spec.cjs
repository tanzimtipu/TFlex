// TFL-1181 — QA independent live reproduction of TFL-1180 chunk B.
//
// AR-01: the reading-location anchor must survive maximize/restore (repeated);
// AR-04: Fit Page must fit AND recenter the CURRENT canonical page.
// Settled results only — every measurement follows a settle wait, never an
// animation frame. Launches ONLY through the canonical launchApp helper.
delete process.env.ELECTRON_RUN_AS_NODE;

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (n) => path.join(SHOTS, n);

let app = null;
let win = null;
test.setTimeout(300000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1181-repro');
  app = null;
  win = null;
});

async function setSize(w, h) {
  await app.evaluate(({ BrowserWindow }) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw.isMaximized()) bw.unmaximize();
  });
  await win.waitForTimeout(400);
  await app.evaluate(({ BrowserWindow }, s) => {
    BrowserWindow.getAllWindows()[0].setSize(s[0], s[1]);
  }, [w, h]);
  await win.waitForFunction((s) => Math.abs(window.innerWidth - s) < 60, w, { timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(800);
}

async function maximize() {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
  await win.waitForTimeout(900);
}

async function openReport() {
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1400);
}

const pageInput = () => win.locator('input.page-input[aria-label="Current page"]').first();

async function slotVerdict(p) {
  return win.evaluate((n) => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector(`.page-slot[data-page="${n}"]`);
    if (sc === null || slot === null) return { found: false };
    const v = sc.getBoundingClientRect();
    const r = slot.getBoundingClientRect();
    return {
      found: true,
      intersects: r.bottom > v.top + 2 && r.top < v.bottom - 2,
      slotTop: Math.round(r.top),
      slotBottom: Math.round(r.bottom),
      viewTop: Math.round(v.top),
      viewBottom: Math.round(v.bottom),
    };
  }, p);
}

async function fitGeom(p) {
  return win.evaluate((n) => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector(`.page-slot[data-page="${n}"]`);
    if (sc === null || slot === null) return null;
    const sr = sc.getBoundingClientRect();
    const r = slot.getBoundingClientRect();
    const left = Math.round(r.left - sr.left - sc.clientLeft);
    return {
      leftGap: left,
      rightGap: Math.round(sc.clientWidth - left - r.width),
      pageW: Math.round(r.width),
      viewW: sc.clientWidth,
      fitsWidth: r.width <= sc.clientWidth + 2,
    };
  }, p);
}

// Outline -> Chapter 5 (whose target page is 10 in report.pdf).
async function goToPage10() {
  const tab = win.locator('[data-context-panel-view-tab="outline"]');
  if ((await tab.count()) > 0) {
    await tab.first().click();
    await win.waitForTimeout(500);
  }
  await win.waitForSelector('[data-outline-row]', { timeout: 8000 }).catch(() => {});
  const rows = win.locator('[data-outline-row]');
  const n = await rows.count();
  let target = -1;
  for (let i = 0; i < n; i += 1) {
    const title = await rows.nth(i).locator('.outline-link').getAttribute('title').catch(() => null);
    if (title !== null && /chapter\s*5/i.test(title)) { target = i; break; }
  }
  if (target >= 0) {
    await rows.nth(target).locator('.outline-link').click();
    await win.waitForTimeout(1600);
  }
  let val = await pageInput().inputValue().catch(() => null);
  if (val !== '10') {
    const input = pageInput();
    await input.click();
    await input.fill('');
    await input.fill('10');
    await input.press('Enter');
    await win.waitForTimeout(1600);
    val = await pageInput().inputValue().catch(() => null);
  }
  console.log(`[tfl1181] reached page10 via ${target >= 0 ? 'outline Chapter 5' : 'input'} footer=${val}`);
  return val;
}

test('AR-01 + AR-04 independent repro: page 10 holds across repeated maximize/restore; Fit Page fits + recenters', async () => {
  await maximize();
  await openReport();
  expect(await goToPage10(), 'reached page 10').toBe('10');
  await win.waitForTimeout(1200);

  // Restore #1 and settle.
  await setSize(981, 641);
  await win.waitForTimeout(1800);
  const footer1 = await pageInput().inputValue();
  const total = await win.locator('.page-total').first().textContent();
  const p10 = await slotVerdict(10);
  const p8 = await slotVerdict(8);
  console.log(`[tfl1181] restore#1 footer=${footer1} total=${total} p10=${JSON.stringify(p10)} p8=${JSON.stringify(p8)}`);
  await win.screenshot({ path: shot('tfl1181_ar01_restored_981.png') });
  expect(footer1, 'AR-01 restore#1 footer reads 10').toBe('10');
  expect(total, 'AR-01 restore#1 document reports 34 pages').toContain('34');
  expect(p10.found && p10.intersects, 'AR-01 restore#1 page 10 intersects the viewport').toBe(true);
  expect(p8.intersects, 'AR-01 restore#1 the visible content is NOT page 8').toBe(false);

  // Two further maximize/restore cycles — page 10 must still hold each time.
  for (let i = 2; i <= 3; i += 1) {
    await maximize();
    await setSize(981, 641);
    await win.waitForTimeout(1800);
    const f = await pageInput().inputValue();
    const v = await slotVerdict(10);
    console.log(`[tfl1181] restore#${i} footer=${f} p10=${JSON.stringify(v)}`);
    expect(f, `AR-01 restore#${i} footer reads 10`).toBe('10');
    expect(v.found && v.intersects, `AR-01 restore#${i} page 10 intersects the viewport`).toBe(true);
  }

  // 960x640 settled state.
  await setSize(960, 640);
  await win.waitForTimeout(1800);
  const footer960 = await pageInput().inputValue();
  const p10b = await slotVerdict(10);
  console.log(`[tfl1181] 960x640 footer=${footer960} p10=${JSON.stringify(p10b)}`);
  await win.screenshot({ path: shot('tfl1181_ar01_960x640.png') });
  expect(footer960, 'AR-01 960x640 footer reads 10').toBe('10');
  expect(p10b.found && p10b.intersects, 'AR-01 960x640 page 10 intersects the viewport').toBe(true);

  // AR-04: Fit Page fits + recenters the CURRENT page (10).
  await win.locator('[data-view-strip] button[aria-label="Fit page"]').first().click();
  await win.waitForTimeout(1600);
  const fitPressed = await win.locator('[data-view-strip] button[aria-label="Fit page"]').first().getAttribute('aria-pressed');
  const fitFooter = await pageInput().inputValue();
  const geo = await fitGeom(10);
  const fitVis = await slotVerdict(10);
  console.log(`[tfl1181] AR-04 fitPressed=${fitPressed} footer=${fitFooter} geo=${JSON.stringify(geo)} vis=${JSON.stringify(fitVis)}`);
  await win.screenshot({ path: shot('tfl1181_ar04_fitpage_981.png') });
  expect(fitPressed, 'AR-04 Fit Page toggle is active').toBe('true');
  expect(fitFooter, 'AR-04 Fit Page keeps the current page at 10').toBe('10');
  expect(geo, 'AR-04 geometry measurable').not.toBeNull();
  expect(geo.fitsWidth, 'AR-04 Fit Page fits the current page to the canvas width').toBe(true);
  expect(Math.abs(geo.leftGap - geo.rightGap), 'AR-04 Fit Page recenters the current page').toBeLessThanOrEqual(14);
  expect(fitVis.intersects, 'AR-04 Fit Page keeps page 10 visible').toBe(true);
});
