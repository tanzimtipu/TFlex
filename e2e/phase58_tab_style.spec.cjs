// Phase 58 (chunk 2) — COLORFUL tab style + Preferences "Tab style" toggle.
//
// Verifies the one assigned behaviour:
//   - with tabStyle='colorful' every tab is UNIFORM size (identical height and
//     min-width, active or not), the fill is FLAT (no inset/emboss/reflection
//     highlight on the active tab), and the silhouette is the reference one
//     (rounded top corners, straight sides, small outward bottom-right flare).
//   - switching Preferences "Tab style" to Standard restores the classic tabs
//     and the choice persists across an app relaunch.
//
// Launches only through the canonical launchApp helper. The persistence check
// relaunches with the SAME --user-data-dir so settings.json survives.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { switchTheme } = require('./lib/p33_common.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const USER_DATA = path.join(os.tmpdir(), `tflex-p58-tabstyle-${Date.now()}`);

test.setTimeout(300000);

async function openBundledSample(app, win, sampleName) {
  const p = getSamplePath(sampleName);
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(1400);
}

async function openPrefs(win) {
  await win.locator('[data-open-preferences]').first().click();
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
  await win.waitForSelector('[data-prefs-tab-style]', { state: 'visible', timeout: 10000 });
}

async function closePrefs(win) {
  await win.locator('[data-prefs-dialog] .sheet-close').first().click();
  await win.waitForSelector('[data-prefs-dialog]', { state: 'hidden', timeout: 10000 });
}

test('colorful tabs are uniform + flat with the reference silhouette; Standard toggle persists', async () => {
  // ---- Launch 1: open two bundled samples, verify colorful, toggle Standard.
  let app = await launchApp([], USER_DATA);
  let win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);

  // 1. Two bundled sample documents -> >= 2 tabs.
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
  await openBundledSample(app, win, 'long.pdf');
  await expect(win.locator('[data-tab-id]')).toHaveCount(2, { timeout: 30000 });

  // Colorful is the default style.
  expect(await win.locator('.tab-area').getAttribute('data-tab-style')).toBe('colorful');

  // 2. Uniform size: identical height (max-min <= 0.5px) and identical minWidth.
  const metrics = await win.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
    return tabs.map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const before = getComputedStyle(el, '::before');
      return {
        id: el.getAttribute('data-tab-id'),
        active: el.getAttribute('aria-selected') === 'true',
        height: r.height,
        width: r.width,
        minWidth: cs.minWidth,
        boxShadow: cs.boxShadow,
        beforeTopLeft: before.borderTopLeftRadius,
        beforeTopRight: before.borderTopRightRadius,
        beforeBottomLeft: before.borderBottomLeftRadius,
        beforeBottomRight: before.borderBottomRightRadius,
      };
    });
  });
  console.log(`[P58-tab] metrics=${JSON.stringify(metrics)}`);
  const heights = metrics.map((m) => m.height);
  const hMax = Math.max(...heights);
  const hMin = Math.min(...heights);
  expect(hMax - hMin, `tab heights uniform (max=${hMax} min=${hMin})`).toBeLessThanOrEqual(0.5);
  const minWidths = new Set(metrics.map((m) => m.minWidth));
  expect(minWidths.size, `identical minWidth across tabs (${[...minWidths].join(',')})`).toBe(1);

  // Active tab height equals an inactive tab height.
  const active = metrics.find((m) => m.active);
  const inactive = metrics.find((m) => !m.active);
  expect(active, 'an active tab exists').toBeTruthy();
  expect(inactive, 'an inactive tab exists').toBeTruthy();
  expect(Math.abs(active.height - inactive.height), 'active height == inactive height').toBeLessThanOrEqual(0.5);

  // 3. No reflection: active tab box-shadow must not contain "inset".
  console.log(`[P58-tab] active boxShadow="${active.boxShadow}"`);
  expect(active.boxShadow.toLowerCase()).not.toContain('inset');

  // 3b. DEF-409 — the LAST tab's bottom-right is an OUTWARD flare, not an
  // inward convex corner. The body fill (::before) is square at the foot and
  // a decorative `.tab-flare` sits flush with the straight right edge at its
  // top and sweeps OUTWARD to the right as it falls to the strip, so the
  // flare's right edge extends BEYOND the tab's right edge.
  const lastTab = win.locator('[data-tab-id]').last();
  const flare = lastTab.locator('.tab-flare');
  await expect(flare, 'last tab has exactly one .tab-flare').toHaveCount(1);
  const flareGeom = await win.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
    const el = tabs[tabs.length - 1];
    const flareEl = el.querySelector('.tab-flare');
    const tr = el.getBoundingClientRect();
    const fr = flareEl.getBoundingClientRect();
    const fs = getComputedStyle(flareEl);
    const before = getComputedStyle(el, '::before');
    return {
      tabRight: tr.right,
      tabBottom: tr.bottom,
      flareRight: fr.right,
      flareBottom: fr.bottom,
      flareWidth: fr.width,
      flareHeight: fr.height,
      position: fs.position,
      pointerEvents: fs.pointerEvents,
      backgroundImage: fs.backgroundImage,
      beforeBottomRight: before.borderBottomRightRadius,
      beforeBottomLeft: before.borderBottomLeftRadius,
    };
  });
  console.log(`[P58-tab] flareGeom=${JSON.stringify(flareGeom)}`);
  // Body foot is square (no inward convex bottom-right corner).
  expect(flareGeom.beforeBottomRight, 'body ::before bottom-right radius is square').toBe('0px');
  expect(flareGeom.beforeBottomLeft, 'body ::before bottom-left radius is square').toBe('0px');
  // The flare is a real painted, out-of-flow, non-interactive element.
  expect(flareGeom.position, 'flare is absolutely positioned').toBe('absolute');
  expect(flareGeom.pointerEvents, 'flare is non-interactive').toBe('none');
  expect(flareGeom.backgroundImage, 'flare paints a radial gradient').toContain('radial-gradient');
  // It widens the tab's foot OUTWARD: flare right edge is beyond the tab's.
  expect(flareGeom.flareRight, `flare right (${flareGeom.flareRight}) extends past tab right (${flareGeom.tabRight})`).toBeGreaterThan(flareGeom.tabRight + 1);
  // It sits on the strip: flare bottom aligns with the tab bottom.
  expect(Math.abs(flareGeom.flareBottom - flareGeom.tabBottom), 'flare bottom sits on the strip').toBeLessThanOrEqual(1);

  // 3c. ZOOMED evidence of a single last tab. A transform scale on the strip
  // (transform-origin top-left) magnifies the tab without reflowing the app.
  // The flare sits at right:-6px (outside the tab's own box), so the capture
  // clip is the union of the tab and its flare, plus a small margin.
  await win.evaluate(() => {
    const area = document.querySelector('.tab-area');
    area.style.transformOrigin = 'top left';
    area.style.transform = 'scale(4)';
  });
  await win.waitForTimeout(300);
  const clip = await win.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
    const el = tabs[tabs.length - 1];
    const flareEl = el.querySelector('.tab-flare');
    const tr = el.getBoundingClientRect();
    const fr = flareEl.getBoundingClientRect();
    const m = 4;
    const x = Math.min(tr.left, fr.left) - m;
    const y = Math.min(tr.top, fr.top) - m;
    const right = Math.max(tr.right, fr.right) + m;
    const bottom = Math.max(tr.bottom, fr.bottom) + m;
    return { x, y, width: right - x, height: bottom - y };
  });
  console.log(`[P58-tab] flareClip=${JSON.stringify(clip)}`);
  await win.screenshot({ path: path.join(SHOTS, 'p58-tab-flare-retest.png'), clip });
  await win.evaluate(() => {
    const area = document.querySelector('.tab-area');
    area.style.transform = '';
    area.style.transformOrigin = '';
  });
  await win.waitForTimeout(200);

  // 4. Screenshots: colorful light + dark.
  await switchTheme(win, 'light');
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(SHOTS, 'p58-tab-colourful-light.png') });
  await win.locator('.tab-area').screenshot({ path: path.join(SHOTS, 'p58-tab-strip-colourful-light.png') });
  await switchTheme(win, 'dark');
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(SHOTS, 'p58-tab-colourful-dark.png') });
  await win.locator('.tab-area').screenshot({ path: path.join(SHOTS, 'p58-tab-strip-colourful-dark.png') });

  // 5. Preferences -> Standard restores classic tabs; screenshot in light.
  await switchTheme(win, 'light');
  await win.waitForTimeout(400);
  await openPrefs(win);
  await win.locator('[data-prefs-tab-style]').selectOption('standard');
  await win.waitForTimeout(500);
  expect(await win.locator('.tab-area').getAttribute('data-tab-style')).toBe('standard');
  await closePrefs(win);
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SHOTS, 'p58-tab-standard-light.png') });
  await win.locator('.tab-area').screenshot({ path: path.join(SHOTS, 'p58-tab-strip-standard-light.png') });

  // Set it back to colorful; the attribute returns.
  await openPrefs(win);
  await win.locator('[data-prefs-tab-style]').selectOption('colorful');
  await win.waitForTimeout(500);
  expect(await win.locator('.tab-area').getAttribute('data-tab-style')).toBe('colorful');
  await closePrefs(win);

  await hardClose(app, 'p58-tab-1');
  app = null;
  win = null;

  // ---- Launch 2: same userData -> the stored choice survives.
  app = await launchApp([], USER_DATA);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
  await openPrefs(win);
  const persisted = await win.locator('[data-prefs-tab-style]').inputValue();
  console.log(`[P58-tab] persisted tabStyle after relaunch="${persisted}"`);
  expect(persisted).toBe('colorful');
  await closePrefs(win);
  await hardClose(app, 'p58-tab-2');
});
