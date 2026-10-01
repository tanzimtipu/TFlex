// Phase 66 (chunk 3) focused-verification e2e (QA).
//
// Book View annotation marking - REQUIREMENTS.md Phase 66 feature E, success
// criterion 5: the EXISTING annotation toolbar is re-parented into Book View
// as its one marking surface and a highlight / ink stroke placed on the book
// page commits to the SAME engine DocumentView uses, survives a leave +
// re-enter of the mode, and survives save + reopen. The Action Dock stays
// absent while Book View is on.
//
// Launch ONLY through e2e/lib/launch.cjs. The OS open dialog is native, so
// `dialog.showOpenDialog` is stubbed in the main process and the app's real
// Open button is clicked - the same pattern e2e/phase66_bookview.spec.cjs uses.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, openSamplePath } = require('./lib/helpers.cjs');

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
  if (app) await hardClose(app, 'p66ann');
  app = null;
  win = null;
});

test.setTimeout(180000);

async function stubOpen(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
}

async function clickOpen() {
  await win.locator('[aria-label="Open PDF document"]').first().click();
}

async function openBookView(filePath) {
  await stubOpen(filePath);
  await clickOpen();
  await win.waitForSelector('[aria-label="Book View"]', { state: 'visible', timeout: 60000 });
  await win.waitForTimeout(400);
  await win.locator('[aria-label="Book View"]').click();
  await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 15000 });
  await win.waitForTimeout(600);
}

async function enterBookView() {
  await win.locator('[aria-label="Book View"]').click();
  await win.waitForSelector('[data-book-view]', { state: 'visible', timeout: 15000 });
  await win.waitForTimeout(600);
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

// The visible book page (page 1) inside the Book View stage.
function bookPage() {
  return win.locator('[data-book-stage] .pdf-page[data-page="1"]').first();
}

async function dragOnBookPage(dx = 160, dy = 90) {
  const pg = await bookPage().boundingBox();
  if (pg === null) throw new Error('book page 1 has no bounding box');
  const x = Math.round(pg.x + pg.width * 0.3);
  const y = Math.round(pg.y + pg.height * 0.3);
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dx, y + dy, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(1200);
  return { x, y };
}

function overlayNode(id) {
  return win.locator(`[data-annotation-layer="1"] [data-annotation-id="${id}"]`);
}

// Arm ink through the Book View toolbar whichever lane currently hosts it: the
// five inline MRU buttons or the toolbar's own All-tools menu.
async function armBookInk() {
  const visible = win.locator('[data-book-tools] [data-ann-tools-visible] [data-tool="ink"]');
  if ((await visible.count()) > 0) {
    await visible.first().click();
  } else {
    await win.locator('[data-book-tools] [data-ann-dropdown-toggle]').click();
    await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'visible', timeout: 8000 });
    await win.locator('[data-ann-dropdown-menu] [data-tool="ink"]').click();
    await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'detached', timeout: 8000 });
  }
  await win.waitForTimeout(300);
}

// ---------------------------------------------------------------------------
// Criterion 5a - toolbar present in Book View, no Action Dock, and an ink
// stroke placed on the book page commits and survives leave + re-enter.
// ---------------------------------------------------------------------------
test('criterion 5: toolbar present, ink placed, survives leave + re-enter', async () => {
  await openBookView(getSamplePath('report.pdf'));

  // -- toolbar present, Action Dock absent ----------------------------------
  const toolbar = win.locator('[data-book-tools] [data-annotation-toolbar]');
  expect(await toolbar.count(), 'Book View annotation toolbar missing').toBe(1);
  // The five visible buttons are the persisted MRU (visibleAnnotationTools), so
  // which tools sit inline is profile-dependent. Highlight is asserted inline
  // below; ink is asserted through the toolbar's own All-tools menu, which is
  // the real user path to reach it (and is how this spec arms it).
  expect(
    await win.locator('[data-book-tools] [data-ann-tools-visible] [data-tool="highlight"]').count(),
    'highlight tool not in the Book View toolbar',
  ).toBeGreaterThan(0);
  const inlineTools = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-book-tools] [data-ann-tools-visible] [data-tool]')).map(
      (b) => b.getAttribute('data-tool'),
    ),
  );
  await win.locator('[data-book-tools] [data-ann-dropdown-toggle]').click();
  await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'visible', timeout: 8000 });
  const inkInMenu = await win.locator('[data-ann-dropdown-menu] [data-tool="ink"]').count();
  console.log('P66_ANN tools ' + JSON.stringify({ inlineTools, inkInMenu }));
  expect(inkInMenu, 'ink tool not reachable from the Book View toolbar').toBeGreaterThan(0);
  expect(
    await win.locator('[data-action-dock]').count(),
    'an Action Dock is present while Book View is on',
  ).toBe(0);
  await win.screenshot({ path: path.join(SHOTS, 'phase66-ann-toolbar.png') });

  // -- arm ink through the Book View toolbar's All-tools menu, then drag ----
  await win.locator('[data-ann-dropdown-menu] [data-tool="ink"]').click();
  await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'detached', timeout: 8000 });
  await win.waitForTimeout(400);
  const strokeStart = await dragOnBookPage();

  const ann = await waitForAnn('ink', 1);
  console.log('P66_ANN ink ' + JSON.stringify({ ann, strokeStart, visiblePage: await win.locator('[data-book-page]').first().getAttribute('data-book-page') }));
  expect(ann.missing, `no ink annotation committed on page 1: ${JSON.stringify(ann)}`).toBeFalsy();
  await win.screenshot({ path: path.join(SHOTS, 'phase66-ann-ink.png') });
  expect(
    await overlayNode(ann.id).count(),
    `ink ${ann.id} not rendered under [data-annotation-layer="1"]`,
  ).toBeGreaterThan(0);

  // -- leave and re-enter: the annotation must still be rendered ------------
  await win.locator('[aria-label="Close book view"]').click();
  await win.waitForSelector('[data-book-view]', { state: 'detached', timeout: 10000 });
  await enterBookView();
  expect(await win.locator('[data-action-dock]').count(), 'Action Dock reappeared').toBe(0);
  const afterReenter = await overlayNode(ann.id).count();
  console.log('P66_ANN reenter ' + JSON.stringify({ id: ann.id, rendered: afterReenter }));
  expect(afterReenter, `ink ${ann.id} not rendered after leave + re-enter`).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(SHOTS, 'phase66-ann-ink-reenter.png') });
});

// ---------------------------------------------------------------------------
// Criterion 5b - highlight placed across real page text in Book View, then
// rendered again after a leave + re-enter.
// ---------------------------------------------------------------------------
test('criterion 5: highlight placed on book text, survives leave + re-enter', async () => {
  await openBookView(getSamplePath('report.pdf'));

  await win.locator('[data-book-tools] [data-ann-tools-visible] [data-tool="highlight"]').click();
  await win.waitForTimeout(300);

  const span = await win.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('[data-book-stage] .pdf-page .textLayer span'))
      .map((s) => {
        const r = s.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      })
      .filter((r) => r.w > 30 && r.h > 6 && r.y > 120 && r.y < window.innerHeight - 120);
    return spans[0] || null;
  });
  expect(span, 'no usable text span in the Book View page').not.toBeNull();
  await win.mouse.move(span.x + 2, span.y + span.h / 2);
  await win.mouse.down();
  await win.mouse.move(span.x + span.w - 2, span.y + span.h / 2 + 2, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(1200);

  const ann = await waitForAnn('highlight', 1);
  console.log('P66_ANN highlight ' + JSON.stringify({ ann, span, visiblePage: await win.locator('[data-book-page]').first().getAttribute('data-book-page') }));
  expect(ann.missing, `no highlight committed on page 1: ${JSON.stringify(ann)}`).toBeFalsy();
  await win.screenshot({ path: path.join(SHOTS, 'phase66-ann-highlight.png') });
  expect(
    await overlayNode(ann.id).count(),
    `highlight ${ann.id} not rendered under [data-annotation-layer="1"]`,
  ).toBeGreaterThan(0);

  await win.locator('[aria-label="Close book view"]').click();
  await win.waitForSelector('[data-book-view]', { state: 'detached', timeout: 10000 });
  await enterBookView();
  const afterReenter = await overlayNode(ann.id).count();
  console.log('P66_ANN highlight-reenter ' + JSON.stringify({ id: ann.id, rendered: afterReenter }));
  expect(afterReenter, `highlight ${ann.id} not rendered after leave + re-enter`).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(SHOTS, 'phase66-ann-highlight-reenter.png') });
});

// ---------------------------------------------------------------------------
// Criterion 5c - an ink stroke placed in Book View survives Save As + reopen:
// the same annotation id is in the engine state and rendered on page 1 again.
// ---------------------------------------------------------------------------
test('criterion 5: ink survives save + reopen', async () => {
  await openBookView(getSamplePath('report.pdf'));

  await armBookInk();
  await dragOnBookPage();

  const ann = await waitForAnn('ink', 1);
  console.log('P66_ANN save ink ' + JSON.stringify({ ann }));
  expect(ann.missing, `no ink annotation committed before save: ${JSON.stringify(ann)}`).toBeFalsy();

  const savePath = path.join(os.tmpdir(), `tflex-p66-ann-${Date.now()}.pdf`);
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-confirm]', { timeout: 8000 });
  await win.click('[data-save-as-confirm]');
  await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 30000 });
  expect(fs.existsSync(savePath), 'saved PDF must exist on disk').toBe(true);

  // Close Book View + the tab, then reopen the saved file and re-enter.
  if ((await win.locator('[data-book-view]').count()) > 0) {
    await win.locator('[aria-label="Close book view"]').click();
    await win.waitForSelector('[data-book-view]', { state: 'detached', timeout: 10000 });
  }
  await win.locator('.tab-active .tab-close').click();
  await win.waitForTimeout(1500);
  await openSamplePath(win, app, savePath);
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);
  await enterBookView();

  const reopened = (await engineAnnotations()).find((a) => a.id === ann.id);
  console.log('P66_ANN reopened ' + JSON.stringify({ id: ann.id, found: !!reopened, kind: reopened && reopened.kind, page: reopened && reopened.page }));
  expect(reopened, `ink ${ann.id} missing from engine state after reopen`).toBeTruthy();
  expect(
    await overlayNode(ann.id).count(),
    `ink ${ann.id} not rendered on page 1 after reopen`,
  ).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(SHOTS, 'phase66-ann-ink-reopen.png') });

  fs.rmSync(savePath, { force: true });
});

// ---------------------------------------------------------------------------
// Characterization (DEF-446) - the marking gesture commits the ink on page 1
// and, post-fix, must leave the view on page 1 with the mark rendered in the
// page-1 annotation layer immediately after the gesture. Distinct from the
// criterion tests above, this names the page-number contract explicitly, then
// still proves the annotation survives leave + re-enter.
// ---------------------------------------------------------------------------
test('criterion 5 characterization: placed ink renders on page 1 and survives re-enter', async () => {
  await openBookView(getSamplePath('report.pdf'));
  await armBookInk();
  await dragOnBookPage();
  const ann = await waitForAnn('ink', 1);
  expect(ann.missing, `no ink committed: ${JSON.stringify(ann)}`).toBeFalsy();

  // Post-fix contract (DEF-446): the placement gesture commits the ink on page 1
  // and must NOT fire the page-turn handler - the view stays on page 1 with the
  // mark rendered in the page-1 annotation layer. No navigation-back click.
  const pageAfterGesture = await win.locator('[data-book-page]').first().getAttribute('data-book-page');
  const onPage1 = await overlayNode(ann.id).count();
  console.log('P66_ANN characterization ' + JSON.stringify({ id: ann.id, pageAfterGesture, onPage1 }));
  expect(pageAfterGesture, 'placement gesture turned the page (DEF-446 regressed)').toBe('1');
  expect(onPage1, `ink ${ann.id} not rendered on page 1`).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(SHOTS, 'phase66-ann-ink-page1.png') });

  await win.locator('[aria-label="Close book view"]').click();
  await win.waitForSelector('[data-book-view]', { state: 'detached', timeout: 10000 });
  await enterBookView();
  const afterReenter = await overlayNode(ann.id).count();
  console.log('P66_ANN characterization-reenter ' + JSON.stringify({ id: ann.id, rendered: afterReenter }));
  expect(afterReenter, `ink ${ann.id} not rendered after leave + re-enter`).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(SHOTS, 'phase66-ann-ink-reenter.png') });
});
