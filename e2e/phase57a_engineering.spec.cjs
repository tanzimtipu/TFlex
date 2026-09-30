// Phase 57 feature A (QA) - PDF/E engineering documents, focused verification.
// ONE test in ONE file, driven through the REAL Electron UI via launchApp.
//
// Proves:
//   1. the Engineering layers panel lists the fixture's OCGs with the correct
//      names/count, and toggling one flips its checkbox without dropping rows;
//   2. toggling a layer changes the RENDERED page canvas pixels (before/after);
//   3. a document carrying a 3D annotation still renders the page's other
//      content and shows the non-dismissible limitation naming page + object;
//   4. the XMP pdfe CAD metadata appears in the Document info surface;
//   5. the two verbs are reachable from the REVIEW Action Dock.
//
// Fixtures are built IN-SPEC. The layer fixture is hand-authored raw PDF bytes
// (with a real xref table) so PDF.js honours optional content: two coloured
// rectangles, each inside its own /OC /MCn BDC ... EMC block.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, gotoStage, scrollToPage } = require('./lib/helpers.cjs');
const { PDFDocument, PDFName, PDFString, rgb } = require('@cantoo/pdf-lib');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p57a');
  app = null;
  win = null;
});

test.setTimeout(300000);

// ---- in-spec fixtures -----------------------------------------------------

// Hand-authored raw PDF: one page, /OCProperties with two named OCGs
// (Walls, Pipes). The page /Resources /Properties maps MC0->Walls, MC1->Pipes,
// and the content stream paints a RED rect inside /OC /MC0 and a BLUE rect
// inside /OC /MC1. A correct xref table is computed from byte offsets.
function buildRawLayersPdf() {
  const content =
    '/OC /MC0 BDC\n' +
    '1 0 0 rg\n' +
    '40 300 120 60 re f\n' +
    'EMC\n' +
    '/OC /MC1 BDC\n' +
    '0 0 1 rg\n' +
    '40 140 120 60 re f\n' +
    'EMC\n';
  const objs = {
    1: '<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [5 0 R 6 0 R] /D << /Type /OCConfig /ON [5 0 R 6 0 R] /OFF [] /Order [5 0 R 6 0 R] >> >> >>',
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] /Resources << /ProcSet [/PDF] /Properties << /MC0 5 0 R /MC1 6 0 R >> >> /Contents 4 0 R >>',
    4: `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
    5: '<< /Type /OCG /Name (Walls) >>',
    6: '<< /Type /OCG /Name (Pipes) >>',
  };
  let out = '%PDF-1.5\n';
  const offsets = {};
  for (let i = 1; i <= 6; i++) {
    offsets[i] = Buffer.byteLength(out, 'latin1');
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += 'xref\n0 7\n0000000000 65535 f \n';
  for (let i = 1; i <= 6; i++) {
    out += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  }
  out += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// 2-page pdf-lib document. Page 1 blank; page 2 carries a visible rectangle
// plus one /Subtype /3D annotation named Turbine.
async function build3dPdf(file) {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const p2 = doc.addPage([400, 400]);
  p2.drawRectangle({ x: 80, y: 80, width: 240, height: 240, color: rgb(0.15, 0.45, 0.25) });
  const annot = doc.context.obj({
    Type: 'Annot',
    Subtype: '3D',
    NM: PDFString.of('Turbine'),
    Rect: [0, 0, 10, 10],
  });
  p2.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(annot)]));
  fs.writeFileSync(file, await doc.save());
  return file;
}

// Minimal XMP packet with the pdfe engineering blocks (identification,
// measurement, geospatial), matching the engine's parser contract.
function xmpPacket() {
  return [
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about="" xmlns:pdfe="http://www.aiim.org/pdfe/ns/">',
    '<pdfe:Identification><rdf:Bag><rdf:li rdf:parseType="Resource">',
    '<pdfe:Part>1</pdfe:Part>',
    '<pdfe:Conformance>E</pdfe:Conformance>',
    '</rdf:li></rdf:Bag></pdfe:Identification>',
    '<pdfe:Measurement><rdf:Bag><rdf:li rdf:parseType="Resource">',
    '<pdfe:Type>Distance</pdfe:Type>',
    '<pdfe:Value>10 mm</pdfe:Value>',
    '</rdf:li></rdf:Bag></pdfe:Measurement>',
    '<pdfe:Geospatial><rdf:Bag><rdf:li rdf:parseType="Resource">',
    '<pdfe:GTS_Projection>EPSG:4326</pdfe:GTS_Projection>',
    '</rdf:li></rdf:Bag></pdfe:Geospatial>',
    '</rdf:Description></rdf:RDF></x:xmpmeta>',
  ].join('');
}

// One pdf-lib page plus a catalog /Metadata stream carrying the pdfe packet.
async function buildCadPdf(file) {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]);
  const stream = doc.context.flateStream(xmpPacket(), { Type: 'Metadata', Subtype: 'XML' });
  doc.catalog.set(PDFName.of('Metadata'), doc.context.register(stream));
  fs.writeFileSync(file, await doc.save());
  return file;
}

// ---- UI driving helpers ---------------------------------------------------

async function stubOpenDialog(fp) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, fp);
}

// Open a file through the real header Open control (dialog stubbed), wait for
// that tab to be active, for the engine page count to settle and for page 1's
// canvas to be mounted.
async function openPdf(filePath, pages) {
  const want = path.basename(filePath, path.extname(filePath));
  await stubOpenDialog(filePath);
  await win.locator('[aria-label="Open PDF document"]').first().click();
  await win.waitForFunction((t) => {
    const active = document.querySelector('[data-tab-id][aria-selected="true"]');
    return active !== null && active.textContent.includes(t);
  }, want, { timeout: 30000 });
  await win.waitForFunction((n) => {
    const d = window.tflexDiagnostics();
    return d !== undefined && d.pageCount === n;
  }, pages, { timeout: 30000 });
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .pdf-page[data-page="1"] canvas', {
    timeout: 20000,
  });
  await win.waitForTimeout(500);
}

// Run a registry verb through the real Command Palette (Ctrl+Shift+P).
async function runPaletteVerb(toolId, filter, dialogSel) {
  await win.keyboard.press('Control+Shift+P');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 10000 });
  await win.locator('[data-command-palette-input]').fill(filter);
  await win.waitForTimeout(300);
  const row = win.locator(`[data-palette-tool-id="${toolId}"]`).first();
  await row.waitFor({ state: 'visible', timeout: 8000 });
  expect(await row.getAttribute('data-palette-disabled'), `${toolId} palette row enabled`).toBe('false');
  await row.click();
  await win.waitForSelector(dialogSel, { state: 'visible', timeout: 10000 });
  await win.waitForTimeout(250);
}

// Count red / blue / non-white pixels on the active pane's page-N canvas.
async function canvasCounts(pageNo, fromKey) {
  return win.evaluate(({ n, key }) => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
    const page = pane && pane.querySelector(`.pdf-page[data-page="${n}"]`);
    const canvas = page && page.querySelector('canvas');
    if (!canvas || canvas.width === 0) return null;
    const img = key
      ? window[key]
      : canvas.getContext('2d', { willReadFrequently: true })
          .getImageData(0, 0, canvas.width, canvas.height);
    if (!img) return null;
    const d = img.data;
    let red = 0, blue = 0, nonWhite = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
      if (a > 10 && !(r > 245 && g > 245 && b > 245)) nonWhite++;
      if (r > 140 && g < 110 && b < 110) red++;
      if (b > 140 && r < 110 && g < 110) blue++;
    }
    return { w: img.width, h: img.height, red, blue, nonWhite };
  }, { n: pageNo, key: fromKey || null });
}

// Stash the current page-N canvas ImageData in the page context for a diff.
async function stashCanvas(pageNo) {
  await win.evaluate((n) => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
    const page = pane && pane.querySelector(`.pdf-page[data-page="${n}"]`);
    const canvas = page && page.querySelector('canvas');
    if (!canvas || canvas.width === 0) { window.__p57aBefore = null; return; }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    window.__p57aBefore = ctx.getImageData(0, 0, canvas.width, canvas.height);
  }, pageNo);
}

// Diff the current page-N canvas against the stashed one and return colour
// counts too. diff = number of channel-differing pixels (-1 when no stash/dims).
async function diffCanvas(pageNo) {
  return win.evaluate((n) => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
    const page = pane && pane.querySelector(`.pdf-page[data-page="${n}"]`);
    const canvas = page && page.querySelector('canvas');
    if (!canvas) return null;
    const after = canvas.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, canvas.width, canvas.height);
    const d = after.data;
    let red = 0, blue = 0, nonWhite = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
      if (a > 10 && !(r > 245 && g > 245 && b > 245)) nonWhite++;
      if (r > 140 && g < 110 && b < 110) red++;
      if (b > 140 && r < 110 && g < 110) blue++;
    }
    const before = window.__p57aBefore;
    let diff = -1;
    if (before && before.width === after.width && before.height === after.height) {
      diff = 0;
      const A = after.data, B = before.data;
      for (let i = 0; i < A.length; i += 4) {
        if (
          Math.abs(A[i] - B[i]) > 8 ||
          Math.abs(A[i + 1] - B[i + 1]) > 8 ||
          Math.abs(A[i + 2] - B[i + 2]) > 8
        ) diff++;
      }
    }
    return { w: after.width, h: after.height, red, blue, nonWhite, diff };
  }, pageNo);
}

// Diagnostic: canvas dimensions + dominant pixel colours for one page.
async function canvasDebug(pageNo) {
  return win.evaluate((n) => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
    const page = pane && pane.querySelector(`.pdf-page[data-page="${n}"]`);
    const canvas = page && page.querySelector('canvas');
    if (!canvas) return null;
    const img = canvas.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, canvas.width, canvas.height);
    const counts = {};
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const k = `${d[i]},${d[i + 1]},${d[i + 2]},${d[i + 3]}`;
      counts[k] = (counts[k] || 0) + 1;
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([k, v]) => ({ px: k, n: v }));
    return { w: canvas.width, h: canvas.height, cssW: canvas.clientWidth, dpr: window.devicePixelRatio, top };
  }, pageNo);
}

async function readPairs(sectionTestId) {  return win.evaluate((id) => {
    const dl = document.querySelector(`[data-testid="${id}"]`);
    if (!dl) return null;
    return Array.from(dl.querySelectorAll('[data-testid="doc-info-pair"]')).map((div) => {
      const dt = div.querySelector('dt');
      const dd = div.querySelector('dd');
      return [dt ? dt.textContent.trim() : null, dd ? dd.textContent.trim() : null];
    });
  }, sectionTestId);
}

// ---------------------------------------------------------------------------
// The one test.
// ---------------------------------------------------------------------------
test('phase57a: engineering layers toggle + 3D notice + CAD metadata through the UI', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p57a-'));
  const layersPath = path.join(tmp, 'fix57a-layers.pdf');
  fs.writeFileSync(layersPath, buildRawLayersPdf());
  const threePath = path.join(tmp, 'fix57a-3d.pdf');
  await build3dPdf(threePath);
  const cadPath = path.join(tmp, 'fix57a-cad.pdf');
  await buildCadPdf(cadPath);
  console.log('P57A_FIXTURES ' + JSON.stringify({ layersPath, threePath, cadPath }));

  // ---- (a) LAYER fixture -------------------------------------------------
  await openPdf(layersPath, 1);
  // Probe the engine bridge directly (diagnostic evidence, not an assertion).
  const probe = await win.evaluate(async () => {
    const d = window.tflexDiagnostics();
    const eng = window.tflex && window.tflex.engine;
    const out = {
      engineDocId: d.engineDocId,
      engineAvailable: d.engineAvailable,
      pageCount: d.pageCount,
      tflexKeys: window.tflex ? Object.keys(window.tflex) : null,
      engineKeys: eng ? Object.keys(eng) : null,
    };
    if (eng && eng.getLayers && d.engineDocId) {
      try { out.layersResult = await eng.getLayers(d.engineDocId); } catch (e) { out.layersThrew = String(e); }
    }
    if (eng && eng.getCadMetadata && d.engineDocId) {
      try { out.cadResult = await eng.getCadMetadata(d.engineDocId); } catch (e) { out.cadThrew = String(e); }
    }
    // Diagnostic: an UNBOUND call loses `this` on the renderer adapter, whose
    // methods read `this.inner`. Reproduces the observed pageerror text.
    if (eng && eng.getLayers && d.engineDocId) {
      const detached = eng.getLayers;
      try { await detached(d.engineDocId); out.unboundOk = true; }
      catch (e) { out.unboundThrew = String(e && e.message ? e.message : e); }
    }
    return out;
  });
  console.log('P57A_ENGINE_PROBE ' + JSON.stringify(probe));
  // The raw fixture must open and render BOTH rectangles before any assert.
  await win.waitForFunction(() => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
    const page = pane && pane.querySelector('.pdf-page[data-page="1"]');
    const canvas = page && page.querySelector('canvas');
    if (!canvas || canvas.width === 0) return false;
    const d = canvas.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let red = 0, blue = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (r > 140 && g < 110 && b < 110) red++;
      if (b > 140 && r < 110 && g < 110) blue++;
    }
    return red > 0 && blue > 0;
  }, null, { timeout: 25000 });

  // (5) REVIEW dock reachability with a document open.
  await gotoStage(win, 3);
  const inlineVerbs = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-dock-verb]')).map((b) => b.getAttribute('data-dock-verb')));
  let overflowVerbs = [];
  if (!(inlineVerbs.includes('engineeringLayers') && inlineVerbs.includes('documentInfo'))) {
    const overflow = win.locator('[data-dock-overflow]');
    if ((await overflow.count()) > 0 && await overflow.first().isVisible().catch(() => false)) {
      await overflow.first().click();
      await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 5000 }).catch(() => {});
      overflowVerbs = await win.evaluate(() =>
        Array.from(document.querySelectorAll('[data-dock-overflow-item]')).map((b) => b.getAttribute('data-dock-overflow-item')));
      await win.keyboard.press('Escape');
      await win.waitForTimeout(250);
    }
  }
  const dockHasEng = inlineVerbs.includes('engineeringLayers') || overflowVerbs.includes('engineeringLayers');
  const dockHasInfo = inlineVerbs.includes('documentInfo') || overflowVerbs.includes('documentInfo');
  console.log('P57A_DOCK ' + JSON.stringify({ inlineVerbs, overflowVerbs, dockHasEng, dockHasInfo }));
  expect.soft(dockHasEng, 'engineeringLayers reachable from the REVIEW dock').toBe(true);
  expect.soft(dockHasInfo, 'documentInfo reachable from the REVIEW dock').toBe(true);

  // (1) Open the Engineering layers panel via the Command Palette.
  await runPaletteVerb('engineeringLayers', 'engineering layers', '[data-engineering-layers-dialog]');
  const rowNames = (await win.locator('[data-layer-name]').allInnerTexts()).map((s) => s.trim());
  const rowCount = await win.locator('[data-testid="layer-row"]').count();
  const countEl = win.locator('[data-testid="layer-count"]');
  const countText = (await countEl.count()) > 0 ? (await countEl.innerText()).trim() : null;
  const emptyEl = win.locator('[data-testid="layer-empty"]');
  const emptyText = (await emptyEl.count()) > 0 ? (await emptyEl.innerText()).trim() : null;
  console.log('P57A_LAYERS ' + JSON.stringify({ rowCount, rowNames, countText, emptyText }));
  expect.soft(rowCount).toBe(2);
  expect.soft(rowNames).toEqual(['Walls', 'Pipes']);
  expect.soft(countText).toBe('2 layers');
  await win.screenshot({ path: path.join(SHOTS, 'p57a-layers-before.png') });

  if (rowCount === 2) {
    // Capture the page canvas BEFORE the toggle.
    await stashCanvas(1);
    const beforeCounts = await canvasCounts(1, '__p57aBefore');
    console.log('P57A_CANVAS_BEFORE ' + JSON.stringify(beforeCounts));

    // (2) Toggle Walls off.
    const wallsRow = win.locator('[data-testid="layer-row"]').filter({ hasText: 'Walls' }).first();
    const wallsToggle = wallsRow.locator('[data-testid="layer-toggle"]');
    expect.soft(await wallsToggle.isChecked()).toBe(true);
    await wallsToggle.click();
    await win.waitForFunction(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="layer-row"]'));
      const w = rows.find((r) => r.textContent.includes('Walls'));
      const cb = w && w.querySelector('[data-testid="layer-toggle"]');
      return cb !== null && cb !== undefined && !cb.disabled && !cb.checked;
    }, null, { timeout: 25000 });
    await win.waitForTimeout(1200);

    const rowsAfter = await win.locator('[data-testid="layer-row"]').count();
    const namesAfter = (await win.locator('[data-layer-name]').allInnerTexts()).map((s) => s.trim());
    const wallsCheckedAfter = await win.locator('[data-testid="layer-row"]')
      .filter({ hasText: 'Walls' }).first()
      .locator('[data-testid="layer-toggle"]').isChecked();
    console.log('P57A_LAYERS_AFTER ' + JSON.stringify({ rowsAfter, namesAfter, wallsCheckedAfter }));
    expect.soft(rowsAfter).toBe(2);
    expect.soft(namesAfter).toEqual(['Walls', 'Pipes']);
    expect.soft(wallsCheckedAfter).toBe(false);
    await win.screenshot({ path: path.join(SHOTS, 'p57a-layers-after.png') });

    // Measure the re-rendered canvas against the before image.
    const afterCounts = await diffCanvas(1);
    console.log('P57A_CANVAS_AFTER ' + JSON.stringify({ before: beforeCounts, after: afterCounts }));
    expect.soft(afterCounts && afterCounts.blue, 'Pipes rectangle still rendered').toBeGreaterThan(0);
    expect.soft(afterCounts && afterCounts.diff, 'rendered page changed after toggle').toBeGreaterThan(0);
    console.log('P57A_CANVAS_DELTA ' + JSON.stringify({
      beforeRed: beforeCounts ? beforeCounts.red : null,
      afterRed: afterCounts ? afterCounts.red : null,
      beforeBlue: beforeCounts ? beforeCounts.blue : null,
      afterBlue: afterCounts ? afterCounts.blue : null,
      pixelDiff: afterCounts ? afterCounts.diff : null,
    }));
  }

  await win.locator('[data-testid="layer-close"]').first().click();
  await win.waitForSelector('[data-engineering-layers-dialog]', { state: 'detached', timeout: 10000 });

  // ---- (b) 3D fixture ----------------------------------------------------
  await openPdf(threePath, 2);
  let noticeVisible = false;
  try {
    await win.waitForSelector('[data-testid="pdf3d-notice"]', { state: 'visible', timeout: 15000 });
    noticeVisible = true;
  } catch { /* a missing notice is the observation under test */ }
  const noticeText = noticeVisible ? await win.locator('[data-testid="pdf3d-notice"]').innerText() : null;
  const noticeCollapseCount = noticeVisible
    ? await win.locator(
      '[data-testid="pdf3d-notice"] [data-pdf3d-collapse]',
    ).count()
    : -1;
  const p1Counts = await canvasCounts(1);
  await scrollToPage(win, 2);
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .pdf-page[data-page="2"] canvas', { timeout: 15000 });
  await win.waitForFunction(() => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
    const page = pane && pane.querySelector('.pdf-page[data-page="2"]');
    const canvas = page && page.querySelector('canvas');
    if (!canvas || canvas.width === 0) return false;
    const d = canvas.getContext('2d', { willReadFrequently: true })
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let nonWhite = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
      if (a > 10 && !(r > 245 && g > 245 && b > 245)) nonWhite++;
    }
    return nonWhite > 500;
  }, null, { timeout: 20000 });
  const p2Counts = await canvasCounts(2);
  const dbg1 = await canvasDebug(1);
  const dbg2 = await canvasDebug(2);
  console.log('P57A_3D ' + JSON.stringify({
    noticeVisible,
    noticeText,
    noticeCollapseCount,
    p1NonWhite: p1Counts ? p1Counts.nonWhite : null,
    p2NonWhite: p2Counts ? p2Counts.nonWhite : null,
  }));
  console.log('P57A_3D_DEBUG ' + JSON.stringify({ dbg1, dbg2 }));
  const geom = await win.evaluate(() => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
    const page = pane && pane.querySelector('.pdf-page[data-page="2"]');
    const canvas = page && page.querySelector('canvas');
    const sc = document.querySelector('.document-scroller');
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    return { innerH: window.innerHeight, pageRect: r(page), canvasRect: r(canvas), scroller: r(sc), scrollTop: sc ? Math.round(sc.scrollTop) : null };
  });
  console.log('P57A_3D_GEOM ' + JSON.stringify(geom));
  const canvasLoc = win.locator('.tab-pane[aria-hidden="false"] .pdf-page[data-page="2"] canvas');
  if ((await canvasLoc.count()) > 0) {
    await canvasLoc.first().screenshot({ path: path.join(SHOTS, 'p57a-3d-page2-canvas.png') });
  }
  expect.soft(noticeVisible, '3D notice visible').toBe(true);
  expect.soft(noticeText !== null && noticeText.includes('Page 2'), 'notice names the page').toBe(true);
  expect.soft(noticeText !== null && noticeText.includes('Turbine'), 'notice names the 3D object').toBe(true);
  if (noticeVisible) expect.soft(noticeCollapseCount, 'notice has the collapse control').toBe(1);
  expect.soft(p2Counts && p2Counts.nonWhite, 'page 2 canvas not blank').toBeGreaterThan(500);
  await win.screenshot({ path: path.join(SHOTS, 'p57a-3d-notice.png') });

  // ---- (c) CAD metadata fixture -----------------------------------------
  await openPdf(cadPath, 1);
  await runPaletteVerb('documentInfo', 'document info', '[data-document-info-dialog]');
  const identPairs = await readPairs('doc-info-identification');
  const measPairs = await readPairs('doc-info-measurement');
  const geoPairs = await readPairs('doc-info-geospatial');
  const count3d = (await win.locator('[data-testid="doc-info-3d-count"]').innerText()).trim();
  const countLayers = (await win.locator('[data-testid="doc-info-layer-count"]').innerText()).trim();
  const noCad = await win.locator('[data-testid="doc-info-no-cad"]').count();
  console.log('P57A_DOCINFO ' + JSON.stringify({ identPairs, measPairs, geoPairs, count3d, countLayers, noCad }));
  expect.soft(identPairs).toEqual([['Part', '1'], ['Conformance', 'E']]);
  expect.soft(measPairs).toEqual([['Type', 'Distance'], ['Value', '10 mm']]);
  expect.soft(geoPairs).toEqual([['GTS_Projection', 'EPSG:4326']]);
  expect.soft(count3d).toBe('3D objects: 0');
  expect.soft(countLayers).toBe('Layers: 0');
  expect.soft(noCad).toBe(0);
  await win.screenshot({ path: path.join(SHOTS, 'p57a-document-info.png') });
  await win.locator('[data-testid="doc-info-close"]').first().click();
});
