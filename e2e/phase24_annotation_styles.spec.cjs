// Phase 24 QA validation — full text-style support for annotation text
// objects (textbox / callout / note).
//
// Measures the running Electron app (canonical launcher only) against the
// phase's success criteria:
//   C1 every text-panel control is live for a selected annotation text object
//      and a panel change applies immediately to the rendered annotation text.
//   C2 style changes survive save + reopen (baked /AP stream + TFlex panel).
//   C3 an existing annotation with NO stored style reopens unchanged
//      (legacy Helvetica appearance; the defaults change must not touch it).
//   C4 highlight set -> save/reopen persists; highlight null -> save/reopen
//      leaves no band.
//
// Process gap (recorded, not a DEF): the Phase-21 spec's C4 section only ever
// exercised the annotation panel from an already-open, already-selected state.
// Phase-24 regression note: re-verify with the panel CLOSED and
// arm->place->interact to catch the DEF-251/252 lifecycle class.
//
// Screenshots: screenshots/phase24-*.png
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, armAnnotationTool, openSamplePath, scrollToPage, sampleCanvasPageRect, textPanelRight } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const log = (label, obj) => console.log(`[P24] ${label} ${JSON.stringify(obj)}`);

// Phase 27 — the only control the PDF engine cannot represent is horizontal
// scaling (no Tz operator); it is disabled for EVERY text surface. Character
// spacing (Tc) is now live and is NOT in this list.
const ENGINE_DISABLED = ['[data-txt-horizontal-scaling]'];
const ALL_CONTROLS = [
  '[data-txt-font]', '[data-txt-size]',
  '[data-txt-bold]', '[data-txt-italic]', '[data-txt-underline]',
  '[data-txt-super]', '[data-txt-sub]',
  '[data-txt-color]', '[data-txt-highlight]', '[data-txt-highlight-clear]',
  '[data-txt-clear]',
  '[data-txt-align-left]', '[data-txt-align-center]', '[data-txt-align-right]',
  '[data-txt-align-justify]',
  '[data-txt-line-height]',
  '[data-txt-list-none]', '[data-txt-list-bullet]', '[data-txt-list-number]',
  '[data-txt-indent-dec]', '[data-txt-indent-inc]',
  '[data-txt-character-spacing]', '[data-txt-horizontal-scaling]',
];

async function openReport(app, win) {
  const p = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('[data-home-tool="open"]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(400);
}

async function dragOnPage(win, fx, fy, dxPx = 190, dyPx = 60) {
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  // Phase 36 — dodge the floating TextPropertiesPanel card (it covers the left
  // edge of the canvas; a drag starting under it never reaches the page).
  const avoidX = (await textPanelRight(win)) + 30;
  const x = Math.max(40, Math.min(Math.max(pg.x + pg.width * fx, avoidX), vp.w - 240));
  const y = Math.max(pg.y + 20, Math.min(pg.y + pg.height * fy, vp.h - 110));
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dxPx, y + dyPx, { steps: 6 });
  await win.mouse.up();
}

// ---- engine annotation read -------------------------------------------------

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

async function waitForAnn(win, text, pred, timeout = 12000) {
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

// ---- panel read -------------------------------------------------------------

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
      bold: pressed('[data-txt-bold]'),
      italic: pressed('[data-txt-italic]'),
      underline: pressed('[data-txt-underline]'),
      color: q('[data-txt-color]')?.value ?? null,
      highlight: q('[data-txt-highlight]')?.value ?? null,
      align: ['left', 'center', 'right', 'justify'].filter((a) => pressed(`[data-txt-align-${a}`)),
      lineHeight: q('[data-txt-line-height]')?.value ?? null,
      list: ['none', 'bullet', 'number'].filter((l) => pressed(`[data-txt-list-${l}`)),
      indent: q('[data-txt-indent-value]')?.textContent ?? null,
    };
  });
}

async function waitForPanel(win, pred, timeout = 10000) {
  const t0 = Date.now();
  let s = null;
  while (Date.now() - t0 < timeout) {
    s = await panelState(win);
    if (s && pred(s)) return s;
    await win.waitForTimeout(150);
  }
  return s;
}

/** Every panel control's disabled state + whether it carries a title. */
async function controlDisabledMap(win) {
  return win.evaluate((sels) => {
    const p = document.querySelector('.text-props-panel');
    const out = {};
    for (const s of sels) {
      const el = p.querySelector(s);
      out[s] = el === null ? 'MISSING' : { disabled: el.disabled, title: el.getAttribute('title') };
    }
    return out;
  }, ALL_CONTROLS);
}

/** The live committed textbox overlay's computed style. */
async function overlayCss(win, sel = '.ann-textbox[data-kind="textbox"]') {
  return win.evaluate((s) => {
    const box = document.querySelector(s);
    const span = box ? box.querySelector('.ann-text-content') : null;
    if (!box || !span) return null;
    const cs = getComputedStyle(span);
    const bcs = getComputedStyle(box);
    return {
      fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
      textAlign: cs.textAlign, background: cs.backgroundColor,
      boxFontFamily: bcs.fontFamily, boxFontSize: bcs.fontSize, boxTextAlign: bcs.textAlign,
    };
  }, sel);
}

// ---- placement --------------------------------------------------------------

// Phase 26 — the in-canvas textbox/callout/note editors are retired. Text is
// entered through the panel's `[data-txt-text]` field: placement selects the
// new (empty) annotation and focuses the field; typing is live and the session
// commits ONE engine op on blur.
async function fillPanelText(win, text) {
  await win.waitForSelector('[data-txt-text]', { timeout: 8000 });
  await win.waitForFunction(() => {
    const ta = document.querySelector('[data-txt-text]');
    return ta !== null && ta.disabled === false;
  }, null, { timeout: 8000 });
  await win.locator('[data-txt-text]').fill(text);
  await win.locator('[data-txt-text]').blur();
}

async function placeTextbox(win, text, fx = 0.3, fy = 0.22) {
  await armAnnotationTool(win, 'textbox');
  await dragOnPage(win, fx, fy);
  await fillPanelText(win, text);
  await win.waitForSelector('.ann-textbox[data-kind="textbox"]', { timeout: 8000 });
  await waitForAnn(win, text, null, 12000);
  await win.waitForSelector('.text-props-panel', { timeout: 8000 });
  await win.waitForTimeout(300);
}

async function placeCallout(win, text, fx = 0.3, fy = 0.45) {
  await armAnnotationTool(win, 'callout');
  await dragOnPage(win, fx, fy, 190, 60);
  await fillPanelText(win, text);
  await win.waitForSelector('.ann-callout[data-kind="callout"]', { timeout: 8000 });
  await waitForAnn(win, text, null, 12000);
  await win.waitForTimeout(300);
}

async function placeNote(win, text, fx = 0.5, fy = 0.5) {
  await armAnnotationTool(win, 'note');
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 40));
  const y = Math.max(40, Math.min(pg.y + pg.height * fy, vp.h - 110));
  await win.mouse.click(x, y);
  await fillPanelText(win, text);
  await win.waitForSelector('.ann-note[data-kind="note"]', { timeout: 8000 });
  await waitForAnn(win, text, null, 12000);
  await win.waitForTimeout(300);
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

// ===========================================================================
// C1 � every control live on a selected annotation text object; a panel
// change applies immediately to the rendered annotation text.
// ===========================================================================
test('C1 annotation panel fully live + immediate live apply', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await placeTextbox(win, 'P24-LIVE', 0.3, 0.22);

    expect(await win.getAttribute('[data-text-panel]', 'data-text-panel-mode')).toBe('annotation');

    // -- disabled-control map ------------------------------------------------
    const dis = await controlDisabledMap(win);
    const missing = Object.entries(dis).filter(([, v]) => v === 'MISSING').map(([k]) => k);
    const disabled = Object.entries(dis).filter(([, v]) => v !== 'MISSING' && v.disabled).map(([k]) => k);
    log('C1-controls', { missing, disabled });
    expect(missing, 'every text control is mounted for an annotation').toEqual([]);
    // Phase 27 — char spacing is live; only Tz stays engine-disabled and
    // indent-decrement is value-disabled at indent 0 (and only there).
    expect(disabled.filter((s) => !ENGINE_DISABLED.includes(s)), 'only value-disabled controls besides Tz')
      .toEqual(['[data-txt-indent-dec]']);
    expect(dis['[data-txt-character-spacing]'].disabled, 'char spacing live').toBe(false);
    expect(dis['[data-txt-font]'].disabled, 'font live').toBe(false);
    expect(dis['[data-txt-size]'].disabled, 'size live').toBe(false);
    expect(dis['[data-txt-bold]'].disabled, 'bold live').toBe(false);
    expect(dis['[data-txt-highlight]'].disabled, 'highlight live').toBe(false);
    expect(dis['[data-txt-align-right]'].disabled, 'align live').toBe(false);
    // indent-dec becomes live once the indent is non-zero (value-disabled only).
    await win.click('[data-txt-indent-inc]');
    await win.waitForTimeout(250);
    const afterInc = await controlDisabledMap(win);
    expect(afterInc['[data-txt-indent-dec]'].disabled, 'indent-dec live after increment').toBe(false);
    await win.click('[data-txt-indent-dec]');
    await win.waitForTimeout(250);
    await waitForAnn(win, 'P24-LIVE', (a) => !a.style || a.style.indent === undefined || a.style.indent === 0);

    const before = await overlayCss(win);
    log('C1-before', before);

    // -- font -> Times -------------------------------------------------------
    await win.locator('[data-txt-font]').selectOption('Times');
    let a = await waitForAnn(win, 'P24-LIVE', (x) => x.style && x.style.font === 'Times');
    let ps = await waitForPanel(win, (s) => s.font === 'Times');
    let ov = await overlayCss(win);
    log('C1-font', { engine: a.style, panel: ps.font, overlay: ov && ov.fontFamily });
    expect(a.style.font, 'engine stores font=Times').toBe('Times');
    expect(ps.font, 'panel reflects Times').toBe('Times');
    expect(ov.fontFamily, 'rendered overlay uses the Times stack').toContain('Times');

    // -- size -> 18 ----------------------------------------------------------
    // The committed textbox box is auto-sized to the 12pt text, so the DEF-163
    // auto-fit caps an 18pt stored size back to the box height. The stored /
    // panel value is 18; a size BELOW the fit cap is what visibly shrinks.
    await win.locator('[data-txt-size]').fill('18');
    a = await waitForAnn(win, 'P24-LIVE', (x) => x.style && x.style.size === 18);
    ps = await waitForPanel(win, (s) => Number(s.size) === 18);
    ov = await overlayCss(win);
    log('C1-size-18', { engine: a.style.size, panel: ps.size, overlay: ov.fontSize, baseline: before.fontSize, note: 'auto-fit caps the 12pt-sized box' });
    expect(a.style.size, 'engine stores size=18').toBe(18);
    expect(Number(ps.size), 'panel reflects 18').toBe(18);
    expect(parseFloat(ov.fontSize), 'auto-fit never exceeds the stored 18pt').toBeLessThanOrEqual(18 * (parseFloat(before.fontSize) / 12) + 0.5);

    await win.locator('[data-txt-size]').fill('6');
    a = await waitForAnn(win, 'P24-LIVE', (x) => x.style && x.style.size === 6);
    ov = await overlayCss(win);
    log('C1-size-6', { engine: a.style.size, overlay: ov.fontSize, baseline: before.fontSize });
    expect(parseFloat(ov.fontSize), 'a below-cap size visibly shrinks the rendered text')
      .toBeLessThan(parseFloat(before.fontSize));
    await win.locator('[data-txt-size]').fill('18');
    await waitForAnn(win, 'P24-LIVE', (x) => x.style && x.style.size === 18);

    // -- bold ON -------------------------------------------------------------
    await win.click('[data-txt-bold]');
    a = await waitForAnn(win, 'P24-LIVE', (x) => x.style && x.style.bold === true);
    ps = await waitForPanel(win, (s) => s.bold === true);
    ov = await overlayCss(win);
    log('C1-bold', { engine: a.style.bold, panel: ps.bold, overlay: ov.fontWeight });
    expect(a.style.bold, 'engine stores bold=true').toBe(true);
    expect(ps.bold, 'panel reflects bold').toBe(true);
    expect(ov.fontWeight, 'rendered text is bold').toBe('700');

    // -- alignment right -----------------------------------------------------
    await win.click('[data-txt-align-right]');
    a = await waitForAnn(win, 'P24-LIVE', (x) => x.style && x.style.align === 'right');
    ps = await waitForPanel(win, (s) => s.align.includes('right'));
    ov = await overlayCss(win);
    log('C1-align', { engine: a.style.align, panel: ps.align, overlay: ov.textAlign });
    expect(a.style.align, 'engine stores align=right').toBe('right');
    expect(ps.align, 'panel reflects right').toContain('right');
    expect(ov.textAlign, 'rendered text is right-aligned').toBe('right');

    // -- highlight red -------------------------------------------------------
    await win.locator('[data-txt-highlight]').fill('#ff0000');
    a = await waitForAnn(win, 'P24-LIVE', (x) => x.style && x.style.highlight && x.style.highlight.r === 1 && x.style.highlight.g === 0);
    ps = await waitForPanel(win, (s) => s.highlight === '#ff0000');
    ov = await overlayCss(win);
    log('C1-highlight-set', { engine: a.style.highlight, panel: ps.highlight, overlay: ov.background });
    expect(a.style.highlight, 'engine stores a red highlight').toEqual({ r: 1, g: 0, b: 0 });
    expect(ps.highlight, 'panel swatch is red').toBe('#ff0000');
    expect(ov.background, 'rendered text has a red band').toContain('255, 0, 0');
    await win.screenshot({ path: path.join(SHOTS, 'phase24-c1-highlight.png') }).catch(() => {});

    // -- clear the highlight -------------------------------------------------
    await win.click('[data-txt-highlight-clear]');
    a = await waitForAnn(win, 'P24-LIVE', (x) => !x.style || !x.style.highlight);
    ps = await waitForPanel(win, (s) => s.highlight === '#ffffff');
    ov = await overlayCss(win);
    log('C1-highlight-clear', { engine: a.style && a.style.highlight, panel: ps.highlight, overlay: ov.background });
    expect(a.style.highlight ?? null, 'engine highlight removed (null/absent)').toBeNull();
    expect(ov.background, 'rendered band is gone').toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

    await win.screenshot({ path: path.join(SHOTS, 'phase24-c1-live.png') }).catch(() => {});
  } finally {
    await hardClose(app, 'p24-c1');
  }
});

// ===========================================================================
// C2 — style changes survive save + reopen: baked /AP for other viewers and
// TFlex's panel reflects the stored style. Textbox full subset, callout + note
// font + bold.
// ===========================================================================
test('C2 save + reopen round-trip (textbox full, callout/note font+bold)', async () => {
  test.setTimeout(300000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);

    await placeTextbox(win, 'P24-RT', 0.28, 0.16);
    await win.locator('[data-txt-font]').selectOption('Times');
    await win.locator('[data-txt-size]').fill('18');
    await win.click('[data-txt-bold]');
    await win.click('[data-txt-align-right]');
    await waitForAnn(win, 'P24-RT', (a) => a.style && a.style.font === 'Times' && a.style.size === 18 && a.style.bold === true && a.style.align === 'right');

    await placeCallout(win, 'P24-CO', 0.28, 0.42);
    await win.locator('[data-txt-font]').selectOption('Courier');
    await win.click('[data-txt-bold]');
    await waitForAnn(win, 'P24-CO', (a) => a.style && a.style.font === 'Courier' && a.style.bold === true);

    await placeNote(win, 'P24-NT', 0.62, 0.58);
    await win.locator('[data-txt-font]').selectOption('Times');
    await win.click('[data-txt-bold]');
    await waitForAnn(win, 'P24-NT', (a) => a.style && a.style.font === 'Times' && a.style.bold === true);

    const savePath = path.join(os.tmpdir(), `p24-rt-${Date.now()}.pdf`);
    await saveAs(app, win, savePath);
    await closeAndReopen(app, win, savePath);

    const anns = (await annModels(win)) || [];
    const rt = anns.find((a) => a.text === 'P24-RT');
    const co = anns.find((a) => a.text === 'P24-CO');
    const nt = anns.find((a) => a.text === 'P24-NT');
    log('C2-reopened', { rt, co, nt });
    expect(rt && rt.style, 'textbox style survived reopen').toBeTruthy();
    expect(rt.style.font, 'textbox font=Times').toBe('Times');
    expect(rt.style.size, 'textbox size=18').toBe(18);
    expect(rt.style.bold, 'textbox bold=true').toBe(true);
    expect(rt.style.align, 'textbox align=right').toBe('right');
    expect(rt.style.highlight ?? null, 'textbox no highlight').toBeNull();
    expect(co && co.style && co.style.font, 'callout font=Courier').toBe('Courier');
    expect(co.style.bold, 'callout bold=true').toBe(true);
    expect(nt && nt.style && nt.style.font, 'note font=Times').toBe('Times');
    expect(nt.style.bold, 'note bold=true').toBe(true);

    // TFlex's panel reflects the stored style after reopen.
    const selRt = await selectAnnOverlay(win, '.ann-textbox[data-kind="textbox"]');
    await win.screenshot({ path: path.join(SHOTS, 'phase24-reopen.png') }).catch(() => {});
    expect(selRt.active && selRt.panel, 'clicking the reopened textbox selects it and keeps the panel open').toBe(true);
    const pRt = await waitForPanel(win, (s) => s.font === 'Times' && Number(s.size) === 18 && s.bold === true && s.align.includes('right'));
    log('C2-panel-textbox', pRt);
    expect(pRt.mode, 'panel annotation mode after reopen').toBe('annotation');
    expect(pRt.font, 'panel font=Times').toBe('Times');
    expect(Number(pRt.size), 'panel size=18').toBe(18);
    expect(pRt.bold, 'panel bold=true').toBe(true);
    expect(pRt.align, 'panel align=right').toContain('right');
    expect(pRt.highlight, 'panel no highlight').toBe('#ffffff');

    const selCo = await selectAnnOverlay(win, '.ann-callout[data-kind="callout"]');
    expect(selCo.active && selCo.panel, 'clicking the reopened callout keeps the panel open').toBe(true);
    const pCo = await waitForPanel(win, (s) => s.font === 'Courier' && s.bold === true);
    log('C2-panel-callout', pCo);
    expect(pCo.font, 'callout panel font=Courier').toBe('Courier');
    expect(pCo.bold, 'callout panel bold=true').toBe(true);

    const selNt = await selectAnnOverlay(win, '.ann-note[data-kind="note"]');
    expect(selNt.active && selNt.panel, 'clicking the reopened note keeps the panel open').toBe(true);
    const pNt = await waitForPanel(win, (s) => s.font === 'Times' && s.bold === true);
    log('C2-panel-note', pNt);
    expect(pNt.font, 'note panel font=Times').toBe('Times');
    expect(pNt.bold, 'note panel bold=true').toBe(true);
  } finally {
    await hardClose(app, 'p24-c2');
  }
});

// ===========================================================================
// C3 — an existing annotation with NO stored style reopens unchanged.
//
// The task named the bundled report.pdf, but report.pdf (and every bundled
// sample except the form widgets) contains ZERO annotations - verified by
// parsing assets/samples/*.pdf with pdfjs getAnnotations(). The faithful
// pre-Phase-24 artifact is test-fixtures/annot-text-roundtrip-1727.pdf: a real
// 1.7.27 save with FreeText /Contents and a /Helv 12 /DA, no Phase-24 style
// sentinel.
// ===========================================================================
test('C3 legacy annotation (no stored style) keeps the Helvetica appearance', async () => {
  test.setTimeout(240000);
  const legacySrc = path.resolve(__dirname, '..', 'test-fixtures', 'annot-text-roundtrip-1727.pdf');
  expect(fs.existsSync(legacySrc), 'pre-Phase-24 fixture present').toBe(true);
  const legacyPath = path.join(os.tmpdir(), `p24-legacy-${Date.now()}.pdf`);
  fs.copyFileSync(legacySrc, legacyPath);

  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, legacyPath);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(1500);
    await scrollToPage(win, 4);
    await win.waitForSelector('.pdf-page[data-page="4"]', { timeout: 15000 });
    await win.waitForTimeout(800);

    const anns = (await annModels(win)) || [];
    const legacy = anns.filter((a) => a.page === 4 && (a.kind === 'textbox' || a.kind === 'callout'));
    log('C3-annots', legacy);
    expect(legacy.length, 'the pre-Phase-24 fixture has text annotations on page 4').toBeGreaterThan(0);
    const tb = legacy.find((a) => a.text && a.text.includes('VERIFY TB')) ?? legacy[0];
    expect(tb.style ?? null, 'legacy annotation carries NO stored style').toBeNull();

    // The file's own /DA (read from disk) is the pre-Phase-24 Helvetica 12.
    const { PDFDocument, PDFName } = require('@cantoo/pdf-lib');
    const doc = await PDFDocument.load(fs.readFileSync(legacyPath), { ignoreEncryption: true, updateMetadata: false });
    const annots = doc.getPages()[3].node.Annots();
    const da = annots ? annots.asArray().map((ref) => doc.context.lookup(ref)).map((d) => {
      const v = d.get(PDFName.of('DA'));
      return v ? v.toString() : null;
    }).filter(Boolean) : [];
    log('C3-DA', da);
    expect(da.some((s) => s.includes('/Helv') && s.includes('12 Tf')), 'legacy /DA is Helvetica 12').toBe(true);

    const sel = tb.kind === 'textbox'
      ? '.pdf-page[data-page="4"] .ann-textbox[data-kind="textbox"]'
      : '.pdf-page[data-page="4"] .ann-callout[data-kind="callout"]';
    const selState = await selectAnnOverlay(win, sel);
    await win.screenshot({ path: path.join(SHOTS, 'phase24-c3-legacy.png') }).catch(() => {});
    expect(selState.active && selState.panel, 'clicking the legacy annotation opens and keeps the panel').toBe(true);
    const ps = await waitForPanel(win, (s) => s.font === 'Helvetica');
    log('C3-panel', ps);
    expect(ps.mode, 'legacy annotation opens the panel in annotation mode').toBe('annotation');
    expect(ps.font, 'legacy default font is Helvetica').toBe('Helvetica');
    expect(Number(ps.size), 'legacy default size is 12').toBe(12);
    expect(ps.bold, 'legacy default is not bold').toBe(false);
    expect(ps.align, 'legacy default is left').toContain('left');
    expect(ps.highlight, 'legacy default has no highlight band').toBe('#ffffff');
  } finally {
    await hardClose(app, 'p24-c3');
  }
});

// ===========================================================================
// C4 — highlight set -> save/reopen persists; highlight null -> save/reopen
// leaves no band (baked /AP + stored metadata).
// ===========================================================================
test('C4 highlight set/clear persistence across save + reopen', async () => {
  test.setTimeout(300000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await placeTextbox(win, 'P24-HL', 0.3, 0.25);
    await win.locator('[data-txt-highlight]').fill('#ff0000');
    await waitForAnn(win, 'P24-HL', (a) => a.style && a.style.highlight && a.style.highlight.r === 1 && a.style.highlight.g === 0);

    const p1 = path.join(os.tmpdir(), `p24-hl-set-${Date.now()}.pdf`);
    await saveAs(app, win, p1);
    await closeAndReopen(app, win, p1);
    const a1 = await waitForAnn(win, 'P24-HL', null, 20000);
    log('C4-set-reopened', a1 && a1.style);
    expect(a1 && a1.style && a1.style.highlight, 'red highlight persisted through save/reopen').toEqual({ r: 1, g: 0, b: 0 });

    const rel1 = await annRectRel(win, '.ann-textbox[data-kind="textbox"]');
    const s1 = await sampleCanvasPageRect(win, rel1, 1);
    const red1 = redPixels(s1);
    log('C4-set-canvas', { rel1, top: s1 && s1.topColors, red: red1 });
    expect(red1, 'a red band is painted on the reopened canvas').toBeGreaterThan(0);
    await win.screenshot({ path: path.join(SHOTS, 'phase24-c4-highlight-persist.png') }).catch(() => {});

    // Select the reopened annotation and clear the band, then save again.
    const selHl = await selectAnnOverlay(win, '.ann-textbox[data-kind="textbox"]');
    expect(selHl.active && selHl.panel, 'clicking the reopened highlight box opens and keeps the panel').toBe(true);
    await win.click('[data-txt-highlight-clear]');
    await waitForAnn(win, 'P24-HL', (a) => !a.style || !a.style.highlight);

    const p2 = path.join(os.tmpdir(), `p24-hl-clear-${Date.now()}.pdf`);
    await saveAs(app, win, p2);
    await closeAndReopen(app, win, p2);
    const a2 = await waitForAnn(win, 'P24-HL', null, 20000);
    log('C4-clear-reopened', a2 && a2.style);
    expect(a2 && a2.style && a2.style.highlight ? a2.style.highlight : null, 'no highlight survives the cleared save').toBeNull();

    const rel2 = await annRectRel(win, '.ann-textbox[data-kind="textbox"]');
    const s2 = await sampleCanvasPageRect(win, rel2, 1);
    const red2 = redPixels(s2);
    log('C4-clear-canvas', { rel2, top: s2 && s2.topColors, red: red2 });
    expect(red2, 'no red band is painted after the clear').toBe(0);
    await win.screenshot({ path: path.join(SHOTS, 'phase24-c4-highlight-cleared.png') }).catch(() => {});
  } finally {
    await hardClose(app, 'p24-c4');
  }
});

// ---- late helpers (function declarations hoist) -----------------------------

/** Page-relative CSS rect of an overlay element on page 1. */
async function annRectRel(win, sel) {
  return win.evaluate((s) => {
    const page = document.querySelector('.pdf-page[data-page="1"]');
    const box = document.querySelector(s);
    if (!page || !box) return null;
    const pb = page.getBoundingClientRect();
    const bb = box.getBoundingClientRect();
    return { x: bb.left - pb.left, y: bb.top - pb.top, w: bb.width, h: bb.height };
  }, sel);
}

/** Count reddish pixels among the canvas sampler's dominant colours. */
function redPixels(sample) {
  if (!sample || !sample.topColors) return 0;
  return sample.topColors
    .filter((c) => c.rgb[0] > 140 && c.rgb[1] < 90 && c.rgb[2] < 90)
    .reduce((n, c) => n + c.n, 0);
}

/** Click a committed annotation overlay and sample the panel/selection per
 *  animation frame. Returns the settled state + the frame transitions, so a
 *  panel that opens and immediately closes is visible in the evidence. */
async function selectAnnOverlay(win, sel) {
  const loc = win.locator(sel).first();
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const box = await loc.boundingBox();
  await win.evaluate(() => {
    window.__p24frames = [];
    const t0 = performance.now();
    const tick = () => {
      window.__p24frames.push({
        t: Math.round(performance.now() - t0),
        active: !!document.querySelector('.annotation-layer-active'),
        panel: !!document.querySelector('.text-props-panel'),
      });
      if (performance.now() - t0 < 1300) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await win.waitForTimeout(1500);
  const frames = await win.evaluate(() => window.__p24frames);
  const transitions = frames.filter((f, i, arr) => i === 0 || f.active !== arr[i - 1].active || f.panel !== arr[i - 1].panel);
  const state = await win.evaluate(() => ({
    panel: !!document.querySelector('.text-props-panel'),
    active: !!document.querySelector('.annotation-layer-active'),
    mode: document.querySelector('[data-text-panel]')?.getAttribute('data-text-panel-mode') ?? null,
  }));
  log('select-ann', { sel, box: [Math.round(box.x), Math.round(box.y)], transitions, state });
  return { ...state, transitions };
}
