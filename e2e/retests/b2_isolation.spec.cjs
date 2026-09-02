const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');

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
  await window.waitForTimeout(1200);
}
async function snap(name) { await window.screenshot({ path: `screenshots/${name}.png` }); }

test.beforeEach(async () => { await launch(); });
test.afterEach(async () => { await close(); });

// Does a single textbox click create a bar when NO sign is used first?
test('CONTROL: textbox single-click creates bar fresh', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  const page = window.locator('.pdf-page').first();
  const pbox = await page.boundingBox();

  await window.locator('.ann-toolbar button[data-tool="textbox"]').click();
  await window.waitForTimeout(200);
  await window.mouse.click(pbox.x + 300, pbox.y + 400);
  await window.waitForTimeout(500);
  const bar = await window.locator('[data-annotation-action-bar="textbox"]').count();
  const editor = await window.locator('[data-annotation-editor="textbox"]').count();
  const committed = await window.locator('.ann[data-kind="textbox"]').count();
  console.log('CONTROL textbox no-sign: bar=', bar, 'editor=', editor, 'committed=', committed);
  await snap('b2-control-textbox-nosign');
  // clean up
  const confirm = window.locator('[data-annotation-action="textbox-confirm"]');
  if (await confirm.count()) { await confirm.click({ force: true }); }
  await window.waitForTimeout(300);
});

// The EXACT BUG-2 path: use Sign (place+confirm) THEN textbox single-click.
test('AFTER-SIGN: textbox single-click creates bar', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  const page = window.locator('.pdf-page').first();
  const pbox = await page.boundingBox();

  // Sign flow
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
  const sigToolbar = await window.locator('button[aria-label="Sign tool"]').getAttribute('aria-pressed');
  console.log('AFTER-SIGN sig toolbar pressed:', sigToolbar);

  // textbox after sign
  await window.locator('.ann-toolbar button[data-tool="textbox"]').click();
  await window.waitForTimeout(200);
  const tbActive = await window.locator('.ann-toolbar button[data-tool="textbox"]').getAttribute('aria-pressed');
  await window.mouse.click(pbox.x + 300, pbox.y + 400);
  await window.waitForTimeout(600);
  const bar = await window.locator('[data-annotation-action-bar="textbox"]').count();
  const editor = await window.locator('[data-annotation-editor="textbox"]').count();
  const committed = await window.locator('.ann[data-kind="textbox"]').count();
  const sigPending = await window.locator('[data-sig-pending]').count();
  console.log('AFTER-SIGN textbox: active=', tbActive, 'bar=', bar, 'editor=', editor, 'committed=', committed, 'sigPending=', sigPending);
  await snap('b2-after-sign-textbox');
});
