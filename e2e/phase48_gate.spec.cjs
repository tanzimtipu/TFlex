// Phase 48 gate - independent QA verification.
//
//   Item 1: signature hard-delete + convergence. Verified by reading the
//           DEFECTS/notes + the code + the Phase-48 unit tests, plus a
//           READ-ONLY count of the operator's table (no writes).
//   Item 3: every annotation control bar stays inside the page at the edges
//           and at different zoom levels, and stays clickable.
//   Item 4: the comment box opens on SELECTION, not on creation, for text,
//           comment/note, and rectangle.
//
// Drives the real Electron app through the canonical launcher only.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, armAnnotationTool, armSignTool } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const log = (label, obj) => console.log(`[P48] ${label} ${JSON.stringify(obj)}`);
const shot = (win, name) => win.screenshot({ path: path.join(SHOTS, name) }).catch(() => {});

async function openReport(app, win) {
  const p = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(700);
}

async function zoomPercent(win) {
  return win.evaluate(() => {
    const el = document.querySelector('.zoom-percent');
    return el ? Number.parseInt(el.textContent, 10) : null;
  });
}

// Step the visible zoom ladder until the pill reads `want` (100 is on the
// ladder). Fails loud rather than measuring at the wrong zoom.
async function setZoomExactly(win, want) {
  for (let i = 0; i < 25; i += 1) {
    const pct = await zoomPercent(win);
    if (pct === want) return pct;
    const label = pct !== null && pct > want ? 'Zoom out' : 'Zoom in';
    await win.locator(`[data-zoom-pill] button[aria-label="${label}"]`).first().click({ timeout: 5000 });
    await win.waitForTimeout(220);
  }
  throw new Error(`could not reach ${want}% zoom (stuck at ${await zoomPercent(win)}%)`);
}

async function pageBox(win) {
  return win.locator('.pdf-page[data-page="1"]').boundingBox();
}

async function dragClient(win, x1, y1, x2, y2) {
  await win.mouse.move(x1, y1);
  await win.mouse.down();
  await win.mouse.move(x2, y2, { steps: 8 });
  await win.mouse.up();
}

// Scroll page 1 so its bottom edge sits `clearance` px above the scroller's
// bottom, keeping the whole page-bottom band (and any flipped-up bar) on screen.
async function scrollPageBottom(win, clearance = 150) {
  await win.evaluate((gap) => {
    const sc = document.querySelector('.document-scroller');
    const page = document.querySelector('.pdf-page[data-page="1"]');
    if (sc && page) sc.scrollTop = page.offsetTop + page.offsetHeight - sc.clientHeight + gap;
  }, clearance);
  await win.waitForTimeout(500);
}

// Measure a bar: its page-relative box, whether it is inside the page, and
// whether the named action button actually receives the pointer.
async function barGeometry(win, barSel, btnSel) {
  return win.evaluate(({ barSel, btnSel }) => {
    const bar = document.querySelector(barSel);
    if (!bar) return { found: false };
    const page = document.querySelector('.pdf-page[data-page="1"]');
    const pr = page.getBoundingClientRect();
    const r = bar.getBoundingClientRect();
    const rel = {
      left: +(r.left - pr.left).toFixed(1),
      top: +(r.top - pr.top).toFixed(1),
      right: +(r.right - pr.left).toFixed(1),
      bottom: +(r.bottom - pr.top).toFixed(1),
    };
    const btn = btnSel ? document.querySelector(btnSel) : null;
    let hit = null;
    if (btn) {
      const br = btn.getBoundingClientRect();
      const cx = br.left + br.width / 2;
      const cy = br.top + br.height / 2;
      const el = document.elementFromPoint(cx, cy);
      hit = {
        cx: +cx.toFixed(1),
        cy: +cy.toFixed(1),
        inWindow: cx >= 0 && cy >= 0 && cx <= window.innerWidth && cy <= window.innerHeight,
        resolved: el !== null && (el === btn || btn.contains(el)),
        resolvedTag: el
          ? `${el.tagName}|${typeof el.className === 'string' ? el.className : ''}`
          : null,
      };
    }
    const cb = document.querySelector('[data-ann-comment-box]');
    const cbRect = cb ? cb.getBoundingClientRect() : null;
    return {
      found: true,
      page: { w: +pr.width.toFixed(1), h: +pr.height.toFixed(1) },
      bar: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      rel,
      insidePage:
        rel.left >= -1.5 && rel.top >= -1.5 && rel.right <= pr.width + 1.5 && rel.bottom <= pr.height + 1.5,
      commentBox: cbRect
        ? { x: +cbRect.x.toFixed(1), y: +cbRect.y.toFixed(1), w: +cbRect.width.toFixed(1), h: +cbRect.height.toFixed(1) }
        : null,
      hit,
    };
  }, { barSel, btnSel });
}

// Soft-check one bar: record every failure (position OR clickability) instead
// of throwing, so the whole sweep runs and lists ALL offenders at the end.
function collectOffender(m, label, offenders) {
  log(`${label}-measure`, m);
  const fails = [];
  if (!m.found) {
    fails.push('bar not found');
  } else {
    if (m.rel.left < -1.5) fails.push('left edge outside the page');
    if (m.rel.top < -1.5) fails.push('top edge outside the page');
    if (m.rel.right > m.page.w + 1.5) fails.push('right edge outside the page');
    if (m.rel.bottom > m.page.h + 1.5) fails.push('bottom edge outside the page');
    if (!m.hit.inWindow) fails.push('button outside the window');
    if (!m.hit.resolved) fails.push(`button blocked by ${m.hit.resolvedTag}`);
  }
  if (fails.length > 0) offenders.push({ label, fails, m });
}

// Disarm any armed creation tool (Escape) and clear the selection so the
// comment box closes before the next placement gesture (otherwise the box
// intercepts the drag start at the page's bottom edge).
async function clearSelection(win) {
  await win.keyboard.press('Escape');
  await win.waitForTimeout(250);
  const pg = await pageBox(win);
  await win.mouse.click(pg.x + pg.width * 0.1, pg.y + pg.height * 0.5);
  await win.waitForTimeout(350);
}

// ===========================================================================
// Item 3 - annotation control bars stay inside the page at the edges.
// ===========================================================================

test('P48 item 3 - annotation bars clamp inside the page at edges + zoom', async () => {
  test.setTimeout(420000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    const z = await setZoomExactly(win, 100);
    log('zoom-engineered', { zoom: z });
    const rows = [];
    const offenders = [];

    // ---- operator case: rectangle at the page's bottom edge (100%) ----
    await scrollPageBottom(win);
    await armAnnotationTool(win, 'rect');
    let pg = await pageBox(win);
    await dragClient(win, pg.x + pg.width * 0.3, pg.y + pg.height - 100,
      pg.x + pg.width * 0.55, pg.y + pg.height - 3);
    await win.waitForSelector('.ann-shape[data-kind="rect"]', { timeout: 10000 });
    await win.waitForTimeout(500);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    let bb = await win.locator('.ann-shape[data-kind="rect"]').first().boundingBox();
    await win.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.waitForSelector('[data-content-action-bar="ann-rect"]', { timeout: 8000 });
    await win.waitForTimeout(500);
    let m = await barGeometry(win, '[data-content-action-bar="ann-rect"]', '[data-content-action="ann-rect-delete"]');
    rows.push({ label: 'rect-bottom-100', ...m });
    await shot(win, 'phase48-gate-rect-bottom.png');
    collectOffender(m, 'rect-bottom-100', offenders);

    // Independent proof the control is really usable: a real mouse click at
    // the Delete button's centre must delete the annotation (the acceptance
    // for DEF-366 - the bar's controls are hit-testable and functional).
    const beforeClick = await win.locator('.ann-shape[data-kind="rect"]').count();
    await win.mouse.click(m.hit.cx, m.hit.cy);
    await win.waitForTimeout(800);
    const afterClick = await win.locator('.ann-shape[data-kind="rect"]').count();
    log('rect-bottom-100-real-click', { beforeClick, afterClick, hit: m.hit });
    expect(afterClick, 'real Delete click at the button centre deletes the annotation').toBe(beforeClick - 1);

    // ---- corner case: rectangle at the bottom-right corner (100%) ----
    await clearSelection(win);
    await scrollPageBottom(win);
    await armAnnotationTool(win, 'rect');
    pg = await pageBox(win);
    await dragClient(win, pg.x + pg.width - 130, pg.y + pg.height - 90,
      pg.x + pg.width - 3, pg.y + pg.height - 3);
    await win.waitForTimeout(600);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    // The real-click proof above DELETED the first rectangle, so the corner
    // rectangle is now the only one on the page.
    bb = await win.locator('.ann-shape[data-kind="rect"]').first().boundingBox();
    await win.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.waitForSelector('[data-content-action-bar="ann-rect"]', { timeout: 8000 });
    await win.waitForTimeout(500);
    m = await barGeometry(win, '[data-content-action-bar="ann-rect"]', '[data-content-action="ann-rect-delete"]');
    rows.push({ label: 'rect-corner-100', ...m });
    collectOffender(m, 'rect-corner-100', offenders);

    // ---- ellipse at the bottom edge (100%) ----
    await clearSelection(win);
    await scrollPageBottom(win);
    log('pre-ellipse', await win.evaluate(() => ({
      tool: window.tflexDiagnostics().activeTool,
      boxes: document.querySelectorAll('[data-ann-comment-box]').length,
      visible: document.querySelectorAll('[data-ann-tools-visible]').length,
      flyout: document.querySelectorAll('[data-annotation-flyout]').length,
    })));
    await armAnnotationTool(win, 'ellipse');
    log('ellipse-armed', { tool: await win.evaluate(() => window.tflexDiagnostics().activeTool) });
    pg = await pageBox(win);
    await dragClient(win, pg.x + pg.width * 0.06, pg.y + pg.height - 100,
      pg.x + pg.width * 0.24, pg.y + pg.height - 3);
    await win.waitForTimeout(900);
    log('ellipse-after-drag', await win.evaluate(() => ({
      tool: window.tflexDiagnostics().activeTool,
      kinds: (window.tflexDiagnostics().engineState.annotations || []).map((a) => a.kind),
    })));
    await win.waitForSelector('.ann-shape[data-kind="ellipse"]', { timeout: 6000 });
    await win.waitForTimeout(500);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    bb = await win.locator('.ann-shape[data-kind="ellipse"]').first().boundingBox();
    await win.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.waitForSelector('[data-content-action-bar="ann-ellipse"]', { timeout: 8000 });
    await win.waitForTimeout(500);
    m = await barGeometry(win, '[data-content-action-bar="ann-ellipse"]', '[data-content-action="ann-ellipse-delete"]');
    rows.push({ label: 'ellipse-bottom-100', ...m });
    collectOffender(m, 'ellipse-bottom-100', offenders);

    // ---- note/comment at the bottom edge (100%) ----
    await clearSelection(win);
    await scrollPageBottom(win);
    await armAnnotationTool(win, 'note');
    pg = await pageBox(win);
    await win.mouse.click(pg.x + pg.width * 0.65, pg.y + pg.height - 3);
    await win.waitForSelector('.ann-note', { timeout: 10000 });
    await win.waitForTimeout(600);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    bb = await win.locator('.ann-note').first().boundingBox();
    await win.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.waitForSelector('[data-content-action-bar="ann-note"]', { timeout: 8000 });
    await win.waitForTimeout(500);
    m = await barGeometry(win, '[data-content-action-bar="ann-note"]', '[data-content-action="ann-note-delete"]');
    rows.push({ label: 'note-bottom-100', ...m });
    collectOffender(m, 'note-bottom-100', offenders);

    // ---- rectangle at the bottom edge at a non-100% zoom (110%) ----
    await clearSelection(win);
    const z2 = await setZoomExactly(win, 110);
    log('zoom-engineered-2', { zoom: z2 });
    await scrollPageBottom(win);
    bb = await win.locator('.ann-shape[data-kind="rect"]').first().boundingBox();
    await win.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.waitForSelector('[data-content-action-bar="ann-rect"]', { timeout: 8000 });
    await win.waitForTimeout(500);
    m = await barGeometry(win, '[data-content-action-bar="ann-rect"]', '[data-content-action="ann-rect-delete"]');
    rows.push({ label: 'rect-bottom-110', ...m });
    collectOffender(m, 'rect-bottom-110', offenders);

    log('item3-rows', rows);
    expect(offenders, 'zero out-of-view / unclickable annotation controls').toEqual([]);
  } finally {
    await hardClose(app, 'p48-item3');
  }
});

// ===========================================================================
// Item 3 - the signature bar (named offender) at the page's right/bottom corner.
// ===========================================================================

test('P48 item 3 - signature bar clamps inside the page at the right/bottom corner', async () => {
  test.setTimeout(360000);
  const app = await launchApp();
  const win = await app.firstWindow();
  const offenders = [];
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await setZoomExactly(win, 100);
    await scrollPageBottom(win, 170);

    // Create a typed signature, then arm placement.
    await armSignTool(win);
    await win.click('.sig-tab:has-text("Type")');
    await win.fill('input[aria-label="Type your signature"]', 'QA P48');
    await win.click('.sig-tab-actions button:has-text("Save")');
    await win.waitForSelector('.sig-saved-pick', { timeout: 8000 });
    await win.click('.sig-saved-pick');
    await win.waitForTimeout(300);

    // Place the pending signature hard against the page's bottom-right corner.
    const pg = await pageBox(win);
    await win.mouse.click(pg.x + pg.width - 12, pg.y + pg.height - 12);
    await win.waitForSelector('[data-sig-action-bar]', { timeout: 10000 });
    await win.waitForTimeout(600);
    let m = await barGeometry(win, '[data-sig-action-bar]', '[data-sig-action="delete"]');
    log('sig-pending-corner', m);
    await shot(win, 'phase48-gate-signature-right.png');
    collectOffender(m, 'sig-pending-corner', offenders);

    // Commit, then select the committed placement: its bar must clamp too.
    await win.click('[data-sig-action="confirm"]');
    await win.waitForTimeout(1400);
    const placement = win.locator('.sig-placement').first();
    const pb = await placement.boundingBox();
    await win.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await win.waitForSelector('[data-sig-action-bar]', { timeout: 8000 });
    await win.waitForTimeout(600);
    m = await barGeometry(win, '[data-sig-action-bar]', '[data-sig-action="delete"]');
    log('sig-selected-corner', m);
    collectOffender(m, 'sig-selected-corner', offenders);
    expect(offenders, 'zero out-of-view / unclickable signature controls').toEqual([]);
  } finally {
    await hardClose(app, 'p48-item3-sig');
  }
});

// ===========================================================================
// Item 4 - the comment box opens on SELECTION, not on creation.
// ===========================================================================

test('P48 item 4 - comment box opens on selection, not creation (text, note, rect)', async () => {
  test.setTimeout(420000);
  const app = await launchApp();
  const win = await app.firstWindow();
  const boxCount = () => win.locator('[data-ann-comment-box]').count();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await setZoomExactly(win, 100);
    await win.evaluate(() => {
      const sc = document.querySelector('.document-scroller');
      if (sc) sc.scrollTop = 0;
    });
    await win.waitForTimeout(400);
    const pg = await pageBox(win);

    // ---- TEXT (textbox): creation must NOT open the comment box ----
    await armAnnotationTool(win, 'textbox');
    await dragClient(win, pg.x + pg.width * 0.28, pg.y + pg.height * 0.3,
      pg.x + pg.width * 0.55, pg.y + pg.height * 0.4);
    await win.waitForSelector('.ann-textbox[data-annotation-id]', { timeout: 10000 });
    await win.waitForTimeout(900);
    const textBar = await win.locator('[data-content-action-bar="ann-textbox"]').count();
    const textBoxOnCreate = await boxCount();
    await shot(win, 'phase48-gate-text-create.png');
    log('item4-text-create', { textBar, textBoxOnCreate });
    expect(textBoxOnCreate, 'text: no comment box on creation').toBe(0);
    expect(textBar, 'text: the normal action bar appears on creation').toBeGreaterThan(0);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);
    let sbb = await win.locator('.ann-textbox[data-annotation-id]').first().boundingBox();
    await win.mouse.click(sbb.x + sbb.width / 2, sbb.y + sbb.height / 2);
    await win.locator('[data-ann-comment-box]').first().waitFor({ state: 'visible', timeout: 8000 });
    const textBoxOnSelect = await boxCount();
    log('item4-text-select', { textBoxOnSelect });
    expect(textBoxOnSelect, 'text: comment box opens on selection').toBeGreaterThan(0);

    // ---- COMMENT (note): creation must NOT open the comment box ----
    await win.keyboard.press('Escape');
    await win.mouse.click(pg.x + 30, pg.y + 30);
    await win.waitForTimeout(400);
    await armAnnotationTool(win, 'note');
    await win.mouse.click(pg.x + pg.width * 0.5, pg.y + pg.height * 0.55);
    await win.waitForSelector('.ann-note', { timeout: 10000 });
    await win.waitForTimeout(900);
    const noteBar = await win.locator('[data-content-action-bar="ann-note"]').count();
    const noteBoxOnCreate = await boxCount();
    log('item4-note-create', { noteBar, noteBoxOnCreate });
    expect(noteBoxOnCreate, 'note: no comment box on creation').toBe(0);
    expect(noteBar, 'note: the normal action bar appears on creation').toBeGreaterThan(0);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    sbb = await win.locator('.ann-note').first().boundingBox();
    await win.mouse.click(sbb.x + sbb.width / 2, sbb.y + sbb.height / 2);
    await win.locator('[data-ann-comment-box]').first().waitFor({ state: 'visible', timeout: 8000 });
    const noteBoxOnSelect = await boxCount();
    log('item4-note-select', { noteBoxOnSelect });
    expect(noteBoxOnSelect, 'note: comment box opens on selection').toBeGreaterThan(0);
    await shot(win, 'phase48-gate-comment-selected.png');

    // ---- RECTANGLE: unchanged behaviour ----
    await win.keyboard.press('Escape');
    await win.mouse.click(pg.x + 40, pg.y + 40);
    await win.waitForTimeout(400);
    await armAnnotationTool(win, 'rect');
    await dragClient(win, pg.x + pg.width * 0.55, pg.y + pg.height * 0.4,
      pg.x + pg.width * 0.78, pg.y + pg.height * 0.5);
    await win.waitForSelector('.ann-shape[data-kind="rect"]', { timeout: 10000 });
    await win.waitForTimeout(700);
    const rectBoxOnCreate = await boxCount();
    log('item4-rect-create', { rectBoxOnCreate });
    expect(rectBoxOnCreate, 'rect: no comment box on creation (unchanged)').toBe(0);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
    sbb = await win.locator('.ann-shape[data-kind="rect"]').first().boundingBox();
    await win.mouse.click(sbb.x + sbb.width / 2, sbb.y + sbb.height / 2);
    await win.waitForSelector('[data-content-action-bar="ann-rect"]', { timeout: 8000 });
    await win.locator('[data-ann-comment-box]').first().waitFor({ state: 'visible', timeout: 8000 });
    const rectBoxOnSelect = await boxCount();
    log('item4-rect-select', { rectBoxOnSelect });
    expect(rectBoxOnSelect, 'rect: comment box opens on selection').toBeGreaterThan(0);
  } finally {
    await hardClose(app, 'p48-item4');
  }
});
