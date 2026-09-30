// Phase 65 chunk 1 (TFL-89 / DEF-436) — FOCUSED VERIFICATION of the
// single-layer form field rendering on an anonymised 956-equivalent fixture.
//
// Verifies, on the RUNNING Electron app:
//   (a) CONTROL COUNT — per page, `.forms-layer [data-form-field]` (one per
//       FILLABLE widget) equals the engine's fillable widget count; read-only
//       and signature widgets get ZERO overlay controls (Phase 65 ruling 6);
//       multi-widget groups render one control per widget.
//   (b) SINGLE LAYER — a fillable widget's own light-grey /AP box is not
//       painted on the canvas under the editor (pixel sampling); a read-only
//       widget is painted exactly once, by the canvas, with no overlay control.
//   (b2) SIGNATURE / READ-ONLY — a minimal fixture with a fillable text, a
//       read-only text and a signature widget: each read-only/signature widget
//       has zero overlay controls and exactly one canvas surface.
//   (c) GEOMETRY — the measured control box equals field.rect / widget.rect
//       mapped through the page scale, at 100% and at a non-100% zoom.
//   (d) FILL — typing a text field and toggling a check box dispatches the
//       fill, the field's own value updates, and it survives a save /V.
//   (e) BLAST RADIUS — a foreign non-form annotation still paints on the
//       canvas; a read-only field is represented once by its canvas paint with
//       zero overlay controls; text selection outside form rects still works.
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { PDFDocument } = require('@cantoo/pdf-lib');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const FIXTURE = path.resolve(__dirname, '..', 'test-fixtures', 'phase65', 'form-956-anon.pdf');
const LOCKED_FIXTURE = path.resolve(__dirname, '..', 'test-fixtures', 'phase65', 'form-locked-anon.pdf');
const PAGE_W = 595.28; // pt — must match make-fixture.cjs
const PAGE_H = 841.89;
const PAGE_FIELDS = [3, 4, 5, 6];
const TOLERANCE_PX = 2;

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
  if (app) await hardClose(app, 'p65-forms');
  app = null;
  win = null;
});

// ---- app driving ---------------------------------------------------------

function tmpCopy() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p65-'));
  const copy = path.join(tmp, 'form-956-anon.pdf');
  fs.copyFileSync(FIXTURE, copy);
  return copy;
}

async function openPdf(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.workspace', { timeout: 60000 });
  await win.waitForFunction(() => {
    const d = window.tflexDiagnostics();
    return d.hasFormFields === true && (d.formFields || []).length >= 105;
  }, null, { timeout: 60000 });
  await win.waitForTimeout(800);
}

/** Open any form fixture and wait for at least `minFields` engine fields. */
async function openPdfGeneric(filePath, minFields) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.workspace', { timeout: 60000 });
  await win.waitForFunction((n) => {
    const d = window.tflexDiagnostics();
    return d.hasFormFields === true && (d.formFields || []).length >= n;
  }, minFields, { timeout: 60000 });
  await win.waitForTimeout(800);
}

async function diag() {
  return win.evaluate(() => window.tflexDiagnostics());
}

/** Sum, per 1-based page, the widgets the engine reports for that page. */
function engineWidgetsPerPage(d) {
  const perPage = {};
  for (const f of d.formFields || []) {
    const n = f.widgets && f.widgets.length > 1 ? f.widgets.length : 1;
    perPage[f.page] = (perPage[f.page] || 0) + n;
  }
  return perPage;
}

/** Sum, per 1-based page, only the FILLABLE widgets the engine reports.
 *  Phase 65 ruling 6: read-only and signature widgets are canvas-painted and
 *  get zero overlay controls, so criterion 3's control count is scoped to
 *  fillable widgets. Engine-orphan widgets (`orphan-…`) keep one overlay
 *  surface and are counted here. */
function engineFillableWidgetsPerPage(d) {
  const perPage = {};
  for (const f of d.formFields || []) {
    if (f.readOnly === true && !String(f.id).startsWith('orphan-')) continue;
    if (f.kind === 'signature') continue;
    const n = f.widgets && f.widgets.length > 1 ? f.widgets.length : 1;
    perPage[f.page] = (perPage[f.page] || 0) + n;
  }
  return perPage;
}

/** Scroll a page into the virtualized window and wait for its canvas. */
async function scrollToFormPage(pageNo) {
  for (let i = 0; i < 60; i += 1) {
    const done = await win.evaluate((want) => {
      const sc = document.querySelector('.document-scroller');
      if (!sc) return true;
      const slot = document.querySelector(`.page-slot[data-page="${want}"]`);
      if (slot) {
        sc.scrollTop = slot.offsetTop - 100;
        return true;
      }
      sc.scrollTop += 1200;
      return false;
    }, pageNo);
    await win.waitForTimeout(220);
    if (done) break;
  }
  await win.waitForSelector(`.pdf-page[data-page="${pageNo}"]`, { timeout: 20000 });
  await win.waitForTimeout(700);
}

async function readZoomPercent() {
  const txt = await win.locator('[data-zoom-pill] .zoom-percent').first().innerText();
  return Number.parseInt(txt.replace('%', ''), 10);
}

/** Click the real zoom buttons until the readout shows the target percent. */
async function setZoom(target) {
  for (let i = 0; i < 20; i += 1) {
    const p = await readZoomPercent();
    if (p === target) break;
    const label = p > target ? 'Zoom out' : 'Zoom in';
    await win.locator(`[data-zoom-pill] button[aria-label="${label}"]`).first().click();
    await win.waitForTimeout(550);
  }
  await win.waitForTimeout(700);
  return readZoomPercent();
}

/** Sample a page-relative CSS-px rect from the page canvas; classify pixels. */
async function sampleCanvas(pageNo, rel) {
  return win.evaluate(({ want, r }) => {
    const page = document.querySelector(`.pdf-page[data-page="${want}"]`);
    const canvas = page && page.querySelector('canvas');
    if (!page || !canvas) return null;
    const pb = page.getBoundingClientRect();
    const cb = canvas.getBoundingClientRect();
    const sx = canvas.width / cb.width;
    const sy = canvas.height / cb.height;
    const x0 = Math.max(0, Math.round((r.x + (pb.left - cb.left)) * sx));
    const y0 = Math.max(0, Math.round((r.y + (pb.top - cb.top)) * sy));
    const w = Math.max(1, Math.min(canvas.width - x0, Math.round(r.w * sx)));
    const h = Math.max(1, Math.min(canvas.height - y0, Math.round(r.h * sy)));
    const img = canvas.getContext('2d').getImageData(x0, y0, w, h);
    let red = 0;
    let grey = 0;
    let nonWhite = 0;
    const total = w * h;
    for (let i = 0; i < img.data.length; i += 4) {
      const R = img.data[i], G = img.data[i + 1], B = img.data[i + 2];
      if (R > 200 && G < 80 && B < 80) red += 1;
      if (Math.abs(R - G) < 12 && Math.abs(G - B) < 12 && R > 170 && R < 235) grey += 1;
      if (R < 245 || G < 245 || B < 245) nonWhite += 1;
    }
    return { bboxCanvasPx: [x0, y0, w, h], total, red, grey, nonWhite };
  }, { want: pageNo, r: rel });
}

/** Measure every forms-layer control on a page, relative to the page box. */
async function measurePage(pageNo) {
  return win.evaluate((p) => {
    const page = document.querySelector(`.pdf-page[data-page="${p}"]`);
    if (!page) return null;
    const pr = page.getBoundingClientRect();
    const out = [];
    page.querySelectorAll('.forms-layer [data-form-field]').forEach((el) => {
      const r = el.getBoundingClientRect();
      out.push({
        id: el.getAttribute('data-form-field'),
        widget: el.getAttribute('data-form-widget'),
        kind: el.getAttribute('data-form-kind'),
        left: r.left - pr.left,
        top: r.top - pr.top,
        width: r.width,
        height: r.height,
      });
    });
    return { pageWidth: pr.width, pageHeight: pr.height, out };
  }, pageNo);
}

/** Assert sampled controls sit at rect * pageScale within TOLERANCE_PX. */
function assertGeometry(m, pageNo, label) {
  const scale = m.pageWidth / PAGE_W;
  const byKey = new Map();
  for (const c of m.out) byKey.set(c.widget === null ? c.id : `${c.id}|${c.widget}`, c);
  let checked = 0;
  const want = [];
  for (const key of sampleKeys) want.push(key);
  for (const key of want) {
    const field = fieldById.get(key.id);
    if (field === undefined) continue;
    const rect = key.widget === null
      ? field.rect
      : field.widgets[Number(key.widget)].rect;
    const c = byKey.get(key.widget === null ? key.id : `${key.id}|${key.widget}`);
    expect(c, `${label} page ${pageNo}: control ${key.id}/${key.widget} present`).toBeTruthy();
    if (c === undefined) continue;
    const exp = {
      left: rect.x * scale,
      top: rect.y * scale,
      width: rect.width * scale,
      height: Math.max(rect.height, 14) * scale,
    };
    console.log(
      `[P65-c ${label}] ${key.id}${key.widget === null ? '' : '#' + key.widget} ` +
      `measured=[${c.left.toFixed(1)},${c.top.toFixed(1)},${c.width.toFixed(1)},${c.height.toFixed(1)}] ` +
      `expected=[${exp.left.toFixed(1)},${exp.top.toFixed(1)},${exp.width.toFixed(1)},${exp.height.toFixed(1)}]`,
    );
    expect(Math.abs(c.left - exp.left), `${key.id} left`).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(c.top - exp.top), `${key.id} top`).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(c.width - exp.width), `${key.id} width`).toBeLessThanOrEqual(TOLERANCE_PX);
    // Size-exact controls (the per-widget radio buttons) must match height too.
    // A text <input>'s border-box height is floored by the browser-intrinsic
    // line-height + padding (the editor's documented MIN_EDITOR_HEIGHT_PT
    // rule), so a short 18pt widget can render an editor a few px taller; that
    // is unchanged by chunk 1. Assert it never shrinks below the widget and
    // that any overflow stays small (< 6px) rather than hiding a real gap.
    const dH = c.height - exp.height;
    if (c.kind === 'radio' || c.kind === 'checkbox') {
      expect(Math.abs(dH), `${key.id} height`).toBeLessThanOrEqual(TOLERANCE_PX);
    } else {
      console.log(`[P65-c ${label}] ${key.id} height delta=${dH.toFixed(2)}px`);
      expect(c.height, `${key.id} not shorter than its widget`).toBeGreaterThanOrEqual(exp.height - TOLERANCE_PX);
      expect(dH, `${key.id} editor overflow bounded`).toBeLessThanOrEqual(6);
    }
    checked += 1;
  }
  expect(checked, `${label}: sampled controls measured`).toBeGreaterThan(0);
}

let fieldById = new Map();
let sampleKeys = [];
let shotSeq = 0;

// ---- (a) control count ---------------------------------------------------

test('(a) CONTROL COUNT — one control per FILLABLE widget per page, read-only/signature zero', async () => {
  const copy = tmpCopy();
  await openPdf(copy);
  const d = await diag();
  const engine = engineWidgetsPerPage(d);
  const fillable = engineFillableWidgetsPerPage(d);
  const report = {};
  for (const pageNo of PAGE_FIELDS) {
    await scrollToFormPage(pageNo);
    const dom = await win.evaluate((p) => {
      const el = document.querySelector(`.pdf-page[data-page="${p}"]`);
      return el ? el.querySelectorAll('.forms-layer [data-form-field]').length : -1;
    }, pageNo);
    report[pageNo] = dom;
    console.log(
      `[P65-a] page ${pageNo}: dom=${dom} engine=${engine[pageNo] || 0} fillable=${fillable[pageNo] || 0}`,
    );
    expect(dom, `page ${pageNo} control count equals engine FILLABLE widget count`).toBe(fillable[pageNo] || 0);
  }
  const missing = PAGE_FIELDS.reduce((s, p) => s + Math.max(0, (fillable[p] || 0) - report[p]), 0);
  const extras = PAGE_FIELDS.reduce((s, p) => s + Math.max(0, report[p] - (fillable[p] || 0)), 0);
  const totalEngine = PAGE_FIELDS.reduce((s, p) => s + (engine[p] || 0), 0);
  const totalFillable = PAGE_FIELDS.reduce((s, p) => s + (fillable[p] || 0), 0);
  const totalDom = PAGE_FIELDS.reduce((s, p) => s + report[p], 0);
  console.log(
    `[P65-a] totals engine=${totalEngine} fillable=${totalFillable} dom=${totalDom} missing=${missing} extras=${extras}`,
  );
  expect(missing, 'zero missing').toBe(0);
  expect(extras, 'zero extras').toBe(0);
  expect(totalEngine, 'engine reports all 129 widgets on pages 3-6').toBe(129);
  expect(totalFillable, 'two read-only widgets excluded => 127 fillable').toBe(127);
  expect(totalDom, 'DOM renders one control per fillable widget (127)').toBe(127);

  // Every real read-only widget has ZERO overlay controls (ruling 6).
  const readOnlyFields = (d.formFields || []).filter(
    (f) => f.readOnly === true && !String(f.id).startsWith('orphan-'),
  );
  expect(readOnlyFields.length, 'two read-only real widgets (text_p3_1, page-6)').toBe(2);
  for (const f of readOnlyFields) {
    await scrollToFormPage(f.page);
    const n = await win.locator(`.pdf-page[data-page="${f.page}"] .forms-layer [data-form-field="${f.id}"]`).count();
    console.log(`[P65-a] read-only ${f.name} (page ${f.page}) overlayControls=${n}`);
    expect(n, `read-only ${f.name} has zero overlay controls`).toBe(0);
  }

  const group = (d.formFields || []).find((f) => f.widgets && f.widgets.length === 6);
  expect(group, 'a 6-widget button group exists').toBeTruthy();
  await scrollToFormPage(group.page);
  const groupDom = await win.evaluate(
    (id) => document.querySelectorAll(`.forms-layer [data-form-field="${id}"]`).length,
    group.id,
  );
  console.log(`[P65-a] group ${group.name} widgets=${group.widgets.length} dom=${groupDom}`);
  expect(groupDom, 'multi-widget group renders one control per widget').toBe(group.widgets.length);

  // CONTROL-INDEX sweep (STEP 4): the named 4-widget group mg.title must render
  // exactly one control per widget, mirroring the mg.reason ex assertion above.
  const titleGroup = (d.formFields || []).find((f) => f.name === 'mg.title');
  expect(titleGroup, 'the mg.title 4-widget button group exists').toBeTruthy();
  expect(titleGroup.widgets.length, 'mg.title carries 4 widgets').toBe(4);
  await scrollToFormPage(titleGroup.page);
  const titleDom = await win.evaluate(
    (id) => document.querySelectorAll(`.forms-layer [data-form-field="${id}"]`).length,
    titleGroup.id,
  );
  console.log(`[P65-a] group ${titleGroup.name} widgets=${titleGroup.widgets.length} dom=${titleDom}`);
  expect(titleDom, 'mg.title renders one control per widget (4)').toBe(titleGroup.widgets.length);
});

// ---- (b) single layer ----------------------------------------------------

test('(b) SINGLE LAYER — canvas widget-box suppression for fillable vs read-only', async () => {
  const copy = tmpCopy();
  await openPdf(copy);
  await scrollToFormPage(3);
  const d = await diag();
  const scale = await win.evaluate((p) => {
    const el = document.querySelector(`.pdf-page[data-page="${p}"]`);
    return el ? el.getBoundingClientRect().width / 595.28 : 0;
  }, 3);
  const allText = (d.formFields || [])
    .filter((f) => f.page === 3 && f.kind === 'text' && f.rect.height >= 14);
  const fillable = allText.filter((f) => f.readOnly !== true).slice(0, 4);
  const readOnly = allText.filter((f) => f.readOnly === true).slice(0, 1);
  expect(fillable.length, 'fillable empty text fields to sample').toBeGreaterThan(0);
  console.log(`[P65-b] page3 scale=${scale.toFixed(4)} fillable=${fillable.length} readOnly=${readOnly.length}`);

  // 1. Fillable empty widgets: the canvas must NOT paint their /AP box.
  for (const f of fillable) {
    const rel = { x: f.rect.x * scale, y: f.rect.y * scale, w: f.rect.width * scale, h: f.rect.height * scale };
    const inside = await sampleCanvas(3, rel);
    const outside = await sampleCanvas(3, { x: rel.x, y: Math.max(0, rel.y - 6), w: rel.w, h: 4 });
    console.log(`[P65-b] fillable ${f.name} inside grey=${inside.grey}/${inside.total} red=${inside.red} nonWhite=${inside.nonWhite} | outside grey=${outside.grey} nonWhite=${outside.nonWhite}`);
    expect(inside.grey, `${f.name}: fillable widget /AP box suppressed`).toBe(0);
    expect(inside.red, `${f.name}: no red inside a text widget`).toBe(0);
  }

  await win.screenshot({ path: path.join(SHOTS, 'p65-956-after.png') });

  // 2. Hide the editor layer; whatever remains on the canvas is the canvas's own paint.
  const visibleBefore = await win.evaluate(() =>
    [...document.querySelectorAll('.forms-layer [data-form-field]')]
      .filter((e) => getComputedStyle(e).visibility !== 'hidden').length);
  await win.evaluate(() => {
    document.querySelectorAll('.forms-layer').forEach((e) => { e.style.visibility = 'hidden'; });
  });
  await win.waitForTimeout(350);
  const visibleHidden = await win.evaluate(() =>
    [...document.querySelectorAll('.forms-layer [data-form-field]')]
      .filter((e) => getComputedStyle(e).visibility !== 'hidden').length);
  expect(visibleHidden, 'hiding .forms-layer removes every interactive control').toBe(0);
  console.log(`[P65-b] forms hidden: visibleControls=${visibleHidden} (was ${visibleBefore})`);

  let roSample = null;
  if (readOnly.length > 0) {
    const f = readOnly[0];
    const rel = { x: f.rect.x * scale, y: f.rect.y * scale, w: f.rect.width * scale, h: f.rect.height * scale };
    roSample = { id: f.id, name: f.name, ...(await sampleCanvas(3, rel)) };
    console.log(`[P65-b] read-only ${f.name}: overlayControls=${await win.locator(`.forms-layer [data-form-field="${f.id}"]`).count()} canvas grey with editors hidden = ${roSample.grey}/${roSample.total}`);
  }
  await win.screenshot({ path: path.join(SHOTS, 'p65-956-canvas-only.png') });
  await win.evaluate(() => {
    document.querySelectorAll('.forms-layer').forEach((e) => { e.style.visibility = ''; });
  });
  await win.waitForTimeout(250);

  // 3. Read-only widgets: pdf.js marks them `hasOwnCanvas` and paints their
  //    /AP under ENABLE_FORMS, so under Phase 65 ruling 6 TFlex renders ZERO
  //    overlay controls for them: exactly one truthful canvas surface remains.
  if (roSample !== null) {
    const n = await win.locator(`.forms-layer [data-form-field="${roSample.id}"]`).count();
    expect(n, `read-only widget ${roSample.name} has zero overlay controls`).toBe(0);
    expect(
      roSample.grey,
      `read-only widget ${roSample.name} is painted exactly once on the canvas`,
    ).toBeGreaterThan(0);
  }
  console.log('[P65-b] wrote p65-956-after.png and p65-956-canvas-only.png');
});

// ---- (b2) signature / read-only suppression ------------------------------

test('(b2) SIGNATURE + READ-ONLY — canvas-only surface, zero overlay controls', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p65-locked-'));
  const copy = path.join(tmp, 'form-locked-anon.pdf');
  fs.copyFileSync(LOCKED_FIXTURE, copy);
  await openPdfGeneric(copy, 3);
  await win.waitForSelector('.pdf-page[data-page="1"]', { timeout: 20000 });
  await win.waitForTimeout(700);

  const d = await win.evaluate(() => window.tflexDiagnostics());
  const fill = (d.formFields || []).find((f) => f.kind === 'text' && f.readOnly !== true);
  const ro = (d.formFields || []).find((f) => f.kind === 'text' && f.readOnly === true);
  const sig = (d.formFields || []).find((f) => f.kind === 'signature');
  expect(fill, 'the fixture reports a fillable text field').toBeTruthy();
  expect(ro, 'the fixture reports a read-only text field').toBeTruthy();
  expect(sig, 'the fixture reports a signature field').toBeTruthy();
  console.log(`[P65-b2] ids fill=${fill.id} ro=${ro.id} sig=${sig.id}`);

  const counts = {};
  for (const f of [fill, ro, sig]) {
    counts[f.id] = await win.locator(`.pdf-page[data-page="1"] .forms-layer [data-form-field="${f.id}"]`).count();
  }
  console.log(`[P65-b2] overlayControls fill=${counts[fill.id]} ro=${counts[ro.id]} sig=${counts[sig.id]}`);
  expect(counts[fill.id], 'fillable field has exactly one overlay control').toBe(1);
  expect(counts[ro.id], 'read-only field has zero overlay controls').toBe(0);
  expect(counts[sig.id], 'signature field has zero overlay controls').toBe(0);

  const scale = await win.evaluate(() => {
    const el = document.querySelector('.pdf-page[data-page="1"]');
    return el ? el.getBoundingClientRect().width / 595.28 : 0;
  });
  await win.evaluate(() => {
    document.querySelectorAll('.forms-layer').forEach((e) => { e.style.visibility = 'hidden'; });
  });
  await win.waitForTimeout(350);
  const px = {};
  for (const f of [fill, ro, sig]) {
    px[f.id] = await sampleCanvas(1, {
      x: f.rect.x * scale, y: f.rect.y * scale, w: f.rect.width * scale, h: f.rect.height * scale,
    });
  }
  await win.evaluate(() => {
    document.querySelectorAll('.forms-layer').forEach((e) => { e.style.visibility = ''; });
  });
  await win.waitForTimeout(250);
  console.log(`[P65-b2] canvas grey fill=${px[fill.id].grey}/${px[fill.id].total} ro=${px[ro.id].grey}/${px[ro.id].total} sig=${px[sig.id].grey}/${px[sig.id].total}`);
  expect(px[fill.id].grey, 'fillable field canvas paints no /AP box (overlay is the one surface)').toBe(0);
  expect(px[ro.id].grey, 'read-only field paints exactly one canvas surface').toBeGreaterThan(0);
  expect(px[sig.id].grey, 'signature field paints exactly one canvas surface').toBeGreaterThan(0);
  await win.screenshot({ path: path.join(SHOTS, 'p65-locked-surfaces.png') });
});

// ---- (c) geometry --------------------------------------------------------

test('(c) GEOMETRY — control box equals rect * pageScale at 100% and 125%', async () => {
  const copy = tmpCopy();
  await openPdf(copy);
  const d = await diag();
  fieldById = new Map((d.formFields || []).map((f) => [f.id, f]));
  const texts = (d.formFields || [])
    .filter((f) => f.page === 3 && f.kind === 'text' && f.rect.height < 24 && f.readOnly !== true)
    .slice(0, 3);
  console.log(`[P65-c] sampled text rects=${JSON.stringify(texts.map((f) => ({ id: f.id, rect: f.rect })))}`);
  const group = (d.formFields || []).find((f) => f.page === 3 && f.widgets && f.widgets.length >= 4);
  expect(group, 'a multi-widget group on page 3').toBeTruthy();
  sampleKeys = texts.map((f) => ({ id: f.id, widget: null }));
  for (let k = 0; k < Math.min(3, group.widgets.length); k += 1) {
    sampleKeys.push({ id: group.id, widget: k });
  }
  console.log(`[P65-c] sampling ${sampleKeys.length} controls`);

  const pct100 = await setZoom(100);
  await scrollToFormPage(3);
  const m100 = await measurePage(3);
  assertGeometry(m100, 3, '100%');
  await win.screenshot({ path: path.join(SHOTS, 'p65-956-geometry-100.png') });

  const pct125 = await setZoom(125);
  expect(pct125, 'reached 125% readout').toBe(125);
  await scrollToFormPage(3);
  const m125 = await measurePage(3);
  assertGeometry(m125, 3, '125%');
  await win.screenshot({ path: path.join(SHOTS, 'p65-956-geometry-125.png') });
  console.log(`[P65-c] zoom readouts: ${pct100}% and ${pct125}%`);
});

// ---- (c2) rotated-page geometry (criterion 4) ----------------------------

async function readRotations() {
  const d = await diag();
  return (d.engineState && d.engineState.rotations) || null;
}

/** The CTO oracle mapping (top-left-origin page points, clockwise quarter
 *  turns, unrotated W=PAGE_W x H=PAGE_H) — mirrors mapRectForRotation. */
function mapForE2E(rect, rot) {
  switch (((Math.trunc(rot) % 4) + 4) % 4) {
    case 1:
      return { left: PAGE_H - (rect.y + rect.height), top: rect.x, width: rect.height, height: rect.width };
    case 2:
      return { left: PAGE_W - (rect.x + rect.width), top: PAGE_H - (rect.y + rect.height), width: rect.width, height: rect.height };
    case 3:
      return { left: rect.y, top: PAGE_W - (rect.x + rect.width), width: rect.height, height: rect.width };
    default:
      return { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
  }
}

/** Select page 3 in the thumbnail rail and click the PAGES dock rotate verb
 *  `turns` times; returns after the page is scrolled back into view. */
async function rotatePage3(turns) {
  await win.locator('.thumb-item[data-page="3"]').first().click();
  await win.waitForTimeout(500);
  const rotate = win.locator('[data-dock-verb="rotate"]');
  expect(await rotate.count(), 'the PAGES dock rotate verb is present').toBeGreaterThan(0);
  for (let i = 0; i < turns; i += 1) {
    await rotate.first().click();
    await win.waitForTimeout(1400);
  }
  await scrollToFormPage(3);
}

/** Assert one field's control equals its rect mapped through `rot` at the
 *  measured page scale. Returns the measured control. */
async function assertMapped(rot, label) {
  const d = await diag();
  const field = (d.formFields || []).find((f) => f.id === 'form-2-text_p3_2');
  expect(field, `${label}: field form-2-text_p3_2 exists`).toBeTruthy();
  const m = await measurePage(3);
  expect(m, `${label}: page 3 measured`).toBeTruthy();
  // rot 1/3 swap the page's on-screen width/height; rot 0/2 do not.
  const s = rot % 2 === 1 ? m.pageWidth / PAGE_H : m.pageWidth / PAGE_W;
  const c = (m.out || []).find((x) => x.id === 'form-2-text_p3_2' && x.widget === null);
  expect(c, `${label}: rotated control present`).toBeTruthy();
  if (!c || !field) return null;
  const e = mapForE2E(field.rect, rot);
  console.log(
    `[P65-c3 ${label}] measured=[${c.left.toFixed(1)},${c.top.toFixed(1)},${c.width.toFixed(1)},${c.height.toFixed(1)}] ` +
    `rot${((Math.trunc(rot) % 4) + 4) % 4}exp=[${(e.left * s).toFixed(1)},${(e.top * s).toFixed(1)},${(e.width * s).toFixed(1)},${(e.height * s).toFixed(1)}] scale=${s.toFixed(4)}`,
  );
  expect(Math.abs(c.left - e.left * s), `${label} left`).toBeLessThanOrEqual(TOLERANCE_PX);
  expect(Math.abs(c.top - e.top * s), `${label} top`).toBeLessThanOrEqual(TOLERANCE_PX);
  expect(Math.abs(c.width - e.width * s), `${label} width`).toBeLessThanOrEqual(TOLERANCE_PX);
  return c;
}

test('(c2) GEOMETRY — rotated page: control box follows the rotated widget rect', async () => {
  const copy = tmpCopy();
  await openPdf(copy);
  const d = await diag();
  const fields = new Map((d.formFields || []).map((f) => [f.id, f]));
  const texts = (d.formFields || [])
    .filter((f) => f.page === 3 && f.kind === 'text' && f.rect.height < 24 && f.readOnly !== true)
    .slice(0, 3);
  const group = (d.formFields || []).find((f) => f.page === 3 && f.widgets && f.widgets.length >= 4);
  expect(group, 'a multi-widget group on page 3').toBeTruthy();
  const keys = texts.map((f) => ({ id: f.id, widget: null }));
  for (let k = 0; k < Math.min(2, group.widgets.length); k += 1) {
    keys.push({ id: group.id, widget: k });
  }

  await setZoom(100);
  await scrollToFormPage(3);
  const before = await readRotations();
  console.log(`[P65-c2] rotations before=${JSON.stringify(before)}`);

  // Select page 3 in the thumbnail rail, then rotate it through the PAGES
  // dock's real `rotate` verb (the toolbar rotate is not mounted in this state).
  await win.locator('.thumb-item[data-page="3"]').first().click();
  await win.waitForTimeout(500);
  const rotate = win.locator('[data-dock-verb="rotate"]');
  expect(await rotate.count(), 'the PAGES dock rotate verb is present').toBeGreaterThan(0);
  await rotate.first().click();
  await win.waitForTimeout(1800);
  await scrollToFormPage(3);
  const after = await readRotations();
  console.log(`[P65-c2] rotations after=${JSON.stringify(after)}`);
  const rotPage3 = after && after[2];
  expect(rotPage3, 'page 3 accepted the quarter-turn rotation').toBe(1);

  const m = await measurePage(3);
  expect(m, 'page 3 measured').toBeTruthy();
  const s = m.pageWidth / PAGE_H; // quarter turn: wrapper width = unrotated height * scale
  console.log(`[P65-c2] wrapper=${m.pageWidth.toFixed(1)}x${m.pageHeight.toFixed(1)} scale=${s.toFixed(4)}`);
  await win.screenshot({ path: path.join(SHOTS, 'p65-956-rot90.png') });

  const byKey = new Map();
  for (const c of m.out) {
    byKey.set(c.widget === null ? c.id : `${c.id}|${c.widget}`, c);
  }
  let checked = 0;
  for (const key of keys) {
    const field = fields.get(key.id);
    if (field === undefined) continue;
    const rect = key.widget === null ? field.rect : field.widgets[Number(key.widget)].rect;
    // pdf.js rotation 90 maps unrotated top-based (x,y,w,h) to:
    //   left = (PAGE_H - y - h) * s, top = x * s, width = h * s, height = w * s
    const rot90 = {
      left: (PAGE_H - rect.y - rect.height) * s,
      top: rect.x * s,
      width: rect.height * s,
      height: rect.width * s,
    };
    const c = byKey.get(key.widget === null ? key.id : `${key.id}|${key.widget}`);
    expect(c, `rot90 control ${key.id} present`).toBeTruthy();
    if (c === undefined) continue;
    console.log(
      `[P65-c2] ${key.id} measured=[${c.left.toFixed(1)},${c.top.toFixed(1)},${c.width.toFixed(1)},${c.height.toFixed(1)}] ` +
      `rot90exp=[${rot90.left.toFixed(1)},${rot90.top.toFixed(1)},${rot90.width.toFixed(1)},${rot90.height.toFixed(1)}]`,
    );
    expect(Math.abs(c.left - rot90.left), `${key.id} left`).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(c.top - rot90.top), `${key.id} top`).toBeLessThanOrEqual(TOLERANCE_PX);
    expect(Math.abs(c.width - rot90.width), `${key.id} width`).toBeLessThanOrEqual(TOLERANCE_PX);
    checked += 1;
  }
  expect(checked, 'rotated controls measured').toBeGreaterThan(0);
});

// ---- (c3) rotated-page geometry at 180 / 270 and at 125% -------------------

test('(c3) GEOMETRY — 180 and 270 quarter turns, plus a 125% rotated assertion', async () => {
  const copy = tmpCopy();
  await openPdf(copy);
  await setZoom(100);
  await scrollToFormPage(3);

  const before = await readRotations();
  console.log(`[P65-c3] rotations before=${JSON.stringify(before)}`);

  // Two quarter turns from unrotated => 180.
  await rotatePage3(2);
  let after = await readRotations();
  console.log(`[P65-c3] rotations after 2 turns=${JSON.stringify(after)}`);
  expect(after && after[2], 'page 3 accepted the second quarter turn (180)').toBe(2);
  await assertMapped(2, '100% rot180');
  await win.screenshot({ path: path.join(SHOTS, 'p65-956-rot180.png') });

  // A third quarter turn => 270.
  await rotatePage3(1);
  after = await readRotations();
  console.log(`[P65-c3] rotations after 3rd turn=${JSON.stringify(after)}`);
  expect(after && after[2], 'page 3 accepted the third quarter turn (270)').toBe(3);
  await assertMapped(3, '100% rot270');
  await win.screenshot({ path: path.join(SHOTS, 'p65-956-rot270.png') });

  // Wrap back to unrotated, rescale to 125%, then rotate once and re-assert.
  await rotatePage3(1);
  const wrapped = await readRotations();
  expect(wrapped && wrapped[2], 'a fourth quarter turn wraps page 3 back to 0').toBe(0);
  const pct = await setZoom(125);
  expect(pct, 'reached 125% readout').toBe(125);
  await scrollToFormPage(3);
  await rotatePage3(1);
  const rot125 = await readRotations();
  expect(rot125 && rot125[2], 'page 3 accepted one quarter turn at 125%').toBe(1);
  await assertMapped(1, '125% rot90');
  await win.screenshot({ path: path.join(SHOTS, 'p65-956-rot90-125.png') });
});

// ---- (c4) hit / edit semantics on a rotated page ---------------------------

test('(c4) HIT/EDIT — a control at its mapped position on a rotated page takes a value', async () => {
  const copy = tmpCopy();
  await openPdf(copy);
  await setZoom(100);
  await scrollToFormPage(3);
  await rotatePage3(1);
  const after = await readRotations();
  expect(after && after[2], 'page 3 rotated to 90 before the hit test').toBe(1);

  const id = 'form-2-text_p3_2';
  const sel = `.forms-layer [data-form-field="${id}"]`;
  const n = await win.locator(sel).count();
  expect(n, 'the control is present at its mapped position').toBe(1);

  const box = await win.locator(sel).first().boundingBox();
  expect(box, 'the control has a box at the mapped position').toBeTruthy();
  console.log(`[P65-c4] control box=[${box.x.toFixed(1)},${box.y.toFixed(1)},${box.width.toFixed(1)},${box.height.toFixed(1)}]`);
  await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await win.waitForTimeout(300);
  const focused = await win.evaluate((s) => document.activeElement === document.querySelector(s), sel);
  expect(focused, 'the control at the mapped position receives focus').toBe(true);

  await win.keyboard.type('ROT1');
  await win.waitForTimeout(700);
  const val = await win.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? el.value : null;
  }, sel);
  const d = await diag();
  const engineVal = (d.formFields || []).find((f) => f.id === id)?.value;
  console.log(`[P65-c4] focused=${focused} typedValue="${val}" engineValue="${engineVal}"`);
  expect(val, 'the control takes the typed value at the mapped position').toBe('ROT1');
  expect(engineVal, 'the typed value reaches the engine fill path').toBe('ROT1');
  await win.screenshot({ path: path.join(SHOTS, 'p65-956-rot90-edit.png') });
});

// ---- (d) fill ------------------------------------------------------------

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

test('(d) FILL — text + checkbox dispatch, and values survive a save /V', async () => {
  const copy = tmpCopy();
  await openPdf(copy);
  const d = await diag();
  const textField = (d.formFields || []).find((f) => f.page === 3 && f.kind === 'text' && !f.readOnly);
  const cbField = (d.formFields || []).find((f) => f.page === 3 && f.kind === 'checkbox' && !f.readOnly);
  expect(textField, 'a writable text field on page 3').toBeTruthy();
  expect(cbField, 'a single check box on page 3').toBeTruthy();
  await scrollToFormPage(3);

  await win.locator(`[data-form-field="${textField.id}"]`).fill('QA65');
  await win.waitForTimeout(800);
  await win.locator(`button[data-form-field="${cbField.id}"]`).click();
  await win.waitForSelector('[data-form-fill-report]', { timeout: 20000 });
  await win.waitForTimeout(1500);

  const counts = await win.evaluate(() => {
    const e = document.querySelector('[data-form-fill-counts]');
    return e ? e.textContent.trim() : null;
  });
  console.log(`[P65-d] fill report counts="${counts}"`);
  const after = await diag();
  const tv = (after.formFields || []).find((f) => f.id === textField.id)?.value;
  const cv = (after.formFields || []).find((f) => f.id === cbField.id)?.value;
  console.log(`[P65-d] diagnostics text="${tv}" checkbox="${cv}"`);
  expect(tv, 'text field own value updated').toBe('QA65');
  expect(cv, 'check box own value updated').toBe('true');
  await win.screenshot({ path: path.join(SHOTS, 'p65-956-fill.png') });

  await win.waitForFunction(() => {
    const b = document.querySelector('[data-toolbar-save]');
    return b !== null && !b.disabled;
  }, null, { timeout: 20000 });
  await win.locator('[data-toolbar-save]').click();
  await win.waitForTimeout(3500);

  const saved = await readSaved(copy);
  const sval = saved.getForm().getField(textField.name).getText();
  const scv = saved.getForm().getField(cbField.name).isChecked();
  console.log(`[P65-d] saved ${textField.name} /V="${sval}" ${cbField.name} checked=${scv}`);
  expect(sval, 'native /V survives the save').toBe('QA65');
  expect(scv, 'native checkbox state survives the save').toBe(true);
});

// ---- (e) blast radius ----------------------------------------------------

test('(e) BLAST RADIUS — foreign annotation paints, read-only truthful, text selection works', async () => {
  const copy = tmpCopy();
  await openPdf(copy);
  const d = await diag();
  await scrollToFormPage(3);
  const scale = await win.evaluate((p) => {
    const el = document.querySelector(`.pdf-page[data-page="${p}"]`);
    return el ? el.getBoundingClientRect().width / 595.28 : 0;
  }, 3);

  // 1. The foreign non-form /Square (red) still paints on the page canvas.
  const redRect = { x: 46 * scale, y: (PAGE_H - 810) * scale, w: 120 * scale, h: 20 * scale };
  const redSample = await sampleCanvas(3, redRect);
  console.log(`[P65-e] red /Square sample red=${redSample.red}/${redSample.total} nonWhite=${redSample.nonWhite}`);
  expect(redSample.red, 'a foreign non-form annotation still paints on the canvas').toBeGreaterThan(20);
  await win.screenshot({ path: path.join(SHOTS, 'p65-956-blast-annot.png') });

  // 2. A read-only field is represented exactly once: by its canvas paint,
  //    with zero overlay controls (Phase 65 ruling 6).
  const ro = (d.formFields || []).find((f) => f.page === 3 && f.readOnly === true && f.kind === 'text');
  expect(ro, 'a read-only text field on page 3').toBeTruthy();
  const roControls = await win.locator(`.forms-layer [data-form-field="${ro.id}"]`).count();
  expect(roControls, 'read-only field has zero overlay controls').toBe(0);
  const roScale = await win.evaluate((p) => {
    const el = document.querySelector(`.pdf-page[data-page="${p}"]`);
    return el ? el.getBoundingClientRect().width / 595.28 : 0;
  }, 3);
  const roSample = await sampleCanvas(3, {
    x: ro.rect.x * roScale, y: ro.rect.y * roScale, w: ro.rect.width * roScale, h: ro.rect.height * roScale,
  });
  console.log(`[P65-e] read-only ${ro.name}: overlayControls=${roControls} canvas grey=${roSample.grey}/${roSample.total}`);
  expect(roSample.grey, 'read-only field paint appears exactly once on the canvas').toBeGreaterThan(0);

  // 2b. No fill can be dispatched from a read-only widget: with zero overlay
  //     controls, a real click on its region must not change its value and
  //     must not fire the fill report.
  const roValueBefore = (await diag()).formFields.find((f) => f.id === ro.id)?.value;
  const roCenter = await win.evaluate((r) => {
    const page = document.querySelector('.pdf-page[data-page="3"]');
    const pb = page.getBoundingClientRect();
    return { x: pb.left + (r.x + r.width / 2) * r.s, y: pb.top + (r.y + r.height / 2) * r.s };
  }, { x: ro.rect.x, y: ro.rect.y, width: ro.rect.width, height: ro.rect.height, s: roScale });
  await win.mouse.click(roCenter.x, roCenter.y);
  await win.waitForTimeout(500);
  const roValueAfter = (await diag()).formFields.find((f) => f.id === ro.id)?.value;
  const fillReports = await win.locator('[data-form-fill-report]').count();
  console.log(`[P65-e] read-only ${ro.name}: click value before="${roValueBefore}" after="${roValueAfter}" fillReports=${fillReports}`);
  expect(roValueAfter, 'read-only widget value unchanged by a click').toBe(roValueBefore);
  expect(fillReports, 'no fill dispatched from a read-only widget').toBe(0);

  // 3. Text selection over printed artwork, outside every form rect, still works.
  const tr = await win.evaluate(() => {
    const spans = [...document.querySelectorAll('.pdf-page[data-page="3"] .textLayer span')];
    const s = spans.find((el) => el.textContent.includes('PRINTED FORM'));
    if (!s) return null;
    const r = s.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  expect(tr, 'the printed text layer span exists').toBeTruthy();
  await win.mouse.move(tr.x + 1, tr.y + tr.h / 2);
  await win.mouse.down();
  await win.mouse.move(tr.x + tr.w - 1, tr.y + tr.h / 2, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(250);
  const sel = await win.evaluate(() => window.getSelection().toString());
  console.log(`[P65-e] text selection="${sel}"`);
  expect(sel.length, 'text selection over the page still works outside form rects').toBeGreaterThan(0);
  await win.screenshot({ path: path.join(SHOTS, 'p65-956-blast-selection.png') });
});
