// TFL-694 (TFL-525 G) — focused saved-file oracle for the DEF-537 run-commit
// fix. The sweep spec proves the run edit commits in-memory (modified=true,
// marker in the page-1 .textLayer). This spec proves the DECISIVE contract
// from the defect: after Confirm, a Save-As of the document must carry the
// edited run text in the saved file, verified by REPARSING the saved PDF with
// pdf.js (not just a raw byte scan, which can miss encoded/compressed text).
// Read-only on src/. Run: npm.cmd run test:e2e -- tfl694_def537_savedbytes
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, gotoStage, scrollToPage } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const MARKER = 'ZZUNDO';
test.setTimeout(180000);

let app = null;
let win = null;
let sample = null;

async function armTextTool() {
  await gotoStage(win, 2);
  const verb = win.locator('[data-action-dock] [data-dock-verb="editText"]').first();
  await verb.waitFor({ state: 'visible', timeout: 12000 });
  await verb.click();
  await win.waitForTimeout(400);
  await win.waitForFunction(
    () => document.querySelector('.edit-layer[data-tool="text"]') !== null,
    undefined, { timeout: 8000 },
  );
}

async function findRunSpan() {
  return win.evaluate((want) => {
    const spans = Array.from(document.querySelectorAll(`.page-slot[data-page="${want}"] .textLayer span`));
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      const r = s.getBoundingClientRect();
      if (t.length >= 6 && r.width > 20 && r.height > 4) {
        return { text: t, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      }
    }
    return null;
  }, 1);
}

async function layerText(page) {
  return win.evaluate((want) => Array.from(
    document.querySelectorAll(`.page-slot[data-page="${want}"] .textLayer span`),
  ).map((s) => s.textContent || '').join(' '), page);
}

async function saveAs(fileName) {
  const savePath = path.join(os.tmpdir(), fileName);
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.locator('[data-toolbar-save-as]').first().click();
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 12000 });
  await win.waitForTimeout(300);
  await win.locator('[data-save-as-confirm]').first().click();
  await win.waitForFunction(
    () => document.querySelector('[data-save-as-dialog]') === null,
    undefined, { timeout: 20000 },
  );
  await win.waitForTimeout(1500);
  return savePath;
}

async function reparsedPage1Text(filePath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  return content.items.map((i) => i.str).join(' ');
}

test.beforeEach(async () => {
  sample = getSamplePath('report.pdf');
  app = await launchApp([sample]);
  win = await app.firstWindow();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await scrollToPage(win, 1);
  await win.waitForTimeout(600);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl694');
  app = null; win = null; sample = null;
});

test('DEF-537: Confirm run edit persists into the saved PDF (reparse oracle)', async () => {
  await armTextTool();
  const run = await findRunSpan();
  expect(run, 'a page-1 run is discoverable').not.toBeNull();

  await win.mouse.click(run.cx, run.cy);
  await win.waitForSelector('[data-textrun-selection]', { timeout: 10000 }).catch(() => {});
  const field = win.locator('[data-txt-text]').first();
  await field.waitFor({ state: 'visible', timeout: 12000 });
  await field.click();
  await field.fill(`${run.text} ${MARKER}`);
  await win.waitForTimeout(500);
  await win.locator('[data-content-action="textrun-confirm"]').first().click();
  await win.waitForTimeout(1800);

  const diag = await win.evaluate(() => window.tflexDiagnostics());
  const layer = await layerText(1);
  const inLayer = layer.includes(MARKER);
  console.log(`[TFL694] modified=${diag.modified} markerInLayer=${inLayer}`);

  const saved = await saveAs(`tfl694-def537-run-${Date.now()}.pdf`);
  const bytes = fs.readFileSync(saved);
  const rawBytesHasMarker = bytes.includes(Buffer.from(MARKER, 'latin1'));
  const reparsed = await reparsedPage1Text(saved);
  const reparsedHasMarker = reparsed.includes(MARKER);
  console.log(`[TFL694] saved=${saved} rawBytesHasMarker=${rawBytesHasMarker} reparsedHasMarker=${reparsedHasMarker}`);
  console.log(`[TFL694] reparsedPage1="${reparsed.slice(0, 160)}"`);

  await win.screenshot({ path: path.join(SHOTS, 'tfl694-def537-confirm.png') });
  expect(diag.modified, 'document marked modified').toBe(true);
  expect(inLayer, 'marker in page-1 text layer').toBe(true);
  expect(reparsedHasMarker, 'marker present after reparsing the saved PDF').toBe(true);
});
