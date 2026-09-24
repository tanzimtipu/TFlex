// Phase validation (audit form) — operator visual-consistency reports A + B.
// QA evidence harness: measures computed radii/borders/backgrounds in the REAL
// dev app and captures screenshots. Evidence only, not a behavioural gate.
// No product code is touched; nothing is asserted except that a surface is
// measurable (a missing surface is reported as unmeasured, not failed).

const { test } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { launchDev, openSample, hardClose, armAnnotationTool, scrollToPage, openAnnotationFlyout, openDockVerb, runTool } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const REPORT = path.join(SHOTS, 'audit-radius-report.json');
const report = { tokens: {}, surfaces: {}, seams: {}, unmeasured: [] };

const TOKENS = [
  '--radius-1', '--radius-2', '--radius-3', '--radius-window', '--radius-panel',
  '--radius-group', '--radius-control', '--radius-pill', '--radius-dialog',
  '--tf-radius-md', '--tf-radius-lg', '--ocr-bar-h',
];

async function readTokens(window) {
  return window.evaluate((names) => {
    const cs = getComputedStyle(document.documentElement);
    const out = {};
    for (const n of names) out[n] = cs.getPropertyValue(n).trim();
    return out;
  }, TOKENS);
}

async function measure(window, sel) {
  return window.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      radiusTL: cs.borderTopLeftRadius, radiusTR: cs.borderTopRightRadius,
      radiusBR: cs.borderBottomRightRadius, radiusBL: cs.borderBottomLeftRadius,
      borderTop: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
      borderBottom: `${cs.borderBottomWidth} ${cs.borderBottomStyle} ${cs.borderBottomColor}`,
      borderLeft: `${cs.borderLeftWidth} ${cs.borderLeftStyle} ${cs.borderLeftColor}`,
      borderRight: `${cs.borderRightWidth} ${cs.borderRightStyle} ${cs.borderRightColor}`,
      background: cs.backgroundColor, backgroundImage: cs.backgroundImage,
      backdropFilter: cs.backdropFilter, boxShadow: cs.boxShadow,
      rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      theme: document.documentElement.getAttribute('data-theme'),
    };
  }, sel);
}

async function surface(window, key, sel) {
  const m = await measure(window, sel);
  if (!m) { report.unmeasured.push(key + ' (' + sel + ')'); return null; }
  report.surfaces[key] = { selector: sel, ...m };
  return m;
}

async function zoomShot(window, name, rect, pad = 26) {
  const x = Math.max(0, rect.x - pad);
  const y = Math.max(0, rect.y - pad);
  await window.screenshot({ path: path.join(SHOTS, name), clip: { x, y, width: rect.w + pad * 2, height: rect.h + pad * 2 } });
}

async function setTheme(window, theme) {
  await window.click('[data-theme-toggle]');
  await window.waitForSelector('.theme-toggle-popover', { state: 'visible', timeout: 8000 });
  await window.click(`[data-theme-option="${theme}"]`);
  await window.waitForSelector('.theme-toggle-popover', { state: 'detached', timeout: 8000 }).catch(() => {});
  await window.waitForTimeout(700);
}

async function seam(window, menu, triggerSel, surfaceSel) {
  await window.click(triggerSel);
  await window.waitForSelector(surfaceSel, { state: 'visible', timeout: 8000 });
  await window.waitForTimeout(500);
  const data = await window.evaluate(([ts, ss]) => {
    const t = document.querySelector(ts), s = document.querySelector(ss);
    if (!t || !s) return null;
    const tc = getComputedStyle(t), sc = getComputedStyle(s);
    const tr = t.getBoundingClientRect(), sr = s.getBoundingClientRect();
    const pack = (c, r) => ({
      rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      radiusTL: c.borderTopLeftRadius, radiusTR: c.borderTopRightRadius,
      radiusBR: c.borderBottomRightRadius, radiusBL: c.borderBottomLeftRadius,
      borderTop: `${c.borderTopWidth} ${c.borderTopColor}`,
      borderBottom: `${c.borderBottomWidth} ${c.borderBottomColor}`,
      background: c.backgroundColor, backdropFilter: c.backdropFilter, boxShadow: c.boxShadow,
    });
    return {
      gap: +(sr.top - tr.bottom).toFixed(1),
      overlapX: +(Math.min(tr.right, sr.right) - Math.max(tr.left, sr.left)).toFixed(1),
      trigger: pack(tc, tr), surface: pack(sc, sr),
      theme: document.documentElement.getAttribute('data-theme'),
    };
  }, [triggerSel, surfaceSel]);
  if (data) {
    const t = data.trigger.rect, s = data.surface.rect;
    await window.screenshot({
      path: path.join(SHOTS, `auditB-${menu}-join-${data.theme}.png`),
      clip: { x: Math.max(0, Math.min(t.x, s.x) - 30), y: Math.max(0, t.y + t.h - 30), width: Math.max(t.w, s.w) + 60, height: 80 },
    });
    report.seams[`${menu}-${data.theme}`] = { triggerSel, surfaceSel, ...data };
  } else {
    report.unmeasured.push(`seam ${menu}-${data.theme} (${triggerSel} / ${surfaceSel})`);
  }
  await window.keyboard.press('Escape');
  await window.waitForTimeout(400);
  // Some popovers (the colour palette) do not close on Escape; toggle the
  // trigger again so the next menu opens from a clean state.
  if (await window.locator(surfaceSel).isVisible().catch(() => false)) {
    await window.click(triggerSel).catch(() => {});
    await window.waitForTimeout(400);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Audit A — rounded-surface consistency. Measures every reachable floating
// surface's computed border-radius (all four corners) plus its declared
// border/background material, and captures zoomed evidence.
// ---------------------------------------------------------------------------
test('Audit A - rounded surface consistency', async () => {
  test.setTimeout(300000);
  const { electronApp, window } = await launchDev();
  try {
    report.tokens = await readTokens(window);
    await surface(window, 'window-shell', '.app');
    await surface(window, 'app-header', '.app-header');
    await surface(window, 'welcome-sample-card', '.sample-card');

    // Theme popover + its trigger while open.
    await window.click('[data-theme-toggle]');
    await window.waitForSelector('.theme-toggle-popover', { state: 'visible', timeout: 8000 });
    await window.waitForTimeout(500);
    const tp = await surface(window, 'theme-popover', '.theme-toggle-popover');
    await surface(window, 'theme-trigger-open', '[data-theme-toggle]');
    if (tp) await zoomShot(window, 'auditA-theme-popover.png', tp.rect);
    await window.keyboard.press('Escape'); await window.waitForTimeout(350);

    // Title-bar menu popover.
    await window.click('.titlebar-menu-button');
    await window.waitForSelector('.titlebar-menu-popover', { state: 'visible', timeout: 8000 });
    await window.waitForTimeout(500);
    const tm = await surface(window, 'titlebar-menu-popover', '.titlebar-menu-popover');
    await surface(window, 'titlebar-menu-trigger-open', '.titlebar-menu-button');
    if (tm) await zoomShot(window, 'auditA-titlebar-menu.png', tm.rect);
    await window.keyboard.press('Escape'); await window.waitForTimeout(350);

    // Workspace surfaces.
    await openSample(window, electronApp, 'report.pdf');
    await window.waitForTimeout(900);
    await surface(window, 'tab', '.tab');
    await surface(window, 'tools-badge', '.tools-badge-tracker');
    await surface(window, 'side-rail', '.side-rail');
    await surface(window, 'ann-toolbar', '[data-annotation-toolbar]');

    await window.waitForSelector('[data-context-panel]', { state: 'visible', timeout: 8000 }).catch(() => {});
    await window.waitForTimeout(500);
    await surface(window, 'context-panel', '[data-context-panel]');
    await window.screenshot({ path: path.join(SHOTS, 'auditA-workspace-palette.png') });

    // Phase 36 (chunk 3) — the annotation toolbar is re-parented into the
    // REVIEW dock's Annotate flyout; open it before driving the ann menu.
    await openAnnotationFlyout(window);
    await window.click('[data-ann-dropdown-toggle]');
    await window.waitForSelector('[data-ann-dropdown-menu]', { state: 'visible', timeout: 8000 });
    await window.waitForTimeout(500);
    const am = await surface(window, 'ann-tool-menu', '[data-ann-dropdown-menu]');
    if (am) await zoomShot(window, 'auditA-ann-menu.png', am.rect);
    await window.keyboard.press('Escape'); await window.waitForTimeout(400);

    await window.keyboard.press('Control+f');
    await window.waitForSelector('.search-bar', { state: 'visible', timeout: 8000 }).catch(() => {});
    await window.waitForTimeout(400);
    await surface(window, 'search-bar', '.search-bar');
    await window.keyboard.press('Escape'); await window.waitForTimeout(350);

    await window.click('[data-open-preferences]');
    await window.waitForSelector('[data-prefs-dialog]', { state: 'visible', timeout: 8000 }).catch(() => {});
    await window.waitForTimeout(500);
    const ps = await surface(window, 'prefs-sheet', '.sheet');
    if (ps) await zoomShot(window, 'auditA-prefs-sheet.png', ps.rect);
    await window.keyboard.press('Escape'); await window.waitForTimeout(450);

    // Phase 36 (chunk 3) — Optimize is the DELIVER dock's `optimize` verb.
    await openDockVerb(window, 4, 'optimize');
    await window.waitForSelector('.modal-dialog', { state: 'visible', timeout: 8000 }).catch(() => {});
    await window.waitForTimeout(500);
    const md = await surface(window, 'optimize-modal', '.modal-dialog');
    if (md) await zoomShot(window, 'auditA-optimize-modal.png', md.rect);
    await window.keyboard.press('Escape'); await window.waitForTimeout(450);

    // In-canvas textbox toolbox + its action bar.
    await scrollToPage(window, 1);
    await armAnnotationTool(window, 'textbox');
    await window.locator('.pdf-page[data-page="1"]').first().click({ position: { x: 220, y: 260 } }).catch(() => {});
    await window.waitForSelector('.ann-textbox-wrap', { state: 'visible', timeout: 8000 }).catch(() => {});
    await window.waitForTimeout(400);
    const tw = await surface(window, 'ann-textbox-wrap', '.ann-textbox-wrap');
    await surface(window, 'ann-textbox-actions', '.ann-textbox-actions');
    await surface(window, 'ann-textbox-grip', '.ann-textbox-grip');
    await surface(window, 'ann-textbox-editor', '.ann-textbox-editor');
    await surface(window, 'text-panel', '[data-text-panel]');
    if (tw) await zoomShot(window, 'auditA-textbox-toolbox.png', tw.rect);
    await window.keyboard.press('Escape'); await window.waitForTimeout(350);

    // Toast via Ctrl+S (the sample was opened from a writable temp copy).
    await window.keyboard.press('Control+s');
    await window.waitForSelector('.toast', { state: 'visible', timeout: 10000 }).catch(() => {});
    await window.waitForTimeout(300);
    const to = await surface(window, 'toast', '.toast');
    if (to) await zoomShot(window, 'auditA-toast.png', to.rect);

    // OCR suspects bar (heavy: best-effort, never aborts the audit).
    try {
      await runTool(window, 'recognizeText');
      await window.waitForSelector('[data-ocr-confirm]', { timeout: 8000 });
      await window.click('[data-ocr-scope="currentPage"]');
      await window.waitForTimeout(150);
      await window.click('[data-ocr-confirm]');
      await window.waitForSelector('[data-ocr-suspects-panel]', { timeout: 150000 });
      await window.waitForTimeout(500);
      await surface(window, 'ocr-suspects-bar', '[data-ocr-suspects-panel]');
      await window.screenshot({ path: path.join(SHOTS, 'auditA-ocr-bar.png') });
      await window.click('.ocr-suspects-close').catch(() => {});
    } catch (e) {
      report.unmeasured.push('ocr-suspects-bar (OCR run did not complete: ' + e.message.split('\n')[0] + ')');
    }
  } finally {
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    await hardClose(electronApp, 'auditA');
  }
});

// ---------------------------------------------------------------------------
// Audit B — the dropdown seam. For each morphing trigger/surface pair, in all
// three themes: gap, joined-edge borders/radii, background material.
// ---------------------------------------------------------------------------
test('Audit B - dropdown seam', async () => {
  test.setTimeout(240000);
  const { electronApp, window } = await launchDev();
  try {
    await openSample(window, electronApp, 'report.pdf');
    await window.waitForTimeout(900);
    for (const theme of ['light', 'dark', 'frosted']) {
      await setTheme(window, theme);
      await seam(window, 'theme', '[data-theme-toggle]', '.theme-toggle-popover');
      await seam(window, 'titlebar', '.titlebar-menu-button', '.titlebar-menu-popover');
      // Phase 36 (chunk 3) — the ann menu lives in the REVIEW Annotate flyout.
      await openAnnotationFlyout(window);
      await seam(window, 'annmenu', '[data-ann-dropdown-toggle]', '[data-ann-dropdown-menu]');
      await armAnnotationTool(window, 'highlight');
      await window.waitForTimeout(300);
      if ((await window.locator('[data-ann-color]').count()) > 0) {
        await seam(window, 'color', '[data-ann-color]', '[data-color-popover]');
      } else {
        report.unmeasured.push(`seam color-${theme} (swatch [data-ann-color] not present)`);
      }
      await window.keyboard.press('Escape'); await window.waitForTimeout(300);
    }
  } finally {
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    await hardClose(electronApp, 'auditB');
  }
});
