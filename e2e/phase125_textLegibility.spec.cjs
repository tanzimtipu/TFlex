// Phase 125 (TFL-1419) chunk C - focused verification of the chunk-B ink/crispness
// change in src/renderer/styles.css, driven through the REAL Electron app.
//
// Per theme (light, dark, frosted) this asserts:
//   1. CRISPNESS - the body no longer forces grayscale antialiasing: the computed
//      `-webkit-font-smoothing` is not `antialiased` (Windows default restored).
//   2. CONTRAST  - a representative supporting-text element resolves to the RAISED
//      token per theme. The command-palette placeholder (`.command-palette-input::
//      placeholder`) is one of the fifteen repointed visible-text selectors and
//      rides `--tf-text-supporting` with no theme override:
//        light/frosted #5b6577 = rgb(91,101,119), dark #929BAC = rgb(146,155,172);
//      it must never compute the pre-phase #667085 = rgb(102,112,133).
//   3. The Home hero `.welcome-sub` supporting ink matches its documented value
//      (light carries the DEF-594 --fg-muted #556070 override; dark/frosted use
//      the raised token).

const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { setTheme, hardClose } = require('./lib/helpers.cjs');

const EXPECTED_SUPPORTING = {
  light: 'rgb(91, 101, 119)', // #5b6577
  dark: 'rgb(146, 155, 172)', // #929BAC
  frosted: 'rgb(91, 101, 119)', // #5b6577
};
const EXPECTED_WELCOME_SUB = {
  light: 'rgb(85, 96, 112)', // #556070 --fg-muted (DEF-594 light hero override)
  dark: 'rgb(146, 155, 172)', // #929BAC --tf-text-supporting
  frosted: 'rgb(91, 101, 119)', // #5b6577 --tf-text-supporting
};
const OLD_SUPPORTING = 'rgb(102, 112, 133)'; // #667085 (pre-Phase-125)

test('Phase 125: body has no forced grayscale smoothing and supporting text uses the raised token per theme', async () => {
  const app = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });

    for (const theme of ['light', 'dark', 'frosted']) {
      await setTheme(win, theme);
      await expect
        .poll(() => win.evaluate(() => document.documentElement.getAttribute('data-theme')))
        .toBe(theme);

      const base = await win.evaluate(() => {
        const body = getComputedStyle(document.body);
        const sub = document.querySelector('.welcome-sub');
        return {
          smoothing: body.webkitFontSmoothing || body.getPropertyValue('-webkit-font-smoothing'),
          welcomeSub: sub ? getComputedStyle(sub).color : null,
        };
      });
      expect(base.smoothing, `[${theme}] body must not force grayscale antialiasing`).not.toBe(
        'antialiased',
      );
      expect(base.welcomeSub, `[${theme}] Home hero supporting ink`).toBe(EXPECTED_WELCOME_SUB[theme]);

      // Representative repointed selector: the command palette's placeholder.
      await win.keyboard.press('Control+k');
      const input = win.locator('[data-command-palette-input]').first();
      await input.waitFor({ state: 'visible', timeout: 8000 });
      const placeholderColor = await win.evaluate(() => {
        const el = document.querySelector('[data-command-palette-input]');
        return el ? getComputedStyle(el, '::placeholder').color : null;
      });
      expect(placeholderColor, `[${theme}] .command-palette-input placeholder uses raised ink`).toBe(
        EXPECTED_SUPPORTING[theme],
      );
      expect(placeholderColor, `[${theme}] must not use the pre-phase #667085`).not.toBe(OLD_SUPPORTING);
      await win.keyboard.press('Escape');
      await win.waitForSelector('[data-command-palette-input]', { state: 'detached', timeout: 8000 }).catch(() => {});
    }
  } finally {
    await hardClose(app, 'phase125-text-legibility');
  }
});
