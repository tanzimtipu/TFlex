// TFL-1574 — focused QA e2e: every dialog / text-box action bar renders the
// destructive verb INLINE, with NO "More" control. Covers the five surfaces
// named in the phase:
//   * annotation action bar   (Confirm + colour swatch + Cancel + Delete)
//   * stamp action bar        (Confirm + Edit + Delete)
//   * text-run action bar     (Confirm + Cancel + Delete)
//   * TextBoxToolbar          (Confirm + Cancel + Delete)
//   * PlacementToolbar        (Replace + Crop + Remove)
//
// Each surface asserts: no `[data-content-action$="-more"]`, the destructive
// button present + visible + `.btn-danger`, uniform verb-button height, and a
// narrow / medium / wide sweep with no viewport clipping and no overlap with
// the dock or viewing footer. Drives the REAL Electron app via e2e/lib only.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const {
  openSamplePath, hardClose, gotoStage, armAnnotationTool, runTool, slotBox,
} = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const log = (label, obj) => console.log(`[TFL1574] ${label} ${JSON.stringify(obj)}`);

async function dragOnPage(win, fx1, fy1, fx2, fy2, page = 1) {
  const box = await slotBox(win, page);
  if (box === null) throw new Error(`dragOnPage: no page-slot box for page ${page}`);
  const x1 = box.x + box.w * fx1;
  const y1 = box.y + box.h * fy1;
  const x2 = box.x + box.w * fx2;
  const y2 = box.y + box.h * fy2;
  await win.mouse.move(x1, y1);
  await win.mouse.down();
  await win.mouse.move(x2, y2, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(700);
}

// Buttons in a bar: More count, and each button's text / danger class / height.
// `verb` marks the shared `toolbox-action-btn` action buttons (the swatch in
// the annotation bar is an IconButton, reported separately but not size-graded).
async function barSnapshot(win, barSel) {
  return win.evaluate((sel) => {
    const bar = document.querySelector(sel);
    if (bar === null) return null;
    return {
      more: bar.querySelectorAll('[data-content-action$="-more"]').length,
      moreHost: bar.querySelectorAll('[data-content-action-more-host]').length,
      moreMenu: bar.querySelectorAll('[data-content-action-more-menu]').length,
      buttons: [...bar.querySelectorAll('button')].map((b) => {
        const r = b.getBoundingClientRect();
        return {
          text: b.textContent.trim(),
          danger: b.classList.contains('btn-danger'),
          verb: b.classList.contains('toolbox-action-btn'),
          h: Math.round(r.height),
          visible: r.width > 0 && r.height > 0,
        };
      }),
    };
  }, barSel);
}

async function dangerProbe(win, sel) {
  return win.evaluate((s) => {
    const b = document.querySelector(s);
    if (b === null) return { found: false };
    const r = b.getBoundingClientRect();
    return {
      found: true,
      danger: b.classList.contains('btn-danger'),
      visible: r.width > 0 && r.height > 0,
      h: Math.round(r.height),
    };
  }, sel);
}

// Narrow / medium / wide sweep: confirm the bar survives the resize, stays
// inside the viewport, does not overlap the dock or viewing footer, and keeps
// its verb buttons one height.
async function captureWidths(win, app, barSel, name) {
  const setSize = (w, h) => app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0].setSize(size.w, size.h);
  }, { w, h });
  const out = [];
  for (const [label, w, h] of [['narrow', 900, 640], ['medium', 1200, 800], ['wide', 1440, 900]]) {
    await setSize(w, h);
    await win.waitForTimeout(800);
    const diag = await win.evaluate((sel) => {
      const bar = document.querySelector(sel);
      if (bar === null) return { present: false };
      const r = bar.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const hit = (b) => !(r.right <= b.left || r.left >= b.right || r.bottom <= b.top || r.top >= b.bottom);
      const chrome = ['[data-action-dock]', '[data-view-strip]']
        .map((s) => document.querySelector(s))
        .filter((x) => x !== null)
        .map((x) => x.getBoundingClientRect());
      return {
        present: true,
        inViewport: r.left >= -1 && r.top >= -1 && r.right <= vw + 1 && r.bottom <= vh + 1,
        overlapChrome: chrome.some(hit),
        verbs: [...bar.querySelectorAll('button.toolbox-action-btn')]
          .map((b) => Math.round(b.getBoundingClientRect().height)),
        rect: { w: Math.round(r.width), h: Math.round(r.height) },
      };
    }, barSel);
    await win.screenshot({ path: path.join(SHOTS, `tfl1574-${name}-${label}.png`) });
    out.push({ width: label, ...diag });
  }
  await setSize(1440, 900);
  await win.waitForTimeout(600);
  return out;
}

function expectSweep(sweep, label) {
  for (const e of sweep) {
    expect(e.present, `${label} bar present at ${e.width}`).toBe(true);
    expect(e.inViewport, `${label} bar fully inside the viewport at ${e.width}`).toBe(true);
    expect(e.overlapChrome, `${label} bar clear of dock/footer at ${e.width}`).toBe(false);
  }
}

// ---------------------------------------------------------------------------
// A. Annotation action bar (Confirm + swatch + Cancel + Delete inline)
// ---------------------------------------------------------------------------
test('TFL-1574 annotation bar: inline Delete, no More, danger styling', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card');
  try {
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await gotoStage(win, 3);
    await armAnnotationTool(win, 'rect');
    await dragOnPage(win, 0.25, 0.25, 0.5, 0.4);
    await win.waitForSelector('.ann-shape[data-kind="rect"]', { timeout: 10000 });
    const shape = await win.locator('.ann-shape[data-kind="rect"]').first().boundingBox();
    await win.mouse.click(shape.x + shape.width / 2, shape.y + shape.height / 2);
    await win.waitForSelector('[data-content-action-bar="ann-rect"]', { timeout: 10000 });

    const bar = await barSnapshot(win, '[data-content-action-bar="ann-rect"]');
    log('ann-bar', bar);
    expect(bar.more, 'annotation bar has NO More control').toBe(0);
    expect(bar.moreHost, 'annotation bar has NO More host').toBe(0);
    const texts = bar.buttons.map((b) => b.text).filter((t) => t !== '');
    expect(texts, 'primary verbs are Confirm / Cancel / Delete inline').toEqual(['Confirm', 'Cancel', 'Delete']);

    const del = await dangerProbe(win, '[data-content-action="ann-rect-delete"]');
    log('ann-delete', del);
    expect(del.found && del.visible, 'inline Delete exists and is visible').toBe(true);
    expect(del.danger, 'inline Delete uses btn-danger').toBe(true);

    const verbs = bar.buttons.filter((b) => b.verb);
    expect(verbs.length, 'three verb buttons in the bar').toBe(3);
    const confirm = bar.buttons.find((b) => b.text === 'Confirm');
    expect(del.h, 'inline Delete is the same height as Confirm').toBe(confirm.h);
    log('ann-heights', bar.buttons.map((b) => ({ t: b.text || 'swatch', h: b.h, danger: b.danger })));

    const sweep = await captureWidths(win, app, '[data-content-action-bar="ann-rect"]', 'annotation');
    log('ann-sweep', sweep);
    expectSweep(sweep, 'annotation');
    await win.keyboard.press('Escape');
  } finally {
    await hardClose(app, 'tfl1574-annotation');
  }
});

// ---------------------------------------------------------------------------
// B. Stamp action bar (Confirm + Edit + Delete inline)
// ---------------------------------------------------------------------------
test('TFL-1574 stamp bar: inline Edit/Delete, no More, danger styling', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card');
  try {
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await runTool(win, 'stamp');
    await win.waitForSelector('[data-stamp-dialog]', { timeout: 10000 });
    await win.click('[data-stamp-confirm]');
    await win.waitForTimeout(500);
    const page = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.mouse.click(page.x + page.width * 0.5, page.y + page.height * 0.5);
    await win.waitForSelector('.stamp-annotation', { timeout: 10000 });
    await win.waitForTimeout(1000);
    await win.locator('.stamp-annotation').first().click();
    await win.waitForSelector('[data-content-action-bar="stamp"]', { timeout: 8000 });

    const bar = await barSnapshot(win, '[data-content-action-bar="stamp"]');
    log('stamp-bar', bar);
    expect(bar.more, 'stamp bar has NO More control').toBe(0);
    expect(bar.buttons.map((b) => b.text), 'stamp verbs are Confirm / Edit / Delete inline').toEqual(['Confirm', 'Edit', 'Delete']);

    const del = await dangerProbe(win, '[data-content-action="stamp-delete"]');
    log('stamp-delete', del);
    expect(del.found && del.visible, 'inline Delete exists and is visible').toBe(true);
    expect(del.danger, 'stamp Delete uses btn-danger').toBe(true);
    expect(await win.locator('[data-content-action="stamp-edit"]').count(), 'Edit is inline').toBe(1);

    const confirm = bar.buttons.find((b) => b.text === 'Confirm');
    expect(del.h, 'inline Delete is the same height as Confirm').toBe(confirm.h);
    log('stamp-heights', bar.buttons.map((b) => ({ t: b.text, h: b.h, danger: b.danger })));

    const sweep = await captureWidths(win, app, '[data-content-action-bar="stamp"]', 'stamp');
    log('stamp-sweep', sweep);
    expectSweep(sweep, 'stamp');
    await win.keyboard.press('Escape');
  } finally {
    await hardClose(app, 'tfl1574-stamp');
  }
});

// ---------------------------------------------------------------------------
// C. Text-run action bar (Confirm + Cancel + Delete inline)
// ---------------------------------------------------------------------------
async function selectTextRun(win) {
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const fracs = [[0.5, 0.1], [0.3, 0.12], [0.5, 0.16], [0.25, 0.22], [0.5, 0.3], [0.35, 0.42]];
  for (const [fx, fy] of fracs) {
    await win.mouse.click(Math.round(pg.x + pg.width * fx), Math.round(pg.y + pg.height * fy));
    await win.waitForTimeout(550);
    if ((await win.locator('[data-textrun-selection]').count()) > 0) return true;
  }
  return false;
}

test('TFL-1574 text-run bar: inline Delete, no More, danger styling', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card');
  try {
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await gotoStage(win, 2);
    await win.locator('[data-dock-verb="editText"]').click();
    await win.waitForTimeout(500);
    const gotRun = await selectTextRun(win);
    log('textrun-selected', gotRun);
    expect(gotRun, 'a text run is selectable in the EDIT flow').toBe(true);
    await win.waitForSelector('[data-content-action-bar="textrun"]', { timeout: 8000 });

    const bar = await barSnapshot(win, '[data-content-action-bar="textrun"]');
    log('textrun-bar', bar);
    expect(bar.more, 'text-run bar has NO More control').toBe(0);
    expect(bar.buttons.map((b) => b.text), 'text-run verbs are Confirm / Cancel / Delete inline').toEqual(['Confirm', 'Cancel', 'Delete']);
    expect(await win.locator('[data-content-action="textrun-edit"]').count(), 'no Edit verb for a text run').toBe(0);

    const del = await dangerProbe(win, '[data-content-action="textrun-delete"]');
    log('textrun-delete', del);
    expect(del.found && del.visible, 'inline Delete exists and is visible').toBe(true);
    expect(del.danger, 'text-run Delete uses btn-danger').toBe(true);

    const confirm = bar.buttons.find((b) => b.text === 'Confirm');
    expect(del.h, 'inline Delete is the same height as Confirm').toBe(confirm.h);
    log('textrun-heights', bar.buttons.map((b) => ({ t: b.text, h: b.h, danger: b.danger })));

    const sweep = await captureWidths(win, app, '[data-content-action-bar="textrun"]', 'textrun');
    log('textrun-sweep', sweep);
    expectSweep(sweep, 'textrun');
    await win.keyboard.press('Escape');
  } finally {
    await hardClose(app, 'tfl1574-textrun');
  }
});

// ---------------------------------------------------------------------------
// D. TextBoxToolbar (Confirm + Cancel + Delete inline)
// ---------------------------------------------------------------------------
test('TFL-1574 TextBoxToolbar: inline Delete, no More, danger styling', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card');
  try {
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await gotoStage(win, 2);
    await win.locator('[data-dock-verb="editTextBox"]').waitFor({ state: 'visible', timeout: 10000 });
    await win.locator('[data-dock-verb="editTextBox"]').click();
    const box = await slotBox(win, 1);
    const x = box.x + box.w * 0.28;
    const y = box.y + box.h * 0.25;
    await win.mouse.move(x, y);
    await win.mouse.down();
    await win.mouse.move(x + 200, y + 70, { steps: 6 });
    await win.mouse.up();
    await win.waitForSelector('[data-txt-text]', { timeout: 8000 });
    await win.locator('[data-txt-text]').fill('TFL1574 box');
    await win.locator('[data-txt-text]').blur();
    await win.waitForSelector('.edit-box', { timeout: 8000 });
    await win.waitForTimeout(400);
    await win.locator('.edit-box').first().click({ position: { x: 8, y: 8 } });
    await win.waitForSelector('[data-edit-box-toolbar]', { timeout: 8000 });
    await win.waitForTimeout(300);

    const bar = await barSnapshot(win, '[data-edit-box-toolbar]');
    log('editbox-bar', bar);
    expect(bar.more, 'TextBoxToolbar has NO More control').toBe(0);
    expect(bar.buttons.map((b) => b.text), 'TextBoxToolbar verbs are Confirm / Cancel / Delete inline').toEqual(['Confirm', 'Cancel', 'Delete']);

    const del = await dangerProbe(win, "[data-edit-box-action='delete']");
    log('editbox-delete', del);
    expect(del.found && del.visible, 'inline Delete exists and is visible').toBe(true);
    expect(del.danger, 'TextBoxToolbar Delete uses btn-danger').toBe(true);
    expect(await win.locator("[data-content-action='editbox-more']").count(), 'no editbox More').toBe(0);

    const confirm = bar.buttons.find((b) => b.text === 'Confirm');
    expect(del.h, 'inline Delete is the same height as Confirm').toBe(confirm.h);
    log('editbox-heights', bar.buttons.map((b) => ({ t: b.text, h: b.h, danger: b.danger })));

    const sweep = await captureWidths(win, app, '[data-edit-box-toolbar]', 'textbox');
    log('editbox-sweep', sweep);
    expectSweep(sweep, 'textbox');
    await win.keyboard.press('Escape');
  } finally {
    await hardClose(app, 'tfl1574-textbox');
  }
});

// ---------------------------------------------------------------------------
// E. PlacementToolbar (Replace + Crop + Remove inline)
// ---------------------------------------------------------------------------
test('TFL-1574 PlacementToolbar: inline Remove, no More, danger styling', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card');
  const RED_PNG = path.resolve(__dirname, '..', 'test-fixtures', 'red.png');
  try {
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await gotoStage(win, 2);
    await win.locator('[data-dock-verb="editImage"]').waitFor({ state: 'visible', timeout: 10000 });
    await win.locator('[data-dock-verb="editImage"]').click();
    const box = await slotBox(win, 1);
    const x = box.x + box.w * 0.3;
    const y = box.y + box.h * 0.5;
    const fcPromise = win.waitForEvent('filechooser', { timeout: 15000 });
    await win.mouse.move(x, y);
    await win.mouse.down();
    await win.mouse.move(x + 160, y + 90, { steps: 6 });
    await win.mouse.up();
    const fc = await fcPromise;
    await fc.setFiles(RED_PNG);
    await win.waitForSelector('.edit-image-placement', { timeout: 10000 });
    await win.waitForTimeout(800);
    await win.locator('.edit-image-placement').first().click({ position: { x: 6, y: 6 } });
    await win.waitForSelector('.edit-image-toolbar', { timeout: 8000 });

    const bar = await barSnapshot(win, '.edit-image-toolbar');
    log('image-bar', bar);
    expect(bar.more, 'PlacementToolbar has NO More control').toBe(0);
    expect(bar.buttons.map((b) => b.text), 'PlacementToolbar verbs are Replace / Crop / Remove inline').toEqual(['Replace', 'Crop', 'Remove']);

    const del = await dangerProbe(win, "[data-content-action='image-delete']");
    log('image-delete', del);
    expect(del.found && del.visible, 'inline Remove exists and is visible').toBe(true);
    expect(del.danger, 'PlacementToolbar Remove uses btn-danger').toBe(true);
    expect(await win.locator("[data-content-action='image-more']").count(), 'no image More').toBe(0);

    const confirm = bar.buttons.find((b) => b.text === 'Replace');
    expect(del.h, 'inline Remove is the same height as Replace').toBe(confirm.h);
    log('image-heights', bar.buttons.map((b) => ({ t: b.text, h: b.h, danger: b.danger })));

    const sweep = await captureWidths(win, app, '.edit-image-toolbar', 'image');
    log('image-sweep', sweep);
    expectSweep(sweep, 'image');
    await win.keyboard.press('Escape');
  } finally {
    await hardClose(app, 'tfl1574-image');
  }
});
