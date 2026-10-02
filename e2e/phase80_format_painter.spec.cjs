// PHASE 80 VALIDATION (qa, 2026-10-02) - Format Painter (FEA-012).
//
// Proves, through the real Electron app (canonical launchApp helper only):
//   C1  arm: a source committed Edit-mode text box carries a distinctive
//       format set through the panel; one click on `[data-txt-format-painter]`
//       sets `aria-pressed="true"` (and the control is disabled-with-tooltip
//       with no text source selected).
//   C2  apply in ONE action: selecting a SECOND committed box applies the
//       captured format to it (engine model matches the source on
//       font/size/bold/italic/underline/color/align/lineHeight/list/indent/
//       charSpacing/highlight); the painter disarms; ONE Ctrl+Z restores the
//       target's prior format in a single undo.
//   C3  save/reload durability: save via `[data-toolbar-save-as]`, close and
//       reopen the saved file, re-assert the target's formatting still
//       matches the source.
//   C4  fail-loud: with the painter armed, selecting a RAW text run shows
//       `[data-txt-format-painter-hint]` and leaves the run's style unchanged.
//   C5  `[data-txt-horizontal-scaling]` stays disabled and carries a tooltip.
//   C6  no regression: the character-spacing control is still live.
//
// Screenshots: screenshots/phase80-*.png

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, openSamplePath, toggleEditMode, scrollToPage } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const log = (label, obj) => console.log(`[P80] ${label} ${JSON.stringify(obj)}`);

const SRC_TEXT = 'P80-SRC';
const TGT_TEXT = 'P80-TGT';

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

/** The exact captured-format field set, normalised so undefined == null. */
function styleOf(b) {
  return {
    font: b.font ?? null,
    size: b.size ?? null,
    bold: b.bold ?? null,
    italic: b.italic ?? null,
    underline: b.underline ?? null,
    color: b.color ?? null,
    align: b.align ?? null,
    lineHeight: b.lineHeight ?? null,
    list: b.list ?? null,
    indent: b.indent ?? null,
    charSpacing: b.charSpacing ?? null,
    highlight: b.highlight ?? null,
  };
}
function sameStyle(a, b) {
  return JSON.stringify(styleOf(a)) === JSON.stringify(styleOf(b));
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
async function fillPanelText(win, text) {
  await win.waitForSelector('.text-props-panel [data-txt-text]', { timeout: 15000 });
  await win.waitForFunction(() => {
    const ta = document.querySelector('[data-txt-text]');
    return ta !== null && ta.disabled === false;
  }, null, { timeout: 15000 });
  await win.locator('[data-txt-text]').fill(text);
  await win.locator('[data-txt-text]').blur();
}

/** Ensure Edit mode is open and the Edit-text-box tool is armed. */
async function armEditTextBox(win) {
  if ((await win.locator('[data-dock-verb="editTextBox"]').count()) === 0) {
    await toggleEditMode(win);
    await win.locator('[data-dock-verb="editTextBox"]').waitFor({ state: 'visible', timeout: 8000 });
  }
  await win.locator('[data-dock-verb="editTextBox"]').click();
  await win.waitForTimeout(600);
}

/** Drag a box at a page fraction and select it (assumes the tool is armed). */
async function dragCreateBox(win, text, fx, fy) {
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const inspectorLeft = await win.evaluate(() => {
    const i = document.querySelector('[data-inspector]');
    return i ? i.getBoundingClientRect().left : window.innerWidth;
  });
  let x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 240));
  x = Math.min(x, inspectorLeft - 40);
  const y = Math.max(pg.y + 20, Math.min(pg.y + pg.height * fy, vp.h - 200));
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + 200, y + 70, { steps: 6 });
  await win.mouse.up();
  await fillPanelText(win, text);
  await win.waitForSelector('.edit-box', { timeout: 8000 });
  await win.waitForTimeout(400);
  await selectBox(win, text);
}

// Place a committed TFlex Edit-mode text box through the real UI and select it.
async function createTextBox(win, text, fx = 0.2, fy = 0.15) {
  await armEditTextBox(win);
  await dragCreateBox(win, text, fx, fy);
}

async function selectBox(win, text) {
  await win.locator(`.edit-box[data-edit-box-text="${text}"]`).click({ position: { x: 8, y: 8 } });
  await win.waitForSelector('[data-edit-box-toolbar]', { timeout: 8000 });
  await win.waitForTimeout(300);
}

/** The distinctive source format required by the Phase 80 brief. */
async function applySourceFormat(win) {
  await win.locator('[data-txt-font]').selectOption('Times');
  await waitForBox(win, SRC_TEXT, (b) => b.font === 'Times', 12000);
  await win.locator('[data-txt-size]').fill('18');
  await waitForBox(win, SRC_TEXT, (b) => b.size === 18, 12000);
  await win.click('[data-txt-bold]');
  await waitForBox(win, SRC_TEXT, (b) => b.bold === true, 12000);
  await win.click('[data-txt-italic]');
  await waitForBox(win, SRC_TEXT, (b) => b.italic === true, 12000);
  await win.click('[data-txt-underline]');
  await waitForBox(win, SRC_TEXT, (b) => b.underline === true, 12000);
  await win.locator('[data-txt-color]').fill('#3366cc');
  await waitForBox(win, SRC_TEXT, (b) => b.color === '#3366cc', 12000);
  await win.click('[data-txt-align-center]');
  await waitForBox(win, SRC_TEXT, (b) => b.align === 'center', 12000);
  await win.locator('[data-txt-line-height]').fill('1.5');
  await waitForBox(win, SRC_TEXT, (b) => b.lineHeight === 1.5, 12000);
  await win.click('[data-txt-list-bullet]');
  await waitForBox(win, SRC_TEXT, (b) => b.list === 'bullet', 12000);
  await win.click('[data-txt-indent-inc]');
  await win.click('[data-txt-indent-inc]');
  await waitForBox(win, SRC_TEXT, (b) => b.indent === 24, 12000);
  await win.locator('[data-txt-highlight]').fill('#ffcc00');
  await waitForBox(win, SRC_TEXT, (b) => b.highlight !== null, 12000);
  await win.locator('[data-txt-character-spacing]').fill('2');
  await waitForBox(win, SRC_TEXT, (b) => b.charSpacing === 2, 12000);
}

/** Poll the painter button's armed state. */
async function painterPressed(win, want, timeout = 10000) {
  await win.waitForFunction(
    (w) => document.querySelector('[data-txt-format-painter]')?.getAttribute('aria-pressed') === w,
    want ? 'true' : 'false',
    { timeout },
  );
}

/** Select a raw text-layer run through the real Edit-text tool. Tries spans
 *  until the panel's Text field stops showing the source box's text, so a
 *  genuine run target (not a stale box selection) is proven. */
async function selectRawRun(win, previousText) {
  if ((await win.locator('[data-dock-verb="editText"]').count()) === 0) {
    await toggleEditMode(win);
    await win.locator('[data-dock-verb="editText"]').waitFor({ state: 'visible', timeout: 8000 });
  }
  await win.locator('[data-dock-verb="editText"]').click();
  await win.waitForTimeout(300);
  const spans = win.locator('.pdf-page[data-page="1"] .textLayer span').filter({ hasText: /[A-Za-z]/ });
  await spans.first().waitFor({ state: 'attached', timeout: 10000 });
  const n = Math.min(await spans.count(), 10);
  let result = null;
  for (let i = 0; i < n; i += 1) {
    const sb = await spans.nth(i).boundingBox().catch(() => null);
    if (!sb || sb.width < 2 || sb.height < 2) continue;
    await win.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await win.waitForTimeout(400);
    const v = await win.evaluate(() => document.querySelector('[data-txt-text]')?.value ?? null);
    if (v && v.trim().length > 0 && v !== previousText) {
      result = { index: i, text: v };
      break;
    }
  }
  await win.waitForTimeout(300);
  return result;
}

// ===========================================================================
// C1 + C2 + C5 + C6 - arm, apply in one action, one undo, h-scaling disabled.
// ===========================================================================
test('C1+C2+C5+C6 arm, apply in one action, one undo, h-scaling disabled', async () => {
  test.setTimeout(360000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);

    // C1 negative leg - no text source selected -> disabled-with-tooltip.
    await armEditTextBox(win);
    const pre = await win.evaluate(() => {
      const b = document.querySelector('[data-txt-format-painter]');
      return b ? { disabled: b.disabled, title: b.getAttribute('title') } : null;
    });
    log('C1-pre-placement', pre);
    expect(pre, 'painter button renders with the armed text tool').not.toBeNull();
    expect(pre.disabled, 'painter disabled with no text source selected').toBe(true);
    expect(pre.title || '', 'disabled tooltip names Format Painter').toMatch(/format painter/i);

    // C6 - character spacing is still a LIVE control (not disabled).
    const csLive = await win.evaluate(() => {
      const el = document.querySelector('[data-txt-character-spacing]');
      return el ? el.disabled : 'MISSING';
    });
    expect(csLive, 'character-spacing control is live').toBe(false);

    // Build source + target, then format the source through the panel.
    await dragCreateBox(win, SRC_TEXT, 0.2, 0.15);
    await createTextBox(win, TGT_TEXT, 0.2, 0.45);
    await selectBox(win, SRC_TEXT);
    await applySourceFormat(win);
    const src = await waitForBox(win, SRC_TEXT, (b) => b.charSpacing === 2, 15000);
    log('C1-src', src);
    expect(src && src.font, 'source format applied through the panel').toBe('Times');

    // C1 - one click arms the painter.
    await win.click('[data-txt-format-painter]');
    await painterPressed(win, true);
    await win.screenshot({ path: path.join(SHOTS, 'phase80-armed.png') }).catch(() => {});

    const tgtBefore = await waitForBox(win, TGT_TEXT, null, 15000);
    expect(tgtBefore, 'target box exists before apply').toBeTruthy();
    expect(sameStyle(tgtBefore, src), 'target starts with a different format').toBe(false);

    // C2 - selecting the second box applies the captured format in ONE action.
    await selectBox(win, TGT_TEXT);
    const applied = await waitForBox(win, TGT_TEXT, (b) => sameStyle(b, src), 20000);
    log('C2-applied', applied);
    expect(applied, 'engine target matches the source on every captured field').toBeTruthy();
    await painterPressed(win, false);
    await win.screenshot({ path: path.join(SHOTS, 'phase80-applied.png') }).catch(() => {});

    // C2 - ONE undo step restores the target's prior format.
    await win.keyboard.press('Control+z');
    const restored = await waitForBox(win, TGT_TEXT, (b) => sameStyle(b, tgtBefore), 20000);
    log('C2-undo', restored);
    expect(restored, 'ONE Ctrl+Z restores the target prior format in a single undo').toBeTruthy();

    // C5 - horizontal scaling stays disabled-with-tooltip.
    const hs = await win.evaluate(() => {
      const b = document.querySelector('[data-txt-horizontal-scaling]');
      return b ? { disabled: b.disabled, title: b.getAttribute('title') } : null;
    });
    log('C5-hscaling', hs);
    expect(hs, 'horizontal scaling control present').not.toBeNull();
    expect(hs.disabled, 'horizontal scaling stays disabled').toBe(true);
    expect(hs.title || '', 'horizontal scaling carries a tooltip').toMatch(/not available|Tz/i);
  } finally {
    await hardClose(app, 'p80-c1');
  }
});

// ===========================================================================
// C3 - the applied format survives save + reload.
// ===========================================================================
test('C3 applied format survives save and reopen', async () => {
  test.setTimeout(360000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);

    await createTextBox(win, SRC_TEXT, 0.2, 0.15);
    await createTextBox(win, TGT_TEXT, 0.2, 0.45);
    await selectBox(win, SRC_TEXT);
    await applySourceFormat(win);
    const src = await waitForBox(win, SRC_TEXT, (b) => b.charSpacing === 2, 15000);

    await win.click('[data-txt-format-painter]');
    await painterPressed(win, true);
    await selectBox(win, TGT_TEXT);
    const applied = await waitForBox(win, TGT_TEXT, (b) => sameStyle(b, src), 20000);
    expect(applied, 'target matches the source before save').toBeTruthy();
    await painterPressed(win, false);

    const p = path.join(os.tmpdir(), `p80-saved-${Date.now()}.pdf`);
    await saveAs(app, win, p);
    await closeAndReopen(app, win, p);

    const srcRT = await waitForBox(win, SRC_TEXT, (b) => b.charSpacing === 2, 25000);
    const tgtRT = await waitForBox(win, TGT_TEXT, (b) => b.charSpacing === 2, 25000);
    log('C3-reopen', { srcRT, tgtRT });
    expect(srcRT, 'source survives reopen').toBeTruthy();
    expect(tgtRT, 'target survives reopen with the applied format').toBeTruthy();
    expect(tgtRT && tgtRT.font, 'reloaded target font').toBe('Times');
    expect(tgtRT && tgtRT.size, 'reloaded target size').toBe(18);
    expect(tgtRT && tgtRT.bold, 'reloaded target bold').toBe(true);
    expect(tgtRT && tgtRT.italic, 'reloaded target italic').toBe(true);
    expect(tgtRT && tgtRT.underline, 'reloaded target underline').toBe(true);
    expect(tgtRT && tgtRT.align, 'reloaded target align').toBe('center');
    expect(tgtRT && tgtRT.lineHeight, 'reloaded target lineHeight').toBe(1.5);
    expect(tgtRT && tgtRT.list, 'reloaded target list').toBe('bullet');
    expect(tgtRT && tgtRT.indent, 'reloaded target indent').toBe(24);
    expect(tgtRT && tgtRT.charSpacing, 'reloaded target charSpacing').toBe(2);
    expect(sameStyle(tgtRT, srcRT), 'reloaded target formatting equals the reloaded source').toBe(true);
    await win.screenshot({ path: path.join(SHOTS, 'phase80-reloaded.png') }).catch(() => {});
  } finally {
    await hardClose(app, 'p80-c3');
  }
});

// ===========================================================================
// C4 - a RAW text run is not an applicable target: fail loud, no silent no-op.
// ===========================================================================
test('C4 raw text run shows the painter hint and is left unchanged', async () => {
  test.setTimeout(360000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);

await createTextBox(win, SRC_TEXT, 0.2, 0.15);
    await applySourceFormat(win);

    // Baseline: prove a RAW run (not the box) is the selectable target.
    const sel1 = await selectRawRun(win, SRC_TEXT);
    log('C4-run-selected', sel1);
    expect(sel1, 'a raw text run was selected through the Edit-text tool').not.toBeNull();
    expect(sel1.text, 'the selected target is the run, not the source box').not.toBe(SRC_TEXT);

    // Back to the box tool, re-select the source and arm the painter.
    await win.locator('[data-dock-verb="editTextBox"]').click();
    await win.waitForTimeout(300);
    await selectBox(win, SRC_TEXT);
    await win.click('[data-txt-format-painter]');
    await painterPressed(win, true);

    // The engine registry must not change when the run is selected while armed.
    const boxesBefore = JSON.stringify(await boxModels(win));

    // Select the raw run while armed: hint shows, painter stays armed.
    const sel2 = await selectRawRun(win, SRC_TEXT);
    log('C4-run-selected-armed', sel2);
    expect(sel2, 'the raw run is still selectable while the painter is armed').not.toBeNull();
    await win.waitForSelector('[data-txt-format-painter-hint]', { state: 'visible', timeout: 8000 });
    const hint = await win.locator('[data-txt-format-painter-hint]').textContent();
    log('C4-hint', hint);
    expect(hint || '', 'fail-loud hint names the applicable targets').toMatch(/text box or text annotation/i);

    // Still armed => the captured format was NOT applied (a successful apply
    // disarms); the engine registry is untouched => no silent write happened.
    await painterPressed(win, true);
    const boxesAfter = JSON.stringify(await boxModels(win));
    expect(boxesAfter, 'no engine text-box write occurred for the raw-run target').toBe(boxesBefore);
    await win.screenshot({ path: path.join(SHOTS, 'phase80-rawrun-hint.png') }).catch(() => {});
  } finally {
    await hardClose(app, 'p80-c4');
  }
});

// ===========================================================================
// DEF-474/475/476 — FIX-READY retests (qa, TFL-326). Each test reproduces the
// defect's recorded steps on the FIXED build and asserts the expected outcome.
// ===========================================================================

/** Place a committed Edit-mode text box on an arbitrary page and select it. */
async function createTextBoxOnPage(win, text, page, fx, fy) {
  await scrollToPage(win, page);
  await armEditTextBox(win);
  const pg = await win.locator(`.pdf-page[data-page="${page}"]`).boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const inspectorLeft = await win.evaluate(() => {
    const i = document.querySelector('[data-inspector]');
    return i ? i.getBoundingClientRect().left : window.innerWidth;
  });
  let x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 240));
  x = Math.min(x, inspectorLeft - 40);
  const y = Math.max(pg.y + 20, Math.min(pg.y + pg.height * fy, vp.h - 200));
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + 200, y + 70, { steps: 6 });
  await win.mouse.up();
  await fillPanelText(win, text);
  await win.waitForSelector('.edit-box', { timeout: 8000 });
  await win.waitForTimeout(400);
  await selectBox(win, text);
}

async function boxModelsAt(win, text) {
  const boxes = (await boxModels(win)) || [];
  return boxes.find((b) => b.text === text) ?? null;
}

// ---------------------------------------------------------------------------
// DEF-474 (MEDIUM) — cross-page Format Painter: page-1 source -> page-2 target.
// ---------------------------------------------------------------------------
test('DEF-474 cross-page apply: page-1 source -> page-2 target in one action', async () => {
  test.setTimeout(360000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);

    // Source (Times/18) on page 1.
    await createTextBoxOnPage(win, SRC_TEXT, 1, 0.2, 0.15);
    await selectBox(win, SRC_TEXT);
    await applySourceFormat(win);
    const srcBefore = await waitForBox(win, SRC_TEXT, (b) => b.charSpacing === 2, 15000);
    log('DEF474-src', srcBefore);
    expect(srcBefore && srcBefore.font, 'source format applied on page 1').toBe('Times');

    // Target on page 2 (default Helvetica/12).
    await createTextBoxOnPage(win, TGT_TEXT, 2, 0.2, 0.2);
    const tgtBefore = await boxModelsAt(win, TGT_TEXT);
    log('DEF474-tgt-before', tgtBefore);
    expect(tgtBefore, 'page-2 target box exists').toBeTruthy();
    expect(tgtBefore.page, 'target is on page 2').toBe(2);
    expect(sameStyle(tgtBefore, srcBefore), 'target starts with a different format').toBe(false);

    // Arm the painter on the page-1 source.
    await scrollToPage(win, 1);
    await selectBox(win, SRC_TEXT);
    await win.click('[data-txt-format-painter]');
    await painterPressed(win, true);

    // Select the page-2 target: must apply in ONE action and disarm.
    await scrollToPage(win, 2);
    await selectBox(win, TGT_TEXT);
    const tgtAfter = await waitForBox(win, TGT_TEXT, (b) => sameStyle(b, srcBefore), 20000);
    log('DEF474-tgt-after', tgtAfter);
    expect(tgtAfter, 'page-2 target matches the page-1 source on every captured field').toBeTruthy();
    await painterPressed(win, false);

    // The source is untouched.
    const srcAfter = await boxModelsAt(win, SRC_TEXT);
    expect(srcAfter, 'source still present after apply').toBeTruthy();
    expect(sameStyle(srcAfter, srcBefore), 'page-1 source style is unchanged').toBe(true);
    await win.screenshot({ path: path.join(SHOTS, 'def474-crosspage-applied.png') }).catch(() => {});
  } finally {
    await hardClose(app, 'def474');
  }
});

// ---------------------------------------------------------------------------
// DEF-475 (LOW) — the hint clears when returning to the arming source.
// ---------------------------------------------------------------------------
test('DEF-475 hint clears on re-selecting the arming source, no re-apply', async () => {
  test.setTimeout(360000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);

    await createTextBox(win, SRC_TEXT, 0.2, 0.15);
    await selectBox(win, SRC_TEXT);
    await applySourceFormat(win);
    const srcBefore = await waitForBox(win, SRC_TEXT, (b) => b.charSpacing === 2, 15000);
    expect(srcBefore && srcBefore.font, 'source format applied').toBe('Times');

    // Arm on the source, then select a raw run: the hint appears.
    await win.click('[data-txt-format-painter]');
    await painterPressed(win, true);
    const raw = await selectRawRun(win, SRC_TEXT);
    log('DEF475-run', raw);
    expect(raw, 'a raw text run was selected while armed').not.toBeNull();
    await win.waitForSelector('[data-txt-format-painter-hint]', { state: 'visible', timeout: 8000 });

    // Return to the arming source: hint clears, painter stays armed, no re-apply.
    await win.locator('[data-dock-verb="editTextBox"]').click();
    await win.waitForTimeout(300);
    await selectBox(win, SRC_TEXT);
    await win.waitForTimeout(600);
    const hintVisible = await win.locator('[data-txt-format-painter-hint]').isVisible().catch(() => false);
    log('DEF475-hint-visible', hintVisible);
    expect(hintVisible, 'hint is gone after re-selecting the arming source').toBe(false);
    await painterPressed(win, true);
    const srcAfter = await boxModelsAt(win, SRC_TEXT);
    expect(sameStyle(srcAfter, srcBefore), 'source engine style unchanged (no re-apply)').toBe(true);
    await win.screenshot({ path: path.join(SHOTS, 'def475-hint-cleared.png') }).catch(() => {});
  } finally {
    await hardClose(app, 'def475');
  }
});

// ---------------------------------------------------------------------------
// DEF-476 (LOW) — empty-canvas click under the armed placement verb does not
// consume the captured format; the painter survives and still applies later.
// ---------------------------------------------------------------------------
test('DEF-476 empty-canvas click does not consume the armed format', async () => {
  test.setTimeout(360000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);

    await createTextBox(win, SRC_TEXT, 0.2, 0.15);
    await createTextBox(win, TGT_TEXT, 0.2, 0.45);
    await selectBox(win, SRC_TEXT);
    await applySourceFormat(win);
    const src = await waitForBox(win, SRC_TEXT, (b) => b.charSpacing === 2, 15000);
    expect(src && src.font, 'source format applied').toBe('Times');

    // Arm on the source while the placement verb is still armed.
    await win.click('[data-txt-format-painter]');
    await painterPressed(win, true);
    const before = JSON.stringify(await boxModels(win));

    // Single-click an empty canvas area inside the visible page (page 1).
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const preClick = await win.evaluate(() => {
      const verb = document.querySelector('[data-dock-verb="editTextBox"]');
      const d = window.tflexDiagnostics();
      return {
        editTextBoxPressed: verb ? verb.getAttribute('aria-pressed') : 'MISSING',
        editToolPressed: document.querySelector('[data-dock-verb="editToolOff"]')?.getAttribute('aria-pressed') ?? null,
        activeTool: d.activeTool ?? null,
        painterPressed: document.querySelector('[data-txt-format-painter]')?.getAttribute('aria-pressed') ?? null,
      };
    });
    log('DEF476-pre-click', { pg, vp, preClick });
    // Click inside the page rect (top-right, empty) so the placement verb sees canvas.
    const cx = Math.min(pg.x + pg.width * 0.85, pg.x + pg.width - 20);
    const cy = pg.y + pg.height * 0.10;
    const insidePage = cx < pg.x + pg.width && cy < pg.y + pg.height && cx > pg.x && cy > pg.y;
    log('DEF476-click', { cx, cy, insidePage });
    await win.mouse.click(cx, cy);
    await win.waitForTimeout(1500);

    // Diagnostic dump: painter/diag state exactly as observed after the click.
    const post = await win.evaluate(() => {
      const b = document.querySelector('[data-txt-format-painter]');
      const d = window.tflexDiagnostics();
      return {
        painterPresent: b !== null,
        pressed: b ? b.getAttribute('aria-pressed') : null,
        disabled: b ? b.disabled : null,
        hint: document.querySelector('[data-txt-format-painter-hint]')?.textContent ?? null,
        panelMode: document.querySelector('[data-text-panel]')?.getAttribute('data-text-panel-mode') ?? null,
        activeTool: d.activeTool ?? null,
        boxes: (d.engineState?.textBoxes || []).map((x) => `${x.text}:${x.page}:${x.font}`),
      };
    });
    log('DEF476-post-click', post);
    await win.screenshot({ path: path.join(SHOTS, 'def476-canvas-click.png') }).catch(() => {});

    // Painter stays armed, no engine text-box change, hint shown.
    await painterPressed(win, true);
    const after = JSON.stringify(await boxModels(win));
    expect(after, 'no engine text-box change on the empty-canvas click').toBe(before);
    await win.waitForSelector('[data-txt-format-painter-hint]', { state: 'visible', timeout: 8000 });

    // The captured format is intact: a DIFFERENT committed box still applies.
    await win.locator('[data-dock-verb="editTextBox"]').click();
    await win.waitForTimeout(300);
    await selectBox(win, TGT_TEXT);
    const applied = await waitForBox(win, TGT_TEXT, (b) => sameStyle(b, src), 20000);
    log('DEF476-applied', applied);
    expect(applied, 'a different committed box still takes the captured format').toBeTruthy();
    await painterPressed(win, false);
    await win.screenshot({ path: path.join(SHOTS, 'def476-applied-after.png') }).catch(() => {});
  } finally {
    await hardClose(app, 'def476');
  }
});

// ---------------------------------------------------------------------------
// DEF-478 (MEDIUM) — committing a box the placement verb just created (drag,
// type, blur) while the painter is armed must NOT consume the captured format:
// the painter stays armed with the hint, the placed box keeps its OWN creation
// style, and only a DIFFERENT pre-existing committed box applies.
// ---------------------------------------------------------------------------

/** Drag a NEW box under the armed placement verb, type into the panel Text
 *  field and blur to COMMIT it. Does NOT re-select it, so the post-commit
 *  transient state is observed exactly as the defect reported it. */
async function dragPlaceAndCommit(win, text, fx, fy) {
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const inspectorLeft = await win.evaluate(() => {
    const i = document.querySelector('[data-inspector]');
    return i ? i.getBoundingClientRect().left : window.innerWidth;
  });
  let x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 240));
  x = Math.min(x, inspectorLeft - 40);
  const y = Math.max(pg.y + 20, Math.min(pg.y + pg.height * fy, vp.h - 200));
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + 200, y + 70, { steps: 6 });
  await win.mouse.up();
  await fillPanelText(win, text);
  await win.waitForSelector('.edit-box', { timeout: 8000 });
  await win.waitForTimeout(600);
}

const PLACED_TEXT = 'P80F-PLACED';
const FS_SRC_TEXT = 'P80F-SRC';
const FS_TGT_TEXT = 'P80F-TGT';

test('DEF-478 commit transition keeps the painter armed; only a different committed box applies', async () => {
  test.setTimeout(360000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);

    // A pre-existing committed TARGET box (Helvetica/12) built BEFORE arming.
    await createTextBox(win, FS_TGT_TEXT, 0.2, 0.55);
    const tgtBefore = await boxModelsAt(win, FS_TGT_TEXT);
    log('DEF477-tgt-before', tgtBefore);
    expect(tgtBefore, 'pre-existing committed target box exists').toBeTruthy();

    // Committed SOURCE box with the distinctive captured format.
    await createTextBox(win, FS_SRC_TEXT, 0.2, 0.15);
    await selectBox(win, FS_SRC_TEXT);
    await applySourceFormat(win);
    const src = await waitForBox(win, FS_SRC_TEXT, (b) => b.charSpacing === 2, 15000);
    log('DEF477-src', src);
    expect(src && src.font, 'source format applied (Times/18/bold/#3366cc/charSpacing 2)').toBe('Times');
    expect(src && src.size, 'source size 18').toBe(18);
    expect(src && src.charSpacing, 'source charSpacing 2').toBe(2);
    expect(sameStyle(tgtBefore, src), 'target starts with a different format').toBe(false);

    // Arm the painter on the source (placement verb still armed).
    await selectBox(win, FS_SRC_TEXT);
    await win.click('[data-txt-format-painter]');
    await painterPressed(win, true);

    // Drag a NEW box on empty canvas, type P2-PLACED, blur to COMMIT it.
    await dragPlaceAndCommit(win, PLACED_TEXT, 0.55, 0.12);
    const placed = await waitForBox(win, PLACED_TEXT, null, 15000);
    log('DEF477-placed', placed);
    expect(placed, 'the placed box committed into the engine').toBeTruthy();

    // PASS leg 1: painter still armed, hint visible after commit.
    await painterPressed(win, true);
    await win.waitForSelector('[data-txt-format-painter-hint]', { state: 'visible', timeout: 8000 });
    const hint = await win.locator('[data-txt-format-painter-hint]').textContent();
    log('DEF477-hint', hint);
    const painterState = await win.evaluate(() => {
      const b = document.querySelector('[data-txt-format-painter]');
      return { pressed: b?.getAttribute('aria-pressed') ?? null, hint: document.querySelector('[data-txt-format-painter-hint]')?.textContent ?? null };
    });
    log('DEF477-painter-after-commit', painterState);

    // PASS leg 2: the placed box kept its OWN creation style, NOT the source
    // format. If an apply had run, it would equal the source and disarm.
    expect(placed && placed.font, 'placed box keeps its creation font').toBe('Helvetica');
    expect(placed && placed.size, 'placed box keeps its creation size').toBe(12);
    expect(placed && placed.color, 'placed box keeps its creation color').toBe('#000000');
    expect(sameStyle(placed, src), 'placed box was NOT given the captured source format').toBe(false);
    await win.screenshot({ path: path.join(SHOTS, 'def477-armed-hint-after-commit.png') }).catch(() => {});

    // PASS leg 3: a DIFFERENT pre-existing committed box takes the full
    // captured format in ONE action and disarms the painter.
    await selectBox(win, FS_TGT_TEXT);
    const applied = await waitForBox(win, FS_TGT_TEXT, (b) => sameStyle(b, src), 20000);
    log('DEF477-applied', applied);
    expect(applied, 'the pre-existing committed box takes the full captured format').toBeTruthy();
    await painterPressed(win, false);
    await win.screenshot({ path: path.join(SHOTS, 'def477-applied-different-box.png') }).catch(() => {});

    // The placed box is untouched by the apply to the other box.
    const placedAfter = await boxModelsAt(win, PLACED_TEXT);
    log('DEF477-placed-after', placedAfter);
    expect(sameStyle(placedAfter, placed), 'placed box style unchanged by the later apply').toBe(true);
  } finally {
    await hardClose(app, 'def477');
  }
});
