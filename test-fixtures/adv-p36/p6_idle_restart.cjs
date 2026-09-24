// ADV phase-36 probe 6: pin persistence across restart, idle suppression while
// armed / dragging, and Ctrl+P print verification.
'use strict';
const { boot, openSample, shot, gotoStage, sleep, ensureDir } = require('./lib.cjs');
const path = require('node:path');
const fs = require('node:fs');

const out = {};
const log = (...a) => console.log('[p6]', ...a);

const dockInfo = (window) => window.evaluate(() => {
  const d = document.querySelector('[data-action-dock]');
  return {
    present: !!d,
    state: d ? d.getAttribute('data-dock-state') : null,
    idle: d ? d.getAttribute('data-dock-idle') : null,
    pins: Array.from(document.querySelectorAll('[data-dock-pin]')).map((b) => b.getAttribute('data-dock-pin')),
    inline: Array.from(document.querySelectorAll('[data-dock-verb]')).map((b) => b.getAttribute('data-dock-verb')),
  };
});

(async () => {
  // Same userDataDir as p5 => the persisted pins must survive.
  const { app, window } = await boot({ profile: 'p5' });
  try {
    out.settingsBefore = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'userdata', 'p5', 'settings.json'), 'utf8')).dockPins; } catch (e) { return String(e.message); } })();
    await openSample(app, window, 'report.pdf');
    await window.waitForTimeout(1500);
    await gotoStage(window, 1);
    out.afterRestart = await dockInfo(window);

    // ---- idle suppression while an annotation tool is armed ----
    await gotoStage(window, 3);
    if (await window.locator('[data-annotation-flyout]').count() === 0) {
      await window.locator('[data-dock-verb="annotate"]').first().click();
      await sleep(600);
    }
    await window.evaluate(() => { const b = document.querySelector('[data-ann-tools-visible] button[data-tool="highlight"]'); if (b) b.click(); });
    await sleep(400);
    await window.mouse.move(5, 5);
    await sleep(3600);
    out.idleWhileAnnotationArmed = await window.evaluate(() => ({
      annTool: document.querySelector('[data-ann-tools-visible] button[aria-pressed="true"]')?.getAttribute('data-tool') || null,
      idle: document.querySelector('[data-action-dock]')?.getAttribute('data-dock-idle'),
    }));
    await window.keyboard.press('Escape'); await sleep(200);
    await window.evaluate(() => { const b = document.querySelector('[data-ann-tools-visible] button[data-tool="select"]'); if (b) b.click(); });
    await sleep(300);

    // ---- idle suppression while a drag is in progress ----
    await gotoStage(window, 1);
    await window.mouse.move(5, 5);
    await window.evaluate(() => {
      const t = document.querySelector('.thumb-item');
      if (t) t.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
    });
    await sleep(3600);
    out.idleWhileDragging = await window.evaluate(() => document.querySelector('[data-action-dock]')?.getAttribute('data-dock-idle'));
    await window.evaluate(() => {
      const t = document.querySelector('.thumb-item');
      if (t) t.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true }));
    });
    await sleep(400);

    // ---- pan mode armed => idle suppressed? ----
    await gotoStage(window, 1);
    await window.locator('[data-hand-toggle]').first().click();
    await sleep(300);
    await window.mouse.move(5, 5);
    await sleep(3600);
    out.idleWhileHandActive = await window.evaluate(() => ({
      hand: document.querySelector('[data-hand-toggle]')?.getAttribute('data-hand-active'),
      idle: document.querySelector('[data-action-dock]')?.getAttribute('data-dock-idle'),
    }));
    await window.locator('[data-hand-toggle]').first().click();
    await sleep(300);

    // ---- Ctrl+P / print path ----
    out.menu = await app.evaluate(({ Menu }) => {
      const m = Menu.getApplicationMenu();
      if (!m) return { menu: null };
      const item = m.getMenuItemById('menu.print');
      return { menu: true, printItem: item ? { label: item.label, accelerator: item.accelerator, enabled: item.enabled } : null };
    });
    // Invoke the native menu item's click (the exact action Ctrl+P fires).
    await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu() && Menu.getApplicationMenu().getMenuItemById('menu.print');
      if (item) item.click();
    });
    await sleep(2500);
    out.printViaMenuItem = await window.evaluate(() => ({
      shell: !!document.querySelector('[data-print-dialog-shell]'),
      dialog: !!document.querySelector('[data-print-dialog]'),
      palette: !!document.querySelector('[data-command-palette]'),
    }));
    out.windowsAfterPrint = app.windows().length;
    await shot(window, 'adv-p36/p6-print.png');
    for (const w of app.windows()) { if (w !== window) { await w.close().catch(() => {}); } }
    await window.keyboard.press('Escape'); await sleep(500);
    await window.evaluate(() => { const b = document.querySelector('.sheet-backdrop'); if (b) { const c = b.querySelector('.modal-close'); if (c) c.click(); } });
    await sleep(300);

    // Title-bar Print button
    await gotoStage(window, 1);
    const printBtn = window.locator('[data-titlebar-controls]').locator('xpath=..').locator('button[aria-label*="Print"], button[title*="Print"]');
    out.titlebarPrintCount = await printBtn.count();

    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p6.json'), JSON.stringify(out, null, 2));
    log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error('PROBE-ERROR', err && err.stack || err);
    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p6.error.txt'), String(err && err.stack || err));
    fs.writeFileSync(path.join(__dirname, 'out', 'p6.partial.json'), JSON.stringify(out, null, 2));
  } finally {
    for (const w of app.windows()) { if (w !== window) { await w.close().catch(() => {}); } }
    await Promise.race([app.close(), sleep(6000)]).catch(() => {});
  }
})();
