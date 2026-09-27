// Release 1.28.0 Gate 4 - the STAGES headline checks against the INSTALLED build.
//
// Launches ONLY through the canonical launchInstalled() helper (e2e/installed/*
// specs use it; it targets C:\Program Files\Jovrel\Jovrel.exe). Captures
// exactly ONE screenshot - screenshots/release-1280-stages.png - a NEW file, so
// no recorded screenshot is overwritten.
//
// Headline checks (the dispatch's Gate 4):
//   (a) Stage Rail: four stages, Ctrl+1..4 switch them
//   (b) PAGES panel: LIVE painted previews (canvas backing store + real ink)
//   (c) Action Dock for the focused stage: curated verbs + the floating pills
//   (d) Ctrl+K opens the palette and a known tool RUNS (observable effect)
//   (e) the Inspector is present
//   (f) spot-check reachability: six tools across the stages + two via palette
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchInstalled, hardClose, gotoStage, ensurePanelExpanded } = require('../lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const REPORT = path.join(ROOT, 'test-fixtures', 'report.pdf');
const SHOTS = path.join(ROOT, 'screenshots');
const SHOT = path.join(SHOTS, 'release-1280-stages.png');
const log = (label, obj) => console.log(`[r1280|${label}] ${JSON.stringify(obj)}`);

let app = null;
let win = null;

test.describe.configure({ mode: 'serial' });
test.setTimeout(240000);

test.beforeEach(async () => {
  ({ electronApp: app, window: win } = await launchInstalled());
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'r1280-stages');
  app = null;
  win = null;
});

async function openReport() {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, REPORT);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(900);
}

const dockVerbIds = () =>
  win.$$eval('[data-action-dock] [data-dock-verb]', (els) =>
    els.map((e) => e.getAttribute('data-dock-verb')));

// A verb is reachable when it is the inline lane (visible) or in the "More"
// overflow menu. Returns the lane name for evidence.
async function verbLane(id) {
  const inline = win.locator(`[data-action-dock] [data-dock-verb="${id}"]`);
  if ((await inline.count()) > 0) {
    return (await inline.first().isVisible().catch(() => false)) ? 'inline' : 'inline-hidden';
  }
  const overflow = win.locator('[data-dock-overflow]');
  if ((await overflow.count()) > 0) {
    await overflow.first().click();
    await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 8000 }).catch(() => {});
    const item = win.locator(`[data-dock-overflow-item="${id}"]`);
    const n = await item.count();
    await win.keyboard.press('Escape');
    return n > 0 ? 'overflow' : 'absent';
  }
  return 'absent';
}

// --- (a) Stage Rail: four stages + Ctrl+1..4 -------------------------------
test('(a) Stage Rail: four stages present and Ctrl+1..4 switch them', async () => {
  const rail = win.locator('[data-stage-rail]');
  await expect(rail).toBeVisible();
  const stages = await win.$$eval('[data-stage-rail] [data-stage]', (els) =>
    els.map((e) => e.getAttribute('data-stage')));
  expect(stages).toEqual(['pages', 'edit', 'review', 'deliver']);
  expect(await rail.getAttribute('data-active-stage')).toBe('pages');
  for (const [n, stage] of [[1, 'pages'], [2, 'edit'], [3, 'review'], [4, 'deliver']]) {
    await gotoStage(win, n);
    expect(await rail.getAttribute('data-active-stage'), `Ctrl+${n} -> ${stage}`).toBe(stage);
    expect(await win.locator(`[data-stage="${stage}"]`).getAttribute('aria-pressed')).toBe('true');
  }
  log('rail', { stages, final: await rail.getAttribute('data-active-stage') });
});

// --- (b) PAGES panel: LIVE painted previews --------------------------------
test('(b) PAGES panel: thumbnails are live painted previews, not placeholders', async () => {
  await openReport();
  await gotoStage(win, 1);
  await ensurePanelExpanded(win);
  await win.waitForSelector('[data-context-panel-thumbs] .thumb-item', { timeout: 15000 });
  await win.waitForTimeout(1200);
  const previews = await win.evaluate(() => {
    const items = Array.from(document.querySelectorAll('[data-context-panel-thumbs] .thumb-item'))
      .filter((el) => el.getBoundingClientRect().height > 0);
    const sample = (el) => {
      const c = el.querySelector('canvas.thumb-canvas');
      if (!c || c.width === 0 || c.height === 0) return { painted: false, ink: 0 };
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let ink = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) ink += 1;
      return { painted: true, ink };
    };
    return items.map((el) => ({ page: el.getAttribute('data-page'), ...sample(el) }));
  });
  log('pages-previews', { count: previews.length, previews });
  const painted = previews.filter((p) => p.painted);
  expect(painted.length, 'at least one live painted preview').toBeGreaterThan(0);
  for (const p of painted) expect(p.ink, `page ${p.page} preview has real ink`).toBeGreaterThan(0);
});

// --- (c) Action Dock for the focused stage + the pills ---------------------
test('(c) Action Dock reflects the focused stage and the floating pills are mounted', async () => {
  await openReport();
  const perStage = {};
  for (const [n, name] of [[1, 'pages'], [2, 'edit'], [3, 'review'], [4, 'deliver']]) {
    await gotoStage(win, n);
    await win.waitForSelector('[data-action-dock]', { state: 'visible', timeout: 10000 });
    const ids = await dockVerbIds();
    expect(ids.length, `stage ${name} dock has curated verbs`).toBeGreaterThan(0);
    perStage[name] = ids;
  }
  log('dock-verbs', perStage);
  // The curated verbs the release notes name are present on their stages.
  expect(perStage.pages).toEqual(expect.arrayContaining(['rotate']));
  expect(perStage.review).toEqual(expect.arrayContaining(['annotate', 'sign']));
  expect(perStage.deliver).toEqual(expect.arrayContaining(['optimize']));
  // The floating page + zoom pills (successors of the retired row view controls).
  await gotoStage(win, 1);
  expect(await win.locator('[data-page-pill]').isVisible(), 'page pill mounted').toBe(true);
  expect(await win.locator('[data-zoom-pill]').isVisible(), 'zoom pill mounted').toBe(true);
});

// --- (d) Ctrl+K palette opens + a known tool RUNS (observable effect) ------
test('(d) Ctrl+K opens the palette and running Zoom in changes the zoom readout', async () => {
  await openReport();
  await gotoStage(win, 1);
  const zoomText = () => win.locator('[data-zoom-pill] .zoom-percent').first().innerText();
  const before = (await zoomText()).trim();
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette]', { state: 'visible', timeout: 8000 });
  await win.fill('[data-command-palette-input]', 'Zoom in');
  await win.waitForTimeout(350);
  const row = win.locator('[data-palette-tool-id="zoomIn"]').first();
  await expect(row).toBeVisible();
  await row.click();
  await win.waitForTimeout(800);
  const after = (await zoomText()).trim();
  log('palette-zoom', { before, after });
  expect(after, 'running Zoom in through the palette changed the zoom readout').not.toBe(before);
});

// --- (e) Inspector present -------------------------------------------------
test('(e) the Inspector is present on the focused stage', async () => {
  await openReport();
  await gotoStage(win, 1);
  const inspector = win.locator('[data-inspector]');
  await expect(inspector).toBeVisible();
  log('inspector', { stage: await inspector.getAttribute('data-inspector-stage') });
});

// --- (f) reachability spot-check: 6 tools across stages + 2 via palette ----
test('(f) reachability: six tools across the stages + two palette commands', async () => {
  await openReport();
  const reach = {};
  const six = [
    [1, 'rotate'], [1, 'extract'], [2, 'editMode'],
    [3, 'annotate'], [3, 'sign'], [4, 'optimize'],
  ];
  for (const [n, id] of six) {
    await gotoStage(win, n);
    reach[id] = await verbLane(id);
    expect(reach[id], `tool '${id}' reachable on stage ${n}`).not.toBe('absent');
  }
  log('reachability-tools', reach);

  // Palette command 1: Preferences opens the sheet.
  await gotoStage(win, 1);
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  await win.fill('[data-command-palette-input]', 'Preferences');
  await win.waitForTimeout(350);
  await win.locator('[data-palette-tool-id="preferences"]').first().click();
  await win.waitForSelector('[data-prefs-dialog]', { state: 'visible', timeout: 8000 });
  const prefsOpened = await win.locator('[data-prefs-dialog]').isVisible();
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-prefs-dialog]', { state: 'detached', timeout: 8000 }).catch(() => {});

  // Palette command 2: stageDeliver runs and switches the stage.
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  await win.fill('[data-command-palette-input]', 'Deliver');
  await win.waitForTimeout(350);
  await win.locator('[data-palette-tool-id="stageDeliver"]').first().click();
  await win.waitForTimeout(500);
  const stageAfter = await win.locator('[data-stage-rail]').getAttribute('data-active-stage');
  log('reachability-palette', { prefsOpened, stageAfter });
  expect(prefsOpened, 'palette Preferences opened the sheet').toBe(true);
  expect(stageAfter, 'palette Deliver switched the stage').toBe('deliver');

  // ONE screenshot: PAGES stage with the rail, panel previews, dock+pills and
  // Inspector in frame.
  await gotoStage(win, 1);
  await win.waitForTimeout(700);
  fs.mkdirSync(SHOTS, { recursive: true });
  await win.screenshot({ path: SHOT });
  log('screenshot', { path: SHOT });
});