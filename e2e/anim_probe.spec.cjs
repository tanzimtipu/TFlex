// ANIM PROBE - targeted checks raised by the animation audit screenshots:
//   P1: modal stacking - is the Tools palette dimmed/covered by .modal-backdrop
//       while the Insert pages dialog is open (dialog screenshot showed it bright)?
//   P2: mid-crossfade color sampling on chrome surfaces (two-tone split question).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
let electronApp = null;
let win = null;

test.beforeEach(async () => {
  electronApp = await launchApp();
  win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});

test.afterEach(async () => {
  await hardClose(electronApp);
});

async function openReport(waitMs = 1500) {
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await win.waitForTimeout(waitMs);
}

test('P1: modal covers the tools palette (backdrop z-order + hit test)', async () => {
  test.setTimeout(120000);
  await openReport(1500);
  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
  await win.waitForTimeout(600);
  await win.click('[data-tool-id="insertPages"]');
  await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 8000 });
  await win.waitForTimeout(500);
  const probe = await win.evaluate(() => {
    const pal = document.querySelector('[data-tools-palette]');
    const r = pal.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + Math.min(r.height / 2, 300);
    const hit = document.elementFromPoint(cx, cy);
    const chain = [];
    let n = hit;
    while (n && chain.length < 6) { chain.push(n.className || n.tagName); n = n.parentElement; }
    const palZ = getComputedStyle(pal).zIndex;
    const bd = document.querySelector('.modal-backdrop');
    const bdZ = bd ? getComputedStyle(bd).zIndex : 'MISSING';
    return {
      paletteRect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) },
      hitChain: chain,
      paletteZ: palZ, backdropZ: bdZ,
      hitIsPalette: pal.contains(hit),
    };
  });
  console.log('[P1] modal-over-palette probe:', JSON.stringify(probe));
  // The dialog is open: the topmost element over the palette must NOT be the palette.
  expect(probe.hitIsPalette, 'modal backdrop must cover the open Tools palette (topmost hit)').toBe(false);

  // Screenshot for the ledger.
  await win.screenshot({ path: path.join(SHOTS, 'probe-modal-vs-palette.png') });
  await win.keyboard.press('Escape');
});

test('P2: mid-crossfade color timeline on chrome surfaces (two-tone check)', async () => {
  test.setTimeout(120000);
  await openReport(1800);
  await win.evaluate(() => {
    window.__flip = [];
    const t0 = performance.now();
    const tick = () => {
      const root = document.documentElement;
      const tb = document.querySelector('.titlebar');
      const tab = document.querySelector('.tab-active') || document.querySelector('.tab');
      const rail = document.querySelector('.side-rail') || document.querySelector('.workspace');
      const row = { t: Math.round(performance.now() - t0) };
      if (tb) row.titlebar = getComputedStyle(tb).backgroundColor;
      if (tab) row.tab = getComputedStyle(tab).backgroundColor;
      if (rail) row.rail = getComputedStyle(rail).backgroundColor;
      row.transitioning = root.classList.contains('tf-theme-transitioning');
      row.theme = root.getAttribute('data-theme');
      window.__flip.push(row);
      if (performance.now() - t0 < 800) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click('[data-theme-option="dark"]');
  await win.waitForTimeout(900);
  const flip = await win.evaluate(() => window.__flip);
  const pick = (arr, frac) => arr[Math.min(arr.length - 1, Math.floor(arr.length * frac))];
  console.log('[P2] start:', JSON.stringify(flip[0]));
  console.log('[P2] ~25%:', JSON.stringify(pick(flip, 0.25)));
  console.log('[P2] ~50%:', JSON.stringify(pick(flip, 0.5)));
  console.log('[P2] ~75%:', JSON.stringify(pick(flip, 0.75)));
  console.log('[P2] end:', JSON.stringify(flip[flip.length - 1]));
  const distinctTitlebar = [...new Set(flip.map((f) => f.titlebar))];
  console.log('[P2] titlebar distinct colors across the flip:', JSON.stringify(distinctTitlebar));
  // The titlebar must INTERPOLATE (more than 2 distinct colors) rather than snap.
  expect(distinctTitlebar.length, 'titlebar background must interpolate during the crossfade')
    .toBeGreaterThan(2);
  await win.screenshot({ path: path.join(SHOTS, 'probe-crossfade-end-dark.png') });
});