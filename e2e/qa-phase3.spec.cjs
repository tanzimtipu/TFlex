const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

test.setTimeout(400000);

test('Phase 3 QA Evidence (All SCs)', async () => {
  const screenshotsDir = path.resolve(__dirname, '../screenshots');
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
  
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  window.on('console', msg => console.log('RENDERER:', msg.text()));

  const getDiag = () => window.evaluate(() => window.tflexDiagnostics());

  // --- SC 1: Annotation kinds creation ---
  console.log('SC 1: Creating annotations (using temp copy for DEF-026)...');
  // Open report.pdf
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace', { timeout: 20000 });

  const overlay = window.locator('.annotation-layer[data-annotation-layer="1"]');
  await overlay.waitFor({ timeout: 60000 });
  await window.waitForSelector('.pdf-page[data-page="1"] .textLayer span, .pdf-page[data-page="1"] .textLayer div', { timeout: 30000 });
  const box = await overlay.boundingBox();

  const kinds = [
    { id: 'highlight', type: 'markup' },
    { id: 'underline', type: 'markup' },
    { id: 'strikeout', type: 'markup' },
    { id: 'ink', type: 'drag', start: { x: 50, y: 50 }, end: { x: 150, y: 50 } },
    { id: 'rect', type: 'drag', start: { x: 50, y: 100 }, end: { x: 150, y: 200 } },
    { id: 'ellipse', type: 'drag', start: { x: 200, y: 100 }, end: { x: 300, y: 200 } },
    { id: 'arrow', type: 'drag', start: { x: 50, y: 250 }, end: { x: 150, y: 350 } },
    { id: 'textbox', type: 'click', at: { x: 200, y: 300 }, text: 'E2E Text Box' },
    { id: 'note', type: 'click', at: { x: 200, y: 400 }, text: 'E2E Sticky Note' },
  ];

  const results = {};

  for (const k of kinds) {
    const diagBefore = await getDiag();
    const countBefore = diagBefore.engineState.annotations.length;

    console.log(`Creating ${k.id}...`);
    await window.screenshot({ path: path.join(screenshotsDir, `debug-tool-${k.id}.png`) });
    const btn = window.locator(`button[data-tool="${k.id}"], button[aria-label="${k.id === 'textbox' ? 'Text box' : k.id === 'note' ? 'Sticky note' : k.id}"]`).first();
    await btn.waitFor({ state: 'visible', timeout: 20000 });
    await btn.click({ timeout: 10000 });
    
    if (k.type === 'markup') {
      const textRect = await window.evaluate((kindIndex) => {
          const divs = Array.from(document.querySelectorAll('.pdf-page[data-page="1"] .textLayer span, .pdf-page[data-page="1"] .textLayer div'));
          const textDivs = divs.filter(d => d.textContent.trim().length > 5);
          const target = textDivs[kindIndex % textDivs.length];
          if (!target) return null;
          const r = target.getBoundingClientRect();
          return { x: r.left, y: r.top, width: r.width, height: r.height };
      }, kinds.indexOf(k));
      
      if (textRect) {
          await window.mouse.move(textRect.x + 2, textRect.y + 2);
          await window.mouse.down();
          await window.mouse.move(textRect.x + textRect.width - 2, textRect.y + textRect.height - 2, { steps: 5 });
          await window.mouse.up();
      }
    } else if (k.type === 'drag') {
      await window.mouse.move(box.x + k.start.x, box.y + k.start.y);
      await window.mouse.down();
      await window.mouse.move(box.x + k.end.x, box.y + k.end.y, { steps: 5 });
      await window.mouse.up();
    } else if (k.type === 'click') {
      await window.mouse.click(box.x + k.at.x, box.y + k.at.y);
      if (k.id === 'textbox') {
        await window.waitForSelector('[data-annotation-editor="textbox"]', { timeout: 10000 });
        await window.fill('[data-annotation-editor="textbox"]', k.text);
        await window.keyboard.press('Control+Enter');
      } else if (k.id === 'note') {
        await window.waitForSelector('[data-annotation-editor="note"]', { timeout: 10000 });
        await window.fill('[data-annotation-editor="note"] textarea', k.text);
        await window.click('.ann-note-editor .btn-primary');
      }
    }

    let foundAnn;
    for (let i = 0; i < 30; i++) {
        const diag = await getDiag();
        if (diag.engineState.annotations.length > countBefore) {
            foundAnn = diag.engineState.annotations[diag.engineState.annotations.length - 1];
            break;
        }
        await new Promise(r => setTimeout(r, 200));
    }
    
    if (foundAnn) {
        const expectedKind = k.id; // Renderer uses 'textbox'
        if (foundAnn.kind === expectedKind) {
            results[k.id] = 'PASS';
        } else {
            results[k.id] = `FAIL (got ${foundAnn.kind})`;
        }
    } else {
        results[k.id] = 'FAIL (not found)';
    }
    console.log(`Result for ${k.id}: ${results[k.id]}`);
  }

  console.log('Per-kind creation result:', results);
  await window.screenshot({ path: path.join(screenshotsDir, 'annotation-kinds.png') });
  await window.screenshot({ path: path.join(screenshotsDir, 'markup-quads.png') });

  // --- SC 2: Zoom alignment ---
  console.log('SC 2: Testing zoom alignment...');
  const checkAlignment = async (label) => {
    const diag = await getDiag();
    const ann = diag.engineState.annotations[0];
    const annEl = window.locator(`[data-annotation-id="${ann.id}"]`);
    const annBox = await annEl.first().boundingBox();
    const pageEl = window.locator('.annotation-layer[data-annotation-layer="1"]');
    const pageBox = await pageEl.boundingBox();
    expect(annBox.x).toBeGreaterThanOrEqual(pageBox.x - 5);
    expect(annBox.y).toBeGreaterThanOrEqual(pageBox.y - 5);
    console.log(`Zoom ${label} alignment checked.`);
  };

  console.log('Zooming to 50%...');
  for (let i = 0; i < 15; i++) {
      const diag = await getDiag();
      if (Math.abs(diag.zoom - 0.5) < 0.01) break;
      await window.click('[title="Zoom out"]');
      await new Promise(r => setTimeout(r, 200));
  }
  await checkAlignment('50%');

  console.log('Zooming to 200%...');
  for (let i = 0; i < 25; i++) {
      const diag = await getDiag();
      if (Math.abs(diag.zoom - 2.0) < 0.01) break;
      await window.click('[title="Zoom in"]');
      await new Promise(r => setTimeout(r, 200));
  }
  await checkAlignment('200%');

  // --- SC 3: Annotations panel ---
  console.log('SC 3: Testing annotations panel...');
  await window.click('button[title="Annotations"]');
  await window.waitForSelector('.ann-panel-row');
  const initialCount = await window.locator('.ann-panel-row').count();
  expect(initialCount).toBeGreaterThanOrEqual(9);

  const noteRow = window.locator('.ann-panel-row:has-text("E2E Sticky Note")');
  await noteRow.click();
  
  // Enter edit mode
  await noteRow.locator('.ann-panel-text-display').click();
  await noteRow.locator('.ann-panel-text').fill('Edited E2E Note');
  await window.screenshot({ path: path.join(screenshotsDir, 'panel-edit.png') });
  await window.keyboard.press('Control+Enter');
  
  // Wait for engine to sync the edit
  await window.waitForFunction(() => {
      const d = window.tflexDiagnostics();
      const n = d.engineState.annotations.find(a => a.text === 'Edited E2E Note');
      return n !== undefined;
  }, { timeout: 10000 });

  const diagAfterEdit = await getDiag();
  const note = diagAfterEdit.engineState.annotations.find(a => a.text === 'Edited E2E Note');
  expect(note).toBeDefined();

  await noteRow.scrollIntoViewIfNeeded();
  await noteRow.locator('.ann-panel-row-delete').click({ force: true });
  await expect(window.locator('.ann-panel-row')).toHaveCount(initialCount - 1);

  // --- SC 4: Save and Round-trip ---
  console.log('SC 4: Testing save round-trip...');
  const tempFile = path.join(process.env.TEMP || 'C:\\Users\\tanzi\\AppData\\Local\\Temp', `tflex-qa-p3-${Date.now()}.pdf`);
  
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, tempFile);

  console.log('Saving as...', tempFile);
  await window.click('[aria-label="Save As"]');
  
  await window.waitForFunction(() => !window.tflexDiagnostics().modified, { timeout: 30000 });
  expect(fs.existsSync(tempFile)).toBe(true);

  console.log('Reopening...');
  await window.click('.tab-close');
  await window.waitForSelector('.welcome');

  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, tempFile);
  await window.click('button:has-text("Open PDF")');
  
  await window.waitForSelector('.workspace', { timeout: 20000 });
  const diagFinal = await getDiag();
  expect(diagFinal.engineState.annotations.length).toBe(initialCount - 1);
  await window.screenshot({ path: path.join(screenshotsDir, 'post-reopen.png') });

  const bytes = fs.readFileSync(tempFile);
  const pdfDoc = await PDFDocument.load(bytes);
  let totalAnnots = 0;
  pdfDoc.getPages().forEach(p => {
      totalAnnots += (p.node.Annots()?.size() || 0);
  });
  console.log(`pdf-lib verified ${totalAnnots} annotations in file`);
  expect(totalAnnots).toBeGreaterThanOrEqual(8);

  if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);

  await electronApp.close();
  
  // Final verdict on SC 1
  expect(Object.values(results).every(r => r === 'PASS')).toBe(true);
});
