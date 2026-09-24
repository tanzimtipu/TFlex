// ADV phase-36 probe 3: focused checks for ambiguous entries, dock geometry,
// the single-mode pane-command no-op, and the Ctrl+P contract.
'use strict';
const { boot, openSample, shot, gotoStage, sleep, ensureDir } = require('./lib.cjs');
const path = require('node:path');
const fs = require('node:fs');

const out = {};
const log = (...a) => console.log('[p3]', ...a);

async function dockGeom(window) {
  return window.evaluate(() => {
    const dock = document.querySelector('[data-action-dock]');
    const host = dock && dock.parentElement;
    const r = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
    const verbLabels = Array.from(document.querySelectorAll('.action-dock-label')).map((s) => s.textContent);
    return {
      innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      hostClientWidth: host ? host.clientWidth : null,
      hostRect: r(host),
      dockRect: r(dock),
      dockBand: dock && dock.getAttribute('data-dock-band'),
      dockIconOnly: dock && dock.getAttribute('data-dock-icon-only'),
      dockCompact: dock && dock.getAttribute('data-dock-compact'),
      dockLift: dock && dock.getAttribute('data-dock-lift'),
      labelCount: verbLabels.length, verbLabels,
      verbCount: document.querySelectorAll('[data-dock-verb]').length,
      pagePill: r(document.querySelector('[data-page-pill]')),
      zoomPill: r(document.querySelector('[data-zoom-pill]')),
      reserve: dock ? getComputedStyle(dock).getPropertyValue('--dock-reserve') : null,
      lift: dock ? getComputedStyle(dock).getPropertyValue('--dock-lift') : null,
    };
  });
}

function overlap(a, b) {
  if (!a || !b) return null;
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

(async () => {
  const { app, window } = await boot({ profile: 'p3' });
  try {
    // Welcome-screen reachability FIRST (before any document is open).
    out.welcome = await window.evaluate(() => ({
      buttons: Array.from(document.querySelectorAll('button')).map((b) => (b.textContent || '').trim()).filter(Boolean),
      samples: document.querySelectorAll('[data-sample], .sample-card, [data-welcome-sample]').length,
      recents: document.querySelectorAll('[data-recent], .recent-row, [data-recent-row]').length,
    }));
    await shot(window, 'adv-p36/p3-welcome.png');

    // Ctrl+K on the welcome screen (no document) must open the palette.
    await window.keyboard.press('Control+k');
    await sleep(500);
    out.paletteOnWelcome = await window.evaluate(() => !!document.querySelector('[data-command-palette]'));
    out.paletteWelcomeRows = await window.evaluate(() => ({
      count: document.querySelector('[data-command-palette-count]')?.getAttribute('data-command-palette-count'),
      recents: Array.from(document.querySelectorAll('[data-palette-row="recent"]')).length,
      openSampleDisabled: document.querySelector('[data-palette-tool-id="openSample"]')?.getAttribute('data-palette-disabled'),
      openDisabled: document.querySelector('[data-palette-tool-id="open"]')?.getAttribute('data-palette-disabled'),
    }));
    await window.keyboard.press('Escape');
    await sleep(300);

    await openSample(app, window, 'report.pdf');
    await window.waitForTimeout(1500);

    // ---- dock geometry per stage at the natural window size ----
    out.geom = {};
    for (const n of [1, 2, 3, 4]) {
      await gotoStage(window, n);
      const g = await dockGeom(window);
      out.geom[n] = {
        ...g,
        overlapPage: overlap(g.dockRect, g.pagePill),
        overlapZoom: overlap(g.dockRect, g.zoomPill),
      };
    }
    await shot(window, 'adv-p36/p3-dock-pages.png');

    // Ctrl+P must still print (criterion 5).
    await gotoStage(window, 1);
    await window.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await window.keyboard.press('Control+p');
    await sleep(1200);
    out.ctrlP = await window.evaluate(() => ({
      printShell: !!document.querySelector('[data-print-dialog-shell]'),
      printDialog: !!document.querySelector('[data-print-dialog]'),
      paletteOpen: !!document.querySelector('[data-command-palette]'),
    }));
    await window.keyboard.press('Escape'); await sleep(300);
    await window.evaluate(() => { const b = document.querySelector('.sheet-backdrop'); if (b) { const c = b.querySelector('.modal-close'); if (c) c.click(); } });
    await sleep(400);

    // Ctrl+Shift+P legacy alias.
    await window.keyboard.press('Control+Shift+p');
    await sleep(500);
    out.legacyAlias = await window.evaluate(() => !!document.querySelector('[data-command-palette]'));
    await window.keyboard.press('Control+k'); await sleep(400); // toggle closed via Ctrl+K
    out.ctrlKTogglesClosed = await window.evaluate(() => !document.querySelector('[data-command-palette]'));

    // ---- cropPages on the EDIT dock ----
    await gotoStage(window, 2);
    out.cropPages = await window.evaluate(() => {
      const v = document.querySelector('[data-dock-verb="cropPages"]');
      const ov = document.querySelector('[data-dock-overflow]');
      return {
        inline: !!v, disabled: v ? v.disabled : null, title: v ? v.getAttribute('title') : null,
        overflowChip: !!ov,
        allInline: Array.from(document.querySelectorAll('[data-dock-verb]')).map((b) => b.getAttribute('data-dock-verb')),
        editModePressed: document.querySelector('[data-dock-verb="editMode"]')?.getAttribute('aria-pressed'),
        editToolbar: !!document.querySelector('[data-edit-toolbar]'),
      };
    });
    if (await window.locator('[data-dock-verb="cropPages"]').count() > 0) {
      await window.locator('[data-dock-verb="cropPages"]').first().click();
      await sleep(700);
      out.cropPages.after = await window.evaluate(() => Array.from(document.querySelectorAll('.modal-title,.sheet-title')).map((t) => t.textContent.trim()));
      await window.keyboard.press('Escape'); await sleep(300);
      await window.evaluate(() => { const b = document.querySelector('.modal-backdrop'); if (b) { const c = b.querySelector('.modal-close'); if (c) c.click(); } });
      await sleep(300);
    }

    // ---- editToolOff + editDefaultFont through the edit toolbar ----
    await gotoStage(window, 2);
    await window.waitForTimeout(300);
    const editPressed = await window.evaluate(() => document.querySelector('[data-dock-verb="editMode"]')?.getAttribute('aria-pressed'));
    if (editPressed !== 'true') {
      await window.locator('[data-dock-verb="editMode"]').first().click();
      await sleep(700);
    }
    out.editModeOn = await window.evaluate(() => ({
      toolbar: !!document.querySelector('[data-edit-toolbar]'),
      fontSelect: (() => { const s = document.querySelector('[data-edit-toolbar] select'); return s ? { options: s.options.length, value: s.value } : null; })(),
      offButton: !!document.querySelector('[data-edit-toolbar] button[data-edit-tool="off"]'),
      tools: Array.from(document.querySelectorAll('[data-edit-toolbar] button[data-edit-tool]')).map((b) => b.getAttribute('data-edit-tool')),
    }));
    await shot(window, 'adv-p36/p3-edittoolbar.png');
    if (out.editModeOn.offButton) {
      await window.locator('[data-edit-toolbar] button[data-edit-tool="off"]').first().click();
      await sleep(500);
      out.editToolOff = await window.evaluate(() => ({
        pressed: Array.from(document.querySelectorAll('[data-edit-toolbar] button[aria-pressed="true"]')).map((b) => b.getAttribute('data-edit-tool')),
        editModeVerbPressed: document.querySelector('[data-dock-verb="editMode"]')?.getAttribute('aria-pressed'),
      }));
    }

    // ---- rotateCounterClockwise via the page context menu ----
    await gotoStage(window, 1);
    const rotBefore = await window.evaluate(() => document.querySelector('[data-inspector-value="rotation"]')?.textContent);
    const thumb = window.locator('.thumb-item').first();
    await thumb.click({ button: 'right' });
    await sleep(400);
    const ccw = window.locator('[data-menu-item="rotate-ccw"]');
    out.ccw = { menuItem: await ccw.count() > 0 };
    if (out.ccw.menuItem) {
      await ccw.first().click();
      await sleep(900);
      out.ccw.rotation = `${rotBefore} -> ${await window.evaluate(() => document.querySelector('[data-inspector-value="rotation"]')?.textContent)}`;
      // undo the rotation to restore the copy
      await window.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
      await window.keyboard.press('Control+z');
      await sleep(700);
    }

    // ---- renumberPages via the Inspector Label action ----
    await gotoStage(window, 1);
    const renum = window.locator('[data-inspector-action="renumber"]');
    out.renumber = { present: await renum.count() > 0, disabled: await renum.first().isDisabled().catch(() => null) };
    if (out.renumber.present) {
      await renum.first().click();
      await sleep(700);
      out.renumber.after = await window.evaluate(() => Array.from(document.querySelectorAll('.modal-title,.sheet-title')).map((t) => t.textContent.trim()));
      out.renumber.dialog = await window.evaluate(() => !!document.querySelector('[data-renumber-pages-dialog]'));
      await window.keyboard.press('Escape'); await sleep(300);
      await window.evaluate(() => { const b = document.querySelector('.modal-backdrop'); if (b) { const c = b.querySelector('.modal-close'); if (c) c.click(); } });
      await sleep(300);
    }

    // ---- flyout DOM dump (annColor / annPenWidth) ----
    await gotoStage(window, 3);
    if (await window.locator('[data-annotation-flyout]').count() === 0) {
      await window.locator('[data-dock-verb="annotate"]').first().click();
      await sleep(600);
    }
    out.flyout = await window.evaluate(() => {
      const f = document.querySelector('[data-annotation-flyout]');
      return {
        present: !!f,
        rect: f ? f.getBoundingClientRect().toJSON() : null,
        hasColor: !!document.querySelector('[data-ann-color]'),
        colorCurrent: document.querySelector('[data-ann-color]')?.getAttribute('data-color-current'),
        hasDropdownToggle: !!document.querySelector('[data-ann-dropdown-toggle]'),
        toolsVisible: Array.from(document.querySelectorAll('[data-ann-tools-visible] button[data-tool]')).map((b) => b.getAttribute('data-tool')),
        toolbarPresent: !!document.querySelector('[data-annotation-toolbar]'),
        html: f ? f.innerHTML.slice(0, 1200) : null,
      };
    });
    // arm ink then find the pen width row
    await window.evaluate(() => { const b = document.querySelector('[data-ann-tools-visible] button[data-tool="ink"]'); if (b) b.click(); });
    await sleep(300);
    await window.evaluate(() => { const t = document.querySelector('[data-ann-dropdown-toggle]'); if (t) t.click(); });
    await sleep(500);
    out.penWidth = await window.evaluate(() => ({
      row: !!document.querySelector('[data-pen-width-row]'),
      widths: Array.from(document.querySelectorAll('[data-pen-width]')).map((b) => b.getAttribute('data-pen-width')),
      menuOpen: !!document.querySelector('[data-ann-dropdown-menu]'),
    }));
    await shot(window, 'adv-p36/p3-flyout.png');
    await window.keyboard.press('Escape'); await sleep(300);

    // ---- single-mode pane commands via the palette (silent no-op hunt) ----
    const paneCmd = async (id, label) => {
      await window.keyboard.press('Control+k');
      await window.waitForSelector('[data-command-palette-input]', { state: 'visible' });
      await window.locator('[data-command-palette-input]').fill(label);
      await sleep(300);
      const row = window.locator('.command-palette-row').filter({ hasText: label }).first();
      const info = { found: await row.count() > 0, id };
      if (info.found) {
        info.disabled = await row.getAttribute('data-palette-disabled');
        info.title = await row.getAttribute('title');
        const before = await window.evaluate(() => ({
          palette: !!document.querySelector('[data-command-palette]'),
          modal: document.querySelectorAll('.modal-backdrop,.sheet-backdrop').length,
          toasts: Array.from(document.querySelectorAll('.toast,[data-toast]')).map((t) => t.textContent.trim()),
          multimode: !!document.querySelector('[data-multi-mode-pane], [data-pane-a], .multi-pane, [data-multi-pane]'),
          tabs: document.querySelectorAll('.app-tab, [data-tab]').length,
        }));
        await row.click({ timeout: 3000 }).catch((e) => { info.clickError = String(e.message).split('\n')[0]; });
        await sleep(800);
        const after = await window.evaluate(() => ({
          palette: !!document.querySelector('[data-command-palette]'),
          modal: document.querySelectorAll('.modal-backdrop,.sheet-backdrop').length,
          toasts: Array.from(document.querySelectorAll('.toast,[data-toast]')).map((t) => t.textContent.trim()),
          multimode: !!document.querySelector('[data-multi-mode-pane], [data-pane-a], .multi-pane, [data-multi-pane]'),
          tabs: document.querySelectorAll('.app-tab, [data-tab]').length,
        }));
        info.before = before; info.after = after;
        info.observable = JSON.stringify(before) !== JSON.stringify(after);
      }
      return info;
    };
    out.paneOpenSingle = await paneCmd('paneOpen', 'Open a PDF into a pane');
    out.paneClearSingle = await paneCmd('paneClear', 'Clear a pane');
    await window.keyboard.press('Escape'); await sleep(200);

    // ---- fit width / fit page through the zoom pill ----
    await gotoStage(window, 1);
    const fitCheck = async (aria) => {
      const b = window.locator(`[data-zoom-pill] button[aria-label="${aria}"]`);
      const present = await b.count() > 0;
      if (!present) return { present };
      await b.first().click(); await sleep(700);
      return {
        present,
        pressed: await b.first().getAttribute('aria-pressed'),
        zoom: await window.evaluate(() => document.querySelector('[data-zoom-pill] .zoom-percent')?.textContent),
      };
    };
    out.fitWidth = await fitCheck('Fit width');
    out.fitPage = await fitCheck('Fit page');

    // ---- undo / redo via palette after a real mutation ----
    await gotoStage(window, 1);
    await window.locator('.thumb-item').first().click({ button: 'right' }); await sleep(300);
    await window.locator('[data-menu-item="rotate-cw"]').first().click(); await sleep(800);
    await window.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    const runPalette = async (label) => {
      await window.keyboard.press('Control+k');
      await window.waitForSelector('[data-command-palette-input]', { state: 'visible' });
      await window.locator('[data-command-palette-input]').fill(label);
      await sleep(300);
      const before = await window.evaluate(() => document.querySelector('[data-inspector-value="rotation"]')?.textContent);
      const row = window.locator('.command-palette-row').filter({ hasText: label }).first();
      const dis = await row.getAttribute('data-palette-disabled');
      await row.click({ timeout: 3000 }).catch(() => {});
      await sleep(800);
      const after = await window.evaluate(() => document.querySelector('[data-inspector-value="rotation"]')?.textContent);
      return { disabled: dis, rotation: `${before} -> ${after}` };
    };
    out.undo = await runPalette('Undo');
    out.redo = await runPalette('Redo');

    // ---- multi-mode toggle via the palette ----
    await window.keyboard.press('Control+k');
    await window.waitForSelector('[data-command-palette-input]', { state: 'visible' });
    await window.locator('[data-command-palette-input]').fill('Multi Mode');
    await sleep(300);
    await window.locator('.command-palette-row').filter({ hasText: 'Multi Mode' }).first().click();
    await sleep(1000);
    out.multiMode = await window.evaluate(() => ({
      togglePressed: document.querySelector('[data-header-multi-mode]')?.getAttribute('aria-pressed'),
      panes: document.querySelectorAll('[data-multi-pane], .multi-pane, [data-pane]').length,
      sharedDock: !!document.querySelector('[data-action-dock]'),
      dockCount: document.querySelectorAll('[data-action-dock]').length,
    }));
    await shot(window, 'adv-p36/p3-multi.png');
    // leave multi mode
    await window.evaluate(() => { const t = document.querySelector('[data-header-multi-mode]'); if (t && t.getAttribute('aria-pressed') === 'true') t.click(); });
    await sleep(800);

    // ---- theme toggle via palette ----
    const themeBefore = await window.evaluate(() => document.documentElement.getAttribute('data-theme') || document.body.getAttribute('data-theme'));
    await runPalette('Toggle Theme');
    out.theme = { before: themeBefore, after: await window.evaluate(() => document.documentElement.getAttribute('data-theme') || document.body.getAttribute('data-theme')) };

    // ---- Rail collapse via the ContextPanel header ----
    await gotoStage(window, 1);
    const rc = window.locator('[data-rail-collapse]').first();
    out.railCollapse = { present: await rc.count() > 0 };
    if (out.railCollapse.present) {
      out.railCollapse.before = await window.evaluate(() => document.querySelector('[data-context-panel]')?.getAttribute('data-context-panel-collapsed'));
      await rc.click(); await sleep(600);
      out.railCollapse.after = await window.evaluate(() => document.querySelector('[data-context-panel]')?.getAttribute('data-context-panel-collapsed'));
      await shot(window, 'adv-p36/p3-collapsed.png');
    }

    // ---- File menu ----
    await window.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    await window.locator('[data-menu-button]').first().click();
    await sleep(400);
    out.fileMenu = await window.evaluate(() => ({
      open: !!document.querySelector('[data-menu-popover]'),
      groups: Array.from(document.querySelectorAll('[data-menu-popover] [data-menu-action]')).map((b) => b.getAttribute('data-menu-action')),
      text: (document.querySelector('[data-menu-popover]')?.textContent || '').replace(/\s+/g, ' ').trim(),
    }));
    await shot(window, 'adv-p36/p3-filemenu.png');
    await window.keyboard.press('Escape');

    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p3.json'), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error('PROBE-ERROR', err && err.stack || err);
    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p3.error.txt'), String(err && err.stack || err));
    fs.writeFileSync(path.join(__dirname, 'out', 'p3.partial.json'), JSON.stringify(out, null, 2));
  } finally {
    await app.close().catch(() => {});
  }
})();
