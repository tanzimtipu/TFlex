// Release 1.27.0 gate 3 (qa) - the PDF handler on the INSTALLED build.
//
// Phase 35 success criterion 2, second half (behaviour). The read-only
// registry evidence (TFlex.pdf ProgID + .pdf OpenWithProgids) is captured
// out-of-band with `reg query` and logged here too.
//
//   1. Launch the installed exe WITH a PDF path argument -> that document
//      opens (a real tab + rendered canvas), not the welcome screen.
//   2. With TFlex already running, launch it again with a DIFFERENT PDF ->
//      the second process exits immediately (single-instance lock) and the
//      document opens in the RUNNING instance (a second tab, still ONE
//      BrowserWindow).
//
// Launches only through the canonical e2e/lib/launch.cjs launchApp, with an
// explicit installed executablePath and the REAL user-data dir ('default') so
// the single-instance lock namespace matches a normal launch.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execSync, spawn } = require('node:child_process');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose, dismissUpdatePrompt } = require('../lib/helpers.cjs');

const EXPECTED = require('../../package.json').version;
const INSTALLED =
  process.env.TFLEX_PACKAGED_EXE ||
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'TFlex', 'TFlex.exe');
const SAMPLES = path.resolve(__dirname, '..', '..', 'assets', 'samples');

function tmpCopy(name) {
  const dir = path.join(os.tmpdir(), 'tflex-release1270');
  fs.mkdirSync(dir, { recursive: true });
  const dst = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  fs.copyFileSync(path.join(SAMPLES, name), dst);
  return dst;
}

async function tabs(win) {
  return win.evaluate(() => ({
    tabs: [...document.querySelectorAll('.tab[data-tab-id]')].map((t) => ({
      id: t.getAttribute('data-tab-id'),
      title: (t.querySelector('.tab-title')?.textContent || '').trim(),
    })),
    welcome: !!document.querySelector('.sample-card'),
    canvases: document.querySelectorAll('.pdf-page canvas').length,
  }));
}

let app = null;
let win = null;
test.setTimeout(240000);
test.afterEach(async () => {
  if (app) await hardClose(app, 'release-1270-fileassoc');
  app = null;
  win = null;
});

test('1.27.0 installed: app.getVersion, argv-open, and single-instance argv-open', async () => {
  const pdfA = tmpCopy('report.pdf');
  const pdfB = tmpCopy('form.pdf');
  console.log(`[release-1270-fa] installed=${INSTALLED} pdfA=${pdfA} pdfB=${pdfB}`);

  // --- Launch with the FIRST pdf as a command-line argument -------------
  app = await launchApp([pdfA], 'default', INSTALLED);
  win = await app.firstWindow();
  const version = await app.evaluate(({ app: a }) => a.getVersion());
  console.log(`[release-1270-fa] app.getVersion()=${version} expected=${EXPECTED}`);
  expect(version, 'installed app.getVersion()').toBe(EXPECTED);
  await dismissUpdatePrompt(win);

  await win
    .waitForFunction(() => document.querySelectorAll('.tab[data-tab-id]').length >= 1, null, { timeout: 45000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 45000 });
  const first = await tabs(win);
  console.log(`[release-1270-fa] argv launch state=${JSON.stringify(first)}`);
  expect(first.tabs.length, 'argv launch opened exactly one document').toBe(1);
  expect(first.tabs[0].title, 'argv launch opened the named PDF').toContain('report');
  expect(first.canvases, 'the opened document rendered a page canvas').toBeGreaterThan(0);
  expect(first.welcome, 'welcome screen is no longer the stage').toBe(false);

  const mainPid = await app.evaluate(() => process.pid);
  const windowsBefore = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({ id: w.id, title: w.getTitle() })),
  );
  console.log(`[release-1270-fa] main pid=${mainPid} windows=${JSON.stringify(windowsBefore)}`);
  expect(windowsBefore.length, 'one main window after the argv launch').toBe(1);

  // --- Launch AGAIN with a DIFFERENT pdf while TFlex is running ---------
  const child = spawn(INSTALLED, [pdfB], { stdio: 'ignore', windowsHide: true });
  let exited = false;
  let code = null;
  child.on('exit', (c) => { exited = true; code = c; });
  const t0 = Date.now();
  while (!exited && Date.now() - t0 < 10000) {
    await win.waitForTimeout(250);
  }
  console.log(`[release-1270-fa] second launch exited=${exited} code=${code} after ${Date.now() - t0}ms pid=${child.pid}`);
  if (!exited) {
    try { execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' }); } catch (_) { /* ignore */ }
  }
  expect(exited, 'the second launch process exits (single-instance lock)').toBe(true);

  await win
    .waitForFunction(() => document.querySelectorAll('.tab[data-tab-id]').length >= 2, null, { timeout: 30000 })
    .catch(() => {});
  await win.waitForTimeout(1500);
  const second = await tabs(win);
  const windowsAfter = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({ id: w.id, title: w.getTitle() })),
  );
  console.log(`[release-1270-fa] after second launch state=${JSON.stringify(second)} windows=${JSON.stringify(windowsAfter)}`);
  expect(second.tabs.length, 'the running instance opened the second document').toBe(2);
  expect(second.tabs.some((t) => t.title.includes('form')), 'second tab is the second PDF').toBe(true);
  expect(windowsAfter.length, 'no second app window was created').toBe(1);
});