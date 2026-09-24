// PHASE 20 BASELINE INVENTORY (dev build) - the pre-implementation evidence
// base for the "Animation standard: morphing surfaces, animated resizes, no
// un-animated appearances" phase. This spec OBSERVES; it asserts nothing
// about the target state (the phase is not implemented yet).
//
// It records, for a representative of each surface family:
//   - the surface's computed animation/transition at mount (CSS channel)
//   - the live rAF transform/opacity/rect timeline around the appearance
//   - a 4-6 frame screenshot burst (~70ms apart)
// and the three Phase-20 baseline measurements:
//   B1 menu trigger-vs-surface rects + gap + morph (min scale vs trigger ratio)
//   B2 Sign modal tab-switch frame rects (does the box interpolate or jump)
//   B3 window-to-window swap (rail content swap: any frame both-absent)
//
// Canonical launcher only. No product code is touched.
const { test } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, openAnnotationFlyout, toggleEditMode, armSignTool } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots', 'phase20');
fs.mkdirSync(SHOTS, { recursive: true });

let electronApp = null;
let win = null;

test.beforeEach(async () => {
  electronApp = await launchApp();
  win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await installSampler();
});

test.afterEach(async () => {
  await hardClose(electronApp);
});

async function openReport(waitMs = 1500) {
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await win.waitForTimeout(waitMs);
}

// ---------------------------------------------------------------------------
// In-page rAF sampler. startSample() returns immediately and fills
// window.__rows each frame; readRows() waits for the run to finish.
// ---------------------------------------------------------------------------
async function installSampler() {
  await win.evaluate(() => {
    window.__rows = [];
    window.__sampling = false;
    window.__startSample = (sel, ms, pick) => {
      window.__rows = [];
      window.__sampling = true;
      const t0 = performance.now();
      const tick = () => {
        const list = document.querySelectorAll(sel);
        const el = pick === 'last' ? list[list.length - 1] : list[0];
        if (el) {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          window.__rows.push({
            t: Math.round(performance.now() - t0),
            tr: cs.transform,
            op: cs.opacity,
            an: cs.animationName,
            ad: cs.animationDuration,
            tp: cs.transitionProperty,
            td: cs.transitionDuration,
            x: Math.round(r.left),
            y: Math.round(r.top),
            w: Math.round(r.width),
            h: Math.round(r.height),
          });
        }
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else window.__sampling = false;
      };
      requestAnimationFrame(tick);
    };
  });
}

async function startSample(sel, ms, pick) {
  await win.evaluate(([s, m, p]) => window.__startSample(s, m, p), [sel, ms, pick]);
}

async function readRows() {
  await win.waitForFunction(() => window.__sampling === false, null, { timeout: 10000 }).catch(() => {});
  return win.evaluate(() => window.__rows || []);
}

// Compact summary of a sample run.
function summarize(rows) {
  if (!rows.length) return { frames: 0 };
  const uniq = (k) => [...new Set(rows.map((r) => r[k]))];
  const scaleOf = (tr) => {
    const m = tr && tr.match(/matrix\(([^)]+)\)/);
    return m ? parseFloat(m[1].split(',')[0]) : (tr === 'none' ? 1 : null);
  };
  const scales = rows.map((r) => scaleOf(r.tr)).filter((v) => v !== null);
  const restIdx = rows.findIndex((r) => scaleOf(r.tr) === 1 && parseFloat(r.op) === 1);
  return {
    frames: rows.length,
    anim: uniq('an'),
    animDur: uniq('ad'),
    transProp: uniq('tp'),
    transDur: uniq('td'),
    opFirst: rows[0].op,
    opLast: rows[rows.length - 1].op,
    opSeen: uniq('op').slice(0, 6),
    trSeen: uniq('tr').slice(0, 6),
    minScale: scales.length ? Math.min(...scales) : null,
    maxScale: scales.length ? Math.max(...scales) : null,
    restFrameIndex: restIdx,
    rect0: [rows[0].x, rows[0].y, rows[0].w, rows[0].h],
    rectLast: [
      rows[rows.length - 1].x,
      rows[rows.length - 1].y,
      rows[rows.length - 1].w,
      rows[rows.length - 1].h,
    ],
  };
}

function log(label, s) {
  console.log(`[P20] ${label}: ${JSON.stringify(s)}`);
}

// 5-frame screenshot burst around a just-triggered surface (~70ms apart).
async function burst(prefix, sel, n = 5, gap = 70) {
  const paths = [];
  for (let i = 0; i < n; i += 1) {
    const box = await win
      .evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: Math.max(0, Math.round(r.left - 40)),
          y: Math.max(0, Math.round(r.top - 40)),
          width: Math.min(620, Math.round(r.width + 80)),
          height: Math.min(620, Math.round(r.height + 80)),
        };
      }, sel)
      .catch(() => null);
    const p = path.join(SHOTS, `${prefix}-f${i}.png`);
    try {
      await win.screenshot(box ? { path: p, clip: box } : { path: p });
      paths.push(p);
    } catch (_) { /* node may already be gone */ }
    await win.waitForTimeout(gap);
  }
  return paths;
}

function rectOf(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x: Math.round(r.left), y: Math.round(r.top),
      w: Math.round(r.width), h: Math.round(r.height),
      bottom: Math.round(r.bottom), right: Math.round(r.right),
      transformOrigin: cs.transformOrigin,
      transform: cs.transform,
    };
  }, sel);
}

// ---------------------------------------------------------------------------
// A - representative family runtime probes (computed animation/transition at
//     mount + live timeline + screenshot burst)
// ---------------------------------------------------------------------------
test('P20-A: family mount probes + screenshot bursts', async () => {
  test.setTimeout(240000);
  await openReport(1500);

  // 1. Theme popover (menu/popover family).
  await startSample('.theme-toggle-popover', 500);
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await burst('menu-theme', '.theme-toggle-popover');
  log('theme-popover', summarize(await readRows()));
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);

  // 2. Title-bar menu (menu family, TfMenu).
  await startSample('.titlebar-menu-popover', 500);
  await win.click('[data-menu-button]');
  await win.waitForSelector('.titlebar-menu-popover', { timeout: 5000 });
  await burst('menu-titlebar', '.titlebar-menu-popover');
  log('titlebar-menu', summarize(await readRows()));
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);

  // 3. Annotation tools menu (TfPopover, portaled).
  // Phase 36 (chunk 3) — the ann menu lives in the REVIEW Annotate flyout.
  await openAnnotationFlyout(win);
  await startSample('.ann-tool-menu', 500);
  await win.click('[data-ann-dropdown-toggle]');
  await win.waitForSelector('[data-ann-dropdown-menu]', { timeout: 5000 });
  await burst('menu-ann', '.ann-tool-menu');
  log('ann-tool-menu', summarize(await readRows()));
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);

  // 4. Tools palette (panel family, TfPanel).
  await startSample('[data-tools-palette]', 700);
  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
  await burst('panel-tools', '[data-tools-palette]');
  log('tools-palette', summarize(await readRows()));

  // 5. Dialog (TfDialog + TfBackdrop) - Insert pages.
  await startSample('.modal-dialog', 700);
  await win.click('[data-tool-id="insertPages"]');
  await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 8000 });
  await burst('dialog-insert', '.modal-dialog');
  log('insert-dialog', summarize(await readRows()));
  await win.keyboard.press('Escape');
  await win.waitForFunction(() => document.querySelector('.modal-dialog') === null, null, { timeout: 3000 }).catch(() => {});

  // 6. Edit toolbar (bar family, TfBar).
  // Phase 36 (chunk 3) — Edit mode is the EDIT dock's `editMode` verb.
  await toggleEditMode(win);
  await startSample('.edit-toolbar', 500);
  await win.waitForSelector('.edit-toolbar', { timeout: 5000 });
  await burst('bar-edit', '.edit-toolbar');
  log('edit-toolbar', summarize(await readRows()));
  await toggleEditMode(win);
  await win.waitForTimeout(300);

  // 7. Search bar (conditional chrome row - static evidence says no wrapper).
  await startSample('.search-bar', 500);
  await win.keyboard.press('Control+f');
  await win.waitForSelector('.search-bar', { timeout: 5000 });
  await burst('bar-search', '.search-bar');
  log('search-bar', summarize(await readRows()));
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);

  // 8. Tab (AnimatedTab materialize) - sample the LAST tab (the new one).
  await startSample('[data-animated-tab]', 700, 'last');
  await win.click('button.tab-new');
  await win.waitForTimeout(100);
  log('tab-new', summarize(await readRows()));
  await win.locator('[data-animated-tab]').last().locator('.tab-close').click();
  await win.waitForTimeout(400);
});

// ---------------------------------------------------------------------------
// B1 - menu/popover morph baseline: trigger vs surface rects, gap, min scale.
// A true "grow from the trigger" morph starts at the trigger's own rect, so
// minScale ~= surfaceW/triggerW (much smaller than the pop preset 0.95) and
// the top/left edges sit flush (gap 0).
// ---------------------------------------------------------------------------
test('P20-B1: menu trigger-vs-surface rects and gap', async () => {
  test.setTimeout(180000);
  await openReport(1500);

  const cases = [
    { name: 'theme-popover', trigger: '[data-theme-toggle]', surface: '.theme-toggle-popover', esc: true },
    { name: 'titlebar-menu', trigger: '[data-menu-button]', surface: '.titlebar-menu-popover', esc: true },
    { name: 'ann-tools-menu', trigger: '[data-ann-dropdown-toggle]', surface: '.ann-tool-menu', esc: true },
  ];

  // Phase 36 (chunk 3) — the ann menu lives in the REVIEW Annotate flyout.
  await openAnnotationFlyout(win);

  for (const c of cases) {
    await win.waitForTimeout(250);
    // Escape closes the flyout too, so re-open it for the ann entry.
    if (c.name === 'ann-tools-menu') await openAnnotationFlyout(win);
    const trig = await rectOf(win, c.trigger);
    await startSample(c.surface, 500);
    await win.click(c.trigger);
    await win.waitForSelector(c.surface, { timeout: 5000 });
    const rows = await readRows();
    const surf = await rectOf(win, c.surface);
    const s = summarize(rows);
    const gapBelow = surf && trig ? surf.y - trig.bottom : null;
    const gapRight = surf && trig ? surf.right - trig.x : null;
    log(`${c.name} baseline`, {
      triggerRect: trig && [trig.x, trig.y, trig.w, trig.h],
      surfaceRect: surf && [surf.x, surf.y, surf.w, surf.h],
      gapBelowPx: gapBelow,
      transformOrigin: surf && surf.transformOrigin,
      minScale: s.minScale,
      maxScale: s.maxScale,
      triggerToSurfaceWidthRatio: surf && trig ? Math.round((trig.w / surf.w) * 100) / 100 : null,
      anim: s.anim,
      transProp: s.transProp,
    });
    if (c.esc) { await win.keyboard.press('Escape'); await win.waitForTimeout(300); }
  }
});

// ---------------------------------------------------------------------------
// B2 - Sign modal tab-switch: does the context window animate its size?
// Samples .modal-dialog.sig-manager rect across Draw -> Type -> Saved.
// ---------------------------------------------------------------------------
test('P20-B2: Sign modal tab-switch frame rects', async () => {
  test.setTimeout(180000);
  await openReport(1500);

  // Phase 36 (chunk 3) — Sign is the REVIEW dock's `sign` verb.
  await armSignTool(win);
  await win.waitForSelector('.sig-manager', { timeout: 8000 });
  await win.waitForTimeout(600);

// Start on Draw, then measure the switch INTO each other tab.
  await win.locator('.sig-tab', { hasText: 'Draw' }).first().click();
  await win.waitForTimeout(400);
  const seen = [];
  const order = [
    { name: 'type', label: 'Type' },
    { name: 'saved', label: 'Saved' },
    { name: 'draw', label: 'Draw' },
  ];
  for (const t of order) {
    const restBefore = await rectOf(win, '.sig-manager');
    await startSample('.sig-manager', 600);
    await win.locator('.sig-tab', { hasText: t.label }).first().click();
    const rows = await readRows();
    const s = summarize(rows);
    const rest = await rectOf(win, '.sig-manager');
    seen.push({
      tab: t.name,
      fromWH: [restBefore.w, restBefore.h],
      distinctWDuring: [...new Set(rows.map((r) => r.w))],
      distinctHDuring: [...new Set(rows.map((r) => r.h))],
      toWH: [rest.w, rest.h],
    });
    await win.waitForTimeout(400);
  }
  log('sign-tab-sequence', seen);
  await win.keyboard.press('Escape');
});

// ---------------------------------------------------------------------------
// B3 - window-to-window swap: rail thumbs -> annotations. Samples the swap
// layers' opacity + the rail content rect; a compliant swap never shows a
// frame where both layers are absent (count 0) or both fully painted at rest.
// ---------------------------------------------------------------------------
test('P20-B3: window-to-window swap (rail content)', async () => {
  test.setTimeout(180000);
  await openReport(1500);

  const activeBefore = await win.evaluate(() => {
    const t = document.querySelector('.rail-tab-active');
    return t ? (t.getAttribute('data-rail-tab') || t.textContent.trim()) : null;
  });
  await win.evaluate(() => {
    window.__swap = [];
    window.__swapStart = () => {
      window.__swap = [];
      window.__swapping = true;
      const t0 = performance.now();
      const tick = () => {
        const layers = [...document.querySelectorAll('.rail-content-swap')];
        window.__swap.push({
          t: Math.round(performance.now() - t0),
          count: layers.length,
          states: layers.map((l) => `${getComputedStyle(l).opacity}/${getComputedStyle(l).transform}/${Math.round(l.getBoundingClientRect().width)}`),
          sig: layers.map((l) => (l.textContent || '').trim().slice(0, 12)),
        });
        if (performance.now() - t0 < 800) requestAnimationFrame(tick);
        else window.__swapping = false;
      };
      requestAnimationFrame(tick);
    };
  });
  await win.evaluate(() => window.__swapStart());
  await win.click('[data-rail-tab="annotations"]');
  await win.waitForFunction(() => window.__swapping === false, null, { timeout: 5000 }).catch(() => {});
  const swap = await win.evaluate(() => window.__swap || []);
  const activeAfter = await win.evaluate(() => {
    const t = document.querySelector('.rail-tab-active');
    return t ? (t.getAttribute('data-rail-tab') || t.textContent.trim()) : null;
  });
  const zeroFrames = swap.filter((f) => f.count === 0).length;
  const bothRest = swap.filter((f) => f.states.length === 2 && f.states.every((s) => s.startsWith('1/'))).length;
  log('rail-swap', {
    activeBefore,
    activeAfter,
    frames: swap.length,
    zeroLayerFrames: zeroFrames,
    bothAtRestFrames: bothRest,
    maxLayerCount: Math.max(...swap.map((f) => f.count)),
    distinctLayerStates: [...new Set(swap.flatMap((f) => f.states))].slice(0, 10),
    firstStates: swap[0] && swap[0].states,
    midStates: swap[Math.floor(swap.length / 2)] && swap[Math.floor(swap.length / 2)].states,
  });
});
