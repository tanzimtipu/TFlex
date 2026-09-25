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

// Phase 40 (item 11) — the eight per-family --icon-* hues are RETIRED. The
// frosted theme now carries the four semantic roles; each must clear the 3:1
// graphical floor against the white page backdrop. The retired hue names are
// asserted ABSENT (empty) so a re-introduced ad-hoc hue fails here.
const RETIRED_ICON_HUES = [
  '--icon-blue', '--icon-cyan', '--icon-green', '--icon-orange',
  '--icon-yellow', '--icon-purple', '--icon-red', '--icon-pink',
];
const EXPECTED_FROSTED_ROLES = {
  '--sem-primary': '#1e40af',
  '--sem-neutral': '#3a4862',
  '--sem-affirmative': '#12682f',
  '--sem-attention': '#9f1239',
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
        for (const s of ['.ann-toolbar', '.search-bar', '.edit-toolbar']) {
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

    // The retired pill-era "All tools" badge helper (badgeFacts) was removed
    // with the Phase 36 badge retirement. The badge's live absence regression
    // assertion is in section 3 below.

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
    }, [...RETIRED_ICON_HUES, ...Object.keys(EXPECTED_FROSTED_ROLES)]);
    console.log(`[icons] frosted retired --icon-* = ${JSON.stringify(RETIRED_ICON_HUES.map((k) => iconVars[k]))}`);
    console.log(`[icons] frosted --sem-* = ${JSON.stringify(EXPECTED_FROSTED_ROLES)}`);
    for (const k of RETIRED_ICON_HUES) {
      expect(iconVars[k], `${k} is retired (Phase 40 item 11)`).toBe('');
    }
    for (const [k, want] of Object.entries(EXPECTED_FROSTED_ROLES)) {
      expect(
        iconVars[k],
        `frosted ${k} must be the semantic role ${want} (got ${iconVars[k]})`,
      ).toBe(want);
      expect(
        contrastVsWhite(iconVars[k]),
        `${k} (${iconVars[k]}) must clear 3:1 vs the white page backdrop`,
      ).toBeGreaterThanOrEqual(3.0);
    }

    // Phase 36 (chunk 3): the per-view command row is retired, so the
    // CommandBar's multi-hue icon contract has no surface to assert here; the
    // Action Dock's icon/theme contract is covered by phase36_chunk3_dock_gate.
    await snap('ui_fix_frosted_toolbar.png');

    // ------------------------------------------------------------------
    // 2. PAGE SPACING
    //
    // NOTE (qa, 2026-09-14): the Phase C CSS block's comments describe a
    // full-bleed scroller behind floating chrome rows, but in the built
    // app the scroller box starts BELOW the chrome stack in EVERY theme
    // (its inset:0 resolves against a containing block that begins
    // below the chrome). Phase 29 then removed the 28px content pad
    // entirely: the observable contract is now "page 1 is FLUSH with
    // the scroller top (0 pad) and starts at the SAME position in every
    // theme".
    // ------------------------------------------------------------------
    let g = await pageGeometry();
    console.log(`[spacing:frosted] ${JSON.stringify(g)}`);
    expect(g, 'frosted geometry probe').not.toBeNull();
    expect(g.padTop, 'frosted .document-content top padding is 0 (Phase 29 flush)').toBe('0px');
    expect(
      Math.abs(g.pageTop - g.scrollerTop),
      'frosted page 1 is flush with the scroller top (±2px)',
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
      expect(g2.padTop, `${t}: .document-content top padding is 0 (Phase 29 flush)`).toBe('0px');
      expect(
        Math.abs(g2.pageTop - g2.scrollerTop),
        `${t}: page top is flush with the scroller top (±2px) - measured gap ${g2.pageTop - g2.scrollerTop}px`,
      ).toBeLessThanOrEqual(2);
      expect(
        Math.abs(g2.pageTop - baselinePageTop),
        `${t}: page 1 must start at the SAME position as in frosted (got ${g2.pageTop.toFixed(1)} vs frosted ${baselinePageTop.toFixed(1)})`,
      ).toBeLessThanOrEqual(2);
      console.log(`[spacing:${t}] pageTop=${g2.pageTop.toFixed(1)} (frosted was ${baselinePageTop.toFixed(1)})`);
      await snap(shot);
    }

    // Back to frosted for the chrome regression check.
    await setThemeViaDropdown('frosted');
    console.log(`[errors so far] ${rendererErrors.length}`);

    // ------------------------------------------------------------------
    // 3. "ALL TOOLS" BADGE — RETIRED ASSERTIONS (Phase 36 triage)
    //
    // This section asserted the PILL-ERA badge (a ~55x48 pill, rest opacity
    // 0.35, a semi-transparent two-swatch "All tools" label chip, a dark-ink
    // label in frosted and a white 0.2-alpha chip in dark). That badge was
    // deliberately superseded by the 36x100 arrow tab (commit a0f72cc,
    // "panel-attached badge with 36x100 size and slide animation"), whose
    // label reads "All Tools" and whose surface is a solid blue gradient with
    // white text — so every assertion here was stale. The CURRENT badge is
    // covered by e2e/badge_size_slide.spec.cjs (36x100 box + slide) and
    // e2e/badge_chevron_gap.spec.cjs (chevron swap + scrollbar/panel gap), and
    // the badge itself is retired by the next Phase-36 chunk (the All-tools
    // palette becomes the Inspector). The stale pill-era assertions are
    // therefore deleted rather than migrated.
    // ------------------------------------------------------------------

    // Regression: no "All tools" control smuggled into the workspace chrome.
    const toolbarButtons = await win.evaluate(() =>
      Array.from(document.querySelectorAll('.action-dock button')).map((b) => ({
        label: b.getAttribute('aria-label') || '',
        title: b.getAttribute('title') || '',
        text: (b.textContent || '').trim(),
      })),
    );
    const allToolsInToolbar = toolbarButtons.filter((b) => /all tools/i.test(b.label + b.title + b.text));
    expect(allToolsInToolbar, 'the dock must not carry an "All tools" button').toHaveLength(0);

    // ------------------------------------------------------------------
    // Zero renderer errors across the whole run.
    // ------------------------------------------------------------------
    console.log(`[errors] collected ${rendererErrors.length}: ${JSON.stringify(rendererErrors)}`);
    expect(rendererErrors, 'no renderer errors during the run').toEqual([]);

    await hardClose(electronApp);
  });
});