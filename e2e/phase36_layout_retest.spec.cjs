// Phase 36 LAYOUT PASS retest — DEF-318, DEF-319, DEF-320, DEF-321.
//
// The LAYOUT PASS claims:
//   DEF-320  the 44px Stage Rail claims a REAL grid track beside the panel, so
//            the two never overlap and the collapse/expand control is clickable
//            in both states.
//   DEF-319  the floating pills live in a `.canvas-overlay` inset by the
//            Inspector, so every zoom/fit/pan control is hit-testable.
//   DEF-318  the re-parented annotations list is contained by its section, so
//            the Signatures action row below it is clickable.
//   DEF-321  ONE TextPropertiesPanel is visible per selection.
//
// Evidence-first: every test logs the raw geometry it observes before asserting.
// All launches go through the canonical launchApp helper (via launchDev).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, gotoStage } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const REPORT = path.join(ROOT, 'test-fixtures', 'report.pdf');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p36-layout');
  app = null;
  win = null;
});
test.setTimeout(240000);

async function openReport() {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, REPORT);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
}
const setSize = (w, h) => app.evaluate(({ BrowserWindow }, s) => {
  BrowserWindow.getAllWindows()[0].setSize(s[0], s[1]);
}, [w, h]);

// ---------------------------------------------------------------------------
// DEF-320 — the rail track and the collapse/expand control.
// ---------------------------------------------------------------------------
test('DEF-320: the Stage Rail and ContextPanel are adjacent (no overlap); collapse/expand works both ways', async () => {
  await openReport();
  const geom = await win.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width) };
    };
    const rail = r('[data-stage-rail]');
    const panel = r('[data-context-panel]');
    const overlap = rail && panel ? Math.max(0, Math.min(rail.right, panel.right) - Math.max(rail.left, panel.left)) : null;
    return { rail, panel, overlap };
  });
  console.log(`[DEF320] rail=${JSON.stringify(geom.rail)} panel=${JSON.stringify(geom.panel)} overlap=${geom.overlap}`);
  expect(geom.rail, 'the Stage Rail renders').not.toBeNull();
  expect(geom.panel, 'the ContextPanel renders').not.toBeNull();
  expect(geom.rail.w, 'the rail is 44px').toBeGreaterThanOrEqual(42);
  expect(geom.rail.w).toBeLessThanOrEqual(46);
  expect(geom.overlap, 'DEF-320: rail and panel do NOT overlap').toBe(0);
  expect(geom.rail.right, 'the panel starts at/after the rail right edge').toBeLessThanOrEqual(geom.panel.left + 1);

  // Collapse then expand through the SAME header control.
  const collapse = win.locator('[data-rail-collapse]').first();
  await expect(collapse).toBeVisible();
  const expandedW = geom.panel.w;
  await collapse.click();
  await win.waitForTimeout(600);
  const collapsed = await win.evaluate(() => {
    const p = document.querySelector('[data-context-panel]');
    const b = p.getBoundingClientRect();
    return { w: Math.round(b.width), attr: p.getAttribute('data-context-panel-collapsed') };
  });
  console.log(`[DEF320] collapsed=${JSON.stringify(collapsed)} (expanded was ${expandedW})`);
  expect(collapsed.attr, 'the collapsed attribute is set').toBe('true');
  expect(collapsed.w, 'the panel shrank').toBeLessThan(expandedW);

  // The expand control must be clickable in the collapsed state.
  const expand = win.locator('[data-rail-collapse]').first();
  await expect(expand).toBeVisible();
  const title = await expand.getAttribute('title');
  console.log(`[DEF320] collapsed control title=${JSON.stringify(title)}`);
  expect(title, 'the control now offers Expand').toBe('Expand panel');
  await expand.click();
  await win.waitForTimeout(600);
  const reExpanded = await win.evaluate(() => {
    const p = document.querySelector('[data-context-panel]');
    const b = p.getBoundingClientRect();
    return { w: Math.round(b.width), attr: p.getAttribute('data-context-panel-collapsed') };
  });
  console.log(`[DEF320] re-expanded=${JSON.stringify(reExpanded)}`);
  expect(reExpanded.attr, 'the collapsed attribute cleared').not.toBe('true');
  expect(reExpanded.w, 'the panel expanded back').toBeGreaterThan(collapsed.w + 40);
});

// ---------------------------------------------------------------------------
// DEF-319 — the zoom pill is hit-testable with the Inspector open, at the five
// supported widths, and its controls act.
// ---------------------------------------------------------------------------
test('DEF-319: every zoom-pill control is hit-testable with the Inspector open at 1440/1100/900/760/640', async () => {
  await openReport();
  for (const w of [1440, 1100, 900, 760, 640]) {
    await setSize(w, 900);
    await win.waitForTimeout(700);
    await win.waitForFunction((target) => Math.abs(window.innerWidth - target) < 60, w, { timeout: 10000 });
    const m = await win.evaluate(() => {
      const pill = document.querySelector('[data-zoom-pill]');
      if (pill === null) return { missing: true };
      const covered = [];
      for (const btn of pill.querySelectorAll('button')) {
        const r = btn.getBoundingClientRect();
        const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
        if (el === null || (el !== btn && btn.contains(el) === false)) {
          covered.push(`${btn.getAttribute('aria-label')} -> ${el ? el.tagName + '.' + String(el.className) : 'null'}`);
        }
      }
      const b = pill.getBoundingClientRect();
      return { vw: window.innerWidth, rect: { left: Math.round(b.left), right: Math.round(b.right) }, covered };
    });
    console.log(`[DEF319] w=${w} vw=${m.vw} zoomRect=${JSON.stringify(m.rect)} covered=${JSON.stringify(m.covered)}`);
    expect(m.missing, 'the zoom pill renders').toBeFalsy();
    expect(m.covered, `DEF-319: every zoom-pill control is hit-testable at ${w}px`).toEqual([]);
  }
  // The controls actually act at the default width.
  await setSize(1440, 900);
  await win.waitForTimeout(700);
  const pct = async () => parseInt(await win.locator('[data-zoom-pill] .zoom-percent').innerText(), 10);
  const before = await pct();
  await win.locator('[data-zoom-pill] [aria-label="Zoom in"]').click();
  await win.waitForTimeout(600);
  const after = await pct();
  console.log(`[DEF319] zoom ${before}% -> ${after}%`);
  expect(after, 'Zoom in acts').toBeGreaterThan(before);
  await win.locator('[data-zoom-pill] [aria-label="Fit width"]').click();
  await win.waitForTimeout(700);
  expect(await win.locator('[data-zoom-pill] [aria-label="Fit width"]').getAttribute('aria-pressed')).toBe('true');
});

// ---------------------------------------------------------------------------
// Page-pill clearance at 900px (the P36-C3-N failure): the dock wraps to two
// rows and the page pill's Next control was reported covered. Diagnose the
// exact covering element.
// ---------------------------------------------------------------------------
test('page-pill clearance at 900px: every page-pill control is hit-testable', async () => {
  await openReport();
  for (const w of [1440, 1100, 900, 760, 640]) {
    await setSize(w, 900);
    await win.waitForTimeout(800);
    await win.waitForFunction((target) => Math.abs(window.innerWidth - target) < 60, w, { timeout: 10000 });
    const m = await win.evaluate(() => {
      const dock = document.querySelector('[data-action-dock]');
      const dr = dock.getBoundingClientRect();
      const pill = document.querySelector('[data-page-pill]');
      const pr = pill.getBoundingClientRect();
      const covered = [];
      for (const btn of pill.querySelectorAll('button')) {
        const r = btn.getBoundingClientRect();
        const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
        if (el === null || (el !== btn && btn.contains(el) === false)) {
          covered.push({
            label: btn.getAttribute('aria-label'),
            btn: { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) },
            topEl: el ? `${el.tagName}.${String(el.className)}` : 'null',
          });
        }
      }
      return {
        vw: window.innerWidth,
        dock: { left: Math.round(dr.left), right: Math.round(dr.right), top: Math.round(dr.top), bottom: Math.round(dr.bottom) },
        pill: { left: Math.round(pr.left), right: Math.round(pr.right), top: Math.round(pr.top), bottom: Math.round(pr.bottom) },
        covered,
      };
    });
    console.log(`[PILL] w=${w} vw=${m.vw} dock=${JSON.stringify(m.dock)} pill=${JSON.stringify(m.pill)} covered=${JSON.stringify(m.covered)}`);
    expect(m.covered, `every page-pill control is hit-testable at ${w}px`).toEqual([]);
  }
});

// ---------------------------------------------------------------------------
// DEF-318 — the annotations list is contained; the Signatures action row is
// clickable.
// ---------------------------------------------------------------------------
test('DEF-318: the REVIEW annotations list is contained and Manage signatures is clickable', async () => {
  await openReport();
  await gotoStage(win, 3);
  await win.waitForTimeout(500);
  const diag = await win.evaluate(() => {
    const r = (el) => {
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) };
    };
    const wrap = document.querySelector('[data-context-panel-annotations]');
    const btn = document.querySelector('[data-context-panel-action="manage-signatures"]');
    const bb = btn ? btn.getBoundingClientRect() : null;
    const top = bb ? document.elementFromPoint(Math.round(bb.x + bb.width / 2), Math.round(bb.y + bb.height / 2)) : null;
    return {
      wrapper: r(wrap),
      button: r(btn),
      topEl: top ? `${top.tagName}.${String(top.className)}` : null,
      buttonHit: !!(top && btn && (top === btn || btn.contains(top))),
    };
  });
  console.log(`[DEF318] wrapper=${JSON.stringify(diag.wrapper)} button=${JSON.stringify(diag.button)} topEl=${diag.topEl} hit=${diag.buttonHit}`);
  expect(diag.wrapper, 'the annotations wrapper renders').not.toBeNull();
  expect(diag.wrapper.h, 'DEF-318: the annotations wrapper has real height').toBeGreaterThan(0);
  expect(diag.buttonHit, 'DEF-318: Manage signatures is the top element at its centre').toBe(true);
  await win.locator('[data-context-panel-action="manage-signatures"]').click();
  await win.waitForSelector('.sig-manager', { state: 'visible', timeout: 8000 });
  console.log('[DEF318] Manage signatures opened the manager');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(400);
});

// ---------------------------------------------------------------------------
// DEF-321 — ONE TextPropertiesPanel per selection.
// ---------------------------------------------------------------------------
test('DEF-321: exactly ONE TextPropertiesPanel is visible for a selected text object', async () => {
  await openReport();
  await gotoStage(win, 2);
  await win.locator('[data-dock-verb="editMode"]').click();
  await win.waitForTimeout(900);
  await win.locator('[data-dock-verb="editTextBox"]').click();
  await win.waitForTimeout(500);
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  await win.mouse.click(Math.round(pg.x + pg.width * 0.4), Math.round(pg.y + pg.height * 0.3));
  await win.waitForTimeout(1200);
  const dup = await win.evaluate(() => {
    const panels = [...document.querySelectorAll('.text-props-panel')];
    const visible = panels.filter((p) => {
      const b = p.getBoundingClientRect();
      return b.width > 0 && b.height > 0;
    });
    return {
      total: panels.length,
      visible: visible.length,
      inInspector: panels.filter((p) => p.closest('[data-inspector]')).length,
      txtText: document.querySelectorAll('[data-txt-text]').length,
      rects: visible.map((p) => {
        const b = p.getBoundingClientRect();
        return { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x) };
      }),
    };
  });
  console.log(`[DEF321] text-props panels: ${JSON.stringify(dup)}`);
  expect(dup.visible, 'DEF-321: exactly ONE visible TextPropertiesPanel').toBe(1);
  expect(dup.txtText, 'DEF-321: exactly ONE [data-txt-text] field').toBe(1);
});
