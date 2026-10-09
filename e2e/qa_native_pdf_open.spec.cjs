const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { openSamplePath, hardClose } = require('./lib/helpers.cjs');

test('native PDF open completes Intake from Home and from an existing document', async () => {
  const app = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card');
    const originalPicker = await app.evaluate(({ dialog }) => String(dialog.showOpenDialog));
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await expect(win.locator('.workspace')).toBeVisible();
    expect(await app.evaluate(({ dialog }) => String(dialog.showOpenDialog))).toBe(originalPicker);
    await openSamplePath(win, app, getSamplePath('form.pdf'));
    await expect.poll(() => win.evaluate(() => (window.tflexDiagnostics().formFields || []).length)).toBeGreaterThan(0);
    expect(await app.evaluate(({ dialog }) => String(dialog.showOpenDialog))).toBe(originalPicker);
  } finally { await hardClose(app, 'qa-native-pdf-open'); }
});
