// Phase 59 (item 10) — tab-strip overflow, repointed to the Phase 72 fit contract.
//
// Phase 72 (rulings 7/8/9) SUPERSEDES the Phase 59 shrink + PARTIAL-STACK model:
//   - ruling 8 (item 7): `planTabOverflow` always returns `overlap: 0`; tabs
//     NEVER stack and never overlap — they shrink UNIFORMLY to one width;
//   - ruling 9 (item 8): `.tab-list` stops being a scroll container
//     (`overflow-x: hidden`, no `::-webkit-scrollbar` rule) and the uniform fit
//     width is computed so `count * width + (count - 1) * gap <= available`.
//
// The assigned behaviour now: at the default window AND at the 640px minimum,
// every tab has the SAME width, adjacent boxes do NOT overlap, no tab's right
// edge exceeds the strip's right edge, `.tab-list` computed `overflow-x` is
// `hidden` with `scrollWidth <= clientWidth`, and the width change animates on
// the shared motion token (instant under reduced motion / Animations OFF).
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const TAB_COUNT = 16;
// Phase 72 criterion 7 (TFL-213) — the 640px minimum-window fit contract must
// be exercised at the stated count, so the small-window case opens 10 tabs.
const MIN_WINDOW_TAB_COUNT = 10;
// Phase 72 — the colorful natural width (TAB_OVERFLOW_METRICS.colorful.natural).
const NATURAL_WIDTH = 180;

let app = null;
let win = null;

test.setTimeout(300000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p59-taboverflow');
  app = null;
  win = null;
});

async function openPath(filePath) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, filePath);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(900);
}

async function setWindowSize(w, h) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const target = BrowserWindow.getAllWindows()[0];
    if (target === undefined || target === null) return;
    if (target.isMaximized()) target.unmaximize();
    target.setSize(size[0], size[1]);
  }, [w, h]);
  await win.waitForTimeout(500);
}

async function measureTabs() {
  return win.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
    const boxes = tabs.map((t) => {
      const r = t.getBoundingClientRect();
      return {
        id: t.getAttribute('data-tab-id'),
        left: +r.left.toFixed(2),
        right: +r.right.toFixed(2),
        top: +r.top.toFixed(2),
        bottom: +r.bottom.toFixed(2),
        width: +r.width.toFixed(2),
        active: t.getAttribute('aria-selected') === 'true',
      };
    });
    const overlaps = [];
    for (let i = 1; i < boxes.length; i += 1) {
      const prev = boxes[i - 1];
      const cur = boxes[i];
      overlaps.push({ i, intersect: cur.left < prev.right - 0.5, overlapPx: +(prev.right - cur.left).toFixed(2) });
    }
    const list = document.querySelector('.tab-list');
    const lr = list.getBoundingClientRect();
    const cs = getComputedStyle(list);
    const widths = boxes.map((b) => b.width);
    return {
      count: boxes.length,
      boxes,
      overlaps,
      listRect: { left: +lr.left.toFixed(2), right: +lr.right.toFixed(2), width: +lr.width.toFixed(2) },
      overflowX: cs.overflowX,
      scrollWidth: list.scrollWidth,
      clientWidth: list.clientWidth,
      scrollLeft: list.scrollLeft,
      maxWidth: Math.max(...widths),
      minWidth: Math.min(...widths),
      widthVar: cs.getPropertyValue('--tf-tab-width').trim(),
    };
  });
}

// The Phase 72 fit contract, shared by the default-window and 640px checks.
async function assertFitContract(tag, expectedCount) {
  const m = await measureTabs();
  console.log(`[P59 ${tag}] ${JSON.stringify(m)}`);
  expect(m.count, `${tag}: every tab rendered`).toBe(expectedCount);
  // Ruling 8 — tabs shrink UNIFORMLY: one width across the strip.
  expect(
    m.maxWidth - m.minWidth,
    `${tag}: tabs shrink uniformly (max ${m.maxWidth} min ${m.minWidth})`,
  ).toBeLessThanOrEqual(0.5);
  // Ruling 8 — no inter-tab overlap / stacking.
  const overlapping = m.overlaps.filter((o) => o.intersect);
  expect(overlapping.length, `${tag}: adjacent boxes do not overlap`).toBe(0);
  // One row, never wrapped: every box vertically overlaps the others (the
  // active foot-flush box is taller, so a shared top/bottom band is the test).
  const maxTop = Math.max(...m.boxes.map((b) => b.top));
  const minBottom = Math.min(...m.boxes.map((b) => b.bottom));
  expect(maxTop, `${tag}: all tabs share one row (no wrap)`).toBeLessThan(minBottom);
  // No tab's right edge exceeds the strip's right edge (and none sticks out left).
  for (const b of m.boxes) {
    expect(b.left, `${tag}: ${b.id} left edge inside the strip`).toBeGreaterThanOrEqual(m.listRect.left - 1);
    expect(b.right, `${tag}: ${b.id} right edge inside the strip`).toBeLessThanOrEqual(m.listRect.right + 1);
  }
  // Ruling 9 — the strip is a plain clip, never a scroller.
  expect(m.overflowX, `${tag}: .tab-list computed overflow-x is hidden`).toBe('hidden');
  expect(
    m.scrollWidth,
    `${tag}: .tab-list scrollWidth (${m.scrollWidth}) <= clientWidth (${m.clientWidth})`,
  ).toBeLessThanOrEqual(m.clientWidth);
  expect(m.scrollLeft, `${tag}: .tab-list scrollLeft stays 0`).toBe(0);
  return m;
}

function durationSeconds(value) {
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .map((s) => (s.endsWith('ms') ? parseFloat(s) / 1000 : parseFloat(s)));
}

test('default window: many tabs shrink uniformly to fit the non-scrolling strip', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p59-tabs-'));
  const src = getSamplePath('report.pdf');
  const paths = [];
  for (let i = 0; i < TAB_COUNT; i += 1) {
    const p = path.join(tmp, `doc-${i + 1}.pdf`);
    fs.copyFileSync(src, p);
    paths.push(p);
  }

  // Open enough documents that the colourful natural width would not fit.
  for (const p of paths) await openPath(p);
  await win.waitForFunction((n) => document.querySelectorAll('[data-tab-id]').length >= n, TAB_COUNT, { timeout: 60000 });
  await win.waitForTimeout(800);

  const m = await assertFitContract('default', TAB_COUNT);

  // Ruling 9 — the uniform fit width is below the natural width at this count.
  console.log(`[P59 default] maxWidth=${m.maxWidth} natural=${NATURAL_WIDTH} widthVar=${m.widthVar}`);
  expect(m.maxWidth, `tabs shrink below the natural width (${m.maxWidth} < ${NATURAL_WIDTH})`).toBeLessThan(NATURAL_WIDTH);

  // The ACTIVE tab is fully visible (inside the strip) and clickable.
  const active = m.boxes.find((b) => b.active);
  expect(active, 'an active tab exists').toBeTruthy();
  await win.screenshot({ path: path.join(SHOTS, 'p59-tab-overflow.png') });
  const background = m.boxes.find((b) => !b.active);
  await win.locator(`[data-tab-id="${background.id}"]`).click();
  await win.waitForTimeout(500);
  const afterClick = await win.evaluate((id) => {
    const el = document.querySelector(`[data-tab-id="${id}"]`);
    return el ? el.getAttribute('aria-selected') : null;
  }, background.id);
  console.log(`[P59 default] clicked background tab ${background.id} -> aria-selected=${afterClick}`);
  expect(afterClick, 'the clicked background tab became active').toBe('true');

  // The uniform width change rides the shared motion token while animations are on.
  const onDuration = await win.evaluate(() => {
    const tab = document.querySelector('[data-tab-id]');
    return tab ? getComputedStyle(tab).transitionDuration : null;
  });
  console.log(`[P59 default] animations-on transitionDuration=${onDuration}`);
  expect(
    Math.max(...durationSeconds(onDuration)),
    `the tab width change animates on the shared motion token (${onDuration})`,
  ).toBeGreaterThan(0);
});

test('640px minimum: the same uniform fit contract at the smallest window, instant when Animations OFF', async () => {
  // Phase 72 criterion 7 (TFL-213) — 10 tabs at the 640px minimum, not the old
  // 3: the strip must shrink every tab uniformly and never scroll. Reuse the
  // default-window copy loop so each tab is a real document.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p59-tabs-min-'));
  const src = getSamplePath('report.pdf');
  const paths = [];
  for (let i = 0; i < MIN_WINDOW_TAB_COUNT; i += 1) {
    const p = path.join(tmp, `min-doc-${i + 1}.pdf`);
    fs.copyFileSync(src, p);
    paths.push(p);
  }
  for (const p of paths) await openPath(p);
  await win.waitForFunction(
    (n) => document.querySelectorAll('[data-tab-id]').length >= n,
    MIN_WINDOW_TAB_COUNT,
    { timeout: 60000 },
  );
  await win.waitForTimeout(800);

  // Resize AFTER the tabs exist: the strip must shrink them uniformly to fit.
  await setWindowSize(640, 620);
  await win.waitForTimeout(600);

  const m = await assertFitContract('640px', MIN_WINDOW_TAB_COUNT);
  console.log(`[P59 640px] maxWidth=${m.maxWidth} natural=${NATURAL_WIDTH} widthVar=${m.widthVar}`);
  expect(m.maxWidth, `640px: tabs shrink below the natural width (${m.maxWidth} < ${NATURAL_WIDTH})`).toBeLessThan(NATURAL_WIDTH);
  await win.screenshot({ path: path.join(SHOTS, 'p59-tab-overflow-min.png') });

  // Animations OFF -> the width change is instant (`data-animations="off"`).
  await win.locator('[data-open-preferences]').first().click();
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
  await win.waitForTimeout(300);
  const animations = win.locator('[data-prefs-animations]');
  if (await animations.isChecked()) await animations.uncheck();
  await win.waitForTimeout(400);
  await win.locator('[data-prefs-dialog] .sheet-close').first().click();
  await win.waitForSelector('[data-prefs-dialog]', { state: 'hidden', timeout: 10000 });
  await win.waitForTimeout(500);

  const off = await win.evaluate(() => {
    const root = document.documentElement.getAttribute('data-animations');
    const tab = document.querySelector('[data-tab-id]');
    const cs = tab ? getComputedStyle(tab) : null;
    return { root, transitionDuration: cs ? cs.transitionDuration : null };
  });
  console.log(`[P59 640px] animations-off=${JSON.stringify(off)}`);
  expect(off.root, 'the root carries data-animations="off"').toBe('off');
  // "0.01ms" or "0.00001s" — parse to seconds and require ~0.
  console.log(`[P59 640px] transition durations (s)=${JSON.stringify(durationSeconds(off.transitionDuration))}`);
  expect(
    Math.max(...durationSeconds(off.transitionDuration)),
    `tab transition duration is instant (${off.transitionDuration})`,
  ).toBeLessThanOrEqual(0.001);
});

