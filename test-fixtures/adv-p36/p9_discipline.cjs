// ADV phase-36 probe 9: surface discipline (runtime), DEF-321 single text panel,
// no-op sweep of the remaining Phase 36 controls, narrow title-bar "+" click.
'use strict';
const { boot, openSample, shot, gotoStage, sleep, ensureDir } = require('./lib.cjs');
const path = require('node:path');
const fs = require('node:fs');

const out = {};
const log = (...a) => console.log('[p9]', ...a);

async function resize(app, w, h) {
  await app.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows()[0]; if (!win) return; if (win.isMaximized()) win.unmaximize(); win.setSize(size.w, size.h); }, { w, h });
  await sleep(800);
}
const sig = (window) => window.evaluate(() => ({
  modal: document.querySelectorAll('.modal-backdrop,.sheet-backdrop').length,
  titles: Array.from(document.querySelectorAll('.modal-title,.sheet-title')).map((t) => t.textContent.trim()),
  stage: document.querySelector('[data-stage-rail]')?.getAttribute('data-active-stage') || null,
  collapsed: document.querySelector('[data-context-panel]')?.getAttribute('data-context-panel-collapsed') || null,
  outlineBody: !!document.querySelector('[data-context-panel-outline-body]'),
  suspects: !!document.querySelector('[data-ocr-suspects-panel]'),
  textPanels: document.querySelectorAll('[data-text-panel]').length,
  inspectText: !!document.querySelector('[data-inspector-text-panel]'),
  annToolbars: document.querySelectorAll('[data-annotation-toolbar]').length,
  annPanels: document.querySelectorAll('[data-annotation-panel]').length,
  pageCount: document.querySelector('[data-page-pill] .page-total')?.textContent || null,
  rotation: document.querySelector('[data-inspector-value="rotation"]')?.textContent || null,
  toast: Array.from(document.querySelectorAll('.toast,[data-toast]')).map((t) => t.textContent.trim()).join('|'),
}));

async function clickObserve(window, label, fn) {
  const before = await sig(window);
  const err = await fn().then(() => null).catch((e) => String(e.message).split('\n')[0]);
  await sleep(700);
  const after = await sig(window);
  return { label, err, changed: JSON.stringify(before) !== JSON.stringify(after), before: before.titles, after: after.titles, delta: Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map((k) => `${k}:${JSON.stringify(before[k])}->${JSON.stringify(after[k])}`) };
}

(async () => {
  const { app, window } = await boot({ profile: 'p9' });
  try {
    await openSample(app, window, 'report.pdf');
    await window.waitForTimeout(1500);

    // ---- surface discipline: PAGES selection ----
    await gotoStage(window, 1);
    await window.locator('.thumb-item').nth(2).click(); await sleep(500);
    out.pagesInspector = await window.evaluate(() => ({
      sections: Array.from(document.querySelectorAll('[data-inspector-section]')).map((s) => s.getAttribute('data-inspector-section')),
      rows: Array.from(document.querySelectorAll('[data-inspector-row]')).map((r) => r.getAttribute('data-inspector-row')),
      actions: Array.from(document.querySelectorAll('[data-inspector-action]')).map((a) => a.getAttribute('data-inspector-action')),
      hasCropRow: !!document.querySelector('[data-inspector-row="cropbox"]') || !!document.querySelector('[data-inspector-row="cropbox-x"]'),
      hasOcrRow: !!document.querySelector('[data-inspector-row="ocr"]'),
      rotation: document.querySelector('[data-inspector-value="rotation"]')?.textContent,
      label: document.querySelector('[data-inspector-value="label"]')?.textContent,
      annCount: document.querySelector('[data-inspector-annotations-count]')?.textContent,
    }));

    // jump-to-review
    out.jumpToReview = await clickObserve(window, 'jump-to-review', () => window.locator('[data-inspector-action="jump-to-review"]').first().click());
    out.reviewAfterJump = await window.evaluate(() => ({
      sections: Array.from(document.querySelectorAll('[data-inspector-section]')).map((s) => s.getAttribute('data-inspector-section')),
      reference: !!document.querySelector('[data-inspector-annotations-reference]'),
      annPanels: document.querySelectorAll('[data-annotation-panel]').length,
      annListRows: document.querySelectorAll('[data-annotation-panel] [data-annotation-row], [data-annotation-panel] li').length,
      panelSections: Array.from(document.querySelectorAll('[data-context-panel-section]')).map((s) => s.getAttribute('data-context-panel-section')),
      panelAnn: !!document.querySelector('[data-context-panel-annotations]'),
    }));
    await shot(window, 'adv-p36/p9-review-discipline.png');

    // ---- EDIT: OCR only in the panel, cropbox only in the inspector ----
    await gotoStage(window, 2);
    await window.locator('.thumb-item').nth(2).click().catch(() => {});
    await sleep(400);
    out.editDiscipline = await window.evaluate(() => ({
      panelSections: Array.from(document.querySelectorAll('[data-context-panel-section]')).map((s) => s.getAttribute('data-context-panel-section')),
      panelOcrStatus: document.querySelector('[data-ocr-status]')?.textContent,
      inspectorSections: Array.from(document.querySelectorAll('[data-inspector-section]')).map((s) => s.getAttribute('data-inspector-section')),
      inspectorRows: Array.from(document.querySelectorAll('[data-inspector-row]')).map((r) => r.getAttribute('data-inspector-row')),
      inspectorOcrRow: !!document.querySelector('[data-inspector-row="ocr"]'),
      inspectorOcrStatus: !!document.querySelector('[data-inspector-slot="ocr-suspects"]'),
    }));

    // ---- DEF-321: place a text box and count [data-text-panel] ----
    await gotoStage(window, 2);
    if ((await window.evaluate(() => document.querySelector('[data-dock-verb="editMode"]')?.getAttribute('aria-pressed'))) !== 'true') {
      await window.locator('[data-dock-verb="editMode"]').first().click(); await sleep(700);
    }
    await window.locator('[data-dock-verb="editTextBox"]').first().click(); await sleep(500);
    const page = window.locator('.pdf-page, .document-page, [data-page-view]').first();
    const box = await page.boundingBox().catch(() => null);
    out.textBoxPlace = { pageBox: box };
    if (box) {
      await window.mouse.move(box.x + 60, box.y + 60);
      await window.mouse.down();
      await window.mouse.move(box.x + 200, box.y + 130, { steps: 8 });
      await window.mouse.up();
      await sleep(900);
    }
    out.textPanelsAfterPlace = await sig(window);

    // ---- REVIEW: exactly one annotation toolbar/panel ----
    await gotoStage(window, 3);
    if (await window.locator('[data-annotation-flyout]').count() === 0) { await window.locator('[data-dock-verb="annotate"]').first().click(); await sleep(600); }
    out.reviewCounts = await window.evaluate(() => ({
      flyouts: document.querySelectorAll('[data-annotation-flyout]').length,
      toolbars: document.querySelectorAll('[data-annotation-toolbar]').length,
      annPanels: document.querySelectorAll('[data-annotation-panel]').length,
      panelSections: Array.from(document.querySelectorAll('[data-context-panel-section]')).map((s) => s.getAttribute('data-context-panel-section')),
    }));
    await window.keyboard.press('Escape'); await sleep(300);

    // ---- no-op sweep of Phase 36 controls ----
    out.sweep = [];
    await gotoStage(window, 1);
    out.sweep.push(await clickObserve(window, 'combine', () => window.locator('[data-context-panel-combine]').first().click()));
    await window.keyboard.press('Escape'); await sleep(400);
    await window.evaluate(() => { const b = document.querySelector('.modal-backdrop'); if (b) { const c = b.querySelector('.modal-close'); if (c) c.click(); } }); await sleep(300);
    out.sweep.push(await clickObserve(window, 'collapse', () => window.locator('[data-rail-collapse]').first().click()));
    out.sweep.push(await clickObserve(window, 'collapse-back', () => window.locator('[data-rail-collapse]').first().click()));
    out.sweep.push(await clickObserve(window, 'outline-toggle', () => window.locator('[data-outline-toggle]').first().click()));
    out.sweep.push(await clickObserve(window, 'outline-toggle-back', () => window.locator('[data-outline-toggle]').first().click()));
    await gotoStage(window, 2);
    out.sweep.push(await clickObserve(window, 'panel-recognize', () => window.locator('[data-context-panel-action="recognize"]').first().click()));
    await window.keyboard.press('Escape'); await sleep(400);
    await window.evaluate(() => { const b = document.querySelector('.modal-backdrop'); if (b) { const c = b.querySelector('.modal-close'); if (c) c.click(); } }); await sleep(300);
    out.sweep.push(await clickObserve(window, 'panel-suspects', () => window.locator('[data-context-panel-action="suspects"]').first().click()));
    await gotoStage(window, 3);
    out.sweep.push(await clickObserve(window, 'panel-manage-signatures', () => window.locator('[data-context-panel-action="manage-signatures"]').first().click()));
    await window.keyboard.press('Escape'); await sleep(400);
    await window.evaluate(() => { const b = document.querySelector('.modal-backdrop'); if (b) { const c = b.querySelector('.modal-close'); if (c) c.click(); } }); await sleep(300);
    out.sweep.push(await clickObserve(window, 'inspector-export-comments', () => window.locator('[data-inspector-action="export-comments"]').first().click()));
    await window.keyboard.press('Escape'); await sleep(400);
    await window.evaluate(() => { const b = document.querySelector('.modal-backdrop'); if (b) { const c = b.querySelector('.modal-close'); if (c) c.click(); } }); await sleep(300);
    out.sweep.push(await clickObserve(window, 'inspector-import-comments', () => window.locator('[data-inspector-action="import-comments"]').first().click()));
    await window.keyboard.press('Escape'); await sleep(400);
    await window.evaluate(() => { const b = document.querySelector('.modal-backdrop'); if (b) { const c = b.querySelector('.modal-close'); if (c) c.click(); } }); await sleep(300);
    await gotoStage(window, 4);
    out.sweep.push(await clickObserve(window, 'panel-optimize', () => window.locator('[data-context-panel-action="optimize"]').first().click()));
    await window.keyboard.press('Escape'); await sleep(400);
    await window.evaluate(() => { const b = document.querySelector('.modal-backdrop'); if (b) { const c = b.querySelector('.modal-close'); if (c) c.click(); } }); await sleep(300);
    out.sweep.push(await clickObserve(window, 'panel-from-images', () => window.locator('[data-context-panel-action="from-images"]').first().click()));
    await window.keyboard.press('Escape'); await sleep(400);
    await window.evaluate(() => { const b = document.querySelector('.modal-backdrop'); if (b) { const c = b.querySelector('.modal-close'); if (c) c.click(); } }); await sleep(300);
    out.sweep.push(await clickObserve(window, 'inspector-export', () => window.locator('[data-inspector-action="export"]').first().click()));
    await window.keyboard.press('Escape'); await sleep(400);
    await window.evaluate(() => { const b = document.querySelector('.modal-backdrop'); if (b) { const c = b.querySelector('.modal-close'); if (c) c.click(); } }); await sleep(300);
    out.sweep.push(await clickObserve(window, 'inspector-renumber', () => window.locator('[data-inspector-action="renumber"]').first().click()));
    await window.keyboard.press('Escape'); await sleep(400);
    await window.evaluate(() => { const b = document.querySelector('.modal-backdrop'); if (b) { const c = b.querySelector('.modal-close'); if (c) c.click(); } }); await sleep(300);

    // thumb hover verb + context menu
    await gotoStage(window, 1);
    out.sweep.push(await clickObserve(window, 'thumb-verb-rotate-cw', () => window.locator('[data-thumb-verb="rotate-cw"]').first().click()));
    await window.keyboard.press('Control+z'); await sleep(500);
    await window.locator('.thumb-item').nth(1).click({ button: 'right' }); await sleep(400);
    out.sweep.push(await clickObserve(window, 'menu-insert-blank', () => window.locator('[data-menu-item="insert-blank"]').first().click()));
    await window.keyboard.press('Control+z'); await sleep(500);

    // ---- narrow title bar "+" click ----
    await resize(app, 640, 900);
    out.newTabClick640 = await clickObserve(window, 'new-tab-640', () => window.locator('[data-new-tab]').click({ timeout: 4000 }));
    out.headerActions640 = await window.evaluate(() => {
      const actions = document.querySelector('.header-actions');
      const nt = document.querySelector('[data-new-tab]');
      const tabs = document.querySelectorAll('[data-tab-id]');
      return {
        actions: actions ? actions.getBoundingClientRect().toJSON() : null,
        newTab: nt ? nt.getBoundingClientRect().toJSON() : null,
        tabCount: tabs.length,
        overlapping: (() => { if (!actions || !nt) return null; const a = actions.getBoundingClientRect(), b = nt.getBoundingClientRect(); return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; })(),
      };
    });
    await shot(window, 'adv-p36/p9-titlebar-640.png');

    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p9.json'), JSON.stringify(out, null, 2));
    log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error('PROBE-ERROR', err && err.stack || err);
    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p9.error.txt'), String(err && err.stack || err));
    fs.writeFileSync(path.join(__dirname, 'out', 'p9.partial.json'), JSON.stringify(out, null, 2));
  } finally {
    for (const w of app.windows()) { if (w !== window) { await w.close().catch(() => {}); } }
    await Promise.race([app.close(), sleep(6000)]).catch(() => {});
  }
})();
