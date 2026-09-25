// Phase 39 item 3 (DEF-348) verification.
//  (a) with ONE document, focusing the EMPTY pane must keep the shared dock
//      (presence + verb count per focused pane);
//  (b) the dock, strips, page-action bar, pills, divider and Inspector must
//      have ZERO pairwise intersection at default/narrow widths, 1/2 docs;
//  (c) the page-rotate action has ONE home, the same as single mode, with no
//      floating duplicate.
// Measurement harness: raw [P39-DEF348 ...] lines are the evidence. Canonical
// launchApp only.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, toggleMultiModeViaPalette } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
let app = null;
let win = null;
test.setTimeout(300000);

async function openDoc(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(900);
}

async function setWindow(width, height) {
  await app.evaluate(({ BrowserWindow }, sz) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) bw.setSize(sz[0], sz[1]);
  }, [width, height]);
  await win.waitForFunction((want) => Math.abs(window.innerWidth - want) <= 24, width, { timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(500);
}

async function dragDivider(targetFrac) {
  const d = await win.locator('[data-multi-divider]').boundingBox();
  const st = await win.locator('.tab-stage').boundingBox();
  const y = d.y + d.height / 2;
  const x = st.x + st.width * targetFrac;
  await win.mouse.move(d.x + d.width / 2, y);
  await win.mouse.down();
  await win.mouse.move(x, y, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(700);
}

const DOCK_STATE = `(() => {
  const dock = document.querySelector('.action-dock');
  const verbs = [...document.querySelectorAll('[data-dock-verb]')].map((b) => b.getAttribute('data-dock-verb'));
  const focused = document.querySelector('.tab-pane[data-pane-focused="true"]')?.getAttribute('data-pane') ?? null;
  return { dock: !!dock, verbCount: verbs.length, verbIds: verbs,
    idle: dock ? dock.getAttribute('data-dock-idle') : null,
    opacity: dock ? getComputedStyle(dock).opacity : null,
    focused, toolsOpen: document.querySelector('.app-main')?.getAttribute('data-tools-open') ?? null,
    activePane: document.querySelector('.tab-pane[aria-hidden="false"][data-pane]')?.getAttribute('data-pane') ?? null };
})()`;

const RECTS = `(() => {
  const out = [];
  const add = (name, el) => {
    if (!el) return;
    const b = el.getBoundingClientRect();
    if (b.width <= 0 || b.height <= 0) return;
    out.push({ name, left:+b.left.toFixed(1), top:+b.top.toFixed(1), right:+b.right.toFixed(1),
      bottom:+b.bottom.toFixed(1), w:+b.width.toFixed(1), h:+b.height.toFixed(1) });
  };
  add('dock', document.querySelector('.action-dock'));
  document.querySelectorAll('.pane-thumb-strip').forEach((el, i) => add('strip-' + i, el));
  document.querySelectorAll('[data-rail-action-bar]').forEach((el, i) => add('actionbar-' + i, el));
  document.querySelectorAll('[data-page-pill]').forEach((el, i) => add('pagepill-' + i, el));
  document.querySelectorAll('[data-zoom-pill]').forEach((el, i) => add('zoompill-' + i, el));
  add('divider', document.querySelector('[data-multi-divider]'));
  add('inspector', document.querySelector('[data-inspector]'));
  return out;
})()`;

function interArea(a, b) {
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return +(w * h).toFixed(1);
}
function contains(a, b) {
  return a.left <= b.left && a.top <= b.top && a.right >= b.right && a.bottom >= b.bottom;
}
function containmentPair(a, b) {
  return contains(a, b) || contains(b, a);
}

async function selectFirstThumb(pane) {
  const t = win.locator(`.tab-pane[data-pane="${pane}"] .thumb-item`).first();
  if (await t.count()) { await t.click({ force: true }); await win.waitForTimeout(500); }
}

async function collect(label) {
  const rects = await win.evaluate(RECTS);
  const pairs = [];
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const area = interArea(rects[i], rects[j]);
      if (area > 0) pairs.push({ a: rects[i].name, b: rects[j].name, area, contained: containmentPair(rects[i], rects[j]) });
    }
  }
  console.log(`[P39-DEF348 ${label} rects] ${JSON.stringify(rects)}`);
  console.log(`[P39-DEF348 ${label} intersectingPairs] ${JSON.stringify(pairs)}`);
  const real = pairs.filter((p) => !p.contained);
  console.log(`[P39-DEF348 ${label} nonContainmentPairs] ${JSON.stringify(real)}`);
  return { rects, pairs, real };
}

test('DEF-348a one-doc Multi Mode: dock present with each pane focused', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openDoc(getSamplePath('report.pdf'));
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1200);

  const focusA = await win.evaluate(DOCK_STATE);
  console.log(`[P39-DEF348a focusA] ${JSON.stringify(focusA)}`);
  expect(focusA.dock, 'dock present with pane A focused').toBe(true);
  expect(focusA.verbCount, 'dock shows the PAGES verb set').toBe(8);

  await win.locator('.tab-pane[data-pane="B"]').click({ position: { x: 30, y: 60 } });
  await win.waitForTimeout(800);
  const focusB = await win.evaluate(DOCK_STATE);
  console.log(`[P39-DEF348a focusB-empty] ${JSON.stringify(focusB)}`);
  expect(focusB.dock, 'dock present with the EMPTY pane B focused').toBe(true);
  expect(focusB.verbCount, 'dock still shows 8 verbs with pane B focused').toBe(8);
  expect(focusB.toolsOpen, 'Inspector stays open while the empty pane is focused').toBe('true');

  await win.locator('.tab-pane[data-pane="A"] .pdf-page').first().click({ force: true });
  await win.waitForTimeout(700);
  const backA = await win.evaluate(DOCK_STATE);
  console.log(`[P39-DEF348a focusA-again] ${JSON.stringify(backA)}`);
  expect(backA.dock).toBe(true);
  expect(backA.verbCount).toBe(8);

  await win.screenshot({ path: path.join(SHOTS, 'def-348-multiview-one-doc.png') });
  await hardClose(app, 'def348a');
  app = null; win = null;
});

async function oneDocMulti() {
  await openDoc(getSamplePath('report.pdf'));
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1000);
}
async function twoDocMulti() {
  await openDoc(getSamplePath('report.pdf'));
  await openDoc(getSamplePath('long.pdf'));
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1000);
  const pick = win.locator('.tab-pane[data-pane-empty] [data-pane-pick]').first();
  if (await pick.count()) { await pick.click(); await win.waitForTimeout(1800); }
  await win.locator('.tab-pane[data-pane="A"] .pdf-page').first().click({ force: true });
  await win.waitForTimeout(600);
}

test('DEF-348b zero pairwise intersection at default/narrow, one/two documents', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const defWidth = 1442;
  const results = [];

  await oneDocMulti();
  await selectFirstThumb('A');
  results.push(['default-1doc', await collect('default-1doc')]);
  await dragDivider(0.30);
  await selectFirstThumb('A');
  results.push(['default-narrow-pane-1doc', await collect('default-narrow-pane-1doc')]);
  await dragDivider(0.50);
  await setWindow(700, 720);
  await selectFirstThumb('A');
  results.push(['narrow-1doc', await collect('narrow-1doc')]);
  await win.screenshot({ path: path.join(SHOTS, 'def-348-narrow-window.png') });
  await setWindow(defWidth, 903);

  await hardClose(app, 'def348b-1');
  app = null; win = null;

  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await twoDocMulti();
  await selectFirstThumb('A');
  await selectFirstThumb('B');
  results.push(['default-2doc', await collect('default-2doc')]);
  await dragDivider(0.30);
  await selectFirstThumb('A');
  await selectFirstThumb('B');
  results.push(['default-narrow-pane-2doc', await collect('default-narrow-pane-2doc')]);
  await dragDivider(0.50);
  await setWindow(700, 720);
  await selectFirstThumb('A');
  await selectFirstThumb('B');
  results.push(['narrow-2doc', await collect('narrow-2doc')]);

  const failures = [];
  for (const [label, r] of results) {
    for (const p of r.real) failures.push(`${label}: ${p.a}/${p.b} area=${p.area}`);
  }
  console.log(`[P39-DEF348b summary] ${JSON.stringify(failures)}`);
  expect(failures, 'non-containment intersections (must be none)').toEqual([]);

  await hardClose(app, 'def348b-2');
  app = null; win = null;
});

test('DEF-348c page-rotate home parity: single mode vs Multi Mode', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  // SINGLE mode: select a page in the rail and read the page-action homes.
  await openDoc(getSamplePath('report.pdf'));
  await selectFirstThumbSingle();
  const single = await rotateHomes('single');

  // MULTI mode (one document, pane A focused): same reads.
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1200);
  await selectFirstThumb('A');
  const multi = await rotateHomes('multi');

  console.log(`[P39-DEF348c single] ${JSON.stringify(single)}`);
  console.log(`[P39-DEF348c multi]  ${JSON.stringify(multi)}`);
  expect(multi.dockRotate, 'dock exposes the rotate verb in Multi Mode').toBe(1);
  expect(multi.actionBarFloating, 'no page-action bar floats outside its pane strip').toBe(0);
  expect(multi.actionBarInStrip, 'page-action bar (if any) is contained by its pane strip').toBe(multi.actionBarCount);
  expect(multi.actionBarHitsDock, 'page-action bar does not intersect the dock').toBe(0);
  await hardClose(app, 'def348c');
  app = null; win = null;
});

async function selectFirstThumbSingle() {
  const t = win.locator('.workspace .thumb-item, .app-main .thumb-item').first();
  if (await t.count()) { await t.click({ force: true }); await win.waitForTimeout(500); }
}

const ROTATE_HOMES = `(() => {
  const bars = [...document.querySelectorAll('[data-rail-action-bar]')].map((el) => {
    const b = el.getBoundingClientRect();
    const strip = el.closest('.pane-thumb-strip');
    const sb = strip ? strip.getBoundingClientRect() : null;
    return { left:+b.left.toFixed(1), top:+b.top.toFixed(1), right:+b.right.toFixed(1), bottom:+b.bottom.toFixed(1),
      inStrip: sb ? (b.left >= sb.left - 1 && b.right <= sb.right + 1 && b.top >= sb.top - 1 && b.bottom <= sb.bottom + 1) : null };
  });
  const dock = document.querySelector('.action-dock');
  const dockRect = dock ? dock.getBoundingClientRect() : null;
  const hits = (r) => dockRect ? Math.max(0, Math.min(r.right, dockRect.right) - Math.max(r.left, dockRect.left)) *
    Math.max(0, Math.min(r.bottom, dockRect.bottom) - Math.max(r.top, dockRect.top)) : 0;
  return { actionBarCount: bars.length, bars,
    actionBarInStrip: bars.filter((b) => b.inStrip === true).length,
    actionBarFloating: bars.filter((b) => b.inStrip === false).length,
    actionBarHitsDock: bars.filter((b) => hits(b) > 0).length,
    dockRotate: document.querySelectorAll('[data-dock-verb="rotate"]').length,
    dockPresent: !!dock };
})()`;

async function rotateHomes(label) {
  return win.evaluate(ROTATE_HOMES);
}

test.afterEach(async () => {
  if (app) await hardClose(app, 'def348');
  app = null;
  win = null;
});
