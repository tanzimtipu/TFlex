// Phase 39 DEF-349 verification - the narrow-window Multi Mode pill overlap.
//
// At 1442 / 700 / 640 with ONE and TWO documents, each pane's two floating
// pills must intersect ZERO px^2 of any pane thumbnail strip, any strip
// page-action bar, the shared Action Dock and the divider - and every pill
// must stay hit-testable (elementFromPoint returns the pill or its child).
// Raw [P39-DEF349 ...] lines are the evidence table. Canonical launchApp only.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, toggleMultiModeViaPalette } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
let app = null;
let win = null;
test.setTimeout(360000);

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
  await win.waitForTimeout(600);
}

const RECTS = `(() => {
  const box = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    if (b.width <= 0 || b.height <= 0) return null;
    return { left:+b.left.toFixed(1), top:+b.top.toFixed(1), right:+b.right.toFixed(1),
      bottom:+b.bottom.toFixed(1), w:+b.width.toFixed(1), h:+b.height.toFixed(1) };
  };
  const res = { panes: {}, strips: [], actionbars: [], pills: [],
    dock: box(document.querySelector('.action-dock')),
    divider: box(document.querySelector('[data-multi-divider]')) };
  document.querySelectorAll('.tab-pane[data-pane]').forEach((p) => {
    const id = p.getAttribute('data-pane');
    const strip = p.querySelector('.pane-thumb-strip');
    const ab = p.querySelector('[data-rail-action-bar]');
    res.panes[id] = {
      band: getComputedStyle(p).getPropertyValue('--tf-multi-pill-band').trim(),
      span: getComputedStyle(p).getPropertyValue('--tf-multi-pill-span').trim(),
      strip: box(strip), actionbar: box(ab) };
    if (strip) res.strips.push({ name: 'strip-' + id, rect: box(strip) });
    if (ab) res.actionbars.push({ name: 'actionbar-' + id, rect: box(ab) });
    const pp = p.querySelector('[data-page-pill]');
    const zp = p.querySelector('[data-zoom-pill]');
    if (pp) res.pills.push({ name: 'pagepill-' + id, rect: box(pp) });
    if (zp) res.pills.push({ name: 'zoompill-' + id, rect: box(zp) });
  });
  return res;
})()`;

const HITTABLE = `(() => {
  const out = [];
  const check = (name, el) => {
    const b = el.getBoundingClientRect();
    if (b.width <= 0 || b.height <= 0) { out.push({ name, hit: false, why: 'no-box' }); return; }
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const ok = hit === el || el.contains(hit);
    out.push({ name, hit: ok, cx: Math.round(cx), cy: Math.round(cy),
      got: hit ? hit.tagName.toLowerCase() : null });
  };
  document.querySelectorAll('.tab-pane[data-pane]').forEach((p) => {
    const id = p.getAttribute('data-pane');
    const pp = p.querySelector('[data-page-pill]');
    const zp = p.querySelector('[data-zoom-pill]');
    if (pp) check('pagepill-' + id, pp);
    if (zp) check('zoompill-' + id, zp);
  });
  return out;
})()`;

function inter(a, b) {
  if (!a || !b) return 0;
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return +(w * h).toFixed(1);
}

async function selectFirstThumb(pane) {
  const t = win.locator(`.tab-pane[data-pane="${pane}"] .thumb-item`).first();
  if (await t.count()) { await t.click({ force: true }); await win.waitForTimeout(500); }
}

async function collect(label, failures) {
  const r = await win.evaluate(RECTS);
  const h = await win.evaluate(HITTABLE);
  const targets = [...r.strips, ...r.actionbars];
  if (r.dock) targets.push({ name: 'dock', rect: r.dock });
  if (r.divider) targets.push({ name: 'divider', rect: r.divider });
  const rows = [];
  for (const pill of r.pills) {
    for (const t of targets) {
      const area = inter(pill.rect, t.rect);
      rows.push({ case: label, pill: pill.name, vs: t.name, area });
      if (area > 0) failures.push(`${label}: ${pill.name} vs ${t.name} = ${area} px^2`);
    }
  }
  for (const x of h.filter((y) => !y.hit)) {
    failures.push(`${label}: ${x.name} NOT hittable at (${x.cx},${x.cy}) got ${x.got}`);
  }
  const bands = Object.fromEntries(Object.entries(r.panes).map(([k, v]) => [k, { band: v.band, span: v.span }]));
  console.log(`[P39-DEF349 ${label} bands] ${JSON.stringify(bands)}`);
  console.log(`[P39-DEF349 ${label} rects] ${JSON.stringify({ strips: r.strips, actionbars: r.actionbars, pills: r.pills, dock: r.dock, divider: r.divider })}`);
  console.log(`[P39-DEF349 ${label} rows] ${JSON.stringify(rows)}`);
  console.log(`[P39-DEF349 ${label} hittable] ${JSON.stringify(h)}`);
  return r;
}

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

test('DEF-349 narrow-window pills intersect no strip/bar/dock/divider and stay hittable', async () => {
  const failures = [];

  // ONE document.
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await oneDocMulti();
  for (const [w, h] of [[1442, 903], [700, 720], [640, 720]]) {
    await setWindow(w, h);
    await selectFirstThumb('A');
    await collect(`1doc-${w}`, failures);
  }
  await hardClose(app, 'def349-1doc');
  app = null; win = null;

  // TWO documents.
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await twoDocMulti();
  for (const [w, h] of [[1442, 903], [700, 720], [640, 720]]) {
    await setWindow(w, h);
    await selectFirstThumb('A');
    await selectFirstThumb('B');
    await collect(`2doc-${w}`, failures);
    if (w === 700) await win.screenshot({ path: path.join(SHOTS, 'def-349-verify-700.png') });
  }
  console.log(`[P39-DEF349 summary] ${JSON.stringify(failures)}`);
  expect(failures, 'zero pill intersections and every pill hittable').toEqual([]);

  await hardClose(app, 'def349-2doc');
  app = null; win = null;
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'def349');
  app = null;
  win = null;
});
