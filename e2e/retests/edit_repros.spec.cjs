const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
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
async function close() { if (electronApp) await hardClose(electronApp); electronApp = null; }
async function openSample(name) {
  await window.click(`.sample-card:has-text("${name}")`);
  await window.waitForSelector('.workspace', { timeout: 15000 });
  await window.waitForTimeout(1200);
}
async function snap(name) { await window.screenshot({ path: `screenshots/${name}.png` }); }

test.beforeEach(async () => { await launch(); });
test.afterEach(async () => { await close(); });

test('BUG-6: edit mode does not edit text', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  const page = window.locator('.pdf-page').first();
  const pbox = await page.boundingBox();

  // enter edit mode + choose Edit text tool
  await window.click('[data-toolbar-edit-toggle]');
  await window.waitForSelector('[data-edit-toolbar]');
  await window.click('[data-edit-tool="text"]');
  await window.waitForTimeout(300);

  // Dump text-layer spans to find a reliable text click point
  const spans = await window.evaluate(() => {
    const out = [];
    document.querySelectorAll('.textLayer span, .textLayer [class*="text"]').forEach((s) => {
      const r = s.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: (s.textContent || '').slice(0, 30) });
    });
    return out.slice(0, 30);
  });
  console.log('BUG6 text spans:', JSON.stringify(spans, null, 2));

  if (spans.length > 0) {
    // hover over the visible title span
    const s = spans.find(x => x.y > 140 && x.y < 880 && x.w > 20 && x.h > 5) || spans[0];
    await window.mouse.move(s.x + s.w / 2, s.y + s.h / 2);
    await window.waitForTimeout(400);
    const hoverCount = await window.locator('.edit-text-hover').count();
    console.log('BUG6 hover rect count over title:', hoverCount);
    // edit overlay presence + pointer-events
    const overlayInfo = await window.evaluate(() => {
      const o = document.querySelector('.edit-overlay');
      if (!o) return { present: false };
      const st = window.getComputedStyle(o);
      return { present: true, pe: st.pointerEvents, z: st.zIndex, display: st.display };
    });
    console.log('BUG6 edit overlay info:', JSON.stringify(overlayInfo));
    // Now click
    await window.mouse.click(s.x + s.w / 2, s.y + s.h / 2);
    await window.waitForTimeout(500);
    const editorCount = await window.locator('[data-edit-editor="text"]').count();
    console.log('BUG6 edit editor count after clicking text span at', JSON.stringify({x:s.x,y:s.y}), '=', editorCount);
    if (editorCount > 0) {
      const val = await window.locator('[data-edit-textarea]').inputValue().catch(() => null);
      console.log('BUG6 editor value:', val);
      await snap('bug6-edit-editor-open');
    } else {
      await snap('bug6-edit-attempt');
    }
  } else {
    console.log('BUG6 no text spans found');
    await snap('bug6-edit-attempt');
  }
});

test('BUG-16: Add Box editor dropdowns unresponsive / close the box', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  const page = window.locator('.pdf-page').first();
  const pbox = await page.boundingBox();

  // enter edit mode + choose Add box tool
  await window.click('[data-toolbar-edit-toggle]');
  await window.waitForSelector('[data-edit-toolbar]');
  await window.click('[data-edit-tool="box"]');
  await window.waitForTimeout(300);

  // drag on page to place box
  await window.mouse.move(pbox.x + 300, pbox.y + 400);
  await window.mouse.down();
  await window.mouse.move(pbox.x + 500, pbox.y + 480, { steps: 6 });
  await window.mouse.up();
  await window.waitForTimeout(500);

  const editorCount = await window.locator('[data-edit-editor="box"]').count();
  console.log('BUG16 box editor count:', editorCount);
  await snap('bug16-box-editor');

  if (editorCount > 0) {
    // Try to open the Font dropdown
    const fontSelect = window.locator('[data-edit-editor="box"] select[aria-label="Font"]');
    if (await fontSelect.count()) {
      const before = await fontSelect.inputValue().catch(() => null);
      // click the select to open dropdown
      await fontSelect.click();
      await window.waitForTimeout(400);
      // Press ArrowDown then Enter to select next font
      await window.keyboard.press('ArrowDown');
      await window.keyboard.press('Enter');
      await window.waitForTimeout(500);
      const after = await fontSelect.inputValue().catch(() => null);
      const editorStillOpen = await window.locator('[data-edit-editor="box"]').count();
      console.log('BUG16 fontBefore=', before, 'fontAfter=', after, 'editorStillOpen=', editorStillOpen);
      await snap('bug16-after-font-interaction');
      // Distinguish: does onChange fire via selectOption (programmatic)?
      const viaSelectOption = await fontSelect.selectOption('Times').then(() => fontSelect.inputValue()).catch(() => 'ERR');
      console.log('BUG16 fontAfterSelectOption=', viaSelectOption);
      const editorStillOpen3 = await window.locator('[data-edit-editor="box"]').count();
      console.log('BUG16 editorStillOpen after selectOption=', editorStillOpen3);
    }
    // Try Background select
    const bgSelect = window.locator('[data-edit-editor="box"] select[aria-label="Text box background"]');
    if (await bgSelect.count()) {
      const beforeBg = await bgSelect.inputValue().catch(() => null);
      await bgSelect.click();
      await window.waitForTimeout(300);
      await window.keyboard.press('ArrowDown');
      await window.keyboard.press('Enter');
      await window.waitForTimeout(400);
      const afterBg = await bgSelect.inputValue().catch(() => null);
      const editorStillOpen2 = await window.locator('[data-edit-editor="box"]').count();
      console.log('BUG16 bgBefore=', beforeBg, 'bgAfter=', afterBg, 'editorStillOpen2=', editorStillOpen2);
    }
  }
});
