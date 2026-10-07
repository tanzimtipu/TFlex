// TFL-1116 C6 (finding R12) - enabled-control legibility in the settled dock
// and viewing footer (frontend-dev).
//
// The defect: with the pointer away the dock and footer faded to `opacity: 0.4`
// even for ENABLED commands, so the settled chrome was almost illegible and
// only hover restored it. The fix keeps the idle STATE (3s timing + hover
// restore) but paints CHROME only.
//
// This spec drives the REAL app: open a document, let the dock go idle (>3s
// with no pointer movement), capture the settled screenshots, and assert the
// enabled label/icon stays at full opacity and its COMPOSITED colour clears the
// 4.5:1 floor on the real chrome surface.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

delete process.env.ELECTRON_RUN_AS_NODE;

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const TEXT_FLOOR = 4.5;
const IDLE_MS = 3000;

let app = null;
let win = null;
test.setTimeout(240000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1116-r12-idle');
  app = null;
  win = null;
});

async function openSample(name = 'report.pdf') {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

// Park the pointer on the canvas centre and wait past the idle threshold so the
// dock's State 4 settles with no hover holding it awake.
async function settleIdle() {
  const box = await win.locator('.pdf-page').first().boundingBox();
  if (box) {
    await win.mouse.move(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
  }
  await win.waitForTimeout(IDLE_MS + 900);
}

// Probe an enabled control: its effective opacity (product from the control up
// to the root) and the WCAG ratio of its colour composited over the real
// chrome surface. Opacity is applied on the COMPOSITE, as pixels are painted.
async function probe(rootSel, controlSel) {
  return win.evaluate(({ rootSel, controlSel }) => {
    const root = document.querySelector(rootSel);
    const ctl = document.querySelector(controlSel);
    if (root === null || ctl === null) return null;
    const parse = (s) => {
      const m = String(s).match(/rgba?\(([^)]+)\)/);
      if (m === null) return null;
      const p = m[1].split(',').map((x) => parseFloat(x.trim()));
      return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
    };
    const mix = (fg, bg, a) => ({
      r: fg.r * a + bg.r * (1 - a),
      g: fg.g * a + bg.g * (1 - a),
      b: fg.b * a + bg.b * (1 - a),
      a: 1,
    });
    const ch = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const lum = (c) => 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
    const ratio = (a, b) => {
      const l1 = lum(a);
      const l2 = lum(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    let eff = 1;
    let el = ctl;
    while (el !== null) {
      eff *= parseFloat(getComputedStyle(el).opacity) || 0;
      if (el === root) break;
      el = el.parentElement;
    }
    const ink = parse(getComputedStyle(ctl).color) || { r: 0, g: 0, b: 0, a: 1 };
    let bg = parse(getComputedStyle(root).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    if (bg.a < 1) {
      const page = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
      bg = mix(bg, page, bg.a);
    }
    const compositedInk = mix(ink, bg, Math.max(0, Math.min(1, ink.a * eff)));
    return {
      idle: root.getAttribute('data-dock-idle') || root.getAttribute('data-view-strip-idle'),
      rootOpacity: parseFloat(getComputedStyle(root).opacity),
      controlOpacity: parseFloat(getComputedStyle(ctl).opacity),
      effectiveOpacity: eff,
      label: ctl.getAttribute('aria-label') || (ctl.textContent || '').trim(),
      color: getComputedStyle(ctl).color,
      background: getComputedStyle(root).backgroundColor,
      ratio: ratio(compositedInk, bg),
    };
  }, { rootSel, controlSel });
}

// ---------------------------------------------------------------------------
// R12(a) - the settled ACTION DOCK keeps every enabled verb legible.
// ---------------------------------------------------------------------------
test('R12 dock: settled idle leaves enabled verbs at full opacity and clear of 4.5:1', async () => {
  await openSample();
  await settleIdle();

  const dock = win.locator('[data-action-dock]').first();
  await expect(dock).toBeVisible();
  expect(await dock.getAttribute('data-dock-idle'), 'the dock settled into State 4 idle').toBe('true');

  const enabled = win.locator('[data-action-dock] [data-dock-verb]:not([disabled])');
  const count = await enabled.count();
  expect(count, 'the dock exposes enabled verbs').toBeGreaterThanOrEqual(3);

  // A representative ENABLED verb: its effective opacity and the WCAG ratio of
  // its colour composited over the settled dock surface.
  const p = await probe('[data-action-dock]', '[data-action-dock] [data-dock-verb]:not([disabled])');
  console.log(`[TFL1116-R12] dock enabled verbs=${count} probe=${JSON.stringify(p)}`);
  expect(p, 'an enabled dock verb was measurable').not.toBeNull();
  expect(p.label, 'the probed dock verb carries an accessible name').toBeTruthy();
  expect(p.rootOpacity, 'the dock chrome is not faded').toBeGreaterThanOrEqual(0.99);
  expect(p.effectiveOpacity, `enabled verb "${p.label}" effective opacity`).toBeGreaterThanOrEqual(0.99);
  expect(p.ratio, `enabled dock verb "${p.label}" composited contrast on the settled chrome`).toBeGreaterThanOrEqual(TEXT_FLOOR);

  await win.screenshot({ path: path.join(SHOTS, 'tfl1116_r12_dock_idle.png') });
  console.log('[TFL1116-R12] screenshot: tfl1116_r12_dock_idle.png');

  // Hover restoration is untouched: the state clears and content stays legible.
  await dock.hover();
  await win.waitForTimeout(450);
  expect(await dock.getAttribute('data-dock-idle'), 'hover restores the dock').toBe('false');
});

// ---------------------------------------------------------------------------
// R12(b) - the settled VIEWING FOOTER keeps every enabled control legible.
// ---------------------------------------------------------------------------
test('R12 footer: settled idle leaves enabled controls at full opacity and clear of 4.5:1', async () => {
  await openSample();
  await settleIdle();

  const strip = win.locator('[data-view-strip]').first();
  await expect(strip).toBeVisible();
  expect(await strip.getAttribute('data-view-strip-idle'), 'the footer settled into State 4 idle').toBe('true');

  const rootP = await probe('[data-view-strip]', '[data-view-strip] .view-strip-view [aria-label="Zoom in"]');
  console.log(`[TFL1116-R12] footer zoom-in probe=${JSON.stringify(rootP)}`);
  expect(rootP, 'the footer zoom-in control was measurable').not.toBeNull();
  expect(rootP.rootOpacity, 'the footer chrome is not faded').toBeGreaterThanOrEqual(0.99);
  expect(rootP.effectiveOpacity, `enabled footer control "${rootP.label}" effective opacity`).toBeGreaterThanOrEqual(0.99);
  expect(rootP.ratio, `enabled footer control "${rootP.label}" composited contrast on the settled chrome`).toBeGreaterThanOrEqual(TEXT_FLOOR);

  // The labels beside the icons stay present and legible too.
  const total = (await win.locator('[data-view-strip] .page-total').first().textContent()) || '';
  expect(total, 'the page-total label is rendered in the settled footer').toMatch(/\d/);
  const zoom = (await win.locator('[data-view-strip] .zoom-percent').first().textContent()) || '';
  expect(zoom, 'the zoom readout is rendered in the settled footer').toMatch(/\d/);

  await win.screenshot({ path: path.join(SHOTS, 'tfl1116_r12_footer_idle.png') });
  console.log('[TFL1116-R12] screenshot: tfl1116_r12_footer_idle.png');
  console.log('[TFL1116-R12] footer labels page-total="' + total.trim() + '" zoom="' + zoom.trim() + '"');
});
