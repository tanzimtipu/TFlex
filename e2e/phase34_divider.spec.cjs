// Phase 34 — criterion 4: a prominent divider in every theme.
//
// Report the divider's rendered width, background colour and grip affordance
// in all three themes (with a contrast note against the neighbouring surfaces),
// drag it and assert the pointer tracking is 1:1 and both panes re-split within
// the existing min-pane clamp, and assert the grip is visible (not
// hover-revealed only).
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { twoPaneSetup, switchTheme, SHOTS } = require('./lib/p33_common.cjs');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p34-divider');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function dividerInfo() {
  return win.evaluate(() => {
    const div = document.querySelector('[data-multi-divider]');
    const grip = document.querySelector('.multi-divider-grip');
    const rect = (el) => {
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), width: Math.round(b.width), height: Math.round(b.height) };
    };
    const bg = (el) => (el ? getComputedStyle(el).backgroundColor : null);
    const centre = grip !== null ? grip.getBoundingClientRect() : null;
    const hitEl = centre !== null
      ? document.elementFromPoint(centre.left + centre.width / 2, centre.top + centre.height / 2)
      : null;
    const hit = hitEl
      ? `${hitEl.tagName.toLowerCase()}.${String(hitEl.className || '').split(' ')[0]}`
      : null;
    return {
      divider: rect(div),
      dividerBg: bg(div),
      dividerTransition: div ? getComputedStyle(div).transitionProperty : null,
      grip: rect(grip),
      gripOpacity: grip ? getComputedStyle(grip).opacity : null,
      gripBg: bg(grip),
      gripShadow: grip ? getComputedStyle(grip).boxShadow : null,
      gripHit: hit,
      // The grip is hit-testable when its centre resolves to the grip or one of
      // its descendants (the GripVertical icon).
      gripHitInGrip: hitEl !== null && grip !== null ? grip.contains(hitEl) : false,
      gripHitInDivider: hitEl !== null && div !== null ? div.contains(hitEl) : false,
      scrollerBg: bg(document.querySelector('.tab-pane[data-pane="A"] .document-scroller')),
      stripBg: bg(document.querySelector('[data-pane-strip-pane="A"]')),
    };
  });
}

function parseRgb(s) {
  if (s === null) return null;
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m === null) return null;
  const parts = m[1].split(',').map((x) => Number(x.trim()));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}
function relativeLum({ r, g, b }) {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const la = relativeLum(a);
  const lb = relativeLum(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
}

test('C1 divider width, colour and grip across all three themes', async () => {
  await twoPaneSetup(app, win);
  for (const theme of ['light', 'dark', 'frosted']) {
    await switchTheme(win, theme);
    await win.waitForTimeout(600);
    const info = await dividerInfo();
    const d = parseRgb(info.dividerBg);
    const sc = parseRgb(info.scrollerBg);
    const st = parseRgb(info.stripBg);
    const cScroller = d && sc ? contrast(d, sc) : null;
    const cStrip = d && st ? contrast(d, st) : null;
    console.log(`[P34-divider] theme=${theme} width=${info.divider.width} bg=${info.dividerBg} vs scroller=${cScroller}:1 vs strip=${cStrip}:1 grip=${JSON.stringify(info.grip)} gripOpacity=${info.gripOpacity} gripBg=${info.gripBg} gripShadow=${info.gripShadow} gripHit=${info.gripHit} transition=${info.dividerTransition}`);

    // Visual record in the light theme (the weakest divider contrast, so the
    // honest case for the operator's "not very visible" complaint).
    if (theme === 'light') {
      await win.screenshot({ path: path.join(SHOTS, 'phase34-divider.png') });
      console.log('[P34-divider] captured screenshots/phase34-divider.png (light theme)');
    }

    // Width is the token-driven band.
    expect(info.divider.width, `${theme}: divider width`).toBeGreaterThanOrEqual(6);
    expect(info.divider.width).toBeLessThanOrEqual(10);
    // A real, non-transparent surface colour (frosted's --border-strong is a
    // translucent glass film over the wallpaper, so alpha is checked > 0).
    expect(info.dividerBg, `${theme}: divider background`).not.toBe('rgba(0, 0, 0, 0)');
    expect(info.dividerBg).not.toBe('transparent');
    expect(d.a, `${theme}: divider colour is a real surface`).toBeGreaterThan(0);
    // Perceptible contrast against the neighbouring pane surfaces.
    expect(cScroller, `${theme}: divider/scroller contrast`).toBeGreaterThan(1.1);
    // The grip is a real, always-visible capsule with a shadow.
    expect(info.grip, `${theme}: grip present`).not.toBeNull();
    expect(info.grip.width, `${theme}: grip width`).toBeGreaterThanOrEqual(16);
    expect(info.grip.height, `${theme}: grip height`).toBeGreaterThanOrEqual(30);
    expect(info.gripOpacity, `${theme}: grip always visible (opacity 1, not hover-revealed)`).toBe('1');
    expect(info.gripShadow, `${theme}: grip has a raised shadow`).not.toBe('none');
    // The grip is hit-testable at its centre (not covered / pointer-events off).
    expect(info.gripHitInGrip, `${theme}: grip hit-testable (hit=${info.gripHit})`).toBe(true);
    expect(info.gripHitInDivider, `${theme}: hit stays inside the divider`).toBe(true);
    // Geometry is NOT transitioned (drag must track 1:1).
    expect(info.dividerTransition, `${theme}: divider geometry has no transition`).not.toMatch(/\bleft\b/);
    expect(info.dividerTransition, `${theme}: divider geometry has no transition`).not.toMatch(/\bwidth\b/);
  }
});

test('C2 drag tracks the pointer 1:1, re-splits both panes within the min clamp, works after a theme change', async () => {
  await twoPaneSetup(app, win);
  // Work in the dark theme to prove the drag survives a theme change.
  await switchTheme(win, 'dark');
  await win.waitForTimeout(600);

  const paneWidth = (pane) => win.evaluate((p) => Math.round(document.querySelector(`.tab-pane[data-pane="${p}"]`).getBoundingClientRect().width), pane);
  const dividerLeft = () => win.evaluate(() => Math.round(document.querySelector('[data-multi-divider]').getBoundingClientRect().left));

  const base = await win.locator('[data-multi-divider]').boundingBox();
  const cy = base.y + base.height / 2;

  // --- +200px: the divider and pane A both move +200 ---
  const a0 = await paneWidth('A');
  const d0 = await dividerLeft();
  await win.mouse.move(base.x + base.width / 2, cy);
  await win.mouse.down();
  await win.mouse.move(base.x + base.width / 2 + 200, cy, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(300);
  const a1 = await paneWidth('A');
  const d1 = await dividerLeft();
  console.log(`[P34-divider] drag +200: paneA ${a0}->${a1} (delta ${a1 - a0}); dividerLeft ${d0}->${d1} (delta ${d1 - d0})`);
  expect(Math.abs((a1 - a0) - 200), 'pane A width tracks the pointer 1:1').toBeLessThanOrEqual(2);
  expect(Math.abs((d1 - d0) - 200), 'divider left tracks the pointer 1:1').toBeLessThanOrEqual(2);

  // --- drag far left: pane A clamps at the minimum pane width ---
  const box2 = await win.locator('[data-multi-divider]').boundingBox();
  await win.mouse.move(box2.x + box2.width / 2, cy);
  await win.mouse.down();
  await win.mouse.move(box2.x + box2.width / 2 - 1200, cy, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(300);
  const aMin = await paneWidth('A');
  const bMax = await paneWidth('B');
  console.log(`[P34-divider] drag far left: paneA=${aMin} paneB=${bMax}`);
  expect(aMin, 'pane A clamps at the 320px minimum').toBeGreaterThanOrEqual(316);
  expect(aMin).toBeLessThanOrEqual(326);
  // Phase 36 (chunk 5) — the Inspector reserves 264px at the stage's right, so
  // pane B's complement is (stage - 264 - paneA - divider), not the full stage.
  expect(bMax, 'pane B takes the complement').toBeGreaterThan(800);

  // --- drag far right: pane B clamps at the minimum ---
  const box3 = await win.locator('[data-multi-divider]').boundingBox();
  await win.mouse.move(box3.x + box3.width / 2, cy);
  await win.mouse.down();
  await win.mouse.move(box3.x + box3.width / 2 + 1200, cy, { steps: 10 });
  await win.mouse.up();
  await win.waitForTimeout(300);
  const aMax = await paneWidth('A');
  const bMin = await paneWidth('B');
  console.log(`[P34-divider] drag far right: paneA=${aMax} paneB=${bMin}`);
  expect(bMin, 'pane B clamps at the 320px minimum').toBeGreaterThanOrEqual(316);
  expect(bMin).toBeLessThanOrEqual(326);
  expect(aMax, 'pane A takes the complement').toBeGreaterThan(800);

  // The grip is still visible and hit-testable after the drag + theme change.
  const info = await dividerInfo();
  expect(info.gripOpacity).toBe('1');
  expect(info.gripHitInGrip, `grip hit after drag (hit=${info.gripHit})`).toBe(true);
});
