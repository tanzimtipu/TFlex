// Theme UI fixes verification (orchestrator focused run, 2026-09-14).
//
// Verifies the three in-tree UI fixes against the DEV build:
//   1. Frosted-theme icon contrast - the --icon-* set on
//      :root[data-theme="frosted"] was pulled darker; every one of the 8
//      semantic hues must clear WCAG 3:1 (graphical objects) against the
//      worst-case light backdrop (the white page behind the glass), and
//      the toolbar must stay multi-hue, not monochrome.
//   2. Page spacing in frosted - the frosted scroller keeps the in-flow
//      light/dark 28px top padding: page 1 sits 28px below the chrome
//      stack in every theme, i.e. page 1 starts at the SAME position in
//      all three themes (the task's acceptance bar). The old frosted
//      value was calc(chromeY + 16px) / 16px bottom; the fix pins the
//      content pad at 28px 0 like light/dark.
//   3. "All tools" badge on the floating tools-badge pill - while the
//      palette is CLOSED the pill grows past its 32px min-width to show
//      a semi-transparent "All tools" text chip + left chevron; opening
//      the palette drops the label (bare right chevron) and clicking the
//      badge toggles the palette with real state changes.
//
// Screenshots land in screenshots/ with the ui_fix_ prefix.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose, openSample } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

// The fix's fingerprint: the exact new frosted --icon-* set (styles.css
// Phase-B block). The old set (#4d8fd8/#3cb7c9/#65a87b/#d9762f/#d3a03f/
// #9674cf/#d0615d/#c9769f) failed the 3:1 graphical-contrast bar on
// cyan/green/yellow; every value below clears it.
const EXPECTED_FROSTED_ICONS = {
  '--icon-blue': '#3a7bc8',
  '--icon-cyan': '#2a9da8',
  '--icon-green': '#4a8f6a',
  '--icon-orange': '#c55f1a',
  '--icon-yellow': '#b88a2f',
  '--icon-purple': '#7d5fc0',
  '--icon-red': '#b84a47',
  '--icon-pink': '#b0608a',
};

function parseRgba(str) {
  const m = /rgba?\(([^)]+)\)/.exec(str || '');
  if (!m) return null;
  const p = m[1].split(',').map((s) => parseFloat(s.trim()));
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}

/** WCAG contrast ratio of a `#rrggbb` color against a WHITE backdrop. */
function contrastVsWhite(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const f = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const L = 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  return 1.05 / (L + 0.05);
}

/** Normalize a computed "rgb(...)"/"rgba(...)" color to #rrggbb. */
function rgbToHex(str) {
  const m = /rgba?\(([^)]+)\)/.exec(str || '');
  if (!m) return null;
  const p = m[1].split(',').map((s) => Math.max(0, Math.min(255, Math.round(parseFloat(s.trim())))));
  return '#' + [p[0], p[1], p[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
}

test.describe.serial('theme UI fixes (icons / spacing / badge)', () => {
  let electronApp;
  let win;
  const rendererErrors = [];

  test('frosted icons + page spacing across themes + all-tools badge', async () => {
    test.setTimeout(600000);

    electronApp = await launchApp();
    win = await electronApp.firstWindow();
    win.on('pageerror', (err) => rendererErrors.push(`pageerror: ${err.message}`));
    win.on('console', (msg) => {
      if (msg.type() === 'error') rendererErrors.push(`console.error: ${msg.text()}`);
    });
    const snap = (name) => win.screenshot({ path: path.join(SHOTS, name) });

    async function setThemeViaDropdown(want) {
      await win.click('[data-theme-toggle]');
      await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
      await win.click(`[data-theme-option="${want}"]`);
      await win.waitForFunction(
        (w) => document.documentElement.getAttribute('data-theme') === w,
        want,
      );
      await win.waitForTimeout(700); // crossfade token 400ms + settle
    }

    /** Toolbar icon colors (computed) in the current theme. */
    async function toolbarIconColors() {
      return win.evaluate(() =>
      Array.from(document.querySelectorAll('.toolbar .tool-btn[data-icon]')).map((b) => ({
          icon: b.getAttribute('data-icon'),
          color: getComputedStyle(b).color,
        })),
      );
    }

    /**
     * Page-1 geometry probe.
     *  - scrollerTop: top of the .document-scroller box
     *  - pageTop: viewport Y of page 1's top edge
     *  - chromeBottom: bottom of the lowest non-empty chrome row
     *    (toolbar / ann-toolbar / search-bar / edit toolbar)
     *  - padTop: .document-content computed padding-top
     */
    async function pageGeometry() {
      return win.evaluate(() => {
        const ws = document.querySelector('.workspace-main');
        const scroller = document.querySelector('.document-scroller');
        const content = document.querySelector('.document-content');
        const page = document.querySelector(
          '.tab-pane[aria-hidden="false"] .pdf-page[data-page="1"]',
        );
        if (!ws || !scroller || !content || !page) return null;
        const wsR = ws.getBoundingClientRect();
        const sR = scroller.getBoundingClientRect();
        const pR = page.getBoundingClientRect();
        let chromeBottom = wsR.top;
        for (const s of ['.toolbar', '.ann-toolbar', '.search-bar', '.edit-toolbar']) {
          const el = document.querySelector(s);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (r.height > 0) chromeBottom = Math.max(chromeBottom, r.bottom);
        }
        return {
          wsTop: wsR.top,
          scrollerTop: sR.top,
          pageTop: pR.top,
          chromeBottom,
          padTop: getComputedStyle(content).paddingTop,
        };
      });
    }

    async function badgeFacts() {
      return win.evaluate(() => {
        const badge = document.querySelector('.tools-badge[data-tools-badge], [data-tools-badge]');
        if (!badge) return null;
        const label = badge.querySelector('.tools-badge-label');
        const cs = getComputedStyle(badge);
        const labelCs = label ? getComputedStyle(label) : null;
        const r = badge.getBoundingClientRect();
        return {
          opacity: parseFloat(cs.opacity),
          ariaPressed: badge.getAttribute('aria-pressed'),
          ariaLabel: badge.getAttribute('aria-label'),
          width: r.width,
          x: r.x,
          y: r.y,
          labelPresent: !!label,
          labelText: label ? label.textContent.trim() : null,
          labelBg: label ? labelCs.backgroundColor : null,
          labelBgAlpha: label ? parseRgba(getComputedStyle(label).backgroundColor).a : null,
          labelColor: label ? getComputedStyle(label).color : null,
        };
      });
    }

    // ------------------------------------------------------------------
    // Setup: fresh launch (frosted default) + open report.pdf
    // ------------------------------------------------------------------
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSample(win, electronApp, 'report.pdf');
    await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
    await win.waitForTimeout(1500);

    const freshTheme = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
    console.log(`[icons] fresh-launch theme = ${freshTheme}`);
    expect(freshTheme, 'fresh launch must resolve to the frosted theme').toBe('frosted');

    // ------------------------------------------------------------------
    // 1. FROSTED ICON CONTRAST (the fix)
    // ------------------------------------------------------------------
    const iconVars = await win.evaluate((keys) => {
      const cs = getComputedStyle(document.documentElement);
      const out = {};
      for (const k of keys) out[k] = (cs.getPropertyValue(k) || '').trim().toLowerCase();
      return out;
    }, Object.keys(EXPECTED_FROSTED_ICONS));
    console.log(`[icons] frosted --icon-* = ${JSON.stringify(iconVars)}`);
    for (const [k, want] of Object.entries(EXPECTED_FROSTED_ICONS)) {
      expect(
        iconVars[k],
        `frosted ${k} must be the darker fix value ${want} (got ${iconVars[k]})`,
      ).toBe(want);
      expect(
        contrastVsWhite(iconVars[k]),
        `${k} (${iconVars[k]}) must clear 3:1 vs the white page backdrop`,
      ).toBeGreaterThanOrEqual(3.0);
    }

    const frostedIcons = await toolbarIconColors();
    console.log(`[icons:frosted] toolbar = ${JSON.stringify(frostedIcons)}`);
    const frostedHexes = frostedIcons.map((i) => rgbToHex(i.color)).filter(Boolean);
    expect(
      new Set(frostedHexes).size,
      'frosted toolbar must stay multi-hue, not monochrome',
    ).toBeGreaterThanOrEqual(4);
    for (const t of frostedIcons) {
      const hex = rgbToHex(t.color);
      if (!hex) continue;
      const ratio = contrastVsWhite(hex);
      console.log(`[icons:frosted] ${t.icon} ${hex} vs white = ${ratio.toFixed(2)}`);
      expect(
        ratio,
        `frosted toolbar icon ${t.icon} (${hex}) must clear 3:1 vs white`,
      ).toBeGreaterThanOrEqual(3.0);
    }
    await snap('ui_fix_frosted_toolbar.png');

    // ------------------------------------------------------------------
    // 2. PAGE SPACING
    //
    // NOTE (qa, 2026-09-14): the Phase C CSS block's comments describe a
    // full-bleed scroller behind floating chrome rows, but in the built
    // app the scroller box starts BELOW the chrome stack in EVERY theme
    // (its inset:0 resolves against a containing block that begins
    // below the chrome). The observable, user-relevant contract the fix
    // promises is that page 1 starts at the SAME position in every
    // theme, so the assertions measure exactly that: the 28px content
    // pad, the 28px scroller->page offset, and identical page-top Y
    // across themes.
    // ------------------------------------------------------------------
    let g = await pageGeometry();
    console.log(`[spacing:frosted] ${JSON.stringify(g)}`);
    expect(g, 'frosted geometry probe').not.toBeNull();
    expect(g.padTop, 'frosted .document-content top padding must be 28px').toBe('28px');
    expect(
      Math.abs(g.pageTop - (g.scrollerTop + 28)),
      'frosted page 1 must sit 28px below the scroller top (±2px)',
    ).toBeLessThanOrEqual(2);
    const baselinePageTop = g.pageTop;
    console.log(
      `[spacing:frosted] pageTop=${g.pageTop.toFixed(1)} scrollerTop=${g.scrollerTop.toFixed(1)} wsTop=${g.wsTop.toFixed(1)} chromeBottom=${g.chromeBottom.toFixed(1)}`,
    );
    await snap('ui_fix_spacing_frosted.png');

    // ------------------------------------------------------------------
    // 2b. THEME CYCLE: dark + light must put page 1 at the SAME top
    //     position (the task's "spacing matches light/dark" bar); icons
    //     stay readable; zero renderer errors.
    // ------------------------------------------------------------------
    for (const [t, shot] of [
      ['dark', 'ui_fix_spacing_dark.png'],
      ['light', 'ui_fix_spacing_light.png'],
    ]) {
      await setThemeViaDropdown(t);
      const g2 = await pageGeometry();
      console.log(`[spacing:${t}] ${JSON.stringify(g2)}`);
      expect(g2, `${t} geometry probe`).not.toBeNull();
      expect(g2.padTop, `${t}: .document-content top padding must be the in-flow 28px`).toBe('28px');
      expect(
        Math.abs(g2.pageTop - (g2.chromeBottom + 28)),
        `${t}: page top must be 28px below the chrome stack (±2px) - measured gap ${g2.pageTop - g2.chromeBottom}px`,
      ).toBeLessThanOrEqual(2);
      expect(
        Math.abs(g2.pageTop - baselinePageTop),
        `${t}: page 1 must start at the SAME position as in frosted (got ${g2.pageTop.toFixed(1)} vs frosted ${baselinePageTop.toFixed(1)})`,
      ).toBeLessThanOrEqual(2);
      const icons = await toolbarIconColors();
      const hues = new Set(icons.map((i) => rgbToHex(i.color)).filter(Boolean));
      console.log(`[spacing:${t}] pageTop=${g2.pageTop.toFixed(1)} (frosted was ${baselinePageTop.toFixed(1)}); icon hues = ${hues.size}`);
      expect(hues.size, `${t}: toolbar must stay multi-hue`).toBeGreaterThanOrEqual(4);
      await snap(shot);
    }

    // Back to frosted for the badge work.
    await setThemeViaDropdown('frosted');
    console.log(`[errors so far] ${rendererErrors.length}`);

    // ------------------------------------------------------------------
    // 3. "ALL TOOLS" BADGE
    // ------------------------------------------------------------------
    const closed1 = await badgeFacts();
    console.log(`[badge:closed] ${JSON.stringify(closed1)}`);
    expect(closed1, 'tools badge pill must exist').not.toBeNull();
    expect(closed1.labelPresent, 'closed palette: the "All tools" label must be present').toBe(true);
    expect(closed1.labelText).toBe('All tools');
    expect(
      closed1.labelBgAlpha,
      'the label chip must be semi-transparent (alpha > 0 and < 0.6)',
    ).toBeGreaterThan(0);
    expect(closed1.labelBgAlpha).toBeLessThan(0.6);
    expect(closed1.labelColor, 'the label text must carry a dark ink in frosted').toMatch(/rgb\(3[0-9], 4[0-9], 5[0-9]\)/);
    expect(parseFloat(closed1.opacity), 'closed badge stays quiet (opacity 0.35) at rest').toBeCloseTo(0.35, 1);
    expect(
      closed1.width > 32,
      'closed badge must grow past the 32px min-width to fit the label',
    ).toBe(true);
    await snap('ui_fix_badge_closed_frosted.png');
    // close-up of the badge itself
    {
      const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
      const box = { x: closed1.x, y: closed1.y, w: closed1.width, h: 48 };
      const x0 = Math.max(0, box.x - 70);
      const y0 = Math.max(0, box.y - 60);
      await win.screenshot({
        path: path.join(SHOTS, 'ui_fix_badge_closed_closeup.png'),
        clip: {
          x: x0,
          y: y0,
          width: Math.min(box.width + 140, vp.w - x0),
          height: Math.min(box.h + 120, vp.h - y0),
        },
      });
    }

    // Open direction: click the badge -> palette opens, label drops.
    const marginClosed = await win.evaluate(() => {
      const sc = document.querySelector('.document-scroller');
      return sc ? parseFloat(getComputedStyle(sc).marginRight) : null;
    });
    await win.locator('[data-tools-badge]').click();
    await win.waitForSelector('.app-main[data-tools-open="true"]', { timeout: 5000 });
    await win.waitForSelector('[data-tools-palette]', { timeout: 5000 });
    await win.waitForTimeout(500);
    const openState = await badgeFacts();
    console.log(`[badge:open] ${JSON.stringify(openState)}`);
    await win.waitForSelector('[data-tools-palette]', { timeout: 3000 });
    const marginOpen = await win.evaluate(() =>
      parseFloat(getComputedStyle(document.querySelector('.document-scroller')).marginRight),
    );
    console.log(`[badge] margin-right closed=${marginClosed} open=${marginOpen}`);
    expect(marginOpen, 'page view must narrow while the palette is open').toBeGreaterThan(
      (marginClosed || 0) + 100,
    );
    const openFacts = await badgeFacts();
    expect(openState.ariaPressed, 'open badge aria-pressed').toBe('true');
    expect(
      openFacts.labelPresent,
      'open state: the "All tools" label must be dropped (bare chevron)',
    ).toBe(false);
    await snap('ui_fix_badge_open_frosted.png');

    // Close direction: second click closes the palette, label returns.
    await win.locator('[data-tools-badge]').click();
    await win.waitForSelector('.app-main[data-tools-open="false"]', { timeout: 5000 });
    await win.waitForSelector('[data-tools-palette]', { state: 'detached', timeout: 5000 });
    await win.waitForTimeout(400);
    const marginReclosed = await win.evaluate(() =>
      parseFloat(getComputedStyle(document.querySelector('.document-scroller')).marginRight),
    );
    const reclosed = await badgeFacts();
    console.log(`[badge:reclosed] margin=${marginReclosed} label=${reclosed.labelText}`);
    expect(
      Math.abs(marginReclosed - (marginClosed || 0)),
      'page-view margin must restore after close',
    ).toBeLessThanOrEqual(2);
    expect(reclosed.labelPresent, 're-closed: the "All tools" label must be back').toBe(true);
    expect(reclosed.labelText).toBe('All tools');
    expect(reclosed.ariaPressed).toBe('false');
    await snap('ui_fix_badge_reclosed.png');

    // Dark-theme badge label (the chip tints per theme: white 0.2 alpha).
    await setThemeViaDropdown('dark');
    const darkBadge = await badgeFacts();
    console.log(`[badge:dark] ${JSON.stringify(darkBadge)}`);
    expect(darkBadge.labelPresent, 'dark theme keeps the "All tools" label on the closed badge').toBe(true);
    expect(
      darkBadge.labelBgAlpha,
      'dark label chip must be the white 0.2-alpha wash',
    ).toBeCloseTo(0.2, 1);
    await snap('ui_fix_badge_closed_dark.png');

    // Regression: no "All tools" control smuggled into the toolbar.
    const toolbarButtons = await win.evaluate(() =>
      Array.from(document.querySelectorAll('.toolbar button')).map((b) => ({
        label: b.getAttribute('aria-label') || '',
        title: b.getAttribute('title') || '',
        text: (b.textContent || '').trim(),
      })),
    );
    const allToolsInToolbar = toolbarButtons.filter((b) => /all tools/i.test(b.label + b.title + b.text));
    expect(allToolsInToolbar, 'the toolbar must not carry an "All tools" button').toHaveLength(0);

    // ------------------------------------------------------------------
    // Zero renderer errors across the whole run.
    // ------------------------------------------------------------------
    console.log(`[errors] collected ${rendererErrors.length}: ${JSON.stringify(rendererErrors)}`);
    expect(rendererErrors, 'no renderer errors during the run').toEqual([]);

    await hardClose(electronApp);
  });
});