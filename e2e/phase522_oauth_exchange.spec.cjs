// Phase 522 / TFL-522 - network-free proof of the Google sign-in exchange.
//
// WHY: TFL-667 made the main-process exchange send the auth-host cookies
// (`credentials: 'include'` in oauth-exchange.ts). A unit test can only pin the
// request init object; nothing proved Electron actually attaches the
// `__Secure-neon-auth.session_challenge` cookie to the cross-origin
// /get-session call. This spec stands up a LOCAL stub auth server (127.0.0.1,
// ephemeral port, no external service) that REFUSES /get-session unless the
// challenge cookie is present AND the one-time verifier query param matches.
// The positive test therefore fails on the pre-fix code (cookie absent -> 400),
// which is exactly the operator's "Session challenge cookie not found".
//
// The stub is the only network peer; it is loopback only and the product stays
// offline. Everything runs on the DEV build (dist/main/index.js) so the C1
// fix under src/main is what is exercised.
//
// [P522 ...] lines are the evidence. No cookie VALUE is ever logged - names only.

const { test, expect } = require('@playwright/test');
const http = require('node:http');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const CHALLENGE_NAME = '__Secure-neon-auth.session_challenge';
const CHALLENGE_VALUE = 'QA-522-CHALLENGE';
const VERIFIER = 'QA-522-VERIFIER';
const EMAIL = 'oauth-qa@example.test';

// Test 1 writes the encrypted vault under this FIXED userDataDir; test 3
// relaunches on the SAME directory to prove the signed-in state is local.
const USER_DATA_DIR = path.join(os.tmpdir(), `tflex-p522-oauth-${Date.now()}`);
// Test 1's stub base (now a dead port) is reused by test 3 so the auth host is
// configured but unreachable.
let TEST1_BASE = null;

let app = null;
test.setTimeout(180000);

test.afterEach(async () => {
  if (app) await hardClose(app, 'p522');
  app = null;
});

// The local stub auth server. Base path `/auth`; ephemeral loopback port.
function startStubAuth() {
  const state = { getSessionRequests: [], tokenRequests: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const json = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/auth/get-session') {
      const raw = req.headers.cookie || '';
      const cookieNames = raw
        .split(';')
        .map((part) => part.trim().split('=')[0])
        .filter(Boolean);
      const challengeOk = raw.split(';').some((part) => {
        const eq = part.indexOf('=');
        if (eq === -1) return false;
        return part.slice(0, eq).trim() === CHALLENGE_NAME && part.slice(eq + 1).trim() === CHALLENGE_VALUE;
      });
      const verifier = url.searchParams.get('neon_auth_session_verifier');
      state.getSessionRequests.push({ cookieNames, verifier });
      if (challengeOk && verifier === VERIFIER) {
        json(200, {
          session: { id: 's1', expiresAt: '2099-01-01T00:00:00.000Z' },
          user: { id: 'u1', email: EMAIL, emailVerified: true, name: 'OAuth QA', image: null },
        });
      } else {
        json(400, { message: 'Session challenge cookie not found' });
      }
      return;
    }
    if (url.pathname === '/auth/token') {
      state.tokenRequests += 1;
      json(200, { token: 'QA-522-JWT' });
      return;
    }
    json(404, {});
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port, base: `http://127.0.0.1:${port}/auth`, state });
    });
  });
}

const closeStub = (stub) => new Promise((resolve) => stub.server.close(() => resolve()));
// The listener binds 127.0.0.1; the minted URL uses `localhost` for the
// provider. Fetch the bound address directly so the landing cannot miss IPv6.
const loopbackFetch = (callbackUrl, suffix) =>
  fetch(callbackUrl.replace('localhost', '127.0.0.1') + suffix);

// Poll the real renderer IPC until the account status settles.
async function pollStatus(win, want, tries = 40) {
  let last = null;
  for (let i = 0; i < tries; i += 1) {
    last = await win.evaluate(() => window.tflex.accounts.getStatus());
    if (last.status === want) return last;
    await win.waitForTimeout(500);
  }
  return last;
}

// ---------------------------------------------------------------------------
// Test 1 (positive, criteria 1/2/5 mechanics): the exchange completes and the
// stub records the challenge cookie ON the /get-session request.
// ---------------------------------------------------------------------------
test('P522 test 1: the challenge cookie reaches /get-session and the session is stored', async () => {
  const stub = await startStubAuth();
  TEST1_BASE = stub.base;
  process.env.TFLEX_AUTH_BASE_URL = stub.base;
  console.log(`[P522 test1] stub base=${stub.base}`);

  app = await launchApp([], USER_DATA_DIR);
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  const started = await win.evaluate(() => window.tflex.accounts.startOAuthCallback());
  console.log(`[P522 test1] callbackUrl=${started.callbackUrl.replace(/token=.*/, 'token=<redacted>')}`);
  expect(started.callbackUrl).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):\d+\/oauth\/callback\?token=/);

  // Seed the challenge cookie AFTER start: startOAuthCallback deliberately
  // clears STALE challenge cookies (phase51) before the flow's own
  // signIn.social sets the fresh one. Seeding here simulates that fresh set.
  await app.evaluate(async ({ session }, args) => {
    await session.defaultSession.cookies.set({
      url: args.base,
      name: '__Secure-neon-auth.session_challenge',
      value: args.value,
      path: '/',
      secure: true,
      sameSite: 'no_restriction',
    });
  }, { base: stub.base, value: CHALLENGE_VALUE });

  const seeded = await app.evaluate(
    async ({ session }, base) => (await session.defaultSession.cookies.get({ url: base })).map((c) => c.name),
    stub.base,
  );
  console.log(`[P522 test1] seeded cookie names=${JSON.stringify(seeded)}`);
  expect(seeded).toContain(CHALLENGE_NAME);

  // Simulate the browser landing on the loopback URL, verifier appended.
  const res = await loopbackFetch(started.callbackUrl, `&neon_auth_session_verifier=${VERIFIER}`);
  console.log(`[P522 test1] loopback http status=${res.status}`);
  expect(res.status).toBe(200);

  const status = await pollStatus(win, 'signed-in');
  console.log(`[P522 test1] getStatus=${JSON.stringify(status)}`);
  expect(status.status).toBe('signed-in');
  expect(status.email).toBe(EMAIL);

  // The proof: the stub saw the challenge cookie on the /get-session request.
  const recorded = stub.state.getSessionRequests;
  console.log(`[P522 test1] get-session requests=${JSON.stringify(recorded)}`);
  expect(recorded.length).toBeGreaterThanOrEqual(1);
  const withChallenge = recorded.find((r) => r.cookieNames.includes(CHALLENGE_NAME));
  console.log(`[P522 test1] challenge cookie attached=${withChallenge !== undefined} verifiers=${JSON.stringify(recorded.map((r) => r.verifier))}`);
  expect(withChallenge, 'the stub received the challenge cookie on /get-session').toBeTruthy();

  // Screenshot the signed-in account panel. Reload so the renderer re-reads
  // the vault (the direct IPC sign-in does not push React state).
  await win.reload();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.click('[data-header-accounts]');
  await win.waitForSelector('[data-account-panel]', { timeout: 10000 });
  const panelEmail = await win.locator('[data-account-panel-email]').textContent();
  expect(panelEmail).toContain(EMAIL);
  const shotPath = path.join(SHOTS, 'phase522-oauth-signed-in.png');
  await win.locator('[data-account-panel]').screenshot({ path: shotPath });
  console.log(`[P522 test1] screenshot=${shotPath}`);

  await closeStub(stub);
});

// ---------------------------------------------------------------------------
// Test 2 (oracle/negative, criterion 2's observable): with the challenge cookie
// WRONG the stub answers the reporter's exact 400 and the outcome is error.
// (A totally absent cookie would short-circuit at the main 'no-cookie' guard
// and never reach the stub, so a wrong value is seeded.)
// ---------------------------------------------------------------------------
test('P522 test 2: a wrong challenge cookie reproduces the provider 400 as an error outcome', async () => {
  const stub = await startStubAuth();
  process.env.TFLEX_AUTH_BASE_URL = stub.base;
  console.log(`[P522 test2] stub base=${stub.base}`);

  app = await launchApp([], null);
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  await win.evaluate(() => {
    window.__p522outcomes = [];
    window.tflex.accounts.onOAuthCallback((o) => window.__p522outcomes.push(o));
  });

  const started = await win.evaluate(() => window.tflex.accounts.startOAuthCallback());
  await app.evaluate(async ({ session }, args) => {
    await session.defaultSession.cookies.set({
      url: args.base,
      name: '__Secure-neon-auth.session_challenge',
      value: 'QA-522-WRONG',
      path: '/',
      secure: true,
      sameSite: 'no_restriction',
    });
  }, { base: stub.base });

  await loopbackFetch(started.callbackUrl, `&neon_auth_session_verifier=${VERIFIER}`);

  let outcome = null;
  for (let i = 0; i < 40; i += 1) {
    const arr = await win.evaluate(() => window.__p522outcomes || []);
    if (arr.length > 0) { outcome = arr[arr.length - 1]; break; }
    await win.waitForTimeout(500);
  }
  console.log(`[P522 test2] outcome=${JSON.stringify(outcome)}`);
  console.log(`[P522 test2] get-session requests=${JSON.stringify(stub.state.getSessionRequests)}`);
  expect(outcome, 'the renderer received an outcome').toBeTruthy();
  expect(outcome.ok).toBe(false);
  expect(outcome.reason).toBe('error');
  expect(outcome.message).toContain('Session challenge cookie not found');

  const status = await win.evaluate(() => window.tflex.accounts.getStatus());
  console.log(`[P522 test2] getStatus after failure=${JSON.stringify(status)}`);
  expect(status.status).toBe('signed-out');

  await closeStub(stub);
});

// ---------------------------------------------------------------------------
// Test 3 (offline/local-state sanity, criterion 5): the session stored by test 1
// is read from the LOCAL vault on a relaunch with the auth host unreachable.
// ---------------------------------------------------------------------------
test('P522 test 3: the signed-in state loads from local storage with the auth host unreachable', async () => {
  expect(TEST1_BASE, 'test 1 ran and stored a session first').not.toBeNull();
  process.env.TFLEX_AUTH_BASE_URL = TEST1_BASE;
  console.log(`[P522 test3] relaunch on stored vault; auth host dead at ${TEST1_BASE}`);

  app = await launchApp([], USER_DATA_DIR);
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  const status = await win.evaluate(() => window.tflex.accounts.getStatus());
  console.log(`[P522 test3] getStatus=${JSON.stringify(status)}`);
  expect(status.status).toBe('signed-in');
  expect(status.email).toBe(EMAIL);
});
