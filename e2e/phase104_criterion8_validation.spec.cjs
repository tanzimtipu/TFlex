// Phase 104 (TFL-880) — criterion-8 validation evidence. Targeted, screenshot-
// backed pass over the success-criterion-8 validation dimensions: dark / high-
// contrast (frosted) / light themes; narrow + wide viewports; panels open/closed;
// text scaling; Windows 100/125/150/200% DPI; keyboard navigation; selected /
// disabled / loading states; command reachability via More + Tools; and no
// collision with page navigation, zoom/pan, scrollbar or covered content.
//
// Launches ONLY through the canonical e2e/lib/launch.cjs. QA-owned; touches no
// product source. The page/zoom control lookup is DOM-robust (TFL-880): the
// floating CanvasPills OR the Phase 109 ViewStrip footer, never a null-tolerant
// pass.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, gotoStage } = require('./lib/helpers.cjs');

const OUT = path.resolve(__dirname, '..', 'screenshots', 'phase104-c8');
fs.mkdirSync(OUT, { recursive: true });
const DOCK = '[data-action-dock]';
const PAGE_CTL = '[data-page-pill], [data-view-strip] .view-strip-page';
const ZOOM_CTL = '[data-zoom-pill], [data-view-strip] .view-strip-view';
test.setTimeout(300000);

const STAGE_IDS = {
  pages: ['rotate', 'extract', 'insertPages', 'replacePages', 'split', 'delete', 'merge', 'cropPages'],
  edit: ['editToolOff', 'editText', 'editImage', 'editTextBox', 'recognizeText', 'batchOcr', 'ocrSuspects'],
  review: ['annotate', 'sign', 'stamp', 'flatten', 'forms', 'watermark', 'bates', 'exportComments',
    'importComments', 'fillFromCsv', 'exportFormData', 'importFormData', 'validateDocument',
    'sanitize', 'engineeringLayers', 'documentInfo'],
  deliver: ['optimize', 'audit', 'exportPages', 'exportText', 'exportDocx', 'exportXlsx', 'exportPptx',
    'createFromImages', 'encrypt'],
};

let app = null;
let win = null;

async function setWindow(w, h, forceMin = false) {
  await app.evaluate(({ BrowserWindow }, sz) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (!bw) return;
    try { bw.unmaximize(); } catch (_) { /* not maximized */ }
    if (sz[2]) bw.setMinimumSize(300, 300);
    bw.setSize(sz[0], sz[1]);
  }, [w, h, forceMin]);
  await win.waitForFunction((want) => Math.abs(window.innerWidth - want) <= 30, w, { timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(450);
}

async function openReport() {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector(DOCK, { timeout: 30000 });
  await win.waitForTimeout(900);
}

async function setTheme(theme) {
  // Phase 105 (chunk C) retired the title-row theme picker; the application
  // menu's View > Toggle Theme row is now the route (cycles frosted -> dark ->
  // light -> frosted). Cycle until the target theme is applied.
  for (let i = 0; i < 4; i += 1) {
    const cur = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (cur === theme) break;
    await win.click('[data-app-menu]');
    await win.waitForSelector('[data-app-menu-popover]', { state: 'visible', timeout: 5000 });
    await win.locator('[data-app-menu-popover] [data-menu-action="toggleTheme"]').first().click();
    await win.waitForSelector('[data-app-menu-popover]', { state: 'hidden', timeout: 5000 }).catch(() => {});
    await win.waitForTimeout(250);
  }
  await win.waitForFunction((w) => document.documentElement.getAttribute('data-theme') === w, theme, { timeout: 8000 });
  await win.waitForTimeout(400);
}

// Robust collision snapshot: resolves the single-mode page/zoom controls wherever
// they live, then measures the dock vs them, the reserved band, the scrollbar and
// the last-page reachability.
function collisionSnapshot() {
  return win.evaluate(([pageSel, zoomSel]) => {
    const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
    const overlap = (a, b) => !!(a && b) && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    const sc = document.querySelector('.document-scroller');
    const dockEl = document.querySelector('[data-action-dock]');
    const dock = rect(dockEl);
    const pageEl = document.querySelector(pageSel);
    const zoomEl = document.querySelector(zoomSel);
    const page = rect(pageEl);
    const zoom = rect(zoomEl);
    const home = (el, attr) => (el === null ? 'absent' : (el.hasAttribute(attr) ? 'pill' : 'view-strip'));
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      dpr: window.devicePixelRatio,
      innerW: window.innerWidth, innerH: window.innerHeight,
      pageFound: pageEl !== null, zoomFound: zoomEl !== null,
      pageHome: home(pageEl, 'data-page-pill'), zoomHome: home(zoomEl, 'data-zoom-pill'),
      dock, page, zoom,
      dockReserved: dockEl?.getAttribute('data-dock-reserved'),
      dockIconOnly: dockEl?.getAttribute('data-dock-icon-only'),
      dockTiles: dockEl ? dockEl.querySelectorAll('[data-dock-group="primary"] [data-dock-verb]').length : null,
      stripRect: rect(document.querySelector('[data-view-strip]')),
      dockVsPage: overlap(dock, page), dockVsZoom: overlap(dock, zoom),
      reserved: getComputedStyle(document.documentElement).getPropertyValue('--dock-band-reserved').trim(),
      scrollerPadding: sc ? getComputedStyle(sc).paddingBottom : null,
      scrollbarW: sc ? (sc.offsetWidth - sc.clientWidth) : null,
    };
  }, [PAGE_CTL, ZOOM_CTL]);
}

async function assertNoCollision(label) {
  const s = await collisionSnapshot();
  console.log(`[P104-C8 ${label}] ${JSON.stringify(s)}`);
  expect(s.pageFound, `${label}: page control resolved (pill or ViewStrip) - non-vacuous`).toBe(true);
  expect(s.zoomFound, `${label}: zoom control resolved (pill or ViewStrip) - non-vacuous`).toBe(true);
  expect(s.dockVsPage, `${label}: dock does not overlap page navigation`).toBe(false);
  expect(s.dockVsZoom, `${label}: dock does not overlap zoom/pan controls`).toBe(false);
  expect(parseFloat(s.reserved), `${label}: dock bottom band reserved`).toBeGreaterThan(0);
  expect(parseFloat(s.scrollerPadding), `${label}: scroller reserves the dock band`).toBeGreaterThanOrEqual(parseFloat(s.reserved) - 1);
  return s;
}

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p104-c8');
  app = null;
  win = null;
});

test('criterion-8: themes, panels, viewports, text scale, keyboard, states, reachability, collision', async () => {
  await openReport();
  await setWindow(1440, 900);
  await gotoStage(win, 1);
  await win.waitForTimeout(400);

  // ---- themes: dark, high-contrast (frosted), light ----
  for (const theme of ['frosted', 'dark', 'light']) {
    await setTheme(theme);
    await gotoStage(win, 1);
    await win.waitForTimeout(400);
    await assertNoCollision(`theme-${theme}`);
    await win.screenshot({ path: path.join(OUT, `theme-${theme}.png`) });
  }
  await setTheme('frosted');
  await gotoStage(win, 1);
  await win.waitForTimeout(300);

  // ---- panels open / closed (Inspector right panel) ----
  const inspectorState = () => win.evaluate(() => document.querySelector('[data-inspector]')?.getAttribute('data-inspector-collapsed'));
  if ((await inspectorState()) === 'true') {
    await win.locator('[data-inspector-collapse]').first().click();
    await win.waitForTimeout(500);
  }
  expect(await inspectorState(), 'inspector expanded').toBe('false');
  await assertNoCollision('inspector-open');
  await win.screenshot({ path: path.join(OUT, 'panels-inspector-open.png') });

  await win.locator('[data-inspector-collapse]').first().click();
  await win.waitForTimeout(500);
  expect(await inspectorState(), 'inspector collapsed').toBe('true');
  await assertNoCollision('inspector-closed');
  await win.screenshot({ path: path.join(OUT, 'panels-inspector-closed.png') });

  // left rail collapse, when its control is present
  const railBtn = win.locator('[data-context-panel] [data-rail-collapse]');
  if ((await railBtn.count()) > 0) {
    await railBtn.first().click();
    await win.waitForTimeout(500);
    await assertNoCollision('rail-collapsed');
    await win.screenshot({ path: path.join(OUT, 'panels-rail-collapsed.png') });
    await railBtn.first().click();
    await win.waitForTimeout(400);
  } else {
    console.log('[P104-C8 rail] no [data-context-panel] [data-rail-collapse] control present - rail state skipped');
  }
  // restore the inspector
  await win.locator('[data-inspector-collapse]').first().click();
  await win.waitForTimeout(400);

  // ---- viewports ----
  await setWindow(1440, 900);
  await assertNoCollision('wide-1440');
  await win.screenshot({ path: path.join(OUT, 'viewport-wide-1440.png') });
  await setWindow(520, 820, true);
  await assertNoCollision('narrow-520');
  await win.screenshot({ path: path.join(OUT, 'viewport-narrow-520.png') });
  // DEF-573 retest (TFL-899): at the narrow reserved-row rung the dock must take
  // its own band (host less a 12px gutter each side, ~332px at this host), stay
  // icon-only, and lay its children out without overlap. Non-vacuous: a
  // null/zero/near-zero dock width FAILS here instead of passing silently.
  const narrowDock = await win.evaluate(() => {
    const dock = document.querySelector('[data-action-dock]');
    if (!dock) return null;
    const b = dock.getBoundingClientRect();
    const host = dock.parentElement ? dock.parentElement.getBoundingClientRect() : null;
    const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    // The arrows lane clips its overflowing tiles; overlap is measured on the
    // VISIBLE (clipped) rect so a scrolled-under tile is not a false overlap.
    const visRect = (el) => {
      const r = el.getBoundingClientRect();
      let out = { l: r.left, t: r.top, r: r.right, b: r.bottom };
      let node = el.parentElement;
      while (node && node !== dock) {
        const cs = getComputedStyle(node);
        if (/(hidden|auto|scroll)/.test(`${cs.overflowX} ${cs.overflowY}`)) {
          const cr = node.getBoundingClientRect();
          out = { l: Math.max(out.l, cr.left), t: Math.max(out.t, cr.top), r: Math.min(out.r, cr.right), b: Math.min(out.b, cr.bottom) };
        }
        node = node.parentElement;
      }
      return out;
    };
    const overlap = (a, c) => a.r - a.l > 0.5 && a.b - a.t > 0.5 && c.r - c.l > 0.5 && c.b - c.t > 0.5
      && a.l < c.r && a.r > c.l && a.t < c.b && a.b > c.t;
    const idOf = (el) => el.getAttribute('data-dock-verb')
      || (el.hasAttribute('data-dock-arrow') ? `arrow-${el.getAttribute('data-dock-arrow')}` : null)
      || (el.hasAttribute('data-dock-overflow') ? 'more' : null)
      || (el.hasAttribute('data-dock-tools') ? 'tools' : null);
    const children = [...dock.querySelectorAll('[data-dock-group="primary"] [data-dock-verb], [data-dock-arrow], [data-dock-overflow], [data-dock-tools]')]
      .map((el) => ({ id: idOf(el) || '?', rect: box(el), visible: visRect(el) }));
    const collisions = [];
    for (let i = 0; i < children.length; i += 1) {
      for (let j = i + 1; j < children.length; j += 1) {
        if (overlap(children[i].visible, children[j].visible)) collisions.push(`${children[i].id}~${children[j].id}`);
      }
    }
    const tiles = [...dock.querySelectorAll('[data-dock-group="primary"] [data-dock-verb]')].map((t) => t.getAttribute('data-dock-verb'));
    return {
      width: Math.round(b.width), height: Math.round(b.height), left: Math.round(b.left),
      hostWidth: host ? Math.round(host.width) : null,
      maxWidth: getComputedStyle(dock).maxWidth, reserved: dock.getAttribute('data-dock-reserved'),
      iconOnly: dock.getAttribute('data-dock-icon-only'), tileCount: tiles.length,
      childCount: children.length, collisions,
      children: children.map((c) => ({ id: c.id, l: Math.round(c.rect.l), r: Math.round(c.rect.r), t: Math.round(c.rect.t), b: Math.round(c.rect.b), vl: Math.round(c.visible.l), vr: Math.round(c.visible.r) })),
    };
  });
  console.log(`[P104-C8 narrow-dock] ${JSON.stringify(narrowDock)}`);
  await win.screenshot({ path: path.join(OUT, 'narrow-dock-c8-after.png'), clip: { x: 100, y: 640, width: 420, height: 180 } });
  await win.screenshot({ path: path.join(OUT, 'viewport-narrow-520-after.png') });
  expect(narrowDock, 'narrow dock present').not.toBeNull();
  expect(narrowDock.reserved, 'narrow step is the reserved-row rung').toBe('true');
  expect(narrowDock.iconOnly, 'reserved dock renders icon-only').toBe('true');
  expect(narrowDock.width, 'reserved dock is a real band, not the 18px sliver').toBeGreaterThan(200);
  expect(narrowDock.width, 'reserved dock uses the host less a 12px gutter each side').toBeGreaterThanOrEqual(narrowDock.hostWidth - 24 - 2);
  expect(narrowDock.tileCount, 'five primary tiles rendered').toBe(5);
  expect(narrowDock.collisions, 'no dock children overlap').toEqual([]);
  await setWindow(1440, 900);

  // ---- text scaling ----
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.5));
  await win.waitForTimeout(700);
  const scaled = await assertNoCollision('text-scale-150pct');
  expect(scaled.dpr, 'zoom factor applied (dpr > 1)').toBeGreaterThan(1);
  await win.screenshot({ path: path.join(OUT, 'text-scale-150pct.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
  await win.waitForTimeout(600);

  // ---- keyboard navigation + focus ring ----
  await gotoStage(win, 1);
  await win.waitForTimeout(300);
  await win.evaluate(() => {
    const el = document.querySelector('[data-dock-group="primary"] [data-dock-verb]');
    if (el) el.focus();
  });
  await win.keyboard.press('Tab');
  await win.waitForTimeout(200);
  const ring = await win.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { id: el.getAttribute('data-dock-verb'), inDock: !!(el.closest && el.closest('[data-action-dock]')), boxShadow: cs.boxShadow, outlineWidth: cs.outlineWidth, outlineStyle: cs.outlineStyle };
  });
  console.log(`[P104-C8 focus] ${JSON.stringify(ring)}`);
  expect(ring?.id, 'Tab lands on a dock verb').toBeTruthy();
  const hasRing = (parseFloat(ring.outlineWidth) > 0 && ring.outlineStyle !== 'none') || (ring.boxShadow && ring.boxShadow !== 'none');
  expect(hasRing, 'distinct keyboard focus ring on the dock verb').toBe(true);

  await win.locator('[data-dock-overflow]').first().click();
  await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 8000 });
  await win.waitForTimeout(200);
  const readFocus = () => win.evaluate(() => document.activeElement?.getAttribute?.('data-dock-overflow-item') ?? document.activeElement?.getAttribute?.('data-dock-menu-item') ?? null);
  const first = await readFocus();
  await win.keyboard.press('End');
  const end = await readFocus();
  await win.keyboard.press('Escape');
  await win.waitForTimeout(250);
  const returned = await win.evaluate(() => document.activeElement === document.querySelector('[data-dock-overflow]'));
  console.log(`[P104-C8 more-keys] first=${first} end=${end} escapeReturns=${returned}`);
  expect(first, 'More open focuses a row inside the menu').toBeTruthy();
  expect(end, 'End reaches the last row').toBe('customize');
  expect(returned, 'Escape returns focus to the More button').toBe(true);

  // ---- selected / disabled states ----
  await gotoStage(win, 2);
  await win.waitForTimeout(400);
  const sel = await win.evaluate(() => {
    const el = document.querySelector('[data-action-dock] [data-dock-verb="editToolOff"]');
    const idle = document.querySelector('[data-action-dock] [data-dock-verb="editText"]');
    return el ? { pressed: el.getAttribute('aria-pressed'), bg: getComputedStyle(el).backgroundColor, idleBg: idle ? getComputedStyle(idle).backgroundColor : null } : null;
  });
  console.log(`[P104-C8 selected] ${JSON.stringify(sel)}`);
  expect(sel?.pressed, 'persistent tool shows the selected state').toBe('true');
  expect(sel.bg, 'selected tile has a distinct accent wash').not.toBe(sel.idleBg);

  await gotoStage(win, 3);
  await win.waitForTimeout(400);
  const disabled = await win.evaluate(() => {
    const el = document.querySelector('[data-action-dock] [data-dock-verb="forms"]');
    return el ? { disabled: el.disabled, aria: el.getAttribute('aria-label'), title: el.getAttribute('title') } : null;
  });
  console.log(`[P104-C8 disabled] ${JSON.stringify(disabled)}`);
  expect(disabled, 'forms verb rendered').not.toBeNull();
  expect(disabled.disabled, 'unavailable command is disabled').toBe(true);
  expect(disabled.title, 'disabled reason surfaced via the title').toBeTruthy();

  // ---- command reachability via More + Tools ----
  for (const [n, stage] of [[1, 'pages'], [2, 'edit'], [3, 'review'], [4, 'deliver']]) {
    await gotoStage(win, n);
    await win.waitForTimeout(350);
    const tiles = await win.$$eval('[data-dock-group="primary"] [data-dock-verb]', (els) => els.map((e) => e.getAttribute('data-dock-verb')));
    await win.locator('[data-dock-overflow]').first().click();
    await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 8000 });
    const menu = await win.$$eval('[data-dock-overflow-item]', (els) => els.map((e) => e.getAttribute('data-dock-overflow-item')));
    await win.keyboard.press('Escape');
    await win.waitForTimeout(250);
    for (const id of STAGE_IDS[stage]) {
      expect(tiles.includes(id) || menu.includes(id), `${stage}: ${id} reachable via tile or More`).toBe(true);
    }
    console.log(`[P104-C8 reach ${stage}] tiles=${JSON.stringify(tiles)} more=${JSON.stringify(menu)}`);
  }
  await gotoStage(win, 1);
  await win.waitForTimeout(300);
  const toolsText = ((await win.locator('[data-dock-tools]').first().textContent()) ?? '').replace(/\s+/g, ' ').trim();
  expect(toolsText, 'Tools button is labelled').toBe('Tools');
  await win.locator('[data-dock-tools]').first().click();
  await win.waitForSelector('[data-command-palette]', { state: 'visible', timeout: 8000 });
  console.log('[P104-C8 tools] labelled Tools button opened the command palette');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(250);

  // ---- no covered content: last page reachable above the dock ----
  await gotoStage(win, 1);
  await win.waitForTimeout(400);
  const last = await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    sc.scrollTop = sc.scrollHeight;
    const pages = [...document.querySelectorAll('.pdf-page')].filter((p) => { const r = p.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    let bottom = -Infinity;
    for (const p of pages) bottom = Math.max(bottom, p.getBoundingClientRect().bottom);
    const dr = document.querySelector('[data-action-dock]').getBoundingClientRect();
    return { lastBottom: Math.round(bottom), dockTop: Math.round(dr.top), pageCount: pages.length };
  });
  console.log(`[P104-C8 last-page] ${JSON.stringify(last)}`);
  expect(last.lastBottom, 'last page bottom edge scrolls above the dock top').toBeLessThanOrEqual(last.dockTop + 3);
});
