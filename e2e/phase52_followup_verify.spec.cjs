// Phase 52 follow-up FIX-READY verification (qa). Three operator bugs:
//   1. a selected text box painted TWO concentric outlines;
//   2. moving text left phantom hover boxes at the OLD position;
//   3. the form overlay painted opaque dark blocks and dumped every field
//      onto page 1.
// Every launch goes through the canonical e2e/lib/launch.cjs launchApp helper.
// Raw [P52FU ...] lines are the evidence.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, gotoStage, armAnnotationTool } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const OPERATOR_FILE = 'C:\\Users\\tanzi\\OneDrive\\Desktop\\Parent visa\\956.pdf';

let app = null;
let win = null;
test.setTimeout(300000);

test.afterEach(async () => {
  if (app) await hardClose(app, 'p52fu');
  app = null;
  win = null;
});

async function launch() {
  const userDataDir = path.join(os.tmpdir(), `tflex-p52fu-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  app = await launchApp([], userDataDir);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  return win;
}

async function openViaDialog(absPath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, absPath);
  await win.locator('[data-toolbar-open]').click();
}

// ---------------------------------------------------------------------------
// Computed-style reader for one surface. Reports the border / outline /
// box-shadow / background / radius plus whether a shared selection ring is
// painted over it.
// ---------------------------------------------------------------------------
async function readSurface(selector) {
  return win.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { selector: sel, present: false };
    const cs = getComputedStyle(el);
    const frame = document.querySelector('[data-content-selection-frame]');
    const bounds = document.querySelector('[data-content-selection-bounds]');
    const r = el.getBoundingClientRect();
    return {
      selector: sel,
      present: true,
      rect: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      borderTopWidth: cs.borderTopWidth,
      borderTopStyle: cs.borderTopStyle,
      borderTopColor: cs.borderTopColor,
      borderTopLeftRadius: cs.borderTopLeftRadius,
      outlineWidth: cs.outlineWidth,
      outlineStyle: cs.outlineStyle,
      outlineColor: cs.outlineColor,
      boxShadow: cs.boxShadow,
      background: cs.backgroundColor,
      selectionFrame: frame !== null,
      selectionBounds: bounds !== null,
      boundsInside: bounds !== null && el.contains(bounds),
    };
  }, selector);
}

function logSurface(label, s) {
  console.log(`[P52FU ${label}] ${JSON.stringify(s)}`);
}

// ---------------------------------------------------------------------------
// Bug 1 - textbox / callout single border.
// ---------------------------------------------------------------------------
const ANN_KINDS = [
  ['textbox', { kind: 'textbox', rect: { x: 60, y: 120, width: 200, height: 60 }, text: 'BOX TEXT' }],
  ['callout', { kind: 'callout', rect: { x: 60, y: 260, width: 200, height: 60 }, at: { x: 40, y: 240 }, text: 'CALLOUT TEXT' }],
  ['rect', { kind: 'rect', rect: { x: 60, y: 400, width: 160, height: 80 } }],
];

async function injectAnnotations() {
  const docId = await win.evaluate(() => window.tflexDiagnostics().engineDocId);
  return win.evaluate(async ({ id, kinds }) => {
    const out = [];
    for (const [name, payload] of kinds) {
      const res = await window.tflex.engine.createAnnotation(id, {
        id: `p52fu-${name}`,
        page: 1,
        color: 'blue',
        createdAt: '2026-09-29T00:00:00Z',
        ...payload,
      });
      out.push({ name, ok: res.ok, error: res.ok ? null : res.error });
    }
    return out;
  }, { id: docId, kinds: ANN_KINDS });
}

async function createRectViaUi() {
  await gotoStage(win, 3);
  await armAnnotationTool(win, 'rect');
  const pg = await win.locator('.pdf-page[data-page="1"]').first().boundingBox();
  const x = Math.round(pg.x + pg.width * 0.35);
  const y = Math.round(pg.y + pg.height * 0.3);
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + 160, y + 90, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(900);
}

test('P52FU-1: a selected textbox / callout paints exactly ONE rounded border', async () => {
  await launch();
  await openViaDialog(getSamplePath('report.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);

  const injected = await injectAnnotations();
  console.log(`[P52FU-1 injected] ${JSON.stringify(injected)}`);
  for (const r of injected) expect(r.ok, `createAnnotation ${r.name}`).toBe(true);
  await createRectViaUi();
  await win.waitForTimeout(900);

  const probe = await win.evaluate(() => {
    const layer = document.querySelector('.annotation-layer');
    return {
      layerTool: layer ? layer.getAttribute('data-tool') : null,
      textbox: document.querySelectorAll('.ann-textbox').length,
      callout: document.querySelectorAll('.ann-callout').length,
      shape: document.querySelectorAll('.ann-shape').length,
    };
  });
  console.log(`[P52FU-1 probe] ${JSON.stringify(probe)}`);
  expect(probe.textbox, 'a textbox annotation renders').toBeGreaterThan(0);
  expect(probe.callout, 'a callout annotation renders').toBeGreaterThan(0);
  expect(probe.shape, 'a shape annotation renders').toBeGreaterThan(0);

  // --- resting ---
  const restBox = await readSurface('.ann-textbox');
  const restCallout = await readSurface('.ann-callout');
  logSurface('1 textbox resting', restBox);
  logSurface('1 callout resting', restCallout);
  expect(restBox.present, 'textbox renders').toBe(true);
  expect(restCallout.present, 'callout renders').toBe(true);
  for (const [name, s] of [['textbox', restBox], ['callout', restCallout]]) {
    expect(parseFloat(s.borderTopWidth), `${name} resting: one border`).toBeGreaterThanOrEqual(2);
    expect(s.outlineStyle, `${name} resting: no outline`).toBe('none');
    expect(s.boxShadow, `${name} resting: no box-shadow ring`).toBe('none');
    expect(s.selectionBounds, `${name} resting: no selection ring`).toBe(false);
  }

  // --- hovered ---
  // Clear the freshly-created rect's selection (and its comment card) first.
  await win.keyboard.press('Escape');
  await win.waitForTimeout(400);
  const boxEl = win.locator('.ann-textbox').first();
  const bb = await boxEl.boundingBox();
  await win.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await win.waitForTimeout(300);
  const hovBox = await readSurface('.ann-textbox');
  logSurface('1 textbox hovered', hovBox);
  expect(hovBox.outlineStyle, 'textbox hovered: no outline').toBe('none');
  expect(hovBox.boxShadow, 'textbox hovered: no box-shadow ring').toBe('none');

  // --- selected ---
  await boxEl.click();
  await win.waitForTimeout(500);
  const selBox = await readSurface('.ann-textbox');
  logSurface('1 textbox selected', selBox);
  expect(selBox.selectionFrame, 'textbox selected: selection frame present').toBe(true);
  expect(selBox.selectionBounds, 'textbox selected: NO second bounds ring').toBe(false);
  expect(selBox.borderTopColor, 'textbox selected: single frame turns accent').toBe('rgb(37, 99, 235)');
  expect(selBox.outlineStyle, 'textbox selected: no outline').toBe('none');
  expect(selBox.boxShadow, 'textbox selected: no box-shadow ring').toBe('none');
  expect(parseFloat(selBox.borderTopLeftRadius), 'textbox selected: rounded').toBeGreaterThanOrEqual(4);

  // The comment card mounts on selection; it must also carry ONE border.
  const comment = await readSurface('.ann-comment-box');
  logSurface('1 comment-box selected', comment);
  if (comment.present) {
    expect(comment.outlineStyle, 'comment-box: no outline').toBe('none');
    expect(parseFloat(comment.borderTopWidth), 'comment-box: one border').toBeGreaterThanOrEqual(2);
  }

  await win.screenshot({ path: path.join(SHOTS, 'p52fu-selected-textbox.png') });

  // --- callout selected ---
  await win.keyboard.press('Escape');
  await win.waitForTimeout(400);
  await win.locator('.ann-callout').first().click();
  await win.waitForTimeout(500);
  const selCallout = await readSurface('.ann-callout');
  logSurface('1 callout selected', selCallout);
  expect(selCallout.selectionFrame, 'callout selected: selection frame present').toBe(true);
  expect(selCallout.selectionBounds, 'callout selected: NO second bounds ring').toBe(false);
  expect(selCallout.borderTopColor, 'callout selected: single frame turns accent').toBe('rgb(37, 99, 235)');
  expect(selCallout.outlineStyle, 'callout selected: no outline').toBe('none');
  expect(selCallout.boxShadow, 'callout selected: no box-shadow ring').toBe('none');

  // --- control: a selected SHAPE still uses the shared bounds ring ---
  await win.locator('.ann-shape').first().click();
  await win.waitForTimeout(500);
  const selShape = await readSurface('.ann-shape');
  logSurface('1 shape selected (control)', selShape);
  expect(selShape.selectionBounds, 'shape selected: shared bounds ring still used').toBe(true);
});

// ---------------------------------------------------------------------------
// Bug 1 (continued) - the edit-mode text surfaces.
// ---------------------------------------------------------------------------
async function armEditText() {
  await win.evaluate(() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); });
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-command-palette-input]').fill('Edit text');
  await win.waitForTimeout(450);
  const row = win.locator('[data-palette-tool-id="editText"]').first();
  if ((await row.count()) > 0) { await row.click(); } else { await win.keyboard.press('Enter'); }
  await win.waitForTimeout(700);
}

async function selectRun() {
  const pageLoc = win.locator('.tab-pane[aria-hidden="false"] .pdf-page[data-page="1"]');
  const pg = await (await pageLoc.count() ? pageLoc.first() : win.locator('.pdf-page[data-page="1"]').first()).boundingBox();
  const fracs = [[0.5, 0.1], [0.3, 0.12], [0.5, 0.16], [0.25, 0.22], [0.5, 0.3], [0.35, 0.42], [0.55, 0.5], [0.4, 0.62]];
  for (const [fx, fy] of fracs) {
    await win.mouse.click(Math.round(pg.x + pg.width * fx), Math.round(pg.y + pg.height * fy));
    await win.waitForTimeout(550);
    const active = await win.evaluate(() => {
      const root = document.querySelector('.tab-pane[aria-hidden="false"]') || document;
      return root.querySelector('[data-textrun-selection]') !== null;
    });
    if (active) return true;
  }
  return false;
}

test('P52FU-2: the edit-mode text surfaces paint exactly ONE border (no box-shadow ring)', async () => {
  await launch();
  await openViaDialog(getSamplePath('long.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
  await gotoStage(win, 2);
  await armEditText();
  expect(await selectRun(), 'a text run is selectable').toBe(true);
  await win.waitForTimeout(600);

  // Selected run surface.
  const sel = await readSurface('.edit-textrun-selection');
  logSurface('2 textrun-selection', sel);
  expect(sel.present, 'the selected run surface renders').toBe(true);
  expect(parseFloat(sel.borderTopWidth), 'selected run: one border').toBeGreaterThanOrEqual(1);
  expect(sel.outlineStyle, 'selected run: no outline').toBe('none');
  expect(sel.boxShadow, 'selected run: no box-shadow ring').toBe('none');

  // Hover preview on an unmoved run.
  const pg = await win.locator('.pdf-page[data-page="1"]').first().boundingBox();
  await win.mouse.move(Math.round(pg.x + pg.width * 0.5), Math.round(pg.y + pg.height * 0.1));
  await win.waitForTimeout(400);
  const hover = await readSurface('.edit-text-hover');
  logSurface('2 text-hover', hover);
  if (hover.present) {
    expect(hover.outlineStyle, 'hover preview: no outline').toBe('none');
    expect(hover.boxShadow, 'hover preview: no box-shadow ring').toBe('none');
  }

  // Open the on-canvas run editor (double-click the selection).
  await win.evaluate(() => {
    const el = document.querySelector('[data-textrun-selection]');
    if (el) el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await win.waitForTimeout(600);
  const editorRest = await readSurface('.edit-run-editor');
  logSurface('2 run-editor resting', editorRest);
  expect(editorRest.present, 'the run editor mounts').toBe(true);
  expect(parseFloat(editorRest.borderTopWidth), 'run editor: one border').toBeGreaterThanOrEqual(1);
  expect(editorRest.outlineStyle, 'run editor resting: no outline').toBe('none');
  expect(editorRest.boxShadow, 'run editor resting: no box-shadow ring').toBe('none');

  // Focused state.
  await win.locator('[data-edit-run-editor]').focus();
  await win.waitForTimeout(300);
  const editorFocus = await readSurface('.edit-run-editor');
  logSurface('2 run-editor focused', editorFocus);
  // The fix's goal: NO second box-shadow ring on focus. (The inline
  // `border: ... solid transparent` on the textarea outranks the
  // `.edit-run-editor:focus { border-color: var(--accent) }` rule, so the
  // computed border stays transparent - reported, not asserted.)
  expect(editorFocus.outlineStyle, 'run editor focused: no outline').toBe('none');
  expect(editorFocus.boxShadow, 'run editor focused: NO second box-shadow ring').toBe('none');
  expect(parseFloat(editorFocus.borderTopWidth), 'run editor focused: one border box').toBeGreaterThanOrEqual(2);

  // The committed canvas text box + its drag preview.
  await win.keyboard.press('Escape');
  await win.waitForTimeout(400);
  await win.locator('[data-dock-verb="editTextBox"]').waitFor({ state: 'visible', timeout: 10000 });
  await win.locator('[data-dock-verb="editTextBox"]').click();
  await win.waitForTimeout(500);

  // Drag out a NEW box: the dashed preview mounts mid-drag.
  const pg2 = await win.locator('.pdf-page[data-page="1"]').first().boundingBox();
  const layerBox = await win.locator('.edit-layer').first().boundingBox();
  const toolBefore = await win.evaluate(() => document.querySelector('.edit-layer')?.getAttribute('data-tool') ?? null);
  console.log(`[P52FU-2 drag] page=${JSON.stringify(pg2)} layer=${JSON.stringify(layerBox)} tool=${toolBefore}`);
  const px = Math.round(pg2.x + pg2.width * 0.2);
  const py = Math.round(pg2.y + 600);
  await win.mouse.move(px, py);
  await win.mouse.down();
  await win.mouse.move(px + 140, py + 60, { steps: 6 });
  await win.waitForTimeout(300);
  const preview = await readSurface('.edit-box-preview');
  logSurface('2 edit-box-preview', preview);
  expect(preview.present, 'the box drag preview renders').toBe(true);
  expect(parseFloat(preview.borderTopWidth), 'box preview: one border').toBeGreaterThanOrEqual(2);
  expect(preview.outlineStyle, 'box preview: no outline').toBe('none');
  expect(preview.boxShadow, 'box preview: no box-shadow ring').toBe('none');
  await win.mouse.up();
  await win.waitForTimeout(900);

  // The committed box surface (the box just placed by the drag).
  const editBox = await readSurface('.edit-box');
  logSurface('2 edit-box', editBox);
  expect(editBox.present, 'the committed canvas text box renders').toBe(true);
  expect(parseFloat(editBox.borderTopWidth), 'edit-box: one border').toBeGreaterThanOrEqual(2);
  expect(editBox.outlineStyle, 'edit-box: no outline').toBe('none');
  expect(editBox.boxShadow, 'edit-box: no box-shadow ring').toBe('none');
  expect(parseFloat(editBox.borderTopLeftRadius), 'edit-box: rounded').toBeGreaterThanOrEqual(4);
});

// ---------------------------------------------------------------------------
// Bug 2 - no residual hover box after moving text.
// ---------------------------------------------------------------------------
async function runState() {
  return win.evaluate(() => {
    const root = document.querySelector('.tab-pane[aria-hidden="false"]') || document;
    const sel = root.querySelector('[data-textrun-selection]');
    const prev = root.querySelector('[data-edit-run-preview]');
    const eraser = root.querySelector('[data-edit-box-eraser]');
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
    return {
      selection: box(sel),
      preview: box(prev),
      eraser: box(eraser),
      previewCount: root.querySelectorAll('[data-edit-run-preview]').length,
    };
  });
}

async function dragSelection(dx, dy) {
  const s = await runState();
  if (s.selection === null) throw new Error('no selection to drag');
  const cx = s.selection.l + s.selection.w / 2;
  const cy = s.selection.t + s.selection.h / 2;
  await win.mouse.move(cx, cy);
  await win.mouse.down();
  await win.mouse.move(cx + dx, cy + dy, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(600);
}

async function clickConfirm() {
  await win.locator('[data-content-action="textrun-confirm"]').first().click();
  await win.waitForTimeout(900);
}

/** Count the plain hover previews (the selected surface shares the class). */
async function hoverBoxCount() {
  return win.evaluate(() => {
    const root = document.querySelector('.tab-pane[aria-hidden="false"]') || document;
    const all = [...root.querySelectorAll('.edit-text-hover')];
    return {
      total: all.length,
      plain: all.filter((e) => !e.classList.contains('edit-textrun-selection')).length,
      selected: all.filter((e) => e.classList.contains('edit-textrun-selection')).length,
    };
  });
}

/** Poll the text layer until a span sits near the given viewport point. */
async function waitForTextSpanNear(x, y, timeoutMs = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = await win.evaluate(({ px, py }) => {
      const spans = [...document.querySelectorAll('.tab-pane[aria-hidden="false"] .textLayer span')];
      return spans.some((s) => {
        const r = s.getBoundingClientRect();
        return px >= r.left - 4 && px <= r.right + 4 && py >= r.top - 4 && py <= r.bottom + 4;
      });
    }, { px: x, py: y });
    if (hit) return true;
    await win.waitForTimeout(300);
  }
  return false;
}

test('P52FU-3: after a move the OLD position paints no hover box; the new one does', async () => {
  await launch();
  await openViaDialog(getSamplePath('long.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
  await gotoStage(win, 2);
  await armEditText();
  expect(await selectRun(), 'a text run is selectable').toBe(true);
  await win.waitForTimeout(600);

  const before = await runState();
  console.log(`[P52FU-3 before] ${JSON.stringify(before)}`);
  await dragSelection(60, 30);
  const afterDrag = await runState();
  console.log(`[P52FU-3 afterDrag] ${JSON.stringify(afterDrag)}`);
  expect(afterDrag.preview.l, 'the live drag preview moved right').toBeGreaterThan(before.selection.l + 20);
  expect(afterDrag.preview.t, 'the live drag preview moved down').toBeGreaterThan(before.selection.t + 10);

  await clickConfirm();
  const afterConfirm = await runState();
  console.log(`[P52FU-3 afterConfirm] ${JSON.stringify(afterConfirm)}`);
  expect(afterConfirm.selection, 'the selection closes on Confirm').toBeNull();

  // The old centre (viewport) and the new centre.
  const oldCx = before.selection.l + before.selection.w / 2;
  const oldCy = before.selection.t + before.selection.h / 2;
  const newCx = afterDrag.preview.l + afterDrag.preview.w / 2;
  const newCy = afterDrag.preview.t + afterDrag.preview.h / 2;

  // Wait for the proxy refresh to land the moved text at its new position.
  const refreshed = await waitForTextSpanNear(newCx, newCy);
  console.log(`[P52FU-3 refreshed] ${refreshed}`);
  await win.waitForTimeout(800);
  const afterRefresh = await runState();
  console.log(`[P52FU-3 eraser after refresh] ${JSON.stringify(afterRefresh.eraser)}`);

  // Hover the OLD (now empty) position -> NO box.
  await win.mouse.move(oldCx, oldCy);
  await win.waitForTimeout(500);
  const oldHover = await hoverBoxCount();
  console.log(`[P52FU-3 hover old] ${JSON.stringify(oldHover)}`);
  expect(oldHover.plain, 'no hover box on the empty OLD position').toBe(0);

  // Hover the moved run -> the normal hover preview still works.
  await win.mouse.move(newCx, newCy);
  await win.waitForTimeout(500);
  const newHover = await hoverBoxCount();
  console.log(`[P52FU-3 hover new] ${JSON.stringify(newHover)}`);
  expect(newHover.plain, 'the moved run still hovers').toBe(1);

  await win.screenshot({ path: path.join(SHOTS, 'p52fu-after-move.png') });

  // --- second move: both old positions must be clean ---
  await win.mouse.click(newCx, newCy);
  await win.waitForTimeout(600);
  const beforeSecond = await runState();
  console.log(`[P52FU-3 beforeSecond] ${JSON.stringify(beforeSecond)}`);
  expect(beforeSecond.selection, 'the moved run is re-selectable').not.toBeNull();
  // Move far enough DOWN that the second old rect does not overlap the final
  // live run (the run is ~40px tall; a 20px move would leave the old centre
  // inside the live run and a hover there would legitimately hit the live run).
  await dragSelection(40, 60);
  const afterSecond = await runState();
  console.log(`[P52FU-3 afterSecond] ${JSON.stringify(afterSecond)}`);
  await clickConfirm();
  const secondOldCx = beforeSecond.selection.l + beforeSecond.selection.w / 2;
  const secondOldCy = beforeSecond.selection.t + beforeSecond.selection.h / 2;
  const finalCx = afterSecond.preview.l + afterSecond.preview.w / 2;
  const finalCy = afterSecond.preview.t + afterSecond.preview.h / 2;
  await waitForTextSpanNear(finalCx, finalCy);
  await win.waitForTimeout(800);
  const afterSecondRefresh = await runState();
  console.log(`[P52FU-3 eraser after second refresh] ${JSON.stringify(afterSecondRefresh.eraser)}`);

  await win.mouse.move(oldCx, oldCy);
  await win.waitForTimeout(400);
  const h1 = await hoverBoxCount();
  console.log(`[P52FU-3 hover first-old] ${JSON.stringify(h1)}`);
  expect(h1.plain, 'first old position clean').toBe(0);

  await win.mouse.move(secondOldCx, secondOldCy);
  await win.waitForTimeout(400);
  const h2 = await hoverBoxCount();
  console.log(`[P52FU-3 hover second-old] ${JSON.stringify(h2)}`);
  expect(h2.plain, 'second old position clean').toBe(0);

  await win.mouse.move(finalCx, finalCy);
  await win.waitForTimeout(400);
  const h3 = await hoverBoxCount();
  console.log(`[P52FU-3 hover final] ${JSON.stringify(h3)}`);
  expect(h3.plain, 'the moved run still hovers at its final position').toBe(1);
});

// ---------------------------------------------------------------------------
// Bug 3 - the form overlay must not obscure the page, and fields must sit on
// their TRUE pages over their widgets.
// ---------------------------------------------------------------------------
async function pdfjsWidgetRects(filePath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({
    data,
    password: '',
    isEvalSupported: false,
    useWorkerFetch: false,
    disableFontFace: true,
    verbosity: 0,
  }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const annots = await page.getAnnotations();
    const widgets = annots
      .filter((a) => a.subtype === 'Widget')
      .map((a) => {
        const [x1, y1, x2, y2] = a.rect;
        return {
          x: Math.min(x1, x2),
          y: vp.height - Math.max(y1, y2),
          width: Math.abs(x2 - x1),
          height: Math.abs(y2 - y1),
          fieldName: a.fieldName ?? null,
        };
      });
    pages.push({ page: p, height: vp.height, widgets });
  }
  await doc.destroy();
  return pages;
}

test('P52FU-4: the operator form renders with no dark blocks, fields on true pages', async () => {
  expect(fs.existsSync(OPERATOR_FILE), 'the operator file exists').toBe(true);
  await launch();
  await openViaDialog(OPERATOR_FILE);
  await win.waitForSelector('.pdf-page canvas', { timeout: 60000 });
  await win.waitForTimeout(2500);

  // --- the protection banner is intact ---
  const banner = await win.evaluate(() => {
    const el = document.querySelector('[data-protection-notice]');
    if (!el) return { present: false };
    const r = el.getBoundingClientRect();
    return {
      present: true,
      text: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 160),
      rect: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      algorithm: document.querySelector('[data-protection-algorithm]')?.textContent ?? null,
    };
  });
  console.log(`[P52FU-4 banner] ${JSON.stringify(banner)}`);
  expect(banner.present, 'the protection banner is intact').toBe(true);

  // --- navigate to a page that actually carries fields (page 3) ---
  const pageInput = win.locator('[aria-label="Current page"]').first();
  await pageInput.click();
  await pageInput.fill('3');
  await pageInput.press('Enter');
  await win.waitForTimeout(2000);
  const onPage = await win.evaluate(() => window.tflexDiagnostics().currentPage);
  console.log(`[P52FU-4 currentPage] ${onPage}`);
  expect(onPage, 'navigated to page 3').toBe(3);

  // --- no opaque form-editor fill over the page ---
  const fills = await win.evaluate(() => {
    const read = (sel) => [...document.querySelectorAll(sel)].map((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, border: cs.borderTopColor, w: cs.borderTopWidth };
    });
    return {
      editors: read('.form-editor'),
      checkboxes: read('.form-checkbox'),
      radios: read('.form-radio-dot'),
    };
  });
  console.log(`[P52FU-4 editorCount] ${fills.editors.length} checkboxCount=${fills.checkboxes.length} radioCount=${fills.radios.length}`);
  expect(fills.editors.length, 'form editors render on the field page').toBeGreaterThan(0);
  const opaque = fills.editors.filter((e) => {
    const m = /rgba?\(([^)]+)\)/.exec(e.bg);
    if (!m) return e.bg !== 'transparent';
    const parts = m[1].split(',').map((v) => parseFloat(v));
    const a = parts.length > 3 ? parts[3] : 1;
    return a > 0.15;
  });
  console.log(`[P52FU-4 opaqueEditors] ${JSON.stringify(opaque.slice(0, 5))}`);
  expect(opaque.length, 'no opaque form-editor fill over the page').toBe(0);
  for (const c of fills.checkboxes) {
    const m = /rgba?\(([^)]+)\)/.exec(c.bg);
    const a = m ? (m[1].split(',').length > 3 ? parseFloat(m[1].split(',')[3]) : 1) : (c.bg === 'transparent' ? 0 : 1);
    expect(a, `checkbox fill non-obscuring (${c.bg})`).toBeLessThanOrEqual(0.15);
  }

  // --- engine fields vs pdf.js widget rects ---
  const docId = await win.evaluate(() => window.tflexDiagnostics().engineDocId);
  const engineRes = await win.evaluate((id) => window.tflex.engine.getFormFields(id), docId);
  expect(engineRes.ok, 'getFormFields succeeds').toBe(true);
  const fields = engineRes.value;
  const engineByPage = {};
  for (const f of fields) engineByPage[f.page] = (engineByPage[f.page] ?? 0) + 1;
  console.log(`[P52FU-4 engineFields] total=${fields.length} byPage=${JSON.stringify(engineByPage)}`);

  const pdfPages = await pdfjsWidgetRects(OPERATOR_FILE);
  const pdfByPage = {};
  for (const p of pdfPages) pdfByPage[p.page] = p.widgets.length;
  console.log(`[P52FU-4 pdfjsWidgets] byPage=${JSON.stringify(pdfByPage)}`);

  // The old bug dumped 93 of 105 fields onto page 1. Assert page 1 is NOT
  // the dumping ground and every field page is a page pdf.js also has widgets
  // on. (Engine counts can be LOWER than pdf.js widget counts: a radio group
  // is one field but several widgets.)
  const page1 = engineByPage[1] ?? 0;
  expect(page1, 'page 1 is not the dumping ground').toBeLessThan(fields.length * 0.5);
  for (const [pg, eng] of Object.entries(engineByPage)) {
    const pdf = pdfByPage[pg] ?? 0;
    console.log(`[P52FU-4 page ${pg}] engine=${eng} pdfjs=${pdf}`);
    expect(pdf, `page ${pg}: pdf.js also has widgets there`).toBeGreaterThan(0);
    expect(eng, `page ${pg}: engine fields <= pdf.js widgets`).toBeLessThanOrEqual(pdf);
  }

  // Sample rect comparison: every engine field must match a pdf.js widget on
  // the same page (top-left origin, within 2pt).
  let matched = 0;
  const unmatched = [];
  for (const f of fields) {
    const page = pdfPages.find((p) => p.page === f.page);
    if (!page) { unmatched.push({ name: f.name, page: f.page, reason: 'no pdf page' }); continue; }
    const hit = page.widgets.find((w) =>
      Math.abs(w.x - f.rect.x) <= 2 &&
      Math.abs(w.y - f.rect.y) <= 2 &&
      Math.abs(w.width - f.rect.width) <= 2 &&
      Math.abs(w.height - f.rect.height) <= 2);
    if (hit) matched += 1;
    else unmatched.push({ name: f.name, page: f.page, rect: f.rect });
  }
  console.log(`[P52FU-4 rectMatch] matched=${matched}/${fields.length} unmatched=${JSON.stringify(unmatched.slice(0, 5))}`);
  expect(matched, 'every engine field rect matches a pdf.js widget rect').toBe(fields.length);

  // --- the page renders the document text with no dark blocks ---
  await win.screenshot({ path: path.join(SHOTS, 'p52fu-form-zoom1.png') });

  // Second zoom level.
  await win.locator('[aria-label="Zoom in"]').first().click();
  await win.waitForTimeout(1200);
  await win.locator('[aria-label="Zoom in"]').first().click();
  await win.waitForTimeout(1500);
  const zoom = await win.evaluate(() => document.querySelector('.zoom-percent')?.textContent ?? null);
  console.log(`[P52FU-4 zoom] ${zoom}`);
  await win.screenshot({ path: path.join(SHOTS, 'p52fu-form-zoom2.png') });
});
