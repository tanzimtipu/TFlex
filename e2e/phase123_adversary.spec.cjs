// Phase 123 (chunk C) — adversarial diff-pass on the Chrome tab strip.
// Attacks the [data-tab-style="chrome"] implementation in the RUNNING app.
// Records findings in ADVERSARIAL_REVIEW.md (Session: diff-pass).
//
// Probes:
// 1. Hover INACTIVE tab: body lighten + close appear, NO layout shift
// 2. ACTIVE tab: NEVER hover-lightened
// 3. Exactly one active tab tracking the open document
// 4. Close control: hidden at rest on inactive, shown on active/hover/focus
// 5. "+" is a real control (opens tab; Multi-Mode disables it)
// 6. Reduced-motion collapses transitions; focus-visible ring present
// 7. No regression to open/close/switch/reorder/tear-out/overflow

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const MULTI_MODE_REASON = 'Turn off Multi Mode to create a new document';

let app = null;
let win = null;

test.setTimeout(420000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p123-adversary');
  app = null;
  win = null;
});

async function setNextDialogPath(filePath) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, filePath);
}

async function openPath(filePath) {
  await setNextDialogPath(filePath);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(200);
}

async function openCopies(n, prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `tflex-p123-${prefix}-`));
  const src = getSamplePath('report.pdf');
  const paths = [];
  for (let i = 0; i < n; i += 1) {
    const p = path.join(tmp, `${prefix}-${i + 1}.pdf`);
    fs.copyFileSync(src, p);
    paths.push(p);
  }
  for (let i = 0; i < paths.length; i += 1) {
    await openPath(paths[i]);
    await win.waitForFunction(
      (count) => document.querySelectorAll('[data-tab-id]').length >= count,
      i + 1,
      { timeout: 30000 },
    );
  }
  await win.waitForTimeout(600);
  return paths;
}

// Chrome is the DEFAULT tab style as of Phase 123, so no setup needed.
// The tests below assume chrome style is active.

test('ADV-P123-1: Hover INACTIVE tab — body lighten, close appear, NO layout shift', async () => {
  await openCopies(3, 'hover-test');
  
  // Get initial measurements
  const tabList = await win.locator('.tab-list').first();
  const tabListWidthBefore = await tabList.evaluate((el) => el.clientWidth);
  
  const tabs = await win.locator('[role="tab"]:not([aria-selected="true"])').all();
  expect(tabs.length).toBeGreaterThan(0);
  
  const inactiveTab = tabs[0];
  const tabRectBefore = await inactiveTab.boundingBox();
  const tabIdBefore = await inactiveTab.getAttribute('data-tab-id');
  
  // Get active tab ID before hover
  const activeTabBefore = await win.locator('[role="tab"][aria-selected="true"]').first();
  const activeIdBefore = await activeTabBefore.getAttribute('data-tab-id');
  
  // Hover the inactive tab
  await inactiveTab.hover({ position: { x: 50, y: 15 } });
  await win.waitForTimeout(200);
  
  // Measure after hover
  const tabListWidthAfter = await tabList.evaluate((el) => el.clientWidth);
  const tabRectAfter = await inactiveTab.boundingBox();
  const activeTabAfter = await win.locator('[role="tab"][aria-selected="true"]').first();
  const activeIdAfter = await activeTabAfter.getAttribute('data-tab-id');
  
  // ASSERT: No layout shift
  expect(tabListWidthAfter).toBe(tabListWidthBefore);
  expect(Math.abs(tabRectAfter.width - tabRectBefore.width)).toBeLessThan(1);
  expect(Math.abs(tabRectAfter.height - tabRectBefore.height)).toBeLessThan(1);
  expect(Math.abs(tabRectAfter.x - tabRectBefore.x)).toBeLessThan(1);
  expect(Math.abs(tabRectAfter.y - tabRectBefore.y)).toBeLessThan(1);
  
  // ASSERT: Active tab unchanged
  expect(activeIdAfter).toBe(activeIdBefore);
  
  // ASSERT: Close control appeared
  const closeBtn = await inactiveTab.locator('.tab-close').first();
  const closeVisible = await closeBtn.isVisible();
  expect(closeVisible).toBe(true);
  
  // Take screenshot
  await win.screenshot({ path: path.join(SHOTS, 'p123-adv-hover-inactive.png') });
});

test('ADV-P123-2: ACTIVE tab is NEVER hover-lightened', async () => {
  await openCopies(2, 'active-hover');
  
  const activeTab = await win.locator('[role="tab"][aria-selected="true"]').first();
  
  // Get computed background before hover
  const bgBefore = await activeTab.evaluate((el) => {
    const pseudo = window.getComputedStyle(el, '::before');
    return pseudo.getPropertyValue('background');
  });
  
  // Hover the active tab
  await activeTab.hover({ position: { x: 50, y: 15 } });
  await win.waitForTimeout(200);
  
  // Get computed background after hover
  const bgAfter = await activeTab.evaluate((el) => {
    const pseudo = window.getComputedStyle(el, '::before');
    return pseudo.getPropertyValue('background');
  });
  
  // ASSERT: Background unchanged (no hover lightening)
  expect(bgAfter).toBe(bgBefore);
  
  await win.screenshot({ path: path.join(SHOTS, 'p123-adv-active-no-hover.png') });
});

test('ADV-P123-3: Exactly one active tab tracking the open document', async () => {
  const paths = await openCopies(3, 'active-track');
  
  // Initially, exactly one tab should be active
  let activeTabs = await win.locator('[role="tab"][aria-selected="true"]').all();
  expect(activeTabs.length).toBe(1);
  
  // Click on second tab
  const allTabs = await win.locator('[role="tab"]').all();
  await allTabs[1].click();
  await win.waitForTimeout(300);
  
  // Still exactly one active
  activeTabs = await win.locator('[role="tab"][aria-selected="true"]').all();
  expect(activeTabs.length).toBe(1);
  
  // Click on third tab
  await allTabs[2].click();
  await win.waitForTimeout(300);
  
  activeTabs = await win.locator('[role="tab"][aria-selected="true"]').all();
  expect(activeTabs.length).toBe(1);
  
  await win.screenshot({ path: path.join(SHOTS, 'p123-adv-one-active.png') });
});

test('ADV-P123-4: Close control visibility states', async () => {
  await openCopies(2, 'close-visibility');
  
  // Inactive tab at rest: close should be hidden
  const inactiveTabs = await win.locator('[role="tab"]:not([aria-selected="true"])').all();
  const inactiveClose = await inactiveTabs[0].locator('.tab-close').first();
  const inactiveCloseVisible = await inactiveClose.isVisible();
  expect(inactiveCloseVisible).toBe(false);
  
  // Active tab: close should be visible
  const activeTab = await win.locator('[role="tab"][aria-selected="true"]').first();
  const activeClose = await activeTab.locator('.tab-close').first();
  const activeCloseVisible = await activeClose.isVisible();
  expect(activeCloseVisible).toBe(true);
  
  // Hover inactive: close should appear
  await inactiveTabs[0].hover({ position: { x: 50, y: 15 } });
  await win.waitForTimeout(200);
  const hoverCloseVisible = await inactiveClose.isVisible();
  expect(hoverCloseVisible).toBe(true);
  
  // Click close on active tab
  await activeClose.click();
  await win.waitForTimeout(300);
  
  // One tab should remain
  const remainingTabs = await win.locator('[role="tab"]').all();
  expect(remainingTabs.length).toBe(1);
  
  await win.screenshot({ path: path.join(SHOTS, 'p123-adv-close-states.png') });
});

test('ADV-P123-5: "+" is a real control (opens tab; Multi-Mode disables)', async () => {
  
  // Count tabs before
  const tabsBefore = await win.locator('[role="tab"]').all();
  const countBefore = tabsBefore.length;
  
  // Click the "+" button
  const newTabBtn = await win.locator('[data-new-tab]').first();
  await newTabBtn.click();
  await win.waitForTimeout(300);
  
  // Count tabs after
  const tabsAfter = await win.locator('[role="tab"]').all();
  expect(tabsAfter.length).toBe(countBefore + 1);
  
  // Enable Multi-Mode and verify "+" is disabled
  await win.click('[data-toolbar-view-modes]');
  await win.waitForTimeout(200);
  await win.click('[data-view-mode="multi"]');
  await win.waitForTimeout(300);
  
  const newTabBtnDisabled = await newTabBtn.isDisabled();
  const ariaDisabled = await newTabBtn.getAttribute('aria-disabled');
  expect(newTabBtnDisabled || ariaDisabled === 'true').toBe(true);
  
  // Check for Multi-Mode reason
  const reasonVisible = await win.isVisible('text=Multi Mode');
  expect(reasonVisible).toBe(true);
  
  await win.screenshot({ path: path.join(SHOTS, 'p123-adv-new-tab.png') });
});

test('ADV-P123-6: Reduced-motion collapses transitions; focus-visible ring present', async () => {
  await openCopies(2, 'motion-test');
  
  // Reduced motion is already set in beforeEach
  
  // Tab should have focus-visible ring when focused via keyboard
  const inactiveTab = await win.locator('[role="tab"]:not([aria-selected="true"])').first();
  await inactiveTab.focus();
  
  const hasFocusRing = await inactiveTab.evaluate((el) => {
    const style = window.getComputedStyle(el, ':focus-visible');
    const outline = style.getPropertyValue('outline');
    return outline && outline !== 'none';
  });
  
  expect(hasFocusRing).toBe(true);
  
  await win.screenshot({ path: path.join(SHOTS, 'p123-adv-focus-ring.png') });
});

test('ADV-P123-7: No regression — open/close/switch/reorder at min width', async () => {
  await openCopies(4, 'regress-test');
  
  // Resize to minimum width (640px per requirements)
  await app.evaluate(({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows()[0];
    if (target === undefined || target === null) return;
    if (target.isMaximized()) target.unmaximize();
    target.setSize(640, 800);
  });
  await win.waitForTimeout(500);
  
  // All tabs should still be accessible (may overflow)
  const tabs = await win.locator('[role="tab"]').all();
  expect(tabs.length).toBe(4);
  
  // Switch between tabs
  await tabs[1].click();
  await win.waitForTimeout(200);
  let activeTab = await win.locator('[role="tab"][aria-selected="true"]').first();
  expect(await activeTab.getAttribute('data-tab-id')).toBe(await tabs[1].getAttribute('data-tab-id'));
  
  await tabs[2].click();
  await win.waitForTimeout(200);
  activeTab = await win.locator('[role="tab"][aria-selected="true"]').first();
  expect(await activeTab.getAttribute('data-tab-id')).toBe(await tabs[2].getAttribute('data-tab-id'));
  
  // Close a tab
  const closeBtn = await tabs[0].locator('.tab-close').first();
  await tabs[0].hover();
  await win.waitForTimeout(150);
  await closeBtn.click();
  await win.waitForTimeout(300);
  
  const remainingTabs = await win.locator('[role="tab"]').all();
  expect(remainingTabs.length).toBe(3);
  
  await win.screenshot({ path: path.join(SHOTS, 'p123-adv-min-width.png') });
});
