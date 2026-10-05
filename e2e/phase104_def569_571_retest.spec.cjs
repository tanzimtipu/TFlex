// TFL-852 / Phase 104 — focused live retest for DEF-569 and DEF-571.
// Launches ONLY through the canonical e2e/lib/launch.cjs. QA-owned; touches no
// product source.
//
// DEF-569: in the PAGES selection state (data-dock-state="selection") the bulk
//   `delete` renders ONLY as a selection tile; it must NOT also appear in the
//   anchored More popover, and the More set is the stage's displaced primaries.
// DEF-571: the leading `rotate` tile never sits over the page pill across the
//   icon-only rung (740-860px), and the dock box clears both pills.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, gotoStage } = require('./lib/helpers.cjs');

const OUT = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const DOCK = '[data-action-dock]';
// TFL-880 — DOM-robust single-mode page/zoom control resolution. The controls
// live in the floating CanvasPills ([data-page-pill]/[data-zoom-pill]) OR, after
// the Phase 109 ViewStrip relocation, inside the [data-view-strip] footer
// (.view-strip-page / .view-strip-view). If NEITHER resolves the test FAILS, so
// the DEF-571 pill comparisons are never vacuous.
const PAGE_CTL = '[data-page-pill], [data-view-strip] .view-strip-page';
const ZOOM_CTL = '[data-zoom-pill], [data-view-strip] .view-strip-view';
test.setTimeout(300000);

let app = null;
let win = null;

async function setWindow(w, h) {
  await app.evaluate(({ BrowserWindow }, sz) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (!bw) return;
    try { bw.unmaximize(); } catch (_) { /* not maximized */ }
    try { bw.setMinimumSize(300, 300); } catch (_) { /* ignore */ }
    bw.setSize(sz[0], sz[1]);
  }, [w, h]);
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

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p104-retest');
  app = null;
  win = null;
});

test('DEF-569: selection-state delete is a tile ONLY; More holds the displaced primaries', async () => {
  await openReport();
  await setWindow(1440, 900);
  await gotoStage(win, 1);
  await win.waitForTimeout(500);

  await win.locator('[data-page="1"]').first().click({ modifiers: ['Shift'], timeout: 8000 });
  await win.waitForTimeout(700);
  const state = await win.locator(DOCK).getAttribute('data-dock-state');
  const tiles = await win.$$eval(
    '[data-action-dock] [data-dock-group="primary"] [data-dock-verb]',
    (els) => els.map((e) => e.getAttribute('data-dock-verb')),
  );
  await win.locator('[data-dock-overflow]').first().click();
  await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 8000 });
  await win.waitForTimeout(200);
  const menu = await win.$$eval('[data-dock-overflow-item]', (els) =>
    els.map((e) => e.getAttribute('data-dock-overflow-item')));
  const deleteRowCount = await win.locator('[data-dock-overflow-item="delete"]').count();
  const deleteTile = await win.locator('[data-dock-group="primary"] [data-dock-verb="delete"]').count();
  await win.screenshot({ path: path.join(OUT, 'phase104-def569-selection.png') });
  console.log(`[DEF569] state=${state} tiles=${JSON.stringify(tiles)} menu=${JSON.stringify(menu)} deleteTile=${deleteTile} deleteRow=${deleteRowCount}`);

  expect(state, 'shift-click enters the PAGES selection state').toBe('selection');
  expect(deleteTile, 'delete renders as a selection tile').toBe(1);
  expect(deleteRowCount, 'delete does NOT exist in the More menu').toBe(0);
  expect(new Set(tiles), 'State-2 selection tiles').toEqual(new Set(['rotate', 'extract', 'delete', 'clearPageSelection']));
  expect(new Set(menu), 'More holds the displaced stage primaries').toEqual(
    new Set(['insertPages', 'replacePages', 'split', 'merge', 'cropPages']),
  );
  const dupes = tiles.filter((id) => menu.includes(id));
  expect(dupes, `each dock id renders exactly once (dupes=${JSON.stringify(dupes)})`).toEqual([]);
});

test('DEF-571: leading rotate tile never sits over the page pill at 740-860px', async () => {
  await openReport();
  await gotoStage(win, 1);
  const widths = [740, 780, 820, 860];
  const rows = [];
  for (const w of widths) {
    await setWindow(w, 860);
    await gotoStage(win, 1);
    await win.waitForTimeout(400);
    const s = await win.evaluate(([pageSel, zoomSel]) => {
      const rect = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
      const overlap = (a, b) => !!a && !!b && a.l < b.r - 0.5 && a.r > b.l + 0.5 && a.t < b.b - 0.5 && a.b > b.t + 0.5;
      const visibleRect = (el) => {
        const r = el.getBoundingClientRect();
        let box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
        let anc = el.parentElement;
        while (anc && anc !== document.documentElement) {
          const cs = getComputedStyle(anc);
          if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
            const ar = anc.getBoundingClientRect();
            box = { l: Math.max(box.l, ar.left), t: Math.max(box.t, ar.top), r: Math.min(box.r, ar.right), b: Math.min(box.b, ar.bottom) };
          }
          anc = anc.parentElement;
        }
        return box;
      };
      const dock = document.querySelector('[data-action-dock]');
      const rotate = dock?.querySelector('[data-dock-verb="rotate"]');
      const pageEl = document.querySelector(pageSel);
      const zoomEl = document.querySelector(zoomSel);
      const dr = dock ? rect(dock) : null;
      const rr = rotate ? visibleRect(rotate) : null;
      const pr = pageEl ? rect(pageEl) : null;
      const zr = zoomEl ? rect(zoomEl) : null;
      return {
        width: window.innerWidth,
        iconOnly: dock?.getAttribute('data-dock-icon-only'),
        arrowsLane: dock?.getAttribute('data-dock-arrows-lane'),
        pageFound: pageEl !== null, zoomFound: zoomEl !== null,
        pageHome: pageEl === null ? 'absent' : (pageEl.hasAttribute('data-page-pill') ? 'pill' : 'view-strip'),
        zoomHome: zoomEl === null ? 'absent' : (zoomEl.hasAttribute('data-zoom-pill') ? 'pill' : 'view-strip'),
        rotateVsPage: overlap(rr, pr),
        dockVsPage: overlap(dr, pr),
        dockVsZoom: overlap(dr, zr),
        rotate: rr, page: pr, zoom: zr, dock: dr,
      };
    }, [PAGE_CTL, ZOOM_CTL]);
    rows.push(s);
    console.log(`[DEF571 ${w}] iconOnly=${s.iconOnly} lane=${s.arrowsLane} pageHome=${s.pageHome} zoomHome=${s.zoomHome} rotateVsPage=${s.rotateVsPage} dockVsPage=${s.dockVsPage} dockVsZoom=${s.dockVsZoom} rotate=${JSON.stringify(s.rotate)} page=${JSON.stringify(s.page)}`);
    if (s.rotateVsPage || s.dockVsPage || s.dockVsZoom) {
      await win.screenshot({ path: path.join(OUT, `phase104-def571-${w}.png`) });
    }
    expect(s.pageFound, `width ${w}: page control resolved (pill or ViewStrip) - non-vacuous`).toBe(true);
    expect(s.zoomFound, `width ${w}: zoom control resolved (pill or ViewStrip) - non-vacuous`).toBe(true);
    expect(s.rotateVsPage, `width ${w}: rotate does not intersect the page control`).toBe(false);
    expect(s.dockVsPage, `width ${w}: dock box clears the page control`).toBe(false);
    expect(s.dockVsZoom, `width ${w}: dock box clears the zoom control`).toBe(false);
  }
  // Required evidence: capture at least the 860px rung.
  const w860 = rows.find((r) => r.width >= 855 && r.width <= 865) ?? rows[rows.length - 1];
  await win.screenshot({ path: path.join(OUT, `phase104-def571-${w860.width}.png`) });
  console.log(`[DEF571] captured phase104-def571-${w860.width}.png`);
});

module.exports = {};
