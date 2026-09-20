// QA triage probe round 4: callout on a scrolled page, drag point INSIDE viewport.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
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

test('R3: callout drag on scrolled page 4, drag point INSIDE viewport', async () => {
  test.setTimeout(180000);
  await openSampleCard('report.pdf');

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
  await win.waitForTimeout(1500);

  const pr = await win.evaluate(() => {
    const s = document.querySelector('.page-slot[data-page="4"]');
    if (!s) return null;
    const c = s.querySelector('canvas');
    if (!c) return { mounted: true, hasCanvas: false };
    const r = c.getBoundingClientRect();
    return { mounted: true, hasCanvas: true, x: r.x, y: r.y, w: r.width, h: r.height, vh: window.innerHeight, vw: window.innerWidth };
  });
  console.log('[R3] page4 rect: ' + JSON.stringify(pr));
  if (!pr || !pr.hasCanvas) throw new Error('page 4 not mounted with canvas');

  // Drag from 15% height (safely inside the viewport), anchored at 25% width.
  const ax = pr.x + pr.w * 0.25;
  const ay = pr.y + pr.h * 0.15;
  console.log('[R3] drag from (' + Math.round(ax) + ',' + Math.round(ay) + ') viewport h=' + pr.vh);
  if (ay > pr.vh - 20) throw new Error('drag anchor still below viewport: ' + ay);

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
  console.log('[R3] after drag: ' + JSON.stringify(editor));
  await win.screenshot({ path: 'screenshots/probe190_r3_callout.png' });
  expect(editor.inCanvasEditor, 'Phase 26: no in-canvas callout editor mounts').toBe(0);
  expect(editor.panelEnabled, 'Phase 26: the panel Text field is the callout editor').toBe(true);
});
