// TEST 3 (orchestrator spec): UnifiedToolbar Annotate expand/collapse.
// One test: collapsed count -> expand -> more tools -> collapse -> back
// to the collapsed count. The exit animation unmounts the extra row
// after ~200ms, so the collapse side waits for the expanded row to
// detach before counting (the fixed 300ms sleep alone can race).
const { test, expect } = require('@playwright/test');
const { launchDev, hardClose, shot } = require('./lib/helpers.cjs');

test('Expand shows more tools', async () => {
  const { electronApp, window } = await launchDev();
  await window.locator('.sample-card:has-text("report")').first().click();
  await window.waitForSelector('[data-unified-toolbar]', { timeout: 10000 });

  // Count collapsed tools
  const collapsed = await window.locator('.annotation-tools [data-tool]').count();
  console.log('Collapsed tools:', collapsed);

  // Click expand
  await window.click('[data-expand-toggle]');
  await window.waitForSelector('.annotation-tools .tools-row.expanded', { timeout: 2000 });
  await window.waitForTimeout(300);

  // Count expanded tools
  const expanded = await window.locator('.annotation-tools [data-tool]').count();
  console.log('Expanded tools:', expanded);
  expect(expanded).toBeGreaterThan(collapsed);
  await shot(window, 'unified_toolbar_expand_expanded.png');

  // Click collapse
  await window.click('[data-expand-toggle]');
  await window
    .waitForSelector('.annotation-tools .tools-row.expanded', { state: 'detached', timeout: 2000 })
    .catch(() => {});
  await window.waitForTimeout(300);

  const collapsed2 = await window.locator('.annotation-tools [data-tool]').count();
  console.log('Collapsed again:', collapsed2);
  expect(collapsed2).toBe(collapsed);

  await hardClose(electronApp);
});