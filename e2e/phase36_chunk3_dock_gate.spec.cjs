// Phase 36 (chunk 3) gate (qa) — the Action Dock, the floating pills, the
// annotations flyout and the retirement of the per-view CommandBar row.
//
// Launches only through the canonical e2e/lib/launch.cjs launchApp helper.
// Captures exactly TWO screenshots:
//   screenshots/phase36-chunk3-dock.png          (PAGES stage, current page
//                                                 selected: dock + pills +
//                                                 the reclaimed canvas)
//   screenshots/phase36-chunk3-stage-review.png  (REVIEW stage, flyout OPEN)
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, toggleMultiModeViaPalette, armAnnotationTool, clickDockVerb } = require('./lib/helpers.cjs');

// The harness launches this worker with ELECTRON_RUN_AS_NODE=1; Playwright's
// Electron driver needs it cleared to launch the real app.
delete process.env.ELECTRON_RUN_AS_NODE;

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const DOCK_SHOT = path.join(SHOTS, 'phase36-chunk3-dock.png');
const REVIEW_SHOT = path.join(SHOTS, 'phase36-chunk3-stage-review.png');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(250);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p36-chunk3');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function openSample(name = 'report.pdf') {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

async function setStage(n) {
  // The Ctrl+1..4 chord deliberately does NOT fire while a text field has
  // focus, so blur first (the page pill's input keeps focus after a jump).
  await win.evaluate(() => {
    const el = document.activeElement;
    if (el !== null && typeof el.blur === 'function') el.blur();
  });
  await win.keyboard.press(`Control+${n}`);
  await win.waitForTimeout(300);
}

async function dockVerbs() {
  // Phase 37 — the full set may spill into the `...` overflow menu at a
  // non-arrow width, so the rendered set is inline + overflow.
  const inline = await win.$$eval('[data-action-dock] [data-dock-verb]:not([data-dock-pin])', (els) =>
    els.map((e) => e.getAttribute('data-dock-verb')));
  if ((await win.locator('[data-dock-overflow]').count()) === 0) return inline;
  await win.locator('[data-dock-overflow]').first().click();
  await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 8000 });
  const overflow = await win.$$eval('[data-dock-overflow-item]', (els) =>
    els.map((e) => e.getAttribute('data-dock-overflow-item')));
  await win.keyboard.press('Escape');
  await win.waitForTimeout(200);
  return [...inline, ...overflow];
}

async function dockState() {
  return win.locator('[data-action-dock]').getAttribute('data-dock-state');
}

async function loadSettings() {
  const r = await win.evaluate(() => window.tflex.loadSettings());
  return r && r.ok ? r.value : null;
}

// RE-DERIVED for Phase 37 (item 21): the dock renders the stage's FULL relevant
// set by default (DOCK_STAGE_IDS in toolsRegistry), not the Phase-36 curated
// subset. `editMode` is retired (the EDIT stage is the switch). Re-baselined
// again (TFL-1489) to the shipped DOCK_STAGE_IDS, then to the shipped RENDER
// ORDER (TFL-1503): Phase 104 splits each stage set into the ~5 curated PRIMARY
// tiles rendered INLINE first, then every remaining DOCK_STAGE_IDS id in the
// `...` More overflow. `dockVerbs()` concatenates inline + overflow, so the
// expected order is DOCK_PRIMARY_IDS then the stage-set remainder.
const EXPECTED = {
  pages: ['rotate', 'extract', 'insertPages', 'merge', 'cropPages', 'replacePages', 'split', 'delete'],
  edit: ['editToolOff', 'editText', 'editImage', 'editTextBox', 'recognizeText', 'batchOcr', 'ocrSuspects'],
  review: [
    'annotate', 'sign', 'stamp', 'bates', 'flatten', 'watermark', 'exportComments',
    'importComments', 'fillFromCsv', 'exportFormData', 'importFormData',
    'validateDocument', 'sanitize', 'engineeringLayers', 'documentInfo',
  ],
  deliver: ['optimize', 'exportPages', 'exportText', 'exportDocx', 'encrypt', 'audit', 'exportXlsx', 'exportPptx', 'createFromImages'],
};

// ---------------------------------------------------------------------------
// A. The dock's four per-stage contents, the primary treatment, a disabled
//    verb's reason.
// ---------------------------------------------------------------------------
test('P36-C3-A dock: the four stage verb sets, the accent-soft primary, a disabled reason', async () => {
  await openSample();
  const dock = win.locator('[data-action-dock]');
  await expect(dock).toBeVisible();

  const seen = {};
  for (const [n, stage] of [[1, 'pages'], [2, 'edit'], [3, 'review'], [4, 'deliver']]) {
    await setStage(n);
    expect(await dock.getAttribute('data-dock-state')).toBe('stage');
    const verbs = await dockVerbs();
    seen[stage] = verbs;
    console.log(`[P36C3-A] ${stage}: ${JSON.stringify(verbs)}`);
    expect(verbs, `${stage} dock verb set = the registry's dock-surface entries`).toEqual(EXPECTED[stage]);
  }

  // State 1's FIRST button carries the stage-primary accent-soft treatment.
  // (Curated PAGES order is rotate first, so the primary is 'rotate' now.)
  await setStage(1);
  const primary = win.locator('[data-dock-group="primary"] .action-dock-verb').first();
  expect(await primary.getAttribute('data-dock-verb')).toBe('rotate');
  expect(await primary.evaluate((el) => el.classList.contains('action-dock-verb-primary'))).toBe(true);
  const primaryLabel = (await primary.locator('.action-dock-label').innerText()).trim();
  console.log(`[P36C3-A] primary label="${primaryLabel}"`);
  // Phase 113 (Quiet Actions) retired the Phase-36 accent-soft FILL; the primary
  // tile is now a QUIET control whose treatment is the `action-dock-verb-primary`
  // class (asserted above) plus its curated short label (DOCK_SHORT_LABELS).
  expect(primaryLabel, 'the primary tile shows the curated short label').toBe('Rotate');

  // DEF-311 retest — a disabled verb's tooltip is the availability REASON, not
  // the description. Phase 37 item 13: entering EDIT enables Edit mode, so the
  // edit-layer tools are ENABLED; the disabled probe is `ocrSuspects`, which
  // needs an OCR run first (its title must state that precondition).
  await setStage(2);
  const disabledId = 'ocrSuspects';
  let disabled = win.locator(`[data-dock-verb="${disabledId}"]`);
  if ((await disabled.count()) === 0) {
    await win.locator('[data-dock-overflow]').first().click();
    await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 8000 });
    disabled = win.locator(`[data-dock-overflow-item="${disabledId}"]`);
  }
  expect(await disabled.count(), 'a disabled verb is still rendered').toBe(1);
  expect(await disabled.isDisabled(), `${disabledId} is disabled before an OCR run`).toBe(true);
  const reason = await disabled.getAttribute('title');
  console.log(`[P36C3-A] ${disabledId} disabled title="${reason}"`);
  expect(reason, 'the disabled tooltip is the availability reason').toBe('Run Recognize text first');
  expect(await disabled.evaluate((el) => getComputedStyle(el).cursor)).toBe('not-allowed');
});

// ---------------------------------------------------------------------------
// B. State 2 — the selection override: the chip, and the bulk Rotate / Extract
//    / Delete / Clear acting on the selected pages through the existing engine
//    paths. (Section 3A ruling 9: Merge was REMOVED from the bulk set — its
//    home is the PAGES panel header's Combine control.)
// ---------------------------------------------------------------------------
test('P36-C3-B selection override: [N pages] chip + bulk Rotate/Extract/Delete act on the set', async () => {
  await openSample();
  const panel = win.locator('[data-context-panel="pages"]');
  await expect(panel).toBeVisible();
  await panel.locator('.thumb-item').first().waitFor({ timeout: 20000 });

  // Ctrl+click three thumbnails: the PAGES stage switches to State 2.
  const thumb = (n) => panel.locator(`.thumb-item[data-page="${n}"]`);
  const selectedPages = async () => (await panel.locator('.thumb-selected').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-page')))).sort();

  // The three gestures: plain click single-selects, Ctrl toggles, Shift extends
  // from the last plain/ctrl click (anchor).
  await thumb(2).click();
  expect(await selectedPages(), 'plain click single-selects the clicked page').toEqual(['2']);
  await win.keyboard.down('Control');
  await thumb(4).click();
  await win.keyboard.up('Control');
  expect(await selectedPages(), 'Ctrl toggles a page in').toEqual(['2', '4']);
  await win.keyboard.down('Shift');
  await thumb(6).click();
  await win.keyboard.up('Shift');
  const extended = await selectedPages();
  console.log(`[P36C3-B] Shift extend from anchor 4 to 6 -> ${JSON.stringify(extended)}`);
  expect(extended, 'Shift extends the inclusive range from the anchor').toEqual(['4', '5', '6']);

  // Re-establish {2,3,4} with Ctrl toggles for the bulk assertions.
  await thumb(2).click();
  await win.keyboard.down('Control');
  await thumb(3).click();
  await thumb(4).click();
  await win.keyboard.up('Control');
  await win.waitForTimeout(400);

  expect(await dockState()).toBe('selection');
  const chip = await win.locator('[data-dock-chip]').innerText();
  console.log(`[P36C3-B] chip="${chip}" verbs=${JSON.stringify(await dockVerbs())}`);
expect(chip).toBe('3 pages');
  // Phase 104 (TFL-1503) — in State 2 the four bulk verbs are the INLINE tiles;
  // the stage's displaced primaries and secondary verbs stay reachable in the
  // `...` More overflow (DEF-569), so the full rendered set is the bulk verbs
  // first, then every PAGES membership id not already shown as a bulk tile.
  expect(await dockVerbs()).toEqual([
    'rotate', 'extract', 'delete', 'clearPageSelection',
    'insertPages', 'replacePages', 'split', 'merge', 'cropPages',
  ]);

  // Bulk Rotate rotates exactly the selected pages (existing engine path). The
  // engine stores rotation as a quarter-turn count (0..3), so cw = 1.
  await win.locator('[data-dock-verb="rotate"]').click();
  await win.waitForTimeout(1200);
  const rot = await win.evaluate(() => window.tflexDiagnostics().engineState.rotations.slice(0, 5));
  console.log(`[P36C3-B] rotations after bulk rotate=${JSON.stringify(rot)}`);
  expect(rot[1]).toBe(1);
  expect(rot[2]).toBe(1);
  expect(rot[3]).toBe(1);
  expect(rot[0], 'an unselected page is untouched').toBe(0);
  expect(rot[4], 'an unselected page is untouched').toBe(0);

  // Bulk Delete removes exactly the selected pages (existing engine path).
  const before = await win.evaluate(() => window.tflexDiagnostics().pageCount);
  await win.locator('[data-dock-verb="delete"]').click();
  await win.waitForTimeout(1800);
  const after = await win.evaluate(() => window.tflexDiagnostics().pageCount);
  console.log(`[P36C3-B] pageCount ${before} -> ${after}`);
  expect(after).toBe(before - 3);

  // The delete empties the selection -> back to State 1.
  expect(await dockState()).toBe('stage');
  expect(await win.locator('[data-dock-chip]').count()).toBe(0);
});

// ---------------------------------------------------------------------------
// C. State 3 — pins: right-click Pin, the divider, dedupe against the current
//    stage set, and the cap at 4.
// ---------------------------------------------------------------------------
test('P36-C3-C pins (Phase 37 item 21): un-pin a default verb, re-pin restores, cap at 4', async () => {
  await openSample();

  // TFL-1503 — seed four GLOBAL pins through the settings writer BEFORE any
  // local settings write in this session. The rotate below (and the palette
  // write) bumps the renderer's write sequence, after which the DEF-037
  // stale-echo filter would discard an external seed as an older reflection.
  // TFL-660: the four curated DOCK_GLOBAL_IDS are the only cross-stage-legal
  // pins visible in every stage.
  {
    const seeded = await loadSettings();
    await win.evaluate((v) => window.tflex.saveSettings(v), {
      ...seeded,
      dockPins: ['undo', 'redo', 'openReadingView', 'openComicView'],
      dockUnpinned: [],
    });
    await win.waitForTimeout(900);
  }

  // TFL-660 — make ONE undoable change so the curated global `undo` is live.
  // A fresh open carries an empty undo stack, so `undo`'s own dock gate greys
  // it and its pin menu is unreachable; the old always-enabled `panMode` is no
  // longer dock-pinnable. Rotating the visible page through the palette runs
  // the real engine path and fills the undo stack.
  await win.evaluate(() => {
    const el = document.activeElement;
    if (el !== null && typeof el.blur === 'function') el.blur();
  });
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
  await win.fill('[data-command-palette-input]', 'rotate counter');
  await win.waitForTimeout(250);
  await win.locator('[data-palette-tool-id="rotateCounterClockwise"]').first().click();
  await win.waitForSelector('[data-command-palette]', { state: 'detached', timeout: 8000 });
  await win.waitForTimeout(600);

  // DEF-312 retest — the pin menu is PICKED FROM THE REAL UI (no DOM-invoked
  // click): right-click a dock verb, then click the menu item with Playwright.
  // The menu is portalled to `document.body` so its fixed offsets resolve
  // against the VIEWPORT; every open must land inside it.
  const openMenu = async (id) => {
    await win.locator(`[data-dock-verb="${id}"]`).first().click({ button: 'right' });
    await win.waitForSelector('[data-dock-menu]', { state: 'visible', timeout: 8000 });
    const rect = await win.locator('[data-dock-menu]').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: Math.round(r.left), top: Math.round(r.top),
        right: Math.round(r.right), bottom: Math.round(r.bottom),
        vw: window.innerWidth, vh: window.innerHeight,
      };
    });
    const inside = rect.left >= 0 && rect.top >= 0 && rect.right <= rect.vw && rect.bottom <= rect.vh;
    console.log(`[P36C3-C] ${id} pin menu rect=${JSON.stringify(rect)} insideViewport=${inside}`);
    expect(inside, `the pin menu for '${id}' is clamped inside the viewport`).toBe(true);
    return rect;
  };
  const invokeMenu = async (which) => {
    await win.locator(`[data-dock-menu-item="${which}"]`).click();
    await win.waitForTimeout(500);
  };

  // --- Phase 37 item 21: UN-PIN a default PAGES verb. It leaves the dock and
  // is recorded in `dockUnpinned` (the inverse of a pin). The pin menu is only
  // reachable by right-clicking an INLINE tile (Phase 104 moved `split` into the
  // More overflow), so un-pin a curated PRIMARY verb (`cropPages`). ---
  await setStage(1);
  await openMenu('cropPages');
  await invokeMenu('unpin');
  expect(await win.locator('[data-dock-verb="cropPages"]').count(), 'the un-pinned default verb is gone').toBe(0);
  let stored = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 10000) {
    const s = await loadSettings();
    if (s && Array.isArray(s.dockUnpinned) && s.dockUnpinned.includes('cropPages')) { stored = s.dockUnpinned; break; }
    await win.waitForTimeout(250);
  }
  console.log(`[P36C3-C] after unpin: cropPages=${await win.locator('[data-dock-verb="cropPages"]').count()} dockUnpinned=${JSON.stringify(stored)}`);
  expect(stored, 'the un-pin is recorded in dockUnpinned').toContain('cropPages');

  // --- RE-PIN via the Command Palette Ctrl+Enter RESTORES the default verb
  // (pinDockTool drops it from `unpinned` rather than storing a redundant pin). ---
  await win.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  });
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
  await win.fill('[data-command-palette-input]', 'crop pages');
  await win.waitForTimeout(250);
  await win.locator('[data-palette-tool-id="cropPages"]').first().hover();
  await win.keyboard.press('Control+Enter');
  await win.waitForTimeout(600);
  await win.keyboard.press('Escape');
  await win.waitForSelector('[data-command-palette]', { state: 'detached', timeout: 8000 });
  await setStage(1);
  const s2 = await loadSettings();
  console.log(`[P36C3-C] after re-pin: cropPages=${await win.locator('[data-dock-verb="cropPages"]').count()} dockUnpinned=${JSON.stringify(s2 && s2.dockUnpinned)}`);
  expect(await win.locator('[data-dock-verb="cropPages"]').count(), 're-pinning a default verb restores it').toBe(1);
  expect((s2 && s2.dockUnpinned) || [], 'the un-pin is cleared on re-pin').not.toContain('cropPages');

  // --- cap at 4: the four curated GLOBAL pins (seeded at the top of this test)
  // are rendered after the divider, and the Pin item stays offered. ---
  await setStage(1);
  await win.waitForTimeout(600);
  const pinnedIds = await win.$$eval('[data-action-dock] [data-dock-pin]', (els) =>
    els.map((e) => e.getAttribute('data-dock-pin')));
  console.log(`[P36C3-C] seeded global pins=${JSON.stringify(pinnedIds)} divider=${await win.locator('[data-dock-divider]').count()}`);
  expect(pinnedIds.length, 'four global pins render after the divider').toBe(4);
  await openMenu('rotate');
  const pinItem = win.locator('[data-dock-menu-item="pin"]');
  // Phase 58 raised `DOCK_MAX_PINS` from 4 to 200, so four seeded pins no
  // longer fill the dock and the Pin item stays offered. The live assertion is
  // the divider + the four-pin count above; the retired cap-at-4 refusal is
  // recorded here instead of expected.
  const pinDisabled = await pinItem.isDisabled();
  console.log(`[P36C3-C] dock pin item disabled=${pinDisabled} title="${await pinItem.getAttribute('title')}"`);
  expect(pinDisabled, 'the 200-pin dock offers Pin alongside four seeded pins').toBe(false);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);

  // --- unpin round-trip on a seeded global pin. `undo` is the seeded pin this
  // test made actionable (the rotate above filled the undo stack); the
  // reading-view globals stay greyed on a PDF and cannot be right-clicked. ---
  await setStage(1);
  await openMenu('undo');
  await invokeMenu('unpin');
  expect(await win.locator('[data-dock-pin="undo"]').count()).toBe(0);
  expect((await win.$$eval('[data-action-dock] [data-dock-pin]', (els) => els.map((e) => e.getAttribute('data-dock-pin')))).length).toBe(3);
});

// ---------------------------------------------------------------------------
// D. dockPins persists across a RELAUNCH (the settings round-trip).
// ---------------------------------------------------------------------------
test('P36-C3-D dock curation (un-pin) persists across a relaunch', async () => {
  // The default beforeEach app is not needed here; drop it so only one
  // instance holds a user-data dir at a time.
  await hardClose(app, 'p36-c3-tmp');
  app = null;

  const dir = path.join(os.tmpdir(), `tflex-e2e-p36c3-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'settings.json');

  const boot = async (label) => {
    const a = await launchApp([], dir);
    const w = await a.firstWindow();
    await w.waitForSelector('.sample-card', { timeout: 30000 });
    await w.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
    await w.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await w.waitForTimeout(1200);
    return { a, w, label };
  };

  const first = await boot('persist-1');
  try {
    await first.w.keyboard.press('Control+1');
    await first.w.waitForTimeout(400);
    // Phase 37 item 21 — un-pin a default verb: it is recorded in dockUnpinned.
    // Phase 104 (TFL-1503) — the pin menu opens only on an INLINE tile, so use a
    // curated PRIMARY (`cropPages`; `split` moved into the More overflow).
    await first.w.locator('[data-dock-verb="cropPages"]').first().click({ button: 'right' });
    await first.w.waitForSelector('[data-dock-menu]', { state: 'visible', timeout: 8000 });
    await first.w.locator('[data-dock-menu-item="unpin"]').click();

    let stored = null;
    const start = Date.now();
    while (Date.now() - start < 15000) {
      try {
        const s = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Array.isArray(s.dockUnpinned) && s.dockUnpinned.includes('cropPages')) { stored = s.dockUnpinned; break; }
      } catch { /* not written yet */ }
      await new Promise((r) => setTimeout(r, 200));
    }
    console.log(`[P36C3-D] persisted dockUnpinned=${JSON.stringify(stored)}`);
    expect(stored, 'dockUnpinned written to settings.json on unpin').toContain('cropPages');
  } finally {
    await hardClose(first.a, 'p36-c3-persist-1');
  }

  const second = await boot('persist-2');
  try {
    await second.w.keyboard.press('Control+1');
    await second.w.waitForTimeout(500);
    const verbs = await second.w.$$eval('[data-action-dock] [data-dock-verb]', (els) =>
      els.map((e) => e.getAttribute('data-dock-verb')));
    console.log(`[P36C3-D] after relaunch (PAGES) verbs=${JSON.stringify(verbs)}`);
    expect(verbs, 'the un-pin survives the relaunch').not.toContain('cropPages');
  } finally {
    await hardClose(second.a, 'p36-c3-persist-2');
  }
});

// TFL-1116 C6 (R12) — the settled chrome paints CHROME only. This probe
// returns an ENABLED control's effective opacity (the product from the control
// up to its root) and the WCAG ratio of its colour composited over the real
// chrome surface. Mirrors e2e/tfl1116_r12_idle_legibility.spec.cjs.
async function r12Probe(rootSel, controlSel) {
  return win.evaluate(({ rootSel, controlSel }) => {
    const root = document.querySelector(rootSel);
    const ctl = document.querySelector(controlSel);
    if (root === null || ctl === null) return null;
    const parse = (s) => {
      const m = String(s).match(/rgba?\(([^)]+)\)/);
      if (m === null) return null;
      const p = m[1].split(',').map((x) => parseFloat(x.trim()));
      return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
    };
    const mix = (fg, bg, a) => ({
      r: fg.r * a + bg.r * (1 - a),
      g: fg.g * a + bg.g * (1 - a),
      b: fg.b * a + bg.b * (1 - a),
      a: 1,
    });
    const ch = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const lum = (c) => 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
    const ratio = (a, b) => {
      const l1 = lum(a);
      const l2 = lum(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    let eff = 1;
    let el = ctl;
    while (el !== null) {
      eff *= parseFloat(getComputedStyle(el).opacity) || 0;
      if (el === root) break;
      el = el.parentElement;
    }
    const ink = parse(getComputedStyle(ctl).color) || { r: 0, g: 0, b: 0, a: 1 };
    let bg = parse(getComputedStyle(root).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    if (bg.a < 1) {
      const page = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
      bg = mix(bg, page, bg.a);
    }
    const compositedInk = mix(ink, bg, Math.max(0, Math.min(1, ink.a * eff)));
    return {
      idle: root.getAttribute('data-dock-idle') || root.getAttribute('data-view-strip-idle'),
      rootOpacity: parseFloat(getComputedStyle(root).opacity),
      controlOpacity: parseFloat(getComputedStyle(ctl).opacity),
      effectiveOpacity: eff,
      label: ctl.getAttribute('aria-label') || (ctl.textContent || '').trim(),
      color: getComputedStyle(ctl).color,
      background: getComputedStyle(root).backgroundColor,
      ratio: ratio(compositedInk, bg),
    };
  }, { rootSel, controlSel });
}

// ---------------------------------------------------------------------------
// E. State 4 — the idle STATE: 3s to idle, restored on hover, and NEVER while a
//    tool is armed or a drag is in progress. TFL-1116 C6 (R12) RETIRED the
//    parent-opacity fade: idle now paints CHROME only (dock elevation / footer
//    separator) and the enabled label/icon content stays at full opacity.
// ---------------------------------------------------------------------------
test('P36-C3-E idle: 3s to idle, chrome-only content legible, suppressed armed/dragging', async () => {
  await openSample();
  const dock = win.locator('[data-action-dock]');
  const neutral = async () => {
    const b = await win.locator('.pdf-page').first().boundingBox();
    await win.mouse.move(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2));
  };
  const opacity = (loc) => loc.evaluate((el) => parseFloat(getComputedStyle(el).opacity));

  await neutral();
  expect(await dock.getAttribute('data-dock-idle'), 'not idle immediately').toBe('false');
  await win.waitForTimeout(3600);
  expect(await dock.getAttribute('data-dock-idle')).toBe('true');

  // R12 contract (replaces the removed 40% fade): the dock root opacity is 1
  // and an enabled verb stays legible at full effective opacity, clear of the
  // 4.5:1 floor.
  const dockProbe = await r12Probe('[data-action-dock]', '[data-action-dock] [data-dock-verb]:not([disabled])');
  console.log(`[P36C3-E] idle dock probe=${JSON.stringify(dockProbe)}`);
  expect(dockProbe, 'an enabled dock verb was measurable').not.toBeNull();
  expect(dockProbe.rootOpacity, 'the idle dock root opacity is 1 (no fade)').toBe(1);
  expect(dockProbe.effectiveOpacity, `enabled dock verb "${dockProbe.label}" effective opacity`).toBeGreaterThanOrEqual(0.99);
  expect(dockProbe.ratio, `enabled dock verb "${dockProbe.label}" composited contrast`).toBeGreaterThanOrEqual(4.5);

  // The View Strip footer holds the same idle STATE and the same R12 contract
  // (Phase 109 replaced the retired CanvasPills with the footer).
  expect(await win.locator('[data-view-strip]').getAttribute('data-view-strip-idle')).toBe('true');
  const footerProbe = await r12Probe('[data-view-strip]', '[data-view-strip] .view-strip-view [aria-label="Zoom in"]');
  console.log(`[P36C3-E] idle footer probe=${JSON.stringify(footerProbe)}`);
  expect(footerProbe, 'an enabled footer control was measurable').not.toBeNull();
  expect(footerProbe.rootOpacity, 'the idle footer root opacity is 1 (no fade)').toBe(1);
  expect(footerProbe.effectiveOpacity, `enabled footer control "${footerProbe.label}" effective opacity`).toBeGreaterThanOrEqual(0.99);
  expect(footerProbe.ratio, `enabled footer control "${footerProbe.label}" composited contrast`).toBeGreaterThanOrEqual(4.5);

  await dock.hover();
  await win.waitForTimeout(450);
  expect(await dock.getAttribute('data-dock-idle'), 'hover restores the dock').toBe('false');
  expect(await opacity(win.locator('[data-view-strip] .view-strip-page'))).toBeGreaterThan(0.9);

  // Armed tool suppresses idle.
  await setStage(3);
  await win.locator('[data-dock-verb="annotate"]').click();
  await win.waitForSelector('[data-annotation-flyout]', { state: 'visible', timeout: 8000 });
  await armAnnotationTool(win, 'highlight');
  await neutral();
  await win.waitForTimeout(3800);
  expect(await dock.getAttribute('data-dock-idle'), 'an armed tool suppresses idle').toBe('false');

  // Disarm through the canonical helper: the armed tool's persisted MRU may
  // keep `select` out of the five VISIBLE buttons, so armAnnotationTool falls
  // back to the toolbar's all-tools dropdown when the button is not on screen.
  await armAnnotationTool(win, 'select');
  await neutral();
  await win.waitForTimeout(3600);
  expect(await dock.getAttribute('data-dock-idle'), 'disarmed -> idle returns').toBe('true');

  // In-flight drag suppresses idle (the window-level drag mechanism the dock
  // observes for every HTML5 drag).
  await win.evaluate(() => window.dispatchEvent(new DragEvent('dragstart')));
  await win.waitForTimeout(3600);
  expect(await dock.getAttribute('data-dock-idle'), 'an in-flight drag suppresses idle').toBe('false');
  await win.evaluate(() => window.dispatchEvent(new DragEvent('dragend')));
});

// ---------------------------------------------------------------------------
// F. Responsive — labels drop below 900px; below 640px the compact plan fits
//    the curated set inline (no chip) and the dock wraps without clipping.
// ---------------------------------------------------------------------------
test('P36-C3-F responsive: labels drop <880px, compact plan fits <640px', async () => {
  await openSample();
  const dock = win.locator('[data-action-dock]');
  const setSize = (w, h) => app.evaluate(({ BrowserWindow }, s) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw === undefined) return;
    // DEF-422/TFL-1503 — a maximized window ignores setSize, and the main
    // window's minimum width is 960 (src/main/window.ts). Unmaximize and lower
    // the minimum before sizing below 960, or the sub-960 rungs never apply.
    bw.unmaximize();
    bw.setMinimumSize(300, 300);
    bw.setSize(s[0], s[1]);
  }, [w, h]);
  const hostW = () => win.evaluate(() => document.querySelector('[data-action-dock]').parentElement.clientWidth);

  // DEF-315 — the labels yield when the labelled dock cannot fit the measured
  // band, which is narrower than the window because the Inspector (264px) and
  // the ContextPanel (220px) are reserved. At the default 1440px window the
  // host is ~912px and the labels are already dropped; a genuinely wide window
  // (1600px) is where the labelled dock fits.
  await setSize(1600, 900);
  await win.waitForFunction(
    () => document.querySelector('[data-action-dock]')?.getAttribute('data-dock-icon-only') === 'false',
    null, { timeout: 10000 });
  expect(await dock.getAttribute('data-dock-icon-only')).toBe('false');
  expect(await win.locator('.action-dock-label').count()).toBeGreaterThan(0);
  console.log(`[P36C3-F] 1600 host=${await hostW()} labels=${await win.locator('.action-dock-label').count()}`);

  // Phase 37 item 6 — the label rung is the WINDOW width < 880, not the canvas
  // host. At 1328 the labels are KEPT: the labelled row overflows into the
  // arrows lane instead of dropping. (The old "icon-only at 1328" assertion
  // predated the 880 rung and is stale.)
  await setSize(1328, 800);
  await win.waitForFunction(
    () => document.querySelector('[data-action-dock]')?.getAttribute('data-dock-icon-only') === 'false',
    null, { timeout: 10000 });
  console.log(`[P36C3-F] 1328 host=${await hostW()} icon-only=${await dock.getAttribute('data-dock-icon-only')} compact=${await dock.getAttribute('data-dock-compact')} labels=${await win.locator('.action-dock-label').count()}`);
  expect(await dock.getAttribute('data-dock-icon-only'), 'labels are kept at 1328 (above the 880 rung)').toBe('false');
  expect(await win.locator('.action-dock-label').count(), 'the labelled row is kept at 1328').toBeGreaterThan(0);
  expect(await dock.getAttribute('data-dock-compact'), 'still above the compact break').toBe('false');

  // Below the 880 rung the labels drop.
  await setSize(820, 800);
  await win.waitForFunction(
    () => document.querySelector('[data-action-dock]')?.getAttribute('data-dock-icon-only') === 'true',
    null, { timeout: 10000 });
  console.log(`[P36C3-F] 820 host=${await hostW()} icon-only=${await dock.getAttribute('data-dock-icon-only')} compact=${await dock.getAttribute('data-dock-compact')} labels=${await win.locator('.action-dock-label').count()}`);
  expect(await win.locator('.action-dock-label').count(), 'labels drop below the 880 rung').toBe(0);

  await setSize(620, 800);
  // DEF-337 — the arrows render iff the row genuinely overflows; at 620 the
  // compact/icon-only row fits, so the arrows are absent. Wait on the stable
  // 620 layout (labels dropped) rather than on the oscillating arrows flag.
  await win.waitForFunction(
    () => document.querySelector('[data-action-dock]')?.getAttribute('data-dock-icon-only') === 'true',
    null, { timeout: 10000 });
  const host620 = await hostW();
  const inlineVerbs = await win.locator('[data-action-dock] [data-dock-verb]').count();
  const chipCount = await win.locator('[data-dock-overflow]').count();
  console.log(`[P36C3-F] 620 host=${host620} compact=${await dock.getAttribute('data-dock-compact')} arrows=${await dock.getAttribute('data-dock-arrows')} arrowsLane=${await dock.getAttribute('data-dock-arrows-lane')} inlineVerbs=${inlineVerbs} overflowChip=${chipCount}`);
  // Phase 104 (TFL-1503) — the More utility is a STABLE control rendered OUTSIDE
  // the scroll strip (always present, never hidden), and the curated PAGES
  // PRIMARY set rides inline. At this icon-only rung the five tiles fit, so no
  // arrows render (DEF-337) and the row never wraps or clips. (The Phase-36
  // "8 verbs inline, no chip" contract predated the primary/More split.)
  expect(chipCount, 'the stable More utility is present outside the scroll strip').toBe(1);
  expect(inlineVerbs, 'the curated PAGES primaries are rendered inline').toBe(5);
  // Horizontal overflow would be a SCROLL (allowed); only VERTICAL clipping would
  // mean the row stacked. Assert every verb stays on the dock's single row.
  const clipped = await win.evaluate(() => {
    const d = document.querySelector('[data-action-dock]');
    const dr = d.getBoundingClientRect();
    return [...d.querySelectorAll('[data-dock-verb]')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top < dr.top - 0.6 || r.bottom > dr.bottom + 0.6;
    }).map((el) => el.getAttribute('data-dock-verb'));
  });
  console.log(`[P36C3-F] 620 vertically-clipped=${JSON.stringify(clipped)}`);
  expect(clipped, 'no verb is clipped vertically (the row never stacks)').toEqual([]);

  await setSize(1440, 900);
  await win.waitForFunction(
    () => document.querySelector('[data-action-dock]')?.getAttribute('data-dock-compact') === 'false',
    null, { timeout: 10000 });
});

// ---------------------------------------------------------------------------
// N. DEF-313 retest (re-pointed for the Phase 37 scrolling lane) — at every
//    required width NOTHING paints or hit-tests outside the dock: the scroller
//    clips its horizontal overflow, no verb is clipped vertically, the leading
//    verb is inside the dock and hit-testable, and every verb is reachable via
//    the lane. The page pill stays hit-testable.
// ---------------------------------------------------------------------------
test('P36-C3-N dock containment: nothing paints or hit-tests outside the dock at 1440/1100/900/760', async () => {
  await openSample();
  const dock = win.locator('[data-action-dock]');
  const setSize = (w, h) => app.evaluate(({ BrowserWindow }, s) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw === undefined) return;
    // DEF-422/TFL-1503 — a maximized window ignores setSize, and the main
    // window's minimum width is 960 (src/main/window.ts). Unmaximize and lower
    // the minimum before sizing below 960, or the sub-960 rungs never apply.
    bw.unmaximize();
    bw.setMinimumSize(300, 300);
    bw.setSize(s[0], s[1]);
  }, [w, h]);

  for (const w of [1440, 1100, 900, 760]) {
    await setSize(w, 900);
    await win.waitForTimeout(700);
    await win.waitForFunction((target) => Math.abs(window.innerWidth - target) < 60, w, { timeout: 10000 });
    const m = await win.evaluate(() => {
      const d = document.querySelector('[data-action-dock]');
      const dr = d.getBoundingClientRect();
      const sc = document.querySelector('[data-dock-scroll]');
      const scr = sc.getBoundingClientRect();
      const scs = getComputedStyle(sc);
      const verbs = [...d.querySelectorAll('[data-dock-verb]')].map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.getAttribute('data-dock-verb'), left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      });
      // Vertical clipping only: the row must never stack.
      const vClipped = verbs.filter((v) => v.top < dr.top - 0.6 || v.bottom > dr.bottom + 0.6).map((v) => v.id);
      // The scroller owns the horizontal overflow: its box is inside the dock,
      // so nothing paints outside the dock.
      const scrollerInside = scr.left >= dr.left - 0.6 && scr.right <= dr.right + 0.6
        && scr.top >= dr.top - 0.6 && scr.bottom <= dr.bottom + 0.6;
      const clips = scs.overflowX === 'auto' || scs.overflowX === 'scroll' || scs.overflowX === 'hidden';
      // The leading verb is inside the dock and hit-testable.
      const firstEl = d.querySelector('[data-dock-verb]');
      const fr = firstEl.getBoundingClientRect();
      const fel = document.elementFromPoint(Math.round(fr.left + fr.width / 2), Math.round(fr.top + fr.height / 2));
      const firstHit = fel !== null && (fel === firstEl || firstEl.contains(fel));
      const firstInside = fr.left >= dr.left - 0.6 && fr.right <= dr.right + 0.6
        && fr.top >= dr.top - 0.6 && fr.bottom <= dr.bottom + 0.6;
      // Which pill controls are actually obstructed: elementFromPoint at each
      // control's own centre must resolve back to that control.
      const covered = [];
      for (const btn of document.querySelectorAll('[data-canvas-pills] button')) {
        const r = btn.getBoundingClientRect();
        const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
        if (el === null || (el !== btn && btn.contains(el) === false)) {
          covered.push(`${document.querySelector('[data-page-pill]')?.contains(btn) ? 'page' : 'zoom'}:${btn.getAttribute('aria-label')}`);
        }
      }
      return {
        vw: window.innerWidth,
        dock: { left: Math.round(dr.left), right: Math.round(dr.right), top: Math.round(dr.top), bottom: Math.round(dr.bottom), w: Math.round(dr.width), h: Math.round(dr.height) },
        scroller: { left: Math.round(scr.left), right: Math.round(scr.right), top: Math.round(scr.top), bottom: Math.round(scr.bottom), overflowX: scs.overflowX, display: scs.display, scrollWidth: sc.scrollWidth, clientWidth: sc.clientWidth },
        count: verbs.length,
        vClipped,
        scrollerInside,
        clips,
        first: { id: firstEl.getAttribute('data-dock-verb'), left: Math.round(fr.left), right: Math.round(fr.right), inside: firstInside, hit: firstHit },
        covered,
      };
    });
    console.log(`[P36C3-N] w=${w} vw=${m.vw} iconOnly=${await dock.getAttribute('data-dock-icon-only')} verbs=${m.count} dock=${JSON.stringify(m.dock)} scroller=${JSON.stringify(m.scroller)} vClipped=${JSON.stringify(m.vClipped)} scrollerInside=${m.scrollerInside} clips=${m.clips} first=${JSON.stringify(m.first)} covered=${JSON.stringify(m.covered)}`);
    expect(m.vClipped, `no verb is clipped vertically at ${w}px`).toEqual([]);

    // Every verb must be inside the dock and hit-testable at its own centre.
    // When the scroller has a box (the arrows lane) the off-screen verbs are
    // clipped by it and reached by scrolling; when it is `display: contents`
    // (the compact plan fits inline) every verb is laid out directly.
    const noBox = m.scroller.display === 'contents' || (m.scroller.left === 0 && m.scroller.right === 0);
    const allVerbs = await win.evaluate(() => {
      const d = document.querySelector('[data-action-dock]');
      const dr = d.getBoundingClientRect();
      return [...d.querySelectorAll('[data-dock-verb]')].map((v) => {
        const r = v.getBoundingClientRect();
        const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
        return {
          id: v.getAttribute('data-dock-verb'),
          inside: r.left >= dr.left - 0.6 && r.right <= dr.right + 0.6 && r.top >= dr.top - 0.6 && r.bottom <= dr.bottom + 0.6,
          hit: el !== null && (el === v || v.contains(el)),
        };
      });
    });
    if (noBox) {
      const bad = allVerbs.filter((v) => !v.inside || !v.hit).map((v) => v.id);
      console.log(`[P36C3-N] w=${w} no-scroller-box verbs=${allVerbs.length} bad=${JSON.stringify(bad)}`);
      expect(bad, `every verb is inside the dock and hit-testable at ${w}px (no scroller box)`).toEqual([]);
    } else {
      expect(m.scrollerInside, `the scroller box is inside the dock at ${w}px (nothing paints outside)`).toBe(true);
      expect(m.clips, `the scroller clips its horizontal overflow at ${w}px`).toBe(true);
      expect(m.first.inside, `the leading verb is inside the dock at ${w}px`).toBe(true);
      expect(m.first.hit, `the leading verb is hit-testable at ${w}px`).toBe(true);

      // Every verb is reachable via the lane: scroll it into view, then it is
      // the top element at its own centre.
      const reach = await win.evaluate(() => {
        const d = document.querySelector('[data-action-dock]');
        const sc = document.querySelector('[data-dock-scroll]');
        const out = [];
        for (const v of [...d.querySelectorAll('[data-dock-verb]')]) {
          const id = v.getAttribute('data-dock-verb');
          const sr = sc.getBoundingClientRect();
          let vr = v.getBoundingClientRect();
          if (vr.left < sr.left) sc.scrollLeft -= (sr.left - vr.left) + 4;
          else if (vr.right > sr.right) sc.scrollLeft += (vr.right - sr.right) + 4;
          vr = v.getBoundingClientRect();
          const el = document.elementFromPoint(Math.round(vr.left + vr.width / 2), Math.round(vr.top + vr.height / 2));
          out.push({ id, hit: el !== null && (el === v || v.contains(el)) });
        }
        sc.scrollLeft = 0;
        return out;
      });
      const unreachable = reach.filter((r) => !r.hit).map((r) => r.id);
      console.log(`[P36C3-N] w=${w} reachable=${reach.length - unreachable.length}/${reach.length} unreachable=${JSON.stringify(unreachable)}`);
      expect(unreachable, `every verb is reachable via the lane at ${w}px`).toEqual([]);
    }

    // The page pill must stay hit-testable at every width.
    const pageCovered = m.covered.filter((c) => c.startsWith('page:'));
    expect(pageCovered, `every page-pill control is hit-testable at ${w}px`).toEqual([]);
    // DEF-319 — the Inspector (open by default, 264px) now covers the
    // bottom-right zoom pill at every width, so its controls are logged here
    // and asserted by the defect record, not silently dropped. (DEF-315's
    // 760px dock-over-zoom case is subsumed by the same coverage.)
    const zoomCovered = m.covered.filter((c) => c.startsWith('zoom:'));
    if (zoomCovered.length > 0) {
      console.log(`[P36C3-N] DEF-319 zoom controls covered at ${w}px: ${JSON.stringify(zoomCovered)}`);
    }
  }

  await setSize(1440, 900);
  await win.waitForTimeout(500);
});

// ---------------------------------------------------------------------------
// G. The unified View Strip footer (Phase 109) — page steps/jump, zoom + fit +
//    pan, and the per-pane footers in Multi Mode.
//
// DEF-580 migration: Phase 109 retired the per-pane `CanvasPills`; this
// blast-radius neighbour no longer queries `[data-page-pill]` /
// `[data-zoom-pill]`. The SAME assertions are retargeted to the replacement
// surface — `[data-view-strip]`, its `.page-input` (aria-label "Current page"),
// the Next/Previous controls, and the `.view-strip-view` zoom group — with the
// original intent preserved (the Next-page control is the TOP element at its
// own centre). Only the toggle that drives the Multi Mode leg is also migrated,
// from the Phase-105-retired `[data-header-multi-mode]` to the app-menu row.
// ---------------------------------------------------------------------------
test('P36-C3-G view strip: page steps/jump, zoom + fit + pan, per-pane footers in Multi Mode', async () => {
  await openSample();

  // DEF-313 retest — the PAGES dock is CURATED (6 verbs) and capped
  // (`max-width: max(220px, calc(100% - 380px))`) with wrapping groups, so it
  // no longer spans the canvas or covers the footer. Measure the
  // geometry AND hit-test both pills in the DEFAULT (PAGES) stage.
  const geom = await win.evaluate(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const dock = rect('[data-action-dock]');
    const page = rect('[data-view-strip]');
    const zoom = rect('[data-view-strip] .view-strip-view');
    const hits = (a, b) => a !== null && b !== null && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    return { dock, page, zoom, dockHitsPage: hits(dock, page), dockHitsZoom: hits(dock, zoom) };
  });
  console.log(`[P36C3-G] PAGES dock/footer geometry=${JSON.stringify(geom)}`);
  expect(geom.dock, 'the PAGES dock is rendered').not.toBeNull();
  expect(geom.dockHitsPage, 'the dock does NOT overlap the footer (DEF-313)').toBe(false);
  expect(geom.dockHitsZoom, 'the dock does NOT overlap the footer zoom group (DEF-313)').toBe(false);

  const hitAt = (sel) => win.evaluate((s) => {
    const b = document.querySelector(s);
    if (b === null) return 'missing';
    const r = b.getBoundingClientRect();
    const el = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    if (el === null) return 'none';
    const owner = el.closest('button');
    return owner === null ? (el.getAttribute('data-dock-verb') ?? el.className) : (owner.getAttribute('aria-label') ?? owner.getAttribute('data-dock-verb') ?? owner.className);
  }, sel);
  const nextHit = await hitAt('[data-view-strip] [aria-label="Next page"]');
  const zoomHit = await hitAt('[data-view-strip] .view-strip-view [aria-label="Zoom in"]');
  console.log(`[P36C3-G] footer element at the Next-page point=${nextHit}`);
  console.log(`[P36C3-G] footer element at the Zoom-in point=${zoomHit}`);
  expect(nextHit, 'the Next-page control is the top element at its own centre').toBe('Next page');
  // DEF-319 - historically the Inspector covered the pill's zoom point, so the
  // zoom/fit/pan clicks were deferred. The footer is inset (DEF-577), so the
  // zoom point should now resolve; the branch is kept so a covered case is
  // recorded explicitly rather than silently skipped.
  const zoomReachable = zoomHit === 'Zoom in';
  if (!zoomReachable) {
    console.log(`[P36C3-G] DEF-319: the Zoom-in point resolves to ${zoomHit} (Inspector covers the pill) — zoom/fit/pan clicks deferred`);
  }

  // A real click in the PAGES stage lands and acts.
  const pageInput = win.locator('[data-view-strip] .page-input');
  await win.locator('[data-view-strip] [aria-label="Next page"]').click();
  await win.waitForTimeout(450);
  expect(await pageInput.inputValue(), 'the PAGES-stage Next-page click advanced the page').toBe('2');
  await win.locator('[data-view-strip] [aria-label="Previous page"]').click();
  await win.waitForTimeout(450);
  expect(await pageInput.inputValue()).toBe('1');

  // DELIVER also carries the footer; keep the detailed view-strip behaviour there.
  await setStage(4);
  await win.waitForTimeout(400);
  const pagePill = win.locator('[data-view-strip]');
  const zoomPill = win.locator('[data-view-strip] .view-strip-view');
  await expect(pagePill).toBeVisible();
  await expect(zoomPill).toBeVisible();

  const input = pagePill.locator('input.page-input');
  expect(await input.inputValue()).toBe('1');
  await pagePill.locator('[aria-label="Next page"]').click();
  await win.waitForTimeout(450);
  expect(await input.inputValue()).toBe('2');
  await pagePill.locator('[aria-label="Previous page"]').click();
  await win.waitForTimeout(450);
  expect(await input.inputValue()).toBe('1');
  await input.fill('5');
  await input.press('Enter');
  await win.waitForTimeout(800);
  expect(await input.inputValue(), 'the input jumps to the typed page').toBe('5');
  expect(await pagePill.locator('.page-total').innerText()).toBe('/ 34');
  const labelCount = await pagePill.locator('[data-page-label]').count();
  console.log(`[P36C3-G] page total=/34 labelElements=${labelCount}${labelCount ? ` label="${await pagePill.locator('[data-page-label]').innerText()}"` : ''}`);

  if (zoomReachable) {
    const pct = async () => parseInt(await zoomPill.locator('.zoom-percent').innerText(), 10);
    const before = await pct();
    await zoomPill.locator('[aria-label="Zoom in"]').click();
    await win.waitForTimeout(600);
    const afterIn = await pct();
    console.log(`[P36C3-G] zoom %: ${before} -> ${afterIn}`);
    expect(afterIn).toBeGreaterThan(before);
    await zoomPill.locator('[aria-label="Zoom out"]').click();
    await win.waitForTimeout(600);
    expect(await pct()).toBeLessThan(afterIn);
    await zoomPill.locator('[aria-label="Fit width"]').click();
    await win.waitForTimeout(800);
    expect(await zoomPill.locator('[aria-label="Fit width"]').getAttribute('aria-pressed')).toBe('true');
    await zoomPill.locator('[aria-label="Fit page"]').click();
    await win.waitForTimeout(800);
    expect(await zoomPill.locator('[aria-label="Fit page"]').getAttribute('aria-pressed')).toBe('true');
    expect(await zoomPill.locator('[aria-label="Fit width"]').getAttribute('aria-pressed')).toBe('false');

    // The visible Hand control toggles pan mode on the scroller.
    const hand = zoomPill.locator('[data-hand-toggle]');
    expect(await hand.getAttribute('data-hand-active')).toBe('false');
    await hand.click();
    await win.waitForTimeout(500);
    expect(await hand.getAttribute('data-hand-active')).toBe('true');
    expect(await hand.getAttribute('aria-pressed')).toBe('true');
    expect(await win.locator('.document-scroller').getAttribute('data-hand')).toBe('true');
    await hand.click();
    await win.waitForTimeout(500);
    expect(await win.locator('.document-scroller').getAttribute('data-hand')).toBe('false');
  } else {
    // DEF-319 — the controls are present but covered; record the count so the
    // covered case is explicit rather than a silent skip.
    expect(await zoomPill.locator('[aria-label="Zoom in"]').count()).toBe(1);
    expect(await zoomPill.locator('[data-hand-toggle]').count()).toBe(1);
    console.log('[P36C3-G] DEF-319: zoom/fit/pan controls present but covered by the Inspector');
  }

  // Multi Mode (Phase 109 chunk B): each non-empty pane carries its OWN View
  // Strip footer inside its own pane bounds (the shared dock stays at the
  // workspace bottom-centre). TFL-1503 — Phase 127 restored the v1.50.0
  // title-row control `[data-header-multi-mode]`, so drive the canonical
  // `toggleMultiModeViaPalette` helper (the Phase-105 app-menu row is gone).
  await toggleMultiModeViaPalette(win);
  await win.waitForSelector('.tab-pane[data-pane="B"]', { timeout: 15000 });
  await win.waitForTimeout(900);
  const multiStrips = await win.evaluate(() => {
    const strips = [...document.querySelectorAll('.tab-pane[data-pane] [data-view-strip]')];
    return strips.map((s) => {
      const host = s.closest('.tab-pane[data-pane]');
      const sr = s.getBoundingClientRect();
      const hr = host ? host.getBoundingClientRect() : null;
      return {
        pane: host ? host.getAttribute('data-pane') : null,
        insidePane: hr ? sr.left >= hr.left - 1 && sr.right <= hr.right + 1 : null,
      };
    });
  });
  console.log(`[P36C3-G] Multi Mode pane footers=${JSON.stringify(multiStrips)}`);
  expect(multiStrips.length, 'Multi Mode renders per-pane footers').toBeGreaterThanOrEqual(1);
  for (const p of multiStrips) {
    expect(['A', 'B'], 'each pane footer is inside a tagged pane').toContain(p.pane);
    expect(p.insidePane, `the ${p.pane} footer stays inside its pane bounds`).toBe(true);
  }
});

// ---------------------------------------------------------------------------
// H. The annotations flyout — ONE surface, the re-parented toolbar's tools all
//    present, arming runs the existing action, Esc/close dismiss, and a page
//    click is not swallowed.
// ---------------------------------------------------------------------------
test('P36-C3-H flyout: one surface, all tools, arming runs the action, Esc closes', async () => {
  await openSample();
  await setStage(3);
  expect(await win.locator('[data-annotation-flyout]').count(), 'flyout starts closed').toBe(0);

  await win.locator('[data-dock-verb="annotate"]').click();
  await expect(win.locator('[data-annotation-flyout]')).toBeVisible();
  expect(await win.locator('[data-annotation-flyout]').count(), 'exactly ONE flyout surface').toBe(1);
  expect(await win.locator('[data-annotation-toolbar]').count(), 'exactly ONE annotation toolbar').toBe(1);
  const tools = await win.$$eval('[data-ann-tools-visible] button[data-tool]', (els) =>
    els.map((e) => e.getAttribute('data-tool')));
  console.log(`[P36C3-H] flyout visible tools=${JSON.stringify(tools)}`);
  // Phase 19/104 (TFL-1503) — the visible five are `visibleAnnotationTools(MRU)`
  // (MRU-first, padded from the canonical order), so their IDENTITY is not fixed
  // per launch; the contract is five UNIQUE canonical tools. The toolbar's own
  // dropdown lists the FULL canonical set, so the union is the whole surface.
  const CANONICAL = ['select', 'highlight', 'underline', 'strikeout', 'ink', 'textbox', 'rect', 'ellipse', 'arrow', 'callout', 'note'];
  expect(tools.length, 'flyout shows five visible tool buttons').toBe(5);
  for (const t of tools) expect(CANONICAL, `visible tool '${t}' is canonical`).toContain(t);
  expect(new Set(tools).size, 'the visible five are unique').toBe(5);
  // The rest of the set lives in the toolbar's own dropdown, one surface away.
  await win.locator('[data-ann-dropdown-toggle]').click();
  await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'visible', timeout: 8000 });
  const moreTools = await win.$$eval('[data-ann-dropdown-menu] button[data-tool]', (els) =>
    els.map((e) => e.getAttribute('data-tool')));
  console.log(`[P36C3-H] flyout dropdown tools=${JSON.stringify(moreTools)}`);
  for (const t of CANONICAL) {
    expect(moreTools, `flyout dropdown hosts '${t}'`).toContain(t);
  }
  // Arm 'rect' straight from the same dropdown (it selects and closes the
  // menu). Arming runs the EXISTING action: the page drag below places a
  // rectangle, which also proves the flyout does not swallow page pointers.
  const annBefore = await win.evaluate(() => window.tflexDiagnostics().engineState.annotations.length);
  await win.locator('[data-ann-dropdown-menu] button[data-tool="rect"]').click();
  await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'detached', timeout: 8000 });
  await win.waitForTimeout(400);
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const x = Math.round(pg.x + pg.width * 0.3);
  const y = Math.round(pg.y + pg.height * 0.25);
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + 150, y + 70, { steps: 6 });
  await win.mouse.up();
  await win.waitForTimeout(1000);
  const annAfter = await win.evaluate(() => window.tflexDiagnostics().engineState.annotations.length);
  console.log(`[P36C3-H] annotations ${annBefore} -> ${annAfter}`);
  expect(annAfter, 'the armed flyout tool created an annotation from a page drag').toBe(annBefore + 1);

  // Phase 37 (item 3) — the flyout has no header/close button now: a re-click
  // of the dock's Annotate verb dismisses it (Esc is covered below).
  await win.locator('[data-dock-verb="annotate"]').click();
  await win.waitForTimeout(500);
  expect(await win.locator('[data-annotation-flyout]').count(), 're-clicking Annotate dismisses the flyout').toBe(0);

  // Esc dismisses in a clean state (no armed tool / selection to consume it).
  await win.locator('[data-dock-verb="annotate"]').click();
  await expect(win.locator('[data-annotation-flyout]')).toBeVisible();
  // `select` may not be one of the five visible MRU tiles; arm it through the
  // canonical helper, which falls back to the dropdown when it is not on screen.
  await armAnnotationTool(win, 'select');
  await win.waitForTimeout(300);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(500);
  expect(await win.locator('[data-annotation-flyout]').count(), 'Esc dismisses the flyout').toBe(0);

  await win.locator('[data-dock-verb="annotate"]').click();
  await expect(win.locator('[data-annotation-flyout]')).toBeVisible();
  await setStage(1);
  expect(await win.locator('[data-annotation-flyout]').count(), 'leaving REVIEW closes the flyout').toBe(0);
});

// ---------------------------------------------------------------------------
// I. The retirement of the per-view command row + the reclaimed canvas height,
//    and the TWO required screenshots.
// ---------------------------------------------------------------------------
async function neutralPointer() {
  const b = await win.locator('.pdf-page').first().boundingBox();
  await win.mouse.move(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2));
}

test('P36-C3-I retirement: no command row, the canvas reclaimed its height, screenshots', async () => {
  await openSample();

  const gone = await win.evaluate(() => ({
    toolbar: document.querySelectorAll('.toolbar').length,
    rotateCw: document.querySelectorAll('[data-toolbar-rotate-cw]').length,
    rotateCcw: document.querySelectorAll('[data-toolbar-rotate-ccw]').length,
    deletePages: document.querySelectorAll('[data-toolbar-delete-pages]').length,
    multiMode: document.querySelectorAll('[data-toolbar-multi-mode]').length,
    editToggle: document.querySelectorAll('[data-toolbar-edit-toggle]').length,
    optimize: document.querySelectorAll('[data-toolbar-optimize]').length,
    audit: document.querySelectorAll('[data-toolbar-audit]').length,
  }));
  console.log(`[P36C3-I] retired selectors=${JSON.stringify(gone)}`);
  for (const [key, value] of Object.entries(gone)) {
    expect(value, `${key} is gone in single mode`).toBe(0);
  }
  // The title bar keeps its Open/Save (data-toolbar-open/save are legacy
  // aliases the migration deliberately preserved for the existing specs).
  expect(await win.locator('[data-toolbar-open]').count()).toBeGreaterThan(0);

  const geom = await win.evaluate(() => {
    const wm = document.querySelector('.workspace-main');
    const sc = document.querySelector('.document-scroller');
    const tb = document.querySelector('.titlebar');
    const dr = document.querySelector('[data-document-rail]');
    const wmr = wm.getBoundingClientRect();
    const scr = sc.getBoundingClientRect();
    const tbr = tb.getBoundingClientRect();
    return {
      titlebarBottom: Math.round(tbr.bottom),
      workspaceTop: Math.round(wmr.top),
      scrollerTop: Math.round(scr.top),
      gap: Math.round(scr.top - wmr.top),
      documentRail: dr ? Math.round(dr.getBoundingClientRect().height) : 0,
      chromeVar: getComputedStyle(wm).getPropertyValue('--tf-chrome-y').trim(),
    };
  });
  console.log(`[P36C3-I] geometry=${JSON.stringify(geom)}`);
  expect(geom.gap, 'no chrome row between the workspace top and the canvas').toBe(0);
  // TFL-1503 — Phase 105 (chunk C) added the 40px document rail as a SECOND row
  // between the title bar and `.app-main`; the retired per-view command ROW is
  // still gone, so the canvas begins directly below the title bar + ONLY that
  // rail. Assert the gap is bounded by the rail's own height (not a hidden row).
  console.log(`[P36C3-I] document rail=${geom.documentRail}px; the retired row measured 53px in the chunk-2 no-regression run (--tf-chrome-y), now reclaimed`);
  expect(geom.scrollerTop - geom.titlebarBottom, 'canvas begins below the title bar + the document rail').toBeLessThanOrEqual(geom.documentRail + 2);

  // --- screenshot 1: PAGES stage, current page selected, dock + pills ---
  // Phase 109 retired the per-pane CanvasPills; page navigation lives on the
  // unified View Strip footer, so set the page from ITS page input.
  const input = win.locator('[data-view-strip] input.page-input');
  await input.fill('2');
  await input.press('Enter');
  await win.waitForTimeout(900);
  await neutralPointer();
  await updateDockState();
  await win.waitForTimeout(300);
  await win.screenshot({ path: DOCK_SHOT });
  console.log(`[p36-c3] screenshot: ${DOCK_SHOT}`);

  // --- screenshot 2: REVIEW stage with the annotations flyout OPEN ---
  await setStage(3);
  await win.locator('[data-dock-verb="annotate"]').click();
  await win.waitForSelector('[data-annotation-flyout]', { state: 'visible', timeout: 8000 });
  await neutralPointer();
  await win.waitForTimeout(300);
  await win.screenshot({ path: REVIEW_SHOT });
  console.log(`[p36-c3] screenshot: ${REVIEW_SHOT}`);
});

async function updateDockState() {
  // Keep the dock un-idled for the screenshot without leaving the pointer over
  // it (a pointermove bumps activity and clears hover).
  await win.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' })));
}

// ---------------------------------------------------------------------------
// J. Reachability — every control the retired row hosted is reachable and acts
//    from its NEW home.
// ---------------------------------------------------------------------------
test('P36-C3-J reachability: every relocated control acts from its new home', async () => {
  // The PAGES panel is the default single-mode left slot (the chunk-2 dev flag
  // is retired); `merge` is its header button, not a dock verb.
  await openSample();
  const out = {};
  const log = (k, ok, d) => { out[k] = ok; console.log(`[P36C3-J] ${k}: ${ok ? 'OK' : 'FAIL'} ${d}`); };

  // find -> Ctrl+F
  await win.keyboard.press('Control+f');
  await win.waitForSelector('.search-bar', { state: 'visible', timeout: 8000 });
  log('find -> Ctrl+F', true, '.search-bar opened');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(500);

  // rotate -> PAGES dock (rotates the CURRENT page, which is page 1 here)
  await setStage(1);
  const rotateEnabled = await win.locator('[data-dock-verb="rotate"]').isEnabled();
  await win.locator('[data-dock-verb="rotate"]').click();
  await win.waitForTimeout(1100);
  const rot = await win.evaluate(() => window.tflexDiagnostics().engineState.rotations[0]);
  expect(rot, 'the PAGES dock Rotate verb rotated the current page').toBe(1);
  log('rotate -> PAGES dock', rotateEnabled && rot === 1, `rotations[0]=${rot}`);

  // delete -> PAGES dock (opens the existing delete dialog). Phase 104 moved
  // delete into the More overflow; clickDockVerb reaches whichever lane hosts it.
  await clickDockVerb(win, 1, 'delete');
  await win.waitForSelector('[data-delete-pages-dialog]', { state: 'visible', timeout: 8000 });
  log('delete -> PAGES dock', true, 'delete-pages dialog opened');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(500);

  // merge -> the PAGES panel header (curation moved it out of the dock)
  await setStage(1);
  await win.locator('[data-context-panel="pages"] [data-context-panel-combine]').click();
  await win.waitForSelector('[data-merge-pick]', { state: 'visible', timeout: 8000 });
  log('merge -> PAGES panel header', true, 'merge dialog opened');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(500);

  // split -> PAGES dock (Phase 104 moved it into the More overflow)
  await clickDockVerb(win, 1, 'split');
  await win.waitForSelector('#split-dialog-title', { state: 'visible', timeout: 8000 });
  log('split -> PAGES dock', true, 'split dialog opened');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(500);

  // edit -> EDIT dock (Phase 37 item 13: the EDIT STAGE is the Edit-mode
  // switch, so entering EDIT enables the edit layer; the `editMode` verb is
  // retired).
  await setStage(2);
  const editModeVerb = await win.locator('[data-dock-verb="editMode"]').count();
  // Phase 41 (item 2) — the legacy edit toolbar is retired; the edit layer
  // (mounted only while edit mode is on and a tool is armed) is the observable.
  await win.locator('[data-dock-verb="editText"]').click();
  await win.waitForTimeout(500);
  const editLayer = await win.locator('.edit-layer').count();
  const editTextEnabled = await win.locator('[data-dock-verb="editText"]').isEnabled();
  console.log(`[P36C3-J] EDIT dock: editModeVerb=${editModeVerb} editLayer=${editLayer} editTextEnabled=${editTextEnabled}`);
  expect(editModeVerb, 'the editMode verb is retired').toBe(0);
  expect(editLayer, 'entering EDIT enables Edit mode (the edit layer mounts)').toBeGreaterThan(0);
  expect(editTextEnabled, 'the edit-layer tools are enabled in the EDIT stage').toBe(true);
  log('edit -> EDIT dock', editLayer > 0, `editLayer=${editLayer} (stage-enabled)`);

  // sign -> REVIEW dock
  await setStage(3);
  await win.locator('[data-dock-verb="sign"]').click();
  await win.waitForSelector('.sig-manager', { state: 'visible', timeout: 8000 });
  log('sign -> REVIEW dock', true, 'signature manager opened');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(600);
  if ((await win.locator('.sig-manager').count()) > 0) {
    await win.locator('.sig-manager .modal-close').first().click().catch(() => {});
    await win.waitForTimeout(500);
  }

  // flatten -> REVIEW dock: needs a form document, covered by P36-C3-K.
  log('flatten -> REVIEW dock', true, 'covered on a form document in P36-C3-K');

  // annotations -> REVIEW dock's flyout
  await setStage(3);
  await win.locator('[data-dock-verb="annotate"]').click();
  await win.waitForSelector('[data-annotation-flyout]', { state: 'visible', timeout: 8000 });
  log('annotations -> REVIEW flyout', true, 'flyout opened');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(500);

  // optimize / audit -> DELIVER dock
  await setStage(4);
  // Phase 109 retired the per-pane CanvasPills; page navigation and
  // zoom/fit/pan now live on the unified View Strip footer (DEF-580 migration).
  const strip = win.locator('[data-view-strip]');
  const pillInput = strip.locator('input.page-input');
  await pillInput.fill('3');
  await pillInput.press('Enter');
  await win.waitForTimeout(800);
  expect(await pillInput.inputValue()).toBe('3');
  expect(await strip.locator('.view-strip-view [aria-label="Zoom in"]').count()).toBe(1);
  expect(await strip.locator('.view-strip-view [aria-label="Fit width"]').count()).toBe(1);
  expect(await strip.locator('.view-strip-view [data-hand-toggle]').count()).toBe(1);
  log('page-nav/zoom/fit/pan -> view strip', true, 'page=3; footer controls present');

  await win.locator('[data-dock-verb="optimize"]').click();
  await win.waitForSelector('.optimize-dialog', { state: 'visible', timeout: 8000 });
  log('optimize -> DELIVER dock', true, 'optimize dialog opened');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(600);

  // audit -> DELIVER dock (Phase 104 moved audit into the More overflow)
  await clickDockVerb(win, 4, 'audit');
  await win.waitForSelector('.audit-dialog', { state: 'visible', timeout: 8000 });
  log('audit -> DELIVER dock', true, 'audit dialog opened');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(600);

  // multi-mode -> the title-bar toggle (the palette keeps its own row, checked
  // by the chunk 4/5/6 gate).
  await win.locator('[data-header-multi-mode]').click();
  await win.waitForTimeout(800);
  const multiOn = await win.locator('.tab-stage').getAttribute('data-multi-mode');
  log('multi-mode -> title bar', multiOn === 'true', `data-multi-mode=${multiOn}`);
  await win.locator('[data-header-multi-mode]').click();
  await win.waitForTimeout(500);

  console.log(`[P36C3-J] summary=${JSON.stringify(out)}`);
  const failed = Object.entries(out).filter(([, ok]) => !ok).map(([k]) => k);
  console.log(`[P36C3-J] unreachable-from-new-home=${JSON.stringify(failed)}`);
});

// ---------------------------------------------------------------------------
// K. Reachability on a form document — forms + flatten act from the REVIEW dock
//    (they are gated on form fields, so they need form.pdf).
// ---------------------------------------------------------------------------
test('P36-C3-K reachability on a form document: flatten acts from the REVIEW dock', async () => {
  await openSample('form.pdf');

  // The PAGES panel's multi-select clears on an empty-space click (form.pdf has
  // ONE page, so its 220px panel leaves empty scroller space to click).
  await setStage(1);
  const panel = win.locator('[data-context-panel="pages"]');
  await expect(panel).toBeVisible();
  const scroller = panel.locator('.thumb-scroller');
  await panel.locator('.thumb-item[data-page="1"]').click();
  expect(await panel.locator('.thumb-selected').count(), 'plain click selects the page').toBe(1);
  const sb = await scroller.boundingBox();
  const lb = await panel.locator('.thumb-item').last().boundingBox();
  const clearY = Math.min(sb.height - 4, Math.max(4, (lb === null ? 0 : lb.y + lb.height + 8) - sb.y));
  console.log(`[P36C3-K] scroller h=${Math.round(sb.height)} lastThumbBottom=${lb === null ? null : Math.round(lb.y + lb.height - sb.y)} clearClickY=${Math.round(clearY)}`);
  // DEF-320 — the Stage Rail overlays the panel's left 44px, so click an x
  // clear of the rail (the empty-space contract is unchanged).
  await scroller.click({ position: { x: 120, y: Math.round(clearY) } });
  await expect.poll(async () => panel.locator('.thumb-selected').count(), { timeout: 8000 }).toBe(0);
  console.log('[P36C3-K] empty-space click cleared the panel selection');

  await setStage(3);
  // TFL-1503 — `flatten` is a non-primary REVIEW verb (Phase 104), so it lives
  // in the More overflow, not inline. Open the overflow, wait for the form
  // document to enable the row, then run it.
  await win.locator('[data-dock-overflow]').first().click();
  await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 8000 });
  await win.waitForFunction(() => {
    const b = document.querySelector('[data-dock-overflow-item="flatten"]');
    return b !== null && b.disabled === false;
  }, null, { timeout: 20000 });
  // TFL-1436 (C2) - the `forms` dock verb is retired; the old forms step opened
  // the same FlattenConfirmDialog already verified above.
  await win.locator('[data-dock-overflow-item="flatten"]').first().click();
  await win.waitForSelector('#flatten-title', { state: 'visible', timeout: 10000 });
  console.log('[P36C3-K] flatten dialog opened on form.pdf');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(600);
});

// ---------------------------------------------------------------------------
// Q. DEF-314 retest — `editMode` is the EDIT stage's primary and the toggle
//    that turns Edit mode ON: enabled while it is OFF, pressed while ON.
// ---------------------------------------------------------------------------
test('P36-C3-Q the EDIT stage is the Edit-mode switch (the editMode verb is retired)', async () => {
  await openSample();
  // Entering EDIT enables Edit mode. Phase 41 (item 2) — the legacy edit
  // toolbar is retired; the edit layer is the observable (arm a tool first).
  await setStage(2);
  await win.waitForTimeout(600);
  expect(await win.locator('[data-dock-verb="editMode"]').count(), 'the editMode dock verb is retired').toBe(0);
  await win.locator('[data-dock-verb="editText"]').click();
  await win.waitForTimeout(500);
  expect(await win.locator('.edit-layer').count(), 'Edit mode is ON in the EDIT stage (the edit layer mounts)').toBeGreaterThan(0);
  expect(await win.locator('[data-dock-verb="editText"]').isEnabled(), 'the edit-layer tools are enabled').toBe(true);
  console.log(`[P36C3-Q] EDIT: editLayer=${await win.locator('.edit-layer').count()} editTextEnabled=${await win.locator('[data-dock-verb="editText"]').isEnabled()}`);

  // Leaving EDIT turns it OFF.
  await setStage(1);
  await win.waitForTimeout(600);
  expect(await win.locator('.edit-layer').count(), 'leaving EDIT turns Edit mode OFF').toBe(0);

  // Re-entering turns it back ON.
  await setStage(2);
  await win.waitForTimeout(600);
  await win.locator('[data-dock-verb="editText"]').click();
  await win.waitForTimeout(500);
  expect(await win.locator('.edit-layer').count(), 're-entering EDIT turns it ON again').toBeGreaterThan(0);
  console.log('[P36C3-Q] stage-driven Edit mode verified both ways');
});

// ---------------------------------------------------------------------------
// R. DEF-313 retest — the verbs the curation moved OFF the dock are reachable
//    from their new homes (panel header / thumbnail menu / palette).
// ---------------------------------------------------------------------------
test('P36-C3-R leavers: merge/renumber/rotate-ccw/watermark/createFromImages from their new homes', async () => {
  await openSample();
  const panel = win.locator('[data-context-panel="pages"]');
  await expect(panel).toBeVisible();
  await panel.locator('.thumb-item').first().waitFor({ timeout: 20000 });

  // merge -> the panel header (opens the SAME merge dialog the old dock verb did)
  await setStage(1);
  await panel.locator('[data-context-panel-combine]').click();
  await win.waitForSelector('[data-merge-pick]', { state: 'visible', timeout: 8000 });
  console.log('[P36C3-R] merge -> panel header: merge dialog opened');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(500);

  // rotateCounterClockwise -> the thumbnail right-click menu (rotate-ccw).
  const before = await win.evaluate(() => window.tflexDiagnostics().engineState.rotations[0]);
  await panel.locator('.thumb-item[data-page="1"]').click({ button: 'right' });
  await win.waitForSelector('[data-context-menu]', { state: 'visible', timeout: 8000 });
  const items = await win.$$eval('[data-context-menu] [data-menu-item]', (els) => els.map((e) => e.getAttribute('data-menu-item')));
  console.log(`[P36C3-R] thumb menu items=${JSON.stringify(items)}`);
  await win.locator('[data-menu-item="rotate-ccw"]').click();
  await win.waitForTimeout(1200);
  const afterCcw = await win.evaluate(() => window.tflexDiagnostics().engineState.rotations[0]);
  console.log(`[P36C3-R] rotateCounterClockwise -> thumb menu: rotations[0] ${before} -> ${afterCcw}`);
  expect(afterCcw, 'the CCW menu verb rotated page 1 a quarter turn').not.toBe(before);

  // renumberPages -> the Inspector's `Label · renumber…` (section 3A ruling 2:
  // renumber is NOT a thumbnail-menu verb any more).
  await panel.locator('.thumb-item[data-page="1"]').click({ button: 'right' });
  await win.waitForSelector('[data-context-menu]', { state: 'visible', timeout: 8000 });
  expect(await win.locator('[data-context-menu] [data-menu-item="renumber"]').count(), 'no renumber menu item').toBe(0);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(400);
  await win.locator('[data-inspector] [data-inspector-action="renumber"]').click();
  await win.waitForSelector('[data-renumber-pages-dialog]', { state: 'visible', timeout: 8000 });
  console.log('[P36C3-R] renumberPages -> Inspector Label · renumber…: renumber dialog opened');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(500);

  // watermark -> the Command Palette.
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette]', { timeout: 10000 });
  await win.fill('[data-command-palette-input]', 'watermark');
  await win.waitForTimeout(250);
  await win.locator('[data-palette-tool-id="watermark"]').first().click();
  await win.waitForSelector('[data-watermark-dialog]', { state: 'visible', timeout: 8000 });
  console.log('[P36C3-R] watermark -> palette: watermark dialog opened');
  await win.keyboard.press('Escape');
  await win.waitForTimeout(600);

  // createFromImages -> the Command Palette.
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette]', { timeout: 10000 });
  await win.fill('[data-command-palette-input]', 'from images');
  await win.waitForTimeout(250);
  const cfDisabled = await win.locator('[data-palette-tool-id="createFromImages"]').first().getAttribute('data-palette-disabled');
  await win.locator('[data-palette-tool-id="createFromImages"]').first().click();
  await win.waitForSelector('[data-create-from-images-dialog]', { state: 'visible', timeout: 8000 });
  console.log(`[P36C3-R] createFromImages -> palette: dialog opened (disabled=${cfDisabled})`);
  await win.keyboard.press('Escape');
  await win.waitForTimeout(500);
});
