const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');

test.describe('QA Requirements Verification', () => {
  let electronApp;
  let window;

  test.beforeAll(async () => {
    electronApp = await launchApp();
    window = await electronApp.firstWindow();
    await window.waitForSelector('.sample-card', { timeout: 30000 });
    
    // Open a document first
    const card = window.locator('.sample-card').filter({ hasText: 'report.pdf' }).first();
    await card.click({ force: true });
    await window.waitForSelector('.workspace', { state: 'visible', timeout: 30000 });
  });

  test.afterAll(async () => {
    if (electronApp) await electronApp.close();
  });

  test('1. sign ghost shows actual signature content', async () => {
    // Open tools palette if needed
    const palette = window.locator('[data-tools-palette]');
    if (await palette.isHidden()) {
        await window.click('[data-tools-toggle]', { force: true });
        await window.waitForSelector('[data-tools-palette]', { state: 'visible' });
    }
    
    // Click Sign tool
    await window.click('[data-tool-id="sign"]', { force: true });
    await window.waitForSelector('.sig-manager', { timeout: 10000 });
    
    // Create a typed signature if none exist
    await window.click('button.sig-tab:has-text("Type")');
    await window.locator('.sig-type-input').fill('QA TEST');
    await window.click('button.btn-primary:has-text("Save")');
    
    // Pick the signature
    await window.click('.sig-saved-pick');
    await window.waitForTimeout(500);
    
    // Move mouse over page to show ghost
    const page = window.locator('.pdf-page').first();
    const box = await page.boundingBox();
    await window.mouse.move(box.x + box.width/2, box.y + box.height/2);
    
    const ghost = window.locator('[data-sig-ghost]');
    await expect(ghost).toBeVisible();
    
    // Verify it doesn't show the stamp icon (which would be an img)
    const stampIcon = ghost.locator('img');
    await expect(stampIcon).toHaveCount(0);
    
    // Verify it has the correct source attribute
    const source = await ghost.getAttribute('data-sig-ghost-source');
    expect(source).toBe('typed');
  });

  test('2. pending buttons clickable', async () => {
    // Place it (click)
    const page = window.locator('.pdf-page').first();
    const box = await page.boundingBox();
    await window.mouse.click(box.x + box.width/2, box.y + box.height/2);
    
    const actionBar = window.locator('[data-sig-action-bar]');
    await expect(actionBar).toBeVisible();
    
    const confirmBtn = actionBar.locator('[data-sig-action="confirm"]');
    const cancelBtn = actionBar.locator('[data-sig-action="cancel"]');
    
    await expect(confirmBtn).toBeEnabled();
    await expect(cancelBtn).toBeEnabled();
    
    // Cancel to clean up
    await cancelBtn.click();
  });

  test('3. cross-arming (sign vs stamp) disarms properly', async () => {
    // Open tools palette if needed
    const palette = window.locator('[data-tools-palette]');
    if (await palette.isHidden()) {
        await window.click('[data-tools-toggle]', { force: true });
        await window.waitForSelector('[data-tools-palette]', { state: 'visible' });
    }

    // Arm Sign
    await window.click('[data-tool-id="sign"]', { force: true });
    await window.click('.sig-saved-pick');
    await window.waitForTimeout(500);
    await expect(window.locator('[data-sig-ghost]')).toBeVisible();
    
    // Arm Stamp
    await window.click('[data-tool-id="stamp"]', { force: true });
    await window.click('[data-stamp-confirm]');
    await window.waitForTimeout(500);
    
    // Sign ghost should be gone
    await expect(window.locator('[data-sig-ghost]')).toHaveCount(0);
    // Stamp ghost should be present
    const page = window.locator('.pdf-page').first();
    const box = await page.boundingBox();
    await window.mouse.move(box.x + box.width/2, box.y + box.height/2);
    await expect(window.locator('[data-stamp-ghost]')).toBeVisible();
    
    // Arm Sign again
    await window.click('[data-tool-id="sign"]', { force: true });
    // Stamp ghost should be gone
    await expect(window.locator('[data-stamp-ghost]')).toHaveCount(0);
    
    // Disarm sign
    await window.keyboard.press('Escape');
  });

  test('4. stamp doesn\'t swallow clicks', async () => {
    // Open tools palette if needed
    const palette = window.locator('[data-tools-palette]');
    if (await palette.isHidden()) {
        await window.click('[data-tools-toggle]', { force: true });
        await window.waitForSelector('[data-tools-palette]', { state: 'visible' });
    }

    // Arm Stamp
    await window.click('[data-tool-id="stamp"]', { force: true });
    await window.click('[data-stamp-confirm]');
    await window.waitForTimeout(500);
    
    // Click toolbar Theme Toggle - should work even with stamp armed
    const initialTheme = await window.locator('html').getAttribute('data-theme');
    await window.click('[data-theme-toggle]', { force: true });
    await window.waitForTimeout(500);
    const nextTheme = await window.locator('html').getAttribute('data-theme');
    
    expect(nextTheme).not.toBe(initialTheme);
    
    // Stamp should be disarmed because we clicked outside
    await expect(window.locator('[data-stamp-ghost]')).toHaveCount(0);
  });
});
