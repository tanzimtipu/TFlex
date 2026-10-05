// Phase 108 (Workspace Rail) — focused QA verification (TFL-890 / TFL-862 chunk C).
// Launches ONLY via the canonical launchApp helper. Read-only product checks;
// screenshots land under screenshots/. qa-owned.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shotPath = (name) => path.join(SHOTS, name);
const BOOT_T0 = Date.now();

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p108-siderail');
  app = null;
  win = null;
});

test.setTimeout(240000);

const setSize = async (w, h) => {
  // The window launches MAXIMIZED on this host, and setSize is ignored while
  // maximized, so unmaximize first, then size the normal bounds.
  await app.evaluate(({ BrowserWindow }) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw.isMaximized()) bw.unmaximize();
  });
  await win.waitForTimeout(350);
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]);
  }, [w, h]);
  await win.waitForFunction((s) => Math.abs(window.innerWidth - s) < 60, w, { timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(250);
};

const setTheme = (theme) =>
  win.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);

async function openDoc() {
  const tOpen = Date.now();
  await win.click('.sample-card');
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(700);
  console.log(`[p108] perf launch->interactive (spec start to workspace) ${Date.now() - BOOT_T0}ms; sample open ${Date.now() - tOpen}ms`);
}

async function railMetrics() {
  return win.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const rect = (el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height };
    };
    const cs = (el) => getComputedStyle(el);
    const rail = q('[data-stage-rail]');
    const btn = q('[data-stage-rail] [data-stage]');
    const gear = q('[data-stage-rail] [data-stage-rail-gear]');
    const navSvg = q('[data-stage-rail] [data-stage] svg');
    const gearSvg = gear ? gear.querySelector('svg') : null;
    return {
      visible: !!rail,
      rail: rail ? rect(rail) : null,
      railCssWidth: rail ? cs(rail).width : null,
      railBg: rail ? cs(rail).backgroundColor : null,
      railPadding: rail ? cs(rail).padding : null,
      compact: rail ? rail.getAttribute('data-stage-rail-compact') : null,
      activeStage: rail ? rail.getAttribute('data-active-stage') : null,
      stageCount: document.querySelectorAll('[data-stage-rail] [data-stage]').length,
      btnMinHeight: btn ? cs(btn).minHeight : null,
      btnRadius: btn ? cs(btn).borderTopLeftRadius : null,
      navSvg: navSvg ? rect(navSvg) : null,
      gearSvg: gearSvg ? rect(gearSvg) : null,
      gearMinHeight: gear ? cs(gear).minHeight : null,
    };
  });
}

async function rects() {
  return win.evaluate(() => {
    const g = (s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height };
    };
    return { rail: g('[data-stage-rail]'), panel: g('[data-context-panel]'), scroller: g('.document-scroller') };
  });
}

async function setPanelCollapsed(want) {
  const read = () =>
    win.evaluate(() => {
      const appEl = document.querySelector('.app-main');
      const el = document.querySelector('[data-context-panel]');
      const btn = document.querySelector('[data-rail-collapse]');
      return {
        collapsedAttr: el ? el.getAttribute('data-context-panel-collapsed') : null,
        railCollapsed: appEl ? appEl.getAttribute('data-rail-collapsed') : null,
        btn: !!btn,
        dir: btn ? btn.getAttribute('data-collapse-direction') : null,
      };
    });
  const before = await read();
  if ((before.collapsedAttr === 'true') === want) return { reached: true, state: before };
  await win.click('[data-rail-collapse]');
  await win.waitForTimeout(1400);
  const after = await read();
  return { reached: (after.collapsedAttr === 'true') === want, state: after };
}

async function labelContrast() {
  return win.evaluate(() => {
    const parse = (s) => {
      const m = s.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(',').map((x) => parseFloat(x.trim()));
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const over = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    });
    const lin = (c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
    const ratio = (a, b) => {
      const l1 = lum(a), l2 = lum(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const rail = document.querySelector('[data-stage-rail]');
    const surface = parse(getComputedStyle(rail).backgroundColor);
    const inactiveLabel = document.querySelector(
      '[data-stage-rail] [data-stage]:not([aria-pressed="true"]) .stage-rail-label',
    );
    const activeBtn = document.querySelector('[data-stage-rail] [data-stage][aria-pressed="true"]');
    const activeLabel = activeBtn ? activeBtn.querySelector('.stage-rail-label') : null;
    const inactive = parse(getComputedStyle(inactiveLabel).color);
    const selected = parse(getComputedStyle(activeLabel).color);
    const activeBgRaw = parse(getComputedStyle(activeBtn).backgroundColor);
    const activeBg = activeBgRaw.a < 1 ? over(activeBgRaw, surface) : activeBgRaw;
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      surface: getComputedStyle(rail).backgroundColor,
      inactiveColor: getComputedStyle(inactiveLabel).color,
      selectedColor: getComputedStyle(activeLabel).color,
      accentSoft: getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim(),
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      fgMuted: getComputedStyle(document.documentElement).getPropertyValue('--fg-muted').trim(),
      rawActiveBg: getComputedStyle(activeBtn).backgroundColor,
      activeBg: `rgb(${activeBg.r.toFixed(1)}, ${activeBg.g.toFixed(1)}, ${activeBg.b.toFixed(1)})`,
      inactiveRatioRaw: ratio(inactive, surface),
      selectedRatioRaw: ratio(selected, activeBg),
      inactiveRatio: Math.round(ratio(inactive, surface) * 100) / 100,
      selectedRatio: Math.round(ratio(selected, activeBg) * 100) / 100,
    };
  });
}

const BUDGET = {
  light: { selected: 4.73, inactive: 7.96 },
  dark: { selected: 6.59, inactive: 8.59 },
};

test('P108 rail: geometry, labels, marker, nav, layout, contrast, screenshots', async () => {
  await openDoc();
  await setSize(1440, 900);
  await win.waitForTimeout(400);

  // ---- (a) rail + four stage buttons, order, pressed, names ------------
  const rail = win.locator('[data-stage-rail]');
  await expect(rail).toBeVisible();
  const stages = await win.$$eval('[data-stage-rail] [data-stage]', (els) =>
    els.map((e) => e.getAttribute('data-stage')));
  expect(stages).toEqual(['pages', 'edit', 'review', 'deliver']);
  expect(await rail.getAttribute('aria-label')).toBe('Work stages');
  expect(await win.locator('[data-stage-rail] [data-stage][aria-pressed="true"]').count()).toBe(1);
  const names = await win.$$eval('[data-stage-rail] [data-stage]', (els) =>
    els.map((e) => (e.getAttribute('aria-label') || '').trim()));
  expect(names.every((n) => n.length > 0)).toBe(true);
  console.log(`[p108] (a) stages=${JSON.stringify(stages)} names=${JSON.stringify(names)}`);

  // ---- (b) computed geometry ------------------------------------------
  let m = await railMetrics();
  expect(Math.round(m.rail.width)).toBe(72);
  expect(m.railCssWidth).toBe('72px');
  expect(m.railPadding).toBe('12px 8px');
  expect(m.stageCount).toBe(4);
  expect(m.btnMinHeight).toBe('60px');
  expect(m.btnRadius).toBe('10px');
  expect(Math.round(m.navSvg.width)).toBe(22);
  expect(Math.round(m.navSvg.height)).toBe(22);
  expect(Math.round(m.gearSvg.width)).toBe(18);
  expect(Math.round(m.gearSvg.height)).toBe(18);
  expect(m.gearMinHeight).toBe('48px');
  console.log(`[p108] (b) ${JSON.stringify({ railW: m.rail.width, pad: m.railPadding, btnMin: m.btnMinHeight, radius: m.btnRadius, navSvg: m.navSvg.width, gearSvg: m.gearSvg.width, gearMin: m.gearMinHeight })}`);

  // ---- (c) labels visible at 1440 AND at 900 (compact) -----------------
  const labelInfo = await win.$$eval('[data-stage-rail] .stage-rail-label', (els) =>
    els.map((e) => ({ text: e.textContent.trim(), display: getComputedStyle(e).display, width: e.getBoundingClientRect().width })));
  expect(labelInfo.length).toBe(5);
  expect(labelInfo.every((l) => l.text.length > 0)).toBe(true);
  expect(labelInfo.every((l) => l.display !== 'none')).toBe(true);
  expect(labelInfo.every((l) => l.width > 0)).toBe(true);
  console.log(`[p108] (c-1440) ${JSON.stringify(labelInfo)}`);
  await setSize(900, 800);
  const inner900 = await win.evaluate(() => window.innerWidth);
  console.log('[p108] innerWidth after setSize(900,800)=' + inner900);
  await win.waitForFunction(() => document.querySelector('[data-stage-rail]').getAttribute('data-stage-rail-compact') === 'true', null, { timeout: 8000 });
  const labelInfo900 = await win.$$eval('[data-stage-rail] .stage-rail-label', (els) =>
    els.map((e) => ({ text: e.textContent.trim(), display: getComputedStyle(e).display, width: e.getBoundingClientRect().width })));
  expect(labelInfo900.length).toBe(5);
  expect(labelInfo900.every((l) => l.text.length > 0 && l.display !== 'none' && l.width > 0)).toBe(true);
  console.log(`[p108] (c-900 compact) ${JSON.stringify(labelInfo900)}`);

  // ---- (d) active leading marker 3x20 at left 2 / top 20 ---------------
  const marker = await win.evaluate(() => {
    const active = document.querySelector('[data-stage-rail] [data-stage][aria-pressed="true"]');
    const cs = getComputedStyle(active, '::before');
    return { content: cs.content, width: cs.width, height: cs.height, left: cs.left, top: cs.top, radius: cs.borderTopLeftRadius, bg: cs.backgroundColor };
  });
  expect(marker.content).not.toBe('none');
  expect(parseFloat(marker.width)).toBeCloseTo(3, 1);
  expect(parseFloat(marker.height)).toBeCloseTo(20, 1);
  expect(parseFloat(marker.left)).toBeCloseTo(2, 1);
  expect(parseFloat(marker.top)).toBeCloseTo(20, 1);
  expect(marker.radius).toBe('2px');
  console.log(`[p108] (d) marker ${JSON.stringify(marker)}`);

  // ---- (e) navigation: click, Ctrl+1..4, gear --------------------------
  await setSize(1440, 900);
  await win.waitForTimeout(300);
  for (const s of ['edit', 'review', 'deliver', 'pages']) {
    await win.click(`[data-stage="${s}"]`);
    await win.waitForFunction((v) => document.querySelector('[data-stage-rail]').getAttribute('data-active-stage') === v, s, { timeout: 5000 });
  }
  for (const [key, s] of [['Control+2', 'edit'], ['Control+3', 'review'], ['Control+4', 'deliver'], ['Control+1', 'pages']]) {
    await win.keyboard.press(key);
    await win.waitForFunction((v) => document.querySelector('[data-stage-rail]').getAttribute('data-active-stage') === v, s, { timeout: 5000 });
  }
  await win.click('[data-stage="review"]');
  const stageBeforeGear = await rail.getAttribute('data-active-stage');
  await win.click('[data-stage-rail-gear]');
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
  const stageAfterGear = await rail.getAttribute('data-active-stage');
  expect(stageAfterGear).toBe(stageBeforeGear);
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-prefs-dialog]', { state: 'detached', timeout: 10000 });
  const tSwitch = Date.now();
  await win.click('[data-stage="deliver"]');
  await win.waitForFunction(() => document.querySelector('[data-stage-rail]').getAttribute('data-active-stage') === 'deliver', null, { timeout: 5000 });
  const railSwitchMs = Date.now() - tSwitch;
  console.log(`[p108] (e) click+ctrl ok; gear preserved active=${stageAfterGear}; railSwitchMs=${railSwitchMs}`);

  // ---- (f) no overlap/clip at 1440/1100/900, expanded + collapsed ------
  const layoutLog = [];
  for (const w of [1440, 1100, 900]) {
    await setSize(w, 800);
    await win.waitForTimeout(450);
    for (const collapsed of [false, true]) {
      const res = await setPanelCollapsed(collapsed);
      const effectiveCollapsed = res.state.collapsedAttr === 'true';
      await win.waitForTimeout(300);
      const r = await rects();
      const abut = Math.abs(r.panel.left - r.rail.right);
      const overlapPanel = r.rail.right - r.panel.left;
      const overlapScroller = r.rail.right - r.scroller.left;
      layoutLog.push({ w, want: collapsed, reached: res.reached, effectiveCollapsed, railRight: +r.rail.right.toFixed(2), panelLeft: +r.panel.left.toFixed(2), scrollerLeft: +r.scroller.left.toFixed(2), abut: +abut.toFixed(2), overlapPanel: +overlapPanel.toFixed(2), overlapScroller: +overlapScroller.toFixed(2) });
      expect(Math.round(r.rail.width)).toBe(72);
      expect(abut, `w${w} collapsed=${collapsed} abut`).toBeLessThanOrEqual(1.5);
      expect(overlapPanel, `w${w} collapsed=${collapsed} rail/panel overlap`).toBeLessThanOrEqual(1);
      expect(overlapScroller, `w${w} collapsed=${collapsed} rail/scroller overlap`).toBeLessThanOrEqual(1);
    }
  }
  await setSize(1440, 800);
  await setPanelCollapsed(false);
  console.log('[p108] (f) ' + JSON.stringify(layoutLog));

  // ---- (g) 640x480: all destinations + Settings reachable --------------
  await setSize(640, 480);
  await win.waitForTimeout(600);
  const reach = [];
  for (const s of ['pages', 'edit', 'review', 'deliver']) {
    const loc = win.locator(`[data-stage-rail] [data-stage="${s}"]`);
    await loc.scrollIntoViewIfNeeded();
    await win.waitForTimeout(200);
    const clip = await win.evaluate((stage) => {
      const c = document.querySelector('.stage-rail-buttons');
      const b = document.querySelector(`[data-stage-rail] [data-stage="${stage}"]`);
      const cb = c.getBoundingClientRect(), bb = b.getBoundingClientRect();
      return {
        inList: bb.top >= cb.top - 1 && bb.bottom <= cb.bottom + 1,
        inWindow: bb.left >= -1 && bb.right <= window.innerWidth + 1 && bb.top >= -1 && bb.bottom <= window.innerHeight + 1,
        h: Math.round(bb.height),
      };
    }, s);
    expect(clip.inList, `stage ${s} clipped in list`).toBe(true);
    expect(clip.inWindow, `stage ${s} outside window`).toBe(true);
    await loc.click();
    await win.waitForFunction((v) => document.querySelector('[data-stage-rail]').getAttribute('data-active-stage') === v, s, { timeout: 5000 });
    reach.push({ s, ...clip });
  }
  const gear640 = win.locator('[data-stage-rail-gear]');
  await expect(gear640).toBeVisible();
  const gearBox = await gear640.boundingBox();
  expect(gearBox.y).toBeGreaterThanOrEqual(-1);
  expect(gearBox.y + gearBox.height).toBeLessThanOrEqual(481);
  await gear640.click();
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-prefs-dialog]', { state: 'detached', timeout: 10000 });
  console.log('[p108] (g) ' + JSON.stringify({ reach, gear: gearBox }));

  // ---- (h) screenshots + contrast --------------------------------------
  await setSize(640, 480);
  await setTheme('light');
  await win.mouse.move(1000, 300);
  await win.waitForTimeout(500);
  await win.screenshot({ path: shotPath('phase108-rail-short-light.png') });

  await setSize(1440, 900);
  await win.click('[data-stage="review"]');
  await win.mouse.move(1000, 300);
  await win.waitForTimeout(300);
  await setTheme('light');
  await win.mouse.move(1000, 300);
  await win.waitForTimeout(500);
  await win.screenshot({ path: shotPath('phase108-rail-light.png') });
  const light = await labelContrast();
  await setTheme('dark');
  await win.mouse.move(1000, 300);
  await win.waitForTimeout(500);
  await win.screenshot({ path: shotPath('phase108-rail-dark.png') });
  const dark = await labelContrast();

  await setSize(900, 800);
  await setTheme('light');
  await win.waitForFunction(() => document.querySelector('[data-stage-rail]').getAttribute('data-stage-rail-compact') === 'true', null, { timeout: 8000 });
  await win.mouse.move(700, 300);
  await win.waitForTimeout(400);
  await win.screenshot({ path: shotPath('phase108-rail-narrow-light.png') });
  await setTheme('dark');
  await win.mouse.move(700, 300);
  await win.waitForTimeout(400);
  await win.screenshot({ path: shotPath('phase108-rail-dark-narrow.png') });
  console.log('[p108] (h) 5 screenshots written under screenshots/');
  console.log('[p108] contrast light=' + JSON.stringify(light));
  console.log('[p108] contrast dark=' + JSON.stringify(dark));

  const contrastFailures = [];
  if (light.inactiveRatio < BUDGET.light.inactive) contrastFailures.push(`light inactive ${light.inactiveRatio} < ${BUDGET.light.inactive}`);
  if (light.selectedRatio < BUDGET.light.selected) contrastFailures.push(`light selected ${light.selectedRatio} < ${BUDGET.light.selected}`);
  if (dark.inactiveRatio < BUDGET.dark.inactive) contrastFailures.push(`dark inactive ${dark.inactiveRatio} < ${BUDGET.dark.inactive}`);
  if (dark.selectedRatio < BUDGET.dark.selected) contrastFailures.push(`dark selected ${dark.selectedRatio} < ${BUDGET.dark.selected}`);
  expect(contrastFailures, contrastFailures.join('; ')).toEqual([]);
});

// ---------------------------------------------------------------------------
// DEF-584 (ADV-218) - the ACTIVE rail item keeps its committed selected fill
// while hovered. The generic `.btn-toggle:hover:not([disabled]):not([aria-disabled=`
// "true"])` (0,4,0) used to out-specify the rail active-fill selector and repaint
// the active item with the neutral `--bg-hover` wash. Rendered on the RUNNING app.
// ---------------------------------------------------------------------------
test('P108 rail DEF-584: active fill survives hover in both themes', async () => {
  await openDoc();
  await setSize(1440, 900);
  await win.waitForTimeout(400);
  await win.click('[data-stage="review"]');
  await win.waitForFunction(
    () => document.querySelector('[data-stage-rail]').getAttribute('data-active-stage') === 'review',
    null,
    { timeout: 5000 },
  );

  const activeSel = '[data-stage-rail] [data-stage][aria-pressed="true"]';
  const readBg = () =>
    win.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).backgroundColor : null;
    }, activeSel);

  const cases = [
    { theme: 'light', rest: 'rgb(240, 235, 252)' },
    { theme: 'dark', rest: 'rgb(48, 39, 64)' },
  ];
  for (const c of cases) {
    await setTheme(c.theme);
    await win.mouse.move(1000, 300);
    await win.waitForTimeout(400);
    const restBg = await readBg();
    await win.locator(activeSel).hover();
    await win.waitForTimeout(400);
    const hoverBg = await readBg();
    console.log(`[p108] DEF-584 ${c.theme} activeBg rest=${restBg} hover=${hoverBg}`);
    expect(restBg, `${c.theme}: resting active fill is the rail selected surface`).toBe(c.rest);
    expect(hoverBg, `${c.theme}: active fill must stay selected while hovered`).toBe(restBg);
    expect(hoverBg, `${c.theme}: active fill is not the neutral hover wash`).not.toBe('rgba(15, 23, 42, 0.04)');
  }

  await setTheme('light');
  await win.mouse.move(1000, 300);
  await win.waitForTimeout(300);
});

// ---------------------------------------------------------------------------
// DEF-585 (ADV-219) - forced-colors preserves a non-colour-only active cue. The
// soft fill is forced away and the marker is forced to the Canvas colour, so the
// fix adds a rail-scoped system-colour outline on the active item and
// `forced-color-adjust: none` on the marker. Also asserts the block is
// rail-scoped: a non-rail `.btn-toggle` gains no such outline.
// ---------------------------------------------------------------------------
test('P108 rail DEF-585: forced-colors keeps a non-collapsed active cue', async () => {
  await openDoc();
  await setSize(1440, 900);
  await win.waitForTimeout(400);
  await win.click('[data-stage="review"]');
  await win.waitForFunction(
    () => document.querySelector('[data-stage-rail]').getAttribute('data-active-stage') === 'review',
    null,
    { timeout: 5000 },
  );

  const sample = () =>
    win.evaluate(() => {
      const active = document.querySelector('[data-stage-rail] [data-stage][aria-pressed="true"]');
      const nonRail = Array.from(document.querySelectorAll('.btn-toggle')).find(
        (el) => !el.closest('[data-stage-rail]'),
      );
      const marker = active ? getComputedStyle(active, '::before') : null;
      const cs = active ? getComputedStyle(active) : null;
      const nonRailCs = nonRail ? getComputedStyle(nonRail) : null;
      return {
        aria: active ? active.getAttribute('aria-pressed') : null,
        activeBg: cs ? cs.backgroundColor : null,
        outlineStyle: cs ? cs.outlineStyle : null,
        outlineWidth: cs ? cs.outlineWidth : null,
        outlineColor: cs ? cs.outlineColor : null,
        markerContent: marker ? marker.content : null,
        markerWidth: marker ? marker.width : null,
        markerBg: marker ? marker.backgroundColor : null,
        nonRailOutlineWidth: nonRailCs ? nonRailCs.outlineWidth : null,
        nonRailOutlineStyle: nonRailCs ? nonRailCs.outlineStyle : null,
      };
    });

  await win.emulateMedia({ forcedColors: 'none' });
  const normal = await sample();
  await win.emulateMedia({ forcedColors: 'active' });
  await win.waitForTimeout(500);
  const forced = await sample();
  await win.screenshot({ path: shotPath('phase108-rail-forced-colors.png') });
  console.log(`[p108] DEF-585 normal=${JSON.stringify(normal)}`);
  console.log(`[p108] DEF-585 forced=${JSON.stringify(forced)}`);

  expect(forced.aria, 'aria-pressed survives forced-colors').toBe('true');
  // Decisive cue: the active item carries a real 2px system-colour outline.
  expect(forced.outlineStyle, 'active item has a solid outline in forced-colors').toBe('solid');
  expect(parseFloat(forced.outlineWidth), 'active outline is 2px').toBeCloseTo(2, 1);
  // The marker geometry survives and is not forced to the Canvas colour.
  expect(parseFloat(forced.markerWidth), 'active marker keeps its width in forced-colors').toBeGreaterThan(0);
  const markerIsCanvasWhite = forced.markerBg === 'rgb(255, 255, 255)';
  expect(markerIsCanvasWhite, `marker not forced to the Canvas colour (got ${forced.markerBg})`).toBe(false);
  // Rail-scoping: a non-rail toggle gains no such outline in forced-colors.
  expect(forced.nonRailOutlineStyle === 'solid' && parseFloat(forced.nonRailOutlineWidth) >= 1,
    `non-rail .btn-toggle must not get the rail forced-colors outline (width=${forced.nonRailOutlineWidth})`).toBe(false);

  await win.emulateMedia({ forcedColors: null });
});
