// TFL-1179 (re-audit of AR-01..AR-09) — QA live reproduction, navigation group.
// Drives the REAL Electron app (via the canonical launchApp) against the
// bundled report.pdf sample (34 pages) at the sizes the AR findings name.
// qa-owned; read-only product checks. No product source is modified.
delete process.env.ELECTRON_RUN_AS_NODE;

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (n) => path.join(SHOTS, n);

let app = null;
let win = null;
test.setTimeout(300000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1179-nav');
  app = null;
  win = null;
});

async function setSize(w, h) {
  await app.evaluate(({ BrowserWindow }) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw.isMaximized()) bw.unmaximize();
  });
  await win.waitForTimeout(400);
  await app.evaluate(({ BrowserWindow }, s) => {
    BrowserWindow.getAllWindows()[0].setSize(s[0], s[1]);
  }, [w, h]);
  await win
    .waitForFunction((s) => Math.abs(window.innerWidth - s) < 60, w, { timeout: 8000 })
    .catch(() => {});
  await win.waitForTimeout(600);
}

async function maximize() {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].maximize();
  });
  await win.waitForTimeout(900);
}

async function openReport() {
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1400);
}

const pageInput = () => win.locator('input.page-input[aria-label="Current page"]').first();

async function pageVisible(p) {
  return win.evaluate((n) => {
    const scroller = document.querySelector('.document-scroller');
    const slot = document.querySelector(`.page-slot[data-page="${n}"]`);
    if (scroller === null || slot === null) return { found: false };
    const v = scroller.getBoundingClientRect();
    const r = slot.getBoundingClientRect();
    return {
      found: true,
      intersects: r.bottom > v.top + 2 && r.top < v.bottom - 2,
      slotTop: Math.round(r.top),
      slotBottom: Math.round(r.bottom),
      viewTop: Math.round(v.top),
      viewBottom: Math.round(v.bottom),
    };
  }, p);
}

// AR-01 marker locator. The current-page marker lives on the full-width thumb
// card (`.thumb-item[data-page] [data-thumb-current-marker]`) at wide widths,
// and on the compact Navigator's ruler item
// (`[data-ruler-page="N"][data-thumb-current-marker]`) below the 1000px panel
// rung (TFL-1184 chunk D attached the attribute to the ruler item). Resolve
// whichever surface is mounted and report which one answered.
async function markerState(p) {
  return win.evaluate((n) => {
    const thumbMarker = document.querySelector(`.thumb-item[data-page="${n}"] [data-thumb-current-marker]`);
    const rulerMarker = document.querySelector(`[data-ruler-page="${n}"][data-thumb-current-marker]`);
    const marker = thumbMarker || rulerMarker;
    if (marker === null) return { found: false, surface: null, inside: null };
    const surface = thumbMarker !== null ? 'thumb' : 'ruler';
    const vp = surface === 'thumb'
      ? document.querySelector('.thumb-scroller-inner')
      : document.querySelector('[data-rail-ruler]');
    if (vp === null) return { found: true, surface, inside: null };
    const m = marker.getBoundingClientRect();
    const v = vp.getBoundingClientRect();
    return { found: true, surface, inside: m.top >= v.top - 1 && m.bottom <= v.bottom + 1 };
  }, p);
}

async function fitGeometry(p) {
  return win.evaluate((n) => {
    const scroller = document.querySelector('.document-scroller');
    const slot = document.querySelector(`.page-slot[data-page="${n}"]`);
    if (scroller === null || slot === null) return null;
    const v = scroller.getBoundingClientRect();
    const r = slot.getBoundingClientRect();
    return {
      leftGap: Math.round(r.left - v.left),
      rightGap: Math.round(v.right - r.right),
      pageW: Math.round(r.width),
      viewW: Math.round(v.width),
      fitsWidth: r.width <= v.width + 2,
    };
  }, p);
}

// Navigate to page 10. Prefer the Outline (Chapter 5 / page 10) exactly as the
// AR-01 repro names; fall back to the ViewStrip page input when the outline
// does not expose that target. Every path is logged so the report is honest.
async function goToPage10() {
  const outlineTab = win.locator('[data-context-panel-view-tab="outline"]');
  if ((await outlineTab.count()) > 0) {
    await outlineTab.first().click();
    await win.waitForTimeout(500);
  }
  await win.waitForSelector('[data-outline-row]', { timeout: 8000 }).catch(() => {});
  const rows = win.locator('[data-outline-row]');
  const n = await rows.count();
  const info = [];
  for (let i = 0; i < n; i += 1) {
    const link = rows.nth(i).locator('.outline-link');
    const title = (await link.count()) > 0 ? await link.getAttribute('title') : null;
    const pageEl = rows.nth(i).locator('.outline-page');
    const page = (await pageEl.count()) > 0 ? (await pageEl.textContent()) : null;
    info.push({ i, title, page: page === null ? null : page.trim() });
  }
  console.log(`[tfl1179] outline rows=${JSON.stringify(info.slice(0, 40))}`);
  let target = info.find((r) => r.page === '10');
  let via = target ? `outline page==10 row ${target.i}` : null;
  if (target === undefined) {
    target = info.find((r) => r.title !== null && /chapter\s*5/i.test(r.title));
    if (target !== undefined) via = `outline Chapter 5 row ${target.i}`;
  }
  if (target !== undefined) {
    await rows.nth(target.i).locator('.outline-link').click();
    await win.waitForTimeout(1600);
  }
  let val = await pageInput().inputValue().catch(() => null);
  if (val !== '10') {
    via = `${via === null ? 'none' : via} -> input fallback`;
    const input = pageInput();
    await input.click();
    await input.fill('');
    await input.fill('10');
    await input.press('Enter');
    await win.waitForTimeout(1600);
    val = await pageInput().inputValue().catch(() => null);
  }
  console.log(`[tfl1179] reached page via=${via} footer=${val}`);
  return { via, footer: val };
}

test('AR-01 + AR-04: reading location holds across maximize/restore and Fit Page recenters page 10', async () => {
  await maximize();
  await openReport();

  // AR-01 wide contract: while maximized the Pages view mounts the full-width
  // Navigator thumb rail; the current page's thumb card carries
  // `.thumb-item [data-thumb-current-marker]` (SideRail). Read this BEFORE the
  // outline jump below unmounts the Pages view.
  const wideMarker = await win.evaluate(() => {
    const current = document.querySelector('input.page-input[aria-label="Current page"]');
    const items = Array.from(document.querySelectorAll('.thumb-item'));
    const markedPages = items
      .filter((it) => it.querySelector('[data-thumb-current-marker]') !== null)
      .map((it) => it.getAttribute('data-page'));
    const cur = current === null ? null : current.value;
    const targetEl = cur === null ? null : document.querySelector(`.thumb-item[data-page="${cur}"] [data-thumb-current-marker]`);
    return { thumbItems: items.length, markedPages, current: cur, targetExists: targetEl !== null, railCollapsed: document.querySelector('.app-main')?.getAttribute('data-rail-collapsed') };
  });
  console.log(`[tfl1179] AR-01 wide marker=${JSON.stringify(wideMarker)}`);
  expect.soft(wideMarker.thumbItems, 'AR-01 the full-width Navigator renders thumb cards').toBeGreaterThan(0);
  expect.soft(wideMarker.targetExists, `AR-01 the full-width thumb card for the current page (${wideMarker.current}) carries the current marker`).toBe(true);

  const nav = await goToPage10();
  expect(nav.footer, 'reading location reached page 10').toBe('10');
  await win.waitForTimeout(1200);

  // Restore to the AR size and let the view settle (never judge an animation frame).
  await setSize(981, 641);
  await win.waitForTimeout(1800);

  const footer = await pageInput().inputValue();
  const total = await win.locator('.page-total').first().textContent();
  const vis = await pageVisible(10);
  const marker = await markerState(10);
  // AR-01 compact contract: below the 1000px panel rung the compact Navigator is
  // the ruler strip; the current ruler item carries the marker and must agree
  // with the footer/nav indicator.
  const rulerMark = await win.evaluate((n) => {
    const el = document.querySelector(`[data-ruler-page="${n}"][data-thumb-current-marker]`);
    const marked = Array.from(document.querySelectorAll('[data-rail-ruler] [data-thumb-current-marker]'))
      .map((e) => e.getAttribute('data-ruler-page'));
    const input = document.querySelector('input.page-input[aria-label="Current page"]');
    return { exists: el !== null, markedPages: marked, footer: input === null ? null : input.value, text: el === null ? null : (el.textContent || '').trim() };
  }, 10);
  console.log(`[tfl1179] AR-01 restored footer=${footer} total=${total} page10=${JSON.stringify(vis)} marker=${JSON.stringify(marker)} ruler=${JSON.stringify(rulerMark)}`);
  await win.screenshot({ path: shot('tfl1179_ar01_restored_981.png') });

  expect.soft(footer, 'AR-01 footer/nav indicator still reads 10').toBe('10');
  expect.soft(total, 'AR-01 document reports 34 pages').toContain('34');
  expect.soft(vis.found, 'AR-01 page 10 slot exists').toBe(true);
  expect.soft(vis.intersects, 'AR-01 page 10 content stays visible after restore').toBe(true);
  expect.soft(marker.found, 'AR-01 the page-10 current marker is present on the mounted navigator surface').toBe(true);
  expect.soft(marker.surface, 'AR-01 the compact Navigator marker rides the ruler surface').toBe('ruler');
  if (marker.inside !== null) {
    expect.soft(marker.inside, 'AR-01 the page-10 marker stays inside the rail viewport').toBe(true);
  }
  expect.soft(rulerMark.exists, 'AR-01 the compact ruler item for page 10 carries [data-thumb-current-marker]').toBe(true);
  expect.soft(rulerMark.markedPages, 'AR-01 exactly page 10 is marked current on the ruler').toEqual(['10']);
  expect.soft(rulerMark.footer, 'AR-01 the footer/nav indicator and the marked ruler page agree').toBe('10');

  // AR-04: Fit Page must fit AND recenter the current page in the usable canvas.
  await win.locator('[data-view-strip] button[aria-label="Fit page"]').first().click();
  await win.waitForTimeout(1400);
  const fitPressed = await win
    .locator('[data-view-strip] button[aria-label="Fit page"]')
    .first()
    .getAttribute('aria-pressed');
  const fitFooter = await pageInput().inputValue();
  const geo = await fitGeometry(10);
  const fitVis = await pageVisible(10);
  console.log(`[tfl1179] AR-04 fitPressed=${fitPressed} footer=${fitFooter} geo=${JSON.stringify(geo)} vis=${JSON.stringify(fitVis)}`);
  await win.screenshot({ path: shot('tfl1179_ar04_fitpage_981.png') });

  expect.soft(fitPressed, 'AR-04 Fit page pill is active').toBe('true');
  expect.soft(geo, 'AR-04 page geometry measurable after Fit Page').not.toBeNull();
  expect.soft(fitFooter, 'AR-04 Fit Page keeps the reading page at 10').toBe('10');
  expect.soft(geo.fitsWidth, 'AR-04 page fits the canvas width').toBe(true);
  expect.soft(fitVis.intersects, 'AR-04 Fit Page shows page 10 in the canvas').toBe(true);
  expect.soft(Math.abs(geo.leftGap - geo.rightGap), 'AR-04 page recentered (gaps within scrollbar tolerance)').toBeLessThanOrEqual(14);
});

test('AR-02: compact Navigator exposes the Outline as an overlay drawer, Escape/close returns focus', async () => {
  await openReport();
  for (const size of [[981, 641], [960, 640]]) {
    await setSize(size[0], size[1]);
    await win.waitForTimeout(900);

    const readState = () => win.evaluate(() => {
      const p = document.querySelector('[data-context-panel]');
      const trigger = document.querySelector('[data-rail-collapse]');
      const a = document.activeElement;
      return {
        collapsed: p === null ? null : p.getAttribute('data-context-panel-collapsed'),
        drawer: p === null ? null : p.getAttribute('data-context-panel-drawer'),
        trigger: trigger === null
          ? null
          : { label: trigger.getAttribute('aria-label'), expanded: trigger.getAttribute('aria-expanded') },
        focus: a === null ? 'none' : `${a.tagName}${a.hasAttribute('data-rail-collapse') ? '[data-rail-collapse]' : ''}`,
      };
    });

    // Normalize to the collapsed ruler strip (compact surface, drawer closed).
    let state = await readState();
    if (state.drawer === 'true') {
      await win.keyboard.press('Escape');
      await win.waitForFunction(
        () => document.querySelector('[data-context-panel][data-context-panel-drawer="true"]') === null,
        null,
        { timeout: 6000 },
      );
      await win.waitForTimeout(300);
      state = await readState();
    }
    console.log(`[tfl1179] AR-02 ${size[0]}x${size[1]} collapsedState=${JSON.stringify(state)}`);

    const trigger = win.locator('[data-rail-collapse]');
    expect(await trigger.count(), `AR-02 ${size[0]}x${size[1]}: the Navigator collapse/expand trigger exists`).toBe(1);
    expect.soft(state.collapsed, `AR-02 ${size[0]}x${size[1]}: the panel is the collapsed ruler strip`).toBe('true');
    expect.soft(state.trigger.expanded, `AR-02 ${size[0]}x${size[1]}: collapsed trigger reports aria-expanded=false`).toBe('false');
    await win.screenshot({ path: shot(`tfl1185_ar02_collapsed_${size[0]}.png`) });

    await trigger.first().click();
    await win.waitForSelector('[data-context-panel][data-context-panel-drawer="true"]', { timeout: 8000 });
    await win.waitForTimeout(400);
    const openState = await readState();
    console.log(`[tfl1179] AR-02 ${size[0]}x${size[1]} openState=${JSON.stringify(openState)}`);
    expect.soft(openState.drawer, `AR-02 ${size[0]}x${size[1]}: the drawer is open`).toBe('true');
    expect.soft(openState.trigger.expanded, `AR-02 ${size[0]}x${size[1]}: open trigger reports aria-expanded=true`).toBe('true');

    // The drawer exposes the Pages/Outline switch and the Outline content.
    await expect(
      win.locator('[data-context-panel-view-tab="outline"]'),
      `AR-02 ${size[0]}x${size[1]}: Pages/Outline switch present`,
    ).toHaveCount(1);
    await win.locator('[data-context-panel-view-tab="outline"]').first().click();
    await win.waitForTimeout(400);
    await expect(
      win.locator('[data-context-panel-view="outline"]'),
      `AR-02 ${size[0]}x${size[1]}: Outline view renders in the drawer`,
    ).toHaveCount(1);
    const outlineRows = await win.locator('[data-outline-row]').count();
    const selected = await win.locator('[data-outline-row][data-outline-selected="true"]').count();
    console.log(`[tfl1179] AR-02 ${size[0]}x${size[1]} outlineRows=${outlineRows} selectedBookmark=${selected}`);
    await win.screenshot({ path: shot(`tfl1185_ar02_drawer_open_${size[0]}.png`) });

    // Escape closes the overlay drawer and returns focus to the trigger.
    await win.keyboard.press('Escape');
    await win.waitForFunction(
      () => document.querySelector('[data-context-panel][data-context-panel-drawer="true"]') === null,
      null,
      { timeout: 6000 },
    );
    await win.waitForTimeout(300);
    const afterEscape = await readState();
    console.log(`[tfl1179] AR-02 ${size[0]}x${size[1]} afterEscape=${JSON.stringify(afterEscape)}`);
    expect.soft(afterEscape.focus, `AR-02 ${size[0]}x${size[1]}: focus returns to the Navigator trigger after Escape`).toContain('data-rail-collapse');
    await win.screenshot({ path: shot(`tfl1185_ar02_after_escape_${size[0]}.png`) });

    // Re-open and close via the drawer's explicit close control; focus returns too.
    await win.locator('[data-rail-collapse]').first().click();
    await win.waitForSelector('[data-context-panel][data-context-panel-drawer="true"]', { timeout: 8000 });
    await win.waitForTimeout(400);
    const closeBtn = win.locator('[data-context-panel-close]');
    expect.soft(await closeBtn.count(), `AR-02 ${size[0]}x${size[1]}: the drawer exposes an explicit close control`).toBe(1);
    await closeBtn.first().click();
    await win.waitForFunction(
      () => document.querySelector('[data-context-panel][data-context-panel-drawer="true"]') === null,
      null,
      { timeout: 6000 },
    );
    await win.waitForTimeout(300);
    const afterClose = await readState();
    console.log(`[tfl1179] AR-02 ${size[0]}x${size[1]} afterCloseControl=${JSON.stringify(afterClose)}`);
    expect.soft(afterClose.collapsed, `AR-02 ${size[0]}x${size[1]}: the collapsed strip remounts after the close control`).toBe('true');
    expect.soft(afterClose.focus, `AR-02 ${size[0]}x${size[1]}: focus returns to the Navigator trigger after the close control`).toContain('data-rail-collapse');
    await win.screenshot({ path: shot(`tfl1185_ar02_after_close_control_${size[0]}.png`) });
  }
});

test('AR-03: compact Inspector drawer reveals contextual content, Escape closes, focus returns', async () => {
  await openReport();
  for (const size of [[981, 641], [960, 640]]) {
    await setSize(size[0], size[1]);
    await win.waitForTimeout(900);

    const opener = win.locator('[data-inspector-collapse]');
    expect(await opener.count(), `AR-03 ${size[0]}x${size[1]}: Inspector expand opener exists`).toBeGreaterThan(0);
    await opener.first().click();
    await win.waitForSelector('[data-inspector][data-inspector-drawer="true"]', { timeout: 8000 });
    await win.waitForFunction(() => {
      const el = document.querySelector('[data-inspector][data-inspector-drawer="true"]');
      return el !== null && el.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle');
    }, null, { timeout: 4000 }).catch(() => {});
    const sections = await win.locator('[data-inspector][data-inspector-drawer="true"] [data-inspector-section]').count();
    const closeCount = await win.locator('[data-inspector-close]').count();
    console.log(`[tfl1179] AR-03 ${size[0]}x${size[1]} sections=${sections} closeControls=${closeCount}`);
    await win.screenshot({ path: shot(`tfl1179_ar03_inspector_${size[0]}.png`) });
    expect(sections, `AR-03 ${size[0]}x${size[1]}: the drawer shows contextual Inspector content`).toBeGreaterThan(0);

    await win.keyboard.press('Escape');
    await win.waitForFunction(
      () => document.querySelector('[data-inspector][data-inspector-drawer="true"]') === null,
      null,
      { timeout: 6000 },
    );
    const focus = await win.evaluate(() => {
      const a = document.activeElement;
      return a === null ? 'none' : `${a.tagName}${a.hasAttribute('data-inspector-collapse') ? '[data-inspector-collapse]' : ''}`;
    });
    console.log(`[tfl1179] AR-03 ${size[0]}x${size[1]} afterEscape focus=${focus}`);
    expect(focus, `AR-03 ${size[0]}x${size[1]}: focus returns to the Inspector trigger`).toContain('data-inspector-collapse');
  }
});
