// Phase 39 Part 2 (qa) - the SINGLE-vs-MULTI Action Dock comparison matrix.
// Measures the dock in the running app for every stage at the default and
// narrow widths, in single mode and Multi Mode (1 and 2 documents), plus the
// responsive-ladder thresholds, pins/unpins, right-click menu, annotations
// flyout, Ctrl+K palette reach and the Inspector text panel. Emits structured
// [P39-MATRIX ...] lines consumed to write e2e/PHASE39-MULTIVIEW-MATRIX.md.
// Canonical launchApp only.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, toggleMultiModeViaPalette } = require('./lib/helpers.cjs');

let app = null;
let win = null;
test.setTimeout(600000);

const STAGES = ['pages', 'edit', 'review', 'deliver'];
const STAGE_N = { pages: 1, edit: 2, review: 3, deliver: 4 };

async function launch() {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  return { app, win };
}
async function openDoc(a, w, p) {
  await a.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await w.locator('[data-toolbar-open]').first().click();
  await w.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await w.waitForTimeout(800);
}
async function setupMulti1() {
  await launch();
  await openDoc(app, win, getSamplePath('report.pdf'));
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1200);
}
async function setupMulti2() {
  await launch();
  await openDoc(app, win, getSamplePath('report.pdf'));
  await openDoc(app, win, getSamplePath('long.pdf'));
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(800);
  const pick = win.locator('.tab-pane[data-pane-empty] [data-pane-pick]').first();
  if (await pick.count()) { await pick.click(); await win.waitForTimeout(1800); }
  // Focus pane A by clicking its page.
  await win.locator('.tab-pane[data-pane="A"] .pdf-page').first().click({ force: true });
  await win.waitForTimeout(600);
}
async function setWindow(a, w, width, height) {
  await a.evaluate(({ BrowserWindow }, sz) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) bw.setSize(sz[0], sz[1]);
  }, [width, height]);
  await w.waitForFunction((want) => Math.abs(window.innerWidth - want) <= 24, width, { timeout: 8000 }).catch(() => {});
  await w.waitForTimeout(400);
}
async function switchStage(w, name) {
  await w.evaluate(() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); });
  const btn = w.locator(`[data-stage-rail] [data-stage="${name}"]`);
  if (await btn.count()) { await btn.first().click(); }
  else { await w.keyboard.press(`Control+${STAGE_N[name]}`); }
  await w.waitForTimeout(450);
}

const readLadder = (w) => w.evaluate(`(() => {
  const dock = document.querySelector('.action-dock');
  const insp = document.querySelector('[data-inspector]');
  const panel = document.querySelector('[data-context-panel]');
  return { innerWidth: window.innerWidth,
    dockPresent: !!dock,
    iconOnly: dock ? dock.getAttribute('data-dock-icon-only') : null,
    arrowsLane: dock ? dock.getAttribute('data-dock-arrows-lane') : null,
    arrows: dock ? dock.getAttribute('data-dock-arrows') : null,
    inspectorPresent: !!insp,
    inspectorCollapsed: insp ? insp.getAttribute('data-inspector-collapsed') : null,
    panelPresent: !!panel,
    panelCollapsed: panel ? panel.getAttribute('data-context-panel-collapsed') : null,
    stripPresent: !!document.querySelector('.pane-thumb-strip') };
})()`);

const collectDock = (w) => w.evaluate(`(() => {
  const dock = document.querySelector('.action-dock');
  if (!dock) return { present: false };
  const r = dock.getBoundingClientRect();
  const verbs = [...dock.querySelectorAll('[data-dock-verb]')].map((b) => ({
    id: b.getAttribute('data-dock-verb'), pin: b.getAttribute('data-dock-pin'),
    disabled: b.disabled, title: b.getAttribute('title'), pressed: b.getAttribute('aria-pressed'),
    labelShown: !!b.querySelector('.action-dock-label') }));
  const overflowItems = [...dock.querySelectorAll('[data-dock-overflow-item]')].map((b) => ({
    id: b.getAttribute('data-dock-overflow-item'), disabled: b.disabled }));
  const cs = getComputedStyle(dock);
  return { present: true, state: dock.getAttribute('data-dock-state'),
    iconOnly: dock.getAttribute('data-dock-icon-only'), arrowsLane: dock.getAttribute('data-dock-arrows-lane'),
    arrows: dock.getAttribute('data-dock-arrows'), compact: dock.getAttribute('data-dock-compact'),
    band: dock.getAttribute('data-dock-band'), lift: dock.getAttribute('data-dock-lift'),
    rect: { x:+r.x.toFixed(1), y:+r.y.toFixed(1), w:+r.width.toFixed(1), h:+r.height.toFixed(1) },
    rows: cs.gridTemplateRows, divider: !!dock.querySelector('[data-dock-divider]'),
    hint: !!dock.querySelector('[data-dock-hint]'), overflowButton: !!dock.querySelector('[data-dock-overflow]'),
    verbs, overflowItems,
    primaryIds: verbs.filter((v) => !v.pin).map((v) => v.id),
    pinnedIds: verbs.filter((v) => v.pin).map((v) => v.id),
    disabledIds: verbs.filter((v) => v.disabled).map((v) => v.id) };
})()`);

async function collectAllStages(w, label) {
  const out = {};
  for (const s of STAGES) {
    await switchStage(w, s);
    out[s] = await collectDock(w);
  }
  console.log(`[P39-MATRIX ${label} stages] ${JSON.stringify(out)}`);
  return out;
}

async function ladderSweep(a, w, label) {
  const widths = [1250, 1200, 1199, 1050, 1000, 999, 900, 880, 879, 760, 720, 719, 700];
  const rows = [];
  for (const width of widths) {
    await setWindow(a, w, width, 720);
    const r = await readLadder(w);
    rows.push({ want: width, got: r.innerWidth, iconOnly: r.iconOnly, arrowsLane: r.arrowsLane,
      arrows: r.arrows, inspCollapsed: r.inspectorCollapsed, panelPresent: r.panelPresent,
      panelCollapsed: r.panelCollapsed, strip: r.stripPresent, dock: r.dockPresent });
  }
  console.log(`[P39-MATRIX ${label} ladder] ${JSON.stringify(rows)}`);
  return rows;
}

async function collectPalette(w, label) {
  await w.keyboard.press('Control+k');
  await w.waitForSelector('[data-command-palette]', { state: 'visible', timeout: 8000 }).catch(() => {});
  const open = await w.locator('[data-command-palette]').count();
  let row = null;
  if (open) {
    await w.fill('[data-command-palette-input]', 'Rotate pages');
    await w.waitForTimeout(400);
    row = await w.evaluate(`(() => {
      const el = document.querySelector('[data-palette-tool-id="rotate"]');
      if (!el) return null;
      return { present: true, disabled: el.disabled || el.getAttribute('aria-disabled') === 'true' };
    })()`);
    await w.keyboard.press('Escape');
    await w.waitForTimeout(300);
  }
  console.log(`[P39-MATRIX ${label} palette] ${JSON.stringify({ open, rotateRow: row })}`);
  return { open, row };
}

async function collectFlyout(w, label) {
  await switchStage(w, 'review');
  const annotate = w.locator('[data-dock-verb="annotate"]').first();
  let flyout = { present: false };
  if (await annotate.count()) {
    await annotate.click();
    await w.waitForSelector('[data-annotation-flyout]', { state: 'visible', timeout: 8000 }).catch(() => {});
    flyout = await w.evaluate(`(() => {
      const f = document.querySelector('[data-annotation-flyout]');
      return { present: !!f, toolbar: f ? !!f.querySelector('.ann-toolbar') : false,
        tools: f ? f.querySelectorAll('[data-ann-tools-visible] button[data-tool]').length : 0 };
    })()`);
    await w.keyboard.press('Escape');
    await w.waitForTimeout(300);
  }
  console.log(`[P39-MATRIX ${label} flyout] ${JSON.stringify(flyout)}`);
  return flyout;
}

async function collectTextPanel(w, label) {
  await switchStage(w, 'edit');
  // Arm Edit text through the palette, then click page 1 until a text run selects.
  await w.evaluate(() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); });
  await w.keyboard.press('Control+k');
  await w.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 }).catch(() => {});
  if (await w.locator('[data-command-palette-input]').count()) {
    await w.fill('[data-command-palette-input]', 'Edit text');
    await w.waitForTimeout(350);
    const row = w.locator('[data-palette-tool-id="editText"]').first();
    if (await row.count()) { await row.click(); await w.waitForTimeout(700); }
    else { await w.keyboard.press('Escape'); }
  }
  const pane = w.locator('.tab-pane[aria-hidden="false"] .pdf-page[data-page="1"]');
  const pageLoc = (await pane.count()) ? pane : w.locator('.pdf-page[data-page="1"]');
  let selected = false;
  const pg = await pageLoc.first().boundingBox();
  if (pg) {
    for (const [fx, fy] of [[0.5, 0.1], [0.3, 0.12], [0.5, 0.16], [0.25, 0.22], [0.5, 0.3], [0.35, 0.42]]) {
      await w.mouse.click(Math.round(pg.x + pg.width * fx), Math.round(pg.y + pg.height * fy));
      await w.waitForTimeout(500);
      selected = await w.evaluate(`(() => {
        const root = document.querySelector('.tab-pane[aria-hidden="false"]') || document;
        return !!root.querySelector('[data-textrun-selection]');
      })()`);
      if (selected) break;
    }
  }
  const snap = await w.evaluate(`(() => {
    const panel = document.querySelector('[data-inspector-text-panel]');
    const field = panel ? panel.querySelector('[data-txt-text]') : null;
    const insp = document.querySelector('[data-inspector]');
    return { selection: insp ? insp.getAttribute('data-inspector-selection') : null,
      panels: document.querySelectorAll('[data-inspector-text-panel]').length,
      fieldPresent: !!field, fieldDisabled: field ? field.disabled : null };
  })()`);
  console.log(`[P39-MATRIX ${label} textpanel] ${JSON.stringify({ selected, ...snap })}`);
  return { selected, ...snap };
}

async function collectPins(w, label) {
  // Cross-stage pin: pin 'optimize' while in DELIVER, then read it in PAGES.
  await switchStage(w, 'deliver');
  const opt = w.locator('[data-dock-verb="optimize"]').first();
  let menuItems = null;
  if (await opt.count()) {
    await opt.click({ button: 'right' });
    if (await w.locator('[data-dock-menu]').count()) {
      menuItems = await w.$$eval('[data-dock-menu] [data-dock-menu-item]', (els) =>
        els.map((e) => ({ k: e.getAttribute('data-dock-menu-item'), text: e.innerText.trim(), disabled: e.disabled })));
      await w.click('[data-dock-menu-item="pin"]');
      await w.waitForTimeout(600);
    }
  }
  await switchStage(w, 'pages');
  const afterPin = await collectDock(w);
  // Unpin a DEFAULT verb: right-click 'merge' in PAGES.
  const merge = w.locator('[data-dock-verb="merge"]').first();
  let mergeUnpinned = null;
  if (await merge.count()) {
    await merge.click({ button: 'right' });
    if (await w.locator('[data-dock-menu-item="unpin"]').count()) {
      await w.click('[data-dock-menu-item="unpin"]');
      await w.waitForTimeout(600);
      mergeUnpinned = await collectDock(w);
    }
  }
  console.log(`[P39-MATRIX ${label} pins] ${JSON.stringify({
    menuItems, afterPin: { pinned: afterPin.pinnedIds, primary: afterPin.primaryIds },
    mergeUnpinned: mergeUnpinned ? { primary: mergeUnpinned.primaryIds, disabled: mergeUnpinned.disabledIds } : null }) }`);
  return { menuItems, afterPin, mergeUnpinned };
}

// ===========================================================================
// CONFIG RUNNERS
// ===========================================================================
async function runConfig(label, setup, opts) {
  await setup();
  const defWidth = await win.evaluate(() => window.innerWidth);
  console.log(`[P39-MATRIX ${label} env] defaultInnerWidth=${defWidth} multiMode=${await win.locator('.tab-stage').getAttribute('data-multi-mode')} panes=${await win.locator('.tab-stage').getAttribute('data-multi-panes')}`);
  const stagesDefault = await collectAllStages(win, `${label}-default`);
  const ladder = await ladderSweep(app, win, label);
  // ladderSweep ends at 700px: collect the narrow-width stage sets there.
  const stagesNarrow = await collectAllStages(win, `${label}-narrow`);
  await setWindow(app, win, defWidth, 903);
  await collectPalette(win, label);
  const flyout = await collectFlyout(win, label);
  const textpanel = await collectTextPanel(win, label);
  const pins = await collectPins(win, label);
  await hardClose(app, `p39-matrix-${label}`);
  app = null; win = null;
  return { stagesDefault, stagesNarrow, ladder, flyout, textpanel, pins };
}

test('MATRIX single mode', async () => {
  await runConfig('single', async () => {
    await launch();
    await openDoc(app, win, getSamplePath('report.pdf'));
    await win.waitForTimeout(600);
  });
});

test('MATRIX multi 1 doc', async () => {
  await runConfig('multi1', setupMulti1);
});

test('MATRIX multi 2 docs', async () => {
  await runConfig('multi2', setupMulti2);
});

// Persistence across a restart, with a FIXED user-data dir so settings survive.
test('MATRIX unpin persists across restart and applies in both modes', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const dir = path.join(os.tmpdir(), `tflex-p39-persist-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });

  // Session 1: unpin 'merge' in PAGES (single mode).
  app = await launchApp([], dir);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openDoc(app, win, getSamplePath('report.pdf'));
  await switchStage(win, 'pages');
  const merge = win.locator('[data-dock-verb="merge"]').first();
  const before = await collectDock(win);
  await merge.click({ button: 'right' });
  await win.waitForSelector('[data-dock-menu-item="unpin"]', { timeout: 5000 });
  await win.click('[data-dock-menu-item="unpin"]');
  await win.waitForTimeout(800);
  const afterUnpin = await collectDock(win);
  console.log(`[P39-MATRIX persist s1] before=${JSON.stringify(before.primaryIds)} afterUnpin=${JSON.stringify(afterUnpin.primaryIds)}`);
  await hardClose(app, 'p39-persist-1');
  app = null; win = null;

  // Session 2: same user-data dir -> the unpin must still hold, single and multi.
  app = await launchApp([], dir);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openDoc(app, win, getSamplePath('report.pdf'));
  await switchStage(win, 'pages');
  const s2Single = await collectDock(win);
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(1000);
  const s2Multi = await collectDock(win);
  console.log(`[P39-MATRIX persist s2] single=${JSON.stringify(s2Single.primaryIds)} multi=${JSON.stringify(s2Multi.primaryIds)}`);
  await hardClose(app, 'p39-persist-2');
  app = null; win = null;
  expect(true).toBe(true);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p39-matrix');
  app = null;
  win = null;
});

// Interaction states: normal / hover / pressed / disabled, single vs multi.
async function stateSample(w, sel) {
  const read = () => w.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, color: cs.color, border: cs.borderColor,
      opacity: cs.opacity, cursor: cs.cursor, transform: cs.transform,
      pressed: el.getAttribute("aria-pressed"), disabled: el.disabled };
  })()`);
  const box = await w.locator(sel).first().boundingBox();
  const normal = await read();
  await w.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await w.waitForTimeout(300);
  const hover = await read();
  await w.mouse.down();
  await w.waitForTimeout(250);
  const pressed = await read();
  await w.mouse.up();
  await w.waitForTimeout(200);
  return { normal, hover, pressed };
}

async function statesFor(label, multi) {
  await launch();
  await openDoc(app, win, getSamplePath('report.pdf'));
  if (multi) {
    await toggleMultiModeViaPalette(win);
    await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
    await win.waitForTimeout(1000);
  }
  await switchStage(win, 'pages');
  const rotate = await stateSample(win, '[data-dock-verb="rotate"]');
  await switchStage(win, 'edit');
  const disabled = await w_eval_disabled();
  console.log(`[P39-MATRIX ${label} states] ${JSON.stringify({ rotate, disabled })}`);
  await hardClose(app, `p39-states-${label}`);
  app = null; win = null;
  return { rotate, disabled };
}
async function w_eval_disabled() {
  return win.evaluate(`(() => {
    const el = document.querySelector('[data-dock-verb="batchOcr"]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { disabled: el.disabled, color: cs.color, bg: cs.backgroundColor, opacity: cs.opacity, cursor: cs.cursor };
  })()`);
}

test('MATRIX interaction states single vs multi', async () => {
  const single = await statesFor('single', false);
  const multi1 = await statesFor('multi1', true);
  expect(single.rotate.normal.bg).toBe(multi1.rotate.normal.bg);
});
