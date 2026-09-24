// RETEST DEF-191 / DEF-192 / DEF-193 / DEF-194 (qa, Phase 14.2 fix round 2).
// Retests the four defects the Phase-14.2 verification round filed, on the dev
// build rebuilt after the developer's second fix pass:
//   DEF-191  frosted Open button ghost capsule (specificity loss vs the film;
//            Phase-22 repoint: guard becomes one-file-capsule / no legacy Open)
//   DEF-192  Tools panel never pushes the page view (dead --tf-tools-inset)
//   DEF-193  panel + page do not animate together (same dead token)
//   DEF-194  command-bar icons laid out ~14.7px instead of 22px (UA padding)
// Same measurement shapes as e2e/phase14_2_verify.spec.cjs so the numbers are
// directly comparable with the filing runs. Screenshots -> screenshots/def-19*-retest*.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchDev, openSample, hardClose } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

let electronApp = null;
let win = null;
let rendererErrors = [];

async function openReport() {
  ({ electronApp, window: win } = await launchDev());
  rendererErrors = [];
  win.on('pageerror', (err) => rendererErrors.push(`pageerror: ${err.message}`));
  win.on('console', (msg) => {
    if (msg.type() === 'error') rendererErrors.push(`console.error: ${msg.text()}`);
  });
  await openSample(win, electronApp, 'report.pdf');
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await win.waitForTimeout(1800);
}

async function closeApp() {
  await hardClose(electronApp, 'def-191-194-retest');
  electronApp = null;
  win = null;
}

async function setTheme(value) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${value}"]`);
  await win.waitForFunction(
    (v) => document.documentElement.getAttribute('data-theme') === v,
    value,
    { timeout: 5000 },
  );
  await win.waitForTimeout(500);
}

// Phase 36: the right panel is the Inspector, mounted whenever a document is
// open (no toggle affordance — `inspectorOpen` is derived from an open
// document). The retired Tools palette's open/close helpers are gone.

// Geometry snapshot of the page view + panel for one instant.
async function measureView() {
  return win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const wm = document.querySelector('.workspace-main');
    const pal = document.querySelector('[data-inspector]');
    const page = document.querySelector('.tab-pane[aria-hidden="false"] .pdf-page[data-page="1"]');
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top),
        width: Math.round(b.width), height: Math.round(b.height),
      };
    };
    return {
      dataTheme: document.documentElement.getAttribute('data-theme'),
      toolsOpenAttr: document.querySelector('.app-main')?.getAttribute('data-tools-open') ?? null,
      scroller: r(sc),
      scrollerMarginRight: getComputedStyle(sc).marginRight,
      inspector: r(pal),
      page: r(page),
      insetVar: getComputedStyle(wm).getPropertyValue('--tf-tools-inset').trim(),
    };
  });
}

// DEF-191 measurement (Phase 22 repoint 2026-09-19): Open moved out of the
// command bar into the title bar's .titlebar-file group. DEF-191's intent
// (no ghost/duplicate layer behind the accent Open control) is preserved by
// asserting exactly ONE file capsule and no legacy command-bar Open remains.
async function openButtonMetrics() {
  return win.evaluate(() => {
    const g = document.querySelector('.titlebar-file');
    const b = document.querySelector('[data-toolbar-open]');
    if (!g || !b) return null;
    const bs = getComputedStyle(b);
    const bb = b.getBoundingClientRect();
    return {
      dataTheme: document.documentElement.getAttribute('data-theme'),
      groupCount: document.querySelectorAll('.titlebar-file').length,
      legacyCount: document.querySelectorAll('.commandbar-open').length,
      inGroup: g.contains(b),
      groupButtons: g.querySelectorAll('button').length,
      btnBg: bs.backgroundColor,
      btnColor: bs.color,
      btnH: Math.round(bb.height * 100) / 100,
    };
  });
}

test.describe('DEF-191..194 retest (phase 14.2 fix round 2)', () => {
  test.afterEach(async () => {
    expect(rendererErrors, 'no renderer errors during the retest').toEqual([]);
    await hardClose(electronApp, 'def-191-194-retest');
    electronApp = null;
    win = null;
  });

  // ------------------------------------------------------------------
  // DEF-191: frosted Open button must be a clean single layer.
  // ------------------------------------------------------------------
  test('DEF-191: the relocated Open control has no ghost/duplicate layer', async () => {
    test.setTimeout(240000);
    await openReport();
    const m = await openButtonMetrics();
    console.log('[DEF-191] title-bar open button:', JSON.stringify(m));
    await win.screenshot({
      path: path.join(SHOTS, 'def-191-retest.png'),
      clip: { x: 0, y: 0, width: 420, height: 60 },
    });
    expect(m, 'Open button + File group mounted').not.toBeNull();
    expect(m.dataTheme, 'test runs in the frosted theme').toBe('frosted');
    // Phase 22 - Open now sits in the title bar's intentional grouped
    // capsule; the DEF-191 guard becomes "exactly one file capsule, no
    // legacy command-bar ghost".
    expect(m.groupCount, 'DEF-191: exactly ONE file capsule').toBe(1);
    expect(m.legacyCount, 'DEF-191: no legacy command-bar Open remains').toBe(0);
    expect(m.inGroup, 'DEF-191: Open lives inside the file capsule').toBe(true);
    expect(m.groupButtons, 'DEF-191: Open / Save / Save As').toBe(3);
    expect(m.btnBg, 'Open button keeps its solid blue accent').toBe('rgb(37, 99, 235)');
    expect(m.btnColor, 'Open button text/icon white').toBe('rgb(255, 255, 255)');
    expect(m.btnH, 'Open button is the 28px title-bar ladder').toBe(28);

    // The hover state must not reintroduce a stray layer either.
    await win.hover('[data-toolbar-open]');
    await win.waitForTimeout(250);
    const hov = await openButtonMetrics();
    console.log('[DEF-191] title-bar open button (hover):', JSON.stringify(hov));
    await win.screenshot({
      path: path.join(SHOTS, 'def-191-retest-hover.png'),
      clip: { x: 0, y: 0, width: 420, height: 60 },
    });
    expect(hov.groupCount, 'DEF-191 (hover): still ONE file capsule').toBe(1);
    expect(hov.legacyCount, 'DEF-191 (hover): no legacy command-bar Open').toBe(0);
  });

  // ------------------------------------------------------------------
  // DEF-192: the right panel insets the page view in EVERY theme.
  // Phase 36: the panel is the always-mounted Inspector (no toggle), so the
  // inset is ON by default with a document open (INSPECTOR_W_PX = 264px).
  // Primary screenshot: dark (checklist order), then light, then frosted.
  // ------------------------------------------------------------------
  test('DEF-192: the Inspector insets the page view in dark, light, frosted', async () => {
    test.setTimeout(300000);
    await openReport();
    const shotName = { dark: 'def-192-retest.png', light: 'def-192-retest-light.png', frosted: 'def-192-retest-frosted.png' };

    for (const theme of ['dark', 'light', 'frosted']) {
      await setTheme(theme);
      const open = await measureView();
      console.log(`[DEF-192] ${theme}:`, JSON.stringify(open));
      await win.screenshot({ path: path.join(SHOTS, shotName[theme]) });

      // while here: the DEF-191 clean-button contract must hold in this theme too
      const btn = await openButtonMetrics();
      expect(btn.groupCount, `DEF-191 hold-check (${theme}): exactly ONE file capsule`).toBe(1);
      expect(btn.legacyCount, `DEF-191 hold-check (${theme}): no legacy command-bar Open`).toBe(0);

      // The Inspector mounts whenever a document is open, so data-tools-open is
      // TRUE and --tf-tools-inset is the Inspector width.
      expect(open.toolsOpenAttr, `${theme}: the Inspector is open with a document`).toBe('true');
      const margin = parseFloat(open.scrollerMarginRight);
      expect(margin, `${theme}: page inset = the Inspector width (margin ${margin})`).toBeCloseTo(264, 0);
      expect(open.insetVar, `${theme}: the token reaches the grid (${open.insetVar})`).not.toBe('0px');
      expect(open.inspector, `${theme}: Inspector geometry measured`).not.toBeNull();
      expect(open.inspector.left >= open.scroller.right - 2,
        `${theme}: Inspector starts at/beside the scroller's right edge (inspector ${open.inspector.left} vs scroller ${open.scroller.right})`).toBe(true);
      expect(open.page.right <= open.scroller.right + 2, `${theme}: page reflows inside the narrower scroller`).toBe(true);
    }
  });

  // ------------------------------------------------------------------
  // DEF-193 RETIRED (Phase 36 migration). Its subject was the Tools panel and
  // the page animating TOGETHER on the one --panel-slide-duration curve. The
  // panel is now the always-mounted Inspector with NO user open/close trigger
  // (`inspectorOpen` is derived from an open document), so there is no toggle
  // left to sample. The panel-inset layout and its shared slide curve are
  // covered by e2e/phase34_panel_inset.spec.cjs; the always-on inset itself is
  // asserted by DEF-192 above.
  // ------------------------------------------------------------------
});

// (The retired DEF-193 palette-sampling helpers verifyCurve / verifyCloseCurve
// were removed with the DEF-193 retirement above.)