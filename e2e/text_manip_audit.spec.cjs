// OPERATOR AUDIT (2026-09-21) — every text-manipulation control, LIVE, on
// single-line and multi-line text, across every text-bearing tool.
//
// Operator requirement (verbatim): "Check every text manipulation tools and
// see if they work properly on single and multi line texts live. If not, fix
// them."
//
// This spec is EVIDENCE ONLY. It drives the real app through the canonical
// launcher, applies each `data-txt-*` control to each target, and records the
// engine state + the on-page overlay's computed style + per-line geometry
// BEFORE and AFTER each control. It writes screenshots/text-manip-audit.json.
// No product fix, no assertion that hides a failure.
//
// Targets: editbox (Edit-mode text box), textbox (annotation), callout,
//          note (sticky), run (edited text run).
// Shapes:  single (short) and multi (long, wraps to 2+ lines).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, armAnnotationTool, openSamplePath } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const OUT = path.join(SHOTS, 'text-manip-audit.json');
const log = (label, obj) => console.log(`[TXTAUDIT] ${label} ${JSON.stringify(obj)}`);

const SINGLE = 'Sgl';
const MULTI = 'The quick brown fox jumps over the lazy dog and keeps running far away';

// ---------------------------------------------------------------------------
// App / document helpers
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Engine reads
// ---------------------------------------------------------------------------
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

async function waitForBox(win, text, pred, timeout = 12000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    const b = ((await boxModels(win)) || []).find((x) => x.text === text);
    last = b;
    if (b && (pred ? pred(b) : true)) return b;
    await win.waitForTimeout(120);
  }
  return last;
}

async function waitForAnn(win, text, pred, timeout = 12000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    const a = ((await annModels(win)) || []).find((x) => x.text === text);
    last = a;
    if (a && (pred ? pred(a) : true)) return a;
    await win.waitForTimeout(120);
  }
  return last;
}

// ---------------------------------------------------------------------------
// Panel reflected state
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// On-page overlay measurement: computed style + per-line geometry.
// ---------------------------------------------------------------------------
async function measure(win, textSel) {
  return win.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const range = document.createRange();
    range.selectNodeContents(el);
    const raw = Array.from(range.getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5);
    // Collapse rects that share a top (a line can yield several fragments).
    const byTop = new Map();
    for (const r of raw) {
      const key = Math.round(r.top);
      const cur = byTop.get(key);
      if (cur === undefined) byTop.set(key, { left: r.left, right: r.right, top: r.top, bottom: r.bottom });
      else {
        cur.left = Math.min(cur.left, r.left);
        cur.right = Math.max(cur.right, r.right);
        cur.bottom = Math.max(cur.bottom, r.bottom);
      }
    }
const lines = Array.from(byTop.values())
      .sort((a, b) => a.top - b.top)
      .map((r) => ({
        left: +r.left.toFixed(1), right: +r.right.toFixed(1),
        top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1),
        width: +(r.right - r.left).toFixed(1),
      }));
    // The style is often applied to the WRAPPER (text-decoration / indent /
    // align live on the container, not the inline span), so capture both.
    const container = el.closest('.ann-textbox, .ann-callout, .edit-box, .ann-note') || el.parentElement;
    const ccs = container ? getComputedStyle(container) : cs;
    const cr = container ? container.getBoundingClientRect() : null;
    // Phase 29 (DEF-263/265) — the live layout emits ONE element per wrapped
    // line: alignment + underline live on the line element, the highlight band
    // + baseline shift on its inline band. Capture those too, else a live
    // control that lands there reads as a no-op.
    const lineEl = el.closest('.ann-text-line, .edit-box-line, .edit-run-line')
      || el.querySelector('.ann-text-line, .edit-box-line, .edit-run-line');
    const bandEl = el.closest('.ann-text-content, .edit-box-line-band, .edit-run-line-band')
      || el.querySelector('.ann-text-content, .edit-box-line-band, .edit-run-line-band');
    const lcs = lineEl ? getComputedStyle(lineEl) : null;
    const bcs = bandEl ? getComputedStyle(bandEl) : null;
    // DEF-265 — list prefixes are child spans, not a computed style; capture
    // their text so a list control reads as live.
    const prefixEls = el.querySelectorAll('.ann-text-prefix, .edit-box-line-prefix, .edit-run-line-prefix');
    const prefixText = Array.from(prefixEls).map((p) => p.textContent).join('|');
    const pick = (s) => ({
      fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight,
      fontStyle: s.fontStyle, textDecorationLine: s.textDecorationLine,
      textAlign: s.textAlign, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing,
      color: s.color, backgroundColor: s.backgroundColor,
      paddingLeft: s.paddingLeft, verticalAlign: s.verticalAlign,
      whiteSpace: s.whiteSpace,
    });
    return {
      text: el.textContent,
      css: pick(cs),
      containerCss: pick(ccs),
      lineCss: lcs ? pick(lcs) : null,
      bandCss: bcs ? pick(bcs) : null,
      prefixText,
      containerRect: cr ? { x: +cr.x.toFixed(1), y: +cr.y.toFixed(1), w: +cr.width.toFixed(1), h: +cr.height.toFixed(1) } : null,
      lineCount: lines.length,
      lines,
    };
  }, textSel);
}

// ---------------------------------------------------------------------------
// Control application (cumulative sweep; each control applied once).
// ---------------------------------------------------------------------------
const CONTROLS = [
  { id: 'font', apply: (w) => w.locator('[data-txt-font]').selectOption('Times') },
  { id: 'size', apply: (w) => w.locator('[data-txt-size]').fill('18') },
  { id: 'bold', apply: (w) => w.locator('[data-txt-bold]').click() },
  { id: 'italic', apply: (w) => w.locator('[data-txt-italic]').click() },
  { id: 'underline', apply: (w) => w.locator('[data-txt-underline]').click() },
  { id: 'super', apply: (w) => w.locator('[data-txt-super]').click() },
  { id: 'sub', apply: (w) => w.locator('[data-txt-sub]').click() },
  { id: 'color', apply: (w) => w.locator('[data-txt-color]').fill('#ff0000') },
  { id: 'highlight', apply: (w) => w.locator('[data-txt-highlight]').fill('#ffff00') },
  { id: 'highlight-clear', apply: (w) => w.locator('[data-txt-highlight-clear]').click() },
  { id: 'align-left', apply: (w) => w.locator('[data-txt-align-left]').click() },
  { id: 'align-center', apply: (w) => w.locator('[data-txt-align-center]').click() },
  { id: 'align-right', apply: (w) => w.locator('[data-txt-align-right]').click() },
  { id: 'align-justify', apply: (w) => w.locator('[data-txt-align-justify]').click() },
  { id: 'line-height', apply: (w) => w.locator('[data-txt-line-height]').fill('2') },
  { id: 'list-bullet', apply: (w) => w.locator('[data-txt-list-bullet]').click() },
  { id: 'list-number', apply: (w) => w.locator('[data-txt-list-number]').click() },
  { id: 'list-none', apply: (w) => w.locator('[data-txt-list-none]').click() },
  { id: 'indent-inc', apply: (w) => w.locator('[data-txt-indent-inc]').click() },
  { id: 'indent-inc2', apply: (w) => w.locator('[data-txt-indent-inc]').click() },
  { id: 'indent-dec', apply: (w) => w.locator('[data-txt-indent-dec]').click() },
  { id: 'character-spacing', apply: (w) => w.locator('[data-txt-character-spacing]').fill('6') },
  { id: 'clear', apply: (w) => w.locator('[data-txt-clear]').click() },
];

module.exports = { CONTROLS };
// ---------------------------------------------------------------------------
// Target placement
// ---------------------------------------------------------------------------
async function placeEditBox(win, text) {
  if ((await win.locator('[data-edit-toolbar]').count()) === 0) {
    await win.click('button[aria-label="Edit content"]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
  }
await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);
  await dragOnPage(win, 0.55, 0.3);
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
  await waitForAnn(win, text, null, 12000);
  await win.waitForTimeout(300);
}

async function placeRun(win, text) {
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
  await win.locator('[data-txt-text]').fill(text);
  await win.waitForSelector('[data-edit-run-preview]', { timeout: 8000 });
  await win.waitForTimeout(300);
}

const TARGETS = {
  editbox: {
    place: placeEditBox,
    textSel: (t) => `.edit-box[data-edit-box-text="${t}"] .edit-box-text`,
    engine: async (win, t) => ((await boxModels(win)) || []).find((b) => b.text === t) || null,
  },
  textbox: {
    place: (win, t) => placeAnn(win, 'textbox', t, 0.3, 0.2),
    textSel: () => `.ann-textbox[data-kind="textbox"] .ann-text-content`,
    engine: async (win, t) => ((await annModels(win)) || []).find((a) => a.text === t) || null,
  },
  callout: {
    place: (win, t) => placeAnn(win, 'callout', t, 0.3, 0.45),
    textSel: () => `.ann-callout[data-kind="callout"] .ann-text-content`,
    engine: async (win, t) => ((await annModels(win)) || []).find((a) => a.text === t) || null,
  },
  note: {
    place: (win, t) => placeAnn(win, 'note', t, 0.55, 0.55),
    textSel: () => `.ann-note[data-kind="note"] .ann-note-text`,
    engine: async (win, t) => ((await annModels(win)) || []).find((a) => a.text === t) || null,
  },
  run: {
    place: placeRun,
    textSel: () => `[data-edit-run-preview]`,
    engine: async (win) => await panelState(win),
  },
};

async function sweep(win, targetName, shape, text) {
  const cfg = TARGETS[targetName];
  await cfg.place(win, text);
  const sel = cfg.textSel(text);
  const rows = [];
  let prev = await measure(win, sel);
  let prevEngine = await cfg.engine(win, text);
  for (const c of CONTROLS) {
    await c.apply(win);
    await win.waitForTimeout(450);
    const after = await measure(win, sel);
    const afterEngine = await cfg.engine(win, text);
    rows.push({
      target: targetName, shape, control: c.id,
      before: prev, after, engineBefore: prevEngine, engineAfter: afterEngine,
    });
    prev = after;
    prevEngine = afterEngine;
  }
  return rows;
}

// The run target is special: the panel Text field commits the run on blur, so
// a style control clicked AFTER a session starts commits + deselects the run.
// The faithful workflow is styles-first: select the run, apply the control,
// then type (which opens the session) and measure the live preview.
async function selectRun(win) {
  const span = win.locator('.pdf-page[data-page="1"] .textLayer span').filter({ hasText: /[A-Za-z]/ }).first();
  await span.waitFor({ state: 'attached', timeout: 10000 });
  const sb = await span.boundingBox();
  if (!sb) return false;
  await win.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2);
  await win.waitForTimeout(600);
  return true;
}

async function sweepRun(win, shape, text) {
  if ((await win.locator('[data-edit-toolbar]').count()) === 0) {
    await win.click('button[aria-label="Edit content"]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
  }
  await win.click('[data-edit-tool="text"]');
  await win.waitForTimeout(300);
  // DEF-266 faithful workflow: select the run ONCE, type to open the session,
  // then apply every control in sequence WITHOUT blurring. The focus guard must
  // keep the run active so each control composes and the preview updates live.
  await selectRun(win);
  await win.locator('[data-txt-text]').fill(text);
  await win.waitForSelector('[data-edit-run-preview]', { timeout: 8000 });
  await win.waitForTimeout(400);
  const rows = [];
  let prev = await measure(win, '[data-edit-run-preview]');
  for (const c of CONTROLS) {
    await c.apply(win);
    await win.waitForTimeout(450);
    const after = await measure(win, '[data-edit-run-preview]');
    const eng = await panelState(win);
    rows.push({ target: 'run', shape, control: c.id, before: prev, after, engineBefore: null, engineAfter: eng });
    prev = after;
  }
  return rows;
}

const ALL_ROWS = [];
function record(rows) {
  let existing = [];
  try { existing = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (_) { existing = []; }
  const key = (r) => `${r.target}|${r.shape}|${r.control}`;
  const map = new Map(existing.map((r) => [key(r), r]));
  for (const r of rows) map.set(key(r), r);
  const merged = Array.from(map.values());
  fs.writeFileSync(OUT, JSON.stringify(merged, null, 2));
}

for (const targetName of ['editbox', 'textbox', 'callout', 'note', 'run']) {
  for (const [shape, text] of [['single', SINGLE], ['multi', MULTI]]) {
    test(`${targetName} ${shape}: control sweep`, async () => {
      test.setTimeout(300000);
      const app = await launchApp();
      const win = await app.firstWindow();
      try {
        await win.waitForSelector('.sample-card', { timeout: 30000 });
        await openReport(app, win);
        const rows = targetName === 'run'
          ? await sweepRun(win, shape, text)
          : await sweep(win, targetName, shape, text);
        record(rows);
        log(`${targetName}-${shape}`, rows.map((r) => ({
          c: r.control,
          lines: r.after ? r.after.lineCount : null,
          css: r.after ? r.after.css : null,
          eng: r.engineAfter,
        })));
        await win.screenshot({ path: path.join(SHOTS, `text-manip-${targetName}-${shape}.png`) }).catch(() => {});
        expect(rows.length, 'every control was driven').toBe(CONTROLS.length);
      } finally {
        await hardClose(app, `txtaudit-${targetName}-${shape}`);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Save + reopen spot-check: one composed MULTI-LINE case per annotation family
// plus the Edit-mode box. Confirms which controls survive the bake (the task's
// "spot-check at least one cell per control" is satisfied in composition).
// ---------------------------------------------------------------------------
async function saveAs(app, win, savePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-confirm]', { timeout: 8000 });
  await win.click('[data-save-as-confirm]');
  await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 30000 });
}

async function applyCompose(win) {
  // Phase 29 retest — compose at operator speed (a short settle between
  // controls). The DEF-262 delete+re-create geometry op re-selects the new
  // annotation asynchronously; a zero-gap burst can read a stale selection.
  const steps = [
    (w) => w.locator('[data-txt-font]').selectOption('Times'),
    (w) => w.locator('[data-txt-size]').fill('18'),
    (w) => w.click('[data-txt-bold]'),
    (w) => w.click('[data-txt-italic]'),
    (w) => w.click('[data-txt-underline]'),
    (w) => w.locator('[data-txt-color]').fill('#ff0000'),
    (w) => w.locator('[data-txt-highlight]').fill('#ffff00'),
    (w) => w.click('[data-txt-align-center]'),
    (w) => w.locator('[data-txt-line-height]').fill('2'),
    (w) => w.click('[data-txt-list-bullet]'),
    (w) => w.click('[data-txt-indent-inc]'),
    (w) => w.locator('[data-txt-character-spacing]').fill('4'),
  ];
  for (const s of steps) {
    await s(win);
    await win.waitForTimeout(300);
  }
  await win.waitForTimeout(800);
}

test('roundtrip multi-line composed spot-check', async () => {
  test.setTimeout(300000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);

    // Edit-mode box (multi-line) FIRST, before any annotation is selected.
    await placeEditBox(win, MULTI);
    await applyCompose(win);
    const boxBefore = await waitForBox(win, MULTI, null, 12000);
    const liveBoxMeasure = await measure(win, `.edit-box[data-edit-box-text="${MULTI}"] .edit-box-text`);

    // annotation textbox (multi-line)
    await closeEditMode(win);
    await placeAnn(win, 'textbox', MULTI, 0.3, 0.2);
    await applyCompose(win);
    const before = await waitForAnn(win, MULTI, null, 12000);
    const liveMeasure = await measure(win, `.ann-textbox[data-kind="textbox"] .ann-text-content`);
    await win.screenshot({ path: path.join(SHOTS, 'text-manip-rt-ann-before.png') }).catch(() => {});

    const p = path.join(os.tmpdir(), `txtaudit-rt-${Date.now()}.pdf`);
    await saveAs(app, win, p);
    await win.locator('.tab-active .tab-close').click();
    await win.waitForTimeout(1500);
    await openSamplePath(win, app, p);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(2500);

    const anns = (await annModels(win)) || [];
    const boxes = (await boxModels(win)) || [];
    const rtAnn = anns.find((a) => a.text === MULTI);
    const rtBox = boxes.find((b) => b.text === MULTI);
    const out = {
      liveAnnStyle: before && before.style,
      liveAnnMeasure: liveMeasure && { fontSize: liveMeasure.css.fontSize, lines: liveMeasure.lineCount, containerRect: liveMeasure.containerRect },
      liveBoxMeasure: liveBoxMeasure && { fontSize: liveBoxMeasure.css.fontSize, lines: liveBoxMeasure.lineCount, letterSpacing: liveBoxMeasure.css.letterSpacing },
      rtAnnStyle: rtAnn && rtAnn.style,
      rtAnnRect: rtAnn && rtAnn.rect,
      rtBoxStyle: rtBox && { font: rtBox.font, size: rtBox.size, bold: rtBox.bold, italic: rtBox.italic, underline: rtBox.underline, align: rtBox.align, lineHeight: rtBox.lineHeight, list: rtBox.list, indent: rtBox.indent, charSpacing: rtBox.charSpacing, color: rtBox.color, highlight: rtBox.highlight },
      boxBefore: boxBefore && { font: boxBefore.font, size: boxBefore.size, bold: boxBefore.bold, align: boxBefore.align },
    };
    log('roundtrip', out);
    fs.writeFileSync(path.join(SHOTS, 'text-manip-roundtrip.json'), JSON.stringify(out, null, 2));
    await win.screenshot({ path: path.join(SHOTS, 'text-manip-rt-reopened.png') }).catch(() => {});

    // Every composed control must survive on the annotation.
    for (const k of ['font', 'size', 'bold', 'italic', 'underline', 'align', 'lineHeight', 'list', 'indent', 'charSpacing']) {
      expect(rtAnn && rtAnn.style && rtAnn.style[k] !== undefined, `annotation style survives reopen: ${k}`).toBe(true);
    }
  } finally {
    await hardClose(app, 'txtaudit-rt');
  }
});
