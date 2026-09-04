const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');

let electronApp = null;
let window = null;

async function launch() {
  electronApp = await launchApp([]);
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);
}
async function close() { if (electronApp) await hardClose(electronApp); electronApp = null; }
async function openSample(name) {
  await window.click(`.sample-card:has-text("${name}")`);
  await window.waitForSelector('.workspace', { timeout: 15000 });
  await window.waitForTimeout(1200);
}
async function diag() { return await window.evaluate(() => window.tflexDiagnostics()); }
async function snap(name) { await window.screenshot({ path: `screenshots/${name}.png` }); }

test.beforeEach(async () => { await launch(); });
test.afterEach(async () => { await close(); });

test('BUG-21: close tab leaves Tools panel open on home screen, grid messy', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  await window.click('[data-tools-toggle]');
  await window.waitForSelector('[data-tools-palette]');
  await window.click('[data-tools-layout="grid"]');
  await window.waitForTimeout(300);
  await snap('bug21-tools-open-grid');

  // close the active tab
  await window.locator('.tab-active .tab-close').click();
  await window.waitForTimeout(1500);
  await snap('bug21-after-close-home');

  const state = await window.evaluate(() => {
    const palette = document.querySelector('[data-tools-palette]');
    const paletteRect = palette ? palette.getBoundingClientRect() : null;
    const layout = palette ? palette.getAttribute('data-layout') : null;
    const welcome = document.querySelector('.welcome, .welcome-screen, [class*="welcome"]');
    const gridTiles = document.querySelectorAll('[data-tool-id]').length;
    return {
      palettePresent: !!palette,
      paletteLayout: layout,
      paletteRect: paletteRect ? { x: Math.round(paletteRect.x), y: Math.round(paletteRect.y), w: Math.round(paletteRect.width), h: Math.round(paletteRect.height) } : null,
      welcomePresent: !!welcome,
      gridTiles,
      bodyStart: document.body.innerText.slice(0, 200),
    };
  });
  console.log('BUG21 state:', JSON.stringify(state, null, 2));
});

test('BUG-10: closing tab keeps Sign/Edit tool selection on next tab', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');

  // Arm Sign tool
  await window.click('button[aria-label="Sign tool"]');
  await window.waitForSelector('.sig-manager', { timeout: 10000 });
  await window.click('.sig-tab:has-text("Type")').catch(() => {});
  const typeInput = window.locator('input[aria-label="Type your signature"]');
  if (await typeInput.count()) { await typeInput.fill('QA'); }
  await window.click('.sig-manager button:text-is("Save")').catch(() => {});
  await window.waitForTimeout(300);
  await window.click('.sig-saved-pick').catch(() => {});
  await window.waitForTimeout(500);
  const signPressedBeforeClose = await window.locator('button[aria-label="Sign tool"]').getAttribute('aria-pressed');
  const armedLayerBefore = await window.locator('.signatures-layer').first().getAttribute('data-armed');
  console.log('BUG10 sign pressed before close:', signPressedBeforeClose, 'armed:', armedLayerBefore);
  await snap('bug10-sign-armed');

  // close tab
  await window.locator('.tab-active .tab-close').click();
  await window.waitForTimeout(1500);

  // open a fresh sample
  await openSample('form.pdf');
  const signPressedAfter = await window.locator('button[aria-label="Sign tool"]').getAttribute('aria-pressed');
  const armedLayerAfter = await window.locator('.signatures-layer').first().getAttribute('data-armed');
  const d = await diag();
  console.log('BUG10 sign pressed after new tab:', signPressedAfter, 'armedAfter:', armedLayerAfter, 'activeTool:', d.activeTool);
  await snap('bug10-new-tab-state');
});

test('BUG-10b: closing tab keeps Edit mode open on next tab', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  await window.click('[data-toolbar-edit-toggle]');
  await window.waitForTimeout(300);
  const editBefore = await window.locator('[data-toolbar-edit-toggle]').getAttribute('aria-pressed');
  const editToolbarBefore = await window.locator('[data-edit-toolbar]').count();
  console.log('BUG10b edit pressed before close:', editBefore, 'toolbarCount:', editToolbarBefore);
  await snap('bug10b-edit-open');

  await window.locator('.tab-active .tab-close').click();
  await window.waitForTimeout(1500);

  await openSample('form.pdf');
  const editAfter = await window.locator('[data-toolbar-edit-toggle]').getAttribute('aria-pressed');
  const editToolbarAfter = await window.locator('[data-edit-toolbar]').count();
  console.log('BUG10b edit pressed after new tab:', editAfter, 'toolbarCount:', editToolbarAfter);
  await snap('bug10b-new-tab-state');
});
