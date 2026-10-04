// TFL-620 (TFL-513-F) — Phase 92 end-to-end inventory sweep + before/after
// screenshots. Phase validation, CONTROL-INDEX sweep.
//
// Opens every adopted dialog/sheet/window surface in the real Electron app
// through the canonical launcher (e2e/lib/launch.cjs -> launchApp), asserts the
// shipped DialogShell structure, the existing root `data-*` hook, the action
// row hierarchy, the canonical field grid / stable validation slot, visible Tab
// focus and a non-interactive disabled control, clicks a representative
// cancel/close action and verifies the surface dismisses, then captures the
// surface in BOTH light and dark themes under screenshots/phase92/.
//
// It is a no-op sweep: dialogs that need input are driven only to their
// validation state or a cancel; no document is confirmed, saved or deleted.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const {
  openSamplePath,
  hardClose,
  gotoStage,
  armSignTool,
  openStandalonePrintWindow,
  closeStandalonePrintWindow,
} = require('./lib/helpers.cjs');

// The harness exports ELECTRON_RUN_AS_NODE=1; leaving it set makes Electron
// exit as Node ("Process failed to launch!").
delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.resolve(__dirname, '..');
const SHOT_DIR = path.join(ROOT, 'screenshots', 'phase92');
const UPDATE_CHANNEL = 'update:statusChanged';

if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Theme control — the header picker is the deterministic path. The keyboard
// accelerator can race the dialog backdrop, so drive the real control.
// ---------------------------------------------------------------------------
async function setTheme(win, theme) {
  for (let i = 0; i < 4; i += 1) {
    const cur = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
    if (cur === theme) return;
    if ((await win.locator('[data-theme-option]').count()) === 0) {
      await win.locator('[data-theme-toggle]').first().click();
      await win.waitForSelector('[data-theme-option]', { state: 'visible', timeout: 5000 });
    }
    await win.locator(`[data-theme-option="${theme}"]`).first().click();
    await win.waitForTimeout(650);
  }
  const cur = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (cur !== theme) throw new Error(`setTheme: expected ${theme}, got ${cur}`);
}

// ---------------------------------------------------------------------------
// Open a registry tool through the Command Palette (Ctrl+K -> row by id).
// ---------------------------------------------------------------------------
async function openPaletteTool(win, id, label) {
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-command-palette-input]').fill(label);
  await win.waitForTimeout(300);
  const row = win.locator(`[data-palette-tool-id="${id}"]`).first();
  await row.waitFor({ state: 'visible', timeout: 6000 });
  const disabled = await row.getAttribute('data-palette-disabled');
  if (disabled === 'true') {
    await win.keyboard.press('Escape');
    throw new Error(`palette entry '${id}' is disabled`);
  }
  await row.click();
  await win.waitForSelector('[data-command-palette-layer]', { state: 'detached', timeout: 6000 }).catch(() => {});
  await win.waitForTimeout(450);
}

// ---------------------------------------------------------------------------
// One DOM read for the structural + hierarchy + grid checks.
// ---------------------------------------------------------------------------
async function readDialogDom(win, rootSel, hookSel) {
  return win.evaluate(({ sel, hook }) => {
    const root = document.querySelector(sel);
    if (!root) return { present: false };
    const hasHook = hook ? (root.matches(hook) || !!root.querySelector(hook)) : true;
    const footer = root.querySelector('.modal-footer, .sheet-footer');
    const buttons = footer
      ? Array.from(footer.querySelectorAll('button')).filter((b) => b.className.includes('btn'))
      : [];
    const primaries = buttons.filter((b) => b.classList.contains('btn-primary'));
    const dangers = buttons.filter((b) => b.classList.contains('btn-danger'));
    const fields = Array.from(root.querySelectorAll('.dlg-field, .modal-field'));
    const dlgGrid = root.querySelectorAll('.dlg-grid').length;
    const dlgField = root.querySelectorAll('.dlg-field').length;
    // The canonical grid labels are `.dlg-label`; the shipped dialogs carry
    // `.modal-field > span` as the label cell. Measure whichever is present.
    const labelEls = Array.from(
      root.querySelectorAll('.dlg-label, .modal-field > span:first-child'),
    );
    const labelLefts = labelEls.map((e) => Math.round(e.getBoundingClientRect().left));
    const statusEl = root.querySelector('.modal-status, .dlg-error');
    const statusMinH = statusEl ? getComputedStyle(statusEl).minHeight : null;
    const disabledControls = Array.from(
      root.querySelectorAll('button[disabled], input[disabled], select[disabled], textarea[disabled]'),
    );
    return {
      present: true,
      className: root.className,
      hasHook,
      hasShell: root.hasAttribute('data-dialog-shell'),
      header: !!root.querySelector('.modal-header, .sheet-header'),
      title: !!root.querySelector('.modal-title, .sheet-title'),
      body: !!root.querySelector('.modal-body, .sheet-body'),
      footerButtons: buttons.map((b) => (b.textContent || '').trim()),
      primaryCount: primaries.length,
      dangerCount: dangers.length,
      lastIsPrimary: buttons.length > 0 && buttons[buttons.length - 1].classList.contains('btn-primary'),
      fieldCount: fields.length,
      dlgGrid,
      dlgField,
      labelLefts,
      statusMinH,
      disabledCount: disabledControls.length,
    };
  }, { sel: rootSel, hook: hookSel });
}

async function readFocus(win, rootSel) {
  return win.evaluate((sel) => {
    const root = document.querySelector(sel);
    const a = document.activeElement;
    if (!root || !a || !root.contains(a)) return { inside: false };
    const cs = getComputedStyle(a);
    return {
      inside: true,
      tag: a.tagName,
      focusVisible: a.matches(':focus-visible'),
      outline: cs.outlineStyle,
      boxShadow: cs.boxShadow,
    };
  }, rootSel);
}
// ---------------------------------------------------------------------------
// Generic per-surface audit + screenshot + representative dismiss.
// ---------------------------------------------------------------------------
async function runSurface(win, results, name, theme, cfg) {
  const fails = [];
  const chk = (cond, msg) => { if (!cond) fails.push(msg); };
  let dom = null;
  try {
    await win.waitForSelector(cfg.root, { state: 'visible', timeout: cfg.timeout || 15000 });
    await win.waitForTimeout(cfg.settle || 300);
    dom = await readDialogDom(win, cfg.root, cfg.hook);
    chk(dom.present, 'root not present');
    if (cfg.shell) {
      chk(dom.hasShell, '[data-dialog-shell] missing');
      chk(dom.header, 'header missing');
      chk(dom.title, 'title missing');
      chk(dom.body, 'body missing');
    }
    if (cfg.hook) {
      chk(dom.hasHook, `existing root hook ${cfg.hook} missing`);
    }
    if (dom.footerButtons && dom.footerButtons.length > 0) {
      chk(dom.primaryCount <= 1, `more than one primary action (${dom.primaryCount})`);
      // A destructive confirm uses variant 'danger' and is the row's emphasis,
      // so a 2+ button row carries either one primary or one danger.
      if (dom.footerButtons.length >= 2) {
        chk(dom.primaryCount === 1 || dom.dangerCount >= 1, 'action row has no primary or danger action');
      }
      if (dom.primaryCount === 1) chk(dom.lastIsPrimary, 'primary action is not right-most');
    }
    // (e) canonical grid alignment (only when the canonical two-column grid is
    // actually present) + reserved validation slot.
    if (dom.dlgGrid > 0 && dom.labelLefts.length >= 2) {
      chk(Math.max(...dom.labelLefts) - Math.min(...dom.labelLefts) <= 1, `field labels not aligned: ${dom.labelLefts}`);
    }
    if (dom.statusMinH !== null) {
      chk(dom.statusMinH !== '0px' && dom.statusMinH !== 'auto', `validation slot not reserved (min-height=${dom.statusMinH})`);
    }
    // (f) visible keyboard focus. The shell owns initial focus (the default
    // action) but no focus trap, so Shift+Tab from the default steps back
    // through the dialog's own controls; accept the first ringed element found.
    // The documented AccountsDialog exception keeps its AnimatedDialog chrome
    // (no shell initial focus), so its focus path is exempt from this check.
    if (!cfg.skipFocus) {
      let focusOk = false;
      for (const key of ['Shift+Tab', 'Tab', 'Shift+Tab', 'Tab', 'Shift+Tab', 'Tab']) {
        if (focusOk) break;
        await win.keyboard.press(key);
        const focus = await readFocus(win, cfg.root);
        if (focus.inside && (focus.focusVisible || focus.outline !== 'none' || focus.boxShadow !== 'none')) {
          focusOk = true;
        }
      }
      chk(focusOk, 'keyboard focus is not visible inside the dialog');
    } else {
      console.log(`[phase92] NOTE ${name} [${theme}] focus check exempt (documented AccountsDialog exception)`);
    }
    // (f) disabled control is non-interactive.
    if (dom.disabledCount > 0) {
      const survived = await win.evaluate((sel) => {
        const root = document.querySelector(sel);
        const d = root.querySelector('button[disabled], input[disabled], select[disabled]');
        if (d) d.click();
        return !!document.querySelector(sel);
      }, cfg.root);
      chk(survived === true, 'activating a disabled control closed/changed the dialog');
    }
    const shotPath = path.join(SHOT_DIR, `${name}-${theme}.png`);
    await win.screenshot({ path: shotPath });
    // (c) representative cancel/close action fires and dismisses.
    if (cfg.close) await win.locator(cfg.close).first().click({ timeout: 6000 });
    else await win.keyboard.press('Escape');
    await win.waitForFunction((sel) => !document.querySelector(sel), cfg.root, { timeout: 2500 }).catch(() => {});
    const still = await win.locator(cfg.root).count();
    chk(still === 0, 'cancel/close action did not dismiss the surface');
  } catch (e) {
    fails.push(`exception: ${e.message}`);
  }
  const ok = fails.length === 0;
  results.push({ name, theme, ok, fails, canonicalGrid: !!(dom && (dom.dlgGrid > 0 || dom.dlgField > 0)) });
  console.log(`[phase92] ${ok ? 'PASS' : 'FAIL'} ${name} [${theme}]${ok ? '' : ' :: ' + fails.join(' | ')}`);
  return ok;
}

// The standard close control every adopted shell surface renders.
const SHELL_CLOSE = '[data-dialog-shell] .modal-close, [data-dialog-shell] .sheet-close';

// ---------------------------------------------------------------------------
// Special openers.
// ---------------------------------------------------------------------------
async function openPasswordPrompt(win, app) {
  const fixture = path.join(ROOT, 'test-fixtures', 'encrypted.pdf');
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, fixture);
  await win.locator('[data-home-tool="open"]').first().click();
  await win.waitForSelector('[data-password-prompt]', { state: 'visible', timeout: 20000 });
}

async function openCloseTabPrompt(win) {
  await gotoStage(win, 1);
  const rotate = win.locator('[data-dock-verb="rotate"]').first();
  if (await rotate.count()) {
    await rotate.click({ force: true });
    await win.waitForTimeout(900);
  }
  await win.locator('.tab-close').first().click();
  await win.waitForSelector('[data-close-tab-prompt]', { state: 'visible', timeout: 10000 });
}

async function openUpdatePrompt(win, app, theme) {
  await app.evaluate(({ BrowserWindow }, { channel, state }) => {
    BrowserWindow.getAllWindows()[0].webContents.send(channel, state);
  }, {
    channel: UPDATE_CHANNEL,
    // A distinct version per theme keeps the prompt machine's dismissedKey
    // different, so the second pass is not suppressed by the first pass's
    // dismissal.
    state: { kind: 'available', version: `99.0.0-${theme}`, notes: [] },
  });
  await win.waitForSelector('[data-update-prompt]', { state: 'visible', timeout: 10000 });
}
// ---------------------------------------------------------------------------
// The inventory. Each entry: open() drives the real UI, root/hook name the
// shipped selectors, close is the representative dismiss control.
// ---------------------------------------------------------------------------
function reportSurfaces(win) {
  const SHELL = { root: '[data-dialog-shell]', shell: true };
  const P = (name, id, label, hook) => ({
    name, hook, close: SHELL_CLOSE, open: () => openPaletteTool(win, id, label), ...SHELL,
  });
  return [
    P('encrypt', 'encrypt', 'Encrypt document', '[data-encrypt-dialog]'),
    { name: 'save-as', hook: '[data-save-as-dialog]', close: SHELL_CLOSE, open: async () => { await win.click('[data-toolbar-save-as]'); }, ...SHELL },
    P('merge', 'merge', 'Merge PDFs', '.merge-dialog'),
    P('split', 'split', 'Split pages', '#split-dialog-title'),
    P('delete-page', 'delete', 'Delete pages', '[data-delete-pages-dialog]'),
    P('document-info', 'documentInfo', 'Document info', '[data-document-info-dialog]'),
    P('export', 'exportPages', 'Export pages as images', '[data-export-dialog]'),
    P('text-export', 'exportText', 'Export text', '[data-text-export-dialog]'),
    P('docx-export', 'exportDocx', 'Export to Word', '[data-docx-export-dialog]'),
    P('office-export-xlsx', 'exportXlsx', 'Export as spreadsheet', '[data-office-export-dialog]'),
    P('optimize', 'optimize', 'Reduce file size', '.optimize-dialog'),
    P('ocr', 'recognizeText', 'Recognize text', '.ocr-dialog'),
    P('insert-pages', 'insertPages', 'Insert pages', '[data-insert-pages-dialog]'),
    P('replace-pages', 'replacePages', 'Replace pages', '[data-replace-pages-dialog]'),
    P('renumber-pages', 'renumberPages', 'Rename pages', '[data-renumber-pages-dialog]'),
    P('crop-pages', 'cropPages', 'Crop pages', '[data-crop-pages-dialog]'),
    P('stamp', 'stamp', 'Stamp', '[data-stamp-dialog]'),
    P('watermark', 'watermark', 'Watermark', '[data-watermark-dialog]'),
    P('audit', 'audit', 'Audit space usage', '.audit-dialog'),
    P('bates', 'bates', 'Bates numbering', '[data-bates-dialog]'),
    P('validate-document', 'validateDocument', 'Validate document', '[data-validate-document-dialog]'),
    P('sanitize', 'sanitize', 'Sanitize document', '[data-sanitize-dialog]'),
    P('comment-export', 'exportComments', 'Export comments', '[data-comment-export-dialog]'),
    P('comment-import', 'importComments', 'Import comments', '[data-comment-import-dialog]'),
    { name: 'signature-manager', hook: '#sig-modal-title', close: SHELL_CLOSE, open: async () => { await armSignTool(win); }, ...SHELL },
    { name: 'close-tab-prompt', hook: '[data-close-tab-prompt]', close: '[data-close-prompt-action="cancel"]', open: () => openCloseTabPrompt(win), ...SHELL },
  ];
}

function formSurfaces(win) {
  const SHELL = { root: '[data-dialog-shell]', shell: true };
  const P = (name, id, label, hook) => ({
    name, hook, close: SHELL_CLOSE, open: () => openPaletteTool(win, id, label), ...SHELL,
  });
  return [
    P('flatten-confirm', 'flatten', 'Flatten', '[data-animated-dialog="flatten-confirm"]'),
    P('fill-from-csv', 'fillFromCsv', 'Fill form fields from CSV', '[data-fill-csv-dialog]'),
    P('form-data-export', 'exportFormData', 'Export form data', '[data-form-data-dialog]'),
    P('form-data-import', 'importFormData', 'Import form data', '[data-form-data-dialog]'),
  ];
}

async function auditOpen(win, results, name, theme, cfg) {
  try {
    await cfg.open();
  } catch (e) {
    results.push({ name, theme, ok: false, fails: [`open failed: ${e.message}`] });
    console.log(`[phase92] FAIL ${name} [${theme}] :: open failed: ${e.message}`);
    await win.keyboard.press('Escape').catch(() => {});
    await win.waitForTimeout(400);
    return;
  }
  await runSurface(win, results, name, theme, cfg);
}

async function closeActiveTab(win) {
  await win.locator('.tab-close').first().click();
  await win.waitForTimeout(500);
  const discard = win.locator('[data-close-prompt-action="discard"]');
  if (await discard.count()) await discard.first().click();
  await win.waitForSelector('.welcome, .sample-card', { timeout: 20000 });
}

async function auditPrintWindow(win, app, theme, results) {
  const name = 'print-window';
  const fails = [];
  let printPage = null;
  try {
    printPage = await openStandalonePrintWindow(app, win);
    await printPage.waitForSelector('[data-print-window]', { state: 'visible', timeout: 20000 });
    await printPage.waitForTimeout(600);
    const present = await printPage.evaluate(() => ({
      win: !!document.querySelector('[data-print-window]'),
      doc: !!document.querySelector('[data-print-window-doc]'),
      printer: !!document.querySelector('[data-print-printer]'),
    }));
    if (!present.win) fails.push('[data-print-window] missing');
    if (!present.doc) fails.push('[data-print-window-doc] missing');
    if (!present.printer) fails.push('[data-print-printer] missing');
    await printPage.screenshot({ path: path.join(SHOT_DIR, `${name}-${theme}.png`) });
  } catch (e) {
    fails.push(`exception: ${e.message}`);
  } finally {
    await closeStandalonePrintWindow(app, printPage).catch(() => {});
  }
  const ok = fails.length === 0;
  results.push({ name, theme, ok, fails });
  console.log(`[phase92] ${ok ? 'PASS' : 'FAIL'} ${name} [${theme}]${ok ? '' : ' :: ' + fails.join(' | ')}`);
  await win.waitForTimeout(500);
}

async function sweep(win, app, theme, results) {
  await setTheme(win, theme);

  // ---- welcome-screen surfaces (no document needed) ----
  await auditOpen(win, results, 'preferences', theme, {
    open: () => openPaletteTool(win, 'preferences', 'Preferences'),
    root: '[data-dialog-shell]', hook: '[data-prefs-dialog]', shell: true, close: SHELL_CLOSE,
  });
  await auditOpen(win, results, 'about', theme, {
    open: () => openPaletteTool(win, 'about', 'About Jovrel'),
    root: '[data-dialog-shell]', hook: '[data-about-dialog]', shell: true, close: SHELL_CLOSE,
  });
  await auditOpen(win, results, 'accounts', theme, {
    open: async () => { await win.locator('[data-header-accounts="signed-out"]').first().click(); },
    // Documented exception: AccountsDialog keeps its AnimatedDialog `.sheet`
    // chrome; the shipped root hook is `data-animated-dialog="accounts-dialog"`
    // (the brief's `[data-testid=...]` is not the hook the component emits).
    // Do NOT assert `[data-dialog-shell]` here.
    root: '[data-animated-dialog="accounts-dialog"]',
    hook: '[data-animated-dialog="accounts-dialog"]', shell: false,
    close: '[data-accounts-close]', skipFocus: true,
  });
  await auditOpen(win, results, 'update-prompt', theme, {
    open: () => openUpdatePrompt(win, app, theme),
    root: '[data-dialog-shell]', hook: '[data-update-prompt]', shell: true,
    close: '[data-update-prompt-cancel]',
  });
  await auditOpen(win, results, 'password-prompt', theme, {
    open: () => openPasswordPrompt(win, app),
    root: '[data-dialog-shell]', hook: '[data-password-prompt]', shell: true, close: SHELL_CLOSE,
  });
  await auditOpen(win, results, 'create-from-images', theme, {
    open: () => openPaletteTool(win, 'createFromImages', 'Create PDF from images'),
    root: '[data-dialog-shell]', hook: '[data-create-from-images-dialog]', shell: true, close: SHELL_CLOSE,
  });

  // ---- report.pdf surfaces ----
  await openSamplePath(win, app, getSamplePath('report.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(700);
  for (const cfg of reportSurfaces(win)) await auditOpen(win, results, cfg.name, theme, cfg);
  await auditPrintWindow(win, app, theme, results);
  await closeActiveTab(win);

  // ---- form.pdf surfaces (form-fields precondition) ----
  await openSamplePath(win, app, getSamplePath('form.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(700);
  for (const cfg of formSurfaces(win)) await auditOpen(win, results, cfg.name, theme, cfg);
  await closeActiveTab(win);
}

test('TFL-620 Phase 92 dialog-shell inventory sweep', async () => {
  test.setTimeout(1200000);
  const app = await launchApp();
  const win = await app.firstWindow();
  const results = [];
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    // ConfirmDialog is the canonical exemplar but is not mounted anywhere in
    // the live renderer (no import); it is covered by test/unit/renderer/
    // dialogShell.test.tsx, so it is documented as excluded from the live walk.
    for (const theme of ['light', 'dark']) await sweep(win, app, theme, results);
  } finally {
    await hardClose(app, 'TFL620');
  }
  const failed = results.filter((r) => !r.ok);
  const passCount = results.length - failed.length;
  const canonical = results.filter((r) => r.canonicalGrid).length;
  console.log(`[phase92] SUMMARY pass=${passCount} fail=${failed.length} total=${results.length}`);
  console.log(`[phase92] CANONICAL-GRID surface checks using .dlg-*/grid: ${canonical}/${results.length}`);
  for (const f of failed) console.log(`[phase92] FAILED ${f.name} [${f.theme}] :: ${f.fails.join(' | ')}`);
  expect(
    failed.map((f) => `${f.name}[${f.theme}]: ${f.fails.join('|')}`),
    'Phase 92 inventory sweep failures',
  ).toEqual([]);
});



