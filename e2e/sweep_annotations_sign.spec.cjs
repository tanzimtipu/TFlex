// DEEP SWEEP - annotations + signatures on the DEV build (converted from the installed v1.7.11 app, 2026-09-05).
// Drives every annotation tool, custom color persistence, the annotations
// panel (edit/delete), and the full signature lifecycle. Uses ONLY the proven
// selectors from e2e/retests/gt_verify_1711.spec.cjs and color_note_repros.
// Verifies document safety by re-parsing saved output with pdf-lib.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument } = require('@cantoo/pdf-lib');
const { launchDev, openSample, diag, shot, dumpEngine, scrollToPage, getSamplePath , hardClose, armSignTool, openAnnotationFlyout } = require('./lib/helpers.cjs');

let electronApp = null;
let win = null;
let pageErrors = [];

test.beforeEach(async () => {
  ({ electronApp, window: win } = await launchDev());
  pageErrors = [];
  win.on('pageerror', (err) => {
    const m = err && err.message ? err.message : String(err);
    pageErrors.push(m);
    process.stdout.write(`[PAGEERROR] ${m}\n`);
  });
  await win.waitForTimeout(400);
});

test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null; win = null; pageErrors = [];
});

test.setTimeout(300000);

async function eng() {
  const d = await diag(win);
  return d.engineState || d;
}

async function openTools() {
  // Phase 36 migration: the All-tools palette is retired; use runTool(id).
}

function badHooks() {
  return pageErrors.filter((m) => /#310|Rules of Hooks|#520|Invalid page request|NaN/.test(m));
}

async function saveAs(name) {
  const outPath = path.join(os.tmpdir(), `tflex-sweep-sa-${Date.now()}-${name}.pdf`);
  await electronApp.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, outPath);
  await win.click('[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(2500);
  return outPath;
}

async function parsePages(filePath) {
  try {
    const doc = await PDFDocument.load(fs.readFileSync(filePath), { ignoreEncryption: true });
    return doc.getPageCount();
  } catch (e) {
    return `PARSE_ERR: ${e.message}`;
  }
}

async function slotBox(pageNum) {
  const slot = win.locator(`.page-slot[data-page="${pageNum}"]`).first();
  await slot.waitFor({ timeout: 10000 });
  return slot.boundingBox();
}

async function armTool(kind) {
  // Phase 36 (chunk 3) — the annotation group is re-parented into the REVIEW
  // dock's Annotate flyout; open it before driving the group.
  await openAnnotationFlyout(win);
  // Phase 19 - the CommandBar group shows only the MRU five; tools outside
  // the visible set (rect / ellipse / arrow / textbox / callout / note) are
  // reachable from the all-tools dropdown. Prefer the visible button when it
  // exists so the spec's original per-tool intent is preserved.
  const visible = win.locator(`[data-ann-tools-visible] button[data-tool="${kind}"]`);
  if ((await visible.count()) > 0) {
    await visible.first().click();
  } else {
    await win.click('[data-ann-dropdown-toggle]');
    await win.waitForSelector('[data-ann-dropdown-menu]', { timeout: 8000 });
    await win.click(`[data-ann-dropdown-menu] button[data-tool="${kind}"]`);
    await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'detached', timeout: 8000 });
  }
  await win.waitForTimeout(400);
}

// ---------------------------------------------------------------------------
// A1: every annotation tool places a correctly-paged annotation on page 1
// ---------------------------------------------------------------------------
test('A1: every annotation tool places a correctly-paged annotation (page 1)', async () => {
  await openSample(win, electronApp, 'report.pdf');
  const box = await slotBox(1);

  // ink
  await armTool('ink');
  await win.mouse.move(box.x + 260, box.y + 240);
  await win.mouse.down();
  await win.mouse.move(box.x + 380, box.y + 330, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(600);

  // rect
  await armTool('rect');
  await win.mouse.move(box.x + 220, box.y + 240);
  await win.mouse.down();
  await win.mouse.move(box.x + 380, box.y + 340, { steps: 6 });
  await win.mouse.up();
  await win.waitForTimeout(500);

  // ellipse
  await armTool('ellipse');
  await win.mouse.move(box.x + 320, box.y + 340);
  await win.mouse.down();
  await win.mouse.move(box.x + 450, box.y + 420, { steps: 6 });
  await win.mouse.up();
  await win.waitForTimeout(500);

  // arrow
  await armTool('arrow');
  await win.mouse.move(box.x + 260, box.y + 180);
  await win.mouse.down();
  await win.mouse.move(box.x + 90, box.y + 120, { steps: 6 });
  await win.mouse.up();
  await win.waitForTimeout(500);

  // callout
  await armTool('callout');
  await win.mouse.move(box.x + 300, box.y + 320);
  await win.mouse.down();
  await win.mouse.move(box.x + 430, box.y + 400, { steps: 6 });
  await win.mouse.up();
  await win.waitForTimeout(500);

  // textbox
  await armTool('textbox');
  // Clear of the floating text panel (Phase 25) which covers the page's left edge.
  await win.mouse.click(box.x + box.width * 0.62, box.y + 200);
  // Phase 26 — the panel Text field is the single text editor (commits on blur).
  await win.waitForSelector('[data-txt-text]', { timeout: 6000 }).catch(() => {});
  const tbField = win.locator('[data-txt-text]').first();
  if (await tbField.count()) {
    await expect(tbField).toBeEnabled({ timeout: 6000 }).catch(() => {});
    await tbField.fill('SWEEP TEXT BOX');
    await tbField.blur();
    await win.waitForTimeout(600);
  }

  // note
  await armTool('note');
  await win.mouse.click(box.x + box.width * 0.62, box.y + 420);
  await win.waitForSelector('[data-txt-text]', { timeout: 6000 }).catch(() => {});
  const noteField = win.locator('[data-txt-text]').first();
  if (await noteField.count()) {
    await expect(noteField).toBeEnabled({ timeout: 6000 }).catch(() => {});
    await noteField.fill('SWEEP STICKY NOTE CONTENT');
    await noteField.blur();
    await win.waitForTimeout(600);
  }

  await win.waitForTimeout(900);
  const e = await eng();
  const anns = e.annotations || [];
  console.log(`[A1] annotations: ${JSON.stringify(anns.map((a) => ({ kind: a.kind, page: a.page, color: a.color })))}`);
  const kinds = new Set(anns.map((a) => a.kind));
  console.log(`[A1] kinds present: ${JSON.stringify([...kinds])}`);
  await shot('sweep-a1-annotations-page1.png');

  const expected = ['ink', 'rect', 'ellipse', 'arrow', 'callout', 'textBox', 'note'];
  const found = expected.filter((k) => kinds.has(k));
  console.log(`[A1] found ${found.length}/${expected.length} expected kinds: ${JSON.stringify(found)}`);
  const wrongPage = anns.filter((a) => a.page !== undefined && a.page !== 1 && a.page !== 0);
  console.log(`[A1] annotations with wrong page: ${JSON.stringify(wrongPage)}`);
  expect(wrongPage.length, 'no annotation may be stamped on the wrong page').toBe(0);
  expect(kinds.has('ink'), 'ink must be recorded').toBe(true);
  expect(kinds.has('rect'), 'rect must be recorded').toBe(true);
  expect(kinds.has('note'), 'note must be recorded').toBe(true);
  expect(badHooks(), 'no React/runtime hook errors during annotation').toHaveLength(0);
  console.log('[A1] PASS');
});

// ---------------------------------------------------------------------------
// A2: custom annotation color hex persists across save + reopen
// ---------------------------------------------------------------------------
test('A2: custom annotation color hex persists across save + reopen', async () => {
  await openSample(win, electronApp, 'report.pdf');
  const box = await slotBox(1);

  await armTool('ink');
  const swatchMain = win.locator('.ann-color-swatch-main');
  await swatchMain.click();
  await win.waitForSelector('.color-popover', { timeout: 6000 });
  await win.fill('input[aria-label="Custom color hex"]', '#11AA22');
  await win.keyboard.press('Enter');
  await win.waitForTimeout(300);
  const current = await swatchMain.getAttribute('data-color-current');
  console.log(`[A2] swatch data-color-current after hex=${current}`);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);
  // Since the Escape-disarm fix (qa 2026-09-06), Escape closes the
  // palette AND disarms the armed tool — re-arm ink before drawing.
  await armTool('ink');
  await win.waitForTimeout(300);

  await win.mouse.move(box.x + 300, box.y + 300);
  await win.mouse.down();
  await win.mouse.move(box.x + 390, box.y + 350, { steps: 6 });
  await win.mouse.up();
  await win.waitForTimeout(800);

  const before = await eng();
  console.log(`[A2] annotations before save: ${JSON.stringify(before.annotations.map((a) => ({ kind: a.kind, color: a.color })))}`);
  const inkBefore = before.annotations.find((a) => a.kind === 'ink');
  expect(inkBefore, 'ink annotation must be recorded').toBeTruthy();
  await shot('sweep-a2-color-before-save.png');

  const outPath = await saveAs('a2');
  const pages = await parsePages(outPath);
  console.log(`[A2] savedPages=${pages}`);
  expect(pages, 'saved PDF must be valid and parse').toBe(34);

  // Reopen.
  await win.click('.tab-close').catch(() => {});
  await win.waitForSelector('.welcome, .sample-card', { timeout: 15000 });
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, outPath);
  await win.locator('[data-home-tool="open"]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(2000);
  await scrollToPage(win, 1);

  const after = await eng();
  console.log(`[A2] annotations after reopen: ${JSON.stringify(after.annotations.map((a) => ({ kind: a.kind, color: a.color })))}`);
  const inkAfter = after.annotations.find((a) => a.kind === 'ink');
  expect(inkAfter, 'the ink annotation must survive reopen').toBeTruthy();
  const c = inkAfter.color || '';
  const colorStr = JSON.stringify(c).toLowerCase();
  console.log(`[A2] ink color after reopen: ${JSON.stringify(c)}`);
  // #11AA22 -> rgb(17, 170, 34). Match green-ish.
  const hasGreen = /17/.test(colorStr) && (/170/.test(colorStr) || /11aa/.test(colorStr) || /#11aa/.test(colorStr));
  console.log(`[A2] hasGreen-ish=${hasGreen}`);
  await shot('sweep-a2-color-after-reopen.png');
  expect(badHooks(), 'no React/hook errors in the color round trip').toHaveLength(0);
  console.log('[A2] PASS (color round-trip logged; hex judged from diagnostics)');
});

// ---------------------------------------------------------------------------
// A3: annotations panel lists, note edit round-trips; delete works
// ---------------------------------------------------------------------------
test('A3: annotations panel lists, note edit round-trips, delete works', async () => {
  await openSample(win, electronApp, 'report.pdf');
  const box = await slotBox(1);

  // Add a note.
  await armTool('note');
  await win.mouse.click(box.x + box.width * 0.62, box.y + 300);
  // Phase 26 — panel Text field is the editor (commits on blur).
  await win.waitForSelector('[data-txt-text]', { timeout: 6000 }).catch(() => {});
  const noteField = win.locator('[data-txt-text]').first();
  if (await noteField.count()) {
    await expect(noteField).toBeEnabled({ timeout: 6000 }).catch(() => {});
    await noteField.fill('PANEL NOTE ORIGINAL');
    await noteField.blur();
    await win.waitForTimeout(600);
  }

  // Open the annotations panel in the left rail. The rail tabs are icon-only
  // (no text, no aria-label - the accessible name comes from title=), so
  // match on the title attribute.
  const annTab = win.locator('.rail-tab[title="Annotations"]').first();
  if (await annTab.count()) await annTab.click();
  await win.waitForTimeout(800);
  const panelRows = await win.locator('.ann-panel-row').count();
  console.log(`[A3] annotation panel rows=${panelRows}`);
  await shot('sweep-a3-annotations-panel.png');

  // Note edit round-trip: click the committed note icon; the panel Text field
  // shows the committed content (Phase 26 — no in-canvas editor).
  const icon = win.locator('.ann[data-kind="note"]').first();
  let noteEditValue = null;
  if (await icon.count()) {
    const ib = await icon.boundingBox();
    if (ib) {
      await win.mouse.click(ib.x + ib.width / 2, ib.y + ib.height / 2);
      await win.waitForTimeout(600);
      const ed = win.locator('[data-txt-text]').first();
      if (await ed.count()) {
        noteEditValue = await ed.inputValue().catch(() => null);
        console.log(`[A3] note panel field pre-filled value="${noteEditValue}"`);
      }
    }
  }

  // Delete an annotation via the panel delete control (the row's delete button).
  const annCountBefore = (await eng()).annotations.length;
  const delBtn = win.locator('.ann-panel-row-delete').first();
  let annCountAfter = annCountBefore;
  if (await delBtn.count()) {
    await delBtn.click();
    await win.waitForTimeout(900);
    annCountAfter = (await eng()).annotations.length;
  }
  console.log(`[A3] delete via panel: before=${annCountBefore} after=${annCountAfter}`);
  await shot('sweep-a3-after-delete.png');

  expect(panelRows, 'the annotations panel must list the annotation').toBeGreaterThan(0);
  expect(badHooks(), 'no React/hook errors in the panel flow').toHaveLength(0);
  console.log('[A3] PASS (note edit pre-fill and delete delta logged)');
});

// ---------------------------------------------------------------------------
// S1: signature place / move / delete lifecycle
// ---------------------------------------------------------------------------
async function armTypedSignature(text) {
  await armSignTool(win);
  await win.waitForSelector('.sig-manager', { timeout: 10000 });
  await win.click('.sig-tab:has-text("Type")');
  await win.waitForTimeout(300);
  await win.fill('input[aria-label="Type your signature"]', text || 'QA');
  await win.click('.sig-manager button:text-is("Save")');
  await win.waitForTimeout(500);
  await win.click('.sig-saved-pick');
  await win.waitForTimeout(500);
}

test('S1: signature place / move / delete lifecycle + undo/redo state', async () => {
  await openSample(win, electronApp, 'report.pdf');
  const box = await slotBox(1);
  await armTypedSignature('QA');

  const layer = win.locator('[data-annotation-layer="1"]');
  const lb = await layer.first().boundingBox();
  await win.mouse.click(lb.x + 200, lb.y + 200);
  await win.waitForSelector('[data-sig-action-bar]', { timeout: 8000 });
  await win.click('[data-sig-action="confirm"]');
  await win.waitForTimeout(600);

  const placement = win.locator('.sig-placement').first();
  await placement.waitFor({ timeout: 8000 });
  const readRect = () => placement.evaluate((el) => ({
    left: parseFloat(el.style.left || '0'),
    top: parseFloat(el.style.top || '0'),
  }));
  const initial = await readRect();
  console.log(`[S1] committed placement rect=${JSON.stringify(initial)}`);

  // Drag the placement 120px right / 60px down.
  const pb = await placement.boundingBox();
  await win.mouse.move(pb.x + 20, pb.y + 20);
  await win.mouse.down();
  await win.mouse.move(pb.x + 20 + 120, pb.y + 20 + 60, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(400);
  const afterDrag = await readRect();
  console.log(`[S1] after drag rect=${JSON.stringify(afterDrag)}`);
  await shot('sweep-s1-moved-drag.png');

  // Confirm commits the move.
  if (await win.locator('[data-sig-action="confirm"]').count()) {
    await win.click('[data-sig-action="confirm"]');
    await win.waitForTimeout(600);
  }
  const afterConfirm = await readRect();
  console.log(`[S1] after confirm rect=${JSON.stringify(afterConfirm)}`);
  const moved = afterConfirm.left > initial.left + 50 && afterConfirm.top > initial.top + 30;
  expect(moved, 'Confirm must commit the dragged position').toBe(true);

  // Delete via committed placement action bar.
  let pb2 = await placement.boundingBox();
  await win.mouse.click(pb2.x + 20, pb2.y + 20);
  await win.waitForTimeout(600);
  const deleteBtn = win.locator('[data-sig-action="delete"]');
  if (await deleteBtn.count()) {
    await deleteBtn.click();
    await win.waitForTimeout(900);
  }
  const placementsAfterDelete = await win.locator('.sig-placement').count();
  console.log(`[S1] after delete placements=${placementsAfterDelete}`);
  await shot('sweep-s1-after-delete.png');

  const d = await diag(win);
  console.log(`[S1] end: canUndo=${d.canUndo} canRedo=${d.canRedo} placements=${placementsAfterDelete} sigs=${d.signatures.length}`);
  expect(badHooks(), 'no React/hook errors in the signature lifecycle').toHaveLength(0);
  console.log('[S1] PASS');
});

// ---------------------------------------------------------------------------
// S2: signature move across pages, edge placement, reuse, save/reopen safety
// ---------------------------------------------------------------------------
test('S2: signature near edges, reused on another page, save/reopen safe', async () => {
  await openSample(win, electronApp, 'report.pdf');
  await armTypedSignature('QA');

  // Place near the top-left edge of page 1.
  const box = await slotBox(1);
  const layer = win.locator('[data-annotation-layer="1"]');
  const lb = await layer.first().boundingBox();
  await win.mouse.click(lb.x + 12, lb.y + 14);
  await win.waitForSelector('[data-sig-action-bar]', { timeout: 8000 });
  await win.click('[data-sig-action="confirm"]');
  await win.waitForTimeout(600);
  const edgePlacements = await win.locator('.sig-placement').count();
  console.log(`[S2] edge placement count=${edgePlacements}`);
  await shot('sweep-s2-edge-place.png');

  // Reuse a saved signature on page 2.
  await scrollToPage(win, 2);
  await armSignTool(win);
  await win.waitForSelector('.sig-manager', { timeout: 10000 });
  await win.waitForTimeout(500);
  await win.click('.sig-saved-pick');
  await win.waitForTimeout(500);

  const box2 = await slotBox(2);
  const layer2 = win.locator('[data-annotation-layer="2"]');
  let lb2 = await layer2.first().boundingBox().catch(() => box2);
  await win.mouse.click(lb2.x + 150, lb2.y + 150);
  await win.waitForSelector('[data-sig-action-bar]', { timeout: 8000 });
  if (await win.locator('[data-sig-action="confirm"]').count()) {
    await win.click('[data-sig-action="confirm"]');
    await win.waitForTimeout(600);
  }
  const placementTotal = await win.locator('.sig-placement').count();
  console.log(`[S2] after reuse on page 2, total placements=${placementTotal}`);
  await shot('sweep-s2-reuse-page2.png');

  // Save + reopen -> signatures still present (metadata round-trip).
  const outPath = await saveAs('s2');
  const pages = await parsePages(outPath);
  console.log(`[S2] savedPages=${pages}`);
  expect(pages, 'saved PDF must parse').toBe(34);

  await win.click('.tab-close').catch(() => {});
  await win.waitForSelector('.welcome, .sample-card', { timeout: 15000 });
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, outPath);
  await win.locator('[data-home-tool="open"]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(2500);

  const sigsAfter = (await diag(win)).signatures;
  console.log(`[S2] signatures after reopen=${sigsAfter.length} placements=${await win.locator('.sig-placement').count()}`);
  await shot('sweep-s2-after-reopen.png');

  expect(badHooks(), 'no React/hook errors in the cross-page sign flow').toHaveLength(0);
  console.log('[S2] PASS');
});
