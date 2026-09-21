// ADV P32: control clickability with BOTH panes filled (deterministic setup).
const H = require('./harness.cjs');

async function probeAll(win, sel) {
  return win.evaluate((s) => {
    const els = Array.from(document.querySelectorAll(s));
    return els.map((el) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      const cs = getComputedStyle(el);
      return {
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        visible: cs.visibility !== 'hidden' && cs.display !== 'none' && r.width > 0 && r.height > 0,
        hitTag: hit ? hit.tagName : null,
        hitClass: hit ? String(hit.className || '') : null,
        coveredByPaneB: !!(hit && hit.closest && hit.closest('.tab-pane[data-pane="B"]')),
        coveredByPaneA: !!(hit && hit.closest && hit.closest('.tab-pane[data-pane="A"]')),
        selfOrDescendant: !!(hit && (hit === el || el.contains(hit))),
      };
    });
  }, sel);
}

async function tryClick(win, sel, label) {
  const loc = win.locator(sel).first();
  try {
    await loc.click({ timeout: 3500 });
    console.log(`CLICK ${label}: OK`);
    return true;
  } catch (e) {
    console.log(`CLICK ${label}: FAILED -> ${e.message.split('\n')[0]}`);
    return false;
  }
}

H.run(async () => {
  const { app, win } = await H.launch();
  try {
    await H.twoPane(win, app, { alphaName: 'alpha', betaName: 'beta', betaSrc: 'report.pdf' });
    await win.waitForTimeout(1500);
    await H.snapshot(win, 'both-filled');
    console.log('data-multi-panes=', await win.locator('.tab-stage').getAttribute('data-multi-panes'));
    console.log('multi-mode toolbar controls=', JSON.stringify(await probeAll(win, '[data-toolbar-multi-mode]')));
    console.log('tools badges=', JSON.stringify(await probeAll(win, '[data-tools-badge]')));
    console.log('titlebar open=', JSON.stringify(await probeAll(win, '[data-toolbar-open]')));

    await tryClick(win, '[data-tools-badge]', 'tools-badge');
    await win.waitForTimeout(400);
    console.log('palette open after badge click?', await win.locator('[data-tool-id="multi-mode"]').count());
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    await tryClick(win, '[data-toolbar-open]', 'titlebar open');

    await H.shot(win, 'adv-p32-controls-bothfilled.png');

    // Zoom in on the tools badge area for the screenshot evidence.
    const b = await win.locator('[data-tools-badge]').first().boundingBox();
    if (b) {
      await win.screenshot({ path: H.SHOTS + '\\adv-p32-tools-badge-region.png', clip: { x: Math.max(0, b.x - 120), y: Math.max(0, b.y - 120), width: Math.min(300, 1440 - Math.max(0, b.x - 120)), height: Math.min(340, 900 - Math.max(0, b.y - 120)) } });
    }
  } finally { await H.close(app, 'adv-p32-tools2'); }
});