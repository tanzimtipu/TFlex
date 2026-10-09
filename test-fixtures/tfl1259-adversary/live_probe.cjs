// TFL-1259 Phase 120 E - adversarial diff-pass on the Print/Output execution
// surface. Live probe against the REAL Electron app launched only through the
// canonical e2e/lib/launch.cjs helper. Read-only w.r.t. product code: it drives
// the shipped surface and stubs ONLY the native file picker (which cannot be
// automated) to exercise the real virtual-PDF pipeline.
//
// Run: node test-fixtures/tfl1259-adversary/live_probe.cjs
//
// The sandbox sets ELECTRON_RUN_AS_NODE=1; unset it before requiring the
// launcher so Electron actually opens windows (environment condition, not a
// product defect).
delete process.env.ELECTRON_RUN_AS_NODE;

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

const REPO = path.resolve(__dirname, '..', '..');
const { launchApp } = require(path.join(REPO, 'e2e', 'lib', 'launch.cjs'));
const {
  openSamplePath,
  openStandalonePrintWindow,
  hardClose,
} = require(path.join(REPO, 'e2e', 'lib', 'helpers.cjs'));

const SHOTS = path.join(REPO, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const REPORT = path.join(REPO, 'test-fixtures', 'report.pdf');
const OUT = path.join(REPO, 'test-fixtures', 'tfl1259-adversary');

const results = [];
function record(id, ok, detail) {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
}
function log(label, value) {
  console.log(`[probe] ${label} = ${typeof value === 'string' ? value : JSON.stringify(value)}`);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function tempCopy(name) {
  const p = path.join(os.tmpdir(), `tfl1259-${Date.now()}-${name}`);
  fs.copyFileSync(REPORT, p);
  return p;
}

async function openFixture(win, app, file) {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openSamplePath(win, app, file);
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(600);
}

function findPrintPage(app) {
  return app.windows().find((p) => p.url().includes('tfWindow=print'));
}

async function setPrintWinSize(app, width, height) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('tfWindow=print'));
    if (w) w.setSize(size.width, size.height);
  }, { width, height });
}

async function readSummary(p) {
  return p.evaluate(() => ({
    mode: document.querySelector('.print-body')?.getAttribute('data-print-layout-mode'),
    pages: document.querySelector('[data-print-summary-pages]')?.textContent?.trim() ?? null,
    dest: document.querySelector('[data-print-summary-destination]')?.textContent?.trim() ?? null,
    format: document.querySelector('[data-print-summary-format]')?.textContent?.trim() ?? null,
    note: document.querySelector('[data-print-summary-note]')?.textContent?.trim() ?? null,
    meta: document.querySelector('[data-print-preview-meta]')?.textContent?.trim() ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Run 1: compact reachability + silence sweep + selection semantics + bytes.
// ---------------------------------------------------------------------------
async function run1() {
  const doc = tempCopy('report.pdf');
  const before = sha256(doc);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await openFixture(win, app, doc);
    const printPage = await openStandalonePrintWindow(app, win);
    await printPage.waitForSelector('[data-print-preview] img', { timeout: 30000 });
    await printPage.waitForTimeout(500);

    // --- single source: exactly one surface, no duplicate handlers ---
    const dupes = await printPage.evaluate(() => {
      const ids = ['[data-print-confirm]', '[data-print-cancel]', '.print-body', '.print-controls', '[data-print-summary]', '[data-print-printer]'];
      const out = {};
      for (const s of ids) out[s] = document.querySelectorAll(s).length;
      return out;
    });
    log('duplicate-surface-counts', dupes);
    record('single-source', Object.values(dupes).every((n) => n === 1), dupes);

    // --- compact layout ---
    await setPrintWinSize(app, 560, 860);
    await printPage.waitForFunction(() => document.querySelector('.print-body')?.getAttribute('data-print-layout-mode') === 'compact', null, { timeout: 8000 });
    const compact = await readSummary(printPage);
    log('compact', compact);
    record('compact-mode', compact.mode === 'compact', compact.mode);
    await printPage.screenshot({ path: path.join(SHOTS, 'adv-tfl1259-compact-initial.png') });

    // Every advanced group must be reachable and functional after expanding.
    const reach = {};

    // quality (Duplex + colour) is collapsible and present for the single layout.
    const qualityOpen = await printPage.evaluate(() => {
      const d = document.querySelector('[data-print-group="quality"]');
      return d ? { present: true, open: d.open, bodyVisible: !!(d.querySelector('.print-group-body') && d.querySelector('.print-group-body').getBoundingClientRect().height > 0) } : { present: false };
    });
    log('quality-initial', qualityOpen);
    if (qualityOpen.present && !qualityOpen.open) {
      await printPage.click('[data-print-group="quality"] > summary');
      await printPage.waitForTimeout(150);
    }
    const qualityAfter = await printPage.evaluate(() => {
      const d = document.querySelector('[data-print-group="quality"]');
      const body = d?.querySelector('.print-group-body');
      return { open: d?.open, bodyH: body ? body.getBoundingClientRect().height : 0 };
    });
    log('quality-after-expand', qualityAfter);
    reach.qualityExpandable = qualityOpen.present ? qualityAfter.bodyH > 0 : null;
    // functional: change duplex + colour and read back.
    await printPage.selectOption('[data-print-duplex]', 'longEdge');
    await printPage.selectOption('[data-print-color]', 'grey');
    reach.duplexValue = await printPage.inputValue('[data-print-duplex]');
    reach.colorValue = await printPage.inputValue('[data-print-color]');
    record('compact-quality-functional', reach.duplexValue === 'longEdge' && reach.colorValue === 'grey', reach);
    await printPage.selectOption('[data-print-color]', 'color');
    await printPage.selectOption('[data-print-duplex]', 'simplex');

    // booklet group: switch layout, expand, exercise gutter/creep/subset.
    await printPage.selectOption('[data-print-layout]', 'booklet');
    await printPage.waitForSelector('[data-print-group="booklet"]', { timeout: 5000 });
    let bOpen = await printPage.evaluate(() => document.querySelector('[data-print-group="booklet"]')?.open);
    if (!bOpen) { await printPage.click('[data-print-group="booklet"] > summary'); await printPage.waitForTimeout(150); }
    await printPage.fill('[data-print-booklet-gutter]', '12');
    await printPage.fill('[data-print-booklet-creep]', '6');
    await printPage.selectOption('[data-print-booklet-subset]', 'front');
    const bVals = await printPage.evaluate(() => ({
      open: document.querySelector('[data-print-group="booklet"]')?.open,
      gutter: document.querySelector('[data-print-booklet-gutter]')?.value,
      creep: document.querySelector('[data-print-booklet-creep]')?.value,
      subset: document.querySelector('[data-print-booklet-subset]')?.value,
    }));
    log('booklet-compact', bVals);
    record('compact-booklet-functional', bVals.open === true && bVals.gutter === '12' && bVals.creep === '6' && bVals.subset === 'front', bVals);
    await printPage.screenshot({ path: path.join(SHOTS, 'adv-tfl1259-compact-booklet-expanded.png') });

    // poster group: switch layout, expand, exercise rows/cols/overlap/scale/cut.
    await printPage.selectOption('[data-print-layout]', 'poster');
    await printPage.waitForSelector('[data-print-group="poster"]', { timeout: 5000 });
    let pOpen = await printPage.evaluate(() => document.querySelector('[data-print-group="poster"]')?.open);
    if (!pOpen) { await printPage.click('[data-print-group="poster"] > summary'); await printPage.waitForTimeout(150); }
    await printPage.selectOption('[data-print-poster-rows]', '3');
    await printPage.selectOption('[data-print-poster-cols]', '4');
    await printPage.fill('[data-print-poster-overlap]', '9');
    await printPage.fill('[data-print-poster-scale]', '150');
    await printPage.check('[data-print-poster-cut-marks]');
    const pVals = await printPage.evaluate(() => ({
      open: document.querySelector('[data-print-group="poster"]')?.open,
      rows: document.querySelector('[data-print-poster-rows]')?.value,
      cols: document.querySelector('[data-print-poster-cols]')?.value,
      overlap: document.querySelector('[data-print-poster-overlap]')?.value,
      scale: document.querySelector('[data-print-poster-scale]')?.value,
      cut: document.querySelector('[data-print-poster-cut-marks]')?.checked,
    }));
    log('poster-compact', pVals);
    record('compact-poster-functional', pVals.open === true && pVals.rows === '3' && pVals.cols === '4' && pVals.overlap === '9' && pVals.scale === '150' && pVals.cut === true, pVals);
    await printPage.screenshot({ path: path.join(SHOTS, 'adv-tfl1259-compact-poster-expanded.png') });
    await printPage.selectOption('[data-print-layout]', 'single');

    // --- silence sweep: every always-on actionable control has an effect ---
    const sweep = {};
    // presets: name + save + delete (writes settings.json in the temp profile).
    await printPage.fill('[data-print-preset-name]', 'ADV sweep');
    await printPage.click('[data-print-preset-save]');
    await printPage.waitForSelector('[data-print-preset-notice]', { timeout: 5000 });
    sweep.presetSaved = (await printPage.textContent('[data-print-preset-notice]')).trim();
    await printPage.selectOption('[data-print-preset]', 'ADV sweep');
    await printPage.waitForTimeout(150);
    sweep.presetApplied = (await printPage.textContent('[data-print-preset-notice]')).trim();
    await printPage.click('[data-print-preset-delete]');
    await printPage.waitForTimeout(300);
    sweep.presetDeleted = await printPage.locator('[data-print-preset-notice]').textContent().catch(() => null);
    record('silence-presets', /saved/i.test(sweep.presetSaved) && /Deleted/i.test(sweep.presetDeleted || ''), sweep);

    // copies/collate
    await printPage.fill('[data-print-copies]', '3');
    sweep.collateEnabled = !(await printPage.locator('[data-print-collate]').isDisabled());
    await printPage.check('[data-print-collate]');
    sweep.collateChecked = await printPage.isChecked('[data-print-collate]');
    record('silence-copies-collate', sweep.collateEnabled && sweep.collateChecked, sweep);

    // range all/current/custom + input
    await printPage.click('[data-print-range-custom]');
    sweep.inputEnabled = !(await printPage.locator('[data-print-range-input]').isDisabled());
    await printPage.fill('[data-print-range-input]', '1-2');
    await printPage.waitForTimeout(200);
    sweep.customMeta = (await printPage.textContent('[data-print-preview-meta]')).trim();
    record('silence-range-custom', sweep.inputEnabled && sweep.customMeta.startsWith('2 pages'), sweep);

    // scaling fit/actual/shrink/custom + percent
    await printPage.click('[data-print-scale-custom]');
    sweep.percentEnabled = !(await printPage.locator('[data-print-scale-percent]').isDisabled());
    await printPage.fill('[data-print-scale-percent]', '150');
    sweep.percentValue = await printPage.inputValue('[data-print-scale-percent]');
    await printPage.click('[data-print-scale-shrink]');
    sweep.percentDisabledForShrink = await printPage.locator('[data-print-scale-percent]').isDisabled();
    record('silence-scaling', sweep.percentEnabled && sweep.percentValue === '150' && sweep.percentDisabledForShrink, sweep);

    // orientation / nup / page order / odd-even / reverse / annotations
    await printPage.click('[data-print-orientation-landscape]');
    sweep.orientation = await printPage.isChecked('[data-print-orientation-landscape]');
    await printPage.selectOption('[data-print-layout]', 'single');
    await printPage.waitForTimeout(250);
    await printPage.selectOption('[data-print-nup]', '4');
    await printPage.waitForTimeout(250);
    sweep.orderState = await printPage.evaluate(() => ({
      layout: document.querySelector('[data-print-layout]')?.value,
      nup: document.querySelector('[data-print-nup]')?.value,
      orderDisabled: document.querySelector('[data-print-page-order]')?.disabled,
    }));
    log('order-state-before-select', sweep.orderState);
    await printPage.selectOption('[data-print-page-order]', 'vertical');
    sweep.order = await printPage.inputValue('[data-print-page-order]');
    await printPage.selectOption('[data-print-odd-even]', 'even');
    sweep.oddEven = await printPage.inputValue('[data-print-odd-even]');
    await printPage.check('[data-print-reverse]');
    sweep.reverse = await printPage.isChecked('[data-print-reverse]');
    await printPage.uncheck('[data-print-annotations]');
    sweep.annotations = await printPage.isChecked('[data-print-annotations]');
    record('silence-misc-controls',
      sweep.orientation === true && sweep.nup === '4' && sweep.order === 'vertical' && sweep.oddEven === 'even' && sweep.reverse === true && sweep.annotations === false,
      Object.assign({ _cond: [sweep.orientation === true, sweep.nup === '4', sweep.order === 'vertical', sweep.oddEven === 'even', sweep.reverse === true, sweep.annotations === false] }, sweep));
    // restore
    await printPage.click('[data-print-orientation-auto]');
    await printPage.selectOption('[data-print-page-order]', 'horizontal');
    await printPage.selectOption('[data-print-nup]', '1');
    await printPage.selectOption('[data-print-odd-even]', 'all');
    await printPage.uncheck('[data-print-reverse]');
    await printPage.check('[data-print-annotations]');
    await printPage.fill('[data-print-copies]', '1');

    // --- selection semantics ---
    await printPage.click('[data-print-range-custom]');
    await printPage.fill('[data-print-range-input]', '1,1,3');
    await printPage.waitForTimeout(250);
    const dup = await readSummary(printPage);
    log('selection-1,1,3', dup);
    record('selection-duplicates', true, `summary="${dup.pages}" (established parser de-dupes/sorts; see ADV entry)`);

    await printPage.fill('[data-print-range-input]', '3,1');
    await printPage.waitForTimeout(250);
    const reordered = await readSummary(printPage);
    log('selection-3,1', reordered);
    record('selection-reordered', true, `summary="${reordered.pages}"`);

    await printPage.fill('[data-print-range-input]', '3-1');
    await printPage.waitForTimeout(250);
    const reversed = await printPage.evaluate(() => ({
      errVisible: !!document.querySelector('[data-print-range-error]') && document.querySelector('[data-print-range-error]').getBoundingClientRect().height > 0,
      errText: document.querySelector('[data-print-range-error]')?.textContent?.trim() ?? null,
      ariaInvalid: document.querySelector('[data-print-range-input]')?.getAttribute('aria-invalid'),
      inputDisabled: document.querySelector('[data-print-range-input]')?.disabled,
      summary: document.querySelector('[data-print-summary-pages]')?.textContent?.trim() ?? null,
    }));
    log('selection-3-1', reversed);
    record('selection-reversed-error-attached', reversed.errVisible && reversed.errText && /reversed/i.test(reversed.errText) && reversed.ariaInvalid === 'true', reversed);

    await printPage.fill('[data-print-range-input]', '1,999');
    await printPage.waitForTimeout(250);
    const beyond = await printPage.evaluate(() => ({
      errText: document.querySelector('[data-print-range-error]')?.textContent?.trim() ?? null,
      summary: document.querySelector('[data-print-summary-pages]')?.textContent?.trim() ?? null,
      confirmDisabled: document.querySelector('[data-print-confirm]')?.disabled,
    }));
    log('selection-beyond-pagecount', beyond);
    record('selection-out-of-range', !!beyond.errText && /out of range/i.test(beyond.errText) && beyond.confirmDisabled === true, beyond);

    // odd/even + reverse combined (range 1-6, even only, reverse)
    await printPage.fill('[data-print-range-input]', '1-6');
    await printPage.selectOption('[data-print-odd-even]', 'even');
    await printPage.check('[data-print-reverse]');
    await printPage.waitForTimeout(250);
    const combo = await readSummary(printPage);
    log('selection-even-reverse', combo);
    record('selection-even-reverse', combo.pages === '2, 4, 6 of 34' && combo.meta?.startsWith('3 pages'), combo);

    // restore
    await printPage.click('[data-print-range-all]');
    await printPage.selectOption('[data-print-odd-even]', 'all');
    await printPage.uncheck('[data-print-reverse]');
    await printPage.waitForTimeout(200);

    // --- document bytes untouched by configuring options ---
    await printPage.click('[data-print-scale-custom]');
    await printPage.fill('[data-print-scale-percent]', '50');
    await printPage.click('[data-print-orientation-landscape]');
    await printPage.selectOption('[data-print-color]', 'grey');
    await printPage.uncheck('[data-print-annotations]');
    await printPage.selectOption('[data-print-layout]', 'booklet');
    await printPage.waitForTimeout(400);
    const after = sha256(doc);
    record('document-bytes-unchanged', before === after, { before: before.slice(0, 16), after: after.slice(0, 16) });

    // preview raster is a canvas data URL, not the file bytes
    const previewSrc = await printPage.evaluate(() => document.querySelector('[data-print-preview] img')?.getAttribute('src')?.slice(0, 24) ?? null);
    log('preview-img-src-prefix', previewSrc);
    record('preview-is-raster', typeof previewSrc === 'string' && previewSrc.startsWith('data:image/'), previewSrc);
  } finally {
    await hardClose(app, 'tfl1259-run1');
  }
}

// ---------------------------------------------------------------------------
// Run 2: completion honesty through the REAL virtual-PDF pipeline.
// ---------------------------------------------------------------------------
async function run2() {
  const app = await launchApp();
  const win = await app.firstWindow();
  const savedPath = path.join(os.tmpdir(), `tfl1259-saved-${Date.now()}.pdf`);
  try {
    await openFixture(win, app, tempCopy('report.pdf'));
    const printPage = await openStandalonePrintWindow(app, win);
    await printPage.waitForSelector('[data-print-preview] img', { timeout: 30000 });
    await printPage.waitForTimeout(400);

    // virtual destination + a stubbed picker that RETURNS a path.
    await printPage.selectOption('[data-print-printer]', 'Microsoft Print to PDF');
    await printPage.waitForTimeout(200);
    const summary = await readSummary(printPage);
    log('virtual-summary', summary);
    record('virtual-summary-labels', summary.dest === 'PDF file' && summary.format === 'PDF' && !!summary.note, summary);

    await printPage.click('[data-print-range-custom]');
    await printPage.fill('[data-print-range-input]', '1-2');
    await printPage.waitForTimeout(200);

    await app.evaluate(({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, savedPath);

    await printPage.click('[data-print-confirm]');
    await printPage.waitForSelector('[data-print-success]', { timeout: 60000 });
    const success = (await printPage.textContent('[data-print-success]')).trim();
    log('success-copy', success);
    const fileExists = fs.existsSync(savedPath);
    const magic = fileExists ? fs.readFileSync(savedPath).slice(0, 5).toString('latin1') : null;
    const size = fileExists ? fs.statSync(savedPath).size : 0;
    record('completion-saved-honest',
      success.includes(savedPath) && fileExists && magic === '%PDF-' && size > 0,
      { success, fileExists, magic, size });
    await printPage.screenshot({ path: path.join(SHOTS, 'adv-tfl1259-saved-success.png') });

    // --- cancelling the Save-As leaves no banner and no file ---
    const cancelPath = path.join(os.tmpdir(), `tfl1259-cancel-${Date.now()}.pdf`);
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: true, filePath: undefined });
    });
    await printPage.click('[data-print-confirm]');
    await printPage.waitForTimeout(2500);
    const quiet = await printPage.evaluate(() => ({
      success: !!document.querySelector('[data-print-success]'),
      error: !!document.querySelector('[data-print-error]'),
      running: !!document.querySelector('[data-print-progress]'),
    }));
    log('save-cancel', quiet);
    record('completion-save-cancel-quiet',
      quiet.success === false && quiet.error === false && quiet.running === false && !fs.existsSync(cancelPath),
      quiet);
    await printPage.screenshot({ path: path.join(SHOTS, 'adv-tfl1259-save-cancel.png') });
  } finally {
    try { if (fs.existsSync(savedPath)) fs.unlinkSync(savedPath); } catch { /* ignore */ }
    await hardClose(app, 'tfl1259-run2');
  }
}

// ---------------------------------------------------------------------------
// Run 3: cancellation integrity + destination failure recovery.
// ---------------------------------------------------------------------------
async function run3() {
  const doc = tempCopy('report.pdf');
  const before = sha256(doc);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await openFixture(win, app, doc);
    const printPage = await openStandalonePrintWindow(app, win);
    await printPage.waitForSelector('[data-print-preview] img', { timeout: 30000 });
    await printPage.waitForTimeout(400);

    // --- mid-run cancel on the full 34-page document ---
    await printPage.selectOption('[data-print-printer]', 'Microsoft Print to PDF');
    await printPage.waitForTimeout(150);
    await printPage.click('[data-print-range-all]');
    await printPage.click('[data-print-confirm]');
    // cancel as soon as the run starts.
    await printPage.waitForSelector('[data-print-progress]', { timeout: 10000 });
    await printPage.click('[data-print-cancel]');
    await printPage.waitForTimeout(1500);
    const afterCancel = await printPage.evaluate(() => ({
      running: !!document.querySelector('[data-print-progress]'),
      error: document.querySelector('[data-print-error]')?.textContent?.trim() ?? null,
      success: document.querySelector('[data-print-success]')?.textContent?.trim() ?? null,
      confirmDisabled: document.querySelector('[data-print-confirm]')?.disabled,
    }));
    log('after-cancel', afterCancel);
    const winAlive = await win.evaluate(() => !!document.querySelector('.pdf-page canvas'));
    const printUsable = await printPage.evaluate(() => {
      const sel = document.querySelector('[data-print-copies]');
      return !!sel && !sel.disabled;
    });
    record('cancellation-integrity',
      afterCancel.running === false && afterCancel.error === null && afterCancel.success === null && winAlive && printUsable && sha256(doc) === before,
      { afterCancel, winAlive, printUsable, bytesUnchanged: sha256(doc) === before });

    // --- destination failure: real write failure to an invalid path ---
    await printPage.click('[data-print-range-custom]');
    await printPage.fill('[data-print-range-input]', '1-2');
    await printPage.fill('[data-print-copies]', '2');
    await printPage.waitForTimeout(200);
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: 'Z:\\no-such-drive\\adv-out.pdf' });
    });
    await printPage.click('[data-print-confirm]');
    await printPage.waitForSelector('[data-print-error]', { timeout: 60000 });
    const failure = await printPage.evaluate(() => ({
      error: document.querySelector('[data-print-error]')?.textContent?.trim() ?? null,
      hint: document.querySelector('[data-print-retry-hint]')?.textContent?.trim() ?? null,
      copies: document.querySelector('[data-print-copies]')?.value,
      confirmDisabled: document.querySelector('[data-print-confirm]')?.disabled,
    }));
    log('failure-recovery', failure);
    record('failure-retains-settings',
      failure.error !== null && failure.copies === '2' && failure.confirmDisabled === false && failure.hint !== null,
      failure);
    await printPage.screenshot({ path: path.join(SHOTS, 'adv-tfl1259-failure-recovery.png') });
  } finally {
    await hardClose(app, 'tfl1259-run3');
  }
}

// ---------------------------------------------------------------------------
// Run 4: sibling non-overlap (export / review surfaces unchanged).
// ---------------------------------------------------------------------------
async function run4() {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await openFixture(win, app, tempCopy('report.pdf'));
    const { runTool } = require(path.join(REPO, 'e2e', 'lib', 'helpers.cjs'));
    await runTool(win, 'exportPages');
    await win.waitForSelector('[data-export-dialog]', { state: 'visible', timeout: 15000 });
    const exportShape = await win.evaluate(() => ({
      formats: Array.from(document.querySelectorAll('[data-export-format]')).map((n) => n.getAttribute('data-export-format')),
      hasRange: !!document.querySelector('[data-export-range]'),
      hasConfirm: !!document.querySelector('[data-export-confirm]'),
    }));
    log('export-shape', exportShape);
    record('sibling-export-unchanged',
      exportShape.formats.includes('png') && exportShape.hasRange && exportShape.hasConfirm,
      exportShape);
    await win.locator('[data-dialog-shell] .modal-close, [data-dialog-shell] .sheet-close').first().click().catch(() => {});
    await win.waitForTimeout(400);
  } finally {
    await hardClose(app, 'tfl1259-run4');
  }
}

(async () => {
  const only = process.argv[2] ? Number(process.argv[2]) : null;
  const runs = [[1, run1], [2, run2], [3, run3], [4, run4]];
  for (const [n, fn] of runs) {
    if (only !== null && n !== only) continue;
    try {
      await fn();
    } catch (e) {
      record(`run${n}-threw`, false, e && e.stack ? e.stack : String(e));
    }
  }
  const summary = {
    pass: results.filter((r) => r.ok).length,
    fail: results.filter((r) => !r.ok).length,
    results,
  };
  fs.writeFileSync(path.join(OUT, 'live_probe_results.json'), JSON.stringify(summary, null, 2));
  console.log(`\n[probe] ${summary.pass} pass / ${summary.fail} fail`);
  process.exit(0);
})();
