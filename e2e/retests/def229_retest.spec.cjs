// DEF-229 retest (ADV-048) — the annotation group must stay reachable AND
// clickable at the app's documented 640px minimum window width, the dropdown
// menu must open fully inside the viewport, and `.titlebar { min-width: 0 }`
// must let the caption strip shrink without mangling the brand/tabs/controls.
// Screenshots: screenshots/def-229-retest2-640.png, def-229-titlebar-640.png.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

async function openReport(electronApp, win) {
  const p = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(400);
}

async function setSize(app, win, w, h) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.setSize(s[0], s[1]);
  }, [w, h]);
  await win.waitForTimeout(500);
}

test('DEF-229: group reachable + clickable at 640; menu inside viewport; titlebar usable', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await setSize(app, win, 640, 600);
    await openReport(app, win);

    // --- Group reachability at 640 ---
    const layout = await win.evaluate(() => {
      const g = document.querySelector('[data-annotation-toolbar]');
      const r = g.getBoundingClientRect();
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const top = document.elementFromPoint(cx, cy);
      return {
        innerWidth: window.innerWidth,
        group: { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width) },
        groupReachable: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0,
        groupClipped: r.right > window.innerWidth,
        topAtCenter: top ? { tag: top.tagName, inGroup: !!top.closest('[data-annotation-toolbar]') } : null,
      };
    });
    console.log(`[def229-640] ${JSON.stringify(layout)}`);
    expect(layout.innerWidth).toBe(640);
    expect(layout.groupReachable, 'group fully inside the 640px viewport').toBe(true);
    expect(layout.groupClipped, 'group must not be clipped').toBe(false);
    expect(layout.topAtCenter?.inGroup, 'elementFromPoint at the group centre must hit the group').toBe(true);

    // --- Clickable: real click on a visible tool arms it ---
    await win.click('[data-ann-tools-visible] [data-tool="highlight"]');
    await win.waitForTimeout(400);
    const armed = await win.evaluate(() => window.tflexDiagnostics().activeTool);
    console.log(`[def229-640-click] activeTool=${armed}`);
    expect(armed, 'clicking the visible Highlight button at 640 must arm it').toBe('highlight');

    // --- Dropdown opens fully inside the viewport ---
    await win.click('[data-ann-dropdown-toggle]');
    await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'visible', timeout: 8000 });
    await win.waitForTimeout(300);
    const menu = await win.evaluate(() => {
      const m = document.querySelector('[data-ann-dropdown-menu]');
      const r = m.getBoundingClientRect();
      return {
        left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom),
        innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      };
    });
    console.log(`[def229-640-menu] ${JSON.stringify(menu)}`);
    expect(menu.left, 'menu left inside viewport').toBeGreaterThanOrEqual(0);
    expect(menu.right, 'menu right inside viewport').toBeLessThanOrEqual(menu.innerWidth);
    expect(menu.top, 'menu top inside viewport').toBeGreaterThanOrEqual(0);
    expect(menu.bottom, 'menu bottom inside viewport').toBeLessThanOrEqual(menu.innerHeight);
    await win.screenshot({ path: path.join(SHOTS, 'def-229-retest2-640.png') });
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    // --- Titlebar confirm (dev request): readable + controls reachable ---
    const title = await win.evaluate(() => {
      const bar = document.querySelector('.titlebar');
      const brand = document.querySelector('.brand');
      const tabArea = document.querySelector('.tab-area');
      const tabList = document.querySelector('.tab-list');
      const controls = document.querySelector('[data-titlebar-controls]');
      const read = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width) };
      };
      const ctrls = Array.from(document.querySelectorAll('[data-titlebar-controls] button'));
      return {
        innerWidth: window.innerWidth,
        bar: read(bar), barClientW: bar ? bar.clientWidth : null, barScrollW: bar ? bar.scrollWidth : null,
        brand: read(brand),
        tabArea: read(tabArea),
        tabListClientW: tabList ? tabList.clientWidth : null,
        tabListScrollW: tabList ? tabList.scrollWidth : null,
        controls: read(controls),
        controlReachable: ctrls.map((b) => {
          const r = b.getBoundingClientRect();
          const cx = Math.round(r.left + r.width / 2);
          const cy = Math.round(r.top + r.height / 2);
          const top = document.elementFromPoint(cx, cy);
          return {
            label: b.getAttribute('aria-label'),
            right: Math.round(r.right),
            insideViewport: r.left >= 0 && r.right <= window.innerWidth,
            hitsSelf: top === b || (top && b.contains(top)),
          };
        }),
      };
    });
    console.log(`[def229-titlebar-640] ${JSON.stringify(title)}`);
    expect(title.bar.right, 'titlebar spans the viewport at 640').toBeLessThanOrEqual(title.innerWidth);
    expect(title.bar.left, 'titlebar starts at 0').toBeGreaterThanOrEqual(-1);
    expect(title.brand && title.brand.right, 'brand is inside the viewport').toBeLessThanOrEqual(title.innerWidth);
    for (const c of title.controlReachable) {
      expect(c.insideViewport, `${c.label} inside viewport`).toBe(true);
      expect(c.hitsSelf, `${c.label} reachable via elementFromPoint`).toBe(true);
    }
    await win.screenshot({ path: path.join(SHOTS, 'def-229-titlebar-640.png') });

    // Same titlebar sanity at 1440.
    await setSize(app, win, 1440, 900);
    const title1440 = await win.evaluate(() => {
      const bar = document.querySelector('.titlebar');
      const brand = document.querySelector('.brand');
      const r = bar.getBoundingClientRect();
      const br = brand.getBoundingClientRect();
      const ctrls = Array.from(document.querySelectorAll('[data-titlebar-controls] button'));
      return {
        innerWidth: window.innerWidth,
        bar: { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) },
        brand: { left: Math.round(br.left), right: Math.round(br.right), w: Math.round(br.width) },
        controlInside: ctrls.map((b) => {
          const rr = b.getBoundingClientRect();
          return rr.left >= 0 && rr.right <= window.innerWidth;
        }),
      };
    });
    console.log(`[def229-titlebar-1440] ${JSON.stringify(title1440)}`);
    expect(title1440.bar.right, 'titlebar spans the viewport at 1440').toBeLessThanOrEqual(title1440.innerWidth);
    expect(title1440.brand.w, 'brand has a sane non-zero width at 1440').toBeGreaterThan(40);
    expect(title1440.controlInside.every(Boolean), 'all window controls inside viewport at 1440').toBe(true);
  } finally {
    await hardClose(app, 'def229-retest');
  }
});
