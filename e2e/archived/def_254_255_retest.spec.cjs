// DEF-254 / DEF-255 retest (both HIGH) — Phase-24 close-out.
//
// DEF-254: selecting an annotation on a page OTHER than page 1 must keep the
// text-properties panel open when a neighbouring page mounts (virtualization
// reflow). Measured with an rAF probe: zero `panel=false` frames after the
// panel first opens, plus the actual mount/unmount of a neighbouring page in
// the same window. Then a blank click on THAT SAME page must still deselect
// (the null report is accepted from the page that holds the selection).
//
// DEF-255: a cleared highlight and a deleted annotation must both survive
// save + close + reopen. The prior bug duplicated modeled annotations via
// pdf-lib copyPages, silently reverting the edit.
//
// Evidence: screenshots/def254-255-retest.png, screenshots/def254-255-retest.json
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { openSamplePath, hardClose, armAnnotationTool, scrollToPage, sampleCanvasPageRect } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const REPORT = path.join(SHOTS, 'def254-255-retest.json');
fs.mkdirSync(SHOTS, { recursive: true });
const report = {};
const log = (l, o) => console.log(`[DEF254/255] ${l} ${JSON.stringify(o)}`);

async function launch() {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  return { app, win };
}

async function openReport(win, app) {
  await openSamplePath(win, app, getSamplePath('report.pdf'));
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

async function annModels(win) {
  return win.evaluate(() => {
    const st = window.tflexDiagnostics().engineState;
    if (!st || !st.annotations) return [];
    return st.annotations.map((a) => ({
      id: a.id, kind: a.kind, page: a.page, text: a.text ?? a.content ?? null, style: a.style ?? null,
    }));
  });
}

async function waitForAnn(win, text, pred, timeout = 15000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    const a = (await annModels(win)).find((x) => x.text === text) ?? null;
    last = a;
    if (a && (pred ? pred(a) : true)) return a;
    await win.waitForTimeout(150);
  }
  return last;
}

async function saveAs(app, win, savePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click('[data-toolbar-save-as]');
  await win.waitForSelector('[data-save-as-confirm]', { timeout: 8000 });
  await win.click('[data-save-as-confirm]');
  await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 30000 });
  expect(fs.existsSync(savePath), 'saved PDF must exist on disk').toBe(true);
}

async function closeAndReopen(app, win, savePath) {
  await win.locator('.tab-active .tab-close').click();
  await win.waitForTimeout(1500);
  await openSamplePath(win, app, savePath);
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(2000);
}

async function clickAnn(win, sel) {
  const loc = win.locator(sel).first();
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const box = await loc.boundingBox();
  await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await win.waitForTimeout(900);
}

function redPixels(sample) {
  if (!sample || !sample.topColors) return 0;
  return sample.topColors
    .filter((c) => c.rgb[0] > 140 && c.rgb[1] < 90 && c.rgb[2] < 90)
    .reduce((n, c) => n + c.n, 0);
}

async function annRectRel(win, sel, pageNo = 1) {
  return win.evaluate(({ s, want }) => {
    const page = document.querySelector(`.pdf-page[data-page="${want}"]`);
    const box = document.querySelector(s);
    if (!page || !box) return null;
    const pb = page.getBoundingClientRect();
    const bb = box.getBoundingClientRect();
    return { x: bb.left - pb.left, y: bb.top - pb.top, w: bb.width, h: bb.height };
  }, { s: sel, want: pageNo });
}

// ===========================================================================
// A. DEF-254 — page-4 annotation selection survives a neighbouring page mount
// ===========================================================================
test('DEF-254 page-4 annotation stays selected across a neighbour mount + blank click deselects', async () => {
  test.setTimeout(180000);
  const legacySrc = path.resolve(__dirname, '..', '..', 'test-fixtures', 'annot-text-roundtrip-1727.pdf');
  expect(fs.existsSync(legacySrc), 'pre-Phase-24 fixture present').toBe(true);
  const legacyPath = path.join(os.tmpdir(), `def254-legacy-${Date.now()}.pdf`);
  fs.copyFileSync(legacySrc, legacyPath);

  const { app, win } = await launch();
  try {
    await openSamplePath(win, app, legacyPath);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(1500);
    await scrollToPage(win, 4);
    await win.waitForSelector('.pdf-page[data-page="4"]', { timeout: 15000 });
    await win.waitForTimeout(800);

    const sel = '.pdf-page[data-page="4"] .ann-textbox[data-kind="textbox"]';
    const loc = win.locator(sel).first();
    const box = await loc.boundingBox();
    expect(box, 'page-4 textbox overlay is present').not.toBeNull();

    // rAF probe across a REAL mouse click: sample panel + active + mounted layer pages.
    await win.evaluate(() => {
      window.__def254 = [];
      const t0 = performance.now();
      const tick = () => {
        window.__def254.push({
          t: Math.round(performance.now() - t0),
          panel: !!document.querySelector('.text-props-panel'),
          active: !!document.querySelector('.annotation-layer-active'),
          layerPages: [...document.querySelectorAll('.annotation-layer')].map((l) => l.getAttribute('data-annotation-layer')).sort(),
        });
        if (performance.now() - t0 < 1600) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await win.waitForTimeout(1800);
    const timeline = await win.evaluate(() => window.__def254);

    const opened = timeline.findIndex((f) => f.panel);
    const panelFalseAfterOpen = opened === -1 ? -1 : timeline.slice(opened).filter((f) => !f.panel).length;
    const firstLayers = JSON.stringify(timeline[0]?.layerPages ?? []);
    const mountChanged = timeline.some((f) => JSON.stringify(f.layerPages) !== firstLayers);
    const transitions = timeline.filter((f, i, a) => i === 0 || f.panel !== a[i - 1].panel || f.active !== a[i - 1].active);
    const state = await win.evaluate(() => ({
      panel: !!document.querySelector('.text-props-panel'),
      active: !!document.querySelector('.annotation-layer-active'),
      mode: document.querySelector('[data-text-panel]')?.getAttribute('data-text-panel-mode') ?? null,
      activePages: [...document.querySelectorAll('.annotation-layer-active')].map((l) => l.getAttribute('data-annotation-layer')),
    }));
    log('DEF-254-probe', { frames: timeline.length, openedAt: opened, panelFalseAfterOpen, mountChanged, firstLayers, transitions, state });
    report.def254 = { frames: timeline.length, openedAt: opened, panelFalseAfterOpen, mountChanged, transitions, state };
    await win.screenshot({ path: path.join(SHOTS, 'def254-255-retest.png') }).catch(() => {});

    expect(opened, 'the panel opened on the page-4 click').toBeGreaterThanOrEqual(0);
    expect(panelFalseAfterOpen, '0 panel=false frames after the panel opened').toBe(0);
    expect(state.panel, 'panel still open after the probe').toBe(true);
    expect(state.active, 'page-4 annotation layer still active').toBe(true);
    expect(state.mode, 'panel in annotation mode').toBe('annotation');
    expect(mountChanged, 'a neighbouring page mounted/unmounted during the probe (the DEF-254 condition)').toBe(true);

    // Blank click on the SAME page must still deselect and close the panel.
    const pg = await win.locator('.pdf-page[data-page="4"]').boundingBox();
    const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const bx = Math.min(Math.max(pg.x + pg.width * 0.12, 20), vp.w - 20);
    const by = Math.min(Math.max(pg.y + pg.height * 0.88, 20), vp.h - 20);
    const hit = await win.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return { tag: el && el.tagName, cls: el && String(el.className).slice(0, 60), inPage4: !!(el && el.closest && el.closest('.pdf-page[data-page="4"]')) };
    }, { x: bx, y: by });
    log('DEF-254-blank-hit', hit);
    await win.mouse.click(bx, by);
    await win.waitForTimeout(800);
    const afterBlank = await win.evaluate(() => ({
      panel: !!document.querySelector('.text-props-panel'),
      active: !!document.querySelector('.annotation-layer-active'),
    }));
    log('DEF-254-after-blank', afterBlank);
    report.def254Blank = { hit, afterBlank };
    expect(afterBlank.panel, 'blank click on page 4 closes the panel').toBe(false);
    expect(afterBlank.active, 'blank click on page 4 deselects the annotation').toBe(false);
  } finally {
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    await hardClose(app, 'def254');
  }
});

// ===========================================================================
// B. DEF-255 — cleared highlight + deleted annotation survive save/reopen
// ===========================================================================
test('DEF-255 cleared highlight + deleted annotation survive save + close + reopen', async () => {
  test.setTimeout(360000);
  const { app, win } = await launch();
  try {
    await openReport(win, app);
    await placeTextbox(win, 'DEF255-HL', 0.3, 0.25);
    await win.locator('[data-txt-highlight]').fill('#ff0000');
    const set = await waitForAnn(win, 'DEF255-HL', (a) => a.style && a.style.highlight && a.style.highlight.r === 1 && a.style.highlight.g === 0);
    log('DEF-255-set', set && set.style);
    expect(set && set.style && set.style.highlight, 'red highlight stored before save').toEqual({ r: 1, g: 0, b: 0 });

    const p1 = path.join(os.tmpdir(), `def255-set-${Date.now()}.pdf`);
    await saveAs(app, win, p1);
    await closeAndReopen(app, win, p1);
    const reopened1 = (await annModels(win)).filter((a) => a.text === 'DEF255-HL');
    const domCount1 = await win.evaluate(() => document.querySelectorAll('.ann-textbox[data-kind="textbox"]').length);
    log('DEF-255-reopen1', { count: reopened1.length, domCount: domCount1, style: reopened1[0] && reopened1[0].style });
    report.def255Reopen1 = { count: reopened1.length, domCount: domCount1, style: reopened1[0] && reopened1[0].style };
    expect(reopened1.length, 'exactly one annotation after the first reopen').toBe(1);
    expect(domCount1, 'exactly one textbox overlay visible after the first reopen').toBe(1);
    expect(reopened1[0].style && reopened1[0].style.highlight, 'red highlight persisted through save/reopen').toEqual({ r: 1, g: 0, b: 0 });
    const rel1 = await annRectRel(win, '.ann-textbox[data-kind="textbox"]', 1);
    const s1 = await sampleCanvasPageRect(win, rel1, 1);
    const red1 = redPixels(s1);
    log('DEF-255-red1', { rel1, red: red1 });
    expect(red1, 'a red band is painted on the reopened canvas').toBeGreaterThan(0);
    await win.screenshot({ path: path.join(SHOTS, 'def255-retest-set.png') }).catch(() => {});

    // Select the reopened annotation, clear the highlight, save again.
    await clickAnn(win, '.ann-textbox[data-kind="textbox"]');
    const panelOpen = await win.evaluate(() => !!document.querySelector('.text-props-panel'));
    expect(panelOpen, 'the reopened annotation opens the panel for the clear').toBe(true);
    await win.click('[data-txt-highlight-clear]');
    const cleared = await waitForAnn(win, 'DEF255-HL', (a) => !a.style || !a.style.highlight);
    log('DEF-255-cleared', cleared && cleared.style);
    expect(cleared && cleared.style ? (cleared.style.highlight ?? null) : null, 'highlight cleared in the live model').toBeNull();

    const p2 = path.join(os.tmpdir(), `def255-clear-${Date.now()}.pdf`);
    await saveAs(app, win, p2);
    await closeAndReopen(app, win, p2);
    const reopened2 = (await annModels(win)).filter((a) => a.text === 'DEF255-HL');
    const domCount2 = await win.evaluate(() => document.querySelectorAll('.ann-textbox[data-kind="textbox"]').length);
    const hl2 = reopened2[0] ? (reopened2[0].style ? (reopened2[0].style.highlight ?? null) : null) : 'MISSING';
    log('DEF-255-reopen2', { count: reopened2.length, domCount: domCount2, highlight: hl2, style: reopened2[0] && reopened2[0].style });
    report.def255Reopen2 = { count: reopened2.length, domCount: domCount2, highlight: hl2, style: reopened2[0] && reopened2[0].style };
    expect(reopened2.length, 'exactly one annotation after the cleared reopen').toBe(1);
    expect(domCount2, 'exactly one textbox overlay visible after the cleared reopen').toBe(1);
    expect(hl2, 'highlight is strictly null after the cleared save/reopen').toBeNull();
    const rel2 = await annRectRel(win, '.ann-textbox[data-kind="textbox"]', 1);
    const s2 = await sampleCanvasPageRect(win, rel2, 1);
    const red2 = redPixels(s2);
    log('DEF-255-red2', { rel2, red: red2 });
    expect(red2, 'no red band is painted after the cleared save/reopen').toBe(0);
    await win.screenshot({ path: path.join(SHOTS, 'def255-retest-cleared.png') }).catch(() => {});

    // Delete the annotation, save, reopen: it must be gone from the file.
    await clickAnn(win, '.ann-textbox[data-kind="textbox"]');
    await win.waitForSelector('[data-content-action="ann-textbox-delete"]', { timeout: 8000 });
    await win.click('[data-content-action="ann-textbox-delete"]');
    await win.waitForTimeout(800);
    const afterDelete = (await annModels(win)).filter((a) => a.text === 'DEF255-HL');
    log('DEF-255-after-delete', { count: afterDelete.length });
    expect(afterDelete.length, 'the annotation is removed from the live model').toBe(0);

    const p3 = path.join(os.tmpdir(), `def255-delete-${Date.now()}.pdf`);
    await saveAs(app, win, p3);
    await closeAndReopen(app, win, p3);
    const reopened3 = (await annModels(win)).filter((a) => a.text === 'DEF255-HL');
    const domCount3 = await win.evaluate(() => document.querySelectorAll('.ann-textbox[data-kind="textbox"]').length);
    log('DEF-255-reopen3', { count: reopened3.length, domCount: domCount3 });
    report.def255Reopen3 = { count: reopened3.length, domCount: domCount3 };
    expect(reopened3.length, 'the deleted annotation is gone from the saved file').toBe(0);
    expect(domCount3, 'no textbox overlay visible after the deleted save/reopen').toBe(0);
  } finally {
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    await hardClose(app, 'def255');
  }
});
