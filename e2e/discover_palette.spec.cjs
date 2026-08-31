const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');

test('No-op Sweep: Palette Discovery', async () => {
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace');

  // Open Tools Palette
  await window.click('[aria-label="Tools palette"]');
  await window.waitForSelector('.tools-palette');

  const paletteControls = await window.evaluate(() => {
    const allButtons = Array.from(document.querySelectorAll('.tools-palette button'));
    return allButtons.map(b => ({
      text: b.innerText.trim(),
      title: b.title,
      ariaLabel: b.getAttribute('aria-label'),
      dataAttributes: Object.keys(b.dataset).reduce((acc, key) => {
        acc[key] = b.dataset[key];
        return acc;
      }, {})
    }));
  });

  console.log('PALETTE_CONTROLS_JSON:' + JSON.stringify(paletteControls, null, 2));
  await electronApp.close();
});
