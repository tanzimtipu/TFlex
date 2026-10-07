// Phase 109 adversary probe 2 (TFL-918) - clean geometry, hit-test, overflow
// reachability and DPI/text scaling. No confounds: fresh app, straight
// measurements.
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('../../e2e/lib/launch.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const OUT = [];
function log(...a) { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); OUT.push(s); console.log(s); }

async function setWindow(app, win, w, h) {
  await app.evaluate(({ BrowserWindow }, sz) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) { try { bw.unmaximize(); } catch (_) {} bw.setSize(sz[0], sz[1]); }
  }, [w, h]);
  await win.waitForTimeout(700);
}

async function openSample(win, name = 'report.pdf') {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

async function geom(win) {
  return win.evaluate(() => {
    const q = (sel) => document.querySelector(sel);
    const rect = (sel) => { const el = q(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), right: Math.round(r.right) }; };
    const ws = q('.workspace');
    const main = q('.workspace-main');
    const insp = q('[data-inspector]');
    const railCollapse = q('[data-rail-collapse]');
    const appMain = q('.app-main');
    return {
      innerW: window.innerWidth, innerH: window.innerHeight, dpr: window.devicePixelRatio,
      zoomFactor: window.outerWidth / window.innerWidth,
      railTrack: ws ? getComputedStyle(ws).gridTemplateColumns : null,
      mainRect: rect('.workspace-main'),
      stripRect: rect('.view-strip'),
      scrollerRect: rect('.document-scroller'),
      dockRect: rect('[data-action-dock]'),
      inspectorRect: insp ? rect('[data-inspector]') : null,
      inspectorCollapsed: insp ? insp.getAttribute('data-inspector-collapsed') : null,
      appMainToolsOpen: appMain ? appMain.getAttribute('data-tools-open') : null,
      toolsInset: appMain ? getComputedStyle(appMain).getPropertyValue('--tf-tools-inset').trim() : null,
      railCollapsedAttr: appMain ? appMain.getAttribute('data-rail-collapsed') : null,
      railCollapsePresent: railCollapse !== null,
      scrollerOverflowY: q('.document-scroller') ? getComputedStyle(q('.document-scroller')).overflowY : null,
      scrollerOverflowX: q('.document-scroller') ? getComputedStyle(q('.document-scroller')).overflowX : null,
      moreDisplay: q('.view-strip-more') ? getComputedStyle(q('.view-strip-more')).display : 'missing',
      stripWidth: q('.view-strip') ? Math.round(q('.view-strip').getBoundingClientRect().width) : null,
    };
  });
}

async function hitProbe(win) {
  return win.evaluate(() => {
    const strip = document.querySelector('[data-view-strip]');
    if (!strip) return { strip: false };
    const r = strip.getBoundingClientRect();
    const pts = {
      stripCenter: [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)],
      pageGroupCenter: (() => { const g = document.querySelector('.view-strip-page'); const b = g.getBoundingClientRect(); return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)]; })(),
      viewGroupCenter: (() => { const g = document.querySelector('.view-strip-view'); const b = g.getBoundingClientRect(); return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)]; })(),
      bookCenter: (() => { const g = document.querySelector('.view-strip-book'); if (!g) return null; const b = g.getBoundingClientRect(); return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)]; })(),
    };
    const out = {};
    for (const [k, p] of Object.entries(pts)) {
      if (!p) { out[k] = null; continue; }
      const top = document.elementFromPoint(p[0], p[1]);
      out[k] = { pt: p, top: top ? `${top.tagName.toLowerCase()}.${String(top.className)}` : null, inStrip: top ? !!top.closest('[data-view-strip]') : false, inScroller: top ? !!top.closest('.document-scroller') : false };
    }
    // Any textLayer boxes dipping into the footer band?
    const layerMax = document.querySelector('.document-scroller') ? (() => {
      let maxBottom = -Infinity; let n = 0; let offenders = 0;
      document.querySelectorAll('.textLayer').forEach((el) => {
        const b = el.getBoundingClientRect();
        maxBottom = Math.max(maxBottom, b.bottom);
        n += 1;
        if (b.bottom > r.top) offenders += 1;
      });
      return { count: n, maxBottom: Math.round(maxBottom), footerTop: Math.round(r.top), offenders };
    })() : null;
    return { strip: true, stripTop: Math.round(r.top), stripBottom: Math.round(r.bottom), hits: out, textLayer: layerMax };
  });
}

async function main() {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(250);
  await openSample(win);

  log('== A. 1440x900 default geometry ==');
  await setWindow(app, win, 1440, 900);
  log('  geom:', JSON.stringify(await geom(win)));
  log('  hit :', JSON.stringify(await hitProbe(win)));

  log('== B. pan armed, 1440x900 ==');
  await win.locator('.view-strip-view [aria-label="Pan mode"]').first().click();
  await win.waitForTimeout(400);
  log('  hit :', JSON.stringify(await hitProbe(win)));
  await win.locator('.view-strip-view [aria-label="Pan mode"]').first().click();
  await win.waitForTimeout(300);

  log('== C. 640x480 ==');
  await setWindow(app, win, 640, 480);
  log('  geom:', JSON.stringify(await geom(win)));
  log('  hit :', JSON.stringify(await hitProbe(win)));
  await win.screenshot({ path: path.join(SHOTS, 'phase109-adv-640-default.png') });

  log('== C2. try to expand the pages panel at 640x480 ==');
  const canExpand = await win.evaluate(() => {
    const main = document.querySelector('.app-main');
    const collapsed = document.querySelector('[data-context-panel][data-context-panel-collapsed="true"]');
    const btn = document.querySelector('[data-rail-collapse]');
    return { railCollapsedAttr: main ? main.getAttribute('data-rail-collapsed') : null, panelCollapsedPresent: collapsed !== null, btnPresent: btn !== null };
  });
  log('  expand-state:', JSON.stringify(canExpand));
  if (canExpand.panelCollapsedPresent && canExpand.btnPresent) {
    await win.locator('[data-rail-collapse]').first().click();
    await win.waitForTimeout(700);
    log('  after expand geom:', JSON.stringify(await geom(win)));
    log('  after expand hit :', JSON.stringify(await hitProbe(win)));
  }

  log('== D. Windows text/DPI scaling 150% (webContents zoomFactor) ==');
  await app.evaluate(({ BrowserWindow }) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) bw.webContents.setZoomFactor(1.5);
  });
  await win.waitForTimeout(800);
  log('  zoomed geom:', JSON.stringify(await geom(win)));
  log('  zoomed hit :', JSON.stringify(await hitProbe(win)));
  await win.screenshot({ path: path.join(SHOTS, 'phase109-adv-zoom150.png') });
  // reset
  await app.evaluate(({ BrowserWindow }) => { const bw = BrowserWindow.getAllWindows()[0]; if (bw) bw.webContents.setZoomFactor(1); });
  await win.waitForTimeout(500);

  fs.writeFileSync(path.join(__dirname, 'probe-geom.output.json'), JSON.stringify(OUT, null, 2));
  await app.close();
}

main().then(() => { console.log('PROBE2-DONE'); process.exit(0); }).catch((e) => {
  console.error('PROBE2-ERROR', e && e.stack ? e.stack : e);
  try { fs.writeFileSync(path.join(__dirname, 'probe-geom.output.json'), JSON.stringify(OUT, null, 2)); } catch (_) {}
  process.exit(1);
});
