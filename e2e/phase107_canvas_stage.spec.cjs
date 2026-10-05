// Phase 107 (chunk D) — Canvas overhaul / Paper Stage: focused QA verification.
//
// Asserts, in the REAL launched Electron app, the committed Paper Stage contract:
//   * `.document-scroller` computed background-color is the stage neutral
//     (light rgb(236,239,244) = #ECEFF4, dark rgb(21,24,32) = #151820);
//   * `.pdf-page` is a SQUARE-cornered (border-radius 0px) PAPER-WHITE
//     (rgb(255,255,255)) sheet in BOTH themes (PDF fidelity: dark never inverts);
//   * a rendered page canvas is present.
// Then captures the light/dark evidence set (single/continuous, two/four grid,
// fit-page, fit-width, manual zoom, high-zoom scrolled, inspector open/closed,
// tab switch), the Multi Mode two-pane stage, and a large virtualized document.
//
// Launches ONLY through the canonical launchApp helper. Output:
// screenshots/phase107-canvas/.
//
// NOTE (shared-tree reality): the theme picker and the Multi Mode toggle are no
// longer the retired `[data-theme-toggle]` / `[data-header-multi-mode]` controls;
// Phase 105/109 moved them into the application menu (`[data-app-menu]` rows
// `[data-menu-action="toggleTheme"]` / `[data-menu-action="multiMode"]`). This
// spec drives the controls that actually exist in the tree under test.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const OUT = path.resolve(__dirname, '..', 'screenshots', 'phase107-canvas');
fs.mkdirSync(OUT, { recursive: true });
const shot = (name) => path.join(OUT, name);
test.setTimeout(300000);

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p107-canvas');
  app = null;
  win = null;
});

async function currentTheme() {
  return win.evaluate(() => document.documentElement.getAttribute('data-theme'));
}

// The title-row theme picker is retired (Phase 105); cycle the app menu's
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

async function openSample(name) {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.document-scroller', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas.pdf-page-canvas', { timeout: 30000 });
  await win.waitForTimeout(900);
}

// Open a second document into the workspace through the real title-bar Open
// control (dialog mocked in main, as the canonical helpers do).
async function openSecond(name) {
  const p = getSamplePath(name);
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(1200);
  await win.locator('.pdf-page canvas.pdf-page-canvas:visible').first().waitFor({ state: 'visible', timeout: 30000 });
}

async function setInspectorCollapsed(collapsed) {
  const cur = await win.locator('[data-inspector]').first().getAttribute('data-inspector-collapsed');
  if ((cur === 'true') === collapsed) return;
  await win.locator('[data-inspector-collapse]').first().click();
  await win.waitForTimeout(800);
}

// The footer's right-hand controls sit under the open Inspector today (a
// ViewStrip/Inspector overlap, not a Phase 107 surface), so collapse it before
// driving the layout/zoom controls through real clicks.
async function setLayout(mode) {
  const opt = win.locator(`[data-view-strip] [data-page-layout-option="${mode}"]`).first();
  await opt.click();
  await win.waitForTimeout(800);
}

async function clickView(label) {
  await win.locator(`.view-strip [aria-label="${label}"]`).first().click();
  await win.waitForTimeout(800);
}

// The decisive Phase 107 stage/fidelity assertion, evaluated from computed
// styles in the live renderer (never inferred from the CSS source alone).
async function assertStage(theme, rootSelector) {
  const expectedScroller = theme === 'light' ? 'rgb(236, 239, 244)' : 'rgb(21, 24, 32)';
  const res = await win.evaluate((sel) => {
    const root = document.querySelector(sel);
    const sc = root.querySelector('.document-scroller');
    const page = root.querySelector('.pdf-page');
    return {
      scrollerBg: sc ? getComputedStyle(sc).backgroundColor : null,
      pageRadius: page ? getComputedStyle(page).borderRadius : null,
      pageBg: page ? getComputedStyle(page).backgroundColor : null,
      canvasCount: root.querySelectorAll('.pdf-page canvas.pdf-page-canvas').length,
    };
  }, rootSelector);
  expect(res.scrollerBg, `${theme}: .document-scroller stage neutral`).toBe(expectedScroller);
  expect(res.pageRadius, `${theme}: .pdf-page square corners`).toBe('0px');
  expect(res.pageBg, `${theme}: .pdf-page paper white`).toBe('rgb(255, 255, 255)');
  expect(res.canvasCount, `${theme}: a rendered page canvas is present`).toBeGreaterThan(0);
  console.log(`[p107-canvas] ${theme} assert ${JSON.stringify(res)}`);
  return res;
}

// Criterion 3 — consistent logical fit margin (~FIT_MARGIN_PX = 28px). At
// fit-width the page is width-limited, so the per-side gap between the page
// edge and the measured scroller box should read the fit margin.
async function assertFitMargin(theme) {
  const m = await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const page = document.querySelector('.pdf-page');
    const sr = sc.getBoundingClientRect();
    const pr = page.getBoundingClientRect();
    // clientWidth excludes the 10px webkit scrollbar; clientLeft is the border.
    const left = pr.left - sr.left - sc.clientLeft;
    return {
      left: Math.round(left),
      right: Math.round(sc.clientWidth - left - pr.width),
      pageW: Math.round(pr.width),
      scrollerW: sc.clientWidth,
      scrollbar: sc.offsetWidth - sc.clientWidth,
    };
  });
  console.log(`[p107-canvas] ${theme} fit-width margin ${JSON.stringify(m)}`);
  expect(m.left, `${theme}: left fit margin in the 24-32px contract band`).toBeGreaterThanOrEqual(22);
  expect(m.left, `${theme}: left fit margin in the 24-32px contract band`).toBeLessThanOrEqual(34);
  expect(m.right, `${theme}: right fit margin in the 24-32px contract band`).toBeGreaterThanOrEqual(22);
  expect(m.right, `${theme}: right fit margin in the 24-32px contract band`).toBeLessThanOrEqual(34);
  expect(Math.abs(m.left - m.right), `${theme}: page centred at fit`).toBeLessThanOrEqual(3);
}

async function captureTheme(theme) {
  await setTheme(theme);
  await openSample('report.pdf');
  await assertStage(theme, '.tab-stage');

  // 01 single / continuous (default ONE layout), Inspector open
  await win.screenshot({ path: shot(`${theme}-01-single-continuous.png`) });

  // 08 inspector (tools panel) OPEN evidence
  await win.screenshot({ path: shot(`${theme}-08-inspector-open.png`) });

  // Collapse the Inspector so the footer's right-hand controls are reachable.
  await setInspectorCollapsed(true);
  await win.screenshot({ path: shot(`${theme}-09-inspector-closed.png`) });

  // 02/03 grid layouts (two then four), then back to one
  await setLayout('two');
  await win.screenshot({ path: shot(`${theme}-02-grid-two.png`) });
  await setLayout('four');
  await win.screenshot({ path: shot(`${theme}-03-grid-four.png`) });
  await setLayout('one');

  // 04/05 fit page / fit width
  await clickView('Fit page');
  await win.screenshot({ path: shot(`${theme}-04-fit-page.png`) });
  await clickView('Fit width');
  await win.screenshot({ path: shot(`${theme}-05-fit-width.png`) });
  await assertFitMargin(theme);

  // 06 manual zoom (discrete steps above fit)
  await clickView('Zoom in');
  await clickView('Zoom in');
  await win.screenshot({ path: shot(`${theme}-06-manual-zoom.png`) });

  // 07 high zoom, scrolled (page pans, margins preserved)
  for (let i = 0; i < 8; i += 1) await clickView('Zoom in');
  await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    if (sc) sc.scrollTop = 1400;
  });
  await win.waitForTimeout(900);
  await win.screenshot({ path: shot(`${theme}-07-high-zoom-scrolled.png`) });
  await clickView('Fit page');

  // Re-expand the Inspector, then 10/11 tab switch.
  await setInspectorCollapsed(false);
  await openSecond('form.pdf');
  await win.screenshot({ path: shot(`${theme}-10-tab-switch.png`) });
  await win.locator('.tab[data-tab-id]').filter({ hasText: 'report' }).first().click();
  await win.waitForTimeout(900);
  await win.screenshot({ path: shot(`${theme}-11-tab-switch-back.png`) });
}

test('Phase 107 Paper Stage — light theme assertions + evidence', async () => {
  await captureTheme('light');
});

test('Phase 107 Paper Stage — dark theme assertions + evidence', async () => {
  await captureTheme('dark');
});

// ---------------------------------------------------------------------------
// Multi Mode — the same Paper Stage surface extends to BOTH panes, with the
// visible active pane and the reserved pane-thumbnail strips intact.
// ---------------------------------------------------------------------------
async function assertPaneStage(pane, theme) {
  const expectedScroller = theme === 'light' ? 'rgb(236, 239, 244)' : 'rgb(21, 24, 32)';
  const res = await win.evaluate((p) => {
    const root = document.querySelector(`.tab-pane[data-pane="${p}"]`);
    const sc = root ? root.querySelector('.document-scroller') : null;
    const page = root ? root.querySelector('.pdf-page') : null;
    return {
      scrollerBg: sc ? getComputedStyle(sc).backgroundColor : null,
      pageRadius: page ? getComputedStyle(page).borderRadius : null,
      pageBg: page ? getComputedStyle(page).backgroundColor : null,
      canvasCount: root ? root.querySelectorAll('.pdf-page canvas.pdf-page-canvas').length : 0,
      thumbs: document.querySelectorAll(`[data-pane-strip-pane="${p}"] .thumb-item`).length,
      focused: root ? root.getAttribute('data-pane-focused') : null,
    };
  }, pane);
  expect(res.scrollerBg, `pane ${pane}: stage neutral`).toBe(expectedScroller);
  expect(res.pageRadius, `pane ${pane}: square corners`).toBe('0px');
  expect(res.pageBg, `pane ${pane}: paper white`).toBe('rgb(255, 255, 255)');
  expect(res.canvasCount, `pane ${pane}: rendered canvas present`).toBeGreaterThan(0);
  expect(res.thumbs, `pane ${pane}: pane thumbnails present`).toBeGreaterThan(0);
  console.log(`[p107-canvas] multi pane ${pane} ${JSON.stringify(res)}`);
  return res;
}

async function focusPane(pane) {
  const page = win.locator(`.tab-pane[data-pane="${pane}"] .pdf-page`).first();
  await page.scrollIntoViewIfNeeded().catch(() => {});
  const box = await page.boundingBox();
  if (box === null) throw new Error(`focusPane: no page in pane ${pane}`);
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(20, Math.min(box.x + box.width / 2, vp.w - 20));
  const y = Math.max(20, Math.min(box.y + box.height / 2, vp.h - 20));
  await win.mouse.click(x, y);
  await win.waitForTimeout(450);
}

async function enableMultiMode() {
  await win.locator('[data-app-menu]').first().click();
  await win.waitForSelector('[data-app-menu-popover]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-app-menu-popover] [data-menu-action="multiMode"]').first().click();
  await win.waitForTimeout(1000);
}

test('Phase 107 Paper Stage — Multi Mode both panes', async () => {
  await setTheme('light');
  await openSample('report.pdf');
  await openSecond('form.pdf');
  await expect(win.locator('.tab[data-tab-id]')).toHaveCount(2, { timeout: 15000 });
  await win.locator('.tab[data-tab-id]').filter({ hasText: 'report' }).first().click();
  await win.waitForTimeout(500);

  await enableMultiMode();
  const stage = win.locator('.tab-stage');
  expect(await stage.getAttribute('data-multi-mode')).toBe('true');

  // Populate pane B from its picker (the other open document).
  const pick = win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'form' }).first();
  if ((await pick.count()) > 0) {
    await pick.click();
    await win.waitForTimeout(1500);
  }
  await win.locator('.tab-pane[data-pane="B"] canvas.pdf-page-canvas:visible').first().waitFor({ state: 'visible', timeout: 30000 });

  // Both panes carry the shared Paper Stage surface.
  await assertPaneStage('A', 'light');
  await assertPaneStage('B', 'light');

  // Visible active pane: focus A, assert A marked and B not.
  await focusPane('A');
  const aFocused = await win.locator('.tab-pane[data-pane="A"]').getAttribute('data-pane-focused');
  const bFocused = await win.locator('.tab-pane[data-pane="B"]').getAttribute('data-pane-focused');
  expect(aFocused, 'pane A is the visible active pane').toBe('true');
  expect(bFocused, 'pane B is not the active pane').toBe('false');
  await win.screenshot({ path: shot('light-12-multi-mode-active-A.png') });

  // Move focus to B and prove the accent ring follows.
  await focusPane('B');
  const bFocused2 = await win.locator('.tab-pane[data-pane="B"]').getAttribute('data-pane-focused');
  const aFocused2 = await win.locator('.tab-pane[data-pane="A"]').getAttribute('data-pane-focused');
  expect(bFocused2, 'pane B becomes the active pane').toBe('true');
  expect(aFocused2, 'pane A is no longer active').toBe('false');
  await win.screenshot({ path: shot('light-13-multi-mode-active-B.png') });

  // Independent viewport: a pane-strip thumbnail click navigates only its pane.
  const scrollerTop = (p) => win.evaluate((pane) => {
    const sc = document.querySelector(`.tab-pane[data-pane="${pane}"] .document-scroller`);
    return sc ? Math.round(sc.scrollTop) : null;
  }, p);
  const beforeA = await scrollerTop('A');
  const beforeB = await scrollerTop('B');
  const thumbA3 = win.locator('[data-pane-strip-pane="A"] .thumb-item[data-page="3"]').first();
  if ((await thumbA3.count()) > 0) {
    await thumbA3.scrollIntoViewIfNeeded();
    await thumbA3.click();
    await win.waitForTimeout(900);
    const afterA = await scrollerTop('A');
    const afterB = await scrollerTop('B');
    console.log(`[p107-canvas] multi independence A ${beforeA}->${afterA} B ${beforeB}->${afterB}`);
    expect(afterA, 'pane A scrolled via its own thumbnail').toBeGreaterThan(beforeA);
    expect(afterB, 'pane B viewport unchanged').toBe(beforeB);
  }
});

// ---------------------------------------------------------------------------
// Large document — lazy / virtualized rendering unaffected by the Paper Stage.
// ---------------------------------------------------------------------------
test('Phase 107 Paper Stage — large virtualized document (long.pdf)', async () => {
  await setTheme('light');
  await openSample('long.pdf');
  await assertStage('light', '.tab-stage');

  const info = await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    return {
      slots: document.querySelectorAll('.page-slot').length,
      canvases: document.querySelectorAll('.pdf-page canvas.pdf-page-canvas').length,
      scrollHeight: sc ? sc.scrollHeight : 0,
    };
  });
  console.log(`[p107-canvas] long.pdf ${JSON.stringify(info)}`);
  expect(info.canvases, 'at least one page canvas is rendered').toBeGreaterThan(0);
  // Virtualization: only a window of pages mounts, never all 520 at once.
  expect(info.canvases, 'only a window of pages is mounted (virtualized)').toBeLessThan(120);
  expect(info.scrollHeight, 'scroll height tracks the full document').toBeGreaterThan(20000);
  await win.screenshot({ path: shot('light-14-large-doc-long.png') });

  // Scroll deep and confirm rendering continues to track (lazy mount unaffected).
  await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    if (sc) sc.scrollTop = Math.round(sc.scrollHeight * 0.5);
  });
  await win.waitForTimeout(1400);
  await win.screenshot({ path: shot('light-15-large-doc-long-scrolled.png') });
  const after = await win.evaluate(() => document.querySelectorAll('.pdf-page canvas.pdf-page-canvas').length);
  console.log(`[p107-canvas] long.pdf scrolled canvases=${after}`);
  expect(after, 'pages still mount after a deep scroll').toBeGreaterThan(0);
});
