// Phase 109 adversary probe 4 (TFL-918) - nail the <=419px overflow config and
// the post-theme-toggle footer hit anomaly.
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const OUT = [];
function log(...a) { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); OUT.push(s); console.log(s); }

async function setWindow(app, win, w, h) {
  await app.evaluate(({ BrowserWindow }, sz) => { const bw = BrowserWindow.getAllWindows()[0]; if (bw) { try { bw.unmaximize(); } catch (_) {} bw.setSize(sz[0], sz[1]); } }, [w, h]);
  await win.waitForTimeout(700);
}
async function zoom(app, win, z) {
  await app.evaluate(({ BrowserWindow }, zf) => { const bw = BrowserWindow.getAllWindows()[0]; if (bw) bw.webContents.setZoomFactor(zf); }, z);
  await win.waitForTimeout(900);
}
async function openSample(win, name = 'report.pdf') {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
}
async function audit(win) {
  return win.evaluate(() => {
    const strip = document.querySelector('[data-view-strip]');
    const cs = (sel) => { const el = document.querySelector(sel); return el === null ? 'missing' : getComputedStyle(el).display; };
    const visibleCount = (sel) => [...document.querySelectorAll(sel)].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none'; }).length;
    const r = strip ? strip.getBoundingClientRect() : null;
    let top = null;
    if (r) { const t = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)); top = t ? { tag: t.tagName.toLowerCase(), cls: String(t.className), inStrip: !!t.closest('[data-view-strip]'), outer: t.outerHTML.slice(0, 120) } : null; }
    return {
      innerW: window.innerWidth,
      stripWidth: r ? Math.round(r.width) : null,
      stripTop: r ? Math.round(r.top) : null,
      moreDisplay: cs('.view-strip-more'),
      layoutDisplay: cs('.view-strip-layout'),
      bookDisplay: cs('.view-strip-book'),
      visibleLayoutOptions: visibleCount('[data-page-layout-option]'),
      visibleBookEntries: visibleCount('[data-book-view-open]'),
      visibleMoreToggles: visibleCount('[data-view-strip-more-toggle]'),
      topAtFooterCenter: top,
    };
  });
}

async function main() {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(250);
  await openSample(win);

  log('== A. <=419px overflow config: 640x480 physical + text scaling 150% ==');
  await setWindow(app, win, 640, 480);
  await zoom(app, win, 1.5);
  log('  audit:', JSON.stringify(await audit(win)));
  // Enumerate the named viewing controls and reachability.
  const ctrl = await win.evaluate(() => {
    const names = ['Prev/Next page group', 'Zoom out', 'Zoom in', 'Fit width', 'Fit page', 'Pan mode', 'One page', 'Two pages side by side', 'Four pages in two rows', 'Book View', 'More viewing controls'];
    const sel = {
      'Prev/Next page group': '.view-strip-page', 'Zoom out': '[aria-label="Zoom out"]', 'Zoom in': '[aria-label="Zoom in"]', 'Fit width': '[aria-label="Fit width"]', 'Fit page': '[aria-label="Fit page"]', 'Pan mode': '[aria-label="Pan mode"]', 'One page': '[data-page-layout-option="one"]', 'Two pages side by side': '[data-page-layout-option="two"]', 'Four pages in two rows': '[data-page-layout-option="four"]', 'Book View': '.view-strip-book', 'More viewing controls': '[data-view-strip-more-toggle]',
    };
    return names.map((n) => {
      const el = document.querySelector(sel[n]);
      if (!el) return { name: n, present: false };
      const r = el.getBoundingClientRect();
      const d = getComputedStyle(el).display;
      const visible = r.width > 0 && r.height > 0 && d !== 'none';
      let hit = false;
      if (visible) { const t = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)); hit = t === el || el.contains(t); }
      return { name: n, present: true, display: d, w: Math.round(r.width), visible, hit };
    });
  });
  for (const c of ctrl) log('    ', JSON.stringify(c));
  await win.screenshot({ path: path.join(SHOTS, 'phase109-adv-overflow-config.png') });

  // Reset.
  await zoom(app, win, 1);
  await setWindow(app, win, 1440, 900);

  log('== B. post-theme-toggle / post-book-close footer hit anomaly ==');
  for (let round = 1; round <= 2; round += 1) {
    // Reopen a fresh state: reload not available; just exercise the sequence.
    if (round === 1) {
      await win.locator('[data-view-strip] [data-book-view-open]').first().click();
      await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 10000 });
      await win.waitForTimeout(700);
      await win.locator('[data-book-view] [aria-label="Close book view"]').first().click();
      await win.waitForTimeout(1000);
    }
    await win.locator('[data-app-menu]').first().click();
    await win.waitForSelector('[data-app-menu-popover]', { state: 'visible', timeout: 8000 });
    await win.locator('[data-app-menu-popover] [data-menu-action="toggleTheme"]').first().click();
    await win.waitForTimeout(1200);
    const a = await audit(win);
    log(`  round ${round} audit:`, JSON.stringify(a));
    if (a.topAtFooterCenter && !a.topAtFooterCenter.inStrip) {
      const detail = await win.evaluate(() => {
        const strip = document.querySelector('[data-view-strip]');
        const r = strip.getBoundingClientRect();
        const t = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
        const chain = [];
        let el = t;
        while (el && chain.length < 8) { const b = el.getBoundingClientRect(); chain.push({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60), z: getComputedStyle(el).zIndex, pos: getComputedStyle(el).position, rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] }); el = el.parentElement; }
        const strips = [...document.querySelectorAll('[data-view-strip]')].map((s) => { const b = s.getBoundingClientRect(); return { rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], opacity: getComputedStyle(s).opacity, z: getComputedStyle(s).zIndex, vis: getComputedStyle(s).visibility, pe: getComputedStyle(s).pointerEvents }; });
        const scroller = document.querySelector('.document-scroller');
        return { theme: document.documentElement.getAttribute('data-theme'), topChain: chain, strips, scrollerOverflow: scroller ? getComputedStyle(scroller).overflow : null };
      });
      log(`  round ${round} detail:`, JSON.stringify(detail, null, 0));
    }
    await win.screenshot({ path: path.join(SHOTS, `phase109-adv-post-theme-${round}.png`) });
  }

  fs.writeFileSync(path.join(__dirname, 'probe4.output.json'), JSON.stringify(OUT, null, 2));
  await app.close();
}
main().then(() => { console.log('PROBE4-DONE'); process.exit(0); }).catch((e) => {
  console.error('PROBE4-ERROR', e && e.stack ? e.stack : e);
  try { fs.writeFileSync(path.join(__dirname, 'probe4.output.json'), JSON.stringify(OUT, null, 2)); } catch (_) {}
  process.exit(1);
});
