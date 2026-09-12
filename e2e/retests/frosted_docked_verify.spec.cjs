// VERIFY: frosted glass panels DOCK like the light theme (operator request,
// post Phase-14.2 docked-shell fix). The Phase-14.1 floating-card geometry
// (16px window gutters, 16px top gap below the command band, rounded corners,
// elevation shadows) was retired; both side panels must now carry the SAME
// docked geometry in every theme:
//   - left Pages rail: grid column 1 of .workspace, flush top + left, full
//     height, square corners, right docking hairline only, no margins;
//   - right Tools panel: below BOTH chrome rows (command bar + annotation
//     bar), flush right + bottom, square corners, left docking hairline;
//   - no panel overlaps the title bar (the top bar) or either chrome row;
//   - no floating margins, no all-side borders, no elevation shadows;
//   - the frosted glass MATERIAL stays (backdrop-filter on the panels).
// Light theme is measured as the docked reference; the two geometries must
// match. Screenshots -> screenshots/frosted-docked.png, light-docked.png,
// plus metrics JSON for the record.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchDev, openSample, hardClose } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

let electronApp = null;
let win = null;
let rendererErrors = [];

async function openTools() {
  const isOpen = await win.evaluate(() => !!document.querySelector('[data-tools-palette]'));
  if (!isOpen) {
    await win.click('button[data-tools-toggle]');
    await win.waitForSelector('[data-tools-palette]', { timeout: 8000 });
    await win.waitForTimeout(900); // palette tween + fit-width reflow settle
  }
}

async function setTheme(value) {
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

async function measure() {
  return win.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        left: +b.left.toFixed(1), top: +b.top.toFixed(1),
        right: +b.right.toFixed(1), bottom: +b.bottom.toFixed(1),
        width: +b.width.toFixed(1), height: +b.height.toFixed(1),
      };
    };
    const radius = (el) => {
      if (!el) return null;
      const c = getComputedStyle(el);
      return {
        topLeft: c.borderTopLeftRadius, topRight: c.borderTopRightRadius,
        bottomRight: c.borderBottomRightRadius, bottomLeft: c.borderBottomLeftRadius,
      };
    };
    const sides = (el) => {
      if (!el) return null;
      const c = getComputedStyle(el);
      return {
        top: c.borderTopWidth, right: c.borderRightWidth,
        bottom: c.borderBottomWidth, left: c.borderLeftWidth,
      };
    };
    const box = (el) => {
      if (!el) return null;
      const c = getComputedStyle(el);
      return {
        rect: r(el), radius: radius(el), borders: sides(el),
        margins: { top: c.marginTop, right: c.marginRight, bottom: c.marginBottom, left: c.marginLeft },
        shadow: c.boxShadow, bg: c.backgroundColor, blur: c.backdropFilter,
        position: c.position, zIndex: c.zIndex,
      };
    };
    return {
      dataTheme: document.documentElement.getAttribute('data-theme'),
      inner: { w: window.innerWidth, h: window.innerHeight },
      titlebar: r(q('.titlebar')),
      commandbar: r(q('.workspace-main .toolbar')),
      annbar: r(q('.ann-toolbar')),
      rail: box(q('.side-rail')),
      palette: box(q('[data-tools-palette]')),
    };
  });
}

function overlapArea(a, b) {
  if (!a || !b) return 0;
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

// Extent of the box intersection in each axis (0 when not overlapping).
function overlapExtents(a, b) {
  if (!a || !b) return { w: 0, h: 0 };
  return {
    w: Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)),
    h: Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)),
  };
}

const HAIRLINE = 1.2; // a 1-device-px border round-trips as ~0.67 CSS px at DPR 1.5

function near(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

// The full docked-geometry battery for one theme snapshot.
function assertDocked(m, label) {
  const t = `${label}`;
  expect(m.rail, `${t}: left rail present`).not.toBeNull();
  expect(m.palette, `${t}: Tools palette present`).not.toBeNull();
  expect(m.titlebar, `${t}: titlebar present`).not.toBeNull();
  expect(m.commandbar, `${t}: command bar present`).not.toBeNull();
  expect(m.annbar, `${t}: annotation bar present`).not.toBeNull();

  // -- No overlap with the top bar (titlebar): strict, 0 px.
  expect(overlapArea(m.titlebar, m.rail.rect), `${t}: rail overlaps titlebar`).toBe(0);
  expect(overlapArea(m.titlebar, m.palette.rect), `${t}: palette overlaps titlebar`).toBe(0);
  // -- No material overlap with either chrome row. The chrome rows carry a
  //    1-device-px bottom hairline their 52px height tokens don't count, so
  //    the palette's token-anchored top can kiss the hairline by <1 CSS px;
  //    anything deeper than one hairline is a real overlap.
  const palVsCmd = overlapExtents(m.commandbar, m.palette.rect);
  expect(palVsCmd.w === 0 || palVsCmd.h <= HAIRLINE, `${t}: palette overlaps command bar by ${JSON.stringify(palVsCmd)}`).toBe(true);
  const palVsAnn = overlapExtents(m.annbar, m.palette.rect);
  expect(palVsAnn.w === 0 || palVsAnn.h <= HAIRLINE, `${t}: palette overlaps annotation bar by ${JSON.stringify(palVsAnn)}`).toBe(true);
  expect(overlapArea(m.commandbar, m.rail.rect), `${t}: command bar stretches over rail column`).toBe(0);
  expect(overlapArea(m.annbar, m.rail.rect), `${t}: annotation bar stretches over rail column`).toBe(0);

  // -- Left rail: flush top-left, full height (docked, not floating).
  expect(near(m.rail.rect.left, 0, 1), `${t}: rail flush at window left (left=${m.rail.rect.left})`).toBe(true);
  expect(near(m.rail.rect.top, m.titlebar.bottom, 1.5),
    `${t}: rail flush below top bar (rail.top ${m.rail.rect.top} vs titlebar.bottom ${m.titlebar.bottom})`).toBe(true);
  expect(near(m.rail.rect.bottom, m.inner.h, 1), `${t}: rail flush at window bottom (bottom ${m.rail.rect.bottom} vs inner ${m.inner.h})`).toBe(true);
  expect(near(m.rail.rect.height, m.inner.h - m.titlebar.height, 2), `${t}: rail full height`).toBe(true);

  // -- Right palette: below BOTH chrome rows, flush right + bottom.
  expect(near(m.palette.rect.top, m.annbar.bottom, 1.5),
    `${t}: palette below both chrome rows (top ${m.palette.rect.top} vs annbar.bottom ${m.annbar.bottom})`).toBe(true);
  expect(near(m.palette.rect.right, m.inner.w, 1), `${t}: palette flush right (right ${m.palette.rect.right} vs inner ${m.inner.w})`).toBe(true);
  expect(near(m.palette.rect.bottom, m.inner.h, 1), `${t}: palette flush bottom (bottom ${m.palette.rect.bottom} vs inner ${m.inner.h})`).toBe(true);

  // -- Square corners on both panels.
  for (const corner of ['topLeft', 'topRight', 'bottomRight', 'bottomLeft']) {
    expect(m.rail.radius[corner], `${t}: rail ${corner} radius`).toBe('0px');
    expect(m.palette.radius[corner], `${t}: palette ${corner} radius`).toBe('0px');
  }

  // -- No floating margins, no all-side borders, no elevation shadow.
  //    Border widths round-trip as device fractions (1px -> 0.666667px at
  //    DPR 1.5), so assert parsed values.
  const px = (v) => parseFloat(v);
  expect(m.rail.margins.top, `${t}: rail margin-top`).toBe('0px');
  expect(m.rail.margins.left, `${t}: rail margin-left`).toBe('0px');
  expect(m.rail.margins.right, `${t}: rail margin-right`).toBe('0px');
  expect(m.rail.margins.bottom, `${t}: rail margin-bottom`).toBe('0px');
  expect(m.palette.margins.top, `${t}: palette margin-top`).toBe('0px');
  expect(m.palette.margins.right, `${t}: palette margin-right`).toBe('0px');
  expect(m.palette.margins.bottom, `${t}: palette margin-bottom`).toBe('0px');
  expect(px(m.rail.borders.right), `${t}: rail docking hairline (right border)`).toBeGreaterThanOrEqual(0.5);
  expect(px(m.rail.borders.right), `${t}: rail right border not thick`).toBeLessThan(1.5);
  expect(px(m.rail.borders.top), `${t}: rail top border (floating card would border all sides)`).toBeLessThan(0.5);
  expect(px(m.rail.borders.left), `${t}: rail left border`).toBeLessThan(0.5);
  expect(px(m.rail.borders.bottom), `${t}: rail bottom border`).toBeLessThan(0.5);
  expect(px(m.palette.borders.left), `${t}: palette docking hairline (left border)`).toBeGreaterThanOrEqual(0.5);
  expect(px(m.palette.borders.left), `${t}: palette left border not thick`).toBeLessThan(1.5);
  expect(px(m.palette.borders.top), `${t}: palette top border`).toBeLessThan(0.5);
  expect(px(m.palette.borders.right), `${t}: palette right border`).toBeLessThan(0.5);
  expect(px(m.palette.borders.bottom), `${t}: palette bottom border`).toBeLessThan(0.5);
  expect(m.rail.shadow, `${t}: rail shadow (floating elevation)`).toBe('none');
  expect(m.palette.shadow, `${t}: palette shadow (floating elevation)`).toBe('none');
}

test.describe('frosted glass docked-panel verification', () => {
  test.afterEach(async () => {
    expect(rendererErrors, 'no renderer errors during verification').toEqual([]);
    await hardClose(electronApp, 'frosted-docked-verify');
    electronApp = null;
    win = null;
  });

  test('frosted panels dock exactly like the light theme', async () => {
    test.setTimeout(240000);
    if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });
    ({ electronApp, window: win } = await launchDev());
    rendererErrors = [];
    win.on('pageerror', (err) => rendererErrors.push(`pageerror: ${err.message}`));
    win.on('console', (msg) => {
      if (msg.type() === 'error') rendererErrors.push(`console.error: ${msg.text()}`);
    });

    await openSample(win, electronApp, 'report.pdf');
    await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
    await win.waitForTimeout(1800);
    await openTools();

    // ---- FROSTED (default theme on a fresh profile) ----
    const frosted = await measure();
    expect(frosted.dataTheme).toBe('frosted');
    console.log('[FROSTED]', JSON.stringify(frosted));
    await win.screenshot({ path: path.join(SHOTS, 'frosted-docked.png') });
    assertDocked(frosted, 'FROSTED');
    // Frosted material must still be glass (the docked pane keeps its blur).
    expect(frosted.rail.blur).toContain('blur');
    expect(frosted.palette.blur).toContain('blur');

    // ---- LIGHT (reference) ----
    await setTheme('light');
    await openTools(); // theme switch must not close the palette (DEF-189 fix)
    const light = await measure();
    expect(light.dataTheme).toBe('light');
    console.log('[LIGHT]', JSON.stringify(light));
    await win.screenshot({ path: path.join(SHOTS, 'light-docked.png') });
    assertDocked(light, 'LIGHT');
    // Light panels are the solid docked reference: no glass blur on them.
    expect(light.rail.blur === 'none' || light.rail.blur === '').toBe(true);

    // ---- CROSS-THEME MATCH: frosted geometry === light geometry ----
    const edges = ['left', 'top', 'right', 'bottom', 'width', 'height'];
    for (const panel of ['rail', 'palette']) {
      for (const e of edges) {
        expect(near(frosted[panel].rect[e], light[panel].rect[e], 2),
          `cross-theme ${panel}.${e}: frosted ${frosted[panel].rect[e]} vs light ${light[panel].rect[e]}`).toBe(true);
      }
      expect(frosted[panel].radius).toEqual(light[panel].radius);
    }
    expect(near(frosted.titlebar.height, light.titlebar.height, 1), 'titlebar height equal across themes').toBe(true);

    fs.writeFileSync(
      path.join(SHOTS, 'frosted-docked-metrics.json'),
      JSON.stringify({ frosted, light, capturedAt: new Date().toISOString() }, null, 2),
    );
  });
});
