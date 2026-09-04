// DEF-170 repro (found during the DEF-167 retest): a SECOND Extract run
// while a previous extraction-result tab is still open orphans its result
// document - the engine runs, the success toast fires, but no tab opens;
// the app refocuses the OLD extraction tab (still showing the OLD doc).
// Also proves DEF-167's contract on a fresh session:
//   A: fresh extract("3") -> new tab "- page 3", MARKER-PAGE-3, no error.
//   C: after closing the extraction tab, extract("2") -> works again.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');

const FIXTURE = path.resolve(__dirname, '..', '..', 'test-fixtures', 'marker-3pages.pdf');

test('probe: extract("3") fresh, then extract("1")', async () => {
  test.setTimeout(180000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 20000 });
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, FIXTURE);
    await win.locator('button:has-text("Open PDF")').first().click();
    await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 20000 });
    await win.waitForTimeout(1500);

    const dump = (label) => win.evaluate((lbl) => {
      const tabs = Array.from(document.querySelectorAll('[role="tab"], .tab'));
      const panes = Array.from(document.querySelectorAll('.tab-pane'));
      return {
        label: lbl,
        titles: tabs.map((t) => (t.textContent || '').trim()),
        activeTitle: (document.querySelector('.tab-active, [role="tab"][aria-selected="true"]')?.textContent || '').trim(),
        panes: panes.map((p) => ({
          hidden: p.getAttribute('aria-hidden'),
          marker: ((p.querySelector('.pdf-page .textLayer') || {}).textContent || '').match(/MARKER-PAGE-(\d)/)?.[0] || null,
        })),
        toast: document.querySelector('.toast')?.textContent || null,
      };
    }, label).then((d) => { console.log('[probe]', JSON.stringify(d)); return d; });

    // --- A: extract "3" directly on the fresh source ---
    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
    await win.click('[data-tool-id="split"]');
    await win.waitForSelector('.modal-dialog.dialog', { timeout: 8000 });
    await win.fill('.modal-dialog .modal-input', '3');
    await win.click('.modal-dialog button.btn-primary');
    await win.waitForTimeout(2500);
    const afterA = await dump('A: after extract("3")');
    await win.screenshot({ path: 'screenshots/def-167-probe-extract3-fresh.png' });
    // DEF-167: fresh extract of the LAST page succeeds, correct page, no error.
    expect(afterA.titles.length).toBe(2);
    expect(afterA.activeTitle).toContain('page 3');
    expect(afterA.panes.find((p) => p.hidden === 'false')?.marker).toBe('MARKER-PAGE-3');
    expect(afterA.toast || '').not.toContain('out of bounds');

    // --- B: back to source, extract "1" ---
    // First let the toast from A fully dismiss so B's toast (if any) is fresh.
    await win.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 15000 }).catch(() => {});
    const sourceTabId = await win.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('[role="tab"], .tab'));
      const src = tabs.find((t) => /marker-3pages\.pdf/.test(t.textContent || '') && !/page \d/.test(t.textContent || ''));
      return src ? src.getAttribute('data-tab-id') : null;
    });
    await win.locator(`[data-tab-id="${sourceTabId}"]`).click();
    await win.waitForTimeout(900);
    await win.click('[data-tools-toggle]');
    const palUp = await win.evaluate(() => !!document.querySelector('[data-tools-palette]'));
    if (!palUp) { await win.click('[data-tools-toggle]'); await win.waitForSelector('[data-tools-palette]', { timeout: 8000 }); }
    await win.click('[data-tool-id="split"]');
    await win.waitForSelector('.modal-dialog.dialog', { timeout: 8000 });
    await win.fill('.modal-dialog .modal-input', '1');
    await win.click('.modal-dialog button.btn-primary');
    // Watch the toast right after the confirm: present at +600ms?
    const toastEarly = await win.evaluate(() => document.querySelector('.toast')?.textContent || null);
    console.log('[probe] B toast at +600ms:', JSON.stringify(toastEarly));
    await win.waitForTimeout(2500);
    const toastLate = await win.evaluate(() => document.querySelector('.toast')?.textContent || null);
    console.log('[probe] B toast at +3.1s:', JSON.stringify(toastLate));
    await dump('B: after extract("1")');
    await win.screenshot({ path: 'screenshots/def-170-repro-second-extract-orphan.png' });
    // DEF-170: the second extract's toast is FRESH (null at +600ms -> its own
    // success toast), yet NO third tab opens and the app refocuses the OLD
    // extraction tab whose content is still the OLD document (MARKER-PAGE-3,
    // not the requested MARKER-PAGE-1). The new result doc is orphaned.
    const afterB = await dump('B: after extract("1")');
    expect(toastEarly, 'the second extract fires its own success toast').toBeNull();
    expect(toastLate || '').toContain('Extracted 1 page');
    expect(afterB.titles.length, 'the second extract must open a tab for its result (DEF-170: it does not)').toBe(3);
    expect(afterB.activeTitle).toContain('page 1');

    // --- C: close the extraction tab, then extract "2" from the source ---
    await win.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 15000 }).catch(() => {});
    const extractTabId = await win.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('[role="tab"], .tab'));
      const ex = tabs.find((t) => /— page \d/.test(t.textContent || ''));
      return ex ? ex.getAttribute('data-tab-id') : null;
    });
    if (extractTabId) {
      await win.locator(`[data-tab-id="${extractTabId}"]`).hover();
      await win.waitForTimeout(300);
      await win.locator(`[data-tab-id="${extractTabId}"] .tab-close`).click({ force: true });
      // The extraction tab holds an unsaved doc -> a close prompt appears.
      // Choose "Don't save" to discard and drop the tab.
      await win.waitForSelector('.modal-dialog[data-close-tab-prompt], [data-close-prompt="true"]', { timeout: 8000 });
      await win.locator("button:has-text(\"Don't save\")").first().click();
      await win.waitForTimeout(900);
      const sourceId2 = await win.evaluate(() => {
        const tabs = Array.from(document.querySelectorAll('[role="tab"], .tab'));
        const src = tabs.find((t) => /marker-3pages\.pdf/.test(t.textContent || '') && !/page \d/.test(t.textContent || ''));
        return src ? src.getAttribute('data-tab-id') : null;
      });
      await win.locator(`[data-tab-id="${sourceId2}"]`).click();
      await win.waitForTimeout(600);
      await win.click('[data-tools-toggle]');
      const palUp2 = await win.evaluate(() => !!document.querySelector('[data-tools-palette]'));
      if (!palUp2) { await win.click('[data-tools-toggle]'); await win.waitForSelector('[data-tools-palette]', { timeout: 8000 }); }
      await win.click('[data-tool-id="split"]');
      await win.waitForSelector('.modal-dialog.dialog', { timeout: 8000 });
      await win.fill('.modal-dialog .modal-input', '2');
      await win.click('.modal-dialog button.btn-primary');
      await win.waitForTimeout(2500);
      await dump('C: after closing extraction tab + extract("2")');
      await win.screenshot({ path: 'screenshots/def-170-repro-extract-after-close.png' });
      // Recovery: with the previous extraction tab closed, a fresh extract
      // opens its result tab again (correct page 2, active).
      // Pre-DEF-170-fix this expected 2 titles: the buggy sequence B never
      // opened its "— page 1" tab, so C started from 1 result tab. With the
      // fix B's result tab persists, so C ends at 3 tabs (source + page 1
      // + page 2).
      const afterC = await dump('C: after closing extraction tab + extract("2")');
      expect(afterC.titles.length).toBe(3);
      expect(afterC.activeTitle).toContain('page 2');
      expect(afterC.panes.find((p) => p.hidden === 'false')?.marker).toBe('MARKER-PAGE-2');
    }

    expect(afterA.titles.length, 'extract("3") must open a tab for its result').toBe(2);
  } finally {
    await hardClose(electronApp);
  }
});