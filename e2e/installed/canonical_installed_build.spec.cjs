// CANONICAL installed-build verification (THE installed-build spec).
//
// Convention (2026-09-21): ONE canonical installed-build spec, repointed never.
// It reads the EXPECTED version from package.json, so it needs no edit per
// release; per-version `release_1_1x_installed.spec.cjs` gates are archived.
//
// Lives under e2e/installed/ because that is the documented home for
// installed-app specs and is EXCLUDED from the standard suite by
// playwright.config.js (testIgnore: e2e/installed/**). Run it only via:
//   npx playwright test --config=e2e/installed/playwright.installed.config.js
// or directly:
//   npm.cmd run test:e2e -- --config=e2e/installed/playwright.installed.config.js
//
// Test order (serial): the VERSION GATE runs first; a mismatch aborts the
// remaining tests. Then the CORE feature set that must never regress:
//   0. Help > About: package.json version + a non-empty What's New highlight
//   1. annotation toolbar + edit toggle guard (DEF-214)
//   2. text panel's live field
//   3. annotation colour picker dismissal
//   4. watermark apply / delete
//   5. title-bar file group
//   6. animations toggle
//   7. flush canvas
//
// The installed path can be overridden with TFLEX_PACKAGED_EXE.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');
const { hardClose, dismissUpdatePrompt, openSamplePath, armAnnotationTool, gotoStage } = require('../lib/helpers.cjs');

// Read the expected version from package.json - never hardcode it.
const EXPECTED = require('../../package.json').version;
const PACKAGED_EXE =
  process.env.TFLEX_PACKAGED_EXE ||
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'TFlex', 'TFlex.exe');

const mm = (v) => String(v).trim().split('.').slice(0, 3).join('.');
const log = (label, obj) => console.log(`[canonical|${label}] ${JSON.stringify(obj)}`);

function fileVersionOf(exe) {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.FileVersion"`,
      { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return out.trim();
  } catch (e) {
    return `ERROR: ${e.message}`;
  }
}

test.describe.configure({ mode: 'serial' });
test.setTimeout(180000);

async function withApp(fn, label) {
  const app = await launchApp([], null, PACKAGED_EXE);
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  await win.waitForSelector('.sample-card', { timeout: 40000 });
  await dismissUpdatePrompt(win);
  try {
    return await fn(win, pageErrors, app);
  } finally {
    await hardClose(app, label);
  }
}

async function openReport(app, win) {
  await openSamplePath(win, app, getSamplePath('report.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(600);
}

async function dragOnPage(win, fx, fy, dxPx = 190, dyPx = 60) {
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(40, Math.min(pg.x + pg.width * fx, vp.w - 240));
  const y = Math.max(40, Math.min(pg.y + pg.height * fy, vp.h - 110));
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dxPx, y + dyPx, { steps: 6 });
  await win.mouse.up();
}

const annModels = (win) => win.evaluate(() => {
  const st = window.tflexDiagnostics().engineState;
  if (!st || !st.annotations) return [];
  return st.annotations.map((a) => ({
    id: a.id, kind: a.kind, text: a.text ?? a.content ?? null, color: a.color ?? null,
  }));
});

async function waitForAnn(win, pred, timeout = 15000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeout) {
    last = (await annModels(win)).find(pred) ?? last;
    if (last !== null && pred(last)) return last;
    await win.waitForTimeout(150);
  }
  return last;
}

// STAGES retired the All-tools palette (`[data-tools-toggle]` /
// `[data-tools-palette]`). The tool-browsing surface is the Command Palette now
// (Ctrl+K); a tool row carries `data-palette-tool-id`.
async function openCommandPalette(win) {
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette]', { state: 'visible', timeout: 15000 });
}

async function runPaletteTool(win, id, query) {
  await openCommandPalette(win);
  await win.fill('[data-command-palette-input]', query);
  await win.waitForTimeout(300);
  await win.locator(`[data-palette-tool-id="${id}"]`).first().click();
}

async function toastText(win, text) {
  await win.waitForFunction((want) => Array.from(document.querySelectorAll('.toast .toast-text'))
    .some((t) => (t.textContent || '').trim() === want), text, { timeout: 15000 });
}

// ===========================================================================
// VERSION GATE (first; serial - a mismatch aborts the rest)
// ===========================================================================
test('VERSION GATE: installed FileVersion and app.getVersion() match package.json', async () => {
  const fv = fileVersionOf(PACKAGED_EXE);
  await withApp(async (win, _pageErrors, app) => {
    const av = await app.evaluate(({ app: a }) => a.getVersion());
    log('version', { packageJson: EXPECTED, exeFileVersion: fv, appGetVersion: av, exe: PACKAGED_EXE });
    expect(mm(fv), 'installed exe FileVersion (from package.json expected)').toBe(mm(EXPECTED));
    expect(av, 'installed app.getVersion()').toBe(EXPECTED);
  }, 'canonical-version');
});

// ===========================================================================
// ABOUT: Help > About reports the package.json version and What's New
// ===========================================================================
test("ABOUT: Help > About reports the package.json version and a non-empty What's New highlight", async () => {
  await withApp(async (win, pageErrors) => {
    // Help > About TFlex via the title-bar application menu (real user action).
    await win.click('[data-menu-button]');
    await win.waitForSelector('[data-menu-popover]', { timeout: 10000 });
    await win.click('[data-menu-action="about"]');
    await win.waitForSelector('[data-about-dialog]:visible', { timeout: 15000 });

    const version = (await win.locator('[data-about-version]').innerText()).trim();
    const highlights = win.locator('[data-whats-new-highlight]');
    const count = await highlights.count();
    const texts = (await highlights.allInnerTexts()).map((t) => t.trim());
    log('about', { version, highlightCount: count, firstHighlight: texts[0] ?? '' });

    expect(version, '[data-about-version] equals the package.json version').toBe(EXPECTED);
    expect(count, "at least one What's New highlight line").toBeGreaterThan(0);
    for (const t of texts) expect(t.length, "What's New highlight has non-empty text").toBeGreaterThan(0);
    expect(pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, 'canonical-about');
});

// ===========================================================================
// 1. workspace chrome + annotation toolbar reachability + edit toggle guard
// ===========================================================================
// STAGES retired the single-mode command row (and its `.ann-toolbar`). The
// workspace chrome that stands in for it is the Stage Rail plus the per-stage
// Action Dock; the annotation toolbar is re-parented into the REVIEW dock's
// Annotate flyout. Phase 37 (item 13) retired the EDIT dock's `editMode` verb:
// the EDIT stage itself is now the edit-mode switch. The assertion INTENT is
// unchanged: the single-mode command surface exists and is reachable, and the
// edit toggle arms/disarms the edit toolbar.
test('CORE 1: Stage Rail chrome reachable; annotation toolbar reachable; edit toggle arms/disarms', async () => {
  await withApp(async (win, pageErrors, app) => {
    await openReport(app, win);

    // The Stage Rail is the single-mode workspace chrome now.
    const rail = win.locator('[data-stage-rail]');
    await rail.waitFor({ timeout: 15000, state: 'visible' });
    const box = await rail.boundingBox();
    expect(box, '[data-stage-rail] has a box').not.toBeNull();
    expect(box.height, '[data-stage-rail] visible column').toBeGreaterThan(0);
    const stages = await win.$$eval('[data-stage-rail] [data-stage]', (els) =>
      els.map((e) => e.getAttribute('data-stage')));
    expect(stages, 'the four stages are reachable from the rail').toEqual(['pages', 'edit', 'review', 'deliver']);

    // The annotation toolbar's new home: the REVIEW dock's Annotate flyout.
    await gotoStage(win, 3);
    await win.locator('[data-dock-verb="annotate"]').first().click();
    await win.waitForSelector('[data-annotation-flyout]', { state: 'visible', timeout: 10000 });
    expect(await win.locator('[data-annotation-flyout] .ann-toolbar').isVisible(),
      'annotation toolbar reachable in the REVIEW flyout').toBe(true);

    // Phase 37 (item 13): the EDIT stage IS the edit-mode switch - entering it
    // enables edit mode and mounts the edit toolbar; there is no `editMode` dock
    // verb any more. The assertion INTENT is unchanged: the edit toggle
    // arms/disarms the edit toolbar.
    await gotoStage(win, 2);
    expect(await win.locator('[data-dock-verb="editMode"]').count(),
      'no editMode dock verb (the stage is the switch)').toBe(0);
    await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
    expect(await win.locator('.edit-toolbar').isVisible(), 'edit toolbar mounted on entering EDIT').toBe(true);
    await gotoStage(win, 1);
    await win.waitForTimeout(500);
    expect(await win.locator('[data-edit-toolbar]').count(), 'edit toolbar disarms on leaving EDIT').toBe(0);
    await gotoStage(win, 2);
    await win.waitForTimeout(500);
    expect(await win.locator('[data-edit-toolbar]').count(), 're-entering EDIT re-arms the edit toolbar').toBe(1);
    expect(pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, 'canonical-core1');
});

// ===========================================================================
// 2. text panel's live field
// ===========================================================================
test('CORE 2: the text panel field is the live editor for a placed annotation', async () => {
  await withApp(async (win, pageErrors, app) => {
    await openReport(app, win);
    await armAnnotationTool(win, 'textbox');
    await dragOnPage(win, 0.3, 0.25, 190, 60);
    await win.waitForSelector('.text-props-panel [data-txt-text]', { timeout: 15000 });
    await win.waitForFunction(() => {
      const ta = document.querySelector('[data-txt-text]');
      return ta !== null && ta.disabled === false;
    }, null, { timeout: 15000 });
    await win.locator('[data-txt-text]').fill('CANON-LIVE');
    await win.locator('[data-txt-text]').blur();
    const a = await waitForAnn(win, (x) => x.kind === 'textbox' && x.text === 'CANON-LIVE', 20000);
    expect(a, 'engine holds the panel-typed text').toBeTruthy();
    expect(await win.locator('.ann-textbox[data-annotation-id]').count(), 'one live textbox overlay').toBe(1);
    expect(pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, 'canonical-core2');
});

// ===========================================================================
// 3. annotation colour picker: opens, dismisses, applies
// ===========================================================================
test('CORE 3: the annotation colour picker opens, dismisses, and applies a colour', async () => {
  await withApp(async (win, pageErrors, app) => {
    await openReport(app, win);
    await armAnnotationTool(win, 'rect');
    await dragOnPage(win, 0.3, 0.3, 180, 80);
    const rect = await waitForAnn(win, (a) => a.kind === 'rect', 15000);
    expect(rect, 'rect placed').toBeTruthy();
    await win.waitForTimeout(500);
    const bb = await win.locator(`.ann-shape[data-annotation-id="${rect.id}"]`).boundingBox();
    await win.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await win.waitForSelector('[data-content-action-bar="ann-rect"]', { timeout: 10000 });

    // A SINGLE click opens the picker.
    await win.click('[data-ann-color-box]');
    await win.waitForSelector('[data-color-popover]', { timeout: 8000 });
    expect(await win.locator('[data-color-popover]').count(), 'one click opens the picker').toBeGreaterThan(0);
    // Escape dismisses it (the long-standing dismissal contract, stable
    // across releases - the close-on-apply behaviour is newer).
    await win.keyboard.press('Escape');
    await win.waitForSelector('[data-color-popover]', { state: 'detached', timeout: 8000 });
    expect(await win.locator('[data-color-popover]').count(), 'Escape dismissed the picker').toBe(0);

    // Reopen and pick a colour: it reaches the engine. (Escape may also drop
    // the selection, so re-select the shape first.)
    if ((await win.locator('[data-ann-color-box]').count()) === 0) {
      const bb2 = await win.locator(`.ann-shape[data-annotation-id="${rect.id}"]`).boundingBox();
      await win.mouse.click(bb2.x + bb2.width / 2, bb2.y + bb2.height / 2);
      await win.waitForSelector('[data-content-action-bar="ann-rect"]', { timeout: 10000 });
    }
    await win.click('[data-ann-color-box]');
    await win.waitForSelector('[data-color-popover]', { timeout: 8000 });
    await win.click('[data-palette-built-in="pink"]');
    const pink = await waitForAnn(win, (a) => a.id === rect.id && a.color === 'pink', 10000);
    expect(pink, 'pink applied to the selected annotation').toBeTruthy();
    expect(pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, 'canonical-core3');
});

// ===========================================================================
// 4. watermark apply / delete
// ===========================================================================
test('CORE 4: watermark apply then delete round-trips', async () => {
  await withApp(async (win, pageErrors, app) => {
    await openReport(app, win);
    // The tool-browsing surface is the Command Palette now (the All-tools
    // palette is retired); watermark's home is the palette.
    await runPaletteTool(win, 'watermark', 'Watermark');
    await win.locator('[data-watermark-dialog]').waitFor({ state: 'visible', timeout: 10000 });
    await win.locator('[data-watermark-text]').fill('CONFIDENTIAL');
    await win.locator('[data-watermark-confirm]').click();
    await toastText(win, 'Watermark applied.');
    await runPaletteTool(win, 'watermark', 'Watermark');
    await win.locator('[data-watermark-applied="wm-1"]').waitFor({ state: 'visible', timeout: 15000 });
    await win.locator('[data-watermark-delete="wm-1"]').click();
    await toastText(win, 'Watermark deleted.');
    await win.locator('[data-watermark-applied="wm-1"]').waitFor({ state: 'detached', timeout: 15000 });
    const wm = await win.evaluate(async () => {
      const id = window.tflexDiagnostics().engineDocId;
      const g = await window.tflex.engine.getWatermarks(id);
      return g.ok ? g.value.map((w) => w.id) : { err: g.error };
    });
    expect(Array.isArray(wm), 'getWatermarks ok').toBe(true);
    expect(wm).not.toContain('wm-1');
    expect(pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, 'canonical-core4');
});

// ===========================================================================
// 5. title-bar file group
// ===========================================================================
test('CORE 5: title-bar file group present; Save reflects the modified state', async () => {
  await withApp(async (win, pageErrors, app) => {
    await openReport(app, win);
    const open = win.locator('[data-toolbar-open]');
    const save = win.locator('[data-toolbar-save]');
    const saveAs = win.locator('[data-toolbar-save-as]');
    expect(await open.isVisible(), 'Open visible').toBe(true);
    expect(await save.isVisible(), 'Save visible').toBe(true);
    expect(await saveAs.isVisible(), 'Save As visible').toBe(true);
    expect(await save.isDisabled(), 'Save disabled on a clean document').toBe(true);
    await armAnnotationTool(win, 'rect');
    await dragOnPage(win, 0.3, 0.3, 160, 70);
    await waitForAnn(win, (a) => a.kind === 'rect', 15000);
    await win.waitForFunction(() => document.querySelector('[data-toolbar-save]')?.disabled === false, null, { timeout: 10000 });
    expect(await save.isDisabled(), 'Save enabled once the document is modified').toBe(false);
    expect(pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, 'canonical-core5');
});

// ===========================================================================
// 6. animations toggle
// ===========================================================================
test('CORE 6: the animations preference toggles the root data-animations hook', async () => {
  await withApp(async (win, pageErrors) => {
    const rootFlag = () => win.evaluate(() => document.documentElement.getAttribute('data-animations'));
    expect(await rootFlag(), 'animations on by default').toBe('on');
    await win.click('[data-open-preferences]');
    await win.waitForSelector('[data-prefs-dialog]', { timeout: 8000 });
    const box = win.locator('[data-prefs-animations]');
    await box.waitFor({ state: 'visible', timeout: 8000 });
    await box.click();
    await win.waitForFunction(() => document.documentElement.getAttribute('data-animations') === 'off', null, { timeout: 8000 });
    expect(await rootFlag(), 'toggle off').toBe('off');
    await box.click();
    await win.waitForFunction(() => document.documentElement.getAttribute('data-animations') === 'on', null, { timeout: 8000 });
    expect(await rootFlag(), 'toggle back on').toBe('on');
    await win.locator('[data-prefs-dialog] .sheet-close').click();
    await win.waitForSelector('[data-prefs-dialog]', { state: 'hidden', timeout: 8000 });
    expect(pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, 'canonical-core6');
});

// ===========================================================================
// 7. flush canvas + the Inspector inset contract
// ===========================================================================
// STAGES made the Inspector the default-open right panel, so the scroller is
// inset on its right by the Inspector width (--tf-tools-inset = 264px). That
// inset is the CURRENT contract, not a gutter: the canvas content stays flush
// (no padding/margin on .document-content, no padding on the scroller) and the
// page area is the canvas minus the Inspector.
test('CORE 7: the canvas is flush and the page area is inset by the Inspector', async () => {
  await withApp(async (win, pageErrors, app) => {
    await openReport(app, win);
    await win.evaluate(() => { const sc = document.querySelector('.document-scroller'); if (sc) sc.scrollTop = 0; });
    await win.waitForTimeout(500);
    const m = await win.evaluate(() => {
      const sc = document.querySelector('.document-scroller');
      const ct = document.querySelector('.document-content');
      const slot = document.querySelector('.page-slot[data-page="1"]');
      const main = document.querySelector('.workspace-main');
      const insp = document.querySelector('[data-inspector]');
      const cs = (el) => {
        const s = getComputedStyle(el);
        return { pt: s.paddingTop, pb: s.paddingBottom, pl: s.paddingLeft, pr: s.paddingRight,
          mt: s.marginTop, mb: s.marginBottom, ml: s.marginLeft, mr: s.marginRight };
      };
      const scR = sc.getBoundingClientRect();
      const slR = slot.getBoundingClientRect();
      const mainR = main.getBoundingClientRect();
      const inspR = insp ? insp.getBoundingClientRect() : null;
      return { theme: document.documentElement.dataset.theme, scroller: cs(sc), content: cs(ct),
        inset: getComputedStyle(document.querySelector('.app-main')).getPropertyValue('--tf-tools-inset').trim(),
        scrollerWidth: Math.round(scR.width), mainWidth: Math.round(mainR.width),
        inspectorWidth: inspR ? Math.round(inspR.width) : null,
        slotTopGap: +(slR.top - scR.top).toFixed(2) };
    });
    log('flush', m);
    // The canvas itself stays flush: the scroller carries no padding and the
    // content wrapper carries no padding or margin.
    for (const k of ['pt', 'pb', 'pl', 'pr', 'mt', 'mb', 'ml']) {
      expect(m.scroller[k], `.document-scroller ${k} is 0`).toMatch(/^0(px)?$/);
    }
    for (const [k, v] of Object.entries(m.content)) {
      expect(v, `.document-content ${k} is 0`).toMatch(/^0(px)?$/);
    }
    // The Inspector is default-open: the scroller's right inset IS the
    // Inspector width, and the page area is the canvas minus that inset.
    expect(m.inset, 'the Inspector inset token').toBe('264px');
    expect(m.scroller.mr, '.document-scroller margin-right is the Inspector inset').toBe(m.inset);
    expect(m.inspectorWidth, 'the Inspector renders at the inset width').toBeGreaterThanOrEqual(258);
    expect(m.inspectorWidth).toBeLessThanOrEqual(270);
    expect(m.mainWidth - m.scrollerWidth, 'the scroller width is the canvas minus the Inspector').toBeGreaterThanOrEqual(255);
    expect(m.mainWidth - m.scrollerWidth).toBeLessThanOrEqual(272);
    expect(Math.abs(m.slotTopGap), 'page slot flush with the scroller top').toBeLessThanOrEqual(1);
    expect(pageErrors, 'zero uncaught renderer page errors').toEqual([]);
  }, 'canonical-core7');
});
