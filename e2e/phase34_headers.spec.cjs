// Phase 34 — criterion 3: both file names (with page counts) flank the divider.
//
// The left document's name sits on the divider's LEFT and the right document's
// name on its RIGHT, so the two names read as the two sides of one split
// workspace. The names update when a pane's document is replaced, the clear
// control still works and focuses its pane, and nothing overlaps the pane
// headers or the page areas at 1440x900 and at the 640px minimum width (the
// retired shared toolbar row is gone; the ONE shared Action Dock floats at the
// stage's bottom and can never reach the header band).
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { twoPaneSetup, focusPaneByPage, paneCount, openFile, tmpCopy, REPORT } = require('./lib/p33_common.cjs');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p34-headers');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function geom() {
  return win.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return {
        left: Math.round(b.left),
        right: Math.round(b.right),
        top: Math.round(b.top),
        bottom: Math.round(b.bottom),
        width: Math.round(b.width),
      };
    };
    const text = (sel) => {
      const el = document.querySelector(sel);
      return el ? el.innerText.replace(/\s+/g, ' ').trim() : null;
    };
    return {
      titleA: rect('.tab-pane[data-pane="A"] [data-pane-header] .multi-pane-title'),
      titleB: rect('.tab-pane[data-pane="B"] [data-pane-header] .multi-pane-title'),
      nameA: text('.tab-pane[data-pane="A"] [data-pane-header] .multi-pane-title'),
      nameB: text('.tab-pane[data-pane="B"] [data-pane-header] .multi-pane-title'),
      countA: text('.tab-pane[data-pane="A"] [data-pane-header] .multi-pane-count'),
      countB: text('.tab-pane[data-pane="B"] [data-pane-header] .multi-pane-count'),
      headerA: rect('.tab-pane[data-pane="A"] [data-pane-header]'),
      headerB: rect('.tab-pane[data-pane="B"] [data-pane-header]'),
      stage: rect('.tab-stage'),
      divider: rect('[data-multi-divider]'),
      // Phase 36 (chunk 7) — the retired shared toolbar row is replaced by the
      // ONE shared Action Dock layer, pinned to the stage's bottom edge.
      dock: rect('[data-multi-dock-layer]'),
      pageA: rect('.tab-pane[data-pane="A"] .page-slot[data-page="1"]'),
      pageB: rect('.tab-pane[data-pane="B"] .page-slot[data-page="1"]'),
    };
  });
}

async function setSize(w, h) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) {
      if (bw.isMaximized()) bw.unmaximize();
      bw.setSize(size.w, size.h);
    }
  }, { w, h });
  await win.waitForTimeout(700);
}

test('C1 names flank the divider and show their page counts', async () => {
  await twoPaneSetup(app, win);
  const g = await geom();
  console.log(`[P34-headers] geometry=${JSON.stringify(g)}`);

  expect(g.titleA, 'pane A name present').not.toBeNull();
  expect(g.titleB, 'pane B name present').not.toBeNull();
  expect(g.divider, 'divider present').not.toBeNull();

  // Left name's right edge at/left of the divider's left edge.
  expect(g.titleA.right, `left name (right ${g.titleA.right}) is not left of the divider (left ${g.divider.left})`).toBeLessThanOrEqual(g.divider.left + 2);
  // Right name's left edge at/right of the divider's right edge.
  expect(g.titleB.left, `right name (left ${g.titleB.left}) is not right of the divider (right ${g.divider.right})`).toBeGreaterThanOrEqual(g.divider.right - 2);

  // The names are actually rendered (non-zero width) and in their own halves.
  expect(g.titleA.right).toBeGreaterThan(g.titleA.left);
  expect(g.titleB.right).toBeGreaterThan(g.titleB.left);
  expect(g.titleA.left).toBeLessThan(g.divider.left);
  expect(g.titleB.right).toBeGreaterThan(g.divider.right);

  // Both names show their page counts.
  expect(g.nameA).toContain('p33-alpha');
  expect(g.nameB).toContain('p33-beta');
  expect(g.countA).toMatch(/\b34\s+pages?\b/);
  expect(g.countB).toMatch(/\b520\s+pages?\b/);
});

test('C2 replacing a pane document updates its name', async () => {
  await twoPaneSetup(app, win);
  const before = await geom();
  expect(before.nameA).toContain('p33-alpha');

  await focusPaneByPage(win, 'A');
  await openFile(app, win, tmpCopy(REPORT, 'p34-gamma.pdf'));
  await expect(win.locator('.tab-pane[data-pane="A"] [data-pane-header]')).toContainText('p34-gamma', { timeout: 30000 });
  await win.waitForTimeout(700);

  const after = await geom();
  console.log(`[P34-headers] replace pane A: nameA "${before.nameA}" -> "${after.nameA}"; nameB="${after.nameB}"`);
  expect(after.nameA).toContain('p34-gamma');
  expect(after.countA).toMatch(/\b34\s+pages?\b/);
  // The other pane is untouched.
  expect(after.nameB).toContain('p33-beta');
  // The flanking geometry still holds after the update.
  expect(after.titleA.right).toBeLessThanOrEqual(after.divider.left + 2);
  expect(after.titleB.left).toBeGreaterThanOrEqual(after.divider.right - 2);
});

test('C3 [data-pane-clear] still works and focuses its pane', async () => {
  await twoPaneSetup(app, win);
  // Focus pane A first so the clear on B must move focus.
  await focusPaneByPage(win, 'A');
  expect(await win.locator('.tab-pane[data-pane="A"]').getAttribute('data-pane-focused')).toBe('true');

  await win.locator('.tab-pane[data-pane="B"] [data-pane-clear]').click();
  await win.waitForTimeout(900);

  const emptyB = await win.locator('.tab-pane[data-pane="B"][data-pane-empty]').count();
  const focused = await win.locator('.tab-pane[data-pane-focused="true"]').getAttribute('data-pane');
  console.log(`[P34-headers] after clearing pane B: empty=${emptyB} focused=${focused} paneA=${await paneCount(win, 'A')}`);
  expect(emptyB, 'pane B falls back to the empty state').toBe(1);
  expect(focused, 'clearing pane B focuses it').toBe('B');
  expect(await paneCount(win, 'A'), 'pane A is untouched').toBe(34);
});

test('C4 no overlap of the pane headers, the shared dock or the page areas at 1440x900 and at 640px', async () => {
  await twoPaneSetup(app, win);

  const check = (g, label) => {
    console.log(`[P34-headers] ${label}: stage.top=${g.stage.top} headerA.top=${g.headerA.top} headerB.top=${g.headerB.top} headerA.bottom=${g.headerA.bottom} pageA.top=${g.pageA.top} headerB.bottom=${g.headerB.bottom} pageB.top=${g.pageB.top} dock.top=${g.dock && g.dock.top} divider=(${g.divider.left},${g.divider.right}) titleA.right=${g.titleA.right} titleB.left=${g.titleB.left}`);
    // No chrome band above the pane headers: the panes (and their headers) own
    // the stage from its top edge (the retired shared toolbar row used to push
    // them down). The ONE shared Action Dock floats at the stage's BOTTOM.
    expect(g.headerA.top - g.stage.top, `${label}: pane A header is not at the stage top`).toBeLessThanOrEqual(1);
    expect(g.headerB.top - g.stage.top, `${label}: pane B header is not at the stage top`).toBeLessThanOrEqual(1);
    // The shared dock layer cannot reach either pane-header band.
    expect(g.dock, `${label}: shared dock layer present in Multi Mode`).not.toBeNull();
    expect(g.dock.top, `${label}: dock layer reaches pane A header band`).toBeGreaterThanOrEqual(g.headerA.bottom - 1);
    expect(g.dock.top, `${label}: dock layer reaches pane B header band`).toBeGreaterThanOrEqual(g.headerB.bottom - 1);
    // The headers never overlap their page areas.
    expect(g.headerA.bottom, `${label}: pane A header overlaps its page area`).toBeLessThanOrEqual(g.pageA.top + 1);
    expect(g.headerB.bottom, `${label}: pane B header overlaps its page area`).toBeLessThanOrEqual(g.pageB.top + 1);
    // The names still flank the divider.
    expect(g.titleA.right, `${label}: left name crosses the divider`).toBeLessThanOrEqual(g.divider.left + 2);
    expect(g.titleB.left, `${label}: right name crosses the divider`).toBeGreaterThanOrEqual(g.divider.right - 2);
    // The headers themselves do not cross the divider either.
    expect(g.headerA.right, `${label}: pane A header crosses the divider`).toBeLessThanOrEqual(g.divider.right);
    expect(g.headerB.left, `${label}: pane B header crosses the divider`).toBeGreaterThanOrEqual(g.divider.left);
  };

  await setSize(1440, 900);
  const g1440 = await geom();
  check(g1440, '1440x900');

  await setSize(640, 900);
  const g640 = await geom();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  console.log(`[P34-headers] after resize viewport=${JSON.stringify(vp)}`);
  expect(vp.w).toBeLessThanOrEqual(660);
  check(g640, '640x900');
});
