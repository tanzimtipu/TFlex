// QA verification spec for DEF-165 / DEF-166 on the installed v1.7.28 build.
//
// DEF-165: a committed rect + ellipse must SAVE with a translucent fill. On the
//   saved file (raw pdf-lib dump + third-party pdf.js render, see
//   def_165_166_thirdparty_1728.cjs):
//     - the shape must carry an /AP /N appearance stream whose ExtGState /ca
//       is the 10% fill alpha (no solid /IC painting an opaque block);
//     - the v1.7.27 bug signature must be GONE: no inline "0.1 ca" token in the
//       /N content stream (invalid operator) - the alpha must travel via an
//       ExtGState dict invoked with gs;
//     - pdf.js's own operator list must paint every annotation-blue fill
//       under ExtGState ca ~0.1 (never full alpha);
//     - the third-party PIXEL render must keep the page text behind the shape
//       visible (no opaque block) - measured against the pristine sample.
//   Plus: TFlex's own reopen shows no solid block, and the bake keeps the
//   DEF-164 bottom-left /Rect math (regression, the save path changed).
//
// DEF-166: reopen a saved file with a callout + textbox - the annotation text
//   must render ONCE. v1.7.26 doubled it via DOM overlay + baked AP; v1.7.27
//   moved the doubling INSIDE the page canvas (empty DOM, canvas painted the
//   text twice with an offset) while the plain source-count check alone would
//   have passed - so this round adds a mechanical DOUBLING detector: the dark
//   mask of the TFlex canvas text region is self-shift-correlated (1..6 px)
//   and compared against a plain pdf.js render of the SAME saved file at the
//   SAME scale (def_166_canvas_witness_1728.cjs). A single render decorrelates
//   fast; two offset copies overlap strongly at their offset.
//
// All raw math is printed as [EVIDENCE]/[VERDICT] lines for the ledger.

const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { PDFDocument, PDFName, PDFArray } = require('pdf-lib');

const EXE_PATH = 'C:\\Users\\tanzi\\AppData\\Local\\Programs\\tflex\\TFlex.exe';
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const PROJ = path.resolve(__dirname, '..', '..');
const TP_SCRIPT = path.join(__dirname, 'def_165_166_thirdparty_1728.cjs');
const TP_WITNESS = path.join(__dirname, 'def_166_canvas_witness_1728.cjs');
const PAGE = 4;
const PAGE_PT = { w: 612, h: 792 }; // report.pdf letter page
const TOL_PX = 8; // page-local px tolerance for the reopen round-trip

const KIND_SELECTORS = {
  textbox: 'div.ann-textbox[data-kind="textbox"]',
  callout: 'div.ann-callout[data-kind="callout"]',
  note: 'div.ann-note[data-kind="note"]',
  rect: 'rect[data-kind="rect"]',
  ellipse: 'ellipse[data-kind="ellipse"]',
};

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
  electronApp = await launchApp([], null, EXE_PATH);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  win.on('pageerror', (err) => {
    const m = err && err.message ? err.message : String(err);
    pageErrors.push(m);
    process.stdout.write(`[PAGEERROR] ${m}\n`);
  });
  const ver = await electronApp.evaluate(({ app }) => app.getVersion());
  process.stdout.write(`[APP-VERSION] ${ver}\n`);
  expect(ver, 'installed app must be 1.7.28').toBe('1.7.28');
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

async function shapeFillInfo(sel) {
  return await win.evaluate((s) => {
    const slot = document.querySelector('.page-slot[data-page="4"]');
    if (!slot) return null;
    for (const el of slot.querySelectorAll(s)) {
      const r = el.getBoundingClientRect();
      if (r.width < 3) continue;
      const cs = getComputedStyle(el);
      return { fill: cs.fill, stroke: cs.stroke, w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
    }
    return null;
  }, sel);
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

// near-annotation-blue (#2563eb) pixel count inside a page-local region of the
// page canvas (the canvas only ever contains pdf.js paint, never DOM overlays)
async function canvasRegionBlue(region) {
  return await win.evaluate((reg) => {
    const slot = document.querySelector('.page-slot[data-page="4"]');
    if (!slot) return { noSlot: true };
    const pageEl = slot.querySelector('.pdf-page') || slot;
    const pr = pageEl.getBoundingClientRect();
    const canvas = slot.querySelector('canvas');
    if (!canvas) return { noCanvas: true };
    const cx = canvas.getContext('2d');
    const img = cx.getImageData(0, 0, canvas.width, canvas.height);
    const scale = canvas.width / pr.width;
    const x0 = Math.max(0, Math.floor(reg.x * scale));
    const x1 = Math.min(canvas.width, Math.ceil((reg.x + reg.w) * scale));
    const y0 = Math.max(0, Math.floor(reg.y * scale));
    const y1 = Math.min(canvas.height, Math.ceil((reg.y + reg.h) * scale));
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * canvas.width + x) * 4;
        const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
        if (Math.abs(r - 37) < 50 && Math.abs(g - 99) < 50 && Math.abs(b - 235) < 50) n++;
      }
    }
    return { count: n, area: (x1 - x0) * (y1 - y0), canvasScale: +scale.toFixed(3) };
  }, region);
}

// Which text runs of an annotation element are actually PAINTED (visible,
// non-transparent, non-zero size)? Detects a DOM overlay text source even if
// the fix hides it via opacity/visibility/color-alpha.
async function textPaintProbe(sel, marker) {
  return await win.evaluate(([s, m]) => {
    const slot = document.querySelector('.page-slot[data-page="4"]');
    if (!slot) return { found: false };
    const pageEl = slot.querySelector('.pdf-page') || slot;
    const pr = pageEl.getBoundingClientRect();
    let ann = null, best = null;
    for (const el of slot.querySelectorAll(s)) {
      const r = el.getBoundingClientRect();
      if (r.width < 10 || r.height < 10) continue;
      if (!best || r.width * r.height < best.getBoundingClientRect().width * best.getBoundingClientRect().height) best = el;
      if ((el.textContent || '').includes(m)) { ann = el; break; }
    }
    if (!ann) ann = best;
    if (!ann) return { found: false };
    const runs = [];
    const walk = (el) => {
      const direct = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (direct) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const cm = cs.color.match(/rgba?\([^)]*\)/);
        let alpha = 1;
        if (cm && cm[0].split(',').length === 4) alpha = parseFloat(cm[0].split(',')[3]);
        runs.push({
          text: (el.textContent || '').trim().slice(0, 40),
          painted: r.width > 1 && r.height > 1 && cs.visibility === 'visible'
            && parseFloat(cs.opacity) > 0.05 && alpha > 0.05 && parseFloat(cs.fontSize) >= 2,
          vis: cs.visibility, opacity: cs.opacity, color: cs.color, fs: cs.fontSize,
          rect: { x: +(r.x - pr.x).toFixed(1), y: +(r.y - pr.y).toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
        });
      }
      for (const c of el.children) walk(c);
    };
    walk(ann);
    const ar = ann.getBoundingClientRect();
    return {
      found: true,
      hasMarker: (ann.textContent || '').includes(m),
      paintedWithMarker: runs.some((r) => r.painted && r.text.includes(m.slice(0, 10))),
      runs: runs.slice(0, 8),
      box: { x: +(ar.x - pr.x).toFixed(1), y: +(ar.y - pr.y).toFixed(1), w: +ar.width.toFixed(1), h: +ar.height.toFixed(1) },
    };
  }, [sel, marker]);
}

function shrink(r, px) {
  return { x: r.x + px, y: r.y + px, w: Math.max(4, r.w - 2 * px), h: Math.max(4, r.h - 2 * px) };
}

// ---------------------------------------------------------------------------
// DEF-166 mechanical doubling detector, run on TFLEX's OWN page canvas in the
// page. Same math as def_166_canvas_witness_1728.cjs (identical thresholds and
// shift set) so the numbers are directly comparable: dark mask (lum < 150) of
// the text region, overlapped with itself under all 1..6 px shifts. Also
// extracts the region as a PNG crop for visual judgement.
// ---------------------------------------------------------------------------
async function canvasRegionSelfOverlap(region, cropName) {
  const res = await win.evaluate((reg) => {
    const slot = document.querySelector('.page-slot[data-page="4"]');
    if (!slot) return { noSlot: true };
    const pageEl = slot.querySelector('.pdf-page') || slot;
    const pr = pageEl.getBoundingClientRect();
    const canvas = slot.querySelector('canvas');
    if (!canvas) return { noCanvas: true };
    const scale = canvas.width / pr.width;
    const x0 = Math.max(0, Math.floor(reg.x * scale));
    const y0 = Math.max(0, Math.floor(reg.y * scale));
    const w = Math.max(2, Math.ceil(reg.w * scale));
    const h = Math.max(2, Math.ceil(reg.h * scale));
    const img = canvas.getContext('2d').getImageData(x0, y0, w, h);
    const dark = new Uint8Array(w * h);
    let darkCount = 0;
    for (let i = 0; i < w * h; i++) {
      const l = 0.2126 * img.data[i * 4] + 0.7152 * img.data[i * 4 + 1] + 0.0722 * img.data[i * 4 + 2];
      if (l < 150) { dark[i] = 1; darkCount++; }
    }
    let maxOv = 0, arg = null;
    for (let dy = -6; dy <= 6; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        if (!dx && !dy) continue;
        let inter = 0;
        for (let y = 0; y < h; y++) {
          const sy = y + dy;
          if (sy < 0 || sy >= h) continue;
          for (let x = 0; x < w; x++) {
            const sx = x + dx;
            if (sx < 0 || sx >= w) continue;
            if (dark[y * w + x] && dark[sy * w + sx]) inter++;
          }
        }
        const ov = darkCount ? inter / darkCount : 0;
        if (ov > maxOv) { maxOv = ov; arg = { dx, dy }; }
      }
    }
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    tmp.getContext('2d').drawImage(canvas, x0, y0, w, h, 0, 0, w, h);
    return {
      w, h, darkCount,
      darkFrac: +(darkCount / (w * h)).toFixed(4),
      maxSelfOverlap: +maxOv.toFixed(3),
      argShift: arg,
      scale: +scale.toFixed(4),
      crop: tmp.toDataURL('image/png'),
    };
  }, region);
  if (res.crop) {
    fs.writeFileSync(path.join(SHOTS, cropName), Buffer.from(res.crop.split(',')[1], 'base64'));
    process.stdout.write(`[CANVAS-CROP] ${cropName}\n`);
  }
  return res;
}

// third-party witness for DEF-165 (separate Node process: pdf.js render + raw dict dump)
function runThirdParty(savePath) {
  const baseline = path.join(PROJ, 'assets', 'samples', 'report.pdf');
  const out = execFileSync(
    process.execPath,
    [TP_SCRIPT, savePath, baseline, SHOTS, String(PAGE)],
    { encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024 },
  );
  const lines = out.split('\n').filter((l) => l.startsWith('[TP-JSON] '));
  if (!lines.length) {
    process.stdout.write(`[TP-RAW] ${out}\n`);
    throw new Error('third-party witness produced no [TP-JSON] line (see stdout above)');
  }
  return JSON.parse(lines[lines.length - 1].slice('[TP-JSON] '.length));
}

// third-party canvas witness for DEF-166: plain pdf.js render of the SAME saved
// file at the SAME scale, same regions -> the single-render control numbers.
function runCanvasWitness(savePath, regions, scale) {
  const baseline = path.join(PROJ, 'assets', 'samples', 'report.pdf');
  const out = execFileSync(
    process.execPath,
    [TP_WITNESS, savePath, baseline, String(scale), JSON.stringify(regions), SHOTS],
    { encoding: 'utf8', timeout: 180000, maxBuffer: 64 * 1024 * 1024 },
  );
  const lines = out.split('\n').filter((l) => l.startsWith('[TP-JSON] '));
  if (!lines.length) {
    process.stdout.write(`[WITNESS-RAW] ${out}\n`);
    throw new Error('canvas witness produced no [TP-JSON] line (see stdout above)');
  }
  return JSON.parse(lines[lines.length - 1].slice('[TP-JSON] '.length));
}

// ---------------------------------------------------------------------------
// raw /Annots bottom-left math check (DEF-164 regression after the save-path fix)
// ---------------------------------------------------------------------------
function dictStr(a, key) {
  const v = a.get(PDFName.of(key));
  if (!v) return null;
  try { return typeof v.asString === 'function' ? v.asString() : String(v); } catch (_) { return String(v); }
}

async function dumpSavedAnnotsMath(file, engineByKind) {
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
    else if (subtype === '/Circle') kind = 'ellipse';
    if (!kind || !engineByKind[kind]) {
      process.stdout.write(`[EVIDENCE] ann[${i}] unmapped (subtype ${subtype})\n`);
      continue;
    }
    const eng = engineByKind[kind];
    const er = eng.rect;
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
      calloutOk = Math.abs(dAnchor) <= 2.5;
      process.stdout.write(`[EVIDENCE] callout /Callout anchor: engine at(top-down)=${eng.at.x.toFixed(2)},${eng.at.y.toFixed(2)}`
        + ` -> EXPECT y=${expAnchorY.toFixed(2)} | ACTUAL end=(${callout[callout.length - 2].toFixed(2)}, ${anchorY.toFixed(2)}) (dy=${dAnchor})\n`);
    }
    const ok = Math.abs(dLly) <= 2.5 && Math.abs(dUry) <= 2.5 && calloutOk !== false;
    verdicts[kind] = { ok, dLly, dUry, bugSig };
    process.stdout.write(`[VERDICT] ${kind}: bottomLeftMath=${ok ? 'PASS' : 'FAIL'}\n`);
  }
  return { pageH, verdicts };
}

// ---------------------------------------------------------------------------
// DEF-165
// ---------------------------------------------------------------------------
test('DEF-165: saved rect + ellipse fill is translucent (AP ca 0.1), page text stays visible in a third-party view', async () => {
  await launch();
  await openSample('report.pdf');
  await scrollToPage(PAGE);
  const pr = await pageRect(PAGE);
  expect(pr).toBeTruthy();
  const scale = pr.h / PAGE_PT.h;
  process.stdout.write(`[SETUP] page screen ${pr.w.toFixed(1)}x${pr.h.toFixed(1)} px; scale=${scale.toFixed(4)} px/pt\n`);

  // 1) rect over body text
  await armAnnTool('rect');
  await drag(pr.x + pr.w * 0.08, pr.y + pr.h * 0.52, 120, 70);
  await win.waitForTimeout(700);

  // 2) ellipse over body text
  await armAnnTool('ellipse');
  await drag(pr.x + pr.w * 0.34, pr.y + pr.h * 0.52, 110, 60);
  await win.waitForTimeout(700);

  await scrollToPage(PAGE);
  await win.waitForTimeout(400);

  // committed state: the overlay must still show the 10% tint the user placed
  const committed = {};
  for (const kind of ['rect', 'ellipse']) {
    const el = await findKind(kind);
    expect(el, `${kind} committed`).toBeTruthy();
    committed[kind] = await toPageLocal(el.rect);
    const fill = await shapeFillInfo(KIND_SELECTORS[kind]);
    process.stdout.write(`[COMMITTED|${kind}] pageLocalPx=${JSON.stringify(committed[kind])}`
      + ` computedFill=${fill && fill.fill} computedStroke=${fill && fill.stroke}`
      + ` screenPx=${fill && fill.w}x${fill && fill.h}\n`);
    expect(fill && /0\.1\)/.test(fill.fill), `${kind} committed DOM fill carries the 10% alpha`).toBe(true);
    await cropShot(`def-165-1728-committed-${kind}-crop.png`, el.rect);
  }
  const engCommitted = normalizeEngineRects(await engineAnns('committed'));
  process.stdout.write(`[EVIDENCE] engine(top-down pt) by kind: ${JSON.stringify(engCommitted)}\n`);
  await shot('def-165-1728-committed.png');

  // Save As + reopen in TFlex (round-trip)
  const savePath = path.join(os.tmpdir(), `tflex-def165-verify-${Date.now()}.pdf`);
  await saveAsReopen(savePath);
  fs.copyFileSync(savePath, path.join(PROJ, 'test-fixtures', 'annot-shape-alpha-roundtrip-1728.pdf'));

  const reopened = {};
  for (const kind of ['rect', 'ellipse']) {
    const el = await findKind(kind);
    expect(el, `${kind} present after reopen`).toBeTruthy();
    reopened[kind] = await toPageLocal(el.rect);
    process.stdout.write(`[REOPENED|${kind}] pageLocalPx=${JSON.stringify(reopened[kind])}\n`);
    await cropShot(`def-165-1728-reopened-${kind}-crop.png`, el.rect);
  }
  await shot('def-165-1728-reopened.png');
  for (const kind of ['rect', 'ellipse']) {
    const d = Math.hypot(reopened[kind].x - committed[kind].x, reopened[kind].y - committed[kind].y);
    process.stdout.write(`[ROUNDTRIP|${kind}] dist=${d.toFixed(1)}px\n`);
    expect(d, `DEF-165 round-trip: ${kind} position (<=${TOL_PX}px)`).toBeLessThanOrEqual(TOL_PX);
  }

  // in-app reopen: the pdf.js canvas under each shape interior must not be a
  // solid annotation-blue block (v1.7.26 bug: nearly the whole interior was)
  for (const kind of ['rect', 'ellipse']) {
    const r = reopened[kind];
    const interior = kind === 'ellipse'
      ? { x: r.x + r.w * 0.17, y: r.y + r.h * 0.17, w: r.w * 0.66, h: r.h * 0.66 }
      : shrink(r, 6);
    const scan = await canvasRegionBlue(interior);
    const frac = scan.count / Math.max(1, scan.area);
    process.stdout.write(`[INAPP-INTERIOR|${kind}] nearBlue=${scan.count} of ${scan.area} px`
      + ` (${(frac * 100).toFixed(1)}%) region=${JSON.stringify(interior)}\n`);
    expect(frac, `in-app reopen: ${kind} interior is NOT a solid blue block (<5% near-blue pixels)`).toBeLessThan(0.05);
  }

  // RAW file + third-party pdf.js witness
  const tp = runThirdParty(savePath);
  process.stdout.write(`[TP] ${JSON.stringify(tp)}\n`);

  // dict level: /AP /N appearance stream with the 10% fill alpha ExtGState,
  // and no inline "0.1 ca" token (the v1.7.27 bug signature).
  for (const tag of ['rect', 'ellipse']) {
    const sh = tp.shapes[tag === 'rect' ? 'Square' : 'Circle'];
    expect(sh, `saved file carries the ${tag} annotation (${tag === 'rect' ? '/Square' : '/Circle'})`).toBeTruthy();
    process.stdout.write(`[DICT|${tag}] /Rect [${(sh.rect || []).map((n) => +n.toFixed(2)).join(', ')}]`
      + ` /IC=${JSON.stringify(sh.ic)} apN=${JSON.stringify(sh.apN && sh.apN.stream)}`
      + ` gsInvoked=${JSON.stringify(sh.apN && sh.apN.gsInvoked)} gsEntries=${JSON.stringify(sh.apN && sh.apN.gsEntries)}`
      + ` fillOps=${JSON.stringify(sh.apN && sh.apN.fillOps)}`
      + ` inlineCaToken=${JSON.stringify(sh.apN && sh.apN.inlineCaToken)}\n`);
    if (sh.apN && sh.apN.head) process.stdout.write(`[DICT-AP-HEAD|${tag}] ${sh.apN.head}\n`);
    expect(sh.apN && sh.apN.stream, `DEF-165: ${tag} carries an /AP /N appearance stream`).toBe(true);
    expect(sh.apN.inlineCaToken, `DEF-165: ${tag} /AP /N must NOT carry the v1.7.27 inline "0.1 ca" operator`).toBe(false);
    const usedNames = (sh.apN.gsInvoked || []).map((s) => s.split(' ')[0]);
    const usedCaVals = (sh.apN.gsEntries || [])
      .filter((e) => usedNames.includes(e.name))
      .map((e) => e.ca)
      .filter((v) => typeof v === 'number');
    process.stdout.write(`[DICT-CA|${tag}] used gs ca values=${JSON.stringify(usedCaVals)}\n`);
    expect(usedCaVals.some((v) => v >= 0.05 && v <= 0.15), `DEF-165: ${tag} /AP ExtGState fill alpha ca ~0.1`).toBe(true);
  }

  // pdf.js operator list: if any annotation-blue FILL op is present, every one
  // of them must sit under ExtGState ca ~0.1 (never full alpha). pdf.js may
  // also route the fill through other ops - the dict ca + pixel metrics below
  // carry the verdict either way.
  const fills = tp.oplShapeFills || [];
  process.stdout.write(`[OPL] annotation-blue fill ops (paint-time ca): ${JSON.stringify(fills)}\n`);
  // v1.7.27 bug signature: the shape fill PAINTS at full alpha. v1.7.28 paints
  // under the ExtGState ca 0.1. (The blue rg token itself may legally appear
  // before the gs call - attribution must be at paint time, modeled with
  // save/restore; validated on the 1727 fixture = paints ca=1, 1728 = ca=0.1.)
  expect(fills.length, `DEF-165: pdf.js paints the shape fill(s) (got ${JSON.stringify(fills)})`).toBeGreaterThanOrEqual(1);
  for (const f of fills) {
    expect(f.ca, `DEF-165: pdf.js fill of the shape color PAINTS under ExtGState ca ~0.1 (got ${f.ca})`).toBeLessThan(0.15);
  }

  // third-party pixels: interior not opaque, page text stays visible
  for (const kind of ['rect', 'ellipse']) {
    const m = tp[kind] && tp[kind].metrics;
    expect(m, `third-party metrics for ${kind}`).toBeTruthy();
    const ink = tp[`${kind}Ink`];
    process.stdout.write(`[TP-METRICS|${kind}] interior=${JSON.stringify(tp[kind].interior)}`
      + ` baseDarkFrac=${m.baseDarkFrac} opaqueBlueFrac=${m.opaqueBlueFrac}`
      + ` textKeptFrac=${m.textKeptFrac} meanAbsDiff=${m.meanAbsDiff} bboxInk=${JSON.stringify(tp[`${kind}Ink`])}\n`);
    expect(ink && ink.delta, `third-party render painted the ${kind} (bbox near-blue delta >= 100px)`).toBeGreaterThanOrEqual(100);
    expect(m.baseDarkFrac, `${kind}: pristine page has text under the shape (>2% dark px)`).toBeGreaterThan(0.02);
    expect(m.opaqueBlueFrac, `DEF-165 third-party: ${kind} interior NOT an opaque block (<5% near-solid-blue px)`).toBeLessThan(0.05);
    expect(m.textKeptFrac, `DEF-165 third-party: page text behind the ${kind} stays visible (>60% dark px kept)`).toBeGreaterThan(0.6);
    expect(m.meanAbsDiff, `DEF-165 third-party: ${kind} interior close to the pristine render (translucent, meanAbsDiff < 45)`).toBeLessThan(45);
  }

  // DEF-164 regression on the same save path: /Rect bottom-left math
  const raw = await dumpSavedAnnotsMath(savePath, engCommitted);
  for (const kind of ['rect', 'ellipse']) {
    expect(raw.verdicts[kind], `DEF-164 regression: ${kind} /Rect still bottom-left`).toBeTruthy();
    expect(raw.verdicts[kind].ok, `DEF-164 regression: ${kind} bottom-left math`).toBe(true);
    expect(raw.verdicts[kind].bugSig, `DEF-164 regression: ${kind} not the un-flipped top-down values`).toBe(false);
  }

  process.stdout.write(`\n[RES|DEF-165] tpMetrics=${JSON.stringify({ rect: tp.rect.metrics, ellipse: tp.ellipse.metrics })} opl=${JSON.stringify(tp.oplShapeFills)} pageErrors=${pageErrors.length}\n`);
  expect(pageErrors.length, 'no pageerrors').toBe(0);
});

// ---------------------------------------------------------------------------
// DEF-166
// ---------------------------------------------------------------------------
test('DEF-166: reopened saved callout + textbox text renders ONCE (single render source, no canvas doubling)', async () => {
  await launch();
  await openSample('report.pdf');
  await scrollToPage(PAGE);
  const pr = await pageRect(PAGE);
  expect(pr).toBeTruthy();

  // 1) callout
  await armAnnTool('callout');
  await drag(pr.x + pr.w * 0.55, pr.y + pr.h * 0.34, 180, 110);
  await win.waitForTimeout(600);
  const coTa = win.locator('[data-annotation-editor="callout"] textarea');
  await coTa.waitFor({ timeout: 8000 });
  await coTa.fill('VERIFY CALLOUT 1728');
  await win.click('[data-annotation-action="callout-confirm"]');
  await win.waitForTimeout(800);

  // 2) textbox
  await armAnnTool('textbox');
  await win.mouse.click(pr.x + pr.w * 0.18, pr.y + pr.h * 0.24);
  await win.waitForTimeout(500);
  const tbTa = win.locator('[data-annotation-editor="textbox"] textarea');
  await tbTa.waitFor({ timeout: 8000 });
  await tbTa.fill('VERIFY TB 1728');
  await win.click('[data-annotation-action="textbox-confirm"]');
  await win.waitForTimeout(800);

  await scrollToPage(PAGE);
  await win.waitForTimeout(400);

  const engCommitted = normalizeEngineRects(await engineAnns('committed'));

  // committed state: overlay-only, canvas under the boxes is page content
  const committed = {};
  const baseline = {};
  const committedProbes = {};
  for (const [kind, marker] of [['callout', 'VERIFY CALLOUT 1728'], ['textbox', 'VERIFY TB 1728']]) {
    const el = await findKind(kind);
    expect(el, `${kind} committed`).toBeTruthy();
    committed[kind] = await toPageLocal(el.rect);
    committedProbes[kind] = await textPaintProbe(KIND_SELECTORS[kind], marker);
    const scan = await canvasRegionBlue(shrink(committed[kind], 2));
    baseline[kind] = scan;
    process.stdout.write(`[COMMITTED|${kind}] pageLocalPx=${JSON.stringify(committed[kind])}`
      + ` paintedWithMarker=${committedProbes[kind].paintedWithMarker}`
      + ` canvasNearBlue=${scan.count} of ${scan.area}\n`);
    await cropShot(`def-166-1728-committed-${kind}-crop.png`, el.rect);
  }
  await shot('def-166-1728-committed.png');

  // Save As + close + reopen
  const savePath = path.join(os.tmpdir(), `tflex-def166-verify-${Date.now()}.pdf`);
  await saveAsReopen(savePath);
  fs.copyFileSync(savePath, path.join(PROJ, 'test-fixtures', 'annot-text-roundtrip-1728.pdf'));

  const reopened = {};
  const reopenedProbes = {};
  const after = {};
  for (const [kind, marker] of [['callout', 'VERIFY CALLOUT 1728'], ['textbox', 'VERIFY TB 1728']]) {
    const el = await findKind(kind);
    expect(el, `${kind} present after reopen`).toBeTruthy();
    reopened[kind] = await toPageLocal(el.rect);
    reopenedProbes[kind] = await textPaintProbe(KIND_SELECTORS[kind], marker);
    after[kind] = await canvasRegionBlue(shrink(reopened[kind], 2));
    const d = Math.hypot(reopened[kind].x - committed[kind].x, reopened[kind].y - committed[kind].y);
    process.stdout.write(`[REOPEN|${kind}] pageLocalPx=${JSON.stringify(reopened[kind])} roundtripDist=${d.toFixed(1)}px`
      + ` probe=${JSON.stringify(reopenedProbes[kind])}`
      + ` canvasNearBlue=${after[kind].count} (baseline ${baseline[kind].count}, delta ${after[kind].count - baseline[kind].count})\n`);
    expect(d, `${kind} round-trip position (<=${TOL_PX}px)`).toBeLessThanOrEqual(TOL_PX);
    await cropShot(`def-166-1728-reopened-${kind}-crop.png`, el.rect);
  }
  await shot('def-166-1728-reopened.png');

  // mechanical doubling detector on TFLEX's own reopened page canvas + the
  // plain-pdf.js single-render control of the SAME file at the SAME scale
  // (the PAGE scale in px/pt - the regions are page-local px on a 612x792pt
  // page, so the witness viewport must be pr.h / 792, NOT the canvas ratio).
  const ptScale = pr.h / PAGE_PT.h;
  process.stdout.write(`[SETUP] ptScale=${ptScale.toFixed(4)} px/pt\n`);
  const regions = [];
  for (const kind of ['callout', 'textbox']) {
    const r = shrink(reopened[kind], 3);
    regions.push({ name: kind, x: r.x, y: r.y, w: r.w, h: r.h });
  }
  const ctrl = runCanvasWitness(savePath, regions, ptScale);
  process.stdout.write(`[CTRL] ${JSON.stringify(ctrl)}\n`);

  const srcSummary = {};
  for (const kind of ['callout', 'textbox']) {
    const region = shrink(reopened[kind], 3);
    const tflex = await canvasRegionSelfOverlap(region, `def-166-1728-tflex-canvas-${kind}.png`);
    const c = ctrl.regions[kind] && ctrl.regions[kind].saved;
    expect(tflex.darkCount, `TFlex canvas region for ${kind} extracted`).toBeGreaterThan(0);
    expect(c, `witness control for ${kind}`).toBeTruthy();
    const dFrac = +(tflex.darkFrac - c.darkFrac).toFixed(4);
    const blueDelta = after[kind].count - baseline[kind].count;
    const canvasPaints = dFrac > 0.01 || blueDelta > 100;
    const domPaints = reopenedProbes[kind].paintedWithMarker;
    srcSummary[kind] = {
      tflexDarkFrac: tflex.darkFrac, ctrlDarkFrac: c.darkFrac, dFrac,
      tflexMaxSelfOverlap: tflex.maxSelfOverlap, ctrlMaxSelfOverlap: c.maxSelfOverlap,
      argShift: tflex.argShift, ctrlArgShift: c.argShift,
      blueDelta, canvasPaints, domPaints,
    };
    process.stdout.write(`[DOUBLING|${kind}] tflex darkFrac=${tflex.darkFrac} maxSelfOverlap=${tflex.maxSelfOverlap} argShift=${JSON.stringify(tflex.argShift)}`
      + ` | pdfjs-control darkFrac=${c.darkFrac} maxSelfOverlap=${c.maxSelfOverlap} argShift=${JSON.stringify(c.argShift)}`
      + ` | dFrac=${dFrac} blueDelta=${blueDelta}\n`);
    expect(tflex.maxSelfOverlap, `DEF-166: ${kind} TFlex canvas must not self-overlap like doubled text (<= control + 0.15)`
    ).toBeLessThanOrEqual(+(c.maxSelfOverlap + 0.15).toFixed(3));
    // exactly ONE render source per annotation (DOM overlay text XOR baked canvas AP)
    process.stdout.write(`[SOURCES|${kind}] dom=${domPaints ? 1 : 0} canvas=${canvasPaints ? 1 : 0}`
      + ` (dFrac=${dFrac}, blueDelta=${blueDelta}) total=${(domPaints ? 1 : 0) + (canvasPaints ? 1 : 0)}\n`);
    expect((domPaints ? 1 : 0) + (canvasPaints ? 1 : 0), `DEF-166: ${kind} text renders exactly ONCE (one render source, not two)`).toBe(1);
  }

  // DEF-164 regression on the same save path (textbox + callout geometry)
  const raw = await dumpSavedAnnotsMath(savePath, engCommitted);
  for (const kind of ['textbox', 'callout']) {
    expect(raw.verdicts[kind], `DEF-164 regression: ${kind} /Rect still bottom-left`).toBeTruthy();
    expect(raw.verdicts[kind].ok, `DEF-164 regression: ${kind} bottom-left math`).toBe(true);
    expect(raw.verdicts[kind].bugSig, `DEF-164 regression: ${kind} not the un-flipped top-down values`).toBe(false);
  }

  process.stdout.write(`\n[RES|DEF-166] sources=${JSON.stringify(srcSummary)} pageErrors=${pageErrors.length}\n`);
  expect(pageErrors.length, 'no pageerrors').toBe(0);
});