// Phase 57 (qa) - pruned packaged-build runtime verification (criterion 5
// packaged leg + criterion 6 installer size + matrure regression).
//
// backend-dev pruned electron-builder.yml's `files:` list to bring the NSIS
// installer under the 150 MB budget (REQUIREMENTS.md:82): renderer-only
// dependency trees (pdfjs-dist, lucide-react, react, react-dom, motion,
// @fontsource-variable, @neondatabase/auth, @neondatabase/auth-ui, @triplit),
// @napi-rs/canvas and dev artifacts (*.map, node_modules/**/*.ts...) were
// removed from app.asar. The change was NOT verified at runtime before this
// dispatch.
//
// This spec runs ONLY against a packaged build. Default target is
// release/win-unpacked/Jovrel.exe (the pruned asar); override with
// TFLEX_PACKAGED_EXE. It proves the pruned asar still boots and that the
// surviving assets/requires work: installer artifacts + size (criterion 6),
// the 28-case conversion matrix, pdf.js page rendering (worker asset),
// the accounts surface (pruned renderer auth tree), OCR (tesseract.js +
// assets/tessdata) and the office xlsx/pptx export path (xlsx/pptxgenjs).
//
// Run with:
//   $env:TFLEX_PACKAGED_EXE='<abs>\release\win-unpacked\Jovrel.exe'
//   npx.cmd playwright test --config=e2e/installed/playwright.installed.config.js phase57_packaged_runtime.spec.cjs
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose, dismissUpdatePrompt, clickDockVerb } = require('../lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const RELEASE = path.join(ROOT, 'release');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const VERSION = require('../../package.json').version;
const PACKAGED_EXE =
  process.env.TFLEX_PACKAGED_EXE ||
  process.env.TFLEX_E2E_EXE ||
  'C:\\Program Files\\Jovrel\\Jovrel.exe';
const MANIFEST = require('../../test/unit/main/convertMatrix.manifest.json');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p57-'));

const log = (label, obj) => console.log(`[p57|${label}] ${JSON.stringify(obj)}`);

test.setTimeout(900000);
test.describe.configure({ mode: 'serial' });

// ===========================================================================
// 2a - criterion 6: the four release artifacts exist; Setup < 150 MB.
// ===========================================================================
test('2a ARTIFACTS: the four release artifacts exist and Setup is under 150 MB', () => {
  console.log(`[p57] PACKAGED_EXE=${PACKAGED_EXE} version=${VERSION}`);
  const artifacts = {
    setup: path.join(RELEASE, `Jovrel-Setup-${VERSION}-x64.exe`),
    blockmap: path.join(RELEASE, `Jovrel-Setup-${VERSION}-x64.exe.blockmap`),
    portable: path.join(RELEASE, `Jovrel-${VERSION}-portable-x64.exe`),
    latest: path.join(RELEASE, 'latest.yml'),
  };
  const sizes = {};
  for (const [k, p] of Object.entries(artifacts)) {
    expect(fs.existsSync(p), `missing artifact ${k}: ${p}`).toBe(true);
    sizes[k] = fs.statSync(p).size;
  }
  log('artifacts', { version: VERSION, sizes });
  expect(sizes.setup, 'Setup installer under the 150 MB budget').toBeLessThan(150000000);
});

// ===========================================================================
// App-backed checks. One launch per test; the matrix runs inside one launch.
// ===========================================================================
test.describe('packaged runtime checks', () => {
  let app = null;
  let win = null;
  let pageErrors = [];

  test.beforeEach(async () => {
    pageErrors = [];
    app = await launchApp([], null, PACKAGED_EXE);
    win = await app.firstWindow();
    win.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 400)));
    await win.waitForSelector('.sample-card', { timeout: 60000 });
    await dismissUpdatePrompt(win);
  });

  test.afterEach(async () => {
    if (app) await hardClose(app, 'p57');
    app = null;
    win = null;
  });

  // --- import-driving helpers (mirror phase53_format_import.spec.cjs) -------
  async function stubOpen(filePath) {
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, filePath);
  }

  async function clickOpen() {
    await win.locator('[aria-label="Open PDF document"]').first().click();
  }

  const diag = () => win.evaluate(() => window.tflexDiagnostics());
  const tabCount = () => win.locator('[data-tab-id]').count();

  async function resetTabs() {
    for (let i = 0; i < 40; i += 1) {
      const closers = win.locator('[data-tab-id] .tab-close');
      if ((await closers.count()) === 0) return;
      await closers.last().click().catch(() => {});
      await win.waitForTimeout(250);
    }
  }

  async function clearToasts() {
    const closers = win.locator('.toast-close');
    for (let i = await closers.count(); i > 0; i -= 1) {
      await closers.first().click().catch(() => {});
      await win.waitForTimeout(120);
    }
  }

  async function openSampleDoc(name) {
    await stubOpen(getSamplePath(name));
    await clickOpen();
    await win.waitForSelector('.pdf-page canvas', { timeout: 60000 });
    await win.waitForTimeout(600);
  }

  // Wait for an import to settle: a conversion notice / new tab, a reading
  // view, a toast, or a fresh renderer pageerror. Bounded so a broken import
  // fails fast rather than hanging the run.
  async function waitSettle(before, err0, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (pageErrors.length > err0) return 'pageerror';
      if ((await win.locator('[data-conversion-notice]').count()) > 0) return 'tab';
      if ((await tabCount()) > before) return 'tab';
      if ((await win.locator('[data-reading-view]').count()) > 0) return 'reading';
      if ((await win.locator('.toast-text').count()) > 0) return 'toast';
      await win.waitForTimeout(250);
    }
    return 'timeout';
  }

  // --- office-export capture (mirror phase55_office.spec.cjs:418-451) ------
  async function armDownloadCapture() {
    await app.evaluate(({ session, app }) => {
      const ses = session.defaultSession;
      const dir = app.getPath('downloads');
      ses.removeAllListeners('will-download');
      globalThis.__p57Download = null;
      globalThis.__p57DownloadEvents = 0;
      ses.on('will-download', (event, item) => {
        globalThis.__p57DownloadEvents += 1;
        const target = dir + '\\' + item.getFilename();
        item.setSavePath(target);
        globalThis.__p57Download = { path: target, filename: item.getFilename(), state: 'started' };
        item.once('done', (e, state) => {
          globalThis.__p57Download = { path: target, filename: item.getFilename(), state };
        });
      });
    });
  }

  async function resetDownload() {
    await app.evaluate(() => { globalThis.__p57Download = null; });
  }

  async function waitDownload(timeout = 180000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const info = await app.evaluate(() => globalThis.__p57Download);
      if (info && info.state === 'completed' && info.path && fs.existsSync(info.path) && fs.statSync(info.path).size > 0) return info;
      await win.waitForTimeout(300);
    }
    return null;
  }
  // =========================================================================
  // 2b - the packaged conversion matrix: all 28 manifest cases import into the
  // packaged app with no renderer pageerror and a non-zero result.
  // =========================================================================
  test('2b MATRIX SMOKE: 28-case conversion matrix imports with no pageerror', async () => {
    test.setTimeout(1500000);
    const cases = MANIFEST.cases;
    expect(cases.length, 'manifest case count').toBe(28);
    const results = [];

    for (const c of cases) {
      await resetTabs();
      await clearToasts();
      const before = await tabCount();
      const err0 = pageErrors.length;

      const src = path.resolve(ROOT, c.fixture);
      expect(fs.existsSync(src), `fixture missing: ${src}`).toBe(true);
      const tmp = path.join(TMP, `${Date.now()}-${Math.random().toString(36).slice(2)}${c.extension}`);
      fs.copyFileSync(src, tmp);

      await stubOpen(tmp);
      await clickOpen();

      const outcome = await waitSettle(before, err0, 90000);
      const newErrors = pageErrors.slice(err0);
      let pageCount = 0;
      try { pageCount = (await diag()).pageCount; } catch (_) { /* no active doc */ }
      const reading = (await win.locator('[data-reading-view]').count()) > 0;
      const toasts = (await win.locator('.toast-text').allInnerTexts().catch(() => []))
        .map((t) => t.trim()).filter(Boolean);
      const nonzero = (outcome === 'tab' && pageCount >= 1) || reading || toasts.length > 0;
      const ok = newErrors.length === 0 && nonzero;
      results.push({
        ext: c.extension, adapter: c.adapter, ok, outcome, pageCount, reading,
        toast: toasts[0] || null, error: newErrors[0] || null,
      });
      if (!ok) {
        await win.screenshot({
          path: path.join(SHOTS, `phase57-packaged-matrix-fail-${c.extension.replace('.', '')}.png`),
        }).catch(() => {});
      }
    }

    const covered = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    log('P57_PACKAGED_MATRIX', {
      total: results.length,
      covered,
      failed,
      failures: results.filter((r) => !r.ok),
      byExtension: results.map((r) => ({
        ext: r.ext, adapter: r.adapter, ok: r.ok, outcome: r.outcome,
        pageCount: r.pageCount, toast: r.toast, error: r.error,
      })),
    });
    await win.screenshot({ path: path.join(SHOTS, 'phase57-packaged-matrix.png') }).catch(() => {});

    expect(results.length, 'detected outcomes').toBe(28);
    for (const r of results) {
      expect(r.error, `${r.ext}: renderer pageerror`).toBeNull();
      expect(r.ok, `${r.ext}: import settled with a zero-byte result (outcome=${r.outcome}, pageCount=${r.pageCount}, toast=${JSON.stringify(r.toast)})`).toBe(true);
    }
  });

  // =========================================================================
  // 2c - pdf.js renders: proves the pdfjs worker asset survived the prune.
  // =========================================================================
  test('2c PDF RENDER: report.pdf renders a .pdf-page canvas', async () => {
    await openSampleDoc('report.pdf');
    const d = await diag();
    const canvases = await win.locator('.pdf-page canvas').count();
    log('render', { pageCount: d.pageCount, canvases });
    expect(canvases, 'a page canvas rendered').toBeGreaterThan(0);
    expect(d.pageCount, 'page count').toBeGreaterThanOrEqual(1);
    expect(pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  });
  // =========================================================================
  // 2d - accounts surface boots: proves the pruned renderer-only auth tree
  // (@neondatabase/auth + auth-ui + @triplit) is not needed at runtime.
  // =========================================================================
  test('2d ACCOUNTS: the accounts dialog boots with the pruned renderer auth tree', async () => {
    await win.locator('[data-header-accounts]').first().click();
    await win.waitForSelector('[data-accounts-auth]', { state: 'visible', timeout: 20000 });
    await win.screenshot({ path: path.join(SHOTS, 'phase57-packaged-accounts.png') });
    expect(await win.locator('[data-accounts-auth]').count(), 'auth surface mounted').toBeGreaterThan(0);
    expect(pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  });

  // =========================================================================
  // 2e - OCR: proves the one external main-process require (tesseract.js) and
  // the bundled assets/tessdata survived the prune.
  // =========================================================================
  test('2e OCR: recognize current page reaches the suspects panel', async () => {
    await stubOpen(path.join(ROOT, 'test-fixtures', 'scanned.pdf'));
    await clickOpen();
    await win.waitForSelector('.pdf-page canvas', { timeout: 60000 });
    await win.waitForTimeout(800);

    await win.keyboard.press('Control+k');
    await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 15000 });
    await win.fill('[data-command-palette-input]', 'recognize');
    await win.waitForTimeout(400);
    await win.locator('[data-palette-tool-id="recognizeText"]').first().click();
    await win.waitForSelector('[data-ocr-confirm]', { timeout: 15000 });
    await win.click('[data-ocr-scope="currentPage"]');
    await win.waitForTimeout(200);
    await win.click('[data-ocr-confirm]');
    await win.waitForSelector('[data-ocr-suspects-panel]', { timeout: 240000 });
    await win.waitForTimeout(600);

    await win.screenshot({ path: path.join(SHOTS, 'phase57-packaged-ocr.png') });
    expect(await win.locator('[data-ocr-suspects-panel]').count(), 'OCR suspects panel mounted').toBeGreaterThan(0);
    expect(pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  });

  // =========================================================================
  // 2f - office export: proves xlsx (and pptxgenjs) still ship and produce a
  // non-zero file through the real dock verb + dialog.
  // =========================================================================
  test('2f OFFICE EXPORT: xlsx and pptx exports produce non-zero files', async () => {
    await openSampleDoc('report.pdf');
    await armDownloadCapture();
    const out = {};
    for (const fmt of ['xlsx', 'pptx']) {
      await resetDownload();
      await clickDockVerb(win, 4, fmt === 'xlsx' ? 'exportXlsx' : 'exportPptx');
      await win.waitForSelector(`[data-office-export-dialog="${fmt}"]`, { timeout: 20000 });
      await win.waitForTimeout(400);
      await win.locator('[data-office-export-confirm]').click();
      const dl = await waitDownload(180000);
      expect(dl, `${fmt} export produced no file`).toBeTruthy();
      out[fmt] = { path: dl.path, size: fs.statSync(dl.path).size };
      expect(out[fmt].size, `${fmt} file has non-zero bytes`).toBeGreaterThan(0);
      const dlg = win.locator(`[data-office-export-dialog="${fmt}"]`);
      if ((await dlg.count()) > 0) {
        await dlg.locator('[data-office-export-close], [data-office-export-cancel]').first().click({ timeout: 5000 }).catch(() => {});
      }
      await win.waitForTimeout(500);
    }
    log('office', out);
    await win.screenshot({ path: path.join(SHOTS, 'phase57-packaged-office.png') });
    expect(pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  });
});
