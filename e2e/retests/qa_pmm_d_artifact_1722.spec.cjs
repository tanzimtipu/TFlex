// QA reproduction probe (item 4 refinement) — installed v1.7.22:
// After an add-box drag-release, poll the DOM box rect AND the canvas pixels
// at the old rect (R0) and new rect (R1) every ~150ms for ~4s, to separate:
//   (a) does the DOM mirror follow the drag live?
//   (b) does the CANVAS keep showing the stale baked text at R0 after release
//       (the operator's "stale artifact"), and when does it clear?
// Launch only via e2e/lib/launch.cjs (launchApp) against the packaged exe.

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');

const EXE_PATH = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test.setTimeout(300000);

let electronApp = null;
let win = null;

test.beforeEach(async () => {
  electronApp = await launchApp([], null, EXE_PATH);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  await win.waitForTimeout(700);
});

test.afterEach(async () => {
  await hardClose(electronApp);
  electronApp = null;
  win = null;
});

// Sample the page canvas darkness inside a CSS rect (text presence proxy).
async function canvasDark(rect) {
  return await win.evaluate((rc) => {
    const canvas = document.querySelector('.page-slot[data-page="1"] .pdf-page canvas');
    if (!canvas) return null;
    const cr = canvas.getBoundingClientRect();
    const sx = Math.max(0, Math.round((rc.x - cr.x) * (canvas.width / cr.width)));
    const sy = Math.max(0, Math.round((rc.y - cr.y) * (canvas.height / cr.height)));
    const sw = Math.max(1, Math.round(rc.w * (canvas.width / cr.width)));
    const sh = Math.max(1, Math.round(rc.h * (canvas.height / cr.height)));
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(sx, sy, Math.min(sw, canvas.width - sx), Math.min(sh, canvas.height - sy));
    let dark = 0;
    const total = img.data.length / 4;
    for (let i = 0; i < img.data.length; i += 4) {
      const lum = 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
      if (lum < 128) dark++;
    }
    return Math.round((dark / total) * 10000) / 10000;
  }, rect);
}

async function domBox() {
  return await win.evaluate(() => {
    const b = document.querySelector('.edit-box[data-edit-box-id]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
}

test('D. add-box drag-release: poll DOM rect + canvas darkness at R0/R1', async () => {
  await win.locator('.sample-card:has-text("report.pdf")').first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2200);
  await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector('.page-slot[data-page="1"]');
    if (sc && slot) sc.scrollTop = slot.offsetTop - 10;
  });
  await win.waitForTimeout(1200);

  const pr = await win.evaluate(() => {
    const page = document.querySelector('.page-slot[data-page="1"] .pdf-page');
    const r = page.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  expect(pr).toBeTruthy();

  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);

  const p0 = { x: pr.x + pr.w * 0.16, y: pr.y + pr.h * 0.14 };
  await win.mouse.move(p0.x, p0.y);
  await win.mouse.down();
  await win.mouse.move(p0.x + 150, p0.y + 90, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(700);
  const ta = win.locator('[data-edit-textarea]').first();
  await ta.waitFor({ timeout: 10000 });
  await ta.fill('MOVE TEST 88');
  await win.waitForTimeout(250);
  await win.click('[aria-label="Apply edit"]');
  await win.waitForTimeout(1800);

  const R0 = await domBox();
  expect(R0, 'committed box must exist').toBeTruthy();
  process.stdout.write(`[R0] ${JSON.stringify(R0)}\n`);

  // Drag slowly with real steps; sample the DOM rect MID-DRAG.
  const start = { x: R0.x + R0.w / 2, y: R0.y + R0.h / 2 };
  await win.mouse.move(start.x, start.y);
  await win.mouse.down();
  for (let i = 1; i <= 6; i++) {
    await win.mouse.move(start.x + (200 * i) / 6, start.y + (120 * i) / 6, { steps: 2 });
    await win.waitForTimeout(60);
    if (i === 3) {
      const mid = await domBox();
      process.stdout.write(`[MID-DRAG step3] dom=${JSON.stringify(mid)} (expect ~R0+100,+60 if live)\n`);
      await win.screenshot({ path: path.join(SHOTS, 'def-155-d-middrag-live.png') });
    }
  }
  const preUp = await domBox();
  process.stdout.write(`[PRE-UP] dom=${JSON.stringify(preUp)} (expect ~R0+200,+120)\n`);
  await win.mouse.up();

  // Poll DOM rect + canvas darkness at R0 and R1 for ~4s.
  const R1expect = { x: R0.x + 200, y: R0.y + 120, w: R0.w, h: R0.h };
  const samples = [];
  for (let i = 0; i < 26; i++) {
    const dom = await domBox();
    const darkR0 = await canvasDark({ x: R0.x + 6, y: R0.y + 6, w: R0.w - 12, h: R0.h - 12 });
    const darkR1 = await canvasDark({ x: R1expect.x + 6, y: R1expect.y + 6, w: R1expect.w - 12, h: R1expect.h - 12 });
    samples.push({ t: i * 150, dom, darkR0, darkR1 });
    if (i === 2) await win.screenshot({ path: path.join(SHOTS, 'def-155-d-release-300ms.png') });
    if (i === 12) await win.screenshot({ path: path.join(SHOTS, 'def-155-d-release-1800ms.png') });
    if (i === 25) await win.screenshot({ path: path.join(SHOTS, 'def-155-d-release-3900ms.png') });
    await win.waitForTimeout(150);
  }
  for (const s of samples) {
    process.stdout.write(`[POLL t=${s.t}ms] dom=${JSON.stringify(s.dom)} darkR0=${s.darkR0} darkR1=${s.darkR1}\n`);
  }

  // Summary: stale window = time span where darkR0 still > 0.5% after release.
  const stale = samples.filter((s) => s.darkR0 !== null && s.darkR0 > 0.5);
  process.stdout.write(`[RES|STALE-WINDOW] samplesWithR0Text=${stale.length}/${samples.length} lastStaleT=${stale.length ? stale[stale.length - 1].t : 0}ms\n`);
  await win.screenshot({ path: path.join(SHOTS, 'def-155-d-final.png') });
});
