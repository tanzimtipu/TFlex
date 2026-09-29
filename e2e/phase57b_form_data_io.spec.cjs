// Phase 57 feature B part 2 (QA) - FDF/XFDF form-data interchange through the
// REAL UI. ONE test: export the open document's AcroForm values to XFDF and FDF
// through the Command Palette verb, import into blank copies through the dialog,
// parser-verify the saved values, and prove an unmatched name is reported and
// never creates a stray field. Fixtures are built in-spec with @cantoo/pdf-lib;
// the OS dialogs are stubbed in main; the app launches ONLY through launchApp.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, gotoStage } = require('./lib/helpers.cjs');
const { PDFDocument } = require('@cantoo/pdf-lib');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const FIELDS = { applicant_name: 'Ada Lovelace', Email: 'ada@example.com', notes: 'line one' };
const NAMES = ['applicant_name', 'Email', 'notes'];

let app = null;
let win = null;
let tmp = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p57b');
  app = null;
  win = null;
});

test.setTimeout(300000);

// ---- in-spec fixtures -----------------------------------------------------
async function buildFormPdf(file, values) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  NAMES.forEach((name, i) => {
    const field = form.createTextField(name);
    field.addToPage(page, { x: 60, y: 700 - i * 40, width: 240, height: 22 });
    if (values && values[name] !== undefined) field.setText(values[name]);
  });
  fs.writeFileSync(file, await doc.save());
  return file;
}

async function stubSaveDialog(fp) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, fp);
}

async function stubOpenDialog(fp) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, fp);
}

// Open a PDF through the real header Open control (dialog stubbed), then wait
// until THAT tab is active and its form fields are loaded.
async function openPdf(filePath) {
  const want = path.basename(filePath, path.extname(filePath));
  await stubOpenDialog(filePath);
  await win.locator('[aria-label="Open PDF document"]').first().click();
  await win.waitForFunction((title) => {
    const active = document.querySelector('[data-tab-id][aria-selected="true"]');
    if (active === null || !active.textContent.includes(title)) return false;
    const d = window.tflexDiagnostics();
    return d.hasFormFields === true && (d.formFields || []).length >= 3;
  }, want, { timeout: 30000 });
  await win.waitForTimeout(300);
}

async function activateTab(title) {
  await win.locator('[data-tab-id]', { hasText: title }).first().click();
  await win.waitForFunction((t) => {
    const active = document.querySelector('[data-tab-id][aria-selected="true"]');
    return active !== null && active.textContent.includes(t);
  }, title, { timeout: 8000 });
  await win.waitForTimeout(300);
}

// Trigger a registry verb (exportFormData / importFormData) through the real
// Command Palette: Ctrl+Shift+P -> filter the search -> click the tool row.
async function triggerVerb(toolId) {
  await win.keyboard.press('Control+Shift+P');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 10000 });
  await win.locator('[data-command-palette-input]').fill('form data');
  await win.waitForTimeout(300);
  const row = win.locator(`[data-palette-tool-id="${toolId}"]`).first();
  await row.waitFor({ state: 'visible', timeout: 8000 });
  const disabled = await row.getAttribute('data-palette-disabled');
  expect(disabled, `${toolId} palette row disabled`).toBe('false');
  await row.click();
  await win.waitForSelector('[data-form-data-dialog]', { state: 'visible', timeout: 10000 });
  await win.waitForTimeout(250);
}

async function closeDialog() {
  await win.locator('[data-testid="form-data-close"]').click();
  await win.waitForSelector('[data-form-data-dialog]', { state: 'detached', timeout: 10000 });
}

// Export the active document's form values in `format` to `outPath`.
async function exportFormData(format, outPath, shot) {
  await triggerVerb('exportFormData');
  const title = await win.locator('#form-data-dialog-title').innerText();
  await win.locator(`[data-testid="form-data-format-${format}"]`).click();
  await stubSaveDialog(outPath);
  await win.locator('[data-testid="form-data-export-run"]').click();
  await win.waitForSelector('[data-form-data-export-result]', { state: 'visible', timeout: 20000 });
  await win.waitForTimeout(300);
  const exportedText = await win.locator('[data-form-data-exported]').innerText();
  if (shot) await win.screenshot({ path: shot });
  await closeDialog();
  return { title, exportedText };
}

// Import `inPath` in `format` into the active document; read the full report.
async function importFormData(format, inPath, shot) {
  await triggerVerb('importFormData');
  const title = await win.locator('#form-data-dialog-title').innerText();
  await win.locator(`[data-testid="form-data-format-${format}"]`).click();
  await stubOpenDialog(inPath);
  await win.locator('[data-testid="form-data-import-pick"]').click();
  await win.waitForSelector('[data-form-data-file]', { state: 'visible', timeout: 10000 });
  const shownPath = await win.locator('[data-form-data-file]').innerText();
  await win.locator('[data-testid="form-data-import-run"]').click();
  await win.waitForSelector('[data-form-data-report]', { state: 'visible', timeout: 20000 });
  await win.waitForTimeout(300);
  const count = await win.locator('[data-form-data-imported]').innerText();
  const matched = await win.locator('[data-testid="form-data-matched-item"]').allInnerTexts();
  const unmatched = await win.locator('[data-testid="form-data-unmatched-item"]').allInnerTexts();
  const empty = await win.locator('[data-testid="form-data-empty-item"]').allInnerTexts();
  const unmatchedEmpty = (await win.locator('[data-testid="form-data-unmatched-empty"]').count()) > 0
    ? await win.locator('[data-testid="form-data-unmatched-empty"]').innerText() : null;
  const emptyEmpty = (await win.locator('[data-testid="form-data-empty-empty"]').count()) > 0
    ? await win.locator('[data-testid="form-data-empty-empty"]').innerText() : null;
  if (shot) await win.screenshot({ path: shot });
  return { title, shownPath, count, matched, unmatched, empty, unmatchedEmpty, emptyEmpty };
}

// Save the active document in place, then re-parse the file with a FRESH
// PDFDocument.load until the three values are present (or the deadline passes).
async function saveAndRead(filePath, names) {
  await win.waitForFunction(() => {
    const b = document.querySelector('[data-toolbar-save]');
    return b !== null && !b.disabled;
  }, null, { timeout: 15000 });
  await win.locator('[data-toolbar-save]').click();
  const deadline = Date.now() + 20000;
  let last = null;
  while (Date.now() < deadline) {
    await win.waitForTimeout(400);
    try {
      const doc = await PDFDocument.load(fs.readFileSync(filePath));
      const form = doc.getForm();
      const values = {};
      for (const n of names) values[n] = form.getTextField(n).getText();
      last = { values, fieldNames: form.getFields().map((f) => f.getName()) };
      if (names.every((n) => values[n] !== undefined && values[n] !== '')) return last;
    } catch (e) {
      last = { error: String(e), fieldNames: [] };
    }
  }
  return last;
}

// ---------------------------------------------------------------------------
// The one test: XFDF + FDF export -> import round trip through the real UI.
// ---------------------------------------------------------------------------
test('phase57b: export/import form data (XFDF + FDF) through the UI, parser-verified', async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p57b-'));
  const A = await buildFormPdf(path.join(tmp, 'form-a.pdf'), FIELDS);
  const B = await buildFormPdf(path.join(tmp, 'form-b.pdf'), null);
  const C = await buildFormPdf(path.join(tmp, 'form-c.pdf'), null);
  const D = await buildFormPdf(path.join(tmp, 'form-d.pdf'), null);
  const xfdfPath = path.join(tmp, 'export.xfdf');
  const ghostPath = path.join(tmp, 'export-ghost.xfdf');
  const fdfPath = path.join(tmp, 'export.fdf');

  // (b) Open fixture A - the one-page form carrying the three values.
  await openPdf(A);
  const aDiag = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return {
      hasFormFields: d.hasFormFields,
      fields: (d.formFields || []).map((f) => ({ name: f.name, value: f.value })),
    };
  });
  console.log('P57B_A_DIAG ' + JSON.stringify(aDiag));
  expect(aDiag.fields.map((f) => f.name).sort()).toEqual([...NAMES].sort());

  // Reachability: the REVIEW Action Dock second surface. Report the literal
  // [data-dock-verb] presence (and the overflow lane if the verb spilled there).
  await gotoStage(win, 3);
  const inlineVerbs = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-dock-verb]')).map((b) => b.getAttribute('data-dock-verb')));
  let overflowVerbs = [];
  if (!inlineVerbs.includes('exportFormData')) {
    const overflow = win.locator('[data-dock-overflow]');
    if ((await overflow.count()) > 0 && (await overflow.first().isVisible().catch(() => false))) {
      await overflow.first().click();
      await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 5000 }).catch(() => {});
      overflowVerbs = await win.evaluate(() =>
        Array.from(document.querySelectorAll('[data-dock-overflow-item]')).map((b) => b.getAttribute('data-dock-overflow-item')));
      await win.keyboard.press('Escape');
      await win.waitForTimeout(250);
    }
  }
  const dockHasExport = inlineVerbs.includes('exportFormData');
  console.log('P57B_DOCK ' + JSON.stringify({
    inlineHasExport: dockHasExport,
    overflowHasExport: overflowVerbs.includes('exportFormData'),
    inlineVerbCount: inlineVerbs.length,
  }));
  expect(dockHasExport, 'exportFormData missing from the REVIEW dock inline verbs').toBe(true);

  // (c) Export XFDF from A.
  const expX = await exportFormData('xfdf', xfdfPath, path.join(SHOTS, 'p57b-form-data-export.png'));
  const xExists = fs.existsSync(xfdfPath);
  const xSize = xExists ? fs.statSync(xfdfPath).size : -1;
  const xHead = xExists ? fs.readFileSync(xfdfPath).slice(0, 5).toString('utf8') : null;
  console.log('P57B_XFDF_EXPORT ' + JSON.stringify({ expX, xExists, xSize, xHead }));
  expect(expX.title).toBe('Export form data');
  expect(xExists).toBe(true);
  expect(xSize).toBeGreaterThan(0);
  expect(xHead).toBe('<?xml');

  // (d) Import the XFDF into blank B through the dialog.
  await openPdf(B);
  const impX = await importFormData('xfdf', xfdfPath, path.join(SHOTS, 'p57b-form-data-import-report.png'));
  console.log('P57B_XFDF_IMPORT ' + JSON.stringify(impX));
  expect(impX.title).toBe('Import form data');
  expect(impX.shownPath).toContain('export.xfdf');
  expect([...impX.matched].sort()).toEqual([...NAMES].sort());
  expect(impX.count).toContain('3');
  expect(impX.unmatched).toEqual([]);
  expect(impX.empty).toEqual([]);
  expect(impX.unmatchedEmpty).toBe('None');
  expect(impX.emptyEmpty).toBe('None');
  await closeDialog();

  // (e) Save B in place; a fresh PDFDocument.load proves all three values.
  const savedB = await saveAndRead(B, NAMES);
  console.log('P57B_SAVED_B ' + JSON.stringify(savedB));
  expect(savedB.values).toEqual(FIELDS);

  // (f) Unmatched leg: inject ghost_field into the exported XFDF and import it
  // into a fresh blank copy C. ghost_field must be reported AND never created.
  const xml = fs.readFileSync(xfdfPath, 'utf8');
  fs.writeFileSync(ghostPath, xml.replace('</fields>', '<field name="ghost_field"><value>nope</value></field></fields>'), 'utf8');
  await openPdf(C);
  const impGhost = await importFormData('xfdf', ghostPath, null);
  console.log('P57B_GHOST_IMPORT ' + JSON.stringify(impGhost));
  expect(impGhost.unmatched).toContain('ghost_field');
  expect([...impGhost.matched].sort()).toEqual([...NAMES].sort());
  expect(impGhost.empty).toEqual([]);
  await closeDialog();
  const savedC = await saveAndRead(C, NAMES);
  console.log('P57B_SAVED_C ' + JSON.stringify(savedC));
  expect([...savedC.fieldNames].sort()).toEqual([...NAMES].sort());
  expect(savedC.fieldNames).not.toContain('ghost_field');

  // (g) FDF leg: re-activate A, export FDF, import into a fresh blank copy D.
  await activateTab('form-a');
  const expF = await exportFormData('fdf', fdfPath, null);
  const fExists = fs.existsSync(fdfPath);
  const fSize = fExists ? fs.statSync(fdfPath).size : -1;
  const fHead = fExists ? fs.readFileSync(fdfPath).slice(0, 4).toString('utf8') : null;
  console.log('P57B_FDF_EXPORT ' + JSON.stringify({ expF, fExists, fSize, fHead }));
  expect(expF.title).toBe('Export form data');
  expect(fExists).toBe(true);
  expect(fHead).toBe('%FDF');
  await openPdf(D);
  const impF = await importFormData('fdf', fdfPath, null);
  console.log('P57B_FDF_IMPORT ' + JSON.stringify(impF));
  expect(impF.title).toBe('Import form data');
  expect([...impF.matched].sort()).toEqual([...NAMES].sort());
  expect(impF.unmatched).toEqual([]);
  expect(impF.empty).toEqual([]);
  await closeDialog();
});
