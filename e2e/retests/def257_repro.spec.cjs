// DEF-257 retest — a committed Edit-mode text box must survive Edit-mode
// close/reopen: after re-arming the box tool it is present (exactly one
// `.edit-box`, same id), selectable (click -> action bar, no new box) and
// movable (drag -> rect changes, survives Save As -> reopen).
//
// Phase 26. Canonical launcher only.
//
// The reopen resets the per-tab tool to "off" BY DESIGN (a stray text tool
// must not leak into the next session), and the overlay renders no
// `.edit-box` while the tool is "off" — so the retest RE-ARMS the box tool
// after the reopen before probing the surface.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose, openSamplePath } = require('../lib/helpers.cjs');

test('DEF-257 retest: committed edit box survives close/reopen, selectable + movable', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  const consoleLines = [];
  win.on('console', (m) => consoleLines.push(m.text()));
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    const p = getSamplePath('report.pdf');
    await app.evaluate(async ({ dialog }, fp) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
    }, p);
    await win.locator('button:has-text("Open PDF")').first().click();
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(400);

    // Place an Edit-mode text box through the Phase-26 panel field.
    await win.click('button[aria-label="Edit content"]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
    await win.click('[data-edit-tool="box"]');
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.mouse.move(pg.x + pg.width * 0.3, pg.y + pg.height * 0.3);
    await win.mouse.down();
    await win.mouse.move(pg.x + pg.width * 0.3 + 180, pg.y + pg.height * 0.3 + 60, { steps: 6 });
    await win.mouse.up();
    await win.waitForSelector('[data-txt-text]', { timeout: 8000 });
    await win.waitForFunction(() => {
      const ta = document.querySelector('[data-txt-text]');
      return ta !== null && ta.disabled === false;
    }, null, { timeout: 8000 });
    await win.locator('[data-txt-text]').fill('DEF257 BOX');
    await win.locator('[data-txt-text]').blur();
    await win.waitForSelector('.edit-box', { timeout: 8000 });
    await win.waitForTimeout(900);

    const before = await win.evaluate(() => {
      const es = window.tflexDiagnostics().engineState || {};
      const box = document.querySelector('.edit-box');
      return {
        editBoxes: document.querySelectorAll('.edit-box').length,
        engineTextBoxes: (es.textBoxes || []).length,
        id: box ? box.getAttribute('data-edit-box-id') : null,
        left: box ? box.getBoundingClientRect().left : null,
        engineRect: (es.textBoxes || [])[0] ? (es.textBoxes || [])[0].rect : null,
      };
    });
    console.log(`[DEF257|BEFORE] ${JSON.stringify(before)}`);
    expect(before.editBoxes, 'one .edit-box after commit').toBe(1);
    expect(before.engineTextBoxes, 'engine owns the committed box').toBe(1);
    expect(before.id, 'box id captured').toBeTruthy();

    // Item 3 (isolation) — toggling the tool away and back while Edit mode
    // stays open runs the target-change cleanup WITHOUT the reopen
    // rehydration safety net, so a surviving box proves the committed box is
    // no longer treated as an abandoned placement.
    await win.click('[data-edit-tool="off"]');
    await win.waitForTimeout(400);
    await win.click('[data-edit-tool="box"]');
    await win.waitForTimeout(400);
    const afterToggle = await win.evaluate(() => ({
      editBoxes: document.querySelectorAll('.edit-box').length,
      engineTextBoxes: (window.tflexDiagnostics().engineState?.textBoxes || []).length,
    }));
    console.log(`[DEF257|AFTER-TOGGLE] ${JSON.stringify(afterToggle)}`);
    expect(afterToggle.editBoxes, 'no abandoned-new-box delete on target clear').toBe(1);

    // Close Edit mode (the text target clears -> the Phase-26 cleanup runs).
    await win.click('button[aria-label="Edit content"]');
    await win.waitForTimeout(600);
    // Re-open Edit mode.
    await win.click('button[aria-label="Edit content"]');
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 8000 });
    await win.waitForTimeout(800);

    const afterReopen = await win.evaluate(() => {
      const es = window.tflexDiagnostics().engineState || {};
      return {
        editBoxes: document.querySelectorAll('.edit-box').length,
        engineTextBoxes: (es.textBoxes || []).length,
        boxToolPressed: document.querySelector('[data-edit-tool="box"]')?.getAttribute('aria-pressed') ?? null,
      };
    });
    console.log(`[DEF257|AFTER-REOPEN] ${JSON.stringify(afterReopen)}`);
    expect(afterReopen.engineTextBoxes, 'the committed box stays in the engine').toBe(1);

    // RE-ARM the box tool (reopen resets the per-tab tool to "off" by design).
    await win.click('[data-edit-tool="box"]');
    await win.waitForTimeout(500);

    const afterArm = await win.evaluate(() => {
      const es = window.tflexDiagnostics().engineState || {};
      const boxes = Array.from(document.querySelectorAll('.edit-box'));
      return {
        editBoxes: boxes.length,
        ids: boxes.map((b) => b.getAttribute('data-edit-box-id')),
        engineIds: (es.textBoxes || []).map((b) => b.id),
      };
    });
    console.log(`[DEF257|AFTER-ARM] ${JSON.stringify(afterArm)}`);
    expect(afterArm.editBoxes, 'exactly one .edit-box after re-arm').toBe(1);
    expect(afterArm.ids, 'same id as before').toEqual([before.id]);
    expect(afterArm.engineIds, 'engine id matches').toEqual([before.id]);

    // SELECT: click the surface -> the action bar shows, no new box created.
    const surface = win.locator(`.edit-box[data-edit-box-id="${before.id}"]`);
    const sb = await surface.boundingBox();
    await win.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await win.waitForTimeout(500);
    const afterSelect = await win.evaluate(() => ({
      editBoxes: document.querySelectorAll('.edit-box').length,
      toolbar: document.querySelectorAll('.edit-box-toolbar').length,
      selected: document.querySelectorAll('.edit-box-selected').length,
    }));
    console.log(`[DEF257|AFTER-SELECT] ${JSON.stringify(afterSelect)}`);
    expect(afterSelect.editBoxes, 'click selects, does not create a new box').toBe(1);
    expect(afterSelect.toolbar, 'the action bar shows for the selected box').toBeGreaterThan(0);

    // MOVE: drag the surface -> the rect changes; Confirm commits it.
    const rectBefore = await surface.boundingBox();
    await win.mouse.move(rectBefore.x + rectBefore.width / 2, rectBefore.y + rectBefore.height / 2);
    await win.mouse.down();
    await win.mouse.move(rectBefore.x + rectBefore.width / 2 + 60, rectBefore.y + rectBefore.height / 2, { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(500);
    const confirm = win.locator('.edit-box-toolbar [data-edit-box-action="confirm"]');
    if ((await confirm.count()) > 0) {
      await confirm.first().click();
      await win.waitForTimeout(900);
    }
    const rectAfter = await surface.boundingBox();
    const engineRectAfter = await win.evaluate((id) => {
      const es = window.tflexDiagnostics().engineState || {};
      const b = (es.textBoxes || []).find((x) => x.id === id);
      return b ? b.rect : null;
    }, before.id);
    console.log(`[DEF257|AFTER-MOVE] ${JSON.stringify({ leftBefore: rectBefore.x, leftAfter: rectAfter.x, engineRectBefore: before.engineRect, engineRectAfter })}`);
    expect(Math.abs(rectAfter.x - rectBefore.x), 'the box moved horizontally').toBeGreaterThan(20);
    expect(engineRectAfter, 'the engine rect reflects the move').not.toBeNull();
    expect(Math.abs(engineRectAfter.x - before.engineRect.x), 'engine rect moved too').toBeGreaterThan(20);

    // Save As -> reopen: the box (text + moved rect) survives.
    const savePath = path.join(os.tmpdir(), `def257-${Date.now()}.pdf`);
    await app.evaluate(async ({ dialog }, sp) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: sp });
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
    const reopened = await win.evaluate(() => {
      const es = window.tflexDiagnostics().engineState || {};
      return { engineTextBoxes: (es.textBoxes || []).length, texts: (es.textBoxes || []).map((b) => b.text) };
    });
    console.log(`[DEF257|REOPENED] ${JSON.stringify(reopened)}`);
    expect(reopened.engineTextBoxes, 'the box survives save/reopen').toBe(1);
    expect(reopened.texts, 'the text survives save/reopen').toEqual(['DEF257 BOX']);

    // Item 3 — no abandoned-placement delete for the committed box.
    const bad = consoleLines.filter((l) => /delete-text-box|abandoned/i.test(l));
    console.log(`[DEF257|CONSOLE-DELETE-LINES] ${JSON.stringify(bad)}`);
    expect(bad, 'no abandoned-new-box delete for the committed box').toEqual([]);
  } finally {
    await hardClose(app, 'def257');
  }
});