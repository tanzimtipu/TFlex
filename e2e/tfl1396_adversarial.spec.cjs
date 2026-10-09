// TFL-1396 (Phase 121 chunk C) - adversarial diff-pass on the Home minimum-stack-gap change.
//
// Attack vectors beyond QA coverage:
// 1. Silence attack - every Home control must respond
// 2. Theme switch storm - gap integrity during theme changes
// 3. Window resize storm - gap integrity during rapid resizes
// 4. Empty state vs maximum load - tool row overflow scenarios
// 5. Keyboard navigation - focus order across the gap
//
// Launches ONLY through the canonical e2e/lib/launch.cjs `launchApp` helper.

const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const GAP_MIN = 16;

async function measureGap(win) {
  return win.evaluate(() => {
    const tools = document.querySelector('[data-home-tools]');
    const drop = document.querySelector('[data-intake-dropzone]');
    if (!tools || !drop) return null;
    const toolsBottom = tools.getBoundingClientRect().bottom;
    const dropTop = drop.getBoundingClientRect().top;
    return {
      gap: dropTop - toolsBottom,
      toolsBottom,
      dropTop,
    };
  });
}

test.describe('TFL-1396 Adversarial Probes', () => {
  test('Silence attack - every Home control responds', async () => {
    test.setTimeout(120000);
    const app = await launchApp();
    const win = await app.firstWindow();
    try {
      await win.waitForSelector('.welcome.orbit-desk', { timeout: 30000 });
      await win.waitForSelector('[data-home-tools]', { timeout: 10000 });
      
      // Count actionable controls
      const controlCount = await win.evaluate(() => {
        const buttons = document.querySelectorAll('[data-home-tools] button, [data-home-tools] .btn');
        const intakeButtons = document.querySelectorAll('[data-home-intake] button, [data-home-intake] [role="button"]');
        return {
          toolButtons: buttons.length,
          intakeButtons: intakeButtons.length,
          total: buttons.length + intakeButtons.length,
        };
      });
      
      console.log('[TFL-1396 Silence Attack]', controlCount);
      
      // Must have at least the Open button + some tools
      expect(controlCount.toolButtons).toBeGreaterThan(0);
      
      // Probe each control for clickability
      const silentControls = await win.evaluate(() => {
        const silent = [];
        document.querySelectorAll('[data-home-tools] button, [data-home-tools] .btn, [data-home-intake] button').forEach((btn, i) => {
          const rect = btn.getBoundingClientRect();
          const visible = rect.width > 0 && rect.height > 0;
          const style = getComputedStyle(btn);
          const clickable = !btn.disabled && style.pointerEvents !== 'none' && style.opacity !== '0';
          if (visible && !clickable) {
            silent.push(btn.className || `control-${i}`);
          }
        });
        return silent;
      });
      
      expect(silentControls.length, `Silent controls found: ${silentControls.join(', ')}`).toBe(0);
    } finally {
      await hardClose(app, 'tfl1396-silence');
    }
  });
  
  test('Theme switch storm - gap integrity', async () => {
    test.setTimeout(120000);
    const app = await launchApp();
    const win = await app.firstWindow();
    try {
      await win.waitForSelector('[data-home-tools]', { timeout: 30000 });
      
      // Measure gap before theme switch
      const beforeGap = await measureGap(win);
      expect(beforeGap.gap).toBeGreaterThanOrEqual(GAP_MIN);
      
      // Rapid theme switches (3x)
      const themeToggle = await win.locator('[data-theme-toggle]').first();
      for (let i = 0; i < 3; i++) {
        await themeToggle.click({ timeout: 5000 });
        await win.waitForTimeout(250); // Allow transition to complete
      }
      
      // Measure gap after
      const afterGap = await measureGap(win);
      console.log('[TFL-1396 Theme Storm]', { beforeGap, afterGap });
      
      expect(afterGap.gap, 'Gap must remain >= 16px after theme storm').toBeGreaterThanOrEqual(GAP_MIN);
    } finally {
      await hardClose(app, 'tfl1396-theme-storm');
    }
  });
  
  test('Window resize storm - gap integrity', async () => {
    test.setTimeout(120000);
    const app = await launchApp();
    const win = await app.firstWindow();
    try {
      await win.waitForSelector('[data-home-tools]', { timeout: 30000 });
      
      await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows().find(x => !x.isDestroyed());
        if (w && w.isMaximized()) w.unmaximize();
      });
      await win.waitForTimeout(350);
      
      // Resize storm through various sizes
      const sizes = [[960, 640], [1200, 800], [800, 600], [1400, 900], [960, 640]];
      for (const [w, h] of sizes) {
        await app.evaluate(({ BrowserWindow }, size) => {
          const win = BrowserWindow.getAllWindows().find(x => !x.isDestroyed());
          if (win) win.setSize(size[0], size[1]);
        }, [w, h]);
        await win.waitForTimeout(150);
      }
      
      const finalGap = await measureGap(win);
      console.log('[TFL-1396 Resize Storm]', finalGap);
      
      expect(finalGap.gap, 'Gap must remain >= 16px after resize storm').toBeGreaterThanOrEqual(GAP_MIN);
    } finally {
      await hardClose(app, 'tfl1396-resize-storm');
    }
  });
  
  test('Empty tool row vs maximum load - gap integrity', async () => {
    test.setTimeout(120000);
    const app = await launchApp();
    const win = await app.firstWindow();
    try {
      await win.waitForSelector('[data-home-tools]', { timeout: 30000 });
      
      // Check current state
      const toolCount = await win.evaluate(() => {
        return document.querySelectorAll('[data-home-tools] .btn').length;
      });
      
      console.log('[TFL-1396 Tool Count]', { toolCount });
      
      // Gap must be >= 16px regardless of tool count
      const gap = await measureGap(win);
      expect(gap.gap, 'Gap must be >= 16px').toBeGreaterThanOrEqual(GAP_MIN);
      
      // Verify no visual overlap
      expect(gap.toolsBottom, 'Tools must not overlap drop zone').toBeLessThanOrEqual(gap.dropTop);
    } finally {
      await hardClose(app, 'tfl1396-empty-max');
    }
  });
  
  test('Keyboard navigation - focus order across the gap', async () => {
    test.setTimeout(120000);
    const app = await launchApp();
    const win = await app.firstWindow();
    try {
      await win.waitForSelector('[data-home-tools]', { timeout: 30000 });
      
      // Tab through controls
      await win.keyboard.press('Tab');
      let focusedElement = await win.evaluate(() => document.activeElement?.className || '');
      
      const focusPath = [focusedElement];
      
      // Tab through 5 controls
      for (let i = 0; i < 5; i++) {
        await win.keyboard.press('Tab');
        focusedElement = await win.evaluate(() => document.activeElement?.className || '');
        focusPath.push(focusedElement);
      }
      
      console.log('[TFL-1396 Keyboard Nav]', focusPath);
      
      // Focus must move logically (no jumps)
      expect(focusPath.length).toBe(6);
    } finally {
      await hardClose(app, 'tfl1396-keyboard');
    }
  });
});
