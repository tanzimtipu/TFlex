// DIAGNOSTIC 2 (qa, 2026-09-13): find the CSS rule that sets the command
// bar svg width to 14.6667px. Walks every stylesheet rule, matches it
// against the first command-bar tool svg, and reports any rule that
// touches width. No assertions - diagnostics only.
const { test } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');

let electronApp = null;

test('diag: which rule sizes the command-bar svg', async () => {
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

  const matches = await win.evaluate(() => {
    const svg = document.querySelector('.toolbar .tool-btn > svg');
    if (!svg) return { error: 'no svg' };
    const out = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of rules) {
        if (!rule.selectorText) continue;
        let hit = false;
        try { hit = svg.matches(rule.selectorText); } catch { continue; }
        if (!hit) continue;
        const st = rule.style;
        const w = st.getPropertyValue('width');
        const h = st.getPropertyValue('height');
        const mx = st.getPropertyValue('max-width');
        const mn = st.getPropertyValue('min-width');
        const ar = st.getPropertyValue('aspect-ratio');
        if (w || h || mx !== '' || mn !== '' || ar !== '') {
          out.push({ sel: rule.selectorText, width: w, height: h, maxWidth: mx, minWidth: mn, aspectRatio: ar });
        }
      }
    }
    return out;
  });
  console.log('[diag2] rules touching tool svg width:', JSON.stringify(matches, null, 1));

  // Same walk for an ann-toolbar svg (which measures a clean 24x24)
  const annMatches = await win.evaluate(() => {
    const svg = document.querySelector('.ann-toolbar .ann-tool-btn > svg');
    if (!svg) return { error: 'no svg' };
    const out = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of rules) {
        if (!rule.selectorText) continue;
        let hit = false;
        try { hit = svg.matches(rule.selectorText); } catch { continue; }
        if (!hit) continue;
        const st = rule.style;
        const w = st.getPropertyValue('width');
        const h = st.getPropertyValue('height');
        if (w !== '' || h !== '') {
          out.push({ sel: rule.selectorText, width: w, height: h });
        }
      }
    }
    return out;
  });
  console.log('[diag2] rules touching ann svg width:', JSON.stringify(annMatches, null, 1));
  await hardClose(electronApp, 'diag-icon-width2');
  electronApp = null;
});