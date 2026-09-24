// Phase 32 — Multi Mode e2e (spec 1 of 4).
//
// Covers success criteria 1 and 2: the mode round-trip through BOTH entry
// points (CommandBar icon + All tools entry, states agree, clean return to
// the single-pane layout), the two-pane layout with two different documents,
// the per-pane headers (name + page count), the focus affordance, pane B's
// empty state + pick list (excluding the other pane's document),
// [data-pane-open] opening a PDF straight into a pane, the amended
// assignment semantics (a generic open lands in the FOCUSED pane, replacing
// its document; the previous document stays a tab), and the same-file
// refusal.
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, toggleMultiModeViaPalette } = require('./lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..', 'test-fixtures');
const ALPHA_SRC = path.join(FIX, 'report.pdf'); // 34 pages
const BETA_SRC = path.join(FIX, 'long.pdf'); // 520 pages
const TMP = path.join(os.tmpdir(), 'tflex-p32');

let electronApp = null;
let win = null;
// The exact on-disk paths the two-pane setup opened, so the DEF-278 guard
// (which compares file PATHS) can be exercised with the SAME file.
let alphaPath = null;
let betaPath = null;

function tmpCopy(src, name) {
  fs.mkdirSync(TMP, { recursive: true });
  const dst = path.join(TMP, `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  fs.copyFileSync(src, dst);
  return dst;
}

async function mockOpen(p) {
  await electronApp.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
}

// Open a PDF through the real title-bar Open control with a mocked OS dialog.
async function openFile(p) {
  await mockOpen(p);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(900);
}

async function waitTabCount(n) {
  await expect(win.locator('.tab[data-tab-id]')).toHaveCount(n, { timeout: 30000 });
}

function headerLoc(pane) {
  return win.locator(`[data-pane="${pane}"] [data-pane-header]`);
}

// Phase 33 — the shared rail is retired in favour of one strip per pane.
// DEF-291 — the Multi Mode strip is HEADERLESS, so the focused pane's accent
// tint now rides its own [data-pane-header] row above the workspace. Resolve
// the --accent-selected token and read the pane header's COMPUTED background,
// keeping the visual active-affordance assertion that follows focus.
async function paneActive(pane) {
  return win.evaluate((p) => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = 'var(--accent-selected)';
    document.body.appendChild(probe);
    const accent = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const h = document.querySelector(`.tab-pane[data-pane="${p}"] [data-pane-header]`);
    if (!h) return null;
    return getComputedStyle(h).backgroundColor === accent;
  }, pane);
}

async function paneHeader(pane) {
  const raw = await headerLoc(pane).innerText();
  const text = raw.replace(/\s+/g, ' ').trim();
  const m = text.match(/(\d+)\s+pages?/);
  return { text, pageCount: m ? Number(m[1]) : null };
}

// Focus a pane through its PAGE AREA. The pane HEADER is the other documented
// focus path, but the Phase 33 shared toolbar currently overlays it (DEF-282);
// that path is asserted by phase33_multi_toolbar.spec.cjs.
async function focusPaneByPage(pane) {
  const page = win.locator(`.tab-pane[data-pane="${pane}"] .pdf-page`).first();
  await page.scrollIntoViewIfNeeded().catch(() => {});
  const box = await page.boundingBox();
  if (box === null) throw new Error(`focusPaneByPage: no page in pane ${pane}`);
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(30, Math.min(box.x + box.width / 2, vp.w - 30));
  const y = Math.max(70, Math.min(box.y + box.height / 2, vp.h - 30));
  await win.mouse.click(x, y);
  await win.waitForTimeout(350);
}

// Two different documents, both panes filled (alpha in A, beta in B).
//
// Amended Phase 32 semantics: a title-bar Open while the mode is on ASSIGNS
// the document to the FOCUSED pane, so the second document is opened in
// single mode first, alpha is made active, and only then is the mode turned
// on (pane A = alpha) and beta picked into pane B.
async function twoPaneSetup() {
  alphaPath = tmpCopy(ALPHA_SRC, 'p32-alpha.pdf');
  betaPath = tmpCopy(BETA_SRC, 'p32-beta.pdf');
  await openFile(alphaPath);
  await waitTabCount(1);
  await openFile(betaPath);
  await waitTabCount(2);
  await win.locator('.tab[data-tab-id]').filter({ hasText: 'p32-alpha' }).first().click();
  await win.waitForTimeout(300);
  // Phase 36 (chunk 3) — the CommandBar row is retired in single mode; the
  // Multi Mode toggle now lives in the All-tools palette.
  await toggleMultiModeViaPalette(win);
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]')).toBeVisible({ timeout: 15000 });
  await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'p32-beta' }).first().click();
  await win.waitForTimeout(1200);
  await expect(win.locator('.tab-pane[data-pane="B"] canvas.pdf-page-canvas').first()).toBeVisible({ timeout: 30000 });
}

test.beforeEach(async () => {
  electronApp = await launchApp();
  win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null;
  win = null;
});
test.setTimeout(180000);

test('C1 mode round-trip: the title-bar toggle and the shared toolbar agree, off returns to single-pane', async () => {
  await openFile(tmpCopy(ALPHA_SRC, 'p32-alpha.pdf'));
  await waitTabCount(1);
  const stage = win.locator('.tab-stage');

  expect(await stage.getAttribute('data-multi-mode')).toBe('false');
  expect(await win.locator('[data-pane]').count()).toBe(0);
  // Phase 36 (chunk 3): the per-view CommandBar ROW is retired in single mode,
  // so no inline toggle remains; the All-tools palette entry is the single-mode
  // home (the title-bar control arrives in a later chunk).
  expect(await win.locator('[data-toolbar-multi-mode]').count()).toBe(0);

  // --- ON via the title-bar toggle (the single-mode home) ---
  const headerToggle = win.locator('[data-header-multi-mode]');
  expect(await headerToggle.getAttribute('aria-pressed')).toBe('false');
  await headerToggle.click();
  await win.waitForTimeout(500);
  expect(await stage.getAttribute('data-multi-mode')).toBe('true');
  expect(await win.locator('.tab-pane[data-pane="A"]').count()).toBe(1);
  expect(await win.locator('.tab-pane[data-pane="B"]').count()).toBe(1);
  const cmdPressed = await win.locator('[data-shared-toolbar] [data-toolbar-multi-mode]').first().getAttribute('aria-pressed');
  console.log(`[P32] after title-bar ON: stage=${await stage.getAttribute('data-multi-mode')} cmdPressed=${cmdPressed} panes=${await win.locator('[data-pane]').count()} multiPanes=${await stage.getAttribute('data-multi-panes')}`);
  expect(cmdPressed).toBe('true');
  // The title-bar toggle agrees.
  expect(await headerToggle.getAttribute('aria-pressed')).toBe('true');

  // --- OFF via the title-bar toggle ---
  await headerToggle.click();
  await win.waitForTimeout(500);
  console.log(`[P32] after title-bar OFF: stage=${await stage.getAttribute('data-multi-mode')} panes=${await win.locator('[data-pane]').count()}`);
  expect(await stage.getAttribute('data-multi-mode')).toBe('false');
  expect(await win.locator('[data-pane]').count()).toBe(0);
  expect(await win.locator('[data-pane-header]').count()).toBe(0);
  expect(await win.locator('[data-multi-divider]').count()).toBe(0);
  expect(await headerToggle.getAttribute('aria-pressed')).toBe('false');
  expect(await win.locator('[data-shared-toolbar]').count(), 'no shared toolbar in single mode').toBe(0);

  // --- ON again via the title bar, OFF via the shared toolbar (the reverse pair) ---
  await headerToggle.click();
  await win.waitForTimeout(500);
  expect(await stage.getAttribute('data-multi-mode')).toBe('true');
  expect(await headerToggle.getAttribute('aria-pressed')).toBe('true');
  await win.locator('[data-shared-toolbar] [data-toolbar-multi-mode]').first().click();
  await win.waitForTimeout(500);
  expect(await stage.getAttribute('data-multi-mode')).toBe('false');
  expect(await win.locator('[data-pane]').count()).toBe(0);
});

test('C2 two-pane layout with two different documents, headers, rail sections', async () => {
  await twoPaneSetup();
  const stage = win.locator('.tab-stage');
  expect(await stage.getAttribute('data-multi-mode')).toBe('true');
  expect(await stage.getAttribute('data-multi-panes')).toBe('2');

  const a = await paneHeader('A');
  const b = await paneHeader('B');
  console.log(`[P32] headerA="${a.text}" (${a.pageCount}p) headerB="${b.text}" (${b.pageCount}p)`);
  expect(a.text).toContain('p32-alpha');
  expect(b.text).toContain('p32-beta');
  expect(a.pageCount).toBe(34);
  expect(b.pageCount).toBe(520);

  // Both panes show a real page canvas (interactive), not a placeholder.
  await expect(win.locator('.tab-pane[data-pane="A"] canvas.pdf-page-canvas').first()).toBeVisible();
  await expect(win.locator('.tab-pane[data-pane="B"] canvas.pdf-page-canvas').first()).toBeVisible();

  // Phase 33 — each pane owns its OWN thumbnail strip (the Phase-32 shared
  // rail is retired). One labelled strip per loaded document, each showing
  // its own pane's document.
  const strips = win.locator('[data-pane-strip]');
  expect(await strips.count()).toBe(2);
  const labels = [];
  const counts = [];
  const stripDocs = [];
  for (const pane of ['A', 'B']) {
    const strip = win.locator(`[data-pane-strip-pane="${pane}"]`);
    // DEF-291 — the strip is headerless; its aria-label names its pane and
    // document ("Pane A thumbnails: <title>"), which is the strip's identity.
    labels.push(((await strip.getAttribute('aria-label')) || '').replace(/\s+/g, ' ').trim());
    counts.push(await strip.locator('.thumb-item').count());
    stripDocs.push(await strip.getAttribute('data-pane-strip-doc'));
  }
  console.log(`[P32] pane strips: A="${labels[0]}" B="${labels[1]}" thumbItems(A,B)=${counts[0]},${counts[1]} docs=${JSON.stringify(stripDocs)}`);
  expect(labels[0], 'strip A names its pane and document').toContain('p32-alpha');
  expect(labels[0], 'strip A names its pane').toContain('Pane A');
  expect(labels[1], 'strip B names its pane and document').toContain('p32-beta');
  expect(labels[1], 'strip B names its pane').toContain('Pane B');
  // The page counts the retired strip header used to carry are asserted on the
  // pane header above each strip (a.pageCount=34, b.pageCount=520 at the top of
  // this test); the strip proves it shows that document via its own thumbnails.
  // Each strip lives inside its own pane and names a distinct document.
  expect(stripDocs[0]).not.toBe(stripDocs[1]);
  expect(await win.locator('.tab-pane[data-pane="A"] [data-pane-strip]').count()).toBe(1);
  expect(await win.locator('.tab-pane[data-pane="B"] [data-pane-strip]').count()).toBe(1);
  expect(counts[0]).toBeGreaterThan(0);
  expect(counts[1]).toBeGreaterThan(0);
  // Two documents -> thumbnails shrink below the single-mode 126px.
  const thumbW = await win.evaluate(() => {
    const wrap = document.querySelector('[data-pane-strip-pane="A"] .thumb-canvas-wrap');
    const canvas = document.querySelector('[data-pane-strip-pane="A"] canvas.thumb-canvas');
    return {
      wrap: wrap ? Math.round(wrap.getBoundingClientRect().width) : null,
      canvas: canvas ? Math.round(canvas.getBoundingClientRect().width) : null,
    };
  });
  console.log(`[P32] dual-mode thumb wrap/canvas width = ${JSON.stringify(thumbW)} (single-mode is 126px)`);
  expect(thumbW.wrap).not.toBeNull();
  expect(thumbW.wrap).toBeLessThan(126);
  expect(thumbW.wrap).toBeGreaterThanOrEqual(84);

  // A thumbnail click navigates that pane's document (strip onJump wiring).
  const secBPage3 = win.locator('[data-pane-strip-pane="B"] .thumb-item[data-page="3"]');
  if ((await secBPage3.count()) > 0) {
    await secBPage3.first().scrollIntoViewIfNeeded();
    await secBPage3.first().click();
    await win.waitForTimeout(700);
    const cur = await win.evaluate(() => window.tflexDiagnostics().currentPage);
    console.log(`[P32] after clicking B rail page 3: diagnostics currentPage=${cur}`);
    expect(cur).toBe(3);
  } else {
    console.log('[P32] B rail page-3 thumb not mounted (virtualization) - skipping jump assertion');
  }
});

test('C3 focus affordance moves on a pane click (and rail active follows)', async () => {
  await twoPaneSetup();
  // Assigning pane B's document focused it, so B starts focused.
  expect(await win.locator('.tab-pane[data-pane="B"]').getAttribute('data-pane-focused')).toBe('true');
  expect(await win.locator('.tab-pane[data-pane="A"]').getAttribute('data-pane-focused')).toBe('false');

  // Click the header's TITLE (a pane-header click via the pane's pointerdown
  // capture), not the header container: the container's centre can land on the
  // [data-pane-clear] button at some window widths, which would empty the pane.
  await win.locator('.multi-pane-header[data-pane="A"] .multi-pane-title').click();
  await win.waitForTimeout(400);
  console.log(`[P32] after pane A click: A=${await win.locator('.tab-pane[data-pane="A"]').getAttribute('data-pane-focused')} B=${await win.locator('.tab-pane[data-pane="B"]').getAttribute('data-pane-focused')}`);
  expect(await win.locator('.tab-pane[data-pane="A"]').getAttribute('data-pane-focused')).toBe('true');
  expect(await win.locator('.tab-pane[data-pane="B"]').getAttribute('data-pane-focused')).toBe('false');
  expect(await paneActive('A')).toBe(true);
  expect(await paneActive('B')).toBe(false);
  const activeIsAlpha = await win.evaluate(() => window.tflexDiagnostics().pageCount);
  console.log(`[P32] focused pane A -> diagnostics active doc pageCount=${activeIsAlpha}`);
  expect(activeIsAlpha).toBe(34);

  // Click the header's TITLE, not the header container: the container's centre
  // sits close to the [data-pane-clear] button (a destructive control), so a
  // container-centre click can empty the pane on some window widths. The title
  // is still a pane-header click (the pane's pointerdown capture focuses it).
  await win.locator('.multi-pane-header[data-pane="B"] .multi-pane-title').click();
  await win.waitForTimeout(400);
  console.log(`[P32] after pane B click: A=${await win.locator('.tab-pane[data-pane="A"]').getAttribute('data-pane-focused')} B=${await win.locator('.tab-pane[data-pane="B"]').getAttribute('data-pane-focused')}`);
  expect(await win.locator('.tab-pane[data-pane="B"]').getAttribute('data-pane-focused')).toBe('true');
  expect(await paneActive('B')).toBe(true);
  const activeIsBeta = await win.evaluate(() => window.tflexDiagnostics().pageCount);
  console.log(`[P32] focused pane B -> diagnostics active doc pageCount=${activeIsBeta}`);
  expect(activeIsBeta).toBe(520);
});

test('C4 pane B empty state + pick list excludes the other pane document', async () => {
  await openFile(tmpCopy(ALPHA_SRC, 'p32-alpha.pdf'));
  await waitTabCount(1);
  await openFile(tmpCopy(BETA_SRC, 'p32-beta.pdf'));
  await waitTabCount(2);
  // Amended semantics: make alpha active BEFORE enabling the mode so pane A
  // holds alpha and beta stays an open tab the pick list can offer.
  await win.locator('.tab[data-tab-id]').filter({ hasText: 'p32-alpha' }).first().click();
  await win.waitForTimeout(300);
  // Phase 36 (chunk 3) — the CommandBar row is retired in single mode; the
  // Multi Mode toggle now lives in the All-tools palette.
  await toggleMultiModeViaPalette(win);

  const empty = win.locator('.tab-pane[data-pane="B"][data-pane-empty]');
  await expect(empty).toBeVisible({ timeout: 15000 });
  expect(await win.locator('.tab-pane[data-pane="B"] [data-pane-open]').count()).toBe(1);
  const picks = win.locator('.tab-pane[data-pane="B"] [data-pane-pick]');
  const titles = await picks.allInnerTexts();
  console.log(`[P32] pane B pick list (${await picks.count()}): ${JSON.stringify(titles)}`);
  expect(await picks.filter({ hasText: 'p32-alpha' }).count()).toBe(0);
  expect(await picks.filter({ hasText: 'p32-beta' }).count()).toBe(1);

  // Picking fills the pane.
  await picks.filter({ hasText: 'p32-beta' }).first().click();
  await win.waitForTimeout(1200);
  expect(await win.locator('.tab-pane[data-pane="B"][data-pane-empty]').count()).toBe(0);
  await expect(headerLoc('B')).toBeVisible({ timeout: 15000 });
  const b = await paneHeader('B');
  console.log(`[P32] pane B after pick: "${b.text}"`);
  expect(b.text).toContain('p32-beta');
});

test('C5 [data-pane-open] opens a PDF directly into the empty pane', async () => {
  await openFile(tmpCopy(ALPHA_SRC, 'p32-alpha.pdf'));
  await waitTabCount(1);
  // Phase 36 (chunk 3) — the single-mode Multi Mode toggle is in the palette.
  await toggleMultiModeViaPalette(win);
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]')).toBeVisible({ timeout: 15000 });

  await mockOpen(tmpCopy(BETA_SRC, 'p32-beta.pdf'));
  await win.locator('.tab-pane[data-pane="B"] [data-pane-open]').click();
  // Phase 34 — Multi Mode shows ONE composite tab. The observable effect of
  // the open is pane B filling; assert that and the single composite tab.
  await expect(win.locator('.tab-pane[data-pane="B"] canvas.pdf-page-canvas').first()).toBeVisible({ timeout: 30000 });
  await win.waitForTimeout(1200);
  expect(await win.locator('.tab[data-tab-id]').count()).toBe(1);

  expect(await win.locator('.tab-pane[data-pane="B"][data-pane-empty]').count()).toBe(0);
  await expect(headerLoc('B')).toBeVisible({ timeout: 15000 });
  const b = await paneHeader('B');
  console.log(`[P32] pane B after data-pane-open: "${b.text}" tabs=${await win.locator('.tab[data-tab-id]').count()}`);
  expect(b.text).toContain('p32-beta');
  expect(b.pageCount).toBe(520);
  await expect(win.locator('.tab-pane[data-pane="B"] canvas.pdf-page-canvas').first()).toBeVisible({ timeout: 30000 });
});

test('C2b opening a document while Multi Mode is on assigns it to the focused pane (DEF-277)', async () => {
  await twoPaneSetup(); // A=p32-alpha (34), B=p32-beta (520), focused B
  const stage = win.locator('.tab-stage');
  const tabsBefore = await win.locator('.tab[data-tab-id]').count();
  // Phase 34 — Multi Mode collapses the strip to ONE composite tab.
  expect(tabsBefore).toBe(1);

  // --- Case 1: focused pane A ---
  await focusPaneByPage('A');
  expect(await win.locator('.tab-pane[data-pane="A"]').getAttribute('data-pane-focused')).toBe('true');

  await openFile(tmpCopy(ALPHA_SRC, 'p32-gamma.pdf')); // 34 pages
  // The composite tab stays ONE; the observable effect is pane A's header.
  await expect(headerLoc('A')).toContainText('p32-gamma', { timeout: 30000 });
  await win.waitForTimeout(800);

  const a1 = await paneHeader('A');
  const b1 = await paneHeader('B');
  const titles1 = await win.locator('.tab[data-tab-id] .tab-title').allInnerTexts();
  console.log(`[P32] DEF-277 focus A: headerA="${a1.text}" (${a1.pageCount}p) headerB="${b1.text}" (${b1.pageCount}p) tabs=${JSON.stringify(titles1)}`);
  // The focused pane's document CHANGED to the newly opened file.
  expect(a1.text).toContain('p32-gamma');
  expect(a1.pageCount).toBe(34);
  // The other pane is untouched.
  expect(b1.text).toContain('p32-beta');
  expect(b1.pageCount).toBe(520);
  // The composite label names the two PANE documents (gamma + beta). The
  // replaced document (alpha) stays OPEN in the session — asserted after the
  // mode is switched off at the end of this test.
  expect(titles1.length).toBe(1);
  expect(titles1[0]).toContain('p32-gamma');
  expect(titles1[0]).toContain('p32-beta');
  // No hidden-tab-with-no-effect: the new document is visible in a pane.
  await expect(win.locator('.tab-pane[data-pane="A"] canvas.pdf-page-canvas').first()).toBeVisible();
  // No third pane.
  expect(await stage.getAttribute('data-multi-panes')).toBe('2');
  expect(await win.locator('.tab-pane[data-pane]').count()).toBe(2);

  // --- Case 2: focused pane B (the assignment must follow focus) ---
  await focusPaneByPage('B');
  expect(await win.locator('.tab-pane[data-pane="B"]').getAttribute('data-pane-focused')).toBe('true');

  await openFile(tmpCopy(BETA_SRC, 'p32-delta.pdf')); // 520 pages
  await expect(headerLoc('B')).toContainText('p32-delta', { timeout: 30000 });
  await win.waitForTimeout(800);

  const a2 = await paneHeader('A');
  const b2 = await paneHeader('B');
  const titles2 = await win.locator('.tab[data-tab-id] .tab-title').allInnerTexts();
  console.log(`[P32] DEF-277 focus B: headerA="${a2.text}" (${a2.pageCount}p) headerB="${b2.text}" (${b2.pageCount}p) tabs=${JSON.stringify(titles2)}`);
  expect(b2.text).toContain('p32-delta');
  expect(b2.pageCount).toBe(520);
  expect(a2.text).toContain('p32-gamma');
  expect(a2.pageCount).toBe(34);
  // The composite label now names gamma + delta; beta stays open (asserted
  // after the mode is switched off below).
  expect(titles2.length).toBe(1);
  expect(titles2[0]).toContain('p32-gamma');
  expect(titles2[0]).toContain('p32-delta');
  await expect(win.locator('.tab-pane[data-pane="B"] canvas.pdf-page-canvas').first()).toBeVisible();
  expect(await stage.getAttribute('data-multi-panes')).toBe('2');

  // --- Single mode is unchanged: the open lands as a normal active tab ---
  await win.locator('[data-shared-toolbar] [data-toolbar-multi-mode]').first().click();
  await win.waitForTimeout(500);
  expect(await stage.getAttribute('data-multi-mode')).toBe('false');
  // Switching the mode off restores the individual tabs. The two documents
  // that were REPLACED in the panes (alpha, beta) are still open — the DEF-277
  // "previous document stays open" contract holds under the composite tab.
  const restoredTitles = await win.locator('.tab[data-tab-id] .tab-title').allInnerTexts();
  console.log(`[P32] DEF-277 after mode OFF, individual tabs=${JSON.stringify(restoredTitles)}`);
  expect(restoredTitles.some((t) => t.includes('p32-alpha'))).toBe(true);
  expect(restoredTitles.some((t) => t.includes('p32-beta'))).toBe(true);
  const tabsBeforeSingle = await win.locator('.tab[data-tab-id]').count();
  await openFile(tmpCopy(ALPHA_SRC, 'p32-epsilon.pdf'));
  await waitTabCount(tabsBeforeSingle + 1);
  await win.waitForTimeout(500);
  const activeTitle = await win.locator('.tab[data-tab-id][aria-selected="true"] .tab-title').innerText();
  console.log(`[P32] single-mode open: tabs ${tabsBeforeSingle}->${await win.locator('.tab[data-tab-id]').count()} active="${activeTitle}"`);
  expect(activeTitle).toContain('p32-epsilon');
});

test('C2c the same file cannot be assigned to the other pane (DEF-278)', async () => {
  await twoPaneSetup(); // A=p32-alpha, B=p32-beta
  // Clear pane B so its empty-state Open action is reachable.
  await win.locator('.tab-pane[data-pane="B"] [data-pane-clear]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]')).toBeVisible({ timeout: 10000 });
  const tabsBefore = await win.locator('.tab[data-tab-id]').count();
  // Phase 34 — one composite tab while the mode is on.
  expect(tabsBefore).toBe(1);

  // Pick the SAME file pane A shows (same on-disk path).
  await mockOpen(alphaPath);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-open]').click();
  await win.waitForTimeout(1400);

  const toasts = await win.locator('.toast-text').allInnerTexts();
  const tabsAfter = await win.locator('.tab[data-tab-id]').count();
  const bEmpty = await win.locator('.tab-pane[data-pane="B"][data-pane-empty]').count();
  console.log(`[P32] DEF-278 same-file-into-pane-B: toasts=${JSON.stringify(toasts)} tabs ${tabsBefore}->${tabsAfter} paneBEmpty=${bEmpty}`);
  // A user-visible message appears.
  expect(toasts.some((t) => t.includes('already shown in the other pane'))).toBe(true);
  // Pane B is NOT assigned.
  expect(bEmpty).toBe(1);
  // No stray tab.
  expect(tabsAfter).toBe(tabsBefore);

  // The guard is reachable from the pick list too: the other pane's document
  // cannot be picked.
  const picks = win.locator('.tab-pane[data-pane="B"] [data-pane-pick]');
  const titles = await picks.allInnerTexts();
  console.log(`[P32] DEF-278 pane B pick list (${await picks.count()}): ${JSON.stringify(titles)}`);
  expect(await picks.filter({ hasText: 'p32-alpha' }).count()).toBe(0);
});

test('C6 each pane keeps its own page position and zoom', async () => {
  await twoPaneSetup(); // A=alpha (34), B=beta (520)
  // Phase 33 — Multi Mode has ONE shared toolbar whose page/zoom readout
  // reflects the FOCUSED pane, so read it after focusing each pane. Focus
  // through the page area (the header is currently overlaid by the shared
  // toolbar - DEF-282).
  const sharedPageInput = () => win.locator('[data-shared-toolbar] .page-input');
  const sharedZoomText = () => win.locator('[data-shared-toolbar] .zoom-percent');
  // The readout is rounded to whole percent, so a fit scale just under the 0.8
  // ladder step can round to the SAME "80%" string as the 0.8 step. Assert the
  // zoom change from the pane's own page geometry instead, which is exact.
  const pageWidth = (pane) =>
    win.evaluate((p) => {
      const el = document.querySelector(`.tab-pane[data-pane="${p}"] .page-slot[data-page="1"]`);
      return el ? Math.round(el.getBoundingClientRect().width) : null;
    }, pane);

  await focusPaneByPage('A');
  const zoomA0 = (await sharedZoomText().innerText()).trim();
  const wA0 = await pageWidth('A');
  await focusPaneByPage('B');
  const zoomB0 = (await sharedZoomText().innerText()).trim();
  const wB0 = await pageWidth('B');

  // Zoom in with pane A focused changes only pane A's zoom.
  await focusPaneByPage('A');
  await win.locator('[data-shared-toolbar] [aria-label="Zoom in"]').click();
  await win.waitForTimeout(700);
  const zoomA1 = (await sharedZoomText().innerText()).trim();
  const wA1 = await pageWidth('A');
  await focusPaneByPage('B');
  const zoomB1 = (await sharedZoomText().innerText()).trim();
  const wB1 = await pageWidth('B');
  console.log(`[P32] zoom: A ${zoomA0}->${zoomA1} (page ${wA0}->${wA1}px), B ${zoomB0}->${zoomB1} (page ${wB0}->${wB1}px)`);
  // Pane A's page grew = the zoom changed in the expected direction, even when
  // the rounded readout shows the same "80%" on both sides of the step.
  expect(wA1, 'zoom-in with pane A focused enlarged pane A').toBeGreaterThan(wA0 + 1);
  expect(parseFloat(zoomA1), 'pane A readout did not fall').toBeGreaterThanOrEqual(parseFloat(zoomA0));
  // Pane B is untouched: its geometry and its readout are both unchanged.
  expect(wB1, 'pane B page width unchanged').toBe(wB0);
  expect(zoomB1).toBe(zoomB0);

  // Navigating pane A via its own strip thumbnail moves only pane A. The strip
  // click focuses pane A (jumpAndFocus), so read the shared readout directly
  // after it settles — an extra focus click can perturb the scroll heuristic.
  const thumbA5 = win.locator('[data-pane-strip-pane="A"] .thumb-item[data-page="5"]');
  await thumbA5.first().scrollIntoViewIfNeeded();
  await thumbA5.first().click();
  await win.waitForTimeout(1600);
  const aPage = await sharedPageInput().inputValue();
  await focusPaneByPage('B');
  const bPage = await sharedPageInput().inputValue();
  console.log(`[P32] page inputs after A strip -> page 5: A=${aPage} B=${bPage}`);
  expect(Number(aPage)).toBe(5);
  expect(Number(bPage)).toBe(1);

  // Each pane keeps its own scroll position: scrolling pane A leaves pane B
  // exactly where it was.
  const scrollerA = win.locator('.tab-pane[data-pane="A"] .document-scroller');
  const scrollerB = win.locator('.tab-pane[data-pane="B"] .document-scroller');
  const scrollA0 = await scrollerA.evaluate((el) => el.scrollTop);
  const scrollB0 = await scrollerB.evaluate((el) => el.scrollTop);
  const boxA = await scrollerA.boundingBox();
  await win.mouse.move(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2);
  await win.mouse.wheel(0, 700);
  await win.waitForTimeout(700);
  const scrollA1 = await scrollerA.evaluate((el) => el.scrollTop);
  const scrollB1 = await scrollerB.evaluate((el) => el.scrollTop);
  console.log(`[P32] scroll: A ${scrollA0}->${scrollA1}, B ${scrollB0}->${scrollB1}`);
  expect(scrollA1).toBeGreaterThan(scrollA0);
  expect(scrollB1).toBe(scrollB0);

  // No path creates a third pane.
  expect(await win.locator('.tab-pane[data-pane]').count()).toBe(2);
  expect(await win.locator('.tab-stage').getAttribute('data-multi-panes')).toBe('2');
});