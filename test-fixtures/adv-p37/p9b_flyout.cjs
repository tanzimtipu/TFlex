// Focused: annotation flyout row structure at 1440/880/719/640.
'use strict';
const { boot, openSample, shot, setContentSize, writeOut, sleep, gotoStage, safeClose } = require('./lib.cjs');

const dump = () => {
  const f = document.querySelector('[data-annotation-flyout]');
  if (!f) return null;
  const btns = Array.from(f.querySelectorAll('button')).map((b) => { const r = b.getBoundingClientRect(); return { label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 20), top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) }; });
  const rowsMap = {};
  for (const b of btns) rowsMap[b.top] = (rowsMap[b.top] || 0) + 1;
  const body = f.querySelector('[data-annotation-flyout-scroll]');
  const vis = f.querySelector('[data-ann-tools-visible]');
  const dd = f.querySelector('[data-ann-dropdown-toggle]');
  return {
    iconOnly: f.getAttribute('data-flyout-icon-only'),
    arrows: f.getAttribute('data-flyout-arrows'),
    rows: Object.keys(rowsMap).length,
    rowMap: rowsMap,
    bodyScroll: body ? { clientWidth: body.clientWidth, scrollWidth: body.scrollWidth, overflow: body.scrollWidth > body.clientWidth + 1 } : null,
    visibleToolsCount: vis ? vis.querySelectorAll('button').length : 0,
    hasDropdown: !!dd,
    buttons: btns,
    rect: (() => { const r = f.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
  };
};

(async () => {
  const { app, window } = await boot({ profile: 'p9b-flyout' });
  const out = {};
  try {
    await openSample(app, window, 'report.pdf');
    await gotoStage(window, 3); await window.waitForTimeout(400);
    const annotate = window.locator('[data-dock-verb="annotate"]');
    if (await annotate.count()) { await annotate.first().click(); await window.waitForSelector('[data-annotation-flyout]', { state: 'visible', timeout: 8000 }).catch(() => {}); }
    out.sweep = {};
    for (const w of [1440, 1000, 880, 760, 719, 640]) {
      await setContentSize(app, w, 900); await sleep(700);
      out.sweep[w] = await window.evaluate(dump);
      await shot(window, `p9b-flyout-${w}.png`);
    }
    writeOut('p9b.json', out);
    console.log('P9b done');
  } catch (e) { writeOut('p9b.error.txt', String(e && e.stack || e)); console.log('P9b ERROR', e && e.message); }
  finally { await safeClose(app); process.exit(0); }
})();
