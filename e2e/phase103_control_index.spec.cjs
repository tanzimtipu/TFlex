// Phase 103 batch QA (TFL-837) — CONTROL-INDEX sweep. The phase change is
// presentation-only, so this clicks one representative control per surface and
// asserts the PROMISED action fires (no no-op, no swapped handler):
//   - a dock verb  -> its own dialog opens (Crop pages -> crop dialog)
//   - a header utility -> Preferences opens
//   - a dialog button -> the dialog's close control dismisses it
//   - a palette row -> its command runs (Preferences row opens the sheet)
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

test.setTimeout(120000);

async function openReport(win) {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('[data-action-dock]', { timeout: 30000 });
  await win.waitForTimeout(900);
}

test('Phase 103 CONTROL-INDEX: representative controls still fire their own action', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await openReport(win);

  // 1) Dock verb -> its own dialog.
  await win.click('[data-dock-verb="cropPages"]');
  await expect(win.locator('[data-crop-pages-dialog]')).toBeVisible({ timeout: 8000 });
  await win.keyboard.press('Escape');
  await expect(win.locator('[data-crop-pages-dialog]')).toHaveCount(0, { timeout: 8000 });

  // 2) Header utility -> Preferences.
  await win.click('[data-open-preferences]');
  await expect(win.locator('[data-prefs-dialog]')).toBeVisible({ timeout: 8000 });

  // 3) Dialog button -> the close control dismisses it.
  await win.click('[data-prefs-dialog] [aria-label="Close preferences"]');
  await expect(win.locator('[data-prefs-dialog]')).toHaveCount(0, { timeout: 8000 });

  // 4) Palette row -> its command runs (the Preferences row opens the sheet).
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
  await win.fill('[data-command-palette-input]', 'preferences');
  const row = win.locator('[data-palette-tool-id="preferences"]').first();
  await expect(row).toBeVisible({ timeout: 8000 });
  await row.click();
  await expect(win.locator('[data-prefs-dialog]')).toBeVisible({ timeout: 8000 });
  await expect(win.locator('[data-command-palette]')).toHaveCount(0, { timeout: 8000 });

  await hardClose(app, 'p103-sweep');
});
