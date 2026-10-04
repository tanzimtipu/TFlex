// TFL-736 / DEF-544 blast radius — the live bare `.modal-close` consumer.
//
// DialogShell's non-sheet close is now canonical `btn btn-ghost btn-icon`
// (DEF-544). The legacy `.modal-close:not(.btn)` rule is retained solely for the
// un-migrated EngineeringLayersPanel close (`EngineeringLayersPanel.tsx:136`),
// which this spec opens through the shipped Command Palette and proves still
// renders as a working close button. Screenshot is the required evidence.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

delete process.env.ELECTRON_RUN_AS_NODE;

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const USER_DATA = path.join(os.tmpdir(), `tflex-tfl736-blast-${Date.now()}`);

test.setTimeout(240000);

let app;
let win;

test('DEF-544 blast radius: EngineeringLayersPanel bare .modal-close still renders and closes', async () => {
  app = await launchApp([], USER_DATA);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(900);

  // Open the Engineering layers panel through the shipped palette verb.
  await win.keyboard.press('Control+Shift+P');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 10000 });
  await win.locator('[data-command-palette-input]').fill('Engineering layers');
  await win.waitForTimeout(300);
  const row = win.locator('[data-palette-tool-id="engineeringLayers"]').first();
  await row.waitFor({ state: 'visible', timeout: 8000 });
  expect(await row.getAttribute('data-palette-disabled'), 'engineeringLayers row enabled').toBe('false');
  await row.click();
  await win.waitForSelector('[data-engineering-layers-dialog]', { state: 'visible', timeout: 10000 });
  await win.waitForTimeout(300);

  const close = win.locator('[data-testid="layer-close"]').first();
  await close.waitFor({ state: 'visible', timeout: 8000 });
  const cls = await close.evaluate((el) => Array.from(el.classList));
  const box = await close.boundingBox();
  const al = await close.getAttribute('aria-label');
  console.log(`[TFL-736] layer-close classes=[${cls.join(' ')}] aria-label=${JSON.stringify(al)} box=${JSON.stringify(box)}`);

  // The consumer is the un-migrated legacy path: bare `.modal-close`, no `.btn`.
  expect(cls, 'layer close keeps the legacy bare .modal-close').toContain('modal-close');
  expect(cls, 'layer close stays on the :not(.btn) legacy path').not.toContain('btn');
  expect(al, 'layer close aria-label').toBeTruthy();
  expect(box, 'layer close is laid out with a non-zero hit target').not.toBeNull();
  expect(box.width, 'layer close width').toBeGreaterThan(0);
  expect(box.height, 'layer close height').toBeGreaterThan(0);

  await win.screenshot({ path: path.join(SHOTS, 'tfl736-engineering-layers-light.png') });
  console.log(`[TFL-736] screenshot ${path.join(SHOTS, 'tfl736-engineering-layers-light.png')}`);

  await close.click();
  await win.locator('[data-engineering-layers-dialog]').first().waitFor({ state: 'detached', timeout: 8000 });

  await hardClose(app, 'tfl736-blast');
});
