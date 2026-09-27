// Phase 44 release-gate evidence: the accounts flag on the PACKAGED build.
//
// 1.37.0 changed the default: accounts ship ENABLED (DEFAULT_SETTINGS
// .accountsEnabled === true). This spec proves, against
// release/win-unpacked/Jovrel.exe:
//   A. a FRESH packaged profile (no settings.json) SHOWS the top-right account
//      section (the signed-out sign-in entry), with ZERO accounts network
//      traffic;
//   B. an explicitly-OFF profile (seeded `accountsEnabled: false`) shows
//      NOTHING account-related, with ZERO accounts network traffic.
//
// The accounts endpoints are pointed at a local recorder server, so any
// main-process transport call would land there; the renderer is also watched
// for any *.neon.tech request. The sync engine makes no network call while no
// session is held, so a fresh profile stays silent even with the flag on.
//
// Run with TFLEX_PACKAGED_EXE pointing at release/win-unpacked/Jovrel.exe.

const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const PACKAGED_EXE =
  process.env.TFLEX_PACKAGED_EXE ||
  path.join(process.cwd(), 'release', 'win-unpacked', 'Jovrel.exe');

function startRecorder() {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ method: req.method, url: req.url });
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{}');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, hits, port: server.address().port });
    });
  });
}

async function stopRecorder(rec) {
  await new Promise((r) => rec.server.close(r));
}

function pointAccountsAtLocalhost(rec) {
  const base = `http://127.0.0.1:${rec.port}`;
  process.env.TFLEX_AUTH_BASE_URL = `${base}/auth`;
  process.env.TFLEX_DATA_API_URL = `${base}/rest/v1`;
  process.env.TFLEX_FUNCTION_API_URL = `${base}/functions`;
}

function clearAccountsEnv() {
  delete process.env.TFLEX_AUTH_BASE_URL;
  delete process.env.TFLEX_DATA_API_URL;
  delete process.env.TFLEX_FUNCTION_API_URL;
}

// Seed a profile with an explicit settings.json so the flag's stored value is
// deterministic before the app boots. The default is now ON, so the OFF case
// must seed `accountsEnabled: false` explicitly (the flag is the escape hatch).
function makeOffProfile() {
  const dir = path.join(
    os.tmpdir(),
    `tflex-e2e-p44-off-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ accountsEnabled: false }), 'utf8');
  return dir;
}

test('packaged FRESH profile: account section SHOWS by default, zero accounts traffic', async () => {
  const rec = await startRecorder();
  pointAccountsAtLocalhost(rec);
  // No settings.json seeded: the profile is fresh, so the flag resolves to the
  // documented default (accounts ON).
  const app = await launchApp([], null, PACKAGED_EXE);
  try {
    const page = await app.firstWindow();
    const neonRequests = [];
    page.on('request', (r) => {
      if (/neon\.tech/i.test(r.url())) neonRequests.push(r.url());
    });
    const version = await app.evaluate(({ app: a }) => a.getVersion());
    const execPath = await app.evaluate(() => process.execPath);
    console.log(`[p44-evidence] version=${version} execPath=${execPath}`);
    expect(version, 'packaged build version').toBe('1.41.0');
    expect(execPath.toLowerCase(), 'launched the packaged exe').toContain('win-unpacked');

    await page.waitForSelector('.app', { timeout: 30000 });

    // Fresh profile => default ON => the top-right account section is present.
    const entry = page.locator('[data-header-accounts]');
    await expect(entry).toBeVisible({ timeout: 10000 });
    expect(await entry.getAttribute('data-header-accounts'), 'signed-out entry').toBe('signed-out');
    await page.screenshot({ path: 'screenshots/phase44-packaged-fresh-account-on.png' });

    // Opening the sign-in surface is local IPC only; still zero network.
    await entry.click();
    await expect(page.locator('[data-animated-dialog="accounts-dialog"]')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1500);

    expect(rec.hits, 'accounts transport made a network call on a fresh profile').toEqual([]);
    expect(neonRequests, 'renderer hit a Neon host on a fresh profile').toEqual([]);
  } finally {
    await hardClose(app, 'p44-fresh');
    await stopRecorder(rec);
    clearAccountsEnv();
  }
});

test('packaged explicit OFF profile: no account surface, zero accounts traffic', async () => {
  const rec = await startRecorder();
  pointAccountsAtLocalhost(rec);
  const userDataDir = makeOffProfile();
  const app = await launchApp([], userDataDir, PACKAGED_EXE);
  try {
    const page = await app.firstWindow();
    const neonRequests = [];
    page.on('request', (r) => {
      if (/neon\.tech/i.test(r.url())) neonRequests.push(r.url());
    });
    await page.waitForSelector('.app', { timeout: 30000 });

    // Flag explicitly OFF: no account control anywhere.
    expect(await page.locator('[data-header-accounts]').count()).toBe(0);
    await page.screenshot({ path: 'screenshots/phase44-packaged-flag-off.png' });

    // Trigger a settings write so the broadcast -> requestSync path runs.
    const loaded = await page.evaluate(() => window.tflex.loadSettings());
    expect(loaded.ok, 'settings load must succeed').toBe(true);
    expect(loaded.value.accountsEnabled, 'seeded false must be preserved').toBe(false);
    await page.evaluate(
      (next) => window.tflex.saveSettings(next),
      { ...loaded.value, theme: loaded.value.theme === 'dark' ? 'light' : 'dark' },
    );
    // Wait past the 1500ms debounce plus margin.
    await page.waitForTimeout(2800);

    expect(rec.hits, 'accounts transport made a network call with the flag off').toEqual([]);
    expect(neonRequests, 'renderer hit a Neon host with the flag off').toEqual([]);
  } finally {
    await hardClose(app, 'p44-off');
    await stopRecorder(rec);
    clearAccountsEnv();
  }
});

test('packaged: Preferences has no Accounts (beta) row; signed-in state renders the round avatar', async () => {
  const rec = await startRecorder();
  pointAccountsAtLocalhost(rec);
  const app = await launchApp([], null, PACKAGED_EXE);
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.app', { timeout: 30000 });

    // The Preferences "Accounts (beta)" row is GONE (accounts are simply ON).
    await page.click('[data-open-preferences]');
    await page.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
    expect(await page.locator('[data-prefs-accounts]').count(), 'no accounts preference row').toBe(0);
    const prefsText = await page.locator('[data-prefs-dialog]').innerText();
    expect(prefsText, 'no Accounts (beta) label in Preferences').not.toContain('Accounts');
    await page.locator('[data-prefs-dialog] .sheet-close').click();
    await page.waitForSelector('[data-prefs-dialog]', { state: 'hidden', timeout: 8000 });

    // Signed-in state: seed a synthetic session through the real IPC (no Neon
    // account is created), then reload so the App re-reads getStatus and mounts
    // the signed-in account section. The round avatar must render.
    await page.evaluate(
      (token) => window.tflex.accounts.setSession({
        user: { id: 'u-qa-packaged', email: 'qa@example.com', emailVerified: true },
        token,
      }),
      `JWT-SENTINEL-${Date.now()}-packaged`,
    );
    await page.reload();
    await page.waitForSelector('.app', { timeout: 30000 });
    const avatar = page.locator('[data-account-avatar]');
    await expect(avatar).toBeVisible({ timeout: 15000 });
    expect(await avatar.getAttribute('data-header-accounts'), 'signed-in avatar state').toBe('signed-in');
    // The avatar is round (border-radius >= half its box) and carries the
    // identity's accessible name.
    const round = await avatar.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const br = parseFloat(getComputedStyle(el).borderTopLeftRadius);
      return { w: r.width, h: r.height, br, label: el.getAttribute('aria-label') };
    });
    console.log(`[p44-avatar] ${JSON.stringify(round)}`);
    expect(round.br, 'avatar is round').toBeGreaterThanOrEqual(Math.min(round.w, round.h) / 2 - 1);
    expect(round.label, 'avatar accessible name').toBe('qa@example.com');
  } finally {
    await hardClose(app, 'p44-avatar');
    await stopRecorder(rec);
    clearAccountsEnv();
  }
});
