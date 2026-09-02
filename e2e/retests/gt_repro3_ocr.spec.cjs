// Ground-truth reproduction on the INSTALLED app. Bug 4 (OCR panel behind tools) + Bug 8b.
const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const path = require('node:path');

const EXE_PATH = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';
const SCREENSHOT_DIR = path.resolve(__dirname, '..', '..', 'screenshots');

let electronApp;
let win;

test.beforeEach(async () => {
  electronApp = await launchApp([], null, EXE_PATH);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
});

test.afterEach(async () => {
  if (electronApp) await electronApp.close();
});

async function openPdf(name) {
  const samplePath = getSamplePath(name);
  await electronApp.evaluate(async ({ dialog }, samplePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [samplePath] });
  }, samplePath);
  await win.click('button:has-text("Open PDF")');
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);
}

async function openTools() {
  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 10000 });
  await win.waitForTimeout(300);
}

test('Bug 4: OCR suspects panel behind tools panel + overlapping white text', async () => {
  await openPdf('scanned.pdf');
  await openTools();

  await win.click('[data-tool-id="recognizeText"]');
  await win.waitForSelector('button:has-text("Recognize text")', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SCREENSHOT_DIR, 'gt-bug4-ocr-dialog.png') });

  // Scope: current page, then run
  await win.click('[data-ocr-scope="currentPage"]');
  await win.waitForTimeout(200);
  await win.click('[data-ocr-confirm]');
  await win.waitForTimeout(500);

  // Wait for OCR to complete (suspects panel appears or progress gone)
  try {
    await win.waitForSelector('[data-ocr-suspects-panel]', { timeout: 60000 });
  } catch {
    console.log('[BUG4] suspects panel did not auto-open; trying palette button');
    await win.waitForTimeout(1000);
  }
  let suspectsVisible = await win.locator('[data-ocr-suspects-panel]').count();
  if (suspectsVisible === 0) {
    try { await win.click('[data-tool-id="ocrSuspects"]', { timeout: 3000 }); } catch (e) { console.log('[BUG4] could not click ocrSuspects:', e.message); }
    await win.waitForTimeout(800);
    suspectsVisible = await win.locator('[data-ocr-suspects-panel]').count();
  }
  console.log('[BUG4] suspects panel visible=', suspectsVisible);
  await win.screenshot({ path: path.join(SCREENSHOT_DIR, 'gt-bug4-after-ocr.png') });

  // Measure overlap between the suspects panel and the tools palette.
  const overlap = await win.evaluate(() => {
    const suspects = document.querySelector('[data-ocr-suspects-panel]');
    const tools = document.querySelector('[data-tools-palette]');
    if (!suspects || !tools) return { suspects: !!suspects, tools: !!tools };
    const s = suspects.getBoundingClientRect();
    const t = tools.getBoundingClientRect();
    // 2D intersection
    const ix = Math.max(0, Math.min(s.right, t.right) - Math.max(s.left, t.left));
    const iy = Math.max(0, Math.min(s.bottom, t.bottom) - Math.max(s.top, t.top));
    const overlapArea = ix * iy;
    const zs = Number(getComputedStyle(suspects).zIndex || 0);
    const zt = Number(getComputedStyle(tools).zIndex || 0);
    return { suspects: true, tools: true,
      suspectsRect: { x: Math.round(s.left), y: Math.round(s.top), w: Math.round(s.width), h: Math.round(s.height) },
      toolsRect: { x: Math.round(t.left), y: Math.round(t.top), w: Math.round(t.width), h: Math.round(t.height) },
      overlapW: Math.round(ix), overlapH: Math.round(iy), overlapArea: Math.round(overlapArea),
      suspectsZ: zs, toolsZ: zt, toolsOnTop: zt >= zs };
  });
  console.log('[BUG4] overlap=', JSON.stringify(overlap));

  // Detect any "white text" spans (invisible text layer rendered white).
  const whiteText = await win.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('.textLayer span'));
    return spans.filter(s => {
      const cs = getComputedStyle(s);
      return cs.color === 'rgb(255, 255, 255)' || s.textContent.trim().length === 0;
    }).length;
  });
  console.log('[BUG4] whiteTextOrEmptySpans=', whiteText);
});

test('Bug 8b: crop per-page mode still crops EVERY page (toast + page-count)', async () => {
  await openPdf('report.pdf');
  await openTools();
  await win.click('[data-tool-id="cropPages"]');
  await win.waitForSelector('[data-crop-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(600);

  // perPage mode, adjust a box on page 1 only.
  await win.click('[data-crop-mode="perPage"]');
  await win.waitForTimeout(400);
  const seHandle = win.locator('[data-crop-handle="se"]');
  const sb = await seHandle.boundingBox();
  if (sb) {
    await win.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await win.mouse.down();
    await win.mouse.move(sb.x + sb.width / 2 + 40, sb.y + sb.height / 2 + 40, { steps: 6 });
    await win.mouse.up();
    await win.waitForTimeout(300);
  }
  await win.click('[data-crop-confirm]');
  await win.waitForTimeout(1800);

  const toast = await win.evaluate(() => {
    const t = document.querySelector('.toast');
    return t ? t.textContent : null;
  });
  const d = await win.evaluate(() => window.tflexDiagnostics());
  // The document's page view for page 10 vs before: measure rendered page width via pageGeometry? Use getState pageCount + a generic.
  console.log('[BUG8B] toast=', JSON.stringify(toast), 'pageCount=', d.pageCount, 'modified=', d.modified);
  await win.screenshot({ path: path.join(SCREENSHOT_DIR, 'gt-bug8b-after-apply.png') });
});
