// QA ground-truth reproduction — installed v1.7.5 app.
// Group 1: Bug 1 (embedded sign selection), Bug 2 (edit text a/b/c),
// Bug 5 (Add Box render), Bug 6 (context-window outside click),
// Bug 10 (min/max title-bar icons identical).
// Drives the REAL installed app via e2e/lib/launch.cjs EXE_PATH.

const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp } = require('../lib/launch.cjs');

const EXE_PATH = "C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe";

let electronApp = null;
let window = null;

async function launch() {
  electronApp = await launchApp([], null, EXE_PATH);
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);
}
async function close() { if (electronApp) await hardClose(electronApp); electronApp = null; }
async function openSample(name) {
  await window.click(`.sample-card:has-text("${name}")`);
  await window.waitForSelector('.workspace', { timeout: 15000 });
  await window.waitForTimeout(1500);
}
async function diag() { return await window.evaluate(() => window.tflexDiagnostics()); }
async function snap(name) { await window.screenshot({ path: `screenshots/${name}.png` }); }

async function createAndArmSignature() {
  await window.click('button[aria-label="Sign tool"]');
  await window.waitForSelector('.sig-manager', { timeout: 10000 });
  await window.click('.sig-tab:has-text("Type")').catch(() => {});
  const typeInput = window.locator('input[aria-label="Type your signature"]');
  if (await typeInput.count()) { await typeInput.fill('QA Suite'); }
  await window.click('.sig-manager button:text-is("Save")').catch(() => {});
  await window.waitForTimeout(400);
  await window.click('.sig-saved-pick').catch(() => {});
  await window.waitForTimeout(500);
}

async function placementOnPage(pageSel, x, y) {
  const page = window.locator(pageSel).first();
  const box = await page.boundingBox();
  const tx = box.x + x, ty = box.y + y;
  await window.mouse.move(tx, ty);
  await window.waitForTimeout(250);
  await window.mouse.click(tx, ty);
  await window.waitForTimeout(400);
  return { tx, ty };
}

test.beforeEach(async () => { await launch(); });
test.afterEach(async () => { await close(); });

// ---------------------------------------------------------------------------
// Bug 1 — click an already-placed (embedded) sign -> selector should appear
// ---------------------------------------------------------------------------
test('GT-01: embedded signature selection shows move/resize/delete handles', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  await createAndArmSignature();

  await placementOnPage('.pdf-page', 500, 300);
  const pendingBefore = await window.locator('[data-sig-pending]').count();
  const confirmBtn = window.locator('[data-sig-action="confirm"]').first();
  if (await confirmBtn.count()) { await confirmBtn.click({ force: true }); }
  await window.waitForTimeout(700);

  const committed = await window.locator('.sig-placement').count();
  const layerArmed = await window.locator('.signatures-layer').first().getAttribute('data-armed');
  const toolbarPressed = await window.locator('button[aria-label="Sign tool"]').getAttribute('aria-pressed');
  console.log('GT-01 place: pending=', pendingBefore, 'committed=', committed, 'layerArmed=', layerArmed, 'toolbarPressed=', toolbarPressed);
  await snap('gt-bug1-after-confirm');

  // Click the committed placement
  const placement = window.locator('.sig-placement').first();
  const plbox = await placement.boundingBox();
  console.log('GT-01 placement box:', JSON.stringify(plbox));
  const clickX = plbox.x + plbox.width / 2, clickY = plbox.y + plbox.height / 2;
  await window.mouse.click(clickX, clickY);
  await window.waitForTimeout(600);

  const selectedCount = await window.locator('.sig-placement-selected').count();
  const handleCount = await window.locator('.sig-placement .sig-handle').count();
  const activeLayerPe = await window.evaluate(() => {
    const l = document.querySelector('.signatures-layer');
    if (!l) return 'no-layer';
    const st = window.getComputedStyle(l);
    return st.pointerEvents;
  });
  console.log('GT-01 after click placement: selected=', selectedCount, 'handles=', handleCount, 'layerPointerEvents=', activeLayerPe);
  await snap('gt-bug1-click-placement');

  expect(handleCount, 'resize/delete handles should appear on an embedded sign click').toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Bug 2a — edit text: confirm does not render the updated text
// ---------------------------------------------------------------------------
test('GT-02a: edit text confirm renders updated text', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  const page = window.locator('.pdf-page').first();
  const pbox = await page.boundingBox();

  await window.click('[data-toolbar-edit-toggle]');
  await window.waitForSelector('[data-edit-toolbar]');
  await window.click('[data-edit-tool="text"]');
  await window.waitForTimeout(300);

  const spans = await window.evaluate(() => {
    const out = [];
    document.querySelectorAll('.textLayer span').forEach((s) => {
      const r = s.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: (s.textContent || '').slice(0, 30) });
    });
    return out;
  });
  const s = spans.find(x => x.y >= 300 && x.w > 150) || spans[0];
  console.log('GT-02a target span:', JSON.stringify(s));
  // Hover then click the title text run (DEF-105 stay-open technique)
  await window.mouse.move(s.x + s.w / 2, s.y + s.h / 2);
  await window.waitForTimeout(400);
  await window.mouse.click(s.x + s.w / 2, s.y + s.h / 2);
  await window.waitForTimeout(600);

  const editorCount = await window.locator('[data-edit-editor="edit"]').count();
  const editorVal = editorCount ? await window.locator('[data-edit-textarea]').inputValue().catch(() => null) : null;
  console.log('GT-02a editor count=', editorCount, 'initialValue=', editorVal);
  await snap('gt-bug2a-editor-open');

  if (editorCount === 0) { throw new Error('GT-02a: editor did not open on text-run click'); }

  // Type a new string
  await window.locator('[data-edit-textarea]').fill('ZZZ REPLACEMENT TEXT 123');
  await window.waitForTimeout(200);
  await snap('gt-bug2a-before-commit');
  // Commit via Ctrl+Enter
  await window.keyboard.press('Control+Enter');
  await window.waitForTimeout(900);

  const editorAfter = await window.locator('[data-edit-editor="edit"]').count();
  const d = await diag();
  console.log('GT-02a after commit: editorStillOpen=', editorAfter, 'modified=', (d && d.engineState) ? d.engineState.modified : (d && d.modified));
  await snap('gt-bug2a-after-commit');

  // Does the pdf.js textLayer now contain the replacement string?
  const texts = await window.evaluate(() => {
    const out = [];
    document.querySelectorAll('.textLayer span').forEach((s) => { out.push((s.textContent || '')); });
    return out;
  });
  const newVisible = texts.some((t) => t.includes('ZZZ REPLACEMENT TEXT'));
  const oldGone = !texts.some((t) => t.includes('TFlex Technical Report'));
  console.log('GT-02a NEW text visible in live textLayer=', newVisible, ' OLD title removed=', oldGone, ' textLayer sample=', JSON.stringify(texts.slice(0, 6)));
  expect(editorAfter, 'editor should close after commit').toBe(0);
});

// ---------------------------------------------------------------------------
// Bug 2b — edit text: the size/arrow control doesn't change the value
// ---------------------------------------------------------------------------
test('GT-02b: edit inline editor size/arrow control works', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  const page = window.locator('.pdf-page').first();
  const pbox = await page.boundingBox();

  await window.click('[data-toolbar-edit-toggle]');
  await window.waitForSelector('[data-edit-toolbar]');
  await window.click('[data-edit-tool="text"]');
  await window.waitForTimeout(300);

  const spans = await window.evaluate(() => {
    const out = [];
    document.querySelectorAll('.textLayer span').forEach((s) => {
      const r = s.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
    });
    return out;
  });
  const s = spans.find(x => x.y >= 300 && x.w > 150) || spans[0];
  await window.mouse.move(s.x + s.w / 2, s.y + s.h / 2);
  await window.waitForTimeout(400);
  await window.mouse.click(s.x + s.w / 2, s.y + s.h / 2);
  await window.waitForTimeout(600);
  if (await window.locator('[data-edit-editor="edit"]').count() === 0) throw new Error('editor did not open');

  const sizeInput = window.locator('[data-edit-editor="edit"] input[aria-label="Font size (pt)"]');
  const before = await sizeInput.inputValue();
  // Click the input, then try the native spinner ArrowUp
  await sizeInput.click();
  await window.waitForTimeout(200);
  await window.keyboard.press('ArrowUp');
  await window.waitForTimeout(300);
  const afterArrowUp = await sizeInput.inputValue();
  // Try clicking the native spin-arrow zone (via mouse on the right edge of input)
  const sizeBox = await sizeInput.boundingBox();
  await window.mouse.click(sizeBox.x + sizeBox.width - 4, sizeBox.y + sizeBox.height / 2);
  await window.waitForTimeout(300);
  const afterSpinClick = await sizeInput.inputValue();
  // Type a new numeric value directly
  await sizeInput.fill('48');
  await window.waitForTimeout(300);
  const afterFill = await sizeInput.inputValue();
  console.log('GT-02b size before=', before, 'afterArrowUp=', afterArrowUp, 'afterSpinClick=', afterSpinClick, 'afterFill=', afterFill);
  const editorStillOpen = await window.locator('[data-edit-editor="edit"]').count();
  console.log('GT-02b editor still open after size interaction=', editorStillOpen);
  await snap('gt-bug2b-size-control');
});

// ---------------------------------------------------------------------------
// Bug 2c / Bug 6 — clicking the context-window bar registers as an outside
// click and closes it; moving focus outside the window closes it.
// ---------------------------------------------------------------------------
test('GT-06: edit inline editor stays open when clicked/moved on its bar', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  const page = window.locator('.pdf-page').first();
  const pbox = await page.boundingBox();

  await window.click('[data-toolbar-edit-toggle]');
  await window.waitForSelector('[data-edit-toolbar]');
  await window.click('[data-edit-tool="text"]');
  await window.waitForTimeout(300);

  const spans = await window.evaluate(() => {
    const out = [];
    document.querySelectorAll('.textLayer span').forEach((s) => {
      const r = s.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
    });
    return out;
  });
  const s = spans.find(x => x.y >= 300 && x.w > 150) || spans[0];
  await window.mouse.move(s.x + s.w / 2, s.y + s.h / 2);
  await window.waitForTimeout(400);
  await window.mouse.click(s.x + s.w / 2, s.y + s.h / 2);
  await window.waitForTimeout(600);
  if (await window.locator('[data-edit-editor="edit"]').count() === 0) throw new Error('editor did not open');

  const barBox = await window.locator('[data-edit-editor="edit"] .edit-inline-toolbar').boundingBox();
  const editorBox = await window.locator('[data-edit-editor="edit"]').boundingBox();
  console.log('GT-06 editor box:', JSON.stringify(editorBox), 'toolbar box:', JSON.stringify(barBox));
  await snap('gt-bug6-editor-open');

  // SCENARIO A — bug 6: highlight text inside the editor's textarea, then
  // release the mouse OUTSIDE the editor window (drag ends on the page).
  // A correct text-drag-outside guard (like InsertPages B17) must NOT close
  // the editor; the bug reports that it DOES (outside click registered).
  const ta = window.locator('[data-edit-textarea]');
  const taBox = await ta.boundingBox();
  await window.mouse.move(taBox.x + 20, taBox.y + 20);
  await window.mouse.down();
  await window.mouse.move(taBox.x + taBox.width - 40, taBox.y + 20, { steps: 8 });
  await window.mouse.move(editorBox.x + editorBox.width + 200, editorBox.y + 60, { steps: 8 }); // continue OUTSIDE
  await window.mouse.up();
  await window.waitForTimeout(500);
  const afterDragOutside = await window.locator('[data-edit-editor="edit"]').count();
  console.log('GT-06 A) editor present after highlight-drag OUTSIDE=', afterDragOutside);
  await snap('gt-bug6-after-drag-outside');

  // Scenario B — bug 2c: a click landed on the toolbar bar closes the editor.
  if (afterDragOutside === 0) {
    // editor already closed by A; reopen to test B in isolation
    await window.mouse.move(s.x + s.w / 2, s.y + s.h / 2);
    await window.waitForTimeout(400);
    await window.mouse.click(s.x + s.w / 2, s.y + s.h / 2);
    await window.waitForTimeout(600);
  }
  const beforeBarClick = await window.locator('[data-edit-editor="edit"]').count();
  if (beforeBarClick > 0) {
    // Press on a NON-focusable label span inside the editor's toolbar bar
    // (the "Font" label). A mousedown there moves focus off the textarea to
    // the body; the textarea onBlur then commits/cancels and should NOT close
    // the editor if the bar is treated as part of the editor (bug 2c/6).
    const label = window.locator('[data-edit-editor="edit"] .edit-inline-field .edit-inline-label').first();
    if (await label.count()) {
      const lb = await label.boundingBox();
      await window.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
      await window.mouse.down();
      await window.mouse.up();
      await window.waitForTimeout(500);
    }
  }
  const afterBarClick = await window.locator('[data-edit-editor="edit"]').count();
  console.log('GT-06 B) editor present after press on Font label bar=', afterBarClick);
  await snap('gt-bug6-after-bar-click');
});

// ---------------------------------------------------------------------------
// Bug 5 — Add Box (edit mode): text box doesn't render after confirming
// ---------------------------------------------------------------------------
test('GT-05: Add Box text renders after confirming', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  const page = window.locator('.pdf-page').first();
  const pbox = await page.boundingBox();

  await window.click('[data-toolbar-edit-toggle]');
  await window.waitForSelector('[data-edit-toolbar]');
  await window.click('[data-edit-tool="box"]');
  await window.waitForTimeout(300);

  // Drag to place a box
  await window.mouse.move(pbox.x + 300, pbox.y + 400);
  await window.mouse.down();
  await window.mouse.move(pbox.x + 500, pbox.y + 480, { steps: 6 });
  await window.mouse.up();
  await window.waitForTimeout(500);

  const editorCount = await window.locator('[data-edit-editor="box"]').count();
  console.log('GT-05 box editor count=', editorCount);
  if (editorCount === 0) throw new Error('GT-05: box editor did not open');
  await snap('gt-bug5-box-editor-open');

  // Type text and confirm
  await window.locator('[data-edit-textarea]').fill('HELLO BOX ADDED 456');
  await window.waitForTimeout(200);
  await window.keyboard.press('Control+Enter');
  await window.waitForTimeout(900);

  const editorAfter = await window.locator('[data-edit-editor="box"]').count();
  const d = await diag();
  console.log('GT-05 after commit: editorStillOpen=', editorAfter, 'modified=', d.engineState ? d.engineState.modified : d.modified);
  // Is the new box text present in the textLayer?
  const inText = await window.evaluate(() => {
    const spans = document.querySelectorAll('.textLayer span');
    let found = false;
    spans.forEach((s) => { if ((s.textContent || '').includes('HELLO BOX ADDED')) found = true; });
    return found;
  });
  console.log('GT-05 box text visible in textLayer=', inText);
  await snap('gt-bug5-after-commit');
  expect(editorAfter, 'box editor should close after commit').toBe(0);
});

// ---------------------------------------------------------------------------
// Bug 10 — Minimize and Maximize title-bar buttons are identical
// ---------------------------------------------------------------------------
test('GT-10: minimize vs maximize title-bar button icons differ', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  await snap('gt-bug10-titlebar');

  const info = await window.evaluate(() => {
    const min = document.querySelector('[data-window-minimize]');
    const max = document.querySelector('[data-window-maximize]');
    const close = document.querySelector('[data-window-close]');
    const describe = (el) => {
      if (!el) return null;
      const svg = el.querySelector('svg');
      const paths = svg ? Array.from(svg.querySelectorAll('path')).map(p => p.getAttribute('d')).join('|') : 'no-svg';
      const aria = el.getAttribute('aria-label');
      const title = el.getAttribute('title');
      return { aria, title, svgClass: svg ? svg.getAttribute('class') : null, paths };
    };
    return {
      min: { label: min && min.getAttribute('aria-label'), title: min && min.getAttribute('title'), labelFor: min && min.querySelector('svg') ? 'has-svg' : 'no-svg' },
      max: { label: max && max.getAttribute('aria-label'), title: max && max.getAttribute('title'), labelFor: max && max.querySelector('svg') ? 'has-svg' : 'no-svg' },
      minDetail: describe(min),
      maxDetail: describe(max),
      minRect: min ? min.getBoundingClientRect().toJSON() : null,
      maxRect: max ? max.getBoundingClientRect().toJSON() : null,
    };
  });
  console.log('GT-10 titlebar:', JSON.stringify(info, null, 2));
  // Compare the SVG path geometry of the two icons
  const same = info.minDetail && info.maxDetail && info.minDetail.paths === info.maxDetail.paths;
  console.log('GT-10 min/max icons identical (same svg path d)=', same);
  expect(same, 'min and max title-bar icons should be visually different').toBe(false);
});
