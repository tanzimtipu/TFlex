// TFL-1581 focused QA verification (post-dev fix TFL-1580). The View Strip
// footer ICON + LABEL ink ladder must clear the 3:1 non-text contrast floor for
// every state (default / hover / selected / disabled) in all three themes,
// share ONE accent treatment for the selected state, and keep the footer
// geometry intact. Samples the REAL rendered colours (computed color + the
// effective composited surface behind each control) and screenshots the footer.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { openSamplePath, setTheme, hardClose } = require('./lib/helpers.cjs');

const THEMES = ['light', 'dark', 'frosted'];
const SHOT_DIR = path.join(__dirname, '..', 'screenshots');
const ZOOM_OUT = '.view-strip-view button[aria-label="Zoom out"]';
const FIT_WIDTH = '.view-strip-view button[aria-label="Fit width"]';
const PREV = '.view-strip-page button[aria-label="Previous page"]';
const AWAY = { x: 1050, y: 420 };

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openSamplePath(win, app, getSamplePath('report.pdf'));
  await win.waitForSelector('.view-strip', { timeout: 20000 });
  await win.waitForTimeout(600);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1581');
  app = null;
  win = null;
});
test.setTimeout(300000);

// In-page sampler: resolves the glyph ink (computed `color`, which the inline
// SVG inherits via currentColor), the effective background composited up the
// ancestor chain, and the WCAG relative-luminance contrast ratio between them.
async function sample(selector) {
  return win.evaluate((sel) => {
    const parse = (v) => {
      const m = String(v).match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(',').map((x) => parseFloat(x.trim()));
      return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
    };
    const comp = (fg, bg) => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1,
    });
    const ch = (x) => { const s = x / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    const lum = (c) => 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
    const ratio = (a, b) => +(((Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)).toFixed(2));
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const layers = [];
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
      n = n.parentElement;
    }
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i -= 1) bg = comp(layers[i], bg);
    const svg = el.querySelector('svg');
    return {
      color: cs.color,
      svgColor: svg ? getComputedStyle(svg).color : null,
      bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
      rawBg: cs.backgroundColor,
      ratio: ratio(parse(cs.color), bg),
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      pressed: el.getAttribute('aria-pressed'),
    };
  }, selector);
}

function log(label, obj) { console.log(`[TFL1581] ${label} ${JSON.stringify(obj)}`); }

test('View Strip footer icon contrast >= 3:1 per state per theme + accent parity + geometry', async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const failures = [];
  const table = {};

  for (const theme of THEMES) {
    await setTheme(win, theme);
    await win.mouse.move(AWAY.x, AWAY.y);
    await win.waitForTimeout(350);

    // 1) default (unselected) action glyph.
    const dflt = await sample(ZOOM_OUT);
    // 2) hover on the same control.
    const box = await win.locator(ZOOM_OUT).first().boundingBox();
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await win.waitForTimeout(280);
    const hover = await sample(ZOOM_OUT);
    await win.mouse.move(AWAY.x, AWAY.y);
    await win.waitForTimeout(220);
    // 3) disabled action glyph (Previous page is disabled on page 1).
    const disabled = await sample(PREV);
    // 4) selected toggle: force Fit width into the pressed state, then sample.
    const fit = win.locator(FIT_WIDTH).first();
    if ((await fit.getAttribute('aria-pressed')) !== 'true') {
      await fit.click();
      await win.waitForTimeout(450);
    }
    await win.mouse.move(AWAY.x, AWAY.y);
    await win.waitForTimeout(280);
    const selFit = await sample(FIT_WIDTH);

    // 5) accent parity: every pressed footer control must share color + fill.
    const pressed = await win.evaluate(() => [...document.querySelectorAll('.view-strip button[aria-pressed="true"]')]
      .map((b) => ({ label: b.getAttribute('aria-label'), color: getComputedStyle(b).color, bg: getComputedStyle(b).backgroundColor })));
    // 6) geometry: footer band height + every toolbar target square and in-band.
    const geom = await win.evaluate(() => {
      const strip = document.querySelector('.view-strip');
      const sr = strip.getBoundingClientRect();
      const btns = [...strip.querySelectorAll('.btn-toolbar')]
        .filter((b) => b.getClientRects().length > 0) // skip display:none controls (e.g. the narrow-width More menu)
        .map((b) => {
          const r = b.getBoundingClientRect();
          return { label: b.getAttribute('aria-label'), w: +r.width.toFixed(1), h: +r.height.toFixed(1), top: r.top, bottom: r.bottom };
        });
      return { stripH: +sr.height.toFixed(1), stripTop: sr.top, stripBottom: sr.bottom, btns };
    });

    const shot = path.join(SHOT_DIR, `tfl1581-view-strip-${theme}.png`);
    await win.mouse.move(AWAY.x, AWAY.y);
    await win.waitForTimeout(200);
    await win.locator('.view-strip').first().screenshot({ path: shot });

    table[theme] = { dflt, hover, disabled, selFit, pressed, geom, shot };
    log(`theme-${theme}`, { dflt, hover, disabled, selFit, pressed });

    for (const [state, m] of Object.entries({ default: dflt, hover, disabled, selected: selFit })) {
      if (!m) { failures.push(`${theme} ${state}: control not found`); continue; }
      if (m.ratio < 3) failures.push(`${theme} ${state}: ${m.color} on ${m.bg} = ${m.ratio} < 3.0`);
    }
    if (!disabled || disabled.disabled !== true) failures.push(`${theme}: Previous page was expected disabled at page 1`);
    // Accent parity: identical resolved ink and fill for every pressed control.
    const colors = new Set(pressed.map((p) => p.color));
    const bgs = new Set(pressed.map((p) => p.bg));
    if (pressed.length < 2) failures.push(`${theme}: expected >=2 pressed controls for parity, got ${pressed.length}`);
    if (colors.size > 1) failures.push(`${theme}: pressed ink differs across icons: ${[...colors].join(' | ')}`);
    if (bgs.size > 1) failures.push(`${theme}: pressed fill differs across icons: ${[...bgs].join(' | ')}`);
    if (selFit && pressed.some((p) => p.color !== selFit.color)) {
      failures.push(`${theme}: Fit width ink ${selFit.color} is an outlier vs pressed accent ${[...colors].join('|')}`);
    }
    // Geometry: footer band height and 32px square targets inside the band.
    if (geom.stripH < 44 || geom.stripH > 56) failures.push(`${theme}: footer height ${geom.stripH} outside 44-56`);
    for (const b of geom.btns) {
      if (Math.abs(b.w - 32) > 0.6 || Math.abs(b.h - 32) > 0.6) failures.push(`${theme}: ${b.label} target ${b.w}x${b.h} != 32x32`);
      if (b.top < geom.stripTop - 0.5 || b.bottom > geom.stripBottom + 0.5) failures.push(`${theme}: ${b.label} escapes footer band`);
    }
  }

  log('table', Object.fromEntries(Object.entries(table).map(([t, v]) => [t, {
    default: v.dflt && v.dflt.ratio, hover: v.hover && v.hover.ratio,
    disabled: v.disabled && v.disabled.ratio, selected: v.selFit && v.selFit.ratio,
    accentInk: v.selFit && v.selFit.color, accentFill: v.selFit && v.selFit.rawBg,
  }])));
  log('failures', failures);
  expect(failures, failures.join('\n')).toEqual([]);
});
