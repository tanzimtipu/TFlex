// ADV P32: does the dropped page land where the indicator advertises?
// B's pageOrder gains a NEW orig index = B's old page count. Its position in
// the array is the landed visible position (1-based = index+1).
const H = require('./harness.cjs');

async function bOrder(win, bId) {
  const s = await H.engineStateOf(win, bId);
  return s.pageOrder;
}
function idxOfNew(order, newOrigIdx) { return order.indexOf(newOrigIdx); }

H.run(async () => {
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    await win.waitForTimeout(1200);
    const bId = await H.docIdOfPane(win, 'B');
    await H.setFocused(win, 'B');
    const order0 = await bOrder(win, bId);
    console.log('B pageOrder length=', order0.length, 'first5=', JSON.stringify(order0.slice(0, 5)));
    const newOrigIdx = order0.length; // B's next pdf-lib page index

    // Rail drop A page 1 onto B thumb page 2 -> indicator "before page 2".
    const srcSel = '[data-rail-section-pane="A"] .thumb-item[data-page="1"]';
    const tgtSel = '[data-rail-section-pane="B"] .thumb-item[data-page="2"]';
    await win.locator(srcSel).first().scrollIntoViewIfNeeded();
    await win.locator(tgtSel).first().scrollIntoViewIfNeeded();
    const native = await H.nativeDrag(win, srcSel, tgtSel, false);
    await win.waitForTimeout(2400);
    let order1 = await bOrder(win, bId);
    console.log('after rail drop: native ok=', native.ok, 'order length=', order1.length);
    if (order1.length === order0.length) {
      const s = await H.synthDrag(win, srcSel, tgtSel, {});
      console.log('synth over=', JSON.stringify(s.over));
      await win.waitForTimeout(1200);
      order1 = await bOrder(win, bId);
    }
    console.log('RAIL: advertised indicator = before page 2; landed visible position =', idxOfNew(order1, newOrigIdx) + 1, '(index', idxOfNew(order1, newOrigIdx) + ')');
    console.log('  B order first6=', JSON.stringify(order1.slice(0, 6)));

    // Canvas drop A page 1 onto B page 2 LOWER half -> indicator "after page 2".
    await H.setFocused(win, 'A');
    const order2a = await bOrder(win, bId);
    const newOrigIdx2 = order2a.length;
    const srcLoc = '.tab-pane[data-pane="A"] [data-page-drag-handle="1"]';
    const tgtLoc = '.tab-pane[data-pane="B"] .page-slot[data-page="2"]';
    const tbox = await win.locator(tgtLoc).first().boundingBox();
    let ok2 = true;
    try {
      await win.locator(srcLoc).first().dragTo(win.locator(tgtLoc).first(), { targetPosition: { x: 30, y: Math.round(tbox.height * 0.8) }, timeout: 8000 });
    } catch (e) { ok2 = false; console.log('canvas drag err', e.message.split('\n')[0]); }
    await win.waitForTimeout(2400);
    let order2 = await bOrder(win, bId);
    console.log('after canvas drop: native ok=', ok2, 'order length=', order2.length);
    if (order2.length === order2a.length) {
      const s = await H.synthDrag(win, srcLoc, tgtLoc, { after: true });
      console.log('synth over=', JSON.stringify(s.over));
      await win.waitForTimeout(1200);
      order2 = await bOrder(win, bId);
    }
    console.log('CANVAS lower-half: advertised indicator = after page 2 (i.e. position 3); landed visible position =', idxOfNew(order2, newOrigIdx2) + 1);
    console.log('  B order first6=', JSON.stringify(order2.slice(0, 6)));
    await H.snapshot(win, 'after-position-probes');
  } finally { await H.close(app, 'adv-p32-position'); }
});