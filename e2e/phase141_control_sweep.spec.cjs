// PHASE 14.1 CONTROL-INDEX SWEEP (qa, 2026-09-13; Phase-22 repoint 2026-09-19).
// Phase 14.1 restructures the Phase-13 icon toolbar into the grouped
// command bar (GlassControlGroup capsules). Phase 22 moved the Open and
// Save/Save-As controls OUT of the command bar into the title bar
// (AppHeader's .titlebar-file group), so the promised state changes are:
//   1. Five command-bar capsules render (Navigation / Zoom / Tools /
//      Document actions / Annotate), each a role=group with aria-label,
//      plus the title-bar File-actions group (Open / Save / Save As).
//   2. The title-bar Open button (the accent) actually OPENS a document
//      through the mocked dialog (moved control keeps its behavior).
//   3. Navigation capsule: prev/next move the page indicator.
//   4. Zoom capsule: +/- move the zoom readout.
//   5. Save control: Save disabled while unmodified; Save-As enabled
//      (DEF-246 — a copy is always allowed while a document is open).
//   6. The "More" capsule toggles the Tools palette (aria-pressed flips).
//   7. No renderer errors through the sweep.
// Canonical launcher, dev build. Screenshots -> screenshots/phase141-sweep-*.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

let electronApp = null;
let win = null;
let rendererErrors = [];

test.describe.serial('phase 14.1 command bar control sweep', () => {
  test.beforeEach(async () => {
    electronApp = await launchApp();
    win = await electronApp.firstWindow();
    rendererErrors = [];
    win.on('pageerror', (err) => rendererErrors.push(`pageerror: ${err.message}`));
    win.on('console', (msg) => {
      if (msg.type() === 'error') rendererErrors.push(`console.error: ${msg.text()}`);
    });
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
  });

  test.afterEach(async () => {
    await hardClose(electronApp, 'phase141-sweep');
    electronApp = null;
    win = null;
  });

  test('CAPSULES: command-bar capsules + the title-bar file group', async () => {
    test.setTimeout(180000);
    await win.locator('button:has-text("Open PDF")').first().click();
    await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
    await win.waitForTimeout(1800);

    const groups = await win.evaluate(() =>
      Array.from(document.querySelectorAll('.toolbar .glass-control-group')).map((g) => ({
        label: g.getAttribute('aria-label'),
        role: g.getAttribute('role'),
        buttons: g.querySelectorAll('button').length,
      })));
    console.log('[sweep] capsules:', JSON.stringify(groups));
    expect(groups.map((g) => g.label)).toEqual([
      'Navigation', 'Zoom', 'Tools', 'Document actions', 'Annotate',
    ]);
    for (const g of groups) {
      expect(g.role, `${g.label} must be role=group`).toBe('group');
    }
    // Phase 22 - the File group (Open / Save / Save As) now lives in the
    // title bar, still as ONE role=group capsule.
    const fileGroup = await win.evaluate(() => {
      const g = document.querySelector('.titlebar-file');
      return g ? {
        role: g.getAttribute('role'),
        label: g.getAttribute('aria-label'),
        buttons: g.querySelectorAll('button').length,
      } : null;
    });
    console.log('[sweep] title-bar file group:', JSON.stringify(fileGroup));
    expect(fileGroup, 'the title-bar file group must render').not.toBeNull();
    expect(fileGroup.role, 'file group is role=group').toBe('group');
    expect(fileGroup.label, 'file group accessible name').toBe('File actions');
    expect(fileGroup.buttons, 'Open / Save / Save As').toBe(3);
    await win.screenshot({ path: path.join(SHOTS, 'phase141-sweep-commandbar.png') });
    expect(rendererErrors).toEqual([]);
  });

  test('OPEN: the title-bar accent button opens a document (moved control keeps behavior)', async () => {
    test.setTimeout(180000);
    // The command bar exists only in the document workspace, so first open
    // a document through the welcome hero, then drive the MOVED control:
    // the title bar's Open button must open a SECOND document as a tab.
    await win.locator('button:has-text("Open PDF")').first().click();
    await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
    await win.waitForTimeout(1500);
    // Point the (already-mocked) dialog at a different sample.
    const formPath = getSamplePath('form.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, formPath);
    const before = await win.evaluate(() => document.querySelectorAll('.tab[data-tab-id]').length);
    await win.locator('[data-toolbar-open]').click();
    await win.waitForFunction(
      (n) => document.querySelectorAll('.tab[data-tab-id]').length > n,
      before,
      { timeout: 30000 },
    );
    await win.waitForTimeout(1800);
    const after = await win.evaluate(() => document.querySelectorAll('.tab[data-tab-id]').length);
    console.log(`[sweep] tabs before=${before} after=${after}`);
    expect(after, 'the command-bar Open button must open the picked document').toBeGreaterThan(before);
    const tabLabel = await win.evaluate(() => {
      const t = document.querySelector('.tab-active');
      return t ? t.textContent : '';
    });
    console.log('[sweep] active tab label:', tabLabel);
    expect(String(tabLabel), 'the title-bar Open must open the newly picked document').toContain('form.pdf');
    await win.screenshot({ path: path.join(SHOTS, 'phase141-sweep-open-result.png') });
    expect(rendererErrors).toEqual([]);
  });

  test('NAV+ZOOM+SAVE: capsules keep their promised state changes', async () => {
    test.setTimeout(180000);
    await win.locator('button:has-text("Open PDF")').first().click();
    await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
    await win.waitForTimeout(1800);

    // Navigation: next page
    const page0 = await win.evaluate(() => document.querySelector('.page-input').value);
    await win.click('button[aria-label="Next page"]');
    await win.waitForTimeout(1500);
    const page1 = await win.evaluate(() => document.querySelector('.page-input').value);
    console.log(`[sweep] nav: ${page0} -> ${page1}`);
    expect(Number(page1), 'next-page must advance the indicator').toBeGreaterThan(Number(page0));
    await win.click('button[aria-label="Previous page"]');
    await win.waitForTimeout(1500);
    const pageBack = await win.evaluate(() => document.querySelector('.page-input').value);
    expect(Number(pageBack), 'prev-page must return to page 1').toBe(1);

    // Zoom in
    const z0 = parseFloat(await win.evaluate(() => document.querySelector('.zoom-percent').textContent));
    await win.click('button[aria-label="Zoom in"]');
    await win.waitForTimeout(700);
    const z1 = parseFloat(await win.evaluate(() => document.querySelector('.zoom-percent').textContent));
    console.log(`[sweep] zoom: ${z0}% -> ${z1}%`);
    expect(z1, 'zoom-in must raise the readout').toBeGreaterThan(z0);

    // Save disabled while unmodified; Save-As stays enabled (DEF-246).
    const saveState = await win.evaluate(() => ({
      save: document.querySelector('[data-toolbar-save]').disabled,
      saveAs: document.querySelector('[data-toolbar-save-as]').disabled,
    }));
    console.log('[sweep] save states (unmodified):', JSON.stringify(saveState));
    expect(saveState.save, 'Save must be disabled while unmodified').toBe(true);
    expect(saveState.saveAs, 'Save-As stays enabled while unmodified (DEF-246)').toBe(false);
    expect(rendererErrors).toEqual([]);
  });

  test('MORE capsule: toggles the Tools palette (aria-pressed flips)', async () => {
    test.setTimeout(180000);
    await win.locator('button:has-text("Open PDF")').first().click();
    await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
    await win.waitForTimeout(1800);

    // Diagnostic: prove the command bar is actually mounted before the
    // attribute assertions (a null here means the workspace layout the
    // sweep expects does not exist — report it, do not crash opaque).
    const moreFacts = await win.evaluate(() => ({
      tabs: document.querySelectorAll('.tab[data-tab-id]').length,
      toolbarPresent: !!document.querySelector('.toolbar'),
      moreBtn: !!document.querySelector('button[data-tools-toggle]'),
      groupLabels: Array.from(document.querySelectorAll('.toolbar .glass-control-group')).map((g) => g.getAttribute('aria-label')),
    }));
    console.log('[sweep:more] mount facts:', JSON.stringify(moreFacts));
    expect(moreFacts.toolbarPresent, 'the command bar must be mounted in the workspace').toBe(true);
    expect(moreFacts.moreBtn, 'the More capsule must be mounted').toBe(true);

    const more = 'button[data-tools-toggle]';
    expect(await win.evaluate(() => document.querySelector('button[data-tools-toggle]').getAttribute('aria-pressed')), 'More starts unpressed').toBe('false');
    await win.click(more);
    await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
    const pressed = await win.evaluate(() => document.querySelector('button[data-tools-toggle]').getAttribute('aria-pressed'));
    expect(pressed, 'the More capsule must show pressed while the palette is open').toBe('true');
    await win.screenshot({ path: path.join(SHOTS, 'phase141-sweep-more-open.png') });
    await win.click(more);
    await win.waitForFunction(() => !document.querySelector('[data-tools-palette]'), undefined, { timeout: 5000 });
    const unpressed = await win.evaluate(() => document.querySelector('button[data-tools-toggle]').getAttribute('aria-pressed'));
    expect(unpressed, 'the More capsule must unpress when the palette closes').toBe('false');
    expect(rendererErrors).toEqual([]);
  });
});
