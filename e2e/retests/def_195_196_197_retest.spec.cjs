// RETEST DEF-195 / DEF-196 / DEF-197 (qa, Phase 15 animation fix round).
// Retests the three animation-system defects the Phase-15 audit filed, on the
// dev build rebuilt after the developer's fix pass:
//   DEF-195  theme crossfade dropped to ~30fps (9-property transition on every
//            element) -> fix: View Transitions API primary path + scoped
//            6-property class fallback (fallback probed by shadowing the API).
//   DEF-196  the canonical --motion-scale-press token never applied to tool
//            buttons (legacy 0.982 literal won the cascade).
//   DEF-197  the canonical animation layer (AnimatedDialog/AnimatedPanel/
//            tfPresets) was unwired; presets hardcoded spring values.
// Same measurement shapes as e2e/anim_audit.spec.cjs so the numbers are
// directly comparable with the filing run. Screenshots -> screenshots/def-19[567]-retest*.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchDev, openSample, hardClose } = require('../lib/helpers.cjs');
const { renderFrameGraph } = require('../lib/framegraph.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

let electronApp = null;
let win = null;
let rendererErrors = [];

async function boot() {
  ({ electronApp, window: win } = await launchDev());
  rendererErrors = [];
  win.on('pageerror', (err) => rendererErrors.push(`pageerror: ${err.message}`));
  win.on('console', (msg) => {
    if (msg.type() === 'error') rendererErrors.push(`console.error: ${msg.text()}`);
  });
  await win.waitForSelector('.sample-card', { timeout: 30000 });
}

async function openDoc(name, waitMs = 1800) {
  await openSample(win, electronApp, name);
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await win.waitForTimeout(waitMs);
}

async function closeApp() {
  await hardClose(electronApp, 'def-195-196-197-retest');
  electronApp = null;
  win = null;
}

test.afterEach(async () => {
  if (electronApp) await closeApp();
});

// ---------------------------------------------------------------------------
// In-page rAF sampler (same shapes as anim_audit.spec.cjs).
// ---------------------------------------------------------------------------
async function installSampler() {
  await win.evaluate(() => {
    window.__sDone = true;
    window.__sStart = (sel, ms, extra, pick) => {
      window.__s = [];
      const t0 = performance.now();
      const tick = () => {
        const list = document.querySelectorAll(sel);
        const el = pick === 'last' ? list[list.length - 1] : list[0];
        if (el) {
          const cs = getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          window.__s.push({
            t: Math.round(performance.now() - t0),
            tr: cs.transform, op: cs.opacity,
            an: cs.animationName, ad: cs.animationDuration,
            w: Math.round(rect.width * 10) / 10,
            h: Math.round(rect.height * 10) / 10,
          });
        }
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else window.__sDone = true;
      };
      window.__sDone = false;
      requestAnimationFrame(tick);
    };
  });
}
async function startSample(sel, ms, pick = 'first') {
  await win.evaluate(([s, m, p]) => window.__sStart(s, m, '', p), [sel, ms, pick]);
}
async function readSamples(label) {
  await win.waitForFunction(() => window.__sDone === true, null, { timeout: 10000 }).catch(() => {});
  const s = await win.evaluate(() => window.__s || []);
  if (label) console.log(label, JSON.stringify(s));
  return s;
}
function parseMatrix(tr) {
  if (!tr || tr === 'none') return null;
  const m = tr.match(/matrix\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((s) => parseFloat(s.trim()));
  return { a: p[0], tx: p[4], ty: p[5] };
}

// fps-ONLY rAF meter (timestamps only -> unconfounded by DOM probing).
async function startFps(ms) {
  await win.evaluate((dur) => {
    window.__fps = [];
    const t0 = performance.now();
    const tick = () => {
      window.__fps.push(performance.now() - t0);
      if (performance.now() - t0 < dur) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, ms);
}
async function readFps() {
  const ts = await win.evaluate(() => window.__fps || []);
  if (ts.length < 3) return { frames: ts.length, fps: 0, avgDelta: NaN, maxDelta: NaN, deltas: ts };
  const deltas = [];
  for (let i = 1; i < ts.length; i++) deltas.push(ts[i] - ts[i - 1]);
  const dur = ts[ts.length - 1];
  return {
    frames: ts.length,
    fps: Math.round(((ts.length - 1) / dur) * 1000),
    avgDelta: Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 10) / 10,
    maxDelta: Math.round(Math.max(...deltas)),
    ts,
    deltas,
  };
}

// Layout-shift accumulator (single observer; disconnect on re-arm).
async function startCls() {
  await win.evaluate(() => {
    if (window.__clsObs) window.__clsObs.disconnect();
    window.__cls = 0;
    window.__clsEntries = [];
    window.__clsObs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) {
          window.__cls += e.value;
          window.__clsEntries.push({ v: Math.round(e.value * 1000) / 1000, src: (e.sources || []).map((s) => s.node && (s.node.className || s.node.tagName)).slice(0, 3) });
        }
      }
    });
    window.__clsObs.observe({ type: 'layout-shift', buffered: false });
  });
}
async function readCls() {
  return win.evaluate(() => ({ cls: window.__cls, entries: window.__clsEntries }));
}

// CSSOM probe: crossfade rule shape, press rules, dead 0.982 literals,
// .anim-* utility resolution, token values, theme redeclarations.
async function cssomProbe() {
  return win.evaluate(() => {
    const rules = [];
    const walk = (list) => {
      for (const r of list) {
        if (r.cssRules && r.cssRules.length) { walk(r.cssRules); continue; }
        if (r.selectorText && r.style) rules.push(r);
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules); } catch (e) { /* cross-origin skip */ }
    }
    const crossfade = rules
      .filter((r) => r.selectorText.includes('tf-theme-transitioning') && /(^|;|\s)transition\s*:/.test(r.style.cssText) && !/(^|;|\s)transition\s*:\s*none/.test(r.style.cssText))
      .map((r) => {
        // The shorthand carries var() durations, so transitionProperty may not
        // decompose in CSSOM - parse the property names from the cssText
        // instead (top-level comma split, paren-aware).
        const m = /(^|;|\s)transition\s*:([^;}]+)/.exec(r.style.cssText);
        const raw = (m ? m[2] : '').replace(/!\s*important\s*$/, '').trim();
        const items = [];
        let depth = 0;
        let cur = '';
        for (const ch of raw) {
          if (ch === '(') depth += 1;
          if (ch === ')') depth -= 1;
          if (ch === ',' && depth === 0) { items.push(cur.trim()); cur = ''; } else cur += ch;
        }
        if (cur.trim()) items.push(cur.trim());
        return { sel: r.selectorText.slice(0, 110), props: items.map((it) => it.split(/\s+/)[0]) };
      });
    const pressRules = rules
      .filter((r) => /tool-btn:active/.test(r.selectorText) || /(^|,)\s*\.btn:active/.test(r.selectorText))
      .map((r) => ({ sel: r.selectorText.slice(0, 70), tr: r.style.transform }))
      .filter((r) => r.tr);
    const dead982 = rules
      .filter((r) => /(^|[^\d.])\.982\b/.test(r.style.cssText))
      .map((r) => r.selectorText.slice(0, 80));
    // .anim-* utility resolves at compute time (token-driven keyframes live).
    const probeEl = document.createElement('div');
    probeEl.className = 'anim-pop-in';
    document.body.appendChild(probeEl);
    const pcs = getComputedStyle(probeEl);
    const utility = { an: pcs.animationName, ad: pcs.animationDuration };
    probeEl.remove();
    const themeRedecl = rules
      .filter((r) => /\[data-theme/.test(r.selectorText))
      .filter((r) => r.style.getPropertyValue('--motion-scale-press') || r.style.getPropertyValue('--motion-duration-fast') || r.style.getPropertyValue('--motion-theme-crossfade'))
      .map((r) => r.selectorText.slice(0, 60));
    const cs = getComputedStyle(document.documentElement);
    return {
      crossfade,
      pressRules,
      dead982,
      utility,
      themeRedecl,
      tokens: {
        press: cs.getPropertyValue('--motion-scale-press').trim(),
        enter: cs.getPropertyValue('--motion-scale-enter').trim(),
        exit: cs.getPropertyValue('--motion-scale-exit').trim(),
        crossfade: cs.getPropertyValue('--motion-theme-crossfade').trim(),
        translatePanel: cs.getPropertyValue('--motion-translate-panel').trim(),
      },
      vtApi: typeof document.startViewTransition === 'function',
    };
  });
}

async function flipThemeTo(option) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${option}"]`);
}

// ---------------------------------------------------------------------------
// DEF-195 - theme crossfade: View Transitions API primary path at ~60fps,
// fallback scoped to six colour properties.
// ---------------------------------------------------------------------------
test('DEF-195: crossfade via View Transitions holds ~60fps; fallback scoped to 6 colour properties', async () => {
  test.setTimeout(240000);
  await boot();
  await installSampler();

  const vtApi = await win.evaluate(() => typeof document.startViewTransition === 'function');
  console.log('[195] document.startViewTransition available:', vtApi);
  expect(vtApi, 'Electron renderer must expose the View Transitions API (primary crossfade path)').toBe(true);

  await openDoc('report.pdf', 2000);

  // Quiet idle baseline - the fair comparison from the filing.
  await startFps(700);
  await win.waitForTimeout(800);
  const quiet = await readFps();
  console.log('[195] quiet baseline fps:', JSON.stringify({ fps: quiet.fps, avg: quiet.avgDelta, max: quiet.maxDelta }));

  // Wrap startViewTransition (observation only) so the API path is proven,
  // and arm a class observer - the API path must NEVER add the class.
  await win.evaluate(() => {
    window.__vt = { calls: 0, t0: null, finishedAt: null };
    const orig = document.startViewTransition.bind(document);
    document.startViewTransition = (cb) => {
      window.__vt.calls += 1;
      window.__vt.t0 = performance.now();
      const vt = orig(cb);
      if (vt && vt.finished) vt.finished.then(() => { window.__vt.finishedAt = performance.now(); }).catch(() => {});
      return vt;
    };
    window.__classSeen = false;
    new MutationObserver(() => {
      if (document.documentElement.classList.contains('tf-theme-transitioning')) window.__classSeen = true;
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    // PDF surface probe (confounds THIS flip's fps - the fps verdict uses the
    // unconfounded reverse flip below, same as the filing's A1 shape).
    window.__pdfStates = new Set();
    const t0 = performance.now();
    const tick = () => {
      const page = document.querySelector('.pdf-page');
      const canvas = document.querySelector('.pdf-page-canvas');
      if (page && canvas) {
        window.__pdfStates.add([
          getComputedStyle(page).opacity, getComputedStyle(page).filter,
          getComputedStyle(canvas).opacity, getComputedStyle(canvas).filter,
        ].join('|'));
      }
      if (performance.now() - t0 < 800) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await startCls();
  await startFps(900);
  const themeBefore = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await flipThemeTo('dark');
  await win.waitForTimeout(120);
  await win.screenshot({ path: path.join(SHOTS, 'def-195-retest.png') }); // mid-crossfade blend
  await win.waitForTimeout(900);

  const vt = await win.evaluate(() => window.__vt);
  const pdfStates = await win.evaluate(() => [...window.__pdfStates]);
  const classSeen = await win.evaluate(() => window.__classSeen);
  const cls = await readCls();
  const fpsConfounded = await readFps();
  const themeAfter = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const vtDur = vt.finishedAt !== null ? Math.round(vt.finishedAt - vt.t0) : null;
  console.log('[195] theme', themeBefore, '->', themeAfter, '| startViewTransition calls:', vt.calls, '| crossfade duration:', vtDur, 'ms (token 400)');
  console.log('[195] fallback class ever added:', classSeen, '(must be false on the API path)');
  console.log('[195] pdf distinct surface states:', JSON.stringify(pdfStates));
  console.log('[195] CLS:', JSON.stringify(cls));
  console.log('[195] confounded crossfade fps (pdf-probe overhead included):', JSON.stringify({ fps: fpsConfounded.fps, avg: fpsConfounded.avgDelta, max: fpsConfounded.maxDelta }));

  expect(themeAfter).not.toBe(themeBefore);
  expect(vt.calls, 'the theme flip must run through document.startViewTransition').toBeGreaterThanOrEqual(1);
  expect(vtDur, 'ViewTransition crossfade duration (400ms token + compositor latency)').toBeGreaterThanOrEqual(330);
  expect(vtDur).toBeLessThan(800);
  expect(classSeen, 'API path must never apply the fallback class').toBe(false);
  expect(pdfStates.length, 'PDF page/canvas surfaces stay constant during the crossfade').toBe(1);
  expect(cls.cls, `theme switch layout shift CLS=${cls.cls}`).toBe(0);
  expect(fpsConfounded.maxDelta, 'no single frame gap > 160ms (confounded probe, filing bar)').toBeLessThanOrEqual(160);

  // UNCONFOUNDED fps: reverse flip with a pure fps-only rAF loop; the frame
  // graph for screenshots/perf-60fps.png is rendered from these frames.
  await startFps(900);
  await flipThemeTo(themeBefore);
  await win.waitForTimeout(1100);
  const fps = await readFps();
  console.log('[195] unconfounded crossfade fps:', JSON.stringify({ fps: fps.fps, avg: fps.avgDelta, max: fps.maxDelta }), '| quiet:', quiet.fps);
  const graph = await renderFrameGraph(fps.ts, path.join(SHOTS, 'perf-60fps.png'));
  console.log('[195] frame graph:', JSON.stringify(graph));
  expect(fps.fps, `crossfade fps ${fps.fps} (filing measured 28-30; quiet ${quiet.fps})`).toBeGreaterThanOrEqual(50);
  expect(fps.avgDelta, `avg frame time ${fps.avgDelta}ms (60fps budget 16.7ms)`).toBeLessThanOrEqual(17.5);
  expect(fps.maxDelta, `worst frame gap ${fps.maxDelta}ms (filing jank stalls 88-105ms)`).toBeLessThanOrEqual(45);

  // FALLBACK path (engines without the API): shadow the API and verify the
  // class crossfade runs scoped to exactly the six colour properties.
  await win.evaluate(() => {
    Object.defineProperty(document, 'startViewTransition', { value: undefined, configurable: true });
  });
  expect(await win.evaluate(() => typeof document.startViewTransition === 'function')).toBe(false);
  await win.evaluate(() => {
    window.__fb = { addedAt: null, removedAt: null };
    new MutationObserver(() => {
      const has = document.documentElement.classList.contains('tf-theme-transitioning');
      const now = performance.now();
      if (has && window.__fb.addedAt === null) window.__fb.addedAt = now;
      if (!has && window.__fb.addedAt !== null && window.__fb.removedAt === null) window.__fb.removedAt = now;
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  });
  await startCls();
  await startFps(900);
  await flipThemeTo('dark');
  await win.waitForTimeout(120);
  // The class is on <html> right now: read the COMPUTED transition list the
  // fallback actually applies to a matched element. (The built declaration
  // uses var() durations, which Chromium's CSSOM serializes back as empty
  // longhands, so the computed value is the authoritative runtime proof.)
  const fbApplied = await win.evaluate(() => {
    const cs = getComputedStyle(document.body);
    return {
      classOn: document.documentElement.classList.contains('tf-theme-transitioning'),
      tp: cs.transitionProperty,
      td: cs.transitionDuration,
    };
  });
  await win.waitForTimeout(60);
  await win.screenshot({ path: path.join(SHOTS, 'def-195-retest-fallback.png') }); // mid class-crossfade
  await win.waitForTimeout(870);

  const fb = await win.evaluate(() => window.__fb);
  const clsFb = await readCls();
  const fpsFb = await readFps();
  console.log('[195] fallback class window:', Math.round(fb.removedAt - fb.addedAt), 'ms (token 400 + grace 50)');
  console.log('[195] fallback fps (6-prop scoped, logged not asserted):', JSON.stringify({ fps: fpsFb.fps, avg: fpsFb.avgDelta, max: fpsFb.maxDelta }));
  console.log('[195] fallback CLS:', JSON.stringify(clsFb));
  console.log('[195] fallback applied transition-property (computed, class on):', JSON.stringify(fbApplied));

  expect(fb.addedAt, 'fallback path must apply the transitioning class').not.toBeNull();
  expect(fb.removedAt, 'fallback class must be removed after the crossfade').not.toBeNull();
  expect(fb.removedAt - fb.addedAt, 'fallback crossfade window ~450ms (token 400 + grace 50)').toBeGreaterThan(380);
  expect(fb.removedAt - fb.addedAt).toBeLessThan(900);
  expect(clsFb.cls, `fallback layout shift CLS=${clsFb.cls}`).toBe(0);
  expect(fbApplied.classOn, 'the fallback class was on <html> at sample time').toBe(true);

  const props = fbApplied.tp.split(',').map((s) => s.trim());
  const durations = fbApplied.td.split(',').map((s) => s.trim());
  console.log('[195] fallback transition properties:', JSON.stringify(props), '| durations:', JSON.stringify(durations));
  expect(props).toEqual(expect.arrayContaining(['background-color', 'color', 'border-color', 'box-shadow', 'fill', 'stroke']));
  expect(props.length, `exactly six scoped properties (was nine; got ${JSON.stringify(props)})`).toBe(6);
  for (const banned of ['outline-color', 'text-decoration-color', 'caret-color']) {
    expect(props, `${banned} must stay out of the scoped list`).not.toContain(banned);
  }
  for (const d of durations) {
    expect(Math.round(parseFloat(d) * 1000), `fallback transition duration ${d} must ride the 400ms crossfade token`).toBe(400);
  }

  await closeApp();
});

// ---------------------------------------------------------------------------
// DEF-196 - press token wired to tool buttons; no 0.982 anywhere.
// ---------------------------------------------------------------------------
test('DEF-196: tool-btn press measures scale(--motion-scale-press)=0.97; no 0.982 literal; consistent across families', async () => {
  test.setTimeout(240000);
  await boot();
  await openDoc('report.pdf', 1500);

  const probe = await cssomProbe();
  console.log('[196] press rules in loaded CSS:', JSON.stringify(probe.pressRules));
  console.log('[196] dead 0.982 declarations in loaded CSS:', JSON.stringify(probe.dead982));
  expect(probe.dead982, 'no stylesheet may still declare the legacy 0.982 press literal').toEqual([]);
  const tokenRule = probe.pressRules.find((r) => r.tr.includes('motion-scale-press'));
  expect(tokenRule, 'the .tool-btn:active press rule must read var(--motion-scale-press)').toBeTruthy();

  const tokenOnEl = await win.evaluate(() => {
    const el = document.querySelector('.tool-btn:not([disabled])');
    return getComputedStyle(el).getPropertyValue('--motion-scale-press').trim();
  });
  console.log('[196] --motion-scale-press on the element:', tokenOnEl);
  expect(parseFloat(tokenOnEl)).toBe(0.97);

  // Hover first (the press group's hover half), then press-and-hold. The
  // pressed/released reads go through a data-qa-press tag so a page change
  // (the press CLICKS the button on release) can never swap the element
  // under our querySelector.
  const btn = win.locator('.tool-btn:not([disabled])').first();
  const bb = await btn.boundingBox();
  await win.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await win.waitForTimeout(250);
  const hover = parseMatrix(await win.evaluate(() => getComputedStyle(document.querySelector('.tool-btn:not([disabled])')).transform));
  console.log('[196] hover transform:', JSON.stringify(hover), '(expect ty=-1)');
  expect(hover, 'hover lift must apply').toBeTruthy();
  expect(hover.ty).toBeCloseTo(-1, 1);

  await win.evaluate(() => document.querySelector('.tool-btn:not([disabled])').setAttribute('data-qa-press', 'first'));
  await win.mouse.down();
  await win.waitForTimeout(200);
  const pressedTr = await win.evaluate(() => getComputedStyle(document.querySelector('[data-qa-press="first"]')).transform);
  const pressed = parseMatrix(pressedTr);
  const pressTd = await win.evaluate(() => {
    const el = document.querySelector('[data-qa-press="first"]');
    const cs = getComputedStyle(el);
    const props = cs.transitionProperty.split(',').map((s) => s.trim());
    const durs = cs.transitionDuration.split(',').map((s) => s.trim());
    const i = props.indexOf('transform');
    if (i < 0) return null;
    const m = /^([\d.]+)(ms|s)$/.exec(durs[Math.min(i, durs.length - 1)]);
    return m ? parseFloat(m[1]) * (m[2] === 's' ? 1000 : 1) : null;
  });
  console.log('[196] pressed transform:', pressedTr, '=> scale', pressed ? pressed.a.toFixed(4) : 'none', 'ty', pressed ? pressed.ty : 'none', '| transform transition', pressTd, 'ms');
  await win.screenshot({ path: path.join(SHOTS, 'def-196-retest.png') }); // pressed state
  await win.mouse.up();
  await win.waitForTimeout(350);
  const released = parseMatrix(await win.evaluate(() => getComputedStyle(document.querySelector('[data-qa-press="first"]')).transform));
  console.log('[196] released transform:', JSON.stringify(released));

  expect(pressed, 'press must apply a transform').toBeTruthy();
  expect(pressed.a, `tool-btn press scale ${pressed.a} must equal --motion-scale-press 0.97 (filing measured 0.982)`).toBeCloseTo(0.97, 2);
  expect(pressed.ty, 'press keeps the 1px settle').toBeCloseTo(1, 1);
  expect(pressTd, `press transform transition ${pressTd}ms (70ms instant band)`).toBeGreaterThan(0);
  expect(pressTd).toBeLessThanOrEqual(100);
  expect(released, 'release must return to rest').toBeTruthy();
  expect(Math.abs(released.a - 1)).toBeLessThan(0.02);

  // Consistency: a second tool button presses on the same token.
  const second = win.locator('.tool-btn:not([disabled])').nth(2);
  const bb2 = await second.boundingBox();
  await win.mouse.move(bb2.x + bb2.width / 2, bb2.y + bb2.height / 2);
  await win.waitForTimeout(150);
  await win.evaluate(() => {
    const els = document.querySelectorAll('.tool-btn:not([disabled])');
    els[Math.min(2, els.length - 1)].setAttribute('data-qa-press', 'second');
  });
  await win.mouse.down();
  await win.waitForTimeout(180);
  const secondPress = parseMatrix(await win.evaluate(() => getComputedStyle(document.querySelector('[data-qa-press="second"]')).transform));
  await win.mouse.up();
  console.log('[196] second tool-btn press scale:', secondPress ? secondPress.a : 'none');
  expect(secondPress && Math.abs(secondPress.a - 0.97) < 0.005, 'second tool-btn press scale also 0.97').toBe(true);

  // DEF-200 probe (new finding this round): families whose :active selector
  // lacks the :not([disabled]) guard (.btn, .tab-new, ...) lose the press
  // transform to their own (0,3,0) :hover rule while the pointer is down.
  // Logged here, filed as DEF-200.
  const tabNew = win.locator('.tab-new');
  const bb3 = await tabNew.boundingBox();
  await win.mouse.move(bb3.x + bb3.width / 2, bb3.y + bb3.height / 2);
  await win.waitForTimeout(150);
  await win.mouse.down();
  await win.waitForTimeout(180);
  const tabNewPress = parseMatrix(await win.evaluate(() => getComputedStyle(document.querySelector('.tab-new')).transform));
  await win.mouse.up();
  console.log('[196] .tab-new pressed (hover-mask probe, DEF-200):', JSON.stringify(tabNewPress));

  await win.evaluate(() => {
    document.querySelectorAll('[data-qa-press]').forEach((el) => el.removeAttribute('data-qa-press'));
  });
  // DEF-199 (filed this round): every boot/settings-echo theme application
  // starts a view transition that can skip-and-reject as an unhandled
  // "Transition was skipped" pageerror. Benign console noise, no visual
  // impact - filtered here, filed separately.
  const realErrors = rendererErrors.filter((e) => !/Transition was skipped/.test(e));
  console.log('[196] renderer errors (all):', JSON.stringify(rendererErrors), '| after DEF-199 filter:', JSON.stringify(realErrors));
  expect(realErrors, `renderer errors: ${realErrors.join(' | ')}`).toEqual([]);
  await closeApp();
});

// ---------------------------------------------------------------------------
// DEF-197 - canonical layer wired: AnimatedDialog + AnimatedPanel in
// production, presets measure as tokens (0.95 enter / 0.98 exit / 24px panel).
// ---------------------------------------------------------------------------
test('DEF-197: canonical layer wired - AnimatedDialog bloom, AnimatedPanel rail, token-driven presets', async () => {
  test.setTimeout(240000);
  await boot();
  await installSampler();
  await openDoc('form.pdf', 1800); // form.pdf has form fields -> flatten button lives

  // AnimatedPanel in production: the docked pages rail.
  const rail = await win.evaluate(() => {
    const el = document.querySelector('[data-animated-panel="side-rail"]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { present: true, transform: cs.transform, opacity: cs.opacity };
  });
  console.log('[197] AnimatedPanel side-rail:', JSON.stringify(rail));
  expect(rail && rail.present, 'the pages rail must be the AnimatedPanel wrapper (data-animated-panel=side-rail)').toBe(true);
  expect(parseFloat(rail.opacity)).toBe(1);

  // AnimatedDialog in production: flatten-forms confirm blooms 0.95 -> 1
  // (MOTION_SCALE.enter) with an opacity-only backdrop.
  await startSample('[data-animated-dialog="flatten-confirm"]', 900);
  await win.click('button[aria-label="Flatten form fields"]');
  await win.waitForSelector('[data-animated-dialog="flatten-confirm"]', { timeout: 8000 });
  await win.waitForTimeout(120);
  await win.screenshot({ path: path.join(SHOTS, 'def-197-retest.png') }); // dialog open + rail visible
  const dlg = await readSamples('[197] AnimatedDialog enter:');
  expect(dlg.length).toBeGreaterThan(2);
  const dMid = dlg.find((s) => {
    const m = parseMatrix(s.tr);
    return m && m.a < 0.969 && parseFloat(s.op) > 0.05;
  });
  console.log('[197] dialog first frame:', JSON.stringify(dlg[0]));
  expect(dMid, 'bloom caught BELOW 0.97 -> initial scale is the 0.95 enter token (the old preset hardcoded 0.97)').toBeTruthy();
  expect(dlg[dlg.length - 1].op).toBe('1');
  const backdropOp = await win.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.modal-backdrop')).opacity));
  expect(backdropOp).toBe(1);

  // Press the dialog's .btn (the .btn press family). DEF-200 finding (this
  // round): while the pointer is down, .btn:hover:not([disabled]) (0,3,0)
  // outranks the .btn:active press rule (0,2,0), so the press TRANSFORM is
  // masked (measured stays at the hover lift ty=-1) even though both rules
  // now read the same token in CSSOM. Logged, not asserted - DEF-200.
  const cancelBtn = win.locator('.modal-dialog button:has-text("Cancel")').first();
  const cbb = await cancelBtn.boundingBox();
  await win.mouse.move(cbb.x + cbb.width / 2, cbb.y + cbb.height / 2);
  await win.waitForTimeout(150);
  await win.mouse.down();
  await win.waitForTimeout(180);
  const btnPress = parseMatrix(await win.evaluate(() => {
    const b = [...document.querySelectorAll('.modal-dialog .btn')].find((x) => x.textContent.includes('Cancel'));
    return b ? getComputedStyle(b).transform : null;
  }));
  await win.mouse.up();
  await win.waitForTimeout(300);
  console.log('[197] .btn pressed (hover-mask probe, DEF-200):', JSON.stringify(btnPress), '- press scale masked by hover, press-wash still applies');
  expect(btnPress, 'some transform stays applied while .btn is pressed').toBeTruthy();
  await win.waitForFunction(() => !document.querySelector('[data-animated-dialog="flatten-confirm"]'), null, { timeout: 3000 });

  // Dialog exit travels toward the 0.98 exit token (old preset: 0.985).
  await startSample('[data-animated-dialog="flatten-confirm"]', 700);
  await win.click('button[aria-label="Flatten form fields"]');
  await win.waitForSelector('[data-animated-dialog="flatten-confirm"]', { timeout: 5000 });
  await win.waitForTimeout(450); // let the enter settle
  await win.keyboard.press('Escape');
  const exit = await readSamples('[197] AnimatedDialog exit:');
  const eMid = exit.find((s) => {
    const m = parseMatrix(s.tr);
    return m && m.a > 0.975 && m.a < 0.995 && parseFloat(s.op) > 0.05;
  });
  console.log('[197] dialog exit mid-flight:', !!eMid, eMid ? eMid.tr : '');
  expect(eMid, 'exit must travel toward scale 0.98 (MOTION_SCALE.exit; old preset hardcoded 0.985)').toBeTruthy();
  await win.waitForFunction(() => !document.querySelector('.modal-backdrop'), null, { timeout: 2500 });

  // TfMenu preset (titlebar menu): initial scale is now the 0.95 enter token
  // (the filing measured a hardcoded 0.96 here).
  await startSample('.titlebar-menu-popover', 600);
  await win.click('.titlebar-menu-button');
  await win.waitForSelector('.titlebar-menu-popover', { timeout: 5000 });
  const menu = await readSamples('[197] TfMenu enter:');
  const menuLow = menu.find((s) => {
    const m = parseMatrix(s.tr);
    return m && m.a < 0.965 && parseFloat(s.op) > 0.02;
  });
  console.log('[197] menu first frames:', JSON.stringify(menu.slice(0, 5)));
  expect(menu.length).toBeGreaterThan(1);
  expect(menuLow, 'TfMenu initial scale must be the 0.95 enter token (not the old 0.96 literal)').toBeTruthy();
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);

  // TfPanel preset (tools palette): 24px travel (MOTION_TRANSLATE.panel),
  // transform/opacity only - width/height must stay constant during the tween.
  await startSample('[data-tools-palette]', 800);
  await win.click('button[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
  await win.waitForTimeout(700);
  const pal = await readSamples('[197] TfPanel enter:');
  const palMid = pal.find((s) => {
    const m = parseMatrix(s.tr);
    return m && m.tx > 0.5 && m.tx < 26;
  });
  expect(palMid, 'palette caught mid-slide (0 < tx < 26)').toBeTruthy();
  const widths = [...new Set(pal.map((s) => s.w))];
  const heights = [...new Set(pal.map((s) => s.h))];
  console.log('[197] palette width set during slide:', JSON.stringify(widths), 'height set:', JSON.stringify(heights));
  expect(widths.length, 'palette width constant during the tween (transform/opacity only)').toBe(1);
  expect(heights.length, 'palette height constant during the tween').toBe(1);
  for (const s of pal) expect(s.an, 'no CSS keyframe may run on the palette (JS presets own it)').toBe('none');
  await win.click('button[data-tools-toggle]');
  await win.waitForFunction(() => !document.querySelector('[data-tools-palette]'), null, { timeout: 3000 });

  // Token system state in the running app.
  const probe = await cssomProbe();
  console.log('[197] tokens:', JSON.stringify(probe.tokens), '| utility:', JSON.stringify(probe.utility));
  expect(probe.themeRedecl, 'no motion token redeclared inside [data-theme] blocks').toEqual([]);
  // Chromium serializes the declared "0.97" as ".97" in computed custom
  // properties - compare numerically.
  expect(parseFloat(probe.tokens.press), `--motion-scale-press ${probe.tokens.press}`).toBe(0.97);
  expect(parseFloat(probe.tokens.enter), `--motion-scale-enter ${probe.tokens.enter}`).toBe(0.95);
  expect(parseFloat(probe.tokens.exit), `--motion-scale-exit ${probe.tokens.exit}`).toBe(0.98);
  expect(probe.utility.an, 'the .anim-* utility set must resolve (token-driven keyframes live)').toBe('tf-anim-pop-in');
  expect(probe.utility.ad).toBe('0.2s');

  const realErrors197 = rendererErrors.filter((e) => !/Transition was skipped/.test(e));
  console.log('[197] renderer errors (all):', JSON.stringify(rendererErrors), '| after DEF-199 filter:', JSON.stringify(realErrors197));
  expect(realErrors197, `renderer errors: ${realErrors197.join(' | ')}`).toEqual([]);
  await closeApp();
});

// ---------------------------------------------------------------------------
// PERFORMANCE - fps battery across animations, smooth scroll, layout quiet.
// ---------------------------------------------------------------------------
test('PERF: fps battery (palette, popover, tabs, scroll), no layout thrash', async () => {
  test.setTimeout(240000);
  await boot();
  await openDoc('report.pdf', 1800);

  const results = {};
  const measure = async (label, dur, action) => {
    await startFps(dur);
    await action();
    await win.waitForTimeout(dur + 150);
    results[label] = await readFps();
    console.log(`[PERF] ${label}:`, JSON.stringify({ fps: results[label].fps, avg: results[label].avgDelta, max: results[label].maxDelta }));
  };

  await measure('palette-open', 700, async () => { await win.click('button[data-tools-toggle]'); await win.waitForSelector('[data-tools-palette]', { timeout: 8000 }); });
  await measure('palette-close', 600, async () => { await win.click('button[data-tools-toggle]'); await win.waitForFunction(() => !document.querySelector('[data-tools-palette]'), null, { timeout: 4000 }); });
  await measure('popover-open', 500, async () => { await win.click('[data-theme-toggle]'); await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 }); });
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);
  await measure('tab-new', 600, async () => { await win.click('button.tab-new'); await win.waitForFunction(() => document.querySelectorAll('[data-tab-id]').length === 2, null, { timeout: 5000 }); });
  await win.locator('[data-tab-id]').first().click();
  await win.waitForTimeout(400);
  await measure('scroll', 900, async () => {
    const box = await win.locator('.document-scroller').boundingBox();
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 6; i++) {
      await win.mouse.wheel(0, 500);
      await win.waitForTimeout(90);
    }
  });

  for (const [label, r] of Object.entries(results)) {
    expect(r.fps, `${label} fps ${r.fps}`).toBeGreaterThanOrEqual(40);
    expect(r.maxDelta, `${label} worst frame gap ${r.maxDelta}ms`).toBeLessThanOrEqual(80);
  }
  expect(results['palette-open'].fps, 'palette slide fps').toBeGreaterThanOrEqual(45);
  expect(results['popover-open'].fps, 'popover pop fps').toBeGreaterThanOrEqual(50);

  // Layout quiet: CLS 0 across the panel choreography.
  await startCls();
  await win.click('button[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
  await win.waitForTimeout(600);
  await win.click('button[data-tools-toggle]');
  await win.waitForFunction(() => !document.querySelector('[data-tools-palette]'), null, { timeout: 4000 });
  await win.waitForTimeout(400);
  const cls = await readCls();
  console.log('[PERF] palette open/close CLS:', JSON.stringify(cls));
  expect(cls.cls, `no layout shift during panel choreography CLS=${cls.cls}`).toBe(0);

  // Renderer must stay error-free through the whole battery, EXCEPT the
  // known benign "Transition was skipped" rejection (DEF-199, filed this
  // round: the settings echo re-applies the theme and starts a second view
  // transition that skips the first; the app discards the VT promise so the
  // skip surfaces as an unhandled rejection).
  const realErrors = rendererErrors.filter((e) => !/Transition was skipped/.test(e));
  console.log('[PERF] renderer errors (all):', JSON.stringify(rendererErrors), '| after DEF-199 filter:', JSON.stringify(realErrors));
  expect(realErrors, `renderer errors: ${realErrors.join(' | ')}`).toEqual([]);
  await closeApp();
});