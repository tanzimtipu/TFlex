// DEF-174 markup regression: the /CA 0.35 highlight fix and the
// parsed-from-file overlay suppression must be HIGHLIGHT-ONLY.
// underline/strikeout/squiggly were explicitly left alone - they are
// intentional SOLID strokes and must stay that way, in-session and after
// save/reopen.
//
//   1. Underline + Strikethrough via the markup toolbar: solid overlay
//      strokes in-session (stroke-opacity 1), saved as native /Underline +
//      /StrikeOut with /QuadPoints and NO /CA (unchanged), and after reopen
//      both re-import AND still draw their overlay strokes (the suppression
//      must not leak to stroke kinds).
//   2. Squiggly has no toolbar button (parse/save native kind only): a
//      crafted /Squiggly fixture (test-fixtures/squiggly-native.pdf) must
//      re-import and render on the pdf.js canvas (red squiggle pixels) with
//      no overlay element (no overlay case exists for squiggly - canvas
//      render only, unchanged).
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, PDFDict, PDFName, PDFArray } = require('@cantoo/pdf-lib');
const {
  launchDev, openSample, openSamplePath, scrollToPage, shot, hardClose, armAnnotationTool,
} = require('../lib/helpers.cjs');

function pickSpanFactory(win) {
  return () => win.evaluate(() => {
    const pageEl = document.querySelector('.tab-pane[aria-hidden="false"] .pdf-page[data-page="1"]')
      || document.querySelector('.tab-pane[aria-hidden="false"] .pdf-page');
    const spans = Array.from(pageEl.querySelectorAll('.textLayer span'))
      .map((s) => {
        const r = s.getBoundingClientRect();
        return { text: (s.textContent || '').trim(), x: r.x, y: r.y, w: r.width, h: r.height };
      })
      .filter((r) => r.w > 30 && r.h > 6 && r.text && r.y > 80 && r.y < window.innerHeight - 120);
    return spans.find((s) => /TFlex|Technical|Report/i.test(s.text)) || spans.find((s) => s.w > 60) || spans[0] || null;
  });
}

async function dragAcrossSpan(win, span) {
  await win.mouse.move(span.x + 2, span.y + span.h / 2);
  await win.mouse.down();
  await win.mouse.move(span.x + span.w * 0.5, span.y + span.h / 2 + 1, { steps: 4 });
  await win.mouse.move(span.x + span.w - 2, span.y + span.h / 2 + 2, { steps: 4 });
  await win.mouse.up();
  await win.waitForTimeout(900);
}

// Overlay <line> stroke info for a markup kind inside the active pane.
function readStrokeInfo(win, kind) {
  return win.evaluate((kind) => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
    return Array.from(pane.querySelectorAll(`g.ann-markup[data-kind="${kind}"] line`))
      .map((l) => {
        const cs = getComputedStyle(l);
        return {
          stroke: l.getAttribute('stroke'),
          strokeOpacity: cs.getPropertyValue('stroke-opacity'),
          strokeWidth: cs.getPropertyValue('stroke-width'),
        };
      });
  }, kind);
}

test('DEF-174 regression: underline + strikeout stay solid strokes, save/reopen correct', async () => {
  test.setTimeout(240000);
  const { electronApp, window: win } = await launchDev();
  try {
    const appVersion = await electronApp.evaluate(({ app }) => app.getVersion());
    console.log(`[def174markup] app version: ${appVersion}`);

    await openSample(win, electronApp, 'report.pdf');
    await win.waitForTimeout(1200);
    await scrollToPage(win, 1);
    await win.waitForTimeout(400);
    const pickSpan = pickSpanFactory(win);

    // --- Underline across the title ---
    await armAnnotationTool(win, 'underline');
    await win.waitForTimeout(350);
    const spanU = await pickSpan();
    expect(spanU).not.toBeNull();
    await dragAcrossSpan(win, spanU);

    // --- Strikethrough across another span ---
    await armAnnotationTool(win, 'strikeout');
    await win.waitForTimeout(350);
    const spanS = await pickSpan();
    expect(spanS).not.toBeNull();
    await dragAcrossSpan(win, spanS);

    // In-session: solid overlay strokes for both kinds.
    const underline = await readStrokeInfo(win, 'underline');
    const strikeout = await readStrokeInfo(win, 'strikeout');
    const strokeInfo = { underline, strikeout };
    console.log(`[def174markup] in-session strokes: ${JSON.stringify(strokeInfo, null, 1)}`);
    expect(strokeInfo.underline.length, 'committed underline must render overlay stroke(s)').toBeGreaterThanOrEqual(1);
    expect(strokeInfo.strikeout.length, 'committed strikeout must render overlay stroke(s)').toBeGreaterThanOrEqual(1);
    for (const s of [...strokeInfo.underline, ...strokeInfo.strikeout]) {
      expect(parseFloat(s.strokeOpacity), 'markup strokes must stay SOLID (stroke-opacity 1 - not the highlight 0.35 wash)').toBe(1);
    }

    const engine = await win.evaluate(() => window.tflexDiagnostics().engineState.annotations.map((a) => a.kind));
    expect(engine).toContain('underline');
    expect(engine).toContain('strikeout');
    await shot(win, 'def-174-markup-in-session.png');

    // --- Save As; parse the saved bytes ---
    const savePath = path.join(os.tmpdir(), `def174markup-${Date.now()}.pdf`);
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, savePath);
    await win.click('[data-toolbar-save-as]');
    await win.click('[data-save-as-confirm="true"]');
    await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 30000 });

    const savedPdf = await PDFDocument.load(fs.readFileSync(savePath), { ignoreEncryption: true, updateMetadata: false });
    const found = {};
    for (const [, obj] of savedPdf.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict) {
        const subtype = obj.get(PDFName.of('Subtype'));
        const st = subtype && subtype.toString();
        if (st === '/Underline' || st === '/StrikeOut') {
          const quads = obj.get(PDFName.of('QuadPoints'));
          const ca = obj.get(PDFName.of('CA'));
          found[st] = {
            quadOk: quads instanceof PDFArray && quads.size() >= 8 && quads.size() % 8 === 0,
            ca: ca && typeof ca.asNumber === 'function' ? ca.asNumber() : null,
          };
        }
      }
    }
    console.log(`[def174markup] saved markup annots: ${JSON.stringify(found)}`);
    expect(found['/Underline'], 'saved PDF must contain a native /Underline').toBeTruthy();
    expect(found['/Underline'].quadOk, '/Underline must carry /QuadPoints').toBe(true);
    expect(found['/StrikeOut'], 'saved PDF must contain a native /StrikeOut').toBeTruthy();
    expect(found['/StrikeOut'].quadOk, '/StrikeOut must carry /QuadPoints').toBe(true);
    expect(found['/Underline'].ca, 'DEF-174 fix is HIGHLIGHT-ONLY: /Underline must NOT get /CA 0.35 (no /CA at all)').toBeNull();
    expect(found['/StrikeOut'].ca, 'DEF-174 fix is HIGHLIGHT-ONLY: /StrikeOut must NOT get /CA 0.35 (no /CA at all)').toBeNull();

    // --- Reopen: both re-import and KEEP their overlay strokes ---
    await win.locator('.tab-active .tab-close').click();
    await win.waitForTimeout(1500);
    await openSamplePath(win, electronApp, savePath);
    await win.waitForSelector('.pdf-page', { timeout: 30000 });
    await win.waitForTimeout(2000);
    await scrollToPage(win, 1);

    const reopened = await win.evaluate(() => {
      const d = window.tflexDiagnostics();
      const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
      const read = (kind) => Array.from(pane.querySelectorAll(`g.ann-markup[data-kind="${kind}"] line`))
        .map((l) => {
          const cs = getComputedStyle(l);
          return { strokeOpacity: cs.getPropertyValue('stroke-opacity') };
        });
      return {
        kinds: (d.engineState.annotations || []).map((a) => a.kind),
        underline: read('underline'),
        strikeout: read('strikeout'),
      };
    });
    console.log(`[def174markup] after reopen: ${JSON.stringify(reopened, null, 1)}`);
    expect(reopened.kinds).toContain('underline');
    expect(reopened.kinds).toContain('strikeout');
    expect(reopened.underline.length, 'reopened underline must still render its overlay stroke (suppression is highlight-only)').toBeGreaterThanOrEqual(1);
    expect(reopened.strikeout.length, 'reopened strikeout must still render its overlay stroke (suppression is highlight-only)').toBeGreaterThanOrEqual(1);
    for (const s of [...reopened.underline, ...reopened.strikeout]) {
      expect(parseFloat(s.strokeOpacity), 'reopened markup strokes must stay solid').toBe(1);
    }
    await shot(win, 'def-174-markup-reopen.png');
    await win.locator('.tab-pane[aria-hidden="false"] .pdf-page[data-page="1"]').first().screenshot({
      path: path.resolve(__dirname, '..', '..', 'screenshots', 'def-174-markup-reopen-page1.png'),
    });

    try { fs.unlinkSync(savePath); } catch (_) { /* best effort */ }
  } finally {
    await hardClose(electronApp);
  }
});

test('DEF-174 regression: parsed /Squiggly re-imports and renders from the canvas (no overlay case - unchanged)', async () => {
  test.setTimeout(240000);
  const { electronApp, window: win } = await launchDev();
  try {
    const fixturePath = path.resolve(__dirname, '..', '..', 'test-fixtures', 'squiggly-native.pdf');
    await openSamplePath(win, electronApp, fixturePath);
    await win.waitForSelector('.pdf-page', { timeout: 30000 });
    await win.waitForTimeout(2000);
    await scrollToPage(win, 1);

    const state = await win.evaluate(() => {
      const d = window.tflexDiagnostics();
      const anns = d.engineState.annotations || [];
      return { kinds: anns.map((a) => a.kind), squiggly: anns.find((a) => a.kind === 'squiggly') || null };
    });
    console.log(`[def174squig] engine state: ${JSON.stringify(state)}`);
    expect(state.kinds, 'the /Squiggly fixture annotation must re-import').toContain('squiggly');
    expect(state.squiggly).not.toBeNull();

    // No overlay element for squiggly (the SVG switch has no squiggly case -
    // parsed squiggly renders via the pdf.js canvas only, unchanged).
    const overlayCount = await win.evaluate(() =>
      document.querySelectorAll('.tab-pane[aria-hidden="false"] g.ann-markup[data-kind="squiggly"]').length);
    console.log(`[def174squig] overlay squiggly elements: ${overlayCount}`);
    expect(overlayCount, 'parsed squiggly must render canvas-only (no overlay case exists)').toBe(0);

    // Canvas must paint the red squiggle. Convert the engine rect (page
    // points, top-left origin) to a page-rel css bbox: the fixture page is
    // Letter 612x792 and the page element is scaled by width/612.
    const rel = await win.evaluate((ann) => {
      const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
      const page = pane.querySelector('.pdf-page[data-page="1"]') || pane.querySelector('.pdf-page');
      const pb = page.getBoundingClientRect();
      const scale = pb.width / 612;
      const r = ann.rects[0];
      return { x: r.x * scale, y: r.y * scale, w: r.width * scale, h: r.height * scale };
    }, state.squiggly);
    console.log(`[def174squig] squiggly page-rel css bbox: ${JSON.stringify(rel)}`);

    // Count red-ish squiggle pixels + dark glyphs directly on the canvas.
    const pixelCounts = await win.evaluate((rel) => {
      const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
      const page = pane.querySelector('.pdf-page[data-page="1"]') || pane.querySelector('.pdf-page');
      const canvas = page.querySelector('canvas');
      const pb = page.getBoundingClientRect();
      const cb = canvas.getBoundingClientRect();
      const sx = canvas.width / cb.width;
      const sy = canvas.height / cb.height;
      const x0 = Math.max(0, Math.round((rel.x + (pb.left - cb.left)) * sx));
      const y0 = Math.max(0, Math.round((rel.y + (pb.top - cb.top)) * sy));
      const w = Math.max(1, Math.min(canvas.width - x0, Math.round(rel.w * sx)));
      const h = Math.max(1, Math.min(canvas.height - y0, Math.round(rel.h * sy)));
      const img = canvas.getContext('2d').getImageData(x0, y0, w, h);
      let red = 0, dark = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
        if (r > 150 && g < 110 && b < 110) red += 1;
        if (r < 100 && g < 100 && b < 100) dark += 1;
      }
      return { red, dark, bbox: [x0, y0, w, h] };
    }, rel);
    console.log(`[def174squig] pixel counts under squiggly bbox: ${JSON.stringify(pixelCounts)}`);
    expect(pixelCounts.red, 'pdf.js must paint the native /Squiggly onto the canvas (red pixels present)').toBeGreaterThan(0);
    expect(pixelCounts.dark, 'fixture glyphs must stay readable').toBeGreaterThan(0);

    await shot(win, 'def-174-squiggly-reopen.png');
    await win.locator('.tab-pane[aria-hidden="false"] .pdf-page[data-page="1"]').first().screenshot({
      path: path.resolve(__dirname, '..', '..', 'screenshots', 'def-174-squiggly-page1.png'),
    });
  } finally {
    await hardClose(electronApp);
  }
});