// DIAGNOSTIC 3 (qa, 2026-09-13): pin down the 14.6667px svg layout width.
// Clones a command-bar svg into controlled contexts (plain block, inline-flex,
// forced style width) and re-measures the live one after style overrides.
// No assertions - diagnostics only.
const { test } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');

let electronApp = null;

test('diag: svg width mechanism probe', async () => {
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
    const out = { dpr: window.devicePixelRatio };
    // 1. clone into a plain 100px block div
    const host1 = document.createElement('div');
    host1.style.cssText = 'position:fixed;top:0;left:0;width:100px;height:40px;visibility:hidden;';
    const c1 = svg.cloneNode(true);
    host1.appendChild(c1);
    document.body.appendChild(host1);
    out.plainBlockClone = { w: getComputedStyle(c1).width, rect: c1.getBoundingClientRect().width };
    // 2. clone into an inline-flex 28px parent (same as .tool-btn box)
    const host2 = document.createElement('div');
    host2.style.cssText = 'position:fixed;top:40px;left:0;width:28px;height:40px;display:inline-flex;justify-content:center;align-items:center;visibility:hidden;';
    const c2 = svg.cloneNode(true);
    host2.appendChild(c2);
    document.body.appendChild(host2);
    out.inlineFlex28 = { w: getComputedStyle(c1 && c2).width, rectW: c2.getBoundingClientRect().width };
    host2.remove();
    // 3. force style width 22px on the live svg
    svg.style.width = '22px';
    out.liveForced22 = { computedW: getComputedStyle(svg).width, rectW: svg.getBoundingClientRect().width };
    svg.style.width = '';
    out.liveBackToAuto = { computedW: getComputedStyle(svg).width, rectW: svg.getBoundingClientRect().width };
    // 4. svg attributes + inline style dump
    out.attrDump = {
      widthAttr: svg.getAttribute('width'),
      heightAttr: svg.getAttribute('height'),
      styleAttr: svg.getAttribute('style'),
      outerStart: svg.outerHTML.slice(0, 220),
    };
    host1.remove(); host2.remove();
    return out;
  });
  console.log('[diag3] svg width mechanism:', JSON.stringify(facts, null, 1));
  await hardClose(electronApp, 'diag-icon-width3');
  electronApp = null;
});