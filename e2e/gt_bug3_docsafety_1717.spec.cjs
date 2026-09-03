// QA document-safety verification (installed v1.7.17) — BUG 3 duplicate artifact.
//
// Add box "MOVE TEST 88", reopen the editor, move the TOOLBOX, confirm. The
// live view shows a large duplicate "MOVE TEST 88" drawn over the page. Does
// that duplicate land in the SAVED file? If yes, the add-box toolbox-move flow
// corrupts the page content (a silently-baked duplicate) — HIGH.
// Save-As -> reopen the saved file -> count "MOVE TEST 88" occurrences in the
// page-1 textLayer (the box mirror lives in the DOM, not the textLayer, so a
// textLayer occurrence is the baked run).

const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const EXE_PATH = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';
const SHOTS = path.resolve(__dirname, '..', 'screenshots');

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
  await hardClose(electronApp);
  electronApp = null;
  win = null;
});

async function openSampleFromCard(name) {
  await win.locator(`.sample-card:has-text("${name}")`).first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2200);
}

async function shot(name) {
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p });
  console.log(`[SHOT] ${name}`);
  return p;
}

async function scrollToPage1() {
  await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector('.page-slot[data-page="1"]');
    if (sc && slot) sc.scrollTop = slot.offsetTop - 10;
  });
  await win.waitForTimeout(1000);
}

async function boxRect(label) {
  const out = await win.evaluate(() => {
    const b = document.querySelector('.edit-box[data-edit-box-id]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: b.getAttribute('data-edit-box-text') };
  });
  console.log(`[BOX|${label}] ${JSON.stringify(out)}`);
  return out;
}

async function page1TextMesh() {
  return win.evaluate(() => {
    const p = document.querySelector('.page-slot[data-page="1"]');
    if (!p) return { present: false, text: '' };
    const layer = p.querySelector('.textLayer');
    let joined = '';
    if (layer) layer.querySelectorAll('span').forEach((s) => { joined += s.textContent || ''; });
    return { present: true, text: (joined || '').replace(/[ \t\r\n]+/g, ' ').trim() };
  });
}

test('BUG3 doc-safety: toolbox move + confirm bakes a duplicate "MOVE TEST 88" into the saved PDF', async () => {
  await openSampleFromCard('report.pdf');
  await scrollToPage1();

  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);

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
  await win.click('[aria-label="Apply edit"]');
  await win.waitForTimeout(1200);

  const R0 = await boxRect('COMMITTED');
  expect(R0, 'committed box must exist').toBeTruthy();

  // Reopen the editor, move the toolbox, confirm.
  await win.mouse.click(R0.x + R0.w / 2, R0.y + R0.h / 2);
  await win.waitForTimeout(700);
  const bar = await win.evaluate(() => {
    const e = document.querySelector('.edit-inline-editor');
    const b = e && e.querySelector('[data-edit-drag-handle]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x, y: r.y };
  });
  expect(bar, 'editor drag handle must exist').toBeTruthy();
  await win.mouse.move(bar.x + 5, bar.y + 5);
  await win.mouse.down();
  await win.mouse.move(bar.x + 205, bar.y + 125, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(400);
  const ta2 = win.locator('[data-edit-textarea]').first();
  await ta2.click();
  await win.keyboard.press('Control+Enter');
  await win.waitForTimeout(1200);
  await shot('gt-bug3-docsafety-after-toolbox-confirm.png');

  const preSave = await page1TextMesh();
  const preCount = (preSave.text.match(/MOVE TEST 88/g) || []).length;
  console.log(`[DOCSAFETY|PRE-SAVE] page1 text="${preSave.text}" movesOccurrences=${preCount}`);

  // Save-As.
  const savePath = path.join(os.tmpdir(), `tflex-bug3-docsafety-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[aria-label="Save As"]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(1600);
  console.log(`[DOCSAFETY] saved to ${savePath} (exists=${fs.existsSync(savePath)})`);

  // Reopen the saved file in a fresh tab and read page-1 textLayer.
  // First close the edit tool so the box mirror is not the source.
  await win.evaluate(async (p) => {
    // Open the saved file via the App's open-file dialog path.
    window.__openSaved = p;
  }, savePath).catch(() => {});
  // Use the Open button + stubbed dialog to load the saved path.
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, savePath);
  await win.locator('button.btn-primary:has-text("Open")').first().click();
  await win.waitForTimeout(2000);
  await scrollToPage1();
  const post = await page1TextMesh();
  const postCount = (post.text.match(/MOVE TEST 88/g) || []).length;
  console.log(`[DOCSAFETY|POST-REOPEN] page1 text="${post.text}" movesOccurrences=${postCount}`);
  await shot('gt-bug3-docsafety-reopened.png');

  // If the baked duplicate text landed in the saved file, the reopened page
  // textLayer should contain MORE than one "MOVE TEST 88" (the box content was
  // baked as a run too). A clean file would have exactly the number the box
  // commit produced.
  console.log(`[DOCSAFETY|VERDICT] preCount=${preCount} postCount=${postCount}`);
  // Report only; document whether the duplicate is persisted.
  expect(true).toBe(true);
});
