// TFL-690 (TFL-525 E) — bug-hunt sweep of the Edit Text / Add Text matrix.
// TFL-692 (TFL-525 E re-run) EXTENDED it with T7 (paragraph controls:
// alignment / line spacing / indent / underline; typing edge cases: unicode,
// punctuation, backspace; double-click-to-edit; box resize; zoom with a box
// selected) and T8 (pdf.js text-layer + annotation-layer integrity; page
// scroll while editing). Current result: 6 passed / 2 failed — the two failing
// tests surface DEF-537, DEF-538 and DEF-539 (all OPEN, filed under TFL-690).
//
// Phase TFL-525 (Edit Text / Add Text corrections). Criteria 1 (symmetric hover
// box) and 2 (Cancel truly reverts) are already MET and covered by
// e2e/tfl525_edit_text_fixes.spec.cjs. THIS spec drives the full matrix from the
// issue brief and records, for every row, PASS / FAIL / n/a plus a screenshot
// for each failure. It FIXES nothing (read-only on src/).
//
// Harness mirrors e2e/tfl525_edit_text_fixes.spec.cjs: launchApp/getSamplePath
// from e2e/lib/launch.cjs; hardClose/gotoStage/scrollToPage from
// e2e/lib/helpers.cjs; the armTextTool/armBoxTool/findRunSpan patterns are
// re-derived here so the sibling spec is untouched.
//
// Run: npm.cmd run test:e2e -- tfl525_edit_text_sweep
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, gotoStage, scrollToPage } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const RESULTS_PATH = path.join(SHOTS, 'tfl525-sweep-results.json');

const MATRIX = [];
let testRows = [];
let failures = [];
let pageErrors = [];

test.setTimeout(300000);

let app = null;
let win = null;
let reportSample = null;

function record(row, status, detail) {
  const entry = { row, status, detail };
  MATRIX.push(entry);
  testRows.push(entry);
  console.log(`[SWEEP] ${status} | ${row} | ${detail}`);
}

// Assert-style check: records PASS/FAIL, snapshots on FAIL, and accumulates the
// failure so the test still runs its remaining rows and fails at the end.
async function check(row, ok, detail, shotName) {
  if (ok) {
    record(row, 'PASS', detail);
  } else {
    record(row, 'FAIL', detail);
    failures.push(`${row}: ${detail}`);
    if (shotName) {
      await win.screenshot({ path: path.join(SHOTS, shotName) }).catch(() => {});
    }
  }
  return ok;
}

async function note(row, detail, shotName) {
  record(row, 'n/a', detail);
  if (shotName) await win.screenshot({ path: path.join(SHOTS, shotName) }).catch(() => {});
}

test.beforeAll(() => {
  // Nothing global: Playwright restarts the worker after a failing test, which
  // re-runs beforeAll, so the results file must NEVER be truncated here. Rows
  // are merged and deduped by title in afterEach instead.
});

test.beforeEach(async () => {
  failures = [];
  pageErrors = [];
  testRows = [];
  reportSample = getSamplePath('report.pdf');
  app = await launchApp([reportSample]);
  win = await app.firstWindow();
  win.on('pageerror', (err) => pageErrors.push(String(err && err.message)));
  try {
    await win.waitForSelector('.workspace', { timeout: 30000 });
  } catch (_) {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportSample);
    const openBtn = win.locator('[data-toolbar-open]').first();
    if ((await openBtn.count()) > 0) await openBtn.click();
    else await win.locator('[data-home-tool="open"]').first().click();
    await win.waitForSelector('.workspace', { timeout: 30000 });
  }
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await scrollToPage(win, 1);
  await win.waitForTimeout(600);
});

test.afterEach(async () => {
  let prior = { matrix: [], pageErrors: [] };
  try { prior = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8')); } catch (_) { /* first test */ }
  const seen = new Set((prior.matrix || []).map((r) => r.row));
  const matrix = [...(prior.matrix || [])];
  for (const r of testRows) {
    if (!seen.has(r.row)) { seen.add(r.row); matrix.push(r); }
  }
  const merged = {
    matrix,
    pageErrors: [...new Set([...(prior.pageErrors || []), ...pageErrors])],
  };
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(merged, null, 2));
  if (app) await hardClose(app, 'tfl690');
  app = null;
  win = null;
});

// --- driving helpers --------------------------------------------------------

async function armTextTool() {
  await gotoStage(win, 2);
  const verb = win.locator('[data-action-dock] [data-dock-verb="editText"]').first();
  await verb.waitFor({ state: 'visible', timeout: 12000 });
  await verb.click();
  await win.waitForTimeout(400);
  await win.waitForFunction(
    () => document.querySelector('.edit-layer[data-tool="text"]') !== null,
    undefined,
    { timeout: 8000 },
  );
}

async function armBoxTool() {
  await gotoStage(win, 2);
  const verb = win.locator('[data-action-dock] [data-dock-verb="editTextBox"]').first();
  await verb.waitFor({ state: 'visible', timeout: 12000 });
  await verb.click();
  await win.waitForTimeout(400);
  await win.waitForFunction(
    () => document.querySelector('.edit-layer[data-tool="box"]') !== null,
    undefined,
    { timeout: 8000 },
  );
}

async function pageRect(page = 1) {
  return win.evaluate((want) => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]') || document;
    const el =
      pane.querySelector(`.page-slot[data-page="${want}"]`) ||
      document.querySelector(`.page-slot[data-page="${want}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, page);
}

async function findRunSpan() {
  return win.evaluate(() => {
    const spans = Array.from(
      document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'),
    );
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      const r = s.getBoundingClientRect();
      if (t.length >= 6 && r.width > 20 && r.height > 4) {
        return { text: t, x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      }
    }
    return null;
  });
}

async function runSelection() {
  return win.evaluate(() => {
    const el = document.querySelector('[data-textrun-selection]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { text: el.getAttribute('data-textrun-text'), x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

async function runPreviewText() {
  return win.evaluate(() => {
    const el = document.querySelector('.edit-run-live-preview');
    if (!el) return null;
    return {
      text: (el.textContent || '').trim(),
      lines: el.querySelectorAll('.edit-run-line').length,
    };
  });
}

async function textLayerText(page = 1) {
  return win.evaluate((want) => {
    const spans = Array.from(document.querySelectorAll(`.page-slot[data-page="${want}"] .textLayer span`));
    return spans.map((s) => s.textContent || '').join(' ');
  }, page);
}

async function typeIntoTextPanel(value) {
  const f = win.locator('[data-txt-text]').first();
  await f.waitFor({ state: 'visible', timeout: 12000 });
  await f.click();
  await f.fill(value);
  await win.waitForTimeout(500);
}

async function drawBox(fx = 0.28, fy = 0.42, wpx = 260, hpx = 80) {
  const pr = await pageRect(1);
  expect(pr, 'page 1 slot present').not.toBeNull();
  const x0 = pr.x + pr.w * fx;
  const y0 = pr.y + pr.h * fy;
  const x1 = x0 + Math.min(wpx, pr.w * 0.45);
  const y1 = y0 + hpx;
  await win.mouse.move(x0, y0);
  await win.mouse.down();
  await win.mouse.move(x1, y1, { steps: 15 });
  await win.mouse.up();
  await win.waitForTimeout(700);
  return { x0, y0, x1, y1 };
}

async function zoomPercent() {
  const txt = await win.locator('.zoom-percent').first().textContent().catch(() => null);
  return txt ? parseInt(txt.replace('%', ''), 10) : null;
}

// Step the ladder to the requested manual zoom (best effort, bounded).
async function setZoom(targetPercent) {
  for (let i = 0; i < 20; i += 1) {
    const cur = await zoomPercent();
    if (cur === null) return null;
    if (cur === targetPercent) return cur;
    const btn = win.locator(`[aria-label="${cur < targetPercent ? 'Zoom in' : 'Zoom out'}"]`).first();
    if ((await btn.count()) === 0) return cur;
    await btn.click();
    await win.waitForTimeout(450);
  }
  return zoomPercent();
}

async function diag() {
  return win.evaluate(() => window.tflexDiagnostics());
}

// ===========================================================================
// T1 — enter / activate + hover matrix
// ===========================================================================
test('T1 enter/activate and hover matrix', async () => {
  await gotoStage(win, 2);
  const editTextVerb = win.locator('[data-action-dock] [data-dock-verb="editText"]').first();
  const editBoxVerb = win.locator('[data-action-dock] [data-dock-verb="editTextBox"]').first();
  await check(
    'enter: EDIT stage exposes editText + editTextBox verbs',
    (await editTextVerb.count()) > 0 && (await editTextVerb.isVisible().catch(() => false)) &&
      (await editBoxVerb.count()) > 0 && (await editBoxVerb.isVisible().catch(() => false)),
    `editText=${await editTextVerb.count()} editTextBox=${await editBoxVerb.count()}`,
    'tfl525-sweep-t1-dock.png',
  );

  await armTextTool();
  await check(
    'activate: editText arms .edit-layer[data-tool="text"]',
    (await win.locator('.edit-layer[data-tool="text"]').count()) > 0,
    `layers=${await win.locator('.edit-layer[data-tool="text"]').count()}`,
    'tfl525-sweep-t1-armtext.png',
  );
  await armBoxTool();
  await check(
    'activate: editTextBox arms .edit-layer[data-tool="box"]',
    (await win.locator('.edit-layer[data-tool="box"]').count()) > 0,
    `layers=${await win.locator('.edit-layer[data-tool="box"]').count()}`,
    'tfl525-sweep-t1-armbox.png',
  );

  // Hover an existing run.
  await armTextTool();
  const run = await findRunSpan();
  await check('hover: a page-1 run is discoverable', run !== null, run ? `run="${run.text.slice(0, 24)}"` : 'none');
  if (run) {
    await win.mouse.move(5, 5);
    await win.waitForTimeout(120);
    await win.mouse.move(run.cx, run.cy);
    await win.waitForTimeout(400);
    const hover = win.locator('.page-slot[data-page="1"] .edit-text-hover').first();
    const vis = await hover.isVisible().catch(() => false);
    let sym = '';
    if (vis) {
      const hb = await hover.boundingBox();
      if (hb) {
        const tg = run.y - hb.y;
        const bg = hb.y + hb.height - (run.y + run.h);
        const lg = run.x - hb.x;
        const rg = hb.x + hb.width - (run.x + run.w);
        sym = `top=${tg.toFixed(1)} bottom=${bg.toFixed(1)} left=${lg.toFixed(1)} right=${rg.toFixed(1)}`;
        await check(
          'hover existing run: symmetric hover box',
          Math.abs(tg - bg) <= 2 && Math.abs(lg - rg) <= 2,
          sym,
          'tfl525-sweep-t1-hover-asym.png',
        );
      }
    }
    await check('hover existing run: hover surface appears', vis, vis ? sym : 'no .edit-text-hover');
    await win.screenshot({ path: path.join(SHOTS, 'tfl525-sweep-t1-hover-run.png') });
  }

  // Hover empty page (top-left margin of page 1, no glyphs).
  const pr = await pageRect(1);
  await win.mouse.move(5, 5);
  await win.waitForTimeout(120);
  await win.mouse.move(pr.x + 8, pr.y + 8);
  await win.waitForTimeout(400);
  const emptyHover = await win.locator('.page-slot[data-page="1"] .edit-text-hover').count();
  await check('hover empty page: no run-hover surface', emptyHover === 0, `hoverCount=${emptyHover}`, 'tfl525-sweep-t1-hover-empty.png');
  await win.screenshot({ path: path.join(SHOTS, 'tfl525-sweep-t1-hover-empty.png') });

  await check('T1: no page errors', pageErrors.length === 0, pageErrors.join(' | ') || 'none');
  expect(failures, failures.join('\n')).toEqual([]);
});

// ===========================================================================
// T2 — focus / caret / selection / typing / single + multi line
// ===========================================================================
test('T2 run focus, caret, selection, typing', async () => {
  await armTextTool();
  const run = await findRunSpan();
  await check('T2: a page-1 run is discoverable', run !== null, run ? `run="${run.text.slice(0, 24)}"` : 'none');
  if (!run) { expect(failures).toEqual([]); return; }

  await win.mouse.click(run.cx, run.cy);
  await win.waitForSelector('[data-textrun-selection]', { timeout: 10000 }).catch(() => {});
  const sel = await runSelection();
  await check('focus: click selects the run', sel !== null, sel ? `sel="${String(sel.text).slice(0, 24)}"` : 'no selection', 'tfl525-sweep-t2-select.png');

  const field = win.locator('[data-txt-text]').first();
  const fieldVal = await field.inputValue().catch(() => null);
  await check('focus: Text field takes the run text', fieldVal === (run.text), `field="${fieldVal}" run="${run.text}"`, 'tfl525-sweep-t2-field.png');

  const caret = await win.evaluate(() => {
    const el = document.querySelector('[data-txt-text]');
    if (!el) return null;
    return {
      focused: document.activeElement === el,
      start: el.selectionStart,
      end: el.selectionEnd,
      len: (el.value || '').length,
    };
  });
  await check('caret: Text field is focused on selection', !!caret && caret.focused, JSON.stringify(caret), 'tfl525-sweep-t2-caret.png');
  await win.screenshot({ path: path.join(SHOTS, 'tfl525-sweep-t2-focus.png') });

  // typing: append
  await typeIntoTextPanel(run.text + ' ZZAPPEND');
  const appendPrev = await runPreviewText();
  await check(
    'typing append: live preview carries appended text',
    !!appendPrev && appendPrev.text.includes('ZZAPPEND'),
    JSON.stringify(appendPrev),
    'tfl525-sweep-t2-append.png',
  );

  // typing: replace
  await typeIntoTextPanel('ZZREPLACED');
  const replacePrev = await runPreviewText();
  await check(
    'typing replace: live preview is the replacement only',
    !!replacePrev && replacePrev.text.includes('ZZREPLACED') && !replacePrev.text.includes(run.text),
    JSON.stringify(replacePrev),
    'tfl525-sweep-t2-replace.png',
  );

  // single-line run (short text)
  const singlePrev = await runPreviewText();
  await check('single-line run: preview renders one line', !!singlePrev && singlePrev.lines === 1, JSON.stringify(singlePrev), 'tfl525-sweep-t2-single.png');

  // multi-line run (explicit newlines — a run is never width-wrapped)
  await typeIntoTextPanel('line one\nline two\nline three');
  const multiPrev = await runPreviewText();
  await check('multi-line run: explicit newlines render >1 line', !!multiPrev && multiPrev.lines > 1, JSON.stringify(multiPrev), 'tfl525-sweep-t2-multiline.png');
  await win.screenshot({ path: path.join(SHOTS, 'tfl525-sweep-t2-multiline.png') });

  // typing: delete-to-empty
  await typeIntoTextPanel('');
  const emptyVal = await field.inputValue().catch(() => null);
  const emptyPrev = await runPreviewText();
  await check('typing delete-to-empty: field is empty', emptyVal === '', `field="${emptyVal}" preview=${JSON.stringify(emptyPrev)}`, 'tfl525-sweep-t2-empty.png');

  // Cancel back to a clean state.
  await win.locator('[data-content-action="textrun-cancel"]').first().click().catch(() => {});
  await win.waitForTimeout(500);

  // selection: click-drag across a run (the documented run-move gesture)
  const run2 = await findRunSpan();
  if (run2) {
    await win.mouse.move(run2.cx, run2.cy);
    await win.mouse.down();
    await win.mouse.move(run2.cx + 140, run2.cy + 60, { steps: 12 });
    await win.mouse.up();
    await win.waitForTimeout(600);
    const barAfterDrag = await win.locator('[data-content-action-bar="textrun"]').count();
    const selAfterDrag = await runSelection();
    await check(
      'selection click-drag across a run: move gesture exposes the run bar',
      barAfterDrag > 0 && selAfterDrag !== null,
      `bar=${barAfterDrag} sel=${JSON.stringify(selAfterDrag)}`,
      'tfl525-sweep-t2-dragselect.png',
    );
    await win.screenshot({ path: path.join(SHOTS, 'tfl525-sweep-t2-dragselect.png') });
    await win.locator('[data-content-action="textrun-cancel"]').first().click().catch(() => {});
    await win.waitForTimeout(400);
  } else {
    await note('selection click-drag across a run', 'no run span after cancel to drag');
  }

  await check('T2: no page errors', pageErrors.length === 0, pageErrors.join(' | ') || 'none');
  expect(failures, failures.join('\n')).toEqual([]);
});

// ===========================================================================
// T3 — font + formatting controls
// ===========================================================================
async function previewStyle() {
  return win.evaluate(() => {
    const el = document.querySelector('.edit-run-live-preview');
    if (!el) return null;
    const cs = getComputedStyle(el);
    const band = el.querySelector('.edit-run-line-band');
    const bcs = band ? getComputedStyle(band) : null;
    return {
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      fontStyle: cs.fontStyle,
      color: cs.color,
      bandBackground: bcs ? bcs.backgroundColor : null,
    };
  });
}

async function setColorInput(selector, hex) {
  await win.locator(selector).first().evaluate((el, h) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, h);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, hex);
  await win.waitForTimeout(450);
}

test('T3 font and formatting controls', async () => {
  await armTextTool();
  const run = await findRunSpan();
  if (!run) { await check('T3: run discoverable', false, 'no run'); expect(failures).toEqual([]); return; }
  await win.mouse.click(run.cx, run.cy);
  await win.waitForSelector('[data-textrun-selection]', { timeout: 10000 }).catch(() => {});

  const before = await previewStyle();
  await check('T3: live preview present for formatting', before !== null, JSON.stringify(before), 'tfl525-sweep-t3-preview.png');

  // Family
  await win.locator('[data-txt-font]').first().selectOption('Times').catch(() => {});
  await win.waitForTimeout(450);
  const afterFamily = await previewStyle();
  await check(
    'format family: preview font changes to Times',
    !!afterFamily && /Times/i.test(afterFamily.fontFamily) && afterFamily.fontFamily !== (before && before.fontFamily),
    JSON.stringify(afterFamily),
    'tfl525-sweep-t3-family.png',
  );

  // Size
  await win.locator('[data-txt-size]').first().fill('40').catch(() => {});
  await win.waitForTimeout(450);
  const afterSize = await previewStyle();
  await check(
    'format size: preview font-size grows',
    !!afterSize && parseFloat(afterSize.fontSize) > parseFloat(before.fontSize),
    `before=${before.fontSize} after=${afterSize && afterSize.fontSize}`,
    'tfl525-sweep-t3-size.png',
  );

  // Bold
  await win.locator('[data-txt-bold]').first().click().catch(() => {});
  await win.waitForTimeout(400);
  const boldPressed = await win.locator('[data-txt-bold]').first().getAttribute('aria-pressed');
  const afterBold = await previewStyle();
  await check(
    'format bold: toggles and preview weights up',
    boldPressed === 'true' && !!afterBold && parseInt(afterBold.fontWeight, 10) >= 600,
    `pressed=${boldPressed} weight=${afterBold && afterBold.fontWeight}`,
    'tfl525-sweep-t3-bold.png',
  );

  // Italic
  await win.locator('[data-txt-italic]').first().click().catch(() => {});
  await win.waitForTimeout(400);
  const italicPressed = await win.locator('[data-txt-italic]').first().getAttribute('aria-pressed');
  const afterItalic = await previewStyle();
  await check(
    'format italic: toggles and preview italicises',
    italicPressed === 'true' && !!afterItalic && /italic/.test(afterItalic.fontStyle),
    `pressed=${italicPressed} style=${afterItalic && afterItalic.fontStyle}`,
    'tfl525-sweep-t3-italic.png',
  );

  // Colour
  await setColorInput('[data-txt-color]', '#ff0000');
  const afterColor = await previewStyle();
  await check(
    'format colour: preview text turns red',
    !!afterColor && /rgb\(255,\s*0,\s*0\)/.test(afterColor.color),
    `color=${afterColor && afterColor.color}`,
    'tfl525-sweep-t3-color.png',
  );

  // Highlight
  await setColorInput('[data-txt-highlight]', '#ffff00');
  const afterHl = await previewStyle();
  await check(
    'format highlight: preview band turns yellow',
    !!afterHl && /rgb\(255,\s*255,\s*0\)/.test(afterHl.bandBackground || ''),
    `band=${afterHl && afterHl.bandBackground}`,
    'tfl525-sweep-t3-highlight.png',
  );
  await win.screenshot({ path: path.join(SHOTS, 'tfl525-sweep-t3-formatted.png') });

  // Clear highlight verb
  await win.locator('[data-txt-highlight-clear]').first().click().catch(() => {});
  await win.waitForTimeout(400);
  const afterClearHl = await previewStyle();
  await check(
    'format highlight clear: band removed',
    !!afterClearHl && !/rgb\(255,\s*255,\s*0\)/.test(afterClearHl.bandBackground || ''),
    `band=${afterClearHl && afterClearHl.bandBackground}`,
    'tfl525-sweep-t3-hlclear.png',
  );

  // Clear formatting resets to defaults
  await win.locator('[data-txt-clear]').first().click().catch(() => {});
  await win.waitForTimeout(450);
  const afterClear = await previewStyle();
  const boldAfterClear = await win.locator('[data-txt-bold]').first().getAttribute('aria-pressed');
  await check(
    'format clear: reset to defaults (black, not bold)',
    !!afterClear && /rgb\(0,\s*0,\s*0\)/.test(afterClear.color) &&
      parseInt(afterClear.fontWeight, 10) < 600 && boldAfterClear === 'false',
    `color=${afterClear && afterClear.color} weight=${afterClear && afterClear.fontWeight} bold=${boldAfterClear}`,
    'tfl525-sweep-t3-clear.png',
  );

  await win.locator('[data-content-action="textrun-cancel"]').first().click().catch(() => {});
  await win.waitForTimeout(400);
  await check('T3: no page errors', pageErrors.length === 0, pageErrors.join(' | ') || 'none');
  expect(failures, failures.join('\n')).toEqual([]);
});

// ===========================================================================
// T4 — new-box placement, empty/whitespace commit, Confirm, Cancel, Escape,
//      re-placement (move)
// ===========================================================================
const os = require('node:os');

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
    undefined,
    { timeout: 20000 },
  );
  await win.waitForTimeout(1500);
  return savePath;
}

function pdfBytesContain(filePath, needle) {
  return fs.readFileSync(filePath).includes(Buffer.from(needle, 'latin1'));
}

async function boxInfo(marker) {
  return win.evaluate((want) => {
    const all = Array.from(document.querySelectorAll('.edit-box'));
    const b = want ? all.find((el) => (el.textContent || '').includes(want)) : all[0];
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return {
      text: (b.textContent || '').trim(),
      x: r.x, y: r.y, w: r.width, h: r.height,
      cx: r.x + r.width / 2, cy: r.y + r.height / 2,
    };
  }, marker || null);
}

test('T4 add-box matrix', async () => {
  await armBoxTool();

  // placement of a new box
  const drag = await drawBox();
  const previewDuring = await win.locator('.edit-box-preview').count();
  await typeIntoTextPanel('QQBOXSWEEP_A');
  await win.waitForTimeout(400);
  const info = await boxInfo();
  await check(
    'new box placement: drag + type yields a box with the text',
    !!info && info.text.includes('QQBOXSWEEP_A'),
    `preview=${previewDuring} box=${JSON.stringify(info)}`,
    'tfl525-sweep-t4-place.png',
  );
  await win.screenshot({ path: path.join(SHOTS, 'tfl525-sweep-t4-place.png') });

  // Cancel this first box to reach a clean state.
  await win.locator('[data-edit-box-action="cancel"]').first().click().catch(() => {});
  await win.waitForTimeout(700);
  const baselineBoxes = await win.locator('.edit-box').count();

  // whitespace-only commit
  const b1 = await diag();
  await drawBox(0.28, 0.55, 240, 70);
  await typeIntoTextPanel('   ');
  await win.locator('[data-edit-box-action="confirm"]').first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  await win.locator('[data-edit-box-action="confirm"]').first().click().catch(() => {});
  await win.waitForTimeout(1200);
  const b2 = await diag();
  const boxesAfterWs = await win.locator('.edit-box').count();
  await check(
    'empty/whitespace-only commit: discarded (not modified, no new box)',
    boxesAfterWs === baselineBoxes && b2.modified === false,
    `baseline=${baselineBoxes} after=${boxesAfterWs} beforeModified=${b1.modified} afterModified=${b2.modified}`,
    'tfl525-sweep-t4-whitespace.png',
  );

  // commit (Confirm) bakes the box
  await drawBox(0.28, 0.42, 260, 80);
  await typeIntoTextPanel('QQBOXSWEEP_COMMIT');
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SHOTS, 'tfl525-sweep-t4-before-confirm.png') });
  await win.locator('[data-edit-box-action="confirm"]').first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  await win.locator('[data-edit-box-action="confirm"]').first().click().catch(() => {});
  await win.waitForTimeout(1800);
  const b3 = await diag();
  const markerBox = await boxInfo('QQBOXSWEEP_COMMIT');
  await check('commit Confirm: document is marked modified', b3.modified === true, `modified=${b3.modified}`, 'tfl525-sweep-t4-confirm.png');
  const savedConfirm = await saveAs(`tfl525-sweep-commit-${Date.now()}.pdf`);
  await check(
    'commit Confirm: marker baked into saved PDF bytes',
    pdfBytesContain(savedConfirm, 'QQBOXSWEEP_COMMIT'),
    `saved=${savedConfirm} bytesHasMarker=${pdfBytesContain(savedConfirm, 'QQBOXSWEEP_COMMIT')}`,
    'tfl525-sweep-t4-confirm-saved.png',
  );
  await win.screenshot({ path: path.join(SHOTS, 'tfl525-sweep-t4-after-confirm.png') });

  // re-placement: select the committed box and drag it
  if (markerBox) {
    await win.mouse.move(markerBox.cx, markerBox.cy);
    await win.mouse.down();
    await win.mouse.move(markerBox.cx + 120, markerBox.cy + 70, { steps: 15 });
    await win.mouse.up();
    await win.waitForTimeout(700);
    const barCount = await win.locator('[data-edit-box-action="confirm"]').count();
    await win.locator('[data-edit-box-action="confirm"]').first().click().catch(() => {});
    await win.waitForTimeout(1600);
    const after = await boxInfo('QQBOXSWEEP_COMMIT');
    const dx = after ? after.cx - markerBox.cx : null;
    const dy = after ? after.cy - markerBox.cy : null;
    await check(
      're-placement: committed box moves by the drag delta',
      barCount > 0 && after !== null && Math.abs(dx - 120) <= 30 && Math.abs(dy - 70) <= 30,
      `bar=${barCount} dx=${dx} dy=${dy} before=${JSON.stringify(markerBox)} after=${JSON.stringify(after)}`,
      'tfl525-sweep-t4-replace.png',
    );
    await win.screenshot({ path: path.join(SHOTS, 'tfl525-sweep-t4-replaced.png') });
  } else {
    await check('re-placement: committed box surface present', false, 'no .edit-box for QQBOXSWEEP_COMMIT after Confirm', 'tfl525-sweep-t4-replace-missing.png');
  }

  // Cancel a fresh box: nothing bakes, no new surface
  const boxesBeforeCancel = await win.locator('.edit-box').count();
  await drawBox(0.28, 0.62, 240, 70);
  await typeIntoTextPanel('QQBOXSWEEP_CANCEL');
  await win.waitForTimeout(400);
  await win.locator('[data-edit-box-action="cancel"]').first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  await win.locator('[data-edit-box-action="cancel"]').first().click().catch(() => {});
  await win.waitForTimeout(900);
  const boxesAfterCancel = await win.locator('.edit-box').count();
  const layerAfterCancel = await textLayerText(1);
  await check(
    'Cancel: uncommitted box is discarded, marker absent',
    boxesAfterCancel === boxesBeforeCancel && !layerAfterCancel.includes('QQBOXSWEEP_CANCEL'),
    `before=${boxesBeforeCancel} after=${boxesAfterCancel} markerInLayer=${layerAfterCancel.includes('QQBOXSWEEP_CANCEL')}`,
    'tfl525-sweep-t4-cancel.png',
  );

  // Escape on a live box session: does NOT bake (save + byte scan is decisive)
  await drawBox(0.28, 0.68, 240, 70);
  await typeIntoTextPanel('QQBOXSWEEP_ESC');
  await win.waitForTimeout(400);
  const errsBeforeEsc = pageErrors.length;
  await win.keyboard.press('Escape');
  await win.waitForTimeout(1200);
  const layerAfterEsc = await textLayerText(1);
  const savedEsc = await saveAs(`tfl525-sweep-escape-${Date.now()}.pdf`);
  const escBaked = pdfBytesContain(savedEsc, 'QQBOXSWEEP_ESC');
  await check(
    'Escape: live box session does not bake and raises no error',
    pageErrors.length === errsBeforeEsc && !layerAfterEsc.includes('QQBOXSWEEP_ESC') && !escBaked,
    `markerInLayer=${layerAfterEsc.includes('QQBOXSWEEP_ESC')} markerInSavedBytes=${escBaked} errs=${pageErrors.slice(errsBeforeEsc).join('|')}`,
    'tfl525-sweep-t4-escape.png',
  );
  await win.screenshot({ path: path.join(SHOTS, 'tfl525-sweep-t4-escape.png') });

  await check('T4: no page errors', pageErrors.length === 0, pageErrors.join(' | ') || 'none');
  expect(failures, failures.join('\n')).toEqual([]);
});

// ===========================================================================
// T5 — undo / redo after commit and after Cancel; page / mode transitions;
//      zoom while a session is live
// ===========================================================================
test('T5 undo/redo, transitions, live zoom', async () => {
  await armTextTool();
  const run = await findRunSpan();
  if (!run) { await check('T5: run discoverable', false, 'no run'); expect(failures).toEqual([]); return; }
  await win.mouse.click(run.cx, run.cy);
  await win.waitForSelector('[data-textrun-selection]', { timeout: 10000 }).catch(() => {});
  await typeIntoTextPanel(run.text + ' ZZUNDO');
  const confirmCount = await win.locator('[data-content-action="textrun-confirm"]').count();
  await win.locator('[data-content-action="textrun-confirm"]').first().click().catch(() => {});
  await win.waitForTimeout(1600);

  let dCommitted = await diag();
  let layerCommitted = await textLayerText(1);
  const confirmCommitted = dCommitted.modified === true && layerCommitted.includes('ZZUNDO');
  await check(
    'Confirm commits an edited run',
    confirmCommitted,
    `confirmBtn=${confirmCount} modified=${dCommitted.modified} marker=${layerCommitted.includes('ZZUNDO')}`,
    'tfl525-sweep-t5-confirm-commit.png',
  );
  if (!confirmCommitted) {
    // Establish a committed state via a page blur so the undo/redo rows below
    // still exercise, and record whether the blur path differs from Confirm.
    const pr = await pageRect(1);
    await win.mouse.click(pr.x + 8, pr.y + 8);
    await win.waitForTimeout(1800);
    dCommitted = await diag();
    layerCommitted = await textLayerText(1);
    record('Confirm vs blur commit (diagnostic)', 'n/a',
      `confirmCommitted=false blurCommitted=${dCommitted.modified === true && layerCommitted.includes('ZZUNDO')}`);
  }
  await check(
    'undo setup: commit appended text (modified, marker in layer)',
    dCommitted.modified === true && layerCommitted.includes('ZZUNDO'),
    `modified=${dCommitted.modified} marker=${layerCommitted.includes('ZZUNDO')}`,
    'tfl525-sweep-t5-commit.png',
  );

  // undo
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(1500);
  const layerUndone = await textLayerText(1);
  await check(
    'undo after commit: appended text reverted',
    !layerUndone.includes('ZZUNDO'),
    `marker=${layerUndone.includes('ZZUNDO')}`,
    'tfl525-sweep-t5-undo.png',
  );

  // redo
  await win.keyboard.press('Control+Shift+z');
  await win.waitForTimeout(1500);
  const layerRedone = await textLayerText(1);
  await check(
    'redo: appended text restored',
    layerRedone.includes('ZZUNDO'),
    `marker=${layerRedone.includes('ZZUNDO')}`,
    'tfl525-sweep-t5-redo.png',
  );

  // Cancel adds no undo entry: cancel a live session, then undo reverts the
  // LAST real op (the redo above), not the cancelled draft.
  const run2 = await findRunSpan();
  await win.mouse.click(run2.cx, run2.cy);
  await win.waitForSelector('[data-textrun-selection]', { timeout: 10000 }).catch(() => {});
  await typeIntoTextPanel('ZZCANCELDRAFT');
  await win.locator('[data-content-action="textrun-cancel"]').first().click().catch(() => {});
  await win.waitForTimeout(700);
  const layerAfterCancel = await textLayerText(1);
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(1500);
  const layerAfterCancelUndo = await textLayerText(1);
  await check(
    'undo after Cancel: draft never baked; undo reverts the prior commit',
    !layerAfterCancel.includes('ZZCANCELDRAFT') && !layerAfterCancelUndo.includes('ZZUNDO'),
    `draftInLayer=${layerAfterCancel.includes('ZZCANCELDRAFT')} markerAfterUndo=${layerAfterCancelUndo.includes('ZZUNDO')}`,
    'tfl525-sweep-t5-cancel-undo.png',
  );

  // page transition with a live, uncommitted box session
  await armBoxTool();
  await drawBox(0.28, 0.45, 240, 70);
  await typeIntoTextPanel('ZZPAGEDRAFT');
  await win.locator('[aria-label="Next page"]').first().click().catch(() => {});
  await win.waitForTimeout(900);
  await win.locator('[aria-label="Previous page"]').first().click().catch(() => {});
  await win.waitForTimeout(900);
  const errsPage = pageErrors.length;
  await check(
    'page transition with live session: no error, stable',
    errsPage === 0,
    `pageErrors=${pageErrors.join('|') || 'none'}`,
    'tfl525-sweep-t5-pagetransition.png',
  );
  await win.screenshot({ path: path.join(SHOTS, 'tfl525-sweep-t5-pagetransition.png') });

  // mode transition: leave EDIT then return
  await gotoStage(win, 1);
  await win.waitForTimeout(500);
  const layersLeft = await win.locator('.edit-layer').count();
  await gotoStage(win, 2);
  await win.waitForTimeout(500);
  const errsMode = pageErrors.length;
  await check(
    'mode transition (leave EDIT, return): overlay clears, no error',
    layersLeft === 0 && errsMode === 0,
    `layersAfterLeave=${layersLeft} pageErrors=${pageErrors.join('|') || 'none'}`,
    'tfl525-sweep-t5-modetransition.png',
  );

  // zoom while a text session is live
  await armTextTool();
  const run3 = await findRunSpan();
  if (run3) {
    await win.mouse.click(run3.cx, run3.cy);
    await win.waitForSelector('[data-textrun-selection]', { timeout: 10000 }).catch(() => {});
    await setZoom(125);
    const z125 = await zoomPercent();
    const sel125 = await runSelection();
    await check(
      'live zoom 125: selection survives, no error',
      z125 === 125 && sel125 !== null && pageErrors.length === 0,
      `zoom=${z125} sel=${sel125 !== null} errors=${pageErrors.join('|') || 'none'}`,
      'tfl525-sweep-t5-zoom125.png',
    );
    await win.screenshot({ path: path.join(SHOTS, 'tfl525-sweep-t5-zoom125.png') });

    await setZoom(175);
    const z175 = await zoomPercent();
    const sel175 = await runSelection();
    await check(
      'live zoom 175 (nearest ladder step to 170): selection survives, no error',
      z175 === 175 && sel175 !== null && pageErrors.length === 0,
      `zoom=${z175} sel=${sel175 !== null} errors=${pageErrors.join('|') || 'none'}`,
      'tfl525-sweep-t5-zoom175.png',
    );
    await win.screenshot({ path: path.join(SHOTS, 'tfl525-sweep-t5-zoom175.png') });
    await win.locator('[data-content-action="textrun-cancel"]').first().click().catch(() => {});
  } else {
    await note('live zoom 125 / 175', 'no run span available after transitions');
  }

  await check('T5: no page errors', pageErrors.length === 0, pageErrors.join(' | ') || 'none');
  expect(failures, failures.join('\n')).toEqual([]);
});

// ===========================================================================
// T6 — interaction with the pdf.js text layer and selection
// ===========================================================================
test('T6 pdf.js text layer and selection', async () => {
  // Without an edit tool: native text-layer selection must work.
  await gotoStage(win, 1);
  await win.waitForTimeout(400);
  const span = await win.evaluate(() => {
    const s = Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'))
      .find((x) => (x.textContent || '').trim().length >= 6);
    if (!s) return null;
    const r = s.getBoundingClientRect();
    return { text: s.textContent.trim(), x: r.x, y: r.y, w: r.width, h: r.height, cy: r.y + r.height / 2 };
  });
  if (!span) { await check('T6: text-layer span present', false, 'none'); expect(failures).toEqual([]); return; }

  await win.mouse.move(span.x + 2, span.cy);
  await win.mouse.down();
  await win.mouse.move(span.x + span.w - 2, span.cy, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(400);
  const nativeSel = await win.evaluate(() => String(window.getSelection && window.getSelection().toString()));
  await check(
    'text layer (no edit tool): click-drag selects text',
    nativeSel.trim().length > 0,
    `selection="${nativeSel.trim().slice(0, 40)}"`,
    'tfl525-sweep-t6-nativesel.png',
  );
  await win.screenshot({ path: path.join(SHOTS, 'tfl525-sweep-t6-nativesel.png') });
  await win.evaluate(() => window.getSelection && window.getSelection().removeAllRanges());

  // With the edit tool armed: record the interaction (the overlay owns the
  // pointer, so the row asks what selection state results).
  await armTextTool();
  const armedSel = await win.evaluate(() => String(window.getSelection && window.getSelection().toString()));
  await win.mouse.move(span.x + 2, span.cy);
  await win.mouse.down();
  await win.mouse.move(span.x + span.w - 2, span.cy, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(500);
  const afterDrag = await win.evaluate(() => ({
    native: String(window.getSelection && window.getSelection().toString()),
    runBar: document.querySelectorAll('[data-content-action-bar="textrun"]').length,
    layerSpans: document.querySelectorAll('.page-slot[data-page="1"] .textLayer span').length,
  }));
  await check(
    'text layer (edit tool armed): overlay drives the gesture, layer intact',
    afterDrag.layerSpans > 0 && pageErrors.length === 0,
    `native="${afterDrag.native.slice(0, 30)}" runBar=${afterDrag.runBar} spans=${afterDrag.layerSpans}`,
    'tfl525-sweep-t6-armeddrag.png',
  );
  await win.screenshot({ path: path.join(SHOTS, 'tfl525-sweep-t6-armeddrag.png') });
  await win.evaluate(() => window.getSelection && window.getSelection().removeAllRanges());
  await win.locator('[data-content-action="textrun-cancel"]').first().click().catch(() => {});

  await check('T6: no page errors', pageErrors.length === 0, pageErrors.join(' | ') || 'none');
  expect(failures, failures.join('\n')).toEqual([]);
});

// ===========================================================================
// T7 — remaining matrix rows: paragraph controls (alignment / line spacing /
//      indent / underline), typing edge cases (unicode, punctuation,
//      backspace), double-click-to-edit, box resize, zoom with a box selected.
// ===========================================================================
async function previewPara() {
  return win.evaluate(() => {
    const el = document.querySelector('.edit-run-live-preview');
    if (!el) return null;
    const cs = getComputedStyle(el);
    const line = el.querySelector('.edit-run-line');
    const lcs = line ? getComputedStyle(line) : null;
    return {
      blockTextAlign: cs.textAlign,
      lineTextAlign: lcs ? lcs.textAlign : null,
      paddingLeft: parseFloat(cs.paddingLeft),
      lineHeight: line ? parseFloat(lcs.lineHeight) : null,
      blockTextDecoration: cs.textDecorationLine,
      lineTextDecoration: lcs ? lcs.textDecorationLine : null,
    };
  });
}

test('T7 paragraph controls, typing edge cases, double-click, resize, zoom', async () => {
  await armTextTool();
  const run = await findRunSpan();
  if (!run) { await check('T7: run discoverable', false, 'no run'); expect(failures).toEqual([]); return; }

  // double-click-to-edit
  await win.mouse.dblclick(run.cx, run.cy);
  await win.waitForSelector('[data-textrun-selection]', { timeout: 10000 }).catch(() => {});
  const dblSel = await runSelection();
  await check('double-click a run: opens the run edit session', dblSel !== null, JSON.stringify(dblSel), 'tfl525-sweep-t7-dblclick.png');

  const before = await previewPara();
  await check('T7: live preview present', before !== null, JSON.stringify(before), 'tfl525-sweep-t7-preview.png');

  // alignment
  await win.locator('[data-txt-align-center]').first().click().catch(() => {});
  await win.waitForTimeout(400);
  const pressedAlign = await win.locator('[data-txt-align-center]').first().getAttribute('aria-pressed');
  const afterAlign = await previewPara();
  await check(
    'format alignment: centre pressed and preview text-align centre',
    pressedAlign === 'true' && !!afterAlign && afterAlign.lineTextAlign === 'center',
    `pressed=${pressedAlign} align=${afterAlign && afterAlign.lineTextAlign}`,
    'tfl525-sweep-t7-align.png',
  );

  // line spacing
  await win.locator('[data-txt-line-height]').first().fill('2.5').catch(() => {});
  await win.waitForTimeout(450);
  const afterLh = await previewPara();
  await check(
    'format line spacing: preview line box grows',
    !!afterLh && afterLh.lineHeight !== null && !!before && before.lineHeight !== null && afterLh.lineHeight > before.lineHeight,
    `before=${before && before.lineHeight} after=${afterLh && afterLh.lineHeight}`,
    'tfl525-sweep-t7-lineheight.png',
  );

  // indent
  const indentBefore = await win.locator('[data-txt-indent-value]').first().textContent().catch(() => null);
  await win.locator('[data-txt-indent-inc]').first().click().catch(() => {});
  await win.waitForTimeout(400);
  const indentAfter = await win.locator('[data-txt-indent-value]').first().textContent().catch(() => null);
  const afterIndent = await previewPara();
  await check(
    'format indent: value increments and preview insets',
    indentBefore !== null && Number(indentAfter) > Number(indentBefore) && !!afterIndent && !!before && afterIndent.paddingLeft > before.paddingLeft,
    `valueBefore=${indentBefore} valueAfter=${indentAfter} padBefore=${before && before.paddingLeft} padAfter=${afterIndent && afterIndent.paddingLeft}`,
    'tfl525-sweep-t7-indent.png',
  );

  // underline
  await win.locator('[data-txt-underline]').first().click().catch(() => {});
  await win.waitForTimeout(400);
  const afterUnderline = await previewPara();
  await check(
    'format underline: preview band draws an underline',
    !!afterUnderline && (/underline/.test(afterUnderline.lineTextDecoration || '') || /underline/.test(afterUnderline.blockTextDecoration || '')),
    `line=${afterUnderline && afterUnderline.lineTextDecoration} block=${afterUnderline && afterUnderline.blockTextDecoration}`,
    'tfl525-sweep-t7-underline.png',
  );

  // typing: unicode + punctuation
  const UNI = 'Caf\u00e9 \u2014 \u201cquotes\u201d 123!@#';
  await typeIntoTextPanel(UNI);
  const uniPrev = await runPreviewText();
  await check(
    'typing unicode+punctuation: preview carries the exact characters',
    !!uniPrev && uniPrev.text.includes(UNI),
    JSON.stringify(uniPrev),
    'tfl525-sweep-t7-unicode.png',
  );

  // typing: backspace removes the last character
  const field = win.locator('[data-txt-text]').first();
  await field.click();
  await win.keyboard.press('End');
  await win.keyboard.press('Backspace');
  await win.waitForTimeout(400);
  const afterBs = await runPreviewText();
  await check(
    'typing backspace: last character removed',
    !!afterBs && afterBs.text.includes(UNI.slice(0, -1)) && !afterBs.text.includes(UNI),
    JSON.stringify(afterBs),
    'tfl525-sweep-t7-backspace.png',
  );
  await win.screenshot({ path: path.join(SHOTS, 'tfl525-sweep-t7-typing.png') });

  await win.locator('[data-content-action="textrun-cancel"]').first().click().catch(() => {});
  await win.waitForTimeout(500);

  // box resize (committed box, SE handle)
  await armBoxTool();
  await drawBox(0.3, 0.4, 220, 60);
  await typeIntoTextPanel('QQBOXSWEEP_RESIZE');
  await win.locator('[data-edit-box-action="confirm"]').first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
  await win.locator('[data-edit-box-action="confirm"]').first().click().catch(() => {});
  await win.waitForTimeout(1500);
  const b = await boxInfo('QQBOXSWEEP_RESIZE');
  if (b) {
    await win.mouse.click(b.cx, b.cy);
    await win.waitForTimeout(500);
    const handle = win.locator('[data-edit-box-handle="se"]').first();
    const hb = await handle.boundingBox().catch(() => null);
    if (hb) {
      await win.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
      await win.mouse.down();
      await win.mouse.move(hb.x + hb.width / 2 + 90, hb.y + hb.height / 2 + 50, { steps: 15 });
      await win.mouse.up();
      await win.waitForTimeout(700);
      await win.locator('[data-edit-box-action="confirm"]').first().click().catch(() => {});
      await win.waitForTimeout(1500);
      const after = await boxInfo('QQBOXSWEEP_RESIZE');
      await check(
        'box resize: SE handle drag grows the committed box',
        after !== null && after.w > b.w + 30 && after.h > b.h + 15,
        `before=${JSON.stringify(b)} after=${JSON.stringify(after)}`,
        'tfl525-sweep-t7-resize.png',
      );
      await win.screenshot({ path: path.join(SHOTS, 'tfl525-sweep-t7-resize.png') });
    } else {
      await check('box resize: SE handle present after selecting the box', false, 'no [data-edit-box-handle="se"]', 'tfl525-sweep-t7-resize.png');
    }
  } else {
    await check('box resize: committed box present', false, 'no .edit-box for QQBOXSWEEP_RESIZE', 'tfl525-sweep-t7-resize.png');
  }

  // zoom with the box selected
  const selBox = await boxInfo('QQBOXSWEEP_RESIZE');
  if (selBox) {
    await win.mouse.click(selBox.cx, selBox.cy);
    await win.waitForTimeout(300);
    await setZoom(150);
    const z = await zoomPercent();
    const after = await boxInfo('QQBOXSWEEP_RESIZE');
    await check(
      'zoom 150 with a box selected: box surface survives, no error',
      z === 150 && after !== null && pageErrors.length === 0,
      `zoom=${z} box=${after !== null} errors=${pageErrors.join('|') || 'none'}`,
      'tfl525-sweep-t7-zoom-box.png',
    );
    await win.screenshot({ path: path.join(SHOTS, 'tfl525-sweep-t7-zoom-box.png') });
  } else {
    await note('zoom 150 with a box selected', 'no box available');
  }

  await check('T7: no page errors', pageErrors.length === 0, pageErrors.join(' | ') || 'none');
  expect(failures, failures.join('\n')).toEqual([]);
});

// ===========================================================================
// T8 — pdf.js text-layer + annotation-layer integrity, and page scroll while
//      an edit session is live.
// ===========================================================================
test('T8 text-layer and annotation layer integrity', async () => {
  const annBefore = await win.locator('.annotation-layer').count();
  const spansBefore = await win.locator('.page-slot[data-page="1"] .textLayer span').count();
  await check('T8: pdf.js text layer present', spansBefore > 0, `spans=${spansBefore} annLayers=${annBefore}`);

  // live run edit then Cancel must leave the text layer intact
  await armTextTool();
  const run = await findRunSpan();
  if (!run) { await check('T8: run discoverable', false, 'no run'); expect(failures).toEqual([]); return; }
  await win.mouse.click(run.cx, run.cy);
  await win.waitForSelector('[data-textrun-selection]', { timeout: 10000 }).catch(() => {});
  await typeIntoTextPanel('QQLAYERDRAFT');
  await win.locator('[data-content-action="textrun-cancel"]').first().click().catch(() => {});
  await win.waitForTimeout(700);
  const spansAfter = await win.locator('.page-slot[data-page="1"] .textLayer span').count();
  const annAfter = await win.locator('.annotation-layer').count();
  await check(
    'Cancel: text-layer span count unchanged, annotation layer unaffected',
    spansAfter === spansBefore && annAfter === annBefore,
    `spans ${spansBefore}->${spansAfter} ann ${annBefore}->${annAfter}`,
    'tfl525-sweep-t8-layer.png',
  );

  // after leaving edit, native text-layer hit-test still works
  await gotoStage(win, 1);
  await win.waitForTimeout(500);
  const span = await win.evaluate(() => {
    const s = Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'))
      .find((x) => (x.textContent || '').trim().length >= 6);
    if (!s) return null;
    const r = s.getBoundingClientRect();
    return { text: s.textContent.trim(), x: r.x, y: r.y, w: r.width, h: r.height, cy: r.y + r.height / 2 };
  });
  if (span) {
    await win.mouse.move(span.x + 2, span.cy);
    await win.mouse.down();
    await win.mouse.move(span.x + span.w - 2, span.cy, { steps: 12 });
    await win.mouse.up();
    await win.waitForTimeout(350);
    const nativeSel = await win.evaluate(() => String(window.getSelection && window.getSelection().toString()));
    await check('after leaving edit: native text-layer selection still works', nativeSel.trim().length > 0, `selection="${nativeSel.trim().slice(0, 30)}"`, 'tfl525-sweep-t8-nativesel.png');
    await win.evaluate(() => window.getSelection && window.getSelection().removeAllRanges());
  } else {
    await note('after leaving edit: native text-layer selection', 'no run span');
  }

  // page scroll while a live box session is active must not error
  await armBoxTool();
  await drawBox(0.3, 0.5, 220, 60);
  await typeIntoTextPanel('QQSCROLLDRAFT');
  await win.mouse.wheel(0, 600);
  await win.waitForTimeout(500);
  await win.mouse.wheel(0, -600);
  await win.waitForTimeout(500);
  await check('page scroll while editing: no error', pageErrors.length === 0, pageErrors.join('|') || 'none', 'tfl525-sweep-t8-scroll.png');

  await check('T8: no page errors', pageErrors.length === 0, pageErrors.join(' | ') || 'none');
  expect(failures, failures.join('\n')).toEqual([]);
});
