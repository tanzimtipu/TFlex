// Phase 91 adversarial diff-pass — behaviour attack spec (read-only).
//
// Attacks 1-6 from the task: keyboard traversal + focus ring; disabled gating;
// aria-pressed round-trip; destructive-confirm gating; data-* hook survival;
// the no-op class. Launch ONLY via e2e/lib/launch.cjs. Nothing here edits the
// app, its CSS, its unit tests or the phase e2e spec.
const { test } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require(path.resolve(__dirname, '..', '..', 'e2e', 'lib', 'launch.cjs'));
const {
  hardClose,
  gotoStage,
  ensurePanelExpanded,
  openAnnotationFlyout,
  clickDockVerb,
} = require(path.resolve(__dirname, '..', '..', 'e2e', 'lib', 'helpers.cjs'));

delete process.env.ELECTRON_RUN_AS_NODE;
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const USER_DATA = path.join(os.tmpdir(), `tflex-p91-adv-${Date.now()}`);
const RING = '124, 58, 237';
test.setTimeout(900000);

let app;
let win;
const results = [];
function rec(name, ok, detail = '') {
  const d = String(detail).replace(/\s+/g, ' ').slice(0, 400);
  results.push({ name, ok, detail: d });
  console.log(`[ADV91] ${ok ? 'PASS' : 'FAIL'} ${name}${d ? ' :: ' + d : ''}`);
}
async function step(name, fn) {
  try {
    await fn();
    rec(name, true);
  } catch (e) {
    rec(name, false, e.message);
  }
}
async function shot(name) {
  await win.screenshot({ path: path.join(SHOTS, `phase91-adv-${name}.png`) }).catch(() => {});
}
async function diag() {
  return win.evaluate(() => window.tflexDiagnostics());
}
async function snap() {
  return win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return {
      pageCount: d.pageCount,
      currentPage: d.currentPage,
      zoom: d.zoom,
      mode: d.mode,
      modified: d.modified,
      activeTool: d.activeTool,
      rotations: d.engineState && d.engineState.rotations ? JSON.stringify(d.engineState.rotations) : null,
      theme: d.theme,
      dialogs: document.querySelectorAll('[role="dialog"],[data-dialog-shell],[data-blank-pages-dialog]').length,
    };
  });
}
async function closeDialogs() {
  for (let i = 0; i < 4; i += 1) {
    const open = await win.locator('[data-dialog-shell],[role="dialog"],[data-blank-pages-dialog]').count();
    if (open === 0) break;
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
  }
}
async function openBlankDialog() {
  await gotoStage(win, 1);
  await ensurePanelExpanded(win);
  await win.locator('[data-blank-scan-open]').first().click({ timeout: 8000 });
  await win.waitForSelector('[data-blank-pages-dialog]', { state: 'visible', timeout: 8000 });
  await win.waitForTimeout(250);
}
async function openStampDialog() {
  await clickDockVerb(win, 3, 'stamp');
  await win.waitForSelector('[aria-labelledby="stamp-dialog-title"]', { state: 'visible', timeout: 10000 });
  await win.waitForTimeout(300);
}
async function openPageMenu() {
  await gotoStage(win, 1);
  await ensurePanelExpanded(win);
  const thumb = win.locator('[data-context-panel] .thumb-item[data-page="1"]').first();
  await thumb.waitFor({ state: 'visible', timeout: 10000 });
  await thumb.scrollIntoViewIfNeeded();
  await win.waitForTimeout(250);
  await thumb.click({ button: 'right' });
  await win.waitForSelector('[data-context-menu]', { state: 'visible', timeout: 10000 });
  await win.waitForTimeout(200);
}

// ---- Attack 1: keyboard reachability + focus ring -------------------------
async function keyboardReach(rootSel, label, maxTabs = 60) {
  const meta = await win.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return { error: `region ${sel} not found` };
    const key = (el) => {
      const d = Array.from(el.attributes)
        .filter((a) => a.name.startsWith('data-'))
        .map((a) => `${a.name}=${a.value}`)
        .join('&');
      return d || `${el.tagName}:${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}`;
    };
    const all = Array.from(root.querySelectorAll('button.btn, [role="menuitem"].btn'));
    const enabled = all.filter((e) => !e.disabled);
    return {
      expected: enabled.map(key),
      disabled: all.filter((e) => e.disabled).length,
      btnTotal: all.length,
      focusFirst: enabled.length > 0,
    };
  }, rootSel);
  if (meta.error) throw new Error(meta.error);
  if (meta.expected.length === 0) throw new Error(`region ${label}: no enabled .btn`);

  const readActive = () =>
    win.evaluate((sel) => {
      const root = document.querySelector(sel);
      const el = document.activeElement;
      if (!root || !el || !root.contains(el)) return null;
      const key = (() => {
        const d = Array.from(el.attributes)
          .filter((a) => a.name.startsWith('data-'))
          .map((a) => `${a.name}=${a.value}`)
          .join('&');
        return d || `${el.tagName}:${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}`;
      })();
      const cs = getComputedStyle(el);
      return { key, isBtn: el.classList.contains('btn'), fv: el.matches(':focus-visible'), bs: cs.boxShadow, ol: cs.outlineStyle, ring: cs.getPropertyValue('--focus-ring').trim() };
    }, rootSel);

  const seen = new Set();
  const ringSamples = [];

  // Forward pass from the region's first enabled control.
  await win.evaluate((sel) => {
    const root = document.querySelector(sel);
    root.querySelector('button.btn:not([disabled]), [role="menuitem"].btn:not([disabled])')?.focus();
  }, rootSel);
  let sameCount = 0;
  let lastKey = null;
  for (let i = 0; i < maxTabs && seen.size < meta.expected.length; i += 1) {
    const cur = await readActive();
    if (cur) {
      if (cur.key === lastKey) sameCount += 1; else sameCount = 0;
      lastKey = cur.key;
      if (cur.isBtn) { seen.add(cur.key); if (cur.fv) ringSamples.push(`${cur.bs}|${cur.ol}|${cur.ring}`); }
    } else {
      break; // focus left the region and did not come back on this Tab
    }
    await win.keyboard.press('Tab');
    await win.waitForTimeout(35);
  }

  // Backward pass from the region's last enabled control.
  await win.evaluate((sel) => {
    const root = document.querySelector(sel);
    const btns = Array.from(root.querySelectorAll('button.btn:not([disabled]), [role="menuitem"].btn:not([disabled])'));
    btns[btns.length - 1]?.focus();
  }, rootSel);
  for (let i = 0; i < maxTabs && seen.size < meta.expected.length; i += 1) {
    const cur = await readActive();
    if (cur) {
      if (cur.isBtn) { seen.add(cur.key); if (cur.fv) ringSamples.push(`${cur.bs}|${cur.ol}|${cur.ring}`); }
    } else break;
    await win.keyboard.press('Shift+Tab');
    await win.waitForTimeout(35);
  }

  const missing = meta.expected.filter((k) => !seen.has(k));
  const ringOk = ringSamples.some((s) => s.includes(RING));
  console.log(
    `[ADV91][reach] ${label} expected=${meta.expected.length} seen=${seen.size} disabled=${meta.disabled} missing=${JSON.stringify(missing)} ringOk=${ringOk}`,
  );
  return { expected: meta.expected.length, seen: seen.size, missing, ringOk, ringSamples: ringSamples.slice(0, 2) };
}

test('P91 adversarial behaviour probe', async () => {
  app = await launchApp([], USER_DATA);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  try {
    // ================= Welcome surface =================
    await step('A5.welcome hooks: data-home-tool present + carry .btn', async () => {
      const info = await win.evaluate(() => {
        const els = Array.from(document.querySelectorAll('[data-home-tool]'));
        return { n: els.length, nonBtn: els.filter((e) => !e.classList.contains('btn')).length };
      });
      if (info.n === 0) throw new Error('no [data-home-tool]');
      if (info.nonBtn > 0) throw new Error(`${info.nonBtn} home tool(s) missing .btn`);
    });

    await step('A6.welcome no-op: edit toggle flips data-home-edit', async () => {
      const before = await win.locator('[data-home-tools]').getAttribute('data-home-edit');
      await win.locator('[data-home-edit-toggle]').click();
      await win.waitForFunction((b) => document.querySelector('[data-home-tools]').getAttribute('data-home-edit') !== b, before, { timeout: 8000 });
      if ((await win.locator('[data-home-tools]').getAttribute('data-home-edit')) === before) throw new Error('data-home-edit did not flip');
      await win.locator('[data-home-edit-toggle]').click();
      await win.waitForTimeout(200);
    });

    await step('A1.welcome keyboard reach + ring', async () => {
      const r = await keyboardReach('[data-home-tools]', 'welcome');
      if (r.missing.length) throw new Error(`unreachable: ${JSON.stringify(r.missing)}`);
      if (!r.ringOk) throw new Error(`focus ring (${RING}) not painted; samples=${JSON.stringify(r.ringSamples)}`);
    });

    // open a real document
    await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
    await win.waitForSelector('.workspace', { timeout: 30000 });
    await win.waitForTimeout(900);
    await shot('opened');

    // ================= Attack 2: disabled gating =================
    await step('A2.canvas-pills Previous page is disabled + inert', async () => {
      const prev = win.locator('[data-page-pill] button[aria-label="Previous page"]').first();
      if (!(await prev.isDisabled())) throw new Error('Previous page not disabled on page 1');
      const before = await snap();
      await prev.click({ force: true, timeout: 5000 }).catch(() => {});
      await win.waitForTimeout(500);
      const after = await snap();
      if (after.currentPage !== before.currentPage) throw new Error(`page moved ${before.currentPage}->${after.currentPage} on a disabled click`);
    });

    await step('A2.dock disabled verb is inert', async () => {
      await gotoStage(win, 2);
      const verb = win.locator('[data-dock-verb="ocrSuspects"]').first();
      if (!(await verb.isDisabled())) throw new Error('ocrSuspects verb not disabled with no OCR run');
      const before = await snap();
      await verb.click({ force: true, timeout: 5000 }).catch(() => {});
      await win.waitForTimeout(500);
      const after = await snap();
      if (after.dialogs > before.dialogs) throw new Error('disabled dock verb opened a dialog');
    });

    // ================= Attack 4: destructive confirm gating =================
    await step('A4.blank "Remove N selected" disabled with no scan + inert', async () => {
      await openBlankDialog();
      const confirm = win.locator('[data-blank-scan-confirm]').first();
      if (!(await confirm.isDisabled())) throw new Error('blank-scan-confirm not disabled before a scan');
      const before = await snap();
      await confirm.click({ force: true, timeout: 5000 }).catch(() => {});
      await win.waitForTimeout(500);
      const after = await snap();
      if (after.pageCount !== before.pageCount || after.modified !== before.modified) {
        throw new Error(`stray click mutated doc: pageCount ${before.pageCount}->${after.pageCount} modified ${before.modified}->${after.modified}`);
      }
      await shot('blank-dialog');
      await closeDialogs();
    });

    // ================= Attack 1: panels + dialog keyboard =================
    await step('A1.app-header keyboard reach + ring', async () => {
      const r = await keyboardReach('.app-header', 'app-header');
      if (r.missing.length) throw new Error(`unreachable: ${JSON.stringify(r.missing)}`);
      if (!r.ringOk) throw new Error(`ring not painted; samples=${JSON.stringify(r.ringSamples)}`);
    });

    await step('A1.context-panel keyboard reach + ring', async () => {
      await gotoStage(win, 1);
      await ensurePanelExpanded(win);
      const r = await keyboardReach('[data-context-panel]', 'context-panel');
      if (r.missing.length) throw new Error(`unreachable: ${JSON.stringify(r.missing)}`);
      if (!r.ringOk) throw new Error(`ring not painted; samples=${JSON.stringify(r.ringSamples)}`);
    });

    await step('A1.dialog keyboard reach + ring (stamp)', async () => {
      await openStampDialog();
      const r = await keyboardReach('[aria-labelledby="stamp-dialog-title"]', 'stamp-dialog');
      if (r.missing.length) throw new Error(`unreachable: ${JSON.stringify(r.missing)}`);
      if (!r.ringOk) throw new Error(`ring not painted; samples=${JSON.stringify(r.ringSamples)}`);
      await closeDialogs();
    });

    // ================= Attack 3: aria-pressed round-trip =================
    await step('A3.stage-rail toggle round-trip + re-render survival', async () => {
      await gotoStage(win, 1);
      const edit = win.locator('[data-stage="edit"]').first();
      await edit.click();
      await win.waitForFunction(() => document.querySelector('[data-stage="edit"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 6000 });
      if ((await win.locator('[data-stage-rail]').getAttribute('data-active-stage')) !== 'edit') throw new Error('active stage did not follow');
      await win.locator('[data-stage="pages"]').first().click();
      await win.waitForTimeout(300);
      await win.locator('[data-stage="edit"]').first().click();
      await win.waitForFunction(() => document.querySelector('[data-stage="edit"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 6000 });
      if ((await win.locator('[data-stage="pages"]').first().getAttribute('aria-pressed')) === 'true') throw new Error('pages stayed pressed');
    });

    await step('A3.canvas-pills fit-width/fit-page round-trip', async () => {
      const fitW = win.locator('[data-zoom-pill] button[aria-label="Fit width"]').first();
      const fitP = win.locator('[data-zoom-pill] button[aria-label="Fit page"]').first();
      await fitW.click();
      await win.waitForFunction(() => document.querySelector('[data-zoom-pill] button[aria-label="Fit width"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 6000 });
      await fitP.click();
      await win.waitForFunction(() => document.querySelector('[data-zoom-pill] button[aria-label="Fit page"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 6000 });
      if ((await fitW.getAttribute('aria-pressed')) === 'true') throw new Error('fit-width stayed pressed after fit-page');
      await fitW.click();
      await win.waitForFunction(() => document.querySelector('[data-zoom-pill] button[aria-label="Fit width"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 6000 });
    });

    await step('A3.annotation tool toggle round-trip', async () => {
      await openAnnotationFlyout(win);
      const hi = win.locator('[data-ann-tools-visible] button[data-tool="highlight"]').first();
      await hi.click();
      await win.waitForFunction(() => window.tflexDiagnostics().activeTool === 'highlight', null, { timeout: 6000 });
      if ((await hi.getAttribute('aria-pressed')) !== 'true') throw new Error('highlight aria-pressed not true');
      const arrow = win.locator('[data-ann-tools-visible] button[data-tool="arrow"]').first();
      await arrow.click();
      await win.waitForFunction(() => window.tflexDiagnostics().activeTool === 'arrow', null, { timeout: 6000 });
      if ((await arrow.getAttribute('aria-pressed')) !== 'true') throw new Error('arrow aria-pressed not true');
      if ((await hi.getAttribute('aria-pressed')) === 'true') throw new Error('highlight stayed pressed');
    });

    await step('A3.page-layout toggle round-trip', async () => {
      await gotoStage(win, 1);
      const two = win.locator('[data-page-layout-option="two"]').first();
      await two.click();
      await win.waitForFunction(() => document.querySelector('[data-page-layout-option="two"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 6000 });
      const one = win.locator('[data-page-layout-option="one"]').first();
      await one.click();
      await win.waitForFunction(() => document.querySelector('[data-page-layout-option="one"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 6000 });
      if ((await two.getAttribute('aria-pressed')) === 'true') throw new Error('two stayed pressed');
    });

    // ================= Attack 5: data-* hook survival =================
    await step('A5.hooks resolve per surface', async () => {
      const checks = [];
      const has = async (sel, min = 1) => {
        const n = await win.locator(sel).count();
        checks.push(`${sel}=${n}`);
        if (n < min) throw new Error(`hook ${sel} count ${n} < ${min} (so far ${checks.join(',')})`);
      };
      await gotoStage(win, 1);
      await ensurePanelExpanded(win);
      await has('[data-dock-verb]', 1);
      await has('[data-context-panel-action]', 0); // stage 1 may have none
      await has('[data-page-layout-option]', 1);
      await has('[data-page-pill] button', 1);
      await has('[data-zoom-pill] button', 1);
      await has('[data-stage]', 1);
      await gotoStage(win, 4);
      await has('[data-context-panel-action]', 1);
      await gotoStage(win, 1);
      const collapsed = await win.locator('[data-inspector][data-inspector-collapsed="true"]').count();
      if (collapsed > 0) { await win.locator('[data-inspector-collapse]').first().click(); await win.waitForTimeout(400); }
      await has('[data-inspector-action]', 1);
      await openAnnotationFlyout(win);
      await has('[data-ann-tools-visible] button[data-tool]', 1);
      await openBlankDialog();
      await has('[data-blank-scan-confirm]', 1);
      await closeDialogs();
      await openStampDialog();
      await has('[data-stamp-confirm]', 1);
      await closeDialogs();
      await openPageMenu();
      await has('[data-menu-item="rotate-cw"]', 1);
      await win.keyboard.press('Escape');
      await win.waitForTimeout(200);
      await win.keyboard.press('Control+f');
      await win.waitForSelector('.search-bar', { state: 'visible', timeout: 8000 });
      await win.locator('[data-search-replace-toggle]').first().click();
      await has('[data-search-replace-one]', 1);
      await win.keyboard.press('Escape');
      await win.waitForTimeout(200);
      console.log(`[ADV91][hooks] ${checks.join(' | ')}`);
    });

    // ================= Attack 6: the no-op class =================
    const clickAndWait = async (selector, waitFn, label) => {
      const loc = win.locator(selector).first();
      await loc.waitFor({ state: 'visible', timeout: 8000 });
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await loc.click({ timeout: 8000 });
      try {
        await waitFn();
      } catch (e) {
        const s = await snap();
        throw new Error(`${label}: no shipped action fired (${e.message}); state=${JSON.stringify(s)}`);
      }
    };

    await step('A6.top-bar: header Find opens the search bar', async () => {
      await gotoStage(win, 1);
      await clickAndWait(
        '[data-header-find]',
        () => win.waitForSelector('.search-bar', { state: 'visible', timeout: 6000 }),
        'header find',
      );
      await win.keyboard.press('Escape');
      await win.waitForTimeout(250);
    });

    await step('A6.context-panel: From images opens its dialog', async () => {
      await gotoStage(win, 4);
      const before = await win.evaluate(() => document.querySelectorAll('[role="dialog"],[data-dialog-shell]').length);
      await clickAndWait(
        '[data-context-panel-action="from-images"]',
        () => win.waitForFunction((b) => document.querySelectorAll('[role="dialog"],[data-dialog-shell]').length > b, before, { timeout: 6000 }),
        'from-images',
      );
      await closeDialogs();
    });

    await step('A6.inspector: renumber opens its dialog', async () => {
      await gotoStage(win, 1);
      await ensurePanelExpanded(win);
      const collapsed = await win.locator('[data-inspector][data-inspector-collapsed="true"]').count();
      if (collapsed > 0) { await win.locator('[data-inspector-collapse]').first().click(); await win.waitForTimeout(400); }
      const before = await win.evaluate(() => document.querySelectorAll('[role="dialog"],[data-dialog-shell]').length);
      await clickAndWait(
        '[data-inspector-action="renumber"]',
        () => win.waitForFunction((b) => document.querySelectorAll('[role="dialog"],[data-dialog-shell]').length > b, before, { timeout: 6000 }),
        'inspector renumber',
      );
      await closeDialogs();
    });

    await step('A6.action-dock: annotate opens the flyout', async () => {
      await gotoStage(win, 3);
      if ((await win.locator('[data-annotation-flyout]').count()) > 0) {
        await win.keyboard.press('Escape');
        await win.waitForTimeout(250);
      }
      await clickAndWait(
        '[data-dock-verb="annotate"]',
        () => win.waitForSelector('[data-annotation-flyout]', { state: 'visible', timeout: 6000 }),
        'dock annotate',
      );
    });

    await step('A6.stage-rail: Edit stage switches the stage', async () => {
      await gotoStage(win, 1);
      await clickAndWait(
        '[data-stage="edit"]',
        () => win.waitForFunction(() => document.querySelector('[data-stage-rail]')?.getAttribute('data-active-stage') === 'edit', null, { timeout: 6000 }),
        'stage edit',
      );
    });

    await step('A6.annotation toolbar: underline arms the tool', async () => {
      await openAnnotationFlyout(win);
      const vis = await win.locator('[data-ann-tools-visible] button[data-tool="underline"]').count();
      if (vis > 0) {
        await win.locator('[data-ann-tools-visible] button[data-tool="underline"]').first().click();
      } else {
        await win.locator('[data-ann-dropdown-toggle]').first().click();
        await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'visible', timeout: 8000 });
        await win.locator('[data-ann-dropdown-menu] button[data-tool="underline"]').first().click();
      }
      await win.waitForFunction(() => window.tflexDiagnostics().activeTool === 'underline', null, { timeout: 6000 });
    });

    await step('A6.search-bar: replace toggle reveals replace controls', async () => {
      await gotoStage(win, 1);
      await win.keyboard.press('Escape');
      await win.waitForTimeout(250);
      await win.keyboard.press('Control+f');
      await win.waitForSelector('.search-bar', { state: 'visible', timeout: 8000 });
      const toggle = win.locator('[data-search-replace-toggle]').first();
      if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
        await toggle.click({ timeout: 8000 });
      }
      await win.waitForSelector('[data-search-replace-one]', { state: 'visible', timeout: 8000 });
      await win.keyboard.press('Escape');
      await win.waitForTimeout(250);
    });

    await step('A6.canvas-pills: Zoom in changes the zoom level', async () => {
      const before = (await snap()).zoom;
      await win.locator('[data-zoom-pill] button[aria-label="Zoom in"]').first().click();
      await win.waitForTimeout(600);
      const after = (await snap()).zoom;
      if (after === before) throw new Error(`zoom unchanged (${before})`);
    });

    await step('A6.redaction: text mode flips aria-pressed', async () => {
      await win.keyboard.press('Control+k');
      await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 10000 });
      await win.locator('[data-command-palette-input]').fill('Redact');
      await win.waitForTimeout(400);
      const row = win.locator('[data-palette-tool-id="redact"]').first();
      if ((await row.count()) > 0) await row.click(); else await win.keyboard.press('Enter');
      await win.waitForSelector('.redact-modes', { state: 'visible', timeout: 10000 }).catch(() => {});
      const textBtn = win.locator('.redact-modes .redact-mode[data-mode="text"]').first();
      await textBtn.click();
      await win.waitForFunction(() => document.querySelector('.redact-modes .redact-mode[data-mode="text"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 6000 });
    });

    await step('A6.menu row: rotate-cw mutates rotations', async () => {
      await openPageMenu();
      const before = await snap();
      await win.locator('[data-context-menu] [data-menu-item="rotate-cw"]').first().click();
      await win.waitForTimeout(800);
      const after = await snap();
      if (after.rotations === before.rotations) throw new Error(`rotations unchanged (${before.rotations})`);
    });

    await step('A6.dialog: Stamp Cancel closes the dialog', async () => {
      await openStampDialog();
      const dlg = '[aria-labelledby="stamp-dialog-title"]';
      await win.locator(`${dlg} .modal-footer .btn`).filter({ hasText: 'Cancel' }).first().click();
      await win.locator(dlg).waitFor({ state: 'detached', timeout: 8000 });
    });

    // ================= Attack 4b: destructive delete gating + action =========
    await step('A4b.delete-pages: range-empty gating + current confirm deletes', async () => {
      await gotoStage(win, 1);
      await win.locator('[data-dock-verb="delete"]').first().click();
      await win.waitForSelector('[data-delete-pages-dialog]', { state: 'visible', timeout: 8000 });
      await win.waitForTimeout(300);
      const confirm = win.locator('[data-delete-confirm]').first();
      if ((await confirm.count()) === 0) throw new Error('data-delete-confirm hook missing');
      if (!(await confirm.isDisabled())) {
        // current-page mode on a multi-page doc should be valid; if enabled that is expected
      }
      // Switch to a custom range and empty it -> precondition unmet -> disabled + inert.
      await win.locator('[data-delete-mode="range"]').first().check().catch(async () => {
        await win.locator('[data-delete-mode="range"]').first().click();
      });
      await win.locator('[data-delete-range]').first().fill('');
      await win.waitForTimeout(300);
      if (!(await confirm.isDisabled())) throw new Error('confirm not disabled with an empty range');
      const before = await snap();
      await confirm.click({ force: true, timeout: 5000 }).catch(() => {});
      await win.waitForTimeout(400);
      const mid = await snap();
      if (mid.pageCount !== before.pageCount) throw new Error(`stray click deleted a page ${before.pageCount}->${mid.pageCount}`);
      if (mid.dialogs === 0) throw new Error('dialog closed on an inert click');
      // Now the golden path: current page, confirm enabled, deletes exactly one.
      await win.locator('[data-delete-mode="current"]').first().check().catch(async () => {
        await win.locator('[data-delete-mode="current"]').first().click();
      });
      await win.waitForTimeout(300);
      if (await confirm.isDisabled()) throw new Error('confirm disabled on a valid current-page delete');
      await confirm.click();
      await win.waitForTimeout(900);
      const after = await snap();
      if (after.pageCount !== before.pageCount - 1) {
        throw new Error(`delete did not fire: pageCount ${before.pageCount} -> ${after.pageCount}`);
      }
      await closeDialogs();
    });

    // ================= Attack 6 additions: colour palette + flyout arrows ====
    await step('A6.colour palette: built-in swatch applies the colour', async () => {
      await openAnnotationFlyout(win);
      const hi = win.locator('[data-ann-tools-visible] button[data-tool="highlight"]').first();
      if ((await hi.count()) > 0) await hi.click();
      await win.waitForTimeout(300);
      const swatch = win.locator('[data-ann-color]').first();
      if ((await swatch.count()) === 0) throw new Error('annotation colour swatch not rendered for highlight');
      const before = await swatch.getAttribute('data-color-current');
      await swatch.click();
      await win.waitForSelector('[data-palette-built-in]', { state: 'visible', timeout: 8000 });
      const target = win.locator('[data-palette-built-in="red"]').first();
      if ((await target.count()) === 0) throw new Error('no red built-in swatch');
      await target.click();
      await win.waitForTimeout(500);
      const after = await win.locator('[data-ann-color]').first().getAttribute('data-color-current');
      if (after === before) throw new Error(`colour unchanged (${before}) after clicking a swatch`);
    });

    await step('A6.annotation flyout scroll arrow scrolls the strip', async () => {
      await openAnnotationFlyout(win);
      const arrows = await win.locator('[data-flyout-arrows="true"]').count();
      const right = win.locator('[data-flyout-arrow="right"]').first();
      if (arrows === 0 || (await right.count()) === 0) {
        console.log('[ADV91][flyout] N/A: no overflow arrows rendered (strip fits)');
        return;
      }
      const scroller = win.locator('[data-annotation-flyout-scroll]').first();
      const before = await scroller.evaluate((e) => e.scrollLeft).catch(() => null);
      await right.click();
      await win.waitForTimeout(400);
      const after = await scroller.evaluate((e) => e.scrollLeft).catch(() => null);
      if (before !== null && after !== null && after === before) throw new Error(`scrollLeft unchanged (${before})`);
    });

    // ================= Side rail reachability note (Multi Mode attempt) ======
    await step('A5/A6.side-rail rail tabs reachability', async () => {
      const direct = await win.locator('[data-rail-tab]').count();
      await win.locator('[data-header-multi-mode]').first().click();
      await win.waitForTimeout(900);
      const mm = await win.locator('[data-rail-tab]').count();
      console.log(`[ADV91][rail] rail-tabs single=${direct} multiMode=${mm}`);
      if (mm > 0) {
        const tab = win.locator('[data-rail-tab="annotations"]').first();
        await tab.click();
        await win.waitForTimeout(400);
        if ((await tab.getAttribute('aria-pressed')) !== 'true') throw new Error('rail tab aria-pressed did not flip');
      }
      await win.locator('[data-header-multi-mode]').first().click();
      await win.waitForTimeout(600);
      if (direct === 0 && mm === 0) {
        console.log('[ADV91][rail] N/A: [data-rail-tab] renders in neither single nor Multi Mode (SideRail not mounted)');
        return;
      }
      if (direct !== mm && mm === 0) throw new Error('rail tabs present in single mode but not multi mode');
    });

    await shot('final');
  } finally {
    console.log(`\n[ADV91] RESULTS ${JSON.stringify(results)}`);
    await hardClose(app, 'p91-adversary');
  }
});
