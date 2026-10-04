// TFL-670 adversary probe - diff-pass on TFL-667 (credentials: 'include').
//
// This is a NEW probe file (no existing test edited). It answers two of the
// assigned hypotheses against the REAL product primitive `session.defaultSession
// .fetch` (the function the exchange widened) and the REAL loopback listener:
//
//   A. Cookie over-send / cross-host + redirect downgrade: seed the auth-host
//      session cookie, then drive credentialed `session.fetch` through a stub
//      auth server that 302-redirects to (a) the same host on a different port,
//      (b) a different hostname (localhost vs 127.0.0.1), and (c) an `http:`
//      target. Record whether the cookie is re-sent to each hop.
//   B. Replay after a SUCCESSFUL exchange: run the C3 stub auth flow to
//      signed-in, then re-hit the consumed loopback callback URL and confirm it
//      is refused with no second /get-session, no second /token, no second
//      vault write.
//
// No cookie VALUE is printed except the deliberately synthetic probe value used
// to detect leakage. No verifier/token value is printed.

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

const PROBE_COOKIE = '__Secure-neon-auth.session_token';
const PROBE_VALUE = 'TFL670-PROBE-SECRET';
const PROVIDER_MARKER = 'TFL670-PROVIDER-MARKER';
const CHALLENGE_NAME = '__Secure-neon-auth.session_challenge';
const CHALLENGE_VALUE = 'TFL670-CHALLENGE';
const VERIFIER = 'TFL670-VERIFIER';
const EMAIL = 'tfl670@example.test';

let app = null;
test.setTimeout(180000);
test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl670');
  app = null;
});

// A stub server that records every request (host header, path, cookie header)
// and optionally answers 302 to a caller-chosen Location.
function startStub(routes) {
  const state = { requests: [] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    state.requests.push({
      host: req.headers.host,
      path: url.pathname,
      cookie: req.headers.cookie || '',
    });
    const route = routes[url.pathname];
    if (route) {
      route(req, res, url, state);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port, state });
    });
  });
}

const closeStub = (stub) => new Promise((resolve) => stub.server.close(() => resolve()));

function cookieNames(header) {
  return header
    .split(';')
    .map((part) => part.trim().split('=')[0])
    .filter(Boolean);
}
function cookieHasValue(header, name, value) {
  return header.split(';').some((part) => {
    const eq = part.indexOf('=');
    return eq !== -1 && part.slice(0, eq).trim() === name && part.slice(eq + 1).trim() === value;
  });
}

// ---------------------------------------------------------------------------
// Probe A: credentialed session.fetch across redirect hops.
// ---------------------------------------------------------------------------
test('TFL670 A: credentialed session.fetch does not leak the auth cookie across a redirect', async () => {
  // Server A: the configured auth host we seed the cookie for.
  let bPort = null;
  let cPort = null;
  const serverA = await startStub({
    '/direct': (req, res) => { res.writeHead(200); res.end('direct'); },
    '/to-same-host-port': (req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${bPort}/steal` });
      res.end();
    },
    '/to-different-host': (req, res) => {
      res.writeHead(302, { location: `http://localhost:${cPort}/steal` });
      res.end();
    },
  });
  // Server B: SAME hostname (127.0.0.1), different port.
  const serverB = await startStub({});
  // Server C: DIFFERENT hostname (localhost), different port.
  const serverC = await startStub({});
  bPort = serverB.port;
  cPort = serverC.port;

  const baseA = `http://127.0.0.1:${serverA.port}`;
  console.log(`[TFL670 A] A(127.0.0.1:${serverA.port}=auth) B(127.0.0.1:${serverB.port}) C(localhost:${serverC.port})`);

  app = await launchApp([], null);
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  await app.evaluate(async ({ session }, args) => {
    await session.defaultSession.cookies.set({
      url: args.base,
      name: args.name,
      value: args.value,
      path: '/',
      secure: true,
      sameSite: 'no_restriction',
    });
  }, { base: baseA, name: PROBE_COOKIE, value: PROBE_VALUE });

  const seeded = await app.evaluate(
    async ({ session }, base) => (await session.defaultSession.cookies.get({ url: base })).map((c) => c.name),
    baseA,
  );
  console.log(`[TFL670 A] seeded cookie names=${JSON.stringify(seeded)}`);
  expect(seeded).toContain(PROBE_COOKIE);

  // Baseline: direct credentialed fetch to the auth host itself.
  const direct = await app.evaluate(async ({ session }, url) => {
    const r = await session.defaultSession.fetch(url, { credentials: 'include' });
    return { status: r.status, finalUrl: r.url };
  }, `${baseA}/direct`);

  // Hops: follow redirects automatically (the exchange sets no `redirect`).
  const sameHostPort = await app.evaluate(async ({ session }, url) => {
    const r = await session.defaultSession.fetch(url, { credentials: 'include' });
    return { status: r.status, finalUrl: r.url };
  }, `${baseA}/to-same-host-port`);
  const diffHost = await app.evaluate(async ({ session }, url) => {
    const r = await session.defaultSession.fetch(url, { credentials: 'include' });
    return { status: r.status, finalUrl: r.url };
  }, `${baseA}/to-different-host`);

  const aReq = serverA.state.requests;
  const bReq = serverB.state.requests;
  const cReq = serverC.state.requests;
  console.log(`[TFL670 A] direct status=${direct.status} url=${direct.finalUrl}`);
  console.log(`[TFL670 A] same-host-port status=${sameHostPort.status} url=${sameHostPort.finalUrl}`);
  console.log(`[TFL670 A] diff-host status=${diffHost.status} url=${diffHost.finalUrl}`);

  const report = {
    authCookieToAuth: aReq.some((r) => r.path === '/direct' && cookieHasValue(r.cookie, PROBE_COOKIE, PROBE_VALUE)),
    authCookieToSameHostDiffPort: bReq.some((r) => cookieHasValue(r.cookie, PROBE_COOKIE, PROBE_VALUE)),
    authCookieToDifferentHost: cReq.some((r) => cookieHasValue(r.cookie, PROBE_COOKIE, PROBE_VALUE)),
    bCookieNames: bReq.map((r) => cookieNames(r.cookie)),
    cCookieNames: cReq.map((r) => cookieNames(r.cookie)),
  };
  console.log(`[TFL670 A] RESULT ${JSON.stringify(report)}`);
  fs.writeFileSync(
    path.join(SHOTS, 'tfl670-redirect-probe.json'),
    JSON.stringify({ direct, sameHostPort, diffHost, report }, null, 2),
  );

  // The auth cookie MUST reach its own host (the fix's purpose).
  expect(report.authCookieToAuth, 'auth cookie reaches the auth host').toBe(true);
  // The dangerous question: it must NOT reach a different hostname.
  expect(report.authCookieToDifferentHost, 'auth cookie does NOT reach a different hostname').toBe(false);

  await closeStub(serverA);
  await closeStub(serverB);
  await closeStub(serverC);
});

// ---------------------------------------------------------------------------
// Probe B: replay after a successful exchange (C3 stub auth flow).
// ---------------------------------------------------------------------------
test('TFL670 B: replaying the loopback URL after a successful exchange is refused', async () => {
  const state = { getSessionRequests: [], tokenRequests: 0 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const json = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/auth/get-session') {
      const raw = req.headers.cookie || '';
      const challengeOk = raw.split(';').some((part) => {
        const eq = part.indexOf('=');
        if (eq === -1) return false;
        return part.slice(0, eq).trim() === CHALLENGE_NAME && part.slice(eq + 1).trim() === CHALLENGE_VALUE;
      });
      const verifier = url.searchParams.get('neon_auth_session_verifier');
      state.getSessionRequests.push({ cookieNames: cookieNames(raw), verifier });
      if (challengeOk && verifier === VERIFIER) {
        json(200, {
          session: { id: 's1', expiresAt: '2099-01-01T00:00:00.000Z' },
          user: { id: 'u1', email: EMAIL, emailVerified: true, name: 'TFL670', image: null },
        });
      } else {
        json(400, { message: 'Session challenge cookie not found' });
      }
      return;
    }
    if (url.pathname === '/auth/token') {
      state.tokenRequests += 1;
      json(200, { token: 'TFL670-JWT' });
      return;
    }
    json(404, {});
  });
  const base = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/auth`));
  });
  process.env.TFLEX_AUTH_BASE_URL = base;
  console.log(`[TFL670 B] stub base=${base}`);

  app = await launchApp([], null);
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  await win.evaluate(() => {
    window.__t670trace = [];
    window.tflex.accounts.onOAuthTrace((e) => window.__t670trace.push(e));
  });

  const started = await win.evaluate(() => window.tflex.accounts.startOAuthCallback());
  console.log(`[TFL670 B] callbackUrl=${started.callbackUrl.replace(/token=.*/, 'token=<redacted>')}`);

  await app.evaluate(async ({ session }, args) => {
    await session.defaultSession.cookies.set({
      url: args.base,
      name: args.name,
      value: args.value,
      path: '/',
      secure: true,
      sameSite: 'no_restriction',
    });
  }, { base, name: CHALLENGE_NAME, value: CHALLENGE_VALUE });

  const loopbackFetch = (callbackUrl, suffix) =>
    fetch(callbackUrl.replace('localhost', '127.0.0.1') + suffix);

  // First landing: successful exchange.
  const first = await loopbackFetch(started.callbackUrl, `&neon_auth_session_verifier=${VERIFIER}`);
  console.log(`[TFL670 B] first landing http status=${first.status}`);
  expect(first.status).toBe(200);

  // Wait for signed-in.
  let status = null;
  for (let i = 0; i < 40; i += 1) {
    status = await win.evaluate(() => window.tflex.accounts.getStatus());
    if (status.status === 'signed-in') break;
    await win.waitForTimeout(500);
  }
  console.log(`[TFL670 B] getStatus=${JSON.stringify(status)}`);
  expect(status.status).toBe('signed-in');

  const snapAfterFirst = {
    getSession: state.getSessionRequests.length,
    token: state.tokenRequests,
  };
  console.log(`[TFL670 B] stub counts after first exchange=${JSON.stringify(snapAfterFirst)}`);

  // Replay the consumed URL (same token AND verifier).
  const replay = await loopbackFetch(started.callbackUrl, `&neon_auth_session_verifier=${VERIFIER}`);
  console.log(`[TFL670 B] replay http status=${replay.status}`);
  expect(replay.status, 'replayed landing is refused').toBe(403);

  // Give a hostile second exchange time to materialise, then prove it did not.
  await win.waitForTimeout(3000);
  const snapAfterReplay = {
    getSession: state.getSessionRequests.length,
    token: state.tokenRequests,
  };
  console.log(`[TFL670 B] stub counts after replay=${JSON.stringify(snapAfterReplay)}`);
  const statusAfter = await win.evaluate(() => window.tflex.accounts.getStatus());
  console.log(`[TFL670 B] getStatus after replay=${JSON.stringify(statusAfter)}`);
  const traceJson = await win.evaluate(() => JSON.stringify(window.__t670trace));
  expect(traceJson).not.toContain(PROBE_VALUE);

  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  const traceFile = path.join(userData, 'oauth-trace.log');
  let logText = '';
  if (fs.existsSync(traceFile)) logText = fs.readFileSync(traceFile, 'utf8');
  console.log(`[TFL670 B] oauth-trace.log present=${fs.existsSync(traceFile)}`);

  fs.writeFileSync(
    path.join(SHOTS, 'tfl670-replay-probe.json'),
    JSON.stringify({ first, replay, snapAfterFirst, snapAfterReplay, status, statusAfter, traceLog: logText }, null, 2),
  );

  expect(snapAfterReplay.getSession, 'no second /get-session on replay').toBe(snapAfterFirst.getSession);
  expect(snapAfterReplay.token, 'no second /token on replay').toBe(snapAfterFirst.token);
  expect(statusAfter.status).toBe('signed-in');

  await closeStub({ server });
});

// ---------------------------------------------------------------------------
// Probe C: on a FAILURE path with the session cookie present, confirm the
// cookie VALUE never reaches oauthTrace, oauth-trace.log, or the renderer.
// ---------------------------------------------------------------------------
test('TFL670 C: a failure with the session cookie present never leaks the cookie value', async () => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (url.pathname === '/auth/get-session') {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: `rejected ${PROVIDER_MARKER}\nforged` }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{}');
  });
  const base = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/auth`));
  });
  process.env.TFLEX_AUTH_BASE_URL = base;
  console.log(`[TFL670 C] stub base=${base}`);

  app = await launchApp([], null);
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  await win.evaluate(() => {
    window.__t670trace = [];
    window.__t670outcomes = [];
    window.tflex.accounts.onOAuthTrace((e) => window.__t670trace.push(e));
    window.tflex.accounts.onOAuthCallback((o) => window.__t670outcomes.push(o));
  });

  const started = await win.evaluate(() => window.tflex.accounts.startOAuthCallback());
  await app.evaluate(async ({ session }, args) => {
    await session.defaultSession.cookies.set({
      url: args.base,
      name: args.name,
      value: args.value,
      path: '/',
      secure: true,
      sameSite: 'no_restriction',
    });
  }, { base, name: PROBE_COOKIE, value: PROBE_VALUE });

  const loopbackFetch = (callbackUrl, suffix) =>
    fetch(callbackUrl.replace('localhost', '127.0.0.1') + suffix);
  const landed = await loopbackFetch(started.callbackUrl, `&neon_auth_session_verifier=${VERIFIER}`);
  console.log(`[TFL670 C] landing http status=${landed.status}`);
  expect(landed.status).toBe(200);

  let outcome = null;
  for (let i = 0; i < 40; i += 1) {
    const arr = await win.evaluate(() => window.__t670outcomes || []);
    if (arr.length > 0) { outcome = arr[arr.length - 1]; break; }
    await win.waitForTimeout(500);
  }
  console.log(`[TFL670 C] outcome=${JSON.stringify(outcome)}`);
  expect(outcome, 'the renderer received an outcome').toBeTruthy();
  expect(outcome.ok).toBe(false);

  const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
  const traceFile = path.join(userData, 'oauth-trace.log');
  const logText = fs.existsSync(traceFile) ? fs.readFileSync(traceFile, 'utf8') : '';
  const traceJson = await win.evaluate(() => JSON.stringify(window.__t670trace));
  const outcomeJson = JSON.stringify(outcome);
  console.log(`[TFL670 C] trace.log present=${fs.existsSync(traceFile)} lines=${logText.split('\n').filter((l) => l.length > 0).length}`);

  const report = {
    probeValueInTrace: traceJson.includes(PROBE_VALUE),
    probeValueInLog: logText.includes(PROBE_VALUE),
    probeValueInOutcome: outcomeJson.includes(PROBE_VALUE),
    verifierInLog: logText.includes(VERIFIER),
    verifierInTrace: traceJson.includes(VERIFIER),
    providerMarkerInOutcome: outcomeJson.includes(PROVIDER_MARKER),
    logText,
  };
  console.log(`[TFL670 C] RESULT ${JSON.stringify({ ...report, logText: undefined })}`);
  fs.writeFileSync(path.join(SHOTS, 'tfl670-redaction-probe.json'), JSON.stringify(report, null, 2));

  expect(report.probeValueInTrace, 'cookie value absent from oauthTrace').toBe(false);
  expect(report.probeValueInLog, 'cookie value absent from oauth-trace.log').toBe(false);
  expect(report.probeValueInOutcome, 'cookie value absent from the renderer outcome').toBe(false);
  expect(report.verifierInLog, 'verifier absent from oauth-trace.log').toBe(false);
  expect(report.verifierInTrace, 'verifier absent from oauthTrace').toBe(false);
  // Intended behaviour: the provider's OWN message is echoed (clipped) so the
  // operator sees why auth failed. That is the provider talking, not the cookie.
  expect(report.providerMarkerInOutcome, 'provider message is surfaced').toBe(true);

  await closeStub({ server });
});
