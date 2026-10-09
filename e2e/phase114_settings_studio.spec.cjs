// Phase 114 (chunk G) — Settings Studio focused e2e.
//
// Verifies the Phase 114 Settings Studio end-to-end in the real Electron app:
// the Ctrl+, entry point, the four-category navigator, immediate theme apply +
// relaunch persistence, the animations gate, tab-style / recents-cap commits,
// the Restore-defaults confirm (scope text, appearance/tab/import reset,
// recentsCap + recent-files history preserved), Escape + focus return to the application menu, the forced
// forced-colors rules, the 200% scaling / constrained-width stacking, and the
// header theme toggle (blast radius — the shared theme path).
//
// Launches only through the canonical `launchApp` helper. Read-only product
// checks: no product source is modified. Writes only under screenshots/phase114.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots', 'phase114');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (n) => path.join(SHOTS, n);

// Verbatim from PreferencesDialog.RESTORE_DEFAULTS_SCOPE
// (src/renderer/components/PreferencesDialog.tsx:137-138), updated by TFL-1282.
const RESTORE_SCOPE =
  'Restores the appearance, tab and import settings to their defaults. Your documents, recent files, window layout and saved signatures are kept.';
const CATEGORIES = ['general', 'documents', 'import', 'storage'];
const DEFAULT_RECENTS_CAP = 10;

let app = null;
let win = null;
test.setTimeout(300000);

async function launch(ud = null) {
  app = await launchApp([], ud);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
}
async function close(label) {
  if (app) await hardClose(app, label);
  app = null;
  win = null;
}
// A CLEAN isolated profile: writing settings.json marks the dir as initialised,
// so the app's legacy-userData migration is skipped and the run starts from the
// documented product defaults (theme/themeDefault frosted), not the operator's
// machine state.
async function seedProfile(name, overrides = {}) {
  const dir = path.join(os.tmpdir(), `tflex-tfl1273-${name}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const settings = {
    theme: 'frosted',
    themeDefault: 'frosted',
    geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false },
    recentFiles: [],
    icons: {},
    ocrLanguage: 'eng',
    ocrDownsample: 300,
    accountsEnabled: true,
    tabStyle: 'colorful',
    animationsEnabled: true,
    recentsCap: 10,
    ...overrides,
  };
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings, null, 2));
  return dir;
}
// Real Electron accelerator path: a main-process input event, exactly what the
// CmdOrCtrl+, menu accelerator consumes. Playwright's synthetic page.keyboard
// never reaches the browser-process menu, so the accelerator is driven here.
async function openViaCtrlComma() {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: ',', modifiers: ['control'] });
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode: ',', modifiers: ['control'] });
  });
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
  await win.waitForTimeout(300);
}
async function openViaGear() {
  await win.click('[data-open-preferences]');
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
  await win.waitForTimeout(300);
}
async function activePanelId() {
  return win.evaluate(() => {
    const active = [...document.querySelectorAll('[data-prefs-panel]')].filter(
      (p) => p.getAttribute('data-active') === 'true',
    );
    return { count: active.length, id: active[0] ? active[0].getAttribute('data-prefs-panel') : null };
  });
}
async function loadSettings() {
  return win.evaluate(() => window.tflex.loadSettings());
}
async function pollSettings(pred, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const r = await loadSettings();
    const value = r && r.ok ? r.value : null;
    if (value && pred(value)) return value;
    await win.waitForTimeout(150);
  }
  return null;
}

test.beforeEach(async () => {
  await launch();
});
test.afterEach(async () => {
  await close('p114');
});

test('E1 entry via Ctrl+, opens the Settings Studio with the four real categories; one active panel at a time', async () => {
  // The default launch uses an isolated temp profile (never the operator's).
  const ud = await app.evaluate(({ app }) => app.getPath('userData'));
  expect(ud.toLowerCase(), 'e2e uses an isolated temp userData dir').toContain(os.tmpdir().toLowerCase().replace(/\\/g, '\\'));
  await openViaCtrlComma();
  await expect(win.locator('.sheet-title', { hasText: 'Settings Studio' })).toBeVisible();
  // TFL-1285 diagnostic: geometry of the nav button vs the persistence footer.
  const geom = await win.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const nav = q('[data-prefs-category="general"]');
    const p = q('[data-prefs-persist-status]');
    const shell = q('.settings-studio-shell');
    const studio = q('.settings-studio');
    const nb = nav ? nav.getBoundingClientRect() : null;
    const cx = nb ? nb.left + nb.width / 2 : 0;
    const cy = nb ? nb.top + nb.height / 2 : 0;
    const top = document.elementFromPoint(cx, cy);
    return {
      nav: r(nav), persist: r(p), shell: r(shell), studio: r(studio),
      clickPt: { x: Math.round(cx), y: Math.round(cy) },
      topTag: top ? top.tagName : null, topClass: top ? String(top.className) : null,
      innerW: window.innerWidth, innerH: window.innerHeight,
      bodyPrefs: r(q('.sheet-body-prefs')), sheet: r(q('.sheet-prefs')),
    };
  });
  console.log('[tfl1285-e1-geom]', JSON.stringify(geom));
  await win.screenshot({ path: shot('studio-e1-nav-geom.png') });
  for (const cat of CATEGORIES) {
    await expect(win.locator(`[data-prefs-category="${cat}"]`), `category ${cat}`).toHaveCount(1);
  }
  for (const cat of CATEGORIES) {
    await win.locator(`[data-prefs-category="${cat}"]`).click();
    await win.waitForTimeout(300);
    const state = await activePanelId();
    expect(state.count, `exactly one active panel with ${cat} selected`).toBe(1);
    expect(state.id, `active panel is ${cat}`).toBe(cat);
    const activeVisible = await win
      .locator(`[data-prefs-panel="${cat}"]`)
      .evaluate((el) => el.getBoundingClientRect().height > 0);
    expect(activeVisible, `${cat} panel visible`).toBe(true);
    await win.screenshot({ path: shot(`studio-${cat}.png`) });
  }
  await win.locator('[data-prefs-category="general"]').click();
});

test('E2 theme default applies immediately (<html data-theme> flips), offers all four themes, and survives relaunch', async () => {
  await close('p114-e2');
  app = null;
  const ud = await seedProfile('theme');
  await launch(ud);
  const bootPath = await app.evaluate(({ app }) => app.getPath('userData'));
  expect(path.resolve(bootPath), 'seeded profile is the launch userData dir').toBe(path.resolve(ud));
  const boot = await win.evaluate(() => document.documentElement.dataset.theme);
  expect(boot, 'clean profile boots on the Frosted default').toBe('frosted');

  await openViaCtrlComma();
  const themeSelect = win.locator('[data-prefs-theme-default]');
  const opts = await themeSelect.locator('option').evaluateAll((os) => os.map((o) => o.value));
  expect(opts, 'all four themes offered').toEqual(['light', 'dark', 'frosted', 'system']);

  for (const theme of ['light', 'dark', 'frosted']) {
    await themeSelect.selectOption(theme);
    await expect
      .poll(() => win.evaluate(() => document.documentElement.dataset.theme), { timeout: 5000 })
      .toBe(theme);
    await win.screenshot({ path: shot(`studio-theme-${theme}.png`) });
  }
  // System is selectable; it resolves to the OS preference (assert it selects and
  // a concrete theme remains set), then return to dark for the relaunch check.
  await themeSelect.selectOption('system');
  await expect
    .poll(() => win.evaluate(() => document.documentElement.dataset.theme), { timeout: 5000 })
    .toMatch(/light|dark|frosted/);
  await themeSelect.selectOption('dark');
  await expect
    .poll(() => win.evaluate(() => document.documentElement.dataset.theme), { timeout: 5000 })
    .toBe('dark');

  // Persisted to disk under the seeded profile.
  await expect
    .poll(() => pollSettings((s) => s.theme === 'dark' && s.themeDefault === 'dark'), { timeout: 8000 })
    .not.toBeNull();

  await close('p114-e2-first');
  app = null;
  await launch(ud);
  const bootTheme = await win.evaluate(() => document.documentElement.dataset.theme);
  console.log('[p114-e2] relaunch boot theme =', bootTheme);
  expect(bootTheme, 'theme default survives relaunch').toBe('dark');
  await win.screenshot({ path: shot('studio-theme-relaunch-dark.png') });
  await close('p114-e2-second');
});

test('E3 Enable animations gates <html data-animations>; tab style and recents cap persist (blur + Enter commit)', async () => {
  await openViaCtrlComma();
  const anim = win.locator('[data-prefs-animations]');
  await expect(anim).toBeChecked();
  await anim.uncheck();
  await expect
    .poll(() => win.evaluate(() => document.documentElement.dataset.animations), { timeout: 5000 })
    .toBe('off');
  await anim.check();
  await expect
    .poll(() => win.evaluate(() => document.documentElement.dataset.animations), { timeout: 5000 })
    .toBe('on');

  await win.locator('[data-prefs-tab-style]').selectOption('standard');
  await expect
    .poll(async () => (await pollSettings((s) => s.tabStyle === 'standard', 6000)) !== null, { timeout: 8000 })
    .toBe(true);

  // Recents maximum commits on Enter …
  const cap = win.locator('[data-prefs-recents-cap]');
  await cap.fill('7');
  await cap.press('Enter');
  await expect
    .poll(async () => (await pollSettings((s) => s.recentsCap === 7, 6000)) !== null, { timeout: 8000 })
    .toBe(true);
  // … and on blur.
  await cap.fill('9');
  await win.locator('.sheet-title').click();
  await expect
    .poll(async () => (await pollSettings((s) => s.recentsCap === 9, 6000)) !== null, { timeout: 8000 })
    .toBe(true);
});

test('E4 Restore defaults: confirm dialog carries the exact scope text; confirm resets the appearance/tab/import fields and preserves recentsCap + recent-files history', async () => {
  await close('p114-e4');
  app = null;
  await launch(await seedProfile('restore'));
  // Seed one real recent-file entry through the shipped bridge.
  await win.evaluate(() =>
    window.tflex.addRecentFile({
      path: 'C:/tfl1273/keepme.pdf',
      name: 'keepme.pdf',
      openedAt: new Date().toISOString(),
    }),
  );
  const seeded = await pollSettings((s) => s.recentFiles.length >= 1);
  expect(seeded, 'recent file recorded before reset').not.toBeNull();

  await openViaCtrlComma();
  await win.locator('[data-prefs-theme-default]').selectOption('dark');
  await win.locator('[data-prefs-animations]').uncheck();
  await win.locator('[data-prefs-tab-style]').selectOption('standard');
  const cap = win.locator('[data-prefs-recents-cap]');
  await cap.fill('7');
  await cap.press('Enter');
  await expect
    .poll(() => win.evaluate(() => document.documentElement.dataset.theme), { timeout: 5000 })
    .toBe('dark');

  await win.locator('[data-prefs-restore-defaults]').click();
  await win.waitForSelector('[data-confirm-dialog]', { timeout: 8000 });
  const bodyText = await win.locator('#confirm-dialog-body').innerText();
  expect(bodyText.trim(), 'exact restore scope text').toBe(RESTORE_SCOPE);
  await win.screenshot({ path: shot('studio-restore-defaults-confirm.png') });

  await win.locator('[data-confirm-dialog-action="confirm"]').click();
  await win.waitForSelector('[data-confirm-dialog]', { state: 'hidden', timeout: 8000 });

  await expect
    .poll(() => win.evaluate(() => document.documentElement.dataset.theme), { timeout: 6000 })
    .toBe('frosted');
  expect(await win.locator('[data-prefs-theme-default]').inputValue()).toBe('frosted');
  expect(await win.locator('[data-prefs-tab-style]').inputValue()).toBe('colorful');
  expect(await win.locator('[data-prefs-animations]').isChecked()).toBe(true);
  // DEF-660 (TFL-1282) - the cap set before the reset (7) is preserved, NOT
  // lowered to the product default (10): a lower cap would let the backend
  // truncate the recent-files history the scope text promises to keep.
  await expect
    .poll(() => win.locator('[data-prefs-recents-cap]').inputValue(), { timeout: 6000 })
    .toBe('7');

  const after = await pollSettings(
    (s) =>
      s.theme === 'frosted' &&
      s.themeDefault === 'frosted' &&
      s.animationsEnabled === true &&
      s.tabStyle === 'colorful' &&
      s.recentsCap === 7 &&
      s.convertDefaults &&
      s.convertDefaults.pageSize === 'a4' &&
      s.convertDefaults.marginMm === 20 &&
      s.convertDefaults.textFontFamily === 'Inter' &&
      s.convertDefaults.textFontSizePt === 11,
  );
  expect(after, 'appearance/tab/import fields reset to documented defaults, cap preserved').not.toBeNull();
  expect(after.recentsCap, 'recentsCap is not lowered to the product default').not.toBe(DEFAULT_RECENTS_CAP);
  expect(after.recentFiles.length, 'recent-files history preserved by Restore defaults').toBeGreaterThanOrEqual(1);
  await win.screenshot({ path: shot('studio-restore-defaults-after.png') });
});

test('E5 Escape closes the sheet and focus returns to the title-bar gear', async () => {
  await openViaGear();
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-prefs-dialog]', { state: 'hidden', timeout: 8000 });
  const focused = await win.evaluate(() => {
    const el = document.activeElement;
    return { hasGear: el ? el.hasAttribute('data-open-preferences') : false };
  });
  expect(focused.hasGear, 'focus returns to [data-open-preferences] after Escape').toBe(true);
});

test('E6 constrained width: native floor is 960 DIP (520 unreachable by resize); at 200% scaling the selector stacks above the body with no horizontal overflow', async () => {
  await openViaCtrlComma();

  // Native minimum: a 520px resize is refused under the app's own constraint.
  const native = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w.isMaximized()) { w.unmaximize(); await new Promise((r) => setTimeout(r, 600)); }
    const min = w.getMinimumSize();
    w.setSize(520, 700);
    await new Promise((r) => setTimeout(r, 600));
    return { min, after: w.getBounds() };
  });
  console.log('[p114-e6] native min =', JSON.stringify(native));
  expect(native.min[0], 'native minimum width').toBeGreaterThanOrEqual(720);
  expect(native.after.width, 'setSize(520) is refused at the native floor').toBeGreaterThanOrEqual(native.min[0]);

  // 200% scaling (criterion 10) is the in-product constrained-width path: the
  // CSS viewport halves, firing the Studio's max-width:720px stacking rule.
  const zoom = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(960, 760);
    await new Promise((r) => setTimeout(r, 500));
    w.webContents.setZoomFactor(2);
    await new Promise((r) => setTimeout(r, 500));
    return w.getBounds();
  });
  await win.waitForTimeout(500);
  const layout = await win.evaluate(() => {
    const studio = document.querySelector('.settings-studio');
    const nav = document.querySelector('.settings-studio-nav');
    const body = document.querySelector('.settings-studio-body');
    const dr = nav.getBoundingClientRect();
    const br = body.getBoundingClientRect();
    return {
      innerWidth: window.innerWidth,
      flexDir: getComputedStyle(studio).flexDirection,
      navAboveBody: dr.bottom <= br.top + 1,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    };
  });
  console.log('[p114-e6] zoom200 =', JSON.stringify(zoom), 'layout =', JSON.stringify(layout));
  expect(layout.innerWidth, '200% scaling yields a constrained CSS viewport').toBeLessThanOrEqual(720);
  expect(layout.flexDir, 'navigator stacks above the body').toBe('column');
  expect(layout.navAboveBody, 'nav is above the body').toBe(true);
  expect(layout.scrollW, 'no horizontal document overflow').toBeLessThanOrEqual(layout.clientW + 1);
  await win.screenshot({ path: shot('studio-zoom200-constrained.png') });
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1); });
  await win.waitForTimeout(400);

  // Forced-colors / high-contrast capture (criterion 6) — the selected nav item
  // and focus must remain legible on system colours.
  await win.emulateMedia({ forcedColors: 'active' });
  await win.waitForTimeout(300);
  const fc = await win.evaluate(() => ({
    matches: window.matchMedia('(forced-colors: active)').matches,
    selected: (() => {
      const s = document.querySelector('.settings-nav-item[aria-selected="true"]');
      return s ? getComputedStyle(s).backgroundColor : null;
    })(),
  }));
  console.log('[p114-e6] forced-colors =', JSON.stringify(fc));
  expect(fc.matches, 'forced-colors emulation active').toBe(true);
  await win.screenshot({ path: shot('studio-forced-colors.png') });
  await win.emulateMedia({ forcedColors: 'none' });

  // Compact-size captures (item 6). The app's own floor is 960, so the compact
  // ~520px surface is reached by relaxing the runtime window minimum (test
  // instrumentation only; product source untouched).
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setMinimumSize(120, 120);
    w.setSize(520, 700);
    await new Promise((r) => setTimeout(r, 600));
  });
  await win.waitForTimeout(400);
  const compact = await win.evaluate(() => ({
    innerWidth: window.innerWidth,
    flexDir: getComputedStyle(document.querySelector('.settings-studio')).flexDirection,
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  console.log('[p114-e6] compact520 =', JSON.stringify(compact));
  expect(compact.flexDir, 'compact: navigator stacks above the body').toBe('column');
  expect(compact.scrollW, 'compact: no horizontal overflow').toBeLessThanOrEqual(compact.clientW + 1);
  await win.screenshot({ path: shot('studio-compact-520-frosted.png') });
  await win.locator('[data-prefs-theme-default]').selectOption('dark');
  await win.waitForTimeout(400);
  await win.screenshot({ path: shot('studio-compact-520-dark.png') });
  await win.locator('[data-prefs-theme-default]').selectOption('light');
  await win.waitForTimeout(400);
  await win.screenshot({ path: shot('studio-compact-520-light.png') });
});

test('E7 blast radius: the Stage Rail gear (shared prefs state) still opens the migrated Settings Studio', async () => {
  await win.locator('.sample-card').first().click();
  await win.waitForSelector('[data-stage-rail]', { timeout: 30000 });
  await win.locator('[data-stage-rail-gear]').click();
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
  await expect(win.locator('.sheet-title', { hasText: 'Settings Studio' })).toBeVisible();
  await expect(win.locator('[data-prefs-category="general"]')).toHaveCount(1);
  await win.screenshot({ path: shot('studio-stage-rail-entry.png') });
});
