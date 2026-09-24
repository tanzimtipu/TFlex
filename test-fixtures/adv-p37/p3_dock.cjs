// Phase-37 item 21 - dock default contents, unpin, persistence, coherence, hostile settings.
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { boot, openSample, shot, writeOut, sleep, gotoStage } = require('./lib.cjs');

const PROFILE = 'p3-dock';
const UD = path.join(__dirname, 'userdata', PROFILE);
const SETTINGS = path.join(UD, 'settings.json');

async function dockVerbs(window) {
  return window.evaluate(() => Array.from(document.querySelectorAll('[data-action-dock] [data-dock-verb]')).map((b) => b.getAttribute('data-dock-verb')));
}
async function openDockMenu(window, id) {
  const verb = window.locator(`[data-action-dock] [data-dock-verb="${id}"]`).first();
  await verb.click({ button: 'right' });
  await window.waitForSelector('[data-dock-menu]', { state: 'visible', timeout: 5000 });
}
async function clickMenu(window, which) {
  await window.locator(`[data-dock-menu] [data-dock-menu-item="${which}"]`).first().click();
  await window.waitForTimeout(500);
}
async function readSettings(window) {
  return window.evaluate(async () => { try { return await window.tflex.loadSettings(); } catch (e) { return { __error: String(e) }; } });
}

(async () => {
  const out = {};
  // ---------- phase A: unpin + persist ----------
  {
    const { app, window } = await boot({ profile: PROFILE });
    try {
      await openSample(app, window, 'report.pdf');
      await gotoStage(window, 1);
      out.a_before = await dockVerbs(window);
      await openDockMenu(window, 'rotate');
      await clickMenu(window, 'unpin');
      await openDockMenu(window, 'split');
      await clickMenu(window, 'unpin');
      out.a_afterUnpin = await dockVerbs(window);
      const s = await readSettings(window);
      out.a_settings = { dockUnpinned: s.dockUnpinned, dockPins: s.dockPins };
      await shot(window, 'p3-dock-unpinned.png');
      // re-pin rotate via palette (restore path)
      await window.keyboard.press('Control+k');
      await window.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
      await window.locator('[data-command-palette-input]').fill('Rotate pages');
      await window.waitForTimeout(400);
      await window.keyboard.press('Control+Enter');
      await window.waitForTimeout(600);
      await window.keyboard.press('Escape');
      const s2 = await readSettings(window);
      out.a_afterRepinSettings = { dockUnpinned: s2.dockUnpinned, dockPins: s2.dockPins };
      await gotoStage(window, 1);
      out.a_afterRepinVerbs = await dockVerbs(window);
    } catch (e) { out.a_error = String(e && e.stack || e); }
    finally { await app.close().catch(() => {}); }
  }

  // ---------- phase B: restart, check persistence ----------
  {
    const { app, window } = await boot({ profile: PROFILE });
    try {
      await openSample(app, window, 'report.pdf');
      await gotoStage(window, 1);
      out.b_verbs = await dockVerbs(window);
      const s = await readSettings(window);
      out.b_settings = { dockUnpinned: s.dockUnpinned, dockPins: s.dockPins };
    } catch (e) { out.b_error = String(e && e.stack || e); }
    finally { await app.close().catch(() => {}); }
  }

  // ---------- phase C: cross-stage pin + unpin of same id ----------
  {
    const { app, window } = await boot({ profile: PROFILE });
    try {
      await openSample(app, window, 'report.pdf');
      // unpin merge (a PAGES default)
      await gotoStage(window, 1);
      await openDockMenu(window, 'merge');
      await clickMenu(window, 'unpin');
      let s = await readSettings(window);
      out.c_afterUnpinMerge = { dockUnpinned: s.dockUnpinned, dockPins: s.dockPins, verbs: await dockVerbs(window) };
      // go to EDIT, pin merge (cross-stage because edit default set lacks merge)
      await gotoStage(window, 2);
      await window.keyboard.press('Control+k');
      await window.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
      await window.locator('[data-command-palette-input]').fill('Merge PDFs');
      await window.waitForTimeout(400);
      await window.keyboard.press('Control+Enter');
      await window.waitForTimeout(600);
      await window.keyboard.press('Escape');
      s = await readSettings(window);
      out.c_afterPinMergeInEdit = { dockUnpinned: s.dockUnpinned, dockPins: s.dockPins, verbs: await dockVerbs(window) };
      // back to PAGES, unpin merge again
      await gotoStage(window, 1);
      await openDockMenu(window, 'merge');
      await clickMenu(window, 'unpin');
      s = await readSettings(window);
      out.c_afterReUnpinMerge = { dockUnpinned: s.dockUnpinned, dockPins: s.dockPins, verbs: await dockVerbs(window) };
    } catch (e) { out.c_error = String(e && e.stack || e); }
    finally { await app.close().catch(() => {}); }
  }

  // ---------- phase D: hostile settings ----------
  const hostileCases = {
    stringValue: { dockUnpinned: 'rotate' },
    unknownAndDup: { dockUnpinned: ['rotate', 'rotate', 'not-a-tool', 7, null, '', 'delete'] },
    hugeArray: { dockUnpinned: Array.from({ length: 5000 }, (_, i) => `tool-${i}`) },
    nullValue: { dockUnpinned: null },
  };
  out.d = {};
  for (const [name, payload] of Object.entries(hostileCases)) {
    // seed the settings file (merge into whatever exists)
    let base = {};
    try { base = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch (_) {}
    fs.writeFileSync(SETTINGS, JSON.stringify({ ...base, ...payload }), 'utf8');
    const { app, window } = await boot({ profile: PROFILE });
    try {
      await openSample(app, window, 'report.pdf');
      await gotoStage(window, 1);
      const s = await readSettings(window);
      out.d[name] = { ok: true, dockUnpinned: s.dockUnpinned, verbs: await dockVerbs(window) };
    } catch (e) { out.d[name] = { ok: false, error: String(e && e.message || e) }; }
    finally { await app.close().catch(() => {}); }
  }

  writeOut('p3.json', out);
  console.log('P3 done');
})().catch((e) => { writeOut('p3.error.txt', String(e && e.stack || e)); console.log('P3 FATAL', e && e.message); });
