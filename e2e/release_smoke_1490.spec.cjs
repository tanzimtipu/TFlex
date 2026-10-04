// Release smoke for the SHIPPED 1.49.0 packaged build (TFL-720, TFL-715).
//
// Drives the byte-identical packaged payload of the published 1.49.0
// installer/portable: release/win-unpacked/Jovrel.exe. The packaged exe path is
// passed as launchApp's third argument (canonical launcher only) together with a
// throwaway userDataDir so the operator's profile is never touched.
//
// Verifies: app.getVersion() === 1.49.0, a visible titled BrowserWindow, clean
// startup (no uncaught page errors / fatal renderer console errors), rendered
// welcome surface (no blank canvas / error overlay), and captures one screenshot
// for visual inspection.
//
// Run:
//   npx.cmd playwright test e2e/release_smoke_1490.spec.cjs
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, dismissUpdatePrompt } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const EXE = path.join(ROOT, 'release', 'win-unpacked', 'Jovrel.exe');
const SHOTS = path.join(ROOT, 'test-fixtures', 'release-smoke-1.49.0');
const EXPECTED = '1.49.0';

test.setTimeout(180000);

let app = null;
let win = null;

test.beforeAll(async () => {
  expect(fs.existsSync(EXE), `packaged exe not found at ${EXE}`).toBe(true);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-smoke-1490-'));
  app = await launchApp([], userDataDir, EXE);
  expect(app, 'launchApp returned an ElectronApplication').toBeTruthy();
});

test.afterAll(async () => {
  if (app) await hardClose(app, 'rel1490');
});

test('packaged 1.49.0 boots with correct version, title and clean console', async () => {
  const pageErrors = [];
  const consoleErrors = [];
  const attach = (w) => {
    w.on('pageerror', (e) => pageErrors.push(e.message));
    w.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
  };
  app.windows().forEach(attach);
  app.on('window', attach);

  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  const version = await app.evaluate(({ app: a }) => a.getVersion());
  console.log(`[rel1490] app.getVersion()=${version} exe=${EXE}`);
  expect(version, 'packaged app.getVersion()').toBe(EXPECTED);

  await win.waitForSelector('.sample-card, .workspace', { timeout: 60000 });
  await dismissUpdatePrompt(win);

  const titles = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({ title: w.getTitle(), visible: w.isVisible() })));
  console.log(`[rel1490] windows=${JSON.stringify(titles)}`);
  const visibleTitled = titles.filter((t) => t.visible && t.title && t.title.trim().length > 0);
  expect(visibleTitled.length, 'at least one visible BrowserWindow with a non-empty title').toBeGreaterThanOrEqual(1);

  await win.waitForTimeout(1500);
  const bodyText = await win.evaluate(() => document.body.innerText || '');
  expect(bodyText, 'no error overlay').not.toMatch(/something went wrong|failed to load|uncaught exception|error occurred/i);
  const rendered = await win.evaluate(
    () => !!document.querySelector('canvas, .sample-card, .workspace'));
  expect(rendered, 'window rendered content (not a blank canvas)').toBe(true);

  fs.mkdirSync(SHOTS, { recursive: true });
  const shotPath = path.join(SHOTS, 'release-smoke-1.49.0.png');
  await win.screenshot({ path: shotPath });
  console.log(`[rel1490] screenshot=${shotPath}`);

  console.log(`[rel1490] pageErrors=${JSON.stringify(pageErrors)}`);
  console.log(`[rel1490] consoleErrors=${JSON.stringify(consoleErrors)}`);
  expect(pageErrors, 'no uncaught page errors during startup').toEqual([]);
  const fatal = consoleErrors.filter((t) =>
    /uncaught|unhandled|fatal|cannot read propert|is not a function/i.test(t));
  expect(fatal, 'no fatal renderer console errors').toEqual([]);
});
