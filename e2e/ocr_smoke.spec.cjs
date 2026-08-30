const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

function getFixturePath(name) {
  const projectRoot = path.resolve(__dirname, '..');
  const sourcePath = path.join(projectRoot, 'test-fixtures', name);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Fixture not found: ${sourcePath}`);
  }
  const tempDir = path.join(os.tmpdir(), 'tflex-e2e-fixtures');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const targetPath = path.join(tempDir, `${Date.now()}-${name}`);
  fs.copyFileSync(sourcePath, targetPath);
  return targetPath;
}

test('OCR simple smoke', async () => {
    test.setTimeout(120000);
    const app = await launchApp();
    const page = await app.firstWindow();
    
    await page.waitForSelector('.welcome', { timeout: 20000 });
    
    const filePath = getFixturePath('scanned.pdf');
    const savePath = path.join(os.tmpdir(), `tflex-ocr-output-${Date.now()}.pdf`);
    
    await app.evaluate(async ({ dialog }, { openP, saveP }) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [openP] });
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: saveP });
    }, { openP: filePath, saveP: savePath });
    
    await page.click('button:has-text("Open PDF")');
    await page.waitForSelector('.workspace', { timeout: 20000 });
    
    await page.click('[data-tools-toggle]');
    await page.waitForSelector('[data-tool-id="recognizeText"]', { timeout: 5000 });
    await page.click('[data-tool-id="recognizeText"]');
    await page.waitForSelector('.ocr-dialog', { timeout: 5000 });
    
    // 1 page only
    await page.click('[data-ocr-scope="currentPage"]');
    await page.click('[data-ocr-confirm]');
    
    await page.waitForSelector('[data-ocr-progress]', { timeout: 10000 });
    await page.waitForSelector('.ocr-dialog', { state: 'hidden', timeout: 60000 });
    
    await page.waitForSelector('[data-ocr-suspects-panel]', { timeout: 10000 });
    
    // Get suspects from the diagnostics or state if possible
    const suspects = await page.evaluate(() => {
        // Find the suspects panel items
        const items = Array.from(document.querySelectorAll('[data-ocr-suspect-word]'));
        return items.map(el => el.getAttribute('data-ocr-suspect-word'));
    });
    console.log(`Suspects found (${suspects.length}):`, suspects.slice(0, 50).join(', '));
    
    // Trigger Save As via direct button click if possible, or menu
    await page.click('button:has-text("Save…")');
    
    // The app shows a "Save a copy" proxy dialog first
    await page.waitForSelector('button:has-text("Choose location…")', { timeout: 5000 });
    await page.click('button:has-text("Choose location…")');

    // Wait for the file to be written. Backend is proven to work, so we just wait for the FS.
    let saved = false;
    for (let i = 0; i < 20; i++) {
        if (fs.existsSync(savePath)) {
            saved = true;
            break;
        }
        await page.waitForTimeout(500);
    }

    expect(saved).toBe(true);
    console.log('Saved file size:', fs.statSync(savePath).size);
    
    await app.close();
});
