// Phase 26 QA validation — panel-driven text editing (double-click editors
// removed) + shape colour from the annotation dropdown.
//
// Measures the running Electron app (canonical launcher only) against the
// phase's five success criteria:
//   C1 no in-canvas editor mounts on place / double-click for textbox,
//      callout, note and the Edit-mode box (DOM probe + screenshot).
//   C2 placing / clicking a text element focuses the panel Text field with
//      its content selected; typing updates the page text LIVE per keystroke;
//      ONE undo entry per session; the change survives Save As -> reopen.
//   C3 a shape double-click opens no in-canvas palette; the annotation
//      toolbar's [data-ann-color] control changes the selected shape colour.
//   C4 Confirm / Delete, undo / redo and the full Phase-24 style control set
//      still work on a placed annotation.
//
// Screenshots: screenshots/phase26-verify-no-editor.png,
//              screenshots/phase26-verify-shape-color.png
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, armAnnotationTool, openSamplePath, toggleEditMode } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const log = (label, obj) => console.log(`[P26] ${label} ${JSON.stringify(obj)}`);

const RETIRED_SELECTORS = [
  '[data-annotation-editor]',
  '[data-annotation-editor-wrap]',
  '[data-ann-color-edit]',
  '.edit-inline-editor',
  '.shape-color-editor',
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

async function dragOnPage(win, fx, fy, dxPx = 190, dyPx = 60) {
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 240));
  const y = Math.max(40, Math.min(pg.y + pg.height * fy, vp.h - 240));
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dxPx, y + dyPx, { steps: 6 });
  await win.mouse.up();
}

/** Count every retired in-canvas editor selector + textareas in the layer. */
async function editorCounts(win) {
  return win.evaluate((sels) => {
    const out = {};
    for (const s of sels) out[s] = document.querySelectorAll(s).length;
    const layer = document.querySelector('.annotation-layer');
    // Phase 28 — the comment box's own textarea (`.ann-comment-input`) is a
    // legitimate control that lives in the annotation layer; exclude it so
    // this check still means "no retired in-canvas text editor".
    out['layer-textareas'] = layer ? layer.querySelectorAll('textarea:not(.ann-comment-input)').length : -1;
    out['edit-textareas'] = document.querySelectorAll('.edit-layer textarea').length;
    return out;
  }, RETIRED_SELECTORS);
}

async function annModels(win) {
  return win.evaluate(() => {
    const st = window.tflexDiagnostics().engineState;
    if (!st || !st.annotations) return null;
    return st.annotations.map((a) => ({
      id: a.id, kind: a.kind, page: a.page, text: a.text ?? a.content ?? null,
      color: a.color ?? null, style: a.style ?? null, rect: a.rect ?? null,
    }));
  });
}

async function waitForAnn(win, text, pred, timeout = 12000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    const anns = (await annModels(win)) || [];
    const a = anns.find((x) => x.text === text);
    last = a;
    if (a && (pred ? pred(a) : true)) return a;
    await win.waitForTimeout(150);
  }
  return last;
}

/** The live rendered text of the first committed textbox on the page. */
async function overlayText(win, sel = '.ann-textbox[data-kind="textbox"]') {
  return win.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const span = el.querySelector('.ann-text-content');
    return span ? span.textContent : el.textContent;
  }, sel);
}

/** The panel Text field's focus / selection / value state. */
async function fieldState(win) {
  return win.evaluate(() => {
    const ta = document.querySelector('[data-txt-text]');
    if (!ta) return null;
    return {
      exists: true,
      disabled: ta.disabled,
      value: ta.value,
      focused: document.activeElement === ta,
      selectionStart: ta.selectionStart,
      selectionEnd: ta.selectionEnd,
      mode: document.querySelector('[data-text-panel]')?.getAttribute('data-text-panel-mode') ?? null,
    };
  });
}

/** Place a text annotation through the Phase-26 panel field (no editor). */
async function placeTextViaPanel(win, kind, text, fx, fy) {
  if (kind === 'textbox') {
    await armAnnotationTool(win, 'textbox');
    await dragOnPage(win, fx, fy);
  } else if (kind === 'callout') {
    await armAnnotationTool(win, 'callout');
    await dragOnPage(win, fx, fy);
  } else {
    await armAnnotationTool(win, 'note');
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const nx = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 40));
    const ny = Math.max(40, Math.min(pg.y + pg.height * fy, vp.h - 240));
    await win.mouse.click(nx, ny);
  }
  await win.waitForSelector('[data-txt-text]', { timeout: 8000 });
  await win.waitForFunction(() => {
    const ta = document.querySelector('[data-txt-text]');
    return ta !== null && ta.disabled === false;
  }, null, { timeout: 8000 }).catch(async () => {
    const st = await win.evaluate(() => ({
      anns: (window.tflexDiagnostics().engineState?.annotations ?? []).map((a) => ({ k: a.kind, t: a.text })),
      field: document.querySelector('[data-txt-text]')?.disabled,
    }));
    log('place-field-not-enabled', { kind, st });
  });
  await win.locator('[data-txt-text]').fill(text);
  await win.locator('[data-txt-text]').blur();
  const cls = kind === 'textbox' ? '.ann-textbox' : kind === 'callout' ? '.ann-callout' : '.ann-note';
  await win.waitForSelector(`${cls}[data-kind="${kind}"]`, { timeout: 8000 });
  await waitForAnn(win, text, null, 12000);
  await win.waitForTimeout(300);
}

// ===========================================================================
// C1 � no in-canvas editor on place / double-click (textbox/callout/note/edit).
// ===========================================================================
test('C1 no in-canvas editor for textbox/callout/note/edit box', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);

    const placed = {};
    for (const [kind, fx, fy] of [['textbox', 0.25, 0.15], ['callout', 0.25, 0.4], ['note', 0.72, 0.78]]) {
      await placeTextViaPanel(win, kind, `P26-${kind}`, fx, fy);
      placed[kind] = await editorCounts(win);
      const sel = kind === 'textbox' ? '.ann-textbox' : kind === 'callout' ? '.ann-callout' : '.ann-note';
      const el = win.locator(`${sel}[data-kind="${kind}"]`).first();
      const bb = await el.boundingBox();
      await win.mouse.dblclick(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await win.waitForTimeout(500);
      placed[`${kind}-dblclick`] = await editorCounts(win);
    }

    // Edit-mode text box: enter Edit mode, arm box, drag, then double-click.
    await win.screenshot({ path: path.join(SHOTS, 'phase26-annotations-clean.png') }).catch(() => {});
    await toggleEditMode(win);
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
    await win.click('[data-edit-tool="box"]');
    const editArmed = await win.evaluate(() => ({
      tool: document.querySelector('[data-edit-tool="box"]')?.getAttribute('aria-pressed'),
      toolbar: !!document.querySelector('[data-edit-toolbar]'),
      layer: !!document.querySelector('.edit-layer'),
    }));
    log('C1-edit-armed', editArmed);
    const pgE = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    const vpE = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const ex = Math.max(40, Math.min(pgE.x + pgE.width * 0.35, vpE.w - 260));
    const ey = Math.max(40, Math.min(pgE.y + pgE.height * 0.6, vpE.h - 120));
    await win.mouse.click(ex, ey);
    await win.waitForTimeout(800);
    const editAfterDrag = await win.evaluate(() => ({
      boxes: document.querySelectorAll('.edit-box').length,
      textareas: document.querySelectorAll('.edit-layer textarea').length,
      inline: document.querySelectorAll('.edit-inline-editor').length,
      target: document.querySelector('[data-text-panel]')?.getAttribute('data-text-panel-mode'),
    }));
    log('C1-edit-after-drag', editAfterDrag);
    await win.waitForSelector('.edit-box', { timeout: 8000 });
    await win.waitForSelector('[data-txt-text]', { timeout: 8000 });
    placed['edit-box-place'] = await editorCounts(win);
    const ebox = await win.locator('.edit-box').first().boundingBox();
    await win.mouse.dblclick(ebox.x + ebox.width / 2, ebox.y + ebox.height / 2);
    await win.waitForTimeout(500);
    placed['edit-box-dblclick'] = await editorCounts(win);

    await win.screenshot({ path: path.join(SHOTS, 'phase26-verify-no-editor.png') }).catch(() => {});
    log('C1-counts', placed);

    const bad = [];
    for (const [stage, counts] of Object.entries(placed)) {
      for (const [sel, n] of Object.entries(counts)) {
        if (n !== 0) bad.push(`${stage}:${sel}=${n}`);
      }
    }
    expect(bad, 'no retired in-canvas editor or in-canvas textarea anywhere').toEqual([]);
    // The panel field is the editor and it exists.
    expect((await fieldState(win)).exists, 'panel Text field present').toBe(true);
  } finally {
    await hardClose(app, 'p26-c1');
  }
});

// ===========================================================================
// C2 � panel field focus+select, live per-keystroke text, one undo entry,
// save/reopen persistence.
// ===========================================================================
test('C2 panel field live typing, one undo entry, save/reopen', async () => {
  test.setTimeout(300000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);

    // Place with a SEED so "pre-edit text" is non-empty.
    await placeTextViaPanel(win, 'textbox', 'SEED', 0.3, 0.2);

    // Deselect, then CLICK the existing element: the field must focus+select.
    const pg0 = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.mouse.click(pg0.x + pg0.width * 0.85, pg0.y + pg0.height * 0.85);
    await win.waitForTimeout(500);
    const tbx = win.locator('.ann-textbox[data-kind="textbox"]').first();
    const bb = await tbx.boundingBox();
    await win.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.waitForTimeout(600);
    const focusState = await fieldState(win);
    log('C2-click-focus', focusState);
    expect(focusState.mode, 'panel in annotation mode').toBe('annotation');
    expect(focusState.focused, 'clicking the text element focuses the panel field').toBe(true);
    expect(focusState.value, 'field reflects the element text').toBe('SEED');
    expect([focusState.selectionStart, focusState.selectionEnd], 'whole content selected on focus').toEqual([0, 4]);

    // Type HELLO one char at a time; the PAGE text must follow each keystroke.
    const perKeystroke = [];
    for (const ch of ['H', 'E', 'L', 'L', 'O']) {
      await win.keyboard.type(ch);
      await win.waitForTimeout(180);
      perKeystroke.push({ typed: ch, page: await overlayText(win), field: (await fieldState(win)).value });
    }
    log('C2-per-keystroke', perKeystroke);
    expect(perKeystroke.map((r) => r.page), 'page text is live after every keystroke').toEqual(['H', 'HE', 'HEL', 'HELL', 'HELLO']);
    expect(perKeystroke.every((r) => r.field === r.page), 'field and page agree mid-typing').toBe(true);

    // Commit the session (blur) -> exactly ONE engine op; then one Ctrl+Z.
    await win.locator('[data-txt-text]').blur();
    await waitForAnn(win, 'HELLO', null, 12000);
    const afterCommit = await waitForAnn(win, 'HELLO', null, 12000);
    log('C2-committed', afterCommit && { text: afterCommit.text });
    await win.keyboard.press('Control+z');
    await win.waitForTimeout(1200);
    const afterUndo = await waitForAnn(win, 'SEED', null, 8000);
    const undoneText = afterUndo ? afterUndo.text : null;
    // After an undo the doc proxy refreshes and the restored text is baked
    // into the page canvas (the DOM overlay text is suppressed by design),
    // so the engine state is the page-content truth here.
    const undoDom = await win.evaluate(() => ({
      textboxes: document.querySelectorAll('.ann-textbox').length,
      anns: (window.tflexDiagnostics().engineState?.annotations ?? []).map((a) => ({ id: a.id, text: a.text })),
    }));
    await win.screenshot({ path: path.join(SHOTS, 'phase26-undo-restored.png') }).catch(() => {});
    log('C2-after-undo', { engine: undoneText, dom: undoDom });
    expect(undoneText, 'one Ctrl+Z restores the pre-edit text (one undo entry per session)').toBe('SEED');
    expect(undoDom.textboxes, 'the annotation still exists after undo').toBe(1);
    // Redo returns the session text.
    await win.keyboard.press('Control+y');
    await win.waitForTimeout(1200);
    const afterRedo = await waitForAnn(win, 'HELLO', null, 8000);
    log('C2-after-redo', afterRedo && afterRedo.text);
    expect(afterRedo && afterRedo.text, 'redo reapplies the session text').toBe('HELLO');

    // Save As -> reopen: the text survives.
    const savePath = path.join(os.tmpdir(), `p26-c2-${Date.now()}.pdf`);
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, savePath);
    await win.click('[data-toolbar-save-as]');
    await win.waitForSelector('[data-save-as-confirm]', { timeout: 8000 });
    await win.click('[data-save-as-confirm]');
    await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 30000 });
    expect(fs.existsSync(savePath), 'saved PDF exists').toBe(true);
    await win.locator('.tab-active .tab-close').click();
    await win.waitForTimeout(1500);
    await openSamplePath(win, app, savePath);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(2000);
    const reopened = await waitForAnn(win, 'HELLO', null, 15000);
    log('C2-reopened', reopened && { text: reopened.text, color: reopened.color });
    expect(reopened && reopened.text, 'text survives save/reopen').toBe('HELLO');
  } finally {
    await hardClose(app, 'p26-c2');
  }
});

// ===========================================================================
// C3 � shape double-click opens nothing; [data-ann-color] sets the armed tool colour only (Phase 28).
// ===========================================================================
test('C3 shape double-click inert; toolbar colour sets the armed tool only (Phase 28)', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);

    await armAnnotationTool(win, 'rect');
    await dragOnPage(win, 0.3, 0.25, 200, 90);
    await win.waitForSelector('.ann-shape[data-kind="rect"]', { timeout: 8000 });
    await win.waitForTimeout(500);

    const shape = win.locator('.ann-shape[data-kind="rect"]').first();
    const sb = await shape.boundingBox();
    await win.mouse.dblclick(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await win.waitForTimeout(600);
    const counts = await editorCounts(win);
    counts['color-popover-on-dblclick'] = await win.locator('[data-color-popover]').count();
    log('C3-dblclick-counts', counts);
    for (const [sel, n] of Object.entries(counts)) {
      expect(n, `double-click opens nothing (${sel})`).toBe(0);
    }

    // Select the shape. Phase 28 supersedes the Phase-26 contract: the
    // toolbar dropdown sets the ARMED tool colour only — it must NOT patch
    // the SELECTED annotation (the action bar's colour box owns that).
    await win.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await win.waitForTimeout(500);
    await win.waitForSelector('[data-ann-color]', { timeout: 8000 });
    const before = (await annModels(win)).find((a) => a.kind === 'rect');
    const swatchBefore = await win.getAttribute('[data-ann-color]', 'data-color-current');
    log('C3-before', { color: before && before.color, swatchBefore });
    await win.click('[data-ann-color]');
    await win.waitForSelector('[data-color-popover]', { timeout: 8000 });
    await win.click('[data-palette-built-in="blue"]');
    await win.waitForTimeout(1200);
    const after = (await annModels(win)).find((a) => a.kind === 'rect');
    const swatchAfter = await win.getAttribute('[data-ann-color]', 'data-color-current');
    log('C3-after', { color: after && after.color, swatchAfter });
    await win.screenshot({ path: path.join(SHOTS, 'phase26-verify-shape-color.png') }).catch(() => {});
    // Phase 28 — the dropdown updates the armed tool colour...
    expect(swatchAfter, 'the armed tool colour follows the dropdown pick').not.toBe(swatchBefore);
    // ...but the selected annotation keeps its colour.
    expect(after && after.color, 'the dropdown does NOT patch the selected annotation (Phase 28)').toBe(before && before.color);
    expect(after && after.color, 'the selected shape colour is unchanged by the dropdown').not.toBe('blue');
  } finally {
    await hardClose(app, 'p26-c3');
  }
});

// ===========================================================================
// C4 � Confirm / Delete / undo / redo and the full Phase-24 style set still
// work on a placed annotation.
// ===========================================================================
const ENGINE_DISABLED = ['[data-txt-horizontal-scaling]'];
const ALL_CONTROLS = [
  '[data-txt-font]', '[data-txt-size]', '[data-txt-bold]', '[data-txt-italic]', '[data-txt-underline]',
  '[data-txt-super]', '[data-txt-sub]', '[data-txt-color]', '[data-txt-highlight]',
  '[data-txt-highlight-clear]', '[data-txt-clear]',
  '[data-txt-align-left]', '[data-txt-align-center]', '[data-txt-align-right]', '[data-txt-align-justify]',
  '[data-txt-line-height]', '[data-txt-list-none]', '[data-txt-list-bullet]', '[data-txt-list-number]',
  '[data-txt-indent-dec]', '[data-txt-indent-inc]',
  '[data-txt-character-spacing]', '[data-txt-horizontal-scaling]',
];

test('C4 Confirm / Delete / undo / redo + full style set live', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await placeTextViaPanel(win, 'textbox', 'P26-C4', 0.3, 0.3);

    const tbx = win.locator('.ann-textbox[data-kind="textbox"]').first();
    let bb = await tbx.boundingBox();
    await win.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.waitForSelector('[data-content-action-bar="ann-textbox"]', { timeout: 8000 });
    const bar = await win.evaluate(() => ({
      confirm: !!document.querySelector('[data-content-action="ann-textbox-confirm"]'),
      delete: !!document.querySelector('[data-content-action="ann-textbox-delete"]'),
      edit: !!document.querySelector('[data-content-action$="-edit"]'),
    }));
    log('C4-bar', bar);
    expect(bar.confirm, 'Confirm button present').toBe(true);
    expect(bar.delete, 'Delete button present').toBe(true);
    expect(bar.edit, 'no retired Edit button on the selection chrome').toBe(false);

    // Full Phase-24 control set mounted and live for the annotation.
    const dis = await win.evaluate((sels) => {
      const p = document.querySelector('.text-props-panel');
      const out = {};
      for (const s of sels) {
        const el = p.querySelector(s);
        out[s] = el === null ? 'MISSING' : { disabled: el.disabled };
      }
      return out;
    }, ALL_CONTROLS);
    const missing = Object.entries(dis).filter(([, v]) => v === 'MISSING').map(([k]) => k);
    const disabled = Object.entries(dis).filter(([, v]) => v !== 'MISSING' && v.disabled).map(([k]) => k);
    log('C4-controls', { missing, disabled });
    expect(missing, 'every Phase-24 style control mounted').toEqual([]);
    expect(disabled.filter((s) => !ENGINE_DISABLED.includes(s)), 'only value-disabled controls besides Tz')
      .toEqual(['[data-txt-indent-dec]']);
    expect(dis['[data-txt-character-spacing]'].disabled, 'char spacing live (Phase 27)').toBe(false);
    await win.click('[data-txt-bold]');
    const boldAnn = await waitForAnn(win, 'P26-C4', (a) => a.style && a.style.bold === true);
    log('C4-bold', boldAnn && boldAnn.style && boldAnn.style.bold);
    expect(boldAnn && boldAnn.style && boldAnn.style.bold, 'panel bold is live for the annotation').toBe(true);

    // Drag to park a PENDING move, then Confirm commits it.
    bb = await tbx.boundingBox();
    const rectBefore = (await annModels(win)).find((a) => a.text === 'P26-C4');
    await win.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.mouse.down();
    await win.mouse.move(bb.x + bb.width / 2 + 60, bb.y + bb.height / 2 + 40, { steps: 6 });
    await win.mouse.up();
    await win.waitForTimeout(500);
    await win.click('[data-content-action="ann-textbox-confirm"]');
    await win.waitForTimeout(900);
    const rectAfter = (await annModels(win)).find((a) => a.text === 'P26-C4');
    log('C4-confirm', { before: rectBefore && rectBefore.rect, after: rectAfter && rectAfter.rect });
    expect(rectAfter, 'Confirm keeps the annotation').toBeTruthy();

    // Delete removes it; one undo restores it; redo removes it again.
    await win.mouse.click(bb.x + bb.width / 2 + 60, bb.y + bb.height / 2 + 40);
    await win.waitForSelector('[data-content-action-bar="ann-textbox"]', { timeout: 8000 });
    await win.click('[data-content-action="ann-textbox-delete"]');
    await win.waitForTimeout(900);
    const afterDelete = (await annModels(win)).filter((a) => a.text === 'P26-C4');
    log('C4-after-delete', afterDelete.length);
    expect(afterDelete.length, 'Delete removes the annotation').toBe(0);
    await win.keyboard.press('Control+z');
    await win.waitForTimeout(900);
    const afterUndo = (await annModels(win)).filter((a) => a.text === 'P26-C4');
    log('C4-after-undo', afterUndo.length);
    expect(afterUndo.length, 'undo restores the deleted annotation').toBe(1);
    await win.keyboard.press('Control+y');
    await win.waitForTimeout(900);
    const afterRedo = (await annModels(win)).filter((a) => a.text === 'P26-C4');
    log('C4-after-redo', afterRedo.length);
    expect(afterRedo.length, 'redo removes it again').toBe(0);
  } finally {
    await hardClose(app, 'p26-c4');
  }
});

// ===========================================================================
// C1b � a single CLICK places a textbox immediately (no editor) and focuses
// the panel Text field. Guards against a click-vs-drag placement regression.
// ===========================================================================
test('C1b single click places a textbox (panel field, no editor)', async () => {
  test.setTimeout(120000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await armAnnotationTool(win, 'textbox');
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    const cx = Math.max(40, Math.min(pg.x + pg.width * 0.35, vp.w - 40));
    const cy = Math.max(40, Math.min(pg.y + pg.height * 0.3, vp.h - 240));
    await win.mouse.click(cx, cy);
    await win.waitForTimeout(800);
    const st = await win.evaluate(() => {
      const es = window.tflexDiagnostics().engineState || {};
      return {
        anns: (es.annotations || []).map((a) => a.kind),
        editor: document.querySelectorAll('[data-annotation-editor], .edit-inline-editor').length,
        panelEnabled: document.querySelector('[data-txt-text]')?.disabled === false,
      };
    });
    log('C1b-click-place', st);
    expect(st.anns.filter((k) => k === 'textbox').length, 'a single click places a textbox').toBe(1);
    expect(st.editor, 'no in-canvas editor mounts on click-placement').toBe(0);
    expect(st.panelEnabled, 'the panel Text field is live on click-placement').toBe(true);
  } finally {
    await hardClose(app, 'p26-c1b');
  }
});
