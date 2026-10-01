// Phase 77 (chunk A) focused-verification e2e (QA).
//
// REQUIREMENTS.md Phase 77 criteria 4 and 6 - the spine-hinged two-face page
// turn: correct LTR handedness (front = outgoing page, back = incoming),
// bounded to the stage at every frame, smooth frame-time, single-page inboard
// turn, and instant under reduced motion. Chunk B owns criteria 2/3/5 (entry
// animation, spread-aware label, animated mode swap) and is deliberately NOT
// asserted here.
//
// Launch ONLY through e2e/lib/launch.cjs. The OS open dialog is native, so
// `dialog.showOpenDialog` is stubbed in the main process and the app's real
// Open button is clicked - the phase66 pattern.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..', 'test-fixtures', 'phase56');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const CBZ = path.join(FIX, 'phase56-comic.cbz');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'phase77correction');
  app = null;
  win = null;
});

test.setTimeout(180000);

async function stubOpen(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
}

async function openBookView(filePath) {
  await stubOpen(filePath);
  await win.locator('[aria-label="Open PDF document"]').first().click();
  await win.waitForSelector('[aria-label="Book View"]', { state: 'visible', timeout: 60000 });
  await win.waitForTimeout(400);
  await win.locator('[aria-label="Book View"]').click();
  await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 15000 });
  await win.waitForTimeout(400);
}

async function pageNumbers() {
  return win.locator('[data-book-page]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-book-page')),
  );
}

async function useDouble() {
  await win.locator('[aria-label="Book double page"]').click();
  await win.waitForSelector('[data-book-stage][data-book-layout="double"]', { timeout: 5000 });
  await win.waitForTimeout(300);
}

// Arm a frame-by-frame observer over the WHOLE turn. It captures the leaf's
// data-book-turn-* contract on first sight, its computed transform-origin and
// the leaf rect at that instant (untransformed enough to resolve the hinge
// edge), then samples the transformed rect every rAF against the stage rect
// (max overflow) and measures the worst frame gap until the leaf unmounts.
// P77 uses it in place of the phase66 watchTurn because it needs the extra
// geometry/frame samples, not just the class-presence boolean.
async function armTurnCapture() {
  await win.evaluate(() => {
    const stage = document.querySelector('[data-book-stage]');
    const sr = stage.getBoundingClientRect();
    const state = {
      hit: false,
      dir: null,
      front: null,
      back: null,
      cls: null,
      animDuration: null,
      transformOrigin: null,
      originX: null,
      originY: null,
      firstRect: null,
      t0: null,
      clearedAt: null,
      cleared: false,
      clearMs: null,
      maxGap: 0,
      maxGapMs: null,
      frames: 0,
      maxOverflow: 0,
      samples: 0,
      stage: { left: sr.left, right: sr.right, top: sr.top, bottom: sr.bottom, width: sr.width, height: sr.height },
    };
    window.__p77 = state;
    if (window.__p77obs) window.__p77obs.disconnect();
    let leaf = null;
    const check = () => {
      const l = document.querySelector('[data-book-turn]');
      if (l) {
        if (!state.hit) {
          state.hit = true;
          state.cls = l.className;
          state.dir = l.getAttribute('data-book-turn-dir');
          const f = l.querySelector('[data-book-turn-front]');
          const b = l.querySelector('[data-book-turn-back]');
          state.front = f ? Number(f.getAttribute('data-book-turn-front')) : null;
          state.back = b ? Number(b.getAttribute('data-book-turn-back')) : null;
          const cs = getComputedStyle(l);
          state.animDuration = cs.animationDuration;
          state.transformOrigin = cs.transformOrigin;
          state.originX = parseFloat(cs.transformOrigin.split(' ')[0]);
          state.originY = parseFloat(cs.transformOrigin.split(' ')[1]);
          const r = l.getBoundingClientRect();
          state.firstRect = { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
        }
        leaf = l;
      } else if (state.hit && state.clearedAt === null) {
        state.clearedAt = performance.now();
      }
    };
    const obs = new MutationObserver(check);
    obs.observe(stage, { subtree: true, attributes: true, childList: true });
    window.__p77obs = obs;
    const tick = (now) => {
      check();
      if (state.hit && state.clearedAt === null) {
        if (state.frames > 0) {
          const gap = now - state.last;
          if (gap > state.maxGap) state.maxGap = gap;
        }
        state.frames += 1;
        state.last = now;
        if (leaf) {
          const r = leaf.getBoundingClientRect();
          const overflow = Math.max(
            state.stage.left - r.left,
            r.right - state.stage.right,
            state.stage.top - r.top,
            r.bottom - state.stage.bottom,
            0,
          );
          if (overflow > state.maxOverflow) state.maxOverflow = overflow;
          state.samples += 1;
        }
      }
      if (state.clearedAt === null) {
        requestAnimationFrame(tick);
      } else {
        state.cleared = true;
        state.clearMs = Math.round(state.clearedAt - state.t0);
        state.maxGapMs = Math.round(state.maxGap * 10) / 10;
        obs.disconnect();
      }
    };
    requestAnimationFrame(tick);
  });
}

async function markClick() {
  await win.evaluate(() => {
    if (window.__p77) window.__p77.t0 = performance.now();
  });
}

async function readTurn() {
  return win.evaluate(() => window.__p77);
}

async function awaitTurnClear() {
  await win.waitForFunction(() => window.__p77 && window.__p77.cleared, null, { timeout: 8000 });
}

// ---------------------------------------------------------------------------
// Phase 77 (chunk B) helpers - entry marker (criterion 2), spread-aware label
// (criterion 3) and the mode-swap marker (criterion 5).
//
// The entry/relayout markers are transient (animationend / a 400ms fallback and
// - under reduced motion - near-instant), so both are captured by a
// MutationObserver installed BEFORE the triggering click: the observer's
// microtask runs right after the attribute commit, before the browser can
// dispatch animationend, so even the 0.01ms reduced-motion duration is read
// while the marker is live. The pre-existing `openBookView` waits 400ms after
// mount and would already have missed the entry marker.
// ---------------------------------------------------------------------------

// Open Book View but return the instant `[data-book-view]` mounts, with the
// entry observer armed first. Caller waits on `window.__entry.seen`.
async function openBookViewAwaitEntry() {
  await stubOpen(CBZ);
  await win.locator('[aria-label="Open PDF document"]').first().click();
  await win.waitForSelector('[aria-label="Book View"]', { state: 'visible', timeout: 60000 });
  await win.waitForTimeout(400);
  await armEntryCapture();
  await win.locator('[aria-label="Book View"]').click();
}

async function armEntryCapture() {
  await win.evaluate(() => {
    window.__entry = { seen: false, name: null, duration: null, at: null, clearMs: null };
    const check = () => {
      const root = document.querySelector('[data-book-view]');
      if (root === null) return;
      if (!window.__entry.seen && root.getAttribute('data-book-enter') === 'true') {
        const cs = getComputedStyle(root);
        window.__entry.seen = true;
        window.__entry.name = cs.animationName;
        window.__entry.duration = cs.animationDuration;
        window.__entry.at = performance.now();
      }
      if (
        window.__entry.seen &&
        window.__entry.clearMs === null &&
        root.getAttribute('data-book-enter') === null
      ) {
        window.__entry.clearMs = Math.round(performance.now() - window.__entry.at);
      }
    };
    if (window.__entryObs) window.__entryObs.disconnect();
    const obs = new MutationObserver(check);
    obs.observe(document.body, { subtree: true, childList: true, attributes: true });
    window.__entryObs = obs;
    check();
  });
}

async function readEntry() {
  return win.evaluate(() => window.__entry);
}

// Arm a one-shot capture of the stage's relayout animation. Records the
// computed `animation-name` / `animation-duration` the first moment the marker
// attribute appears.
async function armStageMarker(attr, flag) {
  await win.evaluate(
    ({ attr, flag }) => {
      window.__marker = { seen: false, name: null, duration: null };
      const check = () => {
        if (window.__marker.seen) return;
        const el = document.querySelector('[data-book-stage]');
        if (el !== null && el.getAttribute(attr) === flag) {
          const cs = getComputedStyle(el);
          window.__marker = { seen: true, name: cs.animationName, duration: cs.animationDuration };
        }
      };
      if (window.__markerObs) window.__markerObs.disconnect();
      const obs = new MutationObserver(check);
      obs.observe(document.body, { subtree: true, childList: true, attributes: true });
      window.__markerObs = obs;
      check();
    },
    { attr, flag },
  );
}

// Pause one named animation on the first matching element at a deterministic
// offset so a screenshot cannot race the settle.
async function pauseNamedAnimation(selector, name, ms) {
  return win.evaluate(
    ({ selector, name, ms }) => {
      const el = document.querySelector(selector);
      if (el === null) return { ok: false, reason: 'no element' };
      const a = el.getAnimations().find((x) => x.animationName === name);
      if (a === undefined) return { ok: false, reason: 'no animation' };
      a.pause();
      a.currentTime = ms;
      return { ok: true, currentTime: a.currentTime, duration: a.effect.getTiming().duration };
    },
    { selector, name, ms },
  );
}

async function resumeAnimations(selector) {
  await win.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (el !== null) el.getAnimations().forEach((a) => a.play());
  }, selector);
}

function progressText() {
  return win.locator('[data-book-progress]').innerText();
}

// ---------------------------------------------------------------------------
// Criterion 6 / 4 (double, forward) - ONE spine-hinged leaf over the right
// half: front = outgoing page 2, back = incoming page 3, the static spread
// underneath is already the destination [3,4], the leaf hinges at its LEFT
// (spine) edge and never leaves the stage bounds, and the turn meets the
// frame-time budget.
// ---------------------------------------------------------------------------
test('criterion 6: double forward leaf - outgoing front, incoming back, left-spine hinge, bounded and smooth', async () => {
  await openBookView(CBZ);
  await useDouble();

  const before = await pageNumbers();
  expect(before, 'double spread does not start at 1,2').toEqual(['1', '2']);

  await armTurnCapture();
  await markClick();
  await win.locator('[data-book-page-side="right"]').click();
  // Capture the leaf while it is still in flight: wait for the leaf to mount,
  // then a short beat so the swing is visibly rotated (the leaf clears within
  // the 350ms turn, so the screenshot must precede the settle).
  await win.waitForSelector('[data-book-turn]', { state: 'attached', timeout: 2000 });
  // Deterministic mid-flight evidence: pause the leaf's CSS animation at 40%
  // of its swing so the screenshot cannot race the settle. The leaf's own
  // 400ms fallback still unmounts it, but the paused frame is what the
  // screenshot captures (measured below).
  const paused = await win.evaluate(() => {
    const l = document.querySelector('[data-book-turn]');
    if (!l) return { ok: false, reason: 'no leaf' };
    const anims = l.getAnimations();
    if (!anims.length) return { ok: false, reason: 'no animation' };
    anims.forEach((a) => { a.pause(); a.currentTime = 140; });
    const m = new DOMMatrixReadOnly(getComputedStyle(l).transform);
    return { ok: true, m11: Math.round(m.m11 * 1000) / 1000, n: anims.length };
  });
  const tShot = Date.now();
  const presentBefore = await win.locator('[data-book-turn]').count();
  await win.screenshot({ path: path.join(SHOTS, 'phase77-bookview-flip-midflight.png') });
  const shotMs = Date.now() - tShot;
  const presentAfter = await win.locator('[data-book-turn]').count();
  console.log('P77_SHOT paused=' + JSON.stringify(paused) + ' presentBefore=' + presentBefore + ' presentAfter=' + presentAfter + ' shotMs=' + shotMs);
  await awaitTurnClear();
  const turn = await readTurn();
  await win.screenshot({ path: path.join(SHOTS, 'phase77-bookview-settled.png') });

  const after = await pageNumbers();
  console.log('P77_TURN next ' + JSON.stringify({
    dir: turn.dir, front: turn.front, back: turn.back, cls: turn.cls,
    transformOrigin: turn.transformOrigin, originX: turn.originX, originY: turn.originY,
    firstRect: turn.firstRect, stage: turn.stage,
    maxOverflow: turn.maxOverflow, samples: turn.samples,
    maxGapMs: turn.maxGapMs, clearMs: turn.clearMs, animDuration: turn.animDuration,
  }));

  expect(turn.hit, 'no [data-book-turn] leaf appeared').toBe(true);
  expect(turn.dir, 'forward turn direction').toBe('next');
  expect(turn.cls, 'leaf is not the right-half leaf').toContain('book-view-turn-right');
  expect(turn.front, 'front (outgoing) page').toBe(2);
  expect(turn.back, 'back (incoming) page').toBe(3);
  expect(after, 'static spread did not advance to the destination').toEqual(['3', '4']);

  // Direction: next leaf over the right half hinges at its LEFT/spine edge.
  // `transformOrigin` is element-LOCAL, so the hinge in page coordinates is
  // firstRect.left + originX.
  expect(turn.originX, 'transform-origin missing').not.toBeNull();
  const hingeX = turn.firstRect.left + turn.originX;
  expect(
    Math.abs(hingeX - turn.firstRect.left),
    `next hinge is not the LEFT edge (originX=${turn.originX} local, hingeX=${hingeX}, left=${turn.firstRect.left}, right=${turn.firstRect.right})`,
  ).toBeLessThanOrEqual(2);
  expect(
    turn.firstRect.left,
    `next leaf is not over the right half (left=${turn.firstRect.left}, stageCentre=${turn.stage.left + turn.stage.width / 2})`,
  ).toBeGreaterThan(turn.stage.left + turn.stage.width / 2 - 5);

  // Criterion 6 - clipped to the stage throughout the turn.
  expect(turn.samples, 'no bounded samples were taken').toBeGreaterThan(3);
  expect(turn.maxOverflow, `leaf overflowed the stage by ${turn.maxOverflow}px`).toBeLessThanOrEqual(1);

  // Criterion 4 - frame-time budget (REQUIREMENTS.md:842 16ms/60fps; the
  // enforced no-frame-drop bound precedent is 33ms, REQUIREMENTS.md:846).
  expect(turn.maxGapMs, `worst frame gap ${turn.maxGapMs}ms exceeded 33ms`).toBeLessThanOrEqual(33);
  console.log('P77_PERF next within16ms=' + (turn.maxGapMs <= 16) + ' worstGap=' + turn.maxGapMs + 'ms clearMs=' + turn.clearMs + 'ms');
});

// ---------------------------------------------------------------------------
// Criterion 6 (double, backward) - the prev leaf over the left half hinges at
// its RIGHT/spine edge and carries front = current+1 (outgoing), back =
// current (incoming).
// ---------------------------------------------------------------------------
test('criterion 6: double backward leaf hinges at its RIGHT/spine edge', async () => {
  await openBookView(CBZ);
  await useDouble();
  await win.locator('[data-book-page-side="right"]').click();
  await win.waitForTimeout(600);
  expect(await pageNumbers(), 'setup did not reach spread 3,4').toEqual(['3', '4']);

  await armTurnCapture();
  await markClick();
  await win.locator('[data-book-page-side="left"]').click();
  await awaitTurnClear();
  const turn = await readTurn();
  const after = await pageNumbers();

  console.log('P77_TURN prev ' + JSON.stringify({
    dir: turn.dir, front: turn.front, back: turn.back, cls: turn.cls,
    transformOrigin: turn.transformOrigin, originX: turn.originX, originY: turn.originY,
    firstRect: turn.firstRect, stage: turn.stage, maxOverflow: turn.maxOverflow,
  }));

  expect(turn.hit, 'no [data-book-turn] leaf appeared').toBe(true);
  expect(turn.dir, 'backward turn direction').toBe('prev');
  expect(turn.cls, 'leaf is not the left-half leaf').toContain('book-view-turn-left');
  expect(turn.front, 'front (outgoing) page').toBe(3);
  expect(turn.back, 'back (incoming) page').toBe(2);
  expect(after, 'static spread did not retreat to the destination').toEqual(['1', '2']);

  const hingeX = turn.firstRect.left + turn.originX;
  expect(
    Math.abs(hingeX - turn.firstRect.right),
    `prev hinge is not the RIGHT edge (originX=${turn.originX} local, hingeX=${hingeX}, left=${turn.firstRect.left}, right=${turn.firstRect.right})`,
  ).toBeLessThanOrEqual(2);
  expect(
    turn.firstRect.right,
    `prev leaf is not over the left half (right=${turn.firstRect.right}, stageCentre=${turn.stage.left + turn.stage.width / 2})`,
  ).toBeLessThan(turn.stage.left + turn.stage.width / 2 + 5);
  expect(turn.maxOverflow, `prev leaf overflowed the stage by ${turn.maxOverflow}px`).toBeLessThanOrEqual(1);
});

// ---------------------------------------------------------------------------
// Criterion 4 (single mode) - a forward click turns exactly one page, the leaf
// carries dir=next with front 1 / back 2, the page advances to [2], and the
// leaf hinges at its LEFT/spine edge.
// ---------------------------------------------------------------------------
test('criterion 4: single-mode forward click turns one page inboard', async () => {
  await openBookView(getSamplePath('report.pdf'));

  expect(await win.locator('[data-book-stage]').getAttribute('data-book-layout'), 'did not open single').toBe('single');
  const before = await pageNumbers();
  expect(before).toEqual(['1']);

  await armTurnCapture();
  await markClick();
  await win.locator('[data-book-page-side="single"]').click();
  await awaitTurnClear();
  const turn = await readTurn();
  await win.screenshot({ path: path.join(SHOTS, 'phase77-bookview-single.png') });
  const after = await pageNumbers();

  console.log('P77_TURN single ' + JSON.stringify({
    dir: turn.dir, front: turn.front, back: turn.back, cls: turn.cls,
    transformOrigin: turn.transformOrigin, originX: turn.originX,
    firstRect: turn.firstRect, stage: turn.stage, maxOverflow: turn.maxOverflow, maxGapMs: turn.maxGapMs,
  }));

  expect(turn.hit, 'no [data-book-turn] leaf appeared').toBe(true);
  expect(turn.dir, 'single forward direction').toBe('next');
  expect(turn.front, 'front (outgoing) page').toBe(1);
  expect(turn.back, 'back (incoming) page').toBe(2);
  expect(after, 'single mode did not advance by exactly one').toEqual(['2']);
  const hingeX = turn.firstRect.left + turn.originX;
  expect(
    Math.abs(hingeX - turn.firstRect.left),
    `single next hinge is not the LEFT edge (originX=${turn.originX} local, hingeX=${hingeX}, left=${turn.firstRect.left})`,
  ).toBeLessThanOrEqual(2);
  // Bounds for single mode are enforced by the stage's `data-book-turning`
  // clip (overflow: hidden); the geometric leaf box legitimately swings past
  // the stage edge once the rear of the swing is clipped away. The criterion-6
  // geometric bound is asserted on the double spread, where the leaf stays in
  // the stage rect.
});

// ---------------------------------------------------------------------------
// Criterion 4 (reduced motion) - the layout motion token resolves to 0, so the
// leaf's animation-duration is 0s (instant) while the spread still advances.
// ---------------------------------------------------------------------------
test('reduced motion: layout token 0, instant turn, spread still advances', async () => {
  await openBookView(getSamplePath('report.pdf'));
  await useDouble();

  await win.emulateMedia({ reducedMotion: 'reduce' });
  await win.waitForTimeout(200);
  const raw = await win.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--motion-duration-layout'),
  );
  expect(Number.isNaN(parseFloat(raw)), `token did not resolve (${raw})`).toBe(false);
  expect(parseFloat(raw), `token is not 0 under reduced motion (${raw})`).toBe(0);

  expect(await pageNumbers()).toEqual(['1', '2']);
  await armTurnCapture();
  await markClick();
  await win.locator('[data-book-page-side="right"]').click();
  await awaitTurnClear();
  const turn = await readTurn();
  const after = await pageNumbers();

  console.log('P77_TURN reduced ' + JSON.stringify({
    token: raw, animDuration: turn.animDuration, hit: turn.hit,
    dir: turn.dir, front: turn.front, back: turn.back, clearMs: turn.clearMs,
  }));

  expect(after, 'spread did not advance under reduced motion').toEqual(['3', '4']);
  expect(turn.hit, 'reduced-motion leaf never mounted').toBe(true);
  // The app's reduced-motion catch-all sets `animation-duration: 0.01ms
  // !important` (styles.css), so "instant" is <1ms, not literally 0.
  expect(
    parseFloat(turn.animDuration),
    `turn is not instant (animation-duration=${turn.animDuration})`,
  ).toBeLessThanOrEqual(0.001);
});

// ---------------------------------------------------------------------------
// Criterion 2 - entering Book View plays the one-shot `tf-book-view-enter`
// animation over the layout motion token, then the transient `data-book-enter`
// marker clears.
// ---------------------------------------------------------------------------
test('criterion 2: entering Book View carries data-book-enter and runs tf-book-view-enter, then clears', async () => {
  await openBookViewAwaitEntry();
  await win.waitForFunction(() => window.__entry && window.__entry.seen, null, { timeout: 8000 });

  // Deterministic mid-entry evidence: pause the root's own animation so the
  // screenshot captures the settle, not a race against the 350ms end.
  const paused = await pauseNamedAnimation('[data-book-view]', 'tf-book-view-enter', 90);
  await win.screenshot({ path: path.join(SHOTS, 'phase77-bookview-entry.png') });

  const entry = await readEntry();
  console.log('P77_ENTER normal ' + JSON.stringify(entry) + ' paused=' + JSON.stringify(paused));

  expect(entry.seen, 'entry marker was never observed while live').toBe(true);
  expect(paused.ok, 'root entry animation was not found to pause').toBe(true);
  expect(entry.name, 'entry animation-name').toContain('tf-book-view-enter');
  expect(
    parseFloat(entry.duration),
    `entry animation-duration ${entry.duration} is not > 0`,
  ).toBeGreaterThan(0);

  await resumeAnimations('[data-book-view]');
  await win.waitForFunction(
    () => window.__entry && window.__entry.clearMs !== null,
    null,
    { timeout: 8000 },
  );
  const cleared = await readEntry();
  console.log('P77_ENTER clearedMs=' + cleared.clearMs);
  expect(cleared.clearMs, 'entry marker never cleared').not.toBeNull();
  expect(
    await win.locator('[data-book-view]').getAttribute('data-book-enter'),
    'data-book-enter is stale after the animation',
  ).toBeNull();
});

// ---------------------------------------------------------------------------
// Criterion 2 (reduced motion) - the entry animation is instant (the motion
// token / reduced-motion catch-all collapses its duration) while the state
// change still happens.
// ---------------------------------------------------------------------------
test('criterion 2 (reduced motion): entry animation collapses to instant and still clears', async () => {
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await openBookViewAwaitEntry();
  await win.waitForFunction(() => window.__entry && window.__entry.seen, null, { timeout: 8000 });

  const entry = await readEntry();
  console.log('P77_ENTER reduced ' + JSON.stringify(entry));

  expect(entry.seen, 'entry marker was never observed while live').toBe(true);
  expect(entry.name, 'entry animation-name under reduced motion').toContain('tf-book-view-enter');
  expect(
    parseFloat(entry.duration),
    `reduced-motion entry duration ${entry.duration} is not instant`,
  ).toBeLessThanOrEqual(0.001);

  await win.waitForFunction(
    () => document.querySelector('[data-book-view]').getAttribute('data-book-enter') === null,
    null,
    { timeout: 4000 },
  );
});

// ---------------------------------------------------------------------------
// Criterion 3 - the progress label is spread-aware: single "Page N of T",
// double "Page N-M of T" (M clamped at the last page). 12-page CBZ so the
// clamp case is exact (Page 11-12 of 12).
// ---------------------------------------------------------------------------
test('criterion 3: spread-aware progress label in single, double and the clamped last spread', async () => {
  await openBookView(CBZ);

  await win.locator('[aria-label="Book single page"]').click();
  await win.waitForSelector('[data-book-stage][data-book-layout="single"]', { timeout: 5000 });
  await win.waitForTimeout(500);
  const single = await progressText();
  await win.screenshot({ path: path.join(SHOTS, 'phase77-bookview-label-single.png') });
  expect(single, 'single-mode label').toBe('Page 1 of 12');

  await win.locator('[aria-label="Book double page"]').click();
  await win.waitForSelector('[data-book-stage][data-book-layout="double"]', { timeout: 5000 });
  await win.waitForTimeout(500);
  const double = await progressText();
  await win.screenshot({ path: path.join(SHOTS, 'phase77-bookview-label-double.png') });
  expect(double, 'double-mode label').toBe('Page 1-2 of 12');

  await win.locator('[data-book-page-side="right"]').click();
  await win.waitForTimeout(600);
  expect(await progressText(), 'after one double forward turn').toBe('Page 3-4 of 12');

  const next = win.locator('[data-book-next]');
  let guard = 0;
  while ((await next.isEnabled()) && guard < 12) {
    await next.click();
    await win.waitForTimeout(500);
    guard += 1;
  }
  const last = await progressText();
  console.log(
    'P77_LABEL single=' + single + ' double=' + double + ' last=' + last + ' nextClicks=' + guard,
  );
  expect(last, 'last spread clamps to T-1 - T').toBe('Page 11-12 of 12');
  expect(await pageNumbers(), 'last spread pages').toEqual(['11', '12']);
});

// ---------------------------------------------------------------------------
// Criterion 5 - the single<->double toggle runs the transient
// `tf-book-relayout` animation on the stage and anchors the current page as the
// left/only page of the new layout. Both directions animate; the marker clears.
// ---------------------------------------------------------------------------
test('criterion 5: single<->double toggle animates tf-book-relayout and anchors the current page', async () => {
  await openBookView(CBZ);
  await win.locator('[aria-label="Book single page"]').click();
  await win.waitForSelector('[data-book-stage][data-book-layout="single"]', { timeout: 5000 });
  await win.waitForTimeout(500);
  expect(await pageNumbers(), 'did not reset to single page 1').toEqual(['1']);

  // single -> double
  await armStageMarker('data-book-relayout', 'true');
  await win.locator('[aria-label="Book double page"]').click();
  await win.waitForFunction(() => window.__marker && window.__marker.seen, null, { timeout: 5000 });
  const toDouble = await win.evaluate(() => window.__marker);
  await pauseNamedAnimation('[data-book-stage]', 'tf-book-relayout', 90);
  await win.screenshot({ path: path.join(SHOTS, 'phase77-bookview-relayout.png') });
  await resumeAnimations('[data-book-stage]');
  await win.waitForSelector('[data-book-stage][data-book-layout="double"]', { timeout: 5000 });
  await win.waitForTimeout(500);
  console.log(
    'P77_RELAYOUT single->double ' + JSON.stringify(toDouble) +
    ' pages=' + JSON.stringify(await pageNumbers()),
  );
  expect(toDouble.name, 'relayout animation-name (single->double)').toContain('tf-book-relayout');
  expect(
    parseFloat(toDouble.duration),
    `relayout duration ${toDouble.duration} is not > 0`,
  ).toBeGreaterThan(0);
  expect(await pageNumbers(), 'page 1 was not anchored as the new left page').toEqual(['1', '2']);

  // double -> single
  await win.locator('[data-book-page-side="right"]').click();
  await win.waitForTimeout(600);
  expect(await pageNumbers(), 'setup did not reach spread 3,4').toEqual(['3', '4']);
  await armStageMarker('data-book-relayout', 'true');
  await win.locator('[aria-label="Book single page"]').click();
  await win.waitForFunction(() => window.__marker && window.__marker.seen, null, { timeout: 5000 });
  const toSingle = await win.evaluate(() => window.__marker);
  await win.waitForSelector('[data-book-stage][data-book-layout="single"]', { timeout: 5000 });
  await win.waitForTimeout(500);
  console.log(
    'P77_RELAYOUT double->single ' + JSON.stringify(toSingle) +
    ' pages=' + JSON.stringify(await pageNumbers()),
  );
  expect(toSingle.name, 'relayout animation-name (double->single)').toContain('tf-book-relayout');
  expect(parseFloat(toSingle.duration)).toBeGreaterThan(0);
  expect(await pageNumbers(), 'left page 3 was not anchored on double->single').toEqual(['3']);

  // the transient marker self-clears
  await win.waitForFunction(
    () => document.querySelector('[data-book-stage]').getAttribute('data-book-relayout') === null,
    null,
    { timeout: 5000 },
  );
});

// ---------------------------------------------------------------------------
// Criterion 5 (reduced motion) - the relayout collapses to instant while the
// mode still switches.
// ---------------------------------------------------------------------------
test('criterion 5 (reduced motion): relayout collapses to instant and still switches mode', async () => {
  await openBookView(CBZ);
  await win.locator('[aria-label="Book single page"]').click();
  await win.waitForSelector('[data-book-stage][data-book-layout="single"]', { timeout: 5000 });
  await win.waitForTimeout(500);

  await win.emulateMedia({ reducedMotion: 'reduce' });
  await win.waitForTimeout(200);
  const raw = await win.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--motion-duration-layout'),
  );

  await armStageMarker('data-book-relayout', 'true');
  await win.locator('[aria-label="Book double page"]').click();
  await win.waitForSelector('[data-book-stage][data-book-layout="double"]', { timeout: 5000 });
  const marker = await win.evaluate(() => window.__marker);
  console.log(
    'P77_RELAYOUT reduced marker=' + JSON.stringify(marker) +
    ' token=' + raw + ' pages=' + JSON.stringify(await pageNumbers()),
  );

  expect(parseFloat(raw), `token not 0 under reduced motion (${raw})`).toBe(0);
  expect(marker.seen, 'relayout marker was never observed under reduced motion').toBe(true);
  expect(marker.name, 'relayout animation-name under reduced motion').toContain('tf-book-relayout');
  expect(
    parseFloat(marker.duration),
    `reduced-motion relayout duration ${marker.duration} is not instant`,
  ).toBeLessThanOrEqual(0.001);
  expect(await pageNumbers(), 'mode did not switch under reduced motion').toEqual(['1', '2']);
});
