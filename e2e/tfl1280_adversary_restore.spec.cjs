// ADV (TFL-1280, Phase 114 chunk H) — Restore-defaults scope, live repro.
//
// Attacks the phase-114 criterion-9 promise stated verbatim in the Studio's
// confirm dialog:
//   "Restores the appearance, tab and import settings to their
//    defaults. Your documents, recent files, window layout and saved
//    signatures are kept."
// A profile with a raised recents cap and more history than the default cap is
// put through the real Restore-defaults confirm; the on-disk recent-files
// history is then counted. The promise says it is kept.
//
// Launches only through the canonical `launchApp` helper (e2e/lib/launch.cjs).
// Reads the isolated temp profile it created; touches no product source.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

let app = null;
let win = null;
test.setTimeout(180000);

function seedProfile(name, theme = 'frosted') {
  const dir = path.join(os.tmpdir(), `tflex-tfl1280-${name}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const recentFiles = Array.from({ length: 15 }, (_, i) => ({
    path: `C:/tfl1280/report-${i + 1}.pdf`,
    name: `report-${i + 1}.pdf`,
    openedAt: new Date(2024, 0, 1 + i).toISOString(),
  }));
  const settings = {
    theme,
    themeDefault: theme,
    geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false },
    recentFiles,
    icons: {},
    ocrLanguage: 'eng',
    ocrDownsample: 300,
    accountsEnabled: true,
    tabStyle: 'colorful',
    animationsEnabled: true,
    recentsCap: 20,
  };
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings, null, 2));
  return dir;
}

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1280');
  app = null;
  win = null;
});

test('Restore defaults keeps recent-files history beyond the default cap (scope promise)', async () => {
  const ud = seedProfile('restore', 'light');
  app = await launchApp([], ud);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);

  const before = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
  console.log('[tfl1280] before: cap =', before.recentsCap, 'history =', before.recentFiles.length);

  // Ctrl+, is the real application-menu accelerator (main-process input event).
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: ',', modifiers: ['control'] });
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode: ',', modifiers: ['control'] });
  });
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
  await win.waitForTimeout(300);

  await win.locator('[data-prefs-restore-defaults]').click();
  await win.waitForSelector('[data-confirm-dialog]', { timeout: 8000 });
  await win.locator('[data-confirm-dialog-action="confirm"]').click();
  await win.waitForSelector('[data-confirm-dialog]', { state: 'hidden', timeout: 8000 });

  // Wait for the reset write to land on disk: the seeded light themeDefault
  // flips to the reset default (frosted).
  await expect
    .poll(() =>
      JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).themeDefault,
      { timeout: 8000 },
    )
    .toBe('frosted');

  const after = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
  console.log('[tfl1280] after : cap =', after.recentsCap, 'history =', after.recentFiles.length);
  // DEF-644 (TFL-1282): the reset must NOT lower recentsCap (the backend trims
  // recentFiles to the cap on save), and the scope sentence promises the
  // recent-files history is KEPT.
  expect(after.recentsCap, 'recentsCap preserved by Restore defaults').toBe(before.recentsCap);
  expect(after.recentFiles.length, 'recent-files history is kept by Restore defaults').toBe(
    before.recentFiles.length,
  );
});

test('a failed settings write restores the prior value in the UI and says so (rollback honesty)', async () => {
  const ud = seedProfile('rollback');
  const settingsPath = path.join(ud, 'settings.json');
  app = await launchApp([], ud);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: ',', modifiers: ['control'] });
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode: ',', modifiers: ['control'] });
  });
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
  await win.waitForTimeout(300);

  const bootTheme = await win.evaluate(() => document.documentElement.dataset.theme);
  console.log('[tfl1280-rb] boot theme =', bootTheme);

  // Filesystem abuse: make the settings file read-only so the tmp -> rename
  // persist fails, then request a theme change from the Studio.
  fs.chmodSync(settingsPath, 0o444);
  try {
    await win.locator('[data-prefs-theme-default]').selectOption('dark');
    // The optimistic value flips first, then a failed write must roll it back.
    await expect
      .poll(
        () => win.evaluate(() => document.documentElement.dataset.theme),
        { timeout: 8000 },
      )
      .toBe(bootTheme);
    const status = (await win.locator('[data-prefs-persist-status]').innerText()).trim();
    console.log('[tfl1280-rb] status =', JSON.stringify(status));
    expect(status).toContain('could not be saved');
    const onDisk = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    expect(onDisk.theme, 'disk was never changed').toBe(bootTheme);
  } finally {
    fs.chmodSync(settingsPath, 0o666);
  }
});

test('when the rollback re-read also fails, the Studio does not keep the unpersisted reset (DEF-638 in the restore path)', async () => {
  const ud = seedProfile('restore-fail', 'dark');
  const settingsPath = path.join(ud, 'settings.json');
  app = await launchApp([], ud);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);

  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: ',', modifiers: ['control'] });
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode: ',', modifiers: ['control'] });
  });
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
  await win.waitForTimeout(300);

  const bootTheme = await win.evaluate(() => document.documentElement.dataset.theme);
  console.log('[tfl1280-rf] boot theme =', bootTheme);

  // Break BOTH the write and the re-read: replace the settings file with a
  // directory (rename onto it fails; reading it is EISDIR -> ok:false).
  fs.rmSync(settingsPath);
  fs.mkdirSync(settingsPath);
  try {
    await win.locator('[data-prefs-restore-defaults]').click();
    await win.waitForSelector('[data-confirm-dialog]', { timeout: 8000 });
    await win.locator('[data-confirm-dialog-action="confirm"]').click();
    await win.waitForSelector('[data-confirm-dialog]', { state: 'hidden', timeout: 8000 });
    await expect
      .poll(
        () => win.locator('[data-prefs-persist-status]').innerText(),
        { timeout: 8000 },
      )
      .toContain('could not be saved');
    // The rollback hook applies the fallback only after the failed re-read
    // rejects, so poll for the dropped value instead of sampling once (the
    // status line appears synchronously, the re-read is async).
    await expect
      .poll(
        () => win.evaluate(() => document.documentElement.dataset.theme),
        { timeout: 8000 },
      )
      .toBe(bootTheme);
    const theme = await win.evaluate(() => document.documentElement.dataset.theme);
    console.log('[tfl1280-rf] theme after double failure =', theme, '(last confirmed =', bootTheme + ')');
    // DEF-638: the UI must drop the value that never persisted and fall back to
    // the last confirmed snapshot - which here is the boot theme.
    expect(theme, 'UI falls back to the last confirmed theme').toBe(bootTheme);
  } finally {
    fs.rmSync(settingsPath, { recursive: true, force: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        theme: bootTheme,
        themeDefault: bootTheme,
        geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false },
        recentFiles: [],
        recentsCap: 10,
      }),
    );
  }
});
