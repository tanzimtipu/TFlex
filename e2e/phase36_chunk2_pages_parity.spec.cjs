// Phase 36 (chunk 2, migrated at the chunk 6 gate) — the PAGES ContextPanel's
// own behaviour plus the panel-only chrome (hover verbs, right-click menu,
// Combine, outline).
//
// Chunk 2 originally mounted the panel ALONGSIDE the unchanged SideRail behind
// a temporary dev flag and asserted parity between the two. Chunk 6 PROMOTED
// the panel to the DEFAULT single-mode left slot and retired the rail and the
// flag (the panel IS the default — nothing to enable). These tests now assert
// the panel's own behaviour directly; the parity-with-the-rail comparisons are
// gone with their subject. The panel's selectors are unchanged.
//
// Launches only through the canonical launchApp helper. Captures ONE
// screenshot: screenshots/phase36-chunk2-panel.png.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

// The Paperclip harness exports ELECTRON_RUN_AS_NODE=1; launchApp spreads
// process.env into the Electron child, which then exits as plain Node before any
// window is observable. Drop it before any launch.
delete process.env.ELECTRON_RUN_AS_NODE;

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const PANEL_SHOT = path.join(SHOTS, 'phase36-chunk2-panel.png');

const PANEL = '[data-context-panel="pages"]';

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

async function openDoc(name) {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector(`${PANEL} .thumb-item`, { timeout: 30000 });
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

function table(label, panel) {
  console.log(`[P36C2] === ${label} ===`);
  console.log(`[P36C2] panel : count=${panel ? panel.count : 'n/a'} scrollerH=${panel ? panel.scrollerH : 'n/a'} painted=${panel ? JSON.stringify(paintedPages(panel)) : 'n/a'}`);
}

// ---------------------------------------------------------------------------
// A. The panel IS the default single-mode left slot: no dev markers, no rail,
//    and the panel chrome (verbs / menu / Combine) renders.
// ---------------------------------------------------------------------------
test('P36C2-A the panel is the default left slot; no dev markers, no rail; chrome present', async () => {
  await openDoc('scanned.pdf');

  expect(await win.locator(PANEL).count(), 'the PAGES panel is the default left slot').toBe(1);
  expect(await win.locator('[data-context-panel-dev-mount]').count(), 'no dev-mount marker').toBe(0);
  expect(await win.locator('[data-context-panel-dev-badge]').count(), 'no dev badge').toBe(0);
  expect(await win.locator('.side-rail').count(), 'the retired rail is not mounted in single mode').toBe(0);
  expect(await win.locator('[data-pane-strip]').count(), 'no Multi Mode pane strip in single mode').toBe(0);

  const panel = await measure(PANEL);
  expect(panel, 'the panel renders thumbs').not.toBeNull();
  expect(panel.count).toBe(6);
  expect(panel.thumbs.map((t) => t.page)).toEqual(Array.from({ length: 6 }, (_, i) => i + 1));
  // A real preview is painted (non-zero backing store + ink), never a placeholder.
  const painted = panel.thumbs.filter((t) => t.painted);
  expect(painted.length, 'at least one panel preview painted').toBeGreaterThan(0);
  for (const t of painted) expect(t.ink, `panel page ${t.page} has real ink`).toBeGreaterThan(0);
  await expect(win.locator(`${PANEL} .thumb-current`)).toHaveAttribute('data-page', '1');
  // The chrome exists (the per-card More is mounted; Phase 124 retired the
  // header's labelled More menu — the three tools are now direct icon buttons).
  expect(await win.locator(`${PANEL} .thumb-item[data-page="1"] [data-thumb-more]`).count()).toBe(1);
  await expect(win.locator('[data-context-panel-more]')).toHaveCount(0);
  await expect(win.locator('[data-context-panel-more-menu]')).toHaveCount(0);
  await expect(win.locator(`${PANEL} [data-context-panel-combine]`)).toHaveCount(1);
  console.log(`[P36C2-A] panel default: count=${panel.count} painted=${JSON.stringify(paintedPages(panel))}`);
});

// ---------------------------------------------------------------------------
// B1. The panel's live previews + thumbnail geometry.
// ---------------------------------------------------------------------------
test('P36C2-B1 live previews and thumbnail geometry', async () => {
  // scanned.pdf has NO outline, so the screenshot also shows the panel's hover
  // affordances cleanly (the outline section would sit below the thumbnails).
  await openDoc('scanned.pdf');

  await expect(win.locator(PANEL)).toBeVisible();
  // Phase 37 (item 15) — the PAGES header title is retired; the panel is
  // identified by its stage attribute and the thumbnail count below.
  expect(await win.locator(`${PANEL} .glass-sidebar-title`).count(), 'the retired Pages title is absent').toBe(0);

  const panel = await measure(PANEL);
  table('B1 previews + geometry', panel);

  expect(panel.count).toBe(6);
  expect(panel.thumbs.map((t) => t.page)).toEqual([1, 2, 3, 4, 5, 6]);

  // LIVE RENDERED: every VISIBLE thumbnail has a painted canvas with real ink;
  // nothing visible is a bare placeholder.
  const vis = panel.thumbs.filter((t) => t.visible);
  expect(vis.length, 'panel has visible thumbs').toBeGreaterThan(0);
  for (const t of vis) {
    expect(t.painted, `visible page ${t.page} is painted (not a placeholder)`).toBe(true);
    expect(t.ink, `visible page ${t.page} shows real ink`).toBeGreaterThan(0);
  }
  console.log(`[P36C2-B1] panel visible pages = ${JSON.stringify(vis.map((t) => t.page))}`);

  // GEOMETRY: every mounted thumb has a real wrap box and the slot tops ascend
  // with the page order (the stack is a single column).
  let prevTop = -Infinity;
  for (const t of panel.thumbs) {
    expect(t.wrapW, `page ${t.page} wrap width`).toBeGreaterThan(20);
    expect(t.wrapH, `page ${t.page} wrap height`).toBeGreaterThan(20);
    expect(t.top, `page ${t.page} top ascends`).toBeGreaterThan(prevTop);
    prevTop = t.top;
  }
  console.log(`[P36C2-B1] geometry: thumbWidth=${panel.thumbs[0].wrapW} wrapH(page1)=${panel.thumbs[0].wrapH} ascendingTops=true`);

  // The panel screenshot: hovered so the inline verbs are visible.
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
      toggle: rr(root.querySelector('[data-context-panel-view-tab="outline"]')),
      thumb1: rr(root.querySelector('.thumb-item[data-page="1"]')),
      links: [...root.querySelectorAll('.outline-link')].slice(0, 3).map(rr),
      linkCount: root.querySelectorAll('.outline-link').length,
    };
  }, PANEL);
  console.log(`[P36C2-B1] panel layout: ${JSON.stringify(layout)}`);

  // Header fit probe (cosmetic): the title is `white-space: nowrap` +
  // `text-overflow: ellipsis`, so it truncates if Combine squeezes it.
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
// B2. Engine-state reflection: rotate + delete re-render the panel.
// ---------------------------------------------------------------------------
test('P36C2-B2 rotate and delete re-render the panel', async () => {
  await openReport();

  // Rotate page 1 via the relocated control: the per-view command row is
  // retired, so the PAGES dock's Rotate verb (action 'rotateClockwise', the
  // same handler the old [data-toolbar-rotate-cw] called) is its new home.
  await win.locator('[data-dock-verb="rotate"]').first().click();
  await expect.poll(async () => win.locator(`${PANEL} .thumb-item[data-page="1"]`).getAttribute('class'), { timeout: 20000 })
    .toContain('thumb-rot-90');
  const rot = await win.evaluate(({ panel }) => {
    const p = document.querySelector(`${panel} .thumb-item[data-page="1"]`);
    return { panel: p ? p.className : null };
  }, { panel: PANEL });
  console.log(`[P36C2-B2] after rotate page1: panel="${rot.panel}"`);
  expect(rot.panel).toContain('thumb-rot-90');

  // Delete page 3 through the card's own More menu (Phase 111 chunk B retired
  // the over-preview verb strip; the action is an IMMEDIATE delete).
  await win.locator(`${PANEL} .thumb-item[data-page="3"] [data-thumb-more]`).click();
  await win.locator('[data-page-menu="card"] [data-menu-item="delete"]').click();

  await expect.poll(async () => (await engine()).pageCount, { timeout: 30000 }).toBe(33);
  await expect.poll(async () => win.locator(`${PANEL} .thumb-item`).count(), { timeout: 30000 }).toBe(33);
  // Phase 37 (item 15) — the PAGES header title is retired; the page count is
  // asserted through the engine + thumbnail count above.
  expect(await win.locator(`${PANEL} .glass-sidebar-title`).count(), 'the retired Pages title is absent').toBe(0);

  const panel = await measure(PANEL);
  table('B2 after delete', panel);
  expect(panel.thumbs.map((t) => t.page)).toEqual(Array.from({ length: 33 }, (_, i) => i + 1));
  const e = await engine();
  expect(e.pageCount).toBe(33);
  expect(e.rotations[0]).toBe(1);
});

// ---------------------------------------------------------------------------
// B3. Drag-reorder (drop line), scroll sync, current highlight and selection.
// ---------------------------------------------------------------------------
test('P36C2-B3 drag-reorder, drop line, scroll sync and selection', async () => {
  // scanned.pdf (6 pages) has NO outline, so it isolates the thumbnail
  // behaviours from the outline section.
  await openDoc('scanned.pdf');

  // --- drag: the drop line shows mid-drag; the engine re-orders.
  const before = (await engine()).pageOrder;
  const sigBefore = await sigs(PANEL);
  await dragStep('start', { src: `${PANEL} .thumb-item[data-page="1"]` });
  await win.waitForTimeout(200);
  const over = await dragStep('over', { tgt: `${PANEL} .thumb-item[data-page="3"]` });
  expect(over.ok, 'panel dragover accepted').toBe(true);
  await win.waitForTimeout(300);
  expect(await win.locator(`${PANEL} [data-thumb-drop-line]`).count(), 'panel drop line appears mid-drag').toBeGreaterThan(0);
  await dragStep('drop', { tgt: `${PANEL} .thumb-item[data-page="3"]` });
  await win.waitForTimeout(300);
  await dragStep('end', { src: `${PANEL} .thumb-item[data-page="1"]` });
  await expect.poll(async () => JSON.stringify((await engine()).pageOrder), { timeout: 20000 }).not.toBe(JSON.stringify(before));
  await win.waitForTimeout(1800);
  const panelSigs1 = await sigs(PANEL);
  console.log(`[P36C2-B3] drag: pageOrder ${JSON.stringify(before.slice(0, 6))} -> ${JSON.stringify((await engine()).pageOrder.slice(0, 6))}; slot1 before/after diff ${sigDiff(sigBefore[1], panelSigs1[1])}`);
  expect(sigDiff(sigBefore[1], panelSigs1[1]), 'the panel repainted slot 1 after the reorder').not.toBeNull();

  // --- a second drag with a different target still re-orders.
  const before2 = (await engine()).pageOrder;
  await dragStep('start', { src: `${PANEL} .thumb-item[data-page="2"]` });
  await win.waitForTimeout(200);
  await dragStep('drop', { tgt: `${PANEL} .thumb-item[data-page="4"]` });
  await win.waitForTimeout(300);
  await dragStep('end', { src: `${PANEL} .thumb-item[data-page="2"]` });
  await expect.poll(async () => JSON.stringify((await engine()).pageOrder), { timeout: 20000 }).not.toBe(JSON.stringify(before2));
  console.log(`[P36C2-B3] second drag re-ordered: ${JSON.stringify((await engine()).pageOrder.slice(0, 6))}`);

  // --- scroll sync: scrolling the canvas moves the panel highlight.
  await scrollCanvasTo(5);
  await expect.poll(async () => (await engine()).currentPage, { timeout: 15000 }).toBe(5);
  await expect.poll(async () => win.locator(`${PANEL} .thumb-current`).getAttribute('data-page'), { timeout: 15000 }).toBe('5');
  console.log('[P36C2-B3] scroll sync: panel highlight followed the canvas to page 5');

  // --- click a thumbnail; the canvas jumps.
  await win.locator(`${PANEL} .thumb-item[data-page="3"]`).click();
  await expect.poll(async () => (await engine()).currentPage, { timeout: 15000 }).toBe(3);
  console.log('[P36C2-B3] thumb click moved the canvas to page 3');

  // --- Phase 36 (chunk 3) selection semantics: the PAGES panel is
  //     MULTI-SELECT, so a PLAIN click navigates AND selects exactly that page
  //     (State 2's trigger), and Ctrl extends without navigating.
  await win.locator(`${PANEL} .thumb-item[data-page="2"]`).click();
  expect(await win.locator(`${PANEL} .thumb-selected`).count(), 'panel plain click single-selects').toBe(1);
  expect(await win.locator(`${PANEL} .thumb-selected`).getAttribute('data-page')).toBe('2');
  await expect.poll(async () => (await engine()).currentPage, { timeout: 15000 }).toBe(2);
  // Let the canvas smooth-scroll settle before measuring "no navigation".
  await win.waitForTimeout(1500);
  const settledPage = (await engine()).currentPage;
  await win.locator(`${PANEL} .thumb-item[data-page="4"]`).click({ modifiers: ['Control'] });
  const panelSelected = (await win.locator(`${PANEL} .thumb-selected`).evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-page')))).sort();
  console.log(`[P36C2-B3] panel selection after plain + Ctrl: ${JSON.stringify(panelSelected)}`);
  expect(panelSelected, 'Ctrl extends the panel selection').toEqual(['2', '4']);
  expect((await engine()).currentPage, 'Ctrl select does not navigate').toBe(settledPage);
  console.log('[P36C2-B3] selection: plain click = navigate + single-select; Ctrl extends without navigating');
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

// Phase 111 (chunk B) — the retired over-preview verbs live in the card footer's
// More menu now (`[data-thumb-more]` -> a `[data-page-menu="card"]` CommandMenu
// whose rows carry `[data-menu-item]`). Open that menu and click the row.
async function cardMenuAction(page, item) {
  const thumb = win.locator(`${PANEL} .thumb-item[data-page="${page}"]`).first();
  await thumb.scrollIntoViewIfNeeded();
  await win.waitForTimeout(400);
  const menu = win.locator('[data-page-menu="card"]');
  // The menu dismisses on scroll; a pending navigation recentre can close it
  // right after the click, so retry briefly until it stays open.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await thumb.locator('[data-thumb-more]').click();
    if ((await menu.count()) > 0) break;
    await win.waitForTimeout(400);
  }
  await expect(menu).toHaveCount(1);
  await menu.locator(`[data-menu-item="${item}"]`).click();
}

// ---------------------------------------------------------------------------
// C. Panel-only — the per-card More menu (Phase 111 chunk B replaced the
//    over-preview hover verbs with the card footer's 32px [data-thumb-more]).
// ---------------------------------------------------------------------------
test('P36C2-C card More menu: right action for the right page, no select/jump/drag', async () => {
  
  // No-outline fixture so the menu gestures are not blocked by any outline
  // overlay (report.pdf would intercept every panel-body pointer).
  await openDoc('scanned.pdf');

  // The per-card More is mounted and opens a real menu with the three page
  // actions (the retired verb strip's rotate / extract / delete).
  const more = win.locator(`${PANEL} .thumb-item[data-page="2"] [data-thumb-more]`);
  await expect(more).toHaveCount(1);
  await more.click();
  const menu = win.locator('[data-page-menu="card"]');
  await expect(menu).toHaveCount(1);
  for (const item of ['rotate-cw', 'extract', 'delete']) {
    await expect(menu.locator(`[data-menu-item="${item}"]`)).toHaveCount(1);
  }
  await win.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  console.log('[P36C2-C] card More opens the rotate/extract/delete menu');

  const irBefore = (await engine()).currentPage;

  // rotate-CW on page 2 rotates page 2 ONLY, without select/jump/drag.
  await cardMenuAction(2, 'rotate-cw');
  await expect.poll(async () => win.locator(`${PANEL} .thumb-item[data-page="2"]`).getAttribute('class'), { timeout: 20000 })
    .toContain('thumb-rot-90');
  expect(await win.locator(`${PANEL} .thumb-item[data-page="1"]`).getAttribute('class')).not.toContain('thumb-rot-90');
  expect(await win.locator(`${PANEL} .thumb-selected`).count(), 'menu action does not select').toBe(0);
  expect((await engine()).currentPage, 'menu action does not jump the canvas').toBe(irBefore);
  expect(await win.locator(`${PANEL} .thumb-dragging`).count(), 'menu action does not start a drag').toBe(0);
  console.log(`[P36C2-C] rotate-CW on page 2 -> page2 only rotated; no select/jump/drag (currentPage=${irBefore})`);

  // extract on page 4 opens the EXISTING extract/split dialog.
  await cardMenuAction(4, 'extract');
  await win.waitForSelector('#split-dialog-title', { timeout: 8000 });
  await expect(win.locator('#split-dialog-title')).toHaveText('Extract or split pages');
  await closeDialog('#split-dialog-title');
  console.log('[P36C2-C] extract on page 4 opened the extract/split dialog');

  // drag guard: a press that starts on the card More control must not start a
  // page drag (the footer control is not a drag handle).
  const orderBefore = JSON.stringify((await engine()).pageOrder);
  const guard = await win.evaluate(({ panel }) => {
    const thumb = document.querySelector(`${panel} .thumb-item[data-page="4"]`);
    const glyph = thumb.querySelector('[data-thumb-more] svg') || thumb.querySelector('[data-thumb-more]');
    glyph.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    const dt = new DataTransfer();
    window.__p36guard = dt;
    thumb.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    return { dragging: thumb.className.includes('thumb-dragging') };
  }, { panel: PANEL });
  expect(guard.dragging, 'a press on a card control never starts a page drag').toBe(false);
  const dropped = await win.evaluate(({ panel }) => {
    const dt = window.__p36guard;
    const tgt = document.querySelector(`${panel} .thumb-item[data-page="2"]`);
    const r = tgt.getBoundingClientRect();
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + r.width / 2, clientY: r.top + r.height / 4 });
    tgt.dispatchEvent(ev);
    return { prevented: ev.defaultPrevented };
  }, { panel: PANEL });
  await win.waitForTimeout(600);
  console.log(`[P36C2-C] card-control drag guard: dragging=${guard.dragging} drop.prevented=${dropped.prevented}`);
  expect(JSON.stringify((await engine()).pageOrder), 'control-origin drag did not reorder').toBe(orderBefore);

  // delete on page 2 is an IMMEDIATE delete (no dialog).
  const sigBefore = await sigs(PANEL);
  await cardMenuAction(2, 'delete');
  await expect.poll(async () => (await engine()).pageCount, { timeout: 30000 }).toBe(5);
  expect(await win.locator('[data-delete-pages-dialog]').count(), 'card delete does not open a dialog').toBe(0);
  await win.waitForTimeout(1500);
  const sigAfter = await sigs(PANEL);
  expect(await win.locator(`${PANEL} .thumb-item`).count()).toBe(5);
  const shift = sigDiff(sigAfter[2], sigBefore[3]);
  console.log(`[P36C2-C] delete page 2: count 6->5; slot2 now shows the old slot3 raster (diff ${shift})`);
  expect(shift, 'slot 2 became the old page 3 (right page deleted)').not.toBeNull();
  expect(shift, 'slot 2 became the old page 3 (right page deleted)').toBeLessThan(5);
});

// ---------------------------------------------------------------------------
// D. Panel-only — the right-click menu's six items (section 3A ruling 2:
//    Renumber… was REMOVED from the menu; its single home is the Inspector's
//    `Label · renumber…`).
// ---------------------------------------------------------------------------
test('P36C2-D right-click menu: six items, each does what its label promises', async () => {
  
  // No-outline fixture so the menu gestures are not blocked by the DEF-310
  // outline overlay.
  await openDoc('scanned.pdf');

  const menu = await openPageMenu(2);
  expect(await menu.getAttribute('data-page')).toBe('2');
  const labels = await win.$$eval('[data-context-menu] [data-menu-item]', (els) => els.map((e) => e.textContent.trim()));
  expect(labels).toEqual(['Rotate CW', 'Rotate CCW', 'Extract…', 'Insert blank after', 'Replace…', 'Delete…']);
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

  // Extract… / Replace… open their EXISTING dialogs.
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

  // Section 3A ruling 2 — Renumber… is NOT a menu item; the menu stays the
  // page-verb shortcut. Renumber's single home is the Inspector's
  // `Label · renumber…`, which opens the SAME existing dialog.
  await openPageMenu(4);
  expect(await win.locator('[data-context-menu] [data-menu-item="renumber"]').count(), 'no Renumber… menu item').toBe(0);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(400);
  expect(await win.locator('[data-context-menu]').count(), 'Escape closed the menu').toBe(0);
  await win.locator('[data-inspector] [data-inspector-action="renumber"]').click();
  await win.waitForSelector('[data-renumber-pages-dialog]', { timeout: 8000 });
  await closeDialog('[data-renumber-pages-dialog]');
  console.log('[P36C2-D] Renumber is the Inspector Label · renumber… (no menu item); dialog opened');

  // Selecting an item closes the menu.
  expect(await win.locator('[data-context-menu]').count()).toBe(0);
});

// ---------------------------------------------------------------------------
// E. Panel-only — Combine entry + the outline section.
// ---------------------------------------------------------------------------
test('P36C2-E Combine opens the merge dialog; the outline section toggles and navigates', async () => {
  
  await openReport();

  // Phase 124 — Combine is a direct header icon button (the More menu is gone).
  await win.locator('[data-context-panel-combine]').click();
  await win.waitForSelector('[data-merge-pick]', { timeout: 8000 });
  console.log('[P36C2-E] Combine… opened the EXISTING merge dialog');
  await closeDialog('[data-merge-pick]');

  // Phase 111 (chunk A) — the Outline is now a full-height navigator VIEW, so
  // disclose it with the view selector and assert its live hooks.
  await win.locator(`${PANEL} [data-context-panel-view-tab="outline"]`).click();
  const outline = win.locator(`${PANEL} [data-context-panel-view="outline"]`);
  await expect(outline).toBeVisible();
  const linkCount = await win.locator(`${PANEL} .outline-link`).count();
  expect(linkCount).toBeGreaterThan(0);
  console.log(`[P36C2-E] outline links: ${linkCount}`);

  // The outline tree must render INSIDE the outline view's bounded body.
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
  expect(geom.inside, 'outline links must render inside the outline view body').toBe(true);
  expect(geom.overlapThumbs, 'the outline view must not overlap the thumbnail stack').toBe(false);

  // The view selector discloses and hides the outline (the live replacement for
  // the retired collapsible section + [data-outline-toggle]).
  await win.locator(`${PANEL} [data-context-panel-view-tab="pages"]`).click();
  await expect(win.locator(`${PANEL} [data-context-panel-outline-body]`)).toHaveCount(0);
  await win.locator(`${PANEL} [data-context-panel-view-tab="outline"]`).click();
  await expect(win.locator(`${PANEL} [data-context-panel-outline-body]`)).toHaveCount(1);
  console.log('[P36C2-E] outline view disclosed and hidden by the view selector');

  const before = (await engine()).currentPage;
  await win.locator(`${PANEL} .outline-link`).first().click();
  await expect.poll(async () => (await engine()).currentPage, { timeout: 15000 }).not.toBe(before);
  const after = (await engine()).currentPage;
  expect(after).toBeGreaterThan(1);
  console.log(`[P36C2-E] outline navigation: currentPage ${before} -> ${after}`);

  // The panel body must not be intercepted: back on the Pages view a thumbnail
  // click still jumps the canvas, and a card More action still fires.
  await win.locator(`${PANEL} [data-context-panel-view-tab="pages"]`).click();
  const thumbBefore = (await engine()).currentPage;
  await expect(win.locator(`${PANEL} .thumb-item[data-page="7"]`)).toBeVisible();
  await win.locator(`${PANEL} .thumb-item[data-page="7"]`).click();
  await expect.poll(async () => (await engine()).currentPage, { timeout: 15000 }).toBe(7);
  console.log(`[P36C2-E] thumbnail click after outline: currentPage ${thumbBefore} -> 7`);

  // Let the navigation recentre scroll settle (the card menu dismisses on scroll).
  await win.waitForTimeout(1800);
  await cardMenuAction(2, 'rotate-cw');
  await expect.poll(async () => win.locator(`${PANEL} .thumb-item[data-page="2"]`).getAttribute('class'), { timeout: 20000 })
    .toContain('thumb-rot-90');
  console.log('[P36C2-E] card More rotate after outline: page 2 rotated (not intercepted)');

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

