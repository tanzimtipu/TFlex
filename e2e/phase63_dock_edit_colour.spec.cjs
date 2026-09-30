// Phase 63 (TFL-47 / TFL-95) — RENDERED computed-style probe for the dock edit
// pen colour.
//
// Verifies Phase 63 criterion 1 with a REAL rendered probe (not a source scan):
// in each theme (light / dark / frosted) the pen's resting computed `color`
// resolves to the theme's `--tf-stage-edit` (which is `var(--sem-primary)`) and
// is DIFFERENT from the theme's `--sem-neutral`.
//
// Launched ONCE through the canonical launchApp helper. The theme is switched by
// setting `data-theme` on documentElement (light = :root / "light", dark =
// "dark", frosted = "frosted"); after each switch the theme transition is given
// time to settle before the rendered style is read. Both sides are normalised to
// one form (rgba via a 1x1 canvas fill) before comparison.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const USER_DATA = path.join(os.tmpdir(), `tflex-p63-dockedit-${Date.now()}`);
const THEMES = ['light', 'dark', 'frosted'];

test.setTimeout(180000);

async function openReport(win) {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('[data-action-dock]', { timeout: 30000 });
  await win.waitForFunction(() => document.querySelector('[data-dock-edit-toggle]') !== null, null, { timeout: 30000 });
  await win.waitForTimeout(800);
}

// Set the theme attribute and wait for the transition to settle.
async function setTheme(win, t) {
  await win.evaluate((theme) => document.documentElement.setAttribute('data-theme', theme), t);
  await win.waitForFunction((theme) => document.documentElement.getAttribute('data-theme') === theme, t, { timeout: 10000 });
  await win.waitForTimeout(600);
}

// Read the rendered pen colour plus the theme's edit + neutral tokens, all
// normalised to the same rgba form via a 1x1 canvas fill.
async function probe(win) {
  return win.evaluate(() => {
    const norm = (value) => {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = String(value).trim();
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data).join(',');
    };
    const pen = document.querySelector('[data-dock-edit-toggle]');
    if (pen === null) return null;
    const root = getComputedStyle(document.documentElement);
    const results = {};
    const theme = document.documentElement.getAttribute('data-theme');
    results.theme = theme;
    results.penColor = norm(getComputedStyle(pen).color);
    results.stageEdit = norm(root.getPropertyValue('--tf-stage-edit'));
    results.neutral = norm(root.getPropertyValue('--sem-neutral'));
    results.raw = {
      penColor: getComputedStyle(pen).color,
      stageEdit: root.getPropertyValue('--tf-stage-edit'),
      neutral: root.getPropertyValue('--sem-neutral'),
    };
    return results;
  });
}

test('dock edit pen rests in the edit-stage colour, distinct from neutral, in every theme', async () => {
  const app = await launchApp([], USER_DATA);
  const win = await app.firstWindow();
  await openReport(win);

  for (const t of THEMES) {
    await setTheme(win, t);
    const r = await probe(win);
    console.log(`[P63-pen] theme=${t} ${JSON.stringify(r)}`);
    expect(r, `the pen is rendered in theme ${t}`).not.toBeNull();

    expect(r.penColor, `theme ${t}: pen colour matches --tf-stage-edit (pen=${r.raw.penColor} token=${r.raw.stageEdit})`).toBe(r.stageEdit);
    expect(r.penColor, `theme ${t}: pen colour differs from --sem-neutral (pen=${r.raw.penColor} neutral=${r.raw.neutral})`).not.toBe(r.neutral);

    await win.locator('[data-action-dock]').screenshot({ path: path.join(SHOTS, `p63-dock-edit-pen-${t}.png`) });
  }

  await hardClose(app, 'p63-dock-edit');
});
