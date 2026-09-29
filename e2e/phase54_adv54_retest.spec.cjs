// Phase 54 accepted-adversary-finding retest (QA, DEF-380...DEF-387).
// Launches ONLY through the canonical launchApp helper (dev build under dist/).
// Covers the cases not exercised by the adversary's own bridge scripts:
//   DEF-386  unrecognised declared pdfaid / pdfx level
//   DEF-381  the oversized device-RGB scan reports "could not be determined"
//   DEF-382  a NORMAL image's page box is unchanged and carries no clamp warning
//   DEF-384  the all-NaN SVG does not present a blank page as `native`
// Evidence: console.log P54A_* lines; screenshots under screenshots/.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { PDFDocument } = require('@cantoo/pdf-lib');

const ADV = path.resolve(__dirname, '..', 'test-fixtures', 'adv-p54');
const P54 = path.resolve(__dirname, '..', 'test-fixtures', 'phase54');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const F = {
  bogusId: path.join(ADV, 'val-pdfa-conforming-bogusid.pdf'),
  unknownConf: path.join(ADV, 'val-pdfa-unknown-conf.pdf'),
  pdfxPart9: path.join(ADV, 'val-pdfx-part9.pdf'),
  pdfaOk: path.join(P54, 'pdfa-1b-ok.pdf'),
  bigContent: path.join(ADV, 'val-bigcontent.pdf'),
  dpi72: path.join(P54, 'dpi-72.png'),
  numericHostile: path.join(ADV, 'svg-numeric-hostile2.svg'),
};

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'phase54-adv54-retest');
  app = null;
  win = null;
});

test.setTimeout(180000);

async function validateFile(filePath, target) {
  const b64 = fs.readFileSync(filePath).toString('base64');
  const t0 = Date.now();
  const res = await win.evaluate(
    async ({ b, t }) => {
      const bin = atob(b);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return window.tflex.validation.validateBytes(bytes, t);
    },
    { b: b64, t: target },
  );
  return { res, ms: Date.now() - t0 };
}

// ---------------------------------------------------------------------------
// DEF-386 - an impossible declared part/conformance is flagged, not echoed as
// a pass; a valid declared level still conforms with no such warning.
// ---------------------------------------------------------------------------
test('DEF-386: unrecognised declared level is warned and never conforms', async () => {
  const bogus1 = await validateFile(F.bogusId, 'pdfa-1b');
  const bogus2 = await validateFile(F.bogusId, 'pdfa-2b');
  const unknown = await validateFile(F.unknownConf, 'pdfa-1b');
  const pdfx = await validateFile(F.pdfxPart9, 'pdfx-1a');
  const control = await validateFile(F.pdfaOk, 'pdfa-1b');
  console.log('P54A_DEF386 ' + JSON.stringify({
    bogus1: { ok: bogus1.res.ok, declared: bogus1.res.value && bogus1.res.value.declared, conforms: bogus1.res.value && bogus1.res.value.conforms, rules: bogus1.res.value && bogus1.res.value.violations.map((v) => `${v.rule}:${v.severity}`) },
    bogus2: { ok: bogus2.res.ok, declared: bogus2.res.value && bogus2.res.value.declared, conforms: bogus2.res.value && bogus2.res.value.conforms, rules: bogus2.res.value && bogus2.res.value.violations.map((v) => `${v.rule}:${v.severity}`) },
    unknown: { declared: unknown.res.value && unknown.res.value.declared, conforms: unknown.res.value && unknown.res.value.conforms, rules: unknown.res.value && unknown.res.value.violations.map((v) => `${v.rule}:${v.severity}`) },
    pdfx: { declared: pdfx.res.value && pdfx.res.value.declared, conforms: pdfx.res.value && pdfx.res.value.conforms, rules: pdfx.res.value && pdfx.res.value.violations.map((v) => `${v.rule}:${v.severity}`) },
    control: { declared: control.res.value && control.res.value.declared, conforms: control.res.value && control.res.value.conforms, rules: control.res.value && control.res.value.violations.map((v) => `${v.rule}:${v.severity}`) },
  }));

  const levelOf = (r) => r.res.value.violations.find((v) => v.rule.endsWith('.declared-level'));
  expect(bogus1.res.ok, 'bogus id validation completes').toBe(true);
  expect(bogus1.res.value.conforms, 'bogus id never conforms').toBe(false);
  expect(levelOf(bogus1), 'Bogus pdfaid part 9/Z flagged').toBeTruthy();
  expect(bogus2.res.value.conforms, 'bogus id never conforms (2b)').toBe(false);
  expect(levelOf(bogus2), 'Bogus pdfaid flagged (2b)').toBeTruthy();
  expect(levelOf(unknown), 'PDF/A-1x flagged').toBeTruthy();
  expect(levelOf(pdfx), 'PDF/X-99:2099 flagged').toBeTruthy();
  expect(control.res.value.conforms, 'valid PDF/A-1b still conforms').toBe(true);
  expect(control.res.value.declared).toBe('PDF/A-1b');
  expect(levelOf(control), 'no declared-level warning on a valid level').toBeUndefined();
  await win.screenshot({ path: path.join(SHOTS, 'phase54-adv54-def386.png') });
});

// ---------------------------------------------------------------------------
// DEF-381 - the 200 MiB decoded content scan is capped: the report completes
// with the device-RGB rule as "could not be determined", never an OOM.
// ---------------------------------------------------------------------------
test('DEF-381: oversized device-RGB scan reports could not be determined', async () => {
  const v = await validateFile(F.bigContent, 'pdfx-1a');
  const value = v.res.value;
  const rgb = value && value.violations.filter((x) => x.rule === 'pdfx.device-rgb');
  const detail = rgb && rgb[0] ? rgb[0].detail : '';
  console.log('P54A_DEF381 ' + JSON.stringify({ ms: v.ms, ok: v.res.ok, conforms: value && value.conforms, rgb }));
  expect(v.res.ok, 'validation completed').toBe(true);
  expect(value.conforms, 'never a silent pass').toBe(false);
  expect(detail, 'device-RGB undetermined').toContain('could not be determined');
  expect(detail, 'names the scan cap').toContain('scan cap');
  // The scan finished in well under the old multi-second block/OOM.
  expect(v.ms, 'bounded scan').toBeLessThan(5000);
});

// ---------------------------------------------------------------------------
// DEF-382 - a normal image is unchanged: 720x360 px at 72 DPI stays
// ~719.91 x 359.96 pt and carries no clamp warning.
// ---------------------------------------------------------------------------
test('DEF-382: a normal image page box is unchanged and not clamped', async () => {
  await win.locator('[data-welcome-create]').click();
  await win.waitForSelector('[data-create-from-images-dialog]', { timeout: 10000 });
  const chooserPromise = win.waitForEvent('filechooser');
  await win.locator('[data-create-pick]').click();
  const chooser = await chooserPromise;
  await chooser.setFiles([F.dpi72]);
  await win.waitForFunction(
    () => document.querySelectorAll('[data-create-image-row]').length === 1,
    null,
    { timeout: 15000 },
  );
  await win.locator('[data-create-confirm]').click();
  await win.waitForSelector('[data-conversion-notice]', { timeout: 30000 });
  await win.waitForTimeout(600);

  const res = await win.evaluate(async () => {
    const d = window.tflexDiagnostics();
    const r = await window.tflex.engine.getDocumentBytes(d.engineDocId);
    const bytes = new Uint8Array(r.value);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { b64: btoa(bin) };
  });
  const doc = await PDFDocument.load(Buffer.from(res.b64, 'base64'));
  const size = doc.getPages()[0].getSize();
  const notice = win.locator('[data-conversion-notice]');
  const codes = await notice.locator('[data-conversion-warning]').evaluateAll((els) => els.map((e) => e.getAttribute('data-conversion-warning')));
  console.log('P54A_DEF382 ' + JSON.stringify({ size, codes }));
  expect(size.width, 'normal width unchanged').toBeCloseTo(719.91, 1);
  expect(size.height, 'normal height unchanged').toBeCloseTo(359.96, 1);
  expect(codes, 'no clamp warning for a normal image').not.toContain('page-clamped');
  await win.screenshot({ path: path.join(SHOTS, 'phase54-adv54-def382-normal.png') });
});

// ---------------------------------------------------------------------------
// DEF-384 - the all-NaN SVG must not present a blank page as `native`.
// ---------------------------------------------------------------------------
test('DEF-384: all-NaN SVG is not presented as native blank', async () => {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, F.numericHostile);
  await win.locator('[aria-label="Open PDF document"]').first().click();
  await win.waitForSelector('[data-conversion-notice]', { timeout: 30000 });
  await win.waitForTimeout(600);
  const notice = win.locator('[data-conversion-notice]');
  const fidelity = await notice.getAttribute('data-conversion-fidelity');
  const codes = await notice.locator('[data-conversion-warning]').evaluateAll((els) => els.map((e) => e.getAttribute('data-conversion-warning')));
  const texts = await notice.locator('[data-conversion-warning]').allInnerTexts();
  console.log('P54A_DEF384 ' + JSON.stringify({ fidelity, codes, texts }));
  expect(fidelity, 'blank page not labelled native').not.toBe('native');
  expect(codes, 'geometry loss surfaced').toContain('partial-content');
  expect(texts.join(' '), 'names the dropped geometry').toContain('numeric geometry');
  await win.screenshot({ path: path.join(SHOTS, 'phase54-adv54-def384-numeric.png') });
});
