// Phase 128 (TFL-1571) chunk C — benchmark: scanned document instant open/switch.
//
// Success criteria 1 & 2 (docs/phase-specs/phase-128.md):
//   1. Opening scanned.pdf from the Home screen paints page 1 in the canvas
//      within 500 ms of the click.
//   2. Switching back to an already-open scanned.pdf tab paints page 1 within
//      100 ms of the click.
//
// Measurement contract. The clock starts at the control's real `click` event
// (a human "click" completes at mouseup; the pointerdown→click gap is injected
// by the harness and is not part of the user-perceived latency). It stops when
// the ACTIVE pane bound to the target tab has a page-1 canvas with non-zero
// backing dimensions. Panes are resolved through their own `data-pane-tab`
// attribute so a still-mounted inactive pane, or the report pane, can never
// satisfy the predicate early.
//
// The task keeps this to one bounded benchmark plus the nearest open/switch
// blast-radius neighbours; it does not run the full suite.

const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { openSamplePath, hardClose } = require('./lib/helpers.cjs');

const OPEN_BUDGET_MS = 500;
const SWITCH_BUDGET_MS = 100;

// The document page-1 canvas. `[data-page="1"] canvas` is AMBIGUOUS: within one
// tab pane it matches both the sidebar THUMBNAIL (`canvas.thumb-canvas`, ~126x163)
// and the real document page (`canvas.pdf-page-canvas`, ~927x1200), and
// querySelector returns the thumbnail first. The phase budgets are about the
// DOCUMENT PAGE painting, so the predicate must target `.pdf-page-canvas`.
const PAGE1_CANVAS = '[data-page="1"] .pdf-page-canvas';

// Time, in-page, from `window.__tflexT0` until the active pane bound to `wantId`
// (or any active document pane when `wantId` is null) has painted page 1.
//
// "Painted" must mean CONTENT is on the canvas, not merely that
// `canvas.width/height` are non-zero: PageView assigns the backing-store size
// (PageView.tsx render effect) BEFORE the async `pageProxy.render()` blits the
// pixels, so a dims-only predicate trips on a transparent/blank canvas. We
// therefore require the page-1 document canvas to hold non-white ink: a 3x3
// grid of 60x60 patches sampled across the page, counting pixels that are
// opaque and below the near-white threshold. A blank (transparent or
// white-filled) canvas scores ~0; scanned.pdf page 1 scores in the thousands.
const INK_MIN = 200;

async function awaitPaintMs(win, wantId, timeout) {
  const handle = await win.waitForFunction(({ id, inkMin }) => {
    if (window.__tflexT0 == null) return false;
    const panes = document.querySelectorAll('.tab-pane[aria-hidden="false"][data-pane-tab]');
    for (const pane of panes) {
      if (id && pane.getAttribute('data-pane-tab') !== id) continue;
      const c = pane.querySelector('[data-page="1"] .pdf-page-canvas');
      if (!c || c.width === 0 || c.height === 0) continue;
      const ctx = c.getContext('2d');
      let ink = 0;
      try {
        for (let gy = 1; gy <= 3 && ink < inkMin; gy += 1) {
          for (let gx = 1; gx <= 3 && ink < inkMin; gx += 1) {
            const px = Math.max(0, Math.floor((c.width * gx) / 4) - 30);
            const py = Math.max(0, Math.floor((c.height * gy) / 4) - 30);
            const img = ctx.getImageData(px, py, 60, 60).data;
            for (let i = 0; i < img.length; i += 4) {
              if (img[i + 3] > 0 && Math.min(img[i], img[i + 1], img[i + 2]) < 240) ink += 1;
            }
          }
        }
      } catch (_) { return false; }
      if (ink >= inkMin) return performance.now() - window.__tflexT0;
    }
    return false;
  }, { id: wantId, inkMin: INK_MIN }, { timeout, polling: 5 });
  return handle.jsonValue();
}

function paneCanvasState(win, tabId) {
  return win.evaluate((id) => {
    const pane = document.querySelector(`.tab-pane[data-pane-tab="${id}"]`);
    const c = pane && pane.querySelector('[data-page="1"] .pdf-page-canvas');
    return {
      paneHidden: pane ? pane.getAttribute('aria-hidden') : 'missing',
      canvasW: c ? c.width : -1,
      canvasH: c ? c.height : -1,
    };
  }, tabId);
}

test('Phase 128 — scanned.pdf opens and re-switches to a painted page 1 within budget', async () => {
  const app = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });

    // ---- 1. Open scanned.pdf from the Home sample card --------------------
    // Bind the clock to the scanned card's own `click` event.
    await win.evaluate(() => {
      window.__tflexT0 = performance.now();
      const card = Array.from(document.querySelectorAll('.sample-card'))
        .find((c) => /scanned/i.test(c.textContent || ''));
      if (card) {
        card.addEventListener('click', () => { window.__tflexT0 = performance.now(); }, { capture: true, once: true });
      }
    });
    await win.locator('.sample-card').filter({ hasText: 'scanned' }).first().click();
    const openMs = await awaitPaintMs(win, null, 30000);
    console.log(`[TFL-1571] scanned.pdf open paint: ${openMs.toFixed(1)} ms (budget ${OPEN_BUDGET_MS})`);

    const scannedPane = win.locator(`.tab-pane[data-pane-tab]:has(${PAGE1_CANVAS})`).first();
    const scannedTabId = await scannedPane.getAttribute('data-pane-tab');
    console.log(`[TFL-1571] scanned tab id: ${scannedTabId}`);

    expect(openMs, `scanned.pdf open must paint page 1 within ${OPEN_BUDGET_MS} ms`).toBeLessThanOrEqual(OPEN_BUDGET_MS);
    await win.screenshot({ path: 'screenshots/tfl1571_scanned_open.png' });

    // ---- 2. Open report.pdf as a second tab -------------------------------
    const tabsBefore = await win.locator('[data-tab-id]').count();
    await openSamplePath(win, app, getSamplePath('report.pdf'));
    // The shared helper's trailing wait can be satisfied by the already-open
    // scanned workspace; wait explicitly for the second tab to actually exist
    // and become the active one, else the "switch" would target a single tab.
    await expect.poll(() => win.locator('[data-tab-id]').count(), { timeout: 30000 }).toBeGreaterThan(tabsBefore);

    const reportTabId = await win.locator('[data-tab-id]').filter({ hasNotText: 'scanned' }).first().getAttribute('data-tab-id');
    await expect.poll(async () => win.evaluate((id) =>
      document.querySelector(`.tab-pane[data-pane-tab="${id}"]`)?.getAttribute('aria-hidden'),
      reportTabId), { timeout: 30000 }).toBe('false');
    await expect.poll(async () => win.evaluate((id) =>
      document.querySelector(`.tab-pane[data-pane-tab="${id}"]`)?.getAttribute('aria-hidden'),
      scannedTabId), { timeout: 30000 }).toBe('true');

    // The scanned pane is now the inactive one. This build keeps the hidden
    // pane's painted canvas (shouldRender stays true while backgrounded), so the
    // switch measures the pane re-activation latency, an upper bound on "the
    // scanned page reappears".
    console.log(`[TFL-1571] pre-switch scanned pane state: ${JSON.stringify(await paneCanvasState(win, scannedTabId))}`);
    console.log(`[TFL-1571] active report tab id: ${reportTabId}`);

    // ---- 3. Switch back to the scanned tab --------------------------------
    await win.evaluate(() => {
      window.__tflexT0 = performance.now();
      const tab = Array.from(document.querySelectorAll('[data-tab-id]'))
        .find((t) => /scanned/i.test(t.textContent || ''));
      if (tab) {
        tab.addEventListener('click', () => { window.__tflexT0 = performance.now(); }, { capture: true, once: true });
      }
    });
    await win.locator('[data-tab-id]').filter({ hasText: 'scanned' }).first().click();
    const switchMs = await awaitPaintMs(win, scannedTabId, 30000);
    console.log(`[TFL-1571] scanned.pdf switch paint: ${switchMs.toFixed(1)} ms (budget ${SWITCH_BUDGET_MS})`);
    await win.screenshot({ path: 'screenshots/tfl1571_scanned_switch.png' });

    const activeAfter = await paneCanvasState(win, scannedTabId);
    console.log(`[TFL-1571] post-switch scanned pane state: ${JSON.stringify(activeAfter)}`);
    expect(activeAfter.paneHidden, 'scanned pane must be the active pane after the switch').toBe('false');
    expect(switchMs, `scanned.pdf switch must paint page 1 within ${SWITCH_BUDGET_MS} ms`).toBeLessThanOrEqual(SWITCH_BUDGET_MS);
  } finally {
    await hardClose(app, 'tfl1571-scanned-instant');
  }
});
