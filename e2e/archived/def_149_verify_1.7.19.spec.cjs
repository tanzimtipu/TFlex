// QA retest — DEF-149 move (installed v1.7.19).
//
// The orchestrator's single verification: edit text, replace the page-1 title
// with "NEW TITLE 123", confirm. Then MOVE the floating toolbox (drag its
// chrome) and confirm. The text must RELOCATE to the new spot with NO
// duplicate — exactly ONE "NEW TITLE 123" on page 1. Save-As -> re-open the
// saved file must still contain exactly ONE.
//
// Launch only via e2e/lib/launch.cjs against the DEV build (historically: the packaged installed exe).

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const OLD_TITLE = 'TFlex Technical Report';
const NEW_TITLE = 'NEW TITLE 123';

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

async function findTextRun(text) {
  return win.evaluate((needle) => {
    const spans = Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'));
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      if (t.length > 0 && t.includes(needle.split(' ')[0])) {
        const r = s.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, text: t };
      }
    }
    return null;
  }, text);
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

async function page1Text() {
  return win.evaluate(() => {
    const p = document.querySelector('.page-slot[data-page="1"]');
    if (!p) return { present: false, text: '' };
    const layer = p.querySelector('.textLayer');
    let joined = '';
    if (layer) layer.querySelectorAll('span').forEach((s) => { joined += s.textContent || ''; });
    return { present: true, text: (joined || '').replace(/[ \t\r\n]+/g, ' ').trim() };
  });
}

// Count page-1 textLayer occurrences of a substring.
async function page1Count(substr) {
  const t = await page1Text();
  const count = (t.text.match(new RegExp(substr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  return { count, text: t.text };
}

// Find the position of the text run matching a substring on page 1.
async function runPos(substr) {
  return win.evaluate((needle) => {
    const spans = Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'));
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      if (t.length > 0 && t.includes(needle)) {
        const r = s.getBoundingClientRect();
        if (r.width > 0) return { text: t, x: Math.round(r.x), y: Math.round(r.y) };
      }
    }
    return null;
  }, substr);
}

// Confirm the editor — click the Confirm-move affordance if present, else Ctrl+Enter.
async function confirmEditor() {
  const confirmBtn = await win.evaluate(() => {
    const b = document.querySelector('.edit-inline-editor [data-edit-confirm]');
    if (!b) return null;
    return { attr: b.getAttribute('data-edit-confirm'), label: b.getAttribute('aria-label') };
  });
  console.log(`[CONFIRM-AFFORDANCE] ${JSON.stringify(confirmBtn)}`);
  if (confirmBtn && confirmBtn.attr === 'true') {
    await win.locator('.edit-inline-editor [data-edit-confirm="true"]').first().click();
  } else {
    const ta2 = win.locator('[data-edit-textarea]').first();
    await ta2.click();
    await win.keyboard.press('Control+Enter');
  }
  await win.waitForTimeout(1400);
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

test('DEF-149 (v1.7.19): edit title -> move toolbox + confirm -> ONE run at the new spot; save+reopen still ONE', async () => {
  await openSampleFromCard('report.pdf');
  await scrollToPage1();

  // Enter Edit mode + Edit text tool.
  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="text"]');
  await win.waitForTimeout(500);
  await shot('def-149-1719-edit-text-tool.png');

  // Find + click the title run.
  const run = await findTextRun(OLD_TITLE);
  console.log(`[TEXTRUN] title run=${JSON.stringify(run)}`);
  expect(run, 'title text run must exist on page 1').toBeTruthy();
  const cx = run.rect.x + run.rect.w / 2;
  const cy = run.rect.y + run.rect.h / 2;
  await win.mouse.click(cx, cy);
  await win.waitForTimeout(700);

  const editor1 = await readEditor('AFTER-CLICK-TITLE');
  expect(editor1.textareaValue, 'editor must open pre-filled with the title').toBe(OLD_TITLE);

  // Replace the title with NEW_TITLE and confirm.
  const ta = win.locator('[data-edit-textarea]').first();
  await ta.fill(NEW_TITLE);
  await win.waitForTimeout(300);
  await shot('def-149-1719-editor-typed-new.png');
  await win.click('[aria-label="Apply edit"]');
  await win.waitForTimeout(1800);

  const afterCommit = await page1Text();
  console.log(`[AFTER-COMMIT] page1 text="${afterCommit.text}"`);
  expect(/NEW TITLE 123/i.test(afterCommit.text), 'page must show the new title after commit').toBe(true);
  await shot('def-149-1719-after-commit.png');

  // Re-open the editor on the edited run so we can move the toolbox.
  const newRun = await findTextRun(NEW_TITLE);
  console.log(`[NEWRUN] ${JSON.stringify(newRun)}`);
  expect(newRun, 'the edited run must be present on page 1').toBeTruthy();
  await win.mouse.click(newRun.rect.x + newRun.rect.w / 2, newRun.rect.y + newRun.rect.h / 2);
  await win.waitForTimeout(700);
  const editor2 = await readEditor('AFTER-RECLICK');
  expect(editor2.present, 'editor must reopen after clicking the edited run').toBe(true);
  expect(editor2.textareaValue, 'reopened editor must carry the NEW text').toBe(NEW_TITLE);
  await shot('def-149-1719-editor-after-reclick.png');

  // Record the title position BEFORE the toolbox move.
  const posBefore = await runPos('NEW TITLE 123');
  console.log(`[POS-BEFORE] ${JSON.stringify(posBefore)}`);
  expect(posBefore, 'the NEW TITLE 123 run must exist before the move').toBeTruthy();

  // Move the TOOLBOX (drag its chrome) +200/+120 and confirm.
  const bar = await win.evaluate(() => {
    const e = document.querySelector('.edit-inline-editor');
    const b = e && e.querySelector('[data-edit-drag-handle]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  console.log(`[DRAGBAR] ${JSON.stringify(bar)}`);
  expect(bar, 'editor drag handle must exist').toBeTruthy();
  const gx = bar.x + 5;
  const gy = bar.y + 5;
  await win.mouse.move(gx, gy);
  await win.mouse.down();
  await win.mouse.move(gx + 200, gy + 120, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(500);
  const editorAfterMove = await readEditor('AFTER-TOOLBOX-MOVE');
  const toolboxDx = editorAfterMove.rect.x - editor2.rect.x;
  const toolboxDy = editorAfterMove.rect.y - editor2.rect.y;
  console.log(`[TOOLBOX-MOVED] dx=${toolboxDx} dy=${toolboxDy}`);
  await shot('def-149-1719-editor-toolbox-moved.png');

  // Confirm the move.
  await confirmEditor();
  await shot('def-149-1719-after-move-confirm.png');

  // (1) NO duplicate: exactly ONE "NEW TITLE 123" on page 1 (document safety).
  const live = await page1Count(NEW_TITLE);
  console.log(`[LIVE-COUNT] occurrences=${live.count} text="${live.text}"`);

  // (2) The single run must be at the MOVED position (>= 120px horizontal shift).
  const posAfter = await runPos('NEW TITLE 123');
  console.log(`[POS-AFTER] ${JSON.stringify(posAfter)} (before=${JSON.stringify(posBefore)})`);
  const movedBy = posAfter ? Math.abs(posAfter.x - posBefore.x) : -1;
  console.log(`[MOVE] horizontal shift = ${movedBy}px`);

  // (3) Save-As to a temp path and verify the saved file holds exactly ONE.
  const savePath = path.join(os.tmpdir(), `tflex-def149-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[aria-label="Save As"]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(1800);
  console.log(`[SAVED] ${savePath} (exists=${fs.existsSync(savePath)})`);

  // Ground-truth: parse the saved bytes directly.
  const savedText = await page1TextOfPdf(savePath);
  const savedCount = (savedText.match(/NEW TITLE 123/g) || []).length;
  console.log(`[DOCSAFETY|PARSE] saved page-1 text="${savedText}" occurrences=${savedCount}`);

  // (4) Re-open the saved file in the app and re-count page 1.
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, savePath);
  await win.locator('button.btn-primary:has-text("Open")').first().click();
  await win.waitForTimeout(2400);
  await scrollToPage1();
  const reopened = await page1Count(NEW_TITLE);
  console.log(`[DOCSAFETY|REOPEN] page-1 occurrences=${reopened.count} text="${reopened.text}"`);
  await shot('def-149-1719-saved-reopened.png');

  // Assertions — document safety first (the top-severity concern), then the move.
  expect(live.count, 'page 1 must contain EXACTLY ONE "NEW TITLE 123" — no duplicate after move+confirm').toBe(1);
  expect(savedCount, 'the saved file must contain EXACTLY ONE "NEW TITLE 123"').toBe(1);
  expect(reopened.count, 'the REOPENED saved file must still contain EXACTLY ONE "NEW TITLE 123"').toBe(1);
  expect(posAfter, 'the moved run must still exist on page 1').toBeTruthy();
  expect(movedBy, 'after move+confirm the committed text must have relocated (>= 120px shift)').toBeGreaterThanOrEqual(120);

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  console.log(`[PAGEERRORS] ${JSON.stringify(pageErrors)}`);
  expect(bad, 'no unhandled page-request / React-hook / NaN errors').toHaveLength(0);

  console.log(`[DEF-149|RESULT] PASS`);
});
