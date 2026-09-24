// DEF-258 retest (Phase 27) — the Edit-mode text-run commit through the
// Phase-26 panel Text field must forward the panel's FULL style, not just
// font/size/color. The original defect: `handleEditTextRun` built the payload
// from an explicit field list and silently dropped charSpacing (and every
// other Phase-21 style field), so a 6 pt tracking previewed live but the
// saved page content stream carried no `Tc`.
//
// This retest drives the REAL panel path (select a text-layer run, set the
// style, edit the text, blur to commit) and proves:
//   1. the wire payload the host sends to `engine.editTextRun` carries
//      charSpacing 6 + bold + align right (captured at the main-process IPC
//      handler, so it is the exact payload, not a DOM inference);
//   2. the saved page content stream bakes `6 Tc` inside a text object and
//      embeds a bold font program;
//   3. a DEFAULT-style run still sends the legacy minimal payload (no style
//      keys) and bakes NO `Tc` (the byte-compatible single-draw path).
//
// Canonical launcher only.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { inflateSync } = require('node:zlib');
const { PDFDocument, PDFRawStream } = require('pdf-lib');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose, openSamplePath, toggleEditMode } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const log = (label, obj) => console.log(`[DEF258] ${label} ${JSON.stringify(obj)}`);

async function openReport(app, win) {
  const p = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(500);
}

async function saveAs(app, win, savePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-confirm]', { timeout: 8000 });
  await win.click('[data-save-as-confirm]');
  await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 30000 });
  expect(fs.existsSync(savePath), 'saved PDF must exist on disk').toBe(true);
}

// Record every `engine:editTextRun` payload at the main-process IPC handler.
async function installPayloadRecorder(app) {
  await app.evaluate(({ ipcMain }) => {
    const map = ipcMain._invokeHandlers;
    if (!map || typeof map.get !== 'function' || typeof map.set !== 'function') {
      globalThis.__def258Recorder = { ok: false, reason: 'no _invokeHandlers' };
      return;
    }
    const orig = map.get('engine:editTextRun');
    if (typeof orig !== 'function') {
      globalThis.__def258Recorder = { ok: false, reason: 'no handler' };
      return;
    }
    globalThis.__def258Payloads = [];
    map.set('engine:editTextRun', async (event, ...args) => {
      try { globalThis.__def258Payloads.push(args[1]); } catch (_) { /* ignore */ }
      return orig(event, ...args);
    });
    globalThis.__def258Recorder = { ok: true };
  });
}

async function readPayloads(app) {
  return app.evaluate(() => ({
    recorder: globalThis.__def258Recorder || null,
    payloads: globalThis.__def258Payloads || [],
  }));
}

// Select the first real text-layer run through the Edit-mode text tool.
async function selectRun(win) {
  await toggleEditMode(win);
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
  await win.click('[data-edit-tool="text"]');
  await win.waitForTimeout(300);
  const span = win.locator('.pdf-page[data-page="1"] .textLayer span').filter({ hasText: /[A-Za-z]/ }).first();
  await span.waitFor({ state: 'attached', timeout: 10000 });
  const sb = await span.boundingBox();
  expect(sb, 'a text-layer span is laid out').toBeTruthy();
  await win.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await win.waitForTimeout(600);
  const st = await win.evaluate(() => {
    const ta = document.querySelector('[data-txt-text]');
    return { value: ta ? ta.value : null, mode: document.querySelector('[data-text-panel]')?.getAttribute('data-text-panel-mode') ?? null };
  });
  log('selected-run', st);
  expect(st.value, 'a text run was selected through the text tool').toBeTruthy();
  return st.value;
}

async function commitRunEdit(win, newText) {
  await win.waitForSelector('.text-props-panel [data-txt-text]', { timeout: 15000 });
  await win.waitForFunction(() => {
    const ta = document.querySelector('[data-txt-text]');
    return ta !== null && ta.disabled === false;
  }, null, { timeout: 15000 });
  await win.locator('[data-txt-text]').fill(newText);
  await win.waitForSelector('[data-edit-run-preview]', { timeout: 8000 });
  await win.waitForTimeout(300);
  const preview = await win.evaluate(() => {
    const el = document.querySelector('[data-edit-run-preview]');
    return el ? getComputedStyle(el).letterSpacing : null;
  });
  await win.locator('[data-txt-text]').blur();
  await win.waitForTimeout(2500);
  return preview;
}

async function decodedStreams(filePath) {
  const bytes = fs.readFileSync(filePath);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const out = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      const raw = obj.contents;
      let txt = '';
      try { txt = new TextDecoder('latin1').decode(inflateSync(raw)); }
      catch { try { txt = new TextDecoder('latin1').decode(raw); } catch { txt = ''; } }
      out.push(txt);
    }
  }
  return out;
}

function tcStreams(streams, value) {
  const re = new RegExp('(?:^|\\s)' + String(value).replace('.', '\\.') + ' Tc(?:\\s|$)');
  return streams.filter((s) => re.test(s) && /BT/.test(s) && /Tj/.test(s)).length;
}

function countTc(streams) {
  let n = 0;
  for (const s of streams) {
    const m = s.match(/(?:^|\s)-?[\d.]+ Tc(?:\s|$)/g);
    if (m) n += m.length;
  }
  return n;
}

async function fontEvidence(filePath) {
  const doc = await PDFDocument.load(fs.readFileSync(filePath), { ignoreEncryption: true, updateMetadata: false });
  let fontFile2 = 0;
  const baseFonts = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const s = obj.toString();
    if (s.includes('FontFile2')) fontFile2 += 1;
    const m = /\/BaseFont\s*\/([^\s/]+)/.exec(s);
    if (m) baseFonts.push(m[1]);
  }
  return { fontFile2, baseFonts };
}

// ===========================================================================
// 1. Non-default style: char spacing 6 + bold + align right through the panel.
// ===========================================================================
test('DEF-258 retest: panel run commit forwards charSpacing + bold + align and bakes Tc', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await installPayloadRecorder(app);

    const runText = await selectRun(win);

    // Set the non-default style BEFORE the text edit (the panel's pending
    // style feeds the run commit).
    await win.locator('[data-txt-character-spacing]').fill('6');
    await win.waitForTimeout(150);
    await win.click('[data-txt-bold]');
    await win.waitForTimeout(150);
    await win.click('[data-txt-align-right]');
    await win.waitForTimeout(150);

    const preview = await commitRunEdit(win, runText + ' X');
    log('preview-letter-spacing', preview);
    expect(parseFloat(preview), 'run preview carries the panel char spacing').toBeGreaterThan(0);

    const rec = await readPayloads(app);
    log('recorder', rec.recorder);
    expect(rec.recorder && rec.recorder.ok, 'IPC payload recorder installed').toBe(true);
    const payload = rec.payloads.find((p) => p && typeof p.newText === 'string' && p.newText.endsWith(' X'));
    log('payload', payload);
    expect(payload, 'the run commit reached engine.editTextRun').toBeTruthy();
    expect(payload.charSpacing, 'payload carries charSpacing 6').toBe(6);
    expect(payload.bold, 'payload carries bold').toBe(true);
    expect(payload.align, 'payload carries align right').toBe('right');

    const p = path.join(os.tmpdir(), `def258-nondefault-${Date.now()}.pdf`);
    await saveAs(app, win, p);
    const streams = await decodedStreams(p);
    const tc = tcStreams(streams, 6);
    log('saved-tc', { tc, streamCount: streams.length });
    expect(tc, 'saved page content stream bakes `6 Tc` inside a text object').toBeGreaterThan(0);

    const ev = await fontEvidence(p);
    log('font-evidence', ev);
    expect(ev.baseFonts.some((n) => /Bold/i.test(n)), 'a bold font program is embedded').toBe(true);

    await win.screenshot({ path: path.join(SHOTS, 'def258-retest-nondefault.png') }).catch(() => {});

    // Reopen the saved file: it loads and the edited run text is present.
    await win.locator('.tab-active .tab-close').click();
    await win.waitForTimeout(1500);
    await openSamplePath(win, app, p);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(2000);
    const reopened = await win.evaluate(() => {
      const layer = document.querySelector('.pdf-page[data-page="1"] .textLayer');
      return { text: layer ? layer.textContent.replace(/\s+/g, ' ').trim() : null };
    });
    log('reopened-text', reopened);
    expect(reopened.text, 'the edited run text survives save + reopen').toContain('X');
    // The reopened file still carries the baked Tc.
    const streams2 = await decodedStreams(p);
    expect(tcStreams(streams2, 6), 'reopened file still bakes `6 Tc`').toBeGreaterThan(0);
  } finally {
    await hardClose(app, 'def258-nondefault');
  }
});

// ===========================================================================
// 2. Default style: the legacy minimal payload and no `Tc` in the stream.
// ===========================================================================
test('DEF-258 retest: a default-style run keeps the legacy minimal payload and bakes no Tc', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await installPayloadRecorder(app);

    const runText = await selectRun(win);
    const preview = await commitRunEdit(win, runText + ' Y');
    log('preview-letter-spacing', preview);
    expect(preview === 'normal' || parseFloat(preview) === 0, 'default run preview has no tracking').toBe(true);

    const rec = await readPayloads(app);
    expect(rec.recorder && rec.recorder.ok, 'IPC payload recorder installed').toBe(true);
    const payload = rec.payloads.find((p) => p && typeof p.newText === 'string' && p.newText.endsWith(' Y'));
    log('payload', payload);
    expect(payload, 'the default run commit reached engine.editTextRun').toBeTruthy();
    expect(Object.keys(payload).sort(), 'legacy minimal payload: no style keys').toEqual(
      ['color', 'font', 'newText', 'page', 'rect', 'size'].sort(),
    );

    const p = path.join(os.tmpdir(), `def258-default-${Date.now()}.pdf`);
    await saveAs(app, win, p);
    const streams = await decodedStreams(p);
    const tc = countTc(streams);
    log('saved-tc-count', { tc, streamCount: streams.length });
    expect(tc, 'a default-style run bakes no `Tc` operator').toBe(0);
  } finally {
    await hardClose(app, 'def258-default');
  }
});