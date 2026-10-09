// TFL-1259 focused diagnostic: (1) do closed advanced groups actually collapse?
// (2) why was [data-print-page-order] disabled after setting N-up to 4?
delete process.env.ELECTRON_RUN_AS_NODE;
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const REPO = path.resolve(__dirname, '..', '..');
const { launchApp } = require(path.join(REPO, 'e2e', 'lib', 'launch.cjs'));
const { openSamplePath, openStandalonePrintWindow, hardClose } = require(path.join(REPO, 'e2e', 'lib', 'helpers.cjs'));
const SHOTS = path.join(REPO, 'screenshots');
const REPORT = path.join(REPO, 'test-fixtures', 'report.pdf');

async function setSize(app, w, h) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const x = BrowserWindow.getAllWindows().find((y) => y.webContents.getURL().includes('tfWindow=print'));
    if (x) x.setSize(s.w, s.h);
  }, { w, h });
}

(async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, REPORT);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(500);
    const p = await openStandalonePrintWindow(app, win);
    await p.waitForSelector('[data-print-preview] img', { timeout: 30000 });
    await p.waitForTimeout(400);
    await setSize(app, 560, 860);
    await p.waitForFunction(() => document.querySelector('.print-body')?.getAttribute('data-print-layout-mode') === 'compact', null, { timeout: 8000 });

    const detailsInfo = async (label) => {
      const info = await p.evaluate(() => {
        const d = document.querySelector('[data-print-group="quality"]');
        if (!d) return { present: false };
        const summary = d.querySelector('summary');
        const body = d.querySelector('.print-group-body');
        const duplex = d.querySelector('[data-print-duplex]');
        return {
          open: d.open,
          detailsH: d.getBoundingClientRect().height,
          summaryH: summary ? summary.getBoundingClientRect().height : null,
          bodyH: body ? body.getBoundingClientRect().height : null,
          bodyDisplay: body ? getComputedStyle(body).display : null,
          bodyVisibility: body ? getComputedStyle(body).visibility : null,
          duplexH: duplex ? duplex.getBoundingClientRect().height : null,
          duplexOffsetParent: duplex ? duplex.offsetParent !== null : null,
          detailsContentVisibility: getComputedStyle(d).contentVisibility,
        };
      });
      console.log(`[diag] quality ${label} = ${JSON.stringify(info)}`);
      return info;
    };
    await detailsInfo('closed(compact)');
    await p.screenshot({ path: path.join(SHOTS, 'adv-tfl1259-diag-quality-closed.png') });
    // is a control inside the closed group considered visible by Playwright?
    console.log(`[diag] duplex isVisible (closed) = ${await p.locator('[data-print-duplex]').isVisible()}`);
    // click the summary to expand
    await p.click('[data-print-group="quality"] > summary');
    await p.waitForTimeout(200);
    await detailsInfo('afterSummaryClick');
    await p.screenshot({ path: path.join(SHOTS, 'adv-tfl1259-diag-quality-expanded.png') });

    // ---- page-order diagnosis ----
    const orderState = async (label) => {
      const s = await p.evaluate(() => ({
        layout: document.querySelector('[data-print-layout]')?.value,
        nup: document.querySelector('[data-print-nup]')?.value,
        nupDisabled: document.querySelector('[data-print-nup]')?.disabled,
        orderDisabled: document.querySelector('[data-print-page-order]')?.disabled,
        orderValue: document.querySelector('[data-print-page-order]')?.value,
      }));
      console.log(`[diag] order ${label} = ${JSON.stringify(s)}`);
      return s;
    };
    await orderState('initial');
    await p.selectOption('[data-print-layout]', 'single');
    await p.waitForTimeout(150);
    await orderState('after layout=single');
    await p.selectOption('[data-print-nup]', '4');
    await p.waitForTimeout(250);
    await orderState('after nup=4');
    await p.selectOption('[data-print-page-order]', 'vertical').then(() => console.log('[diag] order set OK')).catch((e) => console.log('[diag] order set FAILED: ' + e.message.split('\n')[0]));
    await p.waitForTimeout(200);
    await orderState('after order=vertical');
  } finally {
    await hardClose(app, 'tfl1259-diag');
  }
  process.exit(0);
})();
