// Phase 74 chunk 2 (TFL-241) — REAL-FILE reproduction of the rendered form
// on the operator's 956.pdf (copy at test-fixtures/tfl225/956-real.pdf).
// Repointed by chunk 4 (TFL-249) to verify the DEF-461 FIX-READY change.
//
// This spec drives the RUNNING Electron app (built tree) through the canonical
// launchApp helper and, for form pages 3-6:
//   (1) ENCRYPTED OPEN  — no spurious password prompt, engine reports
//       hasFormFields === true with exactly 105 fields (captured once).
//   (2) CONTROL COUNT   — per page, DOM overlay surfaces vs the engine's
//       widget count (field.page + field.widgets). Screenshots p74-fix-p3..p6.
//   (3) AT-REST CHROME  — the repointed single-layer oracle for DEF-461. On the
//       REAL file the printed grey box is the form's own artwork (the 84 text
//       fields have no /AP), so canvas sampling cannot separate printed box
//       from overlay box. The oracle now reads each sampled overlay control's
//       COMPUTED style at rest and asserts it adds NO visible box: `.form-editor`
//       border + background alpha 0; unchecked `.form-checkbox` / `.form-radio-dot`
//       border alpha 0. Hovering one text field and one checkbox must still
//       reveal a visible accent border. The canvas sample is kept as an
//       INFORMATIONAL count only.
//   (4) TICK STATE      — rendered state vs engine value for single checkboxes
//       and radio groups (informational table).
//   (5) TICK ROUND-TRIP — click a checkbox, assert rendered+engine flip, save,
//       reopen the saved bytes, assert the tick renders from the saved /V.
//   (6) FILL ROUND-TRIP — type a known value, assert the fill report fired, save,
//       reopen, assert the value reads back from the saved file.
//
// Mirrors e2e/phase65_form_layer.spec.cjs for launch / scroll / sampleCanvas /
// save+reopen. No product code is touched; a failing assertion is the verdict.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const REAL = path.resolve(__dirname, '..', 'test-fixtures', 'tfl225', '956-real.pdf');
const FORM_PAGES = [3, 4, 5, 6];

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
  if (app) await hardClose(app, 'p74-real');
  app = null;
  win = null;
});

// ---- app driving ---------------------------------------------------------

/** Copy the real fixture to a temp dir so the tracked fixture is never
 *  touched. The copy is what the real-file run opens and saves. */
function tmpCopy() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p74-'));
  const copy = path.join(tmp, '956-real.pdf');
  fs.copyFileSync(REAL, copy);
  return copy;
}

async function diag() {
  return win.evaluate(() => window.tflexDiagnostics());
}

/** Open `filePath`; returns true when a password prompt appeared during the
 *  open. Phase 74 criterion 1 — the real copy must NOT prompt. */
async function openReal(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
  await win.locator('[data-toolbar-open]').first().click();
  let prompted = false;
  for (let i = 0; i < 120; i += 1) {
    const s = await win.evaluate(() => ({
      ws: document.querySelector('.workspace') !== null,
      pw: document.querySelector('[data-password-prompt]') !== null,
    }));
    if (s.pw) { prompted = true; break; }
    if (s.ws) break;
    await win.waitForTimeout(250);
  }
  return prompted;
}

/** Open any file and wait for at least `minFields` engine fields. Used for the
 *  save/reopen round-trips (a fresh copy of the saved bytes). */
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

/** Page-relative CSS-px rect of one control element on a page. */
async function controlRelRect(pageNo, selector) {
  return win.evaluate(({ want, sel }) => {
    const page = document.querySelector(`.pdf-page[data-page="${want}"]`);
    const el = page && page.querySelector(sel);
    if (!page || !el) return null;
    const pr = page.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - pr.left, y: r.top - pr.top, w: r.width, h: r.height };
  }, { want: pageNo, sel: selector });
}

/** Parse the alpha channel of a computed CSS color (0..1). */
function alphaOf(color) {
  if (!color) return 1;
  if (color === 'transparent') return 0;
  const m = /rgba?\(([^)]+)\)/.exec(color);
  if (m === null) return 1;
  const parts = m[1].split(',').map((s) => Number(s.trim()));
  return parts.length >= 4 ? parts[3] : 1;
}

/** Same checked-reading rule as CheckboxEditor (forms/FormsOverlay.tsx). */
function isCheckedValue(v) {
  return v === 'true' || (!Array.isArray(v) && v === 'Yes');
}

/** Rendered + engine state of one checkbox control. */
async function readCheckbox(id) {
  return win.evaluate((fid) => {
    const el = document.querySelector(`.forms-layer .form-checkbox[data-form-field="${fid}"]`);
    const d = window.tflexDiagnostics();
    const f = (d.formFields || []).find((x) => x.id === fid);
    return {
      present: el !== null,
      pressed: el ? el.getAttribute('aria-pressed') === 'true' : null,
      cls: el ? el.className : null,
      value: f ? f.value : null,
    };
  }, id);
}

// ---- the verification ----------------------------------------------------

test('REAL 956.pdf — DEF-461 fix: one visible surface + tick/fill round-trips', async () => {
  const copy = tmpCopy();
  const prompted = await openReal(copy);

  // (1) ENCRYPTED OPEN -----------------------------------------------------
  await win.waitForSelector('.workspace', { timeout: 60000 });
  await win.waitForTimeout(500);
  const pwCount = await win.locator('[data-password-prompt]').count();
  console.log(`[P74-1] passwordPromptDuringOpen=${prompted} passwordPromptAfterOpen=${pwCount}`);
  await win.waitForFunction(() => {
    const d = window.tflexDiagnostics();
    return d.hasFormFields === true && (d.formFields || []).length === 105;
  }, null, { timeout: 60000 });

  const d = await diag();
  const fields = d.formFields || [];
  const kinds = {};
  for (const f of fields) kinds[f.kind] = (kinds[f.kind] || 0) + 1;
  const engineWidgetsPerPage = {};
  const engineFieldsPerPage = {};
  for (const f of fields) {
    const n = f.widgets && f.widgets.length > 1 ? f.widgets.length : 1;
    engineWidgetsPerPage[f.page] = (engineWidgetsPerPage[f.page] || 0) + n;
    engineFieldsPerPage[f.page] = (engineFieldsPerPage[f.page] || 0) + 1;
  }
  console.log(`[P74-1] hasFormFields=${d.hasFormFields} formFields.length=${fields.length} kinds=${JSON.stringify(kinds)}`);
  console.log(`[P74-1] engine fieldsPerPage=${JSON.stringify(engineFieldsPerPage)} widgetsPerPage=${JSON.stringify(engineWidgetsPerPage)}`);

  // (2) CONTROL COUNT + (5) SCREENSHOTS -------------------------------------
  const domPerPage = {};
  for (const p of FORM_PAGES) {
    await scrollToFormPage(p);
    const dom = await win.evaluate((want) => {
      const el = document.querySelector(`.pdf-page[data-page="${want}"]`);
      return el
        ? el.querySelectorAll(
            '.forms-layer [data-form-field], .forms-layer .form-radio-widget[data-form-widget]',
          ).length
        : -1;
    }, p);
    domPerPage[p] = dom;
    await win.locator(`.pdf-page[data-page="${p}"]`).screenshot({ path: path.join(SHOTS, `p74-fix-p${p}.png`) });
    // Item D — phase-close single-surface evidence set.
    await win.locator(`.pdf-page[data-page="${p}"]`).screenshot({ path: path.join(SHOTS, `p74-close-p${p}.png`) });
    console.log(`[P74-2] page ${p}: dom=${dom} engineFields=${engineFieldsPerPage[p] || 0} engineWidgets=${engineWidgetsPerPage[p] || 0}`);
  }
  const missing = FORM_PAGES.reduce((s, p) => s + Math.max(0, (engineWidgetsPerPage[p] || 0) - domPerPage[p]), 0);
  const extras = FORM_PAGES.reduce((s, p) => s + Math.max(0, domPerPage[p] - (engineWidgetsPerPage[p] || 0)), 0);
  const totalDom = FORM_PAGES.reduce((s, p) => s + domPerPage[p], 0);
  const totalWidgets = FORM_PAGES.reduce((s, p) => s + (engineWidgetsPerPage[p] || 0), 0);
  console.log(`[P74-2] table=${JSON.stringify(FORM_PAGES.map((p) => ({ page: p, dom: domPerPage[p], engineWidgets: engineWidgetsPerPage[p] || 0 })))}`);
  console.log(`[P74-2] totals dom=${totalDom} engineWidgets=${totalWidgets} missing=${missing} extras=${extras}`);

  // (3) AT-REST CHROME ORACLE (repointed) -----------------------------------
  // Sample >=8 controls incl. text, checkbox and radio widget; read each
  // overlay control's COMPUTED style at rest and assert it adds NO box.
  await win.mouse.move(2, 2);
  const textCands = fields.filter((f) => f.kind === 'text' && FORM_PAGES.includes(f.page) && f.rect.height > 0).slice(0, 5);
  const singleCbs = fields.filter((f) => f.kind === 'checkbox' && !(f.widgets && f.widgets.length > 1) && FORM_PAGES.includes(f.page));
  const uncheckedCbs = singleCbs.filter((f) => !isCheckedValue(f.value));
  const radioGroups = fields.filter((f) => f.kind === 'radio' && f.widgets && f.widgets.length > 1 && FORM_PAGES.includes(f.page));
  const sampleTargets = [];
  for (const f of textCands) sampleTargets.push({ page: f.page, sel: `.forms-layer [data-form-field="${f.id}"]`, kind: 'text', label: `text:${f.name}`, id: f.id });
  for (const f of (uncheckedCbs.length > 0 ? uncheckedCbs : singleCbs).slice(0, 2)) sampleTargets.push({ page: f.page, sel: `.forms-layer .form-checkbox[data-form-field="${f.id}"]`, kind: 'checkbox', label: `checkbox:${f.name}`, id: f.id });
  for (const f of radioGroups.slice(0, 2)) {
    const sel = f.widgets.findIndex((w) => w.selected !== true);
    const wi = sel >= 0 ? sel : 0;
    sampleTargets.push({ page: f.page, sel: `.forms-layer .form-radio-widget[data-form-field="${f.id}"][data-form-widget="${wi}"] .form-radio-dot`, kind: 'radio-dot', label: `radio:${f.name}#${wi}`, id: f.id, widget: wi });
  }

  const atRest = [];
  const canvasInfo = [];
  for (const t of sampleTargets) {
    await scrollToFormPage(t.page);
    await win.mouse.move(2, 2);
    const style = await win.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const cs = getComputedStyle(el);
      return {
        borderTop: cs.borderTopColor,
        borderLeft: cs.borderLeftColor,
        borderRight: cs.borderRightColor,
        borderBottom: cs.borderBottomColor,
        background: cs.backgroundColor,
      };
    }, t.sel);
    const rel = await controlRelRect(t.page, t.sel);
    const px = rel === null ? null : await sampleCanvas(t.page, rel);
    if (px !== null) canvasInfo.push({ label: t.label, page: t.page, grey: px.grey, total: px.total });
    if (style === null) {
      atRest.push({ ...t, missing: true, visible: true });
      console.log(`[P74-3] ${t.label} page=${t.page}: NO CONTROL ELEMENT`);
      continue;
    }
    const borders = [style.borderTop, style.borderLeft, style.borderRight, style.borderBottom];
    const borderAlpha = borders.map(alphaOf);
    const bgAlpha = alphaOf(style.background);
    const borderVisible = borderAlpha.some((a) => a > 0.02);
    const bgVisible = bgAlpha > 0.02;
    const visible = t.kind === 'text' ? borderVisible || bgVisible : borderVisible;
    atRest.push({ ...t, visible, borderAlpha, bgAlpha });
    console.log(`[P74-3] ${t.label} page=${t.page} kind=${t.kind} borderAlpha=${JSON.stringify(borderAlpha)} bgAlpha=${bgAlpha.toFixed(3)} visible=${visible} canvasGrey=${px ? px.grey : 'null'}`);
  }
  const visibleRest = atRest.filter((r) => r.visible);
  console.log(`[P74-3] sampled=${sampleTargets.length} visibleAtRest=${visibleRest.length} controls=${JSON.stringify(visibleRest.map((r) => ({ label: r.label, page: r.page, missing: r.missing === true })))}`);
  console.log(`[P74-3-INFO] canvas sample (informational only, real file prints its own grey artwork): ${JSON.stringify(canvasInfo)}`);
  const pushButtons = fields.filter((f) => f.pushButton === true).length;
  const textWithAp = fields.filter((f) => f.kind === 'text' && f.widgets && f.widgets.length > 0).length;
  console.log(`[P74-3-INFO] pushButtons=${pushButtons} textFieldsWithWidgets=${textWithAp}`);

  // (3b) HOVER AFFORDANCE — one text field, one checkbox --------------------
  const hoverRows = [];
  const textTarget = sampleTargets.find((t) => t.kind === 'text');
  const cbTarget = sampleTargets.find((t) => t.kind === 'checkbox');
  for (const t of [textTarget, cbTarget]) {
    if (t === undefined) continue;
    await scrollToFormPage(t.page);
    await win.locator(t.sel).hover();
    await win.waitForTimeout(450);
    const color = await win.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el === null ? null : getComputedStyle(el).borderTopColor;
    }, t.sel);
    hoverRows.push({ label: t.label, page: t.page, kind: t.kind, borderTopColor: color, alpha: alphaOf(color) });
    console.log(`[P74-3b] ${t.label} page=${t.page} kind=${t.kind} hoverBorderTop=${color} alpha=${alphaOf(color).toFixed(3)}`);
  }
  await win.mouse.move(2, 2);
  // (4) TICK STATE (informational table) -----------------------------------
  const tickRows = [];
  for (const f of singleCbs.slice(0, 6)) {
    await scrollToFormPage(f.page);
    const st = await win.evaluate((id) => {
      const el = document.querySelector(`.forms-layer .form-checkbox[data-form-field="${id}"]`);
      if (!el) return null;
      return { pressed: el.getAttribute('aria-pressed'), cls: el.className };
    }, f.id);
    const v = Array.isArray(f.value) ? f.value.join(',') : f.value;
    const expected = isCheckedValue(f.value);
    const rendered = st ? (st.pressed === 'true' || String(st.cls).includes('form-checkbox-checked')) : null;
    tickRows.push({ kind: 'checkbox', id: f.id, name: f.name, page: f.page, engineValue: v, expected, rendered });
  }
  for (const f of radioGroups.slice(0, 4)) {
    await scrollToFormPage(f.page);
    const st = await win.evaluate((id) => {
      const els = [...document.querySelectorAll(`.forms-layer .form-radio-widget[data-form-field="${id}"]`)];
      return els.map((el) => ({ w: Number(el.getAttribute('data-form-widget')), pressed: el.getAttribute('aria-pressed'), cls: el.className }));
    }, f.id);
    const engineSel = f.widgets.findIndex((w) => w.selected === true);
    const renderedSel = st.findIndex((r) => r.pressed === 'true' || String(r.cls).includes('form-radio-checked'));
    tickRows.push({ kind: 'radio', id: f.id, name: f.name, page: f.page, engineValue: Array.isArray(f.value) ? f.value.join(',') : f.value, engineSelected: engineSel, renderedSelected: renderedSel });
  }
  console.log(`[P74-4] singleCheckboxes=${singleCbs.length} uncheckedCheckboxes=${uncheckedCbs.length} radioGroups=${radioGroups.length}`);
  console.log(`[P74-4] tickTable=${JSON.stringify(tickRows)}`);

  // (5) TICK ROUND-TRIP (criterion 3) ---------------------------------------
  const tickCb = uncheckedCbs[0] || singleCbs[0];
  expect(tickCb, 'a single checkbox for the tick round-trip').toBeTruthy();
  await scrollToFormPage(tickCb.page);
  await win.mouse.move(2, 2);
  const beforeTick = await readCheckbox(tickCb.id);
  const wantTick = beforeTick.pressed !== true;
  console.log(`[P74-5] tick target id=${tickCb.id} name="${tickCb.name}" page=${tickCb.page} beforePressed=${beforeTick.pressed} engineValue="${beforeTick.value}" want=${wantTick}`);
  // Probe for a non-standard on-value whether the engine exposes one.
  console.log(`[P74-5] target widgets=${JSON.stringify(tickCb.widgets || null)} engineValue="${tickCb.value}"`);
  await win.locator(`.forms-layer .form-checkbox[data-form-field="${tickCb.id}"]`).click();
  await win.waitForFunction(({ id, want }) => {
    const el = document.querySelector(`.forms-layer .form-checkbox[data-form-field="${id}"]`);
    const d = window.tflexDiagnostics();
    const f = (d.formFields || []).find((x) => x.id === id);
    if (el === null || f === undefined) return false;
    return el.getAttribute('aria-pressed') === String(want) && (f.value === 'true') === want;
  }, { id: tickCb.id, want: wantTick }, { timeout: 20000 });
  const afterTick = await readCheckbox(tickCb.id);
  const afterTickEngine = (await diag()).formFields.find((f) => f.id === tickCb.id)?.value;
  console.log(`[P74-5] after click: pressed=${afterTick.pressed} cls="${afterTick.cls}" engineValue="${afterTickEngine}"`);
  expect(afterTick.pressed, 'checkbox rendered state flipped').toBe(wantTick);
  expect(afterTickEngine === 'true', 'checkbox engine value matches rendered state').toBe(wantTick);

  // (6) FILL ROUND-TRIP (criterion 6) ---------------------------------------
  const textField = fields.find((f) => f.kind === 'text' && f.page === tickCb.page && f.readOnly !== true && f.rect.height > 0)
    || fields.find((f) => f.kind === 'text' && f.readOnly !== true && f.rect.height > 0);
  expect(textField, 'a writable text field for the fill round-trip').toBeTruthy();
  const KNOWN = 'TFL249';
  await scrollToFormPage(textField.page);
  await win.locator(`.forms-layer [data-form-field="${textField.id}"]`).fill(KNOWN);
  await win.waitForTimeout(1200);
  await win.waitForSelector('[data-form-fill-report]', { timeout: 20000 });
  await win.waitForFunction(({ id, want }) => {
    const d = window.tflexDiagnostics();
    const f = (d.formFields || []).find((x) => x.id === id);
    return f !== undefined && f.value === want;
  }, { id: textField.id, want: KNOWN }, { timeout: 20000 });
  const counts = await win.evaluate(() => {
    const e = document.querySelector('[data-form-fill-counts]');
    return e ? e.textContent.trim() : null;
  });
  console.log(`[P74-6] fill report counts="${counts}" textField=${textField.id} name="${textField.name}" page=${textField.page}`);

  // (7) SAVE + REOPEN ROUND-TRIP --------------------------------------------
  await win.waitForFunction(() => {
    const b = document.querySelector('[data-toolbar-save]');
    return b !== null && !b.disabled;
  }, null, { timeout: 20000 });
  await win.locator('[data-toolbar-save]').click();
  await win.waitForTimeout(3500);

  // Item C — the SAVE-time native-fill report (DEF-471). Read the surfaced
  // report; the fix must yield 105 filled / 0 skipped with no option-unknown
  // or "option not found: Off" rows for the 12 untouched empty groups.
  let saveReport = null;
  for (let i = 0; i < 40; i += 1) {
    const dSave = await diag();
    const r = dSave.engineState && dSave.engineState.formFillReport;
    if (Array.isArray(r) && r.length > 0) { saveReport = r; break; }
    await win.waitForTimeout(250);
  }
  const saveCounts = await win.evaluate(() => {
    const e = document.querySelector('[data-form-fill-counts]');
    return e ? e.textContent.trim() : null;
  });
  const saveFilled = (saveReport || []).filter((r) => r.status === 'filled').length;
  const saveSkipped = (saveReport || []).filter((r) => r.status !== 'filled');
  console.log(`[P74-C] saveReport rows=${saveReport ? saveReport.length : 'null'} filled=${saveFilled} skipped=${saveSkipped.length} counts="${saveCounts}"`);
  console.log(`[P74-C] saveSkippedRows=${JSON.stringify(saveSkipped.map((r) => ({ name: r.name, status: r.status, detail: r.detail })))}`);
  expect(saveReport, 'the save-time fill report is surfaced').toBeTruthy();
  expect(saveFilled, 'save-time report: 105 filled').toBe(105);
  expect(saveSkipped.length, 'save-time report: 0 skipped').toBe(0);
  expect(
    (saveReport || []).some((r) => r.status === 'option-unknown' || String(r.detail || '').includes('option not found: Off')),
    'no untouched empty group reports option-unknown / "option not found: Off"',
  ).toBe(false);

  const savedBytes = fs.statSync(copy);
  const reopenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p74-reopen-'));
  const reopenPath = path.join(reopenDir, '956-reopen.pdf');
  fs.copyFileSync(copy, reopenPath);
  console.log(`[P74-7] saved copy bytes=${savedBytes.size} reopenPath=${reopenPath}`);
  // Reopen the SAVED bytes in a fresh app instance: a second tab would leave a
  // hidden pane whose .document-scroller collides with the active one, and a
  // fresh launch is the strongest form of "reopen from the saved /V".
  await hardClose(app, 'p74-reopen');
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
  await openPdfGeneric(reopenPath, 105);

  const d2 = await diag();
  const reopenTickEngine = d2.formFields.find((f) => f.id === tickCb.id)?.value;
  const reopenTextEngine = d2.formFields.find((f) => f.id === textField.id)?.value;
  await scrollToFormPage(tickCb.page);
  const reopenTick = await readCheckbox(tickCb.id);
  await scrollToFormPage(textField.page);
  const reopenText = await win.evaluate((fid) => {
    const el = document.querySelector(`.forms-layer [data-form-field="${fid}"]`);
    return el ? el.value : null;
  }, textField.id);
  console.log(`[P74-7] reopened: tickPressed=${reopenTick.pressed} tickEngineValue="${reopenTickEngine}" textDomValue="${reopenText}" textEngineValue="${reopenTextEngine}"`);
  expect(reopenTickEngine === 'true', 'reopened checkbox engine value is checked from the saved /V').toBe(wantTick);
  expect(reopenTick.pressed, 'reopened checkbox renders from the saved /V (rendered == engine value)').toBe(wantTick);
  expect(reopenText, 'reopened text field renders the saved value').toBe(KNOWN);
  expect(reopenTextEngine, 'reopened text engine value reads the saved /V').toBe(KNOWN);

  // ---- assertions ---------------------------------------------------------
  expect(prompted, 'no spurious password prompt during open').toBe(false);
  expect(pwCount, 'no password prompt after open').toBe(0);
  expect(d.hasFormFields, 'engine reports form fields').toBe(true);
  expect(fields.length, 'engine reports 105 fields').toBe(105);
  expect(missing, 'zero missing overlay controls per page').toBe(0);
  expect(extras, 'zero extra overlay controls per page').toBe(0);
  expect(sampleTargets.length, 'sampled at least 8 controls incl. text/checkbox/radio').toBeGreaterThanOrEqual(8);
  expect(textCands.length, 'a text field was sampled').toBeGreaterThan(0);
  expect(singleCbs.length, 'a checkbox was sampled').toBeGreaterThan(0);
  expect(radioGroups.length, 'a radio widget was sampled').toBeGreaterThan(0);
  expect(visibleRest.length, 'zero sampled controls show a visible box at rest').toBe(0);
  expect(hoverRows.find((r) => r.kind === 'text'), 'a text field hover was measured').toBeTruthy();
  expect(hoverRows.find((r) => r.kind === 'checkbox'), 'a checkbox hover was measured').toBeTruthy();
  for (const r of hoverRows) expect(r.alpha, `hover reveals a visible accent border on ${r.label}`).toBeGreaterThan(0.02);
  const cbRows = tickRows.filter((r) => r.kind === 'checkbox');
  const radioRows = tickRows.filter((r) => r.kind === 'radio');
  expect(cbRows.length, 'at least 3 single checkboxes measured').toBeGreaterThanOrEqual(3);
  for (const r of cbRows) expect(r.rendered, `checkbox ${r.name} (page ${r.page}) rendered state matches engine value ${r.engineValue}`).toBe(r.expected);
  expect(radioRows.length, 'at least 2 radio groups measured').toBeGreaterThanOrEqual(2);
  for (const r of radioRows) expect(r.renderedSelected, `radio ${r.name} (page ${r.page}) rendered selection matches engine widget.selected ${r.engineSelected}`).toBe(r.engineSelected);
  expect(counts, 'the fill report fired').toMatch(/filled/);
});

// ---- item B: themed hover/focus computed styles (DEF-470) ----------------
// The phase-close retest of DEF-470, driven through the app's OWN theme
// picker (no direct data-theme poking). Expected colors are resolved from the
// live CSS custom properties in the active theme, so the assertion compares
// the field's computed edge to the token it must use.

/** Resolve a CSS custom property to its computed color in the current theme. */
async function tokenColor(name) {
  return win.evaluate((n) => {
    const el = document.createElement('div');
    el.style.borderColor = `var(${n})`;
    el.style.borderStyle = 'solid';
    el.style.borderWidth = '1px';
    el.style.position = 'fixed';
    el.style.left = '-1000px';
    el.style.top = '0';
    document.body.appendChild(el);
    const c = getComputedStyle(el).borderTopColor;
    el.remove();
    return c;
  }, name);
}

/** Drive the app's real theme picker; resolves once <html data-theme> flips. */
async function selectTheme(value) {
  const current = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (current !== value) {
    await win.locator('[data-theme-toggle]').click();
    await win.locator(`[data-theme-option="${value}"]`).click();
  }
  await win.waitForFunction((v) => document.documentElement.getAttribute('data-theme') === v, value, { timeout: 15000 });
  await win.waitForTimeout(450);
}

test('DEF-470 retest — themed hover/focus accent on a real form field', async () => {
  const copy = tmpCopy();
  await openReal(copy);
  await win.waitForSelector('.workspace', { timeout: 60000 });
  await win.waitForFunction(() => {
    const d = window.tflexDiagnostics();
    return d.hasFormFields === true && (d.formFields || []).length === 105;
  }, null, { timeout: 60000 });

  const d = await diag();
  const tf = (d.formFields || []).find((f) => f.kind === 'text' && f.page === 3 && f.rect.height > 0);
  expect(tf, 'a text field on page 3').toBeTruthy();
  const sel = `.forms-layer [data-form-field="${tf.id}"]`;
  const results = {};
  for (const theme of ['light', 'dark', 'frosted']) {
    await selectTheme(theme);
    await scrollToFormPage(3);
    await win.mouse.move(2, 2);
    await win.waitForTimeout(350);
    const accentSoft = await tokenColor('--accent-soft');
    const accentHover = await tokenColor('--accent-hover');
    const rest = await win.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { border: cs.borderTopColor, bg: cs.backgroundColor };
    }, sel);
    await win.locator(sel).hover();
    await win.waitForTimeout(450);
    const hover = await win.evaluate((s) => {
      const el = document.querySelector(s);
      return el ? getComputedStyle(el).borderTopColor : null;
    }, sel);
    await win.locator(sel).click();
    await win.waitForTimeout(450);
    const focus = await win.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { border: cs.borderTopColor, bg: cs.backgroundColor };
    }, sel);
    // Diagnostic: move the pointer off the field and re-read focus, to separate
    // "the :focus rule is missing" from "the later :hover rule out-orders it".
    await win.mouse.move(2, 2);
    await win.waitForTimeout(350);
    const focusAway = await win.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { border: cs.borderTopColor, bg: cs.backgroundColor, active: document.activeElement === el };
    }, sel);
    results[theme] = { accentSoft, accentHover, rest, hover, focus, focusAway };
    await win.screenshot({ path: path.join(SHOTS, `p74-close-focus-${theme}.png`) });
    console.log(`[P74-B] theme=${theme} accentSoft=${accentSoft} accentHover=${accentHover} rest=${JSON.stringify(rest)} hover=${hover} focus=${JSON.stringify(focus)} focusAway=${JSON.stringify(focusAway)}`);
  }
  for (const theme of ['light', 'dark', 'frosted']) {
    const r = results[theme];
    expect(r.rest, `${theme}: field present`).toBeTruthy();
    expect(alphaOf(r.rest.border), `${theme}: editor border transparent at rest`).toBeLessThanOrEqual(0.02);
    expect(alphaOf(r.rest.bg), `${theme}: editor background transparent at rest`).toBeLessThanOrEqual(0.02);
    expect(r.hover, `${theme}: hover border resolves accent-soft`).toBe(r.accentSoft);
    expect(r.focus.border, `${theme}: focus border resolves accent-hover (pointer over the field)`).toBe(r.accentHover);
    if (theme === 'dark') {
      expect(alphaOf(r.focus.bg), 'dark focus keeps the white wash').toBeGreaterThan(0.02);
    }
  }
});




// ---- item F: multi-widget group tick round-trip (criterion 3) -------------
test('criterion 3 — multi-widget group select + save/reopen, rendered == engine /V', async () => {
  const copy = tmpCopy();
  await openReal(copy);
  await win.waitForSelector('.workspace', { timeout: 60000 });
  await win.waitForFunction(() => {
    const d = window.tflexDiagnostics();
    return d.hasFormFields === true && (d.formFields || []).length === 105;
  }, null, { timeout: 60000 });

  const d = await diag();
  const group = (d.formFields || []).find(
    (f) => f.kind === 'radio' && f.widgets && f.widgets.length > 1 && f.page === 3,
  );
  expect(group, 'a multi-widget group on page 3').toBeTruthy();
  await scrollToFormPage(group.page);
  const wi = 0;
  const dotSel = `.forms-layer .form-radio-widget[data-form-field="${group.id}"][data-form-widget="${wi}"]`;
  await win.mouse.move(2, 2);
  await win.locator(dotSel).click();
  await win.waitForTimeout(800);
  const engineAfterClick = (await diag()).formFields.find((f) => f.id === group.id)?.value;
  const renderedAfterClick = await win.evaluate((id) => {
    const els = [...document.querySelectorAll(`.forms-layer .form-radio-widget[data-form-field="${id}"]`)];
    return els.findIndex((el) => el.getAttribute('aria-pressed') === 'true' || String(el.className).includes('form-radio-checked'));
  }, group.id);
  console.log(`[P74-F] group=${group.name} widgets=${group.widgets.length} clicked=${wi} engineValue="${engineAfterClick}" renderedSelected=${renderedAfterClick}`);
  await win.locator(`.pdf-page[data-page="${group.page}"]`).screenshot({ path: path.join(SHOTS, 'p74-close-group-ticked.png') });
  expect(typeof engineAfterClick === 'string' && engineAfterClick.length > 0, 'engine group value set after click').toBe(true);
  expect(renderedAfterClick, 'rendered tick matches the clicked widget').toBe(wi);

  await win.waitForFunction(() => {
    const b = document.querySelector('[data-toolbar-save]');
    return b !== null && !b.disabled;
  }, null, { timeout: 20000 });
  await win.locator('[data-toolbar-save]').click();
  await win.waitForTimeout(3500);
  // Item C — the selected group's row in the SAVE-time report must be `filled`.
  let saveReportF = null;
  for (let i = 0; i < 40; i += 1) {
    const dSave = await diag();
    const r = dSave.engineState && dSave.engineState.formFillReport;
    if (Array.isArray(r) && r.length > 0) { saveReportF = r; break; }
    await win.waitForTimeout(250);
  }
  const groupRow = (saveReportF || []).find((r) => r.name === group.name);
  console.log(`[P74-F] save-time report groupRow=${JSON.stringify(groupRow)}`);
  expect(groupRow, 'the saved group has a save-time report row').toBeTruthy();
  expect(groupRow.status, 'the saved group reports filled').toBe('filled');
  const savedBytes = fs.statSync(copy);
  const reopenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p74-grp-'));
  const reopenPath = path.join(reopenDir, '956-reopen.pdf');
  fs.copyFileSync(copy, reopenPath);
  console.log(`[P74-F] saved copy bytes=${savedBytes.size}`);

  await hardClose(app, 'p74-grp');
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
  await openPdfGeneric(reopenPath, 105);

  const d2 = await diag();
  const reopenEngine = d2.formFields.find((f) => f.id === group.id)?.value;
  await scrollToFormPage(group.page);
  const reopenRendered = await win.evaluate((id) => {
    const els = [...document.querySelectorAll(`.forms-layer .form-radio-widget[data-form-field="${id}"]`)];
    return els.findIndex((el) => el.getAttribute('aria-pressed') === 'true' || String(el.className).includes('form-radio-checked'));
  }, group.id);
  console.log(`[P74-F] reopened group engine="${reopenEngine}" rendered=${reopenRendered}`);
  await win.locator(`.pdf-page[data-page="${group.page}"]`).screenshot({ path: path.join(SHOTS, 'p74-close-group-reopened.png') });
  expect(reopenEngine, 'reopened group /V equals the value set before save').toBe(engineAfterClick);
  expect(reopenRendered, 'reopened rendered tick equals the saved /V (rendered == engine)').toBe(wi);
});
