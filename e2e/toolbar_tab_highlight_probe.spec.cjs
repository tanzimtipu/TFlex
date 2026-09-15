// Probe (qa): does the toolbar tab highlight settle onto the clicked
// tab, or does it lag one click behind? The TEST-2 evidence shots were
// captured within ~tens of ms of the click (inside the 200ms tab
// fade), so they may show a mid-transition frame. This probe waits
// past the transition, then reads the settled DOM class + recaptures.
// Diagnostic only - not part of the three-spec run.
const { test } = require('@playwright/test');
const { launchDev, hardClose, shot } = require('./lib/helpers.cjs');

test('Toolbar tab highlight settles on clicked tab', async () => {
  const { electronApp, window } = await launchDev();
  await window.locator('.sample-card:has-text("report")').first().click();
  await window.waitForSelector('[data-unified-toolbar]', { timeout: 10000 });

  const activeAfter = async (label) => {
    const active = await window
      .locator('[data-unified-toolbar] .toolbar-tab-active')
      .textContent();
    const selected = await window
      .locator('[data-unified-toolbar] [role="tab"][aria-selected="true"]')
      .allTextContents();
    console.log(`[${label}] .toolbar-tab-active=${JSON.stringify(active)} aria-selected=${JSON.stringify(selected)}`);
    return active;
  };

  await window.click('[data-unified-toolbar] [data-tab="edit"]');
  await window.waitForSelector('[data-unified-toolbar] [data-tool="move"]', { timeout: 5000 });
  await window.waitForTimeout(600); // 200ms fade + margin
  const editActive = await activeAfter('after Edit click + 600ms');
  await shot(window, 'unified_toolbar_edit_settled.png');
  if (editActive !== 'Edit') throw new Error(`Edit tab highlight wrong after settle: ${editActive}`);

  await window.click('[data-unified-toolbar] [data-tab="document"]');
  await window.waitForSelector('[data-unified-toolbar] [data-tool="save"]', { timeout: 5000 });
  await window.waitForTimeout(600);
  const docActive = await activeAfter('after Document click + 600ms');
  await shot(window, 'unified_toolbar_document_settled.png');
  if (docActive !== 'Document') throw new Error(`Document tab highlight wrong after settle: ${docActive}`);

  await window.click('[data-unified-toolbar] [data-tab="annotate"]');
  await window.waitForSelector('[data-unified-toolbar] [data-tool="highlight"]', { timeout: 5000 });
  await window.waitForTimeout(600);
  const annActive = await activeAfter('after Annotate click + 600ms');
  if (annActive !== 'Annotate') throw new Error(`Annotate tab highlight wrong after settle: ${annActive}`);

  await hardClose(electronApp);
});