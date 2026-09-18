// Phase 13 visual verification — captures screenshots of the real running app
// for comparison against the user-provided design reference image (mockup:
// borderless window, custom title bar with TFlex logo / tabs / "+" / gear /
// Open / window controls, toolbar, light + dark themes).
//
// Screenshots: screenshots/phase13-verification-*.png
// Launches ONLY through e2e/lib/launch.cjs (canonical launcher).

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;

async function setTheme(win, want) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${want}"]`);
  await win.waitForFunction(
    (w) => document.documentElement.getAttribute('data-theme') === w,
    want,
    { timeout: 5000 },
  );
}

async function openReport(electronApp, win) {
  const p = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, sample) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sample] });
  }, p);
  // Welcome-screen hero Open (Welcome.tsx:64). The header-actions Open was
  // retired in Phase 14.1; the CommandBar ([data-toolbar-open]) is not
  // mounted until a document tab exists.
  await win.locator('.welcome .btn-primary').first().click();
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .pdf-page canvas', { timeout: 30000 });
  await wait(2000);
}

test('P13-VIS: borderless title bar + toolbar + light/dark design-reference screenshots', async () => {
  test.setTimeout(240000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  // Match the design mockup's canvas (1610x977 logical px).
  await electronApp.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setSize(1610, 977);
  });
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const errors = [];
  win.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));

  // ---------- 1. Boot state (default theme), full window ----------
  const boot = await win.evaluate(() => ({
    bootTheme: document.documentElement.getAttribute('data-theme'),
    titlebar: !!document.querySelector('.titlebar'),
    brand: document.querySelector('.brand-mark')?.textContent || null,
    menuButton: !!document.querySelector('[data-menu-button]'),
    gear: !!document.querySelector('.header-gear'),
    themeToggle: !!document.querySelector('[data-theme-toggle]'),
    openBtn: !!document.querySelector('.welcome .btn-primary'),
    winControls: ['minimize', 'maximize', 'close'].map((k) => ({
      k,
      present: !!document.querySelector(`[data-window-${k}]`),
      label: document.querySelector(`[data-window-${k}]`)?.getAttribute('aria-label'),
    })),
    tabCount: document.querySelectorAll('.tab-list .tab-title').length,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    openBg: getComputedStyle(document.querySelector('.welcome .btn-primary')).backgroundColor,
    updateIndicator: (() => {
      const el = document.querySelector('.update-indicator');
      return el ? { cls: el.className, text: (el.innerText || '').trim() } : null;
    })(),
  }));
  console.log(`[boot] ${JSON.stringify(boot)}`);
  expect(boot.titlebar, 'custom title bar must exist').toBe(true);
  expect(boot.menuButton, 'hamburger menu button must exist').toBe(true);
  expect(boot.gear, 'settings gear must exist').toBe(true);
  expect(boot.themeToggle, 'theme toggle must exist').toBe(true);
  expect(boot.openBtn, 'Open primary button must exist').toBe(true);
  for (const c of boot.winControls) {
    expect(c.present, `window ${c.k} control must exist`).toBe(true);
    expect(c.label, `window ${c.k} control must be labelled`).toBeTruthy();
  }
  expect(boot.accent, 'accent token must be the professional blue').toBe('#2563eb');
  expect(boot.openBg, 'Open button must be filled with the blue accent').toBe('rgb(37, 99, 235)');
  await win.screenshot({ path: path.join(SHOTS, 'phase13-verification-01-welcome-boot.png') });

  // ---------- 2. Light-theme workspace (design reference is a light workspace) ----------
  await setTheme(win, 'light');
  await openReport(electronApp, win);

  const lightProbe = await win.evaluate(() => ({
    dataTheme: document.documentElement.getAttribute('data-theme'),
    htmlBg: getComputedStyle(document.documentElement).backgroundColor,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    // Workspace state: the accent Open is the CommandBar button
    // ([data-toolbar-open], CommandBar.tsx:197-211).
    openBg: getComputedStyle(document.querySelector('[data-toolbar-open]')).backgroundColor,
    iconOnly: (() => {
      const scan = (scope) => Array.from(document.querySelectorAll(`${scope} button`)).map((b) => ({
        label: b.getAttribute('aria-label'),
        title: b.getAttribute('title'),
        innerText: (b.innerText || '').trim(),
        // The CommandBar's leading Open action is a labelled primary button
        // (Phase 14.2 FIX 3), unlike the icon-only tool buttons around it.
        primary: b.matches('.btn-primary'),
      }));
      return {
        main: scan('.toolbar'),
        ann: scan('.ann-toolbar'),
        labelSpans: document.querySelectorAll('.tool-btn-label, .btn-label').length,
      };
    })(),
  }));
  console.log(`[light] ${JSON.stringify({ ...lightProbe, main: `${lightProbe.iconOnly.main.length} btns`, ann: `${lightProbe.iconOnly.ann.length} btns` })}`);
  expect(lightProbe.dataTheme).toBe('light');
  expect(lightProbe.accent).toBe('#2563eb');
  for (const b of [...lightProbe.iconOnly.main, ...lightProbe.iconOnly.ann]) {
    expect(b.label, 'every toolbar button must have an aria-label').toBeTruthy();
    expect(b.title, 'every toolbar button must have a title tooltip').toBeTruthy();
    // The command bar's primary Open action is a labelled button by design
    // (Phase 14.2 FIX 3); every other toolbar button stays icon-only.
    if (!b.primary) {
      expect(b.innerText, 'icon-only toolbar: buttons must not render text').toBe('');
    }
  }
  const primaryOpen = lightProbe.iconOnly.main.find((b) => b.primary);
  expect(primaryOpen, 'the labelled primary Open action must be in the command bar').toBeTruthy();
  expect(primaryOpen.innerText, 'the primary Open action is labelled (Phase 14.2 FIX 3)').toBe('Open');
  expect(lightProbe.iconOnly.labelSpans, 'no text label spans may exist in toolbars').toBe(0);

  await win.screenshot({ path: path.join(SHOTS, 'phase13-verification-02-workspace-light.png') });
  await win.locator('.titlebar').first().screenshot({ path: path.join(SHOTS, 'phase13-verification-03-titlebar-light.png') });
  await win.locator('.toolbar').first().screenshot({ path: path.join(SHOTS, 'phase13-verification-04-toolbar-light.png') });
  await win.locator('.ann-toolbar').first().screenshot({ path: path.join(SHOTS, 'phase13-verification-05-annotation-toolbar-light.png') });

  // ---------- 3. Tools palette (compare against reference Tools panel) ----------
  await win.click('[data-tools-toggle]');
  await wait(500);
  const palette = await win.evaluate(() => {
    const el = document.querySelector('.tools-palette, [data-tools-palette]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { visible: el.offsetParent !== null, cls: el.className, w: Math.round(r.width), h: Math.round(r.height) };
  });
  console.log(`[palette] ${JSON.stringify(palette)}`);
  expect(palette, 'More (ellipsis) must open the Tools palette').not.toBeNull();
  expect(palette.visible).toBe(true);
  await win.screenshot({ path: path.join(SHOTS, 'phase13-verification-06-tools-palette-light.png') });
  await win.keyboard.press('Escape');
  await wait(300);

  // ---------- 4. Dark theme workspace ----------
  await setTheme(win, 'dark');
  await wait(600);
  const darkProbe = await win.evaluate(() => ({
    dataTheme: document.documentElement.getAttribute('data-theme'),
    htmlBg: getComputedStyle(document.documentElement).backgroundColor,
    accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
  }));
  console.log(`[dark] ${JSON.stringify(darkProbe)}`);
  expect(darkProbe.dataTheme).toBe('dark');
  await win.screenshot({ path: path.join(SHOTS, 'phase13-verification-07-workspace-dark.png') });
  await win.locator('.titlebar').first().screenshot({ path: path.join(SHOTS, 'phase13-verification-08-titlebar-dark.png') });

  // ---------- 5. Frosted theme workspace (boot default) ----------
  await setTheme(win, 'frosted');
  await wait(600);
  const frostedProbe = await win.evaluate(() => ({
    dataTheme: document.documentElement.getAttribute('data-theme'),
    htmlBg: getComputedStyle(document.documentElement).backgroundColor,
  }));
  console.log(`[frosted] ${JSON.stringify(frostedProbe)}`);
  expect(frostedProbe.dataTheme).toBe('frosted');
  await win.screenshot({ path: path.join(SHOTS, 'phase13-verification-09-workspace-frosted.png') });

  // ---------- 6. Emoji scan (icon set rule) ----------
  const emojiScan = await win.evaluate(() => {
    const re = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;
    const hits = [];
    for (const ch of document.body.innerText || '') if (re.test(ch)) hits.push(`body:"${ch}"`);
    document.querySelectorAll('[title],[aria-label]').forEach((el) => {
      for (const attr of ['title', 'aria-label']) {
        for (const ch of el.getAttribute(attr) || '') if (re.test(ch)) hits.push(`${attr}:"${ch}"`);
      }
    });
    return hits;
  });
  console.log(`[emoji] hits=${JSON.stringify(emojiScan)}`);
  expect(emojiScan, 'no emoji characters in the chrome').toEqual([]);

  expect(errors, 'no page errors during the visual sweep').toEqual([]);
  await hardClose(electronApp, 'p13-vis');
});