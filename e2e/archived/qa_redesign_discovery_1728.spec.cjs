// qa discovery probe for the six-phase visual redesign (v1.7.28 worktree).
// Mirrors the steps of the failing official suites and dumps the ACTUAL DOM
// state at each step, so stale-selector vs real-regression can be decided.
const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');

test.describe('QA redesign discovery', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    electronApp = await launchApp();
    window = await electronApp.firstWindow();
  });

  test.afterEach(async () => {
    if (electronApp) await hardClose(electronApp);
  });

  test('DOM truth dump', async () => {
    test.setTimeout(240000);
    await window.waitForSelector('.app', { timeout: 15000 });
    const home = await window.evaluate(() => ({
      sampleCards: document.querySelectorAll('.sample-card').length,
      updateIndicator: !!document.querySelector('[data-update-indicator]'),
      headerClasses: Array.from(document.querySelectorAll('header, [class*=header], [class*=titlebar], [class*=title-bar]')).slice(0, 6).map(el => el.className),
    }));
    console.log('HOME:', JSON.stringify(home));

    // Open report.pdf
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await window.click('button:has-text("Open PDF")');
    await window.waitForSelector('.workspace', { timeout: 15000 });
    await window.waitForTimeout(1500);

    const workspace = await window.evaluate(() => {
      const sel = s => document.querySelectorAll(s).length;
      const firstPage = document.querySelector('.pdf-page');
      return {
        pageView: sel('.page-view'),
        pageSlot: sel('.page-slot'),
        pdfPage: sel('.pdf-page'),
        thumbs: sel('.thumb'),
        firstPageClass: firstPage ? firstPage.className : null,
        toolbarBtns: Array.from(document.querySelectorAll('[data-toolbar-edit-toggle], [data-tools-toggle], [data-toolbar-audit], [data-toolbar-delete-pages]')).map(b => b.getAttribute('aria-label')),
      };
    });
    console.log('WORKSPACE:', JSON.stringify(workspace));

    // Where does Highlight live?
    const highlight = await window.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button[aria-label="Highlight"]'));
      return btns.map(b => ({ visible: !!b.offsetParent, parent: b.closest('[data-edit-toolbar]') ? 'edit-toolbar' : (b.closest('[class*=ann]') ? b.closest('[class*=ann]').className : b.parentElement.className) }));
    });
    console.log('HIGHLIGHT-BUTTON:', JSON.stringify(highlight));

    // Edit toggle
    await window.click('[data-toolbar-edit-toggle]');
    await window.waitForTimeout(800);
    const editToolbar = await window.evaluate(() => {
      const et = document.querySelector('[data-edit-toolbar]');
      return {
        present: !!et,
        btns: et ? Array.from(et.querySelectorAll('button')).map(b => ({ label: b.getAttribute('aria-label') || b.textContent.trim(), data: b.getAttribute('data-edit-tool') })) : [],
        highlightHere: et ? !!et.querySelector('button[aria-label="Highlight"]') : false,
      };
    });
    console.log('EDIT-TOOLBAR:', JSON.stringify(editToolbar));
    await window.click('[data-toolbar-edit-toggle]'); // close
    await window.waitForTimeout(500);

    // Annotation toolbar: how is it opened? try clicking Highlight directly if visible
    const annBefore = await window.evaluate(() => {
      const b = document.querySelector('button[aria-label="Highlight"]');
      return { exists: !!b, visible: b ? !!b.offsetParent : false };
    });
    console.log('HIGHLIGHT-BEFORE-TOGGLES:', JSON.stringify(annBefore));

    // Tools palette
    await window.click('[data-tools-toggle]');
    await window.waitForTimeout(800);
    const tools = await window.evaluate(() => ({
      toolIds: Array.from(document.querySelectorAll('[data-tool-id]')).map(b => b.getAttribute('data-tool-id')),
      highlightNow: (() => { const b = document.querySelector('button[aria-label="Highlight"]'); return b ? !!b.offsetParent : false; })(),
    }));
    console.log('TOOLS-PALETTE:', JSON.stringify(tools));

    // Stamp dialog via tools palette
    const stampBtn = window.locator('[data-tool-id="stamp"]');
    if (await stampBtn.count()) {
      await stampBtn.click();
      await window.waitForTimeout(800);
      const stampDlg = await window.evaluate(() => {
        const dlg = document.querySelector('[data-stamp-dialog]');
        const body = document.querySelector('.modal-body');
        return {
          dlgPresent: !!dlg,
          bodyPresent: !!body,
          bodyFirstChild: body ? `${body.firstElementChild.tagName}.${body.firstElementChild.className}` : null,
          bodyBtns: body ? Array.from(body.querySelectorAll('button')).map(b => b.textContent.trim().slice(0, 30)) : [],
        };
      });
      console.log('STAMP-DIALOG:', JSON.stringify(stampDlg));
      await window.keyboard.press('Escape');
      await window.waitForTimeout(400);
    }

    // Optimize dialog
    const optBtn = window.locator('button[aria-label="Reduce file size"]').first();
    if (await optBtn.count()) {
      await optBtn.click();
      await window.waitForTimeout(800);
      const opt = await window.evaluate(() => {
        const sheet = document.querySelector('.sheet, [role="dialog"]');
        return {
          present: !!sheet,
          sheetClass: sheet ? sheet.className : null,
          selects: Array.from(document.querySelectorAll('.sheet select, [role="dialog"] select')).map(s => ({ aria: s.getAttribute('aria-label'), options: Array.from(s.options).map(o => o.value) })),
          btns: sheet ? Array.from(sheet.querySelectorAll('button')).map(b => b.textContent.trim().slice(0, 25)) : [],
        };
      });
      console.log('OPTIMIZE:', JSON.stringify(opt));
      await window.keyboard.press('Escape');
      await window.waitForTimeout(400);
    } else {
      console.log('OPTIMIZE: trigger button[aria-label="Reduce file size"] NOT FOUND');
      const alt = await window.evaluate(() => Array.from(document.querySelectorAll('button')).map(b => b.getAttribute('aria-label')).filter(l => l && /optim|reduce|size/i.test(l)));
      console.log('OPTIMIZE-ALT:', JSON.stringify(alt));
    }

    // About dialog: inject update state FIRST, then open via menu action
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('update:statusChanged', { kind: 'available', version: '1.6.0', releaseDate: '2026-08-31' });
      win.webContents.send('menu:action', { action: 'about' });
    });
    await window.waitForTimeout(1200);
    const about = await window.evaluate(() => ({
      dlg: !!document.querySelector('[data-about-dialog]'),
      updateRow: (() => { const el = document.querySelector('[data-about-update]'); return el ? el.textContent : null; })(),
      version: (() => { const el = document.querySelector('[data-about-version]'); return el ? el.textContent : null; })(),
    }));
    console.log('ABOUT:', JSON.stringify(about));
    await window.keyboard.press('Escape');
    await window.waitForTimeout(400);

    // Sign / signature surface
    const sigIds = await window.evaluate(() => Array.from(document.querySelectorAll('[data-tool-id]')).map(b => b.getAttribute('data-tool-id')).filter(id => /sign|stamp/i.test(id)));
    console.log('SIG-TOOL-IDS:', JSON.stringify(sigIds));

    // Toast structure: trigger a no-op save? Just probe container classes
    const toastProbe = await window.evaluate(() => ({
      toastStackClass: document.querySelector('[class*=toast]') ? document.querySelector('[class*=toast]').className : null,
      toastEl: !!document.querySelector('.toast'),
    }));
    console.log('TOAST:', JSON.stringify(toastProbe));

    // Theme token sanity: accent color + semantic colors
    const tokens = await window.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const pick = n => cs.getPropertyValue(n).trim();
      return {
        theme: document.documentElement.getAttribute('data-theme'),
        accent: pick('--accent') || pick('--accent-color'),
        success: pick('--success'), error: pick('--error'), warning: pick('--warning'),
        bg: pick('--bg'), fg: pick('--fg'),
      };
    });
    console.log('TOKENS:', JSON.stringify(tokens));
  });
});
