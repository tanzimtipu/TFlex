// DEF-189 + DEF-190 FINAL verification (Phase 14 closing retest, qa 2026-09-13).
//
// DEF-189: the theme dropdown used to render UNDER the Tools palette (the
// palette is z-30 in the root context while the titlebar strip sat at z-2,
// trapping the popover's z-60 inside it) - "Light" was unclickable by mouse.
// Fix under test: the titlebar strip is lifted to z-40, so the popover paints
// - and hit-tests - above the palette while the palette is open.
//
// DEF-190: the stamp-type editor anchored under a stamp near a page's bottom
// edge straddles into the NEXT page's slot subtree, which painted over the
// editor (Cancel unclickable by mouse; Escape did nothing). Fixes under test:
//   1. page lift: .pdf-page[data-stamp-editor-open="true"] { z-index: 70 }
//      mirrored from StampAnnotations selection chrome,
//   2. Escape now closes the editor via a window-level keydown listener.
//
// Every click here is a REAL pointer/keyboard event (Playwright actionability
// checks on) - the defect class is a broken hit-test path, so DOM .click()
// alone proves nothing. Screenshots: screenshots/def-189-final.png,
// screenshots/def-190-final.png.

const { test, expect } = require('@playwright/test');
const { launchDev, openSample, hardClose, shot } = require('./../lib/helpers.cjs');

let electronApp = null;
let win = null;

test.beforeEach(async () => {
  ({ electronApp, window: win } = await launchDev());
  await openSample(win, electronApp, 'report.pdf');
  await win.waitForSelector('.page-slot[data-page="2"]', { timeout: 30000 });
  await win.waitForTimeout(1500);
});

test.afterEach(async () => {
  await hardClose(electronApp, 'def189_190_final');
  electronApp = null;
  win = null;
});

test('DEF-189 FINAL: theme dropdown paints above the open Tools palette; Light/Dark/Frosted all real-clickable', async () => {
  test.setTimeout(240000);

  // The defect geometry: palette OPEN while the popover hangs down over it.
  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
  await win.waitForTimeout(600);

  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.waitForTimeout(500);
  await shot(win, 'def-189-final.png');

  const facts = await win.evaluate(() => {
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const pal = document.querySelector('[data-tools-palette]');
    const pop = document.querySelector('.theme-toggle-popover');
    const tb = document.querySelector('.titlebar');
    const pr = rect(pal);
    const or = rect(pop);
    const overlaps =
      or.x < pr.x + pr.w && or.x + or.w > pr.x && or.y < pr.y + pr.h && or.y + or.h > pr.y;
    const options = {};
    for (const b of document.querySelectorAll('[data-theme-option]')) {
      const r = b.getBoundingClientRect();
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const el = document.elementFromPoint(cx, cy);
      const inPopover = !!(el && el.closest('.theme-toggle-popover'));
      options[b.getAttribute('data-theme-option')] = {
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        hitInsidePopover: inPopover,
        hit: el ? `${el.tagName}.${String(el.className).slice(0, 40)}` : 'none',
      };
    }
    return {
      palette: pr,
      popover: or,
      popoverOverlapsPalette: overlaps,
      titlebarZ: getComputedStyle(tb).zIndex,
      paletteZ: getComputedStyle(pal).zIndex,
      options,
    };
  });
  console.log('[DEF-189 facts]', JSON.stringify(facts, null, 1));

  // Precondition: the popover geometry still overlaps the palette card - the
  // exact layout that made the old build fail. If this is false the repro
  // condition is gone and the assertion below proves nothing.
  expect(facts.popoverOverlapsPalette, 'precondition: popover still overlaps the open palette').toBe(true);
  // Stacking: the titlebar strip (which contains the popover) must out-rank
  // the palette so the popover paints above it.
  expect(Number(facts.titlebarZ), 'titlebar strip must out-rank the palette').toBeGreaterThan(Number(facts.paletteZ));
  // Hit-test: EVERY option's center resolves inside the popover (the old
  // failure: "Light" center returned SPAN.tools-palette-title).
  for (const [value, o] of Object.entries(facts.options)) {
    expect(o.hitInsidePopover, `${value} option center hit ${o.hit} instead of the popover`).toBe(true);
  }

  // Real pointer clicks flip every theme (old failure: real-mouse click on
  // "Light" retried forever against the palette). The popover is still open
  // from the facts pass and the trigger TOGGLES, so the first loop click
  // would close it - close/open state-aware before each pick. Each pick
  // closes the popover again.
  for (const value of ['light', 'dark', 'frosted']) {
    const openAtLoopStart = await win.evaluate(() => !!document.querySelector('.theme-toggle-popover'));
    await win.click('[data-theme-toggle]');
    if (openAtLoopStart) {
      await win.waitForFunction(() => !document.querySelector('.theme-toggle-popover'), undefined, { timeout: 5000 });
      await win.click('[data-theme-toggle]');
    }
    await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
    await win.waitForTimeout(350);
    await win.click(`[data-theme-option="${value}"]`);
    await win
      .waitForFunction(() => !document.querySelector('.theme-toggle-popover'), undefined, { timeout: 5000 })
      .catch(() => {});
    const after = await win.evaluate((v) => ({
      root: document.documentElement.getAttribute('data-theme'),
      diag: (window.tflexDiagnostics() || {}).theme,
      popoverOpen: !!document.querySelector('.theme-toggle-popover'),
      triggerLabel: (document.querySelector('.theme-toggle-label') || {}).textContent,
    }), value);
    console.log(`[DEF-189] after clicking ${value}: ${JSON.stringify(after)}`);
    expect(after.root, `documentElement theme must be ${value}`).toBe(value);
    expect(after.diag, `diagnostics theme must be ${value}`).toBe(value);
    expect(after.popoverOpen, 'popover closes after picking a theme').toBe(false);
    expect((after.triggerLabel || '').length).toBeGreaterThan(0);
  }
});

test('DEF-190 FINAL: stamp type editor at the page boundary - Cancel real-clickable, Escape closes, paints above the next page', async () => {
  test.setTimeout(240000);

  // Scroll so the page-1/page-2 boundary sits ~160px above the viewport
  // bottom: at the default fit-width zoom page 1 is TALLER than the window,
  // so its bottom edge (where the editor must straddle) is off-screen until
  // we scroll it into view.
  const scrolled = await win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const canvas = document.querySelector('.pdf-page[data-page="1"] canvas');
    if (!sc || !canvas) return false;
    const c = canvas.getBoundingClientRect();
    sc.scrollTop += c.bottom - (window.innerHeight - 160);
    return true;
  });
  expect(scrolled, 'scroller + page-1 canvas must be mounted for the boundary scroll').toBe(true);
  await win.waitForTimeout(1200);

  // Place the stamp through the palette flow (same steps as the filing).
  // GEOMETRY NOTE: opening the palette re-fits the zoom (the scroller clips
  // beside the floating card), so the click-point geometry MUST be measured
  // in the palette-open layout - the layout that exists when the page click
  // lands. Measuring before the palette opened resolved the click onto the
  // wrong page in the first run.
  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
  await win.click('[data-tool-id="stamp"]');
  await win.waitForSelector('[data-stamp-dialog]', { timeout: 8000 });
  await win.waitForTimeout(400);
  await win.click('[data-stamp-confirm]');
  await win.waitForTimeout(500);

  const geo = await win.evaluate(() => {
    const canvas = document.querySelector('.pdf-page[data-page="1"] canvas');
    if (!canvas) return null;
    const c = canvas.getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height, vh: window.innerHeight };
  });
  expect(geo, 'page 1 canvas must be mounted (palette-open layout)').not.toBeNull();
  const clickX = geo.x + geo.w * 0.6;
  const clickY = geo.y + geo.h - 100;
  expect(clickY, 'stamp anchor must be inside the visible viewport').toBeLessThan(geo.vh - 10);
  expect(clickY, 'stamp anchor must be near page 1 bottom, inside the page').toBeGreaterThan(geo.y);
  await win.mouse.click(clickX, clickY);
  await win.waitForSelector('.stamp-annotation', { timeout: 8000 });
  await win.waitForTimeout(600);

  // Close the palette: the floating sheet covers the page's right side and
  // would intercept the selection click (same note as the TOOLBOXES spec).
  await win.click('[data-tools-toggle]');
  await win.waitForTimeout(700);

  await win.locator('.stamp-annotation').first().click();
  await win.waitForTimeout(400);
  const editBtn = win.locator('[data-content-action="stamp-edit"]').first();
  await editBtn.click();
  await win.waitForSelector('[data-stamp-type-editor]', { timeout: 5000 });
  await win.waitForTimeout(400);
  await shot(win, 'def-190-final.png');

  const ed = await win.evaluate(() => {
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom };
    };
    const editor = document.querySelector('[data-stamp-type-editor]');
    const host = editor.closest('.pdf-page');
    const hostSlot = host.closest('.page-slot');
    const nextSlot = hostSlot.nextElementSibling;
    const cancel = document.querySelector('[data-stamp-type-cancel]');
    const firstTypeBtn = document.querySelector('[data-stamp-type-btn]');
    const hit = (el) => {
      const r = el.getBoundingClientRect();
      const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (!e) return 'none';
      return e.closest('[data-stamp-type-editor]') ? 'editor' : `${e.tagName}.${String(e.className).slice(0, 40)}`;
    };
    const erBottom = rect(editor).bottom;
    return {
      hostPage: host.getAttribute('data-page'),
      hostPageClass: host.className,
      straddleEditorOverSlot: erBottom > rect(hostSlot).bottom,
      straddleEditorOverPage: erBottom > rect(host).bottom,
      editorBottom: Math.round(erBottom),
      hostPageBottom: Math.round(rect(host).bottom),
      hostLiftAttr: host.getAttribute('data-stamp-editor-open'),
      hostZ: getComputedStyle(host).zIndex,
      nextSlotZ: nextSlot ? getComputedStyle(nextSlot).zIndex : null,
      editorZ: getComputedStyle(editor).zIndex,
      cancelHit: hit(cancel),
      cancelHitTag: (document.elementFromPoint(
        cancel.getBoundingClientRect().x + cancel.getBoundingClientRect().width / 2,
        cancel.getBoundingClientRect().y + cancel.getBoundingClientRect().height / 2,
      ) || {}).tagName,
      typeBtnHit: hit(firstTypeBtn),
    };
  });
  console.log('[DEF-190 facts]', JSON.stringify(ed, null, 1));

  // The repro condition itself: the editor must extend past the HOST page's
  // bottom boundary into the next page's slot region - otherwise this test
  // is not testing the defect.
  expect(ed.hostPage, 'the placed stamp must sit on page 1 as filed').toBe('1');
  expect(ed.straddleEditorOverSlot, 'editor must straddle the host page boundary (repro condition)').toBe(true);
  expect(ed.straddleEditorOverPage).toBe(true);
  // Fix 1: the page lift is active while the editor is open.
  expect(ed.hostLiftAttr, 'host page must carry the stamp-editor lift attribute').toBe('true');
  expect(Number(ed.hostZ), 'lifted host page z-index').toBe(70);
  // The editor (z 60) now paints above the sibling pages because its host
  // page is lifted above them.
  expect(ed.editorZ).toBe('60');
  // Hit-test: the editor is the topmost element at its own controls - the
  // old failure returned page 2's DIV.textLayer.
  expect(ed.cancelHit, 'Cancel button hit-test must land inside the editor').toBe('editor');
  expect(ed.typeBtnHit, 'stamp-type button hit-test must land inside the editor').toBe('editor');

  // THE core DEF-190 assertion: a REAL mouse click on Cancel closes it.
  await win.click('[data-stamp-type-cancel]');
  await win.waitForFunction(() => !document.querySelector('[data-stamp-type-editor]'), undefined, { timeout: 5000 });
  console.log('[DEF-190] Cancel real-mouse click closed the editor');

  // The action bar remains (the stamp is still selected) - reopen and close
  // with Escape (the second fix: the editor previously had no keyboard exit).
  await win.locator('[data-content-action="stamp-edit"]').first().click();
  await win.waitForSelector('[data-stamp-type-editor]', { timeout: 5000 });
  await win.waitForTimeout(300);
  await win.keyboard.press('Escape');
  await win.waitForFunction(() => !document.querySelector('[data-stamp-type-editor]'), undefined, { timeout: 5000 });
  console.log('[DEF-190] Escape closed the editor');

  // Editor type buttons are also real-clickable and apply instantly. The
  // active button is disabled-looking; pick a DIFFERENT one by its real id
  // (ids are uppercase union values like APPROVED/CONFIDENTIAL).
  await win.locator('[data-content-action="stamp-edit"]').first().click();
  await win.waitForSelector('[data-stamp-type-editor]', { timeout: 5000 });
  const ids = await win.evaluate(() => ({
    current: document.querySelector('.stamp-annotation').getAttribute('data-stamp-id'),
    buttons: Array.from(document.querySelectorAll('[data-stamp-type-btn]')).map((b) => b.getAttribute('data-stamp-type-btn')),
  }));
  const target = ids.buttons.find((id) => id !== ids.current);
  expect(target, 'a different stamp type button must exist to pick').toBeTruthy();
  await win.click(`[data-stamp-type-btn="${target}"]`);
  await win.waitForFunction(() => !document.querySelector('[data-stamp-type-editor]'), undefined, { timeout: 5000 });
  // The retype round-trips the engine (async) before the placed stamp's
  // attribute reflects the new id - wait for the DOM to actually update.
  await win.waitForFunction(
    (want) => {
      const s = document.querySelector('.stamp-annotation');
      return !!s && s.getAttribute('data-stamp-id') === want;
    },
    target,
    { timeout: 8000 },
  ).catch(() => {});
  const afterPick = await win.evaluate(() => ({
    id: document.querySelector('.stamp-annotation').getAttribute('data-stamp-id'),
  }));
  expect(afterPick.id, 'picking a stamp type applies instantly').toBe(target);
  console.log(`[DEF-190] type pick ${ids.current} -> ${afterPick.id} applied via real click`);

  // Lifecycle: deselecting the stamp clears the lift attribute (a stuck
  // attribute would keep the page lifted forever).
  const deselect = await win.evaluate(() => {
    const c = document.querySelector('.pdf-page[data-page="1"] canvas').getBoundingClientRect();
    return { x: c.x, y: c.y, w: c.width, h: c.height };
  });
  await win.mouse.click(deselect.x + deselect.w * 0.3, deselect.y + deselect.h * 0.2);
  await win.waitForTimeout(500);
  const liftAfterDeselect = await win.evaluate(
    () => document.querySelector('.pdf-page[data-page="1"]').getAttribute('data-stamp-editor-open'),
  );
  expect(liftAfterDeselect, 'lift attribute must clear on deselect').toBe('false');
});

test('Phase 14 FINAL checklist facts on the fixed build (glass, insets, corners, Pages header, descriptions)', async () => {
  test.setTimeout(180000);

  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
  await win.waitForTimeout(600);

  const facts = await win.evaluate(() => {
    const glass = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(cs.backgroundColor);
      return {
        bg: cs.backgroundColor,
        blur: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
        radius: cs.borderRadius,
        inset: { x0: Math.round(r.x), x1: Math.round(r.x + r.width), y0: Math.round(r.y), y1: Math.round(r.y + r.height) },
        windowW: window.innerWidth,
        windowH: window.innerHeight,
        rgba: m ? { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: Number(m[4]) } : null,
      };
    };
    const app = document.querySelector('.app');
    const rail = document.querySelector('.side-rail');
    const pal = document.querySelector('[data-tools-palette]');
    // Phase 14.1: the Pages header is the shared GlassSidebar header —
    // the title span is .glass-sidebar-title (the legacy .rail-title
    // span is gone with the docked rail).
    const railTitle = (rail && rail.querySelector('.glass-sidebar-title') || {}).textContent;
    const descs = Array.from(document.querySelectorAll('.tools-palette-entry')).map((e) => ({
      id: e.getAttribute('data-tool-id'),
      label: ((e.querySelector('.tools-palette-entry-label') || {}).textContent || '').trim(),
      desc: ((e.querySelector('.tools-palette-entry-desc') || {}).textContent || '').trim(),
    }));
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      appRadius: getComputedStyle(app).borderRadius,
      titlebar: glass('.titlebar'),
      rail: glass('.side-rail'),
      palette: glass('[data-tools-palette]'),
      railTitle: (railTitle || '').trim(),
      paletteEntries: descs.length,
      entriesWithoutDesc: descs.filter((d) => !d.label || !d.desc).map((d) => d.id),
      palettePanelInsetRight: pal ? Math.round(window.innerWidth - pal.getBoundingClientRect().right) : null,
      palettePanelInsetBottom: pal ? Math.round(window.innerHeight - pal.getBoundingClientRect().bottom) : null,
    };
  });
  console.log('[P14 final facts]', JSON.stringify(facts, null, 1));

  expect(facts.theme).toBe('frosted');
  // Phase-14.1 NEUTRAL glass contract: the films are pure-white
  // translucent sheets (blue is accent-only now — Open button, selected
  // states, focus), carrying the 20px glass blur.
  for (const name of ['titlebar', 'rail', 'palette']) {
    const s = facts[name];
    expect(s, `${name} present`).not.toBeNull();
    expect(s.rgba, `${name} background must be translucent`).not.toBeNull();
    expect(s.rgba.a, `${name} film alpha`).toBeLessThan(0.9);
    expect(s.rgba.r, `${name} film must be neutral white (R 255)`).toBe(255);
    expect(s.rgba.g, `${name} film must be neutral white (G 255)`).toBe(255);
    expect(s.rgba.b, `${name} film must be neutral white (B 255)`).toBe(255);
    expect(s.blur, `${name} frosted blur`).toContain('blur(20px)');
  }
  // Rounded corners (Phase 14.1 radii hierarchy): window shell in the
  // 18-22px band, panels at the 16px panel radius.
  const appR = parseFloat(facts.appRadius);
  expect(appR, 'window shell radius must sit in the 14.1 window band (18-22px)').toBeGreaterThanOrEqual(18);
  expect(appR).toBeLessThanOrEqual(22);
  expect(facts.palette.radius).toContain('16px');
  // Floating inset panels with gutters (16px right / 12px bottom).
  expect(facts.palettePanelInsetRight).toBeGreaterThanOrEqual(12);
  expect(facts.palettePanelInsetRight).toBeLessThanOrEqual(20);
  expect(facts.palettePanelInsetBottom).toBeGreaterThanOrEqual(8);
  expect(facts.palettePanelInsetBottom).toBeLessThanOrEqual(16);
  // "Pages" header present on the rail (DEF-185 contract).
  expect(facts.railTitle).toBe('Pages');
  // Tool descriptions present (bold title + description, Phase 14 feature 2).
  expect(facts.paletteEntries).toBeGreaterThanOrEqual(14);
  expect(facts.entriesWithoutDesc, 'every tool needs label + description').toEqual([]);
});