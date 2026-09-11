// Probe: after a per-page crop on page 1, dump the true rendered page boxes.
const { test } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp } = require('../lib/launch.cjs');
const path = require('node:path');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test.setTimeout(300000);
let win = null;

async function openTools() {
  const open = await win.evaluate(() => document.querySelector('[data-tools-palette]') !== null);
  if (!open) {
    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 10000 });
    await win.waitForTimeout(300);
  }
}

async function setCropBoxTo(x, y, width, height) {
  const info = await win.evaluate(() => {
    const page = document.querySelector('[data-crop-editor] .crop-editor-page');
    const mask = document.querySelector('[data-crop-handle="move"]');
    const se = document.querySelector('[data-crop-handle="se"]');
    if (!page || !mask || !se) return null;
    const pr = page.getBoundingClientRect();
    const mr = mask.getBoundingClientRect();
    const sr = se.getBoundingClientRect();
    return { pageW: pr.width, pageLeft: pr.x, pageTop: pr.y, maskLeft: mr.x, maskTop: mr.y, maskW: mr.width, maskH: mr.height, seX: sr.x + sr.width / 2, seY: sr.y + sr.height / 2 };
  });
  if (!info) throw new Error('crop editor not mounted');
  const scale = info.pageW / 612;
  const curBoxX = (info.maskLeft - info.pageLeft) / scale;
  const curBoxY = (info.maskTop - info.pageTop) / scale;
  const moveMx = info.maskLeft + info.maskW / 2;
  const moveMy = info.maskTop + info.maskH / 2;
  await win.mouse.move(moveMx, moveMy);
  await win.mouse.down();
  await win.mouse.move(moveMx + (x - curBoxX) * scale, moveMy + (y - curBoxY) * scale, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(300);
  const rel2 = await win.evaluate(() => {
    const page = document.querySelector('[data-crop-editor] .crop-editor-page');
    const mask = document.querySelector('[data-crop-handle="move"]');
    const se = document.querySelector('[data-crop-handle="se"]');
    const pr = page.getBoundingClientRect();
    const mr = mask.getBoundingClientRect();
    const sr = se.getBoundingClientRect();
    return { maskW: mr.width, maskH: mr.height, seX: sr.x + sr.width / 2, seY: sr.y + sr.height / 2 };
  });
  const dW = (rel2.maskW / scale - width) * scale;
  const dH = (rel2.maskH / scale - height) * scale;
  await win.mouse.move(rel2.seX, rel2.seY);
  await win.mouse.down();
  await win.mouse.move(rel2.seX - dW, rel2.seY - dH, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(300);
}

test('probe crop page1 -> dump rendered page boxes', async () => {
  const electronApp = await launchApp([]);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  await win.waitForTimeout(700);
  await win.locator('.sample-card:has-text("report.pdf")').first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2200);

  await openTools();
  await win.click('[data-tool-id="cropPages"]');
  await win.waitForSelector('[data-crop-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(800);
  await win.click('[data-crop-mode="perPage"]');
  await win.waitForTimeout(700);
  await win.selectOption('[data-crop-page-select]', '1');
  await win.waitForTimeout(600);
  await setCropBoxTo(231, 321, 150, 150);
  await win.click('[data-crop-confirm]');
  await win.waitForTimeout(2600);

  // Dump the structure of the continuous scroller: every .page-slot + its box.
  const dump = await win.evaluate(() => {
    const scroller = document.querySelector('.document-scroller');
    const slots = Array.from((scroller || document).querySelectorAll('.page-slot, .pdf-page'));
    return slots.slice(0, 8).map((e) => {
      const r = e.getBoundingClientRect();
      const cls = e.className || '';
      const st = window.getComputedStyle(e);
      return {
        cls: String(cls),
        dataPage: e.getAttribute('data-page'),
        dataPageNumber: e.getAttribute('data-page-number'),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        scaleVar: st.getPropertyValue('--scale-factor'),
        position: st.position,
        display: st.display,
      };
    });
  });
  console.log('[PROBE] scroller page boxes=' + JSON.stringify(dump, null, 2));

  // Also dump the text-layer of each of the first 3 slots for content.
  const texts = await win.evaluate(() => {
    const out = [];
    for (let i = 1; i <= 3; i++) {
      const s = document.querySelector(`.page-slot[data-page="${i}"]`);
      if (!s) { out.push({ page: i, mounted: false }); continue; }
      const layer = s.querySelector('.textLayer');
      let j = '';
      if (layer) layer.querySelectorAll('span').forEach((x) => { j += x.textContent || ''; });
      out.push({ page: i, text: j.replace(/[ \t\r\n]+/g, ' ').trim().slice(0, 60) });
    }
    return out;
  });
  console.log('[PROBE] page texts=' + JSON.stringify(texts, null, 2));

  await win.screenshot({ path: path.join(SHOTS, 'gt-item2-probe-scroll.png') });
  await hardClose(electronApp);
  win = null;
});
