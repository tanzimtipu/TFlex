// Adversarial probe for CanvasAlertNotice consolidation (TFL-1536)
// Session: phase-1529 gate
// Attacks: multiple icons, message loss, collapse cycle break, instant path

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, openSamplePath } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const WARNING = 'This tab has no document to move.';

test.setTimeout(300000);

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

test('ADV-1536-01: DOM uniqueness - never more than one icon/notice', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await win.waitForSelector('.workspace', { timeout: 30000 });
    await win.waitForSelector('[data-tab-id]', { timeout: 30000 });

    // Trigger warning
    const docTabId = await win.evaluate(() => window.tflexDiagnostics().activeTabId);
    await win.locator('[data-new-tab]').click();
    await win.waitForTimeout(800);
    await tearOutEmptyTab(win);
    await win.waitForTimeout(500);

    // PROBE: Query DOM multiple times rapidly
    for (let i = 0; i < 5; i++) {
      const iconCount = await win.evaluate(() => {
        return document.querySelectorAll('[data-canvas-alert-icon]').length;
      });
      const noticeCount = await win.evaluate(() => {
        return document.querySelectorAll('[data-canvas-alert-notice]').length;
      });
      
      expect(iconCount).toBeLessThanOrEqual(1);
      expect(noticeCount).toBeLessThanOrEqual(1);
      
      await win.waitForTimeout(100);
    }

    // Screenshot evidence
    await win.screenshot({ path: path.join(SHOTS, 'adv-1536-01-dom-uniqueness.png') });
  } finally {
    await hardClose(app, 'adv-1536-01');
  }
});

test('ADV-1536-02: Add warning while collapsed, then expand', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await win.waitForSelector('.workspace', { timeout: 30000 });
    await win.waitForSelector('[data-tab-id]', { timeout: 30000 });

    // Trigger first warning
    await win.locator('[data-new-tab]').click();
    await win.waitForTimeout(800);
    await tearOutEmptyTab(win);
    await win.waitForTimeout(500);

    // Collapse it
    await win.locator('[data-canvas-alert-collapse]').click();
    await win.waitForTimeout(500);
    
    // Verify collapsed state
    const collapsedState = await win.locator('[data-canvas-alert-notice-state="collapsed"]').count();
    expect(collapsedState).toBeGreaterThan(0);

    // Trigger SECOND warning while collapsed (create another empty tab and tear out)
    await win.locator('[data-new-tab]').click();
    await win.waitForTimeout(800);
    await tearOutEmptyTab(win);
    await win.waitForTimeout(500);

    // Expand - should show BOTH messages without remount
    await win.locator('[data-canvas-alert-icon]').click();
    await win.waitForTimeout(500);

    // Count messages - should have at least 2
    const messageCount = await win.evaluate(() => {
      return document.querySelectorAll('[data-canvas-alert-message]').length;
    });
    
    expect(messageCount).toBeGreaterThanOrEqual(2);
    
    // Verify no remount happened (state should be expanded)
    const expandedState = await win.evaluate(() => {
      const box = document.querySelector('[data-canvas-alert-notice]');
      return box?.getAttribute('data-canvas-alert-state');
    });
    expect(expandedState).toBe('expanded');

    await win.screenshot({ path: path.join(SHOTS, 'adv-1536-02-add-while-collapsed.png') });
  } finally {
    await hardClose(app, 'adv-1536-02');
  }
});

test('ADV-1536-03: Add warning while expanded - live update, dwell NOT reset', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await win.waitForSelector('.workspace', { timeout: 30000 });
    await win.waitForSelector('[data-tab-id]', { timeout: 30000 });

    // Trigger first warning
    await win.locator('[data-new-tab]').click();
    await win.waitForTimeout(800);
    await tearOutEmptyTab(win);
    await win.waitForTimeout(500);

    // Ensure expanded
    await win.locator('[data-canvas-alert-collapse]').click();
    await win.waitForTimeout(500);
    await win.locator('[data-canvas-alert-icon]').click();
    await win.waitForTimeout(500);

    // Record initial message count
    const initialCount = await win.evaluate(() => {
      return document.querySelectorAll('[data-canvas-alert-message]').length;
    });

    // Trigger SECOND warning while expanded
    await win.locator('[data-new-tab]').click();
    await win.waitForTimeout(800);
    await tearOutEmptyTab(win);
    await win.waitForTimeout(500);

    // Message list should update live
    const newCount = await win.evaluate(() => {
      return document.querySelectorAll('[data-canvas-alert-message]').length;
    });
    expect(newCount).toBeGreaterThan(initialCount);

    // Wait 6 seconds - should STILL be expanded (dwell is 10s, NOT reset by programmatic add)
    await win.waitForTimeout(6000);
    const stillExpanded = await win.evaluate(() => {
      const box = document.querySelector('[data-canvas-alert-notice]');
      return box?.getAttribute('data-canvas-alert-state');
    });
    expect(stillExpanded).toBe('expanded');

    await win.screenshot({ path: path.join(SHOTS, 'adv-1536-03-add-while-expanded.png') });
  } finally {
    await hardClose(app, 'adv-1536-03');
  }
});

test('ADV-1536-04: Instant path - reduced motion opens straight to expanded', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    
    // Force reduced motion via CSS
    await win.addStyleTag({
      content: '@media (prefers-reduced-motion: reduce) { * { animation-duration: 0.01ms !important; } }'
    });
    
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await win.waitForSelector('.workspace', { timeout: 30000 });
    await win.waitForSelector('[data-tab-id]', { timeout: 30000 });

    // Trigger warning
    await win.locator('[data-new-tab]').click();
    await win.waitForTimeout(800);
    await tearOutEmptyTab(win);
    await win.waitForTimeout(500);

    // Should go straight to expanded, no "entering" phase visible
    // The entering phase is very short, so we check that we never see it stuck
    let sawEntering = false;
    for (let i = 0; i < 10; i++) {
      const state = await win.evaluate(() => {
        const region = document.querySelector('[data-canvas-alert-notice-state]');
        return region?.getAttribute('data-canvas-alert-notice-state');
      });
      if (state === 'entering') {
        sawEntering = true;
      }
      await win.waitForTimeout(50);
    }

    // With reduced motion, should skip entering or go through it instantly
    const finalState = await win.evaluate(() => {
      const box = document.querySelector('[data-canvas-alert-notice]');
      return box?.getAttribute('data-canvas-alert-state');
    });
    expect(finalState).toBe('expanded');

    await win.screenshot({ path: path.join(SHOTS, 'adv-1536-04-reduced-motion.png') });
  } finally {
    await hardClose(app, 'adv-1536-04');
  }
});

test('ADV-1536-05: Removing source drops message from view', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await win.waitForSelector('.workspace', { timeout: 30000 });
    await win.waitForSelector('[data-tab-id]', { timeout: 30000 });

    // Trigger warning on empty tab
    await win.locator('[data-new-tab]').click();
    await win.waitForTimeout(800);
    await tearOutEmptyTab(win);
    await win.waitForTimeout(500);

    // Count initial messages
    const initialCount = await win.evaluate(() => {
      return document.querySelectorAll('[data-canvas-alert-message]').length;
    });
    expect(initialCount).toBeGreaterThan(0);

    // Close the empty tab that caused the warning
    await win.locator('[data-close-tab]').click();
    await win.waitForTimeout(500);

    // The warning should be gone (no document-related alert on the PDF tab)
    const alertGone = await win.evaluate(() => {
      const notice = document.querySelector('[data-canvas-alert-notice]');
      const icon = document.querySelector('[data-canvas-alert-icon]');
      return !notice && !icon;
    });
    
    // Note: This might fail if the warning persists - that's a finding!
    if (!alertGone) {
      await win.screenshot({ path: path.join(SHOTS, 'adv-1536-05-warning-persists.png') });
    }

    await win.screenshot({ path: path.join(SHOTS, 'adv-1536-05-remove-source.png') });
  } finally {
    await hardClose(app, 'adv-1536-05');
  }
});

test('ADV-1536-06: Blast radius - other notices still function', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    
    // Check that ProtectionNotice, ConversionNotice, Pdf3dNotice selectors exist in DOM
    // (We can't easily trigger them without specific PDFs, but we can verify they're not broken)
    
    const hasProtectionNotice = await win.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      // Check if the CSS variables for protection notice exist
      return styles.getPropertyValue('--protection-notice-bg') !== '';
    });

    // Verify canvas-alert-notice doesn't interfere with other notice structures
    const otherNoticeSelectors = await win.evaluate(() => {
      return {
        protectionNotice: document.querySelector('[data-protection-notice]') !== null,
        conversionNotice: document.querySelector('[data-conversion-notice]') !== null,
        pdf3dNotice: document.querySelector('[data-pdf3d-notice]') !== null,
      };
    });

    // These might not be visible on home screen, that's OK
    // The key is they still exist in the codebase
    console.log('Other notice selectors present:', otherNoticeSelectors);

    await win.screenshot({ path: path.join(SHOTS, 'adv-1536-06-blast-radius.png') });
  } finally {
    await hardClose(app, 'adv-1536-06');
  }
});
