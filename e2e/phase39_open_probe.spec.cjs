// Phase 39 probe - item 2 (Open a PDF) across splits and window widths, to
// test the operator's "enlarges the left window" claim. Canonical launchApp.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, toggleMultiModeViaPalette } = require('./lib/helpers.cjs');

let app = null;
let win = null;
test.setTimeout(180000);

async function split(w) {
  return w.evaluate(`(() => {
    const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { x:+b.x.toFixed(1), w:+b.width.toFixed(1), right:+b.right.toFixed(1) }; };
    const st = document.querySelector('.tab-stage');
    return { frac: st ? getComputedStyle(st).getPropertyValue('--tf-split-frac').trim() : null,
      paneA: r('.tab-pane[data-pane="A"]'), paneB: r('.tab-pane[data-pane="B"]'), divider: r('[data-multi-divider]') };
  })()`);
}

async function dragDivider(w, targetFrac) {
  const d = await w.locator('[data-multi-divider]').boundingBox();
  const st = await w.locator('.tab-stage').boundingBox();
  const y = d.y + d.height / 2;
  const x = st.x + st.width * targetFrac;
  await w.mouse.move(d.x + d.width / 2, y);
  await w.mouse.down();
  await w.mouse.move(x, y, { steps: 8 });
  await w.mouse.up();
  await w.waitForTimeout(600);
}

async function scenario(label, opts) {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  if (opts.window) {
    await app.evaluate(({ BrowserWindow }, sz) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) w.setSize(sz[0], sz[1]);
    }, opts.window);
    await win.waitForTimeout(800);
  }
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, getSamplePath('report.pdf'));
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1000);
  if (opts.dragTo !== undefined) await dragDivider(win, opts.dragTo);
  if (opts.collapsePanel) {
    const rc = win.locator('[data-rail-collapse]');
    if (await rc.count()) { await rc.first().click(); await win.waitForTimeout(500); }
  }
  const before = await split(win);
  await app.evaluate(async ({ dialog }, p) => {
    globalThis.__openCalls = 0;
    dialog.showOpenDialog = async () => { globalThis.__openCalls += 1; return { canceled: false, filePaths: [p] }; };
  }, getSamplePath('long.pdf'));
  const btn = win.locator(opts.sel);
  await btn.first().click();
  await win.waitForTimeout(2500);
  const calls = await app.evaluate(() => globalThis.__openCalls);
  const after = await split(win);
  console.log(`[P39-OPEN ${label}] sel=${opts.sel} calls=${calls}`);
  console.log(`[P39-OPEN ${label}] before=${JSON.stringify(before)}`);
  console.log(`[P39-OPEN ${label}] after =${JSON.stringify(after)}`);
  await hardClose(app, `p39-open-${label}`);
  app = null; win = null;
}

test('item2 variants', async () => {
  await scenario('pane-open-default', { sel: '.tab-pane[data-pane="B"] [data-pane-open]' });
  await scenario('pane-open-split35', { sel: '.tab-pane[data-pane="B"] [data-pane-open]', dragTo: 0.35 });
  await scenario('pane-open-split72', { sel: '.tab-pane[data-pane="B"] [data-pane-open]', dragTo: 0.72 });
  await scenario('pane-open-narrow-win', { sel: '.tab-pane[data-pane="B"] [data-pane-open]', window: [900, 700] });
  await scenario('pane-open-panel-collapsed', { sel: '.tab-pane[data-pane="B"] [data-pane-open]', collapsePanel: true });
  await scenario('titlebar-open', { sel: '[data-toolbar-open]' });
  expect(true).toBe(true);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p39-open-probe');
  app = null;
  win = null;
});
