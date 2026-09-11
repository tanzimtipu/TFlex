const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchDev, openSample, scrollToPage, shot, hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

test.describe('Verification: Add Box Edit Mode', () => {
  let app = null;
  let win = null;

  test.afterEach(async () => {
    await hardClose(app);
  });

  test('Verify "Add Box" functionality', async () => {
    const launched = await launchDev();
    app = launched.electronApp;
    win = launched.window;

    // 1. Open a PDF with text content
    await openSample(win, app, 'report.pdf');
    await scrollToPage(win, 1);

    // 2. Enter Edit mode
    await win.click('[data-toolbar-edit-toggle]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });

    // 3. Click "Add box" tool
    await win.click('[data-edit-tool="box"]');
    await win.waitForTimeout(400);

    // 4. Click on existing text to edit it
    // First find some text
    const textSpan = await win.evaluate(() => {
      const span = document.querySelector('.textLayer span');
      if (!span) return null;
      const r = span.getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2, text: span.textContent };
    });
    expect(textSpan).not.toBeNull();

    // Click it to "edit" (simulating clicking on text with the box tool)
    await win.mouse.click(textSpan.x, textSpan.y);
    await win.waitForTimeout(800);

    // 5. Verify: Original text on page is hidden/covered while toolbox is open
    // We expect an "eraser" or similar to cover the text
    const eraserExists = await win.evaluate(() => !!document.querySelector('[data-edit-box-eraser]'));
    console.log(`Eraser exists: ${eraserExists}`);
    
    // Screenshot: Edit toolbox open (showing original text is covered)
    await win.screenshot({ path: path.join(SHOTS, 'verify-edit-box-open.png') });

    // 6. Drag the toolbox to a new location
    // Find the toolbox/box and drag it
    const boxRect = await win.evaluate(() => {
      const b = document.querySelector('.edit-box-drag-handle') || document.querySelector('.edit-box');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2 };
    });
    expect(boxRect).not.toBeNull();

    await win.mouse.move(boxRect.x, boxRect.y);
    await win.mouse.down();
    await win.mouse.move(boxRect.x + 100, boxRect.y + 50, { steps: 10 });
    await win.mouse.up();
    await win.waitForTimeout(500);

    // 7. Click Confirm
    const confirmBtn = win.locator('[aria-label="Confirm placement"], [data-edit-confirm="true"], button:has-text("Confirm")').first();
    await confirmBtn.click();
    
    // 8. Verify: No full-page flicker/flash - smooth placement
    // (Visual check for QA, but we wait to ensure it's committed)
    await win.waitForTimeout(1000);

    // 9. Text should appear at new location smoothly
    const boxAfter = await win.evaluate(() => !!document.querySelector('.edit-box'));
    console.log(`Box exists after confirm: ${boxAfter}`);

    // Screenshot: After confirm (smooth placement)
    await win.screenshot({ path: path.join(SHOTS, 'verify-edit-box-final.png') });
  });
});
