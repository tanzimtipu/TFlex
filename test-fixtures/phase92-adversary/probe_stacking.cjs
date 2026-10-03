// ADVERSARY probe (TFL-622) - NOT part of the repo suite. Lives in run scratch.
// Tests: (A) sheet-vs-dialog chrome, (B) stacked-dialog Esc ownership,
// (C) close-X accessible-name parity on live dialogs.
const path = require('node:path');
const REPO = 'C:/Users/tanzi/OneDrive/App Development/TFlex';
const { launchApp } = require(path.join(REPO, 'e2e/lib/launch.cjs'));

delete process.env.ELECTRON_RUN_AS_NODE;

const out = [];

async function openPaletteTool(win, id, label) {
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-command-palette-input]').fill(label);
  await win.waitForTimeout(300);
  const row = win.locator(`[data-palette-tool-id="${id}"]`).first();
  await row.waitFor({ state: 'visible', timeout: 6000 });
  await row.click();
  await win.waitForSelector('[data-command-palette-layer]', { state: 'detached', timeout: 6000 }).catch(() => {});
  await win.waitForTimeout(450);
}

(async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  let code = 0;
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });

    // (C1) PasswordPrompt close-X label vs shipped "Cancel"
    await openPaletteTool(win, 'preferences', 'Preferences');
    await win.waitForSelector('[data-prefs-dialog]', { timeout: 8000 });
    const sheetInfo = await win.evaluate(() => {
      const shell = document.querySelector('[data-dialog-shell]');
      const close = shell && shell.querySelector('.sheet-close, .modal-close');
      return {
        hasSheet: !!document.querySelector('.sheet'),
        hasSheetBackdrop: !!document.querySelector('.sheet-backdrop'),
        hasModalDialog: !!document.querySelector('.modal-dialog'),
        hasModalBackdrop: !!document.querySelector('.modal-backdrop'),
        closeLabel: close ? close.getAttribute('aria-label') : null,
        closeClass: close ? close.className : null,
      };
    });
    out.push({ probe: 'preferences-sheet-chrome', ...sheetInfo });
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);

    // (B) stacked sheets: About then Update prompt, then Esc.
    await openPaletteTool(win, 'about', 'About Jovrel');
    await win.waitForSelector('[data-about-dialog]', { state: 'visible', timeout: 8000 });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('update:statusChanged', {
        kind: 'available', version: '99.9.9-probe', notes: [],
      });
    });
    await win.waitForSelector('[data-update-prompt]', { state: 'visible', timeout: 8000 });
    const stackedBefore = await win.evaluate(() => ({
      about: !!document.querySelector('[data-about-dialog]'),
      update: !!document.querySelector('[data-update-prompt]'),
      shells: document.querySelectorAll('[data-dialog-shell]').length,
    }));
    await win.keyboard.press('Escape');
    await win.waitForTimeout(700);
    const stackedAfter = await win.evaluate(() => ({
      about: !!document.querySelector('[data-about-dialog]'),
      update: !!document.querySelector('[data-update-prompt]'),
      shells: document.querySelectorAll('[data-dialog-shell]').length,
    }));
    out.push({ probe: 'stacked-esc', stackedBefore, stackedAfter });
  } catch (e) {
    out.push({ probe: 'ERROR', message: e.message, stack: e.stack });
    code = 2;
  } finally {
    try { await app.close(); } catch {}
  }
  console.log('PROBE_RESULT ' + JSON.stringify(out, null, 2));
  process.exit(code);
})();
