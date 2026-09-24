const { test, expect } = require('@playwright/test');
const os = require('node:os');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, armSignTool, openDockVerb, armAnnotationTool } = require('./lib/helpers.cjs');

test('smoke', async () => {
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  try {
    await runSmoke(electronApp, window);
  } finally {
    // The doc is usually modified here, so the DEF-142 close gate would
    // prompt on close and hang a plain electronApp.close().
    await hardClose(electronApp);
  }
});

async function runSmoke(electronApp, window) {

  await window.waitForSelector('.sample-card', { timeout: 10000 });
  const sampleCount = await window.$$eval('.sample-card', el => el.length);
  expect(sampleCount).toBeGreaterThanOrEqual(4);

  console.log('Opening report.pdf (temp copy)...');
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await window.locator('button:has-text("Open PDF")').first().click();
  await window.waitForSelector('.workspace', { timeout: 15000 });

  const diagInit = await window.evaluate(() => window.tflexDiagnostics());
  expect(diagInit.pageCount).toBe(34);

  // Verify DEF-070
  console.log('Checking DEF-070...');
  // Phase 36 — the annotation toolbar lives in the REVIEW dock's Annotate
  // flyout; arm Highlight through the canonical helper (was `[aria-label]`).
  await armAnnotationTool(window, 'highlight');
  const swatch = window.locator('.color-swatch, [aria-label="Pick color"]');
  if (await swatch.isVisible()) {
      await swatch.click();
      const hexInput = window.locator('input[aria-label="Custom color hex"]');
      if (await hexInput.isVisible()) {
          console.log('DEF-070: FIXED');
      } else {
          console.log('DEF-070: STILL OPEN');
      }
  } else {
      console.log('DEF-070: swatch not found');
  }

  // Verify DEF-068
  console.log('Checking DEF-068...');
  // Redesign (six-phase visual overhaul): the page container is .pdf-page
  // inside .page-slot (the old .page-view class is gone). Highlight is a
  // DRAG markup tool: a zero-length click commits nothing (dragMeetsMinimum)
  // and an empty-area drag has no text quads, so drag across a real text
  // span from the page's text layer.
  const hlSpan = await window.evaluate(() => {
    const tl = document.querySelector('.pdf-page .textLayer');
    if (!tl) return null;
    const spans = Array.from(tl.querySelectorAll('span'))
      .map((s) => { const r = s.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })
      .filter((r) => r.w > 30 && r.h > 6);
    return spans[0] || null;
  });
  expect(hlSpan).not.toBeNull();
  await window.mouse.move(hlSpan.x + 2, hlSpan.y + hlSpan.h / 2);
  await window.mouse.down();
  await window.mouse.move(hlSpan.x + hlSpan.w - 2, hlSpan.y + hlSpan.h / 2 + 2, { steps: 8 });
  await window.mouse.up();
  await window.waitForTimeout(2000);
  const diag = await window.evaluate(() => window.tflexDiagnostics());
  if (diag.engineState && diag.engineState.annotations.length > 0) {
      console.log('DEF-068: FIXED');
  } else {
      console.log('DEF-068: STILL OPEN');
  }
  
  // Verify DEF-073
  console.log('Checking DEF-073...');
  // Redesign: the Optimize dialog's preset <select> became a radiogroup
  // (input[data-optimize-preset]). The onChange persists the preset even
  // when the dialog is dismissed, so check + Escape keeps the old intent.
  // Phase 36 (chunk 3) — Optimize is the DELIVER dock's `optimize` verb.
  await openDockVerb(window, 4, 'optimize');
  await window.waitForSelector('.dialog');
  await window.check('input[data-optimize-preset="max"]');
  await window.keyboard.press('Escape');
  
  await window.click('[data-toolbar-save-as]');
  await window.waitForSelector('.dialog');
  await window.keyboard.press('Escape');
  const finalPreset = await window.evaluate(() => window.tflexDiagnostics().optimizePreset);
  if (finalPreset === 'max') {
    console.log('DEF-073: FIXED');
  } else {
    console.log('DEF-073: STILL OPEN - preset was ' + finalPreset);
  }

  // Verify DEF-069
  console.log('Checking DEF-069...');
  // NOTE: the report sample has no form fields; the document is already
  // modified here because the DEF-068 step created a highlight annotation
  // through the UI (which converges the diagnostics mirror). The engine
  // fill below is kept for the form-field case; the UI path is what
  // actually flips `modified` (see e2e/retests/full_sweep_retest.spec.cjs
  // DEF-069 for the UI-driven form-fill verification).
  await window.evaluate(() => {
    const fields = window.tflexDiagnostics().formFields;
    if (fields.length > 0) {
      window.tflex.engine.fillFormField(window.tflexDiagnostics().engineDocId, { id: fields[0].id, value: 'Test' });
    }
  });
  // Wait for modified
  await window.waitForFunction(() => window.tflexDiagnostics().modified);
  // Mock Save As. The destination is NOT an asset sample - it is the write
  // target, so build a unique temp path directly (getSamplePath only copies
  // files that exist under assets/samples).
  const savePath = path.join(os.tmpdir(), `tflex-smoke-saved-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await window.click('[data-toolbar-save-as]');
  // Redesign: Save As first opens the in-app "Save a copy" dialog; its
  // confirm button ([data-save-as-confirm]) fires the OS save dialog
  // (mocked above), which is where the write actually happens.
  await window.waitForSelector('.dialog');
  await window.click('[data-save-as-confirm]');
  await window.waitForFunction(() => !window.tflexDiagnostics().modified);
  console.log('DEF-069: FIXED');

  // Verify DEF-075
  console.log('Checking DEF-075...');
  // Redesign: the Sign modal is Draw/Type/Saved tabs; "Use this signature"
  // is gone — Save lands on the Saved tab and clicking the saved row arms
  // placement. B2: the page click spawns a PENDING placement bar; Confirm
  // commits to the engine.
  await armSignTool(window);
  await window.click('button:has-text("Type")');
  await window.fill('input[aria-label="Type your signature"]', 'Tester');
  await window.click('.sig-tab-actions button:has-text("Save")');
  await window.waitForSelector('.sig-saved-pick');
  await window.click('.sig-saved-pick');
  await window.click('.pdf-page', { position: { x: 200, y: 200 } });
  await window.waitForSelector('[data-sig-action="confirm"]');
  await window.click('[data-sig-action="confirm"]');
  await window.waitForFunction(() => window.tflexDiagnostics().signatures.length > 0);
  console.log('DEF-075: FIXED');

  // Verify DEF-074
  console.log('Checking DEF-074...');
  await electronApp.evaluate(({ Menu }) => {
    const helpMenu = Menu.getApplicationMenu().items.find(i => i.label === 'Help');
    helpMenu.submenu.items.find(i => i.label === 'About TFlex').click();
  });
  const aboutDialog = await window.waitForSelector('.about-dialog, .sheet, .dialog');
  const aboutText = await aboutDialog.textContent();
  if (aboutText.includes('TFlex') && (aboutText.includes('v1') || aboutText.includes('portable'))) {
      console.log('DEF-074: FIXED');
  } else {
      console.log('DEF-074: STILL OPEN - text: ' + aboutText);
  }
}
