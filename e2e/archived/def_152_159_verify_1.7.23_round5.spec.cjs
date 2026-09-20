// QA verification round 5: remaining DEF-153(d) grip labels — note editor and
// add-box inline editor (the exact flows that opened them in round 2).
// Launch only via e2e/lib/launch.cjs. Real mouse events only.

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test.setTimeout(300000);

let electronApp = null;
let win = null;
const pageErrors = [];

test.beforeEach(async () => {
  electronApp = await launchApp([]);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  win.on('pageerror', (err) => {
    const m = err && err.message ? err.message : String(err);
    pageErrors.push(m);
    process.stdout.write(`[PAGEERROR] ${m}\n`);
  });
  await win.waitForTimeout(700);
});

test.afterEach(async () => {
  await hardClose(electronApp);
  electronApp = null;
  win = null;
});

async function shot(name) {
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p });
  process.stdout.write(`[SHOT] ${name}\n`);
  return p;
}

async function noPageErrors(label) {
  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  process.stdout.write(`[PAGEERRORS|${label}] ${JSON.stringify(pageErrors)}\n`);
  expect(bad, 'no pageerrors').toHaveLength(0);
}

async function editorGrips(label) {
  const g = await win.evaluate(() => {
    const out = [];
    for (const ed of document.querySelectorAll('[data-annotation-editor], .edit-inline-editor, .ann-note-editor')) {
      const kind = ed.getAttribute('data-annotation-editor') || 'edit-inline';
      const grips = [];
      for (const gEl of ed.querySelectorAll('[data-annotation-editor-handle], .ann-textbox-grip, .ann-textbox-grip-label, [class*="grip"], [class*="drag-handle"], [data-edit-drag-handle]')) {
        const r = gEl.getBoundingClientRect();
        const s = gEl.className && gEl.className.baseVal !== undefined ? gEl.className.baseVal : gEl.className;
        grips.push({
          cls: String(s || '').split(' ').filter(Boolean).slice(0, 3).join('.'),
          handle: gEl.getAttribute('data-annotation-editor-handle') || gEl.getAttribute('data-edit-drag-handle'),
          text: (gEl.textContent || '').trim().slice(0, 30) || null,
          w: Math.round(r.width), h: Math.round(r.height),
        });
      }
      const r = ed.getBoundingClientRect();
      out.push({ kind, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, grips });
    }
    return out;
  });
  process.stdout.write(`[RES|GRIPS|${label}] ${JSON.stringify(g)}\n`);
  return g;
}

test('T5: note editor + add-box inline editor grip labels', async () => {
  await win.locator('.sample-card:has-text("report.pdf")').first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2200);
  await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector('.page-slot[data-page="4"]');
    if (sc && slot) sc.scrollTop = slot.offsetTop - 10;
  });
  await win.waitForTimeout(1500);
  const pr = await win.evaluate(() => {
    const page = document.querySelector('.page-slot[data-page="4"] .pdf-page');
    const r = page.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  expect(pr).toBeTruthy();

  // select first (the working round-2 flow), then note
  await win.click('[data-annotation-toolbar] [data-tool="select"]');
  await win.waitForTimeout(300);
  await win.click('[data-annotation-toolbar] [data-tool="note"]');
  await win.waitForTimeout(400);
  await win.mouse.click(pr.x + pr.w * 0.53, pr.y + pr.h * 0.34);
  await win.waitForTimeout(700);
  let opened = await win.evaluate(() => !!document.querySelector('[data-annotation-editor="note"]'));
  if (!opened) {
    process.stdout.write('[DIAG] note editor not open; retry click +40/+40\n');
    await win.mouse.click(pr.x + pr.w * 0.53 + 40, pr.y + pr.h * 0.34 + 40);
    await win.waitForTimeout(900);
    opened = await win.evaluate(() => !!document.querySelector('[data-annotation-editor="note"]'));
  }
  process.stdout.write(`[RES|NOTE-EDITOR-OPEN] ${opened}\n`);
  await shot('def-153-1723e-note-editor.png');
  if (opened) await editorGrips('note-editor');

  // close via Cancel
  const cancelNote = await win.evaluate(() => {
    for (const b of document.querySelectorAll('[data-annotation-editor="note"] button')) {
      if (/cancel/i.test(b.textContent || '')) {
        const r = b.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
    }
    return null;
  });
  if (cancelNote) await win.mouse.click(cancelNote.x, cancelNote.y);
  await win.waitForTimeout(500);

  // add-box inline editor (page 1)
  await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector('.page-slot[data-page="1"]');
    if (sc && slot) sc.scrollTop = slot.offsetTop - 10;
  });
  await win.waitForTimeout(1200);
  const pr1 = await win.evaluate(() => {
    const page = document.querySelector('.page-slot[data-page="1"] .pdf-page');
    const r = page.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);
  await win.mouse.move(pr1.x + pr1.w * 0.16, pr1.y + pr1.h * 0.14);
  await win.mouse.down();
  await win.mouse.move(pr1.x + pr1.w * 0.16 + 150, pr1.y + pr1.h * 0.14 + 90, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(700);
  await win.locator('[data-edit-textarea]').first().waitFor({ timeout: 8000 });
  await editorGrips('addbox-inline');
  await shot('def-153-1723e-addbox-editor.png');

  await noPageErrors('T5');
});
