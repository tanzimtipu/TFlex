// ADV P32: append drop target, and toggling Multi Mode OFF mid-drag.
const H = require('./harness.cjs');

async function toasts(win) { return win.locator('.toast-text').allInnerTexts().catch(() => []); }

H.run(async () => {
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    await win.waitForTimeout(1200);
    const bId = await H.docIdOfPane(win, 'B');
    await H.setFocused(win, 'B');
    const order0 = (await H.engineStateOf(win, bId)).pageOrder;
    const newOrigIdx = order0.length;

    // 1) APPEND drop: A page 1 -> B section empty space (scroller).
    const s = await H.synthDrag(win, '[data-rail-section-pane="A"] .thumb-item[data-page="1"]', '[data-rail-section-pane="B"] .thumb-scroller', {});
    await win.waitForTimeout(800);
    const order1 = (await H.engineStateOf(win, bId)).pageOrder;
    console.log('append drop: over=', JSON.stringify(s.over));
    console.log('  B order length', order0.length, '->', order1.length, 'new page at index', order1.indexOf(newOrigIdx), '(expected', order0.length, '= last)');
    await H.snapshot(win, 'after-append');

    // 2) Toggle Multi Mode OFF while a drag is in flight, then drop.
    const srcSel = '[data-rail-section-pane="A"] .thumb-item[data-page="1"]';
    await H.synthStep(win, 'start', { src: srcSel });
    await win.waitForTimeout(150);
    await H.synthStep(win, 'over', { tgt: '[data-rail-section-pane="B"] .thumb-item[data-page="2"]' });
    await win.waitForTimeout(150);
    // toggle off (the CommandBar control in pane A)
    await win.locator('.tab-pane[data-pane="A"] [data-toolbar-multi-mode]').first().click().catch((e) => console.log('toggle err', e.message.split('\n')[0]));
    await win.waitForTimeout(600);
    console.log('mid-drag toggle: multi-mode=', await win.locator('.tab-stage').getAttribute('data-multi-mode'), 'panes=', await win.locator('.tab-pane[data-pane]').count());
    const drop = await H.synthStep(win, 'drop', { tgt: '[data-rail-section-pane="B"] .thumb-item[data-page="2"]' });
    await H.synthStep(win, 'end', { src: srcSel });
    await win.waitForTimeout(1500);
    console.log('drop after toggle-off=', JSON.stringify(drop));
    await H.snapshot(win, 'after-toggle-middrag');
    console.log('toasts=', JSON.stringify(await toasts(win)));

    // re-enable multi and re-pick B to inspect final state
    await win.locator('[data-toolbar-multi-mode]').first().click();
    await win.waitForTimeout(500);
    const picks = win.locator('.tab-pane[data-pane="B"] [data-pane-pick]');
    if ((await picks.count()) > 0) { await picks.first().click(); await win.waitForTimeout(1200); }
    await H.snapshot(win, 're-enabled');
    await H.shot(win, 'adv-p32-append-toggle.png');
  } finally { await H.close(app, 'adv-p32-append'); }
});