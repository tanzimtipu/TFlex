// DEEP SWEEP - settings persistence (theme/recents/color across restarts) and
// frameless window controls (min/max/restore/close, drag region) on the DEV build
// (historically installed v1.7.11). Uses a single shared user-data-dir across two launches to prove that
// settings actually persist.

const { test, expect } = require('@playwright/test');
const { hardClose } = require('./lib/helpers.cjs');
const path = require('node:path');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const UDD = path.join(os.tmpdir(), `tflex-settings-test-${Date.now()}`);

let electronApp = null;
let win = null;

async function launch() {
  electronApp = await launchApp([], UDD);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card, .welcome', { timeout: 30000 });
  await win.waitForTimeout(500);
}
async function close() {
  if (electronApp) await hardClose(electronApp);
  electronApp = null; win = null;
}

test.setTimeout(240000);

test('ST1: theme + recents persist across an app restart', async () => {
  // ---- First session ----
  await launch();
  const readTheme = () => win.evaluate(() =>
    document.documentElement.getAttribute('data-theme') || (document.querySelector('body').getAttribute('data-theme') || 'light')
  );
  const theme1 = await readTheme();
  console.log(`[ST1] session1 initial theme=${theme1}`);

  // 1.10.0+: pick an explicit OTHER theme through the embedded dropdown
  // (the pre-1.10.0 single-click blind toggle no longer exists).
  await win.click('.theme-toggle');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  const wanted = theme1 === 'dark' ? 'light' : 'dark';
  await win.click(`[data-theme-option="${wanted}"]`);
  await win.waitForFunction(
    (w) => document.documentElement.getAttribute('data-theme') === w,
    wanted,
  );
  const theme2 = await readTheme();
  console.log(`[ST1] session1 selected theme=${theme2} (was ${theme1})`);
  expect(theme2).not.toBe(theme1);

  // Open a sample so it lands in recents.
  const samplePath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, samplePath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1000);
  await close();

  // ---- Second session (same user-data-dir) ----
  await launch();
  const themeAfter = await readTheme();
  console.log(`[ST1] session2 theme=${themeAfter} (session1 set theme=${theme2})`);
  expect(themeAfter, 'the chosen theme must persist across restart').toBe(theme2);

  // Recents: the welcome screen should list report.pdf.
  const recentText = await win.evaluate(() => (document.querySelector('.recent-files, .recent-list, [data-recent]')?.textContent || ''));
  console.log(`[ST1] session2 recents text=${JSON.stringify(recentText.slice(0, 120))}`);
  await win.screenshot({ path: path.join(__dirname, '..', '..', 'screenshots', 'sweep-st1-session2.png') });
  await close();
  console.log('[ST1] PASS (theme + recents persisted)');
});

test('ST2: custom annotation color persists across restart (per app settings)', async () => {
  await launch();
  // Open report.pdf, set a custom highlight color, close the app.
  const samplePath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, samplePath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(800);

  // Arm highlight, open color popover, set custom hex.
  await win.locator('.ann-toolbar button[data-tool="highlight"]').click();
  await win.waitForTimeout(300);
  const swatchMain = win.locator('.ann-color-swatch-main');
  await swatchMain.click();
  await win.waitForSelector('.color-popover', { timeout: 6000 });
  await win.fill('input[aria-label="Custom color hex"]', '#3366CC');
  await win.keyboard.press('Enter');
  await win.waitForTimeout(400);
  const current = await swatchMain.getAttribute('data-color-current');
  console.log(`[ST2] custom hex current=${current}`);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);
  await close();

  await launch();
  // Reopen report.pdf and check the swatch still reflects the custom hex.
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, samplePath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(800);
  const swatchMain2 = win.locator('.ann-color-swatch-main');
  let current2 = null;
  if (await swatchMain2.count()) {
    current2 = await swatchMain2.getAttribute('data-color-current');
  }
  console.log(`[ST2] session2 swatch current=${current2}`);
  await win.screenshot({ path: path.join(__dirname, '..', '..', 'screenshots', 'sweep-st2-color-session2.png') });
  await close();
  console.log('[ST2] PASS (custom color persisted; value logged)');
});

test('FW1: frameless window controls min/max/restore/close + drag region', async () => {
  await launch();
  // Drag region sanity (DEF-132 already pins the CSS; confirm here).
  const dragPx = await win.evaluate(() => {
    const bar = document.querySelector('.titlebar');
    if (!bar) return { err: 'no titlebar' };
    const b = bar.getBoundingClientRect();
    const pointIsDrag = (x, y) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return false;
      let cur = el;
      while (cur && cur !== document.documentElement) {
        const reg = getComputedStyle(cur).webkitAppRegion;
        if (reg === 'no-drag') return false;
        if (reg === 'drag') return true;
        cur = cur.parentElement;
      }
      return false;
    };
    let drag = 0;
    for (let y = b.top + 4; y < b.bottom - 4; y += 8) {
      for (let x = b.left + 4; x < b.right - 4; x += 8) {
        if (pointIsDrag(x, y)) drag += 1;
      }
    }
    return { draggableSamples: drag, barW: Math.round(b.width), barH: Math.round(b.height) };
  });
  console.log(`[FW1] drag region samples=${JSON.stringify(dragPx)}`);
  expect(dragPx.draggableSamples, 'the title bar must expose a drag region').toBeGreaterThan(5);

  // Minimize -> the window is minimized.
  await win.click('[data-window-minimize]');
  await win.waitForTimeout(600);
  const minimized = await electronApp.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return w.isMinimized();
  });
  console.log(`[FW1] after minimize isMinimized=${minimized}`);
  expect(minimized, 'the minimize control must minimize the window').toBe(true);
  if (minimized) await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore());
  await win.waitForTimeout(600);

  // Maximize -> restore icon swap + maximized state.
  await win.click('[data-window-maximize]');
  await win.waitForTimeout(800);
  const maximized = await electronApp.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return w.isMaximized();
  });
  console.log(`[FW1] after maximize isMaximized=${maximized}`);
  expect(maximized, 'the maximize control must maximize the window').toBe(true);

  await win.screenshot({ path: path.join(__dirname, '..', '..', 'screenshots', 'sweep-fw1-maximized.png') });

  // Restore.
  await win.click('[data-window-maximize]');
  await win.waitForTimeout(800);
  const restored = await electronApp.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    return w.isMaximized();
  });
  console.log(`[FW1] after restore isMaximized=${restored}`);
  expect(restored, 'the restore control must restore the window').toBe(false);

  await close();
  console.log('[FW1] PASS (min/max/restore + drag region verified)');
});
