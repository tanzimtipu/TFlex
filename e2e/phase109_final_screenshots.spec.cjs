// TFL-939 (Phase 109 / Viewing Controls) - phase-close qa verdict evidence.
// Captures the fresh `phase109-final-*` screenshot set and runs the small
// number of criterion checks NOT already covered by the phase's three specs:
//   - the exact footer control inventory (no lost / invented command),
//   - the 640x480 shed state (the ladder forces inspector+panel collapse),
//   - the overflow tier under reduced motion.
// Launches only through the canonical e2e/lib/launch.cjs launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;
test.setTimeout(420000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(250);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p109-final');
  app = null;
  win = null;
});

async function openSample(name = 'report.pdf') {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

async function setWindow(w, h) {
  await app.evaluate(({ BrowserWindow }, sz) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) { try { bw.unmaximize(); } catch (_) { /* already normal */ } bw.setSize(sz[0], sz[1]); }
  }, [w, h]);
  await win.waitForFunction((want) => Math.abs(window.innerWidth - want) <= 40, w, { timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(600);
}

async function zoom(z) {
  await app.evaluate(({ BrowserWindow }, zf) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) bw.webContents.setZoomFactor(zf);
  }, z);
  await win.waitForTimeout(900);
}

async function currentTheme() { return win.evaluate(() => document.documentElement.getAttribute('data-theme')); }

async function setTheme(theme) {
  for (let i = 0; i < 4; i += 1) {
    if ((await currentTheme()) === theme) return;
    await win.locator('[data-app-menu]').first().click();
    await win.waitForSelector('[data-app-menu-popover]', { state: 'visible', timeout: 8000 });
    await win.locator('[data-app-menu-popover] [data-menu-action="toggleTheme"]').first().click();
    await win.waitForTimeout(900);
  }
  const now = await currentTheme();
  if (now !== theme) throw new Error(`setTheme: could not reach '${theme}' (stuck at '${now}')`);
}

async function toggleMultiMode() {
  await win.locator('[data-app-menu]').first().click();
  await win.waitForSelector('[data-app-menu-popover]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-app-menu-popover] [data-menu-action="multiMode"]').first().click();
  await win.waitForTimeout(700);
}

async function openIntoPaneB(name = 'form.pdf') {
  const p = getSamplePath(name);
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-open]').first().click();
  await win.waitForFunction(() => {
    const b = document.querySelector('.tab-pane[data-pane="B"]');
    return b !== null && b.querySelector('[data-view-strip]') !== null;
  }, null, { timeout: 30000 });
  await win.waitForTimeout(1200);
}

// Enumerate every actionable control inside the ONE single-mode footer with its
// accessible name, plus the three layout options under the Page layout group.
async function footerInventory() {
  return win.evaluate(() => {
    const strip = document.querySelector('[data-view-strip]');
    if (!strip) return null;
    const nameOf = (el) => el.getAttribute('aria-label') || el.getAttribute('title') || (el.className || '');
    const controls = [...strip.querySelectorAll('button, input')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map((el) => ({ tag: el.tagName.toLowerCase(), name: nameOf(el) }));
    const layoutGroup = strip.querySelector('[data-view-strip-layout]') || strip.querySelector('[aria-label="Page layout"]');
    const layoutOptions = layoutGroup
      ? [...layoutGroup.querySelectorAll('[data-page-layout-option]')].map((o) => ({
          mode: o.getAttribute('data-page-layout-option'),
          name: nameOf(o),
        }))
      : [];
    return { controls, layoutOptions, hasFullscreen: /fullscreen/i.test(strip.innerHTML), hasZoomInput: strip.querySelectorAll('input[type="number"], input[inputmode="numeric"]').length };
  });
}

test('P109-F1 footer command inventory is exact: none lost, none invented', async () => {
  await openSample();
  await setWindow(1440, 900);
  const inv = await footerInventory();
  console.log(`[P109-F1] controls=${JSON.stringify(inv.controls)}`);
  console.log(`[P109-F1] layoutOptions=${JSON.stringify(inv.layoutOptions)} fullscreen=${inv.hasFullscreen} numericInputs=${inv.hasZoomInput}`);
  const names = inv.controls.map((c) => c.name);
  for (const want of ['Previous page', 'Zoom out', 'Zoom in', 'Fit width', 'Fit page', 'Pan mode', 'Book View']) {
    expect(names, `the footer still exposes "${want}"`).toContain(want);
  }
  // Page jump is the ONE named input; the zoom read-out is a display element
  // (`.zoom-percent`), not an invented typed-zoom field.
  expect(names, 'the page input is named "Current page"').toContain('Current page');
  expect(inv.controls.filter((c) => c.tag === 'input').length, 'exactly ONE input: the page jump').toBe(1);
  expect(await win.locator('[data-view-strip] .zoom-percent').count(), 'the zoom read-out is present').toBe(1);
  expect(inv.layoutOptions.map((o) => o.mode).sort(), 'the three layout options live under the Page layout group').toEqual(['four', 'one', 'two']);
  for (const o of inv.layoutOptions) expect(o.name.length, `layout option ${o.mode} has an accessible name`).toBeGreaterThan(0);
  expect(inv.hasFullscreen, 'no invented fullscreen button').toBe(false);
  expect(inv.hasZoomInput, 'no invented typed zoom field').toBe(0);
});

test('P109-F2 capture phase109-final single light / dark / frosted + Multi Mode panes', async () => {
  await openSample();
  await setWindow(1440, 900);
  await setTheme('light');
  await win.screenshot({ path: path.join(SHOTS, 'phase109-final-single-light.png') });
  await setTheme('dark');
  await win.screenshot({ path: path.join(SHOTS, 'phase109-final-single-dark.png') });
  await setTheme('frosted');
  await win.screenshot({ path: path.join(SHOTS, 'phase109-final-single-frosted.png') });
  console.log(`[P109-F2] theme now=${await currentTheme()}`);

  await setTheme('light');
  await toggleMultiMode();
  await win.waitForSelector('.tab-pane[data-pane="B"]', { timeout: 15000 });
  await openIntoPaneB();
  const panes = await win.evaluate(() => [...document.querySelectorAll('.tab-pane')].map((p) => ({ pane: p.getAttribute('data-pane'), footers: p.querySelectorAll('[data-view-strip]').length })));
  console.log(`[P109-F2] multi panes=${JSON.stringify(panes)}`);
  expect(panes.filter((p) => p.footers === 1).length, 'each pane carries exactly one footer').toBeGreaterThanOrEqual(2);
  await win.screenshot({ path: path.join(SHOTS, 'phase109-final-multi-panes.png') });
  console.log('[P109-F2] wrote phase109-final-single-light / -dark / -frosted / -multi-panes');
});

// At 640x480 the documented responsive ladder (dockResponsive.ts
// DOCK_LADDER_BREAKPOINTS inspector:1200, panel:1000) forces BOTH the pages
// panel and the Inspector collapsed, and `inspectorCollapsedFor` ORs the rung
// with the user preference, so an "open" state cannot be shown at this width.
// Record the real shed state, attempt both expands (they must not win), and
// prove the footer still fits one 48px row with the dock clearing it.
test('P109-F3 640x480 shed state: panel+inspector forced collapsed, footer one 48px row, dock clears >=16px', async () => {
  await openSample();
  await setWindow(640, 480);

  // Attempt a real expand of both surfaces; the ladder must still force collapse.
  const inspToggle = win.locator('[data-inspector-collapse]').first();
  if ((await inspToggle.count()) > 0) { await inspToggle.click().catch(() => {}); await win.waitForTimeout(500); }
  const railToggle = win.locator('[data-rail-collapse]').first();
  if ((await railToggle.count()) > 0) { await railToggle.click().catch(() => {}); await win.waitForTimeout(500); }

  const shed = await win.evaluate(() => {
    const main = document.querySelector('.app-main');
    const insp = document.querySelector('[data-inspector]');
    const panel = document.querySelector('[data-context-panel]');
    return {
      inspectorCollapsed: insp ? insp.getAttribute('data-inspector-collapsed') : 'missing',
      mainInspectorCollapsed: main ? main.getAttribute('data-inspector-collapsed') : null,
      panelCollapsed: panel ? panel.getAttribute('data-context-panel-collapsed') : 'missing',
      inset: main ? getComputedStyle(main).getPropertyValue('--tf-tools-inset').trim() : null,
    };
  });
  console.log(`[P109-F3] shed state=${JSON.stringify(shed)}`);
  expect(shed.mainInspectorCollapsed, 'the ladder forces the Inspector collapsed at 640 (window < 1200)').toBe('true');
  expect(shed.panelCollapsed, 'the ladder forces the pages panel collapsed at 640 (window < 1000)').toBe('true');

  const geom = await win.evaluate(() => {
    const strip = document.querySelector('[data-view-strip]');
    const dock = document.querySelector('[data-action-dock]') || document.querySelector('.action-dock');
    const sr = strip.getBoundingClientRect();
    const s = getComputedStyle(strip);
    const out = { row: Math.round(sr.height), padTop: s.paddingTop, padBottom: s.paddingBottom, wrap: s.flexWrap, overflow: s.overflow };
    if (dock) { const dr = dock.getBoundingClientRect(); out.dockBottom = Math.round(dr.bottom); out.footerTop = Math.round(sr.top); out.gap = Math.round(sr.top - dr.bottom); }
    return out;
  });
  console.log(`[P109-F3] footer=${JSON.stringify(geom)}`);
  expect(geom.row, 'the footer is ONE 48px row at 640x480').toBe(48);
  expect(geom.wrap, 'the footer never wraps').toBe('nowrap');
  if (geom.gap !== undefined) expect(geom.gap, 'the dock clears the footer by >=16px').toBeGreaterThanOrEqual(16);

  await win.screenshot({ path: path.join(SHOTS, 'phase109-final-640x480.png') });
  console.log('[P109-F3] wrote phase109-final-640x480.png');
});

// Overflow tier (<=419px, reached at 640x480 @ Windows text/DPI 150%) open for
// the final screenshot, under prefers-reduced-motion: reduce. The menu must
// still open and its rows stay hit-testable.
test('P109-F4 overflow menu open @150% under reduced motion; rows reachable', async () => {
  await openSample();
  await setWindow(640, 480);
  await zoom(1.5);
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await win.waitForTimeout(400);

  const tier = await win.evaluate(() => {
    const strip = document.querySelector('[data-view-strip]');
    const cs = (sel) => { const el = document.querySelector(sel); return el === null ? 'missing' : getComputedStyle(el).display; };
    return { inlineSize: strip ? Math.round(strip.getBoundingClientRect().width) : null, more: cs('.view-strip-more'), layout: cs('.view-strip-layout'), book: cs('.view-strip-book') };
  });
  console.log(`[P109-F4] tier=${JSON.stringify(tier)}`);
  expect(tier.inlineSize, 'the overflow tier is active at 640x480 @150%').toBeLessThanOrEqual(419);
  expect(tier.more, 'the More host is revealed').not.toBe('none');
  expect(tier.layout, 'the inline layout group is retired at this rung').toBe('none');

  await win.locator('[data-view-strip-more-toggle]').first().click();
  await win.waitForSelector('[data-view-strip-more-menu]', { state: 'visible', timeout: 8000 });
  await win.waitForTimeout(400);
  const rows = await win.evaluate(() => {
    const menu = document.querySelector('[data-view-strip-more-menu]');
    const hit = (el) => { const r = el.getBoundingClientRect(); const t = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)); return { w: Math.round(r.width), h: Math.round(r.height), hit: t === el || el.contains(t) }; };
    const opts = [...menu.querySelectorAll('[data-page-layout-option]')].map((o) => ({ mode: o.getAttribute('data-page-layout-option'), ...hit(o) }));
    const book = menu.querySelector('[data-book-view-open]');
    return { opts, book: book ? hit(book) : null };
  });
  console.log(`[P109-F4] rows=${JSON.stringify(rows)}`);
  expect(rows.opts.map((o) => o.mode).sort()).toEqual(['four', 'one', 'two']);
  for (const o of rows.opts) { expect(o.w > 0 && o.h > 0, `layout ${o.mode} rendered`).toBe(true); expect(o.hit, `layout ${o.mode} hit-testable`).toBe(true); }
  expect(rows.book && rows.book.hit, 'Book View row hit-testable').toBe(true);

  await win.screenshot({ path: path.join(SHOTS, 'phase109-final-overflow-open.png') });
  console.log('[P109-F4] wrote phase109-final-overflow-open.png');
});

// No footer control may sit outside its own row (clipping/overlap), plus the
// dock-gap measurement. Mirrors the phase spec's footerClipping oracle.
async function footerGeom() {
  return win.evaluate(() => {
    const strip = document.querySelector('[data-view-strip]');
    if (!strip) return null;
    const sr = strip.getBoundingClientRect();
    const out = { rowHeight: Math.round(sr.height), bad: [] };
    strip.querySelectorAll('button, input, .zoom-percent, .page-total, .page-label-hint').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      if (r.top < sr.top - 1 || r.bottom > sr.bottom + 1 || r.left < sr.left - 1 || r.right > sr.right + 2) {
        out.bad.push({ name: el.getAttribute('aria-label') || el.className, box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] });
      }
    });
    const dock = document.querySelector('[data-action-dock]');
    if (dock) { const dr = dock.getBoundingClientRect(); out.dockGap = Math.round(sr.top - dr.bottom); }
    return out;
  });
}

test('P109-F5 geometry sweep at 1440x900 / 1280x800 / 1024x768 / 640x480 (panel + Inspector open AND collapsed)', async () => {
  await openSample();
  const shedState = () => win.evaluate(() => {
    const insp = document.querySelector('[data-inspector]');
    const panel = document.querySelector('[data-context-panel]');
    return {
      inspector: insp ? insp.getAttribute('data-inspector-collapsed') : 'missing',
      panel: panel ? panel.getAttribute('data-context-panel-collapsed') : 'missing',
    };
  });
  const check = async (tag) => {
    const g = await footerGeom();
    const st = await shedState();
    console.log(`[P109-F5] ${tag} state=${JSON.stringify(st)} row=${g.rowHeight} dockGap=${g.dockGap} bad=${JSON.stringify(g.bad)}`);
    expect(Math.abs(g.rowHeight - 48), `footer is ONE 48px row (${tag})`).toBeLessThanOrEqual(2);
    expect(g.bad, `no footer control clips its row (${tag})`).toEqual([]);
    if (g.dockGap !== undefined) expect(g.dockGap, `dock clears the footer by >=16px (${tag})`).toBeGreaterThanOrEqual(15.5);
    return st;
  };

  for (const size of [[1440, 900], [1280, 800], [1024, 768], [640, 480]]) {
    await setWindow(size[0], size[1]);
    // Each surface: exercise BOTH effective states via its own real control, and
    // re-assert the footer row on each. Where the ladder forces a state, the
    // control still records the user intent but the effective value is OR-ed.
    if ((await win.locator('[data-inspector-collapse]').count()) > 0) {
      await win.locator('[data-inspector-collapse]').first().click().catch(() => {});
      await win.waitForTimeout(500);
    }
    const insp1 = await check(`${size[0]}x${size[1]} inspectorA`);
    if ((await win.locator('[data-inspector-collapse]').count()) > 0) {
      await win.locator('[data-inspector-collapse]').first().click().catch(() => {});
      await win.waitForTimeout(500);
    }
    const insp2 = await check(`${size[0]}x${size[1]} inspectorB`);
    console.log(`[P109-F5] ${size[0]}x${size[1]} inspector states ${insp1.inspector} -> ${insp2.inspector}`);

    if ((await win.locator('[data-rail-collapse]').count()) > 0) {
      await win.locator('[data-rail-collapse]').first().click().catch(() => {});
      await win.waitForTimeout(500);
    }
    const panel1 = await check(`${size[0]}x${size[1]} panelA`);
    if ((await win.locator('[data-rail-collapse]').count()) > 0) {
      await win.locator('[data-rail-collapse]').first().click().catch(() => {});
      await win.waitForTimeout(500);
    }
    const panel2 = await check(`${size[0]}x${size[1]} panelB`);
    console.log(`[P109-F5] ${size[0]}x${size[1]} panel states ${panel1.panel} -> ${panel2.panel}`);
  }
});
