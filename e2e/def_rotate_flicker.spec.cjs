// DEF-rotate-flicker focused verification (operator report 2026-09-21):
// "Rotate page makes the thumbnail pageview refresh and flicker for a bit.
//  This should not visually refresh or flicker to make it feel smooth."
//
// One rotate click, sampled at ~40ms over ~1.7s, recording for page 1:
//   - page slot / .pdf-page rect (re-layout)
//   - page canvas present + width/height + .page-placeholder presence
//   - thumb rect + class (thumb-rot-N) + canvas width/height + alpha-blank
//     + .thumb-placeholder presence
//   - thumb strip scrollTop (re-layout / scroll)
// Launch goes through the canonical launchApp helper only.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { openSamplePath, hardClose } = require('./lib/helpers.cjs');

const FIXTURE = path.resolve(__dirname, '..', 'test-fixtures', 'report.pdf');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');

let electronApp = null;
let win = null;

test.beforeEach(async () => {
  electronApp = await launchApp();
  win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});
test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null;
  win = null;
});
test.setTimeout(180000);

// In-page sampler. Runs entirely in the renderer so the 40ms cadence is not
// gated by CDP round-trips. `window.__rotateClickT` is stamped by a capture
// click listener on the rotate button, so each sample's `t` is ms since the
// real click event (null before the click).
async function sampleTimeline(win, durationMs, intervalMs) {
  return win.evaluate(async ({ duration, interval }) => {
    const q = (sel) => document.querySelector(sel);
    // The page canvas is {alpha:false} (always opaque), so its blank signal is
    // `ink` - the count of non-white pixels in a 64x64 downscale of the
    // canvas (one drawImage + one getImageData per sample). A painted page
    // has ink > 0; a blanked / paper-white frame has ink === 0. Thumbs also
    // report alphaBlank from their (alpha) context.
    const canvasState = (canvas) => {
      if (!canvas) return { present: false };
      const w = canvas.width;
      const h = canvas.height;
      if (w === 0 || h === 0) return { present: true, w, h, alphaBlank: true, ink: 0, whiteBlank: true, reason: 'zero-size' };
      let alphaBlank = null;
      try {
        const sctx = canvas.getContext('2d');
        const d = sctx.getImageData(Math.floor(w / 2), Math.floor(h / 2), 1, 1).data;
        alphaBlank = d[3] === 0;
      } catch {
        alphaBlank = null;
      }
      let ink = null;
      try {
        const off = document.createElement('canvas');
        off.width = 64;
        off.height = 64;
        const octx = off.getContext('2d', { alpha: false });
        octx.fillStyle = '#ffffff';
        octx.fillRect(0, 0, 64, 64);
        octx.drawImage(canvas, 0, 0, 64, 64);
        const img = octx.getImageData(0, 0, 64, 64).data;
        let nonWhite = 0;
        for (let i = 0; i < img.length; i += 4) {
          if (Math.max(img[i], img[i + 1], img[i + 2]) < 245) nonWhite += 1;
        }
        ink = nonWhite;
      } catch {
        ink = null;
      }
      return { present: true, w, h, alphaBlank, ink, whiteBlank: ink === 0 };
    };
    const rectOf = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const samples = [];
    const t0 = performance.now();
    const tick = () => {
      const clickT = window.__rotateClickT ?? null;
      const slot = q('.page-slot[data-page="1"]');
      const pdfPage = q('.page-slot[data-page="1"] .pdf-page');
      const pageCanvas = q('.page-slot[data-page="1"] canvas.pdf-page-canvas');
      const pagePlaceholder = q('.page-slot[data-page="1"] .page-placeholder');
      const thumb = q('.thumb-item[data-page="1"]');
      const thumbCanvas = q('.thumb-item[data-page="1"] canvas.thumb-canvas');
      const thumbPlaceholder = q('.thumb-item[data-page="1"] .thumb-placeholder');
      const scroller = q('.thumb-scroller');
      const inner = q('.thumb-scroller-inner');
      let rotations = [];
      try {
        rotations = (window.tflexDiagnostics().engineState.rotations || []).slice(0, 3);
      } catch {
        rotations = [];
      }
      samples.push({
        t: clickT === null ? null : Math.round(performance.now() - clickT),
        wall: Math.round(performance.now() - t0),
        slot: rectOf(slot),
        pdfPage: rectOf(pdfPage),
        pageCanvas: canvasState(pageCanvas),
        pageTransform: pageCanvas ? pageCanvas.style.transform : null,
        pagePlaceholder: pagePlaceholder !== null,
        thumb: rectOf(thumb),
        thumbClass: thumb ? thumb.className : null,
        thumbCanvas: canvasState(thumbCanvas),
        thumbPlaceholder: thumbPlaceholder !== null,
        stripScrollTop: scroller ? scroller.scrollTop : null,
        innerScrollTop: inner ? inner.scrollTop : null,
        rotations,
      });
    };
    tick();
    const id = setInterval(tick, interval);
    await new Promise((r) => setTimeout(r, duration));
    clearInterval(id);
    tick();
    return samples;
  }, { duration: durationMs, interval: intervalMs });
}

// Compact transition log: one line per state change, plus first/last sample.
function stateSig(s) {
  const pc = s.pageCanvas;
  const tc = s.thumbCanvas;
  const pSig = pc.present ? `${pc.w}x${pc.h}:ink${pc.ink}:${pc.whiteBlank ? 'WHITE' : 'painted'}` : 'MISSING';
  const tSig = tc.present ? `${tc.w}x${tc.h}:${tc.alphaBlank ? 'BLANK' : (tc.ink === 0 ? 'WHITE' : 'ok')}` : 'MISSING';
  return `page[${pSig}] tf=${s.pageTransform || '-'} ph=${s.pagePlaceholder ? 'Y' : 'n'} thumb[${tSig}] ph=${s.thumbPlaceholder ? 'Y' : 'n'} cls=${s.thumbClass} slot=${s.slot ? `${s.slot.w}x${s.slot.h}` : 'null'} thumbRect=${s.thumb ? `${s.thumb.w}x${s.thumb.h}@${s.thumb.y}` : 'null'} strip=${s.stripScrollTop}`;
}
function logTimeline(label, samples) {
  console.log(`[ROT] ---- ${label} timeline (${samples.length} samples, transitions only) ----`);
  let prev = null;
  for (const s of samples) {
    const sig = stateSig(s);
    if (sig !== prev) {
      console.log(`[ROT] ${label} t=${s.t === null ? 'pre' : s.t}ms ${sig}`);
      prev = sig;
    }
  }
  const last = samples[samples.length - 1];
  console.log(`[ROT] ${label} t=${last.t === null ? 'pre' : last.t}ms (last) ${stateSig(last)}`);
}

// Summarise the transient: first/last sample where the page or thumb was
// blank / placeholder / re-laid-out, and the settle time.
function summarise(label, samples) {
  const post = samples.filter((s) => s.t !== null);
  const first = post[0] || null;
  const blankThumb = post.filter((s) => s.thumbCanvas.present && (s.thumbCanvas.alphaBlank === true || s.thumbCanvas.ink === 0));
  const missingThumb = post.filter((s) => !s.thumbCanvas.present);
  const thumbPh = post.filter((s) => s.thumbPlaceholder);
  const blankPage = post.filter((s) => s.pageCanvas.present && s.pageCanvas.whiteBlank === true);
  const missingPage = post.filter((s) => !s.pageCanvas.present);
  const pagePh = post.filter((s) => s.pagePlaceholder);
  const thumbSizes = new Set(post.map((s) => (s.thumbCanvas.present ? `${s.thumbCanvas.w}x${s.thumbCanvas.h}` : 'none')));
  const pageSizes = new Set(post.map((s) => (s.pageCanvas.present ? `${s.pageCanvas.w}x${s.pageCanvas.h}` : 'none')));
  const slotSizes = new Set(post.map((s) => (s.slot ? `${s.slot.w}x${s.slot.h}` : 'none')));
  const thumbRects = new Set(post.map((s) => (s.thumb ? `${s.thumb.w}x${s.thumb.h}@${s.thumb.y}` : 'none')));
  const scrolls = new Set(post.map((s) => s.stripScrollTop));
  const classes = new Set(post.map((s) => s.thumbClass));
  const inks = post.filter((s) => s.pageCanvas.present).map((s) => s.pageCanvas.ink);
  const tinks = post.filter((s) => s.thumbCanvas.present).map((s) => s.thumbCanvas.ink);
  const span = (arr) => (arr.length === 0 ? 'none' : `${arr[0].t}..${arr[arr.length - 1].t}ms`);
  console.log(`[ROT] ==== ${label} summary ====`);
  console.log(`[ROT] ${label} firstPostClickSample=${first ? JSON.stringify({ t: first.t, pageCanvas: first.pageCanvas, thumbCanvas: first.thumbCanvas, thumbClass: first.thumbClass }) : 'none'}`);
  console.log(`[ROT] ${label} pageWhiteBlank=${blankPage.length} span=${span(blankPage)}`);
  console.log(`[ROT] ${label} pageInkRange=${inks.length ? `${Math.min(...inks)}..${Math.max(...inks)}` : 'none'}`);
  console.log(`[ROT] ${label} thumbBlank(alpha|white)=${blankThumb.length} span=${span(blankThumb)}`);
  console.log(`[ROT] ${label} thumbInkRange=${tinks.length ? `${Math.min(...tinks)}..${Math.max(...tinks)}` : 'none'}`);
  console.log(`[ROT] ${label} thumbMissing=${missingThumb.length} span=${span(missingThumb)}`);
  console.log(`[ROT] ${label} thumbPlaceholder=${thumbPh.length} span=${span(thumbPh)}`);
  console.log(`[ROT] ${label} pageMissing=${missingPage.length} span=${span(missingPage)}`);
  console.log(`[ROT] ${label} pagePlaceholder=${pagePh.length} span=${span(pagePh)}`);
  console.log(`[ROT] ${label} thumbCanvasSizes=${JSON.stringify([...thumbSizes])}`);
  console.log(`[ROT] ${label} pageCanvasSizes=${JSON.stringify([...pageSizes])}`);
  console.log(`[ROT] ${label} slotSizes=${JSON.stringify([...slotSizes])}`);
  console.log(`[ROT] ${label} thumbRects=${JSON.stringify([...thumbRects])}`);
  console.log(`[ROT] ${label} stripScrollTops=${JSON.stringify([...scrolls])}`);
  console.log(`[ROT] ${label} thumbClasses=${JSON.stringify([...classes])}`);
  return { blankThumb, thumbPh, blankPage, pagePh, thumbSizes, pageSizes, slotSizes, thumbRects, scrolls, classes };
}

// Expected post-rotate state for rotate N (starting upright): quarter turns
// applied so far, the CSS class the wrap must own, and the page-canvas
// orientation that orientation implies.
function expectedState(rotateIndex) {
  const rotDeg = (rotateIndex * 90) % 360;
  return {
    rotDeg,
    wantClass: rotDeg !== 0 ? `thumb-rot-${rotDeg}` : null,
    wantLandscape: rotDeg === 90 || rotDeg === 270,
  };
}

// First post-click sample at which BOTH the thumb and the page show the
// correctly-oriented, painted frame, and every later sample agrees (stable).
// A null settleMs means the rotate never reached the expected state inside
// the sampling window.
function settleTime(samples, { wantClass, wantLandscape }) {
  const ok = (s) => {
    const tc = s.thumbCanvas;
    const pc = s.pageCanvas;
    if (!tc.present || tc.alphaBlank === true || tc.ink === 0) return false;
    if (!pc.present || pc.whiteBlank === true || pc.ink === 0) return false;
    const cls = s.thumbClass || '';
    if (wantClass ? !cls.includes(wantClass) : cls.includes('thumb-rot-')) return false;
    if (pc.w > pc.h !== wantLandscape) return false;
    return true;
  };
  const post = samples.filter((s) => s.t !== null);
  for (let i = 0; i < post.length; i += 1) {
    if (ok(post[i])) return { settleMs: post[i].t, stable: post.slice(i).every(ok) };
  }
  return { settleMs: null, stable: false };
}

// Settled-state capture: ink bounding box of the thumb bitmap and of the page
// canvas. The thumb bitmap must stay PORTRAIT (aspect < 1) at every rotation -
// the wrap owns the turn (`.thumb-rot-N`); a landscape/clipped bitmap would
// mean pdf.js applied /Rotate as well (the old double-rotation).
async function captureSettle(win) {
  return win.evaluate(() => {
    const bbox = (canvas) => {
      if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
      const ctx = canvas.getContext('2d');
      const w = canvas.width;
      const h = canvas.height;
      let img;
      try {
        img = ctx.getImageData(0, 0, w, h).data;
      } catch {
        return null;
      }
      let x0 = w;
      let y0 = h;
      let x1 = -1;
      let y1 = -1;
      let ink = 0;
      for (let y = 0; y < h; y += 2) {
        for (let x = 0; x < w; x += 2) {
          const i = (y * w + x) * 4;
          if (Math.max(img[i], img[i + 1], img[i + 2]) < 245) {
            ink += 1;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) return { w, h, ink: 0, bbox: null, aspect: null };
      const bw = x1 - x0 + 1;
      const bh = y1 - y0 + 1;
      return { w, h, ink, bbox: [x0, y0, bw, bh], aspect: Number((bw / bh).toFixed(3)) };
    };
    const item = document.querySelector('.thumb-item[data-page="1"]');
    const tc = document.querySelector('.thumb-item[data-page="1"] canvas.thumb-canvas');
    const pc = document.querySelector('.page-slot[data-page="1"] canvas.pdf-page-canvas');
    let rotation = null;
    try {
      rotation = window.tflexDiagnostics().engineState.rotations[0];
    } catch {
      rotation = null;
    }
    return {
      rotation,
      thumbClass: item ? item.className : null,
      thumb: bbox(tc),
      page: bbox(pc),
      pageTransform: pc ? pc.style.transform : null,
    };
  });
}

test('rotate page: page view / thumbnail flicker timeline', async () => {
  await openSamplePath(win, electronApp, FIXTURE);
  await win.waitForSelector('.page-slot[data-page="1"] canvas.pdf-page-canvas', { timeout: 30000 });
  await win.waitForSelector('.thumb-item[data-page="1"] canvas.thumb-canvas', { timeout: 30000 });
  await win.waitForTimeout(1800);

  // Confirm the rotate control exists in the RUNNING app (do not assume).
  const rotate = win.locator('[data-toolbar-rotate-cw]');
  const rotateCount = await rotate.count();
  const rotateVisible = rotateCount > 0 ? await rotate.first().isVisible() : false;
  console.log(`[ROT] rotate control [data-toolbar-rotate-cw] count=${rotateCount} visible=${rotateVisible}`);
  if (rotateCount === 0) throw new Error('rotate control [data-toolbar-rotate-cw] not found in running app');

  // Baseline state + screenshot.
  const baseline = await win.evaluate(() => {
    const slot = document.querySelector('.page-slot[data-page="1"]');
    const thumb = document.querySelector('.thumb-item[data-page="1"]');
    const tc = document.querySelector('.thumb-item[data-page="1"] canvas.thumb-canvas');
    const pc = document.querySelector('.page-slot[data-page="1"] canvas.pdf-page-canvas');
    return {
      slot: slot ? slot.getBoundingClientRect().toJSON() : null,
      thumb: thumb ? thumb.getBoundingClientRect().toJSON() : null,
      thumbClass: thumb ? thumb.className : null,
      thumbCanvas: tc ? { w: tc.width, h: tc.height } : null,
      pageCanvas: pc ? { w: pc.width, h: pc.height } : null,
      rotations: window.tflexDiagnostics().engineState.rotations.slice(0, 3),
    };
  });
  console.log(`[ROT] baseline ${JSON.stringify(baseline)}`);

  // One-time dense pixel probe so the ink metric itself is validated against
  // the baseline (a painted page must report ink > 0).
  const probe = await win.evaluate(() => {
    const pc = document.querySelector('.page-slot[data-page="1"] canvas.pdf-page-canvas');
    if (!pc) return { present: false };
    const ctx = pc.getContext('2d');
    const N = 60;
    let min = 255;
    let max = 0;
    let ink = 0;
    let total = 0;
    for (let i = 1; i <= N; i += 1) {
      for (let j = 1; j <= N; j += 1) {
        const x = Math.floor((pc.width * i) / (N + 1));
        const y = Math.floor((pc.height * j) / (N + 1));
        const d = ctx.getImageData(x, y, 1, 1).data;
        const v = Math.max(d[0], d[1], d[2]);
        min = Math.min(min, v);
        max = Math.max(max, v);
        if (v < 200) ink += 1;
        total += 1;
      }
    }
    return { present: true, w: pc.width, h: pc.height, min, max, ink, total, samples: N * N };
  });
  console.log(`[ROT] baseline pagePixelProbe ${JSON.stringify(probe)}`);
  await win.screenshot({ path: path.join(SHOTS, 'def-rotate-flicker-fixed-1.png') });

  // Stamp the real click time on the rotate button.
  await win.evaluate(() => {
    window.__rotateClickT = null;
    const btn = document.querySelector('[data-toolbar-rotate-cw]');
    btn.addEventListener('click', () => { window.__rotateClickT = performance.now(); }, { capture: true });
  });

  // ---- Five consecutive rotates, each sampled at 16 ms for 1.7 s ----
  // (0->90, 90->180, 180->270, 270->0, 0->90) - the same methodology as the
  // original DEF-274 measurement, plus a late ~2.9 s read to match the
  // original "still white at +3.0 s" observation.
  const results = [];
  const doRotateSample = async (label, rotateIndex, opts = {}) => {
    await win.evaluate(() => { window.__rotateClickT = null; });
    const sampler = sampleTimeline(win, 1700, 16);
    await win.waitForTimeout(60);
    await rotate.first().click();
    if (opts.midShot) {
      await win.waitForTimeout(opts.midShot.delayMs);
      await win.screenshot({ path: path.join(SHOTS, opts.midShot.file) });
    }
    const timeline = await sampler;
    logTimeline(label, timeline);
    const sum = summarise(label, timeline);
    const exp = expectedState(rotateIndex);
    const st = settleTime(timeline, exp);
    const cap = await captureSettle(win);
    const post = timeline.filter((s) => s.t !== null);
    const blank = post.filter((s) => !s.thumbCanvas.present || s.thumbCanvas.alphaBlank === true || s.thumbCanvas.ink === 0);
    const inkSeries = post.map((s) => `${s.t}:${s.thumbCanvas.present ? s.thumbCanvas.ink : 'miss'}`).join(' ');
    console.log(`[ROT] ${label} expected rot=${exp.rotDeg} wantClass=${exp.wantClass} wantLandscape=${exp.wantLandscape}`);
    console.log(`[ROT] ${label} settleMs=${st.settleMs} stable=${st.stable} capture=${JSON.stringify(cap)}`);
    console.log(`[ROT] ${label} thumbInkSeries ${inkSeries}`);
    console.log(`[ROT] ${label} blankThumbSamples=${blank.length}/${post.length}` +
      (blank.length ? ` first=${blank[0].t}ms last=${blank[blank.length - 1].t}ms` : ''));
    await win.waitForTimeout(1200);
    if (opts.settleShot) await win.screenshot({ path: path.join(SHOTS, opts.settleShot) });
    const late = await captureSettle(win);
    console.log(`[ROT] ${label} late(+~2.9s) thumbInk=${late.thumb && late.thumb.ink} thumbAspect=${late.thumb && late.thumb.aspect} class=${late.thumbClass}`);
    return { label, exp, sum, st, cap, late, timeline, blank };
  };

  results.push(await doRotateSample('R1', 1, { midShot: { delayMs: 100, file: 'def-rotate-flicker-fixed-2.png' } }));
  results.push(await doRotateSample('R2', 2, { settleShot: 'def-rotate-flicker-fixed-3.png' }));
  results.push(await doRotateSample('R3', 3));
  results.push(await doRotateSample('R4', 4));
  results.push(await doRotateSample('R5', 5, { settleShot: 'def-rotate-flicker-fixed-4.png' }));

  // ---- Assertions ----
  const allBlank = results.flatMap((r) => r.blank.map((b) => ({ label: r.label, t: b.t })));
  const settled = results.every((r) => r.st.settleMs !== null && r.st.stable);
  const thumbAspects = results.map((r) => (r.cap.thumb ? r.cap.thumb.aspect : null));
  const spreadVals = thumbAspects.filter((x) => typeof x === 'number');
  const thumbAspectSpread = spreadVals.length === results.length
    ? Number((Math.max(...spreadVals) / Math.min(...spreadVals)).toFixed(3))
    : null;
  const pageAspect0 = results[3].cap.page ? results[3].cap.page.aspect : null;
  const thumbMatchesUnrotatedPage = results.every((r) => {
    const ta = r.cap.thumb ? r.cap.thumb.aspect : null;
    return typeof ta === 'number' && typeof pageAspect0 === 'number' && pageAspect0 !== 0 && Math.abs(ta - pageAspect0) / pageAspect0 < 0.2;
  });
  // Normalised ink bbox of the UN-ROTATED page (rotation 0, R4). The thumb
  // bitmap must match this at EVERY rotation if it is neither clipped nor
  // double-rotated (pdf.js /Rotate applied on top of the wrap transform).
  const normBox = (cap) => {
    const c = cap && cap.thumb;
    if (!c || !c.bbox || c.w === 0 || c.h === 0) return null;
    return [c.bbox[0] / c.w, c.bbox[1] / c.h, c.bbox[2] / c.w, c.bbox[3] / c.h].map((v) => Number(v.toFixed(3)));
  };
  const refPage = results[3].cap.page;
  const ref = refPage && refPage.bbox && refPage.w > 0
    ? [refPage.bbox[0] / refPage.w, refPage.bbox[1] / refPage.h, refPage.bbox[2] / refPage.w, refPage.bbox[3] / refPage.h].map((v) => Number(v.toFixed(3)))
    : null;
  const thumbBoxes = results.map((r) => normBox(r.cap));
  const thumbBoxMatches = thumbBoxes.every((b) => b && ref && b.every((v, i) => Math.abs(v - ref[i]) < 0.05));
  const classOk = results.every((r) => {
    const cls = r.cap.thumbClass || '';
    return r.exp.wantClass ? cls.includes(r.exp.wantClass) : !cls.includes('thumb-rot-');
  });
  const pageOrientOk = results.every((r) => r.cap.page && (r.cap.page.w > r.cap.page.h) === r.exp.wantLandscape);
  const pageInkOk = results.every((r) => r.cap.page && r.cap.page.ink > 0);
  const turnObserved = results.map((r) => r.timeline.some((s) => s.t !== null && s.pageTransform && s.pageTransform.includes('rotate')));
  const anyPageBlank = results.some((r) => r.sum.blankPage.length > 0);
  const anyThumbPh = results.some((r) => r.sum.thumbPh.length > 0);
  const anyPagePh = results.some((r) => r.sum.pagePh.length > 0);

  console.log(`[ROT] ASSERTIONS blankThumbSamples=${allBlank.length} ${JSON.stringify(allBlank)}`);
  console.log(`[ROT] ASSERTIONS settledAll=${settled} settleMs=[${results.map((r) => r.st.settleMs).join(',')}] stable=[${results.map((r) => r.st.stable).join(',')}]`);
  console.log(`[ROT] ASSERTIONS thumbAspects=[${thumbAspects.join(',')}] spread=${thumbAspectSpread} matchesUnrotatedPage=${thumbMatchesUnrotatedPage} pageAspect0=${pageAspect0}`);
  console.log(`[ROT] ASSERTIONS thumbNormBoxes=[${thumbBoxes.map((b) => JSON.stringify(b)).join(',')}] refUnrotatedPage=${JSON.stringify(ref)} boxMatches=${thumbBoxMatches}`);
  console.log(`[ROT] ASSERTIONS thumbClassOk=${classOk} classes=[${results.map((r) => r.cap.thumbClass).join(' | ')}]`);
  console.log(`[ROT] ASSERTIONS pageOrientOk=${pageOrientOk} pageDims=[${results.map((r) => (r.cap.page ? `${r.cap.page.w}x${r.cap.page.h}` : 'none')).join(',')}]`);
  console.log(`[ROT] ASSERTIONS pageInkOk=${pageInkOk} pageInk=[${results.map((r) => (r.cap.page ? r.cap.page.ink : 'none')).join(',')}]`);
  console.log(`[ROT] ASSERTIONS turnTransformObservedPerRotate=[${turnObserved.join(',')}]`);
  console.log(`[ROT] ASSERTIONS pageWhiteBlank=${anyPageBlank} thumbPlaceholder=${anyThumbPh} pagePlaceholder=${anyPagePh}`);

  expect(allBlank, `thumbnail blank/white samples: ${JSON.stringify(allBlank)}`).toHaveLength(0);
  expect(settled, `rotate(s) never settled: ${results.map((r) => `${r.label}:${r.st.settleMs}`).join(',')}`).toBe(true);
  expect(thumbAspectSpread !== null && thumbAspectSpread < 1.3, `thumb bitmap aspect varies across rotates: ${thumbAspects.join(',')}`).toBe(true);
  expect(thumbMatchesUnrotatedPage, `thumb bitmap orientation does not match the un-rotated page (${pageAspect0}): ${thumbAspects.join(',')}`).toBe(true);
  expect(thumbBoxMatches, `thumb bitmap ink box differs from the un-rotated page (double-rotation/clipping): thumb=${JSON.stringify(thumbBoxes)} page=${JSON.stringify(ref)}`).toBe(true);
  expect(classOk, `thumb wrap class wrong: ${results.map((r) => r.cap.thumbClass).join(' | ')}`).toBe(true);
  expect(pageOrientOk, `page orientation wrong: ${results.map((r) => (r.cap.page ? `${r.cap.page.w}x${r.cap.page.h}` : 'none')).join(',')}`).toBe(true);
  expect(pageInkOk, 'page canvas blank after settle').toBe(true);
  expect(anyPageBlank, 'page canvas observed white-blank').toBe(false);
  expect(anyThumbPh || anyPagePh, 'placeholder observed').toBe(false);
});