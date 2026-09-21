// ADV P32 rail virtualization: compare single-mode vs Multi Mode thumb mount
// and raster counts for a 520-page document.
const H = require('./harness.cjs');

async function railStats(win, scopeSel) {
  return win.evaluate((sel) => {
    const root = sel ? document.querySelector(sel) : document;
    if (!root) return null;
    const items = root.querySelectorAll('.thumb-item');
    const canvases = root.querySelectorAll('canvas.thumb-canvas');
    let rastered = 0, pixels = 0;
    canvases.forEach((c) => { if (c.width > 0 && c.height > 0) { rastered += 1; pixels += c.width * c.height; } });
    return { thumbItems: items.length, canvases: canvases.length, rastered, megapixels: +(pixels / 1e6).toFixed(2) };
  }, scopeSel);
}

H.run(async () => {
  const { app, win } = await H.launch();
  try {
    // Single mode, one 520-page doc.
    await H.openFile(app, win, H.tmpCopy(H.FIX + '\\long.pdf', 'p32-single-big.pdf'));
    await H.waitTabs(win, 1);
    await win.waitForTimeout(2500);
    console.log('single-mode rail stats=', JSON.stringify(await railStats(win, '.tab-pane .document-scroller')));

    // Multi mode, two docs.
    await H.openFile(app, win, H.tmpCopy(H.FIX + '\\report.pdf', 'p32-small.pdf'));
    await H.waitTabs(win, 2);
    await win.locator('.tab[data-tab-id]').filter({ hasText: 'p32-single-big' }).first().click();
    await win.waitForTimeout(300);
    await win.locator('[data-toolbar-multi-mode]').first().click();
    await win.waitForTimeout(500);
    await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'p32-small' }).first().click();
    await win.waitForTimeout(2500);
    console.log('multi rail stats A=', JSON.stringify(await railStats(win, '[data-rail-section-pane="A"]')));
    console.log('multi rail stats B=', JSON.stringify(await railStats(win, '[data-rail-section-pane="B"]')));
    const mem = await app.evaluate(() => { const m = process.memoryUsage(); return { rss: Math.round(m.rss / 1048576), heap: Math.round(m.heapUsed / 1048576) }; });
    console.log('mem=', JSON.stringify(mem));

    // Scroll section B far down and re-check: does the mounted count grow/shrink?
    await win.evaluate(() => {
      const body = document.querySelector('[data-rail-section-pane="B"] [data-rail-section-body]');
      if (body) body.scrollTop = 20000;
    });
    await win.waitForTimeout(1500);
    console.log('after scrolling B rail 20000px: B=', JSON.stringify(await railStats(win, '[data-rail-section-pane="B"]')));
    await H.shot(win, 'adv-p32-rail-virtualization.png');
  } finally { await H.close(app, 'adv-p32-rail'); }
});