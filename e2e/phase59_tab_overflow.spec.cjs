// Phase 59 (item 10) — tab-strip overflow: animated resize + partial stacking.
//
// The assigned behaviour (Phase 59 item 10 / success criterion 10):
//   - with many tabs open the tabs SHRINK below their natural width and
//     partially STACK (consecutive boxes overlap) while the strip stays ONE
//     row;
//   - the ACTIVE tab stays fully visible and clickable;
//   - with Animations OFF the size change is instant (transition duration ~0).
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
// The colorful tab style's natural width (TAB_OVERFLOW_METRICS.colorful.natural).
const NATURAL_WIDTH = 200;

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
      overlaps.push({ i, intersect: cur.left < prev.right, overlapPx: +(prev.right - cur.left).toFixed(2) });
    }
    const list = document.querySelector('.tab-list');
    const lr = list.getBoundingClientRect();
    const first = tabs[0];
    const second = tabs[1];
    const plus = document.querySelector('.tab-new');
    const pr = plus ? plus.getBoundingClientRect() : null;
    return {
      count: boxes.length,
      boxes,
      overlaps,
      rowCount: new Set(boxes.map((b) => Math.round(b.top))).size,
      listRect: { left: +lr.left.toFixed(2), right: +lr.right.toFixed(2), width: +lr.width.toFixed(2) },
      plusRect: pr
        ? { left: +pr.left.toFixed(2), right: +pr.right.toFixed(2), top: +pr.top.toFixed(2), bottom: +pr.bottom.toFixed(2) }
        : null,
      transitionDuration: first ? getComputedStyle(first).transitionDuration : null,
      marginLeft: second ? getComputedStyle(second).marginLeft : null,
      tabWidthVar: getComputedStyle(list).getPropertyValue('--tf-tab-width').trim(),
      tabOverlapVar: getComputedStyle(list).getPropertyValue('--tf-tab-overlap').trim(),
    };
  });
}

test('tab overflow: tabs shrink + stack in one row, the active tab stays clickable, and Animations OFF makes it instant', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p59-tabs-'));
  const src = getSamplePath('report.pdf');
  const paths = [];
  for (let i = 0; i < TAB_COUNT; i += 1) {
    const p = path.join(tmp, `doc-${i + 1}.pdf`);
    fs.copyFileSync(src, p);
    paths.push(p);
  }

  // Open enough documents that the strip overflows.
  for (const p of paths) await openPath(p);
  await win.waitForFunction((n) => document.querySelectorAll('[data-tab-id]').length >= n, TAB_COUNT, { timeout: 60000 });
  await win.waitForTimeout(800);

  const m = await measureTabs();
  console.log(`[P59-taboverflow] ${JSON.stringify(m)}`);
  expect(m.count, 'ten tabs open').toBe(TAB_COUNT);

  // 1. Every tab SHRINKS below its natural width.
  const widths = m.boxes.map((b) => b.width);
  const maxWidth = Math.max(...widths);
  console.log(`[P59-taboverflow] widths=${JSON.stringify(widths)} max=${maxWidth} natural=${NATURAL_WIDTH}`);
  expect(maxWidth, `tabs shrink below the natural width (max ${maxWidth} < ${NATURAL_WIDTH})`).toBeLessThan(NATURAL_WIDTH);

  // 2. Consecutive tab boxes OVERLAP (partial stacking) — asserted LAST so the
  //    other evidence is captured even when this fails.
  const dom = await win.evaluate(() => {
    const tab = document.querySelector('[data-tab-id]');
    const parent = tab.parentElement;
    const gp = parent.parentElement;
    return {
      tabTag: tab.tagName,
      tabClass: tab.className,
      parentTag: parent.tagName,
      parentClass: parent.className,
      parentAttrs: Array.from(parent.attributes).map((a) => a.name),
      parentDisplay: getComputedStyle(parent).display,
      parentMarginLeft: getComputedStyle(parent).marginLeft,
      grandparentClass: gp.className,
      tabMarginLeft: getComputedStyle(tab).marginLeft,
      tabMarginRight: getComputedStyle(tab).marginRight,
    };
  });
  console.log(`[P59-taboverflow] dom=${JSON.stringify(dom)}`);
  const overlapping = m.overlaps.filter((o) => o.intersect);
  console.log(`[P59-taboverflow] overlaps=${JSON.stringify(m.overlaps)}`);

  // 3. The strip stays ONE row.
  expect(m.rowCount, 'the strip is one row').toBe(1);

  // 4. The ACTIVE tab is fully visible (inside the strip) and clickable: click
  //    a background tab and confirm it activates.
  const active = m.boxes.find((b) => b.active);
  expect(active, 'an active tab exists').toBeTruthy();
  expect(active.left, 'active tab left edge inside the strip').toBeGreaterThanOrEqual(m.listRect.left - 1);
  expect(active.right, 'active tab right edge inside the strip').toBeLessThanOrEqual(m.listRect.right + 1);
  await win.screenshot({ path: path.join(SHOTS, 'p59-tab-overflow.png') });

  const background = m.boxes.find((b) => !b.active);
  await win.locator(`[data-tab-id="${background.id}"]`).click();
  await win.waitForTimeout(500);
  const afterClick = await win.evaluate((id) => {
    const el = document.querySelector(`[data-tab-id="${id}"]`);
    return el ? el.getAttribute('aria-selected') : null;
  }, background.id);
  console.log(`[P59-taboverflow] clicked background tab ${background.id} -> aria-selected=${afterClick}`);
  expect(afterClick, 'the clicked background tab became active').toBe('true');

  // 5. Animations OFF -> the size change is instant (transition duration ~0).
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
  console.log(`[P59-taboverflow] animations-off=${JSON.stringify(off)}`);
  expect(off.root, 'the root carries data-animations="off"').toBe('off');
  // "0.01ms" or "0.00001s" — parse to seconds and require ~0.
  const seconds = String(off.transitionDuration)
    .split(',')
    .map((s) => s.trim())
    .map((s) => (s.endsWith('ms') ? parseFloat(s) / 1000 : parseFloat(s)));
  const maxSeconds = Math.max(...seconds);
  console.log(`[P59-taboverflow] transition durations (s)=${JSON.stringify(seconds)}`);
  expect(maxSeconds, `tab transition duration is instant (${off.transitionDuration})`).toBeLessThanOrEqual(0.001);

  // 6. Consecutive tab boxes OVERLAP (partial stacking).
  expect(overlapping.length, 'consecutive tabs overlap').toBeGreaterThan(0);
  expect(parseFloat(m.marginLeft), `inter-tab margin is negative (${m.marginLeft})`).toBeLessThan(0);

  // 7. The "+" new-tab control is not overlapped by the stacked tabs.
  const lastTab = m.boxes[m.boxes.length - 1];
  expect(m.plusRect, 'the + control is measurable').toBeTruthy();
  console.log(`[P59-taboverflow] lastTab.right=${lastTab.right} plus.left=${m.plusRect.left}`);
  expect(
    lastTab.right,
    `the + control is not overlapped (last tab right ${lastTab.right} <= + left ${m.plusRect.left})`,
  ).toBeLessThanOrEqual(m.plusRect.left + 1);
});
