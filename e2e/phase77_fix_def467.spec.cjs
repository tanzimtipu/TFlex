// Phase 77 FIX-READY verification for DEF-467 (turn leaf is a live annotation
// hit surface) and DEF-468 (1-page double label "Page 1-1 of 1").
//
// QA-owned spec. Launch ONLY through e2e/lib/launch.cjs. The repro is the
// adversary's recorded path (test-fixtures/adv-tfl271/cw.spec.cjs): arm ink,
// start a forward turn, pause the leaf early, then probe elementFromPoint and
// drive a real drag. Pre-fix that drag committed ink to the OUTGOING page.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..', 'test-fixtures');
const P16 = path.join(FIX, 'adv-p33', 'pages16.pdf');
const P1 = path.join(FIX, 'adv-p34', 'one-page.pdf');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;

test.setTimeout(180000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(250);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'phase77fix');
  app = null;
  win = null;
});

async function openBookView(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
  await win.locator('[aria-label="Open PDF document"]').first().click();
  await win.waitForSelector('[aria-label="Book View"]', { state: 'visible', timeout: 60000 });
  await win.waitForTimeout(400);
  await win.locator('[aria-label="Book View"]').click();
  await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 15000 });
  await win.waitForTimeout(450);
}

async function armInk() {
  const v = win.locator('[data-book-tools] [data-ann-tools-visible] [data-tool="ink"]');
  if ((await v.count()) > 0) {
    await v.first().click();
  } else {
    await win.locator('[data-book-tools] [data-ann-dropdown-toggle]').click();
    await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'visible', timeout: 8000 });
    await win.locator('[data-ann-dropdown-menu] [data-tool="ink"]').click();
    await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'detached', timeout: 8000 });
  }
  await win.waitForTimeout(250);
}

function anns() {
  return win.evaluate(() =>
    window.tflexDiagnostics().engineState.annotations.map((a) => ({ kind: a.kind, page: a.page })),
  );
}

function progressText() {
  return win.locator('[data-book-progress]').innerText();
}

async function useDouble() {
  await win.locator('[aria-label="Book double page"]').click();
  await win.waitForSelector('[data-book-stage][data-book-layout="double"]', { timeout: 5000 });
  await win.waitForTimeout(300);
}

// DEF-467 attack: arm ink, start a forward turn, freeze the leaf mid-swing at
// currentTime 55, probe the point over the OUTGOING page, then drag there.
// `xFraction` selects the outgoing page's centre (0.75 double right half, 0.5
// single); `outgoing` is the page number the buggy leaf would capture.
async function runAttack(xFraction, outgoing, label) {
  await armInk();
  const before = await anns();

  await win.locator('[data-book-next]').click();
  await win.waitForSelector('[data-book-turn]', { state: 'attached', timeout: 2000 });

  const geom = await win.evaluate((frac) => {
    const l = document.querySelector('[data-book-turn]');
    if (l !== null) l.getAnimations().forEach((a) => { a.pause(); a.currentTime = 55; });
    const stage = document.querySelector('[data-book-stage]');
    const sr = stage.getBoundingClientRect();
    const x = Math.round(sr.left + sr.width * frac);
    const y = Math.round(sr.top + sr.height * 0.5);
    const el = document.elementFromPoint(x, y);
    const layer = el === null ? null : el.closest('[data-annotation-layer]');
    const points = [
      [0.5, 0.5], [0.65, 0.3], [0.75, 0.5], [0.85, 0.7], [0.6, 0.7],
    ];
    const probes = points.map(([fx, fy]) => {
      const px = Math.round(sr.left + sr.width * fx);
      const py = Math.round(sr.top + sr.height * fy);
      const e = document.elementFromPoint(px, py);
      return {
        fx, fy, tag: e === null ? null : e.tagName,
        cls: e === null ? null : String(e.className).slice(0, 60),
        pe: e === null ? null : getComputedStyle(e).pointerEvents,
        inTurn: e !== null && e.closest('[data-book-turn]') !== null,
      };
    });
    return {
      x,
      y,
      activeLayerInsideTurn: document.querySelector('[data-book-turn] .annotation-layer-active') !== null,
      elementTag: el === null ? null : el.tagName,
      elementClass: el === null ? null : String(el.className).slice(0, 120),
      elementPointer: el === null ? null : getComputedStyle(el).pointerEvents,
      elementInsideTurn: el !== null && el.closest('[data-book-turn]') !== null,
      elementIsTurnWrapper: el !== null && el.hasAttribute && el.hasAttribute('data-book-turn'),
      layerPage: layer === null ? null : layer.getAttribute('data-annotation-layer'),
      probes,
      progress: document.querySelector('[data-book-progress]').textContent,
    };
  }, xFraction);
  await win.screenshot({ path: path.join(SHOTS, `phase77-def467-${label}-midturn.png`) });

  // (a) the transient leaf must not expose the armed-tool active layer.
  expect(geom.activeLayerInsideTurn, `[data-book-turn] still has .annotation-layer-active (${label})`).toBe(false);
  // (b) hit-testing over the outgoing page must not resolve inside the leaf.
  console.log(`DEF467_${label.toUpperCase()}_B ` + JSON.stringify(geom));
  expect(geom.elementInsideTurn, `elementFromPoint resolved inside [data-book-turn]: ${JSON.stringify(geom)}`).toBe(false);

  // (c) a short real drag started mid-turn must not commit to the OUTGOING page.
  await win.mouse.move(geom.x, geom.y);
  await win.mouse.down();
  await win.mouse.move(geom.x + 40, geom.y + 30, { steps: 4 });
  await win.mouse.up();
  await win.evaluate(() => {
    const l = document.querySelector('[data-book-turn]');
    if (l !== null) l.getAnimations().forEach((a) => a.play());
  });
  await win.waitForTimeout(1500);
  const after = await anns();
  const afterProgress = await progressText();
  await win.screenshot({ path: path.join(SHOTS, `phase77-def467-${label}-after.png`) });

  const beforeOut = before.filter((a) => a.page === outgoing).length;
  const afterOut = after.filter((a) => a.page === outgoing).length;
  console.log(`DEF467_${label.toUpperCase()} ` + JSON.stringify({ before, after, geom, afterProgress, beforeOut, afterOut }));
  expect(afterOut, `ink committed to OUTGOING page ${outgoing} (${label})`).toBe(beforeOut);
  return { geom, before, after };
}

test('DEF-467 double: mid-turn drag does not touch the outgoing page or the live leaf layer', async () => {
  await openBookView(P16);
  await useDouble();
  expect(await win.locator('[data-book-stage]').getAttribute('data-book-layout')).toBe('double');
  const r = await runAttack(0.75, 2, 'double');
});

test('DEF-467 single: mid-turn drag does not touch the outgoing page or the live leaf layer', async () => {
  await openBookView(P16);
  await win.locator('[aria-label="Book single page"]').click();
  await win.waitForSelector('[data-book-stage][data-book-layout="single"]', { timeout: 5000 });
  await win.waitForTimeout(300);
  const r = await runAttack(0.5, 1, 'single');
});

test('DEF-468: 1-page document collapses to "Page 1 of 1" in double (and single)', async () => {
  await openBookView(P1);
  const single = await progressText();
  await win.screenshot({ path: path.join(SHOTS, 'phase77-def468-1page-single.png') });
  expect(single, 'single-mode 1-page label').toBe('Page 1 of 1');

  await useDouble();
  const dbl = await progressText();
  await win.screenshot({ path: path.join(SHOTS, 'phase77-def468-1page-double.png') });
  console.log('DEF468_1PAGE ' + JSON.stringify({ single, double: dbl }));
  expect(dbl, 'double-mode 1-page label collapsed').toBe('Page 1 of 1');
});

test('DEF-468 no regression: multi-page double reads "Page 1-2 of T" and single "Page 1 of T"', async () => {
  await openBookView(P16);
  await win.locator('[aria-label="Book single page"]').click();
  await win.waitForSelector('[data-book-stage][data-book-layout="single"]', { timeout: 5000 });
  await win.waitForTimeout(300);
  const single = await progressText();
  expect(single, 'multi-page single label').toMatch(/^Page 1 of (\d+)$/);
  const total = single.replace(/^Page 1 of /, '');

  await useDouble();
  const dbl = await progressText();
  await win.screenshot({ path: path.join(SHOTS, 'phase77-def468-multi-double.png') });
  console.log('DEF468_MULTI ' + JSON.stringify({ single, double: dbl, total }));
  expect(total, 'fixture is not 16 pages').toBe('16');
  expect(dbl, 'multi-page double label').toBe(`Page 1-2 of ${total}`);
});
