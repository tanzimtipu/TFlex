// ADV phase-36 probe 7: Multi Mode - per-pane stage, shared dock, pane headers,
// equal shrink, page floor, composite tab, rapid stage switching.
'use strict';
const { boot, openSample, shot, gotoStage, sleep, ensureDir } = require('./lib.cjs');
const path = require('node:path');
const fs = require('node:fs');

const out = {};
const log = (...a) => console.log('[p7]', ...a);

async function openAnother(app, window, name) {
  const src = path.join(process.cwd(), 'assets', 'samples', name);
  const dst = path.join(__dirname, 'samples', `p7-${Date.now()}-${name}`);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, dst);
  await window.locator('[data-toolbar-open]').first().click();
  await sleep(2500);
  return dst;
}

const mmState = (window) => window.evaluate(() => {
  const r = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
  const dock = document.querySelector('[data-action-dock]');
  const headers = Array.from(document.querySelectorAll('[data-pane-header]')).map((h) => ({ pane: h.getAttribute('data-pane'), rect: r(h) }));
  const panes = Array.from(document.querySelectorAll('[data-pane][data-pane-focused]')).map((p) => ({
    pane: p.getAttribute('data-pane'), focused: p.getAttribute('data-pane-focused'), rect: r(p),
  }));
  const pills = Array.from(document.querySelectorAll('[data-canvas-pills]')).map((p) => ({ pane: p.getAttribute('data-pill-pane'), rect: r(p) }));
  return {
    railActive: document.querySelector('[data-stage-rail]')?.getAttribute('data-active-stage'),
    railCount: document.querySelectorAll('[data-stage-rail]').length,
    dockCount: document.querySelectorAll('[data-action-dock]').length,
    dockState: dock ? dock.getAttribute('data-dock-state') : null,
    dockVerbs: Array.from(document.querySelectorAll('[data-dock-verb]')).map((b) => b.getAttribute('data-dock-verb')),
    dockRect: r(dock),
    pinCount: document.querySelectorAll('[data-dock-pin]').length,
    headers, panes, pills,
    compositeTab: document.querySelectorAll('[data-composite-tab]').length,
    tabs: document.querySelectorAll('.app-tab, [data-tab]').length,
    divider: !!document.querySelector('[data-multi-divider]'),
    multiMode: !!document.querySelector('[data-multi-mode="true"]'),
    inspector: document.querySelector('[data-inspector]') ? {
      stage: document.querySelector('[data-inspector-stage]')?.getAttribute('data-inspector-stage'),
      selection: document.querySelector('[data-inspector-selection]')?.getAttribute('data-inspector-selection'),
    } : null,
  };
});

function overlap(a, b) {
  if (!a || !b) return null;
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

(async () => {
  const { app, window } = await boot({ profile: 'p7' });
  try {
    await openSample(app, window, 'report.pdf');
    await window.waitForTimeout(1000);
    await openAnother(app, window, 'long.pdf');
    out.tabsBefore = await window.evaluate(() => document.querySelectorAll('[data-tab-id]').length);

    // Enter Multi Mode via the title-bar toggle.
    const toggle = window.locator('[data-header-multi-mode]').first();
    await toggle.click();
    await sleep(1200);
    out.entered = await mmState(window);
    await shot(window, 'adv-p36/p7-multi-enter.png');

    // Fill pane B from the pick list.
    out.pickOptions = await window.evaluate(() => Array.from(document.querySelectorAll('[data-pane-pick]')).map((b) => ({ id: b.getAttribute('data-pane-pick'), text: b.textContent.trim() })));
    const pick = window.locator('[data-pane-pick]').first();
    if (await pick.count() > 0) { await pick.click(); await sleep(1200); }
    out.afterPick = await mmState(window);

    // Per-pane stage: B=deliver, then A=edit, then re-check focus routing.
    const focusPane = async (pane) => {
      await window.evaluate((p) => {
        const h = document.querySelector(`[data-pane-header][data-pane="${p}"]`);
        if (h) h.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      }, pane);
      await sleep(600);
    };
    await focusPane('B');
    await gotoStage(window, 4);
    out.afterBDeliver = await mmState(window);
    await focusPane('A');
    await gotoStage(window, 2);
    out.afterAEdit = await mmState(window);
    await focusPane('B');
    out.focusBagain = await mmState(window);
    await focusPane('A');
    out.backToA = await mmState(window);
    await shot(window, 'adv-p36/p7-pane-stages.png');

    // DEF-282: dock must not overlap either pane header.
    out.headerOverlap = (out.backToA.headers || []).map((h) => ({ pane: h.pane, overlapsDock: overlap(out.backToA.dockRect, h.rect) }));

    // Rapid Ctrl+1..4 switching.
    await window.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
    for (let i = 0; i < 24; i++) {
      await window.keyboard.press(`Control+${(i % 4) + 1}`);
    }
    await sleep(800);
    out.afterRapid = await mmState(window);
    out.afterRapidErrors = await window.evaluate(() => ({ broken: !!document.querySelector('[data-error-boundary], .error-boundary') }));

    // Equal shrink + page floor: shrink the window in steps and measure panes.
    out.shrink = {};
    for (const w of [1442, 1100, 900, 760, 640]) {
      await app.evaluate(({ BrowserWindow }, width) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) win.setSize(width, 900);
      }, w);
      await sleep(800);
      out.shrink[w] = await window.evaluate(() => {
        const r = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
        const panes = Array.from(document.querySelectorAll('[data-pane][data-pane-focused]')).map((p) => ({ pane: p.getAttribute('data-pane'), width: Math.round(p.getBoundingClientRect().width) }));
        const docks = Array.from(document.querySelectorAll('.document-scroller, .document-content')).map((d) => Math.round(d.getBoundingClientRect().width));
        return { innerWidth: window.innerWidth, panes, scrollerWidths: docks, divider: !!document.querySelector('[data-multi-divider]') };
      });
      await shot(window, `adv-p36/p7-shrink-${w}.png`);
    }
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; if (win) win.setSize(1442, 903); });
    await sleep(600);

    // Leave multi mode.
    await window.locator('[data-header-multi-mode]').first().click();
    await sleep(900);
    out.left = await window.evaluate(() => ({
      multiMode: !!document.querySelector('[data-multi-mode="true"]'),
      dockCount: document.querySelectorAll('[data-action-dock]').length,
      railCount: document.querySelectorAll('[data-stage-rail]').length,
      workspace: !!document.querySelector('.workspace'),
    }));

    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p7.json'), JSON.stringify(out, null, 2));
    log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error('PROBE-ERROR', err && err.stack || err);
    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p7.error.txt'), String(err && err.stack || err));
    fs.writeFileSync(path.join(__dirname, 'out', 'p7.partial.json'), JSON.stringify(out, null, 2));
  } finally {
    await Promise.race([app.close(), sleep(6000)]).catch(() => {});
  }
})();
