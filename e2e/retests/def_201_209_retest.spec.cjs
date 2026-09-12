// DEF-201..209 retest (qa, 2026-09-13) - verification of the bug-sweep fixes:
//   DEF-201 Preferences sheet closes on Escape (and stops blocking the UI)
//   DEF-202 maximize caption flips to "Restore window" even after a renderer
//           settings write preceded the maximize (DEF-180 keeper path B)
//   DEF-203 createAnnotation with null rects/points -> typed engine-error,
//           NOT an unhandled TypeError across IPC (ADV-024)
//   DEF-204 empty rects / no geometry -> "Annotation requires at least one
//           rect", no zero-size annotation at (0,0) (ADV-025)
//   DEF-205 NaN/Infinity/negative/zero-size rect coordinates -> validation
//           error, not a silently created annotation (ADV-026)
//   DEF-206 invalid colors -> "Invalid annotation color: ...", not a silent
//           yellow fallback (ADV-027)
//   DEF-207 corrupt settings.json -> recovery toast at boot (ADV-028)
//   DEF-208 zero-page PDF -> "corrupt" user error, no hollow tab (ADV-029)
//   DEF-209 >1000 annotations on a page -> limit error, doc not opened
//           (ADV-030)
// Everything runs against the real dev build through e2e/lib/launch.cjs.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const FIX = (name) => path.join(ROOT, 'test-fixtures', name);
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Toasts auto-dismiss after 5s (Toasts.tsx), so waits start immediately.
async function toastTexts(win) {
  return win.evaluate(() =>
    Array.from(document.querySelectorAll('.toast .toast-text')).map((el) => el.textContent || ''),
  );
}
async function waitForToast(win, re, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const texts = await toastTexts(win);
    const hit = texts.find((t) => re.test(t));
    if (hit) return hit;
    await wait(200);
  }
  return null;
}
async function hasWorkspace(win) {
  return win.evaluate(() => document.querySelector('.workspace') !== null);
}

// DEF-199 (OPEN, console-only, separately tracked) emits a deterministic
// "Transition was skipped" pageerror at boot and on every theme flip. It is
// unrelated to the defects retested here, so scope the no-error assertions
// to everything else.
const isKnownDef199Noise = (m) => /Transition was skipped/i.test(m);
const unexpectedErrors = (errors) => errors.filter((m) => !isKnownDef199Noise(m));

// Open a file through the real Open flow with the main-process dialog stubbed.
async function openViaDialog(electronApp, win, absolutePath, waitMs = 1500) {
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, absolutePath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await wait(waitMs);
}

// ---------------------------------------------------------------------------
test('DEF-201: Preferences closes on Escape and the UI is usable again', async () => {
  test.setTimeout(180000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const errors = [];
  win.on('pageerror', (e) => errors.push(String(e && e.message)));

  // Open a real document so "the UI is usable again" is proven in the
  // workspace (the backdrop used to swallow every control behind it).
  await openViaDialog(electronApp, win, FIX('report.pdf'), 2000);
  expect(await hasWorkspace(win)).toBe(true);

  await win.click('[data-open-preferences]');
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 8000 });
  await wait(400);
  await win.screenshot({ path: path.join(SHOTS, 'def-201-prefs-open.png') });

  await win.keyboard.press('Escape');
  const gone = await win.waitForFunction(
    () => !document.querySelector('[data-prefs-dialog]'),
    null,
    { timeout: 3000 },
  ).then(() => true, () => false);
  console.log(`[DEF-201] prefs closed on Escape=${gone}`);
  expect(gone, 'Preferences sheet must close on Escape').toBe(true);

  // No blocked backdrop: the workspace must accept input right away.
  await win.click('.tab-pane[aria-hidden="false"] [data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
  const paletteOpen = await win.evaluate(() => document.querySelector('[data-tools-palette]') !== null);
  await win.keyboard.press('Escape');
  await win.screenshot({ path: path.join(SHOTS, 'def-201-retest.png') });
  console.log(`[DEF-201] workspace interactive after Escape (palette opened)=${paletteOpen}`);
  expect(paletteOpen, 'controls behind the sheet must be clickable after Escape').toBe(true);
  expect(unexpectedErrors(errors), 'no renderer errors beyond the tracked DEF-199 console noise').toEqual([]);
  await hardClose(electronApp, 'def201');
});

// ---------------------------------------------------------------------------
test('DEF-202: maximize caption flips after a renderer settings write', async () => {
  test.setTimeout(180000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const maxBtn = win.locator('[data-window-maximize]');

  // Renderer settings write (the DEF-202 trigger), then maximize.
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click('[data-theme-option="dark"]');
  await win.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
  await wait(500); // let the theme write + echo settle

  await maxBtn.click();
  // Caption must flip to "Restore window".
  const labelB = await (async () => {
    const deadline = Date.now() + 6000;
    let label = null;
    while (Date.now() < deadline) {
      await wait(250);
      label = await maxBtn.getAttribute('aria-label');
      if (label === 'Restore window') return label;
    }
    return label;
  })();
  const isMaxB = await (async () => {
    const deadline = Date.now() + 6000;
    let ok = false;
    while (Date.now() < deadline) {
      await wait(250);
      ok = await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized());
      if (ok) return true;
    }
    return ok;
  })();
  const udd = await electronApp.evaluate(({ app }) => app.getPath('userData'));
  let persistedMax = null;
  try { persistedMax = JSON.parse(fs.readFileSync(path.join(udd, 'settings.json'), 'utf8')).geometry.maximized; } catch { /* race */ }
  console.log(`[DEF-202] isMaximized=${isMaxB} caption=${labelB} settings.json geometry.maximized=${persistedMax}`);
  await win.screenshot({ path: path.join(SHOTS, 'def-202-retest.png') });

  expect(isMaxB, 'the window must actually maximize').toBe(true);
  expect(persistedMax, 'main must persist maximized=true').toBe(true);
  expect(labelB, 'caption must flip to "Restore window" after a prior settings write too').toBe('Restore window');

  // Restore direction still flips back.
  await maxBtn.click();
  const deadline = Date.now() + 6000;
  let labelBack = null;
  while (Date.now() < deadline) {
    await wait(250);
    labelBack = await maxBtn.getAttribute('aria-label');
    if (labelBack === 'Maximize window') break;
  }
  expect(labelBack).toBe('Maximize window');
  await hardClose(electronApp, 'def202');
});

// ---------------------------------------------------------------------------
test('DEF-203/204/205/206: createAnnotation rejects invalid rects, points and colors with typed engine errors', async () => {
  test.setTimeout(180000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const ipcTypeErrors = [];
  win.on('pageerror', (e) => ipcTypeErrors.push(String(e && e.message)));

  const results = await win.evaluate(async (docPath) => {
    const engine = window.tflex.engine;
    const load = await engine.loadDocument('qa-adv-doc', docPath);
    if (!load.ok) return { loadFailed: load.error };
    const call = (id, payload) =>
      engine.createAnnotation('qa-adv-doc', { id, page: 1, ...payload }).then(
        (r) => r.ok
          ? { threw: false, ok: true }
          : { threw: false, ok: false, code: r.error && r.error.code, message: (r.error && r.error.message) || '' },
        (e) => ({ threw: true, ok: null, message: String((e && e.message) || e) }),
      );
    const R = {};
    // DEF-203 (ADV-024): null geometry
    R.nullRects = await call('adv-null', { kind: 'highlight', color: '#e07a2d', rects: null });
    R.nullPoints = await call('adv-nullp', { kind: 'arrow', color: '#e07a2d', from: null, to: null });
    // DEF-204 (ADV-025): empty / missing geometry
    R.emptyRects = await call('adv-empty', { kind: 'rect', color: '#ff0000', rects: [] });
    R.noGeometry = await call('adv-none', { kind: 'note', color: '#ff0000' });
    // DEF-205 (ADV-026): non-finite / degenerate coordinates
    R.nanRect = await call('adv-nan', { kind: 'rect', color: '#ff0000', rects: [{ x: NaN, y: NaN, width: NaN, height: NaN }] });
    R.infRect = await call('adv-inf', { kind: 'rect', color: '#ff0000', rects: [{ x: Infinity, y: -Infinity, width: Infinity, height: Infinity }] });
    R.zeroRect = await call('adv-zero', { kind: 'rect', color: '#ff0000', rects: [{ x: 10, y: 10, width: 0, height: 0 }] });
    // DEF-206 (ADV-027): invalid colors
    R.badColor = await call('adv-color', { kind: 'rect', color: 'nonexistent!@#$%^&*()', rects: [{ x: 10, y: 10, width: 50, height: 30 }] });
    R.nullColor = await call('adv-color2', { kind: 'rect', color: null, rects: [{ x: 10, y: 10, width: 50, height: 30 }] });
    // control: a valid annotation must still be created
    R.valid = await call('adv-valid', { kind: 'rect', color: '#ff0000', rects: [{ x: 10, y: 10, width: 50, height: 30 }] });
    const state = await engine.getState('qa-adv-doc');
    // getState carries annotations as a FLAT array with 1-based `page`
    // fields (engine.ts buildState). Count the page-1 annotations.
    R.stateAnnCount = state.ok
      ? (Array.isArray(state.value.annotations) ? state.value.annotations : []).filter((a) => a && a.page === 1).length
      : -1;
    return R;
  }, FIX('form.pdf'));
  console.log('[DEF-203..206] ' + JSON.stringify(results, null, 1));
  await win.screenshot({ path: path.join(SHOTS, 'def-203-retest.png') });

  expect(results.loadFailed).toBeUndefined();
  const rejected = ['nullRects', 'nullPoints', 'emptyRects', 'noGeometry', 'nanRect', 'infRect', 'zeroRect', 'badColor', 'nullColor'];
  for (const k of rejected) {
    expect(results[k].threw, `${k}: must return a typed Result, not throw across IPC`).toBe(false);
    expect(results[k].ok, `${k}: must be rejected`).toBe(false);
    expect(results[k].code, `${k}: typed engine-error`).toBe('engine-error');
  }
  expect(results.nullRects.message).not.toMatch(/Cannot read properties of null/i);
  expect(results.nullRects.message.toLowerCase()).toContain('rect');
  expect(results.nullPoints.message.toLowerCase()).toContain('point');
  expect(results.emptyRects.message).toContain('at least one rect');
  expect(results.noGeometry.message).toContain('at least one rect');
  expect(results.nanRect.message).toContain('finite non-negative numbers');
  expect(results.infRect.message).toContain('finite non-negative numbers');
  expect(results.zeroRect.message.toLowerCase()).toContain('positive width and height');
  expect(results.badColor.message).toContain('Invalid annotation color');
  expect(results.nullColor.message).toContain('Invalid annotation color');
  // Control: the valid annotation went through, and ONLY it is in state.
  expect(results.valid.ok).toBe(true);
  expect(results.stateAnnCount).toBe(1);
  expect(ipcTypeErrors, 'no unhandled TypeError in the renderer console').toEqual([]);
  await hardClose(electronApp, 'def203');
});

// ---------------------------------------------------------------------------
test('DEF-207: corrupt settings.json shows the recovery toast; a valid file does not', async () => {
  test.setTimeout(180000);

  // Corrupt case.
  const badDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-def207-bad-'));
  fs.writeFileSync(path.join(badDir, 'settings.json'), '{"theme": "dark",,,, broken', 'utf8');
  const electronApp = await launchApp([], badDir);
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const badToast = await waitForToast(win, /Settings file could not be read/i, 15000);
  console.log(`[DEF-207] recovery toast=${JSON.stringify(badToast)}`);
  await win.screenshot({ path: path.join(SHOTS, 'def-207-retest.png') });
  expect(badToast, 'corrupt settings.json must surface the recovery toast').toBeTruthy();
  const badTheme = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
  expect(badTheme, 'defaults restored after recovery').toBe('frosted');
  await hardClose(electronApp, 'def207bad');

  // Negative control: a valid settings.json must NOT produce the toast.
  const goodDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-def207-good-'));
  fs.writeFileSync(path.join(goodDir, 'settings.json'), JSON.stringify({ theme: 'dark' }), 'utf8');
  const electronApp2 = await launchApp([], goodDir);
  const win2 = await electronApp2.firstWindow();
  await win2.waitForSelector('.sample-card', { timeout: 30000 });
  await wait(2500);
  const goodToasts = await toastTexts(win2);
  const goodHit = goodToasts.find((t) => /Settings file could not be read/i.test(t));
  const goodTheme = await win2.evaluate(() => document.documentElement.getAttribute('data-theme'));
  console.log(`[DEF-207] valid-file toasts=${JSON.stringify(goodToasts)} theme=${goodTheme}`);
  expect(goodHit, 'a valid settings file must not trigger the recovery toast').toBeUndefined();
  expect(goodTheme).toBe('dark');
  await hardClose(electronApp2, 'def207good');
});

// ---------------------------------------------------------------------------
test('DEF-208: a zero-page PDF is rejected as corrupt, no hollow tab', async () => {
  test.setTimeout(180000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const errors = [];
  win.on('pageerror', (e) => errors.push(String(e && e.message)));

  // Subject fixture: valid %PDF header (passes the main sniff), empty page
  // tree - pdf.js resolves it with numPages=0 (verified with pdfjs-dist).
  await openViaDialog(electronApp, win, FIX('zero-page.pdf'), 2000);
  const corruptToast = await waitForToast(win, /could not be read as a PDF/i, 15000);
  console.log(`[DEF-208] zero-page toast=${JSON.stringify(corruptToast)} workspace=${await hasWorkspace(win)}`);
  await win.screenshot({ path: path.join(SHOTS, 'def-208-retest.png') });
  expect(corruptToast, 'zero-page PDF must surface the corrupt-file error').toBeTruthy();
  expect(await hasWorkspace(win), 'zero-page PDF must not open a workspace').toBe(false);

  // Empty (0-byte) file still errors and still leaves the app usable.
  await openViaDialog(electronApp, win, FIX('zero.pdf'), 2000);
  const emptyToast = await waitForToast(win, /not a PDF|could not be read/i, 15000);
  console.log(`[DEF-208] 0-byte toast=${JSON.stringify(emptyToast)} workspace=${await hasWorkspace(win)}`);
  expect(emptyToast, 'a 0-byte file must also surface an error').toBeTruthy();
  expect(await hasWorkspace(win)).toBe(false);

  // The app is still alive and usable after both rejections.
  await openViaDialog(electronApp, win, FIX('report.pdf'), 2000);
  expect(await hasWorkspace(win), 'a good PDF still opens after the rejections').toBe(true);
  expect(unexpectedErrors(errors), 'no renderer errors beyond the tracked DEF-199 console noise').toEqual([]);
  await hardClose(electronApp, 'def208');
});

// ---------------------------------------------------------------------------
test('DEF-209: a PDF with >1000 annotations on one page is refused with the limit error', async () => {
  test.setTimeout(240000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const errors = [];
  win.on('pageerror', (e) => errors.push(String(e && e.message)));

  const fixture = FIX('huge-annotations.pdf');
  const sizeBefore = fs.statSync(fixture).size;
  await openViaDialog(electronApp, win, fixture, 2500);
  const limitToast = await waitForToast(win, /Too many annotations on page 1 \(1000 max\)/i, 60000);
  console.log(`[DEF-209] limit toast=${JSON.stringify(limitToast)} workspace=${await hasWorkspace(win)}`);
  await win.screenshot({ path: path.join(SHOTS, 'def-209-retest.png') });
  const sizeAfter = fs.statSync(fixture).size;

  expect(limitToast, 'the per-page annotation limit must refuse the open with a clear error').toBeTruthy();
  expect(await hasWorkspace(win), 'the document must not be opened').toBe(false);
  expect(sizeAfter, 'the fixture must not be written to').toBe(sizeBefore);
  expect(unexpectedErrors(errors), 'no renderer errors beyond the tracked DEF-199 console noise').toEqual([]);
  await hardClose(electronApp, 'def209');
});
