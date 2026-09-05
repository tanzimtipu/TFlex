// PHASE A-D VERIFICATION (frosted-acrylic theme + physics motion) - DEV build.
// Covers the orchestrator's 9-item verification list:
//   1. Frosted default on fresh launch
//   2. Three themes + embedded dropdown + keyboard access
//   3. Acrylic quality (chrome translucent ~0.88-0.94 + blur, NOT seethrough)
//   4. PDF pristine (white page, no blur/tint/reflection, in ALL themes)
//   5. Colorful icon palette (semantic 8-hue, not monochrome)
//   6. Tools panel group headers (ORGANIZE PAGES / DOCUMENT / RECOGNITION / EXPORT)
//   7. Moving reflection present (normal) / absent (prefers-reduced-motion)
//   8. Spring-physics enter AND exit animations (panel/dialog/menu) + no scroll/zoom jank
//   9. Regression: open/search/annotate/tabs/theme flips with zero renderer errors
// Canonical launcher, dev build (no executablePath). Screenshots -> screenshots/.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, scrollToPage } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

let electronApp = null;
let win = null;
let rendererErrors = [];

function snap(name) {
  return win.screenshot({ path: path.join(SHOTS, name) });
}

function attachErrorCollectors(window) {
  window.on('pageerror', (err) => {
    rendererErrors.push(`pageerror: ${err.message}`);
  });
  window.on('console', (msg) => {
    if (msg.type() === 'error') rendererErrors.push(`console.error: ${msg.text()}`);
  });
}

async function readTheme() {
  return win.evaluate(() => document.documentElement.getAttribute('data-theme'));
}

/** Select an explicit theme through the embedded dropdown (mouse path). */
async function setThemeViaDropdown(want) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${want}"]`);
  await win.waitForFunction(
    (w) => document.documentElement.getAttribute('data-theme') === w,
    want,
  );
}

/** Open the tools palette and wait for it to settle. */
async function openPalette() {
  await win.click('[data-tools-toggle]');
  await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
  await win.waitForTimeout(450);
}

async function closePaletteIfOpen() {
  const open = await win.evaluate(() => !!document.querySelector('[data-tools-palette]'));
  if (open) {
    await win.click('[data-tools-toggle]');
    await win.waitForTimeout(700);
  }
}

/** Parse "rgba(r, g, b, a)" into {r,g,b,a}. */
function parseRgba(str) {
  const m = /rgba?\(([^)]+)\)/.exec(str || '');
  if (!m) return null;
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

/** Computed-style facts for a chrome selector (element + ::after). */
async function chromeStyle(selector) {
  return win.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const after = getComputedStyle(el, '::after');
    return {
      selector: sel,
      bg: cs.backgroundColor,
      backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
      borderStyle: cs.borderTopStyle,
      borderTopWidth: cs.borderTopWidth,
      boxShadow: cs.boxShadow,
      afterAnimationName: after.animationName,
      afterAnimationDuration: after.animationDuration,
      afterPointerEvents: after.pointerEvents,
    };
  }, selector);
}

/** PDF page whiteness + purity facts. */
async function pagePurity() {
  return win.evaluate(() => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
    const page = pane ? pane.querySelector('.pdf-page') : null;
    const canvas = page ? page.querySelector('canvas') : null;
    const ws = pane ? pane.querySelector('.workspace-main') : null;
    const out = {};
    if (page) {
      const cs = getComputedStyle(page);
      out.page = {
        bg: cs.backgroundColor,
        backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
        filter: cs.filter,
        mixBlendMode: cs.mixBlendMode,
        boxShadow: cs.boxShadow,
      };
    }
    if (canvas) out.canvasBg = getComputedStyle(canvas).backgroundColor;
    if (ws) {
      const cs = getComputedStyle(ws);
      out.workspace = { bg: cs.backgroundColor, backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter };
    }
    return out;
  });
}

test.describe.serial('frosted-acrylic + motion verification (dev build v1.9.1 pre-release)', () => {
  test.afterEach(async () => {
    await hardClose(electronApp);
    electronApp = null;
    win = null;
  });

  test('MAIN: items 1-6, 8, 9 + reflection present', async () => {
    test.setTimeout(600000);
    electronApp = await launchApp();
    win = await electronApp.firstWindow();
    attachErrorCollectors(win);
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(800);

    // ------------------------------------------------------------------
    // ITEM 1 - fresh launch resolves to frosted
    // ------------------------------------------------------------------
    const freshTheme = await readTheme();
    console.log(`[item1] fresh-launch data-theme = ${JSON.stringify(freshTheme)}`);
    expect(freshTheme, 'fresh launch must resolve to the frosted theme').toBe('frosted');
    await snap('frost-a-welcome-frosted.png');

    // ------------------------------------------------------------------
    // ITEM 2 - embedded borderless dropdown: structure + options + keyboard
    // ------------------------------------------------------------------
    const triggerFacts = await win.evaluate(() => {
      const t = document.querySelector('.theme-toggle-trigger');
      if (!t) return null;
      const cs = getComputedStyle(t);
      const wrap = t.closest('.theme-toggle-wrap');
      const inHeader = !!t.closest('.app-header');
      const label = t.querySelector('.theme-toggle-label');
      return {
        exists: true,
        hasPopup: t.getAttribute('aria-haspopup'),
        expanded: t.getAttribute('aria-expanded'),
        ariaLabel: t.getAttribute('aria-label'),
        labelText: label ? label.textContent : null,
        embeddedInHeader: inHeader,
        parentIsWrap: wrap ? wrap.className : null,
        // borderless check: its 1px border track is fully transparent
        borderStyle: cs.borderTopStyle,
        borderTopWidth: cs.borderTopWidth,
        borderColor: cs.borderTopColor,
        bg: cs.backgroundColor,
      };
    });
    console.log(`[item2] trigger facts: ${JSON.stringify(triggerFacts)}`);
    expect(triggerFacts, 'theme trigger must exist').not.toBeNull();
    expect(triggerFacts.hasPopup).toBe('menu');
    expect(triggerFacts.embeddedInHeader, 'dropdown must be embedded in the app header, not detached').toBe(true);
    const trigBorder = parseRgba(triggerFacts.borderColor);
    expect(trigBorder.a, 'the trigger must be borderless (transparent border track)').toBe(0);

    // Keyboard: focus + Enter opens
    await win.focus('.theme-toggle-trigger');
    await win.keyboard.press('Enter');
    await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
    const openState = await win.evaluate(() => {
      const t = document.querySelector('.theme-toggle-trigger');
      const opts = Array.from(document.querySelectorAll('[data-theme-option]'));
      return {
        expanded: t.getAttribute('aria-expanded'),
        order: opts.map((o) => o.getAttribute('data-theme-option')),
        labels: opts.map((o) => o.textContent.trim()),
        checked: opts.filter((o) => o.getAttribute('aria-checked') === 'true').map((o) => o.getAttribute('data-theme-option')),
        activeElement: document.activeElement ? document.activeElement.getAttribute('data-theme-option') : null,
        popoverBg: getComputedStyle(document.querySelector('.theme-toggle-popover')).backgroundColor,
      };
    });
    console.log(`[item2] dropdown open (Enter): ${JSON.stringify(openState)}`);
    expect(openState.expanded).toBe('true');
    expect(openState.order, 'Frosted must lead the option list').toEqual(['frosted', 'dark', 'light']);
    expect(openState.checked, 'frosted must be the selected/default option').toEqual(['frosted']);
    await snap('frost-m-dropdown-open.png');

    // Esc closes and returns focus
    await win.keyboard.press('Escape');
    await win.waitForTimeout(250);
    const afterEsc = await win.evaluate(() => {
      const t = document.querySelector('.theme-toggle-trigger');
      return {
        popoverGone: !document.querySelector('.theme-toggle-popover'),
        expanded: t.getAttribute('aria-expanded'),
        focusOnTrigger: document.activeElement === t,
      };
    });
    console.log(`[item2] after Esc: ${JSON.stringify(afterEsc)}`);
    expect(afterEsc.popoverGone).toBe(true);
    expect(afterEsc.expanded).toBe('false');
    expect(afterEsc.focusOnTrigger, 'focus must return to the trigger after Esc').toBe(true);

    // Arrow keys move, Enter activates: ArrowDown opens on current, ArrowDown -> dark, Enter selects
    await win.keyboard.press('ArrowDown');
    await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
    const focus1 = await win.evaluate(() => document.activeElement.getAttribute('data-theme-option'));
    await win.keyboard.press('ArrowDown');
    const focus2 = await win.evaluate(() => document.activeElement.getAttribute('data-theme-option'));
    console.log(`[item2] arrow-nav focus: open->${focus1}, ArrowDown->${focus2}`);
    expect(focus1, 'opening with ArrowDown must land focus on the selected option (frosted)').toBe('frosted');
    await win.keyboard.press('Enter');
    await win.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark');
    console.log('[item2] keyboard selected DARK via ArrowDown+Enter');
    await win.waitForTimeout(500);
    await snap('frost-b-welcome-dark.png');

    // Mouse path: switch to light
    await setThemeViaDropdown('light');
    await win.waitForTimeout(500);
    await snap('frost-c-welcome-light.png');
    // Back to frosted before opening the document
    await setThemeViaDropdown('frosted');
    await win.waitForTimeout(400);

    // ------------------------------------------------------------------
    // Open report.pdf for the workspace-phase checks
    // ------------------------------------------------------------------
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await win.locator('button:has-text("Open PDF")').first().click();
    await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
    await win.waitForTimeout(2500);

    // ------------------------------------------------------------------
    // ITEM 4 (frosted pass) - PDF pristine
    // ------------------------------------------------------------------
    const purityFrosted = await pagePurity();
    console.log(`[item4:frosted] ${JSON.stringify(purityFrosted)}`);
    expect(purityFrosted.page, 'pdf page element must exist').not.toBeUndefined();
    const pageBg = parseRgba(purityFrosted.page.bg);
    expect(pageBg, 'pdf page must be paper-white in frosted').toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(purityFrosted.page.backdropFilter, 'NO acrylic blur on the pdf page').toBe('none');
    expect(purityFrosted.page.filter, 'no filter on the pdf page').toBe('none');
    const wsBg = parseRgba(purityFrosted.workspace.bg);
    expect(wsBg.a, 'workspace must be solid (not translucent) behind the page').toBe(1);
    expect(wsBg.r < 40 && wsBg.g < 40 && wsBg.b < 45, 'workspace must stay dark in frosted').toBe(true);
    expect(purityFrosted.page.boxShadow, 'page should carry a subtle shadow').not.toBe('none');
    await snap('frost-d-workspace-frosted.png');

    // ------------------------------------------------------------------
    // ITEM 5 (toolbar pass) - colorful icons
    // ------------------------------------------------------------------
    const toolbarIcons = await win.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('.toolbar .tool-btn[data-icon]'));
      return btns.map((b) => ({
        icon: b.getAttribute('data-icon'),
        color: getComputedStyle(b).color,
      }));
    });
    console.log(`[item5] toolbar icon colors: ${JSON.stringify(toolbarIcons)}`);
    const distinctToolbar = new Set(toolbarIcons.map((i) => i.color));
    expect(distinctToolbar.size, 'toolbar icons must carry multiple semantic hues, not one monochrome').toBeGreaterThanOrEqual(4);

    // ------------------------------------------------------------------
    // ITEM 3 - acrylic quality on chrome (doc view: toolbar + rail live)
    // ------------------------------------------------------------------
    const chromeSelectors = ['.titlebar', '.app-header', '.toolbar', '.side-rail'];
    const chrome = [];
    for (const sel of chromeSelectors) {
      const facts = await chromeStyle(sel);
      chrome.push(facts);
    }
    console.log(`[item3] chrome facts: ${JSON.stringify(chrome, null, 1)}`);
    for (const facts of chrome) {
      expect(facts, `${facts.selector} must exist`).not.toBeNull();
      const alpha = parseRgba(facts.bg).a;
      expect(alpha, `${facts.selector} acrylic sheet must be mostly opaque (>=0.88)`).toBeGreaterThanOrEqual(0.88);
      expect(alpha, `${facts.selector} must stay translucent (<=0.94)`).toBeLessThanOrEqual(0.94);
      expect(facts.backdropFilter, `${facts.selector} must carry the frosted blur`).toContain('blur');
    }
    const fgStrong = await win.evaluate(() => getComputedStyle(document.body).getPropertyValue('--fg-strong').trim());
    console.log(`[item3] --fg-strong in frosted = ${fgStrong}`);

    // ------------------------------------------------------------------
    // ITEM 7a - moving reflection present (normal motion)
    // ------------------------------------------------------------------
    const reflToolbar = await chromeStyle('.toolbar');
    const reflRail = await chromeStyle('.side-rail');
    console.log(`[item7] toolbar::after anim=${reflToolbar.afterAnimationName} ${reflToolbar.afterAnimationDuration}, rail::after anim=${reflRail.afterAnimationName} ${reflRail.afterAnimationDuration}, pe=${reflToolbar.afterPointerEvents}`);
    expect(reflToolbar.afterAnimationName, 'frosted toolbar must run the acrylic-sheen sweep').toBe('acrylic-sheen');
    expect(reflRail.afterAnimationName).toBe('acrylic-sheen');
    expect(reflToolbar.afterPointerEvents, 'the band must never join a hit test').toBe('none');
    // subtlety: mechanical band gradient peak is 0.05 alpha per styles.css; verify the animation is slow (>=7s loop)
    expect(parseFloat(reflToolbar.afterAnimationDuration)).toBeGreaterThanOrEqual(7);

    // ------------------------------------------------------------------
    // ITEM 5 (palette pass) + ITEM 6 - open the tools panel
    // ------------------------------------------------------------------
    await openPalette();
    const paletteIcons = await win.evaluate(() => {
      const entries = Array.from(document.querySelectorAll('.tools-palette-entry[data-tool-id]'));
      return entries.map((e) => ({
        id: e.getAttribute('data-tool-id'),
        color: getComputedStyle(e.querySelector('.tools-palette-entry-icon')).color,
      }));
    });
    console.log(`[item5] palette icon colors: ${JSON.stringify(paletteIcons)}`);
    const distinctPalette = new Set(paletteIcons.map((i) => i.color));
    expect(distinctPalette.size, 'palette icons must carry multiple semantic hues').toBeGreaterThanOrEqual(5);
    await snap('frost-g-palette-frosted.png');

    const groups = await win.evaluate(() => {
      const labels = Array.from(document.querySelectorAll('.tools-palette-group-label'));
      return labels.map((l) => ({
        text: l.textContent.trim(),
        transform: getComputedStyle(l).textTransform,
        color: getComputedStyle(l).color,
        fontSize: getComputedStyle(l).fontSize,
      }));
    });
    console.log(`[item6] group labels: ${JSON.stringify(groups)}`);
    expect(groups.map((g) => g.text)).toEqual(['Organize Pages', 'Document', 'Recognition', 'Export']);
    for (const g of groups) {
      expect(g.transform, 'group headers must render uppercase').toBe('uppercase');
      const c = parseRgba(g.color);
      const lum = (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
      expect(lum, 'group headers must be quiet (muted gray, not bright white)').toBeLessThan(0.55);
    }

    // ------------------------------------------------------------------
    // ITEM 8 - spring motion: panel enter + EXIT animation (glides out)
    // ------------------------------------------------------------------
    // Panel: close via toggle and sample mid-exit
    await win.click('[data-tools-toggle]');
    const exitSample1 = await win.evaluate(() => {
      const el = document.querySelector('[data-tools-palette]');
      if (!el) return { present: false };
      const cs = getComputedStyle(el);
      return { present: true, opacity: cs.opacity, transform: cs.transform, pointerEvents: cs.pointerEvents };
    });
    await win.waitForTimeout(130);
    const exitSample2 = await win.evaluate(() => {
      const el = document.querySelector('[data-tools-palette]');
      if (!el) return { present: false };
      const cs = getComputedStyle(el);
      return { present: true, opacity: cs.opacity, transform: cs.transform, pointerEvents: cs.pointerEvents };
    });
    console.log(`[item8] palette EXIT samples: t0=${JSON.stringify(exitSample1)} t130=${JSON.stringify(exitSample2)}`);
    expect(exitSample1.present, 'palette must still be in DOM immediately after close (exit animation, not snap)').toBe(true);
    expect(exitSample2.present, 'palette must still be animating out at +130ms (panel spring is ~280ms)').toBe(true);
    const midExit = exitSample1.opacity !== '1' || exitSample1.transform !== 'none' || exitSample1.pointerEvents === 'none'
      ? exitSample1 : exitSample2;
    expect(
      midExit.opacity !== '1' || midExit.transform !== 'none' || midExit.pointerEvents === 'none',
      'mid-exit sample must catch a non-final state (opacity/transform still animating or pointer-events pinned)',
    ).toBe(true);
    await win.waitForTimeout(900);
    const goneAfter = await win.evaluate(() => !!document.querySelector('[data-tools-palette]'));
    expect(goneAfter, 'palette must be removed from the DOM after the exit spring settles').toBe(false);

    // Panel: reopen and sample mid-enter
    await win.click('[data-tools-toggle]');
    const enterSample = await win.evaluate(() => {
      const el = document.querySelector('[data-tools-palette]');
      if (!el) return { present: false };
      const cs = getComputedStyle(el);
      return { present: true, opacity: cs.opacity, transform: cs.transform };
    });
    console.log(`[item8] palette ENTER sample: ${JSON.stringify(enterSample)}`);
    expect(enterSample.present).toBe(true);
    await win.waitForTimeout(600);

    // Dialog: open Insert pages, snap, close with Escape, sample mid-exit
    await win.click('[data-tool-id="insertPages"]');
    await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 8000 });
    await win.waitForTimeout(600);
    await snap('frost-j-dialog-frosted.png');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(130);
    const dlgExit = await win.evaluate(() => {
      const bd = document.querySelector('.modal-backdrop');
      const dlg = document.querySelector('.modal-dialog');
      if (!bd && !dlg) return { present: false };
      const cs = dlg ? getComputedStyle(dlg) : null;
      return {
        present: true,
        backdropPresent: !!bd,
        opacity: cs ? cs.opacity : null,
        transform: cs ? cs.transform : null,
        pointerEvents: cs ? cs.pointerEvents : null,
      };
    });
    console.log(`[item8] dialog EXIT sample (+130ms): ${JSON.stringify(dlgExit)}`);
    expect(dlgExit.present, 'dialog must still be in DOM at +130ms after Escape (exit spring ~240ms)').toBe(true);
    expect(
      (dlgExit.opacity !== null && parseFloat(dlgExit.opacity) < 0.99) || (dlgExit.transform && dlgExit.transform !== 'none') || dlgExit.pointerEvents === 'none',
      'dialog must be caught mid-exit (opacity/transform animating or pointer-events pinned)',
    ).toBe(true);
    await win.waitForTimeout(900);
    const dlgGone = await win.evaluate(() => !document.querySelector('.modal-backdrop') && !document.querySelector('.modal-dialog'));
    expect(dlgGone, 'dialog must fully unmount after its exit spring').toBe(true);

    // Menu: open the titlebar application menu and close it
    await win.click('[data-menu-button]');
    await win.waitForSelector('[data-menu-popover]', { timeout: 5000 });
    await win.waitForTimeout(350);
    await snap('frost-n-menu-frosted.png');
    await win.keyboard.press('Escape');
    await win.waitForTimeout(100);
    const menuExit = await win.evaluate(() => {
      const el = document.querySelector('[data-menu-popover]');
      if (!el) return { present: false };
      const cs = getComputedStyle(el);
      return { present: true, opacity: cs.opacity, transform: cs.transform, pointerEvents: cs.pointerEvents };
    });
    console.log(`[item8] menu EXIT sample (+100ms): ${JSON.stringify(menuExit)}`);
    expect(menuExit.present, 'menu must still be in DOM at +100ms after Escape (exit spring ~180ms)').toBe(true);
    await win.waitForTimeout(800);
    const menuGone = await win.evaluate(() => !document.querySelector('[data-menu-popover]'));
    expect(menuGone, 'menu popover must unmount after its exit').toBe(true);

    // ------------------------------------------------------------------
    // ITEM 8b - no PDF scroll/zoom jank
    // ------------------------------------------------------------------
    const scrollTimes = await win.evaluate(async () => {
      const sc = document.querySelector('.document-scroller');
      if (!sc) return null;
      const times = [];
      for (let i = 0; i < 8; i++) {
        const t0 = performance.now();
        sc.scrollTop += 600;
        // force a layout/paint tick
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        times.push(performance.now() - t0);
      }
      return times;
    });
    console.log(`[item8] scroll step times (ms): ${JSON.stringify(scrollTimes)}`);
    const avgScroll = scrollTimes.reduce((a, b) => a + b, 0) / scrollTimes.length;
    console.log(`[item8] avg scroll step = ${avgScroll.toFixed(1)}ms`);
    expect(avgScroll, 'scroll steps must stay smooth (<150ms per 600px step incl. 2 rAF ticks)').toBeLessThan(150);

    await win.click('button[title="Zoom in"]');
    await win.waitForTimeout(400);
    const zoomAfter = await win.evaluate(() => {
      const z = document.querySelector('.zoom-percent');
      return z ? z.textContent.trim() : null;
    });
    console.log(`[item8] zoom after click = ${zoomAfter}`);
    expect(zoomAfter, 'zoom-in click must update the zoom readout').toBeTruthy();
    const zoomNum = parseFloat(zoomAfter);
    expect(zoomNum, 'zoom readout must have increased').toBeGreaterThan(100);
    await win.click('button[title="Zoom out"]');
    await win.waitForTimeout(400);

    // ------------------------------------------------------------------
    // ITEM 4 (dark + light passes) + themed workspace/palette/dialog shots
    // ------------------------------------------------------------------
    await closePaletteIfOpen();
    for (const t of ['dark', 'light']) {
      await setThemeViaDropdown(t);
      await win.waitForTimeout(600);
      const purity = await pagePurity();
      console.log(`[item4:${t}] ${JSON.stringify(purity)}`);
      const bg = parseRgba(purity.page.bg);
      expect(bg, `pdf page must be paper-white in ${t}`).toEqual({ r: 255, g: 255, b: 255, a: 1 });
      expect(purity.page.backdropFilter, `no blur on the page in ${t}`).toBe('none');
      expect(purity.page.filter, `no filter on the page in ${t}`).toBe('none');
      const letter = t === 'dark' ? 'e' : 'f';
      await snap(`frost-${letter}-workspace-${t}.png`);

      await openPalette();
      const pletter = t === 'dark' ? 'h' : 'i';
      await snap(`frost-${pletter}-palette-${t}.png`);
      await win.click('[data-tool-id="insertPages"]');
      await win.waitForSelector('[data-insert-pages-dialog]', { timeout: 8000 });
      await win.waitForTimeout(600);
      const dletter = t === 'dark' ? 'j' : 'k';
      await snap(`frost-${dletter}-dialog-${t}.png`);
      await win.keyboard.press('Escape');
      await win.waitForTimeout(700);
      await closePaletteIfOpen();
    }

    // ------------------------------------------------------------------
    // ITEM 9 - regression: search, annotate, tabs, theme flips
    // ------------------------------------------------------------------
    await setThemeViaDropdown('frosted');
    await win.waitForTimeout(500);

    // Search
    await win.keyboard.press('Control+f');
    await win.waitForSelector('input[aria-label="Search query"]', { timeout: 8000 });
    await win.locator('input[aria-label="Search query"]').first().click();
    await win.locator('input[aria-label="Search query"]').first().fill('orchestration');
    await win.waitForTimeout(2500);
    const searchState = await win.evaluate(() => {
      const d = window.tflexDiagnostics ? window.tflexDiagnostics() : null;
      const status = document.querySelector('.search-bar .search-status');
      return { hits: d ? d.searchHits : null, statusText: status ? status.textContent : null };
    });
    console.log(`[item9] search 'orchestration': ${JSON.stringify(searchState)}`);
    expect(Number(searchState.hits), 'search must find hits in report.pdf').toBeGreaterThanOrEqual(1);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(400);

    // Annotate: arm Highlight and drag across a real text span (proven
    // smoke-spec mechanics - highlight is a drag markup tool that needs
    // text quads under the drag; a blind drag over empty space commits
    // nothing by design). The scroll-jank test left the viewport around
    // page 5, so return to page 1 first and pick a span that is actually
    // inside the viewport.
    await scrollToPage(win, 1);
    await win.click('button[aria-label="Highlight"]');
    await win.waitForTimeout(350);
    const hlSpan = await win.evaluate(() => {
      const spans = Array.from(
        document.querySelectorAll('.tab-pane[aria-hidden="false"] .pdf-page .textLayer span'),
      )
        .map((s) => { const r = s.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })
        .filter((r) => r.w > 30 && r.h > 6 && r.y > 120 && r.y < window.innerHeight - 120);
      return spans[0] || null;
    });
    console.log(`[item9] highlight target span: ${JSON.stringify(hlSpan)}`);
    expect(hlSpan, 'page 1 must expose text-layer spans to highlight').not.toBeNull();
    await win.mouse.move(hlSpan.x + 2, hlSpan.y + hlSpan.h / 2);
    await win.mouse.down();
    await win.mouse.move(hlSpan.x + hlSpan.w - 2, hlSpan.y + hlSpan.h / 2 + 2, { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(2000);
    const annState = await win.evaluate(() => {
      const d = window.tflexDiagnostics ? window.tflexDiagnostics() : null;
      const e = d && d.engineState ? d.engineState : {};
      return { modified: d ? d.modified : null, annCount: (e.annotations || []).length, activeTool: d ? d.activeTool : null };
    });
    console.log(`[item9] after highlight drag: ${JSON.stringify(annState)}`);
    expect(annState.annCount, 'the highlight drag must produce a committed annotation').toBeGreaterThanOrEqual(1);
    await snap('frost-o-annotated.png');

    // Tabs: spawn an empty tab, switch between tabs
    const tabCountBefore = await win.evaluate(() => document.querySelectorAll('.tab[data-tab-id]').length);
    await win.click('[data-new-tab]');
    await win.waitForTimeout(700);
    const tabCountAfter = await win.evaluate(() => document.querySelectorAll('.tab[data-tab-id]').length);
    console.log(`[item9] tabs before=${tabCountBefore} after+=${tabCountAfter}`);
    expect(tabCountAfter, 'the + tab affordance must spawn a new tab').toBe(tabCountBefore + 1);
    const firstTabId = await win.evaluate(() => document.querySelector('.tab[data-tab-id]').getAttribute('data-tab-id'));
    await win.click(`.tab[data-tab-id="${firstTabId}"]`);
    await win.waitForTimeout(700);
    const activeTab = await win.evaluate(() => {
      const t = document.querySelector('.tab-active');
      return t ? t.getAttribute('data-tab-id') : null;
    });
    expect(activeTab, 'clicking the first tab must reactivate it').toBe(firstTabId);

    // Theme flips (dropdown) - three round trips
    for (const t of ['dark', 'light', 'frosted']) {
      await setThemeViaDropdown(t);
      const now = await readTheme();
      expect(now).toBe(t);
    }
    console.log('[item9] theme flips OK');

    // Zero renderer errors through the whole run
    console.log(`[errors] collected ${rendererErrors.length}: ${JSON.stringify(rendererErrors, null, 1)}`);
    expect(rendererErrors, 'no renderer errors may surface during the whole verification').toEqual([]);
  });

  test('REDUCED MOTION: reflection absent, springs become instant (item 7b)', async () => {
    test.setTimeout(240000);
    electronApp = await launchApp();
    win = await electronApp.firstWindow();
    attachErrorCollectors(win);
    await win.waitForSelector('.sample-card', { timeout: 30000 });

    // Playwright's supported reduced-motion emulation drives the exact
    // CSS media query + matchMedia that both the stylesheet and the
    // motion wrappers read. (The --force-prefers-reduced-motion launch
    // switch is NOT honored by this Electron build - verified 2x.)
    await win.emulateMedia({ reducedMotion: 'reduce' });
    await win.waitForTimeout(400);
    const reduced = await win.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    console.log(`[item7] prefers-reduced-motion (emulated) = ${reduced}`);
    expect(reduced, 'the reduced-motion switch must reach the renderer').toBe(true);

    // Open a doc so .toolbar/.side-rail exist
    const reportPath = getSamplePath('report.pdf');
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, reportPath);
    await win.locator('button:has-text("Open PDF")').first().click();
    await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
    await win.waitForTimeout(2000);

    const refl = await win.evaluate(() => {
      const tb = document.querySelector('.toolbar');
      const sr = document.querySelector('.side-rail');
      return {
        toolbarAnim: tb ? getComputedStyle(tb, '::after').animationName : null,
        railAnim: sr ? getComputedStyle(sr, '::after').animationName : null,
      };
    });
    console.log(`[item7] reduced-motion reflection anim: ${JSON.stringify(refl)}`);
    expect(refl.toolbarAnim, 'the moving reflection must be ABSENT under prefers-reduced-motion').toBe('none');
    expect(refl.railAnim).toBe('none');

    // Motion wrappers: reduced mode = opacity-only, instant
    await win.click('[data-tools-toggle]');
    await win.waitForTimeout(150);
    const palState = await win.evaluate(() => {
      const el = document.querySelector('[data-tools-palette]');
      if (!el) return { present: false };
      const cs = getComputedStyle(el);
      return { present: true, opacity: cs.opacity, transform: cs.transform };
    });
    console.log(`[item7] reduced-motion palette at +150ms: ${JSON.stringify(palState)}`);
    expect(palState.present).toBe(true);
    expect(palState.opacity, 'reduced-motion surface must reach full opacity instantly (no travel)').toBe('1');
    expect(palState.transform, 'reduced-motion surface must never animate a transform').toBe('none');
    await snap('frost-p-reduced-motion-palette.png');

    // Exit is instant too (duration 0)
    await win.click('[data-tools-toggle]');
    await win.waitForTimeout(200);
    const palGone = await win.evaluate(() => !document.querySelector('[data-tools-palette]'));
    console.log(`[item7] reduced-motion palette gone at +200ms = ${palGone}`);
    expect(palGone, 'reduced-motion exit is instant (no travel), element unmounts right away').toBe(true);

    console.log(`[errors:reduced] collected ${rendererErrors.length}: ${JSON.stringify(rendererErrors)}`);
    expect(rendererErrors).toEqual([]);
  });
});
