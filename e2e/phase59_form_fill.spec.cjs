// Phase 59 (item 4) — NATIVE AcroForm filling through the real UI (SYNTHETIC).
//
// The assigned behaviour (Phase 59 item 4 / success criterion 4):
//   - filling sets the AcroForm FIELD VALUES and regenerates each widget's
//     appearance (not a painted overlay);
//   - a multi-widget button GROUP can select an option OTHER than the first;
//   - the saved file's /V + per-widget /AS read back correctly, the widget
//     /AP /N streams are regenerated, and the field/widget COUNTS survive a
//     save (no recreation);
//   - the fill-report summary UI shows any skipped field with its reason.
//
// The fixture is built in-spec with @cantoo/pdf-lib (no committed binaries).
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFArray,
  PDFStream,
} = require('@cantoo/pdf-lib');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

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
  if (app) await hardClose(app, 'p59-formfill');
  app = null;
  win = null;
});

// ---- synthetic fixture ----------------------------------------------------

const GROUP_ON_STATES = ['No', 'Yes', 'Maybe'];

/** Rename each widget's /AP /N on-state key and set /AS, so the single
 *  PDFCheckBox group carries three distinct options. */
function renameGroupOnStates(group, names) {
  const widgets = group.acroField.getWidgets();
  for (let i = 0; i < widgets.length; i += 1) {
    const widget = widgets[i];
    const ap = widget.dict.get(PDFName.of('AP'));
    const normal = ap.get(PDFName.of('N'));
    const onKey = widget.getOnValue() ?? PDFName.of('Yes');
    const stream = normal.get(onKey);
    normal.delete(onKey);
    normal.set(PDFName.of(names[i]), stream);
    widget.setAppearanceState(PDFName.of(names[i]));
  }
}

async function buildFixture(file) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();

  const text = form.createTextField('text_field');
  text.setText('');
  text.addToPage(page, { x: 72, y: 700, width: 200, height: 20 });

  const single = form.createCheckBox('single_cb');
  single.addToPage(page, { x: 72, y: 660, width: 16, height: 16 });

  const group = form.createCheckBox('group');
  group.addToPage(page, { x: 72, y: 600, width: 16, height: 16 });
  group.addToPage(page, { x: 72, y: 570, width: 16, height: 16 });
  group.addToPage(page, { x: 72, y: 540, width: 16, height: 16 });
  renameGroupOnStates(group, GROUP_ON_STATES);

  const ro = form.createTextField('ro_field');
  ro.addToPage(page, { x: 72, y: 500, width: 200, height: 20 });
  ro.enableReadOnly();

  const sig = form.createTextField('sig_field');
  sig.addToPage(page, { x: 72, y: 470, width: 200, height: 20 });
  sig.acroField.dict.set(PDFName.of('FT'), PDFName.of('Sig'));

  fs.writeFileSync(file, await doc.save({ updateFieldAppearances: false }));
  return file;
}

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

/** The font resource NAMES used by a text widget's normal appearance stream. */
function appearanceFontKeys(doc, field) {
  const widget = field.acroField.getWidgets()[0];
  const raw = widget.getNormalAppearance();
  const stream = raw instanceof PDFStream ? raw : doc.context.lookup(raw);
  const res = doc.context.lookupMaybe(stream.dict.get(PDFName.of('Resources')), PDFDict);
  const fonts = res === undefined
    ? undefined
    : doc.context.lookupMaybe(res.get(PDFName.of('Font')), PDFDict);
  if (fonts === undefined) return [];
  return fonts.keys().map((k) => k.toString());
}

// ---- UI driving -----------------------------------------------------------

async function stubOpenDialog(fp) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, fp);
}

async function openPdf(filePath) {
  await stubOpenDialog(filePath);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.workspace', { timeout: 40000 });
  await win.waitForTimeout(1200);
}

async function waitForFields(minCount) {
  await win.waitForFunction((n) => {
    const d = window.tflexDiagnostics();
    return d.hasFormFields === true && (d.formFields || []).length >= n;
  }, minCount, { timeout: 40000 });
  await win.waitForTimeout(400);
}

async function saveInPlace() {
  await win.waitForFunction(() => {
    const b = document.querySelector('[data-toolbar-save]');
    return b !== null && !b.disabled;
  }, null, { timeout: 15000 });
  await win.locator('[data-toolbar-save]').click();
  await win.waitForTimeout(2500);
}

async function readSaved(filePath) {
  const deadline = Date.now() + 20000;
  let last = null;
  while (Date.now() < deadline) {
    try {
      return await PDFDocument.load(fs.readFileSync(filePath), { password: '', ignoreEncryption: true });
    } catch (e) {
      last = e;
      await win.waitForTimeout(400);
    }
  }
  throw last ?? new Error('saved file never became readable');
}

// ---------------------------------------------------------------------------
// The one test: native fill of the synthetic fixture.
// ---------------------------------------------------------------------------
test('synthetic form: native fill sets /V + per-widget /AS, regenerates /AP, survives save with counts intact, and reports skips', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p59-form-'));
  const fixture = await buildFixture(path.join(tmp, 'form.pdf'));

  const srcDoc = await PDFDocument.load(fs.readFileSync(fixture));
  const srcCounts = countAcroForm(srcDoc);
  console.log(`[P59-form] source counts=${JSON.stringify(srcCounts)}`);
  expect(srcCounts.fields).toBe(5);
  expect(srcCounts.widgets).toBe(7);

  await openPdf(fixture);
  await waitForFields(5);

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
  console.log(`[P59-form] listing=${JSON.stringify(listing)}`);
  expect(listing.length).toBe(5);
  const group = listing.find((f) => f.name === 'group');
  expect(group.kind).toBe('radio');
  expect(group.widgets.map((w) => w.value)).toEqual(GROUP_ON_STATES);
  expect(listing.find((f) => f.name === 'ro_field').readOnly).toBe(true);

  // 1. Fill the group with an option OTHER than the first.
  await win.locator(`[data-form-field="${group.id}"][data-form-widget-value="Maybe"]`).click();
  await win.waitForTimeout(1200);

  // 2. Fill the text field with a Latin value.
  const textId = listing.find((f) => f.name === 'text_field').id;
  await win.locator(`[data-form-field="${textId}"]`).fill('Hello');
  await win.waitForSelector('[data-form-fill-report]', { timeout: 15000 });
  await win.waitForTimeout(800);

  // 3. The fill-report summary shows every skipped field with its reason.
  const report = await win.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-form-fill-skip]'));
    return rows.map((r) => ({
      name: r.getAttribute('data-form-fill-skip'),
      reason: r.querySelector('[data-form-fill-reason]')?.getAttribute('data-form-fill-reason') ?? null,
      text: r.textContent.replace(/\s+/g, ' ').trim(),
    }));
  });
  console.log(`[P59-form] report=${JSON.stringify(report)}`);
  const reasonFor = (n) => report.find((r) => r.name === n)?.reason;
  expect(reasonFor('ro_field'), 'read-only field reported').toBe('skipped-readonly');
  expect(reasonFor('sig_field'), 'signature field reported').toBe('skipped-signature');
  await win.screenshot({ path: path.join(SHOTS, 'p59-form-fill.png') });

  // 4. Save in place, then re-parse the saved file.
  await saveInPlace();
  const saved = await readSaved(fixture);

  // /V + per-widget /AS read back correctly.
  const savedGroup = saved.getForm().getField('group');
  expect(savedGroup.acroField.dict.get(PDFName.of('V'))?.toString()).toBe('/Maybe');
  const asStates = savedGroup.acroField.getWidgets().map((w) => w.getAppearanceState()?.toString());
  console.log(`[P59-form] saved group /V=/Maybe /AS=${JSON.stringify(asStates)}`);
  expect(asStates).toEqual(['/Off', '/Off', '/Maybe']);

  // The text field's /AP /N stream was regenerated with the embedded Unicode font.
  const savedText = saved.getForm().getField('text_field');
  expect(savedText.getText()).toBe('Hello');
  const fontKeys = appearanceFontKeys(saved, savedText);
  console.log(`[P59-form] saved text /AP /N font keys=${JSON.stringify(fontKeys)}`);
  expect(
    fontKeys.some((k) => k.includes('DejaVu')),
    `appearance regenerated with the embedded font (${fontKeys.join(',')})`,
  ).toBe(true);

  // Field and widget counts survive the save (no recreation).
  const savedCounts = countAcroForm(saved);
  console.log(`[P59-form] saved counts=${JSON.stringify(savedCounts)}`);
  expect(savedCounts.fields).toBe(srcCounts.fields);
  expect(savedCounts.widgets).toBe(srcCounts.widgets);
});
