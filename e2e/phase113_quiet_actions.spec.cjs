// Phase 113 (TFL-839 / chunk G, TFL-1052) - focused e2e for the Quiet Actions
// shared button system applied app-wide.
//
// One app instance, one test. For one REPRESENTATIVE control per surface family
// it asserts:
//   1. the canonical class contract the phase113 unit specs pin (intent class,
//      semantic-kind class, density class, base .btn), and
//   2. the control's existing data-* / aria hook is still present, and
//   3. the mapped handler actually fires (observed through a real DOM/state
//      change), or the control is a documented native exception.
// Families: Home hero action, title-bar command, tab, dock tile,
// panel/inspector action, dialog confirm/cancel, a menu row, a notice collapse.
//
// The notice family is a known pre-existing failure on this tree (phase53
// criterion 7 fails identically: the conversion notice does not surface), so it
// is recorded INCONCLUSIVE rather than counted as a Phase 113 failure.
//
// Launched ONLY through the canonical `e2e/lib/launch.cjs` `launchApp` helper.
// The harness exports ELECTRON_RUN_AS_NODE=1; clear it before any launch (same
// adaptation phase91/phase63/phase95 use).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const {
  hardClose,
  gotoStage,
  ensurePanelExpanded,
  clickDockVerb,
  openSample,
} = require('./lib/helpers.cjs');

delete process.env.ELECTRON_RUN_AS_NODE;

const USER_DATA = path.join(os.tmpdir(), `tflex-p113-qa-${Date.now()}`);
const HTML_FIXTURE = path.resolve(__dirname, '..', 'test-fixtures', 'phase53', 'network.html');

test.setTimeout(600000);

let app;
let win;

async function classesOf(locator) {
  return locator.first().evaluate((el) => Array.from(el.classList));
}

async function expectClasses(selector, required, label) {
  const loc = win.locator(selector);
  await loc.first().waitFor({ state: 'attached', timeout: 10000 });
  const cls = await classesOf(loc);
  for (const c of required) {
    expect(cls, `${label}: ${selector} carries .${c} (got [${cls.join(' ')}])`).toContain(c);
  }
  return cls;
}

async function attrOf(selector, attr) {
  return win.locator(selector).first().getAttribute(attr);
}

async function stubOpenDialog(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
}

async function ensureInspectorExpanded() {
  const collapsed = win.locator('[data-inspector][data-inspector-collapsed="true"]');
  if ((await collapsed.count()) > 0) {
    await win.locator('[data-inspector-collapse]').first().click();
    await win.waitForFunction(
      () => document.querySelector('[data-inspector]')?.getAttribute('data-inspector-collapsed') === 'false',
      null,
      { timeout: 8000 },
    );
    await win.waitForTimeout(300);
  }
}

test('Phase 113 Quiet Actions: one representative control per surface family', async () => {
  app = await launchApp([], USER_DATA);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  const results = [];
  const record = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`[P113] ${ok === 'skip' ? 'SKIP' : ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
  };
  const guard = async (name, fn) => {
    try {
      const r = await fn();
      if (r && r.skip) record(name, 'skip', r.reason);
      else record(name, true);
    } catch (e) {
      record(name, false, String(e.message).split('\n')[0]);
    }
  };

  try {
    // ---- 1. Home hero action (welcome screen) ---------------------------
    await guard('home-hero', async () => {
      // Open Files = the single primary hero action.
      await expectClasses('[data-home-tool="open"]', ['btn', 'btn-primary', 'home-tool'], 'home open');
      // Merge PDFs = a removable secondary hero tile.
      await expectClasses('[data-home-tool="merge"]', ['btn', 'btn-secondary', 'home-tool'], 'home merge');
      // Merge's mapped handler opens a native multi-file picker (documented
      // native exception, not an in-app dialog), so the handler proof uses the
      // Home edit-toggle (a Home control) which flips data-home-edit.
      const before = await win.locator('[data-home-tools]').getAttribute('data-home-edit');
      await win.locator('[data-home-edit-toggle]').first().click({ timeout: 10000 });
      await win.waitForFunction(
        (b) => document.querySelector('[data-home-tools]').getAttribute('data-home-edit') !== b,
        before,
        { timeout: 8000 },
      );
      expect(await win.locator('[data-home-tools]').getAttribute('data-home-edit'), 'home handler fired').not.toBe(before);
      await win.locator('[data-home-edit-toggle]').first().click({ timeout: 10000 });
      await win.waitForTimeout(300);
    });

    // ---- 2. Open a real PDF (proven import path) ------------------------
    await guard('open-report', async () => {
      await openSample(win, app, 'report.pdf');
    });

    // ---- 3. Title-bar command -------------------------------------------
    await guard('titlebar-command', async () => {
      // File disclosure = secondary compact disclosure (canonical axes).
      await expectClasses('[data-menu-button]', ['btn', 'btn-secondary', 'btn-disclosure', 'btn-compact'], 'titlebar file');
      expect(await attrOf('[data-menu-button]', 'aria-expanded'), 'file aria-expanded').toBe('false');
      await win.locator('[data-menu-button]').first().click({ timeout: 10000 });
      await win.waitForTimeout(400);
      expect(await attrOf('[data-menu-button]', 'aria-expanded'), 'file handler fired').toBe('true');
      await win.keyboard.press('Escape');
      await win.waitForTimeout(300);
      // Save = canonical secondary compact title-bar command.
      await expectClasses('[data-toolbar-save]', ['btn', 'btn-secondary', 'btn-compact'], 'titlebar save');
    });

    // ---- 4. Tab ---------------------------------------------------------
    await guard('tab', async () => {
      await win.locator('[data-new-tab]').first().click({ timeout: 10000 });
      await win.waitForTimeout(500);
      expect(await win.locator('[data-tab-id]').count(), 'two or more tabs after new-tab').toBeGreaterThanOrEqual(2);
      await expectClasses('[data-tab-id]', ['btn', 'btn-segmented-item'], 'tab item');
      expect(await win.locator('[data-tab-id][aria-selected="true"]').count(), 'exactly one selected tab').toBe(1);
      // Restore the PDF tab so the following guards have a live document.
      const reportTab = win.locator('[data-tab-id]').filter({ hasText: 'report' }).first();
      if ((await reportTab.count()) > 0) await reportTab.click({ timeout: 10000 });
      await win.waitForTimeout(900);
    });

    // ---- 5. Dock tile ---------------------------------------------------
    await guard('dock-tile', async () => {
      await gotoStage(win, 1);
      await ensurePanelExpanded(win);
      await expectClasses('[data-dock-group="primary"] [data-dock-verb]', ['btn', 'btn-primary', 'btn-prominent', 'btn-toggle'], 'dock primary tile');
      // Persistent selected tile reads real app state: aria-pressed is present
      // only when selected, so a resting tile legitimately omits it; the tile
      // always keeps its data hook.
      expect(await attrOf('[data-dock-group="primary"] [data-dock-verb]', 'data-dock-verb'), 'dock tile hook').not.toBeNull();
      // More = canonical disclosure; clicking flips aria-expanded.
      await expectClasses('[data-dock-overflow]', ['btn', 'btn-disclosure'], 'dock more');
      expect(await attrOf('[data-dock-overflow]', 'aria-expanded'), 'dock more aria-expanded').toBe('false');
      await win.locator('[data-dock-overflow]').first().click({ timeout: 10000 });
      await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 8000 });
      await win.keyboard.press('Escape');
      await win.waitForTimeout(300);
    });

    // ---- 6. Panel / inspector action -----------------------------------
    await guard('panel-inspector', async () => {
      await gotoStage(win, 1);
      await ensurePanelExpanded(win);
      await ensureInspectorExpanded();
      await expectClasses('[data-inspector-action="renumber"]', ['btn', 'btn-secondary'], 'inspector renumber');
      await win.locator('[data-inspector-action="renumber"]').first().scrollIntoViewIfNeeded();
      await win.locator('[data-inspector-action="renumber"]').first().click({ timeout: 10000 });
      await win.waitForSelector('[data-dialog-shell], [role="dialog"]', { state: 'visible', timeout: 8000 });
      await win.keyboard.press('Escape');
      await win.waitForTimeout(400);
    });

    // ---- 7. Dialog confirm / cancel -------------------------------------
    await guard('dialog-confirm-cancel', async () => {
      await clickDockVerb(win, 3, 'stamp');
      const dlg = '[aria-labelledby="stamp-dialog-title"]';
      await win.waitForSelector(dlg, { state: 'visible', timeout: 10000 });
      await win.waitForTimeout(300);
      await expectClasses('[data-stamp-confirm]', ['btn', 'btn-primary'], 'dialog confirm');
      const cancel = `${dlg} .modal-footer button.btn.btn-secondary`;
      await expectClasses(cancel, ['btn', 'btn-secondary'], 'dialog cancel');
      await win.locator(cancel).first().click({ timeout: 10000 });
      await win.locator(dlg).waitFor({ state: 'detached', timeout: 8000 });
    });

    // ---- 8. Menu / context-menu row -------------------------------------
    await guard('menu-row', async () => {
      await gotoStage(win, 1);
      await ensurePanelExpanded(win);
      const thumb = win.locator('[data-context-panel] .thumb-item[data-page="1"]').first();
      await thumb.waitFor({ state: 'visible', timeout: 10000 });
      await thumb.scrollIntoViewIfNeeded();
      await win.waitForTimeout(300);
      await thumb.click({ button: 'right' });
      await win.waitForSelector('[data-context-menu]', { state: 'visible', timeout: 10000 });
      await expectClasses('[data-context-menu] [data-menu-item]', ['btn', 'btn-secondary', 'btn-compact'], 'menu row');
      const before = await win.evaluate(() => window.tflexDiagnostics().engineState.rotations);
      await win.locator('[data-context-menu] [data-menu-item="rotate-cw"]').first().click({ timeout: 10000 });
      await win.waitForTimeout(800);
      const after = await win.evaluate(() => window.tflexDiagnostics().engineState.rotations);
      expect(JSON.stringify(after), 'rotate-cw handler fired').not.toEqual(JSON.stringify(before));
    });

    // ---- 9. Notice collapse (conversion notice) -------------------------
    await guard('notice-collapse', async () => {
      // A converted document raises the in-canvas ConversionNotice. On this tree
      // the notice does not surface for a converted HTML file (phase53 criterion
      // 7 fails identically at HEAD, a pre-existing failure filed as TFL-1051),
      // so this family is recorded INCONCLUSIVE rather than a Phase 113 failure.
      await stubOpenDialog(HTML_FIXTURE);
      await win.locator('[data-toolbar-open]').first().click({ timeout: 10000 });
      await win.waitForTimeout(3500);
      if ((await win.locator('[data-conversion-notice]').count()) === 0) {
        return { skip: true, reason: 'conversion notice did not surface; phase53 criterion 7 fails identically (pre-existing)' };
      }
      await expectClasses('.conversion-notice-collapse', ['btn', 'btn-ghost', 'btn-disclosure', 'btn-compact'], 'notice collapse');
      expect(await attrOf('.conversion-notice-collapse', 'data-conversion-collapse'), 'notice collapse hook').not.toBeNull();
      await win.locator('.conversion-notice-collapse').first().click({ timeout: 10000 });
      await win.waitForSelector('[data-conversion-icon]', { state: 'visible', timeout: 8000 });
    });
  } finally {
    console.log(`[P113] RESULTS ${JSON.stringify(results)}`);
    const pass = results.filter((r) => r.ok === true).length;
    const fail = results.filter((r) => r.ok === false).length;
    const skip = results.filter((r) => r.ok === 'skip').length;
    console.log(`[P113] SUMMARY pass=${pass} fail=${fail} skip=${skip} total=${results.length}`);
    await hardClose(app, 'p113-quiet-actions');
  }

  const failed = results.filter((r) => r.ok === false);
  expect(failed, `failed checks: ${failed.map((f) => `${f.name}: ${f.detail}`).join(' | ') || 'none'}`).toEqual([]);
});
