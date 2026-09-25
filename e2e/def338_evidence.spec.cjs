// DEF-338 evidence capture (QA). Saves the key glitch frames for the scope
// scenarios that the main repro did not already capture: a normal fixture
// opened into pane B, the payslip in SINGLE mode, and the payslip-as-pane-A
// multi-mode transition. Frames go straight to screenshots/def-338-*.png.
//
// The payslip is used IN PLACE from the operator's Downloads folder.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..', 'test-fixtures');
const REPORT = path.join(FIX, 'report.pdf');
const SQUIGGLY = path.join(FIX, 'squiggly-native.pdf');
const PAYSLIP = 'C:\\Users\\tanzi\\Downloads\\TanzimulIslamPaySlip20260930.pdf';
const SHOTS = path.resolve(__dirname, '..', 'screenshots');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'def338-evidence');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function mockOpen(p) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
}
async function openViaToolbar(p) {
  await mockOpen(p);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(1200);
}

async function startScreencast(page) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (ev) => {
    frames.push({ data: ev.data, recv: Date.now() });
    cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', quality: 100, maxWidth: 1280, maxHeight: 900, everyNthFrame: 1 });
  return { cdp, frames };
}
async function stopScreencast(cdp) {
  try { await cdp.send('Page.stopScreencast'); } catch (_) { /* ignore */ }
  try { await cdp.detach(); } catch (_) { /* ignore */ }
}
function save(frames, idx, name) {
  const p = path.join(SHOTS, name);
  fs.writeFileSync(p, Buffer.from(frames[idx].data, 'base64'));
  console.log(`[DEF338-EV] saved ${name} (frame ${idx}/${frames.length})`);
  return p;
}

test('E1 normal fixture (report.pdf) into pane B glitch frame', async () => {
  await openViaToolbar(SQUIGGLY);
  await win.locator('[data-header-multi-mode]').first().click();
  await win.waitForTimeout(600);
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]')).toBeVisible({ timeout: 15000 });
  const { cdp, frames } = await startScreencast(win);
  await mockOpen(REPORT);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-open]').click();
  await win.waitForTimeout(2500);
  await stopScreencast(cdp);
  // The glitch frames are the ones where pane B is a grey slab; pick the
  // largest-index frame before the page renders by scanning for the first
  // frame whose pane-B region is mostly grey. Simpler: save a mid-open frame.
  const mid = Math.min(frames.length - 1, Math.floor(frames.length * 0.45));
  save(frames, mid, 'def-338-normal-fixture-glitch.png');
  save(frames, frames.length - 1, 'def-338-normal-fixture-settled.png');
});

test('E2 payslip in SINGLE mode glitch frame', async () => {
  const { cdp, frames } = await startScreencast(win);
  await mockOpen(PAYSLIP);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(2500);
  await stopScreencast(cdp);
  const mid = Math.min(frames.length - 1, Math.floor(frames.length * 0.4));
  save(frames, mid, 'def-338-single-mode-glitch.png');
  save(frames, frames.length - 1, 'def-338-single-mode-settled.png');
});

test('E3 payslip as pane A during the multi-mode transition', async () => {
  await openViaToolbar(PAYSLIP);
  await win.waitForTimeout(800);
  const { cdp, frames } = await startScreencast(win);
  await win.locator('[data-header-multi-mode]').first().click();
  await win.waitForTimeout(2500);
  await stopScreencast(cdp);
  const mid = Math.min(frames.length - 1, Math.floor(frames.length * 0.4));
  save(frames, mid, 'def-338-paneA-transition.png');
});
