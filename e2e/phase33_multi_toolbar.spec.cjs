// Phase 33 e2e (spec 3 of 4) — criterion 3: ONE shared toolbar in Multi Mode.
//
// In Multi Mode assert exactly ONE [data-shared-toolbar] and that no per-pane
// .toolbar / [data-annotation-toolbar] rows remain; arm an annotation tool in
// the shared bar and apply it in pane A (assert the annotation exists on A's
// document and NOT on B's), then the same in pane B; assert the page-op
// controls still act on the focused pane.
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { twoPaneSetup, focusPaneByPage } = require('./lib/p33_common.cjs');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p33-toolbar');
  app = null;
  win = null;
});
test.setTimeout(240000);

async function anns() {
  return win.evaluate(() => {
    const es = window.tflexDiagnostics().engineState || {};
    return (es.annotations || []).map((a) => ({ id: a.id, kind: a.kind, page: a.page }));
  });
}
async function rotations() {
  return win.evaluate(() => {
    const es = window.tflexDiagnostics().engineState || {};
    return (es.rotations || []).slice(0, 3);
  });
}
async function toolPressed(kind) {
  const btn = win.locator(`[data-ann-tools-visible] button[data-tool="${kind}"]`);
  if ((await btn.count()) === 0) return null;
  return (await btn.first().getAttribute('aria-pressed')) === 'true';
}
async function setTool(kind, want) {
  const btn = win.locator(`[data-ann-tools-visible] button[data-tool="${kind}"]`);
  if ((await btn.count()) === 0) throw new Error(`annotation tool ${kind} not visible in the shared bar`);
  const pressed = (await btn.first().getAttribute('aria-pressed')) === 'true';
  if (pressed !== want) {
    await btn.first().click();
    await win.waitForTimeout(300);
  }
}
async function drawOnPane(pane, dx = 130, dy = 70) {
  const page = win.locator(`.tab-pane[data-pane="${pane}"] .pdf-page`).first();
  await page.scrollIntoViewIfNeeded().catch(() => {});
  const box = await page.boundingBox();
  if (box === null) throw new Error(`drawOnPane: no page in pane ${pane}`);
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(30, Math.min(box.x + box.width * 0.3, vp.w - 220));
  const y = Math.max(110, Math.min(box.y + box.height * 0.3, vp.h - 160));
  console.log(`[P33-toolbar] drawOnPane ${pane}: pageBox=${JSON.stringify({ x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) })} from=(${Math.round(x)},${Math.round(y)})`);
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dx, y + dy, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(800);
}

test('C3 one shared toolbar; annotation tools apply per pane; page ops act on the focused pane', async () => {
  await twoPaneSetup(app, win);

  // ---- exactly ONE toolbar, no per-pane rows ----------------------------
  const counts = await win.evaluate(() => ({
    sharedToolbar: document.querySelectorAll('[data-shared-toolbar]').length,
    multiToolbar: document.querySelectorAll('[data-multi-toolbar]').length,
    toolbars: document.querySelectorAll('.toolbar').length,
    annToolbars: document.querySelectorAll('[data-annotation-toolbar]').length,
    paneToolbars: document.querySelectorAll('.tab-pane[data-pane] .toolbar').length,
    paneAnnToolbars: document.querySelectorAll('.tab-pane[data-pane] [data-annotation-toolbar]').length,
    sharedInsidePane: document.querySelectorAll('.tab-pane[data-pane] [data-shared-toolbar]').length,
  }));
  console.log(`[P33-toolbar] counts=${JSON.stringify(counts)}`);
  expect(counts.sharedToolbar, 'exactly one shared toolbar').toBe(1);
  expect(counts.multiToolbar, 'exactly one multi-toolbar').toBe(1);
  expect(counts.toolbars, 'exactly one .toolbar in the workspace').toBe(1);
  expect(counts.annToolbars, 'exactly one annotation toolbar').toBe(1);
  expect(counts.paneToolbars, 'no per-pane .toolbar rows remain').toBe(0);
  expect(counts.paneAnnToolbars, 'no per-pane annotation toolbars remain').toBe(0);
  expect(counts.sharedInsidePane, 'the shared toolbar is not inside a pane').toBe(0);

  // ---- annotation tool applies to pane A, not B -------------------------
  await setTool('ink', true);
  expect(await toolPressed('ink'), 'ink armed in the shared bar').toBe(true);
  await drawOnPane('A');
  const aAnns = await anns();
  console.log(`[P33-toolbar] after drawing in A: A annotations=${JSON.stringify(aAnns)}`);
  expect(aAnns.length, 'pane A gained exactly one annotation').toBe(1);
  expect(aAnns[0].kind, 'pane A annotation is an ink stroke').toBe('ink');

  // Disarm, then focus B WITHOUT drawing: B must have no annotation.
  await setTool('ink', false);
  await focusPaneByPage(win, 'B');
  const bAnns0 = await anns();
  console.log(`[P33-toolbar] pane B after A's draw (no draw in B): B annotations=${JSON.stringify(bAnns0)}`);
  expect(bAnns0.length, 'pane B did NOT receive A\'s annotation').toBe(0);

  // ---- the same tool applies to pane B ----------------------------------
  await setTool('ink', true);
  await drawOnPane('B');
  const bAnns1 = await anns();
  console.log(`[P33-toolbar] after drawing in B: B annotations=${JSON.stringify(bAnns1)}`);
  expect(bAnns1.length, 'pane B gained exactly one annotation').toBe(1);
  expect(bAnns1[0].kind, 'pane B annotation is an ink stroke').toBe('ink');

  // A still holds exactly its own one annotation.
  await setTool('ink', false);
  await focusPaneByPage(win, 'A');
  const aAnns2 = await anns();
  console.log(`[P33-toolbar] pane A after B's draw: A annotations=${JSON.stringify(aAnns2)}`);
  expect(aAnns2.length, 'pane A still holds exactly one annotation').toBe(1);

  // ---- page-op controls act on the focused pane -------------------------
  await focusPaneByPage(win, 'B');
  await win.locator('[data-shared-toolbar] [data-toolbar-rotate-cw]').first().click();
  await win.waitForTimeout(1200);
  const bRot = await rotations();
  console.log(`[P33-toolbar] after shared rotate with B focused: B rotations=${JSON.stringify(bRot)}`);
  expect(bRot[0], 'pane B rotated').toBe(1);
  await focusPaneByPage(win, 'A');
  const aRot = await rotations();
  console.log(`[P33-toolbar] pane A rotations after B rotate=${JSON.stringify(aRot)}`);
  expect(aRot[0], 'pane A untouched by the B rotate').toBe(0);

  // ---- geometry: the shared toolbar must sit ABOVE both panes -----------
  // Asserted last so the criterion-3 substance above is exercised even while
  // the DEF-282 overlap regression is present.
  const geom = await win.evaluate(() => {
    const rect = (el) => {
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) };
    };
    return {
      toolbar: rect(document.querySelector('[data-shared-toolbar]')),
      headerA: rect(document.querySelector('.tab-pane[data-pane="A"] [data-pane-header]')),
      headerB: rect(document.querySelector('.tab-pane[data-pane="B"] [data-pane-header]')),
    };
  });
  console.log(`[P33-toolbar] geometry=${JSON.stringify(geom)}`);
  expect(geom.toolbar, 'shared toolbar present').not.toBeNull();
  expect(geom.headerA, 'pane A header present').not.toBeNull();
  expect(geom.headerB, 'pane B header present').not.toBeNull();
  // "above both panes": the toolbar must not overlap the pane headers.
  expect(
    geom.toolbar.bottom,
    `shared toolbar overlaps pane A header (toolbar bottom ${geom.toolbar.bottom} > header top ${geom.headerA.top})`,
  ).toBeLessThanOrEqual(geom.headerA.top);
  expect(
    geom.toolbar.bottom,
    `shared toolbar overlaps pane B header (toolbar bottom ${geom.toolbar.bottom} > header top ${geom.headerB.top})`,
  ).toBeLessThanOrEqual(geom.headerB.top);
});