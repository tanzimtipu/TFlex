// Phase 36 (chunk 2) gate (qa) — the PAGES ContextPanel's parity with the
// existing SideRail, plus the panel-only chrome (hover verbs, right-click
// menu, Combine, outline) and the flag-OFF no-op assertion.
//
// The chunk mounts the new ContextPanel ALONGSIDE the unchanged rail behind
// the temporary dev flag (`?tfStagePanel=1` / localStorage `tfStagePanel`).
// With the flag ON both surfaces are mounted in ONE session against the SAME
// live document, so the parity comparisons below measure the rail and the
// panel in the SAME DOM at the SAME time.
//
// Launches only through the canonical launchApp helper. Captures exactly TWO
// screenshots: screenshots/phase36-chunk2-rail.png (flag off) and
// screenshots/phase36-chunk2-panel.png (flag on).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const RAIL_SHOT = path.join(SHOTS, 'phase36-chunk2-rail.png');
const PANEL_SHOT = path.join(SHOTS, 'phase36-chunk2-panel.png');

const RAIL = '.side-rail';
const PANEL = '[data-context-panel="pages"]';
const FLAG = 'tfStagePanel';

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(200);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p36-chunk2-pages');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function enableFlag() {
  await win.evaluate((key) => {
    try { localStorage.setItem(key, '1'); } catch (_) { /* ignore */ }
  }, FLAG);
}

async function openDoc(name) {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector(`${RAIL} .thumb-item`, { timeout: 30000 });
  await win.waitForTimeout(1500);
}

async function openReport() {
  await openDoc('report.pdf');
}

// Scroll the canvas so the requested page is the current page. Steps through
// the virtualized slots (the target slot may not be mounted yet), then aligns
// the slot top to the viewport top — the landing contract mixedPageAtScrollTop
// documents (a `-100` nudge lands one page short).
async function scrollCanvasTo(n) {
  for (let i = 0; i < 60; i += 1) {
    const done = await win.evaluate((want) => {
      const sc = document.querySelector('.document-scroller');
      if (!sc) return false;
      const slot = document.querySelector(`.page-slot[data-page="${want}"]`);
      if (!slot) {
        sc.scrollTop += 1500;
        return false;
      }
      sc.scrollTop = slot.offsetTop;
      return true;
    }, n);
    await win.waitForTimeout(250);
    if (done) break;
  }
  await win.waitForTimeout(900);
}

async function engine() {
  return win.evaluate(() => {
    const d = window.tflexDiagnostics();
    const e = d.engineState || {};
    return {
      pageCount: d.pageCount,
      currentPage: d.currentPage,
      modified: d.modified,
      pageOrder: Array.isArray(e.pageOrder) ? e.pageOrder : null,
      rotations: Array.isArray(e.rotations) ? e.rotations : null,
    };
  });
}

// Measure one surface (the rail or the panel): every mounted `.thumb-item`
// (all pageCount exist; virtualization only controls which are painted),
// its geometry, its painted-canvas ink sample and its state classes.
async function measure(sel) {
  return win.evaluate((rootSel) => {
    const root = document.querySelector(rootSel);
    if (root === null) return null;
    const scroller = root.querySelector('.thumb-scroller-inner');
    const sr = scroller ? scroller.getBoundingClientRect() : null;
    const scrollTop = scroller ? scroller.scrollTop : 0;
    const thumbs = [...root.querySelectorAll('.thumb-item')].map((el) => {
      const wrap = el.querySelector('.thumb-canvas-wrap');
      const canvas = el.querySelector('canvas.thumb-canvas');
      const r = el.getBoundingClientRect();
      let ink = null;
      let cw = 0;
      let ch = 0;
      if (canvas && canvas.width > 0 && canvas.height > 0) {
        cw = canvas.width;
        ch = canvas.height;
        try {
          const ctx = canvas.getContext('2d');
          const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let n = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) n += 1;
          }
          ink = n;
        } catch (_) {
          ink = -1;
        }
      }
      const cl = el.className;
      return {
        page: Number(el.getAttribute('data-page')),
        source: Number(el.getAttribute('data-source-page')),
        cls: cl,
        painted: cw > 0 && ch > 0 && !el.querySelector('.thumb-placeholder'),
        cw,
        ch,
        ink,
        wrapW: wrap ? Math.round(wrap.getBoundingClientRect().width) : null,
        wrapH: wrap ? Math.round(wrap.getBoundingClientRect().height) : null,
        top: sr ? Math.round(r.top - sr.top + scrollTop) : Math.round(r.top),
        visible: sr
          ? r.top + r.height / 2 >= sr.top && r.top + r.height / 2 <= sr.bottom
          : false,
        current: cl.includes('thumb-current'),
        selected: cl.includes('thumb-selected'),
      };
    });
    return {
      count: thumbs.length,
      thumbs,
      scrollerH: sr ? Math.round(sr.height) : null,
      dropLines: root.querySelectorAll('[data-thumb-drop-line]').length,
    };
  }, sel);
}

function paintedPages(m) {
  return m.thumbs.filter((t) => t.painted).map((t) => t.page);
}

function visiblePages(m) {
  return m.thumbs.filter((t) => t.visible).map((t) => t.page);
}

function byPage(m) {
  const map = new Map();
  for (const t of m.thumbs) map.set(t.page, t);
  return map;
}

// Synthetic HTML5 drag with a real DataTransfer, held across evaluate calls so
// the mid-drag drop indicator can be read before the drop commits.
async function dragStep(step, arg) {
  return win.evaluate(({ step: s, arg: a }) => {
    const KEY = '__p36dt';
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
    if (s === 'over' || s === 'drop') {
      const tgt = document.querySelector(a.tgt);
      if (!tgt) return { ok: false, reason: 'no-tgt' };
      const r = tgt.getBoundingClientRect();
      const ev = new DragEvent(s === 'over' ? 'dragover' : 'drop', {
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

// Scale-normalised 12x16 grey raster of one painted thumbnail canvas.
async function sigs(sel) {
  return win.evaluate((rootSel) => {
    const root = document.querySelector(rootSel);
    if (root === null) return {};
    const out = {};
    for (const el of root.querySelectorAll('.thumb-item')) {
      const canvas = el.querySelector('canvas.thumb-canvas');
      const page = Number(el.getAttribute('data-page'));
      if (!canvas || canvas.width === 0 || canvas.height === 0) continue;
      const W = 12;
      const H = 16;
      const off = document.createElement('canvas');
      off.width = W;
      off.height = H;
      const ctx = off.getContext('2d', { alpha: false });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, W, H);
      ctx.drawImage(canvas, 0, 0, W, H);
      const d = ctx.getImageData(0, 0, W, H).data;
      const arr = [];
      for (let i = 0; i < d.length; i += 4) arr.push(Math.round((d[i] + d[i + 1] + d[i + 2]) / 3));
      out[page] = arr;
    }
    return out;
  }, sel);
}

function sigDiff(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += Math.abs(a[i] - b[i]);
  return Number((s / a.length).toFixed(2));
}

function table(label, rail, panel) {
  console.log(`[P36C2] === ${label} ===`);
  console.log(`[P36C2] rail  : count=${rail ? rail.count : 'n/a'} scrollerH=${rail ? rail.scrollerH : 'n/a'} painted=${rail ? JSON.stringify(paintedPages(rail)) : 'n/a'}`);
  console.log(`[P36C2] panel : count=${panel ? panel.count : 'n/a'} scrollerH=${panel ? panel.scrollerH : 'n/a'} painted=${panel ? JSON.stringify(paintedPages(panel)) : 'n/a'}`);
}

// ---------------------------------------------------------------------------
// A. Flag OFF — the default app renders NOTHING new and the rail is untouched.
// ---------------------------------------------------------------------------
test('P36C2-A flag OFF: no panel / verbs / menu; the existing rail is untouched', async () => {
  await openDoc('scanned.pdf');

  expect(await win.locator('[data-context-panel]').count(), 'no ContextPanel by default').toBe(0);
  expect(await win.locator('[data-context-panel-dev-mount]').count(), 'no dev-mount marker').toBe(0);
  expect(await win.locator('[data-thumb-verbs]').count(), 'no hover verbs by default').toBe(0);
  expect(await win.locator('[data-context-menu]').count(), 'no right-click menu by default').toBe(0);
  expect(await win.locator('[data-context-panel-combine]').count(), 'no Combine by default').toBe(0);

  const rail = await measure(RAIL);
  expect(rail, 'the existing rail renders').not.toBeNull();
  expect(rail.count).toBe(6);
  expect(rail.thumbs.map((t) => t.page)).toEqual(Array.from({ length: 6 }, (_, i) => i + 1));
  // A real preview is painted (non-zero backing store + ink), never a placeholder.
  const painted = rail.thumbs.filter((t) => t.painted);
  expect(painted.length, 'at least one rail preview painted').toBeGreaterThan(0);
  for (const t of painted) expect(t.ink, `rail page ${t.page} has real ink`).toBeGreaterThan(0);
  await expect(win.locator(`${RAIL} .thumb-current`)).toHaveAttribute('data-page', '1');
  console.log(`[P36C2-A] flag OFF rail: count=${rail.count} painted=${JSON.stringify(paintedPages(rail))}`);

  await win.waitForTimeout(400);
  await win.screenshot({ path: RAIL_SHOT });
  console.log(`[P36C2-A] screenshot: ${RAIL_SHOT}`);
});

// ---------------------------------------------------------------------------
// B1. Flag ON — the rail and panel side by side: LIVE previews + GEOMETRY.
// ---------------------------------------------------------------------------
test('P36C2-B1 parity: live previews and thumbnail geometry match on both surfaces', async () => {
  await enableFlag();
  // Same fixture/page as the flag-OFF screenshot (P36C2-A). No outline, so the
  // screenshot also shows the panel's hover affordances cleanly (DEF-310's
  // outline overlay would cover them on report.pdf).
  await openDoc('scanned.pdf');

  await expect(win.locator(PANEL)).toBeVisible();
  await expect(win.locator(RAIL)).toBeVisible();
  await expect(win.locator(PANEL)).toHaveAttribute('data-context-panel-dev', 'true');
  await expect(win.locator(`${PANEL} .glass-sidebar-title`)).toHaveText('Pages · 6');
  expect(await win.locator('[data-context-panel-dev-badge]').count()).toBe(1);

  const rail = await measure(RAIL);
  const panel = await measure(PANEL);
  table('B1 previews + geometry', rail, panel);

  // Same live page count and same ascending order on both.
  expect(panel.count).toBe(rail.count);
  expect(rail.count).toBe(6);
  expect(panel.thumbs.map((t) => t.page)).toEqual(rail.thumbs.map((t) => t.page));

  // LIVE RENDERED: every VISIBLE thumbnail on each surface has a painted
  // canvas with real ink; nothing visible is a bare placeholder.
  for (const [name, m] of [['rail', rail], ['panel', panel]]) {
    const vis = m.thumbs.filter((t) => t.visible);
    expect(vis.length, `${name} has visible thumbs`).toBeGreaterThan(0);
    for (const t of vis) {
      expect(t.painted, `${name} visible page ${t.page} is painted (not a placeholder)`).toBe(true);
      expect(t.ink, `${name} visible page ${t.page} shows real ink`).toBeGreaterThan(0);
    }
    console.log(`[P36C2-B1] ${name} visible pages = ${JSON.stringify(vis.map((t) => t.page))}`);
  }

  // GEOMETRY: identical wrap width/height and slot tops for every page,
  // measured on both surfaces in the same session.
  const rMap = byPage(rail);
  const pMap = byPage(panel);
  let mismatches = 0;
  for (const page of rMap.keys()) {
    const r = rMap.get(page);
    const p = pMap.get(page);
    expect(p, `panel has page ${page}`).toBeTruthy();
    if (r.wrapW !== p.wrapW || r.wrapH !== p.wrapH || Math.abs(r.top - p.top) > 1) {
      mismatches += 1;
      console.log(`[P36C2-B1] GEOM MISMATCH page ${page}: rail wrap=${r.wrapW}x${r.wrapH} top=${r.top} vs panel wrap=${p.wrapW}x${p.wrapH} top=${p.top}`);
    }
  }
  expect(mismatches, 'wrap width/height and slot tops identical on both surfaces').toBe(0);
  // Same canvas width chosen by both (the same rail geometry).
  expect(panel.thumbs[0].wrapW).toBe(rail.thumbs[0].wrapW);
  console.log(`[P36C2-B1] geometry: thumbWidth=${rail.thumbs[0].wrapW} wrapH(page1)=${rail.thumbs[0].wrapH} railTops=panelTops (all ${rail.count} pages)`);

  // The flag-ON screenshot: both surfaces mounted side by side on the same
  // pristine document/page, with a panel thumbnail hovered so the inline
  // verbs are visible for the design-language comparison.
  await win.locator(`${PANEL} .thumb-item[data-page="2"]`).hover();
  await win.waitForTimeout(600);
  await win.screenshot({ path: PANEL_SHOT });
  console.log(`[P36C2-B1] screenshot: ${PANEL_SHOT}`);

  const layout = await win.evaluate((panel) => {
    const rr = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const root = document.querySelector(panel);
    return {
      panel: rr(root),
      body: rr(root.querySelector('.glass-sidebar-body')),
      thumbs: rr(root.querySelector('.context-panel-thumbs')),
      inner: rr(root.querySelector('.thumb-scroller-inner')),
      outline: rr(root.querySelector('.context-panel-outline')),
      outlineBody: rr(root.querySelector('.context-panel-outline-body')),
      toggle: rr(root.querySelector('[data-outline-toggle]')),
      thumb1: rr(root.querySelector('.thumb-item[data-page="1"]')),
      links: [...root.querySelectorAll('.outline-link')].slice(0, 3).map(rr),
      linkCount: root.querySelectorAll('.outline-link').length,
      outlineScrollH: (() => {
        const el = root.querySelector('.context-panel-outline-body');
        return el ? { scrollH: el.scrollHeight, clientH: el.clientHeight, overY: getComputedStyle(el).overflowY } : null;
      })(),
    };
  }, PANEL);
  console.log(`[P36C2-B1] panel layout: ${JSON.stringify(layout)}`);

  // Header fit probe (cosmetic): the title is `white-space: nowrap` +
  // `text-overflow: ellipsis`, so it truncates when the DEV badge + Combine
  // squeeze it. Report the header's available title width vs the title's
  // natural width at the 220px dev width, and the same arithmetic for the
  // final 200px panel width (where the DEV badge is gone).
  const header = await win.evaluate((panel) => {
    const root = document.querySelector(panel);
    const h = root.querySelector('.glass-sidebar-header');
    const title = root.querySelector('.glass-sidebar-title');
    const actions = root.querySelector('.context-panel-actions');
    const badge = root.querySelector('[data-context-panel-dev-badge]');
    const combine = root.querySelector('[data-context-panel-combine]');
    const rr = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height) };
    };
    const cs = h ? getComputedStyle(h) : null;
    return {
      headerW: h ? Math.round(h.getBoundingClientRect().width) : null,
      headerPadL: cs ? parseFloat(cs.paddingLeft) : null,
      headerPadR: cs ? parseFloat(cs.paddingRight) : null,
      headerGap: cs ? parseFloat(cs.columnGap || cs.gap) : null,
      titleClientW: title ? title.clientWidth : null,
      titleScrollW: title ? title.scrollWidth : null,
      titleTruncated: title ? title.scrollWidth > title.clientWidth + 1 : null,
      titleText: title ? title.textContent : null,
      actions: rr(actions),
      badge: rr(badge),
      combine: rr(combine),
    };
  }, PANEL);
  console.log(`[P36C2-B1] header fit: ${JSON.stringify(header)}`);
});

// ---------------------------------------------------------------------------
// B2. Flag ON — engine-state reflection: rotate + delete, both surfaces.
// ---------------------------------------------------------------------------
test('P36C2-B2 parity: rotate and delete re-render BOTH surfaces', async () => {
  await enableFlag();
  await openReport();

  // Rotate page 1 via the EXISTING toolbar control.
  await win.locator('[data-toolbar-rotate-cw]').first().click();
  await expect.poll(async () => win.locator(`${PANEL} .thumb-item[data-page="1"]`).getAttribute('class'), { timeout: 20000 })
    .toContain('thumb-rot-90');
  await expect.poll(async () => win.locator(`${RAIL} .thumb-item[data-page="1"]`).getAttribute('class'), { timeout: 20000 })
    .toContain('thumb-rot-90');
  const rot = await win.evaluate(({ panel }) => {
    const p = document.querySelector(`${panel} .thumb-item[data-page="1"]`);
    const r = document.querySelector('.side-rail .thumb-item[data-page="1"]');
    return { panel: p ? p.className : null, rail: r ? r.className : null };
  }, { panel: PANEL });
  console.log(`[P36C2-B2] after rotate page1: panel="${rot.panel}" rail="${rot.rail}"`);
  expect(rot.panel).toContain('thumb-rot-90');
  expect(rot.rail).toContain('thumb-rot-90');

  // Delete page 3 from the RAIL's own selection action bar (the rail path).
  await win.locator(`${RAIL} .thumb-item[data-page="3"]`).click({ modifiers: ['Control'] });
  await expect(win.locator(`${RAIL} [data-rail-action-bar="3"]`)).toBeVisible();
  await win.locator(`${RAIL} [data-rail-action-bar="3"] button[aria-label="Delete this page"]`).click();

  await expect.poll(async () => (await engine()).pageCount, { timeout: 30000 }).toBe(33);
  await expect.poll(async () => win.locator(`${PANEL} .thumb-item`).count(), { timeout: 30000 }).toBe(33);
  await expect.poll(async () => win.locator(`${RAIL} .thumb-item`).count(), { timeout: 30000 }).toBe(33);
  await expect(win.locator(`${PANEL} .glass-sidebar-title`)).toHaveText('Pages · 33');

  const rail = await measure(RAIL);
  const panel = await measure(PANEL);
  table('B2 after delete', rail, panel);
  expect(panel.thumbs.map((t) => t.page)).toEqual(rail.thumbs.map((t) => t.page));
  expect(panel.thumbs.map((t) => t.page)).toEqual(Array.from({ length: 33 }, (_, i) => i + 1));
  const e = await engine();
  expect(e.pageCount).toBe(33);
  expect(e.rotations[0]).toBe(1);
});

// ---------------------------------------------------------------------------
// B3. Flag ON — drag-reorder (both surfaces), scroll sync, current highlight
//     and today's selection behaviour.
// ---------------------------------------------------------------------------
test('P36C2-B3 parity: drag-reorder, drop line, scroll sync and selection', async () => {
  await enableFlag();
  // scanned.pdf (6 pages) has NO outline, so it isolates the thumbnail
  // behaviours from the DEF-310 outline-overlay defect (which blocks pointer
  // input across the panel body on report.pdf — see P36C2-E). The rail and
  // panel are still compared side by side in the SAME session.
  await openDoc('scanned.pdf');

  // --- drag in the RAIL: the drop line shows there; both surfaces re-order.
  const before = (await engine()).pageOrder;
  const sigBefore = await sigs(RAIL);
  await dragStep('start', { src: `${RAIL} .thumb-item[data-page="1"]` });
  await win.waitForTimeout(200);
  const over = await dragStep('over', { tgt: `${RAIL} .thumb-item[data-page="3"]` });
  expect(over.ok, 'rail dragover accepted').toBe(true);
  await win.waitForTimeout(300);
  expect(await win.locator(`${RAIL} [data-thumb-drop-line]`).count(), 'rail drop line appears mid-drag').toBeGreaterThan(0);
  await dragStep('drop', { tgt: `${RAIL} .thumb-item[data-page="3"]` });
  await win.waitForTimeout(300);
  await dragStep('end', { src: `${RAIL} .thumb-item[data-page="1"]` });
  await expect.poll(async () => JSON.stringify((await engine()).pageOrder), { timeout: 20000 }).not.toBe(JSON.stringify(before));
  await win.waitForTimeout(1800);
  const railSigs1 = await sigs(RAIL);
  const panelSigs1 = await sigs(PANEL);
  let matched = 0;
  let maxDiff = 0;
  for (const p of Object.keys(railSigs1)) {
    if (panelSigs1[p] === undefined) continue;
    const d = sigDiff(railSigs1[p], panelSigs1[p]);
    if (d === null) continue;
    matched += 1;
    maxDiff = Math.max(maxDiff, d);
  }
  console.log(`[P36C2-B3] rail drag: pageOrder ${JSON.stringify(before.slice(0, 6))} -> ${JSON.stringify((await engine()).pageOrder.slice(0, 6))}`);
  console.log(`[P36C2-B3] rail drag: signatures compared on ${matched} pages, max diff ${maxDiff}; slot1 before/after diff ${sigDiff(sigBefore[1], railSigs1[1])}`);
  expect(matched, 'both surfaces painted the same pages after the rail drag').toBeGreaterThan(2);
  expect(maxDiff, 'both surfaces render identical rasters after the rail drag').toBeLessThan(5);

  // --- drag in the PANEL: drop line shows there; both surfaces re-order.
  const before2 = (await engine()).pageOrder;
  await dragStep('start', { src: `${PANEL} .thumb-item[data-page="1"]` });
  await win.waitForTimeout(200);
  await dragStep('over', { tgt: `${PANEL} .thumb-item[data-page="3"]` });
  await win.waitForTimeout(300);
  expect(await win.locator(`${PANEL} [data-thumb-drop-line]`).count(), 'panel drop line appears mid-drag').toBeGreaterThan(0);
  await dragStep('drop', { tgt: `${PANEL} .thumb-item[data-page="3"]` });
  await win.waitForTimeout(300);
  await dragStep('end', { src: `${PANEL} .thumb-item[data-page="1"]` });
  await expect.poll(async () => JSON.stringify((await engine()).pageOrder), { timeout: 20000 }).not.toBe(JSON.stringify(before2));
  await win.waitForTimeout(1800);
  const railSigs2 = await sigs(RAIL);
  const panelSigs2 = await sigs(PANEL);
  let matched2 = 0;
  let maxDiff2 = 0;
  for (const p of Object.keys(panelSigs2)) {
    if (railSigs2[p] === undefined) continue;
    const d = sigDiff(panelSigs2[p], railSigs2[p]);
    if (d === null) continue;
    matched2 += 1;
    maxDiff2 = Math.max(maxDiff2, d);
  }
  console.log(`[P36C2-B3] panel drag: pageOrder ${JSON.stringify(before2.slice(0, 6))} -> ${JSON.stringify((await engine()).pageOrder.slice(0, 6))}`);
  console.log(`[P36C2-B3] panel drag: signatures compared on ${matched2} pages, max diff ${maxDiff2}`);
  expect(matched2, 'both surfaces painted the same pages after the panel drag').toBeGreaterThan(2);
  expect(maxDiff2, 'both surfaces render identical rasters after the panel drag').toBeLessThan(5);

  // --- scroll sync: scrolling the canvas moves the highlight on BOTH.
  await scrollCanvasTo(5);
  await expect.poll(async () => (await engine()).currentPage, { timeout: 15000 }).toBe(5);
  await expect.poll(async () => win.locator(`${RAIL} .thumb-current`).getAttribute('data-page'), { timeout: 15000 }).toBe('5');
  await expect.poll(async () => win.locator(`${PANEL} .thumb-current`).getAttribute('data-page'), { timeout: 15000 }).toBe('5');
  console.log('[P36C2-B3] scroll sync: both highlights followed the canvas to page 5');

  // --- click a thumbnail in each surface; the canvas jumps on both.
  await win.locator(`${RAIL} .thumb-item[data-page="3"]`).click();
  await expect.poll(async () => (await engine()).currentPage, { timeout: 15000 }).toBe(3);
  await expect.poll(async () => win.locator(`${PANEL} .thumb-current`).getAttribute('data-page'), { timeout: 15000 }).toBe('3');
  await win.locator(`${PANEL} .thumb-item[data-page="5"]`).click();
  await expect.poll(async () => (await engine()).currentPage, { timeout: 15000 }).toBe(5);
  await expect.poll(async () => win.locator(`${RAIL} .thumb-current`).getAttribute('data-page'), { timeout: 15000 }).toBe('5');
  console.log('[P36C2-B3] thumb click: rail->3 and panel->5 both moved the canvas');

  // --- today's selection behaviour (single-select): PLAIN click navigates and
  //     does NOT select; a modifier click selects without navigating.
  await win.locator(`${PANEL} .thumb-item[data-page="2"]`).click();
  expect(await win.locator(`${PANEL} .thumb-selected`).count(), 'panel plain click does not select').toBe(0);
  expect(await win.locator(`${RAIL} .thumb-selected`).count(), 'rail plain click does not select').toBe(0);
  await expect.poll(async () => (await engine()).currentPage, { timeout: 15000 }).toBe(2);
  // Let the canvas smooth-scroll settle before measuring "no navigation"
  // (mid-flight the scroll heuristic can transiently report a passed page).
  await win.waitForTimeout(1500);
  const settledPage = (await engine()).currentPage;
  await win.locator(`${RAIL} .thumb-item[data-page="3"]`).click({ modifiers: ['Control'] });
  await expect(win.locator(`${RAIL} .thumb-selected`)).toHaveAttribute('data-page', '3');
  await win.waitForTimeout(600);
  expect((await engine()).currentPage, 'modifier select does not navigate').toBe(settledPage);
  await win.locator(`${PANEL} .thumb-item[data-page="4"]`).click({ modifiers: ['Control'] });
  await expect(win.locator(`${PANEL} .thumb-selected`)).toHaveAttribute('data-page', '4');
  console.log('[P36C2-B3] selection: plain click = navigate (no select) on BOTH; modifier click = single-select on BOTH; deferred multi-select untouched');
});

// Close whatever dialog is open (Escape, then the modal close button).
async function closeDialog(sel) {
  await win.keyboard.press('Escape');
  try {
    await win.locator(sel).first().waitFor({ state: 'detached', timeout: 4000 });
    return;
  } catch (_) { /* fall through to the close button */ }
  await win.locator(`${sel} button[aria-label="Close dialog"]`).first().click({ timeout: 4000 }).catch(() => {});
  await win.locator(sel).first().waitFor({ state: 'detached', timeout: 6000 });
}

// Right-click the panel's thumb for `page` and return the menu locator. The
// thumb is scrolled into view FIRST (and settled) because the panel dismisses
// its menu on any scroll; letting Playwright scroll during the click would
// close the menu the instant it opens.
async function openPageMenu(page) {
  const thumb = win.locator(`${PANEL} .thumb-item[data-page="${page}"]`).first();
  await thumb.scrollIntoViewIfNeeded();
  await win.waitForTimeout(250);
  await thumb.click({ button: 'right' });
  await win.waitForSelector('[data-context-menu]', { timeout: 8000 });
  return win.locator('[data-context-menu]');
}

// ---------------------------------------------------------------------------
// C. Panel-only — the inline hover verbs.
// ---------------------------------------------------------------------------
test('P36C2-C hover verbs: reveal, right action for the right page, no select/jump/drag', async () => {
  await enableFlag();
  // No-outline fixture so the verb clicks are not blocked by the DEF-310
  // outline overlay (report.pdf would intercept every panel-body pointer).
  await openDoc('scanned.pdf');

  const verbs = win.locator(`${PANEL} .thumb-item[data-page="2"] [data-thumb-verbs]`);
  await expect(verbs).toHaveCount(1);
  // Hidden until hover.
  const before = await verbs.evaluate((el) => ({ opacity: getComputedStyle(el).opacity, pe: getComputedStyle(el).pointerEvents }));
  expect(Number(before.opacity), 'verbs hidden before hover').toBe(0);
  await win.locator(`${PANEL} .thumb-item[data-page="2"]`).hover();
  await expect.poll(async () => verbs.evaluate((el) => getComputedStyle(el).opacity), { timeout: 5000 }).toBe('1');
  const after = await verbs.evaluate((el) => getComputedStyle(el).pointerEvents);
  expect(after).toBe('auto');
  console.log(`[P36C2-C] verbs reveal on hover: opacity ${before.opacity}->${after}, pointer-events ${before.pe}->auto`);

  const irBefore = (await engine()).currentPage;

  // rotate-CW verb on page 2 rotates page 2 ONLY, without select/jump/drag.
  await win.locator(`${PANEL} .thumb-item[data-page="2"] [data-thumb-verb="rotate-cw"]`).click();
  await expect.poll(async () => win.locator(`${PANEL} .thumb-item[data-page="2"]`).getAttribute('class'), { timeout: 20000 })
    .toContain('thumb-rot-90');
  expect(await win.locator(`${PANEL} .thumb-item[data-page="1"]`).getAttribute('class')).not.toContain('thumb-rot-90');
  expect(await win.locator(`${PANEL} .thumb-selected`).count(), 'verb click does not select').toBe(0);
  expect((await engine()).currentPage, 'verb click does not jump the canvas').toBe(irBefore);
  expect(await win.locator(`${PANEL} .thumb-dragging`).count(), 'verb click does not start a drag').toBe(0);
  console.log(`[P36C2-C] rotate-CW verb on page 2 -> page2 only rotated; no select/jump/drag (currentPage=${irBefore})`);

  // extract verb on page 4 opens the EXISTING extract/split dialog.
  await win.locator(`${PANEL} .thumb-item[data-page="4"] [data-thumb-verb="extract"]`).click();
  await win.waitForSelector('#split-dialog-title', { timeout: 8000 });
  await expect(win.locator('#split-dialog-title')).toHaveText('Extract or split pages');
  await closeDialog('#split-dialog-title');
  console.log('[P36C2-C] extract verb on page 4 opened the extract/split dialog');

  // drag guard: a press that starts on a verb must not start a page drag.
  const orderBefore = JSON.stringify((await engine()).pageOrder);
  const guard = await win.evaluate(({ panel }) => {
    const thumb = document.querySelector(`${panel} .thumb-item[data-page="4"]`);
    const glyph = thumb.querySelector('[data-thumb-verb="rotate-cw"] svg');
    glyph.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    const dt = new DataTransfer();
    window.__p36guard = dt;
    thumb.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return { dragging: thumb.className.includes('thumb-dragging') };
  }, { panel: PANEL });
  expect(guard.dragging, 'a press on a verb never starts a page drag').toBe(false);
  const dropped = await win.evaluate(({ panel }) => {
    const dt = window.__p36guard;
    const tgt = document.querySelector(`${panel} .thumb-item[data-page="2"]`);
    const r = tgt.getBoundingClientRect();
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + r.width / 2, clientY: r.top + r.height / 4 });
    tgt.dispatchEvent(ev);
    return { prevented: ev.defaultPrevented };
  }, { panel: PANEL });
  await win.waitForTimeout(600);
  console.log(`[P36C2-C] verb drag guard: dragging=${guard.dragging} drop.prevented=${dropped.prevented}`);
  expect(JSON.stringify((await engine()).pageOrder), 'verb-origin drag did not reorder').toBe(orderBefore);

  // delete verb on page 2 is an IMMEDIATE delete (no dialog).
  const sigBefore = await sigs(PANEL);
  await win.locator(`${PANEL} .thumb-item[data-page="2"] [data-thumb-verb="delete"]`).click();
  await expect.poll(async () => (await engine()).pageCount, { timeout: 30000 }).toBe(5);
  expect(await win.locator('[data-delete-pages-dialog]').count(), 'trash verb does not open a dialog').toBe(0);
  await win.waitForTimeout(1500);
  const sigAfter = await sigs(PANEL);
  expect(await win.locator(`${PANEL} .thumb-item`).count()).toBe(5);
  const shift = sigDiff(sigAfter[2], sigBefore[3]);
  console.log(`[P36C2-C] delete verb on page 2: count 6->5; slot2 now shows the old slot3 raster (diff ${shift})`);
  expect(shift, 'slot 2 became the old page 3 (right page deleted)').not.toBeNull();
  expect(shift, 'slot 2 became the old page 3 (right page deleted)').toBeLessThan(5);
});

// ---------------------------------------------------------------------------
// D. Panel-only — the right-click menu's seven items.
// ---------------------------------------------------------------------------
test('P36C2-D right-click menu: seven items, each does what its label promises', async () => {
  await enableFlag();
  // No-outline fixture so the menu gestures are not blocked by the DEF-310
  // outline overlay.
  await openDoc('scanned.pdf');

  const menu = await openPageMenu(2);
  expect(await menu.getAttribute('data-page')).toBe('2');
  const labels = await win.$$eval('[data-context-menu] [data-menu-item]', (els) => els.map((e) => e.textContent.trim()));
  expect(labels).toEqual(['Rotate CW', 'Rotate CCW', 'Extract…', 'Insert blank after', 'Replace…', 'Renumber…', 'Delete…']);
  console.log(`[P36C2-D] menu items: ${JSON.stringify(labels)}`);

  // "Insert blank after" is IMMEDIATE: count +1, a new blank at that position,
  // and no Insert-pages dialog.
  await win.locator('[data-context-menu] [data-menu-item="insert-blank"]').click();
  await expect.poll(async () => (await engine()).pageCount, { timeout: 30000 }).toBe(7);
  expect(await win.locator('[data-insert-pages-dialog]').count(), 'no insert dialog for the immediate insert').toBe(0);
  await expect.poll(async () => {
    const m = await measure(PANEL);
    const t = m.thumbs.find((x) => x.page === 3);
    return t && t.painted ? t.ink : -1;
  }, { timeout: 30000 }).toBeLessThan(100);
  const mAfter = await measure(PANEL);
  const t1 = mAfter.thumbs.find((x) => x.page === 1);
  const t3 = mAfter.thumbs.find((x) => x.page === 3);
  expect(t1.ink, 'page 1 still has content').toBeGreaterThan(0);
  console.log(`[P36C2-D] Insert blank after page 2: pageCount 6->7; new blank at visible page 3 (ink=${t3.ink})`);

  // "Delete…" opens the EXISTING dialog SEEDED with the clicked page.
  const m2 = await openPageMenu(2);
  expect(await m2.getAttribute('data-page')).toBe('2');
  await win.locator('[data-context-menu] [data-menu-item="delete"]').click();
  await win.waitForSelector('[data-delete-pages-dialog]', { timeout: 8000 });
  const dlgText = await win.locator('[data-delete-pages-dialog]').innerText();
  expect(dlgText, 'delete dialog seeded with the clicked page').toContain('Current page (2)');
  console.log('[P36C2-D] Delete… opened the delete dialog seeded with page 2 (no immediate delete)');
  await closeDialog('[data-delete-pages-dialog]');
  expect((await engine()).pageCount, 'closing the seeded dialog did not delete').toBe(7);

  // Rotate CW item rotates the clicked page.
  await openPageMenu(4);
  await win.locator('[data-context-menu] [data-menu-item="rotate-cw"]').click();
  await expect.poll(async () => win.locator(`${PANEL} .thumb-item[data-page="4"]`).getAttribute('class'), { timeout: 20000 })
    .toContain('thumb-rot-90');
  console.log('[P36C2-D] Rotate CW item rotated page 4');

  // Extract… / Replace… / Renumber… open their EXISTING dialogs.
  await openPageMenu(4);
  await win.locator('[data-context-menu] [data-menu-item="extract"]').click();
  await win.waitForSelector('#split-dialog-title', { timeout: 8000 });
  await closeDialog('#split-dialog-title');
  console.log('[P36C2-D] Extract… opened the extract/split dialog');

  await openPageMenu(4);
  await win.locator('[data-context-menu] [data-menu-item="replace"]').click();
  await win.waitForSelector('[data-replace-pages-dialog]', { timeout: 8000 });
  await closeDialog('[data-replace-pages-dialog]');
  console.log('[P36C2-D] Replace… opened the replace dialog');

  await openPageMenu(4);
  await win.locator('[data-context-menu] [data-menu-item="renumber"]').click();
  await win.waitForSelector('[data-renumber-pages-dialog]', { timeout: 8000 });
  await closeDialog('[data-renumber-pages-dialog]');
  console.log('[P36C2-D] Renumber… opened the renumber dialog');

  // Selecting an item closes the menu.
  expect(await win.locator('[data-context-menu]').count()).toBe(0);
});

// ---------------------------------------------------------------------------
// E. Panel-only — Combine entry + the outline section.
// ---------------------------------------------------------------------------
test('P36C2-E Combine opens the merge dialog; the outline section toggles and navigates', async () => {
  await enableFlag();
  await openReport();

  await win.locator('[data-context-panel-combine]').click();
  await win.waitForSelector('[data-merge-pick]', { timeout: 8000 });
  console.log('[P36C2-E] Combine… opened the EXISTING merge dialog');
  await closeDialog('[data-merge-pick]');

  const outline = win.locator(`${PANEL} [data-context-panel-outline]`);
  await expect(outline).toBeVisible();
  const linkCount = await win.locator(`${PANEL} .outline-link`).count();
  expect(linkCount).toBeGreaterThan(0);
  console.log(`[P36C2-E] outline links: ${linkCount}`);

  // DEF-310 — the re-parented outline must live INSIDE its collapsible section
  // (below the thumbnail stack). `.outline-panel` is `position:absolute;
  // inset:0` and the new `.context-panel-outline-body` wrapper is not a
  // positioning context, so the tree escapes to the panel body: the links
  // paint over the thumbnails (y96..162 vs thumb1 y120) and the toggle is
  // covered by it. These two assertions state the required layout.
  const geom = await win.evaluate((panel) => {
    const rr = (el) => {
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) };
    };
    const root = document.querySelector(panel);
    const body = root.querySelector('.context-panel-outline-body');
    const bodyR = body ? rr(body) : null;
    const links = [...root.querySelectorAll('.outline-link')].map(rr);
    const thumb = root.querySelector('.thumb-item[data-page="1"]');
    const thumbR = thumb ? rr(thumb) : null;
    return {
      bodyR,
      thumbR,
      firstLink: links[0] || null,
      linkCount: links.length,
      inside: bodyR ? links.every((l) => l.y >= bodyR.y - 1 && l.bottom <= bodyR.bottom + 1) : false,
      overlapThumbs: thumbR ? links.some((l) => l.y < thumbR.bottom && l.bottom > thumbR.y) : false,
    };
  }, PANEL);
  console.log(`[P36C2-E] outline geometry: ${JSON.stringify(geom)}`);
  expect(geom.inside, 'DEF-310: outline links must render inside the outline section').toBe(true);
  expect(geom.overlapThumbs, 'DEF-310: outline must not overlap the thumbnail stack').toBe(false);

  const toggle = win.locator(`${PANEL} [data-outline-toggle]`);
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  // Short timeout: DEF-310 covers the toggle, so this fails fast with the
  // interception evidence rather than burning the full 30 s.
  await toggle.click({ timeout: 8000 });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(win.locator(`${PANEL} [data-context-panel-outline-body]`)).toHaveCount(0);
  await toggle.click();
  await expect(win.locator(`${PANEL} [data-context-panel-outline-body]`)).toHaveCount(1);
  console.log('[P36C2-E] outline section toggled closed and open');

  const before = (await engine()).currentPage;
  await win.locator(`${PANEL} .outline-link`).first().click();
  await expect.poll(async () => (await engine()).currentPage, { timeout: 15000 }).not.toBe(before);
  const after = (await engine()).currentPage;
  expect(after).toBeGreaterThan(1);
  console.log(`[P36C2-E] outline navigation: currentPage ${before} -> ${after}`);

  // DEF-310 — with the outline present, the panel body must not be
  // intercepted: a thumbnail click still jumps the canvas, and a hover verb
  // still fires. These are exactly the two gestures the defect blocked.
  const thumbBefore = (await engine()).currentPage;
  await win.locator(`${PANEL} .thumb-item[data-page="7"]`).click();
  await expect.poll(async () => (await engine()).currentPage, { timeout: 15000 }).toBe(7);
  console.log(`[P36C2-E] thumbnail click with outline present: currentPage ${thumbBefore} -> 7`);

  await win.locator(`${PANEL} .thumb-item[data-page="2"]`).hover();
  await win.locator(`${PANEL} .thumb-item[data-page="2"] [data-thumb-verb="rotate-cw"]`).click();
  await expect.poll(async () => win.locator(`${PANEL} .thumb-item[data-page="2"]`).getAttribute('class'), { timeout: 20000 })
    .toContain('thumb-rot-90');
  console.log('[P36C2-E] hover verb with outline present: page 2 rotated (not intercepted)');

  // Header fit on the outlined document (title `Pages · 34`): the widest
  // realistic title, so the ellipsis question is answered on the worst case.
  const header = await win.evaluate((panel) => {
    const root = document.querySelector(panel);
    const h = root.querySelector('.glass-sidebar-header');
    const title = root.querySelector('.glass-sidebar-title');
    const actions = root.querySelector('.context-panel-actions');
    const badge = root.querySelector('[data-context-panel-dev-badge]');
    const combine = root.querySelector('[data-context-panel-combine]');
    const rr = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height) };
    };
    const cs = h ? getComputedStyle(h) : null;
    return {
      headerW: h ? Math.round(h.getBoundingClientRect().width) : null,
      headerPadL: cs ? parseFloat(cs.paddingLeft) : null,
      headerPadR: cs ? parseFloat(cs.paddingRight) : null,
      headerGap: cs ? parseFloat(cs.columnGap || cs.gap) : null,
      titleClientW: title ? title.clientWidth : null,
      titleScrollW: title ? title.scrollWidth : null,
      titleTruncated: title ? title.scrollWidth > title.clientWidth + 1 : null,
      titleText: title ? title.textContent : null,
      actions: rr(actions),
      badge: rr(badge),
      combine: rr(combine),
    };
  }, PANEL);
  console.log(`[P36C2-E] header fit (report.pdf): ${JSON.stringify(header)}`);
});

