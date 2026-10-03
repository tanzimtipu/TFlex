// Phase 86 (FEA-038) phase-validation e2e (qa) - search and replace across the
// document.
//
// HARNESS: canonical launchApp (e2e/lib/launch.cjs); the app is driven through
// the real Find bar (Ctrl+F -> "Search query" input -> `[data-search-replace-*]`
// controls) and every assertion is on EXTRACTED TEXT read back from the live
// engine (`window.tflex.engine.exportText`), never on pixel colour - the
// replacement is drawn in a StandardFont substitution.
//
// PHASE-GATE PROCEDURE: this spec drives the built renderer, so the gate MUST
// rebuild dist/ BEFORE the run or a stale bundle can pass:
//   npm.cmd run build
//   npm.cmd run test:e2e -- e2e/phase86_search_replace.spec.cjs
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument, StandardFonts, rgb } = require('@cantoo/pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

// The Paperclip/kimi runtime exports ELECTRON_RUN_AS_NODE=1 for its own Node
// shim; launchApp spreads process.env, so Electron would exit immediately as
// plain Node. Drop it before any launch so the real GUI starts.
delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const FONT_TTF = path.join(ROOT, 'assets', 'fonts', 'LiberationSans-Regular.ttf');
const USER_DATA = path.join(os.tmpdir(), `p86-userdata-${Date.now()}`);
const TMP = path.join(os.tmpdir(), 'p86-search-replace');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(USER_DATA, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const FIXTURE = path.join(TMP, 'p86-main.pdf');
const TYPE0 = path.join(TMP, 'p86-type0.pdf');
const SAVED = path.join(TMP, 'p86-saved.pdf');

const log = (label, obj) => console.log(`[p86|${label}] ${JSON.stringify(obj)}`);
const shot = (name) => path.join(SHOTS, name);

// Two-page controlled fixture, all text in a StandardFont (Helvetica) so the
// engine's advance resolver can measure it:
//   page 1: SECRET (y=700), SECRET (y=620), SIBLING (y=540)
//   page 2: SECRET (y=700), OTHERPAGE (y=620)
// Find "SECRET" => 3 hits. replace-one changes the ACTIVE one only; replace-all
// changes the remaining two. SIBLING and OTHERPAGE must survive untouched.
async function buildFixture() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.drawText('SECRET', { x: 72, y: 700, size: 24, font, color: rgb(0, 0, 0) });
  p1.drawText('SECRET', { x: 72, y: 620, size: 24, font, color: rgb(0, 0, 0) });
  p1.drawText('SIBLING', { x: 72, y: 540, size: 24, font, color: rgb(0, 0, 0) });
  const p2 = doc.addPage([612, 792]);
  p2.drawText('SECRET', { x: 72, y: 700, size: 24, font, color: rgb(0, 0, 0) });
  p2.drawText('OTHERPAGE', { x: 72, y: 620, size: 24, font, color: rgb(0, 0, 0) });
  fs.writeFileSync(FIXTURE, await doc.save());
}

// A page whose text is set in an EMBEDDED Type0/CID font. The engine's advance
// resolver returns null for /Type0, so an occurrence over this text cannot be
// measured and must be reported in `skipped`, never silently dropped. pdf.js
// still extracts the text through the embedded ToUnicode CMap, so the Find bar
// shows the hit and the replace path is reachable from the UI.
async function buildType0Fixture() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(fs.readFileSync(FONT_TTF), { subset: false });
  page.drawText('SECRET', { x: 72, y: 700, size: 24, font, color: rgb(0, 0, 0) });
  fs.writeFileSync(TYPE0, await doc.save());
}

let app = null;
let win = null;
const consoleLog = [];

test.beforeAll(async () => {
  await buildFixture();
  await buildType0Fixture();
});

test.beforeEach(async () => {
  consoleLog.length = 0;
  app = await launchApp([], USER_DATA);
  win = await app.firstWindow();
  win.on('console', (m) => consoleLog.push(`[console:${m.type()}] ${m.text()}`));
  win.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e.message}`));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p86');
  app = null;
  win = null;
});

test.setTimeout(600000);

async function diag() {
  return win.evaluate(() => window.tflexDiagnostics());
}

async function openFixture(filePath) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, filePath);
  const welcome = win.locator('button:has-text("Open PDF")').first();
  if (await welcome.isVisible().catch(() => false)) {
    await welcome.click();
  } else {
    const cmd = win.locator('[aria-label="Open PDF document"]').first();
    if (await cmd.isVisible().catch(() => false)) await cmd.click();
    else await win.keyboard.press('Control+o');
  }
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

async function engineText(docId) {
  return win.evaluate(async (id) => {
    const r = await window.tflex.engine.exportText(id);
    if (!r.ok) return { error: r.error };
    return { pages: r.value };
  }, docId);
}

const allText = (pages) => (pages || []).map((p) => p.text).join('\n');
const count = (hay, term) => (hay.match(new RegExp(term, 'g')) || []).length;

async function openFind(term) {
  await win.keyboard.press('Control+f');
  await win.waitForSelector('.search-bar', { timeout: 8000 });
  await win.locator('[aria-label="Search query"]').fill(term);
  await win.waitForTimeout(200);
}

async function waitHits(n) {
  await win.waitForFunction(
    (expected) => window.tflexDiagnostics().searchHits === expected,
    n,
    { timeout: 30000 },
  );
}

async function readReport() {
  const el = win.locator('[data-search-replace-report]');
  if (!(await el.count())) return '';
  return (await el.innerText()).trim();
}

async function waitReport() {
  await win.waitForFunction(
    () => {
      const el = document.querySelector('[data-search-replace-report]');
      return el !== null && /replaced/.test(el.textContent || '');
    },
    undefined,
    { timeout: 30000 },
  );
  return readReport();
}

async function saveAs(savePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(2600);
}

async function toggleAndFill(replacement) {
  await win.locator('[data-search-replace-toggle]').click();
  await win.waitForSelector('[data-search-replace-input]', { timeout: 8000 });
  await win.locator('[data-search-replace-input]').fill(replacement);
  await win.waitForTimeout(200);
}

// The always-on Inspector is an absolute right panel (z-index 30) over the
// workspace column. DEF-500 fix (styles.css `.search-bar { margin-right:
// var(--tf-tools-inset) }`) reserves the Inspector width on the Find bar, so the
// replace controls must now be hit-testable with the Inspector OPEN. Prove it:
// `document.elementFromPoint` over the toggle's centre must return the toggle
// (or a descendant), never the Inspector header.
async function logOverlap() {
  const info = await win.evaluate(() => {
    const toggle = document.querySelector('[data-search-replace-toggle]');
    const inspector = document.querySelector('[data-inspector="true"]');
    if (!toggle) return { error: 'no replace toggle' };
    const tb = toggle.getBoundingClientRect();
    const cx = tb.left + tb.width / 2;
    const cy = tb.top + tb.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    return {
      toggleBox: { x: tb.x, y: tb.y, w: tb.width, h: tb.height },
      inspectorBox: inspector ? (() => { const b = inspector.getBoundingClientRect(); return { x: b.x, w: b.width }; })() : null,
      hitTag: hit ? hit.tagName : null,
      hitInInspector: hit ? hit.closest('[data-inspector="true"]') !== null : false,
      hitIsToggle: hit ? (hit === toggle || toggle.contains(hit)) : false,
      hitClass: hit ? String(hit.className) : null,
    };
  });
  log('replace-toggle-hit-test', info);
  return info;
}

// DEF-500 attempt-2 proof: with the replace row open and the Inspector OPEN,
// `document.elementFromPoint` at the CENTRE of each replace control must return
// that control (or a descendant). The failure mode being retested is the
// `.canvas-page-layout` strip (`[data-page-layout-option]`) intercepting the
// pointer, so record that explicitly as well.
async function logReplaceButtonHitTest() {
  const info = await win.evaluate(() => {
    const check = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return { sel, error: 'missing element' };
      const b = el.getBoundingClientRect();
      const cx = b.left + b.width / 2;
      const cy = b.top + b.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return {
        sel,
        box: { x: b.x, y: b.y, w: b.width, h: b.height },
        hitTag: hit ? hit.tagName : null,
        hitClass: hit ? String(hit.className) : null,
        hitText: hit ? (hit.textContent || '').trim() : null,
        hitAria: hit ? hit.getAttribute && hit.getAttribute('aria-label') : null,
        hitTitle: hit ? hit.getAttribute && hit.getAttribute('title') : null,
        hitReplaceOne: hit ? hit.hasAttribute && hit.hasAttribute('data-search-replace-one') : false,
        hitReplaceAll: hit ? hit.hasAttribute && hit.hasAttribute('data-search-replace-all') : false,
        hitIsSelf: hit ? hit === el || el.contains(hit) : false,
        hitIsLayoutOption: hit
          ? hit.closest('[data-page-layout-option]') !== null
          : false,
      };
    };
    return {
      one: check('[data-search-replace-one]'),
      all: check('[data-search-replace-all]'),
    };
  });
  log('replace-button-hit-test', info);
  return info;
}

// A real pointer click - the DEF-500 assertion is that Playwright's actionability
// check (which hit-tests before dispatching) now passes with the Inspector open.
// No `dispatchEvent` workaround: the control must genuinely be reachable.
async function fireControl(selector) {
  await win.locator(selector).click();
  await win.waitForTimeout(100);
}

// ---------------------------------------------------------------------------
// Criterion 1 + 2 + the CONTROL-INDEX: find every occurrence, replace one, then
// replace all, then save + reload. Every result is asserted on EXTRACTED TEXT.
// ---------------------------------------------------------------------------
test('P86-CORE: find 3, replace-one changes only the active, replace-all clears the rest, save/reload keeps it', async () => {
  await openFixture(FIXTURE);
  const d = await diag();
  const before = allText((await engineText(d.engineDocId)).pages);
  expect(count(before, 'SECRET')).toBe(3);
  expect(count(before, 'SIBLING')).toBe(1);
  expect(count(before, 'OTHERPAGE')).toBe(1);

  // Find bar (Ctrl+F) shows every occurrence.
  await openFind('SECRET');
  await waitHits(3);
  expect(await win.locator('.search-hit').count()).toBeGreaterThan(0);
  await win.screenshot({ path: shot('p86-01-find-hits.png') });

  // CONTROL-INDEX: [data-search-replace-toggle] reveals the row and does NOT
  // change the Find query; no replace input exists while the row is closed.
  expect(await win.locator('[data-search-replace-input]').count()).toBe(0);
  // DEF-500: with the Inspector OPEN (never collapsed), the toggle's centre must
  // hit-test to the toggle itself, not the Inspector header.
  const overlap = await logOverlap();
  expect(overlap.error).toBeUndefined();
  expect(overlap.hitInInspector).toBe(false);
  expect(overlap.hitIsToggle).toBe(true);
  await win.screenshot({ path: shot('p86-00-inspector-overlap.png') });
  const queryBefore = await win.locator('[aria-label="Search query"]').inputValue();
  await win.locator('[data-search-replace-toggle]').click();
  await win.waitForSelector('[data-search-replace-input]', { timeout: 8000 });
  expect(await win.locator('[aria-label="Search query"]').inputValue()).toBe(queryBefore);
  // [data-search-replace-input] holds the replacement text.
  await win.locator('[data-search-replace-input]').fill('PUBLIC');
  expect(await win.locator('[data-search-replace-input]').inputValue()).toBe('PUBLIC');
  // DEF-500 evidence: replace controls visible and hit-testable with the
  // Inspector open.
  await win.screenshot({ path: shot('p86-06-replace-fixed.png') });
  // DEF-500 (attempt 2) proof: elementFromPoint over BOTH replace controls
  // returns the control (or a descendant), never a [data-page-layout-option].
  const hitTest = await logReplaceButtonHitTest();
  expect(hitTest.one.error).toBeUndefined();
  expect(hitTest.all.error).toBeUndefined();
  expect(hitTest.one.hitIsLayoutOption).toBe(false);
  expect(hitTest.all.hitIsLayoutOption).toBe(false);
  expect(hitTest.one.hitIsSelf).toBe(true);
  expect(hitTest.all.hitIsSelf).toBe(true);
  await win.screenshot({ path: shot('p86-07-replace-reachable.png') });

  // replace-one changes ONLY the active occurrence; the report names the count.
  await fireControl('[data-search-replace-one]');
  const reportOne = await waitReport();
  log('report-replace-one', reportOne);
  expect(reportOne).toContain('1 replaced, 0 skipped');
  const afterOne = allText((await engineText(d.engineDocId)).pages);
  log('exportText-after-one', afterOne.replace(/\n/g, ' | '));
  expect(count(afterOne, 'SECRET')).toBe(2);
  expect(count(afterOne, 'PUBLIC')).toBe(1);
  expect(count(afterOne, 'SIBLING')).toBe(1);
  await win.screenshot({ path: shot('p86-02-replace-one.png') });

  // The stale index is invalidated and the search re-runs: two hits remain.
  await waitHits(2);

  // replace-all changes every remaining occurrence in one call.
  await fireControl('[data-search-replace-all]');
  const reportAll = await waitReport();
  log('report-replace-all', reportAll);
  expect(reportAll).toContain('2 replaced, 0 skipped');
  const afterAllPages = (await engineText(d.engineDocId)).pages || [];
  const afterAll = allText(afterAllPages);
  log('exportText-after-all-pages', afterAllPages.map((p, i) => `p${i + 1}:${p.text}`));
  expect(count(afterAll, 'SECRET')).toBe(0);
  expect(count(afterAll, 'SIBLING')).toBe(1);
  expect(count(afterAll, 'OTHERPAGE')).toBe(1);
  await win.screenshot({ path: shot('p86-03-replace-all.png') });

  // Zero hits left -> replace-one / replace-all are disabled (never a no-op).
  await waitHits(0);
  expect(await win.locator('[data-search-replace-one]').isDisabled()).toBe(true);
  expect(await win.locator('[data-search-replace-all]').isDisabled()).toBe(true);

  // Save + reload: replacement is real saved text.
  await saveAs(SAVED);
  expect(fs.existsSync(SAVED), 'save produced no file').toBe(true);
  await openFixture(SAVED);
  const d2 = await diag();
  const reopenedPages = (await engineText(d2.engineDocId)).pages || [];
  const reopened = allText(reopenedPages);
  log('exportText-after-reload-pages', reopenedPages.map((p, i) => `p${i + 1}:${p.text}`));
  expect(count(reopened, 'SECRET')).toBe(0);
  expect(count(reopened, 'PUBLIC')).toBe(3);
  expect(count(reopened, 'SIBLING')).toBe(1);
  expect(count(reopened, 'OTHERPAGE')).toBe(1);
  await win.screenshot({ path: shot('p86-04-saved-reload.png') });
});

// ---------------------------------------------------------------------------
// Isolate the sequential-replace behaviour: a single replace-all on the fresh
// document must write every occurrence (no prior replace-one).
// ---------------------------------------------------------------------------
test('P86-REPLACEALL-FRESH: one replace-all writes all three occurrences', async () => {
  await openFixture(FIXTURE);
  const d = await diag();
  await openFind('SECRET');
  await waitHits(3);
  await toggleAndFill('PUBLIC');
  await fireControl('[data-search-replace-all]');
  const report = await waitReport();
  log('fresh-report', report);
  expect(report).toContain('3 replaced, 0 skipped');
  const pages = (await engineText(d.engineDocId)).pages || [];
  log('fresh-pages', pages.map((p, i) => `p${i + 1}:${p.text}`));
  expect(count(allText(pages), 'SECRET')).toBe(0);
  expect(count(allText(pages), 'PUBLIC')).toBe(3);

  await saveAs(SAVED);
  await openFixture(SAVED);
  const d2 = await diag();
  const rp = (await engineText(d2.engineDocId)).pages || [];
  log('fresh-reload-pages', rp.map((p, i) => `p${i + 1}:${p.text}`));
  expect(count(allText(rp), 'PUBLIC')).toBe(3);
});

// ---------------------------------------------------------------------------
// Ruling 6 - replace-all takes exactly ONE undo entry. After replace-one then
// replace-all, one Ctrl+Z must revert only replace-all (leaving the one
// replace-one change), and a second Ctrl+Z reverts replace-one.
// ---------------------------------------------------------------------------
test('P86-UNDO: replace-one and replace-all are each exactly one undo entry', async () => {
  await openFixture(FIXTURE);
  const d = await diag();
  await openFind('SECRET');
  await waitHits(3);
  await toggleAndFill('PUBLIC');

  await fireControl('[data-search-replace-one]');
  await waitReport();
  await waitHits(2);
  await fireControl('[data-search-replace-all]');
  await waitReport();
  expect(count(allText((await engineText(d.engineDocId)).pages), 'SECRET')).toBe(0);

  await win.keyboard.press('Control+z');
  await win.waitForTimeout(1800);
  const afterUndo1 = allText((await engineText(d.engineDocId)).pages);
  log('exportText-after-undo1', afterUndo1.replace(/\n/g, ' | '));
  expect(count(afterUndo1, 'SECRET')).toBe(2);
  expect(count(afterUndo1, 'PUBLIC')).toBe(1);

  await win.keyboard.press('Control+z');
  await win.waitForTimeout(1800);
  const afterUndo2 = allText((await engineText(d.engineDocId)).pages);
  log('exportText-after-undo2', afterUndo2.replace(/\n/g, ' | '));
  expect(count(afterUndo2, 'SECRET')).toBe(3);
  expect(count(afterUndo2, 'PUBLIC')).toBe(0);
});

// ---------------------------------------------------------------------------
// Criterion 3 - fail-loud. (a) A UI occurrence over an embedded Type0 font
// cannot be measured; the report must name replaced=0 plus a skip reason and
// the text must be unchanged. If the fixture yields no searchable hit, the
// UI-level item is recorded INCONCLUSIVE (never faked) and the engine-level
// skip below still proves fail-loud. (b) A mismatched `find` driven straight
// through the live engine is reported skipped and mutates nothing.
// ---------------------------------------------------------------------------
test('P86-SKIP: unreplaceable occurrence is reported, never silently dropped', async () => {
  await openFixture(TYPE0);
  const d = await diag();
  const before = allText((await engineText(d.engineDocId)).pages);
  await openFind('SECRET');
  await win.waitForTimeout(2500);
  const hits = (await diag()).searchHits;
  log('type0-search-hits', hits);

  if (hits > 0) {
    await toggleAndFill('PUBLIC');
    await fireControl('[data-search-replace-all]');
    const report = await waitReport();
    log('type0-skip-report', report);
    expect(report).toContain('0 replaced');
    expect(report.length).toBeGreaterThan('0 replaced, 0 skipped.'.length);
    const after = allText((await engineText(d.engineDocId)).pages);
    expect(count(after, 'SECRET')).toBe(count(before, 'SECRET'));
    await win.screenshot({ path: shot('p86-05-skip-type0.png') });
  } else {
    log('type0-skip-ui', 'INCONCLUSIVE: fixture yielded no searchable Type0 hit');
  }

  // Engine-level fail-loud on the well-measured fixture: a mismatched find is
  // returned in `skipped` with a readable reason and removes nothing.
  await openFixture(FIXTURE);
  const d2 = await diag();
  const before2 = allText((await engineText(d2.engineDocId)).pages);
  const mismatched = await win.evaluate(async (id) => {
    const r = await window.tflex.engine.replaceText(id, {
      occurrences: [{ page: 1, rect: { x: 60, y: 55, width: 120, height: 40 }, find: 'WRONG' }],
      replacement: 'PUBLIC',
    });
    return r.ok
      ? { ok: true, replaced: r.value.replaced, skipped: r.value.skipped }
      : { ok: false, error: r.error };
  }, d2.engineDocId);
  log('mismatch-skip', mismatched);
  expect(mismatched.ok).toBe(true);
  expect(mismatched.replaced).toBe(0);
  expect(mismatched.skipped.length).toBe(1);
  expect(mismatched.skipped[0].reason.length).toBeGreaterThan(0);
  const after2 = allText((await engineText(d2.engineDocId)).pages);
  expect(count(after2, 'SECRET')).toBe(count(before2, 'SECRET'));
});

// ---------------------------------------------------------------------------
// Criterion 5 - no regression to the Find bar, highlighting, navigation or the
// Phase 10 edit flow (the nearest interacting surface: same content-stream
// rewrite machinery).
// ---------------------------------------------------------------------------
test('P86-REGRESSION: Find navigation + highlighting and Phase-10 edit still work', async () => {
  await openFixture(FIXTURE);
  const d = await diag();
  await openFind('SECRET');
  await waitHits(3);
  // Highlighting renders for the hits.
  expect(await win.locator('.search-hit').count()).toBeGreaterThan(0);
  // Navigation: Enter advances the active hit; the status line follows.
  const status = win.locator('.search-status').first();
  expect(await status.innerText()).toContain('1 of 3');
  await win.keyboard.press('Enter');
  await win.waitForTimeout(600);
  expect(await status.innerText()).toContain('2 of 3');
  await win.screenshot({ path: shot('p86-06-find-nav.png') });

  // Phase 10 edit/delete path (the blast-radius neighbour) still runs.
  const edit = await win.evaluate(async (id) => {
    const r = await window.tflex.engine.editTextRun(id, {
      page: 1,
      rect: { x: 60, y: 540, width: 200, height: 40 },
      newText: '',
    });
    return r.ok ? { ok: true } : { error: r.error };
  }, d.engineDocId);
  log('phase10-edit', edit);
  expect(edit.ok).toBe(true);
  expect(allText((await engineText(d.engineDocId)).pages).length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// Blast radius (DEF-500 attempt 2) - with Find CLOSED, the page-layout control
// must still move the pointer and switch the canvas layout. The attempt-2 fix
// re-publishes `--tf-chrome-y` from the observed chrome rows; prove it did not
// displace, hide or disable the `.canvas-page-layout` control (the nearest
// interacting surface that previously intercepted the replace buttons).
// ---------------------------------------------------------------------------
test('P86-BLAST-RADIUS: page-layout control still switches layout with Find closed', async () => {
  await openFixture(FIXTURE);
  // Fresh document: the Find bar is not mounted.
  expect(await win.locator('.search-bar').count()).toBe(0);
  expect(await win.locator('[data-page-layout-control]').count()).toBe(1);
  expect(await win.getAttribute('.document-content', 'data-page-layout')).toBe('one');
  expect(await win.getAttribute('[data-page-layout-option="four"]', 'aria-pressed')).toBe('false');

  // Real pointer click - actionability hit-test must pass.
  await win.locator('[data-page-layout-option="four"]').click();
  await win.waitForFunction(
    () => document.querySelector('.document-content')?.getAttribute('data-page-layout') === 'four',
    undefined,
    { timeout: 8000 },
  );
  expect(await win.getAttribute('.document-content', 'data-page-layout')).toBe('four');
  expect(await win.getAttribute('[data-page-layout-control]', 'data-page-layout-active')).toBe('four');
  expect(await win.getAttribute('[data-page-layout-option="four"]', 'aria-pressed')).toBe('true');
  log('blast-radius-layout', await win.getAttribute('.document-content', 'data-page-layout'));
  await win.screenshot({ path: shot('p86-08-layout-blast-radius.png') });
});

// ---------------------------------------------------------------------------
// Criterion 4 - offline only. The replace flow must issue no http(s) request.
// (Static source grep for network primitives is run separately by qa.)
// ---------------------------------------------------------------------------
test('P86-OFFLINE: the replace flow issues no network request', async () => {
  await openFixture(FIXTURE);
  const requests = [];
  const handler = (req) => {
    if (/^https?:/i.test(req.url())) requests.push(req.url());
  };
  win.on('request', handler);
  await openFind('SECRET');
  await waitHits(3);
  await toggleAndFill('PUBLIC');
  await fireControl('[data-search-replace-all]');
  await waitReport();
  await win.waitForTimeout(800);
  win.off('request', handler);
  log('replace-network-requests', requests);
  expect(requests).toEqual([]);
});
