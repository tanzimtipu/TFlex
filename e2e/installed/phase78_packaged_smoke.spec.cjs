// TFL-281 (qa) â€” packaged-launch smoke for Phase 78 success criterion 6b.
//
// Proves the PACKAGED 1.46.0 build boots, reports the right version with zero
// startup errors, and renders the Phase 78 notice surface: the document-
// protection notice appears INSIDE the canvas at the top-right, and once
// collapsed its "i" sits immediately LEFT of the Book View control with the
// page-layout control at the far top-right.
//
// Launches ONLY through the canonical launchApp helper. Defaults to the
// packaged payload release/win-unpacked/Jovrel.exe (the same exe the portable
// wrapper extracts); override with TFLEX_PACKAGED_EXE. Synthetic encrypted
// fixture only (e2e/lib/p52_crypto.cjs) â€” no operator document.
//
// Run:
//   npx.cmd playwright test --config=e2e/installed/playwright.installed.config.js phase78_packaged_smoke.spec.cjs
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose, dismissUpdatePrompt } = require('../lib/helpers.cjs');
const { makeEncryptedFixture } = require('../lib/p52_crypto.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'screenshots');
const EXPECTED = require('../../package.json').version;
const PACKAGED_EXE =
  process.env.TFLEX_PACKAGED_EXE ||
  path.join(ROOT, 'release', 'win-unpacked', 'Jovrel.exe');

const ACTIVE = '.tab-pane[aria-hidden="false"] ';
const act = (sel) => ACTIVE + sel;

const pageErrors = [];
const consoleErrors = [];

let app = null;
let win = null;

test.setTimeout(300000);

test.beforeAll(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  expect(fs.existsSync(PACKAGED_EXE), `packaged exe exists at ${PACKAGED_EXE}`).toBe(true);
  app = await launchApp([], null, PACKAGED_EXE);
  win = await app.firstWindow();
  win.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  win.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(String(m.text()).slice(0, 300));
  });
});

test.afterAll(async () => {
  if (!app) return;
  // Item 5 â€” close cleanly: graceful quit first, bounded, then force teardown.
  const done = await Promise.race([
    app.close().then(() => true).catch(() => true),
    new Promise((r) => setTimeout(() => r(false), 15000)),
  ]);
  console.log(`[p78-packaged] graceful-close=${done}`);
  try { await hardClose(app, 'p78-packaged'); } catch { /* already gone */ }
  app = null;
  win = null;
});

async function stubOpen(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
}

function rectOf(selector) {
  return win.evaluate((sel) => {
    const el = document.querySelector('.tab-pane[aria-hidden="false"] ' + sel) || document.querySelector(sel);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom,
      width: r.width, height: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }, selector);
}

function overlaps(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

test('packaged 1.46.0 launches, version correct, zero startup errors, Phase 78 notice surface', async () => {
  // ------------------------------------------------------------------
  // Item 1 — main window opens and stays open (welcome grid renders).
  // ------------------------------------------------------------------
  await win.waitForSelector('.sample-card', { timeout: 60000 });
  await dismissUpdatePrompt(win);
  const title = await win.title();
  const winCount = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  console.log(`[p78-packaged] window title="${title}" windows=${winCount}`);
  expect(winCount, 'main window is open').toBeGreaterThanOrEqual(1);

  // ------------------------------------------------------------------
  // Item 3 — reported app version is 1.46.0.
  // ------------------------------------------------------------------
  const av = await app.evaluate(({ app: a }) => a.getVersion());
  console.log(`[p78-packaged] app.getVersion()=${av} expected=${EXPECTED}`);
  expect(EXPECTED, 'package.json version').toBe('1.46.0');
  expect(av, 'packaged app.getVersion()').toBe('1.46.0');

  // ------------------------------------------------------------------
  // Item 2 — no pageerror / console error during startup (up to first paint).
  // ------------------------------------------------------------------
  console.log(`[p78-packaged] startup pageerrors=${JSON.stringify(pageErrors)} consoleErrors=${JSON.stringify(consoleErrors)}`);
  expect(pageErrors, 'zero startup renderer page errors').toEqual([]);
  expect(consoleErrors, 'zero startup renderer console errors').toEqual([]);

  // ------------------------------------------------------------------
  // Item 4 — Phase 78 surface: open an encrypted fixture so the protection
  // notice appears inside the canvas top-right.
  // ------------------------------------------------------------------
  const fixture = await makeEncryptedFixture({
    name: 'p78-packaged-prot.pdf', algorithm: 'AES-256', userPassword: 'P78-Packaged!',
  });
  await stubOpen(fixture);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('[data-password-prompt]', { timeout: 20000 });
  await win.locator('[data-password-input]').fill('P78-Packaged!');
  await win.locator('[data-password-submit]').click();
  await win.waitForSelector('[data-password-prompt]', { state: 'detached', timeout: 30000 });
  await win.waitForSelector(act('[data-protection-notice]'), { timeout: 20000 });
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(SHOTS, 'phase78-packaged-protection-expanded.png') });

  const overlay = await rectOf('[data-canvas-overlay]');
  const notice = await rectOf('[data-protection-notice]');
  console.log(`[p78-packaged] overlay=${JSON.stringify(overlay)} notice=${JSON.stringify(notice)}`);
  expect(overlay, 'canvas overlay exists').not.toBeNull();
  expect(notice, 'protection notice is rendered').not.toBeNull();
  expect(notice.left, 'notice within canvas left edge').toBeGreaterThanOrEqual(overlay.left - 0.5);
  expect(notice.right, 'notice within canvas right edge').toBeLessThanOrEqual(overlay.right + 0.5);
  expect(notice.top, 'notice within canvas top edge').toBeGreaterThanOrEqual(overlay.top - 0.5);
  expect(notice.bottom, 'notice within canvas bottom edge').toBeLessThanOrEqual(overlay.bottom + 0.5);
  expect(notice.left, 'notice in the canvas right half').toBeGreaterThan(overlay.left + overlay.width / 2);
  expect(notice.top, 'notice at the canvas top').toBeLessThan(overlay.top + 160);

  // Collapsed "i" immediately LEFT of Book View; page-layout at far top-right.
  await win.locator(act('[data-protection-collapse]')).click();
  await win.waitForSelector(act('[data-protection-icon]'), { timeout: 8000 });
  await win.waitForTimeout(300);
  const icon = await rectOf('[data-protection-icon]');
  const book = await rectOf('[data-book-view-open]');
  const layout = await rectOf('[data-page-layout-control]');
  const gapBookIcon = book && icon ? book.left - icon.right : null;
  const gapBookLayout = book && layout ? layout.left - book.right : null;
  const layoutRightInset = overlay && layout ? overlay.right - layout.right : null;
  console.log(`[p78-packaged] icon=${JSON.stringify(icon)} book=${JSON.stringify(book)} layout=${JSON.stringify(layout)} gapBookIcon=${gapBookIcon} gapBookLayout=${gapBookLayout} layoutRightInset=${layoutRightInset}`);
  expect(icon, 'collapsed "i" exists').not.toBeNull();
  expect(book, 'Book View control exists').not.toBeNull();
  expect(layout, 'page-layout control exists').not.toBeNull();
  expect(gapBookIcon, `"i" immediately left of Book View (gap ${gapBookIcon}px)`).toBeGreaterThanOrEqual(0);
  expect(gapBookIcon, `"i" immediately left of Book View (gap ${gapBookIcon}px)`).toBeLessThanOrEqual(16);
  expect(gapBookLayout, `page-layout immediately right of Book View (gap ${gapBookLayout}px)`).toBeGreaterThanOrEqual(0);
  expect(gapBookLayout, `page-layout immediately right of Book View (gap ${gapBookLayout}px)`).toBeLessThanOrEqual(12);
  expect(layoutRightInset, `page-layout keeps the canvas right edge (${layoutRightInset}px)`).toBeLessThanOrEqual(14);
  expect(overlaps(icon, book), 'collapsed "i" does not overlap Book View').toBe(false);
  expect(overlaps(icon, layout), 'collapsed "i" does not overlap page-layout control').toBe(false);
  await win.screenshot({ path: path.join(SHOTS, 'phase78-packaged-protection-collapsed.png') });

  // Item 2 (whole run) — still no renderer errors after the surface smoke.
  console.log(`[p78-packaged] total pageerrors=${JSON.stringify(pageErrors)} consoleErrors=${JSON.stringify(consoleErrors)}`);
  expect(pageErrors, 'zero renderer page errors across the run').toEqual([]);
});