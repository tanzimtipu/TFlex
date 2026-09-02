const { test } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const path = require('node:path');

const INSTALLED = path.join(process.env.LOCALAPPDATA, 'Programs', 'TFlex', 'TFlex.exe');

test.describe('GT Bug 3 + 6 — Sign while edit active + leaving edit mode clears tool', () => {
  let electronApp, firstWindow;

  test.beforeAll(async () => {
    electronApp = await launchApp([], null, INSTALLED);
    firstWindow = await electronApp.firstWindow();
    await firstWindow.waitForSelector('.welcome', { timeout: 20000 });
    await firstWindow.waitForSelector('.sample-card .sample-name', { timeout: 20000 });
    await firstWindow.locator('.sample-card', { has: firstWindow.locator('.sample-name', { hasText: 'report.pdf' }) }).click();
    await firstWindow.waitForSelector('.workspace', { timeout: 30000 });
    await firstWindow.waitForTimeout(1500);
  });

  test.afterAll(async () => { if (electronApp) await electronApp.close(); });

  test('BUG3: edit mode + ACTIVE text tool, click Sign, try to place', async () => {
    await firstWindow.click('[data-toolbar-edit-toggle]');
    await firstWindow.waitForTimeout(400);
    await firstWindow.click('[data-edit-tool="text"]');
    await firstWindow.waitForTimeout(400);
    // Activate a text-run hover/overlay so the edit layer is pointer-active
    const before = await firstWindow.evaluate(() => ({
      editLayer: [...document.querySelectorAll('.edit-layer')].map(e => e.className),
      editTool: document.querySelector('[data-edit-toolbar]') ? 'present' : 'absent',
    }));
    console.log('Before Sign (edit text tool active):', JSON.stringify(before));

    // Click Sign
    await firstWindow.click('button[aria-label="Sign tool"]');
    await firstWindow.waitForTimeout(500);
    const mid = await firstWindow.evaluate(() => ({
      editToggle: document.querySelector('[data-toolbar-edit-toggle]')?.getAttribute('aria-pressed'),
      editToolbar: document.querySelector('[data-edit-toolbar]') ? 'present' : 'absent',
      editLayer: [...document.querySelectorAll('.edit-layer')].map(e => e.className),
      sigModal: !!document.querySelector('.sig-manager'),
      signBtn: document.querySelector('button[aria-label="Sign tool"]')?.getAttribute('aria-pressed'),
    }));
    console.log('After clicking Sign:', JSON.stringify(mid));
    await firstWindow.screenshot({ path: 'screenshots/gt_b3b_after_sign.png' });

    // Arm a signature
    if (mid.sigModal) {
      await firstWindow.click('.sig-tab:has-text("Type")');
      await firstWindow.fill('input[aria-label="Type your signature"]', 'QA 3');
      await firstWindow.click('.sig-manager button:text-is("Save")');
      await firstWindow.waitForTimeout(300);
      await firstWindow.click('.sig-saved-pick');
      await firstWindow.waitForTimeout(300);
      // Now try to click the page to place
      const layer = firstWindow.locator('.signatures-layer[data-page="1"]');
      const box = await layer.boundingBox();
      await firstWindow.mouse.click(box.x + 250, box.y + 700);
      await firstWindow.waitForTimeout(700);
      const placed = await firstWindow.evaluate(() => ({
        editLayer: [...document.querySelectorAll('.edit-layer')].map(e => e.className),
        pending: !!document.querySelector('[data-sig-pending]'),
        sigActionBar: !!document.querySelector('[data-sig-action-bar]'),
        sigPlaced: document.querySelectorAll('.sig-placement').length,
        editToolbar: document.querySelector('[data-edit-toolbar]') ? 'present' : 'absent',
        editToggle: document.querySelector('[data-toolbar-edit-toggle]')?.getAttribute('aria-pressed'),
      }));
      console.log('BUG3 after attempt to place signature (edit tool active):', JSON.stringify(placed, null, 2));
      await firstWindow.screenshot({ path: 'screenshots/gt_b3b_place_attempt.png' });
    }
  });

  test('BUG6: leaving edit mode clears tool; re-enter -> tool reset?', async () => {
    // We may still be in edit mode. Ensure text tool is active.
    const toggle = firstWindow.locator('[data-toolbar-edit-toggle]');
    const pressed1 = await toggle.getAttribute('aria-pressed');
    if (pressed1 !== 'true') {
      await toggle.click();
      await firstWindow.waitForTimeout(400);
    }
    await firstWindow.click('[data-edit-tool="text"]');
    await firstWindow.waitForTimeout(300);
    console.log('Edit tool text selected. Now leaving edit mode...');
    await toggle.click();
    await firstWindow.waitForTimeout(500);
    const afterLeave = await firstWindow.evaluate(() => ({
      editToggle: document.querySelector('[data-toolbar-edit-toggle]')?.getAttribute('aria-pressed'),
      editToolbar: !!document.querySelector('[data-edit-toolbar]'),
      editLayer: document.querySelector('.edit-layer') ? 'present' : 'absent',
    }));
    console.log('After leave edit mode:', JSON.stringify(afterLeave));

    // Re-enter edit mode -> which tool is active?
    await toggle.click();
    await firstWindow.waitForTimeout(500);
    const afterReenter = await firstWindow.evaluate(() => {
      const tb = document.querySelector('[data-edit-toolbar]');
      const active = tb?.querySelector('[aria-pressed="true"], .edit-tool-active');
      const editTools = [...document.querySelectorAll('[data-edit-tool]')].map(b => ({ tool: b.getAttribute('data-edit-tool'), pressed: b.getAttribute('aria-pressed'), cls: b.className }));
      return { editToggle: document.querySelector('[data-toolbar-edit-toggle]')?.getAttribute('aria-pressed'), editTools };
    });
    console.log('After RE-enter edit mode:', JSON.stringify(afterReenter, null, 2));
    await firstWindow.screenshot({ path: 'screenshots/gt_b6_reenter.png' });
  });
});
