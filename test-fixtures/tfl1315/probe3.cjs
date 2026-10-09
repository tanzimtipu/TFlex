// TFL-1315 adversary probe v3 - corrected: open the panel during the run so
// [data-activity-row] exists; poll row state to terminal; then exercise
// open-result. Also a summary-based OCR-cancel truthfulness probe.
// Run: env -u ELECTRON_RUN_AS_NODE node test-fixtures/tfl1315/probe3.cjs
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'screenshots');
const TMP = path.join(os.tmpdir(), 'tfl1315-fixtures');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
const results = [];
const rec = (n, d) => { results.push({ probe: n, ...d }); console.log(`PROBE ${n}: ${JSON.stringify(d)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function bigTxt(n) {
  const dst = path.join(TMP, `big3-${n}-${Date.now()}.txt`);
  const lines = [];
  for (let i = 0; i < n; i += 1) lines.push(`Line ${i} of the activity shelf conversion fixture.`);
  fs.writeFileSync(dst, lines.join('\n'), 'utf8');
  return dst;
}
async function snap(win) {
  return win.evaluate(() => {
    const row = document.querySelector('[data-activity-row]');
    const cancel = document.querySelector('[data-activity-cancel]');
    return {
      panel: document.querySelector('[data-activity-shelf-panel]') !== null,
      rowState: row ? row.getAttribute('data-activity-state') : null,
      rowText: row ? (row.querySelector('[data-activity-row-text]') || {}).textContent : null,
      cancelLabel: cancel ? cancel.textContent : null,
      actions: Array.from(document.querySelectorAll('[data-activity-action]')).map((e) => e.getAttribute('data-activity-action')),
      summaryRole: document.querySelector('[data-activity-shelf-role]') ? document.querySelector('[data-activity-shelf-role]').getAttribute('data-activity-shelf-role') : null,
      summaryActive: document.querySelector('[data-activity-shelf-active]') ? document.querySelector('[data-activity-shelf-active]').textContent : null,
    };
  });
}
async function launchWith(file) {
  const app = await launchApp([file]);
  const win = await app.firstWindow();
  return { app, win };
}
async function openPanel(win) {
  await win.locator('.activity-shelf-host').hover();
  if ((await win.locator('[data-activity-shelf-panel]').count()) === 0) {
    await win.locator('[data-activity-shelf-open]').click({ timeout: 8000 });
    await win.waitForSelector('[data-activity-shelf-panel]', { timeout: 8000 });
  }
}
async function main() {
  // ---- CLASS 7: conversion completion + open-result ------------------------
  {
    let app = null;
    try {
      const r = await launchWith(bigTxt(40000));
      app = r.app; const win = r.win;
      await win.waitForSelector('[data-activity-shelf-summary]', { timeout: 45000 });
      await openPanel(win);
      let last = null; let done = null;
      for (let i = 0; i < 300; i += 1) {
        last = await snap(win);
        if (last.rowState === 'completed' || last.rowState === 'failed' || last.rowState === 'cancelled') { done = last; break; }
        await sleep(1000);
      }
      const before = await snap(win);
      const tabsBefore = await win.evaluate(() => document.querySelectorAll('[data-document-rail-item],[data-tab],[role="tab"]').length);
      let clicked = null; let after = null;
      const openAction = win.locator('[data-activity-action="open-result"]');
      if ((await openAction.count()) > 0) {
        await openAction.first().click();
        clicked = 'open-result';
        await sleep(1200);
        after = await snap(win);
      } else {
        clicked = 'none-offered';
      }
      const tabsAfter = await win.evaluate(() => document.querySelectorAll('[data-document-rail-item],[data-tab],[role="tab"]').length);
      rec('class7-convert-open-result', { last, done, before, clicked, after, tabsBefore, tabsAfter });
      await win.screenshot({ path: path.join(SHOTS, 'tfl1315-c7-open-result.png') });
    } catch (e) { rec('class7-convert-open-result', { error: String(e) }); }
    finally { if (app) await hardClose(app, 'c7b'); }
  }

  // ---- CLASS 1: OCR cancellation truthfulness (summary-based) --------------
  {
    let app = null;
    try {
      const r = await launchWith(path.join(ROOT, 'test-fixtures', 'scanned.pdf'));
      app = r.app; const win = r.win;
      await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
      await win.keyboard.press('Control+k');
      await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
      await win.fill('[data-command-palette-input]', 'recognize');
      await sleep(300);
      await win.locator('[data-palette-tool-id="recognizeText"]').first().click();
      await win.waitForSelector('[data-ocr-confirm]', { timeout: 8000 });
      await win.click('[data-ocr-scope="currentPage"]');
      await sleep(150);
      await win.click('[data-ocr-confirm]');
      await win.waitForSelector('[data-activity-shelf-summary]', { timeout: 60000 });
      const during = await snap(win);
      // The OCR dialog stays modal while running; the shelf is occluded.
      const occluded = await win.evaluate(() => {
        const el = document.querySelector('[data-activity-shelf-summary]');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return { top: top ? top.className : null, self: top === el || el.contains(top) };
      });
      let clicked = false;
      const dc = win.locator('[data-ocr-cancel]');
      if ((await dc.count()) > 0) { await dc.first().click(); clicked = true; }
      await sleep(600);
      const afterClick = await snap(win);
      // Poll the summary (rows are hidden while the modal is up).
      let settled = null;
      for (let i = 0; i < 90; i += 1) {
        await sleep(1000);
        const s = await snap(win);
        if (s.summaryRole && s.summaryRole !== 'progress') { settled = s; break; }
      }
      const dialogAfter = await win.evaluate(() => ({
        dialogOpen: document.querySelector('.ocr-dialog') !== null,
        cancelBtn: document.querySelector('[data-ocr-cancel]') ? document.querySelector('[data-ocr-cancel]').textContent : null,
        closeBtn: document.querySelector('[data-ocr-close]') ? document.querySelector('[data-ocr-close]').textContent : null,
      }));
      rec('class1-ocr-cancel', { during, occluded, clicked, afterClick, settled, dialogAfter });
      await win.screenshot({ path: path.join(SHOTS, 'tfl1315-c1-ocr-cancel.png') });
    } catch (e) { rec('class1-ocr-cancel', { error: String(e) }); }
    finally { if (app) await hardClose(app, 'c1ob'); }
  }

  fs.writeFileSync(path.join(ROOT, 'tfl1315_probe3_results.json'), JSON.stringify(results, null, 2));
  console.log('WROTE tfl1315_probe3_results.json');
}
main().catch((e) => { console.log('FATAL ' + (e && e.stack ? e.stack : String(e))); }).finally(() => process.exit(0));
