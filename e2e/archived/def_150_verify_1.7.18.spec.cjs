// QA retest — DEF-150 (installed v1.7.18).
//
// Add box -> place "MOVE TEST 88" -> Apply. Reopen the committed box,
// MOVE the floating toolbox (drag its chrome), and confirm:
//   (a) a visible "Confirm" button appears (data-edit-confirm="true",
//       aria-label "Confirm move", "Confirm" text) — the commit-move
//       affordance the operator asked for.
//   (b) clicking Confirm moves the CONTENT box WITH the toolbox (the
//       box rect shifts by the drag offset), not the old "box sticks at
//       its original rect" bug.
//   (c) Save-As -> re-open the saved file -> page-1 text contains EXACTLY
//       ONE "MOVE TEST 88" (no duplicate baked into the user's document).
//       The saved bytes are parsed directly with pdfjs-dist (not the app
//       tab) so a second tab can never confuse the count.
//
// Asserts the FIXED behavior. Launch only via e2e/lib/launch.cjs against
// the DEV build (since 2026-09-05).

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const BOX_TEXT = 'MOVE TEST 88';

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

async function scrollToPage1() {
  await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector('.page-slot[data-page="1"]');
    if (sc && slot) sc.scrollTop = slot.offsetTop - 10;
  });
  await win.waitForTimeout(1000);
}

// Committed box SURFACE rect (`.edit-box[data-edit-box-id]`, excluding the
// shared-id action-bar toolbar).
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

// Read the commit button's confirm affordance state.
async function confirmAffordance(label) {
  const info = await win.evaluate(() => {
    const e = document.querySelector('.edit-inline-editor');
    if (!e) return { present: false };
    const btn = e.querySelector('[data-edit-confirm]');
    if (!btn) return { present: true, hasBtn: false };
    return {
      present: true,
      hasBtn: true,
      attr: btn.getAttribute('data-edit-confirm'),
      aria: btn.getAttribute('aria-label'),
      title: btn.getAttribute('title'),
      text: (btn.textContent || '').trim(),
    };
  });
  console.log(`[CONFIRM|${label}] ${JSON.stringify(info)}`);
  return info;
}

// Parse a saved PDF with pdfjs-dist and return page-1 text content.
async function page1TextOfPdf(pdfPath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  let txt = '';
  tc.items.forEach((it) => { txt += it.str + ' '; });
  return (txt || '').replace(/\s+/g, ' ').trim();
}

test('DEF-150: reopen box -> move toolbox -> Confirm appears & moves content; save+reopen -> exactly ONE copy', async () => {
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
  await ta.fill(BOX_TEXT);
  await win.waitForTimeout(300);
  await win.click('[aria-label="Apply edit"]');
  await win.waitForTimeout(1600);

  const R0 = await boxRect('COMMITTED-R0');
  console.log(`[DEF-150|R0] box committed at ${JSON.stringify(R0)}`);
  expect(R0, 'committed box must exist').toBeTruthy();
  await shot('def-150-1718-committed.png');

  // (Baseline) confirm the commit button does NOT yet show the
  // confirm-move affordance (data-edit-confirm is "false").
  const preMoveAffordance = await confirmAffordance('BEFORE-MOVE');
  // Editor is closed after Apply, so this may be absent — the key check
  // is the AFTER-MOVE state below.

  // Reopen the committed box (click it).
  await win.mouse.click(R0.x + R0.w / 2, R0.y + R0.h / 2);
  await win.waitForTimeout(700);
  const editorOpen = await readEditor('REOPENED');
  expect(editorOpen.present, 'editor must reopen after clicking the box').toBe(true);
  expect(editorOpen.textareaValue, 'reopened editor must carry the committed box text').toBe(BOX_TEXT);
  await shot('def-150-1718-editor-reopened.png');

  // Move the TOOLBOX (drag its chrome).
  const bar = await win.evaluate(() => {
    const e = document.querySelector('.edit-inline-editor');
    const b = e && e.querySelector('[data-edit-drag-handle]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  console.log(`[DEF-150|DRAGBAR] ${JSON.stringify(bar)}`);
  expect(bar, 'editor drag handle must exist').toBeTruthy();
  const gx = bar.x + 5;
  const gy = bar.y + 5;
  await win.mouse.move(gx, gy);
  await win.mouse.down();
  await win.mouse.move(gx + 200, gy + 120, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(500);
  const editorAfterMove = await readEditor('AFTER-TOOLBOX-MOVE');
  const toolboxDx = editorAfterMove.rect.x - editorOpen.rect.x;
  const toolboxDy = editorAfterMove.rect.y - editorOpen.rect.y;
  console.log(`[DEF-150|TOOLBOX-MOVED] dx=${toolboxDx} dy=${toolboxDy}`);
  await shot('def-150-1718-editor-toolbox-moved.png');

  // (a) A "Confirm" button must now be present.
  const confirm = await confirmAffordance('AFTER-MOVE');
  expect(confirm.hasBtn, 'a Confirm/commit button must be present in the editor').toBe(true);
  console.log(`[DEF-150|CONFIRM] attr=${confirm.attr} aria=${confirm.aria} text="${confirm.text}"`);
  expect(confirm.attr, 'the commit button must flip to data-edit-confirm="true" after the toolbox moved').toBe('true');
  expect(/Confirm/i.test(confirm.aria || '') || /Confirm/i.test(confirm.text), 'the commit button must read as a "Confirm" affordance after the move').toBe(true);

  // (b) Click the Confirm button — the content box must move with the toolbox.
  const confirmBtn = win.locator('.edit-inline-editor [data-edit-confirm="true"]').first();
  await confirmBtn.click();
  await win.waitForTimeout(1600);
  const R1 = await boxRect('AFTER-CONFIRM');
  console.log(`[DEF-150|AFTER-CONFIRM] box rect=${JSON.stringify(R1)} (R0=${JSON.stringify(R0)} toolbox dx=${toolboxDx} dy=${toolboxDy})`);
  const boxMoved = R1 && R0 && (Math.abs(R1.x - (R0.x + toolboxDx)) < 25 && Math.abs(R1.y - (R0.y + toolboxDy)) < 25);
  const boxStayed = R1 && R0 && (Math.abs(R1.x - R0.x) < 8 && Math.abs(R1.y - R0.y) < 8);
  console.log(`[DEF-150|VERDICT-B] boxMovedWithToolbox=${boxMoved} boxStayedAtOriginal=${boxStayed}`);
  await shot('def-150-1718-after-confirm-moved.png');
  expect(boxMoved, 'confirming after moving the toolbox must move the CONTENT box with it (the box follows the toolbox), not stay at the original rect').toBe(true);

  // (c) Save-As -> parse the saved file -> exactly ONE "MOVE TEST 88".
  const savePath = path.join(os.tmpdir(), `tflex-def150-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[aria-label="Save As"]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(1800);
  console.log(`[DEF-150] saved to ${savePath} (exists=${fs.existsSync(savePath)})`);
  expect(fs.existsSync(savePath), 'the saved file must exist on disk').toBe(true);

  const page1Text = await page1TextOfPdf(savePath);
  const count = (page1Text.match(/MOVE TEST 88/g) || []).length;
  console.log(`[DEF-150|DOCSAFETY] saved page-1 text="${page1Text}" occurrences=${count}`);
  await shot('def-150-1718-saved-doc.png');
  expect(count, 'the saved file must contain EXACTLY ONE "MOVE TEST 88" — no duplicate baked into the user\'s document').toBe(1);

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  console.log(`[DEF-150] pageErrors=${JSON.stringify(pageErrors)}`);
  expect(bad, 'no unhandled page-request / React-hook / NaN errors').toHaveLength(0);

  console.log(`[DEF-150|RESULT] PASS`);
});
