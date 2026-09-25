// Phase 39 item 4 (D3) - INDEPENDENT lane/arrow parity re-measure. Opens one
// document, sweeps a few widths in SINGLE mode, then toggles Multi Mode and
// sweeps the same widths, comparing the dock's lane/arrows/lift/band signals.
// Canonical launchApp only.
const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, toggleMultiModeViaPalette } = require('./lib/helpers.cjs');

let app = null;
let win = null;
test.setTimeout(300000);

const WIDTHS = [1442, 1199, 719, 700];

async function setWindow(width, height) {
  await app.evaluate(({ BrowserWindow }, sz) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) bw.setSize(sz[0], sz[1]);
  }, [width, height]);
  await win.waitForFunction((want) => Math.abs(window.innerWidth - want) <= 24, width, { timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(400);
}

const READ = `(() => {
  const dock = document.querySelector('.action-dock');
  return { innerWidth: window.innerWidth, dock: !!dock,
    arrowsLane: dock ? dock.getAttribute('data-dock-arrows-lane') : null,
    arrows: dock ? dock.getAttribute('data-dock-arrows') : null,
    lift: dock ? dock.getAttribute('data-dock-lift') : null,
    band: dock ? dock.getAttribute('data-dock-band') : null,
    iconOnly: dock ? dock.getAttribute('data-dock-icon-only') : null };
})()`;

async function sweep(label) {
  const out = [];
  for (const w of WIDTHS) {
    await setWindow(w, 720);
    out.push(await win.evaluate(READ));
  }
  console.log(`[P39-LANE ${label}] ${JSON.stringify(out)}`);
  return out;
}

test('lane/arrow parity single vs multi at independent widths', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, getSamplePath('report.pdf'));
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(900);

  const single = await sweep('single');
  await setWindow(1442, 903);
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1000);
  const multi = await sweep('multi');

  for (let i = 0; i < WIDTHS.length; i += 1) {
    const s = single[i]; const m = multi[i];
    console.log(`[P39-LANE diff w=${WIDTHS[i]}] single=${JSON.stringify(s)} multi=${JSON.stringify(m)}`);
    expect(m.arrowsLane, `lane parity @${WIDTHS[i]}`).toBe(s.arrowsLane);
    expect(m.arrows, `arrows parity @${WIDTHS[i]}`).toBe(s.arrows);
    expect(m.lift, `lift parity @${WIDTHS[i]}`).toBe(s.lift);
  }
  await hardClose(app, 'lane-parity');
  app = null; win = null;
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'lane');
  app = null;
  win = null;
});
