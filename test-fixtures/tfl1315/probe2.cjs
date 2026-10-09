// TFL-1315 adversary probe v2 - argv-based direct opens (the intake tray now
// intercepts the generic Open dialog, so documents are opened via the OS-open
// path, which routes through the real open/convert flows).
// Run: env -u ELECTRON_RUN_AS_NODE node test-fixtures/tfl1315/probe2.cjs
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
function rec(name, data) { results.push({ probe: name, ...data }); console.log(`PROBE ${name}: ${JSON.stringify(data)}`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bigTxt(n = 150000) {
  const dst = path.join(TMP, `big-${n}-${Date.now()}.txt`);
  const lines = [];
  for (let i = 0; i < n; i += 1) lines.push(`Line ${i} of the activity shelf conversion fixture.`);
  fs.writeFileSync(dst, lines.join('\n'), 'utf8');
  return dst;
}
function corruptPdf() {
  const dst = path.join(TMP, `corrupt-${Date.now()}.pdf`);
  fs.writeFileSync(dst, '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n' + 'FFFF'.repeat(2000));
  return dst;
}

async function shelfState(win) {
  return win.evaluate(() => {
    const row = document.querySelector('[data-activity-row]');
    return {
      hasSummary: document.querySelector('[data-activity-shelf-summary]') !== null,
      summaryRole: document.querySelector('[data-activity-shelf-role]')?.getAttribute('data-activity-shelf-role') ?? null,
      summaryActive: document.querySelector('[data-activity-shelf-active]')?.textContent ?? null,
      rowState: row?.getAttribute('data-activity-state') ?? null,
      rowText: row?.querySelector('[data-activity-row-text]')?.textContent ?? null,
      rows: document.querySelectorAll('[data-activity-row]').length,
      cancelCount: document.querySelectorAll('[data-activity-cancel]').length,
      actions: Array.from(document.querySelectorAll('[data-activity-action]')).map((e) => e.getAttribute('data-activity-action')),
      summaryLive: document.querySelector('[data-activity-shelf-summary]')?.getAttribute('aria-live') ?? null,
      summaryRoleAttr: document.querySelector('[data-activity-shelf-summary]')?.getAttribute('role') ?? null,
      failedRoles: Array.from(document.querySelectorAll('[data-activity-failed-items],[data-activity-failure-reason]')).map((e) => e.getAttribute('role')),
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

async function launchWith(file) {
  const app = await launchApp([file]);
  const win = await app.firstWindow();
  return { app, win };
}

async function main() {
  // ---- CLASS 6 + CLASS 1 (convert): renderer responsive while converting ----
  {
    let app = null;
    try {
      const big = bigTxt();
      const r = await launchWith(big);
      app = r.app;
      const win = r.win;
      await win.waitForSelector('[data-activity-shelf-summary]', { timeout: 45000 });
      const running = await shelfState(win);
      // Responsiveness: rAF must fire promptly while the conversion runs.
      const raf = await win.evaluate(() => new Promise((res) => {
        const t0 = performance.now();
        requestAnimationFrame(() => res(Math.round(performance.now() - t0)));
        setTimeout(() => res(-1), 3000);
      }));
      const evals = [];
      for (let i = 0; i < 5; i += 1) {
        const t = Date.now();
        await win.evaluate(() => Date.now());
        evals.push(Date.now() - t);
      }
      rec('class6-renderer-responsive', { running, rafDelayMs: raf, evaluateLatencyMs: evals });
      await win.screenshot({ path: path.join(SHOTS, 'tfl1315-c6-responsive.png') });
    } catch (e) { rec('class6-renderer-responsive', { error: String(e) }); }
    finally { if (app) await hardClose(app, 'c6'); }
  }

  // ---- CLASS 1: conversion cancel (truthfulness) ---------------------------
  {
    let app = null;
    try {
      const r = await launchWith(bigTxt());
      app = r.app;
      const win = r.win;
      await win.waitForSelector('[data-activity-shelf-summary]', { timeout: 45000 });
      const running = await shelfState(win);
      await openPanel(win);
      const panelBefore = await shelfState(win);
      let clicked = false;
      const cancel = win.locator('[data-activity-cancel]');
      if ((await cancel.count()) > 0) { await cancel.first().click(); clicked = true; }
      await sleep(300);
      const afterClick = await shelfState(win);
      let settled = null;
      for (let i = 0; i < 120; i += 1) {
        await sleep(1000);
        const s = await shelfState(win);
        if (s.rowState && !['running', 'cancellation-requested'].includes(s.rowState)) { settled = s; break; }
      }
      rec('class1-convert-cancel', { running, panelBefore, clicked, afterClick, settled });
      await win.screenshot({ path: path.join(SHOTS, 'tfl1315-c1-convert-cancel.png') });
    } catch (e) { rec('class1-convert-cancel', { error: String(e) }); }
    finally { if (app) await hardClose(app, 'c1c'); }
  }

  // ---- CLASS 7: conversion completion + Open/View-details no-op ------------
  {
    let app = null;
    try {
      const r = await launchWith(bigTxt());
      app = r.app;
      const win = r.win;
      let done = null;
      for (let i = 0; i < 240; i += 1) {
        await sleep(1000);
        const s = await shelfState(win);
        if (s.rowState === 'completed' || s.rowState === 'failed') { done = s; break; }
      }
      await openPanel(win);
      const before = await win.evaluate(() => ({
        railItems: document.querySelectorAll('[data-document-rail-item],[data-tab]').length,
        canvases: document.querySelectorAll('canvas').length,
      }));
      let clicked = null;
      const openAction = win.locator('[data-activity-action="open-result"]');
      if ((await openAction.count()) > 0) { await openAction.first().click(); clicked = 'open-result'; await sleep(1000); }
      const afterOpen = await win.evaluate(() => ({
        railItems: document.querySelectorAll('[data-document-rail-item],[data-tab]').length,
        canvases: document.querySelectorAll('canvas').length,
        rows: document.querySelectorAll('[data-activity-row]').length,
      }));
      rec('class7-convert-open-result', { done, clicked, before, afterOpen });
      await win.screenshot({ path: path.join(SHOTS, 'tfl1315-c7-open-result.png') });
    } catch (e) { rec('class7-convert-open-result', { error: String(e) }); }
    finally { if (app) await hardClose(app, 'c7'); }
  }

  // ---- CLASS 1 (non-cancelable) + CLASS 5: search-index --------------------
  {
    let app = null;
    try {
      const r = await launchWith(path.join(ROOT, 'test-fixtures', 'report.pdf'));
      app = r.app;
      const win = r.win;
      await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
      await win.keyboard.press('Control+f');
      await win.waitForSelector('[aria-label="Search query"]', { timeout: 8000 });
      await win.locator('[aria-label="Search query"]').fill('the');
      await win.waitForSelector('[data-activity-shelf-summary]', { timeout: 30000 });
      const running = await shelfState(win);
      await openPanel(win);
      const panel = await shelfState(win);
      rec('class1-searchindex-noncancelable', { running, panel });
      await win.screenshot({ path: path.join(SHOTS, 'tfl1315-c1-searchindex.png') });
    } catch (e) { rec('class1-searchindex-noncancelable', { error: String(e) }); }
    finally { if (app) await hardClose(app, 'c5'); }
  }

  // ---- CLASS 1: OCR cancellation via the dialog ---------------------------
  {
    let app = null;
    try {
      const r = await launchWith(path.join(ROOT, 'test-fixtures', 'scanned.pdf'));
      app = r.app;
      const win = r.win;
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
      const during = await shelfState(win);
      let clicked = false;
      const dc = win.locator('[data-ocr-cancel]');
      if ((await dc.count()) > 0) { await dc.first().click(); clicked = true; }
      await sleep(500);
      const afterClick = await shelfState(win);
      let settled = null;
      for (let i = 0; i < 90; i += 1) {
        await sleep(1000);
        const s = await shelfState(win);
        if (s.rowState && !['running', 'cancellation-requested'].includes(s.rowState)) { settled = s; break; }
      }
      rec('class1-ocr-cancel', { during, clicked, afterClick, settled });
      await win.screenshot({ path: path.join(SHOTS, 'tfl1315-c1-ocr-cancel.png') });
    } catch (e) { rec('class1-ocr-cancel', { error: String(e) }); }
    finally { if (app) await hardClose(app, 'c1o'); }
  }

  // ---- CLASS 3: error-toast durability (corrupt PDF -> pdf.js parse error) --
  {
    let app = null;
    try {
      const r = await launchWith(corruptPdf());
      app = r.app;
      const win = r.win;
      await sleep(4000);
      const readToasts = () => Array.from(document.querySelectorAll('.toast')).map((e) => ({ cls: e.className, text: e.querySelector('.toast-text') ? e.querySelector('.toast-text').textContent : null }));
      const t1 = await win.evaluate(readToasts);
      await sleep(8500);
      const t2 = await win.evaluate(readToasts);
      rec('class3-error-toast-durability', { after4s: t1, after12_5s: t2 });
      await win.screenshot({ path: path.join(SHOTS, 'tfl1315-c3-error-toast.png') });
    } catch (e) { rec('class3-error-toast-durability', { error: String(e) }); }
    finally { if (app) await hardClose(app, 'c3'); }
  }

  fs.writeFileSync(path.join(ROOT, 'tfl1315_probe_results.json'), JSON.stringify(results, null, 2));
  console.log('WROTE tfl1315_probe_results.json');
}

main().catch((e) => { console.log('FATAL ' + (e && e.stack ? e.stack : String(e))); }).finally(() => process.exit(0));
