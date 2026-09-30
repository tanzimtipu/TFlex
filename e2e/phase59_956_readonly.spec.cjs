// Phase 59 (item 4) — the operator's real form file, READ-ONLY.
//
// `C:\Users\tanzi\OneDrive\Desktop\Parent visa\956.pdf` is owner-restricted
// with an EMPTY user password. This spec COPIES it to a temp dir, opens the
// COPY, fills it, saves the COPY, and re-parses it. The original is never
// modified and never committed.
//
// Asserts:
//   1. the listing reports 105 fields with ALL widget positions (the 6-option
//      groups as `radio` with each option's own rect);
//   2. after fill+save the field count stays 105 and the WIDGET count stays 129;
//   3. the filled values are present as /V, the button widgets carry /AS, and
//      the widget appearance streams exist;
//   4. which fields the fill report marks as skipped and why.
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { PDFDocument, PDFName, PDFDict, PDFArray } = require('@cantoo/pdf-lib');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const OPERATOR_PDF = 'C:\\Users\\tanzi\\OneDrive\\Desktop\\Parent visa\\956.pdf';

let app = null;
let win = null;

test.setTimeout(300000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p59-956');
  app = null;
  win = null;
});

/** Count the field dicts (/FT) and widget dicts (/Subtype /Widget) reachable
 *  from the catalog's /AcroForm, deduplicated by object identity. */
function countAcroForm(doc) {
  const ctx = doc.context;
  const formDict = ctx.lookupMaybe(doc.catalog.get(PDFName.of('AcroForm')), PDFDict);
  if (formDict === undefined) return { fields: 0, widgets: 0 };
  const seen = new Set();
  let fields = 0;
  let widgets = 0;
  const visit = (node) => {
    if (seen.has(node)) return;
    seen.add(node);
    if (node.get(PDFName.of('Subtype'))?.toString() === '/Widget') widgets += 1;
    if (node.has(PDFName.of('FT'))) fields += 1;
    const kids = ctx.lookupMaybe(node.get(PDFName.of('Kids')), PDFArray);
    if (kids !== undefined) {
      for (let i = 0; i < kids.size(); i += 1) {
        const kid = ctx.lookupMaybe(kids.get(i), PDFDict);
        if (kid !== undefined) visit(kid);
      }
    }
  };
  const roots = ctx.lookupMaybe(formDict.get(PDFName.of('Fields')), PDFArray);
  if (roots !== undefined) {
    for (let i = 0; i < roots.size(); i += 1) {
      const root = ctx.lookupMaybe(roots.get(i), PDFDict);
      if (root !== undefined) visit(root);
    }
  }
  return { fields, widgets };
}

/** Every widget dict reachable from the AcroForm, with its /AS and whether it
 *  carries an /AP /N appearance stream. */
function widgetStates(doc) {
  const ctx = doc.context;
  const formDict = ctx.lookupMaybe(doc.catalog.get(PDFName.of('AcroForm')), PDFDict);
  const seen = new Set();
  const out = [];
  const visit = (node, inheritedFt) => {
    if (seen.has(node)) return;
    seen.add(node);
    const ft = node.get(PDFName.of('FT'))?.toString() ?? inheritedFt;
    if (node.get(PDFName.of('Subtype'))?.toString() === '/Widget') {
      const ap = ctx.lookupMaybe(node.get(PDFName.of('AP')), PDFDict);
      // /AP /N is a state dict for a button widget and a stream for a text
      // widget; either way the appearance stream exists when /N resolves.
      const normal = ap === undefined ? undefined : ap.get(PDFName.of('N'));
      out.push({
        ft,
        as: node.get(PDFName.of('AS'))?.toString() ?? null,
        hasApN: normal !== undefined && ctx.lookup(normal) !== undefined,
      });
    }
    const kids = ctx.lookupMaybe(node.get(PDFName.of('Kids')), PDFArray);
    if (kids !== undefined) {
      for (let i = 0; i < kids.size(); i += 1) {
        const kid = ctx.lookupMaybe(kids.get(i), PDFDict);
        if (kid !== undefined) visit(kid, ft);
      }
    }
  };
  const roots = ctx.lookupMaybe(formDict.get(PDFName.of('Fields')), PDFArray);
  if (roots !== undefined) {
    for (let i = 0; i < roots.size(); i += 1) {
      const root = ctx.lookupMaybe(roots.get(i), PDFDict);
      if (root !== undefined) visit(root, null);
    }
  }
  return out;
}

async function stubOpenDialog(fp) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, fp);
}

async function openPdf(filePath) {
  await stubOpenDialog(filePath);
  await win.locator('[data-toolbar-open]').first().click();
  const outcome = await Promise.race([
    win.waitForSelector('.workspace', { timeout: 60000 }).then(() => 'workspace').catch(() => null),
    win.waitForSelector('[data-password-prompt]', { timeout: 60000 }).then(() => 'password').catch(() => null),
  ]);
  if (outcome === 'password') {
    await win.locator('[data-password-input]').fill('');
    await win.locator('[data-password-submit]').click();
    await win.waitForSelector('[data-password-prompt]', { state: 'detached', timeout: 30000 }).catch(() => {});
    await win.waitForSelector('.workspace', { timeout: 60000 });
  }
  await win.waitForTimeout(1500);
}

async function waitForFields(minCount) {
  await win.waitForFunction((n) => {
    const d = window.tflexDiagnostics();
    return d.hasFormFields === true && (d.formFields || []).length >= n;
  }, minCount, { timeout: 60000 });
  await win.waitForTimeout(500);
}

async function saveInPlace() {
  await win.waitForFunction(() => {
    const b = document.querySelector('[data-toolbar-save]');
    return b !== null && !b.disabled;
  }, null, { timeout: 20000 });
  await win.locator('[data-toolbar-save]').click();
  await win.waitForTimeout(3500);
}

async function readSaved(filePath) {
  const deadline = Date.now() + 30000;
  let last = null;
  while (Date.now() < deadline) {
    try {
      return await PDFDocument.load(fs.readFileSync(filePath), { password: '', ignoreEncryption: true });
    } catch (e) {
      last = e;
      await win.waitForTimeout(500);
    }
  }
  throw last ?? new Error('saved file never became readable');
}

test('operator 956.pdf (read-only copy): 105 fields / 129 widgets, 6-option groups as radio, fill+save keeps the counts and writes /V + /AS + /AP', async () => {
  if (!fs.existsSync(OPERATOR_PDF)) {
    test.skip(true, `operator file not readable: ${OPERATOR_PDF}`);
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p59-956-'));
  const copy = path.join(tmp, '956-copy.pdf');
  fs.copyFileSync(OPERATOR_PDF, copy);
  const originalBytes = fs.readFileSync(OPERATOR_PDF);

  // Baseline (read-only parse of the COPY).
  const baseDoc = await PDFDocument.load(fs.readFileSync(copy), { password: '', ignoreEncryption: true });
  const baseCounts = countAcroForm(baseDoc);
  console.log(`[P59-956] baseline counts=${JSON.stringify(baseCounts)} pages=${baseDoc.getPageCount()}`);
  expect(baseCounts.fields, 'baseline field count').toBe(105);
  expect(baseCounts.widgets, 'baseline widget count').toBe(129);

  await openPdf(copy);
  await waitForFields(100);

  // 1. The listing reports 105 fields with ALL widget positions.
  const listing = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return (d.formFields || []).map((f) => ({
      id: f.id,
      name: f.name,
      kind: f.kind,
      readOnly: f.readOnly === true,
      widgets: f.widgets
        ? f.widgets.map((w) => ({ value: w.value, selected: w.selected, rect: w.rect }))
        : undefined,
    }));
  });
  console.log(`[P59-956] listing fields=${listing.length}`);
  expect(listing.length, 'the listing reports 105 fields').toBe(105);

  // Every multi-widget group exposes each option's own rect.
  let groupWidgets = 0;
  let missingRect = 0;
  for (const f of listing) {
    for (const w of f.widgets ?? []) {
      groupWidgets += 1;
      if (!(w.rect && w.rect.width > 0 && w.rect.height > 0)) missingRect += 1;
    }
  }
  console.log(`[P59-956] group widget positions=${groupWidgets} missingRect=${missingRect}`);
  expect(groupWidgets, 'all group widget positions are listed').toBe(36);
  expect(missingRect, 'every group widget has a real rect').toBe(0);

  // The 6-option groups are radio with 6 widgets each.
  const sixGroups = listing.filter((f) => (f.widgets ?? []).length === 6);
  console.log(`[P59-956] sixGroups=${JSON.stringify(sixGroups.map((f) => ({ name: f.name, kind: f.kind, n: f.widgets.length })))}`);
  expect(sixGroups.length, 'two 6-option groups').toBe(2);
  for (const g of sixGroups) {
    expect(g.kind, `${g.name} is radio`).toBe('radio');
    expect(g.widgets.length, `${g.name} has 6 options`).toBe(6);
    for (const w of g.widgets) expect(w.rect.width > 0 && w.rect.height > 0, `${g.name}/${w.value} rect`).toBe(true);
  }

  // 2. Fill a writable page-1 text field, save the COPY.
  const textFields = listing.filter((f) => f.kind === 'text' && !f.readOnly);
  console.log(`[P59-956] writable text fields=${textFields.length} sample=${JSON.stringify(textFields.slice(0, 6).map((f) => ({ id: f.id, name: f.name })))}`);
  const textField = textFields.find((f) => f.id.startsWith('form-0-')) ?? textFields[0];
  expect(textField, 'a writable text field exists').toBeTruthy();
  console.log(`[P59-956] filling ${textField.id} (${textField.name})`);
  await win.locator(`[data-form-field="${textField.id}"]`).fill('QA-956');
  await win.waitForTimeout(1800);

  // 4. The fill report's skipped fields and reasons.
  const report = await win.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-form-fill-skip]'));
    return rows.map((r) => ({
      name: r.getAttribute('data-form-fill-skip'),
      reason: r.querySelector('[data-form-fill-reason]')?.getAttribute('data-form-fill-reason') ?? null,
      text: r.textContent.replace(/\s+/g, ' ').trim(),
    }));
  });
  const counts = await win.evaluate(() => {
    const el = document.querySelector('[data-form-fill-counts]');
    return el ? el.textContent.trim() : null;
  });
  console.log(`[P59-956] fill report counts="${counts}" skipped=${JSON.stringify(report)}`);
  await win.screenshot({ path: path.join(SHOTS, 'p59-956-filled.png') });

  await saveInPlace();
  const saved = await readSaved(copy);

  // 2. Field count stays 105, widget count stays 129.
  const savedCounts = countAcroForm(saved);
  console.log(`[P59-956] saved counts=${JSON.stringify(savedCounts)}`);
  expect(savedCounts.fields, '105 fields survive the save').toBe(105);
  expect(savedCounts.widgets, '129 widgets survive the save').toBe(129);

  // 3. The filled value is present as /V.
  const savedText = saved.getForm().getField(textField.name);
  const savedValue = savedText.getText();
  console.log(`[P59-956] saved ${textField.name} /V="${savedValue}"`);
  expect(savedValue, 'the filled value re-reads from /V').toBe('QA-956');

  // The button widgets carry their /AS and their appearance streams exist.
  const states = widgetStates(saved);
  const buttons = states.filter((s) => s.ft === '/Btn');
  const withAs = buttons.filter((s) => s.as !== null).length;
  const withApN = states.filter((s) => s.hasApN).length;
  console.log(`[P59-956] widgets=${states.length} buttonWidgets=${buttons.length} buttonWithAS=${withAs} withApN=${withApN}`);
  expect(states.length, '129 widgets in the saved file').toBe(129);
  expect(buttons.length, '45 button widgets').toBe(45);
  expect(withAs, 'every button widget carries /AS').toBe(45);
  expect(withApN, 'every widget has an /AP /N appearance stream').toBe(129);

  // The original is untouched.
  expect(fs.readFileSync(OPERATOR_PDF).equals(originalBytes), 'the operator original is unmodified').toBe(true);
});
