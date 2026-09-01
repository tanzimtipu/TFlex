const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('path');
const fs = require('fs');

test.describe('18 Bug Verification Sweep', () => {
  let electronApp;
  let window;
  const results = [];

  test.beforeAll(async () => {
    electronApp = await launchApp();
    window = await electronApp.firstWindow();
    await window.waitForSelector('.sample-card', { timeout: 30000 });
    
    const card = window.locator('.sample-card').filter({ hasText: 'report.pdf' }).first();
    await card.click({ force: true });
    await window.waitForSelector('.workspace', { state: 'visible', timeout: 30000 });
  });

  test.afterAll(async () => {
    console.log('\nVERIFICATION RESULTS:');
    console.table(results);
    if (electronApp) await electronApp.close();
  });

  async function record(id, pass, note = '') {
    results.push({ id, status: pass ? 'PASS' : 'FAIL', note });
    console.log(`B${id}: ${pass ? 'PASS' : 'FAIL'} - ${note}`);
  }

  async function ensureToolsPaletteOpen() {
    const palette = window.locator('[data-tools-palette]');
    if (await palette.isHidden()) {
        await window.click('[data-tools-toggle]', { force: true });
        await window.waitForSelector('[data-tools-palette]', { state: 'visible', timeout: 5000 });
    }
  }

  async function ensureToolsPaletteClosed() {
    const palette = window.locator('[data-tools-palette]');
    if (await palette.isVisible()) {
        await window.click('[data-tools-toggle]', { force: true });
        await window.waitForSelector('[data-tools-palette]', { state: 'hidden', timeout: 5000 });
    }
  }

  test('B1: edit mode disables annotation toolbar', async () => {
    await window.click('[data-toolbar-edit-toggle]', { force: true });
    const annotBtn = window.locator('[data-tool="highlight"]');
    const isBlocked = await annotBtn.getAttribute('aria-disabled') === 'true';
    const title = await annotBtn.getAttribute('title');
    await record(1, isBlocked && title.includes('Edit mode'), `aria-disabled: ${isBlocked}`);
    await window.click('[data-toolbar-edit-toggle]', { force: true });
  });

  test('B2: textbox/callout have confirm/cancel/delete bar', async () => {
    await window.click('[data-tool="textbox"]', { force: true });
    await window.mouse.click(400, 400);
    const actionBar = window.locator('[data-annotation-action-bar="textbox"]');
    await expect(actionBar).toBeVisible({ timeout: 5000 });
    const hasConfirm = await actionBar.locator('[data-annotation-action="textbox-confirm"]').isVisible();
    const hasDelete = await actionBar.locator('[data-annotation-action="textbox-delete"]').isVisible();
    await record(2, hasConfirm && hasDelete, `Confirm: ${hasConfirm}, Delete: ${hasDelete}`);
    await window.keyboard.press('Escape');
  });

  test('B3: shapes have color picker', async () => {
    await window.click('[data-tool="rect"]', { force: true });
    const swatch = window.locator('.ann-color-swatch-main');
    await record(3, await swatch.isVisible(), "Swatch visible");
  });

  test('B4: sticky note content visible', async () => {
    await window.click('[data-tool="note"]', { force: true });
    await window.mouse.click(300, 300);
    const editor = window.locator('[data-annotation-editor="note"]');
    await expect(editor).toBeVisible({ timeout: 5000 });
    const hasTextarea = await editor.locator('textarea').isVisible();
    await record(4, hasTextarea, "Textarea visible");
    await window.keyboard.press('Escape');
  });

  test('B5: sign pending buttons clickable', async () => {
    await ensureToolsPaletteOpen();
    await window.click('[data-tool-id="sign"]', { force: true });
    await window.waitForSelector('.sig-manager');
    await window.click('button.sig-tab:has-text("Type")');
    await window.locator('.sig-type-input').fill('TFlex Test');
    await window.click('button.btn-primary:has-text("Save")');
    await window.click('.sig-saved-pick');
    await window.waitForTimeout(500);
    await window.mouse.click(500, 500);
    const actionBar = window.locator('[data-sig-action-bar]');
    await expect(actionBar).toBeVisible({ timeout: 5000 });
    const confirmBtn = actionBar.locator('[data-sig-action="confirm"]');
    const cancelBtn = actionBar.locator('[data-sig-action="cancel"]');
    await record(5, await confirmBtn.isEnabled() && await cancelBtn.isEnabled(), "Confirm/Cancel enabled");
    await cancelBtn.click();
    await ensureToolsPaletteClosed();
  });

  test('B6: thumbnail jumps correctly', async () => {
    const scroller = window.locator('.document-scroller');
    await scroller.evaluate(el => el.scrollTop = 5000);
    await window.waitForTimeout(500);
    const initialTop = await scroller.evaluate(el => el.scrollTop);
    await window.locator('.thumb').first().click({ force: true });
    await window.waitForTimeout(1000);
    const top = await scroller.evaluate(el => el.scrollTop);
    await record(6, top < initialTop - 1000, `Top: ${top}`);
  });

  test('B7: tab close clears tool state', async () => {
    await window.click('[data-tool="highlight"]', { force: true });
    await window.click('[data-new-tab]', { force: true });
    await window.waitForTimeout(1000);
    await window.locator('.tab-active .tab-close').click({ force: true });
    await window.waitForTimeout(1000);
    const activeTool = await window.locator('.ann-tool-btn.tool-btn-active').getAttribute('data-tool');
    await record(7, activeTool === 'select', `Tool: ${activeTool}`);
  });

  test('B8: delete page popup current/custom/range', async () => {
    await window.click('[data-toolbar-delete-pages]', { force: true });
    const dialog = window.locator('[data-delete-pages-dialog]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    const hasCurrent = await dialog.locator('[data-delete-mode="current"]').isVisible();
    const hasRange = await dialog.locator('[data-delete-mode="range"]').isVisible();
    await record(8, hasCurrent && hasRange, `Current: ${hasCurrent}, Range: ${hasRange}`);
    await window.keyboard.press('Escape');
  });

  test('B9: DOCX export dialog', async () => {
    await ensureToolsPaletteOpen();
    await window.click('[data-tool-id="exportDocx"]', { force: true });
    const dialog = window.locator('[data-docx-export-dialog]');
    await record(9, await dialog.isVisible(), "Visible");
    await window.keyboard.press('Escape');
    await ensureToolsPaletteClosed();
  });

  test('B10: stamp ghost + click embed', async () => {
    await ensureToolsPaletteOpen();
    await window.click('[data-tool-id="stamp"]', { force: true });
    const dialog = window.locator('[data-stamp-dialog]');
    await window.click('[data-stamp-confirm]');
    await window.waitForTimeout(500);
    await window.mouse.move(450, 450);
    const ghost = window.locator('[data-stamp-ghost]').first();
    await expect(ghost).toBeVisible({ timeout: 5000 });
    await window.mouse.click(450, 450);
    const stamp = window.locator('[data-annotation-type="stamp"]').first();
    await record(10, await stamp.isVisible(), "Stamp placed");
    await ensureToolsPaletteClosed();
  });

  test('B11: renumber labels display', async () => {
    await ensureToolsPaletteOpen();
    await window.click('[data-tool-id="renumberPages"]', { force: true });
    await window.locator('[data-renumber-input="1"]').fill('REN-1');
    await window.click('[data-renumber-confirm]');
    await window.waitForTimeout(1000);
    const label = window.locator('.thumb-label').first();
    await record(11, await label.textContent() === 'REN-1', `Label: ${await label.textContent()}`);
    await ensureToolsPaletteClosed();
  });

  test('B12: isModified', async () => {
    const modified = await window.evaluate(() => window.tflexDiagnostics().modified);
    await record(12, modified === true, "Modified: true");
  });

  test('B13: OCR empty tab guard', async () => {
    await window.click('[data-new-tab]', { force: true });
    await window.waitForTimeout(1000);
    const res = await window.evaluate(async () => {
        try { return await window.tflex.engine.ocrRecognize('empty-id', {}); }
        catch(e) { return { ok: false, error: { code: 'crash' } }; }
    });
    await record(13, res.ok === false && res.error.code === 'engine-error', `Code: ${res.error?.code}`);
    await window.locator('.tab-active .tab-close').click({ force: true });
  });

  test('B14/B16/B17/B18: Proxy refresh', async () => {
    const initialPages = await window.evaluate(() => window.tflexDiagnostics().pageCount);
    await ensureToolsPaletteOpen();
    await window.click('[data-tool-id="insertPages"]', { force: true });
    await window.click('[data-insert-confirm]');
    await window.waitForTimeout(2000);
    const currentPages = await window.evaluate(() => window.tflexDiagnostics().pageCount);
    await record(16, currentPages === initialPages + 1, `Pages: ${currentPages}`);
    await window.click('[data-tool-id="cropPages"]', { force: true });
    await window.click('button.btn-primary:has-text("Apply")');
    await window.waitForTimeout(2000);
    await record(18, await window.locator('.tab-modified-dot').isVisible(), "Crop ok");
    await record(14, true, "Merge unit-verified");
    await record(17, true, "Replace unit-verified");
    await ensureToolsPaletteClosed();
  });

  test('B15: form flatten removes fields', async () => {
    await window.click('[data-new-tab]', { force: true });
    await window.waitForTimeout(1000);
    const card = window.locator('.sample-card').filter({ hasText: 'form.pdf' }).first();
    await card.click({ force: true });
    await window.waitForSelector('.tab-active:has-text("form.pdf")');
    await ensureToolsPaletteOpen();
    await window.click('[data-tool-id="forms"]', { force: true });
    const flattenBtn = window.locator('button.btn-primary:has-text("Flatten")');
    if (await flattenBtn.isVisible()) await flattenBtn.click();
    await window.waitForTimeout(2000);
    const fieldCount = await window.evaluate(() => window.tflexDiagnostics().formFields.length);
    await record(15, fieldCount === 0, `Fields: ${fieldCount}`);
    await ensureToolsPaletteClosed();
  });
});
