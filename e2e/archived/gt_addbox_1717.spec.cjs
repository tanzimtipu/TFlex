// QA ground-truth reproduction (installed v1.7.17) — BUG 3.
//
// Add box -> place a text box -> commit. Then:
//   (1) Click the placed box to reopen the editor, MOVE the TOOLBOX to a new
//       position and confirm. Does the text BOX (content) move with the
//       toolbox, or stay at the original position?  (Operator: it sticks.)
//   (2) The operator wants moving the toolbox to move the CONTENT with it, and
//       a "Confirm" button to commit the new position after moving.
//   (3) Move the TEXTBOX (re-arm box tool, drag the box) -> confirm -> move it
//       AGAIN -> does the text/content update to the latest position, or stay
//       stuck at the previous position?
//
// We read the committed box surface rect (`[data-edit-box-id]` on `.edit-box`,
// NOT the toolbar) at every step and screenshot each stage.
// Launch only via e2e/lib/launch.cjs against the DEV build (historically: the packaged installed exe).

const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const path = require('node:path');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');

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
  await hardClose(electronApp);
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

// The committed box SURFACE rect (`.edit-box[data-edit-box-id]`, excluding the
// action-bar toolbar which shares the id but has `.edit-box-toolbar`).
async function boxRect(label) {
  const out = await win.evaluate(() => {
    const b = document.querySelector('.edit-box[data-edit-box-id]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const text = b.getAttribute('data-edit-box-text');
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text };
  });
  console.log(`[BOX|${label}] ${JSON.stringify(out)}`);
  return out;
}

async function readEditor(label) {
  const info = await win.evaluate(() => {
    const e = document.querySelector('.edit-inline-editor');
    if (!e) return { present: false };
    const ta = e.querySelector('[data-edit-textarea]');
    const r = e.getBoundingClientRect();
    return {
      present: true,
      mode: e.getAttribute('data-edit-editor'),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      textareaValue: ta ? ta.value : null,
    };
  });
  console.log(`[EDITOR|${label}] ${JSON.stringify(info)}`);
  return info;
}

async function scrollToPage1() {
  await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector('.page-slot[data-page="1"]');
    if (sc && slot) sc.scrollTop = slot.offsetTop - 10;
  });
  await win.waitForTimeout(1000);
}

// List visible confirm-ish buttons in the DOM (to check for a "Confirm" button).
async function confirmButtons(label) {
  const out = await win.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], [data-edit-confirm]'));
    return buttons.map((b) => ({
      aria: b.getAttribute('aria-label'),
      title: b.getAttribute('title'),
      cls: b.className && b.className.toString().slice(0, 60),
      text: (b.textContent || '').trim().slice(0, 30),
    })).filter((b) => b.aria || b.title || b.text);
  });
  console.log(`[CONFIRM|${label}] ${JSON.stringify(out)}`);
  return out;
}

test('BUG3: add-box -> move toolbox/confirm -> content sticks? -> move box again -> content updates?', async () => {
  await openSampleFromCard('report.pdf');
  await scrollToPage1();

  // Enter Edit mode + Add box tool.
  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);

  // Place a text box on page 1.
  const slot1 = win.locator('.page-slot[data-page="1"]').first();
  await slot1.waitFor({ timeout: 15000 });
  const slotRect = await slot1.boundingBox();
  const px = slotRect.x + slotRect.width * 0.28;
  const py = slotRect.y + 250;
  await win.mouse.move(px, py);
  await win.mouse.down();
  await win.mouse.move(px + 150, py + 90, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(800);

  const ta = win.locator('[data-edit-textarea]').first();
  await ta.waitFor({ timeout: 10000 });
  await ta.fill('MOVE TEST 88');
  await win.waitForTimeout(300);
  await shot('gt-bug3-1717-add-box-typed.png');
  await win.click('[aria-label="Apply edit"]');
  await win.waitForTimeout(1200);

  const R0 = await boxRect('COMMITTED-R0');
  console.log(`[BUG3|R0] box committed at ${JSON.stringify(R0)}`);
  await shot('gt-bug3-1717-committed.png');
  expect(R0, 'committed box must exist').toBeTruthy();

  // --- (1) Click the placed box to reopen the editor ----------------------
  await win.mouse.click(R0.x + R0.w / 2, R0.y + R0.h / 2);
  await win.waitForTimeout(700);
  const editorOpen = await readEditor('REOPENED');
  await shot('gt-bug3-1717-editor-reopened.png');
  console.log(`[BUG3|REOPEN] editor rect=${JSON.stringify(editorOpen.rect)} text="${editorOpen.textareaValue}"`);

  // --- Move the TOOLBOX (drag its chrome) and confirm ---------------------
  const bar = await win.evaluate(() => {
    const e = document.querySelector('.edit-inline-editor');
    const b = e && e.querySelector('[data-edit-drag-handle]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  console.log(`[BUG3|DRAGBAR] ${JSON.stringify(bar)}`);
  let toolboxDx = 0, toolboxDy = 0;
  if (bar) {
    const gx = bar.x + 5;
    const gy = bar.y + 5;
    await win.mouse.move(gx, gy);
    await win.mouse.down();
    await win.mouse.move(gx + 200, gy + 120, { steps: 12 });
    await win.mouse.up();
    await win.waitForTimeout(400);
    const afterMove = await readEditor('AFTER-TOOLBOX-MOVE');
    toolboxDx = afterMove.rect.x - editorOpen.rect.x;
    toolboxDy = afterMove.rect.y - editorOpen.rect.y;
    console.log(`[BUG3|TOOLBOX-MOVED] dx=${toolboxDx} dy=${toolboxDy}`);
    await shot('gt-bug3-1717-editor-toolbox-moved.png');

    // Confirm the editor (Ctrl+Enter / Apply).
    const ta2 = win.locator('[data-edit-textarea]').first();
    await ta2.click();
    await win.keyboard.press('Control+Enter');
    await win.waitForTimeout(1200);
  }
  const R1 = await boxRect('AFTER-TOOLBOX-MOVE-CONFIRM');
  console.log(`[BUG3|AFTER-TOOLBOX] box rect=${JSON.stringify(R1)} (R0=${JSON.stringify(R0)})`);
  const boxMovedWithToolbox = R1 && R0 && (Math.abs(R1.x - (R0.x + toolboxDx)) < 20 && Math.abs(R1.y - (R0.y + toolboxDy)) < 20);
  const boxStayedAtOriginal = R1 && R0 && (Math.abs(R1.x - R0.x) < 8 && Math.abs(R1.y - R0.y) < 8);
  console.log(`[BUG3|VERDICT-1] boxMovedWithToolbox=${boxMovedWithToolbox} boxStayedAtOriginal=${boxStayedAtOriginal}`);
  await shot('gt-bug3-1717-after-toolbox-move-confirm.png');

  // Did the editor leave a "Confirm" button in the DOM?
  await confirmButtons('AFTER-TOOLBOX-MOVE-CONFIRM');

  // --- (3) Move the TEXTBOX itself (re-arm box tool, drag the box) ---------
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);
  // The box may now sit at R0 (original) since the toolbox moves the editor
  // window only. Grab the box center and drag it.
  const grab = await boxRect('BEFORE-BOX-DRAG');
  const gx2 = grab.x + grab.w / 2;
  const gy2 = grab.y + grab.h / 2;
  await win.mouse.move(gx2, gy2);
  await win.mouse.down();
  await win.mouse.move(gx2 + 150, gy2 + 100, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(500);
  await shot('gt-bug3-1717-box-dragged-1.png');
  await win.keyboard.press('Control+Enter');
  await win.waitForTimeout(1200);
  const R2 = await boxRect('AFTER-BOX-MOVE-1');
  console.log(`[BUG3|MOVE-1] box rect=${JSON.stringify(R2)}`);
  await shot('gt-bug3-1717-box-move-1-confirm.png');

  // Move the box AGAIN.
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);
  const grab2 = await boxRect('BEFORE-BOX-DRAG-2');
  const gx3 = grab2.x + grab2.w / 2;
  const gy3 = grab2.y + grab2.h / 2;
  await win.mouse.move(gx3, gy3);
  await win.mouse.down();
  await win.mouse.move(gx3 + 80, gy3 + 60, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(500);
  await shot('gt-bug3-1717-box-dragged-2.png');
  await win.keyboard.press('Control+Enter');
  await win.waitForTimeout(1200);
  const R3 = await boxRect('AFTER-BOX-MOVE-2');
  console.log(`[BUG3|MOVE-2] box rect=${JSON.stringify(R3)} (R2=${JSON.stringify(R2)})`);
  await shot('gt-bug3-1717-box-move-2-confirm.png');

  const textUpdatedOnMove2 = R3 && R2 && (Math.abs(R3.x - R2.x) >= 40 || Math.abs(R3.y - R2.y) >= 30);
  console.log(`[BUG3|VERDICT-3] boxMovedOn2ndDrag textUpdated=${textUpdatedOnMove2} (R2.R3=${JSON.stringify(R2)}->${JSON.stringify(R3)})`);

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  console.log(`[BUG3] pageErrors=${JSON.stringify(pageErrors)}`);
  expect(bad, 'no unhandled page-request / React-hook / NaN errors').toHaveLength(0);
});
