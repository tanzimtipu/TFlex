// Release 1.20.0 - INSTALLED-app validation (qa), explicitly ordered by the
// orchestrator. Launches the NSIS-installed %LOCALAPPDATA%\Programs\TFlex\TFlex.exe
// through the canonical launchApp() from e2e/lib/launch.cjs and verifies, on that
// installed build:
//
//   0. VERSION GATE - app.getVersion() === '1.20.0' (test 1, serial: a mismatch
//      aborts every remaining test).
//   1. PHASE 20 (animation standard) - morphing menus open with the first
//      painted frame equal to the trigger rect + flush anchored edge and exit
//      back into the trigger; Sign modal tabs interpolate their height; the
//      search bar (a previously un-animated surface) animates in and out;
//      reduced motion (CDP) collapses the morph to the opacity-only path.
//   2. PHASE 21 (text panel) - panel docks left of the page and the page
//      reflows (frame numbers); per-control live + Save As/close/reopen
//      round-trip (font family, bold, highlight set then cleared, alignment,
//      list, indent); no floating style toolbox on a text tool (grip +
//      Confirm/Cancel/Delete remain); an annotation routes to the panel with
//      colour live and the rest disabled with the reason tooltip.
//   3. PHASE 22 (title bar) - group between logo and tabs; no
//      [data-toolbar-open|save|save-as] inside .toolbar and exactly one of each;
//      Ctrl+S saves in place; Ctrl+Shift+S opens Save As without touching the
//      source; at 640px a tab title is visible and the active tab is scrolled
//      into view; the clean/modified/read-only state matrix holds.
//   4. DEF-214 guard + regression - .ann-toolbar + [data-toolbar-edit-toggle]
//      arms .edit-toolbar, zero console/page errors; watermark apply +
//      delete-by-id still works.
//   5. DEFECT DISPOSITION - DEF-233..240 (Phase 20), DEF-241/242 (Phase 21),
//      DEF-243..246 (Phase 22) verified on this installed 1.20.0 build.
//
// Screenshots: release-1200-{morph,text-panel,titlebar,titlebar-640}.png.
//
// Run: npm.cmd run test:e2e -- e2e/release_1_20_0_installed.spec.cjs
// The installed path can be overridden with TFLEX_PACKAGED_EXE.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, dismissUpdatePrompt, armAnnotationTool, openSamplePath } = require('./lib/helpers.cjs');

const PACKAGED_EXE =
  process.env.TFLEX_PACKAGED_EXE ||
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'TFlex', 'TFlex.exe');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const SAMPLES = path.resolve(__dirname, '..', 'assets', 'samples');

test.setTimeout(300000);
test.describe.configure({ mode: 'serial' });

async function withApp(fn, { userDataDir = null, label = 'release-1200' } = {}) {
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
  console.log(`[release-1200] shot ${name}`);
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

function freshSample(name) {
  const dir = path.join(os.tmpdir(), 'tflex-release-1200');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(
    dir,
    `${name.replace(/\.pdf$/i, '')}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`,
  );
  fs.copyFileSync(path.join(SAMPLES, name), target);
  return target;
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

async function rectOf(win, sel) {
  return win.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x: +r.left.toFixed(2), y: +r.top.toFixed(2),
      w: +r.width.toFixed(2), h: +r.height.toFixed(2),
      right: +r.right.toFixed(2), bottom: +r.bottom.toFixed(2),
      to: cs.transformOrigin, pe: cs.pointerEvents,
    };
  }, sel);
}

// Single-selector rAF probe (rect/opacity/transform/pointer-events/morph/inert).
async function installProbe(win) {
  await win.evaluate(() => {
    window.__p = { rows: [], running: false };
    window.__pStart = (sel, ms) => {
      window.__p = { rows: [], running: true };
      const t0 = performance.now();
      const tick = () => {
        const t = Math.round(performance.now() - t0);
        const el = document.querySelector(sel);
        if (el) {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          window.__p.rows.push({
            t,
            x: +r.left.toFixed(2), y: +r.top.toFixed(2),
            w: +r.width.toFixed(2), h: +r.height.toFixed(2),
            right: +r.right.toFixed(2), bottom: +r.bottom.toFixed(2),
            tr: cs.transform, op: +cs.opacity,
            pe: cs.pointerEvents, to: cs.transformOrigin,
            morph: el.getAttribute('data-tf-morph'),
            inert: el.hasAttribute('inert') || el.closest('[inert]') !== null,
          });
        } else {
          window.__p.rows.push({ t, gone: true });
        }
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else window.__p.running = false;
      };
      requestAnimationFrame(tick);
    };
  });
}
async function startProbe(win, sel, ms) {
  await win.evaluate(([s, m]) => window.__pStart(s, m), [sel, ms]);
}
async function readProbe(win) {
  await win.waitForFunction(() => window.__p && window.__p.running === false, null, { timeout: 8000 }).catch(() => {});
  return win.evaluate(() => window.__p.rows);
}

const near = (a, b, tol) => Math.abs(a - b) <= tol;
const visibleRows = (rows) => rows.filter((r) => !r.gone);
const log = (label, obj) => console.log(`[release-1200|${label}] ${JSON.stringify(obj)}`);

// Multi-selector probe (count/opacity/rect/transform/animation) for resize + swap.
async function installMultiProbe(win) {
  await win.evaluate(() => {
    window.__mp = { rows: [], running: false };
    window.__mpStart = (sels, ms) => {
      window.__mp = { rows: [], running: true };
      const t0 = performance.now();
      const tick = () => {
        const t = Math.round(performance.now() - t0);
        const states = sels.map((s) => {
          const els = [...document.querySelectorAll(s)];
          if (els.length === 0) return { s, n: 0, ops: [] };
          const first = els[0];
          const cs = getComputedStyle(first);
          const r = first.getBoundingClientRect();
          return {
            s, n: els.length,
            ops: els.map((e) => +getComputedStyle(e).opacity),
            x: +r.left.toFixed(1), y: +r.top.toFixed(1),
            w: +r.width.toFixed(1), h: +r.height.toFixed(1),
            right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1),
            pe: cs.pointerEvents, an: cs.animationName, tr: cs.transform,
          };
        });
        window.__mp.rows.push({ t, states });
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else window.__mp.running = false;
      };
      requestAnimationFrame(tick);
    };
  });
}
async function mpStart(win, sels, ms) {
  await win.evaluate(([s, m]) => window.__mpStart(s, m), [sels, ms]);
}
async function mpRead(win) {
  await win.waitForFunction(() => window.__mp && window.__mp.running === false, null, { timeout: 8000 }).catch(() => {});
  return win.evaluate(() => window.__mp.rows);
}

// rAF probe for the text panel: width + workspace-main left inset + palette.
async function installPanelProbe(win) {
  await win.evaluate(() => {
    window.__pp = { rows: [], done: false };
    window.__ppStart = (ms) => {
      window.__pp = { rows: [], done: false };
      const t0 = performance.now();
      const tick = () => {
        const panel = document.querySelector('.text-props-panel');
        const main = document.querySelector('.workspace-main');
        const rail = document.querySelector('.side-rail');
        const pr = panel ? panel.getBoundingClientRect() : null;
        const mr = main ? main.getBoundingClientRect() : null;
        const rr = rail ? rail.getBoundingClientRect() : null;
        window.__pp.rows.push({
          t: Math.round(performance.now() - t0),
          panelW: pr ? +pr.width.toFixed(2) : 0,
          panelRight: pr ? +pr.right.toFixed(2) : null,
          panelLeft: pr ? +pr.left.toFixed(2) : null,
          mainLeft: mr ? +mr.left.toFixed(2) : null,
          railRight: rr ? +rr.right.toFixed(2) : null,
          tr: panel ? getComputedStyle(panel).transform : null,
          op: panel ? +getComputedStyle(panel).opacity : null,
        });
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else window.__pp.done = true;
      };
      requestAnimationFrame(tick);
    };
  });
}
async function ppStart(win, ms) {
  await win.evaluate((m) => window.__ppStart(m), ms);
}
async function ppRead(win) {
  await win.waitForFunction(() => window.__pp && window.__pp.done === true, null, { timeout: 10000 }).catch(() => {});
  return win.evaluate(() => window.__pp.rows);
}

async function boxModels(win) {
  return win.evaluate(() => {
    const st = window.tflexDiagnostics().engineState;
    if (!st || !st.textBoxes) return null;
    return st.textBoxes.map((b) => ({
      id: b.id, text: b.text, page: b.page,
      font: b.font, size: b.size, bold: b.bold, italic: b.italic,
      underline: b.underline, color: b.color,
      highlight: b.highlight ?? null, align: b.align, lineHeight: b.lineHeight,
      list: b.list, indent: b.indent,
    }));
  });
}
async function waitForBox(win, text, pred, timeout = 12000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    const boxes = (await boxModels(win)) || [];
    const b = boxes.find((x) => x.text === text);
    last = b;
    if (b && (pred ? pred(b) : true)) return b;
    await win.waitForTimeout(150);
  }
  return last;
}
async function panelState(win) {
  return win.evaluate(() => {
    const p = document.querySelector('.text-props-panel');
    const body = document.querySelector('[data-text-panel]');
    if (!p) return null;
    const q = (s) => p.querySelector(s);
    const pressed = (s) => q(s)?.getAttribute('aria-pressed') === 'true';
    return {
      mode: body ? body.getAttribute('data-text-panel-mode') : null,
      font: q('[data-txt-font]')?.value ?? null,
      bold: pressed('[data-txt-bold]'),
      color: q('[data-txt-color]')?.value ?? null,
      highlight: q('[data-txt-highlight]')?.value ?? null,
      align: ['left', 'center', 'right', 'justify'].filter((a) => pressed(`[data-txt-align-${a}]`)),
      list: ['none', 'bullet', 'number'].filter((l) => pressed(`[data-txt-list-${l}]`)),
      indent: q('[data-txt-indent-value]')?.textContent ?? null,
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

async function openEditMode(win) {
  if ((await win.locator('[data-edit-toolbar]').count()) === 0) {
    await win.click('button[aria-label="Edit content"]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
  }
}
async function closeEditMode(win) {
  if ((await win.locator('[data-edit-toolbar]').count()) > 0) {
    await win.click('button[aria-label="Edit content"]');
    await win.waitForTimeout(400);
  }
}
async function dragOnPage(win, fx, fy, dx = 200, dy = 70) {
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 260));
  const y = Math.max(pg.y + 20, Math.min(pg.y + pg.height * fy, vp.h - 130));
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dx, y + dy, { steps: 6 });
  await win.mouse.up();
}
async function createTextBox(win, text, fx = 0.22, fy = 0.18) {
  await openEditMode(win);
  await win.click('[data-edit-tool="box"]');
  await dragOnPage(win, fx, fy);
  await win.waitForSelector('[data-edit-editor]', { timeout: 8000 });
  await win.locator('[data-edit-textarea]').fill(text);
  await win.click('[data-edit-confirm]');
  await win.waitForSelector('.edit-box', { timeout: 8000 });
  await win.waitForTimeout(400);
  await win.locator('.edit-box').first().click({ position: { x: 8, y: 8 } });
  await win.waitForSelector('[data-edit-box-toolbar]', { timeout: 8000 });
  await win.waitForTimeout(300);
}

// ===========================================================================
// 0. VERSION GATE
// ===========================================================================
test('VERSION GATE: installed build reports app.getVersion() 1.20.0', async () => {
  await withApp(async (win, ctx, app) => {
    const version = await app.evaluate(async ({ app: a }) => a.getVersion());
    console.log(`[release-1200] app.getVersion() = ${JSON.stringify(version)} (exe: ${PACKAGED_EXE})`);
    expect(version, 'installed build version').toBe('1.20.0');
  }, { label: 'release-1200-version' });
});

// ===========================================================================
// 1. PHASE 20 - morph menus, sign tabs, search bar, reduced motion
// ===========================================================================
const MENUS = [
  { name: 'theme', trigger: '[data-theme-toggle]', surface: '.theme-toggle-popover', anchorSide: 'right' },
  { name: 'titlebar', trigger: '[data-menu-button]', surface: '.titlebar-menu-popover', anchorSide: 'left' },
  { name: 'ann', trigger: '[data-ann-dropdown-toggle]', surface: '.ann-tool-menu', anchorSide: 'right' },
];

test('PHASE 20: morph open (first frame = trigger, flush anchored edge) + exit into trigger', async () => {
  await withApp(async (win, ctx, app) => {
    await setSize(app, win, 1440, 900);
    await openReport(app, win);
    await setTheme(win, 'frosted');
    await installProbe(win);
    for (const m of MENUS) {
      await win.waitForTimeout(250);
      const trig = await rectOf(win, m.trigger);
      expect(trig, `${m.name} trigger present`).not.toBeNull();

      await startProbe(win, m.surface, 700);
      await win.click(m.trigger);
      await win.waitForSelector(m.surface, { timeout: 5000 });
      await win.waitForTimeout(50);
      const open = visibleRows(await readProbe(win));
      expect(open.length, `${m.name} open frames`).toBeGreaterThan(3);
      const first = open[0];
      const rest = open[open.length - 1];
      const widths = [...new Set(open.map((r) => Math.round(r.w)))];
      const anchorGap = m.anchorSide === 'right' ? rest.right - trig.right : rest.x - trig.x;
      log(`morph-open-${m.name}`, {
        trigger: [trig.x, trig.y, trig.w, trig.h],
        firstFrame: [first.x, first.y, first.w, first.h, first.op],
        rest: [rest.x, rest.y, rest.w, rest.h, rest.op],
        gapBelow: +(rest.y - trig.bottom).toFixed(2),
        anchorGap: +anchorGap.toFixed(2),
        distinctWidths: widths.length,
      });
      expect(near(first.x, trig.x, 2.5), `${m.name} first frame x == trigger x`).toBe(true);
      expect(near(first.y, trig.y, 2.5), `${m.name} first frame y == trigger y`).toBe(true);
      expect(near(first.w, trig.w, 2.5), `${m.name} first frame w == trigger w`).toBe(true);
      expect(near(first.h, trig.h, 2.5), `${m.name} first frame h == trigger h`).toBe(true);
      expect(widths.length, `${m.name} width interpolates`).toBeGreaterThanOrEqual(4);
      expect(near(rest.y - trig.bottom, 0, 1.5), `${m.name} flush below trigger (gap 0)`).toBe(true);
      // Right-anchored menus are exactly flush; the title-bar menu keeps its
      // documented 4px left inset (--sp-1), bounded small and recorded above.
      expect(near(anchorGap, 0, m.anchorSide === 'right' ? 1.5 : 6), `${m.name} anchored edge flush`).toBe(true);
      expect(rest.op, `${m.name} settles opaque`).toBe(1);
      await shot(win, `release-1200-morph-${m.name}.png`);
      if (m.name === 'theme') await shot(win, 'release-1200-morph.png');

      // Exit reverses into the trigger.
      await startProbe(win, m.surface, 700);
      await win.keyboard.press('Escape');
      const closeRows = await readProbe(win);
      const closing = visibleRows(closeRows);
      const goneFrame = closeRows.find((r) => r.gone);
      const lastVisible = closing[closing.length - 1];
      const minW = Math.min(...closing.map((r) => r.w));
      const travel = rest.w - trig.w;
      log(`morph-close-${m.name}`, {
        frames: closing.length, minWidth: minW, triggerW: trig.w,
        lastOp: lastVisible.op, lastMorph: lastVisible.morph, unmounted: goneFrame !== undefined,
      });
      expect(goneFrame, `${m.name} unmounts after exit`).toBeDefined();
      expect(minW, `${m.name} exit reverses into trigger (>=85% of travel)`).toBeLessThanOrEqual(trig.w + travel * 0.15);
      expect(lastVisible.op, `${m.name} exit ends faded`).toBeLessThan(0.2);
      expect(lastVisible.morph, `${m.name} exit carries data-tf-morph=out`).toBe('out');
    }
    expect(ctx.consoleErrors, 'zero renderer console errors').toEqual([]);
    expect(ctx.pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, { label: 'release-1200-phase20-morph' });
});

test('PHASE 20: Sign modal tabs interpolate their height (frame rects reported)', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    await win.click('button[data-icon="sign"]');
    await win.waitForSelector('.sig-manager', { timeout: 8000 });
    await win.waitForTimeout(600);
    await installMultiProbe(win);
    await win.locator('.sig-tab', { hasText: 'Draw' }).first().click();
    await win.waitForTimeout(500);

    const order = [
      { name: 'draw->type', label: 'Type' },
      { name: 'type->saved', label: 'Saved' },
      { name: 'saved->draw', label: 'Draw' },
    ];
    const results = [];
    for (const t of order) {
      const before = await rectOf(win, '[data-tf-resize]');
      await mpStart(win, ['[data-tf-resize]', '.sig-tab-pane'], 800);
      await win.locator('.sig-tab', { hasText: t.label }).first().click();
      const rows = await mpRead(win);
      const after = await rectOf(win, '[data-tf-resize]');
      const heights = rows
        .map((f) => f.states.find((s) => s.s === '[data-tf-resize]'))
        .filter((s) => s && s.n > 0)
        .map((s) => Math.round(s.h));
      const uniq = [...new Set(heights)];
      const paneRows = rows.map((f) => {
        const s = f.states.find((x) => x.s === '.sig-tab-pane');
        return { n: s?.n ?? 0, ops: s?.ops ?? [] };
      });
      const r = {
        tab: t.name, fromH: Math.round(before.h), toH: Math.round(after.h),
        frameHeights: uniq.slice(0, 12), distinctHeights: uniq.length,
        zeroPaneFrames: paneRows.filter((p) => p.n === 0).length,
        bothPaneAtRestFrames: paneRows.filter((p) => p.ops.length >= 2 && p.ops.every((o) => o >= 0.99)).length,
        paneOverlapFrames: paneRows.filter((p) => p.n >= 2).length,
      };
      results.push(r);
      log(`sign-tab-${t.name}`, r);
      await win.waitForTimeout(450);
    }
    for (const r of results) {
      if (r.fromH !== r.toH) {
        expect(r.distinctHeights, `${r.tab}: height interpolates (not a jump)`).toBeGreaterThanOrEqual(3);
      }
      expect(r.zeroPaneFrames, `${r.tab}: no frame with both panes absent`).toBe(0);
      expect(r.bothPaneAtRestFrames, `${r.tab}: no frame with both panes fully at rest`).toBe(0);
      expect(r.paneOverlapFrames, `${r.tab}: panes overlap (cross-fade)`).toBeGreaterThan(0);
    }
    await shot(win, 'release-1200-sign-tabs.png');
  }, { label: 'release-1200-phase20-signtabs' });
});

test('PHASE 20: search bar (previously un-animated surface) animates in and out', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    await installMultiProbe(win);
    await mpStart(win, ['.search-bar'], 900);
    await win.keyboard.press('Control+f');
    const enterRows = await mpRead(win);
    const frames = enterRows.map((f) => f.states[0]).filter((s) => s && s.n > 0);
    const midFlight = frames.some((s) => (s.ops[0] ?? 1) < 0.999 || (s.tr && s.tr !== 'none'));
    const keyframes = [...new Set(frames.map((s) => s.an).filter((a) => a && a !== 'none'))];
    log('search-enter', { frames: frames.length, firstOp: frames[0]?.ops[0], firstTr: frames[0]?.tr, midFlight, keyframes });
    expect(frames.length, 'search bar mounts').toBeGreaterThan(0);
    expect(midFlight, 'search bar entrance is animated (mid-flight frame)').toBe(true);
    expect(keyframes, 'no CSS keyframe on the search bar root').toEqual([]);
    await shot(win, 'release-1200-searchbar.png');

    await win.keyboard.press('Escape');
    await win.waitForFunction(() => document.querySelector('.search-bar') === null, null, { timeout: 6000 });
    expect(await win.locator('.search-bar').count(), 'search bar unmounts after exit').toBe(0);
  }, { label: 'release-1200-phase20-searchbar' });
});

test('PHASE 20: reduced motion (CDP) collapses the morph to the opacity-only path', async () => {
  await withApp(async (win, ctx, app) => {
    const cdp = await win.context().newCDPSession(win);
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    const rm = await win.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    expect(rm, 'reduced motion emulated').toBe(true);
    await openReport(app, win);
    await installMultiProbe(win);
    await mpStart(win, ['.theme-toggle-popover'], 700);
    await win.click('[data-theme-toggle]');
    const rows = await mpRead(win);
    const frames = rows.map((f) => f.states[0]).filter((s) => s && s.n > 0);
    const travelFrames = frames.filter((s) => s.tr && s.tr !== 'none').length;
    log('reduced-morph', { mounted: frames.length, travelFrames, ops: [...new Set(frames.map((s) => s.ops[0]))].slice(0, 6) });
    expect(frames.length, 'reduced: popover still mounts (structure unchanged)').toBeGreaterThan(0);
    expect(travelFrames, 'reduced: morph never travels (opacity-only)').toBe(0);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
  }, { label: 'release-1200-phase20-reduced' });
});

// ===========================================================================
// 2. PHASE 21 - text panel
// ===========================================================================
test('PHASE 21: panel docks left of the page and the page reflows (frame numbers)', async () => {
  await withApp(async (win, ctx, app) => {
    await setSize(app, win, 1440, 900);
    await openReport(app, win);
    await installPanelProbe(win);
    const closed = await win.evaluate(() => ({
      panels: document.querySelectorAll('.text-props-panel').length,
      mainLeft: +document.querySelector('.workspace-main').getBoundingClientRect().left.toFixed(2),
      railRight: +document.querySelector('.side-rail').getBoundingClientRect().right.toFixed(2),
    }));

    await ppStart(win, 900);
    await armAnnotationTool(win, 'textbox');
    await win.waitForSelector('.text-props-panel', { timeout: 6000 });
    const openRows = await ppRead(win);
    const live = openRows.filter((r) => r.panelW > 0);
    const widths = [...new Set(live.map((r) => Math.round(r.panelW)))];
    const mainLefts = [...new Set(live.map((r) => Math.round(r.mainLeft)))];
    const lockDelta = Math.max(0, ...live.map((r) => Math.abs((r.mainLeft - r.railRight) - r.panelW)));
    const settled = live[live.length - 1];
    const dock = await win.evaluate(() => {
      const p = document.querySelector('.text-props-panel');
      const main = document.querySelector('.workspace-main');
      const rail = document.querySelector('.side-rail');
      const pr = p.getBoundingClientRect();
      const mr = main.getBoundingClientRect();
      const rr = rail.getBoundingClientRect();
      return {
        panelLeft: +pr.left.toFixed(2), panelRight: +pr.right.toFixed(2), panelW: +pr.width.toFixed(2),
        railRight: +rr.right.toFixed(2), mainLeft: +mr.left.toFixed(2),
        dockedLeftOfPage: pr.left >= rr.right - 2 && pr.right <= mr.left + 2,
      };
    });
    log('phase21-panel-open', { distinctWidths: widths, distinctMainLefts: mainLefts, lockDelta: +lockDelta.toFixed(2), settled, dock });
    expect(settled.panelW, 'open panel width ~248px').toBeGreaterThan(240);
    expect(widths.length, 'panel width interpolates (>=3 distinct widths)').toBeGreaterThanOrEqual(3);
    expect(mainLefts.length, 'page inset interpolates in lockstep (>=3 distinct values)').toBeGreaterThanOrEqual(3);
    expect(lockDelta, 'panel width and page inset move in lockstep').toBeLessThanOrEqual(2);
    expect(dock.dockedLeftOfPage, 'panel is docked immediately left of the page column').toBe(true);
    await shot(win, 'release-1200-text-panel.png');

    await ppStart(win, 900);
    await armAnnotationTool(win, 'select');
    await ppRead(win);
    const after = await win.evaluate(() => ({
      panels: document.querySelectorAll('.text-props-panel').length,
      mainLeft: +document.querySelector('.workspace-main').getBoundingClientRect().left.toFixed(2),
    }));
    log('phase21-panel-close', { after, closed });
    expect(after.panels, 'panel unmounts on deselect').toBe(0);
    expect(Math.abs(after.mainLeft - closed.mainLeft), 'page inset returns to the closed value').toBeLessThanOrEqual(2);
  }, { label: 'release-1200-phase21-reflow' });
});

test('PHASE 21: per-control live + Save As/close/reopen round-trip', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    await createTextBox(win, 'R120-A', 0.2, 0.15);
    const rows = [];
    const mark = (control, live, note) => rows.push({ control, live, note });

    await win.locator('[data-txt-font]').selectOption('Times');
    let b = await waitForBox(win, 'R120-A', (x) => x.font === 'Times');
    let ps = await panelState(win);
    mark('font family', b.font === 'Times' && ps.font === 'Times', `engine=${b.font} panel=${ps.font}`);

    await win.click('[data-txt-bold]');
    b = await waitForBox(win, 'R120-A', (x) => x.bold === true);
    ps = await panelState(win);
    mark('bold', b.bold === true && ps.bold === true, `engine=${b.bold} panel=${ps.bold}`);

    await win.locator('[data-txt-highlight]').fill('#ffff00');
    b = await waitForBox(win, 'R120-A', (x) => x.highlight !== null);
    const hlSet = b.highlight;
    await win.click('[data-txt-highlight-clear]');
    b = await waitForBox(win, 'R120-A', (x) => x.highlight === null);
    mark('highlight set then cleared', hlSet && hlSet.r === 1 && hlSet.g === 1 && hlSet.b === 0 && b.highlight === null,
      `set=${JSON.stringify(hlSet)} cleared=${JSON.stringify(b.highlight)}`);

    for (const a of ['center', 'right', 'justify', 'left']) {
      await win.click(`[data-txt-align-${a}]`);
      b = await waitForBox(win, 'R120-A', (x) => x.align === a);
    }
    await win.click('[data-txt-align-center]');
    b = await waitForBox(win, 'R120-A', (x) => x.align === 'center');
    ps = await panelState(win);
    mark('alignment', b.align === 'center' && ps.align.includes('center'), `engine=${b.align} panel=${ps.align}`);

    await win.click('[data-txt-list-bullet]');
    b = await waitForBox(win, 'R120-A', (x) => x.list === 'bullet');
    ps = await panelState(win);
    mark('list', b.list === 'bullet' && ps.list.includes('bullet'), `engine=${b.list} panel=${ps.list}`);

    await win.click('[data-txt-indent-inc]');
    await win.click('[data-txt-indent-inc]');
    b = await waitForBox(win, 'R120-A', (x) => x.indent === 24);
    ps = await panelState(win);
    mark('indent', b.indent === 24 && ps.indent === '24', `engine=${b.indent} panel=${ps.indent}`);
    log('phase21-roundtrip-live', rows);
    for (const r of rows) expect(r.live, `${r.control}: live change`).toBe(true);

    // Save As -> close -> reopen.
    const savePath = path.join(os.tmpdir(), `tflex-rel1200-p21-${Date.now()}.pdf`);
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, savePath);
    await win.click('[data-toolbar-save-as]');
    await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
    await win.click('[data-save-as-confirm]');
    await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 30000 });
    expect(fs.existsSync(savePath), 'saved PDF exists on disk').toBe(true);
    console.log(`[release-1200|SAVED] path=${savePath} bytes=${fs.statSync(savePath).size}`);

    await win.locator('.tab-active .tab-close').click();
    await win.waitForTimeout(1200);
    await openSamplePath(win, app, savePath);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(2000);
    const a2 = await waitForBox(win, 'R120-A', null, 20000);
    log('phase21-roundtrip-reopened', a2);
    expect(a2, 'the text box survives save+reopen').toBeTruthy();
    expect(a2.font, 'font family round-trips').toBe('Times');
    expect(a2.bold, 'bold round-trips').toBe(true);
    expect(a2.highlight, 'highlight cleared -> NO band after reopen').toBe(null);
    expect(a2.align, 'alignment round-trips').toBe('center');
    expect(a2.list, 'list round-trips').toBe('bullet');
    expect(a2.indent, 'indent round-trips').toBe(24);
  }, { label: 'release-1200-phase21-roundtrip' });
});

test('PHASE 21: floating style toolbox does not mount for a text tool; grip + Confirm/Cancel/Delete remain', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    const RETIRED = '.edit-inline-field-font, .edit-inline-field-size, .edit-inline-field-color, .edit-inline-field-bg, [data-annotation-color-section]';
    await openEditMode(win);
    await win.click('[data-edit-tool="box"]');
    await dragOnPage(win, 0.25, 0.2, 180, 60);
    await win.waitForSelector('[data-edit-editor]', { timeout: 8000 });
    const editor = await win.evaluate((ret) => ({
      retired: document.querySelectorAll(ret).length,
      grip: !!document.querySelector('[data-edit-drag-handle]'),
      confirm: !!document.querySelector('[data-edit-confirm]'),
      cancel: !!document.querySelector('[aria-label="Cancel edit"]'),
      panel: !!document.querySelector('.text-props-panel'),
    }), RETIRED);
    log('phase21-no-floating-editor', editor);
    expect(editor.retired, 'no floating style control mounts on the editor').toBe(0);
    expect(editor.grip, 'drag grip present').toBe(true);
    expect(editor.confirm, 'Confirm present').toBe(true);
    expect(editor.cancel, 'Cancel present').toBe(true);
    expect(editor.panel, 'docked text panel serves the text tool').toBe(true);
    await win.locator('[data-edit-textarea]').fill('R120-C');
    await win.click('[data-edit-confirm]');
    await win.waitForSelector('.edit-box', { timeout: 8000 });
    await win.waitForTimeout(400);
    await win.locator('.edit-box').first().click({ position: { x: 8, y: 8 } });
    await win.waitForSelector('[data-edit-box-toolbar]', { timeout: 8000 });
    await win.click('[data-edit-box-action="edit"]');
    await win.waitForSelector('[data-edit-editor]', { timeout: 8000 });
    const committed = await win.evaluate((ret) => ({
      retired: document.querySelectorAll(ret).length,
      grip: !!document.querySelector('[data-edit-drag-handle]'),
      confirm: !!document.querySelector('[data-edit-confirm]'),
      cancel: !!document.querySelector('[aria-label="Cancel edit"]'),
      del: !!document.querySelector('[data-edit-action="delete"]'),
    }), RETIRED);
    log('phase21-no-floating-committed', committed);
    expect(committed.retired, 'committed editor: no floating style control').toBe(0);
    expect(committed.grip, 'committed editor: grip present').toBe(true);
    expect(committed.confirm, 'committed editor: Confirm present').toBe(true);
    expect(committed.cancel, 'committed editor: Cancel present').toBe(true);
    expect(committed.del, 'committed editor: Delete present').toBe(true);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
  }, { label: 'release-1200-phase21-nofloating' });
});

test('PHASE 21: annotation routes to the panel - colour live, rest disabled with the reason tooltip', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    await armAnnotationTool(win, 'textbox');
    await win.waitForSelector('.text-props-panel', { timeout: 6000 });
    await win.waitForTimeout(500);
    const REASON = "not supported for annotations - the annotation's text is baked by the annotation engine";
    const SELS = [
      '[data-txt-font]', '[data-txt-size]', '[data-txt-bold]', '[data-txt-italic]', '[data-txt-underline]',
      '[data-txt-super]', '[data-txt-sub]', '[data-txt-highlight]', '[data-txt-highlight-clear]', '[data-txt-clear]',
      '[data-txt-align-left]', '[data-txt-align-center]', '[data-txt-align-right]', '[data-txt-align-justify]',
      '[data-txt-line-height]', '[data-txt-list-none]', '[data-txt-list-bullet]', '[data-txt-list-number]',
      '[data-txt-indent-dec]', '[data-txt-indent-inc]', '[data-txt-character-spacing]', '[data-txt-horizontal-scaling]',
    ];
    const annot = await win.evaluate((args) => {
      const { sels, reason } = args;
      const p = document.querySelector('.text-props-panel');
      const body = document.querySelector('[data-text-panel]');
      const colour = p.querySelector('[data-txt-color]');
      const disabled = [];
      const missing = [];
      for (const s of sels) {
        const el = p.querySelector(s);
        if (!el) { missing.push(s); continue; }
        if (el.disabled) disabled.push({ sel: s, title: el.getAttribute('title') });
      }
      return {
        mode: body ? body.getAttribute('data-text-panel-mode') : null,
        note: !!p.querySelector('[data-txt-annotation-note]'),
        colourDisabled: colour ? colour.disabled : null,
        disabledCount: disabled.length,
        wrongTitle: disabled.filter((d) => d.title !== reason).length,
        missing,
      };
    }, { sels: SELS, reason: REASON });
    log('phase21-annotation', annot);
    expect(annot.mode, 'annotation: panel mode annotation').toBe('annotation');
    expect(annot.note, 'annotation: per-family hint shown').toBe(true);
    expect(annot.colourDisabled, 'annotation: colour is LIVE').toBe(false);
    expect(annot.missing, 'annotation: every control is present').toEqual([]);
    expect(annot.disabledCount, 'annotation: exactly 22 controls disabled').toBe(22);
    expect(annot.wrongTitle, 'annotation: every disabled control carries the exact reason tooltip').toBe(0);
    await shot(win, 'release-1200-annotation-panel.png');
  }, { label: 'release-1200-phase21-annotation' });
});

// ===========================================================================
// 3. PHASE 22 - title-bar file group
// ===========================================================================
test('PHASE 22: group between logo and tabs; no file hooks in .toolbar; exactly one of each', async () => {
  await withApp(async (win, ctx, app) => {
    await setSize(app, win, 1440, 900);
    await openReport(app, win);
    const facts = await win.evaluate(() => {
      const r = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.x), right: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) };
      };
      const brand = document.querySelector('.brand');
      const group = document.querySelector('.titlebar-file');
      const tabArea = document.querySelector('.tab-area');
      return {
        brand: r(brand), group: r(group), tabArea: r(tabArea),
        groupRole: group ? group.getAttribute('role') : null,
        groupLabel: group ? group.getAttribute('aria-label') : null,
        groupCount: document.querySelectorAll('.titlebar-file').length,
        btnCount: document.querySelectorAll('.titlebar-file-btn').length,
        barOpen: document.querySelectorAll('.toolbar [data-toolbar-open]').length,
        barSave: document.querySelectorAll('.toolbar [data-toolbar-save]').length,
        barSaveAs: document.querySelectorAll('.toolbar [data-toolbar-save-as]').length,
        totalOpen: document.querySelectorAll('[data-toolbar-open]').length,
        totalSave: document.querySelectorAll('[data-toolbar-save]').length,
        totalSaveAs: document.querySelectorAll('[data-toolbar-save-as]').length,
        groupH: group ? Math.round(group.getBoundingClientRect().height) : null,
        btnH: [...document.querySelectorAll('.titlebar-file-btn')].map((b) => Math.round(b.getBoundingClientRect().height)),
      };
    });
    log('phase22-placement', facts);
    expect(facts.groupCount, 'exactly ONE file group').toBe(1);
    expect(facts.groupRole, 'group is role=group').toBe('group');
    expect(facts.groupLabel, 'group has an accessible name').toBe('File actions');
    expect(facts.btnCount, 'three controls: Open / Save / Save As').toBe(3);
    expect(facts.brand.right, 'group starts at/right of the logo').toBeLessThanOrEqual(facts.group.x + 1);
    expect(facts.group.right, 'group ends at/left of the tab strip').toBeLessThanOrEqual(facts.tabArea.x + 1);
    expect(facts.groupH, 'capsule is the 32px title-bar ladder').toBe(32);
    for (const h of facts.btnH) expect(h, 'each control is 28px').toBe(28);
    expect(facts.barOpen, 'no Open inside .toolbar').toBe(0);
    expect(facts.barSave, 'no Save inside .toolbar').toBe(0);
    expect(facts.barSaveAs, 'no Save As inside .toolbar').toBe(0);
    expect(facts.totalOpen, 'exactly one [data-toolbar-open] overall').toBe(1);
    expect(facts.totalSave, 'exactly one [data-toolbar-save] overall').toBe(1);
    expect(facts.totalSaveAs, 'exactly one [data-toolbar-save-as] overall').toBe(1);
    await shot(win, 'release-1200-titlebar.png', { x: 0, y: 0, width: 1440, height: 60 });
  }, { label: 'release-1200-phase22-placement' });
});

test('PHASE 22: Ctrl+S saves in place; Ctrl+Shift+S opens Save As without touching the source', async () => {
  await withApp(async (win, ctx, app) => {
    const src = freshSample('report.pdf');
    await app.evaluate(async ({ dialog }, fp) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
    }, src);
    await win.locator('button:has-text("Open PDF")').first().click();
    await win.waitForSelector('.workspace', { timeout: 30000 });
    await win.waitForTimeout(1400);

    // Ctrl+S in place.
    await win.click('.tab-pane[aria-hidden="false"] [data-toolbar-rotate-cw]');
    await win.waitForTimeout(1200);
    const before = { size: fs.statSync(src).size, mtimeMs: Math.round(fs.statSync(src).mtimeMs) };
    await win.keyboard.press('Control+s');
    await win.waitForTimeout(2200);
    const afterS = { size: fs.statSync(src).size, mtimeMs: Math.round(fs.statSync(src).mtimeMs) };
    const saveState = await win.evaluate(() => {
      const s = document.querySelector('[data-toolbar-save]');
      return { disabled: s.disabled, title: s.getAttribute('title') };
    });
    log('phase22-ctrl-s', { before, afterS, saveState });
    expect(afterS.mtimeMs, 'Ctrl+S wrote the source in place').not.toBe(before.mtimeMs);
    expect(afterS.size, 'source is still a valid-size PDF').toBeGreaterThan(0);
    expect(saveState.disabled, 'after Ctrl+S the document is clean').toBe(true);

    // DEF-246: on the now-CLEAN on-disk document the Save As route must agree
    // with the (enabled) Save As button - Ctrl+Shift+S opens the dialog and
    // writes a copy, leaving the source untouched.
    const cleanCopy = path.join(os.tmpdir(), `tflex-rel1200-clean-copy-${Date.now()}.pdf`);
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, cleanCopy);
    await win.keyboard.press('Control+Shift+S');
    const cleanDialogOpened = await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 }).then(() => true).catch(() => false);
    if (cleanDialogOpened) {
      await win.click('[data-save-as-confirm]');
      await win.waitForFunction(() => !document.querySelector('[data-save-as-dialog]'), undefined, { timeout: 15000 });
      await win.waitForTimeout(1200);
    }
    log('phase22-def246-clean-route', { cleanDialogOpened, cleanCopyExists: fs.existsSync(cleanCopy) });
    expect(cleanDialogOpened, 'DEF-246: Ctrl+Shift+S opens Save As on a clean on-disk document').toBe(true);
    expect(fs.existsSync(cleanCopy), 'DEF-246: the clean Save As wrote a copy').toBe(true);

    // Ctrl+Shift+S on a fresh copy -> Save As, source untouched.
    const src2 = freshSample('report.pdf');
    await app.evaluate(async ({ dialog }, fp) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
    }, src2);
    await win.click('[data-toolbar-open]');
    await win.waitForFunction((n) => document.querySelectorAll('.tab[data-tab-id]').length > n, 1, { timeout: 30000 });
    await win.waitForTimeout(1400);
    await win.click('.tab-pane[aria-hidden="false"] [data-toolbar-rotate-cw]');
    await win.waitForTimeout(1200);
    const before2 = { size: fs.statSync(src2).size, mtimeMs: Math.round(fs.statSync(src2).mtimeMs) };
    const copyPath = path.join(os.tmpdir(), `tflex-rel1200-copy-${Date.now()}.pdf`);
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, copyPath);
    await win.keyboard.press('Control+Shift+S');
    await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
    await win.click('[data-save-as-confirm]');
    await win.waitForFunction(() => !document.querySelector('[data-save-as-dialog]'), undefined, { timeout: 15000 });
    await win.waitForTimeout(1500);
    const after2 = { size: fs.statSync(src2).size, mtimeMs: Math.round(fs.statSync(src2).mtimeMs) };
    const copy = fs.existsSync(copyPath) ? { size: fs.statSync(copyPath).size } : null;
    log('phase22-ctrl-shift-s', { before2, after2, copy });
    expect(after2.mtimeMs, 'Ctrl+Shift+S left the source mtime untouched').toBe(before2.mtimeMs);
    expect(after2.size, 'Ctrl+Shift+S left the source size untouched').toBe(before2.size);
    expect(copy, 'Ctrl+Shift+S wrote the copy').not.toBeNull();
    expect(copy.size, 'copy is a non-empty PDF').toBeGreaterThan(0);
  }, { label: 'release-1200-phase22-save' });
});

test('PHASE 22: at 640px a tab title is visible and the active tab is scrolled into view', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    await setSize(app, win, 640, 800);
    const src2 = freshSample('report.pdf');
    await app.evaluate(async ({ dialog }, fp) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
    }, src2);
    await win.click('[data-toolbar-open]');
    await win.waitForFunction((n) => document.querySelectorAll('.tab[data-tab-id]').length > n, 1, { timeout: 30000 });
    await win.waitForTimeout(1400);

    const m = await win.evaluate(() => {
      const tabArea = document.querySelector('.tab-area');
      const tabList = document.querySelector('.tab-list');
      const active = document.querySelector('.tab.tab-active');
      const title = active ? active.querySelector('.tab-title') : null;
      const lr = tabList.getBoundingClientRect();
      const ar = active ? active.getBoundingClientRect() : null;
      const tr = title ? title.getBoundingClientRect() : null;
      const vis = (r) => (r ? Math.max(0, Math.min(r.right, lr.right) - Math.max(r.left, lr.left)) : 0);
      return {
        innerW: window.innerWidth,
        tabAreaW: tabArea.clientWidth,
        tabListClientW: tabList.clientWidth,
        tabListScrollW: tabList.scrollWidth,
        scrollLeft: Math.round(tabList.scrollLeft),
        activeRect: ar ? { left: Math.round(ar.left), right: Math.round(ar.right) } : null,
        visibleTitleW: Math.round(vis(tr)),
        startVisible: ar ? ar.left >= lr.left - 1 : false,
      };
    });
    log('phase22-640-tabs', m);
    expect(m.innerW, 'window is at the 640px minimum').toBe(640);
    expect(m.tabAreaW, 'tab strip has real width at 640').toBeGreaterThan(8);
    expect(m.tabListScrollW, 'tab strip has scrollable overflow').toBeGreaterThan(m.tabListClientW);
    expect(m.startVisible, 'active tab start is visible').toBe(true);
    expect(m.visibleTitleW, 'a tab title is visible at 640').toBeGreaterThan(0);
    expect(m.scrollLeft, 'active tab is scrolled into view').toBeGreaterThan(0);
    await shot(win, 'release-1200-titlebar-640.png');
  }, { label: 'release-1200-phase22-640' });
});

test('PHASE 22: Save / Save As state matrix (clean, modified, read-only)', async () => {
  await withApp(async (win, ctx, app) => {
    const state = () => win.evaluate(() => {
      const s = document.querySelector('[data-toolbar-save]');
      const a = document.querySelector('[data-toolbar-save-as]');
      const dot = s ? s.querySelector('.titlebar-file-dot') : null;
      return {
        saveDisabled: s ? s.disabled : null,
        saveClass: s ? s.className : null,
        saveTitle: s ? s.getAttribute('title') : null,
        saveAsDisabled: a ? a.disabled : null,
        dotHidden: dot ? dot.classList.contains('titlebar-file-dot-hidden') : null,
      };
    });

    // Clean-on-disk: open a writable temp copy of report.pdf.
    await openReport(app, win);
    const clean = await state();
    log('phase22-matrix-clean', clean);
    expect(clean.saveDisabled, 'clean: Save disabled').toBe(true);
    expect(clean.dotHidden, 'clean: modified dot hidden').toBe(true);
    expect(clean.saveAsDisabled, 'clean: Save As enabled').toBe(false);

    await win.click('.tab-pane[aria-hidden="false"] [data-toolbar-rotate-cw]');
    await win.waitForTimeout(1200);
    const modified = await state();
    log('phase22-matrix-modified', modified);
    expect(modified.saveDisabled, 'modified: Save enabled').toBe(false);
    expect(modified.dotHidden, 'modified: dot visible').toBe(false);
    expect(modified.saveAsDisabled, 'modified: Save As enabled').toBe(false);

    // Read-only: open the bundled sample directly (no writable path).
    await win.locator('.tab-close').first().click();
    await win.waitForTimeout(700);
    if (await win.locator('[data-close-prompt-action="discard"]').count()) {
      await win.locator('[data-close-prompt-action="discard"]').first().click();
      await win.waitForTimeout(900);
    }
    await win.locator('.sample-card:has-text("report.pdf")').first().click();
    await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
    await win.waitForTimeout(1600);
    const roClean = await state();
    log('phase22-matrix-readonly-clean', roClean);
    expect(roClean.saveDisabled, 'read-only clean: Save disabled').toBe(true);
    // Read-only + clean keeps the clean tint (nothing to save); the read-only
    // tint is applied only when a read-only document is also modified.
    expect(roClean.saveClass, 'read-only clean: clean tint').toContain('titlebar-file-btn-clean');
    expect(roClean.saveAsDisabled, 'read-only clean: Save As enabled').toBe(false);

    await win.click('.tab-pane[aria-hidden="false"] [data-toolbar-rotate-cw]');
    await win.waitForTimeout(1200);
    const roModified = await state();
    log('phase22-matrix-readonly-modified', roModified);
    expect(roModified.saveDisabled, 'read-only modified: Save disabled').toBe(true);
    expect(roModified.saveClass, 'read-only modified: read-only tint retained').toContain('titlebar-file-btn-readonly');
    expect(roModified.saveTitle, 'read-only modified: tooltip explains Save As escape').toContain('Read-only');
    expect(roModified.saveAsDisabled, 'read-only modified: Save As enabled').toBe(false);
  }, { label: 'release-1200-phase22-matrix' });
});

// ===========================================================================
// 4. DEF-214 guard + watermark regression
// ===========================================================================
test('DEF-214 guard: .ann-toolbar + edit toggle arms .edit-toolbar; watermark apply/delete-by-id', async () => {
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
    console.log('[release-1200] exact toast observed: "Watermark applied."');

    if (!(await palette.isVisible().catch(() => false))) await win.locator('[data-tools-toggle]').first().click();
    await win.locator('[data-tool-id="watermark"]').click();
    await win.locator('[data-watermark-applied="wm-1"]').waitFor({ state: 'visible', timeout: 15000 });
    await win.locator('[data-watermark-delete="wm-1"]').click();
    await win.waitForFunction(() => Array.from(document.querySelectorAll('.toast .toast-text')).some((t) => (t.textContent || '').trim() === 'Watermark deleted.'), null, { timeout: 12000 });
    await win.locator('[data-watermark-applied="wm-1"]').waitFor({ state: 'detached', timeout: 15000 });
    console.log('[release-1200] exact toast observed: "Watermark deleted."; row detached');

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
  }, { label: 'release-1200-def214' });
});

// ===========================================================================
// 5. DEFECT DISPOSITION (installed 1.20.0 build)
// ===========================================================================
test('DEF-233: frosted tools-palette width interpolates in lockstep (page inset + badge)', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
    await win.waitForTimeout(500);
    await installMultiProbe(win);
    const results = [];
    for (const theme of ['frosted', 'light']) {
      await setTheme(win, theme);
      if ((await win.locator('[data-tools-palette]').count()) === 0) {
        await win.click('[data-tools-toggle]');
        await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
        await win.waitForTimeout(400);
      }
      const pre = await win.evaluate(() => {
        const cs = getComputedStyle(document.querySelector('[data-tools-palette]'));
        return { transitionProperty: cs.transitionProperty, transitionDuration: cs.transitionDuration };
      });
      const sample = async (label) => {
        await mpStart(win, ['[data-tools-palette]', '.document-scroller', '.tools-badge-tracker'], 900);
        await win.click(`[data-tools-layout="${label.endsWith('grid') ? 'grid' : 'list'}"]`);
        const rows = await mpRead(win);
        const series = (sel, key) => [...new Set(rows.map((f) => {
          const s = f.states.find((x) => x.s === sel);
          return s && s.n > 0 ? Math.round(s[key]) : null;
        }).filter((v) => v !== null))];
        return { paletteWidths: series('[data-tools-palette]', 'w'), scrollerRights: series('.document-scroller', 'right'), badgeRights: series('.tools-badge-tracker', 'right') };
      };
      const toGrid = await sample(`${theme}-grid`);
      await win.waitForTimeout(450);
      const toList = await sample(`${theme}-list`);
      const r = { theme, transitionProperty: pre.transitionProperty, transitionDuration: pre.transitionDuration, toGrid, toList };
      results.push(r);
      log('def233', r);
    }
    for (const r of results) {
      for (const [name, s] of [['grid', r.toGrid], ['list', r.toList]]) {
        expect(s.paletteWidths.length, `${r.theme} ${name}: palette width interpolates`).toBeGreaterThanOrEqual(3);
        expect(s.scrollerRights.length, `${r.theme} ${name}: page inset interpolates`).toBeGreaterThanOrEqual(3);
        expect(s.badgeRights.length, `${r.theme} ${name}: badge interpolates`).toBeGreaterThanOrEqual(3);
      }
    }
  }, { label: 'release-1200-def233' });
});

test('DEF-234: reduced motion - inline editor first frame transform none', async () => {
  await withApp(async (win, ctx, app) => {
    const cdp = await win.context().newCDPSession(win);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    expect(await win.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await openReport(app, win);
    await installMultiProbe(win);
    await openEditMode(win);
    await win.click('[data-edit-tool="box"]');
    await mpStart(win, ['[data-edit-editor]'], 1200);
    await dragOnPage(win, 0.3, 0.3, 160, 50);
    const rows = await mpRead(win);
    const mounted = rows.map((f) => f.states[0]).filter((s) => s && s.n > 0);
    const transforms = mounted.map((s) => s.tr);
    log('def234', { mountedFrames: mounted.length, firstTransform: transforms[0], distinctTransforms: [...new Set(transforms)] });
    expect(mounted.length, 'reduced: inline editor still mounts').toBeGreaterThan(0);
    expect(transforms[0], 'reduced: first mounted frame transform is none').toBe('none');
    expect([...new Set(transforms)], 'reduced: no frame travels').toEqual(['none']);
    await win.click('button[aria-label="Cancel edit"]');
    await win.waitForFunction(() => document.querySelectorAll('[data-edit-editor]').length === 0, null, { timeout: 5000 });
  }, { label: 'release-1200-def234' });
});

test('DEF-235: held Ctrl+Enter during the editor exit does not duplicate the committed text box', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    await openEditMode(win);
    await win.click('[data-edit-tool="box"]');
    await dragOnPage(win, 0.3, 0.3, 180, 60);
    await win.waitForSelector('[data-edit-editor]', { timeout: 8000 });
    await win.locator('[data-edit-textarea]').fill('DUP-A');
    await win.click('[data-edit-confirm]');
    for (let i = 0; i < 10; i += 1) {
      await win.keyboard.press('Control+Enter');
      await win.waitForTimeout(15);
    }
    await win.waitForTimeout(1800);
    const st = await win.evaluate(() => ({
      boxes: document.querySelectorAll('.edit-box').length,
      editors: document.querySelectorAll('[data-edit-editor]').length,
      textBoxes: ((window.tflexDiagnostics().engineState || {}).textBoxes || []).length,
    }));
    log('def235', st);
    expect(st.textBoxes, 'one Confirm commits exactly one text box').toBe(1);
    expect(st.boxes, 'one .edit-box').toBe(1);
  }, { label: 'release-1200-def235' });
});

test('DEF-236: held Enter during the signature pending exit commits one placement', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    await win.click('button[data-icon="sign"]');
    await win.waitForSelector('.sig-manager', { timeout: 8000 });
    await win.locator('.sig-tab', { hasText: 'Type' }).first().click();
    await win.waitForTimeout(450);
    await win.locator('.sig-type-input').fill('QA Sign');
    await win.locator('.sig-tab-pane[data-tf-pane="in"] .sig-tab-actions .btn-primary').click();
    await win.waitForSelector('.sig-saved-pick', { timeout: 8000 });
    await win.locator('.sig-saved-pick').first().click();
    await win.waitForFunction(() => document.querySelector('.sig-manager') === null, null, { timeout: 5000 });
    await win.waitForTimeout(300);
    const page = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.mouse.click(page.x + page.width * 0.4, page.y + page.height * 0.4);
    await win.waitForSelector('[data-sig-pending]', { timeout: 8000 });
    await win.waitForTimeout(300);
    const before = await win.evaluate(() => ({
      signatures: ((window.tflexDiagnostics().engineState || {}).signatures || []).length,
      placements: document.querySelectorAll('[data-placement-id]').length,
    }));
    await win.click('[data-sig-pending] [data-sig-action="confirm"]');
    for (let i = 0; i < 10; i += 1) {
      await win.keyboard.press('Enter');
      await win.waitForTimeout(15);
    }
    await win.waitForTimeout(1800);
    const after = await win.evaluate(() => ({
      signatures: ((window.tflexDiagnostics().engineState || {}).signatures || []).length,
      placements: document.querySelectorAll('[data-placement-id]').length,
      pending: document.querySelectorAll('[data-sig-pending]').length,
    }));
    log('def236', { before, after });
    expect(before.signatures, 'no signature before Confirm').toBe(0);
    expect(after.signatures, 'one Confirm commits exactly one signature').toBe(1);
    expect(after.placements, 'one placement').toBe(1);
    expect(after.pending, 'pending view unmounts').toBe(0);
  }, { label: 'release-1200-def236' });
});

test('DEF-237: re-opening a morphing menu mid-exit grows from the trigger rect', async () => {
  await withApp(async (win, ctx, app) => {
    await setSize(app, win, 1440, 900);
    await openReport(app, win);
    await installProbe(win);
    for (const m of MENUS) {
      const trig = await rectOf(win, m.trigger);
      await win.click(m.trigger);
      await win.waitForSelector(m.surface, { timeout: 5000 });
      await win.waitForTimeout(500);
      await win.keyboard.press('Escape');
      await win.waitForTimeout(80); // mid-exit
      await startProbe(win, m.surface, 700);
      await win.click(m.trigger);
      const rows = await readProbe(win);
      const inRows = rows.filter((r) => !r.gone && r.morph === 'in');
      expect(inRows.length, `${m.name}: a re-open 'in' frame was sampled`).toBeGreaterThan(0);
      const first = inRows[0];
      const dev = Math.max(
        Math.abs(first.x - trig.x), Math.abs(first.y - trig.y),
        Math.abs(first.w - trig.w), Math.abs(first.h - trig.h),
      );
      log(`def237-${m.name}`, { trigger: [trig.x, trig.y, trig.w, trig.h], firstIn: [first.x, first.y, first.w, first.h], deviationPx: +dev.toFixed(2) });
      expect(dev, `${m.name}: re-open first 'in' frame equals the trigger rect`).toBeLessThanOrEqual(2.5);
      await win.keyboard.press('Escape');
      await win.waitForTimeout(500);
    }
  }, { label: 'release-1200-def237' });
});

test('DEF-238: the exiting search bar is inert - focus leaves it and Tab cannot enter it', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    await win.keyboard.press('Control+f');
    await win.waitForSelector('.search-bar', { timeout: 6000 });
    await win.locator('.search-bar input').first().focus();
    await win.keyboard.type('AB');
    await installProbe(win);
    await startProbe(win, '.search-bar', 900);
    await win.keyboard.press('Escape');
    // Focus leaves the input once the exiting subtree becomes inert; give the
    // React commit a beat, then read (the bar is still mid-exit here).
    await win.waitForTimeout(120);
    const focusState = await win.evaluate(() => {
      const a = document.activeElement;
      return { tag: a?.tagName, inSearch: !!a?.closest('.search-bar') };
    });
    await win.keyboard.press('Tab');
    const tabState = await win.evaluate(() => {
      const a = document.activeElement;
      return { tag: a?.tagName, inSearch: !!a?.closest('.search-bar') };
    });
    const rows = await readProbe(win);
    const exiting = rows.filter((r) => !r.gone && r.op < 0.99);
    log('def238', {
      focusAfterEscape: focusState, tabAfterEscape: tabState,
      exitingFrames: exiting.length,
      inert: [...new Set(exiting.map((r) => r.inert))],
      pointerEvents: [...new Set(exiting.map((r) => r.pe))],
    });
    expect(exiting.length, 'search bar has an exit animation').toBeGreaterThan(0);
    expect([...new Set(exiting.map((r) => r.inert))], 'exit frames are inert (keyboard-safe)').toEqual([true]);
    expect([...new Set(exiting.map((r) => r.pe))], 'exit frames pin pointer-events:none').toEqual(['none']);
    expect(focusState.inSearch, 'focus leaves the exiting search bar').toBe(false);
    expect(tabState.inSearch, 'Tab cannot enter the exiting search bar').toBe(false);
    expect(rows.some((r) => r.gone), 'search bar unmounts after exit').toBe(true);
  }, { label: 'release-1200-def238' });
});

test('DEF-239: morph exit frames pin pointer-events:none on the FIRST exit frame', async () => {
  await withApp(async (win, ctx, app) => {
    await setSize(app, win, 1440, 900);
    await openReport(app, win);
    await installProbe(win);
    for (const m of MENUS) {
      await win.click(m.trigger);
      await win.waitForSelector(m.surface, { timeout: 5000 });
      await win.waitForTimeout(500);
      await startProbe(win, m.surface, 800);
      await win.keyboard.press('Escape');
      const rows = await readProbe(win);
      const outFrames = rows.filter((r) => !r.gone && r.morph === 'out');
      const peValues = [...new Set(outFrames.map((r) => r.pe))];
      log(`def239-${m.name}`, { outFrameCount: outFrames.length, firstOut: outFrames[0] ? { op: outFrames[0].op, pe: outFrames[0].pe } : null, outPeValues: peValues });
      expect(outFrames.length, `${m.name}: exit frames sampled`).toBeGreaterThan(0);
      expect(outFrames[0].pe, `${m.name}: FIRST exit frame pins pointer-events:none`).toBe('none');
      expect(peValues, `${m.name}: every exit frame pins pointer-events:none`).toEqual(['none']);
      await win.waitForTimeout(400);
    }
  }, { label: 'release-1200-def239' });
});

test('DEF-241: at 640x520 the text panel and Tools palette do not overlap; controls reachable', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    await openEditMode(win);
    await win.click('[data-edit-tool="box"]');
    await win.waitForSelector('.text-props-panel', { timeout: 6000 });
    await win.waitForTimeout(500);
    if ((await win.locator('[data-tools-palette]').count()) === 0) {
      await win.click('[data-tools-toggle]');
      await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
    }
    await win.waitForTimeout(500);
    await setSize(app, win, 640, 520);
    await win.waitForTimeout(900);
    const m = await win.evaluate(() => {
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: +r.left.toFixed(2), top: +r.top.toFixed(2), right: +r.right.toFixed(2), bottom: +r.bottom.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
      };
      const panel = document.querySelector('.text-props-panel');
      const palette = document.querySelector('[data-tools-palette]');
      const pr = rect(panel); const palr = rect(palette);
      const overlapX = pr && palr ? Math.max(0, Math.min(pr.right, palr.right) - Math.max(pr.left, palr.left)) : null;
      const probe = (el) => {
        if (!el) return { missing: true };
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { inPanel: hit ? !!hit.closest('.text-props-panel') : false, inPalette: hit ? !!hit.closest('[data-tools-palette]') : false, enabled: !el.disabled };
      };
      const panelControl = probe(document.querySelector('.text-props-panel [data-txt-bold]'));
      const entries = [...document.querySelectorAll('[data-tools-palette] .tools-palette-entry')].filter((e) => !e.disabled);
      const visible = entries.filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1;
      });
      let reachable = 0;
      for (const e of visible) {
        const r = e.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (hit && hit.closest('[data-tools-palette]')) reachable += 1;
      }
      return { vw: window.innerWidth, vh: window.innerHeight, panel: pr, palette: palr, overlapX, panelControl, paletteEntries: { visible: visible.length, reachable } };
    });
    log('def241', m);
    expect(m.vw, 'window at 640').toBe(640);
    expect(m.overlapX, 'panel and palette do not overlap at 640x520').toBe(0);
    expect(m.panelControl.enabled, 'panel bold control enabled in text mode').toBe(true);
    expect(m.panelControl.inPanel, 'panel control hit resolves inside the panel').toBe(true);
    expect(m.paletteEntries.visible, 'visible palette entries exist').toBeGreaterThan(0);
    expect(m.paletteEntries.reachable, 'every visible palette entry is reachable').toBe(m.paletteEntries.visible);
    await shot(win, 'release-1200-def241-640.png');
  }, { label: 'release-1200-def241' });
});

test('DEF-242: updateTextBox empty / all-unknown patch does not dirty the document', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    await createTextBox(win, 'DEF242-A', 0.22, 0.18);
    const docId = (await win.evaluate(() => window.tflexDiagnostics())).engineDocId;
    const id = await win.evaluate(() => {
      const b = ((window.tflexDiagnostics().engineState || {}).textBoxes) || [];
      return b.length ? b[b.length - 1].id : null;
    });
    const cleanPath = path.join(os.tmpdir(), `tflex-rel1200-def242-${Date.now()}.pdf`);
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, cleanPath);
    await win.click('[data-toolbar-save-as]');
    await win.waitForSelector('[data-save-as-confirm]', { timeout: 8000 });
    await win.click('[data-save-as-confirm]');
    await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 30000 }).catch(() => {});
    await win.waitForTimeout(500);

    const call = (patch) => win.evaluate(async (a) => {
      const r = await window.tflex.engine.updateTextBox(a.docId, a.id, a.patch);
      if (r && r.ok) return { ok: true, modified: r.value ? r.value.modified : null };
      return { ok: false, code: r && r.error ? r.error.code : null, message: r && r.error ? r.error.message : String(r) };
    }, { docId, id, patch });

    const empty = await call({});
    const evil = await call({ evil: 1, another: 'x' });
    const mixed = await call({ size: 20, evil: 1 });
    log('def242', { empty, evil, mixed });
    expect(empty.ok, 'empty patch ok').toBe(true);
    expect(empty.modified, 'empty patch leaves the clean document clean').toBe(false);
    expect(evil.ok, 'all-unknown patch fails loud').toBe(false);
    expect(mixed.ok, 'mixed patch (known + unknown) ok').toBe(true);
    expect(mixed.modified, 'mixed patch dirties the document').toBe(true);
  }, { label: 'release-1200-def242' });
});
