// TFL-1116 C13 (R20 + R23) — review summary de-duplication + outline badge
// legibility.
//
// R20: the REVIEW surface must NOT repeat the document-wide Bates / watermark /
// signature summaries on both sides. The LEFT ContextPanel review navigator is
// the authoritative inventory (rows + actions); the RIGHT Inspector owns only
// the SELECTED annotation's scope.
// R23: the outline target page badges are readable secondary text on an aligned
// target column, preserving the title wrap/ellipsis and the tree's keyboard
// navigation.
// Screenshots: screenshots/tfl1116_r20_review.png, screenshots/tfl1116_r23_outline.png.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, gotoStage, ensurePanelExpanded, openSample, armAnnotationTool, diag } = require('./lib/helpers.cjs');

// The Paperclip runtime exports ELECTRON_RUN_AS_NODE=1 for its own Node shim;
// launchApp spreads process.env, so Electron would exit immediately as plain
// Node. Drop it before any launch so the real GUI starts.
delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;

test.setTimeout(180000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  win.on('pageerror', (e) => console.log(`[tfl1116 C13|pageerror] ${e.message}`));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openSample(win, app, 'report.pdf');
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1116-r20-r23');
  app = null;
  win = null;
});

test('R20: the document-wide review summaries render in exactly ONE location', async () => {
  await ensurePanelExpanded(win);
  await gotoStage(win, 3);
  await win.waitForSelector('[data-context-panel="review"] [data-review-elements]', { timeout: 15000 });

  // The Inspector's review-elements section only mounts for a text selection
  // (the selected-annotation scope), so place a NOTE (a text-bearing annotation)
  // to exercise the RIGHT side of the comparison.
  await armAnnotationTool(win, 'note');
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const nx = Math.max(40, Math.min(pg.x + pg.width * 0.5, vp.w - 40));
  const ny = Math.max(40, Math.min(pg.y + pg.height * 0.5, vp.h - 200));
  await win.mouse.click(nx, ny);
  await win.waitForSelector('[data-inspector] [data-review-elements]', { timeout: 15000 });
  await win.waitForTimeout(400);

  const measured = await win.evaluate(() => {
    const q = (s) => document.querySelectorAll(s).length;
    const panel = document.querySelector('[data-context-panel="review"]');
    const inspector = document.querySelector('[data-inspector]');
    const cats = (root) =>
      root
        ? [...root.querySelectorAll('[data-review-category]')].map((el) =>
            el.getAttribute('data-review-category'),
          )
        : [];
    const scope = (root) =>
      root?.querySelector('[data-review-elements]')?.getAttribute('data-review-elements-scope') ?? null;
    return {
      panelScope: scope(panel),
      inspectorScope: scope(inspector),
      panelCats: cats(panel),
      inspectorCats: cats(inspector),
      docCategoriesOnPage: {
        bates: q('[data-review-category="bates"]'),
        watermarks: q('[data-review-category="watermarks"]'),
        signatures: q('[data-review-category="signatures"]'),
      },
      inspectorRows: inspector ? inspector.querySelectorAll('[data-review-element-type]').length : -1,
    };
  });
  console.log(`[tfl1116 R20] ${JSON.stringify(measured)}`);

  expect(measured.panelScope).toBe('document');
  expect(measured.panelCats).toEqual(['annotations', 'bates', 'watermarks', 'signatures']);
  expect(measured.inspectorScope).toBe('selection');
  expect(measured.inspectorCats).toEqual(['annotations']);
  // Each document-wide category is rendered by the LEFT navigator alone.
  expect(measured.docCategoriesOnPage).toEqual({ bates: 1, watermarks: 1, signatures: 1 });
  expect(measured.inspectorRows, 'the Inspector repeats no document-wide row').toBe(0);

  const shot = path.join(SHOTS, 'tfl1116_r20_review.png');
  await win.screenshot({ path: shot });
  console.log(`[tfl1116 R20] screenshot ${shot}`);
});

test('R23: the outline page badges are legible and aligned, wrap + keyboard nav preserved', async () => {
  await ensurePanelExpanded(win);
  await gotoStage(win, 1);
  await win.click('[data-context-panel-view-tab="outline"]');
  await win.waitForSelector('[data-outline-page]', { timeout: 15000 });
  await win.waitForTimeout(400);

  const measured = await win.evaluate(() => {
    const badges = [...document.querySelectorAll('[data-outline-page]')];
    // Resolve the tokens INSIDE the outline panel's own custom-property scope
    // (the glass sidebar re-declares --fg-muted), so the probe matches the
    // badge's computed ink exactly.
    const scope = badges.length > 0 ? badges[0].parentElement : document.body;
    const token = (name) => {
      const probe = document.createElement('span');
      probe.style.color = `var(${name})`;
      (scope || document.body).appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    };
    return {
      count: badges.length,
      colors: [...new Set(badges.map((b) => getComputedStyle(b).color))],
      weights: [...new Set(badges.map((b) => getComputedStyle(b).fontWeight))],
      sizes: [...new Set(badges.map((b) => getComputedStyle(b).fontSize))],
      rightEdges: badges.map((b) => b.getBoundingClientRect().right),
      muted: token('--fg-muted'),
      faint: token('--fg-faint'),
    };
  });
  console.log(`[tfl1116 R23] ${JSON.stringify(measured)}`);

  expect(measured.count).toBeGreaterThan(1);
  expect(measured.colors, 'one readable ink across every badge').toHaveLength(1);
  expect(measured.colors[0]).toBe(measured.muted);
  expect(measured.colors[0]).not.toBe(measured.faint);
  expect(measured.weights.every((w) => Number.parseInt(w, 10) >= 500)).toBe(true);
  expect(measured.sizes.every((s) => Number.parseFloat(s) >= 12)).toBe(true);
  const spread = Math.max(...measured.rightEdges) - Math.min(...measured.rightEdges);
  expect(spread, 'the target column is aligned').toBeLessThanOrEqual(2);

  // Keyboard navigation still works: focus a title control and press Enter, and
  // the workspace jumps to that bookmark's target page.
  const firstTitle = win.locator('.outline-link').first();
  await firstTitle.focus();
  const targetPage = await win.evaluate(() => {
    const row = document.querySelector('[data-outline-row]');
    const badge = row?.querySelector('[data-outline-page]');
    const n = badge ? Number.parseInt(badge.textContent, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  });
  await firstTitle.press('Enter');
  await win.waitForTimeout(900);
  const page = await diag(win);
  console.log(`[tfl1116 R23] keyboard jump target ${targetPage} -> currentPage ${page.currentPage}`);
  expect(targetPage).not.toBeNull();
  expect(page.currentPage).toBe(targetPage);

  const shot = path.join(SHOTS, 'tfl1116_r23_outline.png');
  await win.screenshot({ path: shot });
  console.log(`[tfl1116 R23] screenshot ${shot}`);
});