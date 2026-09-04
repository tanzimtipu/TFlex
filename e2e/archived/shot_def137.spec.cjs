// Capture before/after screenshots for the annotation-save-loss defect (DEF-137).

const { test } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { launchDev, openSample, shot, scrollToPage , hardClose } = require('./lib/helpers.cjs');

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

test('DEF-137 screenshots: ink+note before vs after save/reopen', async () => {
  await openSample(win, electronApp, 'report.pdf');
  const slot = win.locator('.page-slot[data-page="1"]').first();
  await slot.waitFor({ timeout: 10000 });
  const box = await slot.boundingBox();

  // Ink
  await win.locator('.ann-toolbar button[data-tool="ink"]').click();
  await win.waitForTimeout(300);
  await win.mouse.move(box.x + 220, box.y + 260);
  await win.mouse.down();
  await win.mouse.move(box.x + 420, box.y + 380, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(700);

  // Note with content placed visibly
  await win.locator('.ann-toolbar button[data-tool="note"]').click();
  await win.waitForTimeout(300);
  await win.mouse.click(box.x + 260, box.y + 300);
  await win.waitForSelector('[data-annotation-editor="note"] textarea, [data-annotation-editor] textarea', { timeout: 6000 }).catch(() => {});
  const ne = win.locator('[data-annotation-editor="note"] textarea, [data-annotation-editor] textarea').first();
  if (await ne.count()) {
    await ne.fill('DEFECT NOTE 137');
    const nc = win.locator('[data-annotation-action="note-confirm"]').first();
    if (await nc.count()) await nc.click({ force: true });
    else await win.keyboard.press('Control+Enter').catch(() => {});
    await win.waitForTimeout(600);
  }
  await win.waitForTimeout(800);
  await shot('def-137-before-save.png');

  // Save As
  const outPath = path.join(os.tmpdir(), `tflex-def137-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, outPath);
  await win.click('button[aria-label="Save As"]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(2500);

  // Reopen
  await win.click('.tab-close').catch(() => {});
  await win.waitForSelector('.welcome, .sample-card', { timeout: 15000 });
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, outPath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(2500);
  await scrollToPage(win, 1);
  await shot('def-137-after-reopen.png');
  console.log(`[DEF137] saved to ${outPath}`);
});
