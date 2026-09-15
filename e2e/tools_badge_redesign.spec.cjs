// "All tools" badge REDESIGN verification - post-rework verification run.
//
// The badge was redesigned from the old small pill into an arrow-shaped
// glass tab pinned to the page view's right edge. This spec verifies the
// redesign contract, per the phase tasking:
//
//   1. Arrow shape pointing left: .tools-badge-content clipped with
//      polygon(25% 0, 100% 0, 100% 100%, 25% 100%, 0% 50%) - flat side on
//      the window edge, tip pointing left into the page.
//   2. Size 72x200 (the old pill was ~55x48).
//   3. Glass transparency with blur: backdrop-filter blur/saturate per theme
//      PLUS a semi-transparent (alpha < 1) gradient surface.
//   4. "All tools" label vertical, bottom-to-top (writing-mode vertical-rl +
//      rotate(180deg)), white text.
//   5. The ONE chevron glyph rotates 180deg while the tools palette is open
//      (250ms transform transition - intermediate frames are sampled so a
//      jump instead of a rotation is caught), and rotates back on close.
//      The click must be a real state change: palette mounts, aria-pressed
//      flips, the page view narrows; a second click restores it.
//
// Checks 1-5 run under light, dark and frosted. Issues are collected per
// theme so every theme is measured and screenshotted even if one breaks; a
// single final assertion reports the collected list.
//
// Screenshots (screenshots/): badge-redesign-<theme>.png (full window, at
// rest), -closeup (badge crop), -open (full window, palette open), and
// -open-closeup (badge with the rotated chevron).

const { test, expect } = require('@playwright/test');
const { launchDev, openSample, hardClose } = require('./lib/helpers.cjs');

const THEMES = ['light', 'dark', 'frosted'];

// Expected backdrop-filter per theme (as shipped in styles.css).
const BACKDROP = {
  light: { blur: 16, sat: '1.3' },
  dark: { blur: 16, sat: '1.3' },
  frosted: { blur: 20, sat: '1.4' },
};

// Computed transform matrix -> {a,b,c,d}; 'none' -> identity.
function parseMatrix(s) {
  if (s === 'none' || s === '' || s === null) return { a: 1, b: 0, c: 0, d: 1 };
  const m = String(s).match(/matrix\(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)/);
  if (!m) return null;
  return { a: +m[1], b: +m[2], c: +m[3], d: +m[4] };
}
const isIdentity = (m) =>
  !!m && Math.abs(m.a - 1) < 0.02 && Math.abs(m.b) < 0.02 && Math.abs(m.c) < 0.02 && Math.abs(m.d - 1) < 0.02;
const isRot180 = (m) =>
  !!m && Math.abs(m.a + 1) < 0.02 && Math.abs(m.b) < 0.05 && Math.abs(m.c) < 0.05 && Math.abs(m.d + 1) < 0.02;

// Parsed clip-path polygon -> normalized [x,y] points (0..1 against the box).
function parseClipPoints(s, boxW, boxH) {
  const m = String(s).match(/polygon\(([\s\S]*)\)/);
  if (!m) return null;
  const pts = [];
  for (const part of m[1].split(',').map((t) => t.trim()).filter(Boolean)) {
    const tok = part.split(/\s+/);
    if (tok.length < 2) return null;
    pts.push([tokNum(tok[0], boxW), tokNum(tok[1], boxH)]);
  }
  return pts.length === 5 ? pts : null;
}
function tokNum(t, size) {
  const n = parseFloat(t);
  if (t.endsWith('%')) return n / 100;
  return n / size; // px normalized against the box
}

// Alpha stops of a background-image value, e.g.
// "linear-gradient(135deg, rgba(59,130,246,0.92), rgba(37,99,235,0.92))"
// -> [0.92, 0.92].
function alphaStops(bg) {
  const out = [];
  const re = /rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([-\d.]+)/g;
  let m;
  while ((m = re.exec(String(bg))) !== null) out.push(parseFloat(m[1]));
  return out;
}

async function scrollerMargin(window) {
  return window.evaluate(() => {
    const sc = document.querySelector('.document-scroller');
    return sc ? parseFloat(getComputedStyle(sc).marginRight) : null;
  });
}

// Sample the chevron's computed transform for up to `timeoutMs`; returns the
// matrices seen. A real 250ms rotation yields intermediate frames; a jump
// would show only the start and end poses.
async function sampleChevronFlight(window, { timeoutMs = 900 } = {}) {
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const t = await window.evaluate(() => {
      const ch = document.querySelector('[data-tools-badge] .tools-badge-chevron');
      return ch ? getComputedStyle(ch).transform : null;
    });
    const m = parseMatrix(t);
    if (m) samples.push(m);
    if (samples.length > 2 && (isRot180(m) || isIdentity(m))) break;
    await window.waitForTimeout(40);
  }
  return samples;
}

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
  await window.waitForTimeout(800); // theme crossfade settle
}

test.describe('"All tools" badge - redesign verification (arrow, glass, vertical text, chevron)', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    ({ electronApp, window } = await launchDev());
    await openSample(window, electronApp, 'report.pdf');
    await window.waitForSelector('[data-tools-badge]', { timeout: 15000 });
    await window.mouse.move(10, 10);
    await window.waitForTimeout(500);
  });

  test.afterEach(async () => {
    if (electronApp) await hardClose(electronApp);
  });

  test('arrow shape, 72x200 size, glass, vertical label, chevron 180deg - 3 themes', async () => {
    test.setTimeout(360000);
    const issues = [];
    const badge = window.locator('[data-tools-badge]');
    await badge.waitFor({ timeout: 10000 });

    for (const theme of THEMES) {
      await switchTheme(window, theme);
      await window.mouse.move(10, 10);
      await window.waitForTimeout(400);
      const dataTheme = await window.evaluate(() => document.documentElement.getAttribute('data-theme'));
      if (dataTheme !== theme) issues.push(`${theme}: theme switch did not land (data-theme=${dataTheme})`);

      // ---- one DOM probe per theme -------------------------------
      const s = await window.evaluate(() => {
        const b = document.querySelector('[data-tools-badge]');
        if (!b) return null;
        const content = b.querySelector('.tools-badge-content');
        const label = b.querySelector('.tools-badge-label');
        const chevron = b.querySelector('.tools-badge-chevron');
        const svg = b.querySelector('svg');
        const ccs = getComputedStyle(content);
        const lcs = label ? getComputedStyle(label) : null;
        const bb = b.getBoundingClientRect();
        const cb = content.getBoundingClientRect();
        const lb = label ? label.getBoundingClientRect() : null;
        return {
          dataTheme: document.documentElement.getAttribute('data-theme'),
          badge: { w: bb.width, h: bb.height, left: bb.left, top: bb.top },
          content: { w: cb.width, h: cb.height },
          clipPath: ccs.clipPath,
          backdrop: ccs.backdropFilter || ccs.getPropertyValue('-webkit-backdrop-filter'),
          background: ccs.backgroundImage,
          labelText: label ? label.textContent.trim() : null,
          writingMode: lcs ? lcs.writingMode : null,
          labelTransform: lcs ? lcs.transform : null,
          labelColor: lcs ? lcs.color : null,
          labelBox: lb ? { w: lb.width, h: lb.height } : null,
          labelFits: lb
            ? lb.top >= cb.top - 1 && lb.bottom <= cb.bottom + 1 && lb.left >= cb.left - 1 && lb.right <= cb.right + 1
            : null,
          chevronTransform: chevron ? getComputedStyle(chevron).transform : null,
          chevronTransition: chevron ? getComputedStyle(chevron).transition : null,
          chevronClass: svg ? svg.getAttribute('class') : null,
          ariaPressed: b.getAttribute('aria-pressed'),
          badgeFilter: getComputedStyle(b).filter,
          viewW: window.innerWidth,
        };
      });
      if (!s) {
        issues.push(`${theme}: [data-tools-badge] missing from the DOM`);
        continue;
      }
      console.log(`[redesign-badge][${theme}]`, JSON.stringify(s));

      // 2. Size: 72x200 exactly (old pill was ~55x48).
      if (Math.abs(s.badge.w - 72) > 0.5 || Math.abs(s.badge.h - 200) > 0.5) {
        issues.push(`${theme}: badge box is ${s.badge.w.toFixed(1)}x${s.badge.h.toFixed(1)}px, expected 72x200`);
      }
      if (Math.abs(s.content.w - 72) > 0.5 || Math.abs(s.content.h - 200) > 0.5) {
        issues.push(`${theme}: content box ${s.content.w.toFixed(1)}x${s.content.h.toFixed(1)}px, expected 72x200`);
      }

      // 1. Arrow clip: 5-point polygon, single leftmost vertex at mid-height.
      const pts = parseClipPoints(s.clipPath, s.content.w, s.content.h);
      if (!pts) {
        issues.push(`${theme}: clip-path is not a 5-point arrow polygon (got: ${s.clipPath})`);
      } else {
        const has = (x, y) => pts.some((p) => Math.abs(p[0] - x) < 0.02 && Math.abs(p[1] - y) < 0.02);
        for (const [x, y] of [
          [0.25, 0],
          [1, 0],
          [1, 1],
          [0.25, 1],
          [0, 0.5],
        ]) {
          if (!has(x, y)) issues.push(`${theme}: arrow polygon missing vertex (${x}, ${y}) in ${s.clipPath}`);
        }
        const leftCol = pts.filter((p) => p[0] < 0.2);
        if (leftCol.length !== 1 || Math.abs(leftCol[0][1] - 0.5) > 0.02) {
          issues.push(`${theme}: arrow tip is not the single leftmost point at mid-height: ${JSON.stringify(leftCol)}`);
        }
      }

      // 3. Glass: per-theme backdrop blur/saturate + semi-transparent surface.
      if (!new RegExp(`blur\\(\\s*${BACKDROP[theme].blur}px`).test(s.backdrop || '')) {
        issues.push(`${theme}: backdrop-filter ${s.backdrop || '(none)'} lacks blur(${BACKDROP[theme].blur}px)`);
      }
      if (!String(s.backdrop || '').includes(`saturate(${BACKDROP[theme].sat})`)) {
        issues.push(`${theme}: backdrop-filter ${s.backdrop || '(none)'} lacks saturate(${BACKDROP[theme].sat})`);
      }
      const alphas = alphaStops(s.background);
      if (alphas.length === 0) {
        issues.push(`${theme}: content background ${s.background} has no rgba stops - not a glass surface`);
      } else if (alphas.every((a) => a >= 0.99)) {
        issues.push(`${theme}: content gradient fully opaque (alphas ${alphas}) - glass transparency lost`);
      }

      // 4. Vertical bottom-to-top "All tools" label.
      if (s.labelText !== 'All tools') issues.push(`${theme}: label reads ${JSON.stringify(s.labelText)}`);
      if (s.writingMode !== 'vertical-rl') {
        issues.push(`${theme}: label writing-mode ${s.writingMode} (want vertical-rl)`);
      }
      if (!isRot180(parseMatrix(s.labelTransform))) {
        issues.push(`${theme}: label transform ${s.labelTransform} is not rotate(180deg) - text not bottom-to-top`);
      }
      if (s.labelBox && !(s.labelBox.h > s.labelBox.w)) {
        issues.push(`${theme}: label box ${s.labelBox.w}x${s.labelBox.h} is not taller than wide - text not vertical`);
      }
      if (s.labelFits === false) issues.push(`${theme}: label pokes outside the clipped content box`);
      if (s.labelColor !== 'rgb(255, 255, 255)') {
        issues.push(`${theme}: label color ${s.labelColor} (want white)`);
      }

      // 5a. At rest: chevron unrotated, 250ms transform transition armed.
      if (!isIdentity(parseMatrix(s.chevronTransform))) {
        issues.push(`${theme}: at-rest chevron transform ${s.chevronTransform} is not identity`);
      }
      if (!/transform/.test(s.chevronTransition || '')) {
        issues.push(`${theme}: chevron has no transform transition (${s.chevronTransition})`);
      }
      if (!/0\.25s|250ms/.test(s.chevronTransition || '')) {
        issues.push(`${theme}: chevron transition is not 250ms (${s.chevronTransition})`);
      }
      if (!/lucide-chevron-left/.test(s.chevronClass || '')) {
        issues.push(`${theme}: badge does not render the left chevron glyph (svg class ${s.chevronClass})`);
      }

      // Evidence: full window at rest + close-up of the badge.
      await window.screenshot({ path: `screenshots/badge-redesign-${theme}.png` });
      const crop = {
        x: Math.max(0, Math.round(s.badge.left - 60)),
        y: Math.max(0, Math.round(s.badge.top - 40)),
        width: Math.min(s.viewW, Math.round(s.badge.w + 60)),
        height: Math.round(s.badge.h + 80),
      };
      await window.screenshot({ path: `screenshots/badge-redesign-${theme}-closeup.png`, clip: crop });

      // 5b. OPEN: real state change + chevron 180deg flight.
      const rectClosed = await badge.boundingBox();
      const marginBefore = await scrollerMargin(window);
      await badge.click();
      await window.waitForSelector('.app-main[data-tools-open="true"]', { timeout: 5000 });
      await window.waitForSelector('[data-tools-palette]', { timeout: 5000 });
      const flight = await sampleChevronFlight(window);
      const sawMid = flight.some((m) => !isIdentity(m) && !isRot180(m));
      if (flight.length < 3) {
        issues.push(`${theme}: only ${flight.length} chevron frames sampled - rotation not observable`);
      } else if (!sawMid) {
        issues.push(`${theme}: chevron jumped straight to 180deg - no intermediate frames: ${JSON.stringify(flight.slice(0, 6))}`);
      }
      const endM = flight.length ? flight[flight.length - 1] : null;
      if (!isRot180(endM)) {
        issues.push(`${theme}: chevron did not settle at 180deg while open (last sample ${JSON.stringify(endM)})`);
      }
      const ariaOpen = await badge.getAttribute('aria-pressed');
      if (ariaOpen !== 'true') issues.push(`${theme}: aria-pressed=${ariaOpen} after open (want "true")`);
      const entries = await window.locator('[data-tools-palette] [data-tool-id]').count();
      if (entries < 5) issues.push(`${theme}: open palette exposes only ${entries} tool entries`);
      const marginOpen = await scrollerMargin(window);
      if (!(marginOpen > (marginBefore || 0) + 100)) {
        issues.push(`${theme}: page view did not narrow (margin-right ${marginBefore} -> ${marginOpen})`);
      }
      const boxOpen = await badge.boundingBox();
      if (Math.abs(boxOpen.x - rectClosed.x) > 0.5 || Math.abs(boxOpen.y - rectClosed.y) > 0.5) {
        issues.push(`${theme}: badge moved when the palette opened (${JSON.stringify(rectClosed)} -> ${JSON.stringify(boxOpen)})`);
      }
      await window.screenshot({ path: `screenshots/badge-redesign-${theme}-open.png` });
      await window.screenshot({ path: `screenshots/badge-redesign-${theme}-open-closeup.png`, clip: crop });

      // 5c. CLOSE: second click restores everything.
      await badge.click();
      const closeFlight = await sampleChevronFlight(window);
      await window.waitForSelector('.app-main[data-tools-open="false"]', { timeout: 5000 });
      await window.waitForSelector('[data-tools-palette]', { state: 'detached', timeout: 5000 });
      const marginAfter = await scrollerMargin(window);
      if (Math.abs(marginAfter - (marginBefore || 0)) > 2) {
        issues.push(`${theme}: margin-right did not restore after close (${marginBefore} -> ${marginAfter})`);
      }
      const ariaClosed = await badge.getAttribute('aria-pressed');
      if (ariaClosed !== 'false') issues.push(`${theme}: aria-pressed=${ariaClosed} after close (want "false")`);
      const closeEnd = closeFlight.length ? closeFlight[closeFlight.length - 1] : null;
      if (closeEnd && !isIdentity(closeEnd)) {
        issues.push(`${theme}: chevron did not rotate back to identity after close (last ${JSON.stringify(closeEnd)})`);
      }
      console.log(
        `[redesign-badge][${theme}] open/close OK (entries=${entries}, margin ${marginBefore} -> ${marginAfter}, chevron frames=${flight.length})`,
      );
    }

    expect(
      issues,
      `badge redesign verification - collected issues:\n  - ${issues.join('\n  - ')}`,
    ).toEqual([]);
  });
});