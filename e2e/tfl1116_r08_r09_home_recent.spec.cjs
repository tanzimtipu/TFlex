// TFL-1143 (TFL-1116 C7b) - R08 + R09 Home recent surface. frontend-dev.
// Launches ONLY via the canonical e2e/lib/launch.cjs `launchApp`.
//
// R08: every recent row shares ONE six-track CSS grid, so a row WITH a Missing
// badge keeps its date and actions in the SAME tracks (identical x) as a row
// WITHOUT one.
//
// R09 (TFL-1150): the sample fixtures are gated on the RUNTIME PACKAGED signal,
// not the bundle mode. This spec launches the standard UNPACKAGED dev/e2e app
// (app.isPackaged === false), so the corrected semantics SHOW the Explore Jovrel
// fixture surface here. The production-absence half of R09 is asserted only
// where the app is actually packaged, in
// e2e/installed/tfl1116_r09_home_production.spec.cjs.
//
// The harness exports ELECTRON_RUN_AS_NODE=1; launchApp spreads process.env, so
// Electron would exit as Node. Clear it.
delete process.env.ELECTRON_RUN_AS_NODE;

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, name);

// A real bundled file (present) and a path that cannot exist (missing), so the
// seeded Home shows exactly one healthy row and one Missing row.
const PRESENT = path.resolve(__dirname, '..', 'assets', 'samples', 'report.pdf');
const MISSING = path.join(os.tmpdir(), `tflex-tfl1143-ghost-${Date.now()}.pdf`);

function seedUserData(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const settings = {
    recentFiles: [
      {
        path: PRESENT,
        name: 'report.pdf',
        openedAt: now,
        sourceLabel: 'PDF Document',
        sourceKind: 'pdf',
      },
      { path: MISSING, name: 'ghost.pdf', openedAt: now },
    ],
  };
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');
}

let app = null;
let win = null;

test.beforeEach(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-tfl1143-'));
  seedUserData(dir);
  app = await launchApp([], dir);
  win = await app.firstWindow();
  await win.waitForSelector('.welcome', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1143-r08-r09');
  app = null;
  win = null;
});

test.setTimeout(300000);

test('R08 - the recent grid keeps date and actions in identical tracks with/without Missing', async () => {
  await win.waitForSelector('[data-recent-row]', { timeout: 20000 });
  await expect(win.locator('[data-recent-row]')).toHaveCount(2);
  await expect(win.locator('[data-recent-row][data-recent-missing="true"]')).toHaveCount(1);
  await expect(win.locator('[data-recent-row][data-recent-missing="false"]')).toHaveCount(1);

  const dates = win.locator('.recent-row .doc-when');
  const actions = win.locator('.recent-row .recent-row-actions');
  const d0 = await dates.nth(0).boundingBox();
  const d1 = await dates.nth(1).boundingBox();
  const a0 = await actions.nth(0).boundingBox();
  const a1 = await actions.nth(1).boundingBox();
  expect(d0 && d1 && a0 && a1).toBeTruthy();
  expect(Math.round(d0.x)).toBe(Math.round(d1.x));
  expect(Math.round(a0.x)).toBe(Math.round(a1.x));

  await win.screenshot({ path: shot('tfl1116_r08_recent_grid.png') });
});

test('R09 - the dev build SHOWS the Explore/sample fixture surface', async () => {
  // This launch is UNPACKAGED (app.isPackaged === false), so isDevelopmentBuild()
  // is true and the development-only fixtures are visible. This documents the
  // dev/prod split explicitly; the production absence lives in the installed
  // spec. A dev assertion must never be labelled as the production proof.
  await expect(win.locator('[data-home-explore]')).toHaveCount(1);
  await expect(win.locator('.sample-card').first()).toBeVisible({ timeout: 20000 });
  expect(await win.locator('.sample-card').count()).toBeGreaterThan(0);
  const bodyFlag = await win
    .locator('.welcome-body')
    .first()
    .getAttribute('data-home-samples');
  expect(bodyFlag).toBe('true');
  const text = await win.locator('.welcome').first().innerText();
  expect(text).toContain('Explore Jovrel');
  await win.screenshot({ path: shot('tfl1116_r09_home_dev_fixtures.png') });
});
