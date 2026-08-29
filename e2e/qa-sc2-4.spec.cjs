const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');
const { PDFDocument } = require('pdf-lib');

test('SC 2-4: Verification', async () => {
  const screenshotsDir = path.resolve(__dirname, '../screenshots');
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  await window.setViewportSize({ width: 1280, height: 800 });

  // Using temp copy for DEF-026
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace');

  // Create one annotation for tests
  await window.locator('button[data-tool="highlight"]').click();
  // Ensure the page is scrolled into view so the text layer mounts
  await window.locator('.pdf-page[data-page="1"]').scrollIntoViewIfNeeded();
  await window.waitForSelector('.pdf-page[data-page="1"] .textLayer', { timeout: 30000 });
  // Wait for at least some spans to be present and visible
  await window.waitForFunction(() => {
    const spans = document.querySelectorAll('.pdf-page[data-page="1"] .textLayer span');
    return spans.length > 5 && Array.from(spans).some(s => s.getBoundingClientRect().width > 0);
  });
  const span = window.locator('.pdf-page[data-page="1"] .textLayer span').first();
  const r = await span.boundingBox();
  await window.mouse.move(r.x + 2, r.y + 2);
  await window.mouse.down();
  await window.mouse.move(r.x + r.width - 2, r.y + r.height - 2, { steps: 5 });
  await window.mouse.up();
  
  await new Promise(r => setTimeout(r, 1000));

  // SC 2: Zoom
  console.log('Testing zoom...');
  await window.click('button[title="Zoom out"]');
  await window.click('button[title="Zoom out"]');
  await new Promise(r => setTimeout(r, 1000));
  await window.screenshot({ path: path.join(screenshotsDir, 'markup-quads.png') });

  await window.click('button[title="Zoom in"]');
  await window.click('button[title="Zoom in"]');
  await window.click('button[title="Zoom in"]');
  await window.click('button[title="Zoom in"]');
  await new Promise(r => setTimeout(r, 1000));
  
  // Create all kinds for annotation-kinds.png
  console.log('Creating all kinds for screenshot...');
  const overlay = window.locator('.annotation-layer[data-annotation-layer="1"]');
  const box2 = await overlay.boundingBox();
  // rect
  await window.locator('button[data-tool="rect"]').click();
  await window.mouse.move(box2.x + 50, box2.y + 300);
  await window.mouse.down();
  await window.mouse.move(box2.x + 150, box2.y + 400);
  await window.mouse.up();
  // ellipse
  await window.locator('button[data-tool="ellipse"]').click();
  await window.mouse.move(box2.x + 200, box2.y + 300);
  await window.mouse.down();
  await window.mouse.move(box2.x + 300, box2.y + 400);
  await window.mouse.up();
  // arrow
  await window.locator('button[data-tool="arrow"]').click();
  await window.mouse.move(box2.x + 350, box2.y + 300);
  await window.mouse.down();
  await window.mouse.move(box2.x + 450, box2.y + 400);
  await window.mouse.up();
  // ink
  await window.locator('button[data-tool="ink"]').click();
  await window.mouse.move(box2.x + 500, box2.y + 300);
  await window.mouse.down();
  await window.mouse.move(box2.x + 550, box2.y + 350);
  await window.mouse.move(box2.x + 600, box2.y + 300);
  await window.mouse.up();
  
  await new Promise(r => setTimeout(r, 1000));
  await window.screenshot({ path: path.join(screenshotsDir, 'annotation-kinds.png') });

  // SC 3: Panel
  console.log('Testing panel...');
  await window.click('button[title="Annotations"]');
  await window.waitForSelector('.ann-panel-row');
  
  await window.click('.ann-panel-text-display');
  await window.fill('.ann-panel-text', 'Edited Note Content');
  await window.screenshot({ path: path.join(screenshotsDir, 'panel-edit.png') });
  await window.keyboard.press('Control+Enter');

  const tempPath = path.join(process.env.TEMP || 'C:\\Users\\tanzi\\AppData\\Local\\Temp', `tflex-qa-roundtrip-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, tempPath);
  await window.click('button[aria-label="Save As"]');
  await window.waitForFunction(() => !window.tflexDiagnostics().modified, { timeout: 20000 });

  await window.click('.tab-close');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, tempPath);
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace');
  await window.screenshot({ path: path.join(screenshotsDir, 'post-reopen.png') });
  
  const diag = await window.evaluate(() => window.tflexDiagnostics());
  expect(diag.engineState.annotations.length).toBeGreaterThanOrEqual(1);

  if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  await electronApp.close();
});
