// TFL-1582 run-by-hand visual verification harness (frontend-dev).
// NOT a vitest spec (the config only includes *.test.ts/tsx), so this file is
// inert for `npm run test:unit`; it is a run-by-hand evidence harness, like the
// def267_inapp_verify.cjs / phase23 *.measure.cjs scripts beside it.
//
// It launches the dev build through the canonical e2e launcher
// (e2e/lib/launch.cjs, imported read-only - this file lives outside e2e/ and
// does not modify it), opens a sample, ensures the Pages context panel is
// expanded, then screenshots the panel header with the three new labelled,
// equally-sized buttons in light and dark themes and at several panel widths.
// It logs each button's present/text/measured width so equal-sizing and
// shrink behaviour are observable without trusting the image alone.
//
// Run (after `npm.cmd run build`):
//   node test/unit/renderer/tfl1582_pagesHeader_verify.cjs
const path = require('node:path');
const REPO = path.resolve(__dirname, '..', '..', '..');
const { launchApp } = require(path.join(REPO, 'e2e', 'lib', 'launch.cjs'));
const {
  openSample,
  ensurePanelExpanded,
  setTheme,
  hardClose,
} = require(path.join(REPO, 'e2e', 'lib', 'helpers.cjs'));

const SHOTS = path.join(REPO, 'screenshots');
const HOOKS = [
  '[data-context-panel-layout-split]',
  '[data-context-panel-combine]',
  '[data-blank-scan-open]',
];

const log = (label, obj) => console.log(`[TFL1582|${label}] ${JSON.stringify(obj)}`);

async function measure(win) {
  return win.evaluate((hooks) => {
    const panel = document.querySelector('.context-panel');
    const panelW = panel ? Math.round(panel.getBoundingClientRect().width) : null;
    const group = document.querySelector('.context-panel-page-actions');
    const buttons = hooks.map((s) => {
      const el = document.querySelector(s);
      if (!el) return { hook: s, present: false };
      const r = el.getBoundingClientRect();
      const label = el.querySelector('.context-panel-page-action-label');
      return {
        hook: s,
        present: true,
        text: (el.textContent || '').trim(),
        width: Math.round(r.width),
        height: Math.round(r.height),
        truncated: label ? label.scrollWidth > label.clientWidth + 1 : false,
      };
    });
    const rows = group
      ? new Set([...group.children].map((c) => c.getBoundingClientRect().top)).size
      : null;
    const header = document.querySelector('.context-panel-header');
    const chevron = document.querySelector('.context-panel-header [data-rail-collapse]');
    const hb = header ? header.getBoundingClientRect() : null;
    const gb = group ? group.getBoundingClientRect() : null;
    const cb = chevron ? chevron.getBoundingClientRect() : null;
    return {
      panelW,
      rows,
      header: hb ? { l: Math.round(hb.left), r: Math.round(hb.right), w: Math.round(hb.width) } : null,
      group: gb ? { l: Math.round(gb.left), r: Math.round(gb.right), w: Math.round(gb.width) } : null,
      chevron: cb ? { l: Math.round(cb.left), r: Math.round(cb.right) } : null,
      groupOverflowsHeader: hb && gb ? Math.round(gb.right) > Math.round(hb.right) + 1 : null,
      chevronClipped: hb && cb ? Math.round(cb.right) > Math.round(hb.right) + 1 : null,
      buttons,
    };
  }, HOOKS);
}

async function setPanelWidth(win, px) {
  return win.evaluate((w) => {
    const panel = document.querySelector('.context-panel');
    if (!panel) return null;
    panel.style.width = `${w}px`;
    panel.style.flex = `0 0 ${w}px`;
    return Math.round(panel.getBoundingClientRect().width);
  }, px);
}

async function main() {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  try {
    await openSample(win, 'report.pdf');
  } catch (error) {
    log('openSample', { fallback: String(error && error.message) });
    await openSample(win);
  }
  await win.waitForTimeout(800);
  await ensurePanelExpanded(win);
  await win.waitForSelector('[data-context-panel-layout-split]', { timeout: 15000 });
  await win.waitForTimeout(300);

  const header = win.locator('.context-panel-header');

  await setTheme(win, 'light');
  await win.waitForTimeout(400);
  await header.screenshot({ path: path.join(SHOTS, 'tfl1582-pages-header-light.png') });
  log('light', await measure(win));

  await setTheme(win, 'dark');
  await win.waitForTimeout(400);
  await header.screenshot({ path: path.join(SHOTS, 'tfl1582-pages-header-dark.png') });
  log('dark', await measure(win));

  await setPanelWidth(win, 240);
  await win.waitForTimeout(500);
  await header.screenshot({ path: path.join(SHOTS, 'tfl1582-pages-header-narrow.png') });
  log('narrow-240', await measure(win));

  await setPanelWidth(win, 420);
  await win.waitForTimeout(500);
  await header.screenshot({ path: path.join(SHOTS, 'tfl1582-pages-header-wide.png') });
  await win.screenshot({ path: path.join(SHOTS, 'tfl1582-window-wide.png') });
  log('wide-420', await measure(win));

  await hardClose(app);
}

main().catch((error) => {
  console.error('TFL1582 harness failed:', error);
  process.exitCode = 1;
});
