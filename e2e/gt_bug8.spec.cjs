const { test } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');

const INSTALLED = path.join(process.env.LOCALAPPDATA, 'Programs', 'TFlex', 'TFlex.exe');

async function waitDiag(w) {
  return await w.evaluate(() => (typeof tflexDiagnostics === 'function' ? tflexDiagnostics() : null));
}

test.describe('GT Insert-pages bugs (8, 9, 10)', () => {
  let electronApp, firstWindow;

  test.beforeAll(async () => {
    electronApp = await launchApp([], null, INSTALLED);
    firstWindow = await electronApp.firstWindow();
    await firstWindow.waitForSelector('.welcome', { timeout: 20000 });
    await firstWindow.waitForSelector('.sample-card .sample-name', { timeout: 20000 });
    await firstWindow.locator('.sample-card', { has: firstWindow.locator('.sample-name', { hasText: 'report.pdf' }) }).click();
    await firstWindow.waitForSelector('.workspace', { timeout: 30000 });
    await firstWindow.waitForTimeout(1500);
  });

  test.afterAll(async () => { if (electronApp) await electronApp.close(); });

  async function openInsertDialog() {
    const palette = await firstWindow.$('[data-tools-palette]');
    if (!palette) {
      await firstWindow.click('[data-tools-toggle]');
      await firstWindow.waitForSelector('[data-tools-palette]', { timeout: 10000 });
    }
    await firstWindow.click('[data-tool-id="insertPages"]');
    await firstWindow.waitForSelector('[data-insert-pages-dialog]', { timeout: 10000 });
  }
  async function closeInsertDialog() {
    // close the dialog
    await firstWindow.click('.modal-close').catch(() => {});
    await firstWindow.waitForTimeout(400);
    // close the palette if open, to keep state clean
    const palette = await firstWindow.$('[data-tools-palette]');
    if (palette) {
      await firstWindow.click('[data-tools-toggle]');
      await firstWindow.waitForTimeout(300);
    }
  }

  test('BUG8: insert blank at position 1 -> Insert button disabled', async () => {
    await openInsertDialog();
    // Ensure blank mode
    await firstWindow.click('[data-insert-mode="blank"]');
    await firstWindow.waitForTimeout(200);
    // Set position to 1
    await firstWindow.fill('[data-insert-position]', '1');
    await firstWindow.waitForTimeout(200);
    const r8 = await firstWindow.evaluate(() => {
      const confirm = document.querySelector('[data-insert-confirm]');
      const hint = document.querySelector('.modal-hint')?.textContent;
      return {
        confirmDisabled: confirm?.disabled,
        positionValue: document.querySelector('[data-insert-position]')?.value,
        hint,
      };
    });
    console.log('BUG8 insert position=1:', JSON.stringify(r8, null, 2));
    await firstWindow.screenshot({ path: 'screenshots/gt_b8_pos1_disabled.png' });
    // check position 2 for comparison
    await firstWindow.fill('[data-insert-position]', '2');
    await firstWindow.waitForTimeout(200);
    const r8b = await firstWindow.evaluate(() => ({
      confirmDisabled: document.querySelector('[data-insert-confirm]')?.disabled,
    }));
    console.log('BUG8 position=2:', JSON.stringify(r8b));
    // reset to 1 for bug 10? no. Leave and continue.
    await closeInsertDialog();
  });

  test('BUG10: insert blank after page 1 -> duplicate thumbnail / Page 17', async () => {
    const diagBefore = await waitDiag(firstWindow);
    console.log('pageCount before:', diagBefore?.engineState?.pageCount);
    await openInsertDialog();
    await firstWindow.click('[data-insert-mode="blank"]');
    await firstWindow.waitForTimeout(200);
    // insert after page 1 -> position "2" per the hint
    await firstWindow.fill('[data-insert-position]', '2');
    await firstWindow.waitForTimeout(200);
    await firstWindow.click('[data-insert-confirm]');
    await firstWindow.waitForTimeout(2500);
    const diagAfter = await waitDiag(firstWindow);
    console.log('pageCount after:', diagAfter?.engineState?.pageCount, 'modified:', diagAfter?.engineState?.modified);
    // Dump thumbnail rail (first 8 thumbs)
    const thumbs = await firstWindow.evaluate(() => {
      const els = [...document.querySelectorAll('.side-rail [data-page], .thumb-item, [data-source-page]')];
      return els.slice(0, 10).map(e => ({
        cls: e.className,
        dataPage: e.getAttribute('data-page'),
        sourcePage: e.getAttribute('data-source-page'),
        label: (e.querySelector('.thumb-label, .page-label, [class*=label]')?.textContent || e.textContent || '').trim().slice(0, 20),
        hasImg: !!e.querySelector('img, canvas'),
        imgSrc: e.querySelector('img')?.getAttribute('src') ? e.querySelector('img').getAttribute('src').slice(0, 40) : (e.querySelector('canvas') ? 'canvas' : null),
      }));
    });
    console.log('BUG10 first thumbs:', JSON.stringify(thumbs, null, 2));
    await firstWindow.screenshot({ path: 'screenshots/gt_b10_after_insert.png' });
    await closeInsertDialog();
  });

  test('BUG9: undo insert, then insert again -> NaN degreeAngle error', async () => {
    // Undo the insert
    const undo = firstWindow.locator('[aria-label="Undo last change"]');
    await undo.click();
    await firstWindow.waitForTimeout(1200);
    const diagUndo = await waitDiag(firstWindow);
    console.log('pageCount after undo:', diagUndo?.engineState?.pageCount);
    // Insert again
    await openInsertDialog();
    await firstWindow.click('[data-insert-mode="blank"]');
    await firstWindow.waitForTimeout(200);
    await firstWindow.fill('[data-insert-position]', '2');
    await firstWindow.waitForTimeout(200);
    await firstWindow.click('[data-insert-confirm]');
    await firstWindow.waitForTimeout(2500);
    const result = await firstWindow.evaluate(() => ({
      toasts: [...document.querySelectorAll('.toast, .toast-error')].map(t => ({ cls: t.className, text: t.textContent })),
      diag: (typeof tflexDiagnostics === 'function' ? true : false),
    }));
    console.log('BUG9 after re-insert toasts:', JSON.stringify(result, null, 2));
    await firstWindow.screenshot({ path: 'screenshots/gt_b9_reinsert.png' });
    await closeInsertDialog();
  });
});
