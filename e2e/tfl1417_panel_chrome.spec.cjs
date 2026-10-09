// Phase 124 / TFL-1417 — renderer panel chrome.
//
// The PAGES ContextPanel header retired its labelled "More" overflow button and
// popover; the three tools it hid now render as direct, individually reachable
// icon buttons (`[data-context-panel-layout-split]`, `[data-context-panel-combine]`,
// `[data-blank-scan-open]`). Both side panels expose ONE collapse control whose
// chevron flips with the panel state (left: expanded ChevronLeft / collapsed
// ChevronRight; right Inspector: expanded ChevronRight / collapsed ChevronLeft),
// while the frozen hooks and aria-expanded stay put.
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

// The Paperclip harness exports ELECTRON_RUN_AS_NODE=1; launchApp spreads
// process.env into the Electron child, which then exits as plain Node before any
// window is observable. Drop it before any launch.
delete process.env.ELECTRON_RUN_AS_NODE;

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const PANEL = '[data-context-panel="pages"]';

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(200);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1417-panel-chrome');
  app = null;
  win = null;
});
test.setTimeout(300000);

// Open the multi-page sample (report.pdf, 34 pages) from Home.
async function openReport() {
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector(`${PANEL} .thumb-item`, { timeout: 30000 });
  await win.waitForTimeout(1500);
}

async function closeDialog(sel) {
  await win.keyboard.press('Escape');
  try {
    await win.locator(sel).first().waitFor({ state: 'detached', timeout: 4000 });
    return;
  } catch (_) { /* fall through to the close button */ }
  await win.locator(`${sel} button[aria-label="Close dialog"]`).first().click({ timeout: 4000 }).catch(() => {});
  await win.locator(sel).first().waitFor({ state: 'detached', timeout: 6000 });
}

// ---------------------------------------------------------------------------
// A. No More; three direct enabled buttons each perform their action.
// ---------------------------------------------------------------------------
test('TFL1417-A retires More and drives the three direct header buttons', async () => {
  await openReport();

  // Criterion 1 — no More button and no More popover exist in any state.
  await expect(win.locator('[data-context-panel-more]')).toHaveCount(0);
  await expect(win.locator('[data-context-panel-more-menu]')).toHaveCount(0);

  // Criterion 2 — each tool renders as its own enabled icon button.
  const layout = win.locator(`${PANEL} [data-context-panel-layout-split]`);
  const combine = win.locator(`${PANEL} [data-context-panel-combine]`);
  const blank = win.locator(`${PANEL} [data-blank-scan-open]`);
  for (const [name, loc] of [['layout', layout], ['combine', combine], ['blank', blank]]) {
    await expect(loc, `${name} rendered`).toHaveCount(1);
    await expect(loc, `${name} enabled`).toBeEnabled();
  }

  // Layout toggle performs its action: stacked -> split -> stacked.
  await expect(win.locator('[data-context-panel-split-divider]')).toHaveCount(0);
  await expect(layout).toHaveAttribute('aria-pressed', 'false');
  await layout.click();
  await expect(win.locator('[data-context-panel-split-divider]')).toHaveCount(1);
  await expect(layout).toHaveAttribute('aria-pressed', 'true');
  await layout.click();
  await expect(win.locator('[data-context-panel-split-divider]')).toHaveCount(0);
  await expect(layout).toHaveAttribute('aria-pressed', 'false');
  console.log('[TFL1417-A] layout toggle drove stacked<->split with aria-pressed');

  // Combine opens the existing merge dialog; no tool is a stub.
  await combine.click();
  await win.waitForSelector('[data-merge-pick]', { timeout: 8000 });
  await closeDialog('[data-merge-pick]');
  await expect(win.locator('[data-merge-pick]')).toHaveCount(0);

  // Remove blank pages opens the existing blank-pages scan dialog.
  await blank.click();
  await win.waitForSelector('[data-blank-pages-dialog]', { timeout: 8000 });
  await closeDialog('[data-blank-pages-dialog]');
  await expect(win.locator('[data-blank-pages-dialog]')).toHaveCount(0);

  console.log('[TFL1417-A] More retired; three direct buttons rendered and acted');
});

// ---------------------------------------------------------------------------
// B. One directional chevron per panel, flipping with state.
// ---------------------------------------------------------------------------
test('TFL1417-B flips each collapse chevron while the frozen hooks hold', async () => {
  await openReport();

  // LEFT panel: expanded -> ChevronLeft, collapsed -> ChevronRight.
  const rail = win.locator('[data-rail-collapse]');
  await expect(rail).toHaveCount(1);
  await expect(rail).toHaveAttribute('data-collapse-direction', 'collapse');
  await expect(rail).toHaveAttribute('aria-expanded', 'true');
  await expect(rail.locator('svg.lucide-chevron-left')).toHaveCount(1);
  await expect(rail.locator('svg.lucide-chevron-right')).toHaveCount(0);

  await rail.click();
  await win.waitForTimeout(600);
  await expect(rail).toHaveCount(1);
  await expect(rail).toHaveAttribute('data-rail-collapse', 'true');
  await expect(rail).toHaveAttribute('data-collapse-direction', 'expand');
  await expect(rail).toHaveAttribute('aria-expanded', 'false');
  await expect(rail.locator('svg.lucide-chevron-right')).toHaveCount(1);
  await expect(rail.locator('svg.lucide-chevron-left')).toHaveCount(0);
  console.log('[TFL1417-B] left panel chevron L(expanded)/R(collapsed), hooks held');

  // Restore the left panel.
  await rail.click();
  await win.waitForTimeout(600);

  // RIGHT Inspector: expanded -> ChevronRight, collapsed -> ChevronLeft.
  const insp = win.locator('[data-inspector-collapse]');
  await expect(insp).toHaveCount(1);
  await expect(insp).toHaveAttribute('aria-expanded', 'true');
  await expect(insp.locator('svg.lucide-chevron-right')).toHaveCount(1);
  await expect(insp.locator('svg.lucide-chevron-left')).toHaveCount(0);

  await insp.click();
  await win.waitForTimeout(600);
  await expect(insp).toHaveCount(1);
  await expect(insp).toHaveAttribute('data-inspector-collapse', 'true');
  await expect(insp).toHaveAttribute('aria-expanded', 'false');
  await expect(insp.locator('svg.lucide-chevron-left')).toHaveCount(1);
  await expect(insp.locator('svg.lucide-chevron-right')).toHaveCount(0);
  console.log('[TFL1417-B] inspector chevron R(expanded)/L(collapsed), hook held');
});

// ---------------------------------------------------------------------------
// C. Before/after evidence screenshots at the default window size.
// ---------------------------------------------------------------------------
test('TFL1417-C captures both panels expanded and collapsed', async () => {
  await openReport();

  await win.screenshot({ path: path.join(SHOTS, 'phase124-panel-expanded.png') });

  await win.locator('[data-rail-collapse]').click();
  await win.waitForTimeout(600);
  await win.locator('[data-inspector-collapse]').click();
  await win.waitForTimeout(600);
  await win.screenshot({ path: path.join(SHOTS, 'phase124-panel-collapsed.png') });

  console.log('[TFL1417-C] screenshots: screenshots/phase124-panel-expanded.png, screenshots/phase124-panel-collapsed.png');
});
