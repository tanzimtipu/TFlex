// Phase 57 (qa) - packaged-build SURFACE smoke (module completeness).
//
// The earlier packaged pass (phase57_packaged_runtime.spec.cjs) covered the
// conversion matrix, pdf.js render, accounts boot, OCR and office export. This
// spec smoke-checks the surfaces that pass did NOT cover, against the SAME
// packaged exe (release/win-unpacked/Jovrel.exe, prune reverted):
//
//   S1 READING VIEW   - epub reading view + cbz comic view open
//   S2 PRINT          - the standalone print window produces print output
//   S3 ENCRYPT        - save an encrypted copy and re-open it
//   S4 STAMP + SIGN   - a stamp and a signature land and modify the document
//   S5 SETTINGS       - a preference survives a restart (same user-data dir)
//   S6 ACCOUNTS       - the accounts surface renders
//
// This is a MODULE-COMPLETENESS smoke, NOT a re-verification of each feature's
// behaviour: each surface is driven through the real UI/IPC and asserted to
// open and return a typed outcome with ZERO renderer pageerror. Deep feature
// behaviour is owned by the dev-build suites.
//
// Run with:
//   $env:TFLEX_PACKAGED_EXE='<abs>\release\win-unpacked\Jovrel.exe'
//   npx.cmd playwright test --config=e2e/installed/playwright.installed.config.js phase57_packaged_surface.spec.cjs
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const {
  hardClose,
  dismissUpdatePrompt,
  gotoStage,
  clickDockVerb,
  armSignTool,
  openStandalonePrintWindow,
  closeStandalonePrintWindow,
} = require('../lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const PACKAGED_EXE =
  process.env.TFLEX_PACKAGED_EXE ||
  process.env.TFLEX_E2E_EXE ||
  'C:\\Program Files\\Jovrel\\Jovrel.exe';
const FIX56 = path.join(ROOT, 'test-fixtures', 'phase56');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p57-surface-'));

const log = (label, obj) => console.log(`[p57s|${label}] ${JSON.stringify(obj)}`);

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

let app = null;
let win = null;
let pageErrors = [];

test.beforeEach(async () => {
  pageErrors = [];
  app = await launchApp([], null, PACKAGED_EXE);
  win = await app.firstWindow();
  win.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 400)));
  await win.waitForSelector('.welcome', { timeout: 60000 }); // R09: packed Home hides .sample-card
  await dismissUpdatePrompt(win);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p57s');
  app = null;
  win = null;
});

// --- shared driving helpers (mirror phase53/phase56) -----------------------
async function stubOpen(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
}

async function clickOpen() {
  await win.locator('[aria-label="Open PDF document"]').first().click();
}

const diag = () => win.evaluate(() => window.tflexDiagnostics());

async function waitImportOutcome(timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await win.locator('[data-conversion-notice]').count()) > 0) return { ok: true };
    if (pageErrors.length > 0) return { ok: false, error: pageErrors[0] };
    await win.waitForTimeout(250);
  }
  return { ok: false, error: 'timeout waiting for conversion notice' };
}

async function waitForFile(p, timeoutMs = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fs.existsSync(p) && fs.statSync(p).size > 0) return true;
    await win.waitForTimeout(300);
  }
  return false;
}

// --- printToPDF override (test-harness seam, mirror phase30) ---------------
// Patches WebContents.prototype.print so the app's REAL printJob composes its
// hidden window and converts it with printToPDF instead of reaching a driver.
// No physical device is ever touched.
async function installPrintOverride(electronApp) {
  await electronApp.evaluate(({ BrowserWindow }) => {
    if (global.__p57sOrigPrint) return;
    const proto = Object.getPrototypeOf(BrowserWindow.getAllWindows()[0].webContents);
    global.__p57sPrintProto = proto;
    global.__p57sOrigPrint = proto.print;
    global.__p57sPrintResults = [];
    proto.print = function (options, callback) {
      this.printToPDF(options)
        .then((buf) => {
          global.__p57sPrintResults.push({ options, base64: buf.toString('base64') });
          callback(true, '');
        })
        .catch((err) => {
          const msg = String((err && err.message) || err);
          global.__p57sPrintResults.push({ options, error: msg });
          callback(false, msg);
        });
    };
  });
}

async function restorePrintOverride(electronApp) {
  await electronApp.evaluate(() => {
    if (global.__p57sOrigPrint && global.__p57sPrintProto) {
      global.__p57sPrintProto.print = global.__p57sOrigPrint;
      global.__p57sOrigPrint = null;
      global.__p57sPrintProto = null;
    }
  });
}

// ===========================================================================
// S1 READING VIEW - epub reading view + cbz comic view open.
// ===========================================================================
test('S1 READING VIEW: epub and cbz open the reading surface with no pageerror', async () => {
  // epub -> reading view
  await stubOpen(path.join(FIX56, 'phase56-book.epub'));
  await clickOpen();
  const epubOutcome = await waitImportOutcome(60000);
  expect(epubOutcome.ok, `epub import failed: ${epubOutcome.error}`).toBe(true);
  const openReading = win.locator('[aria-label="Open reading view"]');
  await openReading.waitFor({ state: 'visible', timeout: 20000 });
  await openReading.click();
  await win.waitForSelector('[data-reading-view]', { state: 'visible', timeout: 20000 });
  await win.waitForSelector('[data-reading-chapter]', { timeout: 20000 });
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SHOTS, 'phase57-surface-reading-epub.png') });
  const epubChapters = await win.locator('[data-reading-chapter]').count();
  await win.locator('[aria-label="Close reading view"]').click();
  await expect(win.locator('[data-reading-view]')).toHaveCount(0);

  // cbz -> comic view
  await stubOpen(path.join(FIX56, 'phase56-comic.cbz'));
  await clickOpen();
  const cbzOutcome = await waitImportOutcome(60000);
  expect(cbzOutcome.ok, `cbz import failed: ${cbzOutcome.error}`).toBe(true);
  const openComic = win.locator('[aria-label="Open comic view"]');
  await openComic.waitFor({ state: 'visible', timeout: 20000 });
  await openComic.click();
  await win.waitForSelector('[data-reading-view][data-reading-mode="comic"]', { state: 'visible', timeout: 20000 });
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SHOTS, 'phase57-surface-reading-cbz.png') });
  const comicPages = await win.locator('[data-comic-page]').count();
  await win.locator('[aria-label="Close reading view"]').click();
  await expect(win.locator('[data-reading-view]')).toHaveCount(0);

  log('reading', { epubChapters, comicPages });
  expect(epubChapters, 'epub reading view paginated').toBeGreaterThan(0);
  expect(comicPages, 'cbz comic view rendered a page').toBeGreaterThan(0);
  expect(pageErrors, 'zero renderer page errors').toEqual([]);
});

// ===========================================================================
// S2 PRINT - the standalone print window produces print output.
// ===========================================================================
test('S2 PRINT: the standalone print window produces print output with no pageerror', async () => {
  await stubOpen(getSamplePath('report.pdf'));
  await clickOpen();
  await win.waitForSelector('.pdf-page canvas', { timeout: 60000 });
  await win.waitForTimeout(800);

  await installPrintOverride(app);
  const printPage = await openStandalonePrintWindow(app, win);
  printPage.on('pageerror', (e) => pageErrors.push(`[print] ${String(e).slice(0, 400)}`));
  await printPage.screenshot({ path: path.join(SHOTS, 'phase57-surface-print-dialog.png') });

  await printPage.click('[data-print-confirm]');
  await printPage.waitForSelector('[data-print-success]', { state: 'visible', timeout: 180000 });
  const successText = await printPage.locator('[data-print-success]').innerText();
  const results = await app.evaluate(() => global.__p57sPrintResults || []);
  await printPage.screenshot({ path: path.join(SHOTS, 'phase57-surface-print-success.png') });

  await restorePrintOverride(app);
  await closeStandalonePrintWindow(app, printPage);

  const produced = results.find((r) => r.base64 && r.base64.length > 0);
  const bytes = produced ? Buffer.from(produced.base64, 'base64').length : 0;
  log('print', { successText, producedBytes: bytes, results: results.map((r) => ({ bytes: r.base64 ? Buffer.from(r.base64, 'base64').length : 0, error: r.error || null })) });
  expect(produced, 'the print pipeline produced PDF bytes').toBeTruthy();
  expect(bytes, 'produced print output is non-zero').toBeGreaterThan(0);
  expect(pageErrors, 'zero renderer page errors').toEqual([]);
});

// ===========================================================================
// S3 ENCRYPT - save an encrypted copy and re-open it.
// ===========================================================================
test('S3 ENCRYPT: save an encrypted copy and re-open it with no pageerror', async () => {
  await stubOpen(getSamplePath('report.pdf'));
  await clickOpen();
  await win.waitForSelector('.pdf-page canvas', { timeout: 60000 });
  await win.waitForTimeout(800);

  const outPath = path.join(TMP, `p57s-encrypted-${Date.now()}.pdf`);
  await app.evaluate(({ session }, p) => {
    globalThis.__p57sDownloadPath = p;
    session.defaultSession.removeAllListeners('will-download');
    session.defaultSession.on('will-download', (_e, item) => {
      if (globalThis.__p57sDownloadPath) item.setSavePath(globalThis.__p57sDownloadPath);
    });
  }, outPath);

  await gotoStage(win, 4);
  const verb = win.locator('[data-dock-verb="encrypt"]');
  if ((await verb.count()) > 0 && (await verb.first().isVisible().catch(() => false))) {
    await verb.first().click();
  } else {
    await clickDockVerb(win, 4, 'encrypt');
  }
  await win.waitForSelector('[data-encrypt-dialog]', { timeout: 20000 });
  await win.locator('[data-encrypt-user-password]').fill('P57-Surface-Pass!');
  await win.locator('[data-encrypt-confirm]').click();
  const written = await waitForFile(outPath, 30000);
  expect(written, 'the encrypted copy was written').toBe(true);
  await win.screenshot({ path: path.join(SHOTS, 'phase57-surface-encrypt.png') });

  // Re-open the encrypted copy: password prompt -> open.
  await stubOpen(outPath);
  await clickOpen();
  await win.waitForSelector('[data-password-prompt]', { timeout: 30000 });
  await win.locator('[data-password-input]').fill('P57-Surface-Pass!');
  await win.locator('[data-password-submit]').click();
  await win.waitForSelector('[data-password-prompt]', { state: 'detached', timeout: 30000 });
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(600);
  await win.screenshot({ path: path.join(SHOTS, 'phase57-surface-encrypt-reopen.png') });
  const d = await diag();
  log('encrypt', { outPath, size: fs.statSync(outPath).size, pageCount: d.pageCount });
  expect(d.pageCount, 'the re-opened encrypted copy rendered').toBeGreaterThan(0);
  expect(pageErrors, 'zero renderer page errors').toEqual([]);
});

// ===========================================================================
// S4 STAMP + SIGNATURE - a stamp and a signature land and modify the document.
// ===========================================================================
test('S4 STAMP + SIGNATURE: a stamp and a signature land and modify the document', async () => {
  await stubOpen(getSamplePath('report.pdf'));
  await clickOpen();
  await win.waitForSelector('.pdf-page canvas', { timeout: 60000 });
  await win.waitForTimeout(800);

  // Stamp
  await gotoStage(win, 3);
  const stampVerb = win.locator('[data-dock-verb="stamp"]');
  if ((await stampVerb.count()) > 0 && (await stampVerb.first().isVisible().catch(() => false))) {
    await stampVerb.first().click();
  } else {
    await clickDockVerb(win, 3, 'stamp');
  }
  await win.waitForSelector('[data-stamp-dialog]', { timeout: 20000 });
  await win.locator('[data-stamp-confirm]').click();
  await win.waitForTimeout(500);
  const armedGhosts = await win.locator('[data-stamp-ghost]').count();
  // Click a point on the page that is inside the viewport and clear of the
  // action dock (the page's geometric centre can sit behind the dock at the
  // packaged build's default zoom).
  const page = await win.locator('.pdf-page[data-page="1"]').first().boundingBox();
  await win.mouse.click(page.x + 200, page.y + 200);
  const landed = await win.waitForSelector('.stamp-annotation', { timeout: 20000 }).then(() => true).catch(() => false);
  const stampDebug = {
    armedGhosts,
    landed,
    stampLayers: await win.locator('[data-stamp-layer]').count(),
    toasts: await win.locator('.toast-text').allInnerTexts().catch(() => []),
  };
  log('stamp-debug', stampDebug);
  await win.waitForTimeout(800);
  const stampCount = await win.locator('.stamp-annotation').count();
  const afterStamp = await diag();
  await win.screenshot({ path: path.join(SHOTS, 'phase57-surface-stamp.png') });

  // Signature (typed, saved, placed)
  await armSignTool(win);
  await win.waitForSelector('.sig-manager', { timeout: 20000 });
  await win.click('.sig-tab:has-text("Type")');
  await win.waitForTimeout(300);
  await win.fill('input[aria-label="Type your signature"]', 'QA');
  await win.click('.sig-manager button:text-is("Save")');
  await win.waitForTimeout(500);
  await win.click('.sig-saved-pick');
  await win.waitForTimeout(500);
  const layer = win.locator('[data-annotation-layer="1"]');
  const lb = await layer.first().boundingBox();
  await win.mouse.click(lb.x + 200, lb.y + 200);
  await win.waitForSelector('[data-sig-action-bar]', { timeout: 20000 });
  await win.click('[data-sig-action="confirm"]');
  await win.waitForTimeout(800);
  const sigCount = await win.locator('.sig-placement').count();
  const afterSig = await diag();
  await win.screenshot({ path: path.join(SHOTS, 'phase57-surface-signature.png') });

  log('stamp-sign', { stampCount, sigCount, modifiedAfterStamp: afterStamp.modified, modifiedAfterSig: afterSig.modified });
  expect(stampCount, 'the stamp landed on the page').toBeGreaterThan(0);
  expect(afterStamp.modified, 'the stamp modified the document').toBe(true);
  expect(sigCount, 'the signature landed on the page').toBeGreaterThan(0);
  expect(afterSig.modified, 'the signature modified the document').toBe(true);
  expect(pageErrors, 'zero renderer page errors').toEqual([]);
});

// ===========================================================================
// S5 SETTINGS PERSISTENCE - a preference survives a restart (same user-data).
// ===========================================================================
test('S5 SETTINGS PERSISTENCE: a preference survives a restart with the same user-data dir', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p57s-prefs-'));
  await hardClose(app, 'p57s-prefs');
  app = await launchApp([], userData, PACKAGED_EXE);
  win = await app.firstWindow();
  win.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 400)));
  await win.waitForSelector('.welcome', { timeout: 60000 }); // R09: packed Home hides .sample-card
  await dismissUpdatePrompt(win);

  await win.locator('[data-open-preferences]').first().click();
  await win.waitForSelector('[data-prefs-convert-section]', { timeout: 20000 });
  await win.locator('[data-prefs-convert-page-size]').selectOption('letter');
  await win.locator('[data-prefs-convert-margin]').fill('30');
  await win.locator('[data-prefs-convert-margin]').blur();
  await win.waitForTimeout(900);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(600);
  await win.screenshot({ path: path.join(SHOTS, 'phase57-surface-settings-before.png') });

  await hardClose(app, 'p57s-prefs');
  app = await launchApp([], userData, PACKAGED_EXE);
  win = await app.firstWindow();
  win.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 400)));
  await win.waitForSelector('.welcome', { timeout: 60000 }); // R09: packed Home hides .sample-card
  await dismissUpdatePrompt(win);
  await win.locator('[data-open-preferences]').first().click();
  await win.waitForSelector('[data-prefs-convert-section]', { timeout: 20000 });
  const persisted = {
    pageSize: await win.locator('[data-prefs-convert-page-size]').inputValue(),
    margin: await win.locator('[data-prefs-convert-margin]').inputValue(),
  };
  await win.screenshot({ path: path.join(SHOTS, 'phase57-surface-settings-after.png') });
  log('settings', { persisted });
  expect(persisted.pageSize, 'page size persisted across restart').toBe('letter');
  expect(persisted.margin, 'margin persisted across restart').toBe('30');
  expect(pageErrors, 'zero renderer page errors').toEqual([]);
});

// ===========================================================================
// S6 ACCOUNTS - the accounts surface renders (no real sign-in attempted).
// ===========================================================================
test('S6 ACCOUNTS: the accounts surface renders with no pageerror', async () => {
  await win.locator('[data-header-accounts]').first().click();
  await win.waitForSelector('[data-accounts-auth]', { state: 'visible', timeout: 30000 });
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SHOTS, 'phase57-surface-accounts.png') });
  const count = await win.locator('[data-accounts-auth]').count();
  log('accounts', { count });
  expect(count, 'the accounts auth surface mounted').toBeGreaterThan(0);
  expect(pageErrors, 'zero renderer page errors').toEqual([]);
});
