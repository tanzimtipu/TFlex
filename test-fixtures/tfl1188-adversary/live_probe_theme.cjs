// TFL-1188 adversary live probe — AR-08 theme persistence residue.
//
// Proves the documented AR-08 residue (`theme=light, themeDefault=dark`) is
// STILL produced by the shipped Toggle Theme command, so Preferences shows a
// theme that disagrees with the effective theme. Product code is read-only.
//
// Run:  node test-fixtures/tfl1188-adversary/live_probe_theme.cjs
delete process.env.ELECTRON_RUN_AS_NODE;

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require(path.resolve(__dirname, '..', '..', 'e2e', 'lib', 'launch.cjs'));
const {
  hardClose,
  shot,
  openPreferences,
  toggleThemeViaAppMenu,
} = require(path.resolve(__dirname, '..', '..', 'e2e', 'lib', 'helpers.cjs'));

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

function readSettings(dir) {
  const p = path.join(dir, 'settings.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return { parseError: String(e) };
  }
}

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'tfl1188-theme-'));
  let app = null;
  try {
    app = await launchApp([], userData);
    const win = await app.firstWindow();
    await win.waitForSelector('.welcome', { timeout: 30000 });
    await win.waitForTimeout(800);

    const version = await app.evaluate(({ app: a }) => a.getVersion());
    const scaling = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().scaleFactor);
    console.log(`[tfl1188-theme] version=${version} scaleFactor=${scaling}`);
    console.log(`[tfl1188-theme] userData=${userData}`);

    await openPreferences(win);
    const initial = await win.evaluate(() => ({
      select: document.querySelector('[data-prefs-theme-default]').value,
      live: document.documentElement.dataset.theme,
    }));
    console.log(`[tfl1188-theme] initial select=${initial.select} live=${initial.live}`);

    await win.selectOption('[data-prefs-theme-default]', 'dark');
    await win.waitForTimeout(600);
    const afterPick = await win.evaluate(() => ({
      select: document.querySelector('[data-prefs-theme-default]').value,
      live: document.documentElement.dataset.theme,
    }));
    console.log(`[tfl1188-theme] afterPick select=${afterPick.select} live=${afterPick.live}`);
    console.log(`[tfl1188-theme] settings.json after Pick=${JSON.stringify(readSettings(userData))}`);

    await win.click('[data-prefs-dialog] .sheet-close');
    await win.waitForSelector('[data-prefs-dialog]', { state: 'hidden' });
    await win.waitForTimeout(300);

    // The shipped View > Toggle Theme route (the app-menu row).
    await toggleThemeViaAppMenu(win);
    await win.waitForTimeout(400);
    const afterToggle = await win.evaluate(() => ({
      live: document.documentElement.dataset.theme,
    }));
    const persisted = readSettings(userData);
    console.log(`[tfl1188-theme] afterToggle live=${afterToggle.live}`);
    console.log(`[tfl1188-theme] PERSISTED theme=${persisted && persisted.theme} themeDefault=${persisted && persisted.themeDefault}`);

    await openPreferences(win);
    const reopened = await win.evaluate(() => ({
      select: document.querySelector('[data-prefs-theme-default]').value,
      live: document.documentElement.dataset.theme,
    }));
    console.log(`[tfl1188-theme] reopened Preferences select=${reopened.select} live=${reopened.live}`);

    await shot(win, 'adv-243-theme-residue.png');
    console.log(
      `[tfl1188-theme] VERDICT residue=${persisted && persisted.theme !== persisted.themeDefault}` +
        ` (select=${reopened.select}, live=${reopened.live})`,
    );
  } finally {
    if (app) await hardClose(app, 'tfl1188-theme');
  }
})().catch((e) => {
  console.error('[tfl1188-theme] FATAL', e);
  process.exit(1);
});
