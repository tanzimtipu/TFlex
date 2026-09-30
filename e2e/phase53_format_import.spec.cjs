// Phase 53 phase-gate e2e (QA). Universal file handling I: text/markup/technical
// import. Covers the phase's success criteria 1, 2, 3, 5, 7, 8, 10 and the
// CONTROL-INDEX rows 1-7. Launches ONLY through the canonical launchApp helper.
//
// The OS open dialog is native and cannot be driven by Playwright, so the
// standard repo pattern is used: `dialog.showOpenDialog` is stubbed in the main
// process to return the fixture path, then the app's real Open button is
// clicked. That exercises the app's real open -> routeOpenPath -> convert flow.
// The filters the app passes to showOpenDialog are captured on the same call so
// CONTROL-INDEX row 1 can be judged.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..', 'test-fixtures', 'phase53');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const F = {
  txt: path.join(FIX, 'sample.txt'),
  md: path.join(FIX, 'sample.md'),
  rtf: path.join(FIX, 'sample.rtf'),
  csv: path.join(FIX, 'sample.csv'),
  html: path.join(FIX, 'sample.html'),
  network: path.join(FIX, 'network.html'),
  corrupt: path.join(FIX, 'corrupt.txt'),
  zero: path.join(FIX, 'zero.txt'),
  empty: path.join(FIX, 'empty.txt'),
  unknown: path.join(FIX, 'unknown.xyz'),
  formCsv: path.join(FIX, 'form.csv'),
};

let app = null;
let win = null;
let consoleLog = [];

test.beforeEach(async () => {
  consoleLog = [];
  app = await launchApp();
  win = await app.firstWindow();
  win.on('console', (m) => consoleLog.push(`[console:${m.type()}] ${m.text()}`));
  win.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e.message}`));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'phase53');
  app = null;
  win = null;
});

test.setTimeout(300000);

async function stubOpen(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    globalThis.__p53Filters = null;
    dialog.showOpenDialog = async (opts) => {
      globalThis.__p53Filters = opts && opts.filters ? opts.filters : null;
      return { canceled: false, filePaths: [p] };
    };
  }, filePath);
}

async function lastFilters() {
  return app.evaluate(async () => globalThis.__p53Filters);
}

async function clickOpen() {
  await win.locator('[aria-label="Open PDF document"]').first().click();
}

async function diag() {
  return win.evaluate(() => window.tflexDiagnostics());
}

async function tabCount() {
  return win.locator('[data-tab-id]').count();
}

// Wait for a conversion to settle: the notice appears (success) or a renderer
// pageerror fires (failure). Bounded so a broken import fails fast.
async function waitImportOutcome(timeout = 25000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await win.locator('[data-conversion-notice]').count()) > 0) {
      return { ok: true };
    }
    const err = consoleLog.find((l) => l.startsWith('[pageerror]'));
    if (err) return { ok: false, error: err };
    await win.waitForTimeout(200);
  }
  return { ok: false, error: 'timeout waiting for conversion notice' };
}

async function openFixture(filePath, timeout = 25000) {
  await stubOpen(filePath);
  await clickOpen();
  return waitImportOutcome(timeout);
}

// ---------------------------------------------------------------------------
// Criterion 1 + CONTROL-INDEX row 1 - open each of the five formats.
// ---------------------------------------------------------------------------
test('criterion 1: .txt/.md/.rtf/.csv/.html each import into a tab', async () => {
  const cases = [
    ['txt', F.txt, 'Text document'],
    ['md', F.md, 'Markdown document'],
    ['rtf', F.rtf, 'Rich Text document'],
    ['csv', F.csv, 'CSV spreadsheet'],
    ['html', F.html, 'HTML document'],
  ];
  const results = [];
  for (const [name, file, label] of cases) {
    const outcome = await openFixture(file);
    const d = await diag();
    const notice = win.locator('[data-conversion-notice]');
    const noticeCount = await notice.count();
    let source = null;
    let fidelity = null;
    if (noticeCount > 0) {
      source = await notice.locator('[data-conversion-source]').innerText();
      fidelity = await notice.locator('[data-conversion-fidelity-label]').innerText();
    }
    await win.screenshot({ path: path.join(SHOTS, `phase53-open-${name}.png`) });
    results.push({ name, ok: outcome.ok, error: outcome.error || null, pageCount: d.pageCount, source, fidelity });
    expect(outcome.ok, `${name} import failed: ${outcome.error}`).toBe(true);
    expect(d.pageCount, `${name} pageCount`).toBeGreaterThanOrEqual(1);
    expect(source).toBe(label);
    if (noticeCount > 0) {
      await win.locator('[data-tab-id] .tab-close').first().click();
      await win.waitForTimeout(400);
    }
  }
  console.log('P53_OPEN_RESULTS ' + JSON.stringify(results));
  const filters = await lastFilters();
  console.log('P53_OPEN_FILTERS ' + JSON.stringify(filters));
});

// ---------------------------------------------------------------------------
// Criterion 2 - Markdown H1-H6 and inline styles visibly distinct.
// ---------------------------------------------------------------------------
test('criterion 2: markdown headings and styles render distinctly', async () => {
  const outcome = await openFixture(F.md);
  expect(outcome.ok, `md import failed: ${outcome.error}`).toBe(true);
  await win.waitForTimeout(800);
  await win.screenshot({ path: path.join(SHOTS, 'phase53-md-render.png') });

  // Text-extraction check through the app's own search: two heading levels.
  async function searchHits(query) {
    await win.keyboard.press('Control+f');
    await win.waitForSelector('.search-input', { timeout: 8000 });
    await win.locator('.search-input').fill(query);
    await win.waitForTimeout(1200);
    const d = await diag();
    return d.searchHits;
  }
  const h1 = await searchHits('Heading Level One');
  const h6 = await searchHits('Heading Level Six');
  console.log('P53_MD_SEARCH ' + JSON.stringify({ h1, h6 }));
  expect(h1, 'H1 text not found by search').toBeGreaterThanOrEqual(1);
  expect(h6, 'H6 text not found by search').toBeGreaterThanOrEqual(1);
});

// ---------------------------------------------------------------------------
// Criterion 5 - corrupt / zero-byte / empty / unknown each fail readably and
// leave the previously open tab intact.
// ---------------------------------------------------------------------------
test('criterion 5: bad inputs fail readably with no new tab', async () => {
  await stubOpen(getSamplePath('report.pdf'));
  await clickOpen();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
  const before = await tabCount();
  const beforeDiag = await diag();

  const cases = [
    ['corrupt', F.corrupt],
    ['zero', F.zero],
    ['empty', F.empty],
    ['unknown', F.unknown],
  ];
  const results = [];
  for (const [name, file] of cases) {
    consoleLog = [];
    await stubOpen(file);
    await clickOpen();
    await win.waitForTimeout(4500);
    const after = await tabCount();
    const toasts = await win.locator('.toast-text').allInnerTexts();
    const pageErr = consoleLog.find((l) => l.startsWith('[pageerror]')) || null;
    const d = await diag();
    const notice = win.locator('[data-conversion-notice]');
    const noticeCount = await notice.count();
    const warningCodes = noticeCount > 0
      ? await notice.locator('[data-conversion-warning]').evaluateAll((els) =>
          els.map((e) => e.getAttribute('data-conversion-warning')),
        )
      : [];
    const warningTexts = noticeCount > 0
      ? await notice.locator('[data-conversion-warning]').allInnerTexts()
      : [];
    results.push({ name, before, after, toasts, pageErr, pageCount: d.pageCount, openTabs: d.openTabs, warningCodes, warningTexts });
    await win.screenshot({ path: path.join(SHOTS, `phase53-error-${name}.png`) });
    // Clear any toast so the next case is unambiguous.
    const closers = win.locator('.toast-close');
    for (let i = await closers.count(); i > 0; i -= 1) {
      await closers.first().click().catch(() => {});
      await win.waitForTimeout(150);
    }
    // Keep the baseline stable: the ruled whitespace-only case creates a tab,
    // so close it before the next case or the tab-count assertion drifts.
    if ((await tabCount()) > before) {
      const tabClosers = win.locator('[data-tab-id] .tab-close');
      if ((await tabClosers.count()) > 0) {
        await tabClosers.last().click();
        await win.waitForTimeout(400);
      }
    }
  }
  console.log('P53_ERRORS ' + JSON.stringify(results));
  for (const r of results) {
    expect(r.pageErr, `${r.name}: unhandled renderer error`).toBeNull();
    if (r.name === 'empty') {
      // DEF-376 ruling: a whitespace-only source is NOT an error - it converts
      // WITH a partial-content warning naming the absence of visible content.
      expect(r.after, 'empty: a tab was created').toBe(before + 1);
      expect(r.warningCodes, 'empty: partial-content warning code').toContain('partial-content');
      expect(r.warningTexts.join(' ').toLowerCase(), 'empty: warning names the absence of visible content').toContain('no visible content');
    } else {
      expect(r.after, `${r.name}: a new tab was created`).toBe(before);
      expect(r.toasts.length, `${r.name}: no readable message`).toBeGreaterThan(0);
    }
  }
  const afterDiag = await diag();
  expect(afterDiag.pageCount, 'previous tab lost its pages').toBe(beforeDiag.pageCount);
});

// ---------------------------------------------------------------------------
// Criterion 7 - HTML import makes no network call; blocked resources named.
// ---------------------------------------------------------------------------
test('criterion 7: network.html converts and names the blocked resources', async () => {
  const outcome = await openFixture(F.network);
  expect(outcome.ok, `network.html import failed: ${outcome.error}`).toBe(true);
  const notice = win.locator('[data-conversion-notice]');
  const warnings = await notice.locator('[data-conversion-warning]').allInnerTexts();
  const codes = await notice.locator('[data-conversion-warning]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-conversion-warning')),
  );
  console.log('P53_NETWORK ' + JSON.stringify({ warnings, codes }));
  await win.screenshot({ path: path.join(SHOTS, 'phase53-network.png') });
  expect(codes).toContain('resource-blocked');
  expect(warnings.join(' ')).toContain('example.com');
});

// ---------------------------------------------------------------------------
// Criterion 8 - OS-open / Explorer drop of a convertible path routes into the
// same import flow. Launched with the .md path as an OS argument.
// ---------------------------------------------------------------------------
test('criterion 8: OS-open of a .md path routes into the import flow', async () => {
  // This test needs its own launch with the file argument.
  await hardClose(app, 'phase53-osopen');
  app = await launchApp([F.md]);
  win = await app.firstWindow();
  win.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e.message}`));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const outcome = await waitImportOutcome(25000);
  const d = await diag();
  console.log('P53_OSOPEN ' + JSON.stringify({ ok: outcome.ok, error: outcome.error || null, pageCount: d.pageCount }));
  await win.screenshot({ path: path.join(SHOTS, 'phase53-osopen.png') });
  expect(outcome.ok, `OS-open import failed: ${outcome.error}`).toBe(true);
  expect(d.pageCount).toBeGreaterThanOrEqual(1);
});

// ---------------------------------------------------------------------------
// Criterion 10 - a very long import keeps the renderer interactive.
// ---------------------------------------------------------------------------
test('criterion 10: long import keeps the UI responsive', async () => {
  const longPath = path.join(os.tmpdir(), `tflex-p53-long-${Date.now()}.md`);
  const lines = [];
  for (let i = 0; i < 20000; i += 1) {
    lines.push(`Paragraph ${i} with some words to fill the line and force wrapping across the page width.`);
  }
  fs.writeFileSync(longPath, `# Long Document\n\n${lines.join('\n\n')}\n`, 'utf8');

  await stubOpen(longPath);
  const t0 = Date.now();
  await clickOpen();
  // Wait for the progress affordance, then interact while it converts.
  await win.waitForSelector('[data-conversion-progress]', { timeout: 15000 }).catch(() => {});
  const latencies = [];
  for (let i = 0; i < 6; i += 1) {
    const t = Date.now();
    await win.locator('[data-open-preferences]').first().click({ timeout: 5000 }).catch(() => {});
    latencies.push(Date.now() - t);
    await win.keyboard.press('Escape').catch(() => {});
    await win.waitForTimeout(150);
  }
  const outcome = await waitImportOutcome(120000);
  const duration = Date.now() - t0;
  console.log('P53_LONG ' + JSON.stringify({ duration, latencies, ok: outcome.ok, error: outcome.error || null }));
  await win.screenshot({ path: path.join(SHOTS, 'phase53-long.png') });
  expect(outcome.ok, `long import failed: ${outcome.error}`).toBe(true);
  expect(Math.max(...latencies), 'UI interaction stalled during import').toBeLessThan(2000);
});

// ---------------------------------------------------------------------------
// Criterion 3 (Chromium half) - 50,000-row CSV wall clock end to end.
// ---------------------------------------------------------------------------
test('criterion 3: 50,000-row CSV import wall clock', async () => {
  const csvPath = path.join(os.tmpdir(), `tflex-p53-50k-${Date.now()}.csv`);
  const rows = ['id,name,value'];
  for (let i = 0; i < 50000; i += 1) rows.push(`${i},name ${i},${i * 3}`);
  fs.writeFileSync(csvPath, rows.join('\n') + '\n', 'utf8');

  await stubOpen(csvPath);
  const t0 = Date.now();
  await clickOpen();
  const outcome = await waitImportOutcome(180000);
  const duration = Date.now() - t0;
  const d = await diag();
  console.log('P53_50K ' + JSON.stringify({ duration, ok: outcome.ok, error: outcome.error || null, pageCount: d.pageCount }));
  await win.screenshot({ path: path.join(SHOTS, 'phase53-50k.png') });
  expect(outcome.ok, `50k CSV import failed: ${outcome.error}`).toBe(true);
  expect(d.pageCount).toBeGreaterThanOrEqual(1);
});

// ---------------------------------------------------------------------------
// CONTROL-INDEX row 2 - the fillFromCsv verb: enabled with fields, disabled
// with a reason without them.
// ---------------------------------------------------------------------------
test('row 2: fillFromCsv verb enabled/disabled states', async () => {
  // No form fields -> disabled with a reason.
  await stubOpen(getSamplePath('report.pdf'));
  await clickOpen();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
  await win.keyboard.press('Control+3');
  await win.waitForTimeout(600);
  const verb = win.locator('[data-dock-verb="fillFromCsv"]');
  await expect(verb).toHaveCount(1);
  const disabledNoFields = await verb.first().isDisabled();
  const reasonNoFields = await verb.first().getAttribute('title');
  await win.screenshot({ path: path.join(SHOTS, 'phase53-verb-disabled.png') });

  // With form fields -> enabled.
  await stubOpen(getSamplePath('form.pdf'));
  await clickOpen();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);
  await win.keyboard.press('Control+3');
  await win.waitForTimeout(600);
  const verb2 = win.locator('[data-dock-verb="fillFromCsv"]');
  const disabledWithFields = await verb2.first().isDisabled();
  await win.screenshot({ path: path.join(SHOTS, 'phase53-verb-enabled.png') });

  console.log('P53_VERB ' + JSON.stringify({ disabledNoFields, reasonNoFields, disabledWithFields }));
  expect(disabledNoFields, 'verb should be disabled without form fields').toBe(true);
  expect(reasonNoFields && reasonNoFields.length, 'disabled verb needs a reason').toBeGreaterThan(0);
  expect(disabledWithFields, 'verb should be enabled with form fields').toBe(false);
});

// ---------------------------------------------------------------------------
// CONTROL-INDEX rows 3-4 - pick a CSV, fill, and verify the SAVED file with a
// parser (not our UI).
// ---------------------------------------------------------------------------
test('rows 3-4: CSV fill end to end, saved file parsed', async () => {
  const formPath = getSamplePath('form.pdf');
  await stubOpen(formPath);
  await clickOpen();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);
  await win.keyboard.press('Control+3');
  await win.waitForTimeout(600);
  await win.locator('[data-dock-verb="fillFromCsv"]').first().click();
  await win.waitForSelector('[data-fill-csv-dialog]', { timeout: 8000 });

  // Row 3 - pick shows the chosen file name.
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, F.formCsv);
  await win.locator('[data-fill-csv-pick]').click();
  await win.waitForTimeout(600);
  const picked = await win.locator('[data-fill-csv-file]').innerText();
  expect(picked).toContain('form.csv');

  // Row 4 - confirm fills and reports.
  await win.locator('[data-fill-csv-confirm]').click();
  await win.waitForSelector('[data-fill-csv-result]', { timeout: 15000 });
  const filled = await win.locator('[data-fill-csv-filled]').innerText();
  const matched = await win.locator('[data-testid="fill-csv-matched-item"]').allInnerTexts();
  const unmatched = await win.locator('[data-testid="fill-csv-unmatched-item"]').allInnerTexts();
  const missing = await win.locator('[data-testid="fill-csv-missing-item"]').allInnerTexts();
  await win.screenshot({ path: path.join(SHOTS, 'phase53-csvfill.png') });
  console.log('P53_CSVFILL ' + JSON.stringify({ picked, filled, matched, unmatched, missing }));
  expect(filled).toContain('3');
  expect(matched).toEqual(expect.arrayContaining(['applicant_name', 'applicant_address', 'application_date']));
  expect(unmatched).toContain('unknown_header');
  expect(missing).toEqual(expect.arrayContaining(['terms_agreed', 'skills']));

  // Close the dialog, save in place, then parse the saved file.
  await win.locator('[data-fill-csv-done]').click();
  await win.waitForTimeout(400);
  await win.locator('[aria-label="Save"]').first().click();
  await win.waitForTimeout(2500);

  const { PDFDocument } = require('@cantoo/pdf-lib');
  const bytes = fs.readFileSync(formPath);
  const reparsed = await PDFDocument.load(bytes);
  const form = reparsed.getForm();
  const values = {
    applicant_name: form.getTextField('applicant_name').getText(),
    applicant_address: form.getTextField('applicant_address').getText(),
    application_date: form.getTextField('application_date').getText(),
  };
  console.log('P53_CSVFILL_SAVED ' + JSON.stringify(values));
  expect(values.applicant_name).toBe('Ada Lovelace');
  expect(values.applicant_address).toBe('12 Analytical Engine Way');
  expect(values.application_date).toBe('2026-09-29');
});

// ---------------------------------------------------------------------------
// CONTROL-INDEX row 5 - progress while converting; cancel aborts quietly.
// ---------------------------------------------------------------------------
test('row 5: conversion progress shows and cancel aborts quietly', async () => {
  const bigPath = path.join(os.tmpdir(), `tflex-p53-cancel-${Date.now()}.md`);
  const lines = [];
  for (let i = 0; i < 60000; i += 1) lines.push(`Line ${i} of a deliberately large markdown document for cancel.`);
  fs.writeFileSync(bigPath, `# Big\n\n${lines.join('\n\n')}\n`, 'utf8');

  await stubOpen(bigPath);
  await clickOpen();
  const progress = win.locator('[data-conversion-progress]');
  await progress.waitFor({ state: 'visible', timeout: 15000 });
  const phase = await win.locator('[data-conversion-phase]').innerText().catch(() => '');
  await win.screenshot({ path: path.join(SHOTS, 'phase53-progress.png') });
  await win.locator('[data-conversion-cancel]').click();
  // The offscreen print does not observe the abort signal mid-print, so the
  // cancel settles only after the current print finishes. Wait for it.
  await win.waitForSelector('[data-conversion-progress]', { state: 'detached', timeout: 90000 }).catch(() => {});
  await win.waitForTimeout(1000);
  const tabs = await tabCount();
  const toasts = await win.locator('.toast-text').allInnerTexts();
  const progressGone = (await win.locator('[data-conversion-progress]').count()) === 0;
  console.log('P53_CANCEL ' + JSON.stringify({ phase, tabs, toasts, progressGone }));
  expect(tabs, 'cancel created a tab').toBe(0);
  expect(toasts.join(' ').toLowerCase()).not.toContain('cancel');
  expect(progressGone, 'progress affordance did not clear').toBe(true);
});

// ---------------------------------------------------------------------------
// CONTROL-INDEX row 6 - the conversion notice shows source/fidelity/warnings
// and collapses for the tab.
// ---------------------------------------------------------------------------
test('row 6: conversion notice shows and collapses', async () => {
  const outcome = await openFixture(F.network);
  expect(outcome.ok, `network.html import failed: ${outcome.error}`).toBe(true);
  const notice = win.locator('[data-conversion-notice]');
  const source = await notice.locator('[data-conversion-source]').innerText();
  const fidelity = await notice.locator('[data-conversion-fidelity-label]').innerText();
  const warningCount = await notice.locator('[data-conversion-warning]').count();
  await win.screenshot({ path: path.join(SHOTS, 'phase53-notice.png') });
  await win.locator('[data-conversion-collapse]').click();
  await win.waitForTimeout(500);
  expect(await win.locator('[data-conversion-icon]').count(), 'collapsed icon missing').toBe(1);
  const afterDismiss = await win.locator('[data-conversion-notice]').count();
  console.log('P53_NOTICE ' + JSON.stringify({ source, fidelity, warningCount, afterDismiss }));
  expect(source).toBe('HTML document');
  expect(fidelity.length).toBeGreaterThan(0);
  expect(warningCount).toBeGreaterThan(0);
  expect(afterDismiss, 'notice returned after dismiss').toBe(0);
});

// ---------------------------------------------------------------------------
// CONTROL-INDEX row 7 - convert preferences persist across a restart, and the
// numeric fields clamp to 5-50 mm / 6-48 pt.
// ---------------------------------------------------------------------------
test('row 7: convert preferences persist across a restart and clamp', async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p53-prefs-'));
  await hardClose(app, 'phase53-prefs');
  app = await launchApp([], userData);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.locator('[data-open-preferences]').first().click();
  await win.locator('[data-prefs-category="import"]').click();
  await win.waitForSelector('[data-prefs-convert-section]', { timeout: 8000 });

  await win.locator('[data-prefs-convert-page-size]').selectOption('letter');
  await win.locator('[data-prefs-convert-margin]').fill('30');
  await win.locator('[data-prefs-convert-margin]').blur();
  await win.locator('[data-prefs-convert-font-size]').fill('20');
  await win.locator('[data-prefs-convert-font-size]').blur();
  await win.locator('[data-prefs-convert-delimiter]').selectOption(';');
  await win.locator('[data-prefs-convert-csv-mapping]').uncheck();
  await win.locator('[data-prefs-convert-html-backgrounds]').uncheck();
  await win.waitForTimeout(900);

  // Clamp checks: 100 mm -> 50, 100 pt -> 48.
  await win.locator('[data-prefs-convert-margin]').fill('100');
  await win.locator('[data-prefs-convert-margin]').blur();
  await win.locator('[data-prefs-convert-font-size]').fill('100');
  await win.locator('[data-prefs-convert-font-size]').blur();
  await win.waitForTimeout(600);
  const clampedMargin = await win.locator('[data-prefs-convert-margin]').inputValue();
  const clampedFont = await win.locator('[data-prefs-convert-font-size]').inputValue();
  // Restore the persisted values we want to check.
  await win.locator('[data-prefs-convert-margin]').fill('30');
  await win.locator('[data-prefs-convert-margin]').blur();
  await win.locator('[data-prefs-convert-font-size]').fill('20');
  await win.locator('[data-prefs-convert-font-size]').blur();
  await win.waitForTimeout(900);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(600);

  await hardClose(app, 'phase53-prefs');
  app = await launchApp([], userData);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.locator('[data-open-preferences]').first().click();
  await win.locator('[data-prefs-category="import"]').click();
  await win.waitForSelector('[data-prefs-convert-section]', { timeout: 8000 });
  const persisted = {
    pageSize: await win.locator('[data-prefs-convert-page-size]').inputValue(),
    margin: await win.locator('[data-prefs-convert-margin]').inputValue(),
    fontSize: await win.locator('[data-prefs-convert-font-size]').inputValue(),
    delimiter: await win.locator('[data-prefs-convert-delimiter]').inputValue(),
    csvMapping: await win.locator('[data-prefs-convert-csv-mapping]').isChecked(),
    htmlBackgrounds: await win.locator('[data-prefs-convert-html-backgrounds]').isChecked(),
  };
  await win.screenshot({ path: path.join(SHOTS, 'phase53-prefs.png') });
  console.log('P53_PREFS ' + JSON.stringify({ clampedMargin, clampedFont, persisted }));
  expect(clampedMargin).toBe('50');
  expect(clampedFont).toBe('48');
  expect(persisted.pageSize).toBe('letter');
  expect(persisted.margin).toBe('30');
  expect(persisted.fontSize).toBe('20');
  expect(persisted.delimiter).toBe(';');
  expect(persisted.csvMapping).toBe(false);
  expect(persisted.htmlBackgrounds).toBe(false);
});
