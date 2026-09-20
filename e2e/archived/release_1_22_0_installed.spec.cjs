// Release 1.22.0 - INSTALLED-app validation (qa), explicitly ordered by the
// orchestrator. Launches the NSIS-installed %LOCALAPPDATA%\Programs\TFlex\TFlex.exe
// through the canonical launchApp() from e2e/lib/launch.cjs and verifies, on that
// installed build:
//
//   0. VERSION GATE - app.getVersion() === '1.22.0' (test 1, serial: a mismatch
//      aborts every remaining test).
//   1. PHASE 24 - full text panel for annotation text objects: place a textbox
//      annotation, panel stays open (0 panel-false frames), font Times + size 18
//      + bold ON, Save As -> close -> reopen -> stored style + panel reflect it.
//   2. DEF-253 - single click on a placed annotation keeps the panel open.
//   3. DEF-254 - select an annotation on page 4; panel stays open while a
//      neighbouring page mounts/unmounts during the reflow.
//   4. DEF-255 - highlight -> save/reopen -> clear -> save/reopen: no duplicate,
//      highlight gone.
//   5. REGRESSIONS - Phase 21 edit-box panel controls, Phase 22 title-bar group,
//      Phase 23 animations OFF instant path, watermark apply/delete, DEF-214
//      annotation toolbar + edit toggle.
//
// Screenshot: screenshots/release-1220-phase24.png
//
// Run: npm.cmd run test:e2e -- e2e/release_1_22_0_installed.spec.cjs
// The installed path can be overridden with TFLEX_PACKAGED_EXE.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const {
  hardClose, dismissUpdatePrompt, armAnnotationTool, scrollToPage, openSamplePath,
} = require('./lib/helpers.cjs');

const PACKAGED_EXE =
  process.env.TFLEX_PACKAGED_EXE ||
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'TFlex', 'TFlex.exe');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const log = (label, obj) => console.log(`[release-1220|${label}] ${JSON.stringify(obj)}`);

test.setTimeout(300000);
test.describe.configure({ mode: 'serial' });

async function withApp(fn, { label = 'release-1220' } = {}) {
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
  console.log(`[release-1220] shot ${name}`);
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

async function openReport(app, win) {
  await openPath(app, win, getSamplePath('report.pdf'));
}

// ---- engine annotation read -------------------------------------------------
async function annModels(win) {
  return win.evaluate(() => {
    const st = window.tflexDiagnostics().engineState;
    if (!st || !st.annotations) return null;
    return st.annotations.map((a) => ({
      id: a.id, kind: a.kind, page: a.page, text: a.text ?? a.content ?? null,
      style: a.style ?? null,
    }));
  });
}

async function waitForAnn(win, text, pred, timeout = 12000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    const anns = (await annModels(win)) || [];
    const a = anns.find((x) => x.text === text);
    last = a;
    if (a && (pred ? pred(a) : true)) return a;
    await win.waitForTimeout(150);
  }
  return last;
}

// ---- panel read -------------------------------------------------------------
async function panelState(win) {
  return win.evaluate(() => {
    const p = document.querySelector('.text-props-panel');
    if (!p) return null;
    const q = (s) => p.querySelector(s);
    const pressed = (s) => q(s)?.getAttribute('aria-pressed') === 'true';
    return {
      mode: document.querySelector('[data-text-panel]')?.getAttribute('data-text-panel-mode') ?? null,
      font: q('[data-txt-font]')?.value ?? null,
      size: q('[data-txt-size]')?.value ?? null,
      bold: pressed('[data-txt-bold]'),
      color: q('[data-txt-color]')?.value ?? null,
      highlight: q('[data-txt-highlight]')?.value ?? null,
      align: ['left', 'center', 'right', 'justify'].filter((a) => pressed(`[data-txt-align-${a}`)),
    };
  });
}

async function waitForPanel(win, pred, timeout = 10000) {
  const t0 = Date.now();
  let s = null;
  while (Date.now() - t0 < timeout) {
    s = await panelState(win);
    if (s && pred(s)) return s;
    await win.waitForTimeout(150);
  }
  return s;
}

async function controlDisabledMap(win, sels) {
  return win.evaluate((list) => {
    const p = document.querySelector('.text-props-panel');
    const out = {};
    for (const s of list) {
      const el = p ? p.querySelector(s) : null;
      out[s] = el === null ? 'MISSING' : { disabled: el.disabled, title: el.getAttribute('title') };
    }
    return out;
  }, sels);
}

async function overlayCss(win, sel = '.ann-textbox[data-kind="textbox"]') {
  return win.evaluate((s) => {
    const box = document.querySelector(s);
    const span = box ? box.querySelector('.ann-text-content') : null;
    if (!box || !span) return null;
    const cs = getComputedStyle(span);
    return { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, textAlign: cs.textAlign, background: cs.backgroundColor };
  }, sel);
}

/** Poll overlayCss until the overlay is mounted and (optionally) matches. */
async function waitForOverlayCss(win, pred, timeout = 15000) {
  const t0 = Date.now();
  let s = null;
  while (Date.now() - t0 < timeout) {
    s = await overlayCss(win);
    if (s && (!pred || pred(s))) return s;
    await win.waitForTimeout(200);
  }
  return s;
}

/** Computed style of the committed textbox BOX div (style survives reopen even
 *  though the live text span is hidden once the text is baked into the /AP). */
async function overlayBoxCss(win, sel = '.ann-textbox[data-kind="textbox"]') {
  return win.evaluate((s) => {
    const box = document.querySelector(s);
    if (!box) return null;
    const cs = getComputedStyle(box);
    return { fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, textAlign: cs.textAlign };
  }, sel);
}

async function waitForOverlayBoxCss(win, pred, timeout = 15000) {
  const t0 = Date.now();
  let s = null;
  while (Date.now() - t0 < timeout) {
    s = await overlayBoxCss(win);
    if (s && (!pred || pred(s))) return s;
    await win.waitForTimeout(200);
  }
  return s;
}

// ---- placement --------------------------------------------------------------
async function dragOnPage(win, fx, fy, dxPx = 190, dyPx = 60) {
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 240));
  const y = Math.max(pg.y + 20, Math.min(pg.y + pg.height * fy, vp.h - 110));
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dxPx, y + dyPx, { steps: 6 });
  await win.mouse.up();
}

async function placeTextbox(win, text, fx = 0.3, fy = 0.22) {
  await armAnnotationTool(win, 'textbox');
  await dragOnPage(win, fx, fy);
  await win.waitForSelector('[data-annotation-editor="textbox"]', { timeout: 8000 });
  await win.locator('[data-annotation-editor="textbox"] textarea').fill(text);
  await win.click('[data-annotation-action="textbox-confirm"]');
  await win.waitForSelector('.ann-textbox[data-kind="textbox"]', { timeout: 8000 });
  await waitForAnn(win, text, null, 12000);
  await win.waitForSelector('.text-props-panel', { timeout: 8000 });
  await win.waitForTimeout(300);
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

// ---- panel-open frame probe (workspace attr + panel presence + mounted pages) --
async function installPanelProbe(win, ms) {
  await win.evaluate((m) => {
    window.__rp = { rows: [], running: true };
    const t0 = performance.now();
    const tick = () => {
      const ws = document.querySelector('.workspace');
      const pages = Array.from(document.querySelectorAll('.pdf-page'))
        .map((p) => p.getAttribute('data-page')).sort().join(',');
      window.__rp.rows.push({
        t: Math.round(performance.now() - t0),
        open: ws ? ws.getAttribute('data-text-panel-open') : null,
        panel: !!document.querySelector('.text-props-panel'),
        pages,
      });
      if (performance.now() - t0 < m) requestAnimationFrame(tick);
      else window.__rp.running = false;
    };
    requestAnimationFrame(tick);
  }, ms);
}

async function readPanelProbe(win) {
  await win.waitForFunction(() => window.__rp && window.__rp.running === false, null, { timeout: 10000 }).catch(() => {});
  return win.evaluate(() => window.__rp.rows);
}

function panelFrames(rows) {
  const isOpen = (r) => r.open === 'true' || r.panel;
  const idx = rows.findIndex(isOpen);
  const tail = idx < 0 ? rows : rows.slice(idx);
  return {
    frames: rows.length,
    firstOpenMs: idx < 0 ? null : rows[idx].t,
    openFalse: tail.filter((r) => !isOpen(r)).length,
    pageSets: [...new Set(rows.map((r) => r.pages))],
  };
}

async function selectAnnOverlay(win, sel) {
  const loc = win.locator(sel).first();
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const box = await loc.boundingBox();
  await win.evaluate(() => {
    window.__rp = { rows: [], running: true };
    const t0 = performance.now();
    const tick = () => {
      const ws = document.querySelector('.workspace');
      const pages = Array.from(document.querySelectorAll('.pdf-page'))
        .map((p) => p.getAttribute('data-page')).sort().join(',');
      window.__rp.rows.push({
        t: Math.round(performance.now() - t0),
        open: ws ? ws.getAttribute('data-text-panel-open') : null,
        panel: !!document.querySelector('.text-props-panel'),
        pages,
      });
      if (performance.now() - t0 < 1500) requestAnimationFrame(tick);
      else window.__rp.running = false;
    };
    requestAnimationFrame(tick);
  });
  await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await win.waitForTimeout(1600);
  const rows = await readPanelProbe(win);
  const state = await win.evaluate(() => ({
    panel: !!document.querySelector('.text-props-panel'),
    active: !!document.querySelector('.annotation-layer-active'),
    mode: document.querySelector('[data-text-panel]')?.getAttribute('data-text-panel-mode') ?? null,
  }));
  const f = panelFrames(rows);
  log('select-ann', { sel, state, ...f });
  return { ...state, ...f };
}

// ===========================================================================
// 0. VERSION GATE
// ===========================================================================
test('VERSION GATE: installed build reports app.getVersion() 1.22.0', async () => {
  await withApp(async (win, ctx, app) => {
    const version = await app.evaluate(async ({ app: a }) => a.getVersion());
    console.log(`[release-1220] app.getVersion() = ${JSON.stringify(version)} (exe: ${PACKAGED_EXE})`);
    expect(version, 'installed build version').toBe('1.22.0');
  }, { label: 'release-1220-version' });
});

// ===========================================================================
// 1. PHASE 24 - full text panel for annotation text objects (installed)
// ===========================================================================
test('PHASE 24: annotation textbox panel stays open; Times/18/bold round-trips', async () => {
  await withApp(async (win, ctx, app) => {
    await setSize(app, win, 1440, 900);
    await openReport(app, win);

    // -- place a textbox annotation with a live panel-open frame probe ---------
    await armAnnotationTool(win, 'textbox');
    await win.waitForSelector('.text-props-panel', { timeout: 8000 });
    await installPanelProbe(win, 1700);
    await dragOnPage(win, 0.3, 0.22);
    await win.waitForSelector('[data-annotation-editor="textbox"]', { timeout: 8000 });
    await win.locator('[data-annotation-editor="textbox"] textarea').fill('R1220-TB');
    await win.click('[data-annotation-action="textbox-confirm"]');
    await win.waitForSelector('.ann-textbox[data-kind="textbox"]', { timeout: 8000 });
    await waitForAnn(win, 'R1220-TB', null, 12000);
    const pf = panelFrames(await readPanelProbe(win));
    log('p24-placement', pf);
    expect(pf.frames, 'panel-open probe sampled frames').toBeGreaterThan(0);
    expect(pf.openFalse, 'panel never closed across placement (0 panel-false frames)').toBe(0);
    expect(pf.firstOpenMs, 'panel was open during the probe').not.toBeNull();

    expect(await win.getAttribute('[data-text-panel]', 'data-text-panel-mode')).toBe('annotation');

    // -- font Times / size 18 / bold ON ---------------------------------------
    await win.locator('[data-txt-font]').selectOption('Times');
    let a = await waitForAnn(win, 'R1220-TB', (x) => x.style && x.style.font === 'Times');
    await win.locator('[data-txt-size]').fill('18');
    a = await waitForAnn(win, 'R1220-TB', (x) => x.style && x.style.size === 18);
    await win.click('[data-txt-bold]');
    a = await waitForAnn(win, 'R1220-TB', (x) => x.style && x.style.bold === true);
    const psBefore = await waitForPanel(win, (s) => s.font === 'Times' && Number(s.size) === 18 && s.bold === true);
    const ovBefore = await overlayCss(win);
    log('p24-styled', { engine: a.style, panel: psBefore, overlay: ovBefore });
    expect(a.style.font, 'engine stores font=Times').toBe('Times');
    expect(a.style.size, 'engine stores size=18').toBe(18);
    expect(a.style.bold, 'engine stores bold=true').toBe(true);
    expect(psBefore.font, 'panel reflects Times').toBe('Times');
    expect(Number(psBefore.size), 'panel reflects 18').toBe(18);
    expect(psBefore.bold, 'panel reflects bold').toBe(true);
    expect(ovBefore.fontFamily, 'rendered annotation uses the Times stack').toContain('Times');
    expect(ovBefore.fontWeight, 'rendered annotation is bold').toBe('700');

    // -- Save As -> close -> reopen -------------------------------------------
    const p = path.join(os.tmpdir(), `r1220-p24-${Date.now()}.pdf`);
    await saveAs(app, win, p);
    await closeAndReopen(app, win, p);

    const a2 = await waitForAnn(win, 'R1220-TB', null, 20000);
    log('p24-reopened', a2 && a2.style);
    expect(a2 && a2.style, 'reopened annotation carries stored style').toBeTruthy();
    expect(a2.style.font, 'reopened font=Times').toBe('Times');
    expect(a2.style.size, 'reopened size=18').toBe(18);
    expect(a2.style.bold, 'reopened bold=true').toBe(true);

    const ov2 = await waitForOverlayBoxCss(win, (o) => /Times/.test(o.fontFamily));
    log('p24-reopened-overlay', ov2);
    expect(ov2 && ov2.fontFamily, 'reopened rendered annotation mounted').toBeTruthy();
    expect(ov2.fontFamily, 'reopened rendered annotation uses Times').toContain('Times');
    expect(ov2.fontWeight, 'reopened rendered annotation is bold').toBe('700');

    const sel = await selectAnnOverlay(win, '.ann-textbox[data-kind="textbox"]');
    expect(sel.active && sel.panel, 'reopened annotation selected and panel open').toBe(true);
    expect(sel.openFalse, 'panel stays open after selecting the reopened annotation').toBe(0);
    const ps2 = await waitForPanel(win, (s) => s.font === 'Times' && Number(s.size) === 18 && s.bold === true);
    log('p24-reopened-panel', ps2);
    expect(ps2.mode, 'panel annotation mode').toBe('annotation');
    expect(ps2.font, 'panel reflects stored font').toBe('Times');
    expect(Number(ps2.size), 'panel reflects stored size').toBe(18);
    expect(ps2.bold, 'panel reflects stored bold').toBe(true);

    await shot(win, 'release-1220-phase24.png');
    expect(ctx.consoleErrors, 'zero renderer console errors').toEqual([]);
    expect(ctx.pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, { label: 'release-1220-phase24' });
});

// ===========================================================================
// 2. DEF-253 - click a placed annotation; panel stays open (0 glitch frames)
// ===========================================================================
test('DEF-253: clicking a placed annotation keeps the panel open', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    await placeTextbox(win, 'R1220-D253', 0.3, 0.2);

    // Deselect first so the click is the only thing that opens the panel.
    await armAnnotationTool(win, 'select');
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.mouse.click(pg.x + 24, pg.y + pg.height - 30);
    await win.waitForSelector('.text-props-panel', { state: 'detached', timeout: 8000 }).catch(() => {});
    await win.waitForTimeout(500);
    const closed = await win.locator('.text-props-panel').count();
    log('def253-closed', { closed });

    const sel = await selectAnnOverlay(win, '.ann-textbox[data-kind="textbox"]');
    expect(sel.panel, 'panel open after clicking the placed annotation').toBe(true);
    expect(sel.active, 'annotation selected').toBe(true);
    expect(sel.frames, 'frame probe sampled').toBeGreaterThan(0);
    expect(sel.openFalse, 'zero panel-false frames after the click (no glitch)').toBe(0);
    expect(sel.mode, 'panel annotation mode').toBe('annotation');
    expect(ctx.consoleErrors, 'zero renderer console errors').toEqual([]);
    expect(ctx.pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, { label: 'release-1220-def253' });
});

// ===========================================================================
// 3. DEF-254 - select an annotation on page 4; panel stays open while a
//    neighbouring page mounts/unmounts during the reflow.
// ===========================================================================
test('DEF-254: page-4 annotation selection keeps panel open across neighbour mount', async () => {
  const legacySrc = path.resolve(__dirname, '..', 'test-fixtures', 'annot-text-roundtrip-1727.pdf');
  expect(fs.existsSync(legacySrc), 'page-4 annotation fixture present').toBe(true);
  const legacyPath = path.join(os.tmpdir(), `r1220-def254-${Date.now()}.pdf`);
  fs.copyFileSync(legacySrc, legacyPath);

  await withApp(async (win, ctx, app) => {
    await openPath(app, win, legacyPath);
    await scrollToPage(win, 4);
    await win.waitForSelector('.pdf-page[data-page="4"]', { timeout: 15000 });
    await win.waitForTimeout(800);

    const anns = (await annModels(win)) || [];
    const legacy = anns.filter((a) => a.page === 4 && (a.kind === 'textbox' || a.kind === 'callout'));
    log('def254-annots', legacy);
    expect(legacy.length, 'page-4 annotation present').toBeGreaterThan(0);
    const tb = legacy.find((a) => a.text && a.text.includes('VERIFY TB')) ?? legacy[0];
    const sel = tb.kind === 'textbox'
      ? '.pdf-page[data-page="4"] .ann-textbox[data-kind="textbox"]'
      : '.pdf-page[data-page="4"] .ann-callout[data-kind="callout"]';
    await win.waitForSelector(sel, { timeout: 20000 });

    const st = await selectAnnOverlay(win, sel);
    expect(st.panel, 'panel open after selecting the page-4 annotation').toBe(true);
    expect(st.active, 'page-4 annotation selected').toBe(true);
    expect(st.openFalse, 'zero panel-false frames after the page-4 click').toBe(0);
    log('def254-pagesets', st.pageSets);
    expect(st.pageSets.length, 'a neighbouring page mounted/unmounted during the reflow').toBeGreaterThan(1);
    expect(ctx.consoleErrors, 'zero renderer console errors').toEqual([]);
    expect(ctx.pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, { label: 'release-1220-def254' });
});

// ===========================================================================
// 4. DEF-255 - highlight set/clear persistence across save + reopen, no duplicate
// ===========================================================================
async function annCount(win, text) {
  return win.evaluate((t) => {
    const st = window.tflexDiagnostics().engineState;
    const anns = (st && st.annotations) || [];
    return {
      models: anns.filter((a) => (a.text ?? a.content) === t).length,
      overlays: document.querySelectorAll('.ann-textbox[data-kind="textbox"]').length,
    };
  }, text);
}

test('DEF-255: cleared highlight survives save/reopen; no duplicate annotation', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    await placeTextbox(win, 'R1220-HL', 0.3, 0.25);
    await win.locator('[data-txt-highlight]').fill('#ff0000');
    await waitForAnn(win, 'R1220-HL', (a) => a.style && a.style.highlight && a.style.highlight.r === 1 && a.style.highlight.g === 0);

    const p1 = path.join(os.tmpdir(), `r1220-hl-set-${Date.now()}.pdf`);
    await saveAs(app, win, p1);
    await closeAndReopen(app, win, p1);
    await win.waitForSelector('.ann-textbox[data-kind="textbox"]', { timeout: 20000 });

    const a1 = await waitForAnn(win, 'R1220-HL', null, 20000);
    const c1 = await annCount(win, 'R1220-HL');
    log('def255-set-reopened', { style: a1 && a1.style, ...c1 });
    expect(a1 && a1.style && a1.style.highlight, 'red highlight persisted').toEqual({ r: 1, g: 0, b: 0 });
    expect(c1.models, 'exactly one annotation after first reopen (no duplicate)').toBe(1);
    expect(c1.overlays, 'exactly one overlay after first reopen').toBe(1);

    const sel = await selectAnnOverlay(win, '.ann-textbox[data-kind="textbox"]');
    expect(sel.active && sel.panel, 'reopened highlight box selected, panel open').toBe(true);
    await win.click('[data-txt-highlight-clear]');
    await waitForAnn(win, 'R1220-HL', (a) => !a.style || !a.style.highlight);

    const p2 = path.join(os.tmpdir(), `r1220-hl-clear-${Date.now()}.pdf`);
    await saveAs(app, win, p2);
    await closeAndReopen(app, win, p2);
    await win.waitForSelector('.ann-textbox[data-kind="textbox"]', { timeout: 20000 });

    const a2 = await waitForAnn(win, 'R1220-HL', null, 20000);
    const c2 = await annCount(win, 'R1220-HL');
    log('def255-clear-reopened', { style: a2 && a2.style, ...c2 });
    expect(a2 && a2.style && a2.style.highlight ? a2.style.highlight : null, 'no highlight survives the cleared save').toBeNull();
    expect(c2.models, 'still exactly one annotation after clear+reopen (no duplicate)').toBe(1);
    expect(c2.overlays, 'still exactly one overlay after clear+reopen').toBe(1);
    expect(ctx.consoleErrors, 'zero renderer console errors').toEqual([]);
    expect(ctx.pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, { label: 'release-1220-def255' });
});

// ===========================================================================
// 5a. REGRESSIONS - Phase 21 edit-box panel, DEF-214 toolbar guard, Phase 22
// ===========================================================================
test('REGRESSIONS: Phase 21 edit-box controls live; DEF-214 toolbar; Phase 22 title bar', async () => {
  await withApp(async (win, ctx, app) => {
    await setSize(app, win, 1440, 900);
    await openReport(app, win);

    // -- Phase 21: arm the Edit box tool -> full text panel controls live -----
    const editToggle = win.locator('[data-toolbar-edit-toggle]');
    await editToggle.waitFor({ timeout: 15000 });
    expect(await editToggle.count(), 'exactly one edit toggle').toBe(1);
    await editToggle.click();
    await win.locator('.edit-toolbar').waitFor({ timeout: 10000, state: 'attached' });
    await win.click('[data-edit-tool="box"]');
    await win.waitForSelector('.text-props-panel', { timeout: 8000 });
    await win.waitForTimeout(400);
    const p21 = await controlDisabledMap(win, [
      '[data-txt-font]', '[data-txt-size]', '[data-txt-bold]', '[data-txt-italic]',
      '[data-txt-underline]', '[data-txt-align-left]', '[data-txt-highlight]',
    ]);
    const p21Missing = Object.entries(p21).filter(([, v]) => v === 'MISSING').map(([k]) => k);
    const p21Disabled = Object.entries(p21).filter(([, v]) => v !== 'MISSING' && v.disabled).map(([k]) => k);
    log('reg-phase21', { p21Missing, p21Disabled });
    expect(p21Missing, 'Phase 21: every text control mounted for the edit box tool').toEqual([]);
    expect(p21Disabled, 'Phase 21: font/size/bold/italic/underline/align/highlight all live').toEqual([]);

    // -- DEF-214: annotation toolbar visible; Edit toggle arms .edit-toolbar ---
    const ann = win.locator('.ann-toolbar');
    await ann.waitFor({ timeout: 15000, state: 'visible' });
    const annBox = await ann.boundingBox();
    expect(annBox, '.ann-toolbar non-null box').not.toBeNull();
    expect(annBox.height, '.ann-toolbar visible row').toBeGreaterThan(0);
    const editBox = await win.locator('.edit-toolbar').boundingBox();
    expect(editBox, '.edit-toolbar mounted after arming Edit').not.toBeNull();
    await editToggle.click();
    await win.waitForTimeout(400);
    log('reg-def214', { ann: annBox, edit: editBox });

    // -- Phase 22: title-bar file group, no duplicates -------------------------
    const tb = await win.evaluate(() => ({
      groupCount: document.querySelectorAll('.titlebar-file').length,
      btnCount: document.querySelectorAll('.titlebar-file-btn').length,
      toolbarSave: document.querySelectorAll('.toolbar [data-toolbar-save]').length,
      toolbarSaveAs: document.querySelectorAll('.toolbar [data-toolbar-save-as]').length,
      totalSave: document.querySelectorAll('[data-toolbar-save]').length,
      totalSaveAs: document.querySelectorAll('[data-toolbar-save-as]').length,
    }));
    log('reg-phase22', tb);
    expect(tb.groupCount, 'exactly ONE title-bar file group').toBe(1);
    expect(tb.btnCount, 'three controls: Open / Save / Save As').toBe(3);
    expect(tb.toolbarSave, 'no Save duplicate in the CommandBar').toBe(0);
    expect(tb.toolbarSaveAs, 'no Save As duplicate in the CommandBar').toBe(0);
    expect(tb.totalSave, 'exactly one [data-toolbar-save]').toBe(1);
    expect(tb.totalSaveAs, 'exactly one [data-toolbar-save-as]').toBe(1);

    expect(ctx.consoleErrors, 'zero renderer console errors').toEqual([]);
    expect(ctx.pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, { label: 'release-1220-reg-a' });
});

// ---- Phase 23 motion probe --------------------------------------------------
async function installProbe(win) {
  await win.evaluate(() => {
    window.__p = { rows: [], running: false };
    window.__pStart = (sel, ms) => {
      window.__p = { rows: [], running: true };
      const t0 = performance.now();
      const tick = () => {
        const el = document.querySelector(sel);
        if (el) {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          window.__p.rows.push({
            t: Math.round(performance.now() - t0),
            tr: cs.transform, op: Number.parseFloat(cs.opacity),
            left: +r.left.toFixed(2), top: +r.top.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2),
          });
        }
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else window.__p.running = false;
      };
      requestAnimationFrame(tick);
    };
  });
}

async function probe(win, sel, ms, action) {
  await win.evaluate(([s, m]) => window.__pStart(s, m), [sel, ms]);
  await action();
  await win.waitForFunction(() => window.__p && window.__p.running === false, null, { timeout: 10000 }).catch(() => {});
  return win.evaluate(() => window.__p.rows);
}

function parseMatrix(tr) {
  if (!tr || tr === 'none') return { a: 1, tx: 0, ty: 0 };
  const m = /matrix\(([^)]+)\)/.exec(tr);
  if (!m) return null;
  const p = m[1].split(',').map((s) => parseFloat(s.trim()));
  return { a: p[0], tx: p[4], ty: p[5] };
}

function summarise(rows) {
  let intermediates = 0;
  for (const r of rows) {
    const m = parseMatrix(r.tr);
    const opMid = r.op > 0.02 && r.op < 0.98;
    const trMid = m !== null && (Math.abs(m.a - 1) > 0.01 || Math.abs(m.tx) > 0.5 || Math.abs(m.ty) > 0.5);
    if (opMid || trMid) intermediates += 1;
  }
  const rects = new Set(rows.map((r) =>
    `${Math.round(r.left / 2) * 2},${Math.round(r.top / 2) * 2},${Math.round(r.w / 2) * 2},${Math.round(r.h / 2) * 2}`));
  return { frames: rows.length, intermediates, distinctRects: rects.size };
}

// ===========================================================================
// 5b. REGRESSIONS - Phase 23 animations OFF instant path + watermark apply/delete
// ===========================================================================
test('REGRESSIONS: Phase 23 animations OFF instant; watermark apply + delete', async () => {
  await withApp(async (win, ctx, app) => {
    await setSize(app, win, 1440, 900);
    await openReport(app, win);

    // -- Phase 23: animations OFF -> instant menu open ------------------------
    await win.click('[data-open-preferences]');
    await win.waitForSelector('[data-prefs-dialog]', { timeout: 8000 });
    const box = win.locator('[data-prefs-animations]');
    expect(await box.isChecked(), 'fresh profile: animations ON').toBe(true);
    await box.click();
    await expect.poll(() => win.evaluate(() => document.documentElement.dataset.animations), { timeout: 5000 }).toBe('off');
    await win.click('[data-prefs-dialog] .sheet-close');
    await win.waitForSelector('[data-prefs-dialog]', { state: 'hidden', timeout: 8000 });
    await win.waitForTimeout(300);
    await installProbe(win);
    const menuOpen = summarise(await probe(win, '.titlebar-menu-popover', 430, async () => {
      await win.click('[data-menu-button]');
    }));
    log('reg-phase23-off', { menuOpen });
    expect(menuOpen.frames, 'menu surface sampled').toBeGreaterThan(0);
    expect(menuOpen.intermediates, 'animations OFF: menu open has no intermediate frame').toBe(0);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    // Toggle back ON and confirm animations return.
    await win.click('[data-open-preferences]');
    await win.waitForSelector('[data-prefs-dialog]', { timeout: 8000 });
    await win.locator('[data-prefs-animations]').click();
    await expect.poll(() => win.evaluate(() => document.documentElement.dataset.animations), { timeout: 5000 }).toBe('on');
    await win.click('[data-prefs-dialog] .sheet-close');
    await win.waitForSelector('[data-prefs-dialog]', { state: 'hidden', timeout: 8000 });
    await win.waitForTimeout(300);
    const onMenu = summarise(await probe(win, '.titlebar-menu-popover', 430, async () => {
      await win.click('[data-menu-button]');
    }));
    log('reg-phase23-on', { onMenu });
    expect(onMenu.intermediates > 0 || onMenu.distinctRects > 2, 'ON: menu open is animated again').toBe(true);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    // -- Watermark apply + delete --------------------------------------------
    const palette = win.locator('[data-tools-palette]');
    if (!(await palette.isVisible().catch(() => false))) await win.locator('[data-tools-toggle]').first().click();
    await palette.waitFor({ state: 'visible', timeout: 15000 });
    await win.locator('[data-tool-id="watermark"]').click();
    await win.locator('[data-watermark-dialog]').waitFor({ state: 'visible', timeout: 10000 });
    await win.waitForTimeout(400);
    await win.locator('[data-watermark-text]').fill('CONFIDENTIAL');
    await win.locator('[data-watermark-confirm]').click();
    await win.waitForFunction(() => Array.from(document.querySelectorAll('.toast .toast-text')).some((t) => (t.textContent || '').trim() === 'Watermark applied.'), null, { timeout: 12000 });
    if (!(await palette.isVisible().catch(() => false))) await win.locator('[data-tools-toggle]').first().click();
    await win.locator('[data-tool-id="watermark"]').click();
    await win.locator('[data-watermark-applied="wm-1"]').waitFor({ state: 'visible', timeout: 15000 });
    await win.locator('[data-watermark-delete="wm-1"]').click();
    await win.waitForFunction(() => Array.from(document.querySelectorAll('.toast .toast-text')).some((t) => (t.textContent || '').trim() === 'Watermark deleted.'), null, { timeout: 12000 });
    await win.locator('[data-watermark-applied="wm-1"]').waitFor({ state: 'detached', timeout: 15000 });
    const wm = await win.evaluate(async () => {
      const id = window.tflexDiagnostics().engineDocId;
      const g = await window.tflex.engine.getWatermarks(id);
      return g.ok ? g.value.map((w) => w.id) : { err: g.error };
    });
    log('reg-watermark', wm);
    expect(Array.isArray(wm), 'getWatermarks ok').toBe(true);
    expect(wm).not.toContain('wm-1');

    expect(ctx.consoleErrors, 'zero renderer console errors').toEqual([]);
    expect(ctx.pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, { label: 'release-1220-reg-b' });
});
