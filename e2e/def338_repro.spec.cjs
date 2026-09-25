// DEF-338 focused reproduction (QA, Phase 38 item 5).
//
// Operator report: "open TanzimulIslamPaySlip20260930.pdf from downloads
// folder in the 2nd window in multi view. The page glitches violently."
//
// This harness reproduces the exact flow (a normal fixture in pane A, Multi
// Mode on, the payslip opened into pane B) and captures the ACTUALLY PAINTED
// frames with CDP Page.startScreencast across: the open into pane 2, a focus
// switch to/from pane 2, a scroll, and a zoom step. It also records renderer
// console errors / pageerrors / unhandled rejections.
//
// The payslip is used IN PLACE from the operator's Downloads folder - it is
// never copied into the repo. Launches only through the canonical launchApp.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..', 'test-fixtures');
const REPORT = path.join(FIX, 'report.pdf');
const PAYSLIP = 'C:\\Users\\tanzi\\Downloads\\TanzimulIslamPaySlip20260930.pdf';
const FRAMES = path.resolve(__dirname, 'def338-frames');
fs.mkdirSync(FRAMES, { recursive: true });

let app = null;
let win = null;
const consoleLog = [];

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  win.on('console', (m) => consoleLog.push(`[console:${m.type()}] ${m.text()}`));
  win.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e.message}`));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'def338');
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
  await win.waitForTimeout(900);
}

async function startScreencast(page) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  cdp.on('Page.screencastFrame', (ev) => {
    frames.push({
      data: ev.data,
      ts: ev.metadata && ev.metadata.timestamp ? ev.metadata.timestamp : null,
      recv: Date.now(),
      w: ev.metadata ? ev.metadata.deviceWidth : null,
      h: ev.metadata ? ev.metadata.deviceHeight : null,
    });
    cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', {
    format: 'png', quality: 100, maxWidth: 1280, maxHeight: 900, everyNthFrame: 1,
  });
  return { cdp, frames };
}

async function stopScreencast(cdp) {
  try { await cdp.send('Page.stopScreencast'); } catch (_) { /* ignore */ }
  try { await cdp.detach(); } catch (_) { /* ignore */ }
}

function saveFrames(frames, prefix, from, count) {
  const out = [];
  const start = Math.max(0, from);
  for (let i = start; i < Math.min(frames.length, start + count); i += 1) {
    const p = path.join(FRAMES, `${prefix}-${String(i - start).padStart(2, '0')}.png`);
    fs.writeFileSync(p, Buffer.from(frames[i].data, 'base64'));
    out.push({ path: p, recv: frames[i].recv, ts: frames[i].ts });
  }
  return out;
}

// Pane B's on-screen rect (CSS px) so a frame can be measured in that region.
async function paneBRect() {
  return win.evaluate(() => {
    const el = document.querySelector('.tab-pane[data-pane="B"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
}

// Canvas geometry + a coarse pixel signature of pane B's page canvas.
async function paneBCanvas() {
  return win.evaluate(() => {
    const pane = document.querySelector('.tab-pane[data-pane="B"]');
    if (!pane) return null;
    const canvas = pane.querySelector('canvas.pdf-page-canvas');
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    let sig = null;
    try {
      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      const pts = [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.9, 0.9], [0.1, 0.9]];
      sig = pts.map(([fx, fy]) => {
        const d = ctx.getImageData(Math.floor(fx * (w - 1)), Math.floor(fy * (h - 1)), 1, 1).data;
        return [d[0], d[1], d[2]];
      });
    } catch (e) { sig = `err:${e.message}`; }
    return {
      backing: [canvas.width, canvas.height],
      css: [Math.round(r.width), Math.round(r.height)],
      styleW: canvas.style.width, styleH: canvas.style.height,
      transform: canvas.style.transform,
      sig,
    };
  });
}

test('DEF-338 repro: payslip into pane B of Multi Mode, screencast the open/focus/scroll/zoom', async () => {
  // Pane A = report.pdf (34 pages), single mode.
  await openViaToolbar(REPORT);
  await win.waitForSelector('.tab-pane canvas.pdf-page-canvas, .pdf-page canvas.pdf-page-canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);

  // Multi Mode ON -> pane B empty.
  await win.locator('[data-header-multi-mode]').first().click();
  await win.waitForTimeout(600);
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]')).toBeVisible({ timeout: 15000 });

  // Start the screencast BEFORE the open so the open's paint sequence is captured.
  const { cdp, frames } = await startScreencast(win);
  const t0 = Date.now();

  // Open the payslip into pane B through its own [data-pane-open].
  await mockOpen(PAYSLIP);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-open]').click();
  await win.waitForTimeout(2500);
  const openFrames = frames.length;
  const openSaved = saveFrames(frames, 'open', 0, openFrames);
  console.log(`[DEF338] OPEN: ${openFrames} frames in ${Date.now() - t0}ms; paneB canvas=${JSON.stringify(await paneBCanvas())}`);

  // Focus switch: click pane A's page, then pane B's page.
  const focusStart = frames.length;
  await win.locator('.tab-pane[data-pane="A"] .pdf-page').first().click({ position: { x: 40, y: 40 } }).catch(() => {});
  await win.waitForTimeout(900);
  await win.locator('.tab-pane[data-pane="B"] .pdf-page').first().click({ position: { x: 40, y: 40 } }).catch(() => {});
  await win.waitForTimeout(900);
  const focusFrames = frames.length - focusStart;
  saveFrames(frames, 'focus', focusStart, focusFrames);
  console.log(`[DEF338] FOCUS: ${focusFrames} frames; paneB canvas=${JSON.stringify(await paneBCanvas())}`);

  // Scroll pane B.
  const scrollStart = frames.length;
  const scroller = win.locator('.tab-pane[data-pane="B"] .document-scroller');
  const box = await scroller.boundingBox();
  if (box) {
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await win.mouse.wheel(0, 600);
    await win.waitForTimeout(1200);
  }
  const scrollFrames = frames.length - scrollStart;
  saveFrames(frames, 'scroll', scrollStart, scrollFrames);
  console.log(`[DEF338] SCROLL: ${scrollFrames} frames; paneB canvas=${JSON.stringify(await paneBCanvas())}`);

  // Zoom step on pane B.
  const zoomStart = frames.length;
  await win.locator('[data-pill-pane="B"] [aria-label="Zoom in"]').click().catch(() => {});
  await win.waitForTimeout(1500);
  const zoomFrames = frames.length - zoomStart;
  saveFrames(frames, 'zoom', zoomStart, zoomFrames);
  console.log(`[DEF338] ZOOM: ${zoomFrames} frames; paneB canvas=${JSON.stringify(await paneBCanvas())}`);

  await stopScreencast(cdp);
  console.log(`[DEF338] total frames=${frames.length}; paneBRect=${JSON.stringify(await paneBRect())}`);
  console.log(`[DEF338] console/errors (${consoleLog.length}):`);
  for (const l of consoleLog) console.log(`  ${l}`);

  // The reproduction is proven by the captured frames; assert the payslip is
  // actually in pane B so the capture is meaningful.
  const header = await win.locator('.tab-pane[data-pane="B"] [data-pane-header]').innerText().catch(() => '');
  console.log(`[DEF338] pane B header="${header.replace(/\s+/g, ' ').trim()}"`);
  expect(header).toContain('TanzimulIslamPaySlip20260930');
});
