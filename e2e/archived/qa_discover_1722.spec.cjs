// QA discovery probe on installed v1.7.22 — verify the harness drives the
// installed binary, confirm key selectors, capture baseline screenshots.
const { test, expect } = require('@playwright/test');
const { launchDev, openSample, shot, hardClose } = require('../lib/helpers.cjs');

let electronApp = null;
let win = null;

test.beforeEach(async () => {
  ({ electronApp, window: win } = await launchDev());
  await win.waitForTimeout(400);
});

test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null; win = null;
});

test.setTimeout(180000);

test('discovery: open report, screenshot workspace, toggle dark', async () => {
  await openSample(win, electronApp, 'report.pdf');
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1000);
  await shot('qa-1722-discover-workspace-light.png');

  // Confirm the annotation toolbar exists.
  const annCount = await win.locator('.ann-toolbar button[data-tool]').count();
  console.log(`[ANN-TOOLS] count=${annCount}`);
  const annTools = await win.evaluate(() =>
    Array.from(document.querySelectorAll('.ann-toolbar button[data-tool]')).map((b) => b.getAttribute('data-tool'))
  );
  console.log(`[ANN-TOOLS] ${JSON.stringify(annTools)}`);

  // Confirm the edit toggle.
  const editToggle = await win.locator('[data-toolbar-edit-toggle]').count();
  console.log(`[EDIT-TOGGLE] count=${editToggle}`);

  // Toggle dark theme.
  await win.click('.theme-toggle');
  await win.waitForTimeout(600);
  const theme = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
  console.log(`[THEME] ${theme}`);
  await shot('qa-1722-discover-workspace-dark.png');

  expect(annTools.length).toBeGreaterThan(0);
});
