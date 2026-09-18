// QA triage probe for the 1.9.0 full-suite run (Sep 2026).
// One app session per test; instrumented replicas of the failing flows to
// adjudicate product bug vs stale test. Only qa writes this file.
const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, armAnnotationTool } = require('./lib/helpers.cjs');

let electronApp = null;
let win = null;

test.beforeEach(async () => {
  electronApp = await launchApp([]);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  await win.waitForTimeout(800);
});

test.afterEach(async () => {
  await hardClose(electronApp);
  electronApp = null;
  win = null;
});

async function openSampleViaDialog(name) {
  const p = getSamplePath(name);
  await electronApp.evaluate(async ({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, p);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);
  return p;
}

// ---------------------------------------------------------------------------
// T1: DEF-153 edit-text interaction model guard:
//     single click selects the run, double click opens the inline editor.
// (Adjudicates the pre-DEF-153 "editor did not open" retest family.)
// ---------------------------------------------------------------------------
test('T1: edit-text editor open (def_108 replica, instrumented)', async () => {
  test.setTimeout(120000);
  await openSampleViaDialog('report.pdf');
  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]');
  await win.click('[data-edit-tool="text"]');
  await win.waitForTimeout(300);

  const probe = await win.evaluate(() => {
    const out = { spans: [], viewport: { w: window.innerWidth, h: window.innerHeight } };
    document.querySelectorAll('.textLayer span').forEach((s) => {
      const r = s.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        out.spans.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), text: (s.textContent || '').trim().slice(0, 40) });
      }
    });
    return out;
  });
  console.log('[T1] viewport=' + JSON.stringify(probe.viewport) + ' spans=' + probe.spans.length);
  console.log('[T1] first 8 spans: ' + JSON.stringify(probe.spans.slice(0, 8)));

  // def_108 findTitleRun logic verbatim
  const spans = probe.spans;
  let s = spans.find((x) => /technical\s*report/i.test(x.text) || x.text.includes('TFlex'));
  if (!s) s = spans.find((x) => x.y >= 300 && x.w > 150);
  if (!s) s = spans.find((x) => x.w > 100 && x.w >= (spans.reduce((m, y) => Math.max(m, y.w), 0)));
  if (!s) throw new Error('T1: no title span found');
  console.log('[T1] chosen span: ' + JSON.stringify(s));

  await win.mouse.move(s.x + s.w / 2, s.y + s.h / 2);
  await win.waitForTimeout(400);
  const hover = await win.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    const hoverHint = !!document.querySelector('.edit-text-hover');
    return { hit: el ? el.tagName + '.' + String(el.className).slice(0, 50) : null, hoverHint };
  }, [s.x + s.w / 2, s.y + s.h / 2]);
  console.log('[T1] hover: ' + JSON.stringify(hover));

  await win.mouse.click(s.x + s.w / 2, s.y + s.h / 2);
  await win.waitForTimeout(600);
  const after = await win.evaluate(() => ({
    editors: Array.from(document.querySelectorAll('[data-edit-editor]')).map((e) => e.getAttribute('data-edit-editor')),
    anyEditorEl: !!document.querySelector('.edit-inline-editor'),
    // DEF-153 model: single click SELECTS the run (movable selection + bar).
    runSelection: !!document.querySelector('[data-textrun-selection]'),
    activeTool: (window.tflexDiagnostics() || {}).activeTool,
  }));
  console.log('[T1] after single click: ' + JSON.stringify(after));
  expect(after.runSelection, 'DEF-153: single click must SELECT the run (selection surface appears)').toBe(true);
  expect(after.anyEditorEl, 'DEF-153: single click must NOT open the inline editor').toBe(false);

  // DEF-153 model: DOUBLE click on the run opens the inline editor.
  await win.mouse.dblclick(s.x + s.w / 2, s.y + s.h / 2, { delay: 60 });
  await win.waitForTimeout(700);
  const afterDbl = await win.evaluate(() => ({
    editors: Array.from(document.querySelectorAll('[data-edit-editor]')).map((e) => e.getAttribute('data-edit-editor')),
    anyEditorEl: !!document.querySelector('.edit-inline-editor'),
    textareaValue: (document.querySelector('.edit-inline-editor textarea') || {}).value ?? null,
  }));
  console.log('[T1] after double click: ' + JSON.stringify(afterDbl));
  await win.screenshot({ path: 'screenshots/probe190_t1_edittext.png' });
  expect(
    afterDbl.anyEditorEl && afterDbl.editors.includes('edit'),
    'DEF-153: double click must open the inline editor pre-filled with the run text',
  ).toBe(true);
  expect(afterDbl.textareaValue, 'editor must be pre-filled with the clicked run text').toContain('TFlex Technical Report');
});

// ---------------------------------------------------------------------------
// T2: fresh report.pdf - main-view textLayer of slots 2/3 after scrolling
// (DEF-139 family: is the text layer lazily rendered or genuinely empty?).
// ---------------------------------------------------------------------------
test('T2: main-view textLayer slots 2/3 on fresh report.pdf', async () => {
  test.setTimeout(120000);
  await openSampleViaDialog('report.pdf');

  async function slotInfo(n) {
    return win.evaluate((want) => {
      const s = document.querySelector(`.page-slot[data-page="${want}"]`);
      if (!s) return { mounted: false };
      const spans = s.querySelectorAll('.textLayer span');
      const canvas = s.querySelector('canvas');
      let text = '';
      spans.forEach((sp) => { text += sp.textContent || ''; });
      return {
        mounted: true,
        spanCount: spans.length,
        text: text.replace(/[ \t\r\n]+/g, ' ').trim().slice(0, 60),
        hasCanvas: !!canvas,
        canvasW: canvas ? canvas.width : 0,
      };
    }, n);
  }

  console.log('[T2] initial slots: ' + JSON.stringify({ s1: await slotInfo(1), s2: await slotInfo(2), s3: await slotInfo(3) }));

  // Scroll slot 2 to top exactly like def_139 scrollToPage
  await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector('.page-slot[data-page="2"]');
    if (sc && slot) sc.scrollTop = slot.offsetTop - 100;
  });
  await win.waitForTimeout(2500);
  console.log('[T2] after scroll to slot 2 (2.5s): ' + JSON.stringify({ s2: await slotInfo(2), s3: await slotInfo(3) }));

  // Nudge scroll down a bit to bring slot 3 into view, wait longer.
  await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector('.page-slot[data-page="3"]');
    if (sc && slot) sc.scrollTop = slot.offsetTop - 200;
  });
  await win.waitForTimeout(3000);
  console.log('[T2] after scroll to slot 3 (3s): ' + JSON.stringify({ s2: await slotInfo(2), s3: await slotInfo(3) }));
  await win.screenshot({ path: 'screenshots/probe190_t2_textlayer.png' });
  // Soft check: slot 3 should have text once in view (defensive: this asserts
  // the text layer renders; a failure here is a product bug).
  const s3 = await slotInfo(3);
  expect(s3.mounted && s3.spanCount > 0, 'slot 3 textLayer must render once scrolled into view').toBe(true);
});

// ---------------------------------------------------------------------------
// T3: empty tab state (B11 premise): what exists after clicking '+'.
// ---------------------------------------------------------------------------
test('T3: empty tab surface (B11 premise check)', async () => {
  test.setTimeout(120000);
  await openSampleViaDialog('report.pdf');
  await win.click('[data-new-tab]');
  await win.waitForTimeout(1200);
  const state = await win.evaluate(() => ({
    toolbarCount: document.querySelectorAll('[data-tools-toggle]').length,
    paletteCount: document.querySelectorAll('[data-tools-palette]').length,
    welcomeCount: document.querySelectorAll('.welcome').length,
    workspaceCount: document.querySelectorAll('.workspace').length,
    titlebarMenu: !!document.querySelector('.titlebar-menu-button'),
    tabs: Array.from(document.querySelectorAll('.tab')).map((t) => t.textContent && t.textContent.trim().slice(0, 20)),
  }));
  console.log('[T3] empty tab state: ' + JSON.stringify(state));
  await win.screenshot({ path: 'screenshots/probe190_t3_emptytab.png' });
});

// ---------------------------------------------------------------------------
// T4: diagnostics.activeTool shape after tab close (DEF-097 strict null).
// ---------------------------------------------------------------------------
test('T4: activeTool diagnostic shape after tab close (DEF-097)', async () => {
  test.setTimeout(120000);
  await openSampleViaDialog('report.pdf');
  await win.click('button[data-tool="highlight"]');
  await win.waitForTimeout(400);
  const before = await win.evaluate(() => window.tflexDiagnostics());
  console.log('[T4] activeTool before close: ' + JSON.stringify(before.activeTool));
  await win.click('.tab-close');
  await win.waitForTimeout(1200);
  const after = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return { raw: d.activeTool, isNull: d.activeTool === null, isUndefined: d.activeTool === undefined, typeof: typeof d.activeTool };
  });
  console.log('[T4] after close: ' + JSON.stringify(after));
});

// ---------------------------------------------------------------------------
// T5: titlebar drag region (BUG1 premise): computed app-region of titlebar.
// ---------------------------------------------------------------------------
test('T5: titlebar drag region (BUG1 premise check)', async () => {
  test.setTimeout(120000);
  const state = await win.evaluate(() => {
    const out = {};
    const tb = document.querySelector('.titlebar');
    out.titlebar = tb ? getComputedStyle(tb).webkitAppRegion || getComputedStyle(tb)['-webkit-app-region'] : null;
    const slot = document.querySelector('[class*="titlebar"]');
    out.slotClass = slot ? slot.className : null;
    // Any element with no-drag in the titlebar area
    const nd = document.querySelectorAll('[style*="app-region"], [class*="no-drag"]');
    out.noDragCount = nd.length;
    return out;
  });
  console.log('[T5] titlebar: ' + JSON.stringify(state));
});

// ---------------------------------------------------------------------------
// T6: note editor buttons after placing a note (B4 premise).
// ---------------------------------------------------------------------------
test('T6: note editor action buttons (B4 premise check)', async () => {
  test.setTimeout(120000);
  await openSampleViaDialog('report.pdf');
  await armAnnotationTool(win, 'note');
  await win.waitForTimeout(400);
  const page = await win.evaluate(() => {
    const c = document.querySelector('.page-slot[data-page="1"] canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  if (!page) throw new Error('no page canvas');
  await win.mouse.click(page.x + 150, page.y + 150);
  await win.waitForTimeout(600);
  const editor = await win.evaluate(() => {
    const ed = document.querySelector('[data-annotation-editor="note"]');
    if (!ed) return { open: false };
    return {
      open: true,
      buttons: Array.from(ed.querySelectorAll('button')).map((b) => ({ text: (b.textContent || '').trim(), action: b.getAttribute('data-annotation-action') })),
    };
  });
  console.log('[T6] note editor: ' + JSON.stringify(editor));
  await win.screenshot({ path: 'screenshots/probe190_t6_note.png' });
});

// ---------------------------------------------------------------------------
// T7: merge dialog inputs (B12 premise): what does the dialog contain?
// ---------------------------------------------------------------------------
test('T7: merge dialog input names (B12 premise check)', async () => {
  test.setTimeout(120000);
  await openSampleViaDialog('report.pdf');
  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]');
  await win.click('button[data-tool-id="merge"]');
  await win.waitForSelector('.merge-dialog', { timeout: 10000 });
  await win.waitForTimeout(500);
  const dialog = await win.evaluate(() => {
    const d = document.querySelector('.merge-dialog');
    return {
      inputs: Array.from(d.querySelectorAll('input')).map((i) => ({ name: i.name, type: i.type, aria: i.getAttribute('aria-label'), visible: i.offsetParent !== null })),
      classes: d.className,
    };
  });
  console.log('[T7] merge dialog: ' + JSON.stringify(dialog));
  await win.screenshot({ path: 'screenshots/probe190_t7_merge.png' });
});
