// Phase 33 focused verification (qa) - two operator-reported defects.
//
// DEFECT A - print page order: "Vertical and Horizontal page preview shows the
//   same layout". Phase 33 requires the effective sheet GRID to follow the
//   order (2-up: Horizontal 2x1 vs Vertical 1x2; 6-up: 3x2 vs 2x3) and the
//   composed PRINT DOCUMENT to agree with the preview.
//   Measured: preview cell getBoundingClientRect + computed grid templates at
//   2/4/6-up, then the produced PDFs (Phase 30 seam: override
//   WebContents.prototype.print -> printToPDF on the same webContents) with
//   page counts and the page-1 image placement matrices.
//
// DEFECT B - Multi Mode canvas background: "The canvas shouldn't have see
//   through/transparent background." Phase 33 requires an opaque pane canvas
//   in every theme. Measured: computed background of the pane/stage chain and
//   an alpha-preserving screenshot pixel sample in the pane's empty area, in
//   frosted (default) / light / dark.
//
// This spec asserts the CORRECT Phase 33 behaviour, so it is RED while the
// defects are present. It never prints to a physical device (the override
// intercepts print before any driver; the device name is bogus).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const zlib = require('node:zlib');
const { PNG } = require('pngjs');
const { launchApp } = require('../lib/launch.cjs');
const { openSamplePath, hardClose } = require('../lib/helpers.cjs');

const REPORT = path.resolve(__dirname, '..', '..', 'test-fixtures', 'report.pdf');
const LONG = path.resolve(__dirname, '..', '..', 'test-fixtures', 'long.pdf');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const OUT = path.join(os.tmpdir(), 'opencode');
const BOGUS_DEVICE = 'TFlex QA Bogus Printer';
const TMP = path.join(os.tmpdir(), 'tflex-p33');

// ---------------------------------------------------------------------------
// generic app driving
// ---------------------------------------------------------------------------
function tmpCopy(src, name) {
  fs.mkdirSync(TMP, { recursive: true });
  const dst = path.join(TMP, `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  fs.copyFileSync(src, dst);
  return dst;
}

async function mockOpen(app, p) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
}

async function openFile(app, win, p) {
  await mockOpen(app, p);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(900);
}

async function waitTabCount(win, n) {
  await expect(win.locator('.tab[data-tab-id]')).toHaveCount(n, { timeout: 30000 });
}

// Two different documents, both panes filled (alpha in A, beta in B).
async function twoPaneSetup(app, win) {
  const alphaPath = tmpCopy(REPORT, 'p33-alpha.pdf');
  const betaPath = tmpCopy(LONG, 'p33-beta.pdf');
  await openFile(app, win, alphaPath);
  await waitTabCount(win, 1);
  await openFile(app, win, betaPath);
  await waitTabCount(win, 2);
  await win.locator('.tab[data-tab-id]').filter({ hasText: 'p33-alpha' }).first().click();
  await win.waitForTimeout(300);
  await win.locator('[data-toolbar-multi-mode]').first().click();
  await win.waitForTimeout(400);
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]')).toBeVisible({ timeout: 15000 });
  await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'p33-beta' }).first().click();
  await win.waitForTimeout(1200);
  await expect(win.locator('.tab-pane[data-pane="B"] canvas.pdf-page-canvas').first()).toBeVisible({ timeout: 30000 });
}

async function switchTheme(win, theme) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector(`[data-theme-option="${theme}"]`, { state: 'visible', timeout: 8000 });
  await win.click(`[data-theme-option="${theme}"]`);
  await win.waitForTimeout(700);
}

// ---------------------------------------------------------------------------
// print dialog driving
// ---------------------------------------------------------------------------
async function openDialog(win) {
  await win.click('[data-print]');
  await win.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
  await win.waitForFunction(
    () => {
      const sel = document.querySelector('[data-print-printer]');
      if (sel === null) return false;
      const hasReal = [...sel.querySelectorAll('option')].some((o) => o.value !== '');
      const settled =
        document.querySelector('[data-print-empty], [data-print-printers-error]') !== null;
      return hasReal || settled;
    },
    null,
    { timeout: 20000 },
  );
}

async function closeDialog(win) {
  await win.click('[data-print-cancel]');
  await win.locator('[data-print-printer]').waitFor({ state: 'detached', timeout: 8000 });
}

async function confirmAndWait(win) {
  await win.click('[data-print-confirm]');
  await win.waitForSelector('[data-print-success]', { state: 'visible', timeout: 120000 });
}

// Preview geometry for one (nup, order) pair.
async function measurePreview(win, nup, order) {
  await win.selectOption('[data-print-nup]', String(nup));
  await win.selectOption('[data-print-page-order]', order);
  await win.waitForTimeout(450);
  return win.evaluate(() => {
    const sheet = document.querySelector('[data-print-preview-sheet]');
    const cs = getComputedStyle(sheet);
    const cells = [...sheet.querySelectorAll('.print-preview-cell')].map((c) => {
      const r = c.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        // Phase 33 — the page the cell actually holds (the layout slot
        // assignment). The distinguishing evidence at 4-up (a symmetric 2x2
        // grid) is the cell -> page mapping, not grid-auto-flow.
        page: c.getAttribute('data-print-preview-page'),
      };
    });
    return {
      gridTemplateColumns: cs.gridTemplateColumns,
      gridTemplateRows: cs.gridTemplateRows,
      gridAutoFlow: cs.gridAutoFlow,
      direction: cs.direction,
      cells,
      pages: cells.map((c) => (c.page === null ? null : Number(c.page))),
    };
  });
}
// ---------------------------------------------------------------------------
// print payload capture (Phase 30 seam, renamed globals)
// ---------------------------------------------------------------------------
async function installCapture(app, win) {
  const mode = await win.evaluate(() => {
    window.__p33captured = [];
    try {
      const orig = window.tflex.printJob;
      window.tflex.printJob = async (payload) => {
        window.__p33captured.push(payload);
        return { ok: true };
      };
      if (window.tflex.printJob !== orig) {
        window.__p33origPrintJob = orig;
        return 'renderer';
      }
      window.tflex.printJob = orig;
      return 'none';
    } catch (_) {
      return 'none';
    }
  });
  if (mode === 'renderer') return mode;
  await app.evaluate(({ ipcMain }) => {
    const map = ipcMain._invokeHandlers;
    if (!map || typeof map.get !== 'function') {
      throw new Error('capture fallback unavailable: ipcMain._invokeHandlers missing');
    }
    global.__p33origHandler = map.get('print:job');
    global.__p33captured = [];
    map.set('print:job', async (_e, payload) => {
      global.__p33captured.push(payload);
      return { ok: true };
    });
  });
  return 'main';
}

async function restoreCapture(app, win, mode) {
  if (mode === 'renderer') {
    await win.evaluate(() => {
      window.tflex.printJob = window.__p33origPrintJob;
    });
  } else {
    await app.evaluate(({ ipcMain }) => {
      ipcMain._invokeHandlers.set('print:job', global.__p33origHandler);
    });
  }
}

async function getCaptured(app, win, mode) {
  if (mode === 'renderer') return win.evaluate(() => window.__p33captured);
  return app.evaluate(() => global.__p33captured);
}

async function installPrintOverride(app) {
  await app.evaluate(({ BrowserWindow }) => {
    if (global.__p33origPrint) return;
    const proto = Object.getPrototypeOf(BrowserWindow.getAllWindows()[0].webContents);
    global.__p33printProto = proto;
    global.__p33origPrint = proto.print;
    global.__p33printResults = [];
    proto.print = function (options, callback) {
      this.printToPDF(options)
        .then((buf) => {
          global.__p33printResults.push({ options, base64: buf.toString('base64') });
          callback(true, '');
        })
        .catch((err) => {
          const msg = String((err && err.message) || err);
          global.__p33printResults.push({ options, error: msg });
          callback(false, msg);
        });
    };
  });
}

async function restorePrintOverride(app) {
  await app.evaluate(() => {
    if (global.__p33origPrint && global.__p33printProto) {
      global.__p33printProto.print = global.__p33origPrint;
      global.__p33origPrint = null;
      global.__p33printProto = null;
    }
  });
}

async function produce(app, win, index, outPath) {
  await app.evaluate(() => {
    global.__p33printResults = [];
  });
  const res = await win.evaluate(
    async ({ i, device }) => {
      const p = JSON.parse(JSON.stringify(window.__p33captured[i]));
      p.settings.deviceName = device;
      return await window.tflex.printJob(p);
    },
    { i: index, device: BOGUS_DEVICE },
  );
  const results = await app.evaluate(() => global.__p33printResults);
  if (!results || results.length === 0) {
    throw new Error(`no printToPDF result captured for case ${index}: ${JSON.stringify(res)}`);
  }
  const r = results[0];
  if (r.error) throw new Error(`printToPDF failed for case ${index}: ${r.error}`);
  fs.writeFileSync(outPath, Buffer.from(r.base64, 'base64'));
  return { res, options: r.options };
}

// ---------------------------------------------------------------------------
// produced-PDF inspection
// ---------------------------------------------------------------------------
async function inspectPdf(file) {
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.load(fs.readFileSync(file), { ignoreEncryption: true });
  const sizes = doc.getPages().map((p) => {
    const s = p.getSize();
    return { width: +s.width.toFixed(2), height: +s.height.toFixed(2) };
  });
  return { pageCount: doc.getPageCount(), sizes };
}

// Decode page 1's content stream(s) and return the image placement signature:
// the ordered list of `cm` matrices and the `Do` XObject names. Two sheets with
// the same arrangement produce the same signature regardless of image bytes.
async function placementSignature(file) {
  const { PDFDocument, PDFName, PDFArray, PDFRawStream } = require('pdf-lib');
  const crypto = require('node:crypto');
  const doc = await PDFDocument.load(fs.readFileSync(file), { ignoreEncryption: true });
  const page = doc.getPage(0);
  const contents = page.node.Contents();
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  let text = '';
  for (const ref of refs) {
    const stream = doc.context.lookup(ref);
    if (!stream) continue;
    let raw = stream.getContents ? stream.getContents() : stream.contents;
    const filter = stream.dict && stream.dict.get ? stream.dict.get(PDFName.of('Filter')) : null;
    const fname = filter ? filter.toString() : '';
    if (fname.includes('FlateDecode')) {
      try {
        raw = zlib.inflateSync(Buffer.from(raw));
      } catch (_) {
        /* leave raw */
      }
    }
    text += Buffer.from(raw).toString('latin1') + '\n';
  }
  // Per-cell placement: each `Do` paired with the NEAREST PRECEDING `cm`
  // (the image transform), and the md5 of the image stream it resolves to.
  // The stream hash identifies WHICH page image lands in each cell, which is
  // what distinguishes two arrangements on a symmetric grid (the cm positions
  // alone do not). Pairing by nearest-preceding cm avoids the sheet's own
  // content transform swallowing the first image's transform.
  const cmsAll = [];
  const reCmAll = /([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+cm/g;
  let mm;
  while ((mm = reCmAll.exec(text)) !== null) {
    cmsAll.push({ idx: mm.index, cm: mm.slice(1, 7).map(Number) });
  }
  const dosAll = [];
  const reDoAll = /\/(\w+)\s+Do/g;
  while ((mm = reDoAll.exec(text)) !== null) dosAll.push({ idx: mm.index, name: mm[1] });
  const cellImages = [];
  for (const d of dosAll) {
    let cm = null;
    for (const c of cmsAll) {
      if (c.idx < d.idx) cm = c.cm;
      else break;
    }
    if (cm === null || Math.abs(cm[0]) < 100) continue; // sheet content transform, not an image
    let hash = 'none';
    try {
      const xobjDict = page.node.Resources().lookup(PDFName.of('XObject'));
      const obj = doc.context.lookup(xobjDict.get(PDFName.of(d.name)));
      const bytes = obj instanceof PDFRawStream ? obj.contents : obj && obj.contents;
      if (bytes) hash = crypto.createHash('md5').update(Buffer.from(bytes)).digest('hex').slice(0, 10);
    } catch (_) {
      /* hash stays none */
    }
    cellImages.push({ cm, name: d.name, hash });
  }
  const cms = [];
  const reCm = /([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+cm/g;
  let m;
  while ((m = reCm.exec(text)) !== null) cms.push(m.slice(1).map(Number));
  const dos = [];
  const reDo = /\/(\w+)\s+Do/g;
  while ((m = reDo.exec(text)) !== null) dos.push(m[1]);
  return { cms, dos, cellImages, textLen: text.length, textHead: text.slice(0, 400) };
}

function trackCount(s) {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// ===========================================================================
// DEFECT A - print page order
// ===========================================================================
test('DEFECT A: print page order Horizontal vs Vertical (preview + produced PDF)', async () => {
  test.setTimeout(300000);
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(SHOTS, { recursive: true });
  const app = await launchApp();
  const win = await app.firstWindow();
  let mode = null;
  let overrideInstalled = false;
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, REPORT);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(600);
    const pageCount = await win.evaluate(() => window.tflexDiagnostics().pageCount);
    console.log(`[P33A] fixture=report.pdf pageCount=${pageCount}`);

    // --- 1. preview geometry at 2 / 4 / 6 up, both orders -----------------
    await openDialog(win);
    const geometry = {};
    for (const nup of [2, 4, 6]) {
      for (const order of ['horizontal', 'vertical']) {
        geometry[`${nup}-${order}`] = await measurePreview(win, nup, order);
      }
    }
    for (const key of Object.keys(geometry)) {
      const g = geometry[key];
      console.log(
        `[P33A] preview ${key}: cols="${g.gridTemplateColumns}" rows="${g.gridTemplateRows}" ` +
          `flow=${g.gridAutoFlow} dir=${g.direction} pages=${JSON.stringify(g.pages)} cells=${JSON.stringify(g.cells)}`,
      );
    }
    // one screenshot of the dialog at 2-up Vertical (the visual record)
    await win.selectOption('[data-print-nup]', '2');
    await win.selectOption('[data-print-page-order]', 'vertical');
    await win.waitForTimeout(450);
    await win.screenshot({ path: path.join(SHOTS, 'def-p33-print-order.png') });
    await closeDialog(win);

    // --- 2. capture the dialog payloads for 2-up and 4-up, both orders ----
    mode = await installCapture(app, win);
    console.log(`[P33A] capture mode=${mode}`);
    const cases = [
      [2, 'horizontal'],
      [2, 'vertical'],
      [4, 'horizontal'],
      [4, 'vertical'],
    ];
    for (const [nup, order] of cases) {
      await openDialog(win);
      await win.selectOption('[data-print-nup]', String(nup));
      await win.selectOption('[data-print-page-order]', order);
      await win.click('[data-print-range-custom]');
      await win.fill('[data-print-range-input]', '1-4');
      await confirmAndWait(win);
      await closeDialog(win);
    }
    const payloads = await getCaptured(app, win, mode);
    console.log(`[P33A] captured payloads=${payloads.length}`);
    for (let i = 0; i < payloads.length; i += 1) {
      const s = payloads[i].settings || {};
      console.log(
        `[P33A] payload ${i} images=${payloads[i].images.length} pagesPerSheet=${s.pagesPerSheet} ` +
          `pageOrder=${s.pageOrder}`,
      );
    }

    // --- 3. produce the real PDFs through the app's own printJob ----------
    await restoreCapture(app, win, mode);
    if (mode === 'main') {
      const captured = await app.evaluate(() => global.__p33captured);
      await win.evaluate((arr) => {
        window.__p33captured = arr;
      }, captured);
    }
    await installPrintOverride(app);
    overrideInstalled = true;
    const files = {};
    for (let i = 0; i < cases.length; i += 1) {
      const [nup, order] = cases[i];
      const outPath = path.join(OUT, `p33-${nup}up-${order}.pdf`);
      const prod = await produce(app, win, i, outPath);
      files[`${nup}-${order}`] = outPath;
      console.log(`[P33A] produced ${nup}up ${order} -> ${outPath} options=${JSON.stringify(prod.options)}`);
    }
    await restorePrintOverride(app);
    overrideInstalled = false;

    // --- 4. inspect the produced PDFs -------------------------------------
    const info = {};
    for (const key of Object.keys(files)) {
      info[key] = await inspectPdf(files[key]);
      console.log(`[P33A] ${key} pageCount=${info[key].pageCount} sizes=${JSON.stringify(info[key].sizes)}`);
    }
    const sig = {};
    for (const key of Object.keys(files)) {
      sig[key] = await placementSignature(files[key]);
      console.log(
        `[P33A] ${key} placements cms=${JSON.stringify(sig[key].cms)} dos=${JSON.stringify(sig[key].dos)} ` +
          `cellImages=${JSON.stringify(sig[key].cellImages.map((c) => ({ cm: c.cm, hash: c.hash })))}`,
      );
    }
    console.log(`[P33A] 2-up content head H=${JSON.stringify(sig['2-horizontal'].textHead)}`);
    console.log(`[P33A] 2-up content head V=${JSON.stringify(sig['2-vertical'].textHead)}`);

    // --- 5. Phase 33 assertions (RED while the defect is present) ---------
    const g2h = geometry['2-horizontal'];
    const g2v = geometry['2-vertical'];
    const g6h = geometry['6-horizontal'];
    const g6v = geometry['6-vertical'];
    const g4h = geometry['4-horizontal'];
    const g4v = geometry['4-vertical'];

    // 2-up: Horizontal 2 cols x 1 row, Vertical 1 col x 2 rows.
    expect(trackCount(g2h.gridTemplateColumns), '2-up Horizontal is 2 columns').toBe(2);
    expect(trackCount(g2h.gridTemplateRows), '2-up Horizontal is 1 row').toBe(1);
    expect(trackCount(g2v.gridTemplateColumns), '2-up Vertical is 1 column').toBe(1);
    expect(trackCount(g2v.gridTemplateRows), '2-up Vertical is 2 rows').toBe(2);
    // 2-up cell geometry: side by side vs stacked.
    expect(g2h.cells[0].y, '2-up H cells share a row').toBe(g2h.cells[1].y);
    expect(g2h.cells[0].x, '2-up H cells differ in x').not.toBe(g2h.cells[1].x);
    expect(g2v.cells[0].x, '2-up V cells share a column').toBe(g2v.cells[1].x);
    expect(g2v.cells[0].y, '2-up V cells differ in y').not.toBe(g2v.cells[1].y);

    // 6-up: Horizontal 3x2, Vertical 2x3.
    expect(trackCount(g6h.gridTemplateColumns), '6-up Horizontal is 3 columns').toBe(3);
    expect(trackCount(g6h.gridTemplateRows), '6-up Horizontal is 2 rows').toBe(2);
    expect(trackCount(g6v.gridTemplateColumns), '6-up Vertical is 2 columns').toBe(2);
    expect(trackCount(g6v.gridTemplateRows), '6-up Vertical is 3 rows').toBe(3);

    // 4-up: 2x2 grid in both, but the FILL FLOW must differ. Phase 33 realises
    // this through the shared layout's slot assignment (not grid-auto-flow),
    // so assert the cell -> page mapping: Horizontal row-major [1,2,3,4],
    // Vertical column-major [1,3,2,4].
    expect(trackCount(g4h.gridTemplateColumns), '4-up Horizontal is 2 columns').toBe(2);
    expect(trackCount(g4v.gridTemplateColumns), '4-up Vertical is 2 columns').toBe(2);
    expect(g4h.pages, '4-up H fills row-major [1,2,3,4]').toEqual([1, 2, 3, 4]);
    expect(g4v.pages, '4-up V fills column-major [1,3,2,4]').toEqual([1, 3, 2, 4]);

    // Produced PDFs: page counts and arrangement.
    expect(info['2-horizontal'].pageCount, '2-up H produced 2 sheets').toBe(2);
    expect(info['2-vertical'].pageCount, '2-up V produced 2 sheets').toBe(2);
    expect(info['4-horizontal'].pageCount, '4-up H produced 1 sheet').toBe(1);
    expect(info['4-vertical'].pageCount, '4-up V produced 1 sheet').toBe(1);

    // 2-up arrangement from the produced sheets: Horizontal places the two
    // images side by side (same y, different x); Vertical stacks them (same
    // x, different y). cm[4]=x translation, cm[5]=y translation.
    const img2h = sig['2-horizontal'].cellImages;
    const img2v = sig['2-vertical'].cellImages;
    expect(img2h.length, '2-up H sheet has 2 image placements').toBe(2);
    expect(img2v.length, '2-up V sheet has 2 image placements').toBe(2);
    expect(img2h[0].cm[5], '2-up H images share a row').toBe(img2h[1].cm[5]);
    expect(img2h[0].cm[4], '2-up H images differ in x (side by side)').not.toBe(img2h[1].cm[4]);
    expect(img2v[0].cm[4], '2-up V images share a column').toBe(img2v[1].cm[4]);
    expect(img2v[0].cm[5], '2-up V images differ in y (stacked)').not.toBe(img2v[1].cm[5]);

    // 4-up arrangement: the cm positions are the same symmetric 2x2 cells for
    // both orders, so the distinguishing evidence is WHICH page image lands in
    // each cell. Horizontal is row-major, Vertical column-major, so cells 1
    // and 2 swap while cells 0 and 3 keep their page.
    const img4h = sig['4-horizontal'].cellImages;
    const img4v = sig['4-vertical'].cellImages;
    expect(img4h.length, '4-up H sheet has 4 image placements').toBe(4);
    expect(img4v.length, '4-up V sheet has 4 image placements').toBe(4);
    expect(img4h[0].hash, '4-up cell 0 holds the same page in both orders').toBe(img4v[0].hash);
    expect(img4h[3].hash, '4-up cell 3 holds the same page in both orders').toBe(img4v[3].hash);
    expect(img4h[1].hash, '4-up cells 1/2 swap between orders').toBe(img4v[2].hash);
    expect(img4h[2].hash, '4-up cells 1/2 swap between orders').toBe(img4v[1].hash);
  } finally {
    if (overrideInstalled) await restorePrintOverride(app).catch(() => {});
    if (mode !== null) await restoreCapture(app, win, mode).catch(() => {});
    await hardClose(app, 'p33A');
  }
});

// ===========================================================================
// DEFECT B - Multi Mode canvas background
// ===========================================================================
function pixelAt(png, x, y) {
  const px = Math.max(0, Math.min(png.width - 1, Math.round(x)));
  const py = Math.max(0, Math.min(png.height - 1, Math.round(y)));
  const idx = (png.width * py + px) << 2;
  return { x: px, y: py, r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2], a: png.data[idx + 3] };
}

async function samplePaneBackground(win, theme) {
  const styles = await win.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        backgroundColor: cs.backgroundColor,
        backgroundImage: cs.backgroundImage.slice(0, 140),
      };
    };
    return {
      html: pick('html'),
      body: pick('body'),
      app: pick('.app'),
      workspaceMain: pick('.workspace-main'),
      tabStage: pick('.tab-stage'),
      paneA: pick('.tab-pane[data-pane="A"]'),
      scrollerA: pick('.tab-pane[data-pane="A"] .document-scroller'),
      ambient: pick('.tf-ambient'),
    };
  });

  // Find a point inside pane A's scroller that is on the CANVAS: no page slot
  // and no page chrome under it (the scroller is wrapped by .document-content,
  // and each page lives in a .page-slot, so a canvas point is one whose top
  // element is outside any .page-slot).
  const point = await win.evaluate(() => {
    const sc = document.querySelector('.tab-pane[data-pane="A"] .document-scroller');
    if (!sc) return null;
    const r = sc.getBoundingClientRect();
    for (let dy = 6; dy < r.height - 6; dy += 8) {
      for (let dx = 6; dx < r.width - 6; dx += 8) {
        const x = r.left + dx;
        const y = r.top + dy;
        const el = document.elementFromPoint(x, y);
        if (el && el.closest('.page-slot') === null) {
          return {
            x: Math.round(x),
            y: Math.round(y),
            topElement: `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0]}`,
          };
        }
      }
    }
    return null;
  });

  // Alpha-preserving screenshot: the composite that makes transparency visible.
  const buf = await win.screenshot({ omitBackground: true });
  const png = PNG.sync.read(buf);
  // 1x1 clips are CSS-pixel exact (independent of devicePixelRatio), so the
  // sampled pixel is the pane canvas / app frame pixel itself.
  const clipPixel = async (x, y) => {
    const b = await win.screenshot({
      omitBackground: true,
      clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 },
    });
    const p = PNG.sync.read(b);
    return pixelAt(p, 0, 0);
  };
  const panePixel = point ? await clipPixel(point.x, point.y) : null;
  const appPixel = await clipPixel(10, 10);
  const dpr = await win.evaluate(() => window.devicePixelRatio);

  // Vertical scan down the pane's centre line: top element per step, so the
  // page (opaque paper) and the exposed canvas are distinguishable.
  const scan = await win.evaluate(() => {
    const sc = document.querySelector('.tab-pane[data-pane="A"] .document-scroller');
    if (!sc) return [];
    const r = sc.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const out = [];
    for (let y = Math.round(r.top) + 4; y < Math.round(r.bottom) - 4; y += 25) {
      const el = document.elementFromPoint(x, y);
      out.push({
        x,
        y,
        el: el ? `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0]}` : null,
      });
    }
    return out;
  });
  const boxes = await win.evaluate(() => {
    const rect = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        left: Math.round(b.left),
        top: Math.round(b.top),
        width: Math.round(b.width),
        height: Math.round(b.height),
        bg: getComputedStyle(el).backgroundColor,
      };
    };
    const pane = document.querySelector('.tab-pane[data-pane="A"]');
    return {
      scroller: rect(pane && pane.querySelector('.document-scroller')),
      content: rect(pane && pane.querySelector('.document-content')),
      slot: rect(pane && pane.querySelector('.page-slot')),
      page: rect(pane && pane.querySelector('.pdf-page')),
      pane: rect(pane),
    };
  });
  return {
    theme,
    styles,
    point,
    panePixel,
    appPixel,
    scan,
    boxes,
    dpr,
    shotSize: { w: png.width, h: png.height },
    rgba: buf,
  };
}

// Composite an alpha-preserving screenshot over a checkerboard so transparent
// surfaces (the see-through canvas) are visually unambiguous.
function compositeOverCheckerboard(png, outPath) {
  const out = new PNG({ width: png.width, height: png.height });
  const C1 = [204, 204, 204];
  const C2 = [153, 153, 153];
  const TILE = 12;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const idx = (png.width * y + x) << 2;
      const a = png.data[idx + 3] / 255;
      const base = (Math.floor(x / TILE) + Math.floor(y / TILE)) % 2 === 0 ? C1 : C2;
      out.data[idx] = Math.round(png.data[idx] * a + base[0] * (1 - a));
      out.data[idx + 1] = Math.round(png.data[idx + 1] * a + base[1] * (1 - a));
      out.data[idx + 2] = Math.round(png.data[idx + 2] * a + base[2] * (1 - a));
      out.data[idx + 3] = 255;
    }
  }
  fs.writeFileSync(outPath, PNG.sync.write(out));
}

test('DEFECT B: Multi Mode canvas background opacity (frosted / light / dark)', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(SHOTS, { recursive: true });
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await twoPaneSetup(app, win);
const stage = win.locator('.tab-stage');
    expect(await stage.getAttribute('data-multi-mode')).toBe('true');
    expect(await stage.getAttribute('data-multi-panes')).toBe('2');

    // Focus pane A (click its page area) so the shared toolbar's zoom acts on
    // A, the pane this test samples.
    await win.locator('.tab-pane[data-pane="A"] .pdf-page').first().click();
    await win.waitForTimeout(300);
    // Zoom pane A out so the page is narrower than the pane: this exposes the
    // pane CANVAS as real gutters beside the page (the operator's see-through
    // area), not just the 18px inter-page gaps. Phase 33 — Multi Mode's zoom
    // controls live in the ONE shared toolbar (per-pane toolbars are retired).
    const zoomOut = win.locator('[data-shared-toolbar] [aria-label="Zoom out"]');
    for (let i = 0; i < 6; i += 1) {
      await zoomOut.click();
      await win.waitForTimeout(150);
    }
    await win.waitForTimeout(700);

    const results = {};
    for (const theme of ['frosted', 'light', 'dark']) {
      await switchTheme(win, theme);
      await win.waitForTimeout(700);
      results[theme] = await samplePaneBackground(win, theme);
      const r = results[theme];
      console.log(
        `[P33B] theme=${theme} scrollerA.bg=${r.styles.scrollerA && r.styles.scrollerA.backgroundColor} ` +
          `paneA.bg=${r.styles.paneA && r.styles.paneA.backgroundColor} ` +
          `workspaceMain.bg=${r.styles.workspaceMain && r.styles.workspaceMain.backgroundColor} ` +
          `body.bg=${r.styles.body && r.styles.body.backgroundColor} ` +
          `ambient.bg=${r.styles.ambient && r.styles.ambient.backgroundColor}`,
      );
console.log(
        `[P33B] theme=${theme} point=${JSON.stringify(r.point)} panePixel=${JSON.stringify(r.panePixel)} ` +
          `appPixel=${JSON.stringify(r.appPixel)}`,
      );
      console.log(
        `[P33B] theme=${theme} vertical element scan (x, y, topElement)=` +
          JSON.stringify(r.scan.map((s) => [s.x, s.y, s.el])),
      );
      console.log(`[P33B] theme=${theme} dpr=${r.dpr} shotSize=${JSON.stringify(r.shotSize)}`);
      if (theme === 'frosted') {
        console.log(`[P33B] theme=${theme} boxes=` + JSON.stringify(r.boxes));
      }
    }

    // One screenshot in the default (frosted) theme - the visual record.
    // The app's transparent surfaces are composited over a checkerboard so the
    // see-through canvas is unambiguous (a plain screenshot would composite the
    // transparency over white and hide it).
    const shotPath = path.join(SHOTS, 'def-multi-bg.png');
    compositeOverCheckerboard(PNG.sync.read(results.frosted.rgba), shotPath);
    console.log(`[P33B] screenshot=${shotPath} (frosted, alpha composited over checkerboard)`);

    // Phase 33: the pane canvas must be opaque in EVERY theme.
    for (const theme of ['frosted', 'light', 'dark']) {
      const r = results[theme];
      expect(r.panePixel, `${theme}: pane empty-area pixel sampled`).not.toBeNull();
      expect(
        r.panePixel.a,
        `${theme}: pane canvas pixel is opaque (alpha 255), got ${JSON.stringify(r.panePixel)}`,
      ).toBe(255);
    }
  } finally {
    await hardClose(app, 'p33B');
  }
});
