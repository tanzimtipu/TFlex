// DEF-262/263/264/265/266 FIX-READY retest (Phase 29 text-manipulation audit).
//
// Measures, does not trust. Drives the real app through the canonical launcher
// and asserts the five defects' expected results with numbers:
//   DEF-262  multi-line annotation grows to the requested size and the grown
//            rect persists through save + reopen.
//   DEF-263  each Edit-mode box control changes the LIVE computed style.
//   DEF-264  the sticky-note label's computed style follows each control.
//   DEF-265  annotation list prefixes + super/subscript render live AND match
//            the baked /AP.
//   DEF-266  the run preview shows the full style set and a style click after
//            typing keeps the run active.
// Plus the multi-line specifics (per-line align / line-height / underline /
// highlight / numbering / indent / justify-last / char spacing) on the box AND
// an annotation, and one composed multi-line style per target surviving
// save + reopen.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { inflateSync } = require('node:zlib');
const { PDFDocument, PDFRawStream } = require('pdf-lib');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose, armAnnotationTool, openSamplePath } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const OUT = path.join(SHOTS, 'def262-266-retest.json');
const log = (label, obj) => console.log(`[DEF262-266] ${label} ${JSON.stringify(obj)}`);

const SINGLE = 'Sgl';
const MULTI = 'The quick brown fox jumps over the lazy dog and keeps running far away';

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

async function dragOnPage(win, fx, fy, dxPx = 190, dyPx = 70) {
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 260));
  const y = Math.max(40, Math.min(pg.y + pg.height * fy, vp.h - 130));
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dxPx, y + dyPx, { steps: 6 });
  await win.mouse.up();
}

async function fillPanelText(win, text) {
  await win.waitForSelector('[data-txt-text]', { timeout: 10000 });
  await win.waitForFunction(() => {
    const ta = document.querySelector('[data-txt-text]');
    return ta !== null && ta.disabled === false;
  }, null, { timeout: 10000 });
  await win.locator('[data-txt-text]').fill(text);
  await win.locator('[data-txt-text]').blur();
}

async function closeEditMode(win) {
  if ((await win.locator('[data-edit-toolbar]').count()) > 0) {
    await win.click('button[aria-label="Edit content"]');
    await win.waitForTimeout(400);
  }
}

async function placeEditBox(win, text, dxPx = 190, dyPx = 70) {
  if ((await win.locator('[data-edit-toolbar]').count()) === 0) {
    await win.click('button[aria-label="Edit content"]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
  }
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);
  await dragOnPage(win, 0.55, 0.3, dxPx, dyPx);
  await fillPanelText(win, text);
  await win.waitForSelector('.edit-box', { timeout: 8000 });
  await win.waitForTimeout(400);
  await win.locator(`.edit-box[data-edit-box-text="${text}"]`).click({ position: { x: 8, y: 8 } });
  await win.waitForSelector('[data-edit-box-toolbar]', { timeout: 8000 });
  await win.waitForTimeout(300);
}

async function placeAnn(win, kind, text, fx, fy) {
  await armAnnotationTool(win, kind);
  if (kind === 'note') {
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 40));
    const y = Math.max(40, Math.min(pg.y + pg.height * fy, vp.h - 130));
    await win.mouse.click(x, y);
  } else {
    await dragOnPage(win, fx, fy);
  }
  await fillPanelText(win, text);
  await win.waitForSelector(`.ann-${kind}[data-kind="${kind}"]`, { timeout: 8000 });
  await win.waitForTimeout(400);
}

async function selectRun(win) {
  if ((await win.locator('[data-edit-toolbar]').count()) === 0) {
    await win.click('button[aria-label="Edit content"]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
  }
  await win.click('[data-edit-tool="text"]');
  await win.waitForTimeout(300);
  const span = win.locator('.pdf-page[data-page="1"] .textLayer span').filter({ hasText: /[A-Za-z]/ }).first();
  await span.waitFor({ state: 'attached', timeout: 10000 });
  const sb = await span.boundingBox();
  await win.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await win.waitForTimeout(700);
}

async function saveAs(app, win, savePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-confirm]', { timeout: 8000 });
  await win.click('[data-save-as-confirm]');
  await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 30000 });
  expect(fs.existsSync(savePath), 'saved PDF exists on disk').toBe(true);
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

// The baked /AP draws text as `<hex> Tj` / `<hex> ... TJ`; decode every hex
// token so a prefix like "1. " can be matched in the baked stream.
function decodeHexText(streams) {
  const parts = [];
  for (const s of streams) {
    const re = /<([0-9A-Fa-f]+)>/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const hex = m[1];
      if (hex.length % 2 !== 0) continue;
      let txt = '';
      for (let i = 0; i < hex.length; i += 2) txt += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      parts.push(txt);
    }
  }
  return parts.join('\n');
}

// Per-line live measurement: every wrapped line's computed style + the band +
// the prefix text. This is the DOM the shared live layout emits.
async function measureLines(win, sel) {
  return win.evaluate((s) => {
    const root = document.querySelector(s);
    if (!root) return null;
    const lineSel = '.ann-text-line, .edit-box-line, .edit-run-line';
    const bandSel = '.ann-text-content, .edit-box-line-band, .edit-run-line-band';
    const prefixSel = '.ann-text-prefix, .edit-box-line-prefix, .edit-run-line-prefix';
    const lines = Array.from(root.querySelectorAll(lineSel));
    const pick = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        textAlign: cs.textAlign, textAlignLast: cs.textAlignLast,
        textDecorationLine: cs.textDecorationLine, lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing, fontSize: cs.fontSize,
        fontWeight: cs.fontWeight, fontStyle: cs.fontStyle, fontFamily: cs.fontFamily,
        color: cs.color, paddingLeft: cs.paddingLeft, verticalAlign: cs.verticalAlign,
        backgroundColor: cs.backgroundColor, width: cs.width,
      };
    };
    const rootCs = getComputedStyle(root);
    return {
      root: pick(root),
      rootRect: (() => { const r = root.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; })(),
      lineCount: lines.length,
      lines: lines.map((ln) => ({
        text: ln.textContent,
        prefix: (ln.querySelector(prefixSel) || {}).textContent || '',
        line: pick(ln),
        band: pick(ln.querySelector(bandSel)),
      })),
      rootTextAlign: rootCs.textAlign,
    };
  }, sel);
}

async function panelState(win) {
  return win.evaluate(() => {
    const p = document.querySelector('.text-props-panel');
    if (!p) return null;
    const q = (s) => p.querySelector(s);
    const pressed = (s) => q(s)?.getAttribute('aria-pressed') === 'true';
    return {
      mode: document.querySelector('[data-text-panel]')?.getAttribute('data-text-panel-mode') ?? null,
      text: q('[data-txt-text]')?.value ?? null,
      font: q('[data-txt-font]')?.value ?? null,
      size: q('[data-txt-size]')?.value ?? null,
      bold: pressed('[data-txt-bold]'),
      italic: pressed('[data-txt-italic]'),
      underline: pressed('[data-txt-underline]'),
      super: pressed('[data-txt-super]'),
      sub: pressed('[data-txt-sub]'),
      color: q('[data-txt-color]')?.value ?? null,
      highlight: q('[data-txt-highlight]')?.value ?? null,
      align: ['left', 'center', 'right', 'justify'].filter((a) => pressed(`[data-txt-align-${a}]`)),
      lineHeight: q('[data-txt-line-height]')?.value ?? null,
      list: ['none', 'bullet', 'number'].filter((l) => pressed(`[data-txt-list-${l}]`)),
      indent: q('[data-txt-indent-value]')?.textContent ?? null,
      charSpacing: q('[data-txt-character-spacing]')?.value ?? null,
    };
  });
}

async function annModels(win) {
  return win.evaluate(() => {
    const st = window.tflexDiagnostics().engineState;
    if (!st || !st.annotations) return null;
    return st.annotations.map((a) => ({
      id: a.id, kind: a.kind, text: a.text ?? a.content ?? null,
      color: a.color ?? null, style: a.style ?? null,
      rect: a.rect ?? (a.rects ? a.rects[0] : null) ?? null,
    }));
  });
}

async function boxModels(win) {
  return win.evaluate(() => {
    const st = window.tflexDiagnostics().engineState;
    if (!st || !st.textBoxes) return null;
    return st.textBoxes.map((b) => ({
      id: b.id, text: b.text, font: b.font, size: b.size, bold: b.bold,
      italic: b.italic, underline: b.underline, color: b.color,
      highlight: b.highlight ?? null, align: b.align, lineHeight: b.lineHeight,
      list: b.list, indent: b.indent, charSpacing: b.charSpacing,
      baselineShift: b.baselineShift,
    }));
  });
}

async function waitForAnn(win, text, timeout = 12000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    const a = ((await annModels(win)) || []).find((x) => x.text === text);
    last = a;
    if (a) return a;
    await win.waitForTimeout(120);
  }
  return last;
}

async function waitForBox(win, text, timeout = 12000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    const b = ((await boxModels(win)) || []).find((x) => x.text === text);
    last = b;
    if (b) return b;
    await win.waitForTimeout(120);
  }
  return last;
}

function writeOut(key, value) {
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (_) { existing = {}; }
  existing[key] = value;
  fs.writeFileSync(OUT, JSON.stringify(existing, null, 2));
}

module.exports = { MULTI, SINGLE };
// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------
const EDITBOX_SEL = (t) => `.edit-box[data-edit-box-text="${t}"] .edit-box-text`;
const TEXTBOX_SEL = '.ann-textbox[data-kind="textbox"]';
const CALLOUT_SEL = '.ann-callout[data-kind="callout"]';
const NOTE_SEL = '.ann-note[data-kind="note"] .ann-note-text';
const RUN_SEL = '[data-edit-run-preview]';

const STYLE_KEYS = ['fontFamily','fontSize','fontWeight','fontStyle','textDecorationLine','textAlign','lineHeight','letterSpacing','color','backgroundColor','paddingLeft','verticalAlign'];
function styleDiff(a, b) {
  if (!a || !b) return [];
  const out = [];
  for (const k of STYLE_KEYS) if (a[k] !== b[k]) out.push(`${k}:${a[k]}->${b[k]}`);
  return out;
}
// Any observable live change across the block, the first line, its band, or
// the prefix text.
function liveDiff(before, after) {
  if (!before || !after) return [];
  const d = [
    ...styleDiff(before.root, after.root),
    ...styleDiff(before.lines[0] && before.lines[0].line, after.lines[0] && after.lines[0].line),
    ...styleDiff(before.lines[0] && before.lines[0].band, after.lines[0] && after.lines[0].band),
  ];
  if (before.lines[0] && after.lines[0] && before.lines[0].prefix !== after.lines[0].prefix) {
    d.push(`prefix:${JSON.stringify(before.lines[0].prefix)}->${JSON.stringify(after.lines[0].prefix)}`);
  }
  return d;
}

const THIRTEEN = [
  ['font', (w) => w.locator('[data-txt-font]').selectOption('Times')],
  ['size', (w) => w.locator('[data-txt-size]').fill('18')],
  ['bold', (w) => w.locator('[data-txt-bold]').click()],
  ['italic', (w) => w.locator('[data-txt-italic]').click()],
  ['underline', (w) => w.locator('[data-txt-underline]').click()],
  ['super', (w) => w.locator('[data-txt-super]').click()],
  ['sub', (w) => w.locator('[data-txt-sub]').click()],
  ['highlight', (w) => w.locator('[data-txt-highlight]').fill('#ffff00')],
  ['align-center', (w) => w.locator('[data-txt-align-center]').click()],
  ['line-height', (w) => w.locator('[data-txt-line-height]').fill('2')],
  ['list-bullet', (w) => w.locator('[data-txt-list-bullet]').click()],
  ['indent-inc', (w) => w.locator('[data-txt-indent-inc]').click()],
  ['character-spacing', (w) => w.locator('[data-txt-character-spacing]').fill('6')],
];

// ===========================================================================
// DEF-262 � multi-line annotation grows to the requested size and persists.
// ===========================================================================
test('DEF-262: multi-line annotation at size 18 renders legibly and the grown rect persists', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await placeAnn(win, 'textbox', MULTI, 0.3, 0.2);
    await win.locator('[data-txt-size]').fill('18');
    await win.waitForTimeout(800);

    const m = await measureLines(win, TEXTBOX_SEL);
    const ann = await waitForAnn(win, MULTI);
    const scale = m && ann && ann.rect ? m.rootRect.w / ann.rect.width : null;
    const liveSizePt = m && scale ? parseFloat(m.root.fontSize) / scale : null;
    const out = {
      lineCount: m && m.lineCount,
      liveFontSizePx: m && m.root.fontSize,
      cssScale: scale,
      liveSizePt,
      engineRect: ann && ann.rect,
      engineStyle: ann && ann.style,
    };
    log('DEF-262-live', out);
    writeOut('DEF-262-live', out);

    expect(m, 'the live textbox is rendered').toBeTruthy();
    expect(m.lineCount, 'multi-line text wraps to 2+ lines').toBeGreaterThanOrEqual(2);
    expect(liveSizePt, 'the rendered size is the requested 18pt, not the 4pt floor').toBeGreaterThan(16);
    expect(ann.rect.height, 'the engine rect grew past the old one-line 26.2pt').toBeGreaterThan(26.2);

    const p = path.join(os.tmpdir(), `def262-${Date.now()}.pdf`);
    await saveAs(app, win, p);
    await win.locator('.tab-active .tab-close').click();
    await win.waitForTimeout(1500);
    await openSamplePath(win, app, p);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(2500);

    const ann2 = (await annModels(win) || []).find((a) => a.text === MULTI);
    const rt = { reopenedRect: ann2 && ann2.rect, reopenedStyle: ann2 && ann2.style };
    log('DEF-262-reopen', rt);
    writeOut('DEF-262-reopen', rt);
    expect(ann2, 'the annotation survives save + reopen').toBeTruthy();
    expect(ann2.rect.height, 'the grown rect persists through save + reopen').toBeGreaterThan(26.2);
    expect(Math.abs(ann2.rect.height - ann.rect.height), 'reopened height matches the pre-save grown height').toBeLessThan(2);

    // Baked legibility: the reopened page canvas paints dark glyphs in the box.
    const scale2 = m.rootRect.w / ann.rect.width;
    const sample = await win.evaluate(({ rect, sc }) => {
      const page = document.querySelector('.pdf-page[data-page="1"]');
      const canvas = page && page.querySelector('canvas');
      if (!canvas) return null;
      const pb = page.getBoundingClientRect();
      const cb = canvas.getBoundingClientRect();
      const sx = canvas.width / cb.width, sy = canvas.height / cb.height;
      const x0 = Math.max(0, Math.round((rect.x * sc + (pb.left - cb.left)) * sx));
      const y0 = Math.max(0, Math.round((rect.y * sc + (pb.top - cb.top)) * sy));
      const w = Math.max(1, Math.min(canvas.width - x0, Math.round(rect.width * sc * sx)));
      const h = Math.max(1, Math.min(canvas.height - y0, Math.round(rect.height * sc * sy)));
      const img = canvas.getContext('2d').getImageData(x0, y0, w, h);
      let dark = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i] < 100 && img.data[i + 1] < 100 && img.data[i + 2] < 100) dark += 1;
      }
      return { darkGlyphs: dark, box: [x0, y0, w, h] };
    }, { rect: ann2.rect, sc: scale2 });
    log('DEF-262-baked', sample);
    writeOut('DEF-262-baked', sample);
    expect(sample && sample.darkGlyphs, 'the baked page paints legible dark glyphs in the grown box').toBeGreaterThan(200);
  } finally {
    await hardClose(app, 'def262');
  }
});

// ===========================================================================
// DEF-263 � each of the 13 controls changes the Edit-mode box LIVE style.
// ===========================================================================
test('DEF-263: each of the 13 controls changes the Edit-mode box live computed style', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await placeEditBox(win, MULTI);
    const results = {};
    let prev = await measureLines(win, EDITBOX_SEL(MULTI));
    for (const [id, apply] of THIRTEEN) {
      await apply(win);
      await win.waitForTimeout(450);
      const after = await measureLines(win, EDITBOX_SEL(MULTI));
      const diff = liveDiff(prev, after);
      results[id] = { live: diff.length > 0, diff };
      prev = after;
    }
    log('DEF-263', results);
    writeOut('DEF-263', results);
    for (const [id] of THIRTEEN) {
      expect(results[id].live, `DEF-263 control ${id} changes the live box style`).toBe(true);
    }
  } finally {
    await hardClose(app, 'def263');
  }
});

// ===========================================================================
// DEF-264 � the sticky-note label's computed style follows each control.
// ===========================================================================
test('DEF-264: the note label computed style follows each of the 13 controls', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await placeAnn(win, 'note', MULTI, 0.55, 0.55);
    const results = {};
    let prev = await measureLines(win, NOTE_SEL);
    for (const [id, apply] of THIRTEEN) {
      await apply(win);
      await win.waitForTimeout(450);
      const after = await measureLines(win, NOTE_SEL);
      const diff = liveDiff(prev, after);
      results[id] = { live: diff.length > 0, diff };
      prev = after;
    }
    log('DEF-264', results);
    writeOut('DEF-264', results);
    for (const [id] of THIRTEEN) {
      expect(results[id].live, `DEF-264 control ${id} changes the live note style`).toBe(true);
    }
  } finally {
    await hardClose(app, 'def264');
  }
});

// ===========================================================================
// DEF-265 � annotation list prefixes + super/subscript render live AND match
// the baked /AP.
// ===========================================================================
test('DEF-265: annotation list prefixes + super/sub render live and match the baked result', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await placeAnn(win, 'textbox', MULTI, 0.3, 0.2);

    await win.locator('[data-txt-list-number]').click();
    await win.waitForTimeout(600);
    const numbered = await measureLines(win, TEXTBOX_SEL);
    const prefixes = numbered.lines.map((l) => l.prefix);
    const expected = numbered.lines.map((_, i) => `${i + 1}. `);
    log('DEF-265-numbered', { lineCount: numbered.lineCount, prefixes });
    writeOut('DEF-265-numbered', { lineCount: numbered.lineCount, prefixes });
    expect(numbered.lineCount, 'the numbered list wraps to 2+ lines').toBeGreaterThanOrEqual(2);
    expect(prefixes, 'every wrapped line carries its incrementing number prefix').toEqual(expected);

    await win.locator('[data-txt-super]').click();
    await win.waitForTimeout(500);
    const sup = await measureLines(win, TEXTBOX_SEL);
    const supVa = parseFloat(sup.lines[0].band.verticalAlign);
    await win.locator('[data-txt-sub]').click();
    await win.waitForTimeout(500);
    const sub = await measureLines(win, TEXTBOX_SEL);
    const subVa = parseFloat(sub.lines[0].band.verticalAlign);
    log('DEF-265-baseline', { supVa, subVa });
    writeOut('DEF-265-baseline', { supVa, subVa });
    expect(supVa, 'superscript shifts the baseline up live').toBeGreaterThan(0);
    expect(subVa, 'subscript shifts the baseline down live').toBeLessThan(0);

const p = path.join(os.tmpdir(), `def265-${Date.now()}.pdf`);
    await saveAs(app, win, p);
    const streams = await decodedStreams(p);
    const bakedText = decodeHexText(streams);
    const bakedPrefixes = numbered.lines.map((_, i) => `${i + 1}. `).filter((pfx) => bakedText.includes(pfx));
    log('DEF-265-baked', { streamCount: streams.length, bakedPrefixes });
    writeOut('DEF-265-baked', { streamCount: streams.length, bakedPrefixes });
    expect(bakedPrefixes.length, 'the baked /AP stream carries the same numbered prefixes').toBe(numbered.lineCount);

    await win.locator('.tab-active .tab-close').click();
    await win.waitForTimeout(1500);
    await openSamplePath(win, app, p);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(2000);
    const ann2 = (await annModels(win) || []).find((a) => a.text === MULTI);
    log('DEF-265-reopen-style', ann2 && ann2.style);
    writeOut('DEF-265-reopen-style', ann2 && ann2.style);
    expect(ann2.style.list, 'the list style survives save + reopen').toBe('number');
    expect(ann2.style.baselineShift, 'the baseline shift survives save + reopen').toBe(-6);
  } finally {
    await hardClose(app, 'def265');
  }
});

// ===========================================================================
// DEF-266 � the run preview shows the full style set and a style click after
// typing keeps the run active.
// ===========================================================================
test('DEF-266: run preview full style + a style click after typing keeps the run active', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await selectRun(win);
    await win.locator('[data-txt-text]').fill(MULTI);
    await win.waitForSelector(RUN_SEL, { timeout: 8000 });
    await win.waitForTimeout(400);

    const checks = [
      ['bold', (w) => w.locator('[data-txt-bold]').click(), (m) => m.root.fontWeight === '700'],
      ['align-center', (w) => w.locator('[data-txt-align-center]').click(), (m) => m.lines[0].line.textAlign === 'center'],
      ['line-height', (w) => w.locator('[data-txt-line-height]').fill('2'), (m) => parseFloat(m.root.lineHeight) > parseFloat(m.root.fontSize) * 1.8],
      ['list-bullet', (w) => w.locator('[data-txt-list-bullet]').click(), (m) => m.lines[0].prefix === '\u2022 '],
      ['indent-inc', (w) => w.locator('[data-txt-indent-inc]').click(), (m) => parseFloat(m.root.paddingLeft) > 0],
      ['super', (w) => w.locator('[data-txt-super]').click(), (m) => parseFloat(m.lines[0].band.verticalAlign) > 0],
      ['highlight', (w) => w.locator('[data-txt-highlight]').fill('#ffff00'), (m) => m.lines[0].band.backgroundColor !== 'rgba(0, 0, 0, 0)'],
      ['character-spacing', (w) => w.locator('[data-txt-character-spacing]').fill('6'), (m) => parseFloat(m.root.letterSpacing) > 0],
    ];
    const results = {};
    for (const [id, apply, ok] of checks) {
      await apply(win);
      await win.waitForTimeout(450);
      const mounted = (await win.locator(RUN_SEL).count()) > 0;
      const m = mounted ? await measureLines(win, RUN_SEL) : null;
      const panel = await panelState(win);
      const passed = mounted && m !== null && ok(m);
      results[id] = { mounted, passed, panelText: panel && panel.text, sample: m && { fontWeight: m.root.fontWeight, lineAlign: m.lines[0].line.textAlign, lineHeight: m.root.lineHeight, prefix: m.lines[0].prefix, paddingLeft: m.root.paddingLeft, bandVa: m.lines[0].band.verticalAlign, bandBg: m.lines[0].band.backgroundColor, letterSpacing: m.root.letterSpacing } };
      log(`DEF-266-${id}`, results[id]);
    }
    writeOut('DEF-266', results);
    for (const [id] of checks) {
      expect(results[id].mounted, `DEF-266 the run stays active after the ${id} click`).toBe(true);
      expect(results[id].passed, `DEF-266 the ${id} control shows in the live run preview`).toBe(true);
    }
  } finally {
    await hardClose(app, 'def266');
  }
});

// ===========================================================================
// Multi-line specifics � per-line align / line-height / underline / highlight
// / numbering / indent / justify-last / char spacing, on the box AND an
// annotation.
// ===========================================================================
async function multiLineChecks(win, rootSel, label) {
  const out = {};
  const base = await measureLines(win, rootSel);
  out.base = { lineCount: base.lineCount, paddingLeft: base.root.paddingLeft };

  await win.locator('[data-txt-align-center]').click();
  await win.waitForTimeout(450);
  let m = await measureLines(win, rootSel);
  out.alignCenter = { allCenter: m.lines.every((l) => l.line.textAlign === 'center'), aligns: m.lines.map((l) => l.line.textAlign) };

  await win.locator('[data-txt-line-height]').fill('2');
  await win.waitForTimeout(450);
  m = await measureLines(win, rootSel);
  out.lineHeight = { root: m.root.lineHeight, fontSize: m.root.fontSize, ratio: parseFloat(m.root.lineHeight) / parseFloat(m.root.fontSize) };

  await win.locator('[data-txt-underline]').click();
  await win.waitForTimeout(450);
  m = await measureLines(win, rootSel);
  out.underline = { allUnderlined: m.lines.every((l) => l.line.textDecorationLine.includes('underline')), decos: m.lines.map((l) => l.line.textDecorationLine) };

  await win.locator('[data-txt-highlight]').fill('#ffff00');
  await win.waitForTimeout(450);
  m = await measureLines(win, rootSel);
  out.highlight = { allBanded: m.lines.every((l) => l.band.backgroundColor !== 'rgba(0, 0, 0, 0)'), bands: m.lines.map((l) => l.band.backgroundColor) };

  await win.locator('[data-txt-list-number]').click();
  await win.waitForTimeout(450);
  m = await measureLines(win, rootSel);
  out.numbering = { prefixes: m.lines.map((l) => l.prefix), expected: m.lines.map((_, i) => `${i + 1}. `) };

  await win.locator('[data-txt-indent-inc]').click();
  await win.waitForTimeout(450);
  m = await measureLines(win, rootSel);
  out.indent = { before: base.root.paddingLeft, after: m.root.paddingLeft };

  await win.locator('[data-txt-align-justify]').click();
  await win.waitForTimeout(450);
  m = await measureLines(win, rootSel);
  out.justify = {
    aligns: m.lines.map((l) => l.line.textAlign),
    lastAligns: m.lines.map((l) => l.line.textAlignLast),
    nonLastJustify: m.lines.slice(0, -1).every((l) => l.line.textAlign === 'justify'),
    lastLeft: m.lines[m.lines.length - 1].line.textAlign === 'left',
  };

  await win.locator('[data-txt-character-spacing]').fill('6');
  await win.waitForTimeout(450);
  m = await measureLines(win, rootSel);
  out.charSpacing = { spacings: m.lines.map((l) => l.line.letterSpacing), allPositive: m.lines.every((l) => parseFloat(l.line.letterSpacing) > 0) };

  log(`multi-${label}`, out);
  writeOut(`multi-${label}`, out);
  return out;
}

test('multi-line specifics: per-line style on the Edit-mode box AND an annotation', async () => {
  test.setTimeout(300000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);

await placeEditBox(win, MULTI, 320, 240);
    const box = await multiLineChecks(win, EDITBOX_SEL(MULTI), 'editbox');
    expect(box.base.lineCount, 'editbox wraps to 2+ lines').toBeGreaterThanOrEqual(2);
    expect(box.alignCenter.allCenter, 'editbox: every line is centered').toBe(true);
    expect(box.lineHeight.ratio, 'editbox: line-height step is the stored 2x').toBeGreaterThan(1.8);
    expect(box.underline.allUnderlined, 'editbox: every line is underlined').toBe(true);
    expect(box.highlight.allBanded, 'editbox: every line carries the highlight band').toBe(true);
    expect(box.numbering.prefixes, 'editbox: numbering increments per line').toEqual(box.numbering.expected);
    expect(parseFloat(box.indent.after), 'editbox: indent shifts every line').toBeGreaterThan(parseFloat(box.indent.before));
    expect(box.justify.nonLastJustify, 'editbox: justify stretches every non-last line').toBe(true);
    expect(box.justify.lastLeft, 'editbox: justify excludes the last line').toBe(true);
expect(box.charSpacing.allPositive, 'editbox: char spacing applies per line').toBe(true);
    await win.screenshot({ path: path.join(SHOTS, 'def262-266-editbox.png') }).catch(() => {});

    await closeEditMode(win);
    await placeAnn(win, 'textbox', MULTI, 0.3, 0.2);
    const ann = await multiLineChecks(win, TEXTBOX_SEL, 'textbox');
    expect(ann.base.lineCount, 'annotation wraps to 2+ lines').toBeGreaterThanOrEqual(2);
    expect(ann.alignCenter.allCenter, 'annotation: every line is centered').toBe(true);
    expect(ann.lineHeight.ratio, 'annotation: line-height step is the stored 2x').toBeGreaterThan(1.8);
    expect(ann.underline.allUnderlined, 'annotation: every line is underlined').toBe(true);
    expect(ann.highlight.allBanded, 'annotation: every line carries the highlight band').toBe(true);
    expect(ann.numbering.prefixes, 'annotation: numbering increments per line').toEqual(ann.numbering.expected);
    expect(parseFloat(ann.indent.after), 'annotation: indent shifts every line').toBeGreaterThan(parseFloat(ann.indent.before));
    expect(ann.justify.nonLastJustify, 'annotation: justify stretches every non-last line').toBe(true);
    expect(ann.justify.lastLeft, 'annotation: justify excludes the last line').toBe(true);
    expect(ann.charSpacing.allPositive, 'annotation: char spacing applies per line').toBe(true);
    await win.screenshot({ path: path.join(SHOTS, 'def262-266-retest.png') }).catch(() => {});
  } finally {
    await hardClose(app, 'multiline');
  }
});

// ===========================================================================
// Save + reopen � one composed multi-line style per target survives.
// ===========================================================================
const EDITBOX_TEXT = 'Edit box multi line sample text that wraps across lines here';
const TEXTBOX_TEXT = 'Textbox multi line sample text that wraps across lines here';
const CALLOUT_TEXT = 'Callout multi line sample text that wraps across lines here';
const NOTE_TEXT = 'Note multi line sample text that wraps across lines here';

async function compose(win) {
  const steps = [
    (w) => w.locator('[data-txt-font]').selectOption('Times'),
    (w) => w.locator('[data-txt-size]').fill('18'),
    (w) => w.locator('[data-txt-bold]').click(),
    (w) => w.locator('[data-txt-italic]').click(),
    (w) => w.locator('[data-txt-underline]').click(),
    (w) => w.locator('[data-txt-align-center]').click(),
    (w) => w.locator('[data-txt-line-height]').fill('2'),
    (w) => w.locator('[data-txt-list-bullet]').click(),
    (w) => w.locator('[data-txt-indent-inc]').click(),
    (w) => w.locator('[data-txt-character-spacing]').fill('4'),
  ];
  for (const s of steps) { await s(win); await win.waitForTimeout(300); }
}

test('save + reopen: one composed multi-line style per target survives', async () => {
  test.setTimeout(300000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);

    await placeEditBox(win, EDITBOX_TEXT);
    await compose(win);
    const boxBefore = await waitForBox(win, EDITBOX_TEXT);
    await closeEditMode(win);

await placeAnn(win, 'textbox', TEXTBOX_TEXT, 0.3, 0.2);
    await compose(win);
    const annBefore = await waitForAnn(win, TEXTBOX_TEXT);

    await placeAnn(win, 'callout', CALLOUT_TEXT, 0.65, 0.12);
    await compose(win);
    const calloutBefore = await waitForAnn(win, CALLOUT_TEXT);

    await placeAnn(win, 'note', NOTE_TEXT, 0.55, 0.55);
    await compose(win);
    const noteBefore = await waitForAnn(win, NOTE_TEXT);

    const p = path.join(os.tmpdir(), `def262-266-rt-${Date.now()}.pdf`);
    await saveAs(app, win, p);
    await win.locator('.tab-active .tab-close').click();
    await win.waitForTimeout(1500);
    await openSamplePath(win, app, p);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(2500);

    const boxes = (await boxModels(win)) || [];
    const anns = (await annModels(win)) || [];
const boxAfter = boxes.find((b) => b.text === EDITBOX_TEXT);
    const annAfter = anns.find((a) => a.text === TEXTBOX_TEXT);
    const calloutAfter = anns.find((a) => a.text === CALLOUT_TEXT);
    const noteAfter = anns.find((a) => a.text === NOTE_TEXT);
    const out = {
      boxBefore: boxBefore && { font: boxBefore.font, size: boxBefore.size, bold: boxBefore.bold, italic: boxBefore.italic, underline: boxBefore.underline, align: boxBefore.align, lineHeight: boxBefore.lineHeight, list: boxBefore.list, indent: boxBefore.indent, charSpacing: boxBefore.charSpacing },
      boxAfter: boxAfter && { font: boxAfter.font, size: boxAfter.size, bold: boxAfter.bold, italic: boxAfter.italic, underline: boxAfter.underline, align: boxAfter.align, lineHeight: boxAfter.lineHeight, list: boxAfter.list, indent: boxAfter.indent, charSpacing: boxAfter.charSpacing },
      annBefore: annBefore && annBefore.style,
      annAfter: annAfter && annAfter.style,
      calloutBefore: calloutBefore && calloutBefore.style,
      calloutAfter: calloutAfter && calloutAfter.style,
      noteBefore: noteBefore && noteBefore.style,
      noteAfter: noteAfter && noteAfter.style,
    };
    log('save-reopen', out);
    writeOut('save-reopen', out);

    for (const k of ['font', 'size', 'bold', 'italic', 'underline', 'align', 'lineHeight', 'list', 'indent', 'charSpacing']) {
      expect(boxAfter && boxAfter[k] !== undefined, `editbox style survives reopen: ${k}`).toBe(true);
      expect(annAfter && annAfter.style && annAfter.style[k] !== undefined, `textbox style survives reopen: ${k}`).toBe(true);
      expect(calloutAfter && calloutAfter.style && calloutAfter.style[k] !== undefined, `callout style survives reopen: ${k}`).toBe(true);
      expect(noteAfter && noteAfter.style && noteAfter.style[k] !== undefined, `note style survives reopen: ${k}`).toBe(true);
    }
    expect(boxAfter.align, 'editbox align survives').toBe('center');
    expect(annAfter.style.align, 'textbox align survives').toBe('center');
    expect(calloutAfter.style.align, 'callout align survives').toBe('center');
    expect(noteAfter.style.align, 'note align survives').toBe('center');
    expect(boxAfter.indent, 'editbox indent survives').toBe(12);
    expect(annAfter.style.indent, 'textbox indent survives').toBe(12);
    expect(calloutAfter.style.indent, 'callout indent survives').toBe(12);
    expect(noteAfter.style.indent, 'note indent survives').toBe(12);
  } finally {
    await hardClose(app, 'savereopen');
  }
});

// ===========================================================================
// Save + reopen � the composed multi-line RUN style survives (baked stream).
// ===========================================================================
test('save + reopen: the composed multi-line run style survives in the baked stream', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await selectRun(win);
    const original = await win.locator('[data-txt-text]').inputValue();
    await win.locator('[data-txt-character-spacing]').fill('6');
    await win.waitForTimeout(200);
    await win.click('[data-txt-bold]');
    await win.waitForTimeout(200);
    await win.click('[data-txt-align-right]');
    await win.waitForTimeout(200);
    const newText = `${original} X\nsecond line`;
    await win.locator('[data-txt-text]').fill(newText);
    await win.waitForSelector(RUN_SEL, { timeout: 8000 });
    await win.waitForTimeout(300);
    const preview = await measureLines(win, RUN_SEL);
    log('run-preview', { lineCount: preview.lineCount, letterSpacing: preview.root.letterSpacing, fontWeight: preview.root.fontWeight, lineAlign: preview.lines[0].line.lineAlign || preview.lines[0].line.textAlign });
    writeOut('run-preview', { lineCount: preview.lineCount, letterSpacing: preview.root.letterSpacing, fontWeight: preview.root.fontWeight, lineAlign: preview.lines[0].line.textAlign });
    expect(preview.lineCount, 'the run preview splits the explicit newline').toBeGreaterThanOrEqual(2);
    expect(parseFloat(preview.root.letterSpacing), 'the run preview shows the char spacing').toBeGreaterThan(0);
    expect(preview.root.fontWeight, 'the run preview shows bold').toBe('700');
    expect(preview.lines[0].line.textAlign, 'the run preview shows the alignment').toBe('right');

    await win.locator('[data-txt-text]').blur();
    await win.waitForTimeout(2500);

    const p = path.join(os.tmpdir(), `def266-run-${Date.now()}.pdf`);
    await saveAs(app, win, p);
const streams = await decodedStreams(p);
    const tc = streams.reduce((n, s) => n + ((s.match(/(?:^|\s)-?[\d.]+ Tc(?:\s|$)/g) || []).length), 0);
    const doc = await PDFDocument.load(fs.readFileSync(p), { ignoreEncryption: true, updateMetadata: false });
    const baseFonts = [];
    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      const m = /\/BaseFont\s*\/([^\s/]+)/.exec(obj.toString());
      if (m) baseFonts.push(m[1]);
    }
    const boldFont = baseFonts.some((n) => /Bold/i.test(n));
    log('run-baked', { tc, boldFont, baseFonts });
    writeOut('run-baked', { tc, boldFont, baseFonts });
    expect(tc, 'the saved stream bakes the 6pt tracking (Tc)').toBeGreaterThan(0);
    expect(boldFont, 'the saved stream embeds a bold font program').toBe(true);

    await win.locator('.tab-active .tab-close').click();
    await win.waitForTimeout(1500);
    await openSamplePath(win, app, p);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(2000);
    const layerText = await win.evaluate(() => {
      const layer = document.querySelector('.pdf-page[data-page="1"] .textLayer');
      return layer ? layer.textContent.replace(/\s+/g, ' ').trim() : null;
    });
log('run-reopened-text', layerText);
    expect((layerText || '').replace(/\s+/g, ''), 'the edited run text survives save + reopen').toContain('secondline');
  } finally {
    await hardClose(app, 'run-savereopen');
  }
});
