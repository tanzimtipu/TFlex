/* Adversary Phase 41 probe (evidence artifact, not a Playwright spec - lives in
 * test-fixtures/ so Playwright never collects it). Runs the dev build through
 * the canonical e2e launcher.
 *
 * Usage:  node test-fixtures/adv-p41/probe.cjs <scenario>
 * Prints one JSON line per observation with prefix ADV41.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { PNG } = require('pngjs');

const HERE = __dirname;
const SHOTS = path.join(HERE, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const ROOT = path.resolve(HERE, '..', '..');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (label, obj) => console.log(`ADV41 ${label} ${JSON.stringify(obj)}`);

function samplePath(name) {
  return path.join(ROOT, 'assets', 'samples', name);
}

async function setWinSize(app, win, w, h) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) bw.setSize(size.w, size.h);
  }, { w, h });
  await win.waitForFunction((want) => Math.abs(window.innerWidth - want) <= 24, w, { timeout: 8000 }).catch(() => {});
  await sleep(500);
}

async function openSampleCard(win, name) {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1400);
}

async function setTheme(win, theme, viaUi = false) {
  if (viaUi) {
    await win.click('[data-theme-toggle]');
    await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
    await win.click(`[data-theme-option="${theme}"]`);
  } else {
    await win.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  }
  await win.waitForFunction((w) => document.documentElement.getAttribute('data-theme') === w, theme).catch(() => {});
  await win.waitForTimeout(500);
}

async function gotoStage(win, stage) {
  await win.evaluate(() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); });
  await win.keyboard.press(`Control+${stage}`);
  await win.waitForTimeout(450);
}

async function dumpPageErrors(win) {
  return win.evaluate(() => window.__advErrors || []).catch(() => []);
}

// ---------------------------------------------------------------------------
// Colour helpers (in-page)
// ---------------------------------------------------------------------------
const COLOR_JS = `
  window.__advParseColor = (c) => { const m = /rgba?\\(([^)]+)\\)/.exec(c || ''); if (!m) return null;
    const p = m[1].split(',').map(Number); return { r:p[0], g:p[1], b:p[2], a:p.length>3?p[3]:1 }; };
  window.__advLum = (c) => { const f = (v) => { const s=v/255; return s<=0.03928?s/12.92:Math.pow((s+0.055)/1.055,2.4); };
    return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b); };
  window.__advComp = (fg,bg) => ({ r: fg.r*fg.a+bg.r*(1-fg.a), g: fg.g*fg.a+bg.g*(1-fg.a), b: fg.b*fg.a+bg.b*(1-fg.a), a:1 });
  window.__advEffBg = (el) => { const chain=[]; let n=el; while(n&&n.nodeType===1){chain.push(n);n=n.parentElement;} chain.reverse();
    let acc={r:255,g:255,b:255,a:1};
    for(const node of chain){ const cs=getComputedStyle(node); const bg=window.__advParseColor(cs.backgroundColor);
      if(bg&&bg.a>0) acc=window.__advComp(bg,acc);
      const m=/linear-gradient\\(([^)]*)\\)/.exec(cs.backgroundImage); if(m){const tok=m[1].match(/rgba?\\([^)]*\\)|#[0-9a-f]{3,8}/i); const c=tok?window.__advParseColor(tok[0]):null; if(c&&c.a>0) acc=window.__advComp(c,acc);} }
    return acc; };
  window.__advRatio = (a,b) => { const l1=window.__advLum(a), l2=window.__advLum(b); const hi=Math.max(l1,l2), lo=Math.min(l1,l2); return Math.round(((hi+0.05)/(lo+0.05))*1000)/1000; };
`;

async function installColorHelpers(win) {
  await win.evaluate(COLOR_JS);
}

// ---------------------------------------------------------------------------
// Scenario: recon - just dump the structure so the probes below are grounded.
// ---------------------------------------------------------------------------
async function scenarioRecon(app, win) {
  await openSampleCard(win, 'report.pdf');
  await setWinSize(app, win, 1440, 900);
  await setTheme(win, 'light');
  const out = await win.evaluate(() => {
    const q = (s) => document.querySelectorAll(s).length;
    const insp = document.querySelector('[data-inspector]');
    const appMain = document.querySelector('.app-main');
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      inspector: !!insp,
      inspectorClass: insp ? insp.className : null,
      inspectorStage: insp ? insp.getAttribute('data-inspector-stage') : null,
      inspectorSelection: insp ? insp.getAttribute('data-inspector-selection') : null,
      appMainClass: appMain ? appMain.className : null,
      appMainChildren: appMain ? Array.from(appMain.children).map((c) => c.className || c.tagName) : null,
      dataEditToolbar: q('[data-edit-toolbar]'),
      dataEditTool: q('[data-edit-tool]'),
      editLayer: q('.edit-layer'),
      ocrPanel: q('[data-ocr-suspects-panel]'),
      sideRail: q('.side-rail'),
      contextPanel: q('[data-context-panel]'),
      stageRail: q('.stage-rail'),
      themeToggle: q('[data-theme-toggle]'),
      ctxPanelSelectors: Array.from(document.querySelectorAll('[data-context-panel]')).map((p) => p.getAttribute('data-context-panel')),
    };
  });
  log('recon', out);
}

// ---------------------------------------------------------------------------
// Scenario: surface - Inspector opacity + geometry + bleed, per theme x stage,
// plus collapse toggling, window resize and Multi Mode.
// ---------------------------------------------------------------------------
const INSPECTOR = `(() => {
  const el = document.querySelector('[data-inspector]');
  if (!el) return null;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const bg = window.__advParseColor(cs.backgroundColor);
  const appMain = document.querySelector('.app-main');
  return {
    cls: el.className,
    stage: el.getAttribute('data-inspector-stage'),
    selection: el.getAttribute('data-inspector-selection'),
    collapsed: el.getAttribute('data-inspector-collapsed'),
    theme: document.documentElement.getAttribute('data-theme'),
    backgroundColor: cs.backgroundColor, bgAlpha: bg ? bg.a : null,
    backgroundImage: cs.backgroundImage, isolation: cs.isolation, zIndex: cs.zIndex,
    borderLeftColor: cs.borderLeftColor, borderLeftWidth: cs.borderLeftWidth,
    borderRadius: cs.borderRadius, boxShadow: cs.boxShadow,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) },
    toolsOpen: appMain ? appMain.getAttribute('data-tools-open') : null,
    insetToken: appMain ? getComputedStyle(appMain).getPropertyValue('--tf-tools-inset').trim() : null,
    panelBgToken: getComputedStyle(document.documentElement).getPropertyValue('--panel-bg').trim(),
    canvasOpaque: getComputedStyle(document.documentElement).getPropertyValue('--tf-canvas-opaque').trim(),
  };
})()`;

const CANVAS_BG = `(() => {
  const c = document.querySelector('.pdf-page canvas');
  if (!c) return null;
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(2, 2, 1, 1).data;
  return [d[0], d[1], d[2]];
})()`;

// Sample a few CSS-px columns just inside the Inspector's page-facing edge; a
// translucent panel over page text shows DARK glyph pixels in that margin.
async function bleedProbe(win, rect) {
  const buf = await win.screenshot();
  const png = PNG.sync.read(buf);
  const innerWidth = await win.evaluate(() => window.innerWidth);
  const scale = png.width / innerWidth;
  const cols = [1, 2, 3, 4, 5];
  const rows = [];
  const step = 2;
  const y0 = Math.max(0, Math.round((rect.y + 6) * scale));
  const y1 = Math.min(png.height, Math.round((rect.bottom - 6) * scale));
  for (let y = y0; y < y1; y += step) rows.push(y);
  const darkHits = [];
  const colors = {};
  for (const cy of cols) {
    const x = Math.round((rect.x + cy) * scale);
    for (const y of rows) {
      const idx = (png.width * y + x) << 2;
      const r = png.data[idx], g = png.data[idx + 1], b = png.data[idx + 2];
      const key = `${r},${g},${b}`;
      colors[key] = (colors[key] || 0) + 1;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (lum < 110) darkHits.push({ x, y, rgb: [r, g, b] });
    }
  }
  const top = Object.entries(colors).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([rgb, n]) => ({ rgb, n }));
  return { scale, sampled: cols.length * rows.length, darkHits: darkHits.slice(0, 12), darkCount: darkHits.length, top };
}

async function zoomIn(win, times) {
  const btn = win.locator('[data-zoom-pill] button[aria-label="Zoom in"]').first();
  if ((await btn.count()) === 0) return 0;
  for (let i = 0; i < times; i += 1) { await btn.click().catch(() => {}); await win.waitForTimeout(250); }
  await win.waitForTimeout(600);
  return times;
}

async function scenarioSurface(app, win) {
  await installColorHelpers(win);
  await openSampleCard(win, 'report.pdf');
  await setWinSize(app, win, 1440, 900);
  const out = { states: [], bleed: [] };

  for (const theme of ['light', 'dark', 'frosted']) {
    await setTheme(win, theme);
    for (const [n, stage] of [[1, 'pages'], [2, 'edit'], [3, 'review'], [4, 'deliver']]) {
      await gotoStage(win, n);
      const m = await win.evaluate(INSPECTOR);
      out.states.push({ theme, stage, bgAlpha: m.bgAlpha, backgroundImage: m.backgroundImage, isolation: m.isolation, zIndex: m.zIndex, borderLeft: `${m.borderLeftWidth} ${m.borderLeftColor}`, radius: m.borderRadius, rect: m.rect, inset: m.insetToken, panelBg: m.panelBgToken, canvasOpaque: m.canvasOpaque, boxShadow: m.boxShadow });
    }
  }

  // Bleed: EDIT in each theme, page zoomed hard against the panel edge.
  for (const theme of ['light', 'dark', 'frosted']) {
    await setTheme(win, theme);
    await gotoStage(win, 2);
    await zoomIn(win, 4);
    const m = await win.evaluate(INSPECTOR);
    const px = await bleedProbe(win, m.rect);
    out.bleed.push({ theme, stage: 'edit', rect: m.rect, bgAlpha: m.bgAlpha, darkCount: px.darkCount, top: px.top, darkHits: px.darkHits });
    await win.screenshot({ path: path.join(SHOTS, `surface-bleed-${theme}.png`) });
  }

  // Toggle collapse repeatedly in EDIT, check geometry + inset stability.
  await setTheme(win, 'light');
  await gotoStage(win, 2);
  const toggles = [];
  for (let i = 0; i < 6; i += 1) {
    const btn = win.locator('[data-inspector-collapse]').first();
    const cnt = await btn.count();
    if (cnt === 0) { toggles.push({ i, err: 'no collapse control' }); break; }
    await btn.click({ force: true }).catch(() => {});
    await win.waitForTimeout(420);
    const m = await win.evaluate(INSPECTOR);
    toggles.push({ i, collapsed: m.collapsed, w: m.rect.w, inset: m.insetToken, toolsOpen: m.toolsOpen });
  }
  out.toggles = toggles;

  // Window resize while open.
  const resizes = [];
  for (const [w, h] of [[1920, 1080], [900, 700], [720, 1000], [640, 620], [1440, 900]]) {
    await setWinSize(app, win, w, h);
    const m = await win.evaluate(INSPECTOR);
    resizes.push({ w, h, rectW: m.rect.w, collapsed: m.collapsed, inset: m.insetToken, toolsOpen: m.toolsOpen, bgAlpha: m.bgAlpha });
  }
  out.resizes = resizes;
  log('surface', out);
}

// ---------------------------------------------------------------------------
// Scenario: ocrbar - DEF-357 regression: bar vs Inspector geometry, close-button
// hit test, body clip, toggle + resize, Multi Mode. Runs a REAL current-page OCR.
// ---------------------------------------------------------------------------
async function openOcrSuspects(win) {
  // Command palette -> recognizeText -> OCR dialog -> current page -> confirm.
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
  await win.locator('[data-command-palette-input]').fill('recognize');
  await win.waitForTimeout(400);
  const row = win.locator('[data-palette-tool-id="recognizeText"]').first();
  if (await row.count()) await row.click(); else await win.keyboard.press('Enter');
  await win.waitForSelector('[data-ocr-confirm]', { timeout: 10000 });
  await win.click('[data-ocr-scope="currentPage"]').catch(() => {});
  await win.waitForTimeout(150);
  await win.click('[data-ocr-confirm]');
  await win.waitForSelector('[data-ocr-suspects-panel]', { timeout: 300000 });
  await win.waitForTimeout(800);
}

const OCRBAR = `(() => {
  const bar = document.querySelector('[data-ocr-suspects-panel]');
  if (!bar) return { present: false };
  const br = bar.getBoundingClientRect();
  const insp = document.querySelector('[data-inspector]');
  const ir = insp ? insp.getBoundingClientRect() : null;
  const close = bar.querySelector('.ocr-suspects-close');
  const cr = close ? close.getBoundingClientRect() : null;
  const hit = cr ? document.elementFromPoint(Math.round(cr.x + cr.width / 2), Math.round(cr.y + cr.height / 2)) : null;
  const isClose = hit ? (hit === close || close.contains(hit)) : null;
  const body = bar.querySelector('.ocr-suspects-body');
  const header = bar.querySelector('.ocr-suspects-header');
  const hr = header ? header.getBoundingClientRect() : null;
  const appMain = document.querySelector('.app-main');
  const barCS = getComputedStyle(bar);
  return {
    present: true,
    barRect: { x: Math.round(br.x), y: Math.round(br.y), w: Math.round(br.width), h: Math.round(br.height), right: Math.round(br.right), bottom: Math.round(br.bottom) },
    barHeight: barCS.height, overflow: barCS.overflow,
    inspectorRect: ir ? { x: Math.round(ir.x), y: Math.round(ir.y), w: Math.round(ir.width), right: Math.round(ir.right) } : null,
    inspectorSelection: insp ? insp.getAttribute('data-inspector-selection') : null,
    gap: ir ? Math.round(ir.x - br.right) : null,
    overlap: ir ? Math.round(br.right - ir.x) : null,
    inset: appMain ? getComputedStyle(appMain).getPropertyValue('--tf-tools-inset').trim() : null,
    toolsOpen: appMain ? appMain.getAttribute('data-tools-open') : null,
    closeRect: cr ? { x: Math.round(cr.x), y: Math.round(cr.y), w: Math.round(cr.width), h: Math.round(cr.height) } : null,
    closeHitIsClose: isClose,
    closeTag: hit ? hit.tagName : null,
    closeHitClass: hit ? String(hit.className) : null,
    headerBottom: hr ? Math.round(hr.bottom) : null,
    bodyPresent: !!body,
    bodyScrollH: body ? body.scrollHeight : null,
    bodyClientH: body ? body.clientHeight : null,
    suspectRows: bar.querySelectorAll('[data-ocr-suspect-word]').length,
    summary: (bar.querySelector('.ocr-suspects-summary') || {}).textContent ? bar.querySelector('.ocr-suspects-summary').textContent.trim() : null,
  };
})()`;

async function scenarioOcrbar(app, win) {
  await installColorHelpers(win);
  await openSampleCard(win, 'report.pdf');
  await setWinSize(app, win, 1440, 900);
  await openOcrSuspects(win);
  const out = {};
  out.open = await win.evaluate(OCRBAR);
  out.lastRun = { pageErrors: await dumpPageErrors(win) };
  await win.screenshot({ path: path.join(SHOTS, 'ocrbar-open.png') });

  // Real pointer click on the close control: does it close?
  try {
    await win.click('.ocr-suspects-close', { timeout: 4000 });
    await win.waitForTimeout(500);
    out.realClickClosed = (await win.locator('[data-ocr-suspects-panel]').count()) === 0;
  } catch (e) {
    out.realClickClosed = false;
    out.realClickError = String(e).split('\n')[0].slice(0, 200);
  }

  // Re-open via the palette's ocrSuspects row (enabled after the run).
  if ((await win.locator('[data-ocr-suspects-panel]').count()) === 0) {
    if ((await win.locator('[data-command-palette]').count()) === 0) {
      await win.keyboard.press('Control+k');
      await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
    }
    await win.locator('[data-command-palette-input]').fill('suspects');
    await win.waitForTimeout(400);
    const r = win.locator('[data-palette-tool-id="ocrSuspects"]').first();
    if (await r.count()) await r.click(); else await win.keyboard.press('Enter');
    await win.waitForSelector('[data-ocr-suspects-panel]', { timeout: 15000 });
    await win.waitForTimeout(600);
  }
  out.reopened = await win.evaluate(OCRBAR);

  // Collapse the Inspector: bar should reserve only the 44px strip.
  const collapse = win.locator('[data-inspector-collapse]').first();
  if (await collapse.count()) {
    await collapse.click({ force: true });
    await win.waitForTimeout(600);
    out.inspectorCollapsed = await win.evaluate(OCRBAR);
    await collapse.click({ force: true });
    await win.waitForTimeout(600);
    out.inspectorExpanded = await win.evaluate(OCRBAR);
  }

  // Resize sweep with both open.
  const sizes = [];
  for (const [w, h] of [[1920, 1080], [1024, 800], [900, 700], [760, 900], [640, 620], [1440, 900]]) {
    await setWinSize(app, win, w, h);
    const m = await win.evaluate(OCRBAR);
    sizes.push({ w, h, barRect: m.barRect, inspectorRect: m.inspectorRect, gap: m.gap, overlap: m.overlap, closeHitIsClose: m.closeHitIsClose, inset: m.inset });
  }
  out.sizes = sizes;

  // Theme sweep with both open.
  const themes = [];
  for (const t of ['light', 'dark', 'frosted']) {
    await setTheme(win, t);
    const m = await win.evaluate(OCRBAR);
    themes.push({ t, gap: m.gap, overlap: m.overlap, closeHitIsClose: m.closeHitIsClose, barRect: m.barRect, inspectorRect: m.inspectorRect });
  }
  out.themes = themes;
  await win.screenshot({ path: path.join(SHOTS, 'ocrbar-final.png') });
  log('ocrbar', out);
}

// ---------------------------------------------------------------------------
// Scenario: editretire - hunt for a lost/unreachable edit capability.
// ---------------------------------------------------------------------------
const EDIT_STATE = `(() => {
  const layer = document.querySelector('.edit-layer');
  const verbs = Array.from(document.querySelectorAll('[data-dock-verb]')).map((v) => ({
    id: v.getAttribute('data-dock-verb'),
    pressed: v.getAttribute('aria-pressed'),
    disabled: v.disabled === true,
    label: (v.getAttribute('aria-label') || v.textContent || '').trim().slice(0, 40),
  }));
  const font = document.querySelector('[data-edit-default-font]');
  return {
    stage: document.querySelector('[data-inspector]') ? document.querySelector('[data-inspector]').getAttribute('data-inspector-stage') : null,
    editLayer: layer ? layer.getAttribute('data-tool') : null,
    editLayerCount: document.querySelectorAll('.edit-layer').length,
    legacyToolbar: document.querySelectorAll('[data-edit-toolbar], .edit-toolbar, [data-edit-tool]').length,
    fontPresent: !!font,
    fontValue: font ? font.value : null,
    fontDisabled: font ? font.disabled : null,
    verbs,
    toolbarCount: document.querySelectorAll('.toolbar').length,
    chromeRows: Array.from(document.querySelectorAll('.toolbar, .search-bar, .edit-toolbar')).map((e) => e.className),
    pageErrors: window.__advErrors || [],
  };
})()`;

async function scenarioEditRetire(app, win) {
  await installColorHelpers(win);
  await openSampleCard(win, 'report.pdf');
  await setWinSize(app, win, 1440, 900);
  const out = { steps: [] };

  // Absent in every stage.
  for (const [n, stage] of [[1, 'pages'], [2, 'edit'], [3, 'review'], [4, 'deliver']]) {
    await gotoStage(win, n);
    const s = await win.evaluate(EDIT_STATE);
    out.steps.push({ step: `stage-${stage}`, legacyToolbar: s.legacyToolbar, editLayer: s.editLayer, editLayerCount: s.editLayerCount, fontPresent: s.fontPresent });
  }

  // Arm each edit verb on EDIT and record the layer tool + pressed state.
  await gotoStage(win, 2);
  for (const id of ['editText', 'editTextBox', 'editImage', 'editToolOff']) {
    const v = win.locator(`[data-dock-verb="${id}"]`).first();
    const present = await v.count();
    if (!present) { out.steps.push({ step: `verb-${id}`, present: false }); continue; }
    const vis = await v.isVisible().catch(() => false);
    await v.click({ force: !vis }).catch(() => {});
    await win.waitForTimeout(450);
    const s = await win.evaluate(EDIT_STATE);
    out.steps.push({ step: `verb-${id}`, present: true, visible: vis, layer: s.editLayer, layerCount: s.editLayerCount, verbState: s.verbs.find((x) => x.id === id), allEditVerbs: s.verbs.filter((x) => x.id.startsWith('edit')).map((x) => ({ id: x.id, pressed: x.pressed, disabled: x.disabled })) });
  }

  // Rapid switching.
  await gotoStage(win, 2);
  const ids = ['editText', 'editImage', 'editTextBox', 'editToolOff'];
  for (let i = 0; i < 24; i += 1) {
    const id = ids[i % ids.length];
    await win.locator(`[data-dock-verb="${id}"]`).first().click({ force: true }).catch(() => {});
    await win.waitForTimeout(80);
  }
  await win.waitForTimeout(500);
  out.afterRapid = await win.evaluate(EDIT_STATE);

  // Leave EDIT with a tool armed, come back.
  await gotoStage(win, 2);
  await win.locator('[data-dock-verb="editText"]').first().click({ force: true }).catch(() => {});
  await win.waitForTimeout(400);
  const beforeLeave = await win.evaluate(EDIT_STATE);
  await gotoStage(win, 1);
  const onLeave = await win.evaluate(EDIT_STATE);
  await gotoStage(win, 2);
  const onReturn = await win.evaluate(EDIT_STATE);
  out.leaveReturn = { beforeLeave: beforeLeave.editLayer, onLeave: onLeave.editLayer, onLeaveCount: onLeave.editLayerCount, onReturn: onReturn.editLayer, onReturnCount: onReturn.editLayerCount };

  // Default font: change + persist.
  await gotoStage(win, 2);
  const font = win.locator('[data-edit-default-font]').first();
  out.fontPresent = await font.count();
  if (out.fontPresent) {
    const before = await font.inputValue();
    await font.selectOption('Times').catch(() => {});
    await win.waitForTimeout(900);
    const after = await font.inputValue();
    const settings = await win.evaluate(async () => { const r = await window.tflex.loadSettings(); return r && r.ok ? r.value.editDefaultFont : null; });
    out.font = { before, after, persisted: settings };
  }

  // Palette routes: every edit tool id reachable in the palette with a doc in EDIT.
  await gotoStage(win, 2);
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
  await win.locator('[data-command-palette-input]').fill('');
  await win.waitForTimeout(400);
  out.paletteRows = await win.evaluate(() => Array.from(document.querySelectorAll('[data-palette-row="tool"]')).filter((r) => (r.getAttribute('data-palette-tool-id') || '').startsWith('edit')).map((r) => ({ id: r.getAttribute('data-palette-tool-id'), disabled: r.getAttribute('data-palette-disabled'), pinned: r.getAttribute('data-palette-pinned') })));
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);

  // Close the document with a tool armed: no crash, state resets.
  await gotoStage(win, 2);
  await win.locator('[data-dock-verb="editText"]').first().click({ force: true }).catch(() => {});
  await win.waitForTimeout(400);
  const tab = win.locator('.tab-list [data-tab-id]').first();
  const closeBtn = tab.locator('[data-tab-close], button[aria-label*="Close"]');
  out.tabCloseCount = await closeBtn.count();
  if (await closeBtn.count()) { await closeBtn.first().click({ force: true }).catch(() => {}); await win.waitForTimeout(900); }
  out.afterClose = await win.evaluate(() => ({ sampleCards: document.querySelectorAll('.sample-card').length, editLayers: document.querySelectorAll('.edit-layer').length, tabs: document.querySelectorAll('.tab-list [data-tab-id]').length, pageErrors: window.__advErrors || [] }));

  log('editretire', out);
}

// ---------------------------------------------------------------------------
// Scenario: selstates - selection styling under hover/press/focus/disabled.
// ---------------------------------------------------------------------------
const SEL = `(() => {
  const measure = (el, labelEl) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const fill = window.__advParseColor(cs.backgroundColor);
    const glyph = window.__advParseColor(getComputedStyle(labelEl || el).color);
    const behind = window.__advEffBg(el.parentElement || el);
    const fillOver = fill ? window.__advComp(fill, behind) : null;
    return {
      background: cs.backgroundColor, fillAlpha: fill ? fill.a : null,
      borderColor: cs.borderColor, color: getComputedStyle(labelEl || el).color,
      boxShadow: cs.boxShadow, outline: cs.outline,
      fillOver: fillOver ? { r: Math.round(fillOver.r), g: Math.round(fillOver.g), b: Math.round(fillOver.b) } : null,
      contrast: (fillOver && glyph) ? window.__advRatio(glyph, fillOver) : null,
      focused: document.activeElement === el,
    };
  };
  const alignActive = document.querySelector('[aria-label="Alignment"] .text-props-btn-active');
  const alignAll = Array.from(document.querySelectorAll('[aria-label="Alignment"] .text-props-btn'));
  const spacingActive = document.querySelector('[aria-label="Spacing"], [aria-label="Line spacing"]');
  const spacingGroupActive = document.querySelector('.text-props-btn-active:not([aria-label="Alignment"] .text-props-btn-active)');
  const thumbo = document.querySelector('.thumb-selected');
  const thumbCur = document.querySelector('.thumb-current');
  const selectedThumbs = document.querySelectorAll('.thumb-selected').length;
  return {
    theme: document.documentElement.getAttribute('data-theme'),
    alignActive: measure(alignActive),
    alignAll: alignAll.map((b) => ({ active: b.classList.contains('text-props-btn-active'), col: b.getAttribute('data-txt-align'), m: measure(b) })),
    spacingGroupActive: measure(spacingGroupActive),
    thumb: measure(thumbo, thumbo ? thumbo.querySelector('.thumb-label') : null),
    thumbCurrent: measure(thumbCur, thumbCur ? thumbCur.querySelector('.thumb-label') : null),
    selectedThumbs,
  };
})()`;

async function measureAlignStates(win) {
  return win.evaluate(SEL);
}

async function scenarioSelStates(app, win) {
  await installColorHelpers(win);
  await openSampleCard(win, 'report.pdf');
  await setWinSize(app, win, 1440, 900);

  // Make a text box so the text panel (Alignment) appears. EDIT stage.
  await gotoStage(win, 2);
  await win.locator('[data-dock-verb="editTextBox"]').first().click({ force: true }).catch(() => {});
  await win.waitForTimeout(500);
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  if (pg) {
    await win.mouse.move(Math.round(pg.x + pg.width * 0.3), Math.round(pg.y + pg.height * 0.3));
    await win.mouse.down();
    await win.mouse.move(Math.round(pg.x + pg.width * 0.3) + 160, Math.round(pg.y + pg.height * 0.3) + 50, { steps: 6 });
    await win.mouse.up();
  }
  await win.waitForSelector('[data-text-panel]', { timeout: 10000 }).catch(() => {});
  await win.waitForTimeout(700);
  // Ensure an align option is active.
  if ((await win.locator('[aria-label="Alignment"] .text-props-btn-active').count()) === 0) {
    await win.locator('[data-txt-align-left]').click().catch(() => {});
    await win.waitForTimeout(400);
  }

  const out = { themes: [] };
  for (const theme of ['light', 'dark', 'frosted']) {
    await setTheme(win, theme);
    const resting = await measureAlignStates(win);
    // Hover the active align option.
    const activeSel = '[aria-label="Alignment"] .text-props-btn-active';
    await win.locator(activeSel).first().hover({ force: true }).catch(() => {});
    await win.waitForTimeout(250);
    const hovered = await win.evaluate(SEL);
    // Hover a NON-active align option and note its wash (compare against active fill).
    const nonActive = win.locator('[aria-label="Alignment"] .text-props-btn:not(.text-props-btn-active)').first();
    let nonActiveHover = null;
    if (await nonActive.count()) {
      await nonActive.hover({ force: true }).catch(() => {});
      await win.waitForTimeout(250);
      nonActiveHover = await win.evaluate(() => {
        const el = document.querySelector('[aria-label="Alignment"] .text-props-btn:not(.text-props-btn-active)');
        if (!el) return null;
        const cs = getComputedStyle(el);
        const fill = window.__advParseColor(cs.backgroundColor);
        const behind = window.__advEffBg(el.parentElement || el);
        const over = fill ? window.__advComp(fill, behind) : null;
        return { background: cs.backgroundColor, fillAlpha: fill ? fill.a : null, fillOver: over ? { r: Math.round(over.r), g: Math.round(over.g), b: Math.round(over.b) } : null, borderColor: cs.borderColor, boxShadow: cs.boxShadow };
      });
    }
    // Focus the active option via Tab/keyboard focus.
    await win.locator(activeSel).first().focus().catch(() => {});
    await win.waitForTimeout(250);
    const focused = await win.evaluate(SEL);
    // Press and hold the active option.
    const box = await win.locator(activeSel).first().boundingBox().catch(() => null);
    let pressed = null;
    if (box) {
      await win.mouse.move(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
      await win.mouse.down();
      await win.waitForTimeout(200);
      pressed = await win.evaluate(SEL);
      await win.mouse.up();
      await win.waitForTimeout(150);
    }
    out.themes.push({ theme, resting: resting.alignActive, hovered: hovered.alignActive, nonActiveHover, focused: focused.alignActive, pressed: pressed ? pressed.alignActive : null });
  }

  // Thumbnail states in PAGES: current, selected, selected+focused, multi-select.
  const thumbs = [];
  for (const theme of ['light', 'dark', 'frosted']) {
    await setTheme(win, theme);
    await gotoStage(win, 1);
    const tab = win.locator('[data-rail-tab="pages"]').first();
    if (await tab.count()) { await tab.click().catch(() => {}); await win.waitForTimeout(600); }
    const items = win.locator('[data-context-panel-thumbs] .thumb-item, [data-context-panel-thumbs] .thumb');
    const n = await items.count();
    if (n === 0) { thumbs.push({ theme, err: 'no thumbs' }); continue; }
    await items.nth(0).click().catch(() => {});
    await win.waitForTimeout(500);
    const selected = await win.evaluate(SEL);
    let focused = null;
    await items.nth(0).focus().catch(() => {});
    await win.waitForTimeout(250);
    focused = await win.evaluate(SEL);
    // multi-select: ctrl+click a second thumb
    let multi = null;
    if (n > 1) {
      await items.nth(1).click({ modifiers: ['Control'] }).catch(() => {});
      await win.waitForTimeout(500);
      multi = await win.evaluate(SEL);
    }
    thumbs.push({ theme, n, selected: selected.thumb, selectedCurrent: selected.thumbCurrent, focused: focused.thumb, multiCount: multi ? multi.selectedThumbs : null, multi: multi ? multi.thumb : null });
    await win.screenshot({ path: path.join(SHOTS, `sel-thumb-${theme}.png`) });
  }
  out.thumbs = thumbs;

  // Forced-colors (high-contrast) emulation.
  try {
    await win.emulateMedia({ forcedColors: 'active' });
    await win.waitForTimeout(400);
    out.forcedColors = await win.evaluate(SEL);
    await win.emulateMedia({ forcedColors: 'none' });
  } catch (e) {
    out.forcedColors = { err: String(e).slice(0, 150) };
  }
  log('selstates', out);
}

// ---------------------------------------------------------------------------
// Scenario: seps - rail/ContextPanel divider + Inspector edge glow.
// ---------------------------------------------------------------------------
const SEP = `(() => {
  const root = getComputedStyle(document.documentElement);
  const rail = document.querySelector('.side-rail') || document.querySelector('.stage-rail');
  const panel = document.querySelector('[data-context-panel]');
  const insp = document.querySelector('[data-inspector]');
  const out = { theme: document.documentElement.getAttribute('data-theme'), divider: root.getPropertyValue('--divider').trim(), panelBorder: root.getPropertyValue('--panel-border').trim(), semPrimary: root.getPropertyValue('--sem-primary').trim() };
  if (rail) { const cs = getComputedStyle(rail); const r = rail.getBoundingClientRect();
    out.rail = { cls: rail.className, borderRightWidth: cs.borderRightWidth, borderRightColor: cs.borderRightColor, x: Math.round(r.x), right: Math.round(r.right), w: Math.round(r.width) };
  }
  if (panel) { const r = panel.getBoundingClientRect(); out.panel = { cls: panel.className, x: Math.round(r.x), left: Math.round(r.left), w: Math.round(r.width) }; }
  if (rail && panel) { out.gap = Math.round(panel.getBoundingClientRect().left - rail.getBoundingClientRect().right); out.overlap = Math.round(rail.getBoundingClientRect().right - panel.getBoundingClientRect().left); }
  if (insp) { const cs = getComputedStyle(insp); const r = insp.getBoundingClientRect();
    out.inspector = { selection: insp.getAttribute('data-inspector-selection'), borderLeftColor: cs.borderLeftColor, borderLeftWidth: cs.borderLeftWidth, boxShadow: cs.boxShadow, x: Math.round(r.x) };
  }
  return out;
})()`;

async function scenarioSeps(app, win) {
  await installColorHelpers(win);
  await openSampleCard(win, 'report.pdf');
  const out = { sizes: [], themes: [] };
  for (const [w, h] of [[1440, 900], [900, 700]]) {
    await setWinSize(app, win, w, h);
    await gotoStage(win, 1);
    out.sizes.push({ w, h, ...(await win.evaluate(SEP)) });
  }
  await setWinSize(app, win, 1440, 900);
  for (const t of ['light', 'dark', 'frosted']) {
    await setTheme(win, t);
    out.themes.push({ t, ...(await win.evaluate(SEP)) });
  }
  // Editor: selected state vs forced resting state (attribute cleared).
  await setTheme(win, 'light');
  await gotoStage(win, 2);
  out.edgeSelected = await win.evaluate(() => {
    const i = document.querySelector('[data-inspector]');
    if (!i) return null;
    const cs = getComputedStyle(i);
    return { selection: i.getAttribute('data-inspector-selection'), borderLeftColor: cs.borderLeftColor, boxShadow: cs.boxShadow };
  });
  out.edgeRest = await win.evaluate(() => {
    const i = document.querySelector('[data-inspector]');
    if (!i) return null;
    const prev = i.getAttribute('data-inspector-selection');
    i.setAttribute('data-inspector-selection', 'none');
    const cs = getComputedStyle(i);
    const out = { selection: 'none', borderLeftColor: cs.borderLeftColor, boxShadow: cs.boxShadow };
    i.setAttribute('data-inspector-selection', prev);
    return out;
  });
  // Multi Mode: divider + strips.
  await gotoStage(win, 1);
  const mm = win.locator('[data-header-multi-mode]').first();
  if (await mm.count()) {
    await mm.click().catch(() => {});
    await win.waitForTimeout(1200);
    out.multi = await win.evaluate(SEP);
    await win.screenshot({ path: path.join(SHOTS, 'seps-multi.png') });
  }
  log('seps', out);
}

// ---------------------------------------------------------------------------
// Scenario: inspector-overlap - every stage: is any control under the panel
// unreachable? elementFromPoint inside panel bounds must resolve to the panel.
// ---------------------------------------------------------------------------
async function scenarioOverlap(app, win) {
  await openSampleCard(win, 'report.pdf');
  await setWinSize(app, win, 1440, 900);
  const out = { stages: [] };
  for (const [n, stage] of [[1, 'pages'], [2, 'edit'], [3, 'review'], [4, 'deliver']]) {
    await gotoStage(win, n);
    const r = await win.evaluate(() => {
      const insp = document.querySelector('[data-inspector]');
      if (!insp) return null;
      const ir = insp.getBoundingClientRect();
      const cols = 10, rows = 18;
      const offenders = [];
      for (let i = 0; i < cols; i += 1) for (let j = 0; j < rows; j += 1) {
        const x = Math.round(ir.left + 2 + (ir.width - 4) * (i + 0.5) / cols);
        const y = Math.round(ir.top + 2 + (ir.height - 4) * (j + 0.5) / rows);
        const el = document.elementFromPoint(x, y);
        const inside = el !== null && (el === insp || insp.contains(el));
        if (!inside) offenders.push({ x, y, tag: el ? el.tagName : null, cls: el ? String(el.className) : null });
      }
      // Also: controls just LEFT of the panel (page-facing) must be clickable.
      return { rect: { left: Math.round(ir.left), top: Math.round(ir.top), w: Math.round(ir.width), h: Math.round(ir.height) }, samples: cols * rows, offenders };
    });
    out.stages.push({ stage, ...r });
  }
  log('overlap', out);
}

// ---------------------------------------------------------------------------
// Scenario: detail - (a) the armed edit tool's dock indication, (b) keyboard
// focus-visible on the selected align option, (c) current vs selected thumbs.
// ---------------------------------------------------------------------------
async function scenarioDetail(app, win) {
  await installColorHelpers(win);
  await openSampleCard(win, 'report.pdf');
  await setWinSize(app, win, 1440, 900);
  const out = {};

  // (a) Dock: arm each edit tool, dump the verb's attributes + class list.
  await gotoStage(win, 2);
  const verbDump = async (id) => win.evaluate((vid) => {
    const el = document.querySelector(`[data-dock-verb="${vid}"]`);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      id: vid,
      attrs: Array.from(el.attributes).map((a) => `${a.name}=${a.value}`),
      cls: el.className,
      hasAriaPressed: el.hasAttribute('aria-pressed'),
      ariaPressed: el.getAttribute('aria-pressed'),
      background: cs.backgroundColor, color: cs.color, boxShadow: cs.boxShadow,
      borderColor: cs.borderColor,
    };
  }, id);
  for (const id of ['editText', 'editTextBox', 'editImage', 'editToolOff']) {
    await win.locator(`[data-dock-verb="${id}"]`).first().click({ force: true }).catch(() => {});
    await win.waitForTimeout(450);
    const layer = await win.evaluate(() => document.querySelector('.edit-layer') ? document.querySelector('.edit-layer').getAttribute('data-tool') : null);
    out[`armed_${id}`] = { layer, verb: await verbDump(id), allEditVerbs: await win.evaluate(() => Array.from(document.querySelectorAll('[data-dock-verb]')).filter((v) => (v.getAttribute('data-dock-verb') || '').startsWith('edit')).map((v) => ({ id: v.getAttribute('data-dock-verb'), pressed: v.getAttribute('aria-pressed'), cls: v.className }))) };
    await win.screenshot({ path: path.join(SHOTS, `dock-armed-${id}.png`) });
  }
  out.dockActiveSet = 'DocumentView.tsx: activeToolIds={editModeOpen ? [\'editMode\'] : []}';

  // (b) Keyboard focus-visible on the active align option.
  await gotoStage(win, 2);
  await win.locator('[data-dock-verb="editTextBox"]').first().click({ force: true }).catch(() => {});
  await win.waitForTimeout(400);
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  if (pg) {
    await win.mouse.move(Math.round(pg.x + pg.width * 0.3), Math.round(pg.y + pg.height * 0.3));
    await win.mouse.down();
    await win.mouse.move(Math.round(pg.x + pg.width * 0.3) + 160, Math.round(pg.y + pg.height * 0.3) + 50, { steps: 6 });
    await win.mouse.up();
  }
  await win.waitForSelector('[data-text-panel]', { timeout: 10000 }).catch(() => {});
  await win.waitForTimeout(600);
  if ((await win.locator('[aria-label="Alignment"] .text-props-btn-active').count()) === 0) {
    await win.locator('[data-txt-align-left]').click().catch(() => {});
    await win.waitForTimeout(400);
  }
  const active = win.locator('[aria-label="Alignment"] .text-props-btn-active').first();
  await active.click().catch(() => {});
  await win.waitForTimeout(200);
  await win.keyboard.press('Tab');
  await win.waitForTimeout(150);
  await win.keyboard.press('Shift+Tab');
  await win.waitForTimeout(200);
  out.keyboardFocus = await win.evaluate(() => {
    const el = document.querySelector('[aria-label="Alignment"] .text-props-btn-active');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { focused: document.activeElement === el, matchesFocusVisible: el.matches(':focus-visible'), outline: cs.outline, outlineOffset: cs.outlineOffset, boxShadow: cs.boxShadow, background: cs.backgroundColor };
  });

  // (c) Thumb current vs selected (distinct elements).
  await gotoStage(win, 1);
  const tab = win.locator('[data-rail-tab="pages"]').first();
  if (await tab.count()) { await tab.click().catch(() => {}); await win.waitForTimeout(600); }
  const items = win.locator('[data-context-panel-thumbs] .thumb-item, [data-context-panel-thumbs] .thumb');
  if ((await items.count()) > 2) {
    await items.nth(1).click().catch(() => {});           // page 2 = current
    await win.waitForTimeout(500);
    await items.nth(2).click({ modifiers: ['Control'] }); // page 3 = selected, not current
    await win.waitForTimeout(500);
    out.thumbDistinct = await win.evaluate(() => {
      const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c || ''); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
      const el = (sel) => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const cs = getComputedStyle(e);
        return { cls: e.className, background: cs.backgroundColor, borderColor: cs.borderColor, boxShadow: cs.boxShadow, labelColor: getComputedStyle(e.querySelector('.thumb-label') || e).color };
      };
      return {
        selectedOnly: el('.thumb-selected:not(.thumb-current)'),
        currentOnly: el('.thumb-current:not(.thumb-selected)'),
        currentAndSelected: el('.thumb-current.thumb-selected'),
        selectedCount: document.querySelectorAll('.thumb-selected').length,
      };
    });
    await win.screenshot({ path: path.join(SHOTS, 'thumb-current-vs-selected.png') });
  }
  log('detail', out);
}

// ---------------------------------------------------------------------------
// Scenario: states2 - hover/press/focus/disabled + forced-colors + display scale
// on the selection treatment, and Multi Mode selection.
// ---------------------------------------------------------------------------
async function scenarioStates2(app, win) {
  await installColorHelpers(win);
  await openSampleCard(win, 'report.pdf');
  await setWinSize(app, win, 1440, 900);
  const out = {};

  // Thumb hover vs selected.
  await setTheme(win, 'light');
  await gotoStage(win, 1);
  const tab = win.locator('[data-rail-tab="pages"]').first();
  if (await tab.count()) { await tab.click().catch(() => {}); await win.waitForTimeout(600); }
  const items = win.locator('[data-context-panel-thumbs] .thumb-item, [data-context-panel-thumbs] .thumb');
  const n = await items.count();
  out.thumbHover = {};
  if (n > 3) {
    await items.nth(0).click(); await win.waitForTimeout(400);
    const read = (sel) => win.evaluate((s) => {
      const e = document.querySelector(s);
      if (!e) return null;
      const cs = getComputedStyle(e);
      return { cls: e.className, background: cs.backgroundColor, borderColor: cs.borderColor, boxShadow: cs.boxShadow, labelColor: getComputedStyle(e.querySelector('.thumb-label') || e).color, transform: cs.transform };
    }, sel);
    out.thumbHover.selectedRest = await read('.thumb-selected');
    await items.nth(0).hover({ force: true }).catch(() => {});
    await win.waitForTimeout(250);
    out.thumbHover.selectedHover = await read('.thumb-selected');
    await items.nth(2).hover({ force: true }).catch(() => {});
    await win.waitForTimeout(250);
    out.thumbHover.plainHover = await read('[data-context-panel-thumbs] .thumb-item:nth-child(3)');
  }

  // Multi Mode selection.
  const mm = win.locator('[data-header-multi-mode]').first();
  if (await mm.count()) {
    await mm.click().catch(() => {});
    await win.waitForTimeout(1200);
    out.multiStage = await win.evaluate(() => ({
      multi: document.querySelectorAll('[data-multi-mode], .tab-stage[data-multi-mode="true"]').length,
      inspectors: document.querySelectorAll('[data-inspector]').length,
      contextPanels: document.querySelectorAll('[data-context-panel]').length,
      railDivider: (() => { const r = document.querySelector('.stage-rail'); if (!r) return null; const cs = getComputedStyle(r); return { borderRight: cs.borderRightColor, divider: getComputedStyle(document.documentElement).getPropertyValue('--divider').trim() }; })(),
    }));
    const mm2 = win.locator('[data-header-multi-mode]').first();
    if (await mm2.count()) { await mm2.click().catch(() => {}); await win.waitForTimeout(900); }
  }

  // Forced colors: selected vs unselected thumb.
  await gotoStage(win, 1);
  if (n > 2) { await items.nth(0).click(); await win.waitForTimeout(400); }
  out.forced = {};
  const readFC = () => win.evaluate(() => {
    const grab = (e) => { if (!e) return null; const cs = getComputedStyle(e); return { background: cs.backgroundColor, borderColor: cs.borderColor, boxShadow: cs.boxShadow, outline: cs.outline, labelColor: getComputedStyle(e.querySelector('.thumb-label') || e).color, forcedAdjust: cs.forcedColorAdjust }; };
    return { selected: grab(document.querySelector('.thumb-selected')), plain: grab(document.querySelector('[data-context-panel-thumbs] .thumb-item:not(.thumb-selected)')) };
  });
  out.forced.before = await readFC();
  try {
    await win.emulateMedia({ forcedColors: 'active' });
    await win.waitForTimeout(400);
    out.forced.active = await readFC();
    await win.screenshot({ path: path.join(SHOTS, 'states2-forced-colors.png') });
    await win.emulateMedia({ forcedColors: 'none' });
  } catch (e) { out.forced.err = String(e).slice(0, 200); }
  try {
    await win.emulateMedia({ prefersContrast: 'more' });
    await win.waitForTimeout(300);
    out.forced.prefersMore = await readFC();
    await win.emulateMedia({ prefersContrast: 'no-preference' });
  } catch (e) { out.forced.err2 = String(e).slice(0, 200); }

  log('states2', out);
}

// ---- main --------------------------------------------------------------------
const SCENARIOS = {
  recon: scenarioRecon,
  surface: scenarioSurface,
  ocrbar: scenarioOcrbar,
  editretire: scenarioEditRetire,
  selstates: scenarioSelStates,
  seps: scenarioSeps,
  overlap: scenarioOverlap,
  detail: scenarioDetail,
  states2: scenarioStates2,
};

async function main() {
  const name = process.argv[2] || 'recon';
  const scenario = SCENARIOS[name];
  if (!scenario) { console.error('unknown scenario', name); process.exit(2); }
  const app = await launchApp();
  let win;
  try {
    win = await app.firstWindow();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(1200);
    await win.evaluate(() => {
      window.__advErrors = [];
      window.addEventListener('pageerror', (e) => { window.__advErrors.push(String(e.message)); });
    });
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await scenario(app, win);
  } catch (e) {
    log(`${name}-ERROR`, { error: String(e && e.stack ? e.stack : e).slice(0, 1500) });
  } finally {
    await sleep(400);
    setTimeout(() => process.exit(0), 4000).unref();
    try { await Promise.race([app.close(), sleep(4000)]); } catch { /* ignore */ }
    process.exit(0);
  }
}

main();
