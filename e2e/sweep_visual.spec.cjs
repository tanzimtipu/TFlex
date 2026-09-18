// VISUAL SWEEP - capture every major screen in both themes on the installed
// v1.7.11 app for look-and-feel judgment (single accent, no purple, both themes
// equally polished, no emojis, readability).
const { test } = require('@playwright/test');
const path = require('node:path');
const { launchDev, openSample, getSamplePath , hardClose, armAnnotationTool } = require('./lib/helpers.cjs');

let electronApp = null;
let win = null;

function snap(name) {
  return win.screenshot({ path: path.join(__dirname, '..', 'screenshots', name) });
}
async function readTheme() {
  return win.evaluate(() => document.documentElement.getAttribute('data-theme') || document.querySelector('body').getAttribute('data-theme') || 'light');
}
async function setTheme(want) {
  const cur = await readTheme();
  if (cur !== want) {
    // 1.10.0+: the theme control is an embedded dropdown - open the
    // popover and select the explicit option (no blind toggle anymore).
    await win.click('.theme-toggle');
    await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
    await win.click(`[data-theme-option="${want}"]`);
    await win.waitForFunction(
      (w) => document.documentElement.getAttribute('data-theme') === w,
      want,
    );
  }
  await win.waitForTimeout(400);
}

test.beforeEach(async () => {
  ({ electronApp, window: win } = await launchDev());
});
test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null; win = null;
});
test.setTimeout(240000);

test('VISUAL: every major screen in both themes', async () => {
  // Welcome screen, light then dark.
  await setTheme('light');
  await win.waitForTimeout(400);
  await snap('visual-welcome-light.png');
  await setTheme('dark');
  await win.waitForTimeout(400);
  await snap('visual-welcome-dark.png');

  // Open report.pdf -> workspace.
  const samplePath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, samplePath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);

  await setTheme('light');
  await win.waitForTimeout(500);
  await snap('visual-workspace-light.png');
  await setTheme('dark');
  await win.waitForTimeout(500);
  await snap('visual-workspace-dark.png');

  // Annotation toolbar prominent (arm highlight) in dark.
  await armAnnotationTool(win, 'highlight');
  await win.waitForTimeout(400);
  await snap('visual-annotations-dark.png');
  await setTheme('light');
  await win.waitForTimeout(500);
  await snap('visual-annotations-light.png');

  // Tools palette in both themes.
  const open = await win.evaluate(() => document.querySelector('[data-tools-palette]') !== null);
  if (!open) { await win.click('[data-tools-toggle]'); await win.waitForSelector('[data-tools-palette]', { timeout: 8000 }); }
  await win.waitForTimeout(400);
  await snap('visual-palette-light.png');
  await setTheme('dark');
  await win.waitForTimeout(500);
  await snap('visual-palette-dark.png');

  // Insert-pages dialog: capture in current theme, close, toggle, reopen, capture.
  const openPalette = async () => {
    const open = await win.evaluate(() => document.querySelector('[data-tools-palette]') !== null);
    if (!open) { await win.click('[data-tools-toggle]'); await win.waitForSelector('[data-tools-palette]', { timeout: 8000 }); }
  };
  await setTheme('light');
  await openPalette();
  await win.click('[data-tool-id="insertPages"]');
  await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 8000 });
  await win.waitForTimeout(600);
  await snap('visual-dialog-light.png');
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-insert-pages-dialog]', { state: 'hidden', timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(500);

  await setTheme('dark');
  await openPalette();
  await win.click('[data-tool-id="insertPages"]');
  await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 8000 });
  await win.waitForTimeout(600);
  await snap('visual-dialog-dark.png');
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-insert-pages-dialog]', { state: 'hidden', timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(500);

  // Sign manager in light + dark (toggle theme with no modal open first).
  await setTheme('light');
  await win.click('button[aria-label="Sign tool"]');
  await win.waitForSelector('.sig-manager', { timeout: 10000 });
  await win.waitForTimeout(600);
  await snap('visual-sign-light.png');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(500);

  await setTheme('dark');
  await win.click('button[aria-label="Sign tool"]');
  await win.waitForSelector('.sig-manager', { timeout: 10000 });
  await win.waitForTimeout(600);
  await snap('visual-sign-dark.png');
});
