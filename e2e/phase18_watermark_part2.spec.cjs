// Phase 18 part 2 — Watermark: custom coords, tile mode, page range +
// inverted-range guard. Compact validation spec: 3 tests, one serial
// describe, a single launchApp in beforeAll (canonical e2e/lib/launch.cjs).
//
// State is cumulative by design: T1 opens report.pdf and applies wm-1
// (x=100, y=100), T2 applies wm-2 (tile mode), T3 applies wm-3 (pages 2-3)
// then proves an inverted range (from > to) is rejected in-place with an
// inline alert, no new toast, and an unchanged engine watermark list.

const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { openSample, shot, hardClose, runTool } = require('./lib/helpers.cjs');

test.describe('Phase 18 watermark — part 2 (coords, tile, range guard)', () => {
  test.describe.configure({ mode: 'serial' });

  let electronApp = null;
  let window = null;

  test.beforeAll(async () => {
    electronApp = await launchApp([], null, null);
    window = await electronApp.firstWindow();
    await window.waitForSelector('.sample-card', { timeout: 30000 });
  });

  test.afterAll(async () => {
    await hardClose(electronApp, 'phase18-wm-p2');
  });

  // React-native drive for number/range inputs (pattern from part 1).
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
  // open from the previous test, otherwise route through its current home
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

  // Confirm click -> exact success toast -> settle the pdf.js proxy swap
  // (so a canvas screenshot afterwards is of the re-rendered page) -> ids.
  async function applyAndGetIds() {
    await window.locator('[data-watermark-confirm]').click();
    await expect(window.locator('.toast-stack .toast .toast-text').last(), 'success toast')
      .toHaveText('Watermark applied.', { timeout: 90000 });
    await window.waitForTimeout(1200);
    return engineIds();
  }

  test('T1: custom coords (x=100, y=100) apply -> wm-1', async () => {
    test.setTimeout(180000);
    await openSample(window, electronApp, 'report.pdf');
    await window.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await window.waitForTimeout(1000);

    await openDialog();
    await window.locator('[data-watermark-text]').fill('DRAFT');
    await setControl('[data-watermark-x]', 100);
    await setControl('[data-watermark-y]', 100);
    await applyAndGetIds();
    await openDialog(); // apply auto-closes the dialog; reopen for the applied rows

    const row = window.locator('[data-watermark-applied="wm-1"]');
    await expect(row, 'applied-watermarks row wm-1').toBeVisible();
    expect((await row.textContent()) || '').toContain('DRAFT');
    expect(await engineIds()).toEqual(['wm-1']);
    await shot(window, 'phase18-coords.png');
  });

  test('T2: tile mode — preview swaps to tile, apply -> wm-2', async () => {
    test.setTimeout(120000);
    await openDialog();
    await window.locator('[data-watermark-text]').fill('TILED');
    await window.locator('[data-watermark-tile]').check();
    await expect(window.locator('[data-watermark-preview="tile"]'), 'tile preview visible')
      .toBeVisible();
    await expect(window.locator('[data-watermark-preview="single"]'), 'single preview gone')
      .toHaveCount(0);

    await applyAndGetIds();
    await openDialog(); // apply auto-closes the dialog; reopen for the applied rows

    const row = window.locator('[data-watermark-applied="wm-2"]');
    await expect(row, 'applied-watermarks row wm-2').toBeVisible();
    expect((await row.textContent()) || '').toContain('TILED');
    expect(await engineIds()).toEqual(['wm-1', 'wm-2']);
    await shot(window, 'phase18-tile.png');
  });

  test('T3: range apply -> wm-3; inverted range rejected in-place', async () => {
    test.setTimeout(180000);
    await openDialog();
    await window.locator('[data-watermark-text]').fill('PAGES');
    await window.locator('[data-watermark-range-all]').uncheck();
    await expect(window.locator('[data-watermark-range-from]')).toBeEnabled();
    await setControl('[data-watermark-range-from]', 2);
    await setControl('[data-watermark-range-to]', 3);
    await applyAndGetIds();
    await openDialog(); // apply auto-closes the dialog; reopen for the applied rows

    const row = window.locator('[data-watermark-applied="wm-3"]');
    await expect(row, 'applied-watermarks row wm-3').toBeVisible();
    expect((await row.textContent()) || '').toContain('Pages 2, 3');
    expect(await engineIds()).toEqual(['wm-1', 'wm-2', 'wm-3']);

    // Inverted range (from > to): confirm must be a no-op with an inline
    // alert — dialog stays open, no new toast, engine list unchanged.
    await window.locator('[data-watermark-range-all]').uncheck(); // no-op if already off
    await expect(window.locator('[data-watermark-range-from]')).toBeEnabled();
    await setControl('[data-watermark-range-from]', 3);
    await setControl('[data-watermark-range-to]', 2);
    await expect(window.locator('[data-watermark-range-from]')).toHaveValue('3');
    await expect(window.locator('[data-watermark-range-to]')).toHaveValue('2');
    const toastTexts = () => window.locator('.toast-stack .toast .toast-text').allTextContents();
    const before = await toastTexts();
    await window.locator('[data-watermark-confirm]').click();

    const alert = window.locator('[data-watermark-dialog] [role="alert"]');
    await expect(alert, 'inline page-range alert').toBeVisible();
    await expect(alert).toHaveText(/page range/i);
    await expect(window.locator('[data-watermark-dialog]'), 'dialog still open').toBeVisible();

    // No toast may have been added: per-text counts may only shrink (old
    // toasts can expire) but never grow, which also catches a duplicate
    // "Watermark applied." toast.
    const after = await toastTexts();
    const count = (list, t) => list.filter((x) => x === t).length;
    for (const t of new Set(after)) {
      expect(count(after, t), `no new toast: "${t}"`).toBeLessThanOrEqual(count(before, t));
    }
    expect(await engineIds()).toEqual(['wm-1', 'wm-2', 'wm-3']);
    await shot(window, 'phase18-range.png');
  });
});