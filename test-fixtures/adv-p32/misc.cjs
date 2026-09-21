// ADV P32 misc: absurd window sizes, canvas-path drags, last-tab reconcile.
const H = require('./harness.cjs');

async function geom(win) {
  return win.evaluate(() => {
    const g = (s) => { const el = document.querySelector(s); return el ? { w: Math.round(el.getBoundingClientRect().width), x: Math.round(el.getBoundingClientRect().x) } : null; };
    return {
      innerW: window.innerWidth, innerH: window.innerHeight,
      A: g('.tab-pane[data-pane="A"]'), B: g('.tab-pane[data-pane="B"]'), rail: g('[data-multi-rail]'), div: g('[data-multi-divider]'),
      docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth,
    };
  });
}

H.run(async () => {
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    await win.waitForTimeout(1200);
    console.log('1440x900 geom=', JSON.stringify(await geom(win)));

    for (const [w, h] of [[900, 600], [700, 500], [500, 400], [400, 300]]) {
      await app.evaluate(({ BrowserWindow }, size) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) win.setSize(size[0], size[1]);
      }, [w, h]);
      await win.waitForTimeout(700);
      console.log(`${w}x${h} geom=`, JSON.stringify(await geom(win)));
    }
    await H.shot(win, 'adv-p32-small-window.png');
    const okA = await win.locator('.tab-pane[data-pane="A"] canvas.pdf-page-canvas').first().isVisible().catch(() => false);
    const okB = await win.locator('.tab-pane[data-pane="B"] canvas.pdf-page-canvas').first().isVisible().catch(() => false);
    console.log('canvases visible at 400x300: A=', okA, 'B=', okB);

    // restore
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; if (w) w.setSize(1440, 900); });
    await win.waitForTimeout(700);
    console.log('restored geom=', JSON.stringify(await geom(win)));

    // Canvas-path drag with Ctrl (copy) from pane A grip to pane B page slot.
    await H.snapshot(win, 'before-canvas-copy');
    await win.keyboard.down('Control');
    let ok = true;
    try {
      await win.locator('.tab-pane[data-pane="A"] [data-page-drag-handle="1"]').first().dragTo(
        win.locator('.tab-pane[data-pane="B"] .page-slot[data-page="2"]').first(),
        { targetPosition: { x: 30, y: 15 }, timeout: 8000 },
      );
    } catch (e) { ok = false; console.log('canvas ctrl drag err', e.message.split('\n')[0]); }
    await win.keyboard.up('Control');
    await win.waitForTimeout(2200);
    console.log('canvas ctrl-copy native ok=', ok);
    let snap = await H.snapshot(win, 'after-canvas-copy');
    if (snap.A === 34 && snap.B === 34) {
      const s = await H.synthDrag(win, '.tab-pane[data-pane="A"] [data-page-drag-handle="1"]', '.tab-pane[data-pane="B"] .page-slot[data-page="2"]', { ctrl: true });
      console.log('canvas synth ctrl over=', JSON.stringify(s.over));
      snap = await H.snapshot(win, 'after-canvas-copy-synth');
    }

    // Reconcile: close BOTH tabs -> mode auto-disables, welcome returns.
    for (const t of ['p32-alpha', 'p32-beta']) {
      const close = win.locator('.tab[data-tab-id]').filter({ hasText: t }).locator('.tab-close').first();
      if (await close.count()) { await close.click().catch((e) => console.log('close', t, e.message.split('\n')[0])); await win.waitForTimeout(700); }
    }
    await win.waitForTimeout(1200);
    console.log('after closing both tabs: tabs=', await H.tabCount(win),
      'multi-mode=', await win.locator('.tab-stage').getAttribute('data-multi-mode'),
      'panes=', await win.locator('.tab-pane[data-pane]').count(),
      'sample cards=', await win.locator('.sample-card').count());
    await H.shot(win, 'adv-p32-last-tab-closed.png');
  } finally { await H.close(app, 'adv-p32-misc'); }
});