// Phase 2 Gate - Adversarial harness v2 against the production build.
// Main-process dialogs are patched (renderer-side tflex API is read-only).
// Runs with --disable-gpu for GPU-stability in this environment.
const { _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const APP = 'C:/Users/tanzi/OneDrive/App Development/TFlex';
const FIXTURES = path.join(APP, 'test-fixtures');
const SCREENSHOTS = path.join(APP, 'screenshots');
const TEMP = process.env.TEMP || APP;
if (!fs.existsSync(SCREENSHOTS)) fs.mkdirSync(SCREENSHOTS, { recursive: true });

const results = [];
function record(id, title, pass, detail) {
  results.push({ id, title, pass, detail });
  console.log(`${pass ? 'PASS' : 'FINDING'} | ${id}: ${title}${detail ? ' | ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const electronApp = await electron.launch({
    args: [APP, '--disable-gpu', '--no-sandbox'],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: 'file://' + path.resolve(APP, 'dist/renderer/index.html').replace(/\\/g, '/'),
    },
  });
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 20000 });

  // ---- Patch MAIN-process dialogs so OS dialogs never block ----
  await electronApp.evaluate(async ({ dialog }) => {
    globalThis.__advDlg = { open: null, save: null };
    dialog.showOpenDialog = async () => {
      const p = globalThis.__advDlg && globalThis.__advDlg.open;
      return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] };
    };
    dialog.showSaveDialog = async () => {
      const p = globalThis.__advDlg && globalThis.__advDlg.save;
      return p ? { canceled: false, filePath: p } : { canceled: true, filePath: undefined };
    };
    return true;
  });
  const setDlg = (kind, p) =>
    electronApp.evaluate((_e, o) => { globalThis.__advDlg[o.which] = o.val; }, { which: kind, val: p });

  const diag = () => win.evaluate(() => (typeof window.tflexDiagnostics === 'function' ? window.tflexDiagnostics() : null));

  const openSample = async (name) => {
    await win.evaluate((n) => {
      const cards = Array.from(document.querySelectorAll('.sample-card'));
      const card = cards.find((c) => c.textContent.includes(n));
      if (card) card.click();
    }, name);
    for (let i = 0; i < 50; i++) {
      const d = await diag();
      if (d && d.openTabs >= 1 && d.pageCount > 0) return d;
      await sleep(200);
    }
    return diag();
  };

  const openFileTab = async (filePath) => {
    await setDlg('open', filePath);
    await win.click('.btn-primary:has-text("Open PDF")');
    await win.waitForTimeout(2000);
    return diag();
  };

  const closeActiveTab = async () => {
    await win.evaluate(() => { document.querySelector('.tab-close')?.click(); });
    await sleep(700);
  };

  const closeAllTabs = async () => {
    for (let i = 0; i < 20; i++) {
      const d = await diag();
      if (!d || d.openTabs <= 0) break;
      await win.evaluate(() => { document.querySelector('.tab-close')?.click(); });
      await sleep(500);
    }
  };

  // ---------------- Build huge merge fixtures (1020 pages) ----------
  const hugeA = path.join(TEMP, 'tflex-huge-A.pdf');
  const hugeB = path.join(TEMP, 'tflex-huge-B.pdf');
  const reportPath = path.join(APP, 'assets/samples/report.pdf');
  {
    const { PDFDocument } = require(path.join(APP, 'node_modules', '@cantoo', 'pdf-lib'));
    const report = await PDFDocument.load(fs.readFileSync(reportPath));
    const big = await PDFDocument.create();
    for (let i = 0; i < 30; i++) {
      const pages = await big.copyPages(report, report.getPageIndices());
      for (const p of pages) big.addPage(p);
    }
    fs.writeFileSync(hugeA, await big.save());
    fs.writeFileSync(hugeB, await big.save());
    console.log(`  huge fixtures: ${big.getPageCount()} pages each`);
  }

  // =====================================================================
  // 1. LAST-PAGE GUARD
  // =====================================================================
  console.log('\n=== 1. Last-page guard ===');
  await openSample('report.pdf');
  await sleep(1000);
  let d = await diag();
  const totalPages = d.pageCount;
  console.log(`  report.pdf opened: ${totalPages} pages`);

  let guardOK = false, guardDetail = '';
  try {
    let safety = 0;
    while (true) {
      const cnt = await win.evaluate(() => window.tflexDiagnostics()?.engineState?.pageCount);
      if (cnt <= 1) break;
      if (++safety > 100) { guardDetail = 'safety stop'; break; }
      await win.evaluate(() => {
        const thumb = document.querySelector('.thumb[data-page="2"]');
        if (thumb) thumb.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
      });
      await sleep(50);
      await win.evaluate(() => {
        const del = document.querySelector('button[aria-label="Delete this page"]');
        if (del) del.click();
      });
      await sleep(50);
    }
    d = await diag();
    await win.evaluate(() => {
      const thumb = document.querySelector('.thumb[data-page="1"]');
      if (thumb) thumb.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    });
    await sleep(150);
    const delState = await win.evaluate(() => {
      const del = document.querySelector('button[aria-label="Delete this page"]');
      return del ? { disabled: del.disabled } : { missing: true };
    });
    console.log(`  pages left=${d.pageCount}, delete btn=${JSON.stringify(delState)}`);
    if (d.pageCount === 1 && (delState.disabled === true || delState.missing)) {
      guardOK = true;
      guardDetail = `pageCount stays 1; guard active`;
    } else {
      guardDetail = `EXPECTED pageCount=1 got ${d.pageCount} btn=${JSON.stringify(delState)}`;
    }
    await win.screenshot({ path: path.join(SCREENSHOTS, 'adv-last-page-guard.png') });
  } catch (e) {
    guardDetail = 'EXCEPTION ' + e.message;
  }
  record('A1', 'Last-page guard prevents deleting final page (UI)', guardOK, guardDetail);

  const engineGuard = await win.evaluate(async () => {
    const api = window.tflex.engine;
    await api.loadDocument('adv-g1', 'C:/Users/tanzi/OneDrive/App Development/TFlex/assets/samples/report.pdf');
    let fail = null;
    for (let p = 33; p >= 0; p--) {
      const r = await api.applyOp('adv-g1', { kind: 'delete', page: p });
      if (!r.ok) { fail = { step: p, code: r.error.code, msg: r.error.message }; break; }
    }
    const st = await api.getState('adv-g1');
    return { fail, pageCount: st.value.pageCount };
  });
  console.log('  engine guard:', JSON.stringify(engineGuard));
  record('A2', 'Engine IPC rejects deleting the last remaining page', engineGuard.fail && engineGuard.fail.code === 'empty-range' && engineGuard.pageCount === 1, JSON.stringify(engineGuard));

  // =====================================================================
  // 2. ROTATION NORMALIZATION + UNDO BUTTON BUG CONFIRM
  // =====================================================================
  console.log('\n=== 2. Rotation normalization + undo button behavior ===');
  await closeActiveTab();
  await openSample('report.pdf');
  await sleep(600);
  const rotResult = await win.evaluate(async () => {
    const out = {};
    const clickCw = () => document.querySelector('button[aria-label="Rotate clockwise"]')?.click();
    const selectPage1 = () => {
      const thumb = document.querySelector('.thumb[data-page="1"]');
      if (!thumb) return false;
      thumb.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
      return true;
    };
    selectPage1(); await new Promise((r) => setTimeout(r, 100));
    clickCw(); await new Promise((r) => setTimeout(r, 100));
    clickCw(); await new Promise((r) => setTimeout(r, 200));
    out.after180 = window.tflexDiagnostics().engineState.rotations[0];
    clickCw(); await new Promise((r) => setTimeout(r, 100));
    clickCw(); await new Promise((r) => setTimeout(r, 200));
    out.after360 = window.tflexDiagnostics().engineState.rotations[0];
    // one undo via button
    document.querySelector('button[aria-label="Undo last change"]')?.click();
    await new Promise((r) => setTimeout(r, 300));
    out.afterFirstUndo = window.tflexDiagnostics().engineState.rotations[0];
    out.canUndoAfterFirstUndo = window.tflexDiagnostics().canUndo;
    const btn = document.querySelector('button[aria-label="Undo last change"]');
    out.undoBtnDisabled = btn ? btn.disabled : null;
    return out;
  });
  console.log('  rotation:', JSON.stringify(rotResult));
  record('B1', 'Rotate 180 then 360 normalizes (2 -> 0) in engine', rotResult.after180 === 2 && rotResult.after360 === 0, JSON.stringify(rotResult));
  record('B2', 'Undo button stays enabled while undo stack has entries', !(rotResult.afterFirstUndo === 3 && rotResult.undoBtnDisabled === true),
    `after 4 rotations + 1 undo: rot=${rotResult.afterFirstUndo} (3 more undos remain) but canUndo=${rotResult.canUndoAfterFirstUndo} and button disabled=${rotResult.undoBtnDisabled} - multi-step undo via the rail button is broken (Ctrl+Z still works)`);
  await win.screenshot({ path: path.join(SCREENSHOTS, 'adv-undo-button.png') });

  // =====================================================================
  // 3. REORDER WHILE HUGE MERGE IN FLIGHT
  // =====================================================================
  console.log('\n=== 3. Reorder while huge merge in flight ===');
  await closeActiveTab();
  await openSample('report.pdf');
  await sleep(600);
  const pageCountBefore = (await diag()).pageCount;
  await setDlg('open', hugeA);
  await win.click('button[aria-label="Merge with another PDF"]');
  await win.waitForSelector('.modal-dialog');
  await win.click('.modal-dialog button:has-text("Choose PDF")');
  await win.waitForTimeout(300);
  await win.click('.modal-footer button:has-text("Merge")');
  // immediately drag page 1 onto page 2 while merge in flight
  try {
    await win.locator('.thumb[data-page="1"]').dragTo(win.locator('.thumb[data-page="2"]'));
  } catch (e) {
    console.log('  drag during merge raised:', e.message.split('\n')[0]);
  }
  await win.waitForTimeout(4000);
  const after = await diag();
  const concToasts = await win.evaluate(() => Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent));
  const expected = pageCountBefore + 1020;
  console.log('  concurrent:', JSON.stringify({ before: pageCountBefore, after: after.pageCount, pc: after.engineState?.pageCount, canUndo: after.canUndo, modified: after.modified, toasts: concToasts }));
  record('C1', 'Reorder during huge merge: no crash, merged page count correct', after.pageCount === expected && after.engineState?.pageCount === expected, `expected ${expected} got ${after.pageCount}`);
  await win.screenshot({ path: path.join(SCREENSHOTS, 'adv-concurrent-merge-reorder.png') });

  // =====================================================================
  // 4. UNDO AFTER SAVE
  // =====================================================================
  console.log('\n=== 4. Undo after save / redo after new op ===');
  fs.copyFileSync(reportPath, path.join(TEMP, 'tflex-undo-copy.pdf'));
  const undoObs = await win.evaluate(async (p) => {
    const out = {};
    const api = window.tflex.engine;
    await api.loadDocument('adv-u1', p);
    await api.applyOp('adv-u1', { kind: 'rotate-cw', page: 0 });
    const saveRes = await api.save('adv-u1');
    out.saveOk = saveRes.ok;
    const st2 = await api.getState('adv-u1');
    out.modifiedAfterSave = st2.value.modified;
    const undoRes = await api.undo('adv-u1');
    out.undoAfterSave = undoRes.ok ? { ok: true, rot: undoRes.value.rotations[0] } : { ok: false, code: undoRes.error.code };
    await api.applyOp('adv-u1', { kind: 'rotate-ccw', page: 0 });
    await api.undo('adv-u1');
    await api.applyOp('adv-u1', { kind: 'rotate-cw', page: 0 });
    const redoRes = await api.redo('adv-u1');
    out.redoAfterNewOp = redoRes.ok ? { ok: true } : { ok: false, code: redoRes.error.code };
    return out;
  }, path.join(TEMP, 'tflex-undo-copy.pdf').replace(/\\/g, '/'));
  console.log('  undo/redo:', JSON.stringify(undoObs));
  record('D1', 'Undo past save returns nothing-to-undo cleanly', undoObs.undoAfterSave && undoObs.undoAfterSave.ok === false && undoObs.undoAfterSave.code === 'nothing-to-undo', JSON.stringify(undoObs.undoAfterSave));
  record('D2', 'Redo cleared after a new op follows the undo', undoObs.redoAfterNewOp && undoObs.redoAfterNewOp.ok === false && undoObs.redoAfterNewOp.code === 'nothing-to-redo', JSON.stringify(undoObs.redoAfterNewOp));

  // ---- Undo of split restores pages (UI) ----
  console.log('\n=== 4b. Undo split restores removed pages (UI) ===');
  await closeActiveTab();
  await openSample('report.pdf');
  await sleep(800);
  const splitUndo = await win.evaluate(async () => {
    const out = {};
    document.querySelector('button[aria-label="Extract or split pages"]').click();
    await new Promise((r) => setTimeout(r, 200));
    const input = document.querySelector('.modal-input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '1-10');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    Array.from(document.querySelectorAll('input[name="split-mode"]'))[1]?.click();
    await new Promise((r) => setTimeout(r, 100));
    Array.from(document.querySelectorAll('.modal-footer button')).find((b) => b.textContent.trim() === 'Split')?.click();
    await new Promise((r) => setTimeout(r, 2000));
    // new tab is active; its content is the split (10 pages). Switch to the
    // SOURCE tab via its title button.
    const titles = Array.from(document.querySelectorAll('.tab-title'));
    const activeTitle = document.querySelector('.tab-active .tab-title')?.textContent;
    out.activeTabTitle = activeTitle;
    if (titles.length > 1) {
      titles[0].click();
      await new Promise((r) => setTimeout(r, 500));
    }
    const d1 = window.tflexDiagnostics();
    out.sourceAfterSplit = d1.pageCount;
    document.querySelector('button[aria-label="Undo last change"]')?.click();
    await new Promise((r) => setTimeout(r, 600));
    const d2 = window.tflexDiagnostics();
    out.sourceAfterUndo = d2.pageCount;
    return out;
  });
  console.log('  undo split:', JSON.stringify(splitUndo));
  record('G1', 'Undo restores pages removed by split', splitUndo.sourceAfterSplit === 24 && splitUndo.sourceAfterUndo === 34, JSON.stringify(splitUndo));
  if (!(splitUndo.sourceAfterSplit === 24 && splitUndo.sourceAfterUndo === 34)) {
    await win.screenshot({ path: path.join(SCREENSHOTS, 'adv-undo-split.png') });
  }

  // =====================================================================
  // 5. SAVE AS TO READ-ONLY DESTINATION (UI, silent failure probe)
  // =====================================================================
  console.log('\n=== 5. Save-As to read-only destination ===');
  await closeAllTabs();
  const roTarget = path.join(TEMP, 'tflex-adv-readonly.pdf');
  try { fs.unlinkSync(roTarget); } catch (e) { /* ignore */ }
  fs.writeFileSync(roTarget, Buffer.from('placeholder'));
  try { fs.chmodSync(roTarget, 0o444); } catch (e) { console.log('  chmod warn: ' + e.message); }
  // sanity: write attempt must fail with EPERM
  try {
    fs.writeFileSync(roTarget, Buffer.from('overwrite-attempt'));
    console.log('  WARNING: read-only file is writable on this platform');
  } catch (e) {
    console.log('  read-only target confirmed (write fails: ' + e.code + ')');
  }
  fs.copyFileSync(reportPath, path.join(TEMP, 'tflex-saveas-src.pdf'));
  const srcCopy = path.join(TEMP, 'tflex-saveas-src.pdf');
  const afterOpen = await openFileTab(srcCopy);
  console.log(`  file tab opened: pageCount=${afterOpen.pageCount}, modified=${afterOpen.modified}`);
  // make a change (rotate page 1)
  await win.evaluate(() => {
    const thumb = document.querySelector('.thumb[data-page="1"]');
    thumb.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
  });
  await sleep(150);
  await win.evaluate(() => document.querySelector('button[aria-label="Rotate clockwise"]')?.click());
  // poll until modified
  let modP = null;
  for (let i = 0; i < 20; i++) {
    modP = await diag();
    if (modP && modP.modified === true) break;
    await sleep(200);
  }
  console.log(`  modified=${modP && modP.modified}, saveAsEnabled=${await win.evaluate(() => { const b = document.querySelector('button[aria-label="Save As"]'); return b ? !b.disabled : 'no-btn'; })}`);
  await setDlg('save', roTarget);
  // synthetic click (avoids Playwright actionability retries)
  await win.evaluate(() => document.querySelector('button[aria-label="Save As"]')?.click());
  await win.waitForTimeout(1500);
  const saveAsObserved = await win.evaluate(() => ({
    modifiedStill: window.tflexDiagnostics().modified,
    toasts: Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent),
    saveAsDisabled: document.querySelector('button[aria-label="Save As"]')?.disabled,
  }));
  const roTargetUnchanged = fs.readFileSync(roTarget).toString() === 'placeholder';
  console.log('  saveAs to read-only:', JSON.stringify(saveAsObserved), 'target unchanged=', roTargetUnchanged);
  record('E1', 'Save-As to read-only destination surfaces an error to the user', saveAsObserved.toasts.length > 0,
    `toasts=${JSON.stringify(saveAsObserved.toasts)} modifiedStill=${saveAsObserved.modifiedStill} targetUnchanged=${roTargetUnchanged} - engine.saveAs maps ALL write failures to code "cancelled"; renderer onSaveAs silently ignores "cancelled" (no toast)`);
  await win.screenshot({ path: path.join(SCREENSHOTS, 'adv-saveas-readonly.png') });

  // =====================================================================
  // 6. MERGE WITH NON-PDF VIA DIALOG FILTER BYPASS
  // =====================================================================
  console.log('\n=== 6. Merge with non-PDF ===');
  await closeAllTabs();
  await openSample('report.pdf');
  await sleep(600);
  await setDlg('open', path.join(FIXTURES, 'not-a-pdf.txt'));
  const nonPdf = await win.evaluate(async () => {
    const out = {};
    document.querySelector('button[aria-label="Merge with another PDF"]').click();
    await new Promise((r) => setTimeout(r, 200));
    Array.from(document.querySelectorAll('.modal-dialog button')).find((b) => b.textContent.includes('Choose PDF'))?.click();
    await new Promise((r) => setTimeout(r, 300));
    Array.from(document.querySelectorAll('.modal-footer button')).find((b) => b.textContent.trim() === 'Merge')?.click();
    await new Promise((r) => setTimeout(r, 1200));
    const dd = window.tflexDiagnostics();
    out.pageCount = dd.pageCount;
    out.canUndo = dd.canUndo;
    out.toasts = Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent);
    return out;
  });
  console.log('  non-PDF merge:', JSON.stringify(nonPdf));
  record('F1', 'Merge with non-PDF fails with toast, doc unchanged', nonPdf.pageCount === 34 && nonPdf.toasts.length > 0, JSON.stringify(nonPdf));
  if (!(nonPdf.pageCount === 34 && nonPdf.toasts.length > 0)) await win.screenshot({ path: path.join(SCREENSHOTS, 'adv-merge-nonpdf.png') });

  // =====================================================================
  // 7. RAPID MODIFIED-DOT TOGGLING
  // =====================================================================
  console.log('\n=== 7. Rapid modified-dot toggling ===');
  fs.copyFileSync(reportPath, path.join(TEMP, 'tflex-rapid.pdf'));
  const rapidObs = await win.evaluate(async (p) => {
    const out = {};
    const api = window.tflex.engine;
    await api.loadDocument('adv-r1', p);
    let errs = 0;
    let lastMod = null;
    for (let i = 0; i < 60; i++) {
      const r = await api.applyOp('adv-r1', { kind: 'rotate-cw', page: 0 });
      if (!r.ok) errs++;
      lastMod = r.ok ? r.value.modified : lastMod;
    }
    out.errs = errs;
    out.modifiedAfter60Ops = lastMod;
    await api.save('adv-r1');
    const st3 = await api.getState('adv-r1');
    out.modifiedAfterSave = st3.value.modified;
    const u = await api.undo('adv-r1');
    out.undoAfterSaveCode = u.ok ? 'ok' : u.error.code;
    return out;
  }, path.join(TEMP, 'tflex-rapid.pdf').replace(/\\/g, '/'));
  console.log('  rapid:', JSON.stringify(rapidObs));
  record('I1', 'Rapid ops no errors; modified clears on save; undo gone after save', rapidObs.errs === 0 && rapidObs.modifiedAfterSave === false && rapidObs.undoAfterSaveCode === 'nothing-to-undo', JSON.stringify(rapidObs));

  // =====================================================================
  // 8. SPLIT-ALL PAGES -> 0-page source -> save -> 0-page PDF
  // =====================================================================
  console.log('\n=== 8. Split-all pages leaves 0-page source ===');
  await closeAllTabs();
  fs.copyFileSync(reportPath, path.join(TEMP, 'tflex-splitall-src.pdf'));
  const splitallSrc = path.join(TEMP, 'tflex-splitall-src.pdf');
  await openFileTab(splitallSrc);
  const splitAll = await win.evaluate(async () => {
    const out = {};
    document.querySelector('button[aria-label="Extract or split pages"]').click();
    await new Promise((r) => setTimeout(r, 200));
    const input = document.querySelector('.modal-input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '1-34');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    Array.from(document.querySelectorAll('input[name="split-mode"]'))[1]?.click();
    await new Promise((r) => setTimeout(r, 100));
    Array.from(document.querySelectorAll('.modal-footer button')).find((b) => b.textContent.trim() === 'Split')?.click();
    await new Promise((r) => setTimeout(r, 2000));
    const titles = Array.from(document.querySelectorAll('.tab-title'));
    if (titles.length > 1) {
      titles[0].click();
      await new Promise((r) => setTimeout(r, 500));
    }
    const d = window.tflexDiagnostics();
    out.sourcePageCount = d.pageCount;
    out.modified = d.modified;
    const saveBtn = document.querySelector('button[aria-label="Save"]');
    out.saveEnabled = saveBtn ? !saveBtn.disabled : 'no-btn';
    return out;
  });
  console.log('  split all:', JSON.stringify(splitAll));
  record('H1', 'Split-all leaves 0-page source doc (inconsistent with last-page delete guard)', splitAll.sourcePageCount === 0, JSON.stringify(splitAll));
  await win.screenshot({ path: path.join(SCREENSHOTS, 'adv-split-all.png') });

  if (splitAll.saveEnabled === true) {
    await win.click('button[aria-label="Save"]');
    await win.waitForTimeout(1500);
    const reload0 = await win.evaluate(async (p) => {
      const api = window.tflex.engine;
      const r = await api.loadDocument('adv-0page-check', p);
      if (!r.ok) return { reloadErr: r.error.message };
      const st = await api.getState('adv-0page-check');
      return { pageCount: st.value.pageCount };
    }, splitallSrc.replace(/\\/g, '/'));
    const stat = fs.statSync(splitallSrc);
    console.log('  saved 0-page source:', JSON.stringify(reload0), 'size=' + stat.size);
    record('H2', 'Saved 0-page source PDF comes back with pages (state mismatch on disk)', reload0.reloadErr ? false : reload0.pageCount === 0,
      `in-memory after split-all: 0 pages; save wrote a file that reloads as ${reload0.pageCount} page(s) (pdf-lib zero-page save quirk) - empty document silently gains a blank page on disk`);
    // reopen via the app UI
    await closeAllTabs();
    await setDlg('open', splitallSrc);
    await win.click('.btn-primary:has-text("Open")');
    await win.waitForTimeout(1500);
    const open0 = await win.evaluate(() => {
      const d = window.tflexDiagnostics();
      return { pageCount: d.pageCount, toasts: Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent) };
    });
    console.log('  app reopen of saved 0-page source:', JSON.stringify(open0));
  } else {
    record('H2', 'Saved 0-page source PDF comes back with pages (state mismatch on disk)', false, 'save button not enabled - cannot demonstrate');
  }

  // =====================================================================
  // 9. CORRUPT BYTES INTO ENGINE loadDocumentBytes
  // =====================================================================
  console.log('\n=== 9. Corrupt bytes into engine loadDocumentBytes ===');
  const corruptInject = await win.evaluate(async () => {
    const out = {};
    const api = window.tflex.engine;
    const truncated = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    try {
      const r = await api.loadDocumentBytes('adv-c-a', truncated);
      out.caseA = r.ok ? { ok: true, pageCount: (await api.getState('adv-c-a')).value.pageCount } : { ok: false, rejected: true };
    } catch (e) { out.caseA = { thrown: e.message }; }
    try {
      const r = await api.loadDocumentBytes('adv-c-b', new Uint8Array(Buffer.from('This is not a PDF file at all.')));
      out.caseB = r.ok ? { ok: true, pageCount: (await api.getState('adv-c-b')).value.pageCount } : { ok: false, rejected: true };
    } catch (e) { out.caseB = { thrown: e.message }; }
    try {
      const r = await api.loadDocumentBytes('adv-c-c', new Uint8Array(0));
      out.caseC = r.ok ? { ok: true, pageCount: (await api.getState('adv-c-c')).value.pageCount } : { ok: false, rejected: true };
    } catch (e) { out.caseC = { thrown: e.message }; }
    // Case D: truncated middle (valid header + partial trailer)
    try {
      const partial = new Uint8Array(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(500, 32)]));
      const r = await api.loadDocumentBytes('adv-c-d', partial);
      out.caseD = r.ok ? { ok: true, pageCount: (await api.getState('adv-c-d')).value.pageCount } : { ok: false, rejected: true };
    } catch (e) { out.caseD = { thrown: e.message }; }
    return out;
  });
  console.log('  corrupt inject:', JSON.stringify(corruptInject));
  record('J1', 'Engine rejects corrupt/truncated bytes in loadDocumentBytes',
    corruptInject.caseA?.ok === false && corruptInject.caseB?.ok === false && corruptInject.caseC?.ok === false && corruptInject.caseD?.ok === false,
    JSON.stringify(corruptInject));

  // =====================================================================
  // 10. OPEN TRUNCATED PDF FROM DISK (sniff path)
  // =====================================================================
  console.log('\n=== 10. Open truncated PDF from disk ===');
  await closeAllTabs();
  await setDlg('open', path.join(FIXTURES, 'truncated.pdf'));
  await win.click('button:has-text("Open PDF")');
  await win.waitForTimeout(1500);
  const openTrunc = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return { pageCount: d.pageCount, openTabs: d.openTabs, toasts: Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent) };
  });
  console.log('  open truncated:', JSON.stringify(openTrunc));
  record('K1', 'Opening truncated PDF shows toast, no crash, no tab opened', openTrunc.toasts.length > 0 && openTrunc.openTabs === 0, JSON.stringify(openTrunc));
  await win.screenshot({ path: path.join(SCREENSHOTS, 'adv-open-truncated.png') });

  // =====================================================================
  // 11. SPLIT DIALOG EDGE INPUTS
  // =====================================================================
  console.log('\n=== 11. Split dialog edge inputs ===');
  await closeAllTabs();
  await openSample('report.pdf');
  await sleep(800);
  const edge = await win.evaluate(async () => {
    const inputs = ['0', '-1', '40', '1-99999', '999999', 'abc', '1,1,1,1', '10-5', '1-2-3', '5-10,2-3,7-7', '', '   ', '1-0.5', '+3', '3..4', '1-34', '34'];
    const out = [];
    for (const inp of inputs) {
      document.querySelector('button[aria-label="Extract or split pages"]').click();
      await new Promise((r) => setTimeout(r, 120));
      const input = document.querySelector('.modal-input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, inp);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 80));
      const confirmBtn = Array.from(document.querySelectorAll('.modal-footer button.btn-primary'));
      const disabled = confirmBtn.length ? confirmBtn[0].disabled : 'no-btn';
      const status = document.querySelector('.modal-status')?.textContent?.trim();
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise((r) => setTimeout(r, 80));
      out.push({ inp, disabled, status });
    }
    const d = window.tflexDiagnostics();
    return { results: out, pageCount: d.pageCount };
  });
  console.log('  edge:', JSON.stringify(edge.results));
  record('M1', 'Split dialog edge inputs handled without crash', edge.pageCount === 34 && edge.results.every((r) => r.disabled === true || (r.status && r.status.includes('selected'))), JSON.stringify(edge.results));

  // =====================================================================
  // 12. SAVE IN FLIGHT + CONCURRENT DELETE (race)
  // =====================================================================
  console.log('\n=== 12. Save in flight + concurrent delete ===');
  await closeAllTabs();
  fs.copyFileSync(reportPath, path.join(TEMP, 'tflex-race-src.pdf'));
  const raceObs = await win.evaluate(async (p) => {
    const out = {};
    const api = window.tflex.engine;
    await api.loadDocument('adv-race', p);
    const mergeRes = await api.merge('adv-race', [p], 'after');
    out.mergeResult = mergeRes.ok ? 'ok pages=' + mergeRes.value.pageCount : 'err ' + (mergeRes.error?.code || mergeRes.error);
    const n = mergeRes.ok ? mergeRes.value.pageCount : 34;
    const saveP = api.save('adv-race');
    const delP1 = api.applyOp('adv-race', { kind: 'delete', page: n - 1 });
    const delP2 = api.applyOp('adv-race', { kind: 'delete', page: n - 2 });
    const delP3 = api.applyOp('adv-race', { kind: 'delete', page: n - 3 });
    const saveRes = await saveP;
    const ds = await Promise.all([delP1, delP2, delP3]);
    out.saveOk = saveRes.ok;
    out.delResults = ds.map((x) => (x.ok ? 'ok' : x.error.code));
    const st = await api.getState('adv-race');
    out.modifiedAfter = st.value.modified;
    out.pageCountAfter = st.value.pageCount;
    const reload = await api.loadDocument('adv-race-check', p);
    if (reload.ok) {
      out.diskPageCount = (await api.getState('adv-race-check')).value.pageCount;
    } else {
      out.diskReloadErr = reload.error.message;
    }
    return out;
  }, path.join(TEMP, 'tflex-race-src.pdf').replace(/\\/g, '/'));
  console.log('  race:', JSON.stringify(raceObs));
  const consistent = raceObs.pageCountAfter !== undefined && raceObs.diskPageCount !== undefined && raceObs.pageCountAfter === raceObs.diskPageCount;
  record('L1', 'Concurrent delete during save keeps memory and disk consistent', consistent,
    `state=${raceObs.pageCountAfter} disk=${raceObs.diskPageCount} modifiedAfter=${raceObs.modifiedAfter} saveOk=${raceObs.saveOk} dels=${JSON.stringify(raceObs.delResults)}`);

  // =====================================================================
  // 13. REORDER / ROTATE EDGE PARAMS (engine contract)
  // =====================================================================
  console.log('\n=== 13. Engine param edge cases ===');
  const reorderEdge = await win.evaluate(async () => {
    const api = window.tflex.engine;
    await api.loadDocument('adv-re', 'C:/Users/tanzi/OneDrive/App Development/TFlex/assets/samples/report.pdf');
    const r1 = await api.applyOp('adv-re', { kind: 'reorder', page: 5, param: 5 });
    const r2 = await api.applyOp('adv-re', { kind: 'reorder', page: -1, param: 0 });
    const r3 = await api.applyOp('adv-re', { kind: 'reorder', page: 0, param: 999 });
    const r4 = await api.applyOp('adv-re', { kind: 'rotate-cw', page: 999 });
    const r5 = await api.applyOp('adv-re', { kind: 'reorder', page: 0, param: undefined });
    const r6 = await api.applyOp('adv-re', { kind: 'unknown-op', page: 0 });
    const rotBig = await api.applyOp('adv-re', { kind: 'rotate-cw', page: 0 });
    // rotate 1000 times -> normalized
    let rot = 0;
    for (let i = 0; i < 1000; i++) {
      const r = await api.applyOp('adv-re', { kind: 'rotate-cw', page: 0 });
      if (r.ok) rot = r.value.rotations[0];
    }
    return {
      sameIndex: r1.ok ? 'ok' : r1.error.code,
      negFrom: r2.ok ? 'ok' : r2.error.code,
      hugeTo: r3.ok ? 'ok' : r3.error.code,
      rotOutOfRange: r4.ok ? 'ok' : r4.error.code,
      missingParam: r5.ok ? 'ok' : r5.error.code,
      unknownOp: r6.ok ? 'ok' : r6.error.code,
      rotAfter1000: rot,
    };
  });
  console.log('  edges:', JSON.stringify(reorderEdge));
  record('N1', 'Engine rejects bad params with typed errors; 1000 rotations normalize', reorderEdge.sameIndex === 'no-op' && reorderEdge.negFrom === 'out-of-range' && reorderEdge.hugeTo === 'out-of-range' && reorderEdge.rotOutOfRange === 'out-of-range' && reorderEdge.missingParam === 'engine-error' && reorderEdge.unknownOp === 'engine-error' && reorderEdge.rotAfter1000 === (1000 % 4), JSON.stringify(reorderEdge));

  // =====================================================================
  // SUMMARY
  // =====================================================================
  console.log('\n\n================ SUMMARY ================');
  let findings = 0;
  for (const r of results) {
    if (!r.pass) findings++;
    console.log(`  [${r.pass ? 'PASS' : 'FINDING'}] ${r.id}: ${r.title}`);
  }
  console.log(`\n  Findings: ${findings} / ${results.length}`);
  console.log('=========================================');

  await electronApp.close();
  process.exit(0);
})().catch((e) => {
  console.error('HARNESS FATAL:', e.message.split('\n')[0]);
  process.exit(1);
});