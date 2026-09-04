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
async function snap(name) { await window.screenshot({ path: `screenshots/${name}.png` }); }

test.beforeEach(async () => { await launch(); });
test.afterEach(async () => { await close(); });

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

test('BUG-10c: "+" new empty tab inherits armed Sign tool / annotation tool', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');

  // Case 1: armed Sign tool then new "+" tab
  await createAndArmSignature();
  const signBefore = await window.locator('button[aria-label="Sign tool"]').getAttribute('aria-pressed');
  const armedBefore = await window.locator('.signatures-layer').first().getAttribute('data-armed');
  console.log('BUG10c sign before new tab:', signBefore, 'armed:', armedBefore);

  // click "+" new tab
  await window.click('[data-new-tab]').catch(async () => {
    await window.evaluate(() => {
      const b = document.querySelector('[class*="new-tab"], [aria-label*="New tab"], [class*="tab-add"]');
      if (b) b.click();
    });
  });
  await window.waitForTimeout(1000);
  const tabs = await window.evaluate(() => document.querySelectorAll('.tab').length);
  console.log('BUG10c tab count after new tab:', tabs);
  const activeTabText = await window.evaluate(() => document.querySelector('.tab-active')?.textContent || null);
  console.log('BUG10c active tab text:', activeTabText);
  // NOTE: on an empty tab the document toolbar (Sign button) is not rendered
  const signBtnOnEmptyTab = await window.locator('button[aria-label="Sign tool"]').count();
  console.log('BUG10c Sign button present on empty tab?', signBtnOnEmptyTab);
  await snap('bug10c-new-empty-tab');

  // open a doc into the new active empty tab and check whether Sign is still armed
  const beforeOpen = await window.evaluate(() => window.tflexDiagnostics());
  console.log('BUG10c diag before opening doc in new tab: openTabs=', beforeOpen.openTabs, 'activeTool=', beforeOpen.activeTool);
  await window.click('.sample-card:has-text("form.pdf")');
  await window.waitForTimeout(2500);
  const activeTab = await window.evaluate(() => document.querySelector('.tab-active')?.textContent || null);
  const signCount = await window.locator('button[aria-label="Sign tool"]').count();
  const signActives = await window.evaluate(() => {
    return Array.from(document.querySelectorAll('button[aria-label="Sign tool"]')).map(b => b.getAttribute('aria-pressed') + '|' + b.className);
  });
  const armedActive = await window.locator('.signatures-layer').last().getAttribute('data-armed');
  console.log('BUG10c activeTab after open:', activeTab, 'signBtnCount=', signCount, 'signActives=', JSON.stringify(signActives), 'armedActive(last)=', armedActive);
  await snap('bug10c-doc-opened-in-new-tab');
});

test('BUG-14b: OCR on text PDF yields "no low-confidence words" toast / blank page', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  await window.click('[data-tools-toggle]');
  await window.waitForSelector('[data-tools-palette]');
  await window.click('[data-tool-id="recognizeText"]');
  await window.waitForSelector('.ocr-dialog', { timeout: 10000 });
  const curScope = window.locator('[data-ocr-scope="currentPage"]');
  if (await curScope.count()) { await curScope.check({ force: true }); }
  await window.waitForTimeout(300);

  // observe page before OCR
  const before = await window.evaluate(() => ({
    spans: document.querySelectorAll('.textLayer span').length,
    canvas: document.querySelectorAll('.pdf-page canvas').length,
  }));
  console.log('BUG14b before OCR:', JSON.stringify(before));

  await window.click('[data-ocr-confirm]');
  let toastText = '';
  for (let i = 0; i < 50; i++) {
    await window.waitForTimeout(1000);
    const s = await window.evaluate(() => ({
      dlg: !!document.querySelector('.ocr-dialog'),
      toast: (document.querySelector('.toast, .toast-info, [class*="toast"]')?.textContent || ''),
    }));
    toastText = s.toast;
    if (!s.dlg && toastText) break;
  }
  console.log('BUG14b toast:', toastText);
  await snap('bug14b-after-ocr');
  const after = await window.evaluate(() => ({
    spans: document.querySelectorAll('.textLayer span').length,
    canvas: document.querySelectorAll('.pdf-page canvas').length,
    bodyStart: document.body.innerText.slice(0, 150),
  }));
  console.log('BUG14b after OCR:', JSON.stringify(after, null, 2));
});
