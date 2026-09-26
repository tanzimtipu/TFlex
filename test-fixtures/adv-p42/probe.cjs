/* Adversary Phase 42 probe (evidence artifact - lives in test-fixtures/ so
 * Playwright never collects it). Runs the dev build through the canonical e2e
 * launcher.
 *
 * Usage:  node test-fixtures/adv-p42/probe.cjs <scenario> [pinsJson] [userDataDir]
 * Scenarios: icons | pin
 * Prints one JSON line per observation with prefix ADV42.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');

const HERE = __dirname;
const SHOTS = path.join(HERE, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const ROOT = path.resolve(HERE, '..', '..');
const REAL_SETTINGS = path.join(process.env.APPDATA, 'tflex', 'settings.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (label, obj) => console.log(`ADV42 ${label} ${JSON.stringify(obj)}`);

async function setWinSize(app, win, w, h) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) bw.setSize(size.w, size.h);
  }, { w, h });
  await sleep(400);
}

async function openSample(win, name = 'report.pdf') {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

async function setTheme(win, theme) {
  await win.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await win.waitForTimeout(350);
}

async function gotoStage(win, n) {
  await win.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  });
  await win.keyboard.press(`Control+${n}`);
  await win.waitForTimeout(400);
}

const ICON_JS = `
  window.__advIconOf = (el) => {
    if (!el) return null;
    const svg = el.querySelector('svg');
    if (!svg) return { cls: null, parts: 0 };
    const cls = svg.getAttribute('class') || '';
    const m = /lucide-([a-z0-9-]+)/.exec(cls);
    const parts = svg.querySelectorAll('path,circle,rect,line,polyline,polygon,ellipse').length;
    return { cls: m ? m[1] : cls, parts, html: svg.outerHTML };
  };
`;

async function installIconHelper(win) {
  await win.evaluate(ICON_JS);
}

async function readPalette(win) {
  return win.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-palette-tool-id]'));
    return rows.map((r) => {
      const pinBtn = r.querySelector('[data-palette-pin-toggle]');
      return {
        id: r.getAttribute('data-palette-tool-id'),
        stage: r.getAttribute('data-stage'),
        pinned: r.getAttribute('data-palette-pinned') === 'true',
        disabled: r.getAttribute('data-palette-disabled') === 'true',
        pinState: pinBtn ? pinBtn.getAttribute('data-palette-pin-state') : null,
        icon: window.__advIconOf(r),
      };
    });
  });
}

async function readDock(win) {
  return win.evaluate(() => {
    const root = document.querySelector('[data-action-dock]');
    if (!root) return { present: false };
    const inline = Array.from(root.querySelectorAll('[data-dock-verb]:not([data-dock-pin])')).map((e) => ({
      id: e.getAttribute('data-dock-verb'),
      icon: window.__advIconOf(e),
    }));
    const pins = Array.from(root.querySelectorAll('[data-dock-pin]')).map((e) => ({
      id: e.getAttribute('data-dock-pin'),
      icon: window.__advIconOf(e),
    }));
    return { present: true, inline, pins };
  });
}

async function readOverflow(win) {
  const has = await win.locator('[data-dock-overflow]').count();
  if (has === 0) return [];
  await win.locator('[data-dock-overflow]').first().click();
  await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 8000 });
  const items = await win.evaluate(() => {
    const root = document.querySelector('[data-dock-overflow-menu]');
    return Array.from(root.querySelectorAll('[data-dock-overflow-item]')).map((e) => ({
      id: e.getAttribute('data-dock-overflow-item'),
      icon: window.__advIconOf(e),
    }));
  });
  await win.keyboard.press('Escape');
  await win.waitForTimeout(250);
  return items;
}

async function openPalette(win) {
  await win.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  });
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  await win.waitForTimeout(300);
}

// ---------------------------------------------------------------------------
// Scenario: icons - every stage dock + palette; glyph identity, blanks, sheet.
// ---------------------------------------------------------------------------
const NEAR = {
  SquareDashed: ['clearPageSelection'],
  SquareDashedMousePointer: ['annSelect'],
  SquareX: ['tabClose'],
  SquarePen: ['stageEdit'],
  SquarePlus: ['editTextBox'],
  Minimize: ['windowMinimize'],
  Minus: ['annPenWidth'],
  Maximize2: ['windowMaximize'],
  Square: ['annRect'],
  ArrowUpFromLine: ['extract'],
  ImageDown: ['exportPages'],
  FileDown: ['exportComments'],
  FileUp: ['importComments'],
  FileType: ['exportDocx'],
  Type: ['editText'],
  TextCursorInput: ['annTextbox'],
};

async function scenarioIcons(app, win) {
  await setWinSize(app, win, 1440, 900);
  await setTheme(win, 'light');
  await openSample(win);
  await installIconHelper(win);

  const stageNames = { 1: 'pages', 2: 'edit', 3: 'review', 4: 'deliver' };
  const dockByStage = {};
  for (const n of [1, 2, 3, 4]) {
    await gotoStage(win, n);
    const dock = await readDock(win);
    const overflow = await readOverflow(win);
    dockByStage[stageNames[n]] = { inline: dock.inline, pins: dock.pins, overflow };
    const file = path.join(SHOTS, `dock-${stageNames[n]}.png`);
    await win.screenshot({ path: file });
    log('dock', { stage: stageNames[n], file, inline: dock.inline.map((v) => `${v.id}:${v.icon && v.icon.cls}`), pins: dock.pins.map((v) => `${v.id}:${v.icon && v.icon.cls}`), overflow: overflow.map((v) => `${v.id}:${v.icon && v.icon.cls}`) });
  }

  await openPalette(win);
  const palette = await readPalette(win);
  const pfile = path.join(SHOTS, 'palette.png');
  await win.screenshot({ path: pfile });
  const blanks = palette.filter((r) => !r.icon || r.icon.parts === 0).map((r) => r.id);
  const byClass = {};
  for (const r of palette) {
    const c = r.icon && r.icon.cls;
    if (!c) continue;
    (byClass[c] = byClass[c] || []).push(r.id);
  }
  const dupClasses = Object.entries(byClass).filter(([, ids]) => ids.length > 1);
  log('palette', {
    file: pfile,
    rows: palette.length,
    blanks,
    dupClasses,
    watermark: palette.find((r) => r.id === 'watermark'),
    near: Object.fromEntries(Object.values(NEAR).flat().map((id) => {
      const r = palette.find((x) => x.id === id);
      return [id, r ? { cls: r.icon && r.icon.cls, stage: r.stage, pinned: r.pinned } : null];
    })),
  });

  // Build an icon contact sheet from the REAL palette SVGs at 20px.
  const sheet = await win.evaluate((groups) => {
    const make = (id) => {
      const row = document.querySelector(`[data-palette-tool-id="${id}"]`);
      const svg = row && row.querySelector('svg');
      const span = document.createElement('span');
      span.style.cssText = 'display:inline-flex;width:20px;height:20px;vertical-align:middle;color:#111;';
      if (svg) span.innerHTML = svg.outerHTML;
      return span;
    };
    let html = '';
    for (const [iconName, ids] of Object.entries(groups)) {
      html += `<div style="display:flex;align-items:center;gap:14px;padding:6px 8px;border-bottom:1px solid #eee;font:11px monospace;color:#333">`;
      html += `<b style="width:190px">${iconName}</b>`;
      for (const id of ids) {
        html += `<span style="display:inline-flex;align-items:center;gap:6px">`;
        html += `<i data-cell></i><span>${id}</span></span>`;
      }
      html += `</div>`;
    }
    const host = document.createElement('div');
    host.id = 'adv-icon-sheet';
    host.style.cssText = 'position:fixed;left:20px;top:20px;z-index:999999;background:#fff;padding:10px;border:2px solid #888;width:620px;';
    host.innerHTML = html;
    document.body.appendChild(host);
    // fill the placeholder cells with the real svg at exactly 20px
    const rows = host.querySelectorAll('div');
    let i = 0;
    const iconIds = Object.values(groups).flat();
    for (const cell of host.querySelectorAll('[data-cell]')) {
      const id = iconIds[i++];
      cell.style.cssText = 'display:inline-flex;width:20px;height:20px;color:#111;';
      const svg = document.querySelector(`[data-palette-tool-id="${id}"] svg`);
      if (svg) cell.innerHTML = svg.outerHTML;
    }
    const r = host.getBoundingClientRect();
    return { w: Math.ceil(r.width), h: Math.ceil(r.height) };
  }, NEAR);
  const sfile = path.join(SHOTS, 'icon-sheet.png');
  await win.screenshot({ path: sfile, clip: { x: 20, y: 20, width: sheet.w, height: sheet.h } });
  log('sheet', { file: sfile, ...sheet });

  // Enlarged (pixel-exact) version for close inspection of the near-miss pairs.
  const zoom = await win.evaluate(() => {
    const host = document.getElementById('adv-icon-sheet');
    if (!host) return null;
    const clone = host.cloneNode(true);
    clone.id = 'adv-icon-zoom';
    clone.style.transform = 'scale(6)';
    clone.style.transformOrigin = 'top left';
    clone.style.left = '20px';
    clone.style.top = '20px';
    document.body.appendChild(clone);
    host.style.display = 'none';
    const r = clone.getBoundingClientRect();
    return { w: Math.ceil(r.width), h: Math.ceil(r.height) };
  });
  if (zoom) {
    const zfile = path.join(SHOTS, 'icon-sheet-zoom.png');
    // Clip to the visible viewport region only.
    await win.screenshot({ path: zfile, clip: { x: 20, y: 20, width: Math.min(600, zoom.w), height: 850 } }).catch(() => {});
    log('sheetZoom', { file: zfile, ...zoom });
  }
}

// ---------------------------------------------------------------------------
// Scenario: pin - seeded curation, per-stage dock + palette, toggle coherence.
// argv[2] = pins json (default '[]'); argv[3] = unpinned json (default '[]')
// ---------------------------------------------------------------------------
async function scenarioPin(app, win, pins, unpinned) {
  await setWinSize(app, win, 1440, 900);
  await setTheme(win, 'light');
  await openSample(win);
  await installIconHelper(win);

  const stageNames = { 1: 'pages', 2: 'edit', 3: 'review', 4: 'deliver' };
  const read = async (label) => {
    const out = {};
    for (const n of [1, 2, 3, 4]) {
      await gotoStage(win, n);
      const dock = await readDock(win);
      const overflow = await readOverflow(win);
      out[stageNames[n]] = {
        pins: dock.pins.map((p) => p.id),
        inline: dock.inline.map((p) => p.id),
        overflow: overflow.map((p) => p.id),
      };
    }
    log('pin-stages', { when: label, pins, unpinned, stages: out });
    return out;
  };

  await read('seeded');

  // Palette pin states for the probe ids, per stage.
  const ids = ['watermark', 'undo', 'rotate', 'rotateCounterClockwise', 'ghostTool'];
  for (const n of [1, 2, 3, 4]) {
    await gotoStage(win, n);
    await openPalette(win);
    const rows = await win.evaluate((want) => {
      const out = {};
      for (const id of want) {
        const r = document.querySelector(`[data-palette-tool-id="${id}"]`);
        out[id] = r ? {
          pinned: r.getAttribute('data-palette-pinned'),
          pinState: r.querySelector('[data-palette-pin-toggle]')?.getAttribute('data-palette-pin-state') ?? null,
          disabled: r.getAttribute('data-palette-disabled'),
        } : 'absent';
      }
      return out;
    }, ids);
    log('pin-palette', { stage: stageNames[n], rows });
    if (stageNames[n] === 'edit' && pins.includes('watermark')) {
      await win.fill('[data-command-palette-input]', 'watermark');
      await win.waitForTimeout(350);
      const pf = path.join(SHOTS, 'pin-palette-edit-watermark.png');
      await win.screenshot({ path: pf });
      log('pin-palette-shot', { file: pf });
      await win.fill('[data-command-palette-input]', '');
      await win.waitForTimeout(250);
    }
    await win.keyboard.press('Escape');
    await win.waitForTimeout(250);
  }

  // Interaction: in EDIT, search watermark and toggle its pin (pin direction if
  // unpinned, else unpin), then close and read the EDIT dock.
  await gotoStage(win, 2);
  await openPalette(win);
  await win.fill('[data-command-palette-input]', 'watermark');
  await win.waitForTimeout(350);
  const before = await win.evaluate(() => {
    const r = document.querySelector('[data-palette-tool-id="watermark"]');
    return { pinned: r?.getAttribute('data-palette-pinned'), pinState: r?.querySelector('[data-palette-pin-toggle]')?.getAttribute('data-palette-pin-state') };
  });
  await win.locator('[data-palette-tool-id="watermark"] [data-palette-pin-toggle]').first().click();
  await win.waitForTimeout(400);
  const notice = await win.locator('[data-command-palette-notice]').first().textContent().catch(() => null);
  const after = await win.evaluate(() => {
    const r = document.querySelector('[data-palette-tool-id="watermark"]');
    return { pinned: r?.getAttribute('data-palette-pinned'), pinState: r?.querySelector('[data-palette-pin-toggle]')?.getAttribute('data-palette-pin-state') };
  });
  log('pin-toggle-edit', { target: 'watermark', before, after, notice });
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);
  const dockEdit = await readDock(win);
  log('pin-toggle-edit-dock', { pins: dockEdit.pins.map((p) => p.id), inline: dockEdit.inline.map((p) => p.id) });

  // Same-stage coherence: in REVIEW the watermark default should be present.
  await gotoStage(win, 3);
  const dockReview = await readDock(win);
  log('pin-toggle-review-dock', { pins: dockReview.pins.map((p) => p.id), inline: dockReview.inline.map((p) => p.id) });
  await openPalette(win);
  const wmReview = await win.evaluate(() => {
    const r = document.querySelector('[data-palette-tool-id="watermark"]');
    return { pinned: r?.getAttribute('data-palette-pinned'), pinState: r?.querySelector('[data-palette-pin-toggle]')?.getAttribute('data-palette-pin-state') };
  });
  log('pin-toggle-review-palette', wmReview);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(250);
}

// ---------------------------------------------------------------------------
// Scenario: pairs - a focused contact sheet of the flagged near-miss pairs, the
// glyph at 20px plus an 8x nearest-neighbour enlargement, from the real app.
// ---------------------------------------------------------------------------
const PAIR_GROUPS = [
  ['clearPageSelection', 'annSelect'],
  ['windowMinimize', 'annPenWidth'],
  ['exportComments', 'importComments'],
  ['editText', 'annTextbox'],
  ['windowMaximize', 'annRect'],
  ['tabClose', 'stageEdit', 'editTextBox'],
];

async function scenarioPairs(app, win) {
  await setWinSize(app, win, 1440, 900);
  await setTheme(win, 'light');
  await openSample(win);
  await installIconHelper(win);
  await openPalette(win);
  const size = await win.evaluate((groups) => {
    const svgFor = (id) => {
      const s = document.querySelector(`[data-palette-tool-id="${id}"] svg`);
      return s ? s.outerHTML : '';
    };
    let html = '';
    for (const ids of groups) {
      html += '<div style="display:flex;align-items:flex-start;gap:16px;padding:10px;border-bottom:1px solid #ddd;font:11px monospace;color:#222">';
      for (const id of ids) {
        html += `<div style="text-align:center"><div style="height:168px;width:168px;position:relative;overflow:hidden">`;
        html += `<div style="position:absolute;left:0;top:0;width:20px;height:20px;color:#111;transform:scale(8);transform-origin:top left">${svgFor(id)}</div>`;
        html += `</div><div style="margin-top:4px">${id}</div></div>`;
      }
      html += '</div>';
    }
    const host = document.createElement('div');
    host.id = 'adv-pairs';
    host.style.cssText = 'position:fixed;left:20px;top:20px;z-index:999999;background:#fff;padding:12px;border:2px solid #888;';
    host.innerHTML = html;
    document.body.appendChild(host);
    const r = host.getBoundingClientRect();
    return { w: Math.ceil(r.width), h: Math.ceil(r.height) };
  }, PAIR_GROUPS);
  const file = path.join(SHOTS, 'near-miss-pairs.png');
  await win.locator('#adv-pairs').screenshot({ path: file });
  log('pairs', { file, ...size });
}

// ---------------------------------------------------------------------------
// Scenario: wm - watermark runs from its REVIEW dock verb AND from Ctrl+K.
// ---------------------------------------------------------------------------
async function scenarioWatermark(app, win) {
  await setWinSize(app, win, 1440, 900);
  await setTheme(win, 'light');
  await openSample(win);
  await gotoStage(win, 3);

  await win.locator('[data-dock-verb="watermark"]').first().click();
  await win.waitForSelector('[data-watermark-dialog]', { state: 'visible', timeout: 8000 });
  const dockDlg = await win.evaluate(() => {
    const d = document.querySelector('[data-watermark-dialog]');
    return { count: document.querySelectorAll('[data-watermark-dialog]').length, inputs: d ? d.querySelectorAll('input,textarea,select,button').length : 0 };
  });
  const wfile = path.join(SHOTS, 'watermark-dock.png');
  await win.screenshot({ path: wfile });
  log('wm-dock', { ...dockDlg, file: wfile });
  await win.keyboard.press('Escape');
  await win.waitForTimeout(400);

  await openPalette(win);
  await win.fill('[data-command-palette-input]', 'watermark');
  await win.waitForTimeout(350);
  await win.locator('[data-palette-tool-id="watermark"]').first().click();
  await win.waitForSelector('[data-watermark-dialog]', { state: 'visible', timeout: 8000 });
  const palDlg = await win.evaluate(() => ({ count: document.querySelectorAll('[data-watermark-dialog]').length }));
  log('wm-palette', palDlg);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);
}

(async () => {
  const scenario = process.argv[2] || 'icons';
  const pinsJson = process.argv[3] || '';
  const unpinnedJson = process.argv[4] || '';
  const parseList = (s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);
  const pins = parseList(pinsJson);
  const unpinned = parseList(unpinnedJson);

  const userDataDir = path.join(os.tmpdir(), `tflex-adv42-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  let base = {};
  try { base = JSON.parse(fs.readFileSync(REAL_SETTINGS, 'utf8')); } catch { base = {}; }
  const seeded = {
    ...base,
    geometry: { x: 0, y: 0, width: 1440, height: 900, maximized: false },
    theme: 'light',
    dockPins: pins,
    dockUnpinned: unpinned,
  };
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify(seeded, null, 2));

  const app = await launchApp([], userDataDir);
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  try {
    if (scenario === 'icons') await scenarioIcons(app, win);
    else if (scenario === 'pairs') await scenarioPairs(app, win);
    else if (scenario === 'wm') await scenarioWatermark(app, win);
    else if (scenario === 'pin') await scenarioPin(app, win, pins, unpinned);
    else log('error', { msg: `unknown scenario ${scenario}` });
  } catch (err) {
    log('exception', { message: String(err && err.stack || err) });
  } finally {
    await hardClose(app, 'adv42');
  }
  process.exit(0);
})();
