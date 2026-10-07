// TFL-1157 (TFL-1116 C9b / R15) — the Action Dock sizes against the CANVAS
// VIEWPORT width, not the fitted-paper width and not a phantom pill reserve.
//
// At 962x620 the single-mode canvas has substantial spare width, but the dock
// used to stay clamped to `canvas - 476` (the retired pill reserve) — roughly
// the fitted-paper width — and forced its labelled row into the scrolling
// arrows lane even though the window (962) is well above the label rung (880).
// Phase 109 retired the floating page/zoom pills, so the canvas measures no
// pill; the dock must size against the canvas viewport and only scroll when the
// row genuinely cannot fit. Launches ONLY through e2e/lib/launch.cjs.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, openSample, gotoStage } = require('./lib/helpers.cjs');

delete process.env.ELECTRON_RUN_AS_NODE;

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;
test.setTimeout(240000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1157-r15');
  app = null;
  win = null;
});

async function setSize(w, h) {
  await app.evaluate(({ BrowserWindow }) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw.isMaximized()) bw.unmaximize();
  });
  await win.waitForTimeout(300);
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]);
  }, [w, h]);
  await win.waitForFunction((s) => Math.abs(window.innerWidth - s) < 60, w, { timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(500);
}

const readDock = () =>
  win.evaluate(() => {
    const dock = document.querySelector('[data-action-dock]');
    const scroller = document.querySelector('.document-scroller');
    const overlay = document.querySelector('.canvas-overlay');
    const order = dock
      ? Array.from(
          dock.querySelectorAll('[data-dock-group="primary"], [data-dock-overflow], [data-dock-tools]'),
        ).map(function (el) {
          if (el.hasAttribute('data-dock-group')) return 'primary';
          if (el.hasAttribute('data-dock-overflow')) return 'more';
          return 'tools';
        })
      : [];
    return {
      innerW: window.innerWidth,
      scrollerClientW: scroller ? scroller.clientWidth : null,
      overlayW: overlay ? Math.round(overlay.getBoundingClientRect().width) : null,
      cap: dock ? Number.parseFloat(dock.style.maxWidth) : null,
      band: dock ? Number(dock.getAttribute('data-dock-band')) : null,
      iconOnly: dock ? dock.getAttribute('data-dock-icon-only') : null,
      arrows: dock ? dock.getAttribute('data-dock-arrows') : null,
      arrowsLane: dock ? dock.getAttribute('data-dock-arrows-lane') : null,
      arrowCount: document.querySelectorAll('[data-dock-arrow]').length,
      labels: dock ? dock.querySelectorAll('[data-dock-group="primary"] .action-dock-label').length : null,
      morePresent: !!(dock && dock.querySelector('[data-dock-overflow]')),
      order,
    };
  });

function assertCoreThenMore(m, label) {
  expect(m.order[0], `${label}: core stage tools come first`).toBe('primary');
  expect(m.order.indexOf('more'), `${label}: the More utility follows the core tools`).toBeGreaterThan(
    m.order.indexOf('primary'),
  );
  expect(m.order.indexOf('tools'), `${label}: Tools trails More`).toBeGreaterThan(m.order.indexOf('more'));
  expect(m.morePresent, `${label}: the More utility is present`).toBe(true);
}

test('R15: at 962x620 the dock uses the canvas viewport width (no fitted-paper clamp, no chevrons)', async () => {
  await openSample(win, app, 'report.pdf');
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(900);
  await gotoStage(win, 1);
  await setSize(962, 620);

  const at962 = await readDock();
  console.log(`[TFL-1157 R15 962x620] ${JSON.stringify(at962)}`);
  expect(at962.cap, 'dock cap measured').not.toBeNull();
  expect(at962.scrollerClientW, 'canvas viewport measured').toBeGreaterThan(0);
  // The cap IS the canvas viewport (reserve 0): not the retired 476px pill band
  // and not the fitted-paper width.
  expect(
    Math.abs(at962.cap - at962.scrollerClientW),
    `962: dock caps on the canvas viewport (${at962.cap} vs ${at962.scrollerClientW})`,
  ).toBeLessThanOrEqual(2);
  expect(at962.cap, '962: not clamped by the phantom 476 reserve').toBeGreaterThan(
    at962.scrollerClientW - 100,
  );
  // Spare width exists, so the labelled row must not scroll.
  expect(at962.iconOnly, '962: labels stay (window is above the 880 rung)').toBe('false');
  expect(at962.arrowsLane, '962: no scroll lane while the plan fits').toBe('false');
  expect(at962.arrows, '962: no scroll chevrons while spare width exists').toBe('false');
  expect(at962.arrowCount, '962: no arrow controls render').toBe(0);
  expect(at962.labels, '962: every core stage tool keeps its label').toBe(5);
  assertCoreThenMore(at962, '962');

  await win.screenshot({ path: path.join(SHOTS, 'tfl1116_r15_dock_962x620.png') });

  // 640-wide: the ladder drops to the icon-only arrows rung, but the dock still
  // caps on the CANVAS viewport (minus the reserved row's 12px insets), never on
  // the phantom pill reserve (which collapsed it to a sliver).
  await gotoStage(win, 1);
  await setSize(640, 620);
  const at640 = await readDock();
  console.log(`[TFL-1157 R15 640x620] ${JSON.stringify(at640)}`);
  expect(at640.cap, '640: dock cap measured').not.toBeNull();
  expect(at640.iconOnly, '640: below the 880 rung the labels drop').toBe('true');
  expect(
    Math.abs(at640.cap - (at640.scrollerClientW - 24)),
    `640: reserved row caps on the canvas viewport (${at640.cap} vs ${at640.scrollerClientW - 24})`,
  ).toBeLessThanOrEqual(2);
  expect(at640.cap, '640: never the phantom-reserve sliver').toBeGreaterThan(200);
  assertCoreThenMore(at640, '640');
});
