// "All tools" badge styling verification — styled-chip look of the floating
// tools badge (`.tools-badge-label` inside the floating `.tools-badge` pill on
// the page view's right edge).
//
// Checks, per theme (light, dark, frosted):
//   1. Badge label exists, reads "All tools", vertical text (writing-mode
//      vertical-rl, nowrap, bounding box taller than wide)
//   2. Blue gradient per theme (computed background-image):
//        light   -> #3b82f6 -> #2563eb   (rgb(59,130,246) -> rgb(37,99,235))
//        dark    -> lighter blue (rgb(96,165,250) -> rgb(59,130,246))
//        frosted -> semi-transparent blue (rgba(59,130,246,0.9) -> rgba(37,99,235,0.9))
//   3. White text on the label in every theme
//   4. Pill shape: label border-radius 12px, outer badge border-radius 999px
//   5. Visibility: at-rest opacity of the badge + hover -> opacity 1;
//      screenshots in every theme (full window + badge close-up + hover close-up)
//
// Screenshots: screenshots/badge-styling-{light,dark,frosted}.png (+ -badge close-ups
// and -hover close-ups).
const { test, expect } = require('@playwright/test');
const { launchDev, dismissUpdatePrompt, openSample, hardClose } = require('./lib/helpers.cjs');

const THEMES = ['light', 'dark', 'frosted'];

// Computed-style expectations per theme for the label's background-image.
const GRADIENT_EXPECT = {
  light: [/rgb\(59,\s*130,\s*246\)/, /rgb\(37,\s*99,\s*235\)/],
  dark: [/rgb\(96,\s*165,\s*250\)/, /rgb\(59,\s*130,\s*246\)/],
  frosted: [/rgba\(59,\s*130,\s*246,\s*0?\.?9\)/, /rgba\(37,\s*99,\s*235,\s*0?\.?9\)/],
};

async function switchTheme(window, want) {
  const current = await window.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (current === want) return;
  await window.click('[data-theme-toggle]');
  await window.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await window.click(`[data-theme-option="${want}"]`);
  await window.waitForFunction(
    (t) => document.documentElement.getAttribute('data-theme') === t,
    want,
    { timeout: 5000 },
  );
  // Let the ~400ms theme crossfade + popover pop-out settle before measuring.
  await window.waitForTimeout(800);
}

test.describe('"All tools" badge styling (blue gradient chip, three themes)', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    ({ electronApp, window } = await launchDev());
    await dismissUpdatePrompt(window);
    await openSample(window, electronApp, 'report.pdf');
    await window.waitForSelector('[data-tools-badge]', { timeout: 15000 });
  });

  test.afterEach(async () => {
    if (electronApp) await hardClose(electronApp);
  });

  test('badge chip: per-theme blue gradient, white vertical text, pill shape, visibility', async () => {
    test.setTimeout(240000);

    const badge = window.locator('[data-tools-badge]');
    const label = window.locator('[data-tools-badge] .tools-badge-label');

    // ---- Existence: badge + "All tools" label while the palette is closed ----
    await label.waitFor({ timeout: 10000 });
    const labelText = await label.textContent();
    expect(labelText, 'badge label must read "All tools"').toBe('All tools');

    for (const theme of THEMES) {
      await switchTheme(window, theme);
      const dataTheme = await window.evaluate(() => document.documentElement.getAttribute('data-theme'));
      expect(dataTheme, `theme switch must land on ${theme}`).toBe(theme);

      const s = await window.evaluate(() => {
        const badge = document.querySelector('[data-tools-badge]');
        const label = badge.querySelector('.tools-badge-label');
        const bcs = getComputedStyle(badge);
        const lcs = getComputedStyle(label);
        const lb = label.getBoundingClientRect();
        const bb = badge.getBoundingClientRect();
        return {
            dataTheme: document.documentElement.getAttribute('data-theme'),
            badgeOpacity: bcs.opacity,
            badgeRadius: bcs.borderRadius,
            badgeBox: { x: bb.x, y: bb.y, w: bb.width, h: bb.height },
            labelText: label.textContent.trim(),
            writingMode: lcs.writingMode,
            whiteSpace: lcs.whiteSpace,
            backgroundImage: lcs.backgroundImage,
            color: lcs.color,
            labelRadius: lcs.borderRadius,
            labelBox: { w: lb.width, h: lb.height },
        };
      });
      console.log(`[badge-styling][${theme}]`, JSON.stringify(s));

      // 1. Text is vertical: vertical-rl writing mode, no wrapping, box taller than wide.
      expect(s.writingMode, 'label text must be vertical (writing-mode)').toBe('vertical-rl');
      expect(s.whiteSpace, 'label must not wrap').toBe('nowrap');
      expect(
        s.labelBox.h,
        `label box must be taller than wide (got ${s.labelBox.w}x${s.labelBox.h})`,
      ).toBeGreaterThan(s.labelBox.w);

      // 2. Blue gradient of the correct per-theme stops.
      expect(s.backgroundImage, `${theme}: label background must be a gradient`).toContain('linear-gradient');
      for (const re of GRADIENT_EXPECT[theme]) {
        expect(
          s.backgroundImage,
          `${theme}: gradient must contain ${re} (was: ${s.backgroundImage})`,
        ).toMatch(re);
      }

      // 3. White text.
      expect(s.color, `${theme}: label text must be white (got ${s.color})`).toBe('rgb(255, 255, 255)');

      // 4. Pill shape: label chip radius 12px, outer badge pill radius 999px.
      expect(s.labelRadius, 'label chip must be a rounded pill').toBe('12px');
      expect(s.badgeRadius, 'outer badge must be a pill (radius 999px)').toBe('999px');
      // 4. At rest the whole badge is quiet (opacity ~0.35 by design).
      expect(parseFloat(s.badgeOpacity), `${theme}: at-rest badge opacity`).toBeGreaterThan(0.3);
      expect(parseFloat(s.badgeOpacity)).toBeLessThanOrEqual(0.4);

      await window.screenshot({ path: `screenshots/badge-styling-${theme}.png` });
      await badge.screenshot({ path: `screenshots/badge-styling-${theme}-badge.png` });

      // Hover -> fully opaque (the "clearly visible" state a user sees on
      // interaction). Screenshot it so the chip's real color can be judged.
      await badge.hover();
      await window.waitForTimeout(400);
      const hoverOpacity = await window.evaluate(() =>
        parseFloat(getComputedStyle(document.querySelector('[data-tools-badge]')).opacity),
      );
      console.log(`[badge-styling][${theme}] hover opacity=${hoverOpacity}`);
      expect(hoverOpacity, `${theme}: hovered badge must be fully opaque`).toBeGreaterThan(0.97);
      await badge.screenshot({ path: `screenshots/badge-styling-${theme}-hover.png` });
      // Move the pointer away so the next theme's at-rest shot is at rest.
      await window.mouse.move(10, 10);
      await window.waitForTimeout(400);
    }
  });
});