// ADV P32 headline: undo/redo across a cross-document move.
// Reports exact page counts (header + rail thumb count + diagnostics) after
// every step. Scenario U1 undoes source-first, U2 target-first.
const H = require('./harness.cjs');

async function scenario(order) {
  console.log(`\n===== SCENARIO ${order} =====`);
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    await win.waitForTimeout(600);
    await H.snapshot(win, 'base');

    const d = await H.railCrossDrag(win, 'A', 1, 'B', 2, {});
    console.log('drag method=', d.method, 'before=', JSON.stringify(d.before), 'after=', JSON.stringify(d.after));
    await H.snapshot(win, 'after-move');
    await H.shot(win, `adv-p32-undo-${order}-after-move.png`);

    const first = order === 'U1' ? 'A' : 'B';
    const second = first === 'A' ? 'B' : 'A';

    await H.setFocused(win, first);
    await H.snapshot(win, `focus-${first}`);
    await H.undo(win);
    await H.snapshot(win, `undo-${first}`);
    await H.shot(win, `adv-p32-undo-${order}-undo-${first}.png`);

    await H.setFocused(win, second);
    await H.snapshot(win, `focus-${second}`);
    await H.undo(win);
    await H.snapshot(win, `undo-${second}`);
    await H.shot(win, `adv-p32-undo-${order}-undo-${second}.png`);

    // Redo both, in the same order.
    await H.setFocused(win, first);
    await H.redo(win);
    await H.snapshot(win, `redo-${first}`);
    await H.setFocused(win, second);
    await H.redo(win);
    await H.snapshot(win, `redo-${second}`);

    const toasts = await win.locator('.toast-text').allInnerTexts().catch(() => []);
    console.log('toasts=', JSON.stringify(toasts));
  } finally {
    await H.close(app, `adv-p32-undo-${order}`);
  }
}

H.run(async () => {
  await scenario('U1');
  await scenario('U2');
});