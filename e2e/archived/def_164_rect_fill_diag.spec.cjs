// Diagnostic for the DEF-164 rect visual question: does the committed rect
// overlay have a fill, and does the reopened (baked /IC) render as a solid
// fill? Crops the same page-local region in both states + dumps the FULL
// engine annotation object for the rect.
const { test } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test.setTimeout(300000);

async function cropAt(win, name, pr, local) {
  const p = path.join(SHOTS, name);
  await win.screenshot({
    path: p,
    clip: {
      x: Math.max(0, pr.x + local.x - 25),
      y: Math.max(0, pr.y + local.y - 25),
      width: Math.min(local.w + 50, 1900),
      height: Math.min(local.h + 50, 1400),
    },
  });
  process.stdout.write(`[SHOT] ${name}\n`);
}

test('diag: rect fill committed vs reopened', async () => {
  const electronApp = await launchApp([]);
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  const sample = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, sample);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2200);
  for (let i = 0; i < 40; i += 1) {
    const st = await win.evaluate((want) => {
      const sc = document.querySelector('.document-scroller');
      if (!sc) return { done: false };
      const slot = document.querySelector(`.page-slot[data-page="${want}"]`);
      if (!slot) { sc.scrollTop += 1500; return { done: false }; }
      const r = slot.getBoundingClientRect();
      const delta = r.top - 90;
      if (Math.abs(delta) < 40) return { done: true };
      sc.scrollTop += delta;
      return { done: false };
    }, 4);
    await win.waitForTimeout(300);
    if (st.done) break;
  }
  await win.waitForTimeout(900);
  const pr = await win.evaluate(() => {
    const el = document.querySelector('.page-slot[data-page="4"] .pdf-page')
      || document.querySelector('.page-slot[data-page="4"]');
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

  // commit the rect
  await win.click('[data-annotation-toolbar] [data-tool="rect"]');
  await win.waitForTimeout(350);
  const x0 = pr.x + pr.w * 0.08, y0 = pr.y + pr.h * 0.52;
  await win.mouse.move(x0, y0);
  await win.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await win.mouse.move(x0 + (120 * i) / 8, y0 + (70 * i) / 8);
    await win.waitForTimeout(16);
  }
  await win.mouse.up();
  await win.waitForTimeout(700);

  const rectEl = await win.evaluate(() => {
    const slot = document.querySelector('.page-slot[data-page="4"]');
    for (const el of slot.querySelectorAll('rect[data-kind="rect"]')) {
      const r = el.getBoundingClientRect();
      if (r.width < 3) continue;
      const cs = getComputedStyle(el);
      const pageEl = slot.querySelector('.pdf-page') || slot;
      const prr = pageEl.getBoundingClientRect();
      return {
        local: { x: +(r.x - prr.x).toFixed(1), y: +(r.y - prr.y).toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
        stroke: cs.stroke, strokeWidth: cs.strokeWidth, fill: cs.fill, fillOpacity: cs.fillOpacity,
      };
    }
    return null;
  });
  process.stdout.write(`[RECT-DOM] ${JSON.stringify(rectEl)}\n`);
  const full = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    const a = (d.engineState.annotations || []).find((x) => x.kind === 'rect');
    return a || null;
  });
  process.stdout.write(`[RECT-ENGINE] ${JSON.stringify(full)}\n`);
  if (rectEl) await cropAt(win, 'def-164-rect-committed-crop.png', pr, rectEl.local);

  // save + reopen
  const savePath = path.join(os.tmpdir(), `tflex-def164-rect-${Date.now()}.pdf`);
  await electronApp.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[aria-label="Save As"]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  for (let i = 0; i < 24 && !fs.existsSync(savePath); i++) await win.waitForTimeout(500);
  await win.locator('.tab-active .tab-close').click();
  await win.waitForTimeout(1500);
  await electronApp.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, savePath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2500);
  for (let i = 0; i < 40; i += 1) {
    const st = await win.evaluate((want) => {
      const sc = document.querySelector('.document-scroller');
      if (!sc) return { done: false };
      const slot = document.querySelector(`.page-slot[data-page="${want}"]`);
      if (!slot) { sc.scrollTop += 1500; return { done: false }; }
      const r = slot.getBoundingClientRect();
      const delta = r.top - 90;
      if (Math.abs(delta) < 40) return { done: true };
      sc.scrollTop += delta;
      return { done: false };
    }, 4);
    await win.waitForTimeout(300);
    if (st.done) break;
  }
  await win.waitForTimeout(1200);
  if (rectEl) await cropAt(win, 'def-164-rect-reopened-crop.png', pr, rectEl.local);
  process.stdout.write(`[SAVED] ${savePath}\n`);
  await hardClose(electronApp);
});