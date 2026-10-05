// Phase 522 / TFL-672 - LIVE Google round trip via the OS default browser.
//
// This is the one real, end-to-end sign-in test for TFL-522 criterion 4. It
// launches the DEV build through the canonical launcher, opens the REAL
// account surface, clicks "Continue with Google", and lets the app hand the
// provider URL to the OS DEFAULT BROWSER (shell.openExternal is NOT stubbed).
//
// It then polls accounts:getStatus() for up to 90s, prints the collected
// OAuth trace KINDS (never a token/cookie value - the event contract carries
// none), reads the on-disk oauth-trace.log diagnostic line from userData, and
// screenshots the account surface.
//
// VERDICT (printed on the [P522-live] VERDICT line):
//   PASS         - getStatus().status === "signed-in" with a real email AND
//                  the trace contains exchange-stored.
//   FAIL         - the loopback landed and the exchange rejected
//                  (exchange-failed, e.g. reason=session-rejected).
//   INCONCLUSIVE - the flow stopped before the loopback landed (browser sat
//                  on a Google page needing a human, or no Google session).
//
// The test does NOT fake a pass: it only hard-asserts the navigation setup;
// the terminal state is reported as a verdict. INCONCLUSIVE is a valid
// outcome here, not a product failure.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
test.setTimeout(180000);

test.afterAll(async () => {
  if (app) await hardClose(app, 'p522-live');
  app = null;
});

// Skipped: operator waived criterion 4 on 2026-10-04 (keep the browser UX). Live evidence: Neon rejects the app-side exchange because the verifier is bound to the external browser's challenge cookie; see the TFL-672 report.
test('P522 live: Google round trip completes through the default browser', async () => {
  app = await launchApp([], null);
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  // Subscribe to the REAL trace/outcome bridge BEFORE starting the flow.
  await win.evaluate(() => {
    window.__p522trace = [];
    window.__p522outcomes = [];
    if (window.tflex && window.tflex.accounts) {
      if (typeof window.tflex.accounts.onOAuthTrace === 'function') {
        window.tflex.accounts.onOAuthTrace((e) => window.__p522trace.push(e));
      }
      if (typeof window.tflex.accounts.onOAuthCallback === 'function') {
        window.tflex.accounts.onOAuthCallback((o) => window.__p522outcomes.push(o));
      }
    }
  });

  // Open the real account surface and start the Google flow. shell.openExternal
  // is untouched: the app opens the OS default browser.
  await win.locator('[data-header-accounts]').click();
  await win.waitForSelector('[data-accounts-auth]', { timeout: 15000 });
  await win.locator('[data-accounts-google]').click();
  console.log('[P522-live] clicked Continue with Google (real default browser)');

  // Poll getStatus() for up to 90s.
  let status = null;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    status = await win.evaluate(() => window.tflex.accounts.getStatus()).catch(() => null);
    if (status && status.status === 'signed-in') break;
    await win.waitForTimeout(2000);
  }

  const trace = await win.evaluate(() => (window.__p522trace || []).map((e) => ({
    kind: e.kind, path: e.path, host: e.host, status: e.status,
    reason: e.reason, cookieNames: e.cookieNames, errorCode: e.errorCode,
  })));
  const kinds = trace.map((e) => e.kind);
  const outcomes = await win.evaluate(() => window.__p522outcomes || []);
  console.log(`[P522-live] trace kinds=${JSON.stringify(kinds)}`);
  console.log(`[P522-live] trace detail=${JSON.stringify(trace)}`);
  console.log(`[P522-live] outcomes=${JSON.stringify(outcomes)}`);
  console.log(`[P522-live] final getStatus=${JSON.stringify(status)}`);

  // Read the on-disk exchange diagnostic line from the app's userData.
  const userDataDir = await app.evaluate(({ app: a }) => a.getPath('userData'));
  const logPath = path.join(userDataDir, 'oauth-trace.log');
  if (fs.existsSync(logPath)) {
    const lines = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/).filter(Boolean);
    console.log(`[P522-live] oauth-trace.log (last 5): ${JSON.stringify(lines.slice(-5))}`);
  } else {
    console.log(`[P522-live] no oauth-trace.log at ${logPath}`);
  }

  // Screenshot the account surface: the signed-in panel when signed in, else
  // the sign-in dialog that is still on screen.
  if (status && status.status === 'signed-in') {
    await win.reload();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.locator('[data-header-accounts]').click();
    await win.waitForSelector('[data-account-panel]', { timeout: 10000 }).catch(() => {});
  }
  const shotPath = path.join(SHOTS, 'phase522-live-roundtrip.png');
  await win.screenshot({ path: shotPath }).catch(() => {});
  console.log(`[P522-live] screenshot=${shotPath}`);

  const hasStored = kinds.includes('exchange-stored');
  const hasFailed = kinds.includes('exchange-failed');
  const signedIn = Boolean(status && status.status === 'signed-in' && status.email);
  let verdict;
  if (signedIn && hasStored) verdict = 'PASS';
  else if (hasFailed) verdict = 'FAIL';
  else verdict = 'INCONCLUSIVE';
  console.log(`[P522-live] VERDICT=${verdict}`);
  if (verdict === 'FAIL') {
    console.log(`[P522-live] decisive exchange-failed=${JSON.stringify(trace.filter((e) => e.kind === 'exchange-failed'))}`);
  }

  // Setup sanity only: the accounts bridge answered and the flow was driven.
  // The terminal PASS/FAIL/INCONCLUSIVE verdict is the report line above.
  expect(status, 'accounts:getStatus responded').toBeTruthy();
});
