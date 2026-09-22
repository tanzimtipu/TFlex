// ADV phase-33: preview-vs-print parity across the FULL nup x order matrix.
// Uses the app's own Print dialog (preview) and the Phase-30 printToPDF seam
// (produced PDFs). No physical printer.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const zlib = require('node:zlib');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose, openSamplePath } = require('../../e2e/lib/helpers.cjs');
const { REPORT } = require('../../e2e/lib/p33_common.cjs');
const P = require('../../e2e/lib/p33_print.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p33');

// --- independent oracle for the shared rule (test oracle, not product code) --
function oracle(nup, order) {
  const base = { 1: [1, 1], 2: [2, 1], 4: [2, 2], 6: [3, 2], 9: [3, 3], 16: [4, 4] }[nup];
  const horiz = order === 'horizontal' || order === 'horizontalReversed';
  const rev = order === 'horizontalReversed' || order === 'verticalReversed';
  const cols = horiz ? base[0] : base[1];
  const rows = horiz ? base[1] : base[0];
  const count = cols * rows;
  const slots = new Array(count);
  for (let k = 0; k < count; k += 1) {
    let row; let col;
    if (horiz) {
      row = Math.floor(k / cols);
      const off = k % cols;
      col = rev ? cols - 1 - off : off;
    } else {
      col = Math.floor(k / rows);
      const off = k % rows;
      row = rev ? rows - 1 - off : off;
    }
    slots[row * cols + col] = k;
  }
  return { cols, rows, slots };
}

async function measurePreview(win, nup, order) {
  await win.selectOption('[data-print-nup]', String(nup));
  if (nup > 1) await win.selectOption('[data-print-page-order]', order);
  await win.waitForTimeout(350);
  return win.evaluate(() => {
    const sheet = document.querySelector('[data-print-preview-sheet]');
    const cs = getComputedStyle(sheet);
    const cells = [...sheet.querySelectorAll('.print-preview-cell')].map((c) => {
      const r = c.getBoundingClientRect();
      return {
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        page: c.getAttribute('data-print-preview-page'),
        rects: c.getBoundingClientRect(),
      };
    });
    return {
      cols: cs.gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length,
      rows: cs.gridTemplateRows.trim().split(/\s+/).filter(Boolean).length,
      pages: cells.map((c) => (c.page === null ? null : Number(c.page))),
      cells: cells.map((c) => ({ x: c.x, y: c.y, page: c.page })),
    };
  });
}

// per-page image placements for a produced PDF: page s -> [{hash, cm}]
async function pageImages(file) {
  const { PDFDocument, PDFName, PDFArray, PDFRawStream } = require('pdf-lib');
  const crypto = require('node:crypto');
  const doc = await PDFDocument.load(fs.readFileSync(file), { ignoreEncryption: true });
  const out = [];
  for (let pi = 0; pi < doc.getPageCount(); pi += 1) {
    const page = doc.getPage(pi);
    const contents = page.node.Contents();
    const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
    let text = '';
    for (const ref of refs) {
      const stream = doc.context.lookup(ref);
      if (!stream) continue;
      let raw = stream.getContents ? stream.getContents() : stream.contents;
      const filter = stream.dict && stream.dict.get ? stream.dict.get(PDFName.of('Filter')) : null;
      if (filter && filter.toString().includes('FlateDecode')) {
        try { raw = zlib.inflateSync(Buffer.from(raw)); } catch (_) { /* ignore */ }
      }
      text += Buffer.from(raw).toString('latin1') + '\n';
    }
    const cms = [];
    const reCm = /([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+cm/g;
    let m;
    while ((m = reCm.exec(text)) !== null) cms.push({ idx: m.index, cm: m.slice(1, 7).map(Number) });
    const dos = [];
    const reDo = /\/(\w+)\s+Do/g;
    while ((m = reDo.exec(text)) !== null) dos.push({ idx: m.index, name: m[1] });
    const imgs = [];
    for (const d of dos) {
      let cm = null;
      for (const c of cms) { if (c.idx < d.idx) cm = c.cm; else break; }
      if (cm === null || Math.abs(cm[0]) < 100) continue;
      let hash = 'none';
      try {
        const xo = page.node.Resources().lookup(PDFName.of('XObject'));
        const obj = doc.context.lookup(xo.get(PDFName.of(d.name)));
        const bytes = obj instanceof PDFRawStream ? obj.contents : obj && obj.contents;
        if (bytes) hash = crypto.createHash('md5').update(Buffer.from(bytes)).digest('hex').slice(0, 12);
      } catch (_) { /* none */ }
      imgs.push({ hash, cm: cm.map((n) => +n.toFixed(1)) });
    }
    out.push(imgs);
  }
  return out;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const app = await launchApp();
  const win = await app.firstWindow();
  const results = [];
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, process.env.ADV_PDF || REPORT);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(600);
    const pc = await win.evaluate(() => window.tflexDiagnostics().pageCount);
    console.log(`[adv-parity] report pages=${pc}`);

    await P.openDialog(win);
    const nupList = [1, 2, 4, 6, 9, 16];
    const orders = ['horizontal', 'horizontalReversed', 'vertical', 'verticalReversed'];

    // ---------- preview geometry + page mapping vs oracle ------------------
    const previewMismatch = [];
    for (const nup of nupList) {
      for (const order of (nup === 1 ? ['horizontal'] : orders)) {
        const m = await measurePreview(win, nup, order);
        const o = oracle(nup, order);
        const expectedPages = o.slots.map((k) => (k < nup ? k + 1 : null));
        const key = `${nup}-${order}`;
        if (m.cols !== o.cols || m.rows !== o.rows) {
          previewMismatch.push(`${key}: grid preview ${m.cols}x${m.rows} != rule ${o.cols}x${o.rows}`);
        }
        if (JSON.stringify(m.pages) !== JSON.stringify(expectedPages)) {
          previewMismatch.push(`${key}: preview pages ${JSON.stringify(m.pages)} != rule ${JSON.stringify(expectedPages)}`);
        }
        console.log(`[adv-parity] preview ${key}: ${m.cols}x${m.rows} pages=${JSON.stringify(m.pages)}`);
      }
    }
    console.log(`[adv-parity] PREVIEW_ORACLE_MISMATCHES=${previewMismatch.length}`);
    for (const e of previewMismatch) console.log(`[adv-parity]   MISMATCH ${e}`);

    // ---- visual record for a vertical + reversed combo --------------------
    await measurePreview(win, 6, 'verticalReversed');
    await win.screenshot({ path: path.join('C:/Users/tanzi/OneDrive/App Development/TFlex/screenshots/adv-p33-preview-6vr.png') });
    await P.closeDialog(win);

    // ---------- produced PDFs vs rule, with page-identity via reference ----
    const mode = await P.installCapture(app, win);
    console.log(`[adv-parity] capture mode=${mode}`);

    // 1-up reference gives us page -> image hash for the exact selected range.
    const cases = [
      { key: '1-horizontal', nup: 1, order: 'horizontal', range: '1-16', count: 16 },
    ];
    for (const nup of [2, 4, 6, 9, 16]) {
      for (const order of orders) {
        cases.push({ key: `${nup}-${order}`, nup, order, range: `1-${nup}`, count: nup });
      }
    }
    // partial last sheet probes (DEF-280 class)
    cases.push({ key: '4-partial5', nup: 4, order: 'vertical', range: '1-5', count: 5 });
    cases.push({ key: '6-partial8', nup: 6, order: 'horizontalReversed', range: '1-8', count: 8 });
    for (const c of cases) {
      await P.openDialog(win);
      await win.selectOption('[data-print-nup]', String(c.nup));
      if (c.nup > 1) await win.selectOption('[data-print-page-order]', c.order);
      await win.click('[data-print-range-custom]');
      await win.fill('[data-print-range-input]', c.range);
      await P.confirmAndWait(win);
      await P.closeDialog(win);
      console.log(`[adv-parity] captured payload for ${c.key}`);
    }
    const payloads = await P.getCaptured(app, win, mode);
    console.log(`[adv-parity] payloads=${payloads.length}`);
    await P.restoreCapture(app, win, mode);
    const captured = mode === 'main' ? await app.evaluate(() => global.__p33captured) : payloads;

    await P.installPrintOverride(app);
    const produced = {};
    for (let i = 0; i < cases.length; i += 1) {
      const c = cases[i];
      await app.evaluate(() => { global.__p33printResults = []; });
      const p = JSON.parse(JSON.stringify(captured[i]));
      p.settings.deviceName = P.BOGUS_DEVICE;
      const res = await win.evaluate(async (payload) => window.tflex.printJob(payload), p);
      const rr = await app.evaluate(() => global.__p33printResults);
      if (!rr || rr.length === 0) throw new Error(`no printToPDF result for ${c.key}: ${JSON.stringify(res)}`);
      if (rr[0].error) throw new Error(`printToPDF failed for ${c.key}: ${rr[0].error}`);
      const outPath = path.join(OUT, `adv-${c.key}.pdf`);
      fs.writeFileSync(outPath, Buffer.from(rr[0].base64, 'base64'));
      produced[c.key] = outPath;
    }
    await P.restorePrintOverride(app);

    // reference mapping
    const ref = await pageImages(produced['1-horizontal']);
    const refHash = ref.map((imgs) => (imgs.length === 1 ? imgs[0].hash : null));
    let refOk = refHash.every((h) => h !== null);
    console.log(`[adv-parity] reference 1-up hashes ${JSON.stringify(refHash)} ok=${refOk}`);

    const parityProblems = [];
    for (const c of cases) {
      const { key, nup, order, count } = c;
      if (key === '1-horizontal') continue;
      const imgPages = await pageImages(produced[key]);
      const sheetCount = Math.ceil(count / nup);
      if (imgPages.length !== sheetCount) {
        parityProblems.push(`${key}: produced sheets ${imgPages.length} != expected ${sheetCount}`);
      }
      const o = oracle(nup, order);
      for (let s = 0; s < imgPages.length; s += 1) {
        const base = s * nup;
        const remaining = count - base;
        const imgs = imgPages[s];
        // expected non-empty slots in DOM order
        const expSlots = [];
        for (let cell = 0; cell < o.slots.length; cell += 1) {
          const k = o.slots[cell];
          if (k < remaining) expSlots.push(k);
        }
        if (imgs.length !== expSlots.length) {
          parityProblems.push(`${key} sheet ${s}: images ${imgs.length} != expected filled cells ${expSlots.length}`);
          continue;
        }
        for (let j = 0; j < imgs.length; j += 1) {
          const expPage = base + expSlots[j] + 1;
          const actualPage = refOk ? refHash.indexOf(imgs[j].hash) + 1 : null;
          if (refOk && actualPage !== expPage) {
            parityProblems.push(`${key} sheet ${s} cell#${j}: produced page ${actualPage} != rule page ${expPage}`);
          }
        }
        // position sanity: derive grid row/col from cm translations
        const xs = [...new Set(imgs.map((i) => i.cm[4]))];
        const ys = [...new Set(imgs.map((i) => i.cm[5]))];
        const distinctCols = xs.length;
        const distinctRows = ys.length;
        if (imgs.length > 1 && distinctCols > o.cols) {
          parityProblems.push(`${key} sheet ${s}: ${distinctCols} distinct x positions > cols ${o.cols}`);
        }
        if (imgs.length > 1 && distinctRows > o.rows) {
          parityProblems.push(`${key} sheet ${s}: ${distinctRows} distinct y positions > rows ${o.rows}`);
        }
      }
      console.log(`[adv-parity] produced ${key}: sheets=${imgPages.length} filled=${JSON.stringify(imgPages.map((x) => x.length))} hashes=${JSON.stringify(imgPages.map((x) => x.map((i) => i.hash.slice(0, 6))))}`);
    }
    console.log(`[adv-parity] PRODUCED_PARITY_PROBLEMS=${parityProblems.length} refOk=${refOk}`);
    for (const e of parityProblems) console.log(`[adv-parity]   PROBLEM ${e}`);
    results.push({ previewMismatch, parityProblems, refOk });
  } catch (e) {
    console.log(`[adv-parity] HARNESS ERROR: ${e && e.stack ? e.stack : e}`);
    results.push({ error: String(e) });
  } finally {
    await hardClose(app, 'adv-parity');
  }
  fs.writeFileSync(path.join(OUT, 'parity-result.json'), JSON.stringify(results, null, 2));
  console.log('[adv-parity] DONE');
})().catch((e) => { console.error(e); process.exit(1); });