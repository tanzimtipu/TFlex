// Phase 39 - reproduce the operator's items 1-3 against the INSTALLED 1.30.0
// build (C:\Program Files\TFlex\TFlex.exe). Installed-app spec, lives under
// e2e/installed/ per the repo convention; launches through the canonical
// launchApp with an explicit packaged exe.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose, dismissUpdatePrompt, toggleMultiModeViaPalette } = require('../lib/helpers.cjs');

const EXE = process.env.TFLEX_PACKAGED_EXE || 'C:\\Program Files\\TFlex\\TFlex.exe';
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
let app = null;
let win = null;
test.setTimeout(180000);

async function openInto(appRef, w, filePath) {
  await appRef.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
  await w.locator('[data-toolbar-open]').first().click();
  await w.waitForTimeout(1500);
}

async function rect(w, sel) {
  return w.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { x:+b.x.toFixed(1), y:+b.y.toFixed(1), w:+b.width.toFixed(1), h:+b.height.toFixed(1),
      right:+b.right.toFixed(1), bottom:+b.bottom.toFixed(1), opacity: cs.opacity,
      display: cs.display, visibility: cs.visibility };
  }, sel);
}

function inter(a, b) {
  if (!a || !b) return null;
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const r = Math.min(a.right, b.right), bo = Math.min(a.bottom, b.bottom);
  return { w:+(Math.max(0,r-x)).toFixed(1), h:+(Math.max(0,bo-y)).toFixed(1),
    area:+(Math.max(0,r-x)*Math.max(0,bo-y)).toFixed(1) };
}

test('installed 1.30.0: one-doc Multi Mode dock + thumbnail geometry', async () => {
  app = await launchApp([], null, EXE);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 40000 });
  await dismissUpdatePrompt(win);
  await openInto(app, win, getSamplePath('report.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1500);

  const dockCount = await win.locator('.action-dock').count();
  const layerCount = await win.locator('[data-multi-dock-layer]').count();
  const verbs = await win.$$eval('[data-dock-verb]', (els) => els.map((e) => e.getAttribute('data-dock-verb')));
  const strip = await rect(win, '.tab-pane[data-pane="A"] .pane-thumb-strip');
  const dock = await rect(win, '.action-dock');
  const rotate = await rect(win, '[data-dock-verb="rotate"]');
  const thumb = await rect(win, '.tab-pane[data-pane="A"] .thumb-canvas-wrap');
  const thumbRow = await rect(win, '.tab-pane[data-pane="A"] .thumb');
  console.log(`[P39-INST] dockCount=${dockCount} layer=${layerCount} verbs=${JSON.stringify(verbs)}`);
  console.log(`[P39-INST] strip=${JSON.stringify(strip)}`);
  console.log(`[P39-INST] dock=${JSON.stringify(dock)} dockInterStrip=${JSON.stringify(inter(dock, strip))}`);
  console.log(`[P39-INST] rotate=${JSON.stringify(rotate)} rotateInterStrip=${JSON.stringify(inter(rotate, strip))}`);
  console.log(`[P39-INST] thumbPreview=${JSON.stringify(thumb)} thumbRow=${JSON.stringify(thumbRow)} previewOverRow=${JSON.stringify(inter(thumb, thumbRow))}`);
  await win.screenshot({ path: path.join(SHOTS, 'def-347-installed-default.png') });
  expect(app).not.toBeNull();
});

test('installed 1.30.0: pane Open-a-PDF with one document', async () => {
  app = await launchApp([], null, EXE);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 40000 });
  await dismissUpdatePrompt(win);
  await openInto(app, win, getSamplePath('report.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1200);

  const before = await rect(win, '[data-multi-divider]');
  const openBtn = win.locator('.tab-pane[data-pane="B"] [data-pane-open]');
  console.log(`[P39-INST-open] paneOpenCount=${await openBtn.count()}`);
  await app.evaluate(async ({ dialog }, p) => {
    globalThis.__openCalls = 0;
    dialog.showOpenDialog = async () => { globalThis.__openCalls += 1; return { canceled: false, filePaths: [p] }; };
  }, getSamplePath('long.pdf'));
  await openBtn.first().click();
  await win.waitForTimeout(2500);
  const calls = await app.evaluate(() => globalThis.__openCalls);
  const after = await rect(win, '[data-multi-divider]');
  const paneBFilled = await win.locator('.tab-pane[data-pane="B"] canvas.pdf-page-canvas').count();
  console.log(`[P39-INST-open] dialogCalls=${calls} paneBCanvas=${paneBFilled}`);
  console.log(`[P39-INST-open] divider before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  await win.screenshot({ path: path.join(SHOTS, 'def-348-installed.png') });
  expect(app).not.toBeNull();
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p39-installed');
  app = null;
  win = null;
});
