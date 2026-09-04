const { test, expect } = require('@playwright/test');
const { hardClose } = require('./lib/helpers.cjs');
const { launchApp } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');

const INSTALLED = path.join(process.env.LOCALAPPDATA, 'Programs', 'TFlex', 'TFlex.exe');

async function diag() {
  return await lastWindow.evaluate(() => (typeof tflexDiagnostics === 'function' ? tflexDiagnostics() : '<none>'));
}

let electronApp, firstWindow, lastWindow;

test.describe('GT Edit-content bugs (2,3,5,5.5,6)', () => {
  test.beforeAll(async () => {
    electronApp = await launchApp([], null, INSTALLED);
    firstWindow = await electronApp.firstWindow();
    lastWindow = firstWindow;
    await firstWindow.waitForSelector('.welcome', { timeout: 20000 });
    await firstWindow.waitForSelector('.sample-card .sample-name', { timeout: 20000 });
    const card = firstWindow.locator('.sample-card', { has: firstWindow.locator('.sample-name', { hasText: 'report.pdf' }) });
    await card.click();
    await firstWindow.waitForSelector('.workspace', { timeout: 30000 });
    await firstWindow.waitForTimeout(1500);
  });

  test.afterAll(async () => {
    if (electronApp) await hardClose(electronApp);
  });

  test('BUG3: Enter edit mode, click Sign tool -> does edit mode exit?', async () => {
    // Enter edit mode
    await firstWindow.click('[data-toolbar-edit-toggle]');
    await firstWindow.waitForTimeout(500);
    await firstWindow.screenshot({ path: 'screenshots/gt_b3_edit_mode.png' });
    const ed = await diag();
    console.log('Edit mode toggle state (diag):', await firstWindow.evaluate(() => {
      const t = document.querySelector('[data-toolbar-edit-toggle]');
      return { ariaPressed: t?.getAttribute('aria-pressed'), cls: t?.className };
    }));
    // Click Sign tool
    await firstWindow.click('button[aria-label="Sign tool"]');
    await firstWindow.waitForTimeout(500);
    const signState = await firstWindow.evaluate(() => {
      const sigBtn = document.querySelector('button[aria-label="Sign tool"]');
      const editToggle = document.querySelector('[data-toolbar-edit-toggle]');
      const editToolbar = document.querySelector('[data-edit-toolbar]');
      const editLayerActive = [...document.querySelectorAll('.edit-layer')].map(e => e.className);
      return {
        signAriaPressed: sigBtn?.getAttribute('aria-pressed'),
        signTitle: sigBtn?.title,
        editToggleAriaPressed: editToggle?.getAttribute('aria-pressed'),
        editModeMgmt: editToolbar ? 'present' : 'absent',
        editLayerClasses: editLayerActive,
      };
    });
    console.log('After clicking Sign while edit mode:', JSON.stringify(signState, null, 2));
    await firstWindow.screenshot({ path: 'screenshots/gt_b3_sign_while_edit.png' });
    // Try to place the signature on the page
    const hasSigModal = await firstWindow.evaluate(() => !!document.querySelector('.sig-manager'));
    console.log('Signature manager open?', hasSigModal);
    if (hasSigModal) {
      await firstWindow.click('.sig-tab:has-text("Type")');
      await firstWindow.fill('input[aria-label="Type your signature"]', 'QA Edit');
      await firstWindow.click('.sig-manager button:text-is("Save")');
      await firstWindow.waitForTimeout(300);
      await firstWindow.click('.sig-saved-pick');
      await firstWindow.waitForTimeout(300);
      const layer = firstWindow.locator('.signatures-layer[data-page="1"]');
      const box = await layer.boundingBox();
      await firstWindow.mouse.click(box.x + 300, box.y + 300);
      await firstWindow.waitForTimeout(600);
      const placeResult = await firstWindow.evaluate(() => ({
        pending: !!document.querySelector('[data-sig-pending]'),
        sigActionBar: !!document.querySelector('[data-sig-action-bar]'),
        sigPlaced: document.querySelectorAll('.sig-placement').length,
      }));
      console.log('After attempt to place signature in edit mode:', JSON.stringify(placeResult, null, 2));
      await firstWindow.screenshot({ path: 'screenshots/gt_b3_place_attempt.png' });
    }
  });

  test('BUG2: edit a text run, replace -> old text residue?', async () => {
    // Ensure edit mode is on (toggle if not). We toggle off then on to reset tool.
    const editToggle = firstWindow.locator('[data-toolbar-edit-toggle]');
    const pressed = await editToggle.getAttribute('aria-pressed');
    if (pressed !== 'true') {
      await editToggle.click();
      await firstWindow.waitForTimeout(400);
    }
    // Select the text tool
    await firstWindow.click('[data-edit-tool="text"]');
    await firstWindow.waitForTimeout(400);
    await firstWindow.screenshot({ path: 'screenshots/gt_b2_edittool.png' });

    // Find a visible text span in the pdf text layer on page 1 and click it
    const span = await firstWindow.evaluate(() => {
      const layers = [...document.querySelectorAll('.textLayer span, .textLayer')];
      // find a span with actual text
      const spanEl = [...document.querySelectorAll('.textLayer span')].find(s => s.textContent.trim().length > 3);
      if (!spanEl) return null;
      const r = spanEl.getBoundingClientRect();
      return { text: spanEl.textContent, x: r.x + r.width / 2, y: r.y + r.height / 2, rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
    });
    console.log('Chosen text span:', JSON.stringify(span));
    if (span) {
      await firstWindow.mouse.click(span.x, span.y);
      await firstWindow.waitForTimeout(800);
      const editor = await firstWindow.evaluate(() => {
        const e = document.querySelector('.edit-inline-editor');
        if (!e) return { present: false };
        const ta = document.querySelector('[data-edit-textarea]');
        return {
          present: true,
          mode: e.getAttribute('data-edit-editor'),
          text: ta?.value,
          rect: (() => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })(),
        };
      });
      console.log('Editor after clicking text run:', JSON.stringify(editor));
      await firstWindow.screenshot({ path: 'screenshots/gt_b2_editor.png' });
      // Replace text
      const ta = firstWindow.locator('[data-edit-textarea]');
      await ta.fill('Edited title text');
      await firstWindow.waitForTimeout(200);
      await firstWindow.click('[aria-label="Apply edit"]');
      await firstWindow.waitForTimeout(1500);
      await firstWindow.screenshot({ path: 'screenshots/gt_b2_after_apply.png' });
      const after = await firstWindow.evaluate(() => {
        // dump the page text layer area around the edited run
        const layers = [...document.querySelectorAll('.textLayer')].map(l => l.textContent);
        return { textLayers: layers.slice(0, 2) };
      });
      console.log('After apply text layers:', JSON.stringify(after));
    } else {
      console.log('No text span found on page 1.');
    }
  });

  test('BUG5 / 5.5 / 5b: add text box, try to move it, click to reopen', async () => {
    // Select box tool
    await firstWindow.click('[data-edit-tool="box"]');
    await firstWindow.waitForTimeout(400);
    // Drag-create a box on the page
    const layer = firstWindow.locator('.edit-layer').first();
    const box = await layer.boundingBox();
    console.log('edit layer box:', JSON.stringify(box));
    await firstWindow.mouse.move(box.x + 200, box.y + 150);
    await firstWindow.mouse.down();
    await firstWindow.mouse.move(box.x + 300, box.y + 220, { steps: 8 });
    await firstWindow.mouse.up();
    await firstWindow.waitForTimeout(800);
    const editor = await firstWindow.evaluate(() => {
      const e = document.querySelector('.edit-inline-editor');
      return { present: !!e, mode: e?.getAttribute('data-edit-editor') };
    });
    console.log('Box editor:', JSON.stringify(editor));
    if (editor.present) {
      const ta = firstWindow.locator('[data-edit-textarea]');
      await ta.fill('My test box');
      await firstWindow.waitForTimeout(200);
      await firstWindow.click('[aria-label="Apply edit"]');
      await firstWindow.waitForTimeout(1500);
    }
    await firstWindow.screenshot({ path: 'screenshots/gt_b5_box_added.png' });

    // Now a committed box exists. Try to DRAG it (bug 5a / 5.5)
    const boxEl = firstWindow.locator('.edit-box').first();
    const bb = await boxEl.boundingBox();
    console.log('Committed edit-box before drag:', JSON.stringify(bb));
    if (bb) {
      await firstWindow.screenshot({ path: 'screenshots/gt_b5_box_before_drag.png', clip: { x: bb.x - 20, y: bb.y - 40, width: 300, height: 160 } });
      await firstWindow.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await firstWindow.mouse.down();
      await firstWindow.mouse.move(bb.x + bb.width / 2 + 120, bb.y + bb.height / 2 + 60, { steps: 10 });
      await firstWindow.mouse.up();
      await firstWindow.waitForTimeout(800);
      await firstWindow.screenshot({ path: 'screenshots/gt_b5_box_after_drag.png', clip: { x: bb.x - 20, y: bb.y - 40, width: 360, height: 200 } });
      const boxAfter = await firstWindow.evaluate(() => {
        const box = document.querySelector('.edit-box');
        const r = box?.getBoundingClientRect();
        return { present: !!box, rect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null, style: box?.getAttribute('style') };
      });
      console.log('edit-box after drag:', JSON.stringify(boxAfter));
      // Bug 5b: click the placed box -> does the editor reopen?
      const nb = await firstWindow.locator('.edit-box').first().boundingBox();
      console.log('box now at:', JSON.stringify(nb));
      if (nb) {
        await firstWindow.mouse.click(nb.x + nb.width / 2, nb.y + nb.height / 2);
        await firstWindow.waitForTimeout(700);
        const reopened = await firstWindow.evaluate(() => {
          const e = document.querySelector('.edit-inline-editor');
          return { present: !!e, mode: e?.getAttribute('data-edit-editor'), text: document.querySelector('[data-edit-textarea]')?.value };
        });
        console.log('BUG5b click placed box -> editor reopened?', JSON.stringify(reopened));
        await firstWindow.screenshot({ path: 'screenshots/gt_b5b_after_click_box.png' });
      }
    }
    await firstWindow.screenshot({ path: 'screenshots/gt_b5_final.png' });
  });

  test('BUG6: leave edit mode -> clears tool selection?', async () => {
    // Leave edit mode
    await firstWindow.click('[data-toolbar-edit-toggle]');
    await firstWindow.waitForTimeout(500);
    const state = await firstWindow.evaluate(() => {
      const editToggle = document.querySelector('[data-toolbar-edit-toggle]');
      const editToolbar = document.querySelector('[data-edit-toolbar]');
      const editLayer = document.querySelector('.edit-layer');
      return {
        editToggleAriaPressed: editToggle?.getAttribute('aria-pressed'),
        editToolbarPresent: !!editToolbar,
        editLayerPresent: !!editLayer,
      };
    });
    console.log('BUG6 after leaving edit mode:', JSON.stringify(state, null, 2));
    await firstWindow.screenshot({ path: 'screenshots/gt_b6_after_leave_edit.png' });
  });
});
