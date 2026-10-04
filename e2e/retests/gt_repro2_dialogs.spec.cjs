// Ground-truth reproduction (Bugs 3, 6, 7, 8, 10) on the DEV build (originally written against the installed app).
const { test, expect } = require('@playwright/test');
const { hardClose, runTool } = require('../lib/helpers.cjs');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const path = require('node:path');
const SCREENSHOT_DIR = path.resolve(__dirname, '..', '..', 'screenshots');

let electronApp;
let win;

test.beforeEach(async () => {
  electronApp = await launchApp([]);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
});

test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
});

async function openReport() {
  const samplePath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, samplePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [samplePath] });
  }, samplePath);
  await win.click('[data-home-tool="open"]');
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);
}

// Phase 36 migration: the All-tools palette is retired; each tool is a stage
// Action Dock verb now (inline or the "More" overflow lane). The dialogs and
// assertions below are unchanged.

test('Bug 3/6: DOCX export drag-highlight out of window closes dialog (no guard)', async () => {
  await openReport();
  await runTool(win, 'exportDocx');
  await win.waitForSelector('[data-docx-export-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SCREENSHOT_DIR, 'gt-bug3-docx-open.png') });

  const input = win.locator('[data-docx-export-range]');
  const ibox = await input.boundingBox();
  // mousedown inside the page-range input
  await win.mouse.move(ibox.x + ibox.width / 2, ibox.y + ibox.height / 2);
  await win.mouse.down();
  // drag the cursor far OUTSIDE the dialog (onto the backdrop / app edge)
  await win.mouse.move(8, 8, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(700);
  const stillOpen = await win.locator('[data-docx-export-dialog]').count();
  console.log('[BUG3] docx dialog still open after drag-out=', stillOpen);
  await win.screenshot({ path: path.join(SCREENSHOT_DIR, 'gt-bug3-after-drag-out.png') });
});

test('Bug 6 positive control: InsertPages dialog does NOT close on drag-out (B17 guard)', async () => {
  await openReport();
  await runTool(win, 'insertPages');
  await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);

  const input = win.locator('[data-insert-position]');
  const ibox = await input.boundingBox();
  await win.mouse.move(ibox.x + ibox.width / 2, ibox.y + ibox.height / 2);
  await win.mouse.down();
  await win.mouse.move(8, 8, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(700);
  const stillOpen = await win.locator('[data-insert-pages-dialog]').count();
  console.log('[BUG6-CTRL] insert-pages still open after drag-out=', stillOpen);
});

test('Bug 7: insert blank after page 1 -> thumbnail rail state', async () => {
  await openReport();
  const d0 = await win.evaluate(() => window.tflexDiagnostics());
  console.log('[BUG7] pageCount before=', d0.pageCount);
  await runTool(win, 'insertPages');
  await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 10000 });
  await win.fill('[data-insert-position]', '2');
  await win.waitForTimeout(200);
  await win.click('[data-insert-confirm]');
  await win.waitForTimeout(1800);

  const d1 = await win.evaluate(() => window.tflexDiagnostics());
  console.log('[BUG7] pageCount after=', d1.pageCount, 'pageOrder=', JSON.stringify(d1.engineState?.pageOrder));
  // Read the LEFT thumbnail rail
  const thumbs = await win.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.thumb-item'));
    return items.slice(0, 6).map((it) => ({ page: it.getAttribute('data-page'), src: it.getAttribute('data-source-page'), label: it.querySelector('.thumb-label')?.textContent }));
  });
  console.log('[BUG7] first thumbs=', JSON.stringify(thumbs));
  const thumbCount = await win.locator('.thumb-item').count();
  console.log('[BUG7] thumbCount=', thumbCount);
  // Blank page: nothing on it?
  const page2 = win.locator('.page-slot').nth(1);
  await page2.scrollIntoViewIfNeeded();
  await win.waitForTimeout(600);
  const p2Info = await win.evaluate(() => {
    const slots = document.querySelectorAll('.page-slot');
    const s = slots[1];
    if (!s) return null;
    const canvas = s.querySelector('canvas');
    const textSpans = s.querySelectorAll('.textLayer span').length;
    return { canvas: canvas ? 1 : 0, textSpans };
  });
  console.log('[BUG7] page2 blank check=', JSON.stringify(p2Info));
  await win.screenshot({ path: path.join(SCREENSHOT_DIR, 'gt-bug7-thumb-after-insert.png') });
});

test('Bug 8: crop mode-switch flicker + per-page crops all + undo not rendering', async () => {
  await openReport();
  await runTool(win, 'cropPages');
  await win.waitForSelector('[data-crop-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(600);

  // Instrument the engine cropPages to capture the entries it receives.
  const instrument = await win.evaluate(() => {
    const eng = window.tflex.engine;
    if (!eng || typeof eng.cropPages !== 'function') return false;
    const orig = eng.cropPages.bind(eng);
    window.__capturedCrop = [];
    eng.cropPages = async (docId, entries) => {
      window.__capturedCrop = entries;
      return orig(docId, entries);
    };
    return true;
  });
  console.log('[BUG8] cropPages instrumented=', instrument);

  // Sample the crop canvas inside the dialog across the mode switch.
  async function sampleCanvas(frameLabel) {
    return win.evaluate((label) => {
      const c = document.querySelector('[data-crop-canvas]');
      if (!c) return { label, canvas: false };
      const cs = getComputedStyle(c);
      const r = c.getBoundingClientRect();
      return { label, canvas: true, opacity: cs.opacity, w: Math.round(r.width), h: Math.round(r.height), node: c.dataset.canvasTag ?? 'none' };
    }, frameLabel);
  }

  // perPage mode
  await win.click('[data-crop-mode="perPage"]');
  const framesPer = [];
  for (let i = 0; i < 5; i += 1) { framesPer.push(await sampleCanvas('per-f' + i)); await win.waitForTimeout(60); }
  console.log('[BUG8] perPage frames=', JSON.stringify(framesPer));

  // allPages mode (switch back)
  await win.click('[data-crop-mode="allPages"]');
  const framesAll = [];
  for (let i = 0; i < 5; i += 1) { framesAll.push(await sampleCanvas('all-f' + i)); await win.waitForTimeout(60); }
  console.log('[BUG8] allPages frames=', JSON.stringify(framesAll));

  // Now set perPage mode, adjust a box on page 1 only, apply.
  await win.click('[data-crop-mode="perPage"]');
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SCREENSHOT_DIR, 'gt-bug8-perpage-open.png') });
  // Drag the SE handle a bit to "commit" a box for page 1
  const seHandle = win.locator('[data-crop-handle="se"]');
  let sb = await seHandle.boundingBox();
  if (sb) {
    await win.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await win.mouse.down();
    await win.mouse.move(sb.x + sb.width / 2 + 30, sb.y + sb.height / 2 + 30, { steps: 6 });
    await win.mouse.up();
    await win.waitForTimeout(300);
  }
  await win.screenshot({ path: path.join(SCREENSHOT_DIR, 'gt-bug8-before-apply.png') });
  const pageCountBefore = (await win.evaluate(() => window.tflexDiagnostics())).pageCount;
  await win.click('[data-crop-confirm]');
  await win.waitForTimeout(1500);
  const captured = await win.evaluate(() => window.__capturedCrop);
  const d1 = await win.evaluate(() => window.tflexDiagnostics());
  console.log('[BUG8] capturedCrop entries=', captured ? captured.length : null, 'pages=', captured ? captured.map(c => c.page).join(',') : null);
  console.log('[BUG8] pageCount before=', pageCountBefore, 'after=', d1.pageCount);
  await win.screenshot({ path: path.join(SCREENSHOT_DIR, 'gt-bug8-after-apply.png') });

  // Undo and observe whether the visual reverts.
  const slotBeforeUndo = await win.evaluate(() => {
    const s = document.querySelector('.page-slot');
    const c = s?.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(1200);
  const d2 = await win.evaluate(() => window.tflexDiagnostics());
  const slotAfterUndo = await win.evaluate(() => {
    const s = document.querySelector('.page-slot');
    const c = s?.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height) };
  });
  const sameCanvasTag = await win.evaluate(() => {
    const canvases = document.querySelectorAll('canvas');
    return canvases.length;
  });
  console.log('[BUG8] page-slot canvas before undo=', JSON.stringify(slotBeforeUndo), 'afterUndo=', JSON.stringify(slotAfterUndo));
  console.log('[BUG8] canUndo after undo=', d2.canUndo, 'canRedo=', d2.canRedo, 'modified=', d2.modified, 'canvasCount=', sameCanvasTag);
  await win.screenshot({ path: path.join(SCREENSHOT_DIR, 'gt-bug8-after-undo.png') });
});

test('Bug 10: minimize vs restore/maximize titlebar icons identical when maximized', async () => {
  await win.waitForTimeout(500);
  // Restored state
  await win.waitForSelector('[data-window-maximize]', { timeout: 10000 });
  const restored = await win.evaluate(() => {
    const min = document.querySelector('[data-window-minimize] svg');
    const max = document.querySelector('[data-window-maximize] svg');
    return { min: min?.outerHTML, max: max?.outerHTML, maxLabel: document.querySelector('[data-window-maximize]')?.getAttribute('title') };
  });
  console.log('[BUG10] restored maxLabel=', restored.maxLabel, 'identical=', restored.min === restored.max);
  await win.screenshot({ path: path.join(SCREENSHOT_DIR, 'gt-bug10-restored.png') });

  // Maximize
  await win.click('[data-window-maximize]');
  await win.waitForTimeout(1200);
  const maximized = await win.evaluate(() => {
    const min = document.querySelector('[data-window-minimize] svg');
    const max = document.querySelector('[data-window-maximize] svg');
    return { min: min?.outerHTML, max: max?.outerHTML, maxLabel: document.querySelector('[data-window-maximize]')?.getAttribute('title') };
  });
  const identical = maximized.min === maximized.max;
  console.log('[BUG10] maximized maxLabel=', maximized.maxLabel, 'min==max SVG=', identical);
  await win.screenshot({ path: path.join(SCREENSHOT_DIR, 'gt-bug10-maximized.png') });
});
