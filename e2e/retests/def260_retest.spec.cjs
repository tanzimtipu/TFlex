// DEF-260 retest (Phase 28) — the action-bar colour box and the armed-tool
// colour must apply the canonical 12-name set. Before the fix the renderer
// palette offered pink/teal/gray while the engine's named set did not, so
// those three were silently dropped on BOTH the edit (selected annotation)
// and create (armed tool) paths. The canonical list now lives in
// src/shared/annotationColors.ts and both sides consume it.
//
// Proves:
//   1. pink / teal / gray picked through the action-bar colour box apply to
//      the selected annotation (engine colour + box hex);
//   2. all 12 built-in swatches apply, forward AND reverse (no drops);
//   3. P28 C3 still holds: bar order Confirm | colour box | Cancel | Delete
//      with no Edit, a single click opens the picker, and the toolbar
//      dropdown sets only the ARMED tool colour, not the selection;
//   4. arming pink and drawing creates a shape carrying pink.
//
// Canonical launcher only.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose, armAnnotationTool } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const log = (label, obj) => console.log(`[DEF260] ${label} ${JSON.stringify(obj)}`);

// The canonical shared list (src/shared/annotationColors.ts), in order.
const CANON = ['yellow', 'green', 'blue', 'red', 'orange', 'purple', 'cyan', 'magenta', 'white', 'pink', 'teal', 'gray'];
const HEX = {
  yellow: '#eab308', green: '#22c55e', blue: '#3b82f6', red: '#ef4444', orange: '#f97316',
  purple: '#a855f7', cyan: '#00ffff', magenta: '#ff00ff', white: '#ffffff',
  pink: '#ec4899', teal: '#14b8a6', gray: '#64748b',
};

async function openReport(app, win) {
  const p = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(500);
}

const anns = (win) => win.evaluate(() =>
  ((window.tflexDiagnostics().engineState || {}).annotations || []));
const colorOf = async (win) => (await anns(win)).find((a) => a.kind === 'rect').color;
const boxHex = (win) => win.getAttribute('[data-ann-color-box]', 'data-color-current');

// The action-bar picker now DISENGAGES after each pick (operator
// requirement), so every pick must re-open it first.
async function pickBuiltIn(win, c) {
  if ((await win.locator('[data-color-popover]').count()) === 0) {
    await win.click('[data-ann-color-box]');
    await win.waitForSelector('[data-color-popover]', { timeout: 6000 });
    await win.waitForTimeout(300);
  }
  await win.locator(`[data-palette-built-in="${c}"]`).click();
  await win.waitForTimeout(1100);
}

async function dragOnPage(win, fx, fy, dxPx, dyPx) {
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 240));
  const y = Math.max(40, Math.min(pg.y + pg.height * fy, vp.h - 110));
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dxPx, y + dyPx, { steps: 6 });
  await win.mouse.up();
  return { x, y };
}

async function placeAndSelectRect(win) {
  await armAnnotationTool(win, 'rect');
  await dragOnPage(win, 0.3, 0.3, 170, 90);
  await win.waitForSelector('.ann-shape[data-kind="rect"]', { timeout: 10000 });
  await win.waitForTimeout(600);
  const bb = await win.locator('.ann-shape[data-kind="rect"]').first().boundingBox();
  await win.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await win.waitForSelector('[data-content-action-bar="ann-rect"]', { timeout: 8000 });
  await win.waitForTimeout(400);
}

// ===========================================================================
// 1. pink / teal / gray apply on the selected annotation + full 12-swatch
//    sweep forward and reverse.
// ===========================================================================
test('DEF-260 retest: pink/teal/gray apply + 12-swatch sweep both directions', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await placeAndSelectRect(win);

    await win.click('[data-ann-color-box]');
    await win.waitForSelector('[data-color-popover]', { timeout: 6000 });
    await win.waitForTimeout(500);
    const swatchCount = await win.locator('[data-color-popover] [data-palette-built-in]').count();
    log('popover', { swatchCount });
    expect(swatchCount, 'the action-bar picker offers the canonical 12 swatches').toBe(12);

    // Evidence: the 12-swatch picker open on a selected annotation.
    await win.screenshot({ path: path.join(SHOTS, 'def260-retest.png') });

const picks = {};
    for (const c of ['pink', 'teal', 'gray']) {
      await pickBuiltIn(win, c);
      picks[c] = { engine: await colorOf(win), box: await boxHex(win) };
    }
    log('picks', picks);
    for (const c of ['pink', 'teal', 'gray']) {
      expect(picks[c].engine, `picking ${c} applies to the selected annotation`).toBe(c);
      expect(picks[c].box, `the box shows ${c}`).toBe(HEX[c]);
    }

    const sweep = {};
    for (const order of ['forward', 'reverse']) {
      const list = order === 'forward' ? CANON : [...CANON].reverse();
      const dropped = [];
for (const c of list) {
        await pickBuiltIn(win, c);
        const engine = await colorOf(win);
        const box = await boxHex(win);
        if (engine !== c || box !== HEX[c]) dropped.push({ c, engine, box });
      }
      sweep[order] = { tested: list.length, dropped };
    }
    log('sweep', sweep);
    expect(sweep.forward.dropped, 'forward sweep: no dropped swatches').toEqual([]);
    expect(sweep.reverse.dropped, 'reverse sweep: no dropped swatches').toEqual([]);
  } finally {
    await hardClose(app, 'def260-picks');
  }
});

// ===========================================================================
// 2. P28 C3 re-confirm + the create path: arm pink and draw -> pink shape.
// ===========================================================================
test('DEF-260 retest: P28 C3 bar re-confirm + pink-armed create', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await placeAndSelectRect(win);

    // --- P28 C3: Confirm | colour box | Cancel | Delete, no Edit text.
    const bar = await win.evaluate(() => {
      const el = document.querySelector('[data-content-action-bar="ann-rect"]');
      const kids = [...el.querySelectorAll('button')].map((b) => ({
        action: b.getAttribute('data-content-action'),
        colorBox: b.hasAttribute('data-ann-color-box'),
        left: +b.getBoundingClientRect().left.toFixed(1),
      }));
      return { kids, editText: el.textContent.includes('Edit'),
        editBtn: el.querySelectorAll('[data-content-action$="-edit"]').length };
    });
    log('c3-bar', bar);
    expect(bar.editBtn, 'no Edit button in the action bar').toBe(0);
    expect(bar.editText, 'no "Edit" label').toBe(false);
    expect(bar.kids.filter((k) => k.colorBox).length, 'exactly one colour box').toBe(1);
    const confirm = bar.kids.find((k) => (k.action || '').endsWith('-confirm'));
    const colorBox = bar.kids.find((k) => k.colorBox);
    const cancel = bar.kids.find((k) => (k.action || '').endsWith('-cancel'));
    const del = bar.kids.find((k) => (k.action || '').endsWith('-delete'));
    expect(confirm && colorBox && cancel && del, 'Confirm/colour/Cancel/Delete present').toBeTruthy();
    expect(confirm.left < colorBox.left && colorBox.left < cancel.left && cancel.left < del.left,
      'order is Confirm | colour box | Cancel | Delete').toBe(true);

    // A SINGLE click opens the picker, and picking patches the selection.
    await win.click('[data-ann-color-box]');
    await win.waitForSelector('[data-color-popover]', { timeout: 6000 });
    expect(await win.locator('[data-color-popover]').count(), 'single click opens the picker').toBeGreaterThan(0);
    await win.locator('[data-palette-built-in="blue"]').click();
    await win.waitForTimeout(1100);
    expect(await colorOf(win), 'the selected annotation was set to blue').toBe('blue');

    // The toolbar dropdown must NOT patch the SELECTED annotation.
    const selectedId = (await anns(win)).find((a) => a.kind === 'rect').id;
    await win.waitForSelector('[data-ann-color]', { timeout: 8000 });
    const swatchBefore = await win.getAttribute('[data-ann-color]', 'data-color-current');
    await win.click('[data-ann-color]');
    await win.waitForSelector('[data-color-popover]', { timeout: 6000 });
    await win.waitForTimeout(400);
    await win.locator('[data-palette-built-in="pink"]').click();
    await win.waitForTimeout(1100);
    const swatchAfter = await win.getAttribute('[data-ann-color]', 'data-color-current');
    const afterDropdown = (await anns(win)).find((a) => a.id === selectedId);
    log('c3-dropdown', { swatchBefore, swatchAfter, selectedColor: afterDropdown.color });
    expect(swatchAfter, 'dropdown pick updates the ARMED tool swatch to pink').toBe(HEX.pink);
    expect(swatchAfter, 'dropdown pick changed the armed swatch').not.toBe(swatchBefore);
    expect(afterDropdown.color, 'the SELECTED annotation was NOT patched by the dropdown').toBe('blue');

    // --- Create path: the pink-armed tool draws a pink shape (was a no-op).
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);
    await armAnnotationTool(win, 'rect');
    await win.waitForTimeout(300);
    const nBefore = (await anns(win)).filter((a) => a.kind === 'rect').length;
    await dragOnPage(win, 0.6, 0.65, 130, 70);
    await win.waitForTimeout(1600);
    const rects = (await anns(win)).filter((a) => a.kind === 'rect');
    const created = rects.find((a) => a.id !== selectedId);
    log('create-pink', { nBefore, nAfter: rects.length, createdColor: created && created.color,
      tool: await win.evaluate(() => window.tflexDiagnostics().activeTool) });
    expect(rects.length, 'the pink-armed drag created a new shape (was a silent no-op)').toBe(nBefore + 1);
    expect(created && created.color, 'the created shape carries pink').toBe('pink');
    const firstAfter = (await anns(win)).find((a) => a.id === selectedId);
    expect(firstAfter.color, 'the earlier selected annotation stays blue').toBe('blue');
  } finally {
    await hardClose(app, 'def260-create');
  }
});
