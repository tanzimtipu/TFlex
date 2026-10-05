// Phase 103 adversary diff-pass (TFL-838) — hostile behaviour probes for the
// Quiet Precision icon migration. The phase is presentation-only, so every
// icon-bearing control must still fire its REAL handler: no swapped verb, no
// no-op, no double-fire, and the new <Icon> glyph must not swallow a click.
//
// Run:
//   npm.cmd run test:e2e -- phase103_adversary.spec.cjs
//
// Written by the adversary; qa owns e2e. Left in place for the phase-close run.

const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const {
  hardClose,
  gotoStage,
  openStandalonePrintWindow,
  closeStandalonePrintWindow,
} = require('./lib/helpers.cjs');

test.setTimeout(180000);

async function openReport(app, win) {
  const p = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, f) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
  }, p);
  await win.locator('[data-home-tool="open"]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(900);
}

async function closeDialog(win, root) {
  // Prefer the dialog's own close control; Escape is a fallback.
  const close = root.locator('.sheet-close, .modal-close').first();
  if (await close.count()) {
    await close.click().catch(() => {});
  } else {
    await win.keyboard.press('Escape');
  }
  await expect(root).toHaveCount(0, { timeout: 8000 });
}

test('P103 ADV dock verbs: real handler, no swap, no no-op, no double-fire', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await openReport(app, win);

  // 1) NO-OP guard: rotate must change engine rotation state.
  await gotoStage(win, 1);
  const before = (await win.evaluate(() => window.tflexDiagnostics())).engineState.rotations[0];
  await win.click('[data-dock-verb="rotate"]');
  await win.waitForTimeout(600);
  const after = (await win.evaluate(() => window.tflexDiagnostics())).engineState.rotations[0];
  expect(after, 'rotate verb changed the page rotation').not.toBe(before);
  // SWAP guard: rotate must not have opened the crop dialog.
  await expect(win.locator('[data-crop-pages-dialog]'), 'rotate did not open the crop dialog').toHaveCount(0);

  // 2) SILENCE attack: click the glyph itself, not the button padding. The new
  //    <Icon> SVG must not intercept or swallow the verb's click.
  await gotoStage(win, 1);
  await win.locator('[data-dock-verb="cropPages"] svg').first().click();
  const crop = win.locator('[data-crop-pages-dialog]');
  await expect(crop, 'crop dialog opened from a click on the glyph').toBeVisible({ timeout: 8000 });
  await expect(crop, 'exactly one crop dialog (no double-fire)').toHaveCount(1);
  await expect(win.locator('[data-delete-pages-dialog]'), 'crop did not open the delete dialog').toHaveCount(0);
  await closeDialog(win, crop);

  // 3) The destructive verb opens its OWN dialog, exactly once.
  await gotoStage(win, 1);
  await win.click('[data-dock-verb="delete"]');
  const del = win.locator('[data-delete-pages-dialog]');
  await expect(del, 'delete dialog opened').toBeVisible({ timeout: 8000 });
  await expect(del, 'exactly one delete dialog (no double-fire)').toHaveCount(1);
  await expect(win.locator('[data-crop-pages-dialog]'), 'delete did not open the crop dialog').toHaveCount(0);
  await closeDialog(win, del);

  await hardClose(app, 'p103-adv-dock');
});

test('P103 ADV save/save-as/sanitize/preferences survive the icon swap', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await openReport(app, win);

  // DISABLED recovery: Save is disabled on a clean document.
  const save = win.locator('[data-toolbar-save]');
  await expect(save, 'Save disabled while the document is clean').toBeDisabled();
  await save.click({ force: true }).catch(() => {});
  await expect(win.locator('[data-save-as-dialog]'), 'a disabled Save click opened nothing').toHaveCount(0);

  // Mark modified, then Save must fire and clear the modified flag.
  await gotoStage(win, 1);
  await win.click('[data-dock-verb="rotate"]');
  await win.waitForTimeout(500);
  await expect(save, 'Save re-enables once the document is modified').toBeEnabled({ timeout: 8000 });
  await save.click();
  await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 15000 });

  // Save As opens its dialog and its own close control dismisses it.
  await gotoStage(win, 1);
  await win.click('[data-dock-verb="rotate"]');
  await win.waitForTimeout(500);
  await win.click('[data-toolbar-save-as]');
  const saveAs = win.locator('[data-save-as-dialog]');
  await expect(saveAs, 'Save As dialog opened').toBeVisible({ timeout: 10000 });
  await expect(saveAs, 'exactly one Save As dialog').toHaveCount(1);
  await closeDialog(win, saveAs);

  // Sanitize flow (REVIEW dock verb) opens and closes.
  await gotoStage(win, 3);
  const san = win.locator('[data-dock-verb="sanitize"]');
  await expect(san, 'sanitize verb is present on the REVIEW dock').toHaveCount(1, { timeout: 8000 });
  await san.first().click();
  const sanDialog = win.locator('[data-sanitize-dialog]');
  await expect(sanDialog, 'sanitize dialog opened').toBeVisible({ timeout: 8000 });
  await win.locator('[data-sanitize-close]').click();
  await expect(sanDialog, 'sanitize dialog closed').toHaveCount(0, { timeout: 8000 });

  // Header utility + dialog close.
  await win.click('[data-open-preferences]');
  const prefs = win.locator('[data-prefs-dialog]');
  await expect(prefs, 'preferences dialog opened').toBeVisible({ timeout: 8000 });
  await win.click('[data-prefs-dialog] [aria-label="Close preferences"]');
  await expect(prefs, 'preferences dialog closed').toHaveCount(0, { timeout: 8000 });

  await hardClose(app, 'p103-adv-save');
});

test('P103 ADV print control opens the standalone print window', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await openReport(app, win);

  const printPage = await openStandalonePrintWindow(app, win);
  expect(printPage, 'standalone print window opened').toBeTruthy();
  await closeStandalonePrintWindow(app, printPage);

  await hardClose(app, 'p103-adv-print');
});

test('P103 ADV glyph family is normalized at runtime and disabled icons are inert', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await openReport(app, win);

  const glyphs = await win.evaluate(() => {
    const read = (sel) => {
      const el = document.querySelector(sel);
      const svg = el && (el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg'));
      if (!svg) return { sel, found: false };
      const cs = getComputedStyle(svg);
      return {
        sel,
        found: true,
        tag: svg.tagName.toLowerCase(),
        viewBox: svg.getAttribute('viewBox'),
        fill: svg.getAttribute('fill'),
        stroke: svg.getAttribute('stroke'),
        strokeWidthAttr: svg.getAttribute('stroke-width'),
        strokeWidthCs: cs.strokeWidth,
        linecap: svg.getAttribute('stroke-linecap'),
        linejoin: svg.getAttribute('stroke-linejoin'),
        width: svg.getAttribute('width'),
        height: svg.getAttribute('height'),
        ariaHidden: svg.getAttribute('aria-hidden'),
        focusable: svg.getAttribute('focusable'),
        hasFillChildMissing: svg.querySelectorAll('[fill]:not([fill="none"])').length,
      };
    };
    return {
      shapes: read('[data-dock-verb="cropPages"]'),
      lucide: read('[data-window-maximize]'),
    };
  });
  console.log('P103_ADV_GLYPHS ' + JSON.stringify(glyphs));

  // Authored Quiet Precision shape: 24x24 grid, 1.65 stroke, no fill, currentColor, round.
  const s = glyphs.shapes;
  expect(s.found, 'crop glyph found').toBe(true);
  expect(s.viewBox, 'authored viewBox 0 0 24 24').toBe('0 0 24 24');
  expect(s.fill, 'authored fill=none').toBe('none');
  expect(s.stroke, 'authored stroke=currentColor').toBe('currentColor');
  expect(Number(s.strokeWidthAttr), 'authored stroke-width 1.65').toBeCloseTo(1.65, 2);
  expect(s.linecap, 'authored round cap').toBe('round');
  expect(s.linejoin, 'authored round join').toBe('round');
  expect(s.ariaHidden, 'decorative glyph aria-hidden').toBe('true');
  expect(Number(s.width), 'chrome glyph >= 18px floor').toBeGreaterThanOrEqual(18);

  // Retained Lucide glyph: normalized to the same stroke, not Lucide's default 2.
  const l = glyphs.lucide;
  expect(l.found, 'window maximize glyph found').toBe(true);
  expect(Number(l.strokeWidthAttr), 'retained Lucide stroke normalized to 1.65').toBeCloseTo(1.65, 2);
  expect(l.linecap, 'retained Lucide round cap').toBe('round');
  expect(l.linejoin, 'retained Lucide round join').toBe('round');
  expect(l.ariaHidden, 'retained Lucide decorative aria-hidden').toBe('true');

  // Disabled icons do not react as available controls: a disabled Save is not
  // clickable and its glyph does not lift its own colour to the active ink.
  const disabled = await win.evaluate(() => {
    const btn = document.querySelector('[data-toolbar-save]');
    const svg = btn && btn.querySelector('svg');
    return {
      disabled: btn ? btn.disabled : null,
      cursor: btn ? getComputedStyle(btn).cursor : null,
      svgOpacity: svg ? getComputedStyle(svg).opacity : null,
    };
  });
  console.log('P103_ADV_DISABLED ' + JSON.stringify(disabled));
  expect(disabled.disabled, 'Save starts disabled').toBe(true);
  expect(disabled.cursor, 'disabled control shows not-allowed').toBe('not-allowed');

  await hardClose(app, 'p103-adv-glyph');
});
