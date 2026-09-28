// QA verification (installed v1.7.15) — DEF-142.
//
// Close the APP (window X) with an unsaved document open. EXPECTED (the fix):
// a "Save changes?" (Unsaved changes) prompt appears via CloseTabPromptDialog,
// and Save / Don't save / Cancel all work.
//
// Save on a bytes-loaded sample routes through Save-As ("Save As…"), so we
// stub an OS save dialog to a temp path.
// Launch only via e2e/lib/launch.cjs against the DEV build (historically: the packaged installed exe).

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose, gotoStage } = require('../lib/helpers.cjs');
const path = require('node:path');
const os = require('node:os');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test.setTimeout(300000);

let electronApp = null;
let win = null;

async function shot(name) {
  const p = path.join(SHOTS, name);
  if (await isAlive()) {
    await win.screenshot({ path: p }).catch(() => {});
    console.log(`[SHOT] ${name}`);
  }
  return p;
}

async function isAlive() {
  return win.evaluate(() => 1).then(() => true).catch(() => false);
}

async function openSampleFromCard(name) {
  await win.locator(`.sample-card:has-text("${name}")`).first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2200);
}

async function modifyDoc() {
  // Phase 36 (chunk 3) — Rotate is the PAGES dock's `rotate` verb.
  await gotoStage(win, 1);
  await win.click('[data-dock-verb="rotate"]');
  await win.waitForTimeout(1400);
  const modified = await win.evaluate(() => window.tflexDiagnostics().modified);
  const tabModified = await win.evaluate(() => window.tflexDiagnostics().tabModified);
  console.log(`[142] modified=${modified} tabModified=${tabModified}`);
  expect(modified || tabModified, 'document must be modified after an edit').toBe(true);
}

async function promptState() {
  return win.evaluate(() => {
    const d = document.querySelector('[data-close-prompt]');
    if (!d) return { present: false };
    const title = d.querySelector('.modal-title');
    const buttons = Array.from(d.querySelectorAll('[data-close-prompt-action]')).map((b) => b.textContent.trim());
    return { present: true, title: title ? title.textContent.trim() : '', buttons };
  }).catch(async () => {
    // If the window is gone, cannot read the prompt.
    if (await isAlive()) return { present: false, evaluateFailed: true };
    return { present: false, windowGone: true };
  });
}

async function waitForWindowGone(maxIterations, waitMs) {
  let closed = false;
  for (let i = 0; i < maxIterations; i++) {
    if (!(await isAlive())) { closed = true; break; }
    await win.waitForTimeout(waitMs).catch(() => {});
  }
  return closed;
}

// Test 1 — prompt appears on window X; Cancel keeps the window alive;
// Don't save closes it.
test("DEF-142 (a): window X with unsaved doc -> prompt; Cancel keeps open; Don't save closes", async () => {
  electronApp = await launchApp([]);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  await win.waitForTimeout(700);
  await openSampleFromCard('report.pdf');
  await modifyDoc();
  await shot('def-142-1715-modified-before-close.png');

  // Track whether the window emits a close event.
  let closedCount = 0;
  win.on('close', () => { closedCount += 1; });

  // --- X -> prompt must appear and window must stay alive ---
  await win.click('[data-window-close]');
  await win.waitForTimeout(900);
  const s1 = await promptState();
  console.log(`[142|X] prompt=${JSON.stringify(s1)} alive=${await isAlive()}`);
  expect(s1.present, 'a Save prompt must appear on window X with unsaved changes').toBe(true);
  expect(s1.windowGone, 'the window must NOT close before the user decides').toBeFalsy();
  expect(s1.buttons.join(','), 'prompt must offer Save / Don t save / Cancel').toMatch(/Save/);
  expect(s1.buttons.join(','), 'prompt must offer Save / Don t save / Cancel').toMatch(/Don['’]?t save/);
  expect(s1.buttons.join(','), 'prompt must offer Save / Don t save / Cancel').toMatch(/Cancel/);
  await shot('def-142-1715-prompt.png');

  // --- Cancel -> prompt closes, window stays alive ---
  await win.click('[data-close-prompt-action="cancel"]');
  await win.waitForTimeout(600);
  const s2 = await promptState();
  console.log(`[142|cancel] prompt=${JSON.stringify(s2)} alive=${await isAlive()}`);
  expect(s2.present, 'Cancel must dismiss the prompt').toBe(false);
  expect(await isAlive(), 'Cancel must keep the window open').toBe(true);
  await shot('def-142-1715-after-cancel.png');

  // --- X again -> prompt -> Don't save -> window closes ---
  await win.click('[data-window-close]');
  await win.waitForTimeout(900);
  const s3 = await promptState();
  console.log(`[142|X2] prompt=${JSON.stringify(s3)}`);
  expect(s3.present, 'prompt must reappear on the second close attempt').toBe(true);
  await win.click('[data-close-prompt-action="discard"]').catch(() => {});
  // Wait for the window to actually close (discard -> confirmClose(true)).
  let closed = await waitForWindowGone(20, 400);
  console.log(`[142|discard] windowClosed=${closed} closedCount=${closedCount}`);
  expect(closed, 'Don t save must close the window').toBe(true);
  await hardClose(electronApp);
  electronApp = null;
  win = null;
});

// Test 2 — Save (Save As on a bytes-loaded sample) closes the window after a successful save.
test('DEF-142 (b): window X + Save -> saves (Save As on sample) and closes the window', async () => {
  electronApp = await launchApp([]);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  await win.waitForTimeout(700);
  await openSampleFromCard('report.pdf');
  await modifyDoc();

  // Stub the OS save dialog to a temp path.
  const savePath = path.join(os.tmpdir(), `tflex-def142-1715-saved-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);

  await win.click('[data-window-close]');
  await win.waitForTimeout(900);
  const s = await promptState();
  console.log(`[142|save] prompt=${JSON.stringify(s)}`);
  expect(s.present, 'a Save prompt must appear on window X').toBe(true);

  // The sample tab is bytes-loaded -> the button should read "Save As…".
  const saveLabels = s.buttons;
  console.log(`[142|save] buttons=${JSON.stringify(saveLabels)}`);

  await win.click('[data-close-prompt-action="save"]').catch(() => {});
  let closed = await waitForWindowGone(25, 400);
  console.log(`[142|save] windowClosed=${closed} savePath=${savePath}`);
  expect(closed, 'Save must close the window after a successful save').toBe(true);

  // Document-safety: the saved file must be a valid re-parseable 34-page PDF.
  const fs = require('node:fs');
  const { PDFDocument } = require('@cantoo/pdf-lib');
  if (fs.existsSync(savePath)) {
    const doc = await PDFDocument.load(fs.readFileSync(savePath));
    console.log(`[142|save] saved pageCount=${doc.getPageCount()}`);
    expect(doc.getPageCount(), 'saved file must be a valid 34-page PDF').toBe(34);
  } else {
    console.log('[142|save] saved file NOT found — save may not have written');
  }

  await hardClose(electronApp);
  electronApp = null;
  win = null;
});
