// TFL-1393 criterion-4 freeze regression (post guided-form retirement).
//
// The C1 freeze (TFL-1397) unmounted the whole React tree when a document-less
// tab became active after a form edit. TFL-1436 retired the guided-fill panel
// that caused it, so this is the post-retirement repro: open the form sample,
// EDIT a real on-canvas field (.forms-layer input[data-form-field]), then open
// a new tab ([data-new-tab]). The app chrome must stay visible and interactive
// (no blank / frozen tree), and returning to the document tab must restore the
// workspace. Launches only through the canonical e2e/lib/launch.cjs helper.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { openSamplePath, hardClose, scrollToPage } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

test('form edit then new tab does not freeze the workspace (TFL-1393 criterion 4)', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const pageErrors = [];
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));
    await win.waitForSelector('.sample-card', { timeout: 30000 });

    // Open the form sample through the real generic Open + Intake flow.
    await openSamplePath(win, app, getSamplePath('form.pdf'));
    await expect(win.locator('.workspace:visible').first()).toBeVisible({ timeout: 30000 });
    await expect.poll(
      () => win.evaluate(() => (window.tflexDiagnostics().formFields || []).length),
      { timeout: 30000, message: 'form.pdf exposes AcroForm fields' },
    ).toBeGreaterThan(0);

    // Pick a real writable on-canvas text field.
    const target = await win.evaluate(() => {
      const fields = window.tflexDiagnostics().formFields || [];
      return fields.find((f) => f.kind === 'text' && f.readOnly !== true && f.rect && f.rect.height > 0)
        || fields.find((f) => f.kind === 'text' && f.readOnly !== true)
        || null;
    });
    expect(target, 'a writable on-canvas text field').toBeTruthy();

    await scrollToPage(win, target.page);
    const field = win.locator(`.forms-layer input[data-form-field="${target.id}"]`).first();
    await field.waitFor({ state: 'visible', timeout: 20000 });

    // EDIT the field and prove the value lands in the engine.
    const VALUE = 'TFL-1393 freeze';
    await field.fill(VALUE);
    await expect.poll(
      () => win.evaluate((id) => {
        const f = (window.tflexDiagnostics().formFields || []).find((x) => x.id === id);
        return f ? f.value : null;
      }, target.id),
      { timeout: 20000, message: 'the edited value reaches the engine' },
    ).toBe(VALUE);

    const tabsBefore = await win.locator('[data-tab-id]').count();

    // New tab - the freeze trigger.
    await win.locator('[data-new-tab]').first().click();
    await win.waitForTimeout(1200);

    // The app chrome must survive a blank/frozen tree.
    await expect(win.locator('.app')).toBeVisible({ timeout: 10000 });
    await expect(win.locator('.titlebar')).toBeVisible({ timeout: 10000 });
    await expect(win.locator('.document-rail')).toBeVisible({ timeout: 10000 });

    const afterNewTab = await win.evaluate(() => {
      const root = document.getElementById('root');
      return {
        rootLen: root ? root.innerHTML.length : 0,
        tabCount: document.querySelectorAll('[data-tab-id]').length,
        docSurface: document.querySelector('.workspace') !== null,
        homeSurface: document.querySelector('.welcome') !== null,
      };
    });
    expect(afterNewTab.rootLen, 'renderer tree is not blank after the new tab').toBeGreaterThan(1000);
    expect(afterNewTab.tabCount, 'a new tab was added').toBeGreaterThan(tabsBefore);
    await win.screenshot({ path: path.join(SHOTS, 'tfl1393-form-edit-new-tab.png') });

    // Interactivity: return to the document tab; its workspace must re-appear.
    await win.locator('[data-tab-id]').first().click();
    await expect(win.locator('.workspace:visible').first()).toBeVisible({ timeout: 15000 });
    await expect(win.locator('.pdf-page canvas:visible').first()).toBeVisible({ timeout: 15000 });
    await expect(win.locator('[data-new-tab]').first()).toBeVisible();

    const freezeErrors = pageErrors.filter((m) => /Maximum update depth/i.test(m));
    expect(freezeErrors, 'no React "Maximum update depth" freeze error').toEqual([]);
    console.log(`[TFL-1393] tabs ${tabsBefore}->${afterNewTab.tabCount} rootLen=${afterNewTab.rootLen} docSurface=${afterNewTab.docSurface} homeSurface=${afterNewTab.homeSurface} pageErrors=${JSON.stringify(pageErrors)}`);
  } finally {
    await hardClose(app, 'tfl1393-freeze');
  }
});
