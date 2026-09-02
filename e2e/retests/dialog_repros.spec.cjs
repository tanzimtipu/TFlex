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
async function diag() { return await window.evaluate(() => window.tflexDiagnostics()); }
async function snap(name) { await window.screenshot({ path: `screenshots/${name}.png` }); }

test.beforeEach(async () => { await launch(); });
test.afterEach(async () => { await close(); });

test('BUG-11: palette Delete page only toasts, no current/custom/range dialog', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');

  // open tools palette
  await window.click('[data-tools-toggle]');
  await window.waitForSelector('[data-tools-palette]');
  // click palette Delete page
  await window.click('[data-tool-id="delete"]');
  await window.waitForTimeout(600);

  const toastAfterPalette = await window.evaluate(() => document.querySelector('.toast, .toast-info, [class*="toast"]')?.textContent || null);
  console.log('BUG11 toast after palette delete:', toastAfterPalette);
  const dialogAfterPalette = await window.locator('[data-delete-pages-dialog]').count();
  console.log('BUG11 dialog visible after palette delete:', dialogAfterPalette);
  await snap('bug11-palette-delete-toast');

  // Now select a thumbnail in the left rail
  const railThumb = window.locator('.thumb-item').first();
  if (await railThumb.count()) {
    await railThumb.click();
    await window.waitForTimeout(600);
    const dialogAfterThumb = await window.locator('[data-delete-pages-dialog]').count();
    console.log('BUG11 dialog after selecting thumbnail:', dialogAfterThumb);
    const toastAfter = await window.evaluate(() => document.querySelector('.toast, .toast-info, [class*="toast"]')?.textContent || null);
    console.log('BUG11 toast after selecting thumbnail:', toastAfter);
    await snap('bug11-after-thumb-select');
  } else {
    console.log('BUG11 no rail thumb found');
  }
});

test('BUG-19: Add blank page adds more than one page / label / no render', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  const before = await diag();
  console.log('BUG19 pageCount before:', before.pageCount);

  await window.click('[data-tools-toggle]');
  await window.waitForSelector('[data-tools-palette]');
  await window.click('[data-tool-id="insertPages"]');
  await window.waitForSelector('[data-insert-pages-dialog]');
  await window.waitForTimeout(300);

  // default mode is blank; click Insert
  await window.click('[data-insert-confirm]');
  await window.waitForTimeout(2000);

  const after = await diag();
  console.log('BUG19 pageCount after insert blank:', after.pageCount);
  await snap('bug19-after-insert-blank');

  // Inspect the last page DOM
  const lastPage = await window.evaluate(() => {
    const pages = document.querySelectorAll('.pdf-page');
    const last = pages[pages.length - 1];
    if (!last) return { count: pages.length, last: null };
    const r = last.getBoundingClientRect();
    const bg = window.getComputedStyle(last).backgroundColor;
    const label = last.getAttribute('data-page-number');
    const pageNumEl = last.querySelector('[class*="page-number"], [class*="page-label"], [class*="page-num"]');
    return {
      count: pages.length,
      last: { w: Math.round(r.width), h: Math.round(r.height), bg, dataPage: label, labelText: pageNumEl ? pageNumEl.textContent : null },
    };
  });
  console.log('BUG19 last page:', JSON.stringify(lastPage, null, 2));

  const sidebarLabels = await window.evaluate(() => {
    return Array.from(document.querySelectorAll('.thumb-item [class*="label"], .thumb-item [class*="page"]')).map(e => e.textContent.trim()).slice(-6);
  });
  console.log('BUG19 sidebar labels tail:', JSON.stringify(sidebarLabels));
});

test('BUG-12: DOCX export throws undefined inner error', async () => {
  test.setTimeout(120000);
  const errors = [];
  electronApp.on('window', win => {
    win.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
    win.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE-ERR: ' + m.text()); });
  });

  await openSample('report.pdf');
  await window.click('[data-tools-toggle]');
  await window.waitForSelector('[data-tools-palette]');
  await window.click('[data-tool-id="exportDocx"]');
  await window.waitForSelector('[data-docx-export-dialog]');
  await window.waitForTimeout(400);
  await snap('bug12-docx-dialog');

  await window.click('[data-docx-export-confirm]');
  await window.waitForTimeout(8000);

  const status = await window.evaluate(() => {
    const s = document.querySelector('[data-docx-export-dialog] .modal-status');
    return s ? s.textContent : null;
  });
  console.log('BUG12 dialog status:', status);
  console.log('BUG12 errors:', JSON.stringify(errors));
  await snap('bug12-after-export');
});

test('BUG-11b: toolbar Delete opens the current/custom/range dialog (control)', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  await window.click('[data-toolbar-delete-pages]');
  await window.waitForTimeout(600);
  const dialogVisible = await window.locator('[data-delete-pages-dialog]').count();
  const modeCurrent = await window.locator('[data-delete-mode="current"]').count();
  const modeRange = await window.locator('[data-delete-mode="range"]').count();
  const rangeInput = await window.locator('[data-delete-range]').count();
  console.log('BUG11b toolbar delete dialog visible=', dialogVisible, 'modeCurrent=', modeCurrent, 'modeRange=', modeRange, 'rangeInput=', rangeInput);
  await snap('bug11b-toolbar-delete-dialog');
});

test('BUG-17: Insert/Replace pages dialog closes when mouse leaves after highlighting text', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  await window.click('[data-tools-toggle]');
  await window.waitForSelector('[data-tools-palette]');
  await window.click('[data-tool-id="insertPages"]');
  await window.waitForSelector('[data-insert-pages-dialog]');
  await window.waitForTimeout(300);

  // focus the position input and fill text
  const posInput = window.locator('[data-insert-position]');
  await posInput.click();
  await posInput.fill('2');
  await window.waitForTimeout(300);

  // Simulate a text-selection drag that starts in the input and ends on the backdrop
  const inputBox = await posInput.boundingBox();
  const dialogBox = await window.locator('[data-insert-pages-dialog]').boundingBox();
  const modalBox = await window.locator('[data-insert-pages-dialog] .modal-dialog').boundingBox();
  console.log('BUG17 inputBox:', JSON.stringify(inputBox), 'modalBox:', JSON.stringify(modalBox));
  if (inputBox && modalBox) {
    // mouse down at input, drag to a backdrop point to the LEFT of the dialog, mouse up
    const backdropX = modalBox.x - 120;
    const backdropY = modalBox.y + modalBox.height / 2;
    await window.mouse.move(inputBox.x + 20, inputBox.y + inputBox.height / 2);
    await window.mouse.down();
    await window.mouse.move(backdropX, backdropY, { steps: 8 });
    await window.mouse.up();
    await window.waitForTimeout(600);
  }
  const stillOpen = await window.locator('[data-insert-pages-dialog]').count();
  console.log('BUG17 insert dialog still open after text-highlight drag ending outside:', stillOpen);
  await snap('bug17-after-outside-drag');
});

test('BUG-17b: Insert pages dialog closes on plain outside click (backdrop)', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  await window.click('[data-tools-toggle]');
  await window.waitForSelector('[data-tools-palette]');
  await window.click('[data-tool-id="insertPages"]');
  await window.waitForSelector('[data-insert-pages-dialog]');
  await window.waitForTimeout(300);

  const modalBox = await window.locator('[data-insert-pages-dialog] .modal-dialog').boundingBox();
  await window.mouse.click(modalBox.x - 120, modalBox.y + modalBox.height / 2);
  await window.waitForTimeout(600);
  const stillOpen = await window.locator('[data-insert-pages-dialog]').count();
  console.log('BUG17b insert dialog still open after outside click:', stillOpen);
});
