// Phase 106 (chunk B) - focused QA verification of the Orbit Desk decorative
// motif + slow ambient motion, in the real Electron app.
//
// TFL-938 update: the pause control now toggles a HOME-SCOPED persisted
// preference (`AppSettings.homeMotionPaused`) instead of the global Animations
// setting. This spec verifies the new contract:
//
//   - the thin low-opacity violet/amber arc layer mounts (aria-hidden,
//     pointer-events:none) and drifts on the 18s/20deg shared motion tokens by
//     default;
//   - the visible "Pause background motion" control pins the arcs and persists
//     `homeMotionPaused=true`;
//   - pausing Home must NOT touch the global Animations setting: root
//     `data-animations` stays "on" and `animationsEnabled` stays true;
//   - the global Animations OFF switch still independently gates the arcs
//     (blast radius of the shared settings service / motion policy);
//   - the Home pause survives a relaunch, and window blur/focus, document
//     visibility and OS prefers-reduced-motion still suspend the drift.
//
// Captures light/dark evidence screenshots of the motion-on and motion-paused
// states. QA evidence only - nothing committed.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

delete process.env.ELECTRON_RUN_AS_NODE;

/** Read the persisted settings through the app's own IPC (Result wrapper). */
async function loadSettings(target = win) {
  const res = await target.evaluate(() => window.tflex.loadSettings());
  return res && res.ok ? res.value : null;
}

/** Seed an isolated user-data dir with a settings.json (boot-time contract). */
function seedDir(tag, settings) {
  const ud = path.join(
    os.tmpdir(),
    `tflex-p106motion-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  );
  fs.mkdirSync(ud, { recursive: true });
  if (settings) {
    fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify(settings));
  }
  return ud;
}

let app;
let win;
let pageErrors;

async function setTheme(theme) {
  await win.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await win.waitForFunction(
    (t) => document.documentElement.getAttribute('data-theme') === t,
    theme,
    { timeout: 8000 },
  );
}

function probeMotif() {
  return win.evaluate(() => {
    const motif = document.querySelector('[data-orbit-motif]');
    const orbit = document.querySelector('.orbit-desk-orbit');
    const toggle = document.querySelector('[data-orbit-motion-toggle]');
    const cs = orbit ? getComputedStyle(orbit) : null;
    return {
      motif: !!motif,
      ariaHidden: motif ? motif.getAttribute('aria-hidden') : null,
      pointerEvents: motif ? getComputedStyle(motif).pointerEvents : null,
      motionState: orbit ? orbit.getAttribute('data-orbit-motion') : null,
      animationName: cs ? cs.animationName : null,
      animationDuration: cs ? cs.animationDuration : null,
      opacity: cs ? Number(cs.opacity) : null,
      toggle: !!toggle,
      togglePressed: toggle ? toggle.getAttribute('aria-pressed') : null,
      toggleLabel: toggle ? toggle.getAttribute('aria-label') : null,
      toggleText: toggle ? toggle.textContent.trim() : null,
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

test('chunk B - motif mounts decorative and drifts on the shared 18s/20deg tokens', async () => {
  const p = await probeMotif();
  expect(p.motif).toBe(true);
  expect(p.ariaHidden).toBe('true');
  expect(p.pointerEvents).toBe('none');
  expect(p.motionState).toBe('on');
  expect(p.animationName).toContain('tf-anim-orbit');
  expect(p.animationDuration).toBe('18s');
  expect(p.opacity).toBeGreaterThanOrEqual(0.18);
  expect(p.opacity).toBeLessThanOrEqual(0.28);

  // The keyframes are transform-only (no layout/filter/canvas animation).
  const keyframes = await win.evaluate(() => {
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of rules) {
        if (rule.type === CSSRule.KEYFRAMES_RULE && rule.name === 'tf-anim-orbit') {
          return [...rule.cssRules].map((k) => k.cssText).join(' ');
        }
      }
    }
    return null;
  });
  expect(keyframes).toBeTruthy();
  expect(keyframes).toContain('rotate');
  expect(keyframes).not.toContain('top');
  expect(keyframes).not.toContain('width');
  expect(keyframes).not.toContain('filter');

  // The pause control is discoverable, carries a visible label and reflects
  // the live state.
  expect(p.toggle).toBe(true);
  expect(p.togglePressed).toBe('false');
  expect(p.toggleLabel).toBe('Pause background motion');
  expect(p.toggleText).toContain('Pause background motion');
  expect(p.rootAnimations).toBe('on');

  await setTheme('light');
  await sleep(300);
  await win.screenshot({ path: path.join(SHOTS, 'phase106-chunkB-motion-light.png') });
  await setTheme('dark');
  await sleep(300);
  await win.screenshot({ path: path.join(SHOTS, 'phase106-chunkB-motion-dark.png') });
  expect(pageErrors).toEqual([]);
});

test('chunk B - the pause control toggles the Home-only preference and holds the static pose', async () => {
  const before = await probeMotif();
  expect(before.motionState).toBe('on');
  const beforeSettings = await loadSettings();
  expect(beforeSettings?.homeMotionPaused ?? false).toBe(false);

  await win.click('[data-orbit-motion-toggle]');
  await win.waitForFunction(
    () => document.querySelector('.orbit-desk-orbit')?.getAttribute('data-orbit-motion') === 'off',
    null,
    { timeout: 8000 },
  );
  const paused = await probeMotif();
  expect(paused.motionState).toBe('off');
  expect(paused.animationName).toBe('none');
  expect(paused.togglePressed).toBe('true');
  expect(paused.toggleLabel).toBe('Resume background motion');
  expect(paused.toggleText).toContain('Resume background motion');
  // TFL-938: the Home pause is SCOPED to Home. The global Animations switch
  // must stay ON, so menu / panel / dialog motion is unaffected.
  expect(paused.rootAnimations).toBe('on');
  // The static pose stays attractive (opacity kept, transform held at 0deg).
  expect(paused.opacity).toBeGreaterThanOrEqual(0.18);
  expect(paused.opacity).toBeLessThanOrEqual(0.28);

  // The pause lands as a real persisted Home-only write; the global setting
  // is untouched (the core of TFL-938).
  let stored = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) {
    stored = await loadSettings();
    if (stored && stored.homeMotionPaused === true) break;
    await sleep(200);
  }
  expect(stored?.homeMotionPaused).toBe(true);
  expect(stored?.animationsEnabled).not.toBe(false);

  await setTheme('light');
  await sleep(300);
  await win.screenshot({ path: path.join(SHOTS, 'phase106-chunkB-paused-light.png') });
  await setTheme('dark');
  await sleep(300);
  await win.screenshot({ path: path.join(SHOTS, 'phase106-chunkB-paused-dark.png') });

  // Resume restores the drift through the same Home-only preference.
  await win.click('[data-orbit-motion-toggle]');
  await win.waitForFunction(
    () => document.querySelector('.orbit-desk-orbit')?.getAttribute('data-orbit-motion') === 'on',
    null,
    { timeout: 8000 },
  );
  const resumed = await probeMotif();
  expect(resumed.motionState).toBe('on');
  expect(resumed.animationName).toContain('tf-anim-orbit');
  expect(resumed.toggleLabel).toBe('Pause background motion');
  // Still scoped: resuming Home never flips the global Animations switch.
  expect(resumed.rootAnimations).toBe('on');
  expect(pageErrors).toEqual([]);
});

test('chunk B - pause control geometry and non-overlap evidence', async () => {
  const geo = await win.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };
    };
    const toggle = q('[data-orbit-motion-toggle]');
    const header = q('.orbit-desk-header');
    const hero = q('.welcome-hero');
    const brand = q('.welcome-brand');
    const title = q('.welcome-title');
    const motif = q('[data-orbit-motif]');
    const tr = toggle ? toggle.getBoundingClientRect() : null;
    const hit = tr
      ? document.elementFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2)
      : null;
    return {
      togglePosition: toggle ? getComputedStyle(toggle).position : null,
      toggleZ: toggle ? getComputedStyle(toggle).zIndex : null,
      toggle: rect(toggle),
      header: rect(header),
      hero: rect(hero),
      brand: rect(brand),
      brandPosition: brand ? getComputedStyle(brand).position : null,
      brandZ: brand ? getComputedStyle(brand).zIndex : null,
      title: rect(title),
      motifPointerEvents: motif ? getComputedStyle(motif).pointerEvents : null,
      hitAtToggleCentre: hit
        ? (hit === toggle || toggle.contains(hit) ? 'toggle' : `${hit.tagName}.${hit.className}`)
        : null,
    };
  });
  fs.writeFileSync(path.join(SHOTS, 'phase106-chunkB-geometry.json'), JSON.stringify(geo, null, 2));
  // DEF-589: the pause control must be pinned to the header's top-right
  // (`position: absolute; top: 0; right: 0`), not flowing inline after the
  // wordmark (pre-fix right 862 vs header right 1808).
  expect(geo.toggle).not.toBeNull();
  expect(geo.togglePosition).toBe('absolute');
  expect(geo.toggleZ).toBe('2');
  expect(Math.abs(geo.toggle.top - geo.hero.top)).toBeLessThanOrEqual(2);
  expect(Math.abs(geo.toggle.right - geo.hero.right)).toBeLessThanOrEqual(2);
  // The header-children stacking rule still lifts the sibling content above the
  // motif (the exclusion must not drop the brand/title to position: static).
  expect(geo.brandPosition).toBe('relative');
  expect(geo.brandZ).toBe('1');
  expect(geo.motifPointerEvents).toBe('none');
  // The control stays the top element at its own centre (not covered by the motif).
  expect(geo.hitAtToggleCentre).toBe('toggle');
  // The control is visible and must not overlap the headline.
  expect(geo.toggle.right).toBeLessThanOrEqual(geo.header.right);
  expect(geo.toggle.bottom).toBeLessThanOrEqual(geo.title.top);
  await win.screenshot({ path: path.join(SHOTS, 'phase106-chunkB-header-crop.png') });
});

test('chunk B - window blur, document visibility and reduced motion suspend the drift', async () => {
  // Window blur -> off, focus -> on (a transient suspension, not a pause).
  await win.evaluate(() => window.dispatchEvent(new Event('blur')));
  await win.waitForFunction(
    () => document.querySelector('.orbit-desk-orbit')?.getAttribute('data-orbit-motion') === 'off',
    null,
    { timeout: 8000 },
  );
  await win.evaluate(() => window.dispatchEvent(new Event('focus')));
  await win.waitForFunction(
    () => document.querySelector('.orbit-desk-orbit')?.getAttribute('data-orbit-motion') === 'on',
    null,
    { timeout: 8000 },
  );

  // Document hidden -> off, visible -> on.
  await win.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await win.waitForFunction(
    () => document.querySelector('.orbit-desk-orbit')?.getAttribute('data-orbit-motion') === 'off',
    null,
    { timeout: 8000 },
  );
  await win.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await win.waitForFunction(
    () => document.querySelector('.orbit-desk-orbit')?.getAttribute('data-orbit-motion') === 'on',
    null,
    { timeout: 8000 },
  );

  // OS prefers-reduced-motion -> off (ALWAYS wins), reset -> on.
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await win.waitForFunction(
    () => document.querySelector('.orbit-desk-orbit')?.getAttribute('data-orbit-motion') === 'off',
    null,
    { timeout: 8000 },
  );
  const reduced = await probeMotif();
  expect(reduced.animationName).toBe('none');
  await win.emulateMedia({ reducedMotion: 'no-preference' });
  await win.waitForFunction(
    () => document.querySelector('.orbit-desk-orbit')?.getAttribute('data-orbit-motion') === 'on',
    null,
    { timeout: 8000 },
  );

  expect(pageErrors).toEqual([]);
});

test('chunk B - the Home pause survives a relaunch in the same profile', async () => {
  const profileDir = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));

  await win.click('[data-orbit-motion-toggle]');
  await win.waitForFunction(
    () => document.querySelector('.orbit-desk-orbit')?.getAttribute('data-orbit-motion') === 'off',
    null,
    { timeout: 8000 },
  );
  let stored = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 5000) {
    stored = await loadSettings();
    if (stored && stored.homeMotionPaused === true) break;
    await sleep(200);
  }
  expect(stored?.homeMotionPaused).toBe(true);

  await hardClose(app, 'p106-relaunch');
  app = await launchApp([], profileDir);
  win = await app.firstWindow();
  await win.waitForSelector('.welcome.orbit-desk', { timeout: 30000 });
  await win.waitForSelector('[data-orbit-motif]', { timeout: 30000 });

  const reboot = await probeMotif();
  expect(reboot.motionState).toBe('off');
  expect(reboot.animationName).toBe('none');
  expect(reboot.togglePressed).toBe('true');
  expect(reboot.toggleLabel).toBe('Resume background motion');
  // Scoped: the Home pause survives the relaunch without disabling the global
  // Animations switch.
  expect(reboot.rootAnimations).toBe('on');
  expect(pageErrors).toEqual([]);
});

test('chunk B - the global Animations switch still gates the arcs independently', async () => {
  // Blast radius: the Home pause adds a branch to the SHARED settings service
  // and motion policy. The nearest interacting surface is the global
  // `animationsEnabled` switch, which must keep working on its own.
  if (app) {
    await hardClose(app, 'p106-blast-pre');
    app = null;
    win = null;
  }

  const cases = [
    { tag: 'animations-off', settings: { animationsEnabled: false }, root: 'off', state: 'off' },
    { tag: 'home-paused', settings: { animationsEnabled: true, homeMotionPaused: true }, root: 'on', state: 'off' },
    { tag: 'both-off', settings: { animationsEnabled: false, homeMotionPaused: true }, root: 'off', state: 'off' },
  ];

  for (const c of cases) {
    const ud = seedDir(c.tag, c.settings);
    const a = await launchApp([], ud);
    const w = await a.firstWindow();
    try {
      await w.waitForSelector('.welcome.orbit-desk', { timeout: 30000 });
      await w.waitForSelector('[data-orbit-motif]', { timeout: 30000 });
      await w.waitForFunction(
        (expected) => document.documentElement.getAttribute('data-animations') === expected,
        c.root,
        { timeout: 8000 },
      );
      const probe = await w.evaluate(() => {
        const orbit = document.querySelector('.orbit-desk-orbit');
        const cs = orbit ? getComputedStyle(orbit) : null;
        return {
          motionState: orbit ? orbit.getAttribute('data-orbit-motion') : null,
          animationName: cs ? cs.animationName : null,
          rootAnimations: document.documentElement.getAttribute('data-animations'),
        };
      });
      expect(probe.rootAnimations, `${c.tag}: root hook`).toBe(c.root);
      expect(probe.motionState, `${c.tag}: orbit state`).toBe(c.state);
      expect(probe.animationName, `${c.tag}: orbit animation`).toBe('none');
    } finally {
      await hardClose(a, `p106-${c.tag}`);
    }
  }
});

test('chunk B - pausing Home leaves app motion intact; the Preferences switch still drives it', async () => {
  // (c) Pause the Home arcs, then open a real app surface (the Preferences
  // dialog) and confirm its motion is NOT collapsed: the Home pause must not
  // touch the global animation layer.
  await win.click('[data-orbit-motion-toggle]');
  await win.waitForFunction(
    () => document.querySelector('.orbit-desk-orbit')?.getAttribute('data-orbit-motion') === 'off',
    null,
    { timeout: 8000 },
  );
  expect(await win.evaluate(() => document.documentElement.getAttribute('data-animations'))).toBe('on');

  // Preferences opens from the restored title-bar gear in the current top bar.
  await win.locator('[data-open-preferences]').click();
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 8000 });
  await win.click('[data-prefs-category="general"]');

  const readPanelMotion = () =>
    win.evaluate(() => {
      const panel = document.querySelector('[data-prefs-panel][data-active="true"]');
      const cs = panel ? getComputedStyle(panel) : null;
      return {
        root: document.documentElement.getAttribute('data-animations'),
        panelFound: !!panel,
        animationName: cs ? cs.animationName : null,
        animationDuration: cs ? cs.animationDuration : null,
      };
    });

  const pausedHome = await readPanelMotion();
  fs.writeFileSync(
    path.join(SHOTS, 'phase106-chunkB-prefs-independence.json'),
    JSON.stringify(pausedHome, null, 2),
  );
  expect(pausedHome.root, 'global animations stay on while Home is paused').toBe('on');
  expect(pausedHome.panelFound).toBe(true);
  expect(pausedHome.animationName).toContain('tf-anim-tab-in');
  // > 0.02s: the Preferences panel's motion is still running, so the Home
  // pause did not disable app-wide animation.
  expect(parseFloat(pausedHome.animationDuration)).toBeGreaterThan(0.02);

  // (d) Flip the GLOBAL Animations switch from Preferences: the app-wide
  // motion layer must collapse (root hook off + near-zero durations).
  await win.click('[data-prefs-animations]');
  await win.waitForFunction(
    () => document.documentElement.getAttribute('data-animations') === 'off',
    null,
    { timeout: 8000 },
  );
  const globalOff = await readPanelMotion();
  expect(globalOff.root).toBe('off');
  expect(parseFloat(globalOff.animationDuration)).toBeLessThanOrEqual(0.02);

  // Restore the global switch so the profile is left as found.
  await win.click('[data-prefs-animations]');
  await win.waitForFunction(
    () => document.documentElement.getAttribute('data-animations') === 'on',
    null,
    { timeout: 8000 },
  );
  expect(pageErrors).toEqual([]);
});