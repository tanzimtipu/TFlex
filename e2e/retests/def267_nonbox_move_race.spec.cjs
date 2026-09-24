// DEF-267 FIX-READY retest - the residual non-box move race.
//
// The engine's EditAnnotationPayload now carries `points` (ink), `at`
// (note anchor / callout leader anchor) and `from`+`to` (arrow), validated
// first and applied in place with ONE undo entry. The renderer's
// geometryPatchFor covers every kind and issueMoveCommit's delete+re-create
// fallback is gone. This spec proves, on the REAL Electron app, for EACH of
// ink / arrow / note / callout-anchor:
//   (a) the move is ONE op: the id is unchanged and ONE undo restores the
//       previous geometry with no duplicate;
//   (b) the moved geometry is correct (points / endpoints / at shifted by the
//       drag delta; the callout box rect untouched);
//   (c) it survives save + reopen;
//   (d) a zero-gap style/colour burst right after the move sticks on the
//       same id and keeps the moved geometry.
// Plus the kind-mismatch fail-loud contract via the engine API.
//
// Run: npm.cmd run test:e2e -- e2e/retests/def267_nonbox_move_race.spec.cjs
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose, armAnnotationTool, openSamplePath } = require('../lib/helpers.cjs');

const log = (label, obj) => console.log(`[DEF267|${label}] ${JSON.stringify(obj)}`);
test.setTimeout(240000);

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

const annModels = (win) => win.evaluate(() => {
  const st = window.tflexDiagnostics().engineState;
  if (!st || !st.annotations) return [];
  return st.annotations.map((a) => ({
    id: a.id, kind: a.kind, text: a.text ?? a.content ?? null,
    at: a.at ?? null, points: a.points ?? null,
    from: a.from ?? null, to: a.to ?? null,
    rect: a.rect ?? (a.rects && a.rects[0]) ?? null,
    color: a.color ?? null, style: a.style ?? null,
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

const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
const nearPt = (a, b, tol = 2) => a !== null && b !== null && near(a.x, b.x, tol) && near(a.y, b.y, tol);

const cssScale = (win) => win.evaluate(() => {
  const svg = document.querySelector('.pdf-page[data-page="1"] .annotation-layer svg');
  return svg ? svg.getScreenCTM().a : 1;
});

async function pagePointToClient(win, pt) {
  return win.evaluate((p) => {
    const svg = document.querySelector('.pdf-page[data-page="1"] .annotation-layer svg');
    const m = svg.getScreenCTM();
    return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
  }, pt);
}

async function dragFromClient(win, x, y, dx, dy) {
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dx, y + dy, { steps: 8 });
  await win.mouse.up();
}

async function dragPagePoint(win, pt, dx, dy) {
  const c = await pagePointToClient(win, pt);
  await dragFromClient(win, c.x, c.y, dx, dy);
}

async function dragBoxCenter(win, selector, dx, dy) {
  const bb = await win.locator(selector).first().boundingBox();
  if (bb === null) throw new Error(`no bounding box for ${selector}`);
  await dragFromClient(win, bb.x + bb.width / 2, bb.y + bb.height / 2, dx, dy);
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

async function closeAndReopen(app, win, savePath) {
  await win.locator('.tab-active .tab-close').click();
  await win.waitForTimeout(1500);
  await openSamplePath(win, app, savePath);
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(2000);
}

async function undoOnce(win) {
  // Phase 36 — the rail's "Undo last change" button is retired; the engine
  // undo chord (Ctrl+Z) is the current home.
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(600);
}

/** Zero-gap colour burst on the selected annotation's action-bar colour box:
 *  open the popover, then dispatch both swatch clicks in ONE synchronous task
 *  (no settle between them). */
async function colourBurst(win, barKind, names) {
  await win.waitForSelector(`[data-content-action-bar="${barKind}"]`, { timeout: 8000 });
  await win.click(`[data-content-action-bar="${barKind}"] [data-ann-color-box]`);
  await win.waitForSelector(`.color-popover [data-palette-built-in="${names[0]}"]`, { timeout: 8000 });
  await win.evaluate((ns) => {
    for (const n of ns) {
      const el = document.querySelector(`.color-popover [data-palette-built-in="${n}"]`);
      if (el === null) continue;
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  }, names);
}

// ---------------------------------------------------------------------------
// Placement helpers (one per movable kind)

async function placeInk(win, fx, fy) {
  await armAnnotationTool(win, 'ink');
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const x = pg.x + pg.width * fx, y = pg.y + pg.height * fy;
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + 120, y + 70, { steps: 10 });
  await win.mouse.up();
  const ink = await waitForAnn(win, (a) => a.kind === 'ink' && a.points && a.points.length >= 2, 15000);
  expect(ink, 'ink placed').toBeTruthy();
  return ink;
}

async function placeArrow(win, fx, fy) {
  await armAnnotationTool(win, 'arrow');
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const x = pg.x + pg.width * fx, y = pg.y + pg.height * fy;
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + 200, y + 110, { steps: 10 });
  await win.mouse.up();
  const arrow = await waitForAnn(win, (a) => a.kind === 'arrow' && a.from && a.to, 15000);
  expect(arrow, 'arrow placed').toBeTruthy();
  return arrow;
}

async function placeNote(win, text, fx, fy) {
  await armAnnotationTool(win, 'note');
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  await win.mouse.click(pg.x + pg.width * fx, pg.y + pg.height * fy);
  await fillPanelText(win, text);
  const note = await waitForAnn(win, (a) => a.kind === 'note' && a.text === text, 20000);
  expect(note, `note ${text} placed`).toBeTruthy();
  return note;
}

async function placeCallout(win, text, fx, fy) {
  await armAnnotationTool(win, 'callout');
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const x = pg.x + pg.width * fx, y = pg.y + pg.height * fy;
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + 180, y + 60, { steps: 10 });
  await win.mouse.up();
  await fillPanelText(win, text);
  const co = await waitForAnn(win, (a) => a.kind === 'callout' && a.text === text, 20000);
  expect(co, `callout ${text} placed`).toBeTruthy();
  return co;
}

// ===========================================================================
// INK - one `{ points }` op, geometry shifted, burst, save+reopen
// ===========================================================================
test('DEF-267 ink: move is ONE op, points shift, burst sticks, save+reopen', async () => {
  await withApp(async (win, pageErrors, app) => {
    await openReport(app, win);
    const ink = await placeInk(win, 0.3, 0.3);
    const id = ink.id;
    const orig = ink.points;
    const scale = await cssScale(win);
    const dx = 70, dy = 45;
    const dpx = dx / scale, dpy = dy / scale;
    const mid = { x: (orig[0].x + orig[orig.length - 1].x) / 2, y: (orig[0].y + orig[orig.length - 1].y) / 2 };

    await dragPagePoint(win, mid, dx, dy);
    const moved = await waitForAnn(win, (a) => a.id === id && a.points
      && near(a.points[0].x, orig[0].x + dpx) && near(a.points[0].y, orig[0].y + dpy), 15000);
    log('ink-moved', { id, orig0: orig[0], moved0: moved && moved.points[0], dpx: +dpx.toFixed(2), dpy: +dpy.toFixed(2) });
    expect(moved, 'ink move committed').toBeTruthy();
    expect(moved.id, 'id unchanged (no re-create)').toBe(id);
    expect((await annModels(win)).filter((a) => a.kind === 'ink').length, 'exactly one ink after the move').toBe(1);
    for (let i = 0; i < orig.length; i++) {
      expect(near(moved.points[i].x, orig[i].x + dpx), `point ${i}.x shifted`).toBe(true);
      expect(near(moved.points[i].y, orig[i].y + dpy), `point ${i}.y shifted`).toBe(true);
    }

    await undoOnce(win);
    const restored = await waitForAnn(win, (a) => a.id === id && a.points
      && near(a.points[0].x, orig[0].x) && near(a.points[0].y, orig[0].y), 15000);
    const afterUndo = (await annModels(win)).filter((a) => a.kind === 'ink');
    log('ink-undo', { restored: restored !== null, count: afterUndo.length });
    expect(restored, 'ONE undo restored the original stroke').toBeTruthy();
    expect(afterUndo.length, 'one undo left exactly one ink (no duplicate)').toBe(1);

    await dragPagePoint(win, mid, dx, dy);
    const moved2 = await waitForAnn(win, (a) => a.id === id && a.points
      && near(a.points[0].x, orig[0].x + dpx) && near(a.points[0].y, orig[0].y + dpy), 15000);
    expect(moved2, 're-move committed').toBeTruthy();

    await colourBurst(win, 'ann-ink', ['green', 'blue']);
    const burst = await waitForAnn(win, (a) => a.id === id && a.color === 'blue', 10000);
    log('ink-burst', { color: burst && burst.color, points0: burst && burst.points && burst.points[0] });
    expect(burst, 'the burst colour stuck on the same id').toBeTruthy();
    expect(burst.id, 'burst kept the id').toBe(id);
    expect(near(burst.points[0].x, orig[0].x + dpx), 'burst kept the moved stroke').toBe(true);
    expect((await annModels(win)).filter((a) => a.kind === 'ink').length, 'still one ink').toBe(1);

    const savePath = path.join(os.tmpdir(), `def267-ink-${Date.now()}.pdf`);
    await saveAs(app, win, savePath);
    await closeAndReopen(app, win, savePath);
    const reopened = await waitForAnn(win, (a) => a.kind === 'ink'
      && a.points && near(a.points[0].x, orig[0].x + dpx) && near(a.points[0].y, orig[0].y + dpy), 20000);
    log('ink-reopen', { points0: reopened && reopened.points && reopened.points[0] });
    expect(reopened, 'moved ink persisted through save+reopen').toBeTruthy();
    expect(pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, 'def267-ink');
});

// ===========================================================================
// ARROW - one `{ from, to }` op, both endpoints shifted, burst, save+reopen
// ===========================================================================
test('DEF-267 arrow: move is ONE op, both endpoints shift, burst sticks, save+reopen', async () => {
  await withApp(async (win, pageErrors, app) => {
    await openReport(app, win);
    const arrow = await placeArrow(win, 0.25, 0.25);
    const id = arrow.id;
    const origFrom = arrow.from, origTo = arrow.to;
    const scale = await cssScale(win);
    const dx = 80, dy = 50;
    const dpx = dx / scale, dpy = dy / scale;
    const mid = { x: (origFrom.x + origTo.x) / 2, y: (origFrom.y + origTo.y) / 2 };

    await dragPagePoint(win, mid, dx, dy);
    const moved = await waitForAnn(win, (a) => a.id === id && a.from && a.to
      && near(a.from.x, origFrom.x + dpx) && near(a.to.y, origTo.y + dpy), 15000);
    log('arrow-moved', { id, from: moved && moved.from, to: moved && moved.to, dpx: +dpx.toFixed(2), dpy: +dpy.toFixed(2) });
    expect(moved, 'arrow move committed').toBeTruthy();
    expect(moved.id, 'id unchanged (no re-create)').toBe(id);
    expect((await annModels(win)).filter((a) => a.kind === 'arrow').length, 'exactly one arrow after the move').toBe(1);
    expect(nearPt(moved.from, { x: origFrom.x + dpx, y: origFrom.y + dpy }), 'from shifted by the delta').toBe(true);
    expect(nearPt(moved.to, { x: origTo.x + dpx, y: origTo.y + dpy }), 'to shifted by the delta').toBe(true);

    await undoOnce(win);
    const restored = await waitForAnn(win, (a) => a.id === id && a.from && a.to
      && nearPt(a.from, origFrom) && nearPt(a.to, origTo), 15000);
    const afterUndo = (await annModels(win)).filter((a) => a.kind === 'arrow');
    log('arrow-undo', { restored: restored !== null, count: afterUndo.length });
    expect(restored, 'ONE undo restored both original endpoints').toBeTruthy();
    expect(afterUndo.length, 'one undo left exactly one arrow (no duplicate)').toBe(1);

    await dragPagePoint(win, mid, dx, dy);
    const moved2 = await waitForAnn(win, (a) => a.id === id && a.from && a.to
      && near(a.from.x, origFrom.x + dpx) && near(a.to.y, origTo.y + dpy), 15000);
    expect(moved2, 're-move committed').toBeTruthy();

    await colourBurst(win, 'ann-arrow', ['green', 'blue']);
    const burst = await waitForAnn(win, (a) => a.id === id && a.color === 'blue', 10000);
    log('arrow-burst', { color: burst && burst.color, from: burst && burst.from, to: burst && burst.to });
    expect(burst, 'the burst colour stuck on the same id').toBeTruthy();
    expect(burst.id, 'burst kept the id').toBe(id);
    expect(nearPt(burst.from, { x: origFrom.x + dpx, y: origFrom.y + dpy }), 'burst kept the moved from').toBe(true);
    expect(nearPt(burst.to, { x: origTo.x + dpx, y: origTo.y + dpy }), 'burst kept the moved to').toBe(true);
    expect((await annModels(win)).filter((a) => a.kind === 'arrow').length, 'still one arrow').toBe(1);

    const savePath = path.join(os.tmpdir(), `def267-arrow-${Date.now()}.pdf`);
    await saveAs(app, win, savePath);
    await closeAndReopen(app, win, savePath);
    const reopened = await waitForAnn(win, (a) => a.kind === 'arrow' && a.from && a.to
      && near(a.from.x, origFrom.x + dpx) && near(a.to.y, origTo.y + dpy), 20000);
    log('arrow-reopen', { from: reopened && reopened.from, to: reopened && reopened.to });
    expect(reopened, 'moved arrow persisted through save+reopen').toBeTruthy();
    expect(pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, 'def267-arrow');
});

// ===========================================================================
// NOTE - one `{ at }` op, anchor shifted, panel-style burst, save+reopen
// ===========================================================================
test('DEF-267 note: move is ONE op, at shifts, style burst sticks, save+reopen', async () => {
  await withApp(async (win, pageErrors, app) => {
    await openReport(app, win);
    const note = await placeNote(win, 'DEF267-NOTE', 0.4, 0.3);
    const id = note.id;
    const origAt = note.at;
    const scale = await cssScale(win);
    const dx = 60, dy = 40;
    const dpx = dx / scale, dpy = dy / scale;
    const sel = `.ann-note[data-annotation-id="${id}"]`;

    await dragBoxCenter(win, sel, dx, dy);
    const moved = await waitForAnn(win, (a) => a.id === id && a.at
      && near(a.at.x, origAt.x + dpx) && near(a.at.y, origAt.y + dpy), 15000);
    log('note-moved', { id, at0: origAt, at1: moved && moved.at, dpx: +dpx.toFixed(2), dpy: +dpy.toFixed(2) });
    expect(moved, 'note move committed').toBeTruthy();
    expect(moved.id, 'id unchanged (no re-create)').toBe(id);
    expect((await annModels(win)).filter((a) => a.kind === 'note').length, 'exactly one note after the move').toBe(1);
    expect(nearPt(moved.at, { x: origAt.x + dpx, y: origAt.y + dpy }), 'at shifted by the delta').toBe(true);

    await undoOnce(win);
    const restored = await waitForAnn(win, (a) => a.id === id && a.at && nearPt(a.at, origAt), 15000);
    const afterUndo = (await annModels(win)).filter((a) => a.kind === 'note');
    log('note-undo', { restored: restored !== null, count: afterUndo.length });
    expect(restored, 'ONE undo restored the original anchor').toBeTruthy();
    expect(afterUndo.length, 'one undo left exactly one note (no duplicate)').toBe(1);

    await dragBoxCenter(win, sel, dx, dy);
    const moved2 = await waitForAnn(win, (a) => a.id === id && a.at
      && near(a.at.x, origAt.x + dpx) && near(a.at.y, origAt.y + dpy), 15000);
    expect(moved2, 're-move committed').toBeTruthy();

    // Zero-gap panel-style burst: four real click events in ONE synchronous task.
    await win.waitForSelector('[data-txt-bold]', { timeout: 8000 });
    await win.evaluate((sels) => {
      for (const s of sels) {
        const el = document.querySelector(s);
        if (el === null) continue;
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    }, ['[data-txt-bold]', '[data-txt-align-center]', '[data-txt-list-bullet]', '[data-txt-indent-inc]']);
    const burst = await waitForAnn(win, (a) => a.id === id && a.style
      && a.style.bold === true && a.style.align === 'center'
      && a.style.list === 'bullet' && a.style.indent === 12, 12000);
    log('note-burst', { style: burst && burst.style, at: burst && burst.at });
    expect(burst, 'all four burst fields stuck on the same id').toBeTruthy();
    expect(burst.id, 'burst kept the id').toBe(id);
    expect(nearPt(burst.at, { x: origAt.x + dpx, y: origAt.y + dpy }), 'burst kept the moved anchor').toBe(true);
    expect((await annModels(win)).filter((a) => a.kind === 'note').length, 'still one note').toBe(1);

    const savePath = path.join(os.tmpdir(), `def267-note-${Date.now()}.pdf`);
    await saveAs(app, win, savePath);
    await closeAndReopen(app, win, savePath);
    const reopened = await waitForAnn(win, (a) => a.kind === 'note' && a.at
      && near(a.at.x, origAt.x + dpx) && near(a.at.y, origAt.y + dpy), 20000);
    log('note-reopen', { at: reopened && reopened.at });
    expect(reopened, 'moved note persisted through save+reopen').toBeTruthy();
    expect(pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, 'def267-note');
});

// ===========================================================================
// CALLOUT ANCHOR - one `{ at }` op, anchor shifted, box rect untouched,
// burst, save+reopen
// ===========================================================================
test('DEF-267 callout anchor: move is ONE op, at shifts, rect stays, burst sticks, save+reopen', async () => {
  await withApp(async (win, pageErrors, app) => {
    await openReport(app, win);
    const co = await placeCallout(win, 'DEF267-CALLOUT', 0.3, 0.45);
    const id = co.id;
    const origAt = co.at, origRect = co.rect;
    const scale = await cssScale(win);
    const dx = 55, dy = 35;
    const dpx = dx / scale, dpy = dy / scale;
    const hit = `.ann-callout-arrow[data-annotation-id="${id}"] .ann-callout-arrow-hit`;

    await dragBoxCenter(win, hit, dx, dy);
    const moved = await waitForAnn(win, (a) => a.id === id && a.at
      && near(a.at.x, origAt.x + dpx) && near(a.at.y, origAt.y + dpy), 15000);
    log('callout-moved', { id, at0: origAt, at1: moved && moved.at, rect: moved && moved.rect, dpx: +dpx.toFixed(2), dpy: +dpy.toFixed(2) });
    expect(moved, 'callout anchor move committed').toBeTruthy();
    expect(moved.id, 'id unchanged (no re-create)').toBe(id);
    expect((await annModels(win)).filter((a) => a.kind === 'callout').length, 'exactly one callout after the move').toBe(1);
    expect(nearPt(moved.at, { x: origAt.x + dpx, y: origAt.y + dpy }), 'anchor shifted by the delta').toBe(true);
    expect(nearPt(moved.rect, origRect), 'the callout box rect stayed put').toBe(true);

    await undoOnce(win);
    const restored = await waitForAnn(win, (a) => a.id === id && a.at && nearPt(a.at, origAt), 15000);
    const afterUndo = (await annModels(win)).filter((a) => a.kind === 'callout');
    log('callout-undo', { restored: restored !== null, count: afterUndo.length });
    expect(restored, 'ONE undo restored the original anchor').toBeTruthy();
    expect(afterUndo.length, 'one undo left exactly one callout (no duplicate)').toBe(1);

    await dragBoxCenter(win, hit, dx, dy);
    const moved2 = await waitForAnn(win, (a) => a.id === id && a.at
      && near(a.at.x, origAt.x + dpx) && near(a.at.y, origAt.y + dpy), 15000);
    expect(moved2, 're-move committed').toBeTruthy();

    await colourBurst(win, 'ann-callout', ['green', 'blue']);
    const burst = await waitForAnn(win, (a) => a.id === id && a.color === 'blue', 10000);
    log('callout-burst', { color: burst && burst.color, at: burst && burst.at });
    expect(burst, 'the burst colour stuck on the same id').toBeTruthy();
    expect(burst.id, 'burst kept the id').toBe(id);
    expect(nearPt(burst.at, { x: origAt.x + dpx, y: origAt.y + dpy }), 'burst kept the moved anchor').toBe(true);
    expect((await annModels(win)).filter((a) => a.kind === 'callout').length, 'still one callout').toBe(1);

    const savePath = path.join(os.tmpdir(), `def267-callout-${Date.now()}.pdf`);
    await saveAs(app, win, savePath);
    await closeAndReopen(app, win, savePath);
    const reopened = await waitForAnn(win, (a) => a.kind === 'callout' && a.at
      && near(a.at.x, origAt.x + dpx) && near(a.at.y, origAt.y + dpy), 20000);
    log('callout-reopen', { at: reopened && reopened.at, rect: reopened && reopened.rect });
    expect(reopened, 'moved callout anchor persisted through save+reopen').toBeTruthy();
    expect(pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, 'def267-callout');
});

// ===========================================================================
// KIND-MISMATCH - points on a note / from+to on a rect fail loud, nothing
// mutated, no undo entry
// ===========================================================================
test('DEF-267 kind-mismatch: points on a note / from+to on a rect reject loud, no mutation, no undo entry', async () => {
  await withApp(async (win, pageErrors, app) => {
    await openReport(app, win);
    const docId = await win.evaluate(() => window.tflexDiagnostics().engineDocId);
    const engineAnns = () => win.evaluate(({ d }) => window.tflex.engine.getState(d).then((r) => (r.ok ? r.value.annotations : [])), { d: docId });

    const noteRes = await win.evaluate(({ d }) => window.tflex.engine.createAnnotation(d, {
      id: 'def267-mm-note', kind: 'note', page: 1, color: 'yellow', at: { x: 120, y: 140 }, text: 'MM-NOTE',
    }), { d: docId });
    const rectRes = await win.evaluate(({ d }) => window.tflex.engine.createAnnotation(d, {
      id: 'def267-mm-rect', kind: 'rect', page: 1, color: 'red', rect: { x: 260, y: 260, width: 90, height: 50 },
    }), { d: docId });
    expect(noteRes.ok, 'note created via engine API').toBe(true);
    expect(rectRes.ok, 'rect created via engine API').toBe(true);
    await win.waitForTimeout(400);

    const before = await engineAnns();
    const noteBefore = before.find((a) => a.id === 'def267-mm-note');
    const rectBefore = before.find((a) => a.id === 'def267-mm-rect');
    expect(noteBefore && noteBefore.at, 'note at before').toBeTruthy();
    expect(rectBefore && rectBefore.rects && rectBefore.rects[0], 'rect before').toBeTruthy();

    const pointsOnNote = await win.evaluate(({ d }) => window.tflex.engine.editAnnotation(d, 'def267-mm-note', { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }), { d: docId });
    const fromToOnRect = await win.evaluate(({ d }) => window.tflex.engine.editAnnotation(d, 'def267-mm-rect', { from: { x: 1, y: 1 }, to: { x: 2, y: 2 } }), { d: docId });
    log('mismatch', { pointsOnNote, fromToOnRect });
    expect(pointsOnNote.ok, 'points on a note rejected').toBe(false);
    expect(pointsOnNote.error && pointsOnNote.error.code, 'typed engine-error').toBe('engine-error');
    expect(String(pointsOnNote.error && pointsOnNote.error.message), 'names points').toMatch(/points/);
    expect(String(pointsOnNote.error && pointsOnNote.error.message), 'names the note kind').toMatch(/note/);
    expect(fromToOnRect.ok, 'from/to on a rect rejected').toBe(false);
    expect(fromToOnRect.error && fromToOnRect.error.code, 'typed engine-error').toBe('engine-error');
    expect(String(fromToOnRect.error && fromToOnRect.error.message), 'names from/to').toMatch(/from\/to/);
    expect(String(fromToOnRect.error && fromToOnRect.error.message), 'names the rect kind').toMatch(/rect/);

    const after = await engineAnns();
    const noteAfter = after.find((a) => a.id === 'def267-mm-note');
    const rectAfter = after.find((a) => a.id === 'def267-mm-rect');
    expect(nearPt(noteAfter.at, noteBefore.at), 'note at unchanged').toBe(true);
    expect(nearPt(rectAfter.rects[0], rectBefore.rects[0]), 'rect unchanged').toBe(true);

    // No undo entry: one undo removes the LAST real op (the rect create),
    // leaving the note. A failed edit that pushed a snapshot would make the
    // first undo a no-op and the rect would survive.
    const undo = await win.evaluate(({ d }) => window.tflex.engine.undo(d), { d: docId });
    expect(undo.ok, 'undo ok').toBe(true);
    await win.waitForTimeout(400);
    const afterUndo = await engineAnns();
    log('mismatch-undo', { ids: afterUndo.map((a) => a.id) });
    expect(afterUndo.find((a) => a.id === 'def267-mm-rect'), 'one undo removed the rect (failed edits added no entry)').toBeUndefined();
    expect(afterUndo.find((a) => a.id === 'def267-mm-note'), 'the note survives').toBeTruthy();
    expect(pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, 'def267-mismatch');
});