// DIAGNOSTIC (qa, 2026-09-13): command-bar icon computed width anomaly.
// The 14.2 battery measured every `.toolbar .tool-btn > svg` at computed
// 14.6667x22 while the annotation bar's svgs measure 24x24 cleanly. This
// probe dumps the raw box/attrs for a few command-bar svgs so the
// 14.6667px width can be classified (real squish vs layout artifact).
// No assertions - diagnostics only.
const { test } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');

let electronApp = null;

test('diag: command bar svg box probe', async () => {
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

  const probe = await win.evaluate(() => {
    const svgs = Array.from(document.querySelectorAll('.toolbar .tool-btn > svg')).slice(0, 6);
    return svgs.map((s) => {
      const cs = getComputedStyle(s);
      const r = s.getBoundingClientRect();
      return {
        cls: s.getAttribute('class'),
        attrW: s.getAttribute('width'),
        attrH: s.getAttribute('height'),
        viewBox: s.getAttribute('viewBox'),
        computedW: cs.width,
        computedH: cs.height,
        minWidth: cs.minWidth,
        maxWidth: cs.maxWidth,
        display: cs.display,
        aspectRatio: cs.aspectRatio,
        flex: cs.flex,
        rect: { w: Math.round(r.width * 100) / 100, h: Math.round(r.height * 100) / 100 },
        parentClass: s.parentElement?.getAttribute('class'),
        parentW: s.parentElement ? Math.round(s.parentElement.getBoundingClientRect().width * 100) / 100 : null,
        dpr: window.devicePixelRatio,
      };
    });
  });
  console.log('[diag] command-bar svg boxes:', JSON.stringify(probe, null, 1));

  const annProbe = await win.evaluate(() => {
    const s = document.querySelector('.ann-toolbar .ann-tool-btn > svg');
    if (!s) return null;
    const cs = getComputedStyle(s);
    return {
      computedW: cs.width, computedH: cs.height,
      attrW: s.getAttribute('width'),
      rectW: s.getBoundingClientRect().width,
      parentClass: s.parentElement?.getAttribute('class'),
    };
  });
  console.log('[diag] ann svg box:', JSON.stringify(annProbe));
  await hardClose(electronApp, 'diag-icon-width');
  electronApp = null;
});