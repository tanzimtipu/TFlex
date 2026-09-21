// ADV P32 last: flicker while FILLING pane B; auto-disable when last tab closes.
const H = require('./harness.cjs');

const START = () => {
  window.__advFrames = [];
  window.__advStop = false;
  const off = document.createElement('canvas'); off.width = 32; off.height = 32;
  const octx = off.getContext('2d', { willReadFrequently: true });
  function sample() {
    if (window.__advStop) return;
    const rec = { t: Math.round(performance.now()) };
    for (const p of ['A', 'B']) {
      const pane = document.querySelector(`.tab-pane[data-pane="${p}"]`);
      if (!pane) { rec[p] = { noPane: true }; continue; }
      const vis = getComputedStyle(pane).visibility !== 'hidden' && pane.getAttribute('aria-hidden') !== 'true';
      const c = pane.querySelector('canvas.pdf-page-canvas');
      if (!c || c.width === 0) { rec[p] = { vis, noCanvas: true }; continue; }
      let darkest = 255;
      try {
        octx.fillStyle = '#fff'; octx.fillRect(0, 0, 32, 32);
        octx.drawImage(c, 0, 0, 32, 32);
        const d = octx.getImageData(0, 0, 32, 32).data;
        for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; if (v < darkest) darkest = v; }
      } catch (e) { darkest = -1; }
      rec[p] = { vis, w: c.width, darkest: Math.round(darkest) };
    }
    window.__advFrames.push(rec);
    if (window.__advFrames.length < 6000) requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
};
const STOP = () => { window.__advStop = true; return window.__advFrames; };

function analyze(label, frames) {
  console.log(`\n--- ${label}: ${frames.length} frames ---`);
  for (const p of ['A', 'B']) {
    const seq = frames.filter((f) => f[p] && f[p].vis && !f[p].noCanvas && typeof f[p].darkest === 'number');
    if (seq.length === 0) { console.log(`${p}: no samples`); continue; }
    const blank = seq.filter((f) => f[p].darkest >= 250);
    console.log(`${p}: samples=${seq.length} darkest[min=${Math.min(...seq.map((f) => f[p].darkest))} max=${Math.max(...seq.map((f) => f[p].darkest))}] blankFrames=${blank.length}`);
  }
}

H.run(async () => {
  const { app, win } = await H.launch();
  try {
    // Setup: two docs in single mode, enable multi (A=alpha, B empty).
    const alphaPath = H.tmpCopy(H.FIX + '\\report.pdf', 'p32-lp-alpha.pdf');
    const betaPath = H.tmpCopy(H.FIX + '\\report.pdf', 'p32-lp-beta.pdf');
    await H.openFile(app, win, alphaPath); await H.waitTabs(win, 1);
    await H.openFile(app, win, betaPath); await H.waitTabs(win, 2);
    await win.locator('.tab[data-tab-id]').filter({ hasText: 'p32-lp-alpha' }).first().click();
    await win.waitForTimeout(300);
    await win.locator('[data-toolbar-multi-mode]').first().click();
    await win.waitForTimeout(600);

    // FILL pane B while sampling frames.
    await win.evaluate(START);
    await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'p32-lp-beta' }).first().click();
    await win.waitForTimeout(2500);
    analyze('fill pane B', await win.evaluate(STOP));
    await H.snapshot(win, 'after-fill');

    // Close both tabs cleanly (unmodified) -> auto-disable + welcome.
    for (const t of ['p32-lp-alpha', 'p32-lp-beta']) {
      const close = win.locator('.tab[data-tab-id]').filter({ hasText: t }).locator('.tab-close').first();
      if (await close.count()) { await close.click().catch((e) => console.log('close', t, e.message.split('\n')[0])); await win.waitForTimeout(800); }
    }
    await win.waitForTimeout(1000);
    console.log('after closing both tabs: tabs=', await H.tabCount(win),
      'multi-mode=', await win.locator('.tab-stage').getAttribute('data-multi-mode'),
      'panes=', await win.locator('.tab-pane[data-pane]').count(),
      'sample cards=', await win.locator('.sample-card').count());
    await H.shot(win, 'adv-p32-last-tab-clean.png');
  } finally { await H.close(app, 'adv-p32-last'); }
});