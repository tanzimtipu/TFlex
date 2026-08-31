const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');

test('No-op Sweep: Control Discovery', async () => {
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace');

  const controls = await window.evaluate(() => {
    const allButtons = Array.from(document.querySelectorAll('button, [role="button"], a'));
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

  console.log('CONTROLS_JSON:' + JSON.stringify(controls, null, 2));
  await electronApp.close();
});
