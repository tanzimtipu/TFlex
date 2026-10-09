// Shared driving helpers for the v1.7.11 deep sweep. Canonical under e2e/lib.
// Only qa writes here. launchDev() (dev build) is the DEFAULT for every
// standard/regression/sweep spec; launchInstalled() is ONLY for specs under
// e2e/installed/, when the orchestrator explicitly asks for installed-app
// runs. launchInstalled() auto-dismisses the OTA update prompt (DEF-172) via
// dismissUpdatePrompt(); installed-app specs that launch through launchApp()
// directly must call dismissUpdatePrompt(window) themselves.

const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');
const { launchApp, getSamplePath } = require('./launch.cjs');

const INSTALLED = process.env.TFLEX_PACKAGED_EXE || 'C:\\Program Files\\Jovrel\\Jovrel.exe';
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

// Bound window so `shot(name)` works without threading `win` through every call.
let currentWin = null;

// DEV build launch - the standard for the whole e2e suite. Never pass an
// executablePath from a spec; the installed app is launched only from
// e2e/installed/* specs via launchInstalled().
async function launchDev(extraArgs = []) {
  const electronApp = await launchApp(extraArgs, null, null);
  const window = await electronApp.firstWindow();
  await window.waitForSelector('.sample-card', { timeout: 30000 });
  currentWin = window;
  return { electronApp, window };
}

// INSTALLED-app launch. e2e/installed/* ONLY - never from a standard spec.
async function launchInstalled(extraArgs = []) {
  const electronApp = await launchApp(extraArgs, null, INSTALLED);
  const window = await electronApp.firstWindow();
  // R09: a PACKAGED production Home renders no `.sample-card`; `.welcome` is the
  // production-safe Home-ready signal (the installed path never shows samples).
  await window.waitForSelector('.welcome', { timeout: 30000 });
  // DEF-172: when a release newer than the installed build is published, the
  // startup autoUpdater check pops the modal UpdatePromptDialog within ~3s of
  // launch and its full-screen .sheet-backdrop intercepts every pointer
  // event. Dismiss it here so every installed-app launch is sweep-safe.
  await dismissUpdatePrompt(window);
  currentWin = window;
  return { electronApp, window };
}

// ---------------------------------------------------------------------------
// DEF-172 - dismiss the OTA update prompt on the INSTALLED app.
//
// When the installed build is older than the latest published release,
// electron-updater's startup check makes the renderer open the modal
// UpdatePromptDialog within ~3s of launch. Its full-screen .sheet-backdrop
// (aria-modal, position:fixed inset:0) intercepts every pointer event, so the
// first click of a sweep retry-loops for 30s and the spec dies.
//
// dismissUpdatePrompt polls for the prompt and dismisses it before the spec
// touches anything: click the dialog's Cancel/Later/OK button first (a real
// click, present for every prompt kind), then Escape, then the sheet's X
// button. It fails loud if the prompt is seen but survives all three. No
// prompt within the timeout window (installed build up to date / offline /
// unsupported) is the normal path - it returns false without throwing. Once
// closed, the host's prompt machine (updatePromptMachine.ts dismissedKey)
// never re-opens the same prompt, so one dismissal per launch is enough.
// ---------------------------------------------------------------------------
const UPDATE_PROMPT_SELECTOR = '[data-update-prompt], .sheet-update-prompt';

function updatePromptIsOpen(window) {
  return window.evaluate(() => {
    if (document.querySelector('[data-update-prompt], .sheet-update-prompt')) return true;
    // Fallback for builds that predate the data attribute: a sheet-backdrop
    // hosting the prompt's exact title strings. Matching .sheet-title by
    // equality keeps AboutDialog's "Update available: vX" line from matching.
    const bd = document.querySelector('.sheet-backdrop');
    const title = bd ? bd.querySelector('.sheet-title') : null;
    const t = title ? title.textContent.trim() : '';
    return t === 'Update available' || t === 'Restart to update';
  }).catch(() => false);
}

async function dismissUpdatePrompt(window, timeoutMs = 20000) {
  const t0 = Date.now();
  let detected = false;
  while (Date.now() - t0 < timeoutMs) {
    if (await updatePromptIsOpen(window)) {
      detected = true;
      break;
    }
    // Fast exit: once the update API settles on a state that never opens a
    // prompt (up to date / error / unsupported), stop polling - the common
    // up-to-date case then costs one getStatus round trip, not the full
    // window. Missing API (very old build) just keeps polling the DOM.
    const st = await window.evaluate(async () => {
      try {
        const api = window.tflex && window.tflex.update;
        if (!api || typeof api.getStatus !== 'function') return null;
        return await api.getStatus();
      } catch (_) {
        return null;
      }
    }).catch(() => null);
    if (st && (st.kind === 'up-to-date' || st.kind === 'error' || st.kind === 'unsupported')) {
      return false;
    }
    await window.waitForTimeout(500);
  }
  if (!detected) return false;

  console.log(`[dismissUpdatePrompt] update prompt detected after ${Date.now() - t0}ms - dismissing`);
  const prompt = window.locator(UPDATE_PROMPT_SELECTOR).first();
  // 1. Cancel / Later / OK - the dialog's own dismiss button.
  await window
    .locator('[data-update-prompt-cancel], [data-update-prompt-later], [data-update-prompt-close]')
    .first()
    .click({ timeout: 3000 })
    .catch(() => {});
  await prompt.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  // 2. Escape (UpdatePromptDialog closes on Escape).
  if (await prompt.isVisible().catch(() => false)) {
    await window.keyboard.press('Escape');
    await prompt.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  }
  // 3. The sheet's X close button.
  if (await prompt.isVisible().catch(() => false)) {
    await window.locator('.sheet-update-prompt .sheet-close').first().click({ timeout: 3000 }).catch(() => {});
    await prompt.waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  }
  if (await prompt.isVisible().catch(() => false)) {
    throw new Error('dismissUpdatePrompt: update prompt still open after Cancel click, Escape and the sheet close button');
  }
  console.log(`[dismissUpdatePrompt] update prompt dismissed in ${Date.now() - t0}ms`);
  return true;
}

async function openSample(window, name = 'report.pdf') {
  const samplePath = getSamplePath(name);
  await window.locator('.sample-card').filter({ hasText: name }).first().click();
  await window.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await window.waitForTimeout(1200);
}

// Native Electron dialogs do not emit Playwright's browser filechooser event.
// Phase 118 stages picked files in Intake; its explicit Open finishes the flow.
// Native Electron dialogs do not emit Playwright's browser filechooser event.
// Phase 118 stages picked files in Intake; its explicit Open finishes the flow.
async function openSamplePath(window, electronApp, absolutePath) {
  const { expect } = require('@playwright/test');
  if (!path.isAbsolute(absolutePath) || !fs.existsSync(absolutePath)) {
    throw new Error(`openSamplePath: fixture must exist at an absolute path: ${absolutePath}`);
  }
  const basename = path.basename(absolutePath);
  const beforeTab = await window.evaluate(() => window.tflexDiagnostics?.().activeTabId ?? null);
  await electronApp.evaluate(({ dialog }, p) => {
    const key = Symbol.for('tflex.e2e.openDialog');
    if (globalThis[key]) throw new Error('openSamplePath: another native picker stub is active');
    globalThis[key] = { original: dialog.showOpenDialog, calls: 0 };
    dialog.showOpenDialog = async () => {
      globalThis[key].calls += 1;
      return { canceled: false, filePaths: [p] };
    };
  }, absolutePath);
  try {
    // Use the real generic Open handler in Home or in an existing workspace.
    const homeOpen = window.locator('[data-home-tool="open"]:visible');
    const open = await homeOpen.count() ? homeOpen.first() : window.locator('[data-toolbar-open]:visible').first();
    await open.click();
    await expect.poll(() => electronApp.evaluate(() =>
      globalThis[Symbol.for('tflex.e2e.openDialog')]?.calls || 0
    ), { timeout: 10000, message: 'Generic Open must invoke the native picker' }).toBeGreaterThan(0);
    const row = window.locator('[data-intake-row]').filter({ has: window.locator('.intake-name', { hasText: basename }) }).last();
    await expect.poll(async () => {
      if (await row.count()) return true;
      return window.evaluate((old) => {
        const id = window.tflexDiagnostics?.().activeTabId;
        return id != null && id !== old;
      }, beforeTab);
    }, { timeout: 30000, message: 'Picker result must reach Intake or open a new document' }).toBe(true);
    if (await row.count()) {
      await expect(row).toBeVisible({ timeout: 10000 });
      await expect(row.locator('[data-intake-state]')).toHaveAttribute('data-intake-state', 'ready', { timeout: 30000 });
      const finishOpen = window.locator('[data-intake-open]:visible').first();
      await expect(finishOpen).toBeEnabled();
      await finishOpen.click();
      // Home Intake unmounts after dispatch; document rendering proves completion.
    }
    // Multi-tab documents keep one `.workspace` per tab (inactive ones hidden),
    // so target the VISIBLE workspace rather than tripping strict-mode.
    await expect(window.locator('.workspace:visible').first()).toBeVisible({ timeout: 30000 });
    await expect(window.locator('.pdf-page canvas:visible').first()).toBeVisible({ timeout: 30000 });
  } finally {
    await electronApp.evaluate(({ dialog }) => {
      const key = Symbol.for('tflex.e2e.openDialog');
      if (globalThis[key]) { dialog.showOpenDialog = globalThis[key].original; delete globalThis[key]; }
    });
  }
}

async function diag(window) {
  return window.evaluate(() => window.tflexDiagnostics());
}

// Phase 19 / DEF-226 (ADV-045) — arm an annotation tool through the CURRENT
// structure. The visible five live in [data-ann-tools-visible]; every other
// tool lives in the portaled [data-ann-dropdown-menu], which is OUTSIDE
// `.ann-toolbar`. The retired `.ann-toolbar button[data-tool=...]` address
// therefore only resolves the visible five. Prefer the visible button so a
// spec's original per-tool intent is preserved; otherwise open the menu and
// click the row. Waits for the menu to detach so the caller's next page
// gesture is swallowed by the dismiss guard (DEF-227).
async function armAnnotationTool(window, kind) {
  // Phase 36 (chunk 3) — in SINGLE mode the command row is retired and the
  // annotation toolbar lives inside the REVIEW dock's Annotate flyout. Multi
  // Mode keeps it inline in the shared toolbar, so only open the flyout when
  // the toolbar is not already on screen.
  if ((await window.locator('[data-ann-tools-visible]').count()) === 0
    && (await window.locator('[data-ann-dropdown-toggle]').count()) === 0
    && (await window.locator('[data-annotation-flyout]').count()) === 0) {
    await window.keyboard.press('Control+3');
    await window.waitForTimeout(300);
    const annotate = window.locator('[data-dock-verb="annotate"]');
    if ((await annotate.count()) > 0) {
      await annotate.first().click();
      await window.waitForSelector('[data-annotation-flyout]', { state: 'visible', timeout: 8000 });
    }
  }
  const visible = window.locator(`[data-ann-tools-visible] button[data-tool="${kind}"]`);
  if ((await visible.count()) > 0) {
    await visible.first().click();
  } else {
    await window.click('[data-ann-dropdown-toggle]');
    await window.waitForSelector('[data-ann-dropdown-menu]', { state: 'visible', timeout: 8000 });
    await window.click(`[data-ann-dropdown-menu] button[data-tool="${kind}"]`);
    await window.waitForSelector('[data-ann-dropdown-menu]', { state: 'detached', timeout: 8000 });
  }
  await window.waitForTimeout(300);
}

// Phase 36 (chunk 6) — the Multi Mode toggle. Phase 105 relocated it into the
// retired application menu; Phase 127 restored the v1.50.0 title-row control
// `[data-header-multi-mode]`, the single button that switches the mode in BOTH
// directions. The name is kept so the many call sites stay unchanged; the
// behaviour is the original "toggle Multi Mode through its real control, then
// let the panes settle". Call sites toggle repeatedly (ON then OFF), so wait
// for the button's own `data-multi-mode-active` state to flip rather than for a
// fixed direction.
async function toggleMultiModeViaPalette(window) {
  const multi = window.locator('[data-header-multi-mode]').first();
  await multi.waitFor({ state: 'visible', timeout: 8000 });
  const before = await multi.getAttribute('data-multi-mode-active');
  await multi.click();
  await window
    .waitForFunction(
      (prev) => {
        const el = document.querySelector('[data-header-multi-mode]');
        return el !== null && el.getAttribute('data-multi-mode-active') !== prev;
      },
      before,
      { timeout: 8000 },
    )
    .catch(() => {});
  await window.waitForTimeout(700);
}

// ---------------------------------------------------------------------------
// Phase 36 (chunk 3) — the per-view command ROW is retired in SINGLE mode and
// its controls were re-homed. These helpers reach a control's NEW home through
// the real UI (Stage Rail -> Action Dock / REVIEW flyout) so the legacy specs
// keep asserting the SAME behaviour against the new surface. They are the
// single source of the stage-switch choreography, so a later chunk that moves
// a control again only has to change these.
// ---------------------------------------------------------------------------

// Switch stages via the documented Ctrl+1..4 shortcuts (Stage Rail binding).
// The rail deliberately ignores the chord while a text-entry control has focus
// (StageRail.isStageRailEditableTarget), so blur the focused element first.
async function gotoStage(window, stage) {
  await window.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  });
  await window.keyboard.press(`Control+${stage}`);
  await window.waitForTimeout(350);
}

// Click a stage's Action Dock verb, switching to that stage first.
async function openDockVerb(window, stage, id) {
  await gotoStage(window, stage);
  const verb = window.locator(`[data-dock-verb="${id}"]`).first();
  await verb.waitFor({ state: 'visible', timeout: 10000 });
  await verb.click();
  await window.waitForTimeout(400);
}

// Phase 37 (item 13) — the stage IS the Edit-mode switch: entering the EDIT
// stage turns edit mode on and every other stage turns it off; the `editMode`
// dock verb is retired. The helper name is kept for its many call sites.
async function toggleEditMode(window) {
  await gotoStage(window, 2);
}

// The Sign control is a REVIEW dock verb now (its legacy aria-label is gone).
async function armSignTool(window) {
  await openDockVerb(window, 3, 'sign');
}

// Open the REVIEW dock's Annotate flyout, which re-parents the EXISTING
// AnnotationToolbar (its `data-ann-*` selectors are preserved inside it).
async function openAnnotationFlyout(window) {
  await gotoStage(window, 3);
  if ((await window.locator('[data-annotation-flyout]').count()) === 0) {
    await openDockVerb(window, 3, 'annotate');
    await window.waitForSelector('[data-annotation-flyout]', { state: 'visible', timeout: 10000 });
  }
  await window.waitForTimeout(250);
}

// Phase 36 (chunk 9 migration) — click a stage's Action Dock verb whichever
// lane currently hosts it: the inline group (`[data-dock-verb]`) or the
// "More" overflow menu (`[data-dock-overflow-item]`). The dock spills
// lower-priority verbs into overflow as the window narrows, so a migrated spec
// must not assume either lane. Same behaviour either way; returns the lane used
// for the spec's log.
async function clickDockVerb(window, stage, id) {
  await gotoStage(window, stage);
  const inline = window.locator(`[data-dock-verb="${id}"]`);
  if ((await inline.count()) > 0) {
    const vis = await inline.first().isVisible().catch(() => false);
    await inline.first().click(vis ? {} : { force: true });
    await window.waitForTimeout(400);
    return 'inline';
  }
  const overflow = window.locator('[data-dock-overflow]');
  if ((await overflow.count()) > 0 && (await overflow.first().isVisible().catch(() => false))) {
    await overflow.first().click();
    await window.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 5000 }).catch(() => {});
    const item = window.locator(`[data-dock-overflow-item="${id}"]`);
    if ((await item.count()) > 0) {
      await item.first().click();
      await window.waitForTimeout(400);
      return 'overflow';
    }
    await window.keyboard.press('Escape');
  }
  return false;
}

// Phase 36 (chunk 9 migration, batch 3) — resolve a tool to its CORRECT current
// home and run it. The dock does not host every tool (the PAGES dock renders
// only six inline verbs with no overflow), so a spec should not assume a lane:
// `runTool(window, id)` tries, in order —
//   1. the ContextPanel header's Combine control (id 'merge'),
//   2. the Action Dock verb on its registry stage, then every other stage
//      (inline lane first, then the "More" overflow lane),
//   3. the Command Palette fallback (Ctrl+K -> input -> registry label -> row/Enter).
// The label/stage maps mirror src/renderer/state/toolsRegistry.ts. The SAME
// behaviour/dialog follows whichever home wins; the return value names it.
const TOOL_STAGE_NUM = {
  merge: 1, split: 1, extract: 1, rotate: 1, delete: 1, insertPages: 1,
  replacePages: 1, renumberPages: 1, cropPages: 1, rotateCounterClockwise: 1,
  recognizeText: 2, annotate: 3, sign: 3, flatten: 3, stamp: 3, watermark: 3,
  optimize: 4, audit: 4, createFromImages: 4, exportPages: 4, exportText: 4, exportDocx: 4,
  undo: 1, redo: 1,
};
const TOOL_LABEL = {
  merge: 'Merge PDFs', split: 'Split pages', extract: 'Extract pages', rotate: 'Rotate pages',
  delete: 'Delete pages', insertPages: 'Insert pages', replacePages: 'Replace pages',
  renumberPages: 'Renumber pages', cropPages: 'Crop pages', rotateCounterClockwise: 'Rotate counter-clockwise',
  recognizeText: 'Recognize text (OCR)', annotate: 'Annotate', sign: 'Sign', flatten: 'Flatten',
  stamp: 'Stamp', watermark: 'Watermark', optimize: 'Reduce file size', audit: 'Audit space usage',
  createFromImages: 'Create PDF from images', exportPages: 'Export pages as images',
  exportText: 'Export text', exportDocx: 'Export to Word (.docx)', undo: 'Undo', redo: 'Redo',
};

async function tryDockVerb(window, stageNum, id) {
  await gotoStage(window, stageNum);
  const inline = window.locator(`[data-dock-verb="${id}"]`);
  if ((await inline.count()) > 0) {
    const vis = await inline.first().isVisible().catch(() => false);
    await inline.first().click(vis ? {} : { force: true });
    await window.waitForTimeout(400);
    return true;
  }
  const overflow = window.locator('[data-dock-overflow]');
  if ((await overflow.count()) > 0 && (await overflow.first().isVisible().catch(() => false))) {
    await overflow.first().click();
    await window.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 5000 }).catch(() => {});
    const item = window.locator(`[data-dock-overflow-item="${id}"]`);
    if ((await item.count()) > 0) {
      await item.first().click();
      await window.waitForTimeout(400);
      return true;
    }
    await window.keyboard.press('Escape');
  }
  return false;
}

const ANN_TOOL_KIND = {
  annHighlight: 'highlight', annUnderline: 'underline', annStrikeout: 'strikeout', annInk: 'ink',
  annTextbox: 'textbox', annRect: 'rect', annEllipse: 'ellipse', annArrow: 'arrow',
  annCallout: 'callout', annNote: 'note',
};

async function runTool(window, id) {
  // 0. Annotation tools live in the REVIEW stage's Annotate flyout.
  if (ANN_TOOL_KIND[id]) {
    await armAnnotationTool(window, ANN_TOOL_KIND[id]);
    return 'flyout';
  }
  // 1. The PAGES ContextPanel header hosts the Combine (merge) entry.
  if (id === 'merge') {
    const combine = window.locator('[data-context-panel-combine]');
    if ((await combine.count()) > 0 && (await combine.first().isVisible().catch(() => false))) {
      await combine.first().click();
      await window.waitForTimeout(400);
      return 'combine';
    }
  }
  // 2. Action Dock verb, declared stage first then every other stage.
  const order = [TOOL_STAGE_NUM[id] ?? 1, 1, 2, 3, 4];
  for (const stageNum of [...new Set(order)]) {
    if (await tryDockVerb(window, stageNum, id)) return `dock:${stageNum}`;
  }
  // 3. Command Palette — the universal global command surface.
  await window.keyboard.press('Control+k');
  await window.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  await window.locator('[data-command-palette-input]').fill(TOOL_LABEL[id] ?? id);
  await window.waitForTimeout(350);
  const row = window.locator('.command-palette-row').filter({ hasText: TOOL_LABEL[id] ?? id }).first();
  if ((await row.count()) > 0) {
    await row.click();
  } else {
    await window.keyboard.press('Enter');
  }
  await window.waitForTimeout(500);
  return 'palette';
}

// Phase 36 migration: a reused profile persists `pagesPanelCollapsed`, so specs
// that need the panel's thumbnails/sections must expand it first.
async function ensurePanelExpanded(window) {
  const collapsed = window.locator('[data-context-panel][data-context-panel-collapsed="true"]');
  if ((await collapsed.count()) > 0) {
    await window.locator('[data-rail-collapse]').first().click();
    await window.waitForTimeout(500);
  }
}

// Phase 36 — the floating TextPropertiesPanel card occupied the left edge of
// the canvas in the EDIT / armed-text stages, so specs placing content by a
// hardcoded page fraction started the drag to the RIGHT of its edge.
//
// Phase 38 RETIRED the floating card: the text panel is re-parented into the
// Inspector at the RIGHT edge, and the canvas is inset so the page never runs
// under it. There is therefore no left-edge card to dodge any more, so this
// returns 0 (the callers' `max(pageX, avoidX)` then starts on the page). The
// name is kept so the many call sites stay unchanged.
async function textPanelRight(window) {
  return 0;
}

// Step-scroll the (virtualized) document scroller until the requested page-slot
// is mounted, then nudge it near the top of the viewport so pointer gestures on
// it land on the page, not on the toolbar / window chrome.
async function scrollToPage(window, n) {
  for (let i = 0; i < 50; i += 1) {
    const done = await window.evaluate((want) => {
      const sc = document.querySelector('.document-scroller');
      if (!sc) return true;
      const slot = document.querySelector(`.page-slot[data-page="${want}"]`);
      if (slot) {
        sc.scrollTop = slot.offsetTop - 100;
        return true;
      }
      sc.scrollTop += 1200;
      return false;
    }, n);
    await window.waitForTimeout(250);
    if (done) break;
  }
  await window.waitForTimeout(900);
}

async function shot(windowOrName, name) {
  // Support both shot(win, 'name.png') and shot('name.png') (uses currentWin).
  const w = (name === undefined) ? currentWin : windowOrName;
  const n = (name === undefined) ? windowOrName : name;
  const p = path.join(SHOTS, n);
  await w.screenshot({ path: p });
  return p;
}

// Sample the page-1 canvas's pixels inside a PAGE-RELATIVE css rect
// { x, y, w, h } (css px measured from the .pdf-page[data-page="1"]
// element's top-left). Returns the dominant rgb colors with counts and the
// dark-glyph pixel count. Used by the DEF-173/174 reopen specs to prove the
// canvas-rendered annotation color (pale translucent wash vs full-opacity
// block) without trusting screenshots alone.
async function sampleCanvasPageRect(window, relRect, pageNo = 1) {
  return window.evaluate(({ rel, want }) => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
    const page = pane && pane.querySelector(`.pdf-page[data-page="${want}"]`);
    const canvas = page && page.querySelector('canvas');
    if (!page || !canvas) return null;
    const pb = page.getBoundingClientRect();
    const cb = canvas.getBoundingClientRect();
    const sx = canvas.width / cb.width;
    const sy = canvas.height / cb.height;
    const x0 = Math.max(0, Math.round((rel.x + (pb.left - cb.left)) * sx));
    const y0 = Math.max(0, Math.round((rel.y + (pb.top - cb.top)) * sy));
    const w = Math.max(1, Math.min(canvas.width - x0, Math.round(rel.w * sx)));
    const h = Math.max(1, Math.min(canvas.height - y0, Math.round(rel.h * sy)));
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(x0, y0, w, h);
    const counts = {};
    let darkGlyphs = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
      const key = `${r},${g},${b}`;
      counts[key] = (counts[key] || 0) + 1;
      if (r < 100 && g < 100 && b < 100) darkGlyphs += 1;
    }
    const topColors = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([rgb, n]) => {
        const [r, g, b] = rgb.split(',').map(Number);
        return { rgb: [r, g, b], n };
      });
    return { bboxCanvasPx: [x0, y0, w, h], topColors, darkGlyphs };
  }, { rel: relRect, want: pageNo });
}

// Dump key engine-state pieces for diagnosis.
async function dumpEngine(window, label) {
  const out = await window.evaluate(() => {
    const d = window.tflexDiagnostics();
    const e = d.engineState || {};
    const res = {
      pageCount: d.pageCount,
      currentPage: d.currentPage,
      modified: d.modified,
      tabModified: d.tabModified,
      canUndo: d.canUndo,
      canRedo: d.canRedo,
      activeTool: d.activeTool,
      theme: d.theme,
      annotations: e.annotations || [],
      pageOrder: e.pageOrder && e.pageOrder.slice(0, 12),
      rotations: e.rotations && e.rotations.slice(0, 12),
      pageOrderLen: e.pageOrder ? e.pageOrder.length : null,
    };
    return res;
  });
  console.log(`[${label}] ${JSON.stringify(out)}`);
  return out;
}

// Force-destroy the window(s) so the DEF-142 close gate (which would prompt on
// a modified doc and hang electronApp.close) cannot block teardown. Only qa
// may edit this helper.
//
// Wedge-proofing (def_085 escalation, 2026-09-06). electronApp.close() waits
// for the launched process tree to exit: on Windows Playwright launches
// Electron through a cmd.exe shell, and the shell's 'close' event (what
// close() ultimately awaits) fires only once the WHOLE tree has exited and
// every inherited stdio pipe is closed. When teardown lands while a
// renderer/GPU operation is still in flight (repro: a Playwright
// window.screenshot() taken immediately before hardClose), Chromium's quit
// wedges mid-shutdown and the tree stays alive indefinitely, so close() never
// settles and the afterEach hangs the whole runner. Diagnosis (one-off
// harnesses, deleted after the fix; evidence reproduced 5x):
//   - destroy with no CDP activity before it  -> app quits in ~150ms;
//   - screenshot then immediate destroy       -> whole tree (main, gpu,
//     renderer, network utility, shell) still alive at 45s, close() hung;
//   - killing ONLY the main process (process.exit(0)) does NOT unwedge:
//     the orphaned gpu/renderer children keep the inherited pipes open;
//   - taskkill /pid <shell> /T /F unwedges: close() resolved ~300ms later.
// This is a test-harness race, not a product defect (normal quit, and quit
// after a settle delay, always executes).
const DESTROY_GRACE_MS = 10000;
const CLOSE_GRACE_MS = 10000;
const KILL_SETTLE_MS = 15000;

async function bounded(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Snapshot the app's process tree (external, works even when CDP is dead).
function appTreeDump(rootPid) {
  try {
    const lines = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress"',
      { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const all = JSON.parse(lines);
    const arr = Array.isArray(all) ? all : [all];
    const out = [];
    const walk = (pid, depth) => {
      for (const p of arr.filter((x) => x.ParentProcessId === pid)) {
        out.push(`${'  '.repeat(depth)}pid=${p.ProcessId} ${p.Name}`);
        walk(p.ProcessId, depth + 1);
      }
    };
    const root = arr.find((x) => x.ProcessId === rootPid);
    out.push(root ? `pid=${root.ProcessId} ${root.Name}` : `root pid=${rootPid} not found (already exited)`);
    walk(rootPid, 1);
    return out.join('\n');
  } catch (e) {
    return `tree dump failed: ${e.message}`;
  }
}

async function hardClose(electronApp, label = 'hardClose') {
  if (!electronApp) return;
  const t0 = Date.now();
  const log = (msg) => {
    try { process.stdout.write(`[${label} +${Date.now() - t0}ms] ${msg}\n`); } catch (_) { /* stdout gone */ }
  };

  // 1. Destroy all windows (bypasses the DEF-142 close gate). Bounded: a
  //    wedged main must not block the rest of the teardown.
  try {
    await bounded(
      electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().forEach((w) => { try { w.destroy(); } catch (_) { /* ignore */ } });
      }),
      DESTROY_GRACE_MS,
      'window destroy',
    );
  } catch (e) {
    log(`window destroy did not confirm: ${e.message} (continuing)`);
  }

  // 2. close() with a bounded wait. Resolves in a few hundred ms normally.
  const closePromise = electronApp.close().catch(() => {});
  let closed = false;
  try {
    await bounded(closePromise, CLOSE_GRACE_MS, 'app close');
    closed = true;
  } catch (_) { /* fall through to diagnostics + force kill */ }
  if (closed) {
    log(`closed normally in ${Date.now() - t0}ms`);
    return;
  }

  // 3. Dump main-process state so the wedge is diagnosable from the log.
  log(`close() did not settle within ${CLOSE_GRACE_MS}ms - dumping state`);
  try {
    const state = await bounded(
      electronApp.evaluate(({ BrowserWindow }) => ({
        openWindows: BrowserWindow.getAllWindows().length,
        activeHandles: process._getActiveHandles().map((h) => {
          const name = (h && h.constructor && h.constructor.name) || typeof h;
          try {
            if (name === 'Timeout') return `${name} idle=${h._idleTimeout}`;
            if (name === 'ChildProcess') return `${name} pid=${h.pid}`;
            if (name === 'Socket' || name === 'Pipe') {
              return `${name} remote=${h.remoteAddress || ''}:${h.remotePort || ''}`;
            }
            return name;
          } catch (_) { return name; }
        }),
      })),
      5000,
      'state evaluate',
    );
    log(`main state: openWindows=${state.openWindows} handles=${JSON.stringify(state.activeHandles)}`);
  } catch (e) {
    log(`main state unavailable (CDP dead or wedged): ${e.message}`);
  }
  const proc = electronApp.process();
  const pid = proc ? proc.pid : null;
  log(`process tree at wedge (shell pid=${pid}):\n${pid ? appTreeDump(pid) : 'no child process handle'}`);

  // 4. Force kill the tree. On Windows the child of record is the cmd.exe
  //    shell, so only a tree kill (/T) reaches the electron processes that
  //    keep the stdio pipes open - same as Playwright's own killProcess.
  if (pid) {
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 });
        log('force-killed app process tree');
      } else {
        proc.kill('SIGKILL');
        log('force-killed app process');
      }
    } catch (e) {
      log(`force kill failed: ${e.message}`);
    }
  }
  await bounded(closePromise, KILL_SETTLE_MS, 'post-kill close').catch(() => {});
  log(`hardClose done (force path) in ${Date.now() - t0}ms`);
}

// Phase 37 (item 17) — the in-app print modal is retired. The title-bar Print
// icon, File > Print and Ctrl+P all open the STANDALONE print window
// (`?tfWindow=print`), which is a separate top-level BrowserWindow. This is the
// ONE opener the migrated print specs use; it returns the print window's Page.
async function openStandalonePrintWindow(electronApp, window) {
  const pagePromise = electronApp.waitForEvent('window');
  await window.click('[data-print]');
  const printPage = await pagePromise;
  await printPage.waitForSelector('[data-print-window]', { timeout: 30000 });
  await printPage.waitForSelector('[data-print-printer]', { state: 'visible', timeout: 20000 });
  await printPage.waitForFunction(
    () => {
      const sel = document.querySelector('[data-print-printer]');
      if (sel === null) return false;
      const hasReal = [...sel.querySelectorAll('option')].some((o) => o.value !== '');
      return hasReal || document.querySelector('[data-print-empty], [data-print-printers-error]') !== null;
    },
    null,
    { timeout: 20000 },
  );
  return printPage;
}

// Close the standalone print window (and any other print window) from main.
async function closeStandalonePrintWindow(electronApp, printPage) {
  if (printPage && !printPage.isClosed()) {
    await printPage.close().catch(() => {});
  }
  await electronApp
    .evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .filter((w) => w.webContents.getURL().includes('tfWindow=print'))
        .forEach((w) => {
          if (!w.isDestroyed()) w.close();
        });
    })
    .catch(() => {});
}

// ---------------------------------------------------------------------------
// Phase 127 restored the v1.50.0 title-row chrome: the settings gear
// `[data-open-preferences]`, the View menu's Toggle Theme row and the theme
// pill `[data-theme-toggle]` / `[data-theme-option]`. These helpers drive those
// real controls so the theme oracles keep asserting the same behaviour against
// the shipped surface.
// ---------------------------------------------------------------------------
async function openPreferences(window) {
  await window.locator('[data-open-preferences]').first().click();
  await window.waitForSelector('[data-prefs-dialog]', { timeout: 8000 });
}

// The File menu's Toggle Theme command cycles frosted -> dark -> light -> frosted
// (state/theme.ts nextTheme), so a single activation on a fresh profile (which
// boots frosted) lands on dark.
async function toggleThemeViaAppMenu(window) {
  await window.locator('[data-menu-button]').first().click();
  await window.waitForSelector('[data-menu-popover]', { state: 'visible', timeout: 8000 });
  await window.locator('[data-menu-popover] [data-menu-action="toggleTheme"]').first().click();
  await window
    .waitForSelector('[data-menu-popover]', { state: 'detached', timeout: 8000 })
    .catch(() => {});
  await window.waitForTimeout(300);
}

async function slotBox(window, page = 1) {
  return window.evaluate((want) => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
    const slot = pane && pane.querySelector(`.page-slot[data-page="${want}"]`);
    if (!slot) return null;
    const r = slot.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, page);
}

async function createAnnotationByDragging(window, x1, y1, x2, y2, page = 1) {
  const box = await slotBox(window, page);
  if (!box) throw new Error(`slotBox(${page}) did not return a box`);

  await window.mouse.move(box.x + box.w * x1, box.y + box.h * y1);
  await window.mouse.down();
  await window.mouse.move(box.x + box.w * x2, box.y + box.h * y2, { steps: 10 });
  await window.mouse.up();
  await window.waitForTimeout(700);
}

async function setTheme(window, theme) {
  // Phase 127 restored the v1.50.0 theme pill `[data-theme-toggle]` >
  // `[data-theme-option="<theme>"]`. Prefer it: one click selects the concrete
  // theme directly. Fall back to cycling the File menu's Toggle Theme command
  // (frosted -> dark -> light) only when the pill is unavailable.
  const current = await window.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (current === theme) {
    await window.waitForTimeout(300);
    return;
  }
  const pill = window.locator('[data-theme-toggle]').first();
  if ((await pill.count()) > 0) {
    await pill.click();
    await window.waitForSelector(`[data-theme-option="${theme}"]`, { state: 'visible', timeout: 8000 });
    await window.locator(`[data-theme-option="${theme}"]`).first().click();
    await window.waitForTimeout(400);
    const applied = await window.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (applied === theme) return;
  }
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const now = await window.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (now === theme) {
      await window.waitForTimeout(300);
      return;
    }
    await window.locator('[data-menu-button]').first().click();
    await window.waitForSelector('[data-menu-popover]', { state: 'visible', timeout: 8000 });
    await window.locator('[data-menu-popover] [data-menu-action="toggleTheme"]').first().click();
    await window.waitForSelector('[data-menu-popover]', { state: 'detached', timeout: 8000 }).catch(() => {});
    await window.waitForTimeout(400);
  }
  const final = await window.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (final !== theme) throw new Error(`setTheme: could not reach "${theme}" (currently "${final}")`);
}

module.exports = { launchDev, launchInstalled, dismissUpdatePrompt, openSample, openSamplePath, diag, shot, dumpEngine, getSamplePath, scrollToPage, sampleCanvasPageRect, hardClose, armAnnotationTool, toggleMultiModeViaPalette, gotoStage, openDockVerb, clickDockVerb, runTool, ensurePanelExpanded, toggleEditMode, armSignTool, openAnnotationFlyout, textPanelRight, openStandalonePrintWindow, closeStandalonePrintWindow, openPreferences, toggleThemeViaAppMenu, slotBox, createAnnotationByDragging, setTheme };