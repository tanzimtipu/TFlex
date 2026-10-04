// Phase 84 phase-validation e2e (qa) - true redaction (FEA-031).
//
// HARNESS: canonical launchApp (e2e/lib/launch.cjs); openSamplePath / hardClose
// (e2e/lib/helpers.cjs). Fixture built in-process with pdf-lib: one page whose
// text is SECRET-ALPHA followed by PUBLIC-BETA, so a known term can be redacted
// while a known sibling must survive.
//
// PHASE-GATE PROCEDURE: this spec drives the built renderer, so the gate MUST
// rebuild dist/ BEFORE the run or a stale bundle can pass:
//   npm.cmd run build
//   npm.cmd run test:e2e -- e2e/phase84_redaction.spec.cjs
//
// DEF-490 (HIGH, fixed in TFL-406): the `.redact-layer` overlay used to render
// BELOW the page (computed `position: static`; no CSS existed for any
// `.redact-*` class), so a real mouse drag over the page created 0 marks and
// the control bar overlapped the action dock. The fix added the Phase 84
// stylesheet block; the DEF-490 regression test below now proves the fix with
// a REAL mouse gesture. Earlier tests still drive the overlay handlers at
// exact page coordinates (syntheticDrag) to cover the remaining pipeline.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const {
  PDFDocument, PDFArray, PDFName, PDFStream, PDFRawStream, decodePDFRawStream,
  StandardFonts, rgb,
} = require('@cantoo/pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const { launchApp } = require('./lib/launch.cjs');
const { openSamplePath, hardClose, clickDockVerb } = require('./lib/helpers.cjs');

// Some harnesses (the Paperclip/kimi runtime) export ELECTRON_RUN_AS_NODE=1 for
// their own Node shim. launchApp spreads process.env into the Electron child, so
// that variable makes Electron exit immediately as plain Node ("Process failed
// to launch!"). Drop it before any launch so the real GUI starts.
delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const FONT_TTF = path.join(ROOT, 'assets', 'fonts', 'LiberationSans-Regular.ttf');
const USER_DATA = path.join(os.tmpdir(), `p84-userdata-${Date.now()}`);
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(USER_DATA, { recursive: true });

const TMP = path.join(os.tmpdir(), 'p84-redaction');
fs.mkdirSync(TMP, { recursive: true });
const FIXTURE = path.join(TMP, 'p84-secret-public.pdf');
const UNSUPPORTED = path.join(TMP, 'p84-type0.pdf');
const SAVED = path.join(TMP, 'p84-saved.pdf');

const log = (label, obj) => console.log(`[p84|${label}] ${JSON.stringify(obj)}`);

// A one-page controlled text fixture: SECRET-ALPHA (redact target, upper band)
// and PUBLIC-BETA (sibling that must survive, lower band), on the same page.
async function buildFixture() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText('SECRET-ALPHA', { x: 72, y: 700, size: 24, font, color: rgb(0, 0, 0) });
  page.drawText('PUBLIC-BETA', { x: 72, y: 640, size: 24, font, color: rgb(0, 0, 0) });
  fs.writeFileSync(FIXTURE, await doc.save());
}

// A page whose text is set in an EMBEDDED Type0/CID font: the engine's advance
// resolver returns null for /Type0, so a mark over this text must refuse with a
// typed `redaction-unsupported` error and apply nothing.
async function buildUnsupportedFixture() {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(fs.readFileSync(FONT_TTF), { subset: false });
  page.drawText('CONFIDENTIAL', { x: 72, y: 700, size: 24, font, color: rgb(0, 0, 0) });
  fs.writeFileSync(UNSUPPORTED, await doc.save());
}

let app = null;
let win = null;
let consoleLog = [];

test.beforeAll(async () => {
  await buildFixture();
  await buildUnsupportedFixture();
});

test.beforeEach(async () => {
  consoleLog = [];
  app = await launchApp([], USER_DATA);
  win = await app.firstWindow();
  win.on('console', (m) => consoleLog.push(`[console:${m.type()}] ${m.text()}`));
  win.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e.message}`));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p84');
  app = null;
  win = null;
});

test.setTimeout(600000);

async function diag() {
  return win.evaluate(() => window.tflexDiagnostics());
}

async function openFixture(filePath) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, filePath);
  const welcome = win.locator('[data-home-tool="open"]').first();
  if (await welcome.isVisible().catch(() => false)) {
    await welcome.click();
  } else {
    const cmd = win.locator('[aria-label="Open PDF document"]').first();
    if (await cmd.isVisible().catch(() => false)) await cmd.click();
    else await win.keyboard.press('Control+o');
  }
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

// Arm the Redact tool through the real global command surface. The registry
// marks `redact` surface 'panel' (toolsRegistry.ts SURFACE_BY_ID), so it is not
// a `[data-dock-verb]`; the command palette is its shipped home.
async function armRedact() {
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-command-palette-input]').fill('Redact');
  await win.waitForTimeout(350);
  await win.locator('.command-palette-row').filter({ hasText: 'Redact' }).first().click();
  await win.waitForSelector('[data-redact-layer]', { timeout: 8000 });
  await win.waitForTimeout(300);
}

// Drive the overlay's own pointer handlers at exact PAGE-space coordinates.
// Needed only because `.redact-layer` sits below the page (position: static);
// the handlers, pending-mark state and apply path are the real app code.
async function syntheticDrag(x0, y0, x1, y1) {
  await win.evaluate(({ x0, y0, x1, y1 }) => {
    const layer = document.querySelector('[data-redact-layer]');
    const page = document.querySelector('.pdf-page[data-page="1"]');
    const scale = page.getBoundingClientRect().width / 612;
    const lb = layer.getBoundingClientRect();
    const fire = (type, x, y) => layer.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true, buttons: 1,
      clientX: lb.left + x * scale, clientY: lb.top + y * scale,
    }));
    fire('pointerdown', x0, y0);
    fire('pointermove', (x0 + x1) / 2, (y0 + y1) / 2);
    fire('pointermove', x1, y1);
    fire('pointerup', x1, y1);
  }, { x0, y0, x1, y1 });
  await win.waitForTimeout(200);
}

async function markCount() {
  return win.locator('[data-redact-mark]').count();
}

async function clickApply() {
  await win.locator('[data-redact-apply]').click();
  await win.waitForTimeout(2000);
}

async function engineText(docId) {
  return win.evaluate(async (id) => {
    const r = await window.tflex.engine.exportText(id);
    if (!r.ok) return { error: r.error };
    return { pages: r.value };
  }, docId);
}

const allText = (pages) => (pages || []).map((p) => p.text).join('\n');

async function saveAs(savePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-save-as-confirm]');
  await win.waitForTimeout(2600);
}

// Decode every /Contents stream of every page of a saved PDF to latin1 text.
async function savedStreamText(filePath) {
  const bytes = fs.readFileSync(filePath);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  let out = '';
  for (let i = 0; i < doc.getPageCount(); i += 1) {
    const contents = doc.getPage(i).node.Contents();
    if (!contents) continue;
    const entries = contents instanceof PDFArray ? contents.asArray() : [contents];
    for (const entry of entries) {
      const obj = doc.context.lookup(entry);
      if (!(obj instanceof PDFStream)) continue;
      const raw = PDFRawStream.of(
        obj.dict,
        obj.getContents(),
        obj instanceof PDFRawStream ? obj.transform : undefined,
      );
      try { out += new TextDecoder('latin1').decode(decodePDFRawStream(raw).decode()); } catch (_) { /* skip */ }
    }
  }
  return out;
}

// Decode `<hex>` show-text literals to latin1 so the assertion reads glyph
// text regardless of whether the writer emitted literal or hex strings.
function decodeHexLiterals(s) {
  return s.replace(/<([0-9A-Fa-f\s]+)>/g, (m, h) => {
    const hex = h.replace(/\s+/g, '');
    if (hex.length % 2 !== 0) return m;
    let out = '';
    for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    return out;
  });
}

async function settingsRaw() {
  const dirs = [];
  try { dirs.push(await app.evaluate(({ app: a }) => a.getPath('userData'))); } catch (_) { /* ignore */ }
  dirs.push(USER_DATA);
  for (const dir of dirs) {
    const p = path.join(dir, 'settings.json');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  }
  return null;
}

// ---------------------------------------------------------------------------
// Criterion 3 / CONTROL-INDEX - every Phase 84 hook.
// ---------------------------------------------------------------------------
test('P84-CONTROL-INDEX: tool, mode, mark, swatch, clear/undo/apply, warning, unsupported', async () => {
  await openFixture(FIXTURE);
  await armRedact();

  // [data-redact-tool] + [data-redact-layer]
  const layer = win.locator('[data-redact-layer]').first();
  await expect(layer).toHaveAttribute('data-redact-tool', '');
  await expect(layer).toHaveAttribute('data-redact-mode', 'region');

  // Real-mouse drag over the page is the documented interaction; it must
  // yield a pending mark. Recorded here as the repro of the layer defect.
  const pageBox = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  await win.mouse.move(pageBox.x + 80, pageBox.y + 120);
  await win.mouse.down();
  await win.mouse.move(pageBox.x + 320, pageBox.y + 240, { steps: 6 });
  await win.mouse.up();
  await win.waitForTimeout(250);
  log('real-mouse-page-drag-marks', await markCount());

  // DEF-490 is fixed: the real drag above now yields one pending mark instead
  // of the pre-fix 0. Clear it so the synthetic region-drag assertion below
  // starts from a known empty set.
  expect(await markCount()).toBe(1);
  await win.locator('[data-redact-clear]').click();
  await expect(win.locator('[data-redact-mark]')).toHaveCount(0);

  // [data-redact-mode] flips region -> text -> region.
  await win.locator('[data-redact-mode][data-mode="text"]').click();
  await expect(layer).toHaveAttribute('data-redact-mode', 'text');
  await win.locator('[data-redact-mode][data-mode="region"]').click();
  await expect(layer).toHaveAttribute('data-redact-mode', 'region');

  // [data-redact-mark] region over SECRET-ALPHA (page rect 50,40 -> 300,120).
  await syntheticDrag(50, 40, 300, 120);
  await expect(win.locator('[data-redact-mark]')).toHaveCount(1);
  const fill0 = await win.locator('[data-redact-mark]').first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(fill0).toBe('rgb(0, 0, 0)');
  await win.screenshot({ path: path.join(SHOTS, 'p84-pending-mark.png') });

  // [data-redact-swatch] - non-black colour applies to the mark AND persists.
  await win.locator('[data-redact-swatch][data-color="#d21f3c"]').click();
  await win.waitForTimeout(600);
  const fillRed = await win.locator('[data-redact-mark]').first()
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(fillRed).toBe('rgb(210, 31, 60)');
  const raw = await settingsRaw();
  expect(raw, 'settings.json not found').not.toBeNull();
  expect(raw).toContain('#d21f3c');

  // [data-redact-clear] empties pending marks.
  await win.locator('[data-redact-clear]').click();
  await expect(win.locator('[data-redact-mark]')).toHaveCount(0);

  // [data-redact-undo] drops the last pending mark.
  await syntheticDrag(50, 40, 300, 120);
  await expect(win.locator('[data-redact-mark]')).toHaveCount(1);
  await win.locator('[data-redact-undo]').click();
  await expect(win.locator('[data-redact-mark]')).toHaveCount(0);

  // [data-redact-warning] - a blank-area mark is never a silent no-op.
  await syntheticDrag(350, 400, 500, 520);
  await clickApply();
  const warn = win.locator('[data-redact-warning]');
  await expect(warn).toBeVisible();
  const warnText = (await warn.innerText()).trim();
  log('blank-mark-warning', warnText);
  expect(warnText.length).toBeGreaterThan(0);

  // [data-redact-unsupported] - present, disabled, non-empty title.
  const unsupported = win.locator('[data-redact-unsupported]');
  await expect(unsupported).toBeVisible();
  await expect(unsupported).toBeDisabled();
  expect((await unsupported.getAttribute('title') || '').length).toBeGreaterThan(0);

  await win.screenshot({ path: path.join(SHOTS, 'p84-control-index.png') });
});

// ---------------------------------------------------------------------------
// Criterion 1 + 3 - the core proof: removal is real and survives save/reload.
// ---------------------------------------------------------------------------
test('P84-CORE: apply removes SECRET-ALPHA, PUBLIC-BETA survives, saved stream is rewritten', async () => {
  await openFixture(FIXTURE);
  const d = await diag();
  const before = allText((await engineText(d.engineDocId)).pages);
  expect(before).toContain('SECRET-ALPHA');
  expect(before).toContain('PUBLIC-BETA');

  await armRedact();
  await syntheticDrag(50, 40, 300, 120);
  await expect(win.locator('[data-redact-mark]')).toHaveCount(1);
  await clickApply();
  await expect(win.locator('[data-redact-mark]')).toHaveCount(0);

  const after = allText((await engineText(d.engineDocId)).pages);
  log('exportText-after-apply', after.replace(/\n/g, ' | '));
  expect(after).not.toContain('SECRET-ALPHA');
  expect(after).toContain('PUBLIC-BETA');
  await win.screenshot({ path: path.join(SHOTS, 'p84-applied-mark.png') });

  // Export-text surface screenshot (Deliver > Export text).
  await clickDockVerb(win, 4, 'exportText');
  await win.waitForSelector('[data-text-export-dialog]', { timeout: 15000 });
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SHOTS, 'p84-export-text.png') });
  await win.locator('[data-text-export-close], [data-text-export-cancel]').first().click().catch(() => {});
  await win.waitForTimeout(400);

  // Save the document and inspect the SAVED bytes directly (criterion 3).
  await saveAs(SAVED);
  expect(fs.existsSync(SAVED), 'save produced no file').toBe(true);
  const stream = await savedStreamText(SAVED);
  const decoded = decodeHexLiterals(stream);
  log('saved-stream-len', stream.length);
  expect(stream).not.toContain('SECRET-ALPHA');
  expect(decoded).not.toContain('SECRET-ALPHA');
  expect(decoded).toContain('PUBLIC-BETA');

  // Reopen the saved file: redaction survives save/reload.
  await openFixture(SAVED);
  const d2 = await diag();
  const reopened = allText((await engineText(d2.engineDocId)).pages);
  log('exportText-after-reload', reopened.replace(/\n/g, ' | '));
  expect(reopened).not.toContain('SECRET-ALPHA');
  expect(reopened).toContain('PUBLIC-BETA');
});

// ---------------------------------------------------------------------------
// Criterion 5 - app-level undo restores the pre-redaction text; re-apply
// removes it again.
// ---------------------------------------------------------------------------
test('P84-UNDO: Ctrl+Z restores SECRET-ALPHA, re-apply removes it again', async () => {
  await openFixture(FIXTURE);
  const d = await diag();
  await armRedact();

  await syntheticDrag(50, 40, 300, 120);
  await clickApply();
  const removed = allText((await engineText(d.engineDocId)).pages);
  expect(removed).not.toContain('SECRET-ALPHA');

  await win.keyboard.press('Control+z');
  await win.waitForTimeout(1800);
  const restored = allText((await engineText(d.engineDocId)).pages);
  log('exportText-after-undo', restored.replace(/\n/g, ' | '));
  expect(restored).toContain('SECRET-ALPHA');

  await syntheticDrag(50, 40, 300, 120);
  await clickApply();
  const removedAgain = allText((await engineText(d.engineDocId)).pages);
  expect(removedAgain).not.toContain('SECRET-ALPHA');
});

// ---------------------------------------------------------------------------
// Criterion 2 - the mark colour persists across an app restart.
// ---------------------------------------------------------------------------
test('P84-PERSIST: redactionColor survives a full restart', async () => {
  await openFixture(FIXTURE);
  await armRedact();
  await win.locator('[data-redact-swatch][data-color="#1f6feb"]').click();
  await win.waitForTimeout(700);
  await expect(win.locator('[data-redact-swatch][data-color="#1f6feb"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await settingsRaw()).toContain('#1f6feb');

  await hardClose(app, 'p84-relaunch');
  app = await launchApp([], USER_DATA);
  win = await app.firstWindow();
  win.on('console', (m) => consoleLog.push(`[console:${m.type()}] ${m.text()}`));
  win.on('pageerror', (e) => consoleLog.push(`[pageerror] ${e.message}`));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openFixture(FIXTURE);
  await armRedact();

  const pressed = await win.locator('[data-redact-swatch][data-color="#1f6feb"]').getAttribute('aria-pressed');
  const raw = await settingsRaw();
  log('restart-swatch', { pressed, hasColor: raw ? raw.includes('#1f6feb') : false });
  await expect(win.locator('[data-redact-swatch][data-color="#1f6feb"]')).toHaveAttribute('aria-pressed', 'true');
  expect(raw).toContain('#1f6feb');
});

// ---------------------------------------------------------------------------
// Criterion 4 - unsupported page refuses loudly and applies nothing.
// ---------------------------------------------------------------------------
test('P84-UNSUPPORTED: Type0 page refuses with redaction-unsupported and mutates nothing', async () => {
  await openFixture(UNSUPPORTED);
  const d = await diag();
  const before = allText((await engineText(d.engineDocId)).pages);
  expect(before).toContain('CONFIDENTIAL');

  await armRedact();
  await syntheticDrag(50, 40, 300, 120);
  await expect(win.locator('[data-redact-mark]')).toHaveCount(1);
  await clickApply();

  const warn = win.locator('[data-redact-warning]');
  await expect(warn).toBeVisible();
  const warnText = (await warn.innerText()).trim();
  log('unsupported-warning', warnText);
  expect(warnText.length).toBeGreaterThan(0);

  const typed = await win.evaluate(async (id) => {
    const r = await window.tflex.engine.applyRedactions(id, {
      page: 1, marks: [{ rect: { x: 50, y: 40, width: 250, height: 80 } }], color: '#000000',
    });
    return r.ok ? { ok: true } : { code: r.error.code, message: r.error.message };
  }, d.engineDocId);
  log('unsupported-engine-code', typed);
  expect(typed.code).toBe('redaction-unsupported');

  const after = allText((await engineText(d.engineDocId)).pages);
  expect(after).toContain('CONFIDENTIAL');
});

// ---------------------------------------------------------------------------
// Criterion 6 - blast radius: Phase-10 erase and save/export still work.
// ---------------------------------------------------------------------------
test('P84-REGRESSION: Phase-10 erase still runs and save/export stays loadable', async () => {
  await openFixture(FIXTURE);
  const d = await diag();

  const erase = await win.evaluate(async (id) => {
    const r = await window.tflex.engine.editTextRun(id, {
      page: 1, rect: { x: 60, y: 55, width: 250, height: 70 }, newText: '',
    });
    return r.ok ? { ok: true } : { error: r.error };
  }, d.engineDocId);
  log('phase10-erase', erase);
  expect(erase.ok).toBe(true);

  const afterErase = allText((await engineText(d.engineDocId)).pages);
  expect(afterErase.length).toBeGreaterThan(0);
  expect(afterErase).toContain('SECRET-ALPHA');

  await saveAs(SAVED);
  expect(fs.existsSync(SAVED)).toBe(true);
  await openFixture(SAVED);
  const d2 = await diag();
  const r = await engineText(d2.engineDocId);
  expect(r.error).toBeUndefined();
  expect(allText(r.pages).length).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// DEF-490 (HIGH) hard regression - the pre-fix layer computed `position:static`
// at the page bottom, so a REAL mouse region drag logged
// `[p84|real-mouse-page-drag-marks] 0` and the control bar sat at the window
// bottom over the action dock. This test uses `page.mouse` (never dispatchEvent)
// and asserts exactly one pending mark plus the raw layer/page/control geometry.
// ---------------------------------------------------------------------------
test('P84-DEF490-REAL-MOUSE: real drag creates one mark; layer covers page; controls inside page', async () => {
  await openFixture(FIXTURE);
  await armRedact();

  const layer = win.locator('[data-redact-layer]').first();
  const page = win.locator('.pdf-page[data-page="1"]').first();
  const pageBox = await page.boundingBox();
  const layerBox = await layer.boundingBox();
  const position = await layer.evaluate((el) => getComputedStyle(el).position);
  const barBox = await win.locator('.redact-actions').boundingBox();
  const applyBox = await win.locator('[data-redact-apply]').boundingBox();
  const swatchBox = await win.locator('[data-redact-swatch]').first().boundingBox();
  const viewport = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  log('def490-geometry', { position, layerBox, pageBox, barBox, applyBox, swatchBox, viewport });

  // Non-static computed position, and the layer box overlays the FULL page area
  // (not the page bottom / not in normal flow below the page).
  expect(position).not.toBe('static');
  expect(Math.abs(layerBox.x - pageBox.x)).toBeLessThan(2);
  expect(Math.abs(layerBox.y - pageBox.y)).toBeLessThan(2);
  expect(Math.abs(layerBox.width - pageBox.width)).toBeLessThan(3);
  expect(Math.abs(layerBox.height - pageBox.height)).toBeLessThan(3);
  expect(layerBox.y).toBeLessThan(pageBox.y + pageBox.height - 5);

  // A REAL mouse drag over the known term (SECRET-ALPHA, upper band). If the
  // floating action bar covers the term's top edge, start just below it so the
  // pointerdown reaches the layer rather than a control button.
  const scale = pageBox.width / 612;
  let sx = pageBox.x + 80 * scale;
  let sy = pageBox.y + 60 * scale;
  const startOnBar = barBox !== null
    && sx > barBox.x && sx < barBox.x + barBox.width
    && sy > barBox.y && sy < barBox.y + barBox.height;
  if (startOnBar) sy = barBox.y + barBox.height + 10;
  const ex = Math.min(pageBox.x + 300 * scale, pageBox.x + pageBox.width - 4);
  const ey = Math.min(sy + 90 * scale, pageBox.y + pageBox.height - 4);
  log('def490-drag', { startOnBar, sx, sy, ex, ey });

  await win.mouse.move(sx, sy);
  await win.mouse.down();
  await win.mouse.move(ex, ey, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(300);

  // The pre-fix tree logged 0 here; exactly one mark must now exist.
  const marks = await markCount();
  log('real-mouse-page-drag-marks', marks);
  expect(marks, 'real mouse drag must create exactly one pending mark').toBe(1);
  await expect(win.locator('[data-redact-mark]')).toHaveCount(1);

  // The control row sits INSIDE the page rectangle, not at the window bottom.
  expect(barBox).not.toBeNull();
  expect(barBox.x).toBeGreaterThanOrEqual(pageBox.x - 1);
  expect(barBox.x + barBox.width).toBeLessThanOrEqual(pageBox.x + pageBox.width + 1);
  expect(barBox.y).toBeGreaterThanOrEqual(pageBox.y - 1);
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(pageBox.y + pageBox.height + 1);
  for (const box of [applyBox, swatchBox]) {
    expect(box).not.toBeNull();
    expect(box.y).toBeGreaterThanOrEqual(pageBox.y - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(pageBox.y + pageBox.height + 1);
  }
  expect(barBox.y + barBox.height).toBeLessThan(viewport.h - 20);

  await win.screenshot({ path: path.join(SHOTS, 'p84-def490-fixed-mark.png') });
});


