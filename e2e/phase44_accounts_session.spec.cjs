// Phase 44 gate — session handling (item 3).
//
// Drives the REAL vault through the real IPC bridge with a synthetic session
// (no Neon account is created): setSession stores it, getStatus reports the
// email only, the raw JWT never appears in plaintext anywhere under userData
// (settings.json included), and clearSession signs out while leaving local
// data (settings.json) intact.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test('session JWT is encrypted at rest, absent from settings.json, and clearSession keeps local data', async () => {
  const app = await launchApp();
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.app', { timeout: 30000 });
    const userDataDir = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));

    const SENTINEL = `JWT-SENTINEL-${Date.now()}-abcdef`;

    // Create some local data first (a settings write), so "local data intact"
    // after sign-out is a real assertion.
    const before = await page.evaluate(() => window.tflex.loadSettings());
    await page.evaluate(
      (next) => window.tflex.saveSettings(next),
      { ...before, theme: before.theme === 'dark' ? 'light' : 'dark' },
    );
    const settingsPath = path.join(userDataDir, 'settings.json');
    expect(fs.existsSync(settingsPath)).toBe(true);
    const settingsBefore = fs.readFileSync(settingsPath, 'utf8');

    await page.evaluate(
      (token) => window.tflex.accounts.setSession({
        user: { id: 'u-qa-test', email: 'qa@example.com', emailVerified: true },
        token,
      }),
      SENTINEL,
    );

    const status = await page.evaluate(() => window.tflex.accounts.getStatus());
    expect(status).toEqual({ status: 'signed-in', email: 'qa@example.com' });
    expect(JSON.stringify(status)).not.toContain(SENTINEL);

    // The encrypted session file exists...
    const sessionFile = path.join(userDataDir, 'accounts-session.bin');
    expect(fs.existsSync(sessionFile)).toBe(true);

    // ...and the raw token appears in NO readable file under userData in
    // plaintext. Chromium's own cache files are locked by the running app and
    // are skipped; the files OUR code writes (the session file and
    // settings.json) are asserted explicitly below.
    for (const file of walk(userDataDir)) {
      let buf;
      try {
        buf = fs.readFileSync(file);
      } catch (e) {
        if (e.code === 'EBUSY' || e.code === 'EPERM') continue;
        throw e;
      }
      expect(buf.includes(SENTINEL), `plaintext token found in ${file}`).toBe(false);
    }
    // The encrypted session file itself must not carry the token verbatim.
    expect(fs.readFileSync(sessionFile).includes(SENTINEL)).toBe(false);

    // settings.json specifically never carries the token.
    expect(fs.readFileSync(settingsPath, 'utf8')).not.toContain(SENTINEL);

    // Sign out: session dropped, local data intact.
    await page.evaluate(() => window.tflex.accounts.clearSession());
    const after = await page.evaluate(() => window.tflex.accounts.getStatus());
    expect(after).toEqual({ status: 'signed-out', email: null });
    expect(fs.existsSync(sessionFile)).toBe(false);
    expect(fs.existsSync(settingsPath)).toBe(true);
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(settingsBefore);
  } finally {
    await app.close();
  }
});
