// qa probe for the DEF-183 + DEF-188 FINAL verification: exact rects of the
// text elements whose readability the two defects are about, plus the
// computed ink colors they render with. Run once (layout is deterministic:
// report.pdf, zoom 400%, Tools palette list); e2e/lib/def183_188_final_metrics.cjs
// then samples these rects out of the aurora and near-black OS grabs
// (qa-comparison-actual-desktop{,-dark}.png from qa_reference_compare.spec.cjs).
const { test } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('../lib/launch.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test('collect DEF-183/188 final text rects + inks', async () => {
  test.setTimeout(300000);
  const electronApp = await launchApp();
  const win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  await electronApp.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const disp = screen.getPrimaryDisplay();
    const width = 1440, height = 860;
    w.setBounds({
      x: disp.workArea.x + Math.round((disp.workArea.width - width) / 2),
      y: disp.workArea.y + Math.round((disp.workArea.height - height) / 2),
      width, height,
    });
    w.focus();
  });
  await win.waitForTimeout(500);

  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  // No zoom loop and no layout click here: list is the default layout and
  // the sampled rects (rail title, undo row, palette entry 1, group label)
  // do not depend on zoom. The zoom clicks were observed to intermittently
  // shift app content ~43px left in probe-only runs (the CAPTURE runs are
  // unaffected — qa-comparison-facts*.json rects verified titlebar 0,0 and
  // palette x=1080 at grab time in both backdrops); keep this probe in the
  // simple state so its rects describe the grabbed layout.
  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
  await win.waitForTimeout(600);
  const pressed = await win.evaluate(() => document.querySelector('[data-tools-layout="list"]')?.getAttribute('aria-pressed'));
  if (pressed !== 'true') {
    await win.click('[data-tools-layout="list"]');
    await win.waitForTimeout(500);
  }
  // The rail's TfPanelLeft slide-in spring (-18px travel) re-runs on zoom
  // re-renders; measure only after every transform has settled, or the
  // rects come back mid-flight with negative x.
  await win.waitForFunction(
    () => {
      const els = [document.querySelector('.side-rail'), document.querySelector('[data-tools-palette]'), document.querySelector('.rail-title')];
      return els.every((el) => !el || getComputedStyle(el).transform === 'none');
    },
    { timeout: 10000 },
  );
  await win.waitForTimeout(300);
  // The zoom clicks can leave a page-level horizontal scroll (the 400%
  // workspace overflows); the capture runs grab at scroll 0 (verified in
  // qa-comparison-facts*.json rects), so reset before reading rects.
  await win.evaluate(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollLeft = 0;
    document.body.scrollLeft = 0;
  });
  await win.waitForTimeout(200);
  const scroll = await win.evaluate(() => [window.scrollX, window.scrollY, document.documentElement.scrollLeft, document.body.scrollLeft]);
  if (scroll.some((v) => v !== 0)) throw new Error(`page still scrolled at probe time: ${JSON.stringify(scroll)}`);

  const probe = await win.evaluate(() => {
    const rectOf = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const inkOf = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { color: cs.color, fontWeight: cs.fontWeight, fontSize: cs.fontSize, opacity: cs.opacity };
    };
    const firstGroup = document.querySelector('.tools-palette-group');
    const firstEntry = document.querySelector('.tools-palette-entry[data-tool-id="merge"]') || document.querySelector('.tools-palette-entry');
    const railTitle = document.querySelector('.rail-title');
    const undoBtn = document.querySelector('.rail-action-btn');
    const groupLabel = firstGroup ? firstGroup.querySelector('.tools-palette-group-label') : null;
    const titlebar = document.querySelector('.titlebar');
    return {
      dataTheme: document.documentElement.getAttribute('data-theme'),
      zoom: document.querySelector('.zoom-percent')?.textContent?.trim() ?? null,
      paletteLayout: document.querySelector('[data-tools-palette]')?.getAttribute('data-layout') ?? null,
      firstEntryText: firstEntry ? firstEntry.querySelector('.tools-palette-entry-label')?.textContent.trim() : null,
      firstEntryDescText: firstEntry ? (firstEntry.querySelector('.tools-palette-entry-desc, .tools-palette-entry-description')?.textContent.trim() ?? null) : null,
      groupLabelText: groupLabel ? groupLabel.textContent.trim() : null,
      railTitleText: railTitle ? railTitle.textContent.trim() : null,
      undoDisabled: undoBtn ? undoBtn.disabled : null,
      rects: {
        entryTitle: rectOf(firstEntry?.querySelector('.tools-palette-entry-label')),
        entryDesc: rectOf(firstEntry?.querySelector('.tools-palette-entry-desc, .tools-palette-entry-description')),
        groupLabel: rectOf(groupLabel),
        railTitle: rectOf(railTitle),
        undoRow: rectOf(undoBtn),
        titlebar: rectOf(titlebar),
      },
      inks: {
        entryTitle: inkOf(firstEntry?.querySelector('.tools-palette-entry-label')),
        entryDesc: inkOf(firstEntry?.querySelector('.tools-palette-entry-desc, .tools-palette-entry-description')),
        groupLabel: inkOf(groupLabel),
        railTitle: inkOf(railTitle),
        undoRow: inkOf(undoBtn),
      },
      glass: {
        titlebar: (() => { const el = document.querySelector('.titlebar'); if (!el) return null; const cs = getComputedStyle(el); return { bg: cs.backgroundColor, blur: cs.backdropFilter || cs.webkitBackdropFilter }; })(),
        appHeader: (() => { const el = document.querySelector('.app-header'); if (!el) return null; const cs = getComputedStyle(el); return { bg: cs.backgroundColor, blur: cs.backdropFilter || cs.webkitBackdropFilter }; })(),
        palette: (() => { const el = document.querySelector('[data-tools-palette]'); if (!el) return null; const cs = getComputedStyle(el); return { bg: cs.backgroundColor, blur: cs.backdropFilter || cs.webkitBackdropFilter }; })(),
      },
    };
  });
  probe.rendererSize = await win.evaluate(() => [window.innerWidth, window.innerHeight]);
  fs.writeFileSync(path.join(SHOTS, 'def183-188-final-rects.json'), JSON.stringify(probe, null, 2));
  console.log(JSON.stringify(probe, null, 1));
  await electronApp.close();
});
