// ADV P32 divider: correct per-drag box re-read, both directions, past min.
const H = require('./harness.cjs');

async function widths(win) {
  return win.evaluate(() => {
    const g = (s) => { const el = document.querySelector(s); return el ? Math.round(el.getBoundingClientRect().width) : null; };
    const stage = document.querySelector('.tab-stage');
    return {
      A: g('.tab-pane[data-pane="A"]'), B: g('.tab-pane[data-pane="B"]'), div: g('[data-multi-divider]'),
      split: stage ? stage.style.getPropertyValue('--tf-split') : null,
    };
  });
}

H.run(async () => {
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    await win.waitForTimeout(500);
    const winBox = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    console.log('window=', JSON.stringify(winBox), 'initial=', JSON.stringify(await widths(win)));

    async function dragToFraction(targetX) {
      const div = await win.locator('[data-multi-divider]').boundingBox();
      const cy = div.y + div.height / 2;
      await win.mouse.move(div.x + div.width / 2, cy);
      await win.mouse.down();
      await win.mouse.move(targetX, cy, { steps: 10 });
      const mid = await widths(win);
      await win.mouse.up();
      await win.waitForTimeout(350);
      return { mid, after: await widths(win) };
    }

    const left = await dragToFraction(2);
    console.log('drag to x=2  mid=', JSON.stringify(left.mid), 'after=', JSON.stringify(left.after));
    const right = await dragToFraction(winBox.w - 2);
    console.log('drag to far right mid=', JSON.stringify(right.mid), 'after=', JSON.stringify(right.after));
    const beyond = await dragToFraction(winBox.w + 500);
    console.log('drag beyond right after=', JSON.stringify(beyond.after));
    const back = await dragToFraction(400);
    console.log('drag to x=400 after=', JSON.stringify(back.after));

    const okA = await win.locator('.tab-pane[data-pane="A"] canvas.pdf-page-canvas').first().isVisible();
    const okB = await win.locator('.tab-pane[data-pane="B"] canvas.pdf-page-canvas').first().isVisible();
    console.log('canvas visible A/B=', okA, okB);
    await H.shot(win, 'adv-p32-divider-fixed.png');
    console.log('final=', JSON.stringify(await widths(win)));
  } finally { await H.close(app, 'adv-p32-divider'); }
});