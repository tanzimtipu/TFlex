// ADV phase-36 probe 13: welcome recents (openRecent / removeRecent) and the
// Multi Mode paneOpen control.
'use strict';
const { boot, openSample, shot, sleep, ensureDir } = require('./lib.cjs');
const path = require('node:path');
const fs = require('node:fs');

const out = {};
(async () => {
  const { app, window } = await boot({ profile: 'p13' });
  try {
    await openSample(app, window, 'report.pdf');
    await sleep(1000);
    // close the tab -> welcome
    await window.evaluate(() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); });
    await window.keyboard.press('Control+w'); await sleep(1000);
    const confirm = window.locator('[data-confirm-dialog-action="confirm"], [data-confirm-dialog-default]');
    if (await confirm.count() > 0) { await confirm.first().click(); await sleep(900); }
    out.welcome = await window.evaluate(() => ({
      welcome: !!document.querySelector('.welcome, [data-welcome]'),
      recentRows: document.querySelectorAll('[data-recent-row], [data-recent], .recent-row').length,
      removeControls: document.querySelectorAll('[data-recent-remove], .recent-remove').length,
      bodyText: (document.body.textContent || '').replace(/\s+/g, ' ').slice(0, 400),
    }));
    await shot(window, 'adv-p36/p13-welcome-recents.png');
    // open the first recent
    const recent = window.locator('[data-recent-row], [data-recent], .recent-row').first();
    if (await recent.count() > 0) {
      await recent.click().catch(() => {});
      await sleep(1600);
      out.openRecentWorked = await window.evaluate(() => !!document.querySelector('.workspace'));
    }
    // close again -> welcome -> remove the recent
    if (out.openRecentWorked) {
      await window.evaluate(() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); });
      await window.keyboard.press('Control+w'); await sleep(1000);
      const c2 = window.locator('[data-confirm-dialog-action="confirm"], [data-confirm-dialog-default]');
      if (await c2.count() > 0) { await c2.first().click(); await sleep(900); }
    }
    out.beforeRemove = await window.evaluate(() => document.querySelectorAll('[data-recent-row], [data-recent], .recent-row').length);
    const rm = window.locator('[data-recent-remove], .recent-remove').first();
    if (await rm.count() > 0) {
      await rm.click().catch((e) => { out.removeErr = String(e.message).split('\n')[0]; });
      await sleep(800);
    }
    out.afterRemove = await window.evaluate(() => document.querySelectorAll('[data-recent-row], [data-recent], .recent-row').length);

    // Multi Mode paneOpen
    await openSample(app, window, 'long.pdf');
    await sleep(1200);
    await window.locator('[data-header-multi-mode]').first().click(); await sleep(1500);
    out.mmBefore = await window.evaluate(() => ({ panes: document.querySelectorAll('[data-pane][data-pane]').length, empty: document.querySelectorAll('[data-pane-empty]').length, openBtn: !!document.querySelector('[data-pane-open]') }));
    // Clear pane B if filled? pane B should be empty (one doc). Use the pane-open control with a dialog override.
    const src = path.join(process.cwd(), 'assets', 'samples', 'form.pdf');
    const dst = path.join(__dirname, 'samples', `p13-${Date.now()}-form.pdf`);
    fs.copyFileSync(src, dst);
    await app.evaluate(async ({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, dst);
    if (await window.locator('[data-pane-open]').count() > 0) {
      await window.locator('[data-pane-open]').first().click().catch((e) => { out.paneOpenErr = String(e.message).split('\n')[0]; });
      await sleep(2500);
    }
    out.mmAfter = await window.evaluate(() => ({
      emptyPanes: document.querySelectorAll('[data-pane-empty]').length,
      headers: Array.from(document.querySelectorAll('[data-pane-header]')).map((h) => h.getAttribute('data-pane')),
    }));

    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p13.json'), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error('PROBE-ERROR', err && err.stack || err);
    fs.writeFileSync(path.join(__dirname, 'out', 'p13.error.txt'), String(err && err.stack || err));
    fs.writeFileSync(path.join(__dirname, 'out', 'p13.partial.json'), JSON.stringify(out, null, 2));
  } finally {
    for (const w of app.windows()) { if (w !== window) { await w.close().catch(() => {}); } }
    await Promise.race([app.close(), sleep(6000)]).catch(() => {});
  }
})();
