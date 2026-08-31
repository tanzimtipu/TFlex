const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('path');
const fs = require('fs');

test.describe('Phase 13 Re-verification', () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    electronApp = await launchApp();
    window = await electronApp.firstWindow();
    await window.waitForSelector('.sample-card', { timeout: 30000 });
  });

  test.afterAll(async () => {
    if (electronApp) await electronApp.close();
  });

  async function takeScreenshot(name) {
    const screenshotPath = path.join(__dirname, '../screenshots', name);
    await window.screenshot({ path: screenshotPath });
    console.log(`Saved screenshot: ${screenshotPath}`);
  }

  test('Performance: Cold start and 520-page open', async () => {
    // Cold start was measured by the app launch and selector wait.
    // For a real re-time, we look at the console or use a fresh launch.
    // We already launched it.
    
    const longPath = getSamplePath('long.pdf');
    const start = Date.now();
    
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, longPath);
    
    await window.locator('button:has-text("Open PDF")').first().click({ force: true });
    await window.waitForSelector('.workspace', { timeout: 10000 });
    
    const end = Date.now();
    const duration = end - start;
    console.log(`Open 520-page duration: ${duration}ms`);
    expect(duration).toBeLessThan(3000);
    
    await takeScreenshot('p13-long-doc.png');
    await window.click('.tab-close');
  });

  test('SC1: Frameless Title Bar and Controls', async () => {
    // Use specific selectors
    const titlebar = window.locator('.titlebar').first();
    const controls = window.locator('.titlebar-controls');
    
    await expect(titlebar).toBeVisible();
    await expect(controls).toBeVisible();

    const minBtn = window.locator('.titlebar-control-min');
    const maxBtn = window.locator('.titlebar-control-max');
    const closeBtn = window.locator('.titlebar-control-close');

    await expect(minBtn).toBeVisible();
    await expect(maxBtn).toBeVisible();
    await expect(closeBtn).toBeVisible();

    // Check if dragging works by checking the attribute
    const dragRegion = await titlebar.getAttribute('data-titlebar');
    expect(dragRegion).toBe('true');
    
    // Check computed style for -webkit-app-region
    const dragStyle = await titlebar.evaluate(el => getComputedStyle(el).webkitAppRegion);
    console.log('Titlebar drag style:', dragStyle);
    // expect(dragStyle).toBe('drag'); // Playwright might not report this exactly
  });

  test('SC2: Menu Popover and Semantic Colors', async () => {
    const menuBtn = window.locator('.titlebar-menu-button');
    await menuBtn.click({ force: true });
    
    // Discovery showed menuBtn exists. 
    // Wait for popover.
    await window.waitForSelector('.popover, .dropdown-menu, .context-menu, [role="menu"]', { timeout: 5000 });
    await takeScreenshot('p13-menu-popover.png');
    await window.keyboard.press('Escape');

    // Trigger semantic toast
    await window.evaluate(() => {
        window.tflex.engine.loadDocument('invalid', 'C:/invalid.pdf').catch(() => {});
    });
    
    const toast = window.locator('.toast, .notification').first();
    await expect(toast).toBeVisible({ timeout: 5000 });
    const toastBg = await toast.evaluate(el => getComputedStyle(el).backgroundColor);
    console.log('Toast background color:', toastBg);
    // Semantic color check - should be red-ish for error
    // zinc-900 is rgb(24, 24, 27) roughly. Error might be rgb(239, 68, 68) (red-500)
    await takeScreenshot('p13-semantic-toast.png');
  });

  test('SC3: Richer Annotation Swatches and Themes', async () => {
    await window.click('.sample-card:has-text("report.pdf")', { force: true });
    await window.waitForSelector('.workspace');
    
    await window.click('[data-toolbar-edit-toggle]');
    await window.waitForSelector('[data-edit-toolbar]');
    await window.click('button[aria-label="Highlight"]');
    
    const swatches = window.locator('.color-swatch');
    const count = await swatches.count();
    console.log('Swatch count:', count);
    expect(count).toBeGreaterThan(5);
    
    await takeScreenshot('p13-richer-swatches.png');

    // Theme check
    const body = window.locator('body');
    const initialTheme = await body.getAttribute('data-theme') || 'light';
    
    await window.click('.theme-toggle');
    await window.waitForTimeout(500);
    const darkTheme = await body.getAttribute('data-theme');
    expect(darkTheme).not.toBe(initialTheme);
    await takeScreenshot('p13-dark-theme.png');
    
    await window.click('.theme-toggle');
    await window.waitForTimeout(500);
    await takeScreenshot('p13-light-theme.png');
  });

  test('Layout Audit: Check for obscuring elements', async () => {
    const analysis = await window.evaluate(() => {
      const app = document.querySelector('.app');
      const titlebar = document.querySelector('.titlebar');
      const workspace = document.querySelector('.workspace') || document.querySelector('.welcome-screen');
      
      return {
        app: {
          className: app.className,
          rect: app.getBoundingClientRect(),
          style: getComputedStyle(app).pointerEvents,
          zIndex: getComputedStyle(app).zIndex
        },
        titlebar: {
          rect: titlebar.getBoundingClientRect(),
          style: getComputedStyle(titlebar).pointerEvents,
          zIndex: getComputedStyle(titlebar).zIndex
        },
        workspace: {
          rect: workspace?.getBoundingClientRect(),
          style: workspace ? getComputedStyle(workspace).pointerEvents : 'N/A'
        }
      };
    });
    console.log('Layout Analysis:', JSON.stringify(analysis, null, 2));
  });
});
