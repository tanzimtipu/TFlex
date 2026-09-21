// DEF-267 repro attempt - the residual non-box move race.
//
// ink / arrow / note (and the callout ANCHOR) still persist geometry via
// delete + re-create because `EditAnnotationPayload` has no patch for
// `points` / `at` / `from` / `to`. A style click that lands in the async gap
// between the delete echo and the create echo can be routed to an id the
// engine no longer holds, dropping the field. LOW: needs a sub-millisecond
// burst right after the move; at normal speed the style applies.
//
// Evidence gathered here:
//   (1) undo-based op count for a note move (delete + create = 2 ops; one op
//       would restore in a single undo).
//   (2) realistic speed: move -> click bold -> does it stick?
//   (3) tight bursts on a FRESH note (bold toggles, so a fresh note avoids a
//       false "drop"): (3a) burst immediately after the awaited pointerup,
//       (3b) burst in the SAME in-page task as a synthetic drag.
//
// Run: npm.cmd run test:e2e -- e2e/retests/def267_nonbox_move_race.spec.cjs
const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose, armAnnotationTool, openSamplePath } = require('../lib/helpers.cjs');

const log = (label, obj) => console.log(`[DEF267|${label}] ${JSON.stringify(obj)}`);
test.setTimeout(180000);

async function withApp(fn, label) {
  const app = await launchApp([], null, null);
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 40000 });
  try {
    return await fn(win, app);
  } finally {
    await hardClose(app, label);
  }
}

const annModels = (win) => win.evaluate(() => {
  const st = window.tflexDiagnostics().engineState;
  if (!st || !st.annotations) return [];
  return st.annotations.map((a) => ({
    id: a.id, kind: a.kind, text: a.text ?? a.content ?? null,
    at: a.at ?? null, style: a.style ?? null,
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

async function openReport(app, win) {
  await openSamplePath(win, app, getSamplePath('report.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(600);
}

async function placeNote(win, text, fx, fy) {
  await armAnnotationTool(win, 'note');
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  await win.mouse.click(pg.x + pg.width * fx, pg.y + pg.height * fy);
  await win.waitForSelector('[data-txt-text]', { timeout: 15000 });
  await win.waitForFunction(() => {
    const ta = document.querySelector('[data-txt-text]');
    return ta !== null && ta.disabled === false;
  }, null, { timeout: 15000 });
  await win.locator('[data-txt-text]').fill(text);
  await win.locator('[data-txt-text]').blur();
  const note = await waitForAnn(win, (a) => a.kind === 'note' && a.text === text, 20000);
  expect(note, `note ${text} placed`).toBeTruthy();
  return note;
}

async function dragNote(win, id, dx = 45, dy = 45) {
  const bb = await win.locator(`.ann-note[data-annotation-id="${id}"]`).boundingBox();
  const x = bb.x + bb.width / 2;
  const y = bb.y + bb.height / 2;
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dx, y + dy, { steps: 6 });
  await win.mouse.up();
}

const BURST = ['[data-txt-bold]', '[data-txt-align-center]', '[data-txt-list-bullet]', '[data-txt-indent-inc]'];
const EXPECT = { bold: true, align: 'center', list: 'bullet', indent: 12 };
const missingOf = (a) => Object.entries(EXPECT).filter(([k, v]) => !(a && a.style && a.style[k] === v)).map(([k]) => k);

test('DEF-267: note move op count + realistic + tight bursts', async () => {
  await withApp(async (win, app) => {
    await openReport(app, win);

    // ---- (1) op count via undo -------------------------------------------
    const a = await placeNote(win, 'DEF267-A', 0.4, 0.3);
    const at0 = a.at;
    await dragNote(win, a.id);
    const moved = await waitForAnn(win, (x) => x.id === a.id && x.at
      && (Math.abs(x.at.x - at0.x) > 1 || Math.abs(x.at.y - at0.y) > 1), 8000);
    log('move', { id: a.id, at0, at1: moved && moved.at });
    await win.locator('button[aria-label="Undo last change"]').first().click();
    await win.waitForTimeout(1500);
    const afterUndo = (await annModels(win)).filter((x) => x.kind === 'note');
    const restored = afterUndo.find((x) => x.at
      && Math.abs(x.at.x - at0.x) < 1.5 && Math.abs(x.at.y - at0.y) < 1.5);
    log('undo1', { notes: afterUndo.length, restored: restored !== undefined });
    console.log(`[DEF267] undo1 notes=${afterUndo.length} restored=${restored !== undefined} -> ${afterUndo.length === 1 && restored !== undefined ? 'ONE-OP' : 'DELETE+CREATE (2 ops)'}`);

    // ---- (2) realistic speed --------------------------------------------
    await placeNote(win, 'DEF267-B', 0.5, 0.35);
    const b = await waitForAnn(win, (x) => x.kind === 'note' && x.text === 'DEF267-B', 8000);
    await dragNote(win, b.id);
    await win.click('[data-txt-bold]');
    const realistic = await waitForAnn(win, (x) => x.id === b.id && x.style && x.style.bold === true, 6000);
    log('realistic', { boldStuck: realistic !== null });
    console.log(`[DEF267] realisticBoldStuck=${realistic !== null}`);

    // ---- (3a) tight burst right after the awaited pointerup -------------
    const c = await placeNote(win, 'DEF267-C', 0.35, 0.45);
    await dragNote(win, c.id, 40, 30);
    await win.evaluate((sels) => {
      for (const s of sels) {
        const el = document.querySelector(s);
        if (el === null) continue;
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    }, BURST);
    await win.waitForTimeout(2500);
    const c2 = await waitForAnn(win, (x) => x.id === c.id, 6000);
    log('burst-3a', { style: c2 && c2.style, missing: missingOf(c2) });

    // ---- (3b) same-task synthetic drag + burst --------------------------
    const d = await placeNote(win, 'DEF267-D', 0.55, 0.5);
    const res3b = await win.evaluate(({ id, sels }) => {
      const icon = document.querySelector(`.ann-note[data-annotation-id="${id}"]`);
      const layer = document.querySelector("[data-annotation-layer='1']");
      if (icon === null || layer === null) return { ok: false, why: 'no surface' };
      const r = icon.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const pe = (type, el, cx, cy) => {
        try { el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: cx, clientY: cy, pointerId: 1 })); }
        catch (_) { /* capture may throw */ }
      };
      pe('pointerdown', icon, x, y);
      pe('pointermove', layer, x + 35, y + 25);
      pe('pointerup', layer, x + 35, y + 25);
      for (const s of sels) {
        const el = document.querySelector(s);
        if (el === null) continue;
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
      return { ok: true };
    }, { id: d.id, sels: BURST });
    await win.waitForTimeout(2500);
    const d2 = await waitForAnn(win, (x) => x.id === d.id, 6000);
    log('burst-3b', { launched: res3b, style: d2 && d2.style, missing: missingOf(d2) });

    const anyDrop = [c2, d2].some((x) => missingOf(x).length > 0);
    console.log(`[DEF267] tightBurstMissing 3a=${JSON.stringify(missingOf(c2))} 3b=${JSON.stringify(missingOf(d2))}`);
    console.log(`[DEF267] VERDICT ${anyDrop ? 'FIELD-DROPPED (REPRODUCED)' : 'NO-DROP (INCONCLUSIVE for the sub-ms race)'}`);
  }, 'def267');
});
