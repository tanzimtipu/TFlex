// PROBE: frosted dialog + menu popover seethrough investigation.
// The frost-verify screenshots showed the Insert-pages dialog body and the
// titlebar app menu bleeding the white PDF page through in the FROSTED theme
// only (dark + light dialogs are solid). Dump the exact computed surfaces.
const { test } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

test('PROBE: frosted dialog + menu surface facts', async () => {
  test.setTimeout(180000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await win.locator('button:has-text("Open PDF")').first().click();
    await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
    await win.waitForTimeout(2200);

    for (const theme of ['frosted', 'dark']) {
      await win.click('[data-theme-toggle]');
      await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
      await win.click(`[data-theme-option="${theme}"]`);
      await win.waitForFunction((t) => document.documentElement.getAttribute('data-theme') === t, theme);
      await win.waitForTimeout(600);

      // Dialog
      await win.click('[data-tools-toggle]');
      await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
      await win.waitForTimeout(500);
      await win.click('[data-tool-id="insertPages"]');
      await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 8000 });
      await win.waitForTimeout(700);
      const dlg = await win.evaluate(() => {
        const bd = document.querySelector('.modal-backdrop');
        const dl = document.querySelector('.modal-dialog');
        const sheet = document.querySelector('.sheet');
        const pick = (el) => {
          if (!el) return null;
          const cs = getComputedStyle(el);
          return {
            bg: cs.backgroundColor,
            backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
            opacity: cs.opacity,
            transform: cs.transform,
            isolation: cs.isolation,
            mixBlendMode: cs.mixBlendMode,
            filter: cs.filter,
          };
        };
        return { backdrop: pick(bd), dialog: pick(dl), sheet: pick(sheet) };
      });
      console.log(`[probe:${theme}] dialog: ${JSON.stringify(dlg, null, 1)}`);
      await win.screenshot({ path: path.join(SHOTS, `probe-dialog-${theme}.png`) });
      await win.keyboard.press('Escape');
      await win.waitForTimeout(700);
      const palOpen = await win.evaluate(() => !!document.querySelector('[data-tools-palette]'));
      if (palOpen) {
        await win.click('[data-tools-toggle]');
        await win.waitForTimeout(600);
      }

      // App menu + theme popover
      await win.click('[data-menu-button]');
      await win.waitForSelector('[data-menu-popover]', { timeout: 5000 });
      await win.waitForTimeout(600);
      const menu = await win.evaluate(() => {
        const el = document.querySelector('[data-menu-popover]');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          bg: cs.backgroundColor,
          backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
          opacity: cs.opacity,
          transform: cs.transform,
          border: cs.border,
          boxShadow: cs.boxShadow,
        };
      });
      console.log(`[probe:${theme}] menu: ${JSON.stringify(menu, null, 1)}`);
      await win.screenshot({ path: path.join(SHOTS, `probe-menu-${theme}.png`) });
      await win.keyboard.press('Escape');
      await win.waitForTimeout(500);
    }
  } catch (err) {
    console.log('[probe] FAILED:', err.message);
    await win.screenshot({ path: path.join(SHOTS, 'probe-FAILURE.png') }).catch(() => {});
    throw err;
  } finally {
    await hardClose(electronApp);
  }
});
