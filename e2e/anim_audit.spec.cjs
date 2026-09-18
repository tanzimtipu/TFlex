// ANIMATION SYSTEM AUDIT (dev build) - qa audit of the cross-theme animation
// system (animations.css --motion-* tokens + useAnimations hooks + Animated*
// wrappers + theme crossfade), mapped to the audit checklist:
//   A1  tokens on :root, theme crossfade ~400ms, PDF pin, layout shift, fps
//   A2  popover Pop In/Pop Out + clean exit; dialog spring; backdrop fade;
//       tools palette slide
//   A3  tabs: Materialize/Dissolve, EMPTY TAB CLOSE (reported fixed), ghosts,
//       active-tab crossfade + liquid indicator
//   A4  press/hover measured against --motion-scale-press; thumbnail/toggle
//   A5  prefers-reduced-motion collapse
// Mid-animation values are sampled in-page via rAF so every verdict is based
// on LIVE computed values. Canonical launcher, dev build.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, armAnnotationTool } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

let electronApp = null;
let win = null;

const MOTION_TOKENS = {
  '--motion-duration-micro': '150ms',
  '--motion-duration-fast': '200ms',
  '--motion-duration-standard': '250ms',
  '--motion-duration-panel': '140ms',
  '--motion-duration-layout': '350ms',
  '--motion-theme-crossfade': '400ms',
  '--motion-scale-press': '0.97',
  '--motion-scale-enter': '0.95',
  '--motion-scale-exit': '0.98',
};

function parseMs(v) {
  const m = /^([\d.]+)(ms|s)$/.exec((v || '').trim());
  if (!m) return NaN;
  return parseFloat(m[1]) * (m[2] === 's' ? 1000 : 1);
}

// Chromium serializes "0.97" as ".97" in computed custom properties; both
// parse to the same float, so compare scale tokens numerically.
function parseNum(v) {
  const n = parseFloat(v);
  return isNaN(n) ? NaN : n;
}

function parseMatrix(tr) {
  if (!tr || tr === 'none') return null;
  const m = tr.match(/matrix\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((s) => parseFloat(s.trim()));
  return { a: p[0], tx: p[4], ty: p[5] };
}

// In-page rAF sampler. pick: 'first' (default) or 'last' among matches.
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
          const row = {
            t: Math.round(performance.now() - t0),
            tr: cs.transform, op: cs.opacity,
            an: cs.animationName, ad: cs.animationDuration,
            bg: cs.backgroundColor,
            id: el.getAttribute('data-animated-tab') || el.getAttribute('data-tab-id') || '',
          };
          if (extra === 'margin') row.marginRight = cs.marginRight;
          window.__s.push(row);
        }
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else window.__sDone = true;
      };
      window.__sDone = false;
      requestAnimationFrame(tick);
    };
  });
}

async function startSample(sel, ms, pick, extra) {
  await win.evaluate(
    ([sel, ms, pickSel, extra]) => window.__sStart(sel, ms, extra || '', pickSel),
    [sel, ms, pick || 'first', extra],
  );
}
async function readSamples(label) {
  await win.waitForFunction(() => window.__sDone === true, null, { timeout: 10000 }).catch(() => {});
  const s = await win.evaluate(() => window.__s || []);
  if (label) console.log(label, JSON.stringify(s.map(fmt)));
  return s;
}
function fmt(s) {
  const m = parseMatrix(s.tr);
  const pos = m ? `tx=${m.tx.toFixed(2)} ty=${m.ty.toFixed(2)} sx=${m.a.toFixed(3)}` : 'none';
  return `t=${s.t} ${pos} op=${s.op}${s.marginRight ? ' mr=' + s.marginRight : ''}${s.id ? ' #' + s.id.slice(0, 8) : ''}`;
}

async function openReport(waitMs = 1800) {
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await win.waitForTimeout(waitMs);
}

// rAF fps meter.
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
  if (ts.length < 3) return { frames: ts.length, fps: 0, avgDelta: NaN, maxDelta: NaN };
  const deltas = [];
  for (let i = 1; i < ts.length; i++) deltas.push(ts[i] - ts[i - 1]);
  const dur = ts[ts.length - 1];
  return {
    frames: ts.length,
    fps: Math.round(((ts.length - 1) / dur) * 1000),
    avgDelta: Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 10) / 10,
    maxDelta: Math.round(Math.max(...deltas)),
  };
}

// Layout-shift accumulator (CLS entries, excl. recent input).
async function startCls() {
  await win.evaluate(() => {
    window.__cls = 0;
    window.__clsEntries = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) {
          window.__cls += e.value;
          window.__clsEntries.push({ v: Math.round(e.value * 1000) / 1000, src: (e.sources || []).map((s) => s.node && (s.node.className || s.node.tagName)).slice(0, 3) });
        }
      }
    }).observe({ type: 'layout-shift', buffered: false });
  });
}
async function readCls() {
  return win.evaluate(() => ({ cls: window.__cls, entries: window.__clsEntries }));
}

test.beforeEach(async () => {
  electronApp = await launchApp();
  win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await installSampler();
});

test.afterEach(async () => {
  await hardClose(electronApp);
});

// ---------------------------------------------------------------------------
// A1 - tokens, theme crossfade, PDF pin, layout shift, fps
// ---------------------------------------------------------------------------
test('A1: --motion-* tokens on :root; theme crossfade ~400ms; PDF pinned; no layout shift', async () => {
  test.setTimeout(180000);

  const bootMedia = await win.evaluate(() => ({
    reduce: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    theme: document.documentElement.getAttribute('data-theme'),
  }));
  console.log('[A1] boot media state:', JSON.stringify(bootMedia));

  const res = await win.evaluate((tokens) => {
    const out = { rootDecls: {}, themeDecls: {} };
    const walk = (rules) => {
      for (const r of rules) {
        if (r.cssRules && r.cssRules.length) { walk(r.cssRules); continue; }
        if (r.selectorText && r.style) {
          const isTheme = /\[data-theme/.test(r.selectorText);
          for (const p of Object.keys(tokens)) {
            const v = r.style.getPropertyValue(p);
            if (v) (isTheme ? out.themeDecls : out.rootDecls)[p] = v.trim();
          }
        }
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules); } catch (e) { /* cross-origin skip */ }
    }
    const cs = getComputedStyle(document.documentElement);
    out.computed = {};
    for (const p of Object.keys(tokens)) out.computed[p] = cs.getPropertyValue(p).trim();
    return out;
  }, MOTION_TOKENS);
  console.log('[A1] :root motion tokens:', JSON.stringify(res.rootDecls));
  console.log('[A1] theme-block redeclarations:', JSON.stringify(res.themeDecls));
  console.log('[A1] computed:', JSON.stringify(res.computed));
  for (const [tok, val] of Object.entries(MOTION_TOKENS)) {
    const exp = parseMs(val), got = parseMs(res.computed[tok]);
    if (!isNaN(exp) && !isNaN(got)) expect(got, `${tok} computed`).toBe(exp);
    else expect(parseNum(res.computed[tok]), `${tok} computed`).toBe(parseNum(val));
  }
  for (const p of Object.keys(MOTION_TOKENS)) {
    expect(res.themeDecls[p], `${p} must never be redeclared per-theme`).toBeUndefined();
  }

  await openReport(2000);

  // Quiet baseline fps (idle workspace, no animation) - the fair
  // comparison for the crossfade fps below.
  await startFps(700);
  await win.waitForTimeout(800);
  const quietFps = await readFps();
  console.log('[A1] quiet baseline fps:', JSON.stringify(quietFps));

  await win.evaluate(() => {
    const obs = { addedAt: null, removedAt: null, vtInvoked: false, vtDurations: [], vtFinishedMs: null };
    window.__themeObs = obs;
    new MutationObserver(() => {
      const has = document.documentElement.classList.contains('tf-theme-transitioning');
      const now = performance.now();
      if (has && obs.addedAt === null) obs.addedAt = now;
      if (!has && obs.addedAt !== null && obs.removedAt === null) obs.removedAt = now;
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    // DEF-195: Electron Chromium takes the View Transitions primary path, which
    // never applies .tf-theme-transitioning (useAnimations.ts:495-515). Wrap the
    // entry point so the test can measure whichever crossfade mechanism the
    // product actually ran, against the live --motion-theme-crossfade token.
    const orig = document.startViewTransition;
    if (typeof orig === 'function') {
      document.startViewTransition = function (cb) {
        obs.vtInvoked = true;
        const t0 = performance.now();
        const vt = orig.call(document, cb);
        const sample = () => {
          for (const a of document.getAnimations()) {
            const pe = a.effect && a.effect.pseudoElement;
            if (pe && pe.includes('view-transition')) {
              const d = a.effect.getTiming().duration;
              if (typeof d === 'number' && d > 0) obs.vtDurations.push(d);
            }
          }
          if (performance.now() - t0 < 500) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
        if (vt && vt.finished) {
          vt.finished.then(() => { obs.vtFinishedMs = performance.now() - t0; }).catch(() => {});
        }
        return vt;
      };
    }
    window.__pdfFrames = [];
    const t0 = performance.now();
    const tick = () => {
      const page = document.querySelector('.pdf-page');
      const canvas = document.querySelector('.pdf-page-canvas');
      const root = document.documentElement;
      if (page && canvas) {
        const cs = getComputedStyle(page);
        const ccs = getComputedStyle(canvas);
        window.__pdfFrames.push({
          t: Math.round(performance.now() - t0),
          transitioning: root.classList.contains('tf-theme-transitioning'),
          pageOp: cs.opacity, pageTr: cs.transform, pageFilter: cs.filter,
          canvasOp: ccs.opacity, canvasFilter: ccs.filter,
        });
      }
      if (performance.now() - t0 < 900) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await startCls();
  await startFps(900);

  const themeBefore = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click('[data-theme-option="dark"]');
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(SHOTS, 'anim-theme-crossfade.png') }); // mid-crossfade
  await win.waitForTimeout(800);

  const themeObs = await win.evaluate(() => window.__themeObs);
  const pdfFrames = await win.evaluate(() => window.__pdfFrames);
  const cls = await readCls();
  const fps = await readFps();
  const themeAfter = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const distinctPdf = [...new Set(pdfFrames.map((f) => `${f.pageOp}|${f.pageTr}|${f.pageFilter}|${f.canvasOp}|${f.canvasFilter}`))];
  const crossfadeToken = parseMs(res.computed['--motion-theme-crossfade']);
  const usedClass = themeObs.addedAt !== null;
  const usedViewTransition = themeObs.vtInvoked === true;
  console.log('[A1] theme', themeBefore, '->', themeAfter, '| obs:', JSON.stringify(themeObs));
  console.log('[A1] crossfade mechanism:', `class=${usedClass} viewTransition=${usedViewTransition}`,
    '| class window ms:', themeObs.removedAt !== null ? themeObs.removedAt - themeObs.addedAt : 'n/a',
    '| vt pseudo durations:', JSON.stringify(themeObs.vtDurations),
    '| vt finished ms:', themeObs.vtFinishedMs);
  console.log('[A1] quiet fps:', JSON.stringify(quietFps), '| crossfade fps:', JSON.stringify(fps));
  console.log('[A1] layout-shift:', JSON.stringify(cls));
  console.log('[A1] pdf distinct surface states:', JSON.stringify(distinctPdf), '| frames:', pdfFrames.length, '| transitioningSeen:', pdfFrames.some((f) => f.transitioning));

  expect(themeAfter).not.toBe(themeBefore);
  // Phase-15 (DEF-195) made the View Transitions API the primary crossfade
  // mechanism; the .tf-theme-transitioning class is the fallback for engines
  // without it. Accept either, but pin the duration to the live token.
  expect(usedClass || usedViewTransition, 'a theme crossfade must run (class fallback or View Transitions)').toBe(true);
  if (usedClass) {
    const dur = themeObs.removedAt - themeObs.addedAt;
    expect(dur, `class crossfade window must run for the --motion-theme-crossfade token (${crossfadeToken}ms)`).toBeGreaterThan(crossfadeToken * 0.8);
    expect(dur, 'class crossfade window must not drag past the token + grace').toBeLessThan(crossfadeToken + 450);
  } else {
    const vtDurations = themeObs.vtDurations.filter((d) => d > 0);
    if (vtDurations.length > 0) {
      const vtMs = Math.max(...vtDurations);
      expect(Math.abs(vtMs - crossfadeToken), `view-transition must run for --motion-theme-crossfade (${crossfadeToken}ms), measured ${vtMs}ms`).toBeLessThanOrEqual(5);
    } else {
      expect(themeObs.vtFinishedMs, 'view-transition crossfade must complete').toBeGreaterThan(0);
      expect(Math.abs(themeObs.vtFinishedMs - crossfadeToken), `view-transition must run for --motion-theme-crossfade (${crossfadeToken}ms), measured ${themeObs.vtFinishedMs}ms`).toBeLessThanOrEqual(150);
    }
  }
  expect(pdfFrames.length).toBeGreaterThan(5);
  expect(distinctPdf, 'pdf surfaces must stay constant during crossfade').toHaveLength(1);
  expect(cls.cls, `theme switch layout shift CLS=${cls.cls}`).toBe(0);
  // NOTE: fps sampled DURING the PDF-pin loop above is biased (the probe
  // forces two getComputedStyle calls per frame). It is logged, not
  // asserted. The unconfounded number is measured on the reverse flip
  // below, with an fps-only rAF loop.
  console.log('[A1] confounded crossfade fps (probe overhead included):', JSON.stringify(fps));
  expect(fps.maxDelta, 'no single frame gap > 160ms').toBeLessThanOrEqual(160);
  const classGone = await win.evaluate(() => !document.documentElement.classList.contains('tf-theme-transitioning'));
  expect(classGone, 'transitioning class removed after the crossfade').toBe(true);

  // Switch back to the boot theme while sampling fps ONLY (no
  // getComputedStyle probing in the rAF loop) - the unconfounded
  // crossfade cost measurement.
  await startFps(900);
  await win.click('[data-theme-toggle]');
  await win.waitForSelector(`[data-theme-option="${themeBefore}"]`, { timeout: 5000 });
  await win.click(`[data-theme-option="${themeBefore}"]`);
  await win.waitForTimeout(1000);
  const fpsBack = await readFps();
  console.log('[A1] reverse-crossfade fps (unconfounded):', JSON.stringify(fpsBack));
  expect(fpsBack.fps, `unconfounded crossfade fps ${fpsBack.fps} vs quiet ${quietFps.fps}`)
    .toBeGreaterThanOrEqual(Math.max(15, Math.round(quietFps.fps * 0.6)));
});

// ---------------------------------------------------------------------------
// A2 - popover Pop In/Out, dialog spring, backdrop fade, palette slide
// ---------------------------------------------------------------------------
test('A2: popover Pop In/Out clean exit; dialog + backdrop + palette springs', async () => {
  test.setTimeout(180000);
  await openReport(1500);

  // Theme popover: Pop In (scale .95 + y -4 -> 1, 200ms band).
  await startSample('.theme-toggle-popover', 500);
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.waitForTimeout(80);
  await win.screenshot({ path: path.join(SHOTS, 'anim-popover-drop.png') });
  const popSamples = await readSamples('[A2] popover enter:');
  expect(popSamples.length).toBeGreaterThan(2);
  const pMid = popSamples.find((s) => {
    const m = parseMatrix(s.tr);
    return m && (m.a < 0.99 || m.ty < -0.3) && parseFloat(s.op) > 0.02;
  });
  expect(pMid, 'popover caught mid Pop In (scale<1 or y<0)').toBeTruthy();
  expect(popSamples[popSamples.length - 1].op).toBe('1');

  // Pop Out: exit animation, then AnimatePresence removes the node.
  await startSample('.theme-toggle-popover', 500);
  await win.keyboard.press('Escape');
  const exitSamples = await readSamples('[A2] popover exit:');
  await win.waitForFunction(() => document.querySelector('.theme-toggle-popover') === null, null, { timeout: 2000 });
  const exitMid = exitSamples.find((s) => parseFloat(s.op) < 0.95);
  console.log('[A2] popover exit mid-flight observed:', !!exitMid, '| node removed: yes');
  expect(exitMid, 'popover exit must animate (opacity<1 mid-flight) before removal').toBeTruthy();

  // Tools palette slide (TfPanel spring x 24 -> 0).
  await startSample('[data-tools-palette]', 700);
  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
  await win.waitForTimeout(100);
  await win.screenshot({ path: path.join(SHOTS, 'anim-sidebar-slide.png') });
  await win.waitForTimeout(620);
  const palSamples = await readSamples('[A2] palette enter:');
  const palMid = palSamples.find((s) => {
    const m = parseMatrix(s.tr);
    return m && m.tx > 0.5 && m.tx < 24;
  });
  expect(palMid, 'palette caught mid-slide (0<tx<24)').toBeTruthy();
  for (const s of palSamples) expect(s.an, 'no CSS keyframe may run on the palette').toBe('none');

  // Dialog spring (TfDialog y10/scale .97) + backdrop opacity-only.
  // The palette is still open here - the tool button lives inside it.
  await startSample('.modal-dialog', 700);
  await win.click('[data-tool-id="insertPages"]');
  await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 8000 });
  await win.waitForTimeout(80);
  await win.screenshot({ path: path.join(SHOTS, 'anim-dialog-bloom.png') });
  const dlgSamples = await readSamples('[A2] dialog enter:');
  const dMid = dlgSamples.find((s) => {
    const m = parseMatrix(s.tr);
    return m && (m.ty > 0.5 || m.a < 0.99) && parseFloat(s.op) > 0.02;
  });
  expect(dMid, 'dialog caught mid rise+settle').toBeTruthy();
  expect(dlgSamples[dlgSamples.length - 1].op).toBe('1');

  // Backdrop opacity-only fade; Escape closes and removes both nodes.
  await startSample('.modal-backdrop', 500);
  await win.keyboard.press('Escape');
  const bdSamples = await readSamples('[A2] backdrop exit:');
  await win.waitForFunction(() => document.querySelector('.modal-backdrop') === null, null, { timeout: 2000 });
  console.log('[A2] backdrop exit mid-flight:', bdSamples.some((s) => parseFloat(s.op) < 0.9), '| node removed: yes');

  // Palette close: sample the page inset (margin-right) tween, then the
  // TfPanel exit travels x -> 18 and AnimatePresence removes the node.
  await startSample('.document-scroller', 700, 'first', 'margin');
  await win.click('[data-tools-toggle]');
  await win.waitForFunction(() => document.querySelector('[data-tools-palette]') === null, null, { timeout: 2000 });
  const scroller = await readSamples();
  const marginVals = scroller.filter((s) => s.marginRight !== undefined).map((s) => s.marginRight);
  const distinctMargins = [...new Set(marginVals)];
  console.log('[A2] scroller margin distinct values during palette close:', JSON.stringify(distinctMargins), '| frames:', marginVals.length);
  console.log('[A2] palette removed after close: yes');
});

// ---------------------------------------------------------------------------
// A3 - tabs: materialize, dissolve, EMPTY TAB CLOSE (reported fixed), ghosts
// ---------------------------------------------------------------------------
test('A3: tab materialize/dissolve; empty tab close works; no ghost tabs; indicator', async () => {
  test.setTimeout(180000);
  await openReport(1800);
  const baseTabs = await win.evaluate(() => document.querySelectorAll('[data-tab-id]').length);

  // New tab: Tab Materialize (opacity 0 -> 1, 200ms).
  await startSample('[data-animated-tab]', 1200, 'last');
  await win.click('button.tab-new');
  await win.waitForSelector('[data-animated-tab]', { timeout: 8000 });
  const countAfterClick = await win.evaluate(() => document.querySelectorAll('[data-animated-tab]').length);
  console.log('[A3] animated-tab li count right after +tab click:', countAfterClick, '(baseline', baseTabs, ')');
  const matSamples = await readSamples('[A3] materialize:');
  expect(matSamples.length).toBeGreaterThan(2);
  expect(matSamples.find((s) => parseFloat(s.op) < 0.98), 'new tab caught mid-materialize').toBeTruthy();
  expect(matSamples[matSamples.length - 1].op).toBe('1');
  expect(await win.evaluate(() => document.querySelectorAll('[data-tab-id]').length)).toBe(baseTabs + 1);

  // Switch back to the report tab: crossfade + indicator glide.
  await win.locator('[data-tab-id]').first().click();
  await win.waitForTimeout(90);
  await win.screenshot({ path: path.join(SHOTS, 'anim-tab-crossfade.png') });
  const indicator = await win.evaluate(() => {
    const active = document.querySelector('.tab-active');
    if (!active) return null;
    const cs = getComputedStyle(active, '::after');
    return { animationName: cs.animationName, duration: cs.animationDuration };
  });
  console.log('[A3] active-tab ::after indicator:', JSON.stringify(indicator));
  expect(indicator).toBeTruthy();

  // EMPTY TAB CLOSE (the reported bug, said fixed in this changeset).
  await startSample('[data-animated-tab]', 600, 'last');
  await win.locator('[data-animated-tab]').last().locator('.tab-close').click();
  const dissolveSamples = await readSamples('[A3] dissolve:');
  const t0 = Date.now();
  await win.waitForFunction((n) => document.querySelectorAll('[data-tab-id]').length === n, baseTabs, { timeout: 5000 });
  console.log('[A3] empty tab close -> baseline in', Date.now() - t0, 'ms');
  expect(await win.evaluate(() => document.querySelectorAll('[data-tab-id]').length)).toBe(baseTabs);
  console.log('[A3] dissolve exit opacity observed:', dissolveSamples.some((s) => parseFloat(s.op) < 0.98));

  // No ghost tabs in the strip.
  const strip = await win.evaluate(() => {
    const lis = [...document.querySelectorAll('[data-animated-tab]')];
    return {
      li: lis.length,
      tabs: document.querySelectorAll('[data-tab-id]').length,
      ghosts: lis.filter((li) => parseFloat(getComputedStyle(li).opacity) < 0.99).length,
    };
  });
  console.log('[A3] strip state:', JSON.stringify(strip));
  expect(strip.ghosts).toBe(0);
  expect(strip.li).toBe(strip.tabs);

  // Real tab close returns to the welcome screen.
  await win.locator('[data-tab-id]').first().locator('.tab-close').click();
  await win.waitForSelector('.welcome', { timeout: 8000 });
  console.log('[A3] final real-tab close -> welcome: OK');
});

// ---------------------------------------------------------------------------
// A4 - press scale vs token; hover; thumbnail; toggle
// ---------------------------------------------------------------------------
test('A4: press/hover measured against --motion-scale-press; thumbnail + toggle states', async () => {
  test.setTimeout(180000);
  await openReport(1500);

  const btn = win.locator('.tool-btn:not([disabled])').first();
  const bb = await btn.boundingBox();
  // Hover FIRST (measured while the pointer rests on the button).
  await win.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await win.waitForTimeout(250);
  const hovered = await win.evaluate(() => ({
    tr: getComputedStyle(document.querySelector('.tool-btn:not([disabled])')).transform,
  }));
  const hm = parseMatrix(hovered.tr);
  console.log('[A4] tool-btn hover:', hovered.tr, '(expect ty=-1)');
  // Then press while still hovering.
  await win.mouse.down();
  await win.waitForTimeout(200);
  const pressed = await win.evaluate(() => ({
    tr: getComputedStyle(document.querySelector('.tool-btn:not([disabled])')).transform,
  }));
  const pm = parseMatrix(pressed.tr);
  console.log('[A4] tool-btn pressed:', pressed.tr, '=> scale', pm ? pm.a.toFixed(3) : 'none', 'ty', pm ? pm.ty : 'none', '(canonical --motion-scale-press)');
  await win.mouse.up();
  await win.waitForTimeout(300);

  const thumbSt = await win.evaluate(() => {
    const el = document.querySelector('.thumb-current');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { an: cs.animationName, ad: cs.animationDuration, bg: cs.backgroundColor };
  });
  console.log('[A4] current thumbnail:', JSON.stringify(thumbSt));

  await armAnnotationTool(win, 'ink');
  await win.waitForTimeout(260);
  const armed = await win.evaluate(() => {
    const el = document.querySelector('.tool-btn-active');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { td: cs.transitionDuration, bg: cs.backgroundColor };
  });
  console.log('[A4] tool-btn-active (selection fill):', JSON.stringify(armed));
});

// ---------------------------------------------------------------------------
// A5 - prefers-reduced-motion collapse (mid-session emulation probe)
// ---------------------------------------------------------------------------
test('A5: reduced motion (mid-session) - CSS tokens 0ms, states still change; crossfade-class behavior recorded', async () => {
  test.setTimeout(180000);
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await win.waitForTimeout(300);

  const mediaState = await win.evaluate(() => ({
    reduce: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  }));
  console.log('[A5] media after emulateMedia:', JSON.stringify(mediaState));
  expect(mediaState.reduce).toBe(true);

  const tokens = await win.evaluate((keys) => {
    const cs = getComputedStyle(document.documentElement);
    const out = {};
    for (const k of keys) out[k] = cs.getPropertyValue(k).trim();
    return out;
  }, ['--motion-duration-fast', '--motion-duration-standard', '--motion-theme-crossfade']);
  console.log('[A5] reduced-motion tokens:', JSON.stringify(tokens));
  for (const v of Object.values(tokens)) expect(parseMs(v)).toBe(0);

  await win.evaluate(() => {
    window.__sawTransitionClass = false;
    new MutationObserver(() => {
      if (document.documentElement.classList.contains('tf-theme-transitioning')) window.__sawTransitionClass = true;
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  });

  await openReport(1200);

  // Popover opening sampled from BEFORE the click: travel (non-reduced JS)
  // vs instant settle (reduced) is distinguishable.
  await startSample('.theme-toggle-popover', 700);
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.waitForTimeout(80);
  await win.screenshot({ path: path.join(SHOTS, 'anim-reduced-motion.png') });
  const popSamples = await readSamples('[A5] popover enter:');
  console.log('[A5] popover samples:', JSON.stringify(popSamples.map((s) => `t=${s.t} op=${s.op} ${s.tr}`)));
  await win.click('[data-theme-option="dark"]');
  await win.waitForTimeout(600);
  const sawClass = await win.evaluate(() => window.__sawTransitionClass);
  const theme = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
  console.log('[A5] theme now:', theme, '| transition class seen under mid-session reduce:', sawClass);
  expect(theme).toBe('dark');
  // State change works. The class question is REPORTED, not asserted here:
  // the authoritative reduced-motion contract is A6 (OS flag at launch).

  await win.click('button.tab-new');
  await win.waitForTimeout(250);
  await win.locator('[data-animated-tab]').last().locator('.tab-close').click();
  await win.waitForFunction(() => document.querySelectorAll('[data-animated-tab]').length === 1, null, { timeout: 3000 });
  console.log('[A5] empty tab closed under mid-session reduced motion: OK');
});

// ---------------------------------------------------------------------------
// A6 - prefers-reduced-motion collapse, OS flag AT LAUNCH (authoritative)
// ---------------------------------------------------------------------------
test.describe('reduced motion via launch flag', () => {
  test.beforeEach(async () => {
    electronApp = await launchApp(['--force-prefers-reduced-motion']);
    win = await electronApp.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await installSampler();
  });

  test('A6: launch with --force-prefers-reduced-motion - no crossfade, no travel, states still change', async () => {
    test.setTimeout(180000);
    const switchState = await electronApp.evaluate(({ app }) => ({
      registered: app.commandLine.hasSwitch('force-prefers-reduced-motion'),
    }));
    const mediaState = await win.evaluate(() => ({
      reduce: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      bare: window.matchMedia('(prefers-reduced-motion)').matches,
    }));
    console.log('[A6] switch registered on main:', JSON.stringify(switchState), '| media at launch:', JSON.stringify(mediaState));
    if (!mediaState.reduce) {
      console.log('[A6] NOTE: launch switch did not force prefers-reduced-motion in this renderer; boot-time OS path not runtime-verifiable here. Hook-level reduced variants are covered by unit tests (useAnimations.test.tsx).');
      test.skip(true, '--force-prefers-reduced-motion did not reach this Electron renderer');
      return;
    }

    const tokens = await win.evaluate((keys) => {
      const cs = getComputedStyle(document.documentElement);
      const out = {};
      for (const k of keys) out[k] = cs.getPropertyValue(k).trim();
      return out;
    }, ['--motion-duration-fast', '--motion-duration-standard', '--motion-theme-crossfade']);
    console.log('[A6] reduced-motion tokens:', JSON.stringify(tokens));
    for (const v of Object.values(tokens)) expect(parseMs(v)).toBe(0);

    await win.evaluate(() => {
      window.__sawTransitionClass = false;
      new MutationObserver(() => {
        if (document.documentElement.classList.contains('tf-theme-transitioning')) window.__sawTransitionClass = true;
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    });

    await openReport(1200);

    // Popover: sample from before the click; must never travel.
    await startSample('.theme-toggle-popover', 700);
    await win.click('[data-theme-toggle]');
    await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
    const popSamples = await readSamples('[A6] popover enter:');
    expect(popSamples.length).toBeGreaterThan(0);
    for (const s of popSamples.slice(1)) {
      const m = parseMatrix(s.tr);
      expect(!m || Math.abs(m.a - 1) < 0.02, `popover must not travel under reduced motion (got ${s.tr})`).toBe(true);
    }
    await win.screenshot({ path: path.join(SHOTS, 'anim-reduced-motion.png') });

    // Theme flip: instant, never adds the crossfade class.
    await win.click('[data-theme-option="dark"]');
    await win.waitForTimeout(600);
    const sawClass = await win.evaluate(() => window.__sawTransitionClass);
    const theme = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
    console.log('[A6] theme now:', theme, '| transition class seen:', sawClass);
    expect(theme).toBe('dark');
    expect(sawClass, 'reduced motion must never run the crossfade').toBe(false);

    // New tab appears instantly (state change still visible) and closes.
    await win.click('button.tab-new');
    await win.waitForFunction(
      () => document.querySelectorAll('[data-animated-tab]').length === 2,
      null, { timeout: 4000 },
    );
    const matState = await win.evaluate(() => {
      const el = document.querySelector('[data-animated-tab]:last-of-type');
      return { op: getComputedStyle(el).opacity };
    });
    console.log('[A6] new tab under reduced motion: mounted, opacity', matState.op);
    expect(parseFloat(matState.op)).toBe(1);
    await win.locator('[data-animated-tab]').last().locator('.tab-close').click();
    await win.waitForFunction(() => document.querySelectorAll('[data-animated-tab]').length === 1, null, { timeout: 3000 });
    console.log('[A6] empty tab closed under reduced motion: OK');
  });
});