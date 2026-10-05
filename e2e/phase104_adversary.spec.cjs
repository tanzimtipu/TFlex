// TFL-850 — Phase 104 dock diff-pass, ADVERSARY live probe (adversary-owned).
// Launches ONLY through the canonical e2e/lib/launch.cjs. Touches no product
// source. Evidence: test-fixtures/phase104-adversary/*.
//
// Attacks:
//   A. selection-state duplication: the PAGES dock's State-2 `delete` tile and
//      the anchored More popover must not both offer a `delete` command, and the
//      More row must not route a DIFFERENT handler than the visible tile.
//   B. width sweep: the dock (and every rendered verb) must never overlap the
//      page / zoom pill, and the labelled row must never spill outside the dock
//      box at any width from 1440 down to 560.
//   C. reserved bottom inset keeps the LAST page scrollable above the dock.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, gotoStage } = require('./lib/helpers.cjs');

const OUT = path.resolve(__dirname, '..', 'test-fixtures', 'phase104-adversary');
fs.mkdirSync(OUT, { recursive: true });
const DOCK = '[data-action-dock]';
test.setTimeout(600000);

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

function snapshot() {
  return win.evaluate(() => {
    const r = (el) => {
      const b = el.getBoundingClientRect();
      return { l: +b.left.toFixed(1), t: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
    };
    const overlap = (a, b) => !!a && !!b && a.l < b.r - 0.5 && a.r > b.l + 0.5 && a.t < b.b - 0.5 && a.b > b.t + 0.5;
    const dock = document.querySelector('[data-action-dock]');
    const page = document.querySelector('[data-page-pill]');
    const zoom = document.querySelector('[data-zoom-pill]');
    if (!dock) return { missing: true };
    const dr = r(dock);
    const pr = page ? r(page) : null;
    const zr = zoom ? r(zoom) : null;
    // Visible rect of a verb: its border box intersected with every ancestor
    // that actually clips (computed overflow-x/y not 'visible'), so a verb that
    // is scrolled out of the arrows lane is NOT reported as a visual collision.
    const visibleRect = (el) => {
      let rect = el.getBoundingClientRect();
      let box = { l: rect.left, t: rect.top, r: rect.right, b: rect.bottom };
      let anc = el.parentElement;
      while (anc && anc !== document.documentElement) {
        const cs = getComputedStyle(anc);
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
          const ar = anc.getBoundingClientRect();
          box = {
            l: Math.max(box.l, ar.left), t: Math.max(box.t, ar.top),
            r: Math.min(box.r, ar.right), b: Math.min(box.b, ar.bottom),
          };
        }
        anc = anc.parentElement;
      }
      return box;
    };
    const verbs = [...dock.querySelectorAll('[data-dock-verb]')].map((e) => ({
      id: e.getAttribute('data-dock-verb'), ...r(e), vis: visibleRect(e),
    }));
    const verbWidths = verbs.map((v) => ({ id: v.id, w: v.w, min: getComputedStyle(dock.querySelector(`[data-dock-verb="${v.id}"]`)).minWidth }));
    const maxVerbRight = verbs.reduce((m, v) => Math.max(m, v.r), dr.r);
    const spillRight = +(maxVerbRight - dr.r).toFixed(1);
    const dockOverflow = dock.scrollWidth - dock.clientWidth;
    const verbVsPage = verbs.filter((v) => overlap(v.vis, pr)).map((v) => v.id);
    const verbVsZoom = verbs.filter((v) => overlap(v.vis, zr)).map((v) => v.id);
    return {
      dockOverflow,
      verbWidths,
      width: window.innerWidth,
      dock: dr, page: pr, zoom: zr,
      dockVsPage: overlap(dr, pr), dockVsZoom: overlap(dr, zr),
      spillRight,
      verbVsPage, verbVsZoom,
      arrowsLane: dock.getAttribute('data-dock-arrows-lane'),
      iconOnly: dock.getAttribute('data-dock-icon-only'),
      reservedRow: dock.getAttribute('data-dock-reserved'),
      scrollW: dock.scrollWidth, clientW: dock.clientWidth,
      reserved: getComputedStyle(document.documentElement).getPropertyValue('--dock-band-reserved').trim(),
      scrollerPad: getComputedStyle(document.querySelector('.document-scroller')).paddingBottom,
      state: dock.getAttribute('data-dock-state'),
    };
  });
}

function tileIds() {
  return win.$$eval('[data-action-dock] [data-dock-group="primary"] [data-dock-verb]',
    (els) => els.map((e) => e.getAttribute('data-dock-verb')));
}
function menuIds() {
  return win.$$eval('[data-dock-overflow-item]', (els) => els.map((e) => e.getAttribute('data-dock-overflow-item')));
}

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p104-adv');
  app = null;
  win = null;
});

test('ADV-A: selection state must not duplicate delete in the More popover', async () => {
  await openReport();
  await setWindow(1440, 900);
  await gotoStage(win, 1);
  await win.waitForTimeout(500);

  // Shift-click page 1 to enter State 2 (selection).
  await win.locator('[data-page="1"]').first().click({ modifiers: ['Shift'], timeout: 8000 });
  await win.waitForTimeout(700);
  const state = await win.locator(DOCK).getAttribute('data-dock-state');
  const tiles = await tileIds();
  await win.locator('[data-dock-overflow]').first().click();
  await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 8000 });
  await win.waitForTimeout(200);
  const menu = await menuIds();
  const overlap = tiles.filter((id) => menu.includes(id));
  const deleteRow = await win.evaluate(() => {
    const el = document.querySelector('[data-dock-overflow-item="delete"]');
    if (!el) return null;
    return { disabled: el.hasAttribute('disabled'), label: (el.textContent ?? '').trim(), title: el.getAttribute('title') };
  });
  await win.screenshot({ path: path.join(OUT, 'adv-selection-more.png') });
  // eslint-disable-next-line no-console
  console.log(`[ADV-A] state=${state} tiles=${JSON.stringify(tiles)} menu=${JSON.stringify(menu)} overlap=${JSON.stringify(overlap)} deleteRow=${JSON.stringify(deleteRow)}`);
  expect(state, 'shift-click selects a page').toBe('selection');
  expect(overlap, `duplicated tile+More ids: ${JSON.stringify(overlap)}`).toEqual([]);
});

test('ADV-B: dock and verbs never collide with the pills across the width sweep', async () => {
  await openReport();
  await gotoStage(win, 1);
  const widths = [1440, 1280, 1100, 1000, 940, 900, 880, 860, 820, 780, 740, 720, 680, 640, 600, 560];
  const rows = [];
  for (const w of widths) {
    await setWindow(w, 860);
    await gotoStage(win, 1);
    await win.waitForTimeout(350);
    const s = await snapshot();
    rows.push(s);
    // eslint-disable-next-line no-console
    console.log(`[ADV-B ${w}] dockVsPage=${s.dockVsPage} dockVsZoom=${s.dockVsZoom} spillRight=${s.spillRight} dockOverflow=${s.dockOverflow} verbVsPage=${JSON.stringify(s.verbVsPage)} verbVsZoom=${JSON.stringify(s.verbVsZoom)} iconOnly=${s.iconOnly} arrowsLane=${s.arrowsLane} reservedRow=${s.reservedRow}`);
    if (s.dockVsPage || s.dockVsZoom || s.dockOverflow > 0 || (s.verbVsPage || []).length || (s.verbVsZoom || []).length) {
      await win.screenshot({ path: path.join(OUT, `adv-w${w}.png`) });
    }
  }
  fs.writeFileSync(path.join(OUT, 'adv-width-sweep.json'), JSON.stringify(rows, null, 2));
  const collisions = rows.filter((s) => s.dockVsPage || s.dockVsZoom);
  const verbCollisions = rows.filter((s) => (s.verbVsPage || []).length || (s.verbVsZoom || []).length);
  const spills = rows.filter((s) => s.spillRight > 1);
  const dockOverflows = rows.filter((s) => s.dockOverflow > 0);
  expect(collisions.map((s) => s.width), 'dock-vs-pill collisions').toEqual([]);
  expect(verbCollisions.map((s) => ({ w: s.width, page: s.verbVsPage, zoom: s.verbVsZoom })), 'verb-vs-pill collisions').toEqual([]);
  expect(spills.map((s) => ({ w: s.width, spill: s.spillRight })), 'labelled-row spill beyond the dock box').toEqual([]);
  expect(dockOverflows.map((s) => ({ w: s.width, over: s.dockOverflow })), 'dock content overflowing its own box (no clip)').toEqual([]);
});

test('ADV-C: reserved bottom inset keeps the last page above the dock (narrow + wide)', async () => {
  await openReport();
  for (const w of [900, 640]) {
    await setWindow(w, 860);
    await gotoStage(win, 1);
    await win.waitForTimeout(400);
    const res = await win.evaluate(() => {
      const sc = document.querySelector('.document-scroller');
      sc.scrollTop = sc.scrollHeight;
      const pages = [...document.querySelectorAll('.pdf-page')].filter((p) => {
        const r = p.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      let bottom = -Infinity;
      for (const p of pages) bottom = Math.max(bottom, p.getBoundingClientRect().bottom);
      const dr = document.querySelector('[data-action-dock]').getBoundingClientRect();
      return {
        lastBottom: Math.round(bottom), dockTop: Math.round(dr.top),
        reserved: getComputedStyle(document.documentElement).getPropertyValue('--dock-band-reserved').trim(),
        scrollerPad: getComputedStyle(sc).paddingBottom, pageCount: pages.length,
      };
    });
    // eslint-disable-next-line no-console
    console.log(`[ADV-C ${w}] ${JSON.stringify(res)}`);
    expect(res.pageCount, 'document rendered pages').toBeGreaterThan(0);
    expect(res.lastBottom, `width ${w}: last page bottom scrolls above the dock top`).toBeLessThanOrEqual(res.dockTop + 3);
  }
});
