// Phase 93 (TFL-515) feature C - ADVERSARIAL probe of the Book View page-turn.
//
// This is not QA. QA proved criteria 1-6 on the happy paths; this spec attacks
// the turn with hostile input shapes and states and probes for the failure
// fingerprints named in the task:
//   - a stuck `data-book-turning` with no leaf,
//   - a residual `[data-book-turn]` after the input stops,
//   - a stale/incorrect committed `[data-book-page]`,
//   - a doubled/ghost canvas,
//   - a lost armed annotation tool,
//   - a page zone / nav button that stopped advancing.
//
// Attacks: one-tick and ~30ms-spaced bursts forward+backward at the first/last
// clamp; single/double toggled mid-turn; close Book View mid-turn then
// re-enter; page-zone clicks at both spread edges and over the crease during a
// turn; reduced-motion and Animations-OFF switched MID-SESSION; a storm audit
// of canvas counts, armed tool and advancement.
//
// Launch ONLY through e2e/lib/launch.cjs (`launchApp`). Attack the shipped
// build; never edit product code.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..', 'test-fixtures', 'phase56');
const CBZ = path.join(FIX, 'phase56-comic.cbz'); // 12-page comic
const SHOTS = path.resolve(__dirname, '..', 'screenshots', 'phase93');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;

const log = (label, obj) => {
  try {
    process.stdout.write(`P93ADV ${label} ${JSON.stringify(obj)}\n`);
  } catch (_) {
    /* stdout gone */
  }
};

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p93adv');
  app = null;
  win = null;
});

test.setTimeout(240000);

// ---------------------------------------------------------------------------
// Driving helpers
// ---------------------------------------------------------------------------
async function stubOpen(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
}

async function openBookView(filePath = CBZ) {
  await stubOpen(filePath);
  await win.locator('[aria-label="Open PDF document"]').first().click();
  await win.waitForSelector('[aria-label="Book View"]', { state: 'visible', timeout: 60000 });
  await win.waitForTimeout(400);
  await win.locator('[aria-label="Book View"]').click();
  await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 15000 });
  await win.waitForTimeout(450); // entry animation + fallback
}

async function reenterBookView() {
  await win.waitForSelector('[aria-label="Book View"]', { state: 'visible', timeout: 15000 });
  await win.locator('[aria-label="Book View"]').click();
  await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 15000 });
  await win.waitForTimeout(450);
}

async function closeBookView() {
  await win.locator('[aria-label="Close book view"]').click();
  await win.waitForSelector('[data-book-view]', { state: 'detached', timeout: 10000 });
  await win.waitForTimeout(300);
}

async function useSingle() {
  await win.locator('[aria-label="Book single page"]').click();
  await win.waitForSelector('[data-book-stage][data-book-layout="single"]', { timeout: 5000 });
  await win.waitForTimeout(450);
}

async function useDouble() {
  await win.locator('[aria-label="Book double page"]').click();
  await win.waitForSelector('[data-book-stage][data-book-layout="double"]', { timeout: 5000 });
  await win.waitForTimeout(450);
}

function audit() {
  return win.evaluate(() => {
    const stage = document.querySelector('[data-book-stage]');
    return {
      pages: Array.from(document.querySelectorAll('[data-book-page]')).map((e) =>
        e.getAttribute('data-book-page'),
      ),
      leaves: document.querySelectorAll('[data-book-turn]').length,
      turning: stage ? stage.getAttribute('data-book-turning') : null,
      relayout: stage ? stage.getAttribute('data-book-relayout') : null,
      layout: stage ? stage.getAttribute('data-book-layout') : null,
      canvasCount: document.querySelectorAll('[data-book-stage] .pdf-page-canvas').length,
      faces: document.querySelectorAll('[data-book-stage] .book-view-face').length,
      backFaces: document.querySelectorAll('[data-book-stage] .book-view-face-back').length,
      progress: (document.querySelector('[data-book-progress]') || {}).textContent || null,
      anyTurningClass: document.querySelectorAll('.book-view-page-turning').length,
    };
  });
}

async function awaitCalm() {
  await win.waitForFunction(
    () => {
      const stage = document.querySelector('[data-book-stage]');
      const leaves = document.querySelectorAll('[data-book-turn]').length;
      const turning = !!(stage && stage.getAttribute('data-book-turning') === 'true');
      return leaves === 0 && !turning;
    },
    null,
    { timeout: 15000 },
  );
  // After a chained turn the next leaf may mount within the same batch; a
  // second calm check after a full turn duration proves the book truly rested.
  await win.waitForTimeout(500);
  await win.waitForFunction(
    () => {
      const stage = document.querySelector('[data-book-stage]');
      const leaves = document.querySelectorAll('[data-book-turn]').length;
      const turning = !!(stage && stage.getAttribute('data-book-turning') === 'true');
      return leaves === 0 && !turning;
    },
    null,
    { timeout: 15000 },
  );
}

async function awaitSettled(expected) {
  await win.waitForFunction(
    (exp) => {
      const leaves = document.querySelectorAll('[data-book-turn]').length;
      const stage = document.querySelector('[data-book-stage]');
      const turning = !!(stage && stage.getAttribute('data-book-turning') === 'true');
      const pages = Array.from(document.querySelectorAll('[data-book-page]')).map((el) =>
        el.getAttribute('data-book-page'),
      );
      return leaves === 0 && !turning && JSON.stringify(pages) === JSON.stringify(exp);
    },
    expected,
    { timeout: 15000 },
  );
}

async function figureClick(side) {
  await win.evaluate((s) => {
    const el = document.querySelector(`[data-book-page-side="${s}"]`);
    if (el) el.click();
  }, side);
}

async function figureBurst(side, n) {
  await win.evaluate(
    ([s, count]) => {
      const el = document.querySelector(`[data-book-page-side="${s}"]`);
      if (!el) return;
      for (let i = 0; i < count; i += 1) el.click();
    },
    [side, n],
  );
}

async function navClick(sel) {
  const loc = win.locator(sel);
  if (await loc.isDisabled()) return false;
  await loc.click();
  return true;
}

async function navBurst(sel, n) {
  await win.evaluate(
    ([s, count]) => {
      const el = document.querySelector(s);
      if (!el || el.disabled) return;
      for (let i = 0; i < count; i += 1) el.click();
    },
    [sel, n],
  );
}

async function navSpacedBurst(sel, n, gapMs) {
  await win.evaluate(
    ([s, count, gap]) => {
      const el = document.querySelector(s);
      let i = 0;
      window.__p93advInterval = setInterval(() => {
        if (el && !el.disabled) el.click();
        i += 1;
        if (i >= count) clearInterval(window.__p93advInterval);
      }, gap);
    },
    [sel, n, gapMs],
  );
}

async function advanceToLastSettled(maxSteps = 40) {
  for (let i = 0; i < maxSteps; i += 1) {
    const disabled = await win.locator('[data-book-next]').isDisabled();
    if (disabled) return true;
    await win.locator('[data-book-next]').click();
    await awaitCalm();
  }
  return !(await win.locator('[data-book-next]').isDisabled());
}

// Arm any non-select visible Book View annotation tool; returns its id.
async function armAnyTool() {
  const tools = await win.evaluate(() => {
    return Array.from(
      document.querySelectorAll('[data-book-tools] [data-ann-tools-visible] button[data-tool]'),
    ).map((b) => ({
      tool: b.getAttribute('data-tool'),
      disabled: b.disabled,
      pressed: b.getAttribute('aria-pressed'),
    }));
  });
  const pick = tools.find((t) => t.tool !== 'select' && !t.disabled) || tools.find((t) => !t.disabled);
  if (!pick) return { armed: null, tools };
  await win.locator(`[data-book-tools] [data-ann-tools-visible] button[data-tool="${pick.tool}"]`).click();
  await win.waitForTimeout(200);
  return { armed: pick.tool, tools };
}

function armedTool() {
  return win.evaluate(() => {
    const active = document.querySelector(
      '[data-book-tools] [data-ann-tools-visible] button[data-tool][aria-pressed="true"]',
    );
    return active ? active.getAttribute('data-tool') : null;
  });
}

// A watcher that records, across a hostile sequence, the maximum simultaneous
// leaf count and whether the stage ever claimed turning with zero leaf mounted
// (the two Phase 93 invariants).
async function armWatcher() {
  await win.evaluate(() => {
    const state = {
      maxLeaves: 0,
      leafEver: false,
      turningEver: false,
      turningNoLeaf: false,
      stopped: false,
      samples: 0,
    };
    window.__p93advWatch = state;
    const check = () => {
      const s = window.__p93advWatch;
      if (s.stopped) return;
      s.samples += 1;
      const leaves = document.querySelectorAll('[data-book-turn]').length;
      const stage = document.querySelector('[data-book-stage]');
      const turning = !!(stage && stage.getAttribute('data-book-turning') === 'true');
      if (leaves > s.maxLeaves) s.maxLeaves = leaves;
      if (leaves > 0) s.leafEver = true;
      if (turning) s.turningEver = true;
      if (turning && leaves === 0) s.turningNoLeaf = true;
    };
    if (window.__p93advObs) window.__p93advObs.disconnect();
    const obs = new MutationObserver(check);
    const stage = document.querySelector('[data-book-stage]');
    if (stage) obs.observe(stage, { subtree: true, childList: true, attributes: true });
    window.__p93advObs = obs;
    const tick = () => {
      if (window.__p93advWatch.stopped) return;
      check();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function readWatcher() {
  return win.evaluate(() => {
    window.__p93advWatch.stopped = true;
    if (window.__p93advObs) window.__p93advObs.disconnect();
    return window.__p93advWatch;
  });
}

async function setReducedMotion(value) {
  const cdp = await win.context().newCDPSession(win);
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value }],
  });
  await win.waitForTimeout(250);
}

function mediaReduced() {
  return win.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// ===========================================================================
// A. One-tick and ~30ms-spaced bursts, forward and backward, at both clamps.
// ===========================================================================
test('A: one-tick and spaced bursts forward/backward recover at the clamps', async () => {
  await openBookView();
  await useSingle();
  expect(await win.locator('[data-book-page]').getAttribute('data-book-page')).toBe('1');

  await armWatcher();

  // One-tick burst of 6 forward clicks. By design this coalesces to TWO steps,
  // so the committed page must be exactly 3 and the book must rest clean.
  await figureBurst('single', 6);
  await awaitSettled(['3']);
  const oneTick = await audit();
  log('A.oneTick', oneTick);
  await win.screenshot({ path: path.join(SHOTS, 'adv-A-onetick.png') });
  expect(oneTick.leaves, 'residual leaf after a one-tick burst').toBe(0);
  expect(oneTick.turning, 'stuck data-book-turning after a one-tick burst').toBeNull();
  expect(oneTick.pages).toEqual(['3']);

  // ~30ms-spaced burst forward; count must advance but land on a valid page.
  await win.evaluate(() => {
    const el = document.querySelector('[data-book-page-side="single"]');
    let i = 0;
    window.__p93advInterval = setInterval(() => {
      el.click();
      i += 1;
      if (i >= 14) clearInterval(window.__p93advInterval);
    }, 30);
  });
  await win.waitForFunction(() => window.__p93advInterval === undefined || true);
  await win.waitForTimeout(2500);
  await awaitCalm();
  const spacedFwd = await audit();
  log('A.spacedFwd', spacedFwd);
  expect(spacedFwd.leaves, 'residual leaf after a 30ms-spaced burst').toBe(0);
  expect(spacedFwd.turning, 'stuck turning after a 30ms-spaced burst').toBeNull();
  expect(Number(spacedFwd.pages[0])).toBeGreaterThanOrEqual(3);
  expect(Number(spacedFwd.pages[0])).toBeLessThanOrEqual(12);

  // Drive to the LAST page, then hammer next: it must clamp and rest clean.
  await advanceToLastSettled();
  const atLast = await audit();
  log('A.atLast', atLast);
  expect(atLast.pages).toEqual(['12']);

  await figureBurst('single', 8);
  await win.waitForTimeout(700);
  await figureBurst('single', 8);
  await win.waitForTimeout(1500);
  await awaitCalm();
  const lastBurst = await audit();
  const navNextDisabled = await win.locator('[data-book-next]').isDisabled();
  log('A.lastBurst', { ...lastBurst, navNextDisabled });
  await win.screenshot({ path: path.join(SHOTS, 'adv-A-clamp-last.png') });
  expect(lastBurst.pages, 'a next burst past the last page moved it').toEqual(['12']);
  expect(lastBurst.leaves, 'residual leaf at the last-page clamp').toBe(0);
  expect(lastBurst.turning, 'stuck turning at the last-page clamp').toBeNull();
  expect(navNextDisabled, 'Next stayed enabled at the last page').toBe(true);

  // Back to the FIRST page, then hammer prev (the single page zone only ever
  // advances, so the backward clamp is driven through the Previous nav).
  await advanceToFirstSettled();
  await navBurst('[data-book-prev]', 8);
  await win.waitForTimeout(700);
  await navBurst('[data-book-prev]', 8);
  await win.waitForTimeout(1500);
  await awaitCalm();
  const firstBurst = await audit();
  const navPrevDisabled = await win.locator('[data-book-prev]').isDisabled();
  log('A.firstBurst', { ...firstBurst, navPrevDisabled });
  expect(firstBurst.pages, 'a prev burst before the first page moved it').toEqual(['1']);
  expect(navPrevDisabled, 'Previous stayed enabled at the first page').toBe(true);

  // Recovery: a plain next still advances after all that hammering.
  await figureClick('single');
  await awaitSettled(['2']);
  expect((await audit()).pages).toEqual(['2']);

  const watch = await readWatcher();
  log('A.watch', watch);
  expect(watch.maxLeaves, 'more than one leaf mounted at once').toBeLessThanOrEqual(1);
  expect(watch.turningNoLeaf, 'data-book-turning set with no leaf').toBe(false);
});

async function advanceToFirstSettled(maxSteps = 40) {
  for (let i = 0; i < maxSteps; i += 1) {
    const disabled = await win.locator('[data-book-prev]').isDisabled();
    if (disabled) return true;
    await win.locator('[data-book-prev]').click();
    await awaitCalm();
  }
  return !(await win.locator('[data-book-prev]').isDisabled());
}

// ===========================================================================
// B. Rapid direction reversal and a queued step at the clamp (double spread).
// ===========================================================================
test('B: direction reversal and a queued step at the spread clamp land correctly', async () => {
  await openBookView();
  await useDouble();
  expect(await win.locator('[data-book-page]').first().getAttribute('data-book-page')).toBe('1');

  await armWatcher();

  // Move off the first spread first: at [1,2] the left zone is clamped (noPrev),
  // so a reversal there is a no-op by design. Start from [5,6].
  await win.locator('[data-book-next]').click();
  await awaitCalm();
  await win.locator('[data-book-next]').click();
  await awaitCalm();
  const midBefore = await audit();
  log('B.midBefore', midBefore);
  expect(midBefore.pages).toEqual(['5', '6']);

  // One tick: 3x next then 3x prev -> the queued direction is prev, so the turn
  // advances one spread and the queued step returns: [5,6] -> [7,8] -> [5,6].
  await win.evaluate(() => {
    const r = document.querySelector('[data-book-page-side="right"]');
    const l = document.querySelector('[data-book-page-side="left"]');
    for (let i = 0; i < 3; i += 1) r.click();
    for (let i = 0; i < 3; i += 1) l.click();
  });
  await win.waitForTimeout(2000);
  await awaitCalm();
  const reversed = await audit();
  log('B.reversed', reversed);
  expect(reversed.leaves).toBe(0);
  expect(reversed.turning).toBeNull();
  expect(reversed.pages).toEqual(midBefore.pages);

  // From [5,6], step to the SECOND-TO-LAST spread [9,10], then a one-tick
  // burst fires a next turn AND queues an extra next during it. The queued
  // step must clamp at the last spread and leave no residual:
  // [9,10] -> [11,12], with nothing mounted afterwards.
  await win.locator('[data-book-next]').click();
  await awaitCalm();
  await win.locator('[data-book-next]').click();
  await awaitCalm();
  const preClamp = await audit();
  log('B.preClamp', preClamp);
  expect(preClamp.pages).toEqual(['9', '10']);

  await figureBurst('right', 4);
  await win.waitForTimeout(2400);
  await awaitCalm();
  const clampQ = await audit();
  const navNextDisabled = await win.locator('[data-book-next]').isDisabled();
  log('B.clampQueue', { ...clampQ, navNextDisabled });
  expect(clampQ.pages, 'a queued next at the clamp landed on the wrong spread').toEqual([
    '11',
    '12',
  ]);
  expect(clampQ.leaves, 'residual leaf after a queued clamp step').toBe(0);
  expect(clampQ.turning, 'stuck turning after a queued clamp step').toBeNull();
  expect(navNextDisabled, 'Next stayed enabled at the last spread').toBe(true);

  // Controls recover: prev then next returns to the last spread.
  if (!(await win.locator('[data-book-prev]').isDisabled())) {
    await win.locator('[data-book-prev]').click();
    await awaitCalm();
  }
  const afterPrev = await audit();
  log('B.afterPrev', afterPrev);
  expect(afterPrev.leaves).toBe(0);
  expect(afterPrev.turning).toBeNull();

  const watch = await readWatcher();
  log('B.watch', watch);
  expect(watch.maxLeaves).toBeLessThanOrEqual(1);
  expect(watch.turningNoLeaf).toBe(false);
});

// ===========================================================================
// C. Toggle single/double while a turn is in flight.
// ===========================================================================
test('C: toggling single/double mid-turn leaves no residual and recovers', async () => {
  await openBookView();
  await useDouble();
  await armWatcher();

  // Start a next turn, then flip to single mid-swing.
  await figureClick('right');
  await win.waitForTimeout(70);
  await win.locator('[aria-label="Book single page"]').click();
  await win.waitForTimeout(1200);
  await awaitCalm();
  const s = await audit();
  log('C.doubleToSingle', s);
  await win.screenshot({ path: path.join(SHOTS, 'adv-C-double-to-single.png') });
  expect(s.layout, 'layout did not flip to single').toBe('single');
  expect(s.leaves, 'residual leaf after mid-turn double->single').toBe(0);
  expect(s.turning, 'stuck turning after mid-turn double->single').toBeNull();
  expect(s.anyTurningClass).toBe(0);

  // Turn in single to prove the surface still works after the abort.
  await figureClick('single');
  await awaitCalm();
  const s2 = await audit();
  log('C.singleTurnAfter', s2);
  expect(s2.leaves).toBe(0);
  expect(s2.turning).toBeNull();

  // Start a turn in single, then flip to double mid-swing.
  await win.waitForTimeout(150);
  await figureClick('single');
  await win.waitForTimeout(70);
  await win.locator('[aria-label="Book double page"]').click();
  await win.waitForTimeout(1200);
  await awaitCalm();
  const d = await audit();
  log('C.singleToDouble', d);
  await win.screenshot({ path: path.join(SHOTS, 'adv-C-single-to-double.png') });
  expect(d.layout, 'layout did not flip to double').toBe('double');
  expect(d.leaves, 'residual leaf after mid-turn single->double').toBe(0);
  expect(d.turning, 'stuck turning after mid-turn single->double').toBeNull();

  // A spread turn still advances afterwards.
  const before = d.pages.slice();
  if (!(await win.locator('[data-book-next]').isDisabled())) {
    await win.locator('[data-book-next]').click();
    await awaitCalm();
  }
  const after = await audit();
  log('C.spreadAfter', after);
  expect(after.leaves).toBe(0);
  expect(after.turning).toBeNull();
  expect(JSON.stringify(after.pages)).not.toBe(JSON.stringify(before));

  const watch = await readWatcher();
  log('C.watch', watch);
  expect(watch.turningNoLeaf).toBe(false);
});

// ===========================================================================
// D. Close Book View mid-turn and re-enter.
// ===========================================================================
test('D: closing Book View mid-turn and re-entering resets cleanly', async () => {
  await openBookView();
  await useDouble();
  await armWatcher();

  await figureClick('right');
  await win.waitForTimeout(50);
  await closeBookView();
  const gone = await win.evaluate(() => ({
    bookViews: document.querySelectorAll('[data-book-view]').length,
    turning: document.querySelectorAll('.book-view-page-turning').length,
  }));
  log('D.closed', gone);
  await win.screenshot({ path: path.join(SHOTS, 'adv-D-closed-midturn.png') });
  expect(gone.bookViews, 'Book View remained mounted after close').toBe(0);
  expect(gone.turning, 'a turning figure survived the Book View close').toBe(0);

  await reenterBookView();
  const re = await audit();
  log('D.reentered', re);
  await win.screenshot({ path: path.join(SHOTS, 'adv-D-reentered.png') });
  expect(re.leaves).toBe(0);
  expect(re.turning).toBeNull();
  // Book View seeds its layout once from the stored comic default, so a
  // re-entry legitimately returns to the default layout; it must still start
  // at page 1 with a clean, single committed surface.
  expect(re.pages[0], 're-entered Book View did not start at page 1').toBe('1');
  expect(['single', 'double']).toContain(re.layout);
  expect(re.canvasCount, 're-entered Book View has a ghost canvas').toBeLessThanOrEqual(2);

  // The surface advances after the mid-turn abort + re-enter (layout-agnostic:
  // drive the Next nav, which works in both single and double).
  if (!(await win.locator('[data-book-next]').isDisabled())) {
    await win.locator('[data-book-next]').click();
    await awaitCalm();
  }
  const moved = await audit();
  log('D.moved', moved);
  expect(moved.leaves).toBe(0);
  expect(moved.turning).toBeNull();
  expect(JSON.stringify(moved.pages)).not.toBe(JSON.stringify(re.pages));

  const watch = await readWatcher();
  log('D.watch', watch);
  expect(watch.turningNoLeaf).toBe(false);
});

// ===========================================================================
// E. Page-zone clicks at both spread edges and over the crease DURING a turn.
// ===========================================================================
test('E: page-zone clicks at both edges and over the crease during a turn', async () => {
  await openBookView();
  await useDouble();
  await armWatcher();

  // Start a next turn, then hit the left edge (prev), the crease, and the
  // right edge (next) while the leaf is mid-swing.
  await figureClick('right');
  await win.waitForTimeout(40);
  await figureClick('left');
  await win.waitForTimeout(40);
  const crease = await win.locator('[data-book-crease]').boundingBox();
  if (crease) {
    await win.mouse.click(crease.x + crease.width / 2, crease.y + crease.height / 2);
  }
  await win.waitForTimeout(40);
  await figureClick('right');
  await win.waitForTimeout(2200);
  await awaitCalm();
  const e1 = await audit();
  log('E.afterEdgeStorm', { ...e1, crease });
  await win.screenshot({ path: path.join(SHOTS, 'adv-E-edge-storm.png') });
  expect(e1.leaves, 'residual leaf after the edge/crease storm').toBe(0);
  expect(e1.turning, 'stuck turning after the edge/crease storm').toBeNull();
  expect(e1.pages.length).toBe(2);

  // Both edge zones and the crease must still act / stay inert after the storm.
  const before = e1.pages.slice();
  await figureClick('right');
  await awaitCalm();
  const afterRight = await audit();
  expect(JSON.stringify(afterRight.pages), 'right zone stopped advancing').not.toBe(
    JSON.stringify(before),
  );
  await figureClick('left');
  await awaitCalm();
  const afterLeft = await audit();
  expect(JSON.stringify(afterLeft.pages), 'left zone stopped retreating').toBe(
    JSON.stringify(before),
  );

  // Crease is decorative, but its 2px seam shares the page-zone edges, so a
  // click at its centre may legitimately land on a page zone. Either way it
  // must leave a clean, valid spread and never a residual leaf or a stale page.
  const restBefore = await audit();
  if (crease) {
    await win.mouse.click(crease.x + crease.width / 2, crease.y + crease.height / 2);
  }
  await win.waitForTimeout(600);
  await awaitCalm();
  const restAfter = await audit();
  log('E.creaseRest', { restBefore: restBefore.pages, restAfter: restAfter.pages });
  expect(restAfter.leaves, 'residual leaf after a crease click').toBe(0);
  expect(restAfter.turning, 'stuck turning after a crease click').toBeNull();
  expect(restAfter.pages.length, 'crease click produced an invalid spread').toBe(2);
  expect(Number(restAfter.pages[0])).toBeLessThanOrEqual(11);

  const watch = await readWatcher();
  log('E.watch', watch);
  expect(watch.maxLeaves).toBeLessThanOrEqual(1);
  expect(watch.turningNoLeaf).toBe(false);
});

// ===========================================================================
// F. Reduced motion switched MID-SESSION, then a turn; then switched back.
// ===========================================================================
test('F: reduced motion flipped mid-session turns instantly and flips back live', async () => {
  await openBookView();
  await useDouble();
  expect(await mediaReduced(), 'reduced-motion started enabled').toBe(false);

  await armWatcher();
  await setReducedMotion('reduce');
  expect(await mediaReduced(), 'CDP did not enable reduced motion').toBe(true);
  await win.waitForTimeout(300);

  await figureClick('right');
  await awaitSettled(['3', '4']);
  const reduced = await audit();
  const figures = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-book-page]')).map((el) => ({
      cls: el.className,
      transform: getComputedStyle(el).transform,
    })),
  );
  log('F.reduced', { ...reduced, figures });
  await win.screenshot({ path: path.join(SHOTS, 'adv-F-reduced-instant.png') });
  expect(reduced.leaves, 'reduced motion mounted a leaf').toBe(0);
  expect(reduced.turning, 'reduced motion set data-book-turning').toBeNull();
  for (const f of figures) {
    expect(f.cls, 'reduced motion left a turning class').not.toContain('book-view-page-turning');
    expect(
      f.transform === 'none' || f.transform === 'matrix(1, 0, 0, 1, 0, 0)',
      `reduced motion left a half transform (${f.transform})`,
    ).toBe(true);
  }

  // Flip back live: the animated path must return.
  await win.evaluate(() => {
    window.__p93advLeafSeen = false;
    const obs = new MutationObserver(() => {
      if (document.querySelector('[data-book-turn]')) window.__p93advLeafSeen = true;
    });
    obs.observe(document.querySelector('[data-book-stage]'), {
      subtree: true,
      childList: true,
      attributes: true,
    });
    window.__p93advLeafObs = obs;
  });
  await setReducedMotion('no-preference');
  expect(await mediaReduced(), 'CDP did not clear reduced motion').toBe(false);
  await win.waitForTimeout(300);
  await figureClick('right');
  await awaitSettled(['5', '6']);
  const backOn = await win.evaluate(() => {
    if (window.__p93advLeafObs) window.__p93advLeafObs.disconnect();
    return window.__p93advLeafSeen;
  });
  const onAudit = await audit();
  log('F.animated', { ...onAudit, leafSeenAfterRestore: backOn });
  expect(backOn, 'the animated leaf did not return after clearing reduced motion').toBe(true);
  expect(onAudit.leaves).toBe(0);
  expect(onAudit.turning).toBeNull();

  const watch = await readWatcher();
  log('F.watch', watch);
  expect(watch.turningNoLeaf, 'turning with no leaf across the reduced-motion flip').toBe(false);
});

// ===========================================================================
// G. Animations OFF switched MID-SESSION through Preferences, then a turn.
// ===========================================================================
test('G: Animations OFF via Preferences mid-session turns instantly, no leaf', async () => {
  await openBookView();
  await useDouble();
  const gateBefore = await win.evaluate(() => document.documentElement.dataset.animations);
  expect(gateBefore, 'animations started OFF').toBe('on');

  await win.locator('[data-open-preferences]').click();
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 8000 });
  const box = win.locator('[data-prefs-animations]');
  if (await box.isChecked()) await box.click();
  await expect
    .poll(() => win.evaluate(() => document.documentElement.dataset.animations), { timeout: 5000 })
    .toBe('off');
  await win.screenshot({ path: path.join(SHOTS, 'adv-G-prefs-off.png') });
  await win.locator('[data-prefs-dialog] .sheet-close').click();
  await win.waitForTimeout(400);

  // Book View must still be mounted and usable.
  expect(await win.locator('[data-book-view]').count(), 'Book View vanished').toBe(1);

  await armWatcher();
  await win.evaluate(() => {
    window.__p93advLeafSeen = false;
    const obs = new MutationObserver(() => {
      if (document.querySelector('[data-book-turn]')) window.__p93advLeafSeen = true;
    });
    obs.observe(document.querySelector('[data-book-stage]'), {
      subtree: true,
      childList: true,
      attributes: true,
    });
    window.__p93advLeafObs = obs;
  });
  await figureClick('right');
  await awaitSettled(['3', '4']);
  const off = await audit();
  const leafSeen = await win.evaluate(() => {
    if (window.__p93advLeafObs) window.__p93advLeafObs.disconnect();
    return window.__p93advLeafSeen;
  });
  log('G.offTurn', { ...off, leafSeen });
  await win.screenshot({ path: path.join(SHOTS, 'adv-G-instant-turn.png') });
  expect(leafSeen, 'Animations OFF still mounted a turn leaf').toBe(false);
  expect(off.turning, 'Animations OFF set data-book-turning').toBeNull();
  expect(off.leaves).toBe(0);

  const watch = await readWatcher();
  log('G.watch', watch);
  expect(watch.turningNoLeaf).toBe(false);
});

// ===========================================================================
// H. Storm audit: ghost canvas, lost armed tool, stuck state across re-entry
//    and a burst of turns.
// ===========================================================================
test('H: storm audit - no ghost canvas, armed tool survives, controls keep advancing', async () => {
  await openBookView();
  await useDouble();

  const idleDouble = await audit();
  log('H.idleDouble', idleDouble);
  expect(idleDouble.canvasCount, 'idle double spread canvas count').toBeLessThanOrEqual(2);
  expect(idleDouble.leaves).toBe(0);

  const armed = await armAnyTool();
  log('H.armed', armed);
  const armedId = armed.armed;
  const pressedAfterArm = await armedTool();
  log('H.pressedAfterArm', { armedId, pressedAfterArm });

  await armWatcher();

  // Turn storm: alternating nav and page-zone turns with short waits so many
  // land mid-flight; every turn must keep the surface advancing and resting.
  let advanced = 0;
  for (let i = 0; i < 12; i += 1) {
    const before = await win.locator('[data-book-page]').first().getAttribute('data-book-page');
    // Page-zone turn (uses the figure handler), then a nav click 40ms later.
    await figureClick('right');
    await win.waitForTimeout(40);
    await win.evaluate(() => {
      const nav = document.querySelector('[data-book-next], [data-book-prev]');
      if (nav && !nav.disabled) nav.click();
    }).catch(() => {});
    await win.waitForTimeout(220);
    // Keep the book inside range by stepping back when Next is disabled.
    if (await win.locator('[data-book-next]').isDisabled()) {
      if (!(await win.locator('[data-book-prev]').isDisabled())) {
        await win.locator('[data-book-prev]').click();
      }
    }
    await awaitCalm();
    const after = await win.locator('[data-book-page]').first().getAttribute('data-book-page');
    if (before !== after) advanced += 1;
  }
  log('H.advancedCount', { advanced });

  const storm = await audit();
  const armedAtEnd = await armedTool();
  log('H.storm', { ...storm, armedAtEnd });
  await win.screenshot({ path: path.join(SHOTS, 'adv-H-storm.png') });
  expect(storm.leaves, 'residual leaf after the turn storm').toBe(0);
  expect(storm.turning, 'stuck turning after the turn storm').toBeNull();
  expect(storm.canvasCount, 'ghost canvas after the turn storm').toBeLessThanOrEqual(2);
  expect(storm.anyTurningClass).toBe(0);
  if (armedId && armedId !== 'select') {
    expect(armedAtEnd, 'the armed annotation tool was lost during the turn storm').toBe(armedId);
  }

  // Open/close Book View 6 times; canvas count must not accumulate.
  for (let i = 0; i < 6; i += 1) {
    await closeBookView();
    await reenterBookView();
  }
  const cycled = await audit();
  const leafAfterCycles = await win.locator('[data-book-turn]').count();
  log('H.cycled', { ...cycled, leafAfterCycles });
  await win.screenshot({ path: path.join(SHOTS, 'adv-H-after-cycles.png') });
  expect(leafAfterCycles, 'a leaf survived repeated open/close').toBe(0);
  expect(cycled.turning, 'stuck turning after repeated open/close').toBeNull();
  expect(cycled.canvasCount, 'canvas count grew across open/close cycles').toBeLessThanOrEqual(2);

  // Final advancement proof.
  const pre = await audit();
  if (!(await win.locator('[data-book-next]').isDisabled())) {
    await win.locator('[data-book-next]').click();
    await awaitCalm();
  }
  const post = await audit();
  log('H.finalAdvance', { pre: pre.pages, post: post.pages });
  expect(post.leaves).toBe(0);
  expect(post.turning).toBeNull();
  expect(JSON.stringify(post.pages), 'nav stopped advancing').not.toBe(JSON.stringify(pre.pages));

  const watch = await readWatcher();
  log('H.watch', watch);
  expect(watch.maxLeaves).toBeLessThanOrEqual(1);
  expect(watch.turningNoLeaf).toBe(false);
});
