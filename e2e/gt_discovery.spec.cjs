const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');

test.describe('GT Discovery', () => {
  let electronApp;
  let firstWindow;
  const installedPath = path.join(process.env.LOCALAPPDATA, 'Programs', 'TFlex', 'TFlex.exe');

  test.beforeAll(async () => {
    console.log(`Launching installed app: ${installedPath}`);
    electronApp = await launchApp([], null, installedPath);
    firstWindow = await electronApp.firstWindow();
    await firstWindow.waitForTimeout(2000);
  });

  test.afterAll(async () => {
    if (electronApp) await electronApp.close();
  });

  test('dump welcome DOM + sample cards', async () => {
    await firstWindow.waitForSelector('.welcome', { timeout: 20000 });
    // Dump sample card names
    const cards = await firstWindow.$$eval('.sample-card', (els) =>
      els.map((e) => e.getAttribute('class') + ' :: ' + e.textContent)
    );
    console.log('SAMPLE CARDS:\n' + JSON.stringify(cards, null, 2));
    await firstWindow.screenshot({ path: 'screenshots/gt_discovery_welcome.png' });
  });

  test('open report.pdf and dump workspace', async () => {
    // Click the report.pdf sample card
    const card = firstWindow.locator('.sample-card', { hasText: 'report.pdf' });
    await card.click();
    await firstWindow.waitForSelector('.workspace', { timeout: 30000 });
    await firstWindow.waitForTimeout(2000);
    await firstWindow.screenshot({ path: 'screenshots/gt_discovery_workspace.png' });

    // Dump workspace outerHTML
    const wsHtml = await firstWindow.evaluate(() => {
      const el = document.querySelector('.workspace');
      return el ? el.outerHTML : '<NONE>';
    });
    fs.writeFileSync('screenshots/gt_workspace_html.txt', wsHtml);
    console.log('WORKSPACE HTML length:', wsHtml.length);

    // Dump sidebar thumbnail structure
    const railHtml = await firstWindow.evaluate(() => {
      const rail = document.querySelector('.side-rail') || document.querySelector('[data-rail-tab]');
      return rail ? rail.outerHTML : '<NO RAIL>';
    });
    fs.writeFileSync('screenshots/gt_rail_html.txt', railHtml);
    console.log('RAIL HTML length:', railHtml.length);

    // Dump tab list
    const tabList = await firstWindow.$$eval('.tab-list *, [role="tablist"] *', (els) =>
      els.map((e) => ({ tag: e.tagName, cls: e.className, text: e.textContent }))
    );
    console.log('TABS:\n' + JSON.stringify(tabList, null, 2));
  });

  test('dump App.jsx public actions / toolbar', async () => {
    const toolbar = await firstWindow.$eval('.toolbar, [data-toolbar]', (e) => e.outerHTML).catch(() => '<NO TOOLBAR>');
    fs.writeFileSync('screenshots/gt_toolbar_html.txt', toolbar);
    console.log('TOOLBAR length:', toolbar.length);
  });
});
