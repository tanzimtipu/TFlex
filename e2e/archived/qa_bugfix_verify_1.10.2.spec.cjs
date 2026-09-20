// qa verification of the 7 reported bug fixes (v1.10.2 working tree,
// orchestrator dispatch 2026-09-06). Drives the real app through each
// reported symptom:
//   B1  Edit button disarms an armed sticky-note tool.
//   B4  Escape disarms the armed tool (and search Escape still closes).
//   B3  double-click opens the note editor (single click selects only);
//       dragging the toolbox moves the annotation with it; Confirm
//       commits the content at the dragged position.
//   B2  moving a note leaves NO artifacts at the original position
//       (single note element, engine count 1, position == dragged one).
//   B5  Ctrl+Z undoes a placed stamp (DOM mirror + baked pixels gone).
//   B6  placed stamp is selectable / movable / resizable / deletable /
//       retypeable, with the engine re-bake following every commit.
//   B7  Export to Word produces a .docx whose pages look like the PDF
//       (per-page full-page image) — recorded against the DEF-060
//       editable-text contract conflict.

const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

async function openReport(win, electronApp) {
  const card = win.locator('.sample-card:has-text("report.pdf")');
  if (await card.count()) {
    await card.first().click();
  } else {
    await electronApp.evaluate(async ({ dialog }, samplePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [samplePath] });
    }, getSamplePath('report.pdf'));
    await win.click('button:has-text("Open PDF")');
  }
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page[data-page="1"]', { timeout: 30000 });
  await win.waitForTimeout(800);
}

/** Page point clamped to the VISIBLE (in-viewport) portion of page 1 —
 *  points below the fold are dead coordinates (elementsFromPoint = []). */
async function pagePoint(win, fx, fy) {
  const box = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vh = await win.evaluate(() => window.innerHeight);
  const visTop = Math.max(box.y, 80);
  const visBottom = Math.min(box.y + box.height, vh - 40);
  if (visBottom - visTop < 120) throw new Error('page 1 has no visible area');
  return { x: box.x + box.width * fx, y: visTop + (visBottom - visTop) * fy };
}

async function engineAnnCount(win) {
  const d = await win.evaluate(() => window.tflexDiagnostics());
  return d && d.engineState ? d.engineState.annotations.length : null;
}

/** Phase 19/20 repoint — the annotation tools moved into the CommandBar's
 *  MRU group plus the portaled all-tools menu; the old standalone
 *  `button[data-tool="note"]` no longer exists. Same intent: arm the note
 *  tool. */
async function armNote(win) {
  const visible = win.locator('[data-ann-tools-visible] button[data-tool="note"]');
  if ((await visible.count()) > 0) {
    await visible.first().click();
  } else {
    await win.click('[data-ann-dropdown-toggle]');
    await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'visible', timeout: 8000 });
    await win.click('[data-ann-dropdown-menu] button[data-tool="note"]');
    await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'detached', timeout: 8000 });
  }
  await win.waitForTimeout(300);
}

/** Drag from (x,y) by (dx,dy) with real mouse events. */
async function dragBy(win, from, dx, dy, steps = 12) {
  await win.mouse.move(from.x, from.y);
  await win.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await win.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps);
  }
  await win.mouse.up();
}

/** Count non-white pixels in a page-relative CSS-rect region of page 1's
 *  canvas (the raster the engine bakes into — DOM-independent evidence).
 *  The canvas bitmap may be rendered at devicePixelRatio scale, so the
 *  CSS rect is mapped through canvas.width / canvas.clientWidth. */
async function canvasColoredPixels(win, rect) {
  return win.evaluate(([r]) => {
    const page = document.querySelector('.pdf-page[data-page="1"]');
    const canvas = page ? page.querySelector('canvas') : null;
    if (!canvas) return -1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return -2;
    const kx = canvas.width / canvas.clientWidth;
    const ky = canvas.height / canvas.clientHeight;
    const sx = Math.max(0, Math.round(r.x * kx));
    const sy = Math.max(0, Math.round(r.y * ky));
    const sw = Math.max(1, Math.min(canvas.width - sx, Math.round(r.width * kx)));
    const sh = Math.max(1, Math.min(canvas.height - sy, Math.round(r.height * ky)));
    const img = ctx.getImageData(sx, sy, sw, sh).data;
    let colored = 0;
    for (let i = 0; i < img.length; i += 4) {
      const [rr, gg, bb] = [img[i], img[i + 1], img[i + 2]];
      if (rr < 235 || gg < 235 || bb < 235) colored++;
    }
    return colored;
  }, [{ x: rect.x, y: rect.y, width: rect.width, height: rect.height }]);
}

/** Place an APPROVED stamp via the tools palette and return its DOM
 *  bbox + the page canvas rect it covers. Closes the palette right
 *  after picking the tool — the palette floats over the page's right
 *  side and would swallow the placement click / later resize-handle
 *  drags near it. */
async function placeStamp(win) {
  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 10000 });
  await win.click('[data-tool-id="stamp"]');
  await win.waitForSelector('[data-stamp-dialog]', { timeout: 10000 });
  await win.click('[data-stamp-confirm]');
  await win.waitForTimeout(500);
  // Close the tools palette so it never covers the page gestures.
  const paletteCount = await win.locator('[data-tools-palette]').count();
  if (paletteCount > 0) {
    await win.click('[data-tools-toggle]');
    await win.waitForTimeout(300);
  }
  const at = await pagePoint(win, 0.45, 0.5);
  await win.mouse.click(at.x, at.y);
  await win.waitForSelector('.stamp-annotation', { timeout: 10000 });
  await win.waitForTimeout(1200); // engine bake + proxy refresh
  const bbox = await win.locator('.stamp-annotation').first().boundingBox();
  // Canvas coordinates: page-relative CSS px (canvasColoredPixels maps
  // them onto the bitmap scale itself).
  const canvasRect = {
    x: bbox.x - 0, // filled below via the page box
    y: bbox.y - 0,
    width: bbox.width,
    height: bbox.height,
  };
  const pageBox = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  canvasRect.x = bbox.x - pageBox.x;
  canvasRect.y = bbox.y - pageBox.y;
  return { bbox, canvasRect };
}

async function createNote(win, text) {
  await armNote(win);
  const at = await pagePoint(win, 0.5, 0.75);
  await win.mouse.click(at.x, at.y);
  await win.waitForSelector('[data-annotation-editor="note"]', { timeout: 10000 });
  await win.locator('[data-annotation-editor="note"] textarea').fill(text);
  await win.click('[data-annotation-action="note-confirm"]');
  await win.waitForSelector('.ann-note[data-kind="note"]', { timeout: 10000 });
  await win.waitForTimeout(600);
}

test('B1: Edit button disarms an armed sticky-note tool', async () => {
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await win.waitForTimeout(1200);
  await openReport(win, electronApp);

  // Arm the sticky note tool.
  await armNote(win);
  const toolArmed = await win.evaluate(
    () => document.querySelector('.annotation-layer')?.getAttribute('data-tool'),
  );
  console.log('[B1] annotation tool after arming note =', toolArmed);
  expect(toolArmed).toBe('note');

  // Click the Edit button on the toolbar.
  await win.click('button[aria-label="Edit content"]');
  await win.waitForTimeout(500);

  const toolAfter = await win.evaluate(
    () => document.querySelector('.annotation-layer')?.getAttribute('data-tool'),
  );
  const editToolbar = await win.locator('[data-edit-toolbar]').count();
  console.log('[B1] annotation tool after Edit click =', toolAfter, 'edit toolbar count =', editToolbar);
  expect(editToolbar, 'Edit mode must actually open').toBeGreaterThan(0);
  expect(
    toolAfter,
    'the sticky-note tool must be disarmed when Edit opens (was: stayed armed)',
  ).toBe('select');

  // Closing Edit keeps the tool disarmed (no stale re-arm).
  await win.click('button[aria-label="Edit content"]');
  await win.waitForTimeout(400);
  const toolClosed = await win.evaluate(
    () => document.querySelector('.annotation-layer')?.getAttribute('data-tool'),
  );
  console.log('[B1] annotation tool after closing Edit =', toolClosed);
  expect(toolClosed).toBe('select');

  // And a page click must not create a note anymore.
  const at = await pagePoint(win, 0.5, 0.75);
  await win.mouse.click(at.x, at.y);
  await win.waitForTimeout(600);
  const noteCount = await win.locator('.ann-note').count();
  const eng = await engineAnnCount(win);
  console.log('[B1] .ann-note after page click =', noteCount, 'engine anns =', eng);
  expect(noteCount).toBe(0);
  expect(eng).toBe(0);
  await win.screenshot({ path: 'screenshots/qa-1102-b1-edit-disarms-note.png' });
  await hardClose(electronApp, 'qa1102');
});

test('B4: Escape disarms the armed tool; search Escape still closes search', async () => {
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await win.waitForTimeout(1200);
  await openReport(win, electronApp);

  await armNote(win);
  expect(
    await win.evaluate(() => document.querySelector('.annotation-layer')?.getAttribute('data-tool')),
  ).toBe('note');

  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);
  const toolAfter = await win.evaluate(
    () => document.querySelector('.annotation-layer')?.getAttribute('data-tool'),
  );
  console.log('[B4] tool after Escape =', toolAfter);
  expect(toolAfter, 'Escape must disarm the armed note tool').toBe('select');

  // The disarm must stick: a page click creates nothing.
  const at = await pagePoint(win, 0.5, 0.75);
  await win.mouse.click(at.x, at.y);
  await win.waitForTimeout(600);
  const noteCount = await win.locator('.ann-note').count();
  const eng = await engineAnnCount(win);
  console.log('[B4] .ann-note after post-Escape page click =', noteCount, 'engine anns =', eng);
  expect(noteCount).toBe(0);
  expect(eng).toBe(0);

  // Regression: Escape with the search bar open still closes search.
  await win.keyboard.press('Control+f');
  await win.waitForTimeout(300);
  const searchOpen = await win.locator('.search-bar').count();
  console.log('[B4] search bar open after Ctrl+F =', searchOpen);
  await win.keyboard.press('Escape');
  // Phase 20 — the search bar now runs a token exit (TfBar) and unmounts at
  // the end of it (~361ms), so a fixed 300ms sample caught it mid-exit.
  // Wait for the AnimatePresence removal instead of a fixed delay.
  await win.waitForSelector('.search-bar', { state: 'detached', timeout: 4000 });
  const searchAfter = await win.locator('.search-bar').count();
  console.log('[B4] search bar after Escape =', searchAfter);
  expect(searchOpen).toBeGreaterThan(0);
  expect(searchAfter, 'Escape must still close the search bar').toBe(0);
  await hardClose(electronApp, 'qa1102');
});

test('B3: double-click edits the note (single click selects); dragging the toolbox moves the annotation; Confirm lands it at the dragged position', async () => {
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await win.waitForTimeout(1200);
  await openReport(win, electronApp);

  await createNote(win, 'VERIFY BUG3');
  const icon = win.locator('.ann-note[data-kind="note"]').first();
  const bbox0 = await icon.boundingBox();
  console.log('[B3] committed note icon bbox =', JSON.stringify(bbox0));

  // --- single click SELECTS, must NOT open the editor ---
  await icon.click();
  await win.waitForTimeout(400);
  let editorCount = await win.locator('[data-annotation-editor="note"]').count();
  const selectedFrame = await win.locator('[data-content-selection-frame]').count();
  console.log('[B3] editor after single click =', editorCount, 'selection frame =', selectedFrame);
  expect(editorCount, 'single click must NOT open the note editor').toBe(0);
  expect(selectedFrame, 'single click must select the note (selection chrome)').toBeGreaterThan(0);

  // Deselect via a blank-page press.
  const blank = await pagePoint(win, 0.3, 0.6);
  await win.mouse.click(blank.x, blank.y);
  await win.waitForTimeout(300);

  // --- double click opens the editor ---
  await icon.dblclick();
  await win.waitForTimeout(400);
  editorCount = await win.locator('[data-annotation-editor="note"]').count();
  console.log('[B3] editor after double click =', editorCount);
  expect(editorCount, 'double click must open the note editor').toBe(1);
  const editorText = await win.locator('[data-annotation-editor="note"] textarea').inputValue();
  console.log('[B3] editor pre-filled text =', JSON.stringify(editorText));
  expect(editorText).toBe('VERIFY BUG3');
  const iconHidden = await win.locator('.ann-note[data-kind="note"]').count();
  console.log('[B3] committed icon while editor open =', iconHidden);
  expect(iconHidden, 'the toolbox IS the content: the page icon is suppressed while editing').toBe(0);

  // --- dragging the toolbox moves the annotation with it ---
  const grip = win.locator('[data-annotation-editor="note"] .content-grip').first();
  const gb = await grip.boundingBox();
  await dragBy(win, { x: gb.x + gb.width / 2, y: gb.y + gb.height / 2 }, 60, 40);
  await win.waitForTimeout(300);
  const editorBox = await win.locator('[data-annotation-editor="note"]').boundingBox();
  console.log('[B3] editor bbox after drag =', JSON.stringify(editorBox));
  await win.screenshot({ path: 'screenshots/qa-1102-b3-toolbox-dragged.png' });

  // --- Confirm commits the content at the dragged position ---
  await win.click('[data-annotation-action="note-confirm"]');
  await win.waitForSelector('.ann-note[data-kind="note"]', { timeout: 10000 });
  await win.waitForTimeout(1200); // delete+create echo
  const bbox1 = await win.locator('.ann-note[data-kind="note"]').first().boundingBox();
  console.log('[B3] note icon bbox after confirm =', JSON.stringify(bbox1));
  const count = await win.locator('.ann-note[data-kind="note"]').count();
  const eng = await engineAnnCount(win);
  console.log('[B3] note count =', count, 'engine anns =', eng);
  expect(count, 'exactly one note after the toolbox-drag commit').toBe(1);
  expect(eng).toBe(1);
  expect(Math.abs(bbox1.x - (bbox0.x + 60)), 'icon must move with the toolbox drag dx').toBeLessThan(5);
  expect(Math.abs(bbox1.y - (bbox0.y + 40)), 'icon must move with the toolbox drag dy').toBeLessThan(5);
  await win.screenshot({ path: 'screenshots/qa-1102-b3-after-toolbox-confirm.png' });
  await hardClose(electronApp, 'qa1102');
});

test('B2: dragging a note on the page and confirming leaves NO artifact at the original position', async () => {
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await win.waitForTimeout(1200);
  await openReport(win, electronApp);

  await createNote(win, 'VERIFY BUG2 MOVE');
  const icon = win.locator('.ann-note[data-kind="note"]').first();
  const bbox0 = await icon.boundingBox();
  console.log('[B2] note bbox before move =', JSON.stringify(bbox0));

  // Single click to select, then drag the icon on the page.
  await icon.click();
  await win.waitForTimeout(300);
  const b = await icon.boundingBox();
  await dragBy(win, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, 90, 50);
  await win.waitForTimeout(300);
  await win.screenshot({ path: 'screenshots/qa-1102-b2-dragged-pending.png' });

  // Confirm the pending move.
  await win.click('[data-content-action="ann-note-confirm"]');
  await win.waitForTimeout(1500); // delete+create round-trip + echo drop

  const count = await win.locator('.ann-note[data-kind="note"]').count();
  const eng = await engineAnnCount(win);
  const bbox1 = await win.locator('.ann-note[data-kind="note"]').first().boundingBox();
  console.log('[B2] note count after confirm =', count, 'engine anns =', eng);
  console.log('[B2] note bbox after confirm =', JSON.stringify(bbox1));
  expect(count, 'exactly ONE note on the page — no artifact/duplicate at the old position').toBe(1);
  expect(eng, 'engine holds exactly one note').toBe(1);
  expect(Math.abs(bbox1.x - (bbox0.x + 90)), 'note landed at the dragged position (dx)').toBeLessThan(5);
  expect(Math.abs(bbox1.y - (bbox0.y + 50)), 'note landed at the dragged position (dy)').toBeLessThan(5);
  await win.screenshot({ path: 'screenshots/qa-1102-b2-after-confirm.png' });
  await hardClose(electronApp, 'qa1102');
});

test('B5: Ctrl+Z undoes a placed stamp (DOM surface and baked pixels gone)', async () => {
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await win.waitForTimeout(1200);
  await openReport(win, electronApp);

  const { bbox, canvasRect } = await placeStamp(win);
  console.log('[B5] placed stamp bbox =', JSON.stringify(bbox));
  const coloredBefore = await canvasColoredPixels(win, canvasRect);
  console.log('[B5] canvas colored pixels under stamp before undo =', coloredBefore);
  expect(coloredBefore, 'the stamp bake must be visible on the page canvas').toBeGreaterThan(200);
  await win.screenshot({ path: 'screenshots/qa-1102-b5-stamp-placed.png' });

  await win.keyboard.press('Control+z');
  await win.waitForTimeout(2000); // undo + proxy refresh re-render

  const domCount = await win.locator('.stamp-annotation').count();
  const coloredAfter = await canvasColoredPixels(win, canvasRect);
  const eng = await engineAnnCount(win);
  console.log('[B5] .stamp-annotation after undo =', domCount, 'canvas colored pixels =', coloredAfter, 'engine anns =', eng);
  expect(domCount, 'the placed-stamp DOM mirror must drop on undo').toBe(0);
  expect(coloredAfter, 'the baked stamp pixels must be reverted on the canvas').toBeLessThan(50);
  await win.screenshot({ path: 'screenshots/qa-1102-b5-after-undo.png' });

  // Redo re-applies the bake: pixels return, no ghost DOM surface
  // (the mirror stays cleared — the canvas is the source of truth).
  await win.keyboard.press('Control+Shift+z');
  await win.waitForTimeout(2000);
  const domAfterRedo = await win.locator('.stamp-annotation').count();
  const coloredRedo = await canvasColoredPixels(win, canvasRect);
  console.log('[B5] after redo: .stamp-annotation =', domAfterRedo, 'canvas colored =', coloredRedo);
  expect(domAfterRedo, 'no ghost stamp DOM surface may outlive the mirror drop').toBe(0);
  expect(coloredRedo, 'redo must re-apply the baked stamp pixels').toBeGreaterThan(200);
  await hardClose(electronApp, 'qa1102');
});

test('B6: placed stamp is selectable, movable, resizable, retypeable and deletable', async () => {
  test.setTimeout(120000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await win.waitForTimeout(1200);
  await openReport(win, electronApp);

  let { bbox, canvasRect } = await placeStamp(win);
  const oldRect = canvasRect;

  // --- SELECT ---
  await win.locator('.stamp-annotation').first().click();
  await win.waitForTimeout(300);
  const selected = await win.evaluate(
    () => document.querySelector('.stamp-annotation')?.getAttribute('data-stamp-selected'),
  );
  const bar = await win.locator('[data-content-action-bar="stamp"]').count();
  console.log('[B6] selected =', selected, 'action bar =', bar);
  expect(selected, 'clicking a stamp must select it').toBe('true');
  expect(bar, 'the Confirm/Edit/Delete action bar must appear').toBe(1);
  await win.screenshot({ path: 'screenshots/qa-1102-b6-selected.png' });

  // --- MOVE + Confirm ---
  const b = await win.locator('.stamp-annotation').first().boundingBox();
  await dragBy(win, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, 70, 40);
  await win.waitForTimeout(300);
  await win.click('[data-content-action="stamp-confirm"]');
  await win.waitForTimeout(2000); // engine re-bake + mirror echo
  const moved = await win.locator('.stamp-annotation').first().boundingBox();
  console.log('[B6] stamp bbox after move =', JSON.stringify(moved));
  expect(Math.abs(moved.x - (bbox.x + 70)), 'stamp must move by the drag dx').toBeLessThan(6);
  expect(Math.abs(moved.y - (bbox.y + 40)), 'stamp must move by the drag dy').toBeLessThan(6);
  // Engine re-bake evidence: sample the strip of the OLD rect that the
  // moved stamp no longer covers (left strip, dx wide) — it must be
  // masked back to white — and the new position, which must carry the
  // bake. (Sampling the whole old rect would be wrong: it overlaps the
  // new position by ~78%.)
  const oldStripColored = await canvasColoredPixels(win, {
    x: oldRect.x, y: oldRect.y, width: 70, height: oldRect.height,
  });
  const newCanvasRect = {
    x: oldRect.x + 70, y: oldRect.y + 40, width: oldRect.width, height: oldRect.height,
  };
  const newColored = await canvasColoredPixels(win, newCanvasRect);
  console.log('[B6] canvas colored old-left-strip =', oldStripColored, 'new rect =', newColored);
  expect(oldStripColored, 'the vacated bake area must be masked back to white').toBeLessThan(100);
  expect(newColored, 'the stamp pixels must be baked at the new position').toBeGreaterThan(200);
  bbox = moved;
  canvasRect = newCanvasRect;

  // --- RESIZE + Confirm (se handle) ---
  await win.locator('.stamp-annotation').first().click();
  await win.waitForTimeout(300);
  const handle = win.locator('[data-stamp-resize-handle="se"]');
  expect(await handle.count(), 'corner resize handles must render').toBe(1);
  const hb = await handle.boundingBox();
  await dragBy(win, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, 40, 30);
  await win.waitForTimeout(300);
  // Diagnostic guard: if a phantom modal-backdrop appeared during the
  // resize drag, capture what it is before dismissing it.
  const phantom = await win.evaluate(() => {
    const b = document.querySelector('.modal-backdrop');
    if (!b) return null;
    const dlg = b.querySelector('.modal-dialog, .sheet, [data-stamp-dialog]');
    return {
      dialogCls: dlg ? dlg.className.slice(0, 100) : null,
      text: (b.textContent || '').slice(0, 150),
    };
  });
  if (phantom) {
    console.log('[B6] PHANTOM MODAL after resize drag =', JSON.stringify(phantom));
    await win.screenshot({ path: 'screenshots/qa-1102-b6-phantom-modal.png' });
    await win.keyboard.press('Escape');
    await win.waitForTimeout(500);
  }
  await win.click('[data-content-action="stamp-confirm"]');
  await win.waitForTimeout(2000);
  const resized = await win.locator('.stamp-annotation').first().boundingBox();
  console.log('[B6] stamp bbox after resize =', JSON.stringify(resized));
  expect(resized.width - bbox.width, 'width must grow by the se-handle drag dx').toBeGreaterThan(25);
  expect(resized.height - bbox.height, 'height must grow by the se-handle drag dy').toBeGreaterThan(15);

  // --- RETYPE (Edit -> DRAFT) ---
  await win.locator('.stamp-annotation').first().click();
  await win.waitForTimeout(300);
  await win.click('[data-content-action="stamp-edit"]');
  await win.waitForSelector('[data-stamp-type-editor]', { timeout: 10000 });
  await win.screenshot({ path: 'screenshots/qa-1102-b6-type-editor.png' });
  await win.click('[data-stamp-type-btn="DRAFT"]');
  await win.waitForTimeout(2000);
  const draft = await win.locator('.stamp-annotation[data-stamp-id="DRAFT"]').count();
  const approved = await win.locator('.stamp-annotation[data-stamp-id="APPROVED"]').count();
  console.log('[B6] after retype: DRAFT =', draft, 'APPROVED =', approved);
  expect(draft, 'the retype must swap the stamp id to DRAFT').toBe(1);
  expect(approved).toBe(0);

  // --- DELETE ---
  await win.locator('.stamp-annotation').first().click();
  await win.waitForTimeout(300);
  await win.click('[data-content-action="stamp-delete"]');
  await win.waitForTimeout(2000);
  const remaining = await win.locator('.stamp-annotation').count();
  const coloredAfterDelete = await canvasColoredPixels(win, {
    x: moved.x, y: moved.y, width: resized.width, height: resized.height,
  });
  console.log('[B6] after delete: .stamp-annotation =', remaining, 'canvas colored =', coloredAfterDelete);
  expect(remaining, 'the deleted stamp must leave the DOM').toBe(0);
  expect(coloredAfterDelete, 'the deleted stamp pixels must be masked on the canvas').toBeLessThan(80);
  await win.screenshot({ path: 'screenshots/qa-1102-b6-after-delete.png' });
  await hardClose(electronApp, 'qa1102');
});

test('B7: Export to Word produces a .docx that looks like the PDF (per-page full-page image)', async () => {
  test.setTimeout(180000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await win.waitForTimeout(1200);
  const savePath = path.join(os.tmpdir(), `qa1102-b7-${Date.now()}.docx`);

  await electronApp.evaluate(({ BrowserWindow }, opts) => {
    const bw = BrowserWindow.getAllWindows()[0];
    const sess = bw && bw.webContents ? bw.webContents.session : null;
    global.__QA1102B7__ = { started: false, state: null, registerError: null };
    if (!sess) { global.__QA1102B7__.registerError = 'no session'; return; }
    sess.on('will-download', (event, item) => {
      global.__QA1102B7__.started = true;
      item.setSavePath(opts.savePath);
      item.once('done', (e, state) => { global.__QA1102B7__.state = state; });
    });
  }, { savePath });

  await openReport(win, electronApp);

  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 10000 });
  await win.click('[data-tool-id="exportDocx"]');
  await win.waitForSelector('[data-docx-export-dialog]', { timeout: 10000 });
  await win.click('[data-docx-export-confirm]');

  let info = null;
  for (let i = 0; i < 60; i++) {
    await win.waitForTimeout(1000);
    info = await electronApp.evaluate(() => global.__QA1102B7__);
    if (info && info.state) break;
  }
  console.log('[B7] download info =', JSON.stringify(info));

  const exists = fs.existsSync(savePath);
  let size = exists ? fs.statSync(savePath).size : 0;
  let isZip = false;
  if (exists) {
    const head = fs.readFileSync(savePath);
    isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  }
  console.log('[B7] docx exists =', exists, 'size =', size, 'zip =', isZip);
  expect(info && info.registerError).toBeNull();
  expect(info && info.state, 'download must complete').toBe('completed');
  expect(exists, 'a .docx must be produced').toBe(true);
  expect(size).toBeGreaterThan(0);
  expect(isZip, 'the .docx must be a valid OOXML zip').toBe(true);

  // Inspect the OOXML: count text runs vs embedded page images.
  const outDir = path.join(os.tmpdir(), `qa1102-b7-unzip-${Date.now()}`);
  fs.mkdirSync(outDir, { recursive: true });
  execFileSync('tar', ['-xf', savePath, '-C', outDir]);
  const docXml = fs.readFileSync(path.join(outDir, 'word', 'document.xml'), 'utf8');
  const textRuns = (docXml.match(/<w:t[ >]/g) || []).length;
  const drawings = (docXml.match(/<w:drawing[ >]/g) || []).length;
  const pageBreaks = (docXml.match(/w:br w:type="page"/g) || []).length;
  const mediaDir = path.join(outDir, 'word', 'media');
  const media = fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir) : [];
  console.log('[B7] OOXML: textRuns =', textRuns, 'drawings =', drawings, 'pageBreaks =', pageBreaks, 'media files =', media.length, media.join(','));
  expect(drawings + media.length, 'the export must embed the page raster(s) — the layout-identical path').toBeGreaterThan(0);

  // Record the editable-text situation explicitly: this build prefers
  // the raster assembly (Bug 7 "looks identical" contract), which
  // reverses DEF-060's text-first preference. No assertion here — the
  // conflict is reported to the orchestrator (sweep X1 asserts the
  // opposite contract and will fail).
  console.log('[B7] NOTE textRuns =', textRuns, '(0 = image-only docx, DEF-060 editable-text contract reversed)');

  await win.screenshot({ path: 'screenshots/qa-1102-b7-docx-export.png' });
  await hardClose(electronApp, 'qa1102');
});
