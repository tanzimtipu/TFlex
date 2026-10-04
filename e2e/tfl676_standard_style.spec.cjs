// TFL-676 (QA) — independent raw-px check that the `standard` tab style is
// unchanged by the TFL-524 colorful top-edge fix (DEF-534).
//
// Criterion 5: switching Preferences "Tab style" to `standard` leaves the
// classic 34px tabs with equal tops. This spec measures real rendered geometry
// under the default colorful style, then again after switching to standard.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

test.setTimeout(300000);

async function openBundledSample(app, win, sampleName) {
  const p = getSamplePath(sampleName);
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(1400);
}

async function openPrefs(win) {
  await win.locator('[data-open-preferences]').first().click();
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
  await win.waitForSelector('[data-prefs-tab-style]', { state: 'visible', timeout: 10000 });
}

async function closePrefs(win) {
  await win.locator('[data-prefs-dialog] .sheet-close').first().click();
  await win.waitForSelector('[data-prefs-dialog]', { state: 'hidden', timeout: 10000 });
}

async function measureTabs(win) {
  return win.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
    return tabs.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-tab-id'),
        active: el.getAttribute('aria-selected') === 'true',
        top: r.top,
        bottom: r.bottom,
        height: r.height,
      };
    });
  });
}

test('standard tab style stays 34px with one equal top edge', async () => {
  const app = await launchApp([], path.join(os.tmpdir(), `tflex-tfl676-std-${Date.now()}`));
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);

  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
  await openBundledSample(app, win, 'long.pdf');
  await expect(win.locator('[data-tab-id]')).toHaveCount(2, { timeout: 30000 });
  expect(await win.locator('.tab-area').getAttribute('data-tab-style')).toBe('colorful');

  const colorful = await measureTabs(win);
  console.log(`[TFL676-std] colorful=${JSON.stringify(colorful)}`);

  await openPrefs(win);
  await win.locator('[data-prefs-tab-style]').selectOption('standard');
  await win.waitForTimeout(600);
  expect(await win.locator('.tab-area').getAttribute('data-tab-style')).toBe('standard');
  await closePrefs(win);
  await win.waitForTimeout(400);

  const standard = await measureTabs(win);
  console.log(`[TFL676-std] standard=${JSON.stringify(standard)}`);
  expect(standard.length, 'two standard tabs present').toBe(2);

  for (const t of standard) {
    expect(t.height, `standard tab ${t.id} is 34px (got ${t.height})`).toBeGreaterThanOrEqual(33.5);
    expect(t.height, `standard tab ${t.id} is 34px (got ${t.height})`).toBeLessThanOrEqual(34.5);
  }
  const tops = standard.map((t) => t.top);
  expect(Math.max(...tops) - Math.min(...tops), `standard tops equal (${tops.join(',')})`).toBeLessThanOrEqual(0.5);

  await win.locator('.tab-area').screenshot({ path: path.join(SHOTS, 'tfl676-tab-strip-standard.png') });

  await hardClose(app, 'tfl676-std');
});
