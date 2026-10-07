// TFL-1185 (TFL-1146 D) — QA focused live verification of AR-05 sample identity.
// Seeds a legacy Recent whose stored path is a virtual bundled-sample path
// (`samples/report.pdf`) alongside a genuinely missing real disk path and a real
// saved copy of the sample, then drives the REAL Electron app through the
// canonical launchApp helper. qa-owned; read-only product checks.
delete process.env.ELECTRON_RUN_AS_NODE;

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (n) => path.join(SHOTS, n);

let app = null;
let win = null;
test.setTimeout(240000);

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1185-ar05');
  app = null;
  win = null;
});

function seedProfile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfl1185-ar05-'));
  const now = new Date().toISOString();
  const gonePath = path.join(os.tmpdir(), `tfl1185-missing-${Date.now()}`, 'gone.pdf');
  const savedCopy = getSamplePath('report.pdf');
  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    JSON.stringify({
      recentFiles: [
        { path: 'samples/report.pdf', name: 'report.pdf', openedAt: now },
        { path: gonePath, name: 'gone.pdf', openedAt: now },
        { path: savedCopy, name: 'saved-copy-report.pdf', openedAt: now },
      ],
    }),
  );
  return { dir, gonePath, savedCopy };
}

async function readRows() {
  return win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-recent-row]')).map((r) => ({
      missing: r.getAttribute('data-recent-missing'),
      path: r.getAttribute('title'),
      hasNote: r.querySelector('[data-recent-missing-note]') !== null,
      locate: r.querySelector('[data-recent-action="locate"]') !== null,
    })),
  );
}

test('AR-05: sample recent is not Missing and reopens 34 pages; real missing stays Missing; saved copy is ordinary; survives relaunch', async () => {
  const { dir, gonePath, savedCopy } = seedProfile();
  app = await launchApp([], dir);
  win = await app.firstWindow();
  await win.waitForSelector('.welcome', { timeout: 30000 });
  await win.waitForSelector('[data-recent-row]', { timeout: 15000 }).catch(() => {});
  await win.waitForTimeout(1500);

  const rows = await readRows();
  console.log(`[tfl1185] AR-05 seeded rows=${JSON.stringify(rows)}`);
  await win.screenshot({ path: shot('tfl1185_ar05_seeded.png') });

  const sampleRow = rows.find((r) => r.path === 'samples/report.pdf');
  const goneRow = rows.find((r) => r.path === gonePath);
  const copyRow = rows.find((r) => r.path === savedCopy);
  expect.soft(sampleRow, 'AR-05 the seeded sample recent renders').toBeTruthy();
  expect.soft(goneRow, 'AR-05 the genuinely missing real path renders').toBeTruthy();
  expect.soft(copyRow, 'AR-05 the saved copy of the sample renders').toBeTruthy();

  expect.soft(sampleRow.missing, 'AR-05 the bundled sample recent is NOT Missing').toBe('false');
  expect.soft(sampleRow.hasNote, 'AR-05 the bundled sample recent shows no Missing note').toBe(false);
  expect.soft(copyRow.missing, 'AR-05 a saved copy of a sample is treated as an ordinary present file').toBe('false');
  expect.soft(copyRow.hasNote, 'AR-05 a saved copy shows no Missing note').toBe(false);
  expect.soft(goneRow.missing, 'AR-05 a genuinely missing real disk path still shows Missing').toBe('true');
  expect.soft(goneRow.hasNote, 'AR-05 the genuinely missing path shows the Missing note').toBe(true);
  expect.soft(goneRow.locate, 'AR-05 the genuinely missing path offers Locate').toBe(true);

  // Reopen the bundled-sample recent: it must route through the sample provider.
  await win.locator('[data-recent-row][title="samples/report.pdf"] [data-recent-action="open"]').first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 20000 });
  await win.waitForTimeout(1000);
  const diag = await win.evaluate(() => {
    try { const d = window.tflexDiagnostics(); return { pageCount: d.pageCount, currentPage: d.currentPage }; }
    catch (e) { return null; }
  });
  console.log(`[tfl1185] AR-05 sample-recent reopen diag=${JSON.stringify(diag)}`);
  await win.screenshot({ path: shot('tfl1185_ar05_reopened.png') });
  expect.soft(diag !== null && diag.pageCount, 'AR-05 the sample recent reopens through the sample provider (34 pages)').toBe(34);

  // Relaunch the SAME profile: the sample row must not be re-flagged Missing.
  await hardClose(app, 'tfl1185-ar05-relaunch');
  app = null;
  await new Promise((r) => setTimeout(r, 2500));
  app = await launchApp([], dir);
  win = await app.firstWindow();
  await win.waitForSelector('.welcome', { timeout: 30000 });
  await win.waitForSelector('[data-recent-row]', { timeout: 15000 }).catch(() => {});
  await win.waitForTimeout(1500);

  const rows2 = await readRows();
  console.log(`[tfl1185] AR-05 relaunch rows=${JSON.stringify(rows2)}`);
  await win.screenshot({ path: shot('tfl1185_ar05_relaunch.png') });
  const sample2 = rows2.find((r) => r.path === 'samples/report.pdf');
  expect.soft(sample2, 'AR-05 the sample recent survives relaunch').toBeTruthy();
  if (sample2) {
    expect.soft(sample2.missing, 'AR-05 the sample recent is not re-flagged Missing after relaunch').toBe('false');
    expect.soft(sample2.hasNote, 'AR-05 the sample recent shows no Missing note after relaunch').toBe(false);
  }
});
