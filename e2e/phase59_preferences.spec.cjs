// Phase 59 (item 8) — Preferences redesign.
//
// The assigned behaviour (Phase 59 item 8 / success criterion 8):
//   - the sheet is rebuilt with VERTICAL category tabs, one category visible
//     at a time, and each tab switches the visible category;
//   - labels and controls occupy their own aligned columns with NO overlap at
//     the sheet's normal width AND at the minimum window width;
//   - every pre-rebuild `data-prefs-*` hook is preserved (nothing lost).
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

// The four vertical categories (mirrors PREFS_CATEGORIES).
const CATEGORIES = ['general', 'documents', 'import', 'storage'];

// Every `data-prefs-*` hook that existed BEFORE the Phase 59 rebuild (from
// `git show HEAD:src/renderer/components/PreferencesDialog.tsx`). The rebuild
// must preserve all of them. `data-prefs-default-pdf-status` is conditional
// (rendered only after the default-apps action), so it is asserted after the
// action runs.
const PRE_REBUILD_HOOKS = [
  'data-prefs-animations',
  'data-prefs-convert-csv-mapping',
  'data-prefs-convert-delimiter',
  'data-prefs-convert-font',
  'data-prefs-convert-font-size',
  'data-prefs-convert-html-backgrounds',
  'data-prefs-convert-margin',
  'data-prefs-convert-page-size',
  'data-prefs-convert-section',
  'data-prefs-default-pdf',
  'data-prefs-default-pdf-section',
  'data-prefs-dialog',
  'data-prefs-recents-cap',
  'data-prefs-tab-style',
  'data-prefs-theme-default',
];
const CONDITIONAL_HOOK = 'data-prefs-default-pdf-status';

let app = null;
let win = null;

test.setTimeout(300000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p59-prefs');
  app = null;
  win = null;
});

async function openPrefs() {
  await win.locator('[data-open-preferences]').first().click();
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
  await win.waitForTimeout(400);
}

async function closePrefs() {
  await win.locator('[data-prefs-dialog] .sheet-close').first().click();
  await win.waitForSelector('[data-prefs-dialog]', { state: 'hidden', timeout: 10000 });
}

/** Measure every `.prefs-row` in the ACTIVE panel: the label's right edge and
 *  the control's left edge. `overlap` is true when the label box runs into the
 *  control box. */
async function measureRows() {
  return win.evaluate(() => {
    const panel = document.querySelector('[data-prefs-panel][data-active="true"]');
    if (panel === null) return null;
    const rows = Array.from(panel.querySelectorAll('.prefs-row'));
    return rows
      .map((row) => {
        const label = row.querySelector('.prefs-row-label');
        const control = Array.from(row.children).find((c) => c !== label);
        // A row with no label (e.g. the default-apps action button) has no
        // label box to overlap; skip it.
        if (label === null || control === undefined) return null;
        const lr = label.getBoundingClientRect();
        const cr = control.getBoundingClientRect();
        return {
          label: label.textContent.trim(),
          labelRight: +lr.right.toFixed(2),
          controlLeft: +cr.left.toFixed(2),
          gap: +(cr.left - lr.right).toFixed(2),
          overlap: lr.right > cr.left,
        };
      })
      .filter((r) => r !== null);
  });
}

async function setWindowWidth(width) {
  const info = await app.evaluate(async ({ BrowserWindow }, w) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return null;
    const before = { maximized: win.isMaximized(), bounds: win.getBounds(), min: win.getMinimumSize() };
    if (win.isMaximized()) {
      win.unmaximize();
      await new Promise((r) => setTimeout(r, 400));
    }
    win.setBounds({ x: 0, y: 0, width: w, height: 800 });
    await new Promise((r) => setTimeout(r, 400));
    win.setSize(w, 800);
    await new Promise((r) => setTimeout(r, 400));
    return { before, after: win.getBounds(), min: win.getMinimumSize() };
  }, width);
  await win.waitForTimeout(900);
  const inner = await win.evaluate(() => window.innerWidth);
  console.log(`[P59-prefs] resize info=${JSON.stringify(info)} innerWidth=${inner}`);
  return inner;
}

test('Preferences: vertical categories switch, no label/control overlap at normal + minimum width, every pre-rebuild hook preserved', async () => {
  await openPrefs();

  // 1. The vertical category tabs exist.
  for (const cat of CATEGORIES) {
    await expect(win.locator(`[data-prefs-category="${cat}"]`), `category tab ${cat}`).toHaveCount(1);
  }

  // 2. Each tab switches the visible category (one panel active at a time).
  for (const cat of CATEGORIES) {
    await win.locator(`[data-prefs-category="${cat}"]`).click();
    await win.waitForTimeout(350);
    const state = await win.evaluate((want) => {
      const panels = Array.from(document.querySelectorAll('[data-prefs-panel]'));
      return panels.map((p) => ({
        id: p.getAttribute('data-prefs-panel'),
        active: p.getAttribute('data-active') === 'true',
        hidden: p.hasAttribute('hidden'),
        visible: p.getBoundingClientRect().height > 0,
      }));
    }, cat);
    const active = state.filter((p) => p.active);
    console.log(`[P59-prefs] category=${cat} panels=${JSON.stringify(state)}`);
    expect(active.length, `exactly one active panel for ${cat}`).toBe(1);
    expect(active[0].id, `the active panel is ${cat}`).toBe(cat);
    expect(active[0].visible, `the ${cat} panel is visible`).toBe(true);
    for (const p of state) {
      if (p.id !== cat) expect(p.visible, `${p.id} panel hidden while ${cat} is active`).toBe(false);
    }
    await win.screenshot({ path: path.join(SHOTS, `p59-prefs-${cat}.png`) });
  }

  // 3. No label box overlaps its control box at the sheet's normal width.
  const normal = [];
  for (const cat of CATEGORIES) {
    await win.locator(`[data-prefs-category="${cat}"]`).click();
    await win.waitForTimeout(300);
    const rows = await measureRows();
    console.log(`[P59-prefs] normal ${cat} rows=${JSON.stringify(rows)}`);
    for (const r of rows ?? []) normal.push({ cat, ...r });
  }
  const normalOverlaps = normal.filter((r) => r.overlap === true || r.missing === true);
  expect(normalOverlaps, `label/control overlaps at normal width: ${JSON.stringify(normalOverlaps)}`).toEqual([]);
  const minNormalGap = Math.min(...normal.filter((r) => typeof r.gap === 'number').map((r) => r.gap));
  console.log(`[P59-prefs] normal min gap=${minNormalGap}`);

  // 4. No overlap at the MINIMUM window width (640px).
  const innerWidth = await setWindowWidth(640);
  expect(innerWidth, 'the window actually shrank to the minimum width').toBeLessThanOrEqual(700);
  const narrow = [];
  for (const cat of CATEGORIES) {
    await win.locator(`[data-prefs-category="${cat}"]`).click();
    await win.waitForTimeout(300);
    const rows = await measureRows();
    console.log(`[P59-prefs] min-width ${cat} rows=${JSON.stringify(rows)}`);
    for (const r of rows ?? []) narrow.push({ cat, ...r });
  }
  const narrowOverlaps = narrow.filter((r) => r.overlap === true || r.missing === true);
  expect(narrowOverlaps, `label/control overlaps at minimum width: ${JSON.stringify(narrowOverlaps)}`).toEqual([]);
  const minNarrowGap = Math.min(...narrow.filter((r) => typeof r.gap === 'number').map((r) => r.gap));
  console.log(`[P59-prefs] min-width min gap=${minNarrowGap}`);
  await win.screenshot({ path: path.join(SHOTS, 'p59-prefs-min-width.png') });

  // 5. Every pre-rebuild `data-prefs-*` hook is still present.
  const missing = await win.evaluate((hooks) => {
    return hooks.filter((h) => document.querySelector(`[${h}]`) === null);
  }, PRE_REBUILD_HOOKS);
  console.log(`[P59-prefs] missing hooks=${JSON.stringify(missing)}`);
  expect(missing, `pre-rebuild hooks lost: ${missing.join(',')}`).toEqual([]);

  // The conditional status hook appears once the default-apps action runs.
  await win.locator('[data-prefs-category="documents"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-prefs-default-pdf]').click();
  await win.waitForSelector(`[${CONDITIONAL_HOOK}]`, { timeout: 10000 });
  expect(await win.locator(`[${CONDITIONAL_HOOK}]`).count(), 'conditional status hook present').toBe(1);

  await closePrefs();
});
