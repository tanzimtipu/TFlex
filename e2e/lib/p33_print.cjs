// Phase 33 e2e print seam (qa). Drives the real Print dialog and produces
// real PDFs through the app's own printJob with WebContents.print overridden
// to printToPDF on the same webContents (the Phase 30 seam). Never prints to
// a physical device: the device name is bogus and the override intercepts
// before any driver.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const zlib = require('node:zlib');

const OUT = path.join(os.tmpdir(), 'opencode');
const BOGUS_DEVICE = 'TFlex QA Bogus Printer';

async function openDialog(win) {
  await win.click('[data-print]');
  await win.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 15000 });
  await win.waitForFunction(
    () => {
      const sel = document.querySelector('[data-print-printer]');
      if (sel === null) return false;
      const hasReal = [...sel.querySelectorAll('option')].some((o) => o.value !== '');
      const settled = document.querySelector('[data-print-empty], [data-print-printers-error]') !== null;
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

// Preview geometry for one (nup, order) pair: grid templates, per-cell rects
// and the cell -> page mapping (the layout slot assignment).
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
        page: c.getAttribute('data-print-preview-page'),
      };
    });
    return {
      gridTemplateColumns: cs.gridTemplateColumns,
      gridTemplateRows: cs.gridTemplateRows,
      cells,
      pages: cells.map((c) => (c.page === null ? null : Number(c.page))),
    };
  });
}

function trackCount(s) {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// ---- payload capture (renderer seam, main-process fallback) --------------
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
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.from(r.base64, 'base64'));
  return { res, options: r.options };
}

async function inspectPdf(file) {
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.load(fs.readFileSync(file), { ignoreEncryption: true });
  const sizes = doc.getPages().map((p) => {
    const s = p.getSize();
    return { width: +s.width.toFixed(2), height: +s.height.toFixed(2) };
  });
  return { pageCount: doc.getPageCount(), sizes };
}

// Page-1 image placements: each `Do` paired with the nearest preceding `cm`
// (the image transform) plus the md5 of the image stream it resolves to.
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
  const cmsAll = [];
  const reCmAll = /([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+cm/g;
  let mm;
  while ((mm = reCmAll.exec(text)) !== null) cmsAll.push({ idx: mm.index, cm: mm.slice(1, 7).map(Number) });
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
    if (cm === null || Math.abs(cm[0]) < 100) continue;
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
  return { cellImages, textLen: text.length };
}

module.exports = {
  OUT,
  BOGUS_DEVICE,
  openDialog,
  closeDialog,
  confirmAndWait,
  measurePreview,
  trackCount,
  installCapture,
  restoreCapture,
  getCaptured,
  installPrintOverride,
  restorePrintOverride,
  produce,
  inspectPdf,
  placementSignature,
};