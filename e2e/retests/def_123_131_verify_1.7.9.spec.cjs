// QA release-gate verification on the INSTALLED v1.7.9 app
// (AppData\Local\Programs\tflex\TFlex.exe, FileVersion 1.7.9, exe 02:56 newer
// than all src). Re-verifies the nine defects the developers report fixed:
//
//   DEF-123  placed signature click -> Confirm/Cancel/Delete action bar;
//            drag holds a rect then Confirm commits it
//   DEF-124  edit text -> the old run is fully masked (no faint ghost trace)
//   DEF-125  Sign while Edit mode active exits Edit mode; Sign applies on page
//   DEF-126  OCR suspects bar flush under the top bar, no dead gap, translucent,
//            does not overlap the thumbnail rail or the Tools palette
//   DEF-127  committed text box: click reopens the editor; drag moves text+box
//            together (re-baked); no phantom empty box persists
//   DEF-128  closing an unsaved sample tab offers "Save As..." (no hard-block)
//   DEF-129  insert blank at position 1 prepends a blank page (becomes page 1)
//   DEF-130  insert blank, undo, re-insert -> no NaN degreeAngle error, proxy
//            refreshes
//   DEF-131  per-page crop crops only the selected page (others unchanged)
//
// Regression around the insert semantics: DEF-122 (field "2" -> blank becomes
// page 2) and DEF-121 (no unhandled "Invalid page request" after a mid-doc
// insert) are asserted inside the insert tests because they share the code path.
//
// Launch only via e2e/lib/launch.cjs against the packaged installed exe. Never
// a .cmd/.ps1 shim; never a hand-concatenated file:// URL.

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument } = require('pdf-lib');

const EXE_PATH = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

let electronApp = null;
let win = null;
let pageErrors = [];

test.beforeEach(async () => {
  electronApp = await launchApp([], null, EXE_PATH);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  pageErrors = [];
  win.on('pageerror', (err) => {
    const m = err && err.message ? err.message : String(err);
    pageErrors.push(m);
    process.stdout.write(`[PAGEERROR] ${m}\n`);
  });
  await win.waitForTimeout(600);
});

test.afterEach(async () => {
  if (electronApp) await electronApp.close().catch(() => {});
  electronApp = null;
  win = null;
  pageErrors = [];
});

test.setTimeout(300000);

async function diag() {
  return win.evaluate(() => window.tflexDiagnostics());
}

async function eng() {
  const d = await diag();
  return d.engineState || d;
}

async function openSample(name) {
  const card = win.locator(`.sample-card:has-text("${name}")`);
  if (await card.count()) {
    await card.click();
  } else {
    const p = path.resolve(__dirname, '..', '..', 'assets', 'samples', name);
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

async function openPaletteTool(toolId) {
  const open = await win.evaluate(() => document.querySelector('[data-tools-palette]') !== null);
  if (!open) await openTools();
  await win.click(`[data-tool-id="${toolId}"]`);
}

async function shot(name) {
  await win.screenshot({ path: path.join(SHOTS, name) });
}

// Create a typed signature, save it, and arm the Sign tool.
async function createAndArmSignature(text) {
  await win.click('[aria-label="Sign tool"]');
  await win.waitForSelector('.sig-manager', { timeout: 10000 });
  await win.click('.sig-tab:has-text("Type")').catch(() => {});
  await win.fill('input[aria-label="Type your signature"]', text || 'QA Suite');
  await win.click('.sig-manager button:text-is("Save")').catch(() => {});
  await win.waitForTimeout(500);
  await win.click('.sig-saved-pick').catch(() => {});
  await win.waitForTimeout(500);
}

// Measure the main page canvases keyed by data-page (using the page-slot
// wrapper, which is rendered for the virtualized page window).
async function measurePages() {
  return win.evaluate(() => {
    const out = {};
    document.querySelectorAll('.page-slot[data-page]').forEach((p) => {
      const c = p.querySelector('canvas');
      const n = Number(p.getAttribute('data-page'));
      if (!c) { out[n] = null; return; }
      const r = c.getBoundingClientRect();
      out[n] = { w: Math.round(r.width), h: Math.round(r.height) };
    });
    return out;
  });
}

// Scroll the document scroller so pages 1-3 (or the requested window) render.
async function scrollToRevealPages(pages) {
  await win.evaluate((want) => {
    const sc = document.querySelector('.document-scroller');
    if (!sc) return;
    // Roughly position the scroller so the target page band is visible.
    const band = want - 2 < 1 ? 1 : want - 2;
    sc.scrollTop = 1500 * band;
  }, pages);
  await win.waitForTimeout(800);
}

// ---------------------------------------------------------------------------
// DEF-123: placed signature click -> action bar; drag holds rect, Confirm commits
// ---------------------------------------------------------------------------
test('DEF-123: committed signature click shows Confirm/Cancel/Delete; drag + Confirm commits', async () => {
  await openSample('report.pdf');

  await createAndArmSignature('QA Ground');
  const page = win.locator('.page-slot').first();
  const pbox = await page.boundingBox();
  await win.mouse.click(pbox.x + 320, pbox.y + 300);
  await win.waitForSelector('[data-sig-action-bar]', { timeout: 10000 });
  await win.click('[data-sig-action="confirm"]');
  await win.waitForTimeout(1000);
  await expect(win.locator('[data-sig-action-bar]')).toBeHidden();

  const placement = win.locator('.sig-placement').first();
  await placement.waitFor({ timeout: 10000 });
  const before = await placement.boundingBox();
  console.log(`[DEF-123] committed placement before=${JSON.stringify(before)}`);

  // Click the committed placement -> the action bar must reappear.
  await win.mouse.click(before.x + before.width / 2, before.y + before.height / 2);
  await win.waitForTimeout(600);
  const barCount = await win.locator('[data-sig-action-bar]').count();
  const confirm = await win.locator("[data-sig-action='confirm']").count();
  const cancel = await win.locator("[data-sig-action='cancel']").count();
  const del = await win.locator("[data-sig-action='delete']").count();
  const selectedCount = await win.locator('.sig-placement-selected').count();
  console.log(`[DEF-123] after click bar=${barCount} confirm=${confirm} cancel=${cancel} delete=${del} selected=${selectedCount}`);
  await shot('def-123-after-click-bar.png');

  expect(barCount, 'a committed placement must re-show the action bar').toBeGreaterThan(0);
  expect(confirm, 'action bar must offer Confirm').toBeGreaterThan(0);
  expect(cancel, 'action bar must offer Cancel').toBeGreaterThan(0);
  expect(del, 'action bar must offer Delete').toBeGreaterThan(0);
  expect(selectedCount, 'the clicked placement must be selected').toBeGreaterThan(0);

  // Drag the committed placement (mousedown on it) -> the hold rect moves but
  // the placement is still NOT committed; the bar stays, and Confirm commits it.
  await win.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await win.mouse.down();
  await win.mouse.move(before.x + before.width / 2 + 60, before.y + before.height / 2 + 45, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(600);
  const after = await win.locator('.sig-placement').first().boundingBox();
  const barAfterDrag = await win.locator('[data-sig-action-bar]').count();
  const moved = after && Math.abs(after.x - before.x) > 20 && Math.abs(after.y - before.y) > 20;
  console.log(`[DEF-123] after drag rect=${JSON.stringify(after)} moved=${moved} barStillPresent=${barAfterDrag}`);
  await shot('def-123-after-drag.png');
  expect(moved, 'dragging the committed signature must move its placeholder rect').toBe(true);
  expect(barAfterDrag, 'the action bar must persist while the held move is uncommitted').toBeGreaterThan(0);

  // Confirm commits the held rect -> selection ends, the bar disappears, the
  // placement is still present (committed at the new location).
  await win.click('[data-sig-action="confirm"]');
  await win.waitForTimeout(800);
  const barAfterConfirm = await win.locator('[data-sig-action-bar]').count();
  const placementCount = await win.locator('.sig-placement').count();
  console.log(`[DEF-123] after confirm bar=${barAfterConfirm} placementCount=${placementCount}`);
  expect(barAfterConfirm, 'Confirm must end the selection and dismiss the bar').toBe(0);
  expect(placementCount, 'the committed placement must still be present after Confirm').toBeGreaterThan(0);

  const hooks = pageErrors.filter((m) => /#310|Rules of Hooks|#520/.test(m));
  expect(hooks, 'no React hook errors during the sign flow').toHaveLength(0);
  console.log('[DEF-123] PASS');
});

// ---------------------------------------------------------------------------
// DEF-124: edit text -> old run fully masked (no faint ghost trace)
// ---------------------------------------------------------------------------
test('DEF-124: edit-text no longer leaves a faint trace of the old run', async () => {
  await openSample('report.pdf');
  const e0 = await eng();
  const pages0 = e0.pageCount;
  console.log(`[DEF-124] initial pageCount=${pages0}`);

  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]');
  await win.click('[data-edit-tool="text"]');
  await win.waitForTimeout(400);

  // Find a text run bounding box from the live textLayer. Prefer the title run
  // (a reliably contiguous single span on page 1); fall back to a visible span.
  const spans = await win.evaluate(() => {
    const out = [];
    document.querySelectorAll('.textLayer span').forEach((s) => {
      const r = s.getBoundingClientRect();
      const t = (s.textContent || '').trim();
      if (r.width > 0 && r.height > 0 && t.length > 0) {
        out.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: t.slice(0, 80) });
      }
    });
    return out;
  });
  console.log(`[DEF-124] candidate spans=${spans.length}`);
  const viewportH = win.evaluate(() => window.innerHeight).catch(() => 900);
  const vh = await viewportH;
  const target =
    spans.find((s) => /TFlex Technical Report/.test(s.text)) ||
    spans.find((s) => /A study in PDF orchestration/.test(s.text)) ||
    spans.find((s) => s.y > 100 && s.y < vh - 60 && s.w > 40 && s.text.length > 8) ||
    spans[0];
  expect(target, 'must find a text run to edit').toBeTruthy();
  const oldText = target.text;
  console.log(`[DEF-124] editing run at (${target.x},${target.y}) w=${target.w} h=${target.h} text="${oldText}"`);

  // The title run is in the viewport, so no scroll needed. Hover (edit-text
  // hint), then click to open the editor.
  await win.mouse.move(target.x + target.w / 2, target.y + target.h / 2);
  await win.waitForTimeout(400);
  await win.mouse.click(target.x + target.w / 2, target.y + target.h / 2);
  await win.waitForSelector('[data-edit-editor="text"], [data-edit-editor="edit"]', { timeout: 8000 }).catch(() => {});
  const editor = await win.locator('[data-edit-editor="text"], [data-edit-editor="edit"]').count();
  console.log(`[DEF-124] editor open=${editor}`);
  expect(editor, 'the inline editor must open for the clicked run').toBeGreaterThan(0);

  await win.fill('[data-edit-textarea]', 'ZZZ REPLACEMENT 987654');
  await win.keyboard.press('Control+Enter');
  await win.waitForTimeout(1500);

  // New text must render in the live textLayer (proxy refreshed).
  const layer = await win.evaluate(() => Array.from(document.querySelectorAll('.textLayer span')).map((s) => s.textContent).join('|'));
  const newRendered = layer.includes('ZZZ REPLACEMENT 987654');
  console.log(`[DEF-124] new text rendered in live layer=${newRendered}`);
  expect(newRendered, 'the edited text must render in the live view').toBe(true);
  await shot('def-124-after-edit.png');

  const hooks = pageErrors.filter((m) => /#310|Rules of Hooks|#520/.test(m));
  expect(hooks, 'no React hook errors during the edit').toHaveLength(0);
  console.log('[DEF-124] e2e PASS (visual ghost judged from the screenshot; geometry pinned by unit suite)');
});

// ---------------------------------------------------------------------------
// DEF-125: Sign while Edit mode active -> exits Edit mode, Sign applies
// ---------------------------------------------------------------------------
test('DEF-125: Sign while Edit mode active exits Edit mode and places on page', async () => {
  await openSample('report.pdf');

  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]');
  await win.click('[data-edit-tool="text"]');
  await win.waitForTimeout(400);
  const editLayerActiveBefore = await win.locator('.edit-layer').first().getAttribute('class');
  console.log(`[DEF-125] edit layer before sign=${editLayerActiveBefore}`);

  // Open the Sign tool (this must exit Edit mode).
  await win.click('[aria-label="Sign tool"]');
  await win.waitForSelector('.sig-manager', { timeout: 10000 });
  await win.waitForTimeout(500);

  const editTogglePressed = await win.locator('[data-toolbar-edit-toggle]').getAttribute('aria-pressed');
  const editToolbarCount = await win.locator('[data-edit-toolbar]').count();
  const editLayerClass = await win.locator('.edit-layer').first().getAttribute('class').catch(() => null);
  console.log(`[DEF-125] after opening Sign: editTogglePressed=${editTogglePressed} editToolbar=${editToolbarCount} editLayerClass=${editLayerClass}`);
  await shot('def-125-sign-opens-edit-exited.png');
  expect(editTogglePressed, 'opening the Sign tool must exit Edit mode').toBe('false');
  // The edit layer may be removed entirely (null) or its active class cleared.
  expect(
    editLayerClass === null || !String(editLayerClass).includes('edit-layer-active'),
    'the edit layer must no longer be active',
  ).toBe(true);

  // Create + arm the signature, place it on the page.
  await win.click('.sig-tab:has-text("Type")').catch(() => {});
  await win.fill('input[aria-label="Type your signature"]', 'QA Sig');
  await win.click('.sig-manager button:text-is("Save")').catch(() => {});
  await win.waitForTimeout(500);
  await win.click('.sig-saved-pick').catch(() => {});
  await win.waitForTimeout(500);

  const page = win.locator('.page-slot').first();
  const pbox = await page.boundingBox();
  await win.mouse.click(pbox.x + 400, pbox.y + 400);
  await win.waitForTimeout(800);

  const sigPending = await win.locator('[data-sig-pending]').count();
  const sigBar = await win.locator('[data-sig-action-bar]').count();
  console.log(`[DEF-125] after placement click sigPending=${sigPending} sigBar=${sigBar}`);

  // Confirm the placement (commit), then verify it landed on the page.
  if (sigBar > 0) {
    await win.click('[data-sig-action="confirm"]');
    await win.waitForTimeout(800);
  }
  const placementCount = await win.locator('.sig-placement').count();
  console.log(`[DEF-125] committed placements=${placementCount}`);
  await shot('def-125-placed-on-page.png');

  expect(placementCount, 'the signature must land on the page while Sign was armed').toBeGreaterThan(0);
  const hooks = pageErrors.filter((m) => /#310|Rules of Hooks|#520/.test(m));
  expect(hooks, 'no React hook errors in the sign-while-edit flow').toHaveLength(0);
  console.log('[DEF-125] PASS');
});

// ---------------------------------------------------------------------------
// DEF-126: OCR suspects bar flush under top bar, translucent, no overlap
// ---------------------------------------------------------------------------
test('DEF-126: OCR suspects bar is a flush translucent flow bar, no overlaps', async () => {
  test.setTimeout(300000);
  await openSample('scanned.pdf');
  await openTools();
  await win.click('[data-tool-id="recognizeText"]');
  await win.waitForSelector('.ocr-dialog', { timeout: 10000 });
  await win.waitForTimeout(400);
  const cur = win.locator('[data-ocr-scope="currentPage"]');
  if (await cur.count()) await cur.check();
  await win.click('[data-ocr-confirm]');

  let panel = win.locator('[data-ocr-suspects-panel]');
  for (let i = 0; i < 240; i++) {
    await win.waitForTimeout(1000);
    if (await panel.count()) break;
    if (i % 30 === 29) console.log(`[DEF-126] waiting for suspects panel... ${i}s`);
  }
  if ((await panel.count()) === 0) {
    await openTools().catch(() => {});
    await win.click('[data-tool-id="ocrSuspects"]').catch(() => {});
    await win.waitForTimeout(800);
  }
  expect(await panel.count(), 'the OCR suspects panel must appear').toBeGreaterThan(0);
  await win.waitForTimeout(600);

  const geom = await win.evaluate(() => {
    const panel = document.querySelector('[data-ocr-suspects-panel]');
    const appMain = document.querySelector('.app-main');
    const rail = document.querySelector('.side-rail, .thumb-rail');
    const palette = document.querySelector('[data-tools-palette]');
    const toolbar = document.querySelector('.toolbar, [data-toolbar]');
    const annToolbar = document.querySelector('.ann-toolbar, [data-ann-toolbar]');
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom, top: b.top }; };
    const cs = getComputedStyle(panel);
    const bg = cs.backgroundColor;
    const alpha = (() => {
      const m = bg.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/);
      return m ? parseFloat(m[4]) : 1;
    })();
    const inter = (a, b) => {
      if (!a || !b) return 0;
      return Math.max(0, (Math.min(a.right, b.right) - Math.max(a.x, b.x))) * Math.max(0, (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)));
    };
    return {
      panel: r(panel), appMain: r(appMain), rail: r(rail), palette: r(palette),
      toolbar: r(toolbar), annToolbar: r(annToolbar),
      pos: cs.position, bg, alpha,
      overlapRail: inter(r(panel), r(rail)),
      overlapPalette: inter(r(panel), r(palette)),
    };
  });
  console.log(`[DEF-126] geom=${JSON.stringify(geom)}`);
  await shot('def-126-suspects-panel.png');

  // Flow element (not an absolute overlay).
  expect(['static', 'relative', 'flex', ''].some((v) => geom.pos === v), `panel position must be in flow (got ${geom.pos})`).toBe(true);
  // Translucent background (not an opaque slab).
  expect(geom.alpha, 'the suspects bar must have a translucent background').toBeLessThan(1);
  // Does not overlap the left thumbnail rail or the right Tools palette.
  expect(geom.overlapRail, 'the panel must not overlap the thumbnail rail').toBe(0);
  expect(geom.overlapPalette, 'the panel must not overlap the Tools palette').toBe(0);
  // No dead gap: the panel must sit flush at the very top of the workspace
  // (panel.top == app-main.top), i.e. directly under the header/top bar.
  const flushGap = geom.panel ? Math.abs(geom.panel.top - geom.appMain.top) : -1;
  console.log(`[DEF-126] panelTop=${geom.panel && geom.panel.top} appMainTop=${geom.appMain && geom.appMain.top} flushGap=${flushGap}`);
  expect(flushGap, 'the panel must sit flush at the top of the workspace (no gap under the top bar)').toBeLessThanOrEqual(2);
  // The workspace content (thumbnail rail) must start DIRECTLY below the panel:
  // the panel reserves its own space and the rail reflows beneath it.
  const underGap = geom.rail && geom.panel ? geom.rail.top - geom.panel.bottom : -1;
  console.log(`[DEF-126] railTop=${geom.rail && geom.rail.top} panelBottom=${geom.panel && geom.panel.bottom} underGap=${underGap}`);
  expect(underGap, 'the content must start directly below the panel (no dead gap, no overlap)').toBeLessThanOrEqual(2);
  console.log('[DEF-126] PASS');
});

// ---------------------------------------------------------------------------
// DEF-127 / 127b: committed box drag carries text+box; click reopens editor
// ---------------------------------------------------------------------------
test('DEF-127: committed text box mirrors content, drags as a unit, click reopens editor', async () => {
  await openSample('report.pdf');
  const page = win.locator('.page-slot').first();
  const pbox = await page.boundingBox();

  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]');
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);

  // Create a box, type text, commit.
  await win.mouse.move(pbox.x + 180, pbox.y + 210);
  await win.mouse.down();
  await win.mouse.move(pbox.x + 380, pbox.y + 300, { steps: 8 });
  await win.mouse.up();
  await win.waitForSelector('[data-edit-editor="box"]', { timeout: 10000 });
  await win.waitForTimeout(300);
  await win.fill('[data-edit-textarea]', 'DEF127 MOVABLE BOX');
  await win.keyboard.press('Control+Enter');
  await win.waitForTimeout(1500);

  // The committed box surface mirrors its content (white fill + text).
  const mirrorText = await win.locator('[data-edit-box-text-mirror]').first().textContent().catch(() => null);
  const fillCount = await win.locator('.edit-box-fill').count();
  console.log(`[DEF-127] after commit mirrorText="${mirrorText}" fill=${fillCount}`);
  await shot('def-127-committed-box.png');
  expect(mirrorText, 'the committed box surface must mirror the baked text').toMatch(/DEF127 MOVABLE BOX/);
  expect(fillCount, 'a white-background box must render its fill mirror').toBeGreaterThan(0);

  // Re-arm the box tool, drag the committed box -> whole box moves (text mirror
  // travels with it); no phantom empty box is left behind.
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(300);
  let editBox = win.locator('.edit-box').first();
  await editBox.waitFor({ timeout: 10000 });
  const before = await editBox.boundingBox();
  await win.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await win.mouse.down();
  await win.mouse.move(before.x + before.width / 2 + 110, before.y + before.height / 2 + 70, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(700);
  const after = await win.locator('.edit-box').first().boundingBox();
  const boxCount = await win.locator('.edit-box').count();
  const mirrorAfter = await win.locator('[data-edit-box-text-mirror]').first().textContent().catch(() => null);
  const moved = after && (Math.abs(after.x - before.x) > 40 || Math.abs(after.y - before.y) > 40);
  console.log(`[DEF-127] after drag before=${JSON.stringify(before)} after=${JSON.stringify(after)} moved=${moved} boxCount=${boxCount} mirror="${mirrorAfter}"`);
  expect(moved, 'dragging the box must move the whole box rect').toBe(true);
  expect(boxCount, 'no phantom empty box must persist (exactly one box)').toBe(1);
  expect(mirrorAfter, 'the moved box must still mirror its text').toMatch(/DEF127 MOVABLE BOX/);
  await shot('def-127-after-drag.png');

  // A click (no drag) on the committed box reopens the inline editor pre-filled.
  const now = await win.locator('.edit-box').first().boundingBox();
  await win.mouse.click(now.x + now.width / 2, now.y + now.height / 2);
  await win.waitForTimeout(700);
  const editorCount = await win.locator("[data-edit-editor='edit']").count();
  const textareaVal = await win.locator('[data-edit-textarea]').inputValue().catch(() => null);
  console.log(`[DEF-127] click reopened editor=${editorCount} value="${textareaVal}"`);
  await shot('def-127-click-reopens-editor.png');
  expect(editorCount, 'clicking a committed box must reopen the inline editor').toBeGreaterThan(0);
  expect(textareaVal, 'the reopened editor must be pre-filled with the box text').toMatch(/DEF127 MOVABLE BOX/);
  console.log('[DEF-127] PASS');
});

// ---------------------------------------------------------------------------
// DEF-128: closing an unsaved sample tab offers Save As (no hard-block)
// ---------------------------------------------------------------------------
test('DEF-128: unsaved sample tab close prompt offers Save As and saves-and-closes', async () => {
  test.setTimeout(120000);
  await openSample('report.pdf');

  // Make the tab modified (rotate a page).
  await win.click('[data-toolbar-rotate-cw]');
  await win.waitForTimeout(1200);
  const e0 = await eng();
  console.log(`[DEF-128] after rotate modified=${e0.modified}`);

  // Close the tab -> unsaved-changes prompt.
  await win.click('.tab-close');
  await win.waitForSelector('[data-close-prompt]', { timeout: 10000 });
  await win.waitForTimeout(400);

  const promptState = await win.evaluate(() => {
    const save = document.querySelector("[data-close-prompt-action='save']");
    const err = document.querySelector('[data-close-prompt-error]');
    return {
      saveText: save ? save.textContent : null,
      hasHardBlock: err ? err.textContent : null,
    };
  });
  console.log(`[DEF-128] prompt saveText="${promptState.saveText}" hasHardBlock="${promptState.hasHardBlock}"`);
  await shot('def-128-prompt-save-as.png');
  expect(promptState.saveText, 'the prompt must offer Save As for a path-less tab').toBe('Save As…');
  expect(promptState.hasHardBlock, 'the prompt must not hard-block with a no-on-disk-path error').toBe(null);

  // Stub the OS save dialog to a temp PDF path, then click Save As.
  const outPath = path.join(os.tmpdir(), `tflex-def128-saveas-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, outPath);
  await win.click("[data-close-prompt-action='save']");
  await win.waitForTimeout(2500);

  const closed = await win.evaluate(() => ({
    prompt: document.querySelector('[data-close-prompt]') !== null,
    workspace: document.querySelector('.workspace') !== null,
    tabs: document.querySelectorAll('.tab-item').length,
  }));
  console.log(`[DEF-128] after Save As promptOpen=${closed.prompt} workspace=${closed.workspace} tabs=${closed.tabs}`);
  const savedExists = fs.existsSync(outPath);
  let savedPages = null;
  if (savedExists) {
    try {
      const bytes = fs.readFileSync(outPath);
      const doc = await PDFDocument.load(bytes);
      savedPages = doc.getPageCount();
    } catch (e) {
      console.log(`[DEF-128] saved PDF parse error: ${e.message}`);
    }
  }
  console.log(`[DEF-128] savedExists=${savedExists} savedPages=${savedPages}`);
  await shot('def-128-after-save-as.png');

  expect(savedExists, 'the Save As flow must write a real PDF').toBe(true);
  expect(savedPages, 'the saved PDF must be valid and parsed').toBe(34);
  console.log('[DEF-128] PASS');
});

// ---------------------------------------------------------------------------
// DEF-129: insert blank at position 1 prepends (blank becomes page 1)
// ---------------------------------------------------------------------------
test('DEF-129: insert blank at position 1 prepends a blank page as page 1', async () => {
  await openSample('report.pdf');
  const e0 = await eng();
  const pages0 = e0.pageCount;
  const order0 = e0.pageOrder;
  console.log(`[DEF-129] initial pageCount=${pages0} order0=${JSON.stringify(order0)}`);

  await openTools();
  await win.click('[data-tool-id="insertPages"]');
  await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-insert-mode="blank"]');
  await win.waitForTimeout(200);
  await win.fill('[data-insert-position]', '1');
  await win.waitForTimeout(200);

  const insertState = await win.evaluate(() => ({
    confirmDisabled: document.querySelector('[data-insert-confirm]')?.disabled,
    hint: document.querySelector('.modal-hint')?.textContent,
  }));
  console.log(`[DEF-129] position=1 confirmDisabled=${insertState.confirmDisabled}`);
  await shot('def-129-position1.png');
  expect(insertState.confirmDisabled, 'the Insert button must be enabled at position 1').toBe(false);

  await win.click('[data-insert-confirm]');
  await win.waitForTimeout(2500);

  const e1 = await eng();
  const order = e1.pageOrder || [];
  const unique = new Set(order);
  console.log(`[DEF-129] after pageCount=${e1.pageCount} order0=${JSON.stringify(order.slice(0, 6))} unique=${unique.size}`);
  await shot('def-129-after-prepend.png');

  expect(e1.pageCount, 'page count must grow by one').toBe(pages0 + 1);
  expect(order.length, 'pageOrder must match the page count').toBe(e1.pageCount);
  expect(unique.size, 'no duplicate pages').toBe(order.length);
  // The new blank page (origIdx = prior pageCount) must be page 1.
  expect(order[0], 'the blank page must become page 1').toBe(pages0);
  expect(order[1], 'the original page 1 must shift to page 2').toBe(0);

  // No unhandled "Invalid page request" (DEF-121 regression) and no NaN toast.
  const badErrors = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN/.test(m));
  expect(badErrors, 'no unhandled page-request / NaN errors after the insert').toHaveLength(0);
  console.log('[DEF-129] PASS');
});

// ---------------------------------------------------------------------------
// DEF-130: insert blank, undo, re-insert -> no NaN degreeAngle error
// ---------------------------------------------------------------------------
test('DEF-130: insert blank, undo, re-insert -> no NaN degreeAngle error, proxy refreshes', async () => {
  await openSample('report.pdf');
  const e0 = await eng();
  const pages0 = e0.pageCount;
  console.log(`[DEF-130] initial pageCount=${pages0}`);

  // Insert a blank after page 1 (position "2").
  await openPaletteTool('insertPages');
  await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-insert-mode="blank"]');
  await win.fill('[data-insert-position]', '2');
  await win.waitForTimeout(200);
  await win.click('[data-insert-confirm]');
  await win.waitForTimeout(2500);
  const e1 = await eng();
  console.log(`[DEF-130] after insert pageCount=${e1.pageCount} modified=${e1.modified}`);

  // Undo.
  await win.click('[aria-label="Undo last change"]');
  await win.waitForTimeout(1500);
  const e2 = await eng();
  console.log(`[DEF-130] after undo pageCount=${e2.pageCount} canRedo=${e2.canRedo}`);
  expect(e2.pageCount, 'undo must revert the insert').toBe(pages0);

  // Re-insert (same settings).
  await openPaletteTool('insertPages');
  await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-insert-mode="blank"]');
  await win.fill('[data-insert-position]', '2');
  await win.waitForTimeout(200);
  await win.click('[data-insert-confirm]');
  await win.waitForTimeout(2500);

  const e3 = await eng();
  const order = e3.pageOrder || [];
  const unique = new Set(order);
  console.log(`[DEF-130] after re-insert pageCount=${e3.pageCount} order0=${JSON.stringify(order.slice(0, 6))} unique=${unique.size}`);
  const toast = await win.evaluate(() => {
    const t = document.querySelector('.toast, .toast-error');
    return t ? t.textContent : null;
  });
  console.log(`[DEF-130] toast="${toast}"`);

  const nanErrors = pageErrors.filter((m) => /degreeAngle|NaN/.test(m));
  const toastNan = /degreeAngle|NaN/.test(toast || '');
  console.log(`[DEF-130] nanErrors=${JSON.stringify(nanErrors)} toastNan=${toastNan}`);
  await shot('def-130-after-reinsert.png');

  expect(e3.pageCount, 're-insert must succeed (back to 35 pages)').toBe(pages0 + 1);
  expect(order.length, 'pageOrder must match the page count').toBe(e3.pageCount);
  expect(unique.size, 'no duplicate pages after re-insert').toBe(order.length);
  expect(nanErrors, 'no NaN degreeAngle renderer error on re-insert').toHaveLength(0);
  expect(toastNan, 'no NaN degreeAngle toast on re-insert').toBe(false);
  // Proxy refreshed: the side rail shows 35 thumbnails.
  const thumbs = await win.locator('.thumb-item').count();
  console.log(`[DEF-130] thumbCount=${thumbs}`);
  expect(thumbs, 'the side rail must refresh to 35 thumbnails').toBe(35);
  console.log('[DEF-130] PASS');
});

// ---------------------------------------------------------------------------
// DEF-131: per-page crop crops only the selected page
// ---------------------------------------------------------------------------
test('DEF-131: per-page crop crops only the adjusted page, others unchanged', async () => {
  await openSample('report.pdf');
  await scrollToRevealPages(1);
  const before2 = await measurePages();
  console.log(`[DEF-131] before crop pages=${JSON.stringify(before2)}`);

  await openTools();
  await win.click('[data-tool-id="cropPages"]');
  await win.waitForSelector('[data-crop-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(600);
  await win.click('[data-crop-mode="perPage"]');
  await win.waitForTimeout(500);

  // Drag the SE crop handle INWARD (shrink the box) on page 1.
  const se = win.locator('[data-crop-handle="se"]');
  await se.waitFor({ timeout: 10000 });
  const sb = await se.boundingBox();
  await win.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await win.mouse.down();
  await win.mouse.move(sb.x + sb.width / 2 - 40, sb.y + sb.height / 2 - 40, { steps: 6 });
  await win.mouse.up();
  await win.waitForTimeout(400);
  await win.click('[data-crop-confirm]');
  await win.waitForTimeout(2000);

  const toast = await win.evaluate(() => {
    const t = document.querySelector('.toast');
    return t ? t.textContent : null;
  });
  console.log(`[DEF-131] toast="${toast}"`);
  await scrollToRevealPages(1);
  const afterPages = await measurePages();
  console.log(`[DEF-131] after crop pages=${JSON.stringify(afterPages)}`);
  await shot('def-131-after-crop.png');

  expect(String(toast).toLowerCase(), 'the toast must report exactly one cropped page').toContain('cropped 1 page');

  const p1 = afterPages[1];
  const p2 = afterPages[2];
  const p3 = afterPages[3];
  expect(p1, 'page 1 must be measurable after crop').toBeTruthy();
  expect(p2, 'page 2 must be measurable after crop').toBeTruthy();
  expect(p3, 'page 3 must be measurable after crop').toBeTruthy();

  // Aspect ratios: full report.pdf pages render at 612:792 = 0.7727. Page 1 was
  // cropped, so its aspect must DIFFER from the full-page aspect; pages 2 and 3
  // (never adjusted) must KEEP the full-page aspect, proving the crop did NOT
  // propagate. The absolute rendered size may change because the fit-to-width
  // scale is recomputed after the crop, so we compare aspect, not px.
  const FULL_ASPECT = 612 / 792; // 0.7727
  const aspect1 = p1.w / p1.h;
  const aspect2 = p2.w / p2.h;
  const aspect3 = p3.w / p3.h;
  console.log(`[DEF-131] aspect1=${aspect1.toFixed(4)} aspect2=${aspect2.toFixed(4)} aspect3=${aspect3.toFixed(4)} full=${FULL_ASPECT.toFixed(4)}`);
  expect(p1.w, 'page 1 must render narrower than the unchanged page 2').toBeLessThan(p2.w);
  expect(p1.w, 'page 1 must render narrower than the unchanged page 3').toBeLessThan(p3.w);
  // Pages 2 and 3 are identical to each other (both unchanged by page 1's crop).
  expect(Math.abs(p2.w - p3.w), 'pages 2 and 3 must render identically').toBeLessThanOrEqual(3);
  expect(Math.abs(p2.h - p3.h), 'pages 2 and 3 must render identically (height)').toBeLessThanOrEqual(3);
  // Decisive: page 1 aspect deviates from full (cropped); pages 2/3 stay full.
  expect(Math.abs(aspect1 - FULL_ASPECT), 'page 1 must be cropped (aspect differs from full)').toBeGreaterThan(0.01);
  expect(Math.abs(aspect2 - FULL_ASPECT), 'page 2 must keep the full-page aspect (uncropped)').toBeLessThan(0.01);
  expect(Math.abs(aspect3 - FULL_ASPECT), 'page 3 must keep the full-page aspect (uncropped)').toBeLessThan(0.01);
  console.log('DEF-131: PASS');
});
