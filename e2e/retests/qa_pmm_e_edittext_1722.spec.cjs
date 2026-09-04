// QA reproduction probe (item 2 completion) — installed v1.7.22:
// "Edit text" tool: hover cursor over a text run, click -> toolbox?
// Launch only via e2e/lib/launch.cjs (launchApp) against the packaged exe.

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test.setTimeout(300000);

let electronApp = null;
let win = null;

test.beforeEach(async () => {
  electronApp = await launchApp([]);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  await win.waitForTimeout(700);
});

test.afterEach(async () => {
  await hardClose(electronApp);
  electronApp = null;
  win = null;
});

test('E. edit-text tool: hover cursor + click toolbox', async () => {
  await win.locator('.sample-card:has-text("report.pdf")').first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2200);
  await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector('.page-slot[data-page="1"]');
    if (sc && slot) sc.scrollTop = slot.offsetTop - 10;
  });
  await win.waitForTimeout(1200);

  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="text"]');
  await win.waitForTimeout(400);

  // Hover over the title run.
  const title = await win.evaluate(() => {
    const spans = document.querySelectorAll('.page-slot[data-page="1"] .textLayer span');
    for (const s of spans) {
      if ((s.textContent || '').includes('TFlex Technical Report')) {
        const r = s.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: s.textContent };
      }
    }
    return null;
  });
  expect(title, 'title run found').toBeTruthy();
  await win.mouse.move(title.x, title.y);
  await win.waitForTimeout(250);
  const hover = await win.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    if (!el) return null;
    let cur = el;
    let cursor = 'auto';
    for (let i = 0; i < 14 && cur; i++) {
      const c = getComputedStyle(cur).cursor;
      if (c && c !== 'auto') { cursor = c; break; }
      cur = cur.parentElement;
    }
    const hoverHint = !!document.querySelector('.edit-text-hover');
    return { cursor, hit: el.tagName.toLowerCase() + '.' + String(el.className).slice(0, 30), hoverHint };
  }, [title.x, title.y]);
  process.stdout.write(`[RES|EDITTEXT-HOVER] ${JSON.stringify(hover)}\n`);
  await win.screenshot({ path: path.join(SHOTS, 'def-153-e-edittext-hover.png') });

  await win.mouse.click(title.x, title.y);
  await win.waitForTimeout(700);
  const bars = await win.evaluate(() => {
    const ed = document.querySelector('.edit-inline-editor');
    if (!ed) return null;
    return {
      present: true,
      gripLabel: (ed.querySelector('.ann-textbox-grip-label') || {}).textContent || null,
      buttons: Array.from(ed.querySelectorAll('button')).map((b) => (b.textContent || '').trim()),
      toolbarCursor: getComputedStyle(ed.querySelector('.edit-inline-toolbar') || ed).cursor,
    };
  });
  process.stdout.write(`[RES|EDITTEXT-CLICK] ${JSON.stringify(bars)}\n`);
  await win.screenshot({ path: path.join(SHOTS, 'def-153-e-edittext-toolbox.png') });
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);
});
