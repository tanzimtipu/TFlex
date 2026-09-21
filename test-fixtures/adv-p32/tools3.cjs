// ADV P32: can a real pointer click at the All Tools badge open the palette
// in Multi Mode (two overlapping badges)?
const H = require('./harness.cjs');

H.run(async () => {
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    await win.waitForTimeout(1500);
    const n = await win.locator('[data-tools-badge]').count();
    console.log('tools badge count (both panes filled)=', n);
    const b = await win.locator('[data-tools-badge]').first().boundingBox();
    console.log('badge box=', JSON.stringify(b));

    // Real pointer click at the badge's visual position.
    await win.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await win.waitForTimeout(700);
    const open = await win.locator('[data-tool-id="multi-mode"]').count();
    console.log('palette open after coordinate click?', open > 0);
    if (open > 0) {
      await win.keyboard.press('Escape');
      await win.waitForTimeout(400);
    }

    // Forced click on nth(1) (the topmost, pane B chrome).
    await win.locator('[data-tools-badge]').nth(1).click({ force: true, timeout: 3000 }).then(() => console.log('forced nth(1) click OK')).catch((e) => console.log('forced nth(1) FAILED', e.message.split('\n')[0]));
    await win.waitForTimeout(600);
    console.log('palette open after forced nth(1)?', (await win.locator('[data-tool-id="multi-mode"]').count()) > 0);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    // Zoomed screenshot of the badge region.
    await win.screenshot({ path: H.SHOTS + '\\adv-p32-badge-region.png', clip: { x: Math.max(0, b.x - 140), y: Math.max(0, b.y - 160), width: 200, height: 380 } });
    console.log('screenshot saved');
  } finally { await H.close(app, 'adv-p32-tools3'); }
});