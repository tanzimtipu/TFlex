// TEST 1 (orchestrator spec): UnifiedToolbar renders with tabs.
// One test, one spec. Opens a bundled sample from the Welcome screen
// (the app has no [data-pick-pdf] control - the real open path is the
// sample card), then verifies the toolbar, its three tabs, the
// default active tab and that tools are visible.
const { test, expect } = require('@playwright/test');
const { launchDev, hardClose, shot } = require('./lib/helpers.cjs');

test('Unified toolbar renders with tabs', async () => {
  const { electronApp, window } = await launchDev();

  // Open a PDF via the Welcome screen's sample card (real open path).
  await window.locator('.sample-card:has-text("report")').first().click();

  // Verify toolbar exists
  await window.waitForSelector('[data-unified-toolbar]', { timeout: 10000 });

  // Verify 3 tabs
  const tabs = await window.locator('[data-unified-toolbar] [role="tab"]').allTextContents();
  console.log('Tabs:', tabs);
  expect(tabs).toContain('Annotate');
  expect(tabs).toContain('Edit');
  expect(tabs).toContain('Document');

  // Verify Annotate tab active by default
  const activeTab = await window.locator('[data-unified-toolbar] .toolbar-tab-active').textContent();
  expect(activeTab).toBe('Annotate');

  // Verify tools visible (scoped to the toolbar: page overlay layers
  // also carry data-tool attributes).
  const tools = await window.locator('[data-unified-toolbar] [data-tool]').count();
  console.log('Tools on Annotate tab:', tools);
  expect(tools).toBeGreaterThan(0);

  // Evidence: toolbar in default (Annotate) tab.
  await shot(window, 'unified_toolbar_annotate.png');

  await hardClose(electronApp);
});