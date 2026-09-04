// QA retest — DEF-150 (installed v1.7.21).
//
// ACCEPTANCE CRITERION (mask-only / visible-copy semantics, per the DEF-151
// orchestrator adjudication, applied to the add-box sibling path):
//   Add box -> place -> type -> Apply. Reopen the committed box, drag the
//   floating toolbox chrome +200/+120 so a "Confirm move" affordance appears,
//   then confirm. The BOX CONTENT must RELOCATE with the toolbox by ~the drag
//   delta (dx~200, dy~120), and there must be EXACTLY ONE VISIBLE copy of the
//   box (no duplicate / stacked box at the old rect).
//
//   We do NOT assert the extraction count (=== 1): the content stream can carry
//   the masked old run (documented DEF-116 limitation), and the add-box path
//   uses the engine registry (moveTextBox) which does not mask the old rect
//   (underlying content is never erased — the DEF-135 root cause). So we count
//   the VISIBLE representations instead:
//     - `.edit-box[data-edit-box-id]` surface count (the committed box surface)
//       must be EXACTLY 1.
//     - the box text run in the page-1 content stream must be EXACTLY 1, and it
//       must sit at the MOVED rect, not the old rect (no box run left behind).
//   Launch only via e2e/lib/launch.cjs against the DEV build (historically: the packaged installed exe).

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const BOX_TEXT = 'MOVE TEST 88';

// Expected screen shift for the drag delta (+200/+120 CSS px).
const EXPECT_DX = 200;
const EXPECT_DY = 120;

test.setTimeout(300000);

let electronApp = null;
let win = null;
let pageErrors = [];

test.beforeEach(async () => {
  electronApp = await launchApp([]);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  pageErrors = [];
  win.on('pageerror', (err) => {
    const m = err && err.message ? err.message : String(err);
    pageErrors.push(m);
    process.stdout.write(`[PAGEERROR] ${m}\n`);
  });
  await win.waitForTimeout(700);
});

test.afterEach(async () => {
  await hardClose(electronApp);
  electronApp = null;
  win = null;
  pageErrors = [];
});

async function shot(name) {
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p });
  console.log(`[SHOT] ${name}`);
  return p;
}

async function openSampleFromCard(name) {
  await win.locator(`.sample-card:has-text("${name}")`).first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2200);
}

async function scrollToPage1() {
  await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector('.page-slot[data-page="1"]');
    if (sc && slot) sc.scrollTop = slot.offsetTop - 10;
  });
  await win.waitForTimeout(1000);
}

// Committed box SURFACE rect (`.edit-box[data-edit-box-id]`, excluding the
// shared-id action-bar toolbar).
async function boxSurface(label) {
  const out = await win.evaluate(() => {
    const b = document.querySelector('.edit-box[data-edit-box-id]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return {
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      text: b.getAttribute('data-edit-box-text'),
      id: b.getAttribute('data-edit-box-id'),
    };
  });
  console.log(`[BOX|${label}] ${JSON.stringify(out)}`);
  return out;
}

// Count of `.edit-box[data-edit-box-id]` surfaces (the committed box surface).
async function boxSurfaceCount(label) {
  const n = await win.evaluate(() => document.querySelectorAll('.edit-box[data-edit-box-id]').length);
  console.log(`[BOXCOUNT|${label}] ${n}`);
  return n;
}

async function readEditor(label) {
  const info = await win.evaluate(() => {
    const e = document.querySelector('.edit-inline-editor');
    if (!e) return { present: false };
    const ta = e.querySelector('[data-edit-textarea]');
    const r = e.getBoundingClientRect();
    return {
      present: true,
      mode: e.getAttribute('data-edit-editor'),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      textareaValue: ta ? ta.value : null,
    };
  });
  console.log(`[EDITOR|${label}] ${JSON.stringify(info)}`);
  return info;
}

// Read the commit button's confirm-move affordance state.
async function confirmAffordance(label) {
  const info = await win.evaluate(() => {
    const e = document.querySelector('.edit-inline-editor');
    if (!e) return { present: false };
    const btn = e.querySelector('[data-edit-confirm]');
    if (!btn) return { present: true, hasBtn: false };
    return {
      present: true,
      hasBtn: true,
      attr: btn.getAttribute('data-edit-confirm'),
      aria: btn.getAttribute('aria-label'),
      text: (btn.textContent || '').trim(),
    };
  });
  console.log(`[CONFIRM|${label}] ${JSON.stringify(info)}`);
  return info;
}

// All page-1 textLayer runs matching the box text (viewport rects). Scoped to
// the FIRST page-slot so a second mounted tab never double-counts.
async function textRuns(label, needle) {
  const out = await win.evaluate((n) => {
    const p = document.querySelector('.page-slot[data-page="1"]');
    if (!p) return { present: false, runs: [] };
    const spans = p.querySelectorAll('.textLayer span');
    const runs = [];
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      if (t.length > 0 && t.includes(n)) {
        const r = s.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          runs.push({ text: t, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
        }
      }
    }
    return { present: true, runs };
  }, needle);
  console.log(`[TEXTRUNS|${label}] ${JSON.stringify(out)}`);
  return out;
}

// Distance from a point to the box's old-rect center (to tell a run left
// behind at the OLD rect from the run that RELOCATED).
function distToRectCenter(run, rect) {
  if (!run || !rect) return Infinity;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return Math.abs(run.x - cx) + Math.abs(run.y - cy);
}

// Dark-pixel fraction of the page-1 canvas region corresponding to a viewport
// rect — the ground truth for VISIBILITY (the .textLayer spans are transparent,
// so the VISIBLE box text is what the page CANVAS renders).
async function canvasDarkAt(label, rect) {
  const out = await win.evaluate((r) => {
    const s = document.querySelector('.page-slot[data-page="1"]');
    const c = s && s.querySelector('canvas');
    if (!c || typeof c.getContext !== 'function') return null;
    const cr = c.getBoundingClientRect();
    if (!cr.width || !cr.height) return null;
    const kx = c.width / cr.width;
    const ky = c.height / cr.height;
    const sx = (r.x - cr.x) * kx;
    const sy = (r.y - cr.y) * ky;
    const sw = Math.max(1, Math.round(r.w * kx));
    const sh = Math.max(1, Math.round(r.h * ky));
    if (sx < 0 || sy < 0 || sx + sw > c.width || sy + sh > c.height) {
      return { error: 'out-of-bounds' };
    }
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(Math.round(sx), Math.round(sy), sw, sh).data;
    let dark = 0, total = 0;
    for (let i = 0; i < data.length; i += 4) {
      total += 1;
      const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (lum < 140) dark += 1;
    }
    return { darkFraction: +(dark / total).toFixed(4), total };
  }, { x: rect.x, y: rect.y, w: rect.w, h: rect.h });
  console.log(`[CANVAS|${label}] ${JSON.stringify(out)}`);
  return out;
}

// INFO only — parse a saved PDF with pdfjs-dist for the extraction count. We do
// NOT assert this number (DEF-116 / the task's "do not assert extraction count"
// rule); we report it for transparency.
async function page1TextOfPdf(pdfPath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, disableWorker: true }).promise;
  const page = await doc.getPage(1);
  const tc = await page.getTextContent();
  let txt = '';
  tc.items.forEach((it) => { txt += it.str + ' '; });
  return (txt || '').replace(/\s+/g, ' ').trim();
}

test('DEF-150 (v1.7.21): reopen box -> move toolbox + confirm -> box RELOCATES by ~(200,120) with EXACTLY ONE VISIBLE copy', async () => {
  await openSampleFromCard('report.pdf');
  await scrollToPage1();

  // Enter Edit mode + Add box tool.
  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);

  // Place a text box on page 1.
  const slot1 = win.locator('.page-slot[data-page="1"]').first();
  await slot1.waitFor({ timeout: 15000 });
  const slotRect = await slot1.boundingBox();
  const px = slotRect.x + slotRect.width * 0.28;
  const py = slotRect.y + 250;
  await win.mouse.move(px, py);
  await win.mouse.down();
  await win.mouse.move(px + 150, py + 90, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(800);

  const ta = win.locator('[data-edit-textarea]').first();
  await ta.waitFor({ timeout: 10000 });
  await ta.fill(BOX_TEXT);
  await win.waitForTimeout(300);
  await win.click('[aria-label="Apply edit"]');
  await win.waitForTimeout(1600);

  const R0 = await boxSurface('COMMITTED-R0');
  expect(R0, 'a committed box surface must exist').toBeTruthy();
  expect(R0.text, 'committed box must carry the typed text').toBe(BOX_TEXT);
  expect(await boxSurfaceCount('AFTER-COMMIT'), 'exactly one box surface after commit').toBe(1);
  await shot('def-150-1721-committed.png');

  // Reopen the committed box (click it).
  await win.mouse.click(R0.x + R0.w / 2, R0.y + R0.h / 2);
  await win.waitForTimeout(700);
  const editorOpen = await readEditor('REOPENED');
  expect(editorOpen.present, 'editor must reopen after clicking the committed box').toBe(true);
  expect(editorOpen.textareaValue, 'reopened editor must carry the box text').toBe(BOX_TEXT);

  // Move the TOOLBOX (drag its chrome) +200/+120.
  const bar = await win.evaluate(() => {
    const e = document.querySelector('.edit-inline-editor');
    const b = e && e.querySelector('[data-edit-drag-handle]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  console.log(`[DRAGBAR] ${JSON.stringify(bar)}`);
  expect(bar, 'editor drag handle must exist').toBeTruthy();
  const gx = bar.x + 5;
  const gy = bar.y + 5;
  await win.mouse.move(gx, gy);
  await win.mouse.down();
  await win.mouse.move(gx + EXPECT_DX, gy + EXPECT_DY, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(500);
  const editorAfterMove = await readEditor('AFTER-TOOLBOX-MOVE');
  const toolboxDx = editorAfterMove.rect.x - editorOpen.rect.x;
  const toolboxDy = editorAfterMove.rect.y - editorOpen.rect.y;
  console.log(`[TOOLBOX-MOVED] dx=${toolboxDx} dy=${toolboxDy}`);
  await shot('def-150-1721-editor-toolbox-moved.png');

  // (a) A "Confirm move" affordance must appear after the toolbox moved.
  const confirm = await confirmAffordance('AFTER-MOVE');
  expect(confirm.hasBtn, 'a Confirm/commit button must be present in the editor').toBe(true);
  console.log(`[CONFIRM] attr=${confirm.attr} aria=${confirm.aria} text="${confirm.text}"`);
  expect(confirm.attr, 'the commit button must flip to data-edit-confirm="true" after the toolbox moved').toBe('true');
  expect(/Confirm move/i.test(confirm.aria || ''), 'the commit button must read as a "Confirm move" affordance').toBe(true);

  // (b) Click the Confirm-move button.
  await win.locator('.edit-inline-editor [data-edit-confirm="true"]').first().click();
  await win.waitForTimeout(1800);

  const R1 = await boxSurface('AFTER-CONFIRM');
  console.log(`[AFTER-CONFIRM] box rect=${JSON.stringify(R1)} (R0=${JSON.stringify(R0)} toolbox dx=${toolboxDx} dy=${toolboxDy})`);
  await shot('def-150-1721-after-confirm.png');

  // (b) RELOCATE: the box surface must shift by ~the toolbox drag delta.
  expect(R1, 'a box surface must exist after confirm').toBeTruthy();
  const dx = Math.round(R1.x - R0.x);
  const dy = Math.round(R1.y - R0.y);
  console.log(`[MOVE-MEASURE] dx=${dx} dy=${dy} (expected ~${EXPECT_DX}/${EXPECT_DY})`);
  expect(dx, 'box must relocate horizontally by ~the drag delta').toBeGreaterThanOrEqual(EXPECT_DX - 25);
  expect(dx, 'box must not overshoot the drag delta by much').toBeLessThanOrEqual(EXPECT_DX + 25);
  expect(dy, 'box must relocate vertically by ~the drag delta').toBeGreaterThanOrEqual(EXPECT_DY - 25);
  expect(dy, 'box must not overshoot the drag delta by much').toBeLessThanOrEqual(EXPECT_DY + 25);

  // (c) EXACTLY ONE VISIBLE copy:
  //     - exactly one `.edit-box` surface (no duplicate / stacked box), and
  //     - exactly one box-text run in the content stream, sitting at the MOVED
  //       rect, with NO box-text run left behind at the old rect.
  const surfaceCount = await boxSurfaceCount('AFTER-CONFIRM');
  expect(surfaceCount, 'there must be EXACTLY ONE visible box surface').toBe(1);

  const runs = await textRuns('AFTER-CONFIRM', BOX_TEXT);
  expect(runs.present && runs.runs.length > 0, 'at least one box-text run must exist after confirm').toBe(true);
  console.log(`[RUNS-AFTER-CONFIRM] count=${runs.runs.length} ${JSON.stringify(runs.runs)}`);
  expect(runs.runs.length, 'there must be EXACTLY ONE box-text run in the content stream (no duplicate run left behind)').toBe(1);

  const run = runs.runs[0];
  const distOld = distToRectCenter(run, R0);
  const distMoved = distToRectCenter(run, R1);
  console.log(`[RUN-POSITION] run=${JSON.stringify(run)} distToOld=${distOld} distToMoved=${distMoved}`);
  expect(distMoved < distOld, 'the box-text run must sit at the MOVED rect, not the old rect').toBe(true);
  // The run must actually be near the moved rect (within the box bounds + a
  // small tolerance), not left floating at the old position.
  expect(Math.abs(run.x - R1.x) < R1.w, 'run must be horizontally inside the moved box').toBe(true);
  expect(Math.abs(run.y - R1.y) < R1.h, 'run must be vertically inside the moved box').toBe(true);

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  console.log(`[PAGEERRORS] ${JSON.stringify(pageErrors)}`);
  expect(bad, 'no unhandled page-request / React-hook / NaN errors').toHaveLength(0);

  // (d) DOCUMENT SAFETY — the move must persist: Save-As -> re-open, the box
  //     must still be there as ONE VISIBLE copy at the moved position. We do NOT
  //     assert the extraction count (the task's rule); we count VISIBLE copies
  //     via canvas sampling of the reopened page.
  const savePath = path.join(os.tmpdir(), `tflex-def150-1721-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[aria-label="Save As"]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(1800);
  console.log(`[SAVED] ${savePath} (exists=${fs.existsSync(savePath)})`);
  expect(fs.existsSync(savePath), 'the saved file must exist on disk').toBe(true);

  // INFO only — extraction count (not asserted).
  const savedText = await page1TextOfPdf(savePath);
  const savedCount = (savedText.match(/MOVE TEST 88/g) || []).length;
  console.log(`[DOCSAFETY|PARSE|INFO] saved page-1 text="${savedText}" occurrences=${savedCount} (INFO only, not asserted)`);

  // Re-open the saved file; the box must still be ONE VISIBLE copy.
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, savePath);
  await win.locator('button.btn-primary:has-text("Open")').first().click();
  await win.waitForTimeout(2400);
  await scrollToPage1();
  await win.waitForTimeout(1500);

  const runsReopen = await textRuns('AFTER-REOPEN', BOX_TEXT);
  console.log(`[DOCSAFETY|REOPEN] runCount=${runsReopen.runs.length} ${JSON.stringify(runsReopen.runs)}`);
  expect(runsReopen.runs.length > 0, 'the moved box text must still be present after save + reopen').toBe(true);
  // Count VISIBLE copies by sampling the canvas at each run's rect.
  let visibleCount = 0;
  for (const r of runsReopen.runs) {
    const dk = await canvasDarkAt('REOPEN-RUN', r);
    if (dk && !dk.error && dk.darkFraction > 0.005) visibleCount += 1;
  }
  console.log(`[DOCSAFETY|REOPEN|VISIBLE] visibleCount=${visibleCount} (must be 1 — no duplicate/stacked copy)`);
  expect(visibleCount, 'the reopened saved file must show EXACTLY ONE VISIBLE "MOVE TEST 88"').toBe(1);
  await shot('def-150-1721-saved-reopened.png');

  console.log(`[DEF-150|RESULT] PASS (box RELOCATED dx=${dx} dy=${dy}; surfaceCount=${surfaceCount}; content runs=${runs.runs.length} at the moved rect; saved+reopen visible=${visibleCount})`);
});
