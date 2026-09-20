// Operator-reported text-manipulation bugs (2026-09-20, second complaint):
//   A. "Annotation text related tools doesn't allow using text manipulation panel."
//   B. "After placing any text like 'text box', 'comments' etc, single or double
//       clicking does not work. The screen just glitches for a bit."
//
// Focused EVIDENCE ONLY - measures the CURRENT dev build through the real UI for
// four tools (annotation textbox / callout / note, and the Edit-mode text box).
// No product fix, no assertion that hides a failure: every step is logged raw.
//
// Evidence: screenshots/operator-text-manip-*.png, screenshots/operator-text-manip-repro.json
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchDev, openSample, openSamplePath, hardClose, armAnnotationTool } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const REPORT = path.join(SHOTS, 'operator-text-manip-repro.json');
fs.mkdirSync(SHOTS, { recursive: true });
const report = {};
const log = (l, o) => console.log(`[TXTREPRO] ${l} ${JSON.stringify(o)}`);

async function openReport(win, app) {
  await openSample(win, app, 'report.pdf');
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(500);
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

async function insets(win) {
  return win.evaluate(() => {
    const page = document.querySelector('.pdf-page[data-page="1"]');
    const main = document.querySelector('.workspace-main');
    return {
      pageLeft: page ? +page.getBoundingClientRect().left.toFixed(2) : null,
      mainLeft: main ? +main.getBoundingClientRect().left.toFixed(2) : null,
      panelW: document.querySelector('.text-props-panel')
        ? +document.querySelector('.text-props-panel').getBoundingClientRect().width.toFixed(2)
        : 0,
    };
  });
}

async function installProbe(win, ms) {
  await win.evaluate((m) => {
    window.__tx = { rows: [], running: true };
    const t0 = performance.now();
    const tick = () => {
      const ws = document.querySelector('.workspace');
      const page = document.querySelector('.pdf-page[data-page="1"]');
      const panel = document.querySelector('.text-props-panel');
      window.__tx.rows.push({
        t: Math.round(performance.now() - t0),
        open: ws ? ws.getAttribute('data-text-panel-open') : null,
        pageLeft: page ? +page.getBoundingClientRect().left.toFixed(2) : null,
        panelW: panel ? +panel.getBoundingClientRect().width.toFixed(2) : 0,
      });
      if (performance.now() - t0 < m) requestAnimationFrame(tick);
      else window.__tx.running = false;
    };
    requestAnimationFrame(tick);
  }, ms);
}

async function readProbe(win) {
  await win
    .waitForFunction(() => window.__tx && window.__tx.running === false, null, { timeout: 8000 })
    .catch(() => {});
  return win.evaluate(() => window.__tx.rows);
}

function probeSummary(rows) {
  const openFalse = rows.filter((r) => r.open !== 'true').length;
  const lefts = rows.map((r) => r.pageLeft).filter((v) => v !== null);
  const leftRange = lefts.length ? +(Math.max(...lefts) - Math.min(...lefts)).toFixed(2) : null;
  const widths = rows.map((r) => r.panelW);
  return {
    frames: rows.length,
    openFalse,
    leftRange,
    minW: widths.length ? +Math.min(...widths).toFixed(2) : null,
    maxW: widths.length ? +Math.max(...widths).toFixed(2) : null,
  };
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
  const savePath = path.join(os.tmpdir(), `txtrepro-${tag}-${Date.now()}.pdf`);
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

// ===========================================================================
// TOOL 1 - annotation TEXTBOX
// ===========================================================================
test('TOOL1 annotation textbox: place, click, dblclick, controls, persist', async () => {
  test.setTimeout(180000);
  const { electronApp: app, window: win } = await launchDev();
  try {
    await openReport(win, app);
    await armAnnotationTool(win, 'textbox');
    await win.waitForSelector('.text-props-panel', { timeout: 8000 });
    const panelArmed = await panelState(win);
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.mouse.click(pg.x + pg.width * 0.3, pg.y + pg.height * 0.3);
    await win.waitForSelector('[data-annotation-editor="textbox"]', { timeout: 8000 });
    await win.locator('[data-annotation-editor="textbox"] textarea').fill('OP-TB');
    await win.click('[data-annotation-action="textbox-confirm"]');
    await win.waitForSelector('.pdf-page[data-page="1"] [data-kind="textbox"]', { timeout: 8000 });
    await win.waitForTimeout(500);
    const panelAfterPlace = await panelState(win);
    const sel = '.pdf-page[data-page="1"] [data-kind="textbox"]';
    const hit = await hitAt(win, sel);

    // single click
    await installProbe(win, 900);
    if (hit) await win.mouse.click(hit.x, hit.y);
    const rowsClick = await readProbe(win);
    const afterClick = await panelState(win);
    const chromeClick = await win.evaluate(() => !!document.querySelector('[data-content-selection-frame]'));
    await win.screenshot({ path: path.join(SHOTS, 'operator-text-manip-tool1-click.png') }).catch(() => {});

    // double click (committed editor selector is data-annotation-editor="edit-textbox")
    await installProbe(win, 900);
    if (hit) await win.mouse.dblclick(hit.x, hit.y);
    const dblOpened = await win
      .waitForSelector('[data-annotation-editor="edit-textbox"], [data-annotation-editor="textbox"]', { state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    const dblSel = await win.evaluate(() =>
      document.querySelector('[data-annotation-editor="edit-textbox"]') ? 'edit-textbox'
        : document.querySelector('[data-annotation-editor="textbox"]') ? 'textbox' : null);
    const dblText = await win.evaluate(() => {
      const ed = document.querySelector('[data-annotation-editor="edit-textbox"], [data-annotation-editor="textbox"]');
      const ta = ed ? ed.querySelector('textarea') : null;
      return ta ? ta.value : null;
    });
    const rowsDbl = await readProbe(win);
    await win.screenshot({ path: path.join(SHOTS, 'operator-text-manip-tool1-dblclick.png') }).catch(() => {});
    if (dblOpened) await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    const persist = await saveReopen(win, app, 'tool1');
    report.tool1 = {
      panelArmed, panelAfterPlace, hit,
      click: { summary: probeSummary(rowsClick), afterClick, chromeClick },
      dblclick: { opened: dblOpened, sel: dblSel, text: dblText, summary: probeSummary(rowsDbl) },
      persist,
    };
    log('TOOL1', report.tool1);
  } finally {
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    await hardClose(app, 'tool1');
  }
});

// ===========================================================================
// TOOL 2 - CALLOUT
// ===========================================================================
test('TOOL2 callout: place, click, dblclick, controls, persist', async () => {
  test.setTimeout(180000);
  const { electronApp: app, window: win } = await launchDev();
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
    await win.locator('[data-annotation-editor="callout"] textarea').fill('OP-CALL');
    await win.click('[data-annotation-action="callout-confirm"]');
    await win.waitForSelector('.pdf-page[data-page="1"] [data-kind="callout"]', { timeout: 8000 });
    await win.waitForTimeout(500);
    const panelAfterPlace = await panelState(win);
    // The callout renders an inset:0 SVG (arrow) with data-kind="callout" too;
    // target the text-body div specifically, not the first matching element.
    const sel = '.pdf-page[data-page="1"] .ann-callout.ann-content';
    const hit = await hitAt(win, sel);

    await installProbe(win, 900);
    if (hit) await win.mouse.click(hit.x, hit.y);
    const rowsClick = await readProbe(win);
    const afterClick = await panelState(win);
    const chromeClick = await win.evaluate(() => !!document.querySelector('[data-content-selection-frame]'));
    await win.screenshot({ path: path.join(SHOTS, 'operator-text-manip-tool2-click.png') }).catch(() => {});

    await installProbe(win, 900);
    if (hit) await win.mouse.dblclick(hit.x, hit.y);
    const dblOpened = await win
      .waitForSelector('[data-annotation-editor="edit-callout"], [data-annotation-editor="callout"]', { state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    const dblSel = await win.evaluate(() =>
      document.querySelector('[data-annotation-editor="edit-callout"]') ? 'edit-callout'
        : document.querySelector('[data-annotation-editor="callout"]') ? 'callout' : null);
    const dblText = await win.evaluate(() => {
      const ed = document.querySelector('[data-annotation-editor="edit-callout"], [data-annotation-editor="callout"]');
      const ta = ed ? ed.querySelector('textarea') : null;
      return ta ? ta.value : null;
    });
    const rowsDbl = await readProbe(win);
    await win.screenshot({ path: path.join(SHOTS, 'operator-text-manip-tool2-dblclick.png') }).catch(() => {});
    if (dblOpened) await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    const persist = await saveReopen(win, app, 'tool2');
    report.tool2 = {
      panelArmed, panelAfterPlace, hit,
      click: { summary: probeSummary(rowsClick), afterClick, chromeClick },
      dblclick: { opened: dblOpened, sel: dblSel, text: dblText, summary: probeSummary(rowsDbl) },
      persist,
    };
    log('TOOL2', report.tool2);
  } finally {
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    await hardClose(app, 'tool2');
  }
});

// ===========================================================================
// TOOL 3 - STICKY NOTE
// ===========================================================================
test('TOOL3 note: place, click, dblclick, controls, persist', async () => {
  test.setTimeout(180000);
  const { electronApp: app, window: win } = await launchDev();
  try {
    await openReport(win, app);
    await armAnnotationTool(win, 'note');
    await win.waitForSelector('.text-props-panel', { timeout: 8000 });
    const panelArmed = await panelState(win);
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.mouse.click(pg.x + pg.width * 0.45, pg.y + pg.height * 0.42);
    await win.waitForSelector('[data-annotation-editor="note"]', { timeout: 8000 });
    await win.locator('[data-annotation-editor="note"] textarea').fill('OP-NOTE');
    await win.click('[data-annotation-action="note-confirm"]');
    await win.waitForSelector('.pdf-page[data-page="1"] [data-kind="note"]', { timeout: 8000 });
    await win.waitForTimeout(500);
    const panelAfterPlace = await panelState(win);
    const sel = '.pdf-page[data-page="1"] [data-kind="note"]';
    const hit = await hitAt(win, sel);

    await installProbe(win, 900);
    if (hit) await win.mouse.click(hit.x, hit.y);
    const rowsClick = await readProbe(win);
    const afterClick = await panelState(win);
    const noteSelected = await win.evaluate(() =>
      document.querySelector('.pdf-page[data-page="1"] [data-kind="note"]')?.getAttribute('data-note-selected') ?? null);
    await win.screenshot({ path: path.join(SHOTS, 'operator-text-manip-tool3-click.png') }).catch(() => {});

    await installProbe(win, 900);
    if (hit) await win.mouse.dblclick(hit.x, hit.y);
    const dblOpened = await win
      .waitForSelector('[data-annotation-editor="note"]', { state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    const rowsDbl = await readProbe(win);
    await win.screenshot({ path: path.join(SHOTS, 'operator-text-manip-tool3-dblclick.png') }).catch(() => {});
    if (dblOpened) await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    const persist = await saveReopen(win, app, 'tool3');
    report.tool3 = {
      panelArmed, panelAfterPlace, hit,
      click: { summary: probeSummary(rowsClick), afterClick, noteSelected },
      dblclick: { opened: dblOpened, summary: probeSummary(rowsDbl) },
      persist,
    };
    log('TOOL3', report.tool3);
  } finally {
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    await hardClose(app, 'tool3');
  }
});

// ===========================================================================
// TOOL 4 - EDIT-MODE TEXT BOX
// ===========================================================================
test('TOOL4 edit-mode box: place, click, dblclick, controls, persist', async () => {
  test.setTimeout(180000);
  const { electronApp: app, window: win } = await launchDev();
  try {
    await openReport(win, app);
    await win.click('button[aria-label="Edit content"]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
    await win.click('[data-edit-tool="box"]');
    await win.waitForTimeout(300);
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.mouse.move(pg.x + pg.width * 0.25, pg.y + pg.height * 0.2);
    await win.mouse.down();
    await win.mouse.move(pg.x + pg.width * 0.25 + 200, pg.y + pg.height * 0.2 + 70, { steps: 6 });
    await win.mouse.up();
    await win.waitForSelector('[data-edit-editor]', { timeout: 8000 });
    await win.locator('[data-edit-textarea]').fill('OP-BOX');
    await win.click('[data-edit-confirm]');
    await win.waitForSelector('.edit-box', { timeout: 8000 });
    await win.waitForTimeout(600);
    const panelAfterPlace = await panelState(win);
    const sel = '.edit-box';
    const hit = await hitAt(win, sel);

    await installProbe(win, 900);
    if (hit) await win.mouse.click(hit.x, hit.y);
    const rowsClick = await readProbe(win);
    const afterClick = await panelState(win);
    const toolbarAfterClick = await win.evaluate(() => !!document.querySelector('[data-edit-box-toolbar]'));
    await win.screenshot({ path: path.join(SHOTS, 'operator-text-manip-tool4-click.png') }).catch(() => {});

    await installProbe(win, 900);
    if (hit) await win.mouse.dblclick(hit.x, hit.y);
    const dblOpened = await win
      .waitForSelector('[data-edit-editor]', { state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    const rowsDbl = await readProbe(win);
    await win.screenshot({ path: path.join(SHOTS, 'operator-text-manip-tool4-dblclick.png') }).catch(() => {});
    if (dblOpened) await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    const persist = await saveReopen(win, app, 'tool4');
    report.tool4 = {
      panelAfterPlace, hit,
      click: { summary: probeSummary(rowsClick), afterClick, toolbarAfterClick },
      dblclick: { opened: dblOpened, summary: probeSummary(rowsDbl) },
      persist,
    };
    log('TOOL4', report.tool4);
  } finally {
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    await hardClose(app, 'tool4');
  }
});