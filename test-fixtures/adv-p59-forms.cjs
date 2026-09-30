// Adversarial Phase-59 forms probe. Drives the RUNNING app's engine through the
// renderer bridge (window.tflex.engine) against hostile AcroForm fixtures, then
// re-parses the saved bytes with @cantoo/pdf-lib (an independent parser) to
// check preservation / value round-trips. Standalone harness (NOT an e2e spec).
//
// Run: node test-fixtures/adv-p59-forms.cjs [scenario]
const REPO = 'C:\\Users\\tanzi\\OneDrive\\App Development\\TFlex';
const { launchApp } = require(REPO + '\\e2e\\lib\\launch.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument, PDFName, PDFHexString } = require('@cantoo/pdf-lib');

const FIX = path.join(REPO, 'test-fixtures', 'adv-p59');
const TMP = path.join(os.tmpdir(), 'adv-p59-forms-' + Date.now());
fs.mkdirSync(TMP, { recursive: true });

const log = (...a) => console.log('###', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function copyFixture(name) {
  const src = path.join(FIX, name);
  const dst = path.join(TMP, `${Date.now()}-${name}`);
  fs.copyFileSync(src, dst);
  return dst;
}

async function call(win, fn, ...args) {
  try {
    return await win.evaluate(fn, ...args);
  } catch (e) {
    return { __evalError: String(e && e.message ? e.message : e) };
  }
}

// Rendering-side helpers passed as strings via evaluate's arg? evaluate takes a
// function; we call engine methods inside it.
async function loadDoc(win, docId, filePath, password) {
  return call(win, async ([id, p, pw]) => {
    const r = await window.tflex.engine.loadDocument(id, p, pw);
    if (!r.ok) return { ok: false, error: r.error, message: r.message };
    return { ok: true };
  }, [docId, filePath, password]);
}
async function getFields(win, docId) {
  return call(win, async (id) => {
    const r = await window.tflex.engine.getFormFields(id);
    if (!r.ok) return { ok: false, error: r.error, message: r.message };
    return { ok: true, fields: r.value };
  }, docId);
}
async function fill(win, docId, fieldId, value) {
  return call(win, async ([id, f, v]) => {
    const r = await window.tflex.engine.fillFormField(id, { id: f, value: v });
    if (!r.ok) return { ok: false, error: r.error, message: r.message };
    return { ok: true, modified: r.value.modified, report: r.value.formFillReport ?? null };
  }, [docId, fieldId, value]);
}
async function saveDoc(win, docId) {
  return call(win, async (id) => {
    const r = await window.tflex.engine.save(id);
    if (!r.ok) return { ok: false, error: r.error, message: r.message };
    return { ok: true, path: r.value };
  }, docId);
}
async function undoDoc(win, docId) {
  return call(win, async (id) => {
    const r = await window.tflex.engine.undo(id);
    if (!r.ok) return { ok: false, error: r.error, message: r.message };
    return { ok: true };
  }, docId);
}
async function applyOp(win, docId, op) {
  return call(win, async ([id, o]) => {
    const r = await window.tflex.engine.applyOp(id, o);
    if (!r.ok) return { ok: false, error: r.error, message: r.message };
    return { ok: true };
  }, [docId, op]);
}
async function getState(win, docId) {
  return call(win, async (id) => {
    const r = await window.tflex.engine.getState(id);
    if (!r.ok) return { ok: false, error: r.error, message: r.message };
    return { ok: true, pageCount: r.value.pageCount, modified: r.value.modified, report: r.value.formFillReport ?? null };
  }, docId);
}

// ---- independent output inspector (node-side @cantoo/pdf-lib) --------------
function pageIndexByRef(pdfDoc, ref) {
  if (!ref || typeof ref.tag !== 'string') return -1;
  for (let p = 0; p < pdfDoc.getPageCount(); p++) {
    if (pdfDoc.getPage(p).ref && pdfDoc.getPage(p).ref.tag === ref.tag) return p;
  }
  return -1;
}
function widgetOnValue(widget) {
  try {
    const on = widget.getOnValue && widget.getOnValue();
    if (on) return on.toString().replace(/^\//, '');
  } catch {}
  return '';
}
function inspect(filePath, password) {
  const bytes = fs.readFileSync(filePath);
  return PDFDocument.load(bytes, password ? { password } : undefined).then((doc) => {
    const form = doc.getForm();
    const fields = form.getFields();
    const out = fields.map((f) => {
      const widgets = (() => { try { return f.acroField.getWidgets(); } catch { return []; } })();
      let page = -1;
      for (const w of widgets) {
        try { page = pageIndexByRef(doc, w.dict.get(PDFName.of('P'))); } catch {}
        if (page >= 0) break;
      }
      const as = widgets.map((w) => { try { return w.dict.get(PDFName.of('AS'))?.toString() ?? null; } catch { return null; } });
      const onVals = widgets.map((w) => widgetOnValue(w));
      let value;
      try { value = f.constructor.name === 'PDFOptionList' ? f.getSelected() : f.constructor.name === 'PDFCheckBox' ? (f.acroField.getWidgets().length > 1 ? (f.acroField.V?.()?.toString() ?? '') : f.isChecked()) : f.getSelected ? f.getSelected() : f.getText(); } catch (e) { value = 'ERR:' + e.message; }
      return { name: f.getName(), cls: f.constructor.name, page, widgetCount: widgets.length, value, as, onVals };
    });
    const rawV = (() => {
      // raw AcroForm field count
      try {
        const af = doc.catalog.get(PDFName.of('AcroForm'));
        const dict = doc.context.lookupMaybe(af, undefined);
        const fieldsArr = dict && dict.get(PDFName.of('Fields'));
        const n = fieldsArr && fieldsArr.size ? fieldsArr.size() : 0;
        return n;
      } catch { return -1; }
    })();
    return {
      pageCount: doc.getPageCount(),
      fieldCount: fields.length,
      acroRoots: rawV,
      hasEncrypt: bytes.includes(Buffer.from('/Encrypt')),
      fields: out,
    };
  });
}

async function main() {
  const scenario = process.argv[2] || 'all';
  const only = (s) => scenario === 'all' || scenario === s;
  let app = null;
  const userData = path.join(TMP, 'userdata');
  fs.mkdirSync(userData, { recursive: true });
  app = await launchApp([], userData);
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  // Detect the engine bridge.
  const bridge = await call(win, () => ({ has: !!(window.tflex && window.tflex.engine), keys: window.tflex ? Object.keys(window.tflex).slice(0, 20) : [] }));
  log('bridge', JSON.stringify(bridge));

  const results = {};

  // ---- S1 multi-widget button group -------------------------------------
  if (only('s1')) {
    const p = copyFixture('multiwidget.pdf');
    await loadDoc(win, 's1', p);
    const fields = await getFields(win, 's1');
    log('s1 fields', JSON.stringify(fields));
    const f = fields.fields && fields.fields[0];
    const chosen = f && f.options && f.options[1] ? f.options[1].value : 'express';
    const fillr = f ? await fill(win, 's1', f.id, chosen) : { skipped: 'no field' };
    log('s1 chosen', chosen);
    log('s1 fill', JSON.stringify(fillr));
    const save = await saveDoc(win, 's1');
    log('s1 save', JSON.stringify(save));
    const insp = await inspect(p).catch((e) => ({ error: e.message }));
    log('s1 output', JSON.stringify(insp));
    results.s1 = { fields, fillr, save, insp };
  }

  // ---- S2 non-Latin value -----------------------------------------------
  if (only('s2')) {
    const p = copyFixture('nonlatin.pdf');
    await loadDoc(win, 's2', p);
    const fields = await getFields(win, 's2');
    const f = fields.fields && fields.fields[0];
    const fillr = await fill(win, 's2', f.id, 'Привет мир');
    const save = await saveDoc(win, 's2');
    const insp = await inspect(p).catch((e) => ({ error: e.message }));
    log('s2 fields', JSON.stringify(fields));
    log('s2 fill', JSON.stringify(fillr));
    log('s2 save', JSON.stringify(save));
    log('s2 output', JSON.stringify(insp));
    results.s2 = { fields, fillr, save, insp };
  }

  // ---- S3 read-only ------------------------------------------------------
  if (only('s3')) {
    const p = copyFixture('readonly.pdf');
    await loadDoc(win, 's3', p);
    const fields = await getFields(win, 's3');
    const f = fields.fields && fields.fields[0];
    const fillr = await fill(win, 's3', f.id, 'hacked');
    const save = await saveDoc(win, 's3');
    const insp = await inspect(p).catch((e) => ({ error: e.message }));
    log('s3', JSON.stringify({ fields, fillr, save, insp }));
    results.s3 = { fields, fillr, save, insp };
  }

  // ---- S4 signed document ------------------------------------------------
  if (only('s4')) {
    const p = copyFixture('signed.pdf');
    await loadDoc(win, 's4', p);
    const fields = await getFields(win, 's4');
    const body = fields.fields && fields.fields.find((x) => x.name === 'body');
    const sig = fields.fields && fields.fields.find((x) => x.name === 'approval');
    const fillr = body ? await fill(win, 's4', body.id, 'filled after signing') : { skipped: 'no body' };
    const sigFill = sig ? await fill(win, 's4', sig.id, 'pretend signature text') : { skipped: 'no sig' };
    const save = await saveDoc(win, 's4');
    const insp = await inspect(p).catch((e) => ({ error: e.message }));
    log('s4', JSON.stringify({ fields, fillr, save, insp }));
    results.s4 = { fields, fillr, save, insp };
  }

  // ---- S5 XFA-only -------------------------------------------------------
  if (only('s5')) {
    const p = copyFixture('xfa-only.pdf');
    const load = await loadDoc(win, 's5', p);
    const fields = await getFields(win, 's5');
    const save = await saveDoc(win, 's5');
    const insp = await inspect(p).catch((e) => ({ error: e.message }));
    log('s5', JSON.stringify({ load, fields, save, insp }));
    results.s5 = { load, fields, save, insp };
  }

  // ---- S6 flat -----------------------------------------------------------
  if (only('s6')) {
    const p = copyFixture('flat.pdf');
    await loadDoc(win, 's6', p);
    const fields = await getFields(win, 's6');
    const save = await saveDoc(win, 's6');
    const insp = await inspect(p).catch((e) => ({ error: e.message }));
    log('s6', JSON.stringify({ fields, save, insp }));
    results.s6 = { fields, save, insp };
  }

  // ---- S7 orphan widget --------------------------------------------------
  if (only('s7')) {
    const p = copyFixture('orphan.pdf');
    await loadDoc(win, 's7', p);
    const fields = await getFields(win, 's7');
    const orphan = fields.fields && fields.fields.find((x) => String(x.id).startsWith('orphan')) || (fields.fields && fields.fields.find((x) => x.name === 'ghost'));
    const fillr = orphan ? await fill(win, 's7', orphan.id, 'tried to fill orphan') : { skipped: 'no orphan row' };
    const state = await getState(win, 's7');
    const save = await saveDoc(win, 's7');
    const insp = await inspect(p).catch((e) => ({ error: e.message }));
    log('s7', JSON.stringify({ fields, fillr, state, save, insp }));
    results.s7 = { fields, fillr, state, save, insp };
  }

  // ---- S8 500 fields perf ------------------------------------------------
  if (only('s8')) {
    const p = copyFixture('manyfields.pdf');
    const t0 = Date.now();
    const load = await loadDoc(win, 's8', p);
    const tLoad = Date.now() - t0;
    const t1 = Date.now();
    const fields = await getFields(win, 's8');
    const tFields = Date.now() - t1;
    const f = fields.fields && fields.fields[7];
    const t2 = Date.now();
    const fillr = await fill(win, 's8', f.id, 'edited value');
    const tFill = Date.now() - t2;
    const t3 = Date.now();
    const save = await saveDoc(win, 's8');
    const tSave = Date.now() - t3;
    const insp = await inspect(p).catch((e) => ({ error: e.message }));
    log('s8', JSON.stringify({ load, tLoad, fieldCount: fields.fields ? fields.fields.length : -1, tFields, fillr: fillr.ok ? { ok: true } : fillr, tFill, save, tSave, insp: { pageCount: insp.pageCount, fieldCount: insp.fieldCount, acroRoots: insp.acroRoots }, sample: insp.fields && insp.fields.slice(7, 8) }));
    results.s8 = { tLoad, tFields, tFill, tSave, fieldCount: fields.fields && fields.fields.length, saveOk: save.ok, insp: { pageCount: insp.pageCount, fieldCount: insp.fieldCount, acroRoots: insp.acroRoots } };
  }

  // ---- S9 delete / rotate page with attached fields ----------------------
  if (only('s9')) {
    // delete page 1 (0-based 0) and rotate the remaining page that carries fields
    const p = copyFixture('paginated.pdf');
    await loadDoc(win, 's9', p);
    const before = await getFields(win, 's9');
    const del = await applyOp(win, 's9', { kind: 'delete', page: 0 });
    const rot = await applyOp(win, 's9', { kind: 'rotate-cw', page: 0 });
    const after = await getFields(win, 's9');
    // fill the field that was on original page 3 (now page 2 after delete)
    const f3 = after.fields && after.fields.find((x) => x.name === 'page3_field');
    const fillr = f3 ? await fill(win, 's9', f3.id, 'post-delete fill') : { skipped: 'no page3_field' };
    const save = await saveDoc(win, 's9');
    const insp = await inspect(p).catch((e) => ({ error: e.message }));
    log('s9', JSON.stringify({ before, del, rot, after, fillr, save, insp }));
    results.s9 = { before, del, rot, after, fillr, save, insp };
  }

  // ---- S10 pre-existing non-Latin value ----------------------------------
  if (only('s10')) {
    const p = copyFixture('preexisting-nonlatin.pdf');
    await loadDoc(win, 's10', p);
    const fields = await getFields(win, 's10');
    const save = await saveDoc(win, 's10');
    const insp = await inspect(p).catch((e) => ({ error: e.message }));
    log('s10', JSON.stringify({ fields, save, insp }));
    results.s10 = { fields, save, insp };
  }

  // ---- S11 save twice ----------------------------------------------------
  if (only('s11')) {
    const p = path.join(TMP, 'form-copy.pdf');
    fs.copyFileSync(path.join(REPO, 'test-fixtures', 'form.pdf'), p);
    await loadDoc(win, 's11', p);
    const fields0 = await getFields(win, 's11');
    const f = fields0.fields.find((x) => x.name === 'applicant_name');
    await fill(win, 's11', f.id, 'Alice');
    const s1 = await saveDoc(win, 's11');
    const insp1 = await inspect(p).catch((e) => ({ error: e.message }));
    const s2 = await saveDoc(win, 's11');
    const insp2 = await inspect(p).catch((e) => ({ error: e.message }));
    log('s11', JSON.stringify({ fields0Count: fields0.fields.length, s1, insp1, s2, insp2 }));
    results.s11 = { fields0Count: fields0.fields.length, s1, s2, f1: insp1.fieldCount, f2: insp2.fieldCount, fields1: insp1.fields, fields2: insp2.fields };
  }

  // ---- S12 fill then undo ------------------------------------------------
  if (only('s12')) {
    const p = path.join(TMP, 'form-copy2.pdf');
    fs.copyFileSync(path.join(REPO, 'test-fixtures', 'form.pdf'), p);
    await loadDoc(win, 's12', p);
    const fields0 = await getFields(win, 's12');
    const f = fields0.fields.find((x) => x.name === 'applicant_name');
    const origVal = f.value;
    const fillr = await fill(win, 's12', f.id, 'Bob');
    const afterFill = await getFields(win, 's12');
    const undo = await undoDoc(win, 's12');
    const afterUndo = await getFields(win, 's12');
    const save = await saveDoc(win, 's12');
    const insp = await inspect(p).catch((e) => ({ error: e.message }));
    const nameOut = insp.fields && insp.fields.find((x) => x.name === 'applicant_name');
    log('s12', JSON.stringify({ origVal, fillr, afterFillVal: afterFill.fields && afterFill.fields.find((x) => x.name === 'applicant_name').value, undo, afterUndoVal: afterUndo.fields && afterUndo.fields.find((x) => x.name === 'applicant_name').value, save, outVal: nameOut && nameOut.value }));
    results.s12 = { origVal, fillVal: afterFill.fields && afterFill.fields.find((x) => x.name === 'applicant_name').value, undoOk: undo.ok, afterUndoVal: afterUndo.fields && afterUndo.fields.find((x) => x.name === 'applicant_name').value, outVal: nameOut && nameOut.value };
  }

  // ---- S13 encrypted form ------------------------------------------------
  if (only('s13')) {
    const p = copyFixture('encrypted-form.pdf');
    const load = await loadDoc(win, 's13', p, 'open-sesame');
    const fields = await getFields(win, 's13');
    const f = fields.fields && fields.fields[0];
    const fillr = f ? await fill(win, 's13', f.id, 'filled-secret') : { skipped: 'no field' };
    const save = await saveDoc(win, 's13');
    const insp = await inspect(p).catch((e) => ({ error: e.message }));
    log('s13', JSON.stringify({ load, fields, fillr, save, insp }));
    results.s13 = { load, fields, fillr, save, insp };
  }

  // ---- S14 fill after merge ---------------------------------------------
  if (only('s14')) {
    const p = copyFixture('paginated.pdf');
    await loadDoc(win, 's14', p);
    const other = path.join(TMP, 'merge-src.pdf');
    fs.copyFileSync(path.join(REPO, 'test-fixtures', 'form.pdf'), other);
    const merge = await call(win, async ([id, o]) => {
      const r = await window.tflex.engine.merge(id, [o], 'after');
      return r.ok ? { ok: true } : { ok: false, error: r.error, message: r.message };
    }, ['s14', other]);
    const after = await getFields(win, 's14');
    const f3 = after.fields && after.fields.find((x) => x.name === 'page3_field');
    const fillr = f3 ? await fill(win, 's14', f3.id, 'post-merge fill') : { skipped: 'no page3_field' };
    const save = await saveDoc(win, 's14');
    const insp = await inspect(p).catch((e) => ({ error: e.message }));
    log('s14', JSON.stringify({ merge, afterCount: after.fields ? after.fields.length : -1, after: after.fields, fillr, save, insp }));
    results.s14 = { merge, afterCount: after.fields && after.fields.length, fillr, save, insp };
  }

  fs.writeFileSync(path.join(REPO, 'adv_p59_forms_results.json'), JSON.stringify(results, null, 2));
  log('DONE');
  await app.close().catch(() => {});
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
