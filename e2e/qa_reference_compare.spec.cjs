// qa - REFERENCE-VS-ACTUAL glass comparison capture (Phase 14 look-and-feel).
// NOT a pass/fail gate: this spec CAPTURES evidence for the manual comparison
// against screenshots/qa-reference-source.png (the reference mock).
//   - qa-comparison-actual-desktop${SUF}.png : OS composited screen grab (what the
//     user actually sees, incl. whatever shows through the glass)
//   - qa-comparison-actual-window${SUF}.png  : renderer surface (alpha audit source)
//   - qa-comparison-facts${SUF}.json         : DOM facts (rects, computed styles,
//                                        tool entries, clipping)
// All pixel math lives in e2e/lib/compare_analysis.cjs (run afterwards).
// Canonical launcher; dev build; report.pdf sample; backdrop = aurora form
// started separately (e2e/lib/aurora_backdrop.ps1) BEFORE this spec runs.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
// QA_COMP_SUFFIX lets a second run (different backdrop) write side files,
// e.g. QA_COMP_SUFFIX=-dark -> qa-comparison-actual-desktop-dark.png.
const SUF = process.env.QA_COMP_SUFFIX || '';

test('capture actual app state for reference comparison', async () => {
  test.setTimeout(600000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  const errors = [];
  win.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });

  // 1. Fresh launch state
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(800);
  const theme = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
  console.log(`[theme] fresh launch data-theme = ${theme}`);

  // 2. Position the window: centered, 1440x860 DIP (leaves aurora margins on
  //    a 2560x1440 screen for the wallpaper-through check).
  const placed = await electronApp.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const disp = screen.getPrimaryDisplay();
    const width = 1440, height = 860;
    const x = disp.workArea.x + Math.round((disp.workArea.width - width) / 2);
    const y = disp.workArea.y + Math.round((disp.workArea.height - height) / 2);
    w.setBounds({ x, y, width, height });
    w.focus();
    return { bounds: w.getContentBounds(), scaleFactor: disp.scaleFactor, screen: disp.size };
  });
  console.log(`[window] ${JSON.stringify(placed)}`);
  await win.waitForTimeout(700);

  // 3. Open report.pdf
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await win.waitForTimeout(2500);

  // 4. Zoom until the readout reaches the reference's ~372% (page 1 fills the
  //    canvas like the mock). Steps capped; read .zoom-percent each click.
  let zoom = null;
  for (let i = 0; i < 45; i += 1) {
    zoom = await win.evaluate(() => {
      const z = document.querySelector('.zoom-percent');
      return z ? parseFloat(z.textContent) : null;
    });
    if (zoom !== null && zoom >= 370) break;
    await win.click('button[title="Zoom in"]');
    await win.waitForTimeout(90);
  }
  console.log(`[zoom] settled at ${zoom}%`);
  await win.waitForTimeout(3500); // canvas re-render at high zoom

  // 5. Tools palette, list layout (the reference shows the list with descriptions)
  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
  await win.waitForTimeout(500);
  const pressedLayout = await win.evaluate(() => {
    const pal = document.querySelector('[data-tools-palette]');
    const listBtn = pal.querySelector('[data-tools-layout="list"]');
    return listBtn ? listBtn.getAttribute('aria-pressed') : null;
  });
  if (pressedLayout !== 'true') {
    await win.click('[data-tools-layout="list"]');
    await win.waitForTimeout(500);
  }
  await win.waitForTimeout(300);

  // 6. DOM facts for the analysis (rects in window fractions + style facts)
  const facts = await win.evaluate(() => {
    const frac = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x0: r.left / window.innerWidth, x1: r.right / window.innerWidth,
        y0: r.top / window.innerHeight, y1: r.bottom / window.innerHeight,
        px: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      };
    };
    const styleOf = (sel, pseudo) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el, pseudo || null);
      return {
        bg: cs.backgroundColor,
        backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
        borderRadius: cs.borderRadius,
        borderLeftStyle: cs.borderLeftStyle,
        boxShadow: cs.boxShadow,
      };
    };
    const entries = Array.from(document.querySelectorAll('.tools-palette-entry')).map((e) => {
      const label = e.querySelector('.tools-palette-entry-label');
      const desc = e.querySelector('.tools-palette-entry-desc, .tools-palette-entry-description');
      const icon = e.querySelector('.tools-palette-entry-icon');
      const lr = label ? label.getBoundingClientRect() : null;
      const dr = desc ? desc.getBoundingClientRect() : null;
      return {
        id: e.getAttribute('data-tool-id'),
        label: label ? label.textContent.trim() : null,
        labelWeight: label ? getComputedStyle(label).fontWeight : null,
        labelClipped: lr ? lr.width < label.scrollWidth - 1 : null,
        desc: desc ? desc.textContent.trim() : null,
        descPresent: !!desc,
        descClipped: desc ? dr.width < desc.scrollWidth - 1 : null,
        descFontSize: desc ? getComputedStyle(desc).fontSize : null,
        iconPresent: !!icon,
        entryRect: frac(e),
      };
    });
    const groups = Array.from(document.querySelectorAll('.tools-palette-group-label')).map((g) => g.textContent.trim());
    const railLeafTexts = railLeaves(document.querySelector('.side-rail'));
    const pdfPage = document.querySelector('.tab-pane[aria-hidden="false"] .pdf-page');
    return {
      dataTheme: document.documentElement.getAttribute('data-theme'),
      rects: {
        titlebar: frac(document.querySelector('.titlebar')),
        toolbar: frac(document.querySelector('.toolbar')),
        sideRail: frac(document.querySelector('.side-rail')),
        palette: frac(document.querySelector('[data-tools-palette]')),
        pdfPage: frac(pdfPage),
        workspace: frac(document.querySelector('.workspace-main')),
      },
      styles: {
        titlebar: styleOf('.titlebar'),
        toolbar: styleOf('.toolbar'),
        sideRail: styleOf('.side-rail'),
        palette: styleOf('[data-tools-palette]'),
        paletteHeader: styleOf('.tools-palette-header'),
        html: styleOf('html'),
        body: styleOf('body'),
        app: styleOf('.app'),
        ambient: styleOf('.tf-ambient'),
        workspace: styleOf('.workspace-main'),
      },
      paletteLayout: document.querySelector('[data-tools-palette]')?.getAttribute('data-layout'),
      paletteWidthPx: Math.round((document.querySelector('[data-tools-palette]') || {}).getBoundingClientRect?.().width || 0),
      toolEntryCount: entries.length,
      toolEntries: entries,
      toolGroups: groups,
      railHeaderTexts: railLeafTexts,
      tabCount: document.querySelectorAll('.tab[data-tab-id]').length,
      tabLabel: document.querySelector('.tab-active')?.textContent?.trim()?.slice(0, 60) || null,
      titlebarText: (document.querySelector('.titlebar') || {}).textContent?.trim()?.slice(0, 120) || null,
      zoomReadout: document.querySelector('.zoom-percent')?.textContent?.trim() || null,
      pageNum: document.querySelector('.page-input, input[aria-label*="page" i]')?.value || null,
    };
    function railLeaves(rail) {
      if (!rail) return [];
      const out = [];
      const walk = (n) => {
        if (out.length > 20) return;
        for (const c of n.children) {
          if (c.children.length === 0 && c.textContent.trim()) out.push(c.textContent.trim().slice(0, 30));
          walk(c);
        }
      };
      walk(rail);
      return out;
    }
  });
  facts.rendererErrors = errors;
  fs.writeFileSync(path.join(SHOTS, `qa-comparison-facts${SUF}.json`), JSON.stringify(facts, null, 2));
  console.log(`[facts] tool entries=${facts.toolEntryCount} groups=${JSON.stringify(facts.toolGroups)} layout=${facts.paletteLayout} paletteWidth=${facts.paletteWidthPx}`);
  console.log(`[facts] rail texts: ${JSON.stringify(facts.railHeaderTexts).slice(0, 400)}`);

  // 7. Captures: renderer surface, then OS composited grab.
  await win.screenshot({ path: path.join(SHOTS, `qa-comparison-actual-window${SUF}.png`) });
  const grab = await electronApp.evaluate(async ({ desktopCapturer, screen, BrowserWindow }) => {
    const prim = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: prim.size.width, height: prim.size.height },
    });
    return {
      png: sources[0].thumbnail.toPNG().toString('base64'),
      bounds: BrowserWindow.getAllWindows()[0].getContentBounds(),
      scaleFactor: prim.scaleFactor,
      grabSize: [prim.size.width, prim.size.height],
    };
  });
  fs.writeFileSync(path.join(SHOTS, `qa-comparison-actual-desktop${SUF}.png`), Buffer.from(grab.png, 'base64'));
  fs.writeFileSync(path.join(SHOTS, `qa-comparison-grabmeta${SUF}.json`), JSON.stringify(grab.bounds ? { bounds: grab.bounds, scaleFactor: grab.scaleFactor, grabSize: grab.grabSize } : {}, null, 2));
  console.log(`[grab] saved, bounds=${JSON.stringify(grab.bounds)} scaleFactor=${grab.scaleFactor}`);

  console.log(`[errors] ${errors.length}: ${JSON.stringify(errors.slice(0, 6))}`);
  await electronApp.close();
});


