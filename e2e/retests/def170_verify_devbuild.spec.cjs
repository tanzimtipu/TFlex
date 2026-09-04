// DEF-170 retest on the DEV build (launchApp, no executablePath, dist rebuilt
// from current source). The defect: a SECOND Extract run in the same session
// fired its success toast but opened NO tab - the same-path dedupe in the
// tabs reducer collapsed the new result onto the previous extraction-result
// tab (both share the synthetic `<extract>source.pdf` path), orphaning the
// new document and refocusing the OLD result tab.
//
// Fix under test: openEngineBytesAsTab passes dedupePath:false (App.tsx) and
// the reducer skips the same-path branch for derived opens (tabs.ts).
//
// Contract verified here:
//   1. extract("3") -> result tab "marker-3pages.pdf - page 3", active, MARKER-PAGE-3.
//   2. back to source, extract("1") -> a THIRD tab "marker-3pages.pdf - page 1"
//      opens, is ACTIVE (no refocus of the old result tab), and shows
//      MARKER-PAGE-1 (its own document - nothing orphaned).
//   3. Each result tab still owns its own document: activating "- page 3"
//      shows MARKER-PAGE-3, activating "- page 1" shows MARKER-PAGE-1; the
//      two tabs have distinct tab ids and distinct engine sessions.
//   4. A third extract (page 2) also lands its own tab.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');

const FIXTURE = path.resolve(__dirname, '..', '..', 'test-fixtures', 'marker-3pages.pdf');

async function dumpTabs(win, label) {
  return win.evaluate((lbl) => {
    const tabs = Array.from(document.querySelectorAll('[role="tab"], .tab'));
    const panes = Array.from(document.querySelectorAll('.tab-pane'));
    return {
      label: lbl,
      tabIds: tabs.map((t) => t.getAttribute('data-tab-id')),
      titles: tabs.map((t) => (t.textContent || '').trim()),
      activeTitle: (document.querySelector('.tab-active, [role="tab"][aria-selected="true"]')?.textContent || '').trim(),
      panes: panes.map((p) => ({
        hidden: p.getAttribute('aria-hidden'),
        marker: ((p.querySelector('.pdf-page .textLayer') || {}).textContent || '').match(/MARKER-PAGE-(\d)/)?.[0] || null,
      })),
      toast: document.querySelector('.toast')?.textContent || null,
    };
  }, label);
}

async function runExtract(win, pages) {
  // The palette may already be open from a previous extract (the modal
  // confirm does not close it) - only toggle when it is closed, otherwise
  // the click would close it (same guard as the def167 probe spec).
  const palUp = await win.evaluate(() => !!document.querySelector('[data-tools-palette]'));
  if (!palUp) {
    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
  }
  await win.click('[data-tool-id="split"]');
  await win.waitForSelector('.modal-dialog.dialog', { timeout: 8000 });
  await win.fill('.modal-dialog .modal-input', pages);
  await win.click('.modal-dialog button.btn-primary');
  await win.waitForTimeout(2500);
}

/** titleSuffix like "page 3" for a result tab; pass null for the bare
 *  source tab ("marker-3pages.pdf" with no suffix). Returns the tab id. */
async function activateTab(win, titleSuffix) {
  const id = await win.evaluate((suffix) => {
    const tabs = Array.from(document.querySelectorAll('[role="tab"], .tab'));
    const t = tabs.find((x) => {
      const title = (x.textContent || '').trim();
      return suffix === null
        ? title === 'marker-3pages.pdf'
        : title.includes(`\u2014 ${suffix}`);
    });
    return t ? t.getAttribute('data-tab-id') : null;
  }, titleSuffix);
  expect(id, `tab for ${titleSuffix ?? 'source'} exists`).not.toBeNull();
  // Tabs activate on mousedown; Playwright's click performs a real
  // mousedown+mouseup, unlike a synthetic element.click().
  await win.locator(`[data-tab-id="${id}"]`).click();
  await win.waitForTimeout(1200);
  return id;
}

async function visibleMarker(win) {
  return win.evaluate(() => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
    return ((pane?.querySelector('.pdf-page .textLayer') || {}).textContent || '').match(/MARKER-PAGE-(\d)/)?.[0] || null;
  });
}

test('DEF-170: two sequential extracts open two distinct tabs, each with its own document', async () => {
  test.setTimeout(240000);
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

    // Let any startup toast dismiss so the second extract's toast is fresh.
    await win.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 15000 }).catch(() => {});

    // --- Extract 1: page 3 ---
    await runExtract(win, '3');
    const afterFirst = await dumpTabs(win, 'after extract(3)');
    console.log('[def170]', JSON.stringify(afterFirst));
    expect(afterFirst.titles.length, 'first extract opens its result tab').toBe(2);
    expect(afterFirst.activeTitle).toContain('page 3');
    expect(afterFirst.panes.find((p) => p.hidden === 'false')?.marker).toBe('MARKER-PAGE-3');
    expect(afterFirst.toast || '').not.toContain('out of bounds');
    await win.screenshot({ path: 'screenshots/def-170-retest-first-extract.png' });

    // Dismiss the first toast so the second extract's toast is provably its own.
    await win.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 15000 }).catch(() => {});

    // --- Back to the SOURCE tab, then Extract 2: page 1 ---
    await activateTab(win, null);
    const atSource = await dumpTabs(win, 'back on source');
    console.log('[def170]', JSON.stringify(atSource));
    expect(atSource.activeTitle, 'the bare source tab (no result suffix) is focused').toBe('marker-3pages.pdf');
    expect(await visibleMarker(win)).toBe('MARKER-PAGE-1');

    await runExtract(win, '1');
    const toastLate = await win.evaluate(() => document.querySelector('.toast')?.textContent || null);
    const afterSecond = await dumpTabs(win, 'after extract(1) - second extract');
    console.log('[def170]', JSON.stringify(afterSecond));
    await win.screenshot({ path: 'screenshots/def-170-retest-second-extract-tab.png' });

    // THE DEF-170 CONTRACT: a THIRD tab opens, is active, and is the new doc.
    expect(afterSecond.titles.length, 'second extract must open a tab for its result (DEF-170: tab count was stuck at 2)').toBe(3);
    expect(toastLate || '').toContain('Extracted 1 page');
    expect(afterSecond.activeTitle, 'the NEW result tab must be focused (DEF-170: the OLD result tab was refocused)').toContain('page 1');
    expect(afterSecond.activeTitle, 'the focused tab must NOT be the old result tab').not.toContain('page 3');
    expect(afterSecond.panes.find((p) => p.hidden === 'false')?.marker, 'the focused tab must show its own document (MARKER-PAGE-1)').toBe('MARKER-PAGE-1');
    // Both result tabs exist side by side, distinct ids.
    const titleById = {};
    afterSecond.tabIds.forEach((id, i) => { titleById[id] = afterSecond.titles[i]; });
    const page3Id = afterSecond.tabIds.find((id) => titleById[id].includes('\u2014 page 3'));
    const page1Id = afterSecond.tabIds.find((id) => titleById[id].includes('\u2014 page 1'));
    expect(page3Id, 'the old page-3 result tab is still present').toBeDefined();
    expect(page1Id, 'the new page-1 result tab exists').toBeDefined();
    expect(new Set(afterSecond.tabIds).size, 'all three tabs have distinct ids').toBe(3);

    // --- Each tab still owns its own document ---
    const page3Id2 = await activateTab(win, 'page 3');
    expect(page3Id2).toBe(page3Id);
    expect(await visibleMarker(win), 'old result tab still shows ITS OWN doc (MARKER-PAGE-3)').toBe('MARKER-PAGE-3');
    await win.screenshot({ path: 'screenshots/def-170-retest-page3-tab-own-doc.png' });
    const page1Id2 = await activateTab(win, 'page 1');
    expect(page1Id2).toBe(page1Id);
    expect(await visibleMarker(win), 'new result tab shows its own doc (MARKER-PAGE-1)').toBe('MARKER-PAGE-1');
    expect(page1Id2, 'the two result tabs are distinct tabs').not.toBe(page3Id2);
    await win.screenshot({ path: 'screenshots/def-170-retest-page1-tab-own-doc.png' });

    // --- Regression: a THIRD extract (page 2) also lands its own tab ---
    await win.waitForFunction(() => !document.querySelector('.toast'), null, { timeout: 15000 }).catch(() => {});
    await activateTab(win, null);
    await runExtract(win, '2');
    const afterThird = await dumpTabs(win, 'after extract(2) - third extract');
    console.log('[def170]', JSON.stringify(afterThird));
    expect(afterThird.titles.length, 'third extract also opens its own tab (4 tabs total)').toBe(4);
    expect(afterThird.activeTitle).toContain('page 2');
    expect(afterThird.panes.find((p) => p.hidden === 'false')?.marker).toBe('MARKER-PAGE-2');
    await win.screenshot({ path: 'screenshots/def-170-retest-third-extract.png' });
  } finally {
    await hardClose(electronApp);
  }
});
