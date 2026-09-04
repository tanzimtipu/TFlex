// QA diagnostic for DEF-157 reopen visuals: reopen the saved file from the
// T4 run and dump full computed geometry/styles of the committed callout's
// svg line, arrowhead polygon and box div, then crop the full screenshot at
// the exact CSS->device coordinates of the line span and the box.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');
const fs = require('node:fs');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const SAVE = process.env.TFLEX_DEF157_SAVE || '';

test.setTimeout(240000);

let electronApp = null;
let win = null;

test('diag DEF-157 reopen callout svg styles', async () => {
  expect(SAVE, 'saved file path env must be set').toBeTruthy();
  expect(fs.existsSync(SAVE), 'saved file exists').toBe(true);

  electronApp = await launchApp([]);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome', { timeout: 30000 });
  const dpr = await win.evaluate(() => window.devicePixelRatio);
  process.stdout.write(`[DPR] ${dpr}\n`);

  await electronApp.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, SAVE);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2500);
  await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector('.page-slot[data-page="4"]');
    if (sc && slot) sc.scrollTop = slot.offsetTop - 10;
  });
  await win.waitForTimeout(1500);
  // The callout box sits ~860 page-local px down; the -10 offset leaves it
  // below the fold. Scroll further so box AND anchor are both on-screen.
  await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    if (sc) sc.scrollTop += 360;
  });
  await win.waitForTimeout(1200);

  const info = await win.evaluate(() => {
    const slot = document.querySelector('.page-slot[data-page="4"]');
    const svg = slot.querySelector('svg.ann-callout-arrow');
    const co = slot.querySelector('div.ann-callout[data-kind="callout"]');
    const line = svg && svg.querySelector('line');
    const poly = svg && svg.querySelector('polygon');
    const st = (el, props) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const o = {};
      for (const p of props) o[p] = cs[p];
      return o;
    };
    const rectOf = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const svgVB = svg ? { vb: svg.getAttribute('viewBox'), w: svg.getAttribute('width'), h: svg.getAttribute('height') } : null;
    return {
      dpr: window.devicePixelRatio,
      svgVB,
      svgRect: rectOf(svg),
      lineAttrs: line ? { x1: line.getAttribute('x1'), y1: line.getAttribute('y1'), x2: line.getAttribute('x2'), y2: line.getAttribute('y2') } : null,
      lineStyle: st(line, ['stroke', 'stroke-width', 'visibility', 'display', 'opacity']),
      lineRect: rectOf(line),
      polyPoints: poly ? poly.getAttribute('points') : null,
      polyStyle: st(poly, ['fill', 'stroke', 'visibility', 'display', 'opacity']),
      coRect: rectOf(co),
      coStyle: st(co, ['border', 'background-color', 'overflow', 'z-index']),
      coText: co ? (co.textContent || '').trim().slice(0, 40) : null,
    };
  });
  process.stdout.write(`[RES|REOPEN-DIAG] ${JSON.stringify(info, null, 1)}\n`);

  // line endpoints in CSS px (svg rect + svg-local coords; viewBox assumed 1:1)
  const lx1 = info.svgRect.x + Number(info.lineAttrs.x1);
  const ly1 = info.svgRect.y + Number(info.lineAttrs.y1);
  const lx2 = info.svgRect.x + Number(info.lineAttrs.x2);
  const ly2 = info.svgRect.y + Number(info.lineAttrs.y2);
  process.stdout.write(`[RES|LINE-CSS] (${lx1.toFixed(1)}, ${ly1.toFixed(1)}) -> (${lx2.toFixed(1)}, ${ly2.toFixed(1)})\n`);
  process.stdout.write(`[RES|BOX-CSS] ${JSON.stringify(info.coRect)}\n`);

  await win.screenshot({ path: path.join(SHOTS, 'def-157-1724-reopen-diag-full.png') });

  // Crop the line span region at device pixels (CSS * dpr), wide margin.
  const d = info.dpr;
  const minX = Math.min(lx1, lx2, info.coRect.x) - 80;
  const minY = Math.min(ly1, ly2, info.coRect.y) - 80;
  const maxX = Math.max(lx1, lx2, info.coRect.x + info.coRect.w) + 80;
  const maxY = Math.max(ly1, ly2, info.coRect.y + info.coRect.h) + 80;
  const clip = {
    x: Math.max(0, minX), y: Math.max(0, minY),
    width: Math.min(maxX - minX, 1400), height: Math.min(maxY - minY, 1000),
  };
  await win.screenshot({ path: path.join(SHOTS, 'def-157-1724-reopen-diag-crop.png'), clip });
  process.stdout.write(`[CROP] ${JSON.stringify(clip)}\n`);

  await hardClose(electronApp);
  electronApp = null;
});
