// Phase 100 (chunk 5 / feature E) — focused QA verification: prove the Phase 100
// foundation is real and that theming flows through it.
//
// Launched ONLY through the canonical e2e/lib/launch.cjs `launchApp`.
//
// For each of light / dark / frosted it proves:
//   (a) the theme flips on <html data-theme> through the REAL theme control
//       (mirrors the phase96 setTheme helper);
//   (b) a representative chrome set (.titlebar, .toolbar, the left rail,
//       an open dialog and a toast) has theme-dependent computed colours —
//       the resolved backgroundColor/color differ between light and dark;
//   (c) the chunk C/D retrofits BIND to tokens: a real element's
//       borderRadius / boxShadow / fontSize is compared against the LIVE token
//       value read via getComputedStyle(document.documentElement) so the
//       assertion proves binding, not a hardcoded number.
// Plus 3-theme screenshots of the welcome screen and one open bundled sample,
// a visual-judgment pass, and the mandatory blast-radius neighbour specs.
//
// Read-only over product code. Writes only e2e/, screenshots/ and DEFECTS.md.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

// The harness exports ELECTRON_RUN_AS_NODE=1; launchApp spreads process.env, so
// Electron would exit as Node. Clear it (same adaptation phase96 uses).
delete process.env.ELECTRON_RUN_AS_NODE;

const OUT = path.join(__dirname, '..', 'screenshots', 'phase100');
fs.mkdirSync(OUT, { recursive: true });
const THEMES = ['light', 'dark', 'frosted'];
const UNSUPPORTED = path.join(__dirname, '..', 'test-fixtures', 'phase53', 'unknown.xyz');
test.setTimeout(720000);

const log = (...a) => console.log('[P100]', ...a);
const shotPath = (name, theme) => path.join(OUT, `${name}-${theme}.png`);

async function setTheme(win, theme) {
  await win.keyboard.press('Escape').catch(() => {});
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 8000 });
  await win.click(`[data-theme-option="${theme}"]`);
  await win.waitForFunction((t) => document.documentElement.getAttribute('data-theme') === t, theme, { timeout: 8000 });
  await win.waitForTimeout(450);
}

async function setFixedSize(app, w, h) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    try { win.unmaximize(); } catch (_) { /* ignore */ }
    win.setContentSize(size.w, size.h);
  }, { w, h });
  await new Promise((r) => setTimeout(r, 400));
}

// Read the computed chrome properties + the resolved token for a selector set.
async function sampleSurfaces(win, selectors) {
  return win.evaluate((sels) => {
    const out = {};
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) { out[sel] = { present: false }; continue; }
      const cs = getComputedStyle(el);
      out[sel] = {
        present: true,
        backgroundColor: cs.backgroundColor,
        color: cs.color,
        backgroundImage: cs.backgroundImage,
        borderRadius: cs.borderRadius,
        boxShadow: cs.boxShadow,
        fontSize: cs.fontSize,
      };
    }
    return out;
  }, selectors);
}

// Read a live CSS custom-property value off <html>.
async function liveToken(win, name) {
  return win.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);
}

// Resolve elevation-3 to a concrete box-shadow string via a probe element.
async function resolvedElevation3(win) {
  return win.evaluate(() => {
    const d = document.createElement('div');
    d.style.boxShadow = 'var(--elevation-3)';
    document.body.appendChild(d);
    const v = getComputedStyle(d).boxShadow;
    d.remove();
    return v;
  });
}

function outerShadow(shadow) {
  return shadow
    .split(/,\s*(?=[a-z]+\()/)
    .map((l) => l.trim())
    .filter((l) => !/\binset\b/.test(l))
    .join(', ');
}

async function openReport(win, app) {
  const p = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
  }, p);
  await win.locator('[data-home-tool="open"]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(700);
}

async function openPrefs(win) {
  await win.locator('[data-open-preferences]').first().click({ timeout: 10000 });
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 8000 });
  await win.waitForTimeout(400);
}

async function closePrefs(win) {
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-prefs-dialog]', { state: 'detached', timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(300);
}

// Open the File menu and return the popover's radius binding info.
async function openFileMenu(win) {
  await win.keyboard.press('Escape').catch(() => {});
  await win.locator('[data-menu-button]').first().click({ timeout: 8000 });
  await win.waitForSelector('.titlebar-menu-popover', { state: 'visible', timeout: 8000 });
  await win.waitForTimeout(250);
}

async function closeFileMenu(win) {
  await win.keyboard.press('Escape').catch(() => {});
  await win.waitForSelector('.titlebar-menu-popover', { state: 'detached', timeout: 6000 }).catch(() => {});
  await win.waitForTimeout(250);
}

// Trigger a real error toast: route the File > Open action at an unsupported
// fixture through the shipped open path (the main dialog is stubbed).
async function triggerToast(win, app) {
  await app.evaluate(async ({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
  }, UNSUPPORTED);
  await openFileMenu(win);
  await win.locator('[data-menu-action="open"]').first().click({ timeout: 8000 });
  await win.waitForSelector('.toast', { state: 'visible', timeout: 10000 });
  await win.waitForTimeout(300);
}

async function clearToasts(win) {
  for (let i = 0; i < 6; i += 1) {
    const n = await win.locator('.toast').count();
    if (n === 0) break;
    await win.locator('.toast-close').first().click({ timeout: 2000 }).catch(() => {});
    await win.waitForTimeout(200);
  }
  await win.waitForTimeout(200);
}

test('Phase 100 — foundation binding + 3-theme theming proof', async () => {
  const userData = path.join(os.tmpdir(), `tflex-p100-${Date.now()}`);
  const app = await launchApp([], userData);
  const win = await app.firstWindow();
  const checks = [];
  const record = (name, ok, detail = '') => {
    checks.push({ name, ok, detail });
    log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
  };

  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await setFixedSize(app, 1440, 900);

    const chromeSamples = {}; // theme -> selector -> props
    const railSelectorUsed = {}; // theme -> selector actually used for the rail

    // ---- Pass A: welcome screen in all three themes ------------------------
    for (const theme of THEMES) {
      await setTheme(win, theme);
      const attr = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
      record(`(a) ${theme}: <html data-theme> flips via the real control`, attr === theme, `data-theme=${attr}`);
      await win.screenshot({ path: shotPath('welcome', theme) });
      log(`welcome screenshot ${shotPath('welcome', theme)}`);
    }

    // ---- open the bundled sample once --------------------------------------
    await openReport(win, app);

    // ---- Pass B: document chrome in all three themes -----------------------
    for (const theme of THEMES) {
      await setTheme(win, theme);

      // Resolve the left-rail surface actually rendered: the task names
      // `.side-rail` OR `.tools-palette`; fall back to the ContextPanel rail
      // if neither legacy surface is mounted in single mode.
      const railSel = await win.evaluate(() => {
        if (document.querySelector('.side-rail')) return '.side-rail';
        if (document.querySelector('.tools-palette')) return '.tools-palette';
        if (document.querySelector('[data-context-panel]')) return '[data-context-panel]';
        return null;
      });
      railSelectorUsed[theme] = railSel;
      // `.toolbar` (the legacy CommandBar) is retired in single mode; the top
      // command bar is `.app-header`. Sample both and use `.app-header` for the
      // theme-dependent colour proof while logging the legacy surface's absence.
      const sels = ['.titlebar', '.toolbar', '.app-header', '.brand'];
      if (railSel) sels.push(railSel);

      const surfaces = await sampleSurfaces(win, sels);
      chromeSamples[theme] = surfaces;
      log(`chrome ${theme}: ${JSON.stringify(surfaces)}`);
      record(`(b) ${theme}: chrome surfaces resolvable`, surfaces['.titlebar'].present && surfaces['.app-header'].present, `rail=${railSel} legacyToolbar=${surfaces['.toolbar'].present}`);

      // (c1) radius binding — the File popover family's ONE corner token is
      // --radius-3 in every theme. The popover joins the trigger while open
      // (top-left 0), so read the two corners that keep the token.
      await openFileMenu(win);
      const radius3 = await liveToken(win, '--radius-3');
      const pop = await win.evaluate(() => {
        const cs = getComputedStyle(document.querySelector('.titlebar-menu-popover'));
        return { shorthand: cs.borderRadius, tr: cs.borderTopRightRadius, bl: cs.borderBottomLeftRadius };
      });
      log(`radius binding ${theme}: element=${JSON.stringify(pop)} token(--radius-3)=${radius3}`);
      record(`(c-radius) ${theme}: .titlebar-menu-popover binds --radius-3`, pop.tr === radius3 && pop.bl === radius3, `${pop.shorthand} tr=${pop.tr} bl=${pop.bl} vs ${radius3}`);
      await closeFileMenu(win);

      // (c2) elevation binding — the prefs dialog sheet resolves --elevation-3.
      await openPrefs(win);
      const dlgColours = await sampleSurfaces(win, ['[data-prefs-dialog]']);
      const elev3 = await resolvedElevation3(win);
      const dlgShadow = await win.evaluate(() => {
        const el = document.querySelector('[data-prefs-dialog]');
        const sheet = el.closest('[data-dialog-shell]') || el;
        return getComputedStyle(sheet).boxShadow;
      });
      log(`elevation binding ${theme}: dialog=${dlgShadow} token=${elev3}`);
      record(`(c-elevation) ${theme}: dialog resolves --elevation-3`, outerShadow(dlgShadow) === elev3, `${outerShadow(dlgShadow)} vs ${elev3}`);
      // Keep the dialog in the chrome sample set for the colour comparison.
      chromeSamples[theme]['[data-prefs-dialog]'] = dlgColours['[data-prefs-dialog]'];
      await win.screenshot({ path: shotPath('dialog', theme) });
      await closePrefs(win);

      // (c3) font-size binding — .brand uses var(--fs-md).
      const fsMd = await liveToken(win, '--fs-md');
      const brandFs = await win.evaluate(() => getComputedStyle(document.querySelector('.brand')).fontSize);
      log(`font binding ${theme}: element=${brandFs} token(--fs-md)=${fsMd}`);
      record(`(c-font) ${theme}: .brand binds --fs-md`, brandFs === fsMd, `${brandFs} vs ${fsMd}`);

      // (b) toast — a real error toast is part of the chrome set.
      await triggerToast(win, app);
      const toastSamples = await sampleSurfaces(win, ['.toast']);
      chromeSamples[theme]['.toast'] = toastSamples['.toast'];
      log(`toast ${theme}: ${JSON.stringify(toastSamples['.toast'])}`);
      await win.screenshot({ path: shotPath('toast', theme) });
      await clearToasts(win);

      await win.screenshot({ path: shotPath('open-sample', theme) });
      log(`open-sample screenshot ${shotPath('open-sample', theme)}`);
    }

    // ---- (b) theme-dependent colours: light vs dark must differ -------------
    const named = ['.titlebar', '.app-header', '[data-prefs-dialog]', '.toast'];
    for (const sel of named) {
      const l = chromeSamples.light[sel];
      const d = chromeSamples.dark[sel];
      const differs = !!l && !!d && l.present && d.present
        && (l.backgroundColor !== d.backgroundColor || l.color !== d.color);
      record(`(b) ${sel}: backgroundColor/color differ light vs dark`, differs,
        `light bg=${l.backgroundColor} fg=${l.color} | dark bg=${d.backgroundColor} fg=${d.color}`);
    }
    // The rail surface as actually rendered.
    for (const theme of THEMES) {
      const sel = railSelectorUsed[theme];
      if (sel && chromeSamples[theme][sel]) {
        chromeSamples[theme]['__rail__'] = chromeSamples[theme][sel];
      }
    }
    {
      const l = chromeSamples.light['__rail__'];
      const d = chromeSamples.dark['__rail__'];
      const differs = !!l && !!d && l.present && d.present
        && (l.backgroundColor !== d.backgroundColor || l.color !== d.color);
      record(`(b) left rail (${railSelectorUsed.light}): backgroundColor/color differ light vs dark`, differs,
        `light bg=${l && l.backgroundColor} | dark bg=${d && d.backgroundColor}`);
    }

    const failed = checks.filter((c) => !c.ok);
    log(`RESULTS ${JSON.stringify(checks)}`);
    expect(failed, `failed checks: ${failed.map((f) => `${f.name} [${f.detail}]`).join(' | ') || 'none'}`).toEqual([]);
  } finally {
    await hardClose(app, 'p100');
  }
});
