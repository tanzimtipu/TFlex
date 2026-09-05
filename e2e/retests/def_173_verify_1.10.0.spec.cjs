// DEF-173 + DEF-174 retest on the DEV build (v1.10.0).
// DEF-173: committed highlight was an OPAQUE orange block hiding the
// highlighted text. Fix: styles.css `fill-opacity: 0.35` on
// `.ann-markup rect.ann-highlight` (committed) and
// `rect.ann-highlight.ann-preview` (drag preview).
// DEF-174: reopened /Highlight rendered as a HEAVY near-opaque block -
// two stacked render sources. Fix (two-part): (a) backend bakes /CA 0.35
// on the saved /Highlight so pdf.js paints the native appearance
// translucently (Multiply blend at fillAlpha 0.35) into the page canvas;
// (b) renderer suppresses the overlay <rect class="ann-highlight"> for
// highlights PARSED from the file (id not in liveAnnTextIds), so nothing
// draws a second wash on top of the canvas.
//
// Retest flow (mirrors the DEF-173 repro steps + DEF-174 reopen, from app launch):
//   1. Launch DEV build via launchApp (no executablePath).
//   2. Open the report.pdf sample (34 pages).
//   3. Arm Highlight, drag across the title text on page 1, release.
//   4. Mid-drag: drag-preview rect must already be translucent.
//   5. Committed rect: computed fill-opacity must be 0.35 (underlying text
//      stays readable - verified visually on the screenshots).
//   6. Click Highlight again to disarm: highlight persists, still translucent.
//   7. Save As to a temp file; re-parse the SAVED bytes with pdf-lib: a
//      native /Highlight annotation with /QuadPoints AND /CA 0.35 must exist.
//   8. Reopen the saved file: the highlight re-imports into the engine,
//      NO overlay ann-highlight rect is drawn (parsed-from-file suppression),
//      and the page canvas itself renders the highlight as a PALE orange
//      wash (~0.35 over white, ~rgb(244,208,182) dominant) with the title
//      glyphs still dark/readable - NOT the full-opacity #e07a2d block.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, PDFName, PDFDict, PDFArray } = require('pdf-lib');
const {
  launchDev, openSample, openSamplePath, scrollToPage, shot, sampleCanvasPageRect, hardClose,
} = require('../lib/helpers.cjs');

const ACTIVE_PANE = '.tab-pane[aria-hidden="false"]';

async function pickHighlightSpan(win) {
  return win.evaluate(() => {
    const pageEl = document.querySelector(`.tab-pane[aria-hidden="false"] .pdf-page`);
    if (!pageEl) return null;
    const spans = Array.from(pageEl.querySelectorAll('.textLayer span'))
      .map((s) => {
        const r = s.getBoundingClientRect();
        return {
          text: (s.textContent || '').trim(),
          x: r.x, y: r.y, w: r.width, h: r.height,
        };
      })
      .filter((r) => r.w > 30 && r.h > 6 && r.text && r.y > 80 && r.y < window.innerHeight - 120);
    // Prefer the report title per the DEF-173 repro; fall back to the
    // topmost wide span of page 1.
    const title = spans.find((s) => /TFlex|Technical|Report/i.test(s.text));
    const chosen = title || spans.find((s) => s.w > 60) || spans[0] || null;
    return { chosen, all: spans.slice(0, 12) };
  });
}

test('DEF-173/174: committed + preview highlight translucent; save bakes /CA 0.35; reopen renders pale canvas wash, no overlay', async () => {
  test.setTimeout(240000);
  const { electronApp, window: win } = await launchDev();
  try {
    const appVersion = await electronApp.evaluate(({ app }) => app.getVersion());
    console.log(`[def173] app version: ${appVersion}`);

    // --- 1. Open report.pdf sample (temp copy) ---
    await openSample(win, electronApp, 'report.pdf');
    await win.waitForTimeout(1200);
    await scrollToPage(win, 1);
    await win.waitForTimeout(400);

    // --- 2. Arm Highlight and drag across the page-1 title ---
    await win.click('button[aria-label="Highlight"]');
    await win.waitForTimeout(350);

    const spanInfo = await pickHighlightSpan(win);
    expect(spanInfo, 'page-1 textLayer spans must be available to drag across').not.toBeNull();
    expect(spanInfo.chosen, 'a draggable text span must exist on page 1').not.toBeNull();
    console.log(`[def173] drag span: ${JSON.stringify(spanInfo.chosen)} (candidates: ${JSON.stringify(spanInfo.all)})`);
    const s = spanInfo.chosen;

    // Drag: start just inside the span's left edge, end near its right edge.
    await win.mouse.move(s.x + 2, s.y + s.h / 2);
    await win.mouse.down();
    await win.mouse.move(s.x + s.w * 0.5, s.y + s.h / 2 + 1, { steps: 4 });

    // --- 3. MID-DRAG: the preview rect must already be translucent ---
    const preview = await win.evaluate(() => {
      const el = document.querySelector(`.tab-pane[aria-hidden="false"] rect.ann-highlight.ann-preview`);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        fill: el.getAttribute('fill'),
        fillOpacity: cs.getPropertyValue('fill-opacity'),
      };
    });
    console.log(`[def173] mid-drag preview rect: ${JSON.stringify(preview)}`);

    await win.mouse.move(s.x + s.w - 2, s.y + s.h / 2 + 2, { steps: 4 });
    await win.mouse.up();
    await win.waitForTimeout(1200);

    // --- 4. Committed annotation: engine record + overlay rect opacity ---
    const committed = await win.evaluate(() => {
      const d = window.tflexDiagnostics();
      const rects = Array.from(document.querySelectorAll(`.tab-pane[aria-hidden="false"] rect.ann-highlight`))
        .filter((r) => !r.classList.contains('ann-preview'))
        .map((r) => {
          const cs = getComputedStyle(r);
          const rb = r.getBoundingClientRect();
          return {
            fill: r.getAttribute('fill'),
            fillOpacity: cs.getPropertyValue('fill-opacity'),
            onScreen: rb.width > 0 && rb.height > 0,
          };
        });
      return {
        annCount: (d.engineState.annotations || []).length,
        ann: (d.engineState.annotations || [])[0] || null,
        activeTool: d.activeTool,
        rects,
      };
    });
    console.log(`[def173] committed: ${JSON.stringify(committed, null, 1)}`);

    expect(committed.annCount).toBeGreaterThanOrEqual(1);
    expect(committed.ann && committed.ann.kind).toBe('highlight');
    expect(committed.rects.length, 'committed highlight must render overlay rects').toBeGreaterThanOrEqual(1);
    for (const r of committed.rects) {
      expect(r.onScreen, 'committed highlight rect must be on screen').toBe(true);
      const op = parseFloat(r.fillOpacity);
      expect(op).toBeGreaterThan(0);
      expect(op, 'committed highlight fill-opacity must be BELOW 1 (DEF-173: was 1/opaque)').toBeLessThan(1);
      expect(op, 'fill-opacity must be the pinned 0.35').toBeCloseTo(0.35, 2);
    }
    if (preview !== null) {
      const pop = parseFloat(preview.fillOpacity);
      expect(pop, 'drag-preview rect must also be translucent').toBeCloseTo(0.35, 2);
    }

    // --- 5. Disarm: highlight is a sticky tool - the documented disarm is
    // clicking the Highlight button again (Toolbar.tsx: "clicking it again
    // disarms"; DocumentView's Escape only closes search). The highlight
    // must persist and stay translucent.
    await win.click('button[aria-label="Highlight"]');
    await win.waitForTimeout(800);
    const disarmed = await win.evaluate(() => {
      const d = window.tflexDiagnostics();
      const rect = document.querySelector('.tab-pane[aria-hidden="false"] rect.ann-highlight:not(.ann-preview)');
      return {
        annCount: (d.engineState.annotations || []).length,
        activeTool: d.activeTool,
        fillOpacity: rect ? getComputedStyle(rect).getPropertyValue('fill-opacity') : null,
      };
    });
    console.log(`[def173] after disarm: ${JSON.stringify(disarmed)}`);
    expect(disarmed.annCount).toBeGreaterThanOrEqual(1);
    expect(disarmed.activeTool, 're-clicking the Highlight button must disarm the tool')
      .not.toBe('highlight');
    expect(parseFloat(disarmed.fillOpacity)).toBeCloseTo(0.35, 2);
    await shot(win, 'def-173-retest-in-session.png');
    await win.locator(`.tab-pane[aria-hidden="false"] .pdf-page`).first().screenshot({
      path: path.resolve(__dirname, '..', '..', 'screenshots', 'def-173-retest-page1.png'),
    });

    // Page-relative bbox of the committed highlight overlay (css px from the
    // page-1 element's top-left). After reopen the overlay rect is suppressed,
    // so this recorded bbox is what the canvas sampler targets.
    const hlRel = await win.evaluate(() => {
      const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
      const page = pane.querySelector('.pdf-page[data-page="1"]') || pane.querySelector('.pdf-page');
      const rect = pane.querySelector('rect.ann-highlight:not(.ann-preview)');
      const pb = page.getBoundingClientRect();
      const rb = rect.getBoundingClientRect();
      return { x: rb.x - pb.x, y: rb.y - pb.y, w: rb.width, h: rb.height };
    });
    console.log(`[def173] committed highlight page-rel bbox: ${JSON.stringify(hlRel)}`);

    // --- 6. Save As to a temp file ---
    const savePath = path.join(os.tmpdir(), `def173-saved-${Date.now()}.pdf`);
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, savePath);
    await win.click('[aria-label="Save As"]');
    await win.click('[data-save-as-confirm="true"]');
    await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 30000 });
    expect(fs.existsSync(savePath), 'saved PDF must exist on disk').toBe(true);
    console.log(`[def173] saved to ${savePath} (${fs.statSync(savePath).size} bytes)`);

    // --- 7. Re-parse the SAVED bytes with pdf-lib:
    //        native /Highlight + /QuadPoints + /CA 0.35 (DEF-174 fix) ---
    const savedBytes = fs.readFileSync(savePath);
    const savedPdf = await PDFDocument.load(savedBytes, { ignoreEncryption: true, updateMetadata: false });
    const highlights = [];
    for (const [, obj] of savedPdf.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict) {
        const subtype = obj.get(PDFName.of('Subtype'));
        if (subtype && subtype.toString() === '/Highlight') {
          const quads = obj.get(PDFName.of('QuadPoints'));
          const rectEntry = obj.get(PDFName.of('Rect'));
          const ca = obj.get(PDFName.of('CA'));
          highlights.push({
            quadNumbers: quads instanceof PDFArray ? quads.size() : 0,
            quadOk: quads instanceof PDFArray && quads.size() >= 8 && quads.size() % 8 === 0,
            hasRect: rectEntry !== undefined,
            ca: ca && typeof ca.asNumber === 'function' ? ca.asNumber() : undefined,
          });
        }
      }
    }
    console.log(`[def173] saved PDF /Highlight annots: ${JSON.stringify(highlights)}`);
    expect(highlights.length, 'saved PDF must contain a native /Highlight annotation').toBeGreaterThanOrEqual(1);
    expect(highlights[0].quadOk, '/Highlight must carry /QuadPoints (8 numbers per quad)').toBe(true);
    expect(highlights[0].hasRect, '/Highlight must carry /Rect').toBe(true);
    expect(highlights[0].ca, '/Highlight must carry /CA 0.35 (DEF-174 fix: pdf.js fillAlpha)').toBeCloseTo(0.35, 2);

    // --- 8. Reopen the saved file (DEF-174): the highlight re-imports,
    //        the overlay rect is SUPPRESSED (parsed-from-file highlight,
    //        id not in liveAnnTextIds), and the page canvas itself renders
    //        the native /Highlight translucently at /CA 0.35 - a PALE
    //        orange wash, not a stacked double-render and not an opaque
    //        block. ---
    await win.locator('.tab-active .tab-close').click();
    await win.waitForTimeout(1500);
    await openSamplePath(win, electronApp, savePath);
    await win.waitForSelector('.pdf-page', { timeout: 30000 });
    await win.waitForTimeout(2000);
    await scrollToPage(win, 1);

    const reopened = await win.evaluate(() => {
      const d = window.tflexDiagnostics();
      const rects = Array.from(document.querySelectorAll(`.tab-pane[aria-hidden="false"] rect.ann-highlight`))
        .map((r) => ({
          preview: r.classList.contains('ann-preview'),
          fillOpacity: getComputedStyle(r).getPropertyValue('fill-opacity'),
        }));
      return {
        annCount: (d.engineState.annotations || []).length,
        kinds: (d.engineState.annotations || []).map((a) => a.kind),
        rects,
      };
    });
    console.log(`[def174] after reopen: ${JSON.stringify(reopened, null, 1)}`);
    expect(reopened.annCount, 'reopened doc must re-import the highlight annotation').toBeGreaterThanOrEqual(1);
    expect(reopened.kinds).toContain('highlight');
    expect(reopened.rects.length,
      'DEF-174: NO overlay ann-highlight rect may render after reopen (parsed-from-file highlight is painted by the pdf.js canvas via /CA 0.35; a second overlay draw would stack ~0.58)')
      .toBe(0);

    // Canvas renders the pale wash: sample the recorded highlight bbox.
    const canvasSample = await sampleCanvasPageRect(win, hlRel, 1);
    console.log(`[def174] canvas sample after reopen: ${JSON.stringify(canvasSample)}`);
    expect(canvasSample, 'page-1 canvas must be mounted to sample').not.toBeNull();
    const dom = canvasSample.topColors[0];
    expect(dom, 'a dominant canvas color must exist under the highlight bbox').toBeTruthy();
    // DEF-174 fix: pale orange = 0.35 x #e07a2d Multiply over white = ~(244,208,182).
    const [r, g, b] = dom.rgb;
    console.log(`[def174] dominant canvas color under highlight: rgb(${dom.rgb.join(',')}) x${dom.n}`);
    expect(r, 'pale wash R must be near-white (>=230; opaque block was 224)').toBeGreaterThanOrEqual(230);
    expect(g, 'pale wash G ~208 (opaque block was 122)').toBeGreaterThanOrEqual(190);
    expect(g).toBeLessThanOrEqual(225);
    expect(b, 'pale wash B ~182 (opaque block was 45)').toBeGreaterThanOrEqual(165);
    expect(b).toBeLessThanOrEqual(200);
    // Explicitly NOT the full-opacity #e07a2d (224,122,45).
    const distToOpaque = Math.hypot(r - 224, g - 122, b - 45);
    expect(distToOpaque, 'canvas must NOT paint the full-opacity #e07a2d block (DEF-174 original defect)').toBeGreaterThan(80);
    // Text readability: dark glyph pixels must survive under the wash.
    expect(canvasSample.darkGlyphs, 'title glyphs must stay dark/readable under the reopened wash').toBeGreaterThan(0);

    await shot(win, 'def-173-retest-reopen.png');
    await win.locator(`.tab-pane[aria-hidden="false"] .pdf-page[data-page="1"]`).first().screenshot({
      path: path.resolve(__dirname, '..', '..', 'screenshots', 'def-174-retest-reopen-page1.png'),
    });

    // Cleanup temp artifacts
    try { fs.unlinkSync(savePath); } catch (_) { /* best effort */ }
  } finally {
    await hardClose(electronApp);
  }
});
