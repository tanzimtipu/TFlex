// PHASE 14.1 COMPARISON CAPTURE - side-by-side evidence vs the Liquid Glass
// reference (qa, 2026-09-13).
//
// Produces the three deliverable surfaces named in the dispatch:
//   screenshots/phase141-comparison-reference.png  (copy of the reference)
//   screenshots/phase141-comparison-actual.png     (window screenshot, palette open)
//   screenshots/phase141-comparison-facts.json     (measured material facts)
// plus phase141-comparison-actual-desktop.png (OS desktop grab with the
// wallpaper behind the window - the wallpaper-through-glass evidence).
//
// The side-by-side composite is assembled afterwards from these artifacts.
// No assertions here beyond structural preconditions: this spec CAPTURES the
// state; the judgment (checklist pass/fail) is recorded in the report. All
// launches go through the canonical launcher.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const REFERENCE_SRC = path.join(SHOTS, 'qa-reference-source.png');
const REFERENCE_OUT = path.join(SHOTS, 'phase141-comparison-reference.png');
const ACTUAL_OUT = path.join(SHOTS, 'phase141-comparison-actual.png');
const ACTUAL_WELCOME = path.join(SHOTS, 'phase141-comparison-actual-welcome.png');
const ACTUAL_DESKTOP = path.join(SHOTS, 'phase141-comparison-actual-desktop.png');
const FACTS_OUT = path.join(SHOTS, 'phase141-comparison-facts.json');

let electronApp = null;
let win = null;

test.describe.serial('phase 14.1 comparison capture', () => {
  test.afterEach(async () => {
    await hardClose(electronApp, 'phase141-comparison');
    electronApp = null;
    win = null;
  });

  test('capture reference copy + workspace screenshots + material facts', async () => {
    test.setTimeout(300000);

    // 1. Reference copy (so the deliverable triple lives in one place).
    fs.copyFileSync(REFERENCE_SRC, REFERENCE_OUT);

    // 2. Launch the dev build (canonical launcher).
    electronApp = await require('./lib/launch.cjs').launchApp();
    win = await electronApp.firstWindow();
    win.on('pageerror', (err) => console.log(`[ELECTRON-ERROR] ${err.message}`));
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(900);
    await win.screenshot({ path: path.join(SHOTS, 'phase141-comparison-actual-welcome.png') });

    // 3. Open report.pdf through the mocked dialog + welcome Open button.
    const reportPath = require('./lib/launch.cjs').getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await win.locator('button:has-text("Open PDF")').first().click();
    await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
    await win.waitForTimeout(2200);

    // 4. Open the Tools palette so both sidebars are visible (reference layout).
    await win.click('[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
    await win.waitForTimeout(700);

    // 5. Window screenshot (renderer view).
    await win.screenshot({ path: ACTUAL_OUT });

    // 6. Full material facts from the live DOM.
    const facts = await win.evaluate(() => {
      const rectOf = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };
      const mat = (sel, opts = {}) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          selector: sel,
          rect: rectOf(el),
          bg: cs.backgroundColor,
          rgba: rgbaOfSafe(cs.backgroundColor),
          backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter || 'none',
          borderRadius: cs.borderRadius,
          boxShadow: cs.boxShadow,
          ...(opts.noAfter ? {} : {
            afterAnimationName: getComputedStyle(el, '::after').animationName,
          }),
        };
      };
      function rgbaOfSafe(str) {
        const m = /rgba?\(([^)]+)\)/.exec(str || '');
        if (!m) return null;
        const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
        return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
      }
      const root = getComputedStyle(document.documentElement);

      // Command bar: heights + control groups.
      const toolbarEl = document.querySelector('.toolbar');
      const groups = Array.from(document.querySelectorAll('.toolbar .glass-control-group')).map((g) => ({
        label: g.getAttribute('aria-label'),
        rect: rectOf(g),
        bg: getComputedStyle(g).backgroundColor,
        rgba: rgbaOfSafe(getComputedStyle(g).backgroundColor),
        radius: getComputedStyle(g).borderRadius,
        border: getComputedStyle(g).borderTopColor,
      }));
      const openBtn = document.querySelector('.commandbar-open');
      const gaps = [];
      for (let i = 1; i < groups.length; i += 1) {
        gaps.push(groups[i].rect.x - (groups[i - 1].rect.x + groups[i - 1].rect.w));
      }

      // Sidebars: both floating glass cards.
      const rail = document.querySelector('.side-rail');
      const palette = document.querySelector('[data-tools-palette]');
      const railHeader = rail ? rail.querySelector('.glass-sidebar-header') : null;
      const palHeader = palette ? palette.querySelector('.tools-palette-header') : null;
      const railTitle = rail ? (rail.querySelector('.glass-sidebar-title') || {}).textContent : null;
      const palTitle = palette ? (palette.querySelector('.tools-palette-title') || {}).textContent : null;

      // Selected thumbnail treatment (page 1 thumb).
      const thumb = rail ? rail.querySelector('.page-thumb[data-page="1"], .rail-thumb[data-page="1"], .side-rail [data-page="1"]') : null;
      const thumbSel = thumb
        ? {
          className: thumb.className,
          border: getComputedStyle(thumb).border,
          borderColor: getComputedStyle(thumb).borderTopColor,
          boxShadow: getComputedStyle(thumb).boxShadow,
          bg: getComputedStyle(thumb).backgroundColor,
        }
        : null;

      // PDF purity.
      const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
      const page = pane ? pane.querySelector('.pdf-page') : null;
      const canvas = page ? page.querySelector('canvas') : null;
      const ws = pane ? pane.querySelector('.workspace-main') : null;
      const pageCs = page ? getComputedStyle(page) : null;
      const canvasCs = canvas ? getComputedStyle(canvas) : null;
      const wsCs = ws ? getComputedStyle(ws) : null;

      // Vertical centering: capsule centers vs toolbar center.
      const tbRect = rectOf(toolbarEl);
      const centerDeviations = groups.map((g) => Math.abs((g.rect.y + g.rect.h / 2) - (tbRect.y + tbRect.h / 2)));

      return {
        theme: document.documentElement.getAttribute('data-theme'),
        windowRadius: getComputedStyle(document.querySelector('.app')).borderRadius,
        tokens: {
          chromeTitlebarH: root.getPropertyValue('--chrome-titlebar-h').trim(),
          chromeCommandbarH: root.getPropertyValue('--chrome-commandbar-h').trim(),
          chromeContextbarH: root.getPropertyValue('--chrome-contextbar-h').trim(),
          glassBg: root.getPropertyValue('--glass-bg').trim(),
          glassChromeBg: root.getPropertyValue('--glass-chrome-bg').trim(),
          glassSidebarBg: root.getPropertyValue('--glass-sidebar-bg').trim(),
          glassGroupBg: root.getPropertyValue('--glass-group-bg').trim(),
          glassSelectedBg: root.getPropertyValue('--glass-selected-bg').trim(),
          panelMargin: root.getPropertyValue('--panel-margin').trim(),
          tfRadiusPanel: root.getPropertyValue('--tf-radius-panel').trim(),
          controlHeight: root.getPropertyValue('--control-height').trim(),
          radiusGroup: root.getPropertyValue('--radius-group').trim(),
        },
        titlebar: mat('.titlebar'),
        appHeader: mat('.app-header'),
        toolbar: mat('.toolbar'),
        toolbarGroups: groups,
        groupGapsPx: gaps,
        groupCenterDeviationPx: centerDeviations,
        openButton: openBtn ? {
          bg: getComputedStyle(openBtn).backgroundColor,
          rgba: rgbaOfSafe(getComputedStyle(openBtn).backgroundColor),
          radius: getComputedStyle(openBtn).borderRadius,
          rect: rectOf(openBtn),
        } : null,
        annToolbar: mat('.ann-toolbar'),
        sideRail: mat('.side-rail'),
        sideRailHeader: railHeader ? {
          bg: getComputedStyle(railHeader).backgroundColor,
          title: (railTitle || '').trim(),
          rect: rectOf(railHeader),
        } : null,
        toolsPalette: mat('[data-tools-palette]'),
        toolsPaletteHeader: palHeader ? {
          bg: getComputedStyle(palHeader).backgroundColor,
          rect: rectOf(palHeader),
        } : null,
        sidebarTitles: { pages: (railTitle || '').trim(), tools: (palTitle || '').trim() },
        // Panels floating: distance from window edges.
        floats: {
          railLeftInset: rail ? Math.round(rectOf(rail).x) : null,
          railBottomInset: rail ? Math.round(window.innerHeight - rectOf(rail).y - rectOf(rail).h) : null,
          paletteRightInset: palette ? Math.round(window.innerWidth - rectOf(palette).x - rectOf(palette).w) : null,
          paletteBottomInset: palette ? Math.round(window.innerHeight - rectOf(palette).y - rectOf(palette).h) : null,
        },
        selectedThumb: thumb ? {
          found: true,
          className: thumb.className,
          bg: getComputedStyle(thumb).backgroundColor,
          border: getComputedStyle(thumb).borderTop,
          boxShadow: getComputedStyle(thumb).boxShadow,
        } : { found: false },
        pdfPage: {
          bg: pageCs ? pageCs.backgroundColor : null,
          backdropFilter: pageCs ? (pageCs.backdropFilter || 'none') : null,
          filter: pageCs ? pageCs.filter : null,
          opacity: pageCs ? pageCs.opacity : null,
          canvasOpacity: canvasCs ? canvasCs.opacity : null,
          canvasBackdrop: canvasCs ? (canvasCs.backdropFilter || 'none') : null,
        },
        workspace: wsCs ? { bg: wsCs.backgroundColor, blur: wsCs.backdropFilter || 'none' } : null,
        htmlBg: getComputedStyle(document.documentElement).backgroundColor,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        zoomChip: mat('.zoom-percent', { noAfter: true }),
        rendererErrors: (window.tflexDiagnostics ? window.tflexDiagnostics() : {}).rendererErrors || null,
      };
    });

    // 7. Desktop grab (wallpaper behind the window).
    const grab = await electronApp.evaluate(async ({ desktopCapturer, screen }) => {
      const prim = screen.getPrimaryDisplay();
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: prim.size.width, height: prim.size.height },
      });
      return { png: sources[0].thumbnail.toPNG().toString('base64'), scaleFactor: prim.scaleFactor };
    });
    fs.writeFileSync(ACTUAL_DESKTOP, Buffer.from(grab.png, 'base64'));
    const bounds = await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getContentBounds());
    facts.windowBounds = bounds;

    fs.writeFileSync(FACTS_OUT, JSON.stringify(facts, null, 1));
    console.log('[phase141] facts saved:', FACTS_OUT);
    console.log('[phase141] window bounds:', JSON.stringify(bounds));

    // Loose sanity gates so a broken capture fails loudly rather than
    // producing a garbage comparison.
    expect(facts.theme).toBe('frosted');
    expect(facts.titlebar).not.toBeNull();
    expect(facts.sideRail).not.toBeNull();
    expect(facts.toolsPalette).not.toBeNull();
    expect(facts.toolbarGroups.length, 'command bar must render grouped capsules').toBeGreaterThanOrEqual(4);
    expect(facts.pdfPage.backdropFilter).toBe('none');
  });
});
