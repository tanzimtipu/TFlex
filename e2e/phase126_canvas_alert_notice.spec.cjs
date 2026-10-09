// Phase 126 (chunk C) - the in-canvas warning/error notice (CONTROL-INDEX sweep).
//
// Phase 126 restores the collapse-to-"i" rule for canvas warning/error notices
// and retires the floating warning/error toast popups. This spec drives a REAL
// warning through the DEF-417 empty-tab tear-out (the exact trigger
// e2e/phase58_def414_417.spec.cjs uses) and proves the CONTROL-INDEX rows:
//   1 collapsed "i" toggle expands the box
//   2 collapse control folds it back to the "i"
//   3 auto-collapse after NOTICE_AUTO_COLLAPSE_MS (10000) into the "i"
//   4 a user expand resets the dwell
//   5 the box is mounted INSIDE the canvas (.canvas-notices in .canvas-top-right)
//   6 the same controls exist on Home (no document open)
//   7 no .toast-warning / .toast-error node exists
// Blast radius: the Book View control (the canvas neighbour) still opens/closes.
//
// Rows 1-4 + 6 run on the HOME host (no canvas); row 8 then exercises Book View
// on the canvas; rows 5-6 finish on the active document canvas. Screenshots:
// phase126-expanded.png (a), phase126-collapsed-i.png (b), phase126-home-alert.png (c).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, openSamplePath } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const NOTICE_AUTO_COLLAPSE_MS = 10000;
const WARNING = 'This tab has no document to move.';

test.setTimeout(300000);

// The DEF-417 tear-out gesture: press the last tab's title, drag straight down
// below the strip, release. Mirrors phase58_def414_417.spec.cjs.
async function tearOutEmptyTab(page) {
  const titles = page.locator('[data-tab-id] .tab-title');
  const total = await titles.count();
  const titleBox = await titles.nth(total - 1).boundingBox();
  const strip = await page.locator('.tab-list').boundingBox();
  const sx = titleBox.x + titleBox.width / 2;
  const sy = titleBox.y + titleBox.height / 2;
  const ty = strip.y + strip.height + 60;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx, sy + 10, { steps: 4 });
  await page.mouse.move(sx, ty, { steps: 12 });
  await page.mouse.up();
}

// The state lives on the box (expanded / closing) or on the collapsed region
// (collapsed / entering); read whichever is mounted.
async function alertState(page, tone = 'warning') {
  return page.evaluate((t) => {
    const box = document.querySelector(`[data-canvas-alert-notice][data-canvas-alert-tone="${t}"]`);
    if (box) return box.getAttribute('data-canvas-alert-state');
    const region = document.querySelector('[data-canvas-alert-notice-state]');
    if (region) return region.getAttribute('data-canvas-alert-notice-state');
    return null;
  }, tone);
}

async function waitState(page, want, tone = 'warning', timeout = 15000) {
  await expect.poll(() => alertState(page, tone), { timeout }).toBe(want);
}

// The enter animation starts at opacity 0; wait for the box to become opaque.
async function waitSettled(page, tone = 'warning') {
  await expect.poll(
    () =>
      page.evaluate((t) => {
        const el = document.querySelector(`[data-canvas-alert-notice][data-canvas-alert-tone="${t}"]`);
        return el !== null && Number(getComputedStyle(el).opacity) > 0;
      }, tone),
    { timeout: 5000 },
  ).toBe(true);
}

test('Phase 126: a real warning collapses to an "i"; renders inside the canvas, never a toast', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await win.waitForSelector('.workspace', { timeout: 30000 });
    await win.waitForSelector('[data-tab-id]', { timeout: 30000 });

    // Create the REAL warning: add an empty tab, then tear it out. `detachTab`
    // refuses loudly with the DEF-417 warning.
    const docTabId = await win.evaluate(() => window.tflexDiagnostics().activeTabId);
    await win.locator('[data-new-tab]').click();
    await win.waitForTimeout(800);
    await tearOutEmptyTab(win);

    // Row 6 / Home host: with the empty tab active there is no canvas, so the
    // alert renders beside the welcome hero and is reachable.
    const homeBox = win.locator('[data-canvas-alert-notice][data-canvas-alert-tone="warning"]');
    await homeBox.waitFor({ state: 'visible', timeout: 10000 });
    await waitSettled(win);
    await expect(homeBox.locator('[data-canvas-alert-message]').first()).toHaveText(WARNING);
    expect(await win.locator('.canvas-notices').count(), 'Home alert is not in the canvas layer').toBe(0);
    // Screenshot (c): the Home host, and (a) the expanded box.
    await win.screenshot({ path: path.join(SHOTS, 'phase126-home-alert.png') });
    await win.screenshot({ path: path.join(SHOTS, 'phase126-expanded.png') });

    // Row 2: the collapse control folds the box back into the "i".
    await win.locator('[data-canvas-alert-collapse]').click();
    await waitState(win, 'collapsed', 'warning', 10000);
    const iconBtn = win.locator('[data-canvas-alert-icon]');
    await expect(iconBtn).toBeVisible();
    await expect(iconBtn).toHaveAttribute('aria-label', 'Show notice');
    // Screenshot (b): the collapsed "i".
    await win.screenshot({ path: path.join(SHOTS, 'phase126-collapsed-i.png') });

    // Row 1: the collapsed "i" expands the box again.
    await iconBtn.click();
    await waitState(win, 'expanded');

    // Row 4 (dwell reset): after this expand, wait 6 s -> still expanded; then
    // collapse + re-expand (reset). At ~14 s the un-reset 10 s dwell would have
    // fired, so "still expanded" proves the user expand restarted the timer.
    await win.waitForTimeout(6000);
    expect(await alertState(win), 'still expanded 6 s after the expand').toBe('expanded');
    await win.locator('[data-canvas-alert-collapse]').click();
    await waitState(win, 'collapsed', 'warning', 10000);
    await iconBtn.click();
    await waitState(win, 'expanded');
    await win.waitForTimeout(8000);
    expect(await alertState(win), 'dwell was reset by the user expand').toBe('expanded');

    // Row 3 (auto-collapse): the reset dwell fires ~10 s after the last expand.
    await waitState(win, 'collapsed', 'warning', NOTICE_AUTO_COLLAPSE_MS + 4000);
    await expect(win.locator('[data-canvas-alert-icon]')).toBeVisible();

    // Row 7: the retired toast classes must not exist anywhere.
    expect(await win.locator('.toast-warning').count(), 'no .toast-warning').toBe(0);
    expect(await win.locator('.toast-error').count(), 'no .toast-error').toBe(0);

    // Row 8 (blast radius): on the document canvas the Book View neighbour
    // still opens and closes.
    await win.locator(`[data-tab-id='${docTabId}']`).click();
    await expect(win.locator(`[data-tab-id='${docTabId}']`)).toHaveAttribute('aria-selected', 'true');
    await win.locator('[aria-label="Book View"]').first().click();
    await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 15000 });
    await win.locator('[aria-label="Close book view"]').first().click();
    await expect(win.locator('[data-book-view]')).toHaveCount(0);

    // Rows 5-6 (canvas placement): the SAME still-live warning must render
    // INSIDE the active canvas - .canvas-notices inside .canvas-top-right.
    const canvasAlert =
      '.canvas-top-right .canvas-notices [data-canvas-alert-notice][data-canvas-alert-tone="warning"]';
    await win.waitForSelector(canvasAlert, { state: 'visible', timeout: 15000 });
    await expect(win.locator(canvasAlert)).toHaveCount(1);
    // Fresh evidence (TFL-1504): the expanded warning box, INSIDE the active
    // canvas while the document tab is active.
    await win.screenshot({ path: path.join(SHOTS, 'phase126-canvas-expanded.png') });
  } finally {
    await hardClose(app, 'phase126');
  }
});
