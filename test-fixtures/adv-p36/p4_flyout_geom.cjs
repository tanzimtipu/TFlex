// ADV phase-36 probe 4: edit-mode-off flyout controls, Ctrl+P across all
// windows, dock icon-only geometry, context-menu clamping, palette over a dialog.
'use strict';
const { boot, openSample, shot, gotoStage, sleep, ensureDir } = require('./lib.cjs');
const path = require('node:path');
const fs = require('node:fs');

const out = {};
const log = (...a) => console.log('[p4]', ...a);

async function hardClose(app) {
  try { await Promise.race([app.close(), sleep(6000)]); } catch (_) {}
}

(async () => {
  const { app, window } = await boot({ profile: 'p4' });
  try {
    await openSample(app, window, 'report.pdf');
    await window.waitForTimeout(1500);

    // ---- ensure Edit mode OFF for the flyout checks ----
    await gotoStage(window, 2);
    const pressed = await window.evaluate(() => document.querySelector('[data-dock-verb="editMode"]')?.getAttribute('aria-pressed'));
    if (pressed === 'true') {
      await window.locator('[data-dock-verb="editMode"]').first().click();
      await sleep(600);
    }
    out.editModeOffForFlyout = await window.evaluate(() => document.querySelector('[data-dock-verb="editMode"]')?.getAttribute('aria-pressed'));

    await gotoStage(window, 3);
    await window.locator('[data-dock-verb="annotate"]').first().click();
    await sleep(700);
    // arm a colour tool (highlight) via the visible tools
    await window.evaluate(() => { const b = document.querySelector('[data-ann-tools-visible] button[data-tool="highlight"]'); if (b) b.click(); });
    await sleep(500);
    out.colorAfterHighlight = await window.evaluate(() => ({
      swatch: !!document.querySelector('[data-ann-color]'),
      current: document.querySelector('[data-ann-color]')?.getAttribute('data-color-current'),
      disabled: document.querySelector('[data-ann-tools-visible] button[data-tool="highlight"]')?.disabled ?? null,
    }));
    if (out.colorAfterHighlight.swatch) {
      await window.locator('[data-ann-color]').first().click();
      await sleep(500);
      out.colorPopover = await window.evaluate(() => ({
        popover: !!document.querySelector('[data-color-popover]'),
        presets: document.querySelectorAll('[data-color-popover] button').length,
      }));
      await window.keyboard.press('Escape'); await sleep(300);
    }
    // arm ink -> open dropdown -> pen width row
    await window.evaluate(() => { const b = document.querySelector('[data-ann-tools-visible] button[data-tool="ink"]'); if (b) b.click(); });
    await sleep(400);
    await window.evaluate(() => { const t = document.querySelector('[data-ann-dropdown-toggle]'); if (t) t.click(); });
    await sleep(500);
    out.penRow = await window.evaluate(() => ({
      row: !!document.querySelector('[data-pen-width-row]'),
      widths: Array.from(document.querySelectorAll('[data-pen-width]')).map((b) => b.getAttribute('data-pen-width')),
      inkDisabled: document.querySelector('[data-ann-tools-visible] button[data-tool="ink"]')?.disabled ?? null,
      annTool: document.querySelector('[data-ann-tools-visible] button[aria-pressed="true"]')?.getAttribute('data-tool') || null,
    }));
    await shot(window, 'adv-p36/p4-flyout-colour.png');
    await window.keyboard.press('Escape'); await sleep(300);

    // ---- dock geometry: measured vs estimate ----
    await gotoStage(window, 1);
    out.geom = {};
    for (const n of [1, 2, 3, 4]) {
      await gotoStage(window, n);
      out.geom[n] = await window.evaluate(() => {
        const dock = document.querySelector('[data-action-dock]');
        const r = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
        const host = dock && dock.parentElement;
        const hostRect = r(host);
        const page = document.querySelector('[data-page-pill]');
        const zoom = document.querySelector('[data-zoom-pill]');
        const pr = r(page), zr = r(zoom);
        const reserve = pr && zr ? 2 * Math.max(pr.right - hostRect.left, hostRect.right - zr.left) + 16 : null;
        return {
          innerWidth: window.innerWidth,
          hostWidth: hostRect ? hostRect.width : null,
          reserveComputed: reserve,
          band: dock ? Number(dock.getAttribute('data-dock-band')) : null,
          iconOnly: dock ? dock.getAttribute('data-dock-icon-only') : null,
          labelCount: document.querySelectorAll('.action-dock-label').length,
          verbCount: document.querySelectorAll('[data-dock-verb]').length,
          dockWidth: r(dock) ? Math.round(r(dock).width) : null,
          dockRect: r(dock),
          pageRect: pr, zoomRect: zr,
          labelsFitEstimateFor6: 6 * 64 + 5 * 4 + 16,
        };
      });
      out.geom[n].overlapPage = out.geom[n].dockRect && out.geom[n].pageRect
        ? (out.geom[n].dockRect.left < out.geom[n].pageRect.right && out.geom[n].pageRect.left < out.geom[n].dockRect.right && out.geom[n].dockRect.top < out.geom[n].pageRect.bottom && out.geom[n].pageRect.top < out.geom[n].dockRect.bottom) : null;
      out.geom[n].overlapZoom = out.geom[n].dockRect && out.geom[n].zoomRect
        ? (out.geom[n].dockRect.left < out.geom[n].zoomRect.right && out.geom[n].zoomRect.left < out.geom[n].dockRect.right && out.geom[n].dockRect.top < out.geom[n].zoomRect.bottom && out.geom[n].zoomRect.top < out.geom[n].dockRect.bottom) : null;
    }

    // ---- context menu clamp at the bottom-right corner ----
    await gotoStage(window, 1);
    out.menuClamp = await window.evaluate(() => {
      // Ask for a menu anchored at the very bottom-right of the viewport by
      // dispatching a real contextmenu event on the LAST thumbnail's verbs area.
      const thumbs = document.querySelectorAll('.thumb-item');
      const target = thumbs[thumbs.length - 1] || thumbs[0];
      if (!target) return null;
      const rect = target.getBoundingClientRect();
      const ev = new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: window.innerWidth - 1, clientY: window.innerHeight - 1,
        button: 2,
      });
      target.dispatchEvent(ev);
      void rect;
      return true;
    });
    await sleep(500);
    out.menuClampResult = await window.evaluate(() => {
      const m = document.querySelector('[data-context-menu]');
      if (!m) return { open: false };
      const r = m.getBoundingClientRect();
      return {
        open: true,
        rect: r.toJSON(),
        innerWidth: window.innerWidth, innerHeight: window.innerHeight,
        inViewport: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
        items: Array.from(m.querySelectorAll('[data-menu-item]')).map((b) => b.getAttribute('data-menu-item')),
      };
    });
    await shot(window, 'adv-p36/p4-menu-clamp.png');
    await window.keyboard.press('Escape'); await sleep(300);

    // ---- palette over an open dialog ----
    await gotoStage(window, 3);
    await window.locator('[data-dock-verb="stamp"]').first().click();
    await sleep(700);
    const dialogOpen = await window.evaluate(() => !!document.querySelector('[data-stamp-dialog], .modal-backdrop'));
    await window.keyboard.press('Control+k');
    await sleep(500);
    out.paletteOverDialog = await window.evaluate(() => ({
      dialogOpenBefore: true,
      dialogStill: !!document.querySelector('[data-stamp-dialog], .modal-backdrop'),
      paletteOpen: !!document.querySelector('[data-command-palette]'),
    }));
    await window.keyboard.press('Escape'); await sleep(400);
    out.paletteOverDialog.afterEsc = await window.evaluate(() => ({
      paletteOpen: !!document.querySelector('[data-command-palette]'),
      dialogOpen: !!document.querySelector('[data-stamp-dialog], .modal-backdrop'),
    }));
    await window.keyboard.press('Escape'); await sleep(300);

    // ---- Ctrl+P via native input event, checking every window ----
    await gotoStage(window, 1);
    await window.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    const beforeWindows = app.windows().length;
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (!w) return;
      w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'P', modifiers: ['control'] });
      w.webContents.sendInputEvent({ type: 'char', keyCode: 'P', modifiers: ['control'] });
      w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'P', modifiers: ['control'] });
    });
    await sleep(3000);
    out.ctrlP = {
      windowsBefore: beforeWindows,
      windowsAfter: app.windows().length,
      printInMain: await window.evaluate(() => ({ shell: !!document.querySelector('[data-print-dialog-shell]'), dialog: !!document.querySelector('[data-print-dialog]') })),
      titles: app.windows().map((w) => w.url ? w.url().slice(0, 80) : ''),
    };
    // close any extra windows
    for (const w of app.windows()) { if (w !== window) { await w.close().catch(() => {}); } }
    await window.keyboard.press('Escape'); await sleep(400);

    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p4.json'), JSON.stringify(out, null, 2));
    log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error('PROBE-ERROR', err && err.stack || err);
    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p4.error.txt'), String(err && err.stack || err));
    fs.writeFileSync(path.join(__dirname, 'out', 'p4.partial.json'), JSON.stringify(out, null, 2));
  } finally {
    for (const w of app.windows()) { if (w !== window) { await w.close().catch(() => {}); } }
    await hardClose(app);
  }
})();
