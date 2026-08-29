const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

test('Phase 3: Annotations E2E', async () => {
  test.setTimeout(240000);
  const electronApp = await launchApp();

  const window = await electronApp.firstWindow();
  window.on('console', msg => console.log('RENDERER:', msg.text()));
  const screenshotsDir = path.resolve(__dirname, '../screenshots');
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

  const screenshot = async (name) => {
    await window.screenshot({ path: path.join(screenshotsDir, name) });
  };

  // 1. Open report.pdf (using temp copy for DEF-026)
  console.log('Opening report.pdf (temp copy)...');
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace', { timeout: 10000 });

  const getDiag = () => window.evaluate(() => window.tflexDiagnostics());

  // 2. Create annotations
  const tools = [
    { id: 'highlight', name: 'Highlight', type: 'drag', start: { x: 100, y: 100 }, end: { x: 300, y: 120 } },
    { id: 'underline', name: 'Underline', type: 'drag', start: { x: 100, y: 130 }, end: { x: 300, y: 150 } },
    { id: 'strikeout', name: 'Strikethrough', type: 'drag', start: { x: 100, y: 160 }, end: { x: 300, y: 180 } },
    { id: 'ink', name: 'Pen', type: 'drag', start: { x: 400, y: 100 }, end: { x: 500, y: 200 } },
    { id: 'rect', name: 'Rectangle', type: 'drag', start: { x: 400, y: 250 }, end: { x: 500, y: 350 } },
    { id: 'ellipse', name: 'Ellipse', type: 'drag', start: { x: 400, y: 400 }, end: { x: 500, y: 500 } },
    { id: 'arrow', name: 'Arrow', type: 'drag', start: { x: 100, y: 300 }, end: { x: 200, y: 400 } },
    { id: 'textbox', name: 'Text box', type: 'click', at: { x: 100, y: 500 }, text: 'Hello World' },
    { id: 'note', name: 'Sticky note', type: 'click', at: { x: 100, y: 600 }, text: 'Important note' },
  ];

  const overlay = window.locator('.annotation-layer[data-annotation-layer="1"]');
  await overlay.scrollIntoViewIfNeeded();
  await overlay.waitFor();

  for (const tool of tools) {
    console.log(`Creating ${tool.id}...`);
    await window.click(`[data-tool="${tool.id}"]`);
    
    if (tool.type === 'drag') {
      const box = await overlay.boundingBox();
      await window.mouse.move(box.x + tool.start.x, box.y + tool.start.y);
      await window.mouse.down();
      await window.mouse.move(box.x + tool.end.x, box.y + tool.end.y, { steps: 5 });
      await window.mouse.up();
    } else if (tool.type === 'click') {
      const box = await overlay.boundingBox();
      await window.mouse.click(box.x + tool.at.x, box.y + tool.at.y);
      if (tool.id === 'textbox') {
        await window.waitForSelector('[data-annotation-editor="textbox"]');
        await window.fill('[data-annotation-editor="textbox"]', tool.text);
        await window.keyboard.press('Control+Enter');
      } else if (tool.id === 'note') {
        await window.waitForSelector('[data-annotation-editor="note"]');
        await window.fill('[data-annotation-editor="note"] textarea', tool.text);
        await window.click('.ann-note-editor .btn-primary');
      }
    }
    
    // Robust check for annotation creation with polling
    await window.waitForFunction(({ toolId, kind }) => {
      const diag = window.tflexDiagnostics();
      return diag.engineState.annotations.some(a => a.kind === toolId || (toolId === 'textbox' && a.kind === 'textbox'));
    }, { toolId: tool.id }, { timeout: 5000 });
    
    const diag = await getDiag();
    const found = diag.engineState.annotations.find(a => a.kind === tool.id || (tool.id === 'textbox' && a.kind === 'textbox'));
    expect(found).toBeDefined();
  }

  await screenshot('phase3-all-kinds.png');

  // 3. Zoom alignment
  console.log('Testing zoom alignment...');
  const checkAlignment = async (zoomLabel) => {
    const diag = await getDiag();
    const annId = diag.engineState.annotations[0].id;
    const annEl = window.locator(`[data-annotation-id="${annId}"]`);
    const box = await annEl.first().boundingBox();
    const pageBox = await overlay.boundingBox();
    // Just ensure it's within page bounds
    expect(box.x).toBeGreaterThanOrEqual(pageBox.x);
    expect(box.y).toBeGreaterThanOrEqual(pageBox.y);
  };

  await window.click('[title="Zoom out"]'); // 50%? depends on start zoom. Let's use FIT modes.
  await window.click('[title="Fit width"]');
  await checkAlignment('fit-width');
  await window.click('[title="Fit page"]');
  await checkAlignment('fit-page');
  
  // 4. Annotations panel
  console.log('Testing annotations panel...');
  await window.click('button[title="Annotations"]');
  await window.waitForSelector('.ann-panel-row');
  const annCount = await window.locator('.ann-panel-row').count();
  expect(annCount).toBe(9);
  
  // Click a note -> scrolls + flashes
  const noteItem = window.locator('.ann-panel-row:has-text("Important note")');
  await noteItem.click();
  await window.waitForSelector('.ann-flash');
  
  // Edit content
  await noteItem.locator('.ann-panel-text-display').click();
  await window.fill('.ann-panel-text', 'Edited note');
  await window.keyboard.press('Control+Enter');
  
  const diagAfterEdit = await getDiag();
  const editedNote = diagAfterEdit.engineState.annotations.find(a => a.kind === 'note');
  expect(editedNote.text).toBe('Edited note');
  
  // Delete
  await noteItem.locator('.ann-panel-row-delete').click();
  await expect(window.locator('.ann-panel-row')).toHaveCount(8);

  await screenshot('phase3-panel.png');

  // 5. Save and Round-trip
  console.log('Testing save round-trip...');
  const tempPath = path.join(process.env.TEMP || 'C:\\Users\\tanzi\\AppData\\Local\\Temp', `tflex-test-${Date.now()}.pdf`);
  
  // Mock dialog in main process
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, tempPath);

  // Trigger Save As via UI
  await window.click('aria-label="Save As"');
  
  // Wait for save to complete (modified dot should disappear)
  await window.waitForFunction(() => !window.tflexDiagnostics().modified, { timeout: 10000 });
  expect(fs.existsSync(tempPath)).toBe(true);

  await screenshot('phase3-saved.png');

  // 6. Reopen and verify
  console.log('Reopening saved file...');
  // Close the current tab
  await window.click('.tab-close');
  await window.waitForSelector('.welcome');
  
  // We need to open the file. We can't use the dialog.
  // But we can use the `window.tflex.loadPdf` directly and it should open the tab if we are lucky,
  // or we can use the `recent-item` if it appeared.
  // The app adds to recent on open.
  const recentItem = window.locator(`.recent-item:has-text("${path.basename(tempPath)}")`);
  if (await recentItem.count() === 0) {
      // If not in recent (maybe because it was a SaveAs), use the internal API to open it.
      await window.evaluate(async (p) => {
          // This matches the openPdfFromPath logic in App.tsx but we can't call it directly.
          // However, we can call the IPCs that App.tsx calls.
          // Or just use the "Open" button if we mock the open dialog.
          await window.tflex.openFileDialog(); 
      }, tempPath);
      // Mock open dialog
      await electronApp.evaluate(async ({ dialog }, p) => {
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
      }, tempPath);
      await window.click('button:has-text("Open PDF")');
  } else {
      await recentItem.click();
  }
  await window.waitForSelector('.workspace', { timeout: 10000 });
  
  // Wait for annotations to be loaded into engine state
  await window.waitForFunction(() => window.tflexDiagnostics().engineState.annotations.length === 8, { timeout: 5000 });

  await screenshot('phase3-doc-opened.png');

  const diagFinal = await getDiag();
  expect(diagFinal.engineState.annotations.length).toBe(8); // 9 created, 1 deleted

  // 7. Parse with pdf-lib
  console.log('Verifying with pdf-lib...');
  const savedBytes = fs.readFileSync(tempPath);
  const pdfDoc = await PDFDocument.load(savedBytes);
  let totalAnnots = 0;
  pdfDoc.getPages().forEach(p => {
    totalAnnots += (p.node.Annots()?.size() || 0);
  });
  console.log(`pdf-lib found ${totalAnnots} annotations`);
  expect(totalAnnots).toBeGreaterThanOrEqual(8);

  await screenshot('phase3-reopened.png');

  await electronApp.close();
  // Cleanup
  if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
});

