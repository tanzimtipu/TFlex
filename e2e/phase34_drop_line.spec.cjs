// Phase 34 — criterion 5: a clear insertion line while dragging a page.
//
// During a page drag a line spanning the page column is shown in the GAP where
// the page will land, in BOTH the canvas and the thumbnail rail, so the
// insertion point is unambiguous. It sits between the two page slots (never
// overlaying a page), follows the hovered slot, and disappears on drag
// end/cancel. The rail also shows the APPEND line below the last thumb.
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { twoPaneSetup, SHOTS } = require('./lib/p33_common.cjs');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p34-dropline');
  app = null;
  win = null;
});
test.setTimeout(300000);

// Synthetic drag step with a real DataTransfer, holding the app in a dragging
// state so the mid-drag affordances can be read (the phase32_flicker probe).
async function synthStep(step, arg) {
  return win.evaluate(({ step: s, arg: a }) => {
    const KEY = '__p34dt';
    if (s === 'start') {
      const src = document.querySelector(a.src);
      if (!src) return { ok: false, reason: 'no-src' };
      const dt = new DataTransfer();
      window[KEY] = dt;
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return { ok: true };
    }
    const dt = window[KEY];
    if (!dt) return { ok: false, reason: 'no-dt' };
    if (s === 'over') {
      const tgt = document.querySelector(a.tgt);
      if (!tgt) return { ok: false, reason: 'no-tgt' };
      const r = tgt.getBoundingClientRect();
      const ev = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer: dt,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height * 0.25,
      });
      tgt.dispatchEvent(ev);
      return { ok: true, prevented: ev.defaultPrevented };
    }
    if (s === 'end') {
      const src = document.querySelector(a.src);
      if (src) src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
      delete window[KEY];
      return { ok: true };
    }
    return { ok: false, reason: 'bad-step' };
  }, { step, arg });
}

const rectFn = `(el) => { if (el === null) return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), width: Math.round(b.width), height: Math.round(b.height) }; }`;

async function canvasIndicator(paneSel, page) {
  return win.evaluate(({ pane, page, rf }) => {
    const rect = eval(rf);
    const slot = document.querySelector(`${pane} .page-slot[data-page="${page}"]`);
    const prev = document.querySelector(`${pane} .page-slot[data-page="${page - 1}"]`);
    // The insertion point at an internal boundary is rendered on BOTH
    // neighbours (slot N's after-line and slot N+1's before-line coincide in
    // the gap); read the hovered slot's OWN indicator.
    const ind = slot ? slot.querySelector('[data-drop-indicator]') : null;
    const pageEl = slot ? slot.querySelector('.pdf-page') : null;
    return {
      slot: rect(slot),
      prev: rect(prev),
      indicator: rect(ind),
      side: ind ? ind.getAttribute('data-drop-indicator') : null,
      page: ind ? Number(ind.getAttribute('data-drop-page')) : null,
      pageWidth: pageEl ? Math.round(pageEl.getBoundingClientRect().width) : null,
    };
  }, { pane: paneSel, page, rf: rectFn });
}

async function railLine(stripSel, page) {
  return win.evaluate(({ strip, page, rf }) => {
    const rect = eval(rf);
    const thumb = document.querySelector(`${strip} .thumb-item[data-page="${page}"]`);
    const prev = document.querySelector(`${strip} .thumb-item[data-page="${page - 1}"]`);
    const line = thumb ? thumb.querySelector('[data-thumb-drop-line]') : null;
    return {
      thumb: rect(thumb),
      prev: rect(prev),
      line: rect(line),
      hasLine: !!line,
      lineClass: line ? line.className : null,
    };
  }, { strip: stripSel, page, rf: rectFn });
}

async function anyRailLine(stripSel) {
  return win.evaluate((strip) => document.querySelectorAll(`${strip} [data-thumb-drop-line]`).length, stripSel);
}

test('C1 canvas: the insertion line sits between the neighbouring page slots and moves with the hovered slot', async () => {
  await twoPaneSetup(app, win);
  // Pane B pages 1..3 are mounted at the top; the drag source is pane A's strip.
  await win.evaluate(() => {
    const sc = document.querySelector('.tab-pane[data-pane="B"] .document-scroller');
    if (sc) sc.scrollTop = 0;
  });
  await win.waitForTimeout(700);

  await synthStep('start', { src: '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]' });
  await win.waitForTimeout(200);

  // Hover page 3 upper half -> "before page 3" (between slot 2 and slot 3).
  await synthStep('over', { tgt: '.tab-pane[data-pane="B"] .page-slot[data-page="3"]' });
  await win.waitForTimeout(500);
  const i3 = await canvasIndicator('.tab-pane[data-pane="B"]', 3);
  console.log(`[P34-dropline] canvas before page 3: ${JSON.stringify(i3)}`);
  expect(i3.side).toBe('before');
  expect(i3.page).toBe(3);
  expect(i3.indicator).not.toBeNull();
  // Thickness is the 5px accent line (up from 3px).
  expect(i3.indicator.height).toBeGreaterThanOrEqual(4);
  expect(i3.indicator.height).toBeLessThanOrEqual(6);
  // Between the two page slots: below slot 2's bottom, above slot 3's top.
  expect(i3.prev, 'page 2 slot present').not.toBeNull();
  expect(i3.indicator.top, 'line overlaps page 2 content').toBeGreaterThanOrEqual(i3.prev.bottom - 1);
  expect(i3.indicator.bottom, 'line overlaps page 3 content').toBeLessThanOrEqual(i3.slot.top + 1);
  // Spans the page column width (the indicator is left:0/right:0 of the slot).
  expect(i3.indicator.width, `line width ${i3.indicator.width} vs page column ${i3.slot.width}`).toBeGreaterThanOrEqual(i3.slot.width - 2);
  expect(i3.indicator.width).toBeLessThanOrEqual(i3.slot.width + 2);
  console.log(`[P34-dropline] page 3 mounted page width = ${i3.pageWidth}`);

  // Hover page 2 upper half -> the line MOVES up to "before page 2".
  await synthStep('over', { tgt: '.tab-pane[data-pane="B"] .page-slot[data-page="2"]' });
  await win.waitForTimeout(400);
  const i2 = await canvasIndicator('.tab-pane[data-pane="B"]', 2);
  console.log(`[P34-dropline] canvas before page 2: ${JSON.stringify(i2)}`);
  expect(i2.side).toBe('before');
  expect(i2.page).toBe(2);
  expect(i2.indicator.top, 'line did not follow the hovered slot').toBeLessThan(i3.indicator.top);
  expect(i2.indicator.top).toBeGreaterThanOrEqual(i2.prev.bottom - 1);
  expect(i2.indicator.bottom).toBeLessThanOrEqual(i2.slot.top + 1);

  // Visual record: the drag in progress with the insertion line between pages.
  await win.screenshot({ path: path.join(SHOTS, 'phase34-drop-line.png') });
  console.log('[P34-dropline] captured screenshots/phase34-drop-line.png');

  // Drag end -> the line disappears.
  await synthStep('end', { src: '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]' });
  await win.waitForTimeout(500);
  const gone = await win.evaluate(() => document.querySelectorAll('[data-drop-indicator]').length);
  console.log(`[P34-dropline] canvas indicators after drag end = ${gone}`);
  expect(gone).toBe(0);
});

test('C2 rail: the insertion line sits in the gap between thumbs, moves, and shows the append case', async () => {
  await twoPaneSetup(app, win);
  await synthStep('start', { src: '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]' });
  await win.waitForTimeout(200);

  // Hover pane B's thumb 5 -> the line in the gap above it.
  await synthStep('over', { tgt: '[data-pane-strip-pane="B"] .thumb-item[data-page="5"]' });
  await win.waitForTimeout(500);
  const r5 = await railLine('[data-pane-strip-pane="B"]', 5);
  console.log(`[P34-dropline] rail thumb 5: ${JSON.stringify(r5)}`);
  expect(r5.hasLine, 'rail line present on the hovered thumb').toBe(true);
  expect(r5.lineClass).not.toContain('thumb-drop-line-after');
  expect(r5.prev, 'thumb 4 present').not.toBeNull();
  expect(r5.line.bottom, 'rail line overlaps thumb 5 content').toBeLessThanOrEqual(r5.thumb.top + 1);
  expect(r5.line.top, 'rail line overlaps thumb 4 content').toBeGreaterThanOrEqual(r5.prev.bottom - 1);
  // Spans the thumb/page column (the 4px side insets).
  expect(r5.line.width, `rail line width ${r5.line.width} vs thumb width ${r5.thumb.width}`).toBeGreaterThanOrEqual(r5.thumb.width - 12);

  // Hover thumb 8 -> the line MOVES.
  await synthStep('over', { tgt: '[data-pane-strip-pane="B"] .thumb-item[data-page="8"]' });
  await win.waitForTimeout(400);
  const r8 = await railLine('[data-pane-strip-pane="B"]', 8);
  console.log(`[P34-dropline] rail thumb 8: ${JSON.stringify(r8)}`);
  expect(r8.hasLine, 'rail line follows the hovered thumb').toBe(true);
  const r5After = await railLine('[data-pane-strip-pane="B"]', 5);
  expect(r5After.hasLine, 'the previous thumb no longer shows the line').toBe(false);

  // Append case: hover the empty space below the last thumb -> the line after
  // the LAST thumb (520).
  await synthStep('over', { tgt: '[data-pane-strip-pane="B"] .thumb-scroller' });
  await win.waitForTimeout(400);
  const append = await win.evaluate(() => {
    const thumb = document.querySelector('[data-pane-strip-pane="B"] .thumb-item[data-page="520"]');
    const prev = document.querySelector('[data-pane-strip-pane="B"] .thumb-item[data-page="519"]');
    const line = thumb ? thumb.querySelector('[data-thumb-drop-line]') : null;
    const rect = (el) => { if (el === null) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), width: Math.round(b.width) }; };
    return {
      lastThumb: rect(thumb),
      prevThumb: rect(prev),
      line: rect(line),
      hasLine: !!line,
      lineClass: line ? line.className : null,
      onPrev: prev ? !!prev.querySelector('[data-thumb-drop-line]') : null,
    };
  });
  console.log(`[P34-dropline] rail append: ${JSON.stringify(append)}`);
  expect(append.hasLine, 'append line present on the last thumb').toBe(true);
  expect(append.lineClass, 'append line uses the after variant').toContain('thumb-drop-line-after');
  expect(append.onPrev, 'append line is not on the second-to-last thumb').toBe(false);
  expect(append.line.top, 'append line sits below the last thumb').toBeGreaterThanOrEqual(append.lastThumb.bottom - 2);

  // Drag end -> the line disappears.
  await synthStep('end', { src: '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]' });
  await win.waitForTimeout(500);
  const railGone = await anyRailLine('[data-pane-strip-pane="B"]');
  console.log(`[P34-dropline] rail lines after drag end = ${railGone}`);
  expect(railGone).toBe(0);
});
