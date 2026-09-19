// FIX-READY retest for DEF-251 (annotation text tool disarms -> text panel
// closes immediately on placement) and DEF-252 (the close's 248px page reflow
// glitches the page so the immediate follow-up click on the placed annotation
// misses / does not select).
//
// Independent measurement in the REAL dev app (canonical launchDev only):
//   DEF-252 - arm textbox -> place -> rAF-sample `data-text-panel-open`,
//             page-1 left and panel width across the placement window (must
//             stay open="true", page left stable); elementFromPoint at the
//             annotation centre must resolve to the annotation; a raw
//             single-click at that centre must keep it selected + panel open.
//   DEF-251 - arm note -> place -> panel still open in annotation mode with
//             the annotation's colour; double-click opens the note editor;
//             blank click closes the panel.
//   Close   - deliberate blank-page click after textbox placement closes the
//             panel and reflows the page back to the closed inset.
//
// Evidence: screenshots/def251-panel-stays-open.png,
//           screenshots/def252-no-glitch.png,
//           screenshots/def251-252-retest.json
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchDev, openSample, hardClose, armAnnotationTool } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const REPORT = path.join(SHOTS, 'def251-252-retest.json');
fs.mkdirSync(SHOTS, { recursive: true });
const report = {};
const log = (l, o) => console.log(`[DEF251/252] ${l} ${JSON.stringify(o)}`);

async function openReport(win, app) {
  await openSample(win, app, 'report.pdf');
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(500);
}

const panelOpen = (win) =>
  win.evaluate(() => document.querySelector('.workspace')?.getAttribute('data-text-panel-open') ?? null);

async function insets(win) {
  return win.evaluate(() => {
    const page = document.querySelector('.pdf-page[data-page="1"]');
    const main = document.querySelector('.workspace-main');
    return {
      pageLeft: page ? +page.getBoundingClientRect().left.toFixed(2) : null,
      mainLeft: main ? +main.getBoundingClientRect().left.toFixed(2) : null,
      panelW: document.querySelector('.text-props-panel')
        ? +document.querySelector('.text-props-panel').getBoundingClientRect().width.toFixed(2)
        : 0,
    };
  });
}

async function installProbe(win, ms) {
  await win.evaluate((m) => {
    window.__d252 = { rows: [], running: true };
    const t0 = performance.now();
    const tick = () => {
      const ws = document.querySelector('.workspace');
      const page = document.querySelector('.pdf-page[data-page="1"]');
      const panel = document.querySelector('.text-props-panel');
      window.__d252.rows.push({
        t: Math.round(performance.now() - t0),
        open: ws ? ws.getAttribute('data-text-panel-open') : null,
        pageLeft: page ? +page.getBoundingClientRect().left.toFixed(2) : null,
        panelW: panel ? +panel.getBoundingClientRect().width.toFixed(2) : 0,
      });
      if (performance.now() - t0 < m) requestAnimationFrame(tick);
      else window.__d252.running = false;
    };
    requestAnimationFrame(tick);
  }, ms);
}

async function readProbe(win) {
  await win
    .waitForFunction(() => window.__d252 && window.__d252.running === false, null, { timeout: 8000 })
    .catch(() => {});
  return win.evaluate(() => window.__d252.rows);
}

function probeSummary(rows) {
  const openFalse = rows.filter((r) => r.open !== 'true').length;
  const lefts = rows.map((r) => r.pageLeft).filter((v) => v !== null);
  const leftRange = lefts.length ? +(Math.max(...lefts) - Math.min(...lefts)).toFixed(2) : null;
  const widths = rows.map((r) => r.panelW);
  const minW = widths.length ? +Math.min(...widths).toFixed(2) : null;
  const maxW = widths.length ? +Math.max(...widths).toFixed(2) : null;
  return { frames: rows.length, openFalse, leftRange, minW, maxW };
}

async function centreHit(win, sel) {
  return win.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      annId: el.getAttribute('data-annotation-id'),
      x: +x.toFixed(1),
      y: +y.toFixed(1),
      hitTag: hit ? hit.tagName : null,
      hitClass: hit ? String(hit.className) : null,
      hitAnnId: hit && hit.closest ? (hit.closest('[data-annotation-id]')?.getAttribute('data-annotation-id') ?? null) : null,
      hitIsCanvas: !!(hit && hit.tagName === 'CANVAS'),
    };
  }, sel);
}

async function blankPoint(win, fx, fy) {
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.min(Math.max(pg.x + pg.width * fx, 20), vp.w - 20);
  const y = Math.min(Math.max(pg.y + pg.height * fy, 20), vp.h - 20);
  return { x, y };
}

// ===========================================================================
// DEF-252 (HIGH) - textbox placement keeps the panel open; no reflow; the
// immediate click on the placed annotation lands and selects.
// ===========================================================================
test('DEF-252 textbox placement: panel stays open, no reflow, click lands', async () => {
  test.setTimeout(120000);
  const { electronApp, window: win } = await launchDev();
  try {
    await openReport(win, electronApp);
    const closed = await insets(win);
    await armAnnotationTool(win, 'textbox');
    await win.waitForSelector('.text-props-panel', { timeout: 8000 });
    const openBefore = await panelOpen(win);
    const before = await insets(win);
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await installProbe(win, 1100);
    await win.mouse.click(pg.x + pg.width * 0.32, pg.y + pg.height * 0.28);
    await win.waitForSelector('[data-annotation-editor="textbox"]', { timeout: 8000 });
    await win.locator('[data-annotation-editor="textbox"] textarea').fill('DEF252');
    await win.click('[data-annotation-action="textbox-confirm"]');
    // Immediately (no settle wait) locate the placed annotation and click it.
    await win.waitForSelector('.pdf-page[data-page="1"] [data-kind="textbox"]', { timeout: 8000 });
    const hit = await centreHit(win, '.pdf-page[data-page="1"] [data-kind="textbox"]');
    const openImmediate = await panelOpen(win);
    if (hit) await win.mouse.click(hit.x, hit.y);
    const openAfterClick = await panelOpen(win);
    const chromeAfterClick = await win.evaluate(() => !!document.querySelector('[data-content-selection-frame]'));
    const rows = await readProbe(win);
    const summary = probeSummary(rows);
    await win.screenshot({ path: path.join(SHOTS, 'def252-no-glitch.png') }).catch(() => {});
    report.def252 = { openBefore, before, hit, openImmediate, openAfterClick, chromeAfterClick, summary, closed };
    log('DEF-252', report.def252);

    expect(openBefore, 'panel open while the textbox tool is armed').toBe('true');
    expect(summary.openFalse, 'data-text-panel-open never flips false across placement (no reflow trigger)').toBe(0);
    expect(summary.leftRange, 'page-1 left does not move during placement (no 248px reflow)').toBeLessThanOrEqual(2);
    expect(summary.minW, 'panel stays at its open width throughout').toBeGreaterThan(240);
    expect(hit, 'placed textbox annotation found').not.toBeNull();
    expect(hit.hitAnnId, 'elementFromPoint at the annotation centre resolves to the annotation').toBe(hit.annId);
    expect(hit.hitIsCanvas, 'elementFromPoint is not the page canvas/background').toBe(false);
    expect(openImmediate, 'panel still open immediately after placement').toBe('true');
    expect(openAfterClick, 'panel still open after the immediate single click on the annotation').toBe('true');
    expect(chromeAfterClick, 'annotation remains selected after the click (selection chrome present)').toBe(true);
  } finally {
    await hardClose(electronApp, 'def252');
  }
});

// ===========================================================================
// DEF-251 (MEDIUM) - note placement keeps the panel open (annotation mode,
// annotation's colour); double-click opens the note editor; blank click closes.
// ===========================================================================
test('DEF-251 note placement: panel open with colour, dblclick edits, blank closes', async () => {
  test.setTimeout(120000);
  const { electronApp, window: win } = await launchDev();
  try {
    await openReport(win, electronApp);
    await armAnnotationTool(win, 'note');
    await win.waitForSelector('.text-props-panel', { timeout: 8000 });
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await installProbe(win, 1100);
    await win.mouse.click(pg.x + pg.width * 0.45, pg.y + pg.height * 0.42);
    await win.waitForSelector('[data-annotation-editor="note"]', { timeout: 8000 });
    await win.locator('[data-annotation-editor="note"] textarea').fill('DEF251 note');
    await win.click('[data-annotation-action="note-confirm"]');
    await win.waitForSelector('[data-annotation-editor="note"]', { state: 'detached', timeout: 8000 }).catch(() => {});
    await win.waitForTimeout(400);
    const openAfter = await panelOpen(win);
    const panel = await win.evaluate(() => {
      const p = document.querySelector('.text-props-panel');
      const body = document.querySelector('[data-text-panel]');
      return {
        mounted: !!p,
        mode: body ? body.getAttribute('data-text-panel-mode') : null,
        color: p && p.querySelector('[data-txt-color]') ? p.querySelector('[data-txt-color]').value : null,
        noteSelected: document.querySelector('.pdf-page[data-page="1"] [data-kind="note"]')?.getAttribute('data-note-selected') ?? null,
      };
    });
    const rows = await readProbe(win);
    const summary = probeSummary(rows);
    await win.screenshot({ path: path.join(SHOTS, 'def251-panel-stays-open.png') }).catch(() => {});

    // double-click the note icon -> committed note editor opens.
    const noteEl = win.locator('.pdf-page[data-page="1"] [data-kind="note"]').first();
    await noteEl.dblclick();
    const dblOpened = await win
      .waitForSelector('[data-annotation-editor="note"]', { state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (dblOpened) await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    // blank click -> deselect -> panel closes.
    const blank = await blankPoint(win, 0.12, 0.85);
    await win.mouse.click(blank.x, blank.y);
    await win.waitForTimeout(600);
    const afterBlank = await win.evaluate(() => ({
      panels: document.querySelectorAll('.text-props-panel').length,
      open: document.querySelector('.workspace')?.getAttribute('data-text-panel-open') ?? null,
    }));
    report.def251 = { openAfter, panel, summary, dblOpened, afterBlank, blank };
    log('DEF-251', report.def251);

    expect(summary.openFalse, 'data-text-panel-open never flips false across note placement').toBe(0);
    expect(summary.leftRange, 'page-1 left does not move during note placement').toBeLessThanOrEqual(2);
    expect(openAfter, 'panel still open after note placement').toBe('true');
    expect(panel.mode, 'panel is in annotation mode').toBe('annotation');
    expect(panel.color, "panel shows the placed note's colour (default #2563eb)").toBe('#2563eb');
    expect(panel.noteSelected, 'placed note reads as selected').toBe('true');
    expect(dblOpened, 'double-click opens the committed note editor').toBe(true);
    expect(afterBlank.panels, 'blank click closes the panel (panel unmounts)').toBe(0);
    expect(afterBlank.open, 'workspace panel-open attr returns false').toBe('false');
  } finally {
    await hardClose(electronApp, 'def251');
  }
});

// ===========================================================================
// Deliberate close still works: textbox placement -> panel open -> blank click
// -> panel closes and the page reflows back to the closed inset.
// ===========================================================================
test('deliberate close: blank click after textbox placement closes panel + reflows back', async () => {
  test.setTimeout(120000);
  const { electronApp, window: win } = await launchDev();
  try {
    await openReport(win, electronApp);
    const closed = await insets(win);
    await armAnnotationTool(win, 'textbox');
    await win.waitForSelector('.text-props-panel', { timeout: 8000 });
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.mouse.click(pg.x + pg.width * 0.3, pg.y + pg.height * 0.3);
    await win.waitForSelector('[data-annotation-editor="textbox"]', { timeout: 8000 });
    await win.locator('[data-annotation-editor="textbox"] textarea').fill('DEF-close');
    await win.click('[data-annotation-action="textbox-confirm"]');
    await win.waitForTimeout(400);
    const openState = await insets(win);
    const open = await panelOpen(win);
    const blank = await blankPoint(win, 0.12, 0.85);
    await win.mouse.click(blank.x, blank.y);
    await win.waitForTimeout(700);
    const after = await insets(win);
    const panels = await win.evaluate(() => document.querySelectorAll('.text-props-panel').length);
    report.deliberateClose = { closed, open, openState, after, panels, blank };
    log('deliberateClose', report.deliberateClose);

    expect(open, 'panel open after placement').toBe('true');
    expect(openState.panelW, 'panel at open width after placement').toBeGreaterThan(240);
    expect(panels, 'blank click closes the panel').toBe(0);
    expect(Math.abs(after.mainLeft - closed.mainLeft), 'page view reflows back to the closed inset').toBeLessThanOrEqual(2);
    expect(after.pageLeft, 'page-1 left returns to the closed value').toBeCloseTo(closed.pageLeft, 0);
  } finally {
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    await hardClose(electronApp, 'deliberate-close');
  }
});

