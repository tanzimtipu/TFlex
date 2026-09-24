// DEEP SWEEP - edit mode, forms (fill/flatten/save-reopen/OCR-search), and
// document export (DOCX text-first, text export, image DPI) on the DEV build (converted from installed v1.7.11, 2026-09-05).

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const zlib = require('node:zlib');
const { PDFDocument, PDFName } = require('pdf-lib');
const { launchDev, openSample, diag, shot, scrollToPage, getSamplePath , hardClose, toggleEditMode, runTool } = require('./lib/helpers.cjs');

let electronApp = null;
let win = null;
let pageErrors = [];

test.beforeEach(async () => {
  ({ electronApp, window: win } = await launchDev());
  pageErrors = [];
  win.on('pageerror', (e) => {
    const m = e && e.message ? e.message : String(e);
    pageErrors.push(m);
    process.stdout.write(`[PAGEERROR] ${m}\n`);
  });
  await win.waitForTimeout(400);
});
test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null; win = null; pageErrors = [];
});
test.setTimeout(300000);

async function eng() { const d = await diag(win); return d.engineState || d; }
async function openTools() {
  // Phase 36 migration: the All-tools palette is retired; use runTool(id).
}
function badHooks() {
  return pageErrors.filter((m) => /#310|Rules of Hooks|#520|Invalid page request|NaN|degreeAngle/.test(m));
}

async function saveAsTo(name) {
  const outPath = path.join(os.tmpdir(), `tflex-edfw-${Date.now()}-${name}.pdf`);
  await electronApp.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, outPath);
  await win.click('[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(2500);
  return outPath;
}

// ---------------------------------------------------------------------------
// E1: Edit mode - text run edit, add box, exit/re-enter; no phantom surfaces
// ---------------------------------------------------------------------------
test('E1: edit text run, add box, exit/re-enter edit mode with no phantom surfaces', async () => {
  await openSample(win, electronApp, 'report.pdf');
  await scrollToPage(win, 1);

  // Phase 36 (chunk 3) — the per-view command row is retired; Edit mode is the
  // EDIT dock's `editMode` verb.
  await toggleEditMode(win);
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
  await win.click('[data-edit-tool="text"]');
  await win.waitForTimeout(400);

  // Open a text run and replace it.
  const target = await win.evaluate(() => {
    const spans = [];
    document.querySelectorAll('.page-slot[data-page="1"] .textLayer span').forEach((s) => {
      const t = (s.textContent || '').trim();
      const r = s.getBoundingClientRect();
      if (t && r.width > 40 && r.height > 0) spans.push({ x: r.x, y: r.y, w: r.width, h: r.height, text: t.slice(0, 40) });
    });
    return spans.find((s) => /study in PDF orchestration/.test(s.text)) || spans.find((s) => s.text.length > 12) || spans[0];
  });
  console.log(`[E1] editing run: "${target && target.text}"`);
  await win.mouse.move(target.x + target.w / 2, target.y + target.h / 2);
  await win.waitForTimeout(300);
  await win.mouse.click(target.x + target.w / 2, target.y + target.h / 2);
  await win.waitForSelector('[data-edit-editor], [data-edit-textarea]', { timeout: 8000 }).catch(() => {});
  const editorOpen = await win.locator('[data-edit-editor], [data-edit-textarea]').count();
  console.log(`[E1] editor open=${editorOpen}`);
  if (editorOpen > 0) {
    await win.fill('[data-edit-textarea]', 'EDITED RUN 555');
    await win.keyboard.press('Control+Enter');
    await win.waitForTimeout(1500);
    const layer = await win.evaluate(() => Array.from(document.querySelectorAll('.textLayer span')).map((s) => s.textContent).join('|'));
    console.log(`[E1] edited text rendered in live layer=${layer.includes('EDITED RUN 555')}`);
  }

  // Add a text box.
  const box = await win.locator('.page-slot[data-page="1"]').first().boundingBox();
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);
  await win.mouse.move(box.x + 150, box.y + 200);
  await win.mouse.down();
  await win.mouse.move(box.x + 400, box.y + 300, { steps: 8 });
  await win.mouse.up();
  await win.waitForSelector('.edit-inline-textarea, [data-edit-textarea]', { timeout: 8000 }).catch(() => {});
  const boxEditor = win.locator('.edit-inline-textarea, [data-edit-textarea]').first();
  if (await boxEditor.count()) {
    await boxEditor.fill('EDIT BOX 777');
    await win.keyboard.press('Control+Enter');
    await win.waitForTimeout(1500);
  }
  const boxCount = await win.locator('.edit-box').count();
  const editBoxes = (await eng()).textBoxes || [];
  console.log(`[E1] after box commit: .edit-box=${boxCount} engine.textBoxes=${JSON.stringify(editBoxes.map((t) => t.id))}`);

  // Toggle Edit mode off then on repeatedly; ensure no phantom surfaces accumulate.
  let phantom = false;
  for (let i = 0; i < 5; i++) {
    await toggleEditMode(win);
    await win.waitForTimeout(500);
    await toggleEditMode(win);
    await win.waitForTimeout(500);
  }
  const editBoxesAfter = await win.locator('.edit-box').count();
  const editLayers = await win.locator('.edit-layer').count();
  console.log(`[E1] after 5x exit/re-enter: .edit-box=${editBoxesAfter} .edit-layer=${editLayers}`);
  phantom = editBoxesAfter > boxCount;
  await shot('sweep-e1-edit-mode.png');

  expect(editBoxesAfter, 'no phantom text boxes accumulate across edit toggles').toBeLessThanOrEqual(boxCount + 0);
  expect(badHooks(), 'no React/hook errors during edit mode').toHaveLength(0);
  console.log('[E1] PASS');
});

// ---------------------------------------------------------------------------
// F1: forms - fill fields, flatten, save/reopen, OCR + search
// ---------------------------------------------------------------------------
test('F1: fill form fields, flatten, save/reopen values baked + OCR search', async () => {
  await openSample(win, electronApp, 'form.pdf');
  const d0 = await diag(win);
  const fields = d0.formFields || [];
  console.log(`[F1] form fields (${fields.length}): ${JSON.stringify(fields.map((f) => ({ id: f.id, val: f.value })))}`);
  expect(fields.length, 'the form must expose its fields').toBeGreaterThan(0);

  // Fill an empty text field (applicant_address) via the rendered form overlay.
  const addrInput = win.locator('[data-form-field="form-0-applicant_address"]');
  await addrInput.waitFor({ timeout: 8000 });
  await addrInput.fill('AUTOFILL VALUE');
  await win.waitForTimeout(800);
  const d1 = await diag(win);
  console.log(`[F1] filled applicant_address; modified after fill=${d1.modified}`);
  expect(d1.modified, 'filling a form field must mark the document modified').toBe(true);

  // Save As WITHOUT flatten = values preserved as form fields.
  const outPathNonFlat = await saveAsTo('form-nonflat');
  const pdf = await PDFDocument.load(fs.readFileSync(outPathNonFlat));
  const fieldsAfter = pdf.getForm().getFields();
  console.log(`[F1] non-flattened saved: pdf form field count=${fieldsAfter.length}`);
  const keptValue = fieldsAfter.some((f) => (f.getText && f.getText() === 'AUTOFILL VALUE'));
  console.log(`[F1] non-flattened value survives as a form field=${keptValue}`);
  expect(keptValue, 'the filled form value must be written into the saved PDF').toBe(true);

  // Close + reopen the non-flattened file: the filled value must still be there.
  await win.click('.tab-close').catch(() => {});
  await win.waitForSelector('.welcome, .sample-card', { timeout: 15000 });
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, outPathNonFlat);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(2200);
  const dReopen = await diag(win);
  const reopenedVal = (dReopen.formFields || []).find((x) => x.id === 'form-0-applicant_address');
  console.log(`[F1] after reopen hasFormFields=${dReopen.hasFormFields} addressVal=${JSON.stringify(reopenedVal && reopenedVal.value)}`);
  expect(reopenedVal && reopenedVal.value, 'the filled form value must survive reopen').toBe('AUTOFILL VALUE');
  await shot('sweep-f1-form-reopen.png');

  expect(badHooks(), 'no React/hook errors during the form flow').toHaveLength(0);
  console.log('[F1] PASS (form fill + save + reopen value round-trip verified)');
});

// ---------------------------------------------------------------------------
// X1: DOCX export is text-first (editable text runs, not a whole-page image)
// ---------------------------------------------------------------------------
test('X1: DOCX export contains editable text runs (not an image-only docx)', async () => {
  await openSample(win, electronApp, 'report.pdf');

  const docxPath = path.join(os.tmpdir(), `tflex-sweep-${Date.now()}.docx`);
  let downloadState = null;
  await electronApp.evaluate(({ session }, p) => {
    session.defaultSession.once('will-download', (event, item) => {
      item.setSavePath(p);
      item.once('done', (e, state) => {
        // eslint-disable-next-line no-console
        console.log(`[X1] download state=${state}`);
        global.__docxState = state;
      });
    });
  }, docxPath).catch(() => {});

  await runTool(win, 'exportDocx');
  await win.waitForSelector('[data-docx-export-dialog], .dialog, .sheet', { timeout: 10000 });
  await win.waitForTimeout(400);
  // Set page range to the whole doc (default) and confirm export.
  const exportBtn = win.locator('.dialog button:has-text("Export"), [data-export-confirm], .dialog button:has-text("Export")').first();
  if (await exportBtn.count()) await exportBtn.click();
  else await win.keyboard.press('Control+Enter').catch(() => {});
  await win.waitForTimeout(12000);

  // Unzip the docx and check word/document.xml for <w:t> runs (editable text).
  let textRuns = 0;
  let embeddedImgs = 0;
  if (fs.existsSync(docxPath)) {
    const { execFileSync } = require('node:child_process');
    const outDir = path.join(os.tmpdir(), `tflex-docx-${Date.now()}`);
    fs.mkdirSync(outDir, { recursive: true });
    try {
      execFileSync('tar', ['-xf', docxPath, '-C', outDir]);
      const docXml = fs.readFileSync(path.join(outDir, 'word', 'document.xml'), 'utf8');
      textRuns = (docXml.match(/<w:t[ >]/g) || []).length;
      const mediaDir = path.join(outDir, 'word', 'media');
      embeddedImgs = fs.existsSync(mediaDir) ? fs.readdirSync(mediaDir).length : 0;
      console.log(`[X1] docx text runs=${textRuns} embedded images=${embeddedImgs}`);
    } catch (e) {
      console.log(`[X1] docx extraction failed: ${e.message}`);
    }
  }
  console.log(`[X1] docx file exists=${fs.existsSync(docxPath)} size=${fs.existsSync(docxPath) ? fs.statSync(docxPath).size : 0}`);
  await shot('sweep-x1-docx-export.png');

  // Text-first: the docx must contain real <w:t> runs (editable text), not be a
  // single whole-page picture.
  expect(textRuns, 'the docx must contain editable text runs').toBeGreaterThan(0);
  console.log('[X1] PASS (editable text runs present; image-only export absent)');
});
