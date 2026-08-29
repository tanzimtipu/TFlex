const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const path = require('path');
const fs = require('fs');

test.setTimeout(120000);

test('DEF-017 Retest: Toolbar responsiveness after sequence of annotations', async () => {
  const screenshotsDir = path.resolve(__dirname, '../screenshots');
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  window.on('console', msg => console.log('RENDERER:', msg.text()));

  const getDiag = () => window.evaluate(() => window.tflexDiagnostics());

  // 1. Launch the app and open report.pdf.
  console.log('Opening report.pdf...');
  await window.waitForSelector('.sample-card', { timeout: 20000 });
  await window.click('.sample-card:has-text("report.pdf")');
  await window.waitForSelector('.workspace', { timeout: 20000 });

  const overlay = window.locator('.annotation-layer[data-annotation-layer="1"]');
  await overlay.waitFor({ timeout: 60000 });
  await window.waitForSelector('.pdf-page[data-page="1"] .textLayer span, .pdf-page[data-page="1"] .textLayer div', { timeout: 30000 });
  const box = await overlay.boundingBox();

  // 2. Successively create one of each: Highlight, Underline, Strikeout, Pen, Rectangle, Ellipse, Arrow, Note, Textbox.
  // And then a 10th one (Text box).
  const kinds = [
    { id: 'highlight', type: 'markup' },
    { id: 'underline', type: 'markup' },
    { id: 'strikeout', type: 'markup' },
    { id: 'ink', type: 'drag', start: { x: 50, y: 50 }, end: { x: 150, y: 50 } },
    { id: 'rect', type: 'drag', start: { x: 50, y: 100 }, end: { x: 150, y: 200 } },
    { id: 'ellipse', type: 'drag', start: { x: 200, y: 100 }, end: { x: 300, y: 200 } },
    { id: 'arrow', type: 'drag', start: { x: 50, y: 250 }, end: { x: 150, y: 350 } },
    { id: 'note', type: 'click', at: { x: 200, y: 400 }, text: 'Sticky Note' },
    { id: 'textbox', type: 'click', at: { x: 200, y: 300 }, text: 'Text Box 1' },
    { id: 'textbox', type: 'click', at: { x: 200, y: 350 }, text: 'Text Box 2' }, // 10th one
  ];

  for (let i = 0; i < kinds.length; i++) {
    const k = kinds[i];
    console.log(`Step ${i + 1}: Creating ${k.id}...`);
    
    const btnSelector = `button[data-tool="${k.id}"], button[aria-label="${k.id === 'textbox' ? 'Text box' : k.id === 'note' ? 'Sticky note' : k.id === 'ink' ? 'Pen' : k.id === 'rect' ? 'Rectangle' : k.id === 'strikeout' ? 'Strikethrough' : k.id}"]`;
    const btn = window.locator(btnSelector).first();
    
    // Check responsiveness/visibility before click
    await expect(btn).toBeVisible({ timeout: 10000 });
    await expect(btn).toBeEnabled({ timeout: 10000 });
    
    await btn.click({ timeout: 10000 });
    
    if (k.type === 'markup') {
      const textRect = await window.evaluate((idx) => {
          const divs = Array.from(document.querySelectorAll('.pdf-page[data-page="1"] .textLayer span, .pdf-page[data-page="1"] .textLayer div'));
          const textDivs = divs.filter(d => d.textContent.trim().length > 5);
          const target = textDivs[idx % textDivs.length];
          if (!target) return null;
          const r = target.getBoundingClientRect();
          return { x: r.left, y: r.top, width: r.width, height: r.height };
      }, i);
      
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
    
    // Short wait to ensure UI settles
    await new Promise(r => setTimeout(r, 500));
  }

  // Final check: click Select tool to ensure toolbar is still responsive
  console.log('Verifying final toolbar responsiveness...');
  const selectBtn = window.locator('button[data-tool="select"], button[aria-label="Select"]').first();
  await expect(selectBtn).toBeVisible({ timeout: 10000 });
  await selectBtn.click();
  
  await window.screenshot({ path: path.join(screenshotsDir, 'def-017-retest-final.png') });
  
  const diag = await getDiag();
  console.log('Final annotation count:', diag.engineState.annotations.length);
  expect(diag.engineState.annotations.length).toBe(10);

  await electronApp.close();
});
