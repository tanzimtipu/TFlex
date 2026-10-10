// Phase 105 (chunk E) — focused QA + visual verdict for the Phase 105 Top Bar
// and Tabs overhaul. Exercises the structured 48px title row, the 40px document
// rail with per-session identity, the All-tabs switcher and the preserved
// reorder / close / new-tab behaviour in the REAL Electron app.
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const {
  hardClose,
  openSamplePath,
  openStandalonePrintWindow,
  closeStandalonePrintWindow,
} = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
// Phase 105 migrated to the Intake open flow (TFL-1653). The rendered band is
// the chrome pill geometry: the planner floor is LAYOUT.railMinTabPx (148px)
// and the pill ceiling is the chrome `max-width: 360px`
// (`.tab-area[data-tab-style="chrome"] .tab-list > li[data-animated-tab]`).
const MIN_TAB = 148;
const MAX_TAB = 360;
const MULTI_MODE_REASON = 'Turn off Multi Mode to create a new document';

let app = null;
let win = null;

test.setTimeout(420000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  // DEF-583: pin reduced motion for the whole launch. The app's TfMorph menus
  // collapse their exit morph to the instant end state under
  // `prefers-reduced-motion: reduce` (the OS path in useAnimations/motionPolicy
  // and the animations.css catch-all), so AnimatePresence removes the exiting
  // surface promptly. Under a full-suite multi-launch run the normal exit tween
  // can be CPU-starved and outlast the 8s close-wait while the opacity-0 element
  // is still "visible" to Playwright until it unmounts.
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p105-topbar-rail');
  app = null;
  win = null;
});

// TFL-1653 — generic Open now stages the picked file in the Intake Tray and
// needs the tray's explicit Open click, so the local dialog-stub opener is
// retired in favour of the canonical Intake-aware `openSamplePath`. It clicks
// the real Open control, drives the tray, and resolves once the document is
// rendered.
async function openPath(filePath) {
  await openSamplePath(win, app, filePath);
}

// DEF-583: the File-menu / application-menu surfaces are TfMorph popovers whose
// exiting element stays opacity-0 in the DOM until AnimatePresence completes the
// exit morph and unmounts it. `state: 'hidden'` is NOT a robust close signal:
// Playwright counts an opacity-0 element as visible, so a throttled exit can time
// the wait out. Await detachment instead - the popover leaving the DOM proves the
// menu genuinely closed, without weakening the assertion's intent.
async function waitForPopoverClosed(selector) {
  await win.waitForSelector(selector, { state: 'detached', timeout: 8000 });
}

// Open `n` copies of a bundled sample and wait for the tab count to reach n.
async function openCopies(n, prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `tflex-p105-${prefix}-`));
  const src = getSamplePath('report.pdf');
  const paths = [];
  for (let i = 0; i < n; i += 1) {
    const p = path.join(tmp, `${prefix}-${i + 1}.pdf`);
    fs.copyFileSync(src, p);
    paths.push(p);
  }
  for (let i = 0; i < paths.length; i += 1) {
    await openPath(paths[i]);
    await win.waitForFunction(
      (count) => document.querySelectorAll('[data-tab-id]').length >= count,
      i + 1,
      { timeout: 30000 },
    );
  }
  await win.waitForTimeout(600);
  return paths;
}

async function setWindowSize(w, h) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const target = BrowserWindow.getAllWindows()[0];
    if (target === undefined || target === null) return;
    if (target.isMaximized()) target.unmaximize();
    target.setSize(size[0], size[1]);
  }, [w, h]);
  await win.waitForTimeout(500);
}

// DEF-583-class settle guard: after a window resize the rail's capacity
// planner re-measures asynchronously, so a fixed delay can snapshot the
// PRE-resize capacity under full-suite load (the 640px stage saw the 1280px
// layout: visible=8, newTabRight=1152 > viewport 640). Wait for the exact
// containment the assertions require - if the layout never settles this times
// out and still fails, so the wait is a determinism fix, not a weakened assert.
async function waitForRailContained() {
  await win.waitForFunction(() => {
    const vw = window.innerWidth;
    const list = document.querySelector('.tab-list');
    const newTab = document.querySelector('[data-new-tab]');
    const allTabs = document.querySelector('[data-all-tabs]');
    const active = document.querySelector('[data-tab-id][aria-selected="true"]');
    const within = (el) => el !== null && el.getBoundingClientRect().right <= vw + 1;
    return (
      list !== null &&
      list.getBoundingClientRect().right <= vw + 1 &&
      within(newTab) &&
      within(allTabs) &&
      within(active)
    );
  }, null, { timeout: 8000 });
}

async function activeTabId() {
  return win.evaluate(() => {
    const el = document.querySelector('[data-tab-id][aria-selected="true"]');
    return el === null ? null : el.getAttribute('data-tab-id');
  });
}

async function diag() {
  return win.evaluate(() => window.tflexDiagnostics());
}

// Snapshot the rail: total mounted sessions, the visible (non-hidden) tabs with
// their widths and stable identity, the two reserved controls and the strip's
// scroll/clip state.
async function railSnapshot() {
  return win.evaluate(() => {
    const list = document.querySelector('.tab-list');
    const lr = list.getBoundingClientRect();
    const cs = getComputedStyle(list);
    const tabs = Array.from(document.querySelectorAll('[data-tab-id]')).map((t) => {
      const hidden = t.closest('li[data-tab-overflow="hidden"]') !== null;
      const r = t.getBoundingClientRect();
      return {
        id: t.getAttribute('data-tab-id'),
        colorId: t.getAttribute('data-tab-color-id'),
        active: t.getAttribute('aria-selected') === 'true',
        hidden,
        width: +r.width.toFixed(2),
        left: +r.left.toFixed(2),
        right: +r.right.toFixed(2),
      };
    });
    const visible = tabs.filter((t) => !t.hidden);
    const railEl = document.querySelector('.document-rail');
    const railRight = railEl === null ? null : railEl.getBoundingClientRect().right;
    return {
      total: tabs.length,
      visibleCount: visible.length,
      hiddenCount: tabs.filter((t) => t.hidden).length,
      visible,
      minWidth: visible.length ? Math.min(...visible.map((t) => t.width)) : 0,
      maxWidth: visible.length ? Math.max(...visible.map((t) => t.width)) : 0,
      active: visible.find((t) => t.active) || null,
      newTab: document.querySelector('[data-new-tab]') !== null,
      allTabs: document.querySelector('[data-all-tabs]') !== null,
      railRight: railRight === null ? null : +railRight.toFixed(2),
      newTabRight: document.querySelector('[data-new-tab]')
        ? +document.querySelector('[data-new-tab]').getBoundingClientRect().right.toFixed(1)
        : null,
      allTabsRight: document.querySelector('[data-all-tabs]')
        ? +document.querySelector('[data-all-tabs]').getBoundingClientRect().right.toFixed(1)
        : null,
      viewportW: window.innerWidth,
      listLeft: +lr.left.toFixed(2),
      listRight: +lr.right.toFixed(2),
      overflowX: cs.overflowX,
      scrollWidth: list.scrollWidth,
      clientWidth: list.clientWidth,
      scrollLeft: list.scrollLeft,
    };
  });
}

// Whether `selector` is present, has a real box, and is the topmost hit target
// at its centre (i.e. it is actually clickable, not covered).
async function hitTest(selector) {
  return win.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) return { present: false };
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return {
      present: true,
      width: +r.width.toFixed(2),
      height: +r.height.toFixed(2),
      disabled: el.disabled === true,
      hit: top !== null && (top === el || el.contains(top)),
    };
  }, selector);
}

async function toggleThemeViaAppMenu() {
  const before = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await win.locator('[data-menu-button]').click();
  await win.waitForSelector('[data-menu-popover]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-menu-action="toggleTheme"]').first().click();
  await win.waitForFunction(
    (prev) => document.documentElement.getAttribute('data-theme') !== prev,
    before,
    { timeout: 8000 },
  );
  await win.waitForTimeout(400);
  return win.evaluate(() => document.documentElement.getAttribute('data-theme'));
}

// Toggle the theme (via the File menu) until it reaches `target`; the cycle is
// frosted -> dark -> light, and the persisted default may be any of the three.
async function ensureTheme(target) {
  for (let i = 0; i < 4; i += 1) {
    const cur = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (cur === target) return cur;
    await toggleThemeViaAppMenu();
  }
  return win.evaluate(() => document.documentElement.getAttribute('data-theme'));
}

// Pointer-drag a tab by its title to an absolute viewport X (Phase 58 gesture).
async function dragTab(tabId, targetX) {
  const title = win.locator(`[data-tab-id="${tabId}"] .tab-title`);
  const box = await title.boundingBox();
  const startX = box.x + Math.min(8, box.width / 2);
  const y = box.y + box.height / 2;
  await win.mouse.move(startX, y);
  await win.mouse.down();
  await win.mouse.move(startX - 12, y, { steps: 3 });
  await win.mouse.move(targetX, y, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(500);
}

// Dirty the ACTIVE session through the real UI path (the dock Rotate verb), so
// the renderer's engineUi mirror updates exactly as a user edit would. A direct
// `window.tflex.engine.applyOp` call bypasses the UI handler and does NOT seed
// the React mirror, so it is not used here.
async function rotateActiveViaDock() {
  await win.locator('[data-dock-verb="rotate"]:visible').first().click();
  await win.waitForFunction(
    () => {
      const t = document.querySelector('[data-tab-id][aria-selected="true"]');
      return t !== null && t.querySelector('.tab-modified-dot-hidden') === null;
    },
    null,
    { timeout: 10000 },
  );
  await win.waitForTimeout(400);
}

// ---------------------------------------------------------------------------
// 1. Title row — every command present and clickable; the File menu opens;
//    Escape returns focus to its trigger. Light + dark title-row screenshots.
// ---------------------------------------------------------------------------
test('title row: every command present + clickable; File menu opens; Escape restores File-menu focus', async () => {
  const [docPath] = await openCopies(1, 'title');
  await win.waitForSelector('.workspace', { timeout: 30000 });

  const controls = [
    '[data-toolbar-open]',
    '[data-toolbar-save]',
    '[data-toolbar-save-as]',
    '[data-menu-button]',
    '[data-open-preferences]',
    '[data-header-tool-search]',
    '[data-print]',
    '[data-window-minimize]',
    '[data-window-maximize]',
    '[data-window-close]',
  ];
  for (const sel of controls) {
    const h = await hitTest(sel);
    console.log(`[P105 title] ${sel} ${JSON.stringify(h)}`);
    expect(h.present, `${sel} present`).toBe(true);
    expect(h.width, `${sel} has width`).toBeGreaterThan(0);
    expect(h.height, `${sel} has height`).toBeGreaterThan(0);
    expect(h.hit, `${sel} is the topmost hit target (clickable)`).toBe(true);
  }

  // Open invokes the real file dialog (no no-op): flag set on the main process.
  await app.evaluate(({ dialog }) => {
    globalThis.__p105OpenCalled = false;
    dialog.showOpenDialog = async () => {
      globalThis.__p105OpenCalled = true;
      return { canceled: true, filePaths: [] };
    };
  });
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(700);
  const openCalled = await app.evaluate(() => globalThis.__p105OpenCalled === true);
  expect(openCalled, 'Open invokes the file dialog (real handler, no no-op)').toBe(true);

  // Save is disabled while the document is clean.
  expect(
    await win.locator('[data-toolbar-save]').isDisabled(),
    'Save disabled while clean',
  ).toBe(true);

  // A real edit (dock Rotate) marks the on-disk document modified -> Save
  // enables and its tooltip advertises the unsaved change.
  await rotateActiveViaDock();
  await win.waitForFunction(
    () => {
      const b = document.querySelector('[data-toolbar-save]');
      return b !== null && !b.disabled;
    },
    null,
    { timeout: 8000 },
  );
  const saveTitle = await win.locator('[data-toolbar-save]').getAttribute('title');
  console.log(`[P105 title] save title after edit="${saveTitle}"`);
  expect(saveTitle, 'Save advertises the unsaved change').toContain('Save now');

  // Save performs the in-place write (no no-op): the tab returns clean.
  await win.locator('[data-toolbar-save]').click();
  await win.waitForFunction(
    () => {
      const b = document.querySelector('[data-toolbar-save]');
      return b !== null && b.disabled;
    },
    null,
    { timeout: 15000 },
  );
  const afterSave = await diag();
  expect(afterSave.tabModified, 'Save clears the modified flag').toBe(false);

  // Save a copy opens the Save-As dialog and writes the chosen path.
  const outPath = path.join(os.tmpdir(), `p105-save-as-${Date.now()}.pdf`);
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, outPath);
  await win.locator('[data-toolbar-save-as]').click();
  await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
  await win.locator('[data-save-as-confirm]').click();
  await win.waitForTimeout(2500);
  expect(fs.existsSync(outPath), 'Save a copy writes the file (no no-op)').toBe(true);

  // File menu opens; Escape closes it AND returns focus to the trigger.
  await win.locator('[data-menu-button]').click();
  await win.waitForSelector('[data-menu-popover]', { state: 'visible', timeout: 8000 });
  await win.keyboard.press('Escape');
  await waitForPopoverClosed('[data-menu-popover]');
  const focusOnTrigger = await win.evaluate(() => {
    const el = document.querySelector('[data-menu-button]');
    return el !== null && document.activeElement === el;
  });
  expect(focusOnTrigger, 'Escape returns focus to [data-menu-button]').toBe(true);

  // Search tools opens the Command Palette; Escape closes it.
  await win.locator('[data-header-tool-search]').click();
  await win.waitForSelector('[data-command-palette]', { state: 'visible', timeout: 8000 });
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-command-palette]', { state: 'hidden', timeout: 8000 });

  // Print opens the standalone print window (real handler, no no-op).
  const printPage = await openStandalonePrintWindow(app, win);
  expect(printPage, 'Print opens the standalone print window').toBeTruthy();
  await closeStandalonePrintWindow(app, printPage);

  // Light + dark title-row screenshots. The persisted default theme may be any
  // of frosted / dark / light; drive to each explicitly.
  const lightTheme = await ensureTheme('light');
  await win.screenshot({ path: path.join(SHOTS, 'phase105-title-row-light.png') });
  const darkTheme = await ensureTheme('dark');
  await win.screenshot({ path: path.join(SHOTS, 'phase105-title-row-dark.png') });
  console.log(`[P105 title] themes captured: light=${lightTheme}, dark=${darkTheme}`);
  expect(lightTheme, 'reached the light theme').toBe('light');
  expect(darkTheme, 'reached the dark theme').toBe('dark');
  expect(docPath.length, 'document path recorded').toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// 2. Document rail at 1 / 3 / 12 / 30 tabs — readable minimum widths, the two
//    reserved controls always present, the active tab visible after overflow,
//    and a rail that never scrolls horizontally. Rail + narrow screenshots.
// ---------------------------------------------------------------------------
// DEF-579 rendered regression guard: the rail and every reserved/interactive
// box must sit inside the viewport on the FIRST layout, before any window
// resize. The pre-fix bug only appeared at first layout (a later resize
// self-corrected), so the native-size snapshot this runs against is taken
// before `setWindowSize` below.
function assertViewportContainment(tag, snap) {
  console.log(`[P105 rail ${tag} viewport] ${JSON.stringify({ railRight: snap.railRight, listRight: snap.listRight, newTabRight: snap.newTabRight, allTabsRight: snap.allTabsRight, activeRight: snap.active ? snap.active.right : null, viewportW: snap.viewportW })}`);
  expect(snap.railRight, `${tag}: .document-rail right edge is within the viewport`).toBeLessThanOrEqual(snap.viewportW + 1);
  expect(snap.listRight, `${tag}: .tab-list right edge is within the viewport`).toBeLessThanOrEqual(snap.viewportW + 1);
  expect(snap.newTabRight, `${tag}: [data-new-tab] is within the viewport`).toBeLessThanOrEqual(snap.viewportW + 1);
  expect(snap.allTabsRight, `${tag}: [data-all-tabs] is within the viewport`).toBeLessThanOrEqual(snap.viewportW + 1);
  expect(snap.active, `${tag}: an active tab is rendered`).not.toBeNull();
  expect(snap.active.right, `${tag}: the ACTIVE tab is within the viewport`).toBeLessThanOrEqual(snap.viewportW + 1);
}

function assertRail(tag, snap, expectedTotal) {
  console.log(`[P105 rail ${tag}] ${JSON.stringify({ total: snap.total, visible: snap.visibleCount, hidden: snap.hiddenCount, min: snap.minWidth, max: snap.maxWidth, listRight: snap.listRight, viewportW: snap.viewportW, newTabRight: snap.newTabRight, allTabsRight: snap.allTabsRight, activeRight: snap.active ? snap.active.right : null })}`);
  assertViewportContainment(tag, snap);
  expect(snap.total, `${tag}: every session mounted`).toBe(expectedTotal);
  expect(snap.visibleCount, `${tag}: at least one tab rendered`).toBeGreaterThanOrEqual(1);
  expect(snap.minWidth, `${tag}: no rendered tab below ${MIN_TAB}px`).toBeGreaterThanOrEqual(MIN_TAB - 0.5);
  expect(snap.maxWidth, `${tag}: no rendered tab above ${MAX_TAB}px`).toBeLessThanOrEqual(MAX_TAB + 0.5);
  expect(snap.newTab, `${tag}: [data-new-tab] present`).toBe(true);
  expect(snap.allTabs, `${tag}: [data-all-tabs] present`).toBe(true);
  expect(snap.overflowX, `${tag}: .tab-list never scrolls (overflow-x hidden)`).toBe('hidden');
  expect(snap.scrollLeft, `${tag}: .tab-list scrollLeft stays 0`).toBe(0);
  // The rail must stay inside the window: the strip cannot grow past the
  // viewport, the reserved controls are never clipped off-screen, and the
  // active document stays visible.
  expect(snap.listRight, `${tag}: the strip does not exceed the viewport width`).toBeLessThanOrEqual(snap.viewportW + 1);
  expect(snap.railRight, `${tag}: the document rail does not exceed the viewport width`).toBeLessThanOrEqual(snap.viewportW + 1);
  expect(snap.newTabRight, `${tag}: the New-tab control is on-screen`).toBeLessThanOrEqual(snap.viewportW + 1);
  expect(snap.allTabsRight, `${tag}: the All-tabs control is on-screen`).toBeLessThanOrEqual(snap.viewportW + 1);
  expect(snap.active, `${tag}: the active tab is rendered (visible)`).not.toBeNull();
  expect(snap.active.left, `${tag}: active tab left edge inside the strip`).toBeGreaterThanOrEqual(snap.listLeft - 1);
  expect(snap.active.right, `${tag}: the active tab stays on-screen`).toBeLessThanOrEqual(snap.viewportW + 1);
  const overlap = snap.visible.some((t, i) => i > 0 && t.left < snap.visible[i - 1].right - 0.5);
  expect(overlap, `${tag}: adjacent visible tabs never overlap`).toBe(false);
}

test('document rail: 1/3/12/30 tabs keep readable widths, reserved controls and no horizontal scroll', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p105-rail-'));
  const src = getSamplePath('report.pdf');
  const paths = [];
  for (let i = 0; i < 30; i += 1) {
    const p = path.join(tmp, `rail-${i + 1}.pdf`);
    fs.copyFileSync(src, p);
    paths.push(p);
  }

  let opened = 0;
  const stage = async (target, tag, shot) => {
    for (let i = opened; i < target; i += 1) {
      await openPath(paths[i]);
      await win.waitForFunction(
        (count) => document.querySelectorAll('[data-tab-id]').length >= count,
        i + 1,
        { timeout: 30000 },
      );
    }
    opened = target;
    await win.waitForTimeout(700);
    const snap = await railSnapshot();
    await win.screenshot({ path: path.join(SHOTS, shot) });
    return snap;
  };

  // DEF-579 rendered regression guard — capture the FIRST layout at the app's
  // native window size BEFORE any window resize in this test. The pre-fix rail
  // stretched to its tab content (~2200px at 12 tabs) on first paint; a later
  // resize re-measured and self-corrected, so the guard must run here, ahead of
  // `setWindowSize`.
  await openPath(paths[0]);
  await win.waitForFunction(
    (count) => document.querySelectorAll('[data-tab-id]').length >= count,
    1,
    { timeout: 30000 },
  );
  opened = 1;
  await win.waitForTimeout(700);
  const native = await railSnapshot();
  await win.screenshot({ path: path.join(SHOTS, 'phase105-rail-native.png') });

  // The 1280px contract from the phase spec and the dev evidence: 12 tabs ->
  // visible=8 hidden=4; 30 tabs -> visible=8 hidden=22. No resize occurs between
  // opening these tabs and measuring them, so each is also a first-layout check.
  await setWindowSize(1280, 800);

  // Capture every stage + screenshot FIRST so the evidence exists even when an
  // assertion fails, then assert each stage.
  const s1 = await stage(1, '1', 'phase105-rail-1.png');
  const s3 = await stage(3, '3', 'phase105-rail-3.png');
  const s12 = await stage(12, '12', 'phase105-rail-12.png');
  const s30 = await stage(30, '30', 'phase105-rail-30.png');

  // Supported narrow width snapshot (640px). Wait for the rail capacity to
  // settle after the resize before snapshotting (DEF-583-class settle race).
  await setWindowSize(640, 620);
  await waitForRailContained();
  const narrow = await railSnapshot();
  await win.screenshot({ path: path.join(SHOTS, 'phase105-narrow.png') });

  assertRail('native-1', native, 1);
  assertRail('1', s1, 1);
  assertRail('3', s3, 3);
  assertRail('12', s12, 12);
  assertRail('30', s30, 30);
  assertRail('640px', narrow, 30);

  expect(s1.hiddenCount, '1 tab: nothing hidden').toBe(0);
  expect(s3.hiddenCount, '3 tabs: nothing hidden').toBe(0);
  expect(s30.hiddenCount, '30 tabs: overflow hides sessions (still open)').toBeGreaterThan(0);
  expect(s30.visibleCount, '30 tabs: the visible window is smaller than the session count').toBeLessThan(30);
  console.log(`[P105 rail] 12 tabs hidden=${s12.hiddenCount}; 30 tabs hidden=${s30.hiddenCount}`);
});

// ---------------------------------------------------------------------------
// 3. All-tabs switcher — complete session list, accurate count, dirty state,
//    duplicate-name context, row activation, Escape refocus. Then per-session
//    identity stability through a reorder (active document unchanged).
// ---------------------------------------------------------------------------
async function switcherRows() {
  return win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-all-tabs-row]')).map((r) => ({
      id: r.getAttribute('data-all-tabs-row'),
      name: r.querySelector('.all-tabs-name') ? r.querySelector('.all-tabs-name').textContent : '',
      context: r.querySelector('.all-tabs-context') ? r.querySelector('.all-tabs-context').textContent : '',
      dirty: r.querySelector('.all-tabs-dot') !== null,
      ariaLabel: r.getAttribute('aria-label'),
    })),
  );
}

async function colorIdMap() {
  return win.evaluate(() => {
    const out = {};
    for (const t of document.querySelectorAll('[data-tab-id]')) {
      out[t.getAttribute('data-tab-id')] = t.getAttribute('data-tab-color-id');
    }
    return out;
  });
}

test('All-tabs switcher lists every session with count, dirty state and duplicate context; identity survives reorder', async () => {
  await setWindowSize(1280, 800);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p105-switch-'));
  const dirX = path.join(tmp, 'x');
  const dirY = path.join(tmp, 'y');
  fs.mkdirSync(dirX);
  fs.mkdirSync(dirY);
  const report = getSamplePath('report.pdf');
  const long = getSamplePath('long.pdf');
  const sameX = path.join(dirX, 'same.pdf');
  const sameY = path.join(dirY, 'same.pdf');
  fs.copyFileSync(report, sameX);
  fs.copyFileSync(report, sameY);

  const ordered = [report, long, sameX, sameY];
  for (let i = 0; i < ordered.length; i += 1) {
    await openPath(ordered[i]);
    await win.waitForFunction(
      (count) => document.querySelectorAll('[data-tab-id]').length >= count,
      i + 1,
      { timeout: 30000 },
    );
  }
  await win.waitForTimeout(800);

  // Make the ACTIVE session dirty (real UI edit through the dock Rotate verb).
  const dirtyId = await activeTabId();
  await rotateActiveViaDock();

  // Open the switcher.
  await win.locator('[data-all-tabs]').click();
  await win.waitForSelector('[data-all-tabs-popover]', { state: 'visible', timeout: 8000 });
  const rows = await switcherRows();
  console.log(`[P105 switcher] rows=${JSON.stringify(rows)}`);
  expect(rows.length, 'switcher lists every open session').toBe(4);

  const countText = await win.locator('.all-tabs-count').textContent();
  expect(countText, 'the switcher shows the accurate total count').toContain('4 documents');

  const dirtyRows = rows.filter((r) => r.dirty);
  expect(dirtyRows.length, 'exactly one session shows the dirty indicator').toBe(1);
  expect(dirtyRows[0].id, 'the dirty row is the modified session').toBe(dirtyId);
  expect(dirtyRows[0].ariaLabel, 'the dirty row announces unsaved changes').toContain('unsaved changes');
  const cleanRow = rows.find((r) => r.id !== dirtyId);
  expect(cleanRow.dirty, 'a clean session shows no dirty indicator').toBe(false);
  expect(cleanRow.ariaLabel, 'a clean row does not announce unsaved changes').not.toContain('unsaved changes');

  const dupRows = rows.filter((r) => r.name === 'same.pdf');
  expect(dupRows.length, 'both duplicate-name sessions are listed').toBe(2);
  expect(dupRows.every((r) => r.context !== ''), 'duplicate basenames carry folder context').toBe(true);
  expect(dupRows.map((r) => r.context).sort(), 'duplicate rows disambiguate by parent folder').toEqual(['x', 'y']);
  const nonDup = rows.find((r) => r.name !== 'same.pdf');
  expect(nonDup.context, 'a unique basename carries no context').toBe('');

  await win.screenshot({ path: path.join(SHOTS, 'phase105-switcher.png') });

  // Activate a row -> that session becomes the active document.
  const targetRow = rows.find((r) => r.id !== dirtyId);
  await win.locator(`[data-all-tabs-row="${targetRow.id}"]`).click();
  await win.waitForSelector('[data-all-tabs-popover]', { state: 'hidden', timeout: 8000 });
  await win.waitForTimeout(400);
  const afterPick = await activeTabId();
  console.log(`[P105 switcher] picked ${targetRow.id} -> active=${afterPick}`);
  expect(afterPick, 'activating a switcher row switches the active document').toBe(targetRow.id);

  // Reopen; Escape refocuses the trigger.
  await win.locator('[data-all-tabs]').click();
  await win.waitForSelector('[data-all-tabs-popover]', { state: 'visible', timeout: 8000 });
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-all-tabs-popover]', { state: 'hidden', timeout: 8000 });
  const refocus = await win.evaluate(() => {
    const el = document.querySelector('[data-all-tabs]');
    return el !== null && document.activeElement === el;
  });
  expect(refocus, 'Escape returns focus to [data-all-tabs]').toBe(true);

  // Per-session identity: every tab carries a non-empty colorId that does NOT
  // change when the tab is reordered; the active document is unchanged.
  const before = await colorIdMap();
  expect(Object.values(before).every((c) => c !== null && c !== ''), 'every tab carries a data-tab-color-id').toBe(true);

  const orderBefore = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-tab-id]')).map((t) => t.getAttribute('data-tab-id')));
  const activeBefore = await activeTabId();
  const firstBox = await win.locator(`[data-tab-id="${orderBefore[0]}"]`).boundingBox();
  const lastId = orderBefore[orderBefore.length - 1];
  await dragTab(lastId, firstBox.x + 2);
  const orderAfter = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-tab-id]')).map((t) => t.getAttribute('data-tab-id')));
  const after = await colorIdMap();
  const activeAfter = await activeTabId();
  console.log(`[P105 identity] order ${JSON.stringify(orderBefore)} -> ${JSON.stringify(orderAfter)}; active ${activeBefore} -> ${activeAfter}`);
  expect(orderAfter[0], 'the dragged tab moved to the front').toBe(lastId);
  expect(activeAfter, 'the active document is unchanged by the reorder').toBe(activeBefore);
  for (const id of Object.keys(before)) {
    expect(after[id], `colorId stable for ${id} across reorder`).toBe(before[id]);
  }
});

// ---------------------------------------------------------------------------
// 4. Preserved behaviour — dirty-close Cancel keeps the tab open; the empty-tab
//    "+" still works; Multi Mode disables it with its documented reason.
// ---------------------------------------------------------------------------
test('preserved behaviour: dirty-close Cancel keeps the tab; + creates an empty tab; Multi Mode disables + with its reason', async () => {
  await openCopies(1, 'preserve');
  await win.waitForSelector('.workspace', { timeout: 30000 });

  await rotateActiveViaDock();

  const countBefore = await win.locator('[data-tab-id]').count();
  const activeId = await activeTabId();
  await win.locator(`[data-tab-id="${activeId}"] .tab-close`).click();
  await win.waitForSelector('[data-close-prompt]', { timeout: 10000 });
  await win.locator('[data-close-prompt-action="cancel"]').click();
  await win.waitForSelector('[data-close-prompt]', { state: 'hidden', timeout: 10000 });
  await win.waitForTimeout(400);
  const countAfterCancel = await win.locator('[data-tab-id]').count();
  console.log(`[P105 preserve] dirty-close Cancel: tabs ${countBefore} -> ${countAfterCancel}`);
  expect(countAfterCancel, 'dirty-close Cancel keeps the tab open').toBe(countBefore);

  // The "+" still mints an empty session.
  await win.locator('[data-new-tab]').click();
  await win.waitForFunction(
    (n) => document.querySelectorAll('[data-tab-id]').length === n + 1,
    countBefore,
    { timeout: 10000 },
  );
  const emptyActive = await win.evaluate(() => {
    const t = document.querySelector('[data-tab-id][aria-selected="true"] .tab-title-text');
    return t === null ? null : t.textContent;
  });
  console.log(`[P105 preserve] new empty tab title="${emptyActive}"`);
  expect(emptyActive, 'the + creates an empty session').toBe('Empty tab');

  // Multi Mode disables the "+" with the documented reason.
  await win.locator('[data-header-multi-mode]').first().click();
  await win.waitForTimeout(700);
  const newTabState = await win.evaluate(() => {
    const b = document.querySelector('[data-new-tab]');
    return b === null ? null : { disabled: b.disabled, title: b.getAttribute('title') };
  });
  console.log(`[P105 preserve] multi-mode new-tab=${JSON.stringify(newTabState)}`);
  expect(newTabState, '[data-new-tab] present in Multi Mode').not.toBeNull();
  expect(newTabState.disabled, 'Multi Mode disables the + control').toBe(true);
  expect(newTabState.title, 'the + carries the Multi Mode disabled reason').toBe(MULTI_MODE_REASON);

  // Leave Multi Mode.
  await win.locator('[data-header-multi-mode]').first().click();
  await win.waitForTimeout(500);
});

// ---------------------------------------------------------------------------
// 5. CONTROL-INDEX sweep — every inventoried command still resolves to a real
//    handler in its mapped location (File popover rows + relocated application
//    menu rows), and the genuine drag region survives.
// ---------------------------------------------------------------------------
test('CONTROL-INDEX: File and application menus carry every inventoried command; drag region present', async () => {
  await openCopies(1, 'ci');
  await win.waitForSelector('.workspace', { timeout: 30000 });

  const drag = await win.evaluate(() => {
    const el = document.querySelector('.titlebar-drag');
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    const parent = el.parentElement;
    return {
      width: +r.width.toFixed(1),
      left: +r.left.toFixed(1),
      appRegion: getComputedStyle(el).getPropertyValue('-webkit-app-region'),
      parentClass: parent === null ? null : parent.className,
      parentDisplay: parent === null ? null : getComputedStyle(parent).display,
      parentRegion: parent === null ? null : getComputedStyle(parent).getPropertyValue('-webkit-app-region'),
      headerRegion: (() => {
        const h = document.querySelector('.app-header');
        return h === null ? null : getComputedStyle(h).getPropertyValue('-webkit-app-region');
      })(),
      slotRegion: (() => {
        const s = document.querySelector('.titlebar-slot');
        return s === null ? null : getComputedStyle(s).getPropertyValue('-webkit-app-region');
      })(),
      rowRegion: (() => {
        const t = document.querySelector('.titlebar');
        return t === null ? null : getComputedStyle(t).getPropertyValue('-webkit-app-region');
      })(),
    };
  });
  console.log(`[P105 CI] drag region=${JSON.stringify(drag)}`);
  expect(drag, 'the flexible middle drag region is present').not.toBeNull();
  expect(drag.appRegion.trim(), 'the middle is a real drag region').toBe('drag');
  // The 0-width `.titlebar-drag` spacer is redundant (its min-width is overridden
  // elsewhere); the genuine drag surface is the whole title row minus interactive
  // children, carried by `.app-header` / `.titlebar-slot` / `.titlebar` (DEF-132).
  expect(
    [drag.headerRegion, drag.slotRegion, drag.rowRegion].map((r) => (r === null ? null : r.trim())),
    'the title row carries a genuine app-region: drag surface',
  ).toContain('drag');
  expect(await win.locator('.titlebar > .brand').count(), 'the brand leads the title row').toBeGreaterThan(0);

  await win.locator('[data-menu-button]').click();
  await win.waitForSelector('[data-menu-popover]', { state: 'visible', timeout: 8000 });
  const fileActions = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-menu-popover] [data-menu-action]')).map((e) =>
      e.getAttribute('data-menu-action'),
    ),
  );
  await win.keyboard.press('Escape');
  await waitForPopoverClosed('[data-menu-popover]');
  console.log(`[P105 CI] File menu actions=${JSON.stringify(fileActions)}`);
  for (const a of ['open', 'merge', 'save', 'saveAs', 'closeTab']) {
    expect(fileActions, `File menu carries ${a}`).toContain(a);
  }

  // The retired application menu's rows now live in the File menu; Multi Mode
  // and Find are the restored header controls.
  await win.locator('[data-menu-button]').click();
  await win.waitForSelector('[data-menu-popover]', { state: 'visible', timeout: 8000 });
  const appActions = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-menu-popover] [data-menu-action]')).map((e) =>
      e.getAttribute('data-menu-action'),
    ),
  );
  await win.keyboard.press('Escape');
  console.log(`[P105 CI] File menu actions=${JSON.stringify(appActions)}`);
  for (const a of [
    'undo', 'redo', 'preferences', 'toggleTheme', 'showToolsPalette',
    'recognizeText', 'checkForUpdate', 'about',
  ]) {
    expect(appActions, `File menu carries ${a}`).toContain(a);
  }
  expect(await win.locator('[data-header-multi-mode]').count(), 'Multi Mode header control present').toBeGreaterThan(0);
  expect(await win.locator('[data-header-find]').count(), 'Find header control present').toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// ADV-225 (DEF-595, HIGH) rendered regression guard: above 900px the File-menu
// popover must stay an anchored, opaque, width-bounded dropdown that never
// falls back into an in-flow block. Pre-fix the retired app-menu's `.app-menu*`
// rules were nested in the 900px responsive band, so at 1440/1280 the popover
// computed `position: static` and rendered as a ~925px in-flow block that
// overlapped the title row and the document rail.
//
// TFL-1653 — the oracle was re-targeted to the SHIPPED File-menu layout. Phase
// 127 relocated the File trigger from the trailing edge (the DEF-595 retest read
// `pop.right == trig.right` at 1158.66) to the LEADING edge after the brand, so
// the dropdown now anchors to the trigger's LEFT edge and legitimately overlays
// the rail below it. The in-flow regression is guarded by the out-of-flow
// `position` assertion plus the rail-not-pushed check (the rail's settled rect
// is byte-identical before and while the popover is open); the < 500px width
// bound still catches the ~925px in-flow block.
// ---------------------------------------------------------------------------
test('ADV-225 regression: File-menu popover is anchored + bounded above 900px (no in-flow rail overlap)', async () => {
  await openCopies(1, 'adv225');
  await win.waitForSelector('.workspace', { timeout: 30000 });

  const railRects = () => win.evaluate(() => {
    const round = (el) => {
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { left: +r.left.toFixed(2), right: +r.right.toFixed(2), top: +r.top.toFixed(2), bottom: +r.bottom.toFixed(2) };
    };
    return {
      rail: round(document.querySelector('.document-rail')),
      list: round(document.querySelector('.tab-list')),
    };
  });

  for (const [w, h] of [[1440, 900], [1280, 800]]) {
    await setWindowSize(w, h);
    await win.waitForFunction((vw) => window.innerWidth <= vw + 1, w, { timeout: 8000 });
    await waitForPopoverClosed('[data-menu-popover]').catch(() => {});

    // Baseline: the rail's settled geometry with the File menu CLOSED.
    const closed = await railRects();

    await win.locator('[data-menu-button]').click();
    await win.waitForSelector('[data-menu-popover]', { state: 'visible', timeout: 8000 });
    await win.waitForTimeout(200);

    const geo = await win.evaluate(() => {
      const pop = document.querySelector('[data-menu-popover]');
      const trig = document.querySelector('[data-menu-button]');
      if (pop === null || trig === null) return null;
      const pr = pop.getBoundingClientRect();
      const tr = trig.getBoundingClientRect();
      const cs = getComputedStyle(pop);
      return {
        position: cs.position,
        zIndex: cs.zIndex,
        backgroundColor: cs.backgroundColor,
        width: +pr.width.toFixed(2),
        pop: { left: +pr.left.toFixed(2), right: +pr.right.toFixed(2), top: +pr.top.toFixed(2), bottom: +pr.bottom.toFixed(2) },
        trig: { left: +tr.left.toFixed(2), right: +tr.right.toFixed(2), top: +tr.top.toFixed(2), bottom: +tr.bottom.toFixed(2) },
        viewportW: window.innerWidth,
      };
    });
    const open = await railRects();
    console.log(`[P105 ADV-225 ${w}x${h}] geo=${JSON.stringify(geo)} railClosed=${JSON.stringify(closed)} railOpen=${JSON.stringify(open)}`);
    expect(geo, `${w}: File-menu popover + trigger present`).not.toBeNull();

    expect(geo.viewportW, `${w}: viewport is in the >900px band (defect trigger)`).toBeGreaterThan(900);
    expect(['absolute', 'fixed'], `${w}: popover is out of flow (position ${geo.position})`).toContain(geo.position);
    expect(geo.backgroundColor, `${w}: popover background is opaque (${geo.backgroundColor})`).not.toMatch(/rgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)|transparent/);
    expect(geo.width, `${w}: popover width is bounded (< 500px)`).toBeLessThan(500);
    expect(geo.width, `${w}: popover keeps a real minimum width`).toBeGreaterThan(150);
    expect(geo.pop.top, `${w}: popover top is at/below the trigger bottom`).toBeGreaterThanOrEqual(geo.trig.bottom - 1);
    // TFL-1653 — the File trigger sits on the leading edge after the brand, so
    // the dropdown anchors to the trigger's LEFT edge. The DEF-595 retest only
    // saw `pop.right == trig.right` because the trigger was on the trailing edge.
    expect(Math.abs(geo.pop.left - geo.trig.left), `${w}: popover left is anchored to the trigger left`).toBeLessThanOrEqual(2);
    // The popover is an overlay, never an in-flow block: the rail's settled rect
    // is identical with the menu open and closed (the DEF-595 regression symptom).
    expect(open.rail, `${w}: the popover does not push/reflow the document rail`).toEqual(closed.rail);
    expect(open.list, `${w}: the popover does not push/reflow the tab strip`).toEqual(closed.list);
    // The dropdown stays inside the window.
    expect(geo.pop.left, `${w}: popover left is on-screen`).toBeGreaterThanOrEqual(-1);
    expect(geo.pop.right, `${w}: popover right is on-screen`).toBeLessThanOrEqual(geo.viewportW + 1);

    if (w === 1440) {
      await win.screenshot({ path: path.join(SHOTS, 'phase105-adv225-filemenu-1440x900.png') });
    }

    await win.keyboard.press('Escape');
    await waitForPopoverClosed('[data-menu-popover]');
  }
});
// ADV-225-END

// ---------------------------------------------------------------------------
// ADV-226 (DEF-* MEDIUM) rendered regression guard: with the Inspector open and
// 12 tabs, the All-tabs switcher popover must paint ABOVE the Inspector across
// its FULL width. Pre-fix `.tab-list-all { z-index: 3 }` capped the popover's
// context below `.inspector` (z-index 30), so the Inspector occluded the
// popover's right ~164px.
// ---------------------------------------------------------------------------
test('ADV-226 regression: All-tabs switcher is not occluded by the Inspector at 12 tabs', async () => {
  await setWindowSize(1280, 800);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p105-adv226-'));
  const dirA = path.join(tmp, 'a');
  const dirB = path.join(tmp, 'b');
  fs.mkdirSync(dirA);
  fs.mkdirSync(dirB);
  const report = getSamplePath('report.pdf');
  const dupA = path.join(dirA, 'dup.pdf');
  const dupB = path.join(dirB, 'dup.pdf');
  fs.copyFileSync(report, dupA);
  fs.copyFileSync(report, dupB);

  const ordered = [dupA, dupB];
  for (let i = 0; i < 10; i += 1) {
    const p = path.join(tmp, `adv226-${i + 1}.pdf`);
    fs.copyFileSync(report, p);
    ordered.push(p);
  }

  for (let i = 0; i < ordered.length; i += 1) {
    await openPath(ordered[i]);
    await win.waitForFunction(
      (count) => document.querySelectorAll('[data-tab-id]').length >= count,
      i + 1,
      { timeout: 30000 },
    );
  }
  await win.waitForTimeout(800);

  // Activate the dupA session through the switcher (the rail hides most tabs at
  // 12), then dirty it, so the first switcher row carries BOTH `.all-tabs-dot`
  // (dirty) and `.all-tabs-context` (duplicate basename) inside the popover's
  // initial scroll view.
  await win.locator('[data-all-tabs]').click();
  await win.waitForSelector('[data-all-tabs-popover]', { state: 'visible', timeout: 8000 });
  const dupAId = await win.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-all-tabs-row]'));
    const row = rows.find((r) => {
      const n = r.querySelector('.all-tabs-name');
      const c = r.querySelector('.all-tabs-context');
      return n !== null && n.textContent === 'dup.pdf' && c !== null && c.textContent === 'a';
    });
    return row === undefined ? null : row.getAttribute('data-all-tabs-row');
  });
  expect(dupAId, 'the dup.pdf (folder a) row is listed in the switcher').not.toBeNull();
  await win.locator(`[data-all-tabs-row="${dupAId}"]`).click();
  await win.waitForSelector('[data-all-tabs-popover]', { state: 'hidden', timeout: 8000 });
  await win.waitForTimeout(400);
  await rotateActiveViaDock();

  const inspector = await win.evaluate(() => {
    const el = document.querySelector('.inspector') || document.querySelector('[data-inspector]');
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return {
      left: +r.left.toFixed(1), right: +r.right.toFixed(1),
      top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1),
      z: getComputedStyle(el).zIndex,
    };
  });
  console.log(`[P105 ADV-226] inspector=${JSON.stringify(inspector)}`);
  expect(inspector, 'the Inspector is open at 12 tabs').not.toBeNull();

  await win.locator('[data-all-tabs]').click();
  await win.waitForSelector('[data-all-tabs-popover]', { state: 'visible', timeout: 8000 });
  await win.waitForTimeout(250);

  const probe = await win.evaluate(() => {
    const pop = document.querySelector('[data-all-tabs-popover]');
    if (pop === null) return null;
    const pr = pop.getBoundingClientRect();
    const inside = (el) => el !== null && (el === pop || pop.contains(el));
    const label = (el) => (el === null ? null : (typeof el.className === 'string' && el.className) || el.tagName);
    const samples = [];
    const fractions = [0.05, 0.3, 0.5, 0.7, 0.85, 0.93];
    for (const f of fractions) {
      const x = pr.left + pr.width * f;
      for (const yf of [0.15, 0.5, 0.85]) {
        const y = pr.top + pr.height * yf;
        const top = document.elementFromPoint(x, y);
        samples.push({ f, yf, x: +x.toFixed(1), y: +y.toFixed(1), inside: inside(top), top: label(top) });
      }
    }
    // The right ~164px band the Inspector used to occlude.
    const bandLeft = Math.max(pr.left, pr.right - 164);
    const band = [];
    for (let i = 1; i <= 4; i += 1) {
      const x = bandLeft + ((pr.right - bandLeft) * i) / 5;
      const y = pr.top + pr.height / 2;
      const top = document.elementFromPoint(x, y);
      band.push({ x: +x.toFixed(1), inside: inside(top), top: label(top) });
    }
    const hit = (el) => {
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { present: true, inside: inside(top) };
    };
    const switcherContext = document.querySelector('.tab-list-all');
    return {
      pop: { left: +pr.left.toFixed(1), right: +pr.right.toFixed(1), top: +pr.top.toFixed(1), bottom: +pr.bottom.toFixed(1), width: +pr.width.toFixed(1) },
      switcherZ: switcherContext === null ? null : getComputedStyle(switcherContext).zIndex,
      samples,
      band,
      dot: hit(pop.querySelector('.all-tabs-dot')),
      context: hit(pop.querySelector('.all-tabs-context')),
      rows: pop.querySelectorAll('[data-all-tabs-row]').length,
    };
  });
  console.log(`[P105 ADV-226] probe=${JSON.stringify(probe)}`);
  expect(probe, 'switcher popover present').not.toBeNull();
  expect(probe.rows, 'all 12 sessions are listed').toBe(12);
  expect(Number(probe.switcherZ), 'the switcher context stacks above the Inspector (40 > 30)')
    .toBeGreaterThan(Number(inspector.z));

  const offenders = probe.samples.filter((s) => !s.inside);
  console.log(`[P105 ADV-226] topmost offenders=${JSON.stringify(offenders)}`);
  expect(offenders, 'every sampled point across the switcher width hits the popover (not the Inspector)').toEqual([]);
  const bandOffenders = probe.band.filter((s) => !s.inside);
  expect(bandOffenders, 'the right ~164px band is not occluded by the Inspector').toEqual([]);
  expect(probe.dot, '.all-tabs-dot present on a dirty row').not.toBeNull();
  expect(probe.dot.inside, '.all-tabs-dot is hit-testable inside the popover').toBe(true);
  expect(probe.context, '.all-tabs-context present on a duplicate-name row').not.toBeNull();
  expect(probe.context.inside, '.all-tabs-context is hit-testable inside the popover').toBe(true);

  await win.screenshot({ path: path.join(SHOTS, 'phase105-adv226-switcher-inspector-1280x800.png') });
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-all-tabs-popover]', { state: 'hidden', timeout: 8000 });
});
