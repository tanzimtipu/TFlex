// Phase 40 gate (qa) — the 14 success criteria of REQUIREMENTS.md Phase 40,
// verified against the RUNNING dev build. Every launch goes through the
// canonical launchApp helper. Raw [P40 ...] lines are the evidence.
//
// Items covered here: 1 (multi pills horizontal), 2+3 (Open contrast + ghost
// chrome), 4 (create-from-images responsive), 5 (merge from scratch), 6 (two
// search icons), 7 (palette pin toggle + restart), 8 (multi-mode tooltip).
// Items 9-13 live in phase40_design.spec.cjs; item 14 is verify:full + suites.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, toggleMultiModeViaPalette, gotoStage } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const SAMPLES = path.join(ROOT, 'assets', 'samples');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;
test.setTimeout(300000);

test.afterEach(async () => {
  if (app) await hardClose(app, 'p40-gate');
  app = null;
  win = null;
});

async function setWindow(w, h) {
  await app.evaluate(({ BrowserWindow }, sz) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) bw.setSize(sz[0], sz[1]);
  }, [w, h]);
  await win.waitForFunction((want) => Math.abs(window.innerWidth - want) <= 24, w, { timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(500);
}

async function openDoc(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
  const openBtn = win.locator('[data-toolbar-open]').first();
  if ((await openBtn.count()) > 0) await openBtn.click();
  else await win.locator('[data-home-tool="open"]').first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(900);
}

async function setTheme(theme) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${theme}"]`);
  await win.waitForFunction((w) => document.documentElement.getAttribute('data-theme') === w, theme);
  await win.waitForTimeout(600);
}

// ---------------------------------------------------------------------------
// Item 1 — Multi Mode's page + zoom pills are HORIZONTAL, one per side.
// ---------------------------------------------------------------------------
const PILL_GEOM = `(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
    if (b.width <= 0 || b.height <= 0) return null;
    return { left:+b.left.toFixed(1), top:+b.top.toFixed(1), right:+b.right.toFixed(1), bottom:+b.bottom.toFixed(1), w:+b.width.toFixed(1), h:+b.height.toFixed(1) }; };
  const area = (a, b) => { if (!a || !b) return 0;
    const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return +(w * h).toFixed(1); };
  const hit = (el) => { if (!el) return null; const b = el.getBoundingClientRect();
    const t = document.elementFromPoint(Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2));
    return !!(t && (t === el || el.contains(t))); };
  const out = { panes: {}, dock: r(document.querySelector('.action-dock')),
    divider: r(document.querySelector('[data-multi-divider]')),
    strips: [...document.querySelectorAll('.pane-thumb-strip')].map(r),
    actionBars: document.querySelectorAll('[data-rail-action-bar]').length };
  for (const pane of ['A', 'B']) {
    const p = document.querySelector('.tab-pane[data-pane="' + pane + '"]');
    if (!p) continue;
    const pageEl = p.querySelector('[data-page-pill]');
    const zoomEl = p.querySelector('[data-zoom-pill]');
    const page = r(pageEl); const zoom = r(zoomEl);
    if (!page && !zoom) continue;
    const yOverlap = (page && zoom) ? +(Math.min(page.bottom, zoom.bottom) - Math.max(page.top, zoom.top)).toFixed(1) : null;
    out.panes[pane] = { page, zoom, yOverlap, pageHit: hit(pageEl), zoomHit: hit(zoomEl) };
  }
  return out;
})()`;

function interArea(a, b) {
  if (!a || !b) return 0;
  const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return +(w * h).toFixed(1);
}

async function measurePills(label) {
  const g = await win.evaluate(PILL_GEOM);
  const failures = [];
  for (const [pane, m] of Object.entries(g.panes)) {
    if (m.yOverlap === null) { failures.push(`${label} pane ${pane}: a pill is missing`); continue; }
    if (m.yOverlap <= 0) failures.push(`${label} pane ${pane}: pills STACKED (yOverlap=${m.yOverlap})`);
    if (m.page && m.zoom && interArea(m.page, m.zoom) > 0) failures.push(`${label} pane ${pane}: pills intersect`);
    for (const [i, s] of g.strips.entries()) {
      if (interArea(m.page, s) > 0) failures.push(`${label} pane ${pane}: page pill hits strip ${i}`);
      if (interArea(m.zoom, s) > 0) failures.push(`${label} pane ${pane}: zoom pill hits strip ${i}`);
    }
    if (interArea(m.page, g.dock) > 0) failures.push(`${label} pane ${pane}: page pill hits dock`);
    if (interArea(m.zoom, g.dock) > 0) failures.push(`${label} pane ${pane}: zoom pill hits dock`);
    if (interArea(m.page, g.divider) > 0) failures.push(`${label} pane ${pane}: page pill hits divider`);
    if (interArea(m.zoom, g.divider) > 0) failures.push(`${label} pane ${pane}: zoom pill hits divider`);
    if (m.pageHit !== true) failures.push(`${label} pane ${pane}: page pill not hittable`);
    if (m.zoomHit !== true) failures.push(`${label} pane ${pane}: zoom pill not hittable`);
  }
  console.log(`[P40 item1 ${label}] ${JSON.stringify(g)}`);
  console.log(`[P40 item1 ${label} failures] ${JSON.stringify(failures)}`);
  return { g, failures };
}

test('P40-1 Multi Mode pills horizontal at 1442/700/640, one and two documents', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  // --- ONE document ---
  await openDoc(getSamplePath('report.pdf'));
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1200);
  const oneDoc = [];
  for (const [w, h] of [[1442, 903], [700, 720], [640, 720]]) {
    await setWindow(w, h);
    await win.waitForTimeout(700);
    oneDoc.push(await measurePills(`1doc-${w}`));
  }
  await setWindow(1442, 903);
  await win.screenshot({ path: path.join(SHOTS, 'phase40-item1-multi-1doc.png') });
  await hardClose(app, 'p40-1a');
  app = null; win = null;

  // --- TWO documents ---
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openDoc(getSamplePath('report.pdf'));
  await openDoc(getSamplePath('long.pdf'));
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1000);
  const pick = win.locator('.tab-pane[data-pane-empty] [data-pane-pick]').first();
  if ((await pick.count()) > 0) { await pick.click(); await win.waitForTimeout(1800); }
  await win.locator('.tab-pane[data-pane="A"] .pdf-page').first().click({ force: true });
  await win.waitForTimeout(600);
  const twoDoc = [];
  for (const [w, h] of [[1442, 903], [700, 720], [640, 720]]) {
    await setWindow(w, h);
    await win.waitForTimeout(700);
    twoDoc.push(await measurePills(`2doc-${w}`));
  }
  await setWindow(1442, 903);
  await win.screenshot({ path: path.join(SHOTS, 'phase40-item1-multi-2doc.png') });

  const all = [...oneDoc, ...twoDoc];
  const failures = all.flatMap((r) => r.failures);
  const actionBars = all.map((r) => r.g.actionBars);
  console.log(`[P40 item1 actionBars] ${JSON.stringify(actionBars)}`);
  expect(actionBars.every((n) => n === 0), 'no under-thumbnail action bar in Multi Mode').toBe(true);
  expect(failures, failures.join('\n')).toEqual([]);
});

// ---------------------------------------------------------------------------
// Items 2 + 3 — Open resting contrast + ghost chrome in all three themes.
// ---------------------------------------------------------------------------
const HEADER_MEASURE = `(() => {
  const parse = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return null;
    const p = m[1].split(',').map(Number); return { r:p[0], g:p[1], b:p[2], a:p.length > 3 ? p[3] : 1 }; };
  const comp = (el) => { const chain = []; let n = el;
    while (n && n.nodeType === 1) { chain.push(n); n = n.parentElement; }
    chain.reverse(); let acc = { r:255, g:255, b:255, a:1 };
    for (const node of chain) { const bg = parse(getComputedStyle(node).backgroundColor);
      if (!bg || bg.a === 0) continue;
      acc = { r:bg.r*bg.a + acc.r*(1-bg.a), g:bg.g*bg.a + acc.g*(1-bg.a), b:bg.b*bg.a + acc.b*(1-bg.a), a:1 }; }
    return acc; };
  const lum = (c) => { const f = (v) => { const s = v/255; return s <= 0.03928 ? s/12.92 : Math.pow((s+0.055)/1.055, 2.4); };
    return 0.2126*f(c.r) + 0.7152*f(c.g) + 0.0722*f(c.b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); };
  const cs = (el) => el ? getComputedStyle(el) : null;
  const label = document.querySelector('.titlebar-file-label');
  const open = document.querySelector('[data-toolbar-open]');
  const group = document.querySelector('.titlebar-file');
  const save = document.querySelector('[data-toolbar-save]');
  const saveAs = document.querySelector('[data-toolbar-save-as]');
  const bg = comp(label);
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    labelColor: cs(label).color,
    surface: 'rgb(' + Math.round(bg.r) + ', ' + Math.round(bg.g) + ', ' + Math.round(bg.b) + ')',
    ratio: +ratio(parse(cs(label).color), bg).toFixed(2),
    openBg: cs(open).backgroundColor, openBorder: cs(open).borderTopColor,
    groupBg: cs(group).backgroundColor, groupBorder: cs(group).borderTopColor, groupShadow: cs(group).boxShadow,
    saveBg: cs(save).backgroundColor, saveAsBg: cs(saveAs).backgroundColor,
  };
})()`;

test('P40-2/3 Open resting contrast >= 4.5 and ghost chrome in light/dark/frosted', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openDoc(getSamplePath('report.pdf'));

  const rows = [];
  for (const theme of ['light', 'dark', 'frosted']) {
    await setTheme(theme);
    const m = await win.evaluate(HEADER_MEASURE);
    console.log(`[P40 item2/3 ${theme}] ${JSON.stringify(m)}`);
    rows.push(m);
    expect(m.ratio, `${theme}: Open resting label contrast (${m.labelColor} on ${m.surface})`).toBeGreaterThanOrEqual(4.5);
    // Item 3 — no resting background box / border on the group or any control.
    for (const [k, v] of [['group', m.groupBg], ['open', m.openBg], ['save', m.saveBg], ['saveAs', m.saveAsBg]]) {
      expect(v, `${theme}: ${k} resting background must be transparent (got ${v})`).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    }
    for (const [k, v] of [['group', m.groupBorder], ['open', m.openBorder]]) {
      expect(v, `${theme}: ${k} resting border must be transparent (got ${v})`).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
    }
    expect(m.groupShadow, `${theme}: group has no resting shadow`).toBe('none');
  }

  // Hover affordance survives: hovering Open paints a wash.
  await setTheme('light');
  const before = await win.evaluate(() => getComputedStyle(document.querySelector('[data-toolbar-open]')).backgroundColor);
  await win.locator('[data-toolbar-open]').hover();
  await win.waitForTimeout(300);
  const after = await win.evaluate(() => getComputedStyle(document.querySelector('[data-toolbar-open]')).backgroundColor);
  console.log(`[P40 item3 hover] before=${before} after=${after}`);
  expect(after, 'Open hover affordance must paint a background').not.toBe(before);
  await win.screenshot({ path: path.join(SHOTS, 'phase40-item2-open-resting.png') });
});

// ---------------------------------------------------------------------------
// Item 4 — Create-from-images dialog resizes with the window.
// ---------------------------------------------------------------------------
const DIALOG_BOX = `(() => {
  const backdrop = document.querySelector('[data-create-from-images-dialog]');
  if (!backdrop) return null;
  // The dialog CARD (not the full-viewport backdrop) is the resizing surface.
  const card = backdrop.querySelector('.modal-dialog') || backdrop;
  const b = card.getBoundingClientRect();
  const controls = [...card.querySelectorAll('button, input, select, textarea')].map((c) => {
    const r = c.getBoundingClientRect();
    return { tag: c.tagName, label: c.getAttribute('aria-label') || (c.textContent || '').trim().slice(0, 24),
      left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };
  });
  return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom),
    w: Math.round(b.width), h: Math.round(b.height), vw: window.innerWidth, vh: window.innerHeight, controls };
})()`;

test('P40-4 Create-from-images dialog resizes with the window', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  await win.locator('[data-welcome-create]').click();
  await win.waitForSelector('[data-create-from-images-dialog]', { state: 'visible', timeout: 10000 });
  await win.waitForTimeout(500);

  await setWindow(900, 600);
  await win.waitForTimeout(600);
  const small = await win.evaluate(DIALOG_BOX);
  console.log(`[P40 item4 small] ${JSON.stringify(small)}`);
  expect(small, 'dialog present at 900x600').not.toBeNull();
  expect(small.left, 'dialog left inside viewport').toBeGreaterThanOrEqual(0);
  expect(small.top, 'dialog top inside viewport').toBeGreaterThanOrEqual(0);
  expect(small.right, 'dialog right inside viewport').toBeLessThanOrEqual(small.vw + 1);
  expect(small.bottom, 'dialog bottom inside viewport').toBeLessThanOrEqual(small.vh + 1);
  const clipped = small.controls.filter((c) => c.left < 0 || c.top < 0 || c.right > small.vw + 1 || c.bottom > small.vh + 1);
  console.log(`[P40 item4 small clipped] ${JSON.stringify(clipped)}`);
  expect(clipped, 'no clipped control at 900x600').toEqual([]);
  await win.screenshot({ path: path.join(SHOTS, 'phase40-item4-small.png') });

  await setWindow(1920, 1080);
  await win.waitForTimeout(600);
  const large = await win.evaluate(DIALOG_BOX);
  console.log(`[P40 item4 large] ${JSON.stringify(large)}`);
  expect(large.w, `dialog uses the large window (small ${small.w} -> large ${large.w})`).toBeGreaterThan(small.w);
  await win.screenshot({ path: path.join(SHOTS, 'phase40-item4-large.png') });
});

// ---------------------------------------------------------------------------
// Item 5 � Merge PDF from scratch (no document open).
// ---------------------------------------------------------------------------
async function readPageCount() {
  return win.evaluate(() => {
    try { return window.tflexDiagnostics().pageCount; } catch (_) { return null; }
  });
}

test('P40-5 Merge PDF from scratch: multi-select picker, cancel no-op, doc-bound path unchanged', async () => {
  const report = path.join(SAMPLES, 'report.pdf');
  const scanned = path.join(SAMPLES, 'scanned.pdf');
  const expected = 34 + 6;

  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  // The new IPC exists on the bridge.
  const hasApi = await win.evaluate(() => typeof window.tflex.openFilesDialog === 'function');
  expect(hasApi, 'window.tflex.openFilesDialog is exposed').toBe(true);

  // --- CANCEL is a no-op ---
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await win.locator('button:has-text("Merge PDFs")').first().click();
  await win.waitForTimeout(1500);
  const afterCancel = await win.evaluate(() => ({
    workspace: document.querySelectorAll('.workspace').length,
    tabs: document.querySelectorAll('.tab[data-tab-id]').length,
    welcome: document.querySelectorAll('.sample-card').length,
  }));
  console.log(`[P40 item5 cancel] ${JSON.stringify(afterCancel)}`);
  expect(afterCancel.workspace, 'cancel opens no document').toBe(0);
  expect(afterCancel.tabs, 'cancel opens no tab').toBe(0);
  expect(afterCancel.welcome, 'still on the welcome screen').toBeGreaterThan(0);

  // --- MULTI-SELECT merge ---
  await app.evaluate(({ dialog }, paths) => {
    globalThis.__p40Picked = null;
    dialog.showOpenDialog = async () => {
      const r = { canceled: false, filePaths: paths };
      globalThis.__p40Picked = r.filePaths;
      return r;
    };
  }, [report, scanned]);
  await win.locator('button:has-text("Merge PDFs")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  let count = null;
  for (let i = 0; i < 60; i += 1) {
    count = await readPageCount();
    if (count === expected) break;
    await win.waitForTimeout(500);
  }
  const picked = await app.evaluate(() => globalThis.__p40Picked);
  const tabTitle = await win.locator('.tab[data-tab-id]').first().innerText().catch(() => '');
  console.log(`[P40 item5 picked] ${JSON.stringify(picked)}`);
  console.log(`[P40 item5 merged] pageCount=${count} expected=${expected} tab=${JSON.stringify(tabTitle.trim())}`);
  expect(picked, 'the picker returned both paths in order').toEqual([report, scanned]);
  expect(count, 'the merged document has the combined page count').toBe(expected);
  expect(tabTitle, 'the combined tab is named for the merge').toContain('Merged');
  await win.screenshot({ path: path.join(SHOTS, 'phase40-item5-merged.png') });

  // --- EXISTING doc-bound merge path unchanged ---
  await win.locator('[data-context-panel-combine]').first().click();
  await win.waitForSelector('[data-merge-pick]', { state: 'visible', timeout: 10000 });
  console.log('[P40 item5 doc-bound] the existing MergeDialog opened with a document present');
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-merge-pick]', { state: 'detached', timeout: 8000 }).catch(() => {});
});

// ---------------------------------------------------------------------------
// Item 6 � the two top-bar search icons.
// ---------------------------------------------------------------------------
test('P40-6 two distinct search icons open their own surfaces', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openDoc(getSamplePath('report.pdf'));

  const icons = await win.evaluate(() => {
    const a = document.querySelector('[data-header-tool-search]');
    const b = document.querySelector('[data-header-find]');
    const glyph = (el) => { const s = el ? el.querySelector('svg') : null; return s ? s.innerHTML : null; };
    return {
      tool: a ? { label: a.getAttribute('aria-label'), title: a.getAttribute('title'), glyph: glyph(a) } : null,
      find: b ? { label: b.getAttribute('aria-label'), title: b.getAttribute('title'), glyph: glyph(b) } : null,
    };
  });
  console.log(`[P40 item6 icons] ${JSON.stringify(icons)}`);
  expect(icons.tool, 'Ctrl+K icon present').not.toBeNull();
  expect(icons.find, 'Ctrl+F icon present').not.toBeNull();
  expect(icons.tool.label, 'distinct accessible names').not.toBe(icons.find.label);
  expect(icons.tool.glyph, 'distinct glyphs').not.toBe(icons.find.glyph);

  // Ctrl+K icon -> the Command Palette.
  await win.locator('[data-header-tool-search]').click();
  await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
  const paletteOpen = await win.locator('[data-command-palette]').count();
  console.log(`[P40 item6 tool-search] palette open=${paletteOpen}`);
  expect(paletteOpen, 'the Ctrl+K icon opened the palette').toBe(1);
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-command-palette]', { state: 'detached', timeout: 8000 });

  // Ctrl+F icon -> the find bar.
  await win.locator('[data-header-find]').click();
  await win.waitForSelector('.search-bar', { state: 'visible', timeout: 8000 });
  const findOpen = await win.locator('.search-bar .search-input').count();
  console.log(`[P40 item6 find] find bar open=${findOpen}`);
  expect(findOpen, 'the Ctrl+F icon opened the find bar').toBe(1);
  await win.screenshot({ path: path.join(SHOTS, 'phase40-item6-search-icons.png') });
});

// ---------------------------------------------------------------------------
// Item 7 � every palette row has a pin toggle; state persists across restart.
// ---------------------------------------------------------------------------
async function loadSettings() {
  const res = await win.evaluate(() => window.tflex.loadSettings());
  return res && res.ok ? res.value : null;
}

test('P40-7 palette pin toggle pins/unpins, does not run the tool, survives restart', async () => {
  const userData = path.join(os.tmpdir(), `tflex-p40-pin-${Date.now()}`);
  fs.mkdirSync(userData, { recursive: true });

  app = await launchApp([], userData);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openDoc(getSamplePath('report.pdf'));

  const s0 = await loadSettings();
  console.log(`[P40 item7 launch1 dockPins] ${JSON.stringify(s0 && s0.dockPins)}`);

  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
  await win.fill('[data-command-palette-input]', 'watermark');
  await win.waitForTimeout(300);
  const row = win.locator('[data-palette-tool-id="watermark"]').first();
  await expect(row).toHaveCount(1);
  const toggle = row.locator('[data-palette-pin-toggle]');
  const before = await toggle.getAttribute('data-palette-pin-state');
  const glyphBefore = await toggle.locator('svg').getAttribute('fill');
  console.log(`[P40 item7 before] state=${before} glyphFill=${glyphBefore}`);

  // PIN. Phase 42 (DEF-359) scopes the palette's pin marker to the ACTIVE
  // stage's dock: watermark is stage-native to REVIEW, so pinning it from the
  // default PAGES stage reads `pinned-elsewhere` (naming REVIEW), not `pinned`.
  // The pin still writes dockPins and the glyph still flips on.
  await toggle.click();
  await win.waitForTimeout(600);
  const s1 = await loadSettings();
  const afterPin = await toggle.getAttribute('data-palette-pin-state');
  const pinStage = await row.getAttribute('data-palette-pin-stage');
  const glyphAfter = await toggle.locator('svg').getAttribute('fill');
  const paletteStillOpen = await win.locator('[data-command-palette]').count();
  console.log(`[P40 item7 pinned] dockPins=${JSON.stringify(s1 && s1.dockPins)} state=${afterPin} pinStage=${pinStage} glyphFill=${glyphAfter} paletteOpen=${paletteStillOpen}`);
  expect((s1 && s1.dockPins) || [], 'pin wrote the tool id to dockPins').toContain('watermark');
  expect(afterPin, 'a foreign-stage pin reads pinned-elsewhere (DEF-359)').toBe('pinned-elsewhere');
  expect(pinStage, 'the foreign pin names its home stage REVIEW').toBe('review');
  expect(glyphAfter, 'the pin glyph differs by state').not.toBe(glyphBefore);
  expect(paletteStillOpen, 'clicking the pin did NOT run the tool (palette stays open)').toBe(1);

  // UNPIN.
  await toggle.click();
  await win.waitForTimeout(600);
  const s2 = await loadSettings();
  const afterUnpin = await toggle.getAttribute('data-palette-pin-state');
  console.log(`[P40 item7 unpinned] dockPins=${JSON.stringify(s2 && s2.dockPins)} state=${afterUnpin}`);
  expect((s2 && s2.dockPins) || [], 'unpin removed the tool id').not.toContain('watermark');
  expect(afterUnpin, 'the pin state flipped back to unpinned').toBe('unpinned');

  // PIN again, then restart with the SAME profile.
  await toggle.click();
  await win.waitForTimeout(600);
  const s3 = await loadSettings();
  console.log(`[P40 item7 re-pinned] dockPins=${JSON.stringify(s3 && s3.dockPins)}`);
  expect((s3 && s3.dockPins) || []).toContain('watermark');
  await hardClose(app, 'p40-7a');
  app = null; win = null;

  app = await launchApp([], userData);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const s4 = await loadSettings();
  console.log(`[P40 item7 launch2 dockPins] ${JSON.stringify(s4 && s4.dockPins)}`);
  expect((s4 && s4.dockPins) || [], 'the pin survived the restart').toContain('watermark');
});

// ---------------------------------------------------------------------------
// Item 8 � the Multi Mode toggle names view/edit.
// ---------------------------------------------------------------------------
test('P40-8 Multi Mode toggle tooltip/accessible name contains view/edit', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const m = await win.evaluate(() => {
    const el = document.querySelector('[data-header-multi-mode]');
    return el ? { label: el.getAttribute('aria-label'), title: el.getAttribute('title') } : null;
  });
  console.log(`[P40 item8] ${JSON.stringify(m)}`);
  expect(m, 'Multi Mode toggle present').not.toBeNull();
  expect(m.label, 'accessible name contains view/edit').toContain('view/edit');
  expect(m.title, 'tooltip contains view/edit').toContain('view/edit');
});
