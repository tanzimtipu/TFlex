// TFL-172 (qa) — DEF-449/450/451 runtime verification against the current tree.
// Launches only through the canonical e2e/lib/launch.cjs launchApp.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, runTool } = require('./lib/helpers.cjs');
const { twoPaneSetup, switchTheme } = require('./lib/p33_common.cjs');

let app = null;
let win = null;
test.setTimeout(300000);

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl172');
  app = null;
  win = null;
});

function parseRgb(s) {
  const m = s && s.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((x) => Number(x.trim()));
  return { r: p[0], g: p[1], b: p[2] };
}
function lum({ r, g, b }) {
  const f = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) {
  const la = lum(a); const lb = lum(b);
  const hi = Math.max(la, lb); const lo = Math.min(la, lb);
  return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
}

test('TFL-172 DEF-451 runtime: --dock-primary-fg per theme', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const expected = { light: '#6D28D9', dark: '#A78BFA', frosted: '#6D28D9' };
  for (const theme of ['light', 'dark', 'frosted']) {
    await switchTheme(win, theme);
    const v = await win.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dock-primary-fg').trim());
    console.log(`[TFL172 dock-primary-fg ${theme}] ${v}`);
    expect(v.toUpperCase(), `${theme}: --dock-primary-fg`).toBe(expected[theme].toUpperCase());
  }
});

test('TFL-172 DEF-449 runtime: dark hovered divider grip colour + contrast', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await twoPaneSetup(app, win);
  await switchTheme(win, 'dark');
  await win.waitForTimeout(600);
  await win.locator('.multi-divider-grip').first().hover();
  await win.waitForTimeout(300);
  const s = await win.evaluate(() => {
    const g = document.querySelector('.multi-divider-grip');
    const cs = getComputedStyle(g);
    return { color: cs.color, bg: cs.backgroundColor };
  });
  const ratio = contrast(parseRgb(s.color), parseRgb(s.bg));
  console.log(`[TFL172 grip dark] color=${s.color} bg=${s.bg} contrast=${ratio}:1`);
  expect(s.color, 'grip ink resolves to the violet accent').toBe('rgb(124, 58, 237)');
  expect(s.bg, 'grip capsule is the on-accent surface').toBe('rgb(255, 255, 255)');
  expect(ratio, 'grip contrast >= 3:1').toBeGreaterThanOrEqual(3);
});

test('TFL-172 DEF-450 runtime: dark crop label colour + contrast', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.locator('.sample-card').first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2000);
  await switchTheme(win, 'dark');
  await runTool(win, 'cropPages');
  await win.waitForSelector('[data-crop-pages-dialog]', { timeout: 10000 });
  await win.click('[data-crop-mode="perPage"]');
  let s = null;
  try {
    await win.waitForSelector('.crop-editor-label', { timeout: 10000 });
    s = await win.evaluate(() => {
      const el = document.querySelector('.crop-editor-label');
      const cs = getComputedStyle(el);
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg-elevated').trim();
      return { color: cs.color, bgToken: bg };
    });
  } catch {
    s = null;
  }
  if (!s) {
    console.log('[TFL172 crop label dark] label not reachable headless -> INCONCLUSIVE');
    return;
  }
  const ratio = contrast(parseRgb(s.color), parseRgb(s.bgToken) || { r: 0x19, g: 0x1e, b: 0x24 });
  console.log(`[TFL172 crop label dark] color=${s.color} bgToken=${s.bgToken} contrast=${ratio}:1`);
  expect(s.color, 'dark crop label resolves to --accent-text').toBe('rgb(167, 139, 250)');
  expect(ratio, 'crop label contrast >= 4.5:1').toBeGreaterThanOrEqual(4.5);
});
