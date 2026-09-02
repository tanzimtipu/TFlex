const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const os = require('node:os');
const path = require('node:path');

const EXE_PATH = "C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe";

function tmpOut(name) { return path.join(os.tmpdir(), name); }

let electronApp = null;
let window = null;

async function launch() {
  electronApp = await launchApp([], null, EXE_PATH);
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);
}
async function close() { if (electronApp) await electronApp.close().catch(() => {}); electronApp = null; }
async function openSample(name) {
  await window.click(`.sample-card:has-text("${name}")`);
  await window.waitForSelector('.workspace', { timeout: 15000 });
  await window.waitForTimeout(1200);
}
async function snap(name) { await window.screenshot({ path: `screenshots/${name}.png` }); }

test.beforeEach(async () => { await launch(); });
test.afterEach(async () => { await close(); });

test('B3: custom #00ff00 rect survives Save As + reopen', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  const page = window.locator('.pdf-page').first();
  const pbox = await page.boundingBox();

  await window.locator('.ann-toolbar button[data-tool="rect"]').click();
  await window.waitForTimeout(200);
  await window.click('.ann-color-swatch-main');
  await window.waitForSelector('.color-popover', { timeout: 5000 });
  await window.fill('input[aria-label="Custom color hex"]', '#00ff00');
  await window.press('input[aria-label="Custom color hex"]', 'Enter');
  await window.waitForTimeout(300);
  await window.keyboard.press('Escape');
  await window.waitForTimeout(300);

  // drag rect
  await window.mouse.move(pbox.x + 300, pbox.y + 500);
  await window.mouse.down();
  await window.mouse.move(pbox.x + 500, pbox.y + 650, { steps: 6 });
  await window.mouse.up();
  await window.waitForTimeout(600);

  const beforeSave = await window.evaluate(() => {
    const el = document.querySelector('.ann[data-kind="rect"]');
    return el ? { present: true, stroke: el.getAttribute('stroke'), fill: el.getAttribute('fill') } : { present: false };
  });
  console.log('B3 before save rect:', JSON.stringify(beforeSave));

  // Save As to a temp path
  const savePath = tmpOut(`b3-saved-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await window.click('[aria-label="Save As"]');
  await window.click('[data-save-as-confirm="true"]');
  await window.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 20000 });
  console.log('B3 saved to', savePath);

  // Reopen the saved file: close the tab back to welcome, then open the saved file
  await window.locator('.tab-active .tab-close').click();
  await window.waitForTimeout(1500);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, savePath);
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.pdf-page', { timeout: 15000 });
  await window.waitForTimeout(1800);

  const afterReopen = await window.evaluate(() => {
    const el = document.querySelector('.ann[data-kind="rect"]');
    return el ? { present: true, stroke: el.getAttribute('stroke'), fill: el.getAttribute('fill') } : { present: false };
  });
  console.log('B3 after reopen rect:', JSON.stringify(afterReopen));
  const diag = await window.evaluate(() => window.tflexDiagnostics());
  console.log('B3 after reopen engine annotations:', JSON.stringify(diag.engineState?.annotations));
  await snap('b3-after-reopen');
});
