// QA verification (freshly installed v1.7.16) — DEF-147.
//
// The operator's stated intent: "every toolbox movable with its content", so
// EVERY floating window must follow the cursor WHILE the mouse button is held
// (mid-drag), not only on release — parity with the DEF-140 Edit-mode toolbox.
//
// On v1.7.15 four windows were still STUCK (dx=dy=0): signature pending action
// bar, textbox editor, annotation color palette popover, stamp dialog. This spec
// re-runs each on v1.7.16 and:
//   - grabs a NON-interactive chrome/padding point (elementFromPoint scan that
//     avoids button/input/textarea/select/[role=button]/[role=tab]/a), never a
//     control itself;
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
    for (let fy = 0.1; fy <= 0.9; fy += 0.15) {
      for (let fx = 0.08; fx <= 0.92; fx += 0.12) {
        candidates.push({ x: r.x + r.width * fx, y: r.y + r.height * fy });
      }
    }
    for (const c of candidates) {
      if (!isInteractive(c)) return { x: Math.round(c.x), y: Math.round(c.y) };
    }
    return { x: Math.round(r.x + 4), y: Math.round(r.y + 4) };
  }, selector);
}

// Drag a floating element's chrome +160/+90 and report whether it moved
// BOTH mid-drag (button held) and after release.
async function dragTest(selector, label) {
  const before = await rectOf(selector);
  if (!before) {
    console.log(`[MOVE|${label}] element NOT OPEN (selector=${selector})`);
    return { open: false };
  }
  const pt = await findChromePoint(selector);
  if (!pt) {
    console.log(`[MOVE|${label}] element ${JSON.stringify(before)} but no chrome point`);
    return { open: true, before, dx: 0, dy: 0, midDx: 0, midDy: 0 };
  }
  await win.mouse.move(pt.x, pt.y);
  await win.mouse.down();
  await win.mouse.move(pt.x + 160, pt.y + 90, { steps: 10 });
  await win.waitForTimeout(200);
  const mid = await rectOf(selector); // button still held
  await win.mouse.up();
  await win.waitForTimeout(500);
  const after = await rectOf(selector);
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
  await shot('def-147-1716-sig-pending-open.png');
  const r = await dragTest('[data-sig-action-bar]', 'sig-action-bar');
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
  await shot('def-147-1716-note-editor-open.png');
  const r = await dragTest('[data-annotation-editor="note"]', 'note-editor');
  await assertMovable('noteEditor', r);
});

test('147c: textbox editor + action bar are movable', async () => {
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
  await shot('def-147-1716-textbox-open.png');
  const rEditor = await dragTest('[data-annotation-editor="textbox"]', 'textbox-editor');
  const rBar = await dragTest('[data-annotation-action-bar="textbox"]', 'textbox-action-bar');
  await assertMovable('textboxEditor', rEditor);
  await assertMovable('textboxActionBar', rBar);
});

test('147d: annotation color palette popover is movable', async () => {
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
  await shot('def-147-1716-color-palette-open.png');
  const r = await dragTest('.color-palette', 'color-palette');
  await assertMovable('colorPalette', r);
});

test('147e: stamp dialog is movable', async () => {
  await openSampleFromCard('report.pdf');
  const paletteOpen = await win.evaluate(() => document.querySelector('[data-tools-palette]') !== null);
  if (!paletteOpen) { await win.click('[data-tools-toggle]'); await win.waitForSelector('[data-tools-palette]', { timeout: 10000 }); await win.waitForTimeout(300); }
  await win.click('[data-tool-id="stamp"]');
  await win.waitForSelector('[data-stamp-dialog]', { timeout: 10000 });
  await win.waitForTimeout(700);
  await shot('def-147-1716-stamp-dialog-open.png');
  const r = await dragTest('[data-stamp-dialog] .modal-dialog', 'stamp-dialog');
  await assertMovable('stampDialog', r);
});
