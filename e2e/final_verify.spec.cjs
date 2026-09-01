const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('path');
const fs = require('fs');

test.describe('Final Bug Verification', () => {
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

  test('B6: thumbnail jump (long.pdf)', async () => {
    const card = window.locator('.sample-card').filter({ hasText: 'long.pdf' }).first();
    await card.click({ force: true });
    await window.waitForSelector('.workspace', { state: 'visible', timeout: 30000 });

    const scroller = window.locator('.document-scroller');
    // Wait for pages to load
    await window.waitForSelector('.pdf-page', { timeout: 20000 });
    
    await scroller.evaluate(el => el.scrollTop = 10000);
    await window.waitForTimeout(2000);
    const initialTop = await scroller.evaluate(el => el.scrollTop);
    console.log(`B6 Initial Top: ${initialTop}`);
    
    // Click first thumbnail
    await window.locator('.thumb').first().click({ force: true });
    await window.waitForTimeout(2000);
    const top = await scroller.evaluate(el => el.scrollTop);
    console.log(`B6 Final Top: ${top}`);
    expect(top).toBeLessThan(initialTop - 5000);
  });

  test('B10: stamp embed', async () => {
    await window.click('[data-tools-toggle]', { force: true });
    await window.waitForSelector('[data-tools-palette]', { state: 'visible' });
    await window.click('[data-tool-id="stamp"]', { force: true });
    const dialog = window.locator('[data-stamp-dialog]');
    await window.click('[data-stamp-confirm]');
    await window.waitForTimeout(1000);
    // Click in the middle of the visible page
    const page = window.locator('.pdf-page').first();
    const box = await page.boundingBox();
    await window.mouse.click(box.x + box.width/2, box.y + box.height/2);
    await window.waitForTimeout(2000);
    const stamp = window.locator('[data-annotation-type="stamp"]').first();
    await expect(stamp).toBeVisible();
  });
});
