// TFL-1188 adversary live probe — AR-07 range classifier gaps in the real
// Extract (split) dialog. Product code is read-only.
//
//  ADV-244: `1abc` (trailing garbage) is accepted as VALID and enables Extract
//           (acts on page 1), though the input is not a valid page token.
//  ADV-245: an out-of-bounds span `50-60` on a 34-page doc names only 60.
//
// Run: node test-fixtures/tfl1188-adversary/live_probe_range.cjs
delete process.env.ELECTRON_RUN_AS_NODE;

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require(path.resolve(__dirname, '..', '..', 'e2e', 'lib', 'launch.cjs'));
const { hardClose, shot, runTool } = require(path.resolve(__dirname, '..', '..', 'e2e', 'lib', 'helpers.cjs'));

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tfl1188-range-'));
  let app = null;
  try {
    app = await launchApp([], userData);
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
    await win.waitForSelector('.workspace', { timeout: 30000 });
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(800);

    await runTool(win, 'extract');
    await win.waitForSelector('#split-page-range', { timeout: 10000 });
    await win.waitForTimeout(300);

    const cases = ['1abc', '2-3x', '1.9', '12px', '50-60', '35-40', '999'];
    const results = [];
    for (const v of cases) {
      await win.fill('#split-page-range', v);
      await win.waitForTimeout(200);
      const r = await win.evaluate(() => {
        const s = document.querySelector('#split-range-status');
        const btn = document.querySelector('[data-dialog-action="confirm"]');
        return {
          text: s === null ? null : (s.textContent || '').trim(),
          state: s === null ? null : s.getAttribute('data-range-state'),
          disabled: btn === null ? null : btn.disabled,
          confirmLabel: btn === null ? null : (btn.textContent || '').trim(),
        };
      });
      results.push({ input: v, ...r });
      if (v === '1abc') {
        await win.screenshot({ path: path.join(SHOTS, 'adv-244-range-trailing-garbage.png') });
      }
      if (v === '50-60') {
        await win.screenshot({ path: path.join(SHOTS, 'adv-245-range-span-endpoint.png') });
      }
    }
    console.log(`[tfl1188-range] results=${JSON.stringify(results, null, 2)}`);
  } finally {
    if (app) await hardClose(app, 'tfl1188-range');
  }
})().catch((e) => {
  console.error('[tfl1188-range] FATAL', e);
  process.exit(1);
});
