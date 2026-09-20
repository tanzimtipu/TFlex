// QA triage probe round 3 for the 1.9.0 full-suite run.
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

async function openSampleCard(name) {
  await win.locator(`.sample-card:has-text("${name}")`).first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2000);
}

// ---------------------------------------------------------------------------
// R1: callout creation on scrolled page 4 (def_154_157 T1 adjudication).
// DEF-153-era flows used a drag anchor at 50% page height, which falls BELOW
// the viewport (page canvas is ~1496 CSS px tall). The drag anchor here is
// clamped to 15% page height so it is guaranteed on-screen; a hard error is
// thrown if it is not, so a scroll-drift regression cannot silently pass.
// ---------------------------------------------------------------------------
test('R1: callout drag on scrolled page 4 opens editor?', async () => {
  test.setTimeout(180000);
  await openSampleCard('report.pdf');

  // def_139-style scrollToPage(4)
  for (let i = 0; i < 60; i += 1) {
    const done = await win.evaluate((want) => {
      const sc = document.querySelector('.document-scroller');
      if (!sc) return true;
      const slot = document.querySelector(`.page-slot[data-page="${want}"]`);
      if (slot) { sc.scrollTop = slot.offsetTop - 100; return true; }
      sc.scrollTop += 1400;
      return false;
    }, 4);
    await win.waitForTimeout(250);
    if (done) break;
  }
  await win.waitForTimeout(1200);
  await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const slot = document.querySelector('.page-slot[data-page="4"]');
    if (sc && slot) sc.scrollTop = slot.offsetTop - 120;
  });
  await win.waitForTimeout(1200);

  const pr = await win.evaluate(() => {
    const s = document.querySelector('.page-slot[data-page="4"]');
    if (!s) return null;
    const c = s.querySelector('canvas');
    if (!c) return { mounted: true, hasCanvas: false };
    const r = c.getBoundingClientRect();
    return { mounted: true, hasCanvas: true, x: r.x, y: r.y, w: r.width, h: r.height, vh: window.innerHeight };
  });
  console.log('[R1] page4 rect: ' + JSON.stringify(pr));
  if (!pr || !pr.hasCanvas) throw new Error('page 4 not mounted with canvas');

  // Drag from 15% height - MUST be inside the viewport, hard-fail otherwise.
  const ax = pr.x + pr.w * 0.25;
  const ay = pr.y + pr.h * 0.15;
  console.log('[R1] drag from (' + Math.round(ax) + ',' + Math.round(ay) + ') viewport h=' + pr.vh);
  if (ay > pr.vh - 20) throw new Error('drag anchor below viewport (scroll drift): ' + ay);

  // arm callout tool
  await armAnnotationTool(win, 'callout');
  await win.waitForTimeout(400);
  await win.mouse.move(ax, ay);
  await win.mouse.down();
  await win.mouse.move(ax + 180, ay + 90, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(800);
  const editor = await win.evaluate(() => ({
    inCanvasEditor: document.querySelectorAll('[data-annotation-editor]').length,
    panelField: !!document.querySelector('[data-txt-text]'),
    panelEnabled: document.querySelector('[data-txt-text]')?.disabled === false,
    activeTool: (window.tflexDiagnostics() || {}).activeTool,
  }));
  console.log('[R1] after drag: ' + JSON.stringify(editor));
  await win.screenshot({ path: 'screenshots/probe190_r1_callout.png' });
  expect(editor.inCanvasEditor, 'Phase 26: no in-canvas callout editor mounts').toBe(0);
  expect(editor.panelEnabled, 'Phase 26: the panel Text field is the callout editor').toBe(true);
});

// ---------------------------------------------------------------------------
// R2: insert blank after page 1 -> dump pageOrder (release_gate B7 replica).
// ---------------------------------------------------------------------------
test('R2: insert blank after page 1 - pageOrder shape (B7 replica)', async () => {
  test.setTimeout(180000);
  await openSampleCard('report.pdf');
  const e0 = await win.evaluate(() => window.tflexDiagnostics());
  console.log('[R2] before: pageCount=' + e0.pageCount + ' order=' + JSON.stringify((e0.engineState || {}).pageOrder));

  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]');
  await win.click('[data-tool-id="insertPages"]');
  await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-insert-mode="blank"]');
  await win.waitForTimeout(200);
  await win.fill('[data-insert-position]', '2');
  await win.waitForTimeout(300);
  await win.click('[data-insert-confirm]');
  await win.waitForTimeout(3000);

  const e1 = await win.evaluate(() => window.tflexDiagnostics());
  console.log('[R2] after: pageCount=' + e1.pageCount + ' order=' + JSON.stringify((e1.engineState || {}).pageOrder));
  const order = (e1.engineState || {}).pageOrder || [];
  console.log('[R2] order[0]=' + order[0] + ' order[1]=' + order[1] + ' (B7 expected 0 / ' + e0.pageCount + ')');
});
