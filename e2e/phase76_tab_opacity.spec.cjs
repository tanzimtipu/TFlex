// Phase 76 — OPAQUE colorful tab colours across all themes (TFL-233 / TFL-246).
//
// Validates the one assigned behaviour: the `colorful` tab body (`::before`)
// background AND 1px border are fully opaque (computed alpha === 1) in the
// frosted (default), dark and light themes, for both the inactive and active
// tabs. The Phase 68/72 tint relationship (active fill differs from inactive)
// must survive, and the Phase 62/72 shape/label/active/click surface must not
// regress. Screenshots are captured for a visual solid-fill judgement.
//
// Launches only through the canonical launchApp helper from e2e/lib/launch.cjs.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { switchTheme } = require('./lib/p33_common.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const USER_DATA = path.join(os.tmpdir(), `tflex-p76-tabopacity-${Date.now()}`);
const THEMES = ['frosted', 'dark', 'light'];

test.setTimeout(300000);

// Parse the alpha channel out of a computed CSS colour. Chromium serializes
// `color-mix(in srgb, ...)` computed values as `color(srgb r g b)` (alpha
// token omitted when fully opaque) as well as legacy `rgb()` / `rgba()`.
// Returns null when the value is not a colour (so a null/empty computed value
// fails loudly rather than passing by accident).
function alphaOf(color) {
  const c = String(color).trim();
  let m = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (m) {
    const parts = m[1].split(',').map((s) => s.trim());
    return parts.length === 4 ? parseFloat(parts[3]) : 1;
  }
  m = /^color\(srgb\s+([^)]+)\)$/i.exec(c);
  if (m) {
    const parts = m[1].replace('/', ' ').trim().split(/\s+/).filter(Boolean);
    return parts.length >= 4 ? parseFloat(parts[3]) : 1;
  }
  return null;
}

// Open a bundled sample through the mocked native dialog + the real Open
// toolbar control (the Phase 58 pattern).
async function openBundledSample(app, win, sampleName) {
  const p = getSamplePath(sampleName);
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(1400);
}

// Read the measurable surface of every colorful tab: the `::before` fill and
// border colours plus the shape/label/active markers the regression needs.
async function readTabs(win) {
  return win.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
    return tabs.map((el) => {
      const before = getComputedStyle(el, '::before');
      const titleEl = el.querySelector('.tab-title');
      return {
        id: el.getAttribute('data-tab-id'),
        active: el.getAttribute('aria-selected') === 'true',
        hasActiveClass: el.classList.contains('tab-active'),
        bg: before.backgroundColor,
        borderTop: before.borderTopColor,
        height: el.getBoundingClientRect().height,
        label: titleEl ? titleEl.textContent.trim() : '',
      };
    });
  });
}

test('Phase 76 — colorful tab fill + border are opaque in frosted, dark and light', async () => {
  const app = await launchApp([], USER_DATA);
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);

  // Two bundled sample PDFs -> at least two colorful tabs (one active, one not).
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
  await openBundledSample(app, win, 'long.pdf');
  await expect(win.locator('[data-tab-id]')).toHaveCount(2, { timeout: 30000 });

  // Colorful is the shipped default tab style.
  expect(await win.locator('.tab-area').getAttribute('data-tab-style')).toBe('colorful');

  const measured = {};
  for (const theme of THEMES) {
    await switchTheme(win, theme);
    await win.waitForTimeout(400);
    const tabs = await readTabs(win);
    console.log(`[P76] theme=${theme} tabs=${JSON.stringify(tabs)}`);

    const active = tabs.find((t) => t.active);
    const inactive = tabs.find((t) => !t.active);
    expect(active, `an active tab exists in ${theme}`).toBeTruthy();
    expect(inactive, `an inactive tab exists in ${theme}`).toBeTruthy();

    measured[theme] = {};
    for (const t of tabs) {
      const which = t.active ? 'active' : 'inactive';
      const aBg = alphaOf(t.bg);
      const aBorder = alphaOf(t.borderTop);
      measured[theme][which] = { bg: t.bg, bgAlpha: aBg, border: t.borderTop, borderAlpha: aBorder };
      expect(aBg, `${theme} ${which} ::before background alpha (${t.bg})`).toBe(1);
      expect(aBorder, `${theme} ${which} ::before border alpha (${t.borderTop})`).toBe(1);
    }

    // Phase 68/72 tint relationship: active fill !== inactive fill.
    console.log(`[P76] theme=${theme} active.bg=${active.bg} inactive.bg=${inactive.bg}`);
    expect(active.bg, `${theme}: active ::before fill differs from inactive`).not.toBe(inactive.bg);

    await win.screenshot({ path: path.join(SHOTS, `p76-tab-opaque-${theme}.png`) });
  }
  console.log(`[P76] measured=${JSON.stringify(measured)}`);

  // ---- Shape / label / active / click regression (Phase 62/72 surface) ----
  const reg = await readTabs(win);
  const activeReg = reg.find((t) => t.active);
  const inactiveReg = reg.find((t) => !t.active);
  expect(Math.abs(inactiveReg.height - 26), `inactive tab is 26px (got ${inactiveReg.height})`).toBeLessThanOrEqual(0.5);
  expect(Math.abs(activeReg.height - 30), `active tab is 30px (got ${activeReg.height})`).toBeLessThanOrEqual(0.5);
  expect(activeReg.hasActiveClass, 'active tab carries .tab-active').toBe(true);
  for (const t of reg) {
    expect(t.label.length, `tab ${t.id} has a non-empty label`).toBeGreaterThan(0);
  }

  // Clicking the inactive tab activates it (mousedown activation).
  const inactiveId = inactiveReg.id;
  await win.locator(`[data-tab-id="${inactiveId}"]`).click();
  await win.waitForTimeout(500);
  const after = await readTabs(win);
  const now = after.find((t) => t.id === inactiveId);
  expect(now.active, `clicked tab ${inactiveId} is now active`).toBe(true);
  expect(now.hasActiveClass, `clicked tab ${inactiveId} carries .tab-active`).toBe(true);

  await hardClose(app, 'p76-tab-opacity');
});
