// DEF-173/DEF-174 reopen verification: the reopened highlight must render
// ONCE, translucently, from the pdf.js page canvas.
//
// History: this probe originally DIAGNOSED the DEF-174 double render -
// the baked /Highlight (no /CA, no /AP) was painted full-opacity by pdf.js
// into the page canvas while the app's SVG overlay drew the imported
// annotation a SECOND time at 0.35 (stacked ~0.58 heavy block). The fix
// (a) bakes /CA 0.35 on the saved /Highlight (pdf.js fillAlpha for its
// Multiply-blend appearance) and (b) suppresses the overlay
// <rect class="ann-highlight"> for highlights parsed from the file
// (id not in liveAnnTextIds).
//
// This spec now ASSERTS the fixed behavior:
//   1. Highlights the page-1 title; samples the canvas pixels under the
//      highlight bbox (CONTROL: canvas must be annotation-free in-session -
//      the wash comes from the SVG overlay, zero orange on canvas).
//   2. Saves to a temp file; the baked /Highlight dict must carry
//      /CA = 0.35 (+ /QuadPoints) so pdf.js renders it translucently.
//   3. Reopens; the overlay rect must be GONE (suppression), and the canvas
//      itself must show the PALE orange wash (~rgb(244,208,182) dominant =
//      0.35 x #e07a2d Multiply over white) with dark title glyphs still
//      readable - NOT the full-opacity #e07a2d (224,122,45) block.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { PDFDocument, PDFDict, PDFName, PDFNumber } = require('pdf-lib');
const { launchDev, openSample, scrollToPage, shot, sampleCanvasPageRect, hardClose } = require('../lib/helpers.cjs');

test('DEF-174: reopened highlight renders ONCE - pale canvas wash (/CA 0.35), no overlay rect', async () => {
  test.setTimeout(240000);
  const { electronApp, window: win } = await launchDev();
  try {
    const appVersion = await electronApp.evaluate(({ app }) => app.getVersion());
    console.log(`[def174diag] app version: ${appVersion}`);

    await openSample(win, electronApp, 'report.pdf');
    await win.waitForTimeout(1200);
    await scrollToPage(win, 1);
    await win.waitForTimeout(400);

    await win.click('button[aria-label="Highlight"]');
    await win.waitForTimeout(350);
    const span = await win.evaluate(() => {
      const pageEl = document.querySelector('.tab-pane[aria-hidden="false"] .pdf-page[data-page="1"]')
        || document.querySelector('.tab-pane[aria-hidden="false"] .pdf-page');
      const spans = Array.from(pageEl.querySelectorAll('.textLayer span'))
        .map((s) => { const r = s.getBoundingClientRect(); return { text: (s.textContent || '').trim(), x: r.x, y: r.y, w: r.width, h: r.height }; })
        .filter((r) => r.w > 30 && r.h > 6 && r.text && r.y > 80 && r.y < window.innerHeight - 120);
      return spans.find((s) => /TFlex|Technical|Report/i.test(s.text)) || spans.find((s) => s.w > 60) || spans[0];
    });
    expect(span).not.toBeNull();
    await win.mouse.move(span.x + 2, span.y + span.h / 2);
    await win.mouse.down();
    await win.mouse.move(span.x + span.w - 2, span.y + span.h / 2 + 2, { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(1200);

    // Page-relative bbox of the committed highlight overlay (css px from the
    // page-1 element's top-left) - after reopen the overlay is suppressed so
    // this recorded bbox is the canvas sampler's target.
    const hlRel = await win.evaluate(() => {
      const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
      const page = pane.querySelector('.pdf-page[data-page="1"]') || pane.querySelector('.pdf-page');
      const rect = pane.querySelector('rect.ann-highlight:not(.ann-preview)');
      const pb = page.getBoundingClientRect();
      const rb = rect.getBoundingClientRect();
      return { x: rb.x - pb.x, y: rb.y - pb.y, w: rb.width, h: rb.height };
    });
    console.log(`[def174diag] committed highlight page-rel bbox: ${JSON.stringify(hlRel)}`);

    // CONTROL: canvas pixels under the highlight bbox, in-session.
    const inSession = await sampleCanvasPageRect(win, hlRel, 1);
    console.log(`[def174diag] canvas sample IN-SESSION: ${JSON.stringify(inSession, null, 1)}`);
    expect(inSession, 'page-1 canvas must be mounted to sample').not.toBeNull();
    {
      const [r, g, b] = inSession.topColors[0].rgb;
      expect(r, 'in-session canvas under the bbox must be white/near-white (wash lives in the SVG overlay)')
        .toBeGreaterThanOrEqual(245);
      expect(g).toBeGreaterThanOrEqual(245);
      expect(b).toBeGreaterThanOrEqual(245);
    }
    await shot(win, 'def-174-diag-in-session.png');

    // Save to temp.
    const savePath = path.join(os.tmpdir(), `def174diag-${Date.now()}.pdf`);
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, savePath);
    await win.click('[data-toolbar-save-as]');
    await win.click('[data-save-as-confirm="true"]');
    await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 30000 });

    // The baked /Highlight dict must carry /CA 0.35 (+ /QuadPoints).
    const savedPdf = await PDFDocument.load(fs.readFileSync(savePath), { ignoreEncryption: true, updateMetadata: false });
    const baked = [];
    for (const [, obj] of savedPdf.context.enumerateIndirectObjects()) {
      if (obj instanceof PDFDict) {
        const subtype = obj.get(PDFName.of('Subtype'));
        if (subtype && subtype.toString() === '/Highlight') {
          const ca = obj.get(PDFName.of('CA'));
          const quads = obj.get(PDFName.of('QuadPoints'));
          baked.push({
            keys: obj.entries().map(([k]) => k.toString()).join(' '),
            ca: ca instanceof PDFNumber ? ca.asNumber() : undefined,
            quadOk: quads && typeof quads.size === 'function' && quads.size() >= 8 && quads.size() % 8 === 0,
          });
        }
      }
    }
    console.log(`[def174diag] baked /Highlight dicts: ${JSON.stringify(baked, null, 1)}`);
    expect(baked.length, 'saved PDF must contain the native /Highlight').toBeGreaterThanOrEqual(1);
    expect(baked[0].ca, 'DEF-174 fix: baked /Highlight must carry /CA 0.35').toBeCloseTo(0.35, 2);
    expect(baked[0].quadOk, 'baked /Highlight must keep /QuadPoints').toBe(true);

    // Reopen.
    await win.locator('.tab-active .tab-close').click();
    await win.waitForTimeout(1500);
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, savePath);
    await win.click('button:has-text("Open PDF")');
    await win.waitForSelector('.pdf-page', { timeout: 30000 });
    await win.waitForTimeout(2000);
    await scrollToPage(win, 1);

    // DEF-174 fix: the overlay rect must be SUPPRESSED after reopen.
    const overlayRects = await win.evaluate(() =>
      document.querySelectorAll('.tab-pane[aria-hidden="false"] rect.ann-highlight').length);
    console.log(`[def174diag] overlay ann-highlight rects after reopen: ${overlayRects}`);
    expect(overlayRects,
      'DEF-174: parsed-from-file highlight must NOT draw an overlay rect (canvas already paints it via /CA)')
      .toBe(0);

    // The canvas itself must now carry the pale translucent wash.
    const reopened = await sampleCanvasPageRect(win, hlRel, 1);
    console.log(`[def174diag] canvas sample AFTER REOPEN: ${JSON.stringify(reopened, null, 1)}`);
    expect(reopened, 'page-1 canvas must be mounted to sample').not.toBeNull();
    const dom = reopened.topColors[0];
    const [r, g, b] = dom.rgb;
    console.log(`[def174diag] dominant canvas color under highlight: rgb(${dom.rgb.join(',')}) x${dom.n}`);
    expect(r, 'pale wash R ~244 (opaque block was 224)').toBeGreaterThanOrEqual(230);
    expect(g, 'pale wash G ~208 (opaque block was 122)').toBeGreaterThanOrEqual(190);
    expect(g).toBeLessThanOrEqual(225);
    expect(b, 'pale wash B ~182 (opaque block was 45)').toBeGreaterThanOrEqual(165);
    expect(b).toBeLessThanOrEqual(200);
    const distToOpaque = Math.hypot(r - 224, g - 122, b - 45);
    expect(distToOpaque, 'canvas must NOT paint the full-opacity #e07a2d block').toBeGreaterThan(80);
    expect(reopened.darkGlyphs, 'title glyphs must stay dark/readable under the reopened wash').toBeGreaterThan(0);

    await shot(win, 'def-174-diag-reopen-pale-wash.png');
    await win.locator('.tab-pane[aria-hidden="false"] .pdf-page[data-page="1"]').first().screenshot({
      path: path.resolve(__dirname, '..', '..', 'screenshots', 'def-174-diag-reopen-pale-wash-page.png'),
    });

    try { fs.unlinkSync(savePath); } catch (_) { /* best effort */ }
  } finally {
    await hardClose(electronApp);
  }
});
