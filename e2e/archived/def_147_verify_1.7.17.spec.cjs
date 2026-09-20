// QA verification (freshly installed v1.7.17) — DEF-147.
//
// The operator's stated intent: "every toolbox movable with its content", so
// EVERY floating window must follow the cursor WHILE the mouse button is held
// (mid-drag), not only on release — parity with the DEF-140 Edit-mode toolbox.
//
// On v1.7.16 four of six were movable; the signature pending action bar and the
// textbox editor wrapper were still STUCK (dx=dy=0). The textbox editor failure
// was root-caused: `[data-annotation-editor="textbox"]` WAS the textarea itself
// (no separate chrome), so every grab point landed on the typing control.
//
// v1.7.17 adds a real draggable grip strip `[data-annotation-editor-handle]`
// above the textarea, and the editor wrapper is now the window. This spec:
//   - for the TEXTBOX EDITOR, grabs the grip strip `[data-annotation-editor-
//     handle="textbox"]` (or the wrapper), NEVER the textarea;
//   - for every other window, grabs a NON-interactive chrome/padding point
//     (elementFromPoint scan avoiding button/input/textarea/select/[role=button]/
//     [role=tab]/a), never a control;
//   - holds the mouse and captures the rect BOTH mid-drag (button held) and
//     after release; a valid fix must move the window MID-DRAG (dx>0 dy>0 while
//     the button is held) AND keep the new position (no snap-back).
// Each window is exercised in its own isolated app launch.
// Launch only via e2e/lib/launch.cjs against the DEV build (historically: the packaged installed exe).

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

async function rectOf(selector) {
  return win.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }, selector);
}

// Find a point inside the element rect that is NOT over any interactive child.
async function findChromePoint(selector) {
  return win.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    const interactiveSel = 'button, input, textarea, select, a, [role="button"], [contenteditable="true"], [role="tab"]';
    const isInteractive = (pt) => {
      const el = document.elementFromPoint(pt.x, pt.y);
      if (!el) return true;
      return !!el.closest(interactiveSel);
    };
    const candidates = [];
    for (let fy = 0.08; fy <= 0.9; fy += 0.12) {
      for (let fx = 0.06; fx <= 0.94; fx += 0.08) {
        candidates.push({ x: r.x + r.width * fx, y: r.y + r.height * fy });
      }
    }
    for (const c of candidates) {
      if (!isInteractive(c)) return { x: Math.round(c.x), y: Math.round(c.y) };
    }
    return { x: Math.round(r.x + 4), y: Math.round(r.y + 4) };
  }, selector);
}

// Drag a floating element's chrome/grip +160/+90 and report whether it moved
// BOTH mid-drag (button held) and after release.
// measureSelector = the element whose rect we measure (the window);
// handleSelector  = the element whose chrome/grip we press (defaults to measureSelector).
async function dragTest(measureSelector, label, handleSelector) {
  const before = await rectOf(measureSelector);
  if (!before) {
    console.log(`[MOVE|${label}] element NOT OPEN (selector=${measureSelector})`);
    return { open: false };
  }
  const hs = handleSelector || measureSelector;
  const pt = await findChromePoint(hs);
  if (!pt) {
    console.log(`[MOVE|${label}] element ${JSON.stringify(before)} but no chrome point`);
    return { open: true, before, dx: 0, dy: 0, midDx: 0, midDy: 0 };
  }
  console.log(`[MOVE|${label}] grab chrome point ${JSON.stringify(pt)} on handle=${hs}`);
  await win.mouse.move(pt.x, pt.y);
  await win.mouse.down();
  await win.waitForTimeout(120);
  await win.mouse.move(pt.x + 160, pt.y + 90, { steps: 12 });
  await win.waitForTimeout(200);
  const mid = await rectOf(measureSelector); // button still held
  await win.mouse.up();
  await win.waitForTimeout(500);
  const after = await rectOf(measureSelector);
  const midDx = mid ? Math.round(mid.x - before.x) : 'n/a';
  const midDy = mid ? Math.round(mid.y - before.y) : 'n/a';
  const dx = after ? Math.round(after.x - before.x) : 'n/a';
  const dy = after ? Math.round(after.y - before.y) : 'n/a';
  console.log(`[MOVE|${label}] before=${JSON.stringify(before)} mid=${JSON.stringify(mid)} after=${JSON.stringify(after)} midDx=${midDx} midDy=${midDy} dx=${dx} dy=${dy}`);
  return { open: true, before, mid, after, midDx, midDy, dx, dy };
}

function assertMovable(label, r) {
  // Must move while the button is held AND stay put after release.
  const midMoved = r && r.open !== false && typeof r.midDx === 'number' && typeof r.midDy === 'number' && r.midDx > 0 && r.midDy > 0;
  const afterMoved = r && typeof r.dx === 'number' && typeof r.dy === 'number' && r.dx > 0 && r.dy > 0;
  const moved = midMoved && afterMoved;
  console.log(`[147|VERDICT] ${label}=${moved ? 'MOVED' : (r && r.open === false ? 'NOT-OPEN' : 'STUCK')} (midDx=${r && r.midDx} midDy=${r && r.midDy} afterDx=${r && r.dx} afterDy=${r && r.dy})`);
  expect(moved, `${label} must be movable (mid-drag dx>0 dy>0 and after-release dx>0 dy>0)`).toBe(true);
}

test('147a: signature pending action bar is movable', async () => {
  await openSampleFromCard('report.pdf');
  await win.click('button[aria-label="Sign tool"]');
  await win.waitForSelector('.sig-manager', { timeout: 10000 });
  await win.waitForTimeout(600);
  await win.click('.sig-tab:has-text("Draw")').catch(() => {});
  await win.waitForTimeout(500);
  const drawCanvas = win.locator('canvas[aria-label="Draw your signature"]');
  await drawCanvas.waitFor({ timeout: 10000 });
  const cbox = await drawCanvas.boundingBox();
  await win.mouse.move(cbox.x + 20, cbox.y + cbox.height * 0.7);
  await win.mouse.down();
  await win.mouse.move(cbox.x + cbox.width * 0.5, cbox.y + cbox.height * 0.35, { steps: 8 });
  await win.mouse.move(cbox.x + cbox.width * 0.9, cbox.y + cbox.height * 0.6, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(400);
  await win.click('.sig-manager button:text-is("Save")');
  await win.waitForTimeout(700);
  await win.click('.sig-tab:has-text("Saved")').catch(() => {});
  await win.waitForTimeout(400);
  await win.locator('.sig-saved-pick').first().click().catch(() => {});
  await win.waitForTimeout(600);
  const page = win.locator('.pdf-page').first();
  const pbox = await page.boundingBox();
  await win.mouse.click(pbox.x + 420, pbox.y + 330);
  await win.waitForTimeout(600);
  await shot('def-147-1717-sig-pending-open.png');
  const r = await dragTest('[data-sig-action-bar]', 'sig-action-bar');
  await shot('def-147-1717-sig-middrag.png');
  await assertMovable('sigActionBar', r);
});

test('147b: sticky-note editor is movable (regression)', async () => {
  await openSampleFromCard('report.pdf');
  const page = win.locator('.pdf-page').first();
  const pbox = await page.boundingBox();
  await win.click('button[data-tool="note"]');
  await win.waitForTimeout(500);
  await win.mouse.click(pbox.x + 420, pbox.y + 330);
  await win.waitForTimeout(800);
  const open = await rectOf('[data-annotation-editor="note"]');
  console.log(`[147b] note editor open? ${JSON.stringify(open)}`);
  expect(open, 'note editor must be open').toBeTruthy();
  await shot('def-147-1717-note-editor-open.png');
  const r = await dragTest('[data-annotation-editor="note"]', 'note-editor');
  await shot('def-147-1717-note-middrag.png');
  await assertMovable('noteEditor', r);
});

test('147c: textbox editor (grip strip) + action bar are movable', async () => {
  await openSampleFromCard('report.pdf');
  const page = win.locator('.pdf-page').first();
  const pbox = await page.boundingBox();
  await win.click('button[data-tool="textbox"]');
  await win.waitForTimeout(500);
  await win.mouse.click(pbox.x + 420, pbox.y + 330);
  await win.waitForTimeout(800);
  const editOpen = await rectOf('[data-annotation-editor="textbox"]');
  console.log(`[147c] textbox editor open? ${JSON.stringify(editOpen)}`);
  expect(editOpen, 'textbox editor must be open').toBeTruthy();
  const gripExists = await win.evaluate(() => document.querySelector('[data-annotation-editor-handle="textbox"]') !== null);
  console.log(`[147c] grip strip [data-annotation-editor-handle="textbox"] present? ${gripExists}`);
  expect(gripExists, 'textbox editor must expose a grip strip [data-annotation-editor-handle="textbox"]').toBe(true);
  await shot('def-147-1717-textbox-open.png');

  // The action bar rides INSIDE the wrapper, offset below the textarea — so it
  // is not at the wrapper's top-left. We verify it moves by the SAME DELTA as
  // the editor window when the grip strip is dragged, and separately that its
  // own chrome is draggable.
  const barBeforeGrip = await rectOf('[data-annotation-action-bar="textbox"]');
  console.log(`[147c] textbox action bar before grip drag = ${JSON.stringify(barBeforeGrip)}`);
  expect(barBeforeGrip, 'textbox action bar must exist before grip drag').toBeTruthy();

  // 1) Drag the GRIP STRIP (not the textarea) — the whole editor window moves.
  const rEditor = await dragTest('[data-annotation-editor="textbox"]', 'textbox-editor', '[data-annotation-editor-handle="textbox"]');
  await shot('def-147-1717-textbox-grip-middrag.png');
  await assertMovable('textboxEditor', rEditor);

  // 2) The action bar (a child of the wrapper) must be displaced by the SAME
  //    delta as the editor window after the grip drag.
  const barAfterGrip = await rectOf('[data-annotation-action-bar="textbox"]');
  console.log(`[147c] textbox action bar after grip drag = ${JSON.stringify(barAfterGrip)}`);
  const barDx = barAfterGrip ? barAfterGrip.x - barBeforeGrip.x : null;
  const barDy = barAfterGrip ? barAfterGrip.y - barBeforeGrip.y : null;
  console.log(`[147c] action bar delta after grip drag = dx=${barDx} dy=${barDy} (editor dx=${rEditor.dx} dy=${rEditor.dy})`);
  expect(barDx !== null && Math.abs(barDx - rEditor.dx) <= 8 && barDy !== null && Math.abs(barDy - rEditor.dy) <= 8,
    'textbox action bar must move with the editor window (same delta as the grip drag)').toBe(true);

  // 3) Drag the action bar's own chrome — it must also move (bubbles to the wrapper).
  const rBar = await dragTest('[data-annotation-action-bar="textbox"]', 'textbox-action-bar');
  await shot('def-147-1717-textbox-bar-middrag.png');
  await assertMovable('textboxActionBar', rBar);
});

test('147d: annotation color palette popover is movable (regression)', async () => {
  await openSampleFromCard('report.pdf');
  await win.click('button[data-tool="ink"]');
  await win.waitForTimeout(500);
  const swatch = win.locator('.ann-color-swatch-main').first();
  await swatch.waitFor({ timeout: 10000 });
  await swatch.click();
  await win.waitForTimeout(600);
  const open = await rectOf('.color-palette');
  console.log(`[147d] color palette open? ${JSON.stringify(open)}`);
  expect(open, 'color palette must be open').toBeTruthy();
  await shot('def-147-1717-color-palette-open.png');
  const r = await dragTest('.color-palette', 'color-palette');
  await shot('def-147-1717-color-palette-middrag.png');
  await assertMovable('colorPalette', r);
});

test('147e: stamp dialog is movable (regression)', async () => {
  await openSampleFromCard('report.pdf');
  const paletteOpen = await win.evaluate(() => document.querySelector('[data-tools-palette]') !== null);
  if (!paletteOpen) { await win.click('[data-tools-toggle]'); await win.waitForSelector('[data-tools-palette]', { timeout: 10000 }); await win.waitForTimeout(300); }
  await win.click('[data-tool-id="stamp"]');
  await win.waitForSelector('[data-stamp-dialog]', { timeout: 10000 });
  await win.waitForTimeout(700);
  await shot('def-147-1717-stamp-dialog-open.png');
  const r = await dragTest('[data-stamp-dialog] .modal-dialog', 'stamp-dialog');
  await shot('def-147-1717-stamp-middrag.png');
  await assertMovable('stampDialog', r);
});
