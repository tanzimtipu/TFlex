// PHASE 14.2 FIX VERIFICATION (qa, 2026-09-13).
// Verifies all 8 Phase 14.2 "Liquid Glass Polish" fixes on the dev build:
//   FIX 1  annotation bar height 52px == command bar, same material
//   FIX 2  panels (left rail + tools palette) unified in ALL themes
//   FIX 3  Open button: clean single layer, blue bg + white text/icon
//   FIX 4  dynamic page-view inset in ALL themes (panel pushes the page)
//   FIX 5  panel + page animate TOGETHER on one 300ms ease-out curve
//   FIX 6  icon sizes: toolbar 24px, command bar 22px, sidebar 22px, hits kept
//   FIX 7  "All tools" grid icon (LayoutGrid), NOT three dots
//   FIX 8  frosted page margins match dark/light, 16px minimum
// Canonical launcher (e2e/lib/launch.cjs), dev build. Screenshots -> screenshots/fix*.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

let electronApp = null;
let win = null;
let rendererErrors = [];

async function launchAndOpen() {
  electronApp = await launchApp();
  win = await electronApp.firstWindow();
  rendererErrors = [];
  win.on('pageerror', (err) => rendererErrors.push(`pageerror: ${err.message}`));
  win.on('console', (msg) => {
    if (msg.type() === 'error') rendererErrors.push(`console.error: ${msg.text()}`);
  });
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const reportPath = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, reportPath);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await win.waitForTimeout(1800);
}

async function closeApp() {
  await hardClose(electronApp, 'phase14.2-verify');
  electronApp = null;
  win = null;
}

async function setTheme(value) {
  // The Tools palette floats above everything; close it before opening the
  // theme popover so the dropdown can never be covered (DEF-189 family).
  const paletteOpen = await win.evaluate(() => !!document.querySelector('[data-tools-palette]'));
  if (paletteOpen) {
    await win.click('button[data-tools-toggle]');
    await win.waitForFunction(() => !document.querySelector('[data-tools-palette]'), undefined, { timeout: 5000 });
  }
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${value}"]`);
  await win.waitForFunction(
    (v) => document.documentElement.getAttribute('data-theme') === v,
    value,
    { timeout: 5000 },
  );
  await win.waitForTimeout(500);
}

async function openTools() {
  await win.click('button[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
  await win.waitForTimeout(450);
}

async function closeTools() {
  await win.click('button[data-tools-toggle]');
  await win.waitForFunction(() => !document.querySelector('[data-tools-palette]'), undefined, { timeout: 5000 });
  await win.waitForTimeout(450);
}

// Geometry snapshot of the page view + panels for one instant.
async function measureView() {
  return win.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const wm = document.querySelector('.workspace-main');
    const pal = document.querySelector('[data-tools-palette]');
    const page = document.querySelector('.tab-pane[aria-hidden="false"] .pdf-page[data-page="1"]');
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top),
        width: Math.round(b.width), height: Math.round(b.height),
      };
    };
    return {
      dataTheme: document.documentElement.getAttribute('data-theme'),
      toolsOpenAttr: document.querySelector('.app-main')?.getAttribute('data-tools-open') ?? null,
      scroller: r(sc),
      scrollerMarginRight: getComputedStyle(sc).marginRight,
      workspaceMain: r(wm),
      palette: r(pal),
      page: r(page),
      insetVar: getComputedStyle(wm).getPropertyValue('--tf-tools-inset').trim(),
    };
  });
}

test.describe('phase 14.2 fix verification', () => {
  test.afterEach(async () => {
    expect(rendererErrors, 'no renderer errors during the sweep').toEqual([]);
    await closeApp();
  });

  // ------------------------------------------------------------------
  // FIX 3: Open button clean single layer (frosted - the theme where
  // the ghost capsule was reported). Independent test so its failure
  // cannot block the other fix batteries.
  // ------------------------------------------------------------------
  test('fix3: Open button is a clean single layer (frosted)', async () => {
    test.setTimeout(240000);
    await launchAndOpen();
    const openBtn = await win.evaluate(() => {
      const g = document.querySelector('.toolbar-group.commandbar-group-open');
      const b = document.querySelector('.commandbar-open');
      if (!g || !b) return null;
      const gs = getComputedStyle(g);
      const bs = getComputedStyle(b);
      const bb = b.getBoundingClientRect();
      const gb = g.getBoundingClientRect();
      const alpha = gs.backgroundColor.startsWith('rgba')
        ? Number(gs.backgroundColor.split(',')[3].replace(')', ''))
        : 1;
      return {
        groupBg: gs.backgroundColor,
        groupBorderColor: gs.borderColor,
        groupShadow: gs.boxShadow,
        groupBgAlpha: alpha,
        btnBg: bs.backgroundColor,
        btnColor: bs.color,
        btnH: bb.height,
        groupH: gb.height,
        btnW: bb.width,
        groupW: gb.width,
      };
    });
    console.log('[fix3] frosted open button:', JSON.stringify(openBtn));
    await win.screenshot({ path: path.join(SHOTS, 'fix3-open-button.png'), clip: { x: 0, y: 44, width: 420, height: 120 } });
    expect(openBtn, 'Open button + File group mounted').not.toBeNull();
    expect(openBtn.groupBgAlpha, 'File capsule must paint nothing (no ghost layer)').toBe(0);
    expect(openBtn.groupShadow, 'File capsule must cast no shadow').toBe('none');
    expect(openBtn.btnBg, 'Open button solid blue accent background').toBe('rgb(37, 99, 235)');
    expect(openBtn.btnColor, 'white text').toBe('rgb(255, 255, 255)');
    // DEF-191 retest (qa, 2026-09-13): the old box-equality proxy is stale.
    // The fixed capsule keeps ~17px of layout padding around the button but
    // PAINTS NOTHING - bg alpha 0, transparent hairline, no shadow (asserted
    // above), so the box mismatch no longer means a visible ghost layer.
    // Height still matches exactly; width equality is gone with the fix.
    expect(openBtn.btnH === openBtn.groupH,
      'no visible capsule layer extending past the button (heights match)').toBe(true);
  });

  // ------------------------------------------------------------------
  // FIX 6: icon sizes + hit targets. Independent test (its command-bar
  // finding must not block the other fix batteries).
  // ------------------------------------------------------------------
  test('fix6: toolbar 24px, command bar 22px, sidebar 22px icons', async () => {
    test.setTimeout(240000);
    await launchAndOpen();
    const icons = await win.evaluate(() => {
      const sizeOf = (svg) => {
        const cs = getComputedStyle(svg);
        return `${parseFloat(cs.width)}x${parseFloat(cs.height)}`;
      };
      const annSvgs = Array.from(document.querySelectorAll('.ann-toolbar .ann-tool-btn > svg')).map(sizeOf);
      const cmdSvgs = Array.from(document.querySelectorAll('.toolbar .tool-btn > svg')).map(sizeOf);
      const openSvg = document.querySelector('.commandbar-open > svg');
      const railTabs = Array.from(document.querySelectorAll('.side-rail .rail-tab > svg')).map(sizeOf);
      const railBtns = Array.from(document.querySelectorAll('.side-rail button svg')).map(sizeOf);
      const annBtnHeights = Array.from(document.querySelectorAll('.ann-toolbar .ann-tool-btn'))
        .map((b) => b.getBoundingClientRect().height);
      const cmdBtnHeights = Array.from(document.querySelectorAll('.toolbar .tool-btn'))
        .map((b) => b.getBoundingClientRect().height);
      const capsule = document.querySelector('.toolbar .glass-control-group');
      return {
        annSizes: Array.from(new Set(annSvgs)), annCount: annSvgs.length,
        cmdSizes: Array.from(new Set(cmdSvgs)), cmdCount: cmdSvgs.length,
        openIconSize: openSvg ? sizeOf(openSvg) : null,
        railTabSizes: Array.from(new Set(railTabs)), railTabCount: railTabs.length,
        railBtnMin: railBtns.length ? Math.min(...railBtns.map((s) => parseFloat(s.split('x')[0]))) : null,
        annBtnHeights: Array.from(new Set(annBtnHeights.map((h) => Math.round(h)))),
        cmdBtnHeights: Array.from(new Set(cmdBtnHeights.map((h) => Math.round(h)))),
        capsuleH: capsule ? capsule.getBoundingClientRect().height : null,
      };
    });
    console.log('[fix6] icon sizes:', JSON.stringify(icons));
    await win.screenshot({ path: path.join(SHOTS, 'fix6-icons-large.png'), clip: { x: 0, y: 0, width: 1100, height: 180 } });
    expect(icons.annCount, 'annotation toolbar glyphs present').toBeGreaterThan(0);
    expect(icons.annSizes, `toolbar icons must be 24px (got ${icons.annSizes})`).toEqual(['24x24']);
    expect(icons.cmdCount, 'command bar glyphs present').toBeGreaterThan(0);
    for (const s of icons.cmdSizes) {
      const w = parseFloat(s.split('x')[0]);
      expect(w, `command bar icon ${s} must be within the 20-22px band`).toBeGreaterThanOrEqual(20);
      expect(w, `command bar icon ${s} must be within the 20-22px band`).toBeLessThanOrEqual(22);
    }
    expect(icons.railTabCount, 'sidebar tab glyphs present').toBeGreaterThan(0);
    expect(icons.railTabSizes, `sidebar tab icons must be 22px (got ${icons.railTabSizes})`).toEqual(['22x22']);
    expect(icons.railBtnMin, 'every sidebar button icon >= 20px').toBeGreaterThanOrEqual(20);
    for (const h of icons.annBtnHeights) expect(h, 'annotation tool hit box').toBeGreaterThanOrEqual(32);
    for (const h of icons.cmdBtnHeights) expect(h, 'command tool hit box').toBeGreaterThanOrEqual(32);
    expect(icons.capsuleH, 'command capsule hit row >= 36px (40px band)').toBeGreaterThanOrEqual(36);
  });

  // ------------------------------------------------------------------
  // FROSTED (default theme): FIX 1, 2, 7, 8 + frosted leg of FIX 4
  // ------------------------------------------------------------------
  test('frosted: fixes 1/7/8 + unified panels + dynamic view', async () => {
    test.setTimeout(240000);
    await launchAndOpen();
    test.info().annotations.push({ type: 'theme', description: 'frosted (default)' });

    // ---- FIX 1: annotation bar height == command bar (52px), same material
    const bar = await win.evaluate(() => {
      const ann = document.querySelector('.ann-toolbar');
      const cmd = document.querySelector('.workspace .toolbar');
      const cs = (el) => (el ? getComputedStyle(el) : null);
      return {
        annH: ann ? ann.getBoundingClientRect().height : null,
        cmdH: cmd ? cmd.getBoundingClientRect().height : null,
        annBg: cs(ann).backgroundColor,
        cmdBg: cs(cmd).backgroundColor,
        annBorder: cs(ann).borderBottomColor,
        cmdBorder: cs(cmd).borderBottomColor,
      };
    });
    console.log('[fix1] frosted bars:', JSON.stringify(bar));
    expect(bar.annH, 'annotation bar must be mounted').not.toBeNull();
    expect(Math.abs(bar.annH - 52), `annotation bar height ${bar.annH} must be 52px`).toBeLessThanOrEqual(1.5);
    expect(Math.abs(bar.cmdH - 52), `command bar height ${bar.cmdH} must be 52px`).toBeLessThanOrEqual(1.5);
    expect(Math.abs(bar.annH - bar.cmdH), 'annotation bar same height as command bar').toBeLessThanOrEqual(1.5);
    expect(bar.annBg, 'same material as command bar (background)').toBe(bar.cmdBg);
    expect(bar.annBorder, 'same material as command bar (bottom border)').toBe(bar.cmdBorder);
    await win.screenshot({ path: path.join(SHOTS, 'fix1-annotation-bar.png'), clip: { x: 0, y: 0, width: 1000, height: 130 } });

    // ---- FIX 7: All tools grid icon (not three dots)
    const toolsIcon = await win.evaluate(() => {
      const btn = document.querySelector('button[data-tools-toggle]');
      if (!btn) return null;
      const svgs = Array.from(btn.querySelectorAll('svg'));
      const classes = svgs.map((s) => s.getAttribute('class') || '');
      return {
        svgClasses: classes,
        hasGrid: classes.some((c) => /layout-grid/i.test(c)),
        hasDots: classes.some((c) => /(more-horizontal|ellipsis|dots|more-vertical)/i.test(c)),
      };
    });
    console.log('[fix7] tools toggle icon:', JSON.stringify(toolsIcon));
    expect(toolsIcon, 'tools toggle button mounted').not.toBeNull();
    expect(toolsIcon.hasGrid, 'tools toggle must use the All-tools grid glyph').toBe(true);
    expect(toolsIcon.hasDots, 'tools toggle must NOT use a three-dot glyph').toBe(false);
    {
      const tb = await win.locator('button[data-tools-toggle]').boundingBox();
      await win.screenshot({
        path: path.join(SHOTS, 'fix7-all-tools-icon.png'),
        clip: { x: Math.max(0, tb.x - 60), y: Math.max(0, tb.y - 20), width: 340, height: tb.height + 40 },
      });
    }

    // ---- FIX 8: frosted page margins. The chrome floats over the page, so
    // the page must sit 16px BELOW the floating chrome stack (not the old
    // 28px), 16px above the bottom, and keep dark/light's 0 side padding
    // (fit-width leaves the standard 28px content padding on each side).
    const fix8 = await win.evaluate(() => {
      const wm = document.querySelector('.workspace-main');
      const content = document.querySelector('.document-content');
      const page = document.querySelector('.tab-pane[aria-hidden="false"] .pdf-page[data-page="1"]');
      const sc = document.querySelector('.document-scroller');
      const cs = getComputedStyle(content);
      const pb = page.getBoundingClientRect();
      const sb = sc.getBoundingClientRect();
      return {
        contentPadding: cs.padding,
        chromeY: getComputedStyle(wm).getPropertyValue('--tf-chrome-y').trim(),
        pageTopGap: Math.round(pb.top - sb.top),
        pageLeftGap: Math.round(pb.left - sb.left),
        pageRightGap: Math.round(sb.right - pb.right),
        pageWidth: Math.round(pb.width),
        scrollerWidth: Math.round(sb.width),
        bottomPad: cs.paddingBottom,
        sidePad: `${cs.paddingLeft}|${cs.paddingRight}`,
      };
    });
    console.log('[fix8] frosted page margins:', JSON.stringify(fix8));
    const chromeYNum = parseFloat(fix8.chromeY.replace('px', '')) || 104;
    expect(fix8.sidePad, 'frosted content side padding must match dark/light (0px)').toBe('0px|0px');
    expect(fix8.bottomPad, 'frosted bottom margin must be the 16px floating minimum').toBe('16px');
    expect(Math.abs(fix8.pageTopGap - (chromeYNum + 16)) <= 8,
      `page must sit 16px below the floating chrome stack (gap ${fix8.pageTopGap}, chrome ${chromeYNum})`).toBe(true);
    expect(Math.abs(fix8.pageLeftGap - 28) <= 6, `frosted page left gap ${fix8.pageLeftGap} must match the dark/light 28px content padding`).toBe(true);
    // the right gap is the left gap + the scroller's vertical scrollbar
    // (dark/light show the same +10px) - assert THAT relation, not 28.
    const scrollbar = await win.evaluate(() => {
      const sc = document.querySelector('.document-scroller');
      return sc.clientWidth ? (sc.getBoundingClientRect().width - sc.clientWidth) : 0;
    });
    console.log(`[fix8] frosted scrollbar width: ${scrollbar}`);
    expect(Math.abs(fix8.pageRightGap - (fix8.pageLeftGap + scrollbar)) <= 4,
      `frosted page right gap ${fix8.pageRightGap} must be leftGap + scrollbar (${fix8.pageLeftGap} + ${scrollbar})`).toBe(true);
    await win.screenshot({ path: path.join(SHOTS, 'fix8-margins-frosted.png') });

    // ---- FIX 2 (frosted leg): rail + palette share the glass panel contract
    await openTools();
    await win.screenshot({ path: path.join(SHOTS, 'fix2-panels-unified-frosted.png') });
    const frostedPanels = await win.evaluate(() => {
      const rail = document.querySelector('.side-rail');
      const pal = document.querySelector('[data-tools-palette]');
      const cs = (el) => getComputedStyle(el);
      return {
        railBg: cs(rail).backgroundColor,
        palBg: cs(pal).backgroundColor,
        railRadius: cs(rail).borderRadius,
        palRadius: cs(pal).borderRadius,
        railShadow: cs(rail).boxShadow,
        palShadow: cs(pal).boxShadow,
        railBlur: cs(rail).backdropFilter,
        palBlur: cs(pal).backdropFilter,
      };
    });
    console.log('[fix2] frosted panel tokens:', JSON.stringify(frostedPanels));
    expect(frostedPanels.railBg, 'rail + palette share one surface (frosted)').toBe(frostedPanels.palBg);
    expect(frostedPanels.railRadius, 'rail + palette share one radius policy (frosted)').toBe(frostedPanels.palRadius);
    expect(frostedPanels.railShadow, 'rail + palette share one shadow family (frosted)').toBe(frostedPanels.palShadow);
    expect(frostedPanels.railBlur, 'frosted panels are real glass (backdrop blur)').toContain('blur');
    expect(frostedPanels.palBlur, 'frosted palette blur').toContain('blur');

    // ---- FIX 4 (frosted leg): page view adjusts when the panel opens/closes
    const openSnap = await measureView();
    console.log('[fix4] frosted tools-open:', JSON.stringify(openSnap));
    await win.screenshot({ path: path.join(SHOTS, 'fix4-dynamic-frosted.png') });
    await closeTools();
    const closedSnap = await measureView();
    console.log('[fix4] frosted tools-closed:', JSON.stringify(closedSnap));
    await win.screenshot({ path: path.join(SHOTS, 'fix4-dynamic-frosted-closed.png') });
    expect(openSnap.toolsOpenAttr, 'frosted: data-tools-open flips on').toBe('true');
    expect(parseFloat(openSnap.scrollerMarginRight), 'frosted: page pushed beside the open panel').toBeGreaterThan(330);
    expect(openSnap.palette.left >= openSnap.scroller.right - 2, 'frosted: panel never overlaps the page').toBe(true);
    expect(closedSnap.toolsOpenAttr, 'frosted: data-tools-open flips off').toBe('false');
    expect(parseFloat(closedSnap.scrollerMarginRight), 'frosted: page returns to full width').toBeLessThan(2);
  });

  // ------------------------------------------------------------------
  // DARK theme: FIX 2 + FIX 4 dark legs, FIX 1 height re-check
  // ------------------------------------------------------------------
  test('dark: dynamic page view + unified panels + bar heights', async () => {
    test.setTimeout(240000);
    await launchAndOpen();
    await setTheme('dark');

    // FIX 1 re-check in dark (same 52px + material contract)
    const bar = await win.evaluate(() => {
      const ann = document.querySelector('.ann-toolbar');
      const cmd = document.querySelector('.workspace .toolbar');
      return {
        annH: ann.getBoundingClientRect().height,
        cmdH: cmd.getBoundingClientRect().height,
        annBg: getComputedStyle(ann).backgroundColor,
        cmdBg: getComputedStyle(cmd).backgroundColor,
      };
    });
    console.log('[fix1] dark bars:', JSON.stringify(bar));
    expect(Math.abs(bar.annH - bar.cmdH), 'dark: annotation bar == command bar height').toBeLessThanOrEqual(1.5);
    expect(bar.annBg, 'dark: same material').toBe(bar.cmdBg);

    // FIX 4 dark: closed -> open
    const closedSnap = await measureView();
    console.log('[fix4] dark closed:', JSON.stringify(closedSnap));
    expect(parseFloat(closedSnap.scrollerMarginRight), 'dark: page starts full width').toBeLessThan(2);
    await win.screenshot({ path: path.join(SHOTS, 'fix4-dynamic-dark-closed.png') });
    await openTools();
    // FIX 2 dark (evidence BEFORE the fix4 asserts, which currently fail
    // on DEF-192 and would otherwise skip this battery's remaining checks)
    const darkPanels = await win.evaluate(() => {
      const rail = document.querySelector('.side-rail');
      const pal = document.querySelector('[data-tools-palette]');
      const cs = (el) => getComputedStyle(el);
      return {
        railBg: cs(rail).backgroundColor,
        palBg: cs(pal).backgroundColor,
        railRadius: cs(rail).borderRadius,
        palRadius: cs(pal).borderRadius,
        railShadow: cs(rail).boxShadow,
        palShadow: cs(pal).boxShadow,
      };
    });
    console.log('[fix2] dark panels:', JSON.stringify(darkPanels));
    expect(darkPanels.railBg, 'dark: rail + palette share one surface').toBe(darkPanels.palBg);
    expect(darkPanels.railRadius, 'dark: docked panels share the square-corner policy').toBe(darkPanels.palRadius);
    expect(darkPanels.railShadow, 'dark: docked panels share the no-shadow policy').toBe(darkPanels.palShadow);
    await win.screenshot({ path: path.join(SHOTS, 'fix2-panels-unified-dark.png') });

    // FIX 4 dark: open snapshot + asserts (last, so a DEF-192 failure
    // cannot skip the fix2/fix8 evidence above)
    const openSnap = await measureView();
    console.log('[fix4] dark open:', JSON.stringify(openSnap));
    await win.screenshot({ path: path.join(SHOTS, 'fix4-dynamic-dark.png') });
    expect(openSnap.toolsOpenAttr, 'dark: data-tools-open flips on').toBe('true');

    // FIX 8 reference leg: dark keeps 0 horizontal padding
    const darkContent = await win.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.document-content'));
      return { side: `${cs.paddingLeft}|${cs.paddingRight}` };
    });
    console.log('[fix8] dark content padding:', JSON.stringify(darkContent));
    expect(darkContent.side, 'dark reference: 0 horizontal padding').toBe('0px|0px');
    const insetPx = parseFloat(openSnap.scrollerMarginRight);
    expect(insetPx, `dark: page pushed beside the open panel (margin ${insetPx})`).toBeGreaterThan(330);
    expect(openSnap.scroller.width, 'dark: scroller width shrank by the panel inset')
      .toBeLessThan(closedSnap.scroller.width - 300);
    expect(openSnap.palette.left >= openSnap.scroller.right - 2, 'dark: panel never overlaps the page').toBe(true);
  });

  // ------------------------------------------------------------------
  // LIGHT theme: same battery as dark
  // ------------------------------------------------------------------
  test('light: dynamic page view + unified panels + bar heights', async () => {
    test.setTimeout(240000);
    await launchAndOpen();
    await setTheme('light');

    const bar = await win.evaluate(() => {
      const ann = document.querySelector('.ann-toolbar');
      const cmd = document.querySelector('.workspace .toolbar');
      return {
        annH: ann.getBoundingClientRect().height,
        cmdH: cmd.getBoundingClientRect().height,
        annBg: getComputedStyle(ann).backgroundColor,
        cmdBg: getComputedStyle(cmd).backgroundColor,
      };
    });
    console.log('[fix1] light bars:', JSON.stringify(bar));
    expect(Math.abs(bar.annH - bar.cmdH), 'light: annotation bar == command bar height').toBeLessThanOrEqual(1.5);
    expect(bar.annBg, 'light: same material').toBe(bar.cmdBg);

    const closedSnap = await measureView();
    console.log('[fix4] light closed:', JSON.stringify(closedSnap));
    expect(parseFloat(closedSnap.scrollerMarginRight), 'light: page starts full width').toBeLessThan(2);
    await win.screenshot({ path: path.join(SHOTS, 'fix4-dynamic-light-closed.png') });
    await openTools();
    // FIX 2 light (evidence BEFORE the fix4 asserts, which currently fail
    // on DEF-192 and would otherwise skip this battery's remaining checks)
    const lightPanels = await win.evaluate(() => {
      const rail = document.querySelector('.side-rail');
      const pal = document.querySelector('[data-tools-palette]');
      const cs = (el) => getComputedStyle(el);
      return {
        railBg: cs(rail).backgroundColor,
        palBg: cs(pal).backgroundColor,
        railRadius: cs(rail).borderRadius,
        palRadius: cs(pal).borderRadius,
        railShadow: cs(rail).boxShadow,
        palShadow: cs(pal).boxShadow,
      };
    });
    console.log('[fix2] light panels:', JSON.stringify(lightPanels));
    expect(lightPanels.railBg, 'light: rail + palette share one surface').toBe(lightPanels.palBg);
    expect(lightPanels.railRadius, 'light: docked panels share the square-corner policy').toBe(lightPanels.palRadius);
    expect(lightPanels.railShadow, 'light: docked panels share the no-shadow policy').toBe(lightPanels.palShadow);
    await win.screenshot({ path: path.join(SHOTS, 'fix2-panels-unified-light.png') });

    // FIX 4 light: open snapshot + asserts (last)
    const openSnap = await measureView();
    console.log('[fix4] light open:', JSON.stringify(openSnap));
    await win.screenshot({ path: path.join(SHOTS, 'fix4-dynamic-light.png') });
    expect(openSnap.toolsOpenAttr, 'light: data-tools-open flips on').toBe('true');

    const lightContent = await win.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('.document-content'));
      return { side: `${cs.paddingLeft}|${cs.paddingRight}` };
    });
    console.log('[fix8] light content padding:', JSON.stringify(lightContent));
    expect(lightContent.side, 'light reference: 0 horizontal padding').toBe('0px|0px');
    const insetPx = parseFloat(openSnap.scrollerMarginRight);
    expect(insetPx, `light: page pushed beside the open panel (margin ${insetPx})`).toBeGreaterThan(330);
    expect(openSnap.scroller.width, 'light: scroller width shrank').toBeLessThan(closedSnap.scroller.width - 300);
    expect(openSnap.palette.left >= openSnap.scroller.right - 2, 'light: panel never overlaps the page').toBe(true);
  });

  // ------------------------------------------------------------------
  // FIX 5: simultaneous panel+page animation (frosted + dark), frames
  // ------------------------------------------------------------------
  test('fix5: panel and page animate together on one 300ms ease-out curve', async () => {
    test.setTimeout(240000);
    await launchAndOpen();

    // transition declaration contract
    const trans = await win.evaluate(() => {
      const t = getComputedStyle(document.querySelector('.workspace-main')).transition;
      return { t, hasInset: /--tf-tools-inset/.test(t) };
    });
    console.log('[fix5] workspace-main transition:', JSON.stringify(trans));
    expect(trans.hasInset, 'the inset custom property must be transitioned on .workspace-main').toBe(true);

    // In-page rAF sampler: records margin/inset/palette state every frame.
    await win.evaluate(() => {
      window.__fix5 = { samples: [], running: false, t0: 0 };
      window.__fix5_start = () => {
        const s = window.__fix5;
        s.samples = [];
        s.running = true;
        s.t0 = performance.now();
        const tick = () => {
          if (!s.running) return;
          const pal = document.querySelector('[data-tools-palette]');
          const pcs = pal ? getComputedStyle(pal) : null;
          const pRect = pal ? pal.getBoundingClientRect() : null;
          s.samples.push({
            t: Math.round(performance.now() - s.t0),
            marginRight: parseFloat(getComputedStyle(document.querySelector('.document-scroller')).marginRight),
            inset: getComputedStyle(document.querySelector('.workspace-main')).getPropertyValue('--tf-tools-inset').trim(),
            paletteMounted: !!pal,
            paletteOpacity: pcs ? Number(pcs.opacity) : null,
            paletteTransform: pcs ? pcs.transform : null,
            paletteLeft: pleft(),
            scrollerRight: Math.round(document.querySelector('.document-scroller').getBoundingClientRect().right),
          });
          function pleft() {
            const p = document.querySelector('[data-tools-palette]');
            return p ? Math.round(p.getBoundingClientRect().left) : null;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      };
      window.__fix5_stop = () => { window.__fix5.running = false; };
    });

    // OPEN curve
    await win.evaluate(() => window.__fix5_start());
    await win.click('button[data-tools-toggle]');
    await win.waitForTimeout(700);
    await win.evaluate(() => window.__fix5_stop());
    const openSamples = await win.evaluate(() => window.__fix5.samples);
    console.log(`[fix5] OPEN: ${openSamples.length} rAF samples`);
    console.log('[fix5] OPEN head:', JSON.stringify(openSamples.slice(0, 4)));
    console.log('[fix5] OPEN tail:', JSON.stringify(openSamples.slice(-2)));
    verifyCurve(openSamples, 'OPEN');

    // frame sequence for the visual record
    await closeTools();
    const frameDelays = [0, 60, 120, 180, 240, 300, 420];
    await win.click('button[data-tools-toggle]');
    for (let i = 0; i < frameDelays.length; i += 1) {
      const shotT0 = Date.now();
      await win.screenshot({ path: path.join(SHOTS, `fix5-anim-frame-${String(i).padStart(2, '0')}.png`) });
      const captureCost = Date.now() - shotT0;
      console.log(`[fix5] frame ${i} target ${frameDelays[i]}ms (capture took ${captureCost}ms)`);
      if (i + 1 < frameDelays.length) {
        await win.waitForTimeout(Math.max(0, frameDelays[i + 1] - frameDelays[i] - captureCost));
      }
    }
    await closeTools();

    // CLOSE curve
    await openTools();
    await win.evaluate(() => window.__fix5_start());
    await win.click('button[data-tools-toggle]');
    await win.waitForTimeout(700);
    await win.evaluate(() => window.__fix5_stop());
    const closeSamples = await win.evaluate(() => window.__fix5.samples);
    console.log(`[fix5] CLOSE: ${closeSamples.length} rAF samples`);
    verifyCloseCurve(closeSamples, 'CLOSE');

    // DARK theme: same shared motion system
    await setTheme('dark');
    await win.evaluate(() => window.__fix5_start());
    await win.click('button[data-tools-toggle]');
    await win.waitForTimeout(700);
    await win.evaluate(() => window.__fix5_stop());
    const darkSamples = await win.evaluate(() => window.__fix5.samples);
    console.log(`[fix5] DARK OPEN: ${darkSamples.length} rAF samples`);
    verifyCurve(darkSamples, 'OPEN-dark');
  });
});

// OPEN-direction curve verifier: the inset must interpolate through MANY
// distinct intermediate values (registered-property tween, not a discrete
// flip), be monotonic, settle ~356px inside the ~300ms window, and move in
// the SAME window as the palette's own enter motion (not sequentially).
function verifyCurve(samples, label) {
  const withMargin = samples.filter((s) => Number.isFinite(s.marginRight));
  const finalMargin = withMargin[withMargin.length - 1].marginRight;
  const firstMove = withMargin.find((s) => s.marginRight > 4);
  const settled = withMargin.find((s) => s.marginRight > finalMargin - 8);
  expect(finalMargin, `${label}: page inset reaches the panel width + gap`).toBeGreaterThan(330);
  expect(firstMove, `${label}: the page must actually move (intermediate frames exist)`).toBeTruthy();
  const movementMs = settled.t - firstMove.t;
  console.log(`[fix5] ${label}: margin ${withMargin[0].marginRight}px -> ${finalMargin}px, movement ${firstMove.t}ms -> ${settled.t}ms (${movementMs}ms)`);
  expect(movementMs, `${label}: slide must take ~300ms (${movementMs}ms), not snap and not drag`).toBeGreaterThanOrEqual(120);
  expect(movementMs, `${label}: slide must not exceed ~450ms`).toBeLessThanOrEqual(450);
  const distinct = new Set(withMargin.filter((s) => s.t <= settled.t).map((s) => Math.round(s.marginRight)));
  console.log(`[fix5] ${label}: ${distinct.size} distinct intermediate margin values`);
  expect(distinct.size, `${label}: smooth interpolation needs many intermediate values`).toBeGreaterThanOrEqual(5);
  let last = -1;
  for (const s of withMargin.filter((x) => x.t <= settled.t)) {
    expect(s.marginRight >= last - 0.5, `${label}: margin must move monotonically (no jumps)`).toBe(true);
    last = s.marginRight;
  }
  // SIMULTANEITY: while the page inset is still interpolating, the palette
  // must already be mounted AND mid-flight (opacity below settled, or a
  // mid-travel transform).
  const paletteSamples = samples.filter((s) => s.paletteMounted);
  expect(paletteSamples.length, `${label}: palette mounted while sampled`).toBeGreaterThan(0);
  const lastPalette = paletteSamples[paletteSamples.length - 1];
  const palEndOpacity = lastPalette.paletteOpacity;
  console.log(`[fix5] ${label}: palette first t=${paletteSamples[0].t}ms opacity=${paletteSamples[0].paletteOpacity}, settled t=${lastPalette.t}ms opacity=${palEndOpacity}`);
  const together = samples.filter((s) =>
    s.paletteMounted && s.paletteOpacity !== null &&
    s.marginRight > 10 && s.marginRight < finalMargin - 20 &&
    (s.paletteOpacity < palEndOpacity - 0.05 || (s.paletteTransform && s.paletteTransform !== 'none')));
  console.log(`[fix5] ${label}: ${together.length} samples show panel AND page moving in the same frame window`);
  expect(together.length > 0, `${label}: panel AND page must animate TOGETHER (overlapping motion windows)`).toBe(true);
  // DEF-193 retest (qa, 2026-09-13): compare TRUE settle times. The last
  // palette sample is just where sampling STOPPED (the 700ms window end), not
  // where the palette's tween settled - comparing it against the margin settle
  // manufactured a false "sequential" failure on the healthy build.
  const paletteSettled = paletteSamples.find((s) => s.paletteOpacity !== null && s.paletteOpacity >= 0.99);
  console.log(`[fix5] ${label}: settle order palette=${paletteSettled ? paletteSettled.t : '?'}ms margin=${settled.t}ms`);
  expect(Math.abs(settled.t - paletteSettled.t) <= 150, `${label}: page and panel settle together, not sequentially (page ${settled.t}ms vs panel ${paletteSettled.t}ms)`).toBe(true);
}

// CLOSE-direction curve verifier (margin 356 -> 0).
function verifyCloseCurve(samples, label) {
  const withMargin = samples.filter((s) => Number.isFinite(s.marginRight));
  const startMargin = withMargin[0].marginRight;
  const finalMargin = withMargin[withMargin.length - 1].marginRight;
  const firstMove = withMargin.find((s) => s.marginRight < startMargin - 4);
  const settled = withMargin.find((s) => s.marginRight < 8);
  expect(startMargin, `${label}: close starts from the open inset`).toBeGreaterThan(330);
  expect(firstMove, `${label}: the page must move on close`).toBeTruthy();
  expect(settled, `${label}: the page returns to full width`).toBeTruthy();
  const movementMs = settled.t - firstMove.t;
  console.log(`[fix5] ${label}: margin ${startMargin}px -> ${finalMargin}px, movement ${firstMove.t}ms -> ${settled.t}ms (${movementMs}ms)`);
  expect(movementMs, `${label}: close slide must take ~300ms (${movementMs}ms)`).toBeGreaterThanOrEqual(120);
  expect(movementMs, `${label}: close slide must not exceed ~450ms`).toBeLessThanOrEqual(450);
  const distinct = new Set(withMargin.filter((s) => s.t <= settled.t).map((s) => Math.round(s.marginRight)));
  expect(distinct.size, `${label}: close must interpolate smoothly`).toBeGreaterThanOrEqual(5);
  const paletteSamples = samples.filter((s) => s.paletteMounted);
  expect(paletteSamples.length, `${label}: palette visible during close sampling`).toBeGreaterThan(0);
  const together = samples.filter((s) =>
    s.paletteMounted && s.marginRight > 10 && s.marginRight < startMargin - 20);
  console.log(`[fix5] ${label}: ${together.length} samples show panel AND page moving together`);
  expect(together.length > 0, `${label}: panel AND page must animate TOGETHER on close`).toBe(true);
}