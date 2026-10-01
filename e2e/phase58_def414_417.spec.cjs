// Phase 58 — focused FIX-READY retest for DEF-414, DEF-415, DEF-416, DEF-417.
//
// ONE spec, four hard-assertion behaviours, each run through the real Electron
// app via the canonical launchApp helper:
//   DEF-416 — every tear-out (>= 8 fresh launches) must ADOPT the document
//             (`[data-tab-id]` appears, pageCount > 0). Zero blank orphans.
//   DEF-414 — a dirty document torn out must arrive in the detached window
//             still dirty on BOTH diagnostics signals + the modified dot.
//   DEF-415 — a dirty detached window's titlebar close must show the
//             `[data-close-tab-prompt]` gate; Cancel keeps it open + intact;
//             a following Discard close completes.
//   DEF-417 — tearing out an empty placeholder tab must NOT open a window and
//             must surface a visible "no document to move" warning toast.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, runTool, openSamplePath } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

test.setTimeout(900000);

// --- shared helpers ---------------------------------------------------------

async function tabState(page) {
  return page.evaluate(() => ({
    count: document.querySelectorAll('[data-tab-id]').length,
    active: document.querySelector('[data-tab-id][aria-selected="true"]')?.getAttribute('data-tab-id') ?? null,
    titles: Array.from(document.querySelectorAll('[data-tab-id] .tab-title')).map((e) => e.textContent.trim()),
    toasts: Array.from(document.querySelectorAll('.toast')).map((e) => e.textContent.trim()),
  }));
}

async function diag(page) {
  return page.evaluate(() => {
    const d = window.tflexDiagnostics();
    return { modified: d.modified, tabModified: d.tabModified, pageCount: d.pageCount, openTabs: d.openTabs };
  });
}

// One tear-out gesture: press the tab's title, drag straight down below
// the strip, release. `which` selects the first or last tab in the strip.
// Mirrors the proven gesture in e2e/phase58_tab_detach.spec.cjs (DEF-412 pure
// downward movement).
async function tearOut(page, which = 'first') {
  const titles = page.locator('[data-tab-id] .tab-title');
  const total = await titles.count();
  const idx = which === 'last' ? total - 1 : 0;
  const title = titles.nth(Math.max(0, idx));
  const titleBox = await title.boundingBox();
  const strip = await page.locator('.tab-list').boundingBox();
  const sx = titleBox.x + titleBox.width / 2;
  const sy = titleBox.y + titleBox.height / 2;
  const ty = strip.y + strip.height + 60;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx, sy + 10, { steps: 4 });
  await page.mouse.move(sx, ty, { steps: 12 });
  await page.mouse.up();
  return { sx, sy, ty, stripBottom: strip.y + strip.height };
}

// Wait until the detached window has adopted its document: a tab element
// appears AND the engine reports a non-zero page count.
async function waitAdopted(win, timeoutMs = 20000) {
  const hadTab = await win
    .waitForSelector('[data-tab-id]', { timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
  let pageCount = 0;
  if (hadTab) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      pageCount = await win.evaluate(() => window.tflexDiagnostics().pageCount).catch(() => 0);
      if (pageCount > 0) break;
      await win.waitForTimeout(400);
    }
  }
  return { hadTab, pageCount };
}

async function bootSample(app, name) {
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openSamplePath(win, app, getSamplePath(name));
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('[data-tab-id]', { timeout: 30000 });
  await win.waitForTimeout(800);
  return win;
}

// --- DEF-416: zero blank orphan windows across >= 8 tear-outs ----------------
test('DEF-416: every tear-out adopts the document (8 fresh launches)', async () => {
  const RUNS = 8;
  const results = [];

  for (let i = 0; i < RUNS; i += 1) {
    const run = { run: i + 1 };
    const app = await launchApp(); // launchApp always uses a fresh temp user-data-dir
    try {
      const origin = await bootSample(app, 'report.pdf');
      const before = await tabState(origin);
      const secondP = app.waitForEvent('window', { timeout: 20000 }).catch(() => null);
      run.gesture = await tearOut(origin, 'first');
      const second = await secondP;
      run.windowOpened = second !== null;
      if (second) {
        await second.waitForLoadState('domcontentloaded').catch(() => {});
        run.url = second.url();
        const adopted = await waitAdopted(second, 20000);
        run.hadTab = adopted.hadTab;
        run.pageCount = adopted.pageCount;
        if (!adopted.hadTab || adopted.pageCount <= 0) {
          await second.screenshot({ path: path.join(SHOTS, `def416-blank-run${i + 1}.png`) }).catch(() => {});
        } else if (i === 0) {
          await second.screenshot({ path: path.join(SHOTS, 'def416-adopted-run1.png') }).catch(() => {});
        }
      } else {
        run.hadTab = false;
        run.pageCount = 0;
        await origin.screenshot({ path: path.join(SHOTS, `def416-nowindow-run${i + 1}.png`) }).catch(() => {});
      }
      run.beforeTabs = before.count;
      console.log(`[DEF-416] ${JSON.stringify(run)}`);
    } catch (e) {
      run.error = String(e.message);
      console.log(`[DEF-416] ${JSON.stringify(run)}`);
    } finally {
      await hardClose(app, `def416-run${i + 1}`).catch(() => {});
    }
    results.push(run);
  }

  console.log(`[DEF-416] summary=${JSON.stringify(results)}`);
  const bad = results.filter(
    (r) => r.error !== undefined || !r.windowOpened || !r.hadTab || !(r.pageCount > 0),
  );
  expect(bad, `blank/non-adopting tear-out runs: ${JSON.stringify(bad)}`).toEqual([]);
});

// --- DEF-414: dirty document stays dirty in the detached window -------------
test('DEF-414: tear-out of a dirty document leaves the detached window dirty', async () => {
  const app = await launchApp();
  try {
    const origin = await bootSample(app, 'report.pdf');

    // Mark the origin dirty via the PAGES dock rotate verb.
    await runTool(origin, 'rotate');
    await origin.waitForTimeout(1500);
    const modBefore = await diag(origin);
    console.log(`[DEF-414] origin before=${JSON.stringify(modBefore)}`);
    expect(modBefore.modified, 'origin is dirty before the tear-out (precondition)').toBe(true);

    const secondP = app.waitForEvent('window', { timeout: 20000 }).catch(() => null);
    await tearOut(origin, 'first');
    const second = await secondP;
    expect(second, 'tear-out opened a detached window').not.toBeNull();
    await second.waitForLoadState('domcontentloaded').catch(() => {});

    // Poll the detached diagnostics like the adversary harness (10 x 250 ms).
    const poll = [];
    for (let i = 0; i < 10; i += 1) {
      poll.push(await second.evaluate(() => ({
        m: window.tflexDiagnostics().modified,
        t: window.tflexDiagnostics().tabModified,
        tabs: document.querySelectorAll('[data-tab-id]').length,
      })).catch(() => null));
      await second.waitForTimeout(250);
    }
    const state = await second.evaluate(() => {
      const dot = document.querySelector('[data-tab-id] .tab-modified-dot');
      return {
        m: window.tflexDiagnostics().modified,
        t: window.tflexDiagnostics().tabModified,
        pages: window.tflexDiagnostics().pageCount,
        dotClass: dot === null ? null : dot.className,
        dotVisible:
          dot !== null &&
          getComputedStyle(dot).visibility !== 'hidden' &&
          getComputedStyle(dot).opacity !== '0',
      };
    });
    console.log(`[DEF-414] poll=${JSON.stringify(poll)}`);
    console.log(`[DEF-414] detached=${JSON.stringify(state)}`);
    await second.screenshot({ path: path.join(SHOTS, 'def414-detached-modified.png') }).catch(() => {});

    expect(state.pages, 'detached window adopted the document').toBeGreaterThan(0);
    expect(state.m, 'detached tflexDiagnostics().modified').toBe(true);
    expect(state.t, 'detached tflexDiagnostics().tabModified').toBe(true);
    expect(state.dotVisible, 'modified dot is visible in the detached tab').toBe(true);
  } finally {
    await hardClose(app, 'def414').catch(() => {});
  }
});

// --- DEF-415: dirty detached window has a working close gate ----------------
test('DEF-415: detached close gate prompts, Cancel keeps it, Discard closes it', async () => {
  const app = await launchApp();
  try {
    const origin = await bootSample(app, 'report.pdf');

    const secondP = app.waitForEvent('window', { timeout: 20000 }).catch(() => null);
    await tearOut(origin, 'first');
    const second = await secondP;
    expect(second, 'tear-out opened a detached window').not.toBeNull();
    await second.waitForLoadState('domcontentloaded').catch(() => {});
    const adopted = await waitAdopted(second, 20000);
    expect(adopted.pageCount, 'detached window loaded the document').toBeGreaterThan(0);

    // Mark dirty INSIDE the detached window.
    await runTool(second, 'rotate');
    await second.waitForTimeout(1500);
    const dirty = await diag(second);
    console.log(`[DEF-415] detached dirty=${JSON.stringify(dirty)}`);
    expect(dirty.modified || dirty.tabModified, 'detached window is dirty (precondition)').toBe(true);

    // 1) Close -> the DEF-142 prompt MUST appear.
    await second.locator('[data-window-close]').first().click();
    await second.waitForSelector('[data-close-tab-prompt]', { state: 'visible', timeout: 10000 });
    const promptVisible = await second.locator('[data-close-tab-prompt]').isVisible();
    await second.screenshot({ path: path.join(SHOTS, 'def415-close-prompt.png') }).catch(() => {});
    console.log(`[DEF-415] promptVisible=${promptVisible} closed=${second.isClosed()}`);
    expect(promptVisible, 'unsaved-changes prompt appeared on the detached close').toBe(true);
    expect(second.isClosed(), 'window stays open while the prompt is shown').toBe(false);

    // 2) Cancel -> window survives with the document + edits intact.
    await second.locator('[data-close-prompt-action="cancel"]').click();
    await second.waitForSelector('[data-close-tab-prompt]', { state: 'detached', timeout: 10000 });
    const afterCancel = await diag(second);
    console.log(`[DEF-415] afterCancel=${JSON.stringify(afterCancel)} stillOpen=${!second.isClosed()}`);
    expect(second.isClosed(), 'Cancel keeps the detached window open').toBe(false);
    expect(afterCancel.pageCount, 'document intact after Cancel').toBeGreaterThan(0);
    expect(afterCancel.modified || afterCancel.tabModified, 'edits still present after Cancel').toBe(true);

    // 3) Close again -> prompt again -> Discard -> the window closes.
    const closeP = second.waitForEvent('close', { timeout: 15000 }).catch(() => null);
    await second.locator('[data-window-close]').first().click();
    await second.waitForSelector('[data-close-tab-prompt]', { state: 'visible', timeout: 10000 });
    // Discard tears the window down as the click lands, so the click action
    // can race the close and reject with "Target page closed" - that close is
    // the expected outcome, asserted via the close event below.
    await second.locator('[data-close-prompt-action="discard"]').click({ timeout: 10000 }).catch(() => {});
    const closed = await closeP;
    console.log(`[DEF-415] discardClosed=${closed !== null} isClosed=${second.isClosed()}`);
    expect(closed, 'Discard completes the close (window close event fired)').not.toBeNull();
    expect(second.isClosed(), 'detached window is closed after Discard').toBe(true);
  } finally {
    await hardClose(app, 'def415').catch(() => {});
  }
});

// --- DEF-417: empty-tab tear-out is refused LOUDLY, no window ----------------
test('DEF-417: tearing out an empty tab toasts and opens NO window', async () => {
  const app = await launchApp();
  try {
    const origin = await bootSample(app, 'report.pdf');

    await origin.locator('[data-new-tab]').click();
    await origin.waitForTimeout(800);
    const before = await tabState(origin);
    console.log(`[DEF-417] before=${JSON.stringify(before)}`);
    expect(before.count, 'document tab + empty placeholder').toBe(2);

    // Register the window listener BEFORE the gesture so a spurious window is
    // caught even if it opens during the settle wait.
    const secondP = app.waitForEvent('window', { timeout: 8000 }).catch(() => null);
    const gesture = await tearOut(origin, 'last');
    console.log(`[DEF-417] gesture=${JSON.stringify(gesture)}`);

    // Read the toast early (toasts auto-dismiss after 5 s).
    await origin.waitForTimeout(700);
    const toast = await origin.evaluate(() => {
      const el = document.querySelector('.toast-warning');
      const textEl = document.querySelector('.toast-warning .toast-text');
      if (el === null) return { present: false, text: null, visible: false };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        present: true,
        text: textEl === null ? null : textEl.textContent,
        visible:
          cs.display !== 'none' &&
          cs.visibility !== 'hidden' &&
          Number(cs.opacity) > 0 &&
          r.width > 0 &&
          r.height > 0,
      };
    });
    console.log(`[DEF-417] toast=${JSON.stringify(toast)}`);
    await origin.screenshot({ path: path.join(SHOTS, 'def417-empty-tearout-toast.png') }).catch(() => {});

    const second = await secondP;
    await origin.waitForTimeout(1500);
    const after = await tabState(origin);
    console.log(`[DEF-417] second=${second !== null} after=${JSON.stringify(after)}`);

    expect(second, 'no new window for a document-less tab').toBeNull();
    expect(after.count, 'both tabs are kept (empty tab not moved)').toBe(2);
    expect(after.active, 'active tab unchanged').toBe(before.active);
    expect(toast.present, 'a warning toast is shown').toBe(true);
    expect(toast.visible, 'the warning toast is visible').toBe(true);
    expect(toast.text, 'the toast explains there is no document to move').toContain('no document to move');
  } finally {
    await hardClose(app, 'def417').catch(() => {});
  }
});
