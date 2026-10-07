// TFL-1201 adversary probe — ER24 stamp placement (diff-pass).
// The diff removed the ignored page picker + false centering hint and relabelled
// the confirm to "Start placement"; the placement handler App.tsx:7214-7349 is
// unchanged. This probe attacks the real armed/place/cancel/undo flow on a
// DISPOSABLE copy of the sample and verifies the source file is never written.
//
// Run: node test-fixtures/tfl1201-adversary/probe_stamp.cjs

delete process.env.ELECTRON_RUN_AS_NODE;
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { getSamplePath, gotoStage, clickDockVerb, hardClose, openSample } = require('../../e2e/lib/helpers.cjs');

const DIR = __dirname;
const LOG = path.join(DIR, 'probe_stamp.log');
const lines = [];
const writeLog = () => fs.writeFileSync(LOG, lines.join('\n') + '\n');
const log = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); lines.push(s); process.stdout.write(s + '\n'); try { writeLog(); } catch (_) {} };

const hash = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const stat = (win) => win.evaluate(() => ({
  layer: document.querySelector('[data-stamp-layer]') !== null,
  annotations: document.querySelectorAll('[data-stamp-annotation]').length,
  dialogOpen: document.querySelector('[data-stamp-dialog]') !== null,
  canUndo: (() => { try { return window.tflexDiagnostics().canUndo; } catch (_) { return null; } })(),
}));

const G = { app: null };
async function main() {
  const samplePath = getSamplePath('report.pdf');
  const beforeHash = hash(samplePath);
  const beforeSize = fs.statSync(samplePath).size;
  log(`fixture=${samplePath} sha256(before)=${beforeHash} size=${beforeSize}`);

  const app = await launchApp();
  G.app = app;
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  await openSample(win, app, 'report.pdf');
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);

  // 1. Open stamp dialog, confirm arms placement.
  await gotoStage(win, 3);
  await clickDockVerb(win, 3, 'stamp');
  await win.waitForSelector('[data-stamp-dialog]', { timeout: 10000 });
  await win.waitForTimeout(300);
  const dlg = await win.evaluate(() => {
    const d = document.querySelector('[data-stamp-dialog]');
    const confirm = d ? d.querySelector('[data-stamp-confirm]') : null;
    return { confirmLabel: confirm ? confirm.textContent.trim() : null, pagePicker: d ? d.querySelector('[data-stamp-page-select]') !== null : null };
  });
  log(`[1] dialog ${JSON.stringify(dlg)}`);
  await win.locator('[data-stamp-confirm]').first().click();
  await win.waitForSelector('[data-stamp-dialog]', { state: 'detached', timeout: 8000 });
  await win.waitForSelector('[data-stamp-layer]', { timeout: 8000 });
  await win.waitForTimeout(300);
  log(`[2] armed ${JSON.stringify(await stat(win))}`);

  // 2. Escape BEFORE any page click -> cancel, no placement, layer gone.
  await win.keyboard.press('Escape');
  await win.waitForTimeout(600);
  const afterEsc = await stat(win);
  log(`[3] after Escape-before-click ${JSON.stringify(afterEsc)}`);

  // 3. Re-arm, then a single page click places exactly ONE stamp.
  await gotoStage(win, 3);
  await clickDockVerb(win, 3, 'stamp');
  await win.waitForSelector('[data-stamp-dialog]', { timeout: 10000 });
  await win.waitForTimeout(300);
  await win.locator('[data-stamp-confirm]').first().click();
  await win.waitForSelector('[data-stamp-dialog]', { state: 'detached', timeout: 8000 });
  await win.waitForSelector('[data-stamp-layer]', { timeout: 8000 });
  const preClick = await stat(win);
  log(`[4] re-armed ${JSON.stringify(preClick)}`);
  const box = await win.locator('.pdf-page[data-page="1"]').first().boundingBox();
  await win.mouse.click(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
  await win.waitForFunction(() => document.querySelectorAll('[data-stamp-annotation]').length >= 1, null, { timeout: 10000 });
  await win.waitForTimeout(600);
  const placed = await stat(win);
  log(`[5] after one click ${JSON.stringify(placed)}`);

  // 3b. A SECOND click right after placement must NOT place another stamp
  // (the flow disarms after one). Click a different spot.
  await win.mouse.click(Math.round(box.x + box.width / 3), Math.round(box.y + box.height / 3));
  await win.waitForTimeout(700);
  const afterSecond = await stat(win);
  log(`[6] after second click ${JSON.stringify(afterSecond)}`);

  // 4. Undo removes the placed stamp.
  await win.evaluate(() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); });
  await win.keyboard.press('Control+z');
  await win.waitForFunction(() => document.querySelectorAll('[data-stamp-annotation]').length === 0, null, { timeout: 10000 });
  await win.waitForTimeout(500);
  log(`[7] after undo ${JSON.stringify(await stat(win))}`);

  // 5. Source fixture must be byte-identical (no in-place write).
  await hardClose(app, 'tfl1201-stamp');
  G.app = null;
  const afterHash = hash(samplePath);
  const afterSize = fs.statSync(samplePath).size;
  log(`sha256(after)=${afterHash} size=${afterSize} unchanged=${afterHash === beforeHash}`);
  log('DONE');
}
main().catch(async (e) => {
  log(`PROBE ERROR: ${e && e.stack ? e.stack : e}`);
  try { if (G.app) await hardClose(G.app, 'tfl1201-stamp-err'); } catch (_) {}
  writeLog();
  process.exitCode = 1;
});
