// ADV P32 perf/memory with a 520-page document: rail virtualization,
// responsiveness, memory across operations, cross-doc move on big docs.
const H = require('./harness.cjs');

async function mem(app) {
  try { return await app.evaluate(() => { const m = process.memoryUsage(); return { rss: Math.round(m.rss / 1048576), heap: Math.round(m.heapUsed / 1048576) }; }); }
  catch (e) { return { err: e.message }; }
}

H.run(async () => {
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'small', betaName: 'big', alphaSrc: 'report.pdf', betaSrc: 'long.pdf' });
    await win.waitForTimeout(1500);
    await H.snapshot(win, 'base(34,520)');
    const rail = await H.railInfo(win);
    console.log('rail=', JSON.stringify(rail));
    console.log('railB thumbItems=', rail.find((s) => s.pane === 'B').thumbItems, '(520-page doc; virtualization should mount far fewer)');
    console.log('mem after load=', JSON.stringify(await mem(app)));

    // responsiveness: 10 focus switches
    let t0 = Date.now();
    for (let i = 0; i < 10; i += 1) {
      await win.locator(`.multi-pane-header[data-pane="${i % 2 === 0 ? 'A' : 'B'}"]`).click({ delay: 0 });
      await win.waitForTimeout(60);
    }
    console.log('10 focus switches took', Date.now() - t0, 'ms');
    // scroll the big pane
    t0 = Date.now();
    const sc = win.locator('.tab-pane[data-pane="B"] .document-scroller');
    const box = await sc.boundingBox();
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 6; i += 1) { await win.mouse.wheel(0, 1500); await win.waitForTimeout(120); }
    console.log('6 wheel scrolls in 520-page pane took', Date.now() - t0, 'ms');
    // divider drags
    t0 = Date.now();
    for (let i = 0; i < 6; i += 1) {
      const div = await win.locator('[data-multi-divider]').boundingBox();
      const cy = div.y + div.height / 2;
      await win.mouse.move(div.x + div.width / 2, cy);
      await win.mouse.down();
      await win.mouse.move(300 + (i % 2) * 700, cy, { steps: 5 });
      await win.mouse.up();
      await win.waitForTimeout(120);
    }
    console.log('6 divider drags took', Date.now() - t0, 'ms');
    console.log('mem after stress=', JSON.stringify(await mem(app)));

    // cross-doc move on big docs: report(34) -> long(520)
    await win.locator('[data-rail-section-pane="A"] .thumb-item[data-page="1"]').first().scrollIntoViewIfNeeded();
    const d = await H.railCrossDrag(win, 'A', 1, 'B', 2, {});
    console.log('big-doc move method=', d.method, 'before=', JSON.stringify(d.before), 'after=', JSON.stringify(d.after));
    await H.snapshot(win, 'after-big-move');
    console.log('mem after move=', JSON.stringify(await mem(app)));
    await H.shot(win, 'adv-p32-perf-big.png');
  } finally { await H.close(app, 'adv-p32-perf'); }
});