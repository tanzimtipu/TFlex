// TFL-751 / Phase 102 (qa) - Google sign-in opens an IN-APP child window bound
// to the app session, NOT the OS default browser. This is the focused
// regression guard for the Phase 102 change (DEF-554).
//
// Before C3 the renderer handed the provider URL to `accounts:openAuthUrl`,
// which called `shell.openExternal` and created no in-app window. This spec
// FAILS on that code: (a) the shell received the auth-host URL, and (b) no
// in-app window opened. After C3 the renderer calls `window.open`, the app's
// auth-popup handler allows only https on the configured auth host, and no
// shell call is made.
//
// No cookie/token/code value is ever printed - trace KINDS only.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const AUTH_HOST = 'ep-fragrant-pond-b3gqd6cf.neonauth.c-4.ap-southeast-1.aws.neon.tech';

// DEF-560 / ADV-212: never print a token-bearing URL. Mirrors
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

let app = null;
let win = null;
test.setTimeout(180000);

test.afterEach(async () => {
  if (app) await hardClose(app, 't751-inapp');
  app = null;
  win = null;
});

test('T751: Google opens an in-app auth window (no shell.openExternal) and completes the exchange step', async () => {
  // DEF-555 isolation now lives in e2e/phase522_oauth_exchange.spec.cjs
  // (afterAll restores the prior TFLEX_AUTH_BASE_URL), so this spec no longer
  // needs its defensive delete; order-independence is proven by the spec pair.
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  // Main-process recorder: proves the shell is never handed the auth URL.
  await app.evaluate(({ shell }) => {
    globalThis.__t751shell = { opened: [] };
    shell.openExternal = async (url) => { globalThis.__t751shell.opened.push(url); };
  });

  // Renderer recorder: captures the exact URL window.open is called with.
  await win.evaluate(() => {
    window.__t751open = [];
    const orig = window.open;
    window.open = (...args) => { window.__t751open.push(args.map((a) => String(a))); return orig.apply(window, args); };
  });

  // Subscribe to the real trace bridge BEFORE the flow starts.
  await win.evaluate(() => {
    window.__t751trace = [];
    window.tflex.accounts.onOAuthTrace((e) => window.__t751trace.push(e));
  });

  await win.locator('[data-header-accounts]').click();
  await win.waitForSelector('[data-accounts-auth]', { timeout: 15000 });

  // Capture the flow's own minted loopback URL from the SDK's social-init body.
  let minted = null;
  win.on('request', (r) => {
    if (!/sign-in\/social/.test(r.url())) return;
    const raw = r.postData() ?? '';
    try {
      const body = JSON.parse(raw);
      if (typeof body.callbackURL === 'string') minted = body.callbackURL;
    } catch (_) { /* form-encoded */ }
  });

  const beforeWindows = app.windows().length;
  await win.locator('[data-accounts-google]').click();

  await expect
    .poll(async () => app.windows().length, { timeout: 20000, message: 'an in-app sign-in window opened' })
    .toBeGreaterThan(beforeWindows);

  // (a) The OS shell never received the auth-host URL.
  const shellOpened = await app.evaluate(() => globalThis.__t751shell.opened.slice());
  console.log(`[T751] shell.openExternal urls: ${JSON.stringify(shellOpened.map(redactUrl))}`);
  expect(shellOpened.filter((u) => u.includes(AUTH_HOST)), 'shell.openExternal received NO auth-host URL').toEqual([]);

  // (b) window.open was called with the auth-host URL.
  const openArgs = await win.evaluate(() => window.__t751open);
  console.log(`[T751] window.open calls: ${JSON.stringify(openArgs.map((a) => a.map(redactUrl)))}`);
  const authCall = openArgs.find((a) => typeof a[0] === 'string' && a[0].includes(AUTH_HOST));
  expect(authCall, 'window.open was called with the auth-host URL').toBeTruthy();

  await win.waitForTimeout(4000);
  console.log(`[T751] minted=${JSON.stringify(redactUrl(minted))}`);
  expect(minted, 'the flow minted a loopback callback URL').toMatch(/^http:\/\/(localhost|127\.0\.0\.1):\d+\/oauth\/callback\?token=/);

  // Drive the popup to the flow's OWN minted loopback URL - the landing the
  // provider's redirect would produce - and assert it closes and the exchange
  // step is reached.
  const driven = await app.evaluate(({ BrowserWindow }, url) => {
    const wins = BrowserWindow.getAllWindows();
    const target = wins.find((w) => {
      const u = w.webContents.getURL();
      return u.length > 0 && !u.startsWith('file://');
    });
    if (!target) return { ok: false, count: wins.length };
    target.loadURL(url).catch(() => {});
    return { ok: true };
  }, minted);
  console.log(`[T751] driven=${JSON.stringify(driven)}`);
  expect(driven.ok, 'the popup was found and driven to the loopback URL').toBe(true);

  await expect
    .poll(async () => app.windows().length, { timeout: 15000, message: 'the popup closed on the loopback landing' })
    .toBe(1);

  const kinds = await win.evaluate(() => (window.__t751trace || []).map((e) => e.kind));
  console.log(`[T751] trace kinds: ${JSON.stringify(kinds)}`);
  expect(kinds, 'the loopback listener was reached').toContain('loopback-hit');
  const exchangeKinds = ['exchange-cookies', 'exchange-get-session', 'exchange-failed', 'exchange-stored'];
  expect(kinds.some((k) => exchangeKinds.includes(k)), 'the trace reached the exchange step').toBe(true);
});
