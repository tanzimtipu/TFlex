// ADV P32: DEF-278 same-file guard vs Windows case-insensitive / separator
// path variants. Can the same file be shown in both panes?
const H = require('./harness.cjs');
const fs = require('node:fs');

async function toasts(win) { return win.locator('.toast-text').allInnerTexts().catch(() => []); }

async function attempt(label, variantFn) {
  console.log(`\n===== ${label} =====`);
  const { app, win } = await H.launch();
  try {
    const p = H.tmpCopy(H.FIX + '\\report.pdf', 'p32-alpha.pdf');
    const variant = variantFn(p);
    console.log('path      =', p);
    console.log('variant   =', variant, 'exists=', fs.existsSync(variant));
    await H.openFile(app, win, p);
    await H.waitTabs(win, 1);
    await H.openFile(app, win, variant);
    await win.waitForTimeout(800);
    const tabs = await H.tabCount(win);
    console.log('tabs after opening both variants =', tabs, '(1 means dedupe caught it; 2 means it did not)');
    if (tabs < 2) return;

    // Activate the first (exact path) tab, enable multi mode -> pane A.
    await win.locator('.tab[data-tab-id]').first().click();
    await win.waitForTimeout(300);
    await win.locator('[data-toolbar-multi-mode]').first().click();
    await win.waitForTimeout(500);
    const picks = win.locator('.tab-pane[data-pane="B"] [data-pane-pick]');
    const titles = await picks.allInnerTexts();
    console.log('pane B pick list=', JSON.stringify(titles));
    if ((await picks.count()) === 0) { console.log('no pick available'); return; }
    await picks.first().click();
    await win.waitForTimeout(1200);
    const rail = await H.railInfo(win);
    console.log('rail sections=', JSON.stringify(rail.map((s) => ({ pane: s.pane, header: s.header }))));
    const bEmpty = await win.locator('.tab-pane[data-pane="B"][data-pane-empty]').count();
    console.log('pane B empty=', bEmpty, 'toasts=', JSON.stringify(await toasts(win)));
    // Are the two engine docs separate? (same file loaded twice)
    if (rail.length === 2) {
      const aDoc = rail.find((s) => s.pane === 'A').doc;
      const bDoc = rail.find((s) => s.pane === 'B').doc;
      console.log('SAME FILE IN BOTH PANES =', aDoc !== bDoc, '(two engine docs, same on-disk file)');
    }
    await H.shot(win, `adv-p32-samefile-${label.replace(/[^a-z0-9]/gi, '')}.png`);
  } finally { await H.close(app, 'adv-p32-case'); }
}

H.run(async () => {
  await attempt('case-variant filename', (p) => p.replace('p32-alpha.pdf', 'P32-ALPHA.PDF'));
  await attempt('forward slashes', (p) => p.replace(/\\/g, '/'));
  await attempt('drive letter case', (p) => 'c' + p.slice(1));
});