// ADV phase-36 probe 9b: definitive narrow-titlebar actionability, thumb hover
// verb, and the EDIT-panel "Review suspects" silent no-op.
'use strict';
const { boot, openSample, shot, gotoStage, sleep, ensureDir } = require('./lib.cjs');
const path = require('node:path');
const fs = require('node:fs');

const out = {};
async function resize(app, w, h) {
  await app.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows()[0]; if (!win) return; if (win.isMaximized()) win.unmaximize(); win.setSize(size.w, size.h); }, { w, h });
  await sleep(800);
}

const actionability = (window, selector) => window.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return { missing: true };
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  return {
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    centre: { cx: Math.round(cx), cy: Math.round(cy) },
    hitIsSelf: hit === el || el.contains(hit),
    hit: hit ? `${hit.tagName}.${String(hit.className).slice(0, 36)}` : null,
    disabled: el.disabled === true,
    pointerEvents: getComputedStyle(el).pointerEvents,
    appRegion: getComputedStyle(el).webkitAppRegion || null,
    tabListScrollLeft: document.querySelector('.tab-list')?.scrollLeft ?? null,
  };
}, selector);

(async () => {
  const { app, window } = await boot({ profile: 'p9b' });
  try {
    await openSample(app, window, 'report.pdf');
    await window.waitForTimeout(1500);

    // ---- thumb hover verb ----
    await gotoStage(window, 1);
    const thumb = window.locator('.thumb-item').first();
    const vb = window.locator('[data-thumb-verb="rotate-cw"]').first();
    out.thumbVerb = { count: await window.locator('[data-thumb-verb="rotate-cw"]').count() };
    if (out.thumbVerb.count > 0) {
      const rotBefore = await window.evaluate(() => document.querySelector('[data-inspector-value="rotation"]')?.textContent);
      await thumb.hover(); await sleep(300);
      const trial = await vb.click({ trial: true, timeout: 5000 }).then(() => 'ok').catch((e) => String(e.message).split('\n')[0]);
      out.thumbVerb.trial = trial;
      if (trial === 'ok') {
        await vb.click(); await sleep(800);
        out.thumbVerb.rotation = `${rotBefore} -> ${await window.evaluate(() => document.querySelector('[data-inspector-value="rotation"]')?.textContent)}`;
        await window.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
        await window.keyboard.press('Control+z'); await sleep(600);
      }
    }

    // ---- EDIT panel suspects button ----
    await gotoStage(window, 2);
    out.suspectsBtn = await window.evaluate(() => {
      const b = document.querySelector('[data-context-panel-action="suspects"]');
      return b ? { disabled: b.disabled, title: b.getAttribute('title'), text: b.textContent.trim() } : { missing: true };
    });
    if (!out.suspectsBtn.missing && !out.suspectsBtn.disabled) {
      const before = await window.evaluate(() => !!document.querySelector('[data-ocr-suspects-panel]'));
      await window.locator('[data-context-panel-action="suspects"]').first().click();
      await sleep(900);
      out.suspectsBtnAfterClick = {
        panel: await window.evaluate(() => !!document.querySelector('[data-ocr-suspects-panel]')),
        toast: await window.evaluate(() => Array.from(document.querySelectorAll('.toast,[data-toast]')).map((t) => t.textContent.trim())),
        before,
      };
    }

    // ---- narrow title bar: one tab ----
    await resize(app, 640, 900);
    out.newTab640 = await actionability(window, '[data-new-tab]');
    out.newTab640.trial = await window.locator('[data-new-tab]').click({ trial: true, timeout: 5000 }).then(() => 'ok').catch((e) => String(e.message).split('\n')[0]);
    out.tabClose640 = await actionability(window, '[data-tab-id] .tab-close');
    out.tabClose640.trial = await window.locator('[data-tab-id] .tab-close').first().click({ trial: true, timeout: 5000 }).then(() => 'ok').catch((e) => String(e.message).split('\n')[0]);
    out.headerActions640 = await window.evaluate(() => {
      const a = document.querySelector('.header-actions');
      return a ? { rect: a.getBoundingClientRect().toJSON(), firstChild: a.firstElementChild ? String(a.firstElementChild.className).slice(0, 40) : null } : null;
    });
    await shot(window, 'adv-p36/p9b-titlebar-640.png');
    // Try to close the tab through the X (real click)
    out.tabCloseReal = await window.locator('[data-tab-id] .tab-close').first().click({ timeout: 4000 }).then(() => 'clicked').catch((e) => String(e.message).split('\n')[0]);
    await sleep(700);
    out.tabsAfterClose = await window.evaluate(() => document.querySelectorAll('[data-tab-id]').length);

    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p9b.json'), JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error('PROBE-ERROR', err && err.stack || err);
    fs.writeFileSync(path.join(__dirname, 'out', 'p9b.error.txt'), String(err && err.stack || err));
    fs.writeFileSync(path.join(__dirname, 'out', 'p9b.partial.json'), JSON.stringify(out, null, 2));
  } finally {
    await Promise.race([app.close(), sleep(6000)]).catch(() => {});
  }
})();
