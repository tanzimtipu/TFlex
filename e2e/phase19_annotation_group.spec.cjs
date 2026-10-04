// Phase 19 QA - annotation tools moved into the CommandBar.
//
// The Phase 14.2 standalone `.ann-toolbar` row is retired; the tools are now
// the LAST GlassControlGroup capsule of the CommandBar's `.toolbar`:
//   [data-ann-tools-visible]  -> exactly 5 MRU-first [data-tool] buttons
//   [data-ann-color]          -> colour swatch, immediately LEFT of the arrow
//   [data-ann-dropdown-toggle]-> opens the portaled all-tools menu
//   [data-ann-dropdown-menu]  -> all 11 tools in six labelled groups + ink row
// `data-annotation-toolbar` stays on the group root as an inert hook.
//
// Covers REQUIREMENTS.md Phase 19 success criteria 1-8 + 10 (e2e coverage).
// Screenshots: screenshots/phase19-group-{light,dark,frosted}.png + phase19-menu.png.

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, getSamplePath, openAnnotationFlyout } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

const CANONICAL = ['select', 'highlight', 'underline', 'strikeout', 'ink', 'textbox', 'rect', 'ellipse', 'arrow', 'callout', 'note'];
const GROUP_LABELS = ['Select', 'Text markup', 'Pen', 'Text box', 'Shapes', 'Note'];

async function openReport(electronApp, win) {
  const p = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('[data-home-tool="open"]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(400);
  // Phase 36 (chunk 3) — the annotation group is re-parented into the REVIEW
  // dock's Annotate flyout; its selectors are preserved inside it.
  await openAnnotationFlyout(win);
}

async function visibleIds(win) {
  return win.$$eval('[data-ann-tools-visible] [data-tool]', (els) => els.map((e) => e.getAttribute('data-tool')));
}

async function openMenu(win) {
  // Phase 36 (chunk 3) — the group lives in the REVIEW Annotate flyout, and
  // Escape closes the flyout too, so re-open it (idempotent) before each menu.
  await openAnnotationFlyout(win);
  await win.click('[data-ann-dropdown-toggle]');
  await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'visible', timeout: 8000 });
  await win.waitForTimeout(220); // pop animation settle
}

async function menuOpen(win) {
  return win.locator('[data-ann-dropdown-menu]').count();
}

async function armFromMenu(win, tool) {
  await openMenu(win);
  await win.click(`[data-ann-dropdown-menu] [data-tool="${tool}"]`);
  await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'detached', timeout: 8000 });
  await win.waitForTimeout(300);
}

async function setTheme(win, want) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${want}"]`);
  await win.waitForFunction((w) => document.documentElement.getAttribute('data-theme') === w, want, { timeout: 5000 });
  await win.waitForTimeout(300);
}

// ---------------------------------------------------------------------------
// 1. Layout (DELETED, Phase 36 chunk 3): this test's subject was the retired
//    per-view CommandBar row — "the annotation group is the LAST .toolbar-group
//    capsule of `.toolbar`, the bar stays 52px, the page starts under it". The
//    row is retired; the group now lives in the REVIEW dock's Annotate flyout,
//    whose open/close-on-stage-change placement is covered by
//    phase36_chunk3_dock_gate.spec.cjs (P36-C3-G/H). Nothing else asserted the
//    retired row's own geometry, so this is a deliberate removal, not a
//    weakened migration.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 2. Exactly five visible tool buttons, MRU-first.
// ---------------------------------------------------------------------------
test('visible five: exactly 5 [data-tool] buttons inside [data-ann-tools-visible]', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    const ids = await visibleIds(win);
    console.log(`[p19-visible] ids=${JSON.stringify(ids)}`);
    expect(ids.length, 'exactly five visible tool buttons').toBe(5);
    expect(new Set(ids).size, 'no duplicate visible ids').toBe(5);
    expect(ids, 'fresh profile shows the canonical default five').toEqual(['select', 'highlight', 'underline', 'strikeout', 'ink']);
  } finally {
    await hardClose(app, 'p19-visible');
  }
});

// ---------------------------------------------------------------------------
// 3. MRU: arming a dropdown-only tool promotes it to first, drops the fifth.
// ---------------------------------------------------------------------------
test('MRU: arming callout from the menu promotes it to first; previous first stays; fifth drops', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    const before = await visibleIds(win);
    expect(before).toEqual(['select', 'highlight', 'underline', 'strikeout', 'ink']);

    await armFromMenu(win, 'callout');

    const after = await visibleIds(win);
    console.log(`[p19-mru] before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    expect(after[0], 'armed dropdown tool must be FIRST').toBe('callout');
    expect(after[1], 'the previous first must still be visible').toBe('select');
    expect(after.includes('ink'), 'the fifth-most-recent must drop out').toBe(false);
    expect(after).toEqual(['callout', 'select', 'highlight', 'underline', 'strikeout']);
    expect(after.length).toBe(5);
  } finally {
    await hardClose(app, 'p19-mru');
  }
});

// ---------------------------------------------------------------------------
// 4. Colour swatch: left of the arrow, colour-capable rules, picker applies.
// ---------------------------------------------------------------------------
test('colour: swatch sits left of the arrow, appears for colour tools, opens picker and applies', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);

    // Non-colour tool (Select): no swatch.
    expect(await win.locator('[data-ann-color]').count(), 'no swatch for the non-colour Select tool').toBe(0);

    // Colour tool (Highlight): swatch appears.
    await win.click('[data-ann-tools-visible] [data-tool="highlight"]');
    await win.waitForSelector('[data-ann-color]', { state: 'visible', timeout: 5000 });
    const current0 = await win.locator('[data-ann-color]').getAttribute('data-color-current');

    // DOM order: swatch before the dropdown arrow.
    const order = await win.evaluate(() => {
      const swatch = document.querySelector('[data-ann-color]');
      const toggle = document.querySelector('[data-ann-dropdown-toggle]');
      const pos = swatch.compareDocumentPosition(toggle);
      return {
        swatchBeforeToggle: (pos & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        swatchX: Math.round(swatch.getBoundingClientRect().left),
        toggleX: Math.round(toggle.getBoundingClientRect().left),
      };
    });
    console.log(`[p19-color] current=${current0} order=${JSON.stringify(order)}`);
    expect(order.swatchBeforeToggle, 'swatch must precede the arrow in DOM order').toBe(true);
    expect(order.swatchX, 'swatch must sit left of the arrow').toBeLessThan(order.toggleX);

    // Open the picker popover and apply a built-in colour.
    await win.click('[data-ann-color]');
    await win.waitForSelector('.color-popover', { state: 'visible', timeout: 6000 });
    await win.click('[data-palette-built-in="red"]');
    await win.waitForTimeout(400);
    const current1 = await win.locator('[data-ann-color]').getAttribute('data-color-current');
    console.log(`[p19-color] after red: ${current1}`);
    expect(current1, 'applying a colour updates the swatch data-color-current').toBe('#ef4444');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(200);
  } finally {
    await hardClose(app, 'p19-color');
  }
});

// ---------------------------------------------------------------------------
// 5. Dropdown: aria-expanded + all three close paths + Arrow/Enter keyboard.
// ---------------------------------------------------------------------------
test('dropdown: aria-expanded; Escape / outside click / re-click close; Arrow keys + Enter arm', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);

    // Open: aria-expanded=true.
    await openMenu(win);
    expect(await win.locator('[data-ann-dropdown-toggle]').getAttribute('aria-expanded'), 'open -> aria-expanded true').toBe('true');

    // Escape closes the menu (and the flyout that hosts it).
    await win.keyboard.press('Escape');
    await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'detached', timeout: 5000 });
    await openAnnotationFlyout(win);
    expect(await win.locator('[data-ann-dropdown-toggle]').getAttribute('aria-expanded'), 'Escape -> aria-expanded false').toBe('false');

    // Outside click closes.
    await openMenu(win);
    await win.mouse.click(200, 500);
    await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'detached', timeout: 5000 });

    // Re-clicking the toggle closes.
    await openMenu(win);
    await win.click('[data-ann-dropdown-toggle]');
    await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'detached', timeout: 5000 });
    await openAnnotationFlyout(win);
    expect(await win.locator('[data-ann-dropdown-toggle]').getAttribute('aria-expanded'), 're-click -> aria-expanded false').toBe('false');

    // Keyboard: initial highlight is the active tool (Select, index 0).
    await openMenu(win);
    const hi0 = await win.locator('.ann-tool-menu-row-highlight').getAttribute('data-tool');
    await win.keyboard.press('ArrowDown');
    await win.waitForTimeout(150);
    const hi1 = await win.locator('.ann-tool-menu-row-highlight').getAttribute('data-tool');
    await win.keyboard.press('ArrowUp');
    await win.waitForTimeout(150);
    const hi2 = await win.locator('.ann-tool-menu-row-highlight').getAttribute('data-tool');
    console.log(`[p19-kbd] highlight ${hi0} -> ${hi1} -> ${hi2}`);
    expect(hi0).toBe('select');
    expect(hi1, 'ArrowDown moves the highlight').toBe('highlight');
    expect(hi2, 'ArrowUp moves it back').toBe('select');

    // Enter arms the highlighted tool and closes. Move the highlight onto
    // Highlight first (ArrowUp above returned it to Select).
    await win.keyboard.press('ArrowDown');
    await win.waitForTimeout(150);
    await win.keyboard.press('Enter');
    await win.waitForSelector('[data-ann-dropdown-menu]', { state: 'detached', timeout: 5000 });
    await win.waitForTimeout(250);
    const armed = await win.evaluate(() => window.tflexDiagnostics().activeTool);
    const ids = await visibleIds(win);
    console.log(`[p19-kbd] after Enter activeTool=${armed} visible=${JSON.stringify(ids)}`);
    expect(armed, 'Enter must arm the highlighted tool').toBe('highlight');
    expect(ids[0], 'armed tool promoted to first').toBe('highlight');
  } finally {
    await hardClose(app, 'p19-kbd');
  }
});

// ---------------------------------------------------------------------------
// 6. Menu lists all 11 tools in six labelled groups.
// ---------------------------------------------------------------------------
test('menu lists all 11 tools in the six groups', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await openMenu(win);

    const ids = await win.$$eval('[data-ann-dropdown-menu] [data-tool]', (els) => els.map((e) => e.getAttribute('data-tool')));
    const labels = await win.$$eval('[data-ann-dropdown-menu] [role="group"]', (els) => els.map((e) => e.getAttribute('aria-label')));
    console.log(`[p19-menu] ids=${JSON.stringify(ids)} groups=${JSON.stringify(labels)}`);

    expect(ids.length, 'all eleven tools listed').toBe(11);
    expect(ids, 'menu order matches the canonical order').toEqual(CANONICAL);
    expect(labels, 'six labelled groups').toEqual(GROUP_LABELS);
  } finally {
    await hardClose(app, 'p19-menu');
  }
});

// ---------------------------------------------------------------------------
// 7. Pen width: ink-only row in the menu; clicking changes the armed width.
// ---------------------------------------------------------------------------
test('pen width: row appears only when Ink is armed; clicking changes the width', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);

    // Non-ink armed (Select): no pen row.
    await openMenu(win);
    expect(await win.locator('[data-pen-width-row]').count(), 'no pen row when Select is armed').toBe(0);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(200);

    // Arm Ink, open the menu: pen row present.
    await openAnnotationFlyout(win);
    await win.click('[data-ann-tools-visible] [data-tool="ink"]');
    await win.waitForTimeout(250);
    await openMenu(win);
    await win.waitForSelector('[data-pen-width-row]', { state: 'visible', timeout: 5000 });
    const before = await win.$$eval('[data-pen-width]', (els) => els.map((e) => ({ w: e.getAttribute('data-pen-width'), pressed: e.getAttribute('aria-pressed') })));
    console.log(`[p19-pen] before=${JSON.stringify(before)}`);
    expect(before.find((b) => b.w === '3')?.pressed, 'default ink width 3 is pressed').toBe('true');

    await win.click('[data-pen-width="5"]');
    await win.waitForTimeout(250);
    const after = await win.$$eval('[data-pen-width]', (els) => els.map((e) => ({ w: e.getAttribute('data-pen-width'), pressed: e.getAttribute('aria-pressed') })));
    console.log(`[p19-pen] after=${JSON.stringify(after)}`);
    expect(after.find((b) => b.w === '5')?.pressed, 'clicked width 5 becomes pressed').toBe('true');
    expect(after.find((b) => b.w === '3')?.pressed, 'previous width 3 releases').toBe('false');
  } finally {
    await hardClose(app, 'p19-pen');
  }
});

// ---------------------------------------------------------------------------
// 8. Disabled states: Pan active disables every annotation tool.
//    Phase 36 (chunk 3) — the Edit-mode half of this test is no longer
//    reachable: the annotation group lives in the REVIEW dock's flyout, which
//    only mounts in the REVIEW stage, and turning Edit mode on switches to the
//    EDIT stage (closing the flyout). That assertion is dropped as superseded
//    by the new IA; the Pan half is preserved verbatim.
// ---------------------------------------------------------------------------
test('disabled states: Pan disables all annotation tools; tooltips preserved', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);

    const read = () => win.$$eval('[data-ann-tools-visible] [data-tool]', (els) => els.map((e) => ({
      tool: e.getAttribute('data-tool'),
      disabled: e.disabled,
      ariaDisabled: e.getAttribute('aria-disabled'),
      title: e.getAttribute('title'),
    })));

    // Pan mode active.
    await win.click('[data-hand-toggle]');
    await win.waitForTimeout(400);
    const pan = await read();
    console.log(`[p19-disabled-pan] ${JSON.stringify(pan)}`);
    for (const b of pan) {
      expect(b.disabled, `${b.tool} must be disabled while Pan is active`).toBe(true);
      expect(b.title, `${b.tool} carries the Pan-mode tooltip`).toContain('Pan mode is on');
    }
    await win.keyboard.press('Escape');
    await win.waitForTimeout(300);
  } finally {
    await hardClose(app, 'p19-disabled');
  }
});

// ---------------------------------------------------------------------------
// 9. Persistence: MRU survives restart; settings.json carries it first.
// ---------------------------------------------------------------------------
test('persistence: arming from the menu survives restart with the same user-data dir', async () => {
  test.setTimeout(240000);
  const udd = path.join(os.tmpdir(), 'tflex-phase19-mru');
  fs.rmSync(udd, { recursive: true, force: true });
  fs.mkdirSync(udd, { recursive: true });
  const settingsPath = path.join(udd, 'settings.json');

  let app = await launchApp([], udd, null);
  let win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    await armFromMenu(win, 'callout');
    const ids1 = await visibleIds(win);
    console.log(`[p19-persist] session1 visible=${JSON.stringify(ids1)}`);

    let persisted = null;
    for (let i = 0; i < 24; i += 1) {
      try {
        const j = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        if (Array.isArray(j.annotationRecentTools) && j.annotationRecentTools[0] === 'callout') {
          persisted = j.annotationRecentTools;
          break;
        }
      } catch { /* not written yet */ }
      await win.waitForTimeout(250);
    }
    console.log(`[p19-persist] settings.json annotationRecentTools=${JSON.stringify(persisted)}`);
    expect(persisted, 'settings.json must contain annotationRecentTools with callout first').not.toBeNull();
    expect(persisted[0]).toBe('callout');
  } finally {
    await hardClose(app, 'p19-persist-1');
  }

  app = await launchApp([], udd, null);
  win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openReport(app, win);
    const ids2 = await visibleIds(win);
    console.log(`[p19-persist] session2 visible=${JSON.stringify(ids2)}`);
    expect(ids2[0], 'the persisted MRU tool shows first after restart').toBe('callout');
    expect(ids2).toEqual(['callout', 'select', 'highlight', 'underline', 'strikeout']);
  } finally {
    await hardClose(app, 'p19-persist-2');
  }
});

// ---------------------------------------------------------------------------
// 9b. Menu anchoring: the dropdown opens under its arrow (DEF-225).
// ---------------------------------------------------------------------------
test('anchoring: dropdown opens right-aligned under its arrow, not at the far-left edge', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) w.setSize(1440, 900);
    });
    await openReport(app, win);
    await openMenu(win);

    const measure = () => win.evaluate(() => {
      const m = document.querySelector('[data-ann-dropdown-menu]');
      const t = document.querySelector('[data-ann-dropdown-toggle]');
      const mr = m.getBoundingClientRect();
      const tr = t.getBoundingClientRect();
      return {
        menuLeft: Math.round(mr.left), menuRight: Math.round(mr.right), menuW: Math.round(mr.width),
        menuTop: Math.round(mr.top), menuBottom: Math.round(mr.bottom), menuH: Math.round(mr.height),
        toggleLeft: Math.round(tr.left), toggleRight: Math.round(tr.right),
        toggleTop: Math.round(tr.top), toggleBottom: Math.round(tr.bottom),
        inlineLeft: m.style.left, inlineTop: m.style.top,
        innerWidth: window.innerWidth, innerHeight: window.innerHeight,
      };
    });

    const anchor = await measure();
    console.log(`[p19-anchor] ${JSON.stringify(anchor)}`);
    // DEF-225: `.ann-tool-menu` must carry `position: fixed` so the placement
    // effect measures its own offsetWidth and right-aligns under the arrow.
    expect(anchor.menuRight, 'menu right edge aligns with the toggle right edge').toBeLessThanOrEqual(anchor.toggleRight + 4);
    expect(anchor.menuRight, 'menu right edge aligns with the toggle right edge').toBeGreaterThanOrEqual(anchor.toggleRight - 6);
    // Phase 20 — the all-tools dropdown now MORPHS out of the arrow button:
    // its first frame IS the trigger box and the anchored edge is flush, so
    // the old +6px seam is gone by design. Same intent: anchored under the
    // arrow, not detached.
    // Phase 36 (chunk 3): the annotation group now sits in the REVIEW flyout
    // at the BOTTOM of the canvas, so the menu flips ABOVE the arrow instead
    // of below it. The intent is unchanged: the menu is flush with the toggle
    // edge, not detached.
    const flushBelow = Math.abs(anchor.menuTop - anchor.toggleBottom) <= 1;
    const flushAbove = Math.abs(anchor.menuBottom - anchor.toggleTop) <= 1;
    expect(flushBelow || flushAbove, 'menu is flush with the toggle edge (above or below)').toBe(true);
    // Phase 36 (chunk 3): the toggle moved from the top command row into the
    // bottom REVIEW flyout, so the old "left of centre" proxy no longer holds
    // (a 200px menu right-aligned to a toggle at x~895 starts at ~695, left of
    // 1440/2). The real contract is that the menu is anchored to the arrow, not
    // detached: its left edge sits at toggleRight - menuW.
    expect(
      Math.abs(anchor.menuLeft - (anchor.toggleRight - anchor.menuW)),
      'menu left edge is anchored to the toggle (right-aligned, not detached)',
    ).toBeLessThanOrEqual(6);
    expect(anchor.menuLeft, 'menu fully inside viewport (left)').toBeGreaterThanOrEqual(0);
    expect(anchor.menuRight, 'menu fully inside viewport (right)').toBeLessThanOrEqual(anchor.innerWidth);
    expect(anchor.menuTop, 'menu fully inside viewport (top)').toBeGreaterThanOrEqual(0);
    expect(anchor.menuBottom, 'menu fully inside viewport (bottom)').toBeLessThanOrEqual(anchor.innerHeight);

    await win.screenshot({ path: path.join(SHOTS, 'def-225-retest.png') });

    // Clamp: shrink the window while the menu is open; it must re-place and
    // stay fully on-screen in both axes.
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) w.setSize(820, 700);
    });
    await win.waitForTimeout(400);
    const narrow = await measure();
    console.log(`[p19-anchor-narrow] ${JSON.stringify(narrow)}`);
    expect(narrow.menuLeft, 'narrow: menu fully inside viewport (left)').toBeGreaterThanOrEqual(0);
    expect(narrow.menuRight, 'narrow: menu fully inside viewport (right)').toBeLessThanOrEqual(narrow.innerWidth);
    expect(narrow.menuTop, 'narrow: menu fully inside viewport (top)').toBeGreaterThanOrEqual(0);
    expect(narrow.menuBottom, 'narrow: menu fully inside viewport (bottom)').toBeLessThanOrEqual(narrow.innerHeight);
  } finally {
    await hardClose(app, 'p19-anchor');
  }
});

// ---------------------------------------------------------------------------
// 10. Screenshots: bar + group + open menu in all three themes.
// ---------------------------------------------------------------------------
test('screenshots: group + open menu in light, dark, frosted (+ phase19-menu)', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) w.setSize(1440, 900);
    });
    await openReport(app, win);

    for (const theme of ['light', 'dark', 'frosted']) {
      await setTheme(win, theme);
      await openMenu(win);
      await win.waitForTimeout(350);
      const anchor = await win.evaluate(() => {
        const m = document.querySelector('[data-ann-dropdown-menu]');
        const t = document.querySelector('[data-ann-dropdown-toggle]');
        const mr = m.getBoundingClientRect();
        const tr = t.getBoundingClientRect();
        return {
          menuLeft: Math.round(mr.left), menuRight: Math.round(mr.right), menuW: Math.round(mr.width),
          toggleLeft: Math.round(tr.left), toggleRight: Math.round(tr.right),
          inlineLeft: m.style.left, inlineTop: m.style.top, innerWidth: window.innerWidth,
        };
      });
      console.log(`[p19-shot-anchor:${theme}] ${JSON.stringify(anchor)}`);
      await win.screenshot({ path: path.join(SHOTS, `phase19-group-${theme}.png`), clip: { x: 0, y: 0, width: 1440, height: 430 } });
      await win.keyboard.press('Escape');
      await win.waitForTimeout(250);
    }

    // Dedicated menu shot (full window, frosted default).
    await setTheme(win, 'frosted');
    await openMenu(win);
    await win.waitForTimeout(350);
    await win.screenshot({ path: path.join(SHOTS, 'phase19-menu.png') });
  } finally {
    await hardClose(app, 'p19-shots');
  }
});

