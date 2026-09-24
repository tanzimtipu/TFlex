// ADV phase-36 probe 12: close the remaining reachability-table gaps
// (forms/flatten on form.pdf, welcome recents + removeRecent/openRecent,
// Multi Mode paneOpen, prevPage).
'use strict';
const { boot, openSample, gotoStage, sleep, ensureDir } = require('./lib.cjs');
const path = require('node:path');
const fs = require('node:fs');

const out = {};
(async () => {
  const { app, window } = await boot({ profile: 'p12' });
  try {
    await openSample(app, window, 'form.pdf');
    await window.waitForTimeout(1500);

    // forms / flatten
    await gotoStage(window, 3);
    out.formsDock = await window.evaluate(() => {
      const f = document.querySelector('[data-dock-verb="flatten"]');
      const forms = document.querySelector('[data-dock-verb="forms"]');
      return { flatten: f ? { disabled: f.disabled, title: f.getAttribute('title') } : null, forms: forms ? { disabled: forms.disabled } : 'not-on-dock' };
    });
    if ((await window.locator('[data-dock-verb="flatten"]').count()) > 0 && !(await window.locator('[data-dock-verb="flatten"]').first().isDisabled())) {
      await window.locator('[data-dock-verb="flatten"]').first().click();
      await sleep(700);
      out.flattenDialog = await window.evaluate(() => Array.from(document.querySelectorAll('.modal-title,.sheet-title')).map((t) => t.textContent.trim()));
      await window.keyboard.press('Escape'); await sleep(400);
      await window.evaluate(() => { const b = document.querySelector('.modal-backdrop'); if (b) { const c = b.querySelector('.modal-close, [data-confirm-dialog-action="cancel"]'); if (c) c.click(); } }); await sleep(300);
    }
    // forms via the palette
    await window.keyboard.press('Control+k');
    await window.waitForSelector('[data-command-palette-input]', { state: 'visible' });
    await window.locator('[data-command-palette-input]').fill('Forms');
    await sleep(350);
    out.formsRow = await window.evaluate(() => {
      const r = document.querySelector('[data-palette-tool-id="forms"]');
      return r ? { disabled: r.getAttribute('data-palette-disabled'), title: r.getAttribute('title') } : null;
    });
    await window.locator('.command-palette-row').filter({ hasText: 'Forms' }).first().click();
    await sleep(800);
    out.formsDialog = await window.evaluate(() => Array.from(document.querySelectorAll('.modal-title,.sheet-title')).map((t) => t.textContent.trim()));
    await window.keyboard.press('Escape'); await sleep(400);
    await window.evaluate(() => { const b = document.querySelector('.modal-backdrop'); if (b) { const c = b.querySelector('.modal-close, [data-confirm-dialog-action="cancel"]'); if (c) c.click(); } }); await sleep(400);

    // prevPage after nextPage
    await gotoStage(window, 1);
    await window.locator('[data-page-pill] button[aria-label="Next page"]').first().click(); await sleep(500);
    const afterNext = await window.evaluate(() => document.querySelector('[data-page-pill] input')?.value);
    await window.locator('[data-page-pill] button[aria-label="Previous page"]').first().click(); await sleep(500);
    out.prevPage = `${afterNext} -> ${await window.evaluate(() => document.querySelector('[data-page-pill] input')?.value)}`;

    // Welcome recents: close the tab -> welcome
    await window.evaluate(() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); });
    await window.keyboard.press('Control+w'); await sleep(900);
    const confirm = window.locator('[data-confirm-dialog-action="confirm"], [data-confirm-dialog-default]');
    if (await confirm.count() > 0) { await confirm.first().click(); await sleep(800); }
    out.welcome = await window.evaluate(() => ({
      welcome: !!document.querySelector('.welcome, [data-welcome]'),
      recentRows: Array.from(document.querySelectorAll('[data-recent-row], [data-recent], .recent-row')).map((r) => r.textContent.trim().slice(0, 60)),
      removeControls: Array.from(document.querySelectorAll('[data-recent-remove], .recent-remove, button[aria-label*="Remove"]')).map((b) => b.getAttribute('aria-label') || b.textContent.trim()),
      samples: document.querySelectorAll('[data-sample], .sample-card, [data-welcome-sample]').length,
    }));
    // open the first recent
    const recent = window.locator('[data-recent-row], [data-recent], .recent-row').first();
    if (await recent.count() > 0) {
      await recent.click().catch(() => {});
      await sleep(1500);
      out.openRecentWorked = await window.evaluate(() => !!document.querySelector('.workspace'));
    }
    // removeRecent
    if (await window.evaluate(() => !!document.querySelector('.welcome, [data-welcome]')) === false) {
      await window.keyboard.press('Control+w'); await sleep(900);
      const c2 = window.locator('[data-confirm-dialog-action="confirm"], [data-confirm-dialog-default]');
      if (await c2.count() > 0) { await c2.first().click(); await sleep(800); }
    }
    out.recentsBeforeRemove = await window.evaluate(() => document.querySelectorAll('[data-recent-row], [data-recent], .recent-row').length);
    const rm = window.locator('[data-recent-remove], .recent-remove, button[aria-label*="Remove"]').first();
    if (await rm.count() > 0) {
      await rm.click().catch((e) => { out.removeErr = String(e.message).split('\n')[0]; });
      await sleep(700);
      out.recentsAfterRemove = await window.evaluate(() => document.querySelectorAll('[data-recent-row], [data-recent], .recent-row').length);
    }

    // Multi Mode paneOpen: open two docs, clear pane B, click pane-open with dialog override
    await window.evaluate(() => { const p = document.querySelector('button:has-text("Open PDF")'); if (p) p.click(); });
    await sleep(1500);

    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p12.json'), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error('PROBE-ERROR', err && err.stack || err);
    fs.writeFileSync(path.join(__dirname, 'out', 'p12.error.txt'), String(err && err.stack || err));
    fs.writeFileSync(path.join(__dirname, 'out', 'p12.partial.json'), JSON.stringify(out, null, 2));
  } finally {
    for (const w of app.windows()) { if (w !== window) { await w.close().catch(() => {}); } }
    await Promise.race([app.close(), sleep(6000)]).catch(() => {});
  }
})();
