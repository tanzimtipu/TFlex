// Phase 44 gate — the accounts feature flag (item 1).
//
// Proves, against the real Electron app:
//   A. flag EXPLICITLY OFF (seeded `accountsEnabled: false`): no account
//      control anywhere, and ZERO accounts network calls. The accounts
//      endpoints are pointed at a local recorder server, so any main-process
//      transport call would land there; the renderer is also watched for any
//      *.neon.tech request.
//   B. NEW DEFAULT (operator change): a fresh profile with NO stored flag
//      resolves to accounts ON, so the top-bar entry appears.
//   C. flag ON live: the top-bar entry appears and the dialog opens, and
//      flipping the flag back off removes the entry — all WITHOUT a restart
//      (the live settings broadcast re-renders the App gate).
//
// The flag is flipped through the real `settings:save` IPC (the same path the
// Preferences UI uses), so the broadcast -> requestSync path is exercised too.

const { test, expect } = require('@playwright/test');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');

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
}

function clearAccountsEnv() {
  delete process.env.TFLEX_AUTH_BASE_URL;
  delete process.env.TFLEX_DATA_API_URL;
}

// Seed a profile with an explicit settings.json so the flag's stored value is
// deterministic before the app boots. The default is now ON, so the OFF case
// must seed `accountsEnabled: false` explicitly (the flag is the escape hatch).
function makeProfile(label, settings) {
  const dir = path.join(
    os.tmpdir(),
    `tflex-e2e-p44-${label}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings), 'utf8');
  return dir;
}

test('flag explicitly OFF: no account surface and zero accounts network calls', async () => {
  const rec = await startRecorder();
  pointAccountsAtLocalhost(rec);
  const userDataDir = makeProfile('off', { accountsEnabled: false });
  const app = await launchApp([], userDataDir);
  try {
    const page = await app.firstWindow();
    const neonRequests = [];
    page.on('request', (r) => {
      if (/neon\.tech/i.test(r.url())) neonRequests.push(r.url());
    });
    await page.waitForSelector('.app', { timeout: 30000 });

    // No account control anywhere.
    expect(await page.locator('[data-header-accounts]').count()).toBe(0);

    // Trigger settings writes: each broadcast calls requestSync (debounced).
    // loadSettings returns a Result wrapper, so read `.value` — spreading the
    // wrapper would drop `accountsEnabled` and let the save re-default it ON.
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
    await app.close();
    await stopRecorder(rec);
    clearAccountsEnv();
  }
});

test('NEW default: a fresh profile with no stored flag shows the account entry', async () => {
  const rec = await startRecorder();
  pointAccountsAtLocalhost(rec);
  // No settings.json seeded: the profile is fresh, so the flag resolves to the
  // documented default (accounts ON).
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.app', { timeout: 30000 });

    // The default exposes the account entry.
    await expect(page.locator('[data-header-accounts]')).toBeVisible({ timeout: 10000 });

    // And the entry opens the account surface.
    await page.locator('[data-header-accounts]').click();
    await expect(page.locator('[data-animated-dialog="accounts-dialog"]')).toBeVisible({ timeout: 10000 });
  } finally {
    await app.close();
    await stopRecorder(rec);
    clearAccountsEnv();
  }
});

test('flag ON live: entry appears live, dialog opens, flag off removes it live', async () => {
  const rec = await startRecorder();
  pointAccountsAtLocalhost(rec);
  const userDataDir = makeProfile('live', { accountsEnabled: false });
  const app = await launchApp([], userDataDir);
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.app', { timeout: 30000 });

    // Starts off (seeded false).
    expect(await page.locator('[data-header-accounts]').count()).toBe(0);

    // Flip the flag on through the real settings IPC — no restart.
    const loaded = await page.evaluate(() => window.tflex.loadSettings());
    expect(loaded.ok, 'settings load must succeed').toBe(true);
    const s = loaded.value;
    await page.evaluate(
      (next) => window.tflex.saveSettings(next),
      { ...s, accountsEnabled: true },
    );
    await page.waitForSelector('[data-header-accounts]', { timeout: 10000 });

    // The entry opens the account surface.
    await page.locator('[data-header-accounts]').click();
    await expect(page.locator('[data-animated-dialog="accounts-dialog"]')).toBeVisible({ timeout: 10000 });
    // Configured (endpoints set) => the auth form, not the unconfigured state.
    await expect(page.locator('[data-accounts-auth]')).toBeVisible({ timeout: 10000 });
    await page.locator('[data-accounts-close]').click();

    // Flip the flag back off — the entry disappears live.
    await page.evaluate(
      (next) => window.tflex.saveSettings(next),
      { ...s, accountsEnabled: false },
    );
    await page.waitForFunction(
      () => document.querySelector('[data-header-accounts]') === null,
      null,
      { timeout: 10000 },
    );
  } finally {
    await app.close();
    await stopRecorder(rec);
    clearAccountsEnv();
  }
});
