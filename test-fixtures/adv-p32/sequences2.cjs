// ADV P32 hostile sequences part 2: mid-drag pane clear / tab close,
// closing a pane's tab, same-file refusal, assign/clear/pick integrity,
// focused-pane operation routing.
const H = require('./harness.cjs');

async function toasts(win) { return win.locator('.toast-text').allInnerTexts().catch(() => []); }
function tabByText(win, text) { return win.locator('.tab[data-tab-id]').filter({ hasText: text }).first(); }

async function s6_clearMidDrag() {
  console.log('\n===== S6: clear pane B while a drag is in flight =====');
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    await win.waitForTimeout(500);
    await H.snapshot(win, 'base');
    const srcSel = '[data-rail-section-pane="A"] .thumb-item[data-page="1"]';
    await H.synthStep(win, 'start', { src: srcSel });
    await win.waitForTimeout(150);
    await H.synthStep(win, 'over', { tgt: '[data-rail-section-pane="B"] .thumb-item[data-page="2"]' });
    await win.waitForTimeout(150);
    // clear pane B while dragging
    await win.locator('.tab-pane[data-pane="B"] [data-pane-clear]').click().catch((e) => console.log('clear err', e.message));
    await win.waitForTimeout(400);
    console.log('after clear: B empty=', await win.locator('.tab-pane[data-pane="B"][data-pane-empty]').count(),
      'rail sections=', (await H.railInfo(win)).map((s) => s.pane).join(','));
    // attempt the drop on the now-gone B thumb
    const drop = await H.synthStep(win, 'drop', { tgt: '[data-rail-section-pane="B"] .thumb-item[data-page="2"]' });
    await H.synthStep(win, 'end', { src: srcSel });
    await win.waitForTimeout(1200);
    console.log('drop=', JSON.stringify(drop));
    await H.snapshot(win, 'after-clear-mid-drag');
    console.log('toasts=', JSON.stringify(await toasts(win)));
    await H.shot(win, 'adv-p32-clear-middrag.png');
  } finally { await H.close(app, 'adv-p32-s6'); }
}

async function s7_closeSourceMidDrag() {
  console.log('\n===== S7: close the SOURCE tab while a drag is in flight =====');
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    await win.waitForTimeout(500);
    await H.snapshot(win, 'base');
    const srcSel = '[data-rail-section-pane="A"] .thumb-item[data-page="1"]';
    await H.synthStep(win, 'start', { src: srcSel });
    await win.waitForTimeout(150);
    await H.synthStep(win, 'over', { tgt: '[data-rail-section-pane="B"] .thumb-item[data-page="2"]' });
    await win.waitForTimeout(150);
    // close pane A's tab (alpha) mid-drag
    await tabByText(win, 'p32-alpha').locator('.tab-close').click().catch((e) => console.log('close err', e.message));
    await win.waitForTimeout(800);
    console.log('after close: tabs=', await H.tabCount(win), 'A empty=', await win.locator('.tab-pane[data-pane="A"][data-pane-empty]').count(),
      'A header count=', await win.locator('.tab-pane[data-pane="A"] [data-pane-header]').count());
    const drop = await H.synthStep(win, 'drop', { tgt: '[data-rail-section-pane="B"] .thumb-item[data-page="2"]' });
    await H.synthStep(win, 'end', { src: srcSel });
    await win.waitForTimeout(1200);
    console.log('drop=', JSON.stringify(drop));
    await H.snapshot(win, 'after-close-source-middrag');
    console.log('toasts=', JSON.stringify(await toasts(win)));
    await H.shot(win, 'adv-p32-close-middrag.png');
  } finally { await H.close(app, 'adv-p32-s7'); }
}

async function s8_closePaneTabUnmodified() {
  console.log('\n===== S8: close pane B tab (unmodified) -> pane empties cleanly =====');
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    await win.waitForTimeout(500);
    await tabByText(win, 'p32-beta').locator('.tab-close').click().catch((e) => console.log('close err', e.message));
    await win.waitForTimeout(900);
    console.log('tabs=', await H.tabCount(win), 'B empty=', await win.locator('.tab-pane[data-pane="B"][data-pane-empty]').count(),
      'B stale header=', await win.locator('.tab-pane[data-pane="B"] [data-pane-header]').count());
    await H.snapshot(win, 'after-close-B');
    console.log('toasts=', JSON.stringify(await toasts(win)));
  } finally { await H.close(app, 'adv-p32-s8'); }
}

async function s9_sameFileTwice() {
  console.log('\n===== S9: open the SAME file twice, assign second to other pane =====');
  const { app, win } = await H.launch();
  try {
    const p = H.tmpCopy(H.FIX + '\\report.pdf', 'p32-same.pdf');
    await H.openFile(app, win, p);
    await H.waitTabs(win, 1);
    await H.openFile(app, win, p); // same path again -> second tab
    await H.waitTabs(win, 2);
    console.log('tabs=', await H.tabCount(win));
    // activate first, enable mode -> A = tab1
    await win.locator('.tab[data-tab-id]').first().click();
    await win.waitForTimeout(300);
    await win.locator('[data-toolbar-multi-mode]').first().click();
    await win.waitForTimeout(500);
    // pane B pick list should exclude the same-path tab (path guard? pick list only excludes by tab id)
    const picks = win.locator('.tab-pane[data-pane="B"] [data-pane-pick]');
    console.log('B pick count=', await picks.count(), 'titles=', JSON.stringify(await picks.allInnerTexts()));
    if ((await picks.count()) > 0) {
      await picks.first().click();
      await win.waitForTimeout(1000);
      console.log('after pick: B empty=', await win.locator('.tab-pane[data-pane="B"][data-pane-empty]').count());
      console.log('toasts=', JSON.stringify(await toasts(win)));
    }
    await H.shot(win, 'adv-p32-same-file.png');
  } finally { await H.close(app, 'adv-p32-s9'); }
}

async function s10_assignClearPickIntegrity() {
  console.log('\n===== S10: assign/clear/pick/tab-strip sequence -> never same doc in both panes =====');
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    await win.waitForTimeout(500);
    // open a third document
    await H.openFile(app, win, H.tmpCopy(H.FIX + '\\marker-3pages.pdf', 'p32-gamma.pdf'));
    await H.waitTabs(win, 3);
    await win.waitForTimeout(800);
    await H.snapshot(win, 'after-gamma-open');

    const steps = [];
    async function snapState(tag) {
      const rail = await H.railInfo(win);
      const docs = rail.map((s) => s.doc);
      const same = docs.length === 2 && docs[0] === docs[1];
      steps.push({ tag, panes: rail.map((s) => s.pane).join(','), docs, sameDocInBothPanes: same, headers: rail.map((s) => s.header.split(' ')[1]) });
    }
    await snapState('base');
    // clear A
    await win.locator('.tab-pane[data-pane="A"] [data-pane-clear]').click();
    await win.waitForTimeout(500); await snapState('clearA');
    // pick beta into A from its empty state
    const picksA = win.locator('.tab-pane[data-pane="A"] [data-pane-pick]');
    console.log('A picks=', JSON.stringify(await picksA.allInnerTexts()));
    if ((await picksA.count()) > 0) { await picksA.first().click(); await win.waitForTimeout(1000); }
    await snapState('pickA');
    // click beta tab in strip (if it is in B -> focus B; if not -> assign to focused)
    await tabByText(win, 'p32-beta').click(); await win.waitForTimeout(600); await snapState('strip-beta');
    // click gamma tab
    await tabByText(win, 'p32-gamma').click(); await win.waitForTimeout(600); await snapState('strip-gamma');
    // click alpha tab
    await tabByText(win, 'p32-alpha').click(); await win.waitForTimeout(600); await snapState('strip-alpha');
    console.log('STEPS', JSON.stringify(steps, null, 1));
    await H.snapshot(win, 'final');
    await H.shot(win, 'adv-p32-integrity.png');
  } finally { await H.close(app, 'adv-p32-s10'); }
}

async function s11_focusedRouting() {
  console.log('\n===== S11: rotate acts on FOCUSED pane only =====');
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    await win.waitForTimeout(500);
    const aId = await H.docIdOfPane(win, 'A');
    const bId = await H.docIdOfPane(win, 'B');
    console.log('docIds A/B=', aId, bId);
    await H.setFocused(win, 'A');
    await win.locator('.tab-pane[data-pane="A"] [data-toolbar-rotate-cw]').first().click().catch((e) => console.log('rotate err', e.message));
    await win.waitForTimeout(1200);
    const aState = await H.engineStateOf(win, aId);
    const bState = await H.engineStateOf(win, bId);
    console.log('A rotations[0..3]=', JSON.stringify(aState.rotations && aState.rotations.slice(0, 4)), 'A pageCount=', aState.pageCount);
    console.log('B rotations[0..3]=', JSON.stringify(bState.rotations && bState.rotations.slice(0, 4)), 'B pageCount=', bState.pageCount);
    console.log('A modified=', aState.modified, 'B modified=', bState.modified);
    await H.snapshot(win, 'after-rotate-A');
    await H.shot(win, 'adv-p32-rotate-focused.png');
  } finally { await H.close(app, 'adv-p32-s11'); }
}

H.run(async () => {
  await s6_clearMidDrag();
  await s7_closeSourceMidDrag();
  await s8_closePaneTabUnmodified();
  await s9_sameFileTwice();
  await s10_assignClearPickIntegrity();
  await s11_focusedRouting();
});