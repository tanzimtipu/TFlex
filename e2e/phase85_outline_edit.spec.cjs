// Phase 85 phase-validation e2e (qa) - editable outline / bookmark tree (FEA-035).
//
// HARNESS: canonical launchApp (e2e/lib/launch.cjs); hardClose (e2e/lib/helpers.cjs).
// Fixtures are built in-process with @cantoo/pdf-lib:
//   - p85-outline.pdf: a 3-page PDF with 3 TOP-LEVEL bookmarks targeting pages
//     1, 2 and 2 (the edit fixture);
//   - p85-empty.pdf: a 2-page PDF with NO /Outlines (the DEF-492 fixture).
//
// PHASE-GATE PROCEDURE: this spec drives the BUILT renderer/main, so dist/ must
// be rebuilt before the run or a stale bundle can pass silently. Run the gate as:
//   npm.cmd run build
//   npm.cmd run test:e2e -- e2e/phase85_outline_edit.spec.cjs
//
// Success criteria covered: 1 (each verb commits via engine.setOutline and the
// panel shows the tree), 2 (navigation before/after editing), 3 (save -> re-read
// /Outlines from the saved bytes + reload), 4 (out-of-range fail-loud + typed
// engine error), 5 (blast radius: shared snapshot/undo path + navigation),
// 7-as-DEF-492 (outline-less doc shows the section and can add a first bookmark).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {
  PDFDocument,
  PDFName,
  PDFString,
  PDFNumber,
  PDFArray,
  PDFDict,
  PDFRef,
} = require('@cantoo/pdf-lib');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

// Some harnesses export ELECTRON_RUN_AS_NODE=1 for their own Node shim; launchApp
// spreads process.env into the Electron child, so that variable makes Electron
// exit immediately as plain Node. Drop it before any launch.
delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const TMP = path.join(os.tmpdir(), 'p85-outline');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const FIXTURE = path.join(TMP, 'p85-outline.pdf');
const EMPTY_FIXTURE = path.join(TMP, 'p85-empty.pdf');
const SAVED = path.join(TMP, 'p85-saved.pdf');
const SAVED_EMPTY = path.join(TMP, 'p85-empty-saved.pdf');

const log = (label, obj) => console.log(`[p85|${label}] ${JSON.stringify(obj)}`);

// Every open tab keeps a hidden .tab-pane; when a second document is opened the
// outline panel exists once per tab. Scope every outline locator to the VISIBLE
// pane so the active document's panel is the one driven.
const PANE = '.tab-pane[aria-hidden="false"]';

let app = null;
let win = null;

test.setTimeout(300000);

/** Build an N-page PDF carrying the given top-level bookmark specs. */
async function buildOutlinePdf(file, specs, pageCount = 3) {
  const doc = await PDFDocument.create();
  const pages = [];
  for (let i = 0; i < pageCount; i += 1) pages.push(doc.addPage([612, 792]));
  const ctx = doc.context;
  const root = ctx.obj({ Type: 'Outlines' });
  const rootRef = ctx.register(root);
  let firstRef = null;
  let prevRef = null;
  let lastRef = null;
  for (const spec of specs) {
    const item = ctx.obj({ Title: PDFString.of(spec.title), Parent: rootRef });
    const itemRef = ctx.register(item);
    item.set(PDFName.of('Dest'), ctx.obj([pages[spec.page - 1].ref, 'Fit']));
    if (firstRef === null) firstRef = itemRef;
    if (prevRef !== null) {
      ctx.lookup(prevRef).set(PDFName.of('Next'), itemRef);
      item.set(PDFName.of('Prev'), prevRef);
    }
    prevRef = itemRef;
    lastRef = itemRef;
  }
  root.set(PDFName.of('First'), firstRef);
  root.set(PDFName.of('Last'), lastRef);
  root.set(PDFName.of('Count'), PDFNumber.of(specs.length));
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
  fs.writeFileSync(file, await doc.save());
  return file;
}

/** Build a plain N-page PDF with no catalog /Outlines at all. */
async function buildPlainPdf(file, pageCount) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) doc.addPage([612, 792]);
  fs.writeFileSync(file, await doc.save());
  return file;
}

/** Recursively read a saved document's /Outlines tree with pdf-lib. `page` is
 *  the 1-based page index a /Dest resolves to, or null. This is the persistence
 *  oracle: it reads the SAVED BYTES, never the app's own panel. */
async function readOutlineTree(file) {
  const doc = await PDFDocument.load(fs.readFileSync(file), { updateMetadata: false });
  const rootVal = doc.catalog.get(PDFName.of('Outlines'));
  let root = null;
  if (rootVal instanceof PDFDict) root = rootVal;
  else if (rootVal instanceof PDFRef) {
    const looked = doc.context.lookup(rootVal);
    if (looked instanceof PDFDict) root = looked;
  }
  if (root === null) return [];
  const seen = new Set();
  const readChain = (first) => {
    const out = [];
    let cur = first;
    while (cur !== undefined && cur !== null) {
      const tag = cur instanceof PDFRef ? cur.tag : 'inline';
      if (seen.has(tag)) break;
      seen.add(tag);
      let node = null;
      if (cur instanceof PDFDict) node = cur;
      else if (cur instanceof PDFRef) {
        const looked = doc.context.lookup(cur);
        if (looked instanceof PDFDict) node = looked;
      }
      if (node === null) break;
      const titleObj = node.get(PDFName.of('Title'));
      const title = titleObj instanceof PDFString ? titleObj.asString() : '';
      let page = null;
      const destVal = node.get(PDFName.of('Dest'));
      if (destVal instanceof PDFArray && destVal.size() > 0) {
        const firstEl = destVal.get(0);
        if (firstEl instanceof PDFRef) {
          for (let p = 0; p < doc.getPageCount(); p += 1) {
            if (doc.getPage(p).ref.tag === firstEl.tag) { page = p + 1; break; }
          }
        }
      }
      out.push({ title, page, children: readChain(node.get(PDFName.of('First'))) });
      cur = node.get(PDFName.of('Next'));
    }
    return out;
  };
  return readChain(root.get(PDFName.of('First')));
}

test.beforeAll(async () => {
  await buildOutlinePdf(FIXTURE, [
    { title: 'Bookmark 1', page: 1 },
    { title: 'Bookmark 2', page: 2 },
    { title: 'Bookmark 3', page: 2 },
  ]);
  await buildPlainPdf(EMPTY_FIXTURE, 2);
});

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p85-outline');
  app = null;
  win = null;
});

// --- driving helpers ------------------------------------------------------

async function openFixture(filePath) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, filePath);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1400);
}

async function ensureOutlineOpen() {
  const section = win.locator(`${PANE} [data-context-panel-outline]`);
  await expect(section).toHaveCount(1);
  if ((await section.getAttribute('data-outline-open')) !== 'true') {
    await win.locator(`${PANE} [data-outline-toggle]`).click();
    await win.waitForTimeout(500);
  }
  await expect(section).toHaveAttribute('data-outline-open', 'true');
}

async function waitEditable() {
  await win.waitForSelector(`${PANE} [data-outline-editable]`, { timeout: 15000 });
  await win.waitForTimeout(300);
}

function row(pathStr) {
  return win.locator(`${PANE} [data-outline-row][data-outline-path="${pathStr}"]`);
}

async function selectRow(pathStr) {
  await row(pathStr).locator('[data-outline-page]').click();
  await expect(row(pathStr)).toHaveAttribute('data-outline-selected', 'true');
}

async function readRows() {
  return win.evaluate((pane) => {
    const root = document.querySelector(pane);
    if (root === null) return [];
    return [...root.querySelectorAll('[data-outline-editable] [data-outline-row]')].map((el) => {
      const link = el.querySelector('.outline-link');
      const badge = el.querySelector('[data-outline-page]');
      const pad = parseInt(el.style.paddingLeft, 10);
      return {
        path: el.getAttribute('data-outline-path'),
        selected: el.getAttribute('data-outline-selected'),
        title: link ? link.textContent : null,
        page: badge ? badge.textContent : null,
        depth: Math.round((pad - 8) / 14),
      };
    });
  }, PANE);
}

async function currentPage() {
  return win.evaluate(() => window.tflexDiagnostics().currentPage);
}

async function addAfter(pathStr) {
  await row(pathStr).locator('[data-outline-add]').click();
}

async function renameRow(pathStr, title) {
  await row(pathStr).locator('[data-outline-rename]').click();
  const input = win.locator(`${PANE} [data-outline-rename-input]`);
  await input.waitFor({ state: 'visible', timeout: 5000 });
  await input.fill(title);
  await input.press('Enter');
}

async function retargetRow(pathStr, value) {
  await row(pathStr).locator('[data-outline-retarget]').selectOption(value);
}

async function clickVerb(pathStr, verb) {
  await row(pathStr).locator(`[data-outline-${verb}]`).click();
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

async function getRow(pathStr) {
  const all = await readRows();
  return all.find((r) => r.path === pathStr) ?? null;
}

const FINAL_ROW_SHAPE = [
  { path: '0', title: 'Bookmark 1', page: '1', depth: 0 },
  { path: '1', title: 'Added', page: '3', depth: 0 },
  { path: '1/0', title: 'Bookmark 3', page: '2', depth: 1 },
];

const FINAL_TREE = [
  { title: 'Bookmark 1', page: 1, children: [] },
  { title: 'Added', page: 3, children: [{ title: 'Bookmark 3', page: 2, children: [] }] },
];

// ---------------------------------------------------------------------------
// Criteria 1 + 2 + 3 - every verb, navigation, save -> re-read -> reload.
// ---------------------------------------------------------------------------
test('P85-CORE: add/rename/retarget/indent/outdent/delete -> edited tree -> save -> re-read /Outlines -> reload', async () => {
  await openFixture(FIXTURE);
  await ensureOutlineOpen();
  await waitEditable();

  // --- initial fixture shape (3 top-level rows) --------------------------
  const initial = await readRows();
  log('initial-rows', initial);
  expect(initial.map((r) => r.title)).toEqual(['Bookmark 1', 'Bookmark 2', 'Bookmark 3']);
  expect(initial.map((r) => r.page)).toEqual(['1', '2', '2']);

  // --- criterion 2: navigation BEFORE editing ----------------------------
  await win.locator(`${PANE} .outline-link`).filter({ hasText: 'Bookmark 3' }).first().click();
  await expect.poll(currentPage, { timeout: 15000 }).toBe(2);
  await win.locator(`${PANE} .outline-link`).filter({ hasText: 'Bookmark 1' }).first().click();
  await expect.poll(currentPage, { timeout: 15000 }).toBe(1);
  log('nav-before-edit', 'Bookmark 3 -> 2, Bookmark 1 -> 1');

  // --- verb 1: ADD a sibling after Bookmark 2 ----------------------------
  await selectRow('1');
  await addAfter('1');
  await expect.poll(async () => (await readRows()).length, { timeout: 15000 }).toBe(4);
  const added = await getRow('2');
  log('after-add', added);
  expect(added.title).toBe('New bookmark');
  expect(added.page).toBe('\u2013');

  // --- verb 2: RENAME the new entry --------------------------------------
  await renameRow('2', 'Added');
  await expect.poll(async () => (await getRow('2'))?.title, { timeout: 15000 }).toBe('Added');

  // --- verb 3: RETARGET the new entry to page 3 --------------------------
  await retargetRow('2', '3');
  await expect.poll(async () => (await getRow('2'))?.page, { timeout: 15000 }).toBe('3');

  // --- verb 4: INDENT Bookmark 3 under its previous sibling --------------
  await selectRow('3');
  await clickVerb('3', 'indent');
  await expect.poll(async () => (await getRow('2/0'))?.title, { timeout: 15000 }).toBe('Bookmark 3');
  expect((await getRow('2/0')).depth, 'indented row is one level deeper').toBe(1);

  // --- verb 5: OUTDENT it back to the top level --------------------------
  await selectRow('2/0');
  await clickVerb('2/0', 'outdent');
  await expect.poll(async () => (await getRow('3'))?.title, { timeout: 15000 }).toBe('Bookmark 3');
  expect((await getRow('3')).depth, 'outdented row is at the top level').toBe(0);

  // --- indent again so the persisted tree keeps a nested entry -----------
  await selectRow('3');
  await clickVerb('3', 'indent');
  await expect.poll(async () => (await getRow('2/0'))?.title, { timeout: 15000 }).toBe('Bookmark 3');

  // --- verb 6: DELETE Bookmark 2 (and its empty subtree) -----------------
  await selectRow('1');
  await clickVerb('1', 'delete');
  await expect.poll(async () => (await readRows()).length, { timeout: 15000 }).toBe(3);

  const finalRows = (await readRows()).map((r) => ({
    path: r.path, title: r.title, page: r.page, depth: r.depth,
  }));
  log('final-rows', finalRows);
  expect(finalRows).toEqual(FINAL_ROW_SHAPE);
  await win.screenshot({ path: path.join(SHOTS, 'phase85_panel_after_edits.png') });

  // --- criterion 2: navigation AFTER editing -----------------------------
  await win.locator(`${PANE} .outline-link`).filter({ hasText: 'Added' }).first().click();
  await expect.poll(currentPage, { timeout: 15000 }).toBe(3);
  log('nav-after-edit', 'Added -> 3');

  // --- criterion 3: save and re-read the persisted /Outlines -------------
  await saveAs(SAVED);
  expect(fs.existsSync(SAVED), 'save produced no file').toBe(true);
  const persisted = await readOutlineTree(SAVED);
  log('persisted-tree', persisted);
  expect(persisted).toEqual(FINAL_TREE);

  // Document integrity: the saved file is still a valid 3-page PDF.
  const savedDoc = await PDFDocument.load(fs.readFileSync(SAVED), { updateMetadata: false });
  expect(savedDoc.getPageCount(), 'saved file page count intact').toBe(3);

  // --- criterion 3: a compliant reader shows the same outline ------------
  await openFixture(SAVED);
  await ensureOutlineOpen();
  await waitEditable();
  await expect.poll(async () => (await readRows()).length, { timeout: 15000 }).toBe(3);
  const reloadRows = (await readRows()).map((r) => ({
    path: r.path, title: r.title, page: r.page, depth: r.depth,
  }));
  log('reload-rows', reloadRows);
  await win.screenshot({ path: path.join(SHOTS, 'phase85_saved_reload.png') });
  expect(
    reloadRows.map((r) => r.page),
    'DEF-493: the reloaded outline must keep its page targets (1,3,2)',
  ).toEqual(['1', '3', '2']);
  expect(reloadRows).toEqual(FINAL_ROW_SHAPE);

  // Navigation still works on the reloaded document.
  await win.locator(`${PANE} .outline-link`).filter({ hasText: 'Added' }).first().click();
  await expect.poll(currentPage, { timeout: 15000 }).toBe(3);
});

// ---------------------------------------------------------------------------
// Criterion 4 - out-of-range retarget: error surfaced, nothing applied, and
// the engine itself returns the typed out-of-range error.
// ---------------------------------------------------------------------------
test('P85-FAIL-LOUD: out-of-range retarget shows [data-outline-error], applies nothing, engine returns out-of-range', async () => {
  await openFixture(FIXTURE);
  await ensureOutlineOpen();
  await waitEditable();

  await selectRow('0');
  const pageBefore = (await getRow('0')).page;
  expect(pageBefore).toBe('1');

  // Force an out-of-range target through the real control's change event.
  await win.evaluate((pane) => {
    const root = document.querySelector(pane);
    const sel = root.querySelector('[data-outline-path="0"] [data-outline-retarget]');
    const opt = document.createElement('option');
    opt.value = '99';
    opt.textContent = 'Page 99';
    sel.appendChild(opt);
    sel.value = '99';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, PANE);
  await win.waitForTimeout(500);

  await expect(win.locator(`${PANE} [data-outline-error]`), 'out-of-range shows the error').toBeVisible();
  const errText = (await win.locator(`${PANE} [data-outline-error]`).innerText()).trim();
  log('outline-error', errText);
  expect(errText.length, 'the error is readable, not a silent no-op').toBeGreaterThan(0);

  // Nothing applied: the row keeps its accepted page and the tree is unchanged.
  expect((await getRow('0')).page, 'the row page is unchanged').toBe('1');
  expect((await readRows()).length, 'no duplicate/added row').toBe(3);
  expect((await getRow('0')).title).toBe('Bookmark 1');

  // The engine returns the typed out-of-range error and applies nothing.
  const typed = await win.evaluate(async () => {
    const d = window.tflexDiagnostics();
    const r = await window.tflex.engine.setOutline(d.engineDocId, [
      { title: 'Bad', page: 99, children: [] },
    ]);
    return r.ok ? { ok: true } : { code: r.error.code, message: r.error.message };
  });
  log('engine-typed-error', typed);
  expect(typed.code).toBe('out-of-range');

  // The refused direct engine edit left the panel's accepted tree untouched.
  expect(await readRows()).toHaveLength(3);
  await win.screenshot({ path: path.join(SHOTS, 'phase85_fail_loud.png') });
});

// ---------------------------------------------------------------------------
// DEF-492 / criterion 7 - a document with NO /Outlines still shows the Outline
// section and [data-outline-add] creates the first bookmark (which persists).
// ---------------------------------------------------------------------------
test('P85-DEF492-EMPTY: an outline-less document shows the Outline section and can add the first bookmark', async () => {
  await openFixture(EMPTY_FIXTURE);
  await win.waitForSelector('[data-context-panel-outline]', { timeout: 15000 });
  await ensureOutlineOpen();
  await waitEditable();

  const before = await readRows();
  log('empty-rows-before', before);
  expect(before.length, 'no outline rows yet').toBe(0);
  await expect(win.locator(`${PANE} [data-outline-add]`)).toBeVisible();

  // Diagnostic geometry for the toolbar Add control (DEF-492 empty path).
  const geom = await win.evaluate((pane) => {
    const root = document.querySelector(pane);
    const add = root.querySelector('[data-outline-toolbar] [data-outline-add]');
    const rail = document.querySelector('.stage-rail');
    const rr = (el) => {
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const ab = add.getBoundingClientRect();
    const cx = ab.x + ab.width / 2;
    const cy = ab.y + ab.height / 2;
    const top = document.elementFromPoint(cx, cy);
    return {
      add: rr(add),
      rail: rail ? rr(rail) : null,
      toolbar: rr(root.querySelector('[data-outline-toolbar]')),
      editable: rr(root.querySelector('[data-outline-editable]')),
      section: rr(root.querySelector('[data-context-panel-outline]')),
      body: rr(root.querySelector('[data-context-panel-outline-body]')),
      panel: rr(root.querySelector('[data-context-panel="pages"]')),
      // Hit-test result: the centre must resolve to the add button or a
      // descendant of it (its own SVG icon is a legitimate hit). Any overlay
      // such as NAV.stage-rail would instead be returned here.
      atCenterIsAdd: top !== null && (top === add || add.contains(top)),
      atCenter: top ? `${top.tagName}[${top.getAttribute('data-outline-add') !== null ? 'data-outline-add' : (typeof top.className === 'string' ? top.className : (top.className && top.className.baseVal) || '')}]` : null,
    };
  }, PANE);
  log('def492-add-geometry', geom);

  // The documented empty-outline interaction is a real click on the toolbar Add
  // control. Assert the control owns its centre (no overlay such as the stage
  // rail covers it) before driving it. The control's own SVG icon may be the
  // exact element at the centre; that still hit-tests to the add button via
  // bubbling, so accept the button or any descendant.
  expect(
    geom.atCenterIsAdd,
    `DEF-492: [data-outline-add] must be hit-testable at its centre; got ${geom.atCenter}`,
  ).toBe(true);

  await win.locator(`${PANE} [data-outline-toolbar] [data-outline-add]`).click();
  await expect.poll(async () => (await readRows()).length, { timeout: 15000 }).toBe(1);
  const first = await getRow('0');
  log('empty-rows-after-add', first);
  expect(first.title).toBe('New bookmark');
  expect(first.page).toBe('\u2013');

  // Make it a real first bookmark and prove it persists.
  await retargetRow('0', '1');
  await expect.poll(async () => (await getRow('0'))?.page, { timeout: 15000 }).toBe('1');

  await saveAs(SAVED_EMPTY);
  expect(fs.existsSync(SAVED_EMPTY), 'save produced no file').toBe(true);
  const persisted = await readOutlineTree(SAVED_EMPTY);
  log('empty-persisted-tree', persisted);
  expect(persisted).toEqual([{ title: 'New bookmark', page: 1, children: [] }]);
});

// ---------------------------------------------------------------------------
// Criterion 5 / blast radius - the outline rewrite shares snapshotDocWithPdf
// with every mutating op and rides carryOutlines on serialize. Undo must
// restore the previous bytes and re-seed the panel from them.
// ---------------------------------------------------------------------------
test('P85-BLAST-UNDO: undo restores the previous outline tree and navigation still jumps', async () => {
  await openFixture(FIXTURE);
  await ensureOutlineOpen();
  await waitEditable();

  await selectRow('0');
  await renameRow('0', 'Renamed');
  await expect.poll(async () => (await getRow('0'))?.title, { timeout: 15000 }).toBe('Renamed');

  // Undo the setOutline through the app's global shortcut; the shared snapshot
  // path must restore the pre-edit /Outlines, and the reseed must surface it.
  await win.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await win.keyboard.press('Control+z');
  await expect.poll(async () => (await getRow('0'))?.title, { timeout: 20000 }).toBe('Bookmark 1');
  expect((await readRows()).length, 'undo restored the 3-row tree').toBe(3);
  const undoRows = await readRows();
  log('rows-after-undo', undoRows);
  expect(
    undoRows.map((r) => r.page),
    'DEF-493: the post-undo reseed must keep the outline page targets (1,2,2)',
  ).toEqual(['1', '2', '2']);

  // Read-only navigation still works after the shared-path round trip.
  await win.locator(`${PANE} .outline-link`).filter({ hasText: 'Bookmark 2' }).first().click();
  await expect.poll(currentPage, { timeout: 15000 }).toBe(2);
  log('blast-undo-nav', 'Bookmark 2 -> 2');
});
