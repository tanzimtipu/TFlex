// QA document-safety verification (installed v1.7.17) — BUG 2 re-edit revert.
//
// Edit title "TFlex Technical Report" -> "NEW TITLE 123", confirm. Then
// RE-CLICK the edited text (the editor shows the OLD "TFlex Technical Report")
// and CONFIRM again. The bug commits the OLD text. What lands in the SAVED
// file — NEW or OLD title? If OLD, the user's edit is silently reverted on a
// re-edit, which is a document-integrity concern.

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

async function findTextRun(text) {
  return win.evaluate((needle) => {
    const spans = Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'));
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      if (t.length > 0 && t.includes(needle.split(' ')[0])) {
        const r = s.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return { rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
      }
    }
    return null;
  }, text);
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

test('BUG2 doc-safety: re-confirming the stale OLD text reverts the user edit in the saved PDF?', async () => {
  await openSampleFromCard('report.pdf');
  await scrollToPage1();

  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="text"]');
  await win.waitForTimeout(500);

  const run = await findTextRun('TFlex Technical Report');
  expect(run, 'title run must exist').toBeTruthy();
  await win.mouse.click(run.rect.x + run.rect.w / 2, run.rect.y + run.rect.h / 2);
  await win.waitForTimeout(700);

  const ta = win.locator('[data-edit-textarea]').first();
  await ta.fill('NEW TITLE 123');
  await win.waitForTimeout(300);
  await win.click('[aria-label="Apply edit"]');
  await win.waitForTimeout(1800);

  const afterEdit = await page1TextMesh();
  console.log(`[BUG2|AFTER-EDIT] "${afterEdit.text}"`);

  // Re-click the edited text; the editor shows the OLD text. Confirm again.
  const newRun = await findTextRun('NEW TITLE 123');
  if (newRun) {
    await win.mouse.click(newRun.rect.x + newRun.rect.w / 2, newRun.rect.y + newRun.rect.h / 2);
  } else {
    await win.mouse.click(run.rect.x + run.rect.w / 2, run.rect.y + run.rect.h / 2);
  }
  await win.waitForTimeout(700);
  const ta2 = win.locator('[data-edit-textarea]').first();
  await ta2.fill('TFlex Technical Report'); // commit the OLD text (as the buggy editor would show)
  await win.waitForTimeout(300);
  await win.click('[aria-label="Apply edit"]');
  await win.waitForTimeout(1800);
  const afterReedit = await page1TextMesh();
  console.log(`[BUG2|AFTER-REEDIT] "${afterReedit.text}"`);
  await shot('gt-bug2-docsafety-after-reedit.png');

  // Save-As and reopen.
  const savePath = path.join(os.tmpdir(), `tflex-bug2-docsafety-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[aria-label="Save As"]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(1600);
  console.log(`[BUG2] saved exists=${fs.existsSync(savePath)}`);

  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, savePath);
  await win.locator('button.btn-primary:has-text("Open")').first().click();
  await win.waitForTimeout(2000);
  await scrollToPage1();
  const reopened = await page1TextMesh();
  console.log(`[BUG2|REOPENED] "${reopened.text}"`);
  await shot('gt-bug2-docsafety-reopened.png');

  const showsNew = /NEW TITLE 123/i.test(reopened.text);
  const showsOld = /TFlex Technical Report/i.test(reopened.text);
  console.log(`[BUG2|VERDICT] reopened showsNEW=${showsNew} showsOLD=${showsOld}`);
  expect(true).toBe(true); // report only
});
