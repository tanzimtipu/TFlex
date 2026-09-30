// Phase 58 (chunk 2) — COLORFUL tab style + Preferences "Tab style" toggle.
// Repointed by qa (Phase 62, TFL-63) to the Phase 62 colorful silhouette.
//
// Verifies the one assigned behaviour:
//   - with tabStyle='colorful' every tab is UNIFORM size (identical 26px height
//     and min-width, active or not), the fill is FLAT (no inset/emboss/reflection
//     highlight on the active tab), and the silhouette is the Phase 62 chip: one
//     uniform non-zero corner radius (--radius-2 = 5px) on all four corners of an
//     inactive tab, while the ACTIVE tab squares its two BOTTOM corners so its
//     fill runs flush into the canvas with no separator. The Phase 58 / DEF-409
//     outward `.tab-flare` is retired (phase 62 supersedes it).
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

// Phase 62 zoomed evidence: magnify `.tab-area` in place (transform-origin
// top-left) so the tab's silhouette is inspectable without reflowing the app,
// capture the indexed `[data-tab-id]` box plus a small margin that includes the
// canvas seam under the active tab, then restore the strip.
async function captureZoomedTab(win, index, file) {
  await win.evaluate(() => {
    const area = document.querySelector('.tab-area');
    area.style.transformOrigin = 'top left';
    area.style.transform = 'scale(4)';
  });
  await win.waitForTimeout(300);
  const clip = await win.evaluate((idx) => {
    const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
    const r = tabs[idx].getBoundingClientRect();
    const m = 8;
    return { x: r.left - m, y: r.top - m, width: r.width + 2 * m, height: r.height + 2 * m };
  }, index);
  console.log(`[P62-tab] zoom clip ${file}=${JSON.stringify(clip)}`);
  await win.screenshot({ path: path.join(SHOTS, file), clip });
  await win.evaluate(() => {
    const area = document.querySelector('.tab-area');
    area.style.transform = '';
    area.style.transformOrigin = '';
  });
  await win.waitForTimeout(150);
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
  console.log(`[P62-tab] metrics=${JSON.stringify(metrics)}`);

  // Criterion 1 — every colorful tab is 26px high, measured boxes with zero
  // variance across tabs (active and inactive alike).
  const TAB_HEIGHT = 26;
  for (const m of metrics) {
    console.log(`[P62-tab] ${m.id} height=${m.height} active=${m.active}`);
    expect(
      Math.abs(m.height - TAB_HEIGHT),
      `tab ${m.id} is ${TAB_HEIGHT}px high (got ${m.height})`,
    ).toBeLessThanOrEqual(0.5);
  }
  const heights = metrics.map((m) => m.height);
  const hMax = Math.max(...heights);
  const hMin = Math.min(...heights);
  expect(hMax - hMin, `tab heights uniform (max=${hMax} min=${hMin})`).toBeLessThanOrEqual(0.5);

  // Uniform size: identical minWidth across tabs.
  const minWidths = new Set(metrics.map((m) => m.minWidth));
  expect(minWidths.size, `identical minWidth across tabs (${[...minWidths].join(',')})`).toBe(1);

  const active = metrics.find((m) => m.active);
  const inactive = metrics.find((m) => !m.active);
  expect(active, 'an active tab exists').toBeTruthy();
  expect(inactive, 'an inactive tab exists').toBeTruthy();
  expect(Math.abs(active.height - inactive.height), 'active height == inactive height').toBeLessThanOrEqual(0.5);

  // Criterion 1 — one uniform non-zero corner radius (--radius-2 = 5px) on the
  // body fill. The ACTIVE tab squares its two BOTTOM corners so its fill can run
  // into the canvas; the INACTIVE tab keeps all four rounded.
  const RADIUS = '5px';
  console.log(`[P62-tab] active ::before radii tl=${active.beforeTopLeft} tr=${active.beforeTopRight} bl=${active.beforeBottomLeft} br=${active.beforeBottomRight}`);
  expect(active.beforeTopLeft, 'active top-left rounded').toBe(RADIUS);
  expect(active.beforeTopRight, 'active top-right rounded').toBe(RADIUS);
  expect(active.beforeBottomLeft, 'active bottom-left square').toBe('0px');
  expect(active.beforeBottomRight, 'active bottom-right square').toBe('0px');
  console.log(`[P62-tab] inactive ::before radii tl=${inactive.beforeTopLeft} tr=${inactive.beforeTopRight} bl=${inactive.beforeBottomLeft} br=${inactive.beforeBottomRight}`);
  expect(inactive.beforeTopLeft, 'inactive top-left rounded').toBe(RADIUS);
  expect(inactive.beforeTopRight, 'inactive top-right rounded').toBe(RADIUS);
  expect(inactive.beforeBottomLeft, 'inactive bottom-left rounded').toBe(RADIUS);
  expect(inactive.beforeBottomRight, 'inactive bottom-right rounded').toBe(RADIUS);

  // Keep the flat-fill check: active tab box-shadow must not contain "inset".
  console.log(`[P62-tab] active boxShadow="${active.boxShadow}"`);
  expect(active.boxShadow.toLowerCase(), 'active fill is flat (no inset)').not.toContain('inset');

  // Criterion 2 — the DEF-409 outward flare is retired: no `.tab-flare` node.
  const lastTab = win.locator('[data-tab-id]').last();
  await expect(lastTab.locator('.tab-flare'), 'no .tab-flare node on the last tab').toHaveCount(0);

  // Criterion 3 — the active tab is flush with the canvas and no separator is
  // painted between them (the shared ink underline computes to `content: none`).
  const flush = await win.evaluate(() => {
    const activeEl = document.querySelector('[data-tab-id][aria-selected="true"]');
    const main = document.querySelector('.app-main');
    const after = getComputedStyle(activeEl, '::after');
    return {
      activeBottom: activeEl.getBoundingClientRect().bottom,
      mainTop: main.getBoundingClientRect().top,
      afterContent: after.content,
    };
  });
  console.log(`[P62-tab] flush=${JSON.stringify(flush)}`);
  expect(
    Math.abs(flush.activeBottom - flush.mainTop),
    `active tab foot (${flush.activeBottom}) sits on the canvas top (${flush.mainTop})`,
  ).toBeLessThanOrEqual(1);
  expect(flush.afterContent, 'active tab ::after underline suppressed').toBe('none');

  const activeIdx = metrics.findIndex((m) => m.active);
  const inactiveIdx = metrics.findIndex((m) => !m.active);

  // Criterion 4 — screenshots: colorful light + strip + zoomed active/inactive.
  await switchTheme(win, 'light');
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(SHOTS, 'p62-tab-colorful-light.png') });
  await win.locator('.tab-area').screenshot({ path: path.join(SHOTS, 'p62-tab-strip-light.png') });
  await captureZoomedTab(win, activeIdx, 'p62-tab-zoom-active-light.png');
  await captureZoomedTab(win, inactiveIdx, 'p62-tab-zoom-inactive-light.png');

  // Criterion 3 (dark) — the same flush-into-canvas evidence in the dark theme.
  await switchTheme(win, 'dark');
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(SHOTS, 'p62-tab-colorful-dark.png') });
  await win.locator('.tab-area').screenshot({ path: path.join(SHOTS, 'p62-tab-strip-dark.png') });
  await captureZoomedTab(win, activeIdx, 'p62-tab-zoom-active-dark.png');

  // Criterion 5 — Preferences -> Standard restores the classic tabs; screenshot in light.
  await switchTheme(win, 'light');
  await win.waitForTimeout(400);
  await openPrefs(win);
  await win.locator('[data-prefs-tab-style]').selectOption('standard');
  await win.waitForTimeout(500);
  expect(await win.locator('.tab-area').getAttribute('data-tab-style')).toBe('standard');
  await closePrefs(win);
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SHOTS, 'p62-tab-standard-light.png') });
  await win.locator('.tab-area').screenshot({ path: path.join(SHOTS, 'p62-tab-strip-standard-light.png') });

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
