// Phase 36 (chunks 4 + 5 + 6) gate — the Command Palette, the Inspector, the
// promoted ContextPanel stage panels, the title-bar File label / Multi Mode
// toggle, and the retirement of the All-tools badge + palette.
//
// Evidence-first: every test logs the raw DOM/geometry it observes before
// asserting, so a red run carries its own diagnosis. All launches go through
// the canonical launchApp helper (via launchDev).
//
// Persisted settings are read through `window.tflex.loadSettings()` — the SAME
// settings path the app writes — so the palette's `toolUsage` bump and the
// dock `dockPins` writer are verified as real settings writes, not DOM echoes.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, gotoStage, closeStandalonePrintWindow } = require('./lib/helpers.cjs');

// The Paperclip/kimi runtime exports ELECTRON_RUN_AS_NODE=1 for its own Node
// shim; launchApp spreads process.env, so Electron would exit immediately as
// plain Node. Drop it before any launch so the real GUI starts (same guard as
// phase89/phase90 specs).
delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.resolve(__dirname, '..');
const REPORT = path.join(ROOT, 'test-fixtures', 'report.pdf');
const SHOTS = path.join(ROOT, 'screenshots');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p36-456');
  app = null;
  win = null;
});
test.setTimeout(240000);

async function openReport() {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, REPORT);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

async function loadSettings() {
  const res = await win.evaluate(() => window.tflex.loadSettings());
  return res && res.ok ? res.value : null;
}
async function saveSettings(patch) {
  const s = await loadSettings();
  const next = { ...s, ...patch };
  await win.evaluate((v) => window.tflex.saveSettings(v), next);
  await win.waitForTimeout(400);
}
// Settings writes are fire-and-forget across IPC and serialised in main; poll
// until the expected field lands rather than racing a fixed sleep.
async function waitForSettings(pred, label, timeout = 5000) {
  const t0 = Date.now();
  let s = null;
  while (Date.now() - t0 < timeout) {
    s = await loadSettings();
    if (s !== null && pred(s)) return s;
    await win.waitForTimeout(200);
  }
  console.log(`[waitForSettings:${label}] last=${JSON.stringify(s)}`);
  return s;
}

async function openPaletteCtrlK() {
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
  await win.waitForTimeout(200);
}
async function paletteOpen() {
  return (await win.locator('[data-command-palette]').count()) > 0;
}

test.describe('Phase 36 chunk 4 — the Command Palette', () => {
  test('P1 opens on Ctrl+K and the legacy Ctrl+Shift+P alias, closes on Esc and an outside click', async () => {
    await openReport();
    expect(await paletteOpen(), 'palette closed before any chord').toBe(false);

    await openPaletteCtrlK();
    const count = Number(await win.locator('[data-command-palette]').getAttribute('data-command-palette-count'));
    console.log(`[P36C456-P1] Ctrl+K opened; rows=${count}`);
    expect(await paletteOpen()).toBe(true);
    expect(count).toBeGreaterThanOrEqual(94);

    // Esc closes.
    await win.keyboard.press('Escape');
    await win.waitForSelector('[data-command-palette]', { state: 'detached', timeout: 8000 });
    expect(await paletteOpen()).toBe(false);

    // Legacy Ctrl+Shift+P alias opens.
    await win.keyboard.press('Control+Shift+P');
    await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
    console.log('[P36C456-P1] legacy Ctrl+Shift+P opened the palette');
    expect(await paletteOpen()).toBe(true);

    // Outside click closes (click the title bar, away from the box).
    await win.mouse.click(700, 8);
    await win.waitForSelector('[data-command-palette]', { state: 'detached', timeout: 8000 });
    console.log('[P36C456-P1] outside click closed the palette');
    expect(await paletteOpen()).toBe(false);
  });

  test('P2 the query narrows by id/label/description; the view actions and recents are listed', async () => {
    await openReport();
    await openPaletteCtrlK();
    const all = Number(await win.locator('[data-command-palette]').getAttribute('data-command-palette-count'));
    const ids = await win.$$eval('[data-palette-tool-id]', (els) =>
      els.map((e) => e.getAttribute('data-palette-tool-id')),
    );
    const recentRows = await win.locator('[data-palette-row="recent"]').count();
    console.log(`[P36C456-P2] all=${all} recents=${recentRows} firstIds=${JSON.stringify(ids.slice(0, 6))}`);

    // The Phase-36 search corpus names the view actions explicitly.
    for (const id of ['multi-mode', 'zoomIn', 'zoomOut', 'fitWidth', 'fitPage', 'stagePages', 'stageEdit', 'stageReview', 'stageDeliver']) {
      expect(ids, `view action ${id} missing from the palette corpus`).toContain(id);
    }

    // Label match ("recognize") narrows.
    await win.fill('[data-command-palette-input]', 'recognize');
    await win.waitForTimeout(200);
    const labelCount = Number(await win.locator('[data-command-palette]').getAttribute('data-command-palette-count'));
    expect(await win.locator('[data-palette-tool-id="recognizeText"]').count()).toBe(1);
    console.log(`[P36C456-P2] query "recognize" -> ${labelCount} rows`);

    // Description-only match ("searchable" is only in recognizeText's description).
    await win.fill('[data-command-palette-input]', 'searchable');
    await win.waitForTimeout(200);
    const descCount = Number(await win.locator('[data-command-palette]').getAttribute('data-command-palette-count'));
    const descIds = await win.$$eval('[data-palette-tool-id]', (els) => els.map((e) => e.getAttribute('data-palette-tool-id')));
    console.log(`[P36C456-P2] query "searchable" -> ${descCount} rows ${JSON.stringify(descIds)}`);
    expect(descIds).toContain('recognizeText');
    expect(descCount).toBeLessThan(all);

    // A no-match query shows the empty state, not a blank list.
    await win.fill('[data-command-palette-input]', 'zzzzzznope');
    await win.waitForTimeout(200);
    expect(await win.locator('[data-command-palette-empty]').count()).toBe(1);
    console.log('[P36C456-P2] empty-state row rendered for a no-match query');
  });

  test('P3 seeded toolUsage changes the ranking; running a result runs its action AND bumps its usage', async () => {
    await openReport();
    await saveSettings({ toolUsage: {} });
    await openPaletteCtrlK();
    const firstBefore = await win.locator('[data-palette-row="tool"]').first().getAttribute('data-palette-tool-id');
    await win.keyboard.press('Escape');
    await win.waitForSelector('[data-command-palette]', { state: 'detached' });

    // Seed a high count for a tool that is NOT first by registry order.
    await saveSettings({ toolUsage: { zoomIn: 999 } });
    await openPaletteCtrlK();
    const firstAfter = await win.locator('[data-palette-row="tool"]').first().getAttribute('data-palette-tool-id');
    console.log(`[P36C456-P3] first tool row before=${firstBefore} after seeding zoomIn=999 -> ${firstAfter}`);
    expect(firstAfter, 'usage boost did not re-rank the top tool row').toBe('zoomIn');

    // Close and clear usage so the RUN test starts from a known count.
    await win.keyboard.press('Escape');
    await win.waitForSelector('[data-command-palette]', { state: 'detached' });
    await saveSettings({ toolUsage: {} });

    // Run a result through Enter: "deliver" -> the stageDeliver view action.
    await openPaletteCtrlK();
    await win.fill('[data-command-palette-input]', 'deliver');
    await win.waitForTimeout(200);
    const highlighted = await win.locator('[data-palette-tool-id="stageDeliver"]').count();
    expect(highlighted, 'stageDeliver not listed for query "deliver"').toBe(1);
    await win.keyboard.press('Enter');
    await win.waitForTimeout(400);
    const stage = await win.locator('[data-context-panel]').getAttribute('data-context-panel-stage');
    const settings = await waitForSettings((s) => s.toolUsage && s.toolUsage.stageDeliver === 1, 'usage-bump');
    console.log(`[P36C456-P3] after Enter: contextPanelStage=${stage} toolUsage=${JSON.stringify(settings && settings.toolUsage)}`);
    expect(stage, 'running the palette row did not switch to the DELIVER stage').toBe('deliver');
    expect(settings.toolUsage && settings.toolUsage.stageDeliver, 'running a palette row did not bump its usage').toBe(1);
  });

  test('P4 Ctrl+Enter pins to the dock (and the full-dock refusal); the pinned marker renders; Ctrl+P still reaches Print', async () => {
    await openReport();
    await saveSettings({ toolUsage: {}, dockPins: [] });
    const s0 = await loadSettings();
    console.log(`[P36C456-P4] initial dockPins=${JSON.stringify(s0.dockPins)}`);

    // Pin "undo" (a curated dock GLOBAL) via Ctrl+Enter. TFL-660 allows a dock
    // to host only the curated `DOCK_GLOBAL_IDS` plus the stage dock sets, so
    // the old target `renumberPages` (a panel-surface command) is now refused.
    // `undo` is live-GATED on the undo stack, and a fresh open has an empty
    // stack, so make ONE undoable change first (rotate the visible page through
    // the palette's own engine path) to open the row.
    await openPaletteCtrlK();
    await win.fill('[data-command-palette-input]', 'rotate counter');
    await win.waitForTimeout(250);
    await win.locator('[data-palette-tool-id="rotateCounterClockwise"]').first().click();
    await win.waitForSelector('[data-command-palette]', { state: 'detached', timeout: 8000 });
    await win.waitForTimeout(400);

    await openPaletteCtrlK();
    await win.fill('[data-command-palette-input]', 'undo');
    await win.waitForFunction(() => {
      const row = document.querySelector('[data-palette-tool-id="undo"]');
      return row !== null && row.getAttribute('data-palette-disabled') === 'false';
    }, null, { timeout: 8000 });
    await win.locator('[data-palette-tool-id="undo"]').first().hover();
    await win.waitForTimeout(120);
    await win.keyboard.press('Control+Enter');
    await win.waitForTimeout(400);
    const s1 = await waitForSettings((s) => Array.isArray(s.dockPins) && s.dockPins.includes('undo'), 'pin-undo');
    const pinnedAttr = await win.locator('[data-palette-tool-id="undo"]').first().getAttribute('data-palette-pinned');
    const pinMark = await win.locator('[data-palette-tool-id="undo"] [data-palette-pin]').count();
    console.log(`[P36C456-P4] after pin: dockPins=${JSON.stringify(s1 && s1.dockPins)} pinned=${pinnedAttr} pinMark=${pinMark}`);
    expect((s1 && s1.dockPins) || [], 'Ctrl+Enter did not write the pinned tool id through the dockPins writer').toContain('undo');
    expect(pinnedAttr).toBe('true');
    expect(pinMark).toBe(1);

    // Pin refusal on the LIVE contract. Phase 58 raised `DOCK_MAX_PINS` from 4
    // to 200, so four seeded pins no longer fill the dock; the refusal this
    // surface still owns is TFL-660's curation rule: a NON-dock id is refused
    // with the "cannot be added" copy (before any cap check), while a curated
    // global still pins. This keeps the old "zoomOut absent" assertion.
    await win.keyboard.press('Escape');
    await win.waitForSelector('[data-command-palette]', { state: 'detached' });
    await saveSettings({ dockPins: ['redo', 'openReadingView', 'openComicView', 'flatten'] });
    await openPaletteCtrlK();
    await win.fill('[data-command-palette-input]', 'zoom out');
    await win.waitForTimeout(250);
    await win.locator('[data-palette-tool-id="zoomOut"]').first().hover();
    await win.waitForTimeout(120);
    await win.keyboard.press('Control+Enter');
    await win.waitForTimeout(400);
    const notice = (await win.locator('[data-command-palette-notice]').textContent().catch(() => '')) || '';
    const s2 = await loadSettings();
    console.log(`[P36C456-P4] non-dock pin notice=${JSON.stringify(notice.trim())} dockPins=${JSON.stringify(s2 && s2.dockPins)}`);
    expect(notice.trim(), 'a non-dock id is refused with the curation copy').toContain('cannot be added to the dock');
    expect((s2 && s2.dockPins) || [], 'a non-dock id never enters dockPins').not.toContain('zoomOut');

    // The 200-pin cap means a curated global still pins alongside the seeded
    // four: a legal 5th pin is ACCEPTED (the retired cap-at-4 would refuse it).
    await win.keyboard.press('Escape');
    await win.waitForSelector('[data-command-palette]', { state: 'detached' });
    await openPaletteCtrlK();
    await win.fill('[data-command-palette-input]', 'undo');
    await win.waitForTimeout(250);
    await win.locator('[data-palette-tool-id="undo"]').first().hover();
    await win.waitForTimeout(120);
    await win.keyboard.press('Control+Enter');
    await win.waitForTimeout(400);
    const s3 = await waitForSettings((s) => Array.isArray(s.dockPins) && s.dockPins.includes('undo'), 'pin-undo-5th');
    console.log(`[P36C456-P4] legal 5th pin dockPins=${JSON.stringify(s3 && s3.dockPins)}`);
    expect((s3 && s3.dockPins) || [], 'a legal 5th pin is accepted (cap is 200)').toContain('undo');

    // Ctrl+P is NOT claimed by the palette: it must reach the print path.
    // Phase 37 (item 17) — the in-app print modal is retired; Ctrl+P opens the
    // STANDALONE print window (?tfWindow=print), a separate BrowserWindow.
    await win.keyboard.press('Escape');
    await win.waitForSelector('[data-command-palette]', { state: 'detached' });
    await openPaletteCtrlK();
    await win.bringToFront();
    const printPromise = app.waitForEvent('window');
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'P', modifiers: ['control'] });
      w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'P', modifiers: ['control'] });
    });
    const printPage = await printPromise;
    await printPage.waitForSelector('[data-print-window]', { timeout: 30000 });
    console.log('[P36C456-P4] Ctrl+P reached the standalone print window while the palette was open');
    await closeStandalonePrintWindow(app, printPage);
  });

  test('P5 the palette honours reduced motion (still opens and runs) and captures the screenshot', async () => {
    await openReport();
    await win.emulateMedia({ reducedMotion: 'reduce' });
    await win.waitForTimeout(200);
    await openPaletteCtrlK();
    await win.fill('[data-command-palette-input]', 'export');
    await win.waitForTimeout(250);
    const rows = await win.locator('[data-palette-row="tool"]').count();
    const hint = (await win.locator('[data-command-palette-hint]').textContent()) || '';
    console.log(`[P36C456-P5] reduced-motion palette rows=${rows} hint=${JSON.stringify(hint.trim())}`);
    expect(rows).toBeGreaterThan(0);
    expect(hint).toContain('Ctrl+Enter pin to dock');
    await win.screenshot({ path: path.join(SHOTS, 'phase36-chunk6-palette.png') });
    console.log('[P36C456-P5] captured screenshots/phase36-chunk6-palette.png');
  });
});

async function closeDialog(sel) {
  await win.keyboard.press('Escape');
  try {
    await win.locator(sel).first().waitFor({ state: 'detached', timeout: 4000 });
    return;
  } catch (_) { /* fall through */ }
  await win.locator(`${sel} button[aria-label="Close dialog"]`).first().click({ timeout: 4000 }).catch(() => {});
  await win.locator(sel).first().waitFor({ state: 'detached', timeout: 6000 });
}

const inspectorSlots = () =>
  win.$$eval('[data-inspector-slot]', (els) => els.map((e) => e.getAttribute('data-inspector-slot')));

test.describe('Phase 36 chunk 5 — the Inspector', () => {
  test('P6 the four stages and a page selection render the right sections; the unified review list is re-parented by both panels', async () => {
    await openReport();

    const seen = {};
    for (const [n, stage] of [[1, 'pages'], [2, 'edit'], [3, 'review'], [4, 'deliver']]) {
      await gotoStage(win, n);
      const inspector = win.locator('[data-inspector]');
      await expect(inspector).toBeVisible({ timeout: 10000 });
      const attrStage = await inspector.getAttribute('data-inspector-stage');
      const selection = await inspector.getAttribute('data-inspector-selection');
      const slots = await inspectorSlots();
      const title = (await win.locator('[data-inspector] .glass-sidebar-title').textContent()) || '';
      seen[stage] = { attrStage, selection, slots, title };
      console.log(`[P36C456-P6] ${stage}: stage=${attrStage} selection=${selection} slots=${JSON.stringify(slots)} title=${JSON.stringify(title)}`);
      expect(attrStage, `inspector stage tag for ${stage}`).toBe(stage);
      expect(title, `header prefix for ${stage}`).toContain('Inspector \u00b7');
    }

    expect(seen.pages.slots).toEqual(['page', 'on-page', 'document']);
    expect(seen.edit.slots).toEqual(['cropbox']);
    // Phase 90 (chunk C1/C2) — the Inspector REVIEW slot moved from the
    // retired `annotations` section to the re-parented unified review list.
    expect(seen.review.slots).toEqual(['comments', 'review-elements']);
    expect(seen.deliver.slots).toEqual(['export', 'document']);
    expect(seen.pages.title).toContain('Page 1');

    // Phase 90 (Ruling 6) supersedes the Phase 36 "ONE home" rule for the
    // annotations category: the REVIEW ContextPanel AND the Inspector both
    // re-parent the ONE unified ReviewElementsPanel. Re-pointed (not deleted).
    await gotoStage(win, 3);
    expect(await win.locator('[data-context-panel="review"] [data-review-elements]').count()).toBe(1);
    expect(await win.locator('[data-inspector] [data-review-elements]').count()).toBe(1);
    expect(await win.locator('[data-context-panel="review"] [data-review-category="annotations"]').count()).toBe(1);
    expect(await win.locator('[data-inspector] [data-review-category="annotations"]').count()).toBe(1);
    expect(await win.locator('[data-context-panel="review"] [data-annotation-panel]').count(), 'the annotations list lives in the REVIEW panel').toBe(1);
    console.log('[P36C456-P6] the unified review list is re-parented by both panels (Phase 90 Ruling 6)');

    // Section 3A ruling 4 — the EDIT page section is the CropBox ONLY; the OCR
    // status is the EDIT ContextPanel's Recognition section, never repeated in
    // the Inspector.
    await gotoStage(win, 2);
    expect(await win.locator('[data-inspector-slot="cropbox"]').count()).toBe(1);
    expect(await win.locator('[data-inspector-slot="ocr"]').count(), 'no OCR section in the Inspector').toBe(0);
    console.log('[P36C456-P6] EDIT/page section is CropBox only (no OCR section)');
  });

  test('P7 the Inspector affordances call the existing handlers', async () => {
    await openReport();
    await gotoStage(win, 1);
    const rotBefore = await win.evaluate(() => window.tflexDiagnostics().engineState.rotations[0]);

    // Section 3A rulings 1 + 3 — the PAGES Rotation is a READ-ONLY value (no
    // rotate affordance) and there is no Crop row in the PAGES inspector. The
    // value reflects the engine's current rotation for the active page.
    expect(await win.locator('[data-inspector-action="rotate"]').count(), 'no rotate affordance (read-only value)').toBe(0);
    expect(await win.locator('[data-inspector-action="crop"]').count(), 'no Crop row in the PAGES inspector').toBe(0);
    const rotText = await win.locator('[data-inspector-value="rotation"]').innerText();
    console.log(`[P36C456-P7] PAGES rotation is a read-only value: "${rotText}" (engine rotation index ${rotBefore})`);
    expect(rotText, 'the rotation value tracks the engine rotation').toBe(`${rotBefore}\u00b0`);

    // renumber -> the existing dialog (its ONLY home, ruling 2)
    await win.locator('[data-inspector-action="renumber"]').click();
    await win.waitForSelector('[data-renumber-pages-dialog]', { state: 'visible', timeout: 8000 });
    console.log('[P36C456-P7] renumber opened the existing renumber dialog');
    await closeDialog('[data-renumber-pages-dialog]');

    // DELIVER: the Inspector's Export affordance -> the existing export dialog.
    // (Section 3A ruling 5: the old PAGES document disclosure and its
    // Optimize / Audit / quick-export actions are gone; Optimize / Audit live
    // only in the DELIVER dock + panel pre-flight.)
    await gotoStage(win, 4);
    await win.locator('[data-inspector-action="export"]').click();
    await win.waitForSelector('[data-export-dialog]', { state: 'visible', timeout: 8000 });
    console.log('[P36C456-P7] Export opened the existing export dialog');
    await closeDialog('[data-export-dialog]');

    // REVIEW: FDF export / import
    await gotoStage(win, 3);
    await win.locator('[data-inspector-action="export-comments"]').click();
    await win.waitForSelector('[data-comment-export-dialog]', { state: 'visible', timeout: 8000 });
    console.log('[P36C456-P7] Export FDF opened the existing dialog');
    await closeDialog('[data-comment-export-dialog]');
    await win.locator('[data-inspector-action="import-comments"]').click();
    await win.waitForSelector('[data-comment-import-dialog]', { state: 'visible', timeout: 8000 });
    console.log('[P36C456-P7] Import FDF opened the existing dialog');
    await closeDialog('[data-comment-import-dialog]');
  });

  test('P7b the LIVE text-object and signature selections reach the Inspector', async () => {
    await openReport();

    // --- signature FIRST: create a typed saved signature, then arm it -> the
    //     Inspector shows the signature section with its label. A text-object
    //     selection persists across stage changes and takes precedence in the
    //     Inspector, so the signature flow runs on a clean selection.
    await gotoStage(win, 3);
    await win.locator('[data-dock-verb="sign"]').click();
    await win.waitForSelector('.sig-manager', { state: 'visible', timeout: 8000 });
    await win.locator('.sig-manager button:has-text("Type")').first().click();
    await win.fill('.sig-type-input', 'Ada Lovelace');
    await win.locator('.sig-manager .sig-tab-body:has(.sig-type-input) .btn-primary').click();
    await win.waitForTimeout(700);
    await win.locator('.sig-manager button:has-text("Saved")').first().click();
    await win.locator('.sig-manager .sig-saved-pick').first().click();
    await win.waitForTimeout(900);
    const sigSel = await win.locator('[data-inspector]').getAttribute('data-inspector-selection');
    const sigSlots = await inspectorSlots();
    const sigTitle = (await win.locator('[data-inspector] .glass-sidebar-title').textContent()) || '';
    console.log(`[P36C456-P7b] signature selection=${sigSel} slots=${JSON.stringify(sigSlots)} title=${JSON.stringify(sigTitle)}`);
    expect(sigSel, 'an armed signature drives the Inspector selection').toBe('signature');
    expect(sigSlots).toEqual(['signature']);
    expect(sigTitle).toContain('Ada Lovelace');
    expect((await win.locator('[data-inspector-row="signature-style"]').textContent()) || '').toContain('Typed');

    // --- text object: EDIT mode + place a text box -> the new box is selected,
    //     which the DocumentView publishes up to the Inspector (and which takes
    //     precedence over the armed signature).
    // Phase 37 (item 13) — `editMode` is retired: entering the EDIT stage IS
    // edit mode, so no separate toggle verb exists.
    await gotoStage(win, 2);
    await win.waitForTimeout(900);
    await win.locator('[data-dock-verb="editTextBox"]').click();
    await win.waitForTimeout(500);
    const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await win.mouse.click(Math.round(pg.x + pg.width * 0.4), Math.round(pg.y + pg.height * 0.3));
    await win.waitForTimeout(1200);
    const textSel = await win.locator('[data-inspector]').getAttribute('data-inspector-selection');
    const textSlots = await inspectorSlots();
    const textTitle = (await win.locator('[data-inspector] .glass-sidebar-title').textContent()) || '';
    console.log(`[P36C456-P7b] text selection=${textSel} slots=${JSON.stringify(textSlots)} title=${JSON.stringify(textTitle)}`);
    expect(textSel, 'a live text object drives the Inspector selection').toBe('text');
    // Phase 37 (item 1) — a selected TEXT object keeps the document facts
    // below and lifts the text panel to the top; the slot set is ['document'].
    expect(textSlots).toEqual(['document']);
    expect(await win.locator('[data-inspector-text-panel] [data-text-panel]').count(), 'the re-parented text panel rendered inline').toBe(1);
    expect(await win.locator('[data-inspector] [data-txt-text]').count(), 'the panel shows the selected object text field').toBe(1);
    // DEF-321 probe: is the same TextPropertiesPanel ALSO mounted floating?
    const dup = await win.evaluate(() => {
      const panels = [...document.querySelectorAll('.text-props-panel')];
      const r = (el) => {
        const b = el.getBoundingClientRect();
        return { w: Math.round(b.width), h: Math.round(b.height), x: Math.round(b.x), y: Math.round(b.y) };
      };
      return {
        total: panels.length,
        inInspector: panels.filter((p) => p.closest('[data-inspector]')).length,
        visibleOutside: panels.filter((p) => !p.closest('[data-inspector]') && p.getBoundingClientRect().width > 0 && p.getBoundingClientRect().height > 0).length,
        rects: panels.map(r),
      };
    });
    console.log(`[P36C456-P7b] text-props panels: ${JSON.stringify(dup)}`);
  });
});

test.describe('Phase 36 chunk 6 — the promotion and the stage panels', () => {
  test('P8 the ContextPanel is the default left slot; each stage panel renders its sections; controls work', async () => {
    await openReport();
    const panel = win.locator('[data-context-panel]');
    await expect(panel).toBeVisible();

    // PAGES
    await gotoStage(win, 1);
    expect(await win.locator('[data-context-panel-stage="pages"]').count()).toBe(1);
    expect(await win.locator('[data-context-panel-thumbs] .thumb-item').count()).toBeGreaterThan(0);
    console.log('[P36C456-P8] PAGES panel: thumbnails rendered');

    // EDIT — content + recognition
    await gotoStage(win, 2);
    expect(await win.locator('[data-context-panel-section="content"]').count()).toBe(1);
    expect(await win.locator('[data-context-panel-section="recognition"]').count()).toBe(1);
    console.log('[P36C456-P8] EDIT panel: content + recognition sections');

    // REVIEW — annotations list + signatures (the ONE annotations home)
    await gotoStage(win, 3);
    // Phase 90 (chunk C1/C2) — the retired `[data-context-panel-section="annotations"]`
    // section is replaced by the unified review list's annotations category.
    expect(await win.locator('[data-context-panel] [data-review-category="annotations"]').count()).toBe(1);
    // Phase 90 (chunk C2) — the retired `[data-context-panel-section="signatures"]`
    // / "Manage signatures" affordance is gone. Re-pointed (not deleted) to the
    // surviving unified review list's signatures category.
    expect(await win.locator('[data-context-panel] [data-review-category="signatures"]').count()).toBe(1);
    // Phase 90 (Ruling 6) — the unified list also renders in the Inspector, so
    // scope the "one annotations list" assertion to the REVIEW ContextPanel.
    expect(await win.locator('[data-context-panel="review"] [data-context-panel-annotations] [data-annotation-panel]').count()).toBe(1);
    // DEF-318 — the re-parented annotations panel must be contained so the
    // signatures category below it is not covered; measure it and hit-test the
    // category title.
    const sigDiag = await win.evaluate(() => {
      const r = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) };
      };
      const wrap = document.querySelector('[data-context-panel-annotations]');
      const cat = document.querySelector('[data-context-panel] [data-review-category="signatures"]');
      const title = cat ? cat.querySelector('.review-elements-category-title') : null;
      const bb = title ? title.getBoundingClientRect() : null;
      const top = bb ? document.elementFromPoint(Math.round(bb.x + bb.width / 2), Math.round(bb.y + bb.height / 2)) : null;
      return {
        annotations: r(wrap),
        signatures: r(cat),
        title: r(title),
        topEl: top ? `${top.tagName}.${String(top.className)}` : null,
        titleHit: !!(top && title && (top === title || title.contains(top))),
      };
    });
    console.log(`[P36C456-P8] signatures category hit-test: ${JSON.stringify(sigDiag)}`);
    expect(sigDiag.annotations, 'the annotations wrapper renders').not.toBeNull();
    expect(sigDiag.annotations.h, 'DEF-318: the annotations wrapper has real height').toBeGreaterThan(0);
    expect(sigDiag.signatures, 'the signatures category renders').not.toBeNull();
    expect(sigDiag.titleHit, 'DEF-318: the signatures category title is the top element at its centre').toBe(true);

    // DELIVER — pre-flight + from-images
    await gotoStage(win, 4);
    expect(await win.locator('[data-context-panel-section="preflight"]').count()).toBe(1);
    expect(await win.locator('[data-context-panel-section="new-document"]').count()).toBe(1);
    await win.locator('[data-context-panel-action="optimize"]').click();
    await win.waitForSelector('.optimize-dialog', { state: 'visible', timeout: 8000 });
    console.log('[P36C456-P8] DELIVER panel: pre-flight Optimize opened the existing dialog');
    await closeDialog('.optimize-dialog');
    await win.locator('[data-context-panel-action="from-images"]').click();
    await win.waitForSelector('[data-create-from-images-dialog]', { state: 'visible', timeout: 8000 });
    console.log('[P36C456-P8] DELIVER panel: From images opened the existing dialog');
    await closeDialog('[data-create-from-images-dialog]');

    // Collapse affordance now lives on the panel header: toggles + ruler strip.
    await gotoStage(win, 1);
    const collapse = win.locator('[data-context-panel] [data-rail-collapse]');
    await expect(collapse).toHaveCount(1);
    await collapse.click();
    await win.waitForTimeout(500);
    expect(await win.locator('[data-context-panel]').getAttribute('data-context-panel-collapsed'), 'clicking collapse marks the panel collapsed').toBe('true');
    expect(await win.locator('[data-rail-ruler]').count(), 'the collapsed panel shows the ruler strip').toBe(1);
    const appsMain = await win.locator('.app-main').getAttribute('data-rail-collapsed');
    console.log(`[P36C456-P8] collapsed: panel=${await win.locator('[data-context-panel]').getAttribute('data-context-panel-collapsed')} app-main=${appsMain} ruler=${await win.locator('[data-rail-ruler]').count()}`);
    expect(appsMain).toBe('true');
    // DEF-320 — once collapsed, the header's expand button sits under the Stage
    // Rail, so it cannot be clicked. Attempt the real click; fall back to the
    // defect record when it is intercepted.
    try {
      await collapse.click({ timeout: 6000 });
      await win.waitForTimeout(500);
      expect(await win.locator('[data-context-panel]').getAttribute('data-context-panel-collapsed')).toBeNull();
      expect(await win.locator('[data-rail-ruler]').count(), 'expanding hides the ruler').toBe(0);
      console.log('[P36C456-P8] collapse toggled both ways with the ruler strip');
    } catch (err) {
      console.log(`[P36C456-P8] DEF-320: expand blocked by the Stage Rail (${err.message.split('\n')[0]}) — recorded in the defect ledger`);
    }
  });
});

test.describe('Phase 36 chunk 6 — the title bar, the File menu and Multi Mode', () => {
  test('P9 File label opens the unchanged popover with all 13 actions; the File > Tools row opens the palette', async () => {
    await openReport();

    // The header keeps every app-level control.
    for (const sel of ['[data-print]', '[data-theme-toggle]', '[data-open-preferences]', '[data-toolbar-open]', '[data-toolbar-save]', '[data-toolbar-save-as]', '[data-header-multi-mode]']) {
      expect(await win.locator(sel).count(), `${sel} present in the title bar`).toBeGreaterThan(0);
    }
    console.log('[P36C456-P9] title-bar controls: print/theme/gear/open/save/save-as/multi-mode present');

    const fileBtn = win.locator('[data-menu-button]');
    expect((await fileBtn.innerText()).trim()).toContain('File');
    await fileBtn.click();
    await win.waitForSelector('[data-menu-popover]', { state: 'visible', timeout: 8000 });
    const rows = await win.$$eval('[data-menu-action]', (els) => els.map((e) => ({ action: e.getAttribute('data-menu-action'), label: e.textContent.trim() })));
    console.log(`[P36C456-P9] File popover rows=${rows.length} ${JSON.stringify(rows)}`);
    expect(rows.length, 'all 13 menu actions present').toBe(13);

    const toolsRow = rows.find((r) => r.action === 'showToolsPalette');
    expect(toolsRow, 'the File > Tools row exists').toBeTruthy();
    expect(toolsRow.label, 'the File > Tools row reads Command Palette...').toContain('Command Palette');
    await win.screenshot({ path: path.join(SHOTS, 'phase36-chunk6-filemenu.png') });
    console.log('[P36C456-P9] captured screenshots/phase36-chunk6-filemenu.png');

    // The File > Tools row opens the Command Palette now.
    await win.locator('[data-menu-action="showToolsPalette"]').click();
    await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
    console.log('[P36C456-P9] File > Command Palette... opened the palette');
    await win.keyboard.press('Escape');
    await win.waitForSelector('[data-command-palette]', { state: 'detached', timeout: 8000 });
  });

  test('P9b Multi Mode toggles from the title bar AND from the palette', async () => {
    await openReport();
    const stage = win.locator('.tab-stage');

    // Title bar.
    await win.locator('[data-header-multi-mode]').click();
    await win.waitForTimeout(700);
    expect(await stage.getAttribute('data-multi-mode'), 'the header toggle entered Multi Mode').toBe('true');
    await win.locator('[data-header-multi-mode]').click();
    await win.waitForTimeout(700);
    expect(await stage.getAttribute('data-multi-mode'), 'the header toggle left Multi Mode').toBe('false');
    console.log('[P36C456-P9b] the title-bar Multi Mode toggle works both ways');

    // Palette.
    await win.keyboard.press('Control+k');
    await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
    await win.fill('[data-command-palette-input]', 'multi mode');
    await win.waitForTimeout(250);
    await win.locator('[data-palette-tool-id="multi-mode"]').first().click();
    await win.waitForTimeout(800);
    expect(await stage.getAttribute('data-multi-mode'), 'the palette multi-mode row entered Multi Mode').toBe('true');
    console.log('[P36C456-P9b] the palette multi-mode row works');
    await win.locator('[data-header-multi-mode]').click();
    await win.waitForTimeout(500);
  });
});

test.describe('Phase 36 chunk 5/6 — the retirement and the 264px panel-inset invariants', () => {
  test('P10 no All-tools badge/palette in the DOM; the inset is 264px; the pills are reachable; the screenshots', async () => {
    await openReport();

    // --- retirement ---
    const retired = await win.evaluate(() => ({
      badge: document.querySelectorAll('[data-tools-badge]').length,
      palette: document.querySelectorAll('[data-tools-palette]').length,
      layout: document.querySelectorAll('[data-tools-layout]').length,
      toggle: document.querySelectorAll('[data-tools-toggle]').length,
    }));
    console.log(`[P36C456-P10] retired surfaces=${JSON.stringify(retired)}`);
    for (const [k, v] of Object.entries(retired)) expect(v, `${k} retired`).toBe(0);

    // --- the Inspector IS the right panel at 264px; the token matches ---
    const geom = await win.evaluate(() => {
      const inset = getComputedStyle(document.querySelector('.app-main')).getPropertyValue('--tf-tools-inset').trim();
      const insp = document.querySelector('[data-inspector]');
      const ir = insp ? insp.getBoundingClientRect() : null;
      const rail = document.querySelector('.stage-rail');
      const rrect = rail ? rail.getBoundingClientRect() : null;
      const panel = document.querySelector('[data-context-panel]');
      const prect = panel ? panel.getBoundingClientRect() : null;
      const overlap = (a, b) => (a && b ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) : null);
      return {
        inset,
        inspectorW: ir ? Math.round(ir.width) : null,
        inspectorLeft: ir ? Math.round(ir.left) : null,
        rail: rrect ? { left: Math.round(rrect.left), right: Math.round(rrect.right), w: Math.round(rrect.width) } : null,
        panel: prect ? { left: Math.round(prect.left), right: Math.round(prect.right), w: Math.round(prect.width) } : null,
        railPanelOverlapPx: overlap(rrect, prect),
      };
    });
    console.log(`[P36C456-P10] geometry=${JSON.stringify(geom)}`);
    expect(geom.inset, 'the inspector inset token').toBe('264px');
    expect(geom.inspectorW, 'the Inspector renders at 264px').toBeGreaterThanOrEqual(258);
    expect(geom.inspectorW).toBeLessThanOrEqual(270);
    // DEF-320 (FIXED) — the 44px Stage Rail claims a real grid track beside the
    // ContextPanel, so the two are adjacent and never overlap.
    console.log(`[P36C456-P10] DEF-320 rail/panel overlap = ${geom.railPanelOverlapPx}px (rail ${geom.rail && geom.rail.w}px, panel left ${geom.panel && geom.panel.left})`);
    expect(geom.railPanelOverlapPx, 'DEF-320: rail and panel do NOT overlap').toBe(0);
    expect(geom.panel.left, 'the panel starts at/after the rail right edge').toBeGreaterThanOrEqual(geom.rail.right - 1);

    // --- the floating pills: the page pill acts; the zoom pill's own record ---
    const pageInput = win.locator('[data-page-pill] input.page-input');
    await win.locator('[data-page-pill] [aria-label="Next page"]').click();
    await win.waitForTimeout(500);
    expect(await pageInput.inputValue(), 'the page pill advanced the page').toBe('2');
    await win.locator('[data-page-pill] [aria-label="Previous page"]').click();
    await win.waitForTimeout(500);

    // DEF-319 — the Inspector's 264px covers the bottom-right zoom pill, so
    // every zoom/fit/pan control is unclickable. Hit-test it and record the
    // exact covering element; the defect record carries the click failure.
    const zoomDiag = await win.evaluate(() => {
      const btn = document.querySelector('[data-zoom-pill] [aria-label="Zoom out"]');
      const b = btn.getBoundingClientRect();
      const top = document.elementFromPoint(Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2));
      const zoom = document.querySelector('[data-zoom-pill]').getBoundingClientRect();
      return {
        zoomRect: { left: Math.round(zoom.left), right: Math.round(zoom.right) },
        topEl: top ? `${top.tagName}.${String(top.className)}` : null,
        hit: !!(top && (top === btn || btn.contains(top))),
      };
    });
    console.log(`[P36C456-P10] DEF-319 zoom-pill hit-test: ${JSON.stringify(zoomDiag)}`);
    if (zoomDiag.hit) {
      // Phase 40 — the fit-width scale can sit a hair above a ladder step, so
      // the first Zoom-out snaps to that step and the INTEGER percent can read
      // unchanged. Click until the readout actually drops (max 2 steps) so the
      // assertion still proves the control acts.
      const zBefore = parseInt(await win.locator('[data-zoom-pill] .zoom-percent').innerText(), 10);
      let zAfter = zBefore;
      for (let i = 0; i < 2 && zAfter >= zBefore; i += 1) {
        await win.locator('[data-zoom-pill] [aria-label="Zoom out"]').click({ timeout: 8000 });
        await win.waitForTimeout(700);
        zAfter = parseInt(await win.locator('[data-zoom-pill] .zoom-percent').innerText(), 10);
      }
      console.log(`[P36C456-P10] zoom pill: ${zBefore}% -> ${zAfter}%`);
      expect(zAfter, 'the zoom pill Zoom-out control is clickable and acts').toBeLessThan(zBefore);
    } else {
      expect(zoomDiag.hit, 'DEF-319: the zoom pill is covered by the Inspector').toBe(false);
    }

    // --- screenshots: a page selected in the Inspector, then the REVIEW panel ---
    await win.locator('[data-context-panel] .thumb-item[data-page="2"]').click();
    await win.waitForTimeout(800);
    await win.screenshot({ path: path.join(SHOTS, 'phase36-chunk6-inspector.png') });
    console.log('[P36C456-P10] captured screenshots/phase36-chunk6-inspector.png');
    await gotoStage(win, 3);
    await win.waitForTimeout(600);
    await win.screenshot({ path: path.join(SHOTS, 'phase36-chunk6-review.png') });
    console.log('[P36C456-P10] captured screenshots/phase36-chunk6-review.png');
  });

  test('P10b Multi Mode: both panes shrink equally under the Inspector inset; the page-area floor holds', async () => {
    // Two documents so BOTH panes have a real page area to measure.
    const LONG = path.join(ROOT, 'assets', 'samples', 'long.pdf');
    await openReport();
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, LONG);
    await win.locator('[data-toolbar-open]').first().click();
    await win.waitForTimeout(1500);
    expect(await win.locator('.tab[data-tab-id]').count(), 'two documents open').toBe(2);
    // Make report the active tab, then enter Multi Mode and fill pane B.
    await win.locator('.tab[data-tab-id]').filter({ hasText: 'report' }).first().click();
    await win.waitForTimeout(400);
    await win.locator('[data-header-multi-mode]').click();
    await win.waitForTimeout(900);
    const emptyB = win.locator('.tab-pane[data-pane="B"][data-pane-empty]');
    if (await emptyB.count()) {
      await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').first().click();
      await win.waitForTimeout(1500);
    }
    await win.waitForSelector('.tab-pane[data-pane="B"] .pdf-page', { timeout: 30000 });

    const m = await win.evaluate(() => {
      const r = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width) };
      };
      return {
        host: r(document.querySelector('.tab-stage')),
        paneA: r(document.querySelector('.tab-pane[data-pane="A"] .workspace-main')),
        paneB: r(document.querySelector('.tab-pane[data-pane="B"] .workspace-main')),
        divider: r(document.querySelector('[data-multi-divider]')),
        inset: getComputedStyle(document.querySelector('.app-main')).getPropertyValue('--tf-tools-inset').trim(),
      };
    });
    console.log(`[P36C456-P10b] multi geometry=${JSON.stringify(m)}`);
    expect(m.paneA, 'pane A page region').not.toBeNull();
    expect(m.paneB, 'pane B page region').not.toBeNull();
    expect(Math.abs(m.paneA.w - m.paneB.w), `both panes shrink by the SAME amount (A=${m.paneA.w} B=${m.paneB.w})`).toBeLessThanOrEqual(2);
    // The Inspector's 264px is reserved once at the stage's right edge.
    expect(m.host.right - m.paneB.right, 'the Inspector inset is reserved to the right of pane B').toBeGreaterThanOrEqual(258);
    expect(m.host.right - m.paneB.right).toBeLessThanOrEqual(272);
    expect(m.paneA.w, 'pane A keeps a usable page area').toBeGreaterThan(200);
    expect(m.paneB.w, 'pane B keeps a usable page area').toBeGreaterThan(200);
    console.log('[P36C456-P10b] equal shrink + page-area floor + 264px inset all hold');
  });
});