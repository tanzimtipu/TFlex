const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchDev, openSample, scrollToPage, shot, hardClose } = require('./lib/helpers.cjs');
const fs = require('node:fs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

test.describe('Ground Truth: Edit Mode Verification', () => {
  let app = null;
  let win = null;

  test.afterEach(async () => {
    await hardClose(app);
  });

  test('Verify Edit Mode Toolbar and Tools', async () => {
    // 1. Launch TFlex (dev build)
    const launched = await launchDev();
    app = launched.electronApp;
    win = launched.window;

    // 2. Open PDF (report.pdf is a common fixture)
    await openSample(win, app, 'report.pdf');
    await scrollToPage(win, 1);

    // 3. Click Edit button
    // Selector found in qa_verify_edit_box.spec.cjs: [data-toolbar-edit-toggle]
    const editToggle = win.locator('[data-toolbar-edit-toggle]');
    await editToggle.click();
    
    // Wait for edit toolbar
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
    
    // 4. Observe placement
    // Take screenshot 1: Edit mode active showing toolbar placement
    await win.waitForTimeout(1000); // Wait for animations
    const shot1 = await shot(win, 'edit-mode-ground-truth-1.png');
    console.log(`Screenshot 1 saved to ${shot1}`);

    // Check if toolbar is in the middle
    const toolbarRect = await win.evaluate(() => {
      const el = document.querySelector('[data-edit-toolbar]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { 
        top: r.top, 
        left: r.left, 
        width: r.width, 
        height: r.height, 
        windowHeight: window.innerHeight,
        windowWidth: window.innerWidth
      };
    });
    
    if (toolbarRect) {
      const isMiddle = toolbarRect.top > toolbarRect.windowHeight / 3 && toolbarRect.top < (toolbarRect.windowHeight * 2 / 3);
      console.log(`Toolbar Top: ${toolbarRect.top}, Window Height: ${toolbarRect.windowHeight}`);
      console.log(`Is in middle? ${isMiddle}`);
    }

    // 5. Try each edit tool
    const tools = ['text', 'box', 'image'];
    for (const tool of tools) {
      console.log(`Testing tool: ${tool}`);
      const toolBtn = win.locator(`[data-edit-tool="${tool}"]`);
      if (await toolBtn.count() > 0) {
        await toolBtn.click();
        await win.waitForTimeout(500);
        
        // Attempt to use tool
        // Click on page
        await win.mouse.click(400, 400); 
        await win.waitForTimeout(500);
      } else {
        console.log(`Tool button ${tool} not found`);
      }
    }

    // Take screenshot 2: Attempt to use a tool
    const shot2 = await shot(win, 'edit-mode-ground-truth-2.png');
    console.log(`Screenshot 2 saved to ${shot2}`);
  });
});
