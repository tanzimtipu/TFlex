// Operator text-manipulation bugs on the INSTALLED app (2026-09-20, explicit
// orchestrator dispatch). Launches %LOCALAPPDATA%\Programs\TFlex\TFlex.exe via
// the canonical launchApp() from e2e/lib/launch.cjs - NEVER the dev build.
//
// Reproduces four tools through the real UI and measures raw behaviour:
//   A. annotation TEXTBOX  ([data-tool="textbox"])
//   B. annotation CALLOUT  ([data-tool="callout"])
//   C. annotation NOTE     ([data-tool="note"])
//   D. edit-mode TEXT BOX  ([data-edit-tool="box"])
//
// For each: panel mode + live/disabled controls (with exact tooltip), click
// behaviour + elementFromPoint, double-click editor, and text persistence
// through save + reopen.
//
// Evidence: screenshots/installed-textbug-tool{A,B,C,D}.png,
//           screenshots/installed-textbug-repro.json
//
// Run: npx playwright test --config=e2e/installed/playwright.installed.config.js installed_textbug_repro
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose, dismissUpdatePrompt, armAnnotationTool, openSample, openSamplePath } = require('../lib/helpers.cjs');

const PACKAGED_EXE =
  process.env.TFLEX_PACKAGED_EXE ||
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'TFlex', 'TFlex.exe');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const REPORT = path.join(SHOTS, 'installed-textbug-repro.json');
fs.mkdirSync(SHOTS, { recursive: true });
const report = {};
const log = (l, o) => console.log(`[INSTALLED-TXT] ${l} ${JSON.stringify(o)}`);

test.setTimeout(240000);

async function launchInstalledApp() {
  const app = await launchApp([], null, PACKAGED_EXE);
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 40000 });
  await dismissUpdatePrompt(win);
  return { app, win };
}

async function openReport(win, app) {
  await openSample(win, app, 'report.pdf');
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(600);
}

const panelOpen = (win) =>
  win.evaluate(() => document.querySelector('.workspace')?.getAttribute('data-text-panel-open') ?? null);

async function panelState(win) {
  return win.evaluate(() => {
    const p = document.querySelector('.text-props-panel');
    const body = document.querySelector('[data-text-panel]');
    const ctl = (s) => {
      const el = p ? p.querySelector(s) : null;
      return el ? { disabled: !!el.disabled, title: el.getAttribute('title') } : null;
    };
    return {
      mounted: !!p,
      mode: body ? body.getAttribute('data-text-panel-mode') : null,
      open: document.querySelector('.workspace')?.getAttribute('data-text-panel-open') ?? null,
      font: ctl('[data-txt-font]'),
      size: ctl('[data-txt-size]'),
      bold: ctl('[data-txt-bold]'),
      italic: ctl('[data-txt-italic]'),
      color: ctl('[data-txt-color]'),
    };
  });
}

async function hitAt(win, sel) {
  return win.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      x: +x.toFixed(1),
      y: +y.toFixed(1),
      hitTag: hit ? hit.tagName : null,
      hitClass: hit ? String(hit.className) : null,
      hitIsCanvas: !!(hit && hit.tagName === 'CANVAS'),
      hitAnnId: hit && hit.closest ? (hit.closest('[data-annotation-id]')?.getAttribute('data-annotation-id') ?? null) : null,
      hitEditBox: !!(hit && hit.closest && hit.closest('.edit-box')),
    };
  }, sel);
}

async function saveReopen(win, app, tag) {
  const savePath = path.join(os.tmpdir(), `installed-txt-${tag}-${Date.now()}.pdf`);
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-confirm]', { timeout: 8000 });
  await win.click('[data-save-as-confirm]');
  await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 30000 });
  const exists = fs.existsSync(savePath);
  await win.locator('.tab-active .tab-close').click();
  await win.waitForTimeout(1500);
  await openSamplePath(win, app, savePath);
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(2000);
  const state = await win.evaluate(() => {
    const es = window.tflexDiagnostics().engineState || {};
    return {
      annotations: (es.annotations || []).map((a) => ({ kind: a.kind, text: a.text })),
      textBoxes: (es.textBoxes || []).map((b) => ({ text: b.text, font: b.font, size: b.size, bold: b.bold })),
    };
  });
  return { savePath, exists, state };
}

function writeReport() {
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
}
// ===========================================================================
// TOOL A - annotation TEXTBOX
// ===========================================================================
test('TOOL A annotation textbox: panel, click, dblclick, controls, persist', async () => {
  const { app, win } = await launchInstalledApp();
  try {
    await openReport(win, app);
    await armAnnotationTool(win, 'textbox');
    await win.waitForSelector('.text-props-panel', { timeout: 8000 });
    const panelArmed = await panelState(win);
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.mouse.click(pg.x + pg.width * 0.3, pg.y + pg.height * 0.3);
    await win.waitForSelector('[data-annotation-editor="textbox"]', { timeout: 8000 });
    await win.locator('[data-annotation-editor="textbox"] textarea').fill('INST-TB');
    await win.click('[data-annotation-action="textbox-confirm"]');
    await win.waitForSelector('.pdf-page[data-page="1"] [data-kind="textbox"]', { timeout: 8000 });
    await win.waitForTimeout(500);
    const panelAfterPlace = await panelState(win);
    const openImmediate = await panelOpen(win);
    const sel = '.pdf-page[data-page="1"] [data-kind="textbox"]';
    const hit = await hitAt(win, sel);

    if (hit) await win.mouse.click(hit.x, hit.y);
    await win.waitForTimeout(400);
    const afterClick = await panelState(win);
    const chromeClick = await win.evaluate(() => !!document.querySelector('[data-content-selection-frame]'));
    await win.screenshot({ path: path.join(SHOTS, 'installed-textbug-toolA.png') }).catch(() => {});

    if (hit) await win.mouse.dblclick(hit.x, hit.y);
    const dblOpened = await win
      .waitForSelector('[data-annotation-editor="edit-textbox"], [data-annotation-editor="textbox"]', { state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    const dblText = await win.evaluate(() => {
      const ed = document.querySelector('[data-annotation-editor="edit-textbox"], [data-annotation-editor="textbox"]');
      const ta = ed ? ed.querySelector('textarea') : null;
      return ta ? ta.value : null;
    });
    if (dblOpened) await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    const persist = await saveReopen(win, app, 'toolA');
    report.toolA = { panelArmed, panelAfterPlace, openImmediate, hit, afterClick, chromeClick, dblOpened, dblText, persist };
    log('TOOL_A', report.toolA);
  } finally {
    writeReport();
    await hardClose(app, 'installed-toolA');
  }
});

// ===========================================================================
// TOOL B - CALLOUT
// ===========================================================================
test('TOOL B callout: panel, click, dblclick, controls, persist', async () => {
  const { app, win } = await launchInstalledApp();
  try {
    await openReport(win, app);
    await armAnnotationTool(win, 'callout');
    await win.waitForSelector('.text-props-panel', { timeout: 8000 });
    const panelArmed = await panelState(win);
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.mouse.move(pg.x + pg.width * 0.3, pg.y + pg.height * 0.3);
    await win.mouse.down();
    await win.mouse.move(pg.x + pg.width * 0.3 + 180, pg.y + pg.height * 0.3 + 70, { steps: 6 });
    await win.mouse.up();
    await win.waitForSelector('[data-annotation-editor="callout"]', { timeout: 8000 });
    await win.locator('[data-annotation-editor="callout"] textarea').fill('INST-CALL');
    await win.click('[data-annotation-action="callout-confirm"]');
    await win.waitForSelector('.pdf-page[data-page="1"] [data-kind="callout"]', { timeout: 8000 });
    await win.waitForTimeout(500);
    const panelAfterPlace = await panelState(win);
    const openImmediate = await panelOpen(win);
    const sel = '.pdf-page[data-page="1"] .ann-callout.ann-content';
    const hit = await hitAt(win, sel);

    if (hit) await win.mouse.click(hit.x, hit.y);
    await win.waitForTimeout(400);
    const afterClick = await panelState(win);
    const chromeClick = await win.evaluate(() => !!document.querySelector('[data-content-selection-frame]'));
    await win.screenshot({ path: path.join(SHOTS, 'installed-textbug-toolB.png') }).catch(() => {});

    if (hit) await win.mouse.dblclick(hit.x, hit.y);
    const dblOpened = await win
      .waitForSelector('[data-annotation-editor="edit-callout"], [data-annotation-editor="callout"]', { state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    const dblText = await win.evaluate(() => {
      const ed = document.querySelector('[data-annotation-editor="edit-callout"], [data-annotation-editor="callout"]');
      const ta = ed ? ed.querySelector('textarea') : null;
      return ta ? ta.value : null;
    });
    if (dblOpened) await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    const persist = await saveReopen(win, app, 'toolB');
    report.toolB = { panelArmed, panelAfterPlace, openImmediate, hit, afterClick, chromeClick, dblOpened, dblText, persist };
    log('TOOL_B', report.toolB);
  } finally {
    writeReport();
    await hardClose(app, 'installed-toolB');
  }
});

// ===========================================================================
// TOOL C - STICKY NOTE
// ===========================================================================
test('TOOL C note: panel, click, dblclick, controls, persist', async () => {
  const { app, win } = await launchInstalledApp();
  try {
    await openReport(win, app);
    await armAnnotationTool(win, 'note');
    await win.waitForSelector('.text-props-panel', { timeout: 8000 });
    const panelArmed = await panelState(win);
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.mouse.click(pg.x + pg.width * 0.45, pg.y + pg.height * 0.42);
    await win.waitForSelector('[data-annotation-editor="note"]', { timeout: 8000 });
    await win.locator('[data-annotation-editor="note"] textarea').fill('INST-NOTE');
    await win.click('[data-annotation-action="note-confirm"]');
    await win.waitForSelector('.pdf-page[data-page="1"] [data-kind="note"]', { timeout: 8000 });
    await win.waitForTimeout(500);
    const panelAfterPlace = await panelState(win);
    const openImmediate = await panelOpen(win);
    const sel = '.pdf-page[data-page="1"] [data-kind="note"]';
    const hit = await hitAt(win, sel);

    if (hit) await win.mouse.click(hit.x, hit.y);
    await win.waitForTimeout(400);
    const afterClick = await panelState(win);
    const noteSelected = await win.evaluate(() =>
      document.querySelector('.pdf-page[data-page="1"] [data-kind="note"]')?.getAttribute('data-note-selected') ?? null);
    await win.screenshot({ path: path.join(SHOTS, 'installed-textbug-toolC.png') }).catch(() => {});

    if (hit) await win.mouse.dblclick(hit.x, hit.y);
    const dblOpened = await win
      .waitForSelector('[data-annotation-editor="note"]', { state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (dblOpened) await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    const persist = await saveReopen(win, app, 'toolC');
    report.toolC = { panelArmed, panelAfterPlace, openImmediate, hit, afterClick, noteSelected, dblOpened, persist };
    log('TOOL_C', report.toolC);
  } finally {
    writeReport();
    await hardClose(app, 'installed-toolC');
  }
});

// ===========================================================================
// TOOL D - EDIT-MODE TEXT BOX
// ===========================================================================
test('TOOL D edit-mode box: panel, click, dblclick, controls, persist', async () => {
  const { app, win } = await launchInstalledApp();
  try {
    await openReport(win, app);
    await win.click('button[aria-label="Edit content"]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
    await win.click('[data-edit-tool="box"]');
    await win.waitForTimeout(300);
    const panelArmed = await panelState(win);
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.mouse.move(pg.x + pg.width * 0.25, pg.y + pg.height * 0.2);
    await win.mouse.down();
    await win.mouse.move(pg.x + pg.width * 0.25 + 200, pg.y + pg.height * 0.2 + 70, { steps: 6 });
    await win.mouse.up();
    await win.waitForSelector('[data-edit-editor]', { timeout: 8000 });
    await win.locator('[data-edit-textarea]').fill('INST-BOX');
    await win.click('[data-edit-confirm]');
    await win.waitForSelector('.edit-box', { timeout: 8000 });
    await win.waitForTimeout(600);
    const panelAfterPlace = await panelState(win);
    const openImmediate = await panelOpen(win);
    const sel = '.edit-box';
    const hit = await hitAt(win, sel);

    if (hit) await win.mouse.click(hit.x, hit.y);
    await win.waitForTimeout(400);
    const afterClick = await panelState(win);
    const toolbarAfterClick = await win.evaluate(() => !!document.querySelector('[data-edit-box-toolbar]'));
    await win.screenshot({ path: path.join(SHOTS, 'installed-textbug-toolD.png') }).catch(() => {});

    if (hit) await win.mouse.dblclick(hit.x, hit.y);
    const dblOpened = await win
      .waitForSelector('[data-edit-editor]', { state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (dblOpened) await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    const persist = await saveReopen(win, app, 'toolD');
    report.toolD = { panelArmed, panelAfterPlace, openImmediate, hit, afterClick, toolbarAfterClick, dblOpened, persist };
    log('TOOL_D', report.toolD);
  } finally {
    writeReport();
    await hardClose(app, 'installed-toolD');
  }
});
