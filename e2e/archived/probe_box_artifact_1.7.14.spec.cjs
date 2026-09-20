// Probe: after committing an Add-box, moving it, and confirming, dump the exact
// DOM of every [data-edit-box-id] and the box text mirror to identify the
// "artifact" the operator reports for item 8.
const { test } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp } = require('../lib/launch.cjs');
const path = require('node:path');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test.setTimeout(300000);

let win = null;

test('probe box DOM to identify item-8 artifact', async () => {
  const electronApp = await launchApp([]);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  await win.waitForTimeout(700);
  await win.locator('.sample-card:has-text("report.pdf")').first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2200);

  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);

  const slot1 = win.locator('.page-slot[data-page="1"]').first();
  await slot1.waitFor({ timeout: 15000 });
  const slotRect = await slot1.boundingBox();
  const px = slotRect.x + slotRect.width * 0.30;
  const py = slotRect.y + 230;
  await win.mouse.move(px, py);
  await win.mouse.down();
  await win.mouse.move(px + 140, py + 90, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(800);

  const ta = win.locator('[data-edit-textarea]').first();
  await ta.waitFor({ timeout: 10000 });
  await ta.fill('ARTIFACT CHECK 88');
  await win.waitForTimeout(300);
  await win.click('[aria-label="Apply edit"]');
  await win.waitForTimeout(900);

  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);
  const boxBefore = await win.evaluate(() => {
    const b = document.querySelector('[data-edit-box-id]');
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  const grabX = boxBefore.x + boxBefore.w / 2;
  const grabY = boxBefore.y + boxBefore.h / 2;
  await win.mouse.move(grabX, grabY);
  await win.mouse.down();
  await win.mouse.move(grabX + 170, grabY + 110, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(500);
  await win.keyboard.press('Control+Enter');
  await win.waitForTimeout(900);

  // Dump every [data-edit-box-id] outerHTML (truncated) + rect.
  const dump = await win.evaluate(() => {
    const els = Array.from(document.querySelectorAll('[data-edit-box-id]'));
    return els.map((e) => {
      const r = e.getBoundingClientRect();
      const cls = e.className || '';
      const dataAttr = e.getAttribute('data-edit-box-id');
      return {
        cls: String(cls),
        dataEditBoxId: dataAttr,
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        tag: e.tagName,
        parentCls: e.parentElement ? (e.parentElement.className || '') : '',
        x: e.outerHTML.replace(/\s+/g, ' ').slice(0, 200),
      };
    });
  });
  console.log('[PROBE] box-id elements=' + JSON.stringify(dump, null, 2));

  // Dump the text mirror + html inside the box.
  const mirror = await win.evaluate(() => {
    const m = document.querySelector('[data-edit-box-text-mirror]');
    if (!m) return null;
    const r = m.getBoundingClientRect();
    return { rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, text: m.textContent, html: m.outerHTML.replace(/\s+/g, ' ').slice(0, 300) };
  });
  console.log('[PROBE] mirror=' + JSON.stringify(mirror, null, 2));

  // The box's rendered text spans within the slot.
  const slotText = await win.evaluate(() => {
    const p = document.querySelector('.page-slot[data-page="1"]');
    const layer = p.querySelector('.textLayer');
    let joined = '';
    if (layer) layer.querySelectorAll('span').forEach((s) => { joined += s.textContent || ''; });
    return (joined || '').replace(/[ \t\r\n]+/g, ' ').trim();
  });
  console.log('[PROBE] page1 textLayer="' + slotText.slice(0, 200) + '"');

  await win.screenshot({ path: path.join(SHOTS, 'gt-item8-probe.png') });
  await hardClose(electronApp);
  win = null;
});
