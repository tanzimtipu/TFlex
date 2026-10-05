// Phase 104 (TFL-847) — DEF-545 regression pin.
//
// Opening the anchored More popover must place roving focus on its first
// ENABLED row so Arrow/Home/End navigate the menu (Phase 104 CONTROL-INDEX g).
// In the EDIT stage the first two displaced verbs (`batchOcr`, `ocrSuspects`)
// are both DISABLED, so the menu's open effect focuses a disabled button —
// `.focus()` is a no-op — and focus stays on the dock's More button OUTSIDE the
// menu: the keyboard rows are unreachable.
//
// This test asserts the CORRECT behaviour. DEF-567 (renumbered from DEF-545)
// was fixed by frontend-dev (TFL-848); the `test.fail()` marker was removed on
// retest so the spec now asserts the FIXED behaviour.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, gotoStage } = require('./lib/helpers.cjs');

test.setTimeout(120000);

test('DEF-545 More popover places roving focus on the first enabled row (EDIT)', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
    await win.waitForSelector('[data-action-dock]', { timeout: 30000 });
    await win.waitForTimeout(800);

    await gotoStage(win, 2); // EDIT — batchOcr + ocrSuspects are both disabled.
    await win.waitForTimeout(400);
    await win.locator('[data-dock-overflow]').first().click();
    await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 8000 });
    await win.waitForTimeout(250);

    const state = await win.evaluate(() => {
      const ae = document.activeElement;
      return {
        inMenu: !!(ae && ae.closest && ae.closest('[data-dock-overflow-menu]')),
        activeId: ae?.getAttribute?.('data-dock-overflow-item') ?? ae?.getAttribute?.('data-dock-menu-item') ?? null,
      };
    });
    expect(state.inMenu, 'focus lands inside the More menu on open').toBe(true);
    expect(state.activeId, 'and on an enabled row (Customize dock)').toBe('customize');

    await win.keyboard.press('ArrowDown');
    const moved = await win.evaluate(() => !!document.activeElement?.closest?.('[data-dock-overflow-menu]'));
    expect(moved, 'ArrowDown keeps focus inside the menu').toBe(true);
  } finally {
    await hardClose(app, 'def545');
  }
});
