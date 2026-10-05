// Phase 46 (qa) - the account-surface network fixes, verified against the
// RUNNING dev build. Every launch goes through e2e/lib/launch.cjs launchApp.
//
// What this proves, live:
//   1. the auth request the app makes carries an injected `Origin` header for
//      the auth host (the packaged renderer is file:// and sends none), and the
//      provider answers with a credential/validation error - NOT MISSING_ORIGIN;
//   2. a registration with an invalid email / short password surfaces a
//      validation message, never the generic "Something went wrong";
//   3. the loopback callback URL main mints is
//      http://localhost:<port>/oauth/callback?token=... and the provider accepts
//      it (the social-init call returns 200);
//   4. "Continue with Google" opens a popup on the auth host, and the popup
//      allowlist still denies every other host.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const AUTH_HOST_RE = /neonauth\.c-\d+\.ap-southeast-1\.aws\.neon\.tech/i;

// DEF-560 / DEF-562: never print a token-bearing URL. Mirrors
// `sanitizeUrlForTrace` (src/main/services/accounts/oauth-trace.ts): scheme +
// host + pathname only, dropping the query and hash. Non-URLs pass through a
// placeholder so an argument such as `_blank` is still visible without lying.
function redactUrl(raw) {
  try {
    const u = new URL(String(raw));
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '<not-a-url>';
  }
}

// Redacts every URL embedded in free text (e.g. a provider response body that
// echoes the callback URL). Assertions still use the raw values.
function redactText(text) {
  return String(text).replace(/https?:\/\/[^\s"'`\\]+/gi, (m) => redactUrl(m));
}

let app = null;
let win = null;
test.setTimeout(180000);

test.afterEach(async () => {
  if (app) await hardClose(app, 'p46-origin');
  app = null;
  win = null;
});

async function launch() {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  return win;
}

async function openAccounts() {
  await win.locator('[data-header-accounts]').click();
  await win.waitForSelector('[data-accounts-auth]', { timeout: 15000 });
}

// Capture the headers ACTUALLY sent on the wire (after main's webRequest
// onBeforeSendHeaders) plus the response status, via raw CDP.
async function startNetworkCapture(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const byId = new Map();
  const order = [];
  cdp.on('Network.requestWillBeSent', (ev) => {
    const rec = { url: ev.request.url, rendererHeaders: ev.request.headers, extraHeaders: null, status: null };
    byId.set(ev.requestId, rec);
    order.push(rec);
  });
  cdp.on('Network.requestWillBeSentExtraInfo', (ev) => {
    const rec = byId.get(ev.requestId);
    if (rec) rec.extraHeaders = ev.headers;
  });
  cdp.on('Network.responseReceived', (ev) => {
    const rec = byId.get(ev.requestId);
    if (rec) rec.status = ev.response.status;
  });
  return { cdp, order };
}

function authRequests(order) {
  return order.filter((r) => AUTH_HOST_RE.test(r.url));
}

function headerValue(headers, name) {
  if (!headers) return null;
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) return headers[key];
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1. Origin injection + provider response on the sign-in request.
// ---------------------------------------------------------------------------
test('P46-1 auth request carries an injected Origin; provider answers a credential error, not MISSING_ORIGIN', async () => {
  await launch();
  const { cdp, order } = await startNetworkCapture(win);
  const responses = [];
  win.on('response', async (res) => {
    if (AUTH_HOST_RE.test(res.url())) {
      let body = '';
      try { body = await res.text(); } catch (_) { /* body unavailable */ }
      responses.push({ url: res.url(), status: res.status(), body });
    }
  });

  await openAccounts();
  await win.locator('[data-accounts-email]').fill('qa-phase46-origin@example.invalid');
  await win.locator('[data-accounts-password]').fill('not-a-real-password-123');
  await win.locator('[data-accounts-submit]').click();
  await win.waitForSelector('[data-accounts-banner]', { timeout: 30000 });
  await win.waitForTimeout(800);

  const banner = (await win.locator('[data-accounts-banner]').first().textContent()) ?? '';
  const reqs = authRequests(order);
  console.log(`[P46-1 banner] ${JSON.stringify(redactText(banner))}`);
  console.log(`[P46-1 authRequests] ${JSON.stringify(reqs.map((r) => ({ url: redactUrl(r.url), status: r.status, rendererOrigin: headerValue(r.rendererHeaders, 'origin'), wireOrigin: headerValue(r.extraHeaders, 'origin') })))}`);
  console.log(`[P46-1 responses] ${JSON.stringify(responses.map((r) => ({ url: redactUrl(r.url), status: r.status, body: redactText(r.body).slice(0, 300) })))}`);

  expect(reqs.length, 'the renderer reached the auth host').toBeGreaterThan(0);
  const signIn = reqs.find((r) => /sign-in\/email/.test(r.url)) ?? reqs[0];
  const wireOrigin = headerValue(signIn.extraHeaders, 'origin');
  console.log(`[P46-1 wireOrigin] ${JSON.stringify(redactUrl(wireOrigin))}`);
  expect(wireOrigin, 'the wire request carries the injected trusted Origin').toBe('http://localhost:5173');

  const resp = responses.find((r) => /sign-in\/email/.test(r.url)) ?? responses[0];
  console.log(`[P46-1 provider status] ${resp ? resp.status : 'none'}`);
  expect(resp, 'the provider answered the auth request').toBeTruthy();
  expect(resp.body, 'the provider did NOT refuse with MISSING_ORIGIN').not.toContain('MISSING_ORIGIN');
  expect(resp.body, 'the provider did NOT refuse with Missing or null Origin').not.toContain('Missing or null Origin');
  // A credential rejection (401) is the honest outcome for bogus credentials.
  expect([400, 401, 403], `provider status ${resp.status}`).toContain(resp.status);

  // The banner is the honest surfacing: the credential copy for a 401, or the
  // provider's verbatim reason for any other refusal - never the false offline.
  expect(banner, 'no false offline text').not.toContain('offline');
  console.log(`[P46-1 verdict] status=${resp.status} banner=${JSON.stringify(redactText(banner))}`);
  await cdp.detach();
});

// ---------------------------------------------------------------------------
// 2. Registration with an invalid email -> a validation message, not the
//    generic "Something went wrong".
// ---------------------------------------------------------------------------
test('P46-2a registration with an invalid email -> validation message, not "Something went wrong"', async () => {
  await launch();
  await openAccounts();
  await win.locator('[data-accounts-mode-signup]').click();
  await win.waitForSelector('[data-accounts-name]', { timeout: 8000 });
  await win.locator('[data-accounts-name]').fill('QA Phase46');
  await win.locator('[data-accounts-email]').fill('not-an-email');
  await win.locator('[data-accounts-password]').fill('validpassword123');
  await win.locator('[data-accounts-submit]').click();
  await win.waitForSelector('[data-accounts-banner]', { timeout: 15000 });
  const banner = (await win.locator('[data-accounts-banner]').first().textContent()) ?? '';
  console.log(`[P46-2a banner] ${JSON.stringify(redactText(banner))}`);
  await win.screenshot({ path: 'screenshots/phase46-packaged-invalid-email-banner.png' });
  expect(banner, 'a validation message is shown').toContain('valid email');
  expect(banner, 'never the generic failure').not.toContain('Something went wrong');
});

test('P46-2b registration with a short password -> validation message, not "Something went wrong"', async () => {
  await launch();
  await openAccounts();
  await win.locator('[data-accounts-mode-signup]').click();
  await win.waitForSelector('[data-accounts-name]', { timeout: 8000 });
  await win.locator('[data-accounts-name]').fill('QA Phase46');
  await win.locator('[data-accounts-email]').fill('qa-phase46-short@example.invalid');
  await win.locator('[data-accounts-password]').fill('short');
  await win.locator('[data-accounts-submit]').click();
  await win.waitForSelector('[data-accounts-banner]', { timeout: 15000 });
  const banner = (await win.locator('[data-accounts-banner]').first().textContent()) ?? '';
  console.log(`[P46-2b banner] ${JSON.stringify(redactText(banner))}`);
  await win.screenshot({ path: 'screenshots/phase46-packaged-short-password-banner.png' });
  expect(banner, 'a validation message is shown').toContain('at least 8 characters');
  expect(banner, 'never the generic failure').not.toContain('Something went wrong');
});

// ---------------------------------------------------------------------------
// 2c. The SIGN-UP route carries the injected Origin and the provider answers a
//     real validation error, not MISSING_ORIGIN. A 200-char password passes the
//     local 8-char floor but the provider rejects it (PASSWORD_TOO_LONG, max
//     128) BEFORE creating any account, so this is safe to send.
// ---------------------------------------------------------------------------
test('P46-2c the sign-up request carries the injected Origin; provider answers PASSWORD_TOO_LONG, not MISSING_ORIGIN', async () => {
  await launch();
  const { cdp, order } = await startNetworkCapture(win);
  const responses = [];
  win.on('response', async (res) => {
    if (AUTH_HOST_RE.test(res.url())) {
      let body = '';
      try { body = await res.text(); } catch (_) { /* body unavailable */ }
      responses.push({ url: res.url(), status: res.status(), body });
    }
  });

  await openAccounts();
  await win.locator('[data-accounts-mode-signup]').click();
  await win.waitForSelector('[data-accounts-name]', { timeout: 8000 });
  await win.locator('[data-accounts-name]').fill('QA Phase46');
  await win.locator('[data-accounts-email]').fill('qa-phase46-signup@example.invalid');
  await win.locator('[data-accounts-password]').fill('x'.repeat(200));
  await win.locator('[data-accounts-submit]').click();
  await win.waitForSelector('[data-accounts-banner]', { timeout: 30000 });
  await win.waitForTimeout(800);

  const banner = (await win.locator('[data-accounts-banner]').first().textContent()) ?? '';
  const signup = authRequests(order).find((r) => /sign-up\/email/.test(r.url));
  const resp = responses.find((r) => /sign-up\/email/.test(r.url));
  console.log(`[P46-2c signupReq] ${JSON.stringify(signup ? { url: redactUrl(signup.url), status: signup.status, rendererOrigin: headerValue(signup.rendererHeaders, 'origin'), wireOrigin: headerValue(signup.extraHeaders, 'origin') } : null)}`);
  console.log(`[P46-2c allAuthResponses] ${JSON.stringify(responses.map((r) => ({ url: redactUrl(r.url), status: r.status, body: redactText(r.body).slice(0, 200) })))}`);
  console.log(`[P46-2c banner] ${JSON.stringify(redactText(banner))}`);

  expect(signup, 'the sign-up request was made').toBeTruthy();
  expect(headerValue(signup.rendererHeaders, 'origin'), 'the renderer itself sent no Origin').toBeNull();
  expect(headerValue(signup.extraHeaders, 'origin'), 'the sign-up request carries the injected Origin on the wire').toBe('http://localhost:5173');
  expect(resp, 'the provider answered the sign-up request').toBeTruthy();
  expect(resp.body, 'the provider did NOT refuse with MISSING_ORIGIN').not.toContain('MISSING_ORIGIN');
  expect(resp.body, 'the provider did NOT refuse with Missing or null Origin').not.toContain('Missing or null Origin');
  expect(resp.body, 'the provider rejected the too-long password').toContain('PASSWORD_TOO_LONG');
  // The honest surfacing: the provider's real reason, never the generic failure.
  expect(banner, 'never the generic failure').not.toContain('Something went wrong');
  expect(banner, 'the provider reason is surfaced').toMatch(/too long|security requirements|WEAK_PASSWORD|PASSWORD_TOO_LONG/i);
  await cdp.detach();
});

// ---------------------------------------------------------------------------
// 3. The loopback URL main mints + the provider accepting it (social-init 200).
// ---------------------------------------------------------------------------
test('P46-3 loopback URL is http://localhost:<port>/oauth/callback?token=... and the provider accepts it (social-init 200)', async () => {
  await launch();
  const { cdp, order } = await startNetworkCapture(win);
  const responses = [];
  win.on('response', async (res) => {
    if (AUTH_HOST_RE.test(res.url())) {
      let body = '';
      try { body = await res.text(); } catch (_) { /* body unavailable */ }
      responses.push({ url: res.url(), status: res.status(), body });
    }
  });

  await openAccounts();

  // Record the popup's INITIAL navigation from the main process: the auth host
  // redirects straight on to Google, so the renderer-side URL is already
  // accounts.google.com by the time Playwright sees the page.
  await app.evaluate(({ app: electronApp }) => {
    globalThis.__p46PopupNavs = [];
    electronApp.on('web-contents-created', (_e, wc) => {
      wc.on('did-start-navigation', (_ev, url) => {
        globalThis.__p46PopupNavs.push(url);
      });
    });
  });

  // The URL main mints, captured directly from the bridge.
  const minted = await win.evaluate(() => window.tflex.accounts.startOAuthCallback());
  console.log(`[P46-3 minted] ${JSON.stringify(minted && minted.callbackUrl ? redactUrl(minted.callbackUrl) : minted)}`);
  await win.evaluate(() => window.tflex.accounts.stopOAuthCallback());
  expect(minted.callbackUrl, 'the minted URL uses the provider-trusted localhost host').toMatch(/^http:\/\/localhost:\d+\/oauth\/callback\?token=/);

  // The social-init call the app makes when "Continue with Google" is clicked.
  const popupPromise = app.waitForEvent('window', { timeout: 30000 }).catch(() => null);
  await win.locator('[data-accounts-google]').click();
  await win.waitForTimeout(6000);

  const social = authRequests(order).find((r) => /sign-in\/social/.test(r.url));
  console.log(`[P46-3 socialReq] ${JSON.stringify(social ? { url: redactUrl(social.url), status: social.status, wireOrigin: headerValue(social.extraHeaders, 'origin') } : null)}`);
  const socialResp = responses.find((r) => /sign-in\/social/.test(r.url));
  console.log(`[P46-3 socialResp] ${JSON.stringify(socialResp ? { status: socialResp.status, body: redactText(socialResp.body).slice(0, 400) } : null)}`);
  expect(social, 'the app made the social-init call').toBeTruthy();
  expect(socialResp, 'the provider answered the social-init call').toBeTruthy();
  expect(socialResp.status, 'the provider accepted the loopback callback URL').toBe(200);
  expect(socialResp.body, 'the provider did not refuse the callback URL').not.toContain('INVALID_CALLBACKURL');
  expect(socialResp.body, 'the provider did not refuse the callback URL').not.toContain('BAD_OAUTH_CALLBACK');

  // The popup opened on the auth host (its initial navigation), then the auth
  // host redirected on to Google's authorize page.
  const popup = await popupPromise;
  const popupNavs = await app.evaluate(() => globalThis.__p46PopupNavs ?? []);
  console.log(`[P46-3 popupNavs] ${JSON.stringify(popupNavs.map(redactUrl))}`);
  expect(popup, 'a popup window opened').toBeTruthy();
  const firstNav = popupNavs[0] ?? '';
  expect(firstNav, 'the popup first navigated to the auth host').toMatch(AUTH_HOST_RE);
  if (popup) {
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    const popupUrl = popup.url();
    console.log(`[P46-3 popup final] ${redactUrl(popupUrl)}`);
    expect(popupUrl, 'the auth host redirected the popup to Google').toContain('accounts.google.com');
    await popup.close().catch(() => {});
  }
  await cdp.detach();
});

// ---------------------------------------------------------------------------
// 4. The popup allowlist denies every non-auth host.
// ---------------------------------------------------------------------------
test('P46-4 popup allowlist denies a non-auth host', async () => {
  await launch();
  await openAccounts();
  const denied = await win.evaluate(() => {
    const other = window.open('https://example.com/', '_blank');
    const httpAuth = window.open('http://ep-fragrant-pond-b3gqd6cf.neonauth.c-4.ap-southeast-1.aws.neon.tech/', '_blank');
    return { other: other === null, httpAuth: httpAuth === null };
  });
  console.log(`[P46-4 denied] ${JSON.stringify(denied)}`);
  expect(denied.other, 'a different https host is denied').toBe(true);
  expect(denied.httpAuth, 'http on the auth host is denied').toBe(true);
  await win.waitForTimeout(1000);
  const windows = app.windows().length;
  console.log(`[P46-4 windowCount] ${windows}`);
  expect(windows, 'no popup window was created for a denied host').toBe(1);
});
