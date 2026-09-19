// Phase 21 QA validation — text properties panel (Word/Adobe-style text
// manipulation replacing the floating toolbox).
//
// Measures the running Electron app (canonical launcher only) against the
// phase's seven success criteria:
//   C1 open/close + page reflow in lockstep, all three themes
//   C2 full control list, per-control live change + save/reopen round-trip
//      (font / character style / colour+highlight / paragraph groups)
//   C3 no floating style toolbox on any text-bearing path
//   C4 one panel serves every text-bearing tool and re-targets; annotation
//      mode colour-live, per-family disabled set retired (Phase 24)
//   C5 undo/redo restores text AND the panel's reflected state
//   C7 reduced motion collapses the panel path with no structural change
//
// Screenshots: screenshots/phase21-*.png
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, armAnnotationTool, openSamplePath } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const log = (label, obj) => console.log(`[P21] ${label} ${JSON.stringify(obj)}`);
const THEMES = ['light', 'dark', 'frosted'];
// Contract text — REQUIREMENTS.md Phase 21, per-family scope.
const ANNOT_DISABLED_REASON =
  "not supported for annotations - the annotation's text is baked by the annotation engine";
// The 22 controls that must be disabled (colour is the only live one) in
// annotation mode: font(2) + character style(5) + highlight(2) + clear(1) +
// align(4) + line-height(1) + list(3) + indent(2) + spacing(2).
const ANNOT_DISABLED_SELECTORS = [
  '[data-txt-font]', '[data-txt-size]',
  '[data-txt-bold]', '[data-txt-italic]', '[data-txt-underline]',
  '[data-txt-super]', '[data-txt-sub]',
  '[data-txt-highlight]', '[data-txt-highlight-clear]', '[data-txt-clear]',
  '[data-txt-align-left]', '[data-txt-align-center]', '[data-txt-align-right]',
  '[data-txt-align-justify]',
  '[data-txt-line-height]',
  '[data-txt-list-none]', '[data-txt-list-bullet]', '[data-txt-list-number]',
  '[data-txt-indent-dec]', '[data-txt-indent-inc]',
  '[data-txt-character-spacing]', '[data-txt-horizontal-scaling]',
];

async function openReport(app, win) {
  const p = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(400);
}

async function setTheme(win, want) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${want}"]`);
  await win.waitForFunction(
    (w) => document.documentElement.getAttribute('data-theme') === w,
    want,
    { timeout: 5000 },
  );
  await win.waitForTimeout(350);
}

// ---------------------------------------------------------------------------
// In-page rAF probe: samples the panel width, its edges, the page-view
// (workspace-main) left inset and the rail's right edge every frame.
// ---------------------------------------------------------------------------
async function installProbe(win) {
  await win.evaluate(() => {
    window.__p21 = { rows: [], running: false };
    window.__p21Start = (ms) => {
      window.__p21 = { rows: [], running: true };
      const t0 = performance.now();
      const tick = () => {
        const t = Math.round(performance.now() - t0);
        const panel = document.querySelector('.text-props-panel');
        const main = document.querySelector('.workspace-main');
        const rail = document.querySelector('.side-rail');
        const pr = panel ? panel.getBoundingClientRect() : null;
        const mr = main ? main.getBoundingClientRect() : null;
        const rr = rail ? rail.getBoundingClientRect() : null;
        window.__p21.rows.push({
          t,
          panelW: pr ? +pr.width.toFixed(2) : 0,
          panelRight: pr ? +pr.right.toFixed(2) : null,
          panelLeft: pr ? +pr.left.toFixed(2) : null,
          mainLeft: mr ? +mr.left.toFixed(2) : null,
          railRight: rr ? +rr.right.toFixed(2) : null,
          tr: panel ? getComputedStyle(panel).transform : null,
          op: panel ? +getComputedStyle(panel).opacity : null,
        });
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else window.__p21.running = false;
      };
      requestAnimationFrame(tick);
    };
  });
}
async function startProbe(win, ms) {
  await win.evaluate((m) => window.__p21Start(m), ms);
}
async function readProbe(win) {
  await win.waitForFunction(() => window.__p21.running === false, null, { timeout: 8000 }).catch(() => {});
  return win.evaluate(() => window.__p21.rows);
}

// ---------------------------------------------------------------------------
// Engine text-box model read (the authoritative registry list).
// ---------------------------------------------------------------------------
async function boxModels(win) {
  return win.evaluate(() => {
    const st = window.tflexDiagnostics().engineState;
    if (!st || !st.textBoxes) return null;
    return st.textBoxes.map((b) => ({
      id: b.id, text: b.text, page: b.page,
      font: b.font, size: b.size, bold: b.bold, italic: b.italic,
      underline: b.underline, color: b.color,
      highlight: b.highlight ?? null, align: b.align, lineHeight: b.lineHeight,
      list: b.list, indent: b.indent,
    }));
  });
}
async function waitForBox(win, text, pred, timeout = 12000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    const boxes = (await boxModels(win)) || [];
    const b = boxes.find((x) => x.text === text);
    last = b;
    if (b && (pred ? pred(b) : true)) return b;
    await win.waitForTimeout(150);
  }
  return last;
}

// Create a committed TFlex text box through the real UI and select it.
async function createTextBox(win, text, fx = 0.22, fy = 0.18) {
  if ((await win.locator('[data-edit-toolbar]').count()) === 0) {
    await win.click('button[aria-label="Edit content"]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
  }
  await win.click('[data-edit-tool="box"]');
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 240));
  const y = Math.max(pg.y + 20, Math.min(pg.y + pg.height * fy, vp.h - 110));
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + 200, y + 70, { steps: 6 });
  await win.mouse.up();
  await win.waitForSelector('[data-edit-editor]', { timeout: 8000 });
  await win.locator('[data-edit-textarea]').fill(text);
  await win.click('[data-edit-confirm]');
  await win.waitForSelector('.edit-box', { timeout: 8000 });
  await win.waitForTimeout(400);
  await win.locator('.edit-box').first().click({ position: { x: 8, y: 8 } });
  await win.waitForSelector('[data-edit-box-toolbar]', { timeout: 8000 });
  await win.waitForTimeout(300);
}

/** Close Edit mode (annotation tools are gated while it is open). */
async function closeEditMode(win) {
  if ((await win.locator('[data-edit-toolbar]').count()) > 0) {
    await win.click('button[aria-label="Edit content"]');
    await win.waitForTimeout(400);
  }
}

// ===========================================================================
// C1 — open/close + page reflow in lockstep, all three themes.
// ===========================================================================
test('C1 open/close reflow lockstep in all three themes', async () => {
  test.setTimeout(200000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await installProbe(win);
    const results = [];
    for (const theme of THEMES) {
      await setTheme(win, theme);
      await armAnnotationTool(win, 'select');
      await win.waitForTimeout(400);
      const closed = await win.evaluate(() => ({
        panels: document.querySelectorAll('.text-props-panel').length,
        mainLeft: +document.querySelector('.workspace-main').getBoundingClientRect().left.toFixed(2),
      }));

      // OPEN: arm a text-bearing annotation tool.
      await startProbe(win, 800);
      await armAnnotationTool(win, 'textbox');
      const openRows = await readProbe(win);
      const openLive = openRows.filter((r) => r.panelW > 0);
      const openWidths = [...new Set(openLive.map((r) => Math.round(r.panelW)))];
      const lockDelta = Math.max(0, ...openLive.map((r) =>
        Math.abs((r.mainLeft - r.railRight) - r.panelW)));
      const overlap = openLive.filter((r) => r.panelRight > r.mainLeft + 1).length;
      const settled = openLive.length ? openLive[openLive.length - 1] : null;
      const clip = await win.evaluate(() => {
        const p = document.querySelector('.text-props-panel');
        const body = document.querySelector('.text-props-body');
        if (!p) return null;
        return {
          panelClipped: p.scrollWidth > p.clientWidth + 2,
          bodyClipped: body ? body.scrollWidth > body.clientWidth + 2 : false,
          controls: document.querySelectorAll('.text-props-panel [data-txt-font], .text-props-panel [data-txt-bold]').length,
        };
      });
      await win.screenshot({ path: path.join(SHOTS, `phase21-c1-open-${theme}.png`) }).catch(() => {});

      // CLOSE: deselect (select tool) — the panel slides out, page reflows back.
      await startProbe(win, 800);
      await armAnnotationTool(win, 'select');
      const closeRows = await readProbe(win);
      const closeLive = closeRows.filter((r) => r.panelW > 0);
      const closeWidths = [...new Set(closeLive.map((r) => Math.round(r.panelW)))];
      const after = await win.evaluate(() => ({
        panels: document.querySelectorAll('.text-props-panel').length,
        mainLeft: +document.querySelector('.workspace-main').getBoundingClientRect().left.toFixed(2),
      }));

      const r = {
        theme, closed, settled, openDistinctWidths: openWidths,
        lockstepMaxDelta: +lockDelta.toFixed(2), overlapFrames: overlap,
        clip, closeDistinctWidths: closeWidths, after,
      };
      results.push(r);
      log('C1', r);

      expect(settled, `${theme}: panel must reach an open width`).not.toBeNull();
      expect(settled.panelW, `${theme}: open panel width ~248px`).toBeGreaterThan(240);
      expect(openWidths.length, `${theme}: panel width interpolates (>=3 distinct widths)`).toBeGreaterThanOrEqual(3);
      expect(lockDelta, `${theme}: panel width and page inset move in lockstep`).toBeLessThanOrEqual(2);
      expect(overlap, `${theme}: panel never overlaps the page view`).toBe(0);
      expect(clip.panelClipped, `${theme}: open panel content not clipped`).toBe(false);
      expect(clip.bodyClipped, `${theme}: open panel body not clipped`).toBe(false);
      expect(clip.controls, `${theme}: panel controls are mounted`).toBeGreaterThan(0);
      expect(closeWidths.length, `${theme}: close interpolates (>=3 distinct widths)`).toBeGreaterThanOrEqual(3);
      expect(after.panels, `${theme}: panel unmounts on deselect`).toBe(0);
      expect(Math.abs(after.mainLeft - closed.mainLeft), `${theme}: page inset returns to the closed value`).toBeLessThanOrEqual(2);
    }
    log('C1-summary', results);
  } finally {
    await hardClose(app, 'p21-c1');
  }
});

// Read the panel's reflected control values.
async function panelState(win) {
  return win.evaluate(() => {
    const p = document.querySelector('.text-props-panel');
    const body = document.querySelector('[data-text-panel]');
    if (!p) return null;
    const q = (s) => p.querySelector(s);
    const pressed = (s) => q(s)?.getAttribute('aria-pressed') === 'true';
    return {
      mode: body ? body.getAttribute('data-text-panel-mode') : null,
      font: q('[data-txt-font]')?.value ?? null,
      size: q('[data-txt-size]')?.value ?? null,
      bold: pressed('[data-txt-bold]'),
      italic: pressed('[data-txt-italic]'),
      underline: pressed('[data-txt-underline]'),
      color: q('[data-txt-color]')?.value ?? null,
      highlight: q('[data-txt-highlight]')?.value ?? null,
      align: ['left', 'center', 'right', 'justify'].filter((a) => pressed(`[data-txt-align-${a}]`)),
      lineHeight: q('[data-txt-line-height]')?.value ?? null,
      list: ['none', 'bullet', 'number'].filter((l) => pressed(`[data-txt-list-${l}]`)),
      indent: q('[data-txt-indent-value]')?.textContent ?? null,
    };
  });
}

/** Poll the panel's reflected state (React mirror converges after the echo). */
async function waitForPanel(win, pred, timeout = 10000) {
  const t0 = Date.now();
  let s = null;
  while (Date.now() - t0 < timeout) {
    s = await panelState(win);
    if (s && pred(s)) return s;
    await win.waitForTimeout(150);
  }
  return s;
}

// ===========================================================================
// C2 — full control list: per-control live change + save/reopen round-trip.
// ===========================================================================
test('C2 per-control live change + save/reopen round-trip', async () => {
  test.setTimeout(300000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await createTextBox(win, 'P21-A', 0.2, 0.15);
    const rows = [];
    const mark = (control, live, rt, note) => rows.push({ control, live, roundTrip: rt, note });

    // -- FONT group ---------------------------------------------------------
    await win.locator('[data-txt-font]').selectOption('Times');
    let b = await waitForBox(win, 'P21-A', (x) => x.font === 'Times');
    let ps = await panelState(win);
    mark('font family', b.font === 'Times' && ps.font === 'Times', null, `engine=${b.font} panel=${ps.font}`);

    await win.locator('[data-txt-size]').fill('18');
    b = await waitForBox(win, 'P21-A', (x) => x.size === 18);
    ps = await panelState(win);
    mark('size', b.size === 18 && Number(ps.size) === 18, null, `engine=${b.size} panel=${ps.size}`);

    // -- CHARACTER STYLE group ---------------------------------------------
    await win.click('[data-txt-bold]');
    b = await waitForBox(win, 'P21-A', (x) => x.bold === true);
    ps = await panelState(win);
    mark('bold', b.bold === true && ps.bold === true, null, `engine=${b.bold} panel=${ps.bold}`);

    await win.click('[data-txt-italic]');
    b = await waitForBox(win, 'P21-A', (x) => x.italic === true);
    ps = await panelState(win);
    mark('italic', b.italic === true && ps.italic === true, null, `engine=${b.italic} panel=${ps.italic}`);

    await win.click('[data-txt-underline]');
    b = await waitForBox(win, 'P21-A', (x) => x.underline === true);
    ps = await panelState(win);
    mark('underline', b.underline === true && ps.underline === true, null, `engine=${b.underline} panel=${ps.underline}`);

    // -- COLOUR + HIGHLIGHT group ------------------------------------------
    await win.locator('[data-txt-color]').fill('#ff0000');
    b = await waitForBox(win, 'P21-A', (x) => x.color === '#ff0000');
    ps = await panelState(win);
    const mirrorColor = await win.evaluate(() => {
      const t = document.querySelector('.edit-box-text');
      return t ? getComputedStyle(t).color : null;
    });
    mark('colour', b.color === '#ff0000' && ps.color === '#ff0000' && mirrorColor === 'rgb(255, 0, 0)', null,
      `engine=${b.color} panel=${ps.color} mirror=${mirrorColor}`);

    await win.locator('[data-txt-highlight]').fill('#ffff00');
    b = await waitForBox(win, 'P21-A', (x) => x.highlight !== null);
    ps = await panelState(win);
    const hlA = b.highlight;
    mark('highlight (set)', hlA && hlA.r === 1 && hlA.g === 1 && hlA.b === 0, null,
      `engine=${JSON.stringify(hlA)} panel=${ps.highlight}`);

    // -- PARAGRAPH group ----------------------------------------------------
    const alignLive = {};
    for (const a of ['center', 'right', 'justify', 'left']) {
      await win.click(`[data-txt-align-${a}]`);
      b = await waitForBox(win, 'P21-A', (x) => x.align === a);
      ps = await panelState(win);
      alignLive[a] = b.align === a && ps.align.includes(a);
    }
    await win.click('[data-txt-align-center]');
    b = await waitForBox(win, 'P21-A', (x) => x.align === 'center');
    mark('alignment (all four)', Object.values(alignLive).every(Boolean), null, JSON.stringify(alignLive));

    await win.locator('[data-txt-line-height]').fill('1.8');
    b = await waitForBox(win, 'P21-A', (x) => x.lineHeight === 1.8);
    ps = await panelState(win);
    mark('line spacing', b.lineHeight === 1.8 && Number(ps.lineHeight) === 1.8, null,
      `engine=${b.lineHeight} panel=${ps.lineHeight}`);

    await win.click('[data-txt-list-bullet]');
    b = await waitForBox(win, 'P21-A', (x) => x.list === 'bullet');
    ps = await panelState(win);
    mark('list bullet', b.list === 'bullet' && ps.list.includes('bullet'), null, `engine=${b.list} panel=${ps.list}`);

    await win.click('[data-txt-indent-inc]');
    await win.click('[data-txt-indent-inc]');
    b = await waitForBox(win, 'P21-A', (x) => x.indent === 24);
    ps = await panelState(win);
    mark('indent', b.indent === 24 && ps.indent === '24', null, `engine=${b.indent} panel=${ps.indent}`);

    // -- second box: numbered list + highlight null-removal -----------------
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const x = Math.max(40, Math.min(pg.x + pg.width * 0.5, vp.w - 240));
    const y = Math.max(pg.y + 20, Math.min(pg.y + pg.height * 0.42, vp.h - 110));
    await win.mouse.move(x, y);
    await win.mouse.down();
    await win.mouse.move(x + 200, y + 70, { steps: 6 });
    await win.mouse.up();
    await win.waitForSelector('[data-edit-editor]', { timeout: 8000 });
    await win.locator('[data-edit-textarea]').fill('P21-B');
    await win.click('[data-edit-confirm]');
    await win.waitForSelector('.edit-box', { timeout: 8000 });
    await win.waitForTimeout(400);
    await win.locator('.edit-box').nth(1).click({ position: { x: 8, y: 8 } });
    await win.waitForTimeout(300);
    await win.click('[data-txt-list-number]');
    let bB = await waitForBox(win, 'P21-B', (x2) => x2.list === 'number');
    ps = await panelState(win);
    mark('list number', bB.list === 'number' && ps.list.includes('number'), null, `engine=${bB.list} panel=${ps.list}`);
    await win.locator('[data-txt-highlight]').fill('#ffff00');
    bB = await waitForBox(win, 'P21-B', (x2) => x2.highlight !== null);
    await win.click('[data-txt-highlight-clear]');
    bB = await waitForBox(win, 'P21-B', (x2) => x2.highlight === null);
    mark('highlight null-removal', bB.highlight === null, null, `engine.highlight=${JSON.stringify(bB.highlight)}`);

    // -- SAVE AS + reopen ---------------------------------------------------
    const savePath = path.join(os.tmpdir(), `p21-saved-${Date.now()}.pdf`);
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, savePath);
    await win.click('[data-toolbar-save-as]');
    await win.waitForSelector('[data-save-as-confirm]', { timeout: 8000 });
    await win.click('[data-save-as-confirm]');
    await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 30000 });
    expect(fs.existsSync(savePath), 'saved PDF must exist on disk').toBe(true);

    await win.locator('.tab-active .tab-close').click();
    await win.waitForTimeout(1500);
    await openSamplePath(win, app, savePath);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(2000);
    await waitForBox(win, 'P21-A', null, 20000);
    const reopened = (await boxModels(win)) || [];
    const a2 = reopened.find((x) => x.text === 'P21-A');
    const b2 = reopened.find((x) => x.text === 'P21-B');
    log('C2-reopened', { a2, b2 });

    const rt = {
      font: a2 && a2.font === 'Times',
      size: a2 && a2.size === 18,
      bold: a2 && a2.bold === true,
      italic: a2 && a2.italic === true,
      underline: a2 && a2.underline === true,
      color: a2 && a2.color === '#ff0000',
      highlight: a2 && a2.highlight && a2.highlight.r === 1 && a2.highlight.g === 1 && a2.highlight.b === 0,
      align: a2 && a2.align === 'center',
      lineHeight: a2 && a2.lineHeight === 1.8,
      listBullet: a2 && a2.list === 'bullet',
      indent: a2 && a2.indent === 24,
      listNumber: b2 && b2.list === 'number',
      highlightRemoved: b2 && b2.highlight === null,
    };
    const map = {
      'font family': 'font', size: 'size', bold: 'bold', italic: 'italic',
      underline: 'underline', colour: 'color', 'highlight (set)': 'highlight',
      'alignment (all four)': 'align', 'line spacing': 'lineHeight',
      'list bullet': 'listBullet', indent: 'indent', 'list number': 'listNumber',
      'highlight null-removal': 'highlightRemoved',
    };
    for (const r of rows) r.roundTrip = !!rt[map[r.control]];
    log('C2-table', rows);
    await win.screenshot({ path: path.join(SHOTS, 'phase21-c2-reopened.png') }).catch(() => {});
    for (const r of rows) {
      expect(r.live, `${r.control}: live change`).toBe(true);
      expect(r.roundTrip, `${r.control}: survives save+reopen`).toBe(true);
    }
  } finally {
    await hardClose(app, 'p21-c2');
  }
});

// ===========================================================================
// C3 — no floating style toolbox on any text-bearing path.
// ===========================================================================
const RETIRED_STYLE = '.edit-inline-field-font, .edit-inline-field-size, .edit-inline-field-color, .edit-inline-field-bg, [data-annotation-color-section]';

async function dragOnPage(win, fx, fy) {
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 200));
  const y = Math.max(pg.y + 20, Math.min(pg.y + pg.height * fy, vp.h - 100));
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + 160, y + 70, { steps: 6 });
  await win.mouse.up();
}

test('C3 no floating style toolbox; grip + Confirm/Cancel/Delete remain', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    const out = {};

    // -- text box path ------------------------------------------------------
    await win.click('button[aria-label="Edit content"]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
    await win.click('[data-edit-tool="box"]');
    await dragOnPage(win, 0.25, 0.2);
    await win.waitForSelector('[data-edit-editor]', { timeout: 8000 });
    out.textBox = await win.evaluate((ret) => ({
      retired: document.querySelectorAll(ret).length,
      grip: !!document.querySelector('[data-edit-drag-handle]'),
      confirm: !!document.querySelector('[data-edit-confirm]'),
      cancel: !!document.querySelector('[aria-label="Cancel edit"]'),
      del: !!document.querySelector('[data-edit-action="delete"]'),
    }), RETIRED_STYLE);
    await win.locator('[data-edit-textarea]').fill('P21-C3');
    await win.click('[data-edit-confirm]');
    await win.waitForTimeout(400);
    // Reopen the COMMITTED box's editor through the selection bar's Edit
    // action — that is the path that carries the Delete action.
    await win.locator('.edit-box').first().click({ position: { x: 8, y: 8 } });
    await win.waitForSelector('[data-edit-box-toolbar]', { timeout: 8000 });
    await win.click('[data-edit-box-action="edit"]');
    await win.waitForSelector('[data-edit-editor]', { timeout: 8000 });
    out.textBoxCommitted = await win.evaluate((ret) => ({
      retired: document.querySelectorAll(ret).length,
      grip: !!document.querySelector('[data-edit-drag-handle]'),
      confirm: !!document.querySelector('[data-edit-confirm]'),
      cancel: !!document.querySelector('[aria-label="Cancel edit"]'),
      del: !!document.querySelector('[data-edit-action="delete"]'),
    }), RETIRED_STYLE);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);

    // -- annotation textbox path -------------------------------------------
    await closeEditMode(win);
    await armAnnotationTool(win, 'textbox');
    await dragOnPage(win, 0.3, 0.3);
    await win.waitForSelector('[data-annotation-editor="textbox"]', { timeout: 8000 });
    out.annTextbox = await win.evaluate((ret) => ({
      retired: document.querySelectorAll(ret).length,
      grip: !!document.querySelector('[data-annotation-editor-handle="textbox"]'),
      confirm: !!document.querySelector('[data-annotation-action="textbox-confirm"]'),
      cancel: !!document.querySelector('[data-annotation-action="textbox-cancel"]'),
      del: !!document.querySelector('[data-annotation-action="textbox-delete"]'),
    }), RETIRED_STYLE);
    await win.click('[data-annotation-action="textbox-cancel"]');
    await win.waitForTimeout(400);

    // -- callout path -------------------------------------------------------
    await armAnnotationTool(win, 'callout');
    await dragOnPage(win, 0.3, 0.45);
    await win.waitForSelector('[data-annotation-editor="callout"]', { timeout: 8000 });
    out.callout = await win.evaluate((ret) => ({
      retired: document.querySelectorAll(ret).length,
      grip: !!document.querySelector('[data-annotation-editor-handle="callout"]'),
      confirm: !!document.querySelector('[data-annotation-action="callout-confirm"]'),
      cancel: !!document.querySelector('[data-annotation-action="callout-cancel"]'),
      del: !!document.querySelector('[data-annotation-action="callout-delete"]'),
    }), RETIRED_STYLE);
    await win.click('[data-annotation-action="callout-cancel"]');
    await win.waitForTimeout(400);

    // -- note path ----------------------------------------------------------
    await armAnnotationTool(win, 'note');
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.mouse.click(pg.x + pg.width * 0.5, pg.y + pg.height * 0.5);
    await win.waitForSelector('[data-annotation-editor="note"]', { timeout: 8000 });
    out.note = await win.evaluate((ret) => ({
      retired: document.querySelectorAll(ret).length,
      grip: !!document.querySelector('[data-drag-grip="note"]'),
      confirm: !!document.querySelector('[data-annotation-action="note-confirm"]'),
      cancel: !!document.querySelector('[data-annotation-action="note-cancel"]'),
      del: !!document.querySelector('[data-annotation-action="note-delete"]'),
    }), RETIRED_STYLE);
    await win.click('[data-annotation-action="note-cancel"]');
    await win.waitForTimeout(400);

    // -- edit-text-run path -------------------------------------------------
    await armAnnotationTool(win, 'select');
    await win.click('button[aria-label="Edit content"]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
    await win.click('[data-edit-tool="text"]');
    const span = win.locator('.pdf-page[data-page="1"] .textLayer span').filter({ hasText: /[A-Za-z]/ }).first();
    const sb = (await span.count()) ? await span.boundingBox() : null;
    if (sb) {
      await win.mouse.dblclick(sb.x + sb.width / 2, sb.y + sb.height / 2);
    } else {
      await dragOnPage(win, 0.3, 0.7);
      await win.mouse.dblclick(pg.x + pg.width * 0.3, pg.y + pg.height * 0.7);
    }
    const runEditor = await win.waitForSelector('[data-edit-editor]', { timeout: 8000 }).catch(() => null);
    out.editRun = await win.evaluate((ret) => ({
      opened: !!document.querySelector('[data-edit-editor]'),
      mode: document.querySelector('[data-edit-editor]')?.getAttribute('data-edit-editor') ?? null,
      panelMode: document.querySelector('[data-text-panel]')?.getAttribute('data-text-panel-mode') ?? null,
      retired: document.querySelectorAll(ret).length,
      grip: !!document.querySelector('[data-edit-drag-handle]'),
      confirm: !!document.querySelector('[data-edit-confirm]'),
      cancel: !!document.querySelector('[aria-label="Cancel edit"]'),
    }), RETIRED_STYLE);
    if (runEditor) await win.keyboard.press('Escape');

    log('C3', out);
    await win.screenshot({ path: path.join(SHOTS, 'phase21-c3-no-style-toolbox.png') }).catch(() => {});
    for (const [name, v] of Object.entries(out)) {
      expect(v.retired, `${name}: no floating style control mounts`).toBe(0);
      expect(v.grip, `${name}: drag grip present`).toBe(true);
      expect(v.confirm, `${name}: Confirm present`).toBe(true);
      expect(v.cancel, `${name}: Cancel present`).toBe(true);
    }
    expect(out.textBoxCommitted.del, 'text box (committed editor): Delete present').toBe(true);
    expect(out.textBoxCommitted.retired, 'text box (committed editor): no style control').toBe(0);
    expect(out.annTextbox.del, 'annotation textbox: Delete present').toBe(true);
    expect(out.callout.del, 'callout: Delete present').toBe(true);
    expect(out.note.del, 'note: Delete present').toBe(true);
    expect(out.editRun.opened, 'edit-text-run editor opened').toBe(true);
    expect(out.editRun.mode, 'edit-text-run editor is the edit mode').toBe('edit');
    expect(out.editRun.panelMode, 'edit-text-run: panel serves it in text mode').toBe('text');
  } finally {
    await hardClose(app, 'p21-c3');
  }
});

// ===========================================================================
// C4 — one panel serves every text-bearing tool; re-targets without closing;
// annotation mode: colour live, per-family disabled set retired (Phase 24) —
// only the engine-disabled Tc/Tz pair and the value-disabled indent-decrement
// stay disabled, and no control carries the retired per-family reason.
//
// Process gap (recorded, not a DEF): this C4 section only ever tested from a
// "panel already open, annotation selected" state.
// Phase-24 regression note: re-verify with the panel CLOSED and
// arm→place→interact to catch the DEF-251/252 lifecycle class.
// ===========================================================================
test('C4 panel re-target matrix + annotation per-family scope', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    const matrix = [];

    // text box: full control set live.
    await createTextBox(win, 'P21-M', 0.25, 0.2);
    let ps = await panelState(win);
    let live = await win.evaluate(() => ({
      mode: document.querySelector('[data-text-panel]')?.getAttribute('data-text-panel-mode'),
      colorDisabled: document.querySelector('[data-txt-color]')?.disabled ?? null,
      fontDisabled: document.querySelector('[data-txt-font]')?.disabled ?? null,
    }));
    matrix.push({ step: 'text box', mode: live.mode, colorDisabled: live.colorDisabled, fontDisabled: live.fontDisabled });
    expect(live.mode, 'text box: panel mode text').toBe('text');
    expect(live.colorDisabled, 'text box: colour live').toBe(false);
    expect(live.fontDisabled, 'text box: font live').toBe(false);

    // close edit mode; arm annotation textbox.
    await closeEditMode(win);
    await armAnnotationTool(win, 'textbox');
    await win.waitForTimeout(400);
    ps = await panelState(win);
    const annot = await win.evaluate((args) => {
      const { sels, reason } = args;
      const p = document.querySelector('.text-props-panel');
      const body = document.querySelector('[data-text-panel]');
      const colour = p.querySelector('[data-txt-color]');
      const disabled = [];
      const missing = [];
      for (const s of sels) {
        const el = p.querySelector(s);
        if (!el) { missing.push(s); continue; }
        if (el.disabled) disabled.push({ sel: s, title: el.getAttribute('title') });
      }
      return {
        mode: body ? body.getAttribute('data-text-panel-mode') : null,
        // Phase 24 retired the per-family hint; the surface is tagged by
        // data-text-panel-mode instead. Assert the retired note is gone.
        noteRetired: !p.querySelector('[data-txt-annotation-note]'),
        colourDisabled: colour ? colour.disabled : null,
        colourTitle: colour ? colour.getAttribute('title') : null,
        disabled: disabled.map((d) => d.sel),
        retiredReasonCount: disabled.filter((d) => d.title === reason).length,
        missing,
      };
    }, { sels: ANNOT_DISABLED_SELECTORS, reason: ANNOT_DISABLED_REASON });
    matrix.push({ step: 'annotation textbox', mode: annot.mode, colourDisabled: annot.colourDisabled, disabledCount: annot.disabled.length });
    log('C4-annotation', annot);
    expect(annot.mode, 'annotation textbox: panel mode annotation').toBe('annotation');
    expect(annot.noteRetired, 'annotation textbox: retired per-family hint is gone').toBe(true);
    expect(annot.colourDisabled, 'annotation textbox: colour is LIVE').toBe(false);
    expect(annot.missing, 'annotation textbox: every control is present').toEqual([]);
    // Phase 24 — the per-family disabled set is retired. Only the engine-disabled
    // Tc/Tz pair and the value-disabled indent-decrement stay disabled.
    expect(annot.disabled, 'annotation textbox: only engine/value-disabled controls are disabled')
      .toEqual(['[data-txt-indent-dec]', '[data-txt-character-spacing]', '[data-txt-horizontal-scaling]']);
    expect(annot.retiredReasonCount, 'annotation textbox: no control carries the retired per-family reason').toBe(0);

    // re-target between annotation tools WITHOUT the panel closing.
    for (const kind of ['callout', 'note', 'textbox']) {
      await armAnnotationTool(win, kind);
      await win.waitForTimeout(400);
      const st = await win.evaluate(() => ({
        mounted: !!document.querySelector('.text-props-panel'),
        mode: document.querySelector('[data-text-panel]')?.getAttribute('data-text-panel-mode'),
      }));
      matrix.push({ step: `annotation ${kind}`, mounted: st.mounted, mode: st.mode });
      expect(st.mounted, `${kind}: panel stays mounted on re-target`).toBe(true);
      expect(st.mode, `${kind}: still annotation mode`).toBe('annotation');
    }

    // dispatch-nothing sweep: force-click every disabled control; nothing changes.
    const before = await win.evaluate(() => {
      const st = window.tflexDiagnostics();
      const es = st.engineState || {};
      return { modified: st.modified, annCount: (es.annotations || []).length, ann: JSON.stringify(es.annotations || []) };
    });
    let clicked = 0;
    for (const sel of ANNOT_DISABLED_SELECTORS) {
      const loc = win.locator(`.text-props-panel ${sel}`);
      try {
        await loc.first().click({ force: true, timeout: 1200 });
        clicked += 1;
      } catch (_) { /* not clickable — expected for disabled controls */ }
    }
    await win.waitForTimeout(400);
    const after = await win.evaluate(() => {
      const st = window.tflexDiagnostics();
      const es = st.engineState || {};
      return { modified: st.modified, annCount: (es.annotations || []).length, ann: JSON.stringify(es.annotations || []) };
    });
    log('C4-dispatch-sweep', { clicked, before, after });
    expect(after.annCount, 'disabled controls dispatch nothing (annotation count)').toBe(before.annCount);
    expect(after.ann, 'disabled controls dispatch nothing (annotation payload)').toBe(before.ann);

    // back to a TFlex text object: panel returns to text mode with live controls.
    await armAnnotationTool(win, 'select');
    await win.waitForTimeout(300);
    await win.click('button[aria-label="Edit content"]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
    await win.click('[data-edit-tool="box"]');
    await win.waitForTimeout(400);
    await win.locator('.edit-box').first().click({ position: { x: 8, y: 8 } });
    await win.waitForTimeout(400);
    const back = await win.evaluate(() => ({
      mode: document.querySelector('[data-text-panel]')?.getAttribute('data-text-panel-mode'),
      fontDisabled: document.querySelector('[data-txt-font]')?.disabled ?? null,
    }));
    matrix.push({ step: 'back to text box', mode: back.mode, fontDisabled: back.fontDisabled });
    expect(back.mode, 'back to text box: panel mode text').toBe('text');
    expect(back.fontDisabled, 'back to text box: font live again').toBe(false);
    log('C4-matrix', matrix);
  } finally {
    await hardClose(app, 'p21-c4');
  }
});

// ===========================================================================
// C5 — undo/redo restores the text AND the panel's reflected state.
// ===========================================================================
test('C5 undo/redo follows the text and the panel', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await createTextBox(win, 'P21-U', 0.25, 0.25);

    await win.click('[data-txt-bold]');
    let b = await waitForBox(win, 'P21-U', (x) => x.bold === true);
    let ps = await panelState(win);
    log('C5-applied', { bold: b.bold, panelBold: ps.bold });
    expect(b.bold, 'bold applied to the engine').toBe(true);
    expect(ps.bold, 'panel reflects bold').toBe(true);

    await win.keyboard.press('Control+z');
    b = await waitForBox(win, 'P21-U', (x) => x.bold !== true);
    ps = await waitForPanel(win, (s) => s.bold === false);
    log('C5-undo', { bold: b.bold, panelBold: ps.bold });
    expect(b.bold === true, 'undo restores the text (bold cleared)').toBe(false);
    expect(ps.bold, 'panel reflects the undo').toBe(false);

    await win.keyboard.press('Control+y');
    b = await waitForBox(win, 'P21-U', (x) => x.bold === true);
    ps = await waitForPanel(win, (s) => s.bold === true);
    log('C5-redo', { bold: b.bold, panelBold: ps.bold });
    expect(b.bold, 'redo restores the text (bold back)').toBe(true);
    expect(ps.bold, 'panel reflects the redo').toBe(true);
    await win.screenshot({ path: path.join(SHOTS, 'phase21-c5-undoredo.png') }).catch(() => {});
  } finally {
    await hardClose(app, 'p21-c5');
  }
});

// ===========================================================================
// C7 — reduced motion collapses the panel path with no structural change,
// across all three themes.
// ===========================================================================
test('C7 reduced motion + three themes', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    const cdp = await win.context().newCDPSession(win);
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    const rm = await win.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    expect(rm, 'reduced motion emulated').toBe(true);
    await openReport(app, win);
    await installProbe(win);

    for (const theme of THEMES) {
      await setTheme(win, theme);
      await armAnnotationTool(win, 'select');
      await win.waitForTimeout(300);
      await startProbe(win, 700);
      await armAnnotationTool(win, 'textbox');
      const rows = await readProbe(win);
      const live = rows.filter((r) => r.panelW > 0);
      const widths = [...new Set(live.map((r) => Math.round(r.panelW)))];
      const travelFrames = live.filter((r) => r.tr && r.tr !== 'none').length;
      const st = await win.evaluate(() => ({
        mounted: !!document.querySelector('.text-props-panel'),
        mode: document.querySelector('[data-text-panel]')?.getAttribute('data-text-panel-mode'),
        controls: document.querySelectorAll('.text-props-panel [data-txt-font], .text-props-panel [data-txt-bold], .text-props-panel [data-txt-color]').length,
      }));
      await win.screenshot({ path: path.join(SHOTS, `phase21-c7-reduced-${theme}.png`) }).catch(() => {});
      log('C7', { theme, widths, travelFrames, st });
      expect(st.mounted, `${theme}: reduced — panel still mounts (structure unchanged)`).toBe(true);
      expect(st.mode, `${theme}: reduced — annotation mode intact`).toBe('annotation');
      expect(st.controls, `${theme}: reduced — controls intact`).toBe(3);
      expect(travelFrames, `${theme}: reduced — panel never travels (opacity only)`).toBe(0);
      expect(widths.length, `${theme}: reduced — width change is instant (no tween)`).toBeLessThanOrEqual(2);
      expect(widths[widths.length - 1], `${theme}: reduced — reaches the open width`).toBeGreaterThan(240);

      await startProbe(win, 700);
      await armAnnotationTool(win, 'select');
      await readProbe(win);
      const after = await win.evaluate(() => document.querySelectorAll('.text-props-panel').length);
      expect(after, `${theme}: reduced — panel unmounts on close`).toBe(0);
    }
  } finally {
    await hardClose(app, 'p21-c7');
  }
});
