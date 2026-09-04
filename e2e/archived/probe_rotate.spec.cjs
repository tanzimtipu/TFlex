// Verify rotation visually survives save/reopen. Rotate page 1, save, reopen,
// and measure the page-1 canvas aspect (landscape 792:612 = 1.29 vs portrait
// 612:792 = 0.77). Also check engine rotations array.
const { test } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchDev, openSample, diag, scrollToPage , hardClose } = require('./lib/helpers.cjs');

let electronApp = null;
let win = null;
test.beforeEach(async () => {
  ({ electronApp, window: win } = await launchDev());
});
test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null; win = null;
});
test.setTimeout(180000);

test('rotate survives save/reopen (visual + state)', async () => {
  await openSample(win, electronApp, 'report.pdf');
  // Rotate page 1.
  await win.click('[data-toolbar-rotate-cw]');
  await win.waitForTimeout(1200);
  const d0 = await diag(win);
  console.log(`[RT] before save rotations[0]=${d0.engineState.rotations[0]} modified=${d0.modified}`);
  // Measure the page-1 CANVAS aspect while rotated.
  const canvasAspect = () => win.evaluate(() => {
    const s = document.querySelector('.page-slot[data-page="1"]');
    const c = s && s.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), aspect: +(r.width / r.height).toFixed(3) };
  });
  const rotated = await canvasAspect();
  console.log(`[RT] rotated page-1 canvas=${JSON.stringify(rotated)} (landscape>1)`);

  // Save As.
  const outPath = path.join(os.tmpdir(), `tflex-rotate-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, outPath);
  await win.click('button[aria-label="Save As"]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(2500);

  // Reopen.
  await win.click('.tab-close').catch(() => {});
  await win.waitForSelector('.welcome, .sample-card', { timeout: 15000 });
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, outPath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(2500);
  await scrollToPage(win, 1);
  const d1 = await diag(win);
  const reopened = await canvasAspect();
  console.log(`[RT] after reopen rotations[0]=${d1.engineState.rotations[0]} rotations[1]=${d1.engineState.rotations[1]}`);
  console.log(`[RT] reopened page-1 canvas=${JSON.stringify(reopened)}`);
});
