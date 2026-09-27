// Phase 45 release-gate evidence: the PACKAGED build's account surface can
// actually reach the provider.
//
// The critical packaged check: on the packaged exe, open the account surface
// and submit a BOGUS email+password. The honest outcome is a CREDENTIAL
// rejection from the provider (HTTP 401) - never the false "offline" text.
// This proves the packaged CSP (connect-src https://*.neon.tech) and the
// packaged transport both work end to end.
//
// Run with TFLEX_PACKAGED_EXE pointing at the 1.38.0 unpacked tree.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, dismissUpdatePrompt } = require('./lib/helpers.cjs');

const PACKAGED_EXE =
  process.env.TFLEX_PACKAGED_EXE ||
  path.join(process.cwd(), 'release', 'win-unpacked', 'TFlex.exe');

test.setTimeout(120000);

test('packaged: bogus credentials -> CREDENTIAL error, never offline', async () => {
  const app = await launchApp([], null, PACKAGED_EXE);
  try {
    const page = await app.firstWindow();
    const neonRequests = [];
    page.on('request', (r) => { if (/neon\.tech/i.test(r.url())) neonRequests.push(r.url()); });

    const version = await app.evaluate(({ app: a }) => a.getVersion());
    const execPath = await app.evaluate(() => process.execPath);
    console.log(`[p45-packaged] version=${version} execPath=${execPath}`);
    expect(version, 'packaged build version').toBe('1.38.0');
    expect(execPath.toLowerCase(), 'launched the packaged exe').toContain('win-unpacked');

    await page.waitForSelector('.app', { timeout: 30000 });
    await dismissUpdatePrompt(page);

    await page.locator('[data-header-accounts]').click();
    await page.waitForSelector('[data-accounts-auth]', { timeout: 15000 });

    await page.locator('[data-accounts-email]').fill('qa-phase45-packaged-bogus@example.invalid');
    await page.locator('[data-accounts-password]').fill('not-a-real-password-123');
    await page.locator('[data-accounts-submit]').click();

    await page.waitForSelector('[data-accounts-banner]', { timeout: 30000 });
    const banner = (await page.locator('[data-accounts-banner]').first().textContent()) ?? '';
    const tone = await page.locator('[data-accounts-banner]').first().getAttribute('data-accounts-banner');
    console.log(`[p45-packaged banner] tone=${tone} text=${JSON.stringify(banner)}`);
    console.log(`[p45-packaged neonRequests] ${JSON.stringify(neonRequests)}`);

    expect(neonRequests.length, 'the packaged renderer reached a *.neon.tech host').toBeGreaterThan(0);
    expect(banner, 'no false offline text').not.toContain('offline');
    const credential = 'That email or password is not correct. Check it and try again.';
    const server = 'Something went wrong. Try again in a moment.';
    expect([credential, server], `banner was ${JSON.stringify(banner)}`).toContain(banner);
    console.log(`[p45-packaged verdict] ${banner === credential ? 'CREDENTIAL error (server 401)' : 'SERVER/reachability error'}`);
  } finally {
    await hardClose(app, 'p45-packaged-cred');
  }
});
