// QA retest spec, 2026-09-18 - DEF-217 / DEF-219.
// Covers the parts the adversary harnesses do not surface: the UI-side size
// guard (DEF-217), the "nothing mutated" state after rejected API payloads
// (DEF-217/220 11th-watermark cap), the DEF-219 containment measurement at the
// new 10-row maximum with the required screenshot, and the single-flight
// delete double-click.
//
// Adversary harnesses already cover: adv041_tile 0.25/0.5/1, adv041_wm_api
// ranges, adv041_perf 10/100, adv041_layout. This spec is additive evidence.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { openSample, hardClose, runTool } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

test.describe.configure({ mode: 'serial' });

let electronApp = null;
let window = null;

test.beforeAll(async () => {
  electronApp = await launchApp([], null, null);
  window = await electronApp.firstWindow();
  await window.waitForSelector('.sample-card', { timeout: 40000 });
});

test.afterAll(async () => {
  await hardClose(electronApp, 'def217-219-retest');
});

async function setControl(selector, value) {
  await window.evaluate(([sel, v]) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`control missing: ${sel}`);
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    desc.set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [selector, String(value)]);
}

async function openWatermarkDialog() {
  // Phase 36 migration: All-tools palette retired; runTool opens Watermark's home.
  await runTool(window, 'watermark');
  await window.locator('[data-watermark-dialog]').waitFor({ state: 'visible', timeout: 10000 });
  await window.waitForTimeout(400);
}

async function closeWatermarkDialog() {
  const close = window.locator('[data-watermark-dialog] .modal-close');
  if (await close.count()) await close.first().click().catch(() => {});
  await window.locator('[data-watermark-dialog]').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  await window.waitForTimeout(300);
}

// ---------------------------------------------------------------------------
// DEF-217 UI half: Size 0.25 + Tile must be refused in-dialog, with no toast.
// ---------------------------------------------------------------------------
test('DEF-217 UI: tile + size 0.25 shows the in-dialog size error, no engine toast', async () => {
  test.setTimeout(120000);
  await openSample(window, electronApp, 'report.pdf');
  await window.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await window.waitForTimeout(800);
  await openWatermarkDialog();

  // Baseline: does the dialog overflow with ZERO applied rows (isolates the
  // DEF-219 applied-list contribution from the rest of the form)?
  const zero = await window.evaluate(() => {
    const bd = document.querySelector('[data-watermark-dialog]');
    const dlg = bd.querySelector('.modal-dialog');
    const body = bd.querySelector('.modal-body');
    const footer = bd.querySelector('.modal-footer');
    const rc = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) }; };
    return {
      rows: bd.querySelectorAll('[data-watermark-applied]').length,
      dialog: rc(dlg), body: rc(body), footer: rc(footer),
      dialogScroll: { sw: dlg.scrollWidth, cw: dlg.clientWidth },
      viewportH: window.innerHeight,
    };
  });
  console.log('DEF219_LAYOUT0 ' + JSON.stringify(zero));

  await window.locator('[data-watermark-text]').fill('X');
  const tile = window.locator('[data-watermark-tile]');
  if (!(await tile.isChecked())) await tile.check();
  await setControl('[data-watermark-size]', 0.25);

  // Best-effort engine-call spy (contextBridge may freeze the object).
  const spy = await window.evaluate(() => {
    window.__def217Calls = 0;
    const api = window.tflex && window.tflex.engine;
    if (!api || typeof api.addWatermark !== 'function') return 'no-api';
    const orig = api.addWatermark;
    try {
      api.addWatermark = function (...a) { window.__def217Calls += 1; return orig.apply(this, a); };
      return api.addWatermark === orig ? 'not-installed-frozen' : 'installed';
    } catch (e) { return 'throw:' + e.message; }
  });

  const wmBefore = await window.evaluate(() => {
    const id = window.tflexDiagnostics().engineDocId;
    return window.tflex.engine.getWatermarks(id);
  });
  const beforeCount = wmBefore.ok ? wmBefore.value.length : -1;

  await window.locator('[data-watermark-confirm]').click();
  await window.waitForTimeout(900);

  const errorText = await window.locator('[data-watermark-dialog] [role="alert"]').first().textContent().catch(() => null);
  const toasts = await window.evaluate(() => Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent || ''));
  const calls = await window.evaluate(() => window.__def217Calls);
  const wmAfter = await window.evaluate(() => {
    const id = window.tflexDiagnostics().engineDocId;
    return window.tflex.engine.getWatermarks(id);
  });
  const afterCount = wmAfter.ok ? wmAfter.value.length : -1;

  console.log('DEF217_UI ' + JSON.stringify({ spy, errorText, toasts, calls, beforeCount, afterCount }));

  expect(errorText || '', 'in-dialog size error').toContain('The watermark size must be between 4 and 2000 points.');
  expect(toasts.filter((t) => /watermark/i.test(t)), 'no watermark engine toast').toEqual([]);
  expect(afterCount, 'watermark count unchanged').toBe(beforeCount);
  if (spy === 'installed') expect(calls, 'engine.addWatermark not called').toBe(0);

  await closeWatermarkDialog();
});

// ---------------------------------------------------------------------------
// DEF-217 API half: rejected payloads leave the document unmodified.
// ---------------------------------------------------------------------------
test('DEF-217 API: tile at 0.25/0.5/1 pt errors and mutates nothing; 11th watermark is capped', async () => {
  test.setTimeout(120000);
  const formPath = getSamplePath('form.pdf').replace(/\\/g, '/');

  const res = await window.evaluate(async (src) => {
    const api = window.tflex.engine;
    const out = [];
    for (const size of [0.25, 0.5, 1]) {
      const id = 'def217-' + String(size).replace('.', '_');
      await api.loadDocument(id, src);
      const r = await api.addWatermark(id, { type: 'text', text: 'X', size, tile: true });
      const st = await api.getState(id);
      const g = await api.getWatermarks(id);
      out.push({
        size,
        ok: r.ok, code: r.ok ? null : r.error.code, msg: r.ok ? null : r.error.message,
        modified: st.ok ? st.value.modified : 'state-err',
        wmCount: g.ok ? g.value.length : 'list-err',
      });
    }
    // 11th-watermark document cap.
    const idc = 'def217-cap';
    await api.loadDocument(idc, src);
    const oks = [];
    for (let i = 0; i < 10; i++) oks.push((await api.addWatermark(idc, { type: 'text', text: 'C' + i, size: 24 })).ok);
    const eleventh = await api.addWatermark(idc, { type: 'text', text: 'C10', size: 24 });
    const stc = await api.getState(idc);
    const gc = await api.getWatermarks(idc);
    return {
      cases: out,
      first10: oks,
      eleventh: { ok: eleventh.ok, code: eleventh.ok ? null : eleventh.error.code, msg: eleventh.ok ? null : eleventh.error.message },
      capModified: stc.ok ? stc.value.modified : 'state-err',
      capCount: gc.ok ? gc.value.length : 'list-err',
    };
  }, formPath);

  console.log('DEF217_API ' + JSON.stringify(res));

  for (const c of res.cases) {
    expect(c.ok, `size ${c.size} rejected`).toBe(false);
    expect(c.code, `size ${c.size} typed engine-error`).toBe('engine-error');
    // <1 pt -> settings invalid; size 1 + tile -> 5000-placement cap.
    expect(
      c.msg || '',
      `size ${c.size} typed limit message`,
    ).toMatch(/addWatermark: (settings are invalid|tiling at this size would place more than 5000 copies)/);
    expect(c.modified, `size ${c.size} unmodified`).toBe(false);
    expect(c.wmCount, `size ${c.size} no watermark`).toBe(0);
  }
  expect(res.first10.every(Boolean), 'first 10 valid watermarks accepted').toBe(true);
  expect(res.eleventh.ok, '11th rejected').toBe(false);
  expect(res.eleventh.code).toBe('engine-error');
  expect(res.eleventh.msg || '').toContain('already has 10 watermarks (maximum)');
  expect(res.capCount, 'cap leaves exactly 10').toBe(10);
});

// ---------------------------------------------------------------------------
// DEF-219 delete double-click: single-flight, no spurious not-found toast.
// Runs BEFORE the (expected-to-fail) layout assertions so serial mode does not
// skip it.
// ---------------------------------------------------------------------------
test('DEF-219 delete: same-tick double click removes exactly one row, no not-found toast', async () => {
  test.setTimeout(120000);
  const applied = await window.evaluate(async () => {
    const api = window.tflex.engine;
    const id = window.tflexDiagnostics().engineDocId;
    const g0 = await api.getWatermarks(id);
    let have = g0.ok ? g0.value.length : 0;
    for (let i = have; i < 10; i++) await api.addWatermark(id, { type: 'text', text: 'D' + i, size: 24 });
    const g = await api.getWatermarks(id);
    return g.ok ? g.value.length : -1;
  });
  expect(applied, '10 watermarks applied to the open doc').toBe(10);
  await closeWatermarkDialog();
  await openWatermarkDialog();

  const before = await window.evaluate(() => Array.from(document.querySelectorAll('[data-watermark-applied]')).map((r) => r.getAttribute('data-watermark-applied')));
  expect(before.length).toBe(10);
  const target = before[0];

  const clicked = await window.evaluate((id) => {
    const btn = document.querySelector(`[data-watermark-delete="${id}"]`);
    if (!btn) return { error: 'no-button' };
    btn.click();
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return { done: true };
  }, target);

  await window.waitForTimeout(1800);
  const after = await window.evaluate(() => Array.from(document.querySelectorAll('[data-watermark-applied]')).map((r) => r.getAttribute('data-watermark-applied')));
  const toasts = await window.evaluate(() => Array.from(document.querySelectorAll('.toast')).map((t) => t.textContent || ''));
  const engineCount = await window.evaluate(async () => {
    const id = window.tflexDiagnostics().engineDocId;
    const g = await window.tflex.engine.getWatermarks(id);
    return g.ok ? g.value.length : -1;
  });
  const responsive = await window.evaluate(() => 2 + 2);

  console.log('DEF219_DELETE ' + JSON.stringify({ target, clicked, before: before.length, after: after.length, toasts, engineCount, responsive }));

  expect(clicked.done).toBe(true);
  expect(after.length, 'exactly one row removed').toBe(9);
  expect(after.includes(target), 'target row gone').toBe(false);
  expect(toasts.filter((t) => /no watermark with id/i.test(t)), 'no not-found toast').toEqual([]);
  expect(engineCount, 'engine has one fewer watermark').toBe(9);
  expect(responsive).toBe(4);
});

// ---------------------------------------------------------------------------
// DEF-219 layout at the new 10-row maximum + required screenshot.
// ---------------------------------------------------------------------------
test('DEF-219 layout: 10 rows contained in the dialog, footer in viewport, list scrolls internally', async () => {
  test.setTimeout(120000);
  const applied = await window.evaluate(async () => {
    const api = window.tflex.engine;
    const id = window.tflexDiagnostics().engineDocId;
    const g0 = await api.getWatermarks(id);
    let have = g0.ok ? g0.value.length : 0;
    for (let i = have; i < 10; i++) await api.addWatermark(id, { type: 'text', text: 'L' + i, size: 24 });
    const g = await api.getWatermarks(id);
    return g.ok ? g.value.length : -1;
  });
  expect(applied, '10 watermarks applied to the open doc').toBe(10);

  await closeWatermarkDialog();
  await openWatermarkDialog();
  const m = await window.evaluate(() => {
    const bd = document.querySelector('[data-watermark-dialog]');
    const dialog = bd && bd.querySelector('.modal-dialog');
    const body = bd && bd.querySelector('.modal-body');
    const footer = bd && bd.querySelector('.modal-footer');
    const list = bd && bd.querySelector('.watermark-applied-list');
    const r = (el) => (el ? (() => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) }; })() : null);
    let widest = null;
    if (body) {
      for (const el of body.querySelectorAll('*')) {
        const w = Math.round(el.getBoundingClientRect().width);
        if (!widest || w > widest.w) widest = { tag: el.tagName, cls: String(el.className || '').slice(0, 70), w };
      }
    }
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      dialog: r(dialog), body: r(body), footer: r(footer), list: r(list),
      dialogScroll: dialog ? { sw: dialog.scrollWidth, cw: dialog.clientWidth } : null,
      bodyScroll: body ? { sw: body.scrollWidth, cw: body.clientWidth } : null,
      listScroll: list ? { sh: list.scrollHeight, ch: list.clientHeight, oy: getComputedStyle(list).overflowY } : null,
      rows: bd ? bd.querySelectorAll('[data-watermark-applied]').length : -1,
      widest,
      doc: { sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight, scrollY: window.scrollY },
    };
  });
  console.log('DEF219_LAYOUT ' + JSON.stringify(m));

  await window.screenshot({ path: path.join(SHOTS, 'def-219-retest.png') });
  console.log('DEF219 screenshot: screenshots/def-219-retest.png');

  expect(m.rows).toBe(10);
  expect(m.dialogScroll.sw, 'dialog scrollWidth <= clientWidth (no horizontal overflow)').toBeLessThanOrEqual(m.dialogScroll.cw);
  expect(m.bodyScroll.sw, 'body scrollWidth <= clientWidth').toBeLessThanOrEqual(m.bodyScroll.cw);
  expect(m.footer, 'footer present').not.toBeNull();
  expect(m.footer.bottom, 'footer bottom inside viewport').toBeLessThanOrEqual(m.viewport.h);
  expect(m.footer.y, 'footer top inside viewport').toBeGreaterThanOrEqual(0);
  expect(m.doc.sh, 'page not vertically scrolled').toBeLessThanOrEqual(m.doc.ch + 1);
  expect(m.listScroll.sh, 'list scrolls internally (content taller than box)').toBeGreaterThan(m.listScroll.ch);
  expect(['auto', 'scroll'], 'list overflowY').toContain(m.listScroll.oy);
});

// ---------------------------------------------------------------------------
// DEF-219 independent containment: own measurement at 0 rows and at the 10-row
// maximum, incl. elementFromPoint hit-test of Apply and Cancel. The footer must
// be reachable without scrolling the page (footer.bottom <= innerHeight).
// ---------------------------------------------------------------------------
test('DEF-219 independent: overflow, footer-in-viewport, Apply/Cancel hit-test at 0 and 10 rows', async () => {
  test.setTimeout(120000);

  const measure = async () => window.evaluate(() => {
    const bd = document.querySelector('[data-watermark-dialog]');
    const dialog = bd.querySelector('.modal-dialog');
    const footer = bd.querySelector('.modal-footer');
    const list = bd.querySelector('.watermark-applied-list');
    const apply = bd.querySelector('[data-watermark-confirm]');
    const cancel = bd.querySelector('.modal-footer .btn-secondary');
    const hit = (el) => {
      if (!el) return { present: false };
      const b = el.getBoundingClientRect();
      const x = Math.round(b.x + b.width / 2);
      const y = Math.round(b.y + b.height / 2);
      const inViewport = x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight;
      const top = inViewport ? document.elementFromPoint(x, y) : null;
      return {
        present: true, x, y, inViewport,
        hitTag: top ? top.tagName + '.' + String(top.className || '').slice(0, 24) : null,
        ok: !!top && (top === el || el.contains(top) || top.contains(el)),
      };
    };
    const fb = footer.getBoundingClientRect();
    return {
      rows: bd.querySelectorAll('[data-watermark-applied]').length,
      dialog: { sw: dialog.scrollWidth, cw: dialog.clientWidth },
      footer: { y: Math.round(fb.y), bottom: Math.round(fb.bottom) },
      apply: hit(apply), cancel: hit(cancel),
      list: list ? { sh: list.scrollHeight, ch: list.clientHeight, oy: getComputedStyle(list).overflowY } : null,
      viewportH: window.innerHeight,
    };
  });

  const assertContained = (m, label) => {
    expect(m.dialog.sw, `${label}: dialog scrollWidth <= clientWidth + 1`).toBeLessThanOrEqual(m.dialog.cw + 1);
    expect(m.footer.bottom, `${label}: footer bottom inside viewport`).toBeLessThanOrEqual(m.viewportH);
    expect(m.apply.ok, `${label}: Apply elementFromPoint-hittable`).toBe(true);
    expect(m.cancel.ok, `${label}: Cancel elementFromPoint-hittable`).toBe(true);
  };

  // 10-row maximum (left applied by the previous serial test; reopen for a fresh measure).
  await closeWatermarkDialog();
  await openWatermarkDialog();
  const ten = await measure();
  console.log('DEF219_INDEP_10 ' + JSON.stringify(ten));
  expect(ten.rows).toBe(10);
  assertContained(ten, '10-row');
  expect(ten.list, '10-row: applied list present').not.toBeNull();
  expect(ten.list.sh, '10-row: list scrollHeight > clientHeight').toBeGreaterThan(ten.list.ch);
  expect(['auto', 'scroll'], '10-row: list overflow-y').toContain(ten.list.oy);

  // 0 applied rows: delete all via the engine, reopen.
  await window.evaluate(async () => {
    const api = window.tflex.engine;
    const id = window.tflexDiagnostics().engineDocId;
    const g = await api.getWatermarks(id);
    for (const w of (g.ok ? g.value : [])) await api.deleteWatermark(id, w.id);
  });
  await closeWatermarkDialog();
  await openWatermarkDialog();
  const zero = await measure();
  console.log('DEF219_INDEP_0 ' + JSON.stringify(zero));
  expect(zero.rows).toBe(0);
  assertContained(zero, '0-row');
});