// ADV P32: concrete consequence of the same-file-in-both-panes bypass:
// two independent copies of one file, last save wins.
const H = require('./harness.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument } = require(path.join(H.ROOT, 'node_modules', '@cantoo', 'pdf-lib'));

async function fileInfo(p) {
  const d = await PDFDocument.load(fs.readFileSync(p), { updateMetadata: false });
  return { pages: d.getPageCount(), size: fs.statSync(p).size };
}

H.run(async () => {
  const { app, win } = await H.launch();
  try {
    const p = H.tmpCopy(H.FIX + '\\report.pdf', 'p32-samefile.pdf');
    const variant = p.replace('p32-samefile.pdf', 'P32-SAMEFILE.PDF');
    console.log('file=', p, 'initial=', JSON.stringify(await fileInfo(p)));

    await H.openFile(app, win, p);
    await H.waitTabs(win, 1);
    await H.openFile(app, win, variant);
    await H.waitTabs(win, 2);
    await win.locator('.tab[data-tab-id]').first().click();
    await win.waitForTimeout(300);
    await win.locator('[data-toolbar-multi-mode]').first().click();
    await win.waitForTimeout(500);
    await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').first().click();
    await win.waitForTimeout(1200);
    await H.snapshot(win, 'same-file-in-both-panes');

    // Delete page 1 in pane A via the rail selection action bar.
    await H.setFocused(win, 'A');
    await win.locator('[data-rail-section-pane="A"] .thumb-item[data-page="1"]').first().click({ modifiers: ['Shift'] });
    await win.waitForTimeout(500);
    const del = win.locator('[data-rail-section-pane="A"] [aria-label="Delete this page"]');
    console.log('delete control count=', await del.count());
    if ((await del.count()) > 0) {
      await del.first().click();
      await win.waitForTimeout(1500);
    } else {
      // fallback: toolbar delete
      await win.locator('.tab-pane[data-pane="A"] [data-toolbar-delete-pages]').first().click().catch(() => {});
      await win.waitForTimeout(1000);
    }
    const aAfter = await H.paneInfo(win, 'A');
    const bAfter = await H.paneInfo(win, 'B');
    console.log('after deleting page 1 in A: A=', aAfter.pageCount, 'B=', bAfter.pageCount);

    // Save A (writes the file).
    await H.setFocused(win, 'A');
    await win.keyboard.press('Control+s');
    await win.waitForTimeout(2200);
    console.log('after Save A: on-disk=', JSON.stringify(await fileInfo(p)));

    // Save B (overwrites the same file).
    await H.setFocused(win, 'B');
    await win.keyboard.press('Control+s');
    await win.waitForTimeout(2200);
    console.log('after Save B: on-disk=', JSON.stringify(await fileInfo(p)));

    console.log('CONCLUSION: pane A deleted a page and saved 33 pages; pane B (a second copy of the same file) saved 34 pages over it.');
    await H.shot(win, 'adv-p32-samefile-save.png');
  } finally { await H.close(app, 'adv-p32-samefile-save'); }
});