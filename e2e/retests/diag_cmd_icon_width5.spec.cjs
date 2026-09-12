// DIAGNOSTIC 5 (qa, 2026-09-13): recursive CSS rule walk for the live
// command-bar svg - includes rules nested inside @media/@supports blocks.
// Dumps every matched rule's selector + width/height/display/aspect.
const { test } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');

let electronApp = null;

test('diag: recursive matched-rule walk for tool svg', async () => {
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

  const matched = await win.evaluate(() => {
    const svg = document.querySelector('.toolbar .tool-btn > svg');
    const out = [];
    const walk = (rules, media) => {
      for (const rule of rules) {
        if (rule.cssRules) { walk(rule.cssRules, rule.conditionText || media); continue; }
        if (!rule.selectorText) continue;
        let hit = false;
        try { hit = svg.matches(rule.selectorText); } catch { continue; }
        if (hit) out.push({ media: media || '', sel: rule.selectorText, css: rule.style.cssText.slice(0, 200) });
      }
    };
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      walk(rules, '');
    }
    return out;
  });
  console.log('[diag5] ALL matched rules for the tool svg:', JSON.stringify(matched, null, 1));
  await hardClose(electronApp, 'diag-icon-width5');
  electronApp = null;
});