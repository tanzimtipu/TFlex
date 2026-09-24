// Precise: does the Expand control at a ladder-collapsed width latch the collapse?
'use strict';
const { boot, openSample, writeOut, sleep, gotoStage, safeClose, setContentSize } = require('./lib.cjs');

const insp = () => document.querySelector('[data-inspector]').getAttribute('data-inspector-collapsed');
const pan = () => document.querySelector('[data-context-panel]').getAttribute('data-context-panel-collapsed') === 'true';
const inspLabel = () => { const b = document.querySelector('[data-inspector-collapse]'); return b ? b.getAttribute('aria-label') : null; };
const panLabel = () => { const b = document.querySelector('[data-rail-collapse]'); return b ? b.getAttribute('aria-label') : null; };

(async () => {
  const { app, window } = await boot({ profile: 'p13-latch' });
  const out = {};
  const at = async (w) => { await setContentSize(app, w, 900); await sleep(700); };
  try {
    await openSample(app, window, 'report.pdf');
    await gotoStage(window, 1); await window.waitForTimeout(400);

    // --- inspector control sanity at a non-ladder width ---
    await at(1300);
    out.inspWideStart = await window.evaluate(insp);
    await window.locator('[data-inspector-collapse]').first().click(); await window.waitForTimeout(500);
    out.inspWideAfterCollapse = await window.evaluate(insp);
    await window.locator('[data-inspector-collapse]').first().click(); await window.waitForTimeout(500);
    out.inspWideAfterExpand = await window.evaluate(insp);

    // --- inspector: ONE expand click at 1100, then grow ---
    await at(1100);
    out.insp1100Start = await window.evaluate(insp);
    out.insp1100Label = await window.evaluate(inspLabel);
    await window.locator('[data-inspector-collapse]').first().click(); await window.waitForTimeout(500);
    out.insp1100AfterOneClick = await window.evaluate(insp);
    await at(1300);
    out.insp1300AfterOneClick = await window.evaluate(insp);
    // second click now (at wide) should expand
    await window.locator('[data-inspector-collapse]').first().click(); await window.waitForTimeout(500);
    out.insp1300AfterSecondClick = await window.evaluate(insp);

    // --- inspector: TWO expand clicks at 1100, then grow ---
    await at(1100); await window.waitForTimeout(300);
    // ensure currently expanded user pref: if collapsed at 1300 no; reset by growing
    await at(1300); await sleep(300);
    if ((await window.evaluate(insp)) === 'true') { await window.locator('[data-inspector-collapse]').first().click(); await window.waitForTimeout(400); }
    await at(1100);
    await window.locator('[data-inspector-collapse]').first().click(); await window.waitForTimeout(300);
    await window.locator('[data-inspector-collapse]').first().click(); await window.waitForTimeout(300);
    await at(1300);
    out.insp1300AfterTwoClicks = await window.evaluate(insp);

    // --- panel control sanity at non-ladder width ---
    await at(1300);
    out.panelWideStart = await window.evaluate(pan);
    await window.locator('[data-rail-collapse]').first().click(); await window.waitForTimeout(500);
    out.panelWideAfterCollapse = await window.evaluate(pan);
    await window.locator('[data-rail-collapse]').first().click(); await window.waitForTimeout(500);
    out.panelWideAfterExpand = await window.evaluate(pan);

    // --- panel: ONE expand click at 900, then grow ---
    await at(900);
    out.panel900Start = await window.evaluate(pan);
    out.panel900Label = await window.evaluate(panLabel);
    await window.locator('[data-rail-collapse]').first().click(); await window.waitForTimeout(500);
    await at(1300);
    out.panel1300AfterOneClick = await window.evaluate(pan);

    writeOut('p13.json', out);
    console.log('P13 done');
  } catch (e) { writeOut('p13.error.txt', String(e && e.stack || e)); console.log('P13 ERROR', e && e.message); }
  finally { await safeClose(app); process.exit(0); }
})();
