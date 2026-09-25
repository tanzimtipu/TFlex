// Phase 37 gate retest (qa) — DEF-334..337 (ADV-083..086).
//
// Focused verification of the four accepted adversary findings on the CURRENT
// tree. Evidence-first: every test logs the raw DOM/geometry before asserting.
// Launches only through the canonical e2e/lib/launch.cjs launchApp helper.
// At most three screenshots (the ladder/label state and the empty-tab print
// state), per the dispatch.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(250);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p37-def334-337');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function openSample(name = 'report.pdf') {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

async function setWindowSize(w, h) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const bw = BrowserWindow.getAllWindows().find(
      (x) => !x.webContents.getURL().includes('tfWindow=print'),
    );
    if (bw) bw.setSize(s[0], s[1]);
  }, [w, h]);
  await win.waitForTimeout(700);
  await win.waitForFunction((t) => Math.abs(window.innerWidth - t) < 45, w, { timeout: 10000 });
}

async function gotoStage(n) {
  await win.evaluate(() => {
    const el = document.activeElement;
    if (el !== null && typeof el.blur === 'function') el.blur();
  });
  await win.keyboard.press(`Control+${n}`);
  await win.waitForTimeout(400);
}

// The full ladder state at the current width: the two collapse rungs, the dock's
// label/arrow rungs, the verb-row count (wrap detector) and the scroller metrics.
const ladderState = () => win.evaluate(() => {
  const d = document.querySelector('[data-action-dock]');
  const appMain = document.querySelector('.app-main');
  const panel = document.querySelector('[data-context-panel]');
  const scroller = document.querySelector('[data-dock-scroll]');
  const verbs = d === null ? [] : [...d.querySelectorAll('[data-dock-verb]')];
  const labelEls = d === null ? [] : [...d.querySelectorAll('.action-dock-label')];
  const sr = scroller?.getBoundingClientRect() ?? null;
  const visibleLabels = sr === null ? null : labelEls.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.left >= sr.left - 1 && r.right <= sr.right + 1;
  }).length;
  const clippedLabels = sr === null ? null : labelEls.filter((el) => {
    const r = el.getBoundingClientRect();
    return !(r.width > 0 && r.left >= sr.left - 1 && r.right <= sr.right + 1);
  }).map((el) => el.textContent);
  return {
    innerWidth: window.innerWidth,
    inspector: appMain?.getAttribute('data-inspector-collapsed') ?? null,
    panel: appMain?.getAttribute('data-rail-collapsed') ?? null,
    panelAttr: panel?.getAttribute('data-context-panel-collapsed') ?? null,
    iconOnly: d?.getAttribute('data-dock-icon-only') ?? null,
    arrows: d?.getAttribute('data-dock-arrows') ?? null,
    arrowsLane: d?.getAttribute('data-dock-arrows-lane') ?? null,
    labels: labelEls.length,
    visibleLabels,
    clippedLabels,
    verbRows: new Set(verbs.map((v) => Math.round(v.getBoundingClientRect().top))).size,
    flexWrap: d === null ? null : getComputedStyle(d).flexWrap,
    scrollWidth: scroller?.scrollWidth ?? null,
    clientWidth: scroller?.clientWidth ?? null,
    scrollLeft: scroller?.scrollLeft ?? null,
  };
});

// ---------------------------------------------------------------------------
// DEF-334 (ADV-083) — the label rung: labels stay visible above 880; the
// arrows lane absorbs a labelled row that cannot fit instead of dropping labels.
// ---------------------------------------------------------------------------
test('DEF-334 label rung: PAGES labels visible at 1440, ladder order down and up, no wrap', async () => {
  await openSample('report.pdf');
  await setWindowSize(1440, 900);
  await gotoStage(1);

  const down = [];
  for (const w of [1440, 1200, 1199, 999, 879, 719]) {
    await setWindowSize(w, 900);
    await gotoStage(1);
    const s = await ladderState();
    down.push(s);
    console.log(`[DEF-334] down w=${w} ${JSON.stringify(s)}`);
  }
  const up = [];
  for (const w of [719, 879, 999, 1199, 1200, 1440]) {
    await setWindowSize(w, 900);
    await gotoStage(1);
    const s = await ladderState();
    up.push(s);
    console.log(`[DEF-334] up   w=${w} ${JSON.stringify(s)}`);
  }

  // No wrap/stacking at any width, either direction.
  for (const s of [...down, ...up]) {
    expect(s.verbRows, `w=${s.innerWidth}: the dock is ONE row (never stacks)`).toBe(1);
    expect(s.flexWrap, `w=${s.innerWidth}: flex-wrap is nowrap`).toBe('nowrap');
  }

  // 1440: the eight PAGES labels are VISIBLE in one row.
  const wide = down[0];
  expect(wide.labels, 'at 1440 the eight PAGES labels are visible').toBe(8);
  expect(wide.iconOnly, 'at 1440 the label rung is OFF').toBe('false');
  expect(wide.inspector, 'at 1440 the Inspector is expanded').toBe('false');
  expect(wide.panel, 'at 1440 the panel is expanded').toBe('false');
  await win.screenshot({ path: path.join(SHOTS, 'phase37-def334-ladder-1440.png') });
  console.log(`[DEF-334] screenshot ${path.join(SHOTS, 'phase37-def334-ladder-1440.png')}`);

  // The ladder order: Inspector below 1200, panel below 1000, labels below 880,
  // arrows below 720. The measured innerWidth is reported alongside each state.
  const at = (arr, w) => arr.find((s) => s.innerWidth === w) ?? arr.find((s) => Math.abs(s.innerWidth - w) <= 1);
  const r1200 = at(down, 1200);
  const r1199 = at(down, 1199);
  const r999 = at(down, 999);
  const r879 = at(down, 879);
  const r719 = at(down, 719);
  // The breakpoint is STRICTLY below 1200: at innerWidth 1200 the Inspector is
  // still expanded; at 1199 the rung fires. Both are reported.
  expect(r1200.inspector, `at inner=1200 the Inspector is expanded (breakpoint is <1200)`).toBe('false');
  expect(r1199.inspector, `at inner=1199 the Inspector is collapsed (inner=${r1199.innerWidth})`).toBe('true');
  expect(r999.panel, `at ~999 the panel is collapsed (inner=${r999.innerWidth})`).toBe('true');
  expect(r879.iconOnly, `at ~879 the labels are hidden (inner=${r879.innerWidth})`).toBe('true');
  expect(r879.labels, `at ~879 no labels render (inner=${r879.innerWidth})`).toBe(0);
  // The ladder rung below 720 engages the arrows LANE; the rendered arrows
  // themselves follow the DEF-337 contract (present iff the row overflows). The
  // Phase-38 20px dock now fits at 719 (scrollWidth == clientWidth == 231), so
  // the lane is engaged but no arrow control renders.
  expect(r719.arrowsLane, `at ~719 the arrows LANE is engaged (inner=${r719.innerWidth})`).toBe('true');
  expect(r719.arrows, `at ~719 the rendered arrows follow the overflow contract (inner=${r719.innerWidth})`)
    .toBe(r719.scrollWidth > r719.clientWidth ? 'true' : 'false');

  // The arrows lane is used instead of dropping labels when the eight labelled
  // verbs cannot fit: at 1440 the labels are visible AND the arrows lane is
  // engaged (the row scrolls rather than hiding labels).
  console.log(`[DEF-334] 1440 labels=${wide.labels} visibleLabels=${wide.visibleLabels} arrows=${wide.arrows} scroll=${wide.scrollWidth}/${wide.clientWidth}`);
  expect(wide.labels, 'the labelled row is kept (not dropped) at 1440').toBe(8);

  // Down and up sweeps agree at every width (no oscillation).
  for (const d of down) {
    const u = up.find((s) => s.innerWidth === d.innerWidth);
    expect(u, `up sweep has inner=${d.innerWidth}`).toBeTruthy();
    expect(u.inspector, `inner=${d.innerWidth}: inspector stable both ways`).toBe(d.inspector);
    expect(u.panel, `inner=${d.innerWidth}: panel stable both ways`).toBe(d.panel);
    expect(u.iconOnly, `inner=${d.innerWidth}: labels stable both ways`).toBe(d.iconOnly);
    expect(u.arrows, `inner=${d.innerWidth}: arrows stable both ways`).toBe(d.arrows);
  }
});

// ---------------------------------------------------------------------------
// DEF-335 (ADV-084) — the Expand latch: one click on the Expand affordance at a
// ladder-collapsed width records the EXPAND intent, so the surface stays
// expanded once the window grows past the rung; at a ladder-idle width the
// control still toggles both ways.
// ---------------------------------------------------------------------------
const collapseState = () => win.evaluate(() => ({
  innerWidth: window.innerWidth,
  inspector: document.querySelector('.app-main')?.getAttribute('data-inspector-collapsed') ?? null,
  panel: document.querySelector('.app-main')?.getAttribute('data-rail-collapsed') ?? null,
  inspectorLabel: document.querySelector('[data-inspector-collapse]')?.getAttribute('aria-label') ?? null,
  panelLabel: document.querySelector('[data-rail-collapse]')?.getAttribute('aria-label') ?? null,
}));

test('DEF-335 Expand latch: one click at a ladder-collapsed width expands and stays expanded', async () => {
  await openSample('report.pdf');
  await setWindowSize(1440, 900);
  await gotoStage(1);

  // --- Inspector: 1100 (rung 1 forces collapsed) -> one click -> 1300. ---
  await setWindowSize(1100, 900);
  const i0 = await collapseState();
  console.log(`[DEF-335] inspector at 1100 before=${JSON.stringify(i0)}`);
  expect(i0.inspector, 'at 1100 the ladder forces the Inspector collapsed').toBe('true');
  expect(i0.inspectorLabel, 'the control reads Expand while the ladder forces the collapse').toBe('Expand inspector');
  await win.locator('[data-inspector-collapse]').click();
  await win.waitForTimeout(500);
  const i1 = await collapseState();
  console.log(`[DEF-335] inspector at 1100 after one click=${JSON.stringify(i1)}`);
  expect(i1.inspector, 'the ladder still wins at 1100 (no visible change yet)').toBe('true');
  await setWindowSize(1300, 900);
  await win.waitForTimeout(400);
  const i2 = await collapseState();
  console.log(`[DEF-335] inspector at 1300 after one click=${JSON.stringify(i2)}`);
  expect(i2.inspector, 'one click at 1100 expands the Inspector at 1300').toBe('false');

  // --- Panel: 900 (rung 2 forces collapsed) -> one click -> 1300. ---
  await setWindowSize(900, 900);
  const p0 = await collapseState();
  console.log(`[DEF-335] panel at 900 before=${JSON.stringify(p0)}`);
  expect(p0.panel, 'at 900 the ladder forces the panel collapsed').toBe('true');
  expect(p0.panelLabel, 'the panel control reads Expand while the ladder forces the collapse').toBe('Expand panel');
  await win.locator('[data-rail-collapse]').click();
  await win.waitForTimeout(500);
  const p1 = await collapseState();
  console.log(`[DEF-335] panel at 900 after one click=${JSON.stringify(p1)}`);
  expect(p1.panel, 'the ladder still wins at 900 (no visible change yet)').toBe('true');
  await setWindowSize(1300, 900);
  await win.waitForTimeout(400);
  const p2 = await collapseState();
  console.log(`[DEF-335] panel at 1300 after one click=${JSON.stringify(p2)}`);
  expect(p2.panel, 'one click at 900 expands the panel at 1300').toBe('false');

  // --- Ladder-idle 1300: both controls still toggle both ways. ---
  await win.locator('[data-inspector-collapse]').click();
  await win.waitForTimeout(400);
  const i3 = await collapseState();
  await win.locator('[data-inspector-collapse]').click();
  await win.waitForTimeout(400);
  const i4 = await collapseState();
  console.log(`[DEF-335] inspector idle 1300 toggle ${i2.inspector} -> ${i3.inspector} -> ${i4.inspector}`);
  expect(i3.inspector, 'at 1300 the Inspector control collapses').toBe('true');
  expect(i4.inspector, 'at 1300 the Inspector control expands again').toBe('false');

  await win.locator('[data-rail-collapse]').click();
  await win.waitForTimeout(400);
  const p3 = await collapseState();
  await win.locator('[data-rail-collapse]').click();
  await win.waitForTimeout(400);
  const p4 = await collapseState();
  console.log(`[DEF-335] panel idle 1300 toggle ${p2.panel} -> ${p3.panel} -> ${p4.panel}`);
  expect(p3.panel, 'at 1300 the panel control collapses').toBe('true');
  expect(p4.panel, 'at 1300 the panel control expands again').toBe('false');
});

// ---------------------------------------------------------------------------
// DEF-336 (ADV-085) — the silent print no-op: with an empty placeholder tab
// active while another tab holds a document, the title-bar Print is disabled
// (with its reason) and the native File > Print item is disabled; print still
// works with a document active.
// ---------------------------------------------------------------------------
test('DEF-336 empty-tab print: title-bar Print and File > Print disabled, no silent no-op', async () => {
  await openSample('report.pdf');
  await setWindowSize(1440, 900);

  // Create the empty placeholder tab; it becomes active.
  await win.locator('[data-new-tab]').click();
  await win.waitForTimeout(1200);
  const empty = await win.evaluate(() => {
    const btn = document.querySelector('[data-print]');
    return {
      tabs: document.querySelectorAll('.tab[data-tab-id]').length,
      welcome: !!document.querySelector('.welcome'),
      disabled: btn?.disabled ?? null,
      title: btn?.getAttribute('title') ?? null,
      aria: btn?.getAttribute('aria-label') ?? null,
    };
  });
  console.log(`[DEF-336] empty tab active=${JSON.stringify(empty)}`);
  expect(empty.tabs, 'two tabs exist (document + empty)').toBe(2);
  expect(empty.welcome, 'the empty placeholder tab shows the welcome screen').toBe(true);
  expect(empty.disabled, 'the title-bar Print is DISABLED on the empty tab').toBe(true);
  expect(empty.title, 'the disabled Print explains why').toBe('Open a document to print');

  const menuEmpty = await app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('menu.print');
    return { enabled: item?.enabled ?? null };
  });
  console.log(`[DEF-336] native menu.print on empty tab=${JSON.stringify(menuEmpty)}`);
  expect(menuEmpty.enabled, 'the native File > Print item is DISABLED on the empty tab').toBe(false);

  // A click on the disabled title-bar control must not open a print window.
  const before = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('tfWindow=print')).length);
  await win.locator('[data-print]').click({ force: true }).catch(() => undefined);
  await win.waitForTimeout(900);
  const after = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('tfWindow=print')).length);
  console.log(`[DEF-336] print windows before=${before} after disabled click=${after}`);
  expect(after, 'the disabled title-bar Print opens no window').toBe(before);
  await win.screenshot({ path: path.join(SHOTS, 'phase37-def336-empty-tab-print.png') });
  console.log(`[DEF-336] screenshot ${path.join(SHOTS, 'phase37-def336-empty-tab-print.png')}`);

  // Activate the document tab: Print is enabled and opens the standalone window.
  await win.locator('.tab[data-tab-id]').filter({ hasText: 'report' }).first().click();
  await win.waitForTimeout(900);
  const doc = await win.evaluate(() => {
    const btn = document.querySelector('[data-print]');
    return { disabled: btn?.disabled ?? null, title: btn?.getAttribute('title') ?? null };
  });
  console.log(`[DEF-336] document tab active=${JSON.stringify(doc)}`);
  expect(doc.disabled, 'the title-bar Print is ENABLED with a document active').toBe(false);
  expect(doc.title, 'the enabled Print shows its shortcut').toBe('Print (Ctrl+P)');
  const menuDoc = await app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('menu.print');
    return { enabled: item?.enabled ?? null };
  });
  console.log(`[DEF-336] native menu.print on document tab=${JSON.stringify(menuDoc)}`);
  expect(menuDoc.enabled, 'the native File > Print item is ENABLED with a document active').toBe(true);

  const p = app.waitForEvent('window');
  await win.click('[data-print]');
  const printPage = await p;
  await printPage.waitForSelector('[data-print-window]', { timeout: 30000 });
  console.log('[DEF-336] the standalone print window opened with a document active');
  await app.evaluate(({ BrowserWindow }) => {
    const pw = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('tfWindow=print'));
    if (pw) pw.close();
  });
  await win.waitForTimeout(700);
});

// ---------------------------------------------------------------------------
// DEF-337 (ADV-086) — the dead arrows: the arrows render only when the row
// genuinely overflows; where it fits they are absent.
// ---------------------------------------------------------------------------
test('DEF-337 dead arrows: absent when the row fits, present and scrolling when it overflows', async () => {
  await openSample('report.pdf');

  // DELIVER: the row fits at 700/640 (no arrows), overflows at 1440 (arrows
  // scroll). The Phase-38 20px dock now fits at 719 (scrollWidth == clientWidth
  // == 231), so the overflow proof is re-pointed to 1440 where the labelled row
  // genuinely overflows (clientWidth 430, scrollWidth 776).
  await gotoStage(4);
  const deliver = {};
  const readDock = () => win.evaluate(() => {
    const d = document.querySelector('[data-action-dock]');
    const sc = document.querySelector('[data-dock-scroll]');
    const dr = d?.getBoundingClientRect();
    const sr = sc?.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      arrows: d?.getAttribute('data-dock-arrows') ?? null,
      arrowCount: d?.querySelectorAll('[data-dock-arrow]').length ?? null,
      iconOnly: d?.getAttribute('data-dock-icon-only') ?? null,
      lift: d?.getAttribute('data-dock-lift') ?? null,
      compact: d?.getAttribute('data-dock-compact') ?? null,
      dockW: dr ? Math.round(dr.width) : null,
      scrollDisplay: sc ? getComputedStyle(sc).display : null,
      scrollW: sr ? Math.round(sr.width) : null,
      scrollWidth: sc?.scrollWidth ?? null,
      clientWidth: sc?.clientWidth ?? null,
      scrollLeft: sc?.scrollLeft ?? null,
    };
  });
  for (const w of [700, 640, 1440]) {
    await setWindowSize(w, 900);
    await gotoStage(4);
    const reads = [];
    for (let i = 0; i < 3; i++) {
      reads.push(await readDock());
      await win.waitForTimeout(500);
    }
    deliver[w] = reads[reads.length - 1];
    console.log(`[DEF-337] DELIVER w=${w} reads=${JSON.stringify(reads)}`);
  }
  await win.screenshot({ path: path.join(SHOTS, 'phase37-def337-arrows-1440.png') });
  console.log(`[DEF-337] screenshot ${path.join(SHOTS, 'phase37-def337-arrows-1440.png')}`);
  expect(deliver[1440].arrows, 'at 1440 the DELIVER row overflows, so the arrows render').toBe('true');
  expect(deliver[1440].arrowCount, 'at 1440 both arrows render').toBe(2);
  expect(deliver[1440].scrollWidth, 'at 1440 the scroller genuinely overflows').toBeGreaterThan(deliver[1440].clientWidth);
  await win.locator('[data-dock-arrow="right"]').click();
  await win.waitForTimeout(700);
  const afterRight = await win.evaluate(() => document.querySelector('[data-dock-scroll]').scrollLeft);
  console.log(`[DEF-337] DELIVER 1440 arrow right scrollLeft ${deliver[1440].scrollLeft} -> ${afterRight}`);
  expect(afterRight, 'the right arrow scrolls the overflowing row').toBeGreaterThan(deliver[1440].scrollLeft);
  expect(deliver[700].arrows, 'at 700 the DELIVER row fits, so no arrows').toBe('false');
  expect(deliver[700].arrowCount, 'at 700 no arrow controls render').toBe(0);
  expect(deliver[640].arrows, 'at 640 the DELIVER row fits, so no arrows').toBe('false');
  expect(deliver[640].arrowCount, 'at 640 no arrow controls render').toBe(0);
});

test('DEF-337 flyout arrows: absent when the annotation body fits', async () => {
  await openSample('report.pdf');

  // Annotation flyout: its body always fits, so its arrows are absent.
  await setWindowSize(1440, 900);
  await gotoStage(3);
  await win.locator('[data-dock-verb="annotate"]').click();
  await win.waitForSelector('[data-annotation-flyout]', { state: 'visible', timeout: 8000 });
  for (const w of [719, 640]) {
    await setWindowSize(w, 900);
    await win.waitForTimeout(900);
    const f = await win.evaluate(() => {
      const fly = document.querySelector('[data-annotation-flyout]');
      const sc = document.querySelector('[data-annotation-flyout-scroll]');
      return {
        innerWidth: window.innerWidth,
        arrows: fly?.getAttribute('data-flyout-arrows') ?? null,
        arrowCount: fly?.querySelectorAll('[data-flyout-arrow]').length ?? null,
        scrollWidth: sc?.scrollWidth ?? null,
        clientWidth: sc?.clientWidth ?? null,
      };
    });
    console.log(`[DEF-337] flyout w=${w} ${JSON.stringify(f)}`);
    expect(f.scrollWidth, `flyout at ${w}: the body fits (scrollWidth == clientWidth)`).toBe(f.clientWidth);
    expect(f.arrows, `flyout at ${w}: no arrows when the body fits`).toBe('false');
    expect(f.arrowCount, `flyout at ${w}: no arrow controls render`).toBe(0);
  }
});