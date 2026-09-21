// ADV P32: is the All Tools badge clickable in Multi Mode with both panes filled?
const H = require('./harness.cjs');

async function hitTest(win, sel) {
  return win.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { missing: true };
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const chain = [];
    let n = hit;
    while (n && chain.length < 6) { chain.push(`${n.tagName}${n.className ? '.' + String(n.className).split(' ').join('.') : ''}`); n = n.parentElement; }
    return {
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      hit: hit ? `${hit.tagName}.${String(hit.className || '').split(' ').join('.')}` : null,
      hitChain: chain,
      inPaneB: !!(hit && hit.closest && hit.closest('.tab-pane[data-pane="B"]')),
      inPaneA: !!(hit && hit.closest && hit.closest('.tab-pane[data-pane="A"]')),
    };
  }, sel);
}

H.run(async () => {
  const { app, win } = await H.launch();
  try {
    // Single mode baseline (one doc).
    await H.openFile(app, win, H.tmpCopy(H.FIX + '\\report.pdf', 'p32-tools.pdf'));
    await H.waitTabs(win, 1);
    await win.waitForTimeout(600);
    console.log('SINGLE mode hit-test tools badge=', JSON.stringify(await hitTest(win, '[data-tools-badge]')));
    await win.locator('[data-tools-badge]').first().click({ timeout: 4000 }).then(() => console.log('SINGLE click: OK')).catch((e) => console.log('SINGLE click FAILED:', e.message.split('\n')[0]));
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    // Enable multi mode, pane B empty.
    await win.locator('[data-toolbar-multi-mode]').first().click();
    await win.waitForTimeout(600);
    console.log('MULTI (B empty) hit-test tools badge=', JSON.stringify(await hitTest(win, '[data-tools-badge]')));
    await win.locator('[data-tools-badge]').first().click({ timeout: 4000 }).then(() => console.log('MULTI(B empty) click: OK')).catch((e) => console.log('MULTI(B empty) click FAILED:', e.message.split('\n')[0]));
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    // Fill pane B with a second doc.
    await H.openFile(app, win, H.tmpCopy(H.FIX + '\\marker-3pages.pdf', 'p32-tools2.pdf'));
    await H.waitTabs(win, 2);
    await win.waitForTimeout(800);
    await H.snapshot(win, 'multi-both-filled');
    console.log('MULTI (B filled) hit-test tools badge=', JSON.stringify(await hitTest(win, '[data-tools-badge]')));
    await win.locator('[data-tools-badge]').first().click({ timeout: 4000 }).then(() => console.log('MULTI(B filled) click: OK')).catch((e) => console.log('MULTI(B filled) click FAILED:', e.message.split('\n')[0]));

    // Also hit-test the CommandBar multi-mode control in this state.
    console.log('MULTI (B filled) hit-test multi-mode=', JSON.stringify(await hitTest(win, '[data-toolbar-multi-mode]')));
    await H.shot(win, 'adv-p32-tools-badge.png');

    // And the title-bar Save/Open controls (are they covered too?).
    for (const sel of ['[data-toolbar-open]', '[data-toolbar-multi-mode]', '[data-tools-badge]']) {
      console.log(`hit ${sel} =`, JSON.stringify(await hitTest(win, sel)));
    }
  } finally { await H.close(app, 'adv-p32-tools'); }
});