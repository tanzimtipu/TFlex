// Deep-sweep perf recording on the DEV build (converted from the installed v1.7.11 app, 2026-09-05): cold start, 500-page
// open, idle memory. Records numbers for PERFORMANCE.md.
const { test } = require('@playwright/test');
const path = require('node:path');
const { launchDev, openSample, diag, getSamplePath , hardClose } = require('./lib/helpers.cjs');

test('PERF: cold start / 500-page open / idle memory (dev build)', async () => {
  const t0 = Date.now();
  const { electronApp, window: win } = await launchDev();
  await win.waitForSelector('.sample-card', { timeout: 40000 });
  const coldStart = Date.now() - t0;

  const longPath = getSamplePath('long.pdf');
  const openT0 = Date.now();
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, longPath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 40000 });
  const openTime = Date.now() - openT0;

  const d = await diag(win);
  console.log(`[PERF] coldStart=${coldStart}ms openLong=${openTime}ms pageCount=${d.pageCount}`);
  const pageCount = d.pageCount;

  // Whole-app + main idle memory after 10s idle.
  await win.waitForTimeout(10000);
  const procs = await electronApp.evaluate(async () => {
    const mem = process.memoryUsage().rss / 1024 / 1024;
    return { main: mem };
  });
  // Best-effort whole-app: sum local-process rss via configured memory (main only here).
  console.log(`[PERF] pageCount=${pageCount} idleMainRSS=${procs.main.toFixed(2)}MB`);
  await hardClose(electronApp);
});
