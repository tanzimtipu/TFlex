// Phase 33 e2e (spec 4 of 4) — criteria 4 and 5: opaque canvas + centred
// side-by-side thumbnail strips.
//
// Criterion 4: pixel-sample the pane/scroller background in Multi Mode in
// every theme (at minimum frosted, where the defect was) and assert an opaque
// colour (alpha 255), never the app background showing through.
// Criterion 5: pane A's strip is to the RIGHT of pane A's pages and pane B's
// strip is to the LEFT of pane B's pages, the two strips adjacent in the
// middle; each strip shows its own document's thumbnails at a dynamically
// computed width; a thumbnail click navigates its own pane; a cross-document
// drag from a strip still moves the page.
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { PNG } = require('pngjs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { SHOTS, twoPaneSetup, focusPaneByPage, paneCount, switchTheme } = require('./lib/p33_common.cjs');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p33-layout');
  app = null;
  win = null;
});
test.setTimeout(300000);

// Alpha-preserving 1x1 clip at a point inside the pane's scroller that is NOT
// over a page slot (the exposed canvas). The scan starts below the shared
// toolbar so it never samples the toolbar chrome.
async function paneCanvasPixel(pane) {
  const point = await win.evaluate((p) => {
    const sc = document.querySelector(`.tab-pane[data-pane="${p}"] .document-scroller`);
    if (!sc) return null;
    const r = sc.getBoundingClientRect();
    for (let dy = 60; dy < r.height - 8; dy += 8) {
      for (let dx = 8; dx < r.width - 8; dx += 8) {
        const x = r.left + dx;
        const y = r.top + dy;
        const el = document.elementFromPoint(x, y);
        if (el && el.closest('.page-slot') === null) {
          return { x: Math.round(x), y: Math.round(y), top: `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0]}` };
        }
      }
    }
    return null;
  }, pane);
  if (point === null) return null;
  const buf = await win.screenshot({ omitBackground: true, clip: { x: point.x, y: point.y, width: 1, height: 1 } });
  const png = PNG.sync.read(buf);
  return { point, r: png.data[0], g: png.data[1], b: png.data[2], a: png.data[3] };
}

async function paneStyles(pane) {
  return win.evaluate((p) => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).backgroundColor : null;
    };
    return {
      pane: pick(`.tab-pane[data-pane="${p}"]`),
      scroller: pick(`.tab-pane[data-pane="${p}"] .document-scroller`),
      main: pick(`.tab-pane[data-pane="${p}"] .workspace-main`),
    };
  }, pane);
}

function isOpaqueColor(c) {
  return c !== null && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent';
}

test('C4 opaque canvas in every theme', async () => {
  await twoPaneSetup(app, win);
  const stage = win.locator('.tab-stage');
  expect(await stage.getAttribute('data-multi-mode')).toBe('true');
  expect(await stage.getAttribute('data-multi-panes')).toBe('2');

  for (const theme of ['frosted', 'light', 'dark']) {
    await switchTheme(win, theme);
    await win.waitForTimeout(700);
    const styles = await paneStyles('A');
    const px = await paneCanvasPixel('A');
    console.log(`[P33-layout] theme=${theme} styles=${JSON.stringify(styles)} pixel=${JSON.stringify(px)}`);
    expect(isOpaqueColor(styles.pane), `${theme}: pane background is an opaque colour`).toBe(true);
    expect(isOpaqueColor(styles.scroller), `${theme}: scroller background is an opaque colour`).toBe(true);
    expect(isOpaqueColor(styles.main), `${theme}: workspace-main background is an opaque colour`).toBe(true);
    expect(px, `${theme}: pane canvas pixel sampled`).not.toBeNull();
    expect(px.a, `${theme}: pane canvas pixel is opaque (alpha 255), got ${JSON.stringify(px)}`).toBe(255);
  }
});

test('C5 centred side-by-side strips: geometry, own thumbnails, click navigation, cross-doc drag', async () => {
  await twoPaneSetup(app, win);
  await focusPaneByPage(win, 'A');
  await win.waitForTimeout(700);

  // ---- geometry: [A pages | A strip || B strip | B pages] ---------------
  const g = await win.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return {
        left: Math.round(b.left),
        right: Math.round(b.right),
        top: Math.round(b.top),
        bottom: Math.round(b.bottom),
        width: Math.round(b.width),
      };
    };
    return {
      mainA: rect('.tab-pane[data-pane="A"] .workspace-main'),
      stripA: rect('.tab-pane[data-pane="A"] .pane-thumb-strip'),
      mainB: rect('.tab-pane[data-pane="B"] .workspace-main'),
      stripB: rect('.tab-pane[data-pane="B"] .pane-thumb-strip'),
      divider: rect('[data-multi-divider]'),
    };
  });
  console.log(`[P33-layout] strip geometry=${JSON.stringify(g)}`);
  for (const k of ['mainA', 'stripA', 'mainB', 'stripB', 'divider']) {
    expect(g[k], `${k} present`).not.toBeNull();
  }
  // Pane A: strip immediately to the RIGHT of A's pages.
  expect(g.stripA.left, 'pane A strip is to the right of pane A pages').toBeGreaterThanOrEqual(g.mainA.right - 1);
  expect(g.stripA.left, 'pane A strip is on the right side of its pane').toBeGreaterThan(g.mainA.left);
  // Pane B: strip immediately to the LEFT of B's pages.
  expect(g.stripB.right, 'pane B strip is to the left of pane B pages').toBeLessThanOrEqual(g.mainB.left + 1);
  expect(g.stripB.left, 'pane B strip is on the left side of its pane').toBeLessThan(g.mainB.right);
  // The two strips meet in the middle, side by side, with the divider between.
  expect(g.stripA.right, 'A strip is left of B strip (ordered in the middle)').toBeLessThanOrEqual(g.stripB.left);
  expect(g.stripB.left - g.stripA.right, 'the two strips are adjacent in the middle').toBeLessThanOrEqual(20);
  expect(g.divider.left, 'divider sits at/after A strip').toBeGreaterThanOrEqual(g.stripA.right - 2);
  expect(g.divider.right, 'divider sits at/before B strip').toBeLessThanOrEqual(g.stripB.left + 2);

  // ---- each strip shows its own document at the dynamic width -----------
  const stripInfo = await win.evaluate(() => {
    const info = (p) => {
      const strip = document.querySelector(`[data-pane-strip-pane="${p}"]`);
      const wrap = strip ? strip.querySelector('.thumb-canvas-wrap') : null;
      // DEF-291 — the strip is headerless; its aria-label carries the identity
      // ("Pane A thumbnails: <title>") now that the visible name row is gone.
      return {
        doc: strip ? strip.getAttribute('data-pane-strip-doc') : null,
        label: strip ? (strip.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim() : null,
        thumbW: wrap ? Math.round(wrap.getBoundingClientRect().width) : null,
        thumbs: strip ? strip.querySelectorAll('.thumb-item').length : 0,
      };
    };
    return { A: info('A'), B: info('B') };
  });
  console.log(`[P33-layout] strips=${JSON.stringify(stripInfo)}`);
  expect(stripInfo.A.doc, 'strip A names a document').not.toBeNull();
  expect(stripInfo.B.doc, 'strip B names a document').not.toBeNull();
  expect(stripInfo.A.doc, 'the two strips show different documents').not.toBe(stripInfo.B.doc);
  expect(stripInfo.A.label, 'strip A label names its pane and document').toContain('p33-alpha');
  expect(stripInfo.A.label, 'strip A label names its pane').toContain('Pane A');
  expect(stripInfo.B.label, 'strip B label names its pane and document').toContain('p33-beta');
  expect(stripInfo.B.label, 'strip B label names its pane').toContain('Pane B');
  expect(stripInfo.A.thumbs, 'strip A renders thumbnails').toBeGreaterThan(0);
  expect(stripInfo.B.thumbs, 'strip B renders thumbnails').toBeGreaterThan(0);
  // Two documents -> the dynamic width shrinks below the single-mode 126px.
  expect(stripInfo.A.thumbW, 'strip A thumb width is dynamically sized').toBeLessThan(126);
  expect(stripInfo.A.thumbW, 'strip A thumb width stays a comfortable hit target').toBeGreaterThanOrEqual(84);

  // ---- a thumbnail click navigates its own pane -------------------------
  // Read each pane's OWN scroll geometry (the shared diagnostics surface is
  // keyed to the active tab and can lag a focus move), so "navigates its own
  // pane" is asserted from the pane that actually moved.
  const paneTopPage = (pane) =>
    win.evaluate((p) => {
      const sc = document.querySelector(`.tab-pane[data-pane="${p}"] .document-scroller`);
      if (!sc) return null;
      const sr = sc.getBoundingClientRect();
      let topPage = null;
      for (const s of sc.querySelectorAll('.page-slot[data-page]')) {
        const r = s.getBoundingClientRect();
        if (r.bottom > sr.top + 5) {
          topPage = Number(s.getAttribute('data-page'));
          break;
        }
      }
      return { scrollTop: Math.round(sc.scrollTop), topPage };
    }, pane);

  const beforeA = await paneTopPage('A');
  const beforeB = await paneTopPage('B');
  const thumbB3 = win.locator('[data-pane-strip-pane="B"] .thumb-item[data-page="3"]');
  await thumbB3.first().scrollIntoViewIfNeeded();
  await thumbB3.first().click();
  await win.waitForTimeout(900);
  const afterA = await paneTopPage('A');
  const afterB = await paneTopPage('B');
  console.log(`[P33-layout] strip B page-3 click: A ${JSON.stringify(beforeA)} -> ${JSON.stringify(afterA)}; B ${JSON.stringify(beforeB)} -> ${JSON.stringify(afterB)}`);
  expect(afterB.topPage, 'clicking strip B navigates pane B to page 3').toBe(3);
  expect(afterB.scrollTop, 'pane B scrolled').toBeGreaterThan(beforeB.scrollTop);
  expect(afterA.topPage, 'pane A stayed on page 1').toBe(1);
  expect(afterA.scrollTop, 'pane A did not scroll').toBe(beforeA.scrollTop);

  // ---- the visual record ------------------------------------------------
  await focusPaneByPage(win, 'A');
  await win.waitForTimeout(700);
  await win.screenshot({ path: path.join(SHOTS, 'phase33-multi-layout.png') });
  console.log('[P33-layout] captured screenshots/phase33-multi-layout.png');

  // ---- a cross-document drag from a strip still moves the page ----------
  const a0 = await paneCount(win, 'A');
  const b0 = await paneCount(win, 'B');
  expect(a0).toBe(34);
  expect(b0).toBe(520);
  const srcSel = '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]';
  const tgtSel = '[data-pane-strip-pane="B"] .thumb-item[data-page="2"]';
  let moved = false;
  try {
    await win.locator(srcSel).first().dragTo(win.locator(tgtSel).first(), { timeout: 8000 });
    await win.waitForTimeout(2200);
    moved = (await paneCount(win, 'A')) === 33 && (await paneCount(win, 'B')) === 521;
  } catch (_) {
    moved = false;
  }
  if (!moved) {
    console.log('[P33-layout] native dragTo did not move; using synthetic DataTransfer');
    await win.evaluate(({ src, tgt }) => {
      const s = document.querySelector(src);
      const t = document.querySelector(tgt);
      const dt = new DataTransfer();
      s.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      const r = t.getBoundingClientRect();
      const opts = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.25 };
      t.dispatchEvent(new DragEvent('dragover', opts));
      t.dispatchEvent(new DragEvent('drop', opts));
      s.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, { src: srcSel, tgt: tgtSel });
    await win.waitForTimeout(2200);
  }
  const a1 = await paneCount(win, 'A');
  const b1 = await paneCount(win, 'B');
  console.log(`[P33-layout] cross-doc strip drag: A ${a0}->${a1}, B ${b0}->${b1}`);
  expect(a1, 'source pane lost the page').toBe(33);
  expect(b1, 'target pane gained the page').toBe(521);
});