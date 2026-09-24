// ADV phase-36 probe 7b: focus routing (pointerdown) + Action Dock duplicate
// sampling around the Multi Mode enter/leave transitions.
'use strict';
const { boot, openSample, shot, gotoStage, sleep, ensureDir } = require('./lib.cjs');
const path = require('node:path');
const fs = require('node:fs');

const out = {};
const log = (...a) => console.log('[p7b]', ...a);

async function openAnother(app, window, name) {
  const src = path.join(process.cwd(), 'assets', 'samples', name);
  const dst = path.join(__dirname, 'samples', `p7b-${Date.now()}-${name}`);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  await app.evaluate(async ({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, dst);
  await window.locator('[data-toolbar-open]').first().click();
  await sleep(2500);
}

const docksDump = (window) => window.evaluate(() => {
  const r = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
  return {
    count: document.querySelectorAll('[data-action-dock]').length,
    docks: Array.from(document.querySelectorAll('[data-action-dock]')).map((d) => ({
      rect: r(d),
      verbs: d.querySelectorAll('[data-dock-verb]').length,
      verbIds: Array.from(d.querySelectorAll('[data-dock-verb]')).map((b) => b.getAttribute('data-dock-verb')),
      visible: d.getBoundingClientRect().width > 0 && d.getBoundingClientRect().height > 0,
      opacity: getComputedStyle(d).opacity,
      parent: d.parentElement ? d.parentElement.className : null,
      inMultiLayer: !!d.closest('[data-multi-dock-layer]'),
      multiMode: !!document.querySelector('[data-multi-mode="true"]'),
    })),
  };
});

const focusPaneDown = (window, pane) => window.evaluate((p) => {
  const el = document.querySelector(`[data-pane="${p}"]`);
  if (el) {
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
  }
}, pane);

(async () => {
  const { app, window } = await boot({ profile: 'p7b' });
  try {
    await openSample(app, window, 'report.pdf');
    await window.waitForTimeout(1000);
    await openAnother(app, window, 'long.pdf');
    out.beforeMM = await docksDump(window);
    await window.locator('[data-header-multi-mode]').first().click();
    out.enterSamples = [];
    for (const t of [400, 1200, 2500, 4000]) {
      await sleep(t === 400 ? 400 : t - out.enterSamples[out.enterSamples.length - 1].t);
      out.enterSamples.push({ t, ...(await docksDump(window)) });
    }
    await shot(window, 'adv-p36/p7b-enter-settled.png');

    // Fill pane B.
    const pick = window.locator('[data-pane-pick]').first();
    if (await pick.count() > 0) { await pick.click(); await sleep(1500); }

    // Focus routing via pointerdown: B=deliver, A=edit, back to B.
    await focusPaneDown(window, 'B'); await sleep(600);
    await gotoStage(window, 4);
    out.Bdeliver = await window.evaluate(() => ({ rail: document.querySelector('[data-stage-rail]')?.getAttribute('data-active-stage'), focused: document.querySelector('[data-pane-focused="true"]')?.getAttribute('data-pane'), verbs: Array.from(document.querySelectorAll('[data-dock-verb]')).map((b) => b.getAttribute('data-dock-verb')) }));
    await focusPaneDown(window, 'A'); await sleep(600);
    await gotoStage(window, 2);
    out.Aedit = await window.evaluate(() => ({ rail: document.querySelector('[data-stage-rail]')?.getAttribute('data-active-stage'), focused: document.querySelector('[data-pane-focused="true"]')?.getAttribute('data-pane'), verbs: Array.from(document.querySelectorAll('[data-dock-verb]')).map((b) => b.getAttribute('data-dock-verb')) }));
    await focusPaneDown(window, 'B'); await sleep(700);
    out.backToB = await window.evaluate(() => ({ rail: document.querySelector('[data-stage-rail]')?.getAttribute('data-active-stage'), focused: document.querySelector('[data-pane-focused="true"]')?.getAttribute('data-pane'), verbs: Array.from(document.querySelectorAll('[data-dock-verb]')).map((b) => b.getAttribute('data-dock-verb')), inspector: document.querySelector('[data-inspector-stage]')?.getAttribute('data-inspector-stage') }));
    await shot(window, 'adv-p36/p7b-focus-routing.png');

    // Leave MM and sample the docks.
    await window.locator('[data-header-multi-mode]').first().click();
    out.leaveSamples = [];
    for (const t of [400, 1200, 2500, 4000]) {
      await sleep(t === 400 ? 400 : t - out.leaveSamples[out.leaveSamples.length - 1].t);
      out.leaveSamples.push({ t, ...(await docksDump(window)) });
    }
    await shot(window, 'adv-p36/p7b-leave-settled.png');

    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p7b.json'), JSON.stringify(out, null, 2));
    log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.error('PROBE-ERROR', err && err.stack || err);
    ensureDir(path.join(__dirname, 'out'));
    fs.writeFileSync(path.join(__dirname, 'out', 'p7b.error.txt'), String(err && err.stack || err));
    fs.writeFileSync(path.join(__dirname, 'out', 'p7b.partial.json'), JSON.stringify(out, null, 2));
  } finally {
    await Promise.race([app.close(), sleep(6000)]).catch(() => {});
  }
})();
