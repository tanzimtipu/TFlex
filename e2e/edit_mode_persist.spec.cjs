// Orchestrator spec: Edit mode must persist across toolbar tab switches.
// One test: open report.pdf, arm the Edit tab's Move tool, switch
// Annotate -> Edit, and prove Move is still armed. Selectors are scoped
// to [data-unified-toolbar] (see toolbar_tabs.spec.cjs — page overlays
// also carry data-tool attributes).
const { test, expect } = require('@playwright/test');
const { launchDev, hardClose } = require('./lib/helpers.cjs');

test('Edit mode persists when switching tabs', async () => {
  const { electronApp, window } = await launchDev();

  // Open PDF
  await window.locator('.sample-card:has-text("report")').first().click();
  await window.waitForSelector('[data-unified-toolbar]', { timeout: 5000 });

  // Click Edit tab
  await window.click('[data-unified-toolbar] [data-tab="edit"]');
  await window.waitForSelector('[data-unified-toolbar] [data-tool="move"]', { timeout: 2000 });

  // Activate Move tool
  await window.click('[data-unified-toolbar] [data-tool="move"]');
  await window.waitForTimeout(200);

  // Verify active
  const isActive = await window
    .locator('[data-unified-toolbar] [data-tool="move"]')
    .evaluate((el) => el.classList.contains('active'));
  console.log('Move active after arm:', isActive);
  expect(isActive).toBe(true);

  // Switch to Annotate
  await window.click('[data-unified-toolbar] [data-tab="annotate"]');
  await window.waitForSelector('[data-unified-toolbar] [data-tool="highlight"]', { timeout: 2000 });

  // Switch back to Edit
  await window.click('[data-unified-toolbar] [data-tab="edit"]');
  await window.waitForSelector('[data-unified-toolbar] [data-tool="move"]', { timeout: 2000 });

  // Verify Move still active
  const stillActive = await window
    .locator('[data-unified-toolbar] [data-tool="move"]')
    .evaluate((el) => el.classList.contains('active'));
  console.log('Move still active:', stillActive);
  expect(stillActive).toBe(true);

  await hardClose(electronApp);
});
