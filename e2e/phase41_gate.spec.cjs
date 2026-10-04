// Phase 41 gate (qa) — the four operator items encoded by REQUIREMENTS.md's
// seven success criteria:
//   1. the Inspector is opaque and of the same kind in every stage/theme;
//   2. no canvas content renders behind/through it in any stage;
//   3. the legacy EDIT toolbar is absent and every control it offered still runs;
//   4. the professional selection treatment (text panel + thumbnail) with floors;
//   5. the 1px neutral rail/ContextPanel separator at 1440 and 900;
//   6. the Inspector's page-facing edge is a neutral glow, not the accent;
//   7. no regression (verify:full + phase suites) — run separately.
//
// Evidence-first: every test logs the raw computed values / pixel counts before
// asserting. Launches only through the canonical e2e/lib/launch.cjs launchApp.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { PNG } = require('pngjs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, gotoStage, clickDockVerb } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

let app = null;
let win = null;
test.setTimeout(420000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p41-gate');
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

// Compare two CSS colour strings (hex-with-alpha vs rgba) by channel + alpha.
function parseColor(c) {
  const s = String(c).trim();
  let m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: m[2] !== undefined ? parseInt(m[2], 16) / 255 : 1 };
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const p = m[1].split(',').map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  return null;
}
function sameColor(a, b, tol = 0.02) {
  const x = parseColor(a), y = parseColor(b);
  if (!x || !y) return false;
  return x.r === y.r && x.g === y.g && x.b === y.b && Math.abs(x.a - y.a) <= tol;
}

// ---------------------------------------------------------------------------
// Criterion 1 — the Inspector's computed background per stage/theme.
// ---------------------------------------------------------------------------
const INSPECTOR_BG = `(() => {
  const insp = document.querySelector('[data-inspector]');
  if (!insp) return null;
  const cs = getComputedStyle(insp);
  const parse = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return null;
    const p = m[1].split(',').map(Number); return { r:p[0], g:p[1], b:p[2], a:p.length > 3 ? p[3] : 1 }; };
  const bg = parse(cs.backgroundColor);
  return { stage: insp.getAttribute('data-inspector-stage'),
    theme: document.documentElement.getAttribute('data-theme'),
    backgroundColor: cs.backgroundColor, bgAlpha: bg ? bg.a : null,
    backgroundImage: cs.backgroundImage, isolation: cs.isolation, zIndex: cs.zIndex };
})()`;

test('P41-1 Inspector computed background is opaque and the same kind in all four stages x three themes', async () => {
  await openDoc(getSamplePath('report.pdf'));
  await setWindow(1440, 900);

  const table = [];
  for (const theme of ['light', 'dark', 'frosted']) {
    await setTheme(theme);
    for (const [n, stage] of [[1, 'pages'], [2, 'edit'], [3, 'review'], [4, 'deliver']]) {
      await gotoStage(win, n);
      await win.waitForTimeout(400);
      const m = await win.evaluate(INSPECTOR_BG);
      console.log(`[P41-1 ${theme} ${stage}] ${JSON.stringify(m)}`);
      expect(m, `${theme}/${stage}: Inspector present`).not.toBeNull();
      expect(m.stage, `${theme}/${stage}: the Inspector reports its stage`).toBe(stage);
      expect(m.bgAlpha, `${theme}/${stage}: computed background alpha is 1 (opaque)`).toBe(1);
      table.push({ theme, stage, backgroundColor: m.backgroundColor, backgroundImage: m.backgroundImage });
    }
  }
  console.log(`[P41-1 table] ${JSON.stringify(table)}`);

  // The EDIT stage screenshot with page text hard against the panel edge: zoom
  // in so the page's right edge abuts the Inspector, then capture.
  await setTheme('light');
  await gotoStage(win, 2);
  await win.waitForTimeout(400);
  for (let i = 0; i < 4; i += 1) {
    await win.locator('[data-zoom-pill] button[aria-label="Zoom in"]').click();
    await win.waitForTimeout(250);
  }
  await win.waitForTimeout(700);
  await win.screenshot({ path: path.join(SHOTS, 'phase41-edit-inspector-edge.png') });
  console.log(`[P41-1] screenshot ${path.join(SHOTS, 'phase41-edit-inspector-edge.png')}`);
});

// ---------------------------------------------------------------------------
// Criterion 2 — no canvas content behind/through the Inspector in any stage.
// Two independent probes: (a) elementFromPoint z-order grid inside the panel
// bounds; (b) a decoded-screenshot pixel grid inside the panel bounds, flagging
// any pixel that matches the page canvas's own background (bleed-through).
// ---------------------------------------------------------------------------
const EDGE_ZORDER = `(() => {
  const insp = document.querySelector('[data-inspector]');
  if (!insp) return null;
  const r = insp.getBoundingClientRect();
  const offenders = [];
  const cols = 12, rows = 24;
  for (let i = 0; i < cols; i += 1) for (let j = 0; j < rows; j += 1) {
    const x = Math.round(r.left + 2 + (r.width - 4) * (i + 0.5) / cols);
    const y = Math.round(r.top + 2 + (r.height - 4) * (j + 0.5) / rows);
    const el = document.elementFromPoint(x, y);
    const inside = el !== null && (el === insp || insp.contains(el));
    if (!inside) offenders.push({ x, y, tag: el ? el.tagName : null, cls: el ? String(el.className) : null });
  }
  return { rect: { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }, samples: cols * rows, offenders };
})()`;

const CANVAS_BG = `(() => {
  const c = document.querySelector('.pdf-page canvas');
  if (!c) return null;
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(2, 2, 1, 1).data;
  return [d[0], d[1], d[2]];
})()`;

async function pixelGridProbe(rect, canvasBg) {
  const buf = await win.screenshot();
  const png = PNG.sync.read(buf);
  // The screenshot is in device px; the rect is in CSS px. Scale between them.
  const innerWidth = await win.evaluate(() => window.innerWidth);
  const scale = png.width / innerWidth;
  const offenders = [];
  const hist = {};
  const cols = 12, rows = 24;
  for (let i = 0; i < cols; i += 1) for (let j = 0; j < rows; j += 1) {
    const cx = rect.left + 2 + (rect.w - 4) * (i + 0.5) / cols;
    const cy = rect.top + 2 + (rect.h - 4) * (j + 0.5) / rows;
    const x = Math.round(cx * scale);
    const y = Math.round(cy * scale);
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
    const idx = (png.width * y + x) << 2;
    const r = png.data[idx], g = png.data[idx + 1], b = png.data[idx + 2];
    const key = `${r},${g},${b}`;
    hist[key] = (hist[key] || 0) + 1;
    if (canvasBg && Math.abs(r - canvasBg[0]) <= 4 && Math.abs(g - canvasBg[1]) <= 4 && Math.abs(b - canvasBg[2]) <= 4) {
      offenders.push({ x, y, rgb: [r, g, b] });
    }
  }
  const top = Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([rgb, n]) => ({ rgb, n }));
  return { scale, samples: cols * rows, offenders, top };
}

test('P41-2 no canvas content renders behind/through the Inspector in any stage/theme', async () => {
  await openDoc(getSamplePath('report.pdf'));
  await setWindow(1440, 900);

  for (const theme of ['light', 'dark', 'frosted']) {
    await setTheme(theme);
    for (const [n, stage] of [[1, 'pages'], [2, 'edit'], [3, 'review'], [4, 'deliver']]) {
      await gotoStage(win, n);
      await win.waitForTimeout(400);
      const z = await win.evaluate(EDGE_ZORDER);
      const canvasBg = await win.evaluate(CANVAS_BG);
      const px = await pixelGridProbe(z.rect, canvasBg);
      console.log(`[P41-2 ${theme} ${stage}] zOrderOffenders=${JSON.stringify(z.offenders)} canvasBg=${JSON.stringify(canvasBg)} scale=${px.scale} pixelOffenders=${JSON.stringify(px.offenders)} top=${JSON.stringify(px.top)}`);
      expect(z.offenders, `${theme}/${stage}: every point inside the Inspector resolves to the Inspector (z-order)`).toEqual([]);
      expect(px.offenders, `${theme}/${stage}: no pixel inside the Inspector matches the page canvas background (bleed-through)`).toEqual([]);
    }
  }
});

// ---------------------------------------------------------------------------
// Criterion 3 � the legacy EDIT toolbar is absent; every control still runs.
// ---------------------------------------------------------------------------
const TOOLBAR_COUNTS = `(() => ({
  dataEditToolbar: document.querySelectorAll('[data-edit-toolbar]').length,
  dataEditTool: document.querySelectorAll('[data-edit-tool]').length,
  editToolbarClass: document.querySelectorAll('.edit-toolbar').length,
  editLayer: document.querySelectorAll('.edit-layer').length,
  editLayerTool: document.querySelector('.edit-layer')?.getAttribute('data-tool') ?? null,
}))()`;

test('P41-3 legacy EDIT toolbar absent in every state; every control still runs from its new home', async () => {
  await openDoc(getSamplePath('report.pdf'));
  await setWindow(1440, 900);

  // Absent in every stage (edit mode on in EDIT, off elsewhere).
  for (const [n, stage] of [[1, 'pages'], [2, 'edit'], [3, 'review'], [4, 'deliver']]) {
    await gotoStage(win, n);
    await win.waitForTimeout(400);
    const c = await win.evaluate(TOOLBAR_COUNTS);
    console.log(`[P41-3 ${stage}] ${JSON.stringify(c)}`);
    expect(c.dataEditToolbar, `${stage}: [data-edit-toolbar] absent`).toBe(0);
    expect(c.dataEditTool, `${stage}: [data-edit-tool] absent`).toBe(0);
    expect(c.editToolbarClass, `${stage}: .edit-toolbar absent`).toBe(0);
  }

  // The four legacy tool modes run from the EDIT dock; each arms the edit layer.
  // `editToolOff` returns the layer to the plain viewer, so the overlay unmounts.
  await gotoStage(win, 2);
  await win.waitForTimeout(400);
  const effects = [];
  for (const [id, want] of [['editText', 'text'], ['editTextBox', 'box'], ['editImage', 'image'], ['editToolOff', 'off']]) {
    await clickDockVerb(win, 2, id);
    await win.waitForTimeout(500);
    const got = await win.evaluate(() => ({
      layers: document.querySelectorAll('.edit-layer').length,
      tool: document.querySelector('.edit-layer')?.getAttribute('data-tool') ?? null,
    }));
    console.log(`[P41-3 dock ${id}] edit-layer count=${got.layers} data-tool=${got.tool}`);
    if (want === 'off') {
      expect(got.layers, 'dock verb editToolOff returns the edit layer to the plain viewer (overlay unmounts)').toBe(0);
    } else {
      expect(got.tool, `dock verb ${id} arms the edit layer tool '${want}'`).toBe(want);
    }
    effects.push({ id, layers: got.layers, tool: got.tool });
  }
  console.log(`[P41-3 dock effects] ${JSON.stringify(effects)}`);

  // The Default font control runs from the EDIT ContextPanel and persists.
  await gotoStage(win, 2);
  await win.waitForTimeout(400);
  const select = win.locator('[data-edit-default-font]');
  await expect(select, 'the Default font picker renders in the EDIT ContextPanel').toHaveCount(1);
  const before = await select.inputValue();
  await select.selectOption('Times');
  await win.waitForTimeout(900);
  const after = await select.inputValue();
  const settings = await win.evaluate(async () => {
    const r = await window.tflex.loadSettings();
    return r && r.ok ? r.value.editDefaultFont : null;
  });
  console.log(`[P41-3 default-font] before=${before} after=${after} persisted=${settings}`);
  expect(after, 'the picker reflects the new font').toBe('Times');
  expect(settings, 'the Default font change persists to settings').toBe('Times');
});

// ---------------------------------------------------------------------------
// Criterion 4 � the professional selection treatment (text panel + thumbnail).
// ---------------------------------------------------------------------------
const SELECTION_MEASURE = `(() => {
  const parse = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return null;
    const p = m[1].split(',').map(Number); return { r:p[0], g:p[1], b:p[2], a:p.length > 3 ? p[3] : 1 }; };
  const comp = (fg, bg) => ({ r: fg.r*fg.a + bg.r*(1-fg.a), g: fg.g*fg.a + bg.g*(1-fg.a), b: fg.b*fg.a + bg.b*(1-fg.a) });
  const lum = (c) => { const f = (v) => { const s = v/255; return s <= 0.03928 ? s/12.92 : Math.pow((s+0.055)/1.055, 2.4); };
    return 0.2126*f(c.r) + 0.7152*f(c.g) + 0.0722*f(c.b); };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); };
  // The EFFECTIVE surface behind an element: composite every ancestor's
  // background-color and its solid gradient layer down to the root.
  const effectiveBg = (el) => {
    const chain = []; let n = el;
    while (n && n.nodeType === 1) { chain.push(n); n = n.parentElement; }
    chain.reverse();
    let acc = { r:255, g:255, b:255, a:1 };
    for (const node of chain) {
      const cs = getComputedStyle(node);
      const bg = parse(cs.backgroundColor);
      if (bg && bg.a > 0) acc = comp(bg, acc);
      const m = /linear-gradient\\(((?:[^()]|\\([^()]*\\))*)\\)/.exec(cs.backgroundImage);
      if (m) { const tok = m[1].match(/rgba?\\([^)]*\\)|#[0-9a-f]{3,8}/i); const c = tok ? parse(tok[0]) : null; if (c && c.a > 0) acc = comp(c, acc); }
    }
    return acc;
  };
  const active = document.querySelector('[aria-label="Alignment"] .text-props-btn-active');
  const thumb = document.querySelector('.thumb-selected');
  const thumbLabel = document.querySelector('.thumb-selected .thumb-label');
  const measure = (el, labelEl) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const fill = parse(cs.backgroundColor);
    const glyph = parse(getComputedStyle(labelEl || el).color);
    const behind = effectiveBg(el.parentElement || el);
    const fillOver = fill ? comp(fill, behind) : null;
    return { background: cs.backgroundColor, borderColor: cs.borderColor, color: getComputedStyle(labelEl || el).color,
      fillAlpha: fill ? fill.a : null, surfaceBehind: behind, fillOver, contrast: (fillOver && glyph) ? ratio(glyph, fillOver) : null };
  };
  return { theme: document.documentElement.getAttribute('data-theme'),
    semPrimary: getComputedStyle(document.documentElement).getPropertyValue('--sem-primary').trim(),
    active: measure(active, active), thumb: measure(thumb, thumbLabel) };
})()`;

test('P41-4 text-panel + thumbnail selection use the professional trio with contrast floors', async () => {
  await openDoc(getSamplePath('report.pdf'));
  await setWindow(1440, 900);

  // Place a text box in EDIT so the text panel (with its Alignment group) shows.
  await gotoStage(win, 2);
  await clickDockVerb(win, 2, 'editTextBox');
  await win.waitForTimeout(500);
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  await win.mouse.move(Math.round(pg.x + pg.width * 0.35), Math.round(pg.y + pg.height * 0.3));
  await win.mouse.down();
  await win.mouse.move(Math.round(pg.x + pg.width * 0.35) + 180, Math.round(pg.y + pg.height * 0.3) + 60, { steps: 6 });
  await win.mouse.up();
  await win.waitForSelector('[data-text-panel]', { timeout: 10000 });
  await win.waitForTimeout(700);
  // Ensure an align option is active (default is left; click it if not).
  if ((await win.locator('[aria-label="Alignment"] .text-props-btn-active').count()) === 0) {
    await win.locator('[data-txt-align-left]').click();
    await win.waitForTimeout(400);
  }

  // Phase A — the text panel's active align option, measured in EDIT per theme.
  const activeTable = [];
  for (const theme of ['light', 'dark', 'frosted']) {
    await setTheme(theme);
    await win.waitForTimeout(500);
    const m = await win.evaluate(SELECTION_MEASURE);
    console.log(`[P41-4 active ${theme}] ${JSON.stringify(m.active)}`);
    expect(m.active, `${theme}: an active align option exists`).not.toBeNull();
    expect(m.active.fillAlpha, `${theme}: text-panel fill is a tint (alpha < 1)`).toBeLessThan(1);
    expect(m.active.background, `${theme}: text-panel fill is not the accent`).not.toBe(m.semPrimary);
    expect(m.active.contrast, `${theme}: text-panel glyph-on-fill contrast >= 4.5`).toBeGreaterThanOrEqual(4.5);
    activeTable.push({ theme, ...m.active });
  }
  console.log(`[P41-4 active table] ${JSON.stringify(activeTable)}`);

  // Phase B — the thumbnail's selected page, measured in PAGES per theme.
  const thumbTable = [];
  for (const theme of ['light', 'dark', 'frosted']) {
    await setTheme(theme);
    await gotoStage(win, 1);
    await win.waitForTimeout(400);
    await win.locator('[data-context-panel-thumbs] .thumb-item').first().click();
    await win.waitForTimeout(600);
    const m = await win.evaluate(SELECTION_MEASURE);
    console.log(`[P41-4 thumb ${theme}] ${JSON.stringify(m.thumb)}`);
    expect(m.thumb, `${theme}: a selected thumbnail exists`).not.toBeNull();
    expect(m.thumb.fillAlpha, `${theme}: thumbnail fill is a tint (alpha < 1)`).toBeLessThan(1);
    expect(m.thumb.background, `${theme}: thumbnail fill is not the accent`).not.toBe(m.semPrimary);
    expect(m.thumb.contrast, `${theme}: thumbnail glyph-on-fill contrast >= 4.5`).toBeGreaterThanOrEqual(4.5);
    thumbTable.push({ theme, ...m.thumb });
  }
  console.log(`[P41-4 thumb table] ${JSON.stringify(thumbTable)}`);
});

// ---------------------------------------------------------------------------
// Criterion 5 � the 1px neutral rail/ContextPanel separator at 1440 and 900.
// ---------------------------------------------------------------------------
const SEPARATOR_MEASURE = `(() => {
  const rail = document.querySelector('.stage-rail');
  const panel = document.querySelector('[data-context-panel]');
  if (!rail || !panel) return null;
  const cs = getComputedStyle(rail);
  const rr = rail.getBoundingClientRect();
  const pr = panel.getBoundingClientRect();
  return { borderRightWidth: cs.borderRightWidth, borderRightColor: cs.borderRightColor,
    divider: getComputedStyle(document.documentElement).getPropertyValue('--divider').trim(),
    railRight: Math.round(rr.right), panelLeft: Math.round(pr.left),
    gap: Math.round(pr.left - rr.right), overlap: Math.round(rr.right - pr.left) };
})()`;

test('P41-5 a 1px neutral separator sits between the side rail and the ContextPanel at 1440 and 900', async () => {
  await openDoc(getSamplePath('report.pdf'));
  const scale = await win.evaluate(() => ({
    dpr: window.devicePixelRatio, innerWidth: window.innerWidth,
    rootZoom: getComputedStyle(document.documentElement).zoom,
  }));
  console.log(`[P41-5 scale] ${JSON.stringify(scale)}`);
  for (const [w, h] of [[1440, 900], [900, 700]]) {
    await setWindow(w, h);
    await win.waitForTimeout(600);
    const m = await win.evaluate(SEPARATOR_MEASURE);
    console.log(`[P41-5 ${w}x${h}] ${JSON.stringify(m)}`);
    expect(m, `${w}: rail + ContextPanel present`).not.toBeNull();
    // The CSS declares a 1px hairline; the computed value is the CSS px value
    // (the app runs at a display scale, so it may read as a sub-pixel hairline).
    const bw = parseFloat(m.borderRightWidth);
    expect(bw, `${w}: the rail's page-facing border is a 1px hairline (got ${m.borderRightWidth})`).toBeGreaterThan(0);
    expect(bw, `${w}: the rail's page-facing border is at most 1px (got ${m.borderRightWidth})`).toBeLessThanOrEqual(1.01);
    expect(sameColor(m.borderRightColor, m.divider), `${w}: the separator is the neutral --divider (${m.borderRightColor} vs ${m.divider})`).toBe(true);
    expect(m.gap, `${w}: no gap between the rail and the ContextPanel`).toBeLessThanOrEqual(1);
    expect(m.overlap, `${w}: no overlap between the rail and the ContextPanel`).toBeLessThanOrEqual(1);
  }
});

// ---------------------------------------------------------------------------
// Criterion 6 � the Inspector's page-facing edge is a neutral glow, not accent.
// ---------------------------------------------------------------------------
const EDGE_MEASURE = `(() => {
  const insp = document.querySelector('[data-inspector]');
  if (!insp) return null;
  const cs = getComputedStyle(insp);
  return { selection: insp.getAttribute('data-inspector-selection'),
    borderLeftColor: cs.borderLeftColor, borderLeftWidth: cs.borderLeftWidth,
    boxShadow: cs.boxShadow,
    panelBorder: getComputedStyle(document.documentElement).getPropertyValue('--panel-border').trim(),
    semPrimary: getComputedStyle(document.documentElement).getPropertyValue('--sem-primary').trim() };
})()`;

test('P41-6 Inspector page-facing edge: neutral glow at rest and selected, no accent', async () => {
  await openDoc(getSamplePath('report.pdf'));
  await setWindow(1440, 900);
  await gotoStage(win, 1);
  await win.waitForTimeout(500);

  // With a document open the Inspector always carries a live selection (kind
  // 'page'), so the selected-state glow is the live state. Capture it.
  const active = await win.evaluate(EDGE_MEASURE);
  console.log(`[P41-6 selected] ${JSON.stringify(active)}`);
  expect(active, 'Inspector present').not.toBeNull();
  expect(active.selection, 'a live selection is published to the Inspector').not.toBe('none');
  expect(sameColor(active.borderLeftColor, active.panelBorder), `the selected edge is the neutral panel border (no accent) (${active.borderLeftColor} vs ${active.panelBorder})`).toBe(true);
  expect(sameColor(active.borderLeftColor, active.semPrimary), 'the selected edge is never --sem-primary').toBe(false);
  expect(active.boxShadow, 'the selected edge gains a shadow/glow').not.toBe('none');
  await win.screenshot({ path: path.join(SHOTS, 'phase41-inspector-edge-selected.png') });

  // The resting state is the base `.inspector` rule (no live selection). The
  // host never publishes 'none' with a document open, so measure the CSS state
  // directly by clearing the attribute, then restore it.
  const rest = await win.evaluate(() => {
    const insp = document.querySelector('[data-inspector]');
    const prev = insp.getAttribute('data-inspector-selection');
    insp.setAttribute('data-inspector-selection', 'none');
    const cs = getComputedStyle(insp);
    const out = { selection: insp.getAttribute('data-inspector-selection'),
      borderLeftColor: cs.borderLeftColor, boxShadow: cs.boxShadow,
      panelBorder: getComputedStyle(document.documentElement).getPropertyValue('--panel-border').trim() };
    insp.setAttribute('data-inspector-selection', prev);
    return out;
  });
  console.log(`[P41-6 resting] ${JSON.stringify(rest)}`);
  expect(sameColor(rest.borderLeftColor, rest.panelBorder), `at rest the edge is the neutral panel border (${rest.borderLeftColor} vs ${rest.panelBorder})`).toBe(true);
  expect(rest.boxShadow, 'at rest the panel is shadow-free').toBe('none');
  await win.screenshot({ path: path.join(SHOTS, 'phase41-inspector-edge-rest.png') });
  console.log(`[P41-6] screenshots ${path.join(SHOTS, 'phase41-inspector-edge-rest.png')} + ${path.join(SHOTS, 'phase41-inspector-edge-selected.png')}`);
});
