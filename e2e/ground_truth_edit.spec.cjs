const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchDev, openSample, scrollToPage, shot, hardClose, toggleEditMode } = require('./lib/helpers.cjs');
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
    // Phase 36 (chunk 3) — the per-view command row is retired; Edit mode is
    // the EDIT dock's `editMode` verb.
    await toggleEditMode(win);
    
    // Wait for the EDIT dock's edit-layer verbs (Phase 41 item 2 — the legacy
    // edit toolbar is retired; its tool modes ride the dock).
    await win.locator('[data-dock-verb="editTextBox"]').waitFor({ state: 'visible', timeout: 10000 });
    
    // 4. Observe placement
    // Take screenshot 1: Edit mode active showing the dock placement
    await win.waitForTimeout(1000); // Wait for animations
    const shot1 = await shot(win, 'edit-mode-ground-truth-1.png');
    console.log(`Screenshot 1 saved to ${shot1}`);

    // Check where the EDIT dock sits
    const toolbarRect = await win.evaluate(() => {
      const el = document.querySelector('[data-action-dock]');
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
      console.log(`Dock Top: ${toolbarRect.top}, Window Height: ${toolbarRect.windowHeight}`);
      console.log(`Is in middle? ${isMiddle}`);
    }

    // 5. Try each edit tool (the dock verbs)
    const tools = [['text', 'editText'], ['box', 'editTextBox'], ['image', 'editImage']];
    for (const [tool, verb] of tools) {
      console.log(`Testing tool: ${tool}`);
      const toolBtn = win.locator(`[data-dock-verb="${verb}"]`);
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
