// ADV phase-36 probe 8b: rail compact boundary + title-bar compaction at 640px
// with a genuinely un-maximized (resizable) window.
'use strict';
const { boot, openSample, shot, sleep, ensureDir } = require('./lib.cjs');
const path = require('node:path');
const fs = require('node:fs');

const out = {};
const log = (...a) => console.log('[p8b]', ...a);

async function resize(app, window, w, h) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    win.setSize(size.w, size.h);
  }, { w, h });
  await sleep(800);
}

(async () => {
  const { app, window } = await boot({ profile: 'p8b' });
  try {
    await openSample(app, window, 'report.pdf');
    await window.waitForTimeout(1200);

    out.rail = {};
    for (const w of [1140, 1101, 1100, 1099, 1080]) {
      await resize(app, window, w, 900);
      out.rail[w] = await window.evaluate(() => {
        const rail = document.querySelector('[data-stage-rail]');
        const labels = Array.from(document.querySelectorAll('.stage-rail-label'));
        const btns = Array.from(document.querySelectorAll('[data-stage-rail] button')).map((b) => {
          const r = b.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { kind: b.getAttribute('data-stage') || 'gear', w: Math.round(r.width), h: Math.round(r.height), hitSelfOrChild: hit === b || b.contains(hit) };
        });
        return { innerWidth: window.innerWidth, compact: rail.getAttribute('data-stage-rail-compact'), labelDisplay: labels.length ? getComputedStyle(labels[0]).display : null, labelVisible: labels.length ? labels[0].getBoundingClientRect().width : null, buttons: btns };
      });
    }
    await resize(app, window, 1099, 900);
    // Click each stage button + gear while compact.
    out.compactClicks = [];
    for (const stage of ['edit', 'review', 'deliver', 'pages']) {
      const before = await window.evaluate(() => document.querySelector('[data-stage-rail]')?.getAttribute('data-active-stage'));
      await window.evaluate((s) => { const b = document.querySelector(`[data-stage-rail] button[data-stage="${s}"]`); if (b) b.click(); }, stage);
      await sleep(400);
      const after = await window.evaluate(() => document.querySelector('[data-stage-rail]')?.getAttribute('data-active-stage'));
      out.compactClicks.push({ stage, before, after });
    }
    const gearBefore = await window.evaluate(() => !!document.querySelector('[data-prefs-dialog]'));
    await window.evaluate(() => { const b = document.querySelector('[data-stage-rail-gear]'); if (b) b.click(); });
    await sleep(700);
    out.gearClick = { before: gearBefore, after: await window.evaluate(() => !!document.querySelector('[data-prefs-dialog]')) };
    await window.keyboard.press('Escape'); await sleep(400);
    await shot(window, 'adv-p36/p8b-rail-1099.png');

    // Title bar at 640.
    out.titlebar = {};
    for (const w of [900, 760, 640]) {
      await resize(app, window, w, 900);
      out.titlebar[w] = await window.evaluate(() => {
        const controls = Array.from(document.querySelectorAll('[data-titlebar] button')).map((b) => {
          const r = b.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const hit = document.elementFromPoint(cx, cy);
          return {
            name: b.getAttribute('data-menu-button') !== null ? 'File' : (b.getAttribute('aria-label') || b.getAttribute('title') || (b.textContent || '').trim()).slice(0, 22),
            w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y),
            disabled: b.disabled === true,
            onScreen: r.left >= 0 && r.right <= window.innerWidth + 1 && r.top >= 0,
            hitSelfOrChild: hit === b || (hit && (b.contains(hit) || hit.contains(b))),
          };
        });
        return { innerWidth: window.innerWidth, count: controls.length, controls };
      });
    }
    await shot(window, 'adv-p36/p8b-titlebar-640.png');

    // Click the phase-36 title-bar controls at 640.
    const sig = () => window.evaluate(() => ({
      menuPopover: !!document.querySelector('[data-menu-popover]'),
      modal: document.querySelectorAll('.modal-backdrop,.sheet-backdrop').length,
      prefs: !!document.querySelector('[data-prefs-dialog]'),
      multi: !!document.querySelector('[data-multi-mode="true"]'),
      theme: document.documentElement.getAttribute('data-theme'),
      tabs: document.querySelectorAll('[data-tab-id]').length,
    }));
    const clickAt640 = async (label, selector) => {
      const before = await sig();
      const loc = window.locator(selector).first();
      const err = await loc.click({ timeout: 5000 }).then(() => null).catch((e) => String(e.message).split('\n')[0]);
      await sleep(900);
      const after = await sig();
      return { label, err, before, after, changed: JSON.stringify(before) !== JSON.stringify(after) };
    };
    out.clicks640 = [];
    out.clicks640.push(await clickAt640('File', '[data-menu-button]'));
    if (out.clicks640[out.clicks640.length - 1].after.menuPopover) { await window.keyboard.press('Escape'); await sleep(300); }
    out.clicks640.push(await clickAt640('Theme', '[data-theme-toggle]'));
    out.clicks640.push(await clickAt640('Preferences', '[data-open-preferences]'));
    await window.keyboard.press('Escape'); await sleep(400);
    out.clicks640.push(await clickAt640('MultiMode', '[data-header-multi-mode]'));
    await sleep(400);
    out.clicks640.push(await clickAt640('MultiModeBack', '[data-header-multi-mode]'));
    out.clicks640.push(await clickAt640('Open', '[data-toolbar-open]'));
    await sleep(600);
    out.clicks640.push(await clickAt640('SaveAs', '[data-toolbar-save-as]'));
    await window.keyboard.press('Escape'); await sleep(400);

    out.windows = app.windows().length;
    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p8b.json'), JSON.stringify(out, null, 2));
    log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error('PROBE-ERROR', err && err.stack || err);
    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p8b.error.txt'), String(err && err.stack || err));
    fs.writeFileSync(path.join(__dirname, 'out', 'p8b.partial.json'), JSON.stringify(out, null, 2));
  } finally {
    for (const w of app.windows()) { if (w !== window) { await w.close().catch(() => {}); } }
    await Promise.race([app.close(), sleep(6000)]).catch(() => {});
  }
})();
