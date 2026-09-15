// TEST 2 (orchestrator spec): UnifiedToolbar tab switching.
// One test: open a doc, switch Edit -> Document -> Annotate and prove
// each section's promised tool mounts. Tool selectors are scoped to
// [data-unified-toolbar] because the page overlays also carry
// data-tool attributes.
const { test, expect } = require('@playwright/test');
const { launchDev, hardClose, shot } = require('./lib/helpers.cjs');

test('Tab switching works', async () => {
  const { electronApp, window } = await launchDev();
  await window.locator('.sample-card:has-text("report")').first().click();
  await window.waitForSelector('[data-unified-toolbar]', { timeout: 10000 });

  // Click Edit tab
  await window.click('[data-unified-toolbar] [data-tab="edit"]');
  await window.waitForSelector('[data-unified-toolbar] [data-tool="move"]', { timeout: 5000 });
  await shot(window, 'unified_toolbar_edit.png');

  // Click Document tab
  await window.click('[data-unified-toolbar] [data-tab="document"]');
  await window.waitForSelector('[data-unified-toolbar] [data-tool="save"]', { timeout: 5000 });
  await shot(window, 'unified_toolbar_document.png');

  // Click back to Annotate
  await window.click('[data-unified-toolbar] [data-tab="annotate"]');
  await window.waitForSelector('[data-unified-toolbar] [data-tool="highlight"]', { timeout: 5000 });

  await hardClose(electronApp);
});