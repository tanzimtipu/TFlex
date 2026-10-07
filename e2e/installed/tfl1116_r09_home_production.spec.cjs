// TFL-1150 / R09 - the PRODUCTION absence proof.
//
// R09: a PACKAGED production Home renders NO Explore Jovrel section, no sample
// grid, and no sample invitation copy. The sample fixtures are gated on the
// runtime packaged signal (`window.tflex.app.isPackaged === true` here), so this
// proof MUST run against the installed/packaged app - asserting absence in the
// unpackaged dev harness would be the wrong oracle (TFL-1150).
//
// Lives under e2e/installed/ so it is EXCLUDED from the standard suite
// (playwright.config.js testIgnore). Run it only via:
//   npm.cmd run test:e2e -- --config=e2e/installed/playwright.installed.config.js
// or with the packaged path overridden:
//   TFLEX_PACKAGED_EXE=<path> npx playwright test --config=e2e/installed/playwright.installed.config.js
//
// The installed path can be overridden with TFLEX_PACKAGED_EXE; the default
// mirrors e2e/installed/canonical_installed_build.spec.cjs.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, name);

const PACKAGED_EXE =
  process.env.TFLEX_PACKAGED_EXE ||
  'C:\\Program Files\\Jovrel\\Jovrel.exe';

const exeAvailable = fs.existsSync(PACKAGED_EXE);

test.describe.configure({ mode: 'serial' });
test.setTimeout(180000);

test('R09 - packaged production Home shows no Explore/sample fixture surface', async () => {
  test.skip(
    !exeAvailable,
    `installed exe not found at ${PACKAGED_EXE}; R09 production proof unavailable in this environment`,
  );

  const app = await launchApp([], null, PACKAGED_EXE);
  const pageErrors = [];
  try {
    const win = await app.firstWindow();
    win.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));

    // Home mounts; do NOT wait for `.sample-card` (its absence is the assertion).
    await win.waitForSelector('.welcome', { timeout: 40000 });
    // Capture evidence before asserting, so a failing build still yields a shot.
    await win.screenshot({ path: shot('tfl1116_r09_home_production_installed.png') });

    // The runtime signal is what gates the fixtures: confirm it is packaged.
    const isPackaged = await win.evaluate(
      () => (globalThis.tflex && globalThis.tflex.app && globalThis.tflex.app.isPackaged) ?? null,
    );
    if (isPackaged !== null) {
      expect(isPackaged, 'installed app reports isPackaged === true').toBe(true);
    }

    await expect(win.locator('[data-home-explore]')).toHaveCount(0);
    expect(await win.locator('.sample-card').count(), 'no sample cards in production').toBe(0);

    const bodyFlag = await win
      .locator('.welcome-body')
      .first()
      .getAttribute('data-home-samples');
    expect(bodyFlag, 'data-home-samples is false in production').toBe('false');

    const text = await win.locator('.welcome').first().innerText();
    expect(text, 'no Explore Jovrel heading').not.toContain('Explore Jovrel');
    expect(text, 'no sample invitation copy').not.toContain('pick a sample');

    expect(pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  } finally {
    await hardClose(app, 'tfl1150-r09-production');
  }
});
