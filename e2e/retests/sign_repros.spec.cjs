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

// Create a typed signature, save it, and arm it (Sign tool). Returns when armed.
async function createAndArmSignature() {
  await window.click('button[aria-label="Sign tool"]');
  await window.waitForSelector('.sig-manager', { timeout: 10000 });
  await window.click('.sig-tab:has-text("Type")').catch(() => {});
  const typeInput = window.locator('input[aria-label="Type your signature"]');
  if (await typeInput.count()) { await typeInput.fill('QA Suite'); }
  await window.click('.sig-manager button:text-is("Save")').catch(() => {});
  await window.waitForTimeout(400);
  await window.click('.sig-saved-pick').catch(() => {});
  await window.waitForTimeout(500);
}

test.beforeEach(async () => { await launch(); });
test.afterEach(async () => { await close(); });

test('BUG-1: click embedded signature -> no selector; Confirm does not exit Sign mode/ghost', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  const page = window.locator('.pdf-page').first();
  const pbox = await page.boundingBox();

  await createAndArmSignature();
  // armed + ghost should be present
  const armedBefore = await window.locator('.signatures-layer').first().getAttribute('data-armed');
  const ghostBefore = await window.locator('.sig-ghost').count();
  const toolbarPressed = await window.locator('button[aria-label="Sign tool"]').getAttribute('aria-pressed');
  console.log('BUG1 before place: armed=', armedBefore, 'ghost=', ghostBefore, 'toolbarPressed=', toolbarPressed);
  await snap('bug1-armed-ghost');

  // place the signature at a point on page 1
  const targetX = pbox.x + 500, targetY = pbox.y + 300;
  await window.mouse.move(targetX, targetY);
  await window.waitForTimeout(300);
  await window.mouse.click(targetX, targetY);
  await window.waitForTimeout(400);
  const pendingBeforeConfirm = await window.locator('[data-sig-pending]').count();
  const barBeforeConfirm = await window.locator('[data-sig-action-bar]').count();
  console.log('BUG1 pending before confirm:', pendingBeforeConfirm, 'bar:', barBeforeConfirm);
  await snap('bug1-pending-bar');

  // click Confirm
  const confirmBtn = window.locator('[data-sig-action="confirm"]').first();
  if (await confirmBtn.count()) {
    await confirmBtn.click({ force: true });
    await window.waitForTimeout(600);
  }
  const committedCount = await window.locator('.sig-placement').count();
  const armedAfterConfirm = await window.locator('.signatures-layer').first().getAttribute('data-armed');
  const ghostAfterConfirm = await window.locator('.sig-ghost').count();
  const toolbarAfter = await window.locator('button[aria-label="Sign tool"]').getAttribute('aria-pressed');
  console.log('BUG1 after confirm: committed=', committedCount, 'armed=', armedAfterConfirm, 'ghost=', ghostAfterConfirm, 'toolbarPressed=', toolbarAfter);
  await snap('bug1-after-confirm');

  // Now click the embedded (committed) placement -> does a selector appear?
  if (committedCount > 0) {
    const placement = window.locator('.sig-placement').first();
    const plbox = await placement.boundingBox();
    if (plbox) {
      await window.mouse.click(plbox.x + plbox.width / 2, plbox.y + plbox.height / 2);
      await window.waitForTimeout(500);
      const selectedCount = await window.locator('.sig-placement-selected').count();
      const handleCount = await window.locator('.sig-placement .sig-handle').count();
      console.log('BUG1 after clicking placement: selected=', selectedCount, 'handles=', handleCount);
      await snap('bug1-click-placement');
    }
  }
});

test('BUG-2: after Sign tool, Text Box/Rectangle/Ellipse tools stop working', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  const page = window.locator('.pdf-page').first();
  const pbox = await page.boundingBox();

  // Use sign once
  await createAndArmSignature();
  const targetX = pbox.x + 500, targetY = pbox.y + 300;
  await window.mouse.move(targetX, targetY);
  await window.waitForTimeout(300);
  await window.mouse.click(targetX, targetY);
  await window.waitForTimeout(400);
  const confirmBtn = window.locator('[data-sig-action="confirm"]').first();
  if (await confirmBtn.count()) { await confirmBtn.click({ force: true }); }
  await window.waitForTimeout(500);

  // Now try Text Box tool
  await window.locator('.ann-toolbar button[data-tool="textbox"]').click();
  await window.waitForTimeout(200);
  const tbActive = await window.locator('.ann-toolbar button[data-tool="textbox"]').getAttribute('aria-pressed');
  await window.mouse.click(pbox.x + 400, pbox.y + 400);
  await window.waitForTimeout(500);
  const tbBar = await window.locator('[data-annotation-action-bar="textbox"]').count();
  const tbEditor = await window.locator('[data-annotation-editor="textbox"]').count();
  const tbCommitted = await window.locator('.ann[data-kind="textbox"]').count();
  const tbSigPending = await window.locator('[data-sig-pending]').count();
  console.log('BUG2 textbox active=', tbActive, 'bar=', tbBar, 'editor=', tbEditor, 'committed=', tbCommitted, 'sigPending=', tbSigPending);
  await snap('bug2-after-sign-textbox');

  // Rectangle tool
  await window.locator('.ann-toolbar button[data-tool="rect"]').click();
  await window.waitForTimeout(200);
  const rectActive = await window.locator('.ann-toolbar button[data-tool="rect"]').getAttribute('aria-pressed');
  await window.mouse.click(pbox.x + 600, pbox.y + 600);
  await window.waitForTimeout(500);
  const rectCount = await window.locator('.ann[data-kind="rect"]').count();
  console.log('BUG2 rect active=', rectActive, 'rect placements=', rectCount);
  await snap('bug2-after-sign-rect');

  // Ellipse tool
  await window.locator('.ann-toolbar button[data-tool="ellipse"]').click();
  await window.waitForTimeout(200);
  await window.mouse.click(pbox.x + 350, pbox.y + 650);
  await window.waitForTimeout(500);
  const ellipseCount = await window.locator('.ann[data-kind="ellipse"]').count();
  console.log('BUG2 ellipse placements=', ellipseCount);
  await snap('bug2-after-sign-ellipse');
});
