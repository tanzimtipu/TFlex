// ADV phase-36 probe 8: hostile settings (dockPins/toolUsage/corrupt JSON),
// rail compact boundary, title-bar 640px compaction hit-test.
'use strict';
const { boot, openSample, shot, gotoStage, sleep, ensureDir } = require('./lib.cjs');
const path = require('node:path');
const fs = require('node:fs');

const out = {};
const log = (...a) => console.log('[p8]', ...a);

function profileDir(name) { return path.join(__dirname, 'userdata', name); }

(async () => {
  // ---- hostile-but-valid settings ----
  const dir = profileDir('p8-hostile');
  fs.mkdirSync(dir, { recursive: true });
  const hostile = {
    theme: 'dark',
    geometry: { x: 60, y: 60, width: 1442, height: 903, maximized: true },
    dockPins: ['rotate', 'rotate', 'not-a-real-tool', 'cropPages', 'split', 'delete', 'extract', 'insertPages'],
    toolUsage: { rotate: -5, split: 'many', extract: 3.7, delete: 1e308, merge: 2, watermark: 999999, '': 7, bad: null },
    toolsPaletteLayout: { left: 10, top: 20, width: 300, height: 400 },
    recentFiles: [
      { path: 'C:\\does\\not\\exist\\gone.pdf', name: 'gone.pdf', openedAt: '2020-01-01T00:00:00.000Z' },
      { path: '', name: '', openedAt: 'nope' },
    ],
  };
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(hostile));

  const { app, window, userDataDir } = await boot({ profile: 'p8-hostile' });
  try {
    out.hostileSettingsBooted = await window.evaluate(() => !!document.querySelector('[data-stage-rail]'));
    out.settingsAfterNormalize = (() => { try { return JSON.parse(fs.readFileSync(path.join(userDataDir, 'settings.json'), 'utf8')); } catch (e) { return String(e.message); } })();
    await openSample(app, window, 'report.pdf');
    await window.waitForTimeout(1500);
    await gotoStage(window, 1);
    out.hostilePins = await window.evaluate(() => Array.from(document.querySelectorAll('[data-dock-pin]')).map((b) => b.getAttribute('data-dock-pin')));
    await shot(window, 'adv-p36/p8-hostile-pins.png');

    // palette usage ranking (empty query): the top tool row should be watermark
    await window.keyboard.press('Control+k');
    await window.waitForSelector('[data-command-palette-input]', { state: 'visible' });
    await sleep(400);
    out.paletteTopRows = await window.evaluate(() => Array.from(document.querySelectorAll('.command-palette-row[data-palette-row="tool"]')).slice(0, 6).map((r) => r.getAttribute('data-palette-tool-id')));
    await window.keyboard.press('Escape'); await sleep(300);

    // ---- rail compact boundary ----
    out.railBoundary = {};
    for (const w of [1101, 1100, 1099]) {
      await app.evaluate(({ BrowserWindow }, width) => { const win = BrowserWindow.getAllWindows()[0]; if (win) win.setSize(width, 900); }, w);
      await sleep(600);
      out.railBoundary[w] = await window.evaluate(() => {
        const rail = document.querySelector('[data-stage-rail]');
        const r = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
        const btns = Array.from(document.querySelectorAll('[data-stage-rail] button')).map((b) => {
          const br = b.getBoundingClientRect();
          const hit = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
          return { kind: b.getAttribute('data-stage') || 'gear', w: Math.round(br.width), hitSelfOrChild: hit === b || b.contains(hit), label: !!b.querySelector('.stage-rail-label') && getComputedStyle(b.querySelector('.stage-rail-label')).display !== 'none' };
        });
        return { innerWidth: window.innerWidth, compact: rail.getAttribute('data-stage-rail-compact'), railRect: r(rail), buttons: btns };
      });
    }
    await shot(window, 'adv-p36/p8-rail-1099.png');
    // stage buttons still work while compact
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; if (win) win.setSize(1099, 900); });
    await sleep(500);
    await window.evaluate(() => { const b = document.querySelector('[data-stage-rail] button[data-stage="review"]'); if (b) b.click(); });
    await sleep(500);
    out.compactStageClick = await window.evaluate(() => document.querySelector('[data-stage-rail]')?.getAttribute('data-active-stage'));

    // ---- title bar at 640 ----
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; if (win) win.setSize(640, 900); });
    await sleep(900);
    out.titlebar640 = await window.evaluate(() => {
      const bar = document.querySelector('[data-titlebar]');
      const sel = '[data-titlebar] button, [data-titlebar] [role="button"]';
      const controls = Array.from(document.querySelectorAll(sel)).map((b) => {
        const r = b.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        return {
          name: b.getAttribute('data-menu-button') !== null ? 'File' : (b.getAttribute('aria-label') || b.getAttribute('title') || (b.textContent || '').trim()).slice(0, 24),
          w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x),
          disabled: b.disabled === true,
          hitSelfOrChild: hit === b || b.contains(hit) || (hit && hit.contains(b)),
        };
      });
      return { innerWidth: window.innerWidth, barRect: bar ? bar.getBoundingClientRect().toJSON() : null, controls };
    });
    await shot(window, 'adv-p36/p8-titlebar-640.png');
    // click each safe control and record an effect
    const clickEffect = async (label, locator) => {
      const before = await window.evaluate(() => ({ modal: document.querySelectorAll('.modal-backdrop,.sheet-backdrop').length, stage: document.querySelector('[data-stage-rail]')?.getAttribute('data-active-stage'), theme: document.documentElement.getAttribute('data-theme'), multi: !!document.querySelector('[data-multi-mode="true"]') }));
      await locator.click({ timeout: 4000 }).catch((e) => { before.error = String(e.message).split('\n')[0]; });
      await sleep(600);
      const after = await window.evaluate(() => ({ modal: document.querySelectorAll('.modal-backdrop,.sheet-backdrop').length, stage: document.querySelector('[data-stage-rail]')?.getAttribute('data-active-stage'), theme: document.documentElement.getAttribute('data-theme'), multi: !!document.querySelector('[data-multi-mode="true"]') }));
      return { label, before, after, changed: JSON.stringify(before) !== JSON.stringify(after) };
    };
    out.titlebarClicks = [];
    out.titlebarClicks.push(await clickEffect('File', window.locator('[data-menu-button]').first()));
    await window.keyboard.press('Escape'); await sleep(300);
    out.titlebarClicks.push(await clickEffect('Open', window.locator('[data-toolbar-open]').first()));
    await window.keyboard.press('Escape'); await sleep(300);
    out.titlebarClicks.push(await clickEffect('Save', window.locator('[data-toolbar-save]').first()));
    out.titlebarClicks.push(await clickEffect('SaveAs', window.locator('[data-toolbar-save-as]').first()));
    await window.keyboard.press('Escape'); await sleep(300);
    out.titlebarClicks.push(await clickEffect('MultiMode', window.locator('[data-header-multi-mode]').first()));
    await sleep(400);
    out.titlebarClicks.push(await clickEffect('Preferences', window.locator('[data-open-preferences]').first()));
    await window.keyboard.press('Escape'); await sleep(300);
    out.titlebarClicks.push(await clickEffect('Print', window.locator('[data-print]').first()));
    await sleep(1200);
    for (const w of app.windows()) { if (w !== window) { await w.close().catch(() => {}); } }
    await window.keyboard.press('Escape'); await sleep(400);

    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p8.json'), JSON.stringify(out, null, 2));
    log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error('PROBE-ERROR', err && err.stack || err);
    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p8.error.txt'), String(err && err.stack || err));
    fs.writeFileSync(path.join(__dirname, 'out', 'p8.partial.json'), JSON.stringify(out, null, 2));
  } finally {
    for (const w of app.windows()) { if (w !== window) { await w.close().catch(() => {}); } }
    await Promise.race([app.close(), sleep(6000)]).catch(() => {});
  }
})();
