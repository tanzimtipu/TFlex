// Phase 58 (qa) - PACKAGED-build smoke: criterion 13 ("the packaged installer
// and portable build still produce and launch") plus the new tab-window IPC
// (tab tear-out / drag-back) driven against the PORTABLE exe.
//
// The artifact is the portable build; its absolute path is supplied through the
// TFLEX_E2E_EXE environment variable and launchApp (e2e/lib/launch.cjs) honours
// it when no explicit executablePath is passed. Missing/incorrect env is FAIL,
// not a silent skip.
//
// The detach gesture mirrors e2e/phase58_tab_detach.spec.cjs: press the tab's
// `.tab-title`, move straight down (the DEF-412 total-movement arm
// threshold) past the strip, release -> a NEW `#detached` window adopts the
// document and the origin drops a tab. Tearing back returns it and closes the
// detached window.
//
// Run with:
//   $env:TFLEX_E2E_EXE='<abs>\release\Jovrel-1.45.0-portable-x64.exe'
//   npx.cmd playwright test phase58_packaged_smoke.spec.cjs
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, dismissUpdatePrompt } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const EXE = process.env.TFLEX_E2E_EXE;
const log = (label, obj) => console.log(`[p58-pkg|${label}] ${JSON.stringify(obj)}`);

test.setTimeout(300000);

let app = null;

test.beforeEach(async () => {
  // Fail loud if the packaged target is not supplied: without it launchApp
  // would silently launch the dev build instead of the packaged artifact.
  if (!EXE) {
    throw new Error(
      'TFLEX_E2E_EXE is not set - this spec verifies the PACKAGED build only. ' +
      'Set TFLEX_E2E_EXE to the absolute portable exe path and rerun.',
    );
  }
  expect(fs.existsSync(EXE), `packaged exe not found at TFLEX_E2E_EXE=${EXE}`).toBe(true);
  app = await launchApp();
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p58-pkg');
  app = null;
});

async function tabTitles(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-tab-id]')).map((el) => {
      const t = el.querySelector('.tab-title');
      return (t === null ? el.textContent : t.textContent).replace(/\s+/g, ' ').trim();
    }));
}

async function windowReport(electronApp) {
  const wins = electronApp.windows().filter((w) => !w.isClosed());
  return Promise.all(wins.map(async (w) => ({ url: w.url() })));
}


// Perform the tear-out gesture on the first tab of `page`: straight down from
// the title past the bottom of the strip, then release.
async function tearOutTab(page) {
  const title = page.locator('[data-tab-id] .tab-title').first();
  const titleBox = await title.boundingBox();
  const strip = await page.locator('.tab-list').boundingBox();
  const startX = titleBox.x + titleBox.width / 2;
  const startY = titleBox.y + titleBox.height / 2;
  const targetY = strip.y + strip.height + 60;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 10, { steps: 4 }); // cross the 6px arm threshold, straight down
  await page.mouse.move(startX, targetY, { steps: 12 });
  await page.mouse.up();
  try { await page.waitForTimeout(500); } catch { /* detached close is synchronous */ }
}

test('packaged: tab tear-out into #detached opens a second window and the drag-back returns it', async () => {
  const origin = await app.firstWindow();
  origin.on('pageerror', (e) => log('origin-pageerror', String(e).slice(0, 300)));
  await origin.waitForSelector('.sample-card', { timeout: 60000 });
  await dismissUpdatePrompt(origin);
  await origin.waitForTimeout(300);

  // 1. Open ONE bundled sample through the real Open flow -> single tab.
  const sample = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, sample);
  await origin.locator('[data-toolbar-open]').first().click();
  await origin.waitForSelector('.workspace', { timeout: 60000 });
  await expect(origin.locator('[data-tab-id]')).toHaveCount(1, { timeout: 60000 });
  await origin.waitForTimeout(700);

  // The Action Dock renders verbs for the open document.
  const dockVerbs = await origin.locator('[data-dock-verb]').count();
  expect(dockVerbs, 'Action Dock renders at least one verb').toBeGreaterThan(0);

  const title = (await tabTitles(origin))[0];
  log('step1', { tabs: await origin.locator('[data-tab-id]').count(), dockVerbs, title, windows: await windowReport(app) });

  // 2. Tear the tab out.
  const secondP = app.waitForEvent('window', { timeout: 30000 }).catch(() => null);
  await tearOutTab(origin);
  const second = await secondP;
  log('step2-windows', { windows: await windowReport(app) });
  expect(second, 'tear-out gesture opened a new window').not.toBeNull();

  await second.waitForLoadState('domcontentloaded');
  const secondUrl = second.url();
  expect(secondUrl, 'new window URL carries the #detached hash').toContain('#detached');
  await second.waitForSelector('[data-tab-id]', { timeout: 60000 });
  await second.waitForTimeout(900);
  const detachedTitles = await tabTitles(second);
  expect(detachedTitles, 'detached window adopted the document').toContain(title);
  await second.screenshot({ path: path.join(SHOTS, 'p58-packaged-detach.png') });
  log('step2-detached', { url: secondUrl, tabs: detachedTitles });

  // The origin dropped exactly one tab: the document MOVED, not copied.
  await expect(origin.locator('[data-tab-id]')).toHaveCount(0, { timeout: 30000 });
  log('step2-origin', { tabs: await origin.locator('[data-tab-id]').count() });

  // 3. Tear the tab back out of the detached window -> return + close.
  const closeP = second.waitForEvent('close', { timeout: 30000 }).catch(() => null);
  await tearOutTab(second);
  const closed = await closeP;
  expect(closed, 'detached window closed after the drag-back').not.toBeNull();

  await expect(origin.locator('[data-tab-id]')).toHaveCount(1, { timeout: 30000 });
  const returnedTitles = await tabTitles(origin);
  expect(returnedTitles, 'origin re-adopted the returned document').toContain(title);
  const survivors = app.windows().filter((w) => !w.isClosed());
  log('step3-returned', { tabs: returnedTitles, windows: await windowReport(app), survivingWindows: survivors.length });
  expect(survivors.length, 'only the origin window survives after the drag-back').toBe(1);
});