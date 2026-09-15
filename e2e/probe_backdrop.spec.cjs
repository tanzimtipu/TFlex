// One-off probe: what does the live Chromium report for the badge's glass
// (backdrop-filter) properties, and which CSS rules matched.
// Run: npm run test:e2e -- probe_backdrop   (delete when done)
const { test } = require('@playwright/test');
const { launchDev, openSample, hardClose, dismissUpdatePrompt } = require('./lib/helpers.cjs');

test.describe('backdrop-filter probe', () => {
  let electronApp;
  let window;
  test.beforeEach(async () => {
    ({ electronApp, window } = await launchDev());
    await dismissUpdatePrompt(window);
    await openSample(window, electronApp, 'report.pdf');
    await window.waitForSelector('[data-tools-badge]', { timeout: 15000 });
  });
  test.afterEach(async () => {
    if (electronApp) await hardClose(electronApp);
  });

  test('dump computed + declared glass values', async () => {
    test.setTimeout(120000);
    const out = await window.evaluate(() => {
      const el = document.querySelector('.tools-badge-content');
      if (!el) return { missing: true };
      const cs = getComputedStyle(el);
      const allRules = [];
      for (const sheet of document.styleSheets) {
        let rules = [];
        try {
          rules = [...sheet.cssRules];
        } catch (e) {
          continue;
        }
        for (const r of rules) {
          if (typeof r.selectorText === 'string' && r.selectorText.includes('tools-badge-content')) {
            allRules.push(r.cssText.slice(0, 500));
          }
        }
      }
      return {
        backdropFilter: cs.backdropFilter,
        webkit: cs.getPropertyValue('-webkit-backdrop-filter'),
        unprefixed: cs.getPropertyValue('backdrop-filter'),
        cssSupports: CSS.supports('backdrop-filter', 'blur(16px)'),
        webkitSupports: CSS.supports('-webkit-backdrop-filter', 'blur(16px)'),
        declaredInSheets: allRules,
      };
    });
    console.log('PROBE:', JSON.stringify(out, null, 2));
  });
  test.afterAll(async () => {
    if (electronApp) await hardClose(electronApp);
  });
});