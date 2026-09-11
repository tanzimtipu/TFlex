const { test } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./../lib/launch.cjs');
test('DEF-189 evidence shot', async () => {
  test.setTimeout(240000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, reportPath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await win.waitForTimeout(1500);
  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
  await win.waitForTimeout(600);
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.waitForTimeout(500);
  const facts = await win.evaluate(() => {
    const pop = document.querySelector('.theme-toggle-popover');
    const pal = document.querySelector('[data-tools-palette]');
    const opt = document.querySelector('[data-theme-option="light"]');
    const b = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    const center = opt ? opt.getBoundingClientRect() : null;
    const hitEl = center ? document.elementFromPoint(center.x + center.width / 2, center.y + center.height / 2) : null;
    return {
      popover: pop ? b(pop) : null, palette: pal ? b(pal) : null, lightOption: opt ? b(opt) : null,
      popoverZ: pop ? getComputedStyle(pop).zIndex : null,
      paletteZ: pal ? getComputedStyle(pal).zIndex : null,
      titlebarZ: getComputedStyle(document.querySelector('.titlebar')).zIndex,
      hitAtLightCenter: hitEl ? `${hitEl.tagName}.${String(hitEl.className).slice(0, 30)}` : null,
    };
  });
  console.log(JSON.stringify(facts, null, 1));
  await win.screenshot({ path: path.resolve(__dirname, '..', '..', 'screenshots', 'def-189-evidence.png'), clip: { x: 900, y: 0, width: 540, height: 400 } });
  await electronApp.close();
});
