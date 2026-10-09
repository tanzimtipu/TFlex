// Debug script to check activity notice border styling
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, openSamplePath } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const SCANNED = path.join(ROOT, 'test-fixtures', 'tfl1550', 'scanned-12.pdf');

test.setTimeout(60000);

test('DEBUG: Check activity notice border attributes', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, SCANNED);
    
    // Trigger OCR
    await win.keyboard.press('Control+k');
    await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
    await win.fill('[data-command-palette-input]', 'recognize');
    await win.waitForTimeout(300);
    await win.locator('[data-palette-tool-id="recognizeText"]').first().click();
    await win.waitForSelector('[data-ocr-confirm]', { timeout: 8000 });
    await win.click('[data-ocr-confirm]');
    
    const notice = win.locator('[data-activity-alert-notice]');
    await notice.waitFor({ state: 'visible', timeout: 120000 });
    
    // Wait for expanded
    await win.waitForFunction(() => {
      const box = document.querySelector('[data-activity-alert-notice]');
      return box && box.getAttribute('data-activity-alert-state') === 'expanded';
    }, { timeout: 15000 });
    
    // Get all diagnostic info
    const debug = await win.evaluate(() => {
      const notice = document.querySelector('[data-activity-alert-notice]');
      if (!notice) return { error: 'notice not found' };
      
      const style = getComputedStyle(notice);
      return {
        tone: notice.getAttribute('data-activity-alert-tone'),
        state: notice.getAttribute('data-activity-alert-state'),
        classList: Array.from(notice.classList),
        borderLeftWidth: style.borderLeftWidth,
        borderLeftStyle: style.borderLeftStyle,
        borderLeftColor: style.borderLeftColor,
        activityProgress: style.getPropertyValue('--activity-progress'),
        accent: style.getPropertyValue('--accent'),
        fullStyle: style.cssText,
      };
    });
    
    console.log('DEBUG INFO:', JSON.stringify(debug, null, 2));
    
    await win.screenshot({ path: path.join(SHOTS, 'debug-activity-border.png') });
  } finally {
    await hardClose(app, 'debug-border');
  }
});
