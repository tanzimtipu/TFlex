// Phase-37 item 2/6 - the responsive ladder sweep.
'use strict';
const { boot, openSample, shot, setContentSize, writeOut, sleep } = require('./lib.cjs');

const STAGES = { 1: 'pages', 2: 'edit', 3: 'review', 4: 'deliver' };

function snapshot() {
  const q = (s) => document.querySelector(s);
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const dock = q('[data-action-dock]');
  const dockRect = rect(dock);
  let rows = 0; let verbs = [];
  let hint = false, hintVisible = false;
  let labelCount = 0;
  let arrowL = null, arrowR = null, arrowLVisible = false, arrowRVisible = false;
  let scroll = null;
  if (dock) {
    const btns = Array.from(dock.querySelectorAll('.action-dock-scroll .action-dock-group > button'));
    verbs = btns.map((b) => b.getAttribute('data-dock-verb'));
    const tops = new Set(btns.map((b) => Math.round(b.getBoundingClientRect().top)));
    rows = tops.size;
    labelCount = Array.from(dock.querySelectorAll('.action-dock-label')).filter(visible).length;
    const h = q('[data-dock-hint]');
    hint = !!h; hintVisible = visible(h);
    const al = q('[data-dock-arrow="left"]'); const ar = q('[data-dock-arrow="right"]');
    arrowL = rect(al); arrowR = rect(ar); arrowLVisible = visible(al); arrowRVisible = visible(ar);
    const sc = q('[data-dock-scroll]');
    if (sc) scroll = { scrollLeft: Math.round(sc.scrollLeft), scrollWidth: sc.scrollWidth, clientWidth: sc.clientWidth, overflow: sc.scrollWidth > sc.clientWidth + 1 };
  }
  const panel = q('[data-context-panel]');
  const insp = q('[data-inspector]');
  const appMain = q('.app-main');
  const pagePill = q('[data-page-pill]');
  const zoomPill = q('[data-zoom-pill]');
  const pillRects = [rect(pagePill), rect(zoomPill)].filter(Boolean);
  // dock/pill vertical overlap
  let overlap = false;
  if (dockRect) {
    for (const p of pillRects) {
      if (dockRect.x < p.x + p.w && dockRect.x + dockRect.w > p.x && dockRect.y < p.y + p.h && dockRect.y + dockRect.h > p.y) overlap = true;
    }
  }
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    railPresent: !!q('[data-stage-rail]'),
    appRailHidden: appMain ? appMain.getAttribute('data-stage-rail-hidden') : null,
    panelCollapsed: panel ? panel.getAttribute('data-context-panel-collapsed') === 'true' : null,
    panelRuler: !!q('[data-context-panel-ruler]'),
    inspectorCollapsed: insp ? insp.getAttribute('data-inspector-collapsed') === 'true' : null,
    inspectorStrip: !!q('[data-inspector-collapsed-strip]'),
    appInspectorCollapsed: appMain ? appMain.getAttribute('data-inspector-collapsed') : null,
    dock: dock ? {
      rect: dockRect,
      rows,
      verbs,
      labelCount,
      iconOnly: dock.getAttribute('data-dock-icon-only'),
      compact: dock.getAttribute('data-dock-compact'),
      arrows: dock.getAttribute('data-dock-arrows'),
      band: dock.getAttribute('data-dock-band'),
      freeBand: dock.getAttribute('data-dock-free-band'),
      lift: dock.getAttribute('data-dock-lift'),
      hint, hintVisible,
      arrowL, arrowR, arrowLVisible, arrowRVisible,
      scroll,
      pillOverlap: overlap,
      rightEdgeGap: dockRect ? Math.round(window.innerWidth - (dockRect.x + dockRect.w)) : null,
      leftEdgeGap: dockRect ? dockRect.x : null,
    } : null,
  };
}

async function oneWidth(app, window, w, h, stage, label) {
  await setContentSize(app, w, h);
  await sleep(700);
  await window.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  const snap = await window.evaluate(snapshot);
  snap.requested = { w, h, stage, label };
  return snap;
}

(async () => {
  const { app, window } = await boot({ profile: 'p1-ladder' });
  const results = [];
  try {
    await openSample(app, window, 'report.pdf');
    const seq = [1920, 1800, 1600, 1440, 1300, 1200, 1199, 1100, 1000, 999, 950, 900, 880, 879, 820, 800, 760, 720, 719, 700, 680, 660, 640];
    const desc = [...seq];
    const asc = [...seq].slice(0, -1).reverse();
    for (const stage of [1, 4]) {
      await window.evaluate((s) => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); }, stage);
      await window.keyboard.press(`Control+${stage}`);
      await sleep(400);
      for (const w of desc) {
        results.push(await oneWidth(app, window, w, 900, stage, 'down'));
      }
      for (const w of asc) {
        results.push(await oneWidth(app, window, w, 900, stage, 'up'));
      }
    }
    // Extreme shapes at the smallest stage set (deliver = most verbs)
    await window.keyboard.press('Control+4'); await sleep(400);
    results.push(await oneWidth(app, window, 640, 1200, 4, 'tall-narrow'));
    results.push(await oneWidth(app, window, 1920, 420, 4, 'short-wide'));

    // Screen: dock at 1920, 1000, 880, 719, 640 (deliver)
    await window.keyboard.press('Control+4'); await sleep(300);
    for (const w of [1920, 1000, 880, 719, 640]) {
      await oneWidth(app, window, w, 900, 4, 'shot');
      await shot(window, `p1-deliver-${w}.png`);
    }
    writeOut('p1.json', results);
    console.log('P1 done', results.length, 'samples');
  } catch (e) {
    writeOut('p1.error.txt', String(e && e.stack || e));
    console.log('P1 ERROR', e && e.message);
  } finally {
    await app.close().catch(() => {});
  }
})();
