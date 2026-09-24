// ADV phase-36 probe 11: confirm the palette's enabled-but-no-op commands and
// contrast them with the dock / native menu gates.
'use strict';
const { boot, openSample, sleep, ensureDir } = require('./lib.cjs');
const path = require('node:path');
const fs = require('node:fs');

const out = {};
const snap = (window) => window.evaluate(() => ({
  modal: document.querySelectorAll('.modal-backdrop,.sheet-backdrop').length,
  toasts: Array.from(document.querySelectorAll('.toast,[data-toast]')).map((t) => t.textContent.trim()).join('|'),
  editToolbar: document.querySelectorAll('[data-edit-toolbar]').length,
  multi: !!document.querySelector('[data-multi-mode="true"]'),
  palette: !!document.querySelector('[data-command-palette]'),
  undoPressed: document.querySelector('[data-dock-verb="undo"]') ? 'n/a' : null,
}));

async function paletteRow(window, label) {
  await window.keyboard.press('Control+k');
  await window.waitForSelector('[data-command-palette-input]', { state: 'visible' });
  await window.locator('[data-command-palette-input]').fill(label);
  await sleep(350);
  const row = window.locator('.command-palette-row').filter({ hasText: label }).first();
  const info = { found: await row.count() > 0 };
  if (info.found) {
    info.id = await row.getAttribute('data-palette-tool-id');
    info.disabled = await row.getAttribute('data-palette-disabled');
    info.title = await row.getAttribute('title');
    const before = await snap(window);
    await row.click({ timeout: 3000 }).catch((e) => { info.clickErr = String(e.message).split('\n')[0]; });
    await sleep(900);
    const after = await snap(window);
    info.changed = JSON.stringify(before) !== JSON.stringify(after);
    info.before = before; info.after = after;
  }
  return info;
}

(async () => {
  const { app, window } = await boot({ profile: 'p11' });
  try {
    await openSample(app, window, 'report.pdf');
    await window.waitForTimeout(1500);

    out.diagBefore = await window.evaluate(() => (typeof window.tflexDiagnostics === 'function' ? window.tflexDiagnostics() : null)).catch(() => null);

    // 1) Undo on an empty history
    out.paletteUndo = await paletteRow(window, 'Undo');
    await window.keyboard.press('Escape'); await sleep(300);
    // native menu Undo enabled state
    out.nativeMenuUndo = await app.evaluate(({ Menu }) => {
      const m = Menu.getApplicationMenu();
      const u = m && m.getMenuItemById('menu.undo');
      const r = m && m.getMenuItemById('menu.redo');
      return { undo: u ? u.enabled : null, redo: r ? r.enabled : null };
    });

    // 2) editTool* with Edit mode OFF
    out.editModeState = await window.evaluate(() => document.querySelector('[data-dock-verb="editMode"]')?.getAttribute('aria-pressed'));
    out.paletteEditTextBox = await paletteRow(window, 'Add a text box');
    await window.keyboard.press('Escape'); await sleep(300);

    // dock contrast
    await window.evaluate(() => { const b = document.querySelector('[data-stage-rail] button[data-stage="edit"]'); if (b) b.click(); });
    await sleep(600);
    out.dockEditTextBox = await window.evaluate(() => {
      const b = document.querySelector('[data-dock-verb="editTextBox"]');
      return b ? { disabled: b.disabled, title: b.getAttribute('title') } : null;
    });
    await window.evaluate(() => { const b = document.querySelector('[data-stage-rail] button[data-stage="pages"]'); if (b) b.click(); });
    await sleep(400);

    // 3) paneOpen / paneClear outside Multi Mode
    out.palettePaneOpen = await paletteRow(window, 'Open a PDF into a pane');
    await window.keyboard.press('Escape'); await sleep(300);
    out.palettePaneClear = await paletteRow(window, 'Clear a pane');
    await window.keyboard.press('Escape'); await sleep(300);

    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p11.json'), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error('PROBE-ERROR', err && err.stack || err);
    fs.writeFileSync(path.join(__dirname, 'out', 'p11.error.txt'), String(err && err.stack || err));
    fs.writeFileSync(path.join(__dirname, 'out', 'p11.partial.json'), JSON.stringify(out, null, 2));
  } finally {
    await Promise.race([app.close(), sleep(6000)]).catch(() => {});
  }
})();
