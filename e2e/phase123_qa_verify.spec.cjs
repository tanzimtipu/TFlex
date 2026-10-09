// Phase 123 (chunk D) — focused verification + before/after screenshots +
// CONTROL-INDEX / blast-radius sweep of the Chrome tab style (TFL-1403).
//
// BEFORE = the preserved 'colorful' look forced through the real Tab style
// preference (the phase ruling keeps 'colorful' unchanged; see the report for
// the baseline rationale). AFTER = the new default 'chrome'.
//
// Launches only through the canonical launchApp helper; documents open through
// the shared openSamplePath Intake-aware helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { openSamplePath, openPreferences, hardClose, toggleMultiModeViaPalette } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const DEFAULT_W = 1440;
const DEFAULT_H = 900;
const MIN_W = 960; // src/main/window.ts DESIRED_MIN_WINDOW_WIDTH
const MIN_H = 640; // src/main/window.ts DESIRED_MIN_WINDOW_HEIGHT
const LONG_NAME =
  'Quarterly-Financial-Report-and-Consolidated-Statements-2026-Final-Approved-Revision-v3.pdf';

let app = null;
let win = null;

test.setTimeout(600000);

function tmpCopy(name, sample = 'report.pdf') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p123-qa-'));
  const dest = path.join(dir, name);
  fs.copyFileSync(getSamplePath(sample), dest);
  return dest;
}

async function launch() {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
}

async function setSize(w, h) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const b = BrowserWindow.getAllWindows()[0];
    if (b === undefined || b === null) return;
    if (b.isMaximized()) b.unmaximize();
    b.setSize(s.w, s.h);
  }, { w, h });
  await win.waitForTimeout(500);
}

// Force the tab style through the real Preferences "Tab style" control before
// any document is open (the .tab-area only mounts with the workspace), and
// report the dialog's value so the caller can assert persistence.
async function setTabStyle(style) {
  await openPreferences(win);
  await win.locator('[data-prefs-tab-style]').selectOption(style);
  await win.waitForTimeout(300);
  const value = await win.locator('[data-prefs-tab-style]').inputValue();
  await win.keyboard.press('Escape');
  await win
    .waitForSelector('[data-prefs-dialog]', { state: 'hidden', timeout: 8000 })
    .catch(() => {});
  return value;
}

async function shot(name, clip) {
  const p = path.join(SHOTS, name);
  if (clip) await win.screenshot({ path: p, clip });
  else await win.screenshot({ path: p });
  return p;
}

async function stripClip() {
  return win.evaluate(() => {
    const a = document.querySelector('.tab-area');
    if (a === null) return null;
    const r = a.getBoundingClientRect();
    return {
      x: Math.max(0, r.left - 6),
      y: Math.max(0, r.top - 6),
      width: r.width + 12,
      height: r.height + 12,
    };
  });
}

async function closeToSingleAtRest() {
  await win.mouse.move(4, 420);
  while ((await win.locator('[data-tab-id]').count()) > 1) {
    const active = win.locator('.tab-area [role="tab"][aria-selected="true"]').first();
    await active.hover();
    await win.waitForTimeout(120);
    await active.locator('.tab-close').first().click({ force: true });
    await win.waitForTimeout(400);
  }
  await win.waitForTimeout(300);
}

// Shared capture routine: single / multiple / long-title (ellipsis) / hovered
// inactive, each at the default and the minimum supported window size.
async function captureStates(side, style) {
  await launch();
  const persisted = await setTabStyle(style);
  expect(persisted, `${side}: Tab style preference = ${style}`).toBe(style);

  await setSize(DEFAULT_W, DEFAULT_H);

  await openSamplePath(win, app, tmpCopy('Report-Short.pdf'));
  await expect(win.locator('[data-tab-id]')).toHaveCount(1, { timeout: 30000 });
  await win.waitForTimeout(400);
  expect(await win.locator('.tab-area').getAttribute('data-tab-style')).toBe(style);
  await shot(`p123-${side}-single-default.png`);

  await openSamplePath(win, app, tmpCopy(LONG_NAME));
  await expect(win.locator('[data-tab-id]')).toHaveCount(2, { timeout: 30000 });
  await win.locator('[data-tab-id]').filter({ hasText: 'Quarterly' }).first().click();
  await win.waitForTimeout(400);
  await shot(`p123-${side}-longtitle-default.png`);
  await shot(`p123-${side}-longtitle-default-zoom.png`, await stripClip());

  await openSamplePath(win, app, tmpCopy('Appendix-B.pdf'));
  await expect(win.locator('[data-tab-id]')).toHaveCount(3, { timeout: 30000 });
  await win.waitForTimeout(400);
  await shot(`p123-${side}-multi-default.png`);

  await win.locator('.tab-area [role="tab"]:not([aria-selected="true"])').first().hover({ position: { x: 40, y: 15 } });
  await win.waitForTimeout(300);
  await shot(`p123-${side}-hover-default.png`);
  await shot(`p123-${side}-hover-default-zoom.png`, await stripClip());

  // Minimum supported window size (960x640).
  await setSize(MIN_W, MIN_H);
  await win.waitForTimeout(400);
  await shot(`p123-${side}-multi-min.png`);

  await win.locator('[data-tab-id]').filter({ hasText: 'Quarterly' }).first().click();
  await win.waitForTimeout(400);
  await shot(`p123-${side}-longtitle-min.png`);

  await win.locator('.tab-area [role="tab"]:not([aria-selected="true"])').first().hover({ position: { x: 30, y: 15 } });
  await win.waitForTimeout(300);
  await shot(`p123-${side}-hover-min.png`);
  await shot(`p123-${side}-hover-min-zoom.png`, await stripClip());

  await closeToSingleAtRest();
  expect(await win.locator('[data-tab-id]')).toHaveCount(1, { timeout: 8000 });
  await shot(`p123-${side}-single-min.png`);
}

test('BEFORE (colorful) — four states at default + minimum window size', async () => {
  await captureStates('before', 'colorful');
});

test('AFTER (chrome) — four states at default + minimum window size', async () => {
  await captureStates('after', 'chrome');
});

// ---------------------------------------------------------------------------
// Real-app assertions from the task: no layout shift on hover, exactly one
// active tab, close hidden-at-rest / shown-on-hover-or-active, "+" opens a tab.
// ---------------------------------------------------------------------------
function geom() {
  return win.evaluate(() => {
    const list = document.querySelector('.tab-list');
    const tabs = Array.from(document.querySelectorAll('.tab-area [role="tab"]'));
    const activeEl = document.querySelector('.tab-area [role="tab"][aria-selected="true"]');
    return {
      listWidth: list === null ? null : list.getBoundingClientRect().width,
      active: activeEl === null ? null : activeEl.getAttribute('data-tab-id'),
      tabs: tabs.map((t) => {
        const r = t.getBoundingClientRect();
        return { id: t.getAttribute('data-tab-id'), x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    };
  });
}

function tabBg(id) {
  return win.evaluate((tid) => {
    const el = document.querySelector(`.tab-area [role="tab"][data-tab-id="${tid}"]`);
    return el === null ? null : getComputedStyle(el, '::before').backgroundColor;
  }, id);
}

function closeOpacity(id) {
  return win.evaluate((tid) => {
    const el = document.querySelector(`.tab-area [role="tab"][data-tab-id="${tid}"] .tab-close`);
    return el === null ? -1 : parseFloat(getComputedStyle(el).opacity);
  }, id);
}

test('AFTER (chrome) — hover/active/close/plus assertions', async () => {
  await launch();
  await setSize(DEFAULT_W, DEFAULT_H);
  await openSamplePath(win, app, tmpCopy('Assert-A.pdf', 'report.pdf'));
  await expect(win.locator('[data-tab-id]')).toHaveCount(1, { timeout: 30000 });
  await openSamplePath(win, app, tmpCopy('Assert-B.pdf', 'long.pdf'));
  await expect(win.locator('[data-tab-id]')).toHaveCount(2, { timeout: 30000 });
  await openSamplePath(win, app, tmpCopy('Assert-C.pdf', 'form.pdf'));
  await expect(win.locator('[data-tab-id]')).toHaveCount(3, { timeout: 30000 });
  await win.waitForTimeout(400);

  expect(await win.locator('.tab-area').getAttribute('data-tab-style')).toBe('chrome');

  // Exactly one active tab.
  expect(await win.locator('.tab-area [role="tab"][aria-selected="true"]').count()).toBe(1);
  const before = await geom();
  const activeId = before.active;
  expect(activeId).not.toBeNull();

  const inactiveEl = await win.locator('.tab-area [role="tab"]:not([aria-selected="true"])').first();
  const inactiveId = await inactiveEl.getAttribute('data-tab-id');
  const inactiveBgBefore = await tabBg(inactiveId);
  const activeBgBefore = await tabBg(activeId);

  await inactiveEl.hover({ position: { x: 40, y: 15 } });
  await win.waitForTimeout(250);
  const after = await geom();

  // No layout shift: strip geometry and every tab box identical, active fixed.
  expect(Math.abs(after.listWidth - before.listWidth)).toBeLessThan(0.5);
  expect(after.active).toBe(activeId);
  expect(after.tabs.length).toBe(before.tabs.length);
  for (let i = 0; i < before.tabs.length; i += 1) {
    expect(after.tabs[i].id).toBe(before.tabs[i].id);
    expect(Math.abs(after.tabs[i].x - before.tabs[i].x)).toBeLessThan(0.5);
    expect(Math.abs(after.tabs[i].y - before.tabs[i].y)).toBeLessThan(0.5);
    expect(Math.abs(after.tabs[i].w - before.tabs[i].w)).toBeLessThan(0.5);
    expect(Math.abs(after.tabs[i].h - before.tabs[i].h)).toBeLessThan(0.5);
  }

  // Inactive hover lightens the body and reveals the close control.
  const inactiveBgAfter = await tabBg(inactiveId);
  expect(inactiveBgAfter, 'inactive hover lightens the body').not.toBe(inactiveBgBefore);
  expect(await closeOpacity(inactiveId), 'hover reveals the inactive close').toBeGreaterThan(0.5);

  // At rest the inactive close is hidden; the active close is shown.
  await win.mouse.move(4, 420);
  await win.waitForTimeout(250);
  expect(await closeOpacity(inactiveId), 'inactive close hidden at rest').toBeLessThan(0.5);
  expect(await closeOpacity(activeId), 'active close shown').toBeGreaterThan(0.5);

  // The active tab is never hover-lightened.
  await win.locator(`.tab-area [role="tab"][data-tab-id="${activeId}"]`).hover({ position: { x: 40, y: 12 } });
  await win.waitForTimeout(250);
  expect(await tabBg(activeId), 'active body unchanged on hover').toBe(activeBgBefore);

  // The "+" opens a tab and one-active still holds.
  const countBefore = await win.locator('[data-tab-id]').count();
  await win.locator('[data-new-tab]').first().click();
  await expect(win.locator('[data-tab-id]')).toHaveCount(countBefore + 1, { timeout: 8000 });
  expect(await win.locator('.tab-area [role="tab"][aria-selected="true"]').count()).toBe(1);
  await shot('p123-after-plus-opens-tab.png');

  await hardClose(app, 'p123-qa-assert');
  app = null;
});

// ---------------------------------------------------------------------------
// Blast radius on the shared tab path: open / close / switch / reorder /
// tear-out / overflow. Gestures mirror the proven phase58/61 specs but open
// documents through the current Intake-aware helper.
// ---------------------------------------------------------------------------
async function dragTabByTitle(tabId, targetX) {
  const title = win.locator(`[data-tab-id="${tabId}"] .tab-title`);
  const box = await title.boundingBox();
  const startX = box.x + Math.min(6, box.width / 2);
  const y = box.y + box.height / 2;
  await win.mouse.move(startX, y);
  await win.mouse.down();
  await win.mouse.move(startX - 10, y, { steps: 3 });
  await win.mouse.move(targetX, y, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(500);
}

test('AFTER (chrome) — blast radius: open/close/switch/reorder/overflow/tear-out', async () => {
  await launch();
  await setSize(DEFAULT_W, DEFAULT_H);
  await openSamplePath(win, app, tmpCopy('Blast-1.pdf', 'report.pdf'));
  await expect(win.locator('[data-tab-id]')).toHaveCount(1, { timeout: 30000 });
  await openSamplePath(win, app, tmpCopy('Blast-2.pdf', 'long.pdf'));
  await expect(win.locator('[data-tab-id]')).toHaveCount(2, { timeout: 30000 });
  await openSamplePath(win, app, tmpCopy('Blast-3.pdf', 'form.pdf'));
  await expect(win.locator('[data-tab-id]')).toHaveCount(3, { timeout: 30000 });
  await win.waitForTimeout(400);

  // switch
  const id1 = await win.locator('[data-tab-id]').nth(1).getAttribute('data-tab-id');
  await win.locator('[data-tab-id]').nth(1).click();
  await win.waitForTimeout(300);
  expect(await win.locator('.tab-area [role="tab"][aria-selected="true"]').first().getAttribute('data-tab-id')).toBe(id1);

  // reorder by dragging a tab's title past another
  const order1 = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-tab-id]')).map((e) => e.getAttribute('data-tab-id')));
  const firstBox = await win.locator(`[data-tab-id="${order1[0]}"]`).boundingBox();
  await dragTabByTitle(order1[2], firstBox.x + 2);
  const order2 = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-tab-id]')).map((e) => e.getAttribute('data-tab-id')));
  expect(order2[0], 'reorder moved the dragged tab to the front').toBe(order1[2]);
  await shot('p123-after-blast-reorder.png');

  // close a non-active tab through its (hover-revealed) close control
  const beforeClose = await win.locator('[data-tab-id]').count();
  const closeId = (await win.evaluate(() =>
    Array.from(document.querySelectorAll('.tab-area [role="tab"]'))
      .filter((t) => t.getAttribute('aria-selected') !== 'true')
      .map((t) => t.getAttribute('data-tab-id'))))[0];
  const closeTab = win.locator(`[data-tab-id="${closeId}"]`);
  await closeTab.hover();
  await win.waitForTimeout(150);
  await closeTab.locator('.tab-close').first().click({ force: true });
  await expect(win.locator('[data-tab-id]')).toHaveCount(beforeClose - 1, { timeout: 8000 });
  expect(await win.locator('.tab-area [role="tab"][aria-selected="true"]').count()).toBe(1);

  // overflow: at the minimum size with many tabs the strip routes the rest to
  // the All-tabs switcher; tabs stay reachable and the "+" stays on screen.
  for (let i = 0; i < 8; i += 1) {
    await openSamplePath(win, app, tmpCopy(`Blast-extra-${i}.pdf`));
  }
  await setSize(MIN_W, MIN_H);
  await win.waitForTimeout(500);
  const overflow = await win.evaluate(() => ({
    hidden: document.querySelectorAll('[data-tab-overflow="hidden"]').length,
    allTabs: document.querySelector('[data-all-tabs]') !== null,
    plusRight: (() => {
      const p = document.querySelector('[data-new-tab]');
      return p === null ? null : +p.getBoundingClientRect().right.toFixed(1);
    })(),
    viewport: window.innerWidth,
  }));
  expect(overflow.hidden, 'min-size overflow hides tabs into the All-tabs lane').toBeGreaterThan(0);
  expect(overflow.allTabs, 'All-tabs switcher present').toBe(true);
  expect(overflow.plusRight, '"+" stays within the viewport').toBeLessThanOrEqual(overflow.viewport + 1);
  await shot('p123-after-blast-overflow-min.png');

  // tear-out: a downward drag from a tab title opens a #detached window.
  const titleBox = await win
    .locator('.tab-area [role="tab"][aria-selected="true"] .tab-title')
    .first()
    .boundingBox();
  const strip = await win.locator('.tab-list').boundingBox();
  const startX = titleBox.x + Math.min(6, titleBox.width / 2);
  const startY = titleBox.y + titleBox.height / 2;
  const targetY = strip.y + strip.height + 60;
  const secondP = app.waitForEvent('window', { timeout: 20000 }).catch(() => null);
  await win.mouse.move(startX, startY);
  await win.mouse.down();
  await win.mouse.move(startX, startY + 10, { steps: 4 });
  await win.mouse.move(startX, targetY, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(700);
  const second = await secondP;
  expect(second, 'tear-out opened a new window').not.toBeNull();
  if (second) {
    await second.waitForLoadState('domcontentloaded');
    expect(second.url(), 'torn-out window carries #detached').toContain('#detached');
  }

  await hardClose(app, 'p123-qa-blast');
  app = null;
});

// ---------------------------------------------------------------------------
// CONTROL-INDEX sweep for the phase's guarded surfaces: tablist ARIA and
// one-active, the per-tab close, and the strip "+" (real control + the
// preserved Multi-Mode disabled reason).
// ---------------------------------------------------------------------------
test('AFTER (chrome) — CONTROL-INDEX: tablist ARIA, one active, "+" real + Multi-Mode disabled', async () => {
  await launch();
  await setSize(DEFAULT_W, DEFAULT_H);
  await openSamplePath(win, app, tmpCopy('Ctrl-1.pdf', 'report.pdf'));
  await expect(win.locator('[data-tab-id]')).toHaveCount(1, { timeout: 30000 });
  await openSamplePath(win, app, tmpCopy('Ctrl-2.pdf', 'long.pdf'));
  await expect(win.locator('[data-tab-id]')).toHaveCount(2, { timeout: 30000 });
  await win.waitForTimeout(300);

  // tablist ARIA + exactly one active tab.
  expect(await win.locator('.tab-area').getAttribute('role')).toBe('tablist');
  const roles = await win.evaluate(() =>
    Array.from(document.querySelectorAll('.tab-area [data-tab-id]')).map((t) => t.getAttribute('role')));
  expect(roles.every((r) => r === 'tab')).toBe(true);
  expect(await win.locator('.tab-area [role="tab"][aria-selected="true"]').count()).toBe(1);

  // The "+" is a real control: it opens a tab.
  const n0 = await win.locator('[data-tab-id]').count();
  await win.locator('[data-new-tab]').first().click();
  await expect(win.locator('[data-tab-id]')).toHaveCount(n0 + 1, { timeout: 8000 });
  expect(await win.locator('.tab-area [role="tab"][aria-selected="true"]').count()).toBe(1);

  // Multi Mode disables the "+" with its preserved reason.
  await toggleMultiModeViaPalette(win);
  await win.waitForTimeout(500);
  const plus = win.locator('[data-new-tab]').first();
  const disabled = await plus.isDisabled().catch(() => false);
  const ariaDisabled = await plus.getAttribute('aria-disabled');
  const reasonText = await plus.evaluate((el) => {
    const li = el.closest('.tab-list-new');
    return [el.getAttribute('title'), el.getAttribute('aria-label'), li ? li.getAttribute('title') : null]
      .filter(Boolean)
      .join(' ');
  });
  expect(disabled || ariaDisabled === 'true', 'Multi-Mode disables "+"').toBe(true);
  expect(reasonText, 'Multi-Mode disabled reason preserved').toContain(
    'Turn off Multi Mode to create a new document',
  );
  await shot('p123-after-control-multimode.png');

  await hardClose(app, 'p123-qa-control');
  app = null;
});
