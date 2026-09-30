// Phase 66 (chunk 2) focused-verification e2e (QA).
//
// Book View spread + centre crease + page-turn flip + single/double toggle.
// REQUIREMENTS.md criteria 3 and 4. Chunk 1 (entry/shell) is verified by
// e2e/phase66_bookview.spec.cjs and is re-run as the blast-radius check.
//
// Launch ONLY through e2e/lib/launch.cjs. The OS open dialog is native, so
// `dialog.showOpenDialog` is stubbed in the main process and the app's real
// Open button is clicked - the same pattern e2e/phase66_bookview.spec.cjs uses.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..', 'test-fixtures', 'phase56');
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const CBZ = path.join(FIX, 'phase56-comic.cbz');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'phase66spread');
  app = null;
  win = null;
});

test.setTimeout(180000);

async function stubOpen(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
}

async function openBookView(filePath) {
  await stubOpen(filePath);
  await win.locator('[aria-label="Open PDF document"]').first().click();
  await win.waitForSelector('[aria-label="Book View"]', { state: 'visible', timeout: 60000 });
  await win.waitForTimeout(400);
  await win.locator('[aria-label="Book View"]').click();
  await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 15000 });
  await win.waitForTimeout(400);
}

function stageLayout() {
  return win.locator('[data-book-stage]').getAttribute('data-book-layout');
}

async function pageNumbers() {
  return win.locator('[data-book-page]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-book-page')),
  );
}

// Record whether the transient flip class is ever applied to `side` after a
// click. A MutationObserver is used because the class lives only for the turn
// (animationend + a 400ms fallback) and can vanish before a polled read.
async function watchTurn(side) {
  await win.evaluate((s) => {
    const state = { hit: false, cls: null };
    window.__p66turn = state;
    if (window.__p66turnObs) window.__p66turnObs.disconnect();
    const stage = document.querySelector('[data-book-stage]');
    const check = () => {
      const f = document.querySelector(`[data-book-page-side="${s}"]`);
      if (
        f &&
        (f.classList.contains('book-view-turn-next') ||
          f.classList.contains('book-view-turn-prev'))
      ) {
        state.hit = true;
        state.cls = f.className;
      }
    };
    const obs = new MutationObserver(check);
    obs.observe(stage, {
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
      childList: true,
    });
    window.__p66turnObs = obs;
  }, side);
}

async function clickAndReadTurn(selector) {
  await win.locator(selector).click();
  await win.waitForFunction(() => window.__p66turn && window.__p66turn.hit, null, {
    timeout: 3000,
  });
  return win.evaluate(() => window.__p66turn);
}

// ---------------------------------------------------------------------------
// Criterion 4 - single/double toggle. Opens in single (stored default), the
// toggle pair sits at the header top-right, and a single page turns by one.
// ---------------------------------------------------------------------------
test('criterion 4: single mode, toggle pair top-right, single page turns by one', async () => {
  await openBookView(getSamplePath('report.pdf'));

  expect(await stageLayout(), 'Book View did not open in single mode').toBe('single');
  expect(await win.locator('[data-book-page]').count(), 'single mode is not one page').toBe(1);
  expect(await win.locator('[data-book-page-side="single"]').count()).toBe(1);
  expect(await win.locator('[data-book-crease]').count(), 'single mode shows a crease').toBe(0);

  const single = win.locator('[aria-label="Book single page"]');
  const dbl = win.locator('[aria-label="Book double page"]');
  expect(await single.count(), 'single toggle missing').toBe(1);
  expect(await dbl.count(), 'double toggle missing').toBe(1);
  expect(await single.getAttribute('aria-pressed')).toBe('true');
  expect(await dbl.getAttribute('aria-pressed')).toBe('false');

  const box = await win.locator('.book-view-layout-toggle').boundingBox();
  const frame = await win.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  expect(box, 'layout toggle has no box').not.toBeNull();
  expect(box.x, `layout toggle not top-right (x=${box && box.x})`).toBeGreaterThan(frame.width / 2);
  expect(box.y, `layout toggle not at top (y=${box && box.y})`).toBeLessThan(frame.height / 2);

  await win.screenshot({ path: path.join(SHOTS, 'phase66-spread-single.png') });

  const before = await pageNumbers();
  expect(before, 'single opens on page 1').toEqual(['1']);
  await watchTurn('single');
  const turn = await clickAndReadTurn('[data-book-page-side="single"]');
  expect(turn.cls, 'single turn did not carry book-view-turn-next').toContain('book-view-turn-next');
  const after = await pageNumbers();
  console.log('P66_SPREAD single ' + JSON.stringify({ before, after, turn: turn.cls }));
  expect(after, 'single did not advance by exactly one').toEqual(['2']);
});

// ---------------------------------------------------------------------------
// Criterion 3 - double spread: two sides + centre crease, advance/retreat by 2.
// Uses the 12-page cbz fixture (converted comic) for the double-spread path.
// ---------------------------------------------------------------------------
test('criterion 3: double spread, centre crease, +2 next and -2 prev with flip', async () => {
  await openBookView(CBZ);

  await win.locator('[aria-label="Book double page"]').click();
  await win.waitForSelector('[data-book-stage][data-book-layout="double"]', { timeout: 5000 });
  await win.waitForTimeout(300);

  expect(await win.locator('[data-book-page]').count(), 'double spread is not two pages').toBe(2);
  const sides = await win.locator('[data-book-page]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-book-page-side')),
  );
  expect(sides).toEqual(['left', 'right']);

  const crease = win.locator('[data-book-crease]');
  expect(await crease.count(), 'centre crease absent').toBe(1);
  expect(await crease.isVisible(), 'centre crease not visible').toBe(true);
  const cbox = await crease.boundingBox();
  expect(cbox, 'crease has no layout box').not.toBeNull();
  expect(cbox.width, 'crease has zero width').toBeGreaterThan(0);
  expect(cbox.height, 'crease has zero height').toBeGreaterThan(0);
  const creaseBg = await crease.evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(creaseBg, 'crease has no seam paint').not.toBe('none');
  await win.screenshot({ path: path.join(SHOTS, 'phase66-spread-double-crease.png') });

  const before = await pageNumbers();
  expect(before, 'double spread does not start at 1,2').toEqual(['1', '2']);
  await watchTurn('right');
  const next = await clickAndReadTurn('[data-book-page-side="right"]');
  expect(next.cls, 'right turn did not carry book-view-turn-next').toContain('book-view-turn-next');
  const afterNext = await pageNumbers();
  await win.screenshot({ path: path.join(SHOTS, 'phase66-spread-double-after-next.png') });
  expect(afterNext, 'right click did not advance the spread by two').toEqual(['3', '4']);

  await watchTurn('left');
  const prev = await clickAndReadTurn('[data-book-page-side="left"]');
  expect(prev.cls, 'left turn did not carry book-view-turn-prev').toContain('book-view-turn-prev');
  const afterPrev = await pageNumbers();
  await win.screenshot({ path: path.join(SHOTS, 'phase66-spread-double-after-prev.png') });
  expect(afterPrev, 'left click did not retreat the spread by two').toEqual(['1', '2']);

  console.log(
    'P66_SPREAD double ' +
      JSON.stringify({ before, afterNext, afterPrev, next: next.cls, prev: prev.cls }),
  );
});

// ---------------------------------------------------------------------------
// Reduced motion - the layout motion token resolves to 0 and the spread still
// advances on a page click (the flip is instant, not lost).
// ---------------------------------------------------------------------------
test('reduced motion: --motion-duration-layout resolves to 0 and the spread still advances', async () => {
  await openBookView(getSamplePath('report.pdf'));
  await win.locator('[aria-label="Book double page"]').click();
  await win.waitForSelector('[data-book-stage][data-book-layout="double"]', { timeout: 5000 });

  await win.emulateMedia({ reducedMotion: 'reduce' });
  await win.waitForTimeout(200);
  const raw = await win.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--motion-duration-layout'),
  );
  console.log('P66_SPREAD reduced-motion token = ' + JSON.stringify(raw));
  expect(Number.isNaN(parseFloat(raw)), `token did not resolve (${raw})`).toBe(false);
  expect(parseFloat(raw), `token is not 0 under reduced motion (${raw})`).toBe(0);

  const before = await pageNumbers();
  expect(before).toEqual(['1', '2']);
  await watchTurn('right');
  await clickAndReadTurn('[data-book-page-side="right"]');
  const after = await pageNumbers();
  await win.screenshot({ path: path.join(SHOTS, 'phase66-spread-reduced-motion.png') });
  expect(after, 'spread did not advance under reduced motion').toEqual(['3', '4']);
  console.log('P66_SPREAD reduced ' + JSON.stringify({ before, after, raw }));
});
