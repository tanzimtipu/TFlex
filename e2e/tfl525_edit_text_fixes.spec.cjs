// TFL-687 (TFL-525 B) — focused verification of TFL-686: the symmetric
// Edit Text hover box, the symmetric Add Text box, and Cancel truly
// reverting both an existing text run and a brand-new Add Text box.
//
// Fix under test: commit e5bf019
//   - src/renderer/edit/EditOverlay.tsx — symmetricHoverRect() pads a run's
//     hover/selection box equally on all four sides; the Add Text mirror is
//     3px padding on every side (was 2px vertical / 3px horizontal).
//   - src/renderer/components/DocumentView.tsx — a blur onto the EDIT-text
//     action bars ([data-edit-box-toolbar] / [data-content-action-bar="textrun"])
//     no longer commits the live session, so Cancel discards it.
//
// Launches ONLY through the canonical e2e/lib/launch.cjs `launchApp`, opening
// assets/samples/report.pdf (a temp copy via getSamplePath, passed as a
// separate argv array element — never a shell shim).
//
// Run: npm.cmd run test:e2e -- tfl525_edit_text_fixes
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, gotoStage, scrollToPage } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const MARKER_RUN = 'QQRUNMARKER_TFL687';
const MARKER_BOX = 'QQBOXERMARKER_TFL687';

let app = null;
let win = null;
let reportSample = null;

test.setTimeout(300000);

test.beforeEach(async () => {
  reportSample = getSamplePath('report.pdf');
  app = await launchApp([reportSample]);
  win = await app.firstWindow();
  // argv open-path may land directly in the workspace; otherwise fall back to
  // the Open PDF dialog (the canonical e2e pattern).
  try {
    await win.waitForSelector('.workspace', { timeout: 30000 });
  } catch (_) {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportSample);
    const openBtn = win.locator('[data-toolbar-open]').first();
    if ((await openBtn.count()) > 0) await openBtn.click();
    else await win.locator('[data-home-tool="open"]').first().click();
    await win.waitForSelector('.workspace', { timeout: 30000 });
  }
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await scrollToPage(win, 1);
  await win.waitForTimeout(700);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl525');
  app = null;
  win = null;
});

// --- driving helpers --------------------------------------------------------

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

async function armBoxTool() {
  await gotoStage(win, 2);
  const verb = win.locator('[data-action-dock] [data-dock-verb="editTextBox"]').first();
  await verb.waitFor({ state: 'visible', timeout: 12000 });
  await verb.click();
  await win.waitForTimeout(400);
  await win.waitForFunction(
    () => document.querySelector('.edit-layer[data-tool="box"]') !== null,
    undefined,
    { timeout: 8000 },
  );
}

async function pageRect(page = 1) {
  return win.evaluate((want) => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]') || document;
    const el =
      pane.querySelector(`.page-slot[data-page="${want}"]`) ||
      document.querySelector(`.page-slot[data-page="${want}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, page);
}

// The first page-1 textLayer span with visible glyphs; the independent oracle
// for the run's glyph box.
async function findRunSpan() {
  return win.evaluate(() => {
    const spans = Array.from(
      document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'),
    );
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      const r = s.getBoundingClientRect();
      if (t.length >= 6 && r.width > 20 && r.height > 4) {
        return { text: t, x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      }
    }
    return null;
  });
}

// Distinct page-1 runs with visible glyphs, for the symmetry sweep. Keeps the
// first span per text value; the descender-rich body run is included when the
// document has one.
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
      if (t.length >= 4 && r.width > 20 && r.height > 4 && !seen.has(t)) {
        seen.add(t);
        out.push({ text: t, x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 });
      }
    }
    return out;
  });
}

// Measure the hover box vs a run's glyph box. Returns null when no hover box
// appears for that run.
async function measureHover(run) {
  await win.mouse.move(5, 5);
  await win.waitForTimeout(120);
  await win.mouse.move(run.cx, run.cy);
  await win.waitForTimeout(400);
  const hover = win.locator('.page-slot[data-page="1"] .edit-text-hover').first();
  try {
    await hover.waitFor({ state: 'visible', timeout: 6000 });
  } catch (_) {
    return null;
  }
  const hb = await hover.boundingBox();
  if (!hb) return null;
  return {
    run,
    hoverBox: { x: hb.x, y: hb.y, w: hb.width, h: hb.height },
    topGap: run.y - hb.y,
    bottomGap: hb.y + hb.height - (run.y + run.h),
    leftGap: run.x - hb.x,
    rightGap: hb.x + hb.width - (run.x + run.w),
  };
}

async function typeIntoTextPanel(marker) {
  const f = win.locator('[data-txt-text]').first();
  await f.waitFor({ state: 'visible', timeout: 12000 });
  await f.click();
  await f.fill(marker);
  await win.waitForTimeout(500);
}

async function drawBox() {
  const pr = await pageRect(1);
  expect(pr, 'page 1 slot present').not.toBeNull();
  const x0 = pr.x + pr.w * 0.28;
  const y0 = pr.y + pr.h * 0.42;
  const x1 = x0 + Math.min(260, pr.w * 0.45);
  const y1 = y0 + 80;
  await win.mouse.move(x0, y0);
  await win.mouse.down();
  await win.mouse.move(x1, y1, { steps: 15 });
  await win.mouse.up();
  await win.waitForTimeout(700);
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

// Engine-document text extraction oracle: parse a saved/opened PDF with
// pdfjs-dist and return page-1 text, normalised. This reparses the file on
// disk (document-safety rule: never trust the save dialog alone).
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

// Byte-level presence check: the engine bakes a newly drawn text box into the
// saved content stream as literal characters (the pdfjs extractor cannot map
// the freshly embedded subset font without its ToUnicode CMap, so a byte scan
// is the reliable oracle for "the text was written to the file").
function pdfBytesContain(filePath, needle) {
  return fs.readFileSync(filePath).includes(Buffer.from(needle, 'latin1'));
}

test('1. symmetric hover box around an existing text run', async () => {
  await armTextTool();
  const run = await findRunSpan();
  expect(run, 'a page-1 text run is present').not.toBeNull();

  // Measure the DEF-535 evidence run plus every other distinct page-1 run,
  // so at least one descender-rich run is covered.
  const candidates = await findRunSpans();
  const runs = [run, ...candidates.filter((r) => r.text !== run.text)];
  const measurements = [];
  for (const r of runs) {
    const m = await measureHover(r);
    if (m) measurements.push(m);
  }
  expect(measurements.length, 'at least one run produced a hover box').toBeGreaterThan(0);
  console.log(`[TFL-687 #1] ${JSON.stringify(measurements)}`);
  fs.writeFileSync(path.join(SHOTS, 'tfl525-hover-measured.json'), JSON.stringify(measurements, null, 2));

  for (const m of measurements) {
    expect(
      Math.abs(m.topGap - m.bottomGap),
      `[${m.run.text}] vertical gaps equal within 2px (top=${m.topGap.toFixed(2)} bottom=${m.bottomGap.toFixed(2)})`,
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(m.leftGap - m.rightGap),
      `[${m.run.text}] horizontal gaps equal within 2px (left=${m.leftGap.toFixed(2)} right=${m.rightGap.toFixed(2)})`,
    ).toBeLessThanOrEqual(2);
  }

  // Cropped screenshot of the DEF-535 evidence run's hover surface + a
  // full-page context shot.
  await measureHover(run);
  const hover = win.locator('.page-slot[data-page="1"] .edit-text-hover').first();
  await hover.waitFor({ state: 'visible', timeout: 10000 });
  await hover.screenshot({ path: path.join(SHOTS, 'tfl525-hover-box.png') });
  await win.screenshot({ path: path.join(SHOTS, 'tfl525-hover-page.png') });
});

test('2. symmetric Add Text box padding around its text', async () => {
  await armBoxTool();
  await drawBox();

  const previewCount = await win.locator('.edit-box-preview').count();
  console.log(`[TFL-687 #2] .edit-box-preview count during/after drag=${previewCount}`);

  await typeIntoTextPanel(MARKER_BOX);

  const box = win.locator('.edit-box').first();
  await box.waitFor({ state: 'visible', timeout: 10000 });
  const bb = await box.boundingBox();

  const m = await win.evaluate(() => {
    const b = document.querySelector('.edit-box');
    if (!b) return null;
    // The mirror carries the padding (inline "3px 3px"); it is the padding box
    // the text actually lives in.
    const mirror = b.querySelector('div[style*="padding"]') || b.firstElementChild;
    const cs = getComputedStyle(mirror);
    const bands = Array.from(b.querySelectorAll('.edit-box-line-band'));
    const rects = bands.map((e) => e.getBoundingClientRect());
    const rb = b.getBoundingClientRect();
    const out = {
      padTop: parseFloat(cs.paddingTop), padBottom: parseFloat(cs.paddingBottom),
      padLeft: parseFloat(cs.paddingLeft), padRight: parseFloat(cs.paddingRight),
      text: (b.textContent || '').trim(),
    };
    if (rects.length > 0) {
      const tTop = Math.min(...rects.map((r) => r.top));
      const tBottom = Math.max(...rects.map((r) => r.bottom));
      const tLeft = Math.min(...rects.map((r) => r.left));
      const tRight = Math.max(...rects.map((r) => r.right));
      out.topGap = tTop - rb.top;
      out.bottomGap = rb.bottom - tBottom;
      out.leftGap = tLeft - rb.left;
      out.rightGap = rb.right - tRight;
    }
    return out;
  });
  console.log(`[TFL-687 #2] box=${JSON.stringify(bb)} ${JSON.stringify(m)}`);
  fs.writeFileSync(path.join(SHOTS, 'tfl525-addbox-measured.json'), JSON.stringify({ box: bb, ...m }, null, 2));
  await win.screenshot({ path: path.join(SHOTS, 'tfl525-addbox.png') });

  expect(m, 'mirror padding readable').not.toBeNull();
  // The fix: the Add Text mirror padding is equal on every side (was 2px
  // vertical / 3px horizontal). The padding IS the breathing room around the
  // text content box; measured ink gaps additionally include the line-box
  // leading, so the padding box is the correct oracle here.
  expect(Math.abs(m.padTop - m.padBottom), `padTop=${m.padTop} padBottom=${m.padBottom}`).toBeLessThanOrEqual(2);
  expect(Math.abs(m.padLeft - m.padRight), `padLeft=${m.padLeft} padRight=${m.padRight}`).toBeLessThanOrEqual(2);
  expect(Math.abs(m.padTop - m.padLeft), `padTop=${m.padTop} padLeft=${m.padLeft}`).toBeLessThanOrEqual(2);
  // Measured horizontal breathing room around the rendered text is equal too.
  expect(m.leftGap, 'measured left gap present').toBeDefined();
  expect(Math.abs(m.leftGap - m.rightGap), `leftGap=${m.leftGap?.toFixed(2)} rightGap=${m.rightGap?.toFixed(2)}`).toBeLessThanOrEqual(2);
  expect(m.text).toContain(MARKER_BOX);
});

test('3. Cancel reverts an existing text run (Save As + reparse identical)', async () => {
  const baselineText = await page1TextOfPdf(reportSample);
  console.log(`[TFL-687 #3] baseline page-1 text (${baselineText.length} chars): ${baselineText.slice(0, 90)}`);

  await armTextTool();
  const run = await findRunSpan();
  expect(run, 'a page-1 text run is present').not.toBeNull();
  console.log(`[TFL-687 #3] target run=${JSON.stringify(run)}`);

  await win.mouse.click(run.cx, run.cy);
  await win.locator('[data-textrun-selection]').first().waitFor({ state: 'visible', timeout: 10000 });
  await win.screenshot({ path: path.join(SHOTS, 'tfl525-run-before.png') });

  await typeIntoTextPanel(MARKER_RUN);
  const liveText = await win.evaluate(() => {
    const el = document.querySelector('[data-textrun-selection]');
    return el ? el.getAttribute('data-textrun-text') : null;
  });
  console.log(`[TFL-687 #3] live session text after typing=${JSON.stringify(liveText)}`);
  await win.screenshot({ path: path.join(SHOTS, 'tfl525-run-edited.png') });

  // Press Cancel. This first blurs the Inspector Text field onto the bar
  // button — the exact sequence the fix guards.
  await win.locator('[data-content-action="textrun-cancel"]').first().click();
  await win.waitForTimeout(700);

  const selectionCount = await win.locator('[data-textrun-selection]').count();
  await win.mouse.move(5, 5);
  await win.waitForTimeout(300);
  const hoverCount = await win.locator('.page-slot[data-page="1"] .edit-text-hover').count();
  console.log(`[TFL-687 #3] after Cancel selection=${selectionCount} hover=${hoverCount}`);
  await win.screenshot({ path: path.join(SHOTS, 'tfl525-run-after-cancel.png') });
  expect(selectionCount, 'selection surface unmounts after Cancel').toBe(0);
  expect(hoverCount, 'hover surface unmounts after Cancel + mouse away').toBe(0);

  // The renderer text layer must not carry the marker.
  const layerText = await win.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'));
    return spans.map((s) => s.textContent || '').join(' ');
  });
  expect(layerText.includes(MARKER_RUN), 'marker absent from the text layer').toBe(false);

  // Document-safety: Save As, then REPARSE the saved file.
  const saved = await saveAs(`tfl525-run-cancel-${Date.now()}.pdf`);
  const savedText = await page1TextOfPdf(saved);
  fs.writeFileSync(
    path.join(SHOTS, 'tfl525-run-saved-text.txt'),
    `BASELINE:\n${baselineText}\n\nSAVED:\n${savedText}\n`,
  );
  console.log(`[TFL-687 #3] saved page-1 text (${savedText.length} chars): ${savedText.slice(0, 90)}`);
  expect(savedText.includes(MARKER_RUN), 'marker absent from the saved PDF').toBe(false);
  expect(savedText, 'saved page-1 text byte-identical to the pre-edit baseline').toBe(baselineText);
});

test('4+5. Cancel removes a brand-new Add Text box; Confirm still commits', async () => {
  await armBoxTool();

  // --- assertion 4: brand-new box typed into then Cancelled ---------------
  await drawBox();
  await typeIntoTextPanel(MARKER_BOX);
  await win.locator('[data-edit-box-action="cancel"]').first().waitFor({ state: 'visible', timeout: 10000 });
  await win.screenshot({ path: path.join(SHOTS, 'tfl525-newbox-before-cancel.png') });

  await win.locator('[data-edit-box-action="cancel"]').first().click();
  await win.waitForTimeout(800);

  const boxesAfterCancel = await win.locator('.edit-box').count();
  const layerText = await win.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'));
    return spans.map((s) => s.textContent || '').join(' ');
  });
  console.log(`[TFL-687 #4] after Cancel .edit-box=${boxesAfterCancel} markerInLayer=${layerText.includes(MARKER_BOX)}`);
  await win.screenshot({ path: path.join(SHOTS, 'tfl525-newbox-after-cancel.png') });
  expect(boxesAfterCancel, 'no .edit-box remains after Cancel').toBe(0);
  expect(layerText.includes(MARKER_BOX), 'marker absent from the text layer').toBe(false);

  const savedCancel = await saveAs(`tfl525-box-cancel-${Date.now()}.pdf`);
  const savedCancelText = await page1TextOfPdf(savedCancel);
  expect(savedCancelText.includes(MARKER_BOX), 'marker absent from the saved PDF text after Cancel').toBe(false);
  expect(pdfBytesContain(savedCancel, MARKER_BOX), 'marker absent from the saved PDF bytes after Cancel').toBe(false);

  // --- assertion 5: no regression — Confirm DOES commit -------------------
  await drawBox();
  await typeIntoTextPanel(MARKER_BOX);
  await win.locator('[data-edit-box-action="confirm"]').first().waitFor({ state: 'visible', timeout: 10000 });
  await win.screenshot({ path: path.join(SHOTS, 'tfl525-newbox-before-confirm.png') });

  await win.locator('[data-edit-box-action="confirm"]').first().click();
  await win.waitForTimeout(1500);
  const diag = await win.evaluate(() => window.tflexDiagnostics());
  const boxCount = await win.locator('.edit-box').count();
  console.log(`[TFL-687 #5] after Confirm modified=${diag.modified} boxCount=${boxCount}`);
  await win.screenshot({ path: path.join(SHOTS, 'tfl525-newbox-after-confirm.png') });
  expect(diag.modified, 'Confirm marks the document modified (commit happened)').toBe(true);

  const savedConfirm = await saveAs(`tfl525-box-confirm-${Date.now()}.pdf`);
  const savedConfirmText = await page1TextOfPdf(savedConfirm);
  const bytesHaveMarker = pdfBytesContain(savedConfirm, MARKER_BOX);
  console.log(`[TFL-687 #5] saved page-1 pdfjs has marker=${savedConfirmText.includes(MARKER_BOX)} rawBytesHaveMarker=${bytesHaveMarker}`);
  expect(bytesHaveMarker, 'marker present in the saved PDF bytes after Confirm').toBe(true);
});
