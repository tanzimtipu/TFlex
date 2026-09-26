// Phase 40 gate (qa) — design-system + view-mode criteria (items 9-13).
// Item 14 (verify:full + phase suites) is run separately. Canonical launchApp.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, toggleMultiModeViaPalette, gotoStage } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;
test.setTimeout(300000);

test.afterEach(async () => {
  if (app) await hardClose(app, 'p40-design');
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
  else await win.locator('button:has-text("Open PDF")').first().click();
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
// Item 9 — the single-view page-layout control.
// ---------------------------------------------------------------------------
const LAYOUT_STATE = `(() => {
  const ctl = document.querySelector('[data-page-layout-control]');
  if (!ctl) return null;
  const opts = [...ctl.querySelectorAll('[data-page-layout-option]')].map((b) => ({
    mode: b.getAttribute('data-page-layout-option'), pressed: b.getAttribute('aria-pressed'),
    label: b.getAttribute('aria-label'), active: b.classList.contains('tool-btn-active') }));
  const sc = document.querySelector('.document-scroller');
  const sr = sc ? sc.getBoundingClientRect() : null;
  const pages = [...document.querySelectorAll('.tab-pane[aria-hidden="false"] .pdf-page')];
  const rects = pages.map((p) => { const r = p.getBoundingClientRect();
    return { page: p.getAttribute('data-page'), left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; });
  const fully = sr ? rects.filter((r) => r.w > 0 && r.h > 0 && r.left >= sr.left - 2 && r.right <= sr.right + 2 && r.top >= sr.top - 2 && r.bottom <= sr.bottom + 2) : [];
  const input = document.querySelector('[data-page-pill] .page-input');
  return { active: ctl.getAttribute('data-page-layout-active'), opts,
    scroller: sr ? { left: Math.round(sr.left), top: Math.round(sr.top), right: Math.round(sr.right), bottom: Math.round(sr.bottom) } : null,
    fullyVisible: fully.length, fullyPages: fully.map((r) => r.page), readout: input ? input.value : null };
})()`;

test('P40-9 page-layout control: three options, one default, 1/2/4 fully visible at 1440 and 900', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openDoc(getSamplePath('report.pdf'));

  const initial = await win.evaluate(LAYOUT_STATE);
  console.log(`[P40 item9 initial] ${JSON.stringify(initial)}`);
  expect(initial, 'page-layout control present').not.toBeNull();
  expect(initial.opts.length, 'exactly three options').toBe(3);
  expect(initial.opts.map((o) => o.mode)).toEqual(['one', 'two', 'four']);
  expect(initial.active, 'ONE is the default').toBe('one');
  expect(initial.opts.filter((o) => o.pressed === 'true').map((o) => o.mode), 'exactly one active').toEqual(['one']);

  const expected = { one: 1, two: 2, four: 4 };
  for (const [w, h] of [[1440, 900], [900, 700]]) {
    await setWindow(w, h);
    await win.waitForTimeout(600);
    for (const mode of ['one', 'two', 'four']) {
      await win.locator(`[data-page-layout-option="${mode}"]`).click();
      await win.waitForTimeout(1400);
      const s = await win.evaluate(LAYOUT_STATE);
      console.log(`[P40 item9 ${w} ${mode}] ${JSON.stringify(s)}`);
      expect(s.active, `${w} ${mode}: the control marks the mode active`).toBe(mode);
      expect(s.fullyVisible, `${w} ${mode}: fully-visible page count`).toBe(expected[mode]);
      // The readout: single column is the bare page; a grid reads the row range
      // (a 2-column row holds two pages, so both grid modes read "1-2").
      if (mode === 'one') expect(s.readout, `${w} one: single-column readout unchanged`).toBe('1');
      if (mode === 'two') expect(s.readout, `${w} two: row range readout`).toBe('1-2');
      if (mode === 'four') expect(s.readout, `${w} four: row range readout`).toBe('1-2');
    }
  }
  await setWindow(1440, 900);
  await win.locator('[data-page-layout-option="four"]').click();
  await win.waitForTimeout(1200);
  await win.screenshot({ path: path.join(SHOTS, 'phase40-item9-four-up.png') });
});

// ---------------------------------------------------------------------------
// Item 10 — the under-thumbnail bar is gone; rotate/delete keep their homes.
// ---------------------------------------------------------------------------
const BAR_COUNT = `(() => ({
  railActionBar: document.querySelectorAll('[data-rail-action-bar]').length,
  railActionsBar: document.querySelectorAll('.rail-actions-bar').length,
  rotateLabel: document.querySelectorAll('[aria-label="Rotate counter-clockwise"]').length,
  deleteLabel: document.querySelectorAll('[aria-label="Delete this page"]').length,
}))()`;

test('P40-10 under-thumbnail bar absent in single + multi; rotate/delete run from dock and menu', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openDoc(getSamplePath('report.pdf'));

  // SINGLE mode: select a page (Ctrl-click selects).
  const thumb = win.locator('[data-context-panel-thumbs] .thumb-item').first();
  await thumb.click({ modifiers: ['Control'] });
  await win.waitForTimeout(600);
  const single = await win.evaluate(BAR_COUNT);
  console.log(`[P40 item10 single] ${JSON.stringify(single)}`);
  expect(single.railActionBar, 'single: no under-thumbnail action bar').toBe(0);
  expect(single.railActionsBar, 'single: no .rail-actions-bar').toBe(0);
  expect(single.rotateLabel, 'single: no per-page rotate control').toBe(0);
  expect(single.deleteLabel, 'single: no per-page delete control').toBe(0);

  // MULTI mode: same DOM assertion.
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1000);
  const mThumb = win.locator('.tab-pane[data-pane="A"] .thumb-item').first();
  if ((await mThumb.count()) > 0) { await mThumb.click({ modifiers: ['Control'], force: true }); await win.waitForTimeout(600); }
  const multi = await win.evaluate(BAR_COUNT);
  console.log(`[P40 item10 multi] ${JSON.stringify(multi)}`);
  expect(multi.railActionBar, 'multi: no under-thumbnail action bar').toBe(0);
  expect(multi.railActionsBar, 'multi: no .rail-actions-bar').toBe(0);
  await toggleMultiModeViaPalette(win);
  await win.waitForTimeout(800);

  // ROTATE from the dock verb.
  await gotoStage(win, 1);
  const rotBefore = await win.evaluate(() => (window.tflexDiagnostics().engineState.rotations || []).slice(0, 4));
  await win.locator('[data-dock-verb="rotate"]').first().click();
  await win.waitForTimeout(900);
  const rotAfter = await win.evaluate(() => (window.tflexDiagnostics().engineState.rotations || []).slice(0, 4));
  console.log(`[P40 item10 dock-rotate] before=${JSON.stringify(rotBefore)} after=${JSON.stringify(rotAfter)}`);
  expect(JSON.stringify(rotAfter), 'dock rotate applied a rotation op').not.toBe(JSON.stringify(rotBefore));
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(600);

  // DELETE from the page right-click menu.
  const pagesBefore = await win.evaluate(() => window.tflexDiagnostics().pageCount);
  await win.locator('[data-context-panel-thumbs] .thumb-item').first().click({ button: 'right' });
  await win.waitForSelector('[data-context-menu]', { state: 'visible', timeout: 8000 });
  const menuItems = await win.$$eval('[data-menu-item]', (els) => els.map((e) => e.getAttribute('data-menu-item')));
  console.log(`[P40 item10 menu] ${JSON.stringify(menuItems)}`);
  expect(menuItems, 'the page menu offers rotate + delete').toEqual(expect.arrayContaining(['rotate-cw', 'rotate-ccw', 'delete']));
  await win.locator('[data-menu-item="delete"]').click();
  await win.waitForSelector('[data-delete-pages-dialog]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-delete-confirm]').click();
  await win.waitForTimeout(1200);
  const pagesAfter = await win.evaluate(() => window.tflexDiagnostics().pageCount);
  console.log(`[P40 item10 menu-delete] pages ${pagesBefore} -> ${pagesAfter}`);
  expect(pagesAfter, 'the right-click delete removed a page').toBe(pagesBefore - 1);
});

// ---------------------------------------------------------------------------
// Item 11 — the Outline is flush with the panel bottom when EXPANDED.
// ---------------------------------------------------------------------------
const OUTLINE_OFFSETS = `(() => {
  const section = document.querySelector('[data-context-panel-outline]');
  const body = document.querySelector('[data-context-panel-outline-body]');
  const panel = document.querySelector('[data-context-panel]');
  if (!section || !panel) return null;
  const sr = section.getBoundingClientRect();
  const pr = panel.getBoundingClientRect();
  const br = body ? body.getBoundingClientRect() : null;
  const outlinePanel = document.querySelector('.outline-panel');
  const or = outlinePanel ? outlinePanel.getBoundingClientRect() : null;
  return { open: section.getAttribute('data-outline-open'),
    sectionBottom: Math.round(sr.bottom), panelBottom: Math.round(pr.bottom),
    sectionGapToPanelBottom: Math.round(pr.bottom - sr.bottom),
    bodyBottom: br ? Math.round(br.bottom) : null,
    outlinePanelBottom: or ? Math.round(or.bottom) : null,
    outlinePanelGapToPanelBottom: or ? Math.round(pr.bottom - or.bottom) : null };
})()`;

test('P40-11 Outline flush with the panel bottom when expanded', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openDoc(getSamplePath('report.pdf'));
  await win.waitForTimeout(1200);

  const section = win.locator('[data-context-panel-outline]');
  await expect(section).toHaveCount(1);
  // Ensure expanded.
  if ((await section.getAttribute('data-outline-open')) !== 'true') {
    await win.locator('[data-outline-toggle]').click();
    await win.waitForTimeout(500);
  }
  const m = await win.evaluate(OUTLINE_OFFSETS);
  console.log(`[P40 item11 expanded] ${JSON.stringify(m)}`);
  expect(m.open, 'outline expanded').toBe('true');
  expect(Math.abs(m.sectionGapToPanelBottom), `section bottom flush with panel bottom (gap ${m.sectionGapToPanelBottom}px)`).toBeLessThanOrEqual(2);
  if (m.outlinePanelGapToPanelBottom !== null) {
    expect(Math.abs(m.outlinePanelGapToPanelBottom), `outline list bottom flush with panel bottom (gap ${m.outlinePanelGapToPanelBottom}px)`).toBeLessThanOrEqual(2);
  }
  await win.screenshot({ path: path.join(SHOTS, 'phase40-item11-outline-expanded.png') });
});

// ---------------------------------------------------------------------------
// Item 12 — the palette is finite; the contrast table.
// ---------------------------------------------------------------------------
const PALETTE_MEASURE = `(() => {
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
  const cs = getComputedStyle(document.documentElement);
  const roles = ['--sem-primary', '--sem-neutral', '--sem-affirmative', '--sem-attention'];
  const roleVals = {}; for (const r of roles) roleVals[r] = cs.getPropertyValue(r).trim();
  // The declared token set also includes the dock's primary-verb ink
  // (--dock-primary-fg, DEF-340) — the accent family's dock-specific value.
  const dockPrimary = cs.getPropertyValue('--dock-primary-fg').trim();
  const norm = (v) => { const h = /^#([0-9a-f]{6})$/i.exec((v || '').trim());
    if (h) { const n = parseInt(h[1], 16); return 'rgb(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ')'; }
    const p = parse(v); return p ? 'rgb(' + p.r + ', ' + p.g + ', ' + p.b + ')' : v; };
  // Sample the computed colour of every palette-hooked control on screen.
  const hooked = [...document.querySelectorAll('[data-dock-verb], .tool-btn[data-icon], .ann-tool-btn[data-tool], .tools-palette-entry[data-tool-id], .rail-tab[data-rail-tab]')];
  const samples = hooked.map((el) => ({ sel: el.tagName + (el.getAttribute('data-dock-verb') ? '[dock=' + el.getAttribute('data-dock-verb') + ']' : '') + (el.getAttribute('data-icon') ? '[icon=' + el.getAttribute('data-icon') + ']' : '') + (el.getAttribute('data-tool') ? '[tool=' + el.getAttribute('data-tool') + ']' : '') + (el.getAttribute('data-tool-id') ? '[tid=' + el.getAttribute('data-tool-id') + ']' : '') + (el.getAttribute('data-rail-tab') ? '[rail=' + el.getAttribute('data-rail-tab') + ']' : ''),
    color: getComputedStyle(el).color }));
  const allowed = new Set([...Object.values(roleVals), dockPrimary].map(norm));
  const outside = samples.filter((s) => !allowed.has(s.color));
  return { theme: document.documentElement.getAttribute('data-theme'), roleVals, dockPrimary,
    dockPrimaryMatchesPrimary: norm(dockPrimary) === norm(roleVals['--sem-primary']),
    allowed: [...allowed], sampleCount: samples.length, outside };
})()`;

test('P40-12 palette finite + contrast table in all three themes', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openDoc(getSamplePath('report.pdf'));

  const table = [];
  for (const theme of ['light', 'dark', 'frosted']) {
    await setTheme(theme);
    const m = await win.evaluate(PALETTE_MEASURE);
    console.log(`[P40 item12 ${theme}] roles=${JSON.stringify(m.roleVals)} dockPrimary=${m.dockPrimary} dockPrimaryMatchesPrimary=${m.dockPrimaryMatchesPrimary} samples=${m.sampleCount} outside=${JSON.stringify(m.outside)}`);
    expect(m.outside, `${theme}: no palette-hooked control uses a colour outside the declared set`).toEqual([]);
    table.push({ theme, roles: m.roleVals, dockPrimary: m.dockPrimary });
  }
  console.log(`[P40 item12 table] ${JSON.stringify(table)}`);
});

// ---------------------------------------------------------------------------
// Item 13 — separators neutral; the active panel edge is a neutral glow.
// Phase 41 (item 4) SUPERSEDES the Phase-40 rule "the active panel edge takes
// --sem-primary": the edge is now the neutral panel border plus a shadow/glow.
// ---------------------------------------------------------------------------
const EDGE_MEASURE = `(() => {
  const insp = document.querySelector('[data-inspector]');
  if (!insp) return null;
  const cs = getComputedStyle(insp);
  const divider = getComputedStyle(document.documentElement).getPropertyValue('--divider').trim();
  const semPrimary = getComputedStyle(document.documentElement).getPropertyValue('--sem-primary').trim();
  const panelBorder = getComputedStyle(document.documentElement).getPropertyValue('--panel-border').trim();
  return { selection: insp.getAttribute('data-inspector-selection'),
    borderLeft: cs.borderLeftColor, borderLeftWidth: cs.borderLeftWidth, boxShadow: cs.boxShadow,
    divider, semPrimary, panelBorder };
})()`;

test('P40-13 separators neutral; the active panel edge is a neutral glow (Phase 41 supersedes the accent)', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openDoc(getSamplePath('report.pdf'));
  await win.waitForTimeout(1000);

  // At rest (no selection) the Inspector edge is the neutral hairline.
  const rest = await win.evaluate(EDGE_MEASURE);
  console.log(`[P40 item13 rest] ${JSON.stringify(rest)}`);
  expect(rest, 'Inspector present').not.toBeNull();

  // With a live selection the page-facing edge stays NEUTRAL and gains a glow
  // (Phase 41 item 4 — never the accent).
  await win.locator('[data-context-panel-thumbs] .thumb-item').first().click();
  await win.waitForTimeout(800);
  const active = await win.evaluate(EDGE_MEASURE);
  console.log(`[P40 item13 active] ${JSON.stringify(active)}`);
  expect(active.selection, 'a live selection is published to the Inspector').not.toBe('none');
  const parse = (c) => {
    const s = String(c || '').trim();
    const h = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
    if (h) { const n = parseInt(h[1], 16); return { r:(n>>16)&255, g:(n>>8)&255, b:n&255, a: h[2] !== undefined ? parseInt(h[2],16)/255 : 1 }; }
    const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return null; const p = m[1].split(',').map(Number); return { r:p[0], g:p[1], b:p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const hex = (c) => { const p = parse(c); return p ? '#' + [p.r,p.g,p.b].map((v) => v.toString(16).padStart(2,'0')).join('') : c; };
  const sameColor = (a, b, tol = 0.02) => { const x = parse(a), y = parse(b); return !!x && !!y && x.r === y.r && x.g === y.g && x.b === y.b && Math.abs(x.a - y.a) <= tol; };
  console.log(`[P40 item13 active edge] borderLeft=${active.borderLeft} (${hex(active.borderLeft)}) panelBorder=${active.panelBorder} semPrimary=${active.semPrimary} boxShadow=${active.boxShadow}`);
  expect(sameColor(active.borderLeft, active.panelBorder), `the active Inspector edge is the neutral panel border, not the accent (${active.borderLeft} vs ${active.panelBorder})`).toBe(true);
  expect(sameColor(active.borderLeft, active.semPrimary), 'the active Inspector edge is never --sem-primary').toBe(false);
  expect(active.boxShadow, 'the active Inspector edge gains a shadow/glow').not.toBe('none');

  // Screenshots per surface (dock, palette, panels, dialog).
  await win.screenshot({ path: path.join(SHOTS, 'phase40-item13-surfaces.png') });
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
  await win.screenshot({ path: path.join(SHOTS, 'phase40-item13-palette.png') });
  await win.keyboard.press('Escape');
});
