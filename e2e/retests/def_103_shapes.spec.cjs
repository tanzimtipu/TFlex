const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');

const EXE_PATH = "C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe";

let electronApp = null;
let window = null;

async function launch() {
  electronApp = await launchApp([], null, EXE_PATH);
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);
}
async function close() { if (electronApp) await electronApp.close().catch(() => {}); electronApp = null; }
async function openSample(name) {
  await window.click(`.sample-card:has-text("${name}")`);
  await window.waitForSelector('.workspace', { timeout: 15000 });
  await window.waitForTimeout(1500);
}

test.beforeEach(async () => { await launch(); });
test.afterEach(async () => { await close(); });

// DEF-103 regression: after a Sign placement, Rectangle AND Ellipse
// still place annotations (the defect named all three tools).
test('DEF-103: rect and ellipse place after sign', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  const page = window.locator('.pdf-page').first();
  const pbox = await page.boundingBox();

  // Sign flow (place + confirm)
  await window.click('button[aria-label="Sign tool"]');
  await window.waitForSelector('.sig-manager', { timeout: 10000 });
  await window.click('.sig-tab:has-text("Type")').catch(() => {});
  const typeInput = window.locator('input[aria-label="Type your signature"]');
  if (await typeInput.count()) { await typeInput.fill('QA Suite'); }
  await window.click('.sig-manager button:text-is("Save")').catch(() => {});
  await window.waitForTimeout(400);
  await window.click('.sig-saved-pick').catch(() => {});
  await window.waitForTimeout(500);
  await window.mouse.move(pbox.x + 500, pbox.y + 300);
  await window.waitForTimeout(300);
  await window.mouse.click(pbox.x + 500, pbox.y + 300);
  await window.waitForTimeout(400);
  const confirmBtn = window.locator('[data-sig-action="confirm"]').first();
  if (await confirmBtn.count()) { await confirmBtn.click({ force: true }); }
  await window.waitForTimeout(600);

  // Rectangle after sign
  await window.locator('.ann-toolbar button[data-tool="rect"]').click();
  await window.waitForTimeout(200);
  await window.mouse.move(pbox.x + 200, pbox.y + 550);
  await window.mouse.down();
  await window.mouse.move(pbox.x + 400, pbox.y + 700, { steps: 6 });
  await window.mouse.up();
  await window.waitForTimeout(600);
  // confirm the rect action bar if present
  const rectConfirm = window.locator('[data-annotation-action="rect-confirm"]').first();
  if (await rectConfirm.count()) { await rectConfirm.click({ force: true }); }
  await window.waitForTimeout(500);
  const rectCount = await window.locator('.ann[data-kind="rect"]').count();

  // Ellipse after sign
  await window.locator('.ann-toolbar button[data-tool="ellipse"]').click();
  await window.waitForTimeout(200);
  await window.mouse.move(pbox.x + 200, pbox.y + 500);
  await window.mouse.down();
  await window.mouse.move(pbox.x + 350, pbox.y + 620, { steps: 6 });
  await window.mouse.up();
  await window.waitForTimeout(600);
  const ellipseConfirm = window.locator('[data-annotation-action="ellipse-confirm"]').first();
  if (await ellipseConfirm.count()) { await ellipseConfirm.click({ force: true }); }
  await window.waitForTimeout(500);
  const ellipseCount = await window.locator('.ann[data-kind="ellipse"]').count();

  const diag = await window.evaluate(() => window.tflexDiagnostics());
  const anns = (diag.engineState && diag.engineState.annotations) || [];
  const kinds = anns.map(a => a.kind);
  console.log('DEF-103 rectCount=', rectCount, 'ellipseCount=', ellipseCount, 'engineAnnotationKinds=', JSON.stringify(kinds));

  expect(rectCount, 'rectangle should place after sign').toBeGreaterThan(0);
  expect(ellipseCount, 'ellipse should place after sign').toBeGreaterThan(0);
  await window.screenshot({ path: 'screenshots/def103-rect-ellipse-after-sign.png' });
});
