// Phase 23 QA validation — the Animations off switch.
//
// Measures the running Electron app (canonical launcher only) against the
// phase's six success criteria:
//   C1 frame-sampled instant path for menu / text-panel / dialog / toast /
//      theme / rail / tab + end geometry parity.
//   C2 restart persistence + malformed stored value falls back to default.
//   C3 Preferences control reflects the stored value, applies immediately,
//      carries the hint.
//   C4 the setting x OS reduced-motion matrix (CDP emulation).
//   C5 this spec (toggle -> instant -> restart persistence).
//
// Screenshots: screenshots/phase23-qa-*.png
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, armAnnotationTool } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const log = (label, obj) => console.log(`[P23] ${label} ${JSON.stringify(obj)}`);

function seedDir(tag, settings) {
  const ud = path.join(os.tmpdir(), `tflex-p23qa-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  fs.mkdirSync(ud, { recursive: true });
  if (settings) fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify(settings));
  return ud;
}

// A deterministic-path copy of a bundled sample: the tab label is the file
// basename, so the two launches must open the SAME basename or the tab-rect
// comparison varies with the timestamped temp copy name.
const FIXED_DIR = path.join(os.tmpdir(), 'tflex-p23qa-fixed');
fs.mkdirSync(FIXED_DIR, { recursive: true });
function fixedCopy(name) {
  const target = path.join(FIXED_DIR, name);
  fs.copyFileSync(path.join(__dirname, '..', 'assets', 'samples', name), target);
  return target;
}

async function launchWithSettings(tag, settings, extraArgs = []) {
  const ud = seedDir(tag, settings);
  const app = await launchApp(extraArgs, ud);
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  return { app, win, ud };
}

async function openReport(app, win) {
  const p = fixedCopy('report.pdf');
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('[data-home-tool="open"]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);
}

// rAF probe: samples one selector each frame (rect + transform + opacity).
// A selector prefixed "last::" samples the LAST matching element (used for
// the newest tab, which is not the :last-child li because the + button is).
async function installProbe(win) {
  await win.evaluate(() => {
    window.__p23 = { rows: [], running: false, total: 0 };
    window.__p23Start = (sel, ms) => {
      window.__p23 = { rows: [], running: true, total: 0 };
      const t0 = performance.now();
      const tick = () => {
        window.__p23.total += 1;
        let el = null;
        if (sel.startsWith('last::')) {
          const all = document.querySelectorAll(sel.slice(6));
          el = all.length ? all[all.length - 1] : null;
        } else {
          el = document.querySelector(sel);
        }
        if (el) {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          window.__p23.rows.push({
            t: Math.round(performance.now() - t0),
            tr: cs.transform, op: Number.parseFloat(cs.opacity),
            left: +r.left.toFixed(2), top: +r.top.toFixed(2),
            w: +r.width.toFixed(2), h: +r.height.toFixed(2),
          });
        }
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else window.__p23.running = false;
      };
      requestAnimationFrame(tick);
    };
  });
}

async function probe(win, sel, ms, action) {
  await win.evaluate(([s, m]) => window.__p23Start(s, m), [sel, ms]);
  await action();
  await win.waitForFunction(() => window.__p23.running === false, null, { timeout: 10000 }).catch(() => {});
  return win.evaluate(() => window.__p23.rows);
}

function parseMatrix(tr) {
  if (!tr || tr === 'none') return { a: 1, tx: 0, ty: 0 };
  const m = /matrix\(([^)]+)\)/.exec(tr);
  if (!m) return null;
  const p = m[1].split(',').map((s) => parseFloat(s.trim()));
  return { a: p[0], tx: p[4], ty: p[5] };
}

// A frame is "intermediate" when the surface sits strictly between its
// resting identity (scale 1 / 0 travel / full opacity) and a hidden pose.
function summarise(rows) {
  let intermediates = 0;
  for (const r of rows) {
    const m = parseMatrix(r.tr);
    const opMid = r.op > 0.02 && r.op < 0.98;
    const trMid = m !== null && (Math.abs(m.a - 1) > 0.01 || Math.abs(m.tx) > 0.5 || Math.abs(m.ty) > 0.5);
    if (opMid || trMid) intermediates += 1;
  }
  const rects = new Set(rows.map((r) =>
    `${Math.round(r.left / 2) * 2},${Math.round(r.top / 2) * 2},${Math.round(r.w / 2) * 2},${Math.round(r.h / 2) * 2}`));
  const end = rows[rows.length - 1] || null;
  return {
    frames: rows.length,
    intermediates,
    distinctRects: rects.size,
    end: end ? { left: end.left, top: end.top, w: end.w, h: end.h } : null,
  };
}

function rectsEqual(a, b, tol = 1.5) {
  if (!a || !b) return false;
  return Math.abs(a.left - b.left) <= tol && Math.abs(a.top - b.top) <= tol
    && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol;
}

// Phase 36 (chunk 4) — the All-tools palette is retired; the Command Palette
// (Ctrl+K) is the browse-everything surface. This opens it and runs a query.
async function ensurePalette(win) {
  if ((await win.locator('[data-command-palette]').count()) === 0) {
    await win.keyboard.press('Control+k');
    await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
  }
  await win.waitForTimeout(250);
}

async function runPaletteTool(win, id, query) {
  await ensurePalette(win);
  await win.fill('[data-command-palette-input]', query);
  await win.waitForTimeout(200);
  await win.locator(`[data-palette-tool-id="${id}"]`).first().click();
}

// Theme-crossfade probe: counts frames carrying the fallback crossfade class
// and instruments startViewTransition so both strategies are observable.
async function installThemeProbe(win) {
  await win.evaluate(() => {
    window.__p23t = { rows: [], running: false, vt: 0 };
    if (typeof document.startViewTransition === 'function' && !window.__p23tWrapped) {
      window.__p23tWrapped = true;
      const orig = document.startViewTransition.bind(document);
      document.startViewTransition = (cb) => { window.__p23t.vt += 1; return orig(cb); };
    }
    window.__p23tStart = (ms) => {
      window.__p23t.rows = [];
      window.__p23t.running = true;
      const t0 = performance.now();
      const tick = () => {
        window.__p23t.rows.push({
          t: Math.round(performance.now() - t0),
          cls: document.documentElement.classList.contains('tf-theme-transitioning'),
          theme: document.documentElement.dataset.theme,
        });
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else window.__p23t.running = false;
      };
      requestAnimationFrame(tick);
    };
  });
}

async function themeSwitch(win) {
  const before = await win.evaluate(() => document.documentElement.dataset.theme);
  const target = before === 'light' ? 'dark' : 'light';
  await win.evaluate((m) => window.__p23tStart(m), 520);
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${target}"]`);
  await win.waitForFunction(() => window.__p23t.running === false, null, { timeout: 8000 }).catch(() => {});
  return win.evaluate(() => ({
    rows: window.__p23t.rows, vt: window.__p23t.vt,
  }));
}

// ---------------------------------------------------------------------------
// Drive every measured surface once; returns the per-surface frame report.
// ---------------------------------------------------------------------------
async function runSurfaces(app, win, mode) {
  const report = {};
  const shot = (name) => win.screenshot({ path: path.join(SHOTS, `phase23-qa-${mode}-${name}.png`) });
  await installProbe(win);

  // (a) morphing menu open, then close.
  await win.keyboard.press('Escape').catch(() => undefined);
  await win.waitForTimeout(200);
  report.menuOpen = summarise(await probe(win, '.titlebar-menu-popover', 430, async () => {
    await win.click('[data-menu-button]');
  }));
  await shot('menu');
  report.menuClose = summarise(await probe(win, '.titlebar-menu-popover', 430, async () => {
    await win.keyboard.press('Escape');
  }));
  await win.waitForTimeout(300);

  // (b) text-panel reflow: arming a text-bearing tool opens .text-props-panel.
  await armAnnotationTool(win, 'select');
  await win.waitForTimeout(250);
  report.panelOpen = summarise(await probe(win, '.text-props-panel', 520, async () => {
    await armAnnotationTool(win, 'textbox');
  }));
  await shot('panel');
  await armAnnotationTool(win, 'select');
  await win.waitForTimeout(300);

  // (c) dialog open (insert pages) via the Command Palette. Pre-open the
  // palette so the probe's 520ms window covers only the dialog appearance.
  await ensurePalette(win);
  await win.fill('[data-command-palette-input]', 'insert pages');
  await win.waitForTimeout(150);
  report.dialogOpen = summarise(await probe(win, '.modal-dialog', 520, async () => {
    await win.locator('[data-palette-tool-id="insertPages"]').first().click();
  }));
  await shot('dialog');
  await win.click('[data-insert-pages-dialog] button[aria-label="Close dialog"]');
  await win.waitForSelector('[data-insert-pages-dialog]', { state: 'detached', timeout: 8000 });
  await win.waitForTimeout(300);

  // (d) rail collapse: the page view shifts; sample the workspace inset.
  report.rail = summarise(await probe(win, '.workspace-main', 520, async () => {
    await win.click('[data-rail-collapse]');
  }));
  await shot('rail');
  // DEF-320 — the collapsed panel's expand button is covered by the Stage
  // Rail; attempt the restore and continue collapsed if it is intercepted.
  try {
    await win.click('[data-rail-collapse]', { timeout: 6000 });
  } catch (err) {
    console.log(`[P23-C1] DEF-320: expand blocked by the Stage Rail (${err.message.split('\n')[0]})`);
  }
  await win.waitForTimeout(300);

  // (e) tab switch: opening a second document materializes its new tab
  // (opacity-only). Sample the NEWEST tab (last [data-animated-tab]).
  const p2 = fixedCopy('long.pdf');
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p2);
  const tabsBefore = await win.locator('[data-animated-tab]').count();
  report.tabMaterialize = summarise(await probe(win, 'last::[data-animated-tab]', 1200, async () => {
    await win.click('[data-menu-button]');
    await win.waitForSelector('[data-menu-action="open"]', { timeout: 5000 });
    await win.click('[data-menu-action="open"]');
  }));
  await win.waitForFunction((n) => document.querySelectorAll('[data-animated-tab]').length > n, tabsBefore, { timeout: 20000 });
  await win.waitForTimeout(2500);
  await shot('tab');

  // (f) REMOVED with its subject (Phase 36 chunk 5): the All-tools palette's
  // list<->grid width swap is retired — the Inspector has ONE width.

  // (g) toast: applying a watermark fires "Watermark applied.". Pre-open the
  // palette + dialog before the probe so its window covers only the toast.
  await ensurePalette(win);
  await win.fill('[data-command-palette-input]', 'watermark');
  await win.waitForTimeout(150);
  await win.locator('[data-palette-tool-id="watermark"]').first().click();
  await win.waitForSelector('[data-watermark-dialog]', { timeout: 8000 });
  await win.locator('[data-watermark-text]').fill('CONFIDENTIAL');
  report.toast = summarise(await probe(win, '.toast', 1800, async () => {
    await win.click('[data-watermark-confirm]');
  }));
  await win.waitForTimeout(200);

  // (h) theme switch: crossfade class frames + View Transition count.
  await installThemeProbe(win);
  const t = await themeSwitch(win);
  report.theme = {
    frames: t.rows.length,
    crossfadeFrames: t.rows.filter((r) => r.cls).length,
    viewTransitions: t.vt,
    themes: [...new Set(t.rows.map((r) => r.theme))],
  };
  await shot('theme');

  await win.keyboard.press('Escape').catch(() => undefined);
  return report;
}

// ===========================================================================
// C1 — with the setting OFF every surface is frame-sampled on the instant
// path, and every end rect equals the animated path's.
// ===========================================================================
const COMPARED = [
  ['menuOpen', 'menu open'],
  ['panelOpen', 'text-panel reflow'],
  ['dialogOpen', 'dialog open'],
  ['rail', 'rail collapse'],
  ['tabMaterialize', 'tab switch (new tab)'],
  ['toast', 'toast'],
];

test('C1 animations OFF: instant path for all 7 surfaces + end-geometry parity', async () => {
  test.setTimeout(420000);
  const off = await launchWithSettings('c1-off', { animationsEnabled: false });
  let offReport;
  try {
    const gate = await off.win.evaluate(() => document.documentElement.dataset.animations);
    expect(gate, 'root hook data-animations=off').toBe('off');
    await openReport(off.app, off.win);
    offReport = await runSurfaces(off.app, off.win, 'off');
  } finally {
    await hardClose(off.app, 'p23-c1-off');
  }

  const on = await launchWithSettings('c1-on', null);
  let onReport;
  try {
    const gate = await on.win.evaluate(() => document.documentElement.dataset.animations);
    expect(gate, 'root hook data-animations=on by default').toBe('on');
    await openReport(on.app, on.win);
    onReport = await runSurfaces(on.app, on.win, 'on');
  } finally {
    await hardClose(on.app, 'p23-c1-on');
  }

  log('C1-off', offReport);
  log('C1-on', onReport);

  // The OFF path must show no intermediate frame on any surface.
  for (const s of ['menuOpen', 'menuClose', 'panelOpen', 'dialogOpen', 'rail', 'tabMaterialize', 'toast']) {
    expect(offReport[s].frames, `OFF ${s}: surface was sampled`).toBeGreaterThan(0);
    expect(offReport[s].intermediates, `OFF ${s}: no intermediate frame`).toBe(0);
    log(`C1-${s}-off`, { frames: offReport[s].frames, intermediates: offReport[s].intermediates, distinctRects: offReport[s].distinctRects, end: offReport[s].end });
    log(`C1-${s}-on`, { frames: onReport[s].frames, intermediates: onReport[s].intermediates, distinctRects: onReport[s].distinctRects, end: onReport[s].end });
  }

  // The ON baseline must actually be animated, or the OFF result is vacuous.
  expect(onReport.menuOpen.intermediates > 0 || onReport.menuOpen.distinctRects > 2,
    'ON menu open is animated (probe discriminates)').toBe(true);

  // Theme: OFF runs no crossfade and no View Transition; ON does.
  expect(offReport.theme.crossfadeFrames, 'OFF theme: no crossfade class frames').toBe(0);
  expect(offReport.theme.viewTransitions, 'OFF theme: no View Transition started').toBe(0);
  expect(offReport.theme.themes.length, 'OFF theme: theme still flips').toBeGreaterThanOrEqual(2);
  expect(onReport.theme.crossfadeFrames > 0 || onReport.theme.viewTransitions > 0,
    'ON theme: crossfade or View Transition ran').toBe(true);

  // End geometry parity, numeric.
  for (const [key, label] of COMPARED) {
    const a = offReport[key].end;
    const b = onReport[key].end;
    const eq = rectsEqual(a, b);
    log('C1-geometry', { surface: label, equal: eq, off: a, on: b });
    expect(eq, `END geometry identical: ${label} (off=${JSON.stringify(a)} on=${JSON.stringify(b)})`).toBe(true);
  }
});

// ===========================================================================
// C4 — the setting x OS reduced-motion matrix (CDP emulation).
// ===========================================================================
const MATRIX = [
  { setting: true, reduce: false, expectAnimated: true, label: 'ON+OS-normal' },
  { setting: true, reduce: true, expectAnimated: false, label: 'ON+OS-reduce' },
  { setting: false, reduce: false, expectAnimated: false, label: 'OFF+OS-normal' },
  { setting: false, reduce: true, expectAnimated: false, label: 'OFF+OS-reduce' },
];

test('C4 setting x OS reduced-motion matrix', async () => {
  test.setTimeout(420000);
  const table = [];
  for (let i = 0; i < MATRIX.length; i += 1) {
    const cell = MATRIX[i];
    const { app, win } = await launchWithSettings(`c4-${i}`, { animationsEnabled: cell.setting });
    try {
      if (cell.reduce) {
        const cdp = await win.context().newCDPSession(win);
        await cdp.send('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
        });
      }
      const rm = await win.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
      await openReport(app, win);
      await installProbe(win);
      const r = summarise(await probe(win, '.titlebar-menu-popover', 430, async () => {
        await win.click('[data-menu-button]');
      }));
      const row = { ...cell, osReduce: rm, frames: r.frames, intermediates: r.intermediates, distinctRects: r.distinctRects };
      table.push(row);
      log('C4-cell', row);
      expect(rm, `${cell.label}: OS preference state`).toBe(cell.reduce);
      if (cell.expectAnimated) {
        expect(r.intermediates > 0 || r.distinctRects > 2, `${cell.label}: animated (travel/scale frames)`).toBe(true);
      } else {
        expect(r.intermediates, `${cell.label}: instant (no intermediate frame)`).toBe(0);
      }
    } finally {
      await hardClose(app, `p23-c4-${i}`);
    }
  }
  fs.writeFileSync(path.join(SHOTS, 'phase23-qa-matrix.json'), JSON.stringify(table, null, 2));
});

// ===========================================================================
// C2 — restart persistence + malformed stored value falls back to the
// documented default (animations ON) without corrupting other settings.
// ===========================================================================
test('C2 persists across restart; malformed value falls back to default', async () => {
  test.setTimeout(300000);
  const ud = seedDir('c2', null);

  // 1. fresh boot (default ON) -> turn animations OFF through Preferences.
  let app = await launchApp([], ud);
  let win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.click('[data-open-preferences]');
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 5000 });
  const box = win.locator('[data-prefs-animations]');
  expect(await box.isChecked(), 'fresh profile: animations ON').toBe(true);
  await box.click();
  await expect.poll(() => win.evaluate(() => document.documentElement.dataset.animations), { timeout: 5000 }).toBe('off');
  await expect.poll(() => box.isChecked(), { timeout: 5000 }).toBe(false);
  await win.click('[data-prefs-dialog] .sheet-close');
  await win.waitForSelector('[data-prefs-dialog]', { state: 'hidden' });
  await expect.poll(() => {
    try { return JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).animationsEnabled; }
    catch { return null; }
  }, { timeout: 8000 }).toBe(false);
  await hardClose(app, 'p23-c2-first');

  // 2. relaunch the same profile -> persisted + boots instant.
  app = await launchApp([], ud);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const bootFlag = await win.evaluate(() => document.documentElement.dataset.animations);
  expect(bootFlag, 'relaunch: persisted setting -> data-animations=off').toBe('off');
  const stored = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
  expect(stored.animationsEnabled, 'settings.json preserves false').toBe(false);
  await hardClose(app, 'p23-c2-second');

  // 3. hand-edit a malformed value -> default ON, no crash, other fields intact.
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ ...stored, animationsEnabled: 'yes', theme: 'dark' }));
  app = await launchApp([], ud);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const malformedFlag = await win.evaluate(() => document.documentElement.dataset.animations);
  const malformedTheme = await win.evaluate(() => document.documentElement.dataset.theme);
  log('C2-malformed', { malformedFlag, malformedTheme });
  expect(malformedFlag, 'malformed value -> default ON').toBe('on');
  expect(malformedTheme, 'malformed value does not corrupt other settings (theme preserved)').toBe('dark');
  await win.screenshot({ path: path.join(SHOTS, 'phase23-qa-malformed.png') });
  await hardClose(app, 'p23-c2-third');
});

// ===========================================================================
// C3 — the Preferences control reflects the stored value, applies
// immediately, and carries the explanatory hint.
// ===========================================================================
test('C3 Preferences control reflects, applies immediately, carries the hint', async () => {
  test.setTimeout(220000);
  const { app, win } = await launchWithSettings('c3', { animationsEnabled: false, theme: 'dark' });
  try {
    await win.click('[data-open-preferences]');
    await win.waitForSelector('[data-prefs-dialog]', { timeout: 5000 });
    const box = win.locator('[data-prefs-animations]');
    expect(await box.isChecked(), 'reflects stored false on open').toBe(false);
    const text = await win.locator('[data-prefs-dialog]').textContent();
    expect(text, 'explanatory hint names what it disables').toContain('menus, panels and dialogs appear instantly');
    await win.screenshot({ path: path.join(SHOTS, 'phase23-prefs.png') });

    // toggle ON -> applies immediately.
    await box.click();
    await expect.poll(() => win.evaluate(() => document.documentElement.dataset.animations), { timeout: 5000 }).toBe('on');
    expect(await box.isChecked(), 'checkbox reflects the immediate ON change').toBe(true);

    // toggle back OFF -> applies immediately; close; the next interaction is instant.
    await box.click();
    await expect.poll(() => win.evaluate(() => document.documentElement.dataset.animations), { timeout: 5000 }).toBe('off');
    expect(await box.isChecked(), 'checkbox reflects the immediate OFF change').toBe(false);
    await win.click('[data-prefs-dialog] .sheet-close');
    await win.waitForSelector('[data-prefs-dialog]', { state: 'hidden' });

    await openReport(app, win);
    await installProbe(win);
    const menu = summarise(await probe(win, '.titlebar-menu-popover', 430, async () => {
      await win.click('[data-menu-button]');
    }));
    log('C3-next-interaction', menu);
    expect(menu.frames, 'next interaction: menu mounted').toBeGreaterThan(0);
    expect(menu.intermediates, 'next interaction after OFF is instant (no intermediate frame)').toBe(0);
    await win.screenshot({ path: path.join(SHOTS, 'phase23-qa-prefs-off.png') });
  } finally {
    await hardClose(app, 'p23-c3');
  }
});



