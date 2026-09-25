// Phase 39 Part 1 (qa) - reproduce the operator's three concrete Multi Mode
// defects with MEASURED bounding boxes. Launches only through the canonical
// e2e/lib/launch.cjs launchApp. Not a regression spec: a measurement harness
// whose console output is the evidence filed in DEFECTS.md.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, toggleMultiModeViaPalette } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
let app = null;
let win = null;

test.setTimeout(240000);

async function openInto(appRef, w, filePath) {
  await appRef.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
  await w.locator('[data-toolbar-open]').first().click();
  await w.waitForTimeout(1400);
}

async function oneDocMulti(appRef, w) {
  const p = getSamplePath('report.pdf');
  await openInto(appRef, w, p);
  await w.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await toggleMultiModeViaPalette(w);
  await w.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await w.waitForSelector('.tab-pane[data-pane="A"] canvas.pdf-page-canvas', { timeout: 30000 });
  await w.waitForTimeout(1200);
  return p;
}

const RECT_JS = `(sels) => {
  const out = {};
  for (const [k, sel] of Object.entries(sels)) {
    const el = document.querySelector(sel);
    if (!el) { out[k] = null; continue; }
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    out[k] = { x:+b.x.toFixed(1), y:+b.y.toFixed(1), w:+b.width.toFixed(1), h:+b.height.toFixed(1),
      right:+b.right.toFixed(1), bottom:+b.bottom.toFixed(1), display: cs.display,
      visibility: cs.visibility, opacity: cs.opacity, pointerEvents: cs.pointerEvents, zIndex: cs.zIndex };
  }
  return out;
}`;

function inter(a, b) {
  if (!a || !b) return null;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.right, b.right);
  const bo = Math.min(a.bottom, b.bottom);
  return { w: +(Math.max(0, r - x)).toFixed(1), h: +(Math.max(0, bo - y)).toFixed(1),
    area: +(Math.max(0, r - x) * Math.max(0, bo - y)).toFixed(1) };
}

async function thumbGeom(w, pane, label) {
  const g = await w.evaluate(`(() => {
    const paneSel = '.tab-pane[data-pane="${pane}"]';
    const q = (s) => document.querySelector(paneSel + ' ' + s);
    const wrap = q('.thumb-canvas-wrap');
    const canvas = q('.thumb-canvas');
    const thumb = wrap ? wrap.closest('.thumb') : null;
    const strip = q('.pane-thumb-strip');
    const body = q('.pane-thumb-strip-body');
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
      return { x:+b.x.toFixed(1), y:+b.y.toFixed(1), w:+b.width.toFixed(1), h:+b.height.toFixed(1), right:+b.right.toFixed(1), bottom:+b.bottom.toFixed(1) }; };
    const cb = canvas ? canvas.getBoundingClientRect() : null;
    const wb = wrap ? wrap.getBoundingClientRect() : null;
    const overflow = (cb && wb) ? {
      left:+(wb.left - cb.left).toFixed(1), right:+(cb.right - wb.right).toFixed(1),
      top:+(wb.top - cb.top).toFixed(1), bottom:+(cb.bottom - wb.bottom).toFixed(1) } : null;
    return { wrap:r(wrap), canvas:r(canvas), thumb:r(thumb), strip:r(strip), body:r(body),
      overflow, canvasIntrinsic: canvas ? {w:canvas.width,h:canvas.height} : null,
      wrapStyle: wrap ? {w:wrap.style.width,h:wrap.style.height} : null,
      canvasCss: canvas ? {w:getComputedStyle(canvas).width,h:getComputedStyle(canvas).height} : null };
  })()`);
  console.log(`[P39-DEF347 ${label}] ${JSON.stringify(g)}`);
  return g;
}

async function overlayDump(w, label) {
  const d = await w.evaluate(`(() => {
    const sel = '[data-dock-verb],[data-multi-dock-layer],.action-dock,.multi-dock-layer,.thumb-verbs,[data-thumb-verb],[data-rail-action-bar],.rail-actions-bar,[data-zoom-pill],.canvas-pills,[data-inspector],[data-context-panel],[data-pane-header],[data-pane-strip]';
    const els = [...document.querySelectorAll(sel)];
    return els.map((el) => {
      const b = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { cls: String(el.className).slice(0,60), tag: el.tagName.toLowerCase(),
        attrs: ['data-dock-verb','data-thumb-verb','data-rail-action-bar','data-pane','data-multi-dock-layer','data-pane-strip','data-inspector'].map(a=>el.getAttribute(a)).filter(v=>v!==null),
        rect: {x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1),right:+b.right.toFixed(1),bottom:+b.bottom.toFixed(1)},
        opacity: cs.opacity, display: cs.display, visibility: cs.visibility, pointerEvents: cs.pointerEvents, position: cs.position };
    });
  })()`);
  console.log(`[P39-OVERLAYS ${label}] ${JSON.stringify(d)}`);
  return d;
}

async function paneSplit(w, label) {
  const s = await w.evaluate(`(() => {
    const stage = document.querySelector('.tab-stage');
    const cs = stage ? getComputedStyle(stage) : null;
    const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect();
      return {x:+b.x.toFixed(1),w:+b.width.toFixed(1),right:+b.right.toFixed(1)}; };
    return { split: cs ? cs.getPropertyValue('--tf-split').trim() : null,
      frac: cs ? cs.getPropertyValue('--tf-split-frac').trim() : null,
      stageW: stage ? Math.round(stage.getBoundingClientRect().width) : null,
      paneA: r('.tab-pane[data-pane="A"]'), paneB: r('.tab-pane[data-pane="B"]'),
      divider: r('[data-multi-divider]') };
  })()`);
  console.log(`[P39-SPLIT ${label}] ${JSON.stringify(s)}`);
  return s;
}

async function dragDivider(w, targetFrac) {
  const d = await w.locator('[data-multi-divider]').boundingBox();
  const st = await w.locator('.tab-stage').boundingBox();
  const y = d.y + d.height / 2;
  const x = st.x + st.width * targetFrac;
  await w.mouse.move(d.x + d.width / 2, y);
  await w.mouse.down();
  await w.mouse.move(x, y, { steps: 8 });
  await w.mouse.up();
  await w.waitForTimeout(600);
}

// ===========================================================================
// DEF-347 (item 1) + DEF-349 (item 3) - one document in Multi Mode
// ===========================================================================
test('DEF-347/DEF-349 one-doc Multi Mode geometry', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await oneDocMulti(app, win);

  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  console.log(`[P39-ENV] viewport=${JSON.stringify(vp)} dpr=${await win.evaluate(() => window.devicePixelRatio)}`);
  console.log(`[P39-ENV] multiPanes=${await win.locator('.tab-stage').getAttribute('data-multi-panes')} panes=${await win.locator('.tab-pane[data-pane]').count()}`);

  await thumbGeom(win, 'A', 'default');
  await overlayDump(win, 'default');
  await paneSplit(win, 'default');
  await win.screenshot({ path: path.join(SHOTS, 'def-347-349-default.png') });

  await dragDivider(win, 0.30);
  await thumbGeom(win, 'A', 'narrowA');
  await paneSplit(win, 'narrowA');
  await win.screenshot({ path: path.join(SHOTS, 'def-347-narrow.png') });

  await dragDivider(win, 0.78);
  await thumbGeom(win, 'A', 'wideA');
  await paneSplit(win, 'wideA');
  await win.screenshot({ path: path.join(SHOTS, 'def-347-wide.png') });

  // Zoom levels: the pane's zoom pill.
  const zoomIn = win.locator('.tab-pane[data-pane="A"] [data-zoom-pill] button[aria-label="Zoom in"]');
  if (await zoomIn.count()) {
    await zoomIn.first().click();
    await win.waitForTimeout(800);
    await thumbGeom(win, 'A', 'zoom+1');
    await zoomIn.first().click();
    await win.waitForTimeout(800);
    await thumbGeom(win, 'A', 'zoom+2');
  }
  await win.screenshot({ path: path.join(SHOTS, 'def-347-zoom.png') });

  // DEF-349: click a thumbnail -> does a page-action bar appear at the bottom?
  const thumb = win.locator('.tab-pane[data-pane="A"] .thumb-item').first();
  await thumb.click();
  await win.waitForTimeout(600);
  const bar = await win.evaluate(`(() => {
    const el = document.querySelector('.tab-pane[data-pane="A"] [data-rail-action-bar]');
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const strip = document.querySelector('.tab-pane[data-pane="A"] .pane-thumb-strip').getBoundingClientRect();
    return { rect:{x:+b.x.toFixed(1),y:+b.y.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1),right:+b.right.toFixed(1),bottom:+b.bottom.toFixed(1)},
      strip:{x:+strip.x.toFixed(1),y:+strip.y.toFixed(1),w:+strip.width.toFixed(1),h:+strip.height.toFixed(1),right:+strip.right.toFixed(1),bottom:+strip.bottom.toFixed(1)},
      opacity: cs.opacity, position: cs.position, zIndex: cs.zIndex };
  })()`);
  console.log(`[P39-DEF349 railActionBar] ${JSON.stringify(bar)}`);
  await win.screenshot({ path: path.join(SHOTS, 'def-349-after-thumb-click.png') });

  expect(app).not.toBeNull();
});

// ===========================================================================
// DEF-348 (item 2) - pane Open-a-PDF with ONE document
// ===========================================================================
test('DEF-348 open-into-pane with one document', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await oneDocMulti(app, win);

  const before = await paneSplit(win, 'before');
  await overlayDump(win, 'before-open');
  const openBtn = win.locator('.tab-pane[data-pane="B"] [data-pane-open]');
  console.log(`[P39-DEF348] paneOpenCount=${await openBtn.count()} visible=${await openBtn.first().isVisible().catch(()=>false)}`);

  // Count dialog invocations in main and return a second document.
  const second = getSamplePath('long.pdf');
  await app.evaluate(async ({ dialog }, p) => {
    globalThis.__openCalls = 0;
    dialog.showOpenDialog = async () => { globalThis.__openCalls += 1; return { canceled: false, filePaths: [p] }; };
  }, second);
  await openBtn.first().click();
  await win.waitForTimeout(2500);
  const calls = await app.evaluate(() => globalThis.__openCalls);
  const after = await paneSplit(win, 'after');
  const paneBFilled = await win.locator('.tab-pane[data-pane="B"] canvas.pdf-page-canvas').count();
  const paneBFilled2 = await win.locator('.tab-pane[data-pane="B"][data-pane-empty]').count();
  console.log(`[P39-DEF348] dialogCalls=${calls} paneBCanvas=${paneBFilled} paneBStillEmpty=${paneBFilled2}`);
  console.log(`[P39-DEF348] divider before=${JSON.stringify(before.divider)} after=${JSON.stringify(after.divider)}`);
  console.log(`[P39-DEF348] paneA before=${JSON.stringify(before.paneA)} after=${JSON.stringify(after.paneA)}`);
  console.log(`[P39-DEF348] paneB before=${JSON.stringify(before.paneB)} after=${JSON.stringify(after.paneB)}`);
  console.log(`[P39-DEF348] split before=${before.split} after=${after.split}`);
  await win.screenshot({ path: path.join(SHOTS, 'def-348-one-doc.png') });
  expect(app).not.toBeNull();
});

// ===========================================================================
// DEF-348 - with TWO documents (no empty pane): what affordance exists?
// ===========================================================================
test('DEF-348 open with two documents', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const a = getSamplePath('report.pdf');
  const b = getSamplePath('long.pdf');
  await openInto(app, win, a);
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await openInto(app, win, b);
  await win.waitForTimeout(1000);
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1200);

  // With two tabs, only pane A is seeded; pane B is empty until picked.
  const empty = await win.locator('.tab-pane[data-pane-empty]').count();
  console.log(`[P39-DEF348-two] emptyPanes=${empty} paneOpenCount=${await win.locator('[data-pane-open]').count()}`);
  if (empty > 0) {
    // Fill B from the pick list -> now two docs, no empty pane.
    const pick = win.locator('.tab-pane[data-pane-empty] [data-pane-pick]').first();
    await pick.click();
    await win.waitForTimeout(1500);
  }
  const panesFilled = await win.locator('.tab-pane[data-pane] canvas.pdf-page-canvas').count();
  const paneOpenNow = await win.locator('[data-pane-open]').count();
  const titleOpen = await win.locator('[data-toolbar-open]').count();
  console.log(`[P39-DEF348-two] panesFilled=${panesFilled} paneOpenCount=${paneOpenNow} titleBarOpen=${titleOpen}`);

  const before = await paneSplit(win, 'two-before');
  // Mock and click the title-bar Open (the only open affordance left).
  const c = getSamplePath('scanned.pdf');
  await app.evaluate(async ({ dialog }, p) => {
    globalThis.__openCalls2 = 0;
    dialog.showOpenDialog = async () => { globalThis.__openCalls2 += 1; return { canceled: false, filePaths: [p] }; };
  }, c);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(2500);
  const calls = await app.evaluate(() => globalThis.__openCalls2);
  const after = await paneSplit(win, 'two-after');
  console.log(`[P39-DEF348-two] titleBarOpenDialogCalls=${calls}`);
  console.log(`[P39-DEF348-two] divider before=${JSON.stringify(before.divider)} after=${JSON.stringify(after.divider)} split before=${before.split} after=${after.split}`);
  await win.screenshot({ path: path.join(SHOTS, 'def-348-two-docs.png') });
  expect(app).not.toBeNull();
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p39-part1');
  app = null;
  win = null;
});
