// Release hygiene smoke for the SHIPPED 1.45.1 packaged build.
//
// The artifact is the byte-identical packaged payload of the published 1.45.1
// installer/portable: release/win-unpacked/Jovrel.exe. Its absolute path is
// supplied through TFLEX_E2E_EXE and launchApp (e2e/lib/launch.cjs) honours it
// when no explicit executablePath is passed. Missing/incorrect env is FAIL, not
// a silent skip.
//
// Verifies: boot, bundled-sample open + Action Dock, the two head-line fixes of
// this release (colourful tab style default + Preferences control; non-PDF
// drag-drop opens), and the About dialog's 1.45.1 What's New entry.
//
// Run with:
//   $env:TFLEX_E2E_EXE='<abs>\release\win-unpacked\Jovrel.exe'
//   npx.cmd playwright test release_1451_smoke.spec.cjs
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, dismissUpdatePrompt } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const EXE = process.env.TFLEX_E2E_EXE;
const NONPDF = path.join(ROOT, 'test-fixtures', 'phase53', 'sample.txt');

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
  if (app) await hardClose(app, 'rel1451');
});

async function tabCount() {
  return win.evaluate(() => document.querySelectorAll('[data-tab-id]').length);
}

async function toasts() {
  return win.evaluate(() => Array.from(document.querySelectorAll('.toast-text')).map((e) => e.textContent));
}

/** Dispatch a real OS file-drop at the window centre via CDP (DEF-418 technique). */
async function dropFile(filePath) {
  const client = await app.context().newCDPSession(win);
  const box = await win.evaluate(() => {
    const el = document.querySelector('.workspace') || document.body;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  const data = { items: [], files: [filePath], dragOperationsMask: 1 };
  await client.send('Input.dispatchDragEvent', { type: 'dragEnter', x: box.x, y: box.y, data });
  await client.send('Input.dispatchDragEvent', { type: 'dragOver', x: box.x, y: box.y, data });
  await client.send('Input.dispatchDragEvent', { type: 'drop', x: box.x, y: box.y, data });
}

test('packaged 1.45.1 boots, opens a sample, carries the release features', async () => {
  // 1. Boot: welcome/workspace renders, no error page.
  await win.waitForSelector('.sample-card', { timeout: 60000 });
  await dismissUpdatePrompt(win);
  const bodyText = await win.evaluate(() => document.body.innerText);
  expect(bodyText, 'no error page').not.toMatch(/something went wrong|failed to load|uncaught exception/i);
  console.log('[rel1451] boot ok');

  // 2. Open a bundled sample PDF -> tab + Action Dock verbs.
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 60000 });
  await expect(win.locator('[data-tab-id]')).toHaveCount(1, { timeout: 60000 });
  const dockVerbs = await win.locator('[data-dock-verb]').count();
  expect(dockVerbs, 'Action Dock renders at least one verb').toBeGreaterThan(0);
  console.log(`[rel1451] sample open: tabs=1 dockVerbs=${dockVerbs}`);

  // 3a. Colourful tab style is the default; Preferences control exists.
  expect(await win.locator('.tab-area').getAttribute('data-tab-style')).toBe('colorful');
  await win.locator('[data-open-preferences]').first().click();
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
  await expect(win.locator('[data-prefs-tab-style]')).toBeVisible({ timeout: 10000 });
  console.log('[rel1451] tab style=colorful, [data-prefs-tab-style] present');
  await win.locator('[data-prefs-dialog] .sheet-close').first().click();
  await win.waitForSelector('[data-prefs-dialog]', { state: 'hidden', timeout: 10000 });

  // 3b. Drag-drop a NON-PDF fixture opens it, with no "is not a PDF" toast.
  const before = await tabCount();
  await dropFile(NONPDF);
  let after = before;
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    after = await tabCount().catch(() => before);
    if (after > before) break;
    await win.waitForTimeout(250);
  }
  const toastTexts = await toasts().catch(() => []);
  console.log(`[rel1451] drop txt: before=${before} after=${after} toasts=${JSON.stringify(toastTexts)}`);
  expect(after, 'non-PDF drop opened a tab').toBeGreaterThan(before);
  expect(toastTexts.join(' | '), 'no "is not a PDF" toast').not.toMatch(/is not a PDF/i);

  // 4. Evidence screenshot.
  fs.mkdirSync(SHOTS, { recursive: true });
  await win.screenshot({ path: path.join(SHOTS, 'release-1451-packaged.png') });

  // 5. About dialog shows the 1.45.1 What's New entry.
  await app.evaluate(({ BrowserWindow }, channel) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.webContents.send(channel, { action: 'about' });
  }, 'menu:action');
  await win.waitForSelector('[data-about-dialog]:visible', { timeout: 15000 });
  const versionLabel = (await win.locator('[data-whats-new-version]').innerText()).trim();
  console.log(`[rel1451] about whats-new version="${versionLabel}"`);
  expect(versionLabel, 'About shows the 1.45.1 notes').toContain('1.45.1');
  const highlights = win.locator('[data-whats-new-highlight]');
  expect(await highlights.count(), 'at least one 1.45.1 highlight').toBeGreaterThanOrEqual(1);
  await expect(highlights.first()).toBeVisible();
  const first = (await highlights.first().innerText()).trim();
  expect(first.length).toBeGreaterThan(0);
  console.log(`[rel1451] first highlight="${first.slice(0, 90)}"`);
});
