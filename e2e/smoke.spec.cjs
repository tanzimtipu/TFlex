const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');

test('smoke', async () => {
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();

  await window.waitForSelector('.sample-card', { timeout: 10000 });
  const sampleCount = await window.$$eval('.sample-card', el => el.length);
  expect(sampleCount).toBeGreaterThanOrEqual(4);

  console.log('Opening report.pdf (temp copy)...');
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await window.locator('button:has-text("Open PDF")').first().click();
  await window.waitForSelector('.workspace', { timeout: 15000 });

  const diagInit = await window.evaluate(() => window.tflexDiagnostics());
  expect(diagInit.pageCount).toBe(34);

  // Verify DEF-070
  console.log('Checking DEF-070...');
  await window.click('[aria-label="Highlight"]');
  const swatch = window.locator('.color-swatch, [aria-label="Pick color"]');
  if (await swatch.isVisible()) {
      await swatch.click();
      const hexInput = window.locator('input[aria-label="Custom color hex"]');
      if (await hexInput.isVisible()) {
          console.log('DEF-070: FIXED');
      } else {
          console.log('DEF-070: STILL OPEN');
      }
  } else {
      console.log('DEF-070: swatch not found');
  }

  // Verify DEF-068
  console.log('Checking DEF-068...');
  await window.click('.page-view', { position: { x: 100, y: 100 } });
  await window.waitForTimeout(2000);
  const diag = await window.evaluate(() => window.tflexDiagnostics());
  if (diag.engineState && diag.engineState.annotations.length > 0) {
      console.log('DEF-068: FIXED');
  } else {
      console.log('DEF-068: STILL OPEN');
  }
  
  // Verify DEF-073
  console.log('Checking DEF-073...');
  await window.click('[aria-label="Reduce file size"]');
  await window.waitForSelector('.dialog');
  await window.locator('select').first().selectOption('max');
  await window.keyboard.press('Escape');
  
  await window.click('[aria-label="Save As"]');
  await window.waitForSelector('.dialog');
  await window.keyboard.press('Escape');
  const finalPreset = await window.evaluate(() => window.tflexDiagnostics().optimizePreset);
  if (finalPreset === 'max') {
    console.log('DEF-073: FIXED');
  } else {
    console.log('DEF-073: STILL OPEN - preset was ' + finalPreset);
  }

  // Verify DEF-069
  console.log('Checking DEF-069...');
  await window.evaluate(() => {
    const fields = window.tflexDiagnostics().formFields;
    if (fields.length > 0) {
      window.tflex.engine.fillFormField(window.tflexDiagnostics().engineDocId, fields[0].id, 'Test');
    }
  });
  // Wait for modified
  await window.waitForFunction(() => window.tflexDiagnostics().modified);
  // Mock Save As
  const savePath = getSamplePath('saved.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await window.click('[aria-label="Save As"]');
  await window.click('button:has-text("Save")');
  await window.waitForFunction(() => !window.tflexDiagnostics().modified);
  console.log('DEF-069: FIXED');

  // Verify DEF-075
  console.log('Checking DEF-075...');
  await window.click('[aria-label="Sign tool"]');
  await window.click('button:has-text("Type")');
  await window.fill('input[type="text"]', 'Tester');
  await window.click('button:has-text("Use this signature")');
  await window.click('.page-view', { position: { x: 200, y: 200 } });
  await window.waitForFunction(() => window.tflexDiagnostics().signatures.length > 0);
  console.log('DEF-075: FIXED');

  // Verify DEF-074
  console.log('Checking DEF-074...');
  await electronApp.evaluate(({ Menu }) => {
    const helpMenu = Menu.getApplicationMenu().items.find(i => i.label === 'Help');
    helpMenu.submenu.items.find(i => i.label === 'About TFlex').click();
  });
  const aboutDialog = await window.waitForSelector('.about-dialog, .sheet, .dialog');
  const aboutText = await aboutDialog.textContent();
  if (aboutText.includes('TFlex') && (aboutText.includes('v1') || aboutText.includes('portable'))) {
      console.log('DEF-074: FIXED');
  } else {
      console.log('DEF-074: STILL OPEN - text: ' + aboutText);
  }

  await electronApp.close();
});
