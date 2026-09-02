// Ground-truth reproduction on the INSTALLED app. Bugs 1, 2a, 2b, 5.
// Relaunches a fresh app instance per test so each starts on the welcome screen.
const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const path = require('node:path');

const EXE_PATH = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';
const SCREENSHOT_DIR = path.resolve(__dirname, '..', '..', 'screenshots');

let electronApp;
let win;

test.beforeEach(async () => {
  electronApp = await launchApp([], null, EXE_PATH);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
});

test.afterEach(async () => {
  if (electronApp) await electronApp.close();
});

async function openReport() {
  const samplePath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, samplePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [samplePath] });
  }, samplePath);
  await win.click('button:has-text("Open PDF")');
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);
}

async function diag() {
  return win.evaluate(() => window.tflexDiagnostics());
}

test('Bug 1: click already-placed signature -> no selector (center-click)', async () => {
  await openReport();

  await win.click('button[aria-label="Sign tool"]');
  await win.waitForSelector('.sig-manager', { timeout: 20000 });
  await win.click('.sig-tab:has-text("Type")');
  await win.fill('input[aria-label="Type your signature"]', 'QA Repro');
  await win.click('.sig-manager button:text-is("Save")');
  await win.waitForTimeout(400);
  await win.click('.sig-saved-pick');
  await win.waitForTimeout(400);

  const page = win.locator('.page-slot').first();
  const box = await page.boundingBox();
  await win.mouse.click(box.x + 300, box.y + 300);
  await win.waitForSelector('[data-sig-action-bar]', { timeout: 10000 });
  await win.click('[data-sig-action="confirm"]');
  await win.waitForTimeout(1000);
  await expect(win.locator('[data-sig-action-bar]')).toBeHidden();
  await win.screenshot({ path: path.join(SCREENSHOT_DIR, 'gt-bug1-confirmed.png') });

  // Re-click the placement by its ACTUAL on-screen center.
  const placement = win.locator('.sig-placement').first();
  await placement.waitFor({ timeout: 10000 });
  const pbox = await placement.boundingBox();
  console.log('[BUG1] placement boundingBox=', JSON.stringify(pbox));
  await win.mouse.click(pbox.x + pbox.width / 2, pbox.y + pbox.height / 2);
  await win.waitForTimeout(800);

  const handles = await win.locator('.sig-placement .sig-handle').count();
  const selected = await win.locator('.sig-placement-selected').count();
  const placed = await win.locator('.sig-placement').count();
  const d = await diag();
  const engSigs = (d.engineState && (d.engineState.signatures ?? d.engineState.placedSignatures))?.length ?? 0;
  console.log('[BUG1] placed=', placed, 'afterRebodyClick selected=', selected, 'handles=', handles, 'engineSigs=', engSigs);
  await win.screenshot({ path: path.join(SCREENSHOT_DIR, 'gt-bug1-after-reclick.png') });
});

test('Bug 2a/2b: edit title -> stale old run + live render', async () => {
  await openReport();

  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-tool="text"]', { timeout: 10000 });
  await win.click('[data-edit-tool="text"]');
  await win.waitForTimeout(600);

  // Locate the title text run in the pdf.js textLayer and click its center.
  const titleRect = await win.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('.textLayer span')).filter(s => s.textContent.includes('Technical Report'));
    if (spans.length === 0) return null;
    const r = spans[0].getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  console.log('[BUG2] titleRect=', JSON.stringify(titleRect));
  if (titleRect !== null) {
    await win.mouse.move(titleRect.x + titleRect.w / 2, titleRect.y + titleRect.h / 2);
    await win.waitForTimeout(400);
    await win.screenshot({ path: path.join(SCREENSHOT_DIR, 'gt-bug2a-hover.png') });
    await win.mouse.click(titleRect.x + titleRect.w / 2, titleRect.y + titleRect.h / 2);
  }
  await win.waitForTimeout(600);
  const editorCount = await win.locator('[data-edit-editor="edit"]').count();
  console.log('[BUG2] editor count=', editorCount);
  if (editorCount === 0) {
    await win.screenshot({ path: path.join(SCREENSHOT_DIR, 'gt-bug2a-no-editor.png') });
    console.log('[BUG2] NO EDITOR OPENED');
    return;
  }
  await win.screenshot({ path: path.join(SCREENSHOT_DIR, 'gt-bug2a-editor-open.png') });
  const prefilled = await win.inputValue('[data-edit-textarea]');
  console.log('[BUG2] prefill=', JSON.stringify(prefilled));

  // 2b: while editor open, check the live page view does NOT show new text yet
  await win.fill('[data-edit-textarea]', 'ZZZ REPLACEMENT TEXT 123');
  await win.waitForTimeout(300);
  const liveBefore = await win.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('.textLayer span')).map(s => s.textContent);
    return { hasNew: spans.includes('ZZZ REPLACEMENT TEXT 123'), hasOld: spans.includes('TFlex Technical Report') };
  });
  console.log('[BUG2B] while-editor-open liveBefore=', JSON.stringify(liveBefore));
  await win.screenshot({ path: path.join(SCREENSHOT_DIR, 'gt-bug2b-before-commit.png') });

  await win.keyboard.press('Control+Enter');
  await win.waitForTimeout(1800);
  await win.screenshot({ path: path.join(SCREENSHOT_DIR, 'gt-bug2a-after-commit.png') });

  const after = await win.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('.textLayer span')).map(s => ({ t: s.textContent, x: s.offsetLeft, y: s.offsetTop, w: s.offsetWidth, h: s.offsetHeight }));
    return spans;
  });
  const stale = after.filter(s => s.t === 'TFlex Technical Report');
  const fresh = after.filter(s => s.t === 'ZZZ REPLACEMENT TEXT 123');
  console.log('[BUG2A] after-commit staleOldTitle=', JSON.stringify(stale));
  console.log('[BUG2A] after-commit freshNewTitle=', JSON.stringify(fresh));
  console.log('[BUG2A] staleCount=', stale.length, 'freshCount=', fresh.length);
});

test('Bug 5: Add box — movable + live font', async () => {
  await openReport();

  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-tool="box"]', { timeout: 10000 });
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(600);

  const page = win.locator('.page-slot').first();
  const box = await page.boundingBox();
  await win.mouse.move(box.x + 180, box.y + 200);
  await win.mouse.down();
  await win.mouse.move(box.x + 420, box.y + 340, { steps: 8 });
  await win.mouse.up();
  await win.waitForSelector('[data-edit-editor="box"]', { timeout: 10000 });
  await win.screenshot({ path: path.join(SCREENSHOT_DIR, 'gt-bug5-box-editor-open.png') });

  await win.selectOption('[data-edit-editor="box"] select[aria-label="Font"]', 'Times');
  const areaFont = await win.evaluate(() => {
    const a = document.querySelector('[data-edit-textarea]');
    return a ? getComputedStyle(a).fontFamily : null;
  });
  console.log('[BUG5] textarea fontFamily after Times =', areaFont);
  await win.fill('[data-edit-textarea]', 'HELLO BOX ADDED 456');
  await win.screenshot({ path: path.join(SCREENSHOT_DIR, 'gt-bug5-box-typed.png') });
  await win.keyboard.press('Control+Enter');
  await win.waitForTimeout(1800);
  await win.screenshot({ path: path.join(SCREENSHOT_DIR, 'gt-bug5-after-commit.png') });

  const layerInfo = await win.evaluate(() => Array.from(document.querySelectorAll('.textLayer span')).map(s => s.textContent).join('|'));
  console.log('[BUG5] committed has HELLO=', layerInfo.includes('HELLO'), 'full=', layerInfo.includes('HELLO BOX ADDED 456'));

  const beforeCount = await win.locator('.edit-image-placement, .ann-textbox, .edit-box').count();
  await win.mouse.move(box.x + 300, box.y + 270);
  await win.mouse.down();
  await win.mouse.move(box.x + 500, box.y + 400, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(500);
  const moveTargets = await win.evaluate(() => ({
    imagePlacements: document.querySelectorAll('.edit-image-placement').length,
    annTextbox: document.querySelectorAll('[data-kind="textbox"], .ann-textbox').length,
    editBox: document.querySelectorAll('.edit-box, .edit-image-placement').length,
  }));
  console.log('[BUG5] movable overlay count before=', beforeCount, 'moveTargets=', JSON.stringify(moveTargets));
  await win.screenshot({ path: path.join(SCREENSHOT_DIR, 'gt-bug5-after-move-attempt.png') });
});
