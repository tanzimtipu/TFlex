// ADV phase-36 probe 5: Action Dock states, pins (persistence, cap, dedupe),
// idle rules, narrow-width overflow, and per-verb labelled widths.
'use strict';
const { boot, openSample, shot, gotoStage, sleep, ensureDir } = require('./lib.cjs');
const path = require('node:path');
const fs = require('node:fs');

const out = {};
const log = (...a) => console.log('[p5]', ...a);

const dock = (window) => window.evaluate(() => {
  const d = document.querySelector('[data-action-dock]');
  const r = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
  return {
    present: !!d,
    state: d ? d.getAttribute('data-dock-state') : null,
    idle: d ? d.getAttribute('data-dock-idle') : null,
    iconOnly: d ? d.getAttribute('data-dock-icon-only') : null,
    compact: d ? d.getAttribute('data-dock-compact') : null,
    band: d ? d.getAttribute('data-dock-band') : null,
    lift: d ? d.getAttribute('data-dock-lift') : null,
    chip: document.querySelector('[data-dock-chip]')?.textContent || null,
    inline: Array.from(document.querySelectorAll('[data-dock-verb]')).map((b) => ({ id: b.getAttribute('data-dock-verb'), disabled: b.disabled, w: Math.round(b.getBoundingClientRect().width) })),
    pins: Array.from(document.querySelectorAll('[data-dock-pin]')).map((b) => b.getAttribute('data-dock-pin')),
    overflowChip: !!document.querySelector('[data-dock-overflow]'),
    rect: r(d),
    pagePill: r(document.querySelector('[data-page-pill]')),
    zoomPill: r(document.querySelector('[data-zoom-pill]')),
  };
});

function overlap(a, b) {
  if (!a || !b) return null;
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

async function pinViaPalette(window, label) {
  await window.keyboard.press('Control+k');
  await window.waitForSelector('[data-command-palette-input]', { state: 'visible' });
  await window.locator('[data-command-palette-input]').fill(label);
  await sleep(350);
  await window.locator('[data-command-palette-input]').press('Control+Enter');
  await sleep(500);
  const notice = await window.evaluate(() => document.querySelector('[data-command-palette-notice]')?.textContent || null);
  await window.keyboard.press('Escape');
  await sleep(300);
  return notice;
}

(async () => {
  const { app, window, userDataDir } = await boot({ profile: 'p5' });
  try {
    await openSample(app, window, 'report.pdf');
    await window.waitForTimeout(1500);

    // ---- State 2: selection override ----
    await gotoStage(window, 1);
    const thumbs = window.locator('.thumb-item');
    await thumbs.nth(0).click(); await sleep(400);
    await thumbs.nth(1).click({ modifiers: ['Control'] }); await sleep(500);
    out.selectionState = await dock(window);
    out.selectionState.overlapPage = overlap(out.selectionState.rect, out.selectionState.pagePill);
    out.selectionState.overlapZoom = overlap(out.selectionState.rect, out.selectionState.zoomPill);
    await shot(window, 'adv-p36/p5-selection-state.png');
    // Clear
    const clear = window.locator('[data-dock-verb="clearPageSelection"]');
    if (await clear.count() > 0) { await clear.first().click(); await sleep(500); }
    out.afterClear = await dock(window);

    // ---- State 3: pins ----
    out.pinNotices = [];
    out.pinNotices.push(await pinViaPalette(window, 'Crop pages'));
    await sleep(400);
    out.afterPin1 = await dock(window);
    out.pinNotices.push(await pinViaPalette(window, 'Audit space usage'));
    out.pinNotices.push(await pinViaPalette(window, 'Reduce file size'));
    out.pinNotices.push(await pinViaPalette(window, 'Watermark'));
    await sleep(400);
    out.afterPin4 = await dock(window);
    await shot(window, 'adv-p36/p5-pins.png');
    // 5th (should be refused)
    out.pinNotices.push(await pinViaPalette(window, 'Stamp'));
    out.afterPin5 = await dock(window);
    // idempotent
    out.pinNotices.push(await pinViaPalette(window, 'Watermark'));
    out.afterPinAgain = await dock(window);

    // settings.json pins
    out.settingsDockPins = await (async () => {
      try { return JSON.parse(fs.readFileSync(path.join(userDataDir, 'settings.json'), 'utf8')).dockPins; } catch (e) { return String(e.message); }
    })();

    // ---- per-verb labelled widths at the natural window (deliver) ----
    await gotoStage(window, 4);
    out.deliverWidths = await window.evaluate(() => {
      const d = document.querySelector('[data-action-dock]');
      const labels = Array.from(document.querySelectorAll('[data-dock-verb]')).map((b) => ({
        id: b.getAttribute('data-dock-verb'),
        w: Math.round(b.getBoundingClientRect().width),
        label: b.querySelector('.action-dock-label')?.textContent || null,
      }));
      return { dockWidth: d ? Math.round(d.getBoundingClientRect().width) : null, dockHeight: d ? Math.round(d.getBoundingClientRect().height) : null, labels, band: d ? d.getAttribute('data-dock-band') : null };
    });

    // ---- State 4: idle ----
    await gotoStage(window, 1);
    await window.evaluate(() => { const d = document.querySelector('[data-action-dock]'); if (d) d.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); });
    await sleep(200);
    // move pointer away
    await window.mouse.move(5, 5);
    await sleep(3600);
    out.idleAfterWait = await dock(window);
    // arm sign -> idle must stay false
    await gotoStage(window, 3);
    const signBtn = window.locator('[data-dock-verb="sign"]');
    await signBtn.first().click(); await sleep(600);
    out.armed = await window.evaluate(() => ({
      signModal: !!document.querySelector('.modal-backdrop'),
      idle: document.querySelector('[data-action-dock]')?.getAttribute('data-dock-idle'),
      idleAfter3s: null,
    }));
    await sleep(3500);
    out.armed.idleAfter3s = await window.evaluate(() => document.querySelector('[data-action-dock]')?.getAttribute('data-dock-idle'));
    await window.keyboard.press('Escape'); await sleep(300);
    await window.evaluate(() => { const b = document.querySelector('.modal-backdrop'); if (b) { const c = b.querySelector('.modal-close'); if (c) c.click(); } });
    await sleep(400);

    // ---- narrow-width responsive overflow ----
    out.narrow = {};
    for (const w of [1200, 1000, 900, 760, 640]) {
      await app.evaluate(({ BrowserWindow }, width) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) { win.setSize(width, 900); }
      }, w);
      await sleep(700);
      await gotoStage(window, 1);
      const d = await dock(window);
      out.narrow[w] = {
        innerWidth: await window.evaluate(() => window.innerWidth),
        state: d.state, iconOnly: d.iconOnly, compact: d.compact, band: d.band, lift: d.lift,
        inlineCount: d.inline.length, overflowChip: d.overflowChip,
        overlapPage: overlap(d.rect, d.pagePill), overlapZoom: overlap(d.rect, d.zoomPill),
      };
      await shot(window, `adv-p36/p5-narrow-${w}.png`);
    }
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; if (win) win.setSize(1442, 903); });
    await sleep(600);

    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p5.json'), JSON.stringify(out, null, 2));
    log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error('PROBE-ERROR', err && err.stack || err);
    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p5.error.txt'), String(err && err.stack || err));
    fs.writeFileSync(path.join(__dirname, 'out', 'p5.partial.json'), JSON.stringify(out, null, 2));
  } finally {
    await Promise.race([app.close(), sleep(6000)]).catch(() => {});
  }
})();
