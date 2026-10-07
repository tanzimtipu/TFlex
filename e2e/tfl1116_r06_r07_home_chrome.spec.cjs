// TFL-1141 (TFL-1116 C7) - R06 + R07 Home chrome. frontend-dev.
// Launches ONLY via the canonical e2e/lib/launch.cjs `launchApp`.
//
// R06: the title-bar brand (.titlebar > .brand) carries a 16px leading inset at
// the default window width, so it never touches the native left edge.
// R07: with ZERO document tabs (Home) the document rail row is NOT mounted at
// all (no `.document-rail` / `.tab-area`); once a document is open the colorful
// tab row is present again.
//
// The harness exports ELECTRON_RUN_AS_NODE=1; launchApp spreads process.env, so
// Electron would exit as Node. Clear it.
delete process.env.ELECTRON_RUN_AS_NODE;

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, name);

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  // Fresh user-data dir => zero documents => Home.
  await win.waitForSelector('.welcome', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1141-r06-r07');
  app = null;
  win = null;
});

test.setTimeout(300000);

const count = (sel) => win.locator(sel).count();

test('R07 - zero documents reserve no tab row; opening one shows the colorful strip', async () => {
  // Home: the rail row and its tab strip are absent, not merely empty.
  expect(await count('[data-document-rail]')).toBe(0);
  expect(await count('.tab-area')).toBe(0);
  expect(await count('[data-tab-id]')).toBe(0);
  await win.screenshot({ path: shot('tfl1116_r07_zero_tab_home.png') });

  // Open a document: the rail row and its colorful tab strip return.
  await win.locator('.sample-card').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('[data-document-rail]', { timeout: 8000 });
  expect(await count('[data-document-rail]')).toBe(1);
  expect(await count('.tab-area')).toBe(1);
  expect(await count('[data-tab-id]')).toBeGreaterThan(0);
  await win.screenshot({ path: shot('tfl1116_r07_one_tab_strip.png') });
});

test('R06 - the title-bar brand keeps a 16px leading inset', async () => {
  const brand = win.locator('.titlebar > .brand').first();
  await expect(brand).toBeVisible({ timeout: 8000 });
  const paddingLeft = await brand.evaluate((el) => getComputedStyle(el).paddingLeft);
  expect(paddingLeft).toBe('16px');
  // The padding pushes the visible brand mark 16px in from the window frame
  // (the `.brand` box itself still spans from x=0; the mark is the painted edge).
  const mark = win.locator('.titlebar > .brand .brand-mark').first();
  const markBox = await mark.boundingBox();
  expect(markBox).not.toBeNull();
  expect(Math.round(markBox.x)).toBe(16);
  await win.screenshot({ path: shot('tfl1116_r06_brand_inset.png') });

  // The inset survives once a document (and the rail) is open.
  await win.locator('.sample-card').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  const paddingOpen = await win
    .locator('.titlebar > .brand')
    .first()
    .evaluate((el) => getComputedStyle(el).paddingLeft);
  expect(paddingOpen).toBe('16px');
});
