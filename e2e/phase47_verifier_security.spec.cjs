// Phase 47 (qa) - SECURITY attack on the Managed session-verifier path.
//
// The loopback callback now captures `neon_auth_session_verifier` from a landing
// URL. This spec drives the REAL listener in the packaged app (via the real
// `accounts:startOAuthCallback` bridge) and attacks it from Node:
//   A. wrong token + a verifier  -> 403, verifier NOT captured, never traced;
//   B. correct token + an OVERSIZED verifier -> 200, app stays alive, no crash,
//      the verifier value never appears in any trace event or oauth-trace.log;
//   C. replay of the consumed URL -> 403 (single-use).
//
// Only kinds/counts and booleans are printed - never a token, code or verifier.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const PACKAGED_EXE =
  process.env.TFLEX_PACKAGED_EXE ||
  path.join(process.cwd(), 'release', 'win-unpacked', 'Jovrel.exe');

let app = null;
let win = null;
test.setTimeout(180000);

test.afterEach(async () => {
  if (app) await hardClose(app, 'p47-verifier-sec');
  app = null;
  win = null;
});

// Raw GET against the loopback listener; resolves { status }.
function get(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
  });
}

test('P47 verifier security: wrong token, oversized verifier, replay', async () => {
  app = await launchApp([], null, PACKAGED_EXE);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  const traceFile = path.join(userData, 'oauth-trace.log');

  // Subscribe to the real trace + outcome bridges BEFORE the flow starts.
  await win.evaluate(() => {
    window.__secTrace = [];
    window.__secOutcome = [];
    window.tflex.accounts.onOAuthTrace((e) => window.__secTrace.push(e));
    window.tflex.accounts.onOAuthCallback((o) => window.__secOutcome.push(o));
  });

  const { callbackUrl } = await win.evaluate(() => window.tflex.accounts.startOAuthCallback());
  console.log(`[P47sec] minted=${callbackUrl.replace(/token=[^&]+/, 'token=<redacted>')}`);
  expect(callbackUrl).toMatch(/^http:\/\/localhost:\d+\/oauth\/callback\?token=/);
  const token = /token=([^&]+)/.exec(callbackUrl)[1];

  const VERIFIER = 'ATTACK-VERIFIER-SECRET-9f3a';
  const OVERSIZED = 'X'.repeat(10000);

  // A. Wrong token + a verifier: refused, flow NOT consumed, verifier not kept.
  const wrong = callbackUrl.replace(/token=[^&]+/, 'token=wrong-token');
  const a = await get(`${wrong}&neon_auth_session_verifier=${VERIFIER}`);
  console.log(`[P47sec] A wrong-token+verifier status=${a.status}`);
  expect(a.status, 'wrong token is refused').toBe(403);

  // B. Correct token + an OVERSIZED verifier: accepted (200), app survives.
  const b = await get(`${callbackUrl}&neon_auth_session_verifier=${OVERSIZED}`);
  console.log(`[P47sec] B oversized-verifier status=${b.status}`);
  expect(b.status, 'valid landing with an oversized verifier is accepted').toBe(200);

  // Wait for the exchange to settle (it will fail - no real session - but must
  // report an outcome and never crash).
  await expect
    .poll(async () => win.evaluate(() => window.__secOutcome.length), { timeout: 30000 })
    .toBeGreaterThan(0);
  const outcome = await win.evaluate(() => window.__secOutcome[0]);
  console.log(`[P47sec] outcome ok=${outcome.ok} reason=${outcome.reason ?? 'n/a'}`);

  // C. Replay of the consumed URL: refused (single-use).
  const c = await get(`${callbackUrl}&neon_auth_session_verifier=${VERIFIER}`);
  console.log(`[P47sec] C replay status=${c.status}`);
  expect(c.status, 'a replayed landing is refused').toBe(403);

  // The app is still alive and responsive after the attacks.
  expect(await win.locator('.sample-card').count(), 'app still responsive').toBeGreaterThan(0);

  // No verifier value may appear in any trace event.
  const traceJson = await win.evaluate(() => JSON.stringify(window.__secTrace));
  expect(traceJson, 'no verifier in the trace events').not.toContain(VERIFIER);
  expect(traceJson, 'no oversized verifier in the trace events').not.toContain('XXXXX');
  expect(traceJson, 'no token in the trace events').not.toContain(token);

  // No verifier value may appear in oauth-trace.log; every line is single-line.
  if (fs.existsSync(traceFile)) {
    const log = fs.readFileSync(traceFile, 'utf8');
    console.log(`[P47sec] trace.log lines=${log.split('\n').filter((l) => l.length > 0).length}`);
    expect(log, 'no verifier in oauth-trace.log').not.toContain(VERIFIER);
    expect(log, 'no oversized verifier in oauth-trace.log').not.toContain('XXXXX');
    expect(log, 'no token in oauth-trace.log').not.toContain(token);
    for (const line of log.split('\n').filter((l) => l.length > 0)) {
      expect(line.length, 'trace line is capped').toBeLessThanOrEqual(400);
    }
  } else {
    console.log('[P47sec] oauth-trace.log absent (no failure line written)');
  }
});
