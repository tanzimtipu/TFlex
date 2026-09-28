// PHASE 27 VALIDATION (qa, 2026-09-21) - engine character spacing (Tc) plus
// the three bundled OFL font families.
//
// Covers, through the real app:
//   C1a  a text box: the panel's now-LIVE char-spacing control -> engine value,
//        the page mirror visibly loosens, Save As -> reopen, and the baked
//        page content stream carries the `Tc` operator at the value.
//   C1b  an annotation text box: same, with the value baked into the /AP
//        appearance stream.
//   C1c  an Edit-mode text run: the same shared renderer via editTextRun emits
//        `Tc` into the page content stream.
//   C2   the family dropdown offers six families; DejaVu Serif and Liberation
//        Sans render (computed family) and survive save+reopen with a real
//        embedded `/FontFile2` program for each bundled family.
//   C4   family + bold + size + align + line spacing + char spacing + indent
//        compose on one box and survive save+reopen together.
//   C3   an unknown family id fails loud with a typed engine-error naming the
//        font on addTextBox / updateTextBox / editAnnotation, mutating nothing.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { inflateSync } = require('node:zlib');
const { PDFDocument, PDFRawStream } = require('@cantoo/pdf-lib');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, armAnnotationTool, openSamplePath, toggleEditMode } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const log = (label, obj) => console.log(`[P27] ${label} ${JSON.stringify(obj)}`);

const SIX_FAMILIES = ['Helvetica', 'Times', 'Courier', 'Liberation Sans', 'DejaVu Serif', 'DejaVu Sans Mono'];

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

async function closeAndReopen(app, win, savePath) {
  await win.locator('.tab-active .tab-close').click();
  await win.waitForTimeout(1500);
  await openSamplePath(win, app, savePath);
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(2000);
}

async function boxModels(win) {
  return win.evaluate(() => {
    const st = window.tflexDiagnostics().engineState;
    if (!st || !st.textBoxes) return null;
    return st.textBoxes.map((b) => ({
      id: b.id, text: b.text, page: b.page, font: b.font, size: b.size,
      bold: b.bold, italic: b.italic, underline: b.underline, color: b.color,
      highlight: b.highlight ?? null, align: b.align, lineHeight: b.lineHeight,
      list: b.list, indent: b.indent, charSpacing: b.charSpacing,
    }));
  });
}

async function waitForBox(win, text, pred, timeout = 15000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    const boxes = (await boxModels(win)) || [];
    const b = boxes.find((x) => x.text === text);
    last = b;
    if (b && (pred ? pred(b) : true)) return b;
    await win.waitForTimeout(150);
  }
  return last;
}

async function annModels(win) {
  return win.evaluate(() => {
    const st = window.tflexDiagnostics().engineState;
    if (!st || !st.annotations) return null;
    return st.annotations.map((a) => ({
      id: a.id, kind: a.kind, page: a.page, text: a.text ?? a.content ?? null,
      style: a.style ?? null,
    }));
  });
}

async function waitForAnn(win, text, pred, timeout = 15000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    const anns = (await annModels(win)) || [];
    const a = anns.find((x) => x.text === text);
    last = a;
    if (a && (pred ? pred(a) : true)) return a;
    await win.waitForTimeout(150);
  }
  return last;
}

async function panelState(win) {
  return win.evaluate(() => {
    const p = document.querySelector('.text-props-panel');
    if (!p) return null;
    const q = (s) => p.querySelector(s);
    const pressed = (s) => q(s)?.getAttribute('aria-pressed') === 'true';
    return {
      mode: document.querySelector('[data-text-panel]')?.getAttribute('data-text-panel-mode') ?? null,
      font: q('[data-txt-font]')?.value ?? null,
      size: q('[data-txt-size]')?.value ?? null,
      charSpacing: q('[data-txt-character-spacing]')?.value ?? null,
      charSpacingDisabled: q('[data-txt-character-spacing]')?.disabled ?? null,
      bold: pressed('[data-txt-bold]'),
      align: ['left', 'center', 'right', 'justify'].filter((a) => pressed(`[data-txt-align-${a}`)),
      lineHeight: q('[data-txt-line-height]')?.value ?? null,
      indent: q('[data-txt-indent-value]')?.textContent ?? null,
      familyOptions: Array.from(q('[data-txt-font]')?.options ?? []).map((o) => o.value),
    };
  });
}

async function waitForPanel(win, pred, timeout = 12000) {
  const t0 = Date.now();
  let s = null;
  while (Date.now() - t0 < timeout) {
    s = await panelState(win);
    if (s && pred(s)) return s;
    await win.waitForTimeout(150);
  }
  return s;
}

async function fillPanelText(win, text) {
  await win.waitForSelector('.text-props-panel [data-txt-text]', { timeout: 15000 });
  await win.waitForFunction(() => {
    const ta = document.querySelector('[data-txt-text]');
    return ta !== null && ta.disabled === false;
  }, null, { timeout: 15000 });
  await win.locator('[data-txt-text]').fill(text);
  await win.locator('[data-txt-text]').blur();
}

// Place a committed TFlex Edit-mode text box through the real UI and select it.
async function createTextBox(win, text, fx = 0.62, fy = 0.2) {
  if ((await win.locator('[data-dock-verb="editTextBox"]').count()) === 0) {
    await toggleEditMode(win);
    await win.locator('[data-dock-verb="editTextBox"]').waitFor({ state: 'visible', timeout: 8000 });
  }
  await win.locator('[data-dock-verb="editTextBox"]').click();
  await win.waitForTimeout(600);
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 240));
  const y = Math.max(pg.y + 20, Math.min(pg.y + pg.height * fy, vp.h - 110));
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + 200, y + 70, { steps: 6 });
  await win.mouse.up();
  await fillPanelText(win, text);
  await win.waitForSelector('.edit-box', { timeout: 8000 });
  await win.waitForTimeout(400);
  await win.locator(`.edit-box[data-edit-box-text="${text}"]`).click({ position: { x: 8, y: 8 } });
  await win.waitForSelector('[data-edit-box-toolbar]', { timeout: 8000 });
  await win.waitForTimeout(300);
}

async function selectBox(win, text) {
  await win.locator(`.edit-box[data-edit-box-text="${text}"]`).click({ position: { x: 8, y: 8 } });
  await win.waitForSelector('[data-edit-box-toolbar]', { timeout: 8000 });
  await win.waitForTimeout(300);
}

/** Close Edit mode (annotation tools are gated while it is open). */
async function closeEditMode(win) {
  if ((await win.locator('[data-dock-verb="editTextBox"]').count()) > 0) {
    await toggleEditMode(win);
    await win.waitForTimeout(400);
  }
}

// Place an annotation text box through the real UI and leave it selected.
async function placeTextbox(win, text, fx = 0.3, fy = 0.25) {
  await armAnnotationTool(win, 'textbox');
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 240));
  const y = Math.max(pg.y + 20, Math.min(pg.y + pg.height * fy, vp.h - 110));
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + 190, y + 60, { steps: 6 });
  await win.mouse.up();
  await fillPanelText(win, text);
  await win.waitForSelector('.ann-textbox[data-kind="textbox"]', { timeout: 8000 });
  await waitForAnn(win, text, null, 12000);
  await win.waitForSelector('.text-props-panel', { timeout: 8000 });
  await win.waitForTimeout(300);
}

/** The on-page mirror's computed letter-spacing for the first edit box. */
async function mirrorLetterSpacing(win, text) {
  return win.evaluate((t) => {
    const box = document.querySelector(`.edit-box[data-edit-box-text="${t}"]`);
    const span = box ? box.querySelector('.edit-box-text') : null;
    return span ? getComputedStyle(span).letterSpacing : null;
  }, text);
}

/** The on-page mirror's computed font-family for an edit box. */
async function mirrorFontFamily(win, text) {
  return win.evaluate((t) => {
    const box = document.querySelector(`.edit-box[data-edit-box-text="${t}"]`);
    const span = box ? box.querySelector('.edit-box-text') : null;
    return span ? getComputedStyle(span).fontFamily : null;
  }, text);
}

/** Inflate every indirect stream of a saved PDF and return their texts. */
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

/** Number of decoded streams carrying `<value> Tc` inside a text object. */
function tcStreams(streams, value) {
  const re = new RegExp('(?:^|\\s)' + String(value).replace('.', '\\.') + ' Tc(?:\\s|$)');
  return streams.filter((s) => re.test(s) && /BT/.test(s) && /Tj/.test(s)).length;
}

/** Embedded-font evidence across every indirect object of a saved PDF. */
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
// C1a - text box character spacing: live value, visible loosening, save/reopen
// round-trip, and the baked `Tc` operator in the page content stream.
// ===========================================================================
test('C1a text box char spacing is live, visibly loosens and bakes Tc', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await createTextBox(win, 'P27-SPACE', 0.62, 0.2);

    const before = await mirrorLetterSpacing(win, 'P27-SPACE');
    await win.locator('[data-txt-character-spacing]').fill('6');
    const box = await waitForBox(win, 'P27-SPACE', (b) => b.charSpacing === 6);
    expect(box && box.charSpacing, 'engine text box charSpacing').toBe(6);
    const ps = await waitForPanel(win, (s) => s.charSpacing === '6');
    expect(ps && ps.charSpacing, 'panel reflects 6').toBe('6');
    expect(ps && ps.charSpacingDisabled, 'char-spacing control is ENABLED').toBe(false);
    const after = await mirrorLetterSpacing(win, 'P27-SPACE');
    log('C1a-spacing', { before, after, engine: box.charSpacing });
    expect(before, 'default mirror has no tracking').toBe('normal');
    expect(after, 'page mirror loosens from the default').not.toBe(before);
    expect(parseFloat(after), 'page mirror applies a positive letter-spacing (points x page scale)').toBeGreaterThan(0);
    await win.screenshot({ path: path.join(SHOTS, 'phase27-c1a-spacing-6.png') }).catch(() => {});

    const p = path.join(os.tmpdir(), `p27-c1a-${Date.now()}.pdf`);
    await saveAs(app, win, p);
    const streams = await decodedStreams(p);
    const tc = tcStreams(streams, 6);
    log('C1a-tc', { tc, streamCount: streams.length });
    expect(tc, 'saved page content stream carries `6 Tc` inside a text object').toBeGreaterThan(0);

    await closeAndReopen(app, win, p);
    const rt = await waitForBox(win, 'P27-SPACE', (b) => b.charSpacing === 6, 20000);
    log('C1a-reopen', rt && { font: rt.font, charSpacing: rt.charSpacing });
    expect(rt && rt.charSpacing, 'charSpacing survives save+reopen').toBe(6);
  } finally {
    await hardClose(app, 'p27-c1a');
  }
});

// ===========================================================================
// C1b - annotation text box character spacing: style value, save/reopen, and
// the baked `Tc` in the FreeText /AP appearance stream.
// ===========================================================================
test('C1b annotation textbox char spacing bakes Tc into the appearance stream', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await placeTextbox(win, 'P27-ANN', 0.3, 0.25);
    expect(await win.getAttribute('[data-text-panel]', 'data-text-panel-mode')).toBe('annotation');

    const cs = await win.evaluate(() => {
      const el = document.querySelector('.text-props-panel [data-txt-character-spacing]');
      return el ? el.disabled : 'MISSING';
    });
    expect(cs, 'annotation char-spacing control is ENABLED').toBe(false);

    await win.locator('[data-txt-character-spacing]').fill('6');
    const ann = await waitForAnn(win, 'P27-ANN', (a) => a.style && a.style.charSpacing === 6);
    expect(ann && ann.style && ann.style.charSpacing, 'engine annotation style charSpacing').toBe(6);
    await win.screenshot({ path: path.join(SHOTS, 'phase27-c1b-ann-spacing.png') }).catch(() => {});

    const p = path.join(os.tmpdir(), `p27-c1b-${Date.now()}.pdf`);
    await saveAs(app, win, p);
    const streams = await decodedStreams(p);
    const tc = tcStreams(streams, 6);
    log('C1b-tc', { tc, streamCount: streams.length });
    expect(tc, 'saved /AP appearance stream carries `6 Tc`').toBeGreaterThan(0);

    await closeAndReopen(app, win, p);
    const rt = await waitForAnn(win, 'P27-ANN', (a) => a.style && a.style.charSpacing === 6, 20000);
    log('C1b-reopen', rt && rt.style);
    expect(rt && rt.style && rt.style.charSpacing, 'annotation charSpacing survives save+reopen').toBe(6);
  } finally {
    await hardClose(app, 'p27-c1b');
  }
});

// ===========================================================================
// C1c - Edit-mode text run: the same shared renderer via `editTextRun` emits
// `Tc` into the page content stream at the supplied value.
// ===========================================================================
test('C1c edit-mode text run bakes Tc through editTextRun', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    const docId = (await win.evaluate(() => window.tflexDiagnostics())).engineDocId;
    expect(docId, 'engine doc id present').toBeTruthy();

    const r = await win.evaluate(async (id) => {
      const res = await window.tflex.engine.editTextRun(id, {
        page: 1,
        rect: { x: 72, y: 80, width: 260, height: 16 },
        newText: 'P27 SPACED RUN',
        font: 'Helvetica',
        size: 12,
        charSpacing: 6,
      });
      return res && res.ok ? { ok: true } : { ok: false, code: res && res.error ? res.error.code : null, message: res && res.error ? res.error.message : String(res) };
    }, docId);
    log('C1c-edit', r);
    expect(r.ok, 'editTextRun with charSpacing succeeds').toBe(true);

    const p = path.join(os.tmpdir(), `p27-c1c-${Date.now()}.pdf`);
    await saveAs(app, win, p);
    const streams = await decodedStreams(p);
    const tc = tcStreams(streams, 6);
    log('C1c-tc', { tc });
    expect(tc, 'edited run bakes `6 Tc` into the page content stream').toBeGreaterThan(0);
  } finally {
    await hardClose(app, 'p27-c1c');
  }
});

// ===========================================================================
// C1d - Edit-mode text run through the PANEL: select a run, set the char
// spacing, edit its text (the Phase-26 session commit), and the baked page
// stream carries the spacing.
// ===========================================================================
test('C1d Edit-mode text run: panel char spacing drives the run commit', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await toggleEditMode(win);
    await win.locator('[data-dock-verb="editText"]').waitFor({ state: 'visible', timeout: 8000 });
    await win.locator('[data-dock-verb="editText"]').click();
    await win.waitForTimeout(300);

    // Click a real text-layer run (the reliable hit target).
    const span = win.locator('.pdf-page[data-page="1"] .textLayer span').filter({ hasText: /[A-Za-z]/ }).first();
    await span.waitFor({ state: 'attached', timeout: 10000 });
    const sb = await span.boundingBox();
    expect(sb, 'a text-layer span is laid out').toBeTruthy();
    await win.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await win.waitForTimeout(600);
    const st0 = await win.evaluate(() => {
      const ta = document.querySelector('[data-txt-text]');
      const body = document.querySelector('[data-text-panel]');
      return { value: ta ? ta.value : null, disabled: ta ? ta.disabled : null, mode: body ? body.getAttribute('data-text-panel-mode') : null };
    });
    log('C1d-run', st0);
    const runText = st0.value;
    expect(runText, 'a text run was selected through the text tool').toBeTruthy();

    // Set the spacing first (it feeds the pending run style), then type: the
    // Phase-26 session renders the live run preview with that style.
    await win.locator('[data-txt-character-spacing]').fill('6');
    await win.waitForTimeout(200);
    await win.locator('[data-txt-text]').fill(runText + ' X');
    await win.waitForSelector('[data-edit-run-preview]', { timeout: 8000 });
    await win.waitForTimeout(300);
    const preview = await win.evaluate(() => {
      const el = document.querySelector('[data-edit-run-preview]');
      return el ? getComputedStyle(el).letterSpacing : null;
    });
    log('C1d-preview', preview);
    expect(parseFloat(preview), 'run preview carries the panel char spacing (points x page scale)').toBeGreaterThan(0);

    // Commit the run: the Phase-26 session commits on the text edit.
    await win.locator('[data-txt-text]').blur();
    await win.waitForTimeout(2500);

    const p = path.join(os.tmpdir(), `p27-c1d-${Date.now()}.pdf`);
    await saveAs(app, win, p);
    const streams = await decodedStreams(p);
    const tc = tcStreams(streams, 6);
    log('C1d-tc', { tc });
    expect(tc, 'the committed run bakes `6 Tc` into the page content stream').toBeGreaterThan(0);
  } finally {
    await hardClose(app, 'p27-c1d');
  }
});

// ===========================================================================
// C2a - the family dropdown offers six families; DejaVu Serif renders
// (computed family), embeds a real `/FontFile2` program and survives reopen.
// ===========================================================================
test('C2a DejaVu Serif renders, embeds a FontFile2 and survives reopen', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await createTextBox(win, 'P27-FONT-A', 0.62, 0.2);

    const ps0 = await waitForPanel(win, (s) => s.familyOptions.length > 0);
    log('C2a-families', ps0 && ps0.familyOptions);
    expect(ps0 && ps0.familyOptions, 'dropdown offers exactly the six families').toEqual(SIX_FAMILIES);

    await win.locator('[data-txt-font]').selectOption('DejaVu Serif');
    const a = await waitForBox(win, 'P27-FONT-A', (b) => b.font === 'DejaVu Serif');
    expect(a && a.font, 'box engine font').toBe('DejaVu Serif');
    const fam = await mirrorFontFamily(win, 'P27-FONT-A');
    log('C2a-fam', fam);
    expect(fam, 'page mirror names DejaVu Serif').toContain('DejaVu Serif');
    await win.screenshot({ path: path.join(SHOTS, 'phase27-c2a-dejavu-serif.png') }).catch(() => {});

    const p = path.join(os.tmpdir(), `p27-c2a-${Date.now()}.pdf`);
    await saveAs(app, win, p);
    const ev = await fontEvidence(p);
    log('C2a-embed', ev);
    expect(ev.fontFile2, 'saved PDF carries an embedded TrueType program').toBeGreaterThanOrEqual(1);
    expect(ev.baseFonts.some((n) => n.startsWith('TFlexDejaVuSerif')), 'DejaVu Serif subset embedded').toBe(true);

    await closeAndReopen(app, win, p);
    const a2 = await waitForBox(win, 'P27-FONT-A', (x) => x.font === 'DejaVu Serif', 20000);
    log('C2a-reopen', a2 && a2.font);
    expect(a2 && a2.font, 'DejaVu Serif survives reopen').toBe('DejaVu Serif');
  } finally {
    await hardClose(app, 'p27-c2a');
  }
});

// ===========================================================================
// C2b - Liberation Sans renders (computed family), embeds a real `/FontFile2`
// program and survives reopen.
// ===========================================================================
test('C2b Liberation Sans renders, embeds a FontFile2 and survives reopen', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await createTextBox(win, 'P27-FONT-B', 0.62, 0.2);

    await win.locator('[data-txt-font]').selectOption('Liberation Sans');
    const b = await waitForBox(win, 'P27-FONT-B', (x) => x.font === 'Liberation Sans');
    expect(b && b.font, 'box engine font').toBe('Liberation Sans');
    const fam = await mirrorFontFamily(win, 'P27-FONT-B');
    log('C2b-fam', fam);
    expect(fam, 'page mirror names Liberation Sans').toContain('Liberation Sans');
    await win.screenshot({ path: path.join(SHOTS, 'phase27-c2b-liberation-sans.png') }).catch(() => {});

    const p = path.join(os.tmpdir(), `p27-c2b-${Date.now()}.pdf`);
    await saveAs(app, win, p);
    const ev = await fontEvidence(p);
    log('C2b-embed', ev);
    expect(ev.fontFile2, 'saved PDF carries an embedded TrueType program').toBeGreaterThanOrEqual(1);
    expect(ev.baseFonts.some((n) => n.startsWith('TFlexLiberationSans')), 'Liberation Sans subset embedded').toBe(true);

    await closeAndReopen(app, win, p);
    const b2 = await waitForBox(win, 'P27-FONT-B', (x) => x.font === 'Liberation Sans', 20000);
    log('C2b-reopen', b2 && b2.font);
    expect(b2 && b2.font, 'Liberation Sans survives reopen').toBe('Liberation Sans');
  } finally {
    await hardClose(app, 'p27-c2b');
  }
});

// ===========================================================================
// C4 - composition: family + bold + size + align + line spacing + char spacing
// + indent on one box, all applied and all surviving save+reopen together.
// ===========================================================================
test('C4 char spacing composes with the full style set and round-trips', async () => {
  test.setTimeout(300000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await createTextBox(win, 'P27-COMPOSE', 0.62, 0.2);

    await win.locator('[data-txt-font]').selectOption('DejaVu Sans Mono');
    await win.locator('[data-txt-size]').fill('18');
    await win.click('[data-txt-bold]');
    await win.click('[data-txt-align-right]');
    await win.locator('[data-txt-line-height]').fill('1.6');
    await win.locator('[data-txt-character-spacing]').fill('4');
    await win.click('[data-txt-indent-inc]');

    const want = (b) => b.font === 'DejaVu Sans Mono' && b.size === 18 && b.bold === true &&
      b.align === 'right' && b.lineHeight === 1.6 && b.charSpacing === 4 && b.indent === 12;
    const box = await waitForBox(win, 'P27-COMPOSE', want, 20000);
    log('C4-engine', box);
    expect(box, 'all seven fields applied on the engine box').toBeTruthy();
    expect(box && box.font, 'font').toBe('DejaVu Sans Mono');
    expect(box && box.size, 'size').toBe(18);
    expect(box && box.bold, 'bold').toBe(true);
    expect(box && box.align, 'align').toBe('right');
    expect(box && box.lineHeight, 'lineHeight').toBe(1.6);
    expect(box && box.charSpacing, 'charSpacing').toBe(4);
    expect(box && box.indent, 'indent').toBe(12);
    await win.screenshot({ path: path.join(SHOTS, 'phase27-c4-compose.png') }).catch(() => {});

    const p = path.join(os.tmpdir(), `p27-c4-${Date.now()}.pdf`);
    await saveAs(app, win, p);
    const streams = await decodedStreams(p);
    expect(tcStreams(streams, 4), 'composed box bakes `4 Tc`').toBeGreaterThan(0);
    const ev = await fontEvidence(p);
    expect(ev.baseFonts.some((n) => n.startsWith('TFlexDejaVuSansMono')), 'composed box embeds the DejaVu Sans Mono subset').toBe(true);

    await closeAndReopen(app, win, p);
    const rt = await waitForBox(win, 'P27-COMPOSE', want, 25000);
    log('C4-reopen', rt);
    expect(rt, 'every composed field survives save+reopen').toBeTruthy();
    expect(rt && rt.charSpacing, 'charSpacing survives reopen').toBe(4);
    expect(rt && rt.indent, 'indent survives reopen').toBe(12);
  } finally {
    await hardClose(app, 'p27-c4');
  }
});

// ===========================================================================
// C3 - an unknown family id fails loud with a typed engine-error naming the
// font on addTextBox / updateTextBox / editAnnotation / editTextRun, and
// mutates nothing. (The missing-file leg is covered by the backend unit test
// `Phase 27: bundled font embedding > fails loud ... missing`.)
// ===========================================================================
test('C3 unknown family fails loud on every text op and mutates nothing', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await createTextBox(win, 'P27-BADFONT', 0.62, 0.2);
    await closeEditMode(win);
    const docId = (await win.evaluate(() => window.tflexDiagnostics())).engineDocId;
    const boxId = await win.evaluate(() => {
      const bs = ((window.tflexDiagnostics().engineState || {}).textBoxes) || [];
      return bs.length ? bs[bs.length - 1].id : null;
    });
    await placeTextbox(win, 'P27-BADANN', 0.3, 0.4);
    const annId = (await win.evaluate(() => {
      const as = ((window.tflexDiagnostics().engineState || {}).annotations) || [];
      const a = as.filter((x) => (x.text ?? x.content) === 'P27-BADANN');
      return a.length ? a[a.length - 1].id : null;
    }));

    const snap = () => win.evaluate(() => {
      const es = window.tflexDiagnostics().engineState || {};
      return { boxes: JSON.stringify(es.textBoxes || []), anns: JSON.stringify(es.annotations || []) };
    });
    const before = await snap();

    const call = (fn, args) => win.evaluate(async (a) => {
      const r = await window.tflex.engine[a.fn](...a.args);
      if (r && r.ok) return { ok: true };
      return { ok: false, code: r && r.error ? r.error.code : null, message: r && r.error ? r.error.message : String(r) };
    }, { fn, args });

    const addBad = await call('addTextBox', [docId, {
      page: 1, rect: { x: 72, y: 300, width: 200, height: 40 }, text: 'BAD', font: 'Comic Sans',
    }]);
    const updBad = await call('updateTextBox', [docId, boxId, { font: 'Comic Sans' }]);
    const annBad = await call('editAnnotation', [docId, annId, { style: { font: 'Comic Sans' } }]);
    const runBad = await call('editTextRun', [docId, {
      page: 1, rect: { x: 72, y: 320, width: 200, height: 16 }, newText: 'BAD', font: 'Comic Sans',
    }]);
    log('C3-results', { addBad, updBad, annBad, runBad });

    for (const [label, r] of [['addTextBox', addBad], ['updateTextBox', updBad], ['editAnnotation', annBad], ['editTextRun', runBad]]) {
      expect(r.ok, `${label}: unknown family rejected`).toBe(false);
      expect(r.code, `${label}: typed engine-error`).toBe('engine-error');
      expect(r.message, `${label}: error names the font`).toContain('"Comic Sans"');
    }

    const after = await snap();
    expect(after.boxes, 'text boxes unchanged by the failing ops').toBe(before.boxes);
    expect(after.anns, 'annotations unchanged by the failing ops').toBe(before.anns);
  } finally {
    await hardClose(app, 'p27-c3');
  }
});
