// ADV phase-36 probe 10: evidence screenshots for the filed findings.
'use strict';
const { boot, openSample, shot, gotoStage, sleep, ensureDir } = require('./lib.cjs');
const path = require('node:path');
const fs = require('node:fs');

(async () => {
  const out = {};
  const { app, window } = await boot({ profile: 'p10' });
  try {
    await openSample(app, window, 'report.pdf');
    await window.waitForTimeout(1500);

    // 1) Inspector Rotation after one CW rotate: expect 90°, actual 1°.
    await gotoStage(window, 1);
    await window.locator('.thumb-item').first().click({ button: 'right' }); await sleep(400);
    await window.locator('[data-menu-item="rotate-cw"]').first().click(); await sleep(900);
    out.rotation = await window.evaluate(() => ({
      inspectorRotation: document.querySelector('[data-inspector-value="rotation"]')?.textContent,
      pageClass: document.querySelector('.pdf-page, [data-page-view]')?.className,
    }));
    await shot(window, 'adv-p36/p10-inspector-rotation.png');

    // 2) EDIT panel "Review suspects" enabled + no-op evidence (screenshot before click).
    await gotoStage(window, 2);
    out.suspects = await window.evaluate(() => {
      const b = document.querySelector('[data-context-panel-action="suspects"]');
      return b ? { disabled: b.disabled, title: b.getAttribute('title'), rect: b.getBoundingClientRect().toJSON() } : null;
    });
    await shot(window, 'adv-p36/p10-edit-suspects.png');

    // 3) Palette: paneOpen / paneClear enabled in single mode.
    await gotoStage(window, 1);
    await window.keyboard.press('Control+k');
    await window.waitForSelector('[data-command-palette-input]', { state: 'visible' });
    await window.locator('[data-command-palette-input]').fill('pane');
    await sleep(400);
    out.paneRows = await window.evaluate(() => Array.from(document.querySelectorAll('.command-palette-row[data-palette-row="tool"]')).map((r) => ({
      id: r.getAttribute('data-palette-tool-id'), disabled: r.getAttribute('data-palette-disabled'), title: r.getAttribute('title'),
    })));
    await shot(window, 'adv-p36/p10-palette-pane.png');
    await window.keyboard.press('Escape'); await sleep(300);

    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p10.json'), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error('PROBE-ERROR', err && err.stack || err);
    fs.writeFileSync(path.join(__dirname, 'out', 'p10.error.txt'), String(err && err.stack || err));
  } finally {
    await Promise.race([app.close(), sleep(6000)]).catch(() => {});
  }
})();
