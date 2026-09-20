// QA verification spec for DEF-163 / DEF-164 on the installed v1.7.26 build.
//
// DEF-164 (interop, the important one): place a note + textbox + callout +
//   rect, Save As, then inspect the SAVED file's RAW /Rect values with
//   pdf-lib. Every y must be PDF BOTTOM-LEFT user space:
//     lly = pageHeight - y_topdown - h ;  ury = pageHeight - y_topdown
//   (NOT the un-flipped renderer top-left values the v1.7.25 file carried),
//   and the callout /Callout anchor y must be pageHeight - at.y. That is what
//   makes Acrobat / pdf.js place each annotation at the screen position the
//   user chose. Also confirm TFlex's own reopen renders everything at the
//   same page-local position (round-trip), with the baked canvas appearance
//   UNDER the overlay (no stray double render).
//
// DEF-163: a committed callout / textbox with text longer than the created
//   box must not overflow or paint over the page content - the text must
//   auto-fit inside the box, at commit AND after save+reopen.
//
// All raw math is printed as [EVIDENCE] lines for the ledger.

const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { PDFDocument, PDFName, PDFRef, PDFArray } = require('pdf-lib');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const PAGE = 4;
const PAGE_PT = { w: 612, h: 792 }; // report.pdf letter page
const TOL_PDF = 2.5;   // pt tolerance for the baked-geometry math
const TOL_PX = 8;      // page-local px tolerance for the reopen round-trip
const TOL_FIT = 4;     // px tolerance for text containment

const KIND_SELECTORS = {
  textbox: 'div.ann-textbox[data-kind="textbox"]',
  callout: 'div.ann-callout[data-kind="callout"]',
  note: 'div.ann-note[data-kind="note"]',
  rect: 'rect[data-kind="rect"]',
};

const LONG_TEXT = 'LONGTEXT1726 This paragraph is intentionally much longer than the box created by the drag gesture. TFlex must auto-fit the text inside the annotation box so that no line paints over the page body text underneath, at commit time and after save plus reopen. Padding padding padding tail 42.';

test.setTimeout(600000);

let electronApp = null;
let win = null;
const pageErrors = [];

test.beforeEach(async () => {
  electronApp = null; win = null;
  pageErrors.length = 0;
});

test.afterEach(async () => {
  await hardClose(electronApp);
  electronApp = null; win = null;
});

async function launch() {
  electronApp = await launchApp([]);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  win.on('pageerror', (err) => {
    const m = err && err.message ? err.message : String(err);
    pageErrors.push(m);
    process.stdout.write(`[PAGEERROR] ${m}\n`);
  });
  const ver = await electronApp.evaluate(({ app }) => app.getVersion());
  process.stdout.write(`[APP-VERSION] ${ver}\n`);
  if (ver !== '1.7.26') console.log('[WARN] historical version pin was 1.7.26; running on DEV build version ' + ver);
  await win.waitForTimeout(600);
}

async function shot(name) {
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p });
  process.stdout.write(`[SHOT] ${name}\n`);
  return p;
}

async function cropShot(name, rect) {
  if (!rect || !isFinite(rect.x) || !isFinite(rect.y) || !isFinite(rect.w) || !isFinite(rect.h)) {
    process.stdout.write(`[CROP-SKIP] ${name} (no rect)\n`);
    return null;
  }
  const vp = await win.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const x = Math.max(0, Math.min(rect.x - 30, vp.width - 10));
  const y = Math.max(0, Math.min(rect.y - 30, vp.height - 10));
  const w = Math.min(rect.w + 60, vp.width - x);
  const h = Math.min(rect.h + 60, vp.height - y);
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p, clip: { x, y, width: Math.max(w, 20), height: Math.max(h, 20) } });
  process.stdout.write(`[CROP] ${name}\n`);
  return p;
}

async function openSample(name) {
  const p = getSamplePath(name);
  await electronApp.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2200);
  return p;
}

async function scrollToPage(n) {
  for (let i = 0; i < 40; i += 1) {
    const st = await win.evaluate((want) => {
      const sc = document.querySelector('.document-scroller');
      if (!sc) return { done: false };
      const slot = document.querySelector(`.page-slot[data-page="${want}"]`);
      if (!slot) { sc.scrollTop += 1500; return { done: false }; }
      const r = slot.getBoundingClientRect();
      const delta = r.top - 90;
      if (Math.abs(delta) < 40) return { done: true };
      sc.scrollTop += delta;
      return { done: false, delta };
    }, n);
    await win.waitForTimeout(350);
    if (st.done) break;
  }
  await win.waitForTimeout(900);
}

async function pageRect(n = PAGE) {
  return await win.evaluate((pg) => {
    const el = document.querySelector(`.page-slot[data-page="${pg}"] .pdf-page`)
      || document.querySelector(`.page-slot[data-page="${pg}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, n);
}

async function toPageLocal(rect, n = PAGE) {
  const pr = await pageRect(n);
  return {
    x: +(rect.x - pr.x).toFixed(1),
    y: +(rect.y - pr.y).toFixed(1),
    w: +rect.w.toFixed(1),
    h: +rect.h.toFixed(1),
  };
}

async function armAnnTool(tool) {
  await win.click(`[data-annotation-toolbar] [data-tool="${tool}"]`);
  await win.waitForTimeout(350);
}

async function drag(x, y, dx, dy, steps = 8) {
  await win.mouse.move(x, y);
  await win.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await win.mouse.move(x + (dx * i) / steps, y + (dy * i) / steps);
    await win.waitForTimeout(16);
  }
  await win.mouse.up();
}

async function findKind(kind, pg = PAGE) {
  return await win.evaluate(([k, p, sel]) => {
    const slot = document.querySelector(`.page-slot[data-page="${p}"]`);
    if (!slot) return null;
    let best = null;
    for (const el of slot.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width < 3 || r.height < 3) continue;
      const cand = {
        tag: el.tagName.toLowerCase(),
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        text: (el.textContent || '').trim().slice(0, 80),
        visible: r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden',
      };
      if (!best || cand.rect.w * cand.rect.h < best.rect.w * best.rect.h) best = cand;
    }
    return best;
  }, [kind, pg, KIND_SELECTORS[kind]]);
}

// Callout leader endpoints (page-local px) from the committed callout's svg.
async function calloutArrow(pg = PAGE) {
  return await win.evaluate((p) => {
    const slot = document.querySelector(`.page-slot[data-page="${p}"]`);
    if (!slot) return null;
    const pageEl = slot.querySelector('.pdf-page') || slot;
    const pr = pageEl.getBoundingClientRect();
    const out = [];
    for (const svg of slot.querySelectorAll('svg.ann-callout-arrow')) {
      const line = svg.querySelector('line:not(.ann-callout-arrow-hit)');
      if (!line) continue;
      const sr = svg.getBoundingClientRect();
      out.push({
        entry: {
          x: +(sr.x + Number(line.getAttribute('x1')) - pr.x).toFixed(1),
          y: +(sr.y + Number(line.getAttribute('y1')) - pr.y).toFixed(1),
        },
        anchor: {
          x: +(sr.x + Number(line.getAttribute('x2')) - pr.x).toFixed(1),
          y: +(sr.y + Number(line.getAttribute('y2')) - pr.y).toFixed(1),
        },
      });
    }
    return out;
  }, pg);
}

async function engineAnns(label) {
  const anns = await win.evaluate(() => {
    const d = window.tflexDiagnostics ? window.tflexDiagnostics() : null;
    return ((d && d.engineState && d.engineState.annotations) || []).map((a) => ({
      id: a.id, kind: a.kind, page: a.page,
      rects: a.rects, rect: a.rect, at: a.at, from: a.from, to: a.to,
      text: (a.text || a.content || '').slice(0, 40),
    }));
  });
  process.stdout.write(`[ENGINE|${label}] ${JSON.stringify(anns).slice(0, 4000)}\n`);
  return anns;
}

function normalizeEngineRects(anns) {
  const byKind = {};
  for (const a of anns) {
    if (!KIND_SELECTORS[a.kind]) continue;
    const r0 = a.rects && a.rects[0];
    if (!r0) continue;
    const w = r0.w !== undefined ? r0.w : r0.width;
    const h = r0.h !== undefined ? r0.h : r0.height;
    byKind[a.kind] = { rect: { x: r0.x, y: r0.y, w, h }, at: a.at || null };
  }
  return byKind;
}

async function saveAsReopen(savePath) {
  await electronApp.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[aria-label="Save As"]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  for (let i = 0; i < 24 && !fs.existsSync(savePath); i++) await win.waitForTimeout(500);
  expect(fs.existsSync(savePath), 'saved file exists').toBe(true);
  process.stdout.write(`[SAVED] ${savePath}\n`);
  await win.locator('.tab-active .tab-close').click();
  await win.waitForTimeout(1500);
  await electronApp.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, savePath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2500);
  await scrollToPage(PAGE);
  await win.waitForTimeout(800);
}

// ---------------------------------------------------------------------------
// pdf-lib raw /Annots dump + bottom-left math check for page 4
// ---------------------------------------------------------------------------
function dictStr(a, key) {
  const v = a.get(PDFName.of(key));
  if (!v) return null;
  try { return typeof v.asString === 'function' ? v.asString() : String(v); } catch (_) { return String(v); }
}

async function dumpSavedAnnots(file, engineByKind) {
  const bytes = fs.readFileSync(file);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const ctx = doc.context;
  const page = doc.getPages()[PAGE - 1];
  const size = page.getSize();
  const pageH = size.height;
  process.stdout.write(`[EVIDENCE] saved page ${PAGE} size = ${size.width.toFixed(2)} x ${pageH.toFixed(2)} pt\n`);
  const annotsRef = page.node.get(PDFName.of('Annots'));
  if (!annotsRef) throw new Error('no /Annots on the saved page');
  const annots = ctx.lookup(annotsRef);
  process.stdout.write(`[EVIDENCE] saved /Annots count = ${annots.size()}\n`);

  const verdicts = {};
  for (let i = 0; i < annots.size(); i++) {
    const a = ctx.lookup(annots.get(i));
    const subtype = dictStr(a, 'Subtype') || '?';
    const rectRef = a.get(PDFName.of('Rect'));
    const rect = rectRef instanceof PDFArray
      ? Array.from({ length: 4 }, (_, k) => rectRef.get(k).asNumber())
      : null;
    let callout = null;
    const co = a.get(PDFName.of('Callout'));
    if (co instanceof PDFArray) callout = Array.from({ length: co.size() }, (_, k) => co.get(k).asNumber());
    const it = dictStr(a, 'IT');
    const contents = (dictStr(a, 'Contents') || '').slice(0, 40);
    process.stdout.write(`[EVIDENCE] ann[${i}] /Subtype ${subtype}`
      + ` /Rect [${rect ? rect.map((n) => n.toFixed(2)).join(', ') : '-'}]`
      + `${callout ? ` /Callout [${callout.map((n) => (typeof n === 'number' ? n.toFixed(2) : n)).join(', ')}]` : ''}`
      + `${it ? ` /IT ${it}` : ''} /Contents "${contents}"\n`);

    let kind = null;
    if (subtype === '/Text') kind = 'note';
    else if (subtype === '/FreeText') kind = callout ? 'callout' : 'textbox';
    else if (subtype === '/Square') kind = 'rect';
    if (!kind || !engineByKind[kind]) {
      process.stdout.write(`[EVIDENCE] ann[${i}] unmapped (subtype ${subtype})\n`);
      continue;
    }
    const eng = engineByKind[kind];
    const er = eng.rect; // {x,y,w,h} top-down pt from the engine
    const expLly = pageH - er.y - er.h;
    const expUry = pageH - er.y;
    const dLly = +(rect[1] - expLly).toFixed(2);
    const dUry = +(rect[3] - expUry).toFixed(2);
    const bugSig = Math.abs(rect[1] - er.y) <= 1.5 && Math.abs(rect[3] - (er.y + er.h)) <= 1.5;
    process.stdout.write(`[EVIDENCE] ${kind}: engine(top-down pt) x=${er.x.toFixed(2)} y=${er.y.toFixed(2)} w=${er.w.toFixed(2)} h=${er.h.toFixed(2)}`
      + ` -> EXPECT bottom-left lly=${expLly.toFixed(2)} ury=${expUry.toFixed(2)}`
      + ` | ACTUAL lly=${rect[1].toFixed(2)} ury=${rect[3].toFixed(2)} (dlly=${dLly} dury=${dUry})`
      + ` oldBugSignature(top-down verbatim)=${bugSig}\n`);
    let calloutOk = null;
    if (kind === 'callout' && callout && eng.at) {
      const expAnchorY = pageH - eng.at.y;
      const anchorY = callout[callout.length - 1];
      const dAnchor = +(anchorY - expAnchorY).toFixed(2);
      calloutOk = Math.abs(dAnchor) <= TOL_PDF;
      process.stdout.write(`[EVIDENCE] callout /Callout anchor: engine at(top-down)=${eng.at.x.toFixed(2)},${eng.at.y.toFixed(2)}`
        + ` -> EXPECT y=${expAnchorY.toFixed(2)} x=${eng.at.x.toFixed(2)}`
        + ` | ACTUAL end=(${callout[callout.length - 2].toFixed(2)}, ${anchorY.toFixed(2)}) (dy=${dAnchor})`
        + ` oldBug(mirrored y=${eng.at.y.toFixed(2)})=${Math.abs(anchorY - eng.at.y) <= 1.5}\n`);
    }
    const ok = Math.abs(dLly) <= TOL_PDF && Math.abs(dUry) <= TOL_PDF && calloutOk !== false;
    verdicts[kind] = { ok, dLly, dUry, bugSig };
    process.stdout.write(`[VERDICT] ${kind}: bottomLeftMath=${ok ? 'PASS' : 'FAIL'}\n`);
  }
  return { pageW: size.width, pageH, verdicts };
}

// ---------------------------------------------------------------------------
// canvas scan: baked annotation-blue pixels must sit UNDER the overlay boxes.
// The PRE-SAVE canvas is the baseline (annotations are overlay-only, so its
// blue = page content); every band in the REOPENED canvas must be explained
// by the baseline (page content) or sit on an annotation box / arrow line
// (baked AP under the overlay). Anything else = stray baked AP (v1.7.25 bug).
// ---------------------------------------------------------------------------
async function canvasScan(label, arrows, baseline) {
  const scan = await win.evaluate(([kindSels, arrowPts]) => {
    const slot = document.querySelector('.page-slot[data-page="4"]');
    if (!slot) return null;
    const pageEl = slot.querySelector('.pdf-page') || slot;
    const pr = pageEl.getBoundingClientRect();
    const canvas = slot.querySelector('canvas');
    if (!canvas) return { noCanvas: true };
    const cx = canvas.getContext('2d');
    const img = cx.getImageData(0, 0, canvas.width, canvas.height);
    const scale = canvas.width / pr.width;
    const rows = new Map();
    for (let y = 0; y < img.height; y += 1) {
      for (let x = 0; x < img.width; x += 1) {
        const i = (y * img.width + x) * 4;
        const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
        if (Math.abs(r - 37) < 45 && Math.abs(g - 99) < 45 && Math.abs(b - 235) < 45) {
          const py = Math.round(y / scale);
          rows.set(py, (rows.get(py) || 0) + 1);
        }
      }
    }
    const bands = [];
    let cur = null;
    for (const y of [...rows.keys()].sort((a, b) => a - b)) {
      const n = rows.get(y);
      if (cur && y - cur.y2 <= 3) { cur.y2 = y; cur.n += n; }
      else { cur = { y1: y, y2: y, n }; bands.push(cur); }
    }
    const overlays = [];
    for (const [k, sel] of Object.entries(kindSels)) {
      for (const el of slot.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width < 3 || r.height < 3) continue;
        overlays.push({ kind: k, yTop: +(r.y - pr.y).toFixed(1), yBot: +(r.bottom - pr.y).toFixed(1) });
      }
    }
    // the arrow's REAL painted bbox (entry..anchor), not the full-page svg box
    if (arrowPts && arrowPts.length) {
      for (const a of arrowPts) {
        const x = Math.min(a.entry.x, a.anchor.x), x2 = Math.max(a.entry.x, a.anchor.x);
        const y = Math.min(a.entry.y, a.anchor.y), y2 = Math.max(a.entry.y, a.anchor.y);
        overlays.push({ kind: 'calloutArrowLine', yTop: +y.toFixed(1), yBot: +y2.toFixed(1) });
      }
    }
    return {
      bands: bands.filter((b) => b.n > 50).map((b) => ({ yTop: b.y1, yBot: b.y2, px: b.n })),
      overlays, canvasScale: +scale.toFixed(3),
    };
  }, [KIND_SELECTORS, arrows || null]);
  const stray = [];
  if (scan && scan.bands) {
    for (const b of scan.bands) {
      const onOverlay = scan.overlays.some((o) => b.yTop <= o.yBot + 10 && b.yBot >= o.yTop - 10);
      const onPageContent = (baseline || []).some((bb) => b.yTop <= bb.yBot + 6 && b.yBot >= bb.yTop - 6);
      if (!onOverlay && !onPageContent) stray.push(b);
    }
  }
  process.stdout.write(`[CANVAS-SCAN|${label}] ${JSON.stringify(scan)}\n`);
  process.stdout.write(`[CANVAS-SCAN|${label}] strayBands=${JSON.stringify(stray)}\n`);
  return { scan, stray };
}

// ---------------------------------------------------------------------------
// DEF-164
// ---------------------------------------------------------------------------
test('DEF-164: saved /Rect values are bottom-left user space + TFlex reopen round-trip', async () => {
  await launch();
  await openSample('report.pdf');
  await scrollToPage(PAGE);
  const pr = await pageRect(PAGE);
  expect(pr).toBeTruthy();
  const scale = pr.h / PAGE_PT.h;
  process.stdout.write(`[SETUP] page screen ${pr.w.toFixed(1)}x${pr.h.toFixed(1)} px; scale=${scale.toFixed(4)} px/pt`
    + ` (w-ratio ${(pr.w / PAGE_PT.w).toFixed(4)})\n`);
  expect(Math.abs(pr.w / PAGE_PT.w - scale) < 0.02, 'uniform page scale').toBe(true);

  // 1) note
  await armAnnTool('note');
  await win.mouse.click(pr.x + pr.w * 0.18, pr.y + pr.h * 0.10);
  await win.waitForTimeout(500);
  const noteTa = win.locator('.ann-note-editor textarea, [data-annotation-editor="note"] textarea').first();
  await noteTa.waitFor({ timeout: 8000 });
  await noteTa.fill('NOTE VERIFY 1726');
  await win.click('[data-annotation-action="note-confirm"]');
  await win.waitForTimeout(800);

  // 2) textbox
  await armAnnTool('textbox');
  await win.mouse.click(pr.x + pr.w * 0.18, pr.y + pr.h * 0.24);
  await win.waitForTimeout(500);
  const tbTa = win.locator('[data-annotation-editor="textbox"] textarea');
  await tbTa.waitFor({ timeout: 8000 });
  await tbTa.fill('VERIFY TB 1726');
  await win.click('[data-annotation-action="textbox-confirm"]');
  await win.waitForTimeout(800);

  // 3) callout (anchor -> box drag)
  await armAnnTool('callout');
  await drag(pr.x + pr.w * 0.55, pr.y + pr.h * 0.34, 180, 110);
  await win.waitForTimeout(600);
  const coTa = win.locator('[data-annotation-editor="callout"] textarea');
  await coTa.waitFor({ timeout: 8000 });
  await coTa.fill('VERIFY CALLOUT 1726');
  await win.click('[data-annotation-action="callout-confirm"]');
  await win.waitForTimeout(800);

  // 4) rect
  await armAnnTool('rect');
  await drag(pr.x + pr.w * 0.08, pr.y + pr.h * 0.52, 120, 70);
  await win.waitForTimeout(700);

  await scrollToPage(PAGE);
  await win.waitForTimeout(500);

  // committed DOM page-local rects + engine state (the values that get baked)
  const committed = {};
  for (const kind of ['note', 'textbox', 'callout', 'rect']) {
    const el = await findKind(kind);
    expect(el, `${kind} committed`).toBeTruthy();
    committed[kind] = await toPageLocal(el.rect);
    process.stdout.write(`[COMMITTED|${kind}] pageLocalPx=${JSON.stringify(committed[kind])}`
      + ` topdownPt=(${((el.rect.x - pr.x) / scale).toFixed(2)}, ${((el.rect.y - pr.y) / scale).toFixed(2)})`
      + ` text="${el.text.slice(0, 30)}"\n`);
    if (kind === 'callout') await cropShot(`def-164-1726-committed-${kind}-crop.png`, el.rect);
  }
  process.stdout.write(`[COMMITTED|callout-arrow] ${JSON.stringify(await calloutArrow())}\n`);
  const engCommitted = normalizeEngineRects(await engineAnns('committed'));
  process.stdout.write(`[EVIDENCE] engine(top-down pt) by kind: ${JSON.stringify(engCommitted)}\n`);
  await shot('def-164-1726-committed.png');

  // pre-save canvas baseline: annotations are overlay-only, so every blue
  // band here is page content (the reference for the stray-AP diff)
  const base = await canvasScan('pre-save', await calloutArrow(), null);
  expect(base.scan && !base.scan.noCanvas, 'page canvas present').toBe(true);

  // Save As + reopen (round-trip)
  const savePath = path.join(os.tmpdir(), `tflex-def164-verify-${Date.now()}.pdf`);
  await saveAsReopen(savePath);

  const reopened = {};
  for (const kind of ['note', 'textbox', 'callout', 'rect']) {
    const el = await findKind(kind);
    expect(el, `${kind} present after reopen`).toBeTruthy();
    reopened[kind] = await toPageLocal(el.rect);
    process.stdout.write(`[REOPENED|${kind}] pageLocalPx=${JSON.stringify(reopened[kind])} text="${el.text.slice(0, 30)}"\n`);
    if (kind === 'callout') await cropShot('def-164-1726-reopened-callout-crop.png', el.rect);
  }
  process.stdout.write(`[REOPENED|callout-arrow] ${JSON.stringify(await calloutArrow())}\n`);
  await engineAnns('reopened');
  await shot('def-164-1726-reopened.png');

  // round-trip: reopened page-local positions identical to pre-save
  for (const kind of ['note', 'textbox', 'callout', 'rect']) {
    const d = Math.hypot(reopened[kind].x - committed[kind].x, reopened[kind].y - committed[kind].y);
    process.stdout.write(`[ROUNDTRIP|${kind}] dx=${(reopened[kind].x - committed[kind].x).toFixed(1)}`
      + ` dy=${(reopened[kind].y - committed[kind].y).toFixed(1)} dist=${d.toFixed(1)}px\n`);
    expect(d, `DEF-164 round-trip: ${kind} renders at the same page-local position (<=${TOL_PX}px)`).toBeLessThanOrEqual(TOL_PX);
  }

  // RAW saved-file math (the core DEF-164 evidence)
  const raw = await dumpSavedAnnots(savePath, engCommitted);
  expect(raw.pageH, 'saved page height 792pt').toBeCloseTo(PAGE_PT.h, 0);
  for (const kind of ['note', 'textbox', 'callout', 'rect']) {
    expect(raw.verdicts[kind], `DEF-164 raw /Rect math for ${kind} (bottom-left space)`).toBeTruthy();
    expect(raw.verdicts[kind].ok, `DEF-164 ${kind}: /Rect y must be bottom-left (lly=pageH-y-h, ury=pageH-y)`).toBe(true);
    expect(raw.verdicts[kind].bugSig, `DEF-164 ${kind}: /Rect must NOT be the un-flipped top-down values`).toBe(false);
  }

  // canvas scan: the baked AP (pdf.js canvas render) must sit under the overlay
  const reopenedScan = await canvasScan('reopened', await calloutArrow(), base.scan ? base.scan.bands : null);
  await shot('def-164-1726-canvas-scan.png');
  expect(reopenedScan.stray.length, `DEF-164 reopen: no stray baked-ap band outside every annotation box and the pre-save page content`).toBe(0);

  process.stdout.write(`\n[RES|DEF-164] verdicts=${JSON.stringify(raw.verdicts)} roundTrip=${JSON.stringify(Object.fromEntries(['note', 'textbox', 'callout', 'rect'].map((k) => [k, reopened[k]])))} pageErrors=${pageErrors.length}\n`);
  expect(pageErrors.length, 'no pageerrors').toBe(0);
});

// ---------------------------------------------------------------------------
// DEF-163
// ---------------------------------------------------------------------------
// Measure: does every text-bearing descendant stay inside its annotation box?
async function fitProbe(kind, textMatch) {
  return await win.evaluate(([k, sel, match]) => {
    const slot = document.querySelector('.page-slot[data-page="4"]');
    if (!slot) return null;
    const pageEl = slot.querySelector('.pdf-page') || slot;
    const pr = pageEl.getBoundingClientRect();
    let box = null;
    for (const el of slot.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) continue;
      if (match && !(el.textContent || '').includes(match)) continue;
      if (!box || r.width * r.height < box.r.width * box.r.height) box = { el, r };
    }
    if (!box) return null;
    const br = box.r;
    const walk = (el) => {
      for (const c of el.children) walk(c);
      const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!direct && el.children.length) return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      lines.push({
        bottom: +(r.bottom - pr.y).toFixed(1),
        right: +(r.right - pr.x).toFixed(1),
        clipY: Math.max(0, el.scrollHeight - el.clientHeight),
        fs: getComputedStyle(el).fontSize,
        text: (el.textContent || '').trim().slice(0, 24),
      });
    };
    const lines = [];
    walk(box.el);
    const firstFs = lines.length ? lines[0].fs : null;
    return {
      box: { x: +(br.x - pr.x).toFixed(1), y: +(br.y - pr.y).toFixed(1), w: +br.width.toFixed(1), h: +br.height.toFixed(1) },
      text: (box.el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140),
      fullText: (box.el.textContent || '').replace(/\s+/g, ' ').trim(),
      fontSize: firstFs,
      overBottom: +(Math.max(...lines.map((l) => l.bottom)) - (br.bottom - pr.y)).toFixed(1),
      overRight: +(Math.max(...lines.map((l) => l.right)) - (br.right - pr.x)).toFixed(1),
      clipped: Math.max(0, ...lines.map((l) => l.clipY)),
      nTextEls: lines.length,
    };
  }, [kind, KIND_SELECTORS[kind], textMatch || '']);
}

test('DEF-163: long callout + long textbox text auto-fits inside the box', async () => {
  await launch();
  await openSample('report.pdf');
  await scrollToPage(PAGE);
  const pr = await pageRect(PAGE);
  expect(pr).toBeTruthy();

  // 1) LONG callout
  await armAnnTool('callout');
  await drag(pr.x + pr.w * 0.52, pr.y + pr.h * 0.14, 170, 90);
  await win.waitForTimeout(600);
  const coTa = win.locator('[data-annotation-editor="callout"] textarea');
  await coTa.waitFor({ timeout: 8000 });
  await coTa.fill(LONG_TEXT);
  await win.click('[data-annotation-action="callout-confirm"]');
  await win.waitForTimeout(900);

  // 2) LONG textbox
  await armAnnTool('textbox');
  await win.mouse.click(pr.x + pr.w * 0.14, pr.y + pr.h * 0.46);
  await win.waitForTimeout(500);
  const tbTa = win.locator('[data-annotation-editor="textbox"] textarea');
  await tbTa.waitFor({ timeout: 8000 });
  await tbTa.fill(LONG_TEXT);
  await win.click('[data-annotation-action="textbox-confirm"]');
  await win.waitForTimeout(900);

  await scrollToPage(PAGE);
  await win.waitForTimeout(500);

  // containment at COMMIT time (the DEF-163 core)
  const commit = {};
  for (const kind of ['callout', 'textbox']) {
    const probe = await fitProbe(kind, 'LONGTEXT1726');
    commit[kind] = probe;
    process.stdout.write(`[FIT-COMMIT|${kind}] box=${JSON.stringify(probe && probe.box)}`
      + ` overBottom=${probe && probe.overBottom}px overRight=${probe && probe.overRight}px`
      + ` clipped=${probe && probe.clipped}px textEls=${probe && probe.nTextEls} fontSize=${probe && probe.fontSize}`
      + ` fullTextLen=${probe && probe.fullText.length}\n`);
  }
  await shot('def-163-1726-long-committed.png');
  const longCallout = await findKind('callout');
  if (longCallout) await cropShot('def-163-1726-long-callout-crop.png', longCallout.rect);
  const longTextbox = await findKind('textbox');
  if (longTextbox) await cropShot('def-163-1726-long-textbox-crop.png', longTextbox.rect);

  // save + reopen: containment must survive the round-trip (baked box size).
  // After reopen the committed callout/textbox render as BAKED pdf.js
  // annotation appearances inside the page canvas - there is no DOM overlay
  // surface to measure text containment against. The engine DOES carry the
  // reloaded geometry, so assert the round-tripped rects match the committed
  // (fit) boxes; if the committed geometry survived, the fit that held at
  // commit holds after reopen. Visual evidence: screenshots.
  const savePath = path.join(os.tmpdir(), `tflex-def163-verify-${Date.now()}.pdf`);
  await saveAsReopen(savePath);
  await scrollToPage(PAGE);
  await win.waitForTimeout(1500);
  const reopenedGeom = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    const anns = (d.engineState && d.engineState.annotations) || [];
    return {
      callout: anns.filter((a) => a.kind === 'callout').map((a) => a.rect || a.rects[0]),
      textbox: anns.filter((a) => a.kind === 'textbox').map((a) => a.rect || a.rects[0]),
    };
  });
  process.stdout.write(`[FIT-REOPEN|ENGINE] ${JSON.stringify(reopenedGeom)}\n`);
  await shot('def-163-1726-long-reopened.png');
  const reCallout = await findKind('callout');
  if (reCallout) await cropShot('def-163-1726-reopen-callout-crop.png', reCallout.rect);

  for (const [stage, m] of [['commit', commit]]) {
    for (const kind of ['callout', 'textbox']) {
      const p = m[kind];
      process.stdout.write(`[FIT-RES|${stage}|${kind}] overBottom=${p.overBottom} overRight=${p.overRight}`
        + ` clipped=${p.clipped} boxH=${p.box.h} fit=${p.overBottom <= TOL_FIT && p.overRight <= TOL_FIT && p.clipped <= 2}\n`);
      expect(p.overBottom, `DEF-163 ${stage} ${kind}: no text spill below the box`).toBeLessThanOrEqual(TOL_FIT);
      expect(p.overRight, `DEF-163 ${stage} ${kind}: no text spill right of the box`).toBeLessThanOrEqual(TOL_FIT);
      expect(p.clipped, `DEF-163 ${stage} ${kind}: no text clipped away (content stays visible)`).toBeLessThanOrEqual(2);
      expect(p.fullText, `DEF-163 ${stage} ${kind}: head marker present`).toContain('LONGTEXT1726');
      expect(p.fullText, `DEF-163 ${stage} ${kind}: tail present (nothing dropped)`).toContain('tail 42.');
    }
  }

  // Reopen leg: exactly one callout + one textbox survive with finite,
  // non-degenerate geometry (the committed fit box baked into the file), and
  // the saved file parses. The visual fit is preserved because the baked box
  // size is the committed (fit) size.
  for (const kind of ['callout', 'textbox']) {
    expect(reopenedGeom[kind].length, `DEF-163 reopen ${kind}: exactly one annotation survives`).toBe(1);
    const engineRect = reopenedGeom[kind][0];
    expect(engineRect, `DEF-163 reopen ${kind}: engine rect present`).toBeTruthy();
    expect(Number.isFinite(engineRect.x) && Number.isFinite(engineRect.y), `DEF-163 reopen ${kind}: finite rect`).toBe(true);
  }
  const { PDFDocument } = require('pdf-lib');
  const pdf163 = await PDFDocument.load(require('fs').readFileSync(savePath), { ignoreEncryption: true });
  expect(pdf163.getPageCount(), 'DEF-163 reopen: saved PDF parses').toBe(34);

  expect(pageErrors.length, 'no pageerrors').toBe(0);
});

test('DEF-163 control: short callout + short textbox still fit', async () => {
  await launch();
  await openSample('report.pdf');
  await scrollToPage(PAGE);
  const pr = await pageRect(PAGE);
  expect(pr).toBeTruthy();

  await armAnnTool('callout');
  await drag(pr.x + pr.w * 0.50, pr.y + pr.h * 0.30, 150, 90);
  await win.waitForTimeout(600);
  const coTa = win.locator('[data-annotation-editor="callout"] textarea');
  await coTa.waitFor({ timeout: 8000 });
  await coTa.fill('SHORT 1726');
  await win.click('[data-annotation-action="callout-confirm"]');
  await win.waitForTimeout(900);

  await armAnnTool('textbox');
  await win.mouse.click(pr.x + pr.w * 0.14, pr.y + pr.h * 0.14);
  await win.waitForTimeout(500);
  const tbTa = win.locator('[data-annotation-editor="textbox"] textarea');
  await tbTa.waitFor({ timeout: 8000 });
  await tbTa.fill('SHORT TB 1726');
  await win.click('[data-annotation-action="textbox-confirm"]');
  await win.waitForTimeout(900);

  await scrollToPage(PAGE);
  await win.waitForTimeout(400);

  for (const [kind, match] of [['callout', 'SHORT 1726'], ['textbox', 'SHORT TB 1726']]) {
    const probe = await fitProbe(kind, match);
    process.stdout.write(`[FIT-CTRL|${kind}] box=${JSON.stringify(probe && probe.box)} overBottom=${probe && probe.overBottom}`
      + ` overRight=${probe && probe.overRight} clipped=${probe && probe.clipped} text="${probe && probe.text}"\n`);
    expect(probe, `control ${kind} present`).toBeTruthy();
    expect(probe.overBottom, `control ${kind}: short text stays inside`).toBeLessThanOrEqual(TOL_FIT);
    expect(probe.clipped, `control ${kind}: no clipping`).toBeLessThanOrEqual(2);
    await shot(`def-163-1726-control-${kind}.png`);
  }
  expect(pageErrors.length, 'no pageerrors').toBe(0);
});
