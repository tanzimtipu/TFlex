// TFL-1183 — QA focused live verification for TFL-1182 chunk C:
//   AR-07 token-specific range error, AR-08 theme state coherence,
//   AR-09 Animations wording.
// Drives the REAL Electron app through the canonical launchApp helper.
delete process.env.ELECTRON_RUN_AS_NODE;

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, openPreferences, runTool, toggleThemeViaAppMenu } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (n) => path.join(SHOTS, n);

const ANIM_LABEL = 'Enable animations';
const ANIM_HINT =
  'When off, menus, panels, dialogs and page changes appear without transition animations.';

let app = null;
let win = null;
test.setTimeout(300000);

function freshDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `tfl1183-${tag}-`));
}

async function openReport() {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(800);
}

function readSettings(settingsPath) {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1183');
  app = null;
  win = null;
});

// ---------------------------------------------------------------------------
// AR-07 — the Extract (split) dialog range field names the token AND the range.
// ---------------------------------------------------------------------------
test('AR-07: the Extract dialog range field names the offending token AND the 1-34 bound', async () => {
  app = await launchApp([], freshDir('ar07'));
  win = await app.firstWindow();
  await openReport();
  await runTool(win, 'extract');
  await win.waitForSelector('#split-page-range', { timeout: 10000 });
  await win.waitForTimeout(300);

  const cases = ['999', '0', '1-999', '1-3,999', '', 'abc', '9-2', '1-3'];
  const results = [];
  for (const v of cases) {
    await win.fill('#split-page-range', v);
    await win.waitForTimeout(220);
    const r = await win.evaluate(() => {
      const s = document.querySelector('#split-range-status');
      const inp = document.querySelector('#split-page-range');
      const btn = document.querySelector('[data-dialog-action="confirm"]');
      return {
        text: s === null ? null : (s.textContent || '').trim(),
        state: s === null ? null : s.getAttribute('data-range-state'),
        value: inp === null ? null : inp.value,
        disabled: btn === null ? null : btn.disabled,
      };
    });
    results.push({ input: v, ...r });
    if (v === '999') await win.screenshot({ path: shot('tfl1183_ar07_extract_999.png') });
  }
  console.log(`[tfl1183] AR-07 results=${JSON.stringify(results)}`);

  const byInput = (v) => results.find((r) => r.input === v);
  const OOB_999 = "Page 999 is outside the document's 1-34 pages.";
  const EMPTY = 'Enter at least one page (e.g. 1-3).';
  const MALFORMED = 'Enter pages like 1-3 or 2,4.';

  for (const v of ['999', '0', '1-999', '1-3,999']) {
    const c = byInput(v);
    expect(c.state, `AR-07 "${v}" classified out-of-bounds`).toBe('out-of-bounds');
    expect(c.value, `AR-07 "${v}" input preserved`).toBe(v);
    expect(c.disabled, `AR-07 "${v}" Extract disabled`).toBe(true);
  }
  expect(byInput('999').text, 'AR-07 999 names token + 1-34 bound').toBe(OOB_999);
  expect(byInput('0').text, 'AR-07 0 names token + 1-34 bound').toBe(
    "Page 0 is outside the document's 1-34 pages.",
  );
  expect(byInput('1-999').text, 'AR-07 1-999 names the out-of-range end').toBe(OOB_999);
  expect(byInput('1-3,999').text, 'AR-07 1-3,999 names the out-of-range token').toBe(OOB_999);
  expect(byInput('').text, 'AR-07 empty wording unchanged').toBe(EMPTY);
  expect(byInput('abc').text, 'AR-07 malformed wording unchanged (abc)').toBe(MALFORMED);
  expect(byInput('9-2').text, 'AR-07 malformed wording unchanged (9-2)').toBe(MALFORMED);
  expect(byInput('1-3').disabled, 'AR-07 valid range enables Extract').toBe(false);
});

// ---------------------------------------------------------------------------
// AR-08 — theme state coherence. The on-disk write is the PRIMARY evidence.
// ---------------------------------------------------------------------------
test('AR-08: a Dark pick writes theme=dark AND themeDefault=dark on disk; relaunch', async () => {
  const dir = freshDir('ar08');
  const settingsPath = path.join(dir, 'settings.json');

  app = await launchApp([], dir);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openPreferences(win);
  const initialDefault = await win.locator('[data-prefs-theme-default]').inputValue();
  console.log(`[tfl1183] AR-08 initial themeDefault dropdown=${initialDefault}`);

  await win.selectOption('[data-prefs-theme-default]', 'dark');

  // Poll the running settings file, recording every distinct (theme,themeDefault)
  // pair seen, so a stale `theme=light` residue would show up.
  const seen = [];
  let parsed = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 3000) {
    parsed = readSettings(settingsPath);
    if (parsed) {
      const key = `${parsed.theme}/${parsed.themeDefault}`;
      if (!seen.includes(key)) seen.push(key);
      if (parsed.theme === 'dark' && parsed.themeDefault === 'dark') break;
    }
    await win.waitForTimeout(60);
  }
  const settled = () => win.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    htmlBg: getComputedStyle(document.documentElement).backgroundColor,
  }));
  // The live apply settles a beat after the write; poll for the settled value.
  let applied = await settled();
  const tApp = Date.now();
  while (applied.theme !== 'dark' && Date.now() - tApp < 4000) {
    await win.waitForTimeout(120);
    applied = await settled();
  }
  console.log(`[tfl1183] AR-08 applied=${JSON.stringify(applied)} onDisk=${JSON.stringify(parsed)} distinctWrites=${JSON.stringify(seen)}`);
  await win.waitForTimeout(700);
  const settledVisual = await win.evaluate(() => {
    const hdr = document.querySelector('.titlebar, .app-header, header');
    const dlg = document.querySelector('[data-prefs-dialog]');
    return {
      headerBg: hdr === null ? null : getComputedStyle(hdr).backgroundColor,
      dialogBg: dlg === null ? null : getComputedStyle(dlg).backgroundColor,
      htmlTheme: document.documentElement.dataset.theme,
    };
  });
  console.log(`[tfl1183] AR-08 settledVisual=${JSON.stringify(settledVisual)}`);
  await win.screenshot({ path: shot('tfl1183_ar08_prefs_dark.png') });

  expect(applied.theme, 'AR-08 the Dark pick applies the dark theme immediately').toBe('dark');
  expect(parsed && parsed.theme, 'AR-08 on-disk settings.theme is dark').toBe('dark');
  expect(parsed && parsed.themeDefault, 'AR-08 on-disk settings.themeDefault is dark').toBe('dark');
  for (const key of seen) {
    expect(key.split('/')[0], `AR-08 no stale non-dark theme write (saw ${key})`).toBe('dark');
  }

  await hardClose(app, 'ar08-first');
  app = null;
  await new Promise((r) => setTimeout(r, 2500));

  // Relaunch the SAME profile and confirm it starts dark.
  app = await launchApp([], dir);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const boot = await win.evaluate(() => ({ theme: document.documentElement.dataset.theme }));
  const seededRecents = await win.locator('[data-recent-row]').count();
  const onDisk2 = readSettings(settingsPath);
  console.log(`[tfl1183] AR-08 relaunch boot=${JSON.stringify(boot)} recents=${seededRecents} onDisk=${JSON.stringify(onDisk2)}`);
  await win.screenshot({ path: shot('tfl1183_ar08_relaunch.png') });
  expect(boot.theme, 'AR-08 the persisted dark theme is in effect on relaunch').toBe('dark');

  // Regression: the View > Toggle Theme command still cycles the live theme.
  await toggleThemeViaAppMenu(win);
  const toggled = await win.evaluate(() => document.documentElement.dataset.theme);
  console.log(`[tfl1183] AR-08 after Toggle Theme command: ${toggled}`);
  expect(toggled, 'AR-08 Toggle Theme command advances the theme (dark -> light)').toBe('light');
});

// ---------------------------------------------------------------------------
// AR-09 — Animations wording: exact label + hint, and unchecked = setting off.
// ---------------------------------------------------------------------------
test('AR-09: Enable animations label/hint are exact and unchecked turns the setting off', async () => {
  const dir = freshDir('ar09');
  const settingsPath = path.join(dir, 'settings.json');

  app = await launchApp([], dir);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openPreferences(win);
  await win.waitForTimeout(300);

  const info = await win.evaluate(() => {
    const cb = document.querySelector('#prefs-animations');
    const row = cb === null ? null : cb.closest('.prefs-row');
    return {
      checked: cb === null ? null : cb.checked,
      label: row === null ? null : row.querySelector('.prefs-row-label').textContent.trim(),
      hint: row === null ? null : row.querySelector('.prefs-hint').textContent.trim(),
      docAnims: document.documentElement.dataset.animations,
    };
  });
  console.log(`[tfl1183] AR-09 row=${JSON.stringify(info)}`);
  await win.screenshot({ path: shot('tfl1183_ar09_animations_row.png') });

  expect(info.label, 'AR-09 label is exactly "Enable animations"').toBe(ANIM_LABEL);
  expect(info.hint, 'AR-09 hint is exactly the shipped wording').toBe(ANIM_HINT);
  expect(info.checked, 'AR-09 a fresh profile has animations ON by default').toBe(true);

  // Unchecked = the setting OFF, applied immediately and persisted.
  await win.locator('#prefs-animations').uncheck();
  await expect
    .poll(() => win.evaluate(() => document.documentElement.dataset.animations), { timeout: 5000 })
    .toBe('off');
  let off = null;
  const tOff = Date.now();
  while (Date.now() - tOff < 5000) {
    off = readSettings(settingsPath);
    if (off && off.animationsEnabled === false) break;
    await win.waitForTimeout(120);
  }
  console.log(`[tfl1183] AR-09 after uncheck: data-animations=off, settings.animationsEnabled=${off && off.animationsEnabled}`);
  expect(off && off.animationsEnabled, 'AR-09 unchecking persists animationsEnabled=false').toBe(false);

  // Re-checking turns it back on.
  await win.locator('#prefs-animations').check();
  await expect
    .poll(() => win.evaluate(() => document.documentElement.dataset.animations), { timeout: 5000 })
    .toBe('on');
});

