// Characterize the dock label rung vs the documented ladder.
'use strict';
const { boot, openSample, shot, setContentSize, writeOut, sleep, gotoStage, safeClose } = require('./lib.cjs');

const snap = () => {
  const d = document.querySelector('[data-action-dock]');
  const insp = document.querySelector('[data-inspector]');
  const panel = document.querySelector('[data-context-panel]');
  if (!d) return null;
  const labels = Array.from(d.querySelectorAll('.action-dock-label')).filter((e) => e.getBoundingClientRect().width > 0).length;
  const host = d.parentElement;
  return {
    labels,
    iconOnly: d.getAttribute('data-dock-icon-only'),
    arrows: d.getAttribute('data-dock-arrows'),
    band: d.getAttribute('data-dock-band'),
    freeBand: d.getAttribute('data-dock-free-band'),
    dockW: Math.round(d.getBoundingClientRect().width),
    canvasHostW: host ? Math.round(host.clientWidth) : null,
    inspectorCollapsed: insp ? insp.getAttribute('data-inspector-collapsed') : null,
    panelCollapsed: panel ? panel.getAttribute('data-context-panel-collapsed') === 'true' : null,
  };
};

(async () => {
  const { app, window } = await boot({ profile: 'p10-ladder' });
  const out = {};
  try {
    await openSample(app, window, 'report.pdf');
    await gotoStage(window, 1); await window.waitForTimeout(400);
    out.pages = {};
    for (const w of [1920, 1700, 1600, 1550, 1500, 1450, 1440, 1400, 1392, 1350, 1300, 1250, 1200, 1199]) {
      await setContentSize(app, w, 900); await sleep(650);
      out.pages[w] = await window.evaluate(snap);
    }
    await setContentSize(app, 1440, 900); await sleep(650);
    await shot(window, 'p10-1440-pages.png');
    await gotoStage(window, 4); await window.waitForTimeout(500);
    out.deliver1440 = await window.evaluate(snap);
    await shot(window, 'p10-1440-deliver.png');
    await setContentSize(app, 1600, 900); await sleep(650);
    out.deliver1600 = await window.evaluate(snap);
    await shot(window, 'p10-1600-deliver.png');
    writeOut('p10.json', out);
    console.log('P10 done');
  } catch (e) { writeOut('p10.error.txt', String(e && e.stack || e)); console.log('P10 ERROR', e && e.message); }
  finally { await safeClose(app); process.exit(0); }
})();
