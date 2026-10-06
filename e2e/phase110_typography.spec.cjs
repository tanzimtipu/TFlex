// Phase 110 (chunk D) focused QA verification - the "Quiet Precision" typography
// overhaul, verified on the RUNNING Electron app.
//
// Launched ONLY through the canonical e2e/lib/launch.cjs `launchApp` helper.
//
// Proves, on the real app:
//   1. the UI font stack (computed on <body>) is Segoe UI Variable first, NOT Inter;
//   2. the named helper element `.welcome-sub` computes to the DEF-594 light
//      Home-hero ink (#556070) and #929BAC (dark) - the semantic supporting role;
//   3. `.page-total` / `.zoom-percent` carry tabular figures while a prose/filename
//      element (`.recent-row .doc-path`) stays proportional;
//   4. light/dark screenshots of Home, the editor chrome, the right panel, a dialog
//      and the command palette, plus a 200% DPI pass;
//   5. CONTROL-INDEX + blast-radius: the migrated surfaces have no no-op and no
//      changed handler (zoom readout acts, the Preferences dialog opens, the
//      command palette opens).
//
// The 200% DPI capture uses the Chromium switch `--force-device-scale-factor=2`
// passed through launchApp's `extraArgs` (the launch helper takes no behaviour
// option object); that is Electron's device-scale-factor mechanism. The retired
// `[data-theme-toggle]` control (Phase 105/109 relocated it into the app menu) is
// not used: the theme is set on `<html data-theme>`, the same paint path every
// theme rule keys on (established precedent: phase106_home_orbit.spec.cjs).
//
// Read-only over product code. Writes only e2e/ and screenshots/.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

// The harness exports ELECTRON_RUN_AS_NODE=1; launchApp spreads process.env, so
// Electron would exit as Node. Clear it (same adaptation phase100 uses).
delete process.env.ELECTRON_RUN_AS_NODE;

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, `phase110-${name}.png`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let app = null;
let win = null;
test.setTimeout(420000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p110-typography');
  app = null;
  win = null;
});

async function setTheme(theme) {
  await win.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await win.waitForFunction((t) => document.documentElement.getAttribute('data-theme') === t, theme, { timeout: 8000 });
  await sleep(400);
}

async function setFixedSize(w, h) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (!bw) return;
    try { bw.unmaximize(); } catch (_) { /* ignore */ }
    bw.setContentSize(size.w, size.h);
  }, { w, h });
  await sleep(500);
}

// Read one computed CSS property off the first match of `selector`.
async function cs(selector, prop) {
  return win.evaluate(([s, p]) => {
    const el = document.querySelector(s);
    return el ? getComputedStyle(el).getPropertyValue(p).trim() : null;
  }, [selector, prop]);
}

async function openReport() {
  const p = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
  }, p);
  await win.locator('[data-home-tool="open"]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await sleep(900);
}

// ---------------------------------------------------------------------------
// P110-A - the requested assertions + CONTROL-INDEX / blast-radius neighbour.
// ---------------------------------------------------------------------------
test('P110-A Segoe UI UI stack, supporting-text role colour, tabular readouts, proportional prose', async () => {
  const checks = [];
  const record = (name, ok, detail = '') => {
    checks.push({ name, ok, detail });
    console.log(`[P110-A] ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
  };

  // (1) UI font stack on <body> - first family is Segoe UI Variable / Segoe UI,
  // never Inter.
  const family = await cs('body', 'font-family');
  const first = String(family || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
  record('body font-family first family is Segoe UI', /^Segoe UI( Variable)?$/.test(first), `family=${family}`);
  record('body font-family is not Inter-first', !/inter/i.test(first), `first=${first}`);
  const typeFamily = await win.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--type-family').trim());
  record('--type-family is the Segoe stack', /Segoe UI Variable/.test(typeFamily), `--type-family=${typeFamily}`);

  // (2) supporting-text colour by semantic role, light then dark. On Home the
  // only `.welcome-sub` is inside the hero; DEF-594 / ADV-224 scopes the LIGHT
  // hero to --fg-muted #556070 so it clears 4.5:1 on --bg-sunken (#e4e9ef),
  // while dark keeps the global --tf-text-supporting #929BAC.
  await setTheme('light');
  const lightColor = await cs('.welcome-sub', 'color');
  record('.welcome-sub light hero = #556070 (DEF-594 ink)', lightColor === 'rgb(85, 96, 112)', `color=${lightColor}`);
  await setTheme('dark');
  const darkColor = await cs('.welcome-sub', 'color');
  record('.welcome-sub dark = #929BAC', darkColor === 'rgb(146, 155, 172)', `color=${darkColor}`);
  await setTheme('light');

  // (3) tabular figures on the numeric readouts; proportional on prose/filename.
  await openReport();
  const pageTotal = await cs('.page-total', 'font-variant-numeric');
  record('.page-total tabular-nums', /tabular-nums/.test(String(pageTotal)), `page-total=${pageTotal}`);
  const zoomPct = await cs('.zoom-percent', 'font-variant-numeric');
  record('.zoom-percent tabular-nums', /tabular-nums/.test(String(zoomPct)), `zoom-percent=${zoomPct}`);

  // (4) CONTROL-INDEX / blast-radius neighbour: the migrated zoom readout is a
  // real control, not a no-op - pressing Zoom in must change the number.
  if ((await win.locator('[data-inspector-collapse]').count()) > 0) {
    await win.locator('[data-inspector-collapse]').first().click().catch(() => {});
    await sleep(500);
  }
  const zoomLoc = win.locator('.view-strip-view .zoom-percent').first();
  const before = (await zoomLoc.textContent()).trim();
  await win.locator('.view-strip-view [aria-label="Zoom in"]').first().click();
  await sleep(600);
  const after = (await zoomLoc.textContent()).trim();
  record('Zoom in changes .zoom-percent (no no-op)', after !== before, `${before} -> ${after}`);

  // The Preferences dialog (a migrated DialogShell surface) opens from the
  // Stage Rail gear - a real visible control, no changed handler. The 264px
  // Inspector can overlay the rail's right edge, so force the click.
  await win.locator('[data-stage-rail-gear]').first().click().catch(async () => {
    await win.locator('[data-stage-rail-gear]').first().click({ force: true });
  });
  await win.waitForSelector('[data-prefs-dialog]', { state: 'visible', timeout: 8000 });
  record('Preferences dialog opens from the Stage Rail gear', await win.locator('[data-prefs-dialog]').isVisible());
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-prefs-dialog]', { state: 'detached', timeout: 8000 }).catch(() => {});

  // The command palette (migrated hint/footer surface) opens on Ctrl+K.
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette]', { state: 'visible', timeout: 8000 });
  record('Command palette opens on Ctrl+K', await win.locator('[data-command-palette]').isVisible());
  await win.keyboard.press('Escape');

  // (5) prose/filename stays proportional: close the tab to return Home, where
  // the just-opened file is a recent row.
  await win.keyboard.press('Control+w');
  await win.waitForSelector('[data-home-recents]', { timeout: 15000 });
  await win.waitForSelector('.recent-row .doc-path', { timeout: 15000 });
  const docPath = await cs('.recent-row .doc-path', 'font-variant-numeric');
  record('.recent-row .doc-path is proportional', !/tabular-nums/.test(String(docPath)), `doc-path=${docPath}`);

  const failed = checks.filter((c) => !c.ok);
  fs.writeFileSync(path.join(SHOTS, 'phase110-assertions.json'), JSON.stringify(checks, null, 2));
  expect(failed, `failed checks: ${failed.map((f) => `${f.name} [${f.detail}]`).join(' | ') || 'none'}`).toEqual([]);
});

// ---------------------------------------------------------------------------
// P110-B - light/dark screenshots of the five named surfaces.
// ---------------------------------------------------------------------------
test('P110-B capture Home, editor chrome, right panel, dialog and command palette (light/dark)', async () => {
  await setFixedSize(1440, 900);

  // Home.
  await setTheme('light');
  await win.screenshot({ path: shot('home-light') });
  await setTheme('dark');
  await win.screenshot({ path: shot('home-dark') });
  await setTheme('light');

  // Editor chrome: top bar + tabs + siderail + dock + view strip.
  await openReport();
  await win.screenshot({ path: shot('editor-light') });
  await setTheme('dark');
  await win.screenshot({ path: shot('editor-dark') });
  await setTheme('light');

  // Right panel: the always-on Inspector as the workspace's right panel.
  await win.waitForSelector('[data-inspector]', { timeout: 10000 });
  await win.screenshot({ path: shot('panel-light') });
  await setTheme('dark');
  await win.screenshot({ path: shot('panel-dark') });
  await setTheme('light');

  // Dialog: Preferences (a DialogShell surface) via the Stage Rail gear.
  await win.locator('[data-stage-rail-gear]').first().click().catch(async () => {
    await win.locator('[data-stage-rail-gear]').first().click({ force: true });
  });
  await win.waitForSelector('[data-prefs-dialog]', { state: 'visible', timeout: 8000 });
  await sleep(300);
  await win.screenshot({ path: shot('dialog-light') });
  await setTheme('dark');
  await win.screenshot({ path: shot('dialog-dark') });
  await setTheme('light');
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-prefs-dialog]', { state: 'detached', timeout: 8000 }).catch(() => {});
  await sleep(300);

  // Command palette.
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette]', { state: 'visible', timeout: 8000 });
  await sleep(300);
  await win.screenshot({ path: shot('palette-light') });
  await setTheme('dark');
  await win.screenshot({ path: shot('palette-dark') });
  await setTheme('light');
  await win.keyboard.press('Escape');

  for (const n of ['home', 'editor', 'panel', 'dialog', 'palette']) {
    for (const t of ['light', 'dark']) {
      expect(fs.existsSync(shot(`${n}-${t}`)), `${n}-${t} screenshot written`).toBe(true);
    }
  }
});

// ---------------------------------------------------------------------------
// P110-C - 200% DPI capture (Chromium --force-device-scale-factor=2 via launchApp
// extraArgs). A separate launch so the firstWindow is created at 2x.
// ---------------------------------------------------------------------------
test('P110-C capture Home and editor chrome at 200% DPI', async () => {
  // The beforeEach launch is the 100% app; close it and relaunch at 2x so the
  // device scale factor is applied at window creation.
  await hardClose(app, 'p110-typography-1x');
  app = await launchApp(['--force-device-scale-factor=2']);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await sleep(400);

  const scale = await win.evaluate(() => window.devicePixelRatio);
  console.log(`[P110-C] devicePixelRatio=${scale}`);

  await setFixedSize(1280, 800);
  await setTheme('light');
  await win.screenshot({ path: shot('home-200dpi') });
  await openReport();
  await win.screenshot({ path: shot('editor-200dpi') });
  await setTheme('dark');
  await win.screenshot({ path: shot('editor-200dpi-dark') });

  expect(fs.existsSync(shot('home-200dpi')), 'home-200dpi screenshot written').toBe(true);
  expect(fs.existsSync(shot('editor-200dpi')), 'editor-200dpi screenshot written').toBe(true);
});

// ---------------------------------------------------------------------------
// P110-D (item 2) - the ACTUAL rendered (composited) contrast of the two
// Home-hero supporting labels in light / dark / frosted.
//
// The DEF-594 fix is light-only, so in frosted the labels ride the global
// --tf-text-supporting (#667085). The frosted Home paints translucent white
// films (.welcome 0.42, .welcome-hero 0.62) over the ambient/base, so the text's
// RENDERED surface is the light composite, not the raw --bg-sunken token. Two
// independent measurements are taken:
//   A. the rendered pixels (Electron capturePage) - the real on-screen composite
//      including the frosted ambient; the dominant colour in a patch around the
//      label is the flat background (antialiased glyphs are a small minority);
//   B. the CSS ancestor background chain (the phase96 precedent) composited in
//      Node. The assertion uses A (the actual rendered surface).
// ---------------------------------------------------------------------------

function p110ParseRgb(str) {
  const m = String(str).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((x) => parseFloat(x.trim()));
  return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
}
const p110Chan = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const p110Lum = (c) => 0.2126 * p110Chan(c.r) + 0.7152 * p110Chan(c.g) + 0.0722 * p110Chan(c.b);
const p110Ratio = (a, b) => {
  const l1 = p110Lum(a), l2 = p110Lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
function p110Composite(fg, bg) {
  const a = fg.a;
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}

// B. CSS ancestor background chain (root -> element) composited over the page base.
async function p110ChainSurface(selector) {
  const chain = await win.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(',').map((v) => parseFloat(v.trim()));
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    };
    const out = [];
    let n = el;
    while (n && n.nodeType === 1) {
      const rgba = parse(getComputedStyle(n).backgroundColor);
      if (rgba && rgba[3] > 0) out.unshift(rgba);
      n = n.parentElement;
    }
    return out;
  }, selector);
  if (!chain) throw new Error(`no chain for ${selector}`);
  let bg = { r: 255, g: 255, b: 255, a: 1 };
  for (const c of chain) bg = p110Composite({ r: c[0], g: c[1], b: c[2], a: c[3] }, bg);
  return bg;
}

// A. Real rendered pixels around `selector`, via Electron capturePage. The
// dominant colour of the patch is the flat background behind the glyphs.
async function p110RenderedSurface(selector, expand = 5) {
  await win.locator(selector).first().scrollIntoViewIfNeeded().catch(() => {});
  await sleep(250);
  const box = await win.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no bounding box for ${selector}`);
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(0, Math.floor(box.x - expand));
  const y = Math.max(0, Math.floor(box.y - expand));
  const rect = {
    x,
    y,
    width: Math.max(2, Math.min(Math.ceil(box.width + expand * 2), vp.w - x)),
    height: Math.max(2, Math.min(Math.ceil(box.height + expand * 2), vp.h - y)),
  };
  const shot = await app.evaluate(async ({ BrowserWindow }, r) => {
    const bw = BrowserWindow.getAllWindows()[0];
    const img = await bw.webContents.capturePage(r);
    const size = img.getSize();
    return { width: size.width, height: size.height, data: Array.from(img.toBitmap()) };
  }, rect);
  const counts = new Map();
  const d = shot.data; // BGRA
  for (let i = 0; i < d.length; i += 4) {
    const key = `${d[i + 2]},${d[i + 1]},${d[i]}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let bestKey = null, bestN = -1;
  for (const [k, n] of counts) if (n > bestN) { bestN = n; bestKey = k; }
  const [r, g, b] = bestKey.split(',').map(Number);
  return { rgb: { r, g, b, a: 1 }, pixels: bestN, total: shot.width * shot.height };
}

test('P110-D Home-hero supporting labels clear 4.5:1 on the ACTUAL composited surface (light/dark/frosted)', async () => {
  await setFixedSize(1440, 900);
  const targets = ['.welcome-sub', '.welcome-section h3 .count'];
  const themes = ['light', 'dark', 'frosted'];
  const rows = [];

  for (const theme of themes) {
    await setTheme(theme);
    for (const sel of targets) {
      const ink = p110ParseRgb(await cs(sel, 'color'));
      const rendered = await p110RenderedSurface(sel);
      const cssSurface = await p110ChainSurface(sel);
      const renderedRatio = p110Ratio(ink, rendered.rgb);
      const cssRatio = p110Ratio(ink, cssSurface);
      rows.push({
        theme,
        selector: sel,
        ink,
        renderedSurface: rendered.rgb,
        renderedRatio: Number(renderedRatio.toFixed(2)),
        cssSurface,
        cssRatio: Number(cssRatio.toFixed(2)),
        modePixels: rendered.pixels,
        patchTotal: rendered.total,
      });
      console.log(
        `[P110-D] ${theme} ${sel} ink=rgb(${ink.r},${ink.g},${ink.b}) ` +
        `rendered=rgb(${rendered.rgb.r},${rendered.rgb.g},${rendered.rgb.b}) ` +
        `ratio=${renderedRatio.toFixed(2)} (css-chain ${cssRatio.toFixed(2)}, mode ${rendered.pixels}/${rendered.total})`,
      );
    }
    if (theme === 'frosted') await win.screenshot({ path: shot('home-frosted') });
  }
  fs.writeFileSync(path.join(SHOTS, 'phase110-hero-contrast.json'), JSON.stringify(rows, null, 2));

  const failed = rows.filter((r) => r.renderedRatio < 4.5);
  expect(
    failed,
    `below 4.5:1 on the rendered surface: ${failed.map((f) => `${f.theme} ${f.selector} ${f.renderedRatio}`).join(' | ') || 'none'}`,
  ).toEqual([]);
});


