// Phase 109 (chunk C) focused qa verification - the unified View Strip footer.
// Verifies the COMPLETE phase diff (chunks A + B + B2) on the running app:
// the single-mode footer, the per-pane Multi Mode footer, the retired
// CanvasPills / top-right PageLayoutControl / Book View entry, the responsive
// tiers, the dock/footer clearance and accessibility.
//
// Launches only through the canonical e2e/lib/launch.cjs launchApp helper.
// Captures screenshots into screenshots/ named phase109-*.
//
// SHARED-TREE REALITY: the retired `[data-theme-toggle]` and
// `[data-header-multi-mode]` controls no longer exist - Phase 105 relocated the
// theme toggle and the Multi Mode toggle into the application menu
// (`[data-app-menu]` rows `[data-menu-action="toggleTheme"]` /
// `[data-menu-action="multiMode"]`). This spec drives the controls that
// actually exist in the tree under test.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, ensurePanelExpanded } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;
test.setTimeout(420000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(250);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p109-viewstrip');
  app = null;
  win = null;
});

async function openSample(name = 'report.pdf') {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

async function setWindow(w, h) {
  await app.evaluate(({ BrowserWindow }, sz) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) {
      try { bw.unmaximize(); } catch (_) { /* already normal */ }
      bw.setSize(sz[0], sz[1]);
    }
  }, [w, h]);
  await win.waitForFunction((want) => Math.abs(window.innerWidth - want) <= 40, w, { timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(600);
}

async function currentTheme() {
  return win.evaluate(() => document.documentElement.getAttribute('data-theme'));
}

// Phase 105 retired the title-row theme picker; cycle the app menu's
// "Toggle Theme" row until the requested concrete theme is live.
async function setTheme(theme) {
  for (let i = 0; i < 4; i += 1) {
    if ((await currentTheme()) === theme) return;
    await win.locator('[data-app-menu]').first().click();
    await win.waitForSelector('[data-app-menu-popover]', { state: 'visible', timeout: 8000 });
    await win.locator('[data-app-menu-popover] [data-menu-action="toggleTheme"]').first().click();
    await win.waitForTimeout(800);
  }
  const now = await currentTheme();
  if (now !== theme) throw new Error(`setTheme: could not reach '${theme}' (stuck at '${now}')`);
}

// Phase 105 relocated the Multi Mode toggle into the application menu; the
// retired `[data-header-multi-mode]` control no longer exists.
async function toggleMultiMode() {
  await win.locator('[data-app-menu]').first().click();
  await win.waitForSelector('[data-app-menu-popover]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-app-menu-popover] [data-menu-action="multiMode"]').first().click();
  await win.waitForTimeout(700);
}

// Toggling Multi Mode with one document open leaves pane B EMPTY (a pick/open
// surface), so it has no DocumentView and therefore no View Strip. Load a real
// document into pane B through its own `[data-pane-open]` (dialog mocked in
// main) so BOTH panes carry a footer.
async function openIntoPaneB(name = 'form.pdf') {
  const p = getSamplePath(name);
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-open]').first().click();
  await win.waitForFunction(() => {
    const b = document.querySelector('.tab-pane[data-pane="B"]');
    return b !== null && b.querySelector('[data-view-strip]') !== null;
  }, null, { timeout: 30000 });
  await win.waitForTimeout(1200);
}

// DEF-577 (already filed): with the Inspector OPEN, its 264px panel overlays
// the footer's right-hand layout / Book View controls, so a real pointer click
// is intercepted. Collapse it before driving those controls through real
// clicks - the overlap itself is DEF-577, not re-filed here.
async function collapseInspector() {
  const insp = win.locator('[data-inspector]').first();
  if ((await insp.count()) === 0) return;
  if ((await insp.getAttribute('data-inspector-collapsed')) === 'true') return;
  await win.locator('[data-inspector-collapse]').first().click();
  await win.waitForTimeout(700);
}

async function diag() {
  return win.evaluate(() => window.tflexDiagnostics());
}
async function pageCount() { return (await diag()).pageCount; }
async function currentPage() { return (await diag()).currentPage; }

async function readPageInput() {
  return win.evaluate(() => {
    const el = document.querySelector('.view-strip-page .page-input');
    return el ? Number(el.value) : null;
  });
}

// Vertical gap from `aboveBox`'s bottom to `belowBox`'s top: positive when the
// two boxes are separated by that many px, negative when they overlap.
function vGap(aboveBox, belowBox) {
  return belowBox.y - (aboveBox.y + aboveBox.height);
}

// No footer control may sit outside its own 48px row.
async function footerClipping() {
  return win.evaluate(() => {
    const strip = document.querySelector('[data-view-strip]');
    if (!strip) return null;
    const r = strip.getBoundingClientRect();
    const bad = [];
    strip.querySelectorAll('button, input, [role="button"]').forEach((el) => {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return;
      if (b.top < r.top - 1 || b.bottom > r.bottom + 1) {
        bad.push({ label: el.getAttribute('aria-label'), top: Math.round(b.top), bottom: Math.round(b.bottom), rowTop: Math.round(r.top), rowBottom: Math.round(r.bottom) });
      }
    });
    return { rowHeight: r.height, bad };
  });
}

// Tab through the document and return the accessible names of the elements
// that receive focus inside the footer, in DOM order.
async function footerTabOrder() {
  await win.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
    document.body.focus();
  });
  const seen = [];
  for (let i = 0; i < 220; i += 1) {
    await win.keyboard.press('Tab');
    const info = await win.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const strip = el.closest('[data-view-strip]');
      if (!strip) return null;
      return {
        tag: el.tagName.toLowerCase(),
        label: el.getAttribute('aria-label'),
        text: (el.textContent || '').trim().slice(0, 24),
        outline: getComputedStyle(el).outlineStyle,
        boxShadow: getComputedStyle(el).boxShadow,
      };
    });
    if (info) seen.push(info);
  }
  return seen;
}
// ---------------------------------------------------------------------------
// 1. The single-mode footer and its exact accessible names.
// ---------------------------------------------------------------------------
test('P109-1 single footer carries the page + view groups with exact names', async () => {
  await openSample();
  const strip = win.locator('[data-view-strip]');
  await expect(strip).toHaveCount(1);
  await expect(strip).toBeVisible();
  expect(await strip.getAttribute('role')).toBe('group');
  expect(await strip.getAttribute('aria-label')).toBe('Viewing controls');

  // The buttons with these exact accessible names.
  const buttonNames = ['Previous page', 'Next page', 'Zoom out', 'Zoom in', 'Fit width', 'Fit page', 'Pan mode', 'Book View'];
  for (const name of buttonNames) {
    const btn = strip.getByRole('button', { name, exact: true });
    const n = await btn.count();
    console.log(`[P109-1] button "${name}" count=${n}`);
    expect(n, `footer exposes "${name}"`).toBeGreaterThanOrEqual(1);
    await expect(btn.first()).toBeVisible();
  }
  // "Current page" is the TEXT INPUT's accessible name, not a button.
  const input = strip.locator('input.page-input[aria-label="Current page"]');
  await expect(input).toHaveCount(1);
  await expect(input).toBeVisible();

  await expect(strip.locator('.page-total')).toContainText('/');
  // `.page-label-hint` is CONDITIONAL: it renders only when the active page
  // carries a logical label (report.pdf has none). Assert at most one.
  const hintCount = await strip.locator('.page-label-hint').count();
  console.log(`[P109-1] .page-label-hint count=${hintCount} (conditional on page labels)`);
  expect(hintCount).toBeLessThanOrEqual(1);

  const layout = strip.locator('[aria-label="Page layout"]');
  await expect(layout).toHaveCount(1);
  for (const mode of ['one', 'two', 'four']) {
    await expect(layout.locator(`[data-page-layout-option="${mode}"]`)).toHaveCount(1);
  }
  console.log('[P109-1] footer groups + layout options present');
});

// ---------------------------------------------------------------------------
// 2. The per-pane CanvasPills are retired in single mode AND in every pane.
// ---------------------------------------------------------------------------
test('P109-2 [data-canvas-pills] is absent in single mode and every Multi Mode pane', async () => {
  await openSample();
  expect(await win.locator('[data-canvas-pills]').count(), 'no floating pills in single mode').toBe(0);

  await toggleMultiMode();
  await win.waitForSelector('.tab-pane[data-pane="B"]', { timeout: 15000 });
  await openIntoPaneB();
  const pillCount = await win.locator('[data-canvas-pills]').count();
  const paneCount = await win.locator('.tab-pane[data-pane]').count();
  console.log(`[P109-2] multi panes=${paneCount} canvasPills=${pillCount}`);
  expect(paneCount).toBeGreaterThanOrEqual(2);
  expect(pillCount, 'per-pane CanvasPills retired in Multi Mode too').toBe(0);
});

// ---------------------------------------------------------------------------
// 3. Page navigation: prev/next disable at the ends; typed jump navigates.
// ---------------------------------------------------------------------------
test('P109-3 prev disabled at page 1, next disabled on the last page, typed jump navigates', async () => {
  await openSample();
  const prev = win.locator('.view-strip-page [aria-label="Previous page"]').first();
  const next = win.locator('.view-strip-page [aria-label="Next page"]').first();
  const input = win.locator('.view-strip-page .page-input');

  expect(await currentPage(), 'starts on page 1').toBe(1);
  expect(await prev.isDisabled(), 'Previous disabled at page 1').toBe(true);

  const count = await pageCount();

  // Forward via the real Next button (page 1 -> 2).
  await next.click();
  await win.waitForTimeout(1600);
  const afterNext = await currentPage();
  console.log(`[P109-3] after Next button: currentPage=${afterNext}`);

  // Jump to the LAST page via the footer input.
  await input.fill(String(count));
  await input.press('Enter');
  await win.waitForFunction((want) => window.tflexDiagnostics().currentPage === want, count, { timeout: 10000 });
  await win.waitForTimeout(1600);
  const atLast = await currentPage();
  expect(atLast, `jumped to last page ${count}`).toBe(count);
  expect(await next.isDisabled(), 'Next disabled on the last page').toBe(true);

  // Backward via the real Previous button (last -> last-1).
  await prev.click();
  await win.waitForTimeout(1600);
  const afterPrev = await currentPage();
  console.log(`[P109-3] atLast=${atLast} after Previous button=${afterPrev} (expected ${count - 1})`);

  // Typed jump backward to page 2.
  await input.fill('2');
  await input.press('Enter');
  await win.waitForFunction(() => window.tflexDiagnostics().currentPage === 2, null, { timeout: 10000 });
  await win.waitForTimeout(1500);
  const afterTyped = await currentPage();
  console.log(`[P109-3] after typed jump 2: currentPage=${afterTyped} input=${await readPageInput()}`);
  expect(afterTyped, 'typed jump to page 2 changed the visible current page').toBe(2);
  expect(await readPageInput(), 'the page input reflects the new page').toBe(2);
  expect(await prev.isDisabled(), 'Previous enabled past page 1').toBe(false);
  console.log(`[P109-3] pageCount=${count} prev/next end states + typed jump OK`);
});

// ---------------------------------------------------------------------------
// 4. Zoom, fit and pan states.
// ---------------------------------------------------------------------------
test('P109-4 zoom out/in change .zoom-percent; Fit width/page press; Pan sets data-hand-active', async () => {
  await openSample();
  await collapseInspector(); // DEF-577 workaround for the right-hand controls
  const zoomPct = win.locator('.view-strip-view .zoom-percent').first();
  const before = (await zoomPct.textContent()).trim();
  await win.locator('.view-strip-view [aria-label="Zoom in"]').first().click();
  await win.waitForTimeout(500);
  const afterIn = (await zoomPct.textContent()).trim();
  await win.locator('.view-strip-view [aria-label="Zoom out"]').first().click();
  await win.waitForTimeout(500);
  const afterOut = (await zoomPct.textContent()).trim();
  console.log(`[P109-4] zoom before=${before} in=${afterIn} out=${afterOut}`);
  expect(afterIn, 'Zoom in changes the percentage').not.toBe(before);
  expect(afterOut).not.toBe(afterIn);

  const fitWidth = win.locator('.view-strip-view [aria-label="Fit width"]').first();
  await fitWidth.click();
  await win.waitForTimeout(500);
  expect(await fitWidth.getAttribute('aria-pressed'), 'Fit width pressed').toBe('true');

  const fitPage = win.locator('.view-strip-view [aria-label="Fit page"]').first();
  await fitPage.click();
  await win.waitForTimeout(500);
  expect(await fitPage.getAttribute('aria-pressed'), 'Fit page pressed').toBe('true');
  expect(await fitWidth.getAttribute('aria-pressed'), 'Fit width released').not.toBe('true');

  const pan = win.locator('.view-strip-view [aria-label="Pan mode"]').first();
  await pan.click();
  await win.waitForTimeout(400);
  expect(await pan.getAttribute('data-hand-active'), 'Pan mode active').toBe('true');
  console.log('[P109-4] zoom/fit/pan states OK');
});

// ---------------------------------------------------------------------------
// 5. Page layout switch and the Book View entry.
// ---------------------------------------------------------------------------
test('P109-5 layout one/two/four switches data-page-layout; Book View opens and closes', async () => {
  await openSample();
  await collapseInspector(); // DEF-577 workaround for the right-hand controls
  const content = win.locator('.document-content').first();
  const layout = win.locator('[data-view-strip] [aria-label="Page layout"]');
  for (const mode of ['two', 'four', 'one']) {
    await layout.locator(`[data-page-layout-option="${mode}"]`).click();
    await win.waitForTimeout(800);
    const got = await content.getAttribute('data-page-layout');
    console.log(`[P109-5] requested=${mode} data-page-layout=${got}`);
    expect(got, `layout ${mode} applied`).toBe(mode);
  }

  const book = win.locator('[data-view-strip] [aria-label="Book View"]').first();
  await book.click();
  await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 10000 });
  expect(await win.locator('[data-book-view]').count(), 'Book View opened').toBeGreaterThanOrEqual(1);
  // Book View closes through its own Close control (it has no Escape handler).
  await win.locator('[data-book-view] [aria-label="Close book view"]').first().click();
  await win.waitForTimeout(900);
  const stillOpen = await win.locator('[data-book-view]').isVisible().catch(() => false);
  console.log(`[P109-5] book view visible after Close=${stillOpen}`);
  expect(stillOpen, 'Book View closes via its Close control').toBe(false);
});
// ---------------------------------------------------------------------------
// 6. No overlap between the Action Dock and the footer, single + multi,
//    default and 640x480, pages panel open and collapsed.
//
// Geometry note: in SINGLE mode `.view-strip` is grid row 6 (the bottom-most
// row) and `.canvas-overlay` is inset by `--view-strip-h` (styles.css:5068-5071,
// 17167+), so the dock floats ABOVE the footer: the clearance is
// `footer.top - dock.bottom`. In MULTI mode the pane footers stop above the
// shared dock, so the clearance is `dock.top - paneFooter.bottom`. Both must be
// >= 16px (the shared contract: no overlap, >=16px separation).
// ---------------------------------------------------------------------------
test('P109-6 dock clears the footer/pane footers by >=16px; one 48px row; no clipping', async () => {
  await openSample();
  const dock = win.locator('[data-action-dock]').first();
  const footer = win.locator('[data-view-strip]').first();

  for (const size of [[1440, 900], [640, 480]]) {
    await setWindow(size[0], size[1]);
    const d = await dock.boundingBox();
    const f = await footer.boundingBox();
    expect(d, 'dock measurable').not.toBeNull();
    expect(f, 'footer measurable').not.toBeNull();
    const gap = vGap(d, f); // footer sits below the dock in single mode
    console.log(`[P109-6] single ${size[0]}x${size[1]} dockBottom=${Math.round(d.y + d.height)} footerTop=${Math.round(f.y)} gap=${Math.round(gap)}`);
    expect(gap, `dock clears the footer by >=16px at ${size[0]}x${size[1]}`).toBeGreaterThanOrEqual(15.5);

    await ensurePanelExpanded(win);
    const openClip = await footerClipping();
    console.log(`[P109-6] ${size[0]}x${size[1]} panel-open row=${openClip.rowHeight} bad=${JSON.stringify(openClip.bad)}`);
    expect(Math.abs(openClip.rowHeight - 48), 'footer is a single 48px row').toBeLessThanOrEqual(2);
    expect(openClip.bad, 'no footer control clips its row (panel open)').toEqual([]);

    if ((await win.locator('[data-rail-collapse]').count()) > 0) {
      await win.locator('[data-rail-collapse]').first().click();
      await win.waitForTimeout(500);
    }
    const collapsedClip = await footerClipping();
    expect(collapsedClip.bad, 'no footer control clips its row (panel collapsed)').toEqual([]);
  }

  // Multi Mode: the shared dock clears every pane footer (both panes loaded).
  await setWindow(1440, 900);
  await toggleMultiMode();
  await win.waitForSelector('.tab-pane[data-pane="B"]', { timeout: 15000 });
  await openIntoPaneB();
  const sharedDock = win.locator('[data-action-dock]').first();
  const paneFooters = win.locator('.tab-pane[data-pane] [data-view-strip]');
  const n = await paneFooters.count();
  console.log(`[P109-6] multi pane footers=${n}`);
  expect(n).toBeGreaterThanOrEqual(2);
  const db = await sharedDock.boundingBox();
  expect(db, 'shared dock measurable').not.toBeNull();
  for (let i = 0; i < n; i += 1) {
    const fb = await paneFooters.nth(i).boundingBox();
    const gap = vGap(fb, db); // dock sits below each pane footer in multi mode
    console.log(`[P109-6] multi pane ${i} footerBottom=${Math.round(fb.y + fb.height)} dockTop=${Math.round(db.y)} gap=${Math.round(gap)}`);
    expect(gap, `shared dock clears pane ${i} footer by >=16px`).toBeGreaterThanOrEqual(15.5);
  }
});

// ---------------------------------------------------------------------------
// 7. Multi Mode: one footer per pane, pane footer omits layout + Book View,
//    and a pane's controls act on that pane only.
// ---------------------------------------------------------------------------
test('P109-7 each pane owns a footer without layout/Book View; pane A acts on A only', async () => {
  await openSample();
  await toggleMultiMode();
  await win.waitForSelector('.tab-pane[data-pane="B"]', { timeout: 15000 });
  await openIntoPaneB();

  const paneA = win.locator('.tab-pane[data-pane="A"]');
  const paneB = win.locator('.tab-pane[data-pane="B"]');
  await expect(paneA.locator('[data-view-strip]')).toHaveCount(1);
  await expect(paneB.locator('[data-view-strip]')).toHaveCount(1);
  expect(await paneA.locator('[aria-label="Page layout"]').count(), 'pane A footer has no layout group').toBe(0);
  expect(await paneB.locator('[aria-label="Page layout"]').count(), 'pane B footer has no layout group').toBe(0);
  expect(await paneA.locator('[data-book-view-open]').count(), 'pane A footer has no Book View entry').toBe(0);
  expect(await paneB.locator('[data-book-view-open]').count(), 'pane B footer has no Book View entry').toBe(0);

  const zoomA = paneA.locator('.view-strip-view .zoom-percent').first();
  const zoomB = paneB.locator('.view-strip-view .zoom-percent').first();
  const a0 = (await zoomA.textContent()).trim();
  const b0 = (await zoomB.textContent()).trim();
  await paneA.locator('.view-strip-view [aria-label="Zoom in"]').first().click();
  await win.waitForTimeout(700);
  const a1 = (await zoomA.textContent()).trim();
  const b1 = (await zoomB.textContent()).trim();
  console.log(`[P109-7] paneA zoom ${a0}->${a1}; paneB zoom ${b0}->${b1}`);
  expect(a1, 'pane A zoom changed by its own control').not.toBe(a0);
  expect(b1, 'pane B zoom unchanged by pane A').toBe(b0);
});

// ---------------------------------------------------------------------------
// 8. Accessibility: Tab reaches every footer control, each has a name,
//    focus is visible.
// ---------------------------------------------------------------------------
test('P109-8 Tab reaches the footer controls in DOM order with names and visible focus', async () => {
  await openSample();
  const seen = await footerTabOrder();
  const labels = seen.map((s) => s.label || s.text).filter(Boolean);
  console.log(`[P109-8] focused footer controls: ${JSON.stringify(labels)}`);
  expect(seen.length, 'Tab reaches multiple footer controls').toBeGreaterThanOrEqual(5);
  for (const s of seen) {
    expect(s.label || s.text, `focused ${s.tag} has an accessible name`).toBeTruthy();
    // Focus is visible: an outline OR a focus box-shadow ring (the page input
    // uses `border-color + box-shadow`, not an outline - styles.css:4921).
    const focusVisible = s.outline !== 'none' || s.boxShadow !== 'none';
    expect(focusVisible, `focus is visible on ${s.label || s.text} (outline=${s.outline} boxShadow=${s.boxShadow})`).toBe(true);
  }
  // The More trigger carries an accessible name too (present in single mode).
  expect(await win.locator('[data-view-strip-more-toggle][aria-label]').count()).toBeGreaterThanOrEqual(1);
});

// ---------------------------------------------------------------------------
// 9. Screenshots: light single, dark single, multi panes, 640x480.
// ---------------------------------------------------------------------------
test('P109-9 capture phase109 screenshots', async () => {
  await openSample();
  await setWindow(1440, 900);
  await setTheme('light');
  await win.screenshot({ path: path.join(SHOTS, 'phase109-light-single.png') });

  await setTheme('dark');
  await win.screenshot({ path: path.join(SHOTS, 'phase109-dark-single.png') });
  await setTheme('light');

  await toggleMultiMode();
  await win.waitForSelector('.tab-pane[data-pane="B"]', { timeout: 15000 });
  await openIntoPaneB();
  await win.screenshot({ path: path.join(SHOTS, 'phase109-multi.png') });

  await setWindow(640, 480);
  await win.screenshot({ path: path.join(SHOTS, 'phase109-640x480.png') });
  console.log('[P109-9] screenshots written: phase109-light-single / phase109-dark-single / phase109-multi / phase109-640x480');
});

// ---------------------------------------------------------------------------
// DEF-577 FIX-READY rendered retest (TFL-914). The reported defect: with the
// Inspector OPEN, the footer's right-hand `.view-strip-layout` group and the
// `.view-strip-book` button sat UNDER the Inspector panel, so
// `document.elementFromPoint` returned `.glass-sidebar-body.inspector-body`
// and a normal (un-forced) click was intercepted. The fix (TFL-908) adds
// `margin-right: var(--tf-tools-inset, 0px)` to the single-mode rule
// `.tab-stage[data-multi-mode="false"] .view-strip` (styles.css:5258), so the
// footer ends flush against the Inspector's left edge instead of underneath it.
// These tests drive the REAL app: they hit-test the controls and then run an
// un-forced `.click()` and assert the observable result.
// ---------------------------------------------------------------------------

// The Inspector / inset state as the running app reports it.
async function inspectorState() {
  return win.evaluate(() => {
    const main = document.querySelector('.app-main');
    const insp = document.querySelector('[data-inspector]');
    return {
      toolsOpen: main ? main.getAttribute('data-tools-open') : null,
      mainCollapsedAttr: main ? main.getAttribute('data-inspector-collapsed') : null,
      inspectorCollapsed: insp ? insp.getAttribute('data-inspector-collapsed') : null,
      inset: main ? getComputedStyle(main).getPropertyValue('--tf-tools-inset').trim() : null,
    };
  });
}

// Hit-test `selector` at its own centre: is the control (or its own child) the
// TOP element, and is it NOT the Inspector body?
async function pointHits(selector) {
  return win.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) return { found: false, selector: sel };
    const r = el.getBoundingClientRect();
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(x, y);
    const owner = top && top.closest ? top.closest('button') : null;
    return {
      found: true,
      selector: sel,
      x, y,
      hits: top !== null && (top === el || el.contains(top)),
      topClass: top ? String(top.className || '') : null,
      topTag: top ? top.tagName.toLowerCase() : null,
      topAria: owner ? owner.getAttribute('aria-label') : (top ? top.getAttribute('aria-label') : null),
    };
  }, selector);
}

test('P109-10 DEF-577 retest: Inspector OPEN leaves the layout + Book View controls hit-testable and clickable', async () => {
  await openSample();
  await setWindow(1440, 900);
  const st = await inspectorState();
  console.log(`[P109-10] inspector state ${JSON.stringify(st)}`);
  expect(st.toolsOpen, 'Inspector starts EXPANDED (default)').toBe('true');

  // The footer ends flush at the Inspector's left edge, not underneath it.
  const geom = await win.evaluate(() => {
    const strip = document.querySelector('[data-view-strip]');
    const insp = document.querySelector('[data-inspector]');
    return {
      stripRight: Math.round(strip.getBoundingClientRect().right),
      inspectorLeft: Math.round(insp.getBoundingClientRect().left),
    };
  });
  console.log(`[P109-10] stripRight=${geom.stripRight} inspectorLeft=${geom.inspectorLeft} delta=${geom.stripRight - geom.inspectorLeft}`);
  expect(geom.stripRight, 'the footer does not extend under the open Inspector').toBeLessThanOrEqual(geom.inspectorLeft + 2);

  const layoutSel = '.view-strip-layout [data-page-layout-option="two"]';
  const bookSel = '.view-strip-book';
  for (const sel of [layoutSel, bookSel]) {
    const hit = await pointHits(sel);
    console.log(`[P109-10] elementFromPoint("${sel}") = ${hit.topTag}.${hit.topClass} aria=${hit.topAria} hits=${hit.hits}`);
    expect(hit.found, `${sel} is rendered`).toBe(true);
    expect(String(hit.topClass), `${sel}: the top element is NOT the Inspector body`).not.toContain('inspector-body');
    expect(hit.hits, `${sel}: the control is the top element at its own centre`).toBe(true);
  }

  // A normal, un-forced click must activate each control.
  await win.locator(layoutSel).click();
  await win.waitForTimeout(800);
  expect(await win.locator('.document-content').first().getAttribute('data-page-layout'), 'the layout switched to two under the open Inspector').toBe('two');
  await win.locator('.view-strip-layout [data-page-layout-option="one"]').click();
  await win.waitForTimeout(600);

  await win.locator(bookSel).click();
  await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 10000 });
  expect(await win.locator('[data-book-view]').count(), 'Book View opened under the open Inspector').toBeGreaterThanOrEqual(1);
  await win.locator('[data-book-view] [aria-label="Close book view"]').first().click();
  await win.waitForTimeout(800);

  await win.screenshot({ path: path.join(SHOTS, 'phase109-def577-inspector-open.png') });
  console.log('[P109-10] screenshot: phase109-def577-inspector-open.png');
});

test('P109-11 DEF-577 retest: Inspector COLLAPSED keeps the footer controls reachable (collapsed inset)', async () => {
  await openSample();
  await setWindow(1440, 900);
  await collapseInspector();
  const st = await inspectorState();
  console.log(`[P109-11] inspector state ${JSON.stringify(st)}`);
  expect(st.mainCollapsedAttr, '.app-main reports the collapsed Inspector').toBe('true');
  expect(st.inset, 'the collapsed inset is the 44px strip width').toBe('44px');

  for (const sel of ['.view-strip-layout [data-page-layout-option="two"]', '.view-strip-book']) {
    const hit = await pointHits(sel);
    console.log(`[P109-11] elementFromPoint("${sel}") = ${hit.topTag}.${hit.topClass} aria=${hit.topAria} hits=${hit.hits}`);
    expect(hit.hits, `${sel}: reachable with the Inspector collapsed`).toBe(true);
  }

  await win.locator('.view-strip-layout [data-page-layout-option="two"]').click();
  await win.waitForTimeout(800);
  expect(await win.locator('.document-content').first().getAttribute('data-page-layout'), 'layout switches with the Inspector collapsed').toBe('two');
});

test('P109-12 DEF-577 retest: one 48px row, no clipping, and the footer tier re-evaluates at constrained width', async () => {
  await openSample();
  const tierOf = () => win.evaluate(() => {
    const vis = (sel) => {
      const el = document.querySelector(sel);
      return el === null ? 'missing' : getComputedStyle(el).display;
    };
    const strip = document.querySelector('[data-view-strip]');
    return {
      stripWidth: strip ? Math.round(strip.getBoundingClientRect().width) : null,
      more: vis('.view-strip-more'),
      layout: vis('.view-strip-layout'),
      book: vis('.view-strip-book'),
      zoomPct: vis('.view-strip .zoom-percent'),
      bookLabel: vis('.view-strip .view-strip-book-label'),
    };
  });

  // Wide: the Inspector is open and the footer sits in its full tier.
  await setWindow(1440, 900);
  const wide = await tierOf();
  console.log(`[P109-12] 1440x900 inspector=${JSON.stringify(await inspectorState())} tier=${JSON.stringify(wide)}`);
  const wideClip = await footerClipping();
  expect(Math.abs(wideClip.rowHeight - 48), 'footer is one 48px row at 1440x900').toBeLessThanOrEqual(2);
  expect(wideClip.bad, 'no footer control clips at 1440x900').toEqual([]);
  expect(wide.zoomPct, 'full tier: the zoom readout is inline at 1440x900').not.toBe('none');
  expect(wide.layout, 'full tier: the layout group is inline at 1440x900').not.toBe('none');

  // Constrained: the ladder collapses the Inspector below 1200px, and the
  // footer's own inline-size container drops to its COMPACT rung because the
  // available width (and the --tf-tools-inset margin) reduces it below 668px.
  await setWindow(640, 480);
  const narrowState = await inspectorState();
  const narrow = await tierOf();
  console.log(`[P109-12] 640x480 inspector=${JSON.stringify(narrowState)} tier=${JSON.stringify(narrow)}`);
  const narrowClip = await footerClipping();
  expect(Math.abs(narrowClip.rowHeight - 48), 'footer stays one 48px row at 640x480').toBeLessThanOrEqual(2);
  expect(narrowClip.bad, 'no footer control clips at 640x480').toEqual([]);
  expect(narrow.stripWidth, 'the footer container is narrower at 640x480 than at 1440x900').toBeLessThan(wide.stripWidth);
  expect(narrow.zoomPct, 'compact tier re-evaluates against the reduced width: the zoom readout yields').toBe('none');
  expect(narrow.bookLabel, 'compact tier: the Book View label collapses to its icon').toBe('none');
  expect(narrow.layout, 'the layout group is still inline at 476px (compact, not overflow)').not.toBe('none');

  await win.screenshot({ path: path.join(SHOTS, 'phase109-def577-640x480.png') });
  console.log('[P109-12] screenshot: phase109-def577-640x480.png');
});
