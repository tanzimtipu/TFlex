// Phase 18 part 3 — Watermark: text baseline (KEEPME -> wm-1), image
// watermark via filechooser (-> wm-2), and delete-by-id (engine really
// drops wm-1). Compact validation spec: 3 tests, one serial describe,
// a single launchApp in beforeAll (canonical e2e/lib/launch.cjs).
//
// Selector note: the preview <img> now carries
// `[data-watermark-preview-image]` (the class is kept for styling). T2
// asserts that data attribute directly and additionally proves the <img>
// carries a loaded blob:/data: src.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { openSample, shot, hardClose, runTool } = require('./lib/helpers.cjs');

const IMG_PNG = path.resolve(__dirname, '..', 'test-fixtures', 'phase18-wm-image.png');

test.describe('Phase 18 watermark — part 3 (baseline, image, delete-by-id)', () => {
  test.describe.configure({ mode: 'serial' });

  let electronApp = null;
  let window = null;

  test.beforeAll(async () => {
    electronApp = await launchApp([], null, null);
    window = await electronApp.firstWindow();
    await window.waitForSelector('.sample-card', { timeout: 30000 });
  });

  test.afterAll(async () => {
    await hardClose(electronApp, 'phase18-wm-p3');
  });

  // React-native drive for number inputs (pattern from part 1/2).
  async function setControl(selector, value) {
    await window.evaluate(([sel, v]) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`control missing: ${sel}`);
      const desc =
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value') ||
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      desc.set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, [selector, String(value)]);
  }

  // Bring the watermark dialog to the front: early-return if it is still
  // open from the previous step, otherwise route through its current home
  // (the REVIEW stage Action Dock's watermark verb).
  async function openDialog() {
    if (await window.locator('[data-watermark-dialog]').isVisible().catch(() => false)) return;
    await runTool(window, 'watermark');
    await expect(window.locator('[data-watermark-dialog]')).toBeVisible();
  }

  async function engineIds() {
    const rows = await window.evaluate(async () => {
      const id = window.tflexDiagnostics().engineDocId;
      const res = await window.tflex.engine.getWatermarks(id);
      return res.ok ? res.value : null;
    });
    expect(rows, 'getWatermarks returned ok value').not.toBeNull();
    return rows.map((w) => w.id);
  }

  async function applyAndSettle(expectedToast) {
    await window.locator('[data-watermark-confirm]').click();
    await expect(window.locator('.toast-stack .toast .toast-text').last(), 'success toast')
      .toHaveText(expectedToast, { timeout: 90000 });
    await window.waitForTimeout(1200); // settle the pdf.js proxy re-render
  }

  test('T1: text baseline "KEEPME" -> wm-1', async () => {
    test.setTimeout(180000);
    await openSample(window, electronApp, 'report.pdf');
    await window.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await window.waitForTimeout(1000);

    await openDialog();
    await window.locator('[data-watermark-text]').fill('KEEPME');
    await applyAndSettle('Watermark applied.');
    await openDialog(); // apply auto-closes the dialog; reopen for the applied rows

    const row = window.locator('[data-watermark-applied="wm-1"]');
    await expect(row, 'applied-watermarks row wm-1').toBeVisible();
    expect((await row.textContent()) || '').toContain('KEEPME');
    expect(await engineIds()).toEqual(['wm-1']);
  });

  test('T2: image watermark via filechooser -> wm-2', async () => {
    test.setTimeout(180000);
    await openDialog();
    await window.locator('[data-watermark-type="image"]').click();

    const fcPromise = window.waitForEvent('filechooser');
    await window.locator('[data-watermark-image-pick]').click();
    const fc = await fcPromise;
    await fc.setFiles(IMG_PNG);

    await expect(window.locator('[data-watermark-image-name]'), 'picked image name')
      .toContainText('phase18-wm-image.png');
    const previewImg = window.locator('[data-watermark-preview-image]');
    console.log('PHASE18_IMAGE_PREVIEW=data-watermark-preview-image');
    await expect(previewImg, 'image preview visible').toBeVisible();
    // The preview <img> must carry the LOADED image (blob:/data: src),
    // not an empty or broken placeholder.
    const imgSrc = await window.evaluate(() => {
      const img = document.querySelector('[data-watermark-preview-image]');
      return img ? (img.currentSrc || img.src) : null;
    });
    expect(imgSrc, 'preview img has a loaded image src').toMatch(/^(blob:|data:)/);

    await setControl('[data-watermark-size]', 200);
    await window.locator('[data-watermark-position="center"]').click();
    await applyAndSettle('Watermark applied.');
    await openDialog(); // apply auto-closes the dialog; reopen for the applied rows

    const row = window.locator('[data-watermark-applied="wm-2"]');
    await expect(row, 'applied-watermarks row wm-2').toBeVisible();
    expect((await row.textContent()) || '').toContain('Image');
    expect(await engineIds()).toEqual(['wm-1', 'wm-2']);
    await shot(window, 'phase18-image.png');
  });

  test('T3: delete wm-1 by id — row and engine both drop it', async () => {
    test.setTimeout(120000);
    await openDialog();
    await window.locator('[data-watermark-delete="wm-1"]').click();
    await expect(window.locator('.toast-stack .toast .toast-text').last(), 'delete toast')
      .toHaveText('Watermark deleted.', { timeout: 90000 });
    await window.waitForTimeout(1200);
    await openDialog(); // if delete closed the dialog, reopen so rows are asserted in-dialog

    // (a) the applied row for the deleted id is gone
    await expect(window.locator('[data-watermark-applied="wm-1"]'), 'wm-1 row removed')
      .toHaveCount(0);
    // (b) the surviving watermark keeps its row
    await expect(window.locator('[data-watermark-applied="wm-2"]'), 'wm-2 row kept')
      .toBeVisible();
    // (c) the engine really dropped wm-1, not just the row
    expect(await engineIds()).toEqual(['wm-2']);
    // (d) no delete button remains for the deleted id — a second delete is impossible
    await expect(window.locator('[data-watermark-delete="wm-1"]'), 'wm-1 delete button removed')
      .toHaveCount(0);
    await shot(window, 'phase18-deleted.png');
  });
});