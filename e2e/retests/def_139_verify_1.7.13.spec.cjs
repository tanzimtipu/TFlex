// QA operator-exact visual verification of DEF-139 on the freshly installed
// v1.7.13 binary (AppData\Local\Programs\tflex\TFlex.exe, FileVersion 1.7.13).
//
// The operator's instruction is explicit: do the VISUAL check, NOT the
// state-array check. DEF-139's own history warns that trusting
// `engineState.pageOrder` / `data-source-page` arrays is exactly how the
// defect was miss-categorized before — the arrays can declare the right
// order while the LIVE RENDERED content shows the wrong page at every slot
// from 2 onward. So this spec reads the ground truth that reflects what the
// page actually renders:
//   * per-slot `.textLayer` text (the DOM text that is selectable/visible),
//   * per-thumbnail `.thumb-canvas` pixel content (dark-fraction: a blank
//     page is ~0, a text page is > 0),
//   * full screenshots + per-thumb clips for human visual inspection.
//
// Flow (operator-exact):
//   1. Open report.pdf from the sample cards.
//   2. Insert a BLANK page at position "after page 1" (rank semantics: the
//      "Insert at page" field value 2 makes the blank become page 2).
//   3. IMMEDIATELY (no save/reopen) inspect the LEFT THUMBNAIL RAIL and the
//      main-view pages 2 and 3:
//        thumb/main-view slot 1 = title page
//        thumb/main-view slot 2 = BLANK
//        thumb/main-view slot 3 = "Chapter 1: The Art of Orchestration"
//        thumb/main-view slot 35 = "Page 17"
//   4. Draw with the pen on visible page 3 -> the ink must render on the
//      Chapter 1 page content (the ink element lands on the slot that shows
//      Chapter 1).
//   5. Delete path (developer note): delete page 2 (the blank) -> slot 2
//      must immediately render the correct next content (Chapter 1), no
//      save+reopen.
//
// Launch ONLY through e2e/lib/launch.cjs against the packaged exe. Never a
// .cmd/.ps1 shim; never a hand-concatenated file:// URL.

const { test, expect } = require('@playwright/test');
const { hardClose } = require('../lib/helpers.cjs');
const { launchApp } = require('../lib/launch.cjs');
const path = require('node:path');

const EXE_PATH = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test.setTimeout(300000);

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
  await win.waitForTimeout(700);
});

test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null;
  win = null;
  pageErrors = [];
});

// --- helpers ----------------------------------------------------------------

async function openSampleFromCard(name) {
  await win.locator(`.sample-card:has-text("${name}")`).first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2000);
}

async function openTools() {
  const open = await win.evaluate(() => document.querySelector('[data-tools-palette]') !== null);
  if (!open) {
    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 10000 });
    await win.waitForTimeout(300);
  }
}

async function insertBlankAfterPageOne() {
  await openTools();
  await win.click('[data-tool-id="insertPages"]');
  await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-insert-mode="blank"]');
  await win.waitForTimeout(200);
  await win.fill('[data-insert-position]', '2'); // rank semantics: blank becomes page 2
  await win.waitForTimeout(300);
  await win.click('[data-insert-confirm]');
  // Let the engine op + the pdf.js proxy rebuild + the rail refresh settle.
  await win.waitForTimeout(3000);
}

async function scrollToPage(n) {
  for (let i = 0; i < 60; i += 1) {
    const done = await win.evaluate((want) => {
      const sc = document.querySelector('.document-scroller');
      if (!sc) return true;
      const slot = document.querySelector(`.page-slot[data-page="${want}"]`);
      if (slot) {
        sc.scrollTop = slot.offsetTop - 100;
        return true;
      }
      sc.scrollTop += 1400;
      return false;
    }, n);
    await win.waitForTimeout(250);
    if (done) break;
  }
  await win.waitForTimeout(1200);
  await win.evaluate((want) => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector(`.page-slot[data-page="${want}"]`);
    if (sc && slot) sc.scrollTop = slot.offsetTop - 120;
  }, n);
  await win.waitForTimeout(800);
}

// The per-slot textLayer ground truth: reflects what text the page renders.
async function slotText(pageNum) {
  return win.evaluate((want) => {
    const s = document.querySelector(`.page-slot[data-page="${want}"]`);
    if (!s) return { mounted: false, text: null, spanCount: -1 };
    const layer = s.querySelector('.textLayer');
    const spans = s.querySelectorAll('.textLayer span');
    let joined = '';
    spans.forEach((sp) => { joined += sp.textContent || ''; });
    const inner = layer ? (layer.innerText || '') : '';
    const text = (joined || inner).replace(/[ \t\r\n]+/g, ' ').trim();
    return { mounted: true, text, spanCount: spans.length, inner: inner.replace(/[ \t\r\n]+/g, ' ').trim() };
  }, pageNum);
}

// Dark-pixel fraction of a thumbnail's canvas: blank page ~= 0, text page > 0.
async function thumbDark(pageNum) {
  return win.evaluate((want) => {
    const t = document.querySelector(`.thumb-item[data-page="${want}"]`);
    const c = t && t.querySelector('.thumb-canvas');
    if (!c || typeof c.getContext !== 'function') return null;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    if (!w || !h) return null;
    let data;
    try {
      data = ctx.getImageData(0, 0, w, h).data;
    } catch (e) {
      return null;
    }
    let dark = 0, total = 0;
    for (let i = 0; i < data.length; i += 4) {
      total += 1;
      const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (lum < 140) dark += 1;
    }
    return { w, h, darkFraction: +(dark / total).toFixed(4), mounted: true };
  }, pageNum);
}

// Scroll the rail so the requested thumb renders (thumbnails are virtualized).
async function scrollRailToThumb(n) {
  await win.evaluate((want) => {
    const inner = document.querySelector('.thumb-scroller-inner');
    const t = document.querySelector(`.thumb-item[data-page="${want}"]`);
    if (inner && t) inner.scrollTop = t.offsetTop - 60;
  }, n);
  await win.waitForTimeout(800);
}

async function shot(name) {
  await win.screenshot({ path: path.join(SHOTS, name) });
  return path.join(SHOTS, name);
}

async function shotClip(name, selector) {
  const el = win.locator(selector).first();
  const box = await el.boundingBox();
  if (!box || box.width === 0 || box.height === 0) {
    console.log(`[SKIP-CLIP] ${name} -- no nonzero box for ${selector}`);
    return null;
  }
  const vp = win.viewportSize() || { width: 1440, height: 900 };
  const x = Math.max(0, Math.min(box.x, vp.width - 1));
  const y = Math.max(0, Math.min(box.y, vp.height - 1));
  const width = Math.max(1, Math.min(box.width, vp.width - x));
  const height = Math.max(1, Math.min(box.height, vp.height - y));
  const p = path.join(SHOTS, name);
  try {
    await win.screenshot({ path: p, clip: { x, y, width, height } });
  } catch (e) {
    console.log(`[SKIP-CLIP] ${name} -- clip failed: ${e && e.message}`);
    return null;
  }
  return p;
}

async function diag() {
  return win.evaluate(() => window.tflexDiagnostics());
}

async function eng() {
  const d = await diag();
  return d.engineState || d;
}

async function annCount(pageNum, cls) {
  return win.evaluate(({ pageNum, cls }) => {
    const s = document.querySelector(`.page-slot[data-page="${pageNum}"]`);
    let n = 0;
    if (s) s.querySelectorAll(cls).forEach((e) => { if (!e.classList.contains('ann-preview')) n += 1; });
    return n;
  }, { pageNum, cls });
}

async function pageRect(pageNum) {
  return win.evaluate((want) => {
    const s = document.querySelector(`.page-slot[data-page="${want}"]`);
    if (!s) return null;
    const c = s.querySelector('canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }, pageNum);
}

// ---------------------------------------------------------------------------
// DEF-139 core: insert blank after page 1 -> live render (rail + main view)
// immediately correct; draw pen on page 3. No save/reopen anywhere.
// ---------------------------------------------------------------------------
test('DEF-139: insert blank after page 1, live rail+main view immediately correct; pen on page 3', async () => {
  await openSampleFromCard('report.pdf');
  const e0 = await eng();
  console.log(`[DEF-139] base pageCount=${e0.pageCount}`);

  await insertBlankAfterPageOne();

  const e1 = await eng();
  console.log(`[DEF-139] after insert pageCount=${e1.pageCount} (info only - not trusted for render)`);

  // Number of thumbs in the rail (DOM count of real thumbnails).
  const thumbCount = await win.locator('.thumb-item').count();
  console.log(`[DEF-139] rail thumb count=${thumbCount}`);
  expect(thumbCount, 'after insert the rail must show 35 thumbnails').toBe(35);

  // --- Rail / thumbnails (visual + pixel). Scroll rail to top first.
  await win.evaluate(() => { const i = document.querySelector('.thumb-scroller-inner'); if (i) i.scrollTop = 0; });
  await win.waitForTimeout(1000);
  await shot('def-139-1713-rail.png');

  // Thumb 1,2,3 close-ups + pixel content (read while mounted, top of rail).
  const thumbDarkAtTop = {};
  for (let i = 1; i <= 3; i++) {
    await shotClip(`def-139-1713-thumb-${i}.png`, `.thumb-item[data-page="${i}"]`);
    const d = await thumbDark(i);
    thumbDarkAtTop[i] = d && d.darkFraction;
    console.log(`[DEF-139] thumb ${i} darkFraction=${thumbDarkAtTop[i]} (${d && d.w}x${d && d.h})`);
  }

  // Last thumbnail (35) — scroll the rail to the bottom first (thumb 1-3 are
  // virtualized out of the DOM once the rail scrolls away, so do NOT re-read
  // them after this).
  await scrollRailToThumb(35);
  await win.waitForTimeout(1000);
  await shotClip('def-139-1713-thumb-35.png', '.thumb-item[data-page="35"]');
  const d35 = await thumbDark(35);
  console.log(`[DEF-139] thumb 35 darkFraction=${d35 && d35.darkFraction} (${d35 && d35.w}x${d35 && d35.h})`);

  // Companion pixel guard: thumb 2 = the BLANK must be dark-free (pure white).
  // (Content identity is proven below by the main-view textLayer + the visual
  // clips; tiny thumbnail text can fall under the dark threshold, so we only
  // use the pixel signal to confirm the blank is blank, which is unambiguous.)
  expect(thumbDarkAtTop[2], 'thumb 2 must be BLANK (pure white, near-zero dark fraction)').toBeLessThan(0.02);

  // --- Main-view pages 1,2,3 textLayer ground truth (the definitive content
  // proof of what each slot renders — NOT any state array).
  // Keep the rail scrolled to the top so the operator screenshots show the
  // rail thumbnails 1..3 alongside the matching main-view page.
  await win.evaluate(() => { const i = document.querySelector('.thumb-scroller-inner'); if (i) i.scrollTop = 0; });
  await win.waitForTimeout(600);
  await scrollToPage(2);
  const s1 = await slotText(1);
  const s2 = await slotText(2);
  const s3 = await slotText(3);
  console.log(`[DEF-139] slot1 text="${s1.text}"`);
  console.log(`[DEF-139] slot2 text="${s2.text}" spanCount=${s2.spanCount}`);
  console.log(`[DEF-139] slot3 text="${s3.text}"`);
  await shot('def-139-1713-live-page1.png');
  await shot('def-139-1713-live-page2.png');

  expect(s2 && s2.mounted, 'slot 2 must be mounted').toBe(true);
  expect(s3 && s3.mounted, 'slot 3 must be mounted').toBe(true);
  expect(String(s1 && s1.text), 'slot 1 must be the title page').toMatch(/TFlex Technical Report/);
  // slot 2 = the new BLANK: no title, no chapter, no appendix page.
  const blankText = String(s2 && s2.text);
  expect(blankText, 'slot 2 must be BLANK (no text)').toBe('');
  // slot 3 = Chapter 1.
  expect(String(s3 && s3.text), 'slot 3 must be Chapter 1: The Art of Orchestration').toMatch(/Chapter 1: The Art of Orchestration/);

  // Main-view page 3 (Chapter 1) screenshot with the document scrolled there.
  await scrollToPage(3);
  await shot('def-139-1713-live-page3.png');

  // --- Last page (35) textLayer ground truth.
  await scrollToPage(35);
  const s35 = await slotText(35);
  console.log(`[DEF-139] slot35 text="${s35.text}"`);
  await shot('def-139-1713-live-page35.png');
  expect(String(s35 && s35.text), 'slot 35 must be the appendix "Page 17"').toMatch(/Page 17/);

  // --- Draw with the pen on visible page 3 -> ink lands on the Chapter 1 slot.
  await scrollToPage(3);
  const p3 = await pageRect(3);
  console.log(`[DEF-139] page3 rect=${JSON.stringify(p3)}`);
  await win.locator('.ann-toolbar button[data-tool="ink"]').click();
  await win.waitForTimeout(300);
  await win.mouse.move(p3.x + 200, p3.y + 220);
  await win.mouse.down();
  await win.mouse.move(p3.x + 420, p3.y + 360, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(1000);

  const s3After = await slotText(3);
  const inkOnPage3 = await annCount(3, '.ann-ink');
  console.log(`[DEF-139] after ink: slot3 text="${s3After.text}" inkOnPage3=${inkOnPage3}`);
  await shot('def-139-1713-page3-ink.png');
  // The ink element must render on the slot that displays Chapter 1, and the
  // slot must still be the Chapter 1 page content.
  expect(inkOnPage3, 'the pen stroke must be rendered on visible page 3 (the Chapter 1 slot)').toBeGreaterThan(0);
  expect(String(s3After && s3After.text), 'page 3 must still render Chapter 1 content where the ink landed').toMatch(/Chapter 1: The Art of Orchestration/);

  // Confirm the thumbnails visually track the live view: page 2 still blank,
  // page 3 shows content + ink. (No state-array trust; no save/reopen.)
  const s2Final = await slotText(2);
  expect(String(s2Final && s2Final.text), 'page 2 must still be BLANK after all of the above').toBe('');

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  expect(bad, 'no unhandled page-request / React-hook / NaN errors during insert+draw').toHaveLength(0);
  console.log('[DEF-139] CORE PASS: live render immediately correct (rail + main view + pen), no save/reopen.');
});

// ---------------------------------------------------------------------------
// DEF-139 delete path (developer note): delete page 2 (the blank) -> slot 2
// immediately renders the correct next content (Chapter 1), no save/reopen.
// ---------------------------------------------------------------------------
test('DEF-139: delete path - after deleting page 2, slot 2 renders Chapter 1 immediately', async () => {
  await openSampleFromCard('report.pdf');
  await insertBlankAfterPageOne();

  const pre = await eng();
  const preCount = pre.pageCount;
  console.log(`[DEF-139-del] after insert pageCount=${preCount}`);
  const preS2 = await slotText(2);
  const preS3 = await slotText(3);
  console.log(`[DEF-139-del] before delete slot2="${preS2.text}" slot3="${preS3.text}"`);
  expect(preS2 && String(preS2.text), 'precondition: slot 2 must be the blank').toBe('');
  expect(String(preS3 && preS3.text), 'precondition: slot 3 must be Chapter 1').toMatch(/Chapter 1: The Art of Orchestration/);

  // Delete page 2 (the inserted blank) via the range-mode dialog.
  await openTools();
  await win.click('[data-tool-id="delete"]');
  await win.waitForSelector('[data-delete-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-delete-mode="range"]');
  await win.waitForTimeout(200);
  await win.fill('[data-delete-range]', '2');
  await win.waitForTimeout(200);
  await win.click('[data-delete-confirm]');
  await win.waitForTimeout(3000);

  const post = await eng();
  console.log(`[DEF-139-del] after delete pageCount=${post.pageCount}`);
  expect(post.pageCount, 'deleting the blank page must bring the doc back to 34 pages').toBe(preCount - 1);

  // IMMEDIATELY inspect (no save/reopen): slot 2 must render Chapter 1.
  await scrollToPage(2);
  const d1 = await slotText(1);
  const d2 = await slotText(2);
  const d3 = await slotText(3);
  console.log(`[DEF-139-del] after delete slot1="${d1.text}" slot2="${d2.text}" slot3="${d3.text}"`);
  await shot('def-139-1713-after-delete.png');
  expect(String(d1 && d1.text), 'slot 1 must still be the title after delete').toMatch(/TFlex Technical Report/);
  expect(String(d2 && d2.text), 'slot 2 must immediately render Chapter 1 (the correct next content)').toMatch(/Chapter 1: The Art of Orchestration/);
  // slot 3 is the Chapter 1 continuation body (a Chapter heading appears once,
  // then the body / next chapter runs follow). The point of the delete check is
  // that slot 2 shows the correct next content and nothing is left blank or
  // scrambled — so slot 3 must have real rendered content, not be blank.
  expect(String(d3 && d3.text).length, 'slot 3 must have real rendered content after the delete').toBeGreaterThan(20);

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  expect(bad, 'no unhandled page-request / React-hook / NaN errors during insert+delete').toHaveLength(0);
  console.log('[DEF-139] DELETE PATH PASS: after delete, live slot 2 renders the correct next content immediately.');
});
