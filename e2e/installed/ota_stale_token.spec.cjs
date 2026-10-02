// INSTALLED-APP-ONLY spec (TFL-365, driver TFL-362). Excluded from the
// standard suite via playwright.config.js testIgnore (e2e/installed/**).
//
// Focused regression for the OTA stale-token fix (backend-dev, TFL-363):
//   src/main/services/update-service.ts no longer attaches an ambient
//   TFLEX_GH_TOKEN / GH_TOKEN to the PUBLIC feed, and isNoReleasesError()
//   no longer swallows the "ensure a production release exists" wording.
//
// Root cause pinned: an invalid ambient token made electron-updater pick
// PrivateGitHubProvider -> api.github.com/.../releases/latest -> HTTP 401,
// which the old isNoReleasesError() reported as a silent 'up-to-date'.
//
// CASES (all against a PACKAGED build, real network round trip):
//   A: fixed 1.46.0 build + BAD token -> launch auto-check reaches
//      { kind:'available', version:'1.47.0' } with NO user action, the
//      in-app prompt is visible, and check() resolves 'available'.
//   B: fixed 1.47.0 build + BAD token -> up-to-date (no error), check()
//      resolves 'up-to-date'.
//   C: PRE-fix installed 1.46.0 binary + BAD token -> reports 'up-to-date'
//      even though 1.47.0 is published (the swallowed 401). Documents the
//      failure mode before the fix; skipped only if it cannot launch.
//
// The whole spec sets an INVALID ambient token (never a real credential).
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp } = require('../lib/launch.cjs');

const BAD_TOKEN = 'invalid-stale-token';
process.env.TFLEX_GH_TOKEN = BAD_TOKEN;
process.env.GH_TOKEN = BAD_TOKEN;

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'screenshots');

// CASE A (1.46.0) candidates. The default build dir is win-unpacked; an
// alternate output dir (release/win-unpacked-146) keeps BOTH the 1.46.0 and
// 1.47.0 packaged builds available in one run so all cases pass together.
const CASE_A_CANDIDATES = [
  process.env.TFLEX_CASE_A_EXE,
  path.join(ROOT, 'release', 'win-unpacked-146', 'win-unpacked', 'Jovrel.exe'),
  path.join(ROOT, 'release', 'win-unpacked-146', 'Jovrel.exe'),
  path.join(ROOT, 'release', 'win-unpacked', 'Jovrel.exe'),
].filter(Boolean);
const CASE_B_CANDIDATES = [
  process.env.TFLEX_CASE_B_EXE,
  path.join(ROOT, 'release', 'win-unpacked', 'Jovrel.exe'),
].filter(Boolean);
const CASE_C_EXE = process.env.TFLEX_INSTALLED_EXE || 'C:\\Program Files\\Jovrel\\Jovrel.exe';

let electronApp = null;
let window = null;

test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null;
  window = null;
});

// Launch a packaged exe with an ISOLATED user-data dir (launchApp creates a
// unique temp dir when userDataDir is null) so requestSingleInstanceLock()
// cannot collide with a running Jovrel. Returns the packaged app version.
async function openExe(exe) {
  electronApp = await launchApp([], null, exe);
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('.app', { timeout: 30000 });
  const version = await electronApp.evaluate(({ app }) => app.getVersion());
  return version;
}

// Launch the first candidate that exists AND reports wantVersion. Closes a
// mismatched launch before trying the next. Returns the exe path, or
// { notFound: [...] } when no candidate matches.
async function openMatching(candidates, wantVersion) {
  const tried = [];
  for (const exe of candidates) {
    if (!fs.existsSync(exe)) { tried.push(`${exe} (missing)`); continue; }
    let version;
    try {
      version = await openExe(exe);
    } catch (e) {
      tried.push(`${exe} (launch failed: ${e.message})`);
      if (electronApp) await hardClose(electronApp);
      electronApp = null; window = null;
      continue;
    }
    if (version === wantVersion) return exe;
    tried.push(`${exe} (version ${version})`);
    if (electronApp) await hardClose(electronApp);
    electronApp = null; window = null;
  }
  return { notFound: tried };
}

async function attachTracer() {
  await window.evaluate(() => {
    window.__statusLog = [];
    window.__statusLogError = null;
    const api = window.tflex && window.tflex.update;
    if (!api) { window.__statusLogError = 'no window.tflex.update'; return; }
    if (typeof api.onStatusChanged === 'function') {
      api.onStatusChanged((s) => window.__statusLog.push({ t: Math.round(performance.now()), state: s }));
    } else {
      window.__statusLogError = 'onStatusChanged missing';
    }
  });
  const err = await window.evaluate(() => window.__statusLogError);
  if (err) console.log('[tracer] WARN:', err);
}

async function currentStatus() {
  return window.evaluate(() => window.tflex.update.getStatus().catch(() => null));
}

async function waitForKind(kind, timeoutMs) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await currentStatus();
    if (last && last.kind === kind) return last;
    await window.waitForTimeout(400);
  }
  return last;
}

async function statusSeq() {
  return window.evaluate(() =>
    (window.__statusLog || []).map((e) => e.state));
}

async function snap(name) {
  const p = path.join(SHOTS, name);
  await window.screenshot({ path: p });
  console.log(`[shot] ${p}`);
  return p;
}

test('CASE A: fixed 1.46.0 + BAD token -> available 1.47.0 with no user action', async () => {
  test.setTimeout(180000);
  const picked = await openMatching(CASE_A_CANDIDATES, '1.46.0');
  if (picked.notFound) {
    console.log('[CASE A] NO 1.46.0 BUILD FOUND. tried =', JSON.stringify(picked.notFound, null, 2));
    test.skip(true, 'CASE A requires the 1.46.0 packaged build (electron-builder --dir -c.extraMetadata.version=1.46.0).');
    return;
  }
  console.log(`[CASE A] exe=${picked} | TFLEX_GH_TOKEN=${BAD_TOKEN} (invalid, intentional)`);
  await attachTracer();

  // (1) The launch auto-check must reach 'available' WITHOUT any user action.
  const st = await waitForKind('available', 90000);
  console.log('[CASE A] getStatus =', JSON.stringify(st));
  console.log('[CASE A] status sequence =', JSON.stringify(await statusSeq()));
  expect(st, 'CASE A: launch auto-check must reach available with no user action').not.toBeNull();
  expect(st.kind, 'CASE A: expected available, not a swallowed error/up-to-date').toBe('available');
  expect(st.version, 'CASE A: available version').toBe('1.47.0');

  // (2) The in-app prompt appears without user action.
  const prompt = window.locator('[data-update-prompt][data-update-prompt-kind="available"]');
  await expect(prompt, 'CASE A: in-app available prompt must be visible').toBeVisible({ timeout: 20000 });
  const shot = await snap('tfl365_caseA_available_prompt.png');

  // (3) A manual check() resolves 'available'.
  const checked = await window.evaluate(() =>
    window.tflex.update.check().catch((e) => ({ kind: 'threw', message: String(e) })));
  console.log('[CASE A] check() ->', JSON.stringify(checked));
  expect(checked.kind, 'CASE A: check() must resolve available').toBe('available');
  console.log(`[CASE A] PASS; screenshot=${shot}`);
});

test('CASE B: fixed 1.47.0 + BAD token -> up-to-date, no error', async () => {
  test.setTimeout(180000);
  const picked = await openMatching(CASE_B_CANDIDATES, '1.47.0');
  if (picked.notFound) {
    console.log('[CASE B] NO 1.47.0 BUILD FOUND. tried =', JSON.stringify(picked.notFound, null, 2));
    test.skip(true, 'CASE B requires the repo-version packaged build (npx electron-builder --dir).');
    return;
  }
  console.log(`[CASE B] exe=${picked} | TFLEX_GH_TOKEN=${BAD_TOKEN} (invalid, intentional)`);
  await attachTracer();

  const st = await waitForKind('up-to-date', 90000);
  console.log('[CASE B] getStatus =', JSON.stringify(st));
  console.log('[CASE B] status sequence =', JSON.stringify(await statusSeq()));
  expect(st, 'CASE B: must reach a terminal non-checking state').not.toBeNull();
  expect(st.kind, 'CASE B: invalid ambient token must NOT produce an error').not.toBe('error');
  expect(st.kind, 'CASE B: current build must be up-to-date').toBe('up-to-date');

  const checked = await window.evaluate(() =>
    window.tflex.update.check().catch((e) => ({ kind: 'threw', message: String(e) })));
  console.log('[CASE B] check() ->', JSON.stringify(checked));
  expect(checked.kind, 'CASE B: check() must resolve up-to-date').toBe('up-to-date');
  await snap('tfl365_caseB_up_to_date.png');
  console.log('[CASE B] PASS');
});

test('CASE C: PRE-fix installed 1.46.0 + BAD token -> swallowed 401 as up-to-date', async () => {
  test.setTimeout(180000);
  if (!fs.existsSync(CASE_C_EXE)) {
    console.log('[CASE C] installed binary not found at', CASE_C_EXE, '- SKIP');
    test.skip(true, `CASE C requires the installed binary at ${CASE_C_EXE}.`);
    return;
  }
  let version;
  try {
    version = await openExe(CASE_C_EXE);
  } catch (e) {
    console.log('[CASE C] could not launch installed binary:', e.message, '- SKIP');
    test.skip(true, `CASE C could not launch the installed binary: ${e.message}`);
    return;
  }
  console.log(`[CASE C] exe=${CASE_C_EXE} version=${version} | TFLEX_GH_TOKEN=${BAD_TOKEN}`);
  await attachTracer();

  // PRE-fix: the 401 is swallowed and reported as up-to-date, even though
  // 1.47.0 is published. This documents the failure mode the fix removes.
  const st = await waitForKind('up-to-date', 90000);
  console.log('[CASE C] getStatus =', JSON.stringify(st));
  console.log('[CASE C] status sequence =', JSON.stringify(await statusSeq()));
  expect(st, 'CASE C: pre-fix build must settle on a terminal state').not.toBeNull();
  expect(st.kind, 'CASE C: pre-fix swallowed 401 shows as up-to-date').toBe('up-to-date');
  await snap('tfl365_caseC_prefix_swallowed.png');
  console.log('[CASE C] PASS (failure mode reproduced: swallowed 401 -> up-to-date)');
});
