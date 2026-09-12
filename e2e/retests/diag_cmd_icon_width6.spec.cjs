// DIAGNOSTIC 6 (qa, 2026-09-13): isolate the 14.6667px trigger.
// A. Move the live .tool-btn (with its squished svg) to document.body and
//    re-measure. B. Move the healthy ann svg into the live .tool-btn and
//    re-measure. C. Try attr width 33/24 on the live svg.
const { test } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');

let electronApp = null;

test('diag: svg width isolation', async () => {
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
    const out = {};
    const btn = document.querySelector('.toolbar .tool-btn');
    const liveSvg = btn.querySelector('svg');
    out.A_before = { svgW: getComputedStyle(liveSvg).width, btnW: getComputedStyle(btn).width, btnRect: btn.getBoundingClientRect().width };

    // A. move the whole live button to body
    const marker = document.createElement('div');
    btn.parentElement.insertBefore(marker, btn);
    document.body.appendChild(btn);
    out.A_btnAtBody = { svgW: getComputedStyle(liveSvg).width, btnRect: btn.getBoundingClientRect().width };
    marker.parentElement.insertBefore(btn, marker);
    marker.remove();
    out.A_afterReturn = { svgW: getComputedStyle(liveSvg).width };

    // B. put the ann svg into the live tool-btn
    const annSvg = document.querySelector('.ann-toolbar .ann-tool-btn > svg');
    const annSvgW = getComputedStyle(annSvg).width;
    const placeholder = document.createComment('ph');
    const annParent = annSvg.parentElement;
    annParent.insertBefore(placeholder, annSvg);
    btn.appendChild(annSvg);
    out.B_annSvgInToolBtn = { computedW: getComputedStyle(annSvg).width, rectW: annSvg.getBoundingClientRect().width };
    annParent.insertBefore(annSvg, placeholder);
    placeholder.remove();
    out.B_annSvgHome = { computedW: getComputedStyle(annSvg).width };

    // C. attr experiments on the live svg
    const prev = liveSvg.getAttribute('width');
    liveSvg.setAttribute('width', '33');
    out.C_attr33 = { computedW: getComputedStyle(liveSvg).width, rectW: liveSvg.getBoundingClientRect().width };
    liveSvg.setAttribute('width', '22');
    out.C_attr22 = { computedW: getComputedStyle(liveSvg).width };
    return out;
  });
  console.log('[diag6] svg width isolation:', JSON.stringify(facts, null, 1));
  await hardClose(electronApp, 'diag-icon-width6');
  electronApp = null;
});