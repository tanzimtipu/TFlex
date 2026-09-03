// QA reproduction probe (items 1 + 4) — installed v1.7.22:
//   1. Add-box: drag to move, release -> which action bar appears under the
//      box? (operator: only Edit + Delete, missing Confirm)
//   4. Stale artifact at the original rect after drag-release.
//
// Launch only via e2e/lib/launch.cjs (launchApp) against the packaged exe.
// Real mouse events only; cursors verified via elementFromPoint + computed
// styles (exactly what the user sees).

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

async function setTheme(want) {
  for (let i = 0; i < 5; i++) {
    const cur = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (cur === want) return;
    await win.click('.theme-toggle');
    await win.waitForTimeout(500);
  }
}

async function cursorAt(x, y) {
  return await win.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    if (!el) return { cursor: null, hit: null };
    let cur = el;
    let cursor = 'auto';
    for (let i = 0; i < 14 && cur; i++) {
      const c = getComputedStyle(cur).cursor;
      if (c && c !== 'auto') { cursor = c; break; }
      cur = cur.parentElement;
    }
    const cls = (e) => {
      const s = e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className;
      return String(s || '').split(' ').filter(Boolean).slice(0, 3).join('.');
    };
    const kindEl = el.closest('[data-annotation-id], [data-edit-box-id], .annotation-layer, .edit-layer, .textLayer');
    return {
      cursor,
      hit: `${el.tagName.toLowerCase()}.${cls(el)}`,
      hitKind: kindEl
        ? (kindEl.getAttribute('data-kind')
          || (kindEl.hasAttribute('data-annotation-id') ? 'annotation-svg' : null)
          || kindEl.getAttribute('data-annotation-layer')
          || (kindEl.hasAttribute('data-edit-box-id') ? 'edit-box' : null)
          || kindEl.getAttribute('data-tool'))
        : null,
      hitPointerEvents: getComputedStyle(el).pointerEvents,
    };
  }, [x, y]);
}

async function probeBars(label) {
  const out = await win.evaluate(() => {
    const sels = [
      '.edit-box-toolbar', '.edit-inline-editor', '.edit-image-toolbar',
      '.sig-action-bar', '.ann-editor', '[data-annotation-action-bar]',
      '[data-annotation-editor]', '.ann-textbox-wrap',
    ];
    const seen = [];
    const idset = new Set();
    for (const sel of sels) {
      for (const c of document.querySelectorAll(sel)) {
        if (idset.has(c)) continue;
        idset.add(c);
        const buttons = Array.from(c.querySelectorAll('button')).map((b) => ({
          text: (b.textContent || '').trim(),
          aria: b.getAttribute('aria-label'),
          dataAction: b.getAttribute('data-edit-box-action')
            || b.getAttribute('data-edit-action')
            || b.getAttribute('data-annotation-action')
            || null,
          dataConfirm: b.getAttribute('data-edit-confirm'),
        }));
        seen.push({
          sel,
          editorKind: c.getAttribute('data-annotation-editor')
            || c.getAttribute('data-annotation-editor-wrap') || null,
          gripLabel: (c.querySelector('.ann-textbox-grip-label') || {}).textContent || null,
          buttons,
        });
      }
    }
    return seen;
  });
  process.stdout.write(`[BARS|${label}] ${JSON.stringify(out)}\n`);
  return out;
}

test('A. add-box: drag/release action bar + stale artifact (light)', async () => {
  await setTheme('light');
  await openSampleFromCard('report.pdf');
  await scrollToPage(1);
  const pr = await pageRect(1);
  expect(pr, 'page 1 must be mounted').toBeTruthy();

  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);

  // Place a box 150x90 at (16% w, 14% h) of page 1.
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
  await win.waitForTimeout(1600);

  const boxBefore = await win.evaluate(() => {
    const b = document.querySelector('.edit-box[data-edit-box-id]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  expect(boxBefore, 'committed .edit-box must exist').toBeTruthy();
  process.stdout.write(`[BOX-R0] ${JSON.stringify(boxBefore)}\n`);
  await shot('def-152-a-committed.png');

  // Drag the box BODY +200/+120 and release (real mouse).
  const start = { x: boxBefore.x + boxBefore.w / 2, y: boxBefore.y + boxBefore.h / 2 };
  await win.mouse.move(start.x, start.y);
  await win.mouse.down();
  await win.mouse.move(start.x + 200, start.y + 120, { steps: 12 });
  const eraserDuringDrag = await win.evaluate(() => !!document.querySelector('[data-edit-box-eraser]'));
  process.stdout.write(`[RES|ERASER-DURING-DRAG] ${eraserDuringDrag}\n`);
  await shot('def-155-a-mid-drag.png');
  await win.mouse.up();
  await win.waitForTimeout(80);
  await shot('def-155-a-after-release-80ms.png');
  await win.waitForTimeout(520);
  await shot('def-155-a-after-release-600ms.png');
  await win.waitForTimeout(1000);
  await shot('def-155-a-after-release-1600ms.png');

  const boxAfter = await win.evaluate(() => {
    const b = document.querySelector('.edit-box[data-edit-box-id]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  process.stdout.write(`[RES|BOX-MOVE] R0=${JSON.stringify(boxBefore)} R1=${JSON.stringify(boxAfter)} delta=${
    boxAfter && boxBefore
      ? JSON.stringify({ dx: Math.round(boxAfter.x - boxBefore.x), dy: Math.round(boxAfter.y - boxBefore.y) })
      : null
  }\n`);

  // ITEM 1: which action bar appears under the moved box after release?
  const bars = await probeBars('AFTER-DRAG-RELEASE');
  const boxBar = bars.find((b) => b.sel === '.edit-box-toolbar');
  const hasConfirm = bars.some((b) => b.buttons.some((bt) => /confirm/i.test(bt.text || '') || bt.dataConfirm === 'true'));
  process.stdout.write(`[RES|ITEM1] boxToolbarPresent=${!!boxBar} boxToolbarButtons=${JSON.stringify(boxBar ? boxBar.buttons : null)} confirmAnywhere=${hasConfirm}\n`);
  await shot('def-152-a-actionbar-after-release.png');
  if (boxAfter) {
    await win.screenshot({
      path: path.join(SHOTS, 'def-152-a-actionbar-crop.png'),
      clip: {
        x: Math.max(0, boxAfter.x - 24),
        y: Math.max(0, boxAfter.y - 24),
        width: Math.min(boxAfter.w + 300, 1000),
        height: Math.min(boxAfter.h + 150, 540),
      },
    });
    process.stdout.write('[CROP] def-152-a-actionbar-crop.png\n');
  }
  expect(boxBar, 'a box action bar should appear under the moved box').toBeTruthy();

  // Hover cursor over the committed box body (item 2, add-box row).
  const cx = boxAfter.x + boxAfter.w / 2;
  const cy = boxAfter.y + boxAfter.h / 2;
  await win.mouse.move(cx, cy);
  await win.waitForTimeout(150);
  const hover = await cursorAt(cx, cy);
  process.stdout.write(`[RES|ADDBOX-HOVER] ${JSON.stringify(hover)}\n`);

  // Double-click probe on the box body (item 2).
  await win.mouse.dblclick(cx, cy);
  await win.waitForTimeout(700);
  const afterDbl = await probeBars('ADDBOX-DBLCLICK');
  process.stdout.write(`[RES|ADDBOX-DBLCLICK] ${JSON.stringify(afterDbl.map((b) => ({
    sel: b.sel, editorKind: b.editorKind, grip: b.gripLabel, btns: b.buttons.map((x) => x.text),
  })))}\n`);
  await shot('def-153-a-addbox-dblclick.png');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(400);

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  process.stdout.write(`[PAGEERRORS|A] ${JSON.stringify(pageErrors)}\n`);
  expect(bad, 'no pageerrors').toHaveLength(0);
});
