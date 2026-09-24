// QA focused retest (Phase 36 final gate) for DEF-315 / DEF-324 / DEF-325.
// Canonical launcher only. Screenshots -> screenshots/def3*-*.png.
//
//   DEF-324  the 640px title bar: tab strip usable width, active title
//            readable, and every tab + header control hit-testable at
//            640/760/900/1100/1440.
//   DEF-325  the REVIEW flyout's tool-dropdown toggle and its open menu are
//            hit-testable and clear of the Inspector at the same five widths.
//   DEF-315  the Action Dock never covers a floating pill control at the five
//            widths (the narrow-band residue of DEF-313/DEF-322).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const {
  hardClose,
  openSample,
  gotoStage,
  clickDockVerb,
} = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const WIDTHS = [1440, 1100, 900, 760, 640];
const HEIGHT = 900;

let app = null;
let win = null;

async function boot() {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
}

async function openReport() {
  await openSample(win, app, 'report.pdf');
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(900);
}

async function setWidth(w) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) bw.setSize(s[0], s[1]);
  }, [w, HEIGHT]);
  await win.waitForTimeout(650);
  await win.waitForFunction((t) => Math.abs(window.innerWidth - t) < 60, w, { timeout: 10000 });
}

// The five widths the dispatch names, measured once per width.
test('DEF-324 title bar: tab strip usable + every tab/header control hit-testable at 640/760/900/1100/1440', async () => {
  test.setTimeout(240000);
  await boot();
  try {
    await openReport();
    for (const w of WIDTHS) {
      await setWidth(w);
      const m = await win.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const rect = (el) => {
          const r = el.getBoundingClientRect();
          return { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) };
        };
        const hit = (el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(
            Math.round(r.left + r.width / 2),
            Math.round(r.top + r.height / 2),
          );
          return {
            resolves: top === el || el.contains(top),
            top: top ? `${top.tagName}.${String(top.className)}` : 'none',
          };
        };
        const area = q('.tab-area');
        const list = q('.tab-list');
        list.scrollLeft = 0;
        const active = q('.tab.tab-active') || q('.tab[data-tab-id]');
        const title = active ? active.querySelector('.tab-title') : null;
        const lr = list.getBoundingClientRect();
        const tr = title ? title.getBoundingClientRect() : null;
        const visibleTitleW = tr
          ? Math.max(0, Math.min(tr.right, lr.right) - Math.max(tr.left, lr.left))
          : 0;
        const targets = {
          open: q('[data-toolbar-open]'),
          save: q('[data-toolbar-save]'),
          saveAs: q('[data-toolbar-save-as]'),
          print: q('.header-print'),
          theme: q('.theme-toggle'),
          gear: q('.header-gear'),
          multiMode: q('.header-multi-mode'),
        };
        const controls = {};
        for (const [k, el] of Object.entries(targets)) controls[k] = el ? { ...rect(el), ...hit(el) } : null;
        // The tab strip is a horizontal scroller (DEF-245): a tab wider than
        // the strip has its trailing controls OUTSIDE the visible viewport
        // until the strip scrolls (which a real click does via
        // scrollIntoView). Record both the static and the scrolled hit state.
        const listRect = rect(list);
        const staticClose = hit(active.querySelector('.tab-close'));
        const staticNew = hit(q('.tab-new'));
        list.scrollLeft = list.scrollWidth;
        const scrolledClose = hit(active.querySelector('.tab-close'));
        const scrolledNew = hit(q('.tab-new'));
        list.scrollLeft = 0;
        return {
          innerW: window.innerWidth,
          areaW: area.clientWidth,
          listClientW: list.clientWidth,
          listScrollW: list.scrollWidth,
          listRect,
          activeTitle: title ? title.textContent : null,
          titleW: tr ? Math.round(tr.width) : null,
          visibleTitleW: Math.round(visibleTitleW),
          controls,
          tabClose: { static: staticClose, scrolled: scrolledClose },
          tabNew: { static: staticNew, scrolled: scrolledNew },
        };
      });
      console.log(`[DEF-324|${w}] ${JSON.stringify(m)}`);
      expect(m.areaW, `${w}: tab strip has a usable width`).toBeGreaterThan(60);
      expect(m.visibleTitleW, `${w}: active tab title readable`).toBeGreaterThan(0);
      // Header controls must be the top element at their own centre.
      for (const [name, c] of Object.entries(m.controls)) {
        expect(c, `${w}: ${name} is mounted`).not.toBeNull();
        expect(c.resolves, `${w}: ${name} hit-testable (top=${c.top})`).toBe(true);
      }
      // Tab controls: the strip is a horizontal scroller, so the tab's close
      // and the "+" are hit-testable once the strip scrolls them into view
      // (exactly what a real click does). When the strip is wide enough for
      // the tab they are hit-testable without scrolling.
      expect(m.tabClose.scrolled.resolves, `${w}: tab close hit-testable (scrolled; top=${m.tabClose.scrolled.top})`).toBe(true);
      expect(m.tabNew.scrolled.resolves, `${w}: "+" hit-testable (scrolled; top=${m.tabNew.scrolled.top})`).toBe(true);
      if (m.listClientW >= 227) {
        expect(m.tabClose.static.resolves, `${w}: tab close hit-testable without scrolling`).toBe(true);
        expect(m.tabNew.static.resolves, `${w}: "+" hit-testable without scrolling`).toBe(true);
      }
      if (w === 640) await win.screenshot({ path: path.join(SHOTS, 'def324-640.png') });
    }

    // Real-click proof at the minimum width: the strip's own scroll brings the
    // trailing controls in, and both the "+" and the active tab's close work.
    await setWidth(640);
    const tabCount = () => win.evaluate(() => document.querySelectorAll('.tab[data-tab-id]').length);
    const before = await tabCount();
    await win.locator('.tab-new').click({ timeout: 8000 });
    await win.waitForFunction((n) => document.querySelectorAll('.tab[data-tab-id]').length === n + 1, before, { timeout: 10000 });
    const afterNew = await tabCount();
    await win.locator('.tab.tab-active .tab-close').click({ timeout: 8000 });
    await win.waitForFunction((n) => document.querySelectorAll('.tab[data-tab-id]').length === n - 1, afterNew, { timeout: 10000 });
    const afterClose = await tabCount();
    console.log(`[DEF-324-click|640] ${JSON.stringify({ before, afterNew, afterClose })}`);
    expect(afterNew, '640: the "+" opened a tab (real click)').toBe(before + 1);
    expect(afterClose, '640: the close closed the tab (real click)').toBe(before);
  } finally {
    if (app) await hardClose(app, 'def324');
    app = null;
    win = null;
  }
});

test('DEF-325 REVIEW flyout: dropdown toggle + open menu hit-testable and clear of the Inspector at 640/760/900/1100/1440', async () => {
  test.setTimeout(300000);
  await boot();
  try {
    await openReport();
    for (const w of WIDTHS) {
      await setWidth(w);
      await gotoStage(win, 3);
      const visible = await win
        .locator('[data-annotation-flyout]')
        .first()
        .isVisible()
        .catch(() => false);
      if (!visible) {
        await clickDockVerb(win, 3, 'annotate');
        await win.waitForSelector('[data-annotation-flyout]', { state: 'visible', timeout: 10000 });
      }
      await win.waitForTimeout(400);
      const m = await win.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const rect = (el) => {
          const r = el.getBoundingClientRect();
          return {
            left: Math.round(r.left),
            right: Math.round(r.right),
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            w: Math.round(r.width),
          };
        };
        const toggle = q('[data-ann-dropdown-toggle]');
        const overlay = q('.canvas-overlay');
        const inspector = q('[data-inspector]');
        const hit = (el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(
            Math.round(r.left + r.width / 2),
            Math.round(r.top + r.height / 2),
          );
          return {
            resolves: top === el || el.contains(top),
            top: top ? `${top.tagName}.${String(top.className)}` : 'none',
          };
        };
        return {
          innerW: window.innerWidth,
          toggle: toggle ? { ...rect(toggle), ...hit(toggle) } : null,
          overlay: overlay ? rect(overlay) : null,
          inspector: inspector ? rect(inspector) : null,
        };
      });
      console.log(`[DEF-325|${w}] ${JSON.stringify(m)}`);
      expect(m.toggle, `${w}: dropdown toggle is mounted`).not.toBeNull();
      expect(m.toggle.resolves, `${w}: dropdown toggle hit-testable (top=${m.toggle.top})`).toBe(true);
      expect(m.toggle.right, `${w}: toggle inside the viewport`).toBeLessThanOrEqual(m.innerW);
      if (m.overlay) {
        expect(
          m.toggle.right,
          `${w}: toggle clear of the Inspector (canvas right=${m.overlay.right})`,
        ).toBeLessThanOrEqual(m.overlay.right + 1);
      }
      // A REAL click: if the Inspector (or anything else) intercepts it,
      // Playwright refuses/timeouts -- the DEF-325 failure mode.
      await win.locator('[data-ann-dropdown-toggle]').click({ timeout: 8000 });
      await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'visible', timeout: 8000 });
      const menu = await win.evaluate(() => {
        const el = document.querySelector('[data-ann-dropdown-menu]');
        const r = el.getBoundingClientRect();
        return {
          left: Math.round(r.left),
          right: Math.round(r.right),
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          innerW: window.innerWidth,
          innerH: window.innerHeight,
        };
      });
      console.log(`[DEF-325-menu|${w}] ${JSON.stringify(menu)}`);
      expect(menu.left, `${w}: menu left inside viewport`).toBeGreaterThanOrEqual(0);
      expect(menu.right, `${w}: menu right inside viewport`).toBeLessThanOrEqual(menu.innerW);
      expect(menu.top, `${w}: menu top inside viewport`).toBeGreaterThanOrEqual(0);
      expect(menu.bottom, `${w}: menu bottom inside viewport`).toBeLessThanOrEqual(menu.innerH);
      if (w === 640) await win.screenshot({ path: path.join(SHOTS, 'def325-640-menu.png') });
      await win.keyboard.press('Escape');
      await win.waitForTimeout(350);
    }
  } finally {
    if (app) await hardClose(app, 'def325');
    app = null;
    win = null;
  }
});

test('DEF-315 Action Dock never covers a floating pill control at 640/760/900/1100/1440 (PAGES)', async () => {
  test.setTimeout(240000);
  await boot();
  try {
    await openReport();
    await gotoStage(win, 1); // PAGES is the default stage; pin it explicitly.
    for (const w of WIDTHS) {
      await setWidth(w);
      const m = await win.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const rect = (el) => {
          const r = el.getBoundingClientRect();
          return {
            left: Math.round(r.left),
            right: Math.round(r.right),
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        };
        const dock = q('[data-action-dock]');
        const page = q('[data-page-pill]');
        const zoom = q('[data-zoom-pill]');
        const covered = [];
        for (const btn of document.querySelectorAll('[data-canvas-pills] button')) {
          const r = btn.getBoundingClientRect();
          const el = document.elementFromPoint(
            Math.round(r.left + r.width / 2),
            Math.round(r.top + r.height / 2),
          );
          if (el === null || (el !== btn && !btn.contains(el))) {
            covered.push(
              `${page && page.contains(btn) ? 'page' : 'zoom'}:${btn.getAttribute('aria-label') || btn.className}`,
            );
          }
        }
        const overlap = (a, b) =>
          a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        return {
          innerW: window.innerWidth,
          canvas: q('.canvas-overlay') ? rect(q('.canvas-overlay')) : null,
          dock: dock ? rect(dock) : null,
          page: page ? rect(page) : null,
          zoom: zoom ? rect(zoom) : null,
          covered,
          dockHitsPage: overlap(dock ? rect(dock) : null, page ? rect(page) : null),
          dockHitsZoom: overlap(dock ? rect(dock) : null, zoom ? rect(zoom) : null),
        };
      });
      console.log(`[DEF-315|${w}] ${JSON.stringify(m)}`);
      expect(m.dock, `${w}: dock mounted`).not.toBeNull();
      expect(m.page, `${w}: page pill mounted`).not.toBeNull();
      expect(m.zoom, `${w}: zoom pill mounted`).not.toBeNull();
      expect(m.covered, `${w}: every canvas-pill control hit-testable`).toEqual([]);
      expect(m.dockHitsPage, `${w}: dock does not overlap the page pill`).toBe(false);
      expect(m.dockHitsZoom, `${w}: dock does not overlap the zoom pill`).toBe(false);
      if (w === 640) await win.screenshot({ path: path.join(SHOTS, 'def315-640-pills.png') });
    }
  } finally {
    if (app) await hardClose(app, 'def315');
    app = null;
    win = null;
  }
});