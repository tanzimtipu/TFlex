// Phase 94D — before/after icon evidence capture.
// Captures the four named screens (welcome empty state, editor chrome,
// Preferences dialog, command-palette panel) in both themes through the
// canonical dev-build launcher. Output dir is overridable via PHASE94_SHOTS so
// the same spec can capture the HEAD baseline from a worktree.
const { test } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

// The Paperclip harness exports ELECTRON_RUN_AS_NODE=1; launchApp spreads
// process.env into the Electron child, which then exits as plain Node before any
// window is observable. Drop it before any launch.
delete process.env.ELECTRON_RUN_AS_NODE;

const OUT = process.env.PHASE94_SHOTS
  ? path.resolve(process.env.PHASE94_SHOTS)
  : path.join(__dirname, 'screenshots', 'phase94', 'after');
fs.mkdirSync(OUT, { recursive: true });
test.setTimeout(240000);

// Phase 127 restored the v1.50.0 chrome; the File menu's "Toggle Theme" row
// cycles frosted -> dark -> light until the requested theme is live.
async function setTheme(win, theme) {
  for (let i = 0; i < 4; i += 1) {
    if ((await win.evaluate(() => document.documentElement.getAttribute('data-theme'))) === theme) return;
    await win.locator('[data-menu-button]').first().click();
    await win.waitForSelector('[data-menu-popover]', { state: 'visible', timeout: 8000 });
    await win.locator('[data-menu-popover] [data-menu-action="toggleTheme"]').first().click();
    await win.waitForTimeout(700);
  }
  const now = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (now !== theme) throw new Error(`setTheme: could not reach '${theme}' (stuck at '${now}')`);
}

// Phase 127 restored the title-bar gear `[data-open-preferences]`; it opens the
// Preferences sheet `[data-prefs-dialog]`.
async function openPreferences(win) {
  await win.locator('[data-open-preferences]').first().click();
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 8000 });
}

async function openDoc(app, win) {
  const p = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
  }, p);
  await win.locator('[data-home-tool="open"]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(900);
}

for (const theme of ['light', 'dark']) {
  test(`Phase 94 icon evidence — ${theme}`, async () => {
    const app = await launchApp();
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });

    await setTheme(win, theme);
    await win.screenshot({ path: path.join(OUT, `welcome-${theme}.png`) });

    await openDoc(app, win);
    await win.screenshot({ path: path.join(OUT, `editor-${theme}.png`) });

    await openPreferences(win);
    await win.waitForTimeout(500);
    await win.locator('[data-prefs-dialog]').screenshot({
      path: path.join(OUT, `preferences-${theme}.png`),
    });
    await win.keyboard.press('Escape');
    await win.waitForSelector('[data-prefs-dialog]', { state: 'detached', timeout: 8000 }).catch(() => {});
    await win.waitForTimeout(400);

    await win.keyboard.press('Control+k');
    await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
    await win.waitForTimeout(500);
    await win.screenshot({ path: path.join(OUT, `panel-${theme}.png`) });
    await win.keyboard.press('Escape');

    await hardClose(app, `p94-${theme}`);
  });
}

const { expect } = require('@playwright/test');

// Criterion 5 — spot-check representative controls keep an accessible name and
// the wrapper's glyph defaults to aria-hidden / focusable=false.
const A11Y_SELECTORS = [
  ['dock verb (toolbar button)', '[data-dock-verb="rotate"]'],
  ['side-rail tab', '.rail-tab'],
  ['panel view toggle (outline)', '[data-context-panel-view-tab="outline"]'],
  ['palette search input', '[data-command-palette-input]'],
];

test('Phase 94 icon accessibility — controls keep names, glyphs decorative', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openDoc(app, win);

  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { timeout: 8000 });
  const rows = await win.evaluate((list) => list.map(([label, sel]) => {
    const el = document.querySelector(sel);
    if (!el) return { label, sel, found: false };
    const svg = el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg');
    return {
      label, sel, found: true,
      ariaLabel: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      text: (el.textContent || '').trim().slice(0, 40),
      placeholder: el.getAttribute('placeholder'),
      svg: svg ? {
        ariaHidden: svg.getAttribute('aria-hidden'),
        focusable: svg.getAttribute('focusable'),
        strokeWidth: svg.getAttribute('stroke-width'),
        width: svg.getAttribute('width'),
      } : null,
    };
  }), A11Y_SELECTORS);
  console.log('P94_A11Y ' + JSON.stringify(rows));
  for (const r of rows) {
    expect(r.found, `${r.label} (${r.sel}) present`).toBe(true);
    expect(
      (r.ariaLabel || r.title || r.placeholder || r.text || '').trim().length,
      `${r.label} keeps an accessible name`,
    ).toBeGreaterThan(0);
    if (r.svg) {
      expect(r.svg.ariaHidden, `${r.label} glyph is decorative (aria-hidden)`).toBe('true');
      expect(r.svg.focusable, `${r.label} glyph focusable=false`).toBe('false');
      expect(Number(r.svg.width), `${r.label} rendered size token >= 18px chrome floor`).toBeGreaterThanOrEqual(18);
    }
  }

  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);
  await openPreferences(win);
  const closeInfo = await win.evaluate(() => {
    const el = document.querySelector('[data-prefs-dialog] .sheet-close');
    if (!el) return null;
    const svg = el.querySelector('svg');
    return { ariaLabel: el.getAttribute('aria-label'), svgAriaHidden: svg ? svg.getAttribute('aria-hidden') : null };
  });
  console.log('P94_A11Y_DIALOG ' + JSON.stringify(closeInfo));
  expect(closeInfo, 'dialog close button present').not.toBeNull();
  expect((closeInfo.ariaLabel || '').length, 'dialog close keeps aria-label').toBeGreaterThan(0);

  await hardClose(app, 'p94-a11y');
});
