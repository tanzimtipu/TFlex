// Phase 35 focused diagnosis (qa) — operator report (2026-09-22):
//   "Page Zoom in/out animation is not smooth."
//
// Diagnostic harness (not a pass/fail guard): it samples, every animation frame
// across a real zoom-in and zoom-out step, the page-1 PAPER-OWNING unit — the
// `.page-slot` (ZOOM_FLIP_UNIT_SELECTOR), which is what the DEF-302 FLIP
// animates and which paints the sheet's paper — plus the content wrapper
// (.pdf-page) it contains, the canvas backing store + CSS size, the scroller
// scrollTop, the mounted/slot counts and the rAF delta. DEF-307 retargeted the
// probe from `.pdf-page` to `.page-slot` after commit 0ffb79b moved the FLIP
// there; the assertions still pin the original intent (the invert lands
// pre-paint, the sheet edge does not jump, the content is pinned) and now also
// pin 1.27.2 (the sheet and its content move as one unit). It also timestamps
// the text-layer rebuild (the raster re-render landing) and every
// animationstart.
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
  const zd = { samples: [], marks: [], textMuts: [], animStarts: [], applies: [] };
  window.__zd = zd;
  const scroller = document.querySelector('.document-scroller');
  const q = (sel) => document.querySelector(sel);
  const rectOf = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), left: Math.round(r.left), h: Math.round(r.height), w: Math.round(r.width) };
  };
  const scaleOf = (el) => {
    if (!el) return null;
    const t = getComputedStyle(el).transform;
    if (!t || t === 'none') return 1;
    try { return new DOMMatrixReadOnly(t).a; } catch (_) { return null; }
  };
  // DEF-307 — the FLIP unit is the PAPER-OWNING `.page-slot`
  // (ZOOM_FLIP_UNIT_SELECTOR, zoomFlip.ts), not the content-only `.pdf-page`.
  // Record the unit's class/vars AND its pre-paint geometry at the instant the
  // class is applied. The MutationObserver callback is a microtask: it runs
  // after the class lands but before the animation's first paint, so the
  // measured rect IS the invert's start geometry — the direct proof that the
  // invert lands pre-paint and that the sheet edge does not jump.
  const unit = q('.page-slot[data-page="1"]');
  const page = q('.pdf-page[data-page="1"]');
  if (unit) {
    const mo = new MutationObserver(() => {
      if (!unit.classList.contains('pdf-page-zoom-flip')) return;
      zd.applies.push({
        t: performance.now(),
        cls: unit.className,
        from: unit.style.getPropertyValue('--tf-zoom-flip-from'),
        dx: unit.style.getPropertyValue('--tf-zoom-flip-dx'),
        dy: unit.style.getPropertyValue('--tf-zoom-flip-dy'),
        rect: rectOf(unit),
        pageRect: rectOf(page),
        pageFlip: page ? page.classList.contains('pdf-page-zoom-flip') : null,
      });
    });
    mo.observe(unit, { attributes: true, attributeFilter: ['class', 'style'] });
  }
  let last = performance.now();
  const sample = () => {
    const now = performance.now();
    const p = q('.pdf-page[data-page="1"]');
    const s = q('.page-slot[data-page="1"]');
    const c = q('.pdf-page[data-page="1"] .pdf-page-canvas');
    const pr = p ? p.getBoundingClientRect() : null;
    const sr = s ? s.getBoundingClientRect() : null;
    const cr = c ? c.getBoundingClientRect() : null;
    zd.samples.push({
      t: now,
      dt: now - last,
      slotTop: s ? s.offsetTop : null,
      slotH: s ? s.offsetHeight : null,
      slotRectTop: sr ? Math.round(sr.top) : null,
      slotRectLeft: sr ? Math.round(sr.left) : null,
      slotRectH: sr ? Math.round(sr.height) : null,
      slotRectW: sr ? Math.round(sr.width) : null,
      pageTop: p ? p.offsetTop : null,
      pageH: p ? p.offsetHeight : null,
      pageRectTop: pr ? Math.round(pr.top) : null,
      pageRectLeft: pr ? Math.round(pr.left) : null,
      pageRectH: pr ? Math.round(pr.height) : null,
      pageRectW: pr ? Math.round(pr.width) : null,
      slotScale: scaleOf(s),
      slotFlip: s ? s.classList.contains('pdf-page-zoom-flip') : null,
      slotFrom: s ? s.style.getPropertyValue('--tf-zoom-flip-from') : null,
      slotDx: s ? s.style.getPropertyValue('--tf-zoom-flip-dx') : null,
      slotDy: s ? s.style.getPropertyValue('--tf-zoom-flip-dy') : null,
      pageScale: scaleOf(p),
      pageFlip: p ? p.classList.contains('pdf-page-zoom-flip') : null,
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
      cls: e.target && e.target.className ? String(e.target.className) : null,
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
      applies: window.__zd.applies,
    };
  });

  const { samples, marks, textMuts, animStarts, applies } = data;
  const markIn = marks.find((m) => m.label === 'zoomIn');
  const markOut = marks.find((m) => m.label === 'zoomOut');
  const baseline = samples.filter((s) => s.t < markIn.t).slice(-1)[0];
  const inSamples = samples.filter((s) => s.t >= markIn.t && s.t < markOut.t);
  const outSamples = samples.filter((s) => s.t >= markOut.t);

  // DEF-307 — the pre-paint invert, per step. `apply` is the slot's geometry at
  // the moment the FLIP class landed (a MutationObserver microtask, before the
  // animation's first paint); `pre` the sample just before the click; `post` the
  // settled sample after the animation cleared. apply should equal pre (the
  // invert lands the sheet on its PRE-zoom box, pre-paint — so the sheet edge
  // does not jump) and must differ from post (the sheet did NOT teleport to its
  // new box before the animation ran — the reopened DEF-302 failure).
  const rectOfSample = (s) => (s ? { top: s.slotRectTop, left: s.slotRectLeft, h: s.slotRectH, w: s.slotRectW } : null);
  const devRect = (a, b) => (a && b ? { top: a.top - b.top, left: a.left - b.left, h: a.h - b.h, w: a.w - b.w } : null);
  const stepEvidence = (label, pre, apply, post) => {
    const vsPre = apply ? devRect(apply.rect, rectOfSample(pre)) : null;
    const vsPost = apply ? devRect(apply.rect, rectOfSample(post)) : null;
    const pageVsUnit = apply ? devRect(apply.pageRect, apply.rect) : null;
    return {
      label,
      hasApply: apply !== undefined && apply !== null,
      hasPre: !!pre,
      hasPost: !!post,
      applyCls: apply ? apply.cls : null,
      applyFrom: apply ? apply.from : null,
      applyDx: apply ? apply.dx : null,
      applyDy: apply ? apply.dy : null,
      applyPageFlip: apply ? apply.pageFlip : null,
      vsPre, vsPost, pageVsUnit,
      postSlotFlip: post ? post.slotFlip : null,
      postSlotScale: post ? post.slotScale : null,
    };
  };
  const applyIn = applies.find((a) => a.t >= markIn.t && a.t < markOut.t);
  const applyOut = applies.find((a) => a.t >= markOut.t);
  const preIn = samples.filter((s) => s.t < markIn.t).slice(-1)[0];
  const postIn = inSamples[inSamples.length - 1];
  const preOut = samples.filter((s) => s.t < markOut.t).slice(-1)[0];
  const postOut = outSamples[outSamples.length - 1];
  const evIn = stepEvidence('zoomIn', preIn, applyIn, postIn);
  const evOut = stepEvidence('zoomOut', preOut, applyOut, postOut);

  const summarize = (label, mark, arr) => {
    const first = arr[0];
    const flipSamples = arr.filter((s) => s.slotFlip === true);
    const animWindow = flipSamples.length > 0
      ? { start: flipSamples[0].t - mark.t, end: flipSamples[flipSamples.length - 1].t - mark.t, n: flipSamples.length }
      : null;
    const dts = arr.map((s) => s.dt);
    const long = dts.filter((d) => d > 32).length;
    const veryLong = dts.filter((d) => d > 50).length;
    const huge = dts.filter((d) => d > 100).length;
    const scrolls = arr.map((s) => s.scrollTop);
    const muts = textMuts.filter((t) => t >= mark.t && t < mark.t + 1200).map((t) => Math.round(t - mark.t));
    const starts = animStarts.filter((a) => a.t >= mark.t && a.t < mark.t + 1200).map((a) => ({ dt: Math.round(a.t - mark.t), name: a.name, page: a.page, cls: a.cls }));
    // DEF-302/DEF-307 — per FLIP frame, the CONTENT wrapper's visual rect vs the
    // PAPER-OWNING unit's visual rect (`.page-slot`, both transform-applied).
    // 1.27.2 animates the slot itself and `.pdf-page` fills that slot exactly,
    // so the two rects must track each other frame-for-frame: the sheet and its
    // content move as one unit. The original intent (the page top tracks its
    // box top; the old centre-origin scale started the content ~198px low on a
    // 25% step) is preserved by the same deviation bound.
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
      maxAbsH: maxAbs(devs.map((d) => d.h)),
      maxAbsW: maxAbs(devs.map((d) => d.w)),
      firstTop: devs.length ? devs[0].top : null,
      firstLeft: devs.length ? devs[0].left : null,
      firstH: devs.length ? devs[0].h : null,
      lastTop: devs.length ? devs[devs.length - 1].top : null,
      lastH: devs.length ? devs[devs.length - 1].h : null,
    };
    return {
      label,
      dev,
      // The FLIP is hosted by the slot, never by the content wrapper (1.27.2).
      pageFlipAny: arr.some((s) => s.pageFlip === true),
      firstAfterMark: first ? {
        dt: Math.round(first.dt), slotH: first.slotH, pageH: first.pageH,
        slotScale: first.slotScale === null ? null : Number(first.slotScale.toFixed(4)),
        pageScale: first.pageScale === null ? null : Number(first.pageScale.toFixed(4)),
        canvasW: first.canvasW, canvasCssW: first.canvasCssW,
        canvasRectW: first.canvasRectW, pageRectH: first.pageRectH,
        scrollTop: first.scrollTop, slotFlip: first.slotFlip, slotFrom: first.slotFrom,
      } : null,
      animWindow,
      scaleStart: flipSamples.length ? Number(flipSamples[0].slotScale.toFixed(4)) : null,
      scaleEnd: flipSamples.length ? Number(flipSamples[flipSamples.length - 1].slotScale.toFixed(4)) : null,
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
    slotH: baseline.slotH, pageH: baseline.pageH, slotScale: baseline.slotScale,
    canvasW: baseline.canvasW, canvasCssW: baseline.canvasCssW,
    canvasRectW: baseline.canvasRectW, pageRectH: baseline.pageRectH, scrollTop: baseline.scrollTop,
  })}`);
  console.log(`[ZD] zoomIn=${JSON.stringify(inSum)}`);
  console.log(`[ZD] zoomOut=${JSON.stringify(outSum)}`);
  console.log(`[ZD] applyIn=${JSON.stringify(evIn)}`);
  console.log(`[ZD] applyOut=${JSON.stringify(evOut)}`);

  // Compact frame timeline: first 22 frames after each mark.
  const timeline = (mark, arr) => arr.slice(0, 22).map((s) => ({
    dt: Math.round(s.dt), slotH: s.slotH, pageH: s.pageH,
    slotScale: s.slotScale === null ? null : Number(s.slotScale.toFixed(3)),
    pageFlip: s.pageFlip ? 1 : 0, slotFlip: s.slotFlip ? 1 : 0,
    cW: s.canvasW, cCssW: s.canvasCssW, cRectW: s.canvasRectW,
    scroll: s.scrollTop,
  }));
  console.log(`[ZD] timeline zoomIn=${JSON.stringify(timeline(markIn, inSamples))}`);
  console.log(`[ZD] timeline zoomOut=${JSON.stringify(timeline(markOut, outSamples))}`);

  // Reproduction assertions only.
  expect(parseFloat(readout1)).toBeGreaterThan(parseFloat(readout0));
  expect(parseFloat(readout2)).toBeLessThan(parseFloat(readout1));
  expect(inSum.animWindow, 'zoom-in must play the FLIP animation').not.toBeNull();
  expect(outSum.animWindow, 'zoom-out must play the FLIP animation').not.toBeNull();
  // The animation is hosted by the PAPER-OWNING slot (ZOOM_FLIP_UNIT_SELECTOR),
  // and the content wrapper never carries it (1.27.2 relocation).
  expect(animStarts.some((a) => a.name === 'tf-page-zoom-flip' && /pdf-page-zoom-flip/.test(a.cls || '') && a.page !== null)).toBe(true);
  expect(inSum.pageFlipAny, 'the content wrapper must not host the FLIP (zoom-in)').toBe(false);
  expect(outSum.pageFlipAny, 'the content wrapper must not host the FLIP (zoom-out)').toBe(false);
  // DEF-302 regression guard, preserved: the content stays pinned to its
  // paper-owning unit for every animated frame (the old centre-origin scale
  // started the content ~198px below the box top).
  expect(inSum.dev.maxAbsTop, 'zoom-in content top must track the sheet top').toBeLessThanOrEqual(2);
  expect(outSum.dev.maxAbsTop, 'zoom-out content top must track the sheet top').toBeLessThanOrEqual(2);
  expect(inSum.dev.maxAbsLeft, 'zoom-in content left must track the sheet left').toBeLessThanOrEqual(2);
  expect(outSum.dev.maxAbsLeft, 'zoom-out content left must track the sheet left').toBeLessThanOrEqual(2);
  expect(inSum.dev.maxAbsH, 'zoom-in content height must track the sheet height').toBeLessThanOrEqual(2);
  expect(outSum.dev.maxAbsH, 'zoom-out content height must track the sheet height').toBeLessThanOrEqual(2);
  expect(inSum.dev.maxAbsW, 'zoom-in content width must track the sheet width').toBeLessThanOrEqual(2);
  expect(outSum.dev.maxAbsW, 'zoom-out content width must track the sheet width').toBeLessThanOrEqual(2);

  // DEF-307 — the invert lands pre-paint on the paper-owning unit, so the
  // sheet edge does not jump; and it is NOT the new box (no teleport).
  for (const ev of [evIn, evOut]) {
    expect(ev.hasApply, `${ev.label}: the FLIP class must land on the slot`).toBe(true);
    expect(ev.hasPre, `${ev.label}: a pre-zoom sample must exist`).toBe(true);
    expect(ev.hasPost, `${ev.label}: a settled post-zoom sample must exist`).toBe(true);
    expect(ev.applyCls, `${ev.label}: the unit hosts the FLIP class`).toContain('pdf-page-zoom-flip');
    expect(ev.applyPageFlip, `${ev.label}: the content wrapper is not the FLIP unit`).toBe(false);
    expect(Number(ev.applyFrom) > 0, `${ev.label}: --tf-zoom-flip-from scale written pre-paint`).toBe(true);
    expect(ev.applyDx, `${ev.label}: --tf-zoom-flip-dx written pre-paint`).not.toBe(null);
    expect(ev.applyDy, `${ev.label}: --tf-zoom-flip-dy written pre-paint`).not.toBe(null);
    // The invert maps the new box back onto the OLD box: at class-apply time the
    // unit's rect equals the pre-zoom rect within a pixel or two.
    expect(Math.abs(ev.vsPre.top), `${ev.label}: sheet edge top does not jump`).toBeLessThanOrEqual(2);
    expect(Math.abs(ev.vsPre.left), `${ev.label}: sheet edge left does not jump`).toBeLessThanOrEqual(2);
    expect(Math.abs(ev.vsPre.h), `${ev.label}: sheet height starts at the pre-zoom box`).toBeLessThanOrEqual(2);
    expect(Math.abs(ev.vsPre.w), `${ev.label}: sheet width starts at the pre-zoom box`).toBeLessThanOrEqual(2);
    // The first painted frame is NOT the new box (the sheet did not teleport).
    expect(Math.abs(ev.vsPost.h) >= 2, `${ev.label}: the first animated frame is not the new box height`).toBe(true);
    // The content sits exactly on the sheet at that instant too.
    expect(Math.abs(ev.pageVsUnit.top), `${ev.label}: content pinned to the sheet at apply`).toBeLessThanOrEqual(2);
    expect(Math.abs(ev.pageVsUnit.left), `${ev.label}: content pinned to the sheet at apply`).toBeLessThanOrEqual(2);
    // The animation ended on the new box (settled, class cleared, scale 1).
    expect(ev.postSlotFlip, `${ev.label}: the FLIP class is cleared when settled`).toBe(false);
    expect(Math.abs(ev.postSlotScale - 1), `${ev.label}: the FLIP lands at identity`).toBeLessThanOrEqual(0.01);
  }
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
    return { samples: window.__zd.samples, marks: window.__zd.marks, animStarts: window.__zd.animStarts, applies: window.__zd.applies };
  });
  const mark = data.marks.find((m) => m.label === 'zoom25');
  const arr = data.samples.filter((s) => s.t >= mark.t);
  // DEF-307 — the FLIP unit is the PAPER-OWNING `.page-slot`, not `.pdf-page`.
  const flipSamples = arr.filter((s) => s.slotFlip === true);
  const devs = flipSamples.map((s) => ({
    top: s.pageRectTop - s.slotRectTop,
    left: s.pageRectLeft - s.slotRectLeft,
    h: s.pageRectH - s.slotRectH,
    w: s.pageRectW - s.slotRectW,
  }));
  const maxAbs = (nums) => (nums.length ? Math.max(...nums.map((n) => Math.abs(n))) : null);
  const maxAbsTop = maxAbs(devs.map((d) => d.top));
  const maxAbsLeft = maxAbs(devs.map((d) => d.left));
  const maxAbsH = maxAbs(devs.map((d) => d.h));
  const maxAbsW = maxAbs(devs.map((d) => d.w));
  const pre = data.samples.filter((s) => s.t < mark.t).slice(-1)[0];
  const post = arr[arr.length - 1];
  const apply = data.applies.find((a) => a.t >= mark.t);
  const vsPre = apply && pre ? {
    top: apply.rect.top - pre.slotRectTop,
    left: apply.rect.left - pre.slotRectLeft,
    h: apply.rect.h - pre.slotRectH,
    w: apply.rect.w - pre.slotRectW,
  } : null;
  const vsPost = apply && post ? {
    h: apply.rect.h - post.slotRectH,
    w: apply.rect.w - post.slotRectW,
  } : null;
  const pageVsUnit = apply && apply.pageRect ? {
    top: apply.pageRect.top - apply.rect.top,
    left: apply.pageRect.left - apply.rect.left,
    h: apply.pageRect.h - apply.rect.h,
    w: apply.pageRect.w - apply.rect.w,
  } : null;
  console.log(`[ZD25] readouts: at200=${at200} at250=${at250}`);
  console.log(`[ZD25] flipFrames=${flipSamples.length} first=${JSON.stringify(devs[0])} last=${JSON.stringify(devs[devs.length - 1])} maxAbsTop=${maxAbsTop} maxAbsLeft=${maxAbsLeft} maxAbsH=${maxAbsH} maxAbsW=${maxAbsW}`);
  console.log(`[ZD25] apply=${JSON.stringify(apply)} pre=${JSON.stringify(pre && { top: pre.slotRectTop, left: pre.slotRectLeft, h: pre.slotRectH, w: pre.slotRectW })} post=${JSON.stringify(post && { top: post.slotRectTop, left: post.slotRectLeft, h: post.slotRectH, w: post.slotRectW, slotFlip: post.slotFlip, slotScale: post.slotScale })}`);
  console.log(`[ZD25] vsPre=${JSON.stringify(vsPre)} vsPost=${JSON.stringify(vsPost)} pageVsUnit=${JSON.stringify(pageVsUnit)}`);
  console.log(`[ZD25] timeline=${JSON.stringify(flipSamples.slice(0, 20).map((s) => ({
    dt: Math.round(s.dt), slotTop: s.slotRectTop, pageTop: s.pageRectTop,
    slotLeft: s.slotRectLeft, pageLeft: s.pageRectLeft,
    slotW: s.slotRectW, pageW: s.pageRectW,
    devTop: s.pageRectTop - s.slotRectTop, devLeft: s.pageRectLeft - s.slotRectLeft,
    devH: s.pageRectH - s.slotRectH, slotScale: s.slotScale === null ? null : Number(s.slotScale.toFixed(3)),
    slotFlip: s.slotFlip ? 1 : 0, pageFlip: s.pageFlip ? 1 : 0,
  })))}`);

  expect(parseFloat(at250)).toBeGreaterThan(parseFloat(at200));
  expect(flipSamples.length, 'the 25% step must play the FLIP').toBeGreaterThan(0);
  // Regression guard (preserved): the content stays pinned to its paper-owning
  // unit on every frame — the old centre-origin scale started ~198px low on
  // this exact step — so the sheet and its content move as one unit.
  expect(maxAbsTop, 'content top must track the sheet top').toBeLessThanOrEqual(2);
  expect(maxAbsLeft, 'content left must track the sheet left').toBeLessThanOrEqual(2);
  expect(maxAbsH, 'content height must track the sheet height').toBeLessThanOrEqual(2);
  expect(maxAbsW, 'content width must track the sheet width').toBeLessThanOrEqual(2);
  expect(arr.some((s) => s.pageFlip === true), 'the content wrapper must not host the FLIP').toBe(false);
  // The FLIP must land exactly on the new box: settled, class cleared, identity.
  expect(post.slotFlip, 'the FLIP class is cleared when settled').toBe(false);
  expect(Math.abs(post.slotScale - 1), 'the FLIP lands at identity').toBeLessThanOrEqual(0.01);
  expect(post.pageRectTop - post.slotRectTop, 'the settled content sits on the new box top').toBe(0);
  expect(post.pageRectLeft - post.slotRectLeft, 'the settled content sits on the new box left').toBe(0);
  // DEF-307 — pre-paint invert on the unit: the sheet edge does not jump, and
  // the first animated frame is NOT the new box (the old paper teleport).
  expect(apply, 'the FLIP class must land on the slot').toBeTruthy();
  expect(apply.cls, 'the unit hosts the FLIP class').toContain('pdf-page-zoom-flip');
  expect(apply.pageFlip, 'the content wrapper is not the FLIP unit').toBe(false);
  expect(Number(apply.from) > 0, '--tf-zoom-flip-from scale written pre-paint').toBe(true);
  expect(Math.abs(vsPre.top), 'sheet edge top does not jump').toBeLessThanOrEqual(2);
  expect(Math.abs(vsPre.left), 'sheet edge left does not jump').toBeLessThanOrEqual(2);
  expect(Math.abs(vsPre.h), 'sheet height starts at the pre-zoom box').toBeLessThanOrEqual(2);
  expect(Math.abs(vsPre.w), 'sheet width starts at the pre-zoom box').toBeLessThanOrEqual(2);
  expect(Math.abs(vsPost.h) >= 2, 'the first animated frame is not the new box height').toBe(true);
  expect(Math.abs(pageVsUnit.top), 'content pinned to the sheet at apply').toBeLessThanOrEqual(2);
  expect(Math.abs(pageVsUnit.left), 'content pinned to the sheet at apply').toBeLessThanOrEqual(2);
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
// DEF-307 — the paused animation is the PAPER-OWNING `.page-slot`
// (ZOOM_FLIP_UNIT_SELECTOR); the content wrapper must NOT own a zoom-flip
// animation (1.27.2 relocation).
async function zoomAndPause(dir, atMs) {
  return win.evaluate(({ dir: d, atMs: ms }) => new Promise((resolve) => {
    const btn = document.querySelector(`button[aria-label="${d === 'in' ? 'Zoom in' : 'Zoom out'}"]`);
    if (!btn) return resolve({ ok: false, reason: 'no-btn' });
    btn.click();
    let tries = 0;
    const attempt = () => {
      const el = document.querySelector('.page-slot[data-page="1"]');
      const page = document.querySelector('.pdf-page[data-page="1"]');
      const anims = el ? el.getAnimations() : [];
      const a = anims.find((x) => x.animationName === 'tf-page-zoom-flip');
      if (a) {
        a.pause();
        a.currentTime = ms;
        const pageAnims = page ? page.getAnimations().map((x) => x.animationName) : [];
        const canvas = el.querySelector('.pdf-page-canvas');
        return resolve({
          ok: true,
          unit: el.classList.contains('pdf-page-zoom-flip'),
          name: a.animationName,
          duration: a.effect.getTiming().duration,
          easing: a.effect.getTiming().easing,
          from: el.style.getPropertyValue('--tf-zoom-flip-from'),
          dx: el.style.getPropertyValue('--tf-zoom-flip-dx'),
          dy: el.style.getPropertyValue('--tf-zoom-flip-dy'),
          scale: new DOMMatrixReadOnly(getComputedStyle(el).transform).a,
          pageFlip: page ? page.classList.contains('pdf-page-zoom-flip') : null,
          pageAnims,
          slotH: el.offsetHeight,
          pageH: page ? page.offsetHeight : null,
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
    const el = document.querySelector('.page-slot[data-page="1"]');
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
  // DEF-307 — the paused unit is the PAPER-OWNING slot (1.27.2); the content
  // wrapper hosts neither the class nor the animation.
  for (const [label, info] of [['in-60ms', a], ['in-125ms', b], ['out-125ms', c]]) {
    expect(info.unit, `${label}: the slot hosts the FLIP class`).toBe(true);
    expect(info.name, `${label}: the paused animation name`).toBe('tf-page-zoom-flip');
    expect(Number(info.from) > 0, `${label}: the invert scale var is set on the slot`).toBe(true);
    expect(info.pageFlip, `${label}: the content wrapper must not host the FLIP`).toBe(false);
    expect(info.pageAnims, `${label}: the content wrapper must not run the zoom FLIP`).not.toContain('tf-page-zoom-flip');
  }
});
