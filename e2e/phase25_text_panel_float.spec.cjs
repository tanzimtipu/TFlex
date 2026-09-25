// Phase 25 QA validation — header-less text-properties panel (no page reflow),
// MIGRATED for Phase 38 feature C: the floating, drag-to-move card is retired,
// so this spec now pins the current contract (the panel is the Inspector's one
// fixed text surface) while keeping the original behaviour checks (header-less,
// no page reflow on open/close, control presses never move it).
//
// Measures the running Electron app (canonical launcher only) against the
// phase's four success criteria:
//   C1 no header/title; opening/closing never moves the page (frame-sampled
//      canvas rect + scroller scrollTop spans) and the panel is hosted by the
//      Inspector (no float wrapper); three themes.
//   C2 the retired grip/drag chrome is ABSENT and the fixed panel cannot be
//      dragged; it stays inside the page view; a press on a control never
//      moves it.
//   C3 with the panel open, dragging an annotation textbox / callout / note
//      and an Edit-mode text box moves it by exactly the mouse delta with no
//      ghost/duplicate/drift; survives Save As + close + reopen.
//   C4 Phase-24 annotation controls still live; animations-off and reduced
//      motion stay instant; the tools palette no longer overlaps the panel
//      at 640 / 820 / 1440.
//
// Screenshots: screenshots/phase25-verify-{light,dark,frosted}.png
//              screenshots/phase25-text-move-reopen.png
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const {
  hardClose, armAnnotationTool, openSamplePath, gotoStage,
} = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const log = (label, obj) => console.log(`[P25] ${label} ${JSON.stringify(obj)}`);
const THEMES = ['light', 'dark', 'frosted'];

async function openReport(app, win) {
  const p = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(500);
}

async function setTheme(win, want) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${want}"]`);
  await win.waitForFunction(
    (w) => document.documentElement.getAttribute('data-theme') === w,
    want,
    { timeout: 5000 },
  );
  await win.waitForTimeout(400);
}

async function setSize(app, win, w, h) {
  await app.evaluate(async ({ BrowserWindow }, s) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) bw.setSize(s[0], s[1]);
  }, [w, h]);
  await win.waitForTimeout(600);
}

// ---------------------------------------------------------------------------
// rAF probe: samples the page-1 canvas rect (left/top/width), the document
// scroller's scrollTop and the workspace-main left every frame.
// ---------------------------------------------------------------------------
async function installPageProbe(win) {
  await win.evaluate(() => {
    window.__p25 = { rows: [], running: false };
    window.__p25Start = (ms) => {
      window.__p25 = { rows: [], running: true };
      const t0 = performance.now();
      const tick = () => {
        const pane = document.querySelector('.tab-pane[aria-hidden="false"]') || document;
        const canvas = pane.querySelector('.pdf-page[data-page="1"] canvas');
        const sc = document.querySelector('.document-scroller');
        const main = document.querySelector('.workspace-main');
        const cb = canvas ? canvas.getBoundingClientRect() : null;
        const mb = main ? main.getBoundingClientRect() : null;
        window.__p25.rows.push({
          t: Math.round(performance.now() - t0),
          cl: cb ? +cb.left.toFixed(2) : null,
          ct: cb ? +cb.top.toFixed(2) : null,
          cw: cb ? +cb.width.toFixed(2) : null,
          st: sc ? +sc.scrollTop.toFixed(2) : null,
          ml: mb ? +mb.left.toFixed(2) : null,
        });
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else window.__p25.running = false;
      };
      requestAnimationFrame(tick);
    };
  });
}

async function startPageProbe(win, ms) {
  await win.evaluate((m) => window.__p25Start(m), ms);
}

async function readPageProbe(win) {
  await win.waitForFunction(() => window.__p25.running === false, null, { timeout: 12000 }).catch(() => {});
  return win.evaluate(() => window.__p25.rows);
}

function span(rows, key) {
  const vals = rows.map((r) => r[key]).filter((v) => v !== null);
  if (!vals.length) return null;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return { min: +min.toFixed(2), max: +max.toFixed(2), span: +(max - min).toFixed(2) };
}

/** Panel card rect + its containing page-view rect (viewport px). */
async function panelRects(win) {
  return win.evaluate(() => {
    const panel = document.querySelector('.text-props-panel');
    const main = document.querySelector('.workspace-main');
    const float = document.querySelector('[data-text-panel-float]');
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        left: +b.left.toFixed(1), top: +b.top.toFixed(1),
        right: +b.right.toFixed(1), bottom: +b.bottom.toFixed(1),
        width: +b.width.toFixed(1), height: +b.height.toFixed(1),
      };
    };
    return {
      panel: r(panel), main: r(main),
      // Phase 38 feature C — the retired float wrapper is gone; the panel is
      // in-flow inside the Inspector, so there is no drag transform.
      float: float !== null,
      transform: panel ? getComputedStyle(panel).transform : null,
    };
  });
}

// ===========================================================================
// C1 — header-less, no page reflow on open/close, floats inside the page
// view, three themes.
// ===========================================================================
test('C1 header-less, no page shift on open/close, floats in page view, 3 themes', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);

    await armAnnotationTool(win, 'textbox'); // open the panel for the DOM probe
    await win.waitForSelector('.text-props-panel', { timeout: 8000 });
    await win.waitForTimeout(500);
    const dom = await win.evaluate(() => {
      const panel = document.querySelector('[data-text-panel]');
      const insp = document.querySelector('[data-inspector]');
      return {
        hasHeader: !!document.querySelector('.text-props-header'),
        hasTitle: !!document.querySelector('.text-props-title'),
        float: !!document.querySelector('[data-text-panel-float]'),
        grip: !!document.querySelector('[data-text-panel-grip]'),
        gripClass: !!document.querySelector('.text-props-grip'),
        inspectorHosted: panel !== null && insp !== null && insp.contains(panel),
        panels: document.querySelectorAll('.text-props-panel').length,
      };
    });
    log('C1-dom', dom);
    expect(dom.hasHeader, 'no header element').toBe(false);
    expect(dom.hasTitle, 'no title element').toBe(false);
    // Phase 38 feature C — the retired floating chrome is absent; the
    // Inspector-hosted block is the ONE home of the panel.
    expect(dom.float, 'no float wrapper').toBe(false);
    expect(dom.grip, 'no grip strip').toBe(false);
    expect(dom.gripClass, 'no grip class').toBe(false);
    expect(dom.inspectorHosted, 'the panel is hosted by the Inspector').toBe(true);
    expect(dom.panels, 'exactly one text-props panel').toBe(1);
    await armAnnotationTool(win, 'select');
    await win.waitForTimeout(300);

    await installPageProbe(win);
    const results = [];
    for (const theme of THEMES) {
      await setTheme(win, theme);
      await armAnnotationTool(win, 'select');
      await win.waitForTimeout(300);

      // OPEN then CLOSE while frame-sampling the page geometry.
      await startPageProbe(win, 2600);
      await armAnnotationTool(win, 'textbox'); // opens the panel
      await win.waitForTimeout(900);
      const openRects = await panelRects(win);
      await win.screenshot({ path: path.join(SHOTS, `phase25-verify-${theme}.png`) }).catch(() => {});
      await armAnnotationTool(win, 'select'); // closes the panel
      const rows = await readPageProbe(win);

      const canvasL = span(rows, 'cl');
      const canvasT = span(rows, 'ct');
      const canvasW = span(rows, 'cw');
      const scrollTop = span(rows, 'st');
      const mainL = span(rows, 'ml');
      const inside = openRects.panel !== null && openRects.main !== null
        && openRects.panel.left >= openRects.main.left - 2
        && openRects.panel.top >= openRects.main.top - 2
        && openRects.panel.right <= openRects.main.right + 2
        && openRects.panel.bottom <= openRects.main.bottom + 2;

      const r = {
        theme, frames: rows.length, canvasL, canvasT, canvasW, scrollTop, mainL,
        openPanel: openRects.panel, inside,
      };
      results.push(r);
      log('C1', r);

      expect(rows.length, `${theme}: probe sampled frames`).toBeGreaterThan(30);
      expect(canvasL && canvasL.span, `${theme}: canvas left unchanged (span ${canvasL && canvasL.span})`).toBeLessThanOrEqual(0.5);
      expect(canvasT && canvasT.span, `${theme}: canvas top unchanged (span ${canvasT && canvasT.span})`).toBeLessThanOrEqual(0.5);
      expect(canvasW && canvasW.span, `${theme}: canvas width unchanged (span ${canvasW && canvasW.span})`).toBeLessThanOrEqual(0.5);
      expect(scrollTop && scrollTop.span, `${theme}: scroller scrollTop unchanged (span ${scrollTop && scrollTop.span})`).toBeLessThanOrEqual(0.5);
      expect(inside, `${theme}: panel inside the page view`).toBe(true);
    }
    log('C1-summary', results);
  } finally {
    await hardClose(app, 'p25-c1');
  }
});

// Phase 38 feature C — the panel no longer has a grip. Attempt the retired
// drag on the panel's own surface: a fixed panel must not move.
async function dragPanelSurface(win, dx, dy) {
  const p = await win.locator('.text-props-panel').boundingBox();
  const x = p.x + 8;
  const y = p.y + 8;
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dx, y + dy, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(250);
}

function sameRect(a, b, tol = 1.5) {
  if (!a || !b) return false;
  return Math.abs(a.left - b.left) <= tol && Math.abs(a.top - b.top) <= tol
    && Math.abs(a.right - b.right) <= tol && Math.abs(a.bottom - b.bottom) <= tol;
}

function sameRel(a, b, tol = 1.5) {
  if (!a || !b) return false;
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol
    && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol;
}

// ===========================================================================
// C2 (Phase 38 feature C migration) — the panel is FIXED in the Inspector:
// the retired grip/drag chrome is absent, attempting the drag never moves it,
// it stays inside the page view, and a press on a control never moves it.
// ===========================================================================
test('C2 panel is fixed in the Inspector (no drag) + control press no move', async () => {
  test.setTimeout(200000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await armAnnotationTool(win, 'textbox'); // panel open
    await win.waitForSelector('.text-props-panel', { timeout: 8000 });
    await win.waitForTimeout(700);

    // The retired drag chrome is gone.
    expect(await win.locator('[data-text-panel-grip]').count(), 'no drag grip').toBe(0);
    expect(await win.locator('[data-text-panel-float]').count(), 'no float wrapper').toBe(0);
    expect(await win.locator('.text-props-grip').count(), 'no grip class').toBe(0);

    const start = await panelRects(win);
    const positions = [];
    for (const [dx, dy] of [[120, 80], [-60, 160], [80, 220]]) {
      await dragPanelSurface(win, dx, dy);
      const r1 = await panelRects(win);
      await win.waitForTimeout(300);
      const r2 = await panelRects(win);
      positions.push({ dx, dy, panel: r1.panel, stayed: sameRect(r1.panel, r2.panel), moved: !sameRect(r1.panel, start.panel) });
      log('C2-pos', { dx, dy, panel: r1.panel, stayed: sameRect(r1.panel, r2.panel), moved: !sameRect(r1.panel, start.panel) });
    }

    // A far drag must leave the fixed panel inside the page view.
    await dragPanelSurface(win, 3000, 3000);
    const far = await panelRects(win);
    const m = far.main;
    const clamped = far.panel.left >= m.left - 2 && far.panel.top >= m.top - 2
      && far.panel.right <= m.right + 2 && far.panel.bottom <= m.bottom + 2;
    log('C2-clamp', { panel: far.panel, main: m, clamped });

    // A press on a control must NOT move the panel either.
    const before = (await panelRects(win)).transform;
    const b = await win.locator('[data-txt-bold]').boundingBox();
    await win.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await win.mouse.down();
    await win.mouse.move(b.x + b.width / 2 + 220, b.y + b.height / 2 + 220, { steps: 6 });
    await win.mouse.up();
    await win.waitForTimeout(300);
    const after = (await panelRects(win)).transform;
    log('C2-control-press', { before, after });
    await win.screenshot({ path: path.join(SHOTS, 'phase25-c2-drag.png') }).catch(() => {});

    expect(start.panel, 'panel mounted at start').not.toBeNull();
    for (const p of positions) {
      expect(p.moved, `drag (${p.dx},${p.dy}): the fixed panel does not move`).toBe(false);
      expect(p.stayed, `drag (${p.dx},${p.dy}): panel stays where it is`).toBe(true);
    }
    expect(clamped, `the fixed panel stays inside the page view (panel=${JSON.stringify(far.panel)} main=${JSON.stringify(m)})`).toBe(true);
    expect(after, 'a press on a control never moves the panel').toBe(before);
  } finally {
    await hardClose(app, 'p25-c2');
  }
});

// ---------------------------------------------------------------------------
// C3 helpers — placement, geometry, move.
// ---------------------------------------------------------------------------
async function dragOnPage(win, fx, fy, dxPx = 190, dyPx = 60) {
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 260));
  const y = Math.max(pg.y + 20, Math.min(pg.y + pg.height * fy, vp.h - 120));
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dxPx, y + dyPx, { steps: 6 });
  await win.mouse.up();
}

// Phase 26 — the in-canvas editors are retired; the panel's Text field is the
// single editor (placement focuses it, typing is live, blur commits).
async function fillPanelText(win, text) {
  await win.waitForSelector('[data-txt-text]', { timeout: 8000 });
  await win.waitForFunction(() => {
    const ta = document.querySelector('[data-txt-text]');
    return ta !== null && ta.disabled === false;
  }, null, { timeout: 8000 });
  await win.locator('[data-txt-text]').fill(text);
  await win.locator('[data-txt-text]').blur();
}

async function placeTextbox(win, text, fx, fy) {
  await armAnnotationTool(win, 'textbox');
  await dragOnPage(win, fx, fy, 190, 60);
  await fillPanelText(win, text);
  await win.waitForSelector('.ann-textbox[data-kind="textbox"]', { timeout: 8000 });
  await win.waitForTimeout(300);
}

async function placeCallout(win, text, fx, fy) {
  await armAnnotationTool(win, 'callout');
  await dragOnPage(win, fx, fy, 190, 60);
  await fillPanelText(win, text);
  await win.waitForSelector('.ann-callout[data-kind="callout"]', { timeout: 8000 });
  await win.waitForTimeout(300);
}

async function placeNote(win, text, fx, fy) {
  await armAnnotationTool(win, 'note');
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 40));
  const y = Math.max(40, Math.min(pg.y + pg.height * fy, vp.h - 120));
  await win.mouse.click(x, y);
  await fillPanelText(win, text);
  await win.waitForSelector('.ann-note[data-kind="note"]', { timeout: 8000 });
  await win.waitForTimeout(300);
}

async function pageRelRect(win, sel) {
  return win.evaluate((s) => {
    const page = document.querySelector('.pdf-page[data-page="1"]');
    const box = document.querySelector(s);
    if (!page || !box) return null;
    const pb = page.getBoundingClientRect();
    const bb = box.getBoundingClientRect();
    return {
      x: +(bb.left - pb.left).toFixed(1), y: +(bb.top - pb.top).toFixed(1),
      w: +bb.width.toFixed(1), h: +bb.height.toFixed(1),
    };
  }, sel);
}

async function annGeom(win) {
  return win.evaluate(() => {
    const st = window.tflexDiagnostics().engineState;
    const list = st && st.annotations ? st.annotations : [];
    return list.map((a) => {
      const r0 = a.rects && a.rects[0] ? a.rects[0] : (a.rect || null);
      return {
        id: a.id, kind: a.kind, page: a.page, text: a.text ?? a.content ?? null,
        rect: r0 ? { x: r0.x, y: r0.y, width: r0.width, height: r0.height } : null,
        at: a.at ? { x: a.at.x, y: a.at.y } : null,
      };
    });
  });
}

async function boxGeom(win) {
  return win.evaluate(() => {
    const st = window.tflexDiagnostics().engineState;
    const list = st && st.textBoxes ? st.textBoxes : [];
    return list.map((b) => ({ id: b.id, text: b.text, page: b.page, rect: { ...b.rect } }));
  });
}

async function moveAnn(win, kind, dx, dy) {
  const sel = `.pdf-page[data-page="1"] .ann-${kind}[data-kind="${kind}"]`;
  const engineBefore = (await annGeom(win)).length;
  const pre = await pageRelRect(win, sel);
  const loc = win.locator(sel).first();
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await win.waitForTimeout(250);
  const box = await loc.boundingBox();
  const hit = await win.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    return {
      tag: el.tagName, cls: String(el.className),
      kind: el.getAttribute('data-kind'), ann: el.getAttribute('data-annotation-id'),
      closestAnn: (() => { const a = el.closest('.ann'); return a ? a.getAttribute('data-kind') : null; })(),
    };
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  log('C3-hit', { kind, box: { x: box.x, y: box.y, w: box.width, h: box.height }, hit });
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await win.mouse.down();
  await win.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(250);
  const dbg = await win.evaluate((s) => ({
    bars: [...document.querySelectorAll('[data-content-action]')].map((e) => e.getAttribute('data-content-action')),
    frame: !!document.querySelector('[data-content-selection-frame]'),
    activeLayer: !!document.querySelector('.annotation-layer-active'),
    sel: !!document.querySelector(s),
    annRect: (() => {
      const p = document.querySelector('.pdf-page[data-page="1"]');
      const a = document.querySelector(s);
      if (!p || !a) return null;
      const pb = p.getBoundingClientRect();
      const ab = a.getBoundingClientRect();
      return { x: +(ab.left - pb.left).toFixed(1), y: +(ab.top - pb.top).toFixed(1), w: +ab.width.toFixed(1), h: +ab.height.toFixed(1) };
    })(),
  }), sel);
  log('C3-dbg', { kind, dbg });
  await win.waitForSelector(`[data-content-action="ann-${kind}-confirm"]`, { timeout: 6000 });
  await win.click(`[data-content-action="ann-${kind}-confirm"]`);
  await win.waitForTimeout(350);
  const post = await pageRelRect(win, sel);
  await win.waitForTimeout(400);
  const settled = await pageRelRect(win, sel);
  const count = await win.locator(sel).count();
  const engineAfter = (await annGeom(win)).length;
  return {
    pre, post, settled,
    delta: { x: +(post.x - pre.x).toFixed(1), y: +(post.y - pre.y).toFixed(1) },
    count, engineBefore, engineAfter,
  };
}

async function moveEditBox(win, dx, dy) {
  const sel = '.edit-box';
  const engineBefore = (await boxGeom(win)).length;
  const pre = await pageRelRect(win, sel);
  const loc = win.locator(sel).first();
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await win.waitForTimeout(250);
  const box = await loc.boundingBox();
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await win.mouse.down();
  await win.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(250);
  await win.click('[data-edit-box-action="confirm"]');
  await win.waitForTimeout(400);
  const post = await pageRelRect(win, sel);
  await win.waitForTimeout(400);
  const settled = await pageRelRect(win, sel);
  const count = await win.locator(sel).count();
  const engineAfter = (await boxGeom(win)).length;
  return {
    pre, post, settled,
    delta: { x: +(post.x - pre.x).toFixed(1), y: +(post.y - pre.y).toFixed(1) },
    count, engineBefore, engineAfter,
  };
}

async function saveAs(app, win, savePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-confirm]', { timeout: 8000 });
  await win.click('[data-save-as-confirm]');
  await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 30000 });
  expect(fs.existsSync(savePath), 'saved PDF must exist on disk').toBe(true);
}

async function closeAndReopen(app, win, savePath) {
  await win.locator('.tab-active .tab-close').click();
  await win.waitForTimeout(1500);
  await openSamplePath(win, app, savePath);
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(2000);
}

// ===========================================================================
// C3 — with the panel open, dragging an annotation textbox / callout / note
// and an Edit-mode text box moves it by exactly the mouse delta (no ghost,
// no duplicate, no drift); survives Save As + close + reopen.
// ===========================================================================
test('C3 text element move integrity + save/reopen', async () => {
  test.setTimeout(480000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);

    await placeTextbox(win, 'P25-TB', 0.58, 0.16);
    await placeCallout(win, 'P25-CO', 0.58, 0.36);
    await placeNote(win, 'P25-NT', 0.74, 0.54);
    await win.waitForSelector('.text-props-panel', { timeout: 8000 });
    await win.waitForTimeout(400);

    const moves = [];
    for (const [kind, dx, dy] of [['textbox', 160, 130], ['callout', 90, 120], ['note', 70, 90]]) {
      const m = await moveAnn(win, kind, dx, dy);
      const rec = { kind, dx, dy, ...m };
      moves.push(rec);
      log('C3-ann', rec);
    }

    // Edit-mode text box. Phase 37 item 13 — the EDIT STAGE is the edit-mode
    // switch (the `editMode` dock verb is retired), so enter the stage.
    await armAnnotationTool(win, 'select');
    await win.waitForTimeout(300);
    if ((await win.locator('[data-edit-toolbar]').count()) === 0) {
      await gotoStage(win, 2);
      await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
    }
    await win.click('[data-edit-tool="box"]');
    await dragOnPage(win, 0.58, 0.66, 200, 70);
    // Phase 26 — panel Text field is the editor (session commits on blur).
    // Phase 36 (chunk 6): in the EDIT stage the Inspector ALSO re-parents the
    // same TextPropertiesPanel, so scope to the VISIBLE field.
    await win.waitForSelector('[data-txt-text]:visible', { timeout: 8000 });
    await win.waitForFunction(() => {
      const ta = document.querySelector('[data-txt-text]');
      return ta !== null && ta.disabled === false;
    }, null, { timeout: 8000 });
    await win.locator('[data-txt-text]:visible').first().fill('P25-EB');
    await win.locator('[data-txt-text]:visible').first().blur();
    await win.waitForSelector('.edit-box', { timeout: 8000 });
    await win.waitForTimeout(400);
    await win.locator('.edit-box').first().click({ position: { x: 8, y: 8 } });
    await win.waitForSelector('[data-edit-box-toolbar]', { timeout: 8000 });
    await win.waitForTimeout(300);
    const panelDuringEdit = await win.evaluate(() => ({
      open: !!document.querySelector('.text-props-panel'),
      mode: document.querySelector('[data-text-panel]')?.getAttribute('data-text-panel-mode') ?? null,
    }));
    const em = await moveEditBox(win, 120, 100);
    const editMove = { kind: 'editbox', dx: 120, dy: 100, ...em };
    log('C3-edit', { panelDuringEdit, ...editMove });

    // Snapshot geometry then Save As + close + reopen.
    const preAnn = await annGeom(win);
    const preBox = await boxGeom(win);
    const savePath = path.join(os.tmpdir(), `p25-move-${Date.now()}.pdf`);
    await saveAs(app, win, savePath);
    await closeAndReopen(app, win, savePath);
    const postAnn = await annGeom(win);
    let postBox = await boxGeom(win);
    const rtTb = await pageRelRect(win, '.ann-textbox[data-kind="textbox"]');
    await win.screenshot({ path: path.join(SHOTS, 'phase25-text-move-reopen.png') }).catch(() => {});
    log('C3-reopen-ann', postAnn);
    log('C3-reopen-box', postBox);

    // Render the committed edit box after reopen (Edit mode + box tool).
    // Phase 37 item 13 — the EDIT stage is the switch. Opening/activating a tab
    // resets edit mode while the stage stays EDIT, and the stage effect only
    // fires on a stage CHANGE, so force a real stage change (PAGES -> EDIT) to
    // re-enter edit mode. (Recorded as DEF-342.)
    if ((await win.locator('[data-edit-toolbar]').count()) === 0) {
      await gotoStage(win, 1);
      await gotoStage(win, 2);
      await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
    }
    await win.click('[data-edit-tool="box"]');
    await win.waitForTimeout(800);
    postBox = await boxGeom(win);
    const ebOverlay = await pageRelRect(win, '.edit-box');
    await win.screenshot({ path: path.join(SHOTS, 'phase25-text-move-reopen-edit.png') }).catch(() => {});
    log('C3-reopen-eb-overlay', ebOverlay);

    // Move deltas exact; no duplicate / ghost; no late drift.
    for (const r of moves) {
      expect(r.count, `${r.kind}: exactly one overlay after move (no ghost/duplicate)`).toBe(1);
      expect(r.engineAfter, `${r.kind}: no duplicate engine annotation`).toBe(r.engineBefore);
      expect(Math.abs(r.delta.x - r.dx), `${r.kind}: x delta ${r.delta.x} vs mouse ${r.dx}`).toBeLessThanOrEqual(2.5);
      expect(Math.abs(r.delta.y - r.dy), `${r.kind}: y delta ${r.delta.y} vs mouse ${r.dy}`).toBeLessThanOrEqual(2.5);
      expect(sameRel(r.post, r.settled, 1.5), `${r.kind}: no late drift after settle`).toBe(true);
    }
    expect(editMove.count, 'edit box: exactly one overlay after move').toBe(1);
    expect(editMove.engineAfter, 'edit box: no duplicate engine text box').toBe(editMove.engineBefore);
    expect(Math.abs(editMove.delta.x - 120), `edit box: x delta ${editMove.delta.x} vs mouse 120`).toBeLessThanOrEqual(2.5);
    expect(Math.abs(editMove.delta.y - 100), `edit box: y delta ${editMove.delta.y} vs mouse 100`).toBeLessThanOrEqual(2.5);
    expect(panelDuringEdit.open && panelDuringEdit.mode === 'text', 'panel open in text mode during the edit-box move').toBe(true);

    // Save/reopen: element is at the moved position.
    const textFor = (k) => (k === 'textbox' ? 'P25-TB' : k === 'callout' ? 'P25-CO' : 'P25-NT');
    for (const r of moves) {
      const pre = preAnn.find((a) => a.text === textFor(r.kind));
      const post = postAnn.find((a) => a.text === textFor(r.kind));
      expect(post, `${r.kind}: annotation survives reopen`).toBeTruthy();
      const preX = pre.rect ? pre.rect.x : pre.at.x;
      const preY = pre.rect ? pre.rect.y : pre.at.y;
      const postX = post.rect ? post.rect.x : post.at.x;
      const postY = post.rect ? post.rect.y : post.at.y;
      expect(Math.abs(postX - preX), `${r.kind}: x position persisted (pre ${preX} post ${postX})`).toBeLessThanOrEqual(1.5);
      expect(Math.abs(postY - preY), `${r.kind}: y position persisted (pre ${preY} post ${postY})`).toBeLessThanOrEqual(1.5);
    }
    expect(rtTb && Math.abs(rtTb.x - moves[0].post.x) <= 3 && Math.abs(rtTb.y - moves[0].post.y) <= 3,
      `reopened textbox overlay at the moved position (overlay=${JSON.stringify(rtTb)} moved=${JSON.stringify(moves[0].post)})`).toBe(true);
    const preEb = preBox.find((b) => b.text === 'P25-EB');
    const postEb = postBox.find((b) => b.text === 'P25-EB');
    expect(postEb, 'edit text box survives reopen').toBeTruthy();
    expect(Math.abs(postEb.rect.x - preEb.rect.x), `edit box x persisted (pre ${preEb.rect.x} post ${postEb.rect.x})`).toBeLessThanOrEqual(1.5);
    expect(Math.abs(postEb.rect.y - preEb.rect.y), `edit box y persisted (pre ${preEb.rect.y} post ${postEb.rect.y})`).toBeLessThanOrEqual(1.5);
    expect(ebOverlay && Math.abs(ebOverlay.x - editMove.post.x) <= 4 && Math.abs(ebOverlay.y - editMove.post.y) <= 4,
      `reopened edit-box overlay at the moved position (overlay=${JSON.stringify(ebOverlay)} moved=${JSON.stringify(editMove.post)})`).toBe(true);

    log('C3-summary', { moves, editMove, postAnn, postBox });
  } finally {
    await hardClose(app, 'p25-c3');
  }
});

// ---------------------------------------------------------------------------
// C4 helpers — panel motion probe, settings seeding, palette geometry.
// ---------------------------------------------------------------------------
async function installPanelProbe(win) {
  await win.evaluate(() => {
    window.__p25p = { rows: [], running: false };
    window.__p25pStart = (ms) => {
      window.__p25p = { rows: [], running: true };
      const t0 = performance.now();
      const tick = () => {
        const el = document.querySelector('.text-props-panel');
        if (el) {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          window.__p25p.rows.push({
            t: Math.round(performance.now() - t0),
            tr: cs.transform, op: Number.parseFloat(cs.opacity),
            left: +r.left.toFixed(1), top: +r.top.toFixed(1), w: +r.width.toFixed(1),
          });
        }
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else window.__p25p.running = false;
      };
      requestAnimationFrame(tick);
    };
  });
}

async function probePanel(win, ms, action) {
  await win.evaluate((m) => window.__p25pStart(m), ms);
  await action();
  await win.waitForFunction(() => window.__p25p.running === false, null, { timeout: 10000 }).catch(() => {});
  return win.evaluate(() => window.__p25p.rows);
}

function parseMatrix(tr) {
  if (!tr || tr === 'none') return { a: 1, tx: 0, ty: 0 };
  const m = /matrix\(([^)]+)\)/.exec(tr);
  if (!m) return null;
  const p = m[1].split(',').map((s) => parseFloat(s.trim()));
  return { a: p[0], tx: p[4], ty: p[5] };
}

function panelSummary(rows) {
  let intermediates = 0;
  for (const r of rows) {
    const m = parseMatrix(r.tr);
    const opMid = r.op > 0.02 && r.op < 0.98;
    const trMid = m !== null && (Math.abs(m.a - 1) > 0.01 || Math.abs(m.tx) > 0.5 || Math.abs(m.ty) > 0.5);
    if (opMid || trMid) intermediates += 1;
  }
  const rects = new Set(rows.map((r) => `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.w)}`));
  const end = rows[rows.length - 1] || null;
  return { frames: rows.length, intermediates, distinctRects: rects.size, end };
}

function seedDir(tag, settings) {
  const ud = path.join(os.tmpdir(), `tflex-p25-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  fs.mkdirSync(ud, { recursive: true });
  if (settings) fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify(settings));
  return ud;
}

const ENGINE_DISABLED = ['[data-txt-horizontal-scaling]'];
const ALL_CONTROLS = [
  '[data-txt-font]', '[data-txt-size]',
  '[data-txt-bold]', '[data-txt-italic]', '[data-txt-underline]',
  '[data-txt-super]', '[data-txt-sub]',
  '[data-txt-color]', '[data-txt-highlight]', '[data-txt-highlight-clear]',
  '[data-txt-clear]',
  '[data-txt-align-left]', '[data-txt-align-center]', '[data-txt-align-right]',
  '[data-txt-align-justify]',
  '[data-txt-line-height]',
  '[data-txt-list-none]', '[data-txt-list-bullet]', '[data-txt-list-number]',
  '[data-txt-indent-dec]', '[data-txt-indent-inc]',
  '[data-txt-character-spacing]', '[data-txt-horizontal-scaling]',
];

async function controlDisabledMap(win) {
  return win.evaluate((sels) => {
    const p = document.querySelector('.text-props-panel');
    const out = {};
    for (const s of sels) {
      const el = p.querySelector(s);
      out[s] = el === null ? 'MISSING' : { disabled: el.disabled, title: el.getAttribute('title') };
    }
    return out;
  }, ALL_CONTROLS);
}

// Phase 36 (chunk 5) — the All-tools palette is retired, so the palette-vs-
// panel coexistence helpers and the C4-(d) report were removed with their
// subject. The Phase-25 contract (the Phase-24 controls stay live; the panel
// opens instantly under animations-off / reduced motion) is proven by C4 (a)(b)(c).

// ===========================================================================
// C4 — Phase-24 annotation controls still live; animations-off + reduced
// motion stay instant.
// ===========================================================================
test('C4 regression: annotation controls, motion contracts, palette at 640/820/1440', async () => {
  test.setTimeout(420000);

  // (a) Phase-24 annotation text controls all live.
  {
    const app = await launchApp();
    const win = await app.firstWindow();
    try {
      await win.waitForSelector('.sample-card', { timeout: 30000 });
      await openReport(app, win);
      await placeTextbox(win, 'P25-C4', 0.6, 0.2);
      expect(await win.getAttribute('[data-text-panel]', 'data-text-panel-mode')).toBe('annotation');
      const dis = await controlDisabledMap(win);
      const missing = Object.entries(dis).filter(([, v]) => v === 'MISSING').map(([k]) => k);
      const disabled = Object.entries(dis).filter(([, v]) => v !== 'MISSING' && v.disabled).map(([k]) => k);
      log('C4-controls', { missing, disabled });
      expect(missing, 'every Phase-24 control mounted for an annotation').toEqual([]);
      expect(disabled.filter((s) => !ENGINE_DISABLED.includes(s)), 'only value-disabled indent-dec besides Tz')
        .toEqual(['[data-txt-indent-dec]']);
      expect(dis['[data-txt-character-spacing]'].disabled, 'char spacing live (Phase 27)').toBe(false);
    } finally {
      await hardClose(app, 'p25-c4a');
    }
  }

  // (b) animations off -> panel open is instant (0 intermediate frames).
  {
    const ud = seedDir('off', { animationsEnabled: false });
    const app = await launchApp([], ud);
    const win = await app.firstWindow();
    try {
      await win.waitForSelector('.sample-card', { timeout: 30000 });
      expect(await win.evaluate(() => document.documentElement.dataset.animations), 'animations-off flag').toBe('off');
      await openReport(app, win);
      await armAnnotationTool(win, 'select');
      await installPanelProbe(win);
      const rows = await probePanel(win, 900, async () => { await armAnnotationTool(win, 'textbox'); });
      const s = panelSummary(rows);
      log('C4-anim-off', s);
      expect(s.frames, 'animations off: panel sampled').toBeGreaterThan(10);
      expect(s.intermediates, 'animations off: panel opens instantly (0 intermediate frames)').toBe(0);
      // Phase 38 feature C — the panel's one home is the Inspector (264px); its
      // in-flow text surface is 216px. Assert it reaches that open width.
      expect(s.end && s.end.w, 'animations off: the Inspector text surface reaches its open width').toBeGreaterThan(180);
    } finally {
      await hardClose(app, 'p25-c4b');
    }
  }

  // (c) reduced motion -> panel open is instant.
  {
    const app = await launchApp();
    const win = await app.firstWindow();
    try {
      await win.waitForSelector('.sample-card', { timeout: 30000 });
      const cdp = await win.context().newCDPSession(win);
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
      });
      expect(await win.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), 'reduced motion emulated').toBe(true);
      await openReport(app, win);
      await armAnnotationTool(win, 'select');
      await installPanelProbe(win);
      const rows = await probePanel(win, 900, async () => { await armAnnotationTool(win, 'textbox'); });
      const s = panelSummary(rows);
      log('C4-reduced', s);
      expect(s.intermediates, 'reduced motion: panel opens instantly').toBe(0);
      // Phase 38 feature C — the Inspector text surface is 216px.
      expect(s.end && s.end.w, 'reduced motion: the Inspector text surface reaches its open width').toBeGreaterThan(180);
    } finally {
      await hardClose(app, 'p25-c4c');
    }
  }
});
