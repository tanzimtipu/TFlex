// DIAGNOSTIC 2 (qa, 2026-09-13): what exactly matches [aria-label="Save"],
// where do its buttons sit, and where does the group center land? Follows
// diag_nosweep_save.spec.cjs (first run showed [aria-label="Save"] matching a
// 75.33px-wide .glass-control-group.toolbar-group whose CENTER is the gap
// between the Save and Save a copy buttons).
const { test } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');

test('diag2: Save locator anatomy', async () => {
  test.setTimeout(240000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);

  const anatomy = await win.evaluate(() => {
    const matches = Array.from(document.querySelectorAll('[aria-label="Save"]'));
    const describe = (el) => {
      const b = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        cls: el.className,
        role: el.getAttribute('role'),
        aria: el.getAttribute('aria-label'),
        rect: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width * 100) / 100, h: Math.round(b.height) },
        childButtons: Array.from(el.querySelectorAll('button')).map((btn) => {
          const bb = btn.getBoundingClientRect();
          return {
            label: btn.getAttribute('aria-label'),
            disabled: btn.disabled,
            box: { x: Math.round(bb.x * 100) / 100, w: Math.round(bb.width * 100) / 100, h: Math.round(bb.height) },
          };
        }),
      };
    };
    // where does the group's own center land?
    const centerHits = matches.map((el) => {
      const b = el.getBoundingClientRect();
      const cx = b.left + b.width / 2;
      const cy = b.top + b.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      const btn = hit.closest ? hit.closest('button') : null;
      return {
        tag: hit.tagName,
        groupX: Math.round(b.x), groupW: Math.round(b.width * 100) / 100,
        centerX: Math.round(cx * 100) / 100,
        hitTag: hit.tagName,
        hitClass: hit.className || '',
        hitInsideButton: btn ? btn.getAttribute('aria-label') : null,
      };
    });
    return { matchCount: matches.length, matches: matches.map(describe), centerHits };
  });
  console.log('[diag2] anatomy:', JSON.stringify(anatomy, null, 1));

  await hardClose(electronApp, 'diag2-save-anatomy');
});