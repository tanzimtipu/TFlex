// DIAGNOSTIC 7 (qa, 2026-09-13): discriminate node-pinned vs context-pinned.
// Swaps the live svg for a FRESH CLONE of itself inside the SAME button,
// then swaps back. Also tests attr width 45 on the live svg (45/1.5 = 30).
const { test } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');

let electronApp = null;

test('diag: node vs context pinning', async () => {
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
    const live = btn.querySelector('svg');
    out.live = { computedW: getComputedStyle(live).width };

    const fresh = live.cloneNode(true);
    btn.replaceChild(fresh, live);
    out.freshCloneSameButton = { computedW: getComputedStyle(fresh).width, rectW: fresh.getBoundingClientRect().width };

    // attr experiment on the fresh clone
    fresh.setAttribute('width', '45');
    out.freshAttr45 = { computedW: getComputedStyle(fresh).width, rectW: fresh.getBoundingClientRect().width };

    // and the original live svg, re-inserted elsewhere
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;';
    probe.appendChild(live);
    document.body.appendChild(probe);
    out.liveInPlainDiv = { computedW: getComputedStyle(live).width, rectW: live.getBoundingClientRect().width };
    probe.remove();
    return out;
  });
  console.log('[diag7] node vs context:', JSON.stringify(facts, null, 1));
  await hardClose(electronApp, 'diag-icon-width7');
  electronApp = null;
});