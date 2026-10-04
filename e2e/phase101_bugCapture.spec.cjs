// Phase 101 (chunk 4) - focused e2e: a forced main-process error and a forced
// renderer error each produce a row in public.bug_reports (success criterion 8).
//
// Launched ONLY through the canonical e2e/lib/launch.cjs `launchApp`.
//
// The spec drives the real application end to end:
//   1. forces one RENDERER `error` event, which the installed global listener
//      (src/renderer/bug-report/installGlobalHandlers.ts) forwards over
//      `bugReport:capture` as category `renderer-error`, component `renderer`;
//   2. forces one MAIN-process `uncaughtException`, which the module-scope
//      handler in src/main/index.ts captures as category `uncaught-exception`,
//      component `main`;
//   3. waits out the capture debounce (2000 ms) so the debounced, single-flight
//      flush reaches the Neon Data API;
//   4. proves the renderer<->main bridge is still live with a probe capture.
//
// The persistence proof (the two rows in public.bug_reports) is read by the QA
// agent through the privileged Neon MCP `run_sql` tool after this spec runs.
// The INSERTs themselves come only from the running app - this spec never
// inserts a row and never opens a DB credential.
const { test, expect } = require('@playwright/test');
const os = require('node:os');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');

// The Paperclip/kimi harness exports ELECTRON_RUN_AS_NODE=1; launchApp spreads
// process.env, so Electron would otherwise exit as Node. Clear it (same
// adaptation the neighbouring phase specs use).
delete process.env.ELECTRON_RUN_AS_NODE;

const USER_DATA = path.join(os.tmpdir(), `tflex-p101-bugcapture-${Date.now()}`);
test.setTimeout(180000);

test('Phase 101 - forced main + renderer error are captured by the running app', async () => {
  const app = await launchApp([], null);
  try {
    const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
    const page = await app.firstWindow();
    await page.waitForSelector('.sample-card', { timeout: 30000 });
    console.log(`[P101] isolated userData=${userData}`);

    // 2. Force a RENDERER error through the app's installed window error listener.
    await page.evaluate(() => {
      window.dispatchEvent(new ErrorEvent('error', {
        message: 'phase101-forced-renderer-error',
        error: new Error('phase101-forced-renderer-error'),
      }));
    });

    // 3. Force a MAIN-process error through the app's uncaughtException handler.
    await app.evaluate(() => {
      process.emit('uncaughtException', new Error('phase101-forced-main-error'));
      return true;
    });

    // 4. Capture debounce is 2000 ms; leave room for the Data API insert.
    await page.waitForTimeout(6000);

    // 5. App-side liveness: the renderer<->main bridge still answers and the
    //    main process did not crash.
    const probe = await page.evaluate(() => window.tflex.bugReport.capture({
      level: 'info',
      category: 'unknown',
      component: 'renderer',
      message: 'phase101-queue-probe',
    }));
    console.log(`[P101] probe=${JSON.stringify(probe)} windows=${app.windows().length}`);
    expect(probe, 'renderer bugReport bridge still answers after forced errors').toBeTruthy();
    expect(probe.ok, 'probe capture accepted').toBe(true);
    expect(app.windows().length, 'app did not crash').toBeGreaterThanOrEqual(1);
  } finally {
    // 7. Close cleanly.
    if (app) await app.close().catch(() => undefined);
  }
});
