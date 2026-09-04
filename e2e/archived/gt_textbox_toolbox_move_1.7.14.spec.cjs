// QA ground-truth reproduction (installed v1.7.14) — items 6, 7, 8.
//
// 6. Dragging a TEXTBOX (Add box in edit mode) keeps a copy of the text at its
//    ORIGINAL position until the mouse button is released.
// 7. Moving the TOOLBOX (the DEF-140-draggable floating inline editor) does NOT
//    move the text with it — the toolbox moves but the text/content stays.
// 8. After moving a textbox to another position AND confirming, an artifact
//    appears on screen.
//
// Launch only via e2e/lib/launch.cjs against the DEV build (historically: the packaged installed exe).

const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp } = require('../lib/launch.cjs');
const path = require('node:path');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test.setTimeout(300000);

let electronApp = null;
let win = null;
let pageErrors = [];

test.beforeEach(async () => {
  electronApp = await launchApp([]);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  pageErrors = [];
  win.on('pageerror', (err) => {
    const m = err && err.message ? err.message : String(err);
    pageErrors.push(m);
    process.stdout.write(`[PAGEERROR] ${m}\n`);
  });
  await win.waitForTimeout(700);
});

test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null;
  win = null;
  pageErrors = [];
});

async function shot(name) {
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p });
  console.log(`[SHOT] ${name}`);
  return p;
}

async function openSampleFromCard(name) {
  await win.locator(`.sample-card:has-text("${name}")`).first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2200);
}

// Read a selector's viewport rect (mono box) or null.
async function rectOf(selector, index = 0) {
  return win.evaluate(([sel, idx]) => {
    const els = document.querySelectorAll(sel);
    const e = els[idx];
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  }, [selector, index]);
}

// Count of a selector.
async function countOf(selector) {
  return win.evaluate((sel) => document.querySelectorAll(sel).length, selector);
}

// Count committed text box surfaces and their text-mirror text contents.
async function boxSnapshot(label) {
  const out = await win.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll('[data-edit-box-id]'));
    const mirrors = Array.from(document.querySelectorAll('[data-edit-box-text-mirror]'));
    return {
      boxCount: boxes.length,
      boxRects: boxes.map((b) => {
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      }),
      mirrorCount: mirrors.length,
      mirrorTexts: mirrors.map((m) => (m.textContent || '').trim().slice(0, 30)),
      mirrorRects: mirrors.map((m) => {
        const r = m.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      }),
    };
  });
  console.log(`[BOX|${label}] ${JSON.stringify(out)}`);
  return out;
}

// Text-layer text of page 1 (to detect a stale text copy / a leftover string).
async function page1Text() {
  return win.evaluate(() => {
    const p = document.querySelector('.page-slot[data-page="1"]');
    if (!p) return { present: false };
    const layer = p.querySelector('.textLayer');
    let joined = '';
    if (layer) layer.querySelectorAll('span').forEach((s) => { joined += s.textContent || ''; });
    return { present: true, text: (joined || '').replace(/[ \t\r\n]+/g, ' ').trim() };
  });
}

// ---- Item 6: dragging a TEXTBOX keeps a stale text copy at its origin -------
test('Item 6: dragging the committed Add-box textbox keeps a stale text copy at its origin until mouseup', async () => {
  await openSampleFromCard('report.pdf');

  // Edit mode -> Add box tool.
  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);

  // Place a box on page 1 within the visible viewport.
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
  await ta.fill('STALE CHECK BOX');
  await win.waitForTimeout(300);

  // Commit the box (Ctrl+Enter).
  await win.keyboard.press('Control+Enter');
  await win.waitForTimeout(800);
  await shot('gt-item6-after-commit.png');

  const committed = await boxSnapshot('COMMITTED');
  expect(committed.boxCount, 'a committed box must exist').toBeGreaterThanOrEqual(1);

  // Re-arm the box tool so the committed box is draggable.
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);

  // Drag the committed box to a NEW position. Keep the mouse button HELD and
  // sample mid-drag (before release) to see whether the text copy stays at the
  // original position.
  const boxBefore = committed.boxRects[0];
  const grabX = boxBefore.x + boxBefore.w / 2;
  const grabY = boxBefore.y + boxBefore.h / 2;
  await win.mouse.move(grabX, grabY);
  await win.mouse.down();
  await win.mouse.move(grabX + 180, grabY + 120, { steps: 12 });
  await win.waitForTimeout(250);

  const midDrag = await boxSnapshot('MID-DRAG');
  await shot('gt-item6-middrag.png');

  await win.mouse.up();
  await win.waitForTimeout(600);
  const afterDrag = await boxSnapshot('AFTER-DRAG');
  await shot('gt-item6-after-drag.png');

  // --- Diagnostic comparison ------------------------------------------------
  const beforeText = (committed.mirrorTexts || []).join('|');
  const midTexts = midDrag.mirrorTexts.join('|');
  const afterTexts = afterDrag.mirrorTexts.join('|');
  const oldRect = committed.mirrorRects[0];
  const midRect = midDrag.mirrorRects[0];
  console.log(`[ITEM6] mirrorTexts before="${beforeText}" mid="${midTexts}" after="${afterTexts}"`);
  console.log(`[ITEM6] mirrorRect before=${JSON.stringify(oldRect)} mid=${JSON.stringify(midRect)}`);
  console.log(`[ITEM6] mirror moved by dx=${midRect && oldRect ? Math.round(midRect.x - oldRect.x) : 'n/a'} dy=${midRect && oldRect ? Math.round(midRect.y - oldRect.y) : 'n/a'}`);

  // Evidence only: log whether during the drag the text mirror is STILL at the
  // original position (stale copy) or has traveled to the new position.
  const staleCopyMid = midRect && oldRect && Math.abs(midRect.x - oldRect.x) < 5 && Math.abs(midRect.y - oldRect.y) < 5;
  console.log(`[ITEM6] STALE-AT-ORIGIN-MID-DRAG=${staleCopyMid} (true = text did not move while box surface dragged)`);
  const p1 = await page1Text();
  console.log(`[ITEM6] page1 textLayer contains stale copy? ${/STALE CHECK BOX/i.test(p1.text || '')}`);

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  expect(bad, 'no unhandled page-request / React-hook / NaN errors').toHaveLength(0);
});

// ---- Item 7: moving the TOOLBOX does not move the text with it --------------
test('Item 7: moving the DEF-140-draggable toolbox does not move the text with it', async () => {
  await openSampleFromCard('report.pdf');

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
  await ta.fill('TOOLBOX CARRIES ME');
  await win.waitForTimeout(300);
  await win.click('[aria-label="Apply edit"]');
  await win.waitForTimeout(800);

  const boxEl = win.locator('[data-edit-box-id]').first();
  const boxRect = await boxEl.boundingBox();
  const bx = boxRect.x + boxRect.width / 2;
  const by = boxRect.y + boxRect.height / 2;
  await win.mouse.click(bx, by);
  await win.waitForTimeout(800);

  // The toolbox (inline editor) must be open.
  const before = await rectOf('.edit-inline-editor', 0);
  console.log(`[ITEM7] toolbox before=${JSON.stringify(before)}`);
  expect(before, 'clicking the committed box must open the toolbox').toBeTruthy();

  // Grab the toolbox toolbar chrome (non-control) and drag 200/140.
  const tb = await rectOf('[data-edit-drag-handle]', 0);
  console.log(`[ITEM7] drag handle rect=${JSON.stringify(tb)}`);
  const grabX = tb.x + 8;
  const grabY = tb.y + 8;
  await win.mouse.move(grabX, grabY);
  await win.mouse.down();
  await win.mouse.move(grabX + 200, grabY + 140, { steps: 12 });
  await win.waitForTimeout(250);

  // Toolbox container rect + the TEXTAREA/text rect inside it, mid-drag.
  const midData = await win.evaluate(() => {
    const tbEl = document.querySelector('.edit-inline-editor');
    if (!tbEl) return { present: false };
    const tr = tbEl.getBoundingClientRect();
    const taEl = tbEl.querySelector('textarea, [data-edit-textarea]');
    const tr2 = taEl ? taEl.getBoundingClientRect() : null;
    const mirror = tbEl.querySelector('[data-edit-textarea]');
    return {
      present: true,
      toolbox: { x: Math.round(tr.x), y: Math.round(tr.y), w: Math.round(tr.width), h: Math.round(tr.height) },
      textarea: tr2 ? { x: Math.round(tr2.x), y: Math.round(tr2.y), w: Math.round(tr2.width), h: Math.round(tr2.height) } : null,
    };
  });
  console.log(`[ITEM7] MID-DRAG=${JSON.stringify(midData)}`);
  await shot('gt-item7-middrag.png');

  await win.mouse.up();
  await win.waitForTimeout(600);
  const afterData = await win.evaluate(() => {
    const tbEl = document.querySelector('.edit-inline-editor');
    if (!tbEl) return { present: false };
    const tr = tbEl.getBoundingClientRect();
    const taEl = tbEl.querySelector('textarea, [data-edit-textarea]');
    const tr2 = taEl ? taEl.getBoundingClientRect() : null;
    return {
      present: true,
      toolbox: { x: Math.round(tr.x), y: Math.round(tr.y), w: Math.round(tr.width), h: Math.round(tr.height) },
      textarea: tr2 ? { x: Math.round(tr2.x), y: Math.round(tr2.y), w: Math.round(tr2.width), h: Math.round(tr2.height) } : null,
    };
  });
  console.log(`[ITEM7] AFTER-DRAG=${JSON.stringify(afterData)}`);
  await shot('gt-item7-after-drag.png');

  const boxAfter = await rectOf('[data-edit-box-id]', 0);
  console.log(`[ITEM7] committed box on page after toolbox drag=${JSON.stringify(boxAfter)}`);

  const tbMovedDx = afterData.present ? Math.round(afterData.toolbox.x - before.x) : 'n/a';
  const tbMovedDy = afterData.present ? Math.round(afterData.toolbox.y - before.y) : 'n/a';
  const taMovedDx = afterData.present && afterData.textarea ? Math.round(afterData.textarea.x - (midData.textarea ? midData.textarea.x : afterData.textarea.x)) : 'n/a';
  console.log(`[ITEM7] toolbox moved by dx=${tbMovedDx} dy=${tbMovedDy} (drag was +200/+140)`);
  console.log(`[ITEM7] textarea moved relative to toolbox start: dx=${taMovedDx}`);

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  expect(bad, 'no unhandled page-request / React-hook / NaN errors').toHaveLength(0);
});

// ---- Item 8: after moving a textbox to another position AND confirming, an artifact appears
test('Item 8: after moving a textbox to another position and confirming, an artifact appears', async () => {
  await openSampleFromCard('report.pdf');

  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);

  // Place the box OUT toward the right so the move target stays on-screen.
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
  await win.waitForTimeout(800);
  await shot('gt-item8-after-commit.png');

  // Re-arm the box tool and drag the box to a NEW position.
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);

  const boxBefore = await rectOf('[data-edit-box-id]', 0);
  const grabX = boxBefore.x + boxBefore.w / 2;
  const grabY = boxBefore.y + boxBefore.h / 2;
  await win.mouse.move(grabX, grabY);
  await win.mouse.down();
  await win.mouse.move(grabX + 170, grabY + 110, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(500);

  const boxAfterDrag = await rectOf('[data-edit-box-id]', 0);
  console.log(`[ITEM8] box before=${JSON.stringify(boxBefore)} afterDrag=${JSON.stringify(boxAfterDrag)}`);

  // Confirm the move (Ctrl+Enter).
  await win.keyboard.press('Control+Enter');
  await win.waitForTimeout(900);
  await shot('gt-item8-after-confirm.png');

  // Look for artifacts: stray box surfaces, stale text-mirrors, white masking
  // rects, leftover ghost texts on page 1.
  const artifact = await win.evaluate(() => {
    const p = document.querySelector('.page-slot[data-page="1"]');
    const boxes = p ? p.querySelectorAll('[data-edit-box-id]').length : 0;
    const mirrors = p ? p.querySelectorAll('[data-edit-box-text-mirror]').length : 0;
    const layer = p ? p.querySelector('.textLayer') : null;
    let joined = '';
    if (layer) layer.querySelectorAll('span').forEach((s) => { joined += s.textContent || ''; });
    const text = (joined || '').replace(/[ \t\r\n]+/g, ' ').trim();
    // Detect a white/masked rectangle (a full-white canvas patch) is hard; look
    // for duplicated text (the box string still present at the OLD location).
    return {
      boxCount: boxes,
      mirrorCount: mirrors,
      hasBoxText: /ARTIFACT CHECK 88/.test(text),
      boxTextOccurrences: (text.match(/ARTIFACT CHECK 88/g) || []).length,
      page1Snippet: text.slice(0, 120),
    };
  });
  console.log(`[ITEM8] artifact scan=${JSON.stringify(artifact)}`);
  console.log(`[ITEM8] box after confirm=${JSON.stringify(await rectOf('[data-edit-box-id]', 0))}`);

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  expect(bad, 'no unhandled page-request / React-hook / NaN errors').toHaveLength(0);
});
