// DEF-253 retest (HIGH) — clicking an EXISTING / REOPENED annotation text
// object must open the text-properties panel and KEEP it open, reflecting the
// annotation's stored style.
//
// Independent measurement in the REAL dev app (canonical launchDev only):
//   - place a textbox, set font=Times / size=18 / bold, blank-click to deselect
//     (panel closes), then single-click the committed textbox while a 500ms rAF
//     probe samples `panel` + `active` every frame. Zero `panel=false` frames
//     after the click is the pass condition (the DEF-253 failure showed
//     panel=true at t=11ms then panel=false at t=261ms).
//   - repeat for callout and note.
//   - save + reopen, then click the reopened textbox and re-measure.
//
// Evidence: screenshots/def253-retest.png, screenshots/def253-retest.json
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchDev, openSample, openSamplePath, hardClose, armAnnotationTool, scrollToPage } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const REPORT = path.join(SHOTS, 'def253-retest.json');
fs.mkdirSync(SHOTS, { recursive: true });
const report = {};
const log = (l, o) => console.log(`[DEF253] ${l} ${JSON.stringify(o)}`);

async function openReport(win, app) {
  await openSample(win, app, 'report.pdf');
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(500);
}

async function dragOnPage(win, fx, fy, dxPx = 190, dyPx = 60) {
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 240));
  const y = Math.max(pg.y + pg.height * fy, vp.h - 110);
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dxPx, y + dyPx, { steps: 6 });
  await win.mouse.up();
}

async function placeTextbox(win, text, fx = 0.3, fy = 0.22) {
  await armAnnotationTool(win, 'textbox');
  await dragOnPage(win, fx, fy);
  await win.waitForSelector('[data-annotation-editor="textbox"]', { timeout: 8000 });
  await win.locator('[data-annotation-editor="textbox"] textarea').fill(text);
  await win.click('[data-annotation-action="textbox-confirm"]');
  await win.waitForSelector('.ann-textbox[data-kind="textbox"]', { timeout: 8000 });
  await win.waitForSelector('.text-props-panel', { timeout: 8000 });
  await win.waitForTimeout(300);
}

async function placeCallout(win, text, fx = 0.3, fy = 0.45) {
  await armAnnotationTool(win, 'callout');
  await dragOnPage(win, fx, fy);
  await win.waitForSelector('[data-annotation-editor="callout"]', { timeout: 8000 });
  await win.locator('[data-annotation-editor="callout"] textarea').fill(text);
  await win.click('[data-annotation-action="callout-confirm"]');
  await win.waitForSelector('.ann-callout[data-kind="callout"]', { timeout: 8000 });
  await win.waitForTimeout(300);
}

async function placeNote(win, text, fx = 0.5, fy = 0.5) {
  await armAnnotationTool(win, 'note');
  await scrollToPage(win, 1);
  const armed = await win.evaluate(() => ({
    activeTool: window.tflexDiagnostics().activeTool,
    visible: !!document.querySelector('[data-ann-tools-visible] button[data-tool="note"]'),
    menu: !!document.querySelector('[data-ann-dropdown-menu]'),
    panels: document.querySelectorAll('.text-props-panel').length,
  }));
  log('note-armed', armed);
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 240));
  const y = Math.max(pg.y + 20, Math.min(pg.y + pg.height * fy, vp.h - 110));
  const hit = await win.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return { tag: el && el.tagName, cls: el && String(el.className).slice(0, 60), inPage: !!(el && el.closest && el.closest('.pdf-page')) };
  }, { x, y });
  log('note-point', { x: Math.round(x), y: Math.round(y), pg, vp, hit });
  await win.mouse.click(x, y);
  await win.waitForSelector('[data-annotation-editor="note"]', { timeout: 8000 });
  await win.locator('[data-annotation-editor="note"] textarea').fill(text);
  await win.click('[data-annotation-action="note-confirm"]');
  await win.waitForSelector('.ann-note[data-kind="note"]', { timeout: 8000 });
  await win.waitForTimeout(300);
}

async function panelState(win) {
  return win.evaluate(() => {
    const p = document.querySelector('.text-props-panel');
    if (!p) return null;
    const q = (s) => p.querySelector(s);
    return {
      mode: document.querySelector('[data-text-panel]')?.getAttribute('data-text-panel-mode') ?? null,
      font: q('[data-txt-font]')?.value ?? null,
      size: q('[data-txt-size]')?.value ?? null,
      bold: q('[data-txt-bold]')?.getAttribute('aria-pressed') === 'true',
    };
  });
}

async function blankClick(win, fx = 0.12, fy = 0.85) {
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.min(Math.max(pg.x + pg.width * fx, 20), vp.w - 20);
  const y = Math.min(Math.max(pg.y + pg.height * fy, 20), vp.h - 20);
  await win.mouse.click(x, y);
  await win.waitForTimeout(600);
}

/** Click an annotation overlay while a 500ms rAF probe samples panel/active. */
async function clickAndProbe(win, sel) {
  const loc = win.locator(sel).first();
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const box = await loc.boundingBox();
  await win.evaluate(() => {
    window.__d253 = [];
    const t0 = performance.now();
    const tick = () => {
      window.__d253.push({
        t: Math.round(performance.now() - t0),
        active: !!document.querySelector('.annotation-layer-active'),
        panel: !!document.querySelector('.text-props-panel'),
      });
      if (performance.now() - t0 < 500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await win.waitForTimeout(700);
  const frames = await win.evaluate(() => window.__d253);
  const transitions = frames.filter((f, i, arr) => i === 0 || f.active !== arr[i - 1].active || f.panel !== arr[i - 1].panel);
  const panelFalse = frames.filter((f) => !f.panel).length;
  const state = await win.evaluate(() => ({
    panel: !!document.querySelector('.text-props-panel'),
    active: !!document.querySelector('.annotation-layer-active'),
  }));
  log('click-probe', { sel, frames: frames.length, panelFalse, transitions, state });
  return { frames: frames.length, panelFalse, transitions, state };
}

test('DEF-253 existing + reopened annotation click keeps the panel open with stored style', async () => {
  test.setTimeout(240000);
  const { electronApp, window: win } = await launchDev();
  try {
    await openReport(win, electronApp);

    // -- existing textbox with a stored style --------------------------------
    await placeTextbox(win, 'D253-TB', 0.3, 0.22);
    await win.locator('[data-txt-font]').selectOption('Times');
    await win.locator('[data-txt-size]').fill('18');
    await win.click('[data-txt-bold]');
    await win.waitForTimeout(400);
    await blankClick(win);
    const closed = await win.evaluate(() => document.querySelectorAll('.text-props-panel').length);
    expect(closed, 'blank click deselects and closes the panel before the retest click').toBe(0);

    const tb = await clickAndProbe(win, '.ann-textbox[data-kind="textbox"]');
    const tbPanel = await panelState(win);
    await win.screenshot({ path: path.join(SHOTS, 'def253-retest.png') }).catch(() => {});
    report.textbox = { probe: tb, panel: tbPanel };

    expect(tb.panelFalse, 'textbox: zero panel=false frames in the 500ms probe').toBe(0);
    expect(tb.state.panel, 'textbox: panel open after the click').toBe(true);
    expect(tb.state.active, 'textbox: annotation layer active after the click').toBe(true);
    expect(tbPanel.mode, 'textbox: panel in annotation mode').toBe('annotation');
    expect(tbPanel.font, 'textbox: panel reflects stored font=Times').toBe('Times');
    expect(Number(tbPanel.size), 'textbox: panel reflects stored size=18').toBe(18);
    expect(tbPanel.bold, 'textbox: panel reflects stored bold=true').toBe(true);

    // -- existing callout ----------------------------------------------------
    await blankClick(win);
    await placeCallout(win, 'D253-CO', 0.3, 0.45);
    await win.locator('[data-txt-font]').selectOption('Courier');
    await win.waitForTimeout(400);
    await blankClick(win);
    const co = await clickAndProbe(win, '.ann-callout[data-kind="callout"]');
    const coPanel = await panelState(win);
    report.callout = { probe: co, panel: coPanel };
    expect(co.panelFalse, 'callout: zero panel=false frames in the 500ms probe').toBe(0);
    expect(co.state.panel, 'callout: panel open after the click').toBe(true);
    expect(coPanel.font, 'callout: panel reflects stored font=Courier').toBe('Courier');

    // -- existing note -------------------------------------------------------
    await blankClick(win);
    await placeNote(win, 'D253-NT', 0.62, 0.58);
    await win.locator('[data-txt-font]').selectOption('Times');
    await win.waitForTimeout(400);
    await blankClick(win);
    const nt = await clickAndProbe(win, '.ann-note[data-kind="note"]');
    const ntPanel = await panelState(win);
    report.note = { probe: nt, panel: ntPanel };
    expect(nt.panelFalse, 'note: zero panel=false frames in the 500ms probe').toBe(0);
    expect(nt.state.panel, 'note: panel open after the click').toBe(true);
    expect(ntPanel.font, 'note: panel reflects stored font=Times').toBe('Times');

    // -- save + reopen, then click the reopened textbox ----------------------
    const savePath = path.join(os.tmpdir(), `d253-rt-${Date.now()}.pdf`);
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, savePath);
    await win.click('[data-toolbar-save-as]');
    await win.waitForSelector('[data-save-as-confirm]', { timeout: 8000 });
    await win.click('[data-save-as-confirm]');
    await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 30000 });
    expect(fs.existsSync(savePath), 'saved PDF exists on disk').toBe(true);

    await win.locator('.tab-active .tab-close').click();
    await win.waitForTimeout(1500);
    await openSamplePath(win, electronApp, savePath);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(2000);

    const rt = await clickAndProbe(win, '.ann-textbox[data-kind="textbox"]');
    const rtPanel = await panelState(win);
    await win.screenshot({ path: path.join(SHOTS, 'def253-retest.png') }).catch(() => {});
    report.reopened = { probe: rt, panel: rtPanel };

    expect(rt.panelFalse, 'reopened textbox: zero panel=false frames in the 500ms probe').toBe(0);
    expect(rt.state.panel, 'reopened textbox: panel open after the click').toBe(true);
    expect(rtPanel.mode, 'reopened textbox: panel in annotation mode').toBe('annotation');
    expect(rtPanel.font, 'reopened textbox: panel reflects stored font=Times').toBe('Times');
    expect(Number(rtPanel.size), 'reopened textbox: panel reflects stored size=18').toBe(18);
    expect(rtPanel.bold, 'reopened textbox: panel reflects stored bold=true').toBe(true);
  } finally {
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    await hardClose(electronApp, 'def253');
  }
});