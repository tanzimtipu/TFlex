// Release 1.29.0 Gate 4 - the operator's Phase 37 feedback round against the
// INSTALLED build.
//
// Launches ONLY through the canonical launchInstalled() helper
// (e2e/installed/* specs use it; it targets %LOCALAPPDATA%\Programs\tflex\TFlex.exe).
// Captures exactly TWO screenshots - screenshots/release-1290-dock-inspector.png
// and screenshots/release-1290-print-window.png - both NEW files.
//
// Headline checks (the dispatch's Gate 4):
//   (a) the dock is ONE row at the default window, the Ctrl+K hint is visible,
//       and the eight PAGES labels are present
//   (b) the Inspector is FLUSH with the canvas top (gap 0)
//   (c) print opens the STANDALONE window from the title bar and from the
//       native File > Print menu; no [data-print-dialog] anywhere
//   (d) the thumbnail panel is 184px with no title
//   (e) entering the EDIT stage enables edit mode with no `editMode` dock verb
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchInstalled, hardClose, gotoStage, openSamplePath } = require('../lib/helpers.cjs');
const { getSamplePath } = require('../lib/launch.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = path.join(ROOT, 'screenshots');
const log = (label, obj) => console.log(`[r1290|${label}] ${JSON.stringify(obj)}`);

// The eight PAGES-stage verbs and their registry labels.
const PAGES_VERBS = {
  rotate: 'Rotate pages',
  extract: 'Extract pages',
  insertPages: 'Insert pages',
  replacePages: 'Replace pages',
  split: 'Split pages',
  delete: 'Delete pages',
  merge: 'Merge PDFs',
  cropPages: 'Crop pages',
};

let app = null;
let win = null;

test.describe.configure({ mode: 'serial' });
test.setTimeout(240000);

test.beforeEach(async () => {
  ({ electronApp: app, window: win } = await launchInstalled());
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'r1290-feedback');
  app = null;
  win = null;
});

async function openReport() {
  await openSamplePath(win, app, getSamplePath('report.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(900);
}

// Close every standalone print window from main.
async function closePrintWindow() {
  await app
    .evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .filter((w) => w.webContents.getURL().includes('tfWindow=print'))
        .forEach((w) => {
          if (!w.isDestroyed()) w.close();
        });
    })
    .catch(() => {});
  await win.waitForTimeout(900);
}

// The dock's full rendered set: the inline verbs plus (when the `...` chip is
// present) its overflow menu rows.
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

// --- (a) dock: ONE row, Ctrl+K hint, eight PAGES labels --------------------
test('(a) dock: ONE row at the default window, Ctrl+K hint visible, eight PAGES labels', async () => {
  await openReport();
  await gotoStage(win, 1);
  await win.waitForSelector('[data-action-dock]', { state: 'visible', timeout: 10000 });
  await win.waitForTimeout(500);

  const d = await win.evaluate(() => {
    const dock = document.querySelector('[data-action-dock]');
    const dr = dock.getBoundingClientRect();
    const verbs = [...dock.querySelectorAll('[data-dock-verb]')].map((el) => {
      const r = el.getBoundingClientRect();
      const label = el.querySelector('.action-dock-label');
      return {
        id: el.getAttribute('data-dock-verb'),
        top: Math.round(r.top),
        label: label ? label.textContent.trim() : null,
      };
    });
    return {
      innerWidth: window.innerWidth,
      height: Math.round(dr.height),
      flexWrap: getComputedStyle(dock).flexWrap,
      iconOnly: dock.getAttribute('data-dock-icon-only'),
      verbRows: new Set(verbs.map((v) => v.top)).size,
      verbs,
      hint: document.querySelector('[data-dock-hint]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    };
  });
  log('dock', d);

  // The default window is the app's own default geometry (1440x900): the
  // labels rung (<880) and the arrows rung (<720) are both off.
  expect(d.innerWidth, 'the default window is wide enough for the labels rung').toBeGreaterThanOrEqual(880);
  expect(d.verbRows, 'the dock is ONE row at the default window').toBe(1);
  expect(d.flexWrap, 'the dock never wraps').toBe('nowrap');
  expect(d.height, 'a single-row dock height').toBeLessThan(60);
  expect(d.iconOnly, 'the labels rung is off at the default window').toBe('false');
  expect(d.hint, 'the Ctrl+K hint is visible at the default window').toBe('Search all tools: Ctrl+K');

  // The eight PAGES verbs are all reachable (inline or overflow) and each
  // inline verb shows its text label.
  const all = await dockAllVerbIds();
  log('dock-all-verbs', all);
  for (const id of Object.keys(PAGES_VERBS)) {
    expect(all, `PAGES verb '${id}' is reachable in the dock`).toContain(id);
  }
  const byId = Object.fromEntries(d.verbs.map((v) => [v.id, v]));
  for (const [id, label] of Object.entries(PAGES_VERBS)) {
    if (byId[id]) {
      expect(byId[id].label, `PAGES verb '${id}' shows its label`).toBe(label);
    }
  }
  const labelled = d.verbs.filter((v) => v.label !== null).length;
  log('dock-labels', { labelled, inline: d.verbs.length });
  expect(labelled, 'the dock renders text labels (not icon-only)').toBeGreaterThanOrEqual(8);

  fs.mkdirSync(SHOTS, { recursive: true });
  await win.screenshot({ path: path.join(SHOTS, 'release-1290-dock-inspector.png') });
  log('screenshot', { path: path.join(SHOTS, 'release-1290-dock-inspector.png') });
});

// --- (b) Inspector flush with the canvas top -------------------------------
test('(b) the Inspector is FLUSH with the canvas top (gap 0)', async () => {
  await openReport();
  await gotoStage(win, 1);
  await win.waitForTimeout(500);

  const g = await win.evaluate(() => {
    const insp = document.querySelector('[data-inspector]');
    const ws = document.querySelector('.workspace-main');
    const sc = document.querySelector('.document-scroller');
    const ir = insp.getBoundingClientRect();
    const wr = ws.getBoundingClientRect();
    const sr = sc.getBoundingClientRect();
    const cs = getComputedStyle(insp);
    return {
      inspectorTop: Math.round(ir.top),
      workspaceTop: Math.round(wr.top),
      scrollerTop: Math.round(sr.top),
      gapWorkspace: +(ir.top - wr.top).toFixed(2),
      gapScroller: +(ir.top - sr.top).toFixed(2),
      radius: cs.borderRadius,
      shadow: cs.boxShadow,
    };
  });
  log('inspector-flush', g);
  expect(Math.abs(g.gapWorkspace), 'the Inspector is flush with the canvas top (gap 0)').toBeLessThanOrEqual(1);
  expect(Math.abs(g.gapScroller), 'the Inspector is flush with the scroller top (gap 0)').toBeLessThanOrEqual(1);
  expect(g.radius, 'no rounded left corner').toBe('0px');
  expect(g.shadow, 'no shadow seam').toBe('none');
});

// --- (c) print: the standalone window, no in-app modal ---------------------
test('(c) print opens the STANDALONE window from the title bar and File > Print; no in-app modal', async () => {
  await openReport();

  // The in-app modal is GONE.
  const modal = await win.evaluate(() => ({
    dialog: document.querySelectorAll('[data-print-dialog]').length,
    shell: document.querySelectorAll('[data-print-dialog-shell]').length,
    klass: document.querySelectorAll('.print-dialog').length,
  }));
  log('print-modal', modal);
  for (const [k, v] of Object.entries(modal)) expect(v, `no in-app ${k}`).toBe(0);

  // Entry point 1: the title-bar Print icon opens the standalone window.
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
    printer: document.querySelectorAll('[data-print-printer]').length,
  }));
  log('print-titlebar', { info, chrome });
  expect(info.title, 'the standalone window title').toBe('Print - TFlex');
  expect(info.count, 'exactly two windows (app + print)').toBe(2);
  expect(chrome.printWindow).toBe(1);
  expect(chrome.tabs, 'the print window is not the app shell').toBe(0);
  expect(chrome.dock, 'the print window is not the app shell').toBe(0);
  expect(chrome.printer).toBe(1);
  fs.mkdirSync(SHOTS, { recursive: true });
  await printPage.screenshot({ path: path.join(SHOTS, 'release-1290-print-window.png') });
  log('screenshot', { path: path.join(SHOTS, 'release-1290-print-window.png') });
  await closePrintWindow();

  // Entry point 2: File > Print (the native menu route).
  const p2 = app.waitForEvent('window');
  await app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('menu.print');
    if (item) item.click();
  });
  const printPage2 = await p2;
  await printPage2.waitForSelector('[data-print-window]', { timeout: 30000 });
  const info2 = await app.evaluate(({ BrowserWindow }) => ({
    printWindows: BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('tfWindow=print')).length,
  }));
  log('print-filemenu', info2);
  expect(info2.printWindows, 'File > Print opened the standalone window').toBe(1);
  await closePrintWindow();

  // No in-app modal on any route.
  const stillNoModal = await win.evaluate(() => document.querySelectorAll('[data-print-dialog], .print-dialog').length);
  expect(stillNoModal, 'no in-app modal appears on any print route').toBe(0);
});

// --- (d) thumbnail panel: 184px, no title ----------------------------------
test('(d) the thumbnail panel is 184px with no title', async () => {
  await openReport();
  await gotoStage(win, 1);
  await win.waitForTimeout(500);

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
  log('pages-panel', panel);
  expect(panel.title, 'the PAGES title is removed').toBe(0);
  expect(panel.railW, 'the rail token is 184px').toBe('184px');
  expect(panel.width, 'the panel is 184px').toBeGreaterThanOrEqual(180);
  expect(panel.width).toBeLessThanOrEqual(190);
});

// --- (e) EDIT stage is the edit-mode switch --------------------------------
test('(e) entering the EDIT stage enables edit mode with no editMode dock verb', async () => {
  await openReport();
  await gotoStage(win, 2);
  // Phase 41 (item 2) — the legacy edit toolbar is retired; the edit layer
  // (mounted when a tool is armed) is the observable.
  await win.locator('[data-dock-verb="editTextBox"]').waitFor({ state: 'visible', timeout: 10000 });
  await win.locator('[data-dock-verb="editTextBox"]').click();
  await win.waitForTimeout(400);
  expect(await win.locator('.edit-layer').count(), 'entering EDIT enables edit mode (the edit layer mounts)').toBeGreaterThan(0);
  expect(await win.locator('[data-dock-verb="editMode"]').count(), 'no editMode dock verb').toBe(0);
  await gotoStage(win, 1);
  await win.waitForTimeout(500);
  expect(await win.locator('.edit-layer').count(), 'leaving EDIT disables edit mode').toBe(0);
  await gotoStage(win, 2);
  await win.waitForTimeout(500);
  await win.locator('[data-dock-verb="editTextBox"]').click();
  await win.waitForTimeout(400);
  expect(await win.locator('.edit-layer').count(), 're-entering EDIT re-enables it').toBeGreaterThan(0);
});
