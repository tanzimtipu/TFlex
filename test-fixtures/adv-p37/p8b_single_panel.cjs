// Phase-37 item 1 / DEF-321 - single text-properties instance, both flows.
'use strict';
const { boot, openSample, shot, writeOut, sleep, gotoStage, safeClose } = require('./lib.cjs');

function panelCounts() {
  const all = Array.from(document.querySelectorAll('[data-text-panel]'));
  const insideInspector = all.filter((el) => el.closest('[data-inspector]') !== null);
  const outside = all.filter((el) => el.closest('[data-inspector]') === null);
  const floating = Array.from(document.querySelectorAll('.text-props-float'));
  return {
    total: all.length,
    insideInspector: insideInspector.length,
    outsideInspector: outside.length,
    floatingClass: floating.length,
    outsideInfo: outside.map((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), display: cs.display, visibility: cs.visibility, opacity: cs.opacity }; }),
    floatingInfo: floating.map((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), display: cs.display, visibility: cs.visibility, opacity: cs.opacity }; }),
  };
}

(async () => {
  const { app, window } = await boot({ profile: 'p8b-ann' });
  const out = {};
  try {
    await openSample(app, window, 'report.pdf');
    // ---- annotate flow ----
    await gotoStage(window, 3); await window.waitForTimeout(500);
    const annotate = window.locator('[data-dock-verb="annotate"]');
    if (await annotate.count()) { await annotate.first().click(); await window.waitForSelector('[data-annotation-flyout]', { state: 'visible', timeout: 8000 }).catch(() => {}); }
    await window.click('[data-ann-dropdown-toggle]');
    await window.waitForSelector('[data-ann-dropdown-menu]', { state: 'visible', timeout: 6000 });
    await window.click('[data-ann-dropdown-menu] [data-tool="textbox"]');
    await window.waitForTimeout(400);
    const pg = await window.locator('.pdf-page[data-page="1"]').boundingBox();
    const vp = await window.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const ax = Math.max(40, Math.min(pg.x + pg.width * 0.3, vp.w - 260));
    const ay = Math.max(40, Math.min(pg.y + pg.height * 0.3, vp.h - 130));
    await window.mouse.move(ax, ay); await window.mouse.down();
    await window.mouse.move(ax + 160, ay + 50, { steps: 6 }); await window.mouse.up();
    await window.waitForTimeout(1000);
    out.annPlace = await window.evaluate(panelCounts);
    out.annInsp = await window.evaluate(() => ({ sel: document.querySelector('[data-inspector]').getAttribute('data-inspector-selection'), textTop: !!document.querySelector('[data-inspector-text-top]') }));
    await shot(window, 'p8b-ann-place.png');

    // ---- edit flow ----
    await window.keyboard.press('Escape'); await window.waitForTimeout(300);
    await gotoStage(window, 2); await window.waitForTimeout(600);
    await window.click('[data-edit-tool="text"]').catch(() => {});
    await window.waitForTimeout(300);
    const run = await window.evaluate(() => {
      const slot = document.querySelector('.page-slot[data-page="1"], .pdf-page[data-page="1"]');
      let best = null;
      for (const s of slot.querySelectorAll('.textLayer span')) {
        const t = (s.textContent || '').trim(); const r = s.getBoundingClientRect();
        if (t.length < 10 || r.width < 30) continue;
        if (r.y < 90 || r.y > window.innerHeight - 90) continue;
        if (!best || r.width > best.w) best = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), w: Math.round(r.width) };
      }
      return best;
    });
    out.run = run;
    if (run) {
      await window.mouse.click(run.x, run.y);
      await window.waitForTimeout(700);
      out.editPanel = await window.evaluate(panelCounts);
      out.editInsp = await window.evaluate(() => ({ sel: document.querySelector('[data-inspector]').getAttribute('data-inspector-selection'), textTop: !!document.querySelector('[data-inspector-text-top]') }));
      await shot(window, 'p8b-edit-select.png');
    }
    writeOut('p8b.json', out);
    console.log('P8b done');
  } catch (e) {
    writeOut('p8b.error.txt', String(e && e.stack || e));
    console.log('P8b ERROR', e && e.message);
  } finally { await safeClose(app); process.exit(0); }
})();
