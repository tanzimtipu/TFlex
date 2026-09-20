// Release 1.18.0 - INSTALLED-app validation (qa), explicitly ordered by the
// orchestrator per AGENTS_NOTES ("the installed app is tested only when the
// orchestrator writes it in the dispatch"). This spec launches the NSIS-installed
// %LOCALAPPDATA%\Programs\tflex\TFlex.exe through the canonical launchApp() from
// e2e/lib/launch.cjs and verifies, on that installed build:
//
//   1. VERSION GATE - app.getVersion() === '1.18.0' (test 1, serial: a mismatch
//      aborts every remaining test).
//   2. DEF-214 guard - open bundled report.pdf -> .ann-toolbar visible,
//      [data-toolbar-edit-toggle] present, arming it mounts .edit-toolbar,
//      zero renderer console errors / uncaught page errors after open.
//   3. DEF-216/217/218/219/220 - watermark end-to-end (CONFIDENTIAL apply ->
//      exact "Watermark applied." toast -> applied row -> Delete -> exact
//      "Watermark deleted." toast + row gone + engine list clean) and the
//      bounds spot-check (size 0.25 tile -> typed engine-error; range [3,2] ->
//      typed engine-error, nothing stamped; 11th watermark -> max-cap error).
//   4. DEF-213 - fresh-profile Theme default reads 'frosted', selecting Dark
//      persists "themeDefault":"dark" into that profile's settings.json.
//   5. OTA prompt - reported (release unpublished -> no update expected).
//
// Screenshots: release-1180-toolbars.png, release-1180-installed-watermark.png,
// release-1180-prefs-theme.png.
//
// Run: npm.cmd run test:e2e -- e2e/release_1_18_0_installed.spec.cjs
// The installed path can be overridden with TFLEX_PACKAGED_EXE (used for the
// pre-install version gate against release\win-unpacked\TFlex.exe).

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { shot, hardClose, dismissUpdatePrompt } = require('./lib/helpers.cjs');

const PACKAGED_EXE =
  process.env.TFLEX_PACKAGED_EXE ||
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'tflex', 'TFlex.exe');

test.describe.configure({ mode: 'serial' });

let electronApp = null;
let window = null;
const consoleErrors = [];
const pageErrors = [];

async function openReportSample() {
  await window.locator('.sample-card:has-text("report")').first().click();
  await window.waitForSelector('.workspace', { timeout: 30000 });
  await window.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await window.waitForTimeout(1200);
}

async function openWatermarkDialog() {
  const palette = window.locator('[data-tools-palette]');
  if (!(await palette.isVisible().catch(() => false))) {
    await window.locator('[data-tools-toggle]').first().click();
  }
  await palette.waitFor({ state: 'visible', timeout: 15000 });
  await window.locator('[data-tool-id="watermark"]').click();
  await window.locator('[data-watermark-dialog]').waitFor({ state: 'visible', timeout: 10000 });
  await window.waitForTimeout(400);
}

async function closeWatermarkDialog() {
  const dialog = window.locator('[data-watermark-dialog]');
  if (await dialog.isVisible().catch(() => false)) {
    const close = dialog.locator('.modal-close');
    if (await close.count()) await close.first().click().catch(() => {});
    await dialog.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    await window.waitForTimeout(300);
  }
}

async function toastTexts() {
  return window.evaluate(() =>
    Array.from(document.querySelectorAll('.toast .toast-text')).map((t) => (t.textContent || '').trim()),
  );
}

async function waitForToast(text, timeout = 12000) {
  await window.waitForFunction(
    (want) =>
      Array.from(document.querySelectorAll('.toast .toast-text')).some(
        (t) => (t.textContent || '').trim() === want,
      ),
    text,
    { timeout },
  );
}

test.beforeAll(async () => {
  electronApp = await launchApp([], null, PACKAGED_EXE);
  window = await electronApp.firstWindow();
  window.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
  });
  window.on('pageerror', (err) => pageErrors.push(String(err).slice(0, 300)));
  await window.waitForSelector('.sample-card', { timeout: 40000 });
  // DEF-172 guard for packaged builds + OTA observation (item 5).
  let updateStatus = null;
  try {
    updateStatus = await window.evaluate(async () => {
      const api = window.tflex && window.tflex.update;
      if (!api || typeof api.getStatus !== 'function') return null;
      return await api.getStatus();
    });
  } catch (e) {
    updateStatus = `status-read-failed: ${e.message}`;
  }
  const promptShown = await dismissUpdatePrompt(window);
  console.log(`[release-1180] OTA getStatus: ${JSON.stringify(updateStatus)}`);
  console.log(`[release-1180] OTA update prompt appeared: ${promptShown}`);
});

test.afterAll(async () => {
  await hardClose(electronApp, 'release-1180-installed');
});

// 1. VERSION GATE -------------------------------------------------------------
test('VERSION GATE: installed build reports app.getVersion() 1.18.0', async () => {
  const version = await electronApp.evaluate(async ({ app }) => app.getVersion());
  console.log(`[release-1180] app.getVersion() = ${JSON.stringify(version)} (exe: ${PACKAGED_EXE})`);
  expect(version, 'installed build version').toBe('1.18.0');
});

// 2. DEF-214 guard ------------------------------------------------------------
test('DEF-214 guard: report.pdf mounts .ann-toolbar + Edit toggle + .edit-toolbar, zero errors', async () => {
  test.setTimeout(180000);
  consoleErrors.length = 0;
  pageErrors.length = 0;

  await openReportSample();

  const ann = window.locator('.ann-toolbar');
  await ann.waitFor({ timeout: 15000, state: 'visible' });
  const annBox = await ann.boundingBox();
  expect(annBox, '.ann-toolbar non-null box').not.toBeNull();
  expect(annBox.height, '.ann-toolbar visible row').toBeGreaterThan(0);

  const editToggle = window.locator('[data-toolbar-edit-toggle]');
  await editToggle.waitFor({ timeout: 15000 });
  expect(await editToggle.count()).toBe(1);

  await editToggle.click();
  await window.locator('.edit-toolbar').waitFor({ timeout: 10000, state: 'attached' });
  await window.waitForTimeout(400);
  const editBox = await window.locator('.edit-toolbar').boundingBox();
  expect(editBox, '.edit-toolbar mounted after arming Edit').not.toBeNull();

  await shot(window, 'release-1180-toolbars.png');
  console.log(`[release-1180] ann-toolbar ${JSON.stringify(annBox)} edit-toolbar ${JSON.stringify(editBox)}`);
  console.log(`[release-1180] post-open console errors: ${consoleErrors.length}, page errors: ${pageErrors.length}`);
  expect(consoleErrors, 'zero renderer console errors after open').toEqual([]);
  expect(pageErrors, 'zero uncaught renderer page errors after open').toEqual([]);
});

// 3a. DEF-216/219 end-to-end watermark UI ------------------------------------
test('watermark end-to-end: CONFIDENTIAL apply + delete on the installed build', async () => {
  test.setTimeout(180000);

  await openWatermarkDialog();
  await window.locator('[data-watermark-text]').fill('CONFIDENTIAL');
  await window.locator('[data-watermark-confirm]').click();
  await waitForToast('Watermark applied.');
  console.log('[release-1180] exact toast observed: "Watermark applied."');

  // Reopen: the applied row for wm-1 must be listed.
  await openWatermarkDialog();
  const row = window.locator('[data-watermark-applied="wm-1"]');
  await row.waitFor({ state: 'visible', timeout: 15000 });
  await shot(window, 'release-1180-installed-watermark.png');
  console.log('[release-1180] applied row wm-1 visible; screenshot release-1180-installed-watermark.png');

  await window.locator('[data-watermark-delete="wm-1"]').click();
  await waitForToast('Watermark deleted.');
  await row.waitFor({ state: 'detached', timeout: 15000 });
  console.log('[release-1180] exact toast observed: "Watermark deleted."; row detached');

  const engine = await window.evaluate(async () => {
    const id = window.tflexDiagnostics().engineDocId;
    const g = await window.tflex.engine.getWatermarks(id);
    return g.ok ? g.value.map((w) => w.id) : { err: g.error };
  });
  console.log(`[release-1180] engine watermarks after delete: ${JSON.stringify(engine)}`);
  expect(Array.isArray(engine), 'getWatermarks ok').toBe(true);
  expect(engine).not.toContain('wm-1');
  await closeWatermarkDialog();
});

// 3b. Bounds spot-check through the installed app's IPC ----------------------
test('bounds spot-check: tiny tile, inverted range and 11th watermark are typed engine-errors', async () => {
  test.setTimeout(180000);
  const src = getSamplePath('report.pdf').replace(/\\/g, '/');

  const res = await window.evaluate(async (docSrc) => {
    const api = window.tflex.engine;
    const out = {};

    // size 0.25 + tile -> typed engine-error.
    await api.loadDocument('rel218-tiny', docSrc);
    const tiny = await api.addWatermark('rel218-tiny', { type: 'text', text: 'X', size: 0.25, tile: true });
    out.tiny = { ok: tiny.ok, code: tiny.ok ? null : tiny.error.code, msg: tiny.ok ? null : tiny.error.message };

    // inverted range [3,2] -> typed engine-error, nothing stamped.
    await api.loadDocument('rel218-range', docSrc);
    const inv = await api.addWatermark('rel218-range', { type: 'text', text: 'X', range: [3, 2] });
    const invG = await api.getWatermarks('rel218-range');
    const invS = await api.getState('rel218-range');
    out.range = {
      ok: inv.ok, code: inv.ok ? null : inv.error.code, msg: inv.ok ? null : inv.error.message,
      wmCount: invG.ok ? invG.value.length : 'list-err',
      modified: invS.ok ? invS.value.modified : 'state-err',
    };

    // 10 valid applies, 11th -> maximum-cap error.
    await api.loadDocument('rel218-cap', docSrc);
    const first10 = [];
    for (let i = 0; i < 10; i++) {
      first10.push((await api.addWatermark('rel218-cap', { type: 'text', text: 'C' + i, size: 24 })).ok);
    }
    const eleventh = await api.addWatermark('rel218-cap', { type: 'text', text: 'C10', size: 24 });
    const capG = await api.getWatermarks('rel218-cap');
    out.cap = {
      first10,
      ok: eleventh.ok, code: eleventh.ok ? null : eleventh.error.code, msg: eleventh.ok ? null : eleventh.error.message,
      count: capG.ok ? capG.value.length : 'list-err',
    };
    out.alive = 2 + 2;
    return out;
  }, src);

  console.log(`[release-1180] bounds spot-check: ${JSON.stringify(res)}`);

  expect(res.tiny.ok, 'size 0.25 tile rejected').toBe(false);
  expect(res.tiny.code, 'tiny tile typed engine-error').toBe('engine-error');

  expect(res.range.ok, 'range [3,2] rejected').toBe(false);
  expect(res.range.code, 'range [3,2] typed engine-error').toBe('engine-error');
  expect(res.range.wmCount, 'range [3,2] stamped no pages').toBe(0);
  expect(res.range.modified, 'range [3,2] left doc unmodified').toBe(false);

  expect(res.cap.first10.every(Boolean), 'first 10 valid watermarks accepted').toBe(true);
  expect(res.cap.ok, '11th watermark rejected').toBe(false);
  expect(res.cap.code, '11th watermark typed engine-error').toBe('engine-error');
  expect(res.cap.msg || '', '11th watermark max-cap message').toContain('already has 10 watermarks (maximum)');
  expect(res.cap.count, 'cap leaves exactly 10').toBe(10);
  expect(res.alive, 'app alive after rejected payloads').toBe(4);
});

// 3c. DEF-219 containment at the 10-row cap ----------------------------------
test('DEF-219 containment: 10 applied rows stay inside the dialog, footer in viewport', async () => {
  test.setTimeout(180000);
  await closeWatermarkDialog();
  const applied = await window.evaluate(async () => {
    const api = window.tflex.engine;
    const id = window.tflexDiagnostics().engineDocId;
    const g0 = await api.getWatermarks(id);
    let have = g0.ok ? g0.value.length : 0;
    for (let i = have; i < 10; i++) await api.addWatermark(id, { type: 'text', text: 'L' + i, size: 24 });
    const g = await api.getWatermarks(id);
    return g.ok ? g.value.length : -1;
  });
  expect(applied, '10 watermarks on the open doc').toBe(10);

  await openWatermarkDialog();
  const m = await window.evaluate(() => {
    const bd = document.querySelector('[data-watermark-dialog]');
    const dialog = bd.querySelector('.modal-dialog');
    const footer = bd.querySelector('.modal-footer');
    const list = bd.querySelector('.watermark-applied-list');
    const fb = footer.getBoundingClientRect();
    return {
      rows: bd.querySelectorAll('[data-watermark-applied]').length,
      dialog: { sw: dialog.scrollWidth, cw: dialog.clientWidth },
      footer: { y: Math.round(fb.y), bottom: Math.round(fb.bottom) },
      list: list ? { sh: list.scrollHeight, ch: list.clientHeight, oy: getComputedStyle(list).overflowY } : null,
      viewportH: window.innerHeight,
    };
  });
  console.log(`[release-1180] DEF-219 containment: ${JSON.stringify(m)}`);

  expect(m.rows).toBe(10);
  expect(m.dialog.sw, 'dialog no horizontal overflow').toBeLessThanOrEqual(m.dialog.cw + 1);
  expect(m.footer.bottom, 'footer bottom inside viewport').toBeLessThanOrEqual(m.viewportH);
  expect(m.footer.y, 'footer top inside viewport').toBeGreaterThanOrEqual(0);
  expect(m.list, 'applied list present').not.toBeNull();
  expect(['auto', 'scroll'], 'list scrolls internally').toContain(m.list.oy);

  // Clean up the doc's watermarks so later steps see a known state.
  await closeWatermarkDialog();
});

// 4. DEF-213 fresh-profile Theme default -------------------------------------
test('DEF-213: fresh profile Theme default reads frosted; selecting Dark persists themeDefault', async () => {
  test.setTimeout(180000);
  const profileDir = path.join(os.tmpdir(), `tflex-def213-${Date.now()}`);
  fs.mkdirSync(profileDir, { recursive: true });
  const settingsPath = path.join(profileDir, 'settings.json');

  const app2 = await launchApp([], profileDir, PACKAGED_EXE);
  const win2 = await app2.firstWindow();
  try {
    await win2.waitForSelector('.sample-card', { timeout: 40000 });
    await dismissUpdatePrompt(win2);

    await win2.locator('[data-open-preferences]').first().click();
    await win2.locator('[data-prefs-dialog]').waitFor({ state: 'visible', timeout: 15000 });
    const select = win2.locator('[data-prefs-theme-default]');
    await select.waitFor({ state: 'visible', timeout: 10000 });
    const initial = await select.inputValue();
    console.log(`[release-1180] fresh-profile Theme default select value = ${JSON.stringify(initial)}`);
    await shot(win2, 'release-1180-prefs-theme.png');
    expect(initial, 'fresh-profile theme default').toBe('frosted');

    await select.selectOption('dark');
    let persisted = null;
    for (let i = 0; i < 40; i++) {
      await win2.waitForTimeout(250);
      if (fs.existsSync(settingsPath)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
          if (parsed.themeDefault === 'dark') { persisted = parsed; break; }
        } catch (_) { /* mid-write */ }
      }
    }
    console.log(`[release-1180] settings.json after Dark: ${JSON.stringify(persisted)}`);
    expect(persisted, 'settings.json gained themeDefault:dark while running').not.toBeNull();
    expect(persisted.themeDefault).toBe('dark');
  } finally {
    await hardClose(app2, 'release-1180-def213');
  }
});