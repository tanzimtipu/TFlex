// TFL-1122 (TFL-1116 C3 / R03) focused QA verification: the File menu (the
// restored Phase 127 CommandMenu surface; R03 is a VISUAL-CONTAINMENT defect)
// stays fully inside the viewport with no horizontal menu scroll at 960x640,
// 1024x768, 1280x800 and maximized, on Home (the surface R03 was reported
// against). Launches ONLY through the canonical launchApp helper; qa-owned;
// read-only product checks.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shotPath = (name) => path.join(SHOTS, name);

let app = null;
let win = null;

test.beforeAll(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('[data-menu-button]', { timeout: 30000 });
});

test.afterAll(async () => {
  if (app) await hardClose(app, 'tfl1122-r03');
  app = null;
  win = null;
});

test.setTimeout(240000);

// Wait until innerWidth/innerHeight stop changing (two equal readings).
const settleViewport = async () => {
  await win
    .waitForFunction(
      () => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const prev = window.__tfVp || { w: -1, h: -1 };
        window.__tfVp = { w, h };
        return Math.abs(w - prev.w) < 1 && Math.abs(h - prev.h) < 1;
      },
      null,
      { timeout: 8000, polling: 150 },
    )
    .catch(() => {});
  await win.waitForTimeout(250);
};

const setSize = async (w, h) => {
  // The window launches MAXIMIZED on this host and setSize is ignored while
  // maximized, so unmaximize first (mirrors phase108_siderail.spec.cjs).
  await app.evaluate(({ BrowserWindow }) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw.isMaximized()) bw.unmaximize();
  });
  await win.waitForTimeout(300);
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]);
  }, [w, h]);
  await settleViewport();
};

const maximize = async () => {
  await app.evaluate(({ BrowserWindow }) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (!bw.isMaximized()) bw.maximize();
  });
  await settleViewport();
  await settleViewport();
};

const openMenu = async () => {
  await win.click('[data-menu-button]');
  await win.waitForSelector('[data-menu-popover]', { state: 'visible', timeout: 8000 });
  await win.waitForTimeout(300);
};

const closeMenu = async () => {
  await win.keyboard.press('Escape');
  await win
    .waitForSelector('[data-menu-popover]', { state: 'detached', timeout: 8000 })
    .catch(() => {});
  await win.waitForTimeout(200);
};

const menuMetrics = () =>
  win.evaluate(() => {
    const pop = document.querySelector('[data-menu-popover]');
    const list = pop ? pop.querySelector('.command-menu-list') : null;
    const trigger = document.querySelector('[data-menu-button]');
    const tb = trigger ? trigger.getBoundingClientRect() : null;
    const r = pop.getBoundingClientRect();
    const cs = getComputedStyle(pop);
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      rightGutter: window.innerWidth - r.right,
      popScrollW: pop.scrollWidth,
      popClientW: pop.clientWidth,
      listScrollW: list ? list.scrollWidth : null,
      listClientW: list ? list.clientWidth : null,
      position: cs.position,
      cssRight: cs.right,
      overflowX: cs.overflowX,
      triggerLeft: tb ? tb.left : null,
      triggerRight: tb ? tb.right : null,
      submenuCount: document.querySelectorAll('[data-menu-popover] [data-menu-submenu]').length,
    };
  });

const SIZES = [
  { name: '960', w: 960, h: 640 },
  { name: '1024', w: 1024, h: 768 },
  { name: '1280', w: 1280, h: 800 },
];

test('TFL-1122 R03: File menu stays inside the viewport at every size', async () => {
  const cases = [...SIZES, { name: 'max' }];
  for (const c of cases) {
    if (c.name === 'max') await maximize();
    else await setSize(c.w, c.h);

    await openMenu();
    const m = await menuMetrics();
    await win.screenshot({ path: shotPath(`tfl1116_r03_menu_${c.name}.png`) });
    console.log(`[tfl1122] size=${c.name} ${JSON.stringify(m)}`);

    const tol = 1;
    // R03 correction: flip/shift inside an 8px viewport gutter; the box must
    // never cross the window edge on any side.
    expect(m.left, `${c.name}: popover left inside viewport`).toBeGreaterThanOrEqual(-tol);
    expect(m.right, `${c.name}: popover right inside viewport`).toBeLessThanOrEqual(m.innerWidth + tol);
    expect(m.top, `${c.name}: popover top inside viewport`).toBeGreaterThanOrEqual(-tol);
    expect(m.bottom, `${c.name}: popover bottom inside viewport`).toBeLessThanOrEqual(m.innerHeight + tol);
    // 8px gutter both sides => never wider than innerWidth - 16.
    expect(m.width, `${c.name}: popover within the 8px gutters`).toBeLessThanOrEqual(m.innerWidth - 16 + tol);
    // R03 correction names an 8px viewport gutter on BOTH sides. The width
    // bound above passes only incidentally when the clamped `left` exceeds 16;
    // assert the right gutter directly so a full-bleed stretch cannot hide here.
    expect(m.rightGutter, `${c.name}: 8px right viewport gutter`).toBeGreaterThanOrEqual(8 - tol);
    // Vertical scrolling only: no horizontal overflow on the surface or list.
    expect(m.popScrollW, `${c.name}: popover has no horizontal scroll`).toBeLessThanOrEqual(m.popClientW + tol);
    expect(m.listScrollW, `${c.name}: .command-menu-list has no horizontal scroll`).toBeLessThanOrEqual(m.listClientW + tol);
    // The File menu anchors under its trigger (absolute) or via the
    // collision-aware fixed path; either way it must stay out of flow. (The
    // retired app-menu used fixed placement; the restored Phase 127 File menu
    // anchors absolutely, so accept both.)
    expect(['absolute', 'fixed'], `${c.name}: popover is out of flow (position ${m.position})`).toContain(m.position);
    expect(m.overflowX, `${c.name}: overflow-x is hidden`).toBe('hidden');
    // The File menu is built from flat MenuEntry groups (no submenu field), so
    // it exposes no nested submenu; assert the root only.
    expect(m.submenuCount, `${c.name}: File menu has no submenu rows`).toBe(0);

    await closeMenu();
  }
});
