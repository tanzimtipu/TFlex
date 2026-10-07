// TFL-1116 (R10) - the Home Orbit arc contrast + motion scope, in the real app.
//
// Finding R10: the thin violet/amber Home orbit arcs read too faint against the
// gray canvas. This spec verifies the sharper logo-derived ink, the larger
// occupied arc layer, the slow FILTER colour drift (never a flash), and the
// four-gate effective motion scope:
//
//   - at rest the arcs are visible and drift on the 18s/20deg shared tokens,
//     with the hue drift running on the decorative rings;
//   - the visible "Pause background motion" control pins them static (no
//     animation) and reflects aria-pressed / its Resume label;
//   - OS prefers-reduced-motion holds the arcs static regardless.
//
// Captures screenshots/tfl1116_r10_orbit_rest.png, ..._paused.png and
// ..._reduced.png. QA evidence only - nothing committed.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const path = require('node:path');
const fs = require('node:fs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

delete process.env.ELECTRON_RUN_AS_NODE;

let app;
let win;
let pageErrors;

function probeMotif() {
  return win.evaluate(() => {
    const motif = document.querySelector('[data-orbit-motif]');
    const orbit = document.querySelector('.orbit-desk-orbit');
    const toggle = document.querySelector('[data-orbit-motion-toggle]');
    const cs = orbit ? getComputedStyle(orbit) : null;
    const ring = orbit ? getComputedStyle(orbit, '::before') : null;
    return {
      motif: !!motif,
      ariaHidden: motif ? motif.getAttribute('aria-hidden') : null,
      pointerEvents: motif ? getComputedStyle(motif).pointerEvents : null,
      motionState: orbit ? orbit.getAttribute('data-orbit-motion') : null,
      animationName: cs ? cs.animationName : null,
      animationDuration: cs ? cs.animationDuration : null,
      opacity: cs ? Number(cs.opacity) : null,
      ringAnimation: ring ? ring.animationName : null,
      ringFilter: ring ? ring.filter : null,
      width: orbit ? Math.round(orbit.getBoundingClientRect().width) : null,
      toggle: !!toggle,
      togglePressed: toggle ? toggle.getAttribute('aria-pressed') : null,
      toggleLabel: toggle ? toggle.getAttribute('aria-label') : null,
      rootAnimations: document.documentElement.getAttribute('data-animations'),
    };
  });
}

test.beforeEach(async () => {
  if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
  app = await launchApp([]);
  win = await app.firstWindow();
  pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(e.message));
  await win.waitForSelector('.welcome.orbit-desk', { timeout: 30000 });
  await win.waitForSelector('[data-orbit-motif]', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app);
});

test('R10 - the sharper arcs drift and Pause pins them static', async () => {
  const rest = await probeMotif();
  expect(rest.motif).toBe(true);
  expect(rest.ariaHidden).toBe('true');
  expect(rest.pointerEvents).toBe('none');
  expect(rest.motionState).toBe('on');
  expect(rest.animationName).toContain('tf-anim-orbit');
  expect(rest.animationDuration).toBe('18s');
  // The slow colour drift runs on the decorative rings, not as opacity.
  expect(rest.ringAnimation).toContain('tf-anim-orbit-hue');
  expect(rest.ringFilter).toContain('hue-rotate');
  // Sharper ink: opacity at the top of the sanctioned band, larger layer.
  expect(rest.opacity).toBeGreaterThanOrEqual(0.18);
  expect(rest.opacity).toBeLessThanOrEqual(0.28);
  expect(rest.width).toBeGreaterThan(320);
  expect(rest.rootAnimations).toBe('on');

  // The pause control is discoverable and reflects the live state.
  expect(rest.toggle).toBe(true);
  expect(rest.togglePressed).toBe('false');
  expect(rest.toggleLabel).toBe('Pause background motion');
  await sleep(300);
  await win.screenshot({ path: path.join(SHOTS, 'tfl1116_r10_orbit_rest.png') });

  await win.click('[data-orbit-motion-toggle]');
  await win.waitForFunction(
    () => document.querySelector('.orbit-desk-orbit')?.getAttribute('data-orbit-motion') === 'off',
    null,
    { timeout: 8000 },
  );
  const paused = await probeMotif();
  expect(paused.motionState).toBe('off');
  expect(paused.animationName).toBe('none');
  expect(paused.ringAnimation).toBe('none');
  expect(paused.togglePressed).toBe('true');
  expect(paused.toggleLabel).toBe('Resume background motion');
  // Scoped: pausing Home leaves the global Animations switch ON.
  expect(paused.rootAnimations).toBe('on');
  await sleep(300);
  await win.screenshot({ path: path.join(SHOTS, 'tfl1116_r10_orbit_paused.png') });

  expect(pageErrors).toEqual([]);
});

test('R10 - OS reduced motion holds the arcs static', async () => {
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await win.waitForFunction(
    () => document.querySelector('.orbit-desk-orbit')?.getAttribute('data-orbit-motion') === 'off',
    null,
    { timeout: 8000 },
  );
  const reduced = await probeMotif();
  expect(reduced.motionState).toBe('off');
  expect(reduced.animationName).toBe('none');
  expect(reduced.ringAnimation).toBe('none');
  await sleep(300);
  await win.screenshot({ path: path.join(SHOTS, 'tfl1116_r10_orbit_reduced.png') });

  await win.emulateMedia({ reducedMotion: 'no-preference' });
  await win.waitForFunction(
    () => document.querySelector('.orbit-desk-orbit')?.getAttribute('data-orbit-motion') === 'on',
    null,
    { timeout: 8000 },
  );
  expect((await probeMotif()).motionState).toBe('on');
  expect(pageErrors).toEqual([]);
});
