// TFL-1159 (TFL-1116 C10 / R13 + R14) — the Action Dock's More vs All commands
// INTENT and the ONE `dockEligible` capability predicate.
//
// R13: More = the stage overflow PLUS "Customize dock"; the trailing global
// palette entry is no longer ambiguously labelled "Tools" — it honestly reads
// "All commands" (the canvas-level global entry is still needed). "Customize
// dock" reaches the DEDICATED eligible-tool chooser, never the global palette.
//
// R14: one `dockEligible` predicate gates the chooser rows, the pin affordance
// and pin execution; a persisted pin whose tool is only TEMPORARILY unavailable
// is retained and EXPLAINED rather than reset; customization mode has an
// explicit Done action. Menus never scroll horizontally.
//
// Launches ONLY through e2e/lib/launch.cjs.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, gotoStage } = require('./lib/helpers.cjs');

delete process.env.ELECTRON_RUN_AS_NODE;

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const DOCK = '[data-action-dock]';

let app = null;
let win = null;
test.setTimeout(240000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1159-r13r14');
  app = null;
  win = null;
});

async function openReport() {
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector(DOCK, { timeout: 30000 });
  await win.waitForTimeout(1000);
}

async function loadSettings() {
  const r = await win.evaluate(() => window.tflex.loadSettings());
  return r && r.ok ? r.value : null;
}

// Seed the persisted dockPins through the real settings writer (the app's
// `settingsChangedEvent` broadcast republishes them live).
async function seedPins(ids) {
  const s = await loadSettings();
  await win.evaluate((v) => window.tflex.saveSettings(v), { ...s, dockPins: ids, dockUnpinned: [] });
  await win.waitForTimeout(900);
}

// A menu must never scroll HORIZONTALLY (R13/R15). Returns the measured box.
function menuHScroll(selector) {
  return win.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  }, selector);
}

function assertNoHScroll(box, label) {
  expect(box, `${label}: menu present`).not.toBeNull();
  expect(box.scrollWidth, `${label}: no horizontal scroll`).toBeLessThanOrEqual(box.clientWidth + 1);
}

test('R13: More = stage overflow + Customize dock; All commands is labelled; dedicated chooser has Done', async () => {
  await openReport();
  await gotoStage(win, 3); // REVIEW
  await win.waitForTimeout(400);

  const order = await win.evaluate(() => {
    const dock = document.querySelector('[data-action-dock]');
    return Array.from(dock.querySelectorAll('[data-dock-group="primary"], [data-dock-overflow], [data-dock-tools]'))
      .map((el) => el.hasAttribute('data-dock-group') ? 'primary' : el.hasAttribute('data-dock-overflow') ? 'more' : 'all-commands');
  });
  console.log(`[TFL-1159 R13] dock order=${JSON.stringify(order)}`);
  expect(order[0], 'core stage tools come first').toBe('primary');
  expect(order.indexOf('more'), 'More follows the core tools').toBeGreaterThan(order.indexOf('primary'));
  expect(order.indexOf('all-commands'), 'All commands trails More').toBeGreaterThan(order.indexOf('more'));

  const allText = ((await win.locator('[data-dock-tools]').first().textContent()) ?? '').replace(/\s+/g, ' ').trim();
  const allAria = await win.locator('[data-dock-tools]').first().getAttribute('aria-label');
  console.log(`[TFL-1159 R13] trailing utility text="${allText}" aria="${allAria}"`);
  expect(allText, 'the trailing global entry is clearly labelled').toBe('All commands');
  expect(allAria).toBe('All commands');

  // ---- More = stage overflow + Customize dock ----
  await win.locator('[data-dock-overflow]').first().click();
  await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 8000 });
  const overflowItems = await win.$$eval('[data-dock-overflow-item]', (els) => els.map((e) => e.getAttribute('data-dock-overflow-item')));
  const customize = await win.locator('[data-dock-menu-item="customize"]').count();
  console.log(`[TFL-1159 R13] More overflow=${JSON.stringify(overflowItems)} customize=${customize}`);
  expect(overflowItems.length, 'More holds the stage overflow').toBeGreaterThanOrEqual(1);
  expect(customize, 'More holds Customize dock').toBe(1);
  assertNoHScroll(await menuHScroll('[data-dock-overflow-menu] .command-menu-list'), 'More list');
  await win.screenshot({ path: path.join(SHOTS, 'tfl1116_r13_more.png') });

  // ---- Customize dock -> DEDICATED eligible chooser, never the global palette ----
  await win.locator('[data-dock-menu-item="customize"]').first().click();
  await win.waitForTimeout(400);
  expect(await win.locator(DOCK).getAttribute('data-dock-edit'), 'Customize dock arms edit mode').toBe('true');

  await win.locator('[data-dock-plus]').first().click();
  await win.waitForSelector('[data-dock-picker]', { state: 'visible', timeout: 8000 });
  expect(await win.locator('[data-command-palette]').count(), 'the chooser is NOT the global palette').toBe(0);
  const picker = await win.$$eval('[data-dock-picker-item]', (els) => els.map((e) => e.getAttribute('data-dock-picker-item')));
  console.log(`[TFL-1159 R14] chooser items=${JSON.stringify(picker)}`);
  expect(picker.length, 'the dedicated chooser offers eligible tools').toBeGreaterThanOrEqual(1);
  expect(picker, 'a build-unsupported command is never offered').not.toContain('validateDocument');
  expect(await win.locator('[data-dock-done]').count(), 'customization has an explicit Done action').toBe(1);
  assertNoHScroll(await menuHScroll('[data-dock-picker] .command-menu-list'), 'chooser list');
  await win.screenshot({ path: path.join(SHOTS, 'tfl1116_r14_customize_dock.png') });

  // ---- Done leaves customization in one click ----
  await win.locator('[data-dock-done]').first().click();
  await win.waitForTimeout(500);
  expect(await win.locator(DOCK).getAttribute('data-dock-edit'), 'Done ends customization').toBe('false');
  expect(await win.locator('[data-dock-picker]').count(), 'Done closes the chooser').toBe(0);
});

test('R14: a temporarily-unavailable persisted pin is retained and explained, not reset', async () => {
  await openReport();
  await gotoStage(win, 1); // PAGES
  // Seed a persisted pin for a tool the LIVE gate disables on a plain PDF
  // (openComicView needs a CBZ/CBT source), through the real settings writer.
  await seedPins(['openComicView']);
  await gotoStage(win, 1);
  await win.waitForTimeout(500);

  const pinned = win.locator('[data-dock-pin="openComicView"]');
  const count = await pinned.count();
  console.log(`[TFL-1159 R14] openComicView pin count=${count}`);
  expect(count, 'the persisted pin is retained (not reset)').toBe(1);
  const state = await pinned.first().evaluate((e) => ({
    disabled: e.disabled,
    title: e.getAttribute('title'),
    ineligible: e.getAttribute('data-dock-pin-ineligible'),
  }));
  console.log(`[TFL-1159 R14] pin state=${JSON.stringify(state)}`);
  expect(state.disabled, 'the temporarily-unavailable pin renders disabled').toBe(true);
  expect((state.title ?? '').length, 'the pin is EXPLAINED with its refusal copy').toBeGreaterThan(0);
  expect(state.ineligible, 'the pin carries the ineligible hook').toBe('openComicView');

  const saved = await loadSettings();
  console.log(`[TFL-1159 R14] persisted dockPins=${JSON.stringify(saved && saved.dockPins)}`);
  expect((saved && saved.dockPins) || [], 'the saved dock is not reset').toContain('openComicView');
});

