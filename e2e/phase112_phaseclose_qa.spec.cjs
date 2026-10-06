// Phase 112 (TFL-854) phase-close QA evidence (TFL-1003).
// Captures the Success-criteria screenshots for Home and the four workspaces in
// both themes, the resized / collapsed / narrow panel states, the Focus Dock
// geometry, and times the thumbnail/list render + panel-resize budget items.
// Launches ONLY through the canonical launchApp helper. Purely an evidence run:
// it asserts nothing that a stale oracle would fabricate, it measures + shoots.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const RESULTS = path.join(ROOT, 'test-fixtures', 'phase112-qa');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(RESULTS, { recursive: true });

const STAGES = ['pages', 'edit', 'review', 'deliver'];
const SAMPLE = path.join(ROOT, 'assets', 'samples', 'report.pdf');

let app = null;
let win = null;
test.setTimeout(300000);

const shot = (name) => win.screenshot({ path: path.join(SHOTS, `phase112-close-${name}.png`) });
const save = (name, obj) => fs.writeFileSync(path.join(RESULTS, `${name}.json`), JSON.stringify(obj, null, 2));

// A user-data dir whose settings.json seeds a populated Recent list (verified
// + converted + pinned metadata, plus one genuinely missing path).
function seedSettings() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p112-close-'));
  const missing = path.join(os.tmpdir(), 'tflex-p112-close-missing.pdf');
  const settings = {
    theme: 'light',
    geometry: { x: 40, y: 40, width: 1440, height: 900, maximized: false },
    recentFiles: [
      { path: SAMPLE, name: 'report.pdf', openedAt: new Date(Date.now() - 3600000).toISOString(), sourceLabel: 'PDF Document', sourceKind: 'pdf', workingFormat: 'pdf' },
      { path: SAMPLE, name: 'quarterly-plan.docx', openedAt: new Date(Date.now() - 86400000).toISOString(), sourceLabel: 'Word Document', sourceKind: 'docx', converted: true, workingFormat: 'pdf', pinned: true },
      { path: missing, name: 'archived-report.pdf', openedAt: new Date(Date.now() - 172800000).toISOString(), sourceLabel: 'PDF Document', sourceKind: 'pdf', workingFormat: 'pdf' },
    ],
  };
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings, null, 2));
  return dir;
}

async function launch() {
  const dir = seedSettings();
  app = await launchApp([], dir);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
}

async function theme() {
  return win.evaluate(() => document.documentElement.getAttribute('data-theme'));
}

async function forceTheme(want) {
  if ((await theme()) === want) return true;
  // Prefer the real header picker when it is mounted (a document is open).
  if ((await win.locator('[data-theme-toggle]').count()) > 0) {
    for (let i = 0; i < 4; i += 1) {
      if ((await theme()) === want) return true;
      await win.click('[data-theme-toggle]');
      await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
      const opt = win.locator(`[data-theme-option="${want}"]`);
      if ((await opt.count()) === 0) { await win.keyboard.press('Escape'); break; }
      await opt.first().click();
      await win.waitForTimeout(400);
    }
    if ((await theme()) === want) return true;
  }
  // The Welcome screen has no header theme control; drive the same attribute
  // the app sets (the accepted theme-screenshot pattern in def344_contrast).
  await win.evaluate((t) => { document.documentElement.dataset.theme = t; }, want);
  await win.waitForTimeout(400);
  return (await theme()) === want;
}

async function openSample(name) {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('[data-context-panel] .thumb-item', { timeout: 30000 });
  await win.waitForTimeout(1500);
}

async function goStage(stage) {
  await win.locator(`[data-stage="${stage}"]`).click();
  await win.waitForSelector(`[data-context-panel="${stage}"]`, { timeout: 20000 });
  await win.waitForTimeout(1200);
}

async function panelVars() {
  return win.evaluate(() => {
    const host = document.querySelector('.app-main') || document.documentElement;
    const cs = getComputedStyle(host);
    const dock = document.querySelector('[data-action-dock]');
    const dr = dock ? dock.getBoundingClientRect() : null;
    return {
      rail: cs.getPropertyValue('--tf-rail-w').trim(),
      tools: cs.getPropertyValue('--tools-panel-w').trim(),
      inset: cs.getPropertyValue('--tf-tools-inset').trim(),
      dock: dr ? { cx: Math.round(dr.x + dr.width / 2), cy: Math.round(dr.y + dr.height / 2), w: Math.round(dr.width), vw: window.innerWidth, vh: window.innerHeight } : null,
    };
  });
}

async function close() {
  if (app) await hardClose(app, 'p112close');
  app = null;
  win = null;
}

// P112CLOSE-1 — Home: populated Recent + Samples, both themes.
test('P112CLOSE-1 Home Recent + Samples both themes', async () => {
  await launch();
  await forceTheme('light');
  await win.waitForSelector('[data-recent-row]', { timeout: 10000 }).catch(() => {});
  await win.waitForTimeout(800);
  const rows = await win.locator('[data-recent-row]').count();
  const samples = await win.locator('.sample-card').count();
  const missing = await win.locator('[data-recent-missing="true"]').count();
  await shot('home-light');
  await forceTheme('dark');
  await win.waitForTimeout(800);
  await shot('home-dark');
  save('home', { themeLight: 'light', recentRows: rows, sampleCards: samples, missingRows: missing });
  await close();
});

// P112CLOSE-2 — the four workspace Context Pairs in both themes.
test('P112CLOSE-2 Pages/Edit/Review/Deliver both themes', async () => {
  await launch();
  await openSample('report.pdf');
  expect(await forceTheme('light'), 'light theme reached').toBe(true);
  const scope = {};
  for (const stage of STAGES) {
    await goStage(stage);
    scope[stage] = await win.locator(`[data-context-panel="${stage}"]`).count();
    await shot(`${stage}-light`);
  }
  expect(await forceTheme('dark'), 'dark theme reached').toBe(true);
  for (const stage of STAGES) {
    await goStage(stage);
    await shot(`${stage}-dark`);
  }
  save('workspaces', { panelCount: scope, themes: ['light', 'dark'] });
  await close();
});

// P112CLOSE-3 — resized / collapsed / narrow panels + Focus Dock geometry.
test('P112CLOSE-3 resize collapse narrow + dock geometry', async () => {
  await launch();
  await forceTheme('light');
  await openSample('report.pdf');
  await goStage('pages');
  const before = await panelVars();

  // Left handle keyboard path: End (max 320) then a couple of nudges.
  await win.locator('[data-panel-resize="left"]').focus();
  const t0 = Date.now();
  await win.keyboard.press('End');
  await win.waitForTimeout(120);
  const widthUpdateMs = Date.now() - t0;
  await shot('pages-left-max');
  await win.keyboard.press('ArrowLeft');
  await win.waitForTimeout(80);
  await win.keyboard.press('ArrowLeft');
  await win.waitForTimeout(80);
  const afterLeft = await panelVars();

  // Right handle: Home (min 260) then End (max 380).
  await win.locator('[data-panel-resize="right"]').focus();
  await win.keyboard.press('Home');
  await win.waitForTimeout(120);
  await shot('pages-right-min');
  await win.keyboard.press('End');
  await win.waitForTimeout(120);
  const afterRight = await panelVars();

  // Collapse the left rail.
  await win.locator('[data-rail-collapse]').first().click();
  await win.waitForTimeout(500);
  const afterCollapse = await panelVars();
  await shot('pages-collapsed');

  // Narrow window (compact drawer / clamp).
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setSize(780, 900);
  });
  await win.waitForTimeout(1000);
  const narrow = await panelVars();
  await shot('pages-narrow');

  save('layout', { before, widthUpdateMs, afterLeft, afterRight, afterCollapse, narrow });
  await close();
});

// P112CLOSE-4 — performance budget items: thumbnail/list render + panel resize.
test('P112CLOSE-4 timing: open/thumbnail, review list, panel resize', async () => {
  await launch();
  await forceTheme('light');
  const t0 = Date.now();
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  const workspaceMs = Date.now() - t0;
  await win.waitForSelector('[data-context-panel="pages"] .thumb-item', { timeout: 30000 });
  const firstThumbMs = Date.now() - t0;
  const thumbCount = await win.locator('[data-context-panel="pages"] .thumb-item').count();
  await win.waitForTimeout(1500);

  await win.locator('[data-panel-resize="left"]').focus();
  const r0 = Date.now();
  await win.keyboard.press('End');
  await win.waitForTimeout(100);
  const resizeMs = Date.now() - r0;

  const s0 = Date.now();
  await goStage('review');
  const reviewListMs = Date.now() - s0;
  const reviewRows = await win.locator('[data-context-panel="review"] [data-annotation-row]').count();
  const reviewEmpty = await win.locator('[data-context-panel="review"] [data-annotation-empty]').count();

  save('timings', { workspaceMs, firstThumbMs, thumbCount, resizeMs, reviewListMs, reviewRows, reviewEmpty });
  await close();
});
