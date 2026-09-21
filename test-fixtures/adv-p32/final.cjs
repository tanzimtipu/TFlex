// ADV P32 final: rail header focus, intra-doc reorder, drop-on-self,
// content identity after a cross-doc move, All-tools sync.
const H = require('./harness.cjs');

async function toasts(win) { return win.locator('.toast-text').allInnerTexts().catch(() => []); }

async function thumbSig(win, pane, page) {
  return win.evaluate(({ p, pg }) => {
    const c = document.querySelector(`[data-rail-section-pane="${p}"] .thumb-item[data-page="${pg}"] canvas.thumb-canvas`);
    if (!c || c.width === 0 || c.height === 0) return null;
    const off = document.createElement('canvas'); off.width = 24; off.height = 32;
    const ctx = off.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 24, 32);
    ctx.drawImage(c, 0, 0, 24, 32);
    const d = ctx.getImageData(0, 0, 24, 32).data; const out = [];
    for (let i = 0; i < d.length; i += 4) out.push(Math.round((d[i] + d[i + 1] + d[i + 2]) / 3));
    return out;
  }, { p: pane, pg: page });
}
function diff(a, b) { if (!a || !b) return null; let s = 0; for (let i = 0; i < a.length; i += 1) s += Math.abs(a[i] - b[i]); return +(s / a.length).toFixed(2); }

H.run(async () => {
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    await win.waitForTimeout(1200);

    // 1) rail section header focuses its pane
    await H.setFocused(win, 'A');
    await win.locator('[data-rail-section-pane="B"] [data-rail-section-header]').click();
    await win.waitForTimeout(400);
    console.log('after B header click: focused=', await H.focusedPane(win),
      'activeB=', await win.locator('[data-rail-section-pane="B"]').getAttribute('data-rail-section-active'),
      'activeA=', await win.locator('[data-rail-section-pane="A"]').getAttribute('data-rail-section-active'));

    // 2) All tools entry state sync
    const cmdPressed = await win.locator('[data-toolbar-multi-mode]').first().getAttribute('aria-pressed');
    await win.locator('[data-tools-badge]').first().click();
    await win.waitForSelector('[data-tool-id="multi-mode"]', { timeout: 10000 });
    const allPressed = await win.locator('[data-tool-id="multi-mode"]').getAttribute('aria-pressed');
    console.log('multi-mode aria-pressed: commandbar=', cmdPressed, 'alltools=', allPressed);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);

    // 3) intra-doc reorder: drag A page 3 onto A page 1 (before page 1)
    const aId = await H.docIdOfPane(win, 'A');
    const orderBefore = (await H.engineStateOf(win, aId)).pageOrder.slice(0, 5);
    const p1before = await thumbSig(win, 'A', 1);
    const p3before = await thumbSig(win, 'A', 3);
    const r = await H.railCrossDrag(win, 'A', 3, 'A', 1, {});
    const orderAfter = (await H.engineStateOf(win, aId)).pageOrder.slice(0, 5);
    const p1after = await thumbSig(win, 'A', 1);
    console.log('intra reorder: order', JSON.stringify(orderBefore), '->', JSON.stringify(orderAfter));
    console.log('  thumb diff(A.new1, A.old3)=', diff(p1after, p3before), 'diff(A.new1, A.old1)=', diff(p1after, p1before));
    console.log('  counts A/B=', JSON.stringify(await H.paneInfo(win, 'A')), JSON.stringify(await H.paneInfo(win, 'B')), 'toasts=', JSON.stringify(await toasts(win)));

    // 4) drop A page 1 onto itself (same slot) -> should be a no-op, no crash
    const before = await H.snapshot(win, 'before-self-drop');
    const s = await H.synthDrag(win, '[data-rail-section-pane="A"] .thumb-item[data-page="1"]', '[data-rail-section-pane="A"] .thumb-item[data-page="1"]', {});
    await win.waitForTimeout(800);
    const after = await H.snapshot(win, 'after-self-drop');
    console.log('self-drop synth=', JSON.stringify(s.over), 'changed=', before.A !== after.A || before.B !== after.B, 'toasts=', JSON.stringify(await toasts(win)));

    // 5) content identity after a cross-doc move
    const refA1 = await thumbSig(win, 'A', 1);
    const b2old = await thumbSig(win, 'B', 2);
    const d = await H.railCrossDrag(win, 'A', 1, 'B', 2, {});
    console.log('cross move method=', d.method, 'counts=', JSON.stringify(d.after));
    const b2new = await thumbSig(win, 'B', 2);
    console.log('content: diff(B.new2, A.old1)=', diff(b2new, refA1), 'diff(B.new2, B.old2)=', diff(b2new, b2old));
    await H.shot(win, 'adv-p32-final.png');
  } finally { await H.close(app, 'adv-p32-final'); }
});