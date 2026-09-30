// Release hygiene smoke for the SHIPPED 1.45.4 packaged build (TFL-78 step 4).
//
// The artifact is the packaged payload of the published 1.45.4 installer:
// release/win-unpacked/Jovrel.exe. Its absolute path is supplied through
// TFLEX_E2E_EXE and launchApp (e2e/lib/launch.cjs) honours it when no explicit
// executablePath is passed. Missing/incorrect env is FAIL, not a silent skip.
//
// Verifies ONLY: boot, bundled-sample open + Action Dock, and the About dialog's
// 1.45.4 What's New entry. The 1.45.3 feature assertions are NOT part of this
// task and are intentionally omitted.
//
// Run with:
//   $env:TFLEX_E2E_EXE='<abs>\release\win-unpacked\Jovrel.exe'
//   npx.cmd playwright test release_1454_smoke.spec.cjs
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
  if (app) await hardClose(app, 'rel1454');
});

test('packaged 1.45.4 boots, opens a sample, reports 1.45.4 in About', async () => {
  // 1. Boot: welcome/workspace renders, no error page.
  await win.waitForSelector('.sample-card', { timeout: 60000 });
  await dismissUpdatePrompt(win);
  const bodyText = await win.evaluate(() => document.body.innerText);
  expect(bodyText, 'no error page').not.toMatch(/something went wrong|failed to load|uncaught exception/i);
  console.log('[rel1454] boot ok');

  // 2. Open a bundled sample PDF -> tab + Action Dock verbs.
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 60000 });
  await expect(win.locator('[data-tab-id]')).toHaveCount(1, { timeout: 60000 });
  const dockVerbs = await win.locator('[data-dock-verb]').count();
  expect(dockVerbs, 'Action Dock renders at least one verb').toBeGreaterThan(0);
  console.log(`[rel1454] sample open: tabs=1 dockVerbs=${dockVerbs}`);

  // 3. Evidence screenshot of the packaged workspace.
  fs.mkdirSync(SHOTS, { recursive: true });
  await win.screenshot({ path: path.join(SHOTS, 'release-1454-packaged.png') });

  // 4. About dialog shows the 1.45.4 What's New entry.
  await app.evaluate(({ BrowserWindow }, channel) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.webContents.send(channel, { action: 'about' });
  }, 'menu:action');
  await win.waitForSelector('[data-about-dialog]:visible', { timeout: 15000 });
  const versionLabel = (await win.locator('[data-whats-new-version]').innerText()).trim();
  console.log(`[rel1454] about whats-new version="${versionLabel}"`);
  expect(versionLabel, 'About shows the 1.45.4 notes').toContain('1.45.4');
  const highlights = win.locator('[data-whats-new-highlight]');
  expect(await highlights.count(), 'at least one 1.45.4 highlight').toBeGreaterThanOrEqual(1);
  await expect(highlights.first()).toBeVisible();
  const first = (await highlights.first().innerText()).trim();
  expect(first.length).toBeGreaterThan(0);
  console.log(`[rel1454] first highlight="${first.slice(0, 90)}"`);
});
