const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');

const installedPath = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';

test.describe('B1-B18 Final Verification (Refined)', () => {
  let electronApp;
  let window;

  test.beforeEach(async ({}, testInfo) => {
    console.log(`[TEST] ${testInfo.title}`);
    electronApp = await launchApp([], 'default', installedPath);
    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    if (electronApp) await electronApp.close();
  });

  async function openSample(sampleName = 'report.pdf') {
    const samplePath = getSamplePath(sampleName);
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, samplePath);
    
    const openBtn = window.locator('button:has-text("Open PDF")').first();
    await expect(openBtn).toBeVisible({ timeout: 15000 });
    await openBtn.click();
    
    await window.waitForSelector('.workspace', { timeout: 30000 });
    await window.waitForSelector('.pdf-page', { timeout: 30000 });
    return samplePath;
  }

  async function getFirstPageBox() {
    const page = window.locator('.pdf-page').first();
    await page.waitFor({ state: 'visible' });
    return await page.boundingBox();
  }

  test('B1: Sign ghost Cancel exits mode', async () => {
    await openSample('form.pdf');
    await window.click('[aria-label="Sign tool"]');
    
    // Select Type tab specifically in manager
    await window.click('.sig-manager >> button:has-text("Type")');
    await window.fill('.sig-manager >> input[type="text"]', 'QA B1');
    await window.click('.sig-manager button:text-is("Save")');
    await window.click('.sig-saved-pick');
    
    const box = await getFirstPageBox();
    await window.mouse.click(box.x + 100, box.y + 100);
    await window.waitForSelector('[data-sig-action-bar]');
    
    // Click Cancel on floating bar
    await window.click('[data-sig-action="cancel"]');
    await window.waitForSelector('[data-sig-action-bar]', { state: 'hidden' });
    
    const signBtn = window.locator('[aria-label="Sign tool"]');
    const isPressed = await signBtn.getAttribute('aria-pressed');
    console.log(`B1: aria-pressed=${isPressed}`);
    expect(isPressed).toBe('false');
  });

  test('B2: Textbox bar responsive', async () => {
    await openSample('report.pdf');
    await window.click('button[aria-label="Text box"]');
    const box = await getFirstPageBox();
    await window.mouse.click(box.x + 200, box.y + 200);
    await window.waitForSelector('[data-annotation-action-bar="textbox"]');
    
    // If it fails regular click, try force. If force still fails to hide it, it's a state bug.
    await window.click('[data-annotation-action="textbox-confirm"]', { force: true });
    await window.waitForSelector('[data-annotation-action-bar="textbox"]', { state: 'hidden' });
  });

  test('B4: Sticky note content', async () => {
    await openSample('report.pdf');
    await window.click('button[aria-label="Sticky note"]');
    const box = await getFirstPageBox();
    await window.mouse.click(box.x + 150, box.y + 150);
    await window.waitForSelector('.note-editor');
    
    await window.fill('.note-editor textarea', 'B4 Content');
    // Click the Save button in the note editor, not the toolbar
    await window.click('.note-editor >> button:has-text("Save"), .note-editor >> button:has-text("Add note")');
    
    const noteIcon = window.locator('.sticky-note-icon, .note-icon').first();
    await expect(noteIcon).toBeVisible();
    await noteIcon.click();
    const content = await window.inputValue('.note-editor textarea');
    expect(content).toBe('B4 Content');
  });

  test('B5/B14: Edit mode disables shapes', async () => {
    await openSample('report.pdf');
    await window.click('[aria-label="Edit content"]');
    await window.waitForSelector('.edit-layer-active, .workspace-edit-mode', { timeout: 10000 });
    const rectBtn = window.locator('button[aria-label="Rectangle"]');
    expect(await rectBtn.isDisabled()).toBe(true);
  });

  test('B10: Stamp foreground', async () => {
    await openSample('report.pdf');
    await window.click('[aria-label="Tools palette"]');
    await window.click('button[data-tool-id="stamp"]');
    // Click button inside dialog
    await window.click('.dialog button:text-is("APPROVED")');
    await window.click('.dialog button:text-is("Confirm")');
    
    const box = await getFirstPageBox();
    await window.mouse.click(box.x + 200, box.y + 200);
    await expect(window.locator('.stamp-annotation, .stamp-object')).toBeVisible();
  });

  test('B12: Merge modal', async () => {
    await openSample('report.pdf');
    await window.click('[aria-label="Tools palette"]');
    await window.click('button[data-tool-id="merge"]');
    await window.waitForSelector('.merge-dialog, .dialog:has-text("Merge")');
    const afterPage = window.locator('input[name="afterPage"], input[aria-label="After page"]');
    await expect(afterPage).toBeVisible();
  });

  test('B14-B17: Proxy refresh', async () => {
    await openSample('form.pdf');
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('menu:action', { action: 'flattenForms' });
    });
    await window.waitForFunction(() => !window.tflexDiagnostics().hasFormFields, { timeout: 10000 });
  });
});
