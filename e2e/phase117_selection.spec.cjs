// Phase 117 (chunk G) — focused QA e2e for the Selection and Manipulation
// surface. Drives the REAL Electron app through e2e/lib/launch.cjs only.
//
// CONTROL-INDEX rows exercised here (paired with the phase117 unit specs):
//   * a selected annotation draws the shared boundary + four
//     `data-selection-handle` corners and the separated More / Delete;
//   * a text box and an image draw the same shared chrome with Confirm /
//     Cancel primary and Delete behind More (`data-content-action="*-delete"`);
//   * a crop region draws the shared handles inside CropPagesDialog;
//   * a form widget renders NO `[data-selection-boundary]`;
//   * a context control stays clear of the dock / viewing footer;
//   * selecting an object never marks the document dirty.
//
// The generic Open goes through the Intake-staging helper: the native picker
// does not emit a browser filechooser event. The EDIT image tool uses an HTML
// <input type=file>, which DOES emit one, so that path uses waitForEvent.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const {
  openSamplePath, hardClose, gotoStage, clickDockVerb, armAnnotationTool, slotBox, setTheme,
} = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const log = (label, obj) => console.log(`[P117] ${label} ${JSON.stringify(obj)}`);

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

const modified = (win) => win.evaluate(() => window.tflexDiagnostics().modified === true);

async function chromeSnapshot(win, kindExpect) {
  return win.evaluate((kind) => {
    const boundary = document.querySelector('[data-selection-boundary]');
    const handles = Array.from(document.querySelectorAll('[data-selection-handle]'));
    return {
      hasBoundary: boundary !== null,
      kind: boundary ? boundary.getAttribute('data-selection-kind') : null,
      kindMatches: boundary ? boundary.getAttribute('data-selection-kind') === kind : false,
      handleCount: handles.length,
      handleCorners: handles.map((h) => h.getAttribute('data-selection-handle')).sort(),
    };
  }, kindExpect);
}

// A context control must not overlap the dock or the viewing footer.
async function overlapsChrome(win, selector) {
  return win.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) return { found: false };
    const a = el.getBoundingClientRect();
    const rects = ['[data-action-dock]', '[data-view-strip]', '[data-canvas-pills]']
      .map((s) => document.querySelector(s))
      .filter((x) => x !== null)
      .map((x) => x.getBoundingClientRect());
    const hit = (b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
    return {
      found: true,
      overlap: rects.some(hit),
      bar: { x: Math.round(a.x), y: Math.round(a.y), w: Math.round(a.width), h: Math.round(a.height) },
    };
  }, selector);
}

test('Phase 117 selection surface — annotation, text box, image, crop, form, dirty', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card');
  try {
    await test.step('crop region: shared handles + pure selection does not dirty', async () => {
      await openSamplePath(win, app, getSamplePath('report.pdf'));
      expect(await modified(win), 'a freshly opened document is not dirty').toBe(false);
      await clickDockVerb(win, 1, 'cropPages');
      await win.waitForSelector('[data-crop-editor]', { timeout: 10000 });
      const crop = await win.evaluate(() => {
        const editor = document.querySelector('[data-crop-editor]');
        const boundary = editor && editor.querySelector('.selection-chrome.is-selected[data-selection-boundary]');
        const corners = Array.from(editor ? editor.querySelectorAll('[data-crop-handle]') : [])
          .map((h) => h.getAttribute('data-crop-handle')).sort();
        return { hasBoundary: boundary !== null, corners };
      });
      log('crop-chrome', crop);
      expect(crop.hasBoundary, 'crop region draws the shared boundary').toBe(true);
      expect(crop.corners).toContain('nw');
      expect(crop.corners).toContain('ne');
      expect(crop.corners).toContain('sw');
      expect(crop.corners).toContain('se');
      expect(await modified(win), 'selecting a crop region must not mark the document dirty').toBe(false);
      await win.screenshot({ path: path.join(SHOTS, 'phase117-crop-selection.png') });
      await win.keyboard.press('Escape');
      await win.waitForTimeout(400);
    });

    await test.step('annotation: shared boundary + 4 handles + separated More/Delete', async () => {
      await gotoStage(win, 3);
      await armAnnotationTool(win, 'rect');
      await dragOnPage(win, 0.25, 0.25, 0.5, 0.4);
      await win.waitForSelector('.ann-shape[data-kind="rect"]', { timeout: 10000 });
      const shape = await win.locator('.ann-shape[data-kind="rect"]').first().boundingBox();
      await win.mouse.click(shape.x + shape.width / 2, shape.y + shape.height / 2);
      await win.waitForSelector('[data-content-action-bar="ann-rect"]', { timeout: 10000 });
      const chrome = await chromeSnapshot(win, 'annotation');
      log('ann-chrome', chrome);
      expect(chrome.hasBoundary, 'annotation renders the shared boundary').toBe(true);
      expect(chrome.kind).toBe('annotation');
      expect(chrome.handleCount, 'annotation renders four shared handles').toBe(4);
      expect(chrome.handleCorners).toEqual(['ne', 'nw', 'se', 'sw']);
      // Separated More / Delete: Delete absent until More opens.
      expect(await win.locator('[data-content-action="ann-rect-more"]').count()).toBeGreaterThan(0);
      expect(await win.locator('[data-content-action="ann-rect-delete"]').count()).toBe(0);
      await win.locator('[data-content-action="ann-rect-more"]').first().click();
      await expect(win.locator('[data-content-action="ann-rect-delete"]')).toHaveCount(1);
      await win.keyboard.press('Escape');
      // Context control clear of the dock / viewing footer.
      const ov = await overlapsChrome(win, '[data-content-action-bar="ann-rect"]');
      log('ann-bar-overlap', ov);
      expect(ov.found).toBe(true);
      expect(ov.overlap, 'context control must not overlap dock or viewing footer').toBe(false);
      // Creating the rect IS a real edit, so a RE-selection must not further
      // change `modified`.
      const dirtyAfterCreate = await modified(win);
      const shape2 = await win.locator('.ann-shape[data-kind="rect"]').first().boundingBox();
      await win.mouse.click(shape2.x + shape2.width / 2, shape2.y + shape2.height / 2);
      await win.waitForSelector('[data-content-action-bar="ann-rect"]', { timeout: 10000 });
      expect(await modified(win), 're-selecting must not change the dirty flag').toBe(dirtyAfterCreate);
      await win.screenshot({ path: path.join(SHOTS, 'phase117-annotation-selection.png') });
      await win.locator('[data-content-action="ann-rect-confirm"]').first().click();
      await win.waitForTimeout(400);
    });
  } finally {
    await hardClose(app, 'phase117-ann-crop');
  }
});

test('Phase 117 selection surface — text box + image shared chrome, Delete behind More', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card');
  const RED_PNG = path.resolve(__dirname, '..', 'test-fixtures', 'red.png');
  try {
    await openSamplePath(win, app, getSamplePath('report.pdf'));

    await test.step('text box: shared chrome + Confirm/Cancel primary, Delete behind More', async () => {
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
      await win.locator('[data-txt-text]').fill('Phase117 box');
      await win.locator('[data-txt-text]').blur();
      await win.waitForSelector('.edit-box', { timeout: 8000 });
      await win.waitForTimeout(400);
      await win.locator('.edit-box').first().click({ position: { x: 8, y: 8 } });
      await win.waitForSelector('[data-edit-box-toolbar]', { timeout: 8000 });
      await win.waitForTimeout(300);
      const chrome = await chromeSnapshot(win, 'textBox');
      log('textbox-chrome', chrome);
      expect(chrome.hasBoundary, 'text box renders the shared boundary').toBe(true);
      expect(chrome.kind).toBe('textBox');
      expect(chrome.handleCount, 'text box renders four shared handles').toBe(4);
      // Primary row = Confirm + Cancel; Delete is not a sibling until More opens.
      const primary = await win.evaluate(() =>
        [...document.querySelectorAll('[data-edit-box-toolbar] button')]
          .filter((b) => b.closest('.content-action-more-menu') === null)
          .map((b) => b.textContent.trim()));
      log('textbox-primary', primary);
      expect(primary).toContain('Confirm');
      expect(primary).toContain('Cancel');
      expect(primary).not.toContain('Delete');
      expect(await win.locator("[data-edit-box-action='delete']").count()).toBe(0);
      expect(await win.locator("[data-content-action='editbox-more']").count()).toBeGreaterThan(0);
      await win.locator("[data-content-action='editbox-more']").first().click();
      await expect(win.locator("[data-edit-box-action='delete']")).toHaveCount(1);
      await win.screenshot({ path: path.join(SHOTS, 'phase117-textbox-selection.png') });
      await win.keyboard.press('Escape');
    });

    await test.step('image: shared chrome + Delete behind More', async () => {
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
      await win.waitForSelector("[data-content-action='image-more']", { timeout: 8000 });
      const chrome = await chromeSnapshot(win, 'image');
      log('image-chrome', chrome);
      expect(chrome.hasBoundary, 'image renders the shared boundary').toBe(true);
      expect(chrome.kind).toBe('image');
      expect(chrome.handleCount, 'image renders four shared handles').toBe(4);
      expect(await win.locator("[data-content-action='image-more']").count()).toBeGreaterThan(0);
      expect(await win.locator("[data-content-action='image-delete']").count()).toBe(0);
      await win.locator("[data-content-action='image-more']").first().click();
      await expect(win.locator("[data-content-action='image-delete']")).toHaveCount(1);
      await win.keyboard.press('Escape');
      await win.screenshot({ path: path.join(SHOTS, 'phase117-image-selection.png') });
    });
  } finally {
    await hardClose(app, 'phase117-edit');
  }
});

test('Phase 117 selection surface — form widget has NO selection boundary and is not dirty', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card');
  try {
    await openSamplePath(win, app, getSamplePath('form.pdf'));
    await expect.poll(() => win.evaluate(() => (window.tflexDiagnostics().formFields || []).length)).toBeGreaterThan(0);
    await win.waitForSelector('[data-form-field]', { timeout: 15000 });
    const form = await win.evaluate(() => ({
      fields: document.querySelectorAll('[data-form-field]').length,
      boundaries: document.querySelectorAll('[data-selection-boundary]').length,
      chrome: document.querySelectorAll('.selection-chrome').length,
      modified: window.tflexDiagnostics().modified === true,
    }));
    log('form-chrome', form);
    expect(form.fields, 'the form overlay renders real form widgets').toBeGreaterThan(0);
    expect(form.boundaries, 'a form widget renders NO shared selection boundary').toBe(0);
    expect(form.chrome, 'no object selection chrome bleeds onto a form widget').toBe(0);
    expect(form.modified, 'opening a form and rendering its widgets is not dirty').toBe(false);
    await win.screenshot({ path: path.join(SHOTS, 'phase117-form-no-boundary.png') });
  } finally {
    await hardClose(app, 'phase117-form');
  }
});

test('Phase 117 adaptation screenshots � full light/dark, compact, high contrast, reduced motion, 200%', async () => {
  const app = await launchApp();
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card');
  const setSize = async (w, h) => app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0].setSize(size.w, size.h);
  }, { w, h });
  try {
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    await gotoStage(win, 3);
    await armAnnotationTool(win, 'rect');
    await dragOnPage(win, 0.3, 0.3, 0.5, 0.45);
    await win.waitForSelector('.ann-shape[data-kind="rect"]', { timeout: 10000 });
    const bb = await win.locator('.ann-shape[data-kind="rect"]').first().boundingBox();
    await win.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.waitForSelector('[data-content-action-bar="ann-rect"]', { timeout: 10000 });

    await setTheme(win, 'light');
    await setSize(1440, 900);
    await win.waitForTimeout(900);
    await win.screenshot({ path: path.join(SHOTS, 'phase117-full-light.png') });

    await setTheme(win, 'dark');
    await win.waitForTimeout(700);
    await win.screenshot({ path: path.join(SHOTS, 'phase117-full-dark.png') });

    await setTheme(win, 'light');
    await setSize(900, 640);
    await win.waitForTimeout(900);
    await win.screenshot({ path: path.join(SHOTS, 'phase117-compact-light.png') });

    await setSize(1440, 900);
    await win.emulateMedia({ forcedColors: 'active' });
    await win.waitForTimeout(700);
    await win.screenshot({ path: path.join(SHOTS, 'phase117-highcontrast.png') });
    await win.emulateMedia({ forcedColors: 'none' });

    await win.emulateMedia({ reducedMotion: 'reduce' });
    await win.waitForTimeout(500);
    await win.screenshot({ path: path.join(SHOTS, 'phase117-reduced-motion.png') });
    await win.emulateMedia({ reducedMotion: 'no-preference' });

    await win.evaluate(() => { document.documentElement.style.zoom = '200%'; });
    await win.waitForTimeout(700);
    await win.screenshot({ path: path.join(SHOTS, 'phase117-zoom200.png') });
    await win.evaluate(() => { document.documentElement.style.zoom = '100%'; });
  } finally {
    await hardClose(app, 'phase117-adaptation');
  }
});
