// One-shot diag: dump how the loaded CSSOM serializes the
// tf-theme-transitioning rules (selector + cssText) so the retest probe can
// match them reliably. qa diag, disposable.
const { test } = require('@playwright/test');
const { launchDev, openSample, hardClose } = require('../lib/helpers.cjs');

let electronApp = null;
let win = null;

test('diag: CSSOM serialization of the crossfade rules', async () => {
  test.setTimeout(120000);
  ({ electronApp, window: win } = await launchDev());
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openSample(win, electronApp, 'report.pdf');
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
  const dump = await win.evaluate(() => {
    const rules = [];
    const walk = (list) => {
      for (const r of list) {
        if (r.cssRules && r.cssRules.length) { walk(r.cssRules); continue; }
        if (r.selectorText && r.style) rules.push(r);
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules); } catch (e) { /* skip */ }
    }
    const hits = rules.filter((r) => r.selectorText.includes('tf-theme-transitioning'));
    return hits.map((r) => ({
      sel: r.selectorText,
      cssText: r.style.cssText,
      tp: r.style.transitionProperty || '(empty)',
      tpLen: (r.style.transitionProperty || '').length,
    }));
  });
  console.log('[diag] tf-theme-transitioning rules in CSSOM:', JSON.stringify(dump, null, 1));
  await hardClose(electronApp, 'diag-crossfade-cssom');
});