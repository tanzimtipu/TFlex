// DIAGNOSTIC 4 (qa, 2026-09-13): walk the live command-bar svg's ancestor
// chain and dump zoom / scale / transform / container-type / contain /
// width for every level, plus the svg's own zoom property.
const { test } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');

let electronApp = null;

test('diag: ancestor chain zoom/scale probe', async () => {
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

  const facts = await win.evaluate(() => {
    const svg = document.querySelector('.toolbar .tool-btn > svg');
    const out = [];
    let el = svg;
    while (el) {
      const cs = getComputedStyle(el);
      out.push({
        tag: el.tagName,
        cls: (el.getAttribute && el.getAttribute('class')) || '',
        width: cs.width,
        zoom: cs.zoom || '',
        scale: cs.scale || '',
        transform: cs.transform === 'none' ? '' : cs.transform,
        containerType: cs.containerType || '',
        contain: cs.contain || '',
        fontSize: cs.fontSize,
      });
      el = el.parentElement;
    }
    return out;
  });
  console.log('[diag4] ancestor chain:', JSON.stringify(facts, null, 1));
  await hardClose(electronApp, 'diag-icon-width4');
  electronApp = null;
});