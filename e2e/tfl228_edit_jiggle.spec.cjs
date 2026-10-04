// TFL-228 A / Phase 75 (item A) — the EDIT-mode iOS-style jiggle.
//
// Focused verification of the delivered contract on BOTH surfaces:
//   pen -> EDIT mode adds a CONTINUOUS, per-icon-DESYNCHRONISED jiggle
//   (`.anim-jiggle` / `tf-anim-jiggle`) to every curated glyph (dock
//   `.action-dock-icon`, home `.home-tool-icon`); there is NO entry
//   `anim-vibrate`; exiting EDIT removes the animation and returns every glyph
//   to its identity resting pose; a jiggling glyph still dispatches its click;
//   minus/plus still curate; reduced motion suppresses the jiggle without
//   disarming EDIT; and the jiggle is transform-only, so no layout reflows.
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const DOCK = '[data-action-dock]';
const HOME_ROW = '[data-home-tools]';
const DOCK_ICON = '[data-dock-verb] .action-dock-icon';
const HOME_ICON = '[data-home-tool]:not([data-home-tool="open"]) .home-tool-icon';

test.setTimeout(300000);

function userData(tag) {
  return path.join(os.tmpdir(), `tflex-tfl228-${tag}-${Date.now()}`);
}

async function openWelcome(win) {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForSelector(HOME_ROW, { timeout: 30000 });
  await win.waitForTimeout(400);
}

async function openReport(win) {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector(DOCK, { timeout: 30000 });
  await win.waitForTimeout(1200);
}

// The computed animation state of every curated glyph for a surface.
async function iconAudit(win, selector) {
  return win.evaluate((sel) => {
    const icons = Array.from(document.querySelectorAll(sel));
    return {
      count: icons.length,
      names: icons.map((el) => getComputedStyle(el).animationName),
      delays: icons.map((el) => getComputedStyle(el).animationDelay),
    };
  }, selector);
}

// Sample one glyph's computed `rotate`/`translate` (the independent properties
// the keyframes animate) over rAF frames, with each frame's elapsed ms. The
// span covers more than one 350ms jiggle period, so a live animation must show
// more than one pose. The frame deltas double as a coarse frame-rate signal.
async function sampleFrames(win, selector, frames) {
  return win.evaluate(
    async ({ sel, n }) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const out = [];
      let last = performance.now();
      for (let i = 0; i < n; i += 1) {
        await new Promise((r) => requestAnimationFrame(r));
        const t = performance.now();
        const cs = getComputedStyle(el);
        out.push({ dt: t - last, rotate: cs.rotate, translate: cs.translate, name: cs.animationName });
        last = t;
      }
      return out;
    },
    { sel: selector, n: frames },
  );
}

// The viewport rects of a glyph, its owning button, and (when present) the
// dock root. The root lets the dock check compare a button's position RELATIVE
// to the dock, since entering EDIT legitimately grows the centred dock (minus
// badges + plus) and re-centres every button — that reflow is Phase 58/59
// chrome, not the jiggle.
async function rects(win, iconSel, btnSel) {
  return win.evaluate(
    ({ i, b }) => {
      const icon = document.querySelector(i);
      const btn = document.querySelector(b);
      const dock = document.querySelector('[data-action-dock]');
      return {
        icon: icon === null ? null : icon.getBoundingClientRect().toJSON(),
        btn: btn === null ? null : btn.getBoundingClientRect().toJSON(),
        dock: dock === null ? null : dock.getBoundingClientRect().toJSON(),
      };
    },
    { i: iconSel, b: btnSel },
  );
}

test('dock EDIT jiggle: no entry shake, desynchronised + continuous, clean stop, clicks still run', async () => {
  const app = await launchApp([], userData('dock'));
  const win = await app.firstWindow();
  await openReport(win);

  const root = win.locator(DOCK);
  expect(await root.getAttribute('data-dock-edit')).toBe('false');

  // Rest geometry of one curated verb BEFORE EDIT (glyph + its button).
  const rest = await rects(win, '[data-dock-verb="rotate"] .action-dock-icon', '[data-dock-verb="rotate"]');
  expect(rest.icon, 'the rotate glyph exists at rest').not.toBeNull();

  await win.locator('[data-dock-edit-toggle]').click();
  await win.waitForTimeout(250);
  expect(await root.getAttribute('data-dock-edit')).toBe('true');

  // (a) Entering EDIT is not a shake: no vibration on the dock root.
  const rootInfo = await win.evaluate(() => {
    const d = document.querySelector('[data-action-dock]');
    const cs = getComputedStyle(d);
    return { className: String(d.className), animationName: cs.animationName };
  });
  console.log(`[TFL228-dock] root className="${rootInfo.className}" animationName="${rootInfo.animationName}"`);
  expect(rootInfo.className).not.toContain('anim-vibrate');
  expect(rootInfo.animationName).not.toContain('tf-anim-vibrate');

  // (b) Every curated glyph jiggles (not vibrates), and delays are not all equal.
  const audit = await iconAudit(win, DOCK_ICON);
  console.log(`[TFL228-dock] jiggle icons=${audit.count} names=${JSON.stringify(audit.names)} delays=${JSON.stringify(audit.delays)}`);
  expect(audit.count).toBeGreaterThan(1);
  for (const name of audit.names) expect(name).toContain('tf-anim-jiggle');
  for (const name of audit.names) expect(name).not.toContain('tf-anim-vibrate');
  expect(new Set(audit.delays).size).toBeGreaterThan(1);

  // (c) Continuous: the pose changes across frames, and no gross frame stall.
  const frames = await sampleFrames(win, '[data-dock-verb="rotate"] .action-dock-icon', 32);
  expect(frames).not.toBeNull();
  const poses = frames.map((f) => `${f.rotate}|${f.translate}`);
  console.log(`[TFL228-dock] pose samples distinct=${new Set(poses).size}/${poses.length} first=${poses[0]} last=${poses[poses.length - 1]}`);
  expect(new Set(poses).size).toBeGreaterThan(1);
  const gaps = frames.map((f) => f.dt).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  const p95 = gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.95))];
  const maxGap = gaps[gaps.length - 1];
  console.log(`[TFL228-dock] rAF frame gaps ms: median=${median.toFixed(1)} p95=${p95.toFixed(1)} max=${maxGap.toFixed(1)}`);
  expect(maxGap, `rAF max frame gap ${maxGap.toFixed(1)}ms (gross stall if >=250)`).toBeLessThan(250);

  // (d) No layout shift caused by the jiggle. Entering EDIT legitimately grows
  //     the centred dock (minus badges + plus), so the button's position is
  //     compared RELATIVE to the dock root (layout-invariant), and the button's
  //     absolute box is sampled at two distinct jiggle phases to prove the
  //     animation never reflows the row. The glyph itself moves only within the
  //     jiggle amplitude (its own transform).
  const jig = await rects(win, '[data-dock-verb="rotate"] .action-dock-icon', '[data-dock-verb="rotate"]');
  const restOffset = rest.btn.x - rest.dock.x;
  const jigOffset = jig.btn.x - jig.dock.x;
  const offsetDx = Math.abs(jigOffset - restOffset);
  const btnDyEdit = Math.abs(jig.btn.y - rest.btn.y);
  const btn1 = await win.evaluate(() => document.querySelector('[data-dock-verb="rotate"]').getBoundingClientRect().toJSON());
  await win.waitForTimeout(90);
  const btn2 = await win.evaluate(() => document.querySelector('[data-dock-verb="rotate"]').getBoundingClientRect().toJSON());
  const phaseDx = Math.abs(btn2.x - btn1.x);
  const phaseDy = Math.abs(btn2.y - btn1.y);
  // The glyph's offset WITHIN its button: entering EDIT re-centres the whole
  // dock, so an absolute comparison is confounded; the glyph-relative offset
  // isolates the jiggle and must stay within its own translate/rotate amplitude.
  const iconDx = Math.abs((jig.icon.x - jig.btn.x) - (rest.icon.x - rest.btn.x));
  const iconDy = Math.abs((jig.icon.y - jig.btn.y) - (rest.icon.y - rest.btn.y));
  console.log(`[TFL228-dock] layout shift btn-in-dock dx=${offsetDx.toFixed(2)} btn dy(edit)=${btnDyEdit.toFixed(2)} btn-phase dx=${phaseDx.toFixed(2)} dy=${phaseDy.toFixed(2)} icon dx=${iconDx.toFixed(2)} dy=${iconDy.toFixed(2)}`);
  expect(offsetDx, 'button position relative to the dock is preserved').toBeLessThan(0.5);
  expect(btnDyEdit, 'no vertical reflow from entering EDIT').toBeLessThan(0.5);
  expect(phaseDx, 'the jiggle does not reflow the verb button').toBeLessThan(0.5);
  expect(phaseDy, 'the jiggle does not reflow the verb button').toBeLessThan(0.5);
  expect(iconDx).toBeLessThan(4);
  expect(iconDy).toBeLessThan(4);
  await win.screenshot({ path: path.join(SHOTS, 'tfl228-dock-jiggle.png') });

  // (e) No dropped clicks: a jiggling glyph's tool still runs (`split` opens the
  //     split dialog; closed via its own close button to stay in EDIT).
  await win.waitForSelector('[data-dock-verb="split"] .action-dock-icon', { timeout: 8000 });
  await win.locator('[data-dock-verb="split"] .action-dock-icon').click();
  await win.waitForSelector('[role="dialog"]', { timeout: 8000 });
  expect(await win.locator('[role="dialog"]').count()).toBeGreaterThanOrEqual(1);
  await win.locator('[role="dialog"] .modal-close').first().click();
  await win.waitForSelector('[role="dialog"]', { state: 'hidden', timeout: 8000 });
  expect(await root.getAttribute('data-dock-edit')).toBe('true');

  // minus fires: removes a verb without running it.
  const beforeCount = await win.locator('[data-dock-verb]').count();
  await win.locator('[data-dock-minus="rotate"]').click();
  await win.waitForTimeout(700);
  expect(await win.locator('[data-dock-verb="rotate"]').count()).toBe(0);
  expect(await win.locator('[data-dock-verb]').count()).toBe(beforeCount - 1);
  expect(await win.locator('[role="dialog"]').count()).toBe(0);

  // plus fires: opens the picker; toggle it closed (stay in EDIT).
  await win.locator('[data-dock-plus]').click();
  await win.waitForSelector('[data-dock-picker-item]', { timeout: 8000 });
  expect(await win.locator('[data-dock-picker-item]').count()).toBeGreaterThanOrEqual(1);
  await win.locator('[data-dock-plus]').click();
  await win.waitForSelector('[data-dock-picker]', { state: 'hidden', timeout: 8000 });

  // (f) Clean stop: exiting EDIT removes the jiggle and every glyph rests at
  //     identity (no residual offset).
  await win.locator('[data-dock-edit-toggle]').click();
  await win.waitForTimeout(400);
  expect(await root.getAttribute('data-dock-edit')).toBe('false');
  const stopped = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-dock-verb] .action-dock-icon')).map((el) => {
      const cs = getComputedStyle(el);
      return { name: cs.animationName, rotate: cs.rotate, translate: cs.translate, transform: cs.transform };
    }));
  console.log(`[TFL228-dock] after exit sample=${JSON.stringify(stopped.slice(0, 3))}`);
  for (const s of stopped) {
    expect(s.name).toBe('none');
    expect(s.rotate).toBe('none');
    expect(s.translate).toBe('none');
    expect(s.transform).toBe('none');
  }
  await win.screenshot({ path: path.join(SHOTS, 'tfl228-dock-rest.png') });
  await hardClose(app, 'tfl228-dock');
});

test('home EDIT jiggle: no entry shake, desynchronised + continuous, clean stop, clicks still run', async () => {
  const app = await launchApp([], userData('home'));
  const win = await app.firstWindow();
  await openWelcome(win);

  const row = win.locator(HOME_ROW);
  expect(await row.getAttribute('data-home-edit')).toBe('false');

  const rest = await rects(win, '[data-home-tool="merge"] .home-tool-icon', '[data-home-tool="merge"]');
  expect(rest.icon, 'the merge glyph exists at rest').not.toBeNull();

  await win.locator('[data-home-edit-toggle]').click();
  await win.waitForTimeout(250);
  expect(await row.getAttribute('data-home-edit')).toBe('true');

  // (a) Entering EDIT is not a shake: no vibration on the home row.
  const rootInfo = await win.evaluate(() => {
    const r = document.querySelector('[data-home-tools]');
    const cs = getComputedStyle(r);
    return { className: String(r.className), animationName: cs.animationName };
  });
  console.log(`[TFL228-home] root className="${rootInfo.className}" animationName="${rootInfo.animationName}"`);
  expect(rootInfo.className).not.toContain('anim-vibrate');
  expect(rootInfo.animationName).not.toContain('tf-anim-vibrate');

  // (b) Every tile glyph jiggles (not vibrates); delays are not all equal.
  const audit = await iconAudit(win, HOME_ICON);
  const fixedAnim = await win.evaluate(() => getComputedStyle(document.querySelector('[data-home-tool="open"] .home-tool-icon')).animationName);
  console.log(`[TFL228-home] jiggle icons=${audit.count} names=${JSON.stringify(audit.names)} delays=${JSON.stringify(audit.delays)} fixed=${fixedAnim}`);
  expect(audit.count).toBeGreaterThan(1);
  for (const name of audit.names) expect(name).toContain('tf-anim-jiggle');
  for (const name of audit.names) expect(name).not.toContain('tf-anim-vibrate');
  expect(new Set(audit.delays).size).toBeGreaterThan(1);
  expect(fixedAnim, 'the fixed open tile is static').toBe('none');

  // (c) Continuous pose change + coarse frame-rate sanity.
  const frames = await sampleFrames(win, '[data-home-tool="merge"] .home-tool-icon', 32);
  expect(frames).not.toBeNull();
  const poses = frames.map((f) => `${f.rotate}|${f.translate}`);
  console.log(`[TFL228-home] pose samples distinct=${new Set(poses).size}/${poses.length} first=${poses[0]} last=${poses[poses.length - 1]}`);
  expect(new Set(poses).size).toBeGreaterThan(1);
  const gaps = frames.map((f) => f.dt).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  const p95 = gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.95))];
  const maxGap = gaps[gaps.length - 1];
  console.log(`[TFL228-home] rAF frame gaps ms: median=${median.toFixed(1)} p95=${p95.toFixed(1)} max=${maxGap.toFixed(1)}`);
  expect(maxGap, `rAF max frame gap ${maxGap.toFixed(1)}ms (gross stall if >=250)`).toBeLessThan(250);

  // (d) No layout shift.
  const jig = await rects(win, '[data-home-tool="merge"] .home-tool-icon', '[data-home-tool="merge"]');
  const btnDx = Math.abs(jig.btn.x - rest.btn.x);
  const btnDy = Math.abs(jig.btn.y - rest.btn.y);
  const iconDx = Math.abs(jig.icon.x - rest.icon.x);
  const iconDy = Math.abs(jig.icon.y - rest.icon.y);
  console.log(`[TFL228-home] layout shift btn dx=${btnDx.toFixed(2)} dy=${btnDy.toFixed(2)} icon dx=${iconDx.toFixed(2)} dy=${iconDy.toFixed(2)}`);
  expect(btnDx).toBeLessThan(1);
  expect(btnDy).toBeLessThan(1);
  expect(iconDx).toBeLessThan(4);
  expect(iconDy).toBeLessThan(4);
  await win.screenshot({ path: path.join(SHOTS, 'tfl228-home-jiggle.png') });

  // (e) No dropped clicks: a jiggling tile still runs (`createFromImages`
  //     opens the create dialog; closed via its own close button).
  await win.locator('[data-home-tool="createFromImages"] .home-tool-icon').click();
  await win.waitForSelector('[role="dialog"]', { timeout: 8000 });
  expect(await win.locator('[role="dialog"]').count()).toBeGreaterThanOrEqual(1);
  await win.locator('[role="dialog"] .modal-close').first().click();
  await win.waitForSelector('[role="dialog"]', { state: 'hidden', timeout: 8000 });
  expect(await row.getAttribute('data-home-edit')).toBe('true');

  // minus fires: removes a tile without running it.
  const beforeCount = await win.locator('[data-home-tool]').count();
  await win.locator('[data-home-minus="merge"]').click();
  await win.waitForTimeout(500);
  expect(await win.locator('[data-home-tool="merge"]').count()).toBe(0);
  expect(await win.locator('[data-home-tool]').count()).toBe(beforeCount - 1);
  expect(await win.locator('[role="dialog"]').count()).toBe(0);

  // plus fires: opens the picker; toggle it closed (stay in EDIT).
  await win.locator('[data-home-plus]').click();
  await win.waitForSelector('[data-home-picker-item]', { timeout: 8000 });
  expect(await win.locator('[data-home-picker-item]').count()).toBeGreaterThanOrEqual(1);
  await win.locator('[data-home-plus]').click();
  await win.waitForSelector('[data-home-picker]', { state: 'hidden', timeout: 8000 });

  // (f) Clean stop.
  await win.locator('[data-home-edit-toggle]').click();
  await win.waitForTimeout(400);
  expect(await row.getAttribute('data-home-edit')).toBe('false');
  const stopped = await win.evaluate(() =>
    Array.from(document.querySelectorAll('.home-tool-icon')).map((el) => {
      const cs = getComputedStyle(el);
      return { name: cs.animationName, rotate: cs.rotate, translate: cs.translate, transform: cs.transform };
    }));
  console.log(`[TFL228-home] after exit sample=${JSON.stringify(stopped.slice(0, 3))}`);
  for (const s of stopped) {
    expect(s.name).toBe('none');
    expect(s.rotate).toBe('none');
    expect(s.translate).toBe('none');
    expect(s.transform).toBe('none');
  }
  await win.screenshot({ path: path.join(SHOTS, 'tfl228-home-rest.png') });
  await hardClose(app, 'tfl228-home');
});

test('reduced motion: EDIT arms, no jiggle on dock/home, minus/plus still fire', async () => {
  const app = await launchApp([], userData('rm'));
  const win = await app.firstWindow();
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await openWelcome(win);

  // Home: EDIT arms with no glyph jiggle; plus/minus still work.
  await win.locator('[data-home-edit-toggle]').click();
  await win.waitForTimeout(300);
  expect(await win.locator(HOME_ROW).getAttribute('data-home-edit')).toBe('true');
  let names = await win.evaluate(() =>
    Array.from(document.querySelectorAll('.home-tool-icon')).map((el) => getComputedStyle(el).animationName));
  console.log(`[TFL228-rm] home icon animation-names=${JSON.stringify(names)}`);
  expect(names.length).toBeGreaterThan(1);
  for (const n of names) expect(n).not.toContain('tf-anim-jiggle');
  expect(await win.locator('[data-home-plus]').count()).toBe(1);
  await win.locator('[data-home-plus]').click();
  await win.waitForSelector('[data-home-picker-item]', { timeout: 8000 });
  expect(await win.locator('[data-home-picker-item]').count()).toBeGreaterThanOrEqual(1);
  await win.locator('[data-home-plus]').click();
  const homeBefore = await win.locator('[data-home-tool]').count();
  await win.locator('[data-home-minus="merge"]').click();
  await win.waitForTimeout(400);
  expect(await win.locator('[data-home-tool="merge"]').count()).toBe(0);
  expect(await win.locator('[data-home-tool]').count()).toBe(homeBefore - 1);
  await win.screenshot({ path: path.join(SHOTS, 'tfl228-rm-home.png') });

  // Dock: open a document, EDIT arms with no glyph jiggle; plus/minus still work.
  await openReport(win);
  await win.locator('[data-dock-edit-toggle]').click();
  await win.waitForTimeout(300);
  expect(await win.locator(DOCK).getAttribute('data-dock-edit')).toBe('true');
  names = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-dock-verb] .action-dock-icon')).map((el) => getComputedStyle(el).animationName));
  console.log(`[TFL228-rm] dock icon animation-names=${JSON.stringify(names)}`);
  expect(names.length).toBeGreaterThan(1);
  for (const n of names) expect(n).not.toContain('tf-anim-jiggle');
  await win.locator('[data-dock-plus]').click();
  await win.waitForSelector('[data-dock-picker-item]', { timeout: 8000 });
  expect(await win.locator('[data-dock-picker-item]').count()).toBeGreaterThanOrEqual(1);
  await win.locator('[data-dock-plus]').click();
  const dockBefore = await win.locator('[data-dock-verb]').count();
  await win.locator('[data-dock-minus="rotate"]').click();
  await win.waitForTimeout(700);
  expect(await win.locator('[data-dock-verb="rotate"]').count()).toBe(0);
  expect(await win.locator('[data-dock-verb]').count()).toBe(dockBefore - 1);
  await win.screenshot({ path: path.join(SHOTS, 'tfl228-rm-dock.png') });
  await hardClose(app, 'tfl228-rm');
});
