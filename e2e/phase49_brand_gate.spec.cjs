// Phase 49 gate (qa) — the JOVREL in-app brand on the RUNNING dev build.
//
// The product is JOVREL (the project stays TFlex). This spec proves, against
// the real Electron app launched through the canonical e2e/lib/launch.cjs:
//   1. the title bar renders the inline JOVREL mark (svg[data-brand-mark]) and
//      the wordmark "Jovrel", with no user-visible "TFlex";
//   2. the Welcome hero, the About dialog, the account sheet and the print
//      window each render the mark + wordmark and no user-visible "TFlex";
//   3. the mark's gradient stops and the three J strokes match the shipped
//      asset assets/brand/jovrel-mark.svg;
//   4. two marks mounted on one page mint DISTINCT gradient ids and each tile
//      references its own (the unique-id contract);
//   5. the title bar renders correctly in all three themes (light/dark/frosted)
//      with one screenshot each.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, openStandalonePrintWindow, closeStandalonePrintWindow } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

// The shipped asset is the source of truth for the mark's geometry.
const ASSET = fs.readFileSync(path.join(ROOT, 'assets', 'brand', 'jovrel-mark.svg'), 'utf8');
const ASSET_PATHS = [...ASSET.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
const ASSET_STOPS = [...ASSET.matchAll(/stop-color="([^"]+)"/g)].map((m) => m[1]);

let app = null;
let win = null;
test.setTimeout(300000);

test.afterEach(async () => {
  if (app) await hardClose(app, 'p49-brand');
  app = null;
  win = null;
});

async function launch() {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  return win;
}

async function setTheme(theme) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${theme}"]`);
  await win.waitForFunction((w) => document.documentElement.getAttribute('data-theme') === w, theme);
  await win.waitForTimeout(400);
}

// Read a mounted mark's geometry + the wordmark beside it, from the app window.
async function readBrand(containerSel, markSel, wordSel) {
  return win.evaluate(({ containerSel, markSel, wordSel }) => {
    const container = document.querySelector(containerSel);
    const mark = document.querySelector(markSel);
    const word = document.querySelector(wordSel);
    const svg = mark && mark.tagName.toLowerCase() === 'svg' ? mark : null;
    const grad = svg ? svg.querySelector('linearGradient') : null;
    const rect = svg ? svg.querySelector('rect') : null;
    const group = svg ? svg.querySelector('g') : null;
    return {
      containerText: container ? (container.textContent ?? '') : null,
      markIsSvg: svg !== null,
      markHasDataAttr: mark ? mark.hasAttribute('data-brand-mark') : false,
      gradientId: grad ? grad.getAttribute('id') : null,
      stops: svg ? [...svg.querySelectorAll('linearGradient stop')].map((s) => s.getAttribute('stop-color')) : [],
      rectFill: rect ? rect.getAttribute('fill') : null,
      paths: svg ? [...svg.querySelectorAll('path')].map((p) => p.getAttribute('d')) : [],
      stroke: group ? group.getAttribute('stroke') : null,
      strokeWidth: group ? group.getAttribute('stroke-width') : null,
      word: word ? (word.textContent ?? '').trim() : null,
    };
  }, { containerSel, markSel, wordSel });
}

test('P49-1 title bar + Welcome: mark + Jovrel, asset match, unique ids, three themes', async () => {
  await launch();

  // The native window title (taskbar tooltip / Alt-Tab) reads Jovrel.
  const osTitle = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle() ?? null);
  console.log(`[P49-1 os-title] ${JSON.stringify(osTitle)}`);
  expect(osTitle, 'the main window OS title').toBe('Jovrel');

  // Title bar.
  const bar = await readBrand('.brand', '.brand svg[data-brand-mark]', '.brand .brand-wordmark');
  console.log(`[P49-1 titlebar] ${JSON.stringify(bar)}`);
  expect(bar.markIsSvg, 'title-bar mark is the inline SVG').toBe(true);
  expect(bar.markHasDataAttr, 'title-bar mark carries data-brand-mark').toBe(true);
  expect(bar.word, 'title-bar wordmark').toBe('Jovrel');
  expect(bar.containerText, 'no user-visible TFlex in the title bar').not.toContain('TFlex');

  // Asset match: gradient stops + the three J strokes.
  expect(bar.stops, 'gradient stops match the asset').toEqual(ASSET_STOPS);
  expect(bar.paths, 'the three J strokes match the asset').toEqual(ASSET_PATHS);
  expect(bar.stroke).toBe('#FFFFFF');
  expect(bar.strokeWidth).toBe('20');

  // Welcome hero.
  const welcome = await readBrand('.welcome-brand', '.welcome-brand svg[data-brand-mark]', '.welcome-brand .brand-wordmark');
  console.log(`[P49-1 welcome] ${JSON.stringify(welcome)}`);
  expect(welcome.markIsSvg, 'welcome mark is the inline SVG').toBe(true);
  expect(welcome.word, 'welcome wordmark').toBe('Jovrel');
  const welcomeText = (await win.locator('.welcome').textContent()) ?? '';
  expect(welcomeText, 'no user-visible TFlex on the Welcome screen').not.toContain('TFlex');
  expect(welcomeText).toContain('see Jovrel');

  // Two marks on one page: distinct gradient ids, each tile wired to its own.
  const marks = await win.evaluate(() =>
    [...document.querySelectorAll('svg[data-brand-mark]')].map((svg) => ({
      id: svg.querySelector('linearGradient')?.getAttribute('id') ?? null,
      fill: svg.querySelector('rect')?.getAttribute('fill') ?? null,
    })),
  );
  console.log(`[P49-1 marks] ${JSON.stringify(marks)}`);
  expect(marks.length, 'title bar + welcome marks both mounted').toBeGreaterThanOrEqual(2);
  expect(new Set(marks.map((m) => m.id)).size, 'every mark mints a distinct gradient id').toBe(marks.length);
  for (const m of marks) expect(m.fill, 'each tile references its own gradient').toBe(`url(#${m.id})`);

  // Three themes, one title-bar screenshot each.
  for (const theme of ['light', 'dark', 'frosted']) {
    await setTheme(theme);
    const shot = path.join(SHOTS, `phase49-titlebar-${theme}.png`);
    await win.locator('.app-header').screenshot({ path: shot });
    console.log(`[P49-1 shot] ${theme} -> ${shot}`);
    const themed = await readBrand('.brand', '.brand svg[data-brand-mark]', '.brand .brand-wordmark');
    expect(themed.markIsSvg, `${theme}: mark present`).toBe(true);
    expect(themed.word, `${theme}: wordmark`).toBe('Jovrel');
  }
});

test('P49-2 About dialog: mark + Jovrel, no TFlex in the brand lockup', async () => {
  await launch();
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.webContents.send('menu:action', { action: 'about' });
  });
  await win.waitForSelector('[data-about-dialog]:visible', { timeout: 15000 });

  const about = await readBrand('.sheet-about', '.about-mark[data-brand-mark]', '.about-name .brand-wordmark');
  console.log(`[P49-2 about] ${JSON.stringify(about)}`);
  expect(about.markIsSvg, 'About mark is the inline SVG').toBe(true);
  expect(about.word, 'About wordmark').toBe('Jovrel');
  const title = ((await win.locator('#about-title').textContent()) ?? '').trim();
  expect(title, 'About heading').toBe('About Jovrel');
  // Scope the "no old name" check to the brand lockup: the bundled What's New
  // HISTORY is intentionally untouched (history is history).
  const lockup =
    ((await win.locator('.sheet-about .sheet-header').textContent()) ?? '') +
    ((await win.locator('.about-name').textContent()) ?? '');
  expect(lockup, 'no user-visible TFlex in the About brand lockup').not.toContain('TFlex');
});

test('P49-3 account sheet: mark + Jovrel, no TFlex', async () => {
  await launch();
  await win.locator('[data-header-accounts]').click();
  await win.waitForSelector('.accounts-brand', { timeout: 15000 });

  const acct = await readBrand('.accounts-brand', '.accounts-brand-mark[data-brand-mark]', '.accounts-brand-name');
  console.log(`[P49-3 accounts] ${JSON.stringify(acct)}`);
  expect(acct.markIsSvg, 'account-sheet mark is the inline SVG').toBe(true);
  expect(acct.word, 'account-sheet wordmark').toBe('Jovrel');
  expect(acct.containerText, 'no user-visible TFlex in the account sheet header').not.toContain('TFlex');
});

test('P49-4 print window: mark + Jovrel, no TFlex', async () => {
  await launch();
  // Open a document so the print control is live.
  const sample = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, sample);
  await win.locator('[data-toolbar-open]').click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(800);

  const printPage = await openStandalonePrintWindow(app, win);
  const printTitle = await app.evaluate(({ BrowserWindow }) => {
    const pw = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('tfWindow=print'));
    return pw ? pw.getTitle() : null;
  });
  console.log(`[P49-4 os-title] ${JSON.stringify(printTitle)}`);
  expect(printTitle, 'the print window OS title').toBe('Print - Jovrel');
  const print = await printPage.evaluate(() => {
    const container = document.querySelector('.print-window-brand');
    const mark = document.querySelector('.print-window-brand svg[data-brand-mark]');
    const word = document.querySelector('.print-window-brand .brand-wordmark');
    return {
      containerText: container ? (container.textContent ?? '') : null,
      markIsSvg: mark !== null,
      word: word ? (word.textContent ?? '').trim() : null,
    };
  });
  console.log(`[P49-4 print] ${JSON.stringify(print)}`);
  expect(print.markIsSvg, 'print-window mark is the inline SVG').toBe(true);
  expect(print.word, 'print-window wordmark').toBe('Jovrel');
  expect(print.containerText, 'no user-visible TFlex in the print window brand').not.toContain('TFlex');
  await printPage.screenshot({ path: path.join(SHOTS, 'phase49-print-window.png') });
  await closeStandalonePrintWindow(app, printPage);
});
