// Phase 91 (TFL-598 / Feature E) - focused QA verification of the canonical
// button system across every shipped surface.
//
// One app instance, one test, guarded per-surface checks so a broken selector
// on one surface cannot hide the rest. Asserts against the REAL app launched
// only through the canonical `e2e/lib/launch.cjs` `launchApp` helper:
//   1. canonical class presence per surface group (Home/Welcome, the toolbar
//      `.tool-btn`, the ContextPanel, the Inspector, a representative dialog,
//      a menu/popover, a segmented group);
//   2. NO-OP SWEEP: a representative control per group still fires its shipped
//      action and keeps its `data-*` hook;
//   3. the icon-only contract (aria-label + title);
//   4. a visible focus ring reached by Tab (:focus-visible -> --focus-ring);
//   5. toggles expose aria-pressed and segmented groups role="group" with
//      btn-segmented-item children;
//   6. both-theme screenshots of every named surface.
//
// The harness exports ELECTRON_RUN_AS_NODE=1; launchApp spreads process.env, so
// Electron would exit as Node ("Process failed to launch!"). Clear it before any
// launch (same adaptation phase63/phase95 use).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const {
  hardClose,
  gotoStage,
  ensurePanelExpanded,
  openAnnotationFlyout,
  clickDockVerb,
} = require('./lib/helpers.cjs');

delete process.env.ELECTRON_RUN_AS_NODE;

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const USER_DATA = path.join(os.tmpdir(), `tflex-p91-buttons-${Date.now()}`);
const THEMES = ['light', 'dark'];

test.setTimeout(480000);

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

// Switch theme through the shipped theme-toggle popover; fall back to the
// data-theme attribute only when the toggle is not reachable (e.g. behind a
// modal backdrop).
async function applyTheme(theme) {
  const trigger = win.locator('[data-theme-toggle]');
  let usedToggle = false;
  if ((await trigger.count()) > 0) {
    try {
      await win.keyboard.press('Escape').catch(() => {});
      await trigger.first().click({ timeout: 3000 });
      await win.locator(`[data-theme-option="${theme}"]`).first().click({ timeout: 3000 });
      usedToggle = true;
    } catch (_) {
      await win.keyboard.press('Escape').catch(() => {});
      await win.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    }
  } else {
    await win.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  }
  await win
    .waitForFunction((t) => document.documentElement.getAttribute('data-theme') === t, theme, { timeout: 10000 })
    .catch(() => {});
  await win.waitForTimeout(450);
  console.log(`[P91] theme=${theme} via ${usedToggle ? 'theme-toggle' : 'data-theme'}`);
}

async function shot(name) {
  const p = path.join(SHOTS, `phase91-${name}.png`);
  await win.screenshot({ path: p });
  console.log(`[P91] screenshot ${p}`);
  return p;
}

async function openReport() {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(900);
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

// Tab through the document until the active element is a canonical `.btn`, then
// return its focus-ring computed state. This exercises REAL keyboard focus.
async function tabToCanonicalRing() {
  await win.evaluate(() => document.activeElement && document.activeElement.blur());
  for (let i = 0; i < 90; i += 1) {
    await win.keyboard.press('Tab');
    const isBtn = await win.evaluate(() => document.activeElement && document.activeElement.classList.contains('btn'));
    if (!isBtn) continue;
    // The ring fades in over --motion-fast; let the transition settle before
    // reading the computed box-shadow, or getComputedStyle reports the
    // transition's transparent start frame.
    await win.waitForTimeout(400);
    return win.evaluate(() => {
      const e = document.activeElement;
      const cs = getComputedStyle(e);
      return {
        tag: e.tagName,
        cls: Array.from(e.classList),
        text: (e.textContent || '').trim().slice(0, 40),
        fv: e.matches(':focus-visible'),
        bs: cs.boxShadow,
        ol: cs.outlineStyle,
        ring: cs.getPropertyValue('--focus-ring').trim(),
      };
    }).then((info) => ({ ...info, tabs: i + 1 }));
  }
  return null;
}

// ---- surface helpers -------------------------------------------------------

async function openStampDialog() {
  await clickDockVerb(win, 3, 'stamp');
  await win.waitForSelector('[aria-labelledby="stamp-dialog-title"]', { state: 'visible', timeout: 10000 });
  await win.waitForTimeout(350);
}

async function closeTopDialog() {
  await win.keyboard.press('Escape');
  await win
    .locator('[aria-labelledby="stamp-dialog-title"]')
    .first()
    .waitFor({ state: 'detached', timeout: 8000 })
    .catch(() => {});
  await win.waitForTimeout(250);
}

async function openPageMenu() {
  await gotoStage(win, 1);
  await ensurePanelExpanded(win);
  const thumb = win.locator('[data-context-panel] .thumb-item[data-page="1"]').first();
  await thumb.waitFor({ state: 'visible', timeout: 10000 });
  await thumb.scrollIntoViewIfNeeded();
  await win.waitForTimeout(300);
  await thumb.click({ button: 'right' });
  await win.waitForSelector('[data-context-menu]', { state: 'visible', timeout: 10000 });
  await win.waitForTimeout(250);
}

async function closeMenu() {
  await win.keyboard.press('Escape');
  await win.locator('[data-context-menu]').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(200);
}

async function armRedact() {
  // The Redact tool is reached through the shipped Command Palette (Ctrl+K).
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 10000 });
  await win.locator('[data-command-palette-input]').fill('Redact');
  await win.waitForTimeout(400);
  const row = win.locator('[data-palette-tool-id="redact"]').first();
  if ((await row.count()) > 0) {
    await row.click({ timeout: 8000 });
  } else {
    await win.keyboard.press('Enter');
  }
  await win.waitForSelector('.redact-modes', { state: 'visible', timeout: 10000 });
  await win.waitForTimeout(400);
}

test('Phase 91 button system sweep: Home, toolbar, ContextPanel, Inspector, dialog, menu, segmented + both themes', async () => {
  app = await launchApp([], USER_DATA);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  const results = [];
  const record = (name, ok, detail = '') => {
    results.push({ name, ok, detail });
    console.log(`[P91] ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`);
  };
  const guard = async (name, fn) => {
    try {
      await fn();
      record(name, true);
    } catch (e) {
      record(name, false, String(e.message).split('\n')[0]);
    }
  };

  try {
    // ---- Home / Welcome --------------------------------------------------
    await guard('home', async () => {
      await win.waitForSelector('.home-tool', { timeout: 20000 });
      await expectClasses('[data-home-tool="open"]', ['btn', 'btn-primary', 'home-tool'], 'home open tile');
      await expectClasses('.home-tool[data-home-tool]:not([data-home-tool="open"])', ['btn', 'btn-secondary', 'home-tool'], 'home secondary tile');
      expect(await classesOf(win.locator('.sample-card')), '.sample-card carries .btn').toContain('btn');
      await expectClasses('[data-home-edit-toggle]', ['btn', 'btn-toggle', 'btn-icon'], 'home edit toggle');
      expect(await win.locator('[data-home-edit-toggle]').getAttribute('aria-pressed'), 'edit toggle aria-pressed').not.toBeNull();
      const lbl = await win.locator('[data-home-edit-toggle]').getAttribute('aria-label');
      const ttl = await win.locator('[data-home-edit-toggle]').getAttribute('title');
      console.log(`[P91] home edit toggle aria-label=${JSON.stringify(lbl)} title=${JSON.stringify(ttl)}`);
      expect(lbl, 'icon-only aria-label').toBeTruthy();
      expect(ttl, 'icon-only title').toBeTruthy();

      for (const t of THEMES) {
        await applyTheme(t);
        await shot(`home-${t}`);
      }
      await applyTheme('light');

      // NO-OP SWEEP: the edit toggle flips data-home-edit; the hook survives.
      const before = await win.locator('[data-home-tools]').getAttribute('data-home-edit');
      await win.locator('[data-home-edit-toggle]').click();
      await win.waitForFunction((b) => document.querySelector('[data-home-tools]').getAttribute('data-home-edit') !== b, before, { timeout: 8000 });
      expect(await win.locator('[data-home-tools]').getAttribute('data-home-edit')).not.toBe(before);
      expect(await win.locator('[data-home-tool="open"]').count(), 'open hook survives edit toggle').toBe(1);
      await win.locator('[data-home-edit-toggle]').click();
      await win.waitForTimeout(300);

      // FOCUS: Tab to a canonical control; the shared ring must paint.
      const ring = await tabToCanonicalRing();
      console.log(`[P91] focus ring ${JSON.stringify(ring)}`);
      expect(ring, 'reached a canonical .btn by Tab').not.toBeNull();
      expect(ring.fv, ':focus-visible matches').toBe(true);
      expect(`${ring.bs} ${ring.ol}`, 'focus ring uses --focus-ring').toContain('124, 58, 237');
    });

    await guard('open report', async () => {
      await openReport();
    });

    // ---- toolbar .tool-btn ----------------------------------------------
    await guard('toolbar', async () => {
      await openAnnotationFlyout(win);
      const sel = '[data-ann-tools-visible] button[data-tool="highlight"]';
      await win.waitForSelector(sel, { state: 'visible', timeout: 10000 });
      await expectClasses(sel, ['btn', 'btn-toolbar', 'btn-toggle', 'tool-btn'], 'annotation toolbar .tool-btn');
      expect(await win.locator(sel).getAttribute('aria-pressed'), 'toolbar toggle aria-pressed').not.toBeNull();

      // Diagnostic: enumerate every rendered `.tool-btn` so any un-migrated
      // fork (a `.tool-btn` without the canonical `.btn`) is visible in the log.
      const allToolBtns = await win.evaluate(() =>
        Array.from(document.querySelectorAll('.tool-btn')).map((e) => Array.from(e.classList)),
      );
      console.log(`[P91] rendered .tool-btn classes: ${JSON.stringify(allToolBtns)}`);

      // NO-OP SWEEP first, while the flyout is definitely open.
      await win.locator(sel).click({ timeout: 10000 });
      await win.waitForTimeout(500);
      const d = await win.evaluate(() => window.tflexDiagnostics());
      console.log(`[P91] activeTool after highlight = ${d.activeTool}`);
      expect(d.activeTool, 'highlight armed').toBe('highlight');

      for (const t of THEMES) {
        await applyTheme(t);
        await openAnnotationFlyout(win);
        await shot(`toolbar-${t}`);
      }
      await applyTheme('light');
    });

    // ---- no shipped `.tool-btn` may remain a bare legacy fork ------------
    await guard('tool-btn-all-canonical', async () => {
      const bad = await win.evaluate(() =>
        Array.from(document.querySelectorAll('.tool-btn'))
          .filter((e) => !e.classList.contains('btn'))
          .map((e) => ({
            cls: Array.from(e.classList),
            label: e.getAttribute('aria-label') || e.getAttribute('title') || '',
            surface: e.closest('[data-canvas-pills]') ? '[data-canvas-pills]' : e.closest('[data-action-dock]') ? '[data-action-dock]' : '(other)',
          })),
      );
      console.log(`[P91] non-canonical .tool-btn ${JSON.stringify(bad)}`);
      expect(bad, 'every rendered .tool-btn carries the canonical .btn base').toEqual([]);
    });

    // ---- DEF-522 retest: every SHEET close exposes aria-label + title -----
    // The original DEF-522 guard only read the Stamp dialog close; the defect
    // covers the whole sheet family too, so open a real sheet (Preferences)
    // and assert its `.sheet-close` carries BOTH attributes.
    await guard('sheet-close', async () => {
      await applyTheme('light');
      await win.locator('[data-open-preferences]').first().click({ timeout: 10000 });
      const close = win.locator('.sheet-close').first();
      await close.waitFor({ state: 'visible', timeout: 10000 });
      await win.waitForTimeout(300);
      const al = await close.getAttribute('aria-label');
      const tl = await close.getAttribute('title');
      console.log(`[P91] sheet close aria-label=${JSON.stringify(al)} title=${JSON.stringify(tl)}`);
      await shot('sheet-light');
      expect(al, 'sheet close aria-label').toBeTruthy();
      expect(tl, 'sheet close title').toBeTruthy();
      await close.click();
      await win.locator('.sheet-close').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
      await win.waitForTimeout(300);
    });

    // ---- DEF-523 retest: search-bar surface has no bare .tool-btn --------
    // The CTO extended DEF-523 to include `SearchBar.tsx`'s controls, which
    // are not rendered unless find is open, so open the shipped search bar
    // (Ctrl+F, falling back to the header find control) and assert every
    // `.tool-btn` it renders carries the canonical `.btn` base.
    await guard('search-bar-tool-btn', async () => {
      await applyTheme('light');
      await win.keyboard.press('Control+f');
      const opened = await win
        .waitForSelector('.search-bar', { state: 'visible', timeout: 4000 })
        .then(() => true)
        .catch(() => false);
      if (!opened) {
        await win.locator('[data-header-find]').first().click({ timeout: 10000 });
        await win.waitForSelector('.search-bar', { state: 'visible', timeout: 10000 });
      }
      await win.waitForTimeout(300);
      // Open the replace row so all six SearchBar `.tool-btn` controls render.
      await win.locator('[data-search-replace-toggle]').first().click({ timeout: 8000 });
      await win.waitForSelector('[data-search-replace-one]', { state: 'visible', timeout: 8000 });
      await win.waitForTimeout(250);
      const scan = await win.evaluate(() => {
        const all = Array.from(document.querySelectorAll('.search-bar .tool-btn'));
        return {
          total: all.length,
          bad: all
            .filter((e) => !e.classList.contains('btn'))
            .map((e) => ({ cls: Array.from(e.classList), label: e.getAttribute('aria-label') || e.getAttribute('title') || '' })),
        };
      });
      console.log(`[P91] search-bar .tool-btn total=${scan.total} non-canonical ${JSON.stringify(scan.bad)}`);
      await shot('search-bar-light');
      expect(scan.total, 'search bar renders .tool-btn controls').toBeGreaterThan(0);
      expect(scan.bad, 'every search-bar .tool-btn carries the canonical .btn base').toEqual([]);
      await win.keyboard.press('Escape');
      await win.locator('.search-bar').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
      await win.waitForTimeout(250);
    });

    // ---- ContextPanel ----------------------------------------------------
    await guard('context-panel', async () => {
      await gotoStage(win, 4);
      await ensurePanelExpanded(win);
      await win.waitForSelector('.context-panel-action', { state: 'visible', timeout: 10000 });
      await expectClasses('.context-panel-action', ['btn', 'btn-secondary'], 'context panel action');
      expect(await win.locator('.context-panel-action[data-context-panel-action]').count(), 'context-panel data hook').toBeGreaterThan(0);

      for (const t of THEMES) {
        await applyTheme(t);
        await shot(`context-panel-${t}`);
      }
      await applyTheme('light');

      const optimize = win.locator('[data-context-panel-action="optimize"]');
      await optimize.first().scrollIntoViewIfNeeded();
      await optimize.first().click();
      await win.waitForSelector('[data-dialog-shell], [role="dialog"]', { state: 'visible', timeout: 8000 });
      await win.keyboard.press('Escape');
      await win.waitForTimeout(400);
    });

    // ---- Inspector -------------------------------------------------------
    await guard('inspector', async () => {
      await gotoStage(win, 1);
      await ensurePanelExpanded(win);
      await ensureInspectorExpanded();
      await win.waitForSelector('.inspector-action', { state: 'visible', timeout: 10000 });
      await expectClasses('.inspector-action', ['btn', 'btn-secondary'], 'inspector action');
      const hook = win.locator('[data-inspector-action="renumber"]');
      expect(await hook.count(), 'renumber hook present').toBeGreaterThan(0);

      for (const t of THEMES) {
        await applyTheme(t);
        await shot(`inspector-${t}`);
      }
      await applyTheme('light');

      await hook.first().scrollIntoViewIfNeeded();
      await hook.first().click();
      await win.waitForSelector('[data-dialog-shell], [role="dialog"]', { state: 'visible', timeout: 8000 });
      expect(await win.locator('[data-dialog-shell], [role="dialog"]').count(), 'renumber dialog opened').toBeGreaterThan(0);
      await win.keyboard.press('Escape');
      await win.waitForTimeout(400);
    });

    // ---- representative dialog -------------------------------------------
    await guard('dialog', async () => {
      await applyTheme('light');
      await openStampDialog();
      const dlg = '[aria-labelledby="stamp-dialog-title"]';
      await expectClasses('[data-stamp-confirm]', ['btn', 'btn-primary'], 'dialog confirm');
      await expectClasses(`${dlg} .modal-footer button.btn.btn-secondary`, ['btn', 'btn-secondary'], 'dialog cancel');
      await expectClasses(`${dlg} .modal-close`, ['btn', 'btn-ghost', 'btn-icon'], 'dialog close');
      const al = await win.locator(`${dlg} .modal-close`).getAttribute('aria-label');
      const tl = await win.locator(`${dlg} .modal-close`).getAttribute('title');
      console.log(`[P91] dialog close aria-label=${JSON.stringify(al)} title=${JSON.stringify(tl)}`);
      await shot('dialog-light');

      // NO-OP SWEEP: Cancel closes the dialog.
      await win.locator(`${dlg} .modal-footer button.btn.btn-secondary`).first().click();
      await win.locator(dlg).waitFor({ state: 'detached', timeout: 8000 });

      await applyTheme('dark');
      await openStampDialog();
      await shot('dialog-dark');
      await closeTopDialog();
      await applyTheme('light');

      // ICON-ONLY CONTRACT for the canonical dialog close (BUTTON-SYSTEM.md).
      expect(al, 'dialog close aria-label').toBeTruthy();
      expect(tl, 'dialog close title').toBeTruthy();
    });

    // ---- menu / popover --------------------------------------------------
    await guard('menu', async () => {
      await applyTheme('light');
      await openPageMenu();
      await expectClasses('[data-context-menu] [data-menu-item]', ['btn', 'btn-ghost'], 'menu row');
      expect(await win.locator('[data-context-menu] [data-menu-item="rotate-cw"]').count(), 'menu data hook').toBeGreaterThan(0);
      await shot('menu-light');
      await closeMenu();

      await applyTheme('dark');
      await openPageMenu();
      await shot('menu-dark');

      const before = await win.evaluate(() => window.tflexDiagnostics().engineState.rotations);
      await win.locator('[data-context-menu] [data-menu-item="rotate-cw"]').click();
      await win.waitForTimeout(800);
      const after = await win.evaluate(() => window.tflexDiagnostics().engineState.rotations);
      console.log(`[P91] rotations before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
      expect(after, 'rotate-cw applied').not.toEqual(before);
      await applyTheme('light');
    });

    // ---- segmented group -------------------------------------------------
    await guard('segmented', async () => {
      await applyTheme('light');
      await armRedact();
      const group = win.locator('.redact-modes');
      expect(await group.first().getAttribute('role'), 'segmented group role').toBe('group');
      expect(await classesOf(group), 'segmented group class').toContain('btn-segmented');
      await expectClasses('.redact-modes .redact-mode', ['btn', 'btn-toggle', 'btn-segmented-item'], 'segmented item');
      expect(await win.locator('.redact-modes .redact-mode').first().getAttribute('aria-pressed'), 'item aria-pressed').not.toBeNull();
      await shot('segmented-light');

      await applyTheme('dark');
      await shot('segmented-dark');
      await applyTheme('light');

      await win.locator('.redact-modes .redact-mode[data-mode="text"]').first().click();
      await win.waitForFunction(
        () => document.querySelector('.redact-modes .redact-mode[data-mode="text"]').getAttribute('aria-pressed') === 'true',
        null,
        { timeout: 8000 },
      );
      expect(await win.locator('.redact-modes .redact-mode[data-mode="text"]').first().getAttribute('aria-pressed')).toBe('true');
    });
  } finally {
    console.log(`[P91] RESULTS ${JSON.stringify(results)}`);
    await hardClose(app, 'p91-buttons');
  }

  const failed = results.filter((r) => !r.ok);
  expect(failed, `failed checks: ${failed.map((f) => `${f.name}: ${f.detail}`).join(' | ') || 'none'}`).toEqual([]);
});
