// TFL-1550 — focused QA verification of the in-canvas ActivityAlertNotice.
//
// TFL-1531/1549 retire the floating Activity Shelf summary (the old
// `.activity-shelf-host` pill with its `[data-activity-shelf-open]` "Activity"
// button) and surface the operation summary as a notice in the SAME
// `.canvas-top-right` cluster as the warning/error notices. This spec drives a
// REAL long-running operation (OCR on a scanned sample) through the canonical
// launcher and proves the phase success criteria:
//   1 the notice renders INSIDE `.canvas-top-right .canvas-notices`;
//   2 it enters expanded (after the icon-first enter);
//   3 a 6 px status dot, a bold count and a dim status label;
//   4 a left border in the violet `--activity-progress` family, distinct from
//     `--warning` (amber) and `--error` (red);
//   5 collapse control -> icon; icon -> expanded;
//   6 auto-collapse ~10 s after the notice is expanded;
//   7 the retired Activity button / `.activity-shelf-host` are gone;
//   8 with no operations the notice is not mounted;
//   9 prefers-reduced-motion renders it expanded with no animation.
//
// Blast radius: the CanvasAlertNotice shares `useNoticeCollapse` and the same
// cluster; e2e/phase126_canvas_alert_notice.spec.cjs is run alongside this spec
// as the neighbour regression.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, openSamplePath } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const SCANNED = path.join(ROOT, 'test-fixtures', 'tfl1550', 'scanned-12.pdf');
const NOTICE_AUTO_COLLAPSE_MS = 10000;

test.setTimeout(300000);

// The state lives on the expanded box (`data-activity-alert-state`) or on the
// collapsed region (`data-activity-alert-notice-state`); read whichever is up.
async function alertState(win) {
  return win.evaluate(() => {
    const box = document.querySelector('[data-activity-alert-notice]');
    if (box) return box.getAttribute('data-activity-alert-state');
    const region = document.querySelector('[data-activity-alert-notice-state]');
    if (region) return region.getAttribute('data-activity-alert-notice-state');
    return null;
  });
}

async function waitState(win, want, timeout = 15000) {
  await expect.poll(() => alertState(win), { timeout }).toBe(want);
}

// Resolve a CSS custom property to its computed rgb() through a throwaway
// probe, so the token comparisons stay theme-independent (a custom property
// that aliases another token does not stringify to a colour).
async function resolveVarColor(win, name) {
  return win.evaluate((n) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${n})`;
    probe.style.position = 'fixed';
    probe.style.left = '-9999px';
    probe.style.pointerEvents = 'none';
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  }, name);
}

// The real OCR affordance: command palette -> Recognize text -> confirm. The
// default scope is "all pages", which keeps the recognition window long.
async function triggerOcr(win) {
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  await win.fill('[data-command-palette-input]', 'recognize');
  await win.waitForTimeout(300);
  await win.locator('[data-palette-tool-id="recognizeText"]').first().click();
  await win.waitForSelector('[data-ocr-confirm]', { timeout: 8000 });
  await win.click('[data-ocr-confirm]');
}

const CANVAS_NOTICE = '.canvas-top-right .canvas-notices [data-activity-alert-notice]';

test('TFL-1550: the activity notice lives in the canvas top-right cluster and mirrors the warning/error notice behaviour', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });

    // Criterion 8 — with no operations the notice is not mounted, and the
    // retired Activity surface is gone on Home too.
    expect(await win.locator('[data-activity-alert-notice]').count(), 'no expanded notice with no operations').toBe(0);
    expect(await win.locator('[data-activity-alert-icon]').count(), 'no collapsed icon with no operations').toBe(0);
    expect(await win.locator('[data-activity-shelf-open]').count(), 'retired Activity button absent (Home)').toBe(0);
    expect(await win.locator('.activity-shelf-host').count(), 'retired .activity-shelf-host absent (Home)').toBe(0);

    await openSamplePath(win, app, SCANNED);
    await win.waitForSelector('.workspace:visible', { timeout: 30000 });

    // The Intake dispatch itself runs an "Import files" operation, so wait for
    // its success notice to auto-dismiss: the notice under test is then the
    // OCR operation alone, and a settled empty shelf re-proves criterion 8.
    //
    // ADV-1552-02 / DEF-679 — after the operation leaves `activityShelfVisible`
    // the completed snapshot LINGERS for the full collapse cycle
    // (`NOTICE_AUTO_COLLAPSE_MS` 10 s dwell + `MOTION_DURATION.standard` 250 ms
    // exit + a 500 ms buffer = ~10.75 s), so the collapsed `[data-activity-alert-icon]`
    // stays mounted for the whole linger, not the 5 s the old never-lingering
    // contract allowed. Wait for the ENTIRE activity surface (expanded box AND
    // collapsed icon) to unmount with a window that covers that linger; do NOT
    // assert the notice is gone before ~11 s after the operation completes, or
    // a still-lingering icon fails this precondition.
    const SETTLE_TIMEOUT_MS = 30000;
    await expect.poll(() => win.locator('[data-activity-alert-notice]').count(), { timeout: SETTLE_TIMEOUT_MS }).toBe(0);
    await expect.poll(() => win.locator('[data-activity-alert-icon]').count(), { timeout: SETTLE_TIMEOUT_MS }).toBe(0);

    // A real long-running operation (OCR on the scanned sample).
    await triggerOcr(win);

    // Criterion 1 — the notice renders INSIDE the canvas top-right cluster.
    const notice = win.locator(CANVAS_NOTICE);
    await notice.waitFor({ state: 'visible', timeout: 120000 });
    await expect(notice).toHaveCount(1);
    const box = await notice.boundingBox();
    const innerHeight = await win.evaluate(() => window.innerHeight);
    expect(box.y, 'notice sits in the upper canvas, not the window bottom').toBeLessThan(innerHeight / 2);

    // Criterion 2 — expanded after the icon-first enter.
    await waitState(win, 'expanded', 15000);

    // Criterion 3 — 6 px dot, bold count, dim status label.
    const dot = win.locator('.activity-alert-notice-mark');
    const dotBox = await dot.boundingBox();
    expect(Math.round(dotBox.width), 'status dot is 6 px wide').toBe(6);
    expect(Math.round(dotBox.height), 'status dot is 6 px tall').toBe(6);
    await expect(win.locator('.activity-alert-notice-count')).toHaveText('1 operation');
    const countWeight = await win.locator('.activity-alert-notice-count').evaluate((el) => Number(getComputedStyle(el).fontWeight));
    expect(countWeight, 'count is bold').toBeGreaterThanOrEqual(600);
    const labelColor = await win.locator('.activity-alert-notice-active').evaluate((el) => getComputedStyle(el).color);
    const muted = await resolveVarColor(win, '--fg-muted');
    const strong = await resolveVarColor(win, '--fg-strong');
    expect(labelColor, 'status label uses the dim --fg-muted ink').toBe(muted);
    expect(labelColor, 'status label is dimmer than the bold count ink').not.toBe(strong);

    // Criterion 4 — violet left border, distinct from warning and error. The
    // activity accent aliases --accent (`--activity-progress: var(--accent)`),
    // so the observable violet is the resolved --accent. These are soft so the
    // run still reports the behaviour criteria when the tone channel is broken.
    const borderColor = await notice.evaluate((el) => getComputedStyle(el).borderLeftColor);
    const borderWidth = await notice.evaluate((el) => getComputedStyle(el).borderLeftWidth);
    const borderStyle = await notice.evaluate((el) => getComputedStyle(el).borderLeftStyle);
    const accent = await resolveVarColor(win, '--accent');
    const warning = await resolveVarColor(win, '--warning');
    const error = await resolveVarColor(win, '--error');
    const markBg = await dot.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect.soft(borderWidth, 'left border is 3 px').toBe('3px');
    expect.soft(borderStyle, 'left border is solid').toBe('solid');
    expect.soft(borderColor, 'left border is the violet activity accent').toBe(accent);
    expect.soft(borderColor, 'left border differs from --warning amber').not.toBe(warning);
    expect.soft(borderColor, 'left border differs from --error red').not.toBe(error);
    expect.soft(accent, 'the activity accent differs from warning and error').not.toBe(warning);
    expect.soft(accent).not.toBe(error);
    expect.soft(markBg, 'status dot carries the activity accent').toBe(accent);
    await win.screenshot({ path: path.join(SHOTS, 'tfl1550-activity-notice-expanded.png') });

    // Criterion 6 — auto-collapse ~10 s after the notice is expanded.
    await waitState(win, 'collapsed', NOTICE_AUTO_COLLAPSE_MS + 6000);
    await expect(win.locator('[data-activity-alert-icon]')).toBeVisible();
    await win.screenshot({ path: path.join(SHOTS, 'tfl1550-activity-notice-collapsed.png') });

    // End the modal OCR run so the notice is directly interactive. A user
    // cancel is a real path: Cancel, then Close.
    const cancel = win.locator('[data-ocr-cancel]');
    if (await cancel.count()) {
      await cancel.first().click();
      await win.waitForSelector('[data-ocr-close]', { timeout: 10000 });
      await win.locator('[data-ocr-close]').first().click();
    }
    await expect(win.locator('[data-ocr-confirm]')).toHaveCount(0, { timeout: 10000 });

    // Criterion 5a — the collapsed icon expands the notice again.
    const icon = win.locator('[data-activity-alert-icon]');
    await icon.click();
    await waitState(win, 'expanded');
    await expect(win.locator(CANVAS_NOTICE)).toHaveCount(1);

    // Criterion 5b — the collapse control folds it back to the icon.
    await win.locator('[data-activity-alert-collapse]').click();
    await waitState(win, 'collapsed');
    await expect(win.locator('[data-activity-alert-icon]')).toBeVisible();

    // Criterion 7 — the retired Activity button and host are absent.
    expect(await win.locator('[data-activity-shelf-open]').count(), 'retired Activity button absent').toBe(0);
    expect(await win.locator('.activity-shelf-host').count(), 'retired .activity-shelf-host absent').toBe(0);
  } finally {
    await hardClose(app, 'tfl1550');
  }
});

test('TFL-1550: under prefers-reduced-motion the activity notice renders expanded immediately with no animation', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.emulateMedia({ reducedMotion: 'reduce' });
    await expect.poll(
      () => win.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
      { timeout: 5000 },
    ).toBe(true);
    await win.waitForSelector('.sample-card', { timeout: 30000 });

    // Opening the scanned PDF runs a real "Import files" activity operation,
    // which is enough to observe the reduced-motion rendering path.
    await openSamplePath(win, app, SCANNED);

    const notice = win.locator(CANVAS_NOTICE);
    await notice.waitFor({ state: 'visible', timeout: 15000 });
    await expect(notice).toHaveCount(1);

    // The instant path opens straight on the expanded box: the collapsed icon
    // is never the first thing rendered.
    expect(await alertState(win), 'reduced-motion notice starts expanded').toBe('expanded');
    expect(await win.locator('[data-activity-alert-icon]').count(), 'no icon-first enter under reduced motion').toBe(0);
    const animationName = await notice.evaluate((el) => getComputedStyle(el).animationName);
    expect(animationName, 'reduced motion disables the enter animation').toBe('none');
    await win.screenshot({ path: path.join(SHOTS, 'tfl1550-activity-notice-reduced-motion.png') });
  } finally {
    await hardClose(app, 'tfl1550-rm');
  }
});
