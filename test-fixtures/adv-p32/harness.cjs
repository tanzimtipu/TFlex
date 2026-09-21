// ADV P32 shared harness. Standalone node (NOT a Playwright spec).
// All launches go through the canonical e2e/lib/launch.cjs.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..', '..');
const { launchApp } = require(path.join(ROOT, 'e2e', 'lib', 'launch.cjs'));
const { hardClose } = require(path.join(ROOT, 'e2e', 'lib', 'helpers.cjs'));

const FIX = path.join(ROOT, 'test-fixtures');
const TMP = path.join(os.tmpdir(), 'tflex-adv-p32');
const SHOTS = path.join(ROOT, 'screenshots');

function tmpCopy(src, name) {
  fs.mkdirSync(TMP, { recursive: true });
  const dst = path.join(TMP, `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  fs.copyFileSync(src, dst);
  return dst;
}

async function launch() {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
  return { app, win };
}

async function mockOpen(app, p) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
}

async function openFile(app, win, p) {
  await mockOpen(app, p);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(900);
}

async function tabCount(win) {
  return win.locator('.tab[data-tab-id]').count();
}

async function waitTabs(win, n, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if ((await tabCount(win)) >= n) return true;
    await win.waitForTimeout(100);
  }
  return false;
}

function headerLoc(win, pane) {
  return win.locator(`.tab-pane[data-pane="${pane}"] [data-pane-header]`);
}

async function paneInfo(win, pane) {
  const raw = await headerLoc(win, pane).innerText().catch(() => '');
  const text = raw.replace(/\s+/g, ' ').trim();
  const m = text.match(/(\d+)\s+pages?/);
  return { text, pageCount: m ? Number(m[1]) : null };
}

async function railInfo(win) {
  const sections = win.locator('[data-multi-rail] [data-rail-section]');
  const n = await sections.count();
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const s = sections.nth(i);
    const header = (await s.locator('[data-rail-section-header]').innerText()).replace(/\s+/g, ' ').trim();
    out.push({
      pane: await s.getAttribute('data-rail-section-pane'),
      doc: await s.getAttribute('data-rail-section-doc'),
      active: await s.getAttribute('data-rail-section-active'),
      header,
      thumbItems: await s.locator('.thumb-item').count(),
    });
  }
  return out;
}

// Two DIFFERENT documents, alpha in A, beta in B. Amended semantics:
// open both in single mode first, activate alpha, then enable the mode and
// pick beta into B.
async function twoPane(win, app, { alphaName = 'alpha', betaName = 'beta', betaSrc = 'long.pdf', alphaSrc = 'report.pdf' } = {}) {
  const alphaPath = tmpCopy(path.join(FIX, alphaSrc), `p32-${alphaName}.pdf`);
  const betaPath = tmpCopy(path.join(FIX, betaSrc), `p32-${betaName}.pdf`);
  await openFile(app, win, alphaPath);
  await waitTabs(win, 1);
  await openFile(app, win, betaPath);
  await waitTabs(win, 2);
  await win.locator('.tab[data-tab-id]').filter({ hasText: `p32-${alphaName}` }).first().click();
  await win.waitForTimeout(300);
  await win.locator('[data-toolbar-multi-mode]').first().click();
  await win.waitForTimeout(400);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: `p32-${betaName}` }).first().click();
  await win.waitForTimeout(1400);
  return { alphaPath, betaPath };
}

async function setFocused(win, pane) {
  await win.locator(`.multi-pane-header[data-pane="${pane}"]`).click();
  await win.waitForTimeout(350);
}

async function focusedPane(win) {
  const a = await win.locator('.tab-pane[data-pane="A"]').getAttribute('data-pane-focused').catch(() => null);
  const b = await win.locator('.tab-pane[data-pane="B"]').getAttribute('data-pane-focused').catch(() => null);
  return a === 'true' ? 'A' : b === 'true' ? 'B' : null;
}

async function shot(win, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p });
  return p;
}

async function close(app, label) {
  try { await hardClose(app, label || 'adv-p32'); } catch (e) { console.log('hardClose error:', e.message); }
}

// ---- drag helpers (mirrors qa's phase32_drag_drop spec) ---------------------
async function synthStep(win, step, arg) {
  return win.evaluate(({ step: s, arg: a }) => {
    const KEY = '__advp32dt';
    if (s === 'start') {
      const src = document.querySelector(a.src);
      if (!src) return { ok: false, reason: 'no-src' };
      const dt = new DataTransfer();
      window[KEY] = dt;
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return { ok: true };
    }
    const dt = window[KEY];
    if (!dt) return { ok: false, reason: 'no-dt' };
    if (s === 'over' || s === 'drop') {
      const tgt = document.querySelector(a.tgt);
      if (!tgt) return { ok: false, reason: 'no-tgt' };
      const r = tgt.getBoundingClientRect();
      const clientX = r.left + r.width / 2;
      const clientY = a.after ? r.top + r.height * 0.75 : r.top + r.height * 0.25;
      const ev = new DragEvent(s === 'over' ? 'dragover' : 'drop', {
        bubbles: true, cancelable: true, dataTransfer: dt,
        clientX, clientY, ctrlKey: !!a.ctrl, altKey: !!a.alt,
      });
      tgt.dispatchEvent(ev);
      const ind = document.querySelector('[data-drop-indicator]');
      return {
        ok: true,
        defaultPrevented: ev.defaultPrevented,
        indicator: ind ? ind.getAttribute('data-drop-indicator') : null,
        indicatorPage: ind ? ind.getAttribute('data-drop-page') : null,
        copy: ind ? ind.getAttribute('data-drop-copy') : null,
        dropPane: !!document.querySelector('.document-scroller[data-page-drop-pane="true"]'),
      };
    }
    if (s === 'end') {
      const src = document.querySelector(a.src);
      if (src) src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
      delete window[KEY];
      return { ok: true };
    }
    return { ok: false, reason: 'bad-step' };
  }, { step, arg });
}

async function synthDrag(win, srcSel, tgtSel, { ctrl = false, after = false, alt = false } = {}) {
  const started = await synthStep(win, 'start', { src: srcSel });
  if (!started.ok) return started;
  await win.waitForTimeout(120);
  const over = await synthStep(win, 'over', { tgt: tgtSel, ctrl, after, alt });
  await win.waitForTimeout(120);
  const drop = await synthStep(win, 'drop', { tgt: tgtSel, ctrl, after, alt });
  await win.waitForTimeout(1600);
  return { ...drop, over };
}

async function nativeDrag(win, srcSel, tgtSel, ctrl, targetPosition) {
  if (ctrl) await win.keyboard.down('Control');
  let ok = false, error = null;
  try {
    await win.locator(srcSel).first().dragTo(win.locator(tgtSel).first(), targetPosition ? { targetPosition, timeout: 8000 } : { timeout: 8000 });
    ok = true;
  } catch (e) { error = e.message; }
  if (ctrl) await win.keyboard.up('Control');
  return { ok, error };
}

// Cross-document rail drag: native first, synthetic DataTransfer fallback.
// Returns the method used.
async function railCrossDrag(win, fromPane, fromPage, toPane, toPage, { ctrl = false } = {}) {
  const srcSel = `[data-rail-section-pane="${fromPane}"] .thumb-item[data-page="${fromPage}"]`;
  const tgtSel = `[data-rail-section-pane="${toPane}"] .thumb-item[data-page="${toPage}"]`;
  await win.locator(srcSel).first().scrollIntoViewIfNeeded().catch(() => {});
  await win.locator(tgtSel).first().scrollIntoViewIfNeeded().catch(() => {});
  const before = { a: (await paneInfo(win, 'A')).pageCount, b: (await paneInfo(win, 'B')).pageCount };
  const native = await nativeDrag(win, srcSel, tgtSel, ctrl);
  await win.waitForTimeout(2200);
  let after = { a: (await paneInfo(win, 'A')).pageCount, b: (await paneInfo(win, 'B')).pageCount };
  if (after.a === before.a && after.b === before.b) {
    const s = await synthDrag(win, srcSel, tgtSel, { ctrl });
    after = { a: (await paneInfo(win, 'A')).pageCount, b: (await paneInfo(win, 'B')).pageCount };
    return { method: 'synth', before, after, synth: s, native };
  }
  return { method: 'native', before, after, native };
}

async function undo(win) {
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(1400);
}

// The engine doc id of the tab currently shown in `pane` (focus it first so
// diagnostics reports that tab), plus a raw getState for a doc id.
async function docIdOfPane(win, pane) {
  await setFocused(win, pane);
  const d = await win.evaluate(() => window.tflexDiagnostics());
  return d.engineDocId;
}
async function engineStateOf(win, docId) {
  return win.evaluate(async (id) => {
    const r = await window.tflex.engine.getState(id);
    return r && r.ok ? r.value : { error: r && r.error };
  }, docId);
}

async function redo(win) {
  await win.keyboard.press('Control+Shift+z');
  await win.waitForTimeout(1400);
}

// Full observable snapshot: both headers, rail counts, tabs.
async function snapshot(win, label) {
  const a = await paneInfo(win, 'A');
  const b = await paneInfo(win, 'B');
  const rail = await railInfo(win);
  const diag = await win.evaluate(() => window.tflexDiagnostics());
  const out = {
    label,
    A: a.pageCount, B: b.pageCount,
    railA: rail.find((s) => s.pane === 'A') ? rail.find((s) => s.pane === 'A').thumbItems : null,
    railB: rail.find((s) => s.pane === 'B') ? rail.find((s) => s.pane === 'B').thumbItems : null,
    railOrder: rail.map((s) => s.pane),
    focused: (await focusedPane(win)),
    active: diag.currentPage,
    activePageCount: diag.pageCount,
    tabs: await tabCount(win),
  };
  console.log('SNAP', JSON.stringify(out));
  return out;
}

// Minimal assert/log so a failed probe exits non-zero but never hangs.
function check(label, cond, detail) {
  const tag = cond ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${label}${detail !== undefined ? ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
  return cond;
}

async function run(fn) {
  try {
    await fn();
    process.exit(0);
  } catch (e) {
    console.error('FATAL', e && e.stack ? e.stack : e);
    process.exit(1);
  }
}

module.exports = {
  ROOT, FIX, TMP, SHOTS,
  launch, openFile, mockOpen, tmpCopy, tabCount, waitTabs,
  headerLoc, paneInfo, railInfo, twoPane, setFocused, focusedPane, shot, close, check, run,
  launchApp,
  synthStep, synthDrag, nativeDrag, railCrossDrag, undo, redo, snapshot,
  docIdOfPane, engineStateOf,
};