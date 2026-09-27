// Gate 4 (qa) - the 1.26.0 headline features on the INSTALLED build.
//
// Launch the installed 1.26.0 app, enable Multi Mode, load two documents, and
// assert:
//   (a) exactly ONE workspace tab whose label names BOTH documents;
//   (b) with the All Tools panel open, both panes shrink by the SAME amount;
//   (c) the divider is visible with its grip;
//   (d) Help > About reports 1.26.0 with FIVE What's New highlights whose first
//       line mentions Multi Mode.
// One screenshot: screenshots/release-1260-multi-mode.png.
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
  if (app) await hardClose(app, 'release-1260-headline');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function paneMainWidth(pane) {
  return win.evaluate((p) => {
    const el = document.querySelector(`.tab-pane[data-pane="${p}"] .workspace-main`);
    return el ? Math.round(el.getBoundingClientRect().width) : null;
  }, pane);
}

test('1.26.0 headline: one composite tab, equal panel shrink, visible divider+grip; About 1.26.0 + 5 highlights', async () => {
  await twoPaneSetup(app, win);
  await win.waitForTimeout(1200);

  // (a) exactly ONE tab, label names both documents.
  const tabs = win.locator('.tab[data-tab-id]');
  const tabCount = await tabs.count();
  const tabId = await tabs.first().getAttribute('data-tab-id');
  const label = (await win.locator('.tab[data-tab-id="tf-multi-workspace"] .tab-title').innerText())
    .replace(/\s+/g, ' ').trim();
  console.log(`[release-1260] tabs=${tabCount} id=${tabId} label="${label}"`);
  expect(tabCount, 'Multi Mode shows exactly ONE tab').toBe(1);
  expect(tabId).toBe('tf-multi-workspace');
  expect(label, 'label names document A').toContain('p33-alpha');
  expect(label, 'label names document B').toContain('p33-beta');

  // (b) All Tools panel open -> both panes shrink by the same amount.
  const beforeA = await paneMainWidth('A');
  const beforeB = await paneMainWidth('B');
  await win.locator('[data-tools-badge]').first().click();
  await win.waitForSelector('[data-tools-palette]', { timeout: 10000 });
  await win.waitForTimeout(800);
  const afterA = await paneMainWidth('A');
  const afterB = await paneMainWidth('B');
  const deltaA = beforeA - afterA;
  const deltaB = beforeB - afterB;
  console.log(`[release-1260] panel open: A.main ${beforeA}->${afterA} (delta ${deltaA}); B.main ${beforeB}->${afterB} (delta ${deltaB})`);
  expect(deltaA, 'pane A shrank').toBeGreaterThan(50);
  expect(deltaB, 'pane B shrank').toBeGreaterThan(50);
  expect(Math.abs(deltaA - deltaB), `pane shrink deltas differ: A=${deltaA} B=${deltaB}`).toBeLessThanOrEqual(1);

  // (c) divider visible with its grip.
  const divider = await win.evaluate(() => {
    const d = document.querySelector('[data-multi-divider]');
    const g = document.querySelector('.multi-divider-grip');
    const vis = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    };
    const gr = g ? g.getBoundingClientRect() : null;
    const hit = gr ? document.elementFromPoint(gr.left + gr.width / 2, gr.top + gr.height / 2) : null;
    return {
      dividerVisible: vis(d),
      dividerWidth: d ? Math.round(d.getBoundingClientRect().width) : null,
      gripVisible: vis(g),
      gripOpacity: g ? getComputedStyle(g).opacity : null,
      gripW: gr ? Math.round(gr.width) : null,
      gripH: gr ? Math.round(gr.height) : null,
      gripHitInGrip: hit !== null && g !== null ? g.contains(hit) : false,
    };
  });
  console.log(`[release-1260] divider: ${JSON.stringify(divider)}`);
  expect(divider.dividerVisible, 'divider visible').toBe(true);
  expect(divider.dividerWidth, 'divider has a real band').toBeGreaterThanOrEqual(6);
  expect(divider.gripVisible, 'grip visible').toBe(true);
  expect(divider.gripOpacity, 'grip always visible (opacity 1)').toBe('1');
  expect(divider.gripHitInGrip, 'grip hit-testable').toBe(true);

  // ONE screenshot of the Multi Mode workspace (panel open, both panes + divider).
  await win.screenshot({ path: path.join(SHOTS, 'release-1260-multi-mode.png') });
  console.log('[release-1260] captured screenshots/release-1260-multi-mode.png');

  // (d) About: version + What's New highlights.
  await win.click('[data-menu-button]');
  await win.waitForSelector('[data-menu-popover]', { timeout: 10000 });
  await win.click('[data-menu-action="about"]');
  await win.waitForSelector('[data-about-dialog]:visible', { timeout: 15000 });

  const about = await win.evaluate(() => {
    const v = document.querySelector('[data-about-version]');
    const hl = [...document.querySelectorAll('[data-whats-new-highlight]')];
    return { version: v ? v.textContent.trim() : null, count: hl.length, texts: hl.map((h) => h.textContent.trim()) };
  });
  console.log(`[release-1260] about: ${JSON.stringify(about)}`);
  expect(about.version, 'About reports package.json version').toBe(EXPECTED);
  expect(about.version, 'About reports 1.26.0').toBe('1.26.0');
  expect(about.count, "FIVE What's New highlights").toBe(5);
  expect(about.texts[0], 'first highlight mentions Multi Mode').toMatch(/Multi Mode/);
});