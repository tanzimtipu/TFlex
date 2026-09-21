// DEF-267 remaining-half IN-APP verification harness (frontend-dev).
// Not a vitest spec (the config only includes *.test.ts/tsx), so this file is
// inert for `npm run test:unit`; it is a run-by-hand evidence harness, like the
// phase23 *.measure.cjs scripts in this folder.
//
// Launches the dev build through the canonical e2e launcher (e2e/lib/launch.cjs,
// imported read-only - this file lives outside e2e/ and does not modify it) and
// drives the REAL app:
//   NOTE  -> move, then zero-gap bold + align + indent; read the engine style
//   INK   -> draw, move, then zero-gap colour burst; read the engine points+colour
//   ARROW -> draw, move, then zero-gap colour burst; read the engine from/to+colour
// It writes screenshots/def267-burst-nonbox.png (+ ink/arrow frames).
//
// Run (after `npm.cmd run build`):
//   node test/unit/renderer/def267_inapp_verify.cjs
const path = require('node:path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const { launchApp, getSamplePath } = require(path.join(REPO, 'e2e', 'lib', 'launch.cjs'));
const { hardClose, armAnnotationTool, openSamplePath } = require(path.join(REPO, 'e2e', 'lib', 'helpers.cjs'));

const SHOTS = path.join(REPO, 'screenshots');
const log = (label, obj) => console.log(`[DEF267V|${label}] ${JSON.stringify(obj)}`);

const annModels = (win) =>
  win.evaluate(() => {
    const st = window.tflexDiagnostics().engineState;
    if (!st || !st.annotations) return [];
    return st.annotations.map((a) => ({
      id: a.id,
      kind: a.kind,
      at: a.at ?? null,
      points: a.points ?? null,
      from: a.from ?? null,
      to: a.to ?? null,
      color: a.color ?? null,
      style: a.style ?? null,
    }));
  });

async function waitForAnn(win, pred, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const found = (await annModels(win)).find(pred) ?? null;
    if (found !== null) return found;
    await win.waitForTimeout(150);
  }
  return null;
}

async function openReport(app, win) {
  await openSamplePath(win, app, getSamplePath('report.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(600);
}

function pageBox(win) {
  return win.locator('.pdf-page[data-page="1"]').boundingBox();
}

async function placeNote(win, text, fx, fy) {
  await armAnnotationTool(win, 'note');
  const pg = await pageBox(win);
  await win.mouse.click(pg.x + pg.width * fx, pg.y + pg.height * fy);
  await win.waitForSelector('[data-txt-text]', { timeout: 15000 });
  await win.waitForFunction(() => {
    const ta = document.querySelector('[data-txt-text]');
    return ta !== null && ta.disabled === false;
  }, null, { timeout: 15000 });
  await win.locator('[data-txt-text]').fill(text);
  await win.locator('[data-txt-text]').blur();
  const note = await waitForAnn(win, (a) => a.kind === 'note', 20000);
  if (note === null) throw new Error(`note ${text} not placed`);
  return note;
}

async function dragSurface(win, selector, dx, dy) {
  const bb = await win.locator(selector).first().boundingBox();
  if (bb === null) throw new Error(`no bounding box for ${selector}`);
  await dragFromTo(win, bb.x + bb.width / 2, bb.y + bb.height / 2, dx, dy);
}

/** Press exactly on a known client point (used for the ink stroke, whose
 *  bounding-box centre can sit off the polyline) and drag by dx/dy. */
async function dragFromTo(win, x, y, dx, dy) {
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dx, y + dy, { steps: 6 });
  await win.mouse.up();
}

async function pickBarColor(win, name) {
  const popover = win.locator('.color-popover').first();
  // The previous pick closes the popover with an exit animation; wait it out
  // so the box's toggle opens a FRESH popover instead of closing a stale one.
  await popover.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  await win.locator('[data-ann-color-box]').first().click();
  const swatch = win.locator(`.color-popover [data-palette-built-in='${name}']`).first();
  await swatch.waitFor({ state: 'visible', timeout: 8000 });
  await swatch.click();
  await popover.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
}

async function main() {
  const app = await launchApp([], null, null);
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 40000 });
  try {
    await openReport(app, win);

    // ---- NOTE: move then zero-gap bold + align + indent -------------------
    const note = await placeNote(win, 'DEF267-NOTE', 0.4, 0.3);
    const noteAt0 = note.at;
    await dragSurface(win, `.ann-note[data-annotation-id="${note.id}"]`, 45, 45);
    // No settle delay: click the three style controls immediately.
    await win.click('[data-txt-bold]');
    await win.click('[data-txt-align-center]');
    await win.click('[data-txt-indent-inc]');
    await win.waitForTimeout(2500);
    const noteAfter = await waitForAnn(win, (a) => a.id === note.id, 6000);
    log('note', { id: note.id, at0: noteAt0, at1: noteAfter && noteAfter.at, style: noteAfter && noteAfter.style });
    await win.screenshot({ path: path.join(SHOTS, 'def267-burst-nonbox.png') });

    // ---- INK: draw, move, then zero-gap colour burst ----------------------
    await armAnnotationTool(win, 'ink');
    const pg = await pageBox(win);
    const ix = pg.x + pg.width * 0.3;
    const iy = pg.y + pg.height * 0.45;
    await win.mouse.move(ix, iy);
    await win.mouse.down();
    await win.mouse.move(ix + 60, iy + 40, { steps: 8 });
    await win.mouse.move(ix + 110, iy + 20, { steps: 8 });
    await win.mouse.up();
    const ink = await waitForAnn(win, (a) => a.kind === 'ink', 15000);
    if (ink === null) throw new Error('ink not created');
    const inkP0 = ink.points && ink.points[0];
    await armAnnotationTool(win, 'select');
    // Press ON the stroke's first point (the bbox centre can miss the polyline).
    await dragFromTo(win, ix, iy, 40, 30);
    log('ink-bar', { bar: await win.locator('[data-content-action-bar]').count() });
    await pickBarColor(win, 'green');
    await pickBarColor(win, 'blue');
    await win.waitForTimeout(2500);
    const inkAfter = await waitForAnn(win, (a) => a.id === ink.id, 6000);
    log('ink', {
      id: ink.id,
      p0: inkP0,
      p1: inkAfter && inkAfter.points && inkAfter.points[0],
      color: inkAfter && inkAfter.color,
    });
    await win.screenshot({ path: path.join(SHOTS, 'def267-burst-ink.png') });

    // ---- ARROW: draw, move, then zero-gap colour burst --------------------
    await armAnnotationTool(win, 'arrow');
    const ax = pg.x + pg.width * 0.55;
    const ay = pg.y + pg.height * 0.3;
    await win.mouse.move(ax, ay);
    await win.mouse.down();
    await win.mouse.move(ax + 90, ay + 70, { steps: 8 });
    await win.mouse.up();
    const arrow = await waitForAnn(win, (a) => a.kind === 'arrow', 15000);
    if (arrow === null) throw new Error('arrow not created');
    const from0 = arrow.from;
    await armAnnotationTool(win, 'select');
    await dragSurface(win, `g.ann-arrow[data-annotation-id="${arrow.id}"]`, 30, 40);
    await pickBarColor(win, 'red');
    await win.waitForTimeout(2500);
    const arrowAfter = await waitForAnn(win, (a) => a.id === arrow.id, 6000);
    log('arrow', {
      id: arrow.id,
      from0,
      from1: arrowAfter && arrowAfter.from,
      to1: arrowAfter && arrowAfter.to,
      color: arrowAfter && arrowAfter.color,
    });
    await win.screenshot({ path: path.join(SHOTS, 'def267-burst-arrow.png') });

    console.log('[DEF267V] DONE');
  } finally {
    await hardClose(app, 'def267-verify');
  }
}

main().catch((e) => {
  console.error('[DEF267V] FATAL', e);
  process.exit(1);
});
