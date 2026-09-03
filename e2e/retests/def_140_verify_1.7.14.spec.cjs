// QA retest for DEF-140 on the freshly installed v1.7.14 binary.
//
// DEF-140: the floating Edit-mode TOOLBOX (inline editor window) cannot be
// dragged/moved -- it stays stuck over the text box and page content.
//
// Repro (operator-exact, reproduced on installed v1.7.13):
//   Add box -> place a text box -> confirm -> click the placed box once to open
//   the floating toolbox (Font/Size/Color chrome + textarea) -> HOLD and DRAG
//   the toolbox header chrome with the mouse -> the toolbox must follow the
//   cursor and move to a new position.
//
// On v1.7.14 the fix is present in EditInlineEditor: the `.edit-inline-toolbar`
// row is a drag handle ([data-edit-drag-handle]); a pointerdown on its CHROME
// (padding / label / gap -- NOT a control) records the pointer + rect, and a
// window pointermove repositions the window via a dragOffset state applied on
// top of the anchored left/top, clamped to the viewport. pointerup ends the drag.
//
// Launch only via e2e/lib/launch.cjs against the packaged installed exe.

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const path = require('node:path');

const EXE_PATH = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test.setTimeout(240000);

let electronApp = null;
let win = null;
let pageErrors = [];

test.beforeEach(async () => {
  electronApp = await launchApp([], null, EXE_PATH);
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
  if (electronApp) await electronApp.close().catch(() => {});
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

// Read the floating toolbox (.edit-inline-editor) viewport rect + mode.
async function readToolbox(label) {
  const info = await win.evaluate(() => {
    const e = document.querySelector('.edit-inline-editor');
    if (!e) return { present: false };
    const r = e.getBoundingClientRect();
    const mode = e.getAttribute('data-edit-editor');
    return {
      present: true,
      mode,
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
    };
  });
  console.log(`[TOOLBOX|${label}] ${JSON.stringify(info)}`);
  return info;
}

test('DEF-140: floating toolbox (inline editor) is draggable after a single click on a committed box', async () => {
  await openSampleFromCard('report.pdf');

  // --- Enter Edit mode, Add box tool --------------------------------------
  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);

  // --- Place a text box on page 1 (within the visible viewport) ------------
  const slot1 = win.locator('.page-slot[data-page="1"]').first();
  await slot1.waitFor({ timeout: 15000 });
  const slotRect = await slot1.boundingBox();
  console.log('[DEF140] page1 slot rect=', JSON.stringify(slotRect));
  const px = slotRect.x + slotRect.width * 0.35;
  const py = slotRect.y + 260; // safely inside the ~900px viewport top area
  await win.mouse.move(px, py);
  await win.mouse.down();
  await win.mouse.move(px + 130, py + 80, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(800);

  const editorAddOpen = await win.evaluate(() => !!document.querySelector('[data-edit-editor="box"]'));
  console.log('[DEF140] box editor open (add):', editorAddOpen);
  expect(editorAddOpen, 'the add-box inline editor must open after the drag').toBe(true);

  const ta = win.locator('[data-edit-textarea]').first();
  await ta.waitFor({ timeout: 10000 });
  await ta.fill('Movable toolbox test');
  await win.waitForTimeout(300);
  await shot('def-140-box-editor-add.png');

  // Confirm / commit the box.
  await win.click('[aria-label="Apply edit"]');
  await win.waitForTimeout(800);

  const committed = await win.locator('[data-edit-box-id]').count();
  console.log('[DEF140] committed box count=', committed);
  expect(committed, 'a committed text box must exist after Apply').toBeGreaterThanOrEqual(1);

  // --- Click the committed box once -> the floating toolbox opens ----------
  const boxEl = win.locator('[data-edit-box-id]').first();
  const boxRect = await boxEl.boundingBox();
  console.log('[DEF140] committed box rect=', JSON.stringify(boxRect));
  const bx = boxRect.x + boxRect.width / 2;
  const by = boxRect.y + boxRect.height / 2;
  await win.mouse.click(bx, by);
  await win.waitForTimeout(800);

  const before = await readToolbox('BEFORE-DRAG');
  expect(before.present, 'clicking the committed box once must open the floating toolbox').toBe(true);

  // Record the toolbar chrome rect so we can grab a NON-control point.
  const tb = await win.evaluate(() => {
    const e = document.querySelector('.edit-inline-editor');
    const bar = e && e.querySelector('[data-edit-drag-handle]');
    if (!bar) return null;
    const r = bar.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  console.log('[DEF140] toolbar chrome rect=', JSON.stringify(tb));
  expect(tb, 'the toolbox toolbar (drag handle) must exist').toBeTruthy();

  // --- HOLD + DRAG the toolbox header chrome -------------------------------
  // Grab a point in the toolbar's top-left PADDING (chrome, not a control).
  const grabX = tb.x + 5;
  const grabY = tb.y + 5;
  console.log(`[DEF140] grab chrome point=(${grabX},${grabY})`);
  await win.mouse.move(grabX, grabY);
  await win.mouse.down();
  // Move ~220px right / ~120px down, sampling mid-drag.
  await win.mouse.move(grabX + 220, grabY + 120, { steps: 12 });
  await win.waitForTimeout(220);

  const mid = await readToolbox('MID-DRAG');
  await shot('def-140-toolbox-middrag.png');

  await win.mouse.up();
  await win.waitForTimeout(700);

  const after = await readToolbox('AFTER-RELEASE');
  await shot('def-140-toolbox-after-release.png');

  // --- PASS / FAIL: the toolbox must have followed the cursor --------------
  const dxAfter = Math.round((after.present ? after.x : NaN) - before.x);
  const dyAfter = Math.round((after.present ? after.y : NaN) - before.y);
  console.log(`[DEF140] toolbox moved by dx=${dxAfter} dy=${dyAfter} (drag was +220/+120)`);
  console.log(`[DEF140] mid-drag delta dx=${mid.present ? Math.round(mid.x - before.x) : 'n/a'} dy=${mid.present ? Math.round(mid.y - before.y) : 'n/a'}`);

  // The toolbox must move WITH the cursor: assert a substantial, correct move.
  expect(after.present, 'the toolbox must still be present after the drag (it must not close)').toBe(true);
  expect(dxAfter, 'toolbox must have moved to the right by the drag amount').toBeGreaterThanOrEqual(120);
  expect(dyAfter, 'toolbox must have moved down by the drag amount').toBeGreaterThanOrEqual(60);

  // Mid-drag the toolbox should ALREADY be moving (the window follows the
  // cursor while the mouse button is still held, not only on release).
  if (mid.present) {
    expect(Math.round(mid.x - before.x), 'toolbox must move WHILE the button is held (mid-drag)').toBeGreaterThanOrEqual(60);
  }

  // --- Regression: no unhandled React/pdf.js errors during the flow --------
  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  expect(bad, 'no unhandled page-request / React-hook / NaN errors').toHaveLength(0);

  console.log('[DEF140] PASS — the floating toolbox follows the cursor and is repositionable. See def-140-*.png');
});
