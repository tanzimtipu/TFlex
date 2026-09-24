// QA ground-truth reproduction (installed v1.7.14) — item 3.
//
// Close the ENTIRE APP (window X / app quit) with an unsaved document open
// (make an edit, do NOT save). The operator reports there is currently NO
// prompt to save on app close.
//
// Launch only via e2e/lib/launch.cjs against the DEV build (historically: the packaged installed exe).

const { test, expect } = require('@playwright/test');
const { hardClose, gotoStage } = require('../lib/helpers.cjs');
const { launchApp } = require('../lib/launch.cjs');
const path = require('node:path');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test.setTimeout(300000);

let electronApp = null;
let win = null;

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

test('Item 3: closing the app (window X) with an unsaved document does NOT prompt to save', async () => {
  electronApp = await launchApp([]);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  await win.waitForTimeout(700);
  await openSampleFromCard('report.pdf');

  // Make an edit so the document is modified (rotates page 1).
  // Phase 36 (chunk 3) — Rotate is the PAGES dock's `rotate` verb.
  await gotoStage(win, 1);
  await win.click('[data-dock-verb="rotate"]');
  await win.waitForTimeout(1500);
  const modified = await win.evaluate(() => window.tflexDiagnostics().modified);
  const tabModified = await win.evaluate(() => window.tflexDiagnostics().tabModified);
  console.log(`[ITEM3] modified=${modified} tabModified=${tabModified}`);
  expect(modified || tabModified, 'the document must be modified after an edit').toBe(true);
  await shot('gt-item3-modified-before-close.png');

  // Track whether any window closes.
  let closed = false;
  let closeCount = 0;
  electronApp.on('window', (w) => {
    w.on('close', () => { closed = true; });
    w.on('closed', () => { closeCount += 1; });
  });

  // Click the window close (titlebar X).
  const closeBtn = win.locator('[data-window-close]').first();
  console.log(`[ITEM3] close button count=${await closeBtn.count()}`);
  await closeBtn.click();

  // Give it time: if there is a "save changes?" prompt it should mount now;
  // otherwise the window closes outright. Guarded so a closed window is a
  // RECORDED outcome rather than an unhandled throw.
  await win.waitForTimeout(1800).catch(() => {});

  // Check for ANY prompt / dialog still in the DOM.
  const prompt = await win.evaluate(() => {
    const sel = [
      '.modal-backdrop',
      '[data-close-tab-prompt]',
      '[data-close-prompt]',
      '.modal-dialog',
      '.toast',
      'text="Don\'t save"',
      'text="Save changes"',
      '[class*="close-tab"]',
      '[aria-label="Don\'t save"]',
      '[aria-label="Save changes"]',
    ].join(',');
    const els = document.querySelectorAll(sel);
    return Array.from(els).slice(0, 12).map((e) => (e.className || e.tagName)).join(' | ');
  }).catch(() => 'WINDOW-GONE');

  await shot('gt-item3-after-close-click.png').catch(() => {});
  const winAlive = await win.evaluate(() => 1).then(() => true).catch(() => false);
  console.log(`[ITEM3] closeCount=${closeCount} closedEvent=${closed} promptInDom="${prompt}" windowAlive=${winAlive}`);

  if (winAlive) {
    console.log('[ITEM3] RESULT: window still alive after X click; prompt/artifacts in DOM:', JSON.stringify(prompt));
  } else {
    console.log('[ITEM3] RESULT: window CLOSED with no save prompt.');
  }

  await hardClose(electronApp);
  electronApp = null;
  win = null;
});
