// Phase 30 focused QA verification - the rect-op switch.
//
// The dev's change makes annotation auto-grow, the style-patch-with-grow and
// the committed MOVE persist geometry through ONE `editAnnotation({ rect })`
// op (no delete + create pair). This spec proves it on the REAL Electron app:
//
//   T1  grow a multi-line annotation, then burst-toggle bold + align + list +
//       indent with NO settle delay (back-to-back, synchronous dispatch) ->
//       all four stick on the SAME annotation id.
//   T2  move a rect annotation -> ONE op (same id, still exactly one rect),
//       ONE undo entry restores the original rect, then save + reopen keeps
//       the moved geometry.
//
// Run: npm.cmd run test:e2e -- e2e/phase30_rect_geometry_switch.spec.cjs
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, armAnnotationTool, openSamplePath } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const log = (label, obj) => console.log(`[P30|${label}] ${JSON.stringify(obj)}`);

const LONG_TEXT = 'The quick brown fox jumps over the lazy dog and keeps running far away';
const BURST = ['[data-txt-bold]', '[data-txt-align-center]', '[data-txt-list-bullet]', '[data-txt-indent-inc]'];

test.describe.configure({ mode: 'serial' });
test.setTimeout(300000);

async function withApp(fn, label) {
  const app = await launchApp([], null, null);
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  await win.waitForSelector('.sample-card', { timeout: 40000 });
  try {
    return await fn(win, pageErrors, app);
  } finally {
    await hardClose(app, label);
  }
}

async function openReport(app, win) {
  await openSamplePath(win, app, getSamplePath('report.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(600);
}

async function dragOnPage(win, fx, fy, dxPx = 190, dyPx = 60) {
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 240));
  const y = Math.max(40, Math.min(pg.y + pg.height * fy, vp.h - 110));
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dxPx, y + dyPx, { steps: 6 });
  await win.mouse.up();
  return { x, y };
}

const annModels = (win) => win.evaluate(() => {
  const st = window.tflexDiagnostics().engineState;
  if (!st || !st.annotations) return [];
  return st.annotations.map((a) => ({
    id: a.id, kind: a.kind, page: a.page, text: a.text ?? a.content ?? null,
    rect: a.rect ?? null, style: a.style ?? null, color: a.color ?? null,
  }));
});

async function waitForAnn(win, pred, timeout = 15000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    last = (await annModels(win)).find(pred) ?? last;
    if (last !== null && pred(last)) return last;
    await win.waitForTimeout(150);
  }
  return last;
}

async function fillPanelText(win, text) {
  await win.waitForSelector('.text-props-panel [data-txt-text]', { timeout: 15000 });
  await win.waitForFunction(() => {
    const ta = document.querySelector('[data-txt-text]');
    return ta !== null && ta.disabled === false;
  }, null, { timeout: 15000 });
  await win.locator('[data-txt-text]').fill(text);
  await win.locator('[data-txt-text]').blur();
}

async function saveAs(app, win, savePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-confirm]', { timeout: 8000 });
  await win.click('[data-save-as-confirm]');
  await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 40000 });
  expect(fs.existsSync(savePath), 'saved PDF exists on disk').toBe(true);
}

// ===========================================================================
// T1 - grow then a zero-gap style burst on the SAME annotation id
// ===========================================================================
test('T1: multi-line grow + zero-gap bold/align/list/indent burst sticks on one id', async () => {
  await withApp(async (win, pageErrors, app) => {
    await openReport(app, win);
    await armAnnotationTool(win, 'textbox');
    await dragOnPage(win, 0.3, 0.22, 190, 60);

    // The placement creates the annotation (empty) and focuses the panel field.
    const placed = await waitForAnn(win, (a) => a.kind === 'textbox', 15000);
    expect(placed, 'textbox placed').toBeTruthy();
    const idBefore = placed.id;
    const placedRect = placed.rect;
    log('t1-placed', { id: idBefore, rect: placedRect });

    await fillPanelText(win, LONG_TEXT);
    const grown = await waitForAnn(
      win,
      (a) => a.id === idBefore && a.text === LONG_TEXT && a.rect
        && a.rect.height > placedRect.height + 1,
      20000,
    );
    expect(grown, 'multi-line commit grew the box in place').toBeTruthy();
    log('t1-grown', { id: grown.id, rect: grown.rect });

    // Zero-gap burst: four real click events dispatched in ONE synchronous
    // task, no await / settle between them.
    await win.evaluate((sels) => {
      for (const s of sels) {
        const b = document.querySelector(s);
        if (b === null) throw new Error(`missing ${s}`);
        b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    }, BURST);

    const stuck = await waitForAnn(
      win,
      (a) => a.id === idBefore && a.style
        && a.style.bold === true && a.style.align === 'center'
        && a.style.list === 'bullet' && a.style.indent === 12,
      15000,
    );
    const after = (await annModels(win)).filter((a) => a.kind === 'textbox');
    log('t1-after', { id: stuck && stuck.id, style: stuck && stuck.style, count: after.length });
    expect(stuck, 'all four burst fields stuck').toBeTruthy();
    expect(stuck.id, 'same annotation id before/after the burst').toBe(idBefore);
    expect(after.length, 'still exactly one textbox (no re-create)').toBe(1);
    expect(after[0].id, 'the surviving textbox is the original id').toBe(idBefore);
    expect(await win.locator(`.ann-textbox[data-annotation-id="${idBefore}"]`).count()).toBe(1);

    await win.screenshot({ path: path.join(SHOTS, 'phase30-burst-styles.png') });
    expect(pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, 'p30-t1');
});

// ===========================================================================
// T2 - the committed rect MOVE is ONE op; one undo restores it; reopen keeps it
// ===========================================================================
test('T2: rect move is ONE op, one undo restores it, save+reopen persists', async () => {
  await withApp(async (win, pageErrors, app) => {
    await openReport(app, win);
    await armAnnotationTool(win, 'rect');
    await dragOnPage(win, 0.3, 0.3, 180, 80);
    const placed = await waitForAnn(win, (a) => a.kind === 'rect', 15000);
    expect(placed, 'rect placed').toBeTruthy();
    const id = placed.id;
    const orig = placed.rect;
    log('t2-placed', { id, rect: orig });

    const shapeSel = `.ann-shape[data-kind="rect"][data-annotation-id="${id}"]`;
    await win.waitForTimeout(500);
    const bb = await win.locator(shapeSel).boundingBox();
    await win.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.mouse.down();
    await win.mouse.move(bb.x + bb.width / 2 + 90, bb.y + bb.height / 2 + 50, { steps: 8 });
    await win.mouse.up();

    const moved = await waitForAnn(win, (a) => a.id === id && a.rect
      && (Math.abs(a.rect.x - orig.x) > 1 || Math.abs(a.rect.y - orig.y) > 1), 15000);
    expect(moved, 'move committed').toBeTruthy();
    const rects = (await annModels(win)).filter((a) => a.kind === 'rect');
    log('t2-moved', { id: moved.id, rect: moved.rect, count: rects.length });
    expect(moved.id, 'the move kept the id (no delete+create)').toBe(id);
    expect(rects.length, 'exactly one rect after the move').toBe(1);
    expect(rects[0].id, 'the surviving rect is the original id').toBe(id);

    // ONE undo entry restores the original rect. A delete + create pair would
    // need TWO undos (and the first would resurrect a duplicate), so a single
    // undo returning the original id + geometry proves the one-op switch.
    await win.locator('button[aria-label="Undo last change"]').first().click();
    const reverted = await waitForAnn(win, (a) => a.id === id && a.rect
      && Math.abs(a.rect.x - orig.x) < 1.5 && Math.abs(a.rect.y - orig.y) < 1.5
      && Math.abs(a.rect.width - orig.width) < 1.5
      && Math.abs(a.rect.height - orig.height) < 1.5, 15000);
    const afterUndo = (await annModels(win)).filter((a) => a.kind === 'rect');
    log('t2-undo', { rect: reverted && reverted.rect, count: afterUndo.length });
    expect(reverted, 'ONE undo restored the original rect').toBeTruthy();
    expect(afterUndo.length, 'one undo left exactly one rect (no duplicate)').toBe(1);

    // Re-apply the move and prove it survives save + reopen.
    const bb2 = await win.locator(shapeSel).boundingBox();
    await win.mouse.move(bb2.x + bb2.width / 2, bb2.y + bb2.height / 2);
    await win.mouse.down();
    await win.mouse.move(bb2.x + bb2.width / 2 + 90, bb2.y + bb2.height / 2 + 50, { steps: 8 });
    await win.mouse.up();
    const moved2 = await waitForAnn(win, (a) => a.id === id && a.rect
      && (Math.abs(a.rect.x - orig.x) > 1 || Math.abs(a.rect.y - orig.y) > 1), 15000);
    expect(moved2, 're-move committed').toBeTruthy();

    const savePath = path.join(os.tmpdir(), `p30-rect-${Date.now()}.pdf`);
    await saveAs(app, win, savePath);
    await win.locator('.tab-active .tab-close').click();
    await win.waitForTimeout(1500);
    await openSamplePath(win, app, savePath);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(2000);

    const reopened = await waitForAnn(win, (a) => a.kind === 'rect'
      && Math.abs(a.rect.x - moved2.rect.x) < 2 && Math.abs(a.rect.y - moved2.rect.y) < 2, 20000);
    log('t2-reopen', { rect: reopened && reopened.rect, moved: moved2.rect });
    expect(reopened, 'moved rect persisted through save+reopen').toBeTruthy();

    expect(pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, 'p30-t2');
});
