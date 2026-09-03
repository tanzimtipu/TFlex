// QA ground-truth reproduction (installed v1.7.14) — item 1.
//
// Is every floating editor / toolbox movable? The Edit-mode inline-editor
// TOOLBOX is now draggable (DEF-140). The operator wants EVERY toolbox movable
// with its content. Here we test the OTHER floating windows and list which ones
// CANNOT be moved:
//   - signature pending action bar            [data-sig-action-bar]
//   - sticky-note editor                      [data-annotation-editor="note"]
//   - textbox editor / callout action bar     [data-annotation-action-bar="textbox"]
//                                             [data-annotation-action-bar="callout"]
//   - annotation color palette popover        .color-palette
//   - stamp dialog header                     [data-stamp-dialog] .modal-dialog
//
// Launch only via e2e/lib/launch.cjs against the packaged installed exe.

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const path = require('node:path');

const EXE_PATH = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test.setTimeout(300000);

let electronApp = null;
let win = null;

test.beforeEach(async () => {
  electronApp = await launchApp([], null, EXE_PATH);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  await win.waitForTimeout(700);
});

test.afterEach(async () => {
  if (electronApp) await electronApp.close().catch(() => {});
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

// Rect of a selector (first match).
async function rectOf(selector) {
  return win.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }, selector);
}

// Find a point inside the element rect that is NOT over any interactive child
// (button/input/textarea/select/a/[role=button]). Prefer top-left chrome.
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
    // Scan a grid across the element, preferring top/left chrome.
    for (let fy = 0.1; fy <= 0.9; fy += 0.15) {
      for (let fx = 0.08; fx <= 0.92; fx += 0.12) {
        candidates.push({ x: r.x + r.width * fx, y: r.y + r.height * fy });
      }
    }
    // Prefer the very first non-interactive point found scanning row by row.
    for (const c of candidates) {
      if (!isInteractive(c)) return { x: Math.round(c.x), y: Math.round(c.y) };
    }
    // Fall back to the top-left inset even if it lands on a control.
    return { x: Math.round(r.x + 4), y: Math.round(r.y + 4) };
  }, selector);
}

// Drag a floating element's chrome +160/+90 and report whether it moved.
async function dragTest(selector, label) {
  const before = await rectOf(selector);
  if (!before) {
    console.log(`[MOVE|${label}] element NOT OPEN (selector=${selector})`);
    return { open: false };
  }
  const pt = await findChromePoint(selector);
  if (!pt) {
    console.log(`[MOVE|${label}] element ${JSON.stringify(before)} but no chrome point`);
    return { open: true, before };
  }
  await win.mouse.move(pt.x, pt.y);
  await win.mouse.down();
  await win.mouse.move(pt.x + 160, pt.y + 90, { steps: 10 });
  await win.waitForTimeout(180);
  const mid = await rectOf(selector);
  await win.mouse.up();
  await win.waitForTimeout(450);
  const after = await rectOf(selector);
  const dx = after ? Math.round(after.x - before.x) : 'n/a';
  const dy = after ? Math.round(after.y - before.y) : 'n/a';
  console.log(`[MOVE|${label}] before=${JSON.stringify(before)} mid=${JSON.stringify(mid)} after=${JSON.stringify(after)} moved dx=${dx} dy=${dy}`);
  return { open: true, before, mid, after, dx, dy };
}

test('Item 1a: signature pending action bar is NOT movable', async () => {
  await openSampleFromCard('report.pdf');
  // Arm a signature via the reliable drawn path (proven to place in item 5).
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
  const pickCount = await win.locator('.sig-saved-pick').count();
  console.log(`[MOVE|sig-pending] saved-pick count=${pickCount}`);
  await win.locator('.sig-saved-pick').first().click().catch(() => {});
  await win.waitForTimeout(600);
  // Click the page -> pending action bar.
  const page = win.locator('.pdf-page').first();
  const pbox = await page.boundingBox();
  await win.mouse.click(pbox.x + 420, pbox.y + 330);
  await win.waitForTimeout(600);
  const pendingBar = await rectOf('[data-sig-action-bar]');
  console.log(`[MOVE|sig-pending] action-bar open? ${JSON.stringify(pendingBar)}`);
  await shot('gt-item1a-sig-pending-open.png');
  const res = await dragTest('[data-sig-action-bar]', 'sig-action-bar');
  await shot('gt-item1a-sig-pending-after-drag.png');
  console.log(`[MOVE|sig-action-bar] movable=${res.open && res.dx === 0 && res.dy === 0 ? 'NO' : 'YES'}`);
});

test('Item 1b: sticky-note editor is NOT movable', async () => {
  await openSampleFromCard('report.pdf');
  const page = win.locator('.pdf-page').first();
  const pbox = await page.boundingBox();
  await win.click('button[data-tool="note"]');
  await win.waitForTimeout(400);
  await win.mouse.click(pbox.x + 420, pbox.y + 330);
  await win.waitForTimeout(700);
  await shot('gt-item1b-note-editor-open.png');
  const res = await dragTest('[data-annotation-editor="note"]', 'note-editor');
  await shot('gt-item1b-note-editor-after-drag.png');
  console.log(`[MOVE|note-editor] movable=${res.open && res.dx === 0 && res.dy === 0 ? 'NO' : 'YES'}`);
});

test('Item 1c: textbox editor + action bar are NOT movable', async () => {
  await openSampleFromCard('report.pdf');
  const page = win.locator('.pdf-page').first();
  const pbox = await page.boundingBox();
  await win.click('button[data-tool="textbox"]');
  await win.waitForTimeout(400);
  await win.mouse.click(pbox.x + 420, pbox.y + 330);
  await win.waitForTimeout(700);
  await shot('gt-item1c-textbox-open.png');
  const resEditor = await dragTest('[data-annotation-editor="textbox"]', 'textbox-editor');
  const resBar = await dragTest('[data-annotation-action-bar="textbox"]', 'textbox-action-bar');
  await shot('gt-item1c-textbox-after-drag.png');
  console.log(`[MOVE|textbox-editor] movable=${resEditor.open && resEditor.dx === 0 && resEditor.dy === 0 ? 'NO' : 'YES'}`);
  console.log(`[MOVE|textbox-action-bar] movable=${resBar.open && resBar.dx === 0 && resBar.dy === 0 ? 'NO' : 'YES'}`);
});

test('Item 1d: annotation color palette popover is NOT movable', async () => {
  await openSampleFromCard('report.pdf');
  // Arm a markup/ink tool first so the color swatch appears under it.
  await win.click('button[data-tool="ink"]');
  await win.waitForTimeout(400);
  const swatch = win.locator('.ann-color-swatch-main').first();
  await swatch.waitFor({ timeout: 10000 });
  await swatch.click();
  await win.waitForTimeout(600);
  const open = await rectOf('.color-palette');
  if (!open) {
    console.log('[MOVE|color-palette] palette did NOT open (selector .color-palette)');
  } else {
    await shot('gt-item1d-color-palette-open.png');
    const res = await dragTest('.color-palette', 'color-palette');
    await shot('gt-item1d-color-palette-after-drag.png');
    console.log(`[MOVE|color-palette] movable=${res.open && res.dx === 0 && res.dy === 0 ? 'NO' : 'YES'}`);
  }
});

test('Item 1e: stamp dialog header is NOT movable', async () => {
  await openSampleFromCard('report.pdf');
  // Open the Tools palette -> Stamp.
  const paletteOpen = await win.evaluate(() => document.querySelector('[data-tools-palette]') !== null);
  if (!paletteOpen) { await win.click('[data-tools-toggle]'); await win.waitForSelector('[data-tools-palette]', { timeout: 10000 }); await win.waitForTimeout(300); }
  await win.click('[data-tool-id="stamp"]');
  await win.waitForSelector('[data-stamp-dialog]', { timeout: 10000 });
  await win.waitForTimeout(600);
  await shot('gt-item1e-stamp-dialog-open.png');
  const res = await dragTest('[data-stamp-dialog] .modal-dialog', 'stamp-dialog');
  await shot('gt-item1e-stamp-dialog-after-drag.png');
  console.log(`[MOVE|stamp-dialog] movable=${res.open && res.dx === 0 && res.dy === 0 ? 'NO' : 'YES'}`);
});
