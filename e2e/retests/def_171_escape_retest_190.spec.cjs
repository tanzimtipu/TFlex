// DEF-171 retest on the DEV build (v1.9.0, commit e3673fd) - the Signature
// manager now closes on Escape via a window-level keydown added to
// SignatureManagerModal.tsx. Original repro (kept verbatim): open a PDF,
// click the Sign tool, press Escape - the dialog AND its .modal-backdrop
// must both disappear, and the workspace behind them must be interactive
// again (the original defect harm was the backdrop intercepting pointer
// events on the theme toggle). Also re-verified: Escape from the Type tab
// (focus inside the input), Escape from the Saved tab, and the Close button
// path (must not have regressed), mirroring the unit test
// test/unit/renderer/defDEF171_signatureManagerEscape.test.tsx.
// Canonical launcher, dev build (no executablePath).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
let electronApp = null;
let win = null;

async function modalState() {
  return win.evaluate(() => ({
    sigVisible: !!document.querySelector('.sig-manager'),
    backdrop: !!document.querySelector('.modal-backdrop'),
  }));
}

async function openSignatureManager() {
  await win.click('button[aria-label="Sign tool"]');
  await win.waitForSelector('.sig-manager', { timeout: 10000 });
  await win.waitForTimeout(400);
  const st = await modalState();
  expect(st.sigVisible, 'signature manager open').toBe(true);
  expect(st.backdrop, 'modal backdrop present while open').toBe(true);
}

test('DEF-171 retest: Escape closes the Signature manager + backdrop, workspace interactive again', async () => {
  test.setTimeout(300000);
  electronApp = await launchApp();
  win = await electronApp.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await win.locator('button:has-text("Open PDF")').first().click();
    await win.waitForSelector('.workspace', { timeout: 30000 });
    await win.waitForTimeout(2000);

    // ---- 1. Primary repro: open Sign manager on the Draw tab, press Escape ----
    await openSignatureManager();
    await win.screenshot({ path: path.join(SHOTS, 'def-171-retest-open-before-escape.png') });
    await win.keyboard.press('Escape');
    await win.waitForTimeout(800);
    const afterEsc = await modalState();
    console.log('[DEF-171] after Escape (draw tab):', JSON.stringify(afterEsc));
    await win.screenshot({ path: path.join(SHOTS, 'def-171-retest-escape-closed.png') });
    expect(afterEsc.sigVisible, 'dialog must close on Escape').toBe(false);
    expect(afterEsc.backdrop, 'backdrop must be removed on Escape').toBe(false);

    // ---- 2. The defect harm: workspace must be interactive again (theme toggle) ----
    const themeBefore = await win.evaluate(() => document.documentElement.dataset.theme || 'light');
    await win.locator('.theme-toggle').click();
    await win.waitForTimeout(500);
    const themeAfter = await win.evaluate(() => document.documentElement.dataset.theme || 'light');
    console.log('[DEF-171] theme before/after toggle:', themeBefore, '->', themeAfter);
    expect(themeAfter, 'theme toggle click must land after Escape (no backdrop interception)')
      .not.toBe(themeBefore);
    // restore the original theme for a neutral state
    await win.locator('.theme-toggle').click();
    await win.waitForTimeout(400);

    // ---- 3. Escape with focus inside the Type input ----
    await openSignatureManager();
    await win.locator('.sig-tab', { hasText: 'Type' }).click();
    await win.waitForTimeout(300);
    await win.locator('.sig-manager input[aria-label="Type your signature"]').fill('Retest Name');
    await win.locator('.sig-manager input[aria-label="Type your signature"]').focus();
    await win.keyboard.press('Escape');
    await win.waitForTimeout(800);
    const afterTypeEsc = await modalState();
    console.log('[DEF-171] after Escape (type tab, input focused):', JSON.stringify(afterTypeEsc));
    expect(afterTypeEsc.sigVisible, 'dialog must close on Escape from the Type input').toBe(false);
    expect(afterTypeEsc.backdrop).toBe(false);

    // ---- 4. Escape from the Saved tab ----
    await openSignatureManager();
    await win.locator('.sig-tab', { hasText: 'Saved' }).click();
    await win.waitForTimeout(300);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(800);
    const afterSavedEsc = await modalState();
    console.log('[DEF-171] after Escape (saved tab):', JSON.stringify(afterSavedEsc));
    expect(afterSavedEsc.sigVisible, 'dialog must close on Escape from the Saved tab').toBe(false);
    expect(afterSavedEsc.backdrop).toBe(false);

    // ---- 5. Regression: the Close button still closes (pre-fix working path) ----
    await openSignatureManager();
    await win.locator('.sig-manager [aria-label="Close dialog"]').click();
    await win.waitForTimeout(700);
    const afterClose = await modalState();
    console.log('[DEF-171] after Close button:', JSON.stringify(afterClose));
    expect(afterClose.sigVisible, 'Close button path unchanged').toBe(false);
    expect(afterClose.backdrop).toBe(false);

    // ---- 6. Escape must not leak into other modals' state: reopen Insert pages
    // dialog right after and Escape-close it as usual (no cross-talk). ----
    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
    await win.click('[data-tool-id="insertPages"]');
    await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 8000 });
    await win.waitForTimeout(400);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(600);
    const insertGone = await win.evaluate(() => !document.querySelector('[data-insert-pages-dialog]'));
    expect(insertGone, 'Insert pages dialog still Escape-closes (no cross-talk from the fix)').toBe(true);

    await win.screenshot({ path: path.join(SHOTS, 'def-171-retest-final-state.png') });
    await hardClose(electronApp);
  } catch (err) {
    console.log('[DEF-171 retest] FAILED:', err.message);
    await win.screenshot({ path: path.join(SHOTS, 'def-171-retest-FAILURE.png') }).catch(() => {});
    await hardClose(electronApp);
    throw err;
  }
});