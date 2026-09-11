const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchDev, openSample, scrollToPage, shot, hardClose } = require('../lib/helpers.cjs');

test.describe('DEF-178 and DEF-179 Verification', () => {
  let app = null;
  let win = null;

  test.afterEach(async () => {
    await hardClose(app);
  });

  test('Verify toolbar position and tool responsiveness', async () => {
    const launched = await launchDev();
    app = launched.electronApp;
    win = launched.window;

    await openSample(win, app, 'report.pdf');
    await scrollToPage(win, 1);

    await win.click('[data-toolbar-edit-toggle]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });

    const toolbarRect = await win.evaluate(() => {
      const el = document.querySelector('[data-edit-toolbar]');
      const r = el.getBoundingClientRect();
      const toolbar = document.querySelector('.toolbar') || document.querySelector('[data-main-toolbar]');
      const tr = toolbar ? toolbar.getBoundingClientRect() : { bottom: 0 };
      return { top: r.top, toolbarBottom: tr.bottom };
    });

    console.log('--- DEF-179 RETEST ---');
    console.log('Toolbar Top: ' + toolbarRect.top + ', Main Toolbar Bottom: ' + toolbarRect.toolbarBottom);
    const isDocked = toolbarRect.top >= (toolbarRect.toolbarBottom - 1) && toolbarRect.top < toolbarRect.toolbarBottom + 20;
    console.log('Is docked correctly? ' + isDocked);
    await shot(win, 'def-179-retest.png');

    console.log('--- DEF-178 RETEST ---');
    await win.click('[data-edit-tool=box]');
    await win.mouse.click(300, 300);
    await win.waitForTimeout(1000);
    const boxToolboxExists = await win.evaluate(() => !!(document.querySelector('.edit-box') || document.querySelector('.edit-toolbox') || document.querySelector('[data-edit-box-eraser]')));
    console.log('Add box tool click response (box/toolbox exists): ' + boxToolboxExists);

    await win.click('[data-edit-tool=text]');
    const textPos = await win.evaluate(() => {
      const span = document.querySelector('.textLayer span');
      if (!span) return null;
      const r = span.getBoundingClientRect();
      return { x: r.x + 5, y: r.y + 5 };
    });
    if (textPos) {
      await win.mouse.click(textPos.x, textPos.y);
      await win.waitForTimeout(1000);
      const textEditorExists = await win.evaluate(() => !!(document.querySelector('.text-editor') || document.querySelector('.edit-inline-editor') || document.querySelector('textarea.edit-text-area') || document.querySelector('[contenteditable=true]')));
      console.log('Edit text tool click response (editor exists): ' + textEditorExists);
    }
    await shot(win, 'def-178-retest.png');

    console.log('--- REGRESSION CHECK ---');
    await win.click('[data-edit-tool=off]');
    await win.waitForTimeout(500);
    console.log('Edit toolbar visible after Off: ' + await win.isVisible('[data-edit-toolbar]'));

    await win.keyboard.press('Control+F');
    await win.waitForSelector('[data-search-bar]', { timeout: 5000 });
    const searchRect = await win.evaluate(() => {
      const el = document.querySelector('[data-search-bar]');
      const r = el.getBoundingClientRect();
      const toolbar = document.querySelector('.toolbar') || document.querySelector('[data-main-toolbar]');
      const tr = toolbar ? toolbar.getBoundingClientRect() : { bottom: 0 };
      return { top: r.top, toolbarBottom: tr.bottom };
    });
    console.log('Search bar Top: ' + searchRect.top + ', Main Toolbar Bottom: ' + searchRect.toolbarBottom);
    const searchDocked = searchRect.top >= (searchRect.toolbarBottom - 1) && searchRect.top < searchRect.toolbarBottom + 100;
    console.log('Search bar docked correctly? ' + searchDocked);
  });
});