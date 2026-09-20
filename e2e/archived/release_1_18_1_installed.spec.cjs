// Release 1.18.1 - INSTALLED-app validation (qa), explicitly ordered by the
// orchestrator. Launches the NSIS-installed %LOCALAPPDATA%\Programs\tflex\TFlex.exe
// through the canonical launchApp() from e2e/lib/launch.cjs and verifies, on that
// installed build:
//
//   1. VERSION GATE - app.getVersion() === '1.18.1' (test 1, serial: a mismatch
//      aborts every remaining test).
//   2. DEF-214 guard - open report.pdf -> .ann-toolbar visible,
//      [data-toolbar-edit-toggle] present, arming it mounts .edit-toolbar,
//      zero renderer console/page errors.
//   3. Watermark regression - apply CONFIDENTIAL (exact "Watermark applied."
//      toast) -> applied row -> delete (exact "Watermark deleted.", row gone).
//   4. DEF-221/222 - dense page text-run move +150/+120: OLD rect dark 0, band
//      ABOVE byte-identical (hash equal); MutationObserver over .thumb-canvas
//      during Confirm = 0 width=0 / 0 height=0 mutations.
//   5. DEF-223 - image placement move commits: save/reopen has the image at the
//      NEW rect and the old rect fully white.
//   6. DEF-224 (NEW, filed) - the SE resize handle is fully hittable:
//      elementFromPoint at the OUTER corner quadrant returns .edit-image-handle-se,
//      and a drag from that quadrant commits the resize.
//
// Screenshots: release-1181-{toolbars,edit-text-move,image-move,handle}.png.
//
// Run: npm.cmd run test:e2e -- e2e/release_1_18_1_installed.spec.cjs
// The installed path can be overridden with TFLEX_PACKAGED_EXE (used for the
// pre-install version gate against release\win-unpacked\TFlex.exe).

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, scrollToPage, dismissUpdatePrompt } = require('./lib/helpers.cjs');

const PACKAGED_EXE =
  process.env.TFLEX_PACKAGED_EXE ||
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'tflex', 'TFlex.exe');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const PNG = path.resolve(__dirname, '..', 'test-fixtures', 'red.png');

test.setTimeout(300000);
test.describe.configure({ mode: 'serial' });

async function withApp(fn) {
  const electronApp = await launchApp([], null, PACKAGED_EXE);
  const win = await electronApp.firstWindow();
  const consoleErrors = [];
  const pageErrors = [];
  win.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
  });
  win.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  await win.waitForSelector('.sample-card', { timeout: 40000 });
  await dismissUpdatePrompt(win);
  try {
    return await fn(win, { consoleErrors, pageErrors }, electronApp);
  } finally {
    await hardClose(electronApp, 'release-1181');
  }
}

async function shot(win, name, clip) {
  const p = path.join(SHOTS, name);
  await win.screenshot(clip ? { path: p, clip } : { path: p });
  console.log(`[release-1181] shot ${name}`);
  return p;
}

async function openReportSample(win) {
  await win.locator('.sample-card:has-text("report.pdf")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1600);
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

// ---- pixel / geometry probes ----------------------------------------------

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

// Dark-pixel count + byte hash over a fixed CANVAS-pixel rect.
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

// Pick the on-screen page-`pg` run with the densest text bands above+below it.
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

// ---- thumbnail flash probe (DEF-222) --------------------------------------

async function aroundFlash(win, trigger, ms = 3000, pg = 2) {
  await win.evaluate(({ dur, pageNo }) => {
    window.__flash = { muts: [], nodes: 0, pg: pageNo };
    const start = performance.now();
    const nodes = Array.from(document.querySelectorAll('.thumb-canvas'));
    window.__flash.nodes = nodes.length;
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        window.__flash.muts.push({ t: Math.round(performance.now() - start), idx: nodes.indexOf(m.target), attr: m.attributeName, val: m.target.getAttribute(m.attributeName) });
      }
    });
    nodes.forEach((n) => obs.observe(n, { attributes: true, attributeFilter: ['width', 'height'] }));
    window.setTimeout(() => { try { obs.disconnect(); } catch (e) { /* ignore */ } }, dur);
  }, { dur: ms, pageNo: pg });
  await trigger();
  await win.waitForTimeout(ms + 300);
  return win.evaluate(() => {
    const f = window.__flash || { muts: [], nodes: 0 };
    const zeroW = f.muts.filter((m) => m.attr === 'width' && m.val === '0').length;
    const zeroH = f.muts.filter((m) => m.attr === 'height' && m.val === '0').length;
    return { nodes: f.nodes, mutations: f.muts.length, zeroW, zeroH, firstMuts: f.muts.slice(0, 8) };
  });
}

// ---- image placement helpers ----------------------------------------------

async function createImageBelow(win, scale, runPx) {
  const px = { x: runPx.x, y: runPx.y + runPx.h + Math.round(34 * scale.ky), w: Math.round(runPx.w * 0.6), h: Math.round(40 * scale.ky) };
  const a = { x: scale.cx + px.x / scale.kx, y: scale.cy + px.y / scale.ky };
  const b = { x: scale.cx + (px.x + px.w) / scale.kx, y: scale.cy + (px.y + px.h) / scale.ky };
  const fcPromise = win.waitForEvent('filechooser');
  await dragMouse(win, a, b, 14);
  const fc = await fcPromise;
  await fc.setFiles(PNG);
  await win.waitForTimeout(2000);
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

function domRectToCanvasPx(scale, r) {
  return {
    x: Math.round((r.x - scale.cx) * scale.kx),
    y: Math.round((r.y - scale.cy) * scale.ky),
    w: Math.round(r.w * scale.kx),
    h: Math.round(r.h * scale.ky),
  };
}

// ---- save / reopen (document-safety) --------------------------------------

async function saveAsCloseReopen(electronApp, win, tag) {
  const savePath = path.join(os.tmpdir(), `tflex-rel1181-${tag}-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(2800);
  const exists = fs.existsSync(savePath);
  console.log(`[release-1181|SAVED|${tag}] path=${savePath} exists=${exists} bytes=${exists ? fs.statSync(savePath).size : -1}`);

  await win.locator('.tab-close').first().click();
  await win.waitForTimeout(700);
  if (await win.locator('[data-close-prompt-action="discard"]').count()) {
    await win.locator('[data-close-prompt-action="discard"]').first().click();
    await win.waitForTimeout(900);
  }
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, savePath);
  const cmdOpen = win.locator('[aria-label="Open PDF document"]').first();
  if (await cmdOpen.isVisible().catch(() => false)) await cmdOpen.click();
  else await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(3000);
  return savePath;
}

// ---- watermark + toast helpers --------------------------------------------

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

async function waitForToast(win, text, timeout = 12000) {
  await win.waitForFunction(
    (want) => Array.from(document.querySelectorAll('.toast .toast-text')).some((t) => (t.textContent || '').trim() === want),
    text,
    { timeout },
  );
}

// ---------------------------------------------------------------------------
// 1. VERSION GATE
// ---------------------------------------------------------------------------

test('VERSION GATE: installed build reports app.getVersion() 1.18.1', async () => {
  await withApp(async (win, ctx, electronApp) => {
    const version = await electronApp.evaluate(async ({ app }) => app.getVersion());
    console.log(`[release-1181] app.getVersion() = ${JSON.stringify(version)} (exe: ${PACKAGED_EXE})`);
    expect(version, 'installed build version').toBe('1.18.1');
  });
});

// ---------------------------------------------------------------------------
// 2. DEF-214 guard + watermark regression
// ---------------------------------------------------------------------------

test('DEF-214 guard + watermark regression on the installed build', async () => {
  await withApp(async (win, ctx) => {
    ctx.consoleErrors.length = 0;
    ctx.pageErrors.length = 0;
    await openReportSample(win);

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
    await shot(win, 'release-1181-toolbars.png');
    console.log(`[release-1181] ann-toolbar ${JSON.stringify(annBox)} edit-toolbar ${JSON.stringify(editBox)}`);
    console.log(`[release-1181] console errors=${ctx.consoleErrors.length} page errors=${ctx.pageErrors.length}`);
    expect(ctx.consoleErrors, 'zero renderer console errors after open').toEqual([]);
    expect(ctx.pageErrors, 'zero uncaught renderer page errors after open').toEqual([]);

    // Watermark regression: apply -> exact toast -> applied row -> delete -> exact toast + row gone.
    await openWatermarkDialog(win);
    await win.locator('[data-watermark-text]').fill('CONFIDENTIAL');
    await win.locator('[data-watermark-confirm]').click();
    await waitForToast(win, 'Watermark applied.');
    console.log('[release-1181] exact toast observed: "Watermark applied."');

    await openWatermarkDialog(win);
    const row = win.locator('[data-watermark-applied="wm-1"]');
    await row.waitFor({ state: 'visible', timeout: 15000 });
    console.log('[release-1181] applied row wm-1 visible');

    await win.locator('[data-watermark-delete="wm-1"]').click();
    await waitForToast(win, 'Watermark deleted.');
    await row.waitFor({ state: 'detached', timeout: 15000 });
    console.log('[release-1181] exact toast observed: "Watermark deleted."; row detached');

    const engine = await win.evaluate(async () => {
      const id = window.tflexDiagnostics().engineDocId;
      const g = await window.tflex.engine.getWatermarks(id);
      return g.ok ? g.value.map((w) => w.id) : { err: g.error };
    });
    console.log(`[release-1181] engine watermarks after delete: ${JSON.stringify(engine)}`);
    expect(Array.isArray(engine), 'getWatermarks ok').toBe(true);
    expect(engine).not.toContain('wm-1');
    await closeWatermarkDialog(win);
  });
});

// ---------------------------------------------------------------------------
// 3. DEF-221 (mask anchor) + DEF-222 (thumb flash) - dense page text-run move
// ---------------------------------------------------------------------------

test('DEF-221 + DEF-222: dense text-run move +150/+120, old rect 0, above byte-identical, 0 thumb zero-mutations', async () => {
  await withApp(async (win, ctx, electronApp) => {
    await openReportSample(win);
    await scrollToPage(win, 2);
    await win.waitForTimeout(600);
    await armEditTool(win, 'text');

    const dense = await pickDenseRun(win, 2);
    expect(dense, 'a dense paragraph run must exist on page 2').toBeTruthy();
    const scale = await scaleFor(win, 2);
    const runPx = dense.canvasPx;
    const abovePx = bandAbove(scale, runPx);
    console.log(`[release-1181|DEF221] run="${dense.text}" px=${JSON.stringify(runPx)} above=${JSON.stringify(abovePx)}`);

    const beforeRun = await sigAtPx(win, runPx, 2);
    const beforeAbove = await sigAtPx(win, abovePx, 2);
    console.log(`[release-1181|DEF221|BEFORE] oldRectDark=${beforeRun.dark} aboveDark=${beforeAbove.dark} aboveHash=${beforeAbove.hash}`);

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
    console.log(`[release-1181|DEF221] data-edit-confirm=${confirmAttr}`);
    expect(confirmAttr, 'data-edit-confirm flips true after +150/+120').toBe('true');

    const flash = await aroundFlash(win, async () => {
      await win.locator('.edit-inline-editor [data-edit-confirm="true"]').first().click();
    }, 3000, 2);
    console.log(`[release-1181|DEF222] thumb-canvas mutations=${flash.mutations} nodes=${flash.nodes} zeroW=${flash.zeroW} zeroH=${flash.zeroH} first=${JSON.stringify(flash.firstMuts)}`);

    await win.waitForTimeout(900);
    const afterRun = await sigAtPx(win, runPx, 2);
    const afterAbove = await sigAtPx(win, abovePx, 2);
    console.log(`[release-1181|DEF221|AFTER] oldRectDark=${afterRun.dark} aboveDark=${afterAbove.dark} aboveHash=${afterAbove.hash}`);
    await shot(win, 'release-1181-edit-text-move.png');

    expect(afterRun.dark, 'old rect must be clean (dark 0) after Confirm').toBe(0);
    expect(afterAbove.hash, 'band above must be byte-identical after Confirm').toBe(beforeAbove.hash);
    expect(flash.zeroW, 'no thumb canvas width=0 mutation during Confirm (was 5)').toBe(0);
    expect(flash.zeroH, 'no thumb canvas height=0 mutation during Confirm (was 5)').toBe(0);

    await saveAsCloseReopen(electronApp, win, 'def221');
    await scrollToPage(win, 2);
    await win.waitForTimeout(800);
    const reRun = await sigAtPx(win, runPx, 2);
    const reAbove = await sigAtPx(win, abovePx, 2);
    console.log(`[release-1181|DEF221|REOPEN] oldRectDark=${reRun.dark} aboveDark=${reAbove.dark}`);
    expect(reRun.dark, 'old rect stays clean after save+reopen (baked)').toBe(0);
    expect(reAbove.dark, 'band above not erased after reopen (>=95% of before)').toBeGreaterThanOrEqual(Math.floor(beforeAbove.dark * 0.95));
  });
});

// ---------------------------------------------------------------------------
// 4. DEF-223 - image move commits (save/reopen)
// ---------------------------------------------------------------------------

test('DEF-223: image placement move commits - new rect carries image, old rect white after reopen', async () => {
  await withApp(async (win, ctx, electronApp) => {
    await openReportSample(win);
    await scrollToPage(win, 2);
    await win.waitForTimeout(600);
    await armEditTool(win, 'image');

    const dense = await pickDenseRun(win, 2);
    expect(dense, 'a dense paragraph run must exist on page 2').toBeTruthy();
    const scale = await scaleFor(win, 2);
    const imgPx = await createImageBelow(win, scale, dense.canvasPx);
    const newPx = { x: imgPx.x + 110, y: imgPx.y + 90, w: imgPx.w, h: imgPx.h };
    console.log(`[release-1181|DEF223] old=${JSON.stringify(imgPx)} target=${JSON.stringify(newPx)}`);

    const beforeOld = await sigAtPx(win, imgPx, 2);
    const beforeTarget = await sigAtPx(win, newPx, 2);
    console.log(`[release-1181|DEF223|BEFORE] oldDark=${beforeOld.dark} targetDark=${beforeTarget.dark}`);
    expect(beforeOld.dark, 'placed image has dark pixels').toBeGreaterThan(0);

    const imgRect = await imagePlacementRect(win);
    expect(imgRect, 'committed .edit-image-placement exists').toBeTruthy();
    await dragMouse(win, { x: imgRect.x + imgRect.w / 2, y: imgRect.y + imgRect.h / 2 }, { x: imgRect.x + imgRect.w / 2 + 110, y: imgRect.y + imgRect.h / 2 + 90 }, 14);
    await win.waitForTimeout(900);
    const imgRectAfter = await imagePlacementRect(win);
    console.log(`[release-1181|DEF223|DRAG] overlay before=${JSON.stringify(imgRect)} after=${JSON.stringify(imgRectAfter)}`);

    const afterOld = await sigAtPx(win, imgPx, 2);
    const afterTarget = await sigAtPx(win, newPx, 2);
    console.log(`[release-1181|DEF223|AFTER] oldDark=${afterOld.dark} targetDark=${afterTarget.dark}`);
    await shot(win, 'release-1181-image-move.png');

    expect(Math.round(imgRectAfter.x - imgRect.x), 'overlay mirror moved +110 CSS px').toBe(110);
    expect(Math.round(imgRectAfter.y - imgRect.y), 'overlay mirror moved +90 CSS px').toBe(90);

    await saveAsCloseReopen(electronApp, win, 'def223');
    await scrollToPage(win, 2);
    await win.waitForTimeout(800);
    const reOld = await sigAtPx(win, imgPx, 2);
    const reTarget = await sigAtPx(win, newPx, 2);
    console.log(`[release-1181|DEF223|REOPEN] oldDark=${reOld.dark} oldNearWhite=${reOld.nearWhite}/${reOld.total} targetDark=${reTarget.dark}`);
    expect(reOld.dark, 'old rect holds no image after save+reopen').toBe(0);
    expect(reOld.nearWhite, 'old rect fully white after reopen (mask covers it)').toBe(reOld.total);
    expect(reTarget.dark, 'image is at the NEW rect after save+reopen').toBeGreaterThan(beforeTarget.dark);
  });
});

// ---------------------------------------------------------------------------
// 5. DEF-224 (NEW) - SE resize handle fully hittable
// ---------------------------------------------------------------------------

test('DEF-224: SE resize handle outer-corner quadrant hit-tests to the handle and the resize commits', async () => {
  await withApp(async (win, ctx, electronApp) => {
    await openReportSample(win);
    await scrollToPage(win, 2);
    await win.waitForTimeout(600);
    await armEditTool(win, 'image');

    const dense = await pickDenseRun(win, 2);
    expect(dense, 'a dense paragraph run must exist on page 2').toBeTruthy();
    const scale = await scaleFor(win, 2);
    const imgPx = await createImageBelow(win, scale, dense.canvasPx);

    // Select the placement so the corner handles mount.
    const imgRect0 = await imagePlacementRect(win);
    expect(imgRect0, 'committed .edit-image-placement exists').toBeTruthy();
    await win.mouse.click(imgRect0.x + imgRect0.w / 2, imgRect0.y + imgRect0.h / 2);
    await win.waitForTimeout(400);

    const probe = await win.evaluate(() => {
      const p = document.querySelector('.edit-image-placement');
      const h = document.querySelector('.edit-image-handle-se');
      if (!p || !h) return null;
      const pr = p.getBoundingClientRect();
      const hr = h.getBoundingClientRect();
      const outer = { x: Math.round(pr.right + 3), y: Math.round(pr.bottom + 3) };
      const el = document.elementFromPoint(outer.x, outer.y);
      return {
        placement: { x: pr.x, y: pr.y, w: pr.width, h: pr.height, right: pr.right, bottom: pr.bottom },
        handle: { x: hr.x, y: hr.y, w: hr.width, h: hr.height },
        outer,
        hitClass: el ? String(el.className) : null,
        hitTag: el ? el.tagName : null,
        isHandle: !!(el && el.classList && el.classList.contains('edit-image-handle-se')),
      };
    });
    console.log(`[release-1181|DEF224] outer-corner probe: ${JSON.stringify(probe)}`);
    expect(probe, 'SE handle + placement must exist').toBeTruthy();
    expect(probe.isHandle, 'elementFromPoint at the outer SE quadrant returns .edit-image-handle-se, not the placement/host').toBe(true);

    await shot(win, 'release-1181-handle.png', {
      x: Math.max(0, Math.round(probe.placement.x - 24)),
      y: Math.max(0, Math.round(probe.placement.y - 24)),
      width: Math.round(probe.placement.w + 48),
      height: Math.round(probe.placement.h + 48),
    });

    const beforeOld = await sigAtPx(win, imgPx, 2);
    expect(beforeOld.dark, 'placed image has dark pixels').toBeGreaterThan(0);

    // Drag FROM the outer-corner quadrant (outside the placement box).
    await dragMouse(win, probe.outer, { x: probe.outer.x + 70, y: probe.outer.y + 50 }, 14);
    await win.waitForTimeout(900);
    const imgRectAfter = await imagePlacementRect(win);
    console.log(`[release-1181|DEF224|DRAG] outer=${JSON.stringify(probe.outer)} overlay before=${JSON.stringify(imgRect0)} after=${JSON.stringify(imgRectAfter)}`);
    expect(imgRectAfter.w, 'resize drag from the outer quadrant enlarges the overlay (width)').toBeGreaterThan(imgRect0.w);
    expect(imgRectAfter.h, 'resize drag from the outer quadrant enlarges the overlay (height)').toBeGreaterThan(imgRect0.h);

    const newPx = domRectToCanvasPx(scale, imgRectAfter);
    await saveAsCloseReopen(electronApp, win, 'def224');
    await scrollToPage(win, 2);
    await win.waitForTimeout(800);
    const reNew = await sigAtPx(win, newPx, 2);
    console.log(`[release-1181|DEF224|REOPEN] newPx=${JSON.stringify(newPx)} newDark=${reNew.dark}`);
    expect(reNew.dark, 'resize committed: image present at the NEW (grown) rect after save+reopen').toBeGreaterThan(0);
  });
});
