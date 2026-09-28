// Phase 50 (qa gate) - browser sign-in, the SECURE URL opener, and the
// default-PDF-app affordance, verified against the DEV build.
//
// Criterion 1: "Continue with Google" hands the provider URL to
//   `accounts:openAuthUrl` (never `window.open`); main validates it and calls
//   `shell.openExternal`; no in-app popup window is created.
// Criterion 2: the URL opener REFUSES every non-auth-host / non-https /
//   malformed / non-string payload and never hands it to the OS.
// Criterion 3: the copy names the browser; the loopback page tells the user to
//   close the browser tab; the app is not blocked.
// Criterion 4: Preferences opens Windows' Default-apps settings and reports
//   honestly (never claims the default changed).
//
// The OS call is observed by replacing `shell.openExternal` in the MAIN process
// with a recorder, so no real browser / Settings window is opened and no
// Windows default is touched.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const AUTH_HOST = 'ep-fragrant-pond-b3gqd6cf.neonauth.c-4.ap-southeast-1.aws.neon.tech';
const AUTH_URL = `https://${AUTH_HOST}/sign-in/social?provider=google`;

let app = null;
let win = null;
test.setTimeout(180000);

test.afterEach(async () => {
  if (app) await hardClose(app, 'p50');
  app = null;
  win = null;
});

async function installShellSpy(electronApp) {
  await electronApp.evaluate(({ shell }) => {
    globalThis.__p50 = { opened: [], mode: 'record' };
    shell.openExternal = async (url) => {
      if (globalThis.__p50.mode === 'reject') throw new Error('p50-stub-reject');
      globalThis.__p50.opened.push(url);
    };
  });
}
async function openedUrls(electronApp) {
  return electronApp.evaluate(() => globalThis.__p50.opened.slice());
}
async function setShellMode(electronApp, mode) {
  await electronApp.evaluate((_electron, m) => { globalThis.__p50.mode = m; }, mode);
}

test('P50 C1+C2: Google opens the browser via openAuthUrl; the opener refuses every hostile URL', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await installShellSpy(app);

  // The renderer must expose the browser opener, and must NOT use window.open.
  const hasOpener = await win.evaluate(() => typeof window.tflex?.accounts?.openAuthUrl === 'function');
  expect(hasOpener, 'window.tflex.accounts.openAuthUrl is exposed').toBe(true);
  await win.evaluate(() => {
    window.__p50open = [];
    const orig = window.open;
    window.open = (...args) => { window.__p50open.push(args.map((a) => String(a))); return orig.apply(window, args); };
  });

  await win.locator('[data-header-accounts]').click();
  await win.waitForSelector('[data-accounts-auth]', { timeout: 15000 });
  await win.locator('[data-accounts-google]').click();

  // The provider URL reaches the OS shell (through openAuthUrl -> validation).
  await expect
    .poll(async () => (await openedUrls(app)).length, { timeout: 60000, message: 'shell.openExternal received the provider URL' })
    .toBeGreaterThan(0);
  const opened = await openedUrls(app);
  console.log(`[P50 C1] shell.openExternal urls: ${JSON.stringify(opened)}`);
  expect(opened[0], 'the OS call is the provider URL on the configured auth host').toMatch(
    new RegExp(`^https://${AUTH_HOST.replace(/\./g, '\\.')}/`),
  );

  // No in-app popup: no window.open call, and no second BrowserWindow.
  const openCalls = await win.evaluate(() => window.__p50open);
  console.log(`[P50 C1] window.open calls: ${JSON.stringify(openCalls)}`);
  expect(openCalls, 'the renderer did not call window.open for auth').toEqual([]);
  expect(app.windows().length, 'no in-app popup window was created').toBe(1);

  // The in-flight copy names the BROWSER.
  const banner = await win.locator('[data-accounts-banner]').first().textContent();
  console.log(`[P50 C3] in-flight banner: ${JSON.stringify(banner)}`);
  expect(banner).toContain('in your browser');
  await win.screenshot({ path: 'screenshots/phase50-browser-signin.png' });

  // The deny-by-default popup rule is still intact: a non-auth window.open is
  // denied and creates no window.
  await win.evaluate(() => { window.open('https://evil.example.com/', '_blank'); });
  await win.waitForTimeout(800);
  expect(app.windows().length, 'the deny-by-default popup rule refused the foreign URL').toBe(1);

  // The app is not blocked: the dialog closes and the workspace is reachable.
  await win.locator('[data-accounts-close]').click();
  await win.waitForSelector('[data-accounts-auth]', { state: 'detached', timeout: 8000 });
  await expect(win.locator('.sample-card').first()).toBeVisible();

  // ---- Criterion 2: the attack table -------------------------------------
  const before = (await openedUrls(app)).length;
  const payloads = [
    'https://evil.example.com/',
    `https://sub.${AUTH_HOST}/`,
    `http://${AUTH_HOST}/`,
    'javascript:alert(1)',
    'file:///C:/Windows/win.ini',
    'data:text/html,<h1>x</h1>',
    'not a url at all',
    '',
    '   ',
    null,
    42,
    {},
    [],
    'https://user@evil.example/',
    'https://ep-fragrant-pond-b3gqd6cf.evil.example/',
    `https://${AUTH_HOST}.evil.example/`,
  ];
  const results = await win.evaluate(async (list) => {
    const out = [];
    for (const p of list) {
      try {
        out.push({ payload: p, result: await window.tflex.accounts.openAuthUrl(p) });
      } catch (e) {
        out.push({ payload: p, result: { threw: String(e) } });
      }
    }
    return out;
  }, payloads);
  for (const r of results) {
    console.log(`[P50 C2] ${JSON.stringify(r.payload)} -> ${JSON.stringify(r.result)}`);
  }
  for (const r of results) {
    expect(r.result, `refused: ${JSON.stringify(r.payload)}`).toEqual({ ok: false, reason: 'invalid-url' });
  }
  const after = (await openedUrls(app)).length;
  expect(after, 'no hostile URL was handed to shell.openExternal').toBe(before);

  // The valid auth-host URL IS opened (and recorded).
  const valid = await win.evaluate((u) => window.tflex.accounts.openAuthUrl(u), AUTH_URL);
  console.log(`[P50 C2] valid auth URL -> ${JSON.stringify(valid)}`);
  expect(valid).toEqual({ ok: true });
  const finalOpened = await openedUrls(app);
  expect(finalOpened[finalOpened.length - 1]).toBe(AUTH_URL);
});

test('P50 C3: the loopback page names the browser tab and the app stays usable', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  // Mint the real loopback URL and fetch it exactly as the browser would.
  const started = await win.evaluate(() => window.tflex.accounts.startOAuthCallback());
  console.log(`[P50 C3] loopback url: ${started.callbackUrl}`);
  expect(started.callbackUrl).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):\d+\/oauth\/callback\?token=/);
  const res = await fetch(started.callbackUrl);
  const body = await res.text();
  console.log(`[P50 C3] loopback status=${res.status}`);
  console.log(`[P50 C3] loopback body: ${body}`);
  expect(res.status).toBe(200);
  expect(body).toContain('close this browser tab');
  expect(body).toContain('return to Jovrel');
  expect(body).not.toContain('close this window');
  await win.evaluate(() => window.tflex.accounts.stopOAuthCallback());

  // The app is usable while the browser is open: the sign-in surface shows a
  // non-blocking status and the workspace stays reachable.
  await win.locator('[data-header-accounts]').click();
  await win.waitForSelector('[data-accounts-auth]', { timeout: 15000 });
  await win.locator('[data-accounts-close]').click();
  await win.waitForSelector('[data-accounts-auth]', { state: 'detached', timeout: 8000 });
  await expect(win.locator('.sample-card').first()).toBeVisible();
});

test('P50 C4: Preferences opens Windows Default-apps settings and reports honestly', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await installShellSpy(app);

  // Open Preferences through the real UI (the title-bar gear).
  await win.locator('[data-open-preferences]').click();
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
  const section = win.locator('[data-prefs-default-pdf-section]');
  await expect(section).toBeVisible();
  const why = await section.textContent();
  console.log(`[P50 C4] section copy: ${JSON.stringify(why)}`);
  expect(why).toContain('Windows does not let an installer change the default PDF handler silently');
  expect(why).toContain('Jovrel icon and type name');
  expect(why).not.toContain('Jovrel is now the default');

  // OK path: the OS call is made with the fixed settings URI.
  await win.locator('[data-prefs-default-pdf]').click();
  await expect
    .poll(async () => (await openedUrls(app)).length, { timeout: 10000, message: 'shell.openExternal received the settings URI' })
    .toBeGreaterThan(0);
  const opened = await openedUrls(app);
  console.log(`[P50 C4] shell.openExternal urls: ${JSON.stringify(opened)}`);
  expect(opened[0]).toBe('ms-settings:defaultapps');
  const okNotice = await win.locator('[data-prefs-default-pdf-status]').textContent();
  console.log(`[P50 C4] ok notice: ${JSON.stringify(okNotice)}`);
  expect(okNotice).toContain('Choose Jovrel there');
  expect(okNotice.toLowerCase()).not.toContain('default is now');
  await win.screenshot({ path: 'screenshots/phase50-default-pdf.png' });

  // Failed path: a rejecting OS call surfaces an honest failure, no claim.
  await setShellMode(app, 'reject');
  const modeNow = await app.evaluate(() => globalThis.__p50.mode);
  console.log(`[P50 C4] shell mode now: ${modeNow}`);
  const direct = await win.evaluate(() => window.tflex.app.openDefaultAppsSettings());
  console.log(`[P50 C4] direct failed-path result: ${JSON.stringify(direct)}`);
  await win.locator('[data-prefs-default-pdf]').click();
  await win.waitForTimeout(1500);
  const failNotice = await win.locator('[data-prefs-default-pdf-status]').textContent();
  console.log(`[P50 C4] failed notice: ${JSON.stringify(failNotice)}`);
  expect(failNotice).toContain('could not be opened');
  expect(failNotice).not.toContain('Choose Jovrel there');
});