// TFL-1315 adversary probe - Activity Shelf diff-pass.
// Standalone (not an e2e spec): launches the real app through the canonical
// launcher and drives reachable attack classes. Prints JSON evidence.
// Run: env -u ELECTRON_RUN_AS_NODE node test-fixtures/tfl1315/probe.cjs
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const TMP = path.join(os.tmpdir(), 'tfl1315-fixtures');
fs.mkdirSync(TMP, { recursive: true });

const results = [];
function rec(name, data) {
  results.push({ probe: name, ...data });
  console.log(`PROBE ${name}: ${JSON.stringify(data)}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bigTxt() {
  const dst = path.join(TMP, `big-${Date.now()}.txt`);
  const lines = [];
  for (let i = 0; i < 120000; i += 1) lines.push(`Line ${i} of the activity shelf conversion fixture.`);
  fs.writeFileSync(dst, lines.join('\n'), 'utf8');
  return dst;
}
function copy(fixture) {
  const dst = path.join(TMP, `${path.basename(fixture, '.pdf')}-${Date.now()}.pdf`);
  fs.copyFileSync(path.join(ROOT, 'test-fixtures', fixture), dst);
  return dst;
}

async function mockOpen(app, filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
  const openBtn = appWin.locator('[data-toolbar-open]').first();
  if ((await openBtn.count()) > 0) await openBtn.click();
  else await appWin.locator('[data-home-tool="open"]').first().click();
}

async function shelfState(win) {
  return win.evaluate(() => {
    const row = document.querySelector('[data-activity-row]');
    const summary = document.querySelector('[data-activity-shelf-summary]');
    return {
      hasSummary: summary !== null,
      summaryRole: document.querySelector('[data-activity-shelf-role]')?.getAttribute('data-activity-shelf-role') ?? null,
      summaryActive: document.querySelector('[data-activity-shelf-active]')?.textContent ?? null,
      rowState: row?.getAttribute('data-activity-state') ?? null,
      rowText: row?.querySelector('[data-activity-row-text]')?.textContent ?? null,
      rows: document.querySelectorAll('[data-activity-row]').length,
      cancelCount: document.querySelectorAll('[data-activity-cancel]').length,
      actions: Array.from(document.querySelectorAll('[data-activity-action]')).map((e) => e.getAttribute('data-activity-action')),
      failedAlerts: Array.from(document.querySelectorAll('[data-activity-failed-items],[data-activity-failure-reason]')).map((e) => e.getAttribute('role')),
    };
  });
}

async function openPanel(win) {
  await win.locator('.activity-shelf-host').hover();
  if ((await win.locator('[data-activity-shelf-panel]').count()) === 0) {
    await win.locator('[data-activity-shelf-open]').click({ timeout: 8000 });
    await win.waitForSelector('[data-activity-shelf-panel]', { timeout: 8000 });
  }
}

async function toastTexts(win) {
  return win.evaluate(() => Array.from(document.querySelectorAll('.toast .toast-text')).map((e) => e.textContent || ''));
}

let app = null;
let appWin = null;

async function main() {
  app = await launchApp();
  appWin = await app.firstWindow();
  await appWin.waitForSelector('.sample-card', { timeout: 30000 });

  // ---- CLASS 3: error-toast durability -------------------------------------
  try {
    const bad = path.join(TMP, `not-a-doc-${Date.now()}.xyz`);
    fs.writeFileSync(bad, 'this is not a supported document');
    await mockOpen(app, bad);
    await sleep(1500);
    const t1 = await toastTexts(appWin);
    await sleep(7000);
    const t2 = await toastTexts(appWin);
    rec('class3-error-toast-durability', {
      after1_5s: t1, after8_5s: t2, persistsPast5s: JSON.stringify(t1) === JSON.stringify(t2) && t1.length > 0,
    });
    await appWin.screenshot({ path: path.join(SHOTS, 'tfl1315-c3-error-toast.png') });
    // dismiss any lingering toasts
    const closeBtns = appWin.locator('.toast-close');
    const n = await closeBtns.count();
    for (let i = 0; i < n; i += 1) { try { await closeBtns.nth(i).click({ timeout: 1500 }); } catch (_) {} }
  } catch (e) { rec('class3-error-toast-durability', { error: String(e) }); }

  // ---- CLASS 1 (non-cancelable) + CLASS 5: search-index --------------------
  try {
    await mockOpen(app, copy('report.pdf'));
    await appWin.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await sleep(600);
    await appWin.keyboard.press('Control+f');
    await appWin.waitForSelector('[aria-label="Search query"]', { timeout: 8000 });
    await appWin.locator('[aria-label="Search query"]').fill('the');
    await appWin.waitForSelector('[data-activity-shelf-summary]', { timeout: 30000 });
    const running = await shelfState(appWin);
    await openPanel(appWin);
    const panel = await shelfState(appWin);
    rec('class1-searchindex-noncancelable', { running, panel });
    await appWin.screenshot({ path: path.join(SHOTS, 'tfl1315-c1-searchindex.png') });
    // close panel
    const close = appWin.locator('[data-activity-shelf-close]');
    if ((await close.count()) > 0) await close.first().click();
    await appWin.keyboard.press('Escape');
  } catch (e) { rec('class1-searchindex-noncancelable', { error: String(e) }); }

  // ---- CLASS 1 + 4 + 7: conversion cancel then completion no-op ------------
  try {
    const big = bigTxt();
    await mockOpen(app, big);
    await appWin.waitForSelector('[data-activity-shelf-summary]', { timeout: 30000 });
    const running = await shelfState(appWin);
    await openPanel(appWin);
    const panelBefore = await shelfState(appWin);
    // Click the running conversion's Cancel if offered.
    const cancel = appWin.locator('[data-activity-cancel]');
    let cancelClicked = false;
    if ((await cancel.count()) > 0) { await cancel.first().click(); cancelClicked = true; }
    await sleep(400);
    const afterCancelClick = await shelfState(appWin);
    // Watch for settle.
    let settled = null;
    for (let i = 0; i < 60; i += 1) {
      await sleep(1000);
      const s = await shelfState(appWin);
      if (s.rowState && !['running', 'cancellation-requested'].includes(s.rowState)) { settled = s; break; }
    }
    rec('class1-convert-cancel', { running, panelBefore, cancelClicked, afterCancelClick, settled });
    await appWin.screenshot({ path: path.join(SHOTS, 'tfl1315-c1-convert-cancel.png') });
  } catch (e) { rec('class1-convert-cancel', { error: String(e) }); }

  // ---- CLASS 7: conversion completion + Open no-op -------------------------
  try {
    const big = bigTxt();
    await mockOpen(app, big);
    // Wait for a completed conversion row.
    let done = null;
    for (let i = 0; i < 180; i += 1) {
      await sleep(1000);
      const s = await shelfState(appWin);
      if (s.rowState === 'completed') { done = s; break; }
      if (s.rowState === 'failed') { done = s; break; }
    }
    await openPanel(appWin);
    const before = await appWin.evaluate(() => ({
      tabs: document.querySelectorAll('[data-document-rail-item],[data-tab]').length,
      canvases: document.querySelectorAll('.pdf-page canvas').length,
      activeTitle: document.querySelector('[data-active-title]')?.textContent ?? null,
    }));
    let clicked = null;
    const openAction = appWin.locator('[data-activity-action="open-result"]');
    if ((await openAction.count()) > 0) {
      await openAction.first().click();
      await sleep(800);
      clicked = 'open-result';
    } else {
      const vd = appWin.locator('[data-activity-action="view-details"]');
      if ((await vd.count()) > 0) { await vd.first().click(); await sleep(800); clicked = 'view-details'; }
    }
    const after = await appWin.evaluate(() => ({
      tabs: document.querySelectorAll('[data-document-rail-item],[data-tab]').length,
      canvases: document.querySelectorAll('.pdf-page canvas').length,
      activeTitle: document.querySelector('[data-active-title]')?.textContent ?? null,
      rows: document.querySelectorAll('[data-activity-row]').length,
      panelOpen: document.querySelector('[data-activity-shelf-panel]') !== null,
    }));
    rec('class7-convert-open-result', { done, clicked, before, after });
    await appWin.screenshot({ path: path.join(SHOTS, 'tfl1315-c7-open-result.png') });
  } catch (e) { rec('class7-convert-open-result', { error: String(e) }); }

  // ---- CLASS 1: OCR cancellation truthfulness via the dialog Cancel --------
  try {
    await mockOpen(app, copy('scanned.pdf'));
    await appWin.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await sleep(600);
    await appWin.keyboard.press('Control+k');
    await appWin.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
    await appWin.fill('[data-command-palette-input]', 'recognize');
    await sleep(300);
    await appWin.locator('[data-palette-tool-id="recognizeText"]').first().click();
    await appWin.waitForSelector('[data-ocr-confirm]', { timeout: 8000 });
    await appWin.click('[data-ocr-scope="currentPage"]');
    await sleep(150);
    await appWin.click('[data-ocr-confirm]');
    await appWin.waitForSelector('[data-activity-shelf-summary]', { timeout: 60000 });
    const during = await shelfState(appWin);
    // Click the OCR dialog's own Cancel (the shelf is occluded by the modal).
    const dialogCancel = appWin.locator('[data-ocr-cancel]');
    let dialogCancelClicked = false;
    if ((await dialogCancel.count()) > 0) { await dialogCancel.first().click(); dialogCancelClicked = true; }
    await sleep(500);
    const afterDialogCancel = await shelfState(appWin);
    let settled = null;
    for (let i = 0; i < 60; i += 1) {
      await sleep(1000);
      const s = await shelfState(appWin);
      if (s.rowState && !['running', 'cancellation-requested'].includes(s.rowState)) { settled = s; break; }
    }
    rec('class1-ocr-cancel', { during, dialogCancelClicked, afterDialogCancel, settled });
    await appWin.screenshot({ path: path.join(SHOTS, 'tfl1315-c1-ocr-cancel.png') });
  } catch (e) { rec('class1-ocr-cancel', { error: String(e) }); }

  fs.writeFileSync(path.join(ROOT, 'tfl1315_probe_results.json'), JSON.stringify(results, null, 2));
  console.log('WROTE tfl1315_probe_results.json');
}

main()
  .catch((e) => { console.log('FATAL ' + (e && e.stack ? e.stack : String(e))); })
  .finally(async () => {
    try { await hardClose(app, 'tfl1315'); } catch (_) {}
    process.exit(0);
  });
