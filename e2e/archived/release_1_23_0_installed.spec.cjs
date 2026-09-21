// Release 1.23.0 - INSTALLED-app release gate (qa), explicitly ordered by the
// orchestrator. Launches the NSIS-installed %LOCALAPPDATA%\Programs\TFlex\TFlex.exe
// through the canonical launchApp() from e2e/lib/launch.cjs and verifies, on
// that installed build:
//
//   0. VERSION GATE - app.getVersion() === '1.23.0' (first test, serial: a
//      mismatch aborts every remaining test).
//   1. PHASE 25 - the text-properties panel floats (absolute/fixed, inside
//      .workspace-main, header-less), never reflows the page (frame-sampled
//      canvas rect + scrollTop spans), and drags by its grip.
//   2. PHASE 26 - no in-canvas editor mounts on place or double-click; the
//      panel Text field is the live editor (page text follows the field).
//   3. PHASE 27 - character spacing bakes `Tc` into the saved stream and the
//      bundled DejaVu Serif family (real /FontFile2) survives save/reopen; the
//      family dropdown offers exactly six families.
//   4. PHASE 28 - the arrow leader stops at the head base in all three themes;
//      a shape moves + recolours LIVE with no Confirm click and Cancel reverts
//      both; the action bar's colour box opens on a single click and
//      pink/teal/gray apply; a comment + reply persist with the icon only on
//      the commented element.
//   5. PHASE 29 - the canvas is flush (0 padding/gutter) in all three themes
//      and thumbnail/ruler page jumps land.
//   6. REGRESSIONS - DEF-214 annotation toolbar guard + watermark apply/delete.
//
// Screenshots: screenshots/release-1230-{panel,comments,arrow,flush}.png
//
// Run: npm.cmd run test:e2e -- e2e/release_1_23_0_installed.spec.cjs
// The installed path can be overridden with TFLEX_PACKAGED_EXE.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { inflateSync } = require('node:zlib');
const { PDFDocument, PDFRawStream } = require('pdf-lib');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const {
  hardClose, dismissUpdatePrompt, armAnnotationTool, openSamplePath, scrollToPage,
} = require('./lib/helpers.cjs');

const PACKAGED_EXE =
  process.env.TFLEX_PACKAGED_EXE ||
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'TFlex', 'TFlex.exe');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const log = (label, obj) => console.log(`[release-1230|${label}] ${JSON.stringify(obj)}`);
const THEMES = ['light', 'dark', 'frosted'];

test.setTimeout(360000);
test.describe.configure({ mode: 'serial' });

async function withApp(fn, { label = 'release-1230' } = {}) {
  const app = await launchApp([], null, PACKAGED_EXE);
  const win = await app.firstWindow();
  const consoleErrors = [];
  const pageErrors = [];
  win.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
  win.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  await win.waitForSelector('.sample-card', { timeout: 40000 });
  await dismissUpdatePrompt(win);
  try {
    return await fn(win, { consoleErrors, pageErrors }, app);
  } finally {
    await hardClose(app, label);
  }
}

async function shot(win, name, clip) {
  const p = path.join(SHOTS, name);
  await win.screenshot(clip ? { path: p, clip } : { path: p });
  console.log(`[release-1230] shot ${name}`);
  return p;
}

async function setSize(app, win, w, h) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const w2 = BrowserWindow.getAllWindows()[0];
    if (w2) w2.setSize(s[0], s[1]);
  }, [w, h]);
  await win.waitForTimeout(500);
}

async function openPath(app, win, absPath) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, absPath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(600);
}

const openReport = (app, win) => openPath(app, win, getSamplePath('report.pdf'));

async function setTheme(win, theme) {
  const cur = await win.evaluate(() => document.documentElement.dataset.theme);
  if (cur === theme) return;
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${theme}"]`);
  await win.waitForFunction((t) => document.documentElement.dataset.theme === t, theme, { timeout: 6000 });
  await win.waitForTimeout(400);
}

async function dragOnPage(win, fx, fy, dxPx = 190, dyPx = 60, page = 1) {
  const pg = await win.locator(`.pdf-page[data-page="${page}"]`).boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 240));
  const y = Math.max(40, Math.min(pg.y + pg.height * fy, vp.h - 110));
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dxPx, y + dyPx, { steps: 6 });
  await win.mouse.up();
  return { x, y };
}

async function saveAs(app, win, savePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-confirm]', { timeout: 8000 });
  await win.click('[data-save-as-confirm]');
  await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 40000 });
  expect(fs.existsSync(savePath), 'saved PDF must exist on disk').toBe(true);
}

async function closeAndReopen(app, win, savePath) {
  await win.locator('.tab-active .tab-close').click();
  await win.waitForTimeout(1500);
  await openSamplePath(win, app, savePath);
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(2500);
}

// ---- engine reads ----------------------------------------------------------
const annModels = (win) => win.evaluate(() => {
  const st = window.tflexDiagnostics().engineState;
  if (!st || !st.annotations) return [];
  return st.annotations.map((a) => ({
    id: a.id, kind: a.kind, page: a.page, color: a.color ?? null,
    rect: a.rect ?? null, text: a.text ?? a.content ?? null, style: a.style ?? null,
  }));
});

async function waitForAnn(win, pred, timeout = 15000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    const a = (await annModels(win)).find(pred);
    last = a;
    if (a) return a;
    await win.waitForTimeout(150);
  }
  return last;
}

const boxModels = (win) => win.evaluate(() => {
  const st = window.tflexDiagnostics().engineState;
  if (!st || !st.textBoxes) return [];
  return st.textBoxes.map((b) => ({
    id: b.id, text: b.text, font: b.font, charSpacing: b.charSpacing ?? null,
  }));
});

async function waitForBox(win, text, pred, timeout = 20000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    const b = (await boxModels(win)).find((x) => x.text === text);
    last = b;
    if (b && (pred ? pred(b) : true)) return b;
    await win.waitForTimeout(150);
  }
  return last;
}

async function panelState(win) {
  return win.evaluate(() => {
    const p = document.querySelector('.text-props-panel');
    if (!p) return null;
    const q = (s) => p.querySelector(s);
    const pressed = (s) => q(s)?.getAttribute('aria-pressed') === 'true';
    return {
      mode: document.querySelector('[data-text-panel]')?.getAttribute('data-text-panel-mode') ?? null,
      font: q('[data-txt-font]')?.value ?? null,
      charSpacing: q('[data-txt-character-spacing]')?.value ?? null,
      charSpacingDisabled: q('[data-txt-character-spacing]')?.disabled ?? null,
      familyOptions: Array.from(q('[data-txt-font]')?.options ?? []).map((o) => o.value),
      textDisabled: q('[data-txt-text]')?.disabled ?? null,
      textValue: q('[data-txt-text]')?.value ?? null,
      bold: pressed('[data-txt-bold]'),
    };
  });
}

async function waitForPanel(win, pred, timeout = 12000) {
  const t0 = Date.now();
  let s = null;
  while (Date.now() - t0 < timeout) {
    s = await panelState(win);
    if (s && pred(s)) return s;
    await win.waitForTimeout(150);
  }
  return s;
}

async function fillPanelText(win, text) {
  await win.waitForSelector('.text-props-panel [data-txt-text]', { timeout: 15000 });
  await win.waitForFunction(() => {
    const ta = document.querySelector('[data-txt-text]');
    return ta !== null && ta.disabled === false;
  }, null, { timeout: 15000 });
  await win.locator('[data-txt-text]').fill(text);
  await win.locator('[data-txt-text]').blur();
}

// ---- saved-file decoding ---------------------------------------------------
async function decodedStreams(filePath) {
  const bytes = fs.readFileSync(filePath);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const out = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      const raw = obj.contents;
      let txt = '';
      try { txt = new TextDecoder('latin1').decode(inflateSync(raw)); }
      catch { try { txt = new TextDecoder('latin1').decode(raw); } catch { txt = ''; } }
      out.push(txt);
    }
  }
  return out;
}

function tcStreams(streams, value) {
  const re = new RegExp('(?:^|\\s)' + String(value).replace('.', '\\.') + ' Tc(?:\\s|$)');
  return streams.filter((s) => re.test(s) && /BT/.test(s) && /Tj/.test(s)).length;
}

async function fontEvidence(filePath) {
  const doc = await PDFDocument.load(fs.readFileSync(filePath), { ignoreEncryption: true, updateMetadata: false });
  let fontFile2 = 0;
  const baseFonts = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const s = obj.toString();
    if (s.includes('FontFile2')) fontFile2 += 1;
    const m = /\/BaseFont\s*\/([^\s/]+)/.exec(s);
    if (m) baseFonts.push(m[1]);
  }
  return { fontFile2, baseFonts };
}


// ===========================================================================
// 0. VERSION GATE
// ===========================================================================
test('VERSION GATE: installed build reports app.getVersion() 1.23.0', async () => {
  await withApp(async (win, ctx, app) => {
    const version = await app.evaluate(async ({ app: a }) => a.getVersion());
    console.log(`[release-1230] app.getVersion() = ${JSON.stringify(version)} (exe: ${PACKAGED_EXE})`);
    expect(version, 'installed build version').toBe('1.23.0');
  }, { label: 'release-1230-version' });
});

// ===========================================================================
// 1. PHASE 25 - panel floats, no reflow, draggable
// ===========================================================================
async function panelRects(win) {
  return win.evaluate(() => {
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        left: +b.left.toFixed(1), top: +b.top.toFixed(1), right: +b.right.toFixed(1),
        bottom: +b.bottom.toFixed(1), width: +b.width.toFixed(1), height: +b.height.toFixed(1),
      };
    };
    const float = document.querySelector('[data-text-panel-float]');
    return {
      panel: r(document.querySelector('.text-props-panel')),
      main: r(document.querySelector('.workspace-main')),
      slot: r(document.querySelector('.page-slot[data-page="1"]')),
      position: float ? getComputedStyle(float).position : null,
    };
  });
}

async function installPageProbe(win) {
  await win.evaluate(() => {
    window.__r1230 = { rows: [], running: false };
    window.__r1230Start = (ms) => {
      window.__r1230 = { rows: [], running: true };
      const t0 = performance.now();
      const tick = () => {
        const pane = document.querySelector('.tab-pane[aria-hidden="false"]') || document;
        const canvas = pane.querySelector('.pdf-page[data-page="1"] canvas');
        const sc = document.querySelector('.document-scroller');
        const cb = canvas ? canvas.getBoundingClientRect() : null;
        window.__r1230.rows.push({
          cl: cb ? +cb.left.toFixed(2) : null,
          ct: cb ? +cb.top.toFixed(2) : null,
          cw: cb ? +cb.width.toFixed(2) : null,
          st: sc ? +sc.scrollTop.toFixed(2) : null,
        });
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else window.__r1230.running = false;
      };
      requestAnimationFrame(tick);
    };
  });
}

async function readPageProbe(win) {
  await win.waitForFunction(() => window.__r1230.running === false, null, { timeout: 15000 }).catch(() => {});
  return win.evaluate(() => window.__r1230.rows);
}

function span(rows, key) {
  const vals = rows.map((r) => r[key]).filter((v) => v !== null);
  if (!vals.length) return null;
  return +(Math.max(...vals) - Math.min(...vals)).toFixed(2);
}

async function dragGrip(win, dx, dy) {
  const g = await win.locator('[data-text-panel-grip]').boundingBox();
  const x = g.x + g.width / 2;
  const y = g.y + g.height / 2;
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dx, y + dy, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(400);
}

test('PHASE 25: panel floats (header-less, inside page view), no reflow, drags', async () => {
  await withApp(async (win, ctx, app) => {
    await setSize(app, win, 1440, 900);
    await openReport(app, win);
    await armAnnotationTool(win, 'textbox');
    await win.waitForSelector('.text-props-panel', { timeout: 10000 });
    await win.waitForTimeout(500);

    const dom = await win.evaluate(() => {
      const float = document.querySelector('[data-text-panel-float]');
      const main = document.querySelector('.workspace-main');
      return {
        hasHeader: !!document.querySelector('.text-props-header'),
        hasTitle: !!document.querySelector('.text-props-title'),
        grip: !!document.querySelector('[data-text-panel-grip]'),
        floatInsideMain: float !== null && main !== null && main.contains(float),
        position: float ? getComputedStyle(float).position : null,
      };
    });
    log('p25-dom', dom);
    expect(dom.hasHeader, 'no header element').toBe(false);
    expect(dom.hasTitle, 'no title element').toBe(false);
    expect(dom.grip, 'grip strip present').toBe(true);
    expect(dom.floatInsideMain, 'float wrapper is inside .workspace-main').toBe(true);
    expect(dom.position, 'panel is a floating card (absolute/fixed)').toMatch(/absolute|fixed/);

    // Open/close while frame-sampling the page geometry.
    await armAnnotationTool(win, 'select');
    await win.waitForSelector('.text-props-panel', { state: 'detached', timeout: 8000 }).catch(() => {});
    await win.waitForTimeout(600);
    await installPageProbe(win);
    await win.evaluate(() => window.__r1230Start(2800));
    await armAnnotationTool(win, 'textbox');
    await win.waitForTimeout(1000);
    const open = await panelRects(win);
    const rows = await readPageProbe(win);
    const spans = {
      canvasLeft: span(rows, 'cl'), canvasTop: span(rows, 'ct'),
      canvasWidth: span(rows, 'cw'), scrollTop: span(rows, 'st'),
    };
    const m = open.main;
    const inside = open.panel && m
      && open.panel.left >= m.left - 2 && open.panel.top >= m.top - 2
      && open.panel.right <= m.right + 2 && open.panel.bottom <= m.bottom + 2;
    log('p25-noreflow', { frames: rows.length, spans, inside, panel: open.panel });
    expect(rows.length, 'probe sampled frames').toBeGreaterThan(30);
    expect(spans.canvasLeft, 'canvas left unchanged while the panel opens').toBeLessThanOrEqual(0.5);
    expect(spans.canvasTop, 'canvas top unchanged').toBeLessThanOrEqual(0.5);
    expect(spans.canvasWidth, 'canvas width unchanged').toBeLessThanOrEqual(0.5);
    expect(spans.scrollTop, 'scroller scrollTop unchanged').toBeLessThanOrEqual(0.5);
    expect(inside, 'open panel floats inside the page view').toBe(true);

    // Drag by the grip: the card moves, the page does not.
    const before = await panelRects(win);
    await dragGrip(win, -70, 90);
    const after = await panelRects(win);
    const movedX = +(after.panel.left - before.panel.left).toFixed(1);
    const movedY = +(after.panel.top - before.panel.top).toFixed(1);
    const pageDx = +(after.slot.left - before.slot.left).toFixed(1);
    const pageDy = +(after.slot.top - before.slot.top).toFixed(1);
    log('p25-drag', { movedX, movedY, pageDx, pageDy });
    expect(Math.abs(movedX) > 20 || Math.abs(movedY) > 15, 'grip drag moves the card').toBe(true);
    expect(Math.abs(pageDx), 'page does not reflow on panel drag (x)').toBeLessThan(1.5);
    expect(Math.abs(pageDy), 'page does not reflow on panel drag (y)').toBeLessThan(1.5);

    await shot(win, 'release-1230-panel.png');
    expect(ctx.pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, { label: 'release-1230-p25' });
});

// ===========================================================================
// 2. PHASE 26 - no in-canvas editor; the panel Text field is live
// ===========================================================================
const RETIRED_SELECTORS = [
  '[data-annotation-editor]',
  '[data-annotation-editor-wrap]',
  '[data-ann-color-edit]',
  '.edit-inline-editor',
  '.shape-color-editor',
];

async function editorCounts(win) {
  return win.evaluate((sels) => {
    const out = {};
    for (const s of sels) out[s] = document.querySelectorAll(s).length;
    const layer = document.querySelector('.annotation-layer');
    // The Phase-28 comment box's own textarea is a legitimate control.
    out['layer-textareas'] = layer ? layer.querySelectorAll('textarea:not(.ann-comment-input)').length : -1;
    out['edit-textareas'] = document.querySelectorAll('.edit-layer textarea').length;
    return out;
  }, RETIRED_SELECTORS);
}

const overlayText = (win) => win.evaluate(() => {
  const el = document.querySelector('.ann-textbox[data-kind="textbox"]');
  if (!el) return null;
  const span = el.querySelector('.ann-text-content');
  return span ? span.textContent : el.textContent;
});

test('PHASE 26: no in-canvas editor; the panel Text field edits live', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    await armAnnotationTool(win, 'textbox');
    await dragOnPage(win, 0.3, 0.25, 190, 60);
    await win.waitForSelector('.text-props-panel [data-txt-text]', { timeout: 10000 });
    await win.waitForFunction(() => {
      const ta = document.querySelector('[data-txt-text]');
      return ta !== null && ta.disabled === false;
    }, null, { timeout: 10000 });

    const countsOnPlace = await editorCounts(win);
    log('p26-place', countsOnPlace);
    for (const [sel, n] of Object.entries(countsOnPlace)) {
      expect(n, `no in-canvas editor on place (${sel})`).toBe(0);
    }

    await fillPanelText(win, 'R1230-P26');
    await win.waitForSelector('.ann-textbox[data-kind="textbox"]', { timeout: 10000 });
    const placed = await waitForAnn(win, (a) => a.text === 'R1230-P26', 15000);
    expect(placed && placed.text, 'engine holds the panel-typed text').toBe('R1230-P26');

    // Double-click the committed element: still no in-canvas editor.
    const bb = await win.locator('.ann-textbox[data-kind="textbox"]').first().boundingBox();
    await win.mouse.dblclick(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.waitForTimeout(600);
    const countsOnDbl = await editorCounts(win);
    log('p26-dblclick', countsOnDbl);
    for (const [sel, n] of Object.entries(countsOnDbl)) {
      expect(n, `no in-canvas editor on double-click (${sel})`).toBe(0);
    }

    // Deselect, then click the element: the panel field focuses and typing is
    // live on the page.
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.mouse.click(pg.x + pg.width * 0.9, pg.y + pg.height * 0.9);
    await win.waitForTimeout(500);
    await win.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.waitForTimeout(700);
    const st = await panelState(win);
    log('p26-focus', st);
    expect(st.mode, 'panel in annotation mode').toBe('annotation');
    expect(st.textValue, 'field reflects the element text').toBe('R1230-P26');
    await win.keyboard.type('LIVE');
    await win.waitForTimeout(300);
    const live = await overlayText(win);
    log('p26-live', { live });
    expect(live, 'page text follows the panel field live').toBe('LIVE');
    await win.locator('[data-txt-text]').blur();
    const committed = await waitForAnn(win, (a) => a.text === 'LIVE', 15000);
    log('p26-commit', committed && committed.text);
    expect(committed && committed.text, 'blur commits the panel edit to the engine').toBe('LIVE');

    expect(ctx.pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, { label: 'release-1230-p26' });
});

// ===========================================================================
// 3. PHASE 27 - char spacing Tc + bundled font survive save/reopen; 6 families
// ===========================================================================
const SIX_FAMILIES = ['Helvetica', 'Times', 'Courier', 'Liberation Sans', 'DejaVu Serif', 'DejaVu Sans Mono'];

test('PHASE 27: char spacing bakes Tc; bundled font survives save/reopen; 6 families', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    await armAnnotationTool(win, 'textbox');
    await dragOnPage(win, 0.3, 0.25, 190, 60);
    await fillPanelText(win, 'R1230-TC');
    await win.waitForSelector('.ann-textbox[data-kind="textbox"]', { timeout: 10000 });
    await waitForAnn(win, (a) => a.text === 'R1230-TC', 15000);

    const ps0 = await waitForPanel(win, (s) => s.familyOptions.length > 0);
    log('p27-families', ps0 && ps0.familyOptions);
    expect(ps0 && ps0.familyOptions, 'dropdown offers exactly the six families').toEqual(SIX_FAMILIES);
    expect(ps0.charSpacingDisabled, 'char-spacing control is enabled').toBe(false);

    await win.locator('[data-txt-font]').selectOption('DejaVu Serif');
    await win.locator('[data-txt-character-spacing]').fill('6');
    const styled = await waitForAnn(
      win,
      (a) => a.text === 'R1230-TC' && a.style && a.style.font === 'DejaVu Serif' && a.style.charSpacing === 6,
      20000,
    );
    log('p27-styled', styled && styled.style);
    expect(styled && styled.style && styled.style.charSpacing, 'engine annotation charSpacing').toBe(6);
    expect(styled && styled.style && styled.style.font, 'engine annotation font').toBe('DejaVu Serif');

    const p = path.join(os.tmpdir(), `r1230-p27-${Date.now()}.pdf`);
    await saveAs(app, win, p);
    const streams = await decodedStreams(p);
    const tc = tcStreams(streams, 6);
    const ev = await fontEvidence(p);
    log('p27-saved', { tc, fontFile2: ev.fontFile2, baseFonts: ev.baseFonts.filter((n) => n.startsWith('TFlex')) });
    expect(tc, 'saved appearance stream carries `6 Tc` inside a text object').toBeGreaterThan(0);
    expect(ev.fontFile2, 'saved PDF embeds a real TrueType program').toBeGreaterThanOrEqual(1);
    expect(ev.baseFonts.some((n) => n.startsWith('TFlexDejaVuSerif')), 'DejaVu Serif subset embedded').toBe(true);

    await closeAndReopen(app, win, p);
    const rt = await waitForAnn(
      win,
      (a) => a.text === 'R1230-TC' && a.style && a.style.charSpacing === 6,
      25000,
    );
    log('p27-reopen', rt && rt.style);
    expect(rt, 'styled annotation survives save/reopen').toBeTruthy();
    expect(rt.style.charSpacing, 'charSpacing survives reopen').toBe(6);
    expect(rt.style.font, 'bundled font survives reopen').toBe('DejaVu Serif');

    expect(ctx.pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, { label: 'release-1230-p27' });
});

// ===========================================================================
// 4a. PHASE 28 - the arrow leader stops at the head base (3 themes)
// ===========================================================================
async function arrowGeom(win) {
  return win.evaluate(() => {
    const g = document.querySelector('.ann-arrow[data-annotation-id]');
    if (g === null) return null;
    const vis = g.querySelector('line:not(.ann-arrow-hit)');
    const hit = g.querySelector('.ann-arrow-hit');
    const poly = g.querySelector('polygon:not(.ann-arrow-head-hit)');
    const pts = poly ? poly.getAttribute('points').split(' ').map((s) => s.split(',').map(Number)) : null;
    const n = (el, a) => Number(el.getAttribute(a));
    return {
      from: { x: n(vis, 'x1'), y: n(vis, 'y1') },
      visEnd: { x: n(vis, 'x2'), y: n(vis, 'y2') },
      hitEnd: { x: n(hit, 'x2'), y: n(hit, 'y2') },
      tip: pts ? { x: pts[0][0], y: pts[0][1] } : null,
    };
  });
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('PHASE 28: arrow leader ends at the head base in all three themes', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    await armAnnotationTool(win, 'arrow');
    await dragOnPage(win, 0.25, 0.25, 230, 120);
    await win.waitForSelector('.ann-arrow[data-annotation-id]', { timeout: 12000 });
    await win.waitForTimeout(600);

    const rows = [];
    for (const theme of THEMES) {
      await setTheme(win, theme);
      await win.waitForTimeout(300);
      const g = await arrowGeom(win);
      expect(g, `${theme}: arrow geometry present`).toBeTruthy();
      const shaftLen = dist(g.from, g.visEnd);
      const fullLen = dist(g.from, g.tip);
      const baseGap = dist(g.visEnd, g.tip);
      const hitGap = dist(g.hitEnd, g.tip);
      const expected = 9 * Math.cos((28 * Math.PI) / 180);
      rows.push({
        theme, shaftLen: +shaftLen.toFixed(3), fullLen: +fullLen.toFixed(3),
        baseGap: +baseGap.toFixed(3), hitGap: +hitGap.toFixed(3), expected: +expected.toFixed(3),
      });
      if (theme === 'light') {
        const bb = await win.locator('.ann-arrow[data-annotation-id]').boundingBox();
        await shot(win, 'release-1230-arrow.png', {
          x: Math.max(0, bb.x - 16), y: Math.max(0, bb.y - 16),
          width: Math.min(bb.width + 32, 900), height: Math.min(bb.height + 32, 700),
        });
      }
    }
    log('p28-arrow', rows);
    for (const r of rows) {
      expect(r.baseGap, `${r.theme}: visible shaft stops at the head base`).toBeGreaterThan(0.5);
      expect(Math.abs(r.baseGap - r.expected), `${r.theme}: gap equals the head axial length`).toBeLessThan(0.6);
      expect(r.shaftLen, `${r.theme}: shaft shorter than the full leader`).toBeLessThan(r.fullLen - 0.5);
      expect(r.hitGap, `${r.theme}: invisible hit line still reaches the tip`).toBeLessThan(0.01);
    }
    expect(ctx.pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, { label: 'release-1230-p28-arrow' });
});

// ===========================================================================
// 4b. PHASE 28 - live move + colour (no Confirm); Cancel reverts; the colour
//     box opens on a single click; pink/teal/gray apply.
// ===========================================================================
const cssScale = (win) => win.evaluate(() => {
  const page = document.querySelector('.pdf-page[data-page="1"]');
  const m = page.querySelector('.annotation-layer svg').getScreenCTM();
  return m.a;
});

test('PHASE 28: live move+colour without Confirm, Cancel reverts, colour box picks', async () => {
  await withApp(async (win, ctx, app) => {
    await setSize(app, win, 1440, 900);
    await openReport(app, win);
    await armAnnotationTool(win, 'rect');
    await dragOnPage(win, 0.3, 0.3, 180, 80);
    await win.waitForSelector('.ann-shape[data-kind="rect"]', { timeout: 12000 });
    await win.waitForTimeout(700);
    const scale = await cssScale(win);

    const shape = win.locator('.ann-shape[data-kind="rect"]').first();
    let bb = await shape.boundingBox();
    await win.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.waitForSelector('[data-content-action-bar="ann-rect"]', { timeout: 10000 });
    await win.waitForTimeout(400);

    const bar = await win.evaluate(() => {
      const el = document.querySelector('[data-content-action-bar="ann-rect"]');
      const kids = [...el.querySelectorAll('button')].map((b) => ({
        action: b.getAttribute('data-content-action'),
        colorBox: b.hasAttribute('data-ann-color-box'),
        left: +b.getBoundingClientRect().left.toFixed(1),
      }));
      return {
        kids, editText: el.textContent.includes('Edit'),
        editBtn: el.querySelectorAll('[data-content-action$="-edit"]').length,
      };
    });
    log('p28-bar', bar);
    expect(bar.editBtn, 'no Edit text button in the action bar').toBe(0);
    expect(bar.editText, 'no "Edit" label in the bar').toBe(false);
    expect(bar.kids.filter((k) => k.colorBox).length, 'exactly one colour box').toBe(1);
    const confirm = bar.kids.find((k) => (k.action || '').endsWith('-confirm'));
    const colorBox = bar.kids.find((k) => k.colorBox);
    const cancel = bar.kids.find((k) => (k.action || '').endsWith('-cancel'));
    const del = bar.kids.find((k) => (k.action || '').endsWith('-delete'));
    expect(confirm && colorBox && cancel && del, 'Confirm/colour/Cancel/Delete all present').toBeTruthy();
    expect(confirm.left < colorBox.left && colorBox.left < cancel.left && cancel.left < del.left,
      'order is Confirm | colour box | Cancel | Delete').toBe(true);

    // A SINGLE click opens the picker.
    await win.click('[data-ann-color-box]');
    await win.waitForSelector('[data-color-popover]', { timeout: 8000 });
    const openAfterOne = await win.locator('[data-color-popover]').count();
    log('p28-single-click', { openAfterOne });
    expect(openAfterOne, 'a single click opens the colour picker').toBeGreaterThan(0);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);

    const original = await waitForAnn(win, (a) => a.kind === 'rect');
    log('p28-original', { rect: original.rect, color: original.color, scale: +scale.toFixed(3) });

    // Drag: pointerup must commit immediately (no Confirm click).
    await win.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.mouse.down();
    await win.mouse.move(bb.x + bb.width / 2 + 80, bb.y + bb.height / 2 + 50, { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(1600);
    const moved = await waitForAnn(win, (a) => a.kind === 'rect' && Math.abs(a.rect.x - original.rect.x) > 1);
    const gotDx = moved ? moved.rect.x - original.rect.x : null;
    const gotDy = moved ? moved.rect.y - original.rect.y : null;
    log('p28-moved', { gotDx, gotDy, expDx: +(80 / scale).toFixed(2), expDy: +(50 / scale).toFixed(2) });
    expect(moved, 'move committed with no Confirm click').toBeTruthy();
    expect(Math.abs(gotDx - 80 / scale), 'live move x matches the mouse delta').toBeLessThan(3);
    expect(Math.abs(gotDy - 50 / scale), 'live move y matches the mouse delta').toBeLessThan(3);
    expect(await win.locator('[data-content-action-bar="ann-rect"]').count(), 'bar stays after the commit').toBeGreaterThan(0);

    // Colour picks apply live, including the DEF-260 pink/teal/gray set.
    const pickColor = async (color) => {
      if ((await win.locator('[data-color-popover]').count()) === 0) {
        await win.click('[data-ann-color-box]');
        await win.waitForSelector('[data-color-popover]', { timeout: 8000 });
      }
      await win.click(`[data-palette-built-in="${color}"]`);
      await win.waitForTimeout(1300);
    };
    const picks = {};
    for (const c of ['pink', 'teal', 'gray']) {
      await pickColor(c);
      const a = await waitForAnn(win, (x) => x.kind === 'rect' && x.color === c, 10000);
      picks[c] = a ? a.color : (await waitForAnn(win, (x) => x.kind === 'rect')).color;
    }
    log('p28-picks', picks);
    for (const c of ['pink', 'teal', 'gray']) {
      expect(picks[c], `picking ${c} applies to the selected annotation`).toBe(c);
    }
    const colored = await waitForAnn(win, (a) => a.kind === 'rect');
    expect(Math.abs(colored.rect.x - moved.rect.x), 'colour picks retain the move (x)').toBeLessThan(1.5);

    // Cancel reverts BOTH the move and the colour.
    await win.click('[data-content-action="ann-rect-cancel"]');
    await win.waitForTimeout(1800);
    const reverted = await waitForAnn(win, (a) => a.kind === 'rect' && a.color === original.color, 10000);
    log('p28-cancel', { rect: reverted && reverted.rect, color: reverted && reverted.color });
    expect(reverted, 'Cancel restores the original colour').toBeTruthy();
    expect(Math.abs(reverted.rect.x - original.rect.x), 'Cancel reverts the move (x)').toBeLessThan(1.5);
    expect(Math.abs(reverted.rect.y - original.rect.y), 'Cancel reverts the move (y)').toBeLessThan(1.5);

    // Second session: move + colour, then Confirm keeps both and dismisses.
    bb = await shape.boundingBox();
    await win.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.waitForSelector('[data-content-action-bar="ann-rect"]', { timeout: 10000 });
    await win.waitForTimeout(400);
    await win.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.mouse.down();
    await win.mouse.move(bb.x + bb.width / 2 + 60, bb.y + bb.height / 2 + 40, { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(1500);
    await pickColor('green');
    const kept = await waitForAnn(win, (a) => a.kind === 'rect' && a.color === 'green', 10000);
    expect(kept, 'green pick applied').toBeTruthy();
    await win.click('[data-content-action="ann-rect-confirm"]');
    await win.waitForTimeout(1500);
    const afterConfirm = await waitForAnn(win, (a) => a.kind === 'rect');
    log('p28-confirm', { color: afterConfirm.color, rect: afterConfirm.rect,
      bar: await win.locator('[data-content-action-bar="ann-rect"]').count() });
    expect(afterConfirm.color, 'Confirm keeps the colour').toBe('green');
    expect(Math.abs(afterConfirm.rect.x - kept.rect.x), 'Confirm keeps the move').toBeLessThan(1.5);
    expect(await win.locator('[data-content-action-bar="ann-rect"]').count(), 'Confirm dismisses the bar').toBe(0);

    expect(ctx.pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, { label: 'release-1230-p28-live' });
});

// ===========================================================================
// 4c. PHASE 28 - comment + reply persist; icon only on the commented element
// ===========================================================================
const commentThreads = (win) => win.evaluate(() =>
  (window.tflexDiagnostics().engineState || {}).comments || []);

test('PHASE 28: comment + reply persist; icon only on the commented element', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    await armAnnotationTool(win, 'rect');
    await dragOnPage(win, 0.3, 0.3, 170, 90);
    await win.waitForSelector('.ann-shape[data-kind="rect"]', { timeout: 12000 });
    await win.waitForTimeout(700);
    await dragOnPage(win, 0.62, 0.3, 140, 80);
    await win.waitForTimeout(900);
    const rects = (await annModels(win)).filter((a) => a.kind === 'rect');
    expect(rects.length, 'two rects placed').toBe(2);
    const [commented, plain] = rects;

    let bb = await win.locator(`.ann-shape[data-annotation-id="${commented.id}"]`).boundingBox();
    await win.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.waitForSelector(`[data-ann-comment-box="${commented.id}"]`, { timeout: 10000 });
    const empty = await win.locator('[data-comment-empty]').count();
    log('p28c-box', { empty, icons: await win.locator('[data-ann-comment-icon]').count() });
    expect(empty, 'comment box shows the empty state').toBe(1);
    expect(await win.locator('[data-ann-comment-icon]').count(), 'no icon before any comment').toBe(0);

    await win.fill('[data-comment-input]', 'First comment');
    await win.click('[data-comment-submit]');
    await win.waitForTimeout(1400);
    const entries1 = await win.locator('[data-comment-entry]').count();
    const iconCount = await win.locator(`[data-ann-comment-icon="${commented.id}"]`).count();
    log('p28c-comment', { entries1, iconCount, threads: await commentThreads(win) });
    expect(entries1, 'comment appended').toBe(1);
    expect(iconCount, 'icon appears on the commented element').toBe(1);
    expect(await win.locator(`[data-ann-comment-icon="${plain.id}"]`).count(),
      'the comment-free annotation shows NO icon').toBe(0);

    await win.fill('[data-comment-input]', 'A reply');
    await win.click('[data-comment-submit]');
    await win.waitForTimeout(1400);
    const roles = await win.evaluate(() =>
      [...document.querySelectorAll('[data-comment-entry]')].map((e) => e.getAttribute('data-comment-role')));
    log('p28c-reply', { roles });
    expect(roles, 'reply appends after the original').toEqual(['original', 'reply']);
    await shot(win, 'release-1230-comments.png');

    const savePath = path.join(os.tmpdir(), `r1230-p28c-${Date.now()}.pdf`);
    await saveAs(app, win, savePath);
    await closeAndReopen(app, win, savePath);

    const reopened = (await annModels(win)).filter((a) => a.kind === 'rect');
    const threads = await commentThreads(win);
    const iconAfter = await win.locator('[data-ann-comment-icon]').count();
    log('p28c-reopen', { rects: reopened.length, threads, iconAfter });
    expect(reopened.length, 'both annotations survived save/reopen').toBe(2);
    expect(threads.length, 'comment thread persisted in the saved PDF').toBe(1);
    expect(threads[0].entries.length, 'both entries persisted').toBe(2);
    expect(iconAfter, 'the comment icon is still shown after reopen').toBe(1);

    const rid = threads[0].annotationId;
    const rbb = await win.locator(`.ann-shape[data-annotation-id="${rid}"]`).boundingBox();
    await win.mouse.click(rbb.x + rbb.width / 2, rbb.y + rbb.height / 2);
    await win.waitForSelector(`[data-ann-comment-box="${rid}"]`, { timeout: 10000 });
    await win.waitForTimeout(500);
    const reopenedEntries = await win.locator('[data-comment-entry]').count();
    log('p28c-reopen-select', { reopenedEntries });
    expect(reopenedEntries, 'reopened comment box shows the persisted thread').toBe(2);

    expect(ctx.pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, { label: 'release-1230-p28-comments' });
});

// ===========================================================================
// 5. PHASE 29 - flush canvas in all three themes; page jumps land
// ===========================================================================
async function settleScroll(win) {
  let prev = null;
  for (let i = 0; i < 40; i += 1) {
    const top = await win.evaluate(() => {
      const sc = document.querySelector('.document-scroller');
      return sc ? sc.scrollTop : null;
    });
    if (top !== null && prev !== null && Math.abs(top - prev) < 0.5) return top;
    prev = top;
    await win.waitForTimeout(150);
  }
  return prev;
}

async function thumbJump(win, n) {
  for (let i = 0; i < 40; i += 1) {
    const ok = await win.evaluate((want) => {
      const sc = document.querySelector('.thumb-scroller');
      if (!sc) return false;
      const btn = sc.querySelector(`button[data-page="${want}"]`);
      if (btn) { btn.scrollIntoView({ block: 'center' }); return true; }
      sc.scrollTop += 600;
      return false;
    }, n);
    await win.waitForTimeout(200);
    if (ok) break;
  }
  await win.click(`.thumb-scroller button[data-page="${n}"]`);
}

test('PHASE 29: flush canvas in all three themes; page jumps land', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    await win.evaluate(() => { const sc = document.querySelector('.document-scroller'); if (sc) sc.scrollTop = 0; });
    await win.waitForTimeout(600);
    const rows = [];
    for (const theme of THEMES) {
      await setTheme(win, theme);
      await win.evaluate(() => { const sc = document.querySelector('.document-scroller'); if (sc) sc.scrollTop = 0; });
      await win.waitForTimeout(500);
      const m = await win.evaluate(() => {
        const sc = document.querySelector('.document-scroller');
        const ct = document.querySelector('.document-content');
        const slot = document.querySelector('.page-slot[data-page="1"]');
        const cs = (el) => {
          const s = getComputedStyle(el);
          return { pt: s.paddingTop, pb: s.paddingBottom, pl: s.paddingLeft, pr: s.paddingRight,
            mt: s.marginTop, mb: s.marginBottom, ml: s.marginLeft, mr: s.marginRight };
        };
        const scR = sc.getBoundingClientRect();
        const ctR = ct.getBoundingClientRect();
        const slR = slot.getBoundingClientRect();
        return { theme: document.documentElement.dataset.theme, scroller: cs(sc), content: cs(ct),
          slotTopGap: +(slR.top - scR.top).toFixed(2),
          contentTopGap: +(ctR.top - scR.top).toFixed(2),
          contentLeftGap: +(ctR.left - scR.left).toFixed(2) };
      });
      rows.push(m);
      if (theme === 'light') await shot(win, 'release-1230-flush.png');
    }
    log('p29-flush', rows);
    for (const r of rows) {
      for (const [k, v] of Object.entries(r.scroller)) {
        expect(v, `${r.theme}: .document-scroller ${k} is 0`).toMatch(/^0(px)?$/);
      }
      for (const [k, v] of Object.entries(r.content)) {
        expect(v, `${r.theme}: .document-content ${k} is 0`).toMatch(/^0(px)?$/);
      }
      expect(Math.abs(r.slotTopGap), `${r.theme}: page slot flush with the scroller top`).toBeLessThanOrEqual(1);
    }
  }, { label: 'release-1230-p29-flush' });

  // Page jumps on a long document (separate launch keeps the flush probe clean).
  await withApp(async (win, ctx, app) => {
    await openPath(app, win, getSamplePath('long.pdf'));
    const pageCount = await win.evaluate(() => window.tflexDiagnostics().engineState.pageCount);
    log('p29-jumps-doc', { pageCount });
    expect(pageCount, 'long.pdf has enough pages').toBeGreaterThan(20);

    const land = async (label, expectPage) => {
      await settleScroll(win);
      await win.waitForTimeout(400);
      const d = await win.evaluate(() => {
        const sc = document.querySelector('.document-scroller');
        const cur = window.tflexDiagnostics().currentPage;
        const slot = document.querySelector(`.page-slot[data-page="${cur}"]`);
        return { cur, drift: slot ? +(slot.getBoundingClientRect().top - sc.getBoundingClientRect().top).toFixed(2) : null };
      });
      log('p29-land', { label, expectPage, ...d });
      return d;
    };

    await thumbJump(win, 5);
    let d = await land('thumb-5', 5);
    expect(d.cur, 'thumbnail jump readout = 5').toBe(5);
    expect(Math.abs(d.drift), 'thumbnail jump scroll drift (px)').toBeLessThanOrEqual(2);

    await win.click('[data-rail-collapse]');
    await win.waitForSelector('[data-rail-ruler]', { timeout: 10000 });
    await win.waitForTimeout(400);
    await win.click('[data-ruler-page="20"]');
    d = await land('nav-20', 20);
    expect(d.cur, 'nav jump readout = 20').toBe(20);
    expect(Math.abs(d.drift), 'nav-20 scroll drift (px)').toBeLessThanOrEqual(2);

    await win.click(`[data-ruler-page="${pageCount}"]`);
    d = await land('nav-last', pageCount);
    expect(d.cur, `nav jump readout = ${pageCount}`).toBe(pageCount);
    expect(Math.abs(d.drift), 'last-page scroll drift (px)').toBeLessThanOrEqual(2);

    expect(ctx.pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, { label: 'release-1230-p29-jumps' });
});

// ===========================================================================
// 6. REGRESSIONS - DEF-214 annotation toolbar guard + watermark apply/delete
// ===========================================================================
test('REGRESSIONS: DEF-214 annotation toolbar + edit toggle; watermark apply/delete', async () => {
  await withApp(async (win, ctx, app) => {
    await setSize(app, win, 1440, 900);
    await openReport(app, win);

    // -- DEF-214: the annotation toolbar row is visible; the Edit toggle arms
    //    the edit toolbar.
    const ann = win.locator('.ann-toolbar');
    await ann.waitFor({ timeout: 15000, state: 'visible' });
    const annBox = await ann.boundingBox();
    expect(annBox, '.ann-toolbar non-null box').not.toBeNull();
    expect(annBox.height, '.ann-toolbar visible row').toBeGreaterThan(0);
    const editToggle = win.locator('[data-toolbar-edit-toggle]');
    expect(await editToggle.count(), 'exactly one edit toggle').toBe(1);
    await editToggle.click();
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
    const editBox = await win.locator('.edit-toolbar').boundingBox();
    expect(editBox, '.edit-toolbar mounted after arming Edit').not.toBeNull();
    await editToggle.click();
    await win.waitForTimeout(400);
    log('reg-def214', { ann: annBox, edit: editBox });

    // -- Watermark apply + delete.
    const palette = win.locator('[data-tools-palette]');
    if (!(await palette.isVisible().catch(() => false))) await win.locator('[data-tools-toggle]').first().click();
    await palette.waitFor({ state: 'visible', timeout: 15000 });
    await win.locator('[data-tool-id="watermark"]').click();
    await win.locator('[data-watermark-dialog]').waitFor({ state: 'visible', timeout: 10000 });
    await win.waitForTimeout(400);
    await win.locator('[data-watermark-text]').fill('CONFIDENTIAL');
    await win.locator('[data-watermark-confirm]').click();
    await win.waitForFunction(() => Array.from(document.querySelectorAll('.toast .toast-text'))
      .some((t) => (t.textContent || '').trim() === 'Watermark applied.'), null, { timeout: 15000 });
    if (!(await palette.isVisible().catch(() => false))) await win.locator('[data-tools-toggle]').first().click();
    await win.locator('[data-tool-id="watermark"]').click();
    await win.locator('[data-watermark-applied="wm-1"]').waitFor({ state: 'visible', timeout: 15000 });
    await win.locator('[data-watermark-delete="wm-1"]').click();
    await win.waitForFunction(() => Array.from(document.querySelectorAll('.toast .toast-text'))
      .some((t) => (t.textContent || '').trim() === 'Watermark deleted.'), null, { timeout: 15000 });
    await win.locator('[data-watermark-applied="wm-1"]').waitFor({ state: 'detached', timeout: 15000 });
    const wm = await win.evaluate(async () => {
      const id = window.tflexDiagnostics().engineDocId;
      const g = await window.tflex.engine.getWatermarks(id);
      return g.ok ? g.value.map((w) => w.id) : { err: g.error };
    });
    log('reg-watermark', wm);
    expect(Array.isArray(wm), 'getWatermarks ok').toBe(true);
    expect(wm).not.toContain('wm-1');

    expect(ctx.pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, { label: 'release-1230-regressions' });
});
