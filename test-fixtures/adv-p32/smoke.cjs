// ADV P32 smoke: verify launch, two-pane setup, state dump, selectors.
const H = require('./harness.cjs');

H.run(async () => {
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    const stage = win.locator('.tab-stage');
    console.log('multi-mode=', await stage.getAttribute('data-multi-mode'));
    console.log('multi-panes=', await stage.getAttribute('data-multi-panes'));
    H.check('pane A header', (await H.paneInfo(win, 'A')).text);
    H.check('pane B header', (await H.paneInfo(win, 'B')).text);
    console.log('rail=', JSON.stringify(await H.railInfo(win), null, 2));
    console.log('focused=', await H.focusedPane(win));
    console.log('tabs=', await H.tabCount(win));
    console.log('canvasA=', await win.locator('.tab-pane[data-pane="A"] canvas.pdf-page-canvas').count());
    console.log('canvasB=', await win.locator('.tab-pane[data-pane="B"] canvas.pdf-page-canvas').count());
    const gripA = await win.locator('.tab-pane[data-pane="A"] [data-page-drag-handle="1"]').count();
    console.log('gripA(1)=', gripA);
    const diag = await win.evaluate(() => window.tflexDiagnostics());
    console.log('diag keys=', Object.keys(diag).join(','));
    console.log('diag pageCount/currentPage/modified=', diag.pageCount, diag.currentPage, diag.modified);
    await H.shot(win, 'adv-p32-smoke.png');
  } finally {
    await H.close(app, 'adv-p32-smoke');
  }
});