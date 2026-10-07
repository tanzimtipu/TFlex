// TFL-1076 — Phase 111 (TFL-1074) FIX-READY verification evidence.
//
// Primary deliverable: re-measure DEF-612 (current card is NEUTRAL and distinct
// from the selected card) and DEF-613 (the SIX navigator contrast ratios) IN THE
// RUNNING APP — from the rendered CSS, not from the unit-computed values.
//
// DEF-612: open a real PDF, make page 1 current and page 2 selected, capture
// Pages light + dark screenshots, and assert the current card paints no wash and
// no accent ring while the selected card paints the select-fill tint + glyph.
//
// DEF-613: read the navigator-scoped palette (`--tf-nav-*`) and the scope-local
// aliases the `.context-panel` remaps (`--fg-muted`, `--select-fill`,
// `--select-glyph`) off the rendered element with getComputedStyle, then compute
// the same body / helper / selected WCAG ratios chunk G computed, and assert the
// `Specifications/contrast-check.json` floors.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const PANEL = '[data-context-panel="pages"]';

const FLOORS = {
  light: { body: 7.96, helper: 4.97, selected: 4.73 },
  dark: { body: 8.59, helper: 5.62, selected: 6.59 },
};

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
  if (app) await hardClose(app, 'tfl1076-def612-613');
  app = null;
  win = null;
});

async function openFixture(filePath) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, filePath);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector(`${PANEL} .thumb-item`, { timeout: 30000 });
  await win.waitForTimeout(1500);
}

async function setTheme(theme) {
  await win.click('[data-stage-rail-gear]');
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
  await win.selectOption('[data-prefs-theme-default]', theme);
  await win.waitForFunction(
    (w) => document.documentElement.getAttribute('data-theme') === w,
    theme,
    { timeout: 10000 },
  );
  await win.click('button[aria-label="Close preferences"]');
  await win.waitForSelector('[data-prefs-dialog]', { state: 'detached', timeout: 10000 });
  await win.waitForTimeout(500);
}

// Shared colour math (mirrors chunk G's TF1073-F/G helpers).
const COLOUR_MATH = `
  const toRgba = (c) => {
    const s = (c || '').trim();
    if (s.startsWith('#')) {
      let h = s.slice(1);
      if (h.length === 3) h = h.split('').map((x) => x + x).join('');
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
    }
    const m = s.match(/[\\d.]+/g);
    if (!m) return null;
    return [Number(m[0]), Number(m[1]), Number(m[2]), m[3] === undefined ? 1 : Number(m[3])];
  };
  const over = (fg, bg) => [fg[0] * fg[3] + bg[0] * (1 - fg[3]), fg[1] * fg[3] + bg[1] * (1 - fg[3]), fg[2] * fg[3] + bg[2] * (1 - fg[3]), 1];
  const lum = (c) => {
    const f = (x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
    return 0.2126 * f(c[0] / 255) + 0.7152 * f(c[1] / 255) + 0.0722 * f(c[2] / 255);
  };
  const ratio = (a, b) => {
    if (!a || !b) return null;
    const hi = Math.max(lum(a), lum(b)); const lo = Math.min(lum(a), lum(b));
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  };
  const effBg = (el) => {
    let n = el;
    while (n) {
      const c = toRgba(getComputedStyle(n).backgroundColor);
      if (c && c[3] > 0.01) return c;
      n = n.parentElement;
    }
    return [255, 255, 255, 1];
  };
`;

// DEF-613: read the rendered navigator palette off the `.context-panel` scope
// (the element that remaps `--fg-muted` / `--select-fill` / `--select-glyph`)
// and compute the three contract ratios exactly as the bundle defines them.
async function measureRatios() {
  return win.evaluate(([PANEL, MATH]) => {
    // eslint-disable-next-line no-eval
    const H = eval('(() => {' + MATH + ' return { toRgba, over, lum, ratio, effBg }; })()');
    const { toRgba, over, ratio, effBg } = H;
    const panel = document.querySelector(PANEL);
    const cs = getComputedStyle(panel);
    const v = (n) => cs.getPropertyValue(n).trim();
    const navSurface = v('--tf-nav-surface');
    const navBodyInk = v('--tf-nav-body-ink');
    const navHelperInk = v('--tf-nav-helper-ink');
    const navSelectedSurface = v('--tf-nav-selected-surface');
    const navSelectedInk = v('--tf-nav-selected-ink');
    const aliasedHelper = v('--fg-muted');
    const aliasedFill = v('--select-fill');
    const aliasedGlyph = v('--select-glyph');
    const selCard = document.querySelector('.thumb-selected');
    const selLabel = selCard ? selCard.querySelector('.thumb-label') : null;
    const curCard = document.querySelector('.thumb-current');
    const curStyle = curCard ? getComputedStyle(curCard) : null;
    const selStyle = selCard ? getComputedStyle(selCard) : null;
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      tokens: { navSurface, navBodyInk, navHelperInk, navSelectedSurface, navSelectedInk },
      aliases: { aliasedHelper, aliasedFill, aliasedGlyph },
      ratios: {
        body: ratio(toRgba(navBodyInk), toRgba(navSurface)),
        helper: ratio(toRgba(navHelperInk), toRgba(navSurface)),
        selected: ratio(toRgba(navSelectedInk), toRgba(navSelectedSurface)),
      },
      element: {
        selected: selCard && selLabel
          ? ratio(toRgba(getComputedStyle(selLabel).color), over(toRgba(selStyle.backgroundColor), effBg(selCard.parentElement)))
          : null,
      },
      current: curStyle ? { backgroundColor: curStyle.backgroundColor, boxShadow: curStyle.boxShadow } : null,
      selectedCard: selStyle ? { backgroundColor: selStyle.backgroundColor, boxShadow: selStyle.boxShadow } : null,
    };
  }, [PANEL, COLOUR_MATH]);
}

test('TFL1076-DEF613 six navigator contrast ratios re-measured in-app meet the floors', async () => {
  await openFixture(getSamplePath('report.pdf'));

  const results = {};
  for (const theme of ['light', 'dark']) {
    await setTheme(theme);
    const m = await measureRatios();
    results[theme] = m;
    console.log(`[TFL1076-DEF613] ${theme} ${JSON.stringify(m)}`);
    for (const tier of ['body', 'helper', 'selected']) {
      expect(m.ratios[tier], `${theme}/${tier} measured in-app`).not.toBeNull();
      expect(
        m.ratios[tier],
        `${theme}/${tier} = ${m.ratios[tier]} must meet floor ${FLOORS[theme][tier]}`,
      ).toBeGreaterThanOrEqual(FLOORS[theme][tier]);
    }
    // The navigator-scoped aliases must resolve to the new palette, proving the
    // rendered navigator actually consumes it.
    expect(m.aliases.aliasedHelper, `${theme} --fg-muted remapped to nav helper ink`)
      .toBe(m.tokens.navHelperInk);
    expect(m.aliases.aliasedFill, `${theme} --select-fill remapped to nav selected surface`)
      .toBe(m.tokens.navSelectedSurface);
    expect(m.aliases.aliasedGlyph, `${theme} --select-glyph remapped to nav selected ink`)
      .toBe(m.tokens.navSelectedInk);
  }

  fs.writeFileSync(
    path.join(SHOTS, 'tfl1076-def613-ratios.json'),
    JSON.stringify(results, null, 2),
  );
});

test('TFL1076-DEF612 current card is neutral and distinct from the selected card', async () => {
  await openFixture(getSamplePath('report.pdf'));

  // page 1 is current by default; select page 2 so both states coexist.
  await win.locator(`${PANEL} .thumb-item[data-page="2"] [data-thumb-checkbox]`).check();
  await win.waitForTimeout(400);
  await expect(win.locator('.thumb-item[data-page="1"] [data-thumb-current-marker]')).toHaveCount(1);
  await expect(win.locator('.thumb-item[data-page="1"] [data-thumb-viewing]')).toHaveText('Viewing');
  await expect(win.locator('.thumb-item[data-page="1"]')).not.toHaveClass(/thumb-selected/);
  await expect(win.locator('.thumb-item[data-page="2"]')).toHaveClass(/thumb-selected/);

  for (const theme of ['light', 'dark']) {
    await setTheme(theme);
    const m = await measureRatios();
    // The CURRENT card paints NO wash (transparent) and NO ring (no shadow).
    expect(m.current.backgroundColor, `${theme} current card background is neutral`).toBe('rgba(0, 0, 0, 0)');
    expect(m.current.boxShadow, `${theme} current card paints no accent ring`).toBe('none');
    // The SELECTED card DOES paint the select-fill tint + inner ring.
    expect(m.selectedCard.backgroundColor, `${theme} selected card paints the select-fill tint`).not.toBe('rgba(0, 0, 0, 0)');
    expect(m.selectedCard.boxShadow, `${theme} selected card paints its ring`).not.toBe('none');
    await win.screenshot({ path: path.join(SHOTS, `tfl1076-pages-${theme}.png`) });
  }
});
