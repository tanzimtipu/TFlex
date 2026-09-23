// Focused DEF-303 diagnostic (qa): is the renderer's rAF loop still throttled
// while the window is minimised, and is `backgroundThrottling: false` actually
// in effect? Read-only probe; launches through the canonical launchApp.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { openFile, tmpCopy, REPORT } = require('./lib/p33_common.cjs');

let app = null;
let win = null;
test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'def303-raf-diag');
  app = null; win = null;
});
test.setTimeout(120000);

test('DEF-303 rAF + visibility while minimised', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'def303-raf.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);

  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const p = w.webContents.getLastWebPreferences ? w.webContents.getLastWebPreferences() : null;
    return {
      lastPrefs: p ? p.backgroundThrottling : 'n/a',
      wcProp: w.webContents.backgroundThrottling,
    };
  });
  console.log(`[RAFDIAG] webPreferences: ${JSON.stringify(prefs)}`);

  // The DEF-303 pause signal (main -> renderer) must arrive on minimise/restore.
  await win.evaluate(() => {
    window.__min = [];
    try {
      window.tflex.onMinimizedChanged((s) => window.__min.push({ t: Date.now(), minimized: s.minimized }));
    } catch (e) { window.__min.push({ error: String(e && e.message) }); }
  });

  // Install a persistent rAF counter + visibility tracker.
  await win.evaluate(() => {
    window.__raf = { n: 0, vis: [], last: performance.now(), dts: [] };
    const tick = () => {
      const t = performance.now();
      window.__raf.n += 1;
      window.__raf.dts.push(Math.round(t - window.__raf.last));
      window.__raf.last = t;
      window.__raf.raf = requestAnimationFrame(tick);
    };
    window.__raf.raf = requestAnimationFrame(tick);
    document.addEventListener('visibilitychange', () => {
      window.__raf.vis.push({ t: Date.now(), state: document.visibilityState });
    });
  });
  await win.waitForTimeout(600);
  const before = await win.evaluate(() => ({ n: window.__raf.n, vis: document.visibilityState }));
  console.log(`[RAFDIAG] before minimise: ${JSON.stringify(before)}`);

  await win.locator('[data-window-minimize]').first().click();
  await win.waitForTimeout(600);
  // Steady-state window: count rAF and setInterval ticks over 3 s while minimised.
  const steady = await win.evaluate(() => new Promise((resolve) => {
    let raf = 0; let timer = 0;
    const t0 = Date.now();
    const tick = () => { raf += 1; if (Date.now() - t0 < 3000) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const iv = setInterval(() => { timer += 1; }, 16);
    setTimeout(() => { clearInterval(iv); resolve({ raf, timer, ms: Date.now() - t0 }); }, 3000);
  }));
  console.log(`[RAFDIAG] steady-state while minimised (3s): ${JSON.stringify(steady)}`);
  await win.waitForTimeout(2500);
  const during = await win.evaluate(() => ({
    n: window.__raf.n, vis: document.visibilityState, visEvents: window.__raf.vis,
    lastDts: window.__raf.dts.slice(-10), minEvents: window.__min,
  }));
  console.log(`[RAFDIAG] while minimised (2.5s): ${JSON.stringify(during)}`);

  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].restore(); });
  await win.waitForTimeout(1200);
  const after = await win.evaluate(() => ({
    n: window.__raf.n, vis: document.visibilityState, visEvents: window.__raf.vis,
    lastDts: window.__raf.dts.slice(-10), minEvents: window.__min,
  }));
  console.log(`[RAFDIAG] after restore: ${JSON.stringify(after)}`);

  expect(during.n).toBeGreaterThan(before.n);
});
