// QA retest for the eight accepted Phase-59 adversary findings
// (ADV-121..128 -> DEF-421..428). Canonical launcher only.
//
// Engine-level findings (421/424/425/426/427) drive the real app's engine
// bridge (window.tflex.engine) exactly as the adversary harness did; the UI
// findings (422/423/424/428) drive the real UI. Every assertion is on an
// observable result, not on a click completing.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { PDFDocument, PDFName } = require('@cantoo/pdf-lib');

const REPO = path.resolve(__dirname, '..');
const FIX = path.join(REPO, 'test-fixtures');
const SHOTS = path.join(REPO, 'screenshots');

let app = null;
let win = null;
let tmp = null;

test.setTimeout(300000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p59-adv-'));
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p59-adv');
  app = null;
  win = null;
  tmp = null;
});

function copyFixture(rel) {
  const src = path.join(FIX, rel);
  const dst = path.join(tmp, `${Date.now()}-${path.basename(rel)}`);
  fs.copyFileSync(src, dst);
  return dst;
}

async function openPath(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
  const welcome = await win.locator('[data-home-tool="open"]').count();
  if (welcome > 0) await win.locator('[data-home-tool="open"]').first().click({ timeout: 15000 });
  else await win.locator('[data-toolbar-open]').first().click({ timeout: 15000 });
  await win.waitForSelector('.workspace', { timeout: 40000 });
  await win.waitForTimeout(1000);
}

async function setWindowSize(w, h) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const bw = BrowserWindow.getAllWindows().find((x) => x.isVisible()) || BrowserWindow.getAllWindows()[0];
    if (bw) { bw.unmaximize(); bw.setSize(s[0], s[1]); }
  }, [w, h]);
  await win.waitForTimeout(700);
  await win.waitForFunction((t) => Math.abs(window.innerWidth - t) < 60, w, { timeout: 10000 });
}

// ---- engine bridge helpers ------------------------------------------------
async function loadDoc(id, filePath, password) {
  return win.evaluate(async ([i, p, pw]) => {
    const r = await window.tflex.engine.loadDocument(i, p, pw);
    return r.ok ? { ok: true } : { ok: false, error: r.error, message: r.message };
  }, [id, filePath, password]);
}
async function getFields(id) {
  return win.evaluate(async (i) => {
    const r = await window.tflex.engine.getFormFields(i);
    return r.ok ? { ok: true, fields: r.value } : { ok: false, error: r.error, message: r.message };
  }, id);
}
async function fill(id, fieldId, value) {
  return win.evaluate(async ([i, f, v]) => {
    const r = await window.tflex.engine.fillFormField(i, { id: f, value: v });
    return r.ok ? { ok: true, state: r.value } : { ok: false, error: r.error, message: r.message };
  }, [id, fieldId, value]);
}
async function save(id) {
  return win.evaluate(async (i) => {
    const r = await window.tflex.engine.save(i);
    return r.ok ? { ok: true, path: r.value } : { ok: false, error: r.error, message: r.message };
  }, id);
}
async function applyOp(id, op) {
  return win.evaluate(async ([i, o]) => {
    const r = await window.tflex.engine.applyOp(i, o);
    return r.ok ? { ok: true, state: r.value } : { ok: false, error: r.error, message: r.message };
  }, [id, op]);
}
async function getState(id) {
  return win.evaluate(async (i) => {
    const r = await window.tflex.engine.getState(i);
    return r.ok ? { ok: true, state: r.value } : { ok: false, error: r.error, message: r.message };
  }, id);
}
async function merge(id, paths, position) {
  return win.evaluate(async ([i, ps, pos]) => {
    const r = await window.tflex.engine.merge(i, ps, pos);
    return r.ok ? { ok: true, state: r.value } : { ok: false, error: r.error, message: r.message };
  }, [id, paths, position]);
}

/** Independent re-parse: field name -> array of widget /Rect arrays. */
async function widgetRects(filePath) {
  const doc = await PDFDocument.load(fs.readFileSync(filePath));
  const form = doc.getForm();
  const out = {};
  for (const f of form.getFields()) {
    out[f.getName()] = f.acroField.getWidgets().map((w) => {
      const r = w.dict.get(PDFName.of('Rect'));
      return r ? [r.get(0).asNumber(), r.get(1).asNumber(), r.get(2).asNumber(), r.get(3).asNumber()] : null;
    });
  }
  return out;
}

async function measureTabs() {
  return win.evaluate(() => {
    const area = document.querySelector('.tab-area');
    const list = document.querySelector('.tab-list');
    const active = document.querySelector('[data-tab-id][aria-selected="true"]');
    const lr = list.getBoundingClientRect();
    const ar = active ? active.getBoundingClientRect() : null;
    const close = active ? active.querySelector('.tab-close') : null;
    const cr = close ? close.getBoundingClientRect() : null;
    const hit = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      return top === el || el.contains(top);
    };
    return {
      innerW: window.innerWidth,
      areaW: area ? area.clientWidth : null,
      listW: list ? list.clientWidth : null,
      listRect: { left: lr.left, right: lr.right },
      active: ar ? { left: ar.left, right: ar.right, w: ar.width } : null,
      activeVisible: ar ? ar.left >= lr.left - 1 && ar.right <= lr.right + 1 : false,
      closeReachable: hit(close),
      closeBox: cr ? { left: cr.left, right: cr.right, w: cr.width, h: cr.height } : null,
    };
  });
}

async function addTabs(n) {
  for (let i = 0; i < n; i += 1) {
    const plus = win.locator('[data-new-tab]');
    if ((await plus.count()) === 0) break;
    await plus.first().click({ timeout: 5000 }).catch(() => {});
    await win.waitForTimeout(50);
  }
  await win.waitForTimeout(800);
}

// ---------------------------------------------------------------------------
// DEF-421 (ADV-121) � merge must carry real widget geometry for BOTH docs.
// ---------------------------------------------------------------------------
test('DEF-421 (ADV-121): merge carries real widget geometry for both documents', async () => {
  const dest = copyFixture('adv-p59/paginated.pdf');
  const src = copyFixture('form.pdf');
  const load = await loadDoc('m', dest);
  expect(load.ok, JSON.stringify(load)).toBe(true);
  const m = await merge('m', [src], 'after');
  expect(m.ok, JSON.stringify(m)).toBe(true);
  const saved = await save('m');
  expect(saved.ok, JSON.stringify(saved)).toBe(true);

  const rects = await widgetRects(dest);
  console.log('[DEF-421] rects=' + JSON.stringify(rects));
  const wh = (name) => {
    const r = rects[name];
    return r && r[0] ? [r[0][2] - r[0][0], r[0][3] - r[0][1]] : null;
  };
  // Destination fields keep their real geometry.
  expect(wh('page2_field'), 'page2_field width/height').toEqual([301, 21]);
  expect(wh('page3_field'), 'page3_field width/height').toEqual([301, 21]);
  expect(wh('page2_check'), 'page2_check width/height').toEqual([17, 17]);
  // Merged source fields keep their real geometry.
  expect(wh('applicant_name'), 'applicant_name width/height').toEqual([201, 21]);
  expect(wh('applicant_address'), 'applicant_address width/height').toEqual([401, 21]);
  expect(wh('application_date'), 'application_date width/height').toEqual([101, 21]);
  expect(wh('department'), 'department width/height').toEqual([151, 21]);
  expect(wh('skills'), 'skills width/height').toEqual([151, 71]);
  // No widget sits at pdf-lib's default box (-0.5,-0.5,201,51).
  for (const [name, list] of Object.entries(rects)) {
    for (const r of list) {
      expect(r, `${name} not at the default box`).not.toEqual([-0.5, -0.5, 201, 51]);
      expect(r[0] === -0.5 && r[1] === -0.5, `${name} not stacked at the page origin`).toBe(false);
    }
  }
  // Values survive.
  const fields = await getFields('m');
  expect(fields.ok).toBe(true);
  const byName = Object.fromEntries(fields.fields.map((f) => [f.name, f.value]));
  expect(byName.page3_field, 'page3_field value survives').toBe('third page value');
  expect(byName.applicant_name, 'applicant_name value survives').toBe('John Doe');
});

// ---------------------------------------------------------------------------
// DEF-422 (ADV-122) � the tab strip must stay usable at the 640px minimum.
// ---------------------------------------------------------------------------
test('DEF-422 (ADV-122): tab strip usable at 640px with 1 tab and with many', async () => {
  await openPath(getSamplePath('report.pdf'));
  await setWindowSize(640, 720);
  const one = await measureTabs();
  console.log('[DEF-422|1tab] ' + JSON.stringify(one));
  expect(one.areaW, 'tab-area width > 0 with 1 tab').toBeGreaterThan(0);
  expect(one.activeVisible, 'active tab visible with 1 tab').toBe(true);
  expect(one.closeReachable, 'active close reachable with 1 tab').toBe(true);

  await addTabs(12);
  const many = await measureTabs();
  console.log('[DEF-422|many] ' + JSON.stringify(many));
  expect(many.areaW, 'tab-area width > 0 with many tabs').toBeGreaterThan(0);
  expect(many.activeVisible, 'active tab visible with many tabs').toBe(true);
  expect(many.closeReachable, 'active close reachable with many tabs').toBe(true);
  await win.screenshot({ path: path.join(SHOTS, 'def422-640.png') });
});

// ---------------------------------------------------------------------------
// DEF-423 (ADV-123) � a /Sig field must render NON-editable with a reason.
// ---------------------------------------------------------------------------
test('DEF-423 (ADV-123): a /Sig field renders non-editable with a truthful reason', async () => {
  const p = copyFixture('adv-p59/signed.pdf');
  const load = await loadDoc('sig', p);
  expect(load.ok, JSON.stringify(load)).toBe(true);
  const fields = await getFields('sig');
  const sigField = fields.fields.find((f) => f.name === 'approval');
  console.log('[DEF-423] engine field=' + JSON.stringify(sigField));
  // The signature field must stay LISTED (never silently dropped) and be
  // classified as a non-fillable kind, not text.
  expect(sigField, 'signature field still listed by the engine').toBeTruthy();
  expect(String(sigField.kind), 'signature field kind').toBe('signature');

  // A fill against it must report skipped-signature; the typed value cannot
  // be silently accepted.
  const fillr = await fill('sig', sigField.id, 'typed attempt');
  console.log('[DEF-423] fill=' + JSON.stringify(fillr));
  expect(fillr.ok, JSON.stringify(fillr)).toBe(true);
  const row = (fillr.state.formFillReport || []).find((r) => r.name === 'approval');
  expect(row, 'signature fill report row').toBeTruthy();
  expect(row.status, 'signature fill status').toBe('skipped-signature');

  await openPath(p);
  await win.waitForTimeout(1500);
  const editors = await win.evaluate(() => {
    const pane = '.tab-pane[aria-hidden="false"]';
    return Array.from(document.querySelectorAll(pane + ' [data-form-field]')).map((e) => ({
      id: e.getAttribute('data-form-field'),
      kind: e.getAttribute('data-form-kind'),
      nonfillable: e.getAttribute('data-form-nonfillable'),
      readonly: e.getAttribute('data-form-readonly'),
      tag: e.tagName,
      disabled: e.disabled === true,
      reason: e.getAttribute('title') || e.getAttribute('aria-label'),
    }));
  });
  console.log('[DEF-423] editors=' + JSON.stringify(editors));
  await win.screenshot({ path: path.join(SHOTS, 'def423-signed.png') });
  const sig = editors.find((e) => String(e.id).includes('approval'));
  expect(sig, 'the /Sig field has an editor').toBeTruthy();
  const editable = sig && (sig.tag === 'INPUT' || sig.tag === 'TEXTAREA') && sig.disabled !== true;
  expect(
    editable,
    `signature field rendered editable (tag=${sig && sig.tag}, disabled=${sig && sig.disabled}, kind=${sig && sig.kind})`,
  ).toBe(false);
  expect(sig.nonfillable, 'signature field flagged non-fillable').toBe('true');
  expect(String(sig.reason), 'truthful signature reason').toContain('Signature');
});

// ---------------------------------------------------------------------------
// DEF-424 (ADV-124) � orphan widget: non-editable, orphan- id, no false fill.
// ---------------------------------------------------------------------------
test('DEF-424 (ADV-124): orphan widget is non-editable, keeps orphan- id, fill does not claim success', async () => {
  const p = copyFixture('adv-p59/orphan.pdf');
  const load = await loadDoc('o', p);
  expect(load.ok, JSON.stringify(load)).toBe(true);
  const fields = await getFields('o');
  const orphan = fields.fields.find((f) => f.name === 'ghost');
  console.log('[DEF-424] orphan=' + JSON.stringify(orphan));
  expect(orphan, 'orphan listed').toBeTruthy();
  expect(String(orphan.id).startsWith('orphan-'), `orphan id keeps prefix (${orphan.id})`).toBe(true);
  expect(orphan.readOnly, 'orphan exposed read-only').toBe(true);

  const fillr = await fill('o', orphan.id, 'tried to fill orphan');
  console.log('[DEF-424] fill=' + JSON.stringify(fillr));
  expect(fillr.ok).toBe(true);
  const row = (fillr.state.formFillReport || []).find((r) => r.name === 'ghost');
  expect(row, 'orphan report row').toBeTruthy();
  expect(row.status, 'orphan fill status').toBe('orphan-unfilled');
  expect(fillr.state.modified, 'orphan fill leaves the document unmodified').toBe(false);

  await openPath(p);
  await win.waitForTimeout(1500);
  const ui = await win.evaluate(() => {
    const pane = '.tab-pane[aria-hidden="false"]';
    return Array.from(document.querySelectorAll(pane + ' [data-form-field]')).map((e) => ({
      id: e.getAttribute('data-form-field'),
      tag: e.tagName,
      disabled: e.disabled === true,
      nonfillable: e.getAttribute('data-form-nonfillable'),
    }));
  });
  console.log('[DEF-424] ui=' + JSON.stringify(ui));
  const orphanUi = ui.find((e) => String(e.id).startsWith('orphan-'));
  expect(orphanUi, 'orphan editor mounted').toBeTruthy();
  const editable = orphanUi && (orphanUi.tag === 'INPUT' || orphanUi.tag === 'TEXTAREA') && orphanUi.disabled !== true;
  expect(editable, `orphan rendered editable (tag=${orphanUi && orphanUi.tag})`).toBe(false);
});

// ---------------------------------------------------------------------------
// DEF-425 (ADV-125) � an XFA-only document must report the XFA condition.
// ---------------------------------------------------------------------------
test('DEF-425 (ADV-125): XFA-only document reports the XFA condition', async () => {
  const p = copyFixture('adv-p59/xfa-only.pdf');
  const load = await loadDoc('x', p);
  expect(load.ok, JSON.stringify(load)).toBe(true);
  const fields = await getFields('x');
  console.log('[DEF-425] fields=' + JSON.stringify(fields));
  expect(fields.ok).toBe(true);
  expect(fields.fields.length, 'XFA-only has no AcroForm fields').toBe(0);

  const fillr = await fill('x', 'form-0-whatever', 'x');
  console.log('[DEF-425] fill=' + JSON.stringify(fillr));
  expect(fillr.ok).toBe(true);
  const row = (fillr.state.formFillReport || []).find((r) => r.status === 'xfa');
  expect(row, 'XFA report row present').toBeTruthy();
  expect(row.page, 'XFA row is not tied to a page').toBeNull();
});

// ---------------------------------------------------------------------------
// DEF-426 (ADV-126) � an unknown group option must not report "filled".
// ---------------------------------------------------------------------------
test('DEF-426 (ADV-126): unknown group option is not reported filled and does not change the value', async () => {
  const p = copyFixture('adv-p59/multiwidget.pdf');
  const load = await loadDoc('g', p);
  expect(load.ok, JSON.stringify(load)).toBe(true);
  const fields = await getFields('g');
  const group = fields.fields.find((f) => f.name === 'shipping');
  console.log('[DEF-426] group=' + JSON.stringify(group));
  expect(group, 'shipping group listed').toBeTruthy();
  const before = group.value;

  const fillr = await fill('g', group.id, 'zzz-unknown');
  console.log('[DEF-426] fill=' + JSON.stringify(fillr));
  expect(fillr.ok).toBe(true);
  const row = (fillr.state.formFillReport || []).find((r) => r.name === 'shipping');
  expect(row, 'group report row').toBeTruthy();
  expect(row.status, 'unknown option status').toBe('option-unknown');

  const after = await getFields('g');
  const groupAfter = after.fields.find((f) => f.name === 'shipping');
  expect(groupAfter.value, 'value unchanged after an unknown option').toBe(before);
});

// ---------------------------------------------------------------------------
// DEF-427 (ADV-127) � fill-report page numbers must be remapped.
// ---------------------------------------------------------------------------
test('DEF-427 (ADV-127): fill report page numbers are remapped after delete/reorder', async () => {
  const p = copyFixture('adv-p59/paginated.pdf');
  const load = await loadDoc('r', p);
  expect(load.ok, JSON.stringify(load)).toBe(true);

  // Delete original page 1 (index 0): orig pages 2/3 become visible 1/2.
  const del = await applyOp('r', { kind: 'delete', page: 0 });
  expect(del.ok, JSON.stringify(del)).toBe(true);
  const fields = await getFields('r');
  const f3 = fields.fields.find((f) => f.name === 'page3_field');
  const fillr = await fill('r', f3.id, 'post-delete');
  expect(fillr.ok).toBe(true);
  const report = fillr.state.formFillReport || [];
  console.log('[DEF-427] report=' + JSON.stringify(report));
  expect(report.find((r) => r.name === 'page3_field').page, 'page3_field visible page').toBe(2);
  expect(report.find((r) => r.name === 'page2_field').page, 'page2_field visible page').toBe(1);

  // Delete the page carrying page2_field (visible page 1, orig index 1).
  const del2 = await applyOp('r', { kind: 'delete', page: 0 });
  expect(del2.ok, JSON.stringify(del2)).toBe(true);
  const state = await getState('r');
  const report2 = state.state.formFillReport || [];
  console.log('[DEF-427] report2=' + JSON.stringify(report2));
  expect(report2.find((r) => r.name === 'page2_field').page, 'deleted page -> null').toBeNull();
  expect(report2.find((r) => r.name === 'page3_field').page, 'page3_field now visible 1').toBe(1);
});

// ---------------------------------------------------------------------------
// DEF-428 (ADV-128) � shrinking the window must bring the active tab into view.
// ---------------------------------------------------------------------------
test('DEF-428 (ADV-128): shrinking the window brings the active tab into view', async () => {
  await openPath(getSamplePath('report.pdf'));
  await addTabs(20);
  await setWindowSize(640, 720);
  await setWindowSize(1400, 900);
  const m = await measureTabs();
  console.log('[DEF-428] ' + JSON.stringify(m));
  expect(m.activeVisible, 'active tab scrolled into view after resize').toBe(true);
  expect(m.closeReachable, 'active close reachable after resize').toBe(true);
  await win.screenshot({ path: path.join(SHOTS, 'def428-1400.png') });
});
