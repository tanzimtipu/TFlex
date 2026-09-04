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

test('BUG-3: custom hex color does not render after confirming a shape', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  const page = window.locator('.pdf-page').first();
  const pbox = await page.boundingBox();

  // arm rect tool
  await window.locator('.ann-toolbar button[data-tool="rect"]').click();
  await window.waitForTimeout(200);
  // open the color popover
  await window.click('.ann-color-swatch-main');
  await window.waitForSelector('.color-popover', { timeout: 5000 });
  await snap('bug3-color-popover');
  // type custom hex + Enter
  await window.fill('input[aria-label="Custom color hex"]', '#00ff00');
  await window.press('input[aria-label="Custom color hex"]', 'Enter');
  await window.waitForTimeout(300);
  const customHexApplied = await window.locator('.ann-color-swatch-main').getAttribute('data-color-current');
  console.log('BUG3 data-color-current after Enter:', customHexApplied);
  // close popover
  await window.keyboard.press('Escape');
  await window.waitForTimeout(300);

  // Drag a rect on the page
  await window.mouse.move(pbox.x + 300, pbox.y + 500);
  await window.mouse.down();
  await window.mouse.move(pbox.x + 500, pbox.y + 650, { steps: 6 });
  await window.mouse.up();
  await window.waitForTimeout(600);

  const rectInfo = await window.evaluate(() => {
    const el = document.querySelector('.ann[data-kind="rect"]');
    if (!el) return { present: false };
    return { present: true, stroke: el.getAttribute('stroke'), fill: el.getAttribute('fill') };
  });
  console.log('BUG3 committed rect:', JSON.stringify(rectInfo));
  await snap('bug3-committed-rect');

  const diag = await window.evaluate(() => window.tflexDiagnostics());
  console.log('BUG3 engine annotations:', JSON.stringify(diag.engineState?.annotations));
});

test('BUG-4: sticky note text not visible inside after apply', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  const page = window.locator('.pdf-page').first();
  const pbox = await page.boundingBox();

  await window.locator('.ann-toolbar button[data-tool="note"]').click();
  await window.waitForTimeout(200);
  await window.mouse.click(pbox.x + 400, pbox.y + 400);
  await window.waitForTimeout(400);
  const editorOpen = await window.locator('[data-annotation-editor="note"]').count();
  console.log('BUG4 note editor open:', editorOpen);
  // type text
  const editor = window.locator('[data-annotation-editor="note"] textarea, [data-annotation-editor="note"] input');
  if (await editor.count()) { await editor.first().fill('Hello sticky note'); }
  await window.waitForTimeout(200);
  await snap('bug4-note-editor');
  // confirm
  await window.locator('[data-annotation-action="note-confirm"]').first().click({ force: true });
  await window.waitForTimeout(600);

  const noteInfo = await window.evaluate(() => {
    const icon = document.querySelector('.ann[data-kind="note"]');
    if (!icon) return { present: false };
    const textEl = icon.querySelector('.ann-note-text');
    const rect = icon.getBoundingClientRect();
    let textRect = null;
    if (textEl) { const r = textEl.getBoundingClientRect(); textRect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: textEl.textContent }; }
    return {
      present: true,
      iconRect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      textElPresent: !!textEl,
      textRect,
      computedColor: window.getComputedStyle(icon).color,
    };
  });
  console.log('BUG4 note info:', JSON.stringify(noteInfo, null, 2));
  await snap('bug4-committed-note');
});

test('BUG-5: sticky note has no Sign-like selector; icon+text separated', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  const page = window.locator('.pdf-page').first();
  const pbox = await page.boundingBox();

  await window.locator('.ann-toolbar button[data-tool="note"]').click();
  await window.waitForTimeout(200);
  await window.mouse.click(pbox.x + 400, pbox.y + 400);
  await window.waitForTimeout(400);
  const editor = window.locator('[data-annotation-editor="note"] textarea, [data-annotation-editor="note"] input');
  if (await editor.count()) { await editor.first().fill('Note for BUG-5'); }
  await window.locator('[data-annotation-action="note-confirm"]').first().click({ force: true });
  await window.waitForTimeout(600);

  // now click the committed note icon
  const icon = window.locator('.ann[data-kind="note"]').first();
  const ibox = await icon.boundingBox();
  if (ibox) {
    await window.mouse.click(ibox.x + ibox.width / 2, ibox.y + ibox.height / 2);
    await window.waitForTimeout(600);
  }
  const afterClick = await window.evaluate(() => {
    const icon = document.querySelector('.ann[data-kind="note"]');
    const iconRect = icon ? icon.getBoundingClientRect() : null;
    // signed-like selector handles present?
    const selHandles = document.querySelectorAll('.ann[data-kind="note"] .sig-handle, .ann[data-kind="note"] [class*="handle"]').length;
    const anySelection = document.querySelector('.ann[data-kind="note"] [class*="selected"], .ann[data-kind="note"][class*="selected"]') ? true : false;
    const textEl = icon ? icon.querySelector('.ann-note-text') : null;
    let textRect = null;
    if (icon && textEl) { const r = textEl.getBoundingClientRect(); textRect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; }
    return {
      iconRect: iconRect ? { x: Math.round(iconRect.x), y: Math.round(iconRect.y), w: Math.round(iconRect.width), h: Math.round(iconRect.height) } : null,
      selHandles,
      anySelection,
      textRect,
      editorOpenAfterClick: !!document.querySelector('[data-annotation-editor="note"]'),
    };
  });
  console.log('BUG5 after note click:', JSON.stringify(afterClick, null, 2));
  await snap('bug5-note-after-click');
});
