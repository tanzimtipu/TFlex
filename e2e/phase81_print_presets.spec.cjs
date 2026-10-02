// Phase 81 focused verification (qa) - named print presets in the standalone
// print window. Drives the real dev app through launchDev(); the print window
// is the canonical `?tfWindow=print` surface opened via
// openStandalonePrintWindow(). launchDev() uses a fresh temp user-data dir by
// default, so the operator's real settings.json is never touched.
//
// Run with:
//   npm.cmd run test:e2e -- e2e/phase81_print_presets.spec.cjs
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const {
  launchDev,
  openSample,
  openStandalonePrintWindow,
  closeStandalonePrintWindow,
  hardClose,
} = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const log = (label, obj) => console.log(`[p81|${label}] ${JSON.stringify(obj)}`);

function readPrintPresets(settingsPath) {
  if (!fs.existsSync(settingsPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    return Array.isArray(raw.printPresets) ? raw.printPresets : null;
  } catch {
    return null;
  }
}

// Poll the on-disk settings.json until the named preset's presence matches
// `present`. Returns false on timeout (never throws on a partial/absent file).
async function waitForPersistedPreset(settingsPath, name, present, timeoutMs = 20000) {
  const t0 = Date.now();
  let lastShape = 'unread';
  while (Date.now() - t0 < timeoutMs) {
    const p = readPrintPresets(settingsPath);
    lastShape = p === null ? 'null' : Array.isArray(p) ? 'array' : typeof p;
    if (Array.isArray(p) && p.some((e) => e && e.name === name) === present) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  log('waitForPersistedPreset-timeout', { name, present, lastShape });
  return false;
}

test('Phase 81: named print presets save, list, persist, apply, fail loud, delete', async () => {
  test.setTimeout(300000);
  const { electronApp: app, window: win } = await launchDev();
  const pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(`[app] ${String(e).slice(0, 400)}`));
  let printPage = null;
  try {
    await openSample(win, app, 'report.pdf');
    await win.waitForSelector('.pdf-page canvas', { timeout: 60000 });

    const udd = await app.evaluate(({ app: a }) => a.getPath('userData'));
    const settingsPath = path.join(udd, 'settings.json');

    // 1. open the standalone print window.
    printPage = await openStandalonePrintWindow(app, win);
    printPage.on('pageerror', (e) => pageErrors.push(`[print] ${String(e).slice(0, 400)}`));
    await printPage.waitForSelector('[data-print-preset-name]', { timeout: 20000 });

    // 2. set option controls and save "Duplex greyscale".
    await printPage.selectOption('[data-print-duplex]', 'longEdge');
    await printPage.selectOption('[data-print-color]', 'grey');
    await printPage.check('[data-print-scale-fit]');
    await printPage.fill('[data-print-preset-name]', 'Duplex greyscale');
    await printPage.click('[data-print-preset-save]');

    // 3. listed + notice + persisted entry with NO deviceName.
    await expect(printPage.locator('[data-print-preset] option[value="Duplex greyscale"]')).toHaveCount(1);
    await expect(printPage.locator('[data-print-preset-notice]')).toContainText('saved');
    expect(await waitForPersistedPreset(settingsPath, 'Duplex greyscale', true), 'preset persisted to settings.json').toBe(true);
    const persisted = (readPrintPresets(settingsPath) || []).find((e) => e.name === 'Duplex greyscale');
    log('persisted', persisted);
    expect(persisted, 'persisted preset entry exists').toBeTruthy();
    expect('deviceName' in persisted.settings, 'persisted settings carry NO deviceName').toBe(false);
    expect(persisted.settings.duplex, 'persisted duplex').toBe('longEdge');

    // 4. close + reopen; preset survives; applying re-seeds controls, keeps printer.
    await closeStandalonePrintWindow(app, printPage);
    printPage = await openStandalonePrintWindow(app, win);
    printPage.on('pageerror', (e) => pageErrors.push(`[print] ${String(e).slice(0, 400)}`));
    await expect(printPage.locator('[data-print-preset] option[value="Duplex greyscale"]')).toHaveCount(1);
    const printerBefore = await printPage.inputValue('[data-print-printer]');
    // Perturb away from the preset so the apply is discriminating.
    await printPage.selectOption('[data-print-duplex]', 'shortEdge');
    await printPage.selectOption('[data-print-color]', 'color');
    await printPage.selectOption('[data-print-preset]', 'Duplex greyscale');
    await expect(printPage.locator('[data-print-duplex]')).toHaveValue('longEdge');
    await expect(printPage.locator('[data-print-color]')).toHaveValue('grey');
    await expect(printPage.locator('[data-print-scale-fit]')).toBeChecked();
    expect(await printPage.inputValue('[data-print-printer]'), 'printer selection unchanged by apply').toBe(printerBefore);

    // 6. screenshot after the apply step.
    await printPage.screenshot({ path: path.join(SHOTS, 'phase81-print-presets.png') });

    // 5. empty-name fail-loud - error shown, no silent entry.
    const countBefore = await printPage.locator('[data-print-preset] option').count();
    await printPage.fill('[data-print-preset-name]', '');
    await printPage.click('[data-print-preset-save]');
    await expect(printPage.locator('[data-print-preset-error]')).toBeVisible();
    expect(await printPage.locator('[data-print-preset] option').count(), 'no silent entry added').toBe(countBefore);

    // 7. delete the selected preset; notice + list + persisted cleared.
    await printPage.click('[data-print-preset-delete]');
    await expect(printPage.locator('[data-print-preset] option[value="Duplex greyscale"]')).toHaveCount(0);
    await expect(printPage.locator('[data-print-preset-notice]')).toContainText('Deleted');
    expect(await waitForPersistedPreset(settingsPath, 'Duplex greyscale', false), 'preset removed from settings.json').toBe(true);

    expect(pageErrors, 'zero renderer page errors').toEqual([]);
  } finally {
    if (printPage && !printPage.isClosed()) await closeStandalonePrintWindow(app, printPage).catch(() => {});
    await hardClose(app, 'p81');
  }
});
