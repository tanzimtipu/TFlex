// TFL-695 adversary diff-pass — real-app probe for the TFL-525 run-session
// commit boundaries the TFL-693 `pendingRunCommitTargetRef` fallback may have
// missed. Adversary-authored; fixes nothing.
//
// Hypothesis (from reading src/renderer/edit/EditOverlay.tsx + DocumentView.tsx):
// the fallback parks the run target ONLY in the run bar's Confirm handler. Any
// OTHER path that clears the live target (tool disarm via Escape, selecting a
// different run) still loses the run edit instead of committing it as the
// host's target-change comment promises ("so no edit is lost").
//
// Oracle: Save As, then reparse the saved file with pdfjs (never trust the
// dialog); a committed run edit is present in the saved text, a lost one is not.
//
// Run: npm.cmd run test:e2e -- e2e/tfl525_adversary_diffpass.spec.cjs --reporter=line
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, gotoStage, scrollToPage } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

test.setTimeout(300000);

let app = null;
let win = null;

test.beforeEach(async () => {
  const sample = getSamplePath('report.pdf');
  app = await launchApp([sample]);
  win = await app.firstWindow();
  try {
    await win.waitForSelector('.workspace', { timeout: 30000 });
  } catch (_) {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, sample);
    const openBtn = win.locator('[data-toolbar-open]').first();
    if ((await openBtn.count()) > 0) await openBtn.click();
    else await win.locator('[data-home-tool="open"]').first().click();
    await win.waitForSelector('.workspace', { timeout: 30000 });
  }
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await scrollToPage(win, 1);
  await win.waitForTimeout(600);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl695adv');
  app = null;
  win = null;
});

async function armTextTool() {
  await gotoStage(win, 2);
  const verb = win.locator('[data-action-dock] [data-dock-verb="editText"]').first();
  await verb.waitFor({ state: 'visible', timeout: 12000 });
  await verb.click();
  await win.waitForTimeout(400);
  await win.waitForFunction(
    () => document.querySelector('.edit-layer[data-tool="text"]') !== null,
    undefined,
    { timeout: 8000 },
  );
}

async function findRunSpans() {
  return win.evaluate(() => {
    const spans = Array.from(
      document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'),
    );
    const seen = new Set();
    const out = [];
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      const r = s.getBoundingClientRect();
      if (t.length >= 6 && r.width > 20 && r.height > 4 && !seen.has(t)) {
        seen.add(t);
        out.push({ text: t, x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 });
      }
    }
    return out;
  });
}

async function typeIntoTextPanel(value) {
  const f = win.locator('[data-txt-text]').first();
  await f.waitFor({ state: 'visible', timeout: 12000 });
  await f.click();
  await f.fill(value);
  await win.waitForTimeout(500);
}

async function saveAs(fileName) {
  const savePath = path.join(os.tmpdir(), fileName);
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.locator('[data-toolbar-save-as]').first().click();
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 12000 });
  await win.waitForTimeout(300);
  await win.locator('[data-save-as-confirm]').first().click();
  await win.waitForFunction(
    () => document.querySelector('[data-save-as-dialog]') === null,
    undefined,
    { timeout: 20000 },
  );
  await win.waitForTimeout(1800);
  expect(fs.existsSync(savePath), `Save As wrote ${savePath}`).toBe(true);
  return savePath;
}

async function page1TextOfPdf(pdfPath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  let txt = '';
  tc.items.forEach((it) => { txt += it.str + ' '; });
  await doc.destroy();
  return txt.replace(/\s+/g, ' ').trim();
}

async function page1LayerText() {
  return win.evaluate(() => {
    const layer = document.querySelector('.page-slot[data-page="1"] .textLayer');
    return layer ? (layer.textContent || '').replace(/\s+/g, ' ').trim() : '';
  });
}

// S1 — a run edit abandoned by Escape (disarm) must be EXPLICITLY DISCARDED.
// CTO ruling (2026-10-04): Escape is the keyboard abort for a live text
// session and discards it — the run text is reverted and the document is left
// unmodified. The original adversary oracle asserted commit-on-Escape; that
// expectation is overridden by the CTO ruling and asserted as discard here.
test('S1 run edit + Escape: discarded (document unmodified, marker absent)', async () => {
  await armTextTool();
  const runs = await findRunSpans();
  expect(runs.length, 'page-1 runs available').toBeGreaterThan(0);
  const run = runs[0];
  const marker = 'ZZESC' + Date.now().toString().slice(-5);

  await win.mouse.click(run.cx, run.cy);
  await win.waitForSelector('[data-textrun-selection]', { timeout: 10000 });
  await typeIntoTextPanel(run.text + ' ' + marker);
  await win.waitForTimeout(300);

  await win.keyboard.press('Escape');
  await win.waitForTimeout(1200);

  const layerText = await page1LayerText();
  const markerInLayer = layerText.includes(marker);
  const diag = await win.evaluate(() => (window.tflexDiagnostics ? window.tflexDiagnostics() : null));
  const modified = diag ? diag.modified : undefined;
  const canUndo = diag ? diag.canUndo : undefined;

  const saved = await saveAs(`tfl698-escape-${Date.now()}.pdf`);
  const text = await page1TextOfPdf(saved);
  const markerInSaved = text.includes(marker);
  console.log(`[TFL-698 S1] marker=${marker} markerInLayer=${markerInLayer} markerInSaved=${markerInSaved} modified=${modified} canUndo=${canUndo}`);
  await win.screenshot({ path: path.join(SHOTS, 'tfl698-s1-escape.png') });

  expect(markerInLayer, 'Escape must revert the run text (marker absent from the page-1 textLayer)').toBe(false);
  expect(markerInSaved, 'Escape must discard the run edit (marker absent from the Save-As reparse)').toBe(false);
  expect(modified, 'Escape must leave the document unmodified').toBe(false);
  expect(canUndo, 'Escape must not produce an engine op / undo entry').toBe(false);
});

// S2 — a run edit abandoned by selecting a different run must be COMMITTED.
test('S2 run edit + select another run: committed or silently lost?', async () => {
  await armTextTool();
  const runs = await findRunSpans();
  expect(runs.length, 'at least two distinct page-1 runs').toBeGreaterThan(1);
  const runA = runs[0];
  const runB = runs[1];
  const marker = 'ZZSWAP' + Date.now().toString().slice(-5);

  await win.mouse.click(runA.cx, runA.cy);
  await win.waitForSelector('[data-textrun-selection]', { timeout: 10000 });
  await typeIntoTextPanel(runA.text + ' ' + marker);
  await win.waitForTimeout(300);

  await win.mouse.click(runB.cx, runB.cy);
  await win.waitForTimeout(1200);

  const saved = await saveAs(`tfl695-swap-${Date.now()}.pdf`);
  const text = await page1TextOfPdf(saved);
  const committed = text.includes(marker);
  console.log(`[TFL-695 S2] marker=${marker} committedAfterRunSwitch=${committed}`);
  await win.screenshot({ path: path.join(SHOTS, 'tfl695-s2-swap.png') });
  expect(committed, 'a run edit live when another run is selected must be committed, not lost').toBe(true);
});

// S3 — a whitespace-only run commit must place nothing / not dirty the doc.
// Oracle: the run's ORIGINAL text must still be extractable from the saved file.
test('S3 whitespace-only run Confirm: does it destroy the original run text?', async () => {
  await armTextTool();
  const runs = await findRunSpans();
  expect(runs.length, 'page-1 runs available').toBeGreaterThan(0);
  const run = runs[0];
  const firstWord = run.text.split(/\s+/)[0];

  await win.mouse.click(run.cx, run.cy);
  await win.waitForSelector('[data-textrun-selection]', { timeout: 10000 });

  const savedBefore = await saveAs(`tfl695-baseline-${Date.now()}.pdf`);
  const beforeText = await page1TextOfPdf(savedBefore);
  expect(beforeText.includes(firstWord), 'baseline contains the run').toBe(true);

  await typeIntoTextPanel('   ');
  await win.waitForTimeout(300);
  const confirmCount = await win.locator('[data-content-action="textrun-confirm"]').count();
  await win.locator('[data-content-action="textrun-confirm"]').first().click().catch(() => {});
  await win.waitForTimeout(1600);
  const diag = await win.evaluate(() => (window.tflexDiagnostics ? window.tflexDiagnostics() : null));

  const savedAfter = await saveAs(`tfl695-ws-${Date.now()}.pdf`);
  const afterText = await page1TextOfPdf(savedAfter);
  const survived = afterText.includes(firstWord);
  console.log(`[TFL-698 S3] run="${run.text}" firstWord="${firstWord}" confirmCount=${confirmCount} modified=${diag && diag.modified} survivesWhitespaceCommit=${survived}`);
  await win.screenshot({ path: path.join(SHOTS, 'tfl698-s3-whitespace.png') });
  expect(survived, 'a whitespace-only run commit must not remove the original run text').toBe(true);
  expect(diag && diag.modified, 'a whitespace-only run Confirm must leave the document unmodified').toBe(false);
});

// S4 — a tool switch via the dock (which blurs the field first) vs Escape.
test('S4 run edit + dock tool switch: committed or lost?', async () => {
  await armTextTool();
  const runs = await findRunSpans();
  const run = runs[0];
  const marker = 'ZZDOCK' + Date.now().toString().slice(-5);

  await win.mouse.click(run.cx, run.cy);
  await win.waitForSelector('[data-textrun-selection]', { timeout: 10000 });
  await typeIntoTextPanel(run.text + ' ' + marker);
  await win.waitForTimeout(300);

  const boxVerb = win.locator('[data-action-dock] [data-dock-verb="editTextBox"]').first();
  await boxVerb.click();
  await win.waitForTimeout(1200);

  const saved = await saveAs(`tfl695-dock-${Date.now()}.pdf`);
  const text = await page1TextOfPdf(saved);
  const committed = text.includes(marker);
  console.log(`[TFL-695 S4] marker=${marker} committedAfterDockSwitch=${committed}`);
  await win.screenshot({ path: path.join(SHOTS, 'tfl695-s4-dock.png') });
  expect(committed, 'a run edit live at a dock tool switch must be committed, not lost').toBe(true);
});
