// Release hygiene smoke for the SHIPPED 1.47.0 packaged build (TFL-308 / TFL-293 step 4).
//
// The artifact is the packaged payload of the published 1.47.0 installer:
// release/win-unpacked/Jovrel.exe. Its absolute path is supplied through
// TFLEX_E2E_EXE and launchApp (e2e/lib/launch.cjs) honours it when no explicit
// executablePath is passed. Missing/incorrect env is FAIL, not a silent skip.
//
// Verifies ONLY: boot, bundled-sample open + Action Dock, the 1.47.0 Book View
// control, and the About dialog's 1.47.0 What's New entry. The 1.46.x feature
// assertions are NOT part of this task and are intentionally omitted.
//
// Run with:
//   $env:TFLEX_E2E_EXE='<abs>\release\win-unpacked\Jovrel.exe'
//   npx.cmd playwright test release_1470_smoke.spec.cjs
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, dismissUpdatePrompt } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const EXE = process.env.TFLEX_E2E_EXE;

test.setTimeout(300000);

let app = null;
let win = null;

test.beforeAll(async () => {
  if (!EXE) {
    throw new Error(
      'TFLEX_E2E_EXE is not set - this spec verifies the PACKAGED build only. ' +
      'Set TFLEX_E2E_EXE to the absolute release/win-unpacked/Jovrel.exe path and rerun.',
    );
  }
  expect(fs.existsSync(EXE), `packaged exe not found at TFLEX_E2E_EXE=${EXE}`).toBe(true);
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await win.waitForFunction(() => typeof window.tflex !== 'undefined', null, { timeout: 30000 });
});

test.afterAll(async () => {
  if (app) await hardClose(app, 'rel1470');
});

test('packaged 1.47.0 boots, opens a sample, reports 1.47.0 in About', async () => {
  // 1. Boot: welcome/workspace renders, no error page.
  await win.waitForSelector('.sample-card', { timeout: 60000 });
  await dismissUpdatePrompt(win);
  const bodyText = await win.evaluate(() => document.body.innerText);
  expect(bodyText, 'no error page').not.toMatch(/something went wrong|failed to load|uncaught exception/i);
  console.log('[rel1470] boot ok');

  // 2. Open a bundled sample PDF -> tab + Action Dock verbs.
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 60000 });
  await expect(win.locator('[data-tab-id]')).toHaveCount(1, { timeout: 60000 });
  const dockVerbs = await win.locator('[data-dock-verb]').count();
  expect(dockVerbs, 'Action Dock renders at least one verb').toBeGreaterThan(0);
  console.log(`[rel1470] sample open: tabs=1 dockVerbs=${dockVerbs}`);

  // 2a. 1.47.0 headline feature: Book View control is present.
  const bookView = win.locator('[data-book-view-open]');
  await expect(bookView, 'Book View control present in 1.47.0').toHaveCount(1, { timeout: 30000 });
  console.log('[rel1470] book view control present');

  // 3. Evidence screenshot of the packaged workspace.
  fs.mkdirSync(SHOTS, { recursive: true });
  await win.screenshot({ path: path.join(SHOTS, 'release-1470-packaged.png') });

  // 4. About dialog shows the 1.47.0 What's New entry.
  await app.evaluate(({ BrowserWindow }, channel) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.webContents.send(channel, { action: 'about' });
  }, 'menu:action');
  await win.waitForSelector('[data-about-dialog]:visible', { timeout: 15000 });
  const versionLabel = (await win.locator('[data-whats-new-version]').innerText()).trim();
  console.log(`[rel1470] about whats-new version="${versionLabel}"`);
  expect(versionLabel, 'About shows the 1.47.0 notes').toContain('1.47.0');
  const highlights = win.locator('[data-whats-new-highlight]');
  expect(await highlights.count(), 'at least one 1.47.0 highlight').toBeGreaterThanOrEqual(1);
  await expect(highlights.first()).toBeVisible();
  const first = (await highlights.first().innerText()).trim();
  expect(first.length).toBeGreaterThan(0);
  console.log(`[rel1470] first highlight="${first.slice(0, 90)}"`);
});
