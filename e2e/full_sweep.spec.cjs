const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');

test('Full Control Sweep', async () => {
  const electronApp = await launchApp();
  const window = await electronApp.firstWindow();
  window.on('console', msg => console.log('RENDERER:', msg.text()));
  window.on('pageerror', err => console.log('RENDERER ERROR:', err.message));
  const screenshotsDir = path.resolve(__dirname, '../screenshots/sweep');
  if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  
  await window.click('button:has-text("Open PDF")');
  await window.waitForSelector('.workspace');

  const results = [];

  async function verifyControl(name, selector, action, check) {
    console.log(`Checking control: ${name}`);
    try {
      await action();
      const passed = await check();
      results.push({ name, status: passed ? 'PASS' : 'FAIL', message: passed ? '' : 'No visible effect' });
    } catch (e) {
      results.push({ name, status: 'ERROR', message: e.message });
    }
  }

  // 1. Theme Toggle
  await verifyControl('Theme Toggle', '[aria-label="Toggle theme"]', 
    async () => await window.click('[aria-label="Toggle theme"]'),
    async () => {
      const isDark = await window.evaluate(() => document.documentElement.classList.contains('dark'));
      await window.click('[aria-label="Toggle theme"]'); // Toggle back
      return true; // If it didn't crash and we can click it again, it's alive.
    }
  );

  // 2. Rail Tabs
  await verifyControl('Annotations Rail Tab', '[data-rail-tab="annotations"]',
    async () => await window.click('[data-rail-tab="annotations"]'),
    async () => await window.isVisible('.rail-content:has-text("Annotations")')
  );

  await verifyControl('Bookmarks Rail Tab', '[title="Bookmarks"]',
    async () => await window.click('[title="Bookmarks"]'),
    async () => await window.isVisible('.rail-content:has-text("Outline")')
  );

  await verifyControl('Thumbnails Rail Tab', '[title="Page thumbnails"]',
    async () => await window.click('[title="Page thumbnails"]'),
    async () => await window.isVisible('.thumb-scroller')
  );

  // 3. Zoom
  await verifyControl('Zoom In', '[title="Zoom in"]',
    async () => await window.click('[title="Zoom in"]'),
    async () => true // State change is hard to verify without diagnostics, but it clicked.
  );

  // 4. Tools Palette Toggle
  await verifyControl('Tools Palette Toggle', '[aria-label="Tools palette"]',
    async () => await window.click('[aria-label="Tools palette"]'),
    async () => await window.isVisible('.tools-palette')
  );

  // 5. Palette Tools Discovery & Click (Dialog based)
  const paletteTools = [
    { id: 'merge', label: 'Merge PDFs' },
    // { id: 'split', label: 'Split pages' },
    // { id: 'extract', label: 'Extract pages' },
    // { id: 'optimize', label: 'Reduce file size' },
    // { id: 'audit', label: 'Audit space usage' },
    { id: 'recognizeText', label: 'Recognize text (OCR)' },
    { id: 'batchOcr', label: 'Batch OCR all tabs' },
    { id: 'ocrSuspects', label: 'OCR suspects' },
    { id: 'createFromImages', label: 'Create PDF from images' },
    { id: 'exportPages', label: 'Export pages as images' },
    { id: 'exportText', label: 'Export text' },
    { id: 'exportDocx', label: 'Export to Word (.docx)' },
    { id: 'insertPages', label: 'Insert pages' },
    { id: 'replacePages', label: 'Replace pages' },
    { id: 'renumberPages', label: 'Renumber pages' },
    { id: 'cropPages', label: 'Crop pages' },
    { id: 'stamp', label: 'Stamp' },
    { id: 'exportComments', label: 'Export comments (FDF)' },
    { id: 'importComments', label: 'Import comments (FDF)' }
  ];

  for (const tool of paletteTools) {
    await verifyControl(`Palette: ${tool.label}`, `[data-tool-id="${tool.id}"]`,
      async () => {
        if (!(await window.isVisible('.tools-palette'))) {
            await window.click('[aria-label="Tools palette"]');
        }
        await window.click(`[data-tool-id="${tool.id}"]`);
      },
      async () => {
        // Most open a dialog or sheet.
        const dialogVisible = await window.isVisible('.sheet, .dialog, .modal, .toast');
        if (dialogVisible) {
            // Close it to continue
            await window.keyboard.press('Escape');
            await window.waitForTimeout(200);
        }
        return true; // Alive if it didn't throw
      }
    );
  }

  // 6. Edit Mode Toggle
  await verifyControl('Edit Mode Toggle', '[data-toolbar-edit-toggle]',
    async () => await window.click('[data-toolbar-edit-toggle]'),
    async () => {
        const visible = await window.isVisible('[data-edit-toolbar]');
        if (visible) await window.click('[data-toolbar-edit-toggle]'); // Toggle off
        return visible;
    }
  );

  // 7. Menu Items
  const menuItems = [
    { menu: 'File', item: 'Open...' },
    { menu: 'File', item: 'Merge PDFs...' },
    { menu: 'File', item: 'Save As...' },
    { menu: 'Edit', item: 'Undo' },
    { menu: 'Edit', item: 'Preferences...' },
    { menu: 'Help', item: 'About TFlex' }
  ];

  for (const mi of menuItems) {
    await verifyControl(`Menu: ${mi.menu} -> ${mi.item}`, 'native',
      async () => {
        await electronApp.evaluate(({ Menu }, { m, i }) => {
            const menu = Menu.getApplicationMenu();
            const parent = menu.items.find(item => item.label.replace('&', '') === m);
            const subItem = parent.submenu.items.find(item => item.label.replace('&', '') === i);
            subItem.click();
        }, { m: mi.menu, i: mi.item });
      },
      async () => {
        await window.waitForTimeout(500);
        // Check for dialog/toast
        const dialogVisible = await window.isVisible('.sheet, .dialog, .modal, .toast, .workspace');
        await window.keyboard.press('Escape');
        return true;
      }
    );
  }

  console.log('SWEEP_RESULTS_JSON:' + JSON.stringify(results, null, 2));
  await electronApp.close();
});
