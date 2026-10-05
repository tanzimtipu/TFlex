// Phase 47 (qa) - the Google sign-in COMPLETION rule, verified against the
// PACKAGED build. Every launch goes through e2e/lib/launch.cjs.
//
// The operator's blocker was that the popup never closed when the flow landed
// on the app's loopback callback. The fix (Phase 47) taught the completion
// matcher `isLoopbackCompletionUrl` to recognise the exact loopback URL the
// flow minted (query ignored). A real Google round-trip needs a real account,
// so this spec proves the completion rule directly:
//
//   1. "Continue with Google" opens a popup that navigates auth-host -> Google
//      (the natural sequence, captured from the trace);
//   2. when the popup is driven to the flow's OWN minted loopback URL (the
//      landing the provider would produce), the popup CLOSES and the trace
//      records `popup-complete` + `loopback-hit`.
//
// The trace is read through the real `accounts:oauthTrace` bridge; only
// kinds/counts are printed (never a token, code or cookie value).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const PACKAGED_EXE =
  process.env.TFLEX_PACKAGED_EXE ||
  path.join(process.cwd(), 'release', 'win-unpacked', 'Jovrel.exe');

let app = null;
let win = null;
test.setTimeout(180000);

test.afterEach(async () => {
  if (app) await hardClose(app, 'p47-completion');
  app = null;
  win = null;
});

test('P47 packaged: popup closes when the flow lands on its minted loopback callback', async () => {
  app = await launchApp([], null, PACKAGED_EXE);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  const version = await app.evaluate(({ app: a }) => a.getVersion());
  console.log(`[P47 version] ${version}`);
  // DEF-557 - read the expected version from package.json instead of hardcoding
  // a release number, so this spec cannot go stale each release. The semver
  // shape check catches a malformed/unpackaged build; the equality check proves
  // the launched binary is the build under test.
  const expectedVersion = require('../package.json').version;
  expect(version, 'packaged build version is semver').toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  expect(version, 'packaged build version matches package.json').toBe(expectedVersion);

  // Subscribe to the real trace bridge BEFORE the flow starts.
  await win.evaluate(() => {
    window.__p47trace = [];
    window.tflex.accounts.onOAuthTrace((e) => window.__p47trace.push(e));
  });

  await win.locator('[data-header-accounts]').click();
  await win.waitForSelector('[data-accounts-auth]', { timeout: 15000 });

  // The Google flow mints its OWN loopback URL (the click calls
  // startOAuthCallback internally), so capture the real one from the
  // sign-in/social request body the SDK sends - that is the completion target.
  let minted = null;
  win.on('request', (r) => {
    if (!/sign-in\/social/.test(r.url())) return;
    const raw = r.postData() ?? '';
    try {
      const body = JSON.parse(raw);
      if (typeof body.callbackURL === 'string') minted = body.callbackURL;
    } catch (_) {
      const m = /callbackURL=([^&]+)/.exec(raw);
      if (m) minted = decodeURIComponent(m[1]);
    }
  });

  // Click Continue with Google: the popup opens on the auth host, which
  // redirects on to Google's authorize page.
  const popupPromise = app.waitForEvent('window', { timeout: 30000 }).catch(() => null);
  await win.locator('[data-accounts-google]').click();
  const popup = await popupPromise;
  expect(popup, 'a popup window opened').toBeTruthy();
  await win.waitForTimeout(6000);
  console.log(`[P47 minted] ${JSON.stringify(minted)}`);
  expect(minted, 'the flow minted a loopback callback URL').toMatch(/^http:\/\/localhost:\d+\/oauth\/callback\?token=/);

  const natural = await win.evaluate(() => window.__p47trace.map((e) => e.kind));
  console.log(`[P47 natural trace kinds] ${JSON.stringify(natural)}`);
  const popupUrl = popup.url();
  console.log(`[P47 popup url] ${popupUrl}`);
  expect(popupUrl, 'the popup reached Google').toContain('accounts.google.com');
  expect(natural, 'the trace recorded the popup opening').toContain('popup-open');
  expect(natural, 'the trace recorded popup navigation').toContain('popup-navigate');

  // Drive the popup to the flow's OWN minted loopback URL - exactly the
  // landing the provider's redirect would produce. The completion matcher must
  // recognise it and close the popup.
  const driven = await app.evaluate(({ BrowserWindow }, url) => {
    const wins = BrowserWindow.getAllWindows();
    const target = wins.find((w) => {
      const u = w.webContents.getURL();
      return u.length > 0 && !u.startsWith('file://');
    });
    if (!target) return { ok: false, count: wins.length, urls: wins.map((w) => w.webContents.getURL()) };
    target.loadURL(url).catch(() => {});
    return { ok: true, from: target.webContents.getURL() };
  }, minted);
  console.log(`[P47 driven] ${JSON.stringify(driven)}`);
  expect(driven.ok, 'the popup window was found and driven to the loopback URL').toBe(true);

  await win.waitForTimeout(4000);
  const mid = await win.evaluate(() => window.__p47trace);
  console.log(`[P47 post-drive trace] ${JSON.stringify(mid.map((e) => ({ k: e.kind, u: e.url, p: e.path, ec: e.errorCode, ed: e.errorDescription })))}`);
  console.log(`[P47 window count] ${app.windows().length}`);

  // The popup must close on its own.
  await expect
    .poll(async () => app.windows().length, { timeout: 15000, message: 'popup closed after the loopback landing' })
    .toBe(1);

  const after = await win.evaluate(() => window.__p47trace);
  const kinds = after.map((e) => e.kind);
  const counts = kinds.reduce((acc, k) => { acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
  console.log(`[P47 trace counts] ${JSON.stringify(counts)}`);
  console.log(`[P47 trace kinds] ${JSON.stringify(kinds)}`);
  expect(kinds, 'the completion matcher fired').toContain('popup-complete');
  expect(kinds, 'the loopback listener was reached').toContain('loopback-hit');
  expect(kinds, 'the popup close was traced').toContain('popup-closed');
  // The completion event carries the loopback URL, sanitized (no token).
  const complete = after.find((e) => e.kind === 'popup-complete');
  console.log(`[P47 popup-complete] ${JSON.stringify(complete)}`);
  expect(complete.url, 'the completion URL is the loopback origin+path, no token').toMatch(/^http:\/\/localhost:\d+\/oauth\/callback$/);
  expect(JSON.stringify(after), 'no token leaked into the trace').not.toContain('token=');
});

// ---------------------------------------------------------------------------
// Diagnostic: the SAME matcher, but with a WRONG token so the loopback listener
// refuses the hit (403) and does NOT clear the active flow. If the popup closes
// here but not in the test above, the root cause is the listener clearing the
// active callback URL before the popup's did-navigate event.
// ---------------------------------------------------------------------------
test('P47 diagnostic: popup closes on the loopback URL when the flow is still active (wrong token)', async () => {
  app = await launchApp([], null, PACKAGED_EXE);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  await win.evaluate(() => {
    window.__p47trace = [];
    window.tflex.accounts.onOAuthTrace((e) => window.__p47trace.push(e));
  });

  await win.locator('[data-header-accounts]').click();
  await win.waitForSelector('[data-accounts-auth]', { timeout: 15000 });

  let minted = null;
  win.on('request', (r) => {
    if (!/sign-in\/social/.test(r.url())) return;
    const raw = r.postData() ?? '';
    try {
      const body = JSON.parse(raw);
      if (typeof body.callbackURL === 'string') minted = body.callbackURL;
    } catch (_) { /* form-encoded */ }
  });

  const popupPromise = app.waitForEvent('window', { timeout: 30000 }).catch(() => null);
  await win.locator('[data-accounts-google]').click();
  const popup = await popupPromise;
  expect(popup, 'a popup window opened').toBeTruthy();
  await win.waitForTimeout(6000);
  expect(minted, 'the flow minted a loopback callback URL').toMatch(/^http:\/\/localhost:\d+\/oauth\/callback\?token=/);

  // Same origin+path, WRONG token: the listener refuses (403) and keeps the
  // flow active, so getLoopbackUrl() still returns the minted URL.
  const wrong = minted.replace(/token=.*$/, 'token=wrong-token');
  const driven = await app.evaluate(({ BrowserWindow }, url) => {
    const wins = BrowserWindow.getAllWindows();
    const target = wins.find((w) => {
      const u = w.webContents.getURL();
      return u.length > 0 && !u.startsWith('file://');
    });
    if (!target) return { ok: false };
    target.loadURL(url).catch(() => {});
    return { ok: true };
  }, wrong);
  expect(driven.ok, 'the popup was driven to the loopback URL').toBe(true);

  await expect
    .poll(async () => app.windows().length, { timeout: 15000, message: 'popup closed while the flow was still active' })
    .toBe(1);

  const after = await win.evaluate(() => window.__p47trace);
  const kinds = after.map((e) => e.kind);
  console.log(`[P47 diagnostic trace kinds] ${JSON.stringify(kinds)}`);
  expect(kinds, 'the completion matcher fired while the flow was active').toContain('popup-complete');
  expect(kinds, 'the popup close was traced').toContain('popup-closed');
});
