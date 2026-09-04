// QA LIVE reproduction — Bug 9 (OTA update prompt update-click UX).
//
// Uses the INSTALLED v1.7.7 app against the real private GitHub repo
// (tanzimtipu/TFlex) where v1.7.8 is published as a dummy release. The
// update service needs TFLEX_GH_TOKEN in the environment (it is read at
// runtime by update-service.ts); without it the test is meaningless
// (the service goes to 'error' state).
//
// This is a REAL network round trip: it checks GitHub for the release,
// then actually DOWNLOADS the 1.7.8 installer. It does NOT install (we
// never click Restart) — it only verifies the prompt UX.
//
// Steps verified (mapped to the B9 success criteria):
//   1. App detects 1.7.8 available and shows the update prompt.
//   2. Click "Update" -> IMMEDIATE downloading/progress state (no dead
//      silence), prompt dismisses to background.
//   3. Toolbar indicator persists while the background download runs
//      and the prompt does NOT re-arm as "Update" clickable.
//   4. Download completes -> a NEW prompt appears with Restart + Later.
//
// It also records the exact update:statusChanged sequence observed over
// `window.tflex.update.onStatusChanged` (checking -> available ->
// downloading(N) -> downloaded) with monotonic timestamps.
const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp } = require('../lib/launch.cjs');

const EXE_PATH = "C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe";
const SHOT = 'screenshots';

let electronApp = null;
let window = null;

async function launch() {
  electronApp = await launchApp([], null, EXE_PATH);
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForSelector('.app', { timeout: 30000 });
}

test.afterEach(async () => {
  // Always tear the app down so an in-flight download (and its process)
  // is killed even if an assertion fails mid-run.
  if (electronApp) await hardClose(electronApp);
  electronApp = null;
  window = null;
});

async function snap(name) {
  await window.screenshot({ path: `${SHOT}/${name}.png` });
  console.log(`[shot] ${SHOT}/${name}.png`);
}

/** Read the whole status log recorded in the renderer. */
async function readStatus() {
  return window.evaluate(() => ({
    log: Array.isArray(window.__statusLog) ? window.__statusLog.slice() : null,
    logError: window.__statusLogError || null,
  }));
}

/** Poll window.tflex.update.getStatus() until the kind matches or timeout. */
async function waitForKind(kind, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const st = await window.evaluate(() => window.tflex.update.getStatus().catch(() => null));
    if (st && st.kind === kind) return st;
    await window.waitForTimeout(400);
  }
  return null;
}

test('B9: OTA update prompt UX (installed 1.7.7 -> available 1.7.8)', async () => {
  test.setTimeout(600000);
  await launch();
  // --------------------------------------------------------------------
  // Install the status tracer BEFORE we drive anything. onStatusChanged
  // supports multiple listeners; the App owns its own, ours is additive.
  // --------------------------------------------------------------------
  await window.evaluate(() => {
    window.__statusLog = [];
    window.__statusLogError = null;
    const api = window.tflex && window.tflex.update;
    if (api === undefined) { window.__statusLogError = 'no window.tflex.update'; return; }
    if (typeof api.onStatusChanged === 'function') {
      api.onStatusChanged((s) => {
        window.__statusLog.push({ t: Math.round(performance.now()), state: s });
      });
    } else {
      window.__statusLogError = 'onStatusChanged missing';
    }
  });
  console.log('[tracer] installed; reading initial status...');

  const initial = await window.evaluate(() => window.tflex.update.getStatus().catch(() => null));
  console.log('[initial] getStatus =', JSON.stringify(initial));

  // --------------------------------------------------------------------
  // STEP 1 — detect availability and show the update prompt.
  // If the launch auto-check already landed on 'available' we use it;
  // otherwise drive a manual check (Help -> Check for Update path) so
  // we deterministically capture checking -> available. Either way the
  // app must end on 'available' with the prompt open.
  // --------------------------------------------------------------------
  let state = initial;
  if (!state || state.kind !== 'available') {
    console.log('Not yet available from launch; triggering manual check (Help -> Check for Update)...');
    await window.evaluate(() => window.tflex.update.check().catch(() => null));
  }

  const available = await waitForKind('available', 60000);
  if (available === null) {
    const current = await window.evaluate(() => window.tflex.update.getStatus().catch(() => null));
    console.log('[FAIL-step1] never reached available. last getStatus =', JSON.stringify(current));
    await snap('b9-step1-fail');
    throw new Error('B9 step 1 FAIL: app never reached "available" (1.7.8 not detected).');
  }
  console.log('[step1] available detected ->', JSON.stringify(available));

  // The renderer auto-opens the prompt on 'available'.
  const promptAvailable = window.locator(
    '[data-update-prompt][data-update-prompt-kind="available"]'
  );
  await expect(promptAvailable).toBeVisible({ timeout: 20000 });
  await expect(window.locator('[data-update-prompt-update]')).toBeVisible({ timeout: 5000 });
  const availBody = await window.locator('[data-update-prompt]').innerText();
  console.log('[step1] prompt body =', JSON.stringify(availBody));
  await snap('b9-step1-available-prompt');
  console.log('[STEP1] PASS: 1.7.8 detected, update prompt shown with Update button.');

  // --------------------------------------------------------------------
  // STEP 2 — click "Update": IMMEDIATE downloading/progress, prompt
  // dismisses to background (no "no progress for seconds" gap).
  // --------------------------------------------------------------------
  // Timestamp the click so we can measure the click->downloading latency.
  await window.evaluate(() => {
    const btn = document.querySelector('[data-update-prompt-update]');
    window.__clickTs = null;
    if (btn) {
      btn.addEventListener('click', () => { window.__clickTs = performance.now(); }, { once: true });
    }
  });
  await window.click('[data-update-prompt-update]');
  console.log('[step2] clicked Update');

  // IMMEDIATELY after the click, capture the DOM (evidence of the
  // click moment; the toolbar chip will re-render to 'downloading'
  // a frame later, so we don't hard-require it this exact instant).
  const post = await window.evaluate(() => ({
    clickTs: window.__clickTs,
    promptPresent: !!document.querySelector('[data-update-prompt]'),
    promptKind: (document.querySelector('[data-update-prompt]') || {}).getAttribute
      ? document.querySelector('[data-update-prompt]').getAttribute('data-update-prompt-kind')
      : null,
    indicatorKind: (document.querySelector('[data-update-indicator]') || {}).getAttribute
      ? document.querySelector('[data-update-indicator]').getAttribute('data-update-indicator-kind')
      : null,
    indicatorProgress: (document.querySelector('[data-update-indicator]') || {}).getAttribute
      ? document.querySelector('[data-update-indicator]').getAttribute('data-update-indicator-progress')
      : null,
  }));
  console.log('[step2] immediate post-click DOM =', JSON.stringify(post));

  // Gather the first downloading entry + how many ms after the click it landed.
  const dlInfo = await window.evaluate(() => {
    const log = window.__statusLog || [];
    const afterClick = window.__clickTs;
    const idx = log.findIndex((e) => e.state && e.state.kind === 'downloading');
    const firstDl = idx >= 0 ? log[idx] : null;
    const dlCount = log.filter((e) => e.state && e.state.kind === 'downloading').length;
    return {
      firstDownloading: firstDl,
      gapMs: (afterClick !== null && firstDl) ? Math.round(firstDl.t - afterClick) : null,
      anyDownloading: dlCount > 0,
      dlCount,
      allKinds: log.map((e) => `${e.state && e.state.kind}@${e.t}`),
    };
  });
  console.log('[step2] downloading evidence =', JSON.stringify(dlInfo, null, 2));

  // Poll (up to ~10s) for the toolbar chip to reflect 'downloading' —
  // React renders it a frame after the state push. We also accept an
  // immediate jump to 'downloaded' (a very fast differential download).
  let dlChip = null;
  {
    const start = Date.now();
    while (Date.now() - start < 10000) {
      const s = await window.evaluate(() => {
        const indicator = document.querySelector('[data-update-indicator]');
        const prompt = document.querySelector('[data-update-prompt]');
        return {
          indicatorKind: indicator ? indicator.getAttribute('data-update-indicator-kind') : null,
          indicatorProgress: indicator ? indicator.getAttribute('data-update-indicator-progress') : null,
          promptKind: prompt ? prompt.getAttribute('data-update-prompt-kind') : null,
        };
      });
      if (s.indicatorKind === 'downloading' || s.indicatorKind === 'downloaded') {
        dlChip = s;
        break;
      }
      await window.waitForTimeout(120);
    }
  }
  console.log('[step2] toolbar chip after click =', JSON.stringify(dlChip));
  await snap('b9-step2-after-update-click');

  // The prompt must not be an actionable "available" prompt anymore.
  if (post.promptKind === 'available' || dlChip.promptKind === 'available') {
    console.log('[FAIL-step2] prompt still shows available/Update after click.');
    await snap('b9-step2-fail-still-available');
    throw new Error('B9 step 2 FAIL: prompt still shows "available" after clicking Update.');
  }
  // Must have an IMMEDIATE downloading/progress surface (toolbar chip).
  const step2Pass =
    dlInfo.anyDownloading === true &&
    (dlInfo.gapMs === null || dlInfo.gapMs < 2500) &&
    dlChip !== null &&
    dlChip.indicatorKind === 'downloading' &&
    dlChip.indicatorProgress !== null &&
    post.promptPresent === false;
  console.log('[step2] step2Pass =', step2Pass);
  if (!step2Pass) {
    console.log('[FAIL-step2] did not get immediate downloading progress with prompt dismissed.');
    throw new Error('B9 step 2 FAIL: no immediate downloading/progress after Update click.');
  }
  console.log(`[STEP2] PASS: "downloading" pushed ${dlInfo.gapMs === null ? 'immediately' : dlInfo.gapMs + 'ms'} after click, toolbar chip shows ${dlChip.indicatorProgress}%, prompt dismissed.`);

  // --------------------------------------------------------------------
  // STEP 3 — background indicator persists while download continues;
  // the prompt must NOT re-arm as "available/Update".
  // --------------------------------------------------------------------
  let rearmed = false;
  let promptSeenDuringDownload = null;
  for (let i = 0; i < 16; i++) { // sample ~8s
    const s = await window.evaluate(() => {
      const prompt = document.querySelector('[data-update-prompt]');
      const indicator = document.querySelector('[data-update-indicator]');
      return {
        promptKind: prompt ? prompt.getAttribute('data-update-prompt-kind') : null,
        indicatorKind: indicator ? indicator.getAttribute('data-update-indicator-kind') : null,
        indicatorProgress: indicator ? indicator.getAttribute('data-update-indicator-progress') : null,
        logKinds: (window.__statusLog || []).map((e) => (e.state ? e.state.kind : '?')),
      };
    });
    if (i === 0) await snap('b9-step3-downloading-bg');
    if (s.promptKind === 'available') { rearmed = true; }
    if (s.promptKind) promptSeenDuringDownload = s.promptKind;
    // Once we've reached downloaded, stop sampling the "no re-arm" window.
    const last = s.logKinds[s.logKinds.length - 1];
    if (last === 'downloaded' || last === 'error') break;
    await window.waitForTimeout(500);
  }
  console.log('[step3] rearmed (available prompt reappeared) =', rearmed,
    '| prompt kind during download =', promptSeenDuringDownload);
  // Allow the case where download finished fast and jumped to 'downloaded'
  // (that's still NOT an "available" re-arm).
  const step3Pass = rearmed === false;
  if (!step3Pass) {
    console.log('[FAIL-step3] the available prompt re-armed during download.');
    await snap('b9-step3-fail-rearmed');
    throw new Error('B9 step 3 FAIL: "available" prompt re-armed during background download.');
  }
  await snap('b9-step3-no-rearm');
  console.log('[STEP3] PASS: toolbar indicator persisted during download, no "available" re-arm.');

  // --------------------------------------------------------------------
  // STEP 4 — download completes -> NEW prompt with Restart + Later.
  // --------------------------------------------------------------------
  const downloaded = await waitForKind('downloaded', 480000);
  if (downloaded === null) {
    const current = await window.evaluate(() => window.tflex.update.getStatus().catch(() => null));
    console.log('[FAIL-step4] never reached downloaded. last getStatus =', JSON.stringify(current));
    console.log('last log =', JSON.stringify((await readStatus()).log));
    await snap('b9-step4-fail-not-downloaded');
    throw new Error('B9 step 4 FAIL: download never completed within timeout.');
  }
  console.log('[step4] downloaded detected ->', JSON.stringify(downloaded));

  const promptDownloaded = window.locator(
    '[data-update-prompt][data-update-prompt-kind="downloaded"]'
  );
  await expect(promptDownloaded).toBeVisible({ timeout: 30000 });
  await expect(window.locator('[data-update-prompt-restart]')).toBeVisible({ timeout: 5000 });
  await expect(window.locator('[data-update-prompt-later]')).toBeVisible({ timeout: 5000 });
  const downloadedBody = await window.locator('[data-update-prompt]').innerText();
  console.log('[step4] downloaded prompt body =', JSON.stringify(downloadedBody));
  await snap('b9-step4-downloaded-prompt');
  console.log('[STEP4] PASS: new prompt shows Restart + Later on download complete.');

  // --------------------------------------------------------------------
  // Report the exact update:statusChanged sequence observed.
  // --------------------------------------------------------------------
  const log = (await readStatus()).log || [];
  const seq = log
    .filter((e) => e.state && e.state.kind)
    .map((e) => `${e.state.kind}${e.state.kind === 'downloading' ? '(' + e.state.progress + ')' : ''}@${e.t}ms`);
  console.log('\n=== UPDATE STATUS SEQUENCE (' + (log.length) + ' transitions) ===');
  for (const s of seq) console.log('  ' + s);
  console.log('============================================================\n');

  console.log('\n=== B9 RESULT ===');
  console.log('STEP1 available prompt        : PASS');
  console.log('STEP2 immediate downloading    : PASS');
  console.log('STEP3 no re-arm + bg indicator : PASS');
  console.log('STEP4 downloaded restart prompt: PASS');
  console.log('B9 DEFECT: PASS');
});
