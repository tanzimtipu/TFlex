// Gate 5 (qa) - the 1.25.0 headline feature on the INSTALLED build.
//
// Launch the installed 1.25.0 app, enable Multi Mode, load two documents, and
// assert both panes are visible with ONE shared toolbar and ONE All Tools
// badge. Then open Help > About and confirm it reports the package.json
// version with FIVE What's New highlights whose first line mentions Multi Mode.
// One screenshot: screenshots/release-1250-multi-mode.png.
//
// One-off release gate: lives under e2e/retests/ (not the canonical installed
// suite). Launches through the canonical e2e/lib/launch.cjs launchApp with an
// explicit installed executablePath.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose, dismissUpdatePrompt } = require('../lib/helpers.cjs');
const { SHOTS, twoPaneSetup } = require('../lib/p33_common.cjs');

const EXPECTED = require('../../package.json').version;
const INSTALLED_EXE =
  process.env.TFLEX_PACKAGED_EXE ||
  'C:\\Program Files\\Jovrel\\Jovrel.exe';

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp([], null, INSTALLED_EXE);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 40000 });
  await dismissUpdatePrompt(win);
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'release-1250-headline');
  app = null;
  win = null;
});
test.setTimeout(300000);

test('1.25.0 headline: Multi Mode two panes, one shared toolbar, one All Tools badge; About 1.25.0 + 5 highlights', async () => {
  await twoPaneSetup(app, win);
  await win.waitForTimeout(1200);

  const state = await win.evaluate(() => {
    const pane = (p) => document.querySelector(`.tab-pane[data-pane="${p}"]`);
    const visible = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none';
    };
    return {
      multi: document.querySelector('.tab-stage')?.getAttribute('data-multi-mode'),
      paneACanvas: visible(pane('A') && pane('A').querySelector('canvas.pdf-page-canvas')),
      paneBCanvas: visible(pane('B') && pane('B').querySelector('canvas.pdf-page-canvas')),
      sharedToolbars: document.querySelectorAll('[data-shared-toolbar]').length,
      sharedToolbarVisible: visible(document.querySelector('[data-shared-toolbar]')),
      badgeCount: document.querySelectorAll('[data-tools-badge]').length,
      badgeVisible: visible(document.querySelector('[data-tools-badge]')),
    };
  });
  console.log(`[release-1250] multi state: ${JSON.stringify(state)}`);

  expect(state.multi, 'Multi Mode enabled').toBe('true');
  expect(state.paneACanvas, 'pane A canvas visible').toBe(true);
  expect(state.paneBCanvas, 'pane B canvas visible').toBe(true);
  expect(state.sharedToolbars, 'exactly one shared toolbar').toBe(1);
  expect(state.sharedToolbarVisible, 'shared toolbar visible').toBe(true);
  expect(state.badgeCount, 'exactly one All Tools badge').toBe(1);
  expect(state.badgeVisible, 'All Tools badge visible').toBe(true);

  await win.screenshot({ path: path.join(SHOTS, 'release-1250-multi-mode.png') });
  console.log('[release-1250] captured screenshots/release-1250-multi-mode.png');

  // About: version + What's New highlights.
  await win.click('[data-menu-button]');
  await win.waitForSelector('[data-menu-popover]', { timeout: 10000 });
  await win.click('[data-menu-action="about"]');
  await win.waitForSelector('[data-about-dialog]:visible', { timeout: 15000 });

  const about = await win.evaluate(() => {
    const v = document.querySelector('[data-about-version]');
    const hl = [...document.querySelectorAll('[data-whats-new-highlight]')];
    return {
      version: v ? v.textContent.trim() : null,
      count: hl.length,
      texts: hl.map((h) => h.textContent.trim()),
    };
  });
  console.log(`[release-1250] about: ${JSON.stringify(about)}`);

  expect(about.version, 'About reports package.json version').toBe(EXPECTED);
  expect(about.version, 'About reports 1.25.0').toBe('1.25.0');
  expect(about.count, "FIVE What's New highlights").toBe(5);
  expect(about.texts[0], "first highlight mentions Multi Mode").toMatch(/Multi Mode/);
});
