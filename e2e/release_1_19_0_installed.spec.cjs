// Release 1.19.0 - INSTALLED-app validation (qa), explicitly ordered by the
// orchestrator. Launches the NSIS-installed %LOCALAPPDATA%\Programs\tflex\TFlex.exe
// through the canonical launchApp() from e2e/lib/launch.cjs and verifies, on that
// installed build:
//
//   1. VERSION GATE - app.getVersion() === '1.19.0' (test 1, serial: a mismatch
//      aborts every remaining test).
//   2. PHASE 19 feature - group is the CommandBar's trailing capsule; exactly 5
//      [data-tool] in [data-ann-tools-visible]; [data-ann-color] left of
//      [data-ann-dropdown-toggle]; menu lists 11 tools in six groups; arming
//      callout from the menu promotes it first; MRU persists across an INSTALLED
//      app restart (annotationRecentTools read from the installed profile);
//      ink-only [data-pen-width]; disabled states with Edit open / Pan active.
//   3. DEF-214 guard - .ann-toolbar + [data-toolbar-edit-toggle] + arming mounts
//      .edit-toolbar; zero console/page errors.
//   4. Defect dispositions DEF-225/226/227/228/229/230/231 on the installed build.
//   5. Regression spot-check: watermark apply + delete-by-id (1.18.0 feature) and
//      the DEF-221 edit-text move (old rect clean, band above intact).
//
// Screenshots: release-1190-{group,menu,handle-640,toast}.png.
//
// Run: npm.cmd run test:e2e -- e2e/release_1_19_0_installed.spec.cjs
// The installed path can be overridden with TFLEX_PACKAGED_EXE.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, dismissUpdatePrompt, scrollToPage } = require('./lib/helpers.cjs');

const PACKAGED_EXE =
  process.env.TFLEX_PACKAGED_EXE ||
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'tflex', 'TFlex.exe');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const PNG = path.resolve(__dirname, '..', 'test-fixtures', 'red.png');
const INSTALLED_SETTINGS = path.join(process.env.APPDATA || '', 'tflex', 'settings.json');
const SETTINGS_BACKUP = `${INSTALLED_SETTINGS}.qa1190-backup`;

const CANON = ['select', 'highlight', 'underline', 'strikeout', 'ink', 'textbox', 'rect', 'ellipse', 'arrow', 'callout', 'note'];
const GROUP_LABELS = ['Select', 'Text markup', 'Pen', 'Text box', 'Shapes', 'Note'];

test.setTimeout(300000);
test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  // Restore the operator's installed-profile settings.json if we backed it up.
  try {
    if (fs.existsSync(SETTINGS_BACKUP)) {
      try { fs.chmodSync(INSTALLED_SETTINGS, 0o666); } catch (_) { /* ignore */ }
      fs.copyFileSync(SETTINGS_BACKUP, INSTALLED_SETTINGS);
      fs.rmSync(SETTINGS_BACKUP, { force: true });
      console.log('[release-1190] restored installed-profile settings.json from backup');
    }
  } catch (e) {
    console.log(`[release-1190] settings restore failed: ${e.message}`);
  }
});

async function withApp(fn, { userDataDir = null, label = 'release-1190' } = {}) {
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
  console.log(`[release-1190] shot ${name}`);
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

async function visibleIds(win) {
  return win.$$eval('[data-ann-tools-visible] [data-tool]', (els) => els.map((e) => e.getAttribute('data-tool')));
}

async function activeTool(win) {
  return win.evaluate(() => window.tflexDiagnostics().activeTool);
}

async function annCount(win) {
  return win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return d.engineState && d.engineState.annotations ? d.engineState.annotations.length : -1;
  });
}

async function openMenu(win) {
  await win.click('[data-ann-dropdown-toggle]');
  await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'visible', timeout: 8000 });
  await win.waitForTimeout(250);
}

async function armFromMenu(win, tool) {
  await openMenu(win);
  await win.click(`[data-ann-dropdown-menu] [data-tool="${tool}"]`);
  await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'detached', timeout: 8000 });
  await win.waitForTimeout(350);
}

async function pageBlankPoint(win, fracY) {
  return win.evaluate((fy) => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
    const page = pane && pane.querySelector('.pdf-page');
    if (!page) return null;
    const r = page.getBoundingClientRect();
    return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height * fy) };
  }, fracY);
}

async function setTheme(win, want) {
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${want}"]`);
  await win.waitForFunction((w) => document.documentElement.getAttribute('data-theme') === w, want, { timeout: 5000 });
  await win.waitForTimeout(350);
}

async function waitForToast(win, text, timeout = 12000) {
  await win.waitForFunction(
    (want) => Array.from(document.querySelectorAll('.toast .toast-text')).some((t) => (t.textContent || '').trim() === want),
    text,
    { timeout },
  );
}

// ---- watermark + edit helpers ---------------------------------------------

async function openWatermarkDialog(win) {
  const palette = win.locator('[data-tools-palette]');
  if (!(await palette.isVisible().catch(() => false))) {
    await win.locator('[data-tools-toggle]').first().click();
  }
  await palette.waitFor({ state: 'visible', timeout: 15000 });
  await win.locator('[data-tool-id="watermark"]').click();
  await win.locator('[data-watermark-dialog]').waitFor({ state: 'visible', timeout: 10000 });
  await win.waitForTimeout(400);
}

async function closeWatermarkDialog(win) {
  const dialog = win.locator('[data-watermark-dialog]');
  if (await dialog.isVisible().catch(() => false)) {
    const close = dialog.locator('.modal-close');
    if (await close.count()) await close.first().click().catch(() => {});
    await dialog.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    await win.waitForTimeout(300);
  }
}

async function armEditTool(win, tool) {
  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('.edit-toolbar', { timeout: 10000 });
  await win.waitForTimeout(300);
  if (tool && tool !== 'off') {
    await win.click(`[data-edit-tool="${tool}"]`);
    await win.waitForTimeout(400);
  }
}

async function scaleFor(win, pageNo) {
  return win.evaluate((pg) => {
    const c =
      document.querySelector(`.page-slot[data-page="${pg}"] canvas`) ||
      document.querySelector(`.pdf-page[data-page="${pg}"] canvas`);
    if (!c) return null;
    const cr = c.getBoundingClientRect();
    return { kx: c.width / cr.width, ky: c.height / cr.height, cx: cr.x, cy: cr.y };
  }, pageNo);
}

async function sigAtPx(win, px, pageNo) {
  return win.evaluate(({ r, pg }) => {
    const c =
      document.querySelector(`.page-slot[data-page="${pg}"] canvas`) ||
      document.querySelector(`.pdf-page[data-page="${pg}"] canvas`);
    if (!c) return { error: 'no-canvas' };
    if (c.width === 0 || c.height === 0) return { error: 'zero-canvas', w: c.width, h: c.height };
    const sx = Math.max(0, Math.round(r.x));
    const sy = Math.max(0, Math.round(r.y));
    const sw = Math.max(1, Math.min(c.width - sx, Math.round(r.w)));
    const sh = Math.max(1, Math.min(c.height - sy, Math.round(r.h)));
    if (sx >= c.width || sy >= c.height) return { error: 'oob', sx, sy };
    const d = c.getContext('2d').getImageData(sx, sy, sw, sh).data;
    let dark = 0, nearWhite = 0, total = 0, h = 2166136261 >>> 0;
    for (let i = 0; i < d.length; i += 4) {
      total += 1;
      const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      if (lum < 140) dark += 1;
      if (d[i] >= 245 && d[i + 1] >= 245 && d[i + 2] >= 245) nearWhite += 1;
      h = Math.imul(h ^ d[i], 16777619) >>> 0;
      h = Math.imul(h ^ d[i + 1], 16777619) >>> 0;
      h = Math.imul(h ^ d[i + 2], 16777619) >>> 0;
      h = Math.imul(h ^ d[i + 3], 16777619) >>> 0;
    }
    return { dark, nearWhite, total, hash: h >>> 0 };
  }, { r: px, pg: pageNo });
}

function bandAbove(scale, rect, gap = 6, height = 16) {
  return {
    x: rect.x,
    y: rect.y - Math.round((gap + height) * scale.ky),
    w: rect.w,
    h: Math.round(height * scale.ky),
  };
}

async function pickDenseRun(win, pg) {
  return win.evaluate((pageNo) => {
    const slot = document.querySelector(`.page-slot[data-page="${pageNo}"]`);
    if (!slot) return null;
    const c = slot.querySelector('canvas');
    if (!c || c.width === 0) return null;
    const cr = c.getBoundingClientRect();
    const kx = c.width / cr.width;
    const ky = c.height / cr.height;
    const ctx = c.getContext('2d');
    const darkIn = (x0, y0, x1, y1) => {
      const sx = Math.max(0, Math.round(x0));
      const sy = Math.max(0, Math.round(y0));
      const sw = Math.max(1, Math.min(c.width - sx, Math.round(x1 - x0)));
      const sh = Math.max(1, Math.min(c.height - sy, Math.round(y1 - y0)));
      const d = ctx.getImageData(sx, sy, sw, sh).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < 140) dark += 1;
      return dark;
    };
    let best = null;
    for (const s of slot.querySelectorAll('.textLayer span')) {
      const t = (s.textContent || '').trim();
      const r = s.getBoundingClientRect();
      if (t.length < 15 || r.width < 40 || r.height < 4) continue;
      if (r.y < 80 || r.y > window.innerHeight - 80) continue;
      const x0 = (r.x - cr.x) * kx;
      const x1 = (r.x + r.width - cr.x) * kx;
      const yTop = (r.y - cr.y) * ky;
      const yBot = (r.y + r.height - cr.y) * ky;
      const above = darkIn(x0, yTop - 16 * ky, x1, yTop - 2 * ky);
      const below = darkIn(x0, yBot + 2 * ky, x1, yBot + 16 * ky);
      const score = above + below;
      if (best === null || score > best.score) {
        best = {
          text: t,
          rect: { x: r.x, y: r.y, w: r.width, h: r.height },
          score,
          canvasPx: { x: Math.round(x0), y: Math.round(yTop), w: Math.max(1, Math.round(x1 - x0)), h: Math.max(1, Math.round(yBot - yTop)) },
        };
      }
    }
    return best;
  }, pg);
}

async function dragMouse(win, from, to, steps = 14) {
  await win.mouse.move(from.x, from.y);
  await win.mouse.down();
  await win.mouse.move(to.x, to.y, { steps });
  await win.mouse.up();
}

// ---- DEF-232 sibling-path helpers (text box / image on a target page) ------

async function pageRect(win, n) {
  return win.evaluate((pg) => {
    const page = document.querySelector(`.page-slot[data-page="${pg}"] .pdf-page`);
    const slot = document.querySelector(`.page-slot[data-page="${pg}"]`);
    const el = page || slot;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, n);
}

function domRectToCanvasPx(scale, r) {
  return {
    x: Math.round((r.x - scale.cx) * scale.kx),
    y: Math.round((r.y - scale.cy) * scale.ky),
    w: Math.round(r.w * scale.kx),
    h: Math.round(r.h * scale.ky),
  };
}

async function placeImageRect(win, scale, px) {
  const a = { x: scale.cx + px.x / scale.kx, y: scale.cy + px.y / scale.ky };
  const b = { x: scale.cx + (px.x + px.w) / scale.kx, y: scale.cy + (px.y + px.h) / scale.ky };
  const fcPromise = win.waitForEvent('filechooser');
  await dragMouse(win, a, b, 14);
  const fc = await fcPromise;
  await fc.setFiles(PNG);
  await win.waitForTimeout(2200);
  return px;
}

async function imagePlacementRect(win) {
  return win.evaluate(() => {
    const el = document.querySelector('.edit-image-placement');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

async function textBoxes(win) {
  return win.evaluate(() => {
    const d = window.tflexDiagnostics();
    const list = d.engineState && Array.isArray(d.engineState.textBoxes) ? d.engineState.textBoxes : [];
    return list.map((b) => ({ id: b.id, page: b.page, text: b.text, rect: b.rect }));
  });
}

async function pageSig(win, pg) {
  return win.evaluate((pageNo) => {
    const c =
      document.querySelector(`.page-slot[data-page="${pageNo}"] canvas`) ||
      document.querySelector(`.pdf-page[data-page="${pageNo}"] canvas`);
    if (!c || c.width === 0 || c.height === 0) return { error: 'no-canvas' };
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0, h = 2166136261 >>> 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114 < 140) dark += 1;
      h = Math.imul(h ^ d[i], 16777619) >>> 0;
      h = Math.imul(h ^ d[i + 1], 16777619) >>> 0;
      h = Math.imul(h ^ d[i + 2], 16777619) >>> 0;
      h = Math.imul(h ^ d[i + 3], 16777619) >>> 0;
    }
    return { dark, hash: h >>> 0, w: c.width, h: c.height };
  }, pg);
}

/** Non-white pixels inside a canvas-px rect, with their bounding box, so a
 *  boundary anti-aliasing sliver can be told apart from a real leftover. */
async function residueBox(win, px, pg) {
  return win.evaluate(({ r, pageNo }) => {
    const c =
      document.querySelector(`.page-slot[data-page="${pageNo}"] canvas`) ||
      document.querySelector(`.pdf-page[data-page="${pageNo}"] canvas`);
    if (!c) return { error: 'no-canvas' };
    const sx = Math.max(0, Math.round(r.x));
    const sy = Math.max(0, Math.round(r.y));
    const sw = Math.max(1, Math.min(c.width - sx, Math.round(r.w)));
    const sh = Math.max(1, Math.min(c.height - sy, Math.round(r.h)));
    const d = c.getContext('2d').getImageData(sx, sy, sw, sh).data;
    let count = 0, minX = sw, minY = sh, maxX = -1, maxY = -1;
    for (let y = 0; y < sh; y += 1) {
      for (let x = 0; x < sw; x += 1) {
        const i = (y * sw + x) * 4;
        const lum = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        if (lum < 245) {
          count += 1;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return {
      count, total: sw * sh, w: sw, h: sh,
      box: count ? { minX, minY, maxX, maxY, thickness: Math.min(maxX - minX + 1, maxY - minY + 1) } : null,
    };
  }, { r: px, pageNo: pg });
}

async function saveAsCloseReopen(app, win, tag) {
  const savePath = path.join(os.tmpdir(), `tflex-rel1190-${tag}-${Date.now()}.pdf`);
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(2800);
  const exists = fs.existsSync(savePath);
  console.log(`[release-1190|SAVED|${tag}] path=${savePath} exists=${exists} bytes=${exists ? fs.statSync(savePath).size : -1}`);

  await win.locator('.tab-close').first().click();
  await win.waitForTimeout(700);
  if (await win.locator('[data-close-prompt-action="discard"]').count()) {
    await win.locator('[data-close-prompt-action="discard"]').first().click();
    await win.waitForTimeout(900);
  }
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, savePath);
  const cmdOpen = win.locator('[aria-label="Open PDF document"]').first();
  if (await cmdOpen.isVisible().catch(() => false)) await cmdOpen.click();
  else await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(3000);
  return savePath;
}

// ---------------------------------------------------------------------------
// 1. VERSION GATE
// ---------------------------------------------------------------------------

test('VERSION GATE: installed build reports app.getVersion() 1.19.0', async () => {
  await withApp(async (win, ctx, app) => {
    const version = await app.evaluate(async ({ app }) => app.getVersion());
    console.log(`[release-1190] app.getVersion() = ${JSON.stringify(version)} (exe: ${PACKAGED_EXE})`);
    expect(version, 'installed build version').toBe('1.19.0');
  }, { label: 'release-1190-version' });
});

// ---------------------------------------------------------------------------
// 2. PHASE 19 feature on the installed build
// ---------------------------------------------------------------------------

test('PHASE 19: group capsule, 5 visible, swatch, 11-tool menu, MRU promotion, pen row, disabled states', async () => {
  await withApp(async (win, ctx, app) => {
    await setSize(app, win, 1440, 900);
    await openReport(app, win);
    ctx.consoleErrors.length = 0;
    ctx.pageErrors.length = 0;

    // Group is the CommandBar's trailing capsule.
    const geo = await win.evaluate(() => {
      const toolbar = document.querySelector('.workspace .toolbar');
      const group = document.querySelector('[data-annotation-toolbar]');
      const groups = Array.from(document.querySelectorAll('.toolbar > .toolbar-group'));
      const last = groups[groups.length - 1];
      const r = group.getBoundingClientRect();
      return {
        groupInsideToolbar: toolbar.contains(group),
        lastIsAnnotate: last === group,
        lastClass: last ? last.className : null,
        annToolbar: document.querySelectorAll('.ann-toolbar').length,
        groupBox: { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) },
        innerWidth: window.innerWidth,
      };
    });
    console.log(`[release-1190|group] ${JSON.stringify(geo)}`);
    expect(geo.groupInsideToolbar, 'group inside .toolbar').toBe(true);
    expect(geo.lastIsAnnotate, `group is the last capsule (last=${geo.lastClass})`).toBe(true);
    expect(geo.annToolbar, '.ann-toolbar hook present').toBeGreaterThanOrEqual(1);

    // Exactly five visible tool buttons.
    const ids = await visibleIds(win);
    console.log(`[release-1190|visible] ids=${JSON.stringify(ids)}`);
    expect(ids.length, 'exactly five visible tool buttons').toBe(5);
    expect(new Set(ids).size, 'no duplicate visible ids').toBe(5);

    // Colour swatch sits left of the dropdown arrow for a colour-capable tool.
    await win.click('[data-ann-tools-visible] [data-tool="highlight"]');
    await win.waitForSelector('[data-ann-color]', { state: 'visible', timeout: 5000 });
    const order = await win.evaluate(() => {
      const swatch = document.querySelector('[data-ann-color]');
      const toggle = document.querySelector('[data-ann-dropdown-toggle]');
      return {
        swatchBeforeToggle: (swatch.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        swatchX: Math.round(swatch.getBoundingClientRect().left),
        toggleX: Math.round(toggle.getBoundingClientRect().left),
      };
    });
    console.log(`[release-1190|swatch] ${JSON.stringify(order)}`);
    expect(order.swatchBeforeToggle, 'swatch precedes the arrow in DOM order').toBe(true);
    expect(order.swatchX, 'swatch sits left of the arrow').toBeLessThan(order.toggleX);
    await shot(win, 'release-1190-group.png', { x: 0, y: 0, width: 1440, height: 430 });
    await shot(win, 'release-1190b-group.png', { x: 0, y: 0, width: 1440, height: 430 });

    // Menu lists all 11 tools in six labelled groups.
    await openMenu(win);
    const menuIds = await win.$$eval('[data-ann-dropdown-menu] [data-tool]', (els) => els.map((e) => e.getAttribute('data-tool')));
    const menuLabels = await win.$$eval('[data-ann-dropdown-menu] [role="group"]', (els) => els.map((e) => e.getAttribute('aria-label')));
    console.log(`[release-1190|menu] ids=${JSON.stringify(menuIds)} groups=${JSON.stringify(menuLabels)}`);
    expect(menuIds.length, 'all eleven tools listed').toBe(11);
    expect(menuIds, 'menu order matches the canonical order').toEqual(CANON);
    expect(menuLabels, 'six labelled groups').toEqual(GROUP_LABELS);

    // Arm callout (menu-only) -> promoted to first.
    await win.click('[data-ann-dropdown-menu] [data-tool="callout"]');
    await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'detached', timeout: 8000 });
    await win.waitForTimeout(400);
    const after = await visibleIds(win);
    console.log(`[release-1190|mru] after callout=${JSON.stringify(after)} activeTool=${await activeTool(win)}`);
    expect(await activeTool(win), 'callout armed').toBe('callout');
    expect(after[0], 'armed menu-only tool is promoted to first').toBe('callout');
    expect(after.length).toBe(5);

    // Ink-only pen-width row inside the menu.
    await armFromMenu(win, 'ink');
    await openMenu(win);
    await win.waitForSelector('[data-pen-width-row]', { state: 'visible', timeout: 5000 });
    const pen = await win.$$eval('[data-pen-width]', (els) => els.map((e) => ({ w: e.getAttribute('data-pen-width'), pressed: e.getAttribute('aria-pressed') })));
    console.log(`[release-1190|pen] ${JSON.stringify(pen)}`);
    expect(pen.find((b) => b.w === '3')?.pressed, 'default ink width 3 is pressed').toBe('true');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    await win.click('[data-ann-tools-visible] [data-tool="highlight"]');
    await win.waitForTimeout(250);
    await openMenu(win);
    expect(await win.locator('[data-pen-width-row]').count(), 'no pen row for a non-ink tool').toBe(0);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    // Disabled states: Edit open (all but Select), Pan active (all).
    const read = () => win.$$eval('[data-ann-tools-visible] [data-tool]', (els) => els.map((e) => ({
      tool: e.getAttribute('data-tool'),
      disabled: e.disabled,
      title: e.getAttribute('title') || '',
    })));
    await win.click('[data-toolbar-edit-toggle]');
    await win.waitForSelector('.edit-toolbar', { state: 'attached', timeout: 10000 });
    await win.waitForTimeout(300);
    const edit = await read();
    console.log(`[release-1190|disabled-edit] ${JSON.stringify(edit)}`);
    for (const b of edit) {
      if (b.tool === 'select') expect(b.disabled, 'Select stays enabled in Edit mode').toBe(false);
      else {
        expect(b.disabled, `${b.tool} disabled in Edit mode`).toBe(true);
        expect(b.title, `${b.tool} Edit-mode tooltip`).toContain('Edit mode is open');
      }
    }
    await win.click('[data-toolbar-edit-toggle]');
    await win.waitForTimeout(400);
    await win.click('[data-hand-toggle]');
    await win.waitForTimeout(400);
    const pan = await read();
    console.log(`[release-1190|disabled-pan] ${JSON.stringify(pan)}`);
    for (const b of pan) {
      expect(b.disabled, `${b.tool} disabled while Pan is active`).toBe(true);
      expect(b.title, `${b.tool} Pan-mode tooltip`).toContain('Pan mode is on');
    }
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    expect(ctx.consoleErrors, 'zero renderer console errors').toEqual([]);
    expect(ctx.pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, { label: 'release-1190-feature' });
});

// ---------------------------------------------------------------------------
// 3. DEF-214 guard + watermark regression (1.18.0 feature)
// ---------------------------------------------------------------------------

test('DEF-214 guard + watermark apply/delete-by-id regression on the installed build', async () => {
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
    console.log(`[release-1190|def214] ann=${JSON.stringify(annBox)} edit=${JSON.stringify(editBox)} consoleErr=${ctx.consoleErrors.length} pageErr=${ctx.pageErrors.length}`);
    expect(ctx.consoleErrors, 'zero renderer console errors after open').toEqual([]);
    expect(ctx.pageErrors, 'zero uncaught renderer page errors after open').toEqual([]);
    await editToggle.click();
    await win.waitForTimeout(400);

    await openWatermarkDialog(win);
    await win.locator('[data-watermark-text]').fill('CONFIDENTIAL');
    await win.locator('[data-watermark-confirm]').click();
    await waitForToast(win, 'Watermark applied.');
    console.log('[release-1190] exact toast observed: "Watermark applied."');

    await openWatermarkDialog(win);
    const row = win.locator('[data-watermark-applied="wm-1"]');
    await row.waitFor({ state: 'visible', timeout: 15000 });
    await win.locator('[data-watermark-delete="wm-1"]').click();
    await waitForToast(win, 'Watermark deleted.');
    await row.waitFor({ state: 'detached', timeout: 15000 });
    console.log('[release-1190] exact toast observed: "Watermark deleted."; row detached');

    const engine = await win.evaluate(async () => {
      const id = window.tflexDiagnostics().engineDocId;
      const g = await window.tflex.engine.getWatermarks(id);
      return g.ok ? g.value.map((w) => w.id) : { err: g.error };
    });
    console.log(`[release-1190] engine watermarks after delete: ${JSON.stringify(engine)}`);
    expect(Array.isArray(engine), 'getWatermarks ok').toBe(true);
    expect(engine).not.toContain('wm-1');
    await closeWatermarkDialog(win);
  }, { label: 'release-1190-def214' });
});

// ---------------------------------------------------------------------------
// 4. DEF-225 - dropdown anchoring on the installed build
// ---------------------------------------------------------------------------

test('DEF-225: menu opens right-aligned under its arrow, inside the viewport', async () => {
  await withApp(async (win, ctx, app) => {
    await setSize(app, win, 1440, 900);
    await openReport(app, win);
    await openMenu(win);
    const measure = () => win.evaluate(() => {
      const m = document.querySelector('[data-ann-dropdown-menu]');
      const t = document.querySelector('[data-ann-dropdown-toggle]');
      const mr = m.getBoundingClientRect();
      const tr = t.getBoundingClientRect();
      return {
        menuLeft: Math.round(mr.left), menuRight: Math.round(mr.right), menuW: Math.round(mr.width),
        menuTop: Math.round(mr.top), menuBottom: Math.round(mr.bottom), menuH: Math.round(mr.height),
        toggleRight: Math.round(tr.right), toggleBottom: Math.round(tr.bottom),
        position: getComputedStyle(m).position, inlineLeft: m.style.left,
        innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      };
    });
    const a = await measure();
    console.log(`[release-1190|def225] ${JSON.stringify(a)}`);
    expect(a.position, '.ann-tool-menu position fixed').toBe('fixed');
    expect(a.menuRight, 'right edge aligns with the toggle right edge').toBeLessThanOrEqual(a.toggleRight + 4);
    expect(a.menuRight, 'right edge aligns with the toggle right edge').toBeGreaterThanOrEqual(a.toggleRight - 6);
    expect(a.menuTop, 'menu top is toggle bottom + ~6px').toBeGreaterThanOrEqual(a.toggleBottom + 3);
    expect(a.menuTop, 'menu top is toggle bottom + ~6px').toBeLessThanOrEqual(a.toggleBottom + 10);
    expect(a.menuLeft, 'menu not detached to the far-left edge').toBeGreaterThan(a.innerWidth / 2);
    expect(a.menuLeft).toBeGreaterThanOrEqual(0);
    expect(a.menuRight).toBeLessThanOrEqual(a.innerWidth);
    expect(a.menuBottom).toBeLessThanOrEqual(a.innerHeight);
    await shot(win, 'release-1190-menu.png');

    await setSize(app, win, 820, 700);
    await win.waitForTimeout(400);
    const b = await measure();
    console.log(`[release-1190|def225-narrow] ${JSON.stringify(b)}`);
    expect(b.menuLeft).toBeGreaterThanOrEqual(0);
    expect(b.menuRight).toBeLessThanOrEqual(b.innerWidth);
    expect(b.menuTop).toBeGreaterThanOrEqual(0);
    expect(b.menuBottom).toBeLessThanOrEqual(b.innerHeight);
  }, { label: 'release-1190-def225' });
});

// ---------------------------------------------------------------------------
// 5. DEF-226 - menu-only tools arm from the installed UI
// ---------------------------------------------------------------------------

test('DEF-226: menu-only tools (textbox, callout, note) arm from the installed UI', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    for (const tool of ['textbox', 'callout', 'note']) {
      await armFromMenu(win, tool);
      const armed = await activeTool(win);
      const ids = await visibleIds(win);
      console.log(`[release-1190|def226] tool=${tool} activeTool=${armed} visible=${JSON.stringify(ids)}`);
      expect(armed, `${tool} armed from the menu`).toBe(tool);
      expect(ids[0], `${tool} promoted to first`).toBe(tool);
    }
  }, { label: 'release-1190-def226' });
});

// ---------------------------------------------------------------------------
// 6. DEF-227 - dismiss click places nothing; the next click places
// ---------------------------------------------------------------------------

test('DEF-227: menu open + one page click places NOTHING; the next click places', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    await armFromMenu(win, 'note');
    expect(await activeTool(win)).toBe('note');

    // Dismissing click: menu open, single click on the page.
    await openMenu(win);
    const before = await annCount(win);
    const pt = await pageBlankPoint(win, 0.35);
    expect(pt, 'page blank point resolved').toBeTruthy();
    await win.mouse.click(pt.x, pt.y);
    await win.waitForTimeout(1200);
    const afterDismiss = {
      annotations: await annCount(win),
      noteEditorOpen: await win.locator('[data-annotation-editor="note"]').count(),
      menuOpen: await win.locator('[data-ann-dropdown-menu]').count(),
    };
    console.log(`[release-1190|def227-dismiss] before=${before} ${JSON.stringify(afterDismiss)}`);
    expect(afterDismiss.menuOpen, 'the dismiss click closes the menu').toBe(0);
    expect(afterDismiss.noteEditorOpen, 'the dismiss click places NOTHING (no note editor)').toBe(0);
    expect(afterDismiss.annotations, 'the dismiss click adds no annotation').toBe(before);

    // Next click places.
    await win.mouse.click(pt.x, pt.y);
    await win.waitForTimeout(800);
    const nextOpen = await win.locator('[data-annotation-editor="note"]').count();
    console.log(`[release-1190|def227-next] noteEditorOpen=${nextOpen}`);
    expect(nextOpen, 'the next click opens the note editor (placement)').toBeGreaterThan(0);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
  }, { label: 'release-1190-def227' });
});

// ---------------------------------------------------------------------------
// 7. DEF-228 - Tab-focused row + Enter/Space arms that row
// ---------------------------------------------------------------------------

test('DEF-228: Tab to a row + Enter/Space arms that row', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);

    // Enter path: focus row 2 (highlight).
    await openMenu(win);
    await win.keyboard.press('Tab'); // select
    await win.keyboard.press('Tab'); // highlight
    await win.waitForTimeout(120);
    const focused1 = await win.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-tool'));
    await win.keyboard.press('Enter');
    await win.waitForTimeout(600);
    const r1 = { focused: focused1, activeTool: await activeTool(win), menuOpen: await win.locator('[data-ann-dropdown-menu]').count() };
    console.log(`[release-1190|def228-enter] ${JSON.stringify(r1)}`);
    expect(r1.focused, 'Tab focus lands on the highlight row').toBe('highlight');
    expect(r1.activeTool, 'Enter arms the focused row').toBe('highlight');
    expect(r1.menuOpen).toBe(0);

    // Space path: focus row 3 (underline).
    await openMenu(win);
    await win.keyboard.press('Tab'); // select
    await win.keyboard.press('Tab'); // highlight
    await win.keyboard.press('Tab'); // underline
    await win.waitForTimeout(120);
    const focused2 = await win.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-tool'));
    await win.keyboard.press(' ');
    await win.waitForTimeout(600);
    const r2 = { focused: focused2, activeTool: await activeTool(win), menuOpen: await win.locator('[data-ann-dropdown-menu]').count() };
    console.log(`[release-1190|def228-space] ${JSON.stringify(r2)}`);
    expect(r2.focused, 'Tab focus lands on the underline row').toBe('underline');
    expect(r2.activeTool, 'Space arms the focused row').toBe('underline');
    expect(r2.menuOpen).toBe(0);
  }, { label: 'release-1190-def228' });
});

// ---------------------------------------------------------------------------
// 8. DEF-229 - 640x600: group reachable + clickable; titlebar usable
// ---------------------------------------------------------------------------

test('DEF-229: at 640x600 the group is reachable and clickable; titlebar stays usable', async () => {
  await withApp(async (win, ctx, app) => {
    await setSize(app, win, 640, 600);
    await openReport(app, win);

    const layout = await win.evaluate(() => {
      const g = document.querySelector('[data-annotation-toolbar]');
      const r = g.getBoundingClientRect();
      const top = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      return {
        innerWidth: window.innerWidth,
        group: { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width) },
        groupReachable: r.left >= 0 && r.right <= window.innerWidth && r.top >= 0,
        groupClipped: r.right > window.innerWidth,
        topAtCenterInGroup: !!(top && top.closest('[data-annotation-toolbar]')),
      };
    });
    console.log(`[release-1190|def229-640] ${JSON.stringify(layout)}`);
    expect(layout.innerWidth).toBe(640);
    expect(layout.groupReachable, 'group fully inside the 640px viewport').toBe(true);
    expect(layout.groupClipped, 'group must not be clipped').toBe(false);
    expect(layout.topAtCenterInGroup, 'elementFromPoint at the group centre hits the group').toBe(true);

    await win.click('[data-ann-tools-visible] [data-tool="highlight"]');
    await win.waitForTimeout(400);
    const armed = await activeTool(win);
    console.log(`[release-1190|def229-click] activeTool=${armed}`);
    expect(armed, 'clicking the visible Highlight button at 640 arms it').toBe('highlight');

    await win.click('[data-ann-dropdown-toggle]');
    await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'visible', timeout: 8000 });
    await win.waitForTimeout(300);
    const menu = await win.evaluate(() => {
      const m = document.querySelector('[data-ann-dropdown-menu]');
      const r = m.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), innerWidth: window.innerWidth, innerHeight: window.innerHeight };
    });
    console.log(`[release-1190|def229-menu] ${JSON.stringify(menu)}`);
    expect(menu.left).toBeGreaterThanOrEqual(0);
    expect(menu.right).toBeLessThanOrEqual(menu.innerWidth);
    expect(menu.top).toBeGreaterThanOrEqual(0);
    expect(menu.bottom).toBeLessThanOrEqual(menu.innerHeight);
    await shot(win, 'release-1190-handle-640.png');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    const title = await win.evaluate(() => {
      const bar = document.querySelector('.titlebar');
      const brand = document.querySelector('.brand');
      const r = bar.getBoundingClientRect();
      const br = brand.getBoundingClientRect();
      const ctrls = Array.from(document.querySelectorAll('[data-titlebar-controls] button'));
      return {
        innerWidth: window.innerWidth,
        bar: { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) },
        brand: { right: Math.round(br.right) },
        controls: ctrls.map((b) => {
          const rr = b.getBoundingClientRect();
          const top = document.elementFromPoint(Math.round(rr.left + rr.width / 2), Math.round(rr.top + rr.height / 2));
          return {
            label: b.getAttribute('aria-label'),
            insideViewport: rr.left >= 0 && rr.right <= window.innerWidth,
            hitsSelf: top === b || (top && b.contains(top)),
          };
        }),
      };
    });
    console.log(`[release-1190|def229-titlebar] ${JSON.stringify(title)}`);
    expect(title.bar.right, 'titlebar spans the viewport at 640').toBeLessThanOrEqual(title.innerWidth);
    expect(title.brand.right, 'brand inside the viewport at 640').toBeLessThanOrEqual(title.innerWidth);
    for (const c of title.controls) {
      expect(c.insideViewport, `${c.label} inside viewport`).toBe(true);
      expect(c.hitsSelf, `${c.label} reachable via elementFromPoint`).toBe(true);
    }
  }, { label: 'release-1190-def229' });
});

// ---------------------------------------------------------------------------
// 9. DEF-231 - frosted menu blur matches the colour popover
// ---------------------------------------------------------------------------

test('DEF-231: frosted menu backdrop blur matches the colour popover', async () => {
  await withApp(async (win, ctx, app) => {
    await setSize(app, win, 1440, 900);
    await openReport(app, win);
    await setTheme(win, 'frosted');

    await armFromMenu(win, 'callout'); // colour-capable -> swatch present
    await openMenu(win);
    await win.evaluate(() => document.querySelector('[data-ann-color]').click());
    await win.waitForSelector('.color-popover', { state: 'visible', timeout: 6000 });
    await win.waitForTimeout(400);
    const blur = await win.evaluate(() => {
      const m = document.querySelector('[data-ann-dropdown-menu]');
      const p = document.querySelector('.color-popover');
      const gm = m ? (getComputedStyle(m).backdropFilter || getComputedStyle(m).webkitBackdropFilter) : null;
      const gp = p ? (getComputedStyle(p).backdropFilter || getComputedStyle(p).webkitBackdropFilter) : null;
      return { theme: document.documentElement.getAttribute('data-theme'), menuBackdrop: gm, popBackdrop: gp, menuOpen: !!m, popoverOpen: !!p };
    });
    console.log(`[release-1190|def231] ${JSON.stringify(blur)}`);
    expect(blur.theme, 'frosted theme active').toBe('frosted');
    expect(blur.menuOpen && blur.popoverOpen, 'menu + colour popover both open').toBe(true);
    expect(blur.menuBackdrop, 'menu backdrop is not none').not.toBe('none');
    expect(blur.menuBackdrop, 'menu backdrop matches the colour popover').toBe(blur.popBackdrop);
  }, { label: 'release-1190-def231' });
});

// ---------------------------------------------------------------------------
// 10. Regression - DEF-221 edit-text move on the installed build
// ---------------------------------------------------------------------------

test('REGRESSION DEF-221: dense text-run move +150/+120 leaves the old rect clean and the band above intact', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    await scrollToPage(win, 2);
    await win.waitForTimeout(700);
    await armEditTool(win, 'text');

    const dense = await pickDenseRun(win, 2);
    expect(dense, 'a dense paragraph run must exist on page 2').toBeTruthy();
    const scale = await scaleFor(win, 2);
    const runPx = dense.canvasPx;
    const abovePx = bandAbove(scale, runPx);
    const movedPx = { x: runPx.x + Math.round(150 * scale.kx), y: runPx.y + Math.round(120 * scale.ky), w: runPx.w, h: runPx.h };
    console.log(`[release-1190|def221] run="${dense.text}" px=${JSON.stringify(runPx)} movedPx=${JSON.stringify(movedPx)}`);
    const beforeRun = await sigAtPx(win, runPx, 2);
    const beforeAbove = await sigAtPx(win, abovePx, 2);
    const beforeMoved = await sigAtPx(win, movedPx, 2);
    console.log(`[release-1190|def221|BEFORE] oldRectDark=${beforeRun.dark} aboveDark=${beforeAbove.dark} aboveHash=${beforeAbove.hash} movedDark=${beforeMoved.dark}`);

    const cx = dense.rect.x + dense.rect.w / 2;
    const cy = dense.rect.y + dense.rect.h / 2;
    await win.mouse.dblclick(cx, cy);
    await win.waitForTimeout(700);
    if (!(await win.locator('.edit-inline-editor').count())) {
      await win.mouse.click(cx, cy);
      await win.waitForTimeout(300);
      const editBtn = win.locator('[aria-label="Edit text run"]').first();
      if (await editBtn.count()) { await editBtn.click(); await win.waitForTimeout(700); }
    }
    expect(await win.locator('.edit-inline-editor').count(), 'inline editor opens').toBeGreaterThan(0);

    const handle = await win.evaluate(() => {
      const h = document.querySelector('.edit-inline-editor [data-edit-drag-handle]');
      if (!h) return null;
      const r = h.getBoundingClientRect();
      return { x: r.x, y: r.y };
    });
    expect(handle, 'drag handle exists').toBeTruthy();
    await dragMouse(win, { x: handle.x + 5, y: handle.y + 5 }, { x: handle.x + 5 + 150, y: handle.y + 5 + 120 }, 14);
    await win.waitForTimeout(400);
    const confirmAttr = await win.evaluate(() => {
      const b = document.querySelector('.edit-inline-editor [data-edit-confirm]');
      return b ? b.getAttribute('data-edit-confirm') : null;
    });
    console.log(`[release-1190|def221] data-edit-confirm=${confirmAttr}`);
    expect(confirmAttr, 'data-edit-confirm flips true after +150/+120').toBe('true');
    await win.locator('.edit-inline-editor [data-edit-confirm="true"]').first().click();
    // The engine commit + doc-proxy refresh is async; poll until the old rect
    // reflects the baked mask (or the timeout) before measuring.
    let afterRun = null;
    for (let i = 0; i < 30; i += 1) {
      await win.waitForTimeout(400);
      afterRun = await sigAtPx(win, runPx, 2);
      if (afterRun && afterRun.dark === 0) break;
    }
    const editorAfter = await win.locator('.edit-inline-editor').count();
    const afterAbove = await sigAtPx(win, abovePx, 2);
    const afterMoved = await sigAtPx(win, movedPx, 2);
    const diag = await win.evaluate(() => {
      const d = window.tflexDiagnostics();
      return {
        activeTool: d.activeTool,
        modified: d.modified,
        toasts: Array.from(document.querySelectorAll('.toast .toast-text')).map((t) => (t.textContent || '').trim()),
      };
    });
    console.log(`[release-1190|def221|AFTER] editorAfterConfirm=${editorAfter} oldRectDark=${afterRun.dark} aboveDark=${afterAbove.dark} aboveHash=${afterAbove.hash} movedDark=${afterMoved.dark} diag=${JSON.stringify(diag)}`);
    const pr2 = await pageRect(win, 2);
    if (pr2) {
      await shot(win, 'release-1190b-dense-move.png', {
        x: Math.max(0, Math.round(pr2.x)),
        y: Math.max(0, Math.round(pr2.y)),
        width: Math.min(Math.round(pr2.w), 1440),
        height: Math.min(Math.round(pr2.h), 900),
      });
    }

    await saveAsCloseReopen(app, win, 'def221');
    await scrollToPage(win, 2);
    await win.waitForTimeout(1000);
    const reRun = await sigAtPx(win, runPx, 2);
    const reMoved = await sigAtPx(win, movedPx, 2);
    const reAbove = await sigAtPx(win, abovePx, 2);
    console.log(`[release-1190|def221|REOPEN] oldRectDark=${reRun.dark} movedDark=${reMoved.dark} movedHash=${reMoved.hash} aboveDark=${reAbove.dark} aboveHash=${reAbove.hash}`);

    expect(afterRun.dark, 'old rect must be clean (dark 0) after Confirm (live)').toBe(0);
    expect(afterAbove.hash, 'band above must be byte-identical after Confirm').toBe(beforeAbove.hash);
    expect(reRun.dark, 'DEF-232: old rect stays clean (dark 0) in the saved+reopened file').toBe(0);
    expect(reAbove.hash, 'DEF-232: band above byte-identical after save+reopen').toBe(beforeAbove.hash);
    expect(reMoved.dark, 'DEF-232: the moved run is present at the NEW rect after save+reopen').toBeGreaterThan(beforeMoved.dark);
  }, { label: 'release-1190-def221' });
});

// ---------------------------------------------------------------------------
// 10b. DEF-232 SIBLING - text box committed on page 2 targets page 2
// ---------------------------------------------------------------------------

test('DEF-232 SIBLING: text box committed on page 2 targets page 2 (stale readout)', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    const boxPx = { x: 200, y: 360, w: 340, h: 150 };

    // Page-1 baseline for the same canvas-px rect: the box must NOT land there.
    await scrollToPage(win, 1);
    await win.waitForTimeout(900);
    const p1Before = await sigAtPx(win, boxPx, 1);
    console.log(`[release-1190|textbox|PAGE1-BEFORE] hash=${p1Before.hash} dark=${p1Before.dark} err=${p1Before.error || 'none'}`);

    await scrollToPage(win, 2);
    await win.waitForTimeout(900);
    const readout = await win.evaluate(() => window.tflexDiagnostics().currentPage);
    console.log(`[release-1190|textbox] currentPage readout at placement=${readout} (stale 1 expected)`);

    const scale = await scaleFor(win, 2);
    expect(scale, 'page 2 canvas resolvable').toBeTruthy();
    await armEditTool(win, 'box');
    const start = { x: scale.cx + boxPx.x / scale.kx, y: scale.cy + boxPx.y / scale.ky };
    const end = { x: scale.cx + (boxPx.x + boxPx.w) / scale.kx, y: scale.cy + (boxPx.y + boxPx.h) / scale.ky };
    await dragMouse(win, start, end, 14);
    await win.waitForSelector('.edit-inline-editor [data-edit-textarea]', { timeout: 12000 });
    await win.fill('.edit-inline-editor [data-edit-textarea]', 'PAGE2 BOX');
    await win.waitForTimeout(300);
    await win.locator('[aria-label="Apply edit"], [aria-label="Confirm move"]').first().click();

    let live = [];
    for (let i = 0; i < 40; i += 1) {
      await win.waitForTimeout(400);
      live = await textBoxes(win);
      if (live.length > 0) break;
    }
    console.log(`[release-1190|textbox|LIVE] boxes=${JSON.stringify(live)}`);
    expect(live.length, 'text box registered after Apply').toBeGreaterThan(0);

    const prShot = await pageRect(win, 2);
    if (prShot) {
      await shot(win, 'release-1190b-textbox.png', {
        x: Math.max(0, Math.round(prShot.x)), y: Math.max(0, Math.round(prShot.y)),
        width: Math.min(Math.round(prShot.w), 1440), height: Math.min(Math.round(prShot.h), 900),
      });
    }

    await saveAsCloseReopen(app, win, 'textbox');
    await scrollToPage(win, 2);
    await win.waitForTimeout(1200);
    const reopened = await textBoxes(win);
    const box = reopened.find((b) => b.text === 'PAGE2 BOX');
    console.log(`[release-1190|textbox|REOPEN] boxes=${JSON.stringify(reopened)}`);
    expect(box, 'the text box survives save+reopen').toBeTruthy();
    expect(box.page, 'the box is on page 2 in the saved+reopened file').toBe(2);

    await scrollToPage(win, 1);
    await win.waitForTimeout(1200);
    const p1After = await sigAtPx(win, boxPx, 1);
    console.log(`[release-1190|textbox|PAGE1-AFTER] hash=${p1After.hash} dark=${p1After.dark}`);
    expect(p1After.hash, 'page 1 is byte-identical (the box did not land there)').toBe(p1Before.hash);
  }, { label: 'release-1190-textbox' });
});

// ---------------------------------------------------------------------------
// 10c. DEF-232 SIBLING - image placement move on page 2 targets page 2
// ---------------------------------------------------------------------------

test('DEF-232 SIBLING: image placement move on page 2 targets page 2 (stale readout)', async () => {
  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    const imgPx = { x: 170, y: 400, w: 220, h: 80 };
    const dxCanvas = 300, dyCanvas = 140;
    const predictedNew = { x: imgPx.x + dxCanvas, y: imgPx.y + dyCanvas, w: imgPx.w, h: imgPx.h };

    // Whole-page-1 baseline: if the op targets page 1 the entire page changes.
    await scrollToPage(win, 1);
    await win.waitForTimeout(900);
    const p1Before = await pageSig(win, 1);
    console.log(`[release-1190|image|PAGE1-BEFORE] hash=${p1Before.hash} dark=${p1Before.dark} wh=${p1Before.w}x${p1Before.h}`);

    await scrollToPage(win, 2);
    await win.waitForTimeout(900);
    const readout = await win.evaluate(() => window.tflexDiagnostics().currentPage);
    console.log(`[release-1190|image] currentPage readout at placement=${readout} (stale 1 expected)`);

    const scale = await scaleFor(win, 2);
    expect(scale, 'page 2 canvas resolvable').toBeTruthy();
    await armEditTool(win, 'image');
    await placeImageRect(win, scale, imgPx);
    const beforeOld = await sigAtPx(win, imgPx, 2);
    const beforeNew = await sigAtPx(win, predictedNew, 2);
    console.log(`[release-1190|image|BEFORE] oldDark=${beforeOld.dark} newDark=${beforeNew.dark} newHash=${beforeNew.hash}`);
    expect(beforeOld.dark, 'the placed image is on page 2').toBeGreaterThan(0);

    const ir = await imagePlacementRect(win);
    expect(ir, 'committed .edit-image-placement exists').toBeTruthy();
    const oldPxActual = domRectToCanvasPx(scale, ir);
    const cssDx = dxCanvas / scale.kx;
    const cssDy = dyCanvas / scale.ky;
    await dragMouse(win, { x: ir.x + ir.w / 2, y: ir.y + ir.h / 2 }, { x: ir.x + ir.w / 2 + cssDx, y: ir.y + ir.h / 2 + cssDy }, 14);
    await win.waitForTimeout(1400);
    const irAfter = await imagePlacementRect(win);
    const newPxActual = domRectToCanvasPx(scale, irAfter);
    const disjoint = newPxActual.x >= oldPxActual.x + oldPxActual.w || newPxActual.y >= oldPxActual.y + oldPxActual.h;
    console.log(`[release-1190|image|MOVE] old=${JSON.stringify(oldPxActual)} new=${JSON.stringify(newPxActual)} requested=${dxCanvas}/${dyCanvas} disjoint=${disjoint}`);
    expect(disjoint, 'test geometry: old and new image rects do not overlap').toBe(true);

    await saveAsCloseReopen(app, win, 'image');
    await scrollToPage(win, 2);
    await win.waitForTimeout(1200);
    const reOld = await sigAtPx(win, oldPxActual, 2);
    const reResidue = await residueBox(win, oldPxActual, 2);
    const reNew = await sigAtPx(win, newPxActual, 2);
    console.log(`[release-1190|image|REOPEN] oldDark=${reOld.dark} oldNearWhite=${reOld.nearWhite}/${reOld.total} residue=${JSON.stringify(reResidue)} newDark=${reNew.dark} newHash=${reNew.hash}`);
    const prShot = await pageRect(win, 2);
    if (prShot) {
      await shot(win, 'release-1190b-image.png', {
        x: Math.max(0, Math.round(prShot.x)), y: Math.max(0, Math.round(prShot.y)),
        width: Math.min(Math.round(prShot.w), 1440), height: Math.min(Math.round(prShot.h), 900),
      });
    }
    expect(reOld.dark, 'old rect holds no image after save+reopen (sub-2% boundary AA residue only)').toBeLessThan(Math.round(reOld.total * 0.02));
    expect(reOld.nearWhite, 'old rect essentially white after reopen (mask covers the old image)').toBeGreaterThan(Math.round(reOld.total * 0.98));
    expect(reNew.dark, 'the image is present at the NEW rect on page 2 after save+reopen').toBeGreaterThan(0);
    expect(reNew.hash, 'the NEW rect content changed from the pre-move baseline').not.toBe(beforeNew.hash);

    await scrollToPage(win, 1);
    await win.waitForTimeout(1200);
    const p1After = await pageSig(win, 1);
    console.log(`[release-1190|image|PAGE1-AFTER] hash=${p1After.hash} dark=${p1After.dark}`);
    expect(p1After.hash, 'page 1 is byte-identical (the image move did not touch it)').toBe(p1Before.hash);
  }, { label: 'release-1190-image' });
});

// ---------------------------------------------------------------------------
// 11. MRU persistence across an INSTALLED app restart (installed profile)
// ---------------------------------------------------------------------------

test('MRU persists across a restart of the INSTALLED app (installed profile settings.json)', async () => {
  test.setTimeout(360000);
  if (fs.existsSync(INSTALLED_SETTINGS) && !fs.existsSync(SETTINGS_BACKUP)) {
    fs.copyFileSync(INSTALLED_SETTINGS, SETTINGS_BACKUP);
  }

  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    await armFromMenu(win, 'callout');
    const ids1 = await visibleIds(win);
    console.log(`[release-1190|mru|s1] visible=${JSON.stringify(ids1)}`);
    expect(ids1[0], 'callout first in session 1').toBe('callout');

    let persisted = null;
    for (let i = 0; i < 24; i += 1) {
      try {
        const j = JSON.parse(fs.readFileSync(INSTALLED_SETTINGS, 'utf8'));
        if (Array.isArray(j.annotationRecentTools) && j.annotationRecentTools[0] === 'callout') {
          persisted = j.annotationRecentTools;
          break;
        }
      } catch { /* not written yet */ }
      await win.waitForTimeout(250);
    }
    console.log(`[release-1190|mru] settings.json annotationRecentTools=${JSON.stringify(persisted)}`);
    expect(persisted, 'installed-profile settings.json must contain annotationRecentTools with callout first').not.toBeNull();
  }, { userDataDir: 'default', label: 'release-1190-mru-1' });

  await withApp(async (win, ctx, app) => {
    await openReport(app, win);
    const ids2 = await visibleIds(win);
    console.log(`[release-1190|mru|s2] visible=${JSON.stringify(ids2)}`);
    expect(ids2[0], 'the persisted MRU tool shows first after an INSTALLED app restart').toBe('callout');
  }, { userDataDir: 'default', label: 'release-1190-mru-2' });
});

// ---------------------------------------------------------------------------
// 12. DEF-230 - read-only installed settings.json: no unhandled rejections,
//     rollback, "Settings could not be saved" error toast.
// ---------------------------------------------------------------------------

test('DEF-230: read-only installed settings.json -> no unhandled rejections, rollback, error toast', async () => {
  test.setTimeout(360000);
  if (fs.existsSync(INSTALLED_SETTINGS) && !fs.existsSync(SETTINGS_BACKUP)) {
    fs.copyFileSync(INSTALLED_SETTINGS, SETTINGS_BACKUP);
  }
  expect(fs.existsSync(INSTALLED_SETTINGS), 'installed-profile settings.json exists').toBe(true);
  fs.chmodSync(INSTALLED_SETTINGS, 0o444);
  try {
    await withApp(async (win, ctx, app) => {
      await openReport(app, win);
      const beforeBytes = fs.readFileSync(INSTALLED_SETTINGS);

      // Arm Highlight (a colour tool, visible by default). Its MRU promotion
      // triggers a settings write that must fail on the read-only file.
      const highlightedVisible = await win.locator('[data-ann-tools-visible] [data-tool="highlight"]').count();
      if (highlightedVisible > 0) {
        await win.click('[data-ann-tools-visible] [data-tool="highlight"]');
      } else {
        await armFromMenu(win, 'highlight');
      }

      await win.waitForFunction(
        () => Array.from(document.querySelectorAll('.toast .toast-text')).some((t) => (t.textContent || '').trim().startsWith('Settings could not be saved')),
        null,
        { timeout: 15000 },
      );
      const toastText = await win.evaluate(() => {
        const t = Array.from(document.querySelectorAll('.toast .toast-text')).find((x) => (x.textContent || '').trim().startsWith('Settings could not be saved'));
        return t ? t.textContent.trim() : null;
      });
      await shot(win, 'release-1190-toast.png');
      const unhandled = await win.evaluate(() => window.__unhandled || []);
      console.log(`[release-1190|def230] toast="${toastText}"`);
      console.log(`[release-1190|def230] unhandled=${JSON.stringify(unhandled)} pageErrors=${JSON.stringify(ctx.pageErrors.slice(0, 3))}`);

      expect(toastText, 'the "Settings could not be saved" error toast appears').toContain('Settings could not be saved');
      expect(unhandled, 'no unhandled rejections').toEqual([]);

      const afterBytes = fs.readFileSync(INSTALLED_SETTINGS);
      expect(afterBytes.equals(beforeBytes), 'the read-only settings.json is unchanged by the failed write').toBe(true);

      // Rollback: re-loading the settings service must not surface the failed
      // promotion (persisted state retained).
      const loaded = await win.evaluate(async () => {
        const r = await window.tflex.loadSettings();
        return r && r.ok ? r.value : { error: r };
      });
      const recent = loaded && Array.isArray(loaded.annotationRecentTools) ? loaded.annotationRecentTools : [];
      console.log(`[release-1190|def230] rolledBack annotationRecentTools=${JSON.stringify(recent)}`);
      expect(recent[0] === 'highlight', 'the failed promotion did not survive (state rolls back)').toBe(false);
    }, { userDataDir: 'default', label: 'release-1190-def230' });
  } finally {
    try { fs.chmodSync(INSTALLED_SETTINGS, 0o666); } catch (_) { /* ignore */ }
  }
});
