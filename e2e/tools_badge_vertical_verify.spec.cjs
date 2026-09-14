// "All tools" badge VERTICAL-TEXT verification (post-change verification run).
//
// The badge label (.tools-badge-label) was changed from horizontal text to a
// vertical layout (writing-mode: vertical-rl, blue gradient chip). This spec
// verifies, in each of the three themes (light, dark, frosted):
//
//   1. Badge exists on the page view's right edge; label still reads
//      "All tools".
//   2. The label text is VERTICAL: computed writing-mode is vertical-* (or the
//      label is rotated 90deg), and geometrically the label box is taller than
//      it is wide (the text column runs top -> bottom).
//   3. Proper layout: the label (chip included) fits inside the pill box -
//      no overflow beyond the .tools-badge box on any side (the pill has a
//      fixed 48px height; a tall vertical label must not stick out).
//   4. At-rest opacity ~0.35 (quiet), hover -> fully opaque.
//   5. Badge is still clickable: click opens the tools palette
//      ([data-tools-palette] mounts, aria-pressed=true, page view narrows);
//      a second click closes it again. Verified per theme.
//   6. Screenshots: full window + badge close-up (at rest, hovered) per
//      theme, plus an open-palette shot, so the vertical layout can be
//      judged visually in every theme.
//
// All per-theme problems are COLLECTED (not asserted mid-loop) so every theme
// is exercised and screenshotted even if one theme overflows; the final
// assertion reports the collected issues in one shot.

const { test, expect } = require('@playwright/test');
const { launchDev, openSample, hardClose } = require('./lib/helpers.cjs');

const THEMES = ['light', 'dark', 'frosted'];
const OVERFLOW_TOL = 2; // px tolerance for rounding / AA edges

async function switchTheme(window, want) {
  const current = await window.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (current === want) return;
  await window.click('[data-theme-toggle]');
  await window.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await window.click(`[data-theme-option="${want}"]`);
  await window.waitForFunction(
    (t) => document.documentElement.getAttribute('data-theme') === t,
    want,
    { timeout: 5000 },
  );
  // Let the ~400ms theme crossfade + popover settle before measuring.
  await window.waitForTimeout(800);
}

test.describe('"All tools" badge vertical text verification', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    ({ electronApp, window } = await launchDev());
    await openSample(window, electronApp, 'report.pdf');
    await window.waitForSelector('[data-tools-badge]', { timeout: 15000 });
  });

  test.afterEach(async () => {
    if (electronApp) await hardClose(electronApp);
  });

  test('vertical "All tools" label: vertical text, proper layout, all themes, clickable', async () => {
    test.setTimeout(240000);
    const issues = [];
    const badge = window.locator('[data-tools-badge]');

    await window.mouse.move(10, 10);
    await window.waitForTimeout(400);

    for (const theme of THEMES) {
      await switchTheme(window, theme);
      await window.mouse.move(10, 10);
      await window.waitForTimeout(400);

      const s = await window.evaluate(() => {
        const badge = document.querySelector('[data-tools-badge]');
        if (!badge) return null;
        const label = badge.querySelector('.tools-badge-label');
        if (!label) return { hasLabel: false };
        const lcs = getComputedStyle(label);
        const bcs = getComputedStyle(badge);
        const lb = label.getBoundingClientRect();
        const bb = badge.getBoundingClientRect();
        const m = lcs.transform.match(/matrix\(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)/);
        const rotated90 = !!m && Math.abs(parseFloat(m[2])) > 0.5;
        return {
          dataTheme: document.documentElement.getAttribute('data-theme'),
          labelText: label.textContent.trim(),
          writingMode: lcs.writingMode,
          textOrientation: lcs.textOrientation,
          whiteSpace: lcs.whiteSpace,
          labelColor: lcs.color,
          transform: lcs.transform,
          rotated90,
          label: { top: lb.top, bottom: lb.bottom, left: lb.left, right: lb.right, w: lb.width, h: lb.height },
          badge: { top: bb.top, bottom: bb.bottom, left: bb.left, right: bb.right, w: bb.width, h: bb.height },
          badgeOpacity: bcs.opacity,
          // Positive value on a side = the label pokes past the badge edge.
          oTop: lb.top - bb.top,
          oBottom: lb.bottom - bb.bottom,
          oLeft: lb.left - bb.left,
          oRight: lb.right - bb.right,
        };
      });
      if (!s) {
        issues.push(`${theme}: [data-tools-badge] missing from the DOM`);
        continue;
      }
      console.log(`[vertical-badge][${theme}]`, JSON.stringify({
        theme: s.dataTheme,
        labelText: s.labelText,
        writingMode: s.writingMode,
        textOrientation: s.textOrientation,
        whiteSpace: s.whiteSpace,
        transform: s.transform,
        rotated90: s.rotated90,
        label: s.label,
        badge: s.badge,
        badgeOpacity: s.badgeOpacity,
        overflowPx: { top: s.oTop, bottom: s.oBottom, left: s.oLeft, right: s.oRight },
      }));

      // 1. Label still reads "All tools".
      if (s.labelText !== 'All tools') {
        issues.push(`${theme}: label text is ${JSON.stringify(s.labelText)}, expected "All tools"`);
      }

      // 2. Vertical orientation: vertical-* writing mode, or a 90deg rotation.
      if (!s.writingMode.startsWith('vertical') && !s.rotated90) {
        issues.push(
          `${theme}: label is NOT vertical (writing-mode=${s.writingMode}, transform=${s.transform}); ` +
          'expected vertical-rl/vertical-lr or a 90deg rotation',
        );
      }
      // Geometric proof the text column runs top -> bottom: taller than wide.
      if (!(s.label.h > s.label.w)) {
        issues.push(
          `${theme}: label box is not taller than wide (${s.label.w.toFixed(1)}x${s.label.h.toFixed(1)}px) - ` +
          'text does not run top-to-bottom',
        );
      }

      // 3. Fit: label must not overflow the pill box.
      const overflows = [];
      if (s.oTop > OVERFLOW_TOL) overflows.push(`top by ${s.oTop.toFixed(1)}px`);
      if (s.oBottom > OVERFLOW_TOL) overflows.push(`bottom by ${s.oBottom.toFixed(1)}px`);
      if (s.oLeft > OVERFLOW_TOL) overflows.push(`left by ${s.oLeft.toFixed(1)}px`);
      if (s.oRight > OVERFLOW_TOL) overflows.push(`right by ${s.oRight.toFixed(1)}px`);
      if (overflows.length) {
        issues.push(
          `${theme}: label overflows the badge pill (badge ${s.badge.w.toFixed(1)}x${s.badge.h.toFixed(1)}px, ` +
          `label ${s.label.w.toFixed(1)}x${s.label.h.toFixed(1)}px): ${overflows.join(', ')} - ` +
          'the vertical label sticks out of the pill',
        );
      }

      // 4. Rest opacity (quiet) ...
      const restOpacity = parseFloat(s.badgeOpacity);
      if (!(restOpacity > 0.29 && restOpacity <= 0.45)) {
        issues.push(`${theme}: at-rest badge opacity ${s.badgeOpacity} outside the ~0.35 quiet band`);
      }
      await window.screenshot({ path: `screenshots/badge-vertical-${theme}.png` });
      await badge.screenshot({ path: `screenshots/badge-vertical-${theme}-badge.png` });
      // Close-up crop around the badge (40px of margin) so an overflow that
      // extends OUTSIDE the pill box is still visible in the crop.
      const clip = {
        x: Math.max(0, s.badge.left - 40),
        y: Math.max(0, s.badge.top - 40),
        width: 220,
        height: Math.min(400, Math.max(120, Math.round(s.badge.h + 80))),
      };
      await window.screenshot({ path: `screenshots/badge-vertical-${theme}-closeup.png`, clip });

      // ... and hover -> fully opaque.
      await badge.hover();
      await window.waitForTimeout(400);
      const hoverOpacity = await window.evaluate(
        () => parseFloat(getComputedStyle(document.querySelector('[data-tools-badge]')).opacity),
      );
      console.log(`[vertical-badge][${theme}] hover opacity=${hoverOpacity}`);
      if (!(hoverOpacity > 0.97)) {
        issues.push(`${theme}: hovered badge opacity ${hoverOpacity} < 0.97 (must become fully opaque)`);
      }
      await window.screenshot({ path: `screenshots/badge-vertical-${theme}-hover.png` });
      await window.mouse.move(10, 10);
      await window.waitForTimeout(400);

      // 5. Clickability: open the palette, verify the real state change, close.
      const marginOf = () =>
        window.evaluate(() => {
          const sc = document.querySelector('.document-scroller');
          return sc ? parseFloat(getComputedStyle(sc).marginRight) : null;
        });
      const marginBefore = await marginOf();
      await badge.click();
      await window.waitForSelector('.app-main[data-tools-open="true"]', { timeout: 5000 });
      await window.waitForSelector('[data-tools-palette]', { timeout: 5000 });
      const pressedOpen = await badge.getAttribute('aria-pressed');
      if (pressedOpen !== 'true') {
        issues.push(`${theme}: aria-pressed=${pressedOpen} after open click (expected "true")`);
      }
      if (theme === 'light') {
        await window.screenshot({ path: 'screenshots/badge-vertical-light-open.png' });
      }
      const toolCount = await window.locator('[data-tools-palette] [data-tool-id]').count();
      if (toolCount < 5) {
        issues.push(`${theme}: open palette exposes only ${toolCount} tool entries`);
      }
      const marginAfter = await marginOf();
      if (marginAfter !== null && marginBefore !== null && marginAfter <= (marginBefore || 0) + 100) {
        issues.push(`${theme}: page view did not narrow while open (margin-right ${marginBefore} -> ${marginAfter})`);
      }
      await badge.click();
      await window.waitForSelector('.app-main[data-tools-open="false"]', { timeout: 5000 });
      await window.waitForSelector('[data-tools-palette]', { state: 'detached', timeout: 5000 });
      const pressedClosed = await badge.getAttribute('aria-pressed');
      if (pressedClosed !== 'false') {
        issues.push(`${theme}: aria-pressed=${pressedClosed} after close click (expected "false")`);
      }
      console.log(
        `[vertical-badge][${theme}] open/close OK (entries=${toolCount}, margin ${marginBefore} -> ${marginAfter})`,
      );
    }

    // Regression: the top toolbar must not carry its own "All tools" control.
    const toolbarButtons = await window.evaluate(() => {
      const tb = document.querySelector('.toolbar');
      if (!tb) return null;
      return [...tb.querySelectorAll('button')].map((b) => ({
        label: b.getAttribute('aria-label') || '',
        title: b.getAttribute('title') || '',
        text: (b.textContent || '').trim(),
      }));
    });
    if (Array.isArray(toolbarButtons)) {
      const strays = toolbarButtons.filter(
        (b) => /all tools/i.test(b.label) || /all tools/i.test(b.title) || /all tools/i.test(b.text),
      );
      if (strays.length) {
        issues.push(`toolbar still contains "All tools" controls: ${JSON.stringify(strays)}`);
      }
    }

    expect(issues, `vertical "All tools" badge verification - collected issues:\n  - ${issues.join('\n  - ')}`)
      .toEqual([]);
  });
});