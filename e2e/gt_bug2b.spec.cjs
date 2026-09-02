const { test } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const path = require('node:path');

const INSTALLED = path.join(process.env.LOCALAPPDATA, 'Programs', 'TFlex', 'TFlex.exe');

test.describe('GT Bug 2 clean — edit text run residue', () => {
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

  test('edit the subtitle run, capture mask vs old-run geometry, screenshot', async () => {
    // Enter edit mode, text tool
    await firstWindow.click('[data-toolbar-edit-toggle]');
    await firstWindow.waitForTimeout(400);
    await firstWindow.click('[data-edit-tool="text"]');
    await firstWindow.waitForTimeout(400);

    // Find the subtitle text span
    const span = await firstWindow.evaluate(() => {
      const spans = [...document.querySelectorAll('.textLayer span')];
      const target = spans.find(s => s.textContent.trim().startsWith('A study in PDF orchestration'));
      if (!target) return null;
      const r = target.getBoundingClientRect();
      return { text: target.textContent, x: r.x + r.width/2, y: r.y + r.height/2, bbox: { x: r.x, y: r.y, w: r.width, h: r.height } };
    });
    console.log('Subtitle span:', JSON.stringify(span));
    if (!span) return;
    await firstWindow.mouse.click(span.x, span.y);
    await firstWindow.waitForTimeout(700);
    const editor = await firstWindow.evaluate(() => {
      const e = document.querySelector('.edit-inline-editor');
      const ta = document.querySelector('[data-edit-textarea]');
      if (!e) return { present: false };
      const r = e.getBoundingClientRect();
      return { present: true, mode: e.getAttribute('data-edit-editor'), text: ta?.value, clientRect: { x: r.x, y: r.y, w: r.width, h: r.height } };
    });
    console.log('Editor (mask anchor) client rect:', JSON.stringify(editor));
    await firstWindow.screenshot({ path: 'screenshots/gt_b2_clean_editor.png' });

    // Commit with a LONGER replacement so new text overflows the old rect if mask is short
    await firstWindow.locator('[data-edit-textarea]').fill('A MUCH LONGER REPLACEMENT SENTENCE THAN BEFORE');
    await firstWindow.waitForTimeout(200);
    await firstWindow.click('[aria-label="Apply edit"]');
    await firstWindow.waitForTimeout(1500);
    // Zoomed crop of the edited region
    const region = await firstWindow.evaluate(() => {
      // find the last textLayer text span that is the new text
      const spans = [...document.querySelectorAll('.textLayer span')];
      const target = spans.find(s => s.textContent.trim().includes('MUCH LONGER'));
      const r = target ? target.getBoundingClientRect() : null;
      return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
    });
    console.log('New text span region:', JSON.stringify(region));
    if (region) {
      await firstWindow.screenshot({
        path: 'screenshots/gt_b2_clean_zoomed.png',
        clip: { x: region.x - 30, y: region.y - 40, width: region.w + 60, height: region.h + 80 },
      });
    }
    await firstWindow.screenshot({ path: 'screenshots/gt_b2_clean_full.png' });
    // Dump the text layer to confirm old run still in content stream
    const tl = await firstWindow.evaluate(() => [...document.querySelectorAll('.textLayer')].map(l => l.textContent).slice(0,1).join(''));
    console.log('Page textLayer contains old subtitle?', tl.includes('A study in PDF orchestration'), '| contains new?', tl.includes('MUCH LONGER'));
  });
});
