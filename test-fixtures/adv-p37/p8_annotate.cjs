// Phase-37 item 1 (annotate flow) + annotate bar parity.
'use strict';
const { boot, openSample, shot, writeOut, sleep, gotoStage } = require('./lib.cjs');

(async () => {
  const { app, window } = await boot({ profile: 'p8-ann' });
  const out = {};
  window.on('pageerror', (e) => { (out.pageErrors = out.pageErrors || []).push(String(e && e.message || e)); });
  try {
    await openSample(app, window, 'report.pdf');
    await gotoStage(window, 3);
    await window.waitForTimeout(500);
    // open flyout
    const annotate = window.locator('[data-dock-verb="annotate"]');
    if (await annotate.count()) { await annotate.first().click(); await window.waitForSelector('[data-annotation-flyout]', { state: 'visible', timeout: 8000 }).catch(() => {}); }
    // arm textbox via dropdown
    await window.click('[data-ann-dropdown-toggle]');
    await window.waitForSelector('[data-ann-dropdown-menu]', { state: 'visible', timeout: 6000 });
    await window.click('[data-ann-dropdown-menu] [data-tool="textbox"]');
    await window.waitForTimeout(500);
    out.armed = await window.evaluate(() => {
      const l = document.querySelector('.annotation-layer');
      return l ? l.getAttribute('data-tool') : null;
    });
    const pg = await window.locator('.pdf-page[data-page="1"]').boundingBox();
    const vp = await window.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const ax = Math.max(40, Math.min(pg.x + pg.width * 0.3, vp.w - 260));
    const ay = Math.max(40, Math.min(pg.y + pg.height * 0.3, vp.h - 130));
    await window.mouse.move(ax, ay);
    await window.mouse.down();
    await window.mouse.move(ax + 160, ay + 50, { steps: 6 });
    await window.mouse.up();
    await window.waitForTimeout(1000);
    out.txtField = await window.evaluate(() => {
      const ta = document.querySelector('[data-txt-text]');
      return ta ? { present: true, disabled: ta.disabled, value: ta.value } : { present: false };
    });
    out.inspAfterPlace = await window.evaluate(() => {
      const insp = document.querySelector('[data-inspector]');
      const body = document.querySelector('.inspector-body');
      return insp ? {
        selection: insp.getAttribute('data-inspector-selection'),
        textPanel: !!document.querySelector('[data-inspector-text-panel]'),
        isFirst: body ? (body.firstElementChild && body.firstElementChild.matches('[data-inspector-text-panel]')) : false,
        divider: !!document.querySelector('[data-inspector-divider]'),
        header: (document.querySelector('.inspector-header') || {}).textContent,
        floatingPanel: !!document.querySelector('[data-text-panel]'),
      } : { present: false };
    });
    out.placeBar = await window.evaluate(() => {
      const bar = document.querySelector('.ann-content-action, [data-content-action-bar^="ann-"]');
      if (!bar) return null;
      return { dataBar: bar.getAttribute('data-content-action-bar'), actions: Array.from(bar.querySelectorAll('[data-content-action]')).map((b) => b.getAttribute('data-content-action')), hasColor: !!bar.querySelector('.ann-color-box, [data-ann-color-box], [data-color-box], [class*=color]') };
    });
    await shot(window, 'p8-annotate-place.png');
    // type text then commit
    if (out.txtField.present && !out.txtField.disabled) {
      await window.fill('[data-txt-text]', 'ADV TEXTBOX');
      await window.waitForTimeout(300);
    }
    const confirm = window.locator('[data-content-action$="-confirm"]');
    if (await confirm.count()) { await confirm.first().click(); await window.waitForTimeout(900); }
    // select the committed annotation
    await window.mouse.click(ax + 60, ay + 25);
    await window.waitForTimeout(800);
    out.inspAfterSelect = await window.evaluate(() => {
      const insp = document.querySelector('[data-inspector]');
      const body = document.querySelector('.inspector-body');
      return insp ? {
        selection: insp.getAttribute('data-inspector-selection'),
        textPanel: !!document.querySelector('[data-inspector-text-panel]'),
        isFirst: body ? (body.firstElementChild && body.firstElementChild.matches('[data-inspector-text-panel]')) : false,
        divider: !!document.querySelector('[data-inspector-divider]'),
        header: (document.querySelector('.inspector-header') || {}).textContent,
        floatingPanel: !!document.querySelector('[data-text-panel]'),
      } : { present: false };
    });
    out.selBar = await window.evaluate(() => {
      const bar = document.querySelector('.ann-content-action, [data-content-action-bar^="ann-"]');
      if (!bar) return null;
      return { dataBar: bar.getAttribute('data-content-action-bar'), actions: Array.from(bar.querySelectorAll('[data-content-action]')).map((b) => b.getAttribute('data-content-action')), hasColor: !!bar.querySelector('.ann-color-box, [data-ann-color-box], [data-color-box], [class*=color]') };
    });
    await shot(window, 'p8-annotate-select.png');
    writeOut('p8.json', out);
    console.log('P8 done');
  } catch (e) {
    writeOut('p8.error.txt', String(e && e.stack || e));
    console.log('P8 ERROR', e && e.message);
  } finally { await app.close().catch(() => {}); process.exit(0); }
})();
