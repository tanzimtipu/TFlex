// Phase 104 (TFL-880) — criterion-8 Windows DPI-scale leg. Launches the app at
// forced device scale factors 100 / 125 / 150 / 200% and verifies the single-mode
// page/zoom controls resolve (CanvasPills OR the Phase 109 ViewStrip footer) and
// the dock never collides with them. QA-owned; no product source touched.
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
test.setTimeout(180000);

for (const scale of [1, 1.25, 1.5, 2]) {
  const pct = Math.round(scale * 100);
  test(`criterion-8 DPI ${pct}%: controls resolve, dock does not collide`, async () => {
    const app = await launchApp([`--force-device-scale-factor=${scale}`]);
    const win = await app.firstWindow();
    try {
      await win.waitForSelector('.sample-card', { timeout: 30000 });
      await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
      await win.waitForSelector('.workspace', { timeout: 30000 });
      await win.waitForSelector(DOCK, { timeout: 30000 });
      await win.waitForTimeout(900);
      await gotoStage(win, 1);
      await win.waitForTimeout(400);

      const s = await win.evaluate(([pageSel, zoomSel]) => {
        const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
        const overlap = (a, b) => !!(a && b) && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
        const sc = document.querySelector('.document-scroller');
        const dock = rect(document.querySelector('[data-action-dock]'));
        const pageEl = document.querySelector(pageSel);
        const zoomEl = document.querySelector(zoomSel);
        const page = rect(pageEl);
        const zoom = rect(zoomEl);
        const home = (el, attr) => (el === null ? 'absent' : (el.hasAttribute(attr) ? 'pill' : 'view-strip'));
        return {
          dpr: window.devicePixelRatio,
          innerWidth: window.innerWidth,
          pageFound: pageEl !== null, zoomFound: zoomEl !== null,
          pageHome: home(pageEl, 'data-page-pill'), zoomHome: home(zoomEl, 'data-zoom-pill'),
          dockVsPage: overlap(dock, page), dockVsZoom: overlap(dock, zoom),
          reserved: getComputedStyle(document.documentElement).getPropertyValue('--dock-band-reserved').trim(),
          scrollerPadding: sc ? getComputedStyle(sc).paddingBottom : null,
        };
      }, [PAGE_CTL, ZOOM_CTL]);
      console.log(`[P104-C8 dpi ${pct}] ${JSON.stringify(s)}`);
      await win.screenshot({ path: path.join(OUT, `dpi-${pct}.png`) });

      expect(s.dpr, `${pct}%: devicePixelRatio reflects the forced scale`).toBeGreaterThanOrEqual(scale - 0.01);
      expect(s.pageFound, `${pct}%: page control resolved (pill or ViewStrip) - non-vacuous`).toBe(true);
      expect(s.zoomFound, `${pct}%: zoom control resolved (pill or ViewStrip) - non-vacuous`).toBe(true);
      expect(s.dockVsPage, `${pct}%: dock does not overlap page navigation`).toBe(false);
      expect(s.dockVsZoom, `${pct}%: dock does not overlap zoom/pan controls`).toBe(false);
      expect(parseFloat(s.reserved), `${pct}%: dock bottom band reserved`).toBeGreaterThan(0);
      expect(parseFloat(s.scrollerPadding), `${pct}%: scroller reserves the dock band`).toBeGreaterThanOrEqual(parseFloat(s.reserved) - 1);
    } finally {
      await hardClose(app, `p104-c8-dpi-${pct}`);
    }
  });
}
