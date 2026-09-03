// QA verification round 4 for DEF-152..159 on installed v1.7.23.
//   T4a: DEF-153(d) — "Drag to move" grip labels across all four floating
//        editors (textbox create, callout create, note editor, add-box inline).
//   T4b: DEF-155 — release-then-DESELECT (no Confirm): does the old rect turn
//        into a visible stale artifact when the eraser unmounts?
// Launch only via e2e/lib/launch.cjs. Real mouse events only.

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');

const EXE_PATH = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test.setTimeout(300000);

let electronApp = null;
let win = null;
const pageErrors = [];

test.beforeEach(async () => {
  electronApp = await launchApp([], null, EXE_PATH);
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

async function cropShot(name, rect) {
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p, clip: rect });
  process.stdout.write(`[CROP] ${name} ${JSON.stringify(rect)}\n`);
  return p;
}

async function openSampleFromCard(name) {
  await win.locator(`.sample-card:has-text("${name}")`).first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2200);
}

async function scrollToPage(n) {
  await win.evaluate((pg) => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector(`.page-slot[data-page="${pg}"]`);
    if (sc && slot) sc.scrollTop = slot.offsetTop - 10;
  }, n);
  await win.waitForTimeout(1200);
}

async function pageRect(n) {
  return await win.evaluate((pg) => {
    const page = document.querySelector(`.page-slot[data-page="${pg}"] .pdf-page`);
    const slot = document.querySelector(`.page-slot[data-page="${pg}"]`);
    const el = page || slot;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, n);
}

async function canvasDark(pageNum, rect) {
  return await win.evaluate(([pg, rc]) => {
    const canvas = document.querySelector(`.page-slot[data-page="${pg}"] .pdf-page canvas`);
    if (!canvas) return null;
    const cr = canvas.getBoundingClientRect();
    const sx = Math.max(0, Math.round((rc.x - cr.x) * (canvas.width / cr.width)));
    const sy = Math.max(0, Math.round((rc.y - cr.y) * (canvas.height / cr.height)));
    const sw = Math.max(1, Math.round(rc.w * (canvas.width / cr.width)));
    const sh = Math.max(1, Math.round(rc.h * (canvas.height / cr.height)));
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(sx, sy, Math.min(sw, canvas.width - sx), Math.min(sh, canvas.height - sy));
    let dark = 0;
    const total = img.data.length / 4;
    for (let i = 0; i < img.data.length; i += 4) {
      const l = 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
      if (l < 128) dark++;
    }
    return Math.round((dark / total) * 10000) / 10000;
  }, [pageNum, rect]);
}

async function noPageErrors(label) {
  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  process.stdout.write(`[PAGEERRORS|${label}] ${JSON.stringify(pageErrors)}\n`);
  expect(bad, 'no pageerrors').toHaveLength(0);
}

test('T4a DEF-153d: grip labels on all four editors', async () => {
  await openSampleFromCard('report.pdf');
  await scrollToPage(3);
  await win.waitForTimeout(800);
  const pr = await pageRect(3);
  expect(pr, 'page 3 must be mounted').toBeTruthy();

  async function editorGrips(label) {
    const g = await win.evaluate(() => {
      const out = [];
      for (const ed of document.querySelectorAll('[data-annotation-editor], .edit-inline-editor')) {
        const kind = ed.getAttribute('data-annotation-editor') || 'edit-inline';
        const grips = [];
        for (const gEl of ed.querySelectorAll('[data-annotation-editor-handle], .ann-textbox-grip, .ann-textbox-grip-label, [class*="grip"]')) {
          const r = gEl.getBoundingClientRect();
          const s = gEl.className && gEl.className.baseVal !== undefined ? gEl.className.baseVal : gEl.className;
          grips.push({
            cls: String(s || '').split(' ').filter(Boolean).slice(0, 3).join('.'),
            handle: gEl.getAttribute('data-annotation-editor-handle'),
            text: (gEl.textContent || '').trim().slice(0, 30) || null,
            w: Math.round(r.width),
          });
        }
        out.push({ kind, grips });
      }
      return out;
    });
    process.stdout.write(`[RES|GRIPS|${label}] ${JSON.stringify(g)}\n`);
    return g;
  }

  // textbox create editor
  await win.click('[data-annotation-toolbar] [data-tool="textbox"]');
  await win.waitForTimeout(350);
  await win.mouse.click(pr.x + pr.w * 0.5, pr.y + pr.h * 0.2);
  await win.waitForTimeout(600);
  await win.locator('[data-annotation-editor="textbox"]').waitFor({ timeout: 8000 });
  await editorGrips('textbox-create');
  await shot('def-153-1723d-textbox-editor.png');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(400);

  // callout create editor
  await win.click('[data-annotation-toolbar] [data-tool="callout"]');
  await win.waitForTimeout(350);
  await win.mouse.move(pr.x + pr.w * 0.15, pr.y + pr.h * 0.35);
  await win.mouse.down();
  await win.mouse.move(pr.x + pr.w * 0.33, pr.y + pr.h * 0.42, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(600);
  await win.locator('[data-annotation-editor="callout"]').waitFor({ timeout: 8000 });
  await editorGrips('callout-create');
  await shot('def-153-1723d-callout-editor.png');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(400);

  // note editor
  await win.click('[data-annotation-toolbar] [data-tool="note"]');
  await win.waitForTimeout(350);
  await win.mouse.click(pr.x + pr.w * 0.5, pr.y + pr.h * 0.55);
  await win.waitForTimeout(600);
  await win.locator('[data-annotation-editor="note"]').waitFor({ timeout: 8000 });
  await editorGrips('note-editor');
  await shot('def-153-1723d-note-editor.png');
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
  await win.waitForTimeout(400);

  // add-box inline editor (page 1)
  await scrollToPage(1);
  await win.waitForTimeout(600);
  const pr1 = await pageRect(1);
  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(300);
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(300);
  await win.mouse.move(pr1.x + pr1.w * 0.16, pr1.y + pr1.h * 0.14);
  await win.mouse.down();
  await win.mouse.move(pr1.x + pr1.w * 0.16 + 150, pr1.y + pr1.h * 0.14 + 90, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(700);
  await win.locator('[data-edit-textarea]').first().waitFor({ timeout: 8000 });
  await editorGrips('addbox-inline');
  await shot('def-153-1723d-addbox-editor.png');

  await noPageErrors('T4a');
});

test('T4b DEF-155: release then DESELECT without Confirm — stale visible?', async () => {
  await openSampleFromCard('report.pdf');
  await scrollToPage(1);
  await win.waitForTimeout(800);
  const pr = await pageRect(1);
  expect(pr, 'page 1 must be mounted').toBeTruthy();

  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);

  const p0 = { x: pr.x + pr.w * 0.16, y: pr.y + pr.h * 0.14 };
  await win.mouse.move(p0.x, p0.y);
  await win.mouse.down();
  await win.mouse.move(p0.x + 150, p0.y + 90, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(700);
  const ta = win.locator('[data-edit-textarea]').first();
  await ta.waitFor({ timeout: 10000 });
  await ta.fill('MOVE TEST 88');
  await win.waitForTimeout(250);
  await win.click('[aria-label="Apply edit"]');
  await win.waitForTimeout(1800);

  const R0 = await win.evaluate(() => {
    const b = document.querySelector('.edit-box[data-edit-box-id]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  expect(R0, 'committed box').toBeTruthy();

  // drag + release, then DESELECT (click blank) WITHOUT Confirm.
  const start = { x: R0.x + R0.w / 2, y: R0.y + R0.h / 2 };
  await win.mouse.move(start.x, start.y);
  await win.mouse.down();
  await win.mouse.move(start.x + 200, start.y + 120, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(300);
  await win.mouse.click(pr.x + pr.w * 0.5, pr.y + pr.h * 0.85);
  await win.waitForTimeout(1500);

  const state = await win.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll('.edit-box[data-edit-box-id]')).map((b) => {
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    const eraser = document.querySelector('[data-edit-box-eraser], .edit-box-eraser');
    const toolbar = document.querySelector('.edit-box-toolbar');
    return {
      boxes,
      eraser: eraser ? eraser.getBoundingClientRect() : null,
      barOpen: !!toolbar,
    };
  });
  const darkR0 = await canvasDark(1, { x: R0.x + 6, y: R0.y + 6, w: R0.w - 12, h: R0.h - 12 });
  const R1 = state.boxes[0] || null;
  const darkR1 = R1 ? await canvasDark(1, { x: R1.x + 6, y: R1.y + 6, w: R1.w - 12, h: R1.h - 12 }) : null;
  process.stdout.write(`[RES|DESELECT] boxes=${JSON.stringify(state.boxes)} barOpen=${state.barOpen} eraser=${JSON.stringify(state.eraser && { x: Math.round(state.eraser.x), y: Math.round(state.eraser.y), w: Math.round(state.eraser.width), h: Math.round(state.eraser.height) })} darkR0=${darkR0} darkR1=${darkR1}\n`);
  await shot('def-155-1723d-after-deselect.png');
  await cropShot('def-155-1723d-oldrect-crop.png', {
    x: Math.max(0, R0.x - 40), y: Math.max(0, R0.y - 40),
    width: Math.min(R0.w + 120, 600), height: Math.min(R0.h + 120, 420),
  });

  // Second sample after a forced re-render (scroll away + back) — if the
  // deselected move never baked, the stale R0 text reappears here.
  await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector('.page-slot[data-page="3"]');
    if (sc && slot) sc.scrollTop = slot.offsetTop - 10;
  });
  await win.waitForTimeout(1000);
  await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector('.page-slot[data-page="1"]');
    if (sc && slot) sc.scrollTop = slot.offsetTop - 10;
  });
  await win.waitForTimeout(1500);
  const darkR0b = await canvasDark(1, { x: R0.x + 6, y: R0.y + 6, w: R0.w - 12, h: R0.h - 12 });
  const state2 = await win.evaluate(() => ({
    boxes: Array.from(document.querySelectorAll('.edit-box[data-edit-box-id]')).map((b) => {
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y) };
    }),
  }));
  process.stdout.write(`[RES|RERENDER-AFTER-DESELECT] darkR0=${darkR0b} boxes=${JSON.stringify(state2.boxes)}\n`);
  await shot('def-155-1723d-after-rerender.png');

  await noPageErrors('T4b');
});
