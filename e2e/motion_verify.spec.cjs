// MOTION VERIFICATION (dev build) - proves the global motion system is wired
// and CLEARLY VISIBLE in the live DOM, per the orchestrator's checklist:
//   1. Timing/easing tokens exist in :root (NOT inside a theme block).
//   2. Tools palette entrance = spring travel x 24 -> 0 @ ~280ms
//      (TfPanel wrapper; 1.10.0 replaced the panel-enter CSS keyframe).
//   3. Dialogs = spring rise y 10 / scale 0.97 -> rest @ ~240ms (TfDialog).
//   4. Menus/popovers = spring scale 0.96/0.97 + y -4/-3 @ ~180ms (TfMenu/TfPopover).
//   5. Buttons = hover translateY(-1px), press scale(--motion-scale-press) @ 70ms.
//   6. PDF page/.page-slot/.textLayer have ZERO animation (PDF stable).
//   7. prefers-reduced-motion collapses motion (opacity-only survivors).
// Mid-animation computed styles are sampled in-page (rAF) so the verdict is
// based on the LIVE animated values, not just the static stylesheet.
// Since the 1.10.0 physics migration the enter/exit motion of panels,
// dialogs, menus and popovers is JS-spring-driven (motion/react through the
// TfMotion wrappers, src/renderer/components/motion/) - the surfaces must
// show NO CSS keyframe and REAL mid-flight transform/opacity travel.
// Canonical launcher, dev build (no executablePath).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, armAnnotationTool } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

let electronApp = null;
let win = null;

const MOTION_PROPS = [
  '--tf-motion-instant', '--tf-motion-fast', '--tf-motion-normal',
  '--tf-motion-emphasized', '--tf-motion-panel', '--tf-motion-large',
  '--tf-ease-standard', '--tf-ease-emphasized', '--tf-ease-fast',
];

// Parse "matrix(a, b, c, d, e, f)" into numbers; returns null for 'none'.
function parseMatrix(tr) {
  if (!tr || tr === 'none') return null;
  const m = tr.match(/matrix\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
  return { a: parts[0], f: parts[5], tx: parts[4], ty: parts[5] };
}

// Chromium normalizes time values in computed custom properties (120ms ->
// ".12s"), so compare durations numerically in milliseconds.
function parseMs(v) {
  const m = /^([\d.]+)(ms|s)$/.exec((v || '').trim());
  if (!m) return NaN;
  return parseFloat(m[1]) * (m[2] === 's' ? 1000 : 1);
}

// Install an in-page rAF sampler. It records computed style of the target
// from the moment the target appears in the DOM until `ms` elapsed.
async function installSampler() {
  await win.evaluate(() => {
    window.__mSamples = null;
    window.__mStart = (targetSel, ms) => {
      window.__mSamples = [];
      const t0 = performance.now();
      const tick = () => {
        const el = document.querySelector(targetSel);
        if (el) {
          const cs = getComputedStyle(el);
          window.__mSamples.push({
            t: Math.round(performance.now() - t0),
            tr: cs.transform,
            op: cs.opacity,
            an: cs.animationName,
            ad: cs.animationDuration,
            ae: cs.animationTimingFunction,
          });
        }
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
  });
}

async function startSample(targetSel, ms) {
  await win.evaluate(([sel, dur]) => window.__mStart(sel, dur), [targetSel, ms]);
}

async function readSamples() {
  return win.evaluate(() => window.__mSamples || []);
}

// Snapshot one sample's transform compactly for the log.
function fmtSample(s) {
  const m = parseMatrix(s.tr);
  const pos = m ? `tx=${m.tx.toFixed(2)} ty=${m.ty.toFixed(2)} sx=${m.a.toFixed(3)}` : 'none';
  return `t=${s.t}ms ${pos} op=${s.op} anim=${s.an}@${s.ad}`;
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
// 1. Tokens exist in :root (not inside a theme block) with the spec values.
// ---------------------------------------------------------------------------
test('M1: motion timing + easing tokens are :root-level and theme-independent', async () => {
  const res = await win.evaluate((props) => {
    const out = { rootDecls: {}, themeDecls: {} };
    const walk = (rules) => {
      for (const r of rules) {
        if (r.cssRules && r.cssRules.length) { walk(r.cssRules); continue; }
        if (r.selectorText && r.style) {
          const isTheme = /\[data-theme/.test(r.selectorText);
          for (const p of props) {
            const v = r.style.getPropertyValue(p);
            if (v) (isTheme ? out.themeDecls : out.rootDecls)[p] = v.trim();
          }
        }
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules); } catch (e) { /* cross-origin sheet: skip */ }
    }
    const cs = getComputedStyle(document.documentElement);
    out.computed = {};
    for (const p of props) out.computed[p] = cs.getPropertyValue(p).trim();
    return out;
  }, MOTION_PROPS);

  console.log('[M1] :root declarations:', JSON.stringify(res.rootDecls, null, 0));
  console.log('[M1] theme-block declarations:', JSON.stringify(res.themeDecls, null, 0));
  console.log('[M1] computed:', JSON.stringify(res.computed, null, 0));

  for (const p of MOTION_PROPS) {
    expect(res.rootDecls[p], `${p} must be declared in a :root rule`).toBeTruthy();
    expect(res.themeDecls[p], `${p} must NOT be redeclared in a theme block`).toBeUndefined();
    if (p.startsWith('--tf-ease')) {
      // Chromium normalizes "0.16" to ".16" in computed values - compare the
      // four bezier control numbers numerically instead of the raw string.
      const nums = (v) => (v.match(/-?[\d.]+/g) || []).map(Number).join(',');
      expect(nums(res.computed[p]), `${p} must resolve on :root`).toBe(nums(res.rootDecls[p]));
    } else {
      expect(parseMs(res.computed[p]), `${p} must resolve on :root`).toBe(parseMs(res.rootDecls[p]));
    }
  }
  expect(parseMs(res.computed['--tf-motion-instant'])).toBe(70);
  expect(parseMs(res.computed['--tf-motion-fast'])).toBe(120);
  expect(parseMs(res.computed['--tf-motion-normal'])).toBe(180);
  expect(parseMs(res.computed['--tf-motion-emphasized'])).toBe(240);
  expect(parseMs(res.computed['--tf-motion-panel'])).toBe(280);
  expect(parseMs(res.computed['--tf-motion-large'])).toBe(320);
  const bez = (v) => (v.match(/-?[\d.]+/g) || []).map(Number);
  expect(bez(res.computed['--tf-ease-standard'])).toEqual([0.16, 1, 0.3, 1]);
  expect(bez(res.computed['--tf-ease-emphasized'])).toEqual([0.22, 1, 0.36, 1]);
  expect(bez(res.computed['--tf-ease-fast'])).toEqual([0.2, 0.8, 0.2, 1]);
});

// ---------------------------------------------------------------------------
// 2-6. Live entrance sampling + button states + PDF stability + screenshots.
// ---------------------------------------------------------------------------
test('M2: palette / dialog / menu / popover entrance + buttons + PDF stability', async () => {
  test.setTimeout(240000);

  // ---- Open a document (workspace) ----
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await win.waitForTimeout(2500); // let page 1 + textLayer render

  // ---- 6. PDF stability FIRST (clean page, no overlays) ----
  const pdfAnim = await win.evaluate(() => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
    const sels = ['.page-slot', '.pdf-page', '.textLayer', '.pdf-page-canvas', '.textLayer span'];
    const out = {};
    for (const sel of sels) {
      const el = pane.querySelector(sel);
      if (!el) { out[sel] = 'MISSING'; continue; }
      const cs = getComputedStyle(el);
      out[sel] = {
        animationName: cs.animationName, animationDuration: cs.animationDuration,
        transitionProperty: cs.transitionProperty, transitionDuration: cs.transitionDuration,
        transform: cs.transform,
      };
    }
    return out;
  });
  console.log('[M6] PDF element motion:', JSON.stringify(pdfAnim, null, 1));
  for (const sel of Object.keys(pdfAnim)) {
    expect(pdfAnim[sel], `${sel} must exist in the live workspace`).not.toBe('MISSING');
    const st = pdfAnim[sel];
    expect(st.animationName, `${sel} must have no animation`).toBe('none');
    expect(st.animationDuration, `${sel} must have no animation duration`).toBe('0s');
    expect(st.transitionDuration, `${sel} must have no transition`).toBe('0s');
  }
  // The page must never carry a resting transform (would wobble the sheet).
  expect(pdfAnim['.pdf-page'].transform).toBe('none');

  // ---- 5a. Button hover lift ----
  const menuBtn = win.locator('.titlebar-menu-button');
  await menuBtn.hover();
  await win.waitForTimeout(250); // 120ms transition + margin
  const hover = await win.evaluate(() => {
    const el = document.querySelector('.titlebar-menu-button');
    const cs = getComputedStyle(el);
    return { tr: cs.transform, td: cs.transitionDuration, tp: cs.transitionProperty };
  });
  console.log('[M5] hover:', JSON.stringify(hover));
  let hm = parseMatrix(hover.tr);
  expect(hm, 'hover must lift the button (transform != none)').toBeTruthy();
  expect(Math.round(hm.ty)).toBe(-1);
  expect(Math.round(hm.tx)).toBe(0);
  expect(parseFloat(hover.td)).toBeGreaterThan(0);
  await win.mouse.move(10, 300); // leave
  await win.waitForTimeout(250);

  // ---- 2. Tools palette entrance (mid-flight sampling) ----
  await startSample('[data-tools-palette]', 700);
  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
  await win.waitForTimeout(90);
  await win.screenshot({ path: path.join(SHOTS, 'motion-palette-midflight.png') });
  await win.waitForTimeout(650);
  await win.screenshot({ path: path.join(SHOTS, 'motion-palette-open.png') });
  const palSamples = await readSamples();
  console.log('[M2] palette samples:', JSON.stringify(palSamples.map(fmtSample)));
  expect(palSamples.length, 'palette must be sampled during its entrance').toBeGreaterThan(2);
  // 1.10.0 physics migration: the palette animates through the TfPanel
  // spring wrapper (JS-driven transform/opacity via motion/react,
  // tfPreset panel: x 24 -> 0, stiffness 420 / damping 34 ~280ms), NOT a
  // CSS keyframe. Proof of the spring contract:
  //   a) the surface is the TfPanel wrapper (renders an <aside>),
  //   b) NO CSS keyframe appears on it at any sampled frame,
  //   c) real transform/opacity travel is caught mid-flight,
  //   d) it settles at full opacity / identity transform.
  const tag = await win.evaluate(() => document.querySelector('[data-tools-palette]').tagName);
  expect(tag, 'palette must be the TfPanel wrapper (motion.aside)').toBe('ASIDE');
  const first = palSamples[0];
  expect(first.an, 'palette entrance must not run any CSS keyframe').toBe('none');
  expect(first.op !== '1' || first.tr !== 'none',
    'first sampled frame must be mid-flight (spring already driving values)').toBe(true);
  for (const s of palSamples) {
    expect(s.an, `no CSS keyframe may appear on the palette at any frame (got ${s.an} @t=${s.t}ms)`).toBe('none');
  }
  const mid = palSamples.find((s) => {
    const m = parseMatrix(s.tr);
    return m && m.tx > 0.5 && m.tx < 24;
  });
  expect(mid, 'palette must be caught mid-slide (0 < tx < 24) - real spring travel, not a fade').toBeTruthy();
  const last = palSamples[palSamples.length - 1];
  const lastM = parseMatrix(last.tr);
  expect(last.op, 'palette settles fully opaque').toBe('1');
  expect(!lastM || (Math.abs(lastM.tx) < 0.5 && Math.abs(lastM.a - 1) < 0.01), 'palette settles at identity transform').toBe(true);

  // ---- 3. Dialog entrance ----
  await startSample('.modal-dialog', 700);
  await win.click('[data-tool-id="insertPages"]');
  await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 8000 });
  await win.waitForTimeout(90);
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(SHOTS, 'motion-dialog-open.png') });
  const dlgSamples = await readSamples();
  console.log('[M3] dialog samples:', JSON.stringify(dlgSamples.map(fmtSample)));
  expect(dlgSamples.length).toBeGreaterThan(2);
  // Spring contract (TfDialog, tfPreset dialog: y 10 / scale 0.97 -> 1,
  // stiffness 560 / damping 38 ~240ms) - no CSS keyframe, real travel.
  const dFirst = dlgSamples[0];
  expect(dFirst.an, 'dialog entrance must not run any CSS keyframe').toBe('none');
  expect(dFirst.op !== '1' || dFirst.tr !== 'none',
    'dialog first sampled frame must be mid-flight (spring already driving values)').toBe(true);
  for (const s of dlgSamples) {
    expect(s.an, `no CSS keyframe may appear on the dialog at any frame (got ${s.an} @t=${s.t}ms)`).toBe('none');
  }
  const dMid = dlgSamples.find((s) => {
    const m = parseMatrix(s.tr);
    return m && (m.ty > 0.5 || m.a < 0.99);
  });
  expect(dMid, 'dialog must be caught mid rise+settle (translateY>0 or scale<1) - real spring travel').toBeTruthy();

  // ---- 4a. Titlebar menu popover entrance ----
  await win.keyboard.press('Escape');
  await win.waitForTimeout(450);
  await startSample('.titlebar-menu-popover', 600);
  await win.click('.titlebar-menu-button');
  await win.waitForSelector('.titlebar-menu-popover', { timeout: 8000 });
  await win.waitForTimeout(80);
  await win.screenshot({ path: path.join(SHOTS, 'motion-menu-midflight.png') });
  await win.waitForTimeout(450);
  const menuSamples = await readSamples();
  console.log('[M4] menu samples:', JSON.stringify(menuSamples.map(fmtSample)));
  expect(menuSamples.length).toBeGreaterThan(1);
  // Spring contract (TfMenu, tfPreset menu: scale 0.96 / y -4 -> 0,
  // stiffness 1000 / damping 50 ~180ms) - no CSS keyframe, real travel.
  const mFirst = menuSamples[0];
  expect(mFirst.an, 'menu entrance must not run any CSS keyframe').toBe('none');
  for (const s of menuSamples) {
    expect(s.an, `no CSS keyframe may appear on the menu at any frame (got ${s.an} @t=${s.t}ms)`).toBe('none');
  }
  const mMid = menuSamples.find((s) => {
    const m = parseMatrix(s.tr);
    return m && (m.a < 0.995 || Math.abs(m.ty) > 0.2);
  });
  expect(mMid, 'menu must be caught mid grow (scale<1 or translateY<0) - real spring travel').toBeTruthy();
  await win.screenshot({ path: path.join(SHOTS, 'motion-menu-open.png') });
  await win.keyboard.press('Escape');
  await win.waitForTimeout(400);

  // ---- 4b. Annotation color popover entrance ----
  await armAnnotationTool(win, 'ink');
  await win.waitForTimeout(400);
  await startSample('.color-popover', 600);
  await win.locator('.ann-color-swatch-main').click();
  await win.waitForSelector('.color-popover', { timeout: 6000 });
  await win.waitForTimeout(420);
  await win.screenshot({ path: path.join(SHOTS, 'motion-color-popover.png') });
  const popSamples = await readSamples();
  console.log('[M4] popover samples:', JSON.stringify(popSamples.map(fmtSample)));
  expect(popSamples.length).toBeGreaterThan(1);
  // Spring contract (TfPopover, tfPreset popover: scale 0.97 / y -3 -> 0,
  // stiffness 1000 / damping 50 ~180ms) - no CSS keyframe, real travel.
  const pFirst = popSamples[0];
  expect(pFirst.an, 'popover entrance must not run any CSS keyframe').toBe('none');
  for (const s of popSamples) {
    expect(s.an, `no CSS keyframe may appear on the popover at any frame (got ${s.an} @t=${s.t}ms)`).toBe('none');
  }
  const pMid = popSamples.find((s) => {
    const m = parseMatrix(s.tr);
    return m && (m.a < 0.995 || Math.abs(m.ty) > 0.2);
  });
  expect(pMid, 'popover must be caught mid swell (scale<1 or translateY<0) - real spring travel').toBeTruthy();
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);

  // ---- 5b. Press settle: hold mouse down on a rail tab ----
  const pressScale = await win.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--motion-scale-press')));
  const tab = win.locator('.rail-tab').first();
  const tb = await tab.boundingBox();
  await win.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
  await win.mouse.down();
  await win.waitForTimeout(220); // 70ms press transition completes
  const pressed = await win.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.rail-tab'));
    return { tr: cs.transform, td: cs.transitionDuration };
  });
  console.log('[M5] pressed:', JSON.stringify(pressed), `(live --motion-scale-press=${pressScale})`);
  await win.mouse.up();
  const pm = parseMatrix(pressed.tr);
  expect(pm, 'press must settle (transform != none)').toBeTruthy();
  // Phase-15 tokens are authoritative: compare against the LIVE token value
  // rather than a hardcoded legacy 0.982, so this can never rot again.
  expect(Math.abs(pm.a - pressScale), `press scale must equal --motion-scale-press (${pressScale})`).toBeLessThan(0.01);
  expect(Math.round(pm.f), 'press translateY(1px)').toBe(1);
  expect(parseFloat(pressed.td), 'press transition 70ms').toBeLessThanOrEqual(0.075);
});

// ---------------------------------------------------------------------------
// 7. prefers-reduced-motion collapses motion; opacity-only survivors stay.
// ---------------------------------------------------------------------------
test('M7: prefers-reduced-motion collapses motion to instant state change', async () => {
  test.setTimeout(180000);
  await win.emulateMedia({ reducedMotion: 'reduce' });

  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Palette under reduced motion: no travel at all, duration collapsed.
  await startSample('[data-tools-palette]', 400);
  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
  await win.waitForTimeout(450);
  const rmSamples = await readSamples();
  console.log('[M7] reduced-motion palette samples:', JSON.stringify(rmSamples.map(fmtSample)));
  expect(rmSamples.length).toBeGreaterThan(0);
  // The FIRST rAF sample always reads the animation's from-keyframe (progress
  // = 0 inside the animation's first frame, even at 0.01ms) and that frame is
  // never painted. From the second sample on, the element must be settled.
  for (const s of rmSamples.slice(1)) {
    const m = parseMatrix(s.tr);
    expect(!m || (Math.abs(m.tx) < 0.5 && Math.abs(m.a - 1) < 0.01),
      `reduced motion: palette must never travel (got ${s.tr})`).toBe(true);
    const dur = parseFloat(s.ad);
    expect(dur, 'reduced motion: palette duration collapsed (<= 0.01ms or 0)').toBeLessThan(0.005);
  }

  // Modal backdrop survivor: keeps its opacity-only fade (~120ms under RM).
  await win.click('[data-tool-id="insertPages"]');
  await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 8000 });
  await win.waitForTimeout(300);
  const rmBackdrop = await win.evaluate(() => {
    const bd = document.querySelector('.modal-backdrop');
    const dlg = document.querySelector('.modal-dialog');
    return {
      backdropDur: bd ? getComputedStyle(bd).animationDuration : 'MISSING',
      dialogDur: dlg ? getComputedStyle(dlg).animationDuration : 'MISSING',
    };
  });
  console.log('[M7] reduced-motion backdrop/dialog durations:', JSON.stringify(rmBackdrop));
  expect(parseFloat(rmBackdrop.backdropDur), 'backdrop opacity fade survives (~120ms)')
    .toBeGreaterThanOrEqual(0.1);
  expect(parseFloat(rmBackdrop.dialogDur), 'dialog motion collapses under RM').toBeLessThan(0.005);
  await win.keyboard.press('Escape');
});
