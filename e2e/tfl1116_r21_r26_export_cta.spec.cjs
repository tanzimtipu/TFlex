// TFL-1139 (TFL-1116 C6b) — R21 + R26 focused verification.
//
// Frontend-owned. Launches ONLY through the canonical e2e/lib/launch.cjs
// `launchApp`. Drives the REAL Electron app: the Deliver export primary CTA
// must be >= 40px tall with a white-on-violet label and a currentColor glyph
// that clears 4.5:1 in both the enabled and the disabled state, and it must
// stay reachable in the compact-width Deliver drawer.
//
// The harness exports ELECTRON_RUN_AS_NODE=1; launchApp spreads process.env,
// so Electron would exit as Node. Clear it.
delete process.env.ELECTRON_RUN_AS_NODE;

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (name) => path.join(SHOTS, name);

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1139');
  app = null;
  win = null;
});

test.setTimeout(300000);

const setSize = async (w, h) => {
  // The window launches MAXIMIZED on this host, and setSize is ignored while
  // maximized, so unmaximize first, then size the normal bounds.
  await app.evaluate(({ BrowserWindow }) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw.isMaximized()) bw.unmaximize();
  });
  await win.waitForTimeout(350);
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]);
  }, [w, h]);
  await win.waitForFunction((s) => Math.abs(window.innerWidth - s) < 60, w, { timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(250);
};

const clickStage = async (stage) => {
  await win.locator(`[data-stage-rail] [data-stage="${stage}"]`).first().click();
  await win.waitForFunction((s) => {
    const rail = document.querySelector('[data-stage-rail]');
    const btn = document.querySelector(`[data-stage-rail] [data-stage="${s}"]`);
    return (rail && rail.getAttribute('data-active-stage') === s)
      || (btn && btn.getAttribute('aria-pressed') === 'true');
  }, stage, { timeout: 8000 });
  await win.waitForTimeout(350);
};

const CTA = '[data-inspector-action="export"]';

// --- WCAG 2.1 relative-luminance contrast (mirrors the unit specs) ----------
const channel = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};
const parseRgb = (value) => {
  const m = value.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`unparseable rgb: ${value}`);
  const p = m[1].split(',').map((v) => Number.parseFloat(v.trim()));
  return { r: p[0], g: p[1], b: p[2] };
};
const luminance = ({ r, g, b }) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a, b) => {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

const readCta = () =>
  win.evaluate((sel) => {
    const btn = document.querySelector(sel);
    if (!btn) return null;
    const svg = btn.querySelector('svg');
    const span = btn.querySelector('span');
    const cs = getComputedStyle(btn);
    const rect = btn.getBoundingClientRect();
    return {
      disabled: btn.disabled === true,
      height: rect.height,
      color: cs.color,
      background: cs.backgroundColor,
      opacity: cs.opacity,
      svgColor: svg ? getComputedStyle(svg).color : null,
      label: span ? span.textContent : null,
    };
  }, CTA);

test('R21/R26 export CTA sizing, ink and contrast in the Deliver panel', async () => {
  // 1. Open a document and reach the Deliver export surface.
  const report = win.locator('.sample-card').filter({ hasText: 'report.pdf' });
  if ((await report.count()) > 0) await report.first().click();
  else await win.locator('.sample-card').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await setSize(1280, 800);
  await clickStage('deliver');
  await win.waitForSelector('[data-export-config]', { timeout: 8000 });

  // 2. Enabled CTA: >= 40px, white primary ink, currentColor glyph, 4.5:1.
  const enabled = await readCta();
  expect(enabled, 'enabled CTA present').not.toBeNull();
  expect(enabled.height, `enabled CTA height ${enabled.height}`).toBeGreaterThanOrEqual(40);
  expect(enabled.disabled, 'enabled CTA is not disabled').toBe(false);
  const enabledRatio = contrast(parseRgb(enabled.color), parseRgb(enabled.background));
  expect(enabledRatio, `enabled ink contrast ${enabledRatio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  expect(enabled.svgColor, 'glyph inherits currentColor').toBe(enabled.color);
  expect(enabled.opacity, 'enabled CTA is not faded').toBe('1');
  console.log(`[tfl1139-r21] enabled height=${enabled.height} ink=${enabled.color} bg=${enabled.background} ratio=${enabledRatio.toFixed(2)} label="${enabled.label}"`);
  await win.screenshot({ path: shot('tfl1116_r21_cta_enabled.png') });

  // 3. Disabled CTA: invalid custom range disables the primary action. The
  // disabled look is an explicit muted pair (opacity stays 1), still 4.5:1.
  await win.locator('[data-export-config-scope="custom"]').check();
  const range = win.locator('[data-export-config-range]');
  await range.waitFor({ state: 'visible', timeout: 5000 });
  await range.fill('not-a-range');
  await expect(win.locator('[data-inspector-action="export"]')).toBeDisabled();
  // The .btn family transitions its fill; let the disabled surface settle
  // before reading the computed colour.
  await win.waitForTimeout(320);

  const disabled = await readCta();
  expect(disabled, 'disabled CTA present').not.toBeNull();
  expect(disabled.height, `disabled CTA height ${disabled.height}`).toBeGreaterThanOrEqual(40);
  expect(disabled.disabled, 'CTA reports disabled').toBe(true);
  expect(disabled.opacity, 'disabled is not an opacity fade').toBe('1');
  const disabledRatio = contrast(parseRgb(disabled.color), parseRgb(disabled.background));
  expect(disabledRatio, `disabled ink contrast ${disabledRatio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  expect(disabled.svgColor, 'disabled glyph inherits currentColor').toBe(disabled.color);
  expect(disabled.background, 'disabled surface differs from the enabled surface').not.toBe(enabled.background);
  console.log(`[tfl1139-r21] disabled height=${disabled.height} ink=${disabled.color} bg=${disabled.background} ratio=${disabledRatio.toFixed(2)} opacity=${disabled.opacity}`);
  await win.screenshot({ path: shot('tfl1116_r21_cta_disabled.png') });

  // 4. Compact 960x640: the Deliver drawer still reaches the CTA.
  await setSize(960, 640);
  await win.waitForSelector('[data-inspector-collapsed-strip]', { timeout: 8000 });
  await win.click('[data-inspector-collapse]');
  await win.waitForSelector('[data-inspector][data-inspector-drawer="true"]', { timeout: 5000 });
  const cta = win.locator(CTA);
  await cta.scrollIntoViewIfNeeded();
  await win.waitForTimeout(250);
  const compact = await readCta();
  expect(compact, 'compact drawer CTA present').not.toBeNull();
  expect(compact.height, `compact CTA height ${compact.height}`).toBeGreaterThanOrEqual(40);
  await expect(cta).toBeVisible();
  const inViewport = await win.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return r.bottom <= window.innerHeight + 1 && r.top >= -1;
  }, CTA);
  expect(inViewport, 'compact drawer CTA is inside the viewport').toBe(true);
  console.log(`[tfl1139-r26] compact 960x640 CTA height=${compact.height} reachable=${inViewport}`);
  await win.screenshot({ path: shot('tfl1116_r26_cta_compact_drawer.png') });
});
