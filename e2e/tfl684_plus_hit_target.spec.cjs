// TFL-684 — the "+ new tab" control owns its hit target at the 640px minimum.
//
// With 11-14 tabs narrowed to the 640px minimum, the squeezed active tab's
// `.tab-close` (18px, margin-left:auto) spilled past the tab's 6-8px box and,
// as a positioned descendant, painted/hit-tested ABOVE the static
// `.tab-list-new` "<li>" carrying the "+". elementFromPoint at the "+" centre
// returned `.tab-close`, and a raw click there CLOSED the active tab
// (n=11 11->10, n=14 14->13) instead of opening one.
//
// Fix (renderer tab-strip only): `.tab-list-new` is `position: relative;
// z-index: 3` — above the active tab (z-index 2), below the dragged tab
// (z-index 60) — and the base `.tab` clips its own content (`overflow: hidden`,
// the TFL-678 containment lock).
//
// This canonical e2e spec asserts in the real app at 640px:
//   - elementFromPoint at the "+" centre returns the "+" control (classify
//     'plus', never 'close'/'tab'); all 16 sampled points inside the "+" box
//     are the "+" control;
//   - a raw click at the "+" centre OPENS a tab (count +1, so no close);
//   - neighbour/blast radius: the active tab's own close still closes it.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
test.setTimeout(300000);

function userData(tag) {
  return path.join(os.tmpdir(), `tflex-tfl684-${tag}-${Date.now()}`);
}

async function openReport(win) {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1000);
}

async function setSize(app, w, h) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (!bw) return;
    bw.unmaximize();
    bw.setSize(s.w, s.h);
  }, { w, h });
  await new Promise((r) => setTimeout(r, 600));
}

async function reachTabCount(win, target) {
  let guard = 0;
  while ((await win.locator('[data-tab-id]').count()) < target && guard < 40) {
    guard += 1;
    const plus = win.locator('[data-new-tab]');
    if ((await plus.count()) === 0) break;
    await plus.first().click({ timeout: 4000 }).catch(() => {});
    await win.waitForTimeout(250);
  }
}

// In-page sample: classify elementFromPoint at the "+" centre and over a 4x4
// grid inside the "+" box. `closest` keeps the icon/padding as the "+".
const SAMPLE = () => {
  const plus = document.querySelector('[data-new-tab]');
  const classify = (el) => {
    if (!el) return 'none';
    if (el.closest('[data-new-tab]')) return 'plus';
    if (el.closest('.tab-close')) return 'close';
    if (el.closest('[data-tab-id]')) return 'tab';
    return el.tagName ? el.tagName.toLowerCase() : 'none';
  };
  const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
  const active = tabs.find((t) => t.getAttribute('aria-selected') === 'true') || null;
  const base = {
    count: tabs.length,
    activeId: active ? active.getAttribute('data-tab-id') : null,
    ids: tabs.map((t) => t.getAttribute('data-tab-id')),
  };
  if (!plus) return { ...base, plus: null, centerHit: 'none', grid: [] };
  const b = plus.getBoundingClientRect();
  const rect = { left: b.left, top: b.top, width: b.width, height: b.height };
  const grid = [];
  for (let iy = 1; iy <= 4; iy += 1) {
    for (let ix = 1; ix <= 4; ix += 1) {
      grid.push(classify(document.elementFromPoint(
        rect.left + (rect.width * ix) / 5,
        rect.top + (rect.height * iy) / 5,
      )));
    }
  }
  return {
    ...base,
    plus: rect,
    centerHit: classify(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)),
    grid,
  };
};

async function verifyAt(win, app, target, tag) {
  await reachTabCount(win, target);
  expect(await win.locator('[data-tab-id]').count(), `n=${target}: tabs are open`).toBe(target);
  await setSize(app, 640, 800);

  const s = await win.evaluate(SAMPLE);
  console.log(`[TFL684 n=${target}] centerHit=${s.centerHit} grid=${JSON.stringify(s.grid)}`);
  expect(s.plus, `n=${target}: the "+" control is present`).toBeTruthy();
  expect(s.centerHit, `n=${target}: elementFromPoint at the "+" centre is the "+"`).toBe('plus');
  expect(
    s.grid.filter((g) => g === 'plus').length,
    `n=${target}: every sampled "+" point is the "+"`,
  ).toBe(16);

  await win.screenshot({ path: path.join(SHOTS, `tfl684-plus-hit-${tag}.png`) });

  const before = await win.evaluate(SAMPLE);
  const cx = before.plus.left + before.plus.width / 2;
  const cy = before.plus.top + before.plus.height / 2;
  await win.mouse.click(cx, cy);
  await win.waitForTimeout(700);
  const after = await win.evaluate(SAMPLE);
  console.log(`[TFL684 n=${target}] raw "+" centre click: ${before.count}->${after.count}`);
  expect(
    after.count,
    `n=${target}: a raw "+" centre click opens a tab (net no close)`,
  ).toBe(before.count + 1);
  expect(
    before.activeId === null || after.ids.includes(before.activeId),
    `n=${target}: the previously active tab is still open`,
  ).toBe(true);
}

test('the "+" centre is its own hit target at 640px with 11 tabs; clicking it opens a tab', async () => {
  const app = await launchApp([], userData('n11'));
  const win = await app.firstWindow();
  await openReport(win);
  await verifyAt(win, app, 11, '11');
  await hardClose(app, 'tfl684-n11');
});

test('the "+" centre is its own hit target at 640px with 14 tabs; clicking it opens a tab', async () => {
  const app = await launchApp([], userData('n14'));
  const win = await app.firstWindow();
  await openReport(win);
  await verifyAt(win, app, 14, '14');
  await hardClose(app, 'tfl684-n14');
});

test('blast radius: the active tab close still closes its own tab at 640px', async () => {
  const app = await launchApp([], userData('close'));
  const win = await app.firstWindow();
  await openReport(win);
  await reachTabCount(win, 3);
  await setSize(app, 640, 800);
  const before = await win.locator('[data-tab-id]').count();
  const active = win.locator('[data-tab-id][aria-selected="true"]').first();
  await active.locator('.tab-close').click();
  await win.waitForTimeout(500);
  const after = await win.locator('[data-tab-id]').count();
  console.log(`[TFL684 close] ${before}->${after}`);
  expect(after, 'closing the active tab removes exactly one').toBe(before - 1);
  await hardClose(app, 'tfl684-close');
});
