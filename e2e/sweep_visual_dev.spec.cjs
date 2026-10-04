// VISUAL SWEEP (dev build) - captures every major screen in both themes for
// look-and-feel judgment of the orange redesign: welcome/home, document open,
// tools panel, a dialog, the contextual annotation toolbar. Also dumps the
// computed design tokens (accent / semantic colors / dark surfaces) so the
// visual verdict can be checked against the spec objectively.
// Canonical launcher, dev build (no executablePath).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, runTool, armAnnotationTool } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

let electronApp = null;
let win = null;

function snap(name) {
  return win.screenshot({ path: path.join(SHOTS, name) });
}

async function readTheme() {
  return win.evaluate(() => document.documentElement.getAttribute('data-theme') || 'light');
}

async function setTheme(want) {
  const cur = await readTheme();
  if (cur !== want) {
    // 1.10.0+: the theme control is an embedded dropdown - open the
    // popover and select the explicit option (no blind toggle anymore).
    await win.click('.theme-toggle');
    await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
    await win.click(`[data-theme-option="${want}"]`);
    await win.waitForFunction(
      (w) => document.documentElement.getAttribute('data-theme') === w,
      want,
    );
  }
  await win.waitForTimeout(500);
}

async function dumpTokens(label) {
  const tokens = await win.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const pick = (name) => cs.getPropertyValue(name).trim();
    const openBtn = document.querySelector('button.open-btn, button[class*="open"], [data-open-file]');
    const out = {
      theme: document.documentElement.getAttribute('data-theme'),
      accent: pick('--accent'),
      success: pick('--success'),
      warning: pick('--warning'),
      error: pick('--error'),
      info: pick('--info'),
      bgBase: pick('--bg-base'),
      bgCanvas: pick('--bg-canvas'),
      bgRaised: pick('--bg-raised'),
      bgToolbar: pick('--bg-toolbar'),
      bgElevated: pick('--bg-elevated'),
      bgPanel: pick('--bg-panel'),
    };
    if (openBtn) {
      const bcs = getComputedStyle(openBtn);
      out.openBtnBg = bcs.backgroundColor;
      out.openBtnText = (openBtn.textContent || '').trim().slice(0, 20);
    }
    return out;
  });
  console.log(`[tokens:${label}] ${JSON.stringify(tokens)}`);
  return tokens;
}

test('VISUAL DEV: every major screen in both themes + token dump', async () => {
  test.setTimeout(240000);
  electronApp = await launchApp();
  win = await electronApp.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 20000 });

    // ---- 1. Welcome / home ----
    await setTheme('light');
    await dumpTokens('welcome-light');
    await snap('visual-dev-welcome-light.png');
    await setTheme('dark');
    await dumpTokens('welcome-dark');
    await snap('visual-dev-welcome-dark.png');

    // ---- 2. Document open (workspace) ----
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await win.locator('[data-home-tool="open"]').first().click();
    await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 20000 });
    // let page 1 render fully (avoid catching the placeholder frame)
    await win.waitForTimeout(2500);

    await setTheme('light');
    await win.waitForTimeout(600);
    await snap('visual-dev-workspace-light.png');
    await setTheme('dark');
    await win.waitForTimeout(600);
    await dumpTokens('workspace-dark');
    await snap('visual-dev-workspace-dark.png');

    // Page whiteness check in dark mode: the page canvas must be paper-white.
    const pageRgb = await win.evaluate(() => {
      const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
      const page = pane ? pane.querySelector('.pdf-page') : null;
      if (!page) return null;
      const cs = getComputedStyle(page);
      return { bg: cs.backgroundColor, cls: page.className };
    });
    console.log('[page-dark] ', JSON.stringify(pageRgb));

    // ---- 3. Tools panel (palette) ----
    // Phase 36 migration: All-tools palette retired; ContextPanel is the tools panel.
    await win.waitForSelector('[data-context-panel]', { timeout: 8000 }).catch(() => {});
    await win.waitForTimeout(400);
    await snap('visual-dev-palette-dark.png');
    await setTheme('light');
    await win.waitForTimeout(500);
    await snap('visual-dev-palette-light.png');

    // ---- 4. A dialog (Insert pages) ----
    await runTool(win, 'insertPages');
    await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 8000 });
    await win.waitForTimeout(600);
    await snap('visual-dev-dialog-light.png');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);

    await setTheme('dark');
    // The Escape above closed the DIALOG only - the palette is still open.
    // Reopen it only if it is actually closed, otherwise this click closes it.
    const palOpen2 = await win.evaluate(() => !!document.querySelector('[data-context-panel]'));
    if (!palOpen2) {
      await win.waitForSelector('[data-context-panel]', { timeout: 8000 }).catch(() => {});
    }
    await runTool(win, 'insertPages');
    await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 8000 });
    await win.waitForTimeout(600);
    await snap('visual-dev-dialog-dark.png');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);

    // ---- 5. Contextual toolbar (annotation toolbar armed) ----
    // Close any palette first.
    const paletteOpen = await win.evaluate(() => !!document.querySelector('[data-context-panel]'));
    if (paletteOpen) await win.keyboard.press('Escape');
    await win.waitForTimeout(400);
    // Phase 36 migration: the annotation tools live in the REVIEW Annotate
    // flyout now; armAnnotationTool opens it and clicks the tool.
    await armAnnotationTool(win, 'highlight');
    await win.waitForTimeout(500);
    await snap('visual-dev-contextual-dark.png');
    await setTheme('light');
    await win.waitForTimeout(500);
    await snap('visual-dev-contextual-light.png');

    await hardClose(electronApp);
  } catch (err) {
    console.log('[visual-dev] FAILED:', err.message);
    await win.screenshot({ path: path.join(SHOTS, 'visual-dev-FAILURE.png') }).catch(() => {});
    await hardClose(electronApp);
    throw err;
  }
});