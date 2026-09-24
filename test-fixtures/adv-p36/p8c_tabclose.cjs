// ADV phase-36 probe 8c: identify what covers the tab close X and the new-tab
// "+" at narrow title-bar widths, and check the theme popover at 640.
'use strict';
const { boot, openSample, shot, sleep, ensureDir } = require('./lib.cjs');
const path = require('node:path');
const fs = require('node:fs');

const out = {};
async function resize(app, w, h) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    win.setSize(size.w, size.h);
  }, { w, h });
  await sleep(800);
}

(async () => {
  const { app, window } = await boot({ profile: 'p8c' });
  try {
    await openSample(app, window, 'report.pdf');
    await window.waitForTimeout(1200);
    out.byWidth = {};
    for (const w of [1000, 900, 800, 760, 700, 640]) {
      await resize(app, w, 900);
      out.byWidth[w] = await window.evaluate(() => {
        const probe = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const hit = document.elementFromPoint(cx, cy);
          return {
            rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
            cx: Math.round(cx), cy: Math.round(cy),
            hitChain: hit ? (() => { const a = []; for (let e = hit; e && a.length < 4; e = e.parentElement) a.push(`${e.tagName}.${String(e.className).slice(0, 30)}`); return a; })() : null,
            hitIsSelf: hit === el || el.contains(hit),
            cs: { visibility: getComputedStyle(el).visibility, pointerEvents: getComputedStyle(el).pointerEvents, opacity: getComputedStyle(el).opacity },
          };
        };
        const closeBtn = document.querySelector('[data-tab-id] [data-tab-close], [data-tab-close]');
        const newTab = document.querySelector('[data-new-tab]');
        const fileBtn = document.querySelector('[data-menu-button]');
        const bar = document.querySelector('[data-titlebar]');
        const tabArea = document.querySelector('.tab-area');
        return {
          innerWidth: window.innerWidth,
          bar: bar ? bar.getBoundingClientRect().toJSON() : null,
          tabArea: tabArea ? { rect: tabArea.getBoundingClientRect().toJSON(), scrollW: tabArea.scrollWidth, clientW: tabArea.clientWidth } : null,
          close: probe(closeBtn),
          newTab: probe(newTab),
          file: probe(fileBtn),
          newTabDisabled: newTab ? newTab.disabled : null,
        };
      });
    }
    await shot(window, 'adv-p36/p8c-tabs-640.png');

    // theme popover at 640
    await window.locator('[data-theme-toggle]').first().click();
    await sleep(500);
    out.themePopover = await window.evaluate(() => ({
      options: Array.from(document.querySelectorAll('[data-theme-option]')).map((b) => ({ value: b.getAttribute('data-theme-option'), rect: b.getBoundingClientRect().toJSON(), disabled: b.disabled })),
      visible: !!document.querySelector('[data-theme-option]'),
    }));
    // click the first non-active option
    const opt = window.locator('[data-theme-option]').first();
    if (await opt.count() > 0) {
      const before = await window.evaluate(() => document.documentElement.getAttribute('data-theme'));
      await opt.click({ timeout: 4000 }).catch((e) => { out.themePopover.clickErr = String(e.message).split('\n')[0]; });
      await sleep(600);
      out.themePopover.changed = `${before} -> ${await window.evaluate(() => document.documentElement.getAttribute('data-theme'))}`;
    }

    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p8c.json'), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error('PROBE-ERROR', err && err.stack || err);
    fs.writeFileSync(path.join(__dirname, 'out', 'p8c.error.txt'), String(err && err.stack || err));
  } finally {
    await Promise.race([app.close(), sleep(6000)]).catch(() => {});
  }
})();
