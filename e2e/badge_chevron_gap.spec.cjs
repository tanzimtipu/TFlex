// e2e/badge_chevron_gap.spec.cjs
//
// Verifies two fixes on the [data-tools-badge] "All tools" arrow tab:
//
//   1. Chevron flip via icon swap. The badge renders lucide-chevron-left
//      while the palette is CLOSED and lucide-chevron-right while it is
//      OPEN. The flip must come from the React icon swap alone: the
//      chevron span must carry NO transform in either state. (The removed
//      CSS rule `.tools-badge-tracker-open .tools-badge-chevron {
//      transform: rotate(180deg) }` spun the open-state right-pointing
//      glyph back to left, so the arrow never visibly changed direction.)
//
//   2. No gap between the document scrollbar and the Tools panel. While
//      open, the page-view inset is exactly the panel width
//      (--tf-tools-inset == --tools-panel-w, no "+12px breathing gap"),
//      so the scroller's right border edge — where its 10px scrollbar
//      sits flush — lands on the panel's left edge. Pre-fix the inset
//      was panel width + 12px, leaving a 12px canvas strip between the
//      scrollbar and the panel.
//
// Modeled on e2e/badge_size_slide.spec.cjs (single dev launch, one
// open/close cycle, no screenshots — geometry is asserted from the DOM).
const { test, expect } = require('@playwright/test');
const { launchDev, openSample, hardClose, dismissUpdatePrompt } = require('./lib/helpers.cjs');

// [data-tools-badge] state: glyph class + chevron-span transform.
function probeBadgeState(window) {
  return window.evaluate(() => {
    const b = document.querySelector('[data-tools-badge]');
    if (!b) return null;
    const svg = b.querySelector('svg');
    const chevron = b.querySelector('.tools-badge-chevron');
    return {
      svgClass: svg ? svg.getAttribute('class') : null,
      chevronTransform: chevron ? getComputedStyle(chevron).transform : null,
      ariaPressed: b.getAttribute('aria-pressed'),
    };
  });
}

// Layout geometry: scroller border box vs palette border box.
// In Blink the webkit scrollbar is painted flush against the scroller's
// right border edge (offsetWidth - clientWidth is its gutter), so the
// visible scrollbar-to-panel gap is exactly palette.left - scroller.right.
function probeGeometry(window) {
  return window.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    const main = document.querySelector('.app-main');
    const pal = document.querySelector('[data-tools-palette]');
    if (!sc || !main) return null;
    const sr = sc.getBoundingClientRect();
    const pr = pal ? pal.getBoundingClientRect() : null;
    return {
      scroller: { left: sr.left, right: sr.right, width: sr.width },
      palette: pr ? { left: pr.left, right: pr.right, width: pr.width } : null,
      scrollbarGutter: sc.offsetWidth - sc.clientWidth,
      overflows: sc.scrollHeight > sc.clientHeight,
      marginRight: getComputedStyle(sc).marginRight,
      toolsOpen: main.getAttribute('data-tools-open'),
      toolsMode: main.getAttribute('data-tools-mode'),
      panelW: getComputedStyle(main).getPropertyValue('--tools-panel-w').trim(),
      viewW: window.innerWidth,
    };
  });
}

// Computed transform: 'none' or the identity matrix both mean "unrotated".
const isUnrotated = (t) => t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)';

test.describe('[data-tools-badge] chevron flip + scrollbar/panel gap', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    ({ electronApp, window } = await launchDev());
    await dismissUpdatePrompt(window);
    await openSample(window, electronApp, 'report.pdf');
    await window.waitForSelector('[data-tools-badge]', { timeout: 15000 });
    await window.mouse.move(10, 10);
    await window.waitForTimeout(500);
  });

  test.afterEach(async () => {
    if (electronApp) await hardClose(electronApp);
  });

  test('chevron swaps left<->right with panel state (no CSS counter-rotation); scrollbar meets the panel with no gap', async () => {
    test.setTimeout(180000);
    const badge = window.locator('[data-tools-badge]');
    await badge.waitFor({ timeout: 10000 });

    // ---- Closed at rest: ChevronLeft glyph, unrotated, no panel -------
    let g = await probeGeometry(window);
    expect(g, '.document-scroller / .app-main missing').not.toBeNull();
    console.log('[chevron-gap] closed:', JSON.stringify(g));
    expect(g.toolsOpen, `data-tools-open at rest is ${g.toolsOpen} (want "false")`).toBe('false');
    expect(g.palette, 'palette should not be mounted while closed').toBeNull();
    expect(parseFloat(g.marginRight), `scroller margin-right at rest is ${g.marginRight} (want 0px)`).toBeLessThanOrEqual(1);

    let s = await probeBadgeState(window);
    expect(s, '[data-tools-badge] missing').not.toBeNull();
    console.log('[chevron-gap] closed badge:', JSON.stringify(s));
    expect(s.svgClass || '', `closed glyph class ${JSON.stringify(s.svgClass)} (want lucide-chevron-left)`).toContain('lucide-chevron-left');
    expect(isUnrotated(s.chevronTransform), `closed chevron transform ${s.chevronTransform} (want none)`).toBeTruthy();

    // ---- Open: click the badge -----------------------------------------
    await badge.click();
    await window.waitForSelector('.app-main[data-tools-open="true"]', { timeout: 5000 });
    await window.waitForSelector('[data-tools-palette]', { timeout: 5000 });
    await window.waitForTimeout(600); // panel-slide (150ms token) + settle

    // 1. Icon swap: right-pointing glyph, and NO counter-rotation on the
    //    span (the regression this fix removes).
    s = await probeBadgeState(window);
    expect(s, '[data-tools-badge] detached after open').not.toBeNull();
    console.log('[chevron-gap] open badge:', JSON.stringify(s));
    expect(s.svgClass || '', `open glyph class ${JSON.stringify(s.svgClass)} (want lucide-chevron-right)`).toContain('lucide-chevron-right');
    expect(
      isUnrotated(s.chevronTransform),
      `open chevron transform is ${s.chevronTransform} - a CSS rotation is spinning the right-pointing glyph back to left`,
    ).toBeTruthy();
    expect(s.ariaPressed, `aria-pressed after open (want "true")`).toBe('true');

    // 2. Gap: scroller right edge (where the scrollbar sits flush) must
    //    meet the panel's left edge, and the inset must equal the panel
    //    width exactly — no +12px breathing gap.
    g = await probeGeometry(window);
    expect(g, 'geometry probe failed while open').not.toBeNull();
    expect(g.palette, 'palette not mounted after open').not.toBeNull();
    console.log('[chevron-gap] open:', JSON.stringify(g));
    const gap = g.palette.left - g.scroller.right;
    expect(
      Math.abs(gap),
      `gap between scroller right edge and panel left edge is ${gap.toFixed(1)}px (want 0; pre-fix value was +12px)`,
    ).toBeLessThanOrEqual(1);
    const panelW = parseFloat(g.panelW);
    expect(Number.isFinite(panelW), `--tools-panel-w unresolved (${g.panelW})`).toBeTruthy();
    expect(
      Math.abs(parseFloat(g.marginRight) - panelW),
      `scroller margin-right ${g.marginRight} != panel width ${g.panelW} - the inset carries a gap`,
    ).toBeLessThanOrEqual(1);
    console.log(
      `[chevron-gap] scrollbar gutter ${g.scrollbarGutter}px (content overflows: ${g.overflows}); ` +
        `scroller right edge ${g.scroller.right.toFixed(1)} vs panel left edge ${g.palette.left.toFixed(1)}`,
    );

    // ---- Close: second click restores the left glyph and full width ----
    await badge.click();
    await window.waitForSelector('.app-main[data-tools-open="false"]', { timeout: 5000 });
    await window.waitForSelector('[data-tools-palette]', { state: 'detached', timeout: 5000 });
    await window.waitForTimeout(600);

    s = await probeBadgeState(window);
    expect(s, '[data-tools-badge] missing after close').not.toBeNull();
    expect(s.svgClass || '', `re-closed glyph class ${JSON.stringify(s.svgClass)} (want lucide-chevron-left)`).toContain('lucide-chevron-left');
    expect(isUnrotated(s.chevronTransform), `chevron transform after close ${s.chevronTransform} (want none)`).toBeTruthy();

    g = await probeGeometry(window);
    expect(g, 'geometry probe failed after close').not.toBeNull();
    expect(parseFloat(g.marginRight), `margin-right after close is ${g.marginRight} (want 0px)`).toBeLessThanOrEqual(1);
    expect(
      Math.abs(g.viewW - g.scroller.right),
      `scroller right edge ${g.scroller.right.toFixed(1)} is not back at the viewport right edge (${g.viewW})`,
    ).toBeLessThanOrEqual(1);
    console.log('[chevron-gap] re-closed:', JSON.stringify(g));
  });
});