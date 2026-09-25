// DEF-338 scope matrix (QA diagnostic).
//
// Runs the same per-frame pane-B probe for: a normal fixture opened into pane
// B, the payslip into pane B (baseline), a sibling payslip into pane B, the
// payslip in SINGLE mode, and the payslip as pane A. Reports the slot-width /
// canvas-backing sequence and the placeholder duration for each so the glitch
// can be scoped to (or cleared from) the payslip specifically.
//
// The payslips are used IN PLACE from the operator's Downloads folder.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..', 'test-fixtures');
const REPORT = path.join(FIX, 'report.pdf');
const SQUIGGLY = path.join(FIX, 'squiggly-native.pdf');
const DL = 'C:\\Users\\tanzi\\Downloads\\';
const PAYSLIP = DL + 'TanzimulIslamPaySlip20260930.pdf';
const SIBLING = DL + 'TanzimulIslamPaySlip20260731.pdf';
const OUT = path.resolve(__dirname, 'def338-frames');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'def338-scope');
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

const SAMPLER = (selector) => {
  window.__def338 = [];
  const t0 = performance.now();
  const sample = () => {
    const pane = document.querySelector(selector);
    const canvas = pane && pane.querySelector('canvas.pdf-page-canvas');
    const slot = pane && pane.querySelector('.page-slot');
    const ph = pane && pane.querySelector('.page-placeholder');
    let backing = null, slotW = null, phOn = false;
    if (canvas) backing = [canvas.width, canvas.height];
    if (slot) slotW = Math.round(slot.getBoundingClientRect().width);
    if (ph) phOn = true;
    window.__def338.push({ t: Math.round(performance.now() - t0), backing, slotW, ph: phOn });
    if (window.__def338.length < 500) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
};

function summarize(label, samples) {
  const slotSeq = [];
  const backSeq = [];
  let phFrames = 0;
  let phStart = null, phEnd = null;
  for (const s of samples) {
    if (s.slotW !== null && (slotSeq.length === 0 || slotSeq[slotSeq.length - 1] !== s.slotW)) slotSeq.push(s.slotW);
    if (s.backing && (backSeq.length === 0 || backSeq[backSeq.length - 1][0] !== s.backing[0])) backSeq.push(s.backing);
    if (s.ph) { phFrames += 1; if (phStart === null) phStart = s.t; phEnd = s.t; }
  }
  const maxSlot = Math.max(...slotSeq.filter((x) => x !== null), 0);
  const maxBack = Math.max(...backSeq.map((b) => b[0]), 0);
  const line = `[SCOPE] ${label}: slotWidthSeq=${JSON.stringify(slotSeq)} maxSlot=${maxSlot} canvasBackingSeq=${JSON.stringify(backSeq)} maxBack=${maxBack} placeholderFrames=${phFrames} phWindow=${phStart}..${phEnd}ms`;
  console.log(line);
  return { label, slotSeq, maxSlot, backSeq, maxBack, phFrames, phStart, phEnd };
}

async function probeOpen(label, openPath) {
  await win.evaluate(SAMPLER, '.tab-pane[data-pane="B"]');
  await mockOpen(openPath);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-open]').click();
  await win.waitForTimeout(3000);
  const samples = await win.evaluate(() => window.__def338);
  fs.writeFileSync(path.join(OUT, `scope-${label}.json`), JSON.stringify(samples));
  return summarize(label, samples);
}

test('S1 normal fixture (report.pdf) into pane B', async () => {
  await openViaToolbar(SQUIGGLY);
  await win.locator('[data-header-multi-mode]').first().click();
  await win.waitForTimeout(600);
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]')).toBeVisible({ timeout: 15000 });
  await probeOpen('normal-report', REPORT);
});

test('S2 payslip into pane B (baseline)', async () => {
  await openViaToolbar(SQUIGGLY);
  await win.locator('[data-header-multi-mode]').first().click();
  await win.waitForTimeout(600);
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]')).toBeVisible({ timeout: 15000 });
  await probeOpen('payslip-0930', PAYSLIP);
});

test('S3 sibling payslip (20260731) into pane B', async () => {
  await openViaToolbar(SQUIGGLY);
  await win.locator('[data-header-multi-mode]').first().click();
  await win.waitForTimeout(600);
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]')).toBeVisible({ timeout: 15000 });
  await probeOpen('payslip-0731', SIBLING);
});

test('S4 payslip in SINGLE mode', async () => {
  await win.evaluate(SAMPLER, '.document-scroller');
  await openViaToolbar(PAYSLIP);
  await win.waitForTimeout(3000);
  const samples = await win.evaluate(() => window.__def338);
  fs.writeFileSync(path.join(OUT, 'scope-single.json'), JSON.stringify(samples));
  summarize('single-payslip', samples);
});

test('S5 payslip as pane A (multi mode on with payslip in A)', async () => {
  await openViaToolbar(PAYSLIP);
  await win.waitForTimeout(800);
  await win.evaluate(SAMPLER, '.tab-pane[data-pane="A"]');
  await win.locator('[data-header-multi-mode]').first().click();
  await win.waitForTimeout(3000);
  const samples = await win.evaluate(() => window.__def338);
  fs.writeFileSync(path.join(OUT, 'scope-paneA.json'), JSON.stringify(samples));
  summarize('paneA-payslip', samples);
});
