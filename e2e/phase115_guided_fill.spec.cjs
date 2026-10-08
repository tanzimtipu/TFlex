// Phase 115 focused e2e - Guided Fill panel (focused QA, TFL-1340).
// Drives the REAL app through the canonical helpers. Selectors reflect the
// shipped DOM (src/renderer/forms/GuidedFillPanel.tsx, FieldProperties.tsx,
// GuidedFillPrimitives.tsx), not the illustrative component names.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { openSamplePath, hardClose, gotoStage, clickDockVerb, toggleThemeViaAppMenu } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const REQUIRED_FIXTURE = path.resolve(__dirname, '..', 'test-fixtures', 'phase115', 'guided-fill-required.pdf');

async function openDoc(win, app, file) {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openSamplePath(win, app, file);
  await expect(win.locator('.workspace')).toBeVisible();
  await expect.poll(() => win.evaluate(() => (window.tflexDiagnostics().formFields || []).length)).toBeGreaterThan(0);
}

async function ensureTheme(win, target) {
  for (let i = 0; i < 4; i += 1) {
    const current = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (current === target) return current;
    await toggleThemeViaAppMenu(win);
  }
  return win.evaluate(() => document.documentElement.getAttribute('data-theme'));
}

test.describe('Phase 115 Guided Fill panel', () => {
  let app = null;
  let win = null;

  test.afterEach(async () => {
    if (app) await hardClose(app, 'p115-guided-fill');
    app = null;
    win = null;
  });

  test('forms verb opens the panel (not Flatten), scope/summary/shared state/properties hold', async () => {
    test.setTimeout(120000);
    app = await launchApp();
    win = await app.firstWindow();
    await openDoc(win, app, getSamplePath('form.pdf'));

    // 1. flatten verb still opens FlattenConfirmDialog; forms verb does not.
    await clickDockVerb(win, 3, 'flatten');
    await expect(win.locator('[data-dialog-shell="flatten-confirm"]')).toBeVisible({ timeout: 10000 });
    await expect(win.locator('[data-form-panel]')).toHaveCount(0);
    await win.keyboard.press('Escape');
    await expect(win.locator('[data-dialog-shell="flatten-confirm"]')).toHaveCount(0, { timeout: 10000 });

    await clickDockVerb(win, 3, 'forms');
    await expect(win.locator('[data-form-panel="true"]')).toBeVisible({ timeout: 10000 });
    await expect(win.locator('[data-dialog-shell="flatten-confirm"]')).toHaveCount(0);

    // 2. scope figures are separate (Document + "Page n of m"); required summary renders.
    await expect(win.locator('[data-form-scope="true"]')).toBeVisible();
    await expect(win.locator('[data-form-scope-figure="document"]')).toHaveText('Document');
    await expect(win.locator('[data-form-scope-figure="page"]')).toHaveText(/^Page \d+ of \d+$/);
    await expect(win.locator('[data-form-required-summary]')).toBeVisible();

    // 3. shared state: panel edit -> overlay, overlay edit -> panel.
    const target = await win.evaluate(() => {
      const d = window.tflexDiagnostics();
      return (d.formFields || []).find((f) => f.kind === 'text' && f.readOnly !== true && f.value !== undefined) || null;
    });
    expect(target).toBeTruthy();
    const panelField = win.locator(`[data-form-panel] input[data-form-field="${target.id}"]`);
    const overlayField = win.locator(`.forms-layer input[data-form-field="${target.id}"]`);
    await panelField.fill('QA Value 115');
    await expect.poll(() => overlayField.inputValue()).toBe('QA Value 115');
    await overlayField.fill('QA Value 115B');
    await expect.poll(() => panelField.inputValue()).toBe('QA Value 115B');

    // 4. properties: real metadata, read-only note, and NO editable control.
    await panelField.click();
    await expect(win.locator('[data-form-properties]')).toBeVisible();
    await expect(win.locator('[data-form-properties] [data-form-property="name"]')).toBeVisible();
    await expect(win.locator('[data-form-properties] [data-form-property="type"]')).toBeVisible();
    await expect(win.locator('[data-form-properties] [data-form-property="required"]')).toBeVisible();
    await expect(win.locator('[data-form-properties] [data-form-property="read-only"]')).toBeVisible();
    await expect(win.locator('[data-form-edit-unsupported]')).toBeVisible();
    const editable = await win.locator(
      '[data-form-properties] input, [data-form-properties] select, [data-form-properties] textarea, [data-form-properties] button',
    ).count();
    expect(editable).toBe(0);

    // 5. Close/Escape: with focus inside the panel, Escape dismisses it.
    await panelField.focus();
    await win.keyboard.press('Escape');
    await expect(win.locator('[data-form-panel]')).toHaveCount(0, { timeout: 10000 });
  });

  test('validate reveals the error and moves focus only after the action', async () => {
    test.setTimeout(120000);
    app = await launchApp();
    win = await app.firstWindow();
    await openDoc(win, app, REQUIRED_FIXTURE);

    const required = await win.evaluate(() => {
      const d = window.tflexDiagnostics();
      return (d.formFields || []).find((f) => f.required === true) || null;
    });
    expect(required).toBeTruthy();
    const row = win.locator(`[data-form-panel] input[data-form-field="${required.id}"]`);
    const errorRow = win.locator(`[data-form-panel] .guided-fill-row[data-form-field="${required.id}"]`);

    await clickDockVerb(win, 3, 'forms');
    await expect(win.locator('[data-form-panel="true"]')).toBeVisible({ timeout: 10000 });
    await row.fill('');
    await expect(errorRow.locator('[data-form-error]')).toHaveCount(0);

    await win.locator('[data-form-validate="true"]').click();
    const error = errorRow.locator('[data-form-error]');
    await expect(error).toBeVisible({ timeout: 10000 });
    const focusedId = await win.evaluate(() => {
      const el = document.activeElement;
      const holder = el && el.closest ? el.closest('[data-form-field]') : null;
      return holder ? holder.getAttribute('data-form-field') : null;
    });
    expect(focusedId).toBe(required.id);
    await win.screenshot({ path: path.join(SHOTS, 'p115-guided-fill-validation-error.png') });
  });

  test('captures the panel in both themes, forced colors, 200% scaling and compact width', async () => {
    test.setTimeout(180000);
    app = await launchApp();
    win = await app.firstWindow();
    await openDoc(win, app, getSamplePath('form.pdf'));
    await clickDockVerb(win, 3, 'forms');
    await expect(win.locator('[data-form-panel="true"]')).toBeVisible({ timeout: 10000 });

    await ensureTheme(win, 'light');
    await win.screenshot({ path: path.join(SHOTS, 'p115-guided-fill-full-light.png') });
    await ensureTheme(win, 'dark');
    await win.screenshot({ path: path.join(SHOTS, 'p115-guided-fill-full-dark.png') });

    await win.emulateMedia({ forcedColors: 'active' });
    await win.waitForTimeout(300);
    await win.screenshot({ path: path.join(SHOTS, 'p115-guided-fill-forced-colors.png') });
    await win.emulateMedia({ forcedColors: 'none' });

    // 200% scaling: use a supported window whose effective CSS width at 2x lands
    // inside the documented responsive range, so the panel spans the editor width
    // and stays fully readable (styles.css @media (max-width: 900px)).
    await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w.isMaximized()) { w.unmaximize(); await new Promise((r) => setTimeout(r, 600)); }
      w.setMinimumSize(120, 120);
      w.setSize(1600, 1000);
      await new Promise((r) => setTimeout(r, 600));
      w.webContents.setZoomFactor(2);
      await new Promise((r) => setTimeout(r, 800));
      w.webContents.invalidate();
    });
    await win.waitForTimeout(800);
    await expect(win.locator('[data-form-panel="true"]')).toBeVisible();
    await win.screenshot({ path: path.join(SHOTS, 'p115-guided-fill-zoom200.png') });
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
    await win.waitForTimeout(400);

    await app.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w.isMaximized()) { w.unmaximize(); await new Promise((r) => setTimeout(r, 600)); }
      w.setMinimumSize(120, 120);
      w.setSize(560, 760);
      await new Promise((r) => setTimeout(r, 800));
    });
    await win.waitForTimeout(600);
    await win.screenshot({ path: path.join(SHOTS, 'p115-guided-fill-compact.png') });
  });
});
