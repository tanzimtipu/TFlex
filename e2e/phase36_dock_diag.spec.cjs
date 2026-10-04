// One-off diagnostic: what is the "20 >" element at the bottom-centre of the
// Multi Mode workspace?
const { test } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const REPORT = path.join(ROOT, 'test-fixtures', 'report.pdf');
const LONG = path.join(ROOT, 'assets', 'samples', 'long.pdf');

let app = null;
let win = null;
test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});
test.afterEach(async () => { if (app) await hardClose(app, 'diag'); app = null; win = null; });
test.setTimeout(180000);

test('dump the bottom-centre elements in Multi Mode', async () => {
  await app.evaluate(async ({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, REPORT);
  await win.locator('[data-home-tool="open"]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1000);
  await app.evaluate(async ({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, LONG);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(1500);
  await win.locator('.tab[data-tab-id]').filter({ hasText: 'report' }).first().click();
  await win.waitForTimeout(400);
  await win.locator('[data-header-multi-mode]').click();
  await win.waitForTimeout(900);
  const emptyB = win.locator('.tab-pane[data-pane="B"][data-pane-empty]');
  if (await emptyB.count()) {
    await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').first().click();
    await win.waitForTimeout(1500);
  }
  await win.waitForSelector('.tab-pane[data-pane="B"] .pdf-page', { timeout: 30000 });
  await win.waitForTimeout(1000);
  const dump = await win.evaluate(() => {
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), w: Math.round(b.width) };
    };
    const panes = [...document.querySelectorAll('.tab-pane[data-pane]')].map((p) => ({ pane: p.getAttribute('data-pane'), rect: r(p), main: r(p.querySelector('.workspace-main')) }));
    const pills = [...document.querySelectorAll('[data-canvas-pills]')].map((c) => {
      const page = c.querySelector('[data-page-pill]');
      const zoom = c.querySelector('[data-zoom-pill]');
      return {
        pane: c.getAttribute('data-pill-pane'),
        container: r(c),
        parent: c.parentElement ? String(c.parentElement.className) : null,
        parentRect: r(c.parentElement),
        page: r(page),
        zoom: r(zoom),
      };
    });
    const dock = r(document.querySelector('[data-action-dock]'));
    return { panes, pills, dock };
  });
  console.log('[DIAG] ' + JSON.stringify(dump, null, 1));
});
