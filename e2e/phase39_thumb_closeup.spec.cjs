// Phase 39 - close-up of the Multi Mode thumbnail strip for DEF-347 visual
// judgment (one document). Canonical launchApp only.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, toggleMultiModeViaPalette } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
let app = null;
let win = null;
test.setTimeout(180000);

test('one-doc multi thumbnail strip close-up', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, getSamplePath('report.pdf'));
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1500);

  const info = await win.evaluate(`(() => {
    const wrap = document.querySelector('.tab-pane[data-pane="A"] .thumb-canvas-wrap');
    const thumb = wrap ? wrap.closest('.thumb') : null;
    const cs = (el) => { const s = getComputedStyle(el); return { boxSizing:s.boxSizing, padding:s.padding, width:s.width, border:s.border, margin:s.margin, overflow:s.overflow, position:s.position }; };
    return { wrap: cs(wrap), thumb: cs(thumb), thumbClass: thumb ? thumb.className : null };
  })()`);
  console.log(`[P39-CLOSEUP] ${JSON.stringify(info)}`);

  // Element screenshots: the whole strip and the first two thumb rows.
  await win.locator('.tab-pane[data-pane="A"] .pane-thumb-strip').screenshot({ path: path.join(SHOTS, 'def-347-strip-closeup.png') });
  await win.locator('.tab-pane[data-pane="A"] .thumb').first().screenshot({ path: path.join(SHOTS, 'def-347-thumb1-closeup.png') });
  await win.locator('.tab-pane[data-pane="A"] .thumb').nth(1).screenshot({ path: path.join(SHOTS, 'def-347-thumb2-closeup.png') });
  expect(app).not.toBeNull();
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p39-closeup');
  app = null;
  win = null;
});
