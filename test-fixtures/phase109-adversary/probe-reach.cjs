// Phase 109 adversary probe 3 (TFL-918) - confirm overflow-tier reachability
// (layout/Book View become unreachable), the page-input commit, and the
// Book-View-close hit-test transient.
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
async function openSample(win, name = 'report.pdf') {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
}
async function footerTier(win) {
  return win.evaluate(() => {
    const strip = document.querySelector('[data-view-strip]');
    const cs = (sel) => { const el = document.querySelector(sel); return el === null ? 'missing' : getComputedStyle(el).display; };
    const visCount = (sel) => [...document.querySelectorAll(sel)].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden'; }).length;
    const main = document.querySelector('.app-main');
    const stage = document.querySelector('.tab-stage');
    return {
      stripWidth: strip ? Math.round(strip.getBoundingClientRect().width) : null,
      stageMultiMode: stage ? stage.getAttribute('data-multi-mode') : null,
      containerType: strip ? getComputedStyle(strip).containerType : null,
      containerName: strip ? getComputedStyle(strip).containerName : null,
      moreDisplay: cs('.view-strip-more'),
      layoutDisplay: cs('.view-strip-layout'),
      bookDisplay: cs('.view-strip-book'),
      visibleLayoutOptions: visCount('[data-page-layout-option]'),
      visibleBookEntries: visCount('[data-book-view-open]'),
      visibleMoreToggles: visCount('[data-view-strip-more-toggle]'),
      moreOpenRendered: document.querySelector('[data-view-strip-more-menu]') !== null,
      railCollapsed: main ? main.getAttribute('data-rail-collapsed') : null,
      toolsInset: main ? getComputedStyle(main).getPropertyValue('--tf-tools-inset').trim() : null,
      innerW: window.innerWidth,
    };
  });
}
async function visibleControlAudit(win) {
  // For each named viewing control, is it visible AND hit-testable anywhere?
  return win.evaluate(() => {
    const names = ['Previous page', 'Next page', 'Zoom out', 'Zoom in', 'Fit width', 'Fit page', 'Pan mode', 'Book View', 'One page', 'Two pages side by side', 'Four pages in two rows'];
    return names.map((n) => {
      const els = [...document.querySelectorAll('button, input')].filter((el) => el.getAttribute('aria-label') === n);
      const states = els.map((el) => {
        const r = el.getBoundingClientRect();
        const disp = getComputedStyle(el).display;
        const visible = r.width > 0 && r.height > 0 && disp !== 'none';
        let hit = false;
        if (visible) {
          const x = Math.round(r.left + r.width / 2); const y = Math.round(r.top + r.height / 2);
          const top = document.elementFromPoint(x, y);
          hit = top === el || el.contains(top);
        }
        return { display: disp, w: Math.round(r.width), h: Math.round(r.height), visible, hit };
      });
      return { name: n, count: els.length, states };
    });
  });
}

async function main() {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(250);
  await openSample(win);
  await setWindow(app, win, 1440, 900);

  log('== A. 1440x900 baseline tier ==');
  log('  ', JSON.stringify(await footerTier(win)));

  log('== B. page-input commit on blur (page 1 -> type 5 -> clic k away) ==');
  const input = win.locator('.view-strip-page .page-input').first();
  const startPage = await win.evaluate(() => window.tflexDiagnostics().currentPage);
  await input.click();
  await input.fill('5');
  const typed = await input.inputValue();
  // Blur by clicking a neutral part of the footer (the spacer region).
  await win.locator('.view-strip').first().click({ position: { x: 5, y: 24 } }).catch(() => {});
  await win.waitForTimeout(1500);
  const afterBlurPage = await win.evaluate(() => window.tflexDiagnostics().currentPage);
  const afterVal = await input.inputValue();
  log(`  startPage=${startPage} typed=${typed} afterBlur currentPage=${afterBlurPage} input=${afterVal}`);

  log('== C. Windows text scaling 150% ==');
  await app.evaluate(({ BrowserWindow }) => { const bw = BrowserWindow.getAllWindows()[0]; if (bw) bw.webContents.setZoomFactor(1.5); });
  await win.waitForTimeout(900);
  const tier150 = await footerTier(win);
  log('  tier:', JSON.stringify(tier150));
  const audit150 = await visibleControlAudit(win);
  for (const a of audit150) log(`    ctrl "${a.name}" count=${a.count} states=${JSON.stringify(a.states)}`);
  await win.screenshot({ path: path.join(SHOTS, 'phase109-adv-zoom150-controls.png') });
  // Can we reach the layout/Book controls at all? Try keyboard/force click.
  const reach = await win.evaluate(() => {
    const layout = document.querySelector('.view-strip-layout [data-page-layout-option="two"]');
    const book = document.querySelector('[data-view-strip-book], .view-strip-book, [data-book-view-open]');
    return {
      layoutExists: layout !== null,
      layoutDisplay: layout ? getComputedStyle(layout).display : null,
      layoutParentDisplay: layout && layout.parentElement ? getComputedStyle(layout.parentElement).display : null,
      bookExists: book !== null,
      bookDisplay: book ? getComputedStyle(book).display : null,
      moreHostDisplay: document.querySelector('.view-strip-more') ? getComputedStyle(document.querySelector('.view-strip-more')).display : null,
    };
  });
  log('  reachability at 150%:', JSON.stringify(reach));

  log('== D. 640x480 physical (100%) tier ==');
  await app.evaluate(({ BrowserWindow }) => { const bw = BrowserWindow.getAllWindows()[0]; if (bw) bw.webContents.setZoomFactor(1); });
  await setWindow(app, win, 640, 480);
  log('  tier:', JSON.stringify(await footerTier(win)));

  log('== E. Book View close + theme toggle then footer hit (transient repro attempt) ==');
  await setWindow(app, win, 1440, 900);
  await win.locator('[data-view-strip] [data-book-view-open]').first().click();
  await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 10000 });
  await win.waitForTimeout(700);
  await win.locator('[data-book-view] [aria-label="Close book view"]').first().click();
  await win.waitForTimeout(900);
  await win.locator('[data-app-menu]').first().click();
  await win.waitForSelector('[data-app-menu-popover]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-app-menu-popover] [data-menu-action="toggleTheme"]').first().click();
  await win.waitForTimeout(700);
  await win.locator('.view-strip-view [aria-label="Pan mode"]').first().click();
  await win.waitForTimeout(400);
  const transHit = await win.evaluate(() => {
    const strip = document.querySelector('[data-view-strip]');
    const r = strip.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2); const y = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(x, y);
    return { pt: [x, y], stripTop: Math.round(r.top), top: top ? `${top.tagName.toLowerCase()}.${String(top.className)}` : null, inStrip: top ? !!top.closest('[data-view-strip]') : false };
  });
  log('  post-book-close+theme pan hit:', JSON.stringify(transHit));

  fs.writeFileSync(path.join(__dirname, 'probe-reach.output.json'), JSON.stringify(OUT, null, 2));
  await app.close();
}
main().then(() => { console.log('PROBE3-DONE'); process.exit(0); }).catch((e) => {
  console.error('PROBE3-ERROR', e && e.stack ? e.stack : e);
  try { fs.writeFileSync(path.join(__dirname, 'probe-reach.output.json'), JSON.stringify(OUT, null, 2)); } catch (_) {}
  process.exit(1);
});
