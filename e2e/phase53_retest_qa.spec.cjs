// Phase 53 gate RETEST (QA) — DEF-374 / DEF-375 FIX-READY retests, the
// criterion-5 whitespace ruling, the other-adapter whitespace consistency
// check, the ProtectionNotice latent-overlap probe (DEF-357 class) and the
// DEF-372 session-password retest. Launches ONLY through the canonical
// e2e/lib/launch.cjs launchApp helper. Raw [P53R ...] lines are the evidence.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, runTool, toggleMultiModeViaPalette } = require('./lib/helpers.cjs');
const { makeEncryptedFixture } = require('./lib/p52_crypto.cjs');

const FIX = path.resolve(__dirname, '..', 'test-fixtures', 'phase53');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const F = {
  txt: path.join(FIX, 'sample.txt'),
  md: path.join(FIX, 'sample.md'),
  rtf: path.join(FIX, 'sample.rtf'),
  csv: path.join(FIX, 'sample.csv'),
  html: path.join(FIX, 'sample.html'),
  empty: path.join(FIX, 'empty.txt'),
};

let app = null;
let win = null;
let pageErrors = [];

test.setTimeout(300000);

test.beforeEach(async () => {
  pageErrors = [];
  app = await launchApp();
  win = await app.firstWindow();
  win.on('pageerror', (e) => pageErrors.push(e.message));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p53r');
  app = null;
  win = null;
});

// Stub the native picker and record the filters the app passed on the call.
async function stubOpen(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    globalThis.__qaFilters = null;
    dialog.showOpenDialog = async (opts) => {
      globalThis.__qaFilters = opts && opts.filters ? opts.filters : null;
      return { canceled: false, filePaths: [p] };
    };
  }, filePath);
}
async function lastFilters() {
  return app.evaluate(async () => globalThis.__qaFilters);
}
async function clickToolbarOpen() {
  await win.locator('[data-toolbar-open]').first().click();
}
async function diag() {
  return win.evaluate(() => window.tflexDiagnostics());
}
async function tabCount() {
  return win.locator('[data-tab-id]').count();
}
async function waitNotice(timeout = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await win.locator('[data-conversion-notice]').count()) > 0) return true;
    if (pageErrors.length > 0) return false;
    await win.waitForTimeout(200);
  }
  return false;
}

// ---------------------------------------------------------------------------
// DEF-374 — every Phase 53 non-PDF import creates a tab with a conversion
// notice and no renderer pageerror. Screenshots for two of the five.
// ---------------------------------------------------------------------------
test('DEF-374: all five formats import into a tab with a notice, no pageerror', async () => {
  const cases = [
    ['txt', F.txt, 'Text document'],
    ['md', F.md, 'Markdown document'],
    ['rtf', F.rtf, 'Rich Text document'],
    ['csv', F.csv, 'CSV spreadsheet'],
    ['html', F.html, 'HTML document'],
  ];
  const results = [];
  for (const [name, file, label] of cases) {
    pageErrors = [];
    await stubOpen(file);
    await clickToolbarOpen();
    const ok = await waitNotice();
    const d = await diag();
    const notice = win.locator('[data-conversion-notice]');
    const noticeCount = await notice.count();
    const source = noticeCount > 0 ? await notice.locator('[data-conversion-source]').innerText() : null;
    results.push({ name, ok, pageErrors: [...pageErrors], pageCount: d.pageCount, source });
    if (name === 'txt' || name === 'html') {
      await win.screenshot({ path: path.join(SHOTS, `phase53-retest-def374-${name}.png`) });
    }
    expect(ok, `${name}: no conversion notice (pageErrors=${JSON.stringify(pageErrors)})`).toBe(true);
    expect(pageErrors, `${name}: renderer pageerror`).toEqual([]);
    expect(d.pageCount, `${name}: pageCount`).toBeGreaterThanOrEqual(1);
    expect(source, `${name}: source label`).toBe(label);
    const closers = win.locator('[data-tab-id] .tab-close');
    if ((await closers.count()) > 0) {
      await closers.first().click();
      await win.waitForTimeout(400);
    }
  }
  console.log('P53R_DEF374 ' + JSON.stringify(results));
});

// ---------------------------------------------------------------------------
// DEF-375 � the generic Open call sites pass the grouped 'document' filters;
// the PDF-only pickers (merge, insert-from-PDF, FDF) keep their narrow filters.
// ---------------------------------------------------------------------------
test('DEF-375: primary + empty-pane Open get grouped filters; PDF-only pickers stay narrow', async () => {
  // Primary title-bar Open.
  await stubOpen(getSamplePath('report.pdf'));
  await clickToolbarOpen();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1000);
  const primaryFilters = await lastFilters();

  // Merge picker (PDF-only, deliberately unchanged).
  await stubOpen(getSamplePath('report.pdf'));
  await runTool(win, 'merge');
  await win.waitForSelector('[data-merge-pick]', { state: 'visible', timeout: 10000 });
  await win.locator('[data-merge-pick]').click();
  await win.waitForTimeout(1200);
  const mergeFilters = await lastFilters();
  await win.keyboard.press('Escape');
  await win.waitForTimeout(500);

  // Insert-from-PDF picker (PDF-only, deliberately unchanged).
  await stubOpen(getSamplePath('report.pdf'));
  await runTool(win, 'insertPages');
  await win.waitForSelector('[data-insert-pages-dialog]', { state: 'visible', timeout: 10000 });
  await win.locator('[data-insert-mode="fromPdf"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-insert-pick]').click();
  await win.waitForTimeout(1200);
  const insertFilters = await lastFilters();
  await win.keyboard.press('Escape');
  await win.waitForTimeout(500);

  // FDF import picker (FDF-only, deliberately unchanged).
  await stubOpen(getSamplePath('report.pdf'));
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-command-palette-input]').fill('Import comments');
  await win.waitForTimeout(400);
  await win.locator('.command-palette-row').filter({ hasText: 'Import comments' }).first().click();
  await win.waitForSelector('[data-comment-import-dialog]', { state: 'visible', timeout: 10000 });
  await win.locator('[data-comment-import-confirm]').click();
  await win.waitForTimeout(1200);
  const fdfFilters = await lastFilters();

  // Empty-pane Open (Multi Mode, one document -> pane B empty).
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1000);
  await stubOpen(getSamplePath('long.pdf'));
  await win.locator('[data-pane-open]').first().click();
  await win.waitForTimeout(2500);
  const paneFilters = await lastFilters();

  console.log('P53R_DEF375 ' + JSON.stringify({ primaryFilters, paneFilters, mergeFilters, insertFilters, fdfFilters }));

  const names = (f) => (f || []).map((x) => x.name);
  expect(names(primaryFilters), 'primary Open grouped filter names').toEqual([
    'Documents', 'Text and markup', 'Spreadsheets', 'All supported files',
  ]);
  expect(names(paneFilters), 'empty-pane Open grouped filter names').toEqual([
    'Documents', 'Text and markup', 'Spreadsheets', 'All supported files',
  ]);
  expect(primaryFilters, 'primary Open advertises the convertible extensions').toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'Documents', extensions: expect.arrayContaining(['pdf', 'rtf']) }),
      expect.objectContaining({ name: 'Text and markup', extensions: expect.arrayContaining(['txt', 'md', 'html']) }),
      expect.objectContaining({ name: 'Spreadsheets', extensions: expect.arrayContaining(['csv']) }),
    ]),
  );
  expect(mergeFilters, 'merge picker stays PDF-only').toEqual([{ name: 'PDF', extensions: ['pdf'] }]);
  expect(insertFilters, 'insert-from-PDF picker stays PDF-only').toEqual([{ name: 'PDF', extensions: ['pdf'] }]);
  expect(fdfFilters, 'FDF picker stays FDF-only').toEqual([{ name: 'FDF', extensions: ['fdf'] }]);
});

// ---------------------------------------------------------------------------
// Criterion 5 (ruler's decision) � a whitespace-only .txt is NOT an error: it
// converts WITH a partial-content warning naming the absence of visible content.
// ---------------------------------------------------------------------------
test('criterion 5 whitespace: empty.txt converts with a partial-content warning', async () => {
  await stubOpen(F.empty);
  await clickToolbarOpen();
  const ok = await waitNotice();
  const d = await diag();
  const notice = win.locator('[data-conversion-notice]');
  const codes = await notice.locator('[data-conversion-warning]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-conversion-warning')),
  );
  const warnings = await notice.locator('[data-conversion-warning]').allInnerTexts();
  await win.screenshot({ path: path.join(SHOTS, 'phase53-retest-whitespace-txt.png') });
  console.log('P53R_WS_TXT ' + JSON.stringify({ ok, pageCount: d.pageCount, codes, warnings }));
  expect(ok, 'whitespace .txt produced no conversion notice').toBe(true);
  expect(d.pageCount, 'whitespace .txt pageCount').toBeGreaterThanOrEqual(1);
  expect(codes, 'partial-content warning code').toContain('partial-content');
  expect(warnings.join(' ').toLowerCase(), 'warning names the absence of visible content').toContain('no visible content');
});

// ---------------------------------------------------------------------------
// The other adapters' whitespace consistency (backend-dev named .md/.rtf/.html
// as not-yet-consistent). Judge against the criterion-5 spirit.
// ---------------------------------------------------------------------------
test('whitespace consistency: .md/.rtf/.html whitespace-only sources', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p53r-ws-'));
  const files = {
    md: path.join(dir, 'blank.md'),
    rtf: path.join(dir, 'blank.rtf'),
    html: path.join(dir, 'blank.html'),
  };
  fs.writeFileSync(files.md, '   \n\n\t\n', 'utf8');
  fs.writeFileSync(files.rtf, '{\\rtf1   \n\n}\n', 'utf8');
  fs.writeFileSync(files.html, '<html><body>   \n\n</body></html>', 'utf8');

  const results = [];
  for (const [name, file] of Object.entries(files)) {
    pageErrors = [];
    await stubOpen(file);
    await clickToolbarOpen();
    const ok = await waitNotice();
    const notice = win.locator('[data-conversion-notice]');
    const codes = ok
      ? await notice.locator('[data-conversion-warning]').evaluateAll((els) =>
          els.map((e) => e.getAttribute('data-conversion-warning')),
        )
      : [];
    const d = await diag();
    results.push({ name, ok, pageErrors: [...pageErrors], pageCount: d.pageCount, codes });
    const closers = win.locator('[data-tab-id] .tab-close');
    if ((await closers.count()) > 0) {
      await closers.first().click();
      await win.waitForTimeout(400);
    }
  }
  console.log('P53R_WS_OTHERS ' + JSON.stringify(results));
  // Report only; the defect decision is made from the evidence, not asserted here.
  expect(results.every((r) => r.ok), 'each whitespace source still converts').toBe(true);
});

// ---------------------------------------------------------------------------
// DEF-376 boundary - an image-only .md / .html renders content and must NOT
// carry the empty-content `partial-content` warning (the honest boundary the
// developer named). A blocked remote image may still warn `resource-blocked`.
// ---------------------------------------------------------------------------
test('DEF-376 boundary: image-only .md/.html do not warn partial-content', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p53r-img-'));
  const files = {
    md: path.join(dir, 'image-only.md'),
    html: path.join(dir, 'image-only.html'),
  };
  fs.writeFileSync(files.md, '![a picture](picture.png)\n', 'utf8');
  fs.writeFileSync(files.html, '<html><body><img src="picture.png" alt="a picture"></body></html>', 'utf8');

  const results = [];
  for (const [name, file] of Object.entries(files)) {
    pageErrors = [];
    await stubOpen(file);
    await clickToolbarOpen();
    const ok = await waitNotice();
    const notice = win.locator('[data-conversion-notice]');
    const codes = ok
      ? await notice.locator('[data-conversion-warning]').evaluateAll((els) =>
          els.map((e) => e.getAttribute('data-conversion-warning')),
        )
      : [];
    const d = await diag();
    results.push({ name, ok, pageErrors: [...pageErrors], pageCount: d.pageCount, codes });
    const closers = win.locator('[data-tab-id] .tab-close');
    if ((await closers.count()) > 0) {
      await closers.first().click();
      await win.waitForTimeout(400);
    }
  }
  console.log('P53R_WS_IMAGE ' + JSON.stringify(results));
  expect(results.every((r) => r.ok), 'each image-only source still converts').toBe(true);
  for (const r of results) {
    expect(r.codes, `${r.name}: image-only must not warn partial-content`).not.toContain('partial-content');
  }
});

// ---------------------------------------------------------------------------
// ProtectionNotice latent overlap (DEF-357 class) � hit-test the banner's
// dismiss button with the Inspector open.
// ---------------------------------------------------------------------------
test('ProtectionNotice: dismiss button hit-test with the Inspector open', async () => {
  const fixture = await makeEncryptedFixture({
    name: 'p53r-protect.pdf',
    algorithm: 'AES-256',
    userPassword: 'P53R-Protect!',
  });
  await stubOpen(fixture);
  await clickToolbarOpen();
  await win.waitForSelector('[data-password-prompt]', { timeout: 20000 });
  await win.locator('[data-password-input]').fill('P53R-Protect!');
  await win.locator('[data-password-submit]').click();
  await win.waitForSelector('[data-password-prompt]', { state: 'detached', timeout: 30000 });
  await win.waitForSelector('[data-protection-notice]', { timeout: 15000 });
  await win.waitForTimeout(800);

  const hit = await win.evaluate(() => {
    const btn = document.querySelector('[data-protection-dismiss]');
    if (!btn) return { found: false };
    const r = btn.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const el = document.elementFromPoint(cx, cy);
    return {
      found: true,
      rect: { left: +r.left.toFixed(1), top: +r.top.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1) },
      hitTag: el ? el.tagName : null,
      hitClass: el ? String(el.className) : null,
      hitIsButton: el === btn,
      hitInsideButton: el ? btn.contains(el) : false,
      hitInsideInspector: el ? !!el.closest('.inspector') : false,
      inspectorOpen: document.querySelector('.app-main')?.getAttribute('data-tools-open') ?? null,
    };
  });
  await win.screenshot({ path: path.join(SHOTS, 'phase53-retest-protection-hittest.png') });

  let clickOk = true;
  let clickError = null;
  try {
    await win.locator('[data-protection-dismiss]').click({ timeout: 3000 });
  } catch (e) {
    clickOk = false;
    clickError = e.message.split('\n')[0];
  }
  await win.waitForTimeout(600);
  const afterCount = await win.locator('[data-protection-notice]').count();
  console.log('P53R_PROTECT ' + JSON.stringify({ hit, clickOk, clickError, afterCount }));
  expect(hit.found, 'the protection dismiss button rendered').toBe(true);
  expect(clickOk, `the dismiss click was intercepted: ${clickError}`).toBe(true);
  expect(afterCount, 'the banner dismissed').toBe(0);
});

// ---------------------------------------------------------------------------
// DEF-372 � re-opening the same encrypted file in a session must not re-prompt.
// ---------------------------------------------------------------------------
test('DEF-372: a second open of the same encrypted file does not re-prompt', async () => {
  const fixture = await makeEncryptedFixture({
    name: 'p53r-def372.pdf',
    algorithm: 'AES-256',
    userPassword: 'P53R-Def372!',
  });
  await stubOpen(fixture);
  await clickToolbarOpen();
  await win.waitForSelector('[data-password-prompt]', { timeout: 20000 });
  await win.locator('[data-password-input]').fill('P53R-Def372!');
  await win.locator('[data-password-submit]').click();
  await win.waitForSelector('[data-password-prompt]', { state: 'detached', timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(800);
  const first = await diag();

  // Second open of the SAME path through the real Open dialog.
  await stubOpen(fixture);
  await clickToolbarOpen();
  await win.waitForTimeout(3000);
  const second = await win.evaluate(() => ({
    promptOpen: document.querySelector('[data-password-prompt]') !== null,
    openTabs: window.tflexDiagnostics().openTabs,
  }));
  await win.screenshot({ path: path.join(SHOTS, 'phase53-retest-def372.png') });
  console.log('P53R_DEF372 ' + JSON.stringify({ firstTabs: first.openTabs, second }));
  expect(second.promptOpen, 'the second open re-prompted for the password').toBe(false);
});
