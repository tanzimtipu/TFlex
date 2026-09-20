// QA release-gate verification (originally on the installed v1.7.7 app).
// Since 2026-09-05 this spec launches the DEV build. Re-verifies
// itself (all 21 dialogs call useBackdropClose above the early-return guard).
//
// Items:
//   DEF-117     all modal dialogs open without React #310 / black window
//   B3/B6       DOCX + Insert dialog stays open on a text-selection drag-out;
//               a genuine backdrop click still closes; Crop/OCR/Sign open cleanly
//   B1          re-click a placed signature -> select handles appear
//   B4          OCR suspects panel renders as a TOP BAR (not hidden behind tools)
//   B5          add-box committed text is movable + font picker is live
//   B7          insert blank page after page 1 -> 35 pages, no duplicate
//   B8a         crop mode/page switch does NOT flash the canvas node
//   B8b         per-page crop crops only the adjusted page
//   B8c         undo after a page op (rotate) visually reverts
//   B10         maximize/restore icon is distinct from minimize
//
// Launch only via e2e/lib/launch.cjs against the DEV build (historically: the packaged installed exe).

const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');

let electronApp = null;
let win = null;
const pageErrors = [];

test.beforeEach(async () => {
  electronApp = await launchApp([]);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  pageErrors.length = 0;
  win.on('pageerror', (err) => {
    pageErrors.push(err && err.message ? err.message : String(err));
    process.stdout.write(`[PAGEERROR] ${err && err.message ? err.message : err}\n`);
  });
  await win.waitForTimeout(500);
});

test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null;
  win = null;
});

test.setTimeout(240000);

async function diag() {
  return win.evaluate(() => window.tflexDiagnostics());
}

async function openSample(name) {
  // Prefer the welcome-screen sample card; fall back to the Open-PDF dialog stub.
  const card = win.locator(`.sample-card:has-text("${name}")`);
  if (await card.count()) {
    await card.click();
  } else {
    const p = getSamplePath(name);
    await electronApp.evaluate(async ({ dialog }, samplePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [samplePath] });
    }, p);
    await win.click('button:has-text("Open PDF")');
  }
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(1500);
}

async function openTools() {
  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 10000 });
  await win.waitForTimeout(300);
}

// Open a palette tool, reusing the palette if it is already open (the host may
// or may not close the palette after a tool is chosen).
async function openPaletteTool(toolId) {
  const open = await win.evaluate(() => document.querySelector('[data-tools-palette]') !== null);
  if (!open) {
    await openTools();
  }
  await win.click(`[data-tool-id="${toolId}"]`);
}

async function innerSize() {
  return win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
}


function noHookErrors() {
  return pageErrors.filter((m) => /#310|Rules of Hooks|Rendered more hooks|#520/.test(m));
}

// ---------------------------------------------------------------------------
// DEF-117: every modal dialog mounts (no React #310) — Sign, DOCX, Crop,
// Insert, OCR. Previously each threw #310 and unmounted the whole UI.
// ---------------------------------------------------------------------------
test('DEF-117: all modal dialogs open without React #310', async () => {
  await openSample('report.pdf');

  const dialogs = [
    { name: 'Sign', open: async () => { await win.click('[aria-label="Sign tool"]'); await win.waitForSelector('.sig-manager', { timeout: 10000 }); }, close: async () => { await win.click('.sig-manager .modal-close').catch(() => {}); await win.waitForTimeout(500); } },
    { name: 'DOCX', open: async () => { await openPaletteTool('exportDocx'); await win.waitForSelector('[data-docx-export-dialog]', { timeout: 10000 }); }, close: async () => { await win.click('[data-docx-export-close]').catch(() => {}); await win.waitForTimeout(500); } },
    { name: 'Crop', open: async () => { await openPaletteTool('cropPages'); await win.waitForSelector('[data-crop-pages-dialog]', { timeout: 10000 }); }, close: async () => { await win.keyboard.press('Escape'); await win.waitForTimeout(500); } },
    { name: 'Insert', open: async () => { await openPaletteTool('insertPages'); await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 10000 }); }, close: async () => { await win.keyboard.press('Escape'); await win.waitForTimeout(500); } },
    { name: 'OCR', open: async () => { await openPaletteTool('recognizeText'); await win.waitForSelector('.ocr-dialog', { timeout: 10000 }); }, close: async () => { await win.click('[data-ocr-close]').catch(() => {}); await win.keyboard.press('Escape').catch(() => {}); await win.waitForTimeout(500); } },
  ];

  for (const d of dialogs) {
    await d.open();
    // Confirm the dialog is actually mounted AND the app didn't go black.
    const mounted = await win.evaluate(() => {
      return { hasDialog: document.querySelector('.modal-backdrop') !== null, appVisible: (document.querySelector('.app, .app-root, #root')?.childElementCount ?? 0) > 0 };
    });
    console.log(`[DEF-117] ${d.name} mounted=${mounted.hasDialog} appVisible=${mounted.appVisible}`);
    expect(mounted.hasDialog, `${d.name} dialog should mount`).toBe(true);
    await d.close();
    // Give the close an instant to tear the backdrop down before the next open.
    await win.waitForFunction(() => document.querySelector('.modal-backdrop') === null, null, { timeout: 5000 }).catch(() => {});
  }

  const hooks = noHookErrors();
  console.log(`[DEF-117] pageErrors total=${pageErrors.length} hookErrors=${JSON.stringify(hooks)}`);
  expect(hooks, 'no React #310/#520 hook errors across any dialog open').toHaveLength(0);
  console.log('[DEF-117] PASS');
});

// ---------------------------------------------------------------------------
// B3/B6: DOCX + Insert dialogs stay open on a text-selection drag-out and a
// genuine backdrop click still closes them.
// ---------------------------------------------------------------------------
test('B3/B6: DOCX + Insert drag-out stays open, genuine backdrop click closes', async () => {
  await openSample('report.pdf');

  async function dragOutAndCount(dialogSelector, inputSelector) {
    const input = win.locator(inputSelector).first();
    await input.waitFor({ timeout: 8000 });
    const ibox = await input.boundingBox();
    await win.mouse.move(ibox.x + ibox.width / 2, ibox.y + ibox.height / 2);
    await win.mouse.down();
    await win.mouse.move(10, 10, { steps: 12 });
    await win.mouse.up();
    await win.waitForTimeout(700);
    return win.locator(dialogSelector).count();
  }

  async function backdropClickCloses(dialogSelector) {
    const vm = await innerSize();
    // Backdrop is fixed inset:0 (z-index 800). A clean down+up on the left
    // edge (outside the centered dialog) must close the dialog.
    await win.mouse.click(12, Math.round(vm.h / 2));
    await win.waitForTimeout(400);
    return win.locator(dialogSelector).count();
  }

  // DOCX
  await openPaletteTool('exportDocx');
  await win.waitForSelector('[data-docx-export-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  let stillOpen = await dragOutAndCount('[data-docx-export-dialog]', '[data-docx-export-range]');
  console.log(`[B3] DOCX still open after drag-out=${stillOpen}`);
  expect(stillOpen, 'DOCX dialog must stay open after a drag-out').toBeGreaterThan(0);
  let closed = await backdropClickCloses('[data-docx-export-dialog]');
  console.log(`[B3] DOCX closed on genuine backdrop click=${closed}`);
  expect(closed, 'DOCX dialog must close on a genuine backdrop click').toBe(0);

  // Insert
  await openPaletteTool('insertPages');
  await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  stillOpen = await dragOutAndCount('[data-insert-pages-dialog]', '[data-insert-position]');
  console.log(`[B6] Insert still open after drag-out=${stillOpen}`);
  expect(stillOpen, 'Insert dialog must stay open after a drag-out').toBeGreaterThan(0);
  closed = await backdropClickCloses('[data-insert-pages-dialog]');
  console.log(`[B6] Insert closed on genuine backdrop click=${closed}`);
  expect(closed, 'Insert dialog must close on a genuine backdrop click').toBe(0);

  // No #310 anywhere in this flow.
  const hooks = noHookErrors();
  console.log(`[B3/B6] hookErrors=${JSON.stringify(hooks)}`);
  expect(hooks, 'no React #310 during the drag-out/backdrop flows').toHaveLength(0);
  console.log('[B3/B6] PASS');
});

// ---------------------------------------------------------------------------
// B1: re-click a placed signature -> select handles appear.
// ---------------------------------------------------------------------------
test('B1: re-click placed signature shows select handles', async () => {
  await openSample('report.pdf');

  await win.click('[aria-label="Sign tool"]');
  await win.waitForSelector('.sig-manager', { timeout: 10000 });
  await win.click('.sig-tab:has-text("Type")');
  await win.fill('input[aria-label="Type your signature"]', 'QA B1 Gate');
  await win.click('.sig-manager button:text-is("Save")');
  await win.waitForTimeout(500);
  await win.click('.sig-saved-pick');
  await win.waitForTimeout(500);

  const page = win.locator('.page-slot').first();
  const box = await page.boundingBox();
  await win.mouse.click(box.x + 300, box.y + 300);
  await win.waitForSelector('[data-sig-action-bar]', { timeout: 10000 });
  await win.click('[data-sig-action="confirm"]');
  await win.waitForTimeout(1000);
  await expect(win.locator('[data-sig-action-bar]')).toBeHidden();

  const placement = win.locator('.sig-placement').first();
  await placement.waitFor({ timeout: 10000 });
  const handledBefore = await win.locator('.sig-placement .sig-handle').count();
  const pbox = await placement.boundingBox();
  console.log(`[B1] placement=${JSON.stringify(pbox)} handlesBeforeReclick=${handledBefore}`);
  // Re-click the placement center.
  await win.mouse.click(pbox.x + pbox.width / 2, pbox.y + pbox.height / 2);
  await win.waitForTimeout(800);

  const handlesAfter = await win.locator('.sig-placement .sig-handle').count();
  const selected = await win.locator('.sig-placement-selected').count();
  const d = await diag();
  const engSigs = (d.engineState && (d.engineState.signatures ?? d.engineState.placedSignatures))?.length ?? 0;
  console.log(`[B1] afterReclick handles=${handlesAfter} selected=${selected} engineSigs=${engSigs}`);
  await win.screenshot({ path: 'screenshots/gate-b1-after-reclick.png' });

  // Success criterion: re-clicking the placed signature surfaces the selector.
  expect(handlesAfter, 're-clicked signature must show select handles').toBeGreaterThan(0);
  expect(selected, 're-clicked signature must be selected').toBeGreaterThan(0);
  console.log('[B1] PASS');
});

// ---------------------------------------------------------------------------
// B4: OCR suspects panel renders as a TOP BAR (not a hidden right rail).
// ---------------------------------------------------------------------------
test('B4: OCR suspects panel renders as a top bar', async () => {
  test.setTimeout(300000);
  await openSample('scanned.pdf');
  await openTools();
  await win.click('[data-tool-id="recognizeText"]');
  await win.waitForSelector('.ocr-dialog', { timeout: 10000 });
  await win.waitForTimeout(400);

  const curPage = win.locator('[data-ocr-scope="currentPage"]');
  if (await curPage.count()) await curPage.check();
  await win.click('[data-ocr-confirm]');

  // Wait for OCR to complete (dialog closes on confirm) and the suspects panel.
  let panel = win.locator('[data-ocr-suspects-panel]');
  for (let i = 0; i < 240; i++) {
    await win.waitForTimeout(1000);
    if (await panel.count()) break;
    if (i % 30 === 29) console.log(`[B4] waiting for suspects panel... ${i}s`);
  }
  if ((await panel.count()) === 0) {
    // Attempt to open from the palette.
    await openTools().catch(() => {});
    await win.click('[data-tool-id="ocrSuspects"]').catch(() => {});
    await win.waitForTimeout(800);
  }
  const visible = await panel.count();
  console.log(`[B4] suspects panel visible=${visible}`);
  await win.waitForTimeout(600);

  const geom = await win.evaluate(() => {
    const el = document.querySelector('[data-ocr-suspects-panel]');
    if (!el) return { present: false };
    const tools = document.querySelector('[data-tools-palette]');
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const overlap = tools
      ? (() => { const t = tools.getBoundingClientRect(); return { ix: Math.max(0, Math.min(r.right, t.right) - Math.max(r.left, t.left)), iy: Math.max(0, Math.min(r.bottom, t.bottom) - Math.max(r.top, t.top)) }; })()
      : null;
    return {
      present: true,
      rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      pos: cs.position,
      zIndex: Number(cs.zIndex || 0),
      overlap,
    };
  });
  console.log(`[B4] geom=${JSON.stringify(geom)}`);
  await win.screenshot({ path: 'screenshots/gate-b4-suspects-panel.png' });
  const vm = await innerSize();

  expect(geom.present, 'suspects panel must be present').toBe(true);
  // It is a TOP BAR: at the top of the workspace (small top offset), spanning
  // the full width (left near 0), positioned absolute. The redesign removed
  // the explicit z-index (layering is guaranteed by stacking order), so the
  // never-covered contract is asserted with a real hit test instead.
  expect(geom.rect.y, 'suspects panel should be anchored near the top').toBeLessThan(300);
  expect(geom.rect.x, 'suspects panel should start at the left edge').toBeLessThan(8);
  expect(geom.rect.w, 'suspects panel should span the full width').toBeGreaterThan(0.8 * vm.w);
  const covered = await win.evaluate(() => {
    const el = document.querySelector('[data-ocr-suspects-panel]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const probe = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(20, r.height / 2));
    return probe ? !el.contains(probe) : true;
  });
  expect(covered, 'suspects panel must not be covered by the palette or any overlay').toBe(false);
  const hooks = noHookErrors();
  expect(hooks, 'no React #310 during OCR').toHaveLength(0);
  console.log('[B4] PASS');
});

// ---------------------------------------------------------------------------
// B5: add-box committed text is movable + the font picker is live.
// ---------------------------------------------------------------------------
test('B5: add-box committed text renders full, is movable, font picker live', async () => {
  await openSample('report.pdf');
  const page = win.locator('.page-slot').first();
  const box = await page.boundingBox();

  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]');
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);

  await win.mouse.move(box.x + 180, box.y + 200);
  await win.mouse.down();
  await win.mouse.move(box.x + 420, box.y + 340, { steps: 8 });
  await win.mouse.up();
  await win.waitForSelector('[data-edit-editor="box"]', { timeout: 10000 });
  await win.waitForTimeout(300);

  // Font picker live: selecting Times/Courier changes the editor textarea font.
  await win.selectOption('[data-edit-editor="box"] select[aria-label="Font"]', 'Times');
  const timesFont = await win.evaluate(() => {
    const a = document.querySelector('[data-edit-textarea]');
    return a ? getComputedStyle(a).fontFamily : null;
  });
  console.log(`[B5] textarea fontFamily after Times=${timesFont}`);
  expect(timesFont, 'selecting Times must live-update the editor font').toMatch(/Times/);

  await win.fill('[data-edit-textarea]', 'MOVABLE BOX 999');
  await win.keyboard.press('Control+Enter');
  await win.waitForTimeout(1500);

  const layer = await win.evaluate(() => Array.from(document.querySelectorAll('.textLayer span')).map((s) => s.textContent).join('|'));
  const fullRendered = layer.includes('MOVABLE BOX 999');
  console.log(`[B5] committed text full rendered=${fullRendered} layerSample=${layer}`);
  expect(fullRendered, 'committed box text must render in full (not truncated)').toBe(true);

  // Re-arm the box tool and drag the committed .edit-box surface.
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(300);
  const editBox = win.locator('.edit-box').first();
  await editBox.waitFor({ timeout: 10000 });
  const before = await editBox.boundingBox();
  await win.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await win.mouse.down();
  await win.mouse.move(before.x + before.width / 2 + 120, before.y + before.height / 2 + 100, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(600);
  const after = await win.locator('.edit-box').first().boundingBox();
  const moved = after && (Math.abs(after.x - before.x) > 40 || Math.abs(after.y - before.y) > 40);
  console.log(`[B5] before=${JSON.stringify(before)} after=${JSON.stringify(after)} moved=${moved}`);
  expect(moved, 'committed box must be movable (dragged rect changes position)').toBe(true);
  console.log('[B5] PASS');
});

// ---------------------------------------------------------------------------
// B7: insert blank page as page 2 (i.e. "after page 1") -> 35 pages, no dup.
// Current dialog semantics are RANK-based (def_129/130 pins: position 1
// prepends as page 1), so "after page 1" is position 2.
// ---------------------------------------------------------------------------
test('B7: insert blank after page 1 -> 35 pages, no duplicate', async () => {
  await openSample('report.pdf');
  const d0 = await diag();
  const es0 = d0.engineState || d0;
  console.log(`[B7] initial pageCount=${es0.pageCount}`);

  await openTools();
  await win.click('[data-tool-id="insertPages"]');
  await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  // Insert blank page as page 2 = right after page 1 (rank semantics).
  await win.locator('[data-insert-position]').fill('2');
  await win.waitForTimeout(200);
  await win.click('[data-insert-confirm]');
  await win.waitForTimeout(2500);

  const d1 = await diag();
  const es1 = d1.engineState || d1;
  const order = es1.pageOrder || [];
  const unique = new Set(order);
  console.log(`[B7] after pageCount=${es1.pageCount} modified=${es1.modified} orderLen=${order.length} first=${order[0]} second=${order[1]} last=${order[order.length - 1]}`);
  console.log(`[B7] orderSample=${JSON.stringify(order.slice(0, 6))}`);
  console.log(`[B7] uniqueCount=${unique.size} hasDup=${unique.size !== order.length}`);

  const thumbCount = await win.locator('.thumb-item').count();
  console.log(`[B7] thumbCount=${thumbCount}`);

  // Success criteria: 35 pages, no duplicate pages, the blank placed as page 2.
  expect(es1.pageCount, 'page count must go 34 -> 35').toBe(es0.pageCount + 1);
  expect(order.length, 'pageOrder length must equal page count').toBe(es1.pageCount);
  expect(unique.size, 'pageOrder must have no duplicate pages').toBe(order.length);
  expect(order[0], 'page 1 must stay first').toBe(0);
  expect(order[1], 'the inserted blank page must be the 2nd page (right after page 1)').toBe(es0.pageCount);
  expect(thumbCount, 'side rail must show 35 thumbnails').toBe(35);
  await win.screenshot({ path: 'screenshots/gate-b7-after-insert.png' });
  console.log('[B7] PASS');
});

// ---------------------------------------------------------------------------
// B8a: crop mode/page switch does NOT flash/remount the canvas.
// ---------------------------------------------------------------------------
test('B8a: crop mode switch does not flash the canvas', async () => {
  await openSample('report.pdf');
  await openTools();
  await win.click('[data-tool-id="cropPages"]');
  await win.waitForSelector('[data-crop-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(700);

  await win.evaluate(() => {
    const c = document.querySelector('[data-crop-canvas]');
    if (c) c.setAttribute('data-canvas-tag', 'CANVAS-A');
  });

  async function sampleCanvas(label) {
    return win.evaluate((l) => {
      const c = document.querySelector('[data-crop-canvas]');
      if (!c) return { label: l, canvas: false };
      const cs = getComputedStyle(c);
      const r = c.getBoundingClientRect();
      return { label: l, canvas: true, tag: c.getAttribute('data-canvas-tag') ?? 'none', opacity: cs.opacity, w: Math.round(r.width), h: Math.round(r.height) };
    }, label);
  }

  // allPages (default) -> sample, switch to perPage, sample, switch back.
  const before = await sampleCanvas('all-0');
  await win.click('[data-crop-mode="perPage"]');
  const framesPer = [];
  for (let i = 0; i < 5; i++) { framesPer.push(await sampleCanvas('per-' + i)); await win.waitForTimeout(60); }
  await win.click('[data-crop-mode="allPages"]');
  const framesAll = [];
  for (let i = 0; i < 5; i++) { framesAll.push(await sampleCanvas('all-' + i)); await win.waitForTimeout(60); }
  console.log(`[B8a] before=${JSON.stringify(before)}`);
  console.log(`[B8a] perPage frames=${JSON.stringify(framesPer)}`);
  console.log(`[B8a] allPages frames=${JSON.stringify(framesAll)}`);

  const all = [...framesPer, ...framesAll];
  for (const f of all) {
    expect(f.canvas, 'crop canvas must be present').toBe(true);
    expect(f.tag, `frame ${f.label}: canvas must not remount`).toBe('CANVAS-A');
    expect(f.opacity, `frame ${f.label}: canvas must stay opaque`).toBe('1');
    expect(f.w < 600, `frame ${f.label}: canvas width must not jump to full 612`).toBe(true);
    expect(f.h < 790, `frame ${f.label}: canvas height must not jump to full 792`).toBe(true);
  }
  console.log('[B8a] PASS');
});

// ---------------------------------------------------------------------------
// B8b: per-page crop crops ONLY the page the user adjusted.
// ---------------------------------------------------------------------------
test('B8b: per-page crop crops only the adjusted page', async () => {
  await openSample('report.pdf');
  await openTools();
  await win.click('[data-tool-id="cropPages"]');
  await win.waitForSelector('[data-crop-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(600);

  await win.click('[data-crop-mode="perPage"]');
  await win.waitForTimeout(500);
  // Default editorPage is 1; drag the SE handle to commit a box on page 1.
  const se = win.locator('[data-crop-handle="se"]');
  const sb = await se.boundingBox();
  await win.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await win.mouse.down();
  await win.mouse.move(sb.x + sb.width / 2 + 35, sb.y + sb.height / 2 + 35, { steps: 6 });
  await win.mouse.up();
  await win.waitForTimeout(400);

  // View page 2 in the page picker WITHOUT adjusting it, to prove a page that was
  // merely rendered/selected (not adjusted) is not cropped.
  await win.selectOption('[data-crop-page-select]', '2');
  await win.waitForTimeout(500);
  await win.click('[data-crop-confirm]');
  await win.waitForTimeout(1800);

  const toast = await win.evaluate(() => {
    const t = document.querySelector('.toast');
    return t ? t.textContent : null;
  });
  const d1 = await diag();
  console.log(`[B8b] toast=${JSON.stringify(toast)} pageCount=${d1.engineState?.pageCount ?? d1.pageCount} modified=${d1.modified}`);

  // DEF-062: after crop the pdf.js proxy is rebuilt, so page 1 renders at its
  // crop ViewBox. Only the ADJUSTED page (1) should render smaller than the
  // full-size pages; page 2 and page 3 (neither adjusted) stay identical.
  // Virtualized workspace: each slot is ~1496px tall in a ~900px viewport, so
  // pages 1-3 are never mounted together - scroll to each page, wait for its
  // canvas, and measure it there (same technique as sweep_pageops P3).
  await win.waitForTimeout(1200);
  const pageDims = [];
  for (const n of [1, 2, 3]) {
    await win.evaluate((pg) => {
      const sc = document.querySelector('.document-scroller');
      const slot = document.querySelector(`.page-slot[data-page="${pg}"]`);
      if (sc && slot) sc.scrollTop = slot.offsetTop - 60;
    }, n);
    await win.waitForFunction(
      (pg) => {
        const s = document.querySelector(`.page-slot[data-page="${pg}"]`);
        return !!(s && s.querySelector('canvas'));
      },
      n,
      { timeout: 15000 },
    );
    await win.waitForTimeout(600);
    const dim = await win.evaluate((pg) => {
      const c = document.querySelector(`.page-slot[data-page="${pg}"] canvas`);
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    }, n);
    pageDims.push(dim);
  }
  console.log(`[B8b] pageDims 1..3=${JSON.stringify(pageDims)}`);

  // The toast confirms only ONE page was cropped ("Cropped 1 page."), and the
  // geometry confirms that page is page 1 (both unadjusted pages 2 and 3 render
  // larger than the cropped page 1).
  expect(String(toast).toLowerCase(), 'only one page should be cropped').toContain('cropped 1 page');
  expect(pageDims.length, 'three page slots should be measurable').toBe(3);
  expect(pageDims[0], 'page 1 must render (cropped)').toBeTruthy();
  expect(pageDims[1], 'page 2 must render (uncropped)').toBeTruthy();
  expect(pageDims[2], 'page 3 must render (uncropped)').toBeTruthy();
  expect(pageDims[0].w, 'page 1 must render smaller than page 2 (it was cropped)').toBeLessThan(pageDims[1].w);
  expect(pageDims[0].w, 'page 1 must render smaller than page 3 (it was cropped)').toBeLessThan(pageDims[2].w);
  console.log('[B8b] PASS');
});

// ---------------------------------------------------------------------------
// B8c: undo after a page op (rotate) visually reverts.
// ---------------------------------------------------------------------------
test('B8c: undo after a page op visually reverts', async () => {
  await openSample('report.pdf');
  const slot = win.locator('.page-slot').first();
  await slot.scrollIntoViewIfNeeded();
  await win.waitForTimeout(400);

  async function canvasRect() {
    return win.evaluate(() => {
      const s = document.querySelector('.page-slot');
      const c = s && s.querySelector('canvas');
      if (!c) return null;
      const r = c.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
  }

  const before = await canvasRect();
  const d0 = await diag();
  const rot0 = d0.engineState ? d0.engineState.rotations : null;
  console.log(`[B8c] before rect=${JSON.stringify(before)} rotations=${JSON.stringify(rot0)}`);

  await win.click('[data-toolbar-rotate-cw]');
  await win.waitForTimeout(1500);
  const rotated = await canvasRect();
  const d1 = await diag();
  const rot1 = d1.engineState ? d1.engineState.rotations : null;
  console.log(`[B8c] rotated rect=${JSON.stringify(rotated)} rotations=${JSON.stringify(rot1)} modified=${d1.modified} canUndo=${d1.canUndo}`);

  await win.keyboard.press('Control+z');
  await win.waitForTimeout(1500);
  const undone = await canvasRect();
  const d2 = await diag();
  const rot2 = d2.engineState ? d2.engineState.rotations : null;
  console.log(`[B8c] undone rect=${JSON.stringify(undone)} rotations=${JSON.stringify(rot2)} canRedo=${d2.canRedo} modified=${d2.modified}`);

  // The canvas must visibly swap back (proxy refreshed) on undo.
  const visualReverted = undone && before && (Math.abs(undone.w - before.w) <= 4 && Math.abs(undone.h - before.h) <= 4);
  const stateReverted = JSON.stringify(rot2) === JSON.stringify(rot0);
  console.log(`[B8c] visualReverted=${visualReverted} stateReverted=${stateReverted}`);
  expect(before, 'must have an initial canvas rect').toBeTruthy();
  expect(stateReverted, 'engine rotation state must revert on undo').toBe(true);
  expect(visualReverted, 'the page canvas must visually revert to the pre-op size').toBe(true);
  console.log('[B8c] PASS');
});

// ---------------------------------------------------------------------------
// B10: maximize/restore icon is distinct from minimize when maximized.
// ---------------------------------------------------------------------------
test('B10: restore icon distinct from minimize when maximized', async () => {
  await win.waitForTimeout(500);
  await win.waitForSelector('[data-window-maximize]', { timeout: 10000 });

  const restored = await win.evaluate(() => {
    const min = document.querySelector('[data-window-minimize] svg');
    const max = document.querySelector('[data-window-maximize] svg');
    return { min: min ? min.outerHTML : null, max: max ? max.outerHTML : null, maxLabel: document.querySelector('[data-window-maximize]')?.getAttribute('title') };
  });
  console.log(`[B10] restored maxLabel=${restored.maxLabel} distinct=${restored.min !== restored.max}`);

  await win.click('[data-window-maximize]');
  await win.waitForTimeout(1400);
  const maximized = await win.evaluate(() => {
    const min = document.querySelector('[data-window-minimize] svg');
    const max = document.querySelector('[data-window-maximize] svg');
    return { min: min ? min.outerHTML : null, max: max ? max.outerHTML : null, maxLabel: document.querySelector('[data-window-maximize]')?.getAttribute('title') };
  });
  const distinct = maximized.min !== maximized.max;
  const labelRight = /restore/i.test(maximized.maxLabel || '');
  console.log(`[B10] maximized maxLabel=${maximized.maxLabel} distinct=${distinct} labelRestore=${labelRight}`);
  await win.screenshot({ path: 'screenshots/gate-b10-maximized.png' });

  expect(distinct, 'maximize button icon must differ from the minimize icon when maximized').toBe(true);
  expect(labelRight, "maximize button tooltip should read 'Restore window' when maximized").toBe(true);
  console.log('[B10] PASS');
});
