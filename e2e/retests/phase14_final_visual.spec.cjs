// Phase 14 FINAL visual pass (qa): aurora backdrop behind the window, OS
// composited grab so the desktop wallpaper shows through the frosted glass.
// Judgment of the grab belongs to qa (read_image), the spec only stages the
// scene and captures it. Backdrop: e2e/lib/aurora_backdrop.ps1 (spawned here,
// killed in afterEach - same helper the DEF-182..188 retests used).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { launchApp } = require('./../lib/launch.cjs');
const { getSamplePath, hardClose, ensurePanelExpanded } = require('./../lib/helpers.cjs');

let electronApp = null;
let win = null;
let backdrop = null;

const ROOT = path.resolve(__dirname, '..', '..');
const AURORA = path.join(ROOT, 'e2e', 'lib', 'aurora_backdrop.ps1');

test.beforeEach(async () => {
  // TFLEX_SKIP_BACKDROP=1: the operator keeps an aurora instance running
  // (started from a pwsh session) and owns its lifecycle.
  if (process.env.TFLEX_SKIP_BACKDROP !== '1') {
    backdrop = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', AURORA], {
      stdio: 'ignore',
      detached: true,
    });
    await new Promise((r) => setTimeout(r, 2500)); // let the backdrop paint
  }
  electronApp = await launchApp();
  win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  // Position the window at a rect that fits the DIP work area (1707x960 at
  // scale 1.5) so no clamping distorts the floating-card insets. The aurora
  // form is TopMost (it must cover the qa session browser), so the app
  // window rides above it with a higher always-on-top level for the grab.
  await electronApp.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      w.setPosition(40, 60);
      w.setSize(1440, 860);
      w.setAlwaysOnTop(true, 'screen-saver');
    }
  });
  await win.waitForTimeout(400);
});

test.afterEach(async () => {
  await hardClose(electronApp, 'p14finalvisual');
  electronApp = null;
  win = null;
  if (backdrop) {
    try { process.kill(-backdrop.pid); } catch (_) { try { backdrop.kill(); } catch (_) { /* gone */ } }
    backdrop = null;
  }
});

test('Phase 14 FINAL visual: aurora through the glass panels (OS grab)', async () => {
  test.setTimeout(180000);
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await win.locator('[data-home-tool="open"]').first().click();
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await win.waitForTimeout(1800);

  // Phase 36: the retired Tools palette is gone. The floating glass panels
  // (ContextPanel + Inspector) are already on screen with a document open,
  // so the aurora-through-glass grab needs no palette drive.
  await ensurePanelExpanded(win);
  await win.waitForTimeout(900);

  await win.screenshot({ path: path.join(ROOT, 'screenshots', 'def14-final-aurora-window.png') });

  // OS composited grab via the app's own desktopCapturer (the proven
  // qa_reference_compare method - DIP-sized full-screen thumbnail, no DPI
  // math, wallpaper included).
  const grab = await electronApp.evaluate(async ({ desktopCapturer, screen }) => {
    const prim = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: prim.size.width, height: prim.size.height },
    });
    return { png: sources[0].thumbnail.toPNG().toString('base64') };
  });
  require('node:fs').writeFileSync(
    path.join(ROOT, 'screenshots', 'def14-final-aurora-os.png'),
    Buffer.from(grab.png, 'base64'),
  );
  expect(true).toBe(true);
});