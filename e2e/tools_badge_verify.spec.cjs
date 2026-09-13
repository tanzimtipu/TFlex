// Tools badge verification (floating Tools palette toggle on the page view's
// right edge). Drives the BUILT dev app through the canonical launcher.
//
// Checks (phase checklist):
//   1. Badge exists on the right edge of the page view ([data-tools-badge])
//   2. Default: semi-transparent (quiet), opacity 0.35
//   3. Hover: fully opaque (opacity 1)
//   4. Closed state: left-pointing chevron (lucide-chevron-left)
//   5. Open state: right-pointing chevron (lucide-chevron-right) after click
//   6. Click toggles the tools panel open/close (real state change:
//      .app-main[data-tools-open], [data-tools-palette] mounted, page view
//      margin-right narrows and restores)
//   7. Top toolbar (.toolbar) carries NO "All tools" / LayoutGrid toggle anymore
//
// Screenshots: badge-default, badge-hover, badge-open, badge-closed,
// badge-toolbar-clean (all under screenshots/).
const { test, expect } = require('@playwright/test');
const { launchDev, openSample, hardClose, dismissUpdatePrompt } = require('./lib/helpers.cjs');

const TOL_PX = 6;

async function badgeInfo(window) {
  return window.evaluate(() => {
    const badge = document.querySelector('[data-tools-badge]');
    if (!badge) return null;
    const cs = getComputedStyle(badge);
    const r = badge.getBoundingClientRect();
    const svg = badge.querySelector('svg');
    const main = badge.closest('.workspace-main');
    const toolbar = badge.closest('.toolbar');
    const mainR = main ? main.getBoundingClientRect() : null;
    return {
      present: true,
      ariaPressed: badge.getAttribute('aria-pressed'),
      ariaLabel: badge.getAttribute('aria-label'),
      title: badge.getAttribute('title'),
      opacity: cs.opacity,
      rect: { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right },
      inWorkspaceMain: !!main,
      inToolbar: !!toolbar,
      mainRect: mainR ? { right: mainR.right, cy: (mainR.top + mainR.bottom) / 2 } : null,
      svgClass: svg ? svg.getAttribute('class') : null,
      zIndex: cs.zIndex,
    };
  });
}

async function readMarginRight(window) {
  return window.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    return sc ? parseFloat(getComputedStyle(sc).marginRight) : null;
  });
}

// Poll a numeric style value until it stops changing (transition settled).
async function waitStyleStable(window, readFn, timeoutMs = 3000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    const v = await readFn(window);
    if (v === last) return v;
    last = v;
    await window.waitForTimeout(80);
  }
  return last;
}

test.describe('Tools badge (floating page-edge toggle)', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    ({ electronApp, window } = await launchDev());
    await dismissUpdatePrompt(window);
    await openSample(window, electronApp, 'report.pdf');
  });

  test.afterEach(async () => {
    if (electronApp) await hardClose(electronApp);
  });

  test('badge edge placement, opacity states, chevron flip, panel toggle, toolbar clean', async () => {
    test.setTimeout(120000);

    // ---- CHECK 1: badge exists on the right edge of the page view ----
    await window.waitForSelector('[data-tools-badge]', { timeout: 10000 });
    const closed = await badgeInfo(window);
    console.log('[CHECK1] closed badge:', JSON.stringify(closed));
    expect(closed, 'badge [data-tools-badge] must exist in the workspace').not.toBeNull();
    expect(closed.inWorkspaceMain, 'badge must be anchored in .workspace-main (page view)').toBe(true);
    expect(closed.inToolbar, 'badge must NOT live in the top toolbar').toBe(false);
    const distFromRightEdge = closed.mainRect.right - closed.rect.right;
    expect(
      Math.abs(distFromRightEdge - 8),
      `badge right edge should sit ~8px inside .workspace-main right edge (got ${distFromRightEdge}px)`,
    ).toBeLessThanOrEqual(TOL_PX);
    const mainCenter = await window.evaluate(() => {
      const m = document.querySelector('.workspace-main');
      const r = m.getBoundingClientRect();
      return (r.top + r.bottom) / 2;
    });
    const badgeCenterY = closed.rect.y + closed.rect.h / 2;
    expect(
      Math.abs(badgeCenterY - mainCenter),
      `badge should be vertically centered in .workspace-main (badge y=${badgeCenterY}, main center=${mainCenter})`,
    ).toBeLessThanOrEqual(24);
    expect(closed.ariaPressed, 'closed badge aria-pressed').toBe('false');
    expect(closed.ariaLabel).toBe('Open tools palette');

    // ---- CHECK 2: default state is quiet / semi-transparent ----
    const defaultOpacity = await window.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-tools-badge]')).opacity));
    console.log(`[CHECK2] default opacity=${defaultOpacity}`);
    expect(defaultOpacity, 'default badge opacity should be 0.35 (quiet)').toBeGreaterThan(0.29);
    expect(defaultOpacity).toBeLessThan(0.45);
    await window.screenshot({ path: 'screenshots/badge-default.png' });

    // ---- CHECK 3: hover -> fully opaque ----
    await window.locator('[data-tools-badge]').hover();
    const hoverOpacity = await waitStyleStable(window, (w) => w.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-tools-badge]')).opacity)));
    console.log(`[CHECK3] hover opacity=${hoverOpacity}`);
    expect(hoverOpacity, 'hovered badge must be fully opaque (opacity 1)').toBeGreaterThan(0.97);
    await window.screenshot({ path: 'screenshots/badge-hover.png' });

    // ---- CHECK 4: closed state shows LEFT-pointing chevron ----
    expect(
      closed.svgClass,
      'closed badge must contain the left chevron glyph (lucide-chevron-left)',
    ).toContain('lucide-chevron-left');
    expect(closed.svgClass).not.toContain('lucide-chevron-right');

    // ---- CHECK 6 (open direction): click opens the panel ----
    const marginClosed = await waitStyleStable(window, readMarginRight);
    console.log(`[CHECK6] scroller margin-right closed=${marginClosed}`);
    await window.locator('[data-tools-badge]').click();
    await window.waitForSelector('.app-main[data-tools-open="true"]', { timeout: 5000 });
    await window.waitForSelector('[data-tools-palette]', { timeout: 5000 });
    const marginOpen = await waitStyleStable(window, readMarginRight);
    console.log(`[CHECK6] scroller margin-right open=${marginOpen}`);
    expect(
      marginOpen,
      'page view must narrow (margin-right > 0) while the panel is open',
    ).toBeGreaterThan((marginClosed || 0) + 100);
    const open = await badgeInfo(window);
    console.log('[CHECK6] open badge:', JSON.stringify(open));
    expect(open.ariaPressed, 'open badge aria-pressed').toBe('true');
    expect(open.ariaLabel).toBe('Close tools palette');
    expect(
      open.svgClass,
      'open badge must flip to the right chevron glyph (lucide-chevron-right)',
    ).toContain('lucide-chevron-right');
    expect(open.svgClass).not.toContain('lucide-chevron-left');
    // The panel must be a real tools palette, not an empty shell.
    const entryCount = await window.locator('[data-tools-palette] [data-tool-id]').count();
    console.log(`[CHECK6] palette tool entries=${entryCount}`);
    expect(entryCount, 'open palette must expose tool entries').toBeGreaterThanOrEqual(5);
    await window.screenshot({ path: 'screenshots/badge-open.png' });

    // ---- CHECK 6 (close direction): second click closes the panel ----
    await window.locator('[data-tools-badge]').click();
    await window.waitForSelector('.app-main[data-tools-open="false"]', { timeout: 5000 });
    await window.waitForSelector('[data-tools-palette]', { state: 'detached', timeout: 5000 });
    const marginClosed2 = await waitStyleStable(window, readMarginRight);
    console.log(`[CHECK6] scroller margin-right after close=${marginClosed2}`);
    expect(
      Math.abs(marginClosed2 - (marginClosed || 0)),
      'page view margin must restore after close',
    ).toBeLessThanOrEqual(2);
    const reclosed = await badgeInfo(window);
    console.log('[CHECK6] re-closed badge:', JSON.stringify(reclosed));
    expect(reclosed.ariaPressed).toBe('false');
    expect(reclosed.ariaLabel).toBe('Open tools palette');
    expect(reclosed.svgClass).toContain('lucide-chevron-left');
    await window.screenshot({ path: 'screenshots/badge-closed.png' });

    // ---- CHECK 7: top toolbar has NO "All tools" / LayoutGrid toggle ----
    const toolbarState = await window.evaluate(() => {
      const tb = document.querySelector('.toolbar');
      if (!tb) return { exists: false };
      const buttons = [...tb.querySelectorAll('button')].map((b) => ({
        label: b.getAttribute('aria-label') || '',
        title: b.getAttribute('title') || '',
        text: (b.textContent || '').trim(),
        classes: b.className,
      }));
      const toggleInToolbar = tb.querySelectorAll('.tools-badge, [data-tools-toggle], [data-tools-badge]').length;
      return { exists: true, count: buttons.length, buttons, toggleInToolbar };
    });
    console.log('[CHECK7] toolbar:', JSON.stringify(toolbarState, null, 2));
    expect(toolbarState.exists, '.toolbar must exist').toBe(true);
    const allToolsButtons = toolbarState.buttons.filter(
      (b) => /all tools/i.test(b.label) || /all tools/i.test(b.title) || /all tools/i.test(b.text),
    );
    expect(allToolsButtons, `toolbar must not contain an "All tools" button (found: ${JSON.stringify(allToolsButtons)})`).toHaveLength(0);
    expect(
      toolbarState.toggleInToolbar,
      'the tools toggle must not live in the toolbar anymore',
    ).toBe(0);
    await window.screenshot({ path: 'screenshots/badge-toolbar-clean.png' });
  });
});