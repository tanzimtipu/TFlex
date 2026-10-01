// Phase 66 (TFL-161 / DEF-448) focused FIX-READY verification e2e (QA).
//
// DEF-448 (ACCEPTED from ADV-135, MEDIUM): in Book View, changing an
// annotation's colour through the portaled colour popover ALSO turned the book
// page. The TFL-160 fix broadens the BookView page-turn guard to any annotation
// UI root (`.annotation-layer`, `[data-content-action-bar]`,
// `[data-color-popover]`). This spec reproduces the ADV-135 probe against the
// real app and asserts BOTH the colour is applied AND the page does not turn,
// in single and double layout.
//
// Launch ONLY through e2e/lib/launch.cjs (the canonical launcher).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
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
  if (app) await hardClose(app, 'p66colorpop');
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
  const tOpen = Date.now();
  await win.locator('[aria-label="Book View"]').click();
  await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 15000 });
  console.log('P66_PERF openVisibleMs = ' + (Date.now() - tOpen));
  await win.waitForTimeout(600);
}

function pageNumbers() {
  return win.locator('[data-book-page]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-book-page')),
  );
}

async function engineAnnotations() {
  return win.evaluate(() => {
    const st = window.tflexDiagnostics().engineState;
    return (st && st.annotations) || [];
  });
}

async function waitForAnn(kind, page, timeout = 10000) {
  const t0 = Date.now();
  let last = [];
  while (Date.now() - t0 < timeout) {
    last = await engineAnnotations();
    const a = last.find((x) => x.kind === kind && x.page === page);
    if (a) return a;
    await win.waitForTimeout(150);
  }
  return { missing: true, last: last.map((a) => ({ id: a.id, kind: a.kind, page: a.page })) };
}

// Arm a tool through the Book View toolbar whichever lane hosts it: the inline
// MRU buttons or the toolbar's own All-tools menu (same lane logic as
// e2e/phase66_bookview_annotations.spec.cjs).
async function armToolInBook(tool) {
  const visible = win.locator(`[data-book-tools] [data-ann-tools-visible] [data-tool="${tool}"]`);
  if ((await visible.count()) > 0) {
    await visible.first().click();
  } else {
    await win.locator('[data-book-tools] [data-ann-dropdown-toggle]').click();
    await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'visible', timeout: 8000 });
    await win.locator(`[data-ann-dropdown-menu] [data-tool="${tool}"]`).click();
    await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'detached', timeout: 8000 });
  }
  await win.waitForTimeout(300);
}

async function dragOn(locator, dx = 140, dy = 70) {
  const bb = await locator.boundingBox();
  if (bb === null) throw new Error('drag target has no bounding box');
  const x = Math.round(bb.x + bb.width * 0.3);
  const y = Math.round(bb.y + bb.height * 0.3);
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dx, y + dy, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(1200);
}

// Drive the ADV-135 recolour: select the annotation, open its action-bar colour
// box (screenshot "before"), then pick built-in green from the portaled popover
// (screenshot "after").
async function recolourToGreen(ann, pageNo, shotBase) {
  await armToolInBook('select');
  await win
    .locator(`[data-annotation-layer="${pageNo}"] [data-annotation-id="${ann.id}"]`)
    .first()
    .click();
  await win.waitForSelector('[data-content-action-bar]', { state: 'visible', timeout: 8000 });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(SHOTS, `${shotBase}-before.png`) });

  await win.locator('[data-content-action-bar] [data-ann-color-box]').click();
  await win.waitForSelector('[data-color-popover]', { state: 'visible', timeout: 8000 });
  await win.waitForTimeout(300);
  await win.locator('[data-color-popover] [aria-label="Built-in green"]').click();
  await win.waitForSelector('[data-color-popover]', { state: 'detached', timeout: 8000 });
  await win.waitForTimeout(600);
  await win.screenshot({ path: path.join(SHOTS, `${shotBase}-after.png`) });
}

// ---------------------------------------------------------------------------
// Single layout - ADV-135 primary repro. Place ink on page 1, recolour it to
// green through the portaled popover; the colour must apply AND [data-book-page]
// must stay "1" (the page must NOT turn).
// ---------------------------------------------------------------------------
test('DEF-448 single: recolouring an ink annotation does not turn the page', async () => {
  await openBookView(getSamplePath('report.pdf'));
  expect(await win.locator('[data-book-stage]').getAttribute('data-book-layout')).toBe('single');

  await armToolInBook('ink');
  await dragOn(win.locator('[data-book-stage] .pdf-page').first());
  const ann = await waitForAnn('ink', 1);
  console.log('P66_COLORPOP single ink ' + JSON.stringify({ ann }));
  expect(ann.missing, `no ink committed on page 1: ${JSON.stringify(ann)}`).toBeFalsy();
  expect(await pageNumbers(), 'placement gesture turned the page').toEqual(['1']);
  const beforeColor = ann.color;
  expect(beforeColor, 'ink should not already be green').not.toBe('green');

  await recolourToGreen(ann, 1, 'adv-135-single');

  const after = (await engineAnnotations()).find((a) => a.id === ann.id);
  const pages = await pageNumbers();
  console.log(
    'P66_COLORPOP single result ' +
      JSON.stringify({ beforeColor, afterColor: after && after.color, pages }),
  );
  expect(after && after.color, 'the colour was not applied to the engine annotation').toBe('green');
  expect(pages, 'recolouring through the portaled popover turned the page (DEF-448)').toEqual(['1']);
});

// ---------------------------------------------------------------------------
// Double layout - the stroke is placed on the RIGHT page (page 2), recoloured;
// the whole spread must stay [1,2] (the spread must NOT advance) and the colour
// must apply.
// ---------------------------------------------------------------------------
test('DEF-448 double: recolouring an ink annotation on the right page does not advance the spread', async () => {
  await openBookView(getSamplePath('report.pdf'));
  await win.locator('[aria-label="Book double page"]').click();
  await win.waitForSelector('[data-book-stage][data-book-layout="double"]', { timeout: 5000 });
  await win.waitForTimeout(400);
  expect(await pageNumbers(), 'double spread did not start at 1,2').toEqual(['1', '2']);

  await armToolInBook('ink');
  await dragOn(win.locator('[data-book-page-side="right"] .pdf-page').first());
  const ann = await waitForAnn('ink', 2);
  console.log('P66_COLORPOP double ink ' + JSON.stringify({ ann }));
  expect(ann.missing, `no ink committed on page 2 (right): ${JSON.stringify(ann)}`).toBeFalsy();
  expect(await pageNumbers(), 'placement gesture advanced the spread').toEqual(['1', '2']);
  const beforeColor = ann.color;
  expect(beforeColor, 'ink should not already be green').not.toBe('green');

  await recolourToGreen(ann, 2, 'adv-135-double');

  const after = (await engineAnnotations()).find((a) => a.id === ann.id);
  const pages = await pageNumbers();
  console.log(
    'P66_COLORPOP double result ' +
      JSON.stringify({ beforeColor, afterColor: after && after.color, pages }),
  );
  expect(after && after.color, 'the colour was not applied to the engine annotation').toBe('green');
  expect(pages, 'recolouring advanced the spread (DEF-448)').toEqual(['1', '2']);
});
