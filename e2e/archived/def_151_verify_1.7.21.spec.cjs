// QA retest — DEF-151 (installed v1.7.21).
//
// ACCEPTANCE CRITERION (mask-only semantics, per orchestrator adjudication):
//   After edit-text move + confirm, the text must RELOCATE to the new position
//   by ~the drag delta (dx~200, dy~120), and there must be EXACTLY ONE VISIBLE
//   "NEW TITLE 123" (the old position white-masked, NOT stacked on the original
//   rect). Do NOT assert extraction count === 1 — the content stream will always
//   carry the masked old run (documented DEF-116 limitation).
//
// How we verify "VISIBLE": TFlex's .textLayer spans are `color: transparent`
// (styles.css:1497) — they are a search/selection overlay, NOT visual content.
// The VISIBLE text is what the page CANVAS renders. So we sample the canvas
// pixels at each run's rect:
//   - the OLD rect must be white-masked (dark fraction ~0),
//   - the MOVED rect must carry dark text (dark fraction > 0).
// The textLayer run count is reported but NOT asserted to be 1.
//
// Launch only via e2e/lib/launch.cjs against the DEV build (historically: the packaged installed exe).

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const OLD_TITLE = 'TFlex Technical Report';
const NEW_TITLE = 'NEW TITLE 123';

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

// First textLayer run (viewport rect) on page 1 matching a substring.
async function findTextRun(text) {
  return win.evaluate((needle) => {
    const spans = Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'));
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      if (t.length > 0 && t.includes(needle.split(' ')[0])) {
        const r = s.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, text: t };
      }
    }
    return null;
  }, text);
}

// ALL textLayer runs on page 1 matching a substring (viewport rects). Scoped to
// the FIRST page-slot (the active tab) — `querySelectorAll` across every
// page-slot would double-count when more than one tab is mounted.
async function allRunPositions(substr) {
  return win.evaluate((needle) => {
    const p = document.querySelector('.page-slot[data-page="1"]');
    if (!p) return [];
    const spans = p.querySelectorAll('.textLayer span');
    const out = [];
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      if (t.length > 0 && t.includes(needle)) {
        const r = s.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          out.push({ text: t, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
        }
      }
    }
    return out;
  }, substr);
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

async function page1Text() {
  return win.evaluate(() => {
    const p = document.querySelector('.page-slot[data-page="1"]');
    if (!p) return { present: false, text: '' };
    const layer = p.querySelector('.textLayer');
    let joined = '';
    if (layer) layer.querySelectorAll('span').forEach((s) => { joined += s.textContent || ''; });
    return { present: true, text: (joined || '').replace(/[ \t\r\n]+/g, ' ').trim() };
  });
}

// Dark-pixel fraction of the page-1 canvas region corresponding to a viewport
// rect. This is the ground truth for VISIBILITY (the textLayer is transparent).
async function canvasDarkAt(rect) {
  return win.evaluate((r) => {
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
      return { error: 'out-of-bounds', sx: Math.round(sx), sy: Math.round(sy), sw, sh, cw: c.width, ch: c.height };
    }
    const ctx = c.getContext('2d');
    const data = ctx.getImageData(Math.round(sx), Math.round(sy), sw, sh).data;
    let dark = 0, total = 0;
    for (let i = 0; i < data.length; i += 4) {
      total += 1;
      const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (lum < 140) dark += 1;
    }
    return { darkFraction: +(dark / total).toFixed(4), total, sx: Math.round(sx), sy: Math.round(sy), sw, sh, cw: c.width, ch: c.height };
  }, {
    x: rect.x,
    y: rect.y,
    w: rect.w !== undefined ? rect.w : rect.width,
    h: rect.h !== undefined ? rect.h : rect.height,
  });
}

// Confirm the editor — click the Confirm-move affordance if present, else Ctrl+Enter.
async function confirmEditor() {
  const confirmBtn = await win.evaluate(() => {
    const b = document.querySelector('.edit-inline-editor [data-edit-confirm]');
    if (!b) return null;
    return { attr: b.getAttribute('data-edit-confirm'), label: b.getAttribute('aria-label') };
  });
  console.log(`[CONFIRM-AFFORDANCE] ${JSON.stringify(confirmBtn)}`);
  if (confirmBtn && confirmBtn.attr === 'true') {
    await win.locator('.edit-inline-editor [data-edit-confirm="true"]').first().click();
  } else {
    const ta2 = win.locator('[data-edit-textarea]').first();
    await ta2.click();
    await win.keyboard.press('Control+Enter');
  }
  await win.waitForTimeout(1400);
}

// Parse a saved PDF with pdfjs-dist and return page-1 text content (INFO only —
// the masked old run is expected to remain in the stream, DEF-116).
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

// Classify the two runs after the move: the one nearest posBefore is the masked
// OLD run, the one farthest is the MOVED run. Returns shift + both rects.
function classifyRuns(runs, posBefore) {
  if (!runs || runs.length === 0) return null;
  if (runs.length === 1) {
    const only = runs[0];
    return { old: only, moved: only, shiftX: only.x - posBefore.x, shiftY: only.y - posBefore.y, relDx: 0, relDy: 0, runCount: 1 };
  }
  let old = runs[0];
  let moved = runs[0];
  let bestDist = Infinity;
  let worstDist = -Infinity;
  for (const r of runs) {
    const d = Math.abs(r.x - posBefore.x) + Math.abs(r.y - posBefore.y);
    if (d < bestDist) { bestDist = d; old = r; }
    if (d > worstDist) { worstDist = d; moved = r; }
  }
  // `relDx/relDy` is the run-to-run span of a single rendered set — robust to
  // the page-slot origin shifting between the live view and a re-open.
  return { old, moved, shiftX: moved.x - posBefore.x, shiftY: moved.y - posBefore.y, relDx: moved.x - old.x, relDy: moved.y - old.y, runCount: runs.length };
}

test('DEF-151 (v1.7.21): edit title -> move toolbox + confirm -> text RELOCATES by ~(200,120) with EXACTLY ONE VISIBLE "NEW TITLE 123"', async () => {
  await openSampleFromCard('report.pdf');
  await scrollToPage1();

  // Enter Edit mode + Edit text tool.
  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="text"]');
  await win.waitForTimeout(500);
  await shot('def-151-1721-edit-text-tool.png');

  // Find + click the title run.
  const run = await findTextRun(OLD_TITLE);
  console.log(`[TEXTRUN] title run=${JSON.stringify(run)}`);
  expect(run, 'title text run must exist on page 1').toBeTruthy();
  const cx = run.rect.x + run.rect.w / 2;
  const cy = run.rect.y + run.rect.h / 2;
  await win.mouse.click(cx, cy);
  await win.waitForTimeout(700);

  const editor1 = await readEditor('AFTER-CLICK-TITLE');
  expect(editor1.textareaValue, 'editor must open pre-filled with the title').toBe(OLD_TITLE);

  // Replace the title with NEW_TITLE and confirm.
  const ta = win.locator('[data-edit-textarea]').first();
  await ta.fill(NEW_TITLE);
  await win.waitForTimeout(300);
  await shot('def-151-1721-editor-typed-new.png');
  await win.click('[aria-label="Apply edit"]');
  await win.waitForTimeout(1800);

  const afterCommit = await page1Text();
  console.log(`[AFTER-COMMIT] page1 text="${afterCommit.text}"`);
  expect(/NEW TITLE 123/i.test(afterCommit.text), 'page must show the new title after commit').toBe(true);
  await shot('def-151-1721-after-commit.png');

  // Re-open the editor on the edited run so we can move the toolbox.
  const newRun = await findTextRun(NEW_TITLE);
  console.log(`[NEWRUN] ${JSON.stringify(newRun)}`);
  expect(newRun, 'the edited run must be present on page 1').toBeTruthy();
  await win.mouse.click(newRun.rect.x + newRun.rect.w / 2, newRun.rect.y + newRun.rect.h / 2);
  await win.waitForTimeout(700);
  const editor2 = await readEditor('AFTER-RECLICK');
  expect(editor2.present, 'editor must reopen after clicking the edited run').toBe(true);
  expect(editor2.textareaValue, 'reopened editor must carry the NEW text').toBe(NEW_TITLE);
  await shot('def-151-1721-editor-after-reclick.png');

  // Record the title position BEFORE the toolbox move.
  const runsBefore = await allRunPositions(NEW_TITLE);
  console.log(`[RUNS-BEFORE] ${JSON.stringify(runsBefore)}`);
  expect(runsBefore.length, 'exactly one "NEW TITLE 123" run must exist before the move').toBe(1);
  const posBefore = runsBefore[0];
  console.log(`[POS-BEFORE] ${JSON.stringify(posBefore)}`);

  // Move the TOOLBOX (drag its chrome) +200/+120 and confirm.
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
  const toolboxDx = editorAfterMove.rect.x - editor2.rect.x;
  const toolboxDy = editorAfterMove.rect.y - editor2.rect.y;
  console.log(`[TOOLBOX-MOVED] dx=${toolboxDx} dy=${toolboxDy}`);
  await shot('def-151-1721-editor-toolbox-moved.png');

  // Confirm the move.
  await confirmEditor();
  await shot('def-151-1721-after-move-confirm.png');

  // (a) RELOCATE: enumerate all "NEW TITLE 123" runs and classify old/moved.
  const runsAfter = await allRunPositions(NEW_TITLE);
  console.log(`[RUNS-AFTER] count=${runsAfter.length} ${JSON.stringify(runsAfter)}`);
  const cls = classifyRuns(runsAfter, posBefore);
  console.log(`[CLASSIFY] ${JSON.stringify(cls)}`);
  expect(cls, 'must be able to classify the runs after the move').toBeTruthy();
  const shiftX = cls.shiftX;
  const shiftY = cls.shiftY;
  console.log(`[MOVE-SHIFT] dx=${shiftX} dy=${shiftY} (expected ~${EXPECT_DX}/${EXPECT_DY})`);

  // The text must actually relocate by ~the drag delta (dx~200, dy~120).
  expect(shiftX, 'the text must relocate horizontally by ~the drag delta').toBeGreaterThanOrEqual(EXPECT_DX - 50);
  expect(shiftX, 'the text must not overshoot the drag delta by much').toBeLessThanOrEqual(EXPECT_DX + 50);
  expect(shiftY, 'the text must relocate vertically by ~the drag delta').toBeGreaterThanOrEqual(EXPECT_DY - 50);
  expect(shiftY, 'the text must not overshoot the drag delta by much').toBeLessThanOrEqual(EXPECT_DY + 50);

  // (b) EXACTLY ONE VISIBLE: sample the canvas at the OLD rect (must be white-
  // masked) and at the MOVED rect (must carry dark text).
  const oldDark = await canvasDarkAt(cls.old);
  const movedDark = await canvasDarkAt(cls.moved);
  console.log(`[CANVAS|OLD] ${JSON.stringify(oldDark)}`);
  console.log(`[CANVAS|MOVED] ${JSON.stringify(movedDark)}`);
  expect(oldDark && !oldDark.error, 'old rect must be inside the page canvas').toBeTruthy();
  expect(movedDark && !movedDark.error, 'moved rect must be inside the page canvas').toBeTruthy();
  expect(oldDark.darkFraction, 'the OLD rect must be white-masked (no visible glyphs)').toBeLessThan(0.05);
  expect(movedDark.darkFraction, 'the MOVED rect must carry visible dark text').toBeGreaterThan(0.005);

  // Report the visibility verdict.
  const visibleCount = (cls.old === cls.moved) ? 1 : (oldDark.darkFraction < 0.05 ? 1 : 2);
  console.log(`[VISIBLE-VERDICT] oldMasked=${oldDark.darkFraction < 0.05} movedVisible=${movedDark.darkFraction > 0.005} visibleCount=${visibleCount}`);
  expect(visibleCount, 'there must be EXACTLY ONE VISIBLE "NEW TITLE 123"').toBe(1);

  // Document safety: Save-As -> re-open, verify the visible result persists.
  const savePath = path.join(os.tmpdir(), `tflex-def151-1721-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[aria-label="Save As"]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(1800);
  console.log(`[SAVED] ${savePath} (exists=${fs.existsSync(savePath)})`);

  // INFO only — the content stream always carries the masked old run (DEF-116).
  const savedText = await page1TextOfPdf(savePath);
  const savedCount = (savedText.match(/NEW TITLE 123/g) || []).length;
  console.log(`[DOCSAFETY|PARSE|INFO] saved page-1 text="${savedText}" occurrences=${savedCount} (expected 2 — masked old run stays in the stream, DEF-116)`);

  // Re-open the saved file in the app; the VISIBLE result must still be ONE at
  // the moved position with the old rect masked.
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, savePath);
  await win.locator('button.btn-primary:has-text("Open")').first().click();
  await win.waitForTimeout(2400);
  await scrollToPage1();
  // Settle then probe STABILITY: sample the "NEW TITLE 123" rects 5 times,
  // 400ms apart, to tell a transient render race from a persistent double-render.
  await win.waitForTimeout(2500);
  const stability = [];
  for (let i = 0; i < 3; i += 1) {
    const s = await win.evaluate((needle) => {
      const p = document.querySelector('.page-slot[data-page="1"]');
      if (!p) return { present: false };
      const layers = p.querySelectorAll('.textLayer');
      const out = [];
      layers.forEach((layer, li) => {
        const rects = [];
        layer.querySelectorAll('span').forEach((sp) => {
          const t = (sp.textContent || '').trim();
          if (t.includes(needle)) {
            const r = sp.getBoundingClientRect();
            rects.push([Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]);
          }
        });
        if (rects.length > 0) out.push({ layerIndex: li, rects });
      });
      return { present: true, layerCount: layers.length, layers: out };
    }, NEW_TITLE);
    stability.push(s);
    await win.waitForTimeout(400);
  }
  console.log(`[DOCSAFETY|REOPEN|STABILITY] ${JSON.stringify(stability)}`);
  const runsReopen = await allRunPositions(NEW_TITLE);
  console.log(`[DOCSAFETY|REOPEN] runs=${runsReopen.length} ${JSON.stringify(runsReopen)}`);
  const clsReopen = classifyRuns(runsReopen, posBefore);
  console.log(`[DOCSAFETY|REOPEN|CLASSIFY] ${JSON.stringify(clsReopen)}`);
  expect(clsReopen, 'must be able to classify the runs after re-open').toBeTruthy();
  const oldDarkReopen = await canvasDarkAt(clsReopen.old);
  const movedDarkReopen = await canvasDarkAt(clsReopen.moved);
  console.log(`[DOCSAFETY|REOPEN|CANVAS|OLD] ${JSON.stringify(oldDarkReopen)}`);
  console.log(`[DOCSAFETY|REOPEN|CANVAS|MOVED] ${JSON.stringify(movedDarkReopen)}`);
  expect(oldDarkReopen && !oldDarkReopen.error, 'reopened old rect must be inside the page canvas').toBeTruthy();
  expect(movedDarkReopen && !movedDarkReopen.error, 'reopened moved rect must be inside the page canvas').toBeTruthy();
  expect(oldDarkReopen.darkFraction, 'the REOPENED old rect must be white-masked (no visible glyphs)').toBeLessThan(0.05);
  expect(movedDarkReopen.darkFraction, 'the REOPENED moved rect must carry visible dark text').toBeGreaterThan(0.005);
  const visibleReopen = (clsReopen.old === clsReopen.moved) ? 1 : (oldDarkReopen.darkFraction < 0.05 ? 1 : 2);
  console.log(`[DOCSAFETY|REOPEN|VERDICT] oldMasked=${oldDarkReopen.darkFraction < 0.05} movedVisible=${movedDarkReopen.darkFraction > 0.005} visibleCount=${visibleReopen}`);
  expect(visibleReopen, 'the REOPENED saved file must show EXACTLY ONE VISIBLE "NEW TITLE 123"').toBe(1);
  await shot('def-151-1721-saved-reopened.png');

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  console.log(`[PAGEERRORS] ${JSON.stringify(pageErrors)}`);
  expect(bad, 'no unhandled page-request / React-hook / NaN errors').toHaveLength(0);

  console.log(`[DEF-151|RESULT] PASS (text RELOCATED dx=${shiftX} dy=${shiftY}; ONE VISIBLE at the moved spot; old rect white-masked)`);
});
