// TFL-784 (TFL-776.3) — app-wide recurrence sweep (bug-hunt). Owner: qa.
//
// Class under test: "a destructive edit leaves a stale interactive overlay /
// hit-target behind". Surface 1 (Edit Text) is the CONTROL (DEF-561 CLOSED,
// fixed by TFL-776.1). Surfaces 2..6 check whether the same class recurs on:
// Add Text, annotations (highlight/underline/strikeout), form fields,
// Format Painter, Bates/watermark.
//
// Method: for each surface, perform the destructive edit through the real UI,
// move the pointer over the vacated position, read document.elementFromPoint +
// the overlay DOM, then click it and assert nothing is selected or restored.
//
// This spec FIXES nothing (read-only on src/). Launches ONLY through the
// canonical e2e/lib/launch.cjs `launchApp`.
// Run: npm.cmd run test:e2e -- tfl776_recurrence_sweep
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
// Harness/CI guard: if ELECTRON_RUN_AS_NODE is inherited, electron.exe runs as
// plain Node and rejects Playwright's --remote-debugging-port switch ("bad
// option"). Clear it for this test process only so launchApp can start Electron.
delete process.env.ELECTRON_RUN_AS_NODE;
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, gotoStage, scrollToPage, armAnnotationTool, runTool } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const RESULTS_PATH = path.join(SHOTS, 'tfl776-recurrence-matrix.json');
const RESULTS = [];

function rec(surface, verdict, detail) {
  const entry = { surface, verdict, detail, at: new Date().toISOString() };
  RESULTS.push(entry);
  console.log(`[TFL776.SWEEP] ${verdict} | ${surface} | ${JSON.stringify(detail)}`);
}

test.setTimeout(300000);

// Run one surface: launch fresh, record PASS if the body resolves, FAIL with
// the assertion message otherwise (surface bodies throw on a recurrence).
async function surface(name, sample, run) {
  let app = null;
  try {
    app = await launchApp([getSamplePath(sample)]);
    const win = await app.firstWindow();
    await waitForDoc(win);
    const detail = await run(win, app);
    rec(name, 'PASS', detail ?? {});
  } catch (e) {
    rec(name, 'FAIL', { error: e && e.message ? e.message : String(e) });
  } finally {
    if (app) await hardClose(app, `tfl776-${name}`);
    flush();
  }
}

function flush() {
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(RESULTS, null, 2));
}

// ---- shared helpers -------------------------------------------------------

async function waitForDoc(win) {
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(900);
}

async function elementAt(win, x, y) {
  return win.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    if (el === null) return null;
    const cls = typeof el.className === 'string' ? el.className : '';
    return { tag: el.tagName, cls };
  }, [x, y]);
}

async function engineAnnotations(win) {
  return win.evaluate(() => {
    const es = window.tflexDiagnostics().engineState || {};
    return es.annotations || [];
  });
}

async function engineBoxes(win) {
  return win.evaluate(() => {
    const es = window.tflexDiagnostics().engineState || {};
    return (es.textBoxes || []).map((b) => ({ id: b.id, text: b.text, page: b.page }));
  });
}

// The page-1 text run whose text matches `want` -> viewport centre.
async function spanCentreByText(win, want) {
  return win.evaluate((text) => {
    const spans = Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'));
    for (const s of spans) {
      if ((s.textContent || '').trim() === text) {
        const r = s.getBoundingClientRect();
        return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      }
    }
    return null;
  }, want);
}

// A visible page-1 text-layer span -> { text, cx, cy, x, y, w, h }.
async function firstRunSpan(win, skipText) {
  return win.evaluate((skip) => {
    const spans = Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span'));
    for (const s of spans) {
      const t = (s.textContent || '').trim();
      const r = s.getBoundingClientRect();
      if (t !== skip && t.length >= 6 && r.width > 20 && r.height > 4) {
        return { text: t, x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
      }
    }
    return null;
  }, skipText ?? null);
}

async function moveAway(win) {
  await win.mouse.move(5, 5);
  await win.waitForTimeout(200);
}

// ===========================================================================
// SURFACE 1 - Edit Text (CONTROL, DEF-561 CLOSED). Expected PASS.
// ===========================================================================
test('S1 Edit Text control: deleting a run leaves the vacated position inert', async () => {
  await surface('S1_edit_text_control', 'report.pdf', async (win) => {
    await scrollToPage(win, 1);
    await gotoStage(win, 2);
    const verb = win.locator('[data-dock-verb="editText"]').first();
    await verb.waitFor({ state: 'visible', timeout: 12000 });
    await verb.click();
    await win.waitForFunction(() => document.querySelector('.edit-layer[data-tool="text"]') !== null, undefined, { timeout: 8000 });

    const run = await firstRunSpan(win);
    expect(run, 'a page-1 text run is present').not.toBeNull();
    await win.mouse.click(run.cx, run.cy);
    await win.locator('[data-content-action-bar="textrun"]').first().waitFor({ state: 'visible', timeout: 10000 });
    await win.screenshot({ path: path.join(SHOTS, 'tfl776-s1-before-delete.png') });

    await win.locator('[data-content-action="textrun-delete"]').first().click();
    await win.waitForFunction(() => document.querySelector('[data-content-action-bar="textrun"]') === null, undefined, { timeout: 15000 });
    await win.waitForTimeout(2200);
    await win.screenshot({ path: path.join(SHOTS, 'tfl776-s1-after-delete.png') });

    // The delete re-render can scroll the page so the phantom span sits under
    // the top chrome, where elementFromPoint would hit the tab strip and the
    // probe would be vacuous. Re-anchor page 1 near the top so the phantom is
    // inside the visible page area before probing.
    await scrollToPage(win, 1);
    await win.waitForTimeout(600);

    const itemsAfterDelete = await win.evaluate(() => Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span')).map((s) => (s.textContent || '').trim()));
    const vacated = await spanCentreByText(win, run.text);
    expect(vacated, 'phantom span still present (engine masks, never removes)').not.toBeNull();

    // Positive control: a SURVIVING run still shows the hover box, proving the
    // text hover listener is live so a zero-hover result over the vacated
    // position is a real negative, not a dead probe.
    const control = await firstRunSpan(win, run.text);
    let controlHover = 0;
    if (control !== null) {
      await moveAway(win);
      await win.mouse.move(control.cx, control.cy);
      await win.waitForTimeout(450);
      controlHover = await win.locator('.page-slot[data-page="1"] .edit-text-hover').count();
      await moveAway(win);
    }

    await moveAway(win);
    await win.mouse.move(vacated.cx, vacated.cy);
    await win.waitForTimeout(500);
    await win.screenshot({ path: path.join(SHOTS, 'tfl776-s1-hover-vacated.png') });
    const hover = await win.locator('.page-slot[data-page="1"] .edit-text-hover').count();
    const barHover = await win.locator('[data-content-action-bar="textrun"]').count();
    const hit = await elementAt(win, vacated.cx, vacated.cy);
    expect(control, 'a surviving run exists for the positive control').not.toBeNull();
    expect(controlHover, 'positive control: a surviving run still hovers').toBeGreaterThan(0);
    expect(hover, 'no hover box over the vacated position').toBe(0);
    expect(barHover, 'no textrun bar on hover').toBe(0);
    expect(hit !== null && hit.cls.includes('edit-text-hover'), 'hit is not the ghost box').toBe(false);

    await win.mouse.click(vacated.cx, vacated.cy);
    await win.waitForTimeout(700);
    await win.screenshot({ path: path.join(SHOTS, 'tfl776-s1-after-click.png') });
    const barClick = await win.locator('[data-content-action-bar="textrun"]').count();
    const selClick = await win.locator('[data-textrun-selection]').count();
    const itemsAfterClick = await win.evaluate(() => Array.from(document.querySelectorAll('.page-slot[data-page="1"] .textLayer span')).map((s) => (s.textContent || '').trim()));
    expect(barClick, 'click does not re-select the deleted run').toBe(0);
    expect(selClick, 'no selection surface after the vacated click').toBe(0);
    expect(itemsAfterClick.join(' '), 'click does not re-insert content').toBe(itemsAfterDelete.join(' '));
    return { run: run.text, vacated, hover, barHover, hit, barClick, selClick, controlHover, control: control ? control.text : null };
  });
});

// ===========================================================================
// SURFACE 2 - Add Text (Edit text box): delete leaves the vacated box inert.
// ===========================================================================
async function armTextBoxTool(win) {
  await gotoStage(win, 2);
  const verb = win.locator('[data-dock-verb="editTextBox"]').first();
  await verb.waitFor({ state: 'visible', timeout: 12000 });
  await verb.click();
  await win.waitForTimeout(500);
}

async function dragCreateBox(win, text) {
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const inspectorLeft = await win.evaluate(() => {
    const i = document.querySelector('[data-inspector]');
    return i ? i.getBoundingClientRect().left : window.innerWidth;
  });
  const x = Math.max(40, Math.min(pg.x + pg.width * 0.25, vp.w - 260, inspectorLeft - 240));
  const y = Math.max(pg.y + 20, Math.min(pg.y + pg.height * 0.25, vp.h - 220));
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + 200, y + 70, { steps: 6 });
  await win.mouse.up();
  await win.waitForFunction(() => {
    const ta = document.querySelector('[data-txt-text]');
    return ta !== null && ta.disabled === false;
  }, undefined, { timeout: 15000 });
  await win.locator('[data-txt-text]').fill(text);
  await win.locator('[data-txt-text]').blur();
  await win.waitForSelector('.edit-box', { timeout: 8000 });
  await win.waitForTimeout(500);
}

test('S2 Add Text: deleting a committed box leaves the vacated position inert', async () => {
  await surface('S2_add_text', 'report.pdf', async (win) => {
    const TEXT = 'SWEEP-ADD-BOX';
    await scrollToPage(win, 1);
    await armTextBoxTool(win);
    await dragCreateBox(win, TEXT);

    const box = win.locator(`.edit-box[data-edit-box-text="${TEXT}"]`).first();
    await box.click({ position: { x: 8, y: 8 } });
    await win.waitForSelector('[data-edit-box-toolbar]', { timeout: 8000 });
    await win.waitForTimeout(400);
    const bb = await box.boundingBox();
    const pageBefore = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.screenshot({ path: path.join(SHOTS, 'tfl776-s2-before-delete.png') });

    await win.locator('[data-edit-box-action="delete"]').first().click();
    await win.waitForSelector('[data-edit-box-toolbar]', { state: 'detached', timeout: 10000 });
    await win.waitForTimeout(1600);
    await win.screenshot({ path: path.join(SHOTS, 'tfl776-s2-after-delete.png') });

    const boxesAfterDelete = await engineBoxes(win);
    expect(boxesAfterDelete.some((b) => b.text === TEXT), 'engine no longer holds the deleted box').toBe(false);

    const pageAfter = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    const vacated = {
      cx: bb.x + bb.width / 2 + (pageAfter ? pageAfter.x - pageBefore.x : 0),
      cy: bb.y + bb.height / 2 + (pageAfter ? pageAfter.y - pageBefore.y : 0),
    };

    await moveAway(win);
    await win.mouse.move(vacated.cx, vacated.cy);
    await win.waitForTimeout(500);
    await win.screenshot({ path: path.join(SHOTS, 'tfl776-s2-hover-vacated.png') });
    const boxOnHover = await win.locator(`.edit-box[data-edit-box-text="${TEXT}"]`).count();
    const toolbarHover = await win.locator('[data-edit-box-toolbar]').count();
    const textboxBarHover = await win.locator('[data-content-action-bar="textbox"]').count();
    const hit = await elementAt(win, vacated.cx, vacated.cy);
    expect(boxOnHover, 'no .edit-box reappears over the vacated position').toBe(0);
    expect(toolbarHover, 'no text-box toolbar on hover').toBe(0);
    expect(textboxBarHover, 'no textbox action bar on hover').toBe(0);
    expect(hit !== null && hit.cls.includes('edit-box'), 'hit is not a stale .edit-box').toBe(false);

    // The Add Text placement verb is still armed after the delete, so a click on
    // empty canvas legitimately STARTS a new box. Disarm first so the probe
    // isolates the recurrence class (the deleted box's overlay/hit-target).
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);
    const armedAfterDelete = await win.evaluate(() => document.querySelector('[data-dock-verb="editTextBox"]')?.getAttribute('aria-pressed') ?? 'MISSING');
    const boxesBeforeClick = await engineBoxes(win);

    await win.mouse.click(vacated.cx, vacated.cy);
    await win.waitForTimeout(800);
    await win.screenshot({ path: path.join(SHOTS, 'tfl776-s2-after-click.png') });
    const boxesAfterClick = await engineBoxes(win);
    const toolbarClick = await win.locator('[data-edit-box-toolbar]').count();
    expect(boxesAfterClick.some((b) => b.text === TEXT), 'click does not restore the deleted box').toBe(false);
    expect(boxesAfterClick.length, 'disarmed click does not create a box at the vacated position').toBe(boxesBeforeClick.length);
    expect(toolbarClick, 'no toolbar reappears after the vacated click').toBe(0);
    return { vacated, boxOnHover, toolbarHover, textboxBarHover, hit, armedAfterDelete, toolbarClick };
  });
});

// ===========================================================================
// SURFACE 3 - annotations highlight / underline / strikeout.
// Markup annotations are selected via the Annotations list, not page clicks, so
// the destructive edit runs through the panel's row Delete; the stale-overlay
// probe still hovers/clicks the vacated page rect.
// ===========================================================================
async function createMarkup(win, kind) {
  await armAnnotationTool(win, kind);
  const run = await firstRunSpan(win);
  expect(run, `a page-1 run is present for the ${kind} markup`).not.toBeNull();
  const y = run.y + run.h / 2;
  await win.mouse.move(run.x + 2, y);
  await win.mouse.down();
  await win.mouse.move(run.x + Math.max(30, run.w - 2), y, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(900);
  return run;
}

test('S3 annotations: deleting highlight/underline/strikeout leaves the vacated rect inert', async () => {
  await surface('S3_annotations', 'report.pdf', async (win) => {
    const detail = {};
    for (const kind of ['highlight', 'underline', 'strikeout']) {
      const beforeIds = (await engineAnnotations(win)).map((a) => a.id);
      const run = await createMarkup(win, kind);
      const anns = await engineAnnotations(win);
      const created = anns.find((a) => a.kind === kind && !beforeIds.includes(a.id));
      expect(created, `${kind} annotation was recorded in the engine`).toBeTruthy();
      await win.screenshot({ path: path.join(SHOTS, `tfl776-s3-${kind}-before-delete.png`) });

      // Markup annotations (highlight/underline/strikeout) are selected and
      // deleted via the Annotations panel, NOT page clicks: their <g> carries
      // no pointer/selection handlers by design (AnnotationOverlay.tsx ~1451),
      // so the task's on-page [data-content-action="ann-<kind>-delete"] never
      // surfaces for these kinds. Record that fact and use the real panel row
      // Delete (wired to the same engine removal).
      const onPageDelete = await win.locator(`[data-content-action="ann-${kind}-delete"]`).count();
      const deletePath = 'panel-row';
      await gotoStage(win, 3);
      await win.waitForSelector('[data-annotation-panel]', { state: 'attached', timeout: 10000 });
      const row = win.locator(`[data-annotation-row="${created.id}"]`).first();
      await row.waitFor({ state: 'attached', timeout: 8000 });
      await row.locator('.ann-panel-row-delete').click();
      await win.waitForTimeout(1400);
      await win.screenshot({ path: path.join(SHOTS, `tfl776-s3-${kind}-after-delete.png`) });

      const afterIds = (await engineAnnotations(win)).map((a) => a.id);
      expect(afterIds.includes(created.id), `${kind} annotation removed from the engine`).toBe(false);

      const vacated = { cx: run.x + run.w / 2, cy: run.y + run.h / 2 };
      await moveAway(win);
      await win.mouse.move(vacated.cx, vacated.cy);
      await win.waitForTimeout(500);
      const hit = await elementAt(win, vacated.cx, vacated.cy);
      const staleMarkup = await win.locator(`.ann-markup[data-kind="${kind}"][data-annotation-id="${created.id}"]`).count();
      expect(staleMarkup, `${kind}: no stale .ann-markup node for the deleted id`).toBe(0);
      expect(hit !== null && /ann/.test(hit.cls), `${kind}: hit is not a stale annotation surface`).toBe(false);

      await win.mouse.click(vacated.cx, vacated.cy);
      await win.waitForTimeout(600);
      await win.screenshot({ path: path.join(SHOTS, `tfl776-s3-${kind}-after-click.png`) });
      const afterClick = (await engineAnnotations(win)).map((a) => a.id);
      const annBar = await win.locator('[data-content-action-bar]').count();
      expect(afterClick.includes(created.id), `${kind}: click does not restore the deleted annotation`).toBe(false);
      expect(afterClick.length, `${kind}: click does not add an annotation`).toBe(afterIds.length);
      expect(annBar, `${kind}: no action bar appears after the vacated click`).toBe(0);
      detail[kind] = { id: created.id, onPageDelete, deletePath, hit, restored: false };
    }
    return detail;
  });
});

// ===========================================================================
// SURFACE 4 - form fields. Destructive edit = clear + commit.
// ===========================================================================
test('S4 form fields: clearing a field leaves no orphan input / double hit-target', async () => {
  await surface('S4_form_fields', 'form.pdf', async (win) => {
    const SEL = '[data-form-field="form-0-applicant_address"]';
    const input = win.locator(SEL).first();
    await input.waitFor({ state: 'visible', timeout: 10000 });
    await input.fill('SWEEP-FORM-VALUE');
    await win.waitForTimeout(700);
    const bb = await input.boundingBox();
    await win.screenshot({ path: path.join(SHOTS, 'tfl776-s4-before-clear.png') });

    // destructive edit: clear and commit (blur)
    await input.fill('');
    await input.blur();
    await win.waitForTimeout(900);
    await win.screenshot({ path: path.join(SHOTS, 'tfl776-s4-after-clear.png') });

    const countAfter = await win.locator(SEL).count();
    const value = await win.evaluate((sel) => document.querySelector(sel)?.value ?? null, SEL);
    expect(countAfter, 'exactly one input remains for the field (no duplicate)').toBe(1);
    expect(value ?? '', 'the field value is cleared').toBe('');

    const vacated = { cx: bb.x + bb.width / 2, cy: bb.y + bb.height / 2 };
    await moveAway(win);
    await win.mouse.move(vacated.cx, vacated.cy);
    await win.waitForTimeout(400);
    const hit = await elementAt(win, vacated.cx, vacated.cy);
    const countHover = await win.locator(SEL).count();
    expect(countHover, 'hover does not spawn a second input for the field').toBe(1);

    await win.mouse.click(vacated.cx, vacated.cy);
    await win.waitForTimeout(600);
    const countClick = await win.locator(SEL).count();
    const anyBar = await win.locator('[data-content-action-bar]').count();
    expect(countClick, 'click does not spawn a duplicate/orphan input').toBe(1);
    expect(anyBar, 'click does not open a content action bar').toBe(0);
    await win.screenshot({ path: path.join(SHOTS, 'tfl776-s4-after-click.png') });
    return { value, countAfter, countHover, countClick, hit, anyBar };
  });
});

// ===========================================================================
// SURFACE 5 - Format Painter: destructive edit while armed (delete the source).
// ===========================================================================
test('S5 Format Painter: deleting the armed source leaves the vacated box inert', async () => {
  await surface('S5_format_painter', 'report.pdf', async (win) => {
    const TEXT = 'SWEEP-FP-SRC';
    await scrollToPage(win, 1);
    await armTextBoxTool(win);
    await dragCreateBox(win, TEXT);

    const box = win.locator(`.edit-box[data-edit-box-text="${TEXT}"]`).first();
    await box.click({ position: { x: 8, y: 8 } });
    await win.waitForSelector('[data-edit-box-toolbar]', { timeout: 8000 });
    await win.waitForTimeout(300);
    await win.click('[data-txt-format-painter]');
    await win.waitForFunction(() => document.querySelector('[data-txt-format-painter]')?.getAttribute('aria-pressed') === 'true', undefined, { timeout: 8000 });
    const bb = await box.boundingBox();
    const pageBefore = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.screenshot({ path: path.join(SHOTS, 'tfl776-s5-armed.png') });

    await win.locator('[data-edit-box-action="delete"]').first().click();
    await win.waitForSelector('[data-edit-box-toolbar]', { state: 'detached', timeout: 10000 });
    await win.waitForTimeout(1600);
    await win.screenshot({ path: path.join(SHOTS, 'tfl776-s5-after-delete.png') });
    const boxesAfterDelete = await engineBoxes(win);
    expect(boxesAfterDelete.some((b) => b.text === TEXT), 'the armed source box is deleted').toBe(false);
    const pressed = await win.evaluate(() => document.querySelector('[data-txt-format-painter]')?.getAttribute('aria-pressed') ?? 'MISSING');

    const pageAfter = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    const vacated = {
      cx: bb.x + bb.width / 2 + (pageAfter ? pageAfter.x - pageBefore.x : 0),
      cy: bb.y + bb.height / 2 + (pageAfter ? pageAfter.y - pageBefore.y : 0),
    };
    await moveAway(win);
    await win.mouse.move(vacated.cx, vacated.cy);
    await win.waitForTimeout(500);
    await win.screenshot({ path: path.join(SHOTS, 'tfl776-s5-hover-vacated.png') });
    const staleBox = await win.locator(`.edit-box[data-edit-box-text="${TEXT}"]`).count();
    const toolbar = await win.locator('[data-edit-box-toolbar]').count();
    const hit = await elementAt(win, vacated.cx, vacated.cy);
    expect(staleBox, 'no stale source box over the vacated position').toBe(0);
    expect(toolbar, 'no stale toolbar over the vacated position').toBe(0);
    expect(hit !== null && hit.cls.includes('edit-box'), 'hit is not a stale box').toBe(false);

    // Disarm the placement verb so the vacated click cannot start a legitimate
    // new box; a phantom target would then be the only way a box appears.
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);
    await win.mouse.click(vacated.cx, vacated.cy);
    await win.waitForTimeout(700);
    await win.screenshot({ path: path.join(SHOTS, 'tfl776-s5-after-click.png') });
    const boxesAfterClick = await engineBoxes(win);
    expect(boxesAfterClick.some((b) => b.text === TEXT), 'click does not restore/recreate the box').toBe(false);
    expect(boxesAfterClick.length, 'disarmed click does not create a box at the vacated position').toBe(boxesAfterDelete.length);
    return { painterPressed: pressed, staleBox, toolbar, hit };
  });
});

// ===========================================================================
// SURFACE 6 - Bates / watermark: add, delete, probe the old position.
// ===========================================================================
async function getWm(win) {
  return win.evaluate(async () => {
    const id = window.tflexDiagnostics().engineDocId;
    const r = await window.tflex.engine.getWatermarks(id);
    return r.ok ? r.value.map((w) => w.id) : null;
  });
}
async function getBates(win) {
  return win.evaluate(async () => {
    const id = window.tflexDiagnostics().engineDocId;
    const r = await window.tflex.engine.getBates(id);
    return r.ok ? r.value.map((b) => b.id) : null;
  });
}

test('S6 Bates/watermark: deleting leaves the page position inert', async () => {
  await surface('S6_bates_watermark', 'report.pdf', async (win) => {
    // --- watermark: add, then DELETE via the dialog's own applied-list Delete
    // (data-watermark-delete, the real affordance wired to engine.deleteWatermark).
    await runTool(win, 'watermark');
    await win.waitForSelector('[data-watermark-dialog]', { state: 'visible', timeout: 12000 });
    await win.locator('[data-watermark-text]').fill('SWEEP-WM');
    await win.locator('[data-watermark-confirm]').click();
    await win.waitForTimeout(1600);
    const wmBefore = await getWm(win);
    expect(wmBefore && wmBefore.length >= 1, 'watermark recorded in the engine').toBe(true);
    await win.screenshot({ path: path.join(SHOTS, 'tfl776-s6-watermark-applied.png') });

    // Confirm closes the dialog (App.tsx onWatermarkConfirm -> setWatermarkOpen(false)),
    // so re-open it to reach the applied-watermark list, then delete via the
    // dialog's own Delete (data-watermark-delete -> engine.deleteWatermark).
    await runTool(win, 'watermark');
    await win.waitForSelector('[data-watermark-dialog]', { state: 'visible', timeout: 12000 });
    const wmDel = win.locator('[data-watermark-delete]').first();
    await wmDel.waitFor({ state: 'visible', timeout: 10000 });
    await wmDel.click();
    await win.waitForTimeout(1600);
    const wmAfter = await getWm(win);
    expect(wmAfter && wmAfter.length, 'watermark mirror empty after dialog delete').toBe(0);
    await win.screenshot({ path: path.join(SHOTS, 'tfl776-s6-watermark-deleted.png') });
    await win.locator('[data-watermark-dialog] .modal-close').first().click().catch(() => {});
    await win.keyboard.press('Escape');
    await win.waitForTimeout(500);

    // --- bates via the dialog ---
    await runTool(win, 'bates');
    await win.waitForSelector('[data-bates-dialog]', { state: 'visible', timeout: 12000 });
    await win.locator('[data-bates-prefix]').fill('SWEEP');
    await win.locator('[data-bates-apply]').click();
    await win.waitForTimeout(1800);
    const batesBefore = await getBates(win);
    expect(batesBefore && batesBefore.length >= 1, 'bates run recorded in the engine').toBe(true);
    await win.screenshot({ path: path.join(SHOTS, 'tfl776-s6-bates-applied.png') });
    await win.locator('[data-bates-dialog] .modal-close').first().click().catch(() => {});
    await win.keyboard.press('Escape');
    await win.waitForTimeout(600);

    // Bates delete through the Review elements list (its dialog has no Delete).
    await gotoStage(win, 3);
    await win.waitForTimeout(600);
    const deleteViaPanel = async (type) => {
      const row = win.locator(`[data-review-element-type="${type}"]`).first();
      if ((await row.count()) === 0) return false;
      await row.locator('[data-review-element-delete]').click();
      await win.waitForTimeout(1500);
      return true;
    };
    // Bates has no Delete in its dialog, so delete it through the Review
    // elements list (the real UI path wired to engine.deleteBates); the engine
    // API is a last-resort fallback only.
    const viaPanelBates = await deleteViaPanel('bates');
    if (!viaPanelBates) {
      await win.evaluate(async () => {
        const id = window.tflexDiagnostics().engineDocId;
        const r = await window.tflex.engine.getBates(id);
        for (const b of r.ok ? r.value : []) await window.tflex.engine.deleteBates(id, b.id);
      });
      await win.waitForTimeout(1200);
    }
    const batesAfter = await getBates(win);
    expect(batesAfter && batesAfter.length, 'bates mirror empty after delete').toBe(0);
    await win.screenshot({ path: path.join(SHOTS, 'tfl776-s6-bates-deleted.png') });

    // --- hover/click the old band: must trigger nothing ---
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    const vacated = { cx: pg.x + pg.width / 2, cy: pg.y + pg.height * 0.92 };
    await moveAway(win);
    await win.mouse.move(vacated.cx, vacated.cy);
    await win.waitForTimeout(400);
    const hit = await elementAt(win, vacated.cx, vacated.cy);
    await win.mouse.click(vacated.cx, vacated.cy);
    await win.waitForTimeout(700);
    const annBar = await win.locator('[data-content-action-bar]').count();
    const anns = await engineAnnotations(win);
    expect(annBar, 'no overlay/action bar after the vacated click').toBe(0);
    await win.screenshot({ path: path.join(SHOTS, 'tfl776-s6-after-click.png') });
    return { wmBefore: wmBefore.length, wmAfter: wmAfter.length, wmDeletePath: 'dialog', batesBefore: batesBefore.length, batesAfter: batesAfter.length, viaPanelBates, hit, annBar, annCount: anns.length };
  });
});

// ===========================================================================
// S7 SUMMARY - one row per named surface. Fails the run if any recurrence is
// confirmed (that is the honest bug-hunt signal; the matrix JSON is evidence).
// ===========================================================================
test('S7 summary: per-surface verdict matrix', async () => {
  const expected = [
    'S1_edit_text_control',
    'S2_add_text',
    'S3_annotations',
    'S4_form_fields',
    'S5_format_painter',
    'S6_bates_watermark',
  ];
  const got = new Set(RESULTS.map((r) => r.surface));
  for (const name of expected) expect(got.has(name), `surface ${name} ran`).toBe(true);
  const failed = RESULTS.filter((r) => r.verdict === 'FAIL');
  expect(failed, `no confirmed recurrences: ${JSON.stringify(failed)}`).toEqual([]);
});




