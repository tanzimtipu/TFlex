// TFL-1259 diag2: dark-theme paper stays white; minimum supported width (480)
// has no horizontal overflow and keeps the action reachable.
delete process.env.ELECTRON_RUN_AS_NODE;
const path = require('node:path');
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

    // dark theme
    await p.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await p.waitForTimeout(300);
    const dark = await p.evaluate(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
      const sheet = document.querySelector('.print-preview-sheet');
      const cell = document.querySelector('.print-preview-cell');
      const img = document.querySelector('.print-preview-cell img');
      return {
        theme: document.documentElement.dataset.theme,
        sheetBg: getComputedStyle(sheet).backgroundColor,
        cellBg: cell ? getComputedStyle(cell).backgroundColor : null,
        stageBg: getComputedStyle(document.querySelector('.print-preview')).backgroundColor,
        sheet: r(sheet),
        cell: cell ? r(cell) : null,
        img: img ? r(img) : null,
      };
    });
    console.log(`[diag2] dark = ${JSON.stringify(dark)}`);
    await p.screenshot({ path: path.join(SHOTS, 'adv-tfl1259-dark-wide.png') });

    // minimum supported width
    await setSize(app, 480, 700);
    await p.waitForFunction(() => document.querySelector('.print-body')?.getAttribute('data-print-layout-mode') === 'compact', null, { timeout: 8000 });
    await p.waitForTimeout(300);
    const narrow = await p.evaluate(() => {
      const body = document.querySelector('.print-window-panel .modal-body');
      const confirm = document.querySelector('[data-print-confirm]').getBoundingClientRect();
      const header = document.querySelector('.print-studio-header').getBoundingClientRect();
      const footer = document.querySelector('.print-footer').getBoundingClientRect();
      return {
        mode: document.querySelector('.print-body')?.getAttribute('data-print-layout-mode'),
        hOverflow: body.scrollWidth - body.clientWidth,
        confirmVisible: confirm.width > 0 && confirm.bottom <= window.innerHeight + 1,
        headerVisible: header.height > 0 && header.top >= -1,
        footerInViewport: footer.bottom <= window.innerHeight + 1,
        vw: window.innerWidth,
      };
    });
    console.log(`[diag2] narrow480 = ${JSON.stringify(narrow)}`);
    await p.screenshot({ path: path.join(SHOTS, 'adv-tfl1259-narrow480.png') });
  } finally {
    await hardClose(app, 'tfl1259-diag2');
  }
  process.exit(0);
})();
