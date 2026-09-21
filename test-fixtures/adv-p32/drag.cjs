// ADV P32 drag semantics: empty-range, last page, invalid drop targets,
// copy-then-move-back, double drop, drop during refresh.
const H = require('./harness.cjs');

async function toasts(win) {
  return win.locator('.toast-text').allInnerTexts().catch(() => []);
}

async function caseEmptyRange() {
  console.log('\n===== E: 1-page source, move its only page =====');
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'one', betaName: 'big', alphaSrc: 'form.pdf', betaSrc: 'report.pdf' });
    await win.waitForTimeout(500);
    await H.snapshot(win, 'base(1,34)');
    // clear any startup toasts
    const d = await H.railCrossDrag(win, 'A', 1, 'B', 2, {});
    console.log('drag method=', d.method, 'before=', JSON.stringify(d.before), 'after=', JSON.stringify(d.after));
    await H.snapshot(win, 'after-empty-range-drag');
    console.log('toasts=', JSON.stringify(await toasts(win)));
    await H.shot(win, 'adv-p32-empty-range.png');
  } finally { await H.close(app, 'adv-p32-drag-empty'); }
}

async function caseInvalidTargets() {
  console.log('\n===== F: drop on divider / rail header / other header / outside =====');
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    await win.waitForTimeout(500);
    await H.snapshot(win, 'base');

    const targets = [
      ['divider', '[data-multi-divider]'],
      ['rail-header-B', '[data-rail-section-pane="B"] [data-rail-section-header]'],
      ['pane-B-header', '.multi-pane-header[data-pane="B"]'],
      ['stage-outside', '.tab-stage'],
    ];
    for (const [name, sel] of targets) {
      const before = await H.snapshot(win, `before-${name}`);
      const s = await H.synthDrag(win, '[data-rail-section-pane="A"] .thumb-item[data-page="1"]', sel, {});
      const after = await H.snapshot(win, `after-${name}`);
      console.log(`target=${name} synth=${JSON.stringify(s.over)} prevented=${s.defaultPrevented} changed=${before.A !== after.A || before.B !== after.B}`);
      console.log(`  toasts=${JSON.stringify(await toasts(win))}`);
    }
    await H.shot(win, 'adv-p32-invalid-targets.png');
  } finally { await H.close(app, 'adv-p32-drag-invalid'); }
}

async function caseCopyThenMoveBack() {
  console.log('\n===== G: Ctrl-copy A->B then move the copy back B->A =====');
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    await win.waitForTimeout(500);
    await H.snapshot(win, 'base');
    const c = await H.railCrossDrag(win, 'A', 1, 'B', 2, { ctrl: true });
    console.log('copy method=', c.method, 'before=', JSON.stringify(c.before), 'after=', JSON.stringify(c.after));
    await H.snapshot(win, 'after-copy');
    // now move B's page 2 back to A page 1
    const m = await H.railCrossDrag(win, 'B', 2, 'A', 1, {});
    console.log('move-back method=', m.method, 'before=', JSON.stringify(m.before), 'after=', JSON.stringify(m.after));
    await H.snapshot(win, 'after-move-back');
    console.log('toasts=', JSON.stringify(await toasts(win)));
    await H.shot(win, 'adv-p32-copy-moveback.png');
  } finally { await H.close(app, 'adv-p32-copy-moveback'); }
}

async function caseDoubleDrop() {
  console.log('\n===== H: drop the same page twice quickly =====');
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    await win.waitForTimeout(500);
    await H.snapshot(win, 'base');
    const srcSel = '[data-rail-section-pane="A"] .thumb-item[data-page="1"]';
    const tgtSel = '[data-rail-section-pane="B"] .thumb-item[data-page="2"]';
    await H.synthStep(win, 'start', { src: srcSel });
    await win.waitForTimeout(120);
    await H.synthStep(win, 'over', { tgt: tgtSel });
    // two drops back to back without waiting
    const d1 = await H.synthStep(win, 'drop', { tgt: tgtSel });
    const d2 = await H.synthStep(win, 'drop', { tgt: tgtSel });
    await win.waitForTimeout(2600);
    console.log('drop1=', JSON.stringify(d1), 'drop2=', JSON.stringify(d2));
    await H.snapshot(win, 'after-double-drop');
    console.log('toasts=', JSON.stringify(await toasts(win)));
    await H.shot(win, 'adv-p32-double-drop.png');
  } finally { await H.close(app, 'adv-p32-double-drop'); }
}

async function caseDropDuringRefresh() {
  console.log('\n===== I: two cross-doc moves back-to-back (refresh in flight) =====');
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    await win.waitForTimeout(500);
    await H.snapshot(win, 'base');
    const srcSel = '[data-rail-section-pane="A"] .thumb-item[data-page="1"]';
    const tgtSel = '[data-rail-section-pane="B"] .thumb-item[data-page="2"]';
    // Fire drag 1 and, without waiting for it to settle, drag 2.
    await H.synthStep(win, 'start', { src: srcSel });
    await win.waitForTimeout(100);
    await H.synthStep(win, 'over', { tgt: tgtSel });
    await H.synthStep(win, 'drop', { tgt: tgtSel });
    await win.waitForTimeout(50);
    await H.synthStep(win, 'start', { src: srcSel });
    await win.waitForTimeout(100);
    await H.synthStep(win, 'over', { tgt: tgtSel });
    await H.synthStep(win, 'drop', { tgt: tgtSel });
    await win.waitForTimeout(3500);
    await H.snapshot(win, 'after-two-rapid-moves');
    console.log('toasts=', JSON.stringify(await toasts(win)));
    await H.shot(win, 'adv-p32-rapid-moves.png');
  } finally { await H.close(app, 'adv-p32-rapid'); }
}

H.run(async () => {
  await caseEmptyRange();
  await caseInvalidTargets();
  await caseCopyThenMoveBack();
  await caseDoubleDrop();
  await caseDropDuringRefresh();
});