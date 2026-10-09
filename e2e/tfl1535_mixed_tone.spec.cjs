// TFL-1535 (Phase 1529 chunk B) — mixed-tone verification for the consolidated
// `CanvasAlertNotice`.
//
// The shipped e2e spec (e2e/phase126_canvas_alert_notice.spec.cjs) drives only
// a single WARNING through the DEF-417 empty-tab tear-out, so it cannot prove
// the consolidation invariant when BOTH tones are pending at once. This spec
// adds exactly that: it raises a warning and an error together, then proves
//   - collapsed: exactly ONE [data-canvas-alert-icon] is visible, no box;
//   - expanded: exactly ONE [data-canvas-alert-notice] carrying both
//     [data-canvas-alert-group="warning"] and [data-canvas-alert-group="error"];
//   - no second icon appears while expanded.
// The warning is the real DEF-417 tear-out refusal; the error is a real
// broken-page-tree PDF (DEF-208: openPdfDocument rejects it as `corrupt`)
// driven through the normal Intake Open flow.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, openSamplePath } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const BROKEN = path.resolve(__dirname, '..', 'test-fixtures', 'broken-pagetree.pdf');
const WARNING = 'This tab has no document to move.';

test.setTimeout(300000);

// The DEF-417 tear-out gesture (mirrors phase126 / phase58): press the last
// tab's title, drag straight down below the strip, release.
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
async function alertState(page) {
  return page.evaluate(() => {
    const box = document.querySelector('[data-canvas-alert-notice]');
    if (box) return box.getAttribute('data-canvas-alert-state');
    const region = document.querySelector('[data-canvas-alert-notice-state]');
    if (region) return region.getAttribute('data-canvas-alert-notice-state');
    return null;
  });
}

test('Phase 1529 — mixed warning+error: ONE collapsed "i"; expand reveals both tone groups', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await win.waitForSelector('.workspace', { timeout: 30000 });
    await win.waitForSelector('[data-tab-id]', { timeout: 30000 });

    // (1) WARNING: add an empty tab, then tear it out. detachTab refuses
    // loudly with the DEF-417 warning, now an in-canvas alert (never a toast).
    await win.locator('[data-new-tab]').click();
    await win.waitForTimeout(800);
    await tearOutEmptyTab(win);
    await win.waitForSelector(
      '[data-canvas-alert-notice][data-canvas-alert-tone="warning"]',
      { timeout: 15000 },
    );
    await expect(
      win.locator('[data-canvas-alert-message]').filter({ hasText: WARNING }),
    ).toHaveCount(1);

    // (2) ERROR: a broken-page-tree PDF through the shared PDF open path. It
    // classifies as a `pdf` in Intake (ready), then fails to parse on Open.
    await app.evaluate(({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, BROKEN);
    const open = win.locator('[data-home-tool="open"]:visible');
    const openCtrl = (await open.count())
      ? open.first()
      : win.locator('[data-toolbar-open]:visible').first();
    await openCtrl.click();
    const row = win.locator('[data-intake-row]').last();
    await expect(row).toBeVisible({ timeout: 30000 });
    await expect(row.locator('[data-intake-state]')).toHaveAttribute(
      'data-intake-state',
      'ready',
      { timeout: 30000 },
    );
    await win.locator('[data-intake-open]:visible').first().click();

    // Both tones now live on the ONE notice; the error group joins the warning.
    await expect(win.locator('[data-canvas-alert-notice]')).toHaveCount(1, {
      timeout: 20000,
    });
    await expect(win.locator('[data-canvas-alert-group="error"]')).toHaveCount(1, {
      timeout: 20000,
    });
    await expect(win.locator('[data-canvas-alert-group="warning"]')).toHaveCount(1);

    // Collapse to the single "i" (it may already have auto-collapsed).
    const collapse = win.locator('[data-canvas-alert-collapse]');
    if (await collapse.count()) {
      await collapse.first().click();
    }
    await expect.poll(() => alertState(win), { timeout: 15000 }).toBe('collapsed');
    // Exactly ONE icon, no box.
    await expect(win.locator('[data-canvas-alert-icon]')).toHaveCount(1);
    await expect(win.locator('[data-canvas-alert-icon]')).toBeVisible();
    await expect(win.locator('[data-canvas-alert-notice]')).toHaveCount(0);
    await win.screenshot({ path: path.join(SHOTS, 'phase1529-collapsed-single-i.png') });

    // Expand: BOTH groups, still exactly ONE notice and NO second icon.
    await win.locator('[data-canvas-alert-icon]').click();
    await expect.poll(() => alertState(win), { timeout: 15000 }).toBe('expanded');
    await expect(win.locator('[data-canvas-alert-notice]')).toHaveCount(1);
    await expect(win.locator('[data-canvas-alert-icon]')).toHaveCount(0);
    await expect(win.locator('[data-canvas-alert-group="error"]')).toHaveCount(1);
    await expect(win.locator('[data-canvas-alert-group="warning"]')).toHaveCount(1);
    // No message loss or duplication: every tone's items are distinct strings.
    // (This scenario raises 1 error — the PDF open failure — plus 2 distinct
    // warnings: the DEF-417 tear-out refusal and the shelf's partial-success
    // import summary.)
    await expect(
      win.locator('[data-canvas-alert-group="error"] [data-canvas-alert-message]'),
    ).toHaveCount(1);
    await expect(
      win.locator('[data-canvas-alert-group="warning"] [data-canvas-alert-message]'),
    ).toHaveCount(2);
    const { texts, dupes } = await win.evaluate(() => {
      const items = [...document.querySelectorAll('[data-canvas-alert-message]')].map(
        (el) => el.textContent,
      );
      const seen = new Set();
      const dup = [];
      for (const t of items) {
        if (seen.has(t)) dup.push(t);
        seen.add(t);
      }
      return { texts: items, dupes: dup };
    });
    console.log('TFL1535_MIXED_MESSAGES=' + JSON.stringify(texts));
    expect(dupes, `duplicate alert messages: ${JSON.stringify(dupes)}`).toEqual([]);
    expect(texts.some((t) => t.includes(WARNING)), 'DEF-417 warning present').toBe(true);
    const noticeText = await win.locator('[data-canvas-alert-notice]').innerText();
    console.log('TFL1535_MIXED_NOTICE_TEXT=' + JSON.stringify(noticeText));
    await win.screenshot({ path: path.join(SHOTS, 'phase1529-expanded-mixed.png') });
  } finally {
    await hardClose(app, 'tfl1535-mixed');
  }
});
