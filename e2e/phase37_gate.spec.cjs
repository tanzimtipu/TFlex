// Phase 37 gate (qa) — the 22 operator items encoded by REQUIREMENTS.md's
// 15 success criteria. Six grouped surfaces:
//   A (items 1, 3, 5, 10, 22)  Inspector integration + chrome
//   B (items 4, 8, 9, 15, 16, 18, 19)  thumbnail panel + rail
//   C (items 11, 12, 13)  edit text
//   D (item 14)  "Rename pages"
//   E (items 2, 6, 7, 20, 21)  Action Dock behaviour
//   F (item 17)  the standalone print window
//
// Evidence-first: every test logs the raw DOM/geometry before asserting.
// Launches only through the canonical e2e/lib/launch.cjs launchApp helper.
// Exactly the SEVEN dispatch-named screenshots are captured.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const DOCK_STAGE_IDS = {
  pages: ['rotate', 'extract', 'insertPages', 'replacePages', 'split', 'delete', 'merge', 'cropPages'],
  edit: ['editText', 'editImage', 'editTextBox', 'recognizeText', 'batchOcr', 'ocrSuspects'],
  review: ['annotate', 'sign', 'stamp', 'flatten', 'forms', 'watermark', 'exportComments', 'importComments'],
  deliver: ['optimize', 'audit', 'exportPages', 'exportText', 'exportDocx', 'createFromImages'],
};

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(250);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p37-gate');
  app = null;
  win = null;
});
test.setTimeout(420000);

async function openSample(name = 'report.pdf') {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

async function setWindowSize(w, h) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const bw = BrowserWindow.getAllWindows().find(
      (x) => !x.webContents.getURL().includes('tfWindow=print'),
    );
    if (bw) bw.setSize(s[0], s[1]);
  }, [w, h]);
  await win.waitForTimeout(700);
  await win.waitForFunction((t) => Math.abs(window.innerWidth - t) < 45, w, { timeout: 10000 });
}

async function gotoStage(n) {
  await win.evaluate(() => {
    const el = document.activeElement;
    if (el !== null && typeof el.blur === 'function') el.blur();
  });
  await win.keyboard.press(`Control+${n}`);
  await win.waitForTimeout(400);
}

const dockInfo = () => win.evaluate(() => {
  const d = document.querySelector('[data-action-dock]');
  if (d === null) return null;
  const dr = d.getBoundingClientRect();
  const verbs = [...d.querySelectorAll('[data-dock-verb]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.getAttribute('data-dock-verb'), top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right) };
  });
  const labels = [...d.querySelectorAll('.action-dock-label')].map((el) => el.textContent);
  const sc = document.querySelector('[data-dock-scroll]');
  return {
    innerWidth: window.innerWidth,
    height: Math.round(dr.height),
    width: Math.round(dr.width),
    left: Math.round(dr.left),
    right: Math.round(dr.right),
    arrows: d.getAttribute('data-dock-arrows'),
    // DEF-337 — the ladder's arrows LANE, independent of the gated arrows.
    arrowsLane: d.getAttribute('data-dock-arrows-lane'),
    iconOnly: d.getAttribute('data-dock-icon-only'),
    flexWrap: getComputedStyle(d).flexWrap,
    verbRows: new Set(verbs.map((v) => v.top)).size,
    verbs,
    labels,
    scrollWidth: sc?.scrollWidth ?? null,
    clientWidth: sc?.clientWidth ?? null,
    scrollDisplay: sc ? getComputedStyle(sc).display : null,
    hint: document.querySelector('[data-dock-hint]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    overflow: d.querySelectorAll('[data-dock-overflow]').length,
  };
});

// The dock's full rendered set: the inline verbs plus (when the `...` chip is
// present at a non-arrow width) its overflow menu rows.
async function dockAllVerbIds() {
  const inline = await win.$$eval('[data-action-dock] [data-dock-verb]:not([data-dock-pin])', (els) =>
    els.map((e) => e.getAttribute('data-dock-verb')));
  const overflowCount = await win.locator('[data-dock-overflow]').count();
  if (overflowCount === 0) return inline;
  await win.locator('[data-dock-overflow]').first().click();
  await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 8000 });
  const overflow = await win.$$eval('[data-dock-overflow-item]', (els) =>
    els.map((e) => e.getAttribute('data-dock-overflow-item')));
  await win.keyboard.press('Escape');
  await win.waitForTimeout(250);
  return [...inline, ...overflow];
}

async function loadSettings() {
  const res = await win.evaluate(() => window.tflex.loadSettings());
  return res && res.ok ? res.value : null;
}

// ---------------------------------------------------------------------------
// A. Inspector integration + chrome (items 1, 3, 5, 10, 22)
// ---------------------------------------------------------------------------
test('P37-A Inspector: text block on top, divider, scrolling, flush, collapse, sizing, separators', async () => {
  await openSample('report.pdf');
  await setWindowSize(1440, 900);

  // --- EDIT flow: place a text box; it becomes the live selection. ---
  await gotoStage(2);
  const editToolbar = win.locator('[data-edit-toolbar]');
  await expect(editToolbar).toBeVisible({ timeout: 8000 });
  expect(await win.locator('[data-dock-verb="editMode"]').count(), 'item 13: no editMode dock verb').toBe(0);
  await win.locator('[data-dock-verb="editTextBox"]').click();
  await win.waitForTimeout(500);
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  await win.mouse.click(Math.round(pg.x + pg.width * 0.4), Math.round(pg.y + pg.height * 0.3));
  await win.waitForTimeout(1200);

  let sel = await win.locator('[data-inspector]').getAttribute('data-inspector-selection');
  console.log(`[P37-A] EDIT text selection=${sel}`);
  expect(sel, 'a text object selected in the EDIT flow drives the Inspector').toBe('text');
  const editKids = await win.$$eval('.inspector-body > *', (els) =>
    els.map((e) => e.getAttribute('data-inspector-text-panel') !== null ? 'text-panel'
      : e.getAttribute('data-inspector-divider') !== null ? 'divider'
        : `slot:${e.getAttribute('data-inspector-slot')}`));
  console.log(`[P37-A] EDIT inspector body children=${JSON.stringify(editKids)}`);
  expect(editKids[0], 'the text manipulation leads the column').toBe('text-panel');
  expect(editKids[1], 'a divider separates it from the stage content').toBe('divider');
  expect(editKids[2], 'the stage sections render below').toMatch(/^slot:/);
  expect(await win.locator('[data-inspector-text-panel] [data-text-panel]').count(), 'the re-parented panel renders inline').toBe(1);
  expect(await win.locator('[data-inspector] [data-txt-text]').count(), 'the panel Text field is present').toBe(1);

  // --- REVIEW/annotate flow: place + select a text ANNOTATION. ---
  await gotoStage(3);
  await win.locator('[data-dock-verb="annotate"]').click();
  await win.waitForSelector('[data-annotation-flyout]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-ann-dropdown-toggle]').click();
  await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-ann-dropdown-menu] button[data-tool="textbox"]').click();
  await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'detached', timeout: 8000 });
  await win.waitForTimeout(400);
  const pg2 = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const ax = Math.round(pg2.x + pg2.width * 0.3);
  const ay = Math.round(pg2.y + pg2.height * 0.3);
  await win.mouse.move(ax, ay);
  await win.mouse.down();
  await win.mouse.move(ax + 160, ay + 50, { steps: 5 });
  await win.mouse.up();
  await win.waitForSelector('[data-txt-text]', { timeout: 10000 });
  await win.waitForTimeout(600);
  sel = await win.locator('[data-inspector]').getAttribute('data-inspector-selection');
  const annKids = await win.$$eval('.inspector-body > *', (els) =>
    els.map((e) => e.getAttribute('data-inspector-text-panel') !== null ? 'text-panel'
      : e.getAttribute('data-inspector-divider') !== null ? 'divider'
        : `slot:${e.getAttribute('data-inspector-slot')}`));
  console.log(`[P37-A] REVIEW text selection=${sel} body children=${JSON.stringify(annKids)}`);
  expect(sel, 'a text annotation selected in the annotate flow drives the Inspector').toBe('text');
  expect(annKids[0]).toBe('text-panel');
  expect(annKids[1]).toBe('divider');
  await win.screenshot({ path: path.join(SHOTS, 'phase37-inspector-text.png') });
  console.log(`[P37-A] screenshot ${path.join(SHOTS, 'phase37-inspector-text.png')}`);

  // --- The column is the ONE scroller: force overflow with a short window. ---
  await setWindowSize(1440, 520);
  const scroll = await win.evaluate(() => {
    const body = document.querySelector('.inspector-body');
    return {
      overflowY: getComputedStyle(body).overflowY,
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
      inlineOverflow: getComputedStyle(document.querySelector('[data-inspector-text-panel] .text-props-panel')).overflow,
      inlineMaxHeight: getComputedStyle(document.querySelector('[data-inspector-text-panel] .text-props-panel')).maxHeight,
    };
  });
  console.log(`[P37-A] inspector scroll=${JSON.stringify(scroll)}`);
  expect(scroll.overflowY, 'the Inspector body is the scroller').toBe('auto');
  expect(scroll.inlineOverflow, 'the inline text panel does not scroll itself').toBe('visible');
  expect(scroll.scrollHeight, 'the column overflows at a short height (scrolls, not clips)').toBeGreaterThan(scroll.clientHeight);
  const before = await win.evaluate(() => document.querySelector('.inspector-body').scrollTop);
  await win.evaluate(() => { document.querySelector('.inspector-body').scrollTop = 99999; });
  const after = await win.evaluate(() => document.querySelector('.inspector-body').scrollTop);
  console.log(`[P37-A] scrollTop ${before} -> ${after}`);
  expect(after, 'the column actually scrolls').toBeGreaterThan(0);
  await setWindowSize(1440, 900);

  // --- Flush geometry. ---
  const flush = await win.evaluate(() => {
    const insp = document.querySelector('[data-inspector]');
    const ir = insp.getBoundingClientRect();
    const ws = document.querySelector('.workspace-main');
    const wr = ws.getBoundingClientRect();
    const cp = document.querySelector('[data-context-panel]');
    const cpr = cp ? cp.getBoundingClientRect() : null;
    const cs = getComputedStyle(insp);
    return {
      inspectorTop: Math.round(ir.top), inspectorLeft: Math.round(ir.left), inspectorRight: Math.round(ir.right),
      workspaceTop: Math.round(wr.top), workspaceRight: Math.round(wr.right),
      contextPanelTop: cpr ? Math.round(cpr.top) : null,
      toolbarH: getComputedStyle(document.documentElement).getPropertyValue('--toolbar-h').trim(),
      radius: cs.borderRadius, shadow: cs.boxShadow, borderLeft: cs.borderLeftWidth + ' ' + cs.borderLeftColor,
    };
  });
  console.log(`[P37-A] flush=${JSON.stringify(flush)}`);
  expect.soft(flush.radius, 'no rounded left corner').toBe('0px');
  expect.soft(flush.shadow, 'no shadow seam').toBe('none');
  expect.soft(
    Math.abs(flush.inspectorTop - flush.workspaceTop),
    `Inspector is flush with the canvas top (inspector=${flush.inspectorTop} canvas=${flush.workspaceTop} leftPanel=${flush.contextPanelTop})`,
  ).toBeLessThanOrEqual(2);

  // --- Collapse/expand via the control, and the ladder precedence. ---
  await gotoStage(2);
  const collapse = win.locator('[data-inspector-collapse]');
  await expect(collapse).toHaveCount(1);
  await collapse.click();
  await win.waitForTimeout(500);
  expect(await win.locator('.app-main').getAttribute('data-inspector-collapsed')).toBe('true');
  expect(await win.locator('[data-inspector]').getAttribute('data-inspector-collapsed')).toBe('true');
  expect(await win.locator('[data-inspector-collapsed-strip]').count()).toBe(1);
  await win.locator('[data-inspector-collapse]').click();
  await win.waitForTimeout(500);
  expect(await win.locator('.app-main').getAttribute('data-inspector-collapsed')).toBe('false');

  // Ladder rung 1 at 1150: collapsed. The control reads Expand and one click
  // records the EXPAND intent (DEF-335); the ladder still wins at 1150, and the
  // recorded intent takes effect once the window grows past the rung.
  await setWindowSize(1150, 900);
  expect(await win.locator('.app-main').getAttribute('data-inspector-collapsed'), 'rung 1 collapses the Inspector').toBe('true');
  await win.locator('[data-inspector-collapse]').click();
  await win.waitForTimeout(500);
  expect(await win.locator('.app-main').getAttribute('data-inspector-collapsed'), 'precedence: the ladder still wins at 1150').toBe('true');
  await setWindowSize(1440, 900);
  await win.waitForTimeout(400);
  expect(await win.locator('.app-main').getAttribute('data-inspector-collapsed'), 'growing past the rung applies the recorded EXPAND intent (DEF-335)').toBe('false');
  // The recorded EXPAND intent leaves the Inspector expanded at 1440, which is
  // the state the sizing/separator checks below need; no extra toggle here.

  // --- Professional button sizing. ---
  await gotoStage(1);
  await win.locator('[data-context-panel] .thumb-item[data-page="1"]').click();
  await win.waitForTimeout(400);
  const sizing = await win.evaluate(() => {
    const a = document.querySelector('[data-inspector-action="renumber"]');
    const r = a.getBoundingClientRect();
    const cs = getComputedStyle(a);
    return { height: Math.round(r.height), fontSize: cs.fontSize, padding: cs.padding, radius: cs.borderRadius };
  });
  console.log(`[P37-A] inspector action sizing=${JSON.stringify(sizing)}`);
  expect(sizing.height, 'a comfortable hit target (28px)').toBeGreaterThanOrEqual(28);
  expect(parseFloat(sizing.fontSize), 'a legible label (12px)').toBeGreaterThanOrEqual(12);
  expect(sizing.padding).toBe('4px 10px');

  // --- Subtle separators: the divider token, not the heavier border token. ---
  const sep = await win.evaluate(() => {
    const row = document.querySelector('.inspector-section-body > * + *');
    const cs = getComputedStyle(row);
    const root = getComputedStyle(document.documentElement);
    const action = document.querySelector('[data-inspector-action]');
    const alpha = (() => {
      const m = /rgba?\([^)]*?,\s*([0-9.]+)\s*\)/.exec(cs.borderTopColor);
      return m ? Number(m[1]) : 1;
    })();
    return {
      borderTopWidth: cs.borderTopWidth,
      borderTopStyle: cs.borderTopStyle,
      borderTopColor: cs.borderTopColor,
      alpha,
      divider: root.getPropertyValue('--divider').trim(),
      borderToken: root.getPropertyValue('--border').trim(),
      actionBorder: action ? getComputedStyle(action).borderTopColor : null,
    };
  });
  console.log(`[P37-A] separator=${JSON.stringify(sep)}`);
  expect(parseFloat(sep.borderTopWidth), 'a hairline separator').toBeGreaterThan(0);
  expect(sep.borderTopStyle, 'the separator is a solid hairline').toBe('solid');
  expect(sep.alpha, 'the separator is subtle (low alpha), not a heavy border').toBeLessThan(0.1);
  expect(sep.divider, 'the divider token exists').not.toBe('');
  expect(sep.divider, 'the subtle divider differs from the heavier border token').not.toBe(sep.borderToken);
});

// ---------------------------------------------------------------------------
// A2. The secondary tool row (item 3): ONE row, no header, follows the ladder.
// ---------------------------------------------------------------------------
test('P37-A2 secondary row: one row, no header, follows the dock ladder', async () => {
  await openSample('report.pdf');
  await setWindowSize(1440, 900);

  // Annotation flyout (the REVIEW secondary row).
  await gotoStage(3);
  await win.locator('[data-dock-verb="annotate"]').click();
  await win.waitForSelector('[data-annotation-flyout]', { state: 'visible', timeout: 8000 });
  const flyoutWide = await win.evaluate(() => {
    const f = document.querySelector('[data-annotation-flyout]');
    const row = f.querySelector('[data-annotation-flyout-row]');
    const tools = [...f.querySelectorAll('[data-ann-tools-visible] button[data-tool]')];
    return {
      header: f.querySelectorAll('.annotation-flyout-header').length,
      close: f.querySelectorAll('.annotation-flyout-close').length,
      arrows: f.getAttribute('data-flyout-arrows'),
      iconOnly: f.getAttribute('data-flyout-icon-only'),
      rows: new Set(tools.map((t) => Math.round(t.getBoundingClientRect().top))).size,
      tools: tools.length,
      rowFlex: getComputedStyle(row).display,
    };
  });
  console.log(`[P37-A2] flyout wide=${JSON.stringify(flyoutWide)}`);
  expect(flyoutWide.header, 'the flyout header is gone').toBe(0);
  expect(flyoutWide.close, 'the flyout close button is gone').toBe(0);
  expect(flyoutWide.arrows, 'no arrows at 1440').toBe('false');
  expect(flyoutWide.rows, 'the annotation tools are on ONE row').toBe(1);
  expect(flyoutWide.rowFlex).toBe('flex');
  await win.screenshot({ path: path.join(SHOTS, 'phase37-secondary-row.png') });
  console.log(`[P37-A2] screenshot ${path.join(SHOTS, 'phase37-secondary-row.png')}`);

  // The ladder at 640: icon-only, still one row, controls kept. DEF-337 — the
  // arrows are gated on a REAL overflow, and the annotation body fits at 640,
  // so no arrows render (a dead control is never offered).
  await setWindowSize(640, 800);
  await win.waitForTimeout(600);
  const flyoutNarrow = await win.evaluate(() => {
    const f = document.querySelector('[data-annotation-flyout]');
    const sc = document.querySelector('[data-annotation-flyout-scroll]');
    return {
      arrows: f.getAttribute('data-flyout-arrows'),
      iconOnly: f.getAttribute('data-flyout-icon-only'),
      arrowCount: f.querySelectorAll('[data-flyout-arrow]').length,
      tools: f.querySelectorAll('[data-ann-tools-visible] button[data-tool]').length,
      scrollWidth: sc?.scrollWidth ?? null,
      clientWidth: sc?.clientWidth ?? null,
    };
  });
  console.log(`[P37-A2] flyout narrow=${JSON.stringify(flyoutNarrow)}`);
  expect(flyoutNarrow.iconOnly, 'the flyout is icon-only at the last rung').toBe('true');
  // DEF-337 — the arrows render iff the body genuinely overflows; at 640 it fits.
  expect(flyoutNarrow.scrollWidth, 'the flyout body fits at 640').toBe(flyoutNarrow.clientWidth);
  expect(flyoutNarrow.arrows, 'no arrows when the body fits (DEF-337)').toBe('false');
  expect(flyoutNarrow.arrowCount, 'no dead arrow controls render').toBe(0);
  expect(flyoutNarrow.tools, 'no tool is dropped').toBeGreaterThanOrEqual(5);

  // EditToolbar (the EDIT secondary row) at the same ladder.
  await setWindowSize(1440, 900);
  await gotoStage(2);
  const editWide = await win.evaluate(() => {
    const t = document.querySelector('[data-edit-toolbar]');
    const tools = [...t.querySelectorAll('[data-edit-tool]')];
    return {
      arrows: t.getAttribute('data-edit-arrows'),
      iconOnly: t.getAttribute('data-edit-icon-only'),
      rows: new Set(tools.map((x) => Math.round(x.getBoundingClientRect().top))).size,
      tools: tools.length,
      hint: t.querySelectorAll('[data-edit-hint]').length,
    };
  });
  console.log(`[P37-A2] edit toolbar wide=${JSON.stringify(editWide)}`);
  expect(editWide.arrows).toBe('false');
  expect(editWide.rows, 'the edit tools are on ONE row').toBe(1);
  expect(editWide.tools).toBe(4);
  await setWindowSize(640, 800);
  await win.waitForTimeout(600);
  const editNarrow = await win.evaluate(() => {
    const t = document.querySelector('[data-edit-toolbar]');
    const sc = document.querySelector('[data-edit-toolbar-scroll]');
    return {
      arrows: t.getAttribute('data-edit-arrows'),
      iconOnly: t.getAttribute('data-edit-icon-only'),
      arrowCount: t.querySelectorAll('[data-edit-arrow]').length,
      tools: t.querySelectorAll('[data-edit-tool]').length,
      scrollWidth: sc?.scrollWidth ?? null,
      clientWidth: sc?.clientWidth ?? null,
    };
  });
  console.log(`[P37-A2] edit toolbar narrow=${JSON.stringify(editNarrow)}`);
  expect(editNarrow.iconOnly, 'the edit toolbar is icon-only at the last rung').toBe('true');
  // DEF-337 — the arrows render iff the row genuinely overflows; the four edit
  // tools fit at 640, so no dead arrows are offered.
  expect(editNarrow.scrollWidth, 'the edit row fits at 640').toBe(editNarrow.clientWidth);
  expect(editNarrow.arrows, 'no arrows when the edit row fits (DEF-337)').toBe('false');
  expect(editNarrow.arrowCount, 'no dead arrow controls render').toBe(0);
  expect(editNarrow.tools).toBe(4);
});

// ---------------------------------------------------------------------------
// B. Thumbnail panel + rail (items 4, 8, 9, 15, 16, 18, 19)
// ---------------------------------------------------------------------------
async function openSecondDoc(name) {
  const p = getSamplePath(name);
  await app.evaluate(async ({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, p);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(1600);
}

test('P37-B rail/panel: welcome absence, chevron flip, edge gaps, 184px panel, flush Outline, 150px strips with parity', async () => {
  // --- item 8: welcome screen has NO Stage Rail. ---
  await setWindowSize(1440, 900);
  const welcome = await win.evaluate(() => ({
    rail: document.querySelectorAll('[data-stage-rail]').length,
    welcome: !!document.querySelector('.welcome'),
    hidden: document.querySelector('.app-main')?.getAttribute('data-stage-rail-hidden'),
  }));
  console.log(`[P37-B] welcome=${JSON.stringify(welcome)}`);
  expect(welcome.rail, 'the Stage Rail is absent on the welcome screen').toBe(0);
  expect(welcome.welcome).toBe(true);
  expect(welcome.hidden).toBe('true');
  await win.screenshot({ path: path.join(SHOTS, 'phase37-welcome.png') });
  console.log(`[P37-B] screenshot ${path.join(SHOTS, 'phase37-welcome.png')}`);

  // --- item 8: present with a document. ---
  await openSample('report.pdf');
  await setWindowSize(1440, 900);
  expect(await win.locator('[data-stage-rail]').count(), 'the Stage Rail returns with a document').toBe(1);
  expect(await win.locator('.app-main').getAttribute('data-stage-rail-hidden')).toBe('false');

  // --- item 4: the chevron flips both ways. ---
  const collapse = win.locator('[data-rail-collapse]');
  const dir0 = await collapse.getAttribute('data-collapse-direction');
  const icon0 = await collapse.locator('svg').first().getAttribute('class');
  await collapse.click();
  await win.waitForTimeout(600);
  const dir1 = await win.locator('[data-rail-collapse]').getAttribute('data-collapse-direction');
  const icon1 = await win.locator('[data-rail-collapse] svg').first().getAttribute('class');
  await win.locator('[data-rail-collapse]').click();
  await win.waitForTimeout(600);
  const dir2 = await win.locator('[data-rail-collapse]').getAttribute('data-collapse-direction');
  const icon2 = await win.locator('[data-rail-collapse] svg').first().getAttribute('class');
  console.log(`[P37-B] chevron ${dir0}/${icon0} -> ${dir1}/${icon1} -> ${dir2}/${icon2}`);
  expect(dir0).toBe('collapse');
  expect(dir1).toBe('expand');
  expect(icon0).toContain('chevron-left');
  expect(icon1).toContain('chevron-right');
  expect(icon2).toContain('chevron-left');

  // --- item 15: no PAGES title, panel 184px. ---
  const panel = await win.evaluate(() => {
    const p = document.querySelector('[data-context-panel="pages"]');
    const pr = p.getBoundingClientRect();
    return {
      width: Math.round(pr.width),
      title: p.querySelectorAll('.glass-sidebar-title').length,
      titleText: p.querySelector('.glass-sidebar-title')?.textContent ?? null,
      railW: getComputedStyle(document.querySelector('.app-main')).getPropertyValue('--tf-rail-w').trim(),
    };
  });
  console.log(`[P37-B] pages panel=${JSON.stringify(panel)}`);
  expect(panel.title, 'the PAGES "Pages..." title is removed').toBe(0);
  expect(panel.railW).toBe('184px');
  expect(panel.width, 'the panel is 184px').toBeGreaterThanOrEqual(180);
  expect(panel.width).toBeLessThanOrEqual(190);
  await win.screenshot({ path: path.join(SHOTS, 'phase37-panel.png') });
  console.log(`[P37-B] screenshot ${path.join(SHOTS, 'phase37-panel.png')}`);

  // --- item 16: the Outline is the body's last child, flush + separated. ---
  const outline = await win.evaluate(() => {
    const section = document.querySelector('[data-context-panel-outline]');
    const body = document.querySelector('.context-panel-body');
    const p = document.querySelector('[data-context-panel="pages"]');
    if (section === null) return null;
    const sr = section.getBoundingClientRect();
    const pr = p.getBoundingClientRect();
    const cs = getComputedStyle(section);
    const alpha = (() => {
      const m = /rgba?\([^)]*?,\s*([0-9.]+)\s*\)/.exec(cs.borderTopColor);
      return m ? Number(m[1]) : 1;
    })();
    return {
      lastChild: body.lastElementChild === section,
      firstChild: body.firstElementChild === document.querySelector('[data-context-panel-thumbs]'),
      sectionBottom: Math.round(sr.bottom), panelBottom: Math.round(pr.bottom),
      borderTopWidth: cs.borderTopWidth,
      borderTopStyle: cs.borderTopStyle,
      borderTopColor: cs.borderTopColor,
      borderAlpha: alpha,
      divider: getComputedStyle(document.documentElement).getPropertyValue('--divider').trim(),
    };
  });
  console.log(`[P37-B] outline=${JSON.stringify(outline)}`);
  expect(outline, 'report.pdf has an outline').not.toBeNull();
  expect(outline.lastChild, 'the Outline is the body last child (flush at the bottom)').toBe(true);
  expect(Math.abs(outline.sectionBottom - outline.panelBottom), 'the Outline bottom is flush with the panel bottom').toBeLessThanOrEqual(3);
  expect(parseFloat(outline.borderTopWidth), 'a separator above the Outline (hairline)').toBeGreaterThan(0);
  expect(outline.borderTopStyle, 'the Outline separator is a solid hairline').toBe('solid');
  expect(outline.borderAlpha, 'the Outline separator uses the subtle divider token (low alpha)').toBeLessThan(0.1);

  // --- item 9: the placement audit (raw edge gaps; nothing touches an edge). ---
  const gaps = await win.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
    };
    const gearLabel = document.querySelector('[data-stage-rail-gear] .stage-rail-label');
    const gearLabelRect = gearLabel ? gearLabel.getBoundingClientRect() : null;
    return {
      vw, vh,
      fileBtn: r('[data-menu-button]'),
      print: r('[data-print]'),
      gear: r('[data-open-preferences]'),
      railGear: r('[data-stage-rail-gear]'),
      gearLabel: gearLabelRect ? { left: gearLabelRect.left, right: gearLabelRect.right } : null,
      panelCombine: r('[data-context-panel-combine]'),
      panel: r('[data-context-panel="pages"]'),
      dock: r('[data-action-dock]'),
    };
  });
  const edges = {
    fileLeft: gaps.fileBtn ? Math.round(gaps.fileBtn.left) : null,
    printRight: gaps.print ? Math.round(gaps.vw - gaps.print.right) : null,
    gearRight: gaps.gear ? Math.round(gaps.vw - gaps.gear.right) : null,
    railGearLeft: gaps.railGear ? Math.round(gaps.railGear.left) : null,
    settingsLabelLeft: gaps.gearLabel ? Math.round(gaps.gearLabel.left) : null,
    settingsLabelRightGap: gaps.gearLabel ? Math.round(gaps.vw - gaps.gearLabel.right) : null,
    combineLeftGap: gaps.panelCombine && gaps.panel ? Math.round(gaps.panelCombine.left - gaps.panel.left) : null,
    dockBottomGap: gaps.dock ? Math.round(gaps.vh - gaps.dock.bottom) : null,
  };
  console.log(`[P37-B] edge gaps=${JSON.stringify(edges)}`);
  for (const [k, v] of Object.entries(edges)) {
    expect(v, `${k} is a positive edge gap`).toBeGreaterThanOrEqual(1);
  }

  // --- items 18 + 19: Multi Mode strips 150px with single-mode parity. ---
  await openSecondDoc('long.pdf');
  expect(await win.locator('.tab[data-tab-id]').count(), 'two documents open').toBe(2);
  await win.locator('.tab[data-tab-id]').filter({ hasText: 'report' }).first().click();
  await win.waitForTimeout(400);
  await win.locator('[data-header-multi-mode]').click();
  await win.waitForTimeout(1200);
  const emptyB = win.locator('.tab-pane[data-pane="B"][data-pane-empty]');
  if (await emptyB.count()) {
    await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').first().click();
    await win.waitForTimeout(1500);
  }
  await win.waitForSelector('.pane-thumb-strip .thumb-item', { timeout: 30000 });
  await win.waitForTimeout(600);

  const strips = await win.evaluate(() => {
    const list = [...document.querySelectorAll('.pane-thumb-strip')];
    return list.map((s) => {
      const r = s.getBoundingClientRect();
      const thumb = s.querySelector('.thumb-item');
      return { width: Math.round(r.width), thumb: thumb ? Math.round(thumb.getBoundingClientRect().width) : null };
    });
  });
  console.log(`[P37-B] strips=${JSON.stringify(strips)}`);
  expect(strips.length, 'two pane strips render').toBe(2);
  for (const s of strips) {
    expect(s.width, 'the Multi Mode strip is 150px').toBeGreaterThanOrEqual(140);
    expect(s.width).toBeLessThanOrEqual(160);
  }

  const strip = win.locator('.pane-thumb-strip').first();
  const thumb = strip.locator('.thumb-item').first();
  await thumb.hover();
  await win.waitForTimeout(300);
  const verbs = await thumb.locator('[data-thumb-verb]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-thumb-verb')));
  console.log(`[P37-B] strip hover verbs=${JSON.stringify(verbs)}`);
  expect(verbs, 'the same three hover verbs as single mode').toEqual(['rotate-cw', 'extract', 'delete']);

  await thumb.click({ button: 'right' });
  await win.waitForSelector('[data-context-menu]', { state: 'visible', timeout: 8000 });
  const menu = await win.$$eval('[data-context-menu] [data-menu-item]', (els) =>
    els.map((e) => e.textContent.trim()));
  console.log(`[P37-B] strip right-click menu=${JSON.stringify(menu)}`);
  expect(menu.length, 'the same six-item right-click menu').toBe(6);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);

  const thumbs = strip.locator('.thumb-item');
  await thumbs.nth(0).click();
  await win.keyboard.down('Control');
  await thumbs.nth(2).click();
  await win.keyboard.up('Control');
  await win.waitForTimeout(400);
  const selected = await strip.locator('.thumb-selected').count();
  console.log(`[P37-B] strip multi-select count=${selected}`);
  expect(selected, 'multi-select works on the strip').toBe(2);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);

  await thumbs.nth(0).evaluate((el) => {
    const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true });
    // A real HTML5 drag carries a DataTransfer; the app's handler reads it.
    Object.defineProperty(ev, 'dataTransfer', {
      value: { setData: () => undefined, getData: () => '', effectAllowed: '', dropEffect: '', types: [] },
    });
    el.dispatchEvent(ev);
  });
  await win.waitForTimeout(500);
  const dragged = await thumbs.nth(0).evaluate((el) => el.className);
  console.log(`[P37-B] strip dragstart class=${dragged}`);
  expect(dragged, 'drag-reorder is wired on the strip').toContain('thumb-dragging');
  await win.screenshot({ path: path.join(SHOTS, 'phase37-multi-strips.png') });
  console.log(`[P37-B] screenshot ${path.join(SHOTS, 'phase37-multi-strips.png')}`);
});

// ---------------------------------------------------------------------------
// C. Edit text (items 11, 12, 13)
// ---------------------------------------------------------------------------
async function selectTextRun() {
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const fracs = [[0.5, 0.1], [0.3, 0.12], [0.5, 0.16], [0.25, 0.22], [0.5, 0.3], [0.35, 0.42]];
  for (const [fx, fy] of fracs) {
    await win.mouse.click(Math.round(pg.x + pg.width * fx), Math.round(pg.y + pg.height * fy));
    await win.waitForTimeout(550);
    if ((await win.locator('[data-textrun-selection]').count()) > 0) return true;
  }
  return false;
}

test('P37-C edit text: Confirm/Delete/Cancel, selected text visible, stage is the edit-mode switch', async () => {
  await openSample('report.pdf');
  await setWindowSize(1440, 900);

  // --- item 13: the EDIT stage is the switch. ---
  await gotoStage(2);
  expect(await win.locator('[data-edit-toolbar]').count(), 'entering EDIT enables edit mode').toBe(1);
  expect(await win.locator('[data-dock-verb="editMode"]').count(), 'no editMode verb in the EDIT dock').toBe(0);
  await gotoStage(1);
  await win.waitForTimeout(500);
  expect(await win.locator('[data-edit-toolbar]').count(), 'leaving EDIT disables edit mode').toBe(0);
  await gotoStage(3);
  await win.waitForTimeout(500);
  expect(await win.locator('[data-edit-toolbar]').count(), 'REVIEW keeps edit mode off').toBe(0);
  await gotoStage(2);
  await win.waitForTimeout(500);
  expect(await win.locator('[data-edit-toolbar]').count(), 're-entering EDIT re-enables it').toBe(1);

  // --- items 11 + 12: select a text run. ---
  await win.locator('[data-dock-verb="editText"]').click();
  await win.waitForTimeout(500);
  const gotRun = await selectTextRun();
  console.log(`[P37-C] text run selected=${gotRun}`);
  expect(gotRun, 'a text run is selectable in the EDIT flow').toBe(true);

  const bar = await win.evaluate(() => {
    const b = document.querySelector('[data-content-action-bar="textrun"]');
    return {
      verbs: [...b.querySelectorAll('button')].map((x) => x.textContent.trim()),
      hasEdit: b.querySelectorAll('[data-content-action="textrun-edit"]').length,
      confirm: b.querySelectorAll('[data-content-action="textrun-confirm"]').length,
      del: b.querySelectorAll('[data-content-action="textrun-delete"]').length,
      cancel: b.querySelectorAll('[data-content-action="textrun-cancel"]').length,
    };
  });
  console.log(`[P37-C] text-run bar=${JSON.stringify(bar)}`);
  expect(bar.verbs, 'the action bar is Confirm / Delete / Cancel').toEqual(['Confirm', 'Delete', 'Cancel']);
  expect(bar.hasEdit, 'no Edit option').toBe(0);
  expect(bar.confirm + bar.del + bar.cancel).toBe(3);

  const visible = await win.evaluate(() => {
    const eraser = document.querySelector('[data-edit-box-eraser]');
    const preview = document.querySelector('[data-edit-run-preview]');
    return {
      eraser: eraser !== null,
      preview: preview !== null,
      previewText: preview?.textContent?.trim() ?? null,
      paintsOver: eraser !== null && preview !== null
        && (eraser.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    };
  });
  console.log(`[P37-C] selected text visibility=${JSON.stringify(visible)}`);
  expect(visible.eraser, 'the eraser cover masks the baked run').toBe(true);
  expect(visible.preview, 'item 12: the preview backs the cover so the text stays VISIBLE').toBe(true);
  expect(visible.previewText, 'the selected text is actually painted').not.toBe('');
  expect(visible.paintsOver, 'the preview paints after (over) the eraser').toBe(true);

  // --- item 11: Cancel reverts the pending move (nothing reaches the engine). ---
  const modifiedBefore = await win.evaluate(() => window.tflexDiagnostics().modified);
  const selBox = await win.locator('[data-textrun-selection]').boundingBox();
  await win.mouse.move(selBox.x + selBox.width / 2, selBox.y + selBox.height / 2);
  await win.mouse.down();
  await win.mouse.move(selBox.x + selBox.width / 2 + 60, selBox.y + selBox.height / 2 + 30, { steps: 6 });
  await win.mouse.up();
  await win.waitForTimeout(500);
  expect(await win.locator('[data-content-action-bar="textrun"]').count(), 'the bar survives the pending move').toBe(1);
  await win.locator('[data-content-action="textrun-cancel"]').click();
  await win.waitForTimeout(700);
  const modifiedAfter = await win.evaluate(() => window.tflexDiagnostics().modified);
  console.log(`[P37-C] after Cancel: selection=${await win.locator('[data-textrun-selection]').count()} modified ${modifiedBefore} -> ${modifiedAfter}`);
  expect(await win.locator('[data-textrun-selection]').count(), 'Cancel dismisses the selection').toBe(0);
  expect(await win.locator('[data-content-action-bar="textrun"]').count(), 'Cancel closes the bar').toBe(0);
  expect(modifiedAfter, 'Cancel never committed the move to the engine').toBe(modifiedBefore);
});

// ---------------------------------------------------------------------------
// D. Labels (item 14): "Renumber pages" -> "Rename pages" everywhere.
// ---------------------------------------------------------------------------
test('P37-D "Rename pages" everywhere as a label', async () => {
  await openSample('report.pdf');
  await setWindowSize(1440, 900);
  await gotoStage(1);

  // The Inspector's Label affordance.
  await win.locator('[data-context-panel] .thumb-item[data-page="1"]').click();
  await win.waitForTimeout(400);
  const inspectorAction = await win.evaluate(() => {
    const a = document.querySelector('[data-inspector-action="renumber"]');
    return { text: a?.textContent?.trim() ?? null, title: a?.getAttribute('title') ?? null };
  });
  console.log(`[P37-D] inspector action=${JSON.stringify(inspectorAction)}`);
  expect(inspectorAction.text).toContain('rename');
  expect(inspectorAction.text.toLowerCase()).not.toContain('renumber');

  // The dialog title.
  await win.locator('[data-inspector-action="renumber"]').click();
  await win.waitForSelector('[data-renumber-pages-dialog]', { state: 'visible', timeout: 8000 });
  const dialogTitle = await win.locator('[data-renumber-pages-dialog] .modal-title').innerText();
  console.log(`[P37-D] dialog title=${JSON.stringify(dialogTitle)}`);
  expect(dialogTitle.trim()).toBe('Rename pages');
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-renumber-pages-dialog]', { state: 'detached', timeout: 8000 });

  // The Command Palette row label.
  await win.evaluate(() => {
    const el = document.activeElement;
    if (el !== null && typeof el.blur === 'function') el.blur();
  });
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
  await win.fill('[data-command-palette-input]', 'rename');
  await win.waitForTimeout(300);
  const paletteRow = await win.evaluate(() => {
    const row = document.querySelector('[data-palette-tool-id="renumberPages"]');
    return row === null ? null : row.textContent.trim();
  });
  console.log(`[P37-D] palette row=${JSON.stringify(paletteRow)}`);
  expect(paletteRow, 'the palette lists renumberPages under its new label').not.toBeNull();
  expect(paletteRow).toContain('Rename pages');
  expect(paletteRow).not.toContain('Renumber');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);

  // No visible "Renumber pages" label remains anywhere.
  const stale = await win.evaluate(() => document.body.innerText.includes('Renumber pages'));
  console.log(`[P37-D] visible "Renumber pages" remaining=${stale}`);
  expect(stale, 'no visible "Renumber pages" label remains').toBe(false);
});

// ---------------------------------------------------------------------------
// E. Action Dock behaviour (items 2, 6, 7, 20, 21)
// ---------------------------------------------------------------------------
function expectedLadder(iw) {
  return { inspector: iw < 1200, panel: iw < 1000, labels: iw < 880, arrows: iw < 720 };
}

async function setTheme(name) {
  await win.locator('[data-theme-toggle]').click();
  await win.waitForSelector('[data-theme-option]', { state: 'visible', timeout: 8000 });
  await win.locator(`[data-theme-option="${name}"]`).click();
  await win.waitForFunction((t) => document.documentElement.dataset.theme === t, name, { timeout: 8000 });
  await win.waitForTimeout(350);
}

test('P37-E Action Dock: one row, ladder order both ways, arrows, full set + unpin, hint, themes, watermark', async () => {
  await openSample('report.pdf');

  // --- item 2: ONE ROW at every dispatch-named width, never stacking. ---
  for (const w of [640, 760, 900, 1100, 1440, 1920]) {
    await setWindowSize(w, 900);
    await gotoStage(1);
    const d = await dockInfo();
    console.log(`[P37-E] w=${w} inner=${d.innerWidth} dock=${JSON.stringify({ h: d.height, rows: d.verbRows, wrap: d.flexWrap, arrows: d.arrows, iconOnly: d.iconOnly, labels: d.labels.length, verbs: d.verbs.length })}`);
    expect(d, `dock present at ${w}`).not.toBeNull();
    expect(d.verbRows, `w=${w}: the dock is ONE row (never stacks)`).toBe(1);
    expect(d.height, `w=${w}: a single-row dock height`).toBeLessThan(60);
    expect(d.flexWrap, `w=${w}: flex-wrap is nowrap`).toBe('nowrap');
  }

  // --- item 6: the ladder's exact order, and its reverse when growing. ---
  const ladderWidths = [1120, 940, 820, 640];
  const ladderStates = [];
  for (const w of ladderWidths) {
    await setWindowSize(w, 900);
    const d = await dockInfo();
    const exp = expectedLadder(d.innerWidth);
    const appMain = await win.evaluate(() => ({
      inspector: document.querySelector('.app-main').getAttribute('data-inspector-collapsed'),
      rail: document.querySelector('.app-main').getAttribute('data-rail-collapsed'),
    }));
    const state = {
      w, inner: d.innerWidth,
      inspector: appMain.inspector, panel: appMain.rail,
      iconOnly: d.iconOnly, arrows: d.arrows, labels: d.labels.length,
      exp,
    };
    ladderStates.push(state);
    console.log(`[P37-E] ladder w=${w} inner=${d.innerWidth} inspector=${appMain.inspector} panel=${appMain.rail} iconOnly=${d.iconOnly} arrows=${d.arrows} labels=${d.labels.length} expected=${JSON.stringify(exp)}`);
    expect(appMain.inspector, `w=${w}: rung 1 (Inspector) matches the ladder`).toBe(exp.inspector ? 'true' : 'false');
    expect(appMain.rail, `w=${w}: rung 2 (panel) matches the ladder`).toBe(exp.panel ? 'true' : 'false');
    // DEF-337 — the rendered arrows are gated on a REAL overflow, not on the
    // rung. The ladder's rung 4 is the arrows LANE (`data-dock-arrows-lane`):
    // it engages at the <720 rung OR when the labelled row cannot fit its band
    // (DEF-334), so it is not a pure width function (at 1120/940 the lane is on
    // for the labelled overflow while the rung is off). Criterion 10's rung
    // order is asserted on the LANE at the floor (the rung engages it) and the
    // ceiling (it disengages), and the DEF-337 contract — arrows present iff
    // the scroller genuinely overflows — is asserted at every width.
    if (exp.arrows) {
      expect(d.arrowsLane, `w=${w}: the <720 rung engages the arrows lane`).toBe('true');
    }
    expect(d.arrows, `w=${w}: arrows render iff the row overflows (DEF-337)`).toBe(
      d.scrollWidth > d.clientWidth ? 'true' : 'false',
    );
    // Rung 3 ("hide the dock verbs' LABELS to fit") MUST engage below 880. Above
    // it the dock may still drop labels when the full 8-verb set cannot fit the
    // band (the documented "to fit" rule), so icon-only there is expected, not a
    // failure. The ORDER still holds: the arrows rung implies the labels rung.
    if (exp.labels) {
      expect(d.iconOnly, `w=${w}: labels hidden at the <880 rung`).toBe('true');
      expect(d.labels.length, `w=${w}: no labels at the <880 rung`).toBe(0);
    }
    if (exp.arrows) {
      expect(d.iconOnly, `w=${w}: the arrows rung implies the labels rung`).toBe('true');
    }
  }
  // A wide-enough window fits the full set, so rung 3 is OFF and labels show.
  await setWindowSize(1920, 900);
  const wide = await dockInfo();
  console.log(`[P37-E] wide 1920 iconOnly=${wide.iconOnly} labels=${wide.labels.length} arrows=${wide.arrows}`);
  expect(wide.iconOnly, 'at 1920 the full set fits, so rung 3 is off').toBe('false');
  expect(wide.labels.length).toBeGreaterThan(0);
  expect(wide.arrows).toBe('false');
  expect(wide.arrowsLane, 'at 1920 the arrows lane is off (the full set fits)').toBe('false');
  // Reverse: growing from the floor sheds rungs in reverse order.
  await setWindowSize(1120, 900);
  const grown = await dockInfo();
  const grownExp = expectedLadder(grown.innerWidth);
  const grownApp = await win.evaluate(() => document.querySelector('.app-main').getAttribute('data-inspector-collapsed'));
  console.log(`[P37-E] regrow 1120 inner=${grown.innerWidth} inspector=${grownApp} arrows=${grown.arrows} lane=${grown.arrowsLane} expected=${JSON.stringify(grownExp)}`);
  expect(grownApp).toBe(grownExp.inspector ? 'true' : 'false');
  // DEF-337 — at 1120 the labelled row overflows its band, so the lane is on
  // and the arrows render; the contract is the overflow, not the width rung.
  expect(grown.arrows, 'at 1120 the arrows render iff the row overflows (DEF-337)').toBe(
    grown.scrollWidth > grown.clientWidth ? 'true' : 'false',
  );
  expect(grownExp.panel, 'growing back past 1000 restores the panel').toBe(false);

  // --- item 6: the arrows scroll the single verb row. ---
  // DEF-337 — the arrows render only on a REAL overflow, so the row must
  // genuinely overflow for this proof. At 719 (the arrows rung, where the dock
  // is not lifted above the pills) the 8 stage verbs plus the 4-pin cap exceed
  // the scroller; at 640 the lifted dock is wide enough to fit them.
  await setWindowSize(719, 900);
  const pins0 = await loadSettings();
  await win.evaluate((v) => window.tflex.saveSettings(v), {
    ...pins0,
    dockPins: ['watermark', 'optimize', 'audit', 'recognizeText'],
    dockUnpinned: [],
  });
  await win.waitForTimeout(1000);
  await gotoStage(1);
  const scrollInfo = await win.evaluate(() => {
    const el = document.querySelector('[data-dock-scroll]');
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollLeft: el.scrollLeft };
  });
  console.log(`[P37-E] arrows rung scroller=${JSON.stringify(scrollInfo)}`);
  // DEF-337 — the arrows render because the row genuinely overflows.
  expect(scrollInfo.scrollWidth, 'the pinned row genuinely overflows at 719').toBeGreaterThan(scrollInfo.clientWidth + 1);
  expect(await win.locator('[data-dock-arrow="left"]').count()).toBe(1);
  expect(await win.locator('[data-dock-arrow="right"]').count()).toBe(1);
  await win.locator('[data-dock-arrow="right"]').click();
  await win.waitForTimeout(700);
  const afterRight = await win.evaluate(() => document.querySelector('[data-dock-scroll]').scrollLeft);
  console.log(`[P37-E] arrow right scrollLeft ${scrollInfo.scrollLeft} -> ${afterRight}`);
  expect(afterRight, 'the right arrow scrolls the verbs').toBeGreaterThan(scrollInfo.scrollLeft);
  await win.locator('[data-dock-arrow="left"]').click();
  await win.waitForTimeout(700);
  const afterLeft = await win.evaluate(() => document.querySelector('[data-dock-scroll]').scrollLeft);
  console.log(`[P37-E] arrow left scrollLeft ${afterRight} -> ${afterLeft}`);
  expect(afterLeft, 'the left arrow scrolls back').toBeLessThan(afterRight);
  await win.mouse.move(320, 420);
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SHOTS, 'phase37-dock-arrows.png') });
  console.log(`[P37-E] screenshot ${path.join(SHOTS, 'phase37-dock-arrows.png')}`);
  // Restore the pre-block settings: the 4 pins keep the arrows lane on at wide
  // widths (the labelled row overflows), which would hide the Ctrl+K hint.
  await win.evaluate((v) => window.tflex.saveSettings(v), pins0);
  await win.waitForTimeout(700);

  // --- item 21: the full stage set by default + the Ctrl+K hint + the default shot. ---
  await setWindowSize(1440, 900);
  for (const [n, stage] of [[1, 'pages'], [2, 'edit'], [3, 'review'], [4, 'deliver']]) {
    await gotoStage(n);
    const ids = await dockAllVerbIds();
    console.log(`[P37-E] ${stage} dock set=${JSON.stringify(ids)}`);
    expect(new Set(ids), `${stage} carries its full relevant set by default`).toEqual(new Set(DOCK_STAGE_IDS[stage]));
  }
  // The Ctrl+K hint is gated on the arrows LANE (DEF-337): it is hidden while
  // the lane is on, which at 1440 is the DEF-334 labelled-row overflow. Check
  // it at 1920, where the full labelled set fits and the lane is off.
  await setWindowSize(1920, 900);
  await gotoStage(1);
  const hintState = await win.evaluate(() => ({
    lane: document.querySelector('[data-action-dock]')?.getAttribute('data-dock-arrows-lane') ?? null,
    hint: document.querySelector('[data-dock-hint]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
  }));
  console.log(`[P37-E] Ctrl+K hint state=${JSON.stringify(hintState)}`);
  expect(hintState.lane, 'at 1920 the arrows lane is off').toBe('false');
  expect(hintState.hint, 'the Ctrl+K hint appears above the dock').toBe('Search all tools: Ctrl+K');
  // Park the pointer off the dock so no hover tooltip obscures the hint.
  await win.mouse.move(700, 420);
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(SHOTS, 'phase37-dock-default.png') });
  console.log(`[P37-E] screenshot ${path.join(SHOTS, 'phase37-dock-default.png')}`);
  await setWindowSize(640, 900);
  expect(await win.locator('[data-dock-hint]').count(), 'the hint hides at the arrows rung').toBe(0);

  // --- item 21: UNPIN a default verb; it disappears and persists. ---
  await gotoStage(1);
  await win.locator('[data-dock-verb="split"]').first().click({ button: 'right' });
  await win.waitForSelector('[data-dock-menu]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-dock-menu-item="unpin"]').click();
  await win.waitForTimeout(700);
  const afterUnpin = await win.$$eval('[data-action-dock] [data-dock-verb]', (els) =>
    els.map((e) => e.getAttribute('data-dock-verb')));
  console.log(`[P37-E] after unpin verbs=${JSON.stringify(afterUnpin)}`);
  expect(afterUnpin, 'the un-pinned default verb is gone from the dock').not.toContain('split');
  let stored = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 8000) {
    const s = await loadSettings();
    if (s && Array.isArray(s.dockUnpinned) && s.dockUnpinned.includes('split')) { stored = s.dockUnpinned; break; }
    await win.waitForTimeout(250);
  }
  console.log(`[P37-E] persisted dockUnpinned=${JSON.stringify(stored)}`);
  expect(stored, 'the un-pin is persisted in dockUnpinned').toContain('split');

  // --- item 7: consistent across the three themes. ---
  await setWindowSize(1440, 900);
  await gotoStage(1);
  const themeStyles = {};
  for (const name of ['light', 'dark', 'frosted']) {
    await setTheme(name);
    themeStyles[name] = await win.evaluate(() => {
      const d = document.querySelector('[data-action-dock]');
      const cs = getComputedStyle(d);
      return { bg: cs.backgroundColor, borderWidth: cs.borderTopWidth, borderColor: cs.borderTopColor, padding: cs.padding, gap: cs.gap, radius: cs.borderRadius, wrap: cs.flexWrap };
    });
    console.log(`[P37-E] theme ${name} dock=${JSON.stringify(themeStyles[name])}`);
    expect(themeStyles[name].bg, `${name}: the dock has a themed surface`).not.toBe('rgba(0, 0, 0, 0)');
    expect(parseFloat(themeStyles[name].borderWidth), `${name}: the dock keeps its hairline`).toBeGreaterThan(0);
  }
  expect(themeStyles.light.padding, 'identical padding across themes').toBe(themeStyles.dark.padding);
  expect(themeStyles.light.padding).toBe(themeStyles.frosted.padding);
  expect(themeStyles.light.gap, 'identical gap across themes').toBe(themeStyles.dark.gap);
  expect(themeStyles.light.gap).toBe(themeStyles.frosted.gap);
  expect(themeStyles.light.radius, 'identical radius across themes').toBe(themeStyles.frosted.radius);
  await setTheme('light');

  // --- item 20: watermark is ENABLED with a document open. ---
  await gotoStage(3);
  const wmInline = await win.locator('[data-dock-verb="watermark"]').count();
  let wmEnabled;
  if (wmInline > 0) {
    wmEnabled = await win.locator('[data-dock-verb="watermark"]').first().isEnabled();
  } else {
    await win.locator('[data-dock-overflow]').first().click();
    await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 8000 });
    wmEnabled = await win.locator('[data-dock-overflow-item="watermark"]').first().isEnabled();
    const wmTitle = await win.locator('[data-dock-overflow-item="watermark"]').first().getAttribute('title');
    console.log(`[P37-E] watermark in overflow enabled=${wmEnabled} title=${JSON.stringify(wmTitle)}`);
    await win.keyboard.press('Escape');
  }
  console.log(`[P37-E] watermark enabled with a document open=${wmEnabled}`);
  expect(wmEnabled, 'item 20: watermark is enabled with a document open').toBe(true);
});

// ---------------------------------------------------------------------------
// F. Retirements (item 17): the standalone print window.
// ---------------------------------------------------------------------------
async function closePrintWindow() {
  await app.evaluate(({ BrowserWindow }) => {
    const pw = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('tfWindow=print'));
    if (pw) pw.close();
  });
  await win.waitForTimeout(900);
}

test('P37-F print: no in-app modal; title-bar / File > Print / Ctrl+P open the standalone window', async () => {
  await openSample('report.pdf');

  // --- the in-app modal is GONE. ---
  const modal = await win.evaluate(() => ({
    dialog: document.querySelectorAll('[data-print-dialog]').length,
    shell: document.querySelectorAll('[data-print-dialog-shell]').length,
    klass: document.querySelectorAll('.print-dialog').length,
    detach: document.querySelectorAll('[data-print-detach]').length,
  }));
  console.log(`[P37-F] in-app print modal selectors=${JSON.stringify(modal)}`);
  for (const [k, v] of Object.entries(modal)) expect(v, `no in-app ${k}`).toBe(0);

  // --- entry point 1: the title-bar Print icon opens the standalone window. ---
  const p1 = app.waitForEvent('window');
  await win.click('[data-print]');
  const printPage = await p1;
  await printPage.waitForSelector('[data-print-window]', { timeout: 30000 });
  await printPage.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 20000 });
  const info = await app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows();
    const pw = all.find((w) => w.webContents.getURL().includes('tfWindow=print'));
    return { count: all.length, title: pw?.getTitle(), url: pw?.webContents.getURL().slice(0, 70) };
  });
  const chrome = await printPage.evaluate(() => ({
    printWindow: document.querySelectorAll('[data-print-window]').length,
    tabs: document.querySelectorAll('.tab[data-tab-id]').length,
    dock: document.querySelectorAll('[data-action-dock]').length,
    titlebar: document.querySelectorAll('.titlebar').length,
    printer: document.querySelectorAll('[data-print-printer]').length,
    preview: document.querySelectorAll('[data-print-preview]').length,
  }));
  console.log(`[P37-F] title-bar Print window=${JSON.stringify(info)} chrome=${JSON.stringify(chrome)}`);
  expect(info.title, 'the standalone window title').toBe('Print - TFlex');
  expect(info.count, 'exactly two windows (app + print)').toBe(2);
  expect(chrome.printWindow).toBe(1);
  expect(chrome.tabs).toBe(0);
  expect(chrome.dock).toBe(0);
  expect(chrome.titlebar).toBe(0);
  expect(chrome.printer).toBe(1);
  expect(chrome.preview).toBe(1);
  await closePrintWindow();

  // --- entry point 2: File > Print (the native menu route). ---
  const p2 = app.waitForEvent('window');
  await app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('menu.print');
    if (item) item.click();
  });
  const printPage2 = await p2;
  await printPage2.waitForSelector('[data-print-window]', { timeout: 30000 });
  console.log('[P37-F] File > Print (native menu) opened the standalone window');
  await closePrintWindow();

  // --- entry point 3: Ctrl+P (the native input path drives the accelerator). ---
  const p3 = app.waitForEvent('window').catch(() => null);
  await win.bringToFront();
  await app.evaluate(({ BrowserWindow }) => {
    const main = BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().includes('tfWindow=print'));
    main.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'P', modifiers: ['control'] });
    main.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'P', modifiers: ['control'] });
  });
  const printPage3 = await p3;
  if (printPage3 !== null) {
    await printPage3.waitForSelector('[data-print-window]', { timeout: 30000 });
    console.log('[P37-F] Ctrl+P (native sendInputEvent) opened the standalone window');
  } else {
    console.log('[P37-F] Ctrl+P via sendInputEvent did not produce a new window event');
  }
  const ctrlp = await app.evaluate(({ BrowserWindow }) => ({
    printWindows: BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('tfWindow=print')).length,
  }));
  console.log(`[P37-F] Ctrl+P print windows=${JSON.stringify(ctrlp)}`);
  // The native accelerator shares the ONE print:request channel the menu route
  // proved; assert the standalone window is what appears (never the in-app modal).
  expect(ctrlp.printWindows, 'Ctrl+P opens/focuses the standalone print window').toBe(1);
  const stillNoModal = await win.evaluate(() => document.querySelectorAll('[data-print-dialog], .print-dialog').length);
  expect(stillNoModal, 'no in-app modal appears on any print route').toBe(0);
});
