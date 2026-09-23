// Phase 35 focused diagnosis (qa) — operator report (2026-09-22):
//   "Page Zoom in/out animation is not smooth."
//
// Diagnostic harness (not a pass/fail guard): it samples, every animation frame
// across a real zoom-in and zoom-out step, the page-1 SLOT layout box
// (.page-slot offsetTop/offsetHeight — the flow box), the .pdf-page wrapper's
// visual transform scale, the canvas backing store + CSS size, the scroller
// scrollTop, the mounted/slot counts and the rAF delta. It also timestamps the
// text-layer rebuild (the raster re-render landing) and every animationstart.
// The raw timeline is printed to the run log; the assertions only prove the
// reproduction (the zoom changed and the FLIP animation ran).
//
// Launches only through the canonical launchApp helper (e2e/lib/launch.cjs).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { openFile, tmpCopy, REPORT } = require('./lib/p33_common.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p35-zoom-diag');
  app = null;
  win = null;
});
test.setTimeout(180000);

// Installed in the page. Self-contained (Playwright serialises it).
function installSampler() {
  const zd = { samples: [], marks: [], textMuts: [], animStarts: [] };
  window.__zd = zd;
  const scroller = document.querySelector('.document-scroller');
  const q = (sel) => document.querySelector(sel);
  const scaleOf = (el) => {
    if (!el) return null;
    const t = getComputedStyle(el).transform;
    if (!t || t === 'none') return 1;
    try { return new DOMMatrixReadOnly(t).a; } catch (_) { return null; }
  };
  let last = performance.now();
  const sample = () => {
    const now = performance.now();
    const p = q('.pdf-page[data-page="1"]');
    const s = q('.page-slot[data-page="1"]');
    const c = q('.pdf-page[data-page="1"] .pdf-page-canvas');
    const pr = p ? p.getBoundingClientRect() : null;
    const cr = c ? c.getBoundingClientRect() : null;
    zd.samples.push({
      t: now,
      dt: now - last,
      slotTop: s ? s.offsetTop : null,
      slotH: s ? s.offsetHeight : null,
      slotRectTop: s ? Math.round(s.getBoundingClientRect().top) : null,
      slotRectLeft: s ? Math.round(s.getBoundingClientRect().left) : null,
      slotRectH: s ? Math.round(s.getBoundingClientRect().height) : null,
      slotRectW: s ? Math.round(s.getBoundingClientRect().width) : null,
      pageTop: p ? p.offsetTop : null,
      pageH: p ? p.offsetHeight : null,
      pageRectTop: pr ? Math.round(pr.top) : null,
      pageRectLeft: pr ? Math.round(pr.left) : null,
      pageRectH: pr ? Math.round(pr.height) : null,
      pageRectW: pr ? Math.round(pr.width) : null,
      scale: scaleOf(p),
      flip: p ? p.classList.contains('pdf-page-zoom-flip') : null,
      from: p ? p.style.getPropertyValue('--tf-zoom-flip-from') : null,
      canvasW: c ? c.width : null,
      canvasH: c ? c.height : null,
      canvasCssW: c ? c.style.width : null,
      canvasRectH: cr ? Math.round(cr.height) : null,
      canvasRectW: cr ? Math.round(cr.width) : null,
      scrollTop: scroller ? Math.round(scroller.scrollTop) : null,
      mounted: document.querySelectorAll('.pdf-page[data-page]').length,
      slots: document.querySelectorAll('.page-slot[data-page]').length,
      anims: document.getAnimations().length,
    });
    last = now;
    zd.raf = requestAnimationFrame(sample);
  };
  zd.raf = requestAnimationFrame(sample);
  const t = q('.pdf-page[data-page="1"] .textLayer');
  if (t) {
    zd.mo = new MutationObserver(() => zd.textMuts.push(performance.now()));
    zd.mo.observe(t, { childList: true });
  }
  document.addEventListener('animationstart', (e) => {
    zd.animStarts.push({
      t: performance.now(),
      name: e.animationName,
      page: e.target && e.target.getAttribute ? e.target.getAttribute('data-page') : null,
    });
  }, true);
}

function fmt(n) { return n === null || n === undefined ? 'null' : n; }

test('DEF-302 zoom FLIP frame timeline', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'p35-zoomdiag.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);

  const readout0 = (await win.locator('.zoom-percent').first().innerText()).trim();
  await win.evaluate(installSampler);
  await win.waitForTimeout(400);

  const mark = (label) => win.evaluate((l) => {
    window.__zd.marks.push({ label: l, t: performance.now() });
  }, label);

  await mark('zoomIn');
  await win.locator('button[aria-label="Zoom in"]').first().click();
  await win.waitForTimeout(900);
  const readout1 = (await win.locator('.zoom-percent').first().innerText()).trim();
  await mark('zoomOut');
  await win.locator('button[aria-label="Zoom out"]').first().click();
  await win.waitForTimeout(900);
  const readout2 = (await win.locator('.zoom-percent').first().innerText()).trim();

  const data = await win.evaluate(() => {
    cancelAnimationFrame(window.__zd.raf);
    if (window.__zd.mo) window.__zd.mo.disconnect();
    return {
      samples: window.__zd.samples,
      marks: window.__zd.marks,
      textMuts: window.__zd.textMuts,
      animStarts: window.__zd.animStarts,
    };
  });

  const { samples, marks, textMuts, animStarts } = data;
  const markIn = marks.find((m) => m.label === 'zoomIn');
  const markOut = marks.find((m) => m.label === 'zoomOut');
  const baseline = samples.filter((s) => s.t < markIn.t).slice(-1)[0];
  const inSamples = samples.filter((s) => s.t >= markIn.t && s.t < markOut.t);
  const outSamples = samples.filter((s) => s.t >= markOut.t);

  const summarize = (label, mark, arr) => {
    const first = arr[0];
    const flipSamples = arr.filter((s) => s.flip === true);
    const animWindow = flipSamples.length > 0
      ? { start: flipSamples[0].t - mark.t, end: flipSamples[flipSamples.length - 1].t - mark.t, n: flipSamples.length }
      : null;
    const dts = arr.map((s) => s.dt);
    const long = dts.filter((d) => d > 32).length;
    const veryLong = dts.filter((d) => d > 50).length;
    const huge = dts.filter((d) => d > 100).length;
    const scrolls = arr.map((s) => s.scrollTop);
    const muts = textMuts.filter((t) => t >= mark.t && t < mark.t + 1200).map((t) => Math.round(t - mark.t));
    const starts = animStarts.filter((a) => a.t >= mark.t && a.t < mark.t + 1200).map((a) => ({ dt: Math.round(a.t - mark.t), name: a.name, page: a.page }));
    // DEF-302 — the page's VISUAL rect (getBoundingClientRect, transform
    // applied) vs the slot's LAYOUT rect, per FLIP frame. The old centre-origin
    // scale started the content ~198px below the box top on a 25% step; the
    // top-left FLIP must keep the top-left deviation within a pixel or two.
    const devs = flipSamples.map((s) => ({
      top: s.pageRectTop - s.slotRectTop,
      left: s.pageRectLeft - s.slotRectLeft,
      h: s.pageRectH - s.slotRectH,
      w: s.pageRectW - s.slotRectW,
    }));
    const maxAbs = (nums) => (nums.length ? Math.max(...nums.map((n) => Math.abs(n))) : null);
    const dev = {
      n: devs.length,
      maxAbsTop: maxAbs(devs.map((d) => d.top)),
      maxAbsLeft: maxAbs(devs.map((d) => d.left)),
      firstTop: devs.length ? devs[0].top : null,
      firstLeft: devs.length ? devs[0].left : null,
      firstH: devs.length ? devs[0].h : null,
      lastTop: devs.length ? devs[devs.length - 1].top : null,
      lastH: devs.length ? devs[devs.length - 1].h : null,
    };
    return {
      label,
      dev,
      firstAfterMark: first ? {
        dt: Math.round(first.dt), slotH: first.slotH, pageH: first.pageH,
        scale: first.scale === null ? null : Number(first.scale.toFixed(4)),
        canvasW: first.canvasW, canvasCssW: first.canvasCssW,
        canvasRectW: first.canvasRectW, pageRectH: first.pageRectH,
        scrollTop: first.scrollTop, flip: first.flip, from: first.from,
      } : null,
      animWindow,
      scaleStart: flipSamples.length ? Number(flipSamples[0].scale.toFixed(4)) : null,
      scaleEnd: flipSamples.length ? Number(flipSamples[flipSamples.length - 1].scale.toFixed(4)) : null,
      frames: arr.length,
      maxDt: Math.round(Math.max(...dts)),
      longFrames: long, veryLongFrames: veryLong, hugeFrames: huge,
      scrollTopMin: Math.min(...scrolls), scrollTopMax: Math.max(...scrolls),
      mountedMin: Math.min(...arr.map((s) => s.mounted)), mountedMax: Math.max(...arr.map((s) => s.mounted)),
      slotsMin: Math.min(...arr.map((s) => s.slots)), slotsMax: Math.max(...arr.map((s) => s.slots)),
      textMutsRel: muts,
      animStartsRel: starts,
    };
  };

  const inSum = summarize('zoomIn', markIn, inSamples);
  const outSum = summarize('zoomOut', markOut, outSamples);

  console.log(`[ZD] readouts: before=${readout0} afterZoomIn=${readout1} afterZoomOut=${readout2}`);
  console.log(`[ZD] baseline=${JSON.stringify({
    slotH: baseline.slotH, pageH: baseline.pageH, scale: baseline.scale,
    canvasW: baseline.canvasW, canvasCssW: baseline.canvasCssW,
    canvasRectW: baseline.canvasRectW, pageRectH: baseline.pageRectH, scrollTop: baseline.scrollTop,
  })}`);
  console.log(`[ZD] zoomIn=${JSON.stringify(inSum)}`);
  console.log(`[ZD] zoomOut=${JSON.stringify(outSum)}`);

  // Compact frame timeline: first 22 frames after each mark.
  const timeline = (mark, arr) => arr.slice(0, 22).map((s) => ({
    dt: Math.round(s.dt), slotH: s.slotH, pageH: s.pageH,
    scale: s.scale === null ? null : Number(s.scale.toFixed(3)),
    cW: s.canvasW, cCssW: s.canvasCssW, cRectW: s.canvasRectW,
    flip: s.flip ? 1 : 0, scroll: s.scrollTop,
  }));
  console.log(`[ZD] timeline zoomIn=${JSON.stringify(timeline(markIn, inSamples))}`);
  console.log(`[ZD] timeline zoomOut=${JSON.stringify(timeline(markOut, outSamples))}`);

  // Reproduction assertions only.
  expect(parseFloat(readout1)).toBeGreaterThan(parseFloat(readout0));
  expect(parseFloat(readout2)).toBeLessThan(parseFloat(readout1));
  expect(inSum.animWindow, 'zoom-in must play the FLIP animation').not.toBeNull();
  expect(outSum.animWindow, 'zoom-out must play the FLIP animation').not.toBeNull();
  expect(animStarts.some((a) => a.name === 'tf-page-zoom-flip')).toBe(true);
  // DEF-302 regression guard: the visual top tracks the slot top throughout.
  expect(inSum.dev.maxAbsTop, 'zoom-in visual top must track the slot top').toBeLessThanOrEqual(2);
  expect(outSum.dev.maxAbsTop, 'zoom-out visual top must track the slot top').toBeLessThanOrEqual(2);
});

// DEF-302 — the 25% step the defect quantified (200% -> 250%). The old
// centre-origin scale started the page content ~198px below the box top; the
// top-left FLIP must keep the visual top-left on the slot's top-left.
test('DEF-302 25% step: visual rect tracks the slot top-left', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'p35-zoom25.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Fit-width opens near 198%; one step lands on 200%, the next is the 25% step.
  await win.locator('button[aria-label="Zoom in"]').first().click();
  await win.waitForTimeout(900);
  const at200 = (await win.locator('.zoom-percent').first().innerText()).trim();

  await win.evaluate(installSampler);
  await win.waitForTimeout(400);
  await win.evaluate(() => { window.__zd.marks.push({ label: 'zoom25', t: performance.now() }); });
  await win.locator('button[aria-label="Zoom in"]').first().click();
  await win.waitForTimeout(900);
  const at250 = (await win.locator('.zoom-percent').first().innerText()).trim();

  const data = await win.evaluate(() => {
    cancelAnimationFrame(window.__zd.raf);
    if (window.__zd.mo) window.__zd.mo.disconnect();
    return { samples: window.__zd.samples, marks: window.__zd.marks, animStarts: window.__zd.animStarts };
  });
  const mark = data.marks.find((m) => m.label === 'zoom25');
  const arr = data.samples.filter((s) => s.t >= mark.t);
  const flipSamples = arr.filter((s) => s.flip === true);
  const devs = flipSamples.map((s) => ({
    top: s.pageRectTop - s.slotRectTop,
    left: s.pageRectLeft - s.slotRectLeft,
    h: s.pageRectH - s.slotRectH,
  }));
  const maxAbs = (nums) => (nums.length ? Math.max(...nums.map((n) => Math.abs(n))) : null);
  const maxAbsTop = maxAbs(devs.map((d) => d.top));
  const maxAbsLeft = maxAbs(devs.map((d) => d.left));
  console.log(`[ZD25] readouts: at200=${at200} at250=${at250}`);
  console.log(`[ZD25] flipFrames=${flipSamples.length} first=${JSON.stringify(devs[0])} last=${JSON.stringify(devs[devs.length - 1])} maxAbsTop=${maxAbsTop} maxAbsLeft=${maxAbsLeft}`);
  console.log(`[ZD25] timeline=${JSON.stringify(flipSamples.slice(0, 20).map((s) => ({
    dt: Math.round(s.dt), slotTop: s.slotRectTop, pageTop: s.pageRectTop,
    slotLeft: s.slotRectLeft, pageLeft: s.pageRectLeft,
    slotW: s.slotRectW, pageW: s.pageRectW,
    devTop: s.pageRectTop - s.slotRectTop, devLeft: s.pageRectLeft - s.slotRectLeft,
    devH: s.pageRectH - s.slotRectH, scale: s.scale === null ? null : Number(s.scale.toFixed(3)),
    flip: s.flip ? 1 : 0,
  })))}`);

  expect(parseFloat(at250)).toBeGreaterThan(parseFloat(at200));
  expect(flipSamples.length, 'the 25% step must play the FLIP').toBeGreaterThan(0);
  // Regression guard: the page is TOP-aligned in the slot, so the visual TOP
  // must track the slot top throughout (the old centre-origin scale started
  // ~198px low on this exact step). The page is horizontally CENTRED and grows
  // symmetrically, so the left edge legitimately starts half the width delta
  // away (153px here) — identical in the old and new implementations, not the
  // defect — and must land on the new box.
  expect(maxAbsTop, 'visual top must track the slot top').toBeLessThanOrEqual(2);
  expect(devs[devs.length - 1].top, 'the FLIP must land on the new box top').toBe(0);
  expect(devs[devs.length - 1].left, 'the FLIP must land on the new box left').toBe(0);
});

// DEF-302 — the scroll anchor on a SCROLLED document (the original diagnosis
// only tested page 1 at scrollTop 0). Zoom in and out mid-document and check
// the previously-visible page's offset below the scroller top is preserved.
test('DEF-302 scrolled document: scroll anchor preserved across zoom', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'p35-zoomanchor.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Scroll into the middle of the document so the top edge cuts a page.
  await win.evaluate(() => {
    const scroller = document.querySelector('.document-scroller');
    scroller.scrollTop = Math.round(scroller.scrollHeight * 0.45);
  });
  await win.waitForTimeout(600);

  const readAnchor = () => win.evaluate(() => {
    const scroller = document.querySelector('.document-scroller');
    const st = scroller.getBoundingClientRect().top;
    const pages = [...document.querySelectorAll('.page-slot[data-page]')].map((s) => {
      const el = s.querySelector('.pdf-page');
      return el ? { page: Number(s.getAttribute('data-page')), top: el.getBoundingClientRect().top } : null;
    }).filter(Boolean);
    let best = null;
    let bestTop = Number.NEGATIVE_INFINITY;
    for (const p of pages) {
      if (p.top <= st && p.top > bestTop) { best = p; bestTop = p.top; }
    }
    return {
      anchorPage: best ? best.page : null,
      offset: best ? Math.round(best.top - st) : null,
      scrollTop: Math.round(scroller.scrollTop),
      scrollHeight: Math.round(scroller.scrollHeight),
    };
  });

  const before = await readAnchor();
  await win.locator('button[aria-label="Zoom in"]').first().click();
  await win.waitForTimeout(900);
  const afterIn = await readAnchor();
  await win.locator('button[aria-label="Zoom out"]').first().click();
  await win.waitForTimeout(900);
  const afterOut = await readAnchor();

  // The SAME page must stay the anchor and keep its offset below the top edge.
  const offsetOf = (snap, page) => win.evaluate(({ p }) => {
    const scroller = document.querySelector('.document-scroller');
    const st = scroller.getBoundingClientRect().top;
    const el = document.querySelector(`.page-slot[data-page="${p}"] .pdf-page`);
    return el ? Math.round(el.getBoundingClientRect().top - st) : null;
  }, { p: page });

  const anchorPage = before.anchorPage;
  const offBefore = await offsetOf(before, anchorPage);
  const offAfterIn = await offsetOf(afterIn, anchorPage);
  const offAfterOut = await offsetOf(afterOut, anchorPage);

  console.log(`[ZD-ANCHOR] before=${JSON.stringify(before)} afterIn=${JSON.stringify(afterIn)} afterOut=${JSON.stringify(afterOut)}`);
  console.log(`[ZD-ANCHOR] anchorPage=${anchorPage} offsetBefore=${offBefore} offsetAfterIn=${offAfterIn} offsetAfterOut=${offAfterOut}`);

  expect(anchorPage, 'a page must sit at the scroller top edge').not.toBeNull();
  expect(Math.abs(offAfterIn - offBefore), 'zoom-in must preserve the anchor offset').toBeLessThanOrEqual(2);
  expect(Math.abs(offAfterOut - offBefore), 'zoom-out must preserve the anchor offset').toBeLessThanOrEqual(2);
  // The anchor correction must actually move scrollTop on a scrolled document.
  expect(afterIn.scrollTop).not.toBe(before.scrollTop);
});

// Pause the one-shot FLIP at a chosen currentTime so a screenshot captures a
// deterministic mid-animation frame (the animation is resumed/finished after).
async function zoomAndPause(dir, atMs) {
  return win.evaluate(({ dir: d, atMs: ms }) => new Promise((resolve) => {
    const btn = document.querySelector(`button[aria-label="${d === 'in' ? 'Zoom in' : 'Zoom out'}"]`);
    if (!btn) return resolve({ ok: false, reason: 'no-btn' });
    btn.click();
    let tries = 0;
    const attempt = () => {
      const el = document.querySelector('.pdf-page[data-page="1"]');
      const anims = el ? el.getAnimations() : [];
      const a = anims.find((x) => x.animationName === 'tf-page-zoom-flip');
      if (a) {
        a.pause();
        a.currentTime = ms;
        const cs = getComputedStyle(el);
        const slot = document.querySelector('.page-slot[data-page="1"]');
        const canvas = el.querySelector('.pdf-page-canvas');
        return resolve({
          ok: true,
          name: a.animationName,
          duration: a.effect.getTiming().duration,
          easing: a.effect.getTiming().easing,
          from: el.style.getPropertyValue('--tf-zoom-flip-from'),
          scale: new DOMMatrixReadOnly(cs.transform).a,
          slotH: slot ? slot.offsetHeight : null,
          pageH: el.offsetHeight,
          canvasCssW: canvas ? canvas.style.width : null,
          canvasRectW: canvas ? Math.round(canvas.getBoundingClientRect().width) : null,
        });
      }
      if (++tries > 8) return resolve({ ok: false, reason: 'no-anim', anims: anims.map((x) => x.animationName) });
      requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  }), { dir, atMs });
}

async function finishFlip() {
  await win.evaluate(() => {
    const el = document.querySelector('.pdf-page[data-page="1"]');
    const a = el && el.getAnimations().find((x) => x.animationName === 'tf-page-zoom-flip');
    if (a) a.finish();
  });
}

test('DEF-302 zoom mid-animation screenshots', async () => {
  await openFile(app, win, tmpCopy(REPORT, 'p35-zoomshot.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Zoom out to 50% so several pages are visible and the animating page can be
  // judged against its neighbours (at fit-width only one page fits the viewport).
  for (let i = 0; i < 10; i += 1) {
    await win.locator('button[aria-label="Zoom out"]').first().click();
    await win.waitForTimeout(120);
  }
  await win.waitForTimeout(800);
  const at50 = (await win.locator('.zoom-percent').first().innerText()).trim();

  const shots = [];
  const capture = async (dir, atMs, name) => {
    const info = await zoomAndPause(dir, atMs);
    console.log(`[ZD-SHOT] ${name} pause=${JSON.stringify(info)}`);
    const p = path.join(SHOTS, name);
    await win.screenshot({ path: p });
    shots.push(p);
    await finishFlip();
    await win.waitForTimeout(600);
    return info;
  };

  const a = await capture('in', 60, 'def302-fixed-in-60ms.png');
  const b = await capture('in', 125, 'def302-fixed-in-125ms.png');
  const c = await capture('out', 125, 'def302-fixed-out-125ms.png');

  console.log(`[ZD-SHOT] at50=${at50} files=${JSON.stringify(shots)}`);
  expect(a.ok && b.ok && c.ok, 'all three mid-animation pauses must find the FLIP').toBe(true);
});
