// [data-tools-badge] "All tools" tab - size + slide-left verification.
//
// Behavior under test (per phase spec):
//   1. The badge box is exactly 36x100 px (getBoundingClientRect).
//   2. Clicking the badge opens the tools panel, and the badge slides left:
//      its `right` property increases (right-anchored badge moves away from
//      the window edge toward the opened panel).
//
// Evidence: one badge close-up screenshot (at rest).
// Modelled on e2e/tools_badge_arrow_verify.spec.cjs (launch/open/close only).
const { test, expect } = require('@playwright/test');
const { launchDev, openSample, hardClose, dismissUpdatePrompt } = require('./lib/helpers.cjs');

// One DOM probe: badge rect via getBoundingClientRect + computed `right`.
function probeBadge(window) {
  return window.evaluate(() => {
    const b = document.querySelector('[data-tools-badge]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return {
      left: r.left,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      cssRight: getComputedStyle(b).right,
      viewW: window.innerWidth,
    };
  });
}

test.describe('[data-tools-badge] 36x100 size, slide-left on panel open', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    ({ electronApp, window } = await launchDev());
    await dismissUpdatePrompt(window);
    await openSample(window, electronApp, 'report.pdf');
    await window.waitForSelector('[data-tools-badge]', { timeout: 15000 });
    await window.mouse.move(10, 10);
    await window.waitForTimeout(500);
  });

  test.afterEach(async () => {
    if (electronApp) await hardClose(electronApp);
  });

  test('badge box is 36x100 and its right property increases (slides left) when the panel opens', async () => {
    test.setTimeout(180000);
    const badge = window.locator('[data-tools-badge]');
    await badge.waitFor({ timeout: 10000 });

    // ---- 3. Box size: 36x100 (getBoundingClientRect) -----------------------
    const atRest = await probeBadge(window);
    expect(atRest, '[data-tools-badge] missing from the DOM').not.toBeNull();
    console.log(
      `[badge-size] at rest: ${atRest.width}x${atRest.height} (left=${atRest.left}, right=${atRest.right}, cssRight=${atRest.cssRight})`,
    );
    expect(Math.abs(atRest.width - 36), `badge width ${atRest.width}px, expected 36px`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(atRest.height - 100), `badge height ${atRest.height}px, expected 100px`).toBeLessThanOrEqual(0.5);

    // Evidence: one badge close-up (at rest, window edge included).
    const crop = {
      x: Math.max(0, Math.round(atRest.left - 60)),
      y: Math.max(0, Math.round(atRest.top - 40)),
      width: Math.min(atRest.viewW, Math.round(atRest.width + 60)),
      height: Math.round(atRest.height + 80),
    };
    await window.screenshot({ path: 'screenshots/badge-size-slide-closeup.png', clip: crop });

    // ---- 4. Click the badge -> tools panel opens ---------------------------
    await badge.click();
    await window.waitForSelector('.app-main[data-tools-open="true"]', { timeout: 5000 });
    await window.waitForSelector('[data-tools-palette]', { timeout: 5000 });

    // ---- 5. Badge slid left: its `right` property increased ----------------
    await window.waitForTimeout(600); // slide transition settle
    const after = await probeBadge(window);
    expect(after, '[data-tools-badge] detached after panel open').not.toBeNull();
    console.log(
      `[badge-size] open: ${after.width}x${after.height} (left=${after.left}, right=${after.right}, cssRight=${after.cssRight})`,
    );

    const rightBefore = parseFloat(atRest.cssRight);
    const rightAfter = parseFloat(after.cssRight);
    expect(
      Number.isFinite(rightBefore) && Number.isFinite(rightAfter),
      `badge css right not parseable: ${atRest.cssRight} -> ${after.cssRight}`,
    ).toBeTruthy();
    expect(
      rightAfter,
      `badge right property did not increase on panel open (${atRest.cssRight} -> ${after.cssRight}); ` +
        `rect left ${atRest.left} -> ${after.left}, rect right ${atRest.right} -> ${after.right}`,
    ).toBeGreaterThan(rightBefore);
  });
});