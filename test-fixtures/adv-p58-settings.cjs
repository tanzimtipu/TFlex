// Adversarial Phase-58 probe: settings corruption + home/dock hand-edits.
// Adversary probe artifact (test-fixtures/), mirrors adv-p30-*.cjs harnesses.
const REPO = 'C:\\Users\\tanzi\\OneDrive\\App Development\\TFlex';
const { launchApp } = require(REPO + '\\e2e\\lib\\launch.cjs');
const { hardClose } = require(REPO + '\\e2e\\lib\\helpers.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

function rec(o) { console.log('### ' + JSON.stringify(o)); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freshUD(tag) {
  const d = path.join(os.tmpdir(), `tflex-adv-p58-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

async function launchWithSettings(tag, settings) {
  const ud = freshUD(tag);
  if (settings !== undefined) {
    fs.writeFileSync(path.join(ud, 'settings.json'), typeof settings === 'string' ? settings : JSON.stringify(settings, null, 2), 'utf8');
  }
  const app = await launchApp([], ud);
  const win = await app.firstWindow();
  await win.waitForSelector('.welcome, .workspace, .sample-card', { timeout: 30000 }).catch(() => {});
  await sleep(1500);
  return { app, win, ud };
}

async function snapshot(win) {
  return win.evaluate(async () => {
    const q = (s) => Array.from(document.querySelectorAll(s));
    let loaded = null;
    try { loaded = await window.tflex.loadSettings(); } catch (e) { loaded = { err: String(e.message) }; }
    const s = loaded && loaded.ok ? loaded.value : null;
    return {
      rendererAlive: true,
      settingsOk: loaded && loaded.ok,
      settingsErr: loaded && loaded.err ? loaded.err : null,
      tabStyle: s ? s.tabStyle : null,
      homeTools: s ? s.homeTools : null,
      dockPinsLen: s && Array.isArray(s.dockPins) ? s.dockPins.length : (s ? String(s.dockPins) : null),
      techStyle: s ? s.techStyle : null,
      tabStyleAttr: document.querySelector('[data-tab-style]')?.getAttribute('data-tab-style') ?? null,
      homeRow: q('[data-home-tools]').length,
      homeTiles: q('[data-home-tool]').map((e) => e.getAttribute('data-home-tool')),
      homePlusDisabled: (() => { const p = document.querySelector('[data-home-plus]'); return p ? p.disabled : null; })(),
      homeFullHint: q('[data-home-full-hint]').length,
      dock: q('[data-action-dock]').length,
      dockEdit: document.querySelector('[data-action-dock]')?.getAttribute('data-dock-edit') ?? null,
      bodyText: document.body.innerText.slice(0, 200),
    };
  }).catch((e) => ({ rendererAlive: false, evalErr: String(e.message) }));
}

async function main() {
  const scenario = process.argv[2] || 'all';

  if (scenario === 'c1' || scenario === 'all') {
    // Every hostile field at once: wrong types, invalid tabStyle, >14 homeTools.
    let app = null;
    try {
      const home20 = ['merge', 'split', 'extract', 'rotate', 'delete', 'annotate', 'sign', 'flatten', 'stamp', 'watermark', 'optimize', 'audit', 'preferences', 'toggleTheme', 'checkForUpdate', 'about', 'merge', 'unknown-xyz', 7, null];
      const settings = {
        tabStyle: 'neon',
        techStyle: 42,
        homeTools: home20,
        dockPins: { not: 'an array' },
        dockUnpinned: 99,
      };
      const r = await launchWithSettings('c1', settings);
      app = r.app;
      rec({ scenario: 'c1-all-wrong', snap: await snapshot(r.win) });
    } catch (e) { rec({ scenario: 'c1', error: String((e && e.stack) || e) }); }
    finally { await hardClose(app, 'c1').catch(() => {}); }
  }

  if (scenario === 'c2' || scenario === 'all') {
    // homeTools non-array -> default row.
    let app = null;
    try {
      const r = await launchWithSettings('c2', { homeTools: 'nope' });
      app = r.app;
      rec({ scenario: 'c2-home-nonarray', snap: await snapshot(r.win) });
    } catch (e) { rec({ scenario: 'c2', error: String((e && e.stack) || e) }); }
    finally { await hardClose(app, 'c2').catch(() => {}); }
  }

  if (scenario === 'c3' || scenario === 'all') {
    // homeTools ['open'] -> Open only.
    let app = null;
    try {
      const r = await launchWithSettings('c3', { homeTools: ['open'] });
      app = r.app;
      rec({ scenario: 'c3-home-open', snap: await snapshot(r.win) });
    } catch (e) { rec({ scenario: 'c3', error: String((e && e.stack) || e) }); }
    finally { await hardClose(app, 'c3').catch(() => {}); }
  }

  if (scenario === 'c4' || scenario === 'all') {
    // 20 valid homeTools -> truncated to 14, row visible.
    let app = null;
    try {
      const ids = ['merge', 'split', 'extract', 'rotate', 'delete', 'annotate', 'sign', 'flatten', 'stamp', 'watermark', 'optimize', 'audit', 'preferences', 'toggleTheme', 'checkForUpdate', 'about', 'createFromImages', 'exportPages', 'exportText', 'merge'];
      const r = await launchWithSettings('c4', { homeTools: ids });
      app = r.app;
      const snap = await snapshot(r.win);
      await r.win.screenshot({ path: REPO + '\\screenshots\\adv-p58-c4-home20.png' }).catch(() => {});
      rec({ scenario: 'c4-home20', snap, persistedLen: (() => { try { return JSON.parse(fs.readFileSync(path.join(r.ud, 'settings.json'), 'utf8')).homeTools?.length ?? null; } catch (e) { return 'read-err:' + e.message; } })() });
    } catch (e) { rec({ scenario: 'c4', error: String((e && e.stack) || e) }); }
    finally { await hardClose(app, 'c4').catch(() => {}); }
  }

  if (scenario === 'c5' || scenario === 'all') {
    // dockPins: 500 entries incl dupes/non-strings/unknown; hand-edited then open a doc.
    let app = null;
    try {
      const pins = [];
      for (let i = 0; i < 300; i += 1) { pins.push('pin-' + i); }
      pins.push('merge', 'merge', 7, null, '', 'split');
      const r = await launchWithSettings('c5', { dockPins: pins, dockUnpinned: [12, 'rotate', 'rotate'] });
      app = r.app;
      const win = r.win;
      // Open a doc so the dock renders.
      const { openSamplePath } = require(REPO + '\\e2e\\lib\\helpers.cjs');
      await openSamplePath(win, app, path.join(REPO, 'assets', 'samples', 'report.pdf'));
      await win.waitForTimeout(2000);
      const snap = await snapshot(win);
      const dockInfo = await win.evaluate(() => {
        const d = document.querySelector('[data-action-dock]');
        const sc = document.querySelector('[data-dock-scroll]');
        return { dock: !!d, verbs: document.querySelectorAll('[data-dock-verb]').length, overflow: !!document.querySelector('[data-dock-overflow]'), scrollW: sc?.scrollWidth ?? null, clientW: sc?.clientWidth ?? null, dockW: d?.getBoundingClientRect().width ?? null };
      });
      let persisted = null;
      try { persisted = JSON.parse(fs.readFileSync(path.join(r.ud, 'settings.json'), 'utf8')); } catch (e) { persisted = { err: String(e.message) }; }
      rec({ scenario: 'c5-dock-pins', snap, dockInfo, persistedDockPinsLen: Array.isArray(persisted.dockPins) ? persisted.dockPins.length : persisted.dockPins });
    } catch (e) { rec({ scenario: 'c5', error: String((e && e.stack) || e) }); }
    finally { await hardClose(app, 'c5').catch(() => {}); }
  }

  if (scenario === 'c6' || scenario === 'all') {
    // tabStyle variants: number, null, standard.
    for (const [tag, val] of [['num', 5], ['null', null], ['standard', 'standard']]) {
      let app = null;
      try {
        const r = await launchWithSettings('c6-' + tag, { tabStyle: val });
        app = r.app;
        // Open doc so tabs render.
        const { openSamplePath } = require(REPO + '\\e2e\\lib\\helpers.cjs');
        await openSamplePath(r.win, app, path.join(REPO, 'assets', 'samples', 'report.pdf'));
        await r.win.waitForTimeout(1500);
        const snap = await snapshot(r.win);
        rec({ scenario: 'c6-tabstyle', tag, value: val, tabStyleAttr: snap.tabStyleAttr, resolved: snap.tabStyle });
      } catch (e) { rec({ scenario: 'c6', tag, error: String((e && e.stack) || e) }); }
      finally { await hardClose(app, 'c6-' + tag).catch(() => {}); }
    }
  }

  if (scenario === 'c7' || scenario === 'all') {
    // Invalid JSON.
    let app = null;
    try {
      const r = await launchWithSettings('c7', '{ this is not json ');
      app = r.app;
      rec({ scenario: 'c7-invalid-json', snap: await snapshot(r.win) });
    } catch (e) { rec({ scenario: 'c7', error: String((e && e.stack) || e) }); }
    finally { await hardClose(app, 'c7').catch(() => {}); }
  }

  if (scenario === 'c8' || scenario === 'all') {
    // Home row at the cap: measure overflow, enter edit mode, check the plus.
    let app = null;
    try {
      const ids = ['merge', 'split', 'extract', 'rotate', 'delete', 'annotate', 'sign', 'flatten', 'stamp', 'watermark', 'optimize', 'audit', 'preferences', 'toggleTheme'];
      const r = await launchWithSettings('c8', { homeTools: ids });
      app = r.app;
      const win = r.win;
      const geomBefore = await win.evaluate(() => {
        const row = document.querySelector('[data-home-tools]');
        const pen = row.querySelector('[data-home-edit-toggle]');
        const tiles = row.querySelectorAll('[data-home-tool]');
        const last = tiles[tiles.length - 1];
        return { rowW: row.getBoundingClientRect().width, rowScrollW: row.scrollWidth, penRight: pen.getBoundingClientRect().right, lastTileRight: last.getBoundingClientRect().right, tileCount: tiles.length, viewport: window.innerWidth, overflowX: getComputedStyle(row).overflowX, flexWrap: getComputedStyle(row).flexWrap };
      });
      await win.locator('[data-home-edit-toggle]').click();
      await win.waitForTimeout(600);
      const geomEdit = await win.evaluate(() => {
        const plus = document.querySelector('[data-home-plus]');
        const pen = document.querySelector('[data-home-edit-toggle]');
        const r = document.querySelector('[data-home-tools]');
        return { plus: plus ? { right: plus.getBoundingClientRect().right, w: plus.getBoundingClientRect().width, disabled: plus.disabled } : null, penRight: pen.getBoundingClientRect().right, hint: document.querySelectorAll('[data-home-full-hint]').length, rowScrollW: r.scrollWidth, viewport: window.innerWidth };
      });
      await win.screenshot({ path: REPO + '\\screenshots\\adv-p58-c8-home-edit-cap.png' }).catch(() => {});
      rec({ scenario: 'c8-home-cap', geomBefore, geomEdit });
    } catch (e) { rec({ scenario: 'c8', error: String((e && e.stack) || e) }); }
    finally { await hardClose(app, 'c8').catch(() => {}); }
  }

  if (scenario === 'c9' || scenario === 'all') {
    // Edit home row with NO document, then open a document; does the change survive?
    let app = null;
    try {
      const r = await launchWithSettings('c9', undefined);
      app = r.app;
      const win = r.win;
      await win.locator('[data-home-edit-toggle]').click();
      await win.waitForTimeout(400);
      await win.locator('[data-home-plus]').click();
      await win.waitForSelector('[data-home-picker-item]', { timeout: 8000 });
      const items = await win.locator('[data-home-picker-item]').evaluateAll((els) => els.map((e) => e.getAttribute('data-home-picker-item')));
      const pick = items.find((id) => id !== 'preferences') || items[0];
      await win.locator(`[data-home-picker-item="${pick}"]`).click();
      await win.waitForTimeout(800);
      const afterAdd = await win.evaluate(() => Array.from(document.querySelectorAll('[data-home-tool]')).map((e) => e.getAttribute('data-home-tool')));
      // Open a doc immediately; then read settings.
      const { openSamplePath } = require(REPO + '\\e2e\\lib\\helpers.cjs');
      await openSamplePath(win, app, path.join(REPO, 'assets', 'samples', 'report.pdf'));
      await win.waitForTimeout(2000);
      const loaded = await win.evaluate(async () => { try { const s = await window.tflex.loadSettings(); return s.ok ? s.value.homeTools : s; } catch (e) { return 'err:' + e.message; } });
      rec({ scenario: 'c9-home-add-then-open', pick, afterAdd, persistedHomeTools: loaded });
    } catch (e) { rec({ scenario: 'c9', error: String((e && e.stack) || e) }); }
    finally { await hardClose(app, 'c9').catch(() => {}); }
  }

  console.log('DONE ' + scenario);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
