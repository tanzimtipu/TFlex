// ADV P30 attack 3b: dialog edge cases against the real app (corrected).
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const { launchApp } = require(path.join(ROOT, 'e2e', 'lib', 'launch.cjs'));
const { openSamplePath, hardClose } = require(path.join(ROOT, 'e2e', 'lib', 'helpers.cjs'));

const SHOTS = path.join(ROOT, 'screenshots');
const REPORT = path.join(ROOT, 'test-fixtures', 'report.pdf');
const ONE = path.join(ROOT, 'test-fixtures', 'squiggly-native.pdf');

async function openDialog(win) {
  await win.click('[data-print]');
  await win.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
}

async function ctrlKey(app, win, key) {
  await win.bringToFront();
  await app.evaluate(({ BrowserWindow }, k) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: ['control'] });
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: ['control'] });
  }, key);
}

(async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  const consoleErrors = [];
  const pageErrors = [];
  win.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  win.on('pageerror', (e) => pageErrors.push(e.message));
  let windowEvents = 0;
  app.on('window', () => { windowEvents += 1; });
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openSamplePath(win, app, REPORT);
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(500);

  // ---------- A. rapid toggles during a long raster ----------
  try {
    await openDialog(win);
    await win.selectOption('[data-print-nup]', '16'); // 16 preview pages to raster
    for (let i = 0; i < 6; i += 1) {
      await win.click('[data-print-annotations]');
      await win.click(i % 2 ? '[data-print-orientation-landscape]' : '[data-print-orientation-portrait]');
      await win.click(i % 2 ? '[data-print-scale-shrink]' : '[data-print-scale-fit]');
      await win.click(i % 2 ? '[data-print-scale-actual]' : '[data-print-scale-fit]');
    }
    await win.waitForTimeout(3000);
    console.log(`A rapid-toggles: nup=${await win.inputValue('[data-print-nup]')} previewImgs=${await win.locator('[data-print-preview] img').count()} dialogAlive=${await win.locator('[data-print-printer]').count()}`);
  } catch (e) {
    console.log('A rapid-toggles THREW', e.message);
  }

  // ---------- B. cancel mid-raster then reopen ----------
  try {
    await win.selectOption('[data-print-nup]', '16');
    await win.click('[data-print-cancel]');
    await win.locator('[data-print-printer]').waitFor({ state: 'detached', timeout: 8000 });
    await win.waitForTimeout(300);
    await openDialog(win);
    const state = await win.evaluate(() => ({
      copies: document.querySelector('[data-print-copies]').value,
      nup: document.querySelector('[data-print-nup]').value,
      ann: document.querySelector('[data-print-annotations]').checked,
      success: document.querySelector('[data-print-success]') !== null,
      error: document.querySelector('[data-print-error]') !== null,
    }));
    console.log('B reopen-state', JSON.stringify(state));
    await win.waitForSelector('[data-print-preview] img', { timeout: 20000 });
    console.log('B preview after reopen OK');
  } catch (e) {
    console.log('B cancel-reopen THREW', e.message);
  }

  // ---------- C. huge / hostile range strings ----------
  try {
    await win.click('[data-print-range-custom]');
    await win.fill('[data-print-range-input]', '1-1000000000');
    await win.waitForTimeout(300);
    console.log(`C huge-range err=${JSON.stringify(await win.locator('[data-print-range-error]').textContent().catch(() => null))} confirmDisabled=${await win.locator('[data-print-confirm]').isDisabled()}`);
    const big = '9'.repeat(50000);
    const t0 = Date.now();
    await win.fill('[data-print-range-input]', big);
    await win.waitForTimeout(400);
    console.log(`C 50k-digit range ms=${Date.now() - t0} err=${JSON.stringify(await win.locator('[data-print-range-error]').textContent().catch(() => null))}`);
    const many = Array(5000).fill('1').join(',');
    await win.fill('[data-print-range-input]', many);
    await win.waitForTimeout(600);
    console.log(`C 5000-token range meta=${JSON.stringify(await win.textContent('[data-print-preview-meta]').catch(() => null))}`);
    await win.fill('[data-print-range-input]', '1x-2');
    await win.waitForTimeout(300);
    console.log(`C non-numeric error present=${await win.locator('[data-print-range-error]').count()}`);
    await win.click('[data-print-range-all]');
  } catch (e) {
    console.log('C range THREW', e.message);
  }

  await win.screenshot({ path: path.join(SHOTS, 'adv-p30-dialog-report.png') });

  // ---------- D. close the active tab behind the open dialog (Ctrl+W accelerator) ----------
  try {
    const tabsBefore = await win.locator('[data-tab-id]').count();
    await ctrlKey(app, win, 'W');
    await win.waitForTimeout(1000);
    const tabsAfter = await win.locator('[data-tab-id]').count();
    const dialogStill = await win.locator('[data-print-printer]').count();
    const meta = await win.textContent('[data-print-preview-meta]').catch(() => null);
    const confirmDisabled = await win.locator('[data-print-confirm]').isDisabled().catch(() => 'no-btn');
    console.log(`D ctrl+W behind dialog: tabs ${tabsBefore}->${tabsAfter} dialogCount=${dialogStill} meta=${JSON.stringify(meta)} confirmDisabled=${confirmDisabled}`);
    await win.screenshot({ path: path.join(SHOTS, 'adv-p30-dialog-notab.png') });
    await win.click('[data-print-cancel]');
    await win.locator('[data-print-printer]').waitFor({ state: 'detached', timeout: 8000 });
    console.log('D dialog closed after tab close OK');
  } catch (e) {
    console.log('D ctrl+W THREW', e.message);
    await win.locator('[data-print-cancel]').click().catch(() => {});
  }

  console.log('CONSOLE_ERRORS_AFTER_D', JSON.stringify(consoleErrors.slice(0, 10)));
  console.log('PAGE_ERRORS_AFTER_D', JSON.stringify(pageErrors.slice(0, 10)));

  // ---------- E. 1-page doc: odd-only works, even-only errors ----------
  await openSamplePath(win, app, ONE);
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(400);
  try {
    await openDialog(win);
    await win.waitForSelector('[data-print-preview] img', { timeout: 20000 });
    await win.selectOption('[data-print-odd-even]', 'odd');
    await win.waitForTimeout(300);
    console.log(`E 1page odd: meta=${JSON.stringify(await win.textContent('[data-print-preview-meta]'))} confirmDisabled=${await win.locator('[data-print-confirm]').isDisabled()}`);
    await win.selectOption('[data-print-odd-even]', 'even');
    await win.waitForTimeout(300);
    console.log(`E 1page even: meta=${JSON.stringify(await win.textContent('[data-print-preview-meta]'))} confirmDisabled=${await win.locator('[data-print-confirm]').isDisabled()}`);
    await win.selectOption('[data-print-odd-even]', 'all');
  } catch (e) {
    console.log('E odd/even THREW', e.message);
  }

  // ---------- F. stubbed fake device: result surface + double-click ----------
  try {
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.webContents.getPrintersAsync = async () => ([
        { name: '__adv_no_such_printer__', displayName: 'ADV Fake', isDefault: true },
      ]);
    });
    await win.click('[data-print-cancel]');
    await win.locator('[data-print-printer]').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    await openDialog(win);
    await win.waitForFunction(() => {
      const s = document.querySelector('[data-print-printer]');
      return s && [...s.options].some((o) => o.value === '__adv_no_such_printer__');
    }, null, { timeout: 8000 });
    await win.waitForSelector('[data-print-preview] img', { timeout: 20000 });
    const before = windowEvents;
    await win.locator('[data-print-confirm]').dblclick();
    await win.waitForSelector('[data-print-error]', { timeout: 20000 });
    const errText = (await win.textContent('[data-print-error]')).trim();
    await win.waitForTimeout(2500);
    console.log(`F dblclick: err=${JSON.stringify(errText)} hiddenWindowEvents=${windowEvents - before} progressPresent=${await win.locator('[data-print-progress]').count()} confirmDisabled=${await win.locator('[data-print-confirm]').isDisabled()}`);
    await win.screenshot({ path: path.join(SHOTS, 'adv-p30-print-error.png') });

    // ---------- G. same-tick double click (programmatic) ----------
    const before2 = windowEvents;
    await win.evaluate(() => {
      const btn = document.querySelector('[data-print-confirm]');
      if (btn) { btn.click(); btn.click(); }
    });
    await win.waitForTimeout(3000);
    console.log(`G same-tick-dblclick: windowEventsDelta=${windowEvents - before2} errorPresent=${await win.locator('[data-print-error]').count()} progressPresent=${await win.locator('[data-print-progress]').count()} confirmLabel=${JSON.stringify((await win.locator('[data-print-confirm]').textContent()).trim())}`);
  } catch (e) {
    console.log('F/G dblclick THREW', e.message);
  }

  console.log('FINAL_PAGE_ERRORS', JSON.stringify(pageErrors));
  console.log('FINAL_CONSOLE_ERRORS', JSON.stringify(consoleErrors));
  await hardClose(app, 'adv-p30-dialog2');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });