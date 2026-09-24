// Focused product probe (qa) — the ContextPanel's state on a FRESH profile.
//
// Question: does the PAGES ContextPanel open EXPANDED (thumbnails visible) on a
// fresh launch, and does the [data-rail-collapse] control work both ways?
//
// One fresh temp profile per launch via the canonical launchApp helper (no
// userDataDir argument -> unique temp dir, no prior session state). One sample
// opened through the visible welcome card. Raw numbers are logged for every
// state; the assertions encode the expected product behaviour.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'def-panel-fresh');
  app = null;
  win = null;
});

test.setTimeout(180000);

// Raw snapshot of the panel + the collapse affordance. Reads every selector the
// dispatch names, plus the computed panel width and the app-main rail flag.
async function snap(label) {
  return win.evaluate((lbl) => {
    const panel = document.querySelector('[data-context-panel]');
    const appMain = document.querySelector('.app-main');
    const thumbs = document.querySelector('[data-context-panel-thumbs]');
    const panelRuler = document.querySelector('[data-context-panel-ruler]');
    const railRuler = document.querySelector('[data-rail-ruler]');
    const collapse = document.querySelector('[data-rail-collapse]');
    const rr = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const cs = panel ? getComputedStyle(panel) : null;
    return {
      label: lbl,
      panelFound: !!panel,
      panelStage: panel ? panel.getAttribute('data-context-panel-stage') : null,
      panelCollapsedAttr: panel ? panel.getAttribute('data-context-panel-collapsed') : null,
      appMainRailCollapsed: appMain ? appMain.getAttribute('data-rail-collapsed') : null,
      panelRect: rr(panel),
      panelComputedWidth: cs ? cs.width : null,
      thumbsFound: !!thumbs,
      thumbsRect: rr(thumbs),
      panelThumbItemCount: panel ? panel.querySelectorAll('.thumb-item').length : 0,
      pageThumbItemCount: document.querySelectorAll('.thumb-item').length,
      panelRulerFound: !!panelRuler,
      panelRulerRect: rr(panelRuler),
      railRulerFound: !!railRuler,
      collapseFound: !!collapse,
      collapseRect: rr(collapse),
      collapseAriaLabel: collapse ? collapse.getAttribute('aria-label') : null,
    };
  }, label);
}

function log(s) {
  console.log(`[PANEL-FRESH] ${s.label}: ${JSON.stringify(s)}`);
}

test('fresh profile: PAGES panel opens expanded and collapse/expand works both ways', async () => {
  // Open a document through the visible welcome sample card.
  await win.locator('.sample-card').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('[data-context-panel]', { state: 'visible', timeout: 20000 });
  await win.waitForTimeout(1500);

  const initial = await snap('initial-after-open');
  log(initial);

  // 1. Initial state must be EXPANDED: thumbnails present, ruler absent.
  expect(initial.panelFound, 'the ContextPanel is mounted').toBe(true);
  expect(initial.thumbsFound, 'initial: [data-context-panel-thumbs] present (expanded)').toBe(true);
  expect(initial.panelThumbItemCount, 'initial: page thumbnails are rendered').toBeGreaterThan(0);
  expect(initial.panelCollapsedAttr, 'initial: no collapsed attribute').toBeNull();
  expect(initial.panelRulerFound, 'initial: collapsed ruler absent').toBe(false);
  expect(initial.collapseFound, 'initial: [data-rail-collapse] present').toBe(true);
  expect(initial.collapseAriaLabel, 'initial: control offers Collapse').toBe('Collapse panel');

  // 2. Collapse via the real control: ruler replaces thumbnails.
  await win.locator('[data-rail-collapse]').click();
  await win.waitForTimeout(700);
  const afterCollapse = await snap('after-collapse-click');
  log(afterCollapse);
  expect(afterCollapse.panelCollapsedAttr, 'collapse: collapsed attribute set').toBe('true');
  expect(afterCollapse.thumbsFound, 'collapse: thumbnails hidden').toBe(false);
  expect(afterCollapse.panelRulerFound, 'collapse: ruler shown').toBe(true);
  expect(afterCollapse.collapseAriaLabel, 'collapse: control now offers Expand').toBe('Expand panel');

  // 3. Expand again: thumbnails must return.
  await win.locator('[data-rail-collapse]').click();
  await win.waitForTimeout(700);
  const afterExpand = await snap('after-expand-click');
  log(afterExpand);
  expect(afterExpand.panelCollapsedAttr, 'expand: collapsed attribute cleared').toBeNull();
  expect(afterExpand.thumbsFound, 'expand: [data-context-panel-thumbs] returns').toBe(true);
  expect(afterExpand.panelThumbItemCount, 'expand: page thumbnails return').toBeGreaterThan(0);
  expect(afterExpand.panelRulerFound, 'expand: ruler hidden again').toBe(false);
  expect(afterExpand.collapseAriaLabel, 'expand: control offers Collapse again').toBe('Collapse panel');

  console.log('[PANEL-FRESH] SUMMARY initialExpanded=' + initial.thumbsFound
    + ' collapsed=' + afterCollapse.panelCollapsedAttr
    + ' expandedAgain=' + afterExpand.thumbsFound
    + ' widths=' + JSON.stringify([initial.panelRect && initial.panelRect.w, afterCollapse.panelRect && afterCollapse.panelRect.w, afterExpand.panelRect && afterExpand.panelRect.w]));
});
