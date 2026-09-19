// Release 1.21.0 - INSTALLED-app validation (qa), explicitly ordered by the
// orchestrator. Launches the NSIS-installed %LOCALAPPDATA%\Programs\TFlex\TFlex.exe
// through the canonical launchApp() from e2e/lib/launch.cjs and verifies, on that
// installed build:
//
//   0. VERSION GATE - app.getVersion() === '1.21.0' (test 1, serial: a mismatch
//      aborts every remaining test).
//   1. PHASE 23 (animation off switch) - toggle animations OFF in Preferences,
//      then a morphing menu open/close, the text-panel reflow and a dialog open
//      are all instant (0 intermediate frames); data-animations="off" on <html>;
//      toggle back ON and animations return.
//   2. DEF-251/252 - arm the textbox annotation tool, place an annotation, and
//      data-text-panel-open stays "true" throughout (no reflow); a single click
//      on the placed annotation selects it (elementFromPoint resolves to it).
//   3. DEF-247..249 - side-rail page-facing radius is non-zero (~16px) and one
//      dropdown join has gap 0.
//   4. DEF-214 guard + regression - .ann-toolbar present, Edit toggle arms
//      .edit-toolbar, zero errors; watermark apply/delete still works.
//   5. DEFECT DISPOSITION - DEF-247..252 + DEF-214 verified on this build.
//
// Screenshots: release-1210-animations-off.png, release-1210-titlebar.png.
//
// Run: npm.cmd run test:e2e -- e2e/release_1_21_0_installed.spec.cjs
// The installed path can be overridden with TFLEX_PACKAGED_EXE.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, dismissUpdatePrompt, armAnnotationTool } = require('./lib/helpers.cjs');

const PACKAGED_EXE =
  process.env.TFLEX_PACKAGED_EXE ||
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'TFlex', 'TFlex.exe');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const SAMPLES = path.resolve(__dirname, '..', 'assets', 'samples');

test.setTimeout(300000);
test.describe.configure({ mode: 'serial' });

async function withApp(fn, { userDataDir = null, label = 'release-1210' } = {}) {
  const app = await launchApp([], userDataDir, PACKAGED_EXE);
  const win = await app.firstWindow();
  const consoleErrors = [];
  const pageErrors = [];
  win.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
  });
  win.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  await win.waitForSelector('.sample-card', { timeout: 40000 });
  await dismissUpdatePrompt(win);
  await win.evaluate(() => {
    window.__unhandled = [];
    window.addEventListener('unhandledrejection', (e) => {
      try { window.__unhandled.push(String((e && e.reason) || e).slice(0, 300)); } catch (_) { /* ignore */ }
    });
  });
  try {
    return await fn(win, { consoleErrors, pageErrors }, app);
  } finally {
    await hardClose(app, label);
  }
}

async function shot(win, name, clip) {
  const p = path.join(SHOTS, name);
  await win.screenshot(clip ? { path: p, clip } : { path: p });
  console.log(`[release-1210] shot ${name}`);
  return p;
}

async function setSize(app, win, w, h) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const w2 = BrowserWindow.getAllWindows()[0];
    if (w2) w2.setSize(s[0], s[1]);
  }, [w, h]);
  await win.waitForTimeout(500);
}

async function openReport(app, win) {
  const p = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(800);
}

const log = (label, obj) => console.log(`[release-1210|${label}] ${JSON.stringify(obj)}`);

// rAF probe: samples one selector each frame (rect + transform + opacity).
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
            left: +r.left.toFixed(2), top: +r.top.toFixed(2),
            w: +r.width.toFixed(2), h: +r.height.toFixed(2),
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
  const end = rows[rows.length - 1] || null;
  return {
    frames: rows.length,
    intermediates,
    distinctRects: rects.size,
    end: end ? { left: end.left, top: end.top, w: end.w, h: end.h } : null,
  };
}

async function setTheme(win, want) {
  await win.keyboard.press('Escape');
  await win.waitForTimeout(250);
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${want}"]`);
  await win.waitForFunction((w) => document.documentElement.getAttribute('data-theme') === w, want, { timeout: 5000 });
  await win.waitForTimeout(350);
}

async function ensurePalette(win) {
  if ((await win.locator('[data-tools-palette]').count()) === 0) {
    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
  }
  await win.waitForTimeout(250);
}

// ===========================================================================
// 0. VERSION GATE
// ===========================================================================
test('VERSION GATE: installed build reports app.getVersion() 1.21.0', async () => {
  await withApp(async (win, ctx, app) => {
    const version = await app.evaluate(async ({ app: a }) => a.getVersion());
    console.log(`[release-1210] app.getVersion() = ${JSON.stringify(version)} (exe: ${PACKAGED_EXE})`);
    expect(version, 'installed build version').toBe('1.21.0');
  }, { label: 'release-1210-version' });
});

// ===========================================================================
// 1. PHASE 23 - animation off switch
// ===========================================================================
test('PHASE 23: animations OFF -> menu/panel/dialog instant; ON -> animations return', async () => {
  await withApp(async (win, ctx, app) => {
    await setSize(app, win, 1440, 900);
    await openReport(app, win);

    // Toggle animations OFF through Preferences.
    await win.click('[data-open-preferences]');
    await win.waitForSelector('[data-prefs-dialog]', { timeout: 8000 });
    const box = win.locator('[data-prefs-animations]');
    expect(await box.isChecked(), 'fresh profile: animations ON').toBe(true);
    await box.click();
    await expect.poll(() => win.evaluate(() => document.documentElement.dataset.animations), { timeout: 5000 }).toBe('off');
    await win.click('[data-prefs-dialog] .sheet-close');
    await win.waitForSelector('[data-prefs-dialog]', { state: 'hidden', timeout: 8000 });
    const gate = await win.evaluate(() => document.documentElement.dataset.animations);
    log('phase23-gate', { dataAnimations: gate });
    expect(gate, 'root hook data-animations=off').toBe('off');

    await installProbe(win);

    // (a) morphing menu open + close.
    await win.keyboard.press('Escape').catch(() => undefined);
    await win.waitForTimeout(200);
    const menuOpen = summarise(await probe(win, '.titlebar-menu-popover', 430, async () => {
      await win.click('[data-menu-button]');
    }));
    const menuClose = summarise(await probe(win, '.titlebar-menu-popover', 430, async () => {
      await win.keyboard.press('Escape');
    }));
    await win.waitForTimeout(300);

    // (b) text-panel reflow.
    await armAnnotationTool(win, 'select');
    await win.waitForTimeout(250);
    const panelOpen = summarise(await probe(win, '.text-props-panel', 520, async () => {
      await armAnnotationTool(win, 'textbox');
    }));
    await armAnnotationTool(win, 'select');
    await win.waitForTimeout(300);

    // (c) dialog open.
    await ensurePalette(win);
    const dialogOpen = summarise(await probe(win, '.modal-dialog', 520, async () => {
      await win.click('[data-tool-id="insertPages"]');
    }));
    await shot(win, 'release-1210-animations-off.png');
    await win.click('[data-insert-pages-dialog] button[aria-label="Close dialog"]');
    await win.waitForSelector('[data-insert-pages-dialog]', { state: 'detached', timeout: 8000 });
    await win.waitForTimeout(300);

    log('phase23-off', { menuOpen, menuClose, panelOpen, dialogOpen });
    for (const [name, s] of [['menuOpen', menuOpen], ['menuClose', menuClose], ['panelOpen', panelOpen], ['dialogOpen', dialogOpen]]) {
      expect(s.frames, `OFF ${name}: surface was sampled`).toBeGreaterThan(0);
      expect(s.intermediates, `OFF ${name}: no intermediate frame (instant)`).toBe(0);
    }

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
    log('phase23-on', { onMenu });
    expect(onMenu.intermediates > 0 || onMenu.distinctRects > 2, 'ON: menu open is animated again').toBe(true);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    expect(ctx.consoleErrors, 'zero renderer console errors').toEqual([]);
    expect(ctx.pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, { label: 'release-1210-phase23' });
});
// ===========================================================================
// 2. DEF-251 / DEF-252 - annotation text panel placement
// ===========================================================================
const panelOpenAttr = (win) =>
  win.evaluate(() => document.querySelector('.workspace')?.getAttribute('data-text-panel-open') ?? null);

async function installPlacementProbe(win, ms) {
  await win.evaluate((m) => {
    window.__d = { rows: [], running: true };
    const t0 = performance.now();
    const tick = () => {
      const ws = document.querySelector('.workspace');
      const page = document.querySelector('.pdf-page[data-page="1"]');
      const panel = document.querySelector('.text-props-panel');
      window.__d.rows.push({
        t: Math.round(performance.now() - t0),
        open: ws ? ws.getAttribute('data-text-panel-open') : null,
        pageLeft: page ? +page.getBoundingClientRect().left.toFixed(2) : null,
        panelW: panel ? +panel.getBoundingClientRect().width.toFixed(2) : 0,
      });
      if (performance.now() - t0 < m) requestAnimationFrame(tick);
      else window.__d.running = false;
    };
    requestAnimationFrame(tick);
  }, ms);
}

async function readPlacementProbe(win) {
  await win.waitForFunction(() => window.__d && window.__d.running === false, null, { timeout: 8000 }).catch(() => {});
  return win.evaluate(() => window.__d.rows);
}

test('DEF-251/252: textbox placement keeps panel open (no reflow); click selects', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    await armAnnotationTool(win, 'textbox');
    await win.waitForSelector('.text-props-panel', { timeout: 8000 });
    const openBefore = await panelOpenAttr(win);
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await installPlacementProbe(win, 1100);
    await win.mouse.click(pg.x + pg.width * 0.32, pg.y + pg.height * 0.28);
    await win.waitForSelector('[data-annotation-editor="textbox"]', { timeout: 8000 });
    await win.locator('[data-annotation-editor="textbox"] textarea').fill('R1210');
    await win.click('[data-annotation-action="textbox-confirm"]');
    await win.waitForSelector('.pdf-page[data-page="1"] [data-kind="textbox"]', { timeout: 8000 });
    const hit = await win.evaluate(() => {
      const el = document.querySelector('.pdf-page[data-page="1"] [data-kind="textbox"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const h = document.elementFromPoint(x, y);
      return {
        annId: el.getAttribute('data-annotation-id'),
        x: +x.toFixed(1), y: +y.toFixed(1),
        hitTag: h ? h.tagName : null,
        hitClass: h ? String(h.className) : null,
        hitAnnId: h && h.closest ? (h.closest('[data-annotation-id]')?.getAttribute('data-annotation-id') ?? null) : null,
        hitIsCanvas: !!(h && h.tagName === 'CANVAS'),
      };
    });
    const openImmediate = await panelOpenAttr(win);
    if (hit) await win.mouse.click(hit.x, hit.y);
    const openAfterClick = await panelOpenAttr(win);
    const chromeAfterClick = await win.evaluate(() => !!document.querySelector('[data-content-selection-frame]'));
    const rows = await readPlacementProbe(win);
    const openFalse = rows.filter((r) => r.open !== 'true').length;
    const lefts = rows.map((r) => r.pageLeft).filter((v) => v !== null);
    const leftRange = lefts.length ? +(Math.max(...lefts) - Math.min(...lefts)).toFixed(2) : null;
    const minW = rows.length ? +Math.min(...rows.map((r) => r.panelW)).toFixed(2) : null;
    log('def251-252', { openBefore, hit, openImmediate, openAfterClick, chromeAfterClick, frames: rows.length, openFalse, leftRange, minW });

    expect(openBefore, 'panel open while the textbox tool is armed').toBe('true');
    expect(openFalse, 'data-text-panel-open never flips false across placement (no reflow)').toBe(0);
    expect(leftRange, 'page-1 left does not move during placement (no 248px reflow)').toBeLessThanOrEqual(2);
    expect(minW, 'panel stays at its open width throughout').toBeGreaterThan(240);
    expect(hit, 'placed textbox annotation found').not.toBeNull();
    expect(hit.hitAnnId, 'elementFromPoint at the annotation centre resolves to the annotation').toBe(hit.annId);
    expect(hit.hitIsCanvas, 'elementFromPoint is not the page canvas/background').toBe(false);
    expect(openImmediate, 'panel still open immediately after placement').toBe('true');
    expect(openAfterClick, 'panel still open after the immediate single click on the annotation').toBe('true');
    expect(chromeAfterClick, 'annotation remains selected after the click (selection chrome present)').toBe(true);
    expect(ctx.consoleErrors, 'zero renderer console errors').toEqual([]);
    expect(ctx.pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, { label: 'release-1210-def251-252' });
});

// ===========================================================================
// 3. DEF-247 / DEF-248 / DEF-249 - rounded panels + dropdown seam
// ===========================================================================
test('DEF-247/248/249: side-rail radius non-zero (~16px); dropdown join gap 0', async () => {
  await withApp(async (win, ctx, app) => {
    await setSize(app, win, 1440, 900);
    await openReport(app, win);
    await setTheme(win, 'frosted');

    const rail = await win.evaluate(() => {
      const el = document.querySelector('.side-rail');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        tl: cs.borderTopLeftRadius, tr: cs.borderTopRightRadius,
        br: cs.borderBottomRightRadius, bl: cs.borderBottomLeftRadius,
      };
    });
    log('def247-rail', rail);
    expect(rail, '.side-rail present').not.toBeNull();
    expect(rail.tr, 'rail page-facing top-right radius non-zero (~16px)').toBe('16px');
    expect(rail.br, 'rail page-facing bottom-right radius non-zero (~16px)').toBe('16px');

    // One dropdown join: the theme popover (right-joined).
    await win.click('[data-theme-toggle]');
    await win.waitForSelector('.theme-toggle-popover', { state: 'visible', timeout: 8000 });
    await win.waitForTimeout(500);
    const seam = await win.evaluate(() => {
      const t = document.querySelector('[data-theme-toggle]');
      const s = document.querySelector('.theme-toggle-popover');
      if (!t || !s) return null;
      const tc = getComputedStyle(t), sc = getComputedStyle(s);
      const tr = t.getBoundingClientRect(), sr = s.getBoundingClientRect();
      return {
        gap: +(sr.top - tr.bottom).toFixed(2),
        surfaceTr: sc.borderTopRightRadius,
        surfaceTl: sc.borderTopLeftRadius,
        triggerBl: tc.borderBottomLeftRadius,
        triggerBr: tc.borderBottomRightRadius,
        surfaceBorderTop: sc.borderTopWidth,
      };
    });
    log('def248-seam', seam);
    expect(seam, 'theme popover seam measurable').not.toBeNull();
    expect(seam.gap, 'dropdown join gap 0').toBeLessThanOrEqual(0.5);
    expect(seam.surfaceTl, 'exposed corner is --radius-3 (8px)').toBe('8px');
    expect(seam.surfaceTr, 'joined corner squared').toBe('0px');
    expect([seam.triggerBl, seam.triggerBr], 'trigger joined corners squared').toEqual(['0px', '0px']);
    expect(seam.surfaceBorderTop, 'surface joined hairline removed').toBe('0px');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    expect(ctx.consoleErrors, 'zero renderer console errors').toEqual([]);
    expect(ctx.pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, { label: 'release-1210-def247-249' });
});

// ===========================================================================
// 4. DEF-214 guard + watermark regression
// ===========================================================================
test('DEF-214 guard: .ann-toolbar + edit toggle arms .edit-toolbar; watermark apply/delete', async () => {
  await withApp(async (win, ctx, app) => {
    ctx.consoleErrors.length = 0;
    ctx.pageErrors.length = 0;
    await openReport(app, win);

    const ann = win.locator('.ann-toolbar');
    await ann.waitFor({ timeout: 15000, state: 'visible' });
    const annBox = await ann.boundingBox();
    expect(annBox, '.ann-toolbar non-null box').not.toBeNull();
    expect(annBox.height, '.ann-toolbar visible row').toBeGreaterThan(0);

    const editToggle = win.locator('[data-toolbar-edit-toggle]');
    await editToggle.waitFor({ timeout: 15000 });
    expect(await editToggle.count()).toBe(1);
    await editToggle.click();
    await win.locator('.edit-toolbar').waitFor({ timeout: 10000, state: 'attached' });
    await win.waitForTimeout(400);
    const editBox = await win.locator('.edit-toolbar').boundingBox();
    expect(editBox, '.edit-toolbar mounted after arming Edit').not.toBeNull();
    log('def214', { ann: annBox, edit: editBox });
    await editToggle.click();
    await win.waitForTimeout(400);

    // Watermark apply + delete-by-id.
    const palette = win.locator('[data-tools-palette]');
    if (!(await palette.isVisible().catch(() => false))) await win.locator('[data-tools-toggle]').first().click();
    await palette.waitFor({ state: 'visible', timeout: 15000 });
    await win.locator('[data-tool-id="watermark"]').click();
    await win.locator('[data-watermark-dialog]').waitFor({ state: 'visible', timeout: 10000 });
    await win.waitForTimeout(400);
    await win.locator('[data-watermark-text]').fill('CONFIDENTIAL');
    await win.locator('[data-watermark-confirm]').click();
    await win.waitForFunction(() => Array.from(document.querySelectorAll('.toast .toast-text')).some((t) => (t.textContent || '').trim() === 'Watermark applied.'), null, { timeout: 12000 });
    console.log('[release-1210] exact toast observed: "Watermark applied."');

    if (!(await palette.isVisible().catch(() => false))) await win.locator('[data-tools-toggle]').first().click();
    await win.locator('[data-tool-id="watermark"]').click();
    await win.locator('[data-watermark-applied="wm-1"]').waitFor({ state: 'visible', timeout: 15000 });
    await win.locator('[data-watermark-delete="wm-1"]').click();
    await win.waitForFunction(() => Array.from(document.querySelectorAll('.toast .toast-text')).some((t) => (t.textContent || '').trim() === 'Watermark deleted.'), null, { timeout: 12000 });
    await win.locator('[data-watermark-applied="wm-1"]').waitFor({ state: 'detached', timeout: 15000 });
    console.log('[release-1210] exact toast observed: "Watermark deleted."; row detached');

    const engine = await win.evaluate(async () => {
      const id = window.tflexDiagnostics().engineDocId;
      const g = await window.tflex.engine.getWatermarks(id);
      return g.ok ? g.value.map((w) => w.id) : { err: g.error };
    });
    log('def214-watermarks', engine);
    expect(Array.isArray(engine), 'getWatermarks ok').toBe(true);
    expect(engine).not.toContain('wm-1');
    expect(ctx.consoleErrors, 'zero renderer console errors').toEqual([]);
    expect(ctx.pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, { label: 'release-1210-def214' });
});

// ===========================================================================
// 5. Title-bar group screenshot
// ===========================================================================
test('title bar: file group present; screenshot release-1210-titlebar.png', async () => {
  await withApp(async (win, ctx, app) => {
    await setSize(app, win, 1440, 900);
    await openReport(app, win);
    const facts = await win.evaluate(() => {
      const group = document.querySelector('.titlebar-file');
      const brand = document.querySelector('.brand');
      const tabArea = document.querySelector('.tab-area');
      const r = (el) => (el ? { x: Math.round(el.getBoundingClientRect().x), right: Math.round(el.getBoundingClientRect().right) } : null);
      return {
        groupCount: document.querySelectorAll('.titlebar-file').length,
        btnCount: document.querySelectorAll('.titlebar-file-btn').length,
        brand: r(brand), group: r(group), tabArea: r(tabArea),
      };
    });
    log('titlebar', facts);
    expect(facts.groupCount, 'exactly ONE file group').toBe(1);
    expect(facts.btnCount, 'three controls: Open / Save / Save As').toBe(3);
    expect(facts.brand.right, 'group starts at/right of the logo').toBeLessThanOrEqual(facts.group.x + 1);
    expect(facts.group.right, 'group ends at/left of the tab strip').toBeLessThanOrEqual(facts.tabArea.x + 1);
    await shot(win, 'release-1210-titlebar.png', { x: 0, y: 0, width: 1440, height: 60 });
    expect(ctx.consoleErrors, 'zero renderer console errors').toEqual([]);
    expect(ctx.pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, { label: 'release-1210-titlebar' });
});
