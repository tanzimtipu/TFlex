// EVIDENCE CAPTURE (qa, 2026-09-13): FIX 5 frame sequence for the visual
// record. The verify spec's numeric sampler already proved the page never
// moves (DEF-193); this spec just captures the panel-open frames so the
// ledger has the mid-flight visuals. No behavioral assertions.
const { test } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose, ensurePanelExpanded } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

let electronApp = null;

test('capture fix5 frame sequence', async () => {
  test.setTimeout(180000);
  electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Phase 36: the Tools palette is retired. FIX 5's subject — the panel and
  // the page moving together on the shared slide curve — now lives in the
  // ContextPanel: collapse/expand it and capture the same frame sequence.
  await ensurePanelExpanded(win);
  await win.waitForTimeout(300);
  const frameDelays = [0, 60, 120, 180, 240, 300, 420];
  await win.click('[data-rail-collapse]');
  for (let i = 0; i < frameDelays.length; i += 1) {
    const shotT0 = Date.now();
    await win.screenshot({ path: path.join(SHOTS, `fix5-anim-frame-${String(i).padStart(2, '0')}.png`) });
    const captureCost = Date.now() - shotT0;
    console.log(`[fix5-frames] frame ${i} target ${frameDelays[i]}ms (capture took ${captureCost}ms)`);
    if (i + 1 < frameDelays.length) {
      await win.waitForTimeout(Math.max(0, frameDelays[i + 1] - frameDelays[i] - captureCost));
    }
  }
  await hardClose(electronApp, 'fix5-frames');
  electronApp = null;
});