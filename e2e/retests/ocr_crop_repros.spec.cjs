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

test('BUG-14: Recognize Text blank screen + no low-confidence toast + suspects behind shapes bar + persists to new tab', async () => {
  test.setTimeout(180000);
  await openSample('scanned.pdf');
  const d0 = await window.evaluate(() => window.tflexDiagnostics());
  console.log('BUG14 scanned pageCount:', d0.pageCount, 'activeTool:', d0.activeTool);

  // open OCR dialog
  await window.click('[data-tools-toggle]');
  await window.waitForSelector('[data-tools-palette]');
  await window.click('[data-tool-id="recognizeText"]');
  await window.waitForSelector('.ocr-dialog', { timeout: 10000 });
  await snap('bug14-ocr-dialog');

  // choose current page scope (fast)
  const curScope = window.locator('[data-ocr-scope="currentPage"]');
  if (await curScope.count()) { await curScope.check({ force: true }); }
  await window.waitForTimeout(300);

  // run OCR
  await window.click('[data-ocr-confirm]');
  // poll for the OCR dialog to close and a toast to appear
  let dialogGone = false;
  let toastText = '';
  for (let i = 0; i < 60; i++) {
    await window.waitForTimeout(1000);
    const s = await window.evaluate(() => ({
      dlg: !!document.querySelector('.ocr-dialog'),
      toast: (document.querySelector('.toast, .toast-info, [class*="toast"]')?.textContent || ''),
      panel: !!document.querySelector('[data-ocr-suspects-panel]'),
    }));
    toastText = s.toast;
    if (!s.dlg) { dialogGone = true; }
    if (dialogGone && (s.panel || s.toast)) break;
  }
  console.log('BUG14 dialogGone:', dialogGone, 'toastText:', toastText);
  await window.waitForTimeout(1500);
  await snap('bug14-after-ocr');

  const state = await window.evaluate(() => {
    const t = (sel) => { const e = document.querySelector(sel); return e ? e.textContent : null; };
    const pg = document.querySelector('.pdf-page');
    const pgRect = pg ? pg.getBoundingClientRect() : null;
    const panel = document.querySelector('[data-ocr-suspects-panel]');
    const panelRect = panel ? panel.getBoundingClientRect() : null;
    const annToolbar = document.querySelector('.ann-toolbar');
    const annRect = annToolbar ? annToolbar.getBoundingClientRect() : null;
    // detect blank page: count text spans
    const textSpans = document.querySelectorAll('.textLayer span').length;
    const canvasCount = document.querySelectorAll('.pdf-page canvas').length;
    return {
      toast: t('.toast, .toast-info, [class*="toast"]'),
      ocrError: t('[data-ocr-error]'),
      suspectsPanel: !!panel,
      panelRect: panelRect ? { x: Math.round(panelRect.x), y: Math.round(panelRect.y), w: Math.round(panelRect.width), h: Math.round(panelRect.height) } : null,
      annRect: annRect ? { x: Math.round(annRect.x), y: Math.round(annRect.y), w: Math.round(annRect.width), h: Math.round(annRect.height) } : null,
      textSpans,
      canvasCount,
      pgRect: pgRect ? { x: Math.round(pgRect.x), y: Math.round(pgRect.y), w: Math.round(pgRect.width), h: Math.round(pgRect.height) } : null,
      panelOverlapsToolbar: panelRect && annRect ? (panelRect.y < annRect.y + annRect.height) : false,
      panelText: panel ? panel.textContent.slice(0, 120) : null,
    };
  });
  console.log('BUG14 after-OCR state:', JSON.stringify(state, null, 2));

  // Now open a new empty tab and check if blank page + suspects persist
  await window.click('[data-new-tab]').catch(async () => {
    // find a "+" new tab button
    await window.evaluate(() => {
      const b = document.querySelector('[class*="new-tab"], [aria-label*="New tab"], [class*="tab-add"]');
      if (b) b.click();
    });
  });
  await window.waitForTimeout(1500);
  await snap('bug14-new-tab');
  const newTabState = await window.evaluate(() => {
    const panel = document.querySelector('[data-ocr-suspects-panel]');
    const texts = document.querySelectorAll('.textLayer span').length;
    const pg = document.querySelector('.pdf-page');
    return {
      suspectsPanel: !!panel,
      suspectsText: panel ? panel.textContent.slice(0, 200) : null,
      textSpans: texts,
      hasPage: !!pg,
      bodyStart: document.body.innerText.slice(0, 120),
    };
  });
  console.log('BUG14 new-tab state:', JSON.stringify(newTabState, null, 2));
});

test('BUG-20: crop box adjustment causes flicker/artifact window', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');
  await window.click('[data-tools-toggle]');
  await window.waitForSelector('[data-tools-palette]');
  await window.click('[data-tool-id="cropPages"]');
  await window.waitForSelector('[data-crop-pages-dialog]', { timeout: 10000 });
  await window.waitForTimeout(500);
  await snap('bug20-crop-dialog');

  // grab the crop editor canvas/handles if present
  const editor = window.locator('[data-crop-editor]');
  const editorCount = await editor.count();
  console.log('BUG20 crop editor count:', editorCount);
  if (editorCount > 0) {
    const handle = window.locator('[data-crop-handle="se"]').first();
    const hbox = await handle.boundingBox();
    console.log('BUG20 se handle box:', JSON.stringify(hbox));
    if (hbox) {
      // drag the SE handle outward, capturing MID-DRAG to catch any artifact window
      for (let i = 0; i < 3; i++) {
        await window.mouse.move(hbox.x + 5, hbox.y + 5);
        await window.mouse.down();
        await window.mouse.move(hbox.x + 120, hbox.y + 120, { steps: 20 });
        // MID-DRAG screenshot + DOM scan
        const mid = await window.evaluate(() => {
          const dialog = document.querySelector('.modal-backdrop');
          const extra = document.querySelectorAll('.modal, .dialog, .modal-dialog, [data-crop-editor]').length;
          const docCount = document.querySelectorAll('[class*="artifact"], [class*="ghost"], [class*="crop-float"]').length;
          return { modalCount: document.querySelectorAll('.modal-backdrop').length, extra, docCount };
        });
        console.log(`BUG20 mid-drag ${i} DOM scan:`, JSON.stringify(mid));
        await window.screenshot({ path: `screenshots/bug20-middrag-${i}.png` });
        await window.mouse.up();
        await window.waitForTimeout(250);
      }
      // final crop rect values
      const cropVals = await window.evaluate(() => {
        const inputs = document.querySelectorAll('[class*="crop"] input, [class*="crop"] [class*="input"]');
        const arr = [];
        inputs.forEach((inp) => arr.push({ name: inp.getAttribute('aria-label') || inp.placeholder || inp.className, val: inp.value }));
        return arr;
      });
      console.log('BUG20 crop rect values after drag:', JSON.stringify(cropVals));
    }
  } else {
    // maybe need confirm to reach the editor
    const confirm = window.locator('[data-crop-confirm]');
    console.log('BUG20 crop confirm count:', await confirm.count());
    await snap('bug20-crop-no-editor');
  }
});
