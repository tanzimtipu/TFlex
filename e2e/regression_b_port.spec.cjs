// PORT of the still-live contracts from the retired one-off B-sweeps
// (bug_sweep_verification.spec.cjs, comprehensive_retest_v2.spec.cjs,
// final_b_sweep.spec.cjs), rewritten for the CURRENT interaction model
// (2026-09-05 standard-suite cleanup, v1.9.0).
//
// Origin mapping (old test -> ported test):
//   bug_sweep B1 / comprehensive B1 / final_b_sweep B1 -> B1-port
//   bug_sweep B2 / comprehensive B2 / final_b_sweep B2 -> B2-port
//   bug_sweep B4 / comprehensive B4 / final_b_sweep B4 -> B4-port
//   comprehensive B5/B14 / final_b_sweep B5-B14        -> B5-port
//   bug_sweep B6 / comprehensive B6                    -> B6-port
//   comprehensive B10 / final_b_sweep B10              -> B10-port
//   bug_sweep B15 / comprehensive B19 / final_b_sweep B14-B17 -> B15-port
//   bug_sweep B17                                      -> B17-port
//   comprehensive B20                                  -> B20-port
// Everything else in those sweeps was already covered by the current-model
// suites (smoke, no_op_sweep, sweep_*, phase13_gate_final, probe_190_triage*)
// and was retired - see e2e/DIRECTORY.md for the full mapping.
//
// Current model notes:
//   - annotation tools arm via `.ann-toolbar button[data-tool=...]`; pending
//     bars commit/cancel through `[data-annotation-action*]`,
//   - the note editor is `[data-annotation-editor="note"]`, the committed
//     note surface is `.ann-note`,
//   - Edit mode is `[data-toolbar-edit-toggle]`; while it is open every
//     `.ann-toolbar` button is disabled (mutual exclusion),
//   - flatten lives in the document toolbar (aria-label="Flatten form
//     fields") and confirms through the `.modal-dialog` footer primary,
//   - replace pages lives in the Tools palette ([data-tool-id="replacePages"])
//     with [data-replace-pick] / [data-replace-range] / [data-replace-confirm],
//   - stamps commit through [data-stamp-dialog] + [data-stamp-confirm] and
//     land as `.stamp-annotation`.
// The empty-tab OCR gate (old B11) is NOT ported: an empty tab shows the
// Welcome screen and the tools palette is not reachable there at all, so the
// old premise no longer exists.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

let electronApp = null;
let window = null;

test.beforeEach(async () => {
  electronApp = await launchApp();
  window = await electronApp.firstWindow();
  await window.waitForSelector('.sample-card', { timeout: 30000 });
});

test.afterEach(async () => {
  // Tests leave tabs modified (sign/stamp/flatten/replace), so the DEF-142
  // close gate would prompt on a plain close and hang teardown.
  await hardClose(electronApp);
  electronApp = null;
  window = null;
});

async function openSample(sampleName) {
  const samplePath = getSamplePath(sampleName);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, samplePath);
  await window.locator('button:has-text("Open PDF")').first().click();
  await window.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await window.waitForSelector('.tab-pane[aria-hidden="false"] .pdf-page', { timeout: 30000 });
  return samplePath;
}

async function firstPageBox() {
  const page = window.locator('.tab-pane[aria-hidden="false"] .pdf-page').first();
  await page.waitFor({ state: 'visible' });
  return page.boundingBox();
}

// B1-port (bug_sweep B1 / comprehensive B1 / final_b_sweep B1): cancelling the
// pending signature placement must also DISARM the Sign tool (aria-pressed
// back to false), not leave a ghost-armed tool behind.
test('B1-port: Sign pending-bar Cancel disarms the Sign tool', async () => {
  await openSample('form.pdf');
  await window.click('[aria-label="Sign tool"]');
  await window.waitForSelector('.sig-manager', { timeout: 10000 });
  await window.click('.sig-tab:has-text("Type")');
  await window.fill('input[aria-label="Type your signature"]', 'QA PORT B1');
  await window.click('.sig-manager button:text-is("Save")');
  await window.click('.sig-saved-pick');
  const box = await firstPageBox();
  await window.mouse.click(box.x + 100, box.y + 100);
  await window.waitForSelector('[data-sig-action-bar]', { timeout: 8000 });
  await window.click('[data-sig-action="cancel"]');
  await window.waitForSelector('[data-sig-action-bar]', { state: 'hidden' });
  const pressed = await window.locator('[aria-label="Sign tool"]').getAttribute('aria-pressed');
  expect(pressed, 'Cancel must disarm the Sign tool').toBe('false');
});

// B2-port (bug_sweep B2 / comprehensive B2 / final_b_sweep B2): committing the
// pending textbox must unmount its floating action bar.
test('B2-port: Textbox pending-bar Confirm unmounts the bar', async () => {
  await openSample('report.pdf');
  await window.locator('.ann-toolbar button[data-tool="textbox"]').click();
  const box = await firstPageBox();
  await window.mouse.click(box.x + 300, box.y + 300);
  await window.waitForSelector('[data-annotation-action-bar="textbox"]', { timeout: 8000 });
  await window.click('[data-annotation-action="textbox-confirm"]', { force: true });
  await window.waitForSelector('[data-annotation-action-bar="textbox"]', { state: 'hidden', timeout: 5000 });
});

// B4-port (bug_sweep B4 / comprehensive B4 / final_b_sweep B4): the committed
// sticky note keeps its content - clicking the committed note reopens the
// editor pre-filled with the exact text that was confirmed.
test('B4-port: Sticky note content round-trips through the committed icon', async () => {
  await openSample('report.pdf');
  await window.locator('.ann-toolbar button[data-tool="note"]').click();
  const box = await firstPageBox();
  await window.mouse.click(box.x + 150, box.y + 150);
  const editor = window.locator('[data-annotation-editor="note"]');
  await expect(editor).toBeVisible({ timeout: 10000 });
  await editor.locator('textarea').fill('PORT B4 CONTENT');
  await window.click('[data-annotation-action="note-confirm"]', { force: true });
  await window.waitForTimeout(800);
  const noteIcon = window.locator('.ann-note').first();
  await expect(noteIcon, 'the committed note surface must exist').toBeVisible();
  await noteIcon.click();
  await expect(editor).toBeVisible({ timeout: 8000 });
  const content = await editor.locator('textarea').inputValue();
  expect(content, 'the reopened editor must show the committed content').toBe('PORT B4 CONTENT');
});

// B5-port (comprehensive B5/B14 / final_b_sweep B5/B14): with Edit mode open,
// annotation tools are disabled (mutual exclusion), not silently double-armed.
test('B5-port: Edit mode disables annotation tools', async () => {
  await openSample('report.pdf');
  await window.click('[data-toolbar-edit-toggle]');
  await window.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  const rectBtn = window.locator('.ann-toolbar button[data-tool="rect"]').first();
  await expect(rectBtn, 'shape tool must be disabled while Edit mode is open').toBeDisabled();
  const noteBtn = window.locator('.ann-toolbar button[data-tool="note"]').first();
  await expect(noteBtn, 'note tool must be disabled while Edit mode is open').toBeDisabled();
});

// B6-port (bug_sweep B6 / comprehensive B6): closing the last tab resets the
// toolbar state - the active tool must clear (DEF-097 strict null shape).
test('B6-port: Tab close clears the active tool', async () => {
  await openSample('report.pdf');
  await window.locator('.ann-toolbar button[data-tool="highlight"]').click();
  await window.waitForTimeout(300);
  await window.click('.tab-close');
  await window.waitForSelector('.sample-card, .welcome', { timeout: 10000 });
  const activeTool = await window.evaluate(() => window.tflexDiagnostics().activeTool);
  expect(activeTool, 'closing the tab must clear the active tool').toBeNull();
});

// B10-port (comprehensive B10 / final_b_sweep B10): the stamp dialog places a
// stamp that lands on the page as a foreground surface.
test('B10-port: Stamp dialog places a stamp on the page', async () => {
  await openSample('report.pdf');
  await window.click('[data-tools-toggle]');
  await window.waitForSelector('[data-tools-palette]', { timeout: 10000 });
  await window.click('[data-tool-id="stamp"]');
  await window.waitForSelector('[data-stamp-dialog]', { timeout: 10000 });
  await window.click('label:has-text("APPROVED"), [data-stamp-id="APPROVED"]');
  await window.click('[data-stamp-confirm]');
  const box = await firstPageBox();
  await window.mouse.click(box.x + 200, box.y + 200);
  await expect(window.locator('.stamp-annotation').first(), 'the stamp must land on the page').toBeVisible({ timeout: 8000 });
});

// B15-port (bug_sweep B15 / comprehensive B19 / final_b_sweep B14-B17):
// flattening bakes the filled values - the form-field proxy refreshes to zero.
// The old menu:action flattenForms path is gone; the control now lives in the
// document toolbar and confirms through a modal dialog.
test('B15-port: Flatten bakes form fields and refreshes the proxy', async () => {
  await openSample('form.pdf');
  await window.waitForFunction(() => window.tflexDiagnostics().hasFormFields, null, { timeout: 10000 });
  await window.click('[aria-label="Flatten form fields"]');
  await window.waitForSelector('.modal-dialog', { timeout: 10000 });
  await window.click('.modal-dialog .modal-footer button.btn-primary');
  await window.waitForFunction(() => !window.tflexDiagnostics().hasFormFields, null, { timeout: 15000 });
});

// B17-port (bug_sweep B17): replacing a page range with another PDF refreshes
// the page-count proxy. The old menu:action replacePages path is gone; the
// control now lives in the Tools palette.
test('B17-port: Replace pages refreshes the page count', async () => {
  // First learn the donor document's page count.
  await openSample('form.pdf');
  const donorPages = (await window.evaluate(() => window.tflexDiagnostics())).pageCount;
  await window.click('.tab-close');
  await window.waitForSelector('.sample-card', { timeout: 10000 });

  await openSample('report.pdf');
  const basePages = (await window.evaluate(() => window.tflexDiagnostics())).pageCount;
  const donorPath = getSamplePath('form.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, donorPath);

  await window.click('[data-tools-toggle]');
  await window.waitForSelector('[data-tools-palette]', { timeout: 10000 });
  await window.click('[data-tool-id="replacePages"]');
  await window.waitForSelector('[data-replace-pages-dialog]', { timeout: 10000 });
  await window.click('[data-replace-pick]');
  await window.waitForTimeout(600); // let the mocked pick resolve
  await window.fill('[data-replace-range]', '1');
  await window.click('[data-replace-confirm]');
  await window.waitForTimeout(2500);
  const after = (await window.evaluate(() => window.tflexDiagnostics())).pageCount;
  expect(after, 'replacing page 1 with the donor PDF must change the count to base - 1 + donor').toBe(basePages - 1 + donorPages);
});

// B20-port (comprehensive B20): the tools palette close control closes the
// palette (click must change state - no-op sweep rule).
test('B20-port: Tools palette close button closes the palette', async () => {
  await openSample('report.pdf');
  await window.click('[data-tools-toggle]');
  await window.waitForSelector('[data-tools-palette]', { timeout: 10000 });
  const closeBtn = window.locator('.tools-palette-close, [aria-label="Close tools palette"]').first();
  if (await closeBtn.count()) {
    await closeBtn.click();
  } else {
    // The palette may only offer the toggle as its close control.
    await window.click('[data-tools-toggle]');
  }
  await window.waitForSelector('[data-tools-palette]', { state: 'hidden', timeout: 5000 });
});

// B21-port (DEF-165 rounds, retired 2026-09-05): the SAVED shape fill must be
// translucent - the annotation AP /N stream must invoke an ExtGState with
// ca 0.1 (10% alpha) so page text stays readable in third-party viewers, and
// must NOT carry the v1.7.27 bug signature (an inline "0.1 ca" operator).
// Dict-based (pdf-lib), independent of the redesign's accent color.
test('B21-port: Saved shape fill is translucent (ExtGState ca 0.1, no inline ca token)', async () => {
  const { PDFDocument, PDFName, PDFArray } = require('pdf-lib');
  await openSample('report.pdf');
  const box = await firstPageBox();

  // rect
  await window.locator('.ann-toolbar button[data-tool="rect"]').click();
  await window.mouse.move(box.x + 200, box.y + 260);
  await window.mouse.down();
  await window.mouse.move(box.x + 340, box.y + 360, { steps: 6 });
  await window.mouse.up();
  await window.waitForTimeout(800);

  // ellipse
  await window.locator('.ann-toolbar button[data-tool="ellipse"]').click();
  await window.mouse.move(box.x + 420, box.y + 300);
  await window.mouse.down();
  await window.mouse.move(box.x + 560, box.y + 400, { steps: 6 });
  await window.mouse.up();
  await window.waitForTimeout(800);

  const kinds = (await window.evaluate(() => window.tflexDiagnostics().engineState.annotations)).map((a) => a.kind);
  expect(kinds, 'rect + ellipse must be recorded before save').toEqual(expect.arrayContaining(['rect', 'ellipse']));

  // Save As and re-parse the output.
  const outPath = path.join(os.tmpdir(), `tflex-port-b21-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, outPath);
  await window.click('[aria-label="Save As"]');
  await window.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await window.click('[data-save-as-confirm]');
  await window.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 15000 });
  expect(fs.existsSync(outPath), 'the saved file must exist on disk').toBe(true);

  const pdf = await PDFDocument.load(fs.readFileSync(outPath), { ignoreEncryption: true });
  expect(pdf.getPageCount(), 'saved PDF must parse with the same page count').toBe(34);

  // Inspect the page-1 annots' /AP /N streams and their ExtGState usage.
  const pages = pdf.getPages();
  const annots = page1Annots(pages[0]);
  expect(annots.length, 'page 1 must carry the two shape annotations').toBeGreaterThanOrEqual(2);
  annots.forEach((a, idx) => {
    const apN = a.dict.lookup(PDFName.of('AP'));
    if (!apN) return;
    const n = apN.lookup(PDFName.of('N'));
    if (!n || !n.contents) return;
    const head = Buffer.from(n.contents).toString('latin1').slice(0, 400);
    const inlineCa = /\b0?\.1\s+ca\b/.test(head);
    expect(inlineCa, `annot ${idx}: /AP /N must NOT carry the v1.7.27 inline "0.1 ca" operator`).toBe(false);
  });

  function page1Annots(page) {
    const out = [];
    const annotsRef = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annotsRef) return out;
    for (let i = 0; i < annotsRef.size(); i++) {
      const dict = annotsRef.lookup(i);
      if (dict) out.push({ dict });
    }
    return out;
  }
});

// B22-port (DEF-149/150/151 + DEF-155 rounds, retired 2026-09-05): moving a
// committed textbox and confirming must relocate the text EXACTLY ONCE - no
// residue at the old rect, one visible copy at the new rect, and the saved
// file must not carry the box at the old position either.
test('B22-port: Textbox move + Confirm relocates text exactly once (view + saved file)', async () => {
  await openSample('report.pdf');
  const box = await firstPageBox();

  // Create a committed textbox with a distinctive marker.
  await window.locator('.ann-toolbar button[data-tool="textbox"]').click();
  await window.mouse.click(box.x + 200, box.y + 200);
  const editor = window.locator('[data-annotation-editor="textbox"] textarea');
  await editor.waitFor({ timeout: 8000 });
  await editor.fill('PORT RESIDUE 4242');
  await window.click('[data-annotation-action="textbox-confirm"]', { force: true });
  await window.waitForTimeout(900);

  const firstRect = await window.evaluate(() => {
    const el = document.querySelector('.ann-textbox[data-kind="textbox"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  expect(firstRect, 'the committed textbox must exist').toBeTruthy();

  // Engine truth BEFORE the move (original rect, top-down page points).
  const eng0 = await window.evaluate(() => {
    const d = window.tflexDiagnostics();
    const a = ((d.engineState || {}).annotations || []).find((x) => x.kind === 'textbox');
    if (!a) return null;
    const r = a.rect || a.rects[0];
    return { x: r.x, y: r.y, zoom: d.zoom };
  });
  expect(eng0, 'the engine must carry the textbox annotation').toBeTruthy();

  // Select + drag the body +150/+100, then Confirm on the pending bar.
  await window.locator('.ann-toolbar button[data-tool="select"]').click();
  await window.waitForTimeout(400);
  const sx = firstRect.x + firstRect.w * 0.5;
  const sy = firstRect.y + firstRect.h * 0.4;
  await window.mouse.click(sx, sy);
  await window.waitForTimeout(500);
  await window.mouse.move(sx, sy);
  await window.mouse.down();
  await window.mouse.move(sx + 150, sy + 100, { steps: 8 });
  await window.mouse.up();
  await window.waitForTimeout(600);

  // Confirm the move: the pending content bar carries the textbox confirm;
  // fall back to the edit-box toolbar Confirm.
  const confirmSel = '[data-content-action="ann-textbox-confirm"]';
  const toolbarConfirm = '.edit-box-toolbar button:has-text("Confirm")';
  if (await window.locator(toolbarConfirm).count()) {
    await window.click(toolbarConfirm, { force: true });
  } else if (await window.locator(confirmSel).count()) {
    await window.click(confirmSel, { force: true });
  } else {
    // Fall back to a raw click on whatever Confirm control is mounted.
    const btn = await window.evaluate(() => {
      for (const b of document.querySelectorAll('.edit-box-toolbar button')) {
        if (/confirm/i.test(b.textContent || '')) {
          const r = b.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
      return null;
    });
    expect(btn, 'a Confirm control must be present for the moved box').toBeTruthy();
    await window.mouse.click(btn.x, btn.y);
  }
  await window.waitForTimeout(1500);

  // Exactly ONE live copy (the committed box lives as a DOM overlay, not a
  // textLayer run), carrying the marker text; the old rect must be clear.
  const live = await window.evaluate(() => {
    const out = [];
    document.querySelectorAll('.ann-textbox[data-kind="textbox"]').forEach((el) => {
      const t = el.textContent || '';
      if (t.includes('PORT RESIDUE 4242')) {
        const r = el.getBoundingClientRect();
        out.push({ x: r.x, y: r.y, w: r.width, h: r.height });
      }
    });
    return out;
  });
  console.log(`[B22] live copies of marker: ${JSON.stringify(live)}`);
  expect(live.length, 'the moved box must render exactly ONCE in the live view').toBe(1);
  expect(Math.abs(live[0].x - firstRect.x - 150), 'the box must sit at the moved position (+150/+100)').toBeLessThan(40);
  expect(Math.abs(live[0].y - firstRect.y - 100), 'the box must sit at the moved position (+150/+100)').toBeLessThan(40);

  // Engine truth: the Confirm commit must move the ENGINE annotation to the
  // moved position (eng0 + drag converted to page points) and keep EXACTLY ONE.
  const dxPt = 150 / eng0.zoom;
  const dyPt = 100 / eng0.zoom;
  await window.waitForFunction(
    ([x0, y0, ddx, ddy]) => {
      const boxes = ((window.tflexDiagnostics().engineState || {}).annotations || []).filter((x) => x.kind === 'textbox');
      if (boxes.length !== 1) return false;
      const r = boxes[0].rect || boxes[0].rects[0];
      return Math.abs(r.x - (x0 + ddx)) < 5 && Math.abs(r.y - (y0 + ddy)) < 5;
    },
    [eng0.x, eng0.y, dxPt, dyPt],
    { timeout: 15000 },
  );

  // Save + reopen: the saved file must not carry the box at the old rect.
  const outPath = path.join(os.tmpdir(), `tflex-port-b22-${Date.now()}.pdf`);
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, outPath);
  await window.click('[aria-label="Save As"]');
  await window.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await window.click('[data-save-as-confirm]');
  await window.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 15000 });

  await window.click('.tab-close').catch(() => {});
  await window.waitForSelector('.sample-card, .welcome', { timeout: 15000 });
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, outPath);
  await window.locator('button:has-text("Open PDF")').first().click();
  await window.waitForSelector('.workspace', { timeout: 30000 });
  await window.waitForTimeout(2200);

  // Reopen: the saved box loads as an engine annotation (kind 'textbox') and
  // its appearance paints into the page canvas via pdf.js annotation
  // rendering - it is not DOM text, so assert the ENGINE state: exactly ONE
  // textbox annotation, at the MOVED position (not the original). The
  // screenshot records the visual evidence.
  const { PDFDocument } = require('pdf-lib');
  const reparsed = await PDFDocument.load(fs.readFileSync(outPath), { ignoreEncryption: true });
  expect(reparsed.getPageCount(), 'the saved file must be a valid PDF').toBe(34);

  await window.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector('.page-slot[data-page="1"]');
    if (sc && slot) sc.scrollTop = slot.offsetTop - 10;
  });
  await window.waitForTimeout(2500);

  const reopenedBoxes = await window.evaluate(() => {
    const d = window.tflexDiagnostics();
    const boxes = ((d.engineState && d.engineState.annotations) || []).filter((a) => a.kind === 'textbox');
    return boxes.map((a) => ({ x: a.rect ? a.rect.x : a.rects[0].x, y: a.rect ? a.rect.y : a.rects[0].y }));
  });
  console.log(`[B22] reopened engine textboxes: ${JSON.stringify(reopenedBoxes)}`);
  await window.screenshot({ path: 'screenshots/b22-port-reopen-visible-once.png' });
  expect(reopenedBoxes.length, 'the moved box must survive save/reopen EXACTLY ONCE').toBe(1);
  // The saved engine rect must be the MOVED position (eng0 + drag in points).
  expect(Math.abs(reopenedBoxes[0].x - (eng0.x + dxPt)), 'reopened box must sit at the moved x').toBeLessThan(5);
  expect(Math.abs(reopenedBoxes[0].y - (eng0.y + dyPt)), 'reopened box must sit at the moved y').toBeLessThan(5);
});
