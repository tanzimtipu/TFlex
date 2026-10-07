// TFL-1201 adversary probe — ER20 export truthfulness (real output vs displayed).
// Launches ONLY via e2e/lib/launch.cjs. Read-only against product code.
//
// Attack 1: the diff added a displayed file COUNT + naming scheme for image
// exports. The audit never validated that against actual export output. This
// probe performs REAL exports and captures the REAL save primitive: the shipped
// renderer save path is an anchor download (`downloadBlob` in
// src/renderer/utils/exportDownload.ts), so every file TFlex writes to disk
// passes through `HTMLAnchorElement.prototype.click` with a `download` name and
// a blob. Playwright's Electron transport does not surface 'download' events
// for this build (verified: mechanism_check.log), so we record each real write
// at that primitive (name + exact bytes) and materialize it into a disposable
// folder. The product is not patched on disk; this is runtime observation of
// the real save call.
//
// Run: node test-fixtures/tfl1201-adversary/probe_export_truth.cjs

delete process.env.ELECTRON_RUN_AS_NODE;
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { openSample, gotoStage, hardClose, getSamplePath } = require('../../e2e/lib/helpers.cjs');

const DIR = __dirname;
const OUT_ROOT = path.join(DIR, 'out-export-truth');
const LOG = path.join(DIR, 'probe_export_truth.log');
const lines = [];
const writeLog = () => fs.writeFileSync(LOG, lines.join('\n') + '\n');
const log = (...a) => {
  const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  lines.push(s);
  process.stdout.write(s + '\n');
  try { writeLog(); } catch (_) {}
};

async function makeOnePageFixture() {
  const p = path.join(DIR, 'fixture-onepage.pdf');
  if (fs.existsSync(p)) return p;
  const { PDFDocument, StandardFonts, rgb } = require('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('One page adversary fixture', { x: 72, y: 700, size: 18, font, color: rgb(0, 0, 0) });
  fs.writeFileSync(p, await doc.save());
  return p;
}

function freshOutDir(name) {
  const d = path.join(OUT_ROOT, name);
  fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// Install the real-write observer once per window.
async function installObserver(win) {
  await win.evaluate(() => {
    if (window.__advInstalled) return;
    window.__advInstalled = true;
    window.__advWrites = [];
    const b64 = (bytes) => {
      let bin = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(bytes.length, i + chunk)));
      }
      return btoa(bin);
    };
    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      try {
        if (this.download) {
          const rec = { name: this.download, bytes: null, b64: null, err: null, magic: null };
          window.__advWrites.push(rec);
          const url = this.href;
          fetch(url)
            .then((r) => r.arrayBuffer())
            .then((ab) => {
              const u8 = new Uint8Array(ab);
              rec.bytes = u8.length;
              rec.magic = Array.from(u8.slice(0, 8)).map((n) => n.toString(16).padStart(2, '0')).join('');
              rec.b64 = b64(u8);
            })
            .catch((e) => { rec.err = String(e && e.message ? e.message : e); });
        }
      } catch (_) {}
      return origClick.apply(this, arguments);
    };
  });
}

async function drainWrites(win, outDir, settleMs = 1500) {
  await win.waitForTimeout(settleMs);
  await win
    .waitForFunction(() => window.__advWrites.every((r) => r.b64 !== null || r.err !== null), null, { timeout: 120000 })
    .catch(() => {});
  const recs = await win.evaluate(() => window.__advWrites.splice(0, window.__advWrites.length));
  for (const r of recs) {
    if (r.b64) {
      fs.writeFileSync(path.join(outDir, r.name), Buffer.from(r.b64, 'base64'));
      delete r.b64;
    }
  }
  return recs;
}

async function readDeliver(win) {
  return win.evaluate(() => {
    const norm = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
    const cfg = document.querySelector('[data-export-config]');
    return {
      format: cfg ? cfg.getAttribute('data-export-config-format') : null,
      outputValue: norm(document.querySelector('[data-export-config-output-value]')),
      outputScheme: norm(document.querySelector('[data-export-config-output-scheme]')),
      schemePresent: document.querySelector('[data-export-config-output-scheme]') !== null,
      rangeSummary: norm(document.querySelector('[data-export-config-range-summary]')),
      rangeError: norm(document.querySelector('[data-export-config-range-error]')),
      actionDisabled: (() => {
        const b = document.querySelector('[data-inspector-action="export"]');
        return b ? b.disabled : null;
      })(),
      dpiValue: (() => {
        const i = document.querySelector('[data-export-config-dpi-input]');
        return i ? i.value : null;
      })(),
    };
  });
}

async function selectFormat(win, id) {
  const el = win.locator(`[data-export-config-format-option="${id}"]`);
  if ((await el.count()) > 0) await el.first().check();
  await win.waitForTimeout(250);
}
async function selectScope(win, scope) {
  await win.locator(`[data-export-config-scope="${scope}"]`).first().check();
  await win.waitForTimeout(250);
}
async function setCustomRange(win, text) {
  await win.locator('[data-export-config-range]').first().fill(text);
  await win.waitForTimeout(300);
}
async function setDpi(win, val) {
  await win.locator('[data-export-config-dpi-input]').first().fill(String(val));
  await win.waitForTimeout(300);
}

async function runExport(win, outDir) {
  const action = win.locator('[data-inspector-action="export"]').first();
  await action.click();
  await win.waitForSelector('[data-export-dialog]', { timeout: 10000 });
  await win.waitForTimeout(300);
  const dialogState = await win.evaluate(() => {
    const d = document.querySelector('[data-export-dialog]');
    const range = d ? d.querySelector('[data-export-range]') : null;
    const dpi = d ? d.querySelector('[data-export-dpi]') : null;
    const confirm = d ? d.querySelector('[data-export-confirm]') : null;
    return {
      present: d !== null,
      range: range ? range.value : null,
      dpi: dpi ? dpi.value : null,
      confirmDisabled: confirm ? (confirm.disabled || confirm.getAttribute('aria-disabled') === 'true') : null,
    };
  });
  log(`  [dialog] ${JSON.stringify(dialogState)}`);
  await win.locator('[data-export-confirm]').first().click();
  await win.waitForSelector('[data-export-dialog]', { state: 'detached', timeout: 240000 }).catch(() => {});
  const files = await drainWrites(win, outDir, 2000);
  return { dialogState, files };
}

// Open a document whether or not one is already open. The shared helper's
// `.workspace` wait breaks once a second tab exists (2 nodes, first hidden), so
// this drives the real Home [data-home-tool="open"] entry and waits on the
// active tab pane instead.
async function openDoc(win, app, p) {
  const homeOpen = win.locator('[data-home-tool="open"]').first();
  if ((await homeOpen.count()) === 0 || !(await homeOpen.isVisible().catch(() => false))) {
    await win.locator('[data-new-tab]').first().click().catch(() => {});
    await win.waitForSelector('.welcome, .sample-card', { timeout: 15000 }).catch(() => {});
    await win.waitForTimeout(500);
  }
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('[data-home-tool="open"]').first().click();
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
  await gotoStage(win, 4);
  await win.waitForSelector('[data-export-config]', { timeout: 10000 });
}

async function main() {
  fs.mkdirSync(OUT_ROOT, { recursive: true });
  const onePage = await makeOnePageFixture();
  const app = await launchApp();
  G.app = app;
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await installObserver(win);
  log(`HEAD build: v1.51.0 dev renderer (HEAD dc68679 + TFL-1197/1199 tree)`);
  log(`onePageFixture=${onePage}`);

  const reportPath = getSamplePath('report.pdf');
  const reportStem = path.basename(reportPath).replace(/\.pdf$/i, '');

  // --- Case A: report.pdf (34 pages), png, all pages ---
  if (process.env.SKIP_A === '1') {
    log('CASE A skipped (SKIP_A=1)');
  } else {
  await openSample(win, app, 'report.pdf');
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1000);
  await gotoStage(win, 4);
  await win.waitForSelector('[data-export-config]', { timeout: 10000 });
  await selectFormat(win, 'png');
  await selectScope(win, 'all');
  await setDpi(win, 72);
  const aDisplay = await readDeliver(win);
  log(`CASE A display (report 34p, png, all): ${JSON.stringify(aDisplay)}`);
  log(`CASE A expected scheme: ${reportStem}-page-1.png ... ${reportStem}-page-34.png`);
  const aOut = freshOutDir('caseA-report-png-all');
  const a = await runExport(win, aOut);
  log(`CASE A actual files(${a.files.length}): ${JSON.stringify(a.files.map((f) => ({ n: f.name, b: f.bytes, m: f.magic, e: f.err })))}`);
  const aPng = a.files.filter((f) => f.magic && f.magic.startsWith('89504e470d0a1a0a')).length;
  log(`CASE A verdict: displayed="${aDisplay.outputValue}" actual=${a.files.length} pngMagic=${aPng} schemeMatch=${aDisplay.outputScheme === `${reportStem}-page-1.png \u2026 ${reportStem}-page-34.png`}`);
  writeLog();
  }

  // --- Case B: 1-page fixture, png, all pages ---
  await openDoc(win, app, onePage);
  await selectFormat(win, 'png');
  await selectScope(win, 'all');
  const bDisplay = await readDeliver(win);
  log(`CASE B display (1-page, png, all): ${JSON.stringify(bDisplay)}`);
  const bOut = freshOutDir('caseB-onepage-png-all');
  const b = await runExport(win, bOut);
  log(`CASE B actual files(${b.files.length}): ${JSON.stringify(b.files.map((f) => ({ n: f.name, b: f.bytes, m: f.magic })))}`);
  log(`CASE B verdict: displayed="${bDisplay.outputValue}" actual=${b.files.length} scheme="${bDisplay.outputScheme}"`);
  writeLog();

  // --- Case C: report.pdf, png, custom range with duplicate 1,1,34 ---
  await openDoc(win, app, reportPath);
  await selectFormat(win, 'png');
  await selectScope(win, 'custom');
  await setCustomRange(win, '1,1,34');
  const cDisplay = await readDeliver(win);
  log(`CASE C display (report, png, custom "1,1,34"): ${JSON.stringify(cDisplay)}`);
  const cOut = freshOutDir('caseC-report-png-dup');
  const c = await runExport(win, cOut);
  log(`CASE C actual files(${c.files.length}): ${JSON.stringify(c.files.map((f) => ({ n: f.name, b: f.bytes, m: f.magic })))}`);
  log(`CASE C verdict: displayed="${cDisplay.outputValue}" rangeSummary="${cDisplay.rangeSummary}" actual=${c.files.length}`);
  writeLog();

  // --- Case D: report.pdf, txt (non-image) — single-name display, no scheme ---
  await gotoStage(win, 4);
  await win.waitForSelector('[data-export-config]', { timeout: 10000 });
  await selectFormat(win, 'txt');
  const dDisplay = await readDeliver(win);
  log(`CASE D display (report, txt): ${JSON.stringify(dDisplay)}`);

  // --- Attack 2: gating preserved ---
  await selectFormat(win, 'png');
  await selectScope(win, 'custom');
  await setCustomRange(win, '1,999');
  const eInvalid = await readDeliver(win);
  log(`CASE E gating invalid range "1,999": ${JSON.stringify(eInvalid)}`);
  await setCustomRange(win, '1-34');
  await setDpi(win, 9999);
  const fDpiHigh = await readDeliver(win);
  log(`CASE F dpi after typing 9999: ${JSON.stringify(fDpiHigh)}`);
  await setDpi(win, 10);
  const gDpiLow = await readDeliver(win);
  log(`CASE G dpi after typing 10: ${JSON.stringify(gDpiLow)}`);

  await hardClose(app, 'tfl1201-export');
  writeLog();
  log('DONE');
}

const G = { app: null };
main().catch(async (e) => {
  log(`PROBE ERROR: ${e && e.stack ? e.stack : e}`);
  try { if (G.app) await hardClose(G.app, 'tfl1201-export-err'); } catch (_) {}
  writeLog();
  process.exitCode = 1;
});
