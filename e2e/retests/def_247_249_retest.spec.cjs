// FIX-READY retest for DEF-247 (square docked panels), DEF-248 (dropdown
// seam) and DEF-249 (menu radius 5px light/dark vs 8px frosted).
//
// Independent measurement in the REAL dev app (canonical launchDev only):
//   DEF-247 - computed radii (all four corners) of .side-rail,
//             [data-tools-palette] and [data-text-panel] in all three themes,
//             text panel open and closed; page-facing corners must resolve to
//             --radius-panel (16px), window-edge corners stay 0.
//   DEF-248 - for each of the four dropdowns: gap (expect 0), the trigger's
//             and the surface's joined-edge radius/border (expect squared/0),
//             background continuity across the join, in all three themes.
//   DEF-249 - one menu radius (--radius-3, 8px) across all themes.
//   Plus: closed trigger reverts to its pill and re-click closes; Phase-20
//   morph first frame == trigger rect; Phase-21 panel reflow spot-check.
//
// Evidence: screenshots/def247-249-*.png + screenshots/def247-249-retest.json
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchDev, openSample, hardClose, armAnnotationTool } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const REPORT = path.join(SHOTS, 'def247-249-retest.json');
const report = { tokens: {}, panels: {}, seams: {}, triggerRevert: {}, morph: {}, reflow: {} };
const THEMES = ['light', 'dark', 'frosted'];

async function setTheme(win, theme) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { state: 'visible', timeout: 8000 });
  await win.click(`[data-theme-option="${theme}"]`);
  await win.waitForFunction((w) => document.documentElement.getAttribute('data-theme') === w, theme, { timeout: 8000 });
  await win.waitForTimeout(500);
}

async function radii(win, sel) {
  return win.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tl: cs.borderTopLeftRadius, tr: cs.borderTopRightRadius,
      br: cs.borderBottomRightRadius, bl: cs.borderBottomLeftRadius,
      borderTop: cs.borderTopWidth, borderBottom: cs.borderBottomWidth,
      bg: cs.backgroundColor,
      rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      theme: document.documentElement.getAttribute('data-theme'),
    };
  }, sel);
}

async function zoomShot(win, name, rect, pad = 30) {
  await win.screenshot({
    path: path.join(SHOTS, name),
    clip: { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), width: rect.w + pad * 2, height: rect.h + pad * 2 },
  });
}

// ---------------------------------------------------------------------------
// DEF-247 - docked panel radii.
// ---------------------------------------------------------------------------
test('DEF-247 docked panel radii in all three themes', async () => {
  test.setTimeout(300000);
  const { electronApp, window } = await launchDev();
  try {
    report.tokens = await window.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return {
        radiusPanel: cs.getPropertyValue('--radius-panel').trim(),
        radius3: cs.getPropertyValue('--radius-3').trim(),
        panelRadius: cs.getPropertyValue('--panel-radius').trim(),
      };
    });
    expect(report.tokens.radiusPanel, '--radius-panel is the 16px ladder token').toBe('16px');
    expect(report.tokens.panelRadius, '--panel-radius resolves to --radius-panel').toBe('16px');

    await openSample(window, electronApp, 'report.pdf');
    await window.waitForTimeout(900);

    for (const theme of THEMES) {
      await setTheme(window, theme);

      // Tools palette (right dock, page-facing LEFT corners).
      if ((await window.locator('[data-tools-palette]').count()) === 0) {
        await window.click('[data-tools-toggle]');
        await window.waitForSelector('[data-tools-palette]', { state: 'visible', timeout: 8000 });
      }
      await window.waitForTimeout(500);
      const rail = await radii(window, '.side-rail');
      const palette = await radii(window, '[data-tools-palette]');
      report.panels[`${theme}-closed`] = { rail, palette };
      await window.screenshot({ path: path.join(SHOTS, `def247-249-panels-${theme}-closed.png`) });

      // Close the palette: its header overlaps the annotation toolbar and
      // would intercept the tool-arm click.
      await window.click('[data-tools-toggle]');
      await window.waitForTimeout(500);

      // Text panel (middle dock, page-facing RIGHT corners) - arm a
      // text-bearing annotation tool to open it.
      await armAnnotationTool(window, 'textbox');
      await window.waitForSelector('.text-props-panel', { state: 'visible', timeout: 8000 });
      await window.waitForTimeout(600);
      const textPanel = await radii(window, '.text-props-panel');
      const textBody = await radii(window, '[data-text-panel]');
      const railOpen = await radii(window, '.side-rail');
      report.panels[`${theme}-open`] = { rail: railOpen, textPanel, textBody };
      await window.screenshot({ path: path.join(SHOTS, `def247-249-panels-${theme}-open.png`) });

      // Assertions: page-facing corners round to 16px, window-edge stay 0.
      expect(rail, `${theme}: .side-rail present`).not.toBeNull();
      expect([rail.tl, rail.bl], `${theme}: rail window-edge corners square`).toEqual(['0px', '0px']);
      expect([rail.tr, rail.br], `${theme}: rail page-facing corners 16px`).toEqual(['16px', '16px']);

      expect(palette, `${theme}: tools palette present`).not.toBeNull();
      expect([palette.tr, palette.br], `${theme}: palette window-edge corners square`).toEqual(['0px', '0px']);
      expect([palette.tl, palette.bl], `${theme}: palette page-facing corners 16px`).toEqual(['16px', '16px']);

      expect(textPanel, `${theme}: text panel present`).not.toBeNull();
      expect([textPanel.tl, textPanel.bl], `${theme}: text panel window-edge corners square`).toEqual(['0px', '0px']);
      expect([textPanel.tr, textPanel.br], `${theme}: text panel page-facing corners 16px`).toEqual(['16px', '16px']);
      expect(textBody, `${theme}: [data-text-panel] body present`).not.toBeNull();
      expect([textBody.tr, textBody.br], `${theme}: text body inherits the frame corner`).toEqual(['16px', '16px']);

      // Close the text panel for the next theme.
      await armAnnotationTool(window, 'select');
      await window.waitForTimeout(500);
    }
  } finally {
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    await hardClose(electronApp, 'def247');
  }
});

// ---------------------------------------------------------------------------
// DEF-248 / DEF-249 - the unified dropdown join + one menu radius.
// ---------------------------------------------------------------------------
const MENUS = [
  { name: 'theme', trigger: '[data-theme-toggle]', surface: '.theme-toggle-popover', joined: 'right', indicator: false },
  { name: 'titlebar', trigger: '.titlebar-menu-button', surface: '.titlebar-menu-popover', joined: 'left', indicator: false },
  { name: 'annmenu', trigger: '[data-ann-dropdown-toggle]', surface: '.ann-tool-menu', joined: 'right', indicator: false },
  { name: 'color', trigger: '[data-ann-color]', surface: '[data-color-popover]', joined: 'right', indicator: true },
];

async function measureSeam(win, menu) {
  await win.click(menu.trigger);
  await win.waitForSelector(menu.surface, { state: 'visible', timeout: 8000 });
  await win.waitForTimeout(500);
  const data = await win.evaluate(([ts, ss]) => {
    const t = document.querySelector(ts), s = document.querySelector(ss);
    if (!t || !s) return null;
    const tc = getComputedStyle(t), sc = getComputedStyle(s);
    const tr = t.getBoundingClientRect(), sr = s.getBoundingClientRect();
    const pack = (c, r) => ({
      rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
      tl: c.borderTopLeftRadius, tr: c.borderTopRightRadius,
      br: c.borderBottomRightRadius, bl: c.borderBottomLeftRadius,
      borderTop: c.borderTopWidth, borderBottom: c.borderBottomWidth,
      bg: c.backgroundColor, bgImage: c.backgroundImage,
    });
    return {
      gap: +(sr.top - tr.bottom).toFixed(2),
      overlapX: +(Math.min(tr.right, sr.right) - Math.max(tr.left, sr.left)).toFixed(1),
      trigger: pack(tc, tr), surface: pack(sc, sr),
      theme: document.documentElement.getAttribute('data-theme'),
    };
  }, [menu.trigger, menu.surface]);
  if (data) {
    const t = data.trigger.rect, s = data.surface.rect;
    await win.screenshot({
      path: path.join(SHOTS, `def247-249-join-${menu.name}-${data.theme}.png`),
      clip: { x: Math.max(0, Math.min(t.x, s.x) - 30), y: Math.max(0, t.y + t.h - 34), width: Math.max(t.w, s.w) + 60, height: 90 },
    });
  }
  return data;
}

async function closeMenu(win, menu) {
  await win.keyboard.press('Escape');
  await win.waitForTimeout(400);
  if (await win.locator(menu.surface).isVisible().catch(() => false)) {
    await win.click(menu.trigger).catch(() => {});
    await win.waitForTimeout(400);
  }
}

test('DEF-248/249 unified dropdown join + one menu radius', async () => {
  test.setTimeout(360000);
  const { electronApp, window } = await launchDev();
  try {
    await openSample(window, electronApp, 'report.pdf');
    await window.waitForTimeout(900);

    for (const theme of THEMES) {
      await setTheme(window, theme);

      for (const menu of MENUS) {
        if (menu.name === 'color') {
          // Arm highlight immediately before the colour measurement: the
          // Escape that closes each preceding menu disarms the tool, so the
          // swatch only exists while a colour-capable tool is active.
          await armAnnotationTool(window, 'highlight');
          await window.waitForTimeout(300);
        }
        if (menu.name === 'color' && (await window.locator('[data-ann-color]').count()) === 0) {
          report.seams[`${menu.name}-${theme}`] = { unmeasured: 'swatch [data-ann-color] absent' };
          continue;
        }
        const d = await measureSeam(window, menu);
        report.seams[`${menu.name}-${theme}`] = d;
        expect(d, `${menu.name}-${theme}: seam measurable`).not.toBeNull();

        // DEF-248: gap 0, joined corners squared, joined hairline gone.
        expect(d.gap, `${menu.name}-${theme}: gap 0`).toBeLessThanOrEqual(0.5);
        expect(d.surface.borderTop, `${menu.name}-${theme}: surface joined hairline removed`).toBe('0px');
        if (menu.joined === 'right') {
          expect(d.surface.tr, `${menu.name}-${theme}: surface joined corner squared`).toBe('0px');
        } else {
          expect(d.surface.tl, `${menu.name}-${theme}: surface joined corner squared`).toBe('0px');
        }
        expect([d.trigger.bl, d.trigger.br], `${menu.name}-${theme}: trigger joined corners squared`).toEqual(['0px', '0px']);

        // DEF-249: the exposed corner is the ONE menu radius (8px) in every theme.
        const exposed = menu.joined === 'right' ? d.surface.tl : d.surface.tr;
        expect(exposed, `${menu.name}-${theme}: exposed corner is --radius-3 (8px)`).toBe('8px');

        // DEF-248: background continuity across the join (the colour swatch
        // is a colour indicator, so it joins by dropping its bottom border).
        if (menu.indicator) {
          expect(d.trigger.borderBottom, `${menu.name}-${theme}: swatch bottom border dropped`).toBe('0px');
        } else {
          expect(d.trigger.bg, `${menu.name}-${theme}: trigger background merges into the surface`).toBe(d.surface.bg);
        }

        await closeMenu(window, menu);
      }
    }
  } finally {
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    await hardClose(electronApp, 'def248');
  }
});

// ---------------------------------------------------------------------------
// Trigger revert + Phase-20 morph + Phase-21 reflow spot-checks.
// ---------------------------------------------------------------------------
test('trigger revert, Phase-20 morph, Phase-21 reflow', async () => {
  test.setTimeout(240000);
  const { electronApp, window } = await launchDev();
  try {
    await openSample(window, electronApp, 'report.pdf');
    await window.waitForTimeout(900);

    // --- closed trigger reverts to its normal pill, re-click closes ---
    const closedBefore = await radii(window, '[data-theme-toggle]');
    await window.click('[data-theme-toggle]');
    await window.waitForSelector('.theme-toggle-popover', { state: 'visible', timeout: 8000 });
    await window.waitForTimeout(400);
    const openTrigger = await radii(window, '[data-theme-toggle]');
    await window.click('[data-theme-toggle]'); // re-click closes
    await window.waitForSelector('.theme-toggle-popover', { state: 'detached', timeout: 8000 }).catch(() => {});
    await window.waitForTimeout(400);
    const closedAfter = await radii(window, '[data-theme-toggle]');
    report.triggerRevert = { closedBefore, openTrigger, closedAfter };
    expect(openTrigger.bl, 'open trigger joined corner squared').toBe('0px');
    expect(closedAfter.bl, 'closed trigger bottom-left reverts to the pill radius').toBe(closedBefore.bl);
    expect(closedAfter.br, 'closed trigger bottom-right reverts to the pill radius').toBe(closedBefore.br);
    expect(closedAfter.bl, 'closed trigger is not square').not.toBe('0px');
    expect(await window.locator('.theme-toggle-popover').count(), 're-click closed the popover').toBe(0);

    // --- Phase-20 morph: first painted frame == trigger rect ---
    await window.evaluate(() => {
      window.__m = { rows: [], running: false };
      window.__mStart = (sel, ms) => {
        window.__m = { rows: [], running: true };
        const t0 = performance.now();
        const tick = () => {
          const el = document.querySelector(sel);
          if (el) {
            const r = el.getBoundingClientRect();
            window.__m.rows.push({ x: +r.left.toFixed(2), y: +r.top.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2), op: +getComputedStyle(el).opacity });
          } else {
            window.__m.rows.push({ gone: true });
          }
          if (performance.now() - t0 < ms) requestAnimationFrame(tick);
          else window.__m.running = false;
        };
        requestAnimationFrame(tick);
      };
    });
    const trig = await radii(window, '[data-theme-toggle]');
    await window.evaluate((m) => window.__mStart('.theme-toggle-popover', m), 700);
    await window.click('[data-theme-toggle]');
    await window.waitForSelector('.theme-toggle-popover', { state: 'visible', timeout: 8000 });
    await window.waitForFunction(() => window.__m.running === false, null, { timeout: 8000 }).catch(() => {});
    const rows = await window.evaluate(() => window.__m.rows);
    const live = rows.filter((r) => !r.gone);
    const first = live[0];
    report.morph = { trigger: trig.rect, first, frames: live.length };
    expect(live.length, 'morph produced frames').toBeGreaterThan(3);
    expect(Math.abs(first.x - trig.rect.x), 'morph first frame x == trigger x').toBeLessThanOrEqual(2.5);
    expect(Math.abs(first.y - trig.rect.y), 'morph first frame y == trigger y').toBeLessThanOrEqual(2.5);
    expect(Math.abs(first.w - trig.rect.w), 'morph first frame w == trigger w').toBeLessThanOrEqual(2.5);
    expect(Math.abs(first.h - trig.rect.h), 'morph first frame h == trigger h').toBeLessThanOrEqual(2.5);
    await window.keyboard.press('Escape');
    await window.waitForTimeout(400);

    // --- Phase-21 panel reflow spot-check ---
    const mainClosed = await window.evaluate(() => +document.querySelector('.workspace-main').getBoundingClientRect().left.toFixed(1));
    await armAnnotationTool(window, 'textbox');
    await window.waitForSelector('.text-props-panel', { state: 'visible', timeout: 8000 });
    await window.waitForTimeout(700);
    const openState = await window.evaluate(() => {
      const p = document.querySelector('.text-props-panel');
      const m = document.querySelector('.workspace-main');
      return { panelW: +p.getBoundingClientRect().width.toFixed(1), mainLeft: +m.getBoundingClientRect().left.toFixed(1) };
    });
    await armAnnotationTool(window, 'select');
    await window.waitForTimeout(700);
    const mainReopened = await window.evaluate(() => +document.querySelector('.workspace-main').getBoundingClientRect().left.toFixed(1));
    report.reflow = { mainClosed, openState, mainReopened };
    expect(openState.panelW, 'panel opens to its full width').toBeGreaterThan(240);
    expect(openState.mainLeft, 'page view reflows right when the panel opens').toBeGreaterThan(mainClosed + 100);
    expect(Math.abs(mainReopened - mainClosed), 'page view returns when the panel closes').toBeLessThanOrEqual(2);
  } finally {
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    await hardClose(electronApp, 'def247-249-extra');
  }
});