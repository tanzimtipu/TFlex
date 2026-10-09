// Phase 18 part 1 — Watermark: dock gate, live preview + position grid,
// text/typography/opacity apply (timed) + baked pixel proof.
//
// Compact validation spec: exactly 4 tests, one serial describe, a single
// launchApp in beforeAll (canonical launcher e2e/lib/launch.cjs). State is
// cumulative by design: T1 opens the bundled report.pdf and the dialog,
// T2 exercises preview + the 9-slot grid, T3 applies a full text watermark
// (all pages) and verifies the engine record, T4 captures the baked page.
//
// Selector note: the dialog markup now carries the missing-image indicator
// as `[data-watermark-preview-missing]` (the class is kept for styling).
// T2 asserts that data attribute directly — no class fallback.
//
// T4 is a real pixel proof: T3 snapshots the page-1 top-left quadrant (the
// watermark target) and the bottom-right control quadrant from the live
// pdf.js canvas BEFORE the apply; T4 re-samples both after the proxy
// refresh and asserts a visible, localised change.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { openSample, shot, hardClose, runTool } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const SLOTS = [
  'top-left', 'top-center', 'top-right',
  'center-left', 'center', 'center-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];

test.describe('Phase 18 watermark — part 1 (gate, preview, apply, pixel proof)', () => {
  test.describe.configure({ mode: 'serial' });

  let electronApp = null;
  let window = null;
  // T3 captures the page-1 canvas non-white counts BEFORE the apply; T4
  // re-samples and asserts the delta. Null until T3 runs.
  let pixelBaseline = null;

  test.beforeAll(async () => {
    electronApp = await launchApp([], null, null);
    window = await electronApp.firstWindow();
    await window.waitForSelector('.sample-card', { timeout: 30000 });
  });

  test.afterAll(async () => {
    await hardClose(electronApp, 'phase18-wm');
  });

  // React-native drive for inputs whose value a plain fill does not stick
  // to (range / color): native value setter + bubbling `input` event.
  async function setControl(selector, value) {
    await window.evaluate(([sel, v]) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`control missing: ${sel}`);
      const desc =
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value') ||
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
      desc.set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, [selector, String(value)]);
  }

  // Non-white pixel count of one page-1 canvas quadrant, read straight from
  // the live pdf.js canvas backing store. Quadrants: 'top-left' (the
  // watermark target, wm-1 top-left) and 'bottom-right' (control the
  // watermark cannot reach). A pixel counts as non-white when its green OR
  // blue channel is < 235 (the red watermark at 25% opacity drops G/B to
  // ~224); the page's own text is in both samples, so the DELTA isolates
  // the watermark. getImageData throwing (tainted canvas) fails loud.
  async function nonWhiteQuadrant(quadrant) {
    return window.evaluate((q) => {
      const page = document.querySelector('.pdf-page[data-page="1"]');
      const canvas = page && page.querySelector('canvas');
      if (!canvas || canvas.width === 0 || canvas.height === 0) {
        throw new Error(`page-1 canvas unavailable for ${q} sample`);
      }
      const ctx = canvas.getContext('2d');
      const w = Math.floor(canvas.width / 2);
      const h = Math.floor(canvas.height / 2);
      const x0 = q === 'top-left' ? 0 : canvas.width - w;
      const y0 = q === 'top-left' ? 0 : canvas.height - h;
      let img;
      try {
        img = ctx.getImageData(x0, y0, w, h);
      } catch (e) {
        throw new Error(`getImageData threw for ${q} (tainted canvas?): ${e && e.message ? e.message : e}`);
      }
      let nonWhite = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        if (img.data[i + 1] < 235 || img.data[i + 2] < 235) nonWhite += 1;
      }
      return { quadrant: q, x: x0, y: y0, w, h, total: w * h, nonWhite };
    }, quadrant);
  }

  test('T1: dock gate on welcome screen, reachable + dialog on open doc', async () => {
    test.setTimeout(120000);

    // Welcome screen (no doc): Watermark must NOT be reachable. Phase 36 moved
    // the tool to the REVIEW stage's Action Dock; the stage dock only mounts
    // with a document open, so on the document-less welcome screen there is
    // no watermark verb (and no dock) at all. A present verb here is a failure.
    const welcomeVerbCount = await window.locator('[data-dock-verb="watermark"]').count();
    const welcomeDockCount = await window.locator('[data-action-dock]').count();
    console.log(`PHASE18_T1_GATE_BRANCH=dock-verb-home (welcomeVerb=${welcomeVerbCount}, dockMounted=${welcomeDockCount})`);
    console.log(`PHASE18_T1_GATE=${JSON.stringify({ welcomeVerbCount, welcomeDockCount })}`);
    expect(welcomeVerbCount, 'no watermark dock verb before a document is open').toBe(0);
    expect(welcomeDockCount, 'no Action Dock on the document-less welcome screen').toBe(0);

    // Open the bundled report sample; the tool must become reachable there.
    await openSample(window, electronApp, 'report.pdf');
    await window.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await window.waitForTimeout(1000);

    const home = await runTool(window, 'watermark');
    console.log(`PHASE18_T1_WATERMARK_HOME=${home}`);
    await expect(window.locator('[data-watermark-dialog]'), 'watermark dialog').toBeVisible();
  });

  test('T2: live preview + 9-slot position grid', async () => {
    test.setTimeout(120000);
    await expect(window.locator('[data-watermark-dialog]')).toBeVisible();

    const previewText = window.locator('[data-watermark-preview-text]');
    await window.locator('[data-watermark-text]').fill('CONFIDENTIAL');
    await expect(previewText, 'live preview mirrors the text BEFORE any apply')
      .toHaveText('CONFIDENTIAL');

    for (const slot of SLOTS) {
      const btn = window.locator(`[data-watermark-position="${slot}"]`);
      await btn.click();
      await expect(btn, `slot ${slot} becomes active`)
        .toHaveAttribute('aria-pressed', 'true');
    }
    const center = window.locator('[data-watermark-position="center"]');
    await center.click();
    await expect(center, 'left on center').toHaveAttribute('aria-pressed', 'true');

    // Image mode with no image picked: text preview goes away, the
    // "no image picked" indicator shows.
    await window.locator('[data-watermark-type="image"]').check();
    await expect(window.locator('[data-watermark-preview-text]'))
      .toHaveCount(0, 'text preview gone in image mode');
    const missingAttr = window.locator('[data-watermark-preview-missing]');
    console.log('PHASE18_T2_MISSING_INDICATOR=data-watermark-preview-missing');
    await expect(missingAttr, 'missing-image indicator visible')
      .toBeVisible();
  });

  test('T3: text + typography + opacity + timed all-pages apply', async () => {
    test.setTimeout(240000);
    await expect(window.locator('[data-watermark-dialog]')).toBeVisible();

    await window.locator('[data-watermark-type="text"]').check();
    await window.locator('[data-watermark-text]').fill('CONFIDENTIAL');
    await window.locator('[data-watermark-font]').selectOption('Times');
    await setControl('[data-watermark-size]', 60);
    await setControl('[data-watermark-color]', '#cc3333');
    for (const style of ['bold', 'italic', 'underline']) {
      await window.locator(`[data-watermark-${style}]`).check();
    }
    await setControl('[data-watermark-opacity]', 25);
    await window.locator('[data-watermark-position="top-left"]').click();

    expect(await window.locator('[data-watermark-opacity]').inputValue())
      .toBe('25', 'opacity control sticks at 25%');

    // T4 baseline: sample the page-1 canvas BEFORE the apply. The watermark
    // target is the top-left quadrant; bottom-right is the control the
    // watermark cannot reach.
    const beforeTopLeft = await nonWhiteQuadrant('top-left');
    const beforeBottomRight = await nonWhiteQuadrant('bottom-right');
    pixelBaseline = { topLeft: beforeTopLeft.nonWhite, bottomRight: beforeBottomRight.nonWhite };
    console.log(`PHASE18_T4_BASELINE beforeTopLeft=${beforeTopLeft.nonWhite} (${beforeTopLeft.w}x${beforeTopLeft.h}) beforeBottomRight=${beforeBottomRight.nonWhite} (${beforeBottomRight.w}x${beforeBottomRight.h})`);

    // Time from confirm click to the resulting toast.
    const t0 = Date.now();
    await window.locator('[data-watermark-confirm]').click();
    await window.locator('.toast-stack .toast')
      .first().waitFor({ state: 'visible', timeout: 90000 });
    const ms = Date.now() - t0;
    const diag = await window.evaluate(() => window.tflexDiagnostics());
    console.log(`PHASE18_APPLY_ALL_PAGES_MS=${ms}`);
    console.log(`PHASE18_PAGE_COUNT=${diag.pageCount} (engineDocId=${diag.engineDocId})`);

    const toastText = await window
      .locator('.toast-stack .toast')
      .last()
      .locator('.toast-text')
      .textContent();
    expect(toastText, 'exact success toast text').toBe('Watermark applied.');
    expect(await window.locator('.toast-stack .toast-error').count(), 'no error toast')
      .toBe(0);
    // Phase 126 retired the warning/error toasts; the same promise is now held by
    // the in-canvas alert, so assert no error-toned alert either.
    expect(
      await window.locator('[data-canvas-alert-notice][data-canvas-alert-tone="error"]').count(),
      'no error alert',
    ).toBe(0);
    await shot(window, 'phase18-applied-text.png');

    // Reopen the dialog through its current home and check the
    // applied-watermarks row (id + text + pages) and the control set.
    await runTool(window, 'watermark');
    await expect(window.locator('[data-watermark-dialog]')).toBeVisible();

    const row = window.locator('[data-watermark-applied="wm-1"]');
    await expect(row, 'applied-watermarks row wm-1').toBeVisible();
    const rowText = (await row.textContent()) || '';
    expect(rowText).toContain('wm-1');
    expect(rowText).toContain('CONFIDENTIAL');
    console.log(`PHASE18_APPLIED_ROW="${rowText.trim()}"`);

    // Evidence frame: grow the window to the display work area (a normal
    // user action via the real BrowserWindow API) so the dialog's
    // max-height grows, let the entrance animation settle, then scroll the
    // typography row (underline checkbox) to the top of the dialog's
    // visible area — the Applied watermarks section sits directly below
    // it in the same frame.
    await electronApp.evaluate(({ BrowserWindow, screen }) => {
      const wa = screen.getPrimaryDisplay().workArea;
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height });
    });
    await window.waitForTimeout(1000);
    await window.evaluate(() => {
      const dlg = document.querySelector('[data-watermark-dialog] .modal-dialog');
      const target = document.querySelector('[data-watermark-underline]');
      if (dlg && target) {
        target.scrollIntoView({ block: 'start' });
        dlg.scrollTop += 12;
      }
    });
    await window.waitForTimeout(300);
    await shot(window, 'phase18-dialog-controls.png');

    // Engine truth: exactly one watermark, id wm-1, on every page.
    const eng = await window.evaluate(async () => {
      const d = window.tflexDiagnostics();
      const res = await window.tflex.engine.getWatermarks(d.engineDocId);
      return { docId: d.engineDocId, pageCount: d.pageCount, res };
    });
    console.log(`PHASE18_GET_WATERMARKS=${JSON.stringify(eng.res && eng.res.ok ? eng.res.value : eng.res)}`);
    expect(eng.res.ok, `getWatermarks ok (got: ${JSON.stringify(eng.res)})`).toBe(true);
    expect(eng.res.value.length, 'exactly one applied watermark').toBe(1);
    expect(eng.res.value[0].id).toBe('wm-1');
    const pages = eng.res.value[0].pages;
    expect(pages.length, 'watermark covers every page').toBe(eng.pageCount);
    for (let p = 1; p <= eng.pageCount; p += 1) {
      expect(pages, `page ${p} watermarked`).toContain(p);
    }
  });

  test('T4: pixel proof — baked page-1 canvas', async () => {
    test.setTimeout(180000);

    // Close the dialog via its own close button.
    await window.locator('[data-watermark-dialog] .modal-close').click();
    await expect(window.locator('[data-watermark-dialog]')).toHaveCount(0);

    // Wait for the pdf.js proxy refresh: page-1 canvas mounted and sized.
    await window.waitForFunction(() => {
      const page = document.querySelector('.pdf-page[data-page="1"]');
      const canvas = page && page.querySelector('canvas');
      return !!(canvas && canvas.width > 0 && canvas.height > 0);
    }, undefined, { timeout: 30000 });
    await window.waitForTimeout(1500); // settle the re-rendered page

    // Real pixel proof on the live pdf.js canvas. before* were captured in
    // T3 BEFORE the apply; after* now that the proxy has re-rendered page 1.
    expect(pixelBaseline, 'T3 captured the pre-apply pixel baseline').not.toBeNull();
    const afterTopLeft = await nonWhiteQuadrant('top-left');
    const afterBottomRight = await nonWhiteQuadrant('bottom-right');
    const deltaTopLeft = afterTopLeft.nonWhite - pixelBaseline.topLeft;
    const deltaBottomRight = Math.abs(afterBottomRight.nonWhite - pixelBaseline.bottomRight);
    console.log(`PHASE18_T4_PIXELS beforeTopLeft=${pixelBaseline.topLeft} afterTopLeft=${afterTopLeft.nonWhite} beforeBottomRight=${pixelBaseline.bottomRight} afterBottomRight=${afterBottomRight.nonWhite} deltaTopLeft=${deltaTopLeft} deltaBottomRight=${deltaBottomRight}`);
    expect(
      deltaTopLeft,
      `visible watermark change on page-1 top-left (before=${pixelBaseline.topLeft}, after=${afterTopLeft.nonWhite})`,
    ).toBeGreaterThanOrEqual(100);
    expect(
      deltaBottomRight,
      `change localised to the watermark quadrant (deltaBottomRight=${deltaBottomRight}, deltaTopLeft=${deltaTopLeft})`,
    ).toBeLessThan(0.2 * deltaTopLeft);

    const pageEl = window.locator('.pdf-page[data-page="1"]');
    await expect(pageEl).toBeVisible();
    await pageEl.screenshot({ path: path.join(SHOTS, 'phase18-baked-page1.png') });
    console.log('PHASE18_T4 screenshot: screenshots/phase18-baked-page1.png');
  });
});